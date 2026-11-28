// Fábrica de abas no formato "título + busca + filtros + lista + botão +".
import { html, setHTML, $ } from '../ui.js';
import { viewHeader, searchBar, chipBar, setActiveChip, fab, facetBar, facetPass, toggleFacet, facetActive, sortButton, keepChipPlace } from '../widgets.js';
import { handleRowAction } from '../rows.js';
import { sortOf, chooseSort } from '../facets.js';

/**
 * cfg: { id, title, placeholder, filters: () => [[v,label,count?]], initialFilter,
 *        addLabel?, onAdd?(), renderList(ctx) -> html, subtitle?(ctx) -> string,
 *        onClick?(target, event) -> bool, headerExtra?() -> html }
 * Filtros em seções (no lugar de `filters`): facets: [{ id, mode, options }], facetItems: () => itens
 * Ordenação: sorts: [[valor, rótulo, curto]] (a escolha fica guardada por aba)
 * ctx = { q, filter, sel, pass, sort, shown } — renderList pode preencher ctx.shown (quantos mostrou)
 * titleRow?(ctx, { count, sortBtn }) -> html: troca a linha do título (ex.: alternador "Locais | Eventos")
 * onShow?(el): chamado quando a aba aparece
 */
export function createListView(cfg) {
  let root;
  let q = '';
  let filter = cfg.initialFilter;
  let sel = {};
  const els = {};

  function mount(el) {
    root = el;
    setHTML(root, html`
      <header class="vh">
        <div data-ref="title"></div>
        ${searchBar(cfg.placeholder)}
        <div data-ref="chips"></div>
      </header>
      <div data-ref="extra"></div>
      <div class="list" data-ref="list"></div>
      ${cfg.onAdd ? fab(cfg.addLabel || 'Adicionar') : ''}`);
    for (const k of ['title', 'chips', 'list', 'extra']) els[k] = $(root, k);
    const input = root.querySelector('input[name=q]');
    input.addEventListener('input', () => {
      q = input.value;
      input.closest('.search').classList.toggle('has', !!q);
      renderList();
    });
    root.addEventListener('click', async (e) => {
      const fchip = e.target.closest('[data-facet]');
      if (fchip && cfg.facets) {
        sel = toggleFacet(cfg.facets, sel, fchip.dataset.facet, fchip.dataset.chip);
        keepChipPlace(els.chips, fchip, renderChips);
        renderList();
        return;
      }
      const chip = e.target.closest('[data-chip]');
      if (chip) { filter = chip.dataset.chip; setActiveChip(root, filter); renderList(); chip.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' }); return; }
      const t = e.target.closest('[data-act]');
      if (!t) { if (cfg.onClick) cfg.onClick(e.target, e); return; }
      if (t.dataset.act === 'clear-q') { input.value = ''; q = ''; input.closest('.search').classList.remove('has'); renderList(); return; }
      if (t.dataset.act === 'clear-facets') { sel = {}; renderChips(); renderList(); return; }
      if (t.dataset.act === 'sort' && cfg.sorts) { if (await chooseSort(cfg.sortKey || cfg.id, cfg.sorts)) renderList(); return; }
      if (t.dataset.act === 'add' && cfg.onAdd) { cfg.onAdd(); return; }
      if (cfg.onClick && cfg.onClick(t, e)) return;
      await handleRowAction(t);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input[name=q]')) e.target.blur();
    });
  }

  function ctx() {
    return {
      q, filter, sel,
      pass: cfg.facets ? facetPass(cfg.facets, sel) : () => true,
      sort: cfg.sorts ? sortOf(cfg.sortKey || cfg.id, cfg.sorts) : null,
      filtered: !!q || facetActive(sel),
      shown: null,
    };
  }

  function renderChips() {
    const rows = [...els.chips.querySelectorAll('.chips')].map((c) => c.scrollLeft);
    setHTML(els.chips, cfg.facets ? facetBar(cfg.facets, sel, cfg.facetItems()) : chipBar(cfg.filters(), filter));
    els.chips.querySelectorAll('.chips').forEach((c, i) => { if (rows[i]) c.scrollLeft = rows[i]; });
  }

  function renderList() {
    const c = ctx();
    setHTML(els.list, cfg.renderList(c));
    const count = cfg.subtitle ? cfg.subtitle(c) : '';
    const sortBtn = cfg.sorts ? sortButton(cfg.sorts, c.sort) : '';
    setHTML(els.title, cfg.titleRow ? cfg.titleRow(c, { count, sortBtn })
      : viewHeader(cfg.title, { right: html`<span class="vh-count" data-ref="count">${count}</span>${sortBtn}` }));
  }

  function update() {
    if (!root) return;
    renderChips();
    if (cfg.headerExtra) setHTML(els.extra, cfg.headerExtra());
    renderList();
  }

  return {
    id: cfg.id, mount, update,
    onShow() { if (cfg.onShow && root) cfg.onShow(root); },
    setFilter(f) { filter = f; if (root) update(); },
  };
}
