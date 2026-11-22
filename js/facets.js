// Filtros em seções e ordenações compartilhados: aba Locais, escolha de local (agenda / formulários) e Histórico.
import { state, updateSettings } from './store.js';
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
    default: return byName;
  }
}

// ---------- ordem escolhida (guardada por aba) ----------
export const sortOf = (key, sorts) => {
  const v = state.settings.sorts?.[key];
  return sorts.some((s) => s[0] === v) ? v : sorts[0][0];
};

/** abre o menu "Ordenar por" e guarda a escolha. Retorna a ordem escolhida (ou null) */
export async function chooseSort(key, sorts) {
  const cur = sortOf(key, sorts);
  const v = await actionSheet({
    title: 'Ordenar por',
    actions: sorts.map(([value, label]) => ({ label: `${value === cur ? '✓ ' : ''}${label}`, value })),
  });
  if (!v || v === cur) return null;
  await updateSettings({ sorts: { ...(state.settings.sorts || {}), [key]: v } });
  return v;
}

export { collator };
