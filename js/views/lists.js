// Abas de lista: Locais, Eventos, Compromissos, Favoritos e Histórico.
import { state, deleteHistory, setOccStatus, setPlaceVisited, setPlaceVisitedDate } from '../store.js';
import { html, ic, actionSheet, toast, confirmDialog, openSheet } from '../ui.js';
import { emptyState } from '../widgets.js';
import { createListView } from './listview.js';
import { placeRow, eventRow, commitmentRow, upcomingByPlace } from '../rows.js';
import { openPlaceForm, openEventForm, openCommitmentForm, openItemForm, openVisitForm } from '../forms.js';
import { openPlaceDetail, openOccurrenceSheet } from '../sheets.js';
import { occByKey, KIND_LABEL, colorOf } from '../schedule.js';
import { KIND_ICON } from '../icons.js';
import { matchScore, byName, collator } from '../util.js';
import { dayLabel, fmtDateShort, fmtHM, fmtRange, startOfDay, dateKey, atMinutes } from '../time.js';

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
      ['bares', 'Bares e restaurantes', n((p) => p.category === 'bares')],
      ['outros', 'Outros', n((p) => p.category === 'outros')],
    ];
  },
  renderList: ({ q, filter }) => {
    if (!state.places.length) {
      return emptyState({ icon: 'pin', title: 'Nenhum local ainda', text: 'Cadastre lugares que você quer conhecer — com nome, endereço e foto para referência.', actionLabel: 'Adicionar local' });
    }
    const pass = {
      all: () => true, fav: (p) => p.favorite, visited: (p) => p.visited, todo: (p) => !p.visited,
      cultura: (p) => p.category === 'cultura', aventura: (p) => p.category === 'aventura', bares: (p) => p.category === 'bares', outros: (p) => p.category === 'outros',
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
      ['nodate', 'Sem data', n((e) => e.start == null && !evDone(e, now))],
      ['done', 'Concluídos', n((e) => evDone(e, now))],
      ['fav', 'Favoritos', n((e) => e.favorite)],
      ['cultura', 'Cultura', n((e) => e.category === 'cultura')],
      ['aventura', 'Aventura', n((e) => e.category === 'aventura')],
      ['bares', 'Bares e restaurantes', n((e) => e.category === 'bares')],
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
      nodate: (e) => e.start == null && !evDone(e, now),
      done: (e) => evDone(e, now),
      fav: (e) => e.favorite,
      cultura: (e) => e.category === 'cultura', aventura: (e) => e.category === 'aventura', bares: (e) => e.category === 'bares', outros: (e) => e.category === 'outros',
    }[filter] || (() => true);
    const list = state.events.filter(pass).filter((e) => matchScore(q, e.name, placeName(e.placeId)) > 0);
    if (!list.length) return noResults(q);
    const up = list.filter((e) => e.start != null && !evDone(e, now)).sort((a, b) => a.start - b.start);
    const nodate = list.filter((e) => e.start == null && !evDone(e, now)).sort(byName);
    const done = list.filter((e) => evDone(e, now)).sort((a, b) => (b.start ?? -1) - (a.start ?? -1) || byName(a, b));
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
    const n = (k) => C.filter((c) => c.kind === k).length;
    return [
      ['all', 'Todos', C.length],
      ['daily', 'Diários', n('daily')],
      ['weekly', 'Semanais', n('weekly')],
      ['monthly', 'Mensais', n('monthly')],
      ['once', 'Únicos', n('once')],
    ];
  },
  renderList: ({ q, filter }) => {
    if (!state.commitments.length) {
      return emptyState({ icon: 'repeat', title: 'Nenhum compromisso ainda', text: 'Cadastre sua rotina: diária (remédio, academia), semanal (terapia seg 10h e qui 9h), mensal (aluguel dia 5) ou compromissos únicos.', actionLabel: 'Novo compromisso' });
    }
    const now = Date.now();
    const list = state.commitments.filter((c) => filter === 'all' || c.kind === filter).filter((c) => matchScore(q, c.name) > 0);
    if (!list.length) return noResults(q);
    const firstMin = (c) => Math.min(...(c.slots || []).map((s) => s.startMin), 1440);
    const byTime = (a, b) => firstMin(a) - firstMin(b) || byName(a, b);
    const groups = [
      ['Diários', list.filter((c) => c.kind === 'daily').sort(byTime)],
      ['Semanais', list.filter((c) => c.kind === 'weekly').sort(byTime)],
      ['Mensais', list.filter((c) => c.kind === 'monthly').sort(byTime)],
      ['Únicos — próximos', list.filter((c) => c.kind === 'once' && c.end > now).sort((a, b) => a.start - b.start)],
      ['Únicos — passados', list.filter((c) => c.kind === 'once' && !(c.end > now)).sort((a, b) => (b.start || 0) - (a.start || 0))],
    ];
    return html`${groups.filter(([, l]) => l.length).map(([title, l]) => section(title, l.map((c) => commitmentRow(c, now)), l.length))}`;
  },
});

// ---------- Favoritos ----------

export const createFavoritesView = () => createListView({
  id: 'favorites',
  title: 'Favoritos',
  placeholder: 'Buscar nos favoritos',
  initialFilter: 'all',
  subtitle: () => {
    const n = state.places.filter((p) => p.favorite).length + state.events.filter((e) => e.favorite).length;
    const d = state.places.filter((p) => p.isDate).length + state.events.filter((e) => e.isDate).length;
    return `${plural(n, 'favorito', 'favoritos')} · ${plural(d, 'date', 'dates')}`;
  },
  filters: () => [
    ['all', 'Todos'],
    ['place', 'Locais', state.places.filter((p) => p.favorite).length],
    ['event', 'Eventos', state.events.filter((e) => e.favorite).length],
    ['date', '♥ Date', state.places.filter((p) => p.isDate).length + state.events.filter((e) => e.isDate).length],
  ],
  renderList: ({ q, filter }) => {
    const now = Date.now();
    if (filter === 'date') {
      const dp = filterAndRank(state.places.filter((p) => p.isDate), q, (p) => [p.name, p.address], byName);
      const de = filterAndRank(state.events.filter((e) => e.isDate), q, (e) => [e.name, placeName(e.placeId)], (a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
      if (!dp.length && !de.length) {
        if (state.places.some((p) => p.isDate) || state.events.some((e) => e.isDate)) return noResults(q);
        return html`<div class="empty"><div class="empty-ic heart">${ic('heart', 'i xl')}</div><div class="empty-title">Nenhum Date ainda</div><div class="empty-text">Toque no ♥ ao lado de um local ou evento para guardar aqui ideias de date.</div></div>`;
      }
      const upd = upcomingByPlace(now);
      return html`
        ${dp.length ? section('Locais para date', dp.map((p) => placeRow(p, upd.get(p.id))), dp.length) : ''}
        ${de.length ? section('Eventos para date', de.map((e) => eventRow(e, now)), de.length) : ''}`;
    }
    const places = filter === 'all' || filter === 'place'
      ? filterAndRank(state.places.filter((p) => p.favorite), q, (p) => [p.name, p.address], byName) : [];
    const events = filter === 'all' || filter === 'event'
      ? filterAndRank(state.events.filter((e) => e.favorite), q, (e) => [e.name, placeName(e.placeId)], (a, b) => (a.start ?? Infinity) - (b.start ?? Infinity)) : [];
    if (!places.length && !events.length) {
      const any = state.places.some((p) => p.favorite) || state.events.some((e) => e.favorite);
      if (any) return noResults(q);
      return html`<div class="empty"><div class="empty-ic star">${ic('star', 'i xl')}</div><div class="empty-title">Nenhum favorito ainda</div><div class="empty-text">Toque na estrela ☆ ao lado de um local ou evento para salvá-lo aqui.</div></div>`;
    }
    const up = upcomingByPlace(now);
    return html`
      ${places.length ? section('Locais', places.map((p) => placeRow(p, up.get(p.id))), places.length) : ''}
      ${events.length ? section('Eventos', events.map((e) => eventRow(e, now)), events.length) : ''}`;
  },
});

// ---------- Histórico ----------

const HIST_GROUP = { place: 'place', visit: 'place', event: 'event', commitment: 'commitment', item: 'item' };

function histRow(h, now) {
  const imported = h.source === 'import';
  const when = imported ? (h.start != null ? `${fmtDateShort(h.start, now)}` : 'feito') : h.dateOnly ? 'visitado' : h.start != null ? fmtRange(h.start, h.end) : `marcado às ${fmtHM(h.at)}`;
  const kindTxt = h.kind === 'place' ? 'Local visitado' : h.kind === 'visit' ? 'Visita a local' : h.kind === 'item' ? 'Horário avulso' : KIND_LABEL[h.kind];
  return html`<button type="button" class="row hrow" data-hid="${h.id}">
    <span class="kicon c-${colorOf(h)}">${ic(KIND_ICON[h.kind], 'i sm')}</span>
    <div class="row-main">
      <div class="row-title">${h.title}</div>
      <div class="row-sub">${kindTxt}${h.kind === 'event' && h.subtitle ? ` · ${h.subtitle}` : ''}</div>
    </div>
    <div class="row-right"><b>${when}</b><span>${imported ? 'importado' : h.source === 'manual' ? 'manual' : 'automático'}</span></div>
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
      ['item', 'Avulsos', H.filter((h) => h.kind === 'item').length],
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
    const imported = [];
    for (const h of list) {
      if (h.source === 'import') { imported.push(h); continue; }
      const k = startOfDay(h.at);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(h);
    }
    imported.sort((a, b) => collator.compare(a.title, b.title));
    return html`${[...groups.entries()].map(([d, hs]) => section(dayLabel(d, now), hs.map((h) => histRow(h, now)), fmtDateShort(d, now)))}
      ${imported.length ? section('Feitos antes do Agentonator', imported.map((h) => histRow(h, now)), `${imported.length} · sem data`) : ''}`;
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
  if (h.kind === 'item' && state.items.some((i) => i.id === h.refId)) actions.push({ label: 'Editar horário', value: 'item', icon: 'pencil' });
  const canDate = (h.kind === 'place' && state.places.some((p) => p.id === h.placeId))
    || (h.kind === 'event' && state.events.some((e) => e.id === h.refId))
    || (h.kind === 'visit' && state.visits.some((v) => v.id === h.refId))
    || (h.kind === 'item' && state.items.some((i) => i.id === h.refId));
  if (canDate) actions.unshift({ label: 'Alterar a data em que foi feito', value: 'redate', icon: 'calendar' });
  actions.push({ label: occ ? 'Não aconteceu (remover)' : 'Remover do histórico', value: 'remove', icon: 'trash', style: 'destructive' });
  const when = h.source === 'import' ? 'Importado da sua lista anterior (data não informada)'
    : h.start != null ? `${dayLabel(h.start)} · ${fmtRange(h.start, h.end)}` : `Marcado em ${fmtDateShort(h.at)} às ${fmtHM(h.at)}`;
  const how = h.source === 'import' ? '' : ` · ${h.source === 'manual' ? 'registrado manualmente' : 'concluído automaticamente'}`;
  const v = await actionSheet({ title: h.title, message: `${when}${how}`, actions });
  if (v === 'place') openPlaceDetail(h.placeId);
  if (v === 'occ') openOccurrenceSheet(occKey);
  if (v === 'event') openEventForm({ id: h.refId });
  if (v === 'item') openItemForm({ id: h.refId });
  if (v === 'redate') {
    if (h.kind === 'place') openVisitedDateSheet(h.placeId);
    else if (h.kind === 'event') openEventForm({ id: h.refId });
    else if (h.kind === 'visit') openVisitForm({ id: h.refId });
    else if (h.kind === 'item') openItemForm({ id: h.refId });
  }
  if (v === 'remove') {
    const ok = await confirmDialog({ title: 'Remover do histórico?', message: occ ? 'O item fica marcado como “não aconteceu”.' : h.kind === 'place' ? 'O local volta a ficar como “não visitado”.' : 'O registro será apagado.', ok: 'Remover', destructive: true });
    if (!ok) return;
    if (occ) await setOccStatus(occ, 'missed');
    else if (h.kind === 'place' && state.places.some((p) => p.id === h.placeId && p.visited)) await setPlaceVisited(h.placeId, false);
    else await deleteHistory(id);
    toast('Removido do histórico', { icon: 'trash' });
  }
}

/** escolher a data em que um local foi visitado */
function openVisitedDateSheet(placeId) {
  const p = state.places.find((x) => x.id === placeId);
  if (!p) return;
  const today = dateKey(Date.now());
  openSheet({
    title: 'Data da visita',
    right: 'Salvar',
    className: 'auto-sheet',
    body: html`<form class="form" novalidate>
      <div class="occ-mini k-visit"><b>${p.name}</b><span>${p.visitedAt ? `Data atual: ${fmtDateShort(p.visitedAt)}` : 'Ainda sem data'}</span></div>
      <div class="form-group"><label class="cell"><span class="cell-ic">${ic('calendar', 'i sm')}</span><span class="lbl grow">Visitado em</span><input type="date" name="d" value="${p.visitedAt ? dateKey(p.visitedAt) : today}" max="${today}"></label></div>
    </form>`,
    onRight: async (c) => {
      const v = c.body.querySelector('input[name=d]').value;
      if (!v) return false;
      await setPlaceVisitedDate(placeId, atMinutes(v, 12 * 60));
      toast(`Visita registrada em ${fmtDateShort(atMinutes(v, 12 * 60))}`, { icon: 'check' });
      return true;
    },
  });
}
