// Linhas de lista compartilhadas entre as abas + ações comuns (favoritar, visitado, abrir).
import { html, ic, toast } from './ui.js';
import { state, toggleFavorite, toggleDate, setPlaceVisited, setEventDone } from './store.js';
import { placeThumb, catBadge, starBtn, dateBtn } from './widgets.js';
import { dayLabel, fmtHM, fmtRange, MONTHS_SHORT, WD_CAP, fmtMin, fmtDateShort, dateKey, parseDateKey } from './time.js';
import { nextOccurrence, FREQ_LABEL, colorOf } from './schedule.js';
import { KIND_ICON } from './icons.js';
import { haptic } from './util.js';
import { openPlaceDetail } from './sheets.js';
import { openEventForm, openCommitmentForm } from './forms.js';

export const STATUS_LABEL = { planned: 'Agendado', ongoing: 'Agora', done: 'Concluído', missed: 'Não aconteceu', choose: 'Escolha a opção' };

/** próximo evento/visita agendado de cada local */
export function upcomingByPlace(now = Date.now()) {
  const m = new Map();
  for (const x of [...state.events, ...state.visits]) {
    if (x.start == null || x.end <= now || x.status === 'missed' || x.status === 'done') continue;
    const cur = m.get(x.placeId);
    if (!cur || x.start < cur.start) m.set(x.placeId, x);
  }
  return m;
}

export function placeRow(p, upcoming) {
  return html`<div class="row" data-act="open-place" data-id="${p.id}" role="button" tabindex="0">
    ${placeThumb(p)}
    <div class="row-main">
      <div class="row-title">${p.name}</div>
      ${p.address ? html`<div class="row-sub">${p.address}</div>` : ''}
      <div class="row-meta">${catBadge(p.category)}${p.visited ? html`<span class="badge ok">${ic('check', 'i xs')} Visitado${p.visitedAt ? ` · ${fmtDateShort(p.visitedAt)}` : ''}</span>` : ''}${upcoming ? html`<span class="badge info">${ic('calendar', 'i xs')} ${dayLabel(upcoming.start)} ${fmtHM(upcoming.start)}</span>` : ''}</div>
    </div>
    <div class="tgls v">
      ${starBtn('place', p)}
      ${dateBtn('place', p)}
      <button type="button" class="tgl check ${p.visited ? 'on' : ''}" data-act="visited" data-id="${p.id}" aria-label="${p.visited ? 'Desmarcar visitado' : 'Marcar como visitado'}" aria-pressed="${p.visited ? 'true' : 'false'}">${ic(p.visited ? 'checkCircleFill' : 'checkCircle')}</button>
    </div>
  </div>`;
}

export function eventRow(e, now = Date.now()) {
  const p = state.places.find((x) => x.id === e.placeId);
  const sched = e.start != null;
  const done = e.status === 'done' || (sched && e.end <= now && e.status !== 'missed');
  const live = sched && !done && e.start <= now && e.end > now;
  return html`<div class="row" data-act="open-event" data-id="${e.id}" role="button" tabindex="0">
    ${p ? placeThumb(p) : html`<span class="thumb ph empty-ph">${ic('ticket', 'i sm')}</span>`}
    <div class="row-main">
      <div class="row-title">${e.name}</div>
      <div class="row-sub">${ic('pin', 'i xs')} ${p?.name || 'Local removido'}</div>
      <div class="row-meta">${sched ? html`<span class="badge ${done ? '' : 'info'}">${ic('calendar', 'i xs')} ${dayLabel(e.start, now)}${dayLabel(e.start, now).includes(',') ? '' : `, ${new Date(e.start).getDate()} ${MONTHS_SHORT[new Date(e.start).getMonth()]}`} · ${fmtHM(e.start)}</span>` : html`<span class="badge">sem data</span>`}${catBadge(e.category || p?.category)}${e.status === 'missed' ? html`<span class="badge">Não aconteceu</span>` : ''}${live ? html`<span class="badge live">Agora</span>` : ''}</div>
    </div>
    <div class="tgls v">${starBtn('event', e)}${dateBtn('event', e)}
      <button type="button" class="tgl check ${done ? 'on' : ''}" data-act="event-done" data-id="${e.id}" aria-label="${done ? 'Desmarcar feito' : 'Marcar como feito'}" aria-pressed="${done ? 'true' : 'false'}">${ic(done ? 'checkCircleFill' : 'checkCircle')}</button>
    </div>
  </div>`;
}

export function daysLabel(days) {
  const s = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (s.length === 7) return 'Todos os dias';
  const k = s.join(',');
  if (k === '1,2,3,4,5') return 'Seg a Sex';
  if (k === '1,2,3,4,5,6') return 'Seg a Sáb';
  if (k === '6,0') return 'Sáb e Dom';
  const names = s.map((d) => WD_CAP[d]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}` : names[0] || '';
}

export function monthDaysLabel(md = []) {
  const s = [...md].sort((a, b) => a - b);
  if (!s.length) return '';
  return s.length === 1 ? `Dia ${s[0]}` : `Dias ${s.slice(0, -1).join(', ')} e ${s[s.length - 1]}`;
}

/** resumo dos horários de um compromisso recorrente: "Seg e Qui 06:30–07:30 · Ter 10:00–11:00" */
export function slotsSummary(c) {
  const slots = c?.slots || [];
  const t = (s) => `${fmtMin(s.startMin)}–${fmtMin(s.endMin)}`;
  if (c.kind === 'daily') return `Todo dia · ${slots.map(t).join(', ')}`;
  if (c.kind === 'monthly') return slots.map((s) => `${monthDaysLabel(s.monthDays)} · ${t(s)}`).join(' | ');
  return slots.map((s) => `${daysLabel(s.days || [])} ${t(s)}`).join(' · ');
}

/** linha de compromisso: lista compacta (horário · nome · resumo · quando é o próximo) */
export function commitmentRow(c, now = Date.now()) {
  const once = c.kind === 'once';
  const next = once ? (c.start != null && c.end > now ? { start: c.start, end: c.end } : null) : nextOccurrence(c, now);
  const ended = once ? !next : (c.untilDate && c.untilDate < dateKey(now));
  const ref = next || (once && c.start != null ? { start: c.start, end: c.end } : null) || (c.slots?.[0] ? { startMin: c.slots[0].startMin, endMin: c.slots[0].endMin } : null);
  const tStart = ref ? (ref.start != null ? fmtHM(ref.start) : fmtMin(ref.startMin)) : '--:--';
  const tEnd = ref ? (ref.end != null ? fmtHM(ref.end) : fmtMin(ref.endMin)) : '';
  const summary = once ? (c.start != null ? `${dayLabel(c.start, now)} · ${fmtRange(c.start, c.end)}` : '—') : slotsSummary(c);
  const until = !once && c.untilDate && !ended ? ` · até ${fmtDateShort(parseDateKey(c.untilDate).getTime(), now)}` : '';
  return html`<div class="row crow ${ended ? 'ended' : ''}" data-act="open-commitment" data-id="${c.id}" role="button" tabindex="0">
    <span class="crow-bar f-${c.kind}"></span>
    <div class="occ-times"><b>${tStart}</b><span>${tEnd}</span></div>
    <div class="row-main">
      <div class="row-title">${c.name}</div>
      <div class="row-sub">${summary}${until}</div>
    </div>
    <div class="crow-next">${ended ? html`<span>Encerrado</span>` : next ? html`<b>${dayLabel(next.start, now)}</b><span>${fmtHM(next.start)}</span>` : ''}</div>
    ${ic('chevR', 'i sm muted')}
  </div>`;
}

export function occRow(o) {
  const sub = o.kind === 'commitment' ? (o.recurring ? `Compromisso ${(FREQ_LABEL[o.freq] || '').toLowerCase()}` : 'Compromisso')
    : o.kind === 'event' ? o.subtitle
      : o.kind === 'item' ? (o.subtitle ? `Avulso · ${o.subtitle}` : 'Horário avulso')
        : 'Visita ao local';
  return html`<button type="button" class="row occ-row st-${o.status}" data-key="${o.key}">
    <span class="occ-bar c-${colorOf(o)}"></span>
    <div class="occ-times"><b>${fmtHM(o.start)}</b><span>${fmtHM(o.end)}</span></div>
    <div class="row-main"><div class="row-title">${o.opt && o.opt.of > 1 ? html`<span class="opt-tag">${o.opt.letter}</span>` : ''}${o.title}</div><div class="row-sub">${ic(KIND_ICON[o.kind], 'i xs')} ${sub}${o.overridden ? ' · alterado só desta vez' : ''}</div></div>
    ${o.status === 'done' ? ic('checkCircleFill', 'i ok') : o.status === 'missed' ? ic('ban', 'i muted') : o.status === 'ongoing' ? html`<span class="badge live">Agora</span>` : ''}
  </button>`;
}

/** trata cliques comuns em linhas; retorna true se tratou */
export async function handleRowAction(t) {
  const { act, id } = t.dataset;
  switch (act) {
    case 'fav': {
      await toggleFavorite(t.dataset.kind, id);
      haptic();
      return true;
    }
    case 'date': {
      await toggleDate(t.dataset.kind, id);
      haptic();
      return true;
    }
    case 'visited': {
      const p = state.places.find((x) => x.id === id);
      if (!p) return true;
      await setPlaceVisited(id, !p.visited);
      haptic();
      return true;
    }
    case 'event-done': {
      const e = state.events.find((x) => x.id === id);
      if (!e) return true;
      const done = e.status === 'done' || (e.start != null && e.end <= Date.now() && e.status !== 'missed');
      await setEventDone(id, !done);
      haptic();
      return true;
    }
    case 'open-place': openPlaceDetail(id); return true;
    case 'open-event': openEventForm({ id }); return true;
    case 'open-commitment': openCommitmentForm({ id }); return true;
    default: return false;
  }
}
