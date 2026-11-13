// Листы «Линейность» и «Воспроизводимость» вкладки kV-рентген (0.44.0): Xᵢ = M̄ᵢ/Qᵢ, отклонение от
// пропорциональности относительно первого задания, CLᵢⱼ = |Xᵢ − Xⱼ|/(Xᵢ + Xⱼ); R = |1 − K_min/K_max|; проверки и
// допуски по методике учреждения; новый режим не копирует показания.
// Сверка: рабочие книги учреждения (7 режимов, только числа): лист «Линейность» с двумя заданиями 0,5 и 2 Гр
// (|1 − K₂/(4·K₁)|), лист с четырьмя заданиями (X₁…X₄, CL₁₂…CL₃₄, CL_max) и лист «Воспроизводимость» (5 показаний).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKvLinearity, computeKvRepro, kvLinEntered, kvRepEntered } from '../src/core/kv-qa.js';
import { normalizeKvVisit, computeKvVisit, newKvMode } from '../src/core/kv-session.js';
import { SAMPLE_KV } from '../src/core/sample-kv.js';

const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const t = (x) => String(x).replace('.', ',');
const lnForm = (rows, extra = {}) => {
  const f = { kv_set_unit: 'Gy', ...extra };
  rows.forEach(([q, m], i) => {
    f[`kv_ln_q${i + 1}`] = t(q);
    f[`kv_ln_M${i + 1}`] = m.map(t);
  });
  return f;
};

// два задания 0,5 и 2 Гр: K₁, K₂ по три показания и |1 − K₂/(4·K₁)| листа
const LIN2 = [
  [0.4994, 2.026, 0.014217060472566878],
  [0.4885, 1.992, 0.019447287615148356],
  [0.486, 1.982, 0.019547325102880597],
  [0.498, 2.007, 0.0075301204819278045],
  [0.4946, 2.001, 0.011423372422159295],
  [0.496, 2.005, 0.01058467741935476],
  [0.492, 2.001, 0.016768292682926678],
];
// четыре задания 0,5/1/1,5/2 Гр: K₁ (три показания), K₂ и K₃ (по одному значению), K₄ (три показания); CL₁₂…CL₃₄
const LIN4 = [
  [0.4994, 1.008, 1.517, 2.026, [0.004584412995814224, 0.0062350756168744245, 0.007058355701361904, 0.0016507098052161715, 0.0024740227610093486, 0.0008233163181294445]],
  [0.4885, 0.99, 1.491, 1.992, [0.006609049313675654, 0.008625063419584031, 0.009630005068423729, 0.002016129032258122, 0.003021148036253779, 0.0010050251256280857]],
  [0.486, 0.985, 1.483, 1.982, [0.006642820643842622, 0.008500510030601862, 0.009679062659195117, 0.0018577942915048338, 0.0030364372469635654, 0.0011786496043104723]],
  [0.498, 1.001, 1.504, 2.007, [0.002503755633450122, 0.0033355570380253162, 0.0037509377344336395, 0.0008318083513558668, 0.001247193813918767, 0.00041538589349512185]],
  [0.4946, 0.997, 1.499, 2.001, [0.003927096969086713, 0.005095883062893978, 0.0056792481278584595, 0.0011688094840541373, 0.0017521902377972203, 0.0005833819484956437]],
  [0.496, 0.999, 1.502, 2.005, [0.0035158211953792095, 0.00468227424749168, 0.0052644773126096535, 0.0011664722546242674, 0.001748688483637246, 0.0005822174166180843]],
  [0.492, 0.995, 1.498, 2.001, [0.005558362809499752, 0.007397444519166131, 0.008314436885865436, 0.0018391573315499283, 0.002756201453269832, 0.0009170487703209217]],
];
// воспроизводимость: 5 показаний и |1 − K_min/K_max| листа
const REP = [
  [[1.322, 1.315, 1.32, 1.322, 1.322], 0.005295007564296572],
  [[1.743, 1.751, 1.757, 1.752, 1.753], 0.007968127490039723],
  [[1.537, 1.545, 1.545, 1.541, 1.543], 0.00517799352750814],
  [[0.8273, 0.8271, 0.827, 0.8271, 0.8273], 0.00036262540795373166],
  [[0.9636, 0.9618, 0.9628, 0.9628, 0.9627], 0.0018679950186799577],
  [[0.6945, 0.6945, 0.6945, 0.695, 0.6949], 0.0007194244604316058],
  [[0.7158, 0.7154, 0.7163, 0.716, 0.7158], 0.0012564567918470493],
];

test('линейность: два задания — отклонение как |1 − K₂/(4·K₁)| листа учреждения, допуск 2 %', () => {
  for (const [k1, k2, want] of LIN2) {
    const r = computeKvLinearity(lnForm([[0.5, [k1, k1, k1]], [2, [k2, k2, k2]]], { kv_ln_tol: '2' }));
    assert.equal(r.ok, true);
    close(r.dMax, want);
    assert.equal(r.dMaxAt, 1);
    close(r.points[1].d, k2 / (4 * k1) - 1);
    assert.equal(r.messages.filter((m) => m.level !== 'info').length, 0);
  }
  // допуск 1,5 %: режимы с отклонением больше — предупреждение
  const r = computeKvLinearity(lnForm([[0.5, ['0,4885', '0,4885', '0,4885']], [2, ['1,992', '1,992', '1,992']]], { kv_ln_tol: '1,5' }));
  assert.match(r.messages.find((m) => m.level === 'warn').text, /Отклонение от пропорциональности 1,94 % \(задание 2 к заданию 1\) больше допуска 1,5 %/);
  assert.equal(r.flags.kv_ln_tol, 'warn');
  assert.equal(r.flags.kv_ln_M2, 'warn');
});

test('линейность: четыре задания — X и все CLᵢⱼ как в листе учреждения, CL_max', () => {
  for (const [a, b, c, d, cl] of LIN4) {
    const r = computeKvLinearity(lnForm([[0.5, [a, a, a]], [1, [b]], [1.5, [c]], [2, [d, d, d]]]));
    assert.equal(r.ok, true);
    assert.deepEqual(r.points.map((p) => p.i), [0, 1, 2, 3]);
    close(r.points[0].X, a / 0.5);
    close(r.points[3].X, d / 2);
    assert.deepEqual(r.cl.map((x) => [x.i, x.j]), [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]);
    r.cl.forEach((x, k) => close(x.value, cl[k]));
    close(r.clMax, Math.max(...cl));
    assert.deepEqual(r.clAt, [0, 3]);
    // одно показание в серии — справка
    assert.ok(r.messages.some((m) => m.level === 'info' && /Задание 2: одно показание/.test(m.text)));
  }
  // допуск на CL
  const [a, b, c, d] = LIN4[1];
  const r = computeKvLinearity(lnForm([[0.5, [a]], [1, [b]], [1.5, [c]], [2, [d]]], { kv_ln_cl_tol: '0,005' }));
  assert.match(r.messages.find((m) => m.level === 'warn').text, /Коэффициент линейности CL = 0,0096 \(задания 1 и 4\) больше допуска 0,005/);
});

test('линейность: ошибки и справки — нет задания, нет показаний, разный знак, одинаковые задания, одно задание', () => {
  assert.equal(kvLinEntered({}), false);
  assert.equal(computeKvLinearity({}).state, 'empty');
  let r = computeKvLinearity({ kv_set_unit: 'min', kv_ln_q1: '0,5', kv_ln_M1: ['', '', ''], kv_ln_M2: ['10', '', ''] });
  assert.equal(r.state, 'error');
  assert.deepEqual([r.flags.kv_ln_M1, r.flags.kv_ln_q2], ['error', 'error']);
  assert.match(r.messages.map((m) => m.text).join('\n'), /Задание 1: нет показаний\.\nЗадание 2: не задано значение Q, мин\./);
  r = computeKvLinearity({ kv_set_unit: 'MU', kv_ln_q1: '-5', kv_ln_M1: ['1'] });
  assert.match(r.messages[0].text, /Задание 1: Q должно быть положительным числом, МЕ\./);
  r = computeKvLinearity(lnForm([[0.5, [1, 1]], [2, [-4, -4]]]));
  assert.match(r.messages[0].text, /разного знака/);
  assert.equal(r.ok, false);
  r = computeKvLinearity(lnForm([[1, [2, 2.01]], [1, [2.02, 2.01]], [2, [4.03, 4.02]]]));
  assert.ok(r.ok);
  assert.match(r.messages.find((m) => m.level === 'warn').text, /Задания 1 и 2 одинаковые/);
  r = computeKvLinearity(lnForm([[1, [2, 2.01]]]));
  assert.equal(r.ok, false);
  assert.match(r.messages[0].text, /не меньше двух заданий/);
  // пропущенная строка: задания 1 и 3 — отношение к первому заполненному
  r = computeKvLinearity({ kv_set_unit: 'Gy', kv_ln_q1: '0,5', kv_ln_M1: ['1', '1'], kv_ln_q3: '2', kv_ln_M3: ['4,1', '4,1'] });
  assert.deepEqual(r.points.map((p) => p.i), [0, 2]);
  close(r.dMax, 0.025);
  assert.equal(r.dMaxAt, 2);
  // неопределённость отклонения — из u_A средних
  r = computeKvLinearity(lnForm([[0.5, [1, 1.01]], [2, [4, 4.04]]]));
  close(r.points[1].ud, Math.sqrt(2) * (0.005 / 1.005), 1e-9);
});

test('воспроизводимость: |1 − K_min/K_max| как в листе учреждения, допуск, малая серия, ошибки', () => {
  for (const [vals, want] of REP) {
    const r = computeKvRepro({ kv_rp_M: vals.map(t), kv_rp_tol: '2' });
    assert.equal(r.ok, true);
    close(r.R, want);
    assert.equal(r.messages.length, 0);
  }
  let r = computeKvRepro({ kv_rp_M: ['1,322', '1,315', '1,32', '1,322', '1,322'], kv_rp_tol: '0,5' });
  assert.match(r.messages[0].text, /Воспроизводимость \|1 − K_min\/K_max\| = 0,53 % больше допуска 0,5 %/);
  assert.equal(r.flags.kv_rp_M, 'warn');
  r = computeKvRepro({ kv_rp_M: ['-2,01', '-2,00', '-2,02'] });
  close(r.R, 1 - 2 / 2.02);
  assert.match(r.messages[0].text, /Показаний 3: по малой серии/);
  assert.equal(computeKvRepro({ kv_rp_M: ['2', '-2'] }).state, 'error');
  assert.equal(computeKvRepro({ kv_rp_M: ['2', 'x'] }).state, 'error');
  r = computeKvRepro({ kv_rp_M: ['2', '', ''] });
  assert.equal(r.ok, false);
  assert.match(r.messages[0].text, /не меньше двух показаний/);
  assert.equal(kvRepEntered({ kv_rp_M: ['', ''] }), false);
});

test('режимы: линейность и воспроизводимость по каждому режиму, в дозу не входят; новый режим не копирует показания', () => {
  const v = normalizeKvVisit(SAMPLE_KV);
  const before = computeKvVisit(v).modes[0].results[0].trs.Dw;
  Object.assign(v.modes[0].shared, { kv_ln_q1: '0,5', kv_ln_M1: ['11,1', '11,1'], kv_ln_q2: '2', kv_ln_M2: ['43,7', '43,7'], kv_rp_M: ['4,51', '4,52', '4,51', '4,50', '4,51'], kv_ln_app: 'Ø 10 см', kv_rp_app: 'Ø 3 см', kv_rp_dist: '20' });
  const r = computeKvVisit(v).modes[0];
  assert.equal(r.ln.ok, true);
  assert.equal(r.rp.ok, true);
  assert.equal(r.results[0].trs.Dw, before);
  const m = newKvMode(v.modes[0]);
  assert.deepEqual([m.shared.kv_ln_q1, m.shared.kv_ln_M1.join(''), m.shared.kv_rp_M.join('')], ['', '', '']);
  assert.deepEqual([m.shared.kv_ln_app, m.shared.kv_rp_app, m.shared.kv_rp_dist], ['Ø 10 см', 'Ø 3 см', '20']);
});

test('линейность: задания Q — в своей единице (по умолчанию Гр, 0.58.0); старые формы — в единице задания облучения', async () => {
  const { normalizeKv } = await import('../src/core/kv.js');
  // как в рабочей книге: 0,5 / 1 / 1,5 / 2 Гр при задании облучения в минутах
  const f = lnForm([[0.5, [0.4994, 0.4994, 0.4994]], [1, [1.008, 1.008, 1.008]], [1.5, [1.517, 1.517, 1.517]], [2, [2.026, 2.026, 2.026]]], { kv_set_unit: 'min' });
  const nf = normalizeKv({ ...f, kv_ln_unit: 'Gy' });
  const r = computeKvLinearity(nf);
  assert.equal(r.unit.label, 'Гр');
  close(r.clMax, 0.007058355701361904, 1e-12);
  // единица — только подпись: X и CL те же
  close(computeKvLinearity({ ...nf, kv_ln_unit: 'MU' }).clMax, r.clMax);
  assert.equal(normalizeKv({}).kv_ln_unit, 'Gy');
  assert.equal(normalizeKv({ kv_set_unit: 'min' }).kv_ln_unit, 'Gy');
  // форма до 0.58.0 с данными линейности — задания в единице задания облучения
  assert.equal(normalizeKv(f).kv_ln_unit, 'min');
  assert.equal(normalizeKv({ ...f, kv_ln_unit: 'junk' }).kv_ln_unit, 'min');
});
