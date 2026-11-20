// Fichas: detalhe do local, item da agenda, menu "+" da agenda e Ajustes.
import {
  state, subscribe, toggleFavorite, toggleDate, setPlaceVisitedDate, setPlaceVisited, getPhoto, setOccStatus, cancelOccurrence,
  restoreOccurrence, unscheduleEvent, deleteEvent, deleteVisit, deleteCommitment, updateSettings,
  exportData, importData, wipeAll, db, deleteItem, markBackupDone, setRemind, mergeImport, previewMerge,
} from './store.js';
import {
  pushSupported, permission, pushReady, pushStatus, onPushStatus, enablePush, disablePush, sendTest, syncNow, normalizeServer,
} from './push.js';
import { isIOS, isStandalone } from './util.js';
import { APP_VERSION, APP_DATE } from './version.js';
import { openSheet, actionSheet, confirmDialog, alertDialog, toast, html, ic, setHTML } from './ui.js';
import { placeThumb, catBadge, switchCell } from './widgets.js';
import { openPlaceForm, openEventForm, openVisitForm, openCommitmentForm, openRescheduleForm, openItemForm } from './forms.js';
import { moveWithConflicts } from './conflicts.js';
import { occRow, slotsSummary, STATUS_LABEL } from './rows.js';
import { expand, occByKey, findConflicts, optMembers, colorOf, KIND_LABEL, FREQ_LABEL, SCOPE_LABEL } from './schedule.js';
import { addInSlot, offerPlanB, keepOnly, swipeRemove, finishNow, pullActions, applyPull, KIND_ACTIONS } from './reorg.js';
import { KIND_ICON } from './icons.js';
import { haptic } from './util.js';
import {
  MIN, DAY, fmtDayLong, fmtRange, fmtDur, fmtHM, dayLabel, fmtDateShort, fmtMin, parseHM, dateKey, parseDateKey,
  LEAD_OPTIONS, leadLabel, atMinutes,
} from './time.js';

const remindText = (m) => (m === 0 ? 'Notificar na hora do início' : `Notificar ${leadLabel(m)} antes`);

// ---------- detalhe do local ----------

export function openPlaceDetail(id) {
  let photoSrc = null;
  const ctl = openSheet({
    title: '', left: 'Fechar', right: 'Editar', className: 'detail-sheet',
    onRight: () => { openPlaceForm({ id }); return false; },
  });
  const render = () => {
    const p = state.places.find((x) => x.id === id);
    if (!p) { ctl.close(); return; }
    ctl.setTitle(p.name);
    const now = Date.now();
    const upcoming = expand(state, now, now + 400 * DAY, now).filter((o) => o.placeId === id && o.end > now && o.status !== 'missed');
    const past = state.history.filter((h) => h.placeId === id).sort((a, b) => b.at - a.at).slice(0, 6);
    const q = encodeURIComponent([p.name, p.address].filter(Boolean).join(', '));
    setHTML(ctl.body, html`
      <div class="hero ${p.hasPhoto ? '' : 'nophoto'}">${p.hasPhoto ? html`<img data-ref="heroimg" src="${photoSrc || p.thumb}" alt="Foto de ${p.name}">` : placeThumb(p, 'hero-ph')}</div>
      <h2 class="detail-title">${p.name}</h2>
      ${p.address ? html`<div class="detail-addr">${ic('pin', 'i xs')} <span>${p.address}</span></div>` : ''}
      <div class="row-meta center">${catBadge(p.category)}${p.visited
        ? html`<span class="badge ok">${ic('check', 'i xs')} Visitado${p.visitedAt ? ` em ${fmtDateShort(p.visitedAt, now)}` : ''}</span>`
        : html`<span class="badge">Ainda não visitado</span>`}</div>
      <div class="quick3 four">
        <button type="button" class="${p.favorite ? 'on star' : ''}" data-act="fav">${ic('star', 'i', p.favorite)}<span>${p.favorite ? 'Favorito' : 'Favoritar'}</span></button>
        <button type="button" class="${p.isDate ? 'on heart' : ''}" data-act="date">${ic('heart', 'i', p.isDate)}<span>Date</span></button>
        <button type="button" class="${p.visited ? 'on check' : ''}" data-act="visited">${ic(p.visited ? 'checkCircleFill' : 'checkCircle')}<span>${p.visited ? 'Visitado' : 'Já fui'}</span></button>
        <button type="button" data-act="visit">${ic('calendar')}<span>Agendar</span></button>
      </div>
      ${p.visited ? html`<div class="form-group"><label class="cell"><span class="cell-ic ok-ic">${ic('check', 'i sm')}</span><span class="lbl grow">Visitado em</span><input type="date" data-ref="visitedDate" value="${p.visitedAt ? dateKey(p.visitedAt) : ''}" max="${dateKey(now)}"></label></div>
        <div class="group-foot">${p.visitedAt ? 'Toque na data para alterar.' : 'Sem data — toque para informar quando você foi.'}</div>` : ''}
      <div class="form-group">
        <button type="button" class="cell" data-act="event"><span class="cell-ic">${ic('ticket', 'i sm')}</span><span class="grow">Criar evento neste local</span>${ic('chevR', 'i sm muted')}</button>
        <a class="cell" href="https://maps.apple.com/?q=${q}" target="_blank" rel="noopener"><span class="cell-ic">${ic('map', 'i sm')}</span><span class="grow">Abrir no Apple Maps</span>${ic('chevR', 'i sm muted')}</a>
        <a class="cell" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener"><span class="cell-ic">${ic('map', 'i sm')}</span><span class="grow">Abrir no Google Maps</span>${ic('chevR', 'i sm muted')}</a>
      </div>
      ${upcoming.length ? html`<div class="group-label">Na agenda</div><div class="group">${upcoming.slice(0, 8).map((o) => occRowWithDay(o, now))}</div>` : ''}
      ${past.length ? html`<div class="group-label" style="margin-top:22px">Histórico neste local</div><div class="group">${past.map((h) => html`<div class="row mini"><span class="kicon sm c-${colorOf(h)}">${ic(KIND_ICON[h.kind], 'i xs')}</span><div class="row-main"><div class="row-title">${h.title}</div><div class="row-sub">${h.source === 'import' ? 'Feito antes do Agentonator (sem data)' : h.dateOnly ? `${fmtDateShort(h.at, now)} · visitado` : `${dayLabel(h.at, now)} · ${h.start != null ? fmtRange(h.start, h.end) : `marcado às ${fmtHM(h.at)}`}`}</div></div></div>`)}</div>` : ''}
    `);
  };
  render();
  const p0 = state.places.find((x) => x.id === id);
  if (p0?.hasPhoto) {
    getPhoto(id).then((full) => {
      photoSrc = full;
      const img = ctl.body.querySelector('[data-ref="heroimg"]');
      if (img && full) img.src = full;
    });
  }
  const unsub = subscribe(() => { if (!ctl.closed) render(); });
  ctl.result.then(unsub);
  ctl.body.addEventListener('change', async (e) => {
    if (e.target.dataset.ref !== 'visitedDate' || !e.target.value) return;
    await setPlaceVisitedDate(id, atMinutes(e.target.value, 12 * 60));
    haptic();
    toast(`Visita registrada em ${fmtDateShort(atMinutes(e.target.value, 12 * 60))}`, { icon: 'check' });
  });
  ctl.body.addEventListener('click', async (e) => {
    const key = e.target.closest('[data-key]')?.dataset.key;
    if (key) { openOccurrenceSheet(key); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    const p = state.places.find((x) => x.id === id);
    if (!p) return;
    if (act === 'fav') { const on = await toggleFavorite('place', id); haptic(); toast(on ? 'Adicionado aos favoritos' : 'Removido dos favoritos', { icon: 'star' }); }
    if (act === 'date') { const on = await toggleDate('place', id); haptic(); toast(on ? 'Marcado como Date ♥' : 'Removido dos Dates', { icon: 'heart' }); }
    if (act === 'visited') { await setPlaceVisited(id, !p.visited); haptic(); toast(!p.visited ? 'Marcado como visitado · no Histórico' : 'Desmarcado', { icon: 'check' }); }
    if (act === 'visit') openVisitForm({ prefill: { placeId: id } });
    if (act === 'event') openEventForm({ prefill: { placeId: id } });
  });
  return ctl.result;
}

function occRowWithDay(o, now) {
  return html`<div class="occ-day-label">${dayLabel(o.start, now)}</div>${occRow(o)}`;
}

// ---------- item da agenda ----------

export function openOccurrenceSheet(key) {
  const ctl = openSheet({ title: '', left: 'Fechar', className: 'occ-sheet' });
  const render = () => {
    const now = Date.now();
    const occ = occByKey(state, key, now);
    if (!occ) { ctl.close(); return; }
    ctl.setTitle(KIND_LABEL[occ.kind]);
    const conflicts = findConflicts(expand(state, occ.start - DAY, occ.end + DAY, now), occ);
    const c = occ.kind === 'commitment' ? state.commitments.find((x) => x.id === occ.refId) : null;
    const past = occ.end <= now;
    const dur = Math.round((occ.end - occ.start) / MIN);
    const statusCells = [];
    const isOpt = !!occ.opt && occ.opt.of > 1;
    const otherOpts = isOpt ? optMembers(state, occ.opt.g, now).filter((o) => o.key !== occ.key) : [];
    if (occ.status === 'planned' || occ.status === 'ongoing') statusCells.push(['done', 'checkCircle', isOpt ? 'Fiz esta opção (marcar como feito)' : 'Marcar como feito', '']);
    if (occ.status === 'done') statusCells.push(past ? ['missed', 'ban', 'Não aconteceu (tirar do histórico)', ''] : ['planned', 'undo', 'Desfazer conclusão', '']);
    if (occ.status === 'missed') statusCells.push(['done', 'checkCircle', 'Marcar como feito', '']);

    setHTML(ctl.body, html`
      <div class="occ-hero c-${colorOf(occ)}">
        <div class="occ-kind">${isOpt ? html`<span class="opt-tag">${occ.opt.letter}</span>` : ''}${ic(KIND_ICON[occ.kind], 'i xs')} ${occ.kind === 'item' ? 'Horário avulso' : KIND_LABEL[occ.kind]}${occ.recurring ? ` · ${(FREQ_LABEL[occ.freq] || '').toLowerCase()}` : ''}<span class="pill-status st-${occ.status}">${STATUS_LABEL[occ.status]}</span></div>
        <div class="occ-title">${occ.title}</div>
        ${occ.kind === 'event' ? html`<div class="occ-sub">${ic('pin', 'i xs')} ${occ.subtitle}</div>` : ''}
        ${occ.kind === 'visit' && occ.subtitle ? html`<div class="occ-sub">${ic('pin', 'i xs')} ${occ.subtitle}</div>` : ''}
        ${occ.kind === 'item' && occ.subtitle ? html`<div class="occ-sub">${occ.subtitle}</div>` : ''}
        <div class="occ-when">${fmtDayLong(occ.start)}</div>
        <div class="occ-time">${fmtRange(occ.start, occ.end)} <span>· ${fmtDur(dur)}</span></div>
        ${occ.recurring && c ? html`<div class="occ-note">${ic('repeat', 'i xs')} ${slotsSummary(c)}</div>` : ''}
        ${occ.overridden ? html`<div class="occ-note warnish">${ic('info', 'i xs')} Horário alterado só ${SCOPE_LABEL[occ.freq] || 'desta vez'} (original: ${fmtDateShort(parseDateKey(occ.origDate).getTime())})</div>` : ''}
      </div>
      ${conflicts.length ? html`<div class="warn">${ic('alert', 'i sm')}<div><b>Sobreposto com:</b> ${conflicts.map((o) => `${o.title} (${fmtRange(o.start, o.end)})`).join(', ')}</div></div>` : ''}
      ${isOpt ? html`<div class="planb-box ${occ.status === 'choose' ? 'choose' : ''}">
          <div class="planb-txt">${ic('split', 'i sm')}<div><b>Opção ${occ.opt.letter} de ${occ.opt.of}</b> · Plano B com ${otherOpts.map((o) => `${o.opt?.letter || ''} “${o.title}”`).join(', ')}.
            ${occ.status === 'choose' ? html`<br><b>Já passou — qual você fez?</b> Toque abaixo, ou deslize para a esquerda na agenda a opção que não fez.` : html`<br>Na hora, fique com a que der certo.`}</div></div>
          <button type="button" class="btn tinted sm full" data-act="keep-only">${ic('check', 'i sm')} Fiz esta opção (tirar as outras)</button>
        </div>` : ''}
      <button type="button" class="bell-btn ${occ.remind != null ? 'on' : ''}" data-act="remind">
        ${ic(occ.remind != null ? 'bell' : 'bellOff', 'i sm')}
        <span class="grow">${occ.remind != null ? remindText(occ.remind) : 'Sem notificação · toque para ativar'}${occ.recurring ? html`<small>vale para todas as ocorrências</small>` : ''}</span>
        ${ic('chevR', 'i sm muted')}
      </button>
      <div class="group-label">Adiar</div>
      <div class="qa">
        <button type="button" data-shift="15">+15 min</button>
        <button type="button" data-shift="60">+1 h</button>
        <button type="button" data-shift="1440">+1 dia</button>
        <button type="button" data-shift="10080">+1 sem.</button>
      </div>
      <div class="group-label">Antecipar</div>
      <div class="qa">
        <button type="button" data-shift="-15">−15 min</button>
        <button type="button" data-shift="-60">−1 h</button>
        <button type="button" data-shift="-1440">−1 dia</button>
        <button type="button" data-act="resched" class="accent-btn">Outro…</button>
      </div>
      <div class="group-foot qa-foot">${occ.recurring ? `Mudanças aqui valem só ${SCOPE_LABEL[occ.freq]} — as outras ocorrências continuam no horário de sempre.` : 'Dica: na agenda, segure o bloco e arraste para mover; puxe a borda de baixo para mudar a duração.'}</div>
      <div class="group-label">Reorganizar</div>
      <div class="form-group">
        ${occ.status === 'ongoing' ? html`<button type="button" class="cell" data-act="finish"><span class="cell-ic">${ic('stop', 'i sm')}</span><span class="grow"><span class="cell-title">Terminei agora</span><span class="cell-hint">Encerra às ${fmtHM(Math.floor(now / (5 * MIN)) * 5 * MIN)} e oferece adiantar o que vem depois</span></span></button>` : ''}
        ${occ.status !== 'done' && occ.status !== 'missed' ? html`<button type="button" class="cell" data-act="planb"><span class="cell-ic">${ic('split', 'i sm')}</span><span class="grow"><span class="cell-title">${occ.opt ? 'Adicionar outra opção' : 'Criar um Plano B'}</span><span class="cell-hint">Outra opção para o mesmo horário (ex.: se chover). Atalho: toque 3 vezes no bloco</span></span></button>` : ''}
        ${occ.status === 'done' ? html`<button type="button" class="cell" data-act="replace"><span class="cell-ic">${ic('swap', 'i sm')}</span><span class="grow"><span class="cell-title">Não foi isso que eu fiz…</span><span class="cell-hint">Tira da agenda e do Histórico e registra o que você fez no lugar. Atalho: deslize o bloco para a esquerda</span></span></button>` : ''}
      </div>
      <div class="form-group">
        ${occ.overridden ? html`<button type="button" class="cell" data-act="restore"><span class="cell-ic">${ic('undo', 'i sm')}</span><span class="grow">Voltar ao horário de sempre</span></button>` : ''}
        ${statusCells.map(([v, icn, label]) => html`<button type="button" class="cell" data-status="${v}"><span class="cell-ic">${ic(icn, 'i sm')}</span><span class="grow">${label}</span></button>`)}
      </div>
      <div class="form-group">
        ${occ.kind === 'event' ? html`<button type="button" class="cell" data-act="open-event"><span class="cell-ic">${ic('pencil', 'i sm')}</span><span class="grow">Editar evento</span>${ic('chevR', 'i sm muted')}</button>` : ''}
        ${occ.kind === 'visit' ? html`<button type="button" class="cell" data-act="edit-visit"><span class="cell-ic">${ic('pencil', 'i sm')}</span><span class="grow">Editar visita</span>${ic('chevR', 'i sm muted')}</button>` : ''}
        ${occ.kind === 'item' ? html`<button type="button" class="cell" data-act="edit-item"><span class="cell-ic">${ic('pencil', 'i sm')}</span><span class="grow">Editar título e observação</span>${ic('chevR', 'i sm muted')}</button>` : ''}
        ${occ.placeId ? html`<button type="button" class="cell" data-act="open-place"><span class="cell-ic">${ic('pin', 'i sm')}</span><span class="grow">Ver local</span>${ic('chevR', 'i sm muted')}</button>` : ''}
        ${occ.kind === 'commitment' ? html`<button type="button" class="cell" data-act="edit-commitment"><span class="cell-ic">${ic('pencil', 'i sm')}</span><span class="grow">Editar compromisso${occ.recurring ? ' (todas as ocorrências)' : ''}</span>${ic('chevR', 'i sm muted')}</button>` : ''}
      </div>
      <div class="form-group">
        ${occ.recurring ? html`<button type="button" class="cell danger" data-act="cancel-occ"><span class="cell-ic">${ic('ban', 'i sm')}</span><span class="grow">Cancelar só ${SCOPE_LABEL[occ.freq]}</span></button>` : ''}
        ${occ.kind === 'commitment' && !occ.recurring ? html`<button type="button" class="cell danger" data-act="delete-commitment"><span class="cell-ic">${ic('trash', 'i sm')}</span><span class="grow">Excluir compromisso</span></button>` : ''}
        ${occ.kind === 'event' ? html`<button type="button" class="cell danger" data-act="unschedule"><span class="cell-ic">${ic('calendar', 'i sm')}</span><span class="grow">Tirar da agenda (manter evento)</span></button>
          <button type="button" class="cell danger" data-act="delete-event"><span class="cell-ic">${ic('trash', 'i sm')}</span><span class="grow">Excluir evento</span></button>` : ''}
        ${occ.kind === 'visit' ? html`<button type="button" class="cell danger" data-act="delete-visit"><span class="cell-ic">${ic('trash', 'i sm')}</span><span class="grow">Excluir visita</span></button>` : ''}
        ${occ.kind === 'item' ? html`<button type="button" class="cell danger" data-act="delete-item"><span class="cell-ic">${ic('trash', 'i sm')}</span><span class="grow">Excluir da agenda</span></button>` : ''}
      </div>`);
  };
  render();
  const unsub = subscribe(() => { if (!ctl.closed) render(); });
  ctl.result.then(unsub);

  ctl.body.addEventListener('click', async (e) => {
    const occ = occByKey(state, key);
    if (!occ) return;
    const shiftBtn = e.target.closest('[data-shift]');
    if (shiftBtn) {
      const m = Number(shiftBtn.dataset.shift);
      shiftBtn.disabled = true;
      try {
        const res = await moveWithConflicts(occ, occ.start + m * MIN, occ.end + m * MIN);
        if (res && !res.policy) { haptic(); toast(`${m > 0 ? 'Adiado' : 'Antecipado'}: ${dayLabel(res.start)} ${fmtRange(res.start, res.end)}`, { icon: 'clock' }); }
      } finally { shiftBtn.disabled = false; }
      return;
    }
    const st = e.target.closest('[data-status]')?.dataset.status;
    if (st === 'done' && occ.opt && occ.opt.of > 1) {
      const kept = await keepOnly(occ);
      if (kept && kept.status !== 'done') await setOccStatus(kept, 'done');
      return;
    }
    if (st) {
      await setOccStatus(occ, st);
      haptic();
      toast(st === 'done' ? 'Feito! Registrado no Histórico' : st === 'missed' ? 'Marcado como não aconteceu' : 'Conclusão desfeita', { icon: st === 'done' ? 'check' : 'undo' });
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    switch (act) {
      case 'planb': ctl.close(); offerPlanB(occ); return;
      case 'keep-only': await keepOnly(occ); return;
      case 'finish': await finishNow(occ); return;
      case 'replace': ctl.close(); swipeRemove(occ); return;
      case 'remind': {
        const cur = occ.remind;
        const v = await actionSheet({
          title: 'Notificação',
          message: occ.recurring ? 'Vale para todas as ocorrências deste compromisso.' : `${occ.title} · ${dayLabel(occ.start)} ${fmtRange(occ.start, occ.end)}`,
          actions: [
            { label: `${cur == null ? '✓ ' : ''}Sem notificação`, value: 'off', icon: 'bellOff' },
            ...LEAD_OPTIONS.map((m) => ({ label: `${cur === m ? '✓ ' : ''}${m === 0 ? 'Na hora do início' : `${leadLabel(m)} antes`}`, value: String(m) })),
          ],
        });
        if (v == null) break;
        const minutes = v === 'off' ? null : Number(v);
        await setRemind(occ.kind, occ.refId, minutes);
        haptic();
        if (minutes == null) toast('Notificação desligada', { icon: 'bellOff' });
        else if (!pushReady()) alertDialog({ title: 'Lembrete salvo', message: 'Falta só ativar as notificações deste iPhone: Agenda → botão de ajustes → Notificações.' });
        else toast(minutes === 0 ? 'Vou avisar na hora do início' : `Vou avisar ${leadLabel(minutes)} antes`, { icon: 'bell' });
        break;
      }
      case 'resched':
        openRescheduleForm(occ, (s, en) => moveWithConflicts(occ, s, en).then((r) => { if (r && !r.policy) toast('Horário atualizado', { icon: 'clock' }); return r; }));
        break;
      case 'restore': await restoreOccurrence(occ); toast('Horário original restaurado', { icon: 'undo' }); break;
      case 'open-event': openEventForm({ id: occ.refId }); break;
      case 'edit-visit': openVisitForm({ id: occ.refId }); break;
      case 'edit-item': openItemForm({ id: occ.refId }); break;
      case 'open-place': openPlaceDetail(occ.placeId); break;
      case 'edit-commitment': openCommitmentForm({ id: occ.refId }); break;
      case 'cancel-occ': {
        const ok = await confirmDialog({ title: `Cancelar só ${SCOPE_LABEL[occ.freq]}?`, message: `“${occ.title}” de ${dayLabel(occ.start)} sai da agenda. As outras ocorrências continuam.`, ok: 'Cancelar ocorrência', cancel: 'Voltar', destructive: true });
        if (ok) { await cancelOccurrence(occ); toast('Ocorrência cancelada', { icon: 'ban' }); ctl.close(); }
        break;
      }
      case 'delete-commitment': {
        const ok = await confirmDialog({ title: `Excluir “${occ.title}”?`, message: 'O histórico é mantido.', ok: 'Excluir', destructive: true });
        if (ok) { await deleteCommitment(occ.refId); toast('Compromisso excluído', { icon: 'trash' }); ctl.close(); }
        break;
      }
      case 'unschedule': await unscheduleEvent(occ.refId); toast('Evento tirado da agenda (continua na aba Eventos)', { icon: 'calendar' }); ctl.close(); break;
      case 'delete-event': {
        const ok = await confirmDialog({ title: `Excluir “${occ.title}”?`, message: 'O histórico é mantido.', ok: 'Excluir', destructive: true });
        if (ok) { await deleteEvent(occ.refId); toast('Evento excluído', { icon: 'trash' }); ctl.close(); }
        break;
      }
      case 'delete-item': {
        const ok = await confirmDialog({ title: `Excluir “${occ.title}”?`, message: 'O histórico é mantido.', ok: 'Excluir', destructive: true });
        if (ok) { await deleteItem(occ.refId); toast('Excluído da agenda', { icon: 'trash' }); ctl.close(); }
        break;
      }
      case 'delete-visit': {
        const ok = await confirmDialog({ title: 'Excluir esta visita?', message: 'O local continua cadastrado.', ok: 'Excluir', destructive: true });
        if (ok) { await deleteVisit(occ.refId); toast('Visita excluída', { icon: 'trash' }); ctl.close(); }
        break;
      }
      default: break;
    }
  });
  return ctl.result;
}

// ---------- menu "+" da agenda ----------

/**
 * Menu do "+" (ou de um horário vazio). Local e Evento abrem a escolha com busca e filtros.
 * opts.gap: espaço livre onde o toque caiu -> oferece também "adiantar" o que vem depois.
 */
export async function openAddChooser(start, { gap = null } = {}) {
  const v = await actionSheet({
    title: gap ? 'Este horário está livre' : 'Adicionar à agenda',
    message: start ? `${dayLabel(start)}, ${fmtHM(start)}${gap ? ` · ${fmtDur(gap.gap / MIN)} livres até “${gap.next.title}”` : ''}` : undefined,
    actions: [...KIND_ACTIONS, ...(gap ? pullActions(gap) : [])],
  });
  if (!v) return null;
  if (v === 'pull-next' || v === 'pull-all') return applyPull(gap, v === 'pull-all');
  return addInSlot(v, { start });
}

// ---------- ajustes ----------

const POLICIES = [
  ['ask', 'Perguntar sempre (recomendado)', 'Mostra o que cada escolha faz: adiar o que vem depois, só atrasar o início do próximo, manter sobreposto…'],
  ['cascade', 'Adiar tudo o que vem depois', 'Empurra os próximos itens do mesmo dia. O que começou antes fica sobreposto, com aviso'],
  ['trim', 'Só encurtar o vizinho', 'O próximo começa quando este termina (o fim dele não muda); quando não dá, pergunta'],
  ['push-new', 'Adiar o novo', 'O novo vai para o primeiro horário livre (ao arrastar na agenda, pergunta)'],
  ['overlap', 'Permitir sobreposição', 'Salva os dois e só avisa na agenda'],
];
const currentPolicy = (s) => (s.conflictPolicy === 'push-existing' ? 'cascade' : s.conflictPolicy);

/** gera o arquivo de backup e abre a folha de compartilhar (Salvar em Arquivos). Retorna true se exportou. */
export async function doExport() {
  const data = await exportData();
  const name = `agentonator-backup-${dateKey(Date.now())}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Backup do Agentonator' });
      await markBackupDone();
      toast('Backup exportado', { icon: 'check' });
      return true;
    } catch (e) { if (e?.name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  await markBackupDone();
  toast('Backup exportado', { icon: 'check' });
  return true;
}

export function backupAgeLabel(now = Date.now()) {
  const t = state.settings.lastBackupAt;
  if (!t) return 'Nenhum backup feito ainda';
  const days = Math.floor((now - t) / DAY);
  return `Último backup: ${days === 0 ? 'hoje' : days === 1 ? 'ontem' : `há ${days} dias`}`;
}

/** confirma e importa uma lista (adiciona sem apagar) */
export async function runMerge(data) {
  const p = previewMerge(data);
  const lines = [];
  if (p.places || p.events) lines.push(`${p.places} locais (${p.visited} já visitados), ${p.events} eventos (${p.done} já feitos)${p.visits ? ` e ${p.visits} visita agendada` : ''}.`);
  if (p.merges.length) {
    lines.push(`Juntar locais repetidos:\n${p.merges.map((m) => `• ${m.names.filter((n) => n !== m.keep).join(' + ')} → ${m.keep}`).join('\n')}`);
  }
  lines.push(p.merges.length && !(p.places || p.events)
    ? 'Eventos, visitas, favoritos e histórico dos repetidos passam para o local que fica.'
    : 'Nada do que você já tem será apagado. Itens com o mesmo nome dos seus são ignorados.');
  const ok = await confirmDialog({ title: `Importar ${p.title}?`, message: lines.join('\n\n'), ok: p.merges.length && !(p.places || p.events) ? 'Juntar' : 'Importar' });
  if (!ok) return null;
  const r = await mergeImport(data);
  const skipped = r.placesSkipped + r.eventsSkipped + r.visitsSkipped;
  const parts = [];
  if (p.places || p.events) parts.push(`Adicionados: ${r.placesAdded} locais, ${r.eventsAdded} eventos${r.visitsAdded ? `, ${r.visitsAdded} visita na agenda` : ''}.${skipped ? `\n${skipped} item(ns) já existiam e foram mantidos como estavam.` : ''}`);
  if (p.merges.length) parts.push(r.merged ? `${r.merged} grupo(s) de locais repetidos juntados.` : 'Nenhum repetido encontrado (talvez já tenham sido juntados).');
  await alertDialog({ title: 'Pronto ✓', message: parts.join('\n\n') });
  return r;
}

function notificationsHtml(s) {
  const sup = pushSupported();
  let title;
  let hint;
  let icn = 'bell';
  if (!sup) {
    title = 'Indisponível aqui'; icn = 'bellOff';
    hint = isIOS() && !isStandalone() ? 'Abra o Agentonator pelo ícone da Tela de Início (iOS 16.4 ou mais novo).' : 'Este navegador não oferece notificações para web apps.';
  } else if (!s.pushEnabled) {
    title = 'Desativadas'; icn = 'bellOff';
    hint = 'Cole o endereço do seu servidor gratuito abaixo e toque em Ativar.';
  } else if (permission() !== 'granted') {
    title = 'Sem permissão'; icn = 'bellOff';
    hint = 'Libere em Ajustes do iPhone → Notificações → Agentonator.';
  } else if (pushStatus.lastError) {
    title = 'Atenção'; hint = pushStatus.lastError;
  } else {
    title = 'Ativadas ✓';
    hint = pushStatus.lastSync ? `${pushStatus.count} aviso(s) agendado(s) · sincronizado às ${fmtHM(pushStatus.lastSync)}` : 'Sincronizando…';
  }
  const def = s.defaultRemind ?? 60;
  return html`<div class="group-label">Notificações</div>
    <div class="form-group">
      <div class="cell"><span class="cell-ic">${ic(icn, 'i sm')}</span><span class="grow"><span class="cell-title">${title}</span><span class="cell-hint">${hint}</span></span></div>
      <label class="cell"><span class="lbl">Servidor</span><input type="url" name="pushServer" value="${s.pushServer || ''}" placeholder="https://agentonator-push…workers.dev" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="url" ${s.pushEnabled ? 'readonly' : ''}></label>
      ${s.pushEnabled
        ? html`<button type="button" class="cell" data-act="push-test"><span class="cell-ic">${ic('bell', 'i sm')}</span><span class="grow">Enviar notificação de teste</span></button>
          <button type="button" class="cell" data-act="push-sync"><span class="cell-ic">${ic('repeat', 'i sm')}</span><span class="grow">Sincronizar agora</span></button>
          <button type="button" class="cell danger" data-act="push-off"><span class="cell-ic">${ic('bellOff', 'i sm')}</span><span class="grow">Desativar notificações</span></button>`
        : html`<button type="button" class="cell" data-act="push-on" ${sup ? '' : 'disabled'}><span class="cell-ic">${ic('bell', 'i sm')}</span><span class="grow accent strongish">Ativar notificações</span></button>`}
    </div>
    <div class="group-foot">Os avisos são enviados por um servidor gratuito seu (Cloudflare) — passo a passo no README do projeto. Ele guarda só o título e o horário dos avisos ligados.</div>
    <div class="group-label">Antecedência padrão</div>
    <div class="form-group"><div class="cell chips-cell"><div class="chips inset">${LEAD_OPTIONS.map((m) => html`<button type="button" class="chip sm ${m === def ? 'on' : ''}" data-defrem="${m}">${leadLabel(m)}</button>`)}</div></div></div>
    <div class="group-foot">Usada quando você liga a notificação de um item (padrão: 1h antes). Cada item pode ter a sua.</div>`;
}

export function openSettings() {
  const ctl = openSheet({ title: 'Ajustes', left: 'Fechar', className: 'settings-sheet' });
  let storageInfo = '';
  const render = () => {
    const s = state.settings;
    const typed = ctl.body.querySelector('input[name=pushServer]');
    const typedValue = typed && document.activeElement === typed ? typed.value : null;
    const counts = `${state.places.length} locais · ${state.events.length} eventos · ${state.commitments.length} compromissos · ${state.items.length} avulsos · ${state.history.length} no histórico`;
    setHTML(ctl.body, html`<form class="form" onsubmit="return false">
      <div class="group-label">Conflitos de horário</div>
      <div class="form-group">${POLICIES.map(([v, label, hint]) => html`<button type="button" class="cell radio" data-policy="${v}"><span class="grow"><span class="cell-title">${label}</span><span class="cell-hint">${hint}</span></span>${currentPolicy(s) === v ? ic('check', 'i accent') : ''}</button>`)}</div>
      ${notificationsHtml(s)}
      <div class="group-label">Seus dados</div>
      <div class="form-group">
        <div class="cell"><span class="cell-ic">${ic('shield', 'i sm')}</span><span class="grow"><span class="cell-title">Salvo neste iPhone</span><span class="cell-hint">${counts}${storageInfo ? html`<br>${storageInfo}` : ''}</span></span></div>
        <button type="button" class="cell" data-act="export"><span class="cell-ic">${ic('upload', 'i sm')}</span><span class="grow"><span class="cell-title">Exportar backup</span><span class="cell-hint">${backupAgeLabel()}</span></span></button>
        <button type="button" class="cell" data-act="merge"><span class="cell-ic">${ic('list', 'i sm')}</span><span class="grow"><span class="cell-title">Importar lista</span><span class="cell-hint">Adiciona locais e eventos de um arquivo — não apaga nada</span></span></button>
        <button type="button" class="cell" data-act="import"><span class="cell-ic">${ic('download', 'i sm')}</span><span class="grow"><span class="cell-title">Restaurar backup</span><span class="cell-hint">Substitui todos os dados pelos do backup</span></span></button>
        <input type="file" data-ref="importFile" hidden>
      </div>
      <div class="group-foot">Os dados ficam gravados no aparelho e funcionam offline. Faça um backup de vez em quando e salve no app Arquivos / iCloud Drive.</div>
      <div class="form-group"><button type="button" class="cell danger center" data-act="wipe">Apagar todos os dados</button></div>
      <div class="form-group"><button type="button" class="cell" data-act="check-update"><span class="cell-ic">${ic('download', 'i sm')}</span><span class="grow"><span class="cell-title">Procurar atualização</span><span class="cell-hint">Você está na versão ${APP_VERSION} (${APP_DATE})</span></span></button></div>
      <div class="about">Agentonator · versão ${APP_VERSION} · feito para iPhone</div>
    </form>`);
    if (typedValue != null) {
      const inp = ctl.body.querySelector('input[name=pushServer]');
      if (inp) { inp.value = typedValue; inp.focus(); }
    }
  };
  render();
  Promise.all([db.estimate(), db.requestPersist()]).then(([est, persisted]) => {
    const used = est?.usage ? `${(est.usage / 1024 / 1024).toFixed(1)} MB usados` : '';
    storageInfo = [used, persisted ? 'armazenamento protegido ✓' : ''].filter(Boolean).join(' · ');
    if (!ctl.closed) render();
  });
  const unsub = subscribe(() => { if (!ctl.closed) render(); });
  const unsubPush = onPushStatus(() => { if (!ctl.closed) render(); });
  ctl.result.then(() => { unsub(); unsubPush(); });

  ctl.body.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.name === 'pushServer' && !state.settings.pushEnabled) await updateSettings({ pushServer: normalizeServer(t.value) });
    if (t.dataset.ref === 'importFile' && t.files?.[0]) {
      try {
        const data = JSON.parse(await t.files[0].text());
        if (data?.app !== 'agentonator') throw new Error('Este arquivo não é um backup do Agentonator.');
        if (data.kind === 'merge') { await runMerge(data); return; }
        const ok = await confirmDialog({
          title: 'Restaurar backup?',
          message: `Backup de ${data.exportedAt ? new Date(data.exportedAt).toLocaleString('pt-BR') : 'data desconhecida'} com ${(data.places || []).length} locais e ${(data.events || []).length} eventos. Os dados atuais serão SUBSTITUÍDOS.`,
          ok: 'Restaurar', destructive: true,
        });
        if (ok) { await importData(data); toast('Backup restaurado', { icon: 'check' }); }
      } catch (err) {
        alertDialog({ title: 'Não foi possível restaurar', message: err.message });
      } finally { t.value = ''; }
    }
  });
  ctl.body.addEventListener('click', async (e) => {
    const pol = e.target.closest('[data-policy]')?.dataset.policy;
    if (pol) { await updateSettings({ conflictPolicy: pol }); haptic(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'push-on') {
      // enablePush pede a permissão logo no início: tem que acontecer direto neste toque (regra do iOS)
      const btn = e.target.closest('[data-act]');
      btn.disabled = true;
      try {
        await enablePush(ctl.body.querySelector('input[name=pushServer]').value);
        haptic();
        toast('Notificações ativadas', { icon: 'bell' });
      } catch (err) {
        alertDialog({ title: 'Não foi possível ativar', message: err.message });
      } finally { btn.disabled = false; render(); }
      return;
    }
    if (act === 'push-test') {
      try { await sendTest(); toast('Teste enviado — deve chegar em alguns segundos', { icon: 'bell' }); } catch (err) { alertDialog({ title: 'O teste falhou', message: err.message }); }
      return;
    }
    if (act === 'push-sync') {
      await syncNow({ force: true });
      if (pushStatus.lastError) alertDialog({ title: 'Não sincronizou', message: pushStatus.lastError });
      else toast(`${pushStatus.count} aviso(s) agendado(s) no servidor`, { icon: 'check' });
      return;
    }
    if (act === 'push-off') {
      const ok = await confirmDialog({ title: 'Desativar notificações?', message: 'Os avisos agendados deixam de ser enviados. As escolhas de notificação de cada item continuam salvas.', ok: 'Desativar', destructive: true });
      if (ok) { await disablePush(); toast('Notificações desativadas', { icon: 'bellOff' }); }
      return;
    }
    const defrem = e.target.closest('[data-defrem]')?.dataset.defrem;
    if (defrem != null) { await updateSettings({ defaultRemind: Number(defrem) }); haptic(); return; }
    if (act === 'export') {
      try { await doExport(); } catch (err) { alertDialog({ title: 'Falha ao exportar', message: err.message }); }
    }
    if (act === 'import' || act === 'merge') ctl.body.querySelector('[data-ref="importFile"]').click();
    if (act === 'check-update') {
      try {
        const found = await window.__agentonatorCheckUpdate?.();
        if (found) toast('Baixando a nova versão… o app reinicia sozinho em instantes', { icon: 'download', ms: 4000 });
        else toast(`Você já está na versão mais recente (${APP_VERSION})`, { icon: 'check' });
      } catch {
        toast('Sem internet agora — tente de novo depois', { icon: 'alert' });
      }
    }
    if (act === 'wipe') {
      const ok = await confirmDialog({ title: 'Apagar TUDO?', message: 'Todos os locais, fotos, eventos, compromissos e histórico serão apagados deste iPhone. Considere exportar um backup antes.', ok: 'Apagar tudo', destructive: true });
      if (!ok) return;
      const ok2 = await confirmDialog({ title: 'Tem certeza mesmo?', message: 'Não há como desfazer.', ok: 'Sim, apagar', destructive: true });
      if (!ok2) return;
      await wipeAll();
      toast('Dados apagados', { icon: 'trash' });
    }
  });
  return ctl.result;
}
