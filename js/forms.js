// Formulários de cadastro/edição: local, evento, visita a local e compromisso.
import {
  state, savePlace, saveEvent, saveVisit, saveCommitment, deleteEvent, deleteVisit, deleteCommitment,
  applyMoves, getPhoto, deletePlace, placeDependents, saveItem, deleteItem,
} from './store.js';
import { openSheet, html, ic, raw, toast, shake, confirmDialog, alertDialog, setHTML } from './ui.js';
import {
  segHTML, switchCell, textCell, dateTimeCells, durationCell, readStart, placePickerCell,
  bindFormWidgets, searchBar, placeThumb,
} from './widgets.js';
import { resolveConflicts, reportResolution, confirmSeries } from './conflicts.js';
import { processPhoto } from './photo.js';
import { uid, matchScore, byName } from './util.js';
import {
  MIN, DAY, roundUp, minutesOfDay, fmtMin, parseHM, atMinutes, dateKey, WD_CAP, fmtDayLong, fmtRange,
} from './time.js';

const CAT_OPTIONS = [['', 'Nenhuma'], ['cultura', 'Cultura'], ['aventura', 'Aventura'], ['outros', 'Outros']];

export const defaultStart = () => roundUp(Date.now() + 15 * MIN, 30);

function deleteButton(label) {
  return html`<div class="form-group"><button type="button" class="cell danger center" data-act="delete">${ic('trash', 'i sm')} ${label}</button></div>`;
}

// ---------- seletor de local ----------

export function openPlacePicker(selectedId) {
  let q = '';
  const ctl = openSheet({
    title: 'Escolher local',
    className: 'picker-sheet',
    body: html`<div class="sticky-search">${searchBar('Buscar locais')}</div>
      <div class="form-group"><button type="button" class="cell" data-act="new-place"><span class="cell-ic accent">${ic('plus', 'i sm')}</span><span class="accent grow">Cadastrar novo local</span></button></div>
      <div class="group" data-ref="plist"></div>`,
  });
  const listEl = ctl.body.querySelector('[data-ref="plist"]');
  const render = () => {
    const items = state.places
      .map((p) => ({ p, s: matchScore(q, p.name, p.address) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || byName(a.p, b.p));
    if (!state.places.length) {
      setHTML(listEl, html`<div class="note">Nenhum local cadastrado ainda. Cadastre o primeiro acima — ele já fica selecionado.</div>`);
      return;
    }
    setHTML(listEl, items.length
      ? items.map(({ p }) => html`<button type="button" class="row pick-row" data-pick="${p.id}">${placeThumb(p, 'thumb sm')}<div class="row-main"><div class="row-title">${p.name}</div>${p.address ? html`<div class="row-sub">${p.address}</div>` : ''}</div>${p.id === selectedId ? ic('check', 'i accent') : ''}</button>`)
      : html`<div class="note">Nenhum local encontrado para “${q}”.</div>`);
  };
  render();
  ctl.body.addEventListener('input', (e) => {
    if (e.target.name === 'q') { q = e.target.value; e.target.closest('.search').classList.toggle('has', !!q); render(); }
  });
  ctl.body.addEventListener('click', async (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) { ctl.close(pick.dataset.pick); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear-q') { const i = ctl.body.querySelector('input[name=q]'); i.value = ''; q = ''; i.closest('.search').classList.remove('has'); render(); }
    if (act === 'new-place') {
      const saved = await openPlaceForm({ prefill: { name: q } });
      if (saved?.id) ctl.close(saved.id);
    }
  });
  return ctl.result;
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
      <div class="form-group pad">${segHTML('category', CAT_OPTIONS, p.category || '')}</div>
      <div class="form-group">${switchCell('favorite', 'Favorito', p.favorite, 'star')}</div>
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
        reportResolution(res, vStart);
      }
      if (!res?.policy) toast(prev ? 'Local atualizado' : 'Local salvo', { icon: 'check' });
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
      toast('Local excluído', { icon: 'trash' });
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
  const scheduled = prev ? prev.start != null : true;
  const start = prev?.start ?? prefill.start ?? defaultStart();
  const dur = prev?.start != null ? Math.round((prev.end - prev.start) / MIN) : 120;

  const statusLine = prev && prev.start != null
    ? (prev.status === 'done' ? 'Concluído — está no Histórico.' : prev.status === 'missed' ? 'Marcado como “não aconteceu”.' : '')
    : '';

  const ctl = openSheet({
    title: prev ? 'Editar evento' : 'Novo evento',
    right: 'Salvar',
    body: html`<form class="form" novalidate autocomplete="off">
      <div class="group-label">Local do evento <span class="req">obrigatório</span></div>
      <div class="form-group">${placePickerCell(place)}</div>
      <div class="group-label">Evento</div>
      <div class="form-group">${textCell('name', 'Nome', e.name, { placeholder: 'Opcional — usa o nome do local' })}</div>
      <div class="group-label">Quando</div>
      <div class="form-group">
        ${requireSchedule ? raw('<input type="checkbox" name="schedule" checked hidden>') : switchCell('schedule', 'Agendar', scheduled, 'calendar')}
        <div data-show-when="schedule">${dateTimeCells('e', start)}${durationCell('duration', dur, 'e')}</div>
      </div>
      <div class="group-foot">${statusLine || 'Eventos com horário entram automaticamente na Agenda.'}</div>
      <div class="group-label">Classificação (opcional)</div>
      <div class="form-group pad">${segHTML('category', CAT_OPTIONS, e.category || '')}</div>
      <div class="form-group">${switchCell('favorite', 'Favorito', e.favorite, 'star')}</div>
      ${prev ? deleteButton('Excluir evento') : ''}
    </form>`,
    onRight: async (c) => {
      const f = c.body.querySelector('form');
      const placeId = f.elements.placeId.value;
      if (!placeId) { shake(c.body.querySelector('.picker')); toast('Escolha um local cadastrado', { icon: 'pin' }); return false; }
      const pl = state.places.find((p) => p.id === placeId);
      const name = f.elements.name.value.trim() || pl?.name || 'Evento';
      const data = { id: prev?.id, placeId, name, category: f.elements.category.value || null, favorite: f.elements.favorite.checked, start: null, end: null };
      let res = null;
      let reqStart = null;
      if (f.elements.schedule.checked) {
        reqStart = readStart(f, 'e');
        if (reqStart == null) { toast('Informe data e horário', { icon: 'alert' }); return false; }
        const end = reqStart + Number(f.elements.duration.value) * MIN;
        const sameTime = prev && prev.start === reqStart && prev.end === end;
        if (!sameTime) {
          res = await resolveConflicts({ key: prev ? `event:${prev.id}` : 'new', start: reqStart, end, title: name });
          if (!res) return false;
          data.start = res.start; data.end = res.end;
        } else { data.start = prev.start; data.end = prev.end; }
      }
      const saved = await saveEvent(data);
      if (res) { await applyMoves(res.moves); reportResolution(res, reqStart); }
      if (!res?.policy) toast(prev ? 'Evento atualizado' : 'Evento salvo', { icon: 'check' });
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
      toast('Evento excluído', { icon: 'trash' });
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
  const dur = prev ? Math.round((prev.end - prev.start) / MIN) : 120;

  const ctl = openSheet({
    title: prev ? 'Editar visita' : 'Agendar visita',
    right: 'Salvar',
    body: html`<form class="form" novalidate autocomplete="off">
      <div class="group-label">Local <span class="req">obrigatório</span></div>
      <div class="form-group">${placePickerCell(place)}</div>
      <div class="group-label">Quando</div>
      <div class="form-group">${dateTimeCells('v', start)}${durationCell('duration', dur, 'v')}</div>
      <div class="group-foot">Quando o horário passar sem alterações, o local é marcado como visitado e vai para o Histórico.</div>
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
      if (!(prev && prev.start === s && prev.end === end)) {
        res = await resolveConflicts({ key: prev ? `visit:${prev.id}` : 'new', start: s, end, title: pl?.name || 'Visita' });
        if (!res) return false;
      }
      const saved = await saveVisit({ id: prev?.id, placeId: pid, start: res.start, end: res.end });
      await applyMoves(res.moves);
      reportResolution(res, s);
      if (!res.policy) toast(prev ? 'Visita atualizada' : 'Visita agendada', { icon: 'check' });
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
      toast('Visita excluída', { icon: 'trash' });
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
  const onceEnd = prev?.kind === 'once' && prev.end ? prev.end : pStart + 60 * MIN;
  const startDate = prev?.startDate || dateKey(Date.now());
  const untilDate = prev?.untilDate || '';
  const REC = 'kind=daily|weekly|monthly';

  const ctl = openSheet({
    title: prev ? 'Editar compromisso' : 'Novo compromisso',
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
      ${prev ? deleteButton('Excluir compromisso') : ''}
    </form>`,
    onRight: async (c) => {
      const f = c.body.querySelector('form');
      const name = f.elements.name.value.trim();
      if (!name) { shake(f.elements.name.closest('.cell')); toast('Dê um nome ao compromisso', { icon: 'alert' }); return false; }
      const k = f.elements.kind.value;
      const data = { id: prev?.id, name, kind: k };
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
        toast(prev ? 'Compromisso atualizado' : 'Compromisso salvo', { icon: 'check' });
        return saved;
      }
      const s = readStart(f, 'o');
      const endMin = parseHM(f.elements.oEnd.value);
      if (s == null || endMin == null) { toast('Informe data, início e fim', { icon: 'alert' }); return false; }
      let end = atMinutes(dateKey(s), endMin);
      if (end <= s) end += DAY;
      let res = { start: s, end, moves: [], policy: null };
      if (!(prev && prev.kind === 'once' && prev.start === s && prev.end === end)) {
        res = await resolveConflicts({ key: prev ? `commitment:${prev.id}:once` : 'new', start: s, end, title: name });
        if (!res) return false;
      }
      const saved = await saveCommitment({ ...data, start: res.start, end: res.end, status: null });
      await applyMoves(res.moves);
      reportResolution(res, s);
      if (!res.policy) toast(prev ? 'Compromisso atualizado' : 'Compromisso salvo', { icon: 'check' });
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
      toast('Compromisso excluído', { icon: 'trash' });
      ctl.close();
    }
  });
  return ctl.result;
}

// ---------- horário avulso (só título e hora) ----------

export function openItemForm({ id = null, prefill = {} } = {}) {
  const prev = id ? state.items.find((i) => i.id === id) : null;
  const start = prev?.start ?? prefill.start ?? defaultStart();
  const dur = prev ? Math.round((prev.end - prev.start) / MIN) : 60;
  const ctl = openSheet({
    title: prev ? 'Editar horário' : 'Horário avulso',
    right: 'Salvar',
    body: html`<form class="form" novalidate autocomplete="off">
      <div class="form-group">
        ${textCell('title', 'Título', prev?.title || '', { placeholder: 'Ex.: Shopping Leblon, comprar roupa', required: true })}
        ${textCell('note', 'Obs.', prev?.note || '', { placeholder: 'Opcional', multiline: true })}
      </div>
      <div class="group-label">Quando</div>
      <div class="form-group">${dateTimeCells('i', start)}${durationCell('duration', dur, 'i')}</div>
      <div class="group-foot">Só um título e um horário na agenda — sem precisar cadastrar local, evento ou compromisso.</div>
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
      if (!(prev && prev.start === s && prev.end === end)) {
        res = await resolveConflicts({ key: prev ? `item:${prev.id}` : 'new', start: s, end, title });
        if (!res) return false;
      }
      const saved = await saveItem({ id: prev?.id, title, note: f.elements.note.value.trim(), start: res.start, end: res.end });
      await applyMoves(res.moves);
      reportResolution(res, s);
      if (!res.policy) toast(prev ? 'Horário atualizado' : 'Adicionado à agenda', { icon: 'check' });
      return saved;
    },
  });
  bindFormWidgets(ctl.body);
  ctl.body.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-act="delete"]') && prev) {
      const ok = await confirmDialog({ title: `Excluir “${prev.title}”?`, message: 'Ele sai da agenda. O histórico é mantido.', ok: 'Excluir', destructive: true });
      if (!ok) return;
      await deleteItem(prev.id);
      toast('Horário excluído', { icon: 'trash' });
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
