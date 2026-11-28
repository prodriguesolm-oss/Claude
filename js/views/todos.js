// Aba "Afazeres": o que está marcado na agenda, dia a dia, numa lista fácil de ler.
// Entram sempre as visitas a locais e os eventos com data; compromissos e horários avulsos só se tiverem
// "Incluir em Afazeres" ligado. Abre em Hoje — rolando para baixo, o que vem; para cima, o que já passou.
import { state } from '../store.js';
import { html, ic } from '../ui.js';
import { createListView } from './listview.js';
import { occRow } from '../rows.js';
import { openOccurrenceSheet } from '../sheets.js';
import { expand } from '../schedule.js';
import { matchScore } from '../util.js';
import { DAY, startOfDay, dayLabel, fmtDateShort } from '../time.js';

const PAST_DAYS = 120; // compromissos/avulsos repetidos: até ~4 meses para trás
const NEXT_DAYS = 365; // e um ano para frente

/** tudo o que entra em Afazeres (ocorrências da agenda) */
export function todoOccs(now = Date.now()) {
  const sub = {
    ...state,
    commitments: state.commitments.filter((c) => c.todo),
    items: (state.items || []).filter((i) => i.todo),
  };
  let from = startOfDay(now) - PAST_DAYS * DAY;
  let to = startOfDay(now) + NEXT_DAYS * DAY;
  for (const x of [...state.events, ...state.visits]) { // visitas e eventos: todos, mesmo fora dessa janela
    if (x.start == null) continue;
    from = Math.min(from, x.start);
    to = Math.max(to, x.end + 1);
  }
  return expand(sub, from, to, now);
}

const KIND_FACETS = [
  { id: 'status', mode: 'any', options: [['pending', 'Pendentes', (o) => o.status !== 'done' && o.status !== 'missed'], ['done', 'Feitos', (o) => o.status === 'done']] },
  { id: 'kind', mode: 'any', options: [['visit', 'Locais', (o) => o.kind === 'visit'], ['event', 'Eventos', (o) => o.kind === 'event'], ['commitment', 'Compromissos', (o) => o.kind === 'commitment'], ['item', 'Avulsos', (o) => o.kind === 'item']] },
];

const TODO_SORTS = [
  ['asc', 'Data: do mais próximo ao mais distante', 'Data ↓'],
  ['desc', 'Data: do mais distante ao mais próximo', 'Data ↑'],
];

let firstShow = true;

export const createTodosView = () => createListView({
  id: 'todos',
  title: 'Afazeres',
  placeholder: 'Buscar nos afazeres',
  facets: KIND_FACETS,
  facetItems: () => todoOccs(),
  sorts: TODO_SORTS,
  subtitle: (c) => {
    const now = Date.now();
    const t0 = startOfDay(now);
    const n = todoOccs(now).filter((o) => o.start < t0 + DAY && o.end > t0 && o.status !== 'done' && o.status !== 'missed').length;
    if (c && c.filtered && c.shown != null) return `${c.shown} ${c.shown === 1 ? 'item' : 'itens'}`;
    return n ? `${n} para hoje` : 'nada para hoje';
  },
  renderList: (c) => {
    const now = Date.now();
    const today = startOfDay(now);
    const all = todoOccs(now);
    const list = all.filter(c.pass).filter((o) => matchScore(c.q, o.title, o.subtitle) > 0)
      .sort((a, b) => (c.sort === 'desc' ? b.start - a.start : a.start - b.start));
    c.shown = list.length;
    if (!all.length) {
      return html`<div class="empty"><div class="empty-ic">${ic('checklist', 'i xl')}</div><div class="empty-title">Nada em Afazeres ainda</div><div class="empty-text">Aparecem aqui as visitas a locais e os eventos marcados na agenda. Compromissos e horários avulsos entram se você ligar “Incluir em Afazeres” no cadastro deles (ex.: terapia).</div></div>`;
    }
    const days = new Map();
    for (const o of list) {
      const k = startOfDay(o.start);
      if (!days.has(k)) days.set(k, []);
      days.get(k).push(o);
    }
    if (!c.q && !days.has(today)) days.set(today, []); // "Hoje" sempre aparece (é onde a aba abre)
    const keys = [...days.keys()].sort((a, b) => (c.sort === 'desc' ? b - a : a - b));
    return html`${keys.map((k) => {
      const os = days.get(k);
      const rel = dayLabel(k, now);
      const isToday = k === today;
      const title = isToday ? 'Hoje' : rel;
      return html`<div class="sec-h ${k < today ? 'past' : ''} ${isToday ? 'today' : ''}" ${isToday ? html`data-today="1"` : ''}><span>${title}</span><small>${fmtDateShort(k, now)}${k < today ? ' · passado' : ''}</small></div>
        <div class="group">${os.length ? os.map((o) => occRow(o)) : html`<div class="note todo-empty">Nada marcado para hoje.</div>`}</div>`;
    })}<div class="todo-tail" aria-hidden="true"></div>`; // espaço no fim: "Hoje" sempre consegue ficar no topo
  },
  onClick: (t) => {
    const row = t.closest?.('[data-key]');
    if (!row) return false;
    openOccurrenceSheet(row.dataset.key);
    return true;
  },
  // ao entrar na aba: começa em "Hoje" (o passado fica para cima)
  onShow: (root) => {
    const scroller = root.closest('.view') || root;
    const go = () => {
      const h = root.querySelector('[data-today]');
      const head = root.querySelector('.vh');
      if (!h) return;
      const delta = h.getBoundingClientRect().top - scroller.getBoundingClientRect().top - (head ? head.offsetHeight : 0) - 4;
      scroller.scrollTop = Math.max(0, scroller.scrollTop + delta);
    };
    if (firstShow) { firstShow = false; requestAnimationFrame(go); } else go();
  },
});
