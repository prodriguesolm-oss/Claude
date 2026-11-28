// Teste de ponta a ponta das notificações: app (iPhone emulado) + servidor real local + serviço de push falso.
// Requer Playwright com Chromium. Uso: cd server && npm install && node test/app-e2e.mjs
import { createRequire } from 'module';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const ece = require('http_ece');
const { chromium, devices } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const cleanup = () => { for (const p of procs) try { p.kill('SIGKILL'); } catch {} mock.close(); };
const ok = (c, m) => { if (!c) { console.error('✗', m); cleanup(); process.exit(1); } console.log('  ✓', m); };
const SHOTS = process.env.SHOTS_DIR || require('os').tmpdir() + '/agentonator-push-e2e/';
require('fs').mkdirSync(SHOTS, { recursive: true });

// serviço de push falso (papel da Apple)
const received = [];
const mock = http.createServer((req, res) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => { received.push({ at: Date.now(), headers: req.headers, body: Buffer.concat(ch) }); res.writeHead(201); res.end(); }); }).listen(9999);
// servidor de notificações (real) + site do app
procs.push(spawn(process.execPath, [new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url).pathname, 'dev', '--port', '8787', '--var', 'ALLOW_LOCAL_PUSH:1', '--log-level', 'error'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, stdio: 'ignore' }));
procs.push(spawn('python3', ['-m', 'http.server', '8765'], { cwd: new URL('../..', import.meta.url).pathname, stdio: 'ignore' }));
for (let i = 0; i < 120; i++) { try { if ((await fetch('http://localhost:8787/')).ok) break; } catch {} await sleep(500); }

// chaves do "iPhone" (para decifrar o que chega)
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const auth = crypto.randomBytes(16);
const testSub = { endpoint: 'http://localhost:9999/push/iphone', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
const decrypt = (r) => JSON.parse(ece.decrypt(r.body, { version: 'aes128gcm', privateKey: ua, authSecret: auth }).toString());

const opts = { ...devices['iPhone 13'], deviceScaleFactor: 1, locale: 'pt-BR' }; delete opts.defaultBrowserType;
const browser = await chromium.launch();
const ctx = await browser.newContext(opts);
await ctx.grantPermissions(['notifications'], { origin: 'http://localhost:8765' });
// o Chromium daqui não alcança o serviço de push do Google; simulamos só a inscrição (o resto é real)
await ctx.addInitScript((sub) => {
  // Chromium sem tela informa 'denied' aqui mesmo após conceder; o Safari informa 'granted'
  try { Object.defineProperty(Notification, 'permission', { get: () => 'granted' }); } catch {}
  if (!('PushManager' in window)) return;
  let current = null;
  const make = (key) => ({ endpoint: sub.endpoint, options: { applicationServerKey: key }, toJSON: () => sub, unsubscribe: async () => { current = null; return true; } });
  PushManager.prototype.subscribe = async function (o) { current = make(o.applicationServerKey); return current; };
  PushManager.prototype.getSubscription = async function () { return current; };
}, testSub);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const sheet = () => page.locator('.sheet-wrap.open').last();
await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
if (await page.locator('[data-act=dismiss-hint]').count()) await page.click('[data-act=dismiss-hint]');

// ---------- ativar pelos Ajustes ----------
await page.click('[data-act=settings]'); await page.waitForTimeout(500);
ok((await sheet().locator('.cell-title').first().innerText()).length > 0, 'seção Notificações nos Ajustes');
await sheet().locator('input[name=pushServer]').fill('http://localhost:8787');
await sheet().locator('[data-act=push-on]').click();
await page.waitForTimeout(2500);
const status = await sheet().locator('.form-group').nth(1).locator('.cell-title').first().innerText();
if (!status.includes('Ativadas') && await page.locator('.alert-wrap').count()) console.log('ALERTA:', await page.locator('.alert-wrap').innerText());
ok(status.includes('Ativadas'), `notificações ativadas (${status})`);
await page.screenshot({ path: SHOTS + 'push-settings.png' });
await sheet().locator('[data-act=push-test]').click();
await page.waitForTimeout(2000);
ok(received.length === 1 && decrypt(received[0]).body.includes('funcionando'), 'notificação de teste chegou e foi decifrada');
await sheet().locator('[data-sheet=left]').click(); await page.waitForTimeout(400);

// ---------- evento daqui a 5 min e 12 s + sino "5 min antes" ----------
const evStart = await page.evaluate(async () => {
  const s = await import('./js/store.js');
  const p = await s.savePlace({ name: 'Teatro Municipal' });
  const start = Date.now() + 5 * 60_000 + 45_000;
  await s.saveEvent({ placeId: p.id, name: 'Ópera Carmen', start, end: start + 2 * 3600_000 });
  return start;
});
await page.click('[data-act=today]'); await page.waitForTimeout(400);
await page.locator('.tl-b:has-text("Ópera Carmen")').click(); await page.waitForTimeout(500);
ok((await sheet().locator('.bell-btn').innerText()).includes('Sem notificação'), 'ficha mostra o botão de notificação (desligado)');
await sheet().locator('.bell-btn').click(); await page.waitForTimeout(400);
await page.screenshot({ path: SHOTS + 'push-choose.png' });
await page.getByRole('button', { name: '5 min antes', exact: true }).click(); await page.waitForTimeout(600);
ok((await sheet().locator('.bell-btn').innerText()).includes('Notificar 5 min antes'), 'sino ligado: "Notificar 5 min antes"');
await page.screenshot({ path: SHOTS + 'push-sheet.png' });
await sheet().locator('[data-sheet=left]').click(); await page.waitForTimeout(400);
ok(await page.locator('.tl-b:has-text("Ópera Carmen") .bell-ic').count() === 1, 'bloco da agenda mostra o sino');

// espera o aviso: deve chegar ~5 min antes do início (= daqui a ~12 s)
for (let i = 0; i < 150 && received.length < 2; i++) await sleep(500);
ok(received.length === 2, 'aviso do evento chegou');
const p = decrypt(received[1]);
const expectedAt = evStart - 5 * 60_000;
ok(Math.abs(received[1].at - expectedAt) < 3000, `na hora certa (${received[1].at - expectedAt} ms de diferença)`);
ok(p.title === 'Ópera Carmen' && /^Começa em 5 minutos — às \d\d:\d\d · Teatro Municipal$/.test(p.body), `texto: "${p.title}: ${p.body}"`);

// ---------- formulário: horário avulso com notificação padrão (1h) ----------
await page.locator('[data-view=agenda] .fab').click(); await page.waitForTimeout(400);
await page.locator('.as-btn:has-text("Horário avulso")').click(); await page.waitForTimeout(400);
await sheet().locator('input[name=title]').fill('Shopping Leblon');
await sheet().locator('label.cell:has(input[name=remindOn]) .sw').click();
ok(await sheet().locator('[data-remset="60"].on').count() === 1, 'ao ligar, vem 1h antes por padrão');
await sheet().locator('[data-remset="120"]').click();
await page.screenshot({ path: SHOTS + 'push-form.png' });
await sheet().locator('[data-sheet=right]').click(); await page.waitForTimeout(700);
if (await page.locator('.as-wrap.open').count()) { await page.locator('.as-btn:has-text("Manter sobreposto")').click(); await page.waitForTimeout(500); }
const itemRemind = await page.evaluate(async () => (await import('./js/store.js')).state.items[0].remind);
ok(itemRemind === 120, 'item específico com 2h antes (padrão continua 1h)');
await page.waitForTimeout(2000);
const st = await fetch('http://localhost:8787/status?device=' + await page.evaluate(async () => (await import('./js/store.js')).state.settings.pushDevice)).then((r) => r.json());
ok(st.subscribed, `servidor sabe do aparelho (${st.reminders} aviso(s) agendado(s))`);

// ---------- o service worker mostra a notificação ao receber um push ----------
const cdp = await ctx.newCDPSession(page);
let regId = null;
cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => { for (const r of e.registrations) if (r.scopeURL.startsWith('http://localhost:8765')) regId = r.registrationId; });
await cdp.send('ServiceWorker.enable');
for (let i = 0; i < 20 && !regId; i++) await sleep(200);
// o Chromium sem tela recusa exibir qualquer notificação; registramos o pedido de exibição feito pelo app
const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('http://localhost:8765'));
await sw.evaluate(() => { self.__shown = []; self.registration.showNotification = (t, o) => { self.__shown.push(`${t}: ${o.body} [tag=${o.tag}]`); return Promise.resolve(); }; });
await cdp.send('ServiceWorker.deliverPushMessage', { origin: 'http://localhost:8765', registrationId: regId, data: JSON.stringify({ title: 'Ópera Carmen', body: 'Começa em 1 hora', tag: 'event:x' }) });
await sleep(1000);
const shown = await sw.evaluate(() => self.__shown);
ok(shown.includes('Ópera Carmen: Começa em 1 hora [tag=event:x]'), `ao receber o push, o app pede ao sistema para exibir a notificação (${JSON.stringify(shown)})`);

// ---------- desativar ----------
await page.click('[data-act=settings]'); await page.waitForTimeout(400);
await sheet().locator('[data-act=push-off]').click(); await page.waitForTimeout(300);
await page.locator('.alert-btn.destructive').click(); await page.waitForTimeout(1200);
const st2 = await fetch('http://localhost:8787/status?device=' + await page.evaluate(async () => (await import('./js/store.js')).state.settings.pushDevice)).then((r) => r.json());
ok(!st2.subscribed && st2.reminders === 0, 'desativar apaga os avisos no servidor');
ok(errors.length === 0, 'sem erros no console' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
cleanup();
process.exit(0);
