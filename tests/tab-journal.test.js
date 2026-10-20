// Измерение во вкладке дозиметрии → журнал: подстановка пучка журнала во вкладку и запись результата.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newJournal, normalizeJournal, tabBeamPatch, recordTabBeam, tabRecordOf, lastCalibration, saveBeamSettings, PH_BEAM_KEYS, PH_CHAMBER_KEYS, PH_ELECTROMETER_KEYS } from '../src/core/journal.js';
import { SAMPLE_FORM } from '../src/core/sample.js';

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

const journal = () => {
  const j = newJournal();
  j.institution = 'ООО Пример';
  j.department = 'ОЛТ';
  j.chambers = [{ id: 'c1', form: pick(SAMPLE_FORM, PH_CHAMBER_KEYS) }];
  j.electrometers = [{ id: 'e1', form: pick(SAMPLE_FORM, PH_ELECTROMETER_KEYS) }];
  j.machines = [{ id: 'm1', name: 'Versa HD', serial: '7213', kind: 'linac', beams: [
    { id: 'b6', kind: 'photon', name: '6 МВ', active: true, form: pick(SAMPLE_FORM, PH_BEAM_KEYS) },
    { id: 'b10', kind: 'photon', name: '10 МВ', active: true, form: pick(SAMPLE_FORM, PH_BEAM_KEYS) },
  ] }];
  return normalizeJournal(j);
};
const tab = (over = {}) => ({ ...SAMPLE_FORM, meta_date: '2026-10-19', ...over });

test('Подстановка пучка журнала во вкладку: настройки пучка, камера, электрометр, названия; показания не трогаются', () => {
  const j = journal();
  const r = tabBeamPatch(j, 'm1', 'b6', tab({ rd_M1: ['1', '2', '3'] }));
  assert.equal(r.kind, 'photon');
  assert.equal(r.patch.ch_model, 'PTW30013');
  assert.equal(r.patch.ch_ndw, '0,05335');
  assert.equal(r.patch.meta_beam, '6 МВ');
  assert.equal(r.patch.meta_institution, 'ООО Пример, ОЛТ');
  assert.match(r.patch.meta_machine, /Versa HD/);
  assert.equal(r.patch.meta_energy, '6', 'энергия — по названию пучка');
  // пустое учреждение журнала не стирает учреждение вкладки
  const j0 = journal();
  j0.institution = '';
  j0.department = '';
  assert.ok(!('meta_institution' in tabBeamPatch(j0, 'm1', 'b6', tab()).patch));
  assert.ok(!('rd_M1' in r.patch), 'показания не подставляются');
  assert.ok(!('meta_date' in r.patch), 'дата не подставляется');
  // калибровка: качество пучка измеряют — поля очищены
  assert.equal(r.patch.qtrs_v20, '');
});

test('Запись в журнал: пучки одного аппарата за день — одна запись; повтор заменяет; проверка выхода — отдельно', () => {
  let j = journal();
  const a = recordTabBeam(j, { machineId: 'm1', beamId: 'b6', form: tab(), kind: 'photon' });
  assert.ok(!a.error, a.error);
  assert.equal(a.replaced, false);
  assert.ok(a.chamberFound && a.electrometerFound);
  j = a.journal;
  assert.equal(j.sessions.length, 1);
  assert.equal(j.sessions[0].mode, 'cal');
  assert.equal(j.sessions[0].beams[0].chamberId, 'c1');
  assert.ok(Number.isFinite(j.sessions[0].beams[0].summary.value));
  // второй пучок того же дня — в ту же запись
  j = recordTabBeam(j, { machineId: 'm1', beamId: 'b10', form: tab({ meta_beam: '10 МВ' }), kind: 'photon' }).journal;
  assert.equal(j.sessions.length, 1);
  assert.deepEqual(j.sessions[0].beams.map((b) => b.beamId).sort(), ['b10', 'b6']);
  // повтор того же пучка — замена
  const again = recordTabBeam(j, { machineId: 'm1', beamId: 'b6', form: tab({ rd_M1: ['12,350', '12,351', '12,349'] }), kind: 'photon' });
  assert.equal(again.replaced, true);
  j = again.journal;
  assert.equal(j.sessions[0].beams.length, 2);
  assert.ok(tabRecordOf(j, { machineId: 'm1', beamId: 'b6', form: tab(), kind: 'photon' }));
  // последняя калибровка пучка — из этой записи
  const last = lastCalibration(j, 'b6');
  assert.equal(last.date, '2026-10-19');
  assert.ok(Number.isFinite(last.kpol) && Number.isFinite(last.ks));
  // проверка выхода на следующий день: k_pol и k_s подставляются из калибровки; запись — отдельная
  const p = tabBeamPatch(j, 'm1', 'b6', tab({ meta_date: '2026-10-20', rd_fixed: true }));
  assert.equal(p.patch.rd_fixed, true);
  assert.ok(Number.isFinite(Number(String(p.patch.rd_fixed_kpol).replace(',', '.'))));
  assert.equal(p.patch.qtrs_v20, SAMPLE_FORM.qtrs_v20, 'качество — из калибровки');
  const chk = recordTabBeam(j, { machineId: 'm1', beamId: 'b6', form: tab({ ...p.patch, meta_date: '2026-10-20', rd_fixed: true }), kind: 'photon' });
  assert.ok(!chk.error, chk.error);
  assert.equal(chk.journal.sessions.length, 2);
  assert.equal(chk.session.mode, 'check');
});

test('Запись в журнал: без даты, с ошибками или с пучком другого вида — не записывается', () => {
  const j = journal();
  assert.match(recordTabBeam(j, { machineId: 'm1', beamId: 'b6', form: tab({ meta_date: '' }), kind: 'photon' }).error, /дату/);
  assert.match(recordTabBeam(j, { machineId: 'm1', beamId: 'b6', form: tab({ rd_M1: ['', '', ''] }), kind: 'photon' }).error, /ошибки/);
  assert.match(recordTabBeam(j, { machineId: 'm1', beamId: 'b6', form: tab(), kind: 'electron' }).error, /другого вида/);
  assert.match(recordTabBeam(j, { machineId: 'm1', beamId: 'nope', form: tab(), kind: 'photon' }).error, /не найден/);
});

test('«Сохранить настройки пучка в журнал»: только настройки пучка — камера, электрометр и название пучка не меняются', () => {
  const j = journal();
  const before = JSON.stringify({ chambers: j.chambers, electrometers: j.electrometers });
  // на вкладке — другой N_D,w той же камеры, другой k_elec и вовсе другая камера во второй попытке
  const r = saveBeamSettings(j, 'm1', 'b6', tab({ dd_zmax: '1,6', ch_ndw: '0,06000', el_kelec: '1,010', meta_beam: 'Переименован' }), 'photon');
  assert.ok(r.saved);
  const b = r.journal.machines[0].beams.find((x) => x.id === 'b6');
  assert.equal(b.form.dd_zmax, '1,6', 'настройка пучка сохранена');
  assert.equal(b.name, '6 МВ', 'название пучка — только в «Оборудовании»');
  assert.ok(!('ch_ndw' in b.form) && !('el_kelec' in b.form) && !('rd_M1' in b.form), 'в настройках пучка нет полей камеры, электрометра и показаний');
  assert.equal(JSON.stringify({ chambers: r.journal.chambers, electrometers: r.journal.electrometers }), before, 'камеры и электрометры журнала не изменились');
  const r2 = saveBeamSettings(j, 'm1', 'b6', tab({ ch_model: 'NE2571', ch_serial: '999' }), 'photon');
  assert.equal(r2.journal.chambers.length, 1, 'другая камера вкладки в журнал не добавляется');
  assert.equal(JSON.stringify(j.machines[0].beams[0].form), JSON.stringify(journal().machines[0].beams[0].form), 'исходный журнал не меняется');
  assert.equal(saveBeamSettings(j, 'm1', 'nope', tab(), 'photon').saved, false);
});
