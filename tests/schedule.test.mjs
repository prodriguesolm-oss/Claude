// Testes da lógica de agenda. Rodar: npm test  (ou: node --test tests/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expand, commitmentOccs, occByKey, findConflicts, planPushExisting, planPushNew,
  applyMove, sweep, layoutColumns, nextOccurrence, historyId,
} from '../js/schedule.js';
import { atMinutes, addDays, dateKey, MIN, HOUR, DAY } from '../js/time.js';

// segunda-feira, 16/11/2026 (16/11/2026 é uma segunda)
const MON = '2026-11-16';
const TUE = '2026-11-17';
const T = (dk, hm) => { const [h, m] = hm.split(':').map(Number); return atMinutes(dk, h * 60 + m); };

const emptyState = () => ({ places: [], events: [], visits: [], commitments: [], history: [] });

const therapy = () => ({
  id: 'c1', name: 'Terapia', kind: 'weekly', favorite: false,
  slots: [
    { id: 's1', days: [2], startMin: 10 * 60, endMin: 11 * 60 },        // terça 10–11
    { id: 's2', days: [1, 4], startMin: 6 * 60 + 30, endMin: 7 * 60 + 30 }, // seg e qui 06:30–07:30
  ],
  startDate: '2026-11-14', untilDate: null, overrides: {}, createdAt: T('2026-11-14', '08:00'),
});

test('gera ocorrências semanais nos dias certos', () => {
  const s = emptyState(); s.commitments.push(therapy());
  const occs = expand(s, T(MON, '00:00'), addDays(T(MON, '00:00'), 7), T('2026-11-14', '09:00'));
  const labels = occs.map((o) => `${dateKey(o.start)} ${new Date(o.start).getHours()}`);
  assert.deepEqual(labels, ['2026-11-16 6', '2026-11-17 10', '2026-11-19 6']);
});

test('respeita data de início e data final', () => {
  const c = therapy(); c.startDate = TUE; c.untilDate = '2026-11-18';
  const occs = commitmentOccs(c, T(MON, '00:00'), addDays(T(MON, '00:00'), 14), 0);
  assert.equal(occs.length, 1);
  assert.equal(dateKey(occs[0].start), TUE);
});

test('adiar UMA ocorrência em 24h não altera as outras semanas', () => {
  const s = emptyState(); s.commitments.push(therapy());
  const now = T(MON, '12:00');
  const [occ] = expand(s, T(TUE, '00:00'), T(TUE, '23:59'), now).filter((o) => o.slotId === 's1');
  const r = applyMove(s, occ, occ.start + DAY, occ.end + DAY, now);
  s.commitments[0] = r.value;
  // terça desta semana não tem mais terapia; quarta tem; terça seguinte continua normal
  const tue = expand(s, T(TUE, '00:00'), addDays(T(TUE, '00:00'), 1), now).filter((o) => o.slotId === 's1');
  const wed = expand(s, T('2026-11-18', '00:00'), T('2026-11-19', '00:00'), now).filter((o) => o.slotId === 's1');
  const nextTue = expand(s, T('2026-11-24', '00:00'), T('2026-11-25', '00:00'), now).filter((o) => o.slotId === 's1');
  assert.equal(tue.length, 0);
  assert.equal(wed.length, 1);
  assert.equal(wed[0].overridden, true);
  assert.equal(new Date(wed[0].start).getHours(), 10);
  assert.equal(nextTue.length, 1);
  assert.equal(nextTue[0].overridden, false);
  // uma única série continua existindo (não criou compromisso novo)
  assert.equal(s.commitments.length, 1);
});

test('voltar ao horário original remove a exceção', () => {
  const s = emptyState(); s.commitments.push(therapy());
  const occ = occByKey(s, `commitment:c1:s1|${TUE}`, 0);
  s.commitments[0] = applyMove(s, occ, occ.start + HOUR, occ.end + HOUR, 0).value;
  const moved = occByKey(s, `commitment:c1:s1|${TUE}`, 0);
  assert.equal(moved.overridden, true);
  s.commitments[0] = applyMove(s, moved, T(TUE, '10:00'), T(TUE, '11:00'), 0).value;
  assert.deepEqual(s.commitments[0].overrides, {});
});

test('ocorrência cancelada some apenas naquela semana', () => {
  const s = emptyState(); const c = therapy();
  c.overrides[`s1|${TUE}`] = { cancelled: true };
  s.commitments.push(c);
  assert.equal(occByKey(s, `commitment:c1:s1|${TUE}`), null);
  const next = expand(s, T('2026-11-24', '00:00'), T('2026-11-25', '00:00'), 0);
  assert.equal(next.length, 1);
});

test('compromisso que vira a noite (23:00–07:00) aparece nos dois dias', () => {
  const s = emptyState();
  s.commitments.push({ id: 'c2', name: 'Sono', kind: 'weekly', slots: [{ id: 'z', days: [1], startMin: 23 * 60, endMin: 7 * 60 }], startDate: MON, overrides: {}, createdAt: 0 });
  const mon = expand(s, T(MON, '00:00'), T(TUE, '00:00'), 0);
  const tue = expand(s, T(TUE, '00:00'), addDays(T(TUE, '00:00'), 1), 0);
  assert.equal(mon.length, 1);
  assert.equal(tue.length, 1);
  assert.equal(mon[0].end - mon[0].start, 8 * HOUR);
});

test('detecta conflito e ignora itens concluídos', () => {
  const s = emptyState();
  s.places.push({ id: 'p1', name: 'Teatro Municipal' });
  s.events.push({ id: 'e1', name: 'Ópera', placeId: 'p1', start: T(TUE, '10:30'), end: T(TUE, '12:00'), status: 'planned' });
  s.events.push({ id: 'e2', name: 'Antigo', placeId: 'p1', start: T(TUE, '10:00'), end: T(TUE, '10:45'), status: 'done' });
  s.commitments.push(therapy());
  const now = T(MON, '08:00');
  const occs = expand(s, T(TUE, '00:00'), T('2026-11-18', '00:00'), now);
  const cand = { key: 'new', start: T(TUE, '10:15'), end: T(TUE, '10:45') };
  const keys = findConflicts(occs, cand).map((o) => o.key).sort();
  assert.deepEqual(keys, ['commitment:c1:s1|2026-11-17', 'event:e1']);
});

test('adiar o existente empurra em cascata', () => {
  const occs = [
    { key: 'a', start: T(TUE, '10:00'), end: T(TUE, '11:00'), status: 'planned' },
    { key: 'b', start: T(TUE, '11:00'), end: T(TUE, '12:00'), status: 'planned' },
    { key: 'c', start: T(TUE, '15:00'), end: T(TUE, '16:00'), status: 'planned' },
  ];
  const cand = { key: 'new', start: T(TUE, '09:30'), end: T(TUE, '10:30') };
  const moves = planPushExisting(occs, cand);
  assert.deepEqual(moves.map((m) => [m.occ.key, new Date(m.start).getHours() * 60 + new Date(m.start).getMinutes()]), [['a', 630], ['b', 690]]);
});

test('adiar o novo encontra o primeiro horário livre', () => {
  const occs = [
    { key: 'a', start: T(TUE, '10:00'), end: T(TUE, '11:00'), status: 'planned' },
    { key: 'b', start: T(TUE, '11:00'), end: T(TUE, '11:30'), status: 'planned' },
  ];
  const r = planPushNew(occs, { key: 'new', start: T(TUE, '10:30'), end: T(TUE, '11:30') });
  assert.equal(r.start, T(TUE, '11:30'));
  assert.equal(r.end, T(TUE, '12:30'));
});

test('varredura conclui eventos/visitas passados e marca local visitado; compromissos não vão para o histórico', () => {
  const s = emptyState();
  s.places.push({ id: 'p1', name: 'Trilha da Vista Chinesa', visited: false });
  s.places.push({ id: 'p2', name: 'Museu', visited: false });
  s.events.push({ id: 'e1', name: 'Trilha', placeId: 'p1', start: T(MON, '07:00'), end: T(MON, '10:00'), status: 'planned' });
  s.events.push({ id: 'e2', name: 'Futuro', placeId: 'p1', start: T(TUE, '07:00'), end: T(TUE, '10:00'), status: 'planned' });
  s.visits.push({ id: 'v1', placeId: 'p2', start: T(MON, '14:00'), end: T(MON, '15:00'), status: 'planned' });
  s.commitments.push(therapy());
  const now = T(MON, '20:00');
  const r = sweep(s, now, T('2026-11-14', '08:00'));
  assert.deepEqual(r.events.map((e) => e.id), ['e1']);
  assert.equal(r.events[0].status, 'done');
  assert.deepEqual(r.visits.map((v) => v.id), ['v1']);
  assert.deepEqual(r.places.map((p) => p.id).sort(), ['p1', 'p2']);
  const kinds = r.history.map((h) => h.id).sort();
  assert.deepEqual(kinds, ['h:event:e1', 'h:visit:v1']);
  // a terapia que já passou continua aparecendo como feita na agenda
  const past = commitmentOccs(s.commitments[0], T(MON, '00:00'), T(MON, '23:59'), now);
  assert.ok(past.length && past.every((o) => o.end > now || o.status === 'done'));
});

test('varredura não registra ocorrências marcadas como "não aconteceu" nem anteriores ao cadastro', () => {
  const s = emptyState();
  const c = therapy(); c.createdAt = T(MON, '07:00'); // criado depois da ocorrência de 06:30
  c.overrides[`s1|${TUE}`] = { status: 'missed' };
  s.commitments.push(c);
  const r = sweep(s, T('2026-11-18', '12:00'), 0);
  assert.deepEqual(r.history, []);
});

test('mover evento concluído para o futuro volta a "planejado" e limpa histórico', () => {
  const s = emptyState();
  s.places.push({ id: 'p1', name: 'X' });
  s.events.push({ id: 'e1', name: 'E', placeId: 'p1', start: T(MON, '07:00'), end: T(MON, '08:00'), status: 'done' });
  const occ = occByKey(s, 'event:e1', T(MON, '09:00'));
  const r = applyMove(s, occ, T(TUE, '07:00'), T(TUE, '08:00'), T(MON, '09:00'));
  assert.equal(r.value.status, 'planned');
  assert.equal(r.clearedHistory, historyId(occ));
});

test('layout em colunas marca sobreposição', () => {
  const mk = (s, e) => ({ s, e, o: { status: 'planned' } });
  const items = layoutColumns([mk(0, 60), mk(30, 90), mk(120, 180)]);
  assert.deepEqual(items.map((i) => [i.col, i.cols, i.conflict]), [[0, 2, true], [1, 2, true], [0, 1, false]]);
});

test('próxima ocorrência de compromisso semanal', () => {
  const n = nextOccurrence(therapy(), T(MON, '08:00'));
  assert.equal(n.start, T(TUE, '10:00'));
});

test('dateKey/atMinutes são consistentes no fuso local', () => {
  assert.equal(dateKey(atMinutes(MON, 23 * 60 + 59)), MON);
  assert.equal(atMinutes(MON, 90) - atMinutes(MON, 0), 90 * MIN);
});

// ---------- recorrência diária / mensal e horário avulso ----------
import { slotMatches, itemOcc, FREQ_LABEL } from '../js/schedule.js';

test('compromisso diário aparece todo dia (e respeita data final)', () => {
  const c = { id: 'd1', name: 'Remédio', kind: 'daily', slots: [{ id: 'x', startMin: 8 * 60, endMin: 8 * 60 + 15 }], startDate: MON, untilDate: '2026-11-20', overrides: {}, createdAt: 0 };
  const occs = commitmentOccs(c, T(MON, '00:00'), addDays(T(MON, '00:00'), 10), 0);
  assert.equal(occs.length, 5); // seg a sex
  assert.equal(occs[0].subtitle, FREQ_LABEL.daily);
});

test('compromisso mensal: dia 31 cai no último dia em meses curtos', () => {
  const c = { id: 'm1', name: 'Aluguel', kind: 'monthly', slots: [{ id: 'y', monthDays: [31], startMin: 9 * 60, endMin: 10 * 60 }], startDate: '2026-01-01', overrides: {}, createdAt: 0 };
  assert.equal(slotMatches(c, c.slots[0], '2027-02-28'), true);
  assert.equal(slotMatches(c, c.slots[0], '2026-11-30'), true);
  assert.equal(slotMatches(c, c.slots[0], '2026-12-31'), true);
  assert.equal(slotMatches(c, c.slots[0], '2026-12-30'), false);
  const occs = commitmentOccs(c, T('2026-11-01', '00:00'), T('2027-03-01', '00:00'), 0);
  assert.deepEqual(occs.map((o) => dateKey(o.start)), ['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
});

test('adiar uma ocorrência mensal não mexe nos outros meses', () => {
  const s = emptyState();
  s.commitments.push({ id: 'm2', name: 'Reunião', kind: 'monthly', slots: [{ id: 'z', monthDays: [5], startMin: 14 * 60, endMin: 15 * 60 }], startDate: '2026-11-01', overrides: {}, createdAt: 0 });
  const occ = occByKey(s, 'commitment:m2:z|2026-12-05', 0);
  s.commitments[0] = applyMove(s, occ, occ.start + DAY, occ.end + DAY, 0).value;
  const dec = expand(s, T('2026-12-01', '00:00'), T('2027-01-01', '00:00'), 0);
  const jan = expand(s, T('2027-01-01', '00:00'), T('2027-02-01', '00:00'), 0);
  assert.equal(dateKey(dec[0].start), '2026-12-06');
  assert.equal(dateKey(jan[0].start), '2027-01-05');
});

test('horário avulso entra na agenda, pode ser movido e é concluído automaticamente', () => {
  const s = emptyState();
  s.items = [{ id: 'i1', title: 'Shopping Leblon — comprar roupa', start: T(MON, '15:00'), end: T(MON, '17:00'), status: 'planned' }];
  const occs = expand(s, T(MON, '00:00'), T(TUE, '00:00'), T(MON, '08:00'));
  assert.equal(occs.length, 1);
  assert.equal(occs[0].kind, 'item');
  const moved = applyMove(s, occs[0], T(MON, '16:00'), T(MON, '18:00'), 0);
  assert.equal(moved.store, 'items');
  const r = sweep(s, T(MON, '20:00'), T(MON, '08:00'));
  assert.deepEqual(r.items.map((i) => i.status), ['done']);
  assert.equal(r.history[0].id, 'h:item:i1');
  assert.equal(itemOcc(s.items[0], 0).title, 'Shopping Leblon — comprar roupa');
});

// ---------- notificações ----------
import { computeReminders } from '../js/schedule.js';

test('lembretes: só itens com notificação, na antecedência certa, ignorando o que já passou', () => {
  const s = emptyState();
  s.items = [];
  s.places.push({ id: 'p1', name: 'Teatro Municipal' });
  const now = T(MON, '08:00');
  s.events.push({ id: 'e1', name: 'Ópera', placeId: 'p1', start: T(MON, '19:00'), end: T(MON, '21:00'), status: 'planned', remind: 60 });
  s.events.push({ id: 'e2', name: 'Sem aviso', placeId: 'p1', start: T(MON, '15:00'), end: T(MON, '16:00'), status: 'planned', remind: null });
  s.events.push({ id: 'e3', name: 'Já devia ter avisado', placeId: 'p1', start: T(MON, '08:30'), end: T(MON, '09:00'), status: 'planned', remind: 60 });
  s.items.push({ id: 'i1', title: 'Shopping Leblon', start: T(TUE, '15:00'), end: T(TUE, '17:00'), status: 'planned', remind: 1440 });
  const c = therapy(); c.remind = 30; s.commitments.push(c);
  const r = computeReminders(s, now, 3);
  const byId = Object.fromEntries(r.map((x) => [x.id, x]));
  assert.equal(byId['event:e1'].at, T(MON, '18:00'));
  assert.equal(byId['event:e1'].body, 'Começa em 1 hora — às 19:00 · Teatro Municipal');
  assert.ok(!byId['event:e2'] && !byId['event:e3']);
  assert.equal(byId['item:i1'].body, 'Amanhã às 15:00');
  assert.equal(byId['commitment:c1:s1|2026-11-17'].at, T(TUE, '09:30'));
  assert.ok(r.every((x, i) => i === 0 || r[i - 1].at <= x.at));
});

// ---------- cascata do dia (arrastar na agenda) ----------
import { planCascade } from '../js/schedule.js';

test('cascata: esticar o trabalho 15 min adia o almoço e o que vem logo depois, só naquele dia', () => {
  const mk = (key, dk, a, b) => ({ key, start: T(dk, a), end: T(dk, b), status: 'planned' });
  const occs = [
    mk('trabalho', MON, '10:00', '13:00'),
    mk('almoco', MON, '13:00', '14:00'),
    mk('reuniao', MON, '14:00', '15:00'),
    mk('jantar', MON, '20:00', '21:00'),
    mk('amanha', TUE, '00:10', '01:00'),
  ];
  const cand = { key: 'trabalho', start: T(MON, '10:00'), end: T(MON, '13:15') };
  const moves = planCascade(occs, cand, { until: T(TUE, '00:00'), prev: occs[0] });
  assert.deepEqual(moves.map((m) => [m.occ.key, m.start, m.end]), [
    ['almoco', T(MON, '13:15'), T(MON, '14:15')],
    ['reuniao', T(MON, '14:15'), T(MON, '15:15')],
  ]);
});

test('cascata: o que começou antes não é empurrado (fica sobreposto)', () => {
  const trabalho = { key: 'trabalho', start: T(MON, '10:00'), end: T(MON, '13:00'), status: 'planned' };
  const almocoAntes = { key: 'almoco', start: T(MON, '13:00'), end: T(MON, '14:00') };
  // almoço arrastado para 12:00–13:00, em cima do fim do trabalho
  const moves = planCascade([trabalho], { key: 'almoco', start: T(MON, '12:00'), end: T(MON, '13:00') }, { until: T(TUE, '00:00'), prev: almocoAntes });
  assert.deepEqual(moves, []);
});

test('cascata: não mexe em itens de outro dia, nem no que já estava sobreposto antes, nem no que já foi feito', () => {
  const mk = (key, dk, a, b, status = 'planned') => ({ key, start: T(dk, a), end: T(dk, b), status });
  const occs = [
    mk('ja-sobreposto', MON, '12:30', '13:30'),
    mk('feito', MON, '13:00', '13:30', 'done'),
    mk('amanha', TUE, '00:00', '01:00'),
  ];
  const prev = { start: T(MON, '10:00'), end: T(MON, '13:00') };
  const virada = planCascade(occs, { key: 'x', start: T(MON, '10:00'), end: T(TUE, '00:30') }, { until: T(TUE, '00:00'), prev });
  assert.deepEqual(virada, []);
});

// ---------- Plano B, encurtar vizinho, adiantar, cores ----------
import { optGroups, optMembers, planTrim, planPull, gapAfter, colorOf } from '../js/schedule.js';

test('Plano B: opções lado a lado sem conflito entre si, letras A/B pela ordem', () => {
  const s = emptyState(); s.items = [];
  s.places.push({ id: 'p1', name: 'Trilha', category: 'aventura' }, { id: 'p2', name: 'Biblioteca', category: 'cultura' });
  s.visits.push({ id: 'v1', placeId: 'p1', start: T(TUE, '17:00'), end: T(TUE, '19:00'), status: 'planned', optGroup: 'g1', optRank: 0 });
  s.visits.push({ id: 'v2', placeId: 'p2', start: T(TUE, '17:00'), end: T(TUE, '19:00'), status: 'planned', optGroup: 'g1', optRank: 1 });
  s.items.push({ id: 'i1', title: 'Jantar', start: T(TUE, '18:30'), end: T(TUE, '20:00'), status: 'planned' });
  const occs = expand(s, T(TUE, '00:00'), T('2026-11-18', '00:00'), T(MON, '12:00'));
  const v1 = occs.find((o) => o.key === 'visit:v1');
  const v2 = occs.find((o) => o.key === 'visit:v2');
  assert.equal(v1.opt.letter, 'A'); assert.equal(v2.opt.letter, 'B'); assert.equal(v2.opt.of, 2);
  // a opção B não é conflito da A; o jantar continua sendo
  const keys = findConflicts(occs, { key: 'visit:v1', start: v1.start, end: v1.end, optGroup: 'g1' }).map((o) => o.key);
  assert.deepEqual(keys, ['item:i1']);
  const laid = layoutColumns(occs.map((o) => ({ o, s: o.start, e: o.end })));
  const byKey = Object.fromEntries(laid.map((it) => [it.o.key, it]));
  assert.equal(byKey['visit:v1'].col, 0); assert.equal(byKey['visit:v2'].col, 1);
  assert.equal(byKey['visit:v1'].conflict, true); // por causa do jantar
  assert.equal(colorOf(v1), 'aventura'); assert.equal(colorOf(v2), 'cultura');
  assert.equal(optMembers(s, 'g1').length, 2);
});

test('Plano B: depois do horário fica "escolha" e não vai ao histórico até sobrar uma opção', () => {
  const s = emptyState(); s.items = [];
  s.places.push({ id: 'p1', name: 'Trilha' }, { id: 'p2', name: 'Biblioteca' });
  s.visits.push({ id: 'v1', placeId: 'p1', start: T(MON, '17:00'), end: T(MON, '19:00'), status: 'planned', optGroup: 'g1', optRank: 0 });
  s.visits.push({ id: 'v2', placeId: 'p2', start: T(MON, '17:00'), end: T(MON, '19:00'), status: 'planned', optGroup: 'g1', optRank: 1 });
  const now = T(MON, '20:00');
  assert.equal(occByKey(s, 'visit:v1', now).status, 'choose');
  assert.deepEqual(sweep(s, now, T(MON, '08:00')).visits, []);
  // tirou a opção A: a B vira um item normal e é concluída
  s.visits.splice(0, 1);
  assert.equal(optGroups(s).get('g1').length, 1);
  assert.equal(occByKey(s, 'visit:v2', now).status, 'done');
  assert.deepEqual(sweep(s, now, T(MON, '08:00')).visits.map((v) => v.id), ['v2']);
});

test('Plano B numa ocorrência de compromisso semanal (via override)', () => {
  const s = emptyState(); s.items = [];
  const c = therapy();
  c.overrides[`s1|${TUE}`] = { optGroup: 'g2', optRank: 0 };
  s.commitments.push(c);
  s.items.push({ id: 'i1', title: 'Outra coisa', start: T(TUE, '10:00'), end: T(TUE, '11:00'), status: 'planned', optGroup: 'g2', optRank: 1 });
  const now = T(TUE, '12:00');
  const occ = occByKey(s, `commitment:c1:s1|${TUE}`, now);
  assert.equal(occ.opt.letter, 'A'); assert.equal(occ.status, 'choose');
  const r = sweep(s, now, T(TUE, '09:00'));
  assert.deepEqual(r.history.filter((h) => h.kind === 'commitment' && h.subKey === `s1|${TUE}`), []);
  assert.deepEqual(r.items, []);
});

test('encurtar o vizinho: dormi até 9:30 e a terapia das 9 fica 9:30–10:00; o resto não muda', () => {
  const mk = (key, a, b) => ({ key, start: T(TUE, a), end: T(TUE, b), status: 'planned' });
  const sono = mk('sono', '00:00', '08:00');
  const occs = [sono, mk('terapia', '09:00', '10:00'), mk('trabalho', '10:00', '13:00')];
  const moves = planTrim(occs, { key: 'sono', start: T(TUE, '00:00'), end: T(TUE, '09:30') }, { prev: sono });
  assert.deepEqual(moves.map((m) => [m.occ.key, m.start, m.end]), [['terapia', T(TUE, '09:30'), T(TUE, '10:00')]]);
  // dormir até 9:50 deixaria a terapia com 10 min: não dá para só encurtar
  assert.equal(planTrim(occs, { key: 'sono', start: T(TUE, '00:00'), end: T(TUE, '09:50') }, { prev: sono }), null);
  // começar a terapia mais cedo encurta o fim do que vem antes
  const t2 = planTrim([mk('cafe', '08:00', '09:00')], { key: 'terapia', start: T(TUE, '08:30'), end: T(TUE, '09:30') });
  assert.deepEqual(t2.map((m) => [m.occ.key, m.start, m.end]), [['cafe', T(TUE, '08:00'), T(TUE, '08:30')]]);
  // cair no meio de um item maior não é "encurtar"
  assert.equal(planTrim([mk('trabalho', '10:00', '13:00')], { key: 'x', start: T(TUE, '11:00'), end: T(TUE, '11:30') }), null);
});

test('adiantar: cheguei 25 min antes — puxa só o próximo ou todos os seguintes do dia', () => {
  const mk = (key, a, b, status = 'planned') => ({ key, start: T(TUE, a), end: T(TUE, b), status });
  const trajeto = mk('trajeto', '08:00', '08:20'); // era até 08:45
  const occs = [trajeto, mk('terapia', '08:45', '09:45'), mk('trabalho', '10:00', '13:00'), mk('jantar', '20:00', '21:00'),
    { key: 'amanha', start: T('2026-11-18', '08:00'), end: T('2026-11-18', '09:00'), status: 'planned' }];
  const g = gapAfter(occs, trajeto.end, { until: T('2026-11-18', '00:00'), excludeKey: 'trajeto' });
  assert.equal(g.next.key, 'terapia'); assert.equal(g.from, T(TUE, '08:20')); assert.equal(g.gap, 25 * MIN);
  const one = planPull(occs, g.next, g.gap);
  assert.deepEqual(one.map((m) => [m.occ.key, m.start]), [['terapia', T(TUE, '08:20')]]);
  const all = planPull(occs, g.next, g.gap, { all: true, until: T('2026-11-18', '00:00') });
  assert.deepEqual(all.map((m) => [m.occ.key, m.start]), [['terapia', T(TUE, '08:20')], ['trabalho', T(TUE, '09:35')], ['jantar', T(TUE, '19:35')]]);
});

test('cores: classificação do evento, senão a do local; compromisso e avulso com cor própria', () => {
  const s = emptyState(); s.items = [{ id: 'i1', title: 'x', start: T(TUE, '08:00'), end: T(TUE, '09:00') }];
  s.places.push({ id: 'p1', name: 'Bar', category: 'bares' }, { id: 'p2', name: 'Lugar' });
  s.events.push({ id: 'e1', name: 'Show', placeId: 'p1', start: T(TUE, '20:00'), end: T(TUE, '22:00') });
  s.events.push({ id: 'e2', name: 'Peça', placeId: 'p1', category: 'cultura', start: T(TUE, '18:00'), end: T(TUE, '19:00') });
  s.visits.push({ id: 'v1', placeId: 'p2', start: T(TUE, '10:00'), end: T(TUE, '11:00') });
  s.commitments.push(therapy());
  const occs = expand(s, T(TUE, '00:00'), T('2026-11-18', '00:00'), 0);
  const c = Object.fromEntries(occs.map((o) => [o.key.split(':').slice(0, 2).join(':'), colorOf(o)]));
  assert.equal(c['event:e1'], 'bares'); assert.equal(c['event:e2'], 'cultura'); assert.equal(c['visit:v1'], 'none');
  assert.equal(c['item:i1'], 'item'); assert.equal(c['commitment:c1'], 'commitment');
});
