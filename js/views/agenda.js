// Aba Agenda: junta eventos, visitas a locais e compromissos numa linha do tempo do dia
// (ou lista das próximas semanas). Toque para editar, segure e arraste para mudar o horário.
import { state, updateSettings } from '../store.js';
import { html, ic, setHTML, $, toast } from '../ui.js';
import { fab } from '../widgets.js';
import { occRow } from '../rows.js';
import { openOccurrenceSheet, openAddChooser, openSettings, doExport } from '../sheets.js';
import { moveWithConflicts } from '../conflicts.js';
import { expand, occByKey, layoutColumns, FREQ_LABEL } from '../schedule.js';
import { haptic, isIOS, isStandalone } from '../util.js';
import {
  MIN, startOfDay, addDays, startOfWeek, dateKey, parseDateKey, atMinutes, fmtDayLong, fmtRange, fmtHM,
  dayLabel, fmtDateShort, MONTHS, MONTHS_SHORT, WD_LETTER, WD_LONG, cap, roundUp, minutesOfDay, pad,
} from '../time.js';

const PX = 1; // pixels por minuto (60px por hora)
const SNAP = 15; // minutos

export function createAgendaView() {
  let root;
  let selected = startOfDay(Date.now());
  let mode = 'day';
  let scrollPending = true;
  let suppressClick = false;
  let press = null;
  let renderDeferred = false;

  const els = {};

  function mount(el) {
    root = el;
    root.classList.add('agenda');
    setHTML(root, html`
      <header class="ag-head" data-ref="head">
        <div class="ag-top">
          <label class="ag-month"><span data-ref="month"></span>${ic('chevDown', 'i sm accent')}<input type="date" data-ref="jump" aria-label="Ir para uma data"></label>
          <div class="ag-tools">
            <button type="button" class="pill" data-act="today">Hoje</button>
            <button type="button" class="icon-btn" data-act="settings" aria-label="Ajustes">${ic('sliders', 'i sm')}</button>
          </div>
        </div>
        <div class="ag-weekwrap">
          <button type="button" class="wk-nav" data-act="prev-week" aria-label="Semana anterior">${ic('chevL', 'i sm')}</button>
          <div class="ag-week" data-ref="week"></div>
          <button type="button" class="wk-nav" data-act="next-week" aria-label="Próxima semana">${ic('chevR', 'i sm')}</button>
        </div>
        <div class="ag-sub">
          <div class="ag-daytitle" data-ref="daytitle"></div>
          <div class="seg mini" data-ref="mode"><button type="button" data-mode="day" class="on">Dia</button><button type="button" data-mode="list">Lista</button></div>
        </div>
      </header>
      <div class="ag-hint" data-ref="hint"></div>
      <div class="ag-body" data-ref="body"></div>
      ${fab('Adicionar à agenda')}`);
    for (const k of ['head', 'month', 'jump', 'week', 'daytitle', 'mode', 'hint', 'body']) els[k] = $(root, k);

    root.addEventListener('click', onClick);
    els.jump.addEventListener('change', () => { if (els.jump.value) select(startOfDay(parseDateKey(els.jump.value))); });
    bindSwipe(els.week, (dir) => select(addDays(selected, 7 * dir)));
    bindSwipe(els.body, (dir) => { if (mode === 'day') select(addDays(selected, dir)); });
    bindDrag(els.body);
  }

  function select(day) {
    selected = startOfDay(day);
    scrollPending = true;
    update();
  }

  function goToDate(t) { mode = 'day'; select(t); }

  async function onClick(e) {
    const t = e.target;
    const day = t.closest('[data-day]');
    if (day) { select(Number(day.dataset.day)); return; }
    const modeBtn = t.closest('[data-mode]');
    if (modeBtn) { mode = modeBtn.dataset.mode; scrollPending = true; update(); return; }
    const block = t.closest('[data-key]');
    if (block) {
      if (suppressClick) return;
      openOccurrenceSheet(block.dataset.key);
      return;
    }
    const act = t.closest('[data-act]')?.dataset.act;
    switch (act) {
      case 'today': select(Date.now()); return;
      case 'prev-week': select(addDays(selected, -7)); return;
      case 'next-week': select(addDays(selected, 7)); return;
      case 'settings': openSettings(); return;
      case 'add': openAddChooser(defaultStartFor(selected)); return;
      case 'dismiss-hint': await updateSettings({ installHintDismissed: true }); return;
      case 'dismiss-restored': state.restoredFromMirror = false; renderHint(); return;
      case 'backup-now': await doExport(); return;
      case 'backup-later': await updateSettings({ backupSnoozeUntil: Date.now() + 7 * 24 * 3600e3 }); return;
      default: break;
    }
    // toque num horário vazio da linha do tempo -> adicionar naquele horário
    const tl = t.closest('.tl');
    if (tl && !t.closest('.tl-b') && !suppressClick) {
      const r = tl.getBoundingClientRect();
      const min = Math.floor((e.clientY - r.top) / PX / SNAP) * SNAP;
      if (min < 0 || min >= 1440) return;
      showGhost(tl, min);
      openAddChooser(atMinutes(dateKey(selected), min));
    }
  }

  function defaultStartFor(day) {
    const now = Date.now();
    if (startOfDay(now) === day) return roundUp(now + 15 * MIN, 30);
    return atMinutes(dateKey(day), 9 * 60);
  }

  function showGhost(tl, min) {
    const g = document.createElement('div');
    g.className = 'tl-ghost';
    g.style.top = `${min * PX}px`;
    g.style.height = `${60 * PX}px`;
    g.textContent = `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
    tl.appendChild(g);
    setTimeout(() => g.remove(), 900);
  }

  // ---------- renderização ----------

  function update() {
    if (!root) return;
    if (press?.active) { renderDeferred = true; return; }
    renderTop();
    renderHint();
    if (mode === 'day') renderDay(); else renderList();
    if (scrollPending) { scrollPending = false; requestAnimationFrame(scrollToRelevant); }
  }

  function renderTop() {
    const d = new Date(selected);
    els.month.textContent = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    els.jump.value = dateKey(selected);
    const ws = startOfWeek(selected, 0);
    const we = addDays(ws, 7);
    const occs = expand(state, ws, we).filter((o) => o.status !== 'missed');
    const today = startOfDay(Date.now());
    const days = [];
    for (let i = 0; i < 7; i++) {
      const ds = addDays(ws, i);
      const de = addDays(ds, 1);
      const dots = occs.filter((o) => o.start < de && o.end > ds).slice(0, 3);
      days.push(html`<button type="button" class="wd ${ds === selected ? 'sel' : ''} ${ds === today ? 'today' : ''}" data-day="${ds}" aria-label="${fmtDayLong(ds)}">
        <span class="wd-l">${WD_LETTER[new Date(ds).getDay()]}</span>
        <span class="wd-n">${new Date(ds).getDate()}</span>
        <span class="wd-dots">${dots.map((o) => html`<i class="k-${o.kind}"></i>`)}</span>
      </button>`);
    }
    setHTML(els.week, html`${days}`);
    els.mode.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  }

  function renderHint() {
    const parts = [];
    if (isIOS() && !isStandalone() && !state.settings.installHintDismissed) {
      parts.push(html`<div class="hint-card">
        <div class="hint-ic">${ic('share', 'i')}</div>
        <div class="hint-txt"><b>Instale no iPhone:</b> toque em <b>Compartilhar</b> ${ic('share', 'i xs')} e depois em <b>“Adicionar à Tela de Início”</b>. Use sempre pelo ícone — os dados do Safari e do app instalado ficam separados.</div>
        <button type="button" class="hint-x" data-act="dismiss-hint" aria-label="Fechar aviso">${ic('x', 'i sm')}</button>
      </div>`);
    }
    if (state.restoredFromMirror) {
      parts.push(html`<div class="hint-card ok"><div class="hint-ic">${ic('shield', 'i')}</div><div class="hint-txt">Seus dados foram recuperados da cópia de segurança local.</div><button type="button" class="hint-x" data-act="dismiss-restored" aria-label="Fechar aviso">${ic('x', 'i sm')}</button></div>`);
    }
    // lembrete de backup: só depois de já haver bastante coisa cadastrada
    const st = state.settings;
    const total = state.places.length + state.events.length + state.commitments.length + state.items.length;
    const now = Date.now();
    const stale = !st.lastBackupAt || now - st.lastBackupAt > 14 * 24 * 3600e3;
    if (!parts.length && total >= 8 && stale && now > (st.backupSnoozeUntil || 0)) {
      parts.push(html`<div class="hint-card">
        <div class="hint-ic">${ic('shield', 'i')}</div>
        <div class="hint-txt"><b>Hora de um backup.</b> ${st.lastBackupAt ? 'Faz mais de 2 semanas desde o último.' : 'Você ainda não fez nenhum.'} Seus dados ficam só neste iPhone — guarde uma cópia no app Arquivos / iCloud Drive.
          <div class="hint-actions"><button type="button" class="btn tinted sm" data-act="backup-now">Fazer backup</button><button type="button" class="btn plain sm" data-act="backup-later">Depois</button></div>
        </div>
      </div>`);
    }
    setHTML(els.hint, html`${parts}`);
  }

  function renderDay() {
    const now = Date.now();
    const ds = selected;
    const de = addDays(ds, 1);
    const occs = expand(state, ds, de, now);
    const items = layoutColumns(occs.map((o) => ({ o, s: Math.max(o.start, ds), e: Math.min(o.end, de) })));
    const conflicts = items.filter((i) => i.conflict).length;
    const active = occs.filter((o) => o.status !== 'missed').length;
    const dd = new Date(ds);
    const shortDay = `${cap(WD_LONG[dd.getDay()].split('-')[0])}, ${dd.getDate()} ${MONTHS_SHORT[dd.getMonth()]}`;
    const rel = dayLabel(ds, now);
    const title = rel === 'Hoje' || rel === 'Amanhã' || rel === 'Ontem' ? `${rel}, ${dd.getDate()} ${MONTHS_SHORT[dd.getMonth()]}` : shortDay;
    setHTML(els.daytitle, html`${title}${active ? html` <span class="muted">· ${active} ${active === 1 ? 'item' : 'itens'}</span>` : ''}${conflicts ? html` <span class="warn-text">· ${ic('alert', 'i xxs')} ${conflicts}</span>` : ''}`);

    const y = (t) => ((t - ds) / MIN) * PX;
    const total = ((de - ds) / MIN) * PX;
    const hours = [];
    for (let h = 0; h <= 24; h++) hours.push(html`<div class="tl-hour" style="top:${h * 60 * PX}px"><span>${h < 24 ? `${pad(h)}:00` : ''}</span></div>`);

    const sleep = [];
    const s = state.settings;
    if (s.sleepEnabled && s.sleepStart !== s.sleepEnd) {
      const ranges = s.sleepStart > s.sleepEnd ? [[0, s.sleepEnd], [s.sleepStart, 1440]] : [[s.sleepStart, s.sleepEnd]];
      for (const [a, b] of ranges) {
        if (b <= a) continue;
        sleep.push(html`<div class="tl-sleep" style="top:${a * PX}px;height:${(b - a) * PX}px"><span>${ic('moon', 'i xxs')} Sono</span></div>`);
      }
    }

    const blocks = items.map((it) => {
      const o = it.o;
      const top = y(it.s);
      const h = Math.max(24, y(it.e) - top - 2);
      const compact = h < 44;
      const left = `calc(var(--tl-l) + (100% - var(--tl-l) - 8px) * ${it.col / it.cols})`;
      const width = `calc((100% - var(--tl-l) - 8px) / ${it.cols} - 3px)`;
      const sub = o.kind === 'event' ? o.subtitle : o.kind === 'visit' ? 'Visita' : o.kind === 'item' ? o.subtitle : o.recurring ? (FREQ_LABEL[o.freq] || '') : '';
      return html`<div class="tl-b k-${o.kind} st-${o.status} ${it.conflict ? 'conflict' : ''} ${compact ? 'compact' : ''}" data-key="${o.key}" data-start="${o.start}" style="top:${top}px;height:${h}px;left:${left};width:${width}">
        <div class="tl-b-t">${it.conflict ? ic('alert', 'i xxs warn-ic') : ''}${o.status === 'done' ? ic('check', 'i xxs') : ''}${o.title}${compact ? html`<span class="tl-b-inline"> · ${fmtHM(o.start)}</span>` : ''}</div>
        ${compact ? '' : html`<div class="tl-b-s">${fmtRange(o.start, o.end)}${sub ? ` · ${sub}` : ''}</div>`}
        ${o.recurring ? html`<span class="tl-b-rep">${ic('repeat', 'i xxs')}</span>` : ''}
      </div>`;
    });

    const nowLine = now >= ds && now < de ? html`<div class="tl-now" style="top:${y(now)}px"><span>${fmtHM(now)}</span></div>` : '';

    setHTML(els.body, html`
      ${occs.length ? '' : html`<div class="day-empty">${ic('sparkle', 'i sm')} Dia livre. Toque num horário ou no <b>+</b> para adicionar.</div>`}
      <div class="tl" style="height:${total + 10}px">${hours}${sleep}${blocks}${nowLine}</div>`);
  }

  function renderList() {
    const now = Date.now();
    const from = selected;
    const to = addDays(selected, 21);
    const occs = expand(state, from, to, now);
    els.daytitle.textContent = startOfDay(now) === from ? 'Próximas 3 semanas' : `3 semanas desde ${fmtDateShort(from, now)}`;
    const groups = new Map();
    for (const o of occs) {
      const k = startOfDay(Math.max(o.start, from));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    }
    if (!groups.size) {
      setHTML(els.body, html`<div class="empty small"><div class="empty-ic">${ic('calendar', 'i xl')}</div><div class="empty-title">Nada agendado</div><div class="empty-text">Use o + para colocar eventos, visitas a locais ou compromissos na agenda.</div></div>`);
      return;
    }
    setHTML(els.body, html`<div class="list">${[...groups.entries()].map(([d, list]) => html`
      <div class="sec-h"><span>${dayLabel(d, now)}</span><small>${fmtDateShort(d, now)}</small></div>
      <div class="group">${list.map((o) => occRow(o))}</div>`)}</div>`);
  }

  function scrollToRelevant() {
    if (!root) return;
    if (mode !== 'day') { root.scrollTop = 0; return; }
    const tl = root.querySelector('.tl');
    if (!tl) return;
    const now = Date.now();
    let targetMin;
    if (startOfDay(now) === selected) targetMin = minutesOfDay(now) - 90;
    else {
      const first = expand(state, selected, addDays(selected, 1)).find((o) => o.start >= selected);
      targetMin = first ? minutesOfDay(first.start) - 30 : (state.settings.sleepEnabled ? state.settings.sleepEnd : 7 * 60) - 30;
    }
    targetMin = Math.max(0, Math.min(targetMin, 24 * 60));
    root.scrollTop = Math.max(0, tl.offsetTop + targetMin * PX - els.head.offsetHeight - 8);
  }

  // ---------- gestos ----------

  function bindSwipe(el, onSwipe) {
    let sw = null;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { sw = null; return; }
      sw = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (!sw || suppressClick || press?.active) { sw = null; return; }
      const t = e.changedTouches[0];
      const dx = t.clientX - sw.x;
      const dy = t.clientY - sw.y;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2 && Date.now() - sw.t < 700) onSwipe(dx < 0 ? 1 : -1);
      sw = null;
    });
  }

  function bindDrag(container) {
    const LONG = 380;
    const label = (p) => {
      const delta = Math.round(p.snapped / PX);
      const s = Number(p.el.dataset.start) + delta * MIN;
      let tag = p.el.querySelector('.drag-time');
      if (!tag) { tag = document.createElement('span'); tag.className = 'drag-time'; p.el.appendChild(tag); }
      tag.textContent = fmtHM(s);
    };
    const start = (el, x, y) => {
      press = { el, key: el.dataset.key, x0: x, y0: y, active: false, snapped: 0 };
      press.timer = setTimeout(() => {
        if (!press) return;
        press.active = true;
        press.el.classList.add('dragging');
        container.classList.add('drag-mode');
        haptic();
        label(press);
      }, LONG);
    };
    const move = (x, y, e) => {
      if (!press) return;
      if (!press.active) {
        if (Math.abs(x - press.x0) > 8 || Math.abs(y - press.y0) > 8) { clearTimeout(press.timer); press = null; }
        return;
      }
      if (e.cancelable) e.preventDefault();
      const snapPx = SNAP * PX;
      press.snapped = Math.round((y - press.y0) / snapPx) * snapPx;
      press.el.style.transform = `translateY(${press.snapped}px)`;
      label(press);
    };
    const reset = () => {
      container.classList.remove('drag-mode');
      if (renderDeferred) { renderDeferred = false; update(); }
    };
    const end = async (e) => {
      if (!press) return;
      clearTimeout(press.timer);
      const p = press;
      press = null;
      if (!p.active) return;
      if (e?.cancelable) e.preventDefault();
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 450);
      const delta = Math.round(p.snapped / PX);
      if (!delta) {
        p.el.classList.remove('dragging');
        p.el.style.transform = '';
        p.el.querySelector('.drag-time')?.remove();
        reset();
        return;
      }
      container.classList.remove('drag-mode');
      const occ = occByKey(state, p.key);
      if (!occ) { reset(); update(); return; }
      const res = await moveWithConflicts(occ, occ.start + delta * MIN, occ.end + delta * MIN);
      renderDeferred = false;
      update();
      if (res && !res.policy) toast(`${occ.title}: ${fmtRange(res.start, res.end)}${occ.recurring ? ' (só nesta semana)' : ''}`, { icon: 'clock' });
    };
    container.addEventListener('touchstart', (e) => {
      const el = e.target.closest('.tl-b');
      if (!el || e.touches.length > 1) return;
      start(el, e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    container.addEventListener('touchmove', (e) => {
      if (!press) return;
      move(e.touches[0].clientX, e.touches[0].clientY, e);
    }, { passive: false });
    container.addEventListener('touchend', end);
    container.addEventListener('touchcancel', () => {
      if (!press) return;
      clearTimeout(press.timer);
      const p = press; press = null;
      p.el.classList.remove('dragging');
      p.el.style.transform = '';
      reset();
    });
    container.addEventListener('contextmenu', (e) => { if (e.target.closest('.tl-b')) e.preventDefault(); });
    // mouse (para testar no computador)
    container.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || ('ontouchstart' in window && navigator.maxTouchPoints > 0)) return;
      const el = e.target.closest('.tl-b');
      if (!el) return;
      start(el, e.clientX, e.clientY);
      const mm = (ev) => move(ev.clientX, ev.clientY, ev);
      const mu = (ev) => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); end(ev); };
      window.addEventListener('mousemove', mm);
      window.addEventListener('mouseup', mu);
    });
  }

  return {
    id: 'agenda',
    mount,
    update,
    goToDate,
  };
}
