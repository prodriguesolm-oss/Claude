// Abas de lista: Locais, Eventos, Compromissos, Favoritos e Histórico.
import { state, deleteHistory, setOccStatus, setPlaceVisited, setPlaceVisitedDate } from '../store.js';
import { html, ic, actionSheet, toast, confirmDialog, openSheet } from '../ui.js';
import { emptyState, placeThumb, catBadge } from '../widgets.js';
import { createListView } from './listview.js';
import { placeRow, eventRow, commitmentRow, upcomingByPlace } from '../rows.js';
import { openPlaceForm, openEventForm, openCommitmentForm, openItemForm, openVisitForm } from '../forms.js';
import { openPlaceDetail, openOccurrenceSheet } from '../sheets.js';
import { occByKey, KIND_LABEL, inHistory } from '../schedule.js';
import { KIND_ICON } from '../icons.js';
import { matchScore, byName, collator } from '../util.js';
import { PLACE_FACETS, PLACE_SORTS, placeComparator, CAT_OPTIONS, catSection, catRank } from '../facets.js';
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
// Filtros em 3 linhas (visitados × não visitados · ★ e ♥ · categoria), que se somam; tocar de novo tira.

const CAT_TITLE = Object.fromEntries([...CAT_OPTIONS, [null, 'Sem classificação']]);

export const createPlacesView = () => createListView({
  id: 'places',
  title: 'Locais',
  placeholder: 'Buscar locais pelo nome',
  addLabel: 'Adicionar local',
  onAdd: () => openPlaceForm(),
  facets: PLACE_FACETS,
  facetItems: () => state.places,
  sorts: PLACE_SORTS,
  subtitle: (c) => (c && c.filtered && c.shown != null ? `${c.shown} de ${state.places.length}` : plural(state.places.length, 'local', 'locais')),
  renderList: (c) => {
    if (!state.places.length) {
      return emptyState({ icon: 'pin', title: 'Nenhum local ainda', text: 'Cadastre lugares que você quer conhecer — com nome, endereço e foto para referência.', actionLabel: 'Adicionar local' });
    }
    const list = filterAndRank(state.places.filter(c.pass), c.q, (p) => [p.name, p.address], placeComparator(c.sort));
    c.shown = list.length;
    if (!list.length) return noResults(c.q);
    const up = upcomingByPlace();
    if (c.sort === 'cat' && !c.q) {
      const groups = new Map();
      for (const p of list) { const k = p.category || null; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
      return html`${[...groups.entries()].map(([k, ps]) => section(CAT_TITLE[k] || 'Sem classificação', ps.map((p) => placeRow(p, up.get(p.id))), ps.length))}`;
    }
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
// Só locais (visitados / visitas) e eventos, com a foto do local. Filtros em 3 linhas (tipo · ★ e ♥ · categoria)
// e ordenação (mais recentes, mais antigos, A–Z, por categoria).

const isPlaceKind = (k) => k === 'place' || k === 'visit';

/** registro do Histórico + o local / evento de agora (foto, ★, ♥ e categoria vêm deles) */
function histEntries() {
  const places = new Map(state.places.map((p) => [p.id, p]));
  const events = new Map(state.events.map((e) => [e.id, e]));
  return state.history.filter((h) => inHistory(h.kind)).map((h) => {
    const ev = h.kind === 'event' ? events.get(h.refId) || null : null;
    const place = places.get(h.placeId || (h.kind === 'place' ? h.refId : null)) || (ev ? places.get(ev.placeId) : null) || null;
    const flags = ev || place || {};
    return { h, ev, place, cat: (ev?.category || place?.category || h.category || null), fav: !!flags.favorite, date: !!flags.isDate };
  });
}

const HIST_FACETS = [
  { id: 'kind', mode: 'one', options: [['place', 'Locais', (x) => isPlaceKind(x.h.kind)], ['event', 'Eventos', (x) => x.h.kind === 'event']] },
  { id: 'mark', mode: 'all', options: [['fav', '★ Favoritos', (x) => x.fav], ['date', '♥ Date', (x) => x.date]] },
  catSection((x) => x.cat),
];

const HIST_SORTS = [
  ['recent', 'Mais recentes', 'Recentes'],
  ['old', 'Mais antigos', 'Antigos'],
  ['name', 'Nome (A–Z)', 'A–Z'],
  ['cat', 'Por categoria', 'Categoria'],
];

function histRow(x, now) {
  const { h, place, ev } = x;
  const imported = h.source === 'import';
  const when = imported ? (h.start != null ? `${fmtDateShort(h.start, now)}` : 'feito') : h.dateOnly ? fmtDateShort(h.at, now) : h.start != null ? fmtRange(h.start, h.end) : `marcado às ${fmtHM(h.at)}`;
  const kindTxt = h.kind === 'place' ? 'Local visitado' : h.kind === 'visit' ? 'Visita a local' : KIND_LABEL[h.kind];
  const where = h.kind === 'event' ? place?.name || h.subtitle : '';
  return html`<button type="button" class="row hrow" data-hid="${h.id}">
    ${place ? placeThumb(place, 'thumb sm') : html`<span class="thumb sm ph empty-ph">${ic(KIND_ICON[h.kind] || 'pin', 'i sm')}</span>`}
    <div class="row-main">
      <div class="row-title">${ev?.name || (h.kind !== 'event' && place?.name) || h.title}</div>
      <div class="row-sub">${kindTxt}${where ? ` · ${where}` : ''}</div>
      ${x.cat || x.fav || x.date ? html`<div class="row-meta">${catBadge(x.cat)}${x.fav ? html`<span class="badge star-b">${ic('star', 'i xs', true)}</span>` : ''}${x.date ? html`<span class="badge heart-b">${ic('heart', 'i xs', true)}</span>` : ''}</div>` : ''}
    </div>
    <div class="row-right"><b>${when}</b><span>${imported ? 'importado' : h.source === 'manual' ? 'manual' : 'automático'}</span></div>
  </button>`;
}

export const createHistoryView = () => createListView({
  id: 'history',
  title: 'Histórico',
  placeholder: 'Buscar no histórico',
  facets: HIST_FACETS,
  facetItems: histEntries,
  sorts: HIST_SORTS,
  subtitle: (c) => {
    const total = state.history.filter((h) => inHistory(h.kind)).length;
    return c && c.filtered && c.shown != null ? `${c.shown} de ${total}` : plural(total, 'registro', 'registros');
  },
  headerExtra: () => {
    const E = histEntries();
    const visited = state.places.filter((p) => p.visited).length;
    const ev = E.filter((x) => x.h.kind === 'event').length;
    const dates = E.filter((x) => x.date).length;
    return html`<div class="stats">
      <div class="stat k-visit"><b>${visited}</b><span>locais visitados</span></div>
      <div class="stat k-event"><b>${ev}</b><span>eventos feitos</span></div>
      <div class="stat heart-stat"><b>${dates}</b><span>♥ dates</span></div>
    </div>`;
  },
  renderList: (c) => {
    const all = histEntries();
    if (!all.length) {
      return html`<div class="empty"><div class="empty-ic">${ic('history', 'i xl')}</div><div class="empty-title">Histórico vazio</div><div class="empty-text">Aqui aparecem os locais que você visitou e os eventos que fez — marcados por você ou automaticamente quando o horário passa. Compromissos e horários avulsos não entram aqui.</div></div>`;
    }
    const now = Date.now();
    const titleOf = (x) => x.ev?.name || (x.h.kind !== 'event' && x.place?.name) || x.h.title;
    const byTitle = (a, b) => collator.compare(titleOf(a), titleOf(b));
    const newest = (a, b) => b.h.at - a.h.at || byTitle(a, b);
    const cmp = c.sort === 'old' ? (a, b) => a.h.at - b.h.at || byTitle(a, b) : c.sort === 'name' ? byTitle
      : c.sort === 'cat' ? (a, b) => catRank(a.cat) - catRank(b.cat) || newest(a, b) : newest;
    let list = all.filter(c.pass).map((x) => ({ x, sc: matchScore(c.q, titleOf(x), x.h.subtitle, x.place?.name) })).filter((y) => y.sc > 0);
    list = (c.q ? list.sort((a, b) => b.sc - a.sc || cmp(a.x, b.x)) : list.sort((a, b) => cmp(a.x, b.x))).map((y) => y.x);
    c.shown = list.length;
    if (!list.length) return noResults(c.q);
    const rows = (xs) => xs.map((x) => histRow(x, now));
    if (c.q || c.sort === 'name') return html`<div class="group">${rows(list)}</div>`;
    if (c.sort === 'cat') {
      const groups = new Map();
      for (const x of list) { if (!groups.has(x.cat)) groups.set(x.cat, []); groups.get(x.cat).push(x); }
      return html`${[...groups.entries()].map(([k, xs]) => section(CAT_TITLE[k] || 'Sem classificação', rows(xs), xs.length))}`;
    }
    // por data: um bloco por dia; os importados (sem data) ficam juntos — no fim (recentes) ou no começo (antigos)
    const groups = new Map();
    const imported = [];
    for (const x of list) {
      if (x.h.source === 'import') { imported.push(x); continue; }
      const k = startOfDay(x.h.at);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    }
    imported.sort(byTitle);
    const imp = imported.length ? section('Feitos antes do Agentonator', rows(imported), `${imported.length} · sem data`) : '';
    const days = [...groups.entries()].map(([d, xs]) => section(dayLabel(d, now), rows(xs), fmtDateShort(d, now)));
    return c.sort === 'old' ? html`${imp}${days}` : html`${days}${imp}`;
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
      return true;
    },
  });
}
