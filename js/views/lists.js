// Abas de lista: Locais, Eventos, Compromissos, Favoritos e Histórico.
import { state, deleteHistory, setOccStatus, setPlaceVisited, setPlaceVisitedDate } from '../store.js';
import { html, ic, actionSheet, toast, confirmDialog, openSheet, esc } from '../ui.js';
import { emptyState, placeThumb, catBadge } from '../widgets.js';
import { createListView } from './listview.js';
import { placeRow, eventRow, commitmentRow, upcomingByPlace } from '../rows.js';
import { openPlaceForm, openEventForm, openCommitmentForm, openItemForm, openVisitForm } from '../forms.js';
import { openPlaceDetail, openOccurrenceSheet } from '../sheets.js';
import { occByKey, KIND_LABEL, inHistory } from '../schedule.js';
import { KIND_ICON } from '../icons.js';
import { matchScore, byName, collator } from '../util.js';
import { PLACE_FACETS, PLACE_SORTS, placeComparator, CAT_OPTIONS, catSection, catRank, EVENT_FACETS, EVENT_SORTS, eventComparator, evVisited, evCat } from '../facets.js';
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
// Filtros numa linha só; dá para ligar vários (tocar de novo tira). Ver widgets.js → facetBar.

const CAT_TITLE = Object.fromEntries([...CAT_OPTIONS, [null, 'Sem classificação']]);

export const createPlacesView = (opts = {}) => createListView(Object.assign({
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
    const rows = (ps) => ps.map((p) => placeRow(p, up.get(p.id)));
    if (c.sort === 'cat' && !c.q) {
      const groups = new Map();
      for (const p of list) { const k = p.category || null; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
      return html`${[...groups.entries()].map(([k, ps]) => section(CAT_TITLE[k] || 'Sem classificação', rows(ps), ps.length))}`;
    }
    if (c.sort === 'default' && !c.q) { // padrão: não visitados primeiro, depois visitados (como em Favoritos)
      const todo = list.filter((p) => !p.visited);
      const done = list.filter((p) => p.visited);
      return html`${todo.length ? section('Não visitados', rows(todo), todo.length) : ''}${done.length ? section('Visitados', rows(done), done.length) : ''}`;
    }
    return html`<div class="group">${rows(list)}</div>`;
  },
}, opts));

// ---------- Eventos ----------
// Mesmo jeito da aba Locais: filtros numa linha (não visitados / visitados · ★ ♥ · categorias), ✓ de feito na lista,
// e por padrão separado em "Não visitados" e "Visitados". A antiga separação (próximos / sem data / concluídos)
// continua como a ordem "Por data".

const evDone = (e, now) => e.status === 'done' || e.status === 'missed' || (e.start != null && e.end <= now);

export const createEventsView = (opts = {}) => createListView(Object.assign({
  id: 'events',
  title: 'Eventos',
  placeholder: 'Buscar eventos ou locais',
  addLabel: 'Novo evento',
  onAdd: () => openEventForm(),
  facets: EVENT_FACETS,
  facetItems: () => state.events,
  sorts: EVENT_SORTS,
  subtitle: (c) => (c && c.filtered && c.shown != null ? `${c.shown} de ${state.events.length}` : plural(state.events.length, 'evento', 'eventos')),
  renderList: (c) => {
    if (!state.events.length) {
      return emptyState({ icon: 'ticket', title: 'Nenhum evento ainda', text: 'Crie eventos em locais cadastrados. Com data e hora, eles entram automaticamente na Agenda.', actionLabel: 'Novo evento' });
    }
    const now = Date.now();
    const list = filterAndRank(state.events.filter(c.pass), c.q, (e) => [e.name, placeName(e.placeId)], eventComparator(c.sort, now));
    c.shown = list.length;
    if (!list.length) return noResults(c.q);
    const rows = (es) => es.map((e) => eventRow(e, now));
    if (c.q) return html`<div class="group">${rows(list)}</div>`;
    if (c.sort === 'default') {
      const todo = list.filter((e) => !evVisited(e, now));
      const done = list.filter((e) => evVisited(e, now));
      return html`${todo.length ? section('Não visitados', rows(todo), todo.length) : ''}${done.length ? section('Visitados', rows(done), done.length) : ''}`;
    }
    if (c.sort === 'date') {
      const up = list.filter((e) => e.start != null && !evDone(e, now));
      const nodate = list.filter((e) => e.start == null && !evDone(e, now));
      const done = list.filter((e) => evDone(e, now)).sort((a, b) => (b.start ?? -1) - (a.start ?? -1) || byName(a, b));
      return html`
        ${up.length ? section('Próximos', rows(up), up.length) : ''}
        ${nodate.length ? section('Sem data', rows(nodate), nodate.length) : ''}
        ${done.length ? section('Passados', rows(done), done.length) : ''}`;
    }
    if (c.sort === 'cat') {
      const groups = new Map();
      for (const e of list) { const k = evCat(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
      return html`${[...groups.entries()].map(([k, es]) => section(CAT_TITLE[k] || 'Sem classificação', rows(es), es.length))}`;
    }
    return html`<div class="group">${rows(list)}</div>`;
  },
}, opts));

// ---------- Compromissos ----------
// (os encerrados — excluídos depois de já terem acontecido — só continuam no passado da agenda)
const activeCommitments = () => state.commitments.filter((c) => !c.ended);

export const createCommitmentsView = () => createListView({
  id: 'commitments',
  title: 'Compromissos',
  placeholder: 'Buscar compromissos',
  initialFilter: 'all',
  addLabel: 'Novo compromisso',
  onAdd: () => openCommitmentForm(),
  subtitle: () => plural(activeCommitments().length, 'compromisso', 'compromissos'),
  filters: () => {
    const C = activeCommitments();
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
    if (!activeCommitments().length) {
      return emptyState({ icon: 'repeat', title: 'Nenhum compromisso ainda', text: 'Cadastre sua rotina: diária (remédio, academia), semanal (terapia seg 10h e qui 9h), mensal (aluguel dia 5) ou compromissos únicos.', actionLabel: 'Novo compromisso' });
    }
    const now = Date.now();
    const list = activeCommitments().filter((c) => filter === 'all' || c.kind === filter).filter((c) => matchScore(q, c.name) > 0);
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
// Só locais (visitados / visitas) e eventos, com a foto do local. Filtros numa linha (tipo · ★ e ♥ · categoria)
// e ordenação (mais recentes, mais antigos, A–Z, por categoria).

const isPlaceKind = (k) => k === 'place' || k === 'visit';

/**
 * Linhas do Histórico: cada registro + o local / evento de agora (foto, ★, ♥ e categoria vêm deles).
 * Um mesmo local aparece uma vez só por dia: "marquei como visitado" e a visita da agenda no mesmo dia
 * viram uma linha (os dois registros aparecem nos detalhes).
 */
function histEntries() {
  const places = new Map(state.places.map((p) => [p.id, p]));
  const events = new Map(state.events.map((e) => [e.id, e]));
  const groups = new Map();
  for (const h of state.history) {
    if (!inHistory(h.kind)) continue;
    const pid = h.placeId || (h.kind === 'place' ? h.refId : null);
    const key = isPlaceKind(h.kind) && pid ? `p:${pid}|${dateKey(h.at)}` : h.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }
  return [...groups.entries()].map(([key, recs]) => {
    // a principal é a que tem horário (a visita da agenda); senão, a mais recente
    recs.sort((a, b) => (b.start != null) - (a.start != null) || b.at - a.at);
    const h = recs[0];
    const ev = h.kind === 'event' ? events.get(h.refId) || null : null;
    const place = places.get(h.placeId || (h.kind === 'place' ? h.refId : null)) || (ev ? places.get(ev.placeId) : null) || null;
    const flags = ev || place || {};
    return { key, h, recs, ev, place, cat: (ev?.category || place?.category || h.category || null), fav: !!flags.favorite, date: !!flags.isDate };
  });
}

const HIST_FACETS = [
  { id: 'kind', mode: 'any', options: [['place', 'Locais', (x) => isPlaceKind(x.h.kind)], ['event', 'Eventos', (x) => x.h.kind === 'event']] },
  { id: 'mark', mode: 'all', options: [['fav', '★ Favoritos', (x) => x.fav], ['date', '♥ Date', (x) => x.date]] },
  catSection((x) => x.cat),
];

const HIST_SORTS = [
  ['recent', 'Mais recentes', 'Recentes'],
  ['old', 'Mais antigos', 'Antigos'],
  ['name', 'Nome (A–Z)', 'A–Z'],
  ['cat', 'Por categoria', 'Categoria'],
];

function histRow(x) {
  const { h, place, ev } = x;
  const kindTxt = h.kind === 'event' ? KIND_LABEL.event : x.recs.some((r) => r.kind === 'visit') ? 'Visita a local' : 'Local visitado';
  const where = h.kind === 'event' ? place?.name || h.subtitle : '';
  return html`<div class="row hrow" data-hkey="${x.key}" role="button" tabindex="0">
    ${place ? placeThumb(place, 'thumb md') : html`<span class="thumb md ph empty-ph">${ic(KIND_ICON[h.kind] || 'pin', 'i sm')}</span>`}
    <div class="row-main">
      <div class="row-title">${ev?.name || (h.kind !== 'event' && place?.name) || h.title}</div>
      <div class="row-sub">${kindTxt}${where ? ` · ${where}` : ''}</div>
      ${x.cat || x.fav || x.date ? html`<div class="row-meta">${catBadge(x.cat)}${x.fav ? html`<span class="badge star-b">${ic('star', 'i xs', true)}</span>` : ''}${x.date ? html`<span class="badge heart-b">${ic('heart', 'i xs', true)}</span>` : ''}</div>` : ''}
    </div>
    <button type="button" class="info-btn" data-hinfo="${x.key}" aria-label="Detalhes">${ic('info', 'i')}</button>
  </div>`;
}

export const createHistoryView = () => createListView({
  id: 'history',
  title: 'Histórico',
  placeholder: 'Buscar no histórico',
  facets: HIST_FACETS,
  facetItems: histEntries,
  sorts: HIST_SORTS,
  subtitle: (c) => {
    const total = histEntries().length;
    return c && c.filtered && c.shown != null ? `${c.shown} de ${total}` : plural(total, 'registro', 'registros');
  },
  headerExtra: () => {
    const visited = state.places.filter((p) => p.visited).length;
    const ev = histEntries().filter((x) => x.h.kind === 'event').length;
    return html`<div class="stats">
      <div class="stat k-visit"><b>${visited}</b><span>locais visitados</span></div>
      <div class="stat k-event"><b>${ev}</b><span>eventos feitos</span></div>
      <div class="stat total-stat"><b>${visited + ev}</b><span>total</span></div>
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
    const rows = (xs) => xs.map((x) => histRow(x));
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
    const row = t.closest?.('[data-hinfo]') || t.closest?.('[data-hkey]');
    if (!row) return false;
    openHistoryEntry(row.dataset.hinfo || row.dataset.hkey);
    return true;
  },
});

/** como um registro foi feito: "Sex, 20 nov · 19:00–21:00 · concluído automaticamente" */
function recLine(h) {
  if (h.source === 'import') return h.start != null ? `${fmtDateShort(h.start)} · importado da sua lista anterior` : 'Importado da sua lista anterior (data não informada)';
  const how = h.source === 'manual' ? 'marcado por você' : 'concluído automaticamente';
  if (h.kind === 'place') return h.dateOnly ? `Visitado em ${fmtDateShort(h.at)} · data escolhida por você` : `${dayLabel(h.at)}, ${fmtDateShort(h.at)} · marcado como visitado às ${fmtHM(h.at)}`;
  const what = h.kind === 'visit' ? 'Visita' : 'Evento';
  if (h.start == null) return `${what} marcado como feito em ${fmtDateShort(h.at)} às ${fmtHM(h.at)}`;
  return `${what} · ${dayLabel(h.start)}, ${fmtDateShort(h.start)} · ${fmtRange(h.start, h.end)} · ${how}`;
}

async function openHistoryEntry(key) {
  const x = histEntries().find((e) => e.key === key);
  if (!x) return;
  const { h, recs } = x;
  const occKey = h.kind === 'place' ? null : `${h.kind}:${h.refId}`;
  const occ = occKey ? occByKey(state, occKey) : null;
  const placeId = h.placeId || (h.kind === 'place' ? h.refId : null);
  const actions = [];
  if (placeId && state.places.some((p) => p.id === placeId)) actions.push({ label: 'Ver local', value: 'place', icon: 'pin' });
  if (occ) actions.push({ label: 'Abrir na agenda', value: 'occ', icon: 'calendar' });
  if (h.kind === 'event' && state.events.some((e) => e.id === h.refId)) actions.push({ label: 'Editar evento', value: 'event', icon: 'pencil' });
  const canDate = (h.kind === 'place' && state.places.some((p) => p.id === placeId))
    || (h.kind === 'event' && state.events.some((e) => e.id === h.refId))
    || (h.kind === 'visit' && state.visits.some((v) => v.id === h.refId));
  if (canDate) actions.unshift({ label: 'Alterar a data em que foi feito', value: 'redate', icon: 'calendar' });
  actions.push({ label: occ ? 'Não aconteceu (remover)' : 'Remover do histórico', value: 'remove', icon: 'trash', style: 'destructive' });
  const lines = recs.map((r) => esc(recLine(r)));
  const v = await actionSheet({
    title: x.ev?.name || (h.kind !== 'event' && x.place?.name) || h.title,
    messageHtml: lines.length > 1 ? `${lines.join('<br>')}<br><small>Os dois registros são do mesmo local no mesmo dia, por isso aparecem numa linha só.</small>` : lines[0],
    actions,
  });
  if (v === 'place') openPlaceDetail(placeId);
  if (v === 'occ') openOccurrenceSheet(occKey);
  if (v === 'event') openEventForm({ id: h.refId });
  if (v === 'redate') {
    if (h.kind === 'place') openVisitedDateSheet(placeId);
    else if (h.kind === 'event') openEventForm({ id: h.refId });
    else if (h.kind === 'visit') openVisitForm({ id: h.refId });
  }
  if (v === 'remove') {
    const ok = await confirmDialog({ title: 'Remover do histórico?', message: occ ? 'Fica marcado como “não aconteceu”.' : h.kind === 'place' ? 'O local volta a ficar como “não visitado”.' : 'O registro será apagado.', ok: 'Remover', destructive: true });
    if (!ok) return;
    for (const r of recs) { // todos os registros desta linha
      const o = r.kind === 'place' ? null : occByKey(state, `${r.kind}:${r.refId}`);
      if (o) await setOccStatus(o, 'missed');
      else if (r.kind === 'place' && state.places.some((p) => p.id === r.refId && p.visited)) await setPlaceVisited(r.refId, false);
      else await deleteHistory(r.id);
    }
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
