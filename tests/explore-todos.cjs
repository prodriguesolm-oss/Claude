// Teste de ponta a ponta da versão 14 (iPhone emulado, toques simulados):
// abas (Afazeres, Explorar = Locais | Eventos, Favoritos por último), ★ ♥ ✓ em coluna, separação padrão
// "Não visitados / Visitados", ✓ de feito em eventos, Histórico mais limpo (detalhes no ⓘ, um local por dia),
// aba Afazeres, "Incluir em Afazeres", editar/excluir compromisso sem mexer no passado, e a virada da meia-noite.
// Uso: python3 -m http.server 8765  (na raiz do projeto)  e depois:  node tests/explore-todos.cjs
const { chromium, devices } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const SHOTS = process.env.SHOTS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'agentonator-v14-'));
const APP_URL = process.env.APP_URL || 'http://localhost:8765/';
function assert(c, m) { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); }
const pad = (n) => String(n).padStart(2, '0');
const dk = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (offset) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };

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
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `v14-${n}.png`) });
  const J = (x) => JSON.stringify(x);
  const tab = async (id) => { await page.click(`.tab[data-tab="${id}"]`); await wait(350); };
  const side = async (id) => { await page.click(`[data-act=side][data-side=${id}]:visible`); await wait(250); };
  const view = (id) => page.locator(`[data-view=${id}]`);
  const sheet = () => page.locator('.sheet-wrap.open').last();
  const asBtn = (text) => page.locator('.as-wrap.open .as-btn', { hasText: text });
  const S = (fn) => page.evaluate(async (src) => { const { state } = await import('./js/store.js'); return (0, eval)(src)(state); }, fn.toString());
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  async function drag(x0, y0, x1, y1, { hold = 480, steps = 10 } = {}) {
    await touch('touchStart', x0, y0); if (hold) await wait(hold);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await wait(25); }
    await touch('touchEnd'); await wait(700);
  }
  const occsOf = (d) => page.evaluate(async (k) => {
    const { state } = await import('./js/store.js'); const sch = await import('./js/schedule.js'); const t = await import('./js/time.js');
    const ds = t.parseDateKey(k).getTime();
    return Object.fromEntries(sch.expand(state, ds, t.addDays(ds, 1)).map((o) => [o.title, t.fmtRange(o.start, o.end)]));
  }, dk(d));

  const Y = day(-1);
  const T0 = day(0);
  const D2 = day(2);

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await wait(400);
  await page.evaluate(async ({ y, t0, d2, w3 }) => {
    const s = await import('./js/store.js'); const t = await import('./js/time.js');
    const at = (k, h, m = 0) => t.atMinutes(k, h * 60 + m);
    await s.updateSettings({ installHintDismissed: true, backupSnoozeUntil: Date.now() + 7 * 864e5 });
    const trilha = await s.savePlace({ name: 'Trilha Pedra Bonita', category: 'aventura', favorite: true });
    const theatro = await s.savePlace({ name: 'Theatro Municipal', category: 'cultura', favorite: true, isDate: true });
    const paq = await s.savePlace({ name: 'Ilha de Paquetá', category: 'aventura', isDate: true });
    await s.savePlace({ name: 'Confeitaria Colombo com um nome comprido', category: 'bares' });
    // o caso do Paquetá: visita na agenda ontem 12:30–16:00 + "visitado" marcado à mão às 15:26 do mesmo dia
    await s.saveVisit({ placeId: paq.id, start: at(y, 12, 30), end: at(y, 16) });
    // como ficou no iPhone: o ✓ "visitado" tocado às 15:26 (com a visita ainda em andamento) gerou um registro à parte
    const db = await import('./js/db.js');
    await db.tx([{ type: 'put', store: 'history', value: { id: `h:place:${paq.id}`, kind: 'place', refId: paq.id, placeId: paq.id, title: paq.name, subtitle: '', category: 'aventura', start: null, end: null, at: at(y, 15, 26), source: 'manual' } }]);
    await s.saveEvent({ placeId: theatro.id, name: 'Orquestra Sinfônica', start: at(d2, 19), end: at(d2, 21) });
    await s.saveEvent({ placeId: theatro.id, name: 'Quebra-Nozes' }); // sem data
    await s.saveEvent({ placeId: trilha.id, name: 'Corrida na trilha', start: at(y, 7), end: at(y, 9) }); // já passou
    await s.saveVisit({ placeId: trilha.id, start: at(t0, 22), end: at(t0, 23) });
    await s.saveItem({ title: 'Comprar presente', start: at(d2, 10), end: at(d2, 11), todo: true });
    await s.saveItem({ title: 'Dormir', start: at(d2, 0), end: at(d2, 8, 30) });
    await s.saveCommitment({ name: 'Trabalho', kind: 'daily', slots: [{ id: 'w', startMin: 9 * 60, endMin: 9 * 60 + 30 }], startDate: t0 });
    // terapia semanal, toda semana no mesmo dia da semana de ontem, desde 3 semanas atrás
    const c = await s.saveCommitment({ name: 'Terapia', kind: 'weekly', slots: [{ id: 's1', days: [t.parseDateKey(y).getDay()], startMin: 10 * 60, endMin: 11 * 60 }], startDate: w3 });
    window.__terapiaId = c.id;
  }, { y: dk(Y), t0: dk(T0), d2: dk(D2), w3: dk(day(-22)) });
  await page.reload({ waitUntil: 'networkidle' });
  await wait(600);

  // ---------- 1) abas ----------
  console.log('Abas');
  const tabs = await page.locator('.tab span').allInnerTexts();
  assert(J(tabs) === J(['Agenda', 'Afazeres', 'Explorar', 'Compromissos', 'Favoritos', 'Histórico']), `ordem das abas: ${tabs.join(' | ')}`);

  // ---------- 2) Explorar ----------
  console.log('Explorar');
  await tab('explore');
  assert(await view('places').isVisible() && !(await view('events').isVisible()), 'abre em Locais');
  const segs = (await page.locator('.seg2-btn:visible').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
  assert(J(segs) === J(['Locais 4', 'Eventos 3']), `alternador no topo com os números (${J(segs)})`);
  assert(J(await view('places').locator('.sec-h span').allTextContents()) === J(['Não visitados', 'Visitados']), 'Locais: por padrão, não visitados e depois visitados');
  const tg = await view('places').locator('.row').first().locator('.tgls .tgl').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; }));
  assert(tg.length === 3 && tg[0][0] === tg[1][0] && tg[1][0] === tg[2][0] && tg[0][1] < tg[1][1] && tg[1][1] < tg[2][1], `★ ♥ ✓ em coluna (${J(tg)})`);
  await shot('01-explorar-locais');
  await side('events');
  assert(await view('events').isVisible() && !(await view('places').isVisible()), 'toque em "Eventos" mostra os eventos');
  let secs = await view('events').locator('.sec-h span').allTextContents();
  assert(J(secs) === J(['Não visitados', 'Visitados']), 'Eventos: mesma separação (não visitados / visitados)');
  let names = await view('events').locator('.row .row-title').allInnerTexts();
  assert(J(names) === J(['Orquestra Sinfônica', 'Quebra-Nozes', 'Corrida na trilha']), `não visitados: com data primeiro, depois sem data; visitados embaixo (${names})`);
  assert(await view('events').locator('.row', { hasText: 'Orquestra' }).locator('.thumb').count() === 1, 'evento mostra a foto (ou iniciais) do local');
  // ✓ num evento sem data
  await view('events').locator('.row', { hasText: 'Quebra-Nozes' }).locator('[data-act=event-done]').click(); await wait(400);
  names = await view('events').locator('.row .row-title').allInnerTexts();
  assert(names.indexOf('Quebra-Nozes') > names.indexOf('Orquestra Sinfônica') && (await S((s) => s.history.filter((h) => h.kind === 'event').map((h) => h.title))).includes('Quebra-Nozes'), '✓ marca o evento como feito: vai para Visitados e para o Histórico');
  assert(await S((s) => s.places.find((p) => p.name === 'Theatro Municipal').visited) === true, 'e o local fica visitado');
  await shot('02-explorar-eventos');
  await view('events').locator('.row', { hasText: 'Quebra-Nozes' }).locator('[data-act=event-done]').click(); await wait(400);
  assert(!(await S((s) => s.history.some((h) => h.title === 'Quebra-Nozes'))) && await S((s) => s.events.find((e) => e.name === 'Quebra-Nozes').status) === 'planned', 'tocar de novo desfaz (volta a sem data, sai do Histórico)');
  // desmarcar um evento que já passou: vira "não aconteceu" e não volta sozinho
  await view('events').locator('.row', { hasText: 'Corrida' }).locator('[data-act=event-done]').click(); await wait(400);
  await page.reload({ waitUntil: 'networkidle' }); await wait(500);
  assert(await S((s) => s.events.find((e) => e.name === 'Corrida na trilha').status) === 'missed', 'desmarcar um evento passado = "não aconteceu" (a conclusão automática não marca de novo)');
  await tab('explore');
  assert(await view('places').isVisible(), 'ao reabrir, Explorar começa em Locais');
  await side('events');
  await view('events').locator('.sort-btn').click(); await wait(400);
  await asBtn('Por data').click(); await wait(400);
  assert(J(await view('events').locator('.sec-h span').allTextContents()) === J(['Próximos', 'Sem data', 'Passados']), 'ordem "Por data" mostra a separação antiga (próximos / sem data / passados)');

  // ---------- 3) Histórico ----------
  console.log('Histórico');
  await tab('history');
  const rows = await view('history').locator('.hrow').count();
  const paqRows = await view('history').locator('.hrow', { hasText: 'Ilha de Paquetá' }).count();
  assert(paqRows === 1, `o mesmo local aparece uma vez só no dia (Paquetá: ${paqRows}; linhas: ${rows})`);
  assert(await view('history').locator('.row-right').count() === 0 && await view('history').locator('.hrow .info-btn').count() === rows, 'sem horário/origem à direita; cada linha tem o botão ⓘ');
  const thumb = await view('history').locator('.hrow .thumb').first().boundingBox();
  assert(Math.round(thumb.width) === 46, `foto um pouco maior (${Math.round(thumb.width)}px)`);
  await shot('03-historico');
  await view('history').locator('.hrow', { hasText: 'Ilha de Paquetá' }).locator('.info-btn').click(); await wait(400);
  const msg = await page.locator('.as-wrap.open .as-msg').innerText();
  console.log('     detalhes:', JSON.stringify(msg.replace(/\n/g, ' / ')));
  assert(/12:30–16:00/.test(msg) && /concluído automaticamente/.test(msg) && /visitado às 15:26/.test(msg), 'detalhes mostram os dois registros (visita 12:30–16:00 automática e o "visitado" marcado às 15:26)');
  await shot('04-historico-detalhes');
  await page.locator('.as-wrap.open .as-cancel').click(); await wait(300);

  // ---------- 4) Afazeres ----------
  console.log('Afazeres');
  await tab('todos');
  const todayHead = await view('todos').locator('[data-today]').boundingBox();
  const headBox = await view('todos').locator('.vh').boundingBox();
  assert(Math.abs(todayHead.y - (headBox.y + headBox.height)) < 30, `abre em "Hoje" (Hoje em ${Math.round(todayHead.y)}, fim do topo em ${Math.round(headBox.y + headBox.height)})`);
  const allTitles = await view('todos').locator('.occ-row .row-title').allInnerTexts();
  assert(allTitles.includes('Orquestra Sinfônica') && allTitles.includes('Trilha Pedra Bonita') && allTitles.includes('Ilha de Paquetá'), 'visitas e eventos da agenda aparecem (inclusive o de ontem, mais acima)');
  assert(!allTitles.includes('Trabalho') && !allTitles.includes('Terapia') && !allTitles.includes('Dormir'), 'compromissos e avulsos sem "Incluir em Afazeres" não aparecem');
  assert(allTitles.includes('Comprar presente'), 'avulso com "Incluir em Afazeres" aparece');
  const order = await view('todos').locator('.sec-h span').allTextContents();
  assert(order.indexOf('Ontem') < order.indexOf('Hoje') && order.indexOf('Hoje') < order.indexOf('Amanhã') + (order.includes('Amanhã') ? 0 : 99), `dias em ordem, o passado acima (${order.slice(0, 5).join(', ')})`);
  await shot('05-afazeres');
  // ligar "Incluir em Afazeres" na terapia
  await tab('commitments');
  await view('commitments').locator('.row', { hasText: 'Terapia' }).click(); await wait(500);
  assert(await sheet().locator('input[name=todo]').count() === 1 && !(await sheet().locator('input[name=todo]').isChecked()), 'cadastro do compromisso tem "Incluir em Afazeres" (desligado por padrão)');
  await sheet().locator('input[name=todo]').evaluate((el) => el.closest('label').click()); await wait(150);
  await sheet().locator('[data-sheet=right]').click(); await wait(700);
  await tab('todos');
  const withTherapy = await view('todos').locator('.occ-row .row-title').allInnerTexts();
  assert(withTherapy.includes('Terapia'), 'depois de ligar, a terapia aparece em Afazeres');
  await view('todos').locator('[data-chip=commitment]').click(); await wait(250);
  const onlyC = [...new Set(await view('todos').locator('.occ-row .row-title').allInnerTexts())];
  assert(J(onlyC) === J(['Terapia']), 'filtro "Compromissos"');
  await view('todos').locator('[data-act=clear-facets]').click(); await wait(200);
  await view('todos').locator('.occ-row', { hasText: 'Orquestra' }).first().click(); await wait(600);
  assert(await sheet().count() === 1 && /Orquestra/.test(await sheet().innerText()), 'tocar num afazer abre a ficha (como na agenda)');
  await sheet().locator('[data-sheet=left]').click(); await wait(300);

  // ---------- 5) editar / excluir compromisso não mexe no passado ----------
  console.log('Compromissos: o passado fica como estava');
  const before = (await occsOf(Y)).Terapia;
  await tab('commitments');
  await view('commitments').locator('.row', { hasText: 'Terapia' }).click(); await wait(500);
  await sheet().locator('input[data-f=start]').first().fill('14:00');
  await sheet().locator('input[data-f=end]').first().fill('15:00');
  await sheet().locator('[data-sheet=right]').click(); await wait(700);
  if (await page.locator('.as-wrap.open').count()) await page.locator('.as-wrap.open .as-btn').first().click();
  await wait(400);
  const nextWeek = day(6);
  assert(before === '10:00–11:00' && (await occsOf(Y)).Terapia === '10:00–11:00', 'a terapia de ontem continua 10:00–11:00');
  assert((await occsOf(nextWeek)).Terapia === '14:00–15:00', 'a da semana que vem já é 14:00–15:00');
  await view('commitments').locator('.row', { hasText: 'Terapia' }).click(); await wait(500);
  await sheet().locator('[data-act=delete]').click(); await wait(400);
  const dlgText = await page.locator('.alert').last().innerText();
  assert(/já aconteceram continuam/.test(dlgText), 'o aviso de excluir explica que o que já aconteceu continua na agenda');
  await page.locator('.alert-btn', { hasText: 'Excluir' }).click(); await wait(600);
  assert((await occsOf(Y)).Terapia === '10:00–11:00' && !(await occsOf(nextWeek)).Terapia, 'excluir: a de ontem continua na agenda; as próximas saem');
  assert(await view('commitments').locator('.row', { hasText: 'Terapia' }).count() === 0, 'e ela sai da lista de Compromissos');

  // ---------- 6) agenda: atravessar a meia-noite ----------
  console.log('Agenda: virada da meia-noite');
  await tab('agenda');
  await page.locator('[data-ref=jump]').fill(dk(D2)); await wait(500);
  await page.locator('[data-view=agenda]').evaluate((el) => { el.scrollTop = 0; }); await wait(300);
  assert(await view('agenda').locator('.tl-ext').count() === 2 && /noite/i.test(await view('agenda').locator('.tl-ext').first().innerText()), 'o dia mostra o fim da noite anterior (e a madrugada seguinte)');
  const firstHour = (await view('agenda').locator('.tl-hour span').first().innerText()).trim();
  assert(firstHour === '22:00', `do dia anterior, só a partir das 22:00 (${firstHour})`);
  const b = await view('agenda').locator('.tl-b', { hasText: 'Dormir' }).boundingBox();
  await drag(b.x + b.width / 2, b.y + 60, b.x + b.width / 2, b.y + 60 - 60);
  if (await page.locator('.as-wrap.open').count()) await page.locator('.as-wrap.open .as-cancel').click();
  const dormir = await S((s) => { const i = s.items.find((x) => x.title === 'Dormir'); return [new Date(i.start).getHours(), new Date(i.start).getDate(), new Date(i.end).getHours(), new Date(i.end).getMinutes()]; });
  const prevDate = day(1).getDate();
  assert(dormir[0] === 23 && dormir[1] === prevDate && dormir[2] === 7 && dormir[3] === 30, `arrastar "Dormir" para cima: começa 23:00 da véspera e termina 07:30 (${J(dormir)})`);
  await shot('06-meia-noite');
  await page.locator('[data-ref=jump]').fill(dk(day(1))); await wait(500);
  const dm = await view('agenda').locator('.tl-b', { hasText: 'Dormir' });
  assert(await dm.count() === 1 && /23:00–07:30/.test(await dm.innerText()), 'no dia anterior ele aparece às 23:00, atravessando a meia-noite');

  console.log('\nCapturas em:', SHOTS);
  console.log('ERROS DE CONSOLE:', errors.length ? errors.join('\n') : 'nenhum');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
