// Estado do app + todas as ações que alteram dados.
// Regra de ouro: grava no IndexedDB primeiro; só depois atualiza a memória e a tela.
// Uma cópia de segurança (sem fotos) também fica no localStorage para recuperação.

import * as db from './db.js';
import { sweep, applyMove, historyFor, historyId, optGroups, optMembers, occByKey, inHistory, ruleOf, sameRule, startedBefore } from './schedule.js';
import { uid, norm } from './util.js';

export const DEFAULT_SETTINGS = {
  // 'ask' (pergunta, com prévia de cada opção) | 'cascade' (adiar o que vem depois, no mesmo dia)
  // | 'trim' (só encurtar o vizinho) | 'push-new' | 'overlap'  ('push-existing' = nome antigo de 'cascade')
  conflictPolicy: 'ask',
  installHintDismissed: false,
  lastBackupAt: null, // data do último "Exportar backup"
  backupSnoozeUntil: 0, // lembrete de backup adiado até
  // notificações
  pushServer: '', // endereço do servidor (Cloudflare Worker)
  pushEnabled: false,
  pushDevice: '', // código aleatório deste aparelho no servidor
  defaultRemind: 60, // antecedência padrão (min) ao ligar a notificação de um item
};

const COLLECTIONS = ['places', 'events', 'visits', 'commitments', 'history', 'items'];
const MIRROR_KEY = 'agentonator.mirror.v1';

export const state = {
  places: [], events: [], visits: [], commitments: [], history: [], items: [],
  settings: { ...DEFAULT_SETTINGS },
  lastSweep: 0,
  persisted: null,
  restoredFromMirror: false,
};

const photoCache = new Map();
const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of [...listeners]) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

const put = (store, value) => ({ type: 'put', store, value });
const del = (store, key) => ({ type: 'delete', store, key });

function applyOp(op) {
  if (op.store === 'meta') {
    if (op.type !== 'put') return;
    if (op.value.key === 'settings') state.settings = { ...DEFAULT_SETTINGS, ...op.value.value };
    if (op.value.key === 'lastSweep') state.lastSweep = op.value.value;
    return;
  }
  if (op.store === 'photos') {
    if (op.type === 'put') photoCache.set(op.value.id, op.value.full);
    else photoCache.delete(op.key);
    return;
  }
  const arr = state[op.store];
  if (op.type === 'put') {
    const i = arr.findIndex((x) => x.id === op.value.id);
    if (i >= 0) arr[i] = op.value; else arr.push(op.value);
  } else if (op.type === 'delete') {
    const i = arr.findIndex((x) => x.id === op.key);
    if (i >= 0) arr.splice(i, 1);
  }
}

function writeMirror() {
  try {
    const snap = {
      v: 1, savedAt: Date.now(),
      places: state.places.map(({ thumb, ...p }) => p),
      events: state.events, visits: state.visits, commitments: state.commitments,
      history: state.history, items: state.items, settings: state.settings, lastSweep: state.lastSweep,
    };
    localStorage.setItem(MIRROR_KEY, JSON.stringify(snap));
  } catch { /* cota cheia: o IndexedDB continua sendo a fonte principal */ }
}

let persistAskedThisSession = false;

// ---------- desfazer / refazer ----------
// Toda gravação de dados é registrada automaticamente. Gravações feitas em sequência imediata
// (uma ação que mexe em vários itens + a conclusão automática que ela dispara) viram um passo só;
// um novo gesto na agenda sempre começa um passo novo (newUndoStep).
const UNDOABLE = new Set(['places', 'events', 'visits', 'commitments', 'items', 'history', 'photos']);
const GROUP_MS = 400;
const MAX_STEPS = 40;
const undoStack = [];
const redoStack = [];
let openGroup = null;
const undoListeners = new Set();
export function onUndoChange(fn) { undoListeners.add(fn); return () => undoListeners.delete(fn); }
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
function notifyUndo() { for (const fn of [...undoListeners]) { try { fn(); } catch (e) { console.error(e); } } }
/** o próximo registro começa um passo novo de desfazer (chamado no início de cada gesto) */
export function newUndoStep() { openGroup = null; }
function resetUndo() { undoStack.length = 0; redoStack.length = 0; openGroup = null; notifyUndo(); }
const recKey = (store, id) => `${store}\u0000${id}`;
const opId = (op) => (op.type === 'put' ? op.value.id : op.key);

async function captureBefore(ops) {
  const out = new Map();
  for (const op of ops) {
    if (!UNDOABLE.has(op.store) || op.type === 'clear') continue;
    const id = opId(op);
    const k = recKey(op.store, id);
    if (out.has(k)) continue;
    let before = null;
    if (op.store === 'photos') {
      const full = photoCache.has(id) ? photoCache.get(id) : (await db.get('photos', id))?.full;
      before = full ? { id, full } : null;
    } else {
      before = state[op.store].find((x) => x.id === id) || null;
    }
    out.set(k, before);
  }
  return out;
}

function recordStep(ops, befores) {
  const now = Date.now();
  if (!openGroup || now - openGroup.t > GROUP_MS) {
    openGroup = { map: new Map(), t: now };
    undoStack.push(openGroup);
    if (undoStack.length > MAX_STEPS) undoStack.shift();
  }
  openGroup.t = now;
  redoStack.length = 0;
  for (const op of ops) {
    if (!UNDOABLE.has(op.store) || op.type === 'clear') continue;
    const id = opId(op);
    const k = recKey(op.store, id);
    if (!openGroup.map.has(k)) openGroup.map.set(k, { store: op.store, id, before: befores.get(k) ?? null });
    openGroup.map.get(k).after = op.type === 'put' ? op.value : null;
  }
  notifyUndo();
}

/** nome curto do que um passo mudou (para o aviso "Desfeito: …") */
function describeStep(g) {
  const names = [];
  for (const { store, before, after } of g.map.values()) {
    const r = after || before;
    if (!r) continue;
    let n = null;
    if (store === 'events' || store === 'commitments' || store === 'places') n = r.name;
    else if (store === 'items') n = r.title;
    else if (store === 'visits') n = state.places.find((p) => p.id === r.placeId)?.name || 'Visita';
    if (n && !names.includes(n)) names.push(n);
  }
  if (!names.length) return '';
  return names.length === 1 ? names[0] : `${names[0]} e mais ${names.length - 1}`;
}

let undoBusy = false;
async function replay(from, to, pick) {
  if (undoBusy || !from.length) return null;
  undoBusy = true;
  const g = from.pop();
  try {
    openGroup = null;
    const ops = [...g.map.values()].map((x) => (pick(x) ? put(x.store, pick(x)) : del(x.store, x.id)));
    await commit(ops, { record: false });
    to.push(g);
    return describeStep(g) || 'alteração';
  } catch (e) {
    from.push(g);
    throw e;
  } finally {
    undoBusy = false;
    notifyUndo();
  }
}
/** volta o último passo. Retorna o nome do que mudou (ou null se não havia nada) */
export const undo = () => replay(undoStack, redoStack, (x) => x.before);
/** refaz o passo desfeito */
export const redo = () => replay(redoStack, undoStack, (x) => x.after);

/**
 * record: true = registra para desfazer; 'attach' = só se juntar a uma ação do usuário recém-feita
 * (ex.: a conclusão automática disparada por ela); false = não registra.
 */
async function commit(ops, { silent = false, record = true } = {}) {
  if (!ops.length) return;
  if (ops.some((o) => o.type === 'clear')) { resetUndo(); record = false; }
  const rec = record === true || (record === 'attach' && openGroup && Date.now() - openGroup.t <= GROUP_MS);
  const undoable = rec && ops.some((o) => UNDOABLE.has(o.store));
  const befores = undoable ? await captureBefore(ops) : null;
  await db.tx(ops); // lança erro se não gravou -> nada muda na tela
  for (const op of ops) applyOp(op);
  if (undoable) recordStep(ops, befores);
  writeMirror();
  if (!silent) {
    emit();
    // reforça o pedido de "não apagar meus dados" ao iOS depois de uma gravação feita pelo usuário
    if (state.persisted !== true && !persistAskedThisSession) {
      persistAskedThisSession = true;
      db.requestPersist().then((p) => { state.persisted = p; });
    }
  }
}

// ---------- inicialização ----------

export async function init() {
  const data = await db.loadAll();
  for (const c of COLLECTIONS) state[c] = data[c] || [];
  for (const m of data.meta || []) applyOp(put('meta', m));

  const empty = COLLECTIONS.every((c) => !state[c].length);
  if (empty) {
    // IndexedDB vazio mas existe cópia de segurança? Restaura.
    try {
      const snap = JSON.parse(localStorage.getItem(MIRROR_KEY) || 'null');
      const has = snap && COLLECTIONS.some((c) => (snap[c] || []).length);
      if (has) {
        const ops = [];
        for (const c of COLLECTIONS) for (const v of snap[c] || []) ops.push(put(c, v));
        if (snap.settings) ops.push(put('meta', { key: 'settings', value: snap.settings }));
        if (snap.lastSweep) ops.push(put('meta', { key: 'lastSweep', value: snap.lastSweep }));
        await commit(ops, { silent: true, record: false });
        state.restoredFromMirror = true;
      }
    } catch (e) { console.warn('mirror', e); }
  }

  // Padrão de conflitos: perguntar, mostrando a prévia de cada opção. Aplica uma única vez a quem já usava o app.
  const rawSettings = (data.meta || []).find((m) => m.key === 'settings')?.value;
  if (!rawSettings || (rawSettings.policyRev || 0) < 3) {
    await commit([put('meta', { key: 'settings', value: { ...state.settings, conflictPolicy: 'ask', policyRev: 3 } })], { silent: true, record: false });
  }

  if (!state.lastSweep) await commit([put('meta', { key: 'lastSweep', value: Date.now() })], { silent: true, record: false });
  // o Histórico guarda só locais e eventos (compromissos saíram na versão 10, horários avulsos na 11)
  const notHist = state.history.filter((h) => !inHistory(h.kind));
  if (notHist.length) await commit(notHist.map((h) => del('history', h.id)), { silent: true, record: false });
  await runSweep();
  db.requestPersist().then((p) => { state.persisted = p; });
}

let sweeping = false;
/** marca como feito tudo que já passou e registra no histórico */
export async function runSweep() {
  if (sweeping) return;
  sweeping = true;
  try {
    const now = Date.now();
    const r = sweep(state, now, state.lastSweep);
    const ops = [
      ...r.events.map((v) => put('events', v)),
      ...r.visits.map((v) => put('visits', v)),
      ...r.items.map((v) => put('items', v)),
      ...r.places.map((v) => put('places', v)),
      ...r.history.filter((h) => !state.history.some((x) => x.id === h.id)).map((v) => put('history', v)),
    ];
    const changed = ops.length > 0;
    ops.push(put('meta', { key: 'lastSweep', value: now }));
    await commit(ops, { silent: !changed, record: 'attach' });
  } finally {
    sweeping = false;
  }
}

// ---------- fotos ----------

export async function getPhoto(placeId) {
  if (photoCache.has(placeId)) return photoCache.get(placeId);
  const rec = await db.get('photos', placeId);
  const full = rec?.full || null;
  if (full) photoCache.set(placeId, full);
  return full;
}

// ---------- locais ----------

const findPlace = (id) => state.places.find((p) => p.id === id);

/** photo: undefined = mantém, null = remove, {full, thumb} = substitui */
export async function savePlace(input, photo) {
  const now = Date.now();
  const prev = input.id ? findPlace(input.id) : null;
  const place = {
    favorite: false, visited: false, visitedAt: null, visitedVia: null, category: null, thumb: null, hasPhoto: false,
    ...prev, ...input,
    id: prev?.id || input.id || uid(),
    createdAt: prev?.createdAt || now, updatedAt: now,
  };
  const ops = [];
  if (photo === null) {
    place.thumb = null; place.hasPhoto = false;
    ops.push(del('photos', place.id));
  } else if (photo) {
    place.thumb = photo.thumb; place.hasPhoto = true;
    ops.push(put('photos', { id: place.id, full: photo.full }));
  }
  ops.push(put('places', place));
  await commit(ops);
  return place;
}

export function placeDependents(id) {
  return {
    events: state.events.filter((e) => e.placeId === id),
    visits: state.visits.filter((v) => v.placeId === id),
  };
}

export async function deletePlace(id) {
  const { events, visits } = placeDependents(id);
  await commit([
    ...events.map((e) => del('events', e.id)),
    ...visits.map((v) => del('visits', v.id)),
    del('photos', id),
    del('places', id),
  ]);
}

export async function setPlaceVisited(id, visited) {
  const p = findPlace(id);
  if (!p) return;
  const now = Date.now();
  if (visited) {
    await commit([
      put('places', { ...p, visited: true, visitedAt: now, visitedVia: 'manual', updatedAt: now }),
      put('history', {
        id: `h:place:${id}`, kind: 'place', refId: id, placeId: id, title: p.name, subtitle: p.address || '',
        category: p.category || null, start: null, end: null, at: now, source: 'manual',
      }),
    ]);
  } else {
    await commit([
      put('places', { ...p, visited: false, visitedAt: null, visitedVia: null, updatedAt: now }),
      del('history', `h:place:${id}`),
    ]);
  }
}

// ---------- favoritos ----------

const STORE_OF = { place: 'places', event: 'events' }; // compromissos não têm favorito

async function toggleFlag(kind, id, field) {
  const store = STORE_OF[kind];
  const item = store && state[store].find((x) => x.id === id);
  if (!item) return false;
  const on = !item[field];
  await commit([put(store, { ...item, [field]: on, updatedAt: Date.now() })]);
  return on;
}

export const toggleFavorite = (kind, id) => toggleFlag(kind, id, 'favorite');
/** marca/desmarca um local ou evento como "Date" */
export const toggleDate = (kind, id) => toggleFlag(kind, id, 'isDate');

/** muda a data em que um local foi visitado (ts = meio-dia do dia escolhido) */
export async function setPlaceVisitedDate(id, ts) {
  const p = findPlace(id);
  if (!p) return;
  const now = Date.now();
  const via = !p.visitedVia || p.visitedVia === 'import' ? 'manual' : p.visitedVia;
  const ops = [put('places', { ...p, visited: true, visitedAt: ts, visitedVia: via, updatedAt: now })];
  const hid = `h:place:${id}`;
  const h = state.history.find((x) => x.id === hid);
  if (h || via === 'manual') {
    ops.push(put('history', {
      ...(h || { id: hid, kind: 'place', refId: id, placeId: id, title: p.name, subtitle: p.address || '', category: p.category || null, start: null, end: null }),
      at: ts, source: 'manual', dateOnly: true,
    }));
  }
  await commit(ops);
}

// ---------- eventos e visitas ----------

async function saveScheduled(store, kind, input, defaults) {
  const now = Date.now();
  const prev = input.id ? state[store].find((x) => x.id === input.id) : null;
  const rec = { ...defaults, status: 'planned', doneAt: null, ...prev, ...input, id: prev?.id || input.id || uid(), createdAt: prev?.createdAt || now, updatedAt: now };
  if (rec.start == null) { rec.start = null; rec.end = null; }
  const ops = [];
  const timeChanged = prev && (prev.start !== rec.start || prev.end !== rec.end);
  const hid = `h:${kind}:${rec.id}`;
  const hist = state.history.find((x) => x.id === hid);
  const newTitle = kind === 'event' ? rec.name : kind === 'item' ? rec.title : null;
  if (timeChanged && prev.status !== 'planned') {
    const stillPast = rec.start == null || rec.end <= now;
    if (prev.status === 'done' && stillPast) {
      // continua feito: só muda a data em que foi feito (e o registro no Histórico acompanha)
      rec.doneAt = rec.end ?? prev.doneAt ?? null;
      if (hist) {
        ops.push(put('history', {
          ...hist, start: rec.start, end: rec.end, at: rec.end ?? hist.at,
          source: rec.start != null ? 'manual' : hist.source, dateOnly: false, ...(newTitle ? { title: newTitle } : {}),
        }));
      }
    } else {
      rec.status = 'planned'; rec.doneAt = null; // remarcado para o futuro
      ops.push(del('history', hid));
    }
  } else if (hist && newTitle && hist.title !== newTitle) {
    ops.push(put('history', { ...hist, title: newTitle }));
  }
  ops.push(put(store, rec));
  await commit(ops);
  await runSweep();
  return rec;
}

export const saveEvent = (input) => saveScheduled('events', 'event', input, { favorite: false, category: null });
export const saveVisit = (input) => saveScheduled('visits', 'visit', input, { note: '' });

export async function deleteEvent(id) { await commit([del('events', id)]); }
export async function deleteVisit(id) { await commit([del('visits', id)]); }

// ---------- horários avulsos (só título e hora) ----------

export const saveItem = (input) => saveScheduled('items', 'item', input, { note: '' });
export async function deleteItem(id) { await commit([del('items', id)]); }

// ---------- compromissos ----------

export async function saveCommitment(input) {
  const now = Date.now();
  const prev = input.id ? state.commitments.find((x) => x.id === input.id) : null;
  const c = {
    favorite: false, overrides: {}, status: null, untilDate: null,
    ...prev, ...input,
    id: prev?.id || input.id || uid(), createdAt: prev?.createdAt || now, updatedAt: now,
  };
  delete c.favorite; delete c.category; // não se aplicam a compromissos
  // mudou dias/horários de algo que já vinha acontecendo: o que já começou fica com a regra antiga
  if (prev && prev.kind !== 'once' && !sameRule(prev, c) && startedBefore(prev, now)) {
    c.past = [...(prev.past || []), { ...ruleOf(prev), until: now }];
  }
  if (c.kind !== 'once') { c.start = null; c.end = null; }
  else { c.slots = []; if (!c.past?.length) c.overrides = {}; }
  await commit([put('commitments', c)]);
  await runSweep();
  return c;
}

/**
 * Excluir: um compromisso recorrente que já aconteceu é só encerrado — as próximas ocorrências saem da
 * agenda, as que já começaram continuam nela (e em Afazeres). Os outros são apagados.
 */
export async function deleteCommitment(id) {
  const c = state.commitments.find((x) => x.id === id);
  if (!c) return;
  const now = Date.now();
  if (!c.ended && ((c.past || []).length || (c.kind !== 'once' && startedBefore(c, now)))) { // já aconteceu (nesta ou numa versão anterior)
    await commit([put('commitments', { ...c, past: [...(c.past || []), { ...ruleOf(c), until: now }], ended: true, endedAt: now, updatedAt: now })]);
  } else {
    await commit([del('commitments', id)]);
  }
}

// ---------- ações sobre ocorrências da agenda ----------

/** moves: [{occ, start, end}] aplicados numa única transação (um passo de desfazer) */
export async function applyMoves(moves) {
  if (!moves.length) return false;
  const now = Date.now();
  const working = { ...state, events: [...state.events], visits: [...state.visits], items: [...state.items], commitments: [...state.commitments] };
  const changed = new Map();
  const ops = [];
  for (const m of moves) {
    const { store, value, clearedHistory } = applyMove(working, m.occ, m.start, m.end, now);
    working[store] = working[store].map((x) => (x.id === value.id ? value : x));
    changed.set(`${store}:${value.id}`, put(store, value));
    if (clearedHistory) ops.push(del('history', clearedHistory));
  }
  await commit([...changed.values(), ...ops]);
  await runSweep();
  return true;
}

function markPlaceVisitedOps(placeId, at, via) {
  const p = placeId && findPlace(placeId);
  if (!p || p.visited) return [];
  return [put('places', { ...p, visited: true, visitedAt: at, visitedVia: via, updatedAt: Date.now() })];
}

/** o local só estava "visitado" por causa deste evento/visita? então volta a não visitado */
function unvisitOps(placeId, kind, refId) {
  const p = placeId && findPlace(placeId);
  if (!p?.visited || (p.visitedVia !== 'event' && p.visitedVia !== 'visit')) return [];
  const otherDone = state.events.some((e) => e.placeId === p.id && !(kind === 'event' && e.id === refId) && e.status === 'done')
    || state.visits.some((v) => v.placeId === p.id && !(kind === 'visit' && v.id === refId) && v.status === 'done');
  return otherDone ? [] : [put('places', { ...p, visited: false, visitedAt: null, visitedVia: null, updatedAt: Date.now() })];
}

/**
 * ✓ de "feito" direto na lista de eventos (com ou sem data).
 * Desmarcar um evento cuja data já passou vira "não aconteceu" (senão a conclusão automática marcaria de novo).
 */
export async function setEventDone(id, done) {
  const e = state.events.find((x) => x.id === id);
  if (!e) return;
  const now = Date.now();
  const p = findPlace(e.placeId);
  const hid = `h:event:${id}`;
  if (done) {
    const at = e.start != null ? Math.min(now, e.end) : now;
    await commit([
      put('events', { ...e, status: 'done', doneAt: at, updatedAt: now }),
      put('history', {
        id: hid, kind: 'event', refId: id, subKey: null, placeId: e.placeId || null, title: e.name, subtitle: p?.name || '',
        category: e.category || p?.category || null, start: e.start ?? null, end: e.end ?? null, at, source: 'manual',
      }),
      ...markPlaceVisitedOps(e.placeId, at, 'event'),
    ]);
  } else {
    const past = e.start != null && e.end <= now;
    await commit([
      put('events', { ...e, status: past ? 'missed' : 'planned', doneAt: null, updatedAt: now }),
      del('history', hid),
      ...unvisitOps(e.placeId, 'event', id),
    ]);
  }
}

/** status: 'done' | 'missed' | 'planned' */
export async function setOccStatus(occ, status) {
  const now = Date.now();
  const ops = [];
  const store = { event: 'events', visit: 'visits', item: 'items' }[occ.kind];
  if (store) {
    const rec = state[store].find((x) => x.id === occ.refId);
    ops.push(put(store, { ...rec, status, doneAt: status === 'done' ? Math.min(now, rec.end) : null, updatedAt: now }));
  } else {
    const c = state.commitments.find((x) => x.id === occ.refId);
    if (c.kind === 'once') {
      ops.push(put('commitments', { ...c, status: status === 'planned' ? null : status, updatedAt: now }));
    } else {
      const ov = { ...(c.overrides || {}) };
      const o = { ...(ov[occ.subKey] || {}) };
      if (status === 'planned') delete o.status; else o.status = status;
      if (Object.keys(o).length) ov[occ.subKey] = o; else delete ov[occ.subKey];
      ops.push(put('commitments', { ...c, overrides: ov, updatedAt: now }));
    }
  }
  if (status === 'done' && inHistory(occ.kind)) { // compromissos e horários avulsos não vão para o Histórico
    const at = Math.min(now, occ.end);
    ops.push(put('history', historyFor(occ, 'manual', at)));
    ops.push(...markPlaceVisitedOps(occ.placeId, at, occ.kind));
  } else {
    ops.push(del('history', historyId(occ)));
  }
  await commit(ops);
}

/** cancela só esta ocorrência de um compromisso recorrente */
export async function cancelOccurrence(occ) {
  const c = state.commitments.find((x) => x.id === occ.refId);
  if (!c || c.kind === 'once') return;
  const ov = { ...(c.overrides || {}), [occ.subKey]: { cancelled: true } };
  await commit([put('commitments', { ...c, overrides: ov, updatedAt: Date.now() }), del('history', historyId(occ))]);
}

export async function restoreOccurrence(occ) {
  const c = state.commitments.find((x) => x.id === occ.refId);
  if (!c) return;
  const ov = { ...(c.overrides || {}) };
  const o = { ...(ov[occ.subKey] || {}) };
  delete o.start; delete o.end; delete o.cancelled;
  if (Object.keys(o).length) ov[occ.subKey] = o; else delete ov[occ.subKey];
  await commit([put('commitments', { ...c, overrides: ov, updatedAt: Date.now() })]);
  await runSweep();
}

// ---------- Plano B (opções para o mesmo horário) ----------

const STORE_BY_KIND = { event: 'events', visit: 'visits', item: 'items' };

/** ops que colocam (g) ou tiram (g = null) uma ocorrência de um grupo de opções */
function optOps(occ, g, r = 0) {
  const now = Date.now();
  const strip = (rec) => { const { optGroup, optRank, ...rest } = rec; return rest; };
  const store = STORE_BY_KIND[occ.kind];
  if (store) {
    const rec = state[store].find((x) => x.id === occ.refId);
    if (!rec) return [];
    return [put(store, g ? { ...rec, optGroup: g, optRank: r, updatedAt: now } : { ...strip(rec), updatedAt: now })];
  }
  const c = state.commitments.find((x) => x.id === occ.refId);
  if (!c) return [];
  if (c.kind === 'once') return [put('commitments', g ? { ...c, optGroup: g, optRank: r, updatedAt: now } : { ...strip(c), updatedAt: now })];
  const ov = { ...(c.overrides || {}) };
  const o = strip({ ...(ov[occ.subKey] || {}) });
  if (g) { o.optGroup = g; o.optRank = r; }
  if (Object.keys(o).length) ov[occ.subKey] = o; else delete ov[occ.subKey];
  return [put('commitments', { ...c, overrides: ov, updatedAt: now })];
}

/** liga um item recém-criado como mais uma opção do horário de `baseOcc` (vira Opção B, C...) */
export async function linkOption(baseOcc, newKey) {
  const groups = optGroups(state);
  const g = baseOcc.opt?.g || `g${uid()}`;
  const ranks = groups.get(g) || [];
  const ops = [];
  if (!baseOcc.opt) ops.push(...optOps(baseOcc, g, 0));
  const next = occByKey(state, newKey);
  if (!next) return null;
  ops.push(...optOps(next, g, (ranks.length ? Math.max(...ranks) : 0) + 1));
  await commit(ops);
  return g;
}

/**
 * Tira uma ocorrência da agenda (deslizar para a esquerda / "não fiz"):
 * evento volta para "sem data"; visita, avulso e compromisso único saem; compromisso recorrente
 * é cancelado só naquela vez. O registro no Histórico some e, se o local só estava "visitado"
 * por causa deste item, volta a não visitado. Se era uma opção de Plano B e sobrou uma só,
 * a que sobrou vira um item normal. -> { remaining }
 */
export async function removeFromAgenda(occ) {
  const now = Date.now();
  const ops = [del('history', historyId(occ))];
  if (occ.kind === 'event') {
    const e = state.events.find((x) => x.id === occ.refId);
    if (e) {
      const { optGroup, optRank, ...rest } = e;
      ops.push(put('events', { ...rest, start: null, end: null, status: 'planned', doneAt: null, updatedAt: now }));
    }
  } else if (occ.kind === 'visit') {
    ops.push(del('visits', occ.refId));
  } else if (occ.kind === 'item') {
    ops.push(del('items', occ.refId));
  } else {
    const c = state.commitments.find((x) => x.id === occ.refId);
    if (c?.kind === 'once') ops.push(del('commitments', c.id));
    else if (c) ops.push(put('commitments', { ...c, overrides: { ...(c.overrides || {}), [occ.subKey]: { cancelled: true } }, updatedAt: now }));
  }
  if (occ.kind === 'event' || occ.kind === 'visit') ops.push(...unvisitOps(occ.placeId, occ.kind, occ.refId));
  let remaining = null;
  if (occ.opt) {
    const rest = optMembers(state, occ.opt.g, now).filter((o) => o.key !== occ.key);
    if (rest.length === 1) {
      remaining = rest[0];
      ops.push(...optOps(remaining, null));
    }
  }
  await commit(ops);
  await runSweep();
  return { remaining: remaining ? occByKey(state, remaining.key, now) : null };
}

/** "fiz esta opção": tira as outras opções do grupo e deixa só esta */
export async function keepOnlyOption(occ) {
  if (!occ.opt) return occ;
  const others = optMembers(state, occ.opt.g).filter((o) => o.key !== occ.key);
  for (const o of others) {
    const fresh = occByKey(state, o.key);
    if (fresh) await removeFromAgenda(fresh);
  }
  return occByKey(state, occ.key);
}

export async function unscheduleEvent(id) {
  const e = state.events.find((x) => x.id === id);
  if (!e) return;
  await commit([put('events', { ...e, start: null, end: null, status: 'planned', doneAt: null, updatedAt: Date.now() }), del('history', `h:event:${id}`)]);
}

// ---------- notificação de um item ----------

/** minutes: null = sem notificação; número = minutos antes do início */
export async function setRemind(kind, id, minutes) {
  const store = { event: 'events', visit: 'visits', item: 'items', commitment: 'commitments' }[kind];
  const rec = store && state[store].find((x) => x.id === id);
  if (!rec) return;
  await commit([put(store, { ...rec, remind: minutes, updatedAt: Date.now() })]);
}

// ---------- histórico ----------

export async function deleteHistory(id) {
  await commit([del('history', id)]);
}

// ---------- ajustes ----------

export async function updateSettings(patch) {
  await commit([put('meta', { key: 'settings', value: { ...state.settings, ...patch } })]);
}

// ---------- backup ----------

export async function exportData() {
  const photos = await db.getAll('photos');
  return {
    app: 'agentonator', format: 1, exportedAt: new Date().toISOString(),
    places: state.places, events: state.events, visits: state.visits,
    commitments: state.commitments, history: state.history, items: state.items,
    settings: state.settings, lastSweep: state.lastSweep, photos,
  };
}

/** registra que um backup foi exportado agora */
export async function markBackupDone() {
  await updateSettings({ lastBackupAt: Date.now(), backupSnoozeUntil: 0 });
}

export async function importData(data) {
  if (!data || data.app !== 'agentonator') throw new Error('Arquivo não é um backup do Agentonator.');
  const ops = [];
  for (const s of [...COLLECTIONS, 'photos']) ops.push({ type: 'clear', store: s });
  for (const s of COLLECTIONS) for (const v of data[s] || []) if (v && v.id && !(s === 'history' && !inHistory(v.kind))) ops.push(put(s, v)); // Histórico: só locais e eventos
  for (const p of data.photos || []) if (p && p.id && p.full) ops.push(put('photos', p));
  ops.push(put('meta', { key: 'settings', value: { ...DEFAULT_SETTINGS, ...(data.settings || {}) } }));
  ops.push(put('meta', { key: 'lastSweep', value: data.lastSweep || Date.now() }));
  await db.tx(ops);
  photoCache.clear();
  resetUndo();
  const fresh = await db.loadAll();
  for (const c of COLLECTIONS) state[c] = fresh[c] || [];
  for (const m of fresh.meta || []) applyOp(put('meta', m));
  writeMirror();
  emit();
  await runSweep();
}

/** resumo do que um arquivo de lista vai adicionar (para a confirmação) */
export function previewMerge(data) {
  const places = data.places || [];
  const events = data.events || [];
  return {
    title: data.title || 'Lista',
    places: places.length,
    visited: places.filter((p) => p.visited).length,
    events: events.length,
    done: events.filter((e) => e.done).length,
    visits: (data.visits || []).length,
    merges: (data.mergePlaces || []).map((m) => ({ keep: m.keep, names: m.names || [] })),
  };
}

/**
 * Junta locais repetidos num só (nome final = `keep`). Eventos, visitas e histórico dos repetidos
 * passam para o local que fica; favorito/Date/visitado/foto/endereço são aproveitados de qualquer um deles.
 * Retorna quantos grupos foram juntados.
 */
async function applyPlaceMerges(groups) {
  let merged = 0;
  for (const m of groups || []) {
    const wanted = new Set([...(m.names || []), m.keep].map(norm));
    const targets = state.places.filter((p) => wanted.has(norm(p.name)));
    if (!targets.length) continue;
    const score = (p) => (p.hasPhoto ? 8 : 0) + (p.address ? 4 : 0) + (norm(p.name) === norm(m.keep) ? 2 : 0)
      + state.events.filter((e) => e.placeId === p.id).length * 0.01;
    targets.sort((a, b) => score(b) - score(a));
    const [keep, ...others] = targets;
    const now = Date.now();
    const pick = (f) => keep[f] || others.map((o) => o[f]).find(Boolean) || null;
    const visitedAt = [keep, ...others].map((p) => p.visitedAt).filter(Boolean).sort((a, b) => a - b)[0] || null;
    const survivor = {
      ...keep, name: m.keep,
      address: pick('address') || '', category: pick('category'),
      favorite: targets.some((p) => p.favorite), isDate: targets.some((p) => p.isDate),
      visited: targets.some((p) => p.visited), visitedAt,
      visitedVia: keep.visitedVia || others.map((o) => o.visitedVia).find(Boolean) || null,
      updatedAt: now,
    };
    const ops = [];
    if (!keep.hasPhoto) {
      const withPhoto = others.find((o) => o.hasPhoto);
      if (withPhoto) {
        const full = await getPhoto(withPhoto.id);
        if (full) { ops.push(put('photos', { id: keep.id, full })); survivor.hasPhoto = true; survivor.thumb = withPhoto.thumb; }
      }
    }
    ops.push(put('places', survivor));
    const ids = new Set(others.map((o) => o.id));
    for (const e of state.events) if (ids.has(e.placeId)) ops.push(put('events', { ...e, placeId: keep.id, updatedAt: now }));
    for (const v of state.visits) if (ids.has(v.placeId)) ops.push(put('visits', { ...v, placeId: keep.id, updatedAt: now }));
    const keepHist = state.history.find((h) => h.id === `h:place:${keep.id}`);
    for (const h of state.history) {
      if (!ids.has(h.placeId)) continue;
      if (h.kind === 'place') {
        ops.push(del('history', h.id));
        if (!keepHist && survivor.visited && !ops.some((o) => o.value?.id === `h:place:${keep.id}`)) {
          ops.push(put('history', { ...h, id: `h:place:${keep.id}`, refId: keep.id, placeId: keep.id, title: survivor.name }));
        }
      } else {
        ops.push(put('history', { ...h, placeId: keep.id, subtitle: h.kind === 'event' ? survivor.name : h.subtitle }));
      }
    }
    if (keepHist) ops.push(put('history', { ...keepHist, title: survivor.name }));
    for (const o of others) { ops.push(del('places', o.id)); ops.push(del('photos', o.id)); }
    await commit(ops);
    if (others.length) merged++;
  }
  return merged;
}

/**
 * Importa uma lista ADICIONANDO ao que já existe (nada é apagado).
 * Itens com o mesmo nome (sem diferenciar acentos/maiúsculas) são ignorados — importar 2x não duplica.
 * Formato: { app:'agentonator', kind:'merge', places:[{name, category, address?, visited?}],
 *            events:[{name, place, category?, done?, start?: 'YYYY-MM-DDTHH:mm', durationMin?}],
 *            visits:[{place, start, durationMin?}] }
 */
export async function mergeImport(data) {
  if (!data || data.app !== 'agentonator' || data.kind !== 'merge') throw new Error('Este arquivo não é uma lista do Agentonator.');
  const now = Date.now();
  const ops = [];
  const summary = { placesAdded: 0, placesSkipped: 0, eventsAdded: 0, eventsSkipped: 0, visitsAdded: 0, visitsSkipped: 0, merged: 0 };
  summary.merged = await applyPlaceMerges(data.mergePlaces);
  const CATS = ['cultura', 'aventura', 'bares', 'outros'];
  const toTime = (s) => { if (!s) return null; const t = new Date(s).getTime(); return Number.isFinite(t) ? t : null; };

  const placeByName = new Map(state.places.map((p) => [norm(p.name), p]));
  const resolved = new Map(); // nome normalizado -> local (existente ou novo)
  for (const ip of data.places || []) {
    const name = String(ip.name || '').trim();
    if (!name) continue;
    const key = norm(name);
    if (resolved.has(key)) continue;
    const existing = placeByName.get(key);
    if (existing) { resolved.set(key, existing); summary.placesSkipped++; continue; }
    const p = {
      id: uid(), name, address: String(ip.address || '').trim(), category: CATS.includes(ip.category) ? ip.category : null,
      favorite: !!ip.favorite, isDate: !!ip.isDate, visited: !!ip.visited, visitedAt: null, visitedVia: ip.visited ? 'import' : null,
      thumb: null, hasPhoto: false, createdAt: now, updatedAt: now,
    };
    ops.push({ type: 'put', store: 'places', value: p });
    if (p.visited) {
      ops.push({ type: 'put', store: 'history', value: {
        id: `h:place:${p.id}`, kind: 'place', refId: p.id, placeId: p.id, title: p.name, subtitle: p.address,
        category: p.category, start: null, end: null, at: now, source: 'import',
      } });
    }
    resolved.set(key, p);
    summary.placesAdded++;
  }
  const findPlace = (name) => resolved.get(norm(name)) || placeByName.get(norm(name)) || null;

  const eventKeys = new Set(state.events.map((e) => `${e.placeId}|${norm(e.name)}`));
  for (const ie of data.events || []) {
    const name = String(ie.name || '').trim();
    const place = findPlace(ie.place);
    if (!name || !place) { summary.eventsSkipped++; continue; }
    const k = `${place.id}|${norm(name)}`;
    if (eventKeys.has(k)) { summary.eventsSkipped++; continue; }
    eventKeys.add(k);
    const start = toTime(ie.start);
    const e = {
      id: uid(), name, placeId: place.id, category: CATS.includes(ie.category) ? ie.category : null, favorite: !!ie.favorite, isDate: !!ie.isDate,
      start, end: start != null ? start + (Number(ie.durationMin) || 120) * 60_000 : null,
      status: ie.done ? 'done' : 'planned', doneAt: null, createdAt: now, updatedAt: now,
    };
    ops.push({ type: 'put', store: 'events', value: e });
    if (ie.done) {
      ops.push({ type: 'put', store: 'history', value: {
        id: `h:event:${e.id}`, kind: 'event', refId: e.id, placeId: place.id, title: e.name, subtitle: place.name,
        category: e.category, start: e.start, end: e.end, at: now, source: 'import',
      } });
    }
    summary.eventsAdded++;
  }

  const visitKeys = new Set(state.visits.map((v) => `${v.placeId}|${v.start}`));
  for (const iv of data.visits || []) {
    const place = findPlace(iv.place);
    const start = toTime(iv.start);
    if (!place || start == null || visitKeys.has(`${place.id}|${start}`)) { summary.visitsSkipped++; continue; }
    visitKeys.add(`${place.id}|${start}`);
    ops.push({ type: 'put', store: 'visits', value: {
      id: uid(), placeId: place.id, start, end: start + (Number(iv.durationMin) || 120) * 60_000,
      status: 'planned', doneAt: null, note: '', createdAt: now, updatedAt: now,
    } });
    summary.visitsAdded++;
  }

  await commit(ops); // uma única transação: entra tudo ou nada
  await runSweep();
  return summary;
}

export async function wipeAll() {
  const ops = [...COLLECTIONS, 'photos', 'meta'].map((s) => ({ type: 'clear', store: s }));
  await db.tx(ops);
  photoCache.clear();
  for (const c of COLLECTIONS) state[c] = [];
  state.settings = { ...DEFAULT_SETTINGS };
  try { localStorage.removeItem(MIRROR_KEY); } catch { /* ignore */ }
  await commit([put('meta', { key: 'lastSweep', value: Date.now() })]);
}

export { db };
