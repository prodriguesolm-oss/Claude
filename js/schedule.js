// Lógica pura da agenda (sem DOM): ocorrências, recorrência semanal com exceções,
// conflitos, empurrar horários e conclusão automática -> histórico.
//
// Modelo de "ocorrência" (o que aparece na agenda):
// { key, kind: 'event'|'visit'|'commitment', refId, subKey?, slotId?, origDate?,
//   title, subtitle, placeId, category, favorite, start, end, status, recurring, overridden }
//
// Compromisso semanal: { kind:'weekly', slots:[{id, days:[0..6], startMin, endMin}],
//   startDate, untilDate, overrides: { 'slotId|YYYY-MM-DD': {start,end}|{cancelled}|{status} } }
// Uma alteração numa semana específica vira um "override" daquela ocorrência e
// NÃO altera a série: as demais semanas continuam no horário padrão.

import { MIN, DAY, dateKey, startOfDay, addDays, atMinutes, parseDateKey } from './time.js';

export const KIND_LABEL = { event: 'Evento', visit: 'Local', commitment: 'Compromisso', place: 'Local' };

export const overlaps = (a, b) => a.start < b.end && b.start < a.end;

export function slotDurMin(slot) {
  let d = slot.endMin - slot.startMin;
  if (d <= 0) d += 1440; // termina no dia seguinte
  return d;
}

export const occKeyOf = (slotId, dk) => `${slotId}|${dk}`;

function derive(status, start, end, now) {
  if (status === 'done' || status === 'missed') return status;
  if (end <= now) return 'done';
  if (start <= now) return 'ongoing';
  return 'planned';
}

export const placeMap = (state) => new Map(state.places.map((p) => [p.id, p]));

export function eventOcc(e, places, now) {
  const p = places.get(e.placeId);
  return {
    key: `event:${e.id}`, kind: 'event', refId: e.id,
    title: e.name || p?.name || 'Evento', subtitle: p?.name || 'Local removido',
    placeId: e.placeId, category: e.category || null, favorite: !!e.favorite,
    start: e.start, end: e.end, status: derive(e.status, e.start, e.end, now), recurring: false,
  };
}

export function visitOcc(v, places, now) {
  const p = places.get(v.placeId);
  return {
    key: `visit:${v.id}`, kind: 'visit', refId: v.id,
    title: p ? p.name : 'Local removido', subtitle: p?.address || 'Visita ao local',
    placeId: v.placeId, category: p?.category || null, favorite: !!p?.favorite,
    start: v.start, end: v.end, status: derive(v.status, v.start, v.end, now), recurring: false,
  };
}

function slotInRange(c, slot, dk, wd) {
  if (!slot.days || !slot.days.includes(wd)) return false;
  if (c.startDate && dk < c.startDate) return false;
  if (c.untilDate && dk > c.untilDate) return false;
  return true;
}

function weeklyOcc(c, slot, dk, start, end, o, now) {
  const subKey = occKeyOf(slot.id, dk);
  return {
    key: `commitment:${c.id}:${subKey}`, kind: 'commitment', refId: c.id, subKey, slotId: slot.id, origDate: dk,
    title: c.name || 'Compromisso', subtitle: 'Semanal', placeId: null, category: null, favorite: !!c.favorite,
    start, end, status: derive(o?.status, start, end, now), recurring: true, overridden: !!(o && o.start != null),
  };
}

export function commitmentOccs(c, from, to, now) {
  const out = [];
  if (c.kind === 'once') {
    if (c.start != null && c.end != null && c.start < to && c.end > from) {
      out.push({
        key: `commitment:${c.id}:once`, kind: 'commitment', refId: c.id, subKey: 'once',
        title: c.name || 'Compromisso', subtitle: 'Compromisso único', placeId: null, category: null,
        favorite: !!c.favorite, start: c.start, end: c.end, status: derive(c.status, c.start, c.end, now), recurring: false,
      });
    }
    return out;
  }
  const slots = c.slots || [];
  if (!slots.length) return out;
  const ov = c.overrides || {};
  // 1) ocorrências no horário padrão (as que têm horário próprio vêm no passo 2)
  for (let d = addDays(startOfDay(from), -1); d < to; d = addDays(d, 1)) {
    const dk = dateKey(d);
    const wd = new Date(d).getDay();
    for (const slot of slots) {
      if (!slotInRange(c, slot, dk, wd)) continue;
      const o = ov[occKeyOf(slot.id, dk)];
      if (o && (o.cancelled || o.start != null)) continue;
      const start = atMinutes(dk, slot.startMin);
      const end = start + slotDurMin(slot) * MIN;
      if (start < to && end > from) out.push(weeklyOcc(c, slot, dk, start, end, o, now));
    }
  }
  // 2) ocorrências remarcadas (podem ter ido para outro dia)
  for (const [k, o] of Object.entries(ov)) {
    if (!o || o.cancelled || o.start == null || o.end == null) continue;
    if (!(o.start < to && o.end > from)) continue;
    const [slotId, dk] = k.split('|');
    const slot = slots.find((s) => s.id === slotId);
    if (!slot || !slotInRange(c, slot, dk, parseDateKey(dk).getDay())) continue;
    out.push(weeklyOcc(c, slot, dk, o.start, o.end, o, now));
  }
  return out;
}

/** todas as ocorrências que tocam o intervalo [from, to) */
export function expand(state, from, to, now = Date.now()) {
  const places = placeMap(state);
  const out = [];
  for (const e of state.events) {
    if (e.start == null || e.end == null) continue;
    if (e.start < to && e.end > from) out.push(eventOcc(e, places, now));
  }
  for (const v of state.visits) {
    if (v.start == null || v.end == null) continue;
    if (v.start < to && v.end > from) out.push(visitOcc(v, places, now));
  }
  for (const c of state.commitments) out.push(...commitmentOccs(c, from, to, now));
  out.sort((a, b) => a.start - b.start || a.end - b.end || a.title.localeCompare(b.title));
  return out;
}

/** reconstrói uma ocorrência a partir da chave (ex.: para reabrir a ficha após mudanças) */
export function occByKey(state, key, now = Date.now()) {
  const [kind, id, sub] = String(key).split(':');
  const places = placeMap(state);
  if (kind === 'event') {
    const e = state.events.find((x) => x.id === id);
    return e && e.start != null ? eventOcc(e, places, now) : null;
  }
  if (kind === 'visit') {
    const v = state.visits.find((x) => x.id === id);
    return v ? visitOcc(v, places, now) : null;
  }
  if (kind === 'commitment') {
    const c = state.commitments.find((x) => x.id === id);
    if (!c) return null;
    if (sub === 'once') return commitmentOccs(c, -Infinity, Infinity, now)[0] || null;
    const [slotId, dk] = String(sub).split('|');
    const slot = (c.slots || []).find((s) => s.id === slotId);
    if (!slot) return null;
    const o = (c.overrides || {})[sub];
    if (o?.cancelled) return null;
    const start = o?.start ?? atMinutes(dk, slot.startMin);
    const end = o?.end ?? start + slotDurMin(slot) * MIN;
    return weeklyOcc(c, slot, dk, start, end, o, now);
  }
  return null;
}

export function nextOccurrence(c, now = Date.now()) {
  return commitmentOccs(c, now, now + 15 * DAY, now)
    .filter((o) => o.end > now && o.status !== 'missed')
    .sort((a, b) => a.start - b.start)[0] || null;
}

const blocking = (o) => o.status !== 'done' && o.status !== 'missed';

/** ocorrências que se sobrepõem ao candidato (ignora concluídas/canceladas) */
export function findConflicts(occs, cand) {
  return occs.filter((o) => o.key !== cand.key && blocking(o) && overlaps(o, cand));
}

/** Política "adiar o existente": empurra, em cascata, o que colidir para depois do candidato. */
export function planPushExisting(occs, cand) {
  const fixed = [{ start: cand.start, end: cand.end }];
  let pool = occs.filter((o) => o.key !== cand.key && blocking(o));
  const moves = [];
  for (let guard = 0; guard < 80; guard++) {
    const hits = pool.filter((o) => fixed.some((f) => overlaps(f, o))).sort((a, b) => a.start - b.start);
    if (!hits.length) break;
    const hit = hits[0];
    const dur = hit.end - hit.start;
    let s = Math.max(...fixed.filter((f) => overlaps(f, hit)).map((f) => f.end));
    for (let j = 0; j < 80; j++) {
      const over = fixed.filter((f) => overlaps(f, { start: s, end: s + dur }));
      if (!over.length) break;
      s = Math.max(...over.map((f) => f.end));
    }
    moves.push({ occ: hit, start: s, end: s + dur });
    pool = pool.filter((o) => o !== hit);
    fixed.push({ start: s, end: s + dur });
  }
  return moves;
}

/** Política "adiar o novo": coloca o candidato no primeiro espaço livre a partir do horário pedido. */
export function planPushNew(occs, cand) {
  const pool = occs.filter((o) => o.key !== cand.key && blocking(o));
  const dur = cand.end - cand.start;
  let s = cand.start;
  for (let guard = 0; guard < 200; guard++) {
    const hits = pool.filter((o) => overlaps(o, { start: s, end: s + dur }));
    if (!hits.length) break;
    s = Math.max(...hits.map((h) => h.end));
  }
  return { start: s, end: s + dur };
}

export function historyId(occ) {
  return occ.kind === 'commitment' ? `h:commitment:${occ.refId}:${occ.subKey}` : `h:${occ.kind}:${occ.refId}`;
}

export function historyFor(occ, source, at) {
  return {
    id: historyId(occ), kind: occ.kind, refId: occ.refId, subKey: occ.subKey || null,
    placeId: occ.placeId || null, title: occ.title, subtitle: occ.subtitle || '',
    category: occ.category || null, start: occ.start, end: occ.end, at, source,
  };
}

/**
 * Calcula o registro atualizado ao mover uma ocorrência.
 * Retorna { store, value, clearedHistory } — clearedHistory = id do histórico a remover (se havia conclusão).
 */
export function applyMove(state, occ, start, end, now = Date.now()) {
  const hid = historyId(occ);
  if (occ.kind === 'event' || occ.kind === 'visit') {
    const store = occ.kind === 'event' ? 'events' : 'visits';
    const rec = state[store].find((x) => x.id === occ.refId);
    const wasClosed = rec.status === 'done' || rec.status === 'missed';
    return {
      store,
      value: { ...rec, start, end, status: 'planned', doneAt: null, updatedAt: now },
      clearedHistory: wasClosed ? hid : null,
    };
  }
  const c = state.commitments.find((x) => x.id === occ.refId);
  if (c.kind === 'once') {
    return { store: 'commitments', value: { ...c, start, end, status: null, updatedAt: now }, clearedHistory: c.status ? hid : null };
  }
  const ov = { ...(c.overrides || {}) };
  const slot = c.slots.find((s) => s.id === occ.slotId);
  const origStart = atMinutes(occ.origDate, slot.startMin);
  const origEnd = origStart + slotDurMin(slot) * MIN;
  const prev = ov[occ.subKey] || {};
  const hadStatus = !!prev.status;
  const next = { ...prev, start, end };
  delete next.status;
  delete next.cancelled;
  if (start === origStart && end === origEnd) {
    delete next.start;
    delete next.end;
  }
  if (Object.keys(next).length) ov[occ.subKey] = next;
  else delete ov[occ.subKey];
  return { store: 'commitments', value: { ...c, overrides: ov, updatedAt: now }, clearedHistory: hadStatus ? hid : null };
}

/**
 * Varredura de conclusão automática: tudo que tinha horário, já terminou e não foi alterado
 * é marcado como feito e vai para o histórico. Locais de eventos/visitas concluídos ficam "visitados".
 */
export function sweep(state, now, lastSweep) {
  const places = placeMap(state);
  const res = { events: [], visits: [], places: [], history: [] };
  const touched = new Map();
  const markPlace = (pid, at, via) => {
    const p = touched.get(pid) || places.get(pid);
    if (!p || p.visited) return;
    touched.set(pid, { ...p, visited: true, visitedAt: at, visitedVia: via, updatedAt: now });
  };
  for (const e of state.events) {
    if ((e.status || 'planned') !== 'planned' || e.start == null || e.end == null || e.end > now) continue;
    const ne = { ...e, status: 'done', doneAt: e.end, updatedAt: now };
    res.events.push(ne);
    res.history.push(historyFor(eventOcc(ne, places, now), 'auto', e.end));
    markPlace(e.placeId, e.end, 'event');
  }
  for (const v of state.visits) {
    if ((v.status || 'planned') !== 'planned' || v.start == null || v.end == null || v.end > now) continue;
    const nv = { ...v, status: 'done', doneAt: v.end, updatedAt: now };
    res.visits.push(nv);
    res.history.push(historyFor(visitOcc(nv, places, now), 'auto', v.end));
    markPlace(v.placeId, v.end, 'visit');
  }
  for (const c of state.commitments) {
    const from = Math.max(lastSweep || 0, c.createdAt || 0);
    if (from >= now) continue;
    for (const o of commitmentOccs(c, from, now, now)) {
      if (o.end <= from || o.end > now || o.status === 'missed') continue;
      if (c.createdAt && o.start < c.createdAt) continue; // já tinha começado antes do cadastro
      res.history.push(historyFor(o, 'auto', o.end));
    }
  }
  res.places = [...touched.values()];
  return res;
}

/** distribui blocos sobrepostos em colunas (visual da agenda do dia) */
export function layoutColumns(items) {
  items.sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const cols = [];
    for (const it of cluster) {
      let i = cols.findIndex((end) => end <= it.s);
      if (i < 0) { i = cols.length; cols.push(it.e); } else cols[i] = it.e;
      it.col = i;
    }
    for (const it of cluster) {
      it.cols = cols.length;
      it.conflict = cluster.some((o) => o !== it && o.s < it.e && it.s < o.e && blocking(o.o) && blocking(it.o));
    }
  };
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) { flush(); cluster = []; clusterEnd = -Infinity; }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
  return items;
}
