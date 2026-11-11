// Перенос записи журнала (аппарат за день) на другую дату: протокол внесли не с той датой.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newJournal, normalizeJournal, recordTabBeam, tabBeamPatch, finalizeSession, upsertSession, moveSession, lastCalibration, PH_BEAM_KEYS, PH_CHAMBER_KEYS, PH_ELECTROMETER_KEYS, CO_BEAM_KEYS } from '../src/core/journal.js';
import { decayFactor } from '../src/core/cobalt.js';
import { SAMPLE_FORM } from '../src/core/sample.js';
import { SAMPLE_COBALT } from '../src/core/sample-cobalt.js';

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const TODAY = '2026-11-11';
const near = (a, b, rel, msg) => assert.ok(Math.abs(a / b - 1) <= rel, `${msg}: ${a} ≠ ${b}`);

const journal = () => {
  const j = newJournal();
  j.chambers = [{ id: 'c1', form: pick(SAMPLE_FORM, PH_CHAMBER_KEYS) }];
  j.electrometers = [{ id: 'e1', form: pick(SAMPLE_FORM, PH_ELECTROMETER_KEYS) }];
  j.machines = [{ id: 'm1', name: 'Линак-1', kind: 'linac', beams: [
    { id: 'b6', kind: 'photon', name: '6 МВ', active: true, form: pick(SAMPLE_FORM, PH_BEAM_KEYS) },
    { id: 'b10', kind: 'photon', name: '10 МВ', active: true, form: pick(SAMPLE_FORM, PH_BEAM_KEYS) },
  ] }];
  return normalizeJournal(j);
};
const tab = (over = {}) => ({ ...SAMPLE_FORM, meta_date: '2025-06-16', ...over });
const rec = (j, beamId, form) => {
  const r = recordTabBeam(j, { machineId: 'm1', beamId, form, kind: 'photon', today: TODAY });
  assert.ok(!r.error, r.error);
  return r.journal;
};
// проверка выхода пучка 6 МВ с k_pol и k_s из калибровки журнала
const check = (j, date) => {
  const p = tabBeamPatch(j, 'm1', 'b6', tab({ meta_date: date, rd_fixed: true }));
  return rec(j, 'b6', tab({ ...p.patch, meta_date: date, rd_fixed: true }));
};

test('Перенос записи: дата записи и форм пучков меняется, доза та же, все пучки дня — вместе', () => {
  let j = rec(journal(), 'b6', tab());
  j = rec(j, 'b10', tab({ meta_beam: '10 МВ' }));
  const s = j.sessions[0];
  const r = moveSession(j, s.id, '2025-05-16', { today: TODAY });
  assert.ok(!r.error, r.error);
  assert.equal(r.journal.sessions.length, 1);
  const m = r.journal.sessions[0];
  assert.equal(m.id, s.id);
  assert.equal(m.date, '2025-05-16');
  assert.equal(m.beams.length, 2);
  for (const b of m.beams) {
    assert.equal(b.form.meta_date, '2025-05-16');
    const was = s.beams.find((x) => x.beamId === b.beamId);
    assert.equal(b.summary.value, was.summary.value, 'доза не меняется');
    assert.deepEqual(b.form.rd_M1, was.form.rd_M1, 'показания те же');
  }
  assert.equal(lastCalibration(r.journal, 'b6').date, '2025-05-16');
});

test('Перенос записи: дата в будущем, та же дата и занятая дата — отказ', () => {
  let j = rec(journal(), 'b6', tab());
  j = rec(j, 'b6', tab({ meta_date: '2025-05-16' }));
  const id = j.sessions.find((x) => x.date === '2025-06-16').id;
  assert.match(moveSession(j, id, '2026-12-01', { today: TODAY }).error, /в будущем/);
  assert.match(moveSession(j, id, '2025-06-16', { today: TODAY }).error, /совпадает/);
  assert.match(moveSession(j, id, '2025-05-16', { today: TODAY }).error, /уже есть запись/);
  assert.match(moveSession(j, id, '', { today: TODAY }).error, /Укажите новую дату/);
  assert.match(moveSession(j, 'нет', '2025-05-01', { today: TODAY }).error, /не найдена/);
});

test('Перенос калибровки и проверок выхода: зависимости по дате', () => {
  let j = rec(journal(), 'b6', tab({ meta_date: '2025-02-14' }));
  j = check(j, '2025-03-14');
  const cal = j.sessions.find((x) => x.mode === 'cal');
  const chk = j.sessions.find((x) => x.mode === 'check');
  assert.equal(chk.beams[0].form.rd_fixed_from, '14.02.2025');
  // проверка не может стать раньше своей калибровки
  assert.match(moveSession(j, chk.id, '2025-02-01', { today: TODAY }).error, /опираются на калибровку позже новой даты: 6 МВ \(14\.02\.2025\)/);
  // калибровка не может уйти позже опирающейся на неё проверки
  assert.match(moveSession(j, cal.id, '2025-04-01', { today: TODAY }).error, /проверки выхода раньше новой даты \(6 МВ 14\.03\.2025\)/);
  // внутри допустимого — проверка ссылается на новую дату калибровки
  const r = moveSession(j, cal.id, '2025-02-20', { today: TODAY });
  assert.ok(!r.error, r.error);
  assert.equal(r.updated, 1);
  const c2 = r.journal.sessions.find((x) => x.id === chk.id);
  assert.equal(c2.beams[0].form.rd_fixed_from, '20.02.2025');
  assert.equal(c2.beams[0].summary.value, chk.beams[0].summary.value, 'доза проверки та же');
  // проверку можно перенести в пределах после калибровки
  const r2 = moveSession(r.journal, chk.id, '2025-03-01', { today: TODAY });
  assert.ok(!r2.error, r2.error);
  assert.deepEqual(r2.journal.sessions.map((x) => x.date), ['2025-02-20', '2025-03-01']);
});

test('Перенос калибровки: проверки в пластинах, привязанные к ней, — отказ', () => {
  const j = rec(journal(), 'b6', tab({ meta_date: '2025-02-14' }));
  const jp = { ...j, plateChecks: [{ id: 'p1', beamId: 'b6', date: '2025-02-15', binding: { calDate: '2025-02-14' } }] };
  assert.match(moveSession(jp, j.sessions[0].id, '2025-02-10', { today: TODAY }).error, /проверки в пластинах \(6 МВ 15\.02\.2025\)/);
});

// ⁶⁰Co: от даты зависит ожидаемая мощность дозы (поправка на распад от даты калибровки, decayFactor) — итог пересчитывается
function cojournal() {
  const j = newJournal();
  j.chambers = [{ id: 'cNE', form: { ch_model: 'NE2571', ch_serial: '0000', ch_ndw: '0,04523', ch_ndw_unit: 'Gy/nC', ch_klab: '1,000', ch_T0: '20', ch_P0: '101,325' } }];
  j.electrometers = [{ id: 'e1', form: { el_model: 'Электрометр (демо)', el_serial: '', el_kelec: '1,000' } }];
  j.machines = [{ id: 'mc', name: 'Аппарат ⁶⁰Co', kind: 'cobalt', beams: [{ id: 'bco', kind: 'cobalt', name: '⁶⁰Co', chamberId: 'cNE', electrometerId: 'e1', form: pick(SAMPLE_COBALT, CO_BEAM_KEYS) }] }];
  return normalizeJournal(j);
}
const CO_READ = { co_M1: SAMPLE_COBALT.co_M1, co_Mopp: SAMPLE_COBALT.co_Mopp, co_M2: SAMPLE_COBALT.co_M2, co_Mc: SAMPLE_COBALT.co_Mc, co_tt: SAMPLE_COBALT.co_tt, co_tm: SAMPLE_COBALT.co_tm };
const CO_ENV = { T: '21,0', P: '100,5', P_unit: 'kPa', H: '' };

test('⁶⁰Co: перенос проверки выхода пересчитывает ожидаемую мощность дозы по распаду; перенос калибровки — ссылку проверки', () => {
  let j = cojournal();
  j = upsertSession(j, finalizeSession(j, { machineId: 'mc', date: '2026-09-15', mode: 'cal', protocol: 'trs', env: CO_ENV, beams: [{ beamId: 'bco', ...CO_READ }] }));
  j = upsertSession(j, finalizeSession(j, { machineId: 'mc', date: '2026-10-15', mode: 'check', protocol: 'trs', env: CO_ENV, beams: [{ beamId: 'bco', co_M1: SAMPLE_COBALT.co_M1, co_Mc: SAMPLE_COBALT.co_Mc }] }));
  const chk = j.sessions.find((x) => x.mode === 'check');
  const b0 = chk.beams[0];
  assert.equal(b0.form.co_ref_date, '2026-09-15');
  const r = moveSession(j, chk.id, '2026-11-10', { today: TODAY });
  assert.ok(!r.error, r.error);
  const b1 = r.journal.sessions.find((x) => x.id === chk.id).beams[0];
  assert.equal(b1.form.co_date, '2026-11-10');
  near(b1.summary.value, b0.summary.value, 1e-12, 'мощность дозы та же');
  // ожидаемая уменьшилась распадом за 26 дней: (1 + δ₁) / (1 + δ₀) = 1 / f(15.10 → 10.11)
  const f = decayFactor('2026-10-15', '2026-11-10').factor;
  near((1 + b1.summary.deviation / 100) / (1 + b0.summary.deviation / 100), 1 / f, 1e-9, 'отклонение по распаду');
  // перенос калибровки раньше: проверка ссылается на новую дату (и распад считается от неё)
  const cal = j.sessions.find((x) => x.mode === 'cal');
  const r2 = moveSession(j, cal.id, '2026-09-10', { today: TODAY });
  assert.ok(!r2.error, r2.error);
  const b2 = r2.journal.sessions.find((x) => x.id === chk.id).beams[0];
  assert.equal(b2.form.co_ref_date, '2026-09-10');
  const f2 = decayFactor('2026-09-10', '2026-09-15').factor;
  near((1 + b2.summary.deviation / 100) / (1 + b0.summary.deviation / 100), 1 / f2, 1e-9, 'ожидаемая — от новой даты калибровки');
});
