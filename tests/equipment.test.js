// Оборудование журнала: подразделение, список электрометров, длина полости камеры, сведения о калибровке камеры.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJournal, newJournal, orgText, certText, calibrationChecks, withChamberLength, beamForm, computeSessionBeam, applyTabFormToBeam, SESSION_DEFAULTS, sessionEquipDefaults, chamberPreferred, equipmentNoDue, futureDateError, recordTabBeam } from '../src/core/journal.js';
import { SAMPLE_FORM } from '../src/core/sample.js';
import { parseElectrometer, ELECTROMETERS, electrometerName } from '../src/core/electrometers.js';

const base = () => {
  const j = newJournal();
  j.institution = 'ООО Пример';
  j.department = 'Отделение лучевой терапии';
  j.electrometers = [
    { id: 'e1', form: { el_model: 'PTW UNIDOS Tango', el_serial: '1', el_kelec: '1,000' } },
    { id: 'e2', form: { el_model: 'IBA Dose 1', el_serial: '2', el_kelec: '1,000' } },
  ];
  j.chambers = [{ id: 'c1', form: { ch_model: 'PTW30013', ch_serial: '739475', ch_ndw: '0,05235', ch_ndw_unit: 'Gy/nC', ch_klab: '1,000', ch_T0: '20', ch_P0: '101,325' }, calDate: '2026-03-12', calCert: '123', calLab: 'ВНИИФТРИ' }];
  j.machines = [{ id: 'm1', name: 'Versa HD', serial: '', kind: 'linac', beams: [{ id: 'b1', kind: 'photon', name: '6 МВ', chamberId: 'c1', electrometerId: 'e1', active: true, form: { rd_V1: '300', rd_V2: '150', rd_polarity: '+', rd_mu: '100' } }] }];
  return normalizeJournal(j);
};

test('Подразделение: хранится в журнале, в протоколах — «учреждение, подразделение»; старый журнал без него читается', () => {
  const j = base();
  assert.equal(j.department, 'Отделение лучевой терапии');
  assert.equal(orgText(j), 'ООО Пример, Отделение лучевой терапии');
  const { form } = beamForm(j, { ...SESSION_DEFAULTS, date: '2026-10-19', machineId: 'm1' }, j.machines[0], j.machines[0].beams[0]);
  assert.equal(form.meta_institution, 'ООО Пример, Отделение лучевой терапии');
  const old = normalizeJournal({ ...newJournal(), institution: 'Старое', department: undefined });
  assert.equal(old.department, '');
  assert.equal(orgText(old), 'Старое');
});

test('Электрометры: «производитель модель» из списка узнаётся, своё название — «другой»', () => {
  assert.deepEqual(parseElectrometer('PTW UNIDOS Tango'), { maker: 'PTW', model: 'UNIDOS Tango' });
  assert.deepEqual(parseElectrometer('  ptw  unidos webline '), { maker: 'PTW', model: 'UNIDOS webline' });
  assert.deepEqual(parseElectrometer('Самодельный'), { maker: 'other', model: '' });
  assert.deepEqual(parseElectrometer(''), { maker: '', model: '' });
  for (const g of ELECTROMETERS) for (const m of g.models) assert.equal(parseElectrometer(electrometerName(g.maker, m)).model, m);
});

test('Свидетельство о калибровке камеры — строкой для протокола', () => {
  assert.equal(certText(base().chambers[0]), 'свидетельство № 123 от 12.03.2026, ВНИИФТРИ');
  assert.equal(certText({ calLab: 'ВНИИФТРИ' }), 'калибровка, ВНИИФТРИ');
  assert.equal(certText({}), '');
});

test('Калибровка камеры: другой электрометр с k_elec = 1, другое напряжение и полярность — замечания', () => {
  const j = base();
  assert.deepEqual(calibrationChecks(j, 'c1', 'e1', j.machines[0].beams[0].form, 'photon'), [], 'без сведений о калибровке замечаний нет');
  Object.assign(j.chambers[0], { calEl: 'e2', calV: '400', calPol: '-' });
  const notes = calibrationChecks(j, 'c1', 'e1', j.machines[0].beams[0].form, 'photon');
  assert.equal(notes.length, 3);
  assert.equal(notes[0].level, 'warn');
  assert.match(notes[0].text, /калибровалась с электрометром IBA Dose 1/);
  assert.match(notes[1].text, /V₁ = 300 В отличается от напряжения калибровки камеры 400 В/);
  assert.match(notes[2].text, /Полярность измерения \(\+\) не та, что при калибровке камеры \(−\)/);
  // с электрометром калибровки, тем же напряжением и полярностью — без замечаний
  assert.deepEqual(calibrationChecks(j, 'c1', 'e2', { rd_V1: '-400', rd_polarity: '-' }, 'photon'), []);
  // у другого электрометра свой k_elec — только справка
  j.electrometers[0].form.el_kelec = '1,002';
  assert.equal(calibrationChecks(j, 'c1', 'e1', { rd_V1: '400', rd_polarity: '-' }, 'photon')[0].level, 'info');
  // замечания попадают в расчёт пучка в сеансе
  const s = { ...SESSION_DEFAULTS, id: 's1', date: '2026-10-19', machineId: 'm1', env: { T: '20', P: '101,3', P_unit: 'kPa', H: '' } };
  const calc = computeSessionBeam(j, s, { beamId: 'b1', rd_M1: ['10', '10', '10'] });
  assert.ok(calc.result.messages.some((m) => m.cal && /калибровалась с электрометром/.test(m.text)));
});

test('Длина полости из записи камеры — в k_vol пучка, если своей у пучка нет; в пучок обратно не записывается', () => {
  assert.equal(withChamberLength({ prof_length: '' }, { length: '23,5' }).prof_length, '23,5');
  assert.equal(withChamberLength({ prof_length: '20' }, { length: '23,5' }).prof_length, '20');
  assert.equal(withChamberLength({ prof_length: '' }, { length: '' }).prof_length, '');
  const j = base();
  j.chambers[0].length = '23,5';
  const s = { ...SESSION_DEFAULTS, date: '2026-10-19', machineId: 'm1' };
  const { form } = beamForm(j, s, j.machines[0], j.machines[0].beams[0]);
  assert.equal(form.prof_length, '23,5');
  // «Сохранить в журнал» из вкладки: длина камеры не становится своей длиной пучка
  const res = applyTabFormToBeam(j, 'm1', 'b1', { ...form, meta_beam: '6 МВ' }, 'photon');
  assert.equal(res.journal.machines[0].beams[0].form.prof_length, '');
});

test('Сеанс: камера и электрометр по умолчанию — из последнего сеанса аппарата, иначе прежний выбор у пучка, иначе первые', () => {
  const j = base();
  // журнал до 0.21.0: камера и электрометр выбраны у пучка
  assert.deepEqual(sessionEquipDefaults(j, 'm1', 'photon'), { chamberId: 'c1', electrometerId: 'e1' });
  // без выбора у пучка — первая подходящая камера и первый электрометр
  j.machines[0].beams[0].chamberId = '';
  j.machines[0].beams[0].electrometerId = '';
  assert.deepEqual(sessionEquipDefaults(j, 'm1', 'photon'), { chamberId: 'c1', electrometerId: 'e1' });
  // записанный сеанс с электрометром e2 — он и по умолчанию
  j.sessions = [{ id: 's0', machineId: 'm1', date: '2026-10-01', beams: [{ beamId: 'b1', kind: 'photon', chamberId: 'c1', electrometerId: 'e2' }] }];
  assert.equal(sessionEquipDefaults(j, 'm1', 'photon').electrometerId, 'e2');
  // для электронов фотонная камера из базы электронов тоже годится; для другого аппарата сеанс не учитывается
  assert.equal(sessionEquipDefaults(j, 'mX', 'photon').electrometerId, 'e1');
});

test('Сеанс: напряжения, полярность, МЕ и геометрия пучка из сеанса поверх настроек пучка', () => {
  const j = base();
  const s = { ...SESSION_DEFAULTS, date: '2026-10-19', machineId: 'm1' };
  const b = j.machines[0].beams[0];
  const plain = beamForm(j, s, j.machines[0], b).form;
  assert.equal(plain.rd_V1, '300');
  assert.equal(plain.setup_geometry, 'SSD');
  const over = beamForm(j, s, j.machines[0], b, { rd_V1: '400', rd_polarity: '-', rd_mu: '200', setup_geometry: 'SAD', chamberId: 'c1', electrometerId: 'e2' }).form;
  assert.equal(over.rd_V1, '400');
  assert.equal(over.rd_polarity, '-');
  assert.equal(over.rd_mu, '200');
  assert.equal(over.setup_geometry, 'SAD');
  assert.equal(over.el_model, 'IBA Dose 1', 'электрометр — выбранный в сеансе');
  // пустое значение в сеансе — из настроек пучка
  assert.equal(beamForm(j, s, j.machines[0], b, { rd_V1: '' }).form.rd_V1, '300');
});

test('Камера пучка по умолчанию: которой мерили этот пучок; иначе подходящая виду пучка (электроны — плоскопараллельная)', () => {
  const j = base();
  j.machines[0].beams[0].chamberId = '';
  j.machines[0].beams.push({ id: 'b2', kind: 'electron', name: '12 МэВ', active: true, form: {} });
  j.chambers.push({ id: 'c2', form: { ch_model: 'ROOS', ch_serial: '2', ch_ndw: '0,0815', ch_ndw_unit: 'Gy/nC' } });
  assert.equal(chamberPreferred(j.chambers[0].form, 'electron'), false);
  assert.equal(chamberPreferred(j.chambers[1].form, 'electron'), true);
  assert.equal(chamberPreferred(j.chambers[0].form, 'photon'), true);
  assert.equal(chamberPreferred({ ch_model: 'OTHER', e_other_type: 'pp' }, 'electron'), true);
  // без записей: для электронов — Roos, хотя Farmer первый в списке и годится; для фотонов — Farmer
  assert.equal(sessionEquipDefaults(j, 'm1', 'electron', 'b2').chamberId, 'c2');
  assert.equal(sessionEquipDefaults(j, 'm1', 'photon', 'b1').chamberId, 'c1');
  // пучок мерили Farmer'ом — он и предлагается
  j.sessions = [{ id: 's1', machineId: 'm1', date: '2026-10-01', beams: [{ beamId: 'b2', kind: 'electron', chamberId: 'c1', electrometerId: 'e2' }] }];
  assert.deepEqual(sessionEquipDefaults(j, 'm1', 'electron', 'b2'), { chamberId: 'c1', electrometerId: 'e2' });
});

test('Сроки калибровки не заданы — камеры и электрометры перечисляются', () => {
  const j = base();
  j.electrometers[0].dueDate = '2027-03-01';
  assert.deepEqual(equipmentNoDue(j).map((x) => x.id), ['c1', 'e2']);
});

test('Дата в будущем: измерение вкладки в журнал не записывается', () => {
  assert.equal(futureDateError('2026-10-23', '2026-10-23'), '');
  assert.match(futureDateError('2026-10-24', '2026-10-23'), /24\.10\.2026 — в будущем \(сегодня 23\.10\.2026\)/);
  const j = base();
  const rec = (date, today) => recordTabBeam(j, { machineId: 'm1', beamId: 'b1', form: { ...SAMPLE_FORM, meta_date: date }, kind: 'photon', today });
  assert.match(rec('2026-10-24', '2026-10-23').error, /в будущем/);
  assert.ok(!rec('2026-10-23', '2026-10-23').error);
});
