// Componentes reutilizáveis (cabeçalhos, busca, filtros, campos de formulário).
import { html, ic, raw } from './ui.js';
import { catLabel, hueOf, initials } from './util.js';
import { fmtDur, fmtHM, parseHM, atMinutes, MIN } from './time.js';

export function viewHeader(title, { right = '' } = {}) {
  return html`<div class="vh-row"><h1>${title}</h1><div class="vh-right">${right}</div></div>`;
}

export function searchBar(placeholder) {
  return html`<label class="search">${ic('search', 'i sm')}<input type="search" name="q" placeholder="${placeholder}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search"><button type="button" class="clear" data-act="clear-q" aria-label="Limpar busca">${ic('xCircle', 'i sm')}</button></label>`;
}

/** options: [[valor, rótulo, contagem?]] */
export function chipBar(options, active) {
  return html`<div class="chips" role="tablist">${options.map(([v, label, n]) => html`<button type="button" class="chip ${v === active ? 'on' : ''}" data-chip="${v}" role="tab">${label}${n != null ? html`<small>${n}</small>` : ''}</button>`)}</div>`;
}

export function setActiveChip(root, v) {
  root.querySelectorAll('[data-chip]').forEach((b) => b.classList.toggle('on', b.dataset.chip === v));
}

export function fab(label) {
  return html`<button type="button" class="fab" data-act="add" aria-label="${label}">${ic('plus', 'i lg')}</button>`;
}

export function emptyState({ icon, title, text, actionLabel }) {
  return html`<div class="empty">
    <div class="empty-ic">${ic(icon, 'i xl')}</div>
    <div class="empty-title">${title}</div>
    ${text ? html`<div class="empty-text">${text}</div>` : ''}
    ${actionLabel ? html`<button type="button" class="btn primary" data-act="add">${ic('plus', 'i sm')} ${actionLabel}</button>` : ''}
  </div>`;
}

export function catBadge(cat) {
  return cat ? html`<span class="badge cat-${cat}">${catLabel(cat)}</span>` : '';
}

export function placeThumb(p, cls = 'thumb') {
  if (p?.thumb) return html`<img class="${cls}" src="${p.thumb}" alt="" loading="lazy" decoding="async">`;
  return html`<div class="${cls} ph" style="--h:${hueOf(p?.name)}">${initials(p?.name)}</div>`;
}

export function starBtn(kind, item) {
  return html`<button type="button" class="tgl star ${item.favorite ? 'on' : ''}" data-act="fav" data-kind="${kind}" data-id="${item.id}" aria-label="${item.favorite ? 'Remover dos favoritos' : 'Favoritar'}" aria-pressed="${item.favorite ? 'true' : 'false'}">${ic('star', 'i', item.favorite)}</button>`;
}

// ---------- campos de formulário ----------

export function segHTML(name, options, value) {
  return html`<div class="seg" data-seg="${name}"><input type="hidden" name="${name}" value="${value ?? ''}">${options.map(([v, label]) => html`<button type="button" data-v="${v}" class="${String(v) === String(value ?? '') ? 'on' : ''}">${label}</button>`)}</div>`;
}

export function switchCell(name, label, checked, iconName) {
  return html`<label class="cell">${iconName ? html`<span class="cell-ic">${ic(iconName, 'i sm')}</span>` : ''}<span class="lbl grow">${label}</span><span class="sw"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><i></i></span></label>`;
}

export function textCell(name, label, value, { placeholder = '', required = false, multiline = false } = {}) {
  return multiline
    ? html`<label class="cell top"><span class="lbl">${label}</span><textarea name="${name}" rows="2" placeholder="${placeholder}">${value || ''}</textarea></label>`
    : html`<label class="cell"><span class="lbl">${label}</span><input type="text" name="${name}" value="${value || ''}" placeholder="${placeholder}" ${required ? 'required' : ''} autocomplete="off"></label>`;
}

export function dateTimeCells(prefix, start) {
  const d = new Date(start);
  const pad = (n) => String(n).padStart(2, '0');
  const dv = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return html`<label class="cell"><span class="cell-ic">${ic('calendar', 'i sm')}</span><span class="lbl grow">Data</span><input type="date" name="${prefix}Date" value="${dv}" required></label>
    <label class="cell"><span class="cell-ic">${ic('clock', 'i sm')}</span><span class="lbl grow">Início</span><input type="time" name="${prefix}Time" value="${fmtHM(start)}" step="300" required></label>`;
}

const DUR_CHIPS = [30, 60, 90, 120, 180, 240, 300, 420];

export function durationCell(name, minutes, prefix) {
  return html`<div class="cell dur" data-dur="${name}" data-prefix="${prefix}">
      <span class="cell-ic">${ic('history', 'i sm')}</span><span class="lbl grow">Duração</span>
      <input type="hidden" name="${name}" value="${minutes}">
      <div class="stepper"><button type="button" data-step="-15" aria-label="Menos 15 minutos">−</button><output>${fmtDur(minutes)}</output><button type="button" data-step="15" aria-label="Mais 15 minutos">+</button></div>
    </div>
    <div class="cell chips-cell"><div class="chips inset">${DUR_CHIPS.map((m) => html`<button type="button" class="chip sm ${m === minutes ? 'on' : ''}" data-durset="${name}" data-v="${m}">${fmtDur(m)}</button>`)}</div></div>
    <div class="cell muted-cell" data-durend="${name}"></div>`;
}

export function readStart(form, prefix) {
  const ds = form.elements[`${prefix}Date`]?.value;
  const ts = form.elements[`${prefix}Time`]?.value;
  if (!ds || !ts) return null;
  return atMinutes(ds, parseHM(ts));
}

export function placePickerCell(place) {
  return html`<button type="button" class="cell picker" data-act="pick-place">
      <input type="hidden" name="placeId" value="${place?.id || ''}">
      ${place ? placeThumb(place, 'thumb sm') : html`<span class="thumb sm ph empty-ph">${ic('pin', 'i sm')}</span>`}
      <span class="grow picker-label ${place ? '' : 'placeholder'}">${place ? place.name : 'Escolher local cadastrado'}</span>
      ${ic('chevR', 'i sm muted')}
    </button>`;
}

/** liga os comportamentos dos campos (segmented, duração, seções condicionais) */
export function bindFormWidgets(root) {
  const form = root.querySelector('form') || root;
  const updateDurEnd = () => {
    root.querySelectorAll('[data-durend]').forEach((el) => {
      const name = el.dataset.durend;
      const dur = Number(form.elements[name]?.value || 0);
      const prefix = root.querySelector(`[data-dur="${name}"]`)?.dataset.prefix;
      const start = prefix ? readStart(form, prefix) : null;
      if (start == null) { el.textContent = ''; return; }
      const end = start + dur * MIN;
      const nextDay = new Date(end - 1).getDate() !== new Date(start).getDate();
      el.innerHTML = String(html`Termina às <b>${fmtHM(end)}</b>${nextDay ? ' (dia seguinte)' : ''}`);
    });
  };
  const setDur = (name, v) => {
    const input = form.elements[name];
    const val = Math.min(24 * 60, Math.max(15, v));
    input.value = val;
    const box = root.querySelector(`[data-dur="${name}"]`);
    box.querySelector('output').textContent = fmtDur(val);
    root.querySelectorAll(`[data-durset="${name}"]`).forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === val));
    updateDurEnd();
  };
  const syncShow = () => {
    root.querySelectorAll('[data-show-when]').forEach((el) => {
      const [name, val] = el.dataset.showWhen.split('=');
      const input = form.elements[name];
      let on;
      if (!input) on = false;
      else if (input.type === 'checkbox') on = input.checked;
      else on = String(val).split('|').includes(String(input.value));
      el.hidden = !on;
    });
  };
  root.addEventListener('click', (e) => {
    const segBtn = e.target.closest('.seg[data-seg] button');
    if (segBtn) {
      const seg = segBtn.closest('.seg');
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === segBtn));
      seg.querySelector('input').value = segBtn.dataset.v;
      syncShow();
      seg.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const step = e.target.closest('[data-step]');
    if (step) {
      const box = step.closest('[data-dur]');
      const name = box.dataset.dur;
      setDur(name, Number(form.elements[name].value) + Number(step.dataset.step));
      return;
    }
    const ds = e.target.closest('[data-durset]');
    if (ds) setDur(ds.dataset.durset, Number(ds.dataset.v));
  });
  root.addEventListener('change', () => { syncShow(); updateDurEnd(); });
  root.addEventListener('input', updateDurEnd);
  // rola o campo focado para a área visível quando o teclado do iPhone abre
  root.addEventListener('focusin', (e) => {
    if (e.target.matches('input,textarea')) setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 320);
  });
  syncShow();
  updateDurEnd();
  return { syncShow, updateDurEnd };
}

export { raw };
