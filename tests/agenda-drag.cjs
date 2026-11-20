// Teste de ponta a ponta da agenda interativa (toques simulados num iPhone emulado).
// Uso: python3 -m http.server 8765  (na raiz do projeto)  e depois:  node tests/agenda-drag.cjs
const { chromium, devices } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const SHOTS = process.env.SHOTS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'agentonator-drag-'));
const APP_URL = process.env.APP_URL || 'http://localhost:8765/';
const pad = (n) => String(n).padStart(2, '0');
const dk = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function assert(c, m) { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); }

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 15'], deviceScaleFactor: 1, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const cdp = await ctx.newCDPSession(page);
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `drag-${n}.png`) });
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  /** encosta, (opcionalmente) segura, arrasta na vertical e solta */
  async function gesture(x, y0, y1, { hold = 480, steps = 6, lingerMs = 0 } = {}) {
    await touch('touchStart', x, y0);
    if (hold) await wait(hold);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', x, y0 + ((y1 - y0) * i) / steps); await wait(25); }
    if (lingerMs) await wait(lingerMs);
    await touch('touchEnd');
    await wait(650);
  }
  const block = (title) => page.locator('[data-view=agenda] .tl-b', { hasText: title });
  const box = async (title) => block(title).boundingBox();
  const toastText = () => page.locator('#toast.show').innerText().catch(() => '');

  const D = new Date(); D.setDate(D.getDate() + 2); D.setHours(0, 0, 0, 0);
  const DK = dk(D);
  const occs = (dayKey = DK) => page.evaluate(async (d) => {
    const { state } = await import('./js/store.js');
    const sch = await import('./js/schedule.js');
    const t = await import('./js/time.js');
    const ds = t.parseDateKey(d).getTime();
    return Object.fromEntries(sch.expand(state, ds, t.addDays(ds, 1)).map((o) => [o.title, t.fmtRange(o.start, o.end)]));
  }, dayKey);
  const goDay = async (d) => { await page.locator('[data-ref=jump]').fill(dk(d)); await wait(450); };

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await wait(400);

  // ---------- padrão de conflitos ----------
  console.log('Padrão de conflitos');
  let pol = await page.evaluate(async () => (await import('./js/store.js')).state.settings.conflictPolicy);
  assert(pol === 'ask', 'instalação nova já vem com "perguntar sempre"');
  await page.evaluate(async () => {
    const s = await import('./js/store.js');
    await s.updateSettings({ conflictPolicy: 'cascade', policyRev: 2, installHintDismissed: true }); // como ficou na versão 8
  });
  await page.reload({ waitUntil: 'networkidle' }); await wait(500);
  pol = await page.evaluate(async () => (await import('./js/store.js')).state.settings.conflictPolicy);
  assert(pol === 'ask', 'quem vinha da versão 8 (adiar automático) passa a ser perguntado, uma vez');
  // este teste confere o arrastar com o "adiar em cascata" fixo (Ajustes); o "perguntar" tem teste próprio (agenda-reorg)
  await page.evaluate(async () => (await import('./js/store.js')).updateSettings({ conflictPolicy: 'cascade' }));
  await page.reload({ waitUntil: 'networkidle' }); await wait(500);
  pol = await page.evaluate(async () => (await import('./js/store.js')).state.settings.conflictPolicy);
  assert(pol === 'cascade', 'escolha fixa em Ajustes é respeitada depois de reabrir');

  // ---------- dados: trabalho semanal 10–13, almoço 13–14, reunião 14–15, jantar 20–21 ----------
  await page.evaluate(async (d) => {
    const s = await import('./js/store.js');
    const t = await import('./js/time.js');
    const day = t.parseDateKey(d);
    const at = (h, m = 0) => t.atMinutes(d, h * 60 + m);
    await s.saveCommitment({ name: 'Trabalho', kind: 'weekly', slots: [{ id: 'w', days: [day.getDay()], startMin: 600, endMin: 780 }], startDate: t.dateKey(Date.now()) });
    await s.saveItem({ title: 'Almoço', start: at(13), end: at(14) });
    await s.saveItem({ title: 'Reunião', start: at(14), end: at(15) });
    await s.saveItem({ title: 'Jantar', start: at(20), end: at(21) });
    await s.saveItem({ title: 'Madrugada', start: t.addDays(at(0, 15), 1), end: t.addDays(at(1), 1) });
  }, DK);
  await goDay(D);
  await shot('01-antes');

  // ---------- 1) borda de baixo: esticar o trabalho 15 min -> cascata ----------
  console.log('Puxar a borda de baixo');
  let b = await box('Trabalho');
  await gesture(b.x + b.width / 2, b.y + b.height - 6, b.y + b.height - 6 + 16);
  let o = await occs();
  console.log('   ', JSON.stringify(o));
  assert(o.Trabalho === '10:00–13:15', 'trabalho esticado até 13:15 arrastando a borda de baixo');
  assert(o['Almoço'] === '13:15–14:15' && o['Reunião'] === '14:15–15:15', 'almoço e reunião adiados 15 min em cascata');
  assert(o.Jantar === '20:00–21:00', 'jantar (sem sobreposição) não foi tocado');
  const next = new Date(D); next.setDate(next.getDate() + 1);
  assert((await occs(dk(next))).Madrugada === '00:15–01:00', 'o dia seguinte não foi tocado');
  let tt = await toastText();
  console.log('    aviso:', JSON.stringify(tt.replace(/\n/g, ' ')));
  assert(/Trabalho até 13:15/.test(tt) && /só nesta semana/.test(tt) && /2 itens adiados/.test(tt) && /Desfazer/.test(tt), 'aviso explica o que mudou e oferece Desfazer');
  await shot('02-cascata');
  let st = await page.evaluate(async () => { const { state } = await import('./js/store.js'); return { n: state.commitments.length, ov: Object.keys(state.commitments[0].overrides || {}).length }; });
  assert(st.n === 1 && st.ov === 1, 'continua um único compromisso semanal; só esta ocorrência foi ajustada');

  // ---------- 2) desfazer ----------
  await page.locator('.toast-act').click(); await wait(600);
  o = await occs();
  assert(o.Trabalho === '10:00–13:00' && o['Almoço'] === '13:00–14:00' && o['Reunião'] === '14:00–15:00', 'Desfazer devolve tudo ao que era');
  st = await page.evaluate(async () => Object.keys((await import('./js/store.js')).state.commitments[0].overrides || {}).length);
  assert(st === 0, 'e o ajuste da semana some junto');

  // ---------- 3) o exemplo: trabalhar só até meio-dia ----------
  console.log('Trabalhar até meio-dia e almoçar mais cedo');
  b = await box('Trabalho');
  await gesture(b.x + b.width / 2, b.y + b.height - 6, b.y + b.height - 6 - 60);
  o = await occs();
  assert(o.Trabalho === '10:00–12:00' && o['Almoço'] === '13:00–14:00', 'borda de baixo para cima: trabalho termina 12:00, o resto fica igual');
  const week = new Date(D); week.setDate(week.getDate() + 7);
  assert((await occs(dk(week))).Trabalho === '10:00–13:00', 'na semana seguinte o trabalho continua 10:00–13:00');
  assert(await page.locator('.tl-b.sel').count() === 1 && await page.locator('.tl-b.sel .tl-h').count() === 2, 'bloco fica selecionado, com as duas bolinhas');
  await shot('03-selecionado');

  // tocar fora tira a seleção (sem abrir o menu de adicionar); o toque seguinte abre o menu
  const tl = await page.locator('[data-view=agenda] .tl').boundingBox();
  b = await box('Reunião');
  await page.touchscreen.tap(tl.x + 200, b.y + b.height + 50); await wait(350);
  assert(await page.locator('.tl-b.sel').count() === 0 && await page.locator('.as-wrap').count() === 0, 'tocar fora só tira a seleção');
  await page.touchscreen.tap(tl.x + 200, b.y + b.height + 50); await wait(450);
  assert(await page.locator('.as-wrap.open').count() === 1, 'o toque seguinte num horário vazio abre "Adicionar à agenda"');
  await page.locator('.as-cancel').click(); await wait(400);

  // ---------- 4) selecionar segurando o meio e usar as bolinhas ----------
  console.log('Selecionar e usar as bolinhas');
  b = await box('Almoço');
  await gesture(b.x + b.width / 2, b.y + 20, b.y + 20, { steps: 1 }); // segura sem arrastar
  assert((await block('Almoço').getAttribute('class')).includes('sel'), 'segurar o bloco seleciona');
  assert(/bolinhas/.test(await toastText()), 'dica aparece nas primeiras vezes');
  let h = await page.locator('.tl-b.sel .tl-h-s').boundingBox();
  await gesture(h.x + h.width / 2, h.y + h.height / 2, h.y + h.height / 2 - 30, { hold: 0 }); // sem segurar
  o = await occs();
  assert(o['Almoço'] === '12:30–14:00', 'bolinha de cima muda só o início (12:30)');
  b = await box('Almoço');
  await gesture(b.x + b.width / 2, b.y + 40, b.y + 40 - 30, { hold: 0 });
  o = await occs();
  assert(o['Almoço'] === '12:00–13:30', 'corpo do bloco selecionado move na hora, sem segurar (12:00–13:30)');
  h = await page.locator('.tl-b.sel .tl-h-e').boundingBox();
  await gesture(h.x + h.width / 2, h.y + h.height / 2, h.y + h.height / 2 - 30, { hold: 0 });
  o = await occs();
  console.log('   ', JSON.stringify(o));
  assert(o['Almoço'] === '12:00–13:00' && o.Trabalho === '10:00–12:00', 'bolinha de baixo muda só o fim: almoço 12:00–13:00, logo depois do trabalho');
  await shot('04-almoco-cedo');

  // ---------- 5) o que começou antes não é empurrado ----------
  console.log('Sobreposição com o que começou antes');
  b = await box('Almoço');
  await gesture(b.x + b.width / 2, b.y + 30, b.y + 30 - 30, { hold: 0 });
  o = await occs();
  tt = await toastText();
  assert(o['Almoço'] === '11:30–12:30' && o.Trabalho === '10:00–12:00', 'almoço por cima do fim do trabalho: o trabalho NÃO é jogado para depois');
  assert(/sobreposto com Trabalho/.test(tt), 'aviso diz que ficou sobreposto');
  await shot('05-sobreposto');
  await page.locator('.toast-act').click(); await wait(600);
  assert((await occs())['Almoço'] === '12:00–13:00', 'Desfazer volta o almoço');
  await page.touchscreen.tap(tl.x + 200, (await box('Reunião')).y + 110); await wait(350); // tira a seleção

  // ---------- 6) rolar a tela não redimensiona ----------
  console.log('Segurança contra toques acidentais');
  b = await box('Reunião');
  await gesture(b.x + b.width / 2, b.y + b.height - 5, b.y + b.height - 85, { hold: 0, steps: 4 }); // deslizar rápido = rolagem
  assert((await occs())['Reunião'] === '14:00–15:00', 'deslizar rápido sobre a borda não muda nada');
  await page.locator('[data-view=agenda]').evaluate((el) => { el.scrollTop = 0; });
  await goDay(D);

  // tocar (sem segurar) continua abrindo a ficha
  b = await box('Reunião');
  await page.touchscreen.tap(b.x + b.width / 2, b.y + 20); await wait(500);
  assert(await page.locator('.sheet-wrap.open').count() === 1, 'toque simples continua abrindo a ficha do item');
  await page.locator('.sheet-wrap.open [data-sheet=left]').click(); await wait(400);

  // ---------- 7) rolagem automática ao arrastar até a beira da tela ----------
  console.log('Rolagem automática');
  const view = page.locator('[data-view=agenda]');
  // segurar parado a borda de um bloco que está perto do rodapé NÃO pode rolar nem esticar sozinho
  b = await box('Reunião');
  const barTop = (await page.locator('.tabbar').boundingBox()).y;
  await view.evaluate((el, delta) => { el.scrollTop -= delta; }, barTop - 30 - (b.y + b.height));
  await wait(200);
  b = await box('Reunião');
  const still0 = await view.evaluate((el) => el.scrollTop);
  await touch('touchStart', b.x + b.width / 2, b.y + b.height - 6);
  await wait(1300);
  await touch('touchEnd'); await wait(500);
  assert(await view.evaluate((el) => el.scrollTop) === still0 && (await occs())['Reunião'] === '14:00–15:00', 'segurar parado perto do rodapé não rola nem muda nada');
  await page.touchscreen.tap(tl.x + 200, (await box('Trabalho')).y - 30); await wait(300); // tira a seleção
  await goDay(D);
  const top0 = await view.evaluate((el) => el.scrollTop);
  b = await box('Reunião');
  const vh = page.viewportSize().height;
  const y0 = b.y + b.height - 6;
  const y1 = vh - 80; // dentro da faixa logo acima da barra de abas
  await gesture(b.x + b.width / 2, y0, y1, { lingerMs: 900 });
  const top1 = await view.evaluate((el) => el.scrollTop);
  o = await occs();
  console.log('    rolou', Math.round(top1 - top0), 'px ·', JSON.stringify(o['Reunião']), '· jantar', o.Jantar);
  const endMin = (r) => { const [hh, mm] = r.split('–')[1].split(':').map(Number); return hh * 60 + mm; };
  const startMin = (r) => { const [hh, mm] = r.split('–')[0].split(':').map(Number); return hh * 60 + mm; };
  assert(top1 > top0 + 100 && top1 < top0 + 600, 'a agenda rola sozinha (em velocidade controlável) quando o dedo chega perto do rodapé');
  assert(endMin(o['Reunião']) >= 15 * 60 + (y1 - y0) + 90, 'e o fim acompanha além do que o dedo percorreu');
  assert(endMin(o['Reunião']) <= 20 * 60 ? o.Jantar === '20:00–21:00' : startMin(o.Jantar) >= endMin(o['Reunião']), 'o jantar só é adiado se a reunião esticada chegar nele');
  await page.locator('.toast-act').click(); await wait(600);
  o = await occs();
  assert(o['Reunião'] === '14:00–15:00' && o.Jantar === '20:00–21:00', 'Desfazer também devolve o que a cascata empurrou');

  // ---------- 8) persistência ----------
  console.log('Persistência');
  await page.reload({ waitUntil: 'networkidle' }); await wait(600);
  o = await occs();
  assert(o.Trabalho === '10:00–12:00' && o['Almoço'] === '12:00–13:00' && o['Reunião'] === '14:00–15:00', 'tudo salvo após reabrir');

  console.log('\nCapturas em:', SHOTS);
  console.log('ERROS DE CONSOLE:', errors.length ? errors.join('\n') : 'nenhum');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
