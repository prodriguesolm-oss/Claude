// Formulários de cadastro/edição: local, evento, visita a local e compromisso.
import {
  state, savePlace, saveEvent, saveVisit, saveCommitment, deleteEvent, deleteVisit, deleteCommitment,
  applyMoves, getPhoto, deletePlace, placeDependents, saveItem, deleteItem, linkOption,
} from './store.js';
import { openSheet, html, ic, raw, toast, shake, confirmDialog, alertDialog, setHTML } from './ui.js';
import {
  segHTML, switchCell, textCell, dateTimeCells, durationCell, readStart, placePickerCell,
  bindFormWidgets, searchBar, placeThumb, remindCells, readRemind, chipBar, catBadge,
  facetBar, facetPass, toggleFacet, sortButton, keepChipPlace,
} from './widgets.js';
import { PLACE_FACETS, PLACE_SORTS, placeComparator, sortOf, chooseSort } from './facets.js';
import { pushReady } from './push.js';
import { resolveConflicts, confirmSeries } from './conflicts.js';
import { processPhoto } from './photo.js';
import { uid, matchScore, byName } from './util.js';
import {
  MIN, DAY, roundUp, minutesOfDay, fmtMin, parseHM, atMinutes, dateKey, WD_CAP, fmtDayLong, fmtRange,
} from './time.js';

const CAT_OPTIONS = [['', 'Nenhuma'], ['cultura', 'Cultura'], ['aventura', 'Aventura'], ['bares', 'Bares e restaurantes'], ['outros', 'Outros']];

export const defaultStart = () => roundUp(Date.now() + 15 * MIN, 30);

// prefill.optionOf: criando um Plano B para esta ocorrência (mesmo horário, sem checar conflito; liga como opção)
// prefill.replacing: preenchendo um horário que ficou vazio ("o que você fez?"): sem checar conflito
const freeSlot = (prefill) => !!(prefill.optionOf || prefill.replacing);
const durFrom = (prefill, start, fallback) => (prefill.end && prefill.end > start ? Math.round((prefill.end - start) / MIN) : fallback);
async function afterSave(prefill, key) {
  if (!prefill.optionOf) return false;
  const g = await linkOption(prefill.optionOf, key);
  return !!g;
}

function remindGroup(value, note = '') {
  return html`<div class="group-label">Notificação</div>
    <div class="form-group">${remindCells(value ?? null, { defaultLead: state.settings.defaultRemind ?? 60, ready: pushReady(), note })}</div>`;
}

function deleteButton(label) {
  return html`<div class="form-group"><button type="button" class="cell danger center" data-act="delete">${ic('trash', 'i sm')} ${label}</button></div>`;
}

// ---------- seletores com busca e filtros (mesma facilidade das abas Locais/Eventos) ----------

/**
 * Folha de escolha genérica: busca + chips de filtro + lista + ação "criar novo" no topo.
 * cfg: { title, placeholder, items, filters: [[v, label, pass]], initial, fields(it), sort(a,b), row(it), newLabel, onNew(q) }
 * -> Promise<id escolhido | undefined>
 */
function openFilterPicker(cfg) {
  let q = '';
  let filter = cfg.initial || 'all';
  let sel = {};
  const ctl = openSheet({
    title: cfg.title,
    className: 'picker-sheet',
    body: html`<div class="sticky-search">${searchBar(cfg.placeholder)}<div data-ref="chips"></div>${cfg.sorts ? html`<div class="pick-tools" data-ref="ptools"></div>` : ''}</div>
      ${cfg.newLabel ? html`<div class="form-group"><button type="button" class="cell" data-act="new"><span class="cell-ic accent">${ic('plus', 'i sm')}</span><span class="accent grow">${cfg.newLabel}</span></button></div>` : ''}
      <div class="group" data-ref="plist"></div>`,
  });
  const chipsEl = ctl.body.querySelector('[data-ref="chips"]');
  const listEl = ctl.body.querySelector('[data-ref="plist"]');
  const toolsEl = ctl.body.querySelector('[data-ref="ptools"]');
  const passOf = (v) => (cfg.filters.find((f) => f[0] === v) || cfg.filters[0])[2];
  const renderChips = () => {
    const rows = [...chipsEl.querySelectorAll('.chips')].map((c) => c.scrollLeft);
    setHTML(chipsEl, cfg.facets ? facetBar(cfg.facets, sel, cfg.items)
      : chipBar(cfg.filters.map(([v, label, pass]) => [v, label, cfg.items.filter(pass).length]), filter));
    chipsEl.querySelectorAll('.chips').forEach((c, i) => { if (rows[i]) c.scrollLeft = rows[i]; });
  };
  const render = () => {
    if (toolsEl) setHTML(toolsEl, sortButton(cfg.sorts, sortOf(cfg.sortKey, cfg.sorts)));
    if (!cfg.items.length) { setHTML(listEl, html`<div class="note">${cfg.emptyText || 'Nada cadastrado ainda.'}</div>`); return; }
    const pass = cfg.facets ? facetPass(cfg.facets, sel) : passOf(filter);
    const sort = cfg.sorts ? cfg.sortBy(sortOf(cfg.sortKey, cfg.sorts)) : cfg.sort;
    const list = cfg.items
      .filter(pass)
      .map((it) => ({ it, sc: matchScore(q, ...cfg.fields(it)) }))
      .filter((x) => x.sc > 0)
      .sort((a, b) => (q ? b.sc - a.sc : 0) || sort(a.it, b.it))
      .map((x) => x.it);
    setHTML(listEl, list.length ? html`${list.map((it) => cfg.row(it))}` : html`<div class="note">Nada encontrado${q ? html` para “${q}”` : ' com este filtro'}.</div>`);
  };
  renderChips();
  render();
  ctl.body.addEventListener('input', (e) => {
    if (e.target.name === 'q') { q = e.target.value; e.target.closest('.search').classList.toggle('has', !!q); render(); }
  });
  ctl.body.addEventListener('click', async (e) => {
    const fchip = e.target.closest('[data-facet]');
    if (fchip && cfg.facets) { sel = toggleFacet(cfg.facets, sel, fchip.dataset.facet, fchip.dataset.chip); keepChipPlace(chipsEl, fchip, renderChips); render(); return; }
    const chip = e.target.closest('[data-chip]');
    if (chip) { filter = chip.dataset.chip; renderChips(); render(); return; }
    if (e.target.closest('[data-act="clear-facets"]')) { sel = {}; renderChips(); render(); return; }
    if (e.target.closest('[data-act="sort"]') && cfg.sorts) { if (await chooseSort(cfg.sortKey, cfg.sorts)) render(); return; }
    const pick = e.target.closest('[data-pick]');
    if (pick) { ctl.close(pick.dataset.pick); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear-q') { const i = ctl.body.querySelector('input[name=q]'); i.value = ''; q = ''; i.closest('.search').classList.remove('has'); render(); }
    if (act === 'new' && cfg.onNew) {
      const id = await cfg.onNew(q);
      if (id) ctl.close(id);
    }
  });
  return ctl.result;
}

const CAT_FILTERS = [
  ['cultura', 'Cultura', (x) => x.category === 'cultura'],
  ['aventura', 'Aventura', (x) => x.category === 'aventura'],
  ['bares', 'Bares e restaurantes', (x) => x.category === 'bares'],
  ['outros', 'Outros', (x) => x.category === 'outros'],
];

export function openPlacePicker(selectedId, { title = 'Escolher local' } = {}) {
  return openFilterPicker({
    title,
    placeholder: 'Buscar locais',
    items: state.places,
    // mesmos filtros da aba Locais (numa linha, vários ao mesmo tempo)
    facets: PLACE_FACETS,
    sorts: PLACE_SORTS,
    sortKey: 'places',
    sortBy: placeComparator,
    fields: (p) => [p.name, p.address],
    emptyText: 'Nenhum local cadastrado ainda. Cadastre o primeiro acima — ele já fica selecionado.',
    newLabel: 'Cadastrar novo local',
    onNew: async (q) => (await openPlaceForm({ prefill: { name: q } }))?.id,
    row: (p) => html`<button type="button" class="row pick-row" data-pick="${p.id}">${placeThumb(p, 'thumb sm')}
      <div class="row-main"><div class="row-title">${p.name}</div>
        <div class="row-meta">${catBadge(p.category)}${p.visited ? html`<span class="badge ok">${ic('check', 'i xs')} Visitado</span>` : ''}${p.favorite ? html`<span class="badge star-b">${ic('star', 'i xs', true)}</span>` : ''}${p.isDate ? html`<span class="badge heart-b">${ic('heart', 'i xs', true)}</span>` : ''}</div>
      </div>${p.id === selectedId ? ic('check', 'i accent') : ''}</button>`,
  });
}

/** escolher um evento já cadastrado (ex.: "Quebra-Nozes", ainda sem data) ou criar um novo */
export function openEventPicker({ title = 'Escolher evento' } = {}) {
  const now = Date.now();
  const done = (e) => e.status === 'done' || e.status === 'missed' || (e.start != null && e.end <= now);
  const nodate = (e) => e.start == null && !done(e);
  const placeName = (e) => state.places.find((p) => p.id === e.placeId)?.name || '';
  return openFilterPicker({
    title,
    placeholder: 'Buscar eventos ou locais',
    items: state.events,
    initial: state.events.some(nodate) ? 'nodate' : 'all',
    filters: [
      ['nodate', 'Sem data', nodate],
      ['all', 'Todos', () => true],
      ['upcoming', 'Próximos', (e) => e.start != null && !done(e)],
      ['fav', 'Favoritos', (e) => e.favorite],
      ['date', '♥ Date', (e) => e.isDate],
      ...CAT_FILTERS.map(([v, l]) => [v, l, (e) => (e.category || state.places.find((p) => p.id === e.placeId)?.category) === v]),
      ['done', 'Já feitos', done],
    ],
    fields: (e) => [e.name, placeName(e)],
    sort: (a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || byName(a, b),
    emptyText: 'Nenhum evento cadastrado ainda. Crie o primeiro acima.',
    newLabel: 'Criar novo evento',
    onNew: async () => 'new',
    row: (e) => {
      const pl = state.places.find((p) => p.id === e.placeId);
      const cat = e.category || pl?.category;
      return html`<button type="button" class="row pick-row" data-pick="${e.id}">
        <span class="pick-dot c-${cat || 'none'}"></span>
        <div class="row-main"><div class="row-title">${e.name}</div>
          <div class="row-sub">${ic('pin', 'i xs')} ${pl?.name || 'Local removido'}</div>
          <div class="row-meta">${catBadge(cat)}${e.start != null ? html`<span class="badge">${fmtDayLong(e.start).split(',')[0]}, ${new Date(e.start).getDate()}/${new Date(e.start).getMonth() + 1} · ${fmtRange(e.start, e.end)}</span>` : html`<span class="badge">sem data</span>`}${done(e) ? html`<span class="badge ok">Feito</span>` : ''}</div>
        </div></button>`;
    },
  });
}

function bindPlacePicker(root, onPicked) {
  root.addEventListener('click', async (e) => {
    const cell = e.target.closest('[data-act="pick-place"]');
    if (!cell) return;
    const current = cell.querySelector('input[name=placeId]').value;
    const id = await openPlacePicker(current);
    if (!id) return;
    const place = state.places.find((p) => p.id === id);
    cell.outerHTML = String(placePickerCell(place));
    onPicked?.(place);
  });
}

// ---------- local ----------

export function openPlaceForm({ id = null, prefill = {} } = {}) {
  const prev = id ? state.places.find((p) => p.id === id) : null;
  const p = prev || { name: prefill.name || '', address: '', category: null, favorite: false, hasPhoto: false };
  let photo; // undefined = mantém | null = remover | {full, thumb}
  const start = prefill.start || defaultStart();

  const previewHtml = (src) => (src
    ? html`<img src="${src}" alt="Foto do local">`
    : html`<div class="photo-empty">${ic('camera', 'i xl')}<span>Toque para adicionar uma foto</span></div>`);

  const ctl = openSheet({
    title: prev ? 'Editar local' : 'Novo local',
    right: 'Salvar',
    body: html`<form class="form" novalidate autocomplete="off">
      <input type="file" accept="image/*" data-ref="file" hidden>
      <div class="photo-pick">
        <button type="button" class="photo-preview" data-act="pick-photo" aria-label="Escolher foto">${previewHtml(p.thumb)}</button>
        <div class="photo-actions" data-ref="photoActions">
          <button type="button" class="btn tinted sm" data-act="pick-photo">${ic('camera', 'i sm')} <span>${p.hasPhoto ? 'Trocar foto' : 'Adicionar foto'}</span></button>
          <button type="button" class="btn plain sm danger-text" data-act="remove-photo" ${p.hasPhoto ? '' : 'hidden'}>Remover</button>
        </div>
      </div>
      <div class="form-group">
        ${textCell('name', 'Nome', p.name, { placeholder: 'Ex.: Teatro Municipal', required: true })}
        ${textCell('address', 'Endereço', p.address, { placeholder: 'Rua, número, bairro, cidade', multiline: true })}
      </div>
      <div class="group-label">Classificação (opcional)</div>
      <div class="form-group pad">${segHTML('category', CAT_OPTIONS, p.category || '', 'wrap')}</div>
      <div class="form-group">${switchCell('favorite', 'Favorito', p.favorite, 'star')}${switchCell('isDate', 'Date ♥', !!p.isDate, 'heart')}</div>
      ${prev ? '' : html`<div class="group-label">Agenda (opcional)</div>
        <div class="form-group">
          ${switchCell('schedule', 'Agendar visita', !!prefill.schedule, 'calendar')}
          <div data-show-when="schedule">${dateTimeCells('v', start)}${durationCell('duration', 120, 'v')}</div>
        </div>
        <div class="group-foot">Marque um horário para conhecer o local sem precisar criar um evento.</div>`}
      ${prev ? deleteButton('Excluir local') : ''}
    </form>`,
    onRight: async (c) => {
      const f = c.body.querySelector('form');
      const name = f.elements.name.value.trim();
      if (!name) { shake(f.elements.name.closest('.cell')); toast('Dê um nome ao local', { icon: 'alert' }); return false; }
      const data = {
        id: prev?.id, name,
        address: f.elements.address.value.trim(),
        category: f.elements.category.value || null,
        favorite: f.elements.favorite.checked,
        isDate: f.elements.isDate.checked,
      };
      let res = null;
      let vStart = null;
      if (!prev && f.elements.schedule?.checked) {
        vStart = readStart(f, 'v');
        if (vStart == null) { toast('Informe data e horário da visita', { icon: 'alert' }); return false; }
        const vEnd = vStart + Number(f.elements.duration.value) * MIN;
        res = await resolveConflicts({ key: 'new', start: vStart, end: vEnd, title: name });
        if (!res) return false;
      }
      const saved = await savePlace(data, photo);
      if (res) {
        await saveVisit({ placeId: saved.id, start: res.start, end: res.end });
        await applyMoves(res.moves);
      }
      return saved;
    },
  });

  const fileInput = ctl.body.querySelector('[data-ref="file"]');
  const preview = ctl.body.querySelector('.photo-preview');
  const actions = ctl.body.querySelector('[data-ref="photoActions"]');
  bindFormWidgets(ctl.body);

  if (prev?.hasPhoto) getPhoto(prev.id).then((full) => { if (full && photo === undefined) setHTML(preview, previewHtml(full)); });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    preview.classList.add('loading');
    try {
      photo = await processPhoto(file);
      setHTML(preview, previewHtml(photo.full));
      actions.querySelector('[data-act="pick-photo"] span').textContent = 'Trocar foto';
      actions.querySelector('[data-act="remove-photo"]').hidden = false;
    } catch (err) {
      alertDialog({ title: 'Foto não carregada', message: err.message });
    } finally {
      preview.classList.remove('loading');
      fileInput.value = '';
    }
  });

  ctl.body.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'pick-photo') fileInput.click();
    if (act === 'remove-photo') {
      photo = null;
      setHTML(preview, previewHtml(null));
      actions.querySelector('[data-act="pick-photo"] span').textContent = 'Adicionar foto';
      actions.querySelector('[data-act="remove-photo"]').hidden = true;
    }
    if (act === 'delete' && prev) {
      const dep = placeDependents(prev.id);
      const extra = dep.events.length || dep.visits.length
        ? ` Também serão excluídos ${dep.events.length} evento(s) e ${dep.visits.length} visita(s) agendadas neste local. O histórico é mantido.`
        : ' O histórico é mantido.';
      const ok = await confirmDialog({ title: `Excluir “${prev.name}”?`, message: `Esta ação não pode ser desfeita.${extra}`, ok: 'Excluir', destructive: true });
      if (!ok) return;
      await deletePlace(prev.id);
      ctl.close();
    }
  });
  return ctl.result;
}

// ---------- evento ----------

export function openEventForm({ id = null, prefill = {}, requireSchedule = false } = {}) {
  const prev = id ? state.events.find((e) => e.id === id) : null;
  const e = prev || { name: '', placeId: prefill.placeId || null, category: null, favorite: false, start: null };
  const place = state.places.find((p) => p.id === e.placeId);
  const isDone = prev?.status === 'done';
  const scheduled = prev ? prev.start != null : true;
  // evento já feito e sem data: sugere uma data no passado (para não "desfazer" sem querer)
  // vindo da agenda (horário tocado / Plano B), o horário escolhido vale mesmo para um evento que já tinha data
  const start = (requireSchedule && prefill.start) || (prev?.start ?? prefill.start ?? (isDone ? roundUp(Date.now() - 3 * 60 * MIN, 30) : defaultStart()));
  const dur = durFrom(prefill, start, prev?.start != null ? Math.round((prev.end - prev.start) / MIN) : 120);

  const statusLine = isDone
    ? 'Concluído — está no Histórico. Você pode mudar a data em que foi; ele continua como feito.'
    : prev?.status === 'missed' ? 'Marcado como “não aconteceu”.' : '';

  const ctl = openSheet({
    title: prev ? (requireSchedule && prefill.start && prev.start !== prefill.start ? 'Agendar evento' : 'Editar evento') : prefill.optionOf ? 'Plano B: evento' : 'Novo evento',
    right: 'Salvar',
    body: html`<form class="form" novalidate autocomplete="off">
      <div class="group-label">Local do evento <span class="req">obrigatório</span></div>
      <div class="form-group">${placePickerCell(place)}</div>
      <div class="group-label">Evento</div>
      <div class="form-group">${textCell('name', 'Nome', e.name, { placeholder: 'Opcional — usa o nome do local' })}</div>
      <div class="group-label">${isDone ? 'Quando foi' : 'Quando'}</div>
      <div class="form-group">
        ${requireSchedule ? raw('<input type="checkbox" name="schedule" checked hidden>') : switchCell('schedule', isDone ? 'Tem data' : 'Agendar', scheduled, 'calendar')}
        <div data-show-when="schedule">${dateTimeCells('e', start)}${durationCell('duration', dur, 'e')}</div>
      </div>
      <div class="group-foot">${statusLine || 'Eventos com horário entram automaticamente na Agenda.'}</div>
      <div data-show-when="schedule">${remindGroup(e.remind)}</div>
      <div class="group-label">Classificação (opcional)</div>
      <div class="form-group pad">${segHTML('category', CAT_OPTIONS, e.category || '', 'wrap')}</div>
      <div class="form-group">${switchCell('favorite', 'Favorito', e.favorite, 'star')}${switchCell('isDate', 'Date ♥', !!e.isDate, 'heart')}</div>
      ${prev ? deleteButton('Excluir evento') : ''}
    </form>`,
    onRight: async (c) => {
      const f = c.body.querySelector('form');
      const placeId = f.elements.placeId.value;
      if (!placeId) { shake(c.body.querySelector('.picker')); toast('Escolha um local cadastrado', { icon: 'pin' }); return false; }
      const pl = state.places.find((p) => p.id === placeId);
      const name = f.elements.name.value.trim() || pl?.name || 'Evento';
      const data = { id: prev?.id, placeId, name, category: f.elements.category.value || null, favorite: f.elements.favorite.checked, isDate: f.elements.isDate.checked, start: null, end: null, remind: readRemind(f) };
      let res = null;
      let reqStart = null;
      if (f.elements.schedule.checked) {
        reqStart = readStart(f, 'e');
        if (reqStart == null) { toast('Informe data e horário', { icon: 'alert' }); return false; }
        const end = reqStart + Number(f.elements.duration.value) * MIN;
        const sameTime = prev && prev.start === reqStart && prev.end === end;
        const pastDone = isDone && end <= Date.now(); // só corrigindo a data de algo já feito: sem checar conflito
        if (!sameTime && (pastDone || freeSlot(prefill))) { data.start = reqStart; data.end = end; } else if (!sameTime) {
          res = await resolveConflicts({ key: prev ? `event:${prev.id}` : 'new', start: reqStart, end, title: name });
          if (!res) return false;
          data.start = res.start; data.end = res.end;
        } else { data.start = prev.start; data.end = prev.end; }
      }
      const saved = await saveEvent(data);
      if (res) await applyMoves(res.moves);
      if (await afterSave(prefill, `event:${saved.id}`)) return saved;
      return saved;
    },
  });
  bindFormWidgets(ctl.body);
  bindPlacePicker(ctl.body);
  ctl.body.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-act="delete"]') && prev) {
      const ok = await confirmDialog({ title: `Excluir “${prev.name}”?`, message: 'O evento sai da agenda. O que já está no histórico é mantido.', ok: 'Excluir', destructive: true });
      if (!ok) return;
      await deleteEvent(prev.id);
      ctl.close();
    }
  });
  return ctl.result;
}

// ---------- visita a local (local na agenda, sem evento) ----------

export function openVisitForm({ id = null, prefill = {} } = {}) {
  const prev = id ? state.visits.find((v) => v.id === id) : null;
  const placeId = prev?.placeId || prefill.placeId || null;
  const place = state.places.find((p) => p.id === placeId);
  const start = prev?.start ?? prefill.start ?? defaultStart();
  const dur = prev ? Math.round((prev.end - prev.start) / MIN) : durFrom(prefill, start, 120);

  const ctl = openSheet({
    title: prev ? 'Editar visita' : prefill.optionOf ? 'Plano B: local' : 'Agendar visita',
    right: 'Salvar',
    body: html`<form class="form" novalidate autocomplete="off">
      <div class="group-label">Local <span class="req">obrigatório</span></div>
      <div class="form-group">${placePickerCell(place)}</div>
      <div class="group-label">Quando</div>
      <div class="form-group">${dateTimeCells('v', start)}${durationCell('duration', dur, 'v')}</div>
      <div class="group-foot">Quando o horário passar sem alterações, o local é marcado como visitado e vai para o Histórico.</div>
      ${remindGroup(prev?.remind)}
      ${prev ? deleteButton('Excluir visita') : ''}
    </form>`,
    onRight: async (c) => {
      const f = c.body.querySelector('form');
      const pid = f.elements.placeId.value;
      if (!pid) { shake(c.body.querySelector('.picker')); toast('Escolha um local cadastrado', { icon: 'pin' }); return false; }
      const s = readStart(f, 'v');
      if (s == null) { toast('Informe data e horário', { icon: 'alert' }); return false; }
      const end = s + Number(f.elements.duration.value) * MIN;
      const pl = state.places.find((p) => p.id === pid);
      let res = { start: s, end, moves: [], policy: null };
      if (!(prev && prev.start === s && prev.end === end) && !(prev?.status === 'done' && end <= Date.now()) && !freeSlot(prefill)) {
        res = await resolveConflicts({ key: prev ? `visit:${prev.id}` : 'new', start: s, end, title: pl?.name || 'Visita' });
        if (!res) return false;
      }
      const saved = await saveVisit({ id: prev?.id, placeId: pid, start: res.start, end: res.end, remind: readRemind(f) });
      await applyMoves(res.moves);
      if (await afterSave(prefill, `visit:${saved.id}`)) return saved;
      return saved;
    },
  });
  bindFormWidgets(ctl.body);
  bindPlacePicker(ctl.body);
  ctl.body.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-act="delete"]') && prev) {
      const ok = await confirmDialog({ title: 'Excluir esta visita?', message: 'Ela sai da agenda. O local continua cadastrado.', ok: 'Excluir', destructive: true });
      if (!ok) return;
      await deleteVisit(prev.id);
      ctl.close();
    }
  });
  return ctl.result;
}

// ---------- compromisso ----------

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const FREQS = [['daily', 'Diário'], ['weekly', 'Semanal'], ['monthly', 'Mensal'], ['once', 'Único']];
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

function slotHTML(slot, canDelete) {
  const days = slot.days || [];
  const mdays = slot.monthDays || [];
  return html`<div class="form-group slot" data-slot="${slot.id}">
    <div class="slot-days only-weekly">${WEEK_ORDER.map((d) => html`<button type="button" class="dchip ${days.includes(d) ? 'on' : ''}" data-day="${d}" aria-pressed="${days.includes(d)}">${WD_CAP[d]}</button>`)}</div>
    <div class="slot-mdays only-monthly">${MONTH_DAYS.map((d) => html`<button type="button" class="dchip mchip ${mdays.includes(d) ? 'on' : ''}" data-mday="${d}" aria-pressed="${mdays.includes(d)}">${d}</button>`)}</div>
    <div class="slot-times">
      <label class="tfield"><span>Das</span><input type="time" data-f="start" value="${fmtMin(slot.startMin)}" step="300"></label>
      <label class="tfield"><span>às</span><input type="time" data-f="end" value="${fmtMin(slot.endMin)}" step="300"></label>
      <button type="button" class="slot-del" data-act="del-slot" aria-label="Remover horário" ${canDelete ? '' : 'hidden'}>${ic('trash', 'i sm')}</button>
    </div>
  </div>`;
}

export function openCommitmentForm({ id = null, prefill = {} } = {}) {
  const prev = id ? state.commitments.find((c) => c.id === id) : null;
  const kind = prev?.kind || prefill.kind || 'weekly';
  const pStart = prefill.start || defaultStart();
  const startMin = minutesOfDay(pStart);
  const slots = prev?.slots?.length
    ? prev.slots
    : [{ id: uid(), days: [new Date(pStart).getDay()], monthDays: [new Date(pStart).getDate()], startMin, endMin: (startMin + 60) % 1440 }];
  const onceStart = prev?.kind === 'once' && prev.start ? prev.start : pStart;
  const onceEnd = prev?.kind === 'once' && prev.end ? prev.end : (prefill.end && prefill.end > pStart ? prefill.end : pStart + 60 * MIN);
  const startDate = prev?.startDate || dateKey(Date.now());
  const untilDate = prev?.untilDate || '';
  const REC = 'kind=daily|weekly|monthly';

  const ctl = openSheet({
    title: prev ? 'Editar compromisso' : prefill.optionOf ? 'Plano B: compromisso' : 'Novo compromisso',
    right: 'Salvar',
    body: html`<form class="form" novalidate autocomplete="off">
      <div class="form-group">${textCell('name', 'Nome', prev?.name || '', { placeholder: 'Ex.: Terapia, Trabalho, Academia', required: true })}</div>
      <div class="group-label">Frequência</div>
      <div class="form-group pad">${segHTML('kind', FREQS, kind)}</div>
      <div data-show-when="${REC}">
        <div class="group-label">
          <span data-show-when="kind=daily">Horários (todos os dias)</span>
          <span data-show-when="kind=weekly">Dias da semana e horários</span>
          <span data-show-when="kind=monthly">Dias do mês e horários</span>
        </div>
        <div class="slots" data-ref="slots" data-kind="${kind}">${slots.map((s) => slotHTML(s, slots.length > 1))}</div>
        <button type="button" class="btn tinted full" data-act="add-slot">${ic('plus', 'i sm')} Adicionar outro horário</button>
        <div class="group-foot slot-foot" data-show-when="kind=monthly">Dias 29, 30 e 31: nos meses mais curtos, vale o último dia do mês.</div>
        <div class="group-label" style="margin-top:22px">Período</div>
        <div class="form-group">
          <label class="cell"><span class="cell-ic">${ic('calendar', 'i sm')}</span><span class="lbl grow">Começa em</span><input type="date" name="startDate" value="${startDate}"></label>
          ${switchCell('hasUntil', 'Tem data para acabar', !!untilDate, 'ban')}
          <div data-show-when="hasUntil"><label class="cell"><span class="cell-ic">${ic('calendar', 'i sm')}</span><span class="lbl grow">Termina em</span><input type="date" name="untilDate" value="${untilDate}"></label></div>
        </div>
        <div class="group-foot">Para mudar só uma vez (ex.: adiar a terapia de amanhã em 24h), toque no compromisso na Agenda. As outras ocorrências continuam iguais.</div>
      </div>
      <div data-show-when="kind=once">
        <div class="group-label">Quando</div>
        <div class="form-group">
          ${dateTimeCells('o', onceStart)}
          <label class="cell"><span class="cell-ic">${ic('clock', 'i sm')}</span><span class="lbl grow">Fim</span><input type="time" name="oEnd" value="${fmtMin(minutesOfDay(onceEnd))}" step="300"></label>
        </div>
      </div>
      ${remindGroup(prev?.remind, 'Vale para todas as ocorrências deste compromisso.')}
      ${prev ? deleteButton('Excluir compromisso') : ''}
    </form>`,
    onRight: async (c) => {
      const f = c.body.querySelector('form');
      const name = f.elements.name.value.trim();
      if (!name) { shake(f.elements.name.closest('.cell')); toast('Dê um nome ao compromisso', { icon: 'alert' }); return false; }
      const k = f.elements.kind.value;
      const data = { id: prev?.id, name, kind: k, remind: readRemind(f) };
      if (k !== 'once') {
        const readSlots = [...c.body.querySelectorAll('.slot')].map((el) => {
          const slot = { id: el.dataset.slot, startMin: parseHM(el.querySelector('[data-f=start]').value), endMin: parseHM(el.querySelector('[data-f=end]').value) };
          if (k === 'weekly') slot.days = [...el.querySelectorAll('.slot-days .dchip.on')].map((b) => Number(b.dataset.day)).sort();
          if (k === 'monthly') slot.monthDays = [...el.querySelectorAll('.slot-mdays .dchip.on')].map((b) => Number(b.dataset.mday)).sort((a, b) => a - b);
          return slot;
        });
        const bad = readSlots.findIndex((s) => s.startMin == null || s.endMin == null || s.startMin === s.endMin
          || (k === 'weekly' && !s.days.length) || (k === 'monthly' && !s.monthDays.length));
        if (bad >= 0) {
          shake(c.body.querySelectorAll('.slot')[bad]);
          toast(k === 'daily' ? 'Confira os horários' : k === 'weekly' ? 'Escolha ao menos um dia da semana' : 'Escolha ao menos um dia do mês', { icon: 'alert' });
          return false;
        }
        data.slots = readSlots;
        data.startDate = f.elements.startDate.value || dateKey(Date.now());
        data.untilDate = f.elements.hasUntil.checked ? (f.elements.untilDate.value || null) : null;
        if (data.untilDate && data.untilDate < data.startDate) { toast('A data final é antes do início', { icon: 'alert' }); return false; }
        if (prev && prev.kind !== 'once') data.overrides = prev.overrides || {};
        const ok = await confirmSeries({ ...prev, ...data, id: prev?.id || 'new', overrides: data.overrides || {} });
        if (!ok) return false;
        const saved = await saveCommitment(data);
        return saved;
      }
      const s = readStart(f, 'o');
      const endMin = parseHM(f.elements.oEnd.value);
      if (s == null || endMin == null) { toast('Informe data, início e fim', { icon: 'alert' }); return false; }
      let end = atMinutes(dateKey(s), endMin);
      if (end <= s) end += DAY;
      let res = { start: s, end, moves: [], policy: null };
      if (!(prev && prev.kind === 'once' && prev.start === s && prev.end === end) && !freeSlot(prefill)) {
        res = await resolveConflicts({ key: prev ? `commitment:${prev.id}:once` : 'new', start: s, end, title: name });
        if (!res) return false;
      }
      const saved = await saveCommitment({ ...data, start: res.start, end: res.end, status: null });
      await applyMoves(res.moves);
      if (await afterSave(prefill, `commitment:${saved.id}:once`)) return saved;
      return saved;
    },
  });
  bindFormWidgets(ctl.body);
  const slotsEl = ctl.body.querySelector('[data-ref="slots"]');
  const refreshDel = () => {
    const all = slotsEl.querySelectorAll('.slot');
    all.forEach((s) => { s.querySelector('[data-act="del-slot"]').hidden = all.length < 2; });
  };
  ctl.body.addEventListener('change', (e) => {
    if (e.target.name === 'kind' || e.target.closest?.('[data-seg="kind"]')) slotsEl.dataset.kind = ctl.body.querySelector('input[name=kind]').value;
  });
  ctl.body.addEventListener('click', async (e) => {
    const chip = e.target.closest('.dchip');
    if (chip) { chip.classList.toggle('on'); chip.setAttribute('aria-pressed', chip.classList.contains('on')); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'add-slot') {
      const last = slotsEl.querySelector('.slot:last-child');
      const sm = parseHM(last?.querySelector('[data-f=start]').value) ?? 600;
      const em = parseHM(last?.querySelector('[data-f=end]').value) ?? 660;
      slotsEl.insertAdjacentHTML('beforeend', String(slotHTML({ id: uid(), days: [], monthDays: [], startMin: sm, endMin: em }, true)));
      refreshDel();
    }
    if (act === 'del-slot') { e.target.closest('.slot').remove(); refreshDel(); }
    if (act === 'delete' && prev) {
      const ok = await confirmDialog({ title: `Excluir “${prev.name}”?`, message: prev.kind !== 'once' ? 'Todas as ocorrências futuras saem da agenda. O histórico é mantido.' : 'Ele sai da agenda. O histórico é mantido.', ok: 'Excluir', destructive: true });
      if (!ok) return;
      await deleteCommitment(prev.id);
      ctl.close();
    }
  });
  return ctl.result;
}

// ---------- horário avulso (só título e hora) ----------

export function openItemForm({ id = null, prefill = {} } = {}) {
  const prev = id ? state.items.find((i) => i.id === id) : null;
  const start = prev?.start ?? prefill.start ?? defaultStart();
  const dur = prev ? Math.round((prev.end - prev.start) / MIN) : durFrom(prefill, start, 60);
  const ctl = openSheet({
    title: prev ? 'Editar horário' : prefill.optionOf ? 'Plano B: horário avulso' : 'Horário avulso',
    right: 'Salvar',
    body: html`<form class="form" novalidate autocomplete="off">
      <div class="form-group">
        ${textCell('title', 'Título', prev?.title || '', { placeholder: 'Ex.: Shopping Leblon, comprar roupa', required: true })}
        ${textCell('note', 'Obs.', prev?.note || '', { placeholder: 'Opcional', multiline: true })}
      </div>
      <div class="group-label">Quando</div>
      <div class="form-group">${dateTimeCells('i', start)}${durationCell('duration', dur, 'i')}</div>
      <div class="group-foot">Só um título e um horário na agenda — sem precisar cadastrar local, evento ou compromisso.</div>
      ${remindGroup(prev?.remind)}
      ${prev ? deleteButton('Excluir horário') : ''}
    </form>`,
    onRight: async (c) => {
      const f = c.body.querySelector('form');
      const title = f.elements.title.value.trim();
      if (!title) { shake(f.elements.title.closest('.cell')); toast('Dê um título', { icon: 'alert' }); return false; }
      const s = readStart(f, 'i');
      if (s == null) { toast('Informe data e horário', { icon: 'alert' }); return false; }
      const end = s + Number(f.elements.duration.value) * MIN;
      let res = { start: s, end, moves: [], policy: null };
      if (!(prev && prev.start === s && prev.end === end) && !(prev?.status === 'done' && end <= Date.now()) && !freeSlot(prefill)) {
        res = await resolveConflicts({ key: prev ? `item:${prev.id}` : 'new', start: s, end, title });
        if (!res) return false;
      }
      const saved = await saveItem({ id: prev?.id, title, note: f.elements.note.value.trim(), start: res.start, end: res.end, remind: readRemind(f) });
      await applyMoves(res.moves);
      if (await afterSave(prefill, `item:${saved.id}`)) return saved;
      return saved;
    },
  });
  bindFormWidgets(ctl.body);
  ctl.body.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-act="delete"]') && prev) {
      const ok = await confirmDialog({ title: `Excluir “${prev.title}”?`, message: 'Ele sai da agenda. O histórico é mantido.', ok: 'Excluir', destructive: true });
      if (!ok) return;
      await deleteItem(prev.id);
      ctl.close();
    }
  });
  return ctl.result;
}

/** formulário curto de "alterar data e horário" de uma ocorrência */
export function openRescheduleForm(occ, onSubmit) {
  const dur = Math.round((occ.end - occ.start) / MIN);
  const ctl = openSheet({
    title: 'Alterar horário',
    right: 'Aplicar',
    body: html`<form class="form" novalidate>
      <div class="occ-mini k-${occ.kind}"><b>${occ.title}</b><span>Atual: ${fmtDayLong(occ.start)} · ${fmtRange(occ.start, occ.end)}</span></div>
      <div class="form-group">${dateTimeCells('r', occ.start)}${durationCell('duration', dur, 'r')}</div>
      ${occ.recurring ? html`<div class="group-foot">Vale <b>somente para esta ocorrência</b>. As outras continuam no horário de sempre.</div>` : ''}
    </form>`,
    onRight: async (c) => {
      const f = c.body.querySelector('form');
      const s = readStart(f, 'r');
      if (s == null) return false;
      const r = await onSubmit(s, s + Number(f.elements.duration.value) * MIN);
      return r === false ? false : true;
    },
  });
  bindFormWidgets(ctl.body);
  return ctl.result;
}
