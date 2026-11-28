// Aba "Explorar": Locais e Eventos na mesma aba, com um alternador no topo (abre em Locais).
// Cada lado continua sendo a aba de antes (busca, filtros e ordem próprios).
import { html, setHTML } from '../ui.js';
import { state } from '../store.js';
import { createPlacesView, createEventsView } from './lists.js';

const SIDES = [
  ['places', 'Locais', () => state.places.length],
  ['events', 'Eventos', () => state.events.length],
];

export function createExploreView() {
  let root;
  let cur = 'places';
  const panes = {};
  const dirty = { places: true, events: true };

  // a linha de cima de cada lado: o alternador (com o número; filtrando, "3 de 77") + o botão de ordenar
  const titleRow = (side) => (c, { sortBtn }) => html`<div class="vh-row seg-row">
      <div class="seg2" role="tablist">${SIDES.map(([id, label, total]) => {
        const on = id === side;
        const n = on && c.filtered && c.shown != null ? `${c.shown} de ${total()}` : total();
        return html`<button type="button" class="seg2-btn ${on ? 'on' : ''}" data-act="side" data-side="${id}" role="tab" aria-selected="${on ? 'true' : 'false'}">${label} <small>${n}</small></button>`;
      })}</div>
      <div class="vh-right">${sortBtn}</div>
    </div>`;
  const onClick = (t) => {
    if (t.dataset?.act !== 'side') return false;
    show(t.dataset.side);
    return true;
  };
  const views = {
    places: createPlacesView({ titleRow: titleRow('places'), onClick }),
    events: createEventsView({ titleRow: titleRow('events'), onClick }),
  };

  function mount(el) {
    root = el;
    setHTML(root, html`<div class="xpane" data-view="places" data-pane="places"></div><div class="xpane" data-view="events" data-pane="events" hidden></div>`);
    for (const id of Object.keys(views)) {
      panes[id] = root.querySelector(`[data-pane="${id}"]`);
      views[id].mount(panes[id]);
    }
  }

  function show(id) {
    if (!views[id] || id === cur) return;
    cur = id;
    for (const k of Object.keys(panes)) panes[k].hidden = k !== id;
    if (dirty[id]) { views[id].update(); dirty[id] = false; }
    root.scrollTop = 0;
  }

  function update() {
    if (!root) return;
    views[cur].update();
    dirty[cur] = false;
    for (const k of Object.keys(views)) if (k !== cur) dirty[k] = true;
  }

  return { id: 'explore', mount, update, showSide: show };
}
