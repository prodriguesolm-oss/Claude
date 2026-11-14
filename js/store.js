// Estado do app + todas as ações que alteram dados.
// Regra de ouro: grava no IndexedDB primeiro; só depois atualiza a memória e a tela.
// Uma cópia de segurança (sem fotos) também fica no localStorage para recuperação.

import * as db from './db.js';
import { sweep, applyMove, historyFor, historyId } from './schedule.js';
import { uid } from './util.js';

export const DEFAULT_SETTINGS = {
  conflictPolicy: 'ask', // 'ask' | 'push-existing' | 'push-new' | 'overlap'
  sleepEnabled: true,
  sleepStart: 23 * 60,
  sleepEnd: 7 * 60,
  installHintDismissed: false,
};

const COLLECTIONS = ['places', 'events', 'visits', 'commitments', 'history'];
const MIRROR_KEY = 'agentonator.mirror.v1';

export const state = {
  places: [], events: [], visits: [], commitments: [], history: [],
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
      history: state.history, settings: state.settings, lastSweep: state.lastSweep,
    };
    localStorage.setItem(MIRROR_KEY, JSON.stringify(snap));
  } catch { /* cota cheia: o IndexedDB continua sendo a fonte principal */ }
}

async function commit(ops, { silent = false } = {}) {
  if (!ops.length) return;
  await db.tx(ops); // lança erro se não gravou -> nada muda na tela
  for (const op of ops) applyOp(op);
  writeMirror();
  if (!silent) emit();
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
        await commit(ops, { silent: true });
        state.restoredFromMirror = true;
      }
    } catch (e) { console.warn('mirror', e); }
  }

  if (!state.lastSweep) await commit([put('meta', { key: 'lastSweep', value: Date.now() })], { silent: true });
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
      ...r.places.map((v) => put('places', v)),
      ...r.history.filter((h) => !state.history.some((x) => x.id === h.id)).map((v) => put('history', v)),
    ];
    const changed = ops.length > 0;
    ops.push(put('meta', { key: 'lastSweep', value: now }));
    await commit(ops, { silent: !changed });
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

const STORE_OF = { place: 'places', event: 'events', commitment: 'commitments' };

export async function toggleFavorite(kind, id) {
  const store = STORE_OF[kind];
  const item = state[store].find((x) => x.id === id);
  if (!item) return false;
  const favorite = !item.favorite;
  await commit([put(store, { ...item, favorite, updatedAt: Date.now() })]);
  return favorite;
}

// ---------- eventos e visitas ----------

async function saveScheduled(store, kind, input, defaults) {
  const now = Date.now();
  const prev = input.id ? state[store].find((x) => x.id === input.id) : null;
  const rec = { ...defaults, status: 'planned', doneAt: null, ...prev, ...input, id: prev?.id || input.id || uid(), createdAt: prev?.createdAt || now, updatedAt: now };
  if (rec.start == null) { rec.start = null; rec.end = null; }
  const ops = [];
  const timeChanged = prev && (prev.start !== rec.start || prev.end !== rec.end);
  if (timeChanged && prev.status !== 'planned') {
    rec.status = 'planned'; rec.doneAt = null;
    ops.push(del('history', `h:${kind}:${rec.id}`));
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

// ---------- compromissos ----------

export async function saveCommitment(input) {
  const now = Date.now();
  const prev = input.id ? state.commitments.find((x) => x.id === input.id) : null;
  const c = {
    favorite: false, overrides: {}, status: null, untilDate: null,
    ...prev, ...input,
    id: prev?.id || input.id || uid(), createdAt: prev?.createdAt || now, updatedAt: now,
  };
  if (c.kind === 'weekly') { c.start = null; c.end = null; }
  else { c.slots = []; c.overrides = {}; }
  await commit([put('commitments', c)]);
  await runSweep();
  return c;
}

export async function deleteCommitment(id) { await commit([del('commitments', id)]); }

// ---------- ações sobre ocorrências da agenda ----------

/** moves: [{occ, start, end}] aplicados numa única transação */
export async function applyMoves(moves) {
  if (!moves.length) return;
  const now = Date.now();
  const working = { ...state, events: [...state.events], visits: [...state.visits], commitments: [...state.commitments] };
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
}

function markPlaceVisitedOps(placeId, at, via) {
  const p = placeId && findPlace(placeId);
  if (!p || p.visited) return [];
  return [put('places', { ...p, visited: true, visitedAt: at, visitedVia: via, updatedAt: Date.now() })];
}

/** status: 'done' | 'missed' | 'planned' */
export async function setOccStatus(occ, status) {
  const now = Date.now();
  const ops = [];
  if (occ.kind === 'event' || occ.kind === 'visit') {
    const store = occ.kind === 'event' ? 'events' : 'visits';
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
  if (status === 'done') {
    const at = Math.min(now, occ.end);
    ops.push(put('history', historyFor(occ, 'manual', at)));
    ops.push(...markPlaceVisitedOps(occ.placeId, at, occ.kind));
  } else {
    ops.push(del('history', historyId(occ)));
  }
  await commit(ops);
}

/** cancela só esta ocorrência de um compromisso semanal */
export async function cancelOccurrence(occ) {
  const c = state.commitments.find((x) => x.id === occ.refId);
  if (!c || c.kind !== 'weekly') return;
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

export async function unscheduleEvent(id) {
  const e = state.events.find((x) => x.id === id);
  if (!e) return;
  await commit([put('events', { ...e, start: null, end: null, status: 'planned', doneAt: null, updatedAt: Date.now() }), del('history', `h:event:${id}`)]);
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
    commitments: state.commitments, history: state.history,
    settings: state.settings, lastSweep: state.lastSweep, photos,
  };
}

export async function importData(data) {
  if (!data || data.app !== 'agentonator') throw new Error('Arquivo não é um backup do Agentonator.');
  const ops = [];
  for (const s of [...COLLECTIONS, 'photos']) ops.push({ type: 'clear', store: s });
  for (const s of COLLECTIONS) for (const v of data[s] || []) if (v && v.id) ops.push(put(s, v));
  for (const p of data.photos || []) if (p && p.id && p.full) ops.push(put('photos', p));
  ops.push(put('meta', { key: 'settings', value: { ...DEFAULT_SETTINGS, ...(data.settings || {}) } }));
  ops.push(put('meta', { key: 'lastSweep', value: data.lastSweep || Date.now() }));
  await db.tx(ops);
  photoCache.clear();
  const fresh = await db.loadAll();
  for (const c of COLLECTIONS) state[c] = fresh[c] || [];
  for (const m of fresh.meta || []) applyOp(put('meta', m));
  writeMirror();
  emit();
  await runSweep();
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
