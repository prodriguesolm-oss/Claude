// Reorganizar a agenda: Plano B (opções para o mesmo horário), tirar da agenda deslizando,
// "o que você fez nesse horário?", fechar espaços (adiantar o que vem depois) e "terminei antes".
import { state, removeFromAgenda, applyMoves, keepOnlyOption } from './store.js';
import { expand, gapAfter, planPull, SCOPE_LABEL } from './schedule.js';
import { actionSheet, toast, esc } from './ui.js'; // toast só para dicas de uso, nunca para anunciar mudanças (há ↶ ↷)
import { openVisitForm, openEventForm, openItemForm, openCommitmentForm, openPlacePicker, openEventPicker } from './forms.js';
import { MIN, fmtHM, fmtRange, fmtDur, dayLabel, startOfDay, addDays } from './time.js';

const endOfDay = (t) => addDays(startOfDay(t), 1);
const short = (t) => (t.length > 24 ? `${t.slice(0, 23)}…` : t);
const LETTERS = 'ABCDEFGHIJ';

// ---------- "adiantar" depois de encurtar: botão dentro do espaço livre da agenda ----------
let gapHint = null; // { from, excludeKey }
const gapSubs = new Set();
export const getGapHint = () => gapHint;
export function setGapHint(h) {
  gapHint = h;
  for (const fn of [...gapSubs]) fn(h);
}
export function onGapHint(fn) { gapSubs.add(fn); return () => gapSubs.delete(fn); }

export const KIND_ACTIONS = [
  { label: 'Horário avulso (só título)', value: 'item', icon: 'note' },
  { label: 'Local (visita)', value: 'visit', icon: 'pin' },
  { label: 'Evento', value: 'event', icon: 'ticket' },
  { label: 'Compromisso', value: 'commitment', icon: 'repeat' },
];

/**
 * Adicionar algo num horário: Local e Evento abrem a escolha com busca e filtros
 * (como nas abas Locais/Eventos) e depois o formulário já com o horário.
 * prefill: { start, end?, optionOf?, replacing? }
 */
export async function addInSlot(kind, prefill) {
  const planB = !!prefill.optionOf;
  if (kind === 'item') return openItemForm({ prefill });
  if (kind === 'visit') {
    const id = await openPlacePicker(null, { title: planB ? 'Plano B: escolher local' : 'Escolher local' });
    if (!id) return null;
    return openVisitForm({ prefill: { ...prefill, placeId: id } });
  }
  if (kind === 'event') {
    const id = await openEventPicker({ title: planB ? 'Plano B: escolher evento' : 'Escolher evento' });
    if (!id) return null;
    return openEventForm({ id: id === 'new' ? null : id, prefill, requireSchedule: true });
  }
  if (kind === 'commitment') {
    // como Plano B ou para preencher um horário passado, faz sentido um compromisso único
    return openCommitmentForm({ prefill: { ...prefill, kind: planB || prefill.replacing ? 'once' : prefill.kind } });
  }
  return null;
}

/** toque triplo (ou botão na ficha): cria mais uma opção para o mesmo horário */
export async function offerPlanB(occ) {
  if (occ.status === 'done' || occ.status === 'missed') {
    toast('Isso já aconteceu — para trocar pelo que você fez, deslize o bloco para a esquerda', { icon: 'swap', ms: 4200 });
    return null;
  }
  const next = occ.opt ? LETTERS[occ.opt.of] || '?' : 'B';
  const v = await actionSheet({
    title: occ.opt ? `Mais uma opção (Opção ${next})` : 'Criar um Plano B para este horário?',
    messageHtml: `Para “${esc(occ.title)}” · ${esc(dayLabel(occ.start))} ${esc(fmtRange(occ.start, occ.end))}.<br>As opções ficam lado a lado (Opção A, B…) sem aviso de sobreposição. Depois, deslize para a esquerda a que você não fez.`,
    actions: KIND_ACTIONS.map((a) => ({ ...a, label: `Opção ${next}: ${a.label.replace(' (só título)', '')}` })),
  });
  if (!v) return null;
  return addInSlot(v, { start: occ.start, end: occ.end, optionOf: occ });
}

/** "fiz esta opção": deixa só ela */
export async function keepOnly(occ) {
  return keepOnlyOption(occ);
}

/**
 * Deslizou um bloco para a esquerda: tira da agenda.
 * - Opção de Plano B: sai e, se sobrar uma, ela vira o item normal (é o que você fez).
 * - Item que já tinha acontecido: sai do Histórico e o app pergunta o que você fez no lugar.
 * - Item futuro: sai (com Desfazer).
 */
export async function swipeRemove(occ) {
  const wasDone = occ.status === 'done';
  const isOption = !!occ.opt && occ.opt.of > 1;
  const { remaining } = await removeFromAgenda(occ);
  if (wasDone && !isOption) {
    const scope = occ.recurring ? ` (só ${SCOPE_LABEL[occ.freq] || 'desta vez'})` : '';
    const from = occ.kind === 'commitment' ? 'da agenda' : 'da agenda e do Histórico';
    const v = await actionSheet({
      title: 'O que você fez nesse horário?',
      message: `“${occ.title}” saiu ${from}${scope}. Registre o que fez de ${fmtRange(occ.start, occ.end)} (${dayLabel(occ.start)}) para o Histórico ficar certinho.`,
      actions: KIND_ACTIONS,
      cancel: 'Nada — deixar vazio',
    });
    if (v) await addInSlot(v, { start: occ.start, end: occ.end, replacing: true });
  }
  return { remaining };
}

// ---------- fechar espaços ("adiantar") ----------

/** espaço livre logo depois de `t` no mesmo dia (entre 5 min e 4 h), com o próximo item */
export function findGap(t, { excludeKey = null, minGap = 5 * MIN, maxGap = 4 * 60 * MIN } = {}) {
  const occs = expand(state, startOfDay(t), endOfDay(t));
  const g = gapAfter(occs, t, { until: endOfDay(t), excludeKey });
  if (!g || g.gap < minGap || g.gap > maxGap) return null;
  return { ...g, occs };
}

/** opções "adiantar" para um espaço (para o menu de um horário vazio e para a folha do espaço) */
export function pullActions(g) {
  const all = planPull(g.occs, g.next, g.gap, { all: true, until: endOfDay(g.next.start) });
  const mins = fmtDur(g.gap / MIN);
  const acts = [{ label: `Adiantar só “${short(g.next.title)}”`, hint: `vai para ${fmtHM(g.next.start - g.gap)} (${mins} mais cedo)`, value: 'pull-next', icon: 'arrowUp' }];
  if (all.length > 1) acts.push({ label: 'Adiantar tudo o que vem depois', hint: `${all.length} itens deste dia, ${mins} mais cedo`, value: 'pull-all', icon: 'arrowUp' });
  return acts;
}

export async function applyPull(g, all) {
  const moves = planPull(g.occs, g.next, g.gap, { all, until: endOfDay(g.next.start) });
  if (!moves.length) return null;
  setGapHint(null);
  await applyMoves(moves);
  return moves;
}

export async function openGapSheet(g) {
  if (!g) return null;
  const v = await actionSheet({
    title: `Espaço livre de ${fmtDur(g.gap / MIN)}`,
    message: `Entre ${fmtHM(g.from)} e ${fmtHM(g.next.start)} (${dayLabel(g.from)}).`,
    actions: pullActions(g),
    cancel: 'Deixar o espaço',
  });
  if (!v) return null;
  return applyPull(g, v === 'pull-all');
}

/** "terminei antes": encerra agora; se abrir um espaço, a agenda mostra o botão "Adiantar" nele */
export async function finishNow(occ) {
  const now = Date.now();
  const end = Math.max(occ.start + 5 * MIN, Math.floor(now / (5 * MIN)) * 5 * MIN);
  if (end >= occ.end) return null;
  await applyMoves([{ occ, start: occ.start, end }]);
  offerGapAfter(end, occ.key);
  return end;
}

/** depois de encurtar algo: se ficou um espaço logo depois, mostra "Adiantar" dentro dele na agenda */
export function offerGapAfter(end, excludeKey) {
  const g = findGap(end, { excludeKey });
  setGapHint(g && g.from === end ? { from: end, excludeKey } : null);
  return g;
}
