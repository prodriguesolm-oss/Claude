// Fichas: detalhe do local, item da agenda, menu "+" da agenda e Ajustes.
import {
  state, subscribe, toggleFavorite, setPlaceVisited, getPhoto, setOccStatus, cancelOccurrence,
  restoreOccurrence, unscheduleEvent, deleteEvent, deleteVisit, deleteCommitment, updateSettings,
  exportData, importData, wipeAll, db, deleteItem, markBackupDone, setRemind,
} from './store.js';
import {
  pushSupported, permission, pushReady, pushStatus, onPushStatus, enablePush, disablePush, sendTest, syncNow, normalizeServer,
} from './push.js';
import { isIOS, isStandalone } from './util.js';
import { openSheet, actionSheet, confirmDialog, alertDialog, toast, html, ic, setHTML } from './ui.js';
import { placeThumb, catBadge, switchCell } from './widgets.js';
import { openPlaceForm, openEventForm, openVisitForm, openCommitmentForm, openRescheduleForm, openItemForm } from './forms.js';
import { moveWithConflicts } from './conflicts.js';
import { occRow, slotsSummary, STATUS_LABEL } from './rows.js';
import { expand, occByKey, findConflicts, KIND_LABEL, FREQ_LABEL, SCOPE_LABEL } from './schedule.js';
import { KIND_ICON } from './icons.js';
import { haptic } from './util.js';
import {
  MIN, DAY, fmtDayLong, fmtRange, fmtDur, fmtHM, dayLabel, fmtDateShort, fmtMin, parseHM, dateKey, parseDateKey,
  LEAD_OPTIONS, leadLabel,
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
      <div class="quick3">
        <button type="button" class="${p.favorite ? 'on star' : ''}" data-act="fav">${ic('star', 'i', p.favorite)}<span>${p.favorite ? 'Favorito' : 'Favoritar'}</span></button>
        <button type="button" class="${p.visited ? 'on check' : ''}" data-act="visited">${ic(p.visited ? 'checkCircleFill' : 'checkCircle')}<span>${p.visited ? 'Visitado' : 'Já fui'}</span></button>
        <button type="button" data-act="visit">${ic('calendar')}<span>Agendar visita</span></button>
      </div>
      <div class="form-group">
        <button type="button" class="cell" data-act="event"><span class="cell-ic">${ic('ticket', 'i sm')}</span><span class="grow">Criar evento neste local</span>${ic('chevR', 'i sm muted')}</button>
        <a class="cell" href="https://maps.apple.com/?q=${q}" target="_blank" rel="noopener"><span class="cell-ic">${ic('map', 'i sm')}</span><span class="grow">Abrir no Apple Maps</span>${ic('chevR', 'i sm muted')}</a>
        <a class="cell" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener"><span class="cell-ic">${ic('map', 'i sm')}</span><span class="grow">Abrir no Google Maps</span>${ic('chevR', 'i sm muted')}</a>
      </div>
      ${upcoming.length ? html`<div class="group-label">Na agenda</div><div class="group">${upcoming.slice(0, 8).map((o) => occRowWithDay(o, now))}</div>` : ''}
      ${past.length ? html`<div class="group-label" style="margin-top:22px">Histórico neste local</div><div class="group">${past.map((h) => html`<div class="row mini"><span class="kicon sm k-${h.kind}">${ic(KIND_ICON[h.kind], 'i xs')}</span><div class="row-main"><div class="row-title">${h.title}</div><div class="row-sub">${dayLabel(h.at, now)} · ${h.start != null ? fmtRange(h.start, h.end) : `marcado às ${fmtHM(h.at)}`}</div></div></div>`)}</div>` : ''}
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
  ctl.body.addEventListener('click', async (e) => {
    const key = e.target.closest('[data-key]')?.dataset.key;
    if (key) { openOccurrenceSheet(key); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    const p = state.places.find((x) => x.id === id);
    if (!p) return;
    if (act === 'fav') { const on = await toggleFavorite('place', id); haptic(); toast(on ? 'Adicionado aos favoritos' : 'Removido dos favoritos', { icon: 'star' }); }
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
    if (occ.status === 'planned' || occ.status === 'ongoing') statusCells.push(['done', 'checkCircle', 'Marcar como feito', '']);
    if (occ.status === 'done') statusCells.push(past ? ['missed', 'ban', 'Não aconteceu (tirar do histórico)', ''] : ['planned', 'undo', 'Desfazer conclusão', '']);
    if (occ.status === 'missed') statusCells.push(['done', 'checkCircle', 'Marcar como feito', '']);

    setHTML(ctl.body, html`
      <div class="occ-hero k-${occ.kind}">
        <div class="occ-kind">${ic(KIND_ICON[occ.kind], 'i xs')} ${occ.kind === 'item' ? 'Horário avulso' : KIND_LABEL[occ.kind]}${occ.recurring ? ` · ${(FREQ_LABEL[occ.freq] || '').toLowerCase()}` : ''}<span class="pill-status st-${occ.status}">${STATUS_LABEL[occ.status]}</span></div>
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
      <div class="group-foot qa-foot">${occ.recurring ? `Mudanças aqui valem só ${SCOPE_LABEL[occ.freq]} — as outras ocorrências continuam no horário de sempre.` : 'Dica: na agenda, segure um bloco e arraste para mudar o horário.'}</div>
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
    if (st) {
      await setOccStatus(occ, st);
      haptic();
      toast(st === 'done' ? 'Feito! Registrado no Histórico' : st === 'missed' ? 'Marcado como não aconteceu' : 'Conclusão desfeita', { icon: st === 'done' ? 'check' : 'undo' });
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    switch (act) {
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

export async function openAddChooser(start) {
  const v = await actionSheet({
    title: 'Adicionar à agenda',
    message: start ? `${dayLabel(start)}, ${fmtHM(start)}` : undefined,
    actions: [
      { label: 'Horário avulso (só título)', value: 'item', icon: 'note' },
      { label: 'Evento', value: 'event', icon: 'ticket' },
      { label: 'Local (visita)', value: 'visit', icon: 'pin' },
      { label: 'Compromisso', value: 'commitment', icon: 'repeat' },
    ],
  });
  if (v === 'item') return openItemForm({ prefill: { start } });
  if (v === 'event') return openEventForm({ prefill: { start }, requireSchedule: true });
  if (v === 'visit') return openVisitForm({ prefill: { start } });
  if (v === 'commitment') return openCommitmentForm({ prefill: { start } });
  return null;
}

// ---------- ajustes ----------

const POLICIES = [
  ['ask', 'Perguntar sempre', 'Mostra as opções a cada conflito'],
  ['push-existing', 'Adiar o que já estava marcado', 'O novo fica no horário; o antigo vai para depois'],
  ['push-new', 'Adiar o novo', 'O novo vai para o primeiro horário livre'],
  ['overlap', 'Permitir sobreposição', 'Salva os dois e só avisa na agenda'],
];

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
      <div class="form-group">${POLICIES.map(([v, label, hint]) => html`<button type="button" class="cell radio" data-policy="${v}"><span class="grow"><span class="cell-title">${label}</span><span class="cell-hint">${hint}</span></span>${s.conflictPolicy === v ? ic('check', 'i accent') : ''}</button>`)}</div>
      ${notificationsHtml(s)}
      <div class="group-label">Seus dados</div>
      <div class="form-group">
        <div class="cell"><span class="cell-ic">${ic('shield', 'i sm')}</span><span class="grow"><span class="cell-title">Salvo neste iPhone</span><span class="cell-hint">${counts}${storageInfo ? html`<br>${storageInfo}` : ''}</span></span></div>
        <button type="button" class="cell" data-act="export"><span class="cell-ic">${ic('upload', 'i sm')}</span><span class="grow"><span class="cell-title">Exportar backup</span><span class="cell-hint">${backupAgeLabel()}</span></span></button>
        <button type="button" class="cell" data-act="import"><span class="cell-ic">${ic('download', 'i sm')}</span><span class="grow">Restaurar backup</span></button>
        <input type="file" accept="application/json,.json" data-ref="importFile" hidden>
      </div>
      <div class="group-foot">Os dados ficam gravados no aparelho e funcionam offline. Faça um backup de vez em quando e salve no app Arquivos / iCloud Drive.</div>
      <div class="form-group"><button type="button" class="cell danger center" data-act="wipe">Apagar todos os dados</button></div>
      <div class="about">Agentonator 1.0 · feito para iPhone</div>
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
    if (act === 'import') ctl.body.querySelector('[data-ref="importFile"]').click();
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
