// Lógica pura da agenda (sem DOM): ocorrências, recorrência semanal com exceções,
// conflitos, empurrar horários e conclusão automática -> histórico.
//
// Modelo de "ocorrência" (o que aparece na agenda):
// { key, kind: 'event'|'visit'|'commitment', refId, subKey?, slotId?, origDate?,
//   title, subtitle, placeId, category, favorite, start, end, status, recurring, overridden }
//
// Compromisso recorrente: { kind:'daily'|'weekly'|'monthly', slots:[{id, days?:[0..6], monthDays?:[1..31], startMin, endMin}],
//   startDate, untilDate, overrides: { 'slotId|YYYY-MM-DD': {start,end}|{cancelled}|{status} } }
//   - daily: todo dia; weekly: nos dias da semana em `days`; monthly: nos dias do mês em `monthDays`
//     (dia 29–31 em mês mais curto = último dia do mês).
// Compromisso único: { kind:'once', start, end }.
// Uma alteração numa ocorrência específica vira um "override" só dela e
// NÃO altera a série: as demais ocorrências continuam no horário padrão.
// Horário avulso (item): { id, title, note, start, end, status } — só título e hora, sem local.
//
// Plano B (opções para o mesmo horário): eventos, visitas, avulsos e compromissos únicos podem ter
// { optGroup, optRank }; numa ocorrência de compromisso recorrente isso fica no override dela.
// Itens do mesmo grupo aparecem lado a lado como Opção A, B... sem aviso de sobreposição.
// Depois do horário, enquanto houver mais de uma opção, o status fica 'choose' (escolha qual fez)
// e nada vai para o histórico até sobrar uma só.

import { MIN, DAY, dateKey, startOfDay, addDays, atMinutes, parseDateKey, fmtHM, dayLabel, leadPhrase } from './time.js';

export const KIND_LABEL = { event: 'Evento', visit: 'Local', commitment: 'Compromisso', place: 'Local', item: 'Avulso' };
export const FREQ_LABEL = { daily: 'Diário', weekly: 'Semanal', monthly: 'Mensal', once: 'Único' };
/** "só nesta semana", "só neste dia"... */
export const SCOPE_LABEL = { daily: 'neste dia', weekly: 'nesta semana', monthly: 'neste mês', once: 'desta vez' };
export const isRecurring = (c) => c && c.kind !== 'once';
const STORE_OF_KIND = { event: 'events', visit: 'visits', item: 'items' };

export const overlaps = (a, b) => a.start < b.end && b.start < a.end;

export function slotDurMin(slot) {
  let d = slot.endMin - slot.startMin;
  if (d <= 0) d += 1440; // termina no dia seguinte
  return d;
}

export const occKeyOf = (slotId, dk) => `${slotId}|${dk}`;

function derive(status, start, end, now, multi = false) {
  if (status === 'done' || status === 'missed') return status;
  if (end <= now) return multi ? 'choose' : 'done';
  if (start <= now) return 'ongoing';
  return 'planned';
}

export const placeMap = (state) => new Map(state.places.map((p) => [p.id, p]));

/** cor do bloco: pela classificação (locais/eventos); compromissos e avulsos têm cor própria */
export function colorOf(o) {
  if (o.kind === 'commitment') return 'commitment';
  if (o.kind === 'item') return 'item';
  return o.category || 'none';
}

/**
 * Grupos de opções (Plano B) com membros "vivos": g -> ranks ordenados.
 * Vivo = está na agenda e não foi marcado como "não aconteceu".
 */
export function optGroups(state) {
  const m = new Map();
  const add = (g, r) => { if (!g) return; if (!m.has(g)) m.set(g, []); m.get(g).push(r || 0); };
  for (const e of state.events) if (e.optGroup && e.start != null && e.status !== 'missed') add(e.optGroup, e.optRank);
  for (const v of state.visits) if (v.optGroup && v.status !== 'missed') add(v.optGroup, v.optRank);
  for (const it of state.items || []) if (it.optGroup && it.start != null && it.status !== 'missed') add(it.optGroup, it.optRank);
  for (const c of state.commitments) {
    if (c.kind === 'once') { if (c.optGroup && c.start != null && c.status !== 'missed') add(c.optGroup, c.optRank); continue; }
    for (const o of Object.values(c.overrides || {})) if (o?.optGroup && !o.cancelled && o.status !== 'missed') add(o.optGroup, o.optRank);
  }
  for (const ranks of m.values()) ranks.sort((a, b) => a - b);
  return m;
}

const LETTERS = 'ABCDEFGHIJ';
function optInfo(rec, groups) {
  const g = rec?.optGroup;
  if (!g) return { opt: null, multi: false };
  const ranks = groups?.get(g) || [];
  const r = rec.optRank || 0;
  const i = ranks.indexOf(r);
  return { opt: { g, r, letter: LETTERS[i >= 0 ? i : 0] || '?', of: ranks.length }, multi: ranks.length > 1 };
}

export function eventOcc(e, places, now, groups) {
  const p = places.get(e.placeId);
  const { opt, multi } = optInfo(e, groups);
  return {
    key: `event:${e.id}`, kind: 'event', refId: e.id,
    title: e.name || p?.name || 'Evento', subtitle: p?.name || 'Local removido',
    placeId: e.placeId, category: e.category || p?.category || null, favorite: !!e.favorite,
    start: e.start, end: e.end, status: derive(e.status, e.start, e.end, now, multi), recurring: false, remind: e.remind ?? null, opt,
  };
}

export function visitOcc(v, places, now, groups) {
  const p = places.get(v.placeId);
  const { opt, multi } = optInfo(v, groups);
  return {
    key: `visit:${v.id}`, kind: 'visit', refId: v.id,
    title: p ? p.name : 'Local removido', subtitle: p?.address || 'Visita ao local',
    placeId: v.placeId, category: p?.category || null, favorite: !!p?.favorite,
    start: v.start, end: v.end, status: derive(v.status, v.start, v.end, now, multi), recurring: false, remind: v.remind ?? null, opt,
  };
}

export function itemOcc(it, now, groups) {
  const { opt, multi } = optInfo(it, groups);
  return {
    key: `item:${it.id}`, kind: 'item', refId: it.id,
    title: it.title || 'Sem título', subtitle: it.note || '',
    placeId: null, category: null, favorite: false,
    start: it.start, end: it.end, status: derive(it.status, it.start, it.end, now, multi), recurring: false, remind: it.remind ?? null, opt,
  };
}

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

/** a ocorrência deste horário (slot) acontece na data dk? */
export function slotMatches(c, slot, dk) {
  if (c.startDate && dk < c.startDate) return false;
  if (c.untilDate && dk > c.untilDate) return false;
  const d = parseDateKey(dk);
  if (c.kind === 'daily') return true;
  if (c.kind === 'monthly') {
    const dim = daysInMonth(d.getFullYear(), d.getMonth());
    return (slot.monthDays || []).some((md) => Math.min(md, dim) === d.getDate());
  }
  return !!slot.days && slot.days.includes(d.getDay());
}

function recurringOcc(c, slot, dk, start, end, o, now, groups) {
  const subKey = occKeyOf(slot.id, dk);
  const { opt, multi } = optInfo(o, groups);
  return {
    key: `commitment:${c.id}:${subKey}`, kind: 'commitment', refId: c.id, subKey, slotId: slot.id, origDate: dk,
    freq: c.kind, title: c.name || 'Compromisso', subtitle: FREQ_LABEL[c.kind] || 'Semanal', placeId: null, category: null, favorite: false,
    start, end, status: derive(o?.status, start, end, now, multi), recurring: true, overridden: !!(o && o.start != null), remind: c.remind ?? null, opt,
  };
}

export function commitmentOccs(c, from, to, now, groups) {
  const out = [];
  if (c.kind === 'once') {
    if (c.start != null && c.end != null && c.start < to && c.end > from) {
      const { opt, multi } = optInfo(c, groups);
      out.push({
        key: `commitment:${c.id}:once`, kind: 'commitment', refId: c.id, subKey: 'once',
        freq: 'once', title: c.name || 'Compromisso', subtitle: 'Compromisso único', placeId: null, category: null,
        favorite: false, start: c.start, end: c.end, status: derive(c.status, c.start, c.end, now, multi), recurring: false, remind: c.remind ?? null, opt,
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
    for (const slot of slots) {
      if (!slotMatches(c, slot, dk)) continue;
      const o = ov[occKeyOf(slot.id, dk)];
      if (o && (o.cancelled || o.start != null)) continue;
      const start = atMinutes(dk, slot.startMin);
      const end = start + slotDurMin(slot) * MIN;
      if (start < to && end > from) out.push(recurringOcc(c, slot, dk, start, end, o, now, groups));
    }
  }
  // 2) ocorrências remarcadas (podem ter ido para outro dia)
  for (const [k, o] of Object.entries(ov)) {
    if (!o || o.cancelled || o.start == null || o.end == null) continue;
    if (!(o.start < to && o.end > from)) continue;
    const [slotId, dk] = k.split('|');
    const slot = slots.find((s) => s.id === slotId);
    if (!slot || !slotMatches(c, slot, dk)) continue;
    out.push(recurringOcc(c, slot, dk, o.start, o.end, o, now, groups));
  }
  return out;
}

/** todas as ocorrências que tocam o intervalo [from, to) */
export function expand(state, from, to, now = Date.now()) {
  const places = placeMap(state);
  const groups = optGroups(state);
  const out = [];
  for (const e of state.events) {
    if (e.start == null || e.end == null) continue;
    if (e.start < to && e.end > from) out.push(eventOcc(e, places, now, groups));
  }
  for (const v of state.visits) {
    if (v.start == null || v.end == null) continue;
    if (v.start < to && v.end > from) out.push(visitOcc(v, places, now, groups));
  }
  for (const it of state.items || []) {
    if (it.start == null || it.end == null) continue;
    if (it.start < to && it.end > from) out.push(itemOcc(it, now, groups));
  }
  for (const c of state.commitments) out.push(...commitmentOccs(c, from, to, now, groups));
  out.sort((a, b) => a.start - b.start || a.end - b.end || (a.opt?.r ?? 0) - (b.opt?.r ?? 0) || a.title.localeCompare(b.title));
  return out;
}

/** todas as ocorrências (vivas) de um grupo de opções */
export function optMembers(state, g, now = Date.now()) {
  if (!g) return [];
  const out = [];
  const keys = [];
  for (const e of state.events) if (e.optGroup === g) keys.push(`event:${e.id}`);
  for (const v of state.visits) if (v.optGroup === g) keys.push(`visit:${v.id}`);
  for (const it of state.items || []) if (it.optGroup === g) keys.push(`item:${it.id}`);
  for (const c of state.commitments) {
    if (c.kind === 'once') { if (c.optGroup === g) keys.push(`commitment:${c.id}:once`); continue; }
    for (const [k, o] of Object.entries(c.overrides || {})) if (o?.optGroup === g) keys.push(`commitment:${c.id}:${k}`);
  }
  for (const k of keys) {
    const o = occByKey(state, k, now);
    if (o && o.status !== 'missed') out.push(o);
  }
  return out.sort((a, b) => (a.opt?.r ?? 0) - (b.opt?.r ?? 0));
}

/** reconstrói uma ocorrência a partir da chave (ex.: para reabrir a ficha após mudanças) */
export function occByKey(state, key, now = Date.now()) {
  const [kind, id, sub] = String(key).split(':');
  const places = placeMap(state);
  const groups = optGroups(state);
  if (kind === 'event') {
    const e = state.events.find((x) => x.id === id);
    return e && e.start != null ? eventOcc(e, places, now, groups) : null;
  }
  if (kind === 'visit') {
    const v = state.visits.find((x) => x.id === id);
    return v ? visitOcc(v, places, now, groups) : null;
  }
  if (kind === 'item') {
    const it = (state.items || []).find((x) => x.id === id);
    return it && it.start != null ? itemOcc(it, now, groups) : null;
  }
  if (kind === 'commitment') {
    const c = state.commitments.find((x) => x.id === id);
    if (!c) return null;
    if (sub === 'once') return commitmentOccs(c, -Infinity, Infinity, now, groups)[0] || null;
    const [slotId, dk] = String(sub).split('|');
    const slot = (c.slots || []).find((s) => s.id === slotId);
    if (!slot) return null;
    const o = (c.overrides || {})[sub];
    if (o?.cancelled) return null;
    const start = o?.start ?? atMinutes(dk, slot.startMin);
    const end = o?.end ?? start + slotDurMin(slot) * MIN;
    return recurringOcc(c, slot, dk, start, end, o, now, groups);
  }
  return null;
}

export function nextOccurrence(c, now = Date.now()) {
  return commitmentOccs(c, now, now + 15 * DAY, now)
    .filter((o) => o.end > now && o.status !== 'missed')
    .sort((a, b) => a.start - b.start)[0] || null;
}

const blocking = (o) => o.status !== 'done' && o.status !== 'missed';
/** opções do mesmo Plano B não "brigam" entre si */
const sameGroup = (o, cand) => !!(cand.optGroup && o.opt?.g === cand.optGroup);
const others = (o, cand) => o.key !== cand.key && blocking(o) && !sameGroup(o, cand);

/** ocorrências que se sobrepõem ao candidato (ignora concluídas/canceladas e opções do mesmo grupo) */
export function findConflicts(occs, cand) {
  return occs.filter((o) => others(o, cand) && overlaps(o, cand));
}

/** Política "adiar o existente": empurra, em cascata, o que colidir para depois do candidato. */
export function planPushExisting(occs, cand) {
  const fixed = [{ start: cand.start, end: cand.end }];
  let pool = occs.filter((o) => others(o, cand));
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

/**
 * Política padrão "adiar o que vem depois": empurra, em cascata, só os itens que começam
 * junto ou DEPOIS do candidato e antes de `until` (fim do dia). O que começou antes fica onde
 * está (vira sobreposição, com aviso) e nada de outros dias é tocado.
 * `prev` = intervalo antigo do candidato: o que já estava sobreposto a ele antes continua como estava.
 */
export function planCascade(occs, cand, { until = Infinity, prev = null } = {}) {
  const pool = occs.filter((o) => others(o, cand)
    && o.start >= cand.start && o.start < until
    && !(prev && overlaps(o, prev)));
  return planPushExisting(pool, cand);
}

/**
 * "Só encurtar o vizinho": quem vem depois começa quando o candidato termina (o fim dele fica igual);
 * quem começou antes termina quando o candidato começa. O resto da agenda não muda.
 * Retorna null quando não dá (o vizinho ficaria com menos de `minDur`, ou o candidato cai no meio dele).
 */
export function planTrim(occs, cand, { prev = null, minDur = 15 * MIN } = {}) {
  const hits = findConflicts(occs, cand).filter((o) => !(prev && overlaps(o, prev)));
  if (!hits.length) return null;
  const moves = [];
  for (const o of hits) {
    if (o.start >= cand.start) {
      if (o.end - cand.end < minDur) return null;
      moves.push({ occ: o, start: cand.end, end: o.end });
    } else {
      if (o.end > cand.end || cand.start - o.start < minDur) return null;
      moves.push({ occ: o, start: o.start, end: cand.start });
    }
  }
  return moves;
}

/**
 * "Adiantar": puxa para mais cedo, em `delta` ms, o próximo item (com as opções do grupo dele)
 * ou todos os itens que começam a partir dele, até `until` (fim do dia).
 */
export function planPull(occs, next, delta, { all = false, until = Infinity } = {}) {
  const pool = occs.filter((o) => blocking(o) && o.start >= next.start && o.start < until);
  const chosen = all ? pool : pool.filter((o) => o.key === next.key || (next.opt && o.opt?.g === next.opt.g));
  return chosen.map((o) => ({ occ: o, start: o.start - delta, end: o.end - delta }));
}

/**
 * Espaço livre logo depois de `t` no mesmo dia: o próximo item que começa em/depois de `t`
 * e o fim do que vem imediatamente antes dele. -> { next, from, gap } | null
 */
export function gapAfter(occs, t, { until = Infinity, excludeKey = null } = {}) {
  const live = occs.filter((o) => blocking(o) && o.key !== excludeKey);
  const next = live.filter((o) => o.start >= t && o.start < until).sort((a, b) => a.start - b.start)[0];
  if (!next) return null;
  const before = live.filter((o) => o !== next && o.start < next.start && o.end <= next.start && !(next.opt && o.opt?.g === next.opt.g));
  const from = Math.max(t, ...before.map((o) => o.end));
  return { next, from, gap: next.start - from };
}

/** Política "adiar o novo": coloca o candidato no primeiro espaço livre a partir do horário pedido. */
export function planPushNew(occs, cand) {
  const pool = occs.filter((o) => others(o, cand));
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
  if (STORE_OF_KIND[occ.kind]) {
    const store = STORE_OF_KIND[occ.kind];
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
 * Varredura de conclusão automática: eventos, visitas e horários avulsos que já terminaram sem
 * alteração são marcados como feitos e vão para o histórico (compromissos, não). Locais de eventos/visitas concluídos ficam "visitados".
 */
export function sweep(state, now, lastSweep) {
  const places = placeMap(state);
  const groups = optGroups(state);
  const undecided = (rec) => !!(rec.optGroup && (groups.get(rec.optGroup)?.length || 0) > 1); // Plano B ainda sem escolha
  const res = { events: [], visits: [], items: [], places: [], history: [] };
  const touched = new Map();
  const markPlace = (pid, at, via) => {
    const p = touched.get(pid) || places.get(pid);
    if (!p || p.visited) return;
    touched.set(pid, { ...p, visited: true, visitedAt: at, visitedVia: via, updatedAt: now });
  };
  for (const e of state.events) {
    if ((e.status || 'planned') !== 'planned' || e.start == null || e.end == null || e.end > now || undecided(e)) continue;
    const ne = { ...e, status: 'done', doneAt: e.end, updatedAt: now };
    res.events.push(ne);
    res.history.push(historyFor(eventOcc(ne, places, now), 'auto', e.end));
    markPlace(e.placeId, e.end, 'event');
  }
  for (const v of state.visits) {
    if ((v.status || 'planned') !== 'planned' || v.start == null || v.end == null || v.end > now || undecided(v)) continue;
    const nv = { ...v, status: 'done', doneAt: v.end, updatedAt: now };
    res.visits.push(nv);
    res.history.push(historyFor(visitOcc(nv, places, now), 'auto', v.end));
    markPlace(v.placeId, v.end, 'visit');
  }
  for (const it of state.items || []) {
    if ((it.status || 'planned') !== 'planned' || it.start == null || it.end == null || it.end > now || undecided(it)) continue;
    const ni = { ...it, status: 'done', doneAt: it.end, updatedAt: now };
    res.items.push(ni);
    res.history.push(historyFor(itemOcc(ni, now), 'auto', it.end));
  }
  // compromissos (rotina) aparecem como feitos na agenda, mas não vão para o Histórico
  res.places = [...touched.values()];
  return res;
}

/**
 * Lembretes a enviar pelo servidor de notificações: um por ocorrência com notificação ligada,
 * nos próximos `days` dias (o app re-sincroniza sempre que é aberto ou algo muda).
 */
export function computeReminders(state, now = Date.now(), days = 45) {
  const out = [];
  for (const o of expand(state, now, now + days * DAY, now)) {
    if (o.remind == null || o.status === 'done' || o.status === 'missed') continue;
    const at = o.start - o.remind * MIN;
    if (at <= now + 30_000) continue; // a hora de avisar já passou
    const when = o.remind >= 1440 ? `${dayLabel(o.start, at)} às ${fmtHM(o.start)}` : `Começa ${leadPhrase(o.remind)} — às ${fmtHM(o.start)}`;
    const extra = (o.kind === 'event' || o.kind === 'item' || o.kind === 'visit') && o.subtitle ? ` · ${o.subtitle}` : '';
    out.push({ id: o.key, at, until: o.start, title: o.title, body: `${when}${extra}` });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 400);
}

/** distribui blocos sobrepostos em colunas (visual da agenda do dia) */
export function layoutColumns(items) {
  items.sort((a, b) => a.s - b.s || b.e - a.e || (a.o.opt?.r ?? 0) - (b.o.opt?.r ?? 0));
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
      it.conflict = cluster.some((o) => o !== it && o.s < it.e && it.s < o.e && blocking(o.o) && blocking(it.o)
        && !(o.o.opt && it.o.opt && o.o.opt.g === it.o.opt.g));
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
