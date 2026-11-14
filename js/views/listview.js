// Fábrica de abas no formato "título + busca + filtros + lista + botão +".
import { html, setHTML, $ } from '../ui.js';
import { viewHeader, searchBar, chipBar, setActiveChip, fab } from '../widgets.js';
import { handleRowAction } from '../rows.js';

/**
 * cfg: { id, title, placeholder, filters: () => [[v,label,count?]], initialFilter,
 *        addLabel?, onAdd?(), renderList({q, filter}) -> html, subtitle?() -> string,
 *        onClick?(target, event) -> bool, headerExtra?() -> html }
 */
export function createListView(cfg) {
  let root;
  let q = '';
  let filter = cfg.initialFilter;
  const els = {};

  function mount(el) {
    root = el;
    setHTML(root, html`
      <header class="vh">
        ${viewHeader(cfg.title, { right: html`<span class="vh-count" data-ref="count"></span>` })}
        ${searchBar(cfg.placeholder)}
        <div data-ref="chips"></div>
      </header>
      <div data-ref="extra"></div>
      <div class="list" data-ref="list"></div>
      ${cfg.onAdd ? fab(cfg.addLabel || 'Adicionar') : ''}`);
    for (const k of ['count', 'chips', 'list', 'extra']) els[k] = $(root, k);
    const input = root.querySelector('input[name=q]');
    input.addEventListener('input', () => {
      q = input.value;
      input.closest('.search').classList.toggle('has', !!q);
      renderList();
    });
    root.addEventListener('click', async (e) => {
      const chip = e.target.closest('[data-chip]');
      if (chip) { filter = chip.dataset.chip; setActiveChip(root, filter); renderList(); chip.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' }); return; }
      const t = e.target.closest('[data-act]');
      if (!t) { if (cfg.onClick) cfg.onClick(e.target, e); return; }
      if (t.dataset.act === 'clear-q') { input.value = ''; q = ''; input.closest('.search').classList.remove('has'); renderList(); return; }
      if (t.dataset.act === 'add' && cfg.onAdd) { cfg.onAdd(); return; }
      if (cfg.onClick && cfg.onClick(t, e)) return;
      await handleRowAction(t);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input[name=q]')) e.target.blur();
    });
  }

  function renderList() {
    setHTML(els.list, cfg.renderList({ q, filter }));
  }

  function update() {
    if (!root) return;
    const sl = els.chips.querySelector('.chips')?.scrollLeft || 0;
    setHTML(els.chips, chipBar(cfg.filters(), filter));
    if (sl) els.chips.querySelector('.chips').scrollLeft = sl;
    els.count.textContent = cfg.subtitle ? cfg.subtitle() : '';
    if (cfg.headerExtra) setHTML(els.extra, cfg.headerExtra());
    renderList();
  }

  return {
    id: cfg.id, mount, update,
    setFilter(f) { filter = f; if (root) update(); },
  };
}
