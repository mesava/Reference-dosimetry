// График Яффе: прямая по точкам, M_нас и k_s, автоматический поиск линейной области (умножение заряда выше V_max),
// сравнение с методом двух напряжений, обратная полярность, зависимость от дозы за импульс, ошибки ввода.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeJaffe, linearFit, autoWindow, normalizeJaffe, JF_DEFAULTS } from '../src/core/jaffe.js';
import { SAMPLE_JAFFE } from '../src/core/sample-jaffe.js';
import * as TRS from '../src/core/trs398.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const has = (r, level, re) => r.messages.some((m) => m.level === level && re.test(m.text));
const s = (x) => String(x).replace('.', ',');

/** Форма с точками без шума: 1/M = 1/M_нас + A/V (axis 'v') или + B/V² (axis 'v2'). */
function ideal({ Msat = 20, A = 1.8, B = 0, Vs = [100, 150, 200, 250, 300, 350, 400], ...rest } = {}) {
  const M = Vs.map((V) => Msat / (1 + A / V + B / (V * V)));
  return { ...JF_DEFAULTS, jf_V: Vs.map(String), jf_M: M.map((m) => m.toFixed(9)), jf_Mopp: Vs.map(() => ''), jf_use: Vs.map(() => true), jf_v1: '300', ...rest };
}

test('linearFit: МНК по трём точкам, как вручную', () => {
  const f = linearFit([1, 2, 3], [2, 4, 6.5]);
  near(f.b, 2.25, 1e-12);
  near(f.a, -1 / 3, 1e-12);
  // остатки: 2 − (−1/3 + 2,25) = 0,0833…; 4 − 4,1667 = −0,1667; 6,5 − 6,4167 = 0,0833
  near(f.res[0], 1 / 12, 1e-12);
  near(f.res[1], -1 / 6, 1e-12);
  assert.equal(linearFit([1], [1]), null);
  assert.equal(linearFit([2, 2], [1, 3]), null);
});

test('без шума: M_нас и k_s = 1 + A/V₁ точно, линейная область — все точки', () => {
  const r = computeJaffe(ideal());
  assert.equal(r.blocked, false);
  near(r.Msat, 20, 1e-6);
  near(r.ks1, 1 + 1.8 / 300, 1e-9);
  near(r.ks1Line, r.ks1Meas, 1e-9);
  assert.equal(r.window.length, 7);
  assert.equal(r.vMaxOpen, true);
  assert.ok(!has(r, 'warn', /умножения заряда/));
  // у каждой точки k_s = M_нас/M = 1 + A/V
  for (const p of r.points) near(p.ks, 1 + 1.8 / p.V, 1e-9);
});

test('автоматическая линейная область: точки с умножением заряда отсекаются, V_max — последняя линейная', () => {
  const Vs = [100, 150, 200, 250, 300, 350, 400];
  const form = ideal({ Vs });
  // умножение заряда: +0,3 % при 350 В и +0,8 % при 400 В
  form.jf_M = form.jf_M.map((m, i) => String(Number(m) * (Vs[i] === 350 ? 1.003 : Vs[i] === 400 ? 1.008 : 1)));
  const r = computeJaffe(form);
  assert.deepEqual(r.window, [0, 1, 2, 3, 4]);
  assert.equal(r.vHigh, 300);
  assert.equal(r.vMax, 300);
  assert.equal(r.vMaxOpen, false);
  near(r.Msat, 20, 1e-6);
  // без напряжения производителя — справка; если оно выше V_max — предупреждение на этом поле
  assert.ok(has(r, 'info', /умножения заряда.*V_max = 300/));
  const rm = computeJaffe({ ...form, jf_v_man: '400' });
  assert.ok(has(rm, 'warn', /Напряжение производителя 400 В выше V_max/));
  assert.equal(rm.flags.jf_v_man, 'warn');
  assert.equal(rm.checks.find((c) => c.id === 'vman').status, 'ok');
  // рабочее напряжение выше V_max — предупреждение на поле V₁
  const r2 = computeJaffe({ ...form, jf_v1: '400' });
  assert.ok(has(r2, 'warn', /выше V_max = 300/));
  assert.equal(r2.flags.jf_v1, 'warn');
});

test('точки выше линейной области с заниженными показаниями — не умножение заряда, а дрейф', () => {
  const Vs = [100, 150, 200, 250, 300, 400];
  const form = ideal({ Vs });
  form.jf_M = form.jf_M.map((m, i) => String(Number(m) * (Vs[i] === 400 ? 0.995 : 1)));
  const r = computeJaffe(form);
  assert.equal(r.vHigh, 300);
  assert.ok(!has(r, 'info', /умножения заряда/) && !has(r, 'warn', /умножения заряда/));
  assert.ok(has(r, 'warn', /ниже ожидаемых/));
});

test('сводка проверок: образец — все выполнены; без обратной полярности и D_pp — «нет данных»', () => {
  const r = computeJaffe(SAMPLE_JAFFE);
  assert.deepEqual(r.checks.map((c) => c.status), Array(r.checks.length).fill('ok'));
  assert.deepEqual(r.checks.map((c) => c.id), ['linear', 'v1', 'vman', 'ks', 'pol', 'two', 'cinit', 'dpp']);
  const bare = computeJaffe(ideal({ jf_v2: '' }));
  const st = Object.fromEntries(bare.checks.map((c) => [c.id, c.status]));
  assert.equal(st.pol, 'na');
  assert.equal(st.two, 'na');
  assert.equal(st.cinit, 'na');
  assert.equal(st.vman, undefined);
  // TG-51: обозначение P_ion в тексте
  const tg = computeJaffe({ ...SAMPLE_JAFFE, protocol: 'tg51' });
  assert.match(tg.checks.find((c) => c.id === 'ks').label, /^P_ion/);
});

test('autoWindow: при равной длине выбирается участок с более высокими напряжениями', () => {
  // 1/V по убыванию V не важен: индексы по возрастанию V; излом посередине — оба участка по 3 точки
  const xs = [5, 4, 3, 2, 1];
  const ys = [10, 8, 6, 5, 4]; // наклон 2 на первых трёх, 1 на последних трёх
  assert.deepEqual(autoWindow(xs, ys, 1e-6), [2, 3, 4]);
});

test('образец: линейная область 100–300 В, V_max = 300 В, k_s = M_нас/M₁, сравнения в пределах 0,1 %', () => {
  const r = computeJaffe(SAMPLE_JAFFE);
  assert.equal(r.blocked, false);
  assert.equal(r.vLow, 100);
  assert.equal(r.vHigh, 300);
  const p300 = r.points.find((p) => p.V === 300);
  near(r.ks1, r.Msat / p300.M, 1e-12, 'TRS-398 ур. (15)');
  near(r.ks1, 1.006, 0.0002);
  near(r.Msat, 20.0, 0.002);
  assert.ok(has(r, 'warn', /умножения заряда/));
  // метод двух напряжений 300/100 В (табл. 10, n = 3) согласуется с графиком
  assert.equal(r.two.n, 3);
  const k = TRS.ks({ m1: 19.881, m2: 19.648, v1: 300, v2: 100, beam: 'pulsed' });
  near(r.two.value, k.value, 1e-12);
  assert.ok(Math.abs(r.two.diffPct) < 0.1);
  // обратная полярность: разница k_s < 0,1 %
  assert.ok(Math.abs(r.opp.diffPct) < 0.1);
  assert.ok(r.kpolRange < 0.1);
  // доза за импульс: k_s строк — методом двух напряжений (ур. 13) по M₁, M₂; C_init ≈ 0,03 %, C_gen ≈ 0,013 на мГр
  near(r.dpp.cInit, 0.0003, 0.0001);
  near(r.dpp.cGen, 0.0131, 0.0003);
  assert.ok(!r.messages.some((m) => m.level === 'error'));
});

test('TG-51 ур. (12) на идеальных данных совпадает с графиком; TRS-398 ур. (16) — для 1/V² в непрерывном пучке', () => {
  const r = computeJaffe(ideal({ protocol: 'tg51', jf_v2: '150' }));
  near(r.two.value, r.ks1, 1e-9);
  assert.match(r.two.equation, /TG-51/);
  const c = computeJaffe(ideal({ A: 0, B: 400, jf_beam_type: 'continuous', jf_axis: 'v2', jf_v2: '100' }));
  near(c.ks1, 1 + 400 / 300 ** 2, 1e-9);
  near(c.two.value, c.ks1, 1e-9);
  assert.match(c.two.equation, /16/);
  // непрерывный пучок, ось 1/V: k_s − 1 — начальная рекомбинация, больше 0,2 % — предупреждение
  const i = computeJaffe(ideal({ A: 0.9, jf_beam_type: 'continuous' }));
  near(i.cInit, 0.9 / 300, 1e-9);
  assert.ok(has(i, 'warn', /Начальная рекомбинация/));
});

test('метод двух напряжений вне линейной области расходится с графиком — предупреждение', () => {
  const Vs = [50, 75, 100, 150, 200, 300];
  const form = ideal({ Vs, jf_v2: '50' });
  // при 50 и 75 В — сильная рекомбинация сверх прямой
  form.jf_M = form.jf_M.map((m, i) => String(Number(m) * (Vs[i] === 50 ? 0.994 : Vs[i] === 75 ? 0.998 : 1)));
  const r = computeJaffe(form);
  assert.equal(r.vLow, 100);
  assert.ok(Math.abs(r.two.diffPct) > 0.1);
  assert.ok(has(r, 'warn', /расходится с графиком/));
  assert.ok(has(r, 'warn', /должны лежать в линейной области/));
});

test('обратная полярность с другим k_s — предупреждение о камере', () => {
  const form = ideal();
  const opp = ideal({ A: 2.4 });
  form.jf_Mopp = opp.jf_M.map((m) => String(Number(m) * 0.999));
  const r = computeJaffe(form);
  near(r.opp.ks1, 1 + 2.4 / 300, 1e-7);
  near(r.opp.diffPct, (2.4 - 1.8) / 3, 1e-5);
  assert.ok(has(r, 'warn', /обратной полярности/));
  assert.equal(r.flags['jf_Mopp.0'], 'warn');
});

test('доза за импульс: нелинейность и C_init > 0,2 % — предупреждения', () => {
  const base = ideal();
  const ok = computeJaffe({ ...base, jf_dpp_x: ['0,2', '0,4', '0,6'], jf_dpp_ks: ['1,003', '1,005', '1,007'] });
  near(ok.dpp.cInit, 0.001, 1e-9);
  near(ok.dpp.cGen, 0.01, 1e-9);
  assert.ok(!has(ok, 'warn', /C_init|от прямой/));
  const bad = computeJaffe({ ...base, jf_dpp_x: ['0,2', '0,4', '0,6'], jf_dpp_ks: ['1,006', '1,006', '1,010'] });
  assert.ok(has(bad, 'warn', /C_init = .* больше 0,2/));
  assert.ok(has(bad, 'warn', /отклоняются от прямой/));
  const two = computeJaffe({ ...base, jf_dpp_x: ['0,2', '0,4'], jf_dpp_ks: ['1,003', '1,005'] });
  assert.ok(has(two, 'info', /не меньше трёх значений/));
  assert.equal(two.dpp.fit, undefined);
});

test('ошибки ввода: мало точек, повтор напряжения, V₂ ≥ V₁, k_s > 1,05, ручной выбор', () => {
  const few = computeJaffe(ideal({ Vs: [200, 300] }));
  assert.equal(few.blocked, true);
  assert.ok(has(few, 'error', /не меньше трёх напряжений/));

  const dup = ideal();
  dup.jf_V[2] = '100';
  const d = computeJaffe(dup);
  assert.ok(has(d, 'error', /введено дважды/));
  assert.equal(d.flags['jf_V.2'], 'error');

  const v2 = computeJaffe(ideal({ jf_v2: '300' }));
  assert.ok(has(v2, 'error', /V₂ должно быть меньше/));

  const big = computeJaffe(ideal({ A: 18 }));
  assert.ok(has(big, 'warn', /больше 1,05/));

  const man = ideal();
  man.jf_fit = 'manual';
  man.jf_use = [true, true, false, false, false, false, false];
  assert.ok(has(computeJaffe(man), 'error', /не меньше трёх точек/));
  man.jf_use = [false, false, true, true, true, false, false];
  const m = computeJaffe(man);
  assert.deepEqual(m.window, [2, 3, 4]);
  near(m.Msat, 20, 1e-6);

  const neg = ideal();
  neg.jf_M = [...neg.jf_M].reverse();
  assert.ok(has(computeJaffe({ ...neg, jf_fit: 'manual' }), 'error', /растёт с напряжением|не пересекает/));

  const nov1 = computeJaffe(ideal({ jf_v1: '' }));
  assert.ok(has(nov1, 'error', /Рабочее напряжение/));
});

test('нормализация: массивы выравниваются, «false» из файла читается, лишние значения отбрасываются', () => {
  const f = normalizeJaffe({ jf_V: ['1', '2', '3', '4'], jf_M: ['1'], jf_use: ['false', true], jf_beam_type: 'x', jf_axis: 'y', jf_fit: 'z' });
  assert.equal(f.jf_M.length, 4);
  assert.equal(f.jf_Mopp.length, 4);
  assert.deepEqual(f.jf_use, [false, true, true, true]);
  assert.equal(f.jf_beam_type, 'pulsed');
  assert.equal(f.jf_axis, 'v');
  assert.equal(f.jf_fit, 'auto');
  assert.equal(s(f.jf_tol), '0,1');
});

test('ур. 17 TRS-398 (ди Алмейда и Ниатель): b₀, b₁ по M₁/M₂ от M₁; k_s при любом M₁ — импульсный и непрерывный пучок', () => {
  // импульсный: M₁/M₂ − 1 = (n − 1)·(c₀ + c₁·M₁) ⇒ k_s = 1 + c₀ + c₁·M₁
  const c0 = 0.0005;
  const c1 = 0.0003;
  const M1 = [10, 20, 30, 40];
  const n = 3;
  const m2 = (m1, gen) => m1 / (1 + (n - 1) * c0 + gen * c1 * m1);
  const base = ideal({ jf_v1: '300', jf_v2: '100' });
  const pulsed = computeJaffe({ ...base, jf_dpp_x: ['', '', '', ''], jf_dpp_m1: M1.map(String), jf_dpp_m2: M1.map((m) => String(m2(m, n - 1))), jf_dpp_ks: ['', '', '', ''], jf_dpp_cond: ['', '', '', ''], jf_dpp_mq: '25' });
  const e = pulsed.eq17;
  near(e.b0, (n - 1) * c0, 1e-9);
  near(e.b1, (n - 1) * c1, 1e-9);
  near(e.cInit, c0, 1e-9);
  near(e.ksQ, 1 + c0 + c1 * 25, 1e-9);
  pulsed.dpp.points.forEach((p) => near(p.ks17, 1 + c0 + c1 * p.m1, 1e-9));
  // без D_pp проверки начальной рекомбинации и линейности берутся по ур. 17
  const st = Object.fromEntries(pulsed.checks.map((c) => [c.id, c]));
  assert.equal(st.cinit.status, 'ok');
  assert.match(st.cinit.value, /ур\. 17/);
  assert.equal(st.dpp.status, 'ok');
  // непрерывный пучок: общий член делится на n² − 1
  const cont = computeJaffe({ ...ideal({ A: 0.3, jf_beam_type: 'continuous', jf_v1: '300', jf_v2: '100' }), jf_dpp_x: [''], jf_dpp_m1: M1.map(String), jf_dpp_m2: M1.map((m) => String(m2(m, n * n - 1))), jf_dpp_ks: [''], jf_dpp_cond: [''] });
  near(cont.eq17.b1, (n * n - 1) * c1, 1e-9);
  near(cont.eq17.ksAt(30), 1 + c0 + c1 * 30, 1e-9);
});

test('строки раздела 5: k_s методом двух напряжений по M₁ и M₂, ошибки ввода', () => {
  const base = ideal({ jf_v1: '300', jf_v2: '100' });
  const r = computeJaffe({ ...base, jf_dpp_cond: ['a', 'b'], jf_dpp_x: ['0,2', ''], jf_dpp_m1: ['20,12', '20'], jf_dpp_m2: ['20', ''], jf_dpp_ks: ['', ''] });
  const p = r.dpp.points[0];
  near(p.ks, TRS.ks({ m1: 20.12, m2: 20, v1: 300, v2: 100, beam: 'pulsed' }).value, 1e-12);
  assert.equal(p.src, 'two');
  assert.ok(has(r, 'warn', /нужны оба показания/));
  // без V₂ k_s по M₁, M₂ не считается
  const noV2 = computeJaffe({ ...base, jf_v2: '', jf_dpp_cond: ['a'], jf_dpp_x: ['0,2'], jf_dpp_m1: ['20,12'], jf_dpp_m2: ['20'], jf_dpp_ks: [''] });
  assert.ok(has(noV2, 'warn', /задайте V₁ и V₂/));
  // TG-51: P_ion по ур. 12
  const tg = computeJaffe({ ...base, protocol: 'tg51', jf_dpp_cond: ['a'], jf_dpp_x: ['0,2'], jf_dpp_m1: ['20,12'], jf_dpp_m2: ['20'], jf_dpp_ks: [''] });
  near(tg.dpp.points[0].ks, (1 - 3) / (20.12 / 20 - 3), 1e-12);
});

test('образец: ур. 17 при показании раздела 3 совпадает с k_s по графику в пределах 0,01 %', () => {
  const r = computeJaffe(SAMPLE_JAFFE);
  near(r.eq17.ksRef, r.ks1, 0.0001);
  assert.ok(r.dpp.fit && r.eq17);
  assert.ok(Math.abs(r.dpp.cInit - r.eq17.cInit) < 0.0003);
});
