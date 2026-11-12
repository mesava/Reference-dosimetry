// Слияние правок журнала с двух компьютеров (core/journal-merge.js): разные записи сливаются, одна и та же — конфликт.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newJournal, normalizeJournal, recordTabBeam, PH_BEAM_KEYS, PH_CHAMBER_KEYS, PH_ELECTROMETER_KEYS } from '../src/core/journal.js';
import { mergeJournals, conflictSummary } from '../src/core/journal-merge.js';
import { SAMPLE_FORM } from '../src/core/sample.js';

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const TODAY = '2026-11-12';
const base = () => {
  const j = newJournal();
  j.institution = 'Условный онкодиспансер';
  j.chambers = [{ id: 'c1', form: pick(SAMPLE_FORM, PH_CHAMBER_KEYS) }];
  j.electrometers = [{ id: 'e1', form: pick(SAMPLE_FORM, PH_ELECTROMETER_KEYS) }];
  j.machines = [{ id: 'm1', name: 'Линак-1', kind: 'linac', beams: [
    { id: 'b6', kind: 'photon', name: '6 МВ', active: true, form: pick(SAMPLE_FORM, PH_BEAM_KEYS) },
    { id: 'b10', kind: 'photon', name: '10 МВ', active: true, form: pick(SAMPLE_FORM, PH_BEAM_KEYS) },
  ] }];
  return normalizeJournal(j);
};
const rec = (j, beamId, over = {}) => {
  const r = recordTabBeam(j, { machineId: 'm1', beamId, form: { ...SAMPLE_FORM, meta_date: '2026-10-19', ...over }, kind: 'photon', today: TODAY });
  assert.ok(!r.error, r.error);
  return r.journal;
};
const clone = (j) => structuredClone(j);

test('Слияние: записи разных дней с двух компьютеров — обе остаются, конфликта нет', () => {
  const b = rec(base(), 'b6');
  const mine = rec(clone(b), 'b6', { meta_date: '2026-10-20', rd_fixed: false });
  const theirs = rec(clone(b), 'b10', { meta_date: '2026-10-21' });
  const r = mergeJournals(b, mine, theirs);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.journal.sessions.map((s) => s.date), ['2026-10-19', '2026-10-20', '2026-10-21']);
});

test('Слияние: один день, разные пучки (каждый компьютер завёл свою запись дня) — одна запись с обоими пучками', () => {
  const b = base();
  const mine = rec(clone(b), 'b6');
  const theirs = rec(clone(b), 'b10');
  assert.notEqual(mine.sessions[0].id, theirs.sessions[0].id);
  const r = mergeJournals(b, mine, theirs);
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.journal.sessions.length, 1);
  assert.deepEqual(r.journal.sessions[0].beams.map((x) => x.beamId).sort(), ['b10', 'b6']);
});

test('Слияние: разные поля одной карточки и разные карточки — без конфликта; удаление с одной стороны', () => {
  const b = base();
  const mine = clone(b);
  const theirs = clone(b);
  mine.chambers[0].notes = 'кабель заменён';
  theirs.chambers[0].dueDate = '2027-10-01';
  mine.machines[0].beams[0].name = '6 МВ СВФ';
  theirs.machines[0].beams = theirs.machines[0].beams.filter((x) => x.id !== 'b10');
  theirs.electrometers.push({ ...theirs.electrometers[0], id: 'e2' });
  const r = mergeJournals(b, mine, theirs);
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.journal.chambers[0].notes, 'кабель заменён');
  assert.equal(r.journal.chambers[0].dueDate, '2027-10-01');
  assert.deepEqual(r.journal.machines[0].beams.map((x) => x.name), ['6 МВ СВФ']);
  assert.equal(r.journal.electrometers.length, 2);
});

test('Слияние: одно и то же поле изменено по-разному — конфликт с понятной подписью; служебные поля — не конфликт', () => {
  const b = base();
  const mine = clone(b);
  const theirs = clone(b);
  mine.chambers[0].dueDate = '2027-09-01';
  theirs.chambers[0].dueDate = '2027-10-01';
  mine.updated = '2026-11-12T10:00:00Z';
  theirs.updated = '2026-11-12T10:05:00Z';
  const r = mergeJournals(b, mine, theirs);
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual(r.conflicts[0].path, ['chambers', 'id:c1', 'dueDate']);
  assert.match(conflictSummary(r.conflicts, theirs), /^камера PTW 30013/);
  // изменили с одной стороны, удалили с другой — тоже конфликт
  const m2 = clone(b);
  const t2 = clone(b);
  m2.chambers[0].notes = 'правка';
  t2.chambers = [];
  assert.equal(mergeJournals(b, m2, t2).conflicts.length, 1);
});

test('Слияние: та же запись дня, тот же пучок с разными показаниями — конфликт', () => {
  const b = base();
  const mine = rec(clone(b), 'b6');
  const theirs = rec(clone(b), 'b6', { meta_notes: 'другое' });
  const r = mergeJournals(b, mine, theirs);
  assert.ok(r.conflicts.length >= 1);
  assert.match(conflictSummary(r.conflicts, theirs), /запись журнала 19\.10\.2026/);
});
