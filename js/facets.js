// Filtros em seções e ordenações compartilhados: aba Locais, escolha de local (agenda / formulários) e Histórico.
import { state } from './store.js';
import { actionSheet } from './ui.js';
import { byName, collator } from './util.js';

export const CAT_OPTIONS = [
  ['cultura', 'Cultura'],
  ['aventura', 'Aventura'],
  ['bares', 'Bares e restaurantes'],
  ['outros', 'Outros'],
];
const CAT_ORDER = ['cultura', 'aventura', 'bares', 'outros', null];
export const catRank = (c) => { const i = CAT_ORDER.indexOf(c || null); return i < 0 ? CAT_ORDER.length : i; };

/** grupo de categorias (vale qualquer uma das ligadas) a partir de uma função que diz a categoria do item */
export const catSection = (catOf) => ({ id: 'cat', mode: 'any', options: CAT_OPTIONS.map(([v, l]) => [v, l, (x) => catOf(x) === v]) });

// ---------- Locais ----------
// numa linha só: visitados / não visitados · ★ Favoritos e ♥ Date (juntos = os dois) · categorias
export const PLACE_FACETS = [
  { id: 'visit', mode: 'any', options: [['todo', 'Não visitados', (p) => !p.visited], ['visited', 'Visitados', (p) => !!p.visited]] },
  { id: 'mark', mode: 'all', options: [['fav', '★ Favoritos', (p) => !!p.favorite], ['date', '♥ Date', (p) => !!p.isDate]] },
  catSection((p) => p.category || null),
];

export const PLACE_SORTS = [
  ['default', 'Padrão: não visitados, depois visitados', 'Padrão'],
  ['name', 'Nome (A–Z)', 'A–Z'],
  ['recent', 'Adicionados recentemente', 'Recentes'],
  ['old', 'Adicionados há mais tempo', 'Antigos'],
  ['visited', 'Visitados recentemente', 'Visitados'],
  ['next', 'Próximos na agenda', 'Agenda'],
  ['cat', 'Por categoria', 'Categoria'],
];

/** próximo evento/visita agendado de cada local */
export function nextByPlace(now = Date.now()) {
  const m = new Map();
  for (const x of [...state.events, ...state.visits]) {
    if (x.start == null || x.end <= now || x.status === 'missed' || x.status === 'done') continue;
    const cur = m.get(x.placeId);
    if (!cur || x.start < cur.start) m.set(x.placeId, x.start);
  }
  return m;
}

/** comparador de locais para a ordem escolhida */
export function placeComparator(sort) {
  const created = (p) => p.createdAt || 0;
  switch (sort) {
    case 'recent': return (a, b) => created(b) - created(a) || byName(a, b);
    case 'old': return (a, b) => created(a) - created(b) || byName(a, b);
    case 'visited': return (a, b) => (b.visited ? b.visitedAt || 1 : 0) - (a.visited ? a.visitedAt || 1 : 0) || byName(a, b);
    case 'next': {
      const nx = nextByPlace();
      return (a, b) => (nx.get(a.id) ?? Infinity) - (nx.get(b.id) ?? Infinity) || byName(a, b);
    }
    case 'cat': return (a, b) => catRank(a.category) - catRank(b.category) || byName(a, b);
    case 'name': return byName;
    default: return (a, b) => (!!a.visited - !!b.visited) || byName(a, b); // padrão: não visitados primeiro
  }
}

// ---------- Eventos ----------
// "Visitado" (feito) = marcado como feito, ou a data já passou (e não foi "não aconteceu")
export const evVisited = (e, now = Date.now()) => e.status === 'done' || (e.status !== 'missed' && e.start != null && e.end <= now);
const evPlace = (e) => state.places.find((p) => p.id === e.placeId);
export const evCat = (e) => e.category || evPlace(e)?.category || null;

export const EVENT_FACETS = [
  { id: 'visit', mode: 'any', options: [['todo', 'Não visitados', (e) => !evVisited(e)], ['visited', 'Visitados', (e) => evVisited(e)]] },
  { id: 'mark', mode: 'all', options: [['fav', '★ Favoritos', (e) => !!e.favorite], ['date', '♥ Date', (e) => !!e.isDate]] },
  catSection(evCat),
];

export const EVENT_SORTS = [
  ['default', 'Padrão: não visitados, depois visitados', 'Padrão'],
  ['date', 'Por data: próximos, sem data, passados', 'Data'],
  ['name', 'Nome (A–Z)', 'A–Z'],
  ['recent', 'Adicionados recentemente', 'Recentes'],
  ['old', 'Adicionados há mais tempo', 'Antigos'],
  ['visited', 'Feitos recentemente', 'Feitos'],
  ['cat', 'Por categoria', 'Categoria'],
];

/** ordem dentro dos "não visitados": com data (mais próximos primeiro), sem data (A–Z), "não aconteceu" por último */
export function eventPendingCmp(now = Date.now()) {
  const rank = (e) => (e.start != null && e.end > now ? 0 : e.start == null ? 1 : 2);
  return (a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.start - b.start : rank(a) === 2 ? b.start - a.start : 0) || byName(a, b);
}
const doneAtOf = (e) => e.doneAt ?? e.end ?? 0;

export function eventComparator(sort, now = Date.now()) {
  const created = (e) => e.createdAt || 0;
  const pending = eventPendingCmp(now);
  switch (sort) {
    case 'name': return byName;
    case 'recent': return (a, b) => created(b) - created(a) || byName(a, b);
    case 'old': return (a, b) => created(a) - created(b) || byName(a, b);
    case 'visited': return (a, b) => (evVisited(b, now) - evVisited(a, now)) || (evVisited(a, now) ? doneAtOf(b) - doneAtOf(a) : pending(a, b));
    case 'cat': return (a, b) => catRank(evCat(a)) - catRank(evCat(b)) || byName(a, b);
    case 'date': return pending;
    default: return (a, b) => (evVisited(a, now) - evVisited(b, now)) || (evVisited(a, now) ? doneAtOf(b) - doneAtOf(a) : pending(a, b));
  }
}

// ---------- ordem escolhida ----------
// Vale enquanto o app está aberto (trocar de aba mantém); ao abrir o app de novo, toda lista volta à ordem padrão.
const chosen = new Map();
export const sortOf = (key, sorts) => {
  const v = chosen.get(key);
  return sorts.some((s) => s[0] === v) ? v : sorts[0][0];
};

/** abre o menu "Ordenar por". Retorna a ordem escolhida (ou null se não mudou) */
export async function chooseSort(key, sorts) {
  const cur = sortOf(key, sorts);
  const v = await actionSheet({
    title: 'Ordenar por',
    actions: sorts.map(([value, label]) => ({ label: `${value === cur ? '✓ ' : ''}${label}`, value })),
  });
  if (!v || v === cur) return null;
  chosen.set(key, v);
  return v;
}

export { collator };
