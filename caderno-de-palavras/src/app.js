// ---------- utilidades ----------
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CLS = {v:'verbo', sf:'substantivo feminino', sm:'substantivo masculino', adj:'adjetivo', adv:'advérbio'};
const clsName = c => CLS[c] || c || '';
const pad = n => String(n).padStart(2, '0');
const strip = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const clone = o => JSON.parse(JSON.stringify(o));
const LETTERS = 'ABCDE';
const UNLOCK_HOUR = 6;
const REVIEW_WORDS = 5;

function seedFrom(str){ let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++){ h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); return (h ^= h >>> 16) >>> 0; }
function rngFrom(str){ let a = seedFrom(str); return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shuffle(arr, rng){ const a = arr.slice(); for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

// O "dia" do caderno vira às 6h (hora local): antes disso ainda vale o dia anterior.
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayKey = (d = new Date()) => keyOf(new Date(d.getTime() - UNLOCK_HOUR * 3600e3));
function dayDate(k){ const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); }
const fmtDay = k => dayDate(k).toLocaleDateString('pt-BR', {weekday:'long', day:'numeric', month:'long'});
const fmtShort = k => dayDate(k).toLocaleDateString('pt-BR', {day:'numeric', month:'short'}).replace('.', '');
function nextUnlock(){ const n = new Date(), t = new Date(n); t.setHours(UNLOCK_HOUR, 0, 0, 0); if (t <= n) t.setDate(t.getDate() + 1); return t; }
function countdown(){ const ms = nextUnlock() - new Date(); const h = Math.floor(ms / 3600e3), m = Math.floor(ms % 3600e3 / 60e3); return h > 0 ? `em ${h} h ${pad(m)} min` : `em ${m} min`; }

// ---------- palavras ----------
const BY_ID = Object.fromEntries(BANK.map(w => [w.id, w]));
const BANK_IDS = BANK.map(w => w.id);
let EXTRA = {};
const word = id => BY_ID[id] || EXTRA[id] || null;
const allIds = () => BANK_IDS.concat(Object.keys(EXTRA).filter(id => !BY_ID[id]));

const CONJ_OVR = {
  coibir:{pres:['coíbo','coíbe','coibimos','coíbem'], perf:['coibi','coibiu','coibimos','coibiram'], imp:['coibia','coibia','coibíamos','coibiam'], part:'coibido', ger:'coibindo'},
  titubear:{pres:['titubeio','titubeia','titubeamos','titubeiam'], perf:['titubeei','titubeou','titubeamos','titubearam'], imp:['titubeava','titubeava','titubeávamos','titubeavam'], part:'titubeado', ger:'titubeando'},
  auferir:{pres:['aufiro','aufere','auferimos','auferem'], perf:['auferi','auferiu','auferimos','auferiram'], imp:['auferia','auferia','auferíamos','auferiam'], part:'auferido', ger:'auferindo'},
  indeferir:{pres:['indefiro','indefere','indeferimos','indeferem'], perf:['indeferi','indeferiu','indeferimos','indeferiram'], imp:['indeferia','indeferia','indeferíamos','indeferiam'], part:'indeferido', ger:'indeferindo'}
};
function conjugate(inf){
  const stem = inf.slice(0, -2), end = inf.slice(-2);
  if (end === 'ar'){
    let s1 = stem;
    if (stem.endsWith('c')) s1 = stem.slice(0, -1) + 'qu';
    else if (stem.endsWith('g')) s1 = stem + 'u';
    else if (stem.endsWith('ç')) s1 = stem.slice(0, -1) + 'c';
    return {pres:[stem+'o', stem+'a', stem+'amos', stem+'am'], perf:[s1+'ei', stem+'ou', stem+'amos', stem+'aram'], imp:[stem+'ava', stem+'ava', stem+'ávamos', stem+'avam'], part:stem+'ado', ger:stem+'ando'};
  }
  let s0 = stem;
  if (stem.endsWith('c')) s0 = stem.slice(0, -1) + 'ç';
  else if (stem.endsWith('g')) s0 = stem.slice(0, -1) + 'j';
  if (end === 'er') return {pres:[s0+'o', stem+'e', stem+'emos', stem+'em'], perf:[stem+'i', stem+'eu', stem+'emos', stem+'eram'], imp:[stem+'ia', stem+'ia', stem+'íamos', stem+'iam'], part:stem+'ido', ger:stem+'endo'};
  if (end === 'ir') return {pres:[s0+'o', stem+'e', stem+'imos', stem+'em'], perf:[stem+'i', stem+'iu', stem+'imos', stem+'iram'], imp:[stem+'ia', stem+'ia', stem+'íamos', stem+'iam'], part:stem+'ido', ger:stem+'indo'};
  return null;
}
const conjOf = w => w.verb ? (w.conj || CONJ_OVR[w.verb] || conjugate(w.verb)) : null;

// ---------- estado e gravação ----------
const LS_KEY = 'caderno-palavras-v1', LS_EXTRA = 'caderno-palavras-extra-v1';
const freshState = () => ({v:1, known:[], learned:[], pending:[], stats:{}, daysDone:[], today:null, updatedAt:0});
function lsGet(k){ try { const t = localStorage.getItem(k); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
function lsSet(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
function sane(s){ const f = freshState(); if (!s || typeof s !== 'object') return f; for (const k of Object.keys(f)) if (s[k] === undefined) s[k] = f[k]; return s; }

let S = sane(lsGet(LS_KEY));
let DB = null, SYNC = lsSet('caderno-palavras-probe', 1) ? 'local' : 'none';
let writing = false, dirty = false;
async function save(){
  S.updatedAt = Date.now();
  lsSet(LS_KEY, S);
  if (!DB) return;
  if (writing){ dirty = true; return; }
  writing = true;
  try { await DB.doc('progress/main').set(clone(S)); SYNC = 'cloud'; }
  catch (e) { if (e && (e.code === 'invalid_argument' || e.code === 'revoked' || e.code === 'not_granted')){ DB = null; SYNC = 'local'; } else SYNC = 'retry'; }
  writing = false;
  renderMeta();
  if (dirty){ dirty = false; save(); }
}

// ---------- ciclo diário ----------
const isLearned = id => S.learned.some(l => l.id === id);
const usable = id => !!word(id) && !S.known.includes(id) && !isLearned(id);
function isFresh(id){ return usable(id) && !S.pending.includes(id) && !(S.today && S.today.options.includes(id)); }

function topUp(){
  const t = S.today;
  const rng = rngFrom(`pool|${t.day}|${S.known.length}|${t.options.length}`);
  const fresh = shuffle(allIds().filter(isFresh), rng);
  while (t.options.length < 5 && fresh.length) t.options.push(fresh.shift());
  while (t.options.length < 5 && S.pending.length){ const id = S.pending.shift(); if (usable(id) && !t.options.includes(id)){ t.options.push(id); t.carried.push(id); } }
}
function ensureDay(){
  const k = dayKey();
  if (S.today && S.today.day === k){ if (S.today.stage === 'pick') topUp(); return false; }
  if (S.today){
    const left = S.today.options.filter(id => id !== S.today.chosen && usable(id));
    S.pending = S.pending.filter(id => !left.includes(id)).concat(left);
  }
  S.pending = S.pending.filter(usable);
  // até 3 palavras que ficaram de dias anteriores + novas até completar 5
  const carried = S.pending.slice(0, 3);
  S.pending = S.pending.slice(3);
  S.today = {day:k, options:carried.slice(), carried:carried.slice(), chosen:null, stage:'pick', attempt:0, quiz:null, result:null, reviewIds:[]};
  topUp();
  return true;
}
function reviewIdsFor(t){
  const prev = S.learned.filter(l => !(l.day === t.day && l.id === t.chosen));
  const ids = [];
  for (let i = prev.length - 1; i >= 0 && ids.length < REVIEW_WORDS; i--){ const id = prev[i].id; if (!ids.includes(id) && word(id)) ids.push(id); }
  return ids;
}
function streak(){
  const set = new Set(S.daysDone); const d = dayDate(dayKey()); let n = 0;
  if (!set.has(keyOf(d))) d.setDate(d.getDate() - 1);
  while (set.has(keyOf(d))){ n++; d.setDate(d.getDate() - 1); }
  return n;
}

// ---------- perguntas ----------
function wordQuestions(w, rng){
  const out = [];
  const others = shuffle(BANK_IDS.filter(id => id !== w.id), rng).slice(0, 3).map(id => BY_ID[id].g);
  out.push({t:'mc', k:'Significado', p:`O que significa “${w.w}”?`, o:shuffle([w.g, ...others], rng), a:w.g, e:w.def});
  const typedIdx = Math.floor(rng() * w.q.length);
  w.q.forEach((c, i) => {
    if (i === typedIdx) out.push({t:'type', k:'Escreva a forma certa', p:c[0], hint:c[4] || w.w, a:c[1], e:c[3], cz:true});
    else out.push({t:'mc', k:'Complete a frase', p:c[0], o:shuffle([c[1], ...c[2]], rng), a:c[1], e:c[3], cz:true});
  });
  out.push({t:'mc', k:'Uso correto', p:`Em qual frase “${w.w}” foi usada do jeito certo?`, o:shuffle([w.u[0], ...w.u[1]], rng), a:w.u[0], e:w.u[2]});
  return out;
}
function buildQuiz(t){
  const rng = rngFrom(`quiz|${t.day}|${t.chosen}|${t.attempt}`);
  const qs = [];
  const w = word(t.chosen);
  if (w){ const own = wordQuestions(w, rng); const first = own.shift(); [first, ...shuffle(own, rng)].forEach(q => { q.sec = 'hoje'; q.wid = w.id; qs.push(q); }); }
  const rev = [];
  for (const id of t.reviewIds){
    const rw = word(id); if (!rw) continue;
    const pool = wordQuestions(rw, rng);
    const a = pick(pool.filter(q => q.cz), rng);
    const b = pick(pool.filter(q => q !== a), rng);
    [a, b].forEach(q => { q.sec = 'rev'; q.wid = id; rev.push(q); });
  }
  return qs.concat(shuffle(rev, rng));
}
let Q = null;
function quiz(){ if (!Q && S.today && S.today.quiz) Q = buildQuiz(S.today); return Q; }

// ---------- ações ----------
let VIEW = {tab:'hoje', peek:null};
function choose(id){
  const t = S.today; if (t.chosen || !word(id)) return;
  t.chosen = id; t.stage = 'learn';
  S.learned.push({id, day:t.day, score:null});
  save(); render(true);
}
function unchoose(){
  const t = S.today; if (t.stage !== 'learn') return;
  S.learned = S.learned.filter(l => !(l.id === t.chosen && l.day === t.day));
  t.chosen = null; t.stage = 'pick';
  save(); render(true);
}
function markKnown(id){
  const t = S.today, w = word(id); if (!w) return;
  const snap = {options:t.options.slice(), carried:t.carried.slice(), pending:S.pending.slice()};
  if (!S.known.includes(id)) S.known.push(id);
  t.options = t.options.filter(x => x !== id);
  S.pending = S.pending.filter(x => x !== id);
  topUp(); save(); render();
  toast(`“${w.w}” não será mais sugerida.`, 'Desfazer', () => {
    S.known = S.known.filter(x => x !== id);
    t.options = snap.options; t.carried = snap.carried; S.pending = snap.pending;
    save(); render();
  });
}
function restoreKnown(id){ S.known = S.known.filter(x => x !== id); if (!S.pending.includes(id)) S.pending.push(id); save(); render(); toast(`“${word(id).w}” volta a aparecer nas sugestões.`); }
function startQuiz(){
  const t = S.today; if (!t.chosen) return;
  t.reviewIds = reviewIdsFor(t);
  t.attempt = (t.attempt || 0) + 1;
  t.stage = 'quiz'; t.quiz = {i:0, res:[], ans:[], acc:[]}; t.result = null;
  Q = buildQuiz(t);
  save(); render(true);
}
function checkTyped(q, val){
  const n = norm(val), a = norm(q.a);
  if (n === a) return {ok:true};
  if (strip(n) === strip(a)) return {ok:true, accent:true};
  return {ok:false};
}
function answer(val){
  const t = S.today, qz = t.quiz, q = quiz()[qz.i];
  if (!q || qz.res[qz.i] !== undefined) return;
  let ok, accent = false;
  if (q.t === 'mc') ok = val === q.a;
  else { if (!norm(val)) return; const r = checkTyped(q, val); ok = r.ok; accent = !!r.accent; }
  qz.res[qz.i] = ok; qz.ans[qz.i] = String(val); qz.acc[qz.i] = accent;
  const st = S.stats[q.wid] || (S.stats[q.wid] = {ok:0, err:0});
  ok ? st.ok++ : st.err++;
  save(); render();
  setTimeout(() => { const b = document.getElementById('btn-next'); if (b) b.focus({preventScroll:true}); }, 30);
}
function next(){
  const t = S.today, qz = t.quiz, qs = quiz();
  if (qz.res[qz.i] === undefined) return;
  if (qz.i < qs.length - 1){ qz.i++; save(); render(true); return; }
  let th = 0, tt = 0, rh = 0, rt = 0;
  qs.forEach((q, i) => { if (q.sec === 'hoje'){ tt++; if (qz.res[i]) th++; } else { rt++; if (qz.res[i]) rh++; } });
  t.result = {hoje:[th, tt], rev:[rh, rt]};
  t.stage = 'done';
  const le = S.learned.find(l => l.id === t.chosen && l.day === t.day);
  if (le && !le.score) le.score = [th, tt];
  if (!S.daysDone.includes(t.day)) S.daysDone.push(t.day);
  save(); render(true);
}

// ---------- voz ----------
const CAN_SPEAK = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
function speak(text){
  if (!CAN_SPEAK) return;
  try {
    const u = new SpeechSynthesisUtterance(String(text).replace(/\*/g, ''));
    u.lang = 'pt-BR'; u.rate = 0.9;
    const vs = speechSynthesis.getVoices();
    const v = vs.find(v => /^pt[-_]BR/i.test(v.lang)) || vs.find(v => /^pt/i.test(v.lang));
    if (v) u.voice = v;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch (e) {}
}
const SPK = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor"/><path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.3 3.6a6 6 0 0 1 0 8.8" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>';

// ---------- renderização ----------
function sylHTML(syl){ return String(syl).split('-').map(s => s.startsWith('^') ? `<b>${esc(s.slice(1))}</b>` : esc(s)).join('·'); }
const sylPlain = syl => String(syl).replace(/\^/g, '').split('-').join('·');
const hl = s => esc(s).replace(/\*([^*]+)\*/g, '<mark>$1</mark>');
function blankHTML(p, fill, ok){
  const e = esc(p);
  const slot = fill == null ? '<span class="blank" aria-label="lacuna"></span>' : `<span class="filled ${ok ? 'ok' : 'bad'}">${esc(fill)}</span>`;
  return e.includes('___') ? e.replace('___', slot) : e;
}

function renderMeta(){
  const learned = S.learned.length, st = streak();
  const sync = SYNC === 'cloud' ? '<span><span class="dot ok"></span>Progresso salvo na sua conta</span>'
    : SYNC === 'retry' ? '<span><span class="dot warn"></span>Salvo neste aparelho; tentando sincronizar</span>'
    : SYNC === 'local' ? '<span><span class="dot warn"></span>Salvo só neste navegador</span>'
    : '<span><span class="dot"></span>Progresso não está sendo salvo</span>';
  $('#meta').innerHTML = `<span><b>${learned}</b> ${learned === 1 ? 'palavra aprendida' : 'palavras aprendidas'}</span><span><b>${st}</b> ${st === 1 ? 'dia seguido' : 'dias seguidos'}</span>${sync}`;
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.id === VIEW.tab)));
}

function renderEntry(w, label){
  const conj = conjOf(w);
  const P = ['eu', 'você / ele / ela', 'nós', 'vocês / eles / elas'];
  const fam = (w.fam || []).map(f => `<tr><td class="f">${esc(f[0])}</td><td class="p">${esc(clsName(f[1]))}</td><td>${esc(f[2])}</td></tr>`).join('');
  const conjHTML = conj ? `<section class="sec"><h2>Conjugação de “${esc(w.verb)}”</h2>
    <div class="tbl"><table><thead><tr><th>Pessoa</th><th>Presente</th><th>Passado concluído</th><th>Passado contínuo</th></tr></thead><tbody>
    ${P.map((p, i) => `<tr><td class="p">${p}</td><td class="c">${esc(conj.pres[i])}</td><td class="c">${esc(conj.perf[i])}</td><td class="c">${esc(conj.imp[i])}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="foot">Particípio: <b>${esc(conj.part)}</b> (foi ${esc(conj.part)}) · Gerúndio: <b>${esc(conj.ger)}</b> (está ${esc(conj.ger)}). Passado concluído = ação terminada (“ontem eu ${esc(conj.perf[0])}”). Passado contínuo = hábito ou ação em andamento (“antes eu ${esc(conj.imp[0])}”).</p></section>` : '';
  const listen = t => CAN_SPEAK ? `<button class="mini" data-act="speak" data-text="${esc(t)}" aria-label="Ouvir frase">${SPK}</button>` : '';
  return `
  <article class="entry">
    <div class="eyebrow">${esc(label)}</div>
    <h2 class="hw">${esc(w.w)}</h2>
    <div class="pron"><span class="syl" title="Sílabas; em negrito, a sílaba forte">${sylHTML(w.syl || w.w)}</span><span class="cls">${esc(clsName(w.c))}</span>${CAN_SPEAK ? `<button class="listen" data-act="speak" data-text="${esc(w.w)}">${SPK} Ouvir</button>` : ''}</div>
    <p class="def">${esc(w.def)}</p>
  </article>
  <section class="sec"><h2>No dia a dia</h2><ul class="ex">${w.ex.map(x => `<li><span>${hl(x)}</span>${listen(x)}</li>`).join('')}</ul></section>
  <section class="sec"><h2>Família da palavra</h2><div class="tbl"><table><thead><tr><th>Forma</th><th>Classe</th><th>Sentido</th></tr></thead><tbody>${fam}</tbody></table></div></section>
  ${conjHTML}
  ${(w.syn && w.syn.length) || (w.ant && w.ant.length) ? `<section class="sec pairs">
    ${w.syn && w.syn.length ? `<div><h2>Parecidas</h2><div class="chips">${w.syn.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div></div>` : ''}
    ${w.ant && w.ant.length ? `<div><h2>Contrárias</h2><div class="chips">${w.ant.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div></div>` : ''}
  </section>` : ''}
  ${w.tip ? `<section class="sec"><div class="tip"><b>Dica.</b> ${esc(w.tip)}</div></section>` : ''}`;
}

function renderPick(){
  const t = S.today;
  const rev = reviewIdsFor({day:t.day, chosen:null});
  const rows = t.options.map(id => {
    const w = word(id);
    return `<div class="opt">
      <div><div class="word">${esc(w.w)}</div>
      <div class="sub"><span class="cls">${esc(clsName(w.c))}</span><span>${esc(sylPlain(w.syl || w.w))}</span>${t.carried.includes(id) ? '<span class="badge">sugerida antes</span>' : ''}</div></div>
      <div class="acts"><button class="btn btn-primary" data-act="choose" data-id="${esc(id)}">Aprender esta</button><button class="btn btn-ghost" data-act="known" data-id="${esc(id)}">Já conheço</button></div>
    </div>`;
  }).join('');
  const intro = S.learned.length === 0 ? `<ol class="how">
      <li><b>Escolha 1 de 5 palavras.</b> As que você não escolher podem voltar amanhã.</li>
      <li><b>Estude o verbete:</b> sentido, frases do dia a dia, família e conjugação.</li>
      <li><b>Faça a prova.</b> Cada palavra volta na revisão das 5 provas seguintes, com 2 perguntas.</li>
    </ol>` : '';
  const low = t.options.length < 5 ? `<div class="note"><b>O banco de palavras está acabando.</b> ${genBlock()}</div>` : '';
  const revNote = rev.length
    ? `<div class="note">Na prova de hoje: <b>6 perguntas</b> da palavra nova + <b>${rev.length * 2} de revisão</b> (${rev.map(id => esc(word(id).w)).join(', ')}).</div>`
    : `<div class="note">A partir da segunda palavra, a prova ganha uma parte de revisão com as palavras anteriores.</div>`;
  return `<section class="page">
    <div class="eyebrow">${esc(fmtDay(t.day))}</div>
    <h2 class="h">Escolha a palavra de hoje</h2>
    <p class="lead">Toque em “Aprender esta” na que você quer estudar. Se já conhece alguma, toque em “Já conheço” e ela não será mais sugerida.</p>
    ${intro}
    <div class="stack">${rows || '<p class="empty">Nenhuma sugestão disponível no momento.</p>'}</div>
    ${low}${revNote}
  </section>`;
}

function renderLearn(){
  const t = S.today, w = word(t.chosen);
  const nRev = reviewIdsFor(t).length * 2;
  return `<section class="page">
    ${renderEntry(w, 'Palavra do dia · ' + fmtDay(t.day))}
    <div class="cta">
      <button class="btn btn-primary btn-lg" data-act="start">Começar a prova</button>
      <span>${6 + nRev} perguntas: 6 sobre “${esc(w.w)}”${nRev ? ` + ${nRev} de revisão` : ''}</span>
    </div>
    <p><button class="link" data-act="unchoose">Escolher outra palavra</button></p>
  </section>`;
}

function renderQuiz(){
  const t = S.today, qz = t.quiz, qs = quiz(), q = qs[qz.i], w = word(q.wid);
  const done = qz.res[qz.i] !== undefined, ok = qz.res[qz.i], given = qz.ans[qz.i];
  const pct = Math.round((qz.i + (done ? 1 : 0)) / qs.length * 100);
  const sec = q.sec === 'hoje' ? `<span class="sectag">Palavra de hoje · ${esc(w.w)}</span>` : `<span class="sectag rev">Revisão · ${esc(w.w)}</span>`;
  let body = '';
  if (q.t === 'mc'){
    body = `<div class="choices">${q.o.map((o, i) => {
      let cls = '';
      if (done){ if (o === q.a) cls = 'is-ok'; else if (o === given) cls = 'is-bad'; else cls = 'dim'; }
      return `<button class="choice ${cls}" data-act="answer" data-val="${esc(o)}" ${done ? 'disabled' : ''}><span class="l">${LETTERS[i]}</span><span>${esc(o)}</span></button>`;
    }).join('')}</div>`;
  } else {
    body = `<p class="hint">Escreva uma forma de <b>“${esc(q.hint)}”</b> que complete a frase.</p>
      <form class="typed" data-form="typed"><input id="typed-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Digite aqui" value="${done ? esc(given) : ''}" ${done ? 'disabled' : ''} aria-label="Sua resposta"><button class="btn btn-primary" ${done ? 'disabled' : ''}>Conferir</button></form>`;
  }
  let fb = '';
  if (done){
    if (ok) fb = `<div class="fb ok"><h3>Correto!</h3>${qz.acc[qz.i] ? `<p>Só atenção aos acentos: o certo é <span class="ans">${esc(q.a)}</span>.</p>` : ''}<p>${esc(q.e)}</p></div>`;
    else fb = `<div class="fb bad"><h3>Não foi dessa vez</h3>
      <p>Resposta certa: <span class="ans">${esc(q.a)}</span></p>
      <p>${esc(q.e)}</p>
      <p>Lembrete: <b>${esc(w.w)}</b> = ${esc(w.g)}.</p></div>`;
    fb += `<div class="next"><button class="btn btn-primary" id="btn-next" data-act="next">${qz.i < qs.length - 1 ? 'Próxima pergunta' : 'Ver resultado'}</button></div>`;
  }
  const prompt = q.t === 'type' || q.k === 'Complete a frase' ? blankHTML(q.p, done ? q.a : null, true) : esc(q.p);
  return `<section class="page">
    <div class="qhead">${sec}<span>Pergunta ${qz.i + 1} de ${qs.length}</span></div>
    <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
    <div class="qcard">
      <div class="eyebrow">${esc(q.k)}</div>
      <p class="qp">${prompt}</p>
      ${body}${fb}
    </div>
  </section>`;
}

function renderDone(){
  const t = S.today, qs = quiz(), qz = t.quiz, r = t.result, w = word(t.chosen);
  const misses = qs.map((q, i) => ({q, i})).filter(x => !qz.res[x.i]);
  const missHTML = misses.length ? `<section class="sec"><h2>O que revisar</h2><div class="stack">${misses.map(({q, i}) => {
    const mw = word(q.wid);
    return `<div class="miss"><div class="eyebrow">${q.sec === 'hoje' ? 'Palavra de hoje' : 'Revisão'} · ${esc(mw.w)}</div>
      <p class="qp">${q.p.includes('___') ? blankHTML(q.p, q.a, true) : esc(q.p)}</p>
      <p>Você respondeu: <b>${esc(qz.ans[i])}</b> · Certo: <b>${esc(q.a)}</b></p>
      <p>${esc(q.e)}</p></div>`;
  }).join('')}</div></section>` : `<div class="note"><b>Nenhum erro.</b> Tudo certo nesta prova.</div>`;
  return `<section class="page">
    <div class="eyebrow">${esc(fmtDay(t.day))}</div>
    <h2 class="h">Prova concluída</h2>
    <p class="lead">Novas sugestões às ${UNLOCK_HOUR}h, <span class="clock" id="countdown">${countdown()}</span>. “${esc(w.w)}” entra na revisão das próximas ${REVIEW_WORDS} provas.</p>
    <div class="score">
      <div><div class="k">Palavra de hoje</div><div class="n">${r.hoje[0]}<small>/${r.hoje[1]}</small></div></div>
      ${r.rev[1] ? `<div><div class="k">Revisão</div><div class="n">${r.rev[0]}<small>/${r.rev[1]}</small></div></div>` : ''}
    </div>
    ${missHTML}
    <div class="cta"><button class="btn btn-primary" data-act="peek" data-id="${esc(t.chosen)}">Rever “${esc(w.w)}”</button><button class="btn btn-ghost" data-act="start">Refazer a prova</button></div>
  </section>`;
}

function genBlock(){
  if (GEN.busy) return `<span>${esc(GEN.msg)}</span>`;
  const msg = GEN.msg ? `<span>${esc(GEN.msg)}</span> ` : '';
  if (!SAMPLE) return msg + '<span>Peça ao Claude, na conversa, para acrescentar mais palavras.</span>';
  return msg + '<button class="btn btn-ghost" data-act="gen" style="margin-top:8px">Gerar 8 palavras novas com o Claude</button>';
}

function renderLibrary(){
  const t = S.today;
  const inReview = new Set(reviewIdsFor(t));
  const learned = S.learned.slice().reverse().map(l => {
    const w = word(l.id); if (!w) return '';
    const st = S.stats[l.id];
    const acc = st && (st.ok + st.err) ? `${st.ok}/${st.ok + st.err} acertos` : 'sem prova';
    const pill = (l.id === t.chosen && l.day === t.day) ? '<span class="pill new">hoje</span>' : inReview.has(l.id) ? '<span class="pill rev">em revisão</span>' : '<span class="pill done">concluída</span>';
    return `<button class="row" data-act="peek" data-id="${esc(l.id)}"><div><div class="word">${esc(w.w)}</div><div class="sub">${esc(clsName(w.c))} · aprendida em ${esc(fmtShort(l.day))}</div></div><div class="right">${pill}<div>${acc}</div></div></button>`;
  }).join('');
  const known = S.known.filter(word).map(id => `<span class="kchip">${esc(word(id).w)}<button data-act="restore" data-id="${esc(id)}" aria-label="Voltar a sugerir ${esc(word(id).w)}">voltar a sugerir</button></span>`).join('');
  const fresh = allIds().filter(isFresh).length;
  return `<section class="page">
    <h2 class="h">Minhas palavras</h2>
    <p class="lead">Toque numa palavra para rever o verbete. As marcadas “em revisão” caem na próxima prova.</p>
    <div class="stack">${learned || '<p class="empty">Nenhuma palavra aprendida ainda. Comece pela aba Hoje.</p>'}</div>
    <section class="sec"><h2>Palavras que você já conhecia</h2>${known ? `<div class="chips">${known}</div>` : '<p class="empty">Nenhuma marcada.</p>'}</section>
    <section class="sec"><h2>Banco de palavras</h2><div class="note" style="margin-top:0"><b>${fresh}</b> ${fresh === 1 ? 'palavra nova ainda não sugerida' : 'palavras novas ainda não sugeridas'}, mais <b>${S.pending.length}</b> guardadas de dias anteriores. ${fresh < 12 ? genBlock() : ''}</div></section>
  </section>`;
}

function renderPeek(id){
  const w = word(id); if (!w){ VIEW.peek = null; return render(); }
  const l = S.learned.find(x => x.id === id);
  return `<section class="page"><button class="link back" data-act="unpeek">← Voltar</button>${renderEntry(w, l ? 'Aprendida em ' + fmtShort(l.day) : 'Verbete')}</section>`;
}

function render(top){
  renderMeta();
  const app = $('#app'), t = S.today;
  let html;
  if (VIEW.peek) html = renderPeek(VIEW.peek);
  else if (VIEW.tab === 'lista') html = renderLibrary();
  else if (t.stage === 'pick') html = renderPick();
  else if (t.stage === 'learn') html = renderLearn();
  else if (t.stage === 'quiz') html = renderQuiz();
  else html = renderDone();
  if (html !== undefined) app.innerHTML = html;
  if (top) window.scrollTo({top:0});
  const inp = document.getElementById('typed-input');
  if (inp && !inp.disabled) inp.focus({preventScroll:true});
}

// ---------- aviso flutuante ----------
let toastTimer = null;
function toast(msg, actLabel, fn){
  const slot = $('#toast-slot');
  slot.innerHTML = `<div class="toast" role="status"><span>${esc(msg)}</span>${actLabel ? `<button id="toast-act">${esc(actLabel)}</button>` : ''}</div>`;
  if (actLabel) $('#toast-act').onclick = () => { slot.innerHTML = ''; fn(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { slot.innerHTML = ''; }, 6000);
}

// ---------- eventos ----------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === 'tab'){ VIEW = {tab:id, peek:null}; render(true); }
  else if (act === 'choose') choose(id);
  else if (act === 'known') markKnown(id);
  else if (act === 'restore') restoreKnown(id);
  else if (act === 'unchoose') unchoose();
  else if (act === 'start') startQuiz();
  else if (act === 'answer') answer(b.dataset.val);
  else if (act === 'next') next();
  else if (act === 'peek'){ VIEW.peek = id; render(true); }
  else if (act === 'unpeek'){ VIEW.peek = null; render(true); }
  else if (act === 'speak') speak(b.dataset.text);
  else if (act === 'gen') generate();
});
document.addEventListener('submit', e => {
  if (e.target.dataset.form === 'typed'){ e.preventDefault(); const v = document.getElementById('typed-input').value; answer(v); }
});
function tick(){
  const el = document.getElementById('countdown'); if (el) el.textContent = countdown();
  if (S.today && dayKey() !== S.today.day && S.today.stage !== 'quiz' && !VIEW.peek){ Q = null; ensureDay(); save(); render(true); }
}
setInterval(tick, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

// ---------- gerar mais palavras (Claude) ----------
let SAMPLE = null, GEN = {busy:false, msg:''};
const isStr = v => typeof v === 'string' && v.trim().length > 0;
const strList = v => Array.isArray(v) ? v.filter(isStr).map(String).slice(0, 6) : [];
function validateWord(r){
  try {
    if (!r || typeof r !== 'object' || !isStr(r.w) || !isStr(r.def) || !isStr(r.g)) return null;
    const id = strip(String(r.w)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!id) return null;
    const fam = (Array.isArray(r.fam) ? r.fam : []).filter(f => Array.isArray(f) && isStr(f[0])).map(f => [String(f[0]), String(f[1] || ''), String(f[2] || '')]).slice(0, 5);
    const ex = strList(r.ex).slice(0, 4);
    const q = (Array.isArray(r.q) ? r.q : []).filter(x => Array.isArray(x) && isStr(x[0]) && x[0].includes('___') && isStr(x[1]) && Array.isArray(x[2]))
      .map(x => [String(x[0]), String(x[1]), x[2].filter(isStr).map(String).filter(d => norm(d) !== norm(x[1])).slice(0, 3), String(x[3] || ''), String(x[4] || r.verb || r.w)])
      .filter(x => x[2].length >= 2).slice(0, 5);
    const u = Array.isArray(r.u) && isStr(r.u[0]) && Array.isArray(r.u[1]) && r.u[1].filter(isStr).length ? [String(r.u[0]), r.u[1].filter(isStr).map(String).slice(0, 3), String(r.u[2] || '')] : null;
    if (ex.length < 2 || q.length < 3 || !u) return null;
    const w = {id, w:String(r.w), c:String(r.c || ''), syl:isStr(r.syl) ? String(r.syl) : String(r.w), def:String(r.def), g:String(r.g), fam:fam.length ? fam : [[String(r.w), String(r.c || ''), String(r.g)]], ex, q, u, syn:strList(r.syn), ant:strList(r.ant), tip:isStr(r.tip) ? String(r.tip) : '', gen:true};
    if (isStr(r.verb)){
      w.verb = String(r.verb);
      const c = r.conj;
      if (c && ['pres', 'perf', 'imp'].every(k => Array.isArray(c[k]) && c[k].length === 4 && c[k].every(isStr)) && isStr(c.part) && isStr(c.ger))
        w.conj = {pres:c.pres.map(String), perf:c.perf.map(String), imp:c.imp.map(String), part:String(c.part), ger:String(c.ger)};
    }
    return w;
  } catch (e) { return null; }
}
function genPrompt(){
  const used = allIds().map(id => word(id).w).concat(['dissimulação', 'dissimular']);
  const sample = Object.assign({}, BY_ID.mitigar); delete sample.id;
  return `Você é professor de português do Brasil. Um adulto nativo com vocabulário limitado quer aprender uma palavra nova por dia: palavras cultas, mas úteis no dia a dia, no trabalho e no noticiário (nível de "dissimulação", "mitigar", "perspicaz", "idôneo").

Crie 8 palavras NOVAS. Não repita nenhuma destas (nem formas da mesma família): ${used.join(', ')}.
Prefira palavras com família rica (verbo + substantivo + adjetivo) e evite termos raros demais ou regionais.

Responda SOMENTE com um array JSON de 8 objetos, cada um exatamente neste formato (exemplo real):
${JSON.stringify(sample)}

Regras de cada campo:
- "w": a palavra principal. "c": "v", "sf", "sm", "adj" ou "adv".
- "syl": sílabas separadas por "-" com "^" antes da sílaba tônica.
- "def": definição simples, em uma frase. "g": sentido curtíssimo (até 6 palavras).
- "fam": 2 a 4 formas da família; a primeira é a própria palavra: [forma, classe, sentido curto].
- "verb": infinitivo do verbo da família, se existir (senão omita). Com verbo, inclua "conj": {"pres":[eu, ele, nós, eles], "perf":[eu, ele, nós, eles], "imp":[eu, ele, nós, eles], "part":"...", "ger":"..."} com as formas corretas.
- "ex": 3 frases naturais do dia a dia, com a forma da palavra entre asteriscos.
- "q": 4 itens [frase com ___, resposta, [3 formas erradas da mesma família], explicação curta da gramática, palavra base]. Use marcadores de tempo (ontem, todo dia, no ano passado) para que só UMA resposta caiba; nenhuma alternativa errada pode completar a frase corretamente. Varie as classes e os tempos verbais.
- "u": [frase com uso correto, [2 frases com uso errado], explicação curta].
- "syn", "ant": até 4 palavras cada. "tip": uma dica curta de uso, grafia ou confusão comum.`;
}
async function persistWord(w){
  if (DB){ try { await DB.doc('words/' + w.id).set(w); return; } catch (e) {} }
}
async function generate(){
  if (!SAMPLE || GEN.busy) return;
  GEN = {busy:true, msg:'O Claude está escolhendo palavras novas. Isso pode levar até um minuto.'};
  render();
  try {
    const out = await SAMPLE.json(genPrompt(), {modelTier:'default'});
    const arr = Array.isArray(out) ? out : (out && Array.isArray(out.words) ? out.words : []);
    let added = 0;
    for (const raw of arr){
      const w = validateWord(raw);
      if (!w || word(w.id)) continue;
      EXTRA[w.id] = w; added++;
      await persistWord(w);
    }
    lsSet(LS_EXTRA, EXTRA);
    GEN = {busy:false, msg: added ? `${added} palavras novas entraram no banco.` : 'Não recebi palavras válidas. Tente de novo.'};
    if (added && S.today.stage === 'pick') topUp();
    save();
  } catch (e) {
    const c = e && e.code;
    GEN = {busy:false, msg: c === 'not_granted' ? 'Sem permissão para usar o Claude nesta página.' : c === 'rate_limited' ? 'Muitos pedidos seguidos. Tente de novo em alguns minutos.' : 'Não foi possível gerar agora. Tente mais tarde.'};
    if (c === 'not_granted' || c === 'sampling_disabled') SAMPLE = null;
  }
  render();
}

// ---------- início ----------
function loadExtras(obj){ if (!obj || typeof obj !== 'object') return; for (const k of Object.keys(obj)){ const w = validateWord(obj[k]); if (w && !BY_ID[w.id]) EXTRA[w.id] = w; } }
loadExtras(lsGet(LS_EXTRA));
if (ensureDay()) lsSet(LS_KEY, S);
render();

(async () => {
  const c = window.claude;
  if (!c || typeof c.use !== 'function') return;
  c.use('sample').then(s => { if (s){ SAMPLE = s; if (VIEW.tab === 'lista' || S.today.options.length < 5) render(); } }).catch(() => {});
  let db = null;
  try { db = await c.use('db'); } catch (e) {}
  if (!db) return;
  try {
    const snap = await db.doc('progress/main').get();
    DB = db;
    // A versão mais recente vence: permite usar o caderno em mais de um aparelho.
    let push = !snap.exists;
    if (snap.exists){
      const remote = sane(clone(snap.data()));
      if ((remote.updatedAt || 0) >= (S.updatedAt || 0)){ S = remote; Q = null; } else push = true;
    }
    try { const ws = await db.collection('words').get(); ws.docs.forEach(d => { const w = validateWord(d.data()); if (w && !BY_ID[w.id]) EXTRA[w.id] = w; }); lsSet(LS_EXTRA, EXTRA); } catch (e) {}
    if (ensureDay()) push = true;
    SYNC = 'cloud';
    if (push) await save(); else lsSet(LS_KEY, S);
    render();
  } catch (e) { DB = null; renderMeta(); }
})();
