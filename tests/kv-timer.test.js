// kV-рентген: ошибка таймера по двум заданиям T₁ и T₂ (0.38.0). Формула τ = (T₂·R̄₁ − T₁·R̄₂)/(R̄₂ − R̄₁) — та же прямая,
// что у серии облучений; при задании по времени T₁ и T₂ — в секундах, τ пересчитывается в единицы задания. Допуск на |τ|
// (методика учреждения, не TRS-398 Rev.1) проверяется только для τ, вычисленной по данным режима.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKv, timerErrorTwoPoint, normalizeKv, KV_DEFAULTS } from '../src/core/kv.js';
import { normalizeKvVisit, newKvMode, computeKvVisit, kvTimerState } from '../src/core/kv-session.js';
import { SAMPLE_KV, SAMPLE_KV_ROWS, SAMPLE_KV_MODE2 } from '../src/core/sample-kv.js';
import { setLang } from '../src/core/i18n.js';

setLang('ru');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const has = (r, level, re) => r.messages.some((m) => m.level === level && re.test(m.text));
const D = (r) => r.trs.perUnit;
// пример без контрольных измерений: итог — по M₁ раздела 5
const BASE = { ...SAMPLE_KV, kv_Mc: ['', '', ''], kv_tau_tol: '' };

test('две точки: τ совпадает с таблицей проверки таймера пользователя (7 режимов, по одному показанию)', () => {
  // T₁ = 6 с, T₂ = 60 с; показания при T₁ и T₂ и τ из таблицы «Ошибка таймера» (Excel, формула =((T₂·R₁)−(T₁·R₂))/(R₂−R₁))
  const rows = [
    ['50 кВ', 0.1158, 1.303, -0.7328167115902958],
    ['75 кВ', 0.1527, 1.732, -0.7788260621794457],
    ['100 кВ', 0.135, 1.528, -0.7666905958363229],
    ['120 кВ', 0.0774, 0.8227, -0.3920568898430154],
    ['140 кВ', 0.08851, 0.9552, -0.48529462668312806],
    ['150 кВ', 0.06405, 0.6894, -0.4691772607339891],
    ['200 кВ', 0.06162, 0.7049, -0.8273224723293123],
  ];
  for (const [name, r1, r2, tau] of rows) near(timerErrorTwoPoint(6, 60, r1, r2).tau, tau, 1e-12, name);
  // в расчёте: задание в секундах, τ в секундах; при задании в минутах — та же τ, пересчитанная в минуты
  const [, r1, r2, tau] = rows[6];
  const f = { ...BASE, kv_tp_t1: '6', kv_tp_t2: '60', kv_tp_R1: [String(r1).replace('.', ',')], kv_tp_R2: [String(r2).replace('.', ',')] };
  const s = computeKv({ ...f, kv_set_unit: 's', kv_set: '60' });
  near(s.timer.tau, tau, 1e-12);
  near(s.timer.tauS, tau, 1e-12);
  const m = computeKv({ ...f, kv_set_unit: 'min', kv_set: '1' });
  near(m.timer.tau, tau / 60, 1e-14);
  near(m.timer.tauS, tau, 1e-12);
  near(D(m), D(s), 1e-12);
  assert.equal(m.timer.R1, r1);
  assert.equal(m.timer.R2, r2);
});

test('две точки: с несколькими показаниями — то же, что серия облучений с повторёнными заданиями, и то же, что известное τ', () => {
  const R1 = ['2,393', '2,394', '2,393'];
  const R2 = ['21,95', '21,95', '21,96'];
  const tp = computeKv({ ...BASE, kv_set_unit: 's', kv_set: '60', kv_timer_mode: 'twopoint', kv_tp_t1: '6', kv_tp_t2: '60', kv_tp_R1: R1, kv_tp_R2: R2 });
  const ser = computeKv({ ...BASE, kv_set_unit: 's', kv_set: '60', kv_timer_mode: 'measured', kv_tt: ['6', '6', '6', '60', '60', '60'], kv_tm: [...R1, ...R2] });
  near(tp.timer.tau, ser.timer.tau, 1e-12);
  near(tp.timer.tau, 0.60736196, 1e-8);
  const man = computeKv({ ...BASE, kv_set_unit: 'min', kv_set: '1', kv_timer_mode: 'manual', kv_tau: String(tp.timer.tau / 60).replace('.', ',') });
  const tpMin = computeKv({ ...BASE, kv_set_unit: 'min', kv_set: '1' });
  near(D(tpMin), D(man), 1e-12);
  // пример вкладки: τ = 0,0101 мин, как до 0.38.0 (серия 0,5 / 1 / 2 мин)
  near(computeKv(SAMPLE_KV).timer.tau, 0.010122699, 1e-9);
  assert.ok(!computeKv(SAMPLE_KV).messages.some((x) => x.level !== 'info' && /таймер|τ/.test(x.text)));
});

test('две точки: задание в МЕ — T₁, T₂ и τ в МЕ, без пересчёта и без допуска в секундах', () => {
  const r = computeKv({ ...BASE, kv_set_unit: 'MU', kv_set: '200', kv_tp_t1: '20', kv_tp_t2: '200', kv_tp_R1: ['4,41'], kv_tp_R2: ['43,90'], kv_tau_tol: '3' });
  near(r.timer.tau, (200 * 4.41 - 20 * 43.9) / (43.9 - 4.41), 1e-12);
  assert.equal(r.timer.tauS, undefined);
  assert.equal(r.timer.tol, undefined);
  assert.equal(r.timer.tUnit, 'MU');
});

test('две точки: ошибки ввода', () => {
  const f = { ...BASE, kv_set_unit: 'min', kv_set: '1' };
  assert.ok(has(computeKv({ ...f, kv_tp_t2: '6' }), 'error', /Ошибка таймера: задания T₁ и T₂ должны различаться/));
  assert.ok(has(computeKv({ ...f, kv_tp_R2: ['1,5'] }), 'error', /показание должно расти с заданием/));
  // неправдоподобно большая τ — предупреждение «больше 5 % от задания», как у других способов
  assert.ok(has(computeKv({ ...f, kv_tp_R1: ['0,2'], kv_tp_R2: ['21,95'] }), 'warn', /^τ = −0,092 мин — больше 5 % от задания/));
  assert.ok(has(computeKv({ ...f, kv_tp_t1: '' }), 'error', /Не заполнено поле «Задание T₁, с»/));
  assert.ok(has(computeKv({ ...f, kv_tp_R2: ['', '', ''] }), 'error', /Не заполнено поле «Показания при T₂»/));
  // разброс показаний при T₁ — то же предупреждение, что у других серий
  assert.ok(computeKv({ ...f, kv_tp_R1: ['2,393', '2,45', '2,393'] }).messages.some((m) => m.level === 'warn' && /при T₁/.test(m.text)));
});

test('допуск на |τ|: предупреждение сверх допуска, в допуске — без замечаний; неверный допуск — ошибка', () => {
  const f = { ...BASE, kv_set_unit: 'min', kv_set: '1' };
  const ok = computeKv({ ...f, kv_tau_tol: '3' });
  assert.equal(ok.timer.tol, 3);
  assert.equal(ok.timer.inTol, true);
  // τ ≈ 0,61 с: допуск 0,5 с превышен
  const over = computeKv({ ...f, kv_tau_tol: '0,5' });
  assert.equal(over.timer.inTol, false);
  assert.ok(has(over, 'warn', /^\|τ\| = 0,61 с больше допуска 0,5 с \(раздел 3\)\. .*в TRS-398 Rev\.1 его нет\.$/));
  assert.equal(over.flags.kv_tau_tol, 'warn');
  // известное τ и серия облучений тоже проверяются; τ в минутах переводится в секунды
  assert.ok(has(computeKv({ ...f, kv_timer_mode: 'manual', kv_tau: '-0,06', kv_tau_tol: '3' }), 'warn', /^\|τ\| = 3,60 с больше допуска 3 с/));
  assert.ok(has(computeKv({ ...f, kv_tau_tol: 'abc' }), 'error', /Допуск на ошибку таймера — число секунд больше нуля/));
  assert.ok(has(computeKv({ ...f, kv_tau_tol: '0' }), 'error', /Допуск на ошибку таймера/));
  // «не учитывать» и ошибка в данных таймера — допуск не проверяется
  assert.equal(computeKv({ ...f, kv_timer_mode: 'none', kv_tau_tol: '0,5' }).timer.tol, undefined);
  assert.equal(computeKv({ ...f, kv_tp_t2: '6', kv_tau_tol: '0,5' }).timer.tol, undefined);
});

// пример вкладки: режим 1 — 200 кВ со своей ошибкой таймера, режим 2 — 150 кВ без показаний таймера
const sampleVisit = () => {
  const v = normalizeKvVisit({ form: SAMPLE_KV, rows: [SAMPLE_KV, ...SAMPLE_KV_ROWS], active: 0 });
  const m2 = newKvMode(v.modes[0]);
  Object.assign(m2.shared, SAMPLE_KV_MODE2.shared);
  m2.rows = SAMPLE_KV_MODE2.rows;
  v.modes.push(m2);
  return normalizeKvVisit(v);
};

test('режимы аппарата: режим без показаний таймера берёт τ ближайшего; допуск проверяется только у своей τ', () => {
  const v = sampleVisit();
  assert.equal(kvTimerState(v.modes[1].shared), 'none');
  assert.equal(kvTimerState(v.modes[0].shared), 'own');
  v.common.kv_tau_tol = '0,5';
  const r = computeKvVisit(v);
  assert.equal(r.modes[1].tauMode, 0);
  near(r.modes[1].results[0].timer.tau, 0.010122699, 1e-9);
  assert.ok(has(r.modes[0].results[0], 'warn', /больше допуска 0,5 с/));
  assert.ok(!has(r.modes[1].results[0], 'warn', /больше допуска/));
  // свои показания в режиме 2: своя τ и своя проверка допуска
  Object.assign(v.modes[1].shared, { kv_tp_R1: ['2,10', '2,11', '2,10'], kv_tp_R2: ['20,10', '20,11', '20,10'] });
  const own = computeKvVisit(v).modes[1];
  assert.equal(own.tauMode, -1);
  assert.equal(own.timer.state, 'own');
  near(own.results[0].timer.tauS, (60 * 2.1033333 - 6 * 20.1033333) / (20.1033333 - 2.1033333), 1e-4);
  // показания только при T₁ — свои данные с ошибкой: τ не берётся, у режима ошибка
  v.modes[1].shared.kv_tp_R2 = ['', '', ''];
  const half = computeKvVisit(v).modes[1];
  assert.equal(half.tauMode, -1);
  assert.ok(has(half.results[0], 'error', /Не заполнено поле «Показания при T₂»/));
});

test('старые формы: способ ошибки таймера не указан, но есть точки серии — серия облучений', () => {
  const legacy = { ...SAMPLE_KV, kv_tt: ['0,50', '1,00', '2,00'], kv_tm: ['11,08', '21,96', '43,68'] };
  delete legacy.kv_timer_mode;
  assert.equal(normalizeKv(legacy).kv_timer_mode, 'measured');
  near(computeKv(legacy).timer.tau, 0.0101, 5e-5);
  assert.equal(normalizeKv({}).kv_timer_mode, 'twopoint');
  assert.equal(normalizeKv({ kv_timer_mode: 'junk' }).kv_timer_mode, KV_DEFAULTS.kv_timer_mode);
});
