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

test('varredura conclui eventos/visitas passados, marca local visitado e registra compromissos', () => {
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
  assert.deepEqual(kinds, ['h:commitment:c1:s2|2026-11-16', 'h:event:e1', 'h:visit:v1']);
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
