// kV-рентген: ошибка таймера по серии облучений с разным заданием (0.57.0). Задания — столбцы таблицы, при каждом —
// повторные показания; прямая M̄ = a·T + b проводится по средним, τ = b/a (TRS-398 Rev.1, разд. 9.4.2: доза относится
// к X + τ). Задания серии при задании по времени — в секундах или минутах, τ пересчитывается в единицы задания.
// Данные — условные: M = 0,568·(T − 2,38) нКл, повторы отличаются от среднего на +δ, −δ и 0, так что средние лежат точно
// на прямой и τ = −2,38 с.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKv, normalizeKv, timerSeriesGrid, timerSeriesFromPairs, KV_DEFAULTS } from '../src/core/kv.js';
import { normalizeKvVisit, newKvMode, kvTimerState, computeKvVisit } from '../src/core/kv-session.js';
import { SAMPLE_KV } from '../src/core/sample-kv.js';
import { setLang } from '../src/core/i18n.js';

setLang('ru');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const has = (r, level, re) => r.messages.some((m) => m.level === level && re.test(m.text));
const ru = (v) => String(Math.round(v * 1e6) / 1e6).replace('.', ',');

const SET_S = [6, 26, 46, 66, 86, 106, 126, 146, 166];
const line = (t) => 0.568 * (t - 2.38);
const reps = (t) => [line(t) + 0.004, line(t) - 0.004, line(t)].map(ru);
const SERIES = { kv_timer_mode: 'measured', kv_ts_unit: 's', kv_ts_t: SET_S.map(String), kv_ts_R: SET_S.map(reps) };
const BASE = { ...SAMPLE_KV, kv_Mc: ['', '', ''], kv_tau_tol: '', kv_ref: '' };

test('серия: прямая по средним, τ = b/a в секундах заданий и в минутах задания облучения', () => {
  const r = computeKv({ ...BASE, kv_set_unit: 'min', kv_set: '1', ...SERIES });
  assert.equal(r.timer.tUnit, 's');
  near(r.timer.tauT, -2.38, 1e-5);
  near(r.timer.tauS, -2.38, 1e-5);
  near(r.timer.tau, -2.38 / 60, 1e-7);
  near(r.timer.slope, 0.568, 1e-7);
  assert.equal(r.timer.n, 9);
  // на графике и в расчёте — по одной точке на задание: среднее из трёх показаний
  assert.equal(r.timer.points.length, 9);
  assert.deepEqual(r.timer.points.map((p) => p.n), Array(9).fill(3));
  near(r.timer.points[0].mean, line(6), 1e-6);
  assert.ok(r.timer.residualPct < 1e-3);
  assert.ok(!r.messages.some((m) => m.level !== 'info' && /задани|прям/i.test(m.text)));
  // то же при задании облучения в секундах: τ без пересчёта
  const s = computeKv({ ...BASE, kv_set_unit: 's', kv_set: '60', ...SERIES });
  near(s.timer.tau, -2.38, 1e-5);
  near(s.trs.perUnit, r.trs.perUnit, 1e-9);
});

test('серия: задания в минутах — та же τ; при задании в МЕ задания и τ в МЕ', () => {
  const min = SET_S.map((t) => ru(t / 60));
  const m = computeKv({ ...BASE, kv_set_unit: 's', kv_set: '60', ...SERIES, kv_ts_unit: 'min', kv_ts_t: min });
  assert.equal(m.timer.tUnit, 'min');
  near(m.timer.tauT, -2.38 / 60, 1e-6);
  near(m.timer.tau, -2.38, 5e-5);
  const mu = computeKv({ ...BASE, kv_set_unit: 'MU', kv_set: '200', ...SERIES });
  assert.equal(mu.timer.tUnit, 'MU');
  near(mu.timer.tau, -2.38, 1e-5);
  assert.equal(mu.timer.tauS, undefined);
});

test('серия: τ та же, что по двум заданиям при тех же показаниях', () => {
  const R1 = ['2,393', '2,394', '2,393'];
  const R2 = ['21,95', '21,95', '21,96'];
  const tp = computeKv({ ...BASE, kv_set_unit: 's', kv_set: '60', kv_timer_mode: 'twopoint', kv_tp_t1: '6', kv_tp_t2: '60', kv_tp_R1: R1, kv_tp_R2: R2 });
  const ser = computeKv({ ...BASE, kv_set_unit: 's', kv_set: '60', kv_timer_mode: 'measured', kv_ts_t: ['6', '60'], kv_ts_R: [R1, R2] });
  near(ser.timer.tau, tp.timer.tau, 1e-12);
});

test('серия: ошибки и замечания по столбцам', () => {
  const f = { ...BASE, kv_set_unit: 'min', kv_set: '1', ...SERIES };
  const R = (j, v) => f.kv_ts_R.map((c, k) => (k === j ? v : c));
  const T = (j, v) => f.kv_ts_t.map((c, k) => (k === j ? v : c));
  // показания без задания и задание без показаний — ошибка этого столбца
  const noT = computeKv({ ...f, kv_ts_t: T(2, '') });
  assert.ok(has(noT, 'error', /Ошибка таймера, задание 3: показания есть, а задание не введено/));
  assert.equal(noT.flags.kv_ts_2, 'error');
  assert.equal(noT.flags.kv_timer, 'error');
  assert.equal(noT.flags.kv_ts_1, undefined);
  assert.ok(has(computeKv({ ...f, kv_ts_R: R(4, ['', '', '']) }), 'error', /задание 5: нет показаний/));
  assert.ok(has(computeKv({ ...f, kv_ts_t: T(0, '0') }), 'error', /задание 1: задание должно быть больше нуля/));
  assert.ok(has(computeKv({ ...f, kv_ts_R: R(1, ['13,4', 'abc', '']) }), 'error', /задание 2: не удалось прочитать ячейку 2/));
  // пустой столбец целиком пропускается
  const blank = computeKv({ ...f, kv_ts_t: [...f.kv_ts_t, ''], kv_ts_R: [...f.kv_ts_R, ['', '', '']] });
  near(blank.timer.tauS, -2.38, 1e-5);
  // меньше трёх показаний — справка; разброс в столбце — предупреждение на этом столбце
  assert.ok(has(computeKv({ ...f, kv_ts_R: R(0, [reps(6)[2], '', '']) }), 'info', /^При задании 1 меньше трёх показаний/));
  const sp = computeKv({ ...f, kv_ts_R: R(3, [ru(line(66) * 1.01), ru(line(66) * 0.99), ru(line(66))]) });
  assert.ok(has(sp, 'warn', /Разброс показаний при задании 4 \(66 с\)/));
  assert.equal(sp.flags.kv_ts_3, 'warn');
  // средние не на прямой — предупреждение на всей таблице
  const off = computeKv({ ...f, kv_ts_R: R(8, reps(166).map((v) => ru(Number(v.replace(',', '.')) * 1.02))) });
  assert.ok(has(off, 'warn', /^Средние показания при разных заданиях плохо ложатся на прямую/));
  assert.equal(off.flags.kv_ts_all, 'warn');
  // одно задание — прямую не провести; показания разного знака
  assert.ok(has(computeKv({ ...f, kv_ts_t: ['6', ''], kv_ts_R: [reps(6), ['', '', '']] }), 'error', /нужны хотя бы два задания с показаниями/));
  assert.ok(has(computeKv({ ...f, kv_ts_R: R(1, reps(26).map((v) => `-${v}`)) }), 'error', /средние показания разного знака/));
});

test('таблица серии: столбцы одной длины, не меньше двух заданий; пары до 0.57.0 собираются по заданиям', () => {
  assert.deepEqual(timerSeriesGrid(undefined, undefined), { t: ['', ''], R: [['', '', ''], ['', '', '']] });
  assert.deepEqual(timerSeriesGrid(['6', '26', '46'], [['1', '2'], ['3']]), { t: ['6', '26', '46'], R: [['1', '2'], ['3', ''], ['', '']] });
  assert.deepEqual(normalizeKv({}).kv_ts_R, KV_DEFAULTS.kv_ts_R);
  assert.notEqual(normalizeKv({}).kv_ts_R[0], KV_DEFAULTS.kv_ts_R[0]);
  assert.equal(normalizeKv({ kv_ts_unit: 'h' }).kv_ts_unit, 's');
  // как в старой форме: три облучения при каждом задании подряд, задания в минутах
  const pairs = timerSeriesFromPairs(['0,1', '0,1', '0,1', '0,43', '0,43', '0,43', '0,767', '', '0,767'], ['2,04', '2,022', '2,028', '13,38', '13,42', '13,37', '24,78', '', '24,79']);
  assert.deepEqual(pairs.kv_ts_t, ['0,1', '0,43', '0,767']);
  assert.deepEqual(pairs.kv_ts_R, [['2,04', '2,022', '2,028'], ['13,38', '13,42', '13,37'], ['24,78', '24,79', '']]);
  const old = normalizeKv({ ...SAMPLE_KV, kv_set_unit: 'min', kv_timer_mode: 'measured', kv_tt: ['0,5', '1', '2'], kv_tm: ['11,08', '21,96', '43,68'] });
  assert.equal(old.kv_ts_unit, 'min');
  assert.deepEqual(old.kv_ts_t, ['0,5', '1', '2']);
  assert.equal(old.kv_tt, undefined);
  assert.equal(old.kv_tm, undefined);
});

test('режимы аппарата: новый режим берёт задания серии и их единицу, показания — свои; без показаний τ из соседнего', () => {
  const v = normalizeKvVisit({ ...BASE, kv_set_unit: 'min', kv_set: '1', ...SERIES });
  const m = newKvMode(v.modes[0]);
  assert.deepEqual(m.shared.kv_ts_t, SERIES.kv_ts_t);
  assert.equal(m.shared.kv_ts_unit, 's');
  assert.ok(m.shared.kv_ts_R.every((c) => c.every((x) => x === '')));
  assert.equal(kvTimerState(m.shared), 'none');
  assert.equal(kvTimerState(v.modes[0].shared), 'own');
  Object.assign(m.shared, { kv_kv: '150' });
  v.modes.push(m);
  const r = computeKvVisit(normalizeKvVisit(v));
  assert.equal(r.modes[1].tauMode, 0);
  near(r.modes[1].results[0].timer.tau, -2.38 / 60, 1e-7);
  // копия, а не те же массивы
  m.shared.kv_ts_t[0] = '7';
  assert.equal(v.modes[0].shared.kv_ts_t[0], '6');
});
