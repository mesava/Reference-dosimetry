// Проверка выхода в пластинах (core/plates.js): привязка к калибровке в воде, отношение M_pl / M_pl,0, табл. 23 и ур. (45)
// TRS-398 Rev.1, запись в журнал и точки контрольной карты.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newJournal, normalizeJournal, recordTabBeam, PH_BEAM_KEYS, PH_CHAMBER_KEYS, PH_ELECTROMETER_KEYS } from '../src/core/journal.js';
import { PLASTICS, plasticOf, waterDepth, correctedReading, waterCalibrations, makeBinding, platesResult, recordPlates, setBinding, platesPoints } from '../src/core/plates.js';
import { CO60_HALF_LIFE_DAYS } from '../src/core/cobalt.js';
import { SAMPLE_FORM } from '../src/core/sample.js';

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const close = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≠ ${b}`);

/** Журнал с пучком 6 МВ, откалиброванным в воде 14.10.2026 (форма примера «МВ фотоны»). */
function journal() {
  let j = newJournal();
  j.chambers = [{ id: 'c1', form: pick(SAMPLE_FORM, PH_CHAMBER_KEYS) }];
  j.electrometers = [{ id: 'e1', form: pick(SAMPLE_FORM, PH_ELECTROMETER_KEYS) }];
  j.machines = [{ id: 'm1', name: 'Versa HD', kind: 'linac', beams: [{ id: 'b6', kind: 'photon', name: '6 МВ', active: true, form: pick(SAMPLE_FORM, PH_BEAM_KEYS) }] }];
  j = normalizeJournal(j);
  const r = recordTabBeam(j, { machineId: 'm1', beamId: 'b6', form: { ...SAMPLE_FORM, meta_date: '2026-10-14' }, kind: 'photon' });
  assert.ok(!r.error, r.error);
  return r.journal;
}
const BIND = { material: 'whiteps', rho: '1,045', depth: '10', date: '2026-10-14', amount: '100', M: ['12,580', '12,582', '12,578'], T: '20', P: '101,325' };

test('Табл. 23 TRS-398 Rev.1: c_pl, h_pl и ρ_pl пластиков; ур. (45): z_w = z_pl · c_pl', () => {
  assert.equal(PLASTICS.length, 7);
  assert.deepEqual(pick(plasticOf('solidwater'), ['cpl', 'hpl', 'rho']), { cpl: 0.964, hpl: 1.0, rho: 1.03 });
  assert.deepEqual(pick(plasticOf('plasticwater'), ['cpl', 'hpl', 'rho']), { cpl: 0.982, hpl: 0.998, rho: 1.01 });
  assert.deepEqual(pick(plasticOf('pmma'), ['cpl', 'hpl', 'rho']), { cpl: 0.947, hpl: 1.009, rho: 1.19 });
  assert.deepEqual(pick(plasticOf('whiteps'), ['cpl', 'hpl', 'rho']), { cpl: 0.933, hpl: 1.019, rho: 1.06 });
  // 2 см ПММА номинальной плотности: z_pl = 2,38 г/см², z_w = 2,38 · 0,947 = 2,254 г/см²
  close(waterDepth(2, 1.19, 0.947), 2.25386, 1e-5);
});

test('Показание в пластинах: k_TP по ур. (10) TRS-398 Rev.1 к 20 °C и 101,325 кПа, на МЕ; ⁶⁰Co — на (t + τ)', () => {
  const a = correctedReading({ M: ['10', '10'], amount: '100', T: '20', P: '101,325' });
  close(a.kTP, 1);
  close(a.perUnit, 0.1);
  const b = correctedReading({ M: ['10'], amount: '100', T: '22', P: '760', P_unit: 'mmHg' });
  close(b.kTP, 295.15 / 293.15, 1e-12);
  const c = correctedReading({ M: ['30'], amount: '1', T: '20', P: '101,325' }, { kind: 'cobalt', tauMin: 0.02 });
  close(c.perUnit, 30 / 1.02);
  // пустые поля — ошибки, без расчёта
  const e = correctedReading({ M: ['', ''], amount: '', T: '', P: '' });
  assert.equal(e.errors.length, 4);
  assert.ok(!Number.isFinite(e.perUnit));
});

test('Привязка к калибровке в воде: без калибровки — нельзя; M_pl,0 и итог калибровки сохраняются', () => {
  const j = journal();
  const cals = waterCalibrations(j, 'b6');
  assert.equal(cals.length, 1);
  // до даты калибровки в воде привязать нельзя
  assert.match(makeBinding(j, 'b6', { ...BIND, date: '2026-10-13' }).error, /нет калибровки в воде/);
  assert.match(makeBinding(j, 'b6', { ...BIND, rho: '' }).error, /плотность/);
  const { binding, error } = makeBinding(j, 'b6', BIND);
  assert.ok(!error, error);
  close(binding.M0, 0.1258);
  assert.equal(binding.calDate, '2026-10-14');
  close(binding.calValue, cals[0].summary.value);
  assert.equal(binding.chamberId, 'c1');
});

test('Выход в пластинах: D = D_кал · M_pl / M_pl,0; отклонение — от номинала калибровки; k_TP учитывается', () => {
  let j = journal();
  const { binding } = makeBinding(j, 'b6', BIND);
  j = setBinding(j, 'b6', binding);
  const cal = waterCalibrations(j, 'b6')[0].summary;
  // те же показания — тот же выход, что при калибровке
  const same = platesResult(j, 'b6', { date: '2026-10-21', amount: '100', M: ['12,580'], T: '20', P: '101,325' });
  assert.ok(same.ok, same.errors.join(' '));
  close(same.ratio, 1);
  close(same.value, cal.value, 1e-12);
  close(same.deviation, cal.deviation, 1e-9);
  assert.deepEqual(same.warnings, []);
  // показание на 1 % больше — выход на 1 % больше
  const up = platesResult(j, 'b6', { date: '2026-10-21', amount: '100', M: ['12,7058'], T: '20', P: '101,325' });
  close(up.devFromCal, 1, 1e-9);
  close(up.value, cal.value * 1.01, 1e-12);
  // теплее на 3 °C: показание меньше в (273,15 + 20)/(273,15 + 23), после k_TP — тот же выход
  const warm = platesResult(j, 'b6', { date: '2026-10-21', amount: '100', M: [String(12.58 * 293.15 / 296.15)], T: '23', P: '101,325' });
  close(warm.ratio, 1, 1e-12);
  // вне допуска — предупреждение: проверить в воде
  const out = platesResult(j, 'b6', { date: '2026-10-21', amount: '100', M: ['13,2'], T: '20', P: '101,325' });
  assert.equal(out.status, 'out');
  assert.ok(out.warnings.some((w) => /проверьте выход в воде/.test(w.text)));
  // раньше привязки — ошибка
  assert.ok(platesResult(j, 'b6', { date: '2026-10-13', amount: '100', M: ['12,58'], T: '20', P: '101,325' }).errors.some((e) => /раньше привязки/.test(e)));
  // новая калибровка в воде после привязки — предупреждение
  const j2 = recordTabBeam(j, { machineId: 'm1', beamId: 'b6', form: { ...SAMPLE_FORM, meta_date: '2026-11-14' }, kind: 'photon', today: '2026-12-31' }).journal;
  assert.ok(platesResult(j2, 'b6', { today: '2026-12-31', date: '2026-11-20', amount: '100', M: ['12,58'], T: '20', P: '101,325' }).warnings.some((w) => /повторите привязку/.test(w.text)));
});

test('⁶⁰Co в пластинах: отклонение — от ожидаемой по распаду от даты привязки', () => {
  const j = normalizeJournal({ ...newJournal(), machines: [{ id: 'm', name: 'Терагам', kind: 'cobalt', beams: [{ id: 'co', kind: 'cobalt', name: 'РИП 80', active: true, form: {} }] }] });
  const binding = { date: '2026-01-01', calDate: '2026-01-01', calValue: 100, calDeviation: 0, tol: 2, tauMin: 0, M0: 30 };
  const half = new Date(Date.parse('2026-01-01') + CO60_HALF_LIFE_DAYS * 86400000).toISOString().slice(0, 10);
  // через период полураспада показание вдвое меньше — отклонения нет, мощность дозы — вдвое меньше
  const r = platesResult(j, 'co', { date: half, today: '2040-01-01', amount: '1', M: ['15'], T: '20', P: '101,325' }, binding);
  assert.ok(r.ok, r.errors.join(' '));
  close(r.deviation, 0, 0.05);
  close(r.value, 50, 0.03);
});

test('Запись в журнал: тот же пучок за ту же дату заменяется; новая привязка — новый отсчёт карты; журнал из файла их сохраняет', () => {
  let j = journal();
  j = setBinding(j, 'b6', makeBinding(j, 'b6', BIND).binding);
  const inp = (date, m) => ({ date, amount: '100', M: [m], T: '20', P: '101,325', staff: 'Иванов' });
  let r = recordPlates(j, { machineId: 'm1', beamId: 'b6', input: inp('2026-10-15', '12,58') });
  assert.ok(!r.error, r.error);
  j = r.journal;
  r = recordPlates(j, { machineId: 'm1', beamId: 'b6', input: inp('2026-10-15', '12,60') });
  assert.equal(r.replaced, true);
  j = r.journal;
  assert.equal(j.plateChecks.length, 1);
  j = recordPlates(j, { machineId: 'm1', beamId: 'b6', input: inp('2026-10-16', '12,59') }).journal;
  // новая привязка (другая M_pl,0) — с неё новый отсчёт
  j = setBinding(j, 'b6', makeBinding(j, 'b6', { ...BIND, date: '2026-10-17', M: ['12,40'] }).binding);
  j = recordPlates(j, { machineId: 'm1', beamId: 'b6', input: inp('2026-10-18', '12,41') }).journal;
  const pts = platesPoints(j, 'b6');
  assert.deepEqual(pts.map((p) => p.restart), [false, false, true]);
  assert.equal(pts[2].reason, 'binding');
  // без привязки записать нельзя
  assert.match(recordPlates(setBinding(j, 'b6', null), { machineId: 'm1', beamId: 'b6', input: inp('2026-10-19', '12,4') }).error, /не привязаны/);
  // журнал из файла: проверки и привязка сохраняются
  const back = normalizeJournal(JSON.parse(JSON.stringify(j)));
  assert.equal(back.plateChecks.length, 3);
  assert.equal(back.machines[0].beams[0].plates.date, '2026-10-17');
  assert.deepEqual(normalizeJournal({ ...newJournal() }).plateChecks, []);
});

test('Дата в будущем: проверка в пластинах и привязка не записываются', () => {
  let j = journal();
  j = setBinding(j, 'b6', makeBinding(j, 'b6', BIND).binding);
  const inp = { date: '2026-10-25', today: '2026-10-23', amount: '100', M: ['12,58'], T: '20', P: '101,325' };
  assert.ok(platesResult(j, 'b6', inp).errors.some((e) => /25\.10\.2026 — в будущем \(сегодня 23\.10\.2026\)/.test(e)));
  assert.match(recordPlates(j, { machineId: 'm1', beamId: 'b6', input: inp }).error, /в будущем/);
  assert.ok(platesResult(j, 'b6', { ...inp, today: '2026-10-25' }).ok, 'сегодняшняя дата — можно');
  assert.match(makeBinding(j, 'b6', { ...BIND, date: '2026-10-25', today: '2026-10-23' }).error, /в будущем/);
});
