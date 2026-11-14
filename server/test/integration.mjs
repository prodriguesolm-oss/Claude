// Teste de integração: servidor real (wrangler dev / workerd) + serviço de push falso que decifra as mensagens.
// Uso: cd server && npm install && npm test
import { createRequire } from 'module';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const ece = require('http_ece');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { if (!c) { console.error('✗', m); cleanup(); process.exit(1); } console.log('  ✓', m); };
const b64u = (b) => Buffer.from(b).toString('base64url');

// ---------- serviço de push falso (faz o papel da Apple) ----------
const received = [];
let respondStatus = 201;
const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => { received.push({ at: Date.now(), headers: req.headers, body: Buffer.concat(chunks), url: req.url }); res.writeHead(respondStatus); res.end(); });
}).listen(9999);

// ---------- servidor do Agentonator ----------
const W = spawn(process.execPath, [new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url).pathname, 'dev', '--port', '8787', '--var', 'ALLOW_LOCAL_PUSH:1', '--log-level', 'warn'],
  { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let wlog = '';
W.stdout.on('data', (d) => { wlog += d; }); W.stderr.on('data', (d) => { wlog += d; });
function cleanup() { try { W.kill('SIGKILL'); } catch {} mock.close(); }
const API = 'http://localhost:8787';
for (let i = 0; i < 120; i++) { try { const r = await fetch(API + '/'); if (r.ok) break; } catch {} await sleep(500); }
const health = await fetch(API + '/').then((r) => r.json()).catch(() => null);
ok(health?.ok, 'servidor local no ar');

// ---------- "iPhone" ----------
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const auth = crypto.randomBytes(16);
const device = 'iphone' + crypto.randomBytes(12).toString('hex');
const subscription = { endpoint: 'http://localhost:9999/push/abc123', keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } };
const decrypt = (r) => JSON.parse(ece.decrypt(r.body, { version: 'aes128gcm', privateKey: ua, authSecret: auth }).toString());

const { publicKey } = await fetch(`${API}/vapid?device=${device}`).then((r) => r.json());
ok(Buffer.from(publicKey, 'base64url').length === 65, 'chave VAPID gerada para o aparelho');
const again = await fetch(`${API}/vapid?device=${device}`).then((r) => r.json());
ok(again.publicKey === publicKey, 'a chave VAPID é estável (a mesma nas próximas vezes)');

const now = Date.now();
const reminders = [
  { id: 'event:a', at: now + 3000, until: now + 3600_000, title: 'Ópera Carmen', body: 'Começa em 1 hora — às 19:00 · Teatro Municipal' },
  { id: 'item:b', at: now + 6000, until: now + 7200_000, title: 'Shopping Leblon', body: 'Começa em 2 horas — às 20:00' },
  { id: 'event:passado', at: now - 3600_000, until: now, title: 'velho', body: 'não deve ir' },
];
const sync = await fetch(`${API}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://prodriguesolm-oss.github.io' }, body: JSON.stringify({ device, subscription, reminders }) }).then((r) => r.json());
ok(sync.ok && sync.count === 2, `sincronizou 2 lembretes futuros (ignorou o que já passou): ${JSON.stringify(sync)}`);

await sleep(9000);
ok(received.length === 2, `as 2 notificações chegaram no horário (${received.length})`);
const [n1, n2] = received;
ok(Math.abs(n1.at - reminders[0].at) < 2500 && Math.abs(n2.at - reminders[1].at) < 2500, `pontualidade: ${n1.at - reminders[0].at} ms e ${n2.at - reminders[1].at} ms de diferença`);
const p1 = decrypt(n1), p2 = decrypt(n2);
ok(p1.title === 'Ópera Carmen' && p1.body.includes('Teatro Municipal') && p2.title === 'Shopping Leblon', 'conteúdo decifrado corretamente no "iPhone"');
ok(n1.headers['content-encoding'] === 'aes128gcm' && /^vapid t=.+, k=/.test(n1.headers.authorization) && Number(n1.headers.ttl) > 3000, 'cabeçalhos de Web Push corretos (aes128gcm, VAPID, TTL até o evento)');
const claims = JSON.parse(Buffer.from(n1.headers.authorization.split('t=')[1].split('.')[1], 'base64url'));
ok(claims.sub === 'https://prodriguesolm-oss.github.io' && claims.aud === 'http://localhost:9999', 'JWT com sub = endereço do app e aud = serviço de push');

// re-sincronizar substitui a lista (ex.: evento adiado)
await fetch(`${API}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device, subscription, reminders: [{ id: 'event:a', at: Date.now() + 2000, title: 'Ópera Carmen (adiada)', body: 'x' }] }) });
await fetch(`${API}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device, subscription, reminders: [{ id: 'event:a', at: Date.now() + 4000, title: 'Ópera Carmen (adiada de novo)', body: 'x' }] }) });
await sleep(6500);
ok(received.length === 3 && decrypt(received[2]).title === 'Ópera Carmen (adiada de novo)', 'mudou o horário → só o aviso novo é enviado, sem duplicar');

// teste imediato
const t = await fetch(`${API}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device }) }).then((r) => r.json());
ok(t.ok && received.length === 4 && decrypt(received[3]).body.includes('funcionando'), 'botão "notificação de teste" funciona');

// inscrição expirada (410) -> servidor esquece a inscrição
respondStatus = 410;
await fetch(`${API}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device }) });
const st = await fetch(`${API}/status?device=${device}`).then((r) => r.json());
ok(st.subscribed === false && st.lastSend.status === 410, 'inscrição expirada é descartada pelo servidor');

const bad = await fetch(`${API}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: 'x', subscription, reminders: [] }) });
ok(bad.status === 400, 'rejeita código de aparelho inválido');
const d = await fetch(`${API}/disable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device }) }).then((r) => r.json());
ok(d.ok, 'desativar apaga os dados do aparelho no servidor');
if (/error|exception/i.test(wlog)) console.log('--- log do wrangler ---\n' + wlog.slice(-1500));
cleanup();
process.exit(0);
