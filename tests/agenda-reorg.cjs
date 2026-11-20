// Teste de ponta a ponta da reorganização da agenda (iPhone emulado, toques simulados):
// cores por classificação, escolher com filtros, Plano B (toque triplo), deslizar para tirar,
// "o que você fez?", perguntar ao sobrepor (só atrasar o início do próximo), adiantar, terminar agora,
// desfazer/refazer.
// Uso: python3 -m http.server 8765  (na raiz do projeto)  e depois:  node tests/agenda-reorg.cjs
const { chromium, devices } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const SHOTS = process.env.SHOTS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'agentonator-reorg-'));
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
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `reorg-${n}.png`) });
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  async function drag(x0, y0, x1, y1, { hold = 480, steps = 8 } = {}) {
    await touch('touchStart', x0, y0);
    if (hold) await wait(hold);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await wait(22); }
    await touch('touchEnd');
    await wait(700);
  }
  const sheet = () => page.locator('.sheet-wrap.open').last();
  const asBtn = (text) => page.locator('.as-wrap.open .as-btn', { hasText: text });
  const block = (title) => page.locator('[data-view=agenda] .tl-b', { hasText: title });
  const box = (title) => block(title).boundingBox();
  const toastText = () => page.locator('#toast.show').innerText().catch(() => '');
  const save = async () => { await sheet().locator('[data-sheet=right]').click(); await wait(700); };
  const goDay = async (d) => { await page.locator('[data-ref=jump]').fill(dk(d)); await wait(450); };
  const day = (offset) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };
  const occs = (d) => page.evaluate(async (k) => {
    const { state } = await import('./js/store.js');
    const sch = await import('./js/schedule.js');
    const t = await import('./js/time.js');
    const ds = t.parseDateKey(k).getTime();
    const out = {};
    for (const o of sch.expand(state, ds, t.addDays(ds, 1))) out[o.title + (o.opt && o.opt.of > 1 ? ` [${o.opt.letter}]` : '')] = `${t.fmtRange(o.start, o.end)}${o.status === 'choose' ? ' ?' : ''}`;
    return out;
  }, dk(d));
  const S = (fn) => page.evaluate(async (src) => { const { state } = await import('./js/store.js'); return (0, eval)(src)(state); }, fn.toString());

  const D = day(2);   // dia futuro principal
  const D3 = day(3);  // outro dia futuro
  const Y = day(-1);  // ontem

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await wait(400);
  await page.evaluate(async ({ d, y }) => {
    const s = await import('./js/store.js');
    const t = await import('./js/time.js');
    const at = (k, h, m = 0) => t.atMinutes(k, h * 60 + m);
    await s.updateSettings({ installHintDismissed: true, backupSnoozeUntil: Date.now() + 7 * 24 * 3600e3 });
    const trilha = await s.savePlace({ name: 'Trilha Pedra Bonita', category: 'aventura' });
    await s.savePlace({ name: 'Biblioteca Nacional', category: 'cultura' });
    const bar = await s.savePlace({ name: 'Bar Astor', category: 'bares' });
    await s.savePlace({ name: 'Mirante Dona Marta', category: 'aventura', isDate: true });
    const teatro = await s.savePlace({ name: 'Theatro Municipal', category: 'cultura' });
    await s.savePlace({ name: 'Praça sem classe' });
    await s.saveEvent({ placeId: teatro.id, name: 'Quebra-Nozes' }); // sem data
    await s.saveVisit({ placeId: bar.id, start: at(d, 20), end: at(d, 22) });
    await s.saveItem({ title: 'Dormir', start: at(d, 0), end: at(d, 8) });
    await s.saveItem({ title: 'Terapia', start: at(d, 9), end: at(d, 10) });
    await s.saveCommitment({ name: 'Trabalho', kind: 'weekly', slots: [{ id: 'w', days: [t.parseDateKey(d).getDay()], startMin: 600, endMin: 780 }], startDate: t.dateKey(Date.now()) });
    await s.saveItem({ title: 'Trajeto', start: at(d, 13), end: at(d, 13, 45) });
    await s.saveItem({ title: 'Consulta', start: at(d, 13, 45), end: at(d, 14, 45) });
    await s.saveItem({ title: 'Mercado', start: at(d, 15), end: at(d, 16) });
    // ontem: uma academia (já feita) e um Plano B que ficou sem escolha
    await s.saveItem({ title: 'Academia', start: at(y, 7), end: at(y, 8) });
    // (criado amanhã e depois movido para ontem, como se o dia tivesse passado sem escolher)
    const tm = t.dateKey(t.addDays(t.startOfDay(Date.now()), 1));
    const v1 = await s.saveVisit({ placeId: trilha.id, start: at(tm, 17), end: at(tm, 19) });
    const bib = s.state.places.find((p) => p.name === 'Biblioteca Nacional');
    const v2 = await s.saveVisit({ placeId: bib.id, start: at(tm, 17), end: at(tm, 19) });
    const sch = await import('./js/schedule.js');
    await s.linkOption(sch.occByKey(s.state, `visit:${v1.id}`), `visit:${v2.id}`);
    await s.applyMoves([v1, v2].map((v) => ({ occ: sch.occByKey(s.state, `visit:${v.id}`), start: at(y, 17), end: at(y, 19) })));
  }, { d: dk(D), y: dk(Y) });
  await page.reload({ waitUntil: 'networkidle' });
  await wait(500);

  // ---------- 1) cores pela classificação ----------
  console.log('Cores por classificação');
  await goDay(D);
  const cls = async (t) => (await block(t).getAttribute('class')) || '';
  assert((await cls('Bar Astor')).includes('c-bares'), 'bar/restaurante em vermelho (c-bares)');
  assert((await cls('Trabalho')).includes('c-commitment') && (await cls('Terapia')).includes('c-item'), 'compromisso continua azul; horário avulso com cor própria');
  const barColor = await block('Bar Astor').evaluate((el) => getComputedStyle(el).borderLeftColor);
  assert(barColor === 'rgb(255, 69, 58)', `borda do bloco do bar é vermelha (${barColor})`);
  await shot('01-cores');

  // ---------- 2) adicionar Local pela agenda com filtros ----------
  console.log('Adicionar com filtros');
  await goDay(D3);
  let tl = await page.locator('[data-view=agenda] .tl').boundingBox();
  await page.locator('[data-view=agenda]').evaluate((el) => { el.scrollTop = 900; }); await wait(250);
  tl = await page.locator('[data-view=agenda] .tl').boundingBox();
  await page.touchscreen.tap(tl.x + 200, tl.y + 17 * 60 + 5); await wait(500); // 17:00
  await asBtn('Local (visita)').click(); await wait(500);
  assert(await sheet().locator('[data-chip=aventura]').count() === 1 && await sheet().locator('[data-chip=date]').count() === 1, 'escolha de local tem os filtros (classificação, ♥ Date, visitados…)');
  assert(await sheet().locator('[data-pick]').count() === 6, 'mostra todos os 6 locais');
  await sheet().locator('[data-chip=aventura]').click(); await wait(200);
  const aventuras = await sheet().locator('[data-pick] .row-title').allTextContents();
  assert(JSON.stringify(aventuras) === JSON.stringify(['Mirante Dona Marta', 'Trilha Pedra Bonita']), `filtro Aventura: ${aventuras.join(', ')}`);
  await shot('02-filtro-aventura');
  await sheet().locator('[data-pick]', { hasText: 'Trilha Pedra Bonita' }).click(); await wait(500);
  assert((await sheet().locator('.picker-label').innerText()) === 'Trilha Pedra Bonita' && (await sheet().locator('input[name=vTime]').inputValue()) === '17:00', 'formulário já vem com o local e o horário tocado');
  await save();
  assert((await occs(D3))['Trilha Pedra Bonita'] === '17:00–19:00', 'visita à trilha agendada 17:00–19:00');

  // evento já cadastrado (sem data) num horário
  await page.locator('[data-view=agenda]').evaluate((el) => { el.scrollTop = 900; }); await wait(250);
  tl = await page.locator('[data-view=agenda] .tl').boundingBox();
  await page.touchscreen.tap(tl.x + 200, tl.y + 20 * 60 + 5); await wait(500); // 20:00
  await asBtn('Evento').click(); await wait(500);
  assert(await sheet().locator('[data-chip=nodate].on').count() === 1 && (await sheet().locator('[data-pick]').allTextContents()).some((t) => t.includes('Quebra-Nozes')), 'escolha de evento abre em "Sem data" com o Quebra-Nozes');
  await sheet().locator('[data-pick]', { hasText: 'Quebra-Nozes' }).click(); await wait(500);
  assert((await sheet().locator('.sheet-title').innerText()) === 'Agendar evento' && (await sheet().locator('input[name=eTime]').inputValue()) === '20:00', 'evento existente aberto para agendar às 20:00');
  await save();
  assert((await occs(D3))['Quebra-Nozes'] === '20:00–22:00', 'Quebra-Nozes agendado (some do "Sem data" da aba Eventos)');

  // ---------- 3) Plano B com toque triplo ----------
  console.log('Plano B');
  let b = await box('Trilha Pedra Bonita');
  for (let i = 0; i < 3; i++) { await page.touchscreen.tap(b.x + b.width / 2, b.y + 30); await wait(90); }
  await wait(400);
  assert(await page.locator('.as-wrap.open .as-title').innerText() === 'Criar um Plano B para este horário?', 'toque triplo pergunta se quer criar um Plano B');
  assert(await page.locator('.sheet-wrap.open').count() === 0, 'e não abre a ficha do item');
  await shot('03-planob-pergunta');
  await asBtn('Opção B: Local').click(); await wait(500);
  await sheet().locator('[data-chip=cultura]').click(); await wait(200);
  await sheet().locator('[data-pick]', { hasText: 'Biblioteca Nacional' }).click(); await wait(500);
  assert((await sheet().locator('.sheet-title').innerText()) === 'Plano B: local' && (await sheet().locator('input[name=vTime]').inputValue()) === '17:00', 'formulário do Plano B já no mesmo horário');
  await save();
  assert(await page.locator('.as-wrap.open').count() === 0, 'nenhum aviso de conflito ao criar a opção B');
  let o = await occs(D3);
  console.log('   ', JSON.stringify(o));
  assert(o['Trilha Pedra Bonita [A]'] === '17:00–19:00' && o['Biblioteca Nacional [B]'] === '17:00–19:00', 'Opção A (trilha) e Opção B (biblioteca) no mesmo horário');
  const ba = await box('Trilha Pedra Bonita');
  const bb = await box('Biblioteca Nacional');
  assert(ba.x < bb.x && Math.abs(ba.y - bb.y) < 2, 'lado a lado, A à esquerda');
  assert(!(await cls('Trilha Pedra Bonita')).includes('conflict') && !(await cls('Biblioteca Nacional')).includes('conflict'), 'sem marca de sobreposição entre as opções');
  assert((await cls('Trilha Pedra Bonita')).includes('c-aventura') && (await cls('Biblioteca Nacional')).includes('c-cultura'), 'cada opção com a cor da sua classificação');
  assert(await block('Trilha Pedra Bonita').locator('.opt-tag').innerText() === 'A' && await block('Biblioteca Nacional').locator('.opt-tag').innerText() === 'B', 'etiquetas A e B nos blocos');
  await shot('04-planob');

  // ---------- 4) deslizar a opção A para a esquerda ----------
  b = await box('Trilha Pedra Bonita');
  await drag(b.x + b.width - 15, b.y + 40, b.x - 140, b.y + 42, { hold: 0 });
  o = await occs(D3);
  assert(!o['Trilha Pedra Bonita [A]'] && o['Biblioteca Nacional'] === '17:00–19:00', 'deslizar para a esquerda tirou a opção A; a biblioteca virou item normal');
  assert(/Opção A saiu · ficou “Biblioteca Nacional”/.test(await toastText()), 'aviso: "Opção A saiu · ficou Biblioteca Nacional"');
  assert(await S((s) => s.visits.filter((v) => v.optGroup && v.start > Date.now()).length) === 0, 'grupo desfeito (nada mais marcado como opção nesse dia)');

  // ---------- 5) desfazer / refazer ----------
  console.log('Desfazer / refazer');
  assert(!(await page.locator('[data-act=undo]').isDisabled()), 'botão ↶ ativo');
  await page.locator('[data-act=undo]').click(); await wait(500);
  o = await occs(D3);
  assert(o['Trilha Pedra Bonita [A]'] && o['Biblioteca Nacional [B]'], '↶ trouxe a opção A de volta (Plano B inteiro)');
  assert(/Desfeito/.test(await toastText()), 'aviso "Desfeito"');
  assert(!(await page.locator('[data-act=redo]').isDisabled()), 'botão ↷ ativo');
  await page.locator('[data-act=redo]').click(); await wait(500);
  assert(!(await occs(D3))['Trilha Pedra Bonita [A]'], '↷ refez (opção A saiu de novo)');
  await page.locator('[data-act=undo]').click(); await wait(400);
  await page.locator('[data-act=undo]').click(); await wait(400);
  o = await occs(D3);
  assert(!o['Biblioteca Nacional'] && !o['Biblioteca Nacional [B]'] && o['Trilha Pedra Bonita'] === '17:00–19:00', '↶ de novo desfaz a criação do Plano B (volta só a trilha)');
  await page.locator('[data-act=redo]').click(); await wait(400);
  assert((await occs(D3))['Biblioteca Nacional [B]'], '↷ recria o Plano B');

  // ---------- 6) Plano B de ontem que ficou sem escolha ----------
  console.log('Plano B sem escolha');
  await goDay(Y);
  o = await occs(Y);
  assert(o['Trilha Pedra Bonita [A]'] === '17:00–19:00 ?' && o['Biblioteca Nacional [B]'] === '17:00–19:00 ?', 'depois do horário, as duas opções ficam "escolha"');
  assert(/escolha a opção/.test(await page.locator('[data-ref=daytitle]').innerText()), 'o dia avisa "escolha a opção"');
  assert(await S((s) => s.history.filter((h) => h.kind === 'visit').length) === 0, 'nada vai para o Histórico enquanto houver duas opções');
  await page.locator('[data-view=agenda]').evaluate((el) => { el.scrollTop = 900; }); await wait(250);
  await shot('05-escolha');
  b = await box('Biblioteca Nacional');
  await page.touchscreen.tap(b.x + b.width / 2, b.y + 30); await wait(700);
  assert(/Já passou — qual você fez\?/.test(await sheet().innerText()), 'a ficha pergunta qual você fez');
  await sheet().locator('[data-act=keep-only]').click(); await wait(900);
  o = await occs(Y);
  assert(!o['Trilha Pedra Bonita [A]'] && o['Biblioteca Nacional'] === '17:00–19:00', '"Fiz esta opção" tira a outra');
  let hist = await S((s) => s.history.filter((h) => h.kind === 'visit').map((h) => h.title));
  assert(JSON.stringify(hist) === JSON.stringify(['Biblioteca Nacional']), `Histórico só com a biblioteca (${hist})`);
  assert(await S((s) => [s.places.find((p) => p.name === 'Biblioteca Nacional').visited, s.places.find((p) => p.name === 'Trilha Pedra Bonita').visited].join()) === 'true,false', 'biblioteca ficou visitada; a trilha não');
  await sheet().locator('[data-sheet=left]').click(); await wait(400);

  // ---------- 7) deslizar algo que já tinha acontecido -> "o que você fez?" ----------
  console.log('Substituir o que foi feito');
  await page.locator('[data-view=agenda]').evaluate((el) => { el.scrollTop = 380; }); await wait(250);
  b = await box('Academia');
  await drag(b.x + b.width - 15, b.y + 25, b.x - 140, b.y + 27, { hold: 0 });
  assert(await page.locator('.as-wrap.open .as-title').innerText() === 'O que você fez nesse horário?', 'pergunta o que você fez nesse horário');
  await shot('06-o-que-fez');
  await asBtn('Horário avulso').click(); await wait(500);
  assert((await sheet().locator('input[name=iTime]').inputValue()) === '07:00' && (await sheet().locator('[data-dur=duration] output').innerText()) === '1h', 'formulário já com 07:00 e 1h');
  await sheet().locator('input[name=title]').fill('Dormi mais');
  await save();
  hist = await S((s) => s.history.filter((h) => h.kind === 'item').map((h) => h.title));
  assert(hist.includes('Dormi mais') && !hist.includes('Academia'), 'Histórico: "Dormi mais" no lugar da academia');

  // ---------- 8) sobreposição: perguntar, com "só atrasar o início do próximo" ----------
  console.log('Perguntar ao sobrepor');
  await goDay(D);
  await page.locator('[data-view=agenda]').evaluate((el) => { el.scrollTop = 260; }); await wait(250);
  b = await box('Dormir');
  await drag(b.x + b.width / 2, b.y + b.height - 6, b.x + b.width / 2, b.y + b.height - 6 + 90);
  assert(await page.locator('.as-wrap.open .as-title').innerText() === 'Isso vai bater com outro horário', 'ao soltar em cima da terapia, o app pergunta');
  const opts = await page.locator('.as-wrap.open .as-btn').allInnerTexts();
  console.log('    opções:', JSON.stringify(opts.map((t) => t.replace(/\n/g, ' — '))));
  assert(opts.some((t) => /Adiar tudo o que vem depois/.test(t) && /Terapia → 09:30/.test(t) && /Trabalho → 10:30/.test(t)), 'opção "Adiar tudo o que vem depois" com prévia');
  assert(opts.some((t) => /Só atrasar o início de “Terapia”/.test(t) && /Terapia fica 09:30–10:00/.test(t)), 'opção "Só atrasar o início de Terapia" com prévia (09:30–10:00)');
  assert(opts.some((t) => /Manter sobreposto/.test(t)), 'opção "Manter sobreposto"');
  await shot('07-pergunta');
  await asBtn('Só atrasar o início').click(); await wait(800);
  o = await occs(D);
  console.log('   ', JSON.stringify(o));
  assert(o.Dormir === '00:00–09:30' && o.Terapia === '09:30–10:00' && o.Trabalho === '10:00–13:00', 'dormiu até 9:30, terapia ficou 9:30–10:00 e o resto não mudou');

  // cancelar volta como estava
  await block('Terapia').evaluate((el) => el.scrollIntoView({ block: 'center' })); await wait(250);
  b = await box('Terapia');
  await drag(b.x + b.width / 2, b.y + b.height - 5, b.x + b.width / 2, b.y + b.height - 5 + 45);
  await page.locator('.as-wrap.open .as-cancel').click(); await wait(600);
  assert((await occs(D)).Terapia === '09:30–10:00', 'Cancelar no aviso volta como estava');

  // ---------- 9) adiantar depois de encurtar ----------
  console.log('Adiantar');
  await block('Trajeto').evaluate((el) => el.scrollIntoView({ block: 'center' })); await wait(250);
  b = await box('Trajeto');
  await drag(b.x + b.width / 2, b.y + b.height - 6, b.x + b.width / 2, b.y + b.height - 6 - 30);
  let tt = await toastText();
  console.log('    aviso:', JSON.stringify(tt.replace(/\n/g, ' ')));
  assert(/Trajeto até 13:15/.test(tt) && /30 min livres/.test(tt) && /Adiantar/.test(tt), 'encurtar o trajeto mostra "30 min livres" com botão Adiantar');
  await page.locator('.toast-act').click(); await wait(500);
  const gapOpts = await page.locator('.as-wrap.open .as-btn').allInnerTexts();
  assert(gapOpts.some((t) => /Adiantar só “Consulta”/.test(t) && /13:15/.test(t)) && gapOpts.some((t) => /Adiantar tudo o que vem depois/.test(t)), 'oferece adiantar só a consulta ou tudo o que vem depois');
  await shot('08-adiantar');
  await asBtn('Adiantar tudo o que vem depois').click(); await wait(700);
  o = await occs(D);
  console.log('   ', JSON.stringify(o));
  assert(o.Consulta === '13:15–14:15' && o.Mercado === '14:30–15:30' && o['Bar Astor'] === '19:30–21:30', 'tudo o que vinha depois neste dia ficou 30 min mais cedo');
  assert(o.Terapia === '09:30–10:00' && o.Trabalho === '10:00–13:00', 'o que vinha antes não mudou');
  await page.locator('[data-act=undo]').click(); await wait(500);
  o = await occs(D);
  assert(o.Consulta === '13:45–14:45' && o['Bar Astor'] === '20:00–22:00' && o.Trajeto === '13:00–13:15', '↶ desfaz só o "adiantar" (o trajeto continua encurtado)');

  // tocar num horário vazio também oferece adiantar
  await page.evaluate(async (k) => {
    const s = await import('./js/store.js'); const t = await import('./js/time.js');
    await s.saveItem({ title: 'Café', start: t.atMinutes(k, 7 * 60), end: t.atMinutes(k, 7 * 60 + 30) });
    await s.saveItem({ title: 'Reunião', start: t.atMinutes(k, 9 * 60), end: t.atMinutes(k, 10 * 60) });
  }, dk(day(4)));
  await goDay(day(4));
  await page.locator('[data-view=agenda]').evaluate((el) => { el.scrollTop = 300; }); await wait(250);
  tl = await page.locator('[data-view=agenda] .tl').boundingBox();
  await page.touchscreen.tap(tl.x + 200, tl.y + 8 * 60 + 5); await wait(500);
  const slotOpts = await page.locator('.as-wrap.open .as-btn').allInnerTexts();
  assert(slotOpts.some((t) => /Adiantar só “Reunião”/.test(t) && /07:30/.test(t)), 'horário vazio: além de adicionar, oferece "Adiantar só Reunião" (para 07:30)');
  await asBtn('Adiantar só “Reunião”').click(); await wait(600);
  assert((await occs(day(4))).Reunião === '07:30–08:30', 'reunião adiantada para 07:30');

  // ---------- 10) terminei agora ----------
  console.log('Terminei agora');
  const now = new Date();
  if (now.getHours() >= 1 && now.getHours() <= 21) {
    await page.evaluate(async () => {
      const s = await import('./js/store.js');
      const n = Date.now();
      const q = 15 * 60e3;
      const st = Math.floor(n / q) * q - 30 * 60e3;
      await s.saveItem({ title: 'Estudo', start: st, end: st + 120 * 60e3 });
      await s.saveItem({ title: 'Almoço', start: st + 120 * 60e3, end: st + 180 * 60e3 });
    });
    await page.locator('[data-act=today]').click(); await wait(500);
    b = await box('Estudo');
    await page.touchscreen.tap(b.x + b.width / 2, b.y + 20); await wait(700);
    await sheet().locator('[data-act=finish]').click(); await wait(800);
    tt = await toastText();
    assert(/Estudo” encerrado às/.test(tt) && /Adiantar/.test(tt), '"Terminei agora" encerra e oferece adiantar');
    await page.locator('.toast-act').click(); await wait(500);
    await asBtn('Adiantar só “Almoço”').click(); await wait(700);
    const r = await page.evaluate(async () => { const { state } = await import('./js/store.js'); const e = state.items.find((i) => i.title === 'Estudo'); const a = state.items.find((i) => i.title === 'Almoço'); return { gapMin: (a.start - e.end) / 60e3, estudo: e.status }; });
    assert(r.gapMin === 0 && r.estudo === 'done', `almoço começa quando o estudo terminou; estudo concluído (${JSON.stringify(r)})`);
    await page.locator('.sheet-wrap.open [data-sheet=left]').click().catch(() => {}); await wait(300);
  } else {
    console.log('  (pulado: perto da meia-noite)');
  }

  // ---------- 11) ajustes e persistência ----------
  console.log('Ajustes e persistência');
  await page.click('[data-act=settings]'); await wait(500);
  assert(/Perguntar sempre \(recomendado\)/.test(await sheet().locator('[data-policy=ask]').innerText()) && await sheet().locator('[data-policy=ask] .i.accent').count() === 1, 'Ajustes: "Perguntar sempre (recomendado)" marcado');
  assert(await sheet().locator('[data-policy=trim]').count() === 1, 'nova opção "Só encurtar o vizinho"');
  await sheet().locator('[data-sheet=left]').click(); await wait(300);
  await page.reload({ waitUntil: 'networkidle' }); await wait(600);
  o = await occs(D);
  assert(o.Dormir === '00:00–09:30' && o.Terapia === '09:30–10:00' && o.Trajeto === '13:00–13:15', 'tudo salvo após reabrir');
  assert((await occs(D3))['Biblioteca Nacional [B]'] === '17:00–19:00', 'Plano B salvo após reabrir');
  await goDay(D3);
  await page.locator('[data-view=agenda]').evaluate((el) => { el.scrollTop = 900; }); await wait(250);
  await shot('09-final');

  console.log('\nCapturas em:', SHOTS);
  console.log('ERROS DE CONSOLE:', errors.length ? errors.join('\n') : 'nenhum');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
