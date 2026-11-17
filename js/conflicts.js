// Aviso e resolução de horários sobrepostos.
//
// Política padrão ('cascade'): o item mexido fica onde você colocou e o que vem DEPOIS dele,
// no mesmo dia, é adiado em cascata. O que começou antes não é empurrado (fica sobreposto, com aviso)
// e os outros dias não são tocados.
import { state, applyMoves } from './store.js';
import { expand, findConflicts, planPushExisting, planPushNew, planCascade, commitmentOccs, overlaps } from './schedule.js';
import { actionSheet, alertDialog, toast, esc } from './ui.js';
import { DAY, fmtHM, fmtRange, dayLabel, startOfDay, addDays } from './time.js';

const POLICY_LABEL = {
  'push-existing': 'Adiar o que já estava marcado',
  'push-new': 'Colocar o novo depois',
  overlap: 'Manter sobreposto',
};

const endOfDay = (t) => addDays(startOfDay(t), 1);

function conflictListHtml(conflicts) {
  return conflicts.slice(0, 4).map((o) => `<div class="cf-item k-${o.kind}"><b>${esc(o.title)}</b> · ${esc(dayLabel(o.start))} ${esc(fmtRange(o.start, o.end))}</div>`).join('')
    + (conflicts.length > 4 ? `<div class="cf-more">+${conflicts.length - 4} outros</div>` : '');
}

/**
 * cand: { key, start, end, title }
 * opts.prev: intervalo anterior do item (ao mover/redimensionar) — o que já estava sobreposto a ele continua como estava.
 * opts.drag: mudança feita arrastando na agenda (nunca tira o item de onde foi solto).
 * -> null (cancelado) | { start, end, moves: [{occ,start,end}], policy, leftover: [ocorrências que ficaram sobrepostas] }
 */
export async function resolveConflicts(cand, { prev = null, drag = false } = {}) {
  const occs = expand(state, cand.start - DAY, cand.end + 21 * DAY);
  const conflicts = findConflicts(occs, cand).filter((o) => !(prev && overlaps(o, prev)));
  if (!conflicts.length) return { start: cand.start, end: cand.end, moves: [], policy: null, leftover: [] };

  let policy = state.settings.conflictPolicy;
  if (policy === 'push-existing') policy = 'cascade'; // nome antigo da opção
  if (drag && policy === 'push-new') policy = 'cascade'; // arrastando, o item fica onde foi solto
  if (policy === 'ask') {
    policy = await actionSheet({
      title: 'Conflito de horário',
      messageHtml: `<div class="cf-lead">“${esc(cand.title)}” (${esc(fmtRange(cand.start, cand.end))}) bate com:</div>${conflictListHtml(conflicts)}`,
      actions: [
        { label: POLICY_LABEL['push-existing'], value: 'push-existing', icon: 'forward' },
        ...(drag ? [] : [{ label: `Colocar “${cand.title}” depois`, value: 'push-new', icon: 'clock' }]),
        { label: POLICY_LABEL.overlap, value: 'overlap', icon: 'list' },
      ],
    });
    if (!policy) return null;
  }
  const until = endOfDay(cand.start);
  if (policy === 'cascade') {
    const moves = planCascade(occs, cand, { until, prev });
    const leftover = conflicts.filter((c) => !moves.some((m) => m.occ.key === c.key));
    return { start: cand.start, end: cand.end, moves, policy, leftover };
  }
  if (policy === 'push-new') {
    const r = planPushNew(occs, cand);
    return { ...r, moves: [], policy, leftover: [] };
  }
  if (policy === 'push-existing') {
    // escolhido na pergunta: empurra tudo que colidir (do mesmo dia), inclusive o que começou antes
    const sameDay = occs.filter((o) => o.start < until && !(prev && overlaps(o, prev)));
    const moves = planPushExisting(sameDay, cand);
    const leftover = conflicts.filter((c) => !moves.some((m) => m.occ.key === c.key));
    return { start: cand.start, end: cand.end, moves, policy, leftover };
  }
  return { start: cand.start, end: cand.end, moves: [], policy: 'overlap', leftover: conflicts };
}

/** "2 itens adiados", "sobreposto com Trabalho" — pedaços de texto para os avisos */
export function resolutionNotes(res) {
  const notes = [];
  if (!res) return notes;
  if (res.moves.length) notes.push(res.moves.length === 1 ? '1 item adiado' : `${res.moves.length} itens adiados`);
  if (res.leftover?.length) notes.push(`sobreposto com ${res.leftover[0].title}${res.leftover.length > 1 ? ` +${res.leftover.length - 1}` : ''}`);
  return notes;
}

export function reportResolution(res, requestedStart) {
  if (!res || !res.policy) return;
  if (res.policy === 'push-new') {
    if (res.start !== requestedStart) toast(`Encaixado às ${fmtHM(res.start)} (${dayLabel(res.start)})`, { icon: 'clock' });
    return;
  }
  const notes = resolutionNotes(res);
  if (!notes.length) return;
  const text = res.moves.length ? `${notes[0]} para abrir espaço${notes[1] ? ` · ${notes[1]}` : ''}` : `Salvo · ${notes[0]}`;
  toast(text, { icon: res.leftover?.length ? 'alert' : 'forward', ms: 3200 });
}

/**
 * Move/redimensiona uma ocorrência existente, tratando conflitos.
 * Retorna false (cancelado) ou { start, end, moves, policy, leftover, undo }.
 * opts.quiet: não mostra aviso (quem chamou mostra o seu, ex.: com "Desfazer").
 */
export async function moveWithConflicts(occ, start, end, { drag = false, quiet = false } = {}) {
  const res = await resolveConflicts({ key: occ.key, start, end, title: occ.title }, { prev: { start: occ.start, end: occ.end }, drag });
  if (!res) return false;
  const undo = await applyMoves([{ occ, start: res.start, end: res.end }, ...res.moves]);
  if (res.policy && !quiet) reportResolution(res, start);
  return { ...res, undo };
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
