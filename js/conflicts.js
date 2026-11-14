// Aviso e resolução de horários sobrepostos.
import { state, applyMoves } from './store.js';
import { expand, findConflicts, planPushExisting, planPushNew, commitmentOccs, overlaps } from './schedule.js';
import { actionSheet, alertDialog, toast, esc } from './ui.js';
import { DAY, fmtHM, fmtRange, dayLabel } from './time.js';

const POLICY_LABEL = {
  'push-existing': 'Adiar o que já estava marcado',
  'push-new': 'Colocar o novo depois',
  overlap: 'Manter sobreposto',
};

function conflictListHtml(conflicts) {
  return conflicts.slice(0, 4).map((o) => `<div class="cf-item k-${o.kind}"><b>${esc(o.title)}</b> · ${esc(dayLabel(o.start))} ${esc(fmtRange(o.start, o.end))}</div>`).join('')
    + (conflicts.length > 4 ? `<div class="cf-more">+${conflicts.length - 4} outros</div>` : '');
}

/**
 * cand: { key, start, end, title }
 * -> null (cancelado) | { start, end, moves: [{occ,start,end}], policy }
 */
export async function resolveConflicts(cand) {
  const occs = expand(state, cand.start - DAY, cand.end + 21 * DAY);
  const conflicts = findConflicts(occs, cand);
  if (!conflicts.length) return { start: cand.start, end: cand.end, moves: [], policy: null };

  let policy = state.settings.conflictPolicy;
  if (policy === 'ask') {
    policy = await actionSheet({
      title: 'Conflito de horário',
      messageHtml: `<div class="cf-lead">“${esc(cand.title)}” (${esc(fmtRange(cand.start, cand.end))}) bate com:</div>${conflictListHtml(conflicts)}`,
      actions: [
        { label: POLICY_LABEL['push-existing'], value: 'push-existing', icon: 'forward' },
        { label: `Colocar “${cand.title}” depois`, value: 'push-new', icon: 'clock' },
        { label: POLICY_LABEL.overlap, value: 'overlap', icon: 'list' },
      ],
    });
    if (!policy) return null;
  }
  if (policy === 'push-new') {
    const r = planPushNew(occs, cand);
    return { ...r, moves: [], policy };
  }
  if (policy === 'push-existing') {
    return { start: cand.start, end: cand.end, moves: planPushExisting(occs, cand), policy };
  }
  return { start: cand.start, end: cand.end, moves: [], policy: 'overlap' };
}

export function reportResolution(res, requestedStart) {
  if (!res) return;
  if (res.moves.length) toast(`${res.moves.length === 1 ? '1 item adiado' : `${res.moves.length} itens adiados`} para abrir espaço`, { icon: 'forward' });
  else if (res.policy === 'push-new' && res.start !== requestedStart) toast(`Encaixado às ${fmtHM(res.start)} (${dayLabel(res.start)})`, { icon: 'clock' });
  else if (res.policy === 'overlap') toast('Salvo com sobreposição', { icon: 'alert' });
}

/** move uma ocorrência existente, tratando conflitos */
export async function moveWithConflicts(occ, start, end) {
  const res = await resolveConflicts({ key: occ.key, start, end, title: occ.title });
  if (!res) return false;
  await applyMoves([{ occ, start: res.start, end: res.end }, ...res.moves]);
  if (res.policy) reportResolution(res, start);
  return res;
}

/** Para compromissos semanais: avisa se a série vai bater com algo nos próximos 14 dias. */
export async function confirmSeries(commitment) {
  const now = Date.now();
  const mine = commitmentOccs({ ...commitment, createdAt: now }, now, now + 14 * DAY, now);
  const others = expand({ ...state, commitments: state.commitments.filter((c) => c.id !== commitment.id) }, now, now + 15 * DAY, now)
    .filter((o) => o.status !== 'done' && o.status !== 'missed');
  const hits = [];
  for (const m of mine) for (const o of others) if (overlaps(m, o)) hits.push({ m, o });
  if (!hits.length) return true;
  const lines = hits.slice(0, 3).map(({ m, o }) => `${dayLabel(m.start)} ${fmtHM(m.start)}: ${o.title}`).join('\n');
  return alertDialog({
    title: 'Sobreposição na agenda',
    message: `Este compromisso vai coincidir com:\n${lines}${hits.length > 3 ? `\n+${hits.length - 3} outros` : ''}\n\nVocê pode ajustar cada semana depois, na Agenda.`,
    buttons: [{ label: 'Voltar', value: false, style: 'cancel' }, { label: 'Salvar assim', value: true, style: 'strong' }],
  });
}
