// Servidor de notificações do Agentonator.
//
// O app (no iPhone) manda periodicamente a lista de lembretes ativos: { id, at, until, title, body }.
// Cada aparelho tem seu próprio Durable Object, identificado por um código aleatório gerado no app.
// O Durable Object agenda um "alarm" para o próximo lembrete e, na hora, envia a notificação (Web Push).
//
// Rotas:
//   GET  /                         -> saúde
//   GET  /vapid?device=ID          -> chave pública para o app se inscrever
//   GET  /status?device=ID         -> diagnóstico (inscrição, lembretes, último envio)
//   POST /sync   {device, subscription, reminders}
//   POST /test   {device, subscription?}  -> envia uma notificação de teste agora
//   POST /disable {device}         -> apaga tudo deste aparelho

import { generateVapidKeys, sendPush } from './webpush.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });
const DEVICE_RE = /^[A-Za-z0-9_-]{16,80}$/;
const MAX_REMINDERS = 500;
const LATE_LIMIT = 30 * 60_000; // não manda aviso com mais de 30 min de atraso

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '') return json({ ok: true, app: 'agentonator-push' });
    if (!['/vapid', '/status', '/sync', '/test', '/disable'].includes(url.pathname)) return json({ error: 'rota não encontrada' }, 404);

    let device = url.searchParams.get('device');
    let body = null;
    if (req.method === 'POST') {
      const raw = await req.text();
      if (raw.length > 200_000) return json({ error: 'requisição grande demais' }, 413);
      try { body = JSON.parse(raw); } catch { return json({ error: 'JSON inválido' }, 400); }
      device = body?.device;
    }
    if (!device || !DEVICE_RE.test(device)) return json({ error: 'código do aparelho inválido' }, 400);

    const stub = env.PUSH.get(env.PUSH.idFromName(device));
    return stub.fetch(new Request(`https://device${url.pathname}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json', 'X-App-Origin': req.headers.get('Origin') || '' },
      body: body ? JSON.stringify(body) : undefined,
    }));
  },
};

function validSubscription(s, allowLocal = false) {
  const okUrl = /^https:\/\//.test(s?.endpoint || '') || (allowLocal && /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(s?.endpoint || ''));
  return s && typeof s.endpoint === 'string' && okUrl && s.endpoint.length < 2000
    && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';
}

function cleanReminders(list, now) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((r) => r && typeof r.id === 'string' && Number.isFinite(r.at) && r.at > now - 60_000)
    .slice(0, MAX_REMINDERS)
    .map((r) => ({
      id: r.id.slice(0, 200),
      at: Math.floor(r.at),
      until: Number.isFinite(r.until) ? Math.floor(r.until) : Math.floor(r.at) + 3600_000,
      title: String(r.title || 'Agentonator').slice(0, 120),
      body: String(r.body || '').slice(0, 240),
    }))
    .sort((a, b) => a.at - b.at);
}

export class PushDevice {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.storage = ctx.storage;
    this.allowLocal = env.ALLOW_LOCAL_PUSH === '1'; // só para testes locais (wrangler dev)
  }

  async vapid() {
    let v = await this.storage.get('vapid');
    if (!v) {
      v = await generateVapidKeys();
      await this.storage.put('vapid', v);
    }
    return v;
  }

  async subject(fallbackOrigin) {
    const saved = await this.storage.get('subject');
    if (saved) return saved;
    return /^https:\/\//.test(fallbackOrigin || '') ? fallbackOrigin : 'mailto:agentonator@invalid.example';
  }

  async fetch(req) {
    const url = new URL(req.url);
    const now = Date.now();
    const origin = req.headers.get('X-App-Origin') || '';
    const body = req.method === 'POST' ? await req.json() : {};

    if (url.pathname === '/vapid') return json({ publicKey: (await this.vapid()).publicKey });

    if (url.pathname === '/status') {
      const [sub, reminders = [], lastSend, syncedAt] = await Promise.all(['sub', 'reminders', 'lastSend', 'syncedAt'].map((k) => this.storage.get(k)));
      return json({ subscribed: !!sub, reminders: reminders.length, next: reminders[0]?.at || null, syncedAt: syncedAt || null, lastSend: lastSend || null, alarm: await this.storage.getAlarm() });
    }

    if (url.pathname === '/sync') {
      if (!validSubscription(body.subscription, this.allowLocal)) return json({ error: 'inscrição inválida' }, 400);
      const reminders = cleanReminders(body.reminders, now);
      const put = { sub: body.subscription, reminders, syncedAt: now };
      if (/^https:\/\//.test(origin)) put.subject = origin; // contato VAPID = endereço do app
      await this.storage.put(put);
      await this.schedule(reminders);
      return json({ ok: true, count: reminders.length, next: reminders[0]?.at || null });
    }

    if (url.pathname === '/test') {
      const sub = validSubscription(body.subscription, this.allowLocal) ? body.subscription : await this.storage.get('sub');
      if (!sub) return json({ error: 'nenhuma inscrição — ative as notificações no app' }, 400);
      const res = await sendPush(sub, { title: 'Agentonator', body: 'Notificações funcionando ✓ Você vai receber os avisos dos seus eventos aqui.', tag: 'teste', url: './' },
        await this.vapid(), { subject: await this.subject(origin), ttl: 600 });
      await this.storage.put('lastSend', { at: now, status: res.status, ok: res.ok, text: res.text, test: true });
      if (res.gone) await this.storage.delete('sub');
      return json(res, res.ok ? 200 : 502);
    }

    if (url.pathname === '/disable') {
      await this.storage.deleteAlarm();
      await this.storage.deleteAll();
      return json({ ok: true });
    }

    return json({ error: 'rota não encontrada' }, 404);
  }

  async schedule(reminders) {
    const next = reminders[0];
    if (next) await this.storage.setAlarm(Math.max(Date.now() + 500, next.at));
    else await this.storage.deleteAlarm();
  }

  /** dispara na hora do próximo lembrete */
  async alarm() {
    const now = Date.now();
    const [sub, reminders = [], vapidSaved] = await Promise.all([this.storage.get('sub'), this.storage.get('reminders'), this.storage.get('vapid')]);
    const due = reminders.filter((r) => r.at <= now + 1_000);
    const rest = reminders.filter((r) => r.at > now + 1_000);
    if (sub && vapidSaved && due.length) {
      const subject = await this.subject('');
      for (const r of due) {
        if (now - r.at > LATE_LIMIT) continue;
        const res = await sendPush(sub, { title: r.title, body: r.body, tag: r.id, url: './' }, vapidSaved, { subject, ttl: Math.max(60, (r.until - now) / 1000) });
        await this.storage.put('lastSend', { at: now, status: res.status, ok: res.ok, text: res.text, id: r.id });
        if (res.gone) { await this.storage.delete('sub'); break; }
      }
    }
    await this.storage.put('reminders', rest);
    await this.schedule(rest);
  }
}
