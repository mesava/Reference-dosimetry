// Списанные камеры и электрометры (с 0.68.0): остаются в журнале для прежних записей, но в новых измерениях не
// предлагаются и о сроках не напоминают.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeJournal, newJournal, JOURNAL_TAG, isRetired, activeOnly, chamberServes, sessionEquipDefaults, equipmentDue, equipmentNoDue,
} from '../src/core/journal.js';
import { kvMachineChecks } from '../src/core/kv-machine.js';
import { kvModeElectrometer } from '../src/core/kv-journal.js';

const base = () => normalizeJournal({
  ...newJournal(),
  electrometers: [
    { id: 'e1', form: { el_model: 'PTW UNIDOS Tango', el_serial: '1', el_kelec: '1,000' }, dueDate: '2026-11-30' },
    { id: 'e2', form: { el_model: 'IBA Dose 1', el_serial: '2', el_kelec: '1,000' } },
  ],
  chambers: [
    { id: 'c1', form: { ch_model: 'PTW30013', ch_serial: '1', ch_ndw: '0,05235', ch_ndw_unit: 'Gy/nC' }, dueDate: '2026-11-30' },
    { id: 'c2', form: { ch_model: 'PTW30013', ch_serial: '2', ch_ndw: '0,05300', ch_ndw_unit: 'Gy/nC' } },
  ],
  machines: [{ id: 'm1', name: 'Versa HD', kind: 'linac', beams: [{ id: 'b1', kind: 'photon', name: '6 МВ', active: true, form: {} }] }],
  sessions: [{ id: 's1', machineId: 'm1', date: '2026-10-01', beams: [{ beamId: 'b1', kind: 'photon', chamberId: 'c1', electrometerId: 'e1' }] }],
});

test('Отметка «списана»: дата в записи, журнал без неё читается как прежде', () => {
  const j = base();
  assert.equal(j.chambers[0].retired, '');
  assert.equal(isRetired(j.chambers[0]), false);
  const r = normalizeJournal({ ...JOURNAL_TAG, chambers: [{ id: 'c', form: {}, retired: '2026-11-23' }], electrometers: [{ id: 'e', form: {}, retired: null }] });
  assert.equal(isRetired(r.chambers[0]), true);
  assert.equal(r.electrometers[0].retired, '');
  // уже выбранная запись остаётся в списке, даже списанная
  assert.deepEqual(activeOnly(r.chambers).map((x) => x.id), []);
  assert.deepEqual(activeOnly(r.chambers, 'c').map((x) => x.id), ['c']);
});

test('Списанная камера и электрометр не предлагаются для нового измерения; записи журнала на них ссылаются как прежде', () => {
  const j = base();
  assert.deepEqual(sessionEquipDefaults(j, 'm1', 'photon', 'b1'), { chamberId: 'c1', electrometerId: 'e1' });
  j.chambers[0].retired = '2026-11-23';
  j.electrometers[0].retired = '2026-11-23';
  assert.equal(chamberServes(j.chambers[0], 'photon', j), false);
  assert.equal(chamberServes(j.chambers[1], 'photon', j), true);
  // последний раз мерили c1 и e1 — теперь по умолчанию другие
  assert.deepEqual(sessionEquipDefaults(j, 'm1', 'photon', 'b1'), { chamberId: 'c2', electrometerId: 'e2' });
  // запись журнала не меняется
  assert.equal(j.sessions[0].beams[0].chamberId, 'c1');
});

test('Списанные не напоминают о сроке калибровки и о незаданном сроке', () => {
  const j = base();
  assert.deepEqual(equipmentDue(j, '2026-11-23').map((x) => x.id).sort(), ['c1', 'e1']);
  assert.deepEqual(equipmentNoDue(j).map((x) => x.id).sort(), ['c2', 'e2']);
  for (const x of [...j.chambers, ...j.electrometers]) x.retired = '2026-11-23';
  assert.deepEqual(equipmentDue(j, '2026-11-23'), []);
  assert.deepEqual(equipmentNoDue(j), []);
});

test('kV: списанная камера режима — замечание; списанный электрометр не подставляется в новые измерения', () => {
  const j = normalizeJournal({
    ...JOURNAL_TAG,
    chambers: [{ id: 'k1', form: { ch_model: 'PTW23342', ch_serial: '5' }, calEl: 'e1', kvCal: { calEl: 'e1' } }],
    electrometers: [{ id: 'e1', form: { el_model: 'PTW UNIDOS', el_serial: '9' } }, { id: 'e2', form: { el_model: 'PTW UNIDOS webline', el_serial: '12' } }],
    machines: [{ id: 'mk', kind: 'kv', name: 'РТА', applicators: [{ id: 'a3', a: '3', ssd: '30' }], modes: [{ id: 'k50', range: 'low', kv: '50', hvl: '1,0', chamberId: 'k1', electrometerId: 'e2', applicators: ['a3'] }] }],
  });
  const retiredText = (x) => kvMachineChecks(x.machines[0], x).some((c) => /списана/.test(c.text));
  assert.equal(retiredText(j), false);
  const cal = kvModeElectrometer(j, j.machines[0].modes[0]);
  j.chambers[0].retired = '2026-11-23';
  assert.equal(retiredText(j), true);
  if (cal.src === 'cal') {
    j.electrometers[0].retired = '2026-11-01';
    // в новые измерения и с даты списания — последний электрометр вкладки; в прежние — электрометр калибровки
    assert.equal(kvModeElectrometer(j, j.machines[0].modes[0]).el.id, 'e2');
    assert.equal(kvModeElectrometer(j, j.machines[0].modes[0], '2026-11-05').el.id, 'e2');
    assert.equal(kvModeElectrometer(j, j.machines[0].modes[0], '2026-10-05').el.id, 'e1');
  } else assert.fail(`электрометр калибровки не найден: ${JSON.stringify(cal)}`);
});
