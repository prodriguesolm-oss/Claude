// Teste de ponta a ponta dos filtros múltiplos (numa linha) e da ordenação (iPhone emulado):
// aba Locais (visitados / não visitados · ★ e ♥ juntos · categorias), escolha de local pela agenda,
// e aba Histórico (só locais e eventos, foto do local, filtros e ordenação).
// Uso: python3 -m http.server 8765  (na raiz do projeto)  e depois:  node tests/lists-filters.cjs
const { chromium, devices } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const SHOTS = process.env.SHOTS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'agentonator-filtros-'));
const APP_URL = process.env.APP_URL || 'http://localhost:8765/';
function assert(c, m) { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); }
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 15'], deviceScaleFactor: 1, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `filtros-${n}.png`) });
  const tab = async (id) => { await page.click(`.tab[data-tab="${id}"]`); await wait(300); };
  const view = (id) => page.locator(`[data-view=${id}]`);
  const chip = (id, v) => view(id).locator(`[data-chip="${v}"]`);
  const chipN = async (id, v) => Number(await chip(id, v).locator('small').innerText());
  const placeNames = () => view('places').locator('.row .row-title').allInnerTexts();
  const histTitles = () => view('history').locator('.hrow .row-title').allInnerTexts();
  const asBtn = (text) => page.locator('.as-wrap.open .as-btn', { hasText: text });
  const sheet = () => page.locator('.sheet-wrap.open').last();
  const J = (x) => JSON.stringify(x);

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await wait(400);
  await page.evaluate(async ({ png }) => {
    const s = await import('./js/store.js'); const t = await import('./js/time.js'); const db = await import('./js/db.js');
    const pause = () => new Promise((r) => setTimeout(r, 8));
    await s.updateSettings({ installHintDismissed: true, backupSnoozeUntil: Date.now() + 7 * 864e5 });
    const mk = async (name, category, extra = {}, photo) => { const p = await s.savePlace({ name, category, ...extra }, photo); await pause(); return p; };
    const A = await mk('Trilha Pedra Bonita', 'aventura', { favorite: true });
    const B = await mk('Theatro Municipal', 'cultura', { favorite: true, isDate: true }, { thumb: png, full: png });
    const C = await mk('Bar Astor', 'bares', { isDate: true });
    const D = await mk('Museu do Amanhã', 'cultura');
    await mk('Mirante Dona Marta', 'aventura', { favorite: true, isDate: true });
    await mk('Feira da Glória', 'outros');
    await mk('Confeitaria Colombo', 'bares', { favorite: true });
    await s.setPlaceVisited(A.id, true);
    await s.setPlaceVisitedDate(C.id, Date.now() - 5 * 864e5);
    const y = t.dateKey(t.addDays(Date.now(), -2));
    await s.saveEvent({ placeId: B.id, name: 'Orquestra Sinfônica', start: t.atMinutes(y, 19 * 60), end: t.atMinutes(y, 21 * 60) });
    await s.saveVisit({ placeId: D.id, start: t.atMinutes(y, 10 * 60), end: t.atMinutes(y, 12 * 60) });
    await s.saveItem({ title: 'Mercado', start: t.atMinutes(y, 8 * 60), end: t.atMinutes(y, 9 * 60) });
    // registro de horário avulso que a versão 10 tinha colocado no Histórico
    await db.tx([{ type: 'put', store: 'history', value: { id: 'h:item:antigo', kind: 'item', refId: 'antigo', title: 'Shopping (antigo)', subtitle: '', start: Date.now() - 3 * 864e5, end: Date.now() - 3 * 864e5 + 36e5, at: Date.now() - 3 * 864e5, source: 'auto' } }]);
  }, { png: PNG });
  await page.reload({ waitUntil: 'networkidle' });
  await wait(500);

  // ---------- 1) Locais: filtros numa linha só, vários ao mesmo tempo ----------
  console.log('Locais — filtros');
  await tab('places');
  assert(await view('places').locator('.facets').count() === 1 && await view('places').locator('.facets [data-facet]').count() === 8, 'uma linha só com os 8 filtros');
  const counts = {};
  for (const v of ['todo', 'visited', 'fav', 'date', 'cultura', 'aventura', 'bares', 'outros']) counts[v] = await chipN('places', v);
  // visitados: trilha e bar (marcados) + theatro e museu (o evento e a visita já passaram → automático)
  assert(J(counts) === J({ todo: 3, visited: 4, fav: 4, date: 3, cultura: 2, aventura: 2, bares: 2, outros: 1 }), `contagens ${J(counts)}`);
  await chip('places', 'todo').click(); await wait(200);
  assert(J(await placeNames()) === J(['Confeitaria Colombo', 'Feira da Glória', 'Mirante Dona Marta']), 'Não visitados');
  assert((await view('places').locator('[data-ref=count]').innerText()) === '3 de 7', 'contador "3 de 7"');
  assert(await chipN('places', 'fav') === 2 && await chipN('places', 'date') === 1, 'contagens dos outros filtros já consideram "não visitados"');
  assert(await view('places').locator('.facets > :first-child').getAttribute('data-act') === 'clear-facets', '"Limpar" aparece no começo da linha');
  await chip('places', 'visited').click(); await wait(200);
  const bothOn = (await chip('places', 'todo').getAttribute('class')).includes(' on') && (await chip('places', 'visited').getAttribute('class')).includes(' on');
  assert(bothOn && (await placeNames()).length === 7, 'Visitados + Não visitados: os dois ficam ligados (mostra os dois)');
  await chip('places', 'todo').click(); await wait(200);
  assert(J(await placeNames()) === J(['Bar Astor', 'Museu do Amanhã', 'Theatro Municipal', 'Trilha Pedra Bonita']), 'tocar de novo tira só aquele (fica Visitados)');
  await chip('places', 'visited').click(); await wait(200);
  assert((await placeNames()).length === 7, 'sem filtros: todos');
  await chip('places', 'fav').click(); await wait(200);
  assert(J(await placeNames()) === J(['Confeitaria Colombo', 'Mirante Dona Marta', 'Theatro Municipal', 'Trilha Pedra Bonita']), '★ Favoritos');
  await chip('places', 'date').click(); await wait(200);
  assert(J(await placeNames()) === J(['Mirante Dona Marta', 'Theatro Municipal']), '+ ♥ Date: só os que são favorito E date');
  await shot('01-locais-dois-filtros');
  await chip('places', 'aventura').click(); await wait(200);
  assert(J(await placeNames()) === J(['Mirante Dona Marta']), '+ Aventura');
  await chip('places', 'cultura').click(); await wait(200);
  const twoCats = (await chip('places', 'aventura').getAttribute('class')).includes(' on') && (await chip('places', 'cultura').getAttribute('class')).includes(' on');
  assert(twoCats && J(await placeNames()) === J(['Mirante Dona Marta', 'Theatro Municipal']), '+ Cultura: as duas categorias ficam ligadas (aventura ou cultura)');
  await shot('01b-locais-quatro-filtros');
  await chip('places', 'aventura').click(); await wait(200);
  assert(J(await placeNames()) === J(['Theatro Municipal']), 'tirar a Aventura deixa os outros filtros como estavam');
  await chip('places', 'visited').click(); await wait(200);
  assert(J(await placeNames()) === J(['Theatro Municipal']), '+ Visitados: visitado E favorito E date E cultura');
  // o chip tocado não "pula" de lugar quando o "Limpar" entra ou sai no começo da linha
  await view('places').locator('[data-act=clear-facets]').click(); await wait(200);
  await view('places').locator('.facets').evaluate((el) => { el.scrollLeft = el.scrollWidth; }); await wait(150);
  const xBefore = (await chip('places', 'outros').boundingBox()).x;
  await chip('places', 'outros').click(); await wait(250);
  const xAfter = (await chip('places', 'outros').boundingBox()).x;
  assert(Math.abs(xAfter - xBefore) < 3 && J(await placeNames()) === J(['Feira da Glória']), `o chip tocado fica no lugar (${Math.round(xBefore)} → ${Math.round(xAfter)})`);
  await view('places').locator('[data-act=clear-facets]').click(); await wait(200);
  assert((await placeNames()).length === 7 && await view('places').locator('.facets .chip.on').count() === 0, '"Limpar" tira todos os filtros');

  // ---------- 2) Locais: ordenar ----------
  console.log('Locais — ordenar');
  assert((await view('places').locator('.sort-btn').innerText()).trim() === 'A–Z', 'ordem padrão: nome (A–Z)');
  await view('places').locator('.sort-btn').click(); await wait(400);
  const sortOpts = await page.locator('.as-wrap.open .as-btn:not(.as-cancel)').allInnerTexts();
  assert(sortOpts.length === 6 && /✓ Nome \(A–Z\)/.test(sortOpts[0]), `menu "Ordenar por" (${sortOpts.join(' | ')})`);
  await shot('02-ordenar');
  await asBtn('Adicionados recentemente').click(); await wait(500);
  assert(J((await placeNames()).slice(0, 3)) === J(['Confeitaria Colombo', 'Feira da Glória', 'Mirante Dona Marta']), 'Adicionados recentemente: o último cadastrado primeiro');
  await page.reload({ waitUntil: 'networkidle' }); await wait(500);
  await tab('places');
  assert((await view('places').locator('.sort-btn').innerText()).trim() === 'Recentes' && (await placeNames())[0] === 'Confeitaria Colombo', 'a ordem escolhida fica guardada');
  await view('places').locator('.sort-btn').click(); await wait(400);
  await asBtn('Visitados recentemente').click(); await wait(500);
  assert(J((await placeNames()).slice(0, 4)) === J(['Trilha Pedra Bonita', 'Theatro Municipal', 'Museu do Amanhã', 'Bar Astor']), 'Visitados recentemente: trilha (hoje), theatro e museu (anteontem), bar (há 5 dias)');
  await view('places').locator('.sort-btn').click(); await wait(400);
  await asBtn('Por categoria').click(); await wait(500);
  const secs = await view('places').locator('.sec-h span').allTextContents();
  assert(J(secs) === J(['Cultura', 'Aventura', 'Bares e restaurantes', 'Outros']), `Por categoria: blocos ${J(secs)}`);
  await chip('places', 'date').click(); await wait(200);
  assert(J(await view('places').locator('.sec-h span').allTextContents()) === J(['Cultura', 'Aventura', 'Bares e restaurantes']), 'filtro + ordem juntos (♥ Date por categoria)');
  await shot('03-por-categoria');
  await chip('places', 'date').click(); await wait(200);
  await view('places').locator('.sort-btn').click(); await wait(400);
  await asBtn('Nome (A–Z)').click(); await wait(500);

  // ---------- 3) escolha de local pela agenda: mesmo modelo de filtro ----------
  console.log('Escolher local pela agenda');
  await tab('agenda');
  await view('agenda').locator('.fab').click(); await wait(400);
  await asBtn('Local (visita)').click(); await wait(500);
  assert(await sheet().locator('.facets [data-facet]').count() === 8 && await sheet().locator('.sort-btn').count() === 1, 'a escolha tem os mesmos filtros (numa linha) e o botão de ordenar');
  await sheet().locator('[data-chip=fav]').click(); await wait(150);
  await sheet().locator('[data-chip=date]').click(); await wait(150);
  let picks = await sheet().locator('[data-pick] .row-title').allInnerTexts();
  assert(J(picks) === J(['Mirante Dona Marta', 'Theatro Municipal']), `★ Favoritos E ♥ Date (${picks})`);
  await sheet().locator('[data-chip=todo]').click(); await wait(150);
  picks = await sheet().locator('[data-pick] .row-title').allInnerTexts();
  assert(J(picks) === J(['Mirante Dona Marta']), '+ Não visitados');
  await sheet().locator('[data-chip=todo]').click(); await wait(150);
  await sheet().locator('[data-chip=aventura]').click(); await wait(150);
  picks = await sheet().locator('[data-pick] .row-title').allInnerTexts();
  assert(J(picks) === J(['Mirante Dona Marta']), '+ Aventura');
  await shot('04-escolha-local');
  await sheet().locator('[data-sheet=left]').click(); await wait(400);

  // ---------- 4) Histórico ----------
  console.log('Histórico');
  await tab('history');
  let titles = await histTitles();
  console.log('    ', J(titles));
  assert(titles.length === 4 && !titles.some((t) => /Mercado|Shopping/.test(t)), 'só locais e eventos (sem horários avulsos, nem o registro antigo)');
  assert(await page.evaluate(async () => (await import('./js/store.js')).state.history.filter((h) => h.kind === 'item').length) === 0, 'registro antigo de avulso apagado');
  assert(await view('history').locator('.hrow', { hasText: 'Orquestra' }).locator('img.thumb').count() === 1, 'evento mostra a foto do local (Theatro)');
  const stats = (await view('history').locator('.stats .stat').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
  assert(J(stats) === J(['4locais visitados', '1eventos feitos', '5total']), `contadores: locais, eventos e total = locais + eventos (${J(stats)})`);
  assert(await view('history').locator('.hrow', { hasText: 'Museu' }).locator('.thumb.ph').count() === 1, 'local sem foto mostra as iniciais, como na aba Locais');
  assert(J(titles) === J(['Trilha Pedra Bonita', 'Orquestra Sinfônica', 'Museu do Amanhã', 'Bar Astor']) || J(titles) === J(['Trilha Pedra Bonita', 'Museu do Amanhã', 'Orquestra Sinfônica', 'Bar Astor']), 'ordem padrão: mais recentes primeiro');
  await shot('05-historico');
  assert(await view('history').locator('.facets').count() === 1 && await view('history').locator('.facets [data-facet]').count() === 8, 'uma linha de filtros: tipo · ★/♥ · categorias');
  const hc = {};
  for (const v of ['place', 'event', 'fav', 'date', 'cultura', 'aventura', 'bares']) hc[v] = await chipN('history', v);
  assert(J(hc) === J({ place: 3, event: 1, fav: 1, date: 1, cultura: 2, aventura: 1, bares: 1 }), `contagens ${J(hc)}`);
  await chip('history', 'event').click(); await wait(200);
  assert(J(await histTitles()) === J(['Orquestra Sinfônica']), 'só Eventos');
  await chip('history', 'event').click(); await wait(200);
  await chip('history', 'cultura').click(); await wait(200);
  titles = await histTitles();
  assert(titles.length === 2 && titles.includes('Orquestra Sinfônica') && titles.includes('Museu do Amanhã'), 'Cultura: a orquestra (pelo local) e o museu');
  await chip('history', 'aventura').click(); await wait(200);
  titles = await histTitles();
  assert(titles.length === 3 && titles.includes('Trilha Pedra Bonita'), 'Cultura + Aventura: as duas ficam ligadas');
  await chip('history', 'event').click(); await wait(200);
  assert(J(await histTitles()) === J(['Orquestra Sinfônica']), '+ Eventos: eventos de cultura ou aventura');
  await chip('history', 'event').click(); await wait(200);
  await chip('history', 'aventura').click(); await wait(200);
  await chip('history', 'cultura').click(); await wait(200);
  await chip('history', 'date').click(); await wait(200);
  assert(J(await histTitles()) === J(['Bar Astor']), '♥ Date');
  await chip('history', 'date').click(); await wait(200);
  await view('history').locator('.sort-btn').click(); await wait(400);
  await asBtn('Mais antigos').click(); await wait(500);
  titles = await histTitles();
  assert(titles[0] === 'Bar Astor' && titles[3] === 'Trilha Pedra Bonita', 'Mais antigos primeiro');
  await view('history').locator('.sort-btn').click(); await wait(400);
  await asBtn('Nome (A–Z)').click(); await wait(500);
  assert(J(await histTitles()) === J(['Bar Astor', 'Museu do Amanhã', 'Orquestra Sinfônica', 'Trilha Pedra Bonita']) && await view('history').locator('.sec-h').count() === 0, 'Nome (A–Z), lista corrida');
  await view('history').locator('.sort-btn').click(); await wait(400);
  await asBtn('Por categoria').click(); await wait(500);
  assert(J(await view('history').locator('.sec-h span').allTextContents()) === J(['Cultura', 'Aventura', 'Bares e restaurantes']), 'Por categoria');
  await shot('06-historico-categoria');
  await page.reload({ waitUntil: 'networkidle' }); await wait(500);
  await tab('history');
  assert((await view('history').locator('.sort-btn').innerText()).trim() === 'Categoria', 'ordem do Histórico guardada (separada da de Locais)');
  await tab('places');
  assert((await view('places').locator('.sort-btn').innerText()).trim() === 'A–Z', 'Locais continua em A–Z');

  console.log('\nCapturas em:', SHOTS);
  console.log('ERROS DE CONSOLE:', errors.length ? errors.join('\n') : 'nenhum');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
