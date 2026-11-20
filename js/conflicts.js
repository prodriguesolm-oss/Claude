// Aviso e resolução de horários sobrepostos.
//
// Padrão ('ask'): pergunta o que fazer, mostrando a prévia de cada opção:
//  - adiar tudo o que vem depois (cascata, só naquele dia)
//  - só atrasar o início do próximo / adiantar o fim do anterior (o vizinho encolhe, o resto não muda)
//  - colocar o novo depois (fora do arraste) · manter sobreposto
// Nos Ajustes dá para fixar uma dessas escolhas.
import { state, applyMoves } from './store.js';
import { expand, findConflicts, planPushExisting, planPushNew, planCascade, planTrim, commitmentOccs, overlaps } from './schedule.js';
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

const short = (t) => (t.length > 22 ? `${t.slice(0, 21)}…` : t);

/** "Almoço → 13:15 · Reunião → 14:15" */
function describeMoves(moves, max = 2) {
  const parts = moves.slice(0, max).map((m) => {
    const changedStart = m.start !== m.occ.start;
    const changedEnd = m.end !== m.occ.end;
    if (changedStart && changedEnd) return `${short(m.occ.title)} → ${fmtHM(m.start)}`;
    return `${short(m.occ.title)} fica ${fmtRange(m.start, m.end)}`;
  });
  return parts.join(' · ') + (moves.length > max ? ` · +${moves.length - max}` : '');
}

function trimLabel(moves) {
  const after = moves.filter((m) => m.start !== m.occ.start);
  const before = moves.filter((m) => m.end !== m.occ.end);
  if (after.length && !before.length) return after.length === 1 ? `Só atrasar o início de “${short(after[0].occ.title)}”` : 'Só atrasar o início dos próximos';
  if (before.length && !after.length) return before.length === 1 ? `Só adiantar o fim de “${short(before[0].occ.title)}”` : 'Só adiantar o fim dos anteriores';
  return 'Só encurtar os vizinhos';
}

/**
 * cand: { key, start, end, title, optGroup? }
 * opts.prev: intervalo anterior do item (ao mover/redimensionar) — o que já estava sobreposto a ele continua como estava.
 * opts.drag: mudança feita arrastando na agenda (nunca tira o item de onde foi solto).
 * -> null (cancelado) | { start, end, moves: [{occ,start,end}], policy, leftover: [ocorrências que ficaram sobrepostas] }
 */
export async function resolveConflicts(cand, { prev = null, drag = false } = {}) {
  const occs = expand(state, cand.start - DAY, cand.end + 21 * DAY);
  const conflicts = findConflicts(occs, cand).filter((o) => !(prev && overlaps(o, prev)));
  if (!conflicts.length) return { start: cand.start, end: cand.end, moves: [], policy: null, leftover: [] };

  const until = endOfDay(cand.start);
  const notMoved = (moves) => conflicts.filter((c) => !moves.some((m) => m.occ.key === c.key));
  const plans = {
    cascade() {
      const moves = planCascade(occs, cand, { until, prev });
      return { start: cand.start, end: cand.end, moves, policy: 'cascade', leftover: notMoved(moves) };
    },
    trim() {
      const moves = planTrim(occs, cand, { prev });
      return moves ? { start: cand.start, end: cand.end, moves, policy: 'trim', leftover: notMoved(moves) } : null;
    },
    'push-new'() {
      return { ...planPushNew(occs, cand), moves: [], policy: 'push-new', leftover: [] };
    },
    'push-existing'() {
      // empurra tudo que colidir (do mesmo dia), inclusive o que começou antes
      const sameDay = occs.filter((o) => o.start < until && !(prev && overlaps(o, prev)));
      const moves = planPushExisting(sameDay, cand);
      return { start: cand.start, end: cand.end, moves, policy: 'push-existing', leftover: notMoved(moves) };
    },
    overlap() {
      return { start: cand.start, end: cand.end, moves: [], policy: 'overlap', leftover: conflicts };
    },
  };

  let policy = state.settings.conflictPolicy;
  if (policy === 'push-existing') policy = 'cascade'; // nome antigo da opção
  if (drag && policy === 'push-new') policy = 'cascade'; // arrastando, o item fica onde foi solto
  if (policy !== 'ask' && plans[policy]) {
    const r = plans[policy]();
    if (r) return r; // 'trim' impossível neste caso -> pergunta
  }

  // pergunta, mostrando o que cada escolha faz
  const cas = plans.cascade();
  const tr = plans.trim();
  const pn = drag ? null : plans['push-new']();
  const actions = [];
  if (cas.moves.length) {
    actions.push({
      label: 'Adiar tudo o que vem depois', value: 'cascade', icon: 'forward',
      hint: `${describeMoves(cas.moves)}${cas.leftover.length ? ` · “${short(cas.leftover[0].title)}” continua sobreposto` : ''}`,
    });
  }
  if (tr) actions.push({ label: trimLabel(tr.moves), value: 'trim', icon: 'scissors', hint: `${describeMoves(tr.moves)} · o resto não muda` });
  if (pn && pn.start !== cand.start) actions.push({ label: `Colocar “${short(cand.title)}” depois`, value: 'push-new', icon: 'clock', hint: `${dayLabel(pn.start)} ${fmtRange(pn.start, pn.end)}` });
  actions.push({ label: 'Manter sobreposto', value: 'overlap', icon: 'list', hint: 'Os dois ficam no mesmo horário, com aviso' });

  const v = await actionSheet({
    title: 'Isso vai bater com outro horário',
    messageHtml: `<div class="cf-lead">“${esc(cand.title)}” (${esc(fmtRange(cand.start, cand.end))}) vai cobrir:</div>${conflictListHtml(conflicts)}`,
    actions,
    cancel: drag ? 'Cancelar (volta como estava)' : 'Cancelar',
  });
  if (!v) return null;
  if (v === 'cascade') return cas;
  if (v === 'trim') return tr;
  if (v === 'push-new') return pn;
  return plans.overlap();
}

/** "2 itens adiados", "Terapia fica 09:30–10:00", "sobreposto com Trabalho" — pedaços de texto para os avisos */
export function resolutionNotes(res) {
  const notes = [];
  if (!res) return notes;
  if (res.moves.length) {
    if (res.policy === 'trim') notes.push(res.moves.length === 1 ? `${short(res.moves[0].occ.title)} fica ${fmtRange(res.moves[0].start, res.moves[0].end)}` : `${res.moves.length} itens encurtados`);
    else notes.push(res.moves.length === 1 ? '1 item adiado' : `${res.moves.length} itens adiados`);
  }
  if (res.leftover?.length) notes.push(`sobreposto com ${short(res.leftover[0].title)}${res.leftover.length > 1 ? ` +${res.leftover.length - 1}` : ''}`);
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
  const text = res.moves.length && res.policy !== 'trim' ? `${notes[0]} para abrir espaço${notes[1] ? ` · ${notes[1]}` : ''}` : `Salvo · ${notes.join(' · ')}`;
  toast(text, { icon: res.leftover?.length ? 'alert' : res.policy === 'trim' ? 'scissors' : 'forward', ms: 3200 });
}

/**
 * Move/redimensiona uma ocorrência existente, tratando conflitos.
 * Retorna false (cancelado) ou { start, end, moves, policy, leftover }.
 * opts.quiet: não mostra aviso (quem chamou mostra o seu).
 */
export async function moveWithConflicts(occ, start, end, { drag = false, quiet = false } = {}) {
  const res = await resolveConflicts({ key: occ.key, start, end, title: occ.title, optGroup: occ.opt?.g }, { prev: { start: occ.start, end: occ.end }, drag });
  if (!res) return false;
  await applyMoves([{ occ, start: res.start, end: res.end }, ...res.moves]);
  if (res.policy && !quiet) reportResolution(res, start);
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
