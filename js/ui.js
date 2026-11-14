// Primitivas de interface: HTML seguro, folhas (sheets), menus de ação, alertas e avisos.
import { icon } from './icons.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));
const v2s = (v) => (v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(v2s).join('') : esc(v));

/** template seguro: tudo que é interpolado é escapado, exceto raw(...) e html`...` aninhados */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += v2s(vals[i]) + strings[i + 1];
  return new Raw(out);
}

export const ic = (name, cls, filled) => raw(icon(name, cls, filled));
export const $ = (root, ref) => root.querySelector(`[data-ref="${ref}"]`);
export function setHTML(el, h) { el.innerHTML = String(h); }

const layer = () => document.getElementById('overlays');
const stack = [];
export const overlayCount = () => stack.length;

function animateIn(wrap) {
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
}

function attachSwipeDismiss(handleEls, sheet, close) {
  let y0 = null;
  let dy = 0;
  let t0 = 0;
  const start = (e) => {
    if (e.target.closest('button,input,select,textarea,a')) return;
    y0 = e.touches[0].clientY; dy = 0; t0 = Date.now();
    sheet.style.transition = 'none';
  };
  const move = (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
    if (dy > 4) e.preventDefault();
  };
  const end = () => {
    if (y0 == null) return;
    sheet.style.transition = '';
    const v = dy / Math.max(1, Date.now() - t0);
    if (dy > 110 || (dy > 40 && v > 0.6)) close();
    else sheet.style.transform = '';
    y0 = null;
  };
  for (const el of handleEls) {
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }
}

/**
 * Folha modal que sobe de baixo (estilo iOS).
 * onRight(ctl): retorne false para manter aberta; qualquer outro valor fecha.
 */
export function openSheet({ title = '', body = '', left = 'Cancelar', right = null, onRight, onClose, className = '', backdropClose = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  setHTML(wrap, html`<div class="sheet-backdrop"></div>
    <section class="sheet ${className}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="sheet-grab"><span></span></div>
      <header class="sheet-head">
        <button type="button" class="sheet-btn" data-sheet="left">${left}</button>
        <h2 class="sheet-title">${title}</h2>
        ${right ? html`<button type="button" class="sheet-btn strong" data-sheet="right">${right}</button>` : html`<span></span>`}
      </header>
      <div class="sheet-body">${body}</div>
    </section>`);
  layer().appendChild(wrap);
  const sheet = wrap.querySelector('.sheet');
  let resolveResult;
  const ctl = {
    wrap, el: sheet, body: wrap.querySelector('.sheet-body'), closed: false,
    result: new Promise((r) => { resolveResult = r; }),
    close(result) {
      if (ctl.closed) return;
      ctl.closed = true;
      if (document.activeElement && wrap.contains(document.activeElement)) document.activeElement.blur();
      wrap.classList.remove('open');
      wrap.classList.add('closing');
      sheet.style.transform = '';
      const i = stack.indexOf(ctl);
      if (i >= 0) stack.splice(i, 1);
      setTimeout(() => wrap.remove(), 360);
      try { onClose?.(result); } finally { resolveResult(result); }
    },
    setTitle(t) { wrap.querySelector('.sheet-title').textContent = t; },
    setRight(label) { const b = wrap.querySelector('[data-sheet="right"]'); if (b) b.textContent = label; },
  };
  wrap.addEventListener('click', async (e) => {
    if (e.target.classList.contains('sheet-backdrop')) { if (backdropClose) ctl.close(); return; }
    const b = e.target.closest('[data-sheet]');
    if (!b) return;
    if (b.dataset.sheet === 'left') { ctl.close(); return; }
    if (b.disabled) return;
    if (!onRight) { ctl.close(true); return; }
    b.disabled = true;
    try {
      const r = await onRight(ctl);
      if (r !== false) ctl.close(r);
    } catch (err) {
      console.error(err);
      alertDialog({ title: 'Não foi possível salvar', message: err?.message || String(err) });
    } finally {
      b.disabled = false;
    }
  });
  attachSwipeDismiss([wrap.querySelector('.sheet-grab'), wrap.querySelector('.sheet-head')], sheet, () => ctl.close());
  stack.push(ctl);
  animateIn(wrap);
  return ctl;
}

/** Menu de ações (action sheet). Resolve com o `value` escolhido ou null. */
export function actionSheet({ title, message, messageHtml, actions, cancel = 'Cancelar' }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'as-wrap';
    const head = title || message || messageHtml;
    setHTML(wrap, html`<div class="sheet-backdrop"></div>
      <div class="as" role="dialog" aria-modal="true">
        <div class="as-group">
          ${head ? html`<div class="as-head">${title ? html`<div class="as-title">${title}</div>` : ''}${message ? html`<div class="as-msg">${message}</div>` : ''}${messageHtml ? html`<div class="as-msg">${raw(messageHtml)}</div>` : ''}</div>` : ''}
          ${actions.map((a, i) => html`<button type="button" class="as-btn ${a.style || ''}" data-i="${i}">${a.icon ? ic(a.icon) : ''}<span>${a.label}</span></button>`)}
        </div>
        <button type="button" class="as-btn as-cancel" data-i="-1">${cancel}</button>
      </div>`);
    layer().appendChild(wrap);
    const ctl = { close: () => done(null) };
    stack.push(ctl);
    let settled = false;
    function done(v) {
      if (settled) return;
      settled = true;
      wrap.classList.remove('open');
      wrap.classList.add('closing');
      const i = stack.indexOf(ctl);
      if (i >= 0) stack.splice(i, 1);
      setTimeout(() => wrap.remove(), 300);
      resolve(v);
    }
    wrap.addEventListener('click', (e) => {
      if (e.target.classList.contains('sheet-backdrop')) return done(null);
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const i = Number(b.dataset.i);
      done(i < 0 ? null : (actions[i].value ?? i));
    });
    animateIn(wrap);
  });
}

/** Alerta central estilo iOS. buttons: [{label, value, style:'cancel'|'destructive'|'strong'}] */
export function alertDialog({ title, message, buttons = [{ label: 'OK', value: true, style: 'strong' }] }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'alert-wrap';
    const stacked = buttons.length > 2;
    setHTML(wrap, html`<div class="sheet-backdrop"></div>
      <div class="alert" role="alertdialog" aria-modal="true">
        <div class="alert-text">${title ? html`<div class="alert-title">${title}</div>` : ''}${message ? html`<div class="alert-msg">${message}</div>` : ''}</div>
        <div class="alert-btns ${stacked ? 'stacked' : ''}">${buttons.map((b, i) => html`<button type="button" class="alert-btn ${b.style || ''}" data-i="${i}">${b.label}</button>`)}</div>
      </div>`);
    layer().appendChild(wrap);
    const ctl = { close: () => finish(null) };
    stack.push(ctl);
    function finish(v) {
      wrap.classList.remove('open');
      wrap.classList.add('closing');
      const i = stack.indexOf(ctl);
      if (i >= 0) stack.splice(i, 1);
      setTimeout(() => wrap.remove(), 250);
      resolve(v);
    }
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) finish(buttons[Number(b.dataset.i)].value);
    });
    animateIn(wrap);
  });
}

export function confirmDialog({ title, message, ok = 'Confirmar', cancel = 'Cancelar', destructive = false }) {
  return alertDialog({
    title, message,
    buttons: [{ label: cancel, value: false, style: 'cancel' }, { label: ok, value: true, style: destructive ? 'destructive' : 'strong' }],
  });
}

let toastTimer = null;
export function toast(message, { icon: iconName = null, ms = 2200 } = {}) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  setHTML(el, html`${iconName ? ic(iconName) : ''}<span>${message}</span>`);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** treme o elemento (validação) */
export function shake(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}
