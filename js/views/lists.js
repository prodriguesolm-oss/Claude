// Abas de lista: Locais, Eventos, Compromissos, Favoritos e Histórico.
import { state, deleteHistory, setOccStatus, setPlaceVisited } from '../store.js';
import { html, ic, actionSheet, toast, confirmDialog } from '../ui.js';
import { emptyState } from '../widgets.js';
import { createListView } from './listview.js';
import { placeRow, eventRow, commitmentRow, upcomingByPlace } from '../rows.js';
import { openPlaceForm, openEventForm, openCommitmentForm } from '../forms.js';
import { openPlaceDetail, openOccurrenceSheet } from '../sheets.js';
import { occByKey, KIND_LABEL } from '../schedule.js';
import { KIND_ICON } from '../icons.js';
import { matchScore, byName } from '../util.js';
import { dayLabel, fmtDateShort, fmtHM, fmtRange, startOfDay } from '../time.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const noResults = (q) => html`<div class="note center">Nada encontrado${q ? html` para “<b>${q}</b>”` : ' com este filtro'}.</div>`;
const section = (title, body, extra = '') => html`<div class="sec-h"><span>${title}</span>${extra ? html`<small>${extra}</small>` : ''}</div><div class="group">${body}</div>`;

function filterAndRank(items, q, fieldsOf, fallbackSort) {
  const scored = items.map((it) => ({ it, s: matchScore(q, ...fieldsOf(it)) })).filter((x) => x.s > 0);
  if (q) scored.sort((a, b) => b.s - a.s || fallbackSort(a.it, b.it));
  else scored.sort((a, b) => fallbackSort(a.it, b.it));
  return scored.map((x) => x.it);
}

const placeName = (id) => state.places.find((p) => p.id === id)?.name || '';

// ---------- Locais ----------

export const createPlacesView = () => createListView({
  id: 'places',
  title: 'Locais',
  placeholder: 'Buscar locais pelo nome',
  initialFilter: 'all',
  addLabel: 'Adicionar local',
  onAdd: () => openPlaceForm(),
  subtitle: () => plural(state.places.length, 'local', 'locais'),
  filters: () => {
    const P = state.places;
    const n = (f) => P.filter(f).length;
    return [
      ['all', 'Todos', P.length],
      ['fav', 'Favoritos', n((p) => p.favorite)],
      ['visited', 'Visitados', n((p) => p.visited)],
      ['todo', 'Não visitados', n((p) => !p.visited)],
      ['cultura', 'Cultura', n((p) => p.category === 'cultura')],
      ['aventura', 'Aventura', n((p) => p.category === 'aventura')],
      ['outros', 'Outros', n((p) => p.category === 'outros')],
    ];
  },
  renderList: ({ q, filter }) => {
    if (!state.places.length) {
      return emptyState({ icon: 'pin', title: 'Nenhum local ainda', text: 'Cadastre lugares que você quer conhecer — com nome, endereço e foto para referência.', actionLabel: 'Adicionar local' });
    }
    const pass = {
      all: () => true, fav: (p) => p.favorite, visited: (p) => p.visited, todo: (p) => !p.visited,
      cultura: (p) => p.category === 'cultura', aventura: (p) => p.category === 'aventura', outros: (p) => p.category === 'outros',
    }[filter] || (() => true);
    const list = filterAndRank(state.places.filter(pass), q, (p) => [p.name, p.address], byName);
    if (!list.length) return noResults(q);
    const up = upcomingByPlace();
    return html`<div class="group">${list.map((p) => placeRow(p, up.get(p.id)))}</div>`;
  },
});

// ---------- Eventos ----------

const evDone = (e, now) => e.status === 'done' || e.status === 'missed' || (e.start != null && e.end <= now);

export const createEventsView = () => createListView({
  id: 'events',
  title: 'Eventos',
  placeholder: 'Buscar eventos ou locais',
  initialFilter: 'all',
  addLabel: 'Novo evento',
  onAdd: () => openEventForm(),
  subtitle: () => plural(state.events.length, 'evento', 'eventos'),
  filters: () => {
    const now = Date.now();
    const E = state.events;
    const n = (f) => E.filter(f).length;
    return [
      ['all', 'Todos', E.length],
      ['upcoming', 'Próximos', n((e) => e.start != null && !evDone(e, now))],
      ['nodate', 'Sem data', n((e) => e.start == null)],
      ['done', 'Concluídos', n((e) => e.start != null && evDone(e, now))],
      ['fav', 'Favoritos', n((e) => e.favorite)],
      ['cultura', 'Cultura', n((e) => e.category === 'cultura')],
      ['aventura', 'Aventura', n((e) => e.category === 'aventura')],
      ['outros', 'Outros', n((e) => e.category === 'outros')],
    ];
  },
  renderList: ({ q, filter }) => {
    if (!state.events.length) {
      return emptyState({ icon: 'ticket', title: 'Nenhum evento ainda', text: 'Crie eventos em locais cadastrados. Com data e hora, eles entram automaticamente na Agenda.', actionLabel: 'Novo evento' });
    }
    const now = Date.now();
    const pass = {
      all: () => true,
      upcoming: (e) => e.start != null && !evDone(e, now),
      nodate: (e) => e.start == null,
      done: (e) => e.start != null && evDone(e, now),
      fav: (e) => e.favorite,
      cultura: (e) => e.category === 'cultura', aventura: (e) => e.category === 'aventura', outros: (e) => e.category === 'outros',
    }[filter] || (() => true);
    const list = state.events.filter(pass).filter((e) => matchScore(q, e.name, placeName(e.placeId)) > 0);
    if (!list.length) return noResults(q);
    const up = list.filter((e) => e.start != null && !evDone(e, now)).sort((a, b) => a.start - b.start);
    const nodate = list.filter((e) => e.start == null).sort(byName);
    const done = list.filter((e) => e.start != null && evDone(e, now)).sort((a, b) => b.start - a.start);
    return html`
      ${up.length ? section('Próximos', up.map((e) => eventRow(e, now)), up.length) : ''}
      ${nodate.length ? section('Sem data', nodate.map((e) => eventRow(e, now)), nodate.length) : ''}
      ${done.length ? section('Concluídos', done.map((e) => eventRow(e, now)), done.length) : ''}`;
  },
});

// ---------- Compromissos ----------

export const createCommitmentsView = () => createListView({
  id: 'commitments',
  title: 'Compromissos',
  placeholder: 'Buscar compromissos',
  initialFilter: 'all',
  addLabel: 'Novo compromisso',
  onAdd: () => openCommitmentForm(),
  subtitle: () => plural(state.commitments.length, 'compromisso', 'compromissos'),
  filters: () => {
    const C = state.commitments;
    return [
      ['all', 'Todos', C.length],
      ['weekly', 'Semanais', C.filter((c) => c.kind === 'weekly').length],
      ['once', 'Únicos', C.filter((c) => c.kind === 'once').length],
      ['fav', 'Favoritos', C.filter((c) => c.favorite).length],
    ];
  },
  renderList: ({ q, filter }) => {
    if (!state.commitments.length) {
      return emptyState({ icon: 'repeat', title: 'Nenhum compromisso ainda', text: 'Cadastre sua rotina semanal (ex.: terapia seg 10h e qui 9h, trabalho seg a sex) ou compromissos únicos.', actionLabel: 'Novo compromisso' });
    }
    const now = Date.now();
    const pass = { all: () => true, weekly: (c) => c.kind === 'weekly', once: (c) => c.kind === 'once', fav: (c) => c.favorite }[filter] || (() => true);
    const list = state.commitments.filter(pass).filter((c) => matchScore(q, c.name) > 0);
    if (!list.length) return noResults(q);
    const weekly = list.filter((c) => c.kind === 'weekly').sort(byName);
    const onceNext = list.filter((c) => c.kind === 'once' && c.end > now).sort((a, b) => a.start - b.start);
    const oncePast = list.filter((c) => c.kind === 'once' && !(c.end > now)).sort((a, b) => (b.start || 0) - (a.start || 0));
    return html`
      ${weekly.length ? section('Rotina semanal', weekly.map((c) => commitmentRow(c, now)), weekly.length) : ''}
      ${onceNext.length ? section('Únicos — próximos', onceNext.map((c) => commitmentRow(c, now)), onceNext.length) : ''}
      ${oncePast.length ? section('Únicos — passados', oncePast.map((c) => commitmentRow(c, now)), oncePast.length) : ''}`;
  },
});

// ---------- Favoritos ----------

export const createFavoritesView = () => createListView({
  id: 'favorites',
  title: 'Favoritos',
  placeholder: 'Buscar nos favoritos',
  initialFilter: 'all',
  subtitle: () => {
    const n = state.places.filter((p) => p.favorite).length + state.events.filter((e) => e.favorite).length + state.commitments.filter((c) => c.favorite).length;
    return plural(n, 'favorito', 'favoritos');
  },
  filters: () => [
    ['all', 'Todos'],
    ['place', 'Locais', state.places.filter((p) => p.favorite).length],
    ['event', 'Eventos', state.events.filter((e) => e.favorite).length],
    ['commitment', 'Compromissos', state.commitments.filter((c) => c.favorite).length],
  ],
  renderList: ({ q, filter }) => {
    const now = Date.now();
    const places = filter === 'all' || filter === 'place'
      ? filterAndRank(state.places.filter((p) => p.favorite), q, (p) => [p.name, p.address], byName) : [];
    const events = filter === 'all' || filter === 'event'
      ? filterAndRank(state.events.filter((e) => e.favorite), q, (e) => [e.name, placeName(e.placeId)], (a, b) => (a.start ?? Infinity) - (b.start ?? Infinity)) : [];
    const comms = filter === 'all' || filter === 'commitment'
      ? filterAndRank(state.commitments.filter((c) => c.favorite), q, (c) => [c.name], byName) : [];
    if (!places.length && !events.length && !comms.length) {
      const any = state.places.some((p) => p.favorite) || state.events.some((e) => e.favorite) || state.commitments.some((c) => c.favorite);
      if (any) return noResults(q);
      return html`<div class="empty"><div class="empty-ic star">${ic('star', 'i xl')}</div><div class="empty-title">Nenhum favorito ainda</div><div class="empty-text">Toque na estrela ☆ ao lado de um local, evento ou compromisso para salvá-lo aqui.</div></div>`;
    }
    const up = upcomingByPlace(now);
    return html`
      ${places.length ? section('Locais', places.map((p) => placeRow(p, up.get(p.id))), places.length) : ''}
      ${events.length ? section('Eventos', events.map((e) => eventRow(e, now)), events.length) : ''}
      ${comms.length ? section('Compromissos', comms.map((c) => commitmentRow(c, now)), comms.length) : ''}`;
  },
});

// ---------- Histórico ----------

const HIST_GROUP = { place: 'place', visit: 'place', event: 'event', commitment: 'commitment' };

function histRow(h, now) {
  const when = h.start != null ? fmtRange(h.start, h.end) : `marcado às ${fmtHM(h.at)}`;
  const kindTxt = h.kind === 'place' ? 'Local visitado' : h.kind === 'visit' ? 'Visita a local' : KIND_LABEL[h.kind];
  return html`<button type="button" class="row hrow" data-hid="${h.id}">
    <span class="kicon k-${h.kind === 'place' ? 'visit' : h.kind}">${ic(KIND_ICON[h.kind], 'i sm')}</span>
    <div class="row-main">
      <div class="row-title">${h.title}</div>
      <div class="row-sub">${kindTxt}${h.kind === 'event' && h.subtitle ? ` · ${h.subtitle}` : ''}</div>
    </div>
    <div class="row-right"><b>${when}</b><span>${h.source === 'manual' ? 'manual' : 'automático'}</span></div>
  </button>`;
}

export const createHistoryView = () => createListView({
  id: 'history',
  title: 'Histórico',
  placeholder: 'Buscar no histórico',
  initialFilter: 'all',
  subtitle: () => plural(state.history.length, 'registro', 'registros'),
  headerExtra: () => {
    const visited = state.places.filter((p) => p.visited).length;
    const ev = state.history.filter((h) => h.kind === 'event').length;
    const cm = state.history.filter((h) => h.kind === 'commitment').length;
    return html`<div class="stats">
      <div class="stat k-visit"><b>${visited}</b><span>locais visitados</span></div>
      <div class="stat k-event"><b>${ev}</b><span>eventos feitos</span></div>
      <div class="stat k-commitment"><b>${cm}</b><span>compromissos cumpridos</span></div>
    </div>`;
  },
  filters: () => {
    const H = state.history;
    return [
      ['all', 'Tudo', H.length],
      ['place', 'Locais', H.filter((h) => HIST_GROUP[h.kind] === 'place').length],
      ['event', 'Eventos', H.filter((h) => h.kind === 'event').length],
      ['commitment', 'Compromissos', H.filter((h) => h.kind === 'commitment').length],
    ];
  },
  renderList: ({ q, filter }) => {
    if (!state.history.length) {
      return html`<div class="empty"><div class="empty-ic">${ic('history', 'i xl')}</div><div class="empty-title">Histórico vazio</div><div class="empty-text">Aqui aparece tudo que você já fez: locais marcados como visitados e itens da agenda cujo horário passou sem alteração (marcados como feitos automaticamente).</div></div>`;
    }
    const now = Date.now();
    const list = state.history
      .filter((h) => filter === 'all' || HIST_GROUP[h.kind] === filter)
      .filter((h) => matchScore(q, h.title, h.subtitle) > 0)
      .sort((a, b) => b.at - a.at);
    if (!list.length) return noResults(q);
    const groups = new Map();
    for (const h of list) {
      const k = startOfDay(h.at);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(h);
    }
    return html`${[...groups.entries()].map(([d, hs]) => section(dayLabel(d, now), hs.map((h) => histRow(h, now)), fmtDateShort(d, now)))}`;
  },
  onClick: (t) => {
    const row = t.closest?.('[data-hid]');
    if (!row) return false;
    openHistoryEntry(row.dataset.hid);
    return true;
  },
});

async function openHistoryEntry(id) {
  const h = state.history.find((x) => x.id === id);
  if (!h) return;
  const occKey = h.kind === 'commitment' ? `commitment:${h.refId}:${h.subKey}` : h.kind === 'place' ? null : `${h.kind}:${h.refId}`;
  const occ = occKey ? occByKey(state, occKey) : null;
  const actions = [];
  if (h.placeId && state.places.some((p) => p.id === h.placeId)) actions.push({ label: 'Ver local', value: 'place', icon: 'pin' });
  if (occ) actions.push({ label: 'Abrir na agenda', value: 'occ', icon: 'calendar' });
  if (h.kind === 'event' && state.events.some((e) => e.id === h.refId)) actions.push({ label: 'Editar evento', value: 'event', icon: 'pencil' });
  actions.push({ label: occ ? 'Não aconteceu (remover)' : 'Remover do histórico', value: 'remove', icon: 'trash', style: 'destructive' });
  const when = h.start != null ? `${dayLabel(h.start)} · ${fmtRange(h.start, h.end)}` : `Marcado em ${fmtDateShort(h.at)} às ${fmtHM(h.at)}`;
  const v = await actionSheet({ title: h.title, message: `${when} · ${h.source === 'manual' ? 'registrado manualmente' : 'concluído automaticamente'}`, actions });
  if (v === 'place') openPlaceDetail(h.placeId);
  if (v === 'occ') openOccurrenceSheet(occKey);
  if (v === 'event') openEventForm({ id: h.refId });
  if (v === 'remove') {
    const ok = await confirmDialog({ title: 'Remover do histórico?', message: occ ? 'O item fica marcado como “não aconteceu”.' : h.kind === 'place' ? 'O local volta a ficar como “não visitado”.' : 'O registro será apagado.', ok: 'Remover', destructive: true });
    if (!ok) return;
    if (occ) await setOccStatus(occ, 'missed');
    else if (h.kind === 'place' && state.places.some((p) => p.id === h.placeId && p.visited)) await setPlaceVisited(h.placeId, false);
    else await deleteHistory(id);
    toast('Removido do histórico', { icon: 'trash' });
  }
}
