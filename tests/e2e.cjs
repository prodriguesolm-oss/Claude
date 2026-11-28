// Teste de ponta a ponta num iPhone emulado (Playwright + Chromium).
// Uso: python3 -m http.server 8765  (na raiz do projeto)  e depois:  node tests/e2e.cjs
// Variáveis: APP_URL (padrão http://localhost:8765/), SHOTS_DIR (pasta das capturas, padrão: pasta temporária)
const { chromium, devices } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const SHOTS = process.env.SHOTS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'agentonator-'));
const APP_URL = process.env.APP_URL || 'http://localhost:8765/';
const PHOTO = path.join(SHOTS, 'test-photo.png');
const pad = n => String(n).padStart(2, '0');
const dk = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
function assert(c, m) { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `e2e-${n}.png`) });
  const sheet = () => page.locator('.sheet-wrap.open').last();
  // Locais e Eventos agora ficam na aba Explorar (alternador no topo)
  const tab = async (id) => {
    if (id === 'places' || id === 'events') {
      await page.click('.tab[data-tab="explore"]'); await page.waitForTimeout(250);
      await page.click(`[data-act=side][data-side=${id}]:visible`); await page.waitForTimeout(150);
    } else await page.click(`.tab[data-tab="${id}"]`);
  };
  const save = async () => { await sheet().locator('[data-sheet="right"]').click(); await page.waitForTimeout(450); };
  const view = (id) => page.locator(`[data-view="${id}"]`);
  const goDay = async (d) => { await page.locator('[data-ref=jump]').fill(dk(d)); await page.waitForTimeout(350); };

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  assert(await page.locator('.hint-card').count() === 1, 'aviso de instalação aparece no iPhone (Safari)');
  await shot('01-agenda-hint');
  await page.click('[data-act="dismiss-hint"]');
  // este roteiro cobre o modo "Perguntar sempre"; o padrão ("adiar o que vem depois") é coberto em tests/agenda-drag.cjs
  await page.evaluate(async () => (await import('./js/store.js')).updateSettings({ conflictPolicy: 'ask' }));

  // ---------- Locais ----------
  console.log('Locais');
  await tab('places');
  await shot('02-places-empty');
  await view('places').locator('.fab').click();
  await page.waitForTimeout(400);
  await sheet().locator('input[name=name]').fill('Teatro Municipal');
  await sheet().locator('textarea[name=address]').fill('Praça Floriano, s/n - Centro, Rio de Janeiro');
  await sheet().locator('[data-seg=category] button[data-v=cultura]').click();
  await page.evaluate(() => new Promise((res) => { const c = document.createElement('canvas'); c.width = 1200; c.height = 800; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 1200, 800); g.addColorStop(0, '#ff9f0a'); g.addColorStop(1, '#bf5af2'); x.fillStyle = g; x.fillRect(0, 0, 1200, 800); window.__png = c.toDataURL('image/png'); res(); }));
  fs.writeFileSync(PHOTO, Buffer.from((await page.evaluate(() => window.__png)).split(',')[1], 'base64'));
  await sheet().locator('input[type=file]').setInputFiles(PHOTO);
  await page.waitForTimeout(700);
  await shot('03-place-form');
  await save();

  // segundo local com visita agendada para amanhã 09:00
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  await view('places').locator('.fab').click(); await page.waitForTimeout(400);
  await sheet().locator('input[name=name]').fill('Trilha da Vista Chinesa');
  await sheet().locator('textarea[name=address]').fill('Estrada da Vista Chinesa, Alto da Boa Vista');
  await sheet().locator('[data-seg=category] button[data-v=aventura]').click();
  await sheet().locator('label.cell:has(input[name=schedule]) .sw').click();
  await sheet().locator('input[name=vDate]').fill(dk(tomorrow));
  await sheet().locator('input[name=vTime]').fill('09:00');
  await sheet().locator('[data-durset=duration][data-v="180"]').click();
  await save();

  for (const n of ['Museu do Amanhã', 'Parque Lage', 'Jardim Botânico']) {
    await view('places').locator('.fab').click(); await page.waitForTimeout(350);
    await sheet().locator('input[name=name]').fill(n);
    await save();
  }
  const rows = await view('places').locator('.row').count();
  assert(rows === 5, `5 locais listados (${rows})`);
  // favoritar e marcar visitado direto na linha
  await view('places').locator('.row:has-text("Parque Lage") [data-act=fav]').click();
  await view('places').locator('.row:has-text("Jardim Botânico") [data-act=visited]').click();
  await page.waitForTimeout(300);
  await shot('04-places-list');
  // busca
  await view('places').locator('input[name=q]').fill('tri');
  await page.waitForTimeout(150);
  assert(await view('places').locator('.row').count() === 1, 'busca "tri" encontra só a Trilha');
  await view('places').locator('input[name=q]').fill('jard bot');
  await page.waitForTimeout(150);
  await view('places').locator('[data-act=clear-q]').click();
  // detalhe
  await view('places').locator('.row:has-text("Teatro Municipal") .row-main').click();
  await page.waitForTimeout(600);
  await shot('05-place-detail');
  await sheet().locator('[data-sheet=left]').click(); await page.waitForTimeout(400);

  // ---------- Eventos ----------
  console.log('Eventos');
  await tab('events');
  await view('events').locator('.fab').click(); await page.waitForTimeout(400);
  // salvar sem local -> deve recusar
  await sheet().locator('[data-sheet=right]').click(); await page.waitForTimeout(300);
  assert(await page.locator('.sheet-wrap.open').count() === 1, 'evento sem local não é salvo');
  await sheet().locator('[data-act=pick-place]').click(); await page.waitForTimeout(400);
  await sheet().locator('input[name=q]').fill('teatro');
  await sheet().locator('[data-pick]').first().click(); await page.waitForTimeout(400);
  await sheet().locator('input[name=name]').fill('Ópera Carmen');
  // terça que vem 10:30 (vai bater com a terapia)
  const tue = new Date(); tue.setDate(tue.getDate() + ((2 - tue.getDay() + 7) % 7 || 7));
  await sheet().locator('input[name=eDate]').fill(dk(tue));
  await sheet().locator('input[name=eTime]').fill('19:00');
  await sheet().locator('[data-seg=category] button[data-v=cultura]').click();
  await shot('06-event-form');
  await save();
  await view('events').locator('.fab').click(); await page.waitForTimeout(400);
  await sheet().locator('[data-act=pick-place]').click(); await page.waitForTimeout(400);
  await sheet().locator('[data-pick]').nth(1).click(); await page.waitForTimeout(300);
  await sheet().locator('label.cell:has(input[name=schedule]) .sw').click(); // sem data
  await sheet().locator('input[name=name]').fill('Piquenique (sem data)');
  await save();
  assert(await view('events').locator('.row').count() === 2, '2 eventos listados');
  await shot('07-events-list');

  // ---------- Compromissos ----------
  console.log('Compromissos');
  await tab('commitments');
  await view('commitments').locator('.fab').click(); await page.waitForTimeout(400);
  await sheet().locator('input[name=name]').fill('Terapia');
  const slot = sheet().locator('.slot').first();
  // limpar dia pré-selecionado e escolher terça
  for (const b of await slot.locator('.slot-days .dchip.on').all()) await b.click();
  await slot.locator('.dchip[data-day="2"]').click();
  await slot.locator('[data-f=start]').fill('10:00');
  await slot.locator('[data-f=end]').fill('11:00');
  await sheet().locator('[data-act=add-slot]').click();
  const slot2 = sheet().locator('.slot').nth(1);
  await slot2.locator('.dchip[data-day="1"]').click();
  await slot2.locator('.dchip[data-day="4"]').click();
  await slot2.locator('[data-f=start]').fill('06:30');
  await slot2.locator('[data-f=end]').fill('07:30');
  await shot('08-commitment-form');
  await save();
  if (await page.locator('.alert-wrap').count()) { await page.locator('.alert-btn.strong').click(); await page.waitForTimeout(400); }
  // trabalho seg a sex 10-13 (vai sobrepor a terapia de terça -> alerta)
  await view('commitments').locator('.fab').click(); await page.waitForTimeout(400);
  await sheet().locator('input[name=name]').fill('Trabalho');
  const s3 = sheet().locator('.slot').first();
  for (const b of await s3.locator('.slot-days .dchip.on').all()) await b.click();
  for (const d of [1,2,3,4,5]) await s3.locator(`.dchip[data-day="${d}"]`).click();
  await s3.locator('[data-f=start]').fill('13:00');
  await s3.locator('[data-f=end]').fill('17:00');
  await save();
  if (await page.locator('.alert-wrap').count()) { await page.locator('.alert-btn.strong').click(); await page.waitForTimeout(400); }
  // diário: remédio 08:00–08:15
  await view('commitments').locator('.fab').click(); await page.waitForTimeout(400);
  await sheet().locator('input[name=name]').fill('Remédio');
  await sheet().locator('[data-seg=kind] button[data-v=daily]').click();
  assert(await sheet().locator('.slot-days').first().isHidden() && await sheet().locator('.slot-mdays').first().isHidden(), 'diário não pede dias');
  await sheet().locator('.slot [data-f=start]').fill('08:00');
  await sheet().locator('.slot [data-f=end]').fill('08:15');
  await save();
  if (await page.locator('.alert-wrap').count()) { await page.locator('.alert-btn.strong').click(); await page.waitForTimeout(400); }
  // mensal: aluguel dia 5, 10:00–10:30
  await view('commitments').locator('.fab').click(); await page.waitForTimeout(400);
  await sheet().locator('input[name=name]').fill('Pagar aluguel');
  await sheet().locator('[data-seg=kind] button[data-v=monthly]').click();
  const ms = sheet().locator('.slot').first();
  for (const b of await ms.locator('.slot-mdays .dchip.on').all()) await b.click();
  await ms.locator('.dchip[data-mday="5"]').click();
  await ms.locator('[data-f=start]').fill('10:00');
  await ms.locator('[data-f=end]').fill('10:30');
  await shot('08b-commitment-monthly');
  await save();
  if (await page.locator('.alert-wrap').count()) { await page.locator('.alert-btn.strong').click(); await page.waitForTimeout(400); }
  assert(await view('commitments').locator('.row').count() === 4, '4 compromissos listados');
  const secs = await view('commitments').locator('.sec-h span').allTextContents();
  assert(JSON.stringify(secs) === JSON.stringify(['Diários', 'Semanais', 'Mensais']), `agrupados por frequência ${JSON.stringify(secs)}`);
  assert(await view('commitments').locator('[data-act=fav]').count() === 0, 'compromissos não têm estrela de favorito');
  await view('commitments').locator('[data-chip=monthly]').click(); await page.waitForTimeout(150);
  assert(await view('commitments').locator('.row').count() === 1, 'filtro "Mensais" mostra só o aluguel');
  await view('commitments').locator('[data-chip=all]').click(); await page.waitForTimeout(150);
  await shot('09-commitments-list');

  // ---------- Agenda ----------
  console.log('Agenda');
  await tab('agenda');
  await goDay(tue);
  const blocksTue = await view('agenda').locator('.tl-b').allInnerTexts();
  console.log('   blocos terça:', blocksTue.map(t => t.replace(/\n/g,' | ')));
  assert(blocksTue.some(t => t.includes('Terapia')), 'Terapia aparece na terça');
  assert(blocksTue.some(t => t.includes('Ópera')), 'Ópera aparece na terça');
  await view('agenda').evaluate(el => el.scrollTop = 680);
  await shot('10-agenda-tuesday');

  // adiar a terapia desta terça em +1 dia
  await view('agenda').locator('.tl-b:has-text("Terapia")').click(); await page.waitForTimeout(500);
  await shot('11-occ-sheet');
  await sheet().locator('[data-shift="1440"]').click(); await page.waitForTimeout(600);
  await sheet().locator('[data-sheet=left]').click(); await page.waitForTimeout(400);
  const afterTue = await view('agenda').locator('.tl-b').allInnerTexts();
  assert(!afterTue.some(t => t.includes('Terapia')), 'terapia saiu desta terça');
  await page.click('[data-act=next-week]'); await page.waitForTimeout(300);
  const nextTue = await view('agenda').locator('.tl-b').allInnerTexts();
  assert(nextTue.some(t => t.includes('Terapia')), 'terapia continua na terça da semana seguinte');
  await page.click('[data-act=prev-week]'); await page.waitForTimeout(300);
  const wed = new Date(tue); wed.setDate(wed.getDate() + 1);
  await goDay(wed);
  const wedBlocks = await view('agenda').locator('.tl-b').allInnerTexts();
  assert(wedBlocks.some(t => t.includes('Terapia')), 'terapia foi para quarta (só esta semana)');
  const n = await page.evaluate(async () => (await import('./js/store.js')).state.commitments.length);
  assert(n === 4, 'nenhum compromisso novo foi criado ao adiar');

  // conflito: novo evento na quarta 10:30 bate com a terapia (10:00-11:00)
  await view('agenda').locator('.fab').click(); await page.waitForTimeout(400);
  await page.locator('.as-btn:has-text("Evento")').click(); await page.waitForTimeout(400);
  assert(await sheet().locator('.sheet-title').innerText() === 'Escolher evento', 'pela agenda, "Evento" abre a escolha com busca e filtros');
  await sheet().locator('[data-act=new]').click(); await page.waitForTimeout(500); // "Criar novo evento"
  await sheet().locator('[data-act=pick-place]').click(); await page.waitForTimeout(400);
  await sheet().locator('[data-pick]').first().click(); await page.waitForTimeout(300);
  await sheet().locator('input[name=name]').fill('Visita guiada');
  await sheet().locator('input[name=eDate]').fill(dk(wed));
  await sheet().locator('input[name=eTime]').fill('10:30');
  await sheet().locator('[data-durset=duration][data-v="60"]').click();
  await sheet().locator('[data-sheet=right]').click(); await page.waitForTimeout(500);
  assert(await page.locator('.as-wrap').count() === 1, 'aviso de conflito apareceu');
  await shot('12-conflict');
  const conflictOpts = await page.locator('.as-wrap.open .as-btn').allInnerTexts();
  assert(conflictOpts.some(t => t.includes('Colocar “Visita guiada” depois')) && conflictOpts.some(t => t.includes('Manter sobreposto')), 'aviso oferece colocar o novo depois ou manter sobreposto');
  await page.locator('.as-btn:has-text("Só adiantar o fim de “Terapia”")').click(); await page.waitForTimeout(700);
  const wedAfter = await view('agenda').locator('.tl-b').allInnerTexts();
  console.log('   quarta após conflito:', wedAfter.map(t => t.replace(/\n/g,' | ')));
  const terapiaRange = await page.evaluate(async (k) => {
    const { state } = await import('./js/store.js'); const sch = await import('./js/schedule.js'); const t = await import('./js/time.js');
    const ds = t.parseDateKey(k).getTime(); const o = sch.expand(state, ds, t.addDays(ds, 1)).find((x) => x.title === 'Terapia');
    return o && t.fmtRange(o.start, o.end);
  }, dk(wed));
  assert(terapiaRange === '10:00–10:30', `terapia terminou mais cedo (${terapiaRange}) para caber a visita`);

  // arrastar (toque longo) a "Visita guiada" 1h para baixo
  const cdp = await ctx.newCDPSession(page);
  const box = await view('agenda').locator('.tl-b:has-text("Visita guiada")').boundingBox();
  const x = box.x + box.width / 2, y = box.y + 10;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(520);
  for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + i * 20 }] }); await page.waitForTimeout(30); }
  await shot('13-dragging');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(700);
  if (await page.locator('.as-wrap.open').count()) { await page.locator('.as-btn:has-text("Manter sobreposto")').click(); await page.waitForTimeout(600); }
  const dragged = await view('agenda').locator('.tl-b').allInnerTexts();
  console.log('   após arrastar:', dragged.map(t => t.replace(/\n/g,' | ')));
  assert(dragged.some(t => t.includes('Visita guiada') && t.includes('12:30')), 'arrastar moveu o evento para 12:30 (com o empurrão em cascata)'.replace(' (com o empurrão em cascata)',''));

  // horário avulso pela agenda (só título e hora)
  await view('agenda').locator('.fab').click(); await page.waitForTimeout(400);
  await page.locator('.as-btn:has-text("Horário avulso")').click(); await page.waitForTimeout(400);
  await sheet().locator('input[name=title]').fill('Shopping Leblon — comprar roupa');
  await sheet().locator('input[name=iDate]').fill(dk(wed));
  await sheet().locator('input[name=iTime]').fill('18:00');
  await sheet().locator('[data-durset=duration][data-v="120"]').click();
  await shot('13b-item-form');
  await save();
  if (await page.locator('.as-wrap.open').count()) { await page.locator('.as-btn:has-text("Manter sobreposto")').click(); await page.waitForTimeout(500); }
  assert(await view('agenda').locator('.tl-b.k-item:has-text("Shopping Leblon")').count() === 1, 'horário avulso aparece na agenda');
  await view('agenda').locator('.tl-b.k-item').click(); await page.waitForTimeout(500);
  await shot('13c-item-sheet');
  await sheet().locator('[data-shift="60"]').click(); await page.waitForTimeout(500);
  await sheet().locator('[data-sheet=left]').click(); await page.waitForTimeout(400);
  assert((await view('agenda').locator('.tl-b.k-item').innerText()).includes('19:00'), 'horário avulso adiado em 1h');

  // modo lista
  await page.click('[data-mode=list]'); await page.waitForTimeout(300);
  await shot('14-agenda-list');
  await page.click('[data-mode=day]');

  // ---------- Favoritos / Histórico ----------
  console.log('Favoritos e Histórico');
  await tab('favorites'); await page.waitForTimeout(300);
  assert(await view('favorites').locator('.row').count() >= 1, 'favoritos mostra o Parque Lage');
  await shot('15-favorites');
  await tab('history'); await page.waitForTimeout(300);
  assert(await view('history').locator('.hrow').count() === 1, 'histórico tem o Jardim Botânico (visitado manualmente)');
  await shot('16-history');

  // ---------- persistência ----------
  console.log('Persistência');
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(700);
  const counts = await page.evaluate(async () => { const { state } = await import('./js/store.js'); return [state.places.length, state.events.length, state.commitments.length, state.history.length, state.places.filter(p => p.favorite).length, state.items.length]; });
  assert(JSON.stringify(counts) === JSON.stringify([5, 3, 4, 1, 1, 1]), `após recarregar, dados intactos ${JSON.stringify(counts)}`);
  const photoOk = await page.evaluate(async () => { const s = await import('./js/store.js'); const p = s.state.places.find(x => x.name === 'Teatro Municipal'); return !!(p.thumb && await s.getPhoto(p.id)); });
  assert(photoOk, 'foto do local continua salva');

  // auto-conclusão: evento no passado entra no histórico
  await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const p = s.state.places.find(x => x.name === 'Museu do Amanhã');
    const now = Date.now();
    await s.saveEvent({ placeId: p.id, name: 'Exposição (passado)', start: now - 3 * 3600e3, end: now - 2 * 3600e3 });
  });
  await page.waitForTimeout(300);
  const auto = await page.evaluate(async () => { const { state } = await import('./js/store.js'); return [state.history.length, state.places.find(x => x.name === 'Museu do Amanhã').visited]; });
  assert(auto[0] === 2 && auto[1] === true, 'evento que já passou foi concluído automaticamente e o local ficou visitado');
  await tab('history'); await page.waitForTimeout(300);
  await shot('17-history-auto');

  // ---------- offline ----------
  console.log('Offline');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'networkidle' });
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const offlineOk = await page.evaluate(async () => { const { state } = await import('./js/store.js'); return document.querySelectorAll('.tab').length === 6 && state.places.length === 5; });
  assert(offlineOk, 'app abre sem internet, com todos os dados');
  await ctx.setOffline(false);

  console.log('\nCapturas em:', SHOTS);
  console.log('ERROS DE CONSOLE:', errors.length ? errors.join('\n') : 'nenhum');
  await browser.close();
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
