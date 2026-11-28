// Aba Agenda: junta eventos, visitas a locais e compromissos numa linha do tempo do dia
// (ou lista das próximas semanas). Gestos nos blocos:
//  - toque: abre a ficha · toque triplo: cria um Plano B (outra opção para o mesmo horário)
//  - segurar e arrastar: move · borda de baixo (ou bolinhas do bloco selecionado): muda início/fim
//  - deslizar para a esquerda: tira da agenda (e, se já tinha acontecido, pergunta o que você fez)
// Cores pela classificação (aventura, cultura, bares...); botões ↶ ↷ desfazem/refazem.
import { state, updateSettings, undo, redo, canUndo, canRedo, onUndoChange, newUndoStep } from '../store.js';
import { html, ic, setHTML, $, toast } from '../ui.js';
import { fab } from '../widgets.js';
import { occRow } from '../rows.js';
import { openOccurrenceSheet, openAddChooser, openSettings, doExport } from '../sheets.js';
import { moveWithConflicts } from '../conflicts.js';
import { expand, occByKey, layoutColumns, colorOf, FREQ_LABEL } from '../schedule.js';
import { offerPlanB, swipeRemove, findGap, openGapSheet, getGapHint, setGapHint, onGapHint, offerGapAfter } from '../reorg.js';
import { haptic, isIOS, isStandalone } from '../util.js';
import {
  MIN, startOfDay, addDays, startOfWeek, dateKey, parseDateKey, atMinutes, fmtDayLong, fmtRange, fmtHM, fmtDur,
  dayLabel, fmtDateShort, MONTHS, MONTHS_SHORT, WD_LETTER, WD_LONG, cap, roundUp, minutesOfDay, pad,
} from '../time.js';

const PX = 1; // pixels por minuto (60px por hora)
// a linha do tempo de um dia também mostra o fim da noite anterior (desde 22:00) e a madrugada seguinte (até 06:00):
// assim dá para arrastar algo que atravessa a meia-noite (dormir 23h–8h30, bar 23h–2h) sem trocar de dia
const EXT_B = 2 * 60; // minutos antes de 00:00
const EXT_A = 6 * 60; // minutos depois de 24:00
const SNAP = 15; // minutos
const TAP_WAIT = 300; // ms para distinguir toque simples de toque triplo

export function createAgendaView() {
  let root;
  let selected = startOfDay(Date.now());
  let mode = 'day';
  let scrollPending = true;
  let suppressClick = false;
  let press = null;
  let renderDeferred = false;
  let selKey = null; // bloco selecionado (com as bolinhas de início/fim)
  let tap = null; // contagem de toques no mesmo bloco (toque triplo = Plano B)

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
      <div class="ag-undo" data-ref="undo">
        <button type="button" data-act="undo" aria-label="Desfazer">${ic('undo', 'i')}</button>
        <button type="button" data-act="redo" aria-label="Refazer">${ic('redo', 'i')}</button>
      </div>
      ${fab('Adicionar à agenda')}`);
    for (const k of ['head', 'month', 'jump', 'week', 'daytitle', 'mode', 'hint', 'body', 'undo']) els[k] = $(root, k);

    root.addEventListener('click', onClick);
    els.jump.addEventListener('change', () => { if (els.jump.value) select(startOfDay(parseDateKey(els.jump.value))); });
    bindSwipe(els.week, (dir) => select(addDays(selected, 7 * dir)));
    // trocar de dia deslizando só fora dos blocos (deslizar um bloco para a esquerda tira ele da agenda)
    bindSwipe(els.body, (dir) => { if (mode === 'day') select(addDays(selected, dir)); }, (t) => !t.closest('.tl-b'));
    bindDrag(els.body);
    onUndoChange(syncUndo);
    syncUndo();
    onGapHint(() => { if (mode === 'day') renderDay(); });
  }

  function syncUndo() {
    const [u, r] = els.undo.querySelectorAll('button');
    u.disabled = !canUndo();
    r.disabled = !canRedo();
  }

  function select(day) {
    if (startOfDay(day) !== selected) setGapHint(null);
    selected = startOfDay(day);
    selKey = null;
    scrollPending = true;
    update();
  }

  function goToDate(t) { mode = 'day'; select(t); }

  async function onClick(e) {
    const t = e.target;
    const day = t.closest('[data-day]');
    if (day) { select(Number(day.dataset.day)); return; }
    const modeBtn = t.closest('[data-mode]');
    if (modeBtn) { mode = modeBtn.dataset.mode; selKey = null; scrollPending = true; update(); return; }
    const block = t.closest('[data-key]');
    if (block) {
      if (suppressClick || t.closest('[data-handle]')) return;
      onBlockTap(block.dataset.key);
      return;
    }
    const act = t.closest('[data-act]')?.dataset.act;
    switch (act) {
      case 'undo': setGapHint(null); haptic(); await undo(); return;
      case 'redo': setGapHint(null); haptic(); await redo(); return;
      case 'gap': {
        const h = getGapHint();
        const g = h && findGap(h.from, { excludeKey: h.excludeKey });
        setGapHint(null);
        if (g) await openGapSheet(g);
        return;
      }
      case 'gap-close': setGapHint(null); return;
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
      if (deselect()) return; // tocar fora só tira a seleção
      const r = tl.getBoundingClientRect();
      const min = Math.floor((e.clientY - r.top) / PX / SNAP) * SNAP;
      if (min < -EXT_B || min >= 1440 + EXT_A) return; // vale também a noite anterior e a madrugada seguinte
      showGhost(tl, min);
      const at = atMinutes(dateKey(selected), min);
      openAddChooser(at, { gap: gapAt(at) });
    }
  }

  /** toque simples abre a ficha; toque triplo (no mesmo bloco) oferece um Plano B */
  function onBlockTap(key) {
    const now = Date.now();
    if (tap && tap.key === key && now - tap.t < TAP_WAIT + 150) {
      tap.n++;
      tap.t = now;
      clearTimeout(tap.timer);
    } else {
      if (tap) clearTimeout(tap.timer);
      tap = { key, n: 1, t: now };
    }
    if (tap.n >= 3) {
      tap = null;
      deselect();
      haptic();
      const occ = occByKey(state, key);
      if (occ) offerPlanB(occ);
      return;
    }
    tap.timer = setTimeout(() => {
      const k = tap?.key;
      tap = null;
      if (!k) return;
      deselect();
      openOccurrenceSheet(k);
    }, TAP_WAIT);
  }

  /**
   * Horário vazio tocado: se houver um item mais tarde no mesmo dia, devolve o espaço livre
   * (do fim do item anterior — ou de agora — até ele) para oferecer "adiantar".
   */
  function gapAt(t) {
    const de = addDays(selected, 1);
    const occs = expand(state, selected, de);
    const live = occs.filter((o) => o.status !== 'done' && o.status !== 'missed' && o.status !== 'choose');
    if (live.some((o) => o.start <= t && o.end > t)) return null;
    const next = live.filter((o) => o.start >= t && o.start < de).sort((a, b) => a.start - b.start)[0];
    if (!next) return null;
    const ends = occs.filter((o) => o.end <= t && o.status !== 'missed').map((o) => o.end);
    let from = ends.length ? Math.max(...ends) : t;
    from = Math.max(from, roundUp(Date.now(), 5));
    const gap = next.start - from;
    if (gap < 5 * MIN || gap > 4 * 60 * MIN) return null;
    return { next, from, gap, occs };
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
        <span class="wd-dots">${dots.map((o) => html`<i class="c-${colorOf(o)}"></i>`)}</span>
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
    const vs = ds - EXT_B * MIN; // começo do que aparece (18:00 do dia anterior)
    const ve = de + EXT_A * MIN; // fim do que aparece (06:00 do dia seguinte)
    const shown = expand(state, vs, ve, now);
    const occs = shown.filter((o) => o.start < de && o.end > ds); // as do dia escolhido (contagens, "dia livre")
    const items = layoutColumns(shown.map((o) => ({ o, s: Math.max(o.start, vs), e: Math.min(o.end, ve) })));
    const conflicts = items.filter((i) => i.conflict && i.o.start < de && i.o.end > ds).length;
    const active = occs.filter((o) => o.status !== 'missed').length;
    const toChoose = new Set(occs.filter((o) => o.status === 'choose').map((o) => o.opt?.g)).size;
    const dd = new Date(ds);
    const shortDay = `${cap(WD_LONG[dd.getDay()].split('-')[0])}, ${dd.getDate()} ${MONTHS_SHORT[dd.getMonth()]}`;
    const rel = dayLabel(ds, now);
    const title = rel === 'Hoje' || rel === 'Amanhã' || rel === 'Ontem' ? `${rel}, ${dd.getDate()} ${MONTHS_SHORT[dd.getMonth()]}` : shortDay;
    setHTML(els.daytitle, html`${title}${active && !toChoose ? html` <span class="muted">· ${active} ${active === 1 ? 'item' : 'itens'}</span>` : ''}${conflicts ? html` <span class="warn-text">· ${ic('alert', 'i xxs')} ${conflicts}</span>` : ''}${toChoose ? html` <span class="choose-text">· escolha ${toChoose === 1 ? 'a opção' : `${toChoose} opções`}</span>` : ''}`);

    const y = (t) => ((t - ds) / MIN) * PX;
    const total = ((de - ds) / MIN) * PX;
    const hours = [];
    for (let h = -EXT_B / 60; h <= 24 + EXT_A / 60; h++) {
      const ext = h < 0 || h > 24;
      hours.push(html`<div class="tl-hour ${ext ? 'ext' : ''} ${h === 0 || h === 24 ? 'midnight' : ''}" style="top:${h * 60 * PX}px"><span>${h === 24 + EXT_A / 60 ? '' : `${pad((h + 24) % 24)}:00`}</span></div>`);
    }
    const dayName = (t) => { const d = new Date(t); return `${WD_LONG[d.getDay()].split('-')[0]}, ${d.getDate()}`; };
    const zones = html`<div class="tl-ext" style="top:${-EXT_B * PX}px;height:${EXT_B * PX}px"><span>${dayName(addDays(ds, -1))} · noite</span></div>
      <div class="tl-ext" style="top:${total}px;height:${EXT_A * PX}px"><span>${dayName(de)} · madrugada</span></div>`;

    const blocks = items.map((it) => {
      const o = it.o;
      const outside = o.end <= ds || o.start >= de; // só na noite anterior / madrugada seguinte
      const top = y(it.s);
      const h = Math.max(24, y(it.e) - top - 2);
      const compact = h < 44;
      const left = `calc(var(--tl-l) + (100% - var(--tl-l) - 8px) * ${it.col / it.cols})`;
      const width = `calc((100% - var(--tl-l) - 8px) / ${it.cols} - 3px)`;
      const sub = o.status === 'choose' ? 'Qual você fez? Deslize ← a que não fez'
        : o.kind === 'event' ? o.subtitle : o.kind === 'visit' ? 'Visita' : o.kind === 'item' ? o.subtitle : o.recurring ? (FREQ_LABEL[o.freq] || '') : '';
      const isOpt = o.opt && o.opt.of > 1;
      return html`<div class="tl-b c-${colorOf(o)} k-${o.kind} st-${o.status} ${it.conflict ? 'conflict' : ''} ${compact ? 'compact' : ''} ${isOpt ? 'is-opt' : ''} ${outside ? 'ext-b' : ''}" data-key="${o.key}" data-start="${o.start}" data-end="${o.end}" data-cs="${o.start < vs ? 1 : 0}" data-ce="${o.end > ve ? 1 : 0}" style="top:${top}px;height:${h}px;left:${left};width:${width}">
        <div class="tl-b-t">${isOpt ? html`<span class="opt-tag">${o.opt.letter}</span>` : ''}${it.conflict ? ic('alert', 'i xxs warn-ic') : ''}${o.status === 'done' ? ic('check', 'i xxs') : ''}${o.remind != null && (o.status === 'planned' || o.status === 'ongoing') ? ic('bell', 'i xxs bell-ic') : ''}${o.title}${compact ? html`<span class="tl-b-inline"> · ${fmtHM(o.start)}</span>` : ''}</div>
        ${compact ? '' : html`<div class="tl-b-s">${fmtRange(o.start, o.end)}${sub ? ` · ${sub}` : ''}</div>`}
        ${o.recurring ? html`<span class="tl-b-rep">${ic('repeat', 'i xxs')}</span>` : ''}
        ${compact || o.end > ve ? '' : html`<span class="tl-grip"></span>`}
      </div>`;
    });

    const nowLine = now >= vs && now < ve ? html`<div class="tl-now" style="top:${y(now)}px"><span>${fmtHM(now)}</span></div>` : '';

    // depois de encurtar algo: botão "Adiantar" dentro do espaço que ficou livre (some ao usar, fechar ou trocar de dia)
    let gapBtn = '';
    const gh = getGapHint();
    if (gh && gh.from >= ds && gh.from < de) {
      const g = findGap(gh.from, { excludeKey: gh.excludeKey });
      if (g && g.from === gh.from) {
        // logo abaixo do que foi encurtado (blocos curtos têm altura mínima de 24px), alinhado à direita
        const prev = g.occs.find((o) => o.key === gh.excludeKey);
        const prevBottom = prev ? y(Math.max(prev.start, ds)) + Math.max(24, y(prev.end) - y(Math.max(prev.start, ds)) - 2) : y(g.from);
        const room = y(g.next.start) - prevBottom;
        const top = prevBottom + Math.max(3, (room - 32) / 2);
        gapBtn = html`<div class="tl-gap" style="top:${top}px"><button type="button" class="tl-gap-go" data-act="gap">${ic('arrowUp', 'i xs')} Adiantar <small>· ${fmtDur(g.gap / MIN)} livres</small></button><button type="button" class="tl-gap-x" data-act="gap-close" aria-label="Deixar o espaço">${ic('x', 'i xs')}</button></div>`;
      }
    }

    setHTML(els.body, html`
      ${occs.length ? '' : html`<div class="day-empty">${ic('sparkle', 'i sm')} Dia livre. Toque num horário ou no <b>+</b> para adicionar.</div>`}
      <div class="tl" style="margin-top:${EXT_B * PX + 14}px;height:${total + EXT_A * PX + 10}px">${zones}${hours}${blocks}${nowLine}${gapBtn}</div>`);
    syncSelection();
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
      targetMin = first ? minutesOfDay(first.start) - 30 : 7 * 60 - 30;
    }
    targetMin = Math.max(0, Math.min(targetMin, 24 * 60));
    root.scrollTop = Math.max(0, tl.offsetTop + targetMin * PX - els.head.offsetHeight - 8);
  }

  // ---------- gestos ----------

  function bindSwipe(el, onSwipe, allow = () => true) {
    let sw = null;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || !allow(e.target)) { sw = null; return; }
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

  // Arrastar na linha do tempo:
  //  - segurar o meio do bloco  -> seleciona e move (início e fim juntos)
  //  - segurar a borda de baixo -> muda só o fim (a duração)
  //  - bloco selecionado        -> bolinhas de início/fim e o corpo respondem na hora, sem segurar
  //  - deslizar para a esquerda   -> tira da agenda (passando do ponto, solta; antes disso, volta)
  // Tudo de 15 em 15 min; ao soltar, se bater com outro horário, o app pergunta o que fazer (padrão).
  function bindDrag(container) {
    const LONG = 350;
    const EDGE = 16; // px da borda de baixo que redimensiona direto
    const tlTop = () => container.querySelector('.tl').getBoundingClientRect().top;
    const snapAbs = (t) => selected + Math.round((t - selected) / MIN / SNAP) * SNAP * MIN;
    let raf = 0;

    // ----- deslizar para a esquerda (tirar da agenda) -----
    const startSwipe = () => {
      const p = press;
      clearTimeout(p.timer);
      p.kind = 'swipe';
      p.active = true;
      const bg = document.createElement('div');
      bg.className = 'tl-swipe-bg';
      bg.style.cssText = `top:${p.el.style.top};height:${p.el.style.height};left:${p.el.style.left};width:${p.el.style.width}`;
      bg.innerHTML = String(html`<span>${ic('trash', 'i sm')} ${p.el.classList.contains('is-opt') ? 'Tirar esta opção' : p.el.classList.contains('st-done') ? 'Não fiz' : 'Tirar da agenda'}</span>`);
      p.el.parentNode.insertBefore(bg, p.el);
      p.bg = bg;
      p.el.classList.add('swiping');
      container.classList.add('drag-mode');
    };
    const paintSwipe = () => {
      const p = press;
      const w = p.el.getBoundingClientRect().width;
      const dx = Math.min(0, p.lastX - p.x0);
      p.armed = -dx > Math.max(80, w * 0.38);
      p.el.style.transform = `translateX(${dx}px)`;
      if (p.armed !== p.wasArmed) { p.bg.classList.toggle('armed', p.armed); if (p.armed) haptic(); p.wasArmed = p.armed; }
    };

    const paint = () => {
      const p = press;
      if (!p) return;
      if (p.kind === 'swipe') { paintSwipe(); return; }
      const raw = (p.lastY - tlTop() - p.yTl0) / PX; // minutos desde o início do gesto (acompanha a rolagem)
      const ds = selected;
      const vs = ds - EXT_B * MIN; // dá para levar até a noite anterior / madrugada seguinte
      const ve = addDays(selected, 1) + EXT_A * MIN;
      const step = SNAP * MIN;
      let ns = p.s0;
      let ne = p.e0;
      if (Math.abs(raw) >= SNAP / 2) {
        if (p.kind === 'move') {
          ns = Math.min(Math.max(snapAbs(p.s0 + raw * MIN), vs), ve - step);
          ne = ns + (p.e0 - p.s0);
        } else if (p.kind === 'end') {
          ne = Math.min(Math.max(snapAbs(p.e0 + raw * MIN), p.s0 + step), ve);
        } else {
          ns = Math.max(Math.min(snapAbs(p.s0 + raw * MIN), p.e0 - step), vs);
        }
      }
      p.ns = ns;
      p.ne = ne;
      if (p.kind === 'move') {
        p.el.style.transform = `translateY(${((ns - p.s0) / MIN) * PX}px)`;
      } else {
        const top = ((Math.max(ns, vs) - ds) / MIN) * PX;
        const h = Math.max(14, ((Math.min(ne, ve) - ds) / MIN) * PX - top - 2);
        p.el.style.top = `${top}px`;
        p.el.style.height = `${h}px`;
        p.el.classList.toggle('tiny', h < 40);
      }
      const sub = p.el.querySelector('.tl-b-s');
      if (sub) { // a linha do horário dentro do bloco acompanha ao vivo
        if (p.sub0 == null) p.sub0 = sub.textContent;
        sub.textContent = p.sub0.replace(/^\d\d:\d\d–\d\d:\d\d(?: \(\+\d+\))?/, fmtRange(ns, ne));
      }
      let tag = p.el.querySelector('.drag-time');
      if (!tag) { tag = document.createElement('span'); tag.className = 'drag-time'; p.el.appendChild(tag); }
      tag.textContent = p.kind === 'move' ? `${fmtHM(ns)}–${fmtHM(ne)}` : p.kind === 'end' ? `até ${fmtHM(ne)}` : `das ${fmtHM(ns)}`;
    };

    // perto do topo/rodapé da tela, a agenda rola sozinha enquanto você arrasta
    const autoScroll = () => {
      raf = 0;
      if (!press?.active) return;
      const topEdge = els.head.getBoundingClientRect().bottom + 36;
      const bar = document.querySelector('.tabbar');
      const bottomEdge = (bar ? bar.getBoundingClientRect().top : root.getBoundingClientRect().bottom) - 56;
      const travel = press.lastY - press.y0; // só rola se o dedo foi mesmo em direção à beira (segurar parado não rola)
      let dy = 0;
      // quanto mais perto da beira, mais rápido (de ~1,5 a 7 px por quadro)
      if (press.lastY < topEdge && travel < -20) dy = -Math.min(7, (topEdge - press.lastY) / 10 + 1.5);
      else if (press.lastY > bottomEdge && travel > 20) dy = Math.min(7, (press.lastY - bottomEdge) / 10 + 1.5);
      if (dy) {
        const before = root.scrollTop;
        root.scrollTop = before + dy;
        if (root.scrollTop !== before) paint();
      }
      raf = requestAnimationFrame(autoScroll);
    };

    const activate = () => {
      if (!press || press.active) return;
      press.active = true;
      if (selKey !== press.key) { selKey = press.key; syncSelection(); }
      press.el.classList.add('dragging', `drag-${press.kind}`);
      container.classList.add('drag-mode');
      haptic();
      paint();
      if (!raf) raf = requestAnimationFrame(autoScroll);
    };

    const begin = (el, x, y, target) => {
      newUndoStep(); // cada gesto vira um passo próprio no ↶
      const handle = target.closest?.('[data-handle]');
      const isSel = el.classList.contains('sel');
      const r = el.getBoundingClientRect();
      let kind = 'move';
      if (handle) kind = handle.dataset.handle;
      else if (r.height >= 40 && y > r.bottom - EDGE && el.dataset.ce !== '1') kind = 'end'; // borda de baixo: duração
      else if (isSel && r.height >= 40 && y < r.top + 10 && el.dataset.cs !== '1') kind = 'start'; // selecionado: borda de cima
      press = {
        el, key: el.dataset.key, kind, x0: x, y0: y, lastX: x, lastY: y, yTl0: y - tlTop(),
        s0: Number(el.dataset.start), e0: Number(el.dataset.end),
        top0: el.style.top, h0: el.style.height,
        active: false, immediate: isSel,
      };
      press.ns = press.s0;
      press.ne = press.e0;
      if (!isSel) press.timer = setTimeout(activate, LONG);
    };

    const move = (x, y, e) => {
      if (!press) return;
      press.lastX = x;
      press.lastY = y;
      if (!press.active) {
        const dx = Math.abs(x - press.x0);
        const dy = Math.abs(y - press.y0);
        const leftSwipe = x - press.x0 < -10 && dx > dy * 1.4 && !e.target?.closest?.('[data-handle]');
        if (press.immediate) {
          if (e.cancelable) e.preventDefault();
          if (leftSwipe) startSwipe();
          else if (dx > 4 || dy > 4) activate(); else return;
        } else if (leftSwipe) {
          startSwipe();
        } else {
          if (dx > 8 || dy > 8) { clearTimeout(press.timer); press = null; } // era rolagem
          return;
        }
      }
      if (e.cancelable) e.preventDefault();
      paint();
    };

    const restore = (p) => {
      if (p.bg) { p.bg.remove(); p.el.classList.remove('swiping'); }
      p.el.classList.remove('dragging', 'drag-move', 'drag-end', 'drag-start', 'tiny');
      p.el.style.transform = '';
      p.el.style.top = p.top0;
      p.el.style.height = p.h0;
      p.el.querySelector('.drag-time')?.remove();
      if (p.sub0 != null) { const sub = p.el.querySelector('.tl-b-s'); if (sub) sub.textContent = p.sub0; }
      container.classList.remove('drag-mode');
      if (renderDeferred) { renderDeferred = false; update(); }
    };

    const end = async (e) => {
      if (!press) return;
      clearTimeout(press.timer);
      const p = press;
      press = null;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (!p.active) return; // foi só um toque: o clique abre a ficha
      if (e?.cancelable) e.preventDefault();
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 450);
      if (p.kind === 'swipe') {
        if (!p.armed) { p.el.style.transition = 'transform .2s'; restore(p); setTimeout(() => { p.el.style.transition = ''; }, 220); return; }
        p.el.style.transition = 'transform .18s ease-in, opacity .18s';
        p.el.style.transform = 'translateX(-115%)';
        p.el.style.opacity = '0';
        container.classList.remove('drag-mode');
        const occ = occByKey(state, p.key);
        setTimeout(async () => {
          try { if (occ) await swipeRemove(occ); } finally { renderDeferred = false; update(); }
        }, 170);
        return;
      }
      if (p.ns === p.s0 && p.ne === p.e0) { restore(p); coach(); return; }
      container.classList.remove('drag-mode');
      const occ = occByKey(state, p.key);
      if (!occ) { renderDeferred = false; update(); return; }
      let res = false;
      try {
        res = await moveWithConflicts(occ, p.ns, p.ne, { drag: true });
      } finally {
        renderDeferred = false;
        update();
      }
      if (res) announce(occ, res);
    };

    const cancel = () => {
      if (!press) return;
      clearTimeout(press.timer);
      const p = press;
      press = null;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      restore(p);
    };

    container.addEventListener('touchstart', (e) => {
      const el = e.target.closest('.tl-b');
      if (!el || e.touches.length > 1) { if (press && !press.active) cancel(); return; }
      begin(el, e.touches[0].clientX, e.touches[0].clientY, e.target);
    }, { passive: true });
    container.addEventListener('touchmove', (e) => {
      if (!press) return;
      move(e.touches[0].clientX, e.touches[0].clientY, e);
    }, { passive: false });
    container.addEventListener('touchend', end);
    container.addEventListener('touchcancel', cancel);
    container.addEventListener('contextmenu', (e) => { if (e.target.closest('.tl-b')) e.preventDefault(); });
    // mouse (para testar no computador)
    container.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || ('ontouchstart' in window && navigator.maxTouchPoints > 0)) return;
      const el = e.target.closest('.tl-b');
      if (!el) return;
      begin(el, e.clientX, e.clientY, e.target);
      const mm = (ev) => move(ev.clientX, ev.clientY, ev);
      const mu = (ev) => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); end(ev); };
      window.addEventListener('mousemove', mm);
      window.addEventListener('mouseup', mu);
    });
  }

  /** depois de arrastar: sem aviso (há ↶ ↷); se o item ficou mais curto e abriu um espaço antes do próximo, mostra "Adiantar" nele */
  function announce(occ, res) {
    if (!(res.end < occ.end && res.start === occ.start && !res.leftover?.length)) { setGapHint(null); return; } // só quando terminou antes do previsto
    const g = findGap(res.end, { excludeKey: occ.key });
    const before = g && g.next.start - occ.end;
    if (g && g.from === res.end && g.gap > Math.max(0, before) + 4 * MIN) offerGapAfter(res.end, occ.key);
    else setGapHint(null);
  }

  /** nas primeiras vezes que um bloco é selecionado, explica o que dá para fazer */
  function coach() {
    try {
      const n = Number(localStorage.getItem('agentonator.dragTip') || 0);
      if (n >= 3) return;
      localStorage.setItem('agentonator.dragTip', String(n + 1));
    } catch { return; }
    toast('Arraste o bloco para mover · puxe as bolinhas para mudar início ou fim', { icon: 'grip', ms: 4200 });
  }

  /** aplica (ou remove) o destaque e as bolinhas do bloco selecionado */
  function syncSelection() {
    root.querySelectorAll('.tl-b.sel').forEach((b) => {
      if (b.dataset.key === selKey) return;
      b.classList.remove('sel');
      b.querySelectorAll('.tl-h').forEach((h) => h.remove());
    });
    if (!selKey) return;
    const el = [...root.querySelectorAll('.tl-b')].find((b) => b.dataset.key === selKey);
    if (!el) { selKey = null; return; }
    if (el.classList.contains('sel')) return;
    el.classList.add('sel');
    if (el.dataset.cs !== '1') el.insertAdjacentHTML('beforeend', '<span class="tl-h tl-h-s" data-handle="start" aria-label="Arrastar o início"></span>');
    if (el.dataset.ce !== '1') el.insertAdjacentHTML('beforeend', '<span class="tl-h tl-h-e" data-handle="end" aria-label="Arrastar o fim"></span>');
  }

  function deselect() {
    if (!selKey) return false;
    selKey = null;
    syncSelection();
    return true;
  }

  return {
    id: 'agenda',
    mount,
    update,
    goToDate,
  };
}
