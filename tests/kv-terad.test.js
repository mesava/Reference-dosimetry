// Проверка на независимых данных: приёмка аппарата Терад 200 (рентгенотерапия 50–200 кВ), 20.06.2024.
// Данные обезличены (без учреждения, ФИО и заводских номеров); подробности — docs/validation.md.
// Низкие энергии (50, 75, 100 кВ): PTW 23342, N_D,w = 1,582 Гр/нКл при TW30, k_Q по качествам TW15–TW70 сертификата
// (лаборатория: Ø 3 см, РИП 50 см). На приёмке D = M̄ · N_D,w · k_Q · k_TP, k_Q взят по кВ, k_g = 1, без k_pol и k_s.
// Средние энергии (120–200 кВ): Farmer PTW 30013 откалиброван только в ⁶⁰Co (N_D,w = 0,05389 Гр/нКл):
// D = M̄ · N_D,w · k_TP · k_s · k_pol без k_Q, твёрдая вода, 2 см. Везде P₀ = 1013 гПа, показания — за 1 мин.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKv, KV_DEFAULTS } from '../src/core/kv.js';
import { splitKvVisitForm, normalizeKvVisit, computeKvVisit } from '../src/core/kv-session.js';

const c = (x) => String(x).replace('.', ',');
// P₀ = 1013 гПа на приёмке вместо 101,325 кПа: доза ниже на 0,025 %
const P0 = (1013 / 1013.25 - 1) * 100;

const LOW = {
  ...KV_DEFAULTS,
  kv_range: 'low', kv_ch_model: 'PTW23342', kv_foil: true, kv_cal: 'ndw', kv_cert_form: 'kq', kv_n: '1,582', kv_n_unit: 'Gy/nC',
  kv_cq_kv: ['15', '30', '50', '70'], kv_cq_hvl: ['0,10', '0,43', '1,10', '3,10'], kv_cq_val: ['1,010', '1,000', '0,998', '1,022'],
  kv_lab_shape: 'circle', kv_lab_f: '3', kv_lab_ssd: '50', kv_T0: '20', kv_P0: '101,325', kv_kelec: '1', kv_env_P_unit: 'hPa',
  kv_set_unit: 'min', kv_set: '1', kv_timer_mode: 'none', kv_V1: '300',
  // 23342 стояла в RW3; на каком фантоме калибровала PTW, в данных нет
  kv_phantom: 'rw3',
};
// пучок: СПО, мм Al (по измерениям отделения) и k_Q, взятый на приёмке (по кВ; 75 и 100 кВ — экстраполяция за TW70)
const LOW_BEAMS = { 50: ['0,822', 0.998], 75: ['1,530', 1.028], 100: ['2,848', 1.06] };
// [тубус, форма, размер, РИП, показания, T, P, D приёмки в Гр/мин]
const LOW_ROWS = {
  50: [
    ['Ø6', 'circle', 6, 20, [2.18, 2.18, 2.18], 20.3, 1003.8, 3.47696170708348],
    ['Ø8', 'circle', 8, 20, [2.244, 2.247, 2.247], 20.3, 1003.8, 3.58222752023371],
    ['Ø10', 'circle', 10, 20, [2.252, 2.254, 2.256], 20.3, 1003.8, 3.59498701273677],
    ['Ø1,5', 'circle', 1.5, 30, [0.8027, 0.8033, 0.8034], 20.6, 1004.5, 1.28136247520597],
    ['Ø2', 'circle', 2, 30, [0.8772, 0.8782, 0.8785], 20.6, 1004.6, 1.40061619937121],
    ['Ø3', 'circle', 3, 30, [0.9173, 0.9179, 0.9168], 20.7, 1004.6, 1.46391576222943],
    ['Ø4', 'circle', 4, 30, [0.9284, 0.9282, 0.9288], 20.7, 1004.7, 1.48153528797963],
    ['Ø5', 'circle', 5, 30, [0.9493, 0.9505, 0.9509], 20.7, 1004.7, 1.51626791320583],
    ['4×4', 'square', 4, 30, [0.6844, 0.6846, 0.6848], 21.4, 1005.2, 1.09445940400023],
  ],
  75: [
    ['Ø6', 'circle', 6, 20, [2.871, 2.872, 2.872], 19.9, 1002.4, 4.71795572213592],
    ['Ø8', 'circle', 8, 20, [2.984, 2.985, 2.987], 20.4, 1003.8, 4.90621711672497],
    ['Ø10', 'circle', 10, 20, [3.025, 3.027, 3.027], 20.5, 1004.4, 4.97232007588513],
    ['Ø1,5', 'circle', 1.5, 30, [1.007, 1.009, 1.009], 20.6, 1004.4, 1.65727387740957],
    ['Ø2', 'circle', 2, 30, [1.111, 1.111, 1.111], 20.6, 1004.6, 1.82565095972512],
    ['Ø3', 'circle', 3, 30, [1.177, 1.18, 1.178], 20.6, 1004.6, 1.93629647243574],
    ['Ø4', 'circle', 4, 30, [1.202, 1.205, 1.204], 20.7, 1004.7, 1.9784017646809],
    ['Ø5', 'circle', 5, 30, [1.241, 1.243, 1.243], 20.7, 1004.7, 2.04195607226965],
    ['4×4', 'square', 4, 30, [1.036, 1.035, 1.036], 21.3, 1005.2, 1.70489599654246],
  ],
  100: [
    ['Ø6', 'circle', 6, 20, [3.203, 3.203, 3.203], 19.9, 1002.4, 5.42612161012761],
    ['Ø8', 'circle', 8, 20, [3.353, 3.358, 3.357], 20.4, 1003.8, 5.68707081215235],
    ['Ø10', 'circle', 10, 20, [3.43, 3.434, 3.427], 20.4, 1004.4, 5.80956338610172],
    ['Ø1,5', 'circle', 1.5, 30, [1.135, 1.138, 1.139], 20.6, 1004.4, 1.92748354436271],
    ['Ø2', 'circle', 2, 30, [1.247, 1.247, 1.249], 20.6, 1004.7, 2.11383841155784],
    ['Ø3', 'circle', 3, 30, [1.306, 1.307, 1.307], 20.6, 1004.7, 2.21379817614393],
    ['Ø4', 'circle', 4, 30, [1.328, 1.328, 1.328], 20.7, 1004.7, 2.25070762712669],
    ['Ø5', 'circle', 5, 30, [1.374, 1.378, 1.378], 20.7, 1004.8, 2.33295617426498],
    ['4×4', 'square', 4, 30, [1.217, 1.217, 1.219], 21.3, 1005.2, 2.06689807372701],
  ],
};
const low = (kv, row, o = {}) => {
  const [, shape, size, ssd, M, T, P] = row;
  return computeKv({ ...LOW, kv_kv: String(kv), kv_hvl: LOW_BEAMS[kv][0], kv_cone_shape: shape, kv_cone: c(size), kv_ssd: String(ssd), kv_M1: M.map(c), kv_env_T: c(T), kv_env_P: c(P), ...o });
};

test('Терад 200, 50–100 кВ: с k_Q и k_g = 1 приёмки доза совпадает (−0,025 % — только P₀)', () => {
  for (const [kv, rows] of Object.entries(LOW_ROWS)) {
    const kq = c(LOW_BEAMS[kv][1]);
    for (const row of rows) {
      // одно качество, совпадающее с пучком по СПО, — значение берётся без интерполяции
      const r = low(kv, row, { kv_cq_kv: [kv], kv_cq_hvl: [LOW_BEAMS[kv][0]], kv_cq_val: [kq], kv_kg_src: 'one' });
      assert.equal(r.trs.blocked, false, `${kv} кВ ${row[0]}`);
      const d = (row[7] / r.trs.perUnit - 1) * 100;
      assert.ok(Math.abs(d - P0) < 0.002, `${kv} кВ ${row[0]}: ${d}`);
    }
  }
});

test('Терад 200, 50–100 кВ по TRS-398 Rev.1: k_Q по ln(СПО) из сертификата и k_g по табл. 28 — на сколько выше доза приёмки', () => {
  // k_Q для СПО пучка: 75 и 100 кВ мягче TW70 (СПО 1,53 и 2,85 мм Al < 3,10) — интерполяция, а не экстраполяция по кВ
  const kq = { 50: 0.99862, 75: 1.00564, 100: 1.02004 };
  // доза приёмки выше рассчитанной по Rev.1 с k_g = 1 (только из-за k_Q, и −0,025 % из-за P₀)
  const byKq = { 50: -0.09, 75: 2.2, 100: 3.89 };
  for (const [kv, rows] of Object.entries(LOW_ROWS)) {
    const r = low(kv, rows[0], { kv_kg_src: 'one' });
    assert.ok(Math.abs(r.cert.kQ - kq[kv]) < 5e-6, `${kv} кВ: k_Q ${r.cert.kQ}`);
    assert.ok(!r.cert.interp.extrapolated);
    assert.ok(Math.abs((rows[0][7] / r.trs.perUnit - 1) * 100 - byKq[kv]) < 0.005, `${kv} кВ`);
  }
  // k_g по табл. 28 (поле лаборатории 3 см): на Ø 3 см — 1, на больших тубусах — меньше 1
  const kg = (kv, i) => low(kv, LOW_ROWS[kv][i]).trs.kg;
  assert.equal(kg(50, 5).source, 'table');
  assert.ok(Math.abs(kg(50, 5).value - 1) < 1e-12);
  const cases = [
    // [кВ, строка, k_g, на сколько выше доза приёмки, %]
    [50, 0, 0.99, 0.92],
    [50, 2, 0.97, 3.0],
    [75, 2, 0.9529, 7.25],
    [100, 2, 0.9311, 11.58],
    [100, 4, 1.0197, 1.88],
  ];
  for (const [kv, i, v, diff] of cases) {
    const r = low(kv, LOW_ROWS[kv][i]);
    assert.equal(r.trs.kg.source, 'table');
    assert.ok(Math.abs(r.trs.kg.value - v) < 5e-5, `${kv} кВ ${LOW_ROWS[kv][i][0]}: k_g ${r.trs.kg.value}`);
    assert.ok(Math.abs((LOW_ROWS[kv][i][7] / r.trs.perUnit - 1) * 100 - diff) < 0.01, `${kv} кВ ${LOW_ROWS[kv][i][0]}`);
  }
  // тубус Ø 1,5 см меньше полей табл. 28 (2–20 см): k_g по Rev.1 взять неоткуда
  const small = low(100, LOW_ROWS[100][3]);
  assert.equal(small.trs.blocked, true);
  assert.ok(small.messages.some((m) => m.level === 'error' && /поле вне табл\. 28–29 \(2–20 см\)/.test(m.text)));
});

test('Терад 200, 120–200 кВ: k_Q = 1 (Farmer только с ⁶⁰Co) — доза на 2 см и на поверхности совпадают (−0,025 % — только P₀)', () => {
  const base = {
    ...KV_DEFAULTS,
    kv_range: 'medium', kv_ch_model: 'PTW30013', kv_cal: 'ndw', kv_qo: 'co60', kv_cert_form: 'co', kv_n: '0,05389', kv_n_unit: 'Gy/nC',
    kv_cone_shape: 'rect', kv_T0: '20', kv_P0: '101,325', kv_kelec: '1', kv_env_P_unit: 'hPa', kv_phantom: 'custom', kv_ph_name: 'твёрдая вода (марка не указана)', kv_pdd_phantom: 'rw3',
    kv_set_unit: 'min', kv_set: '1', kv_timer_mode: 'none',
    // k_s и k_pol — одна серия 400/200 В на все пучки, k_s по формуле для импульсного пучка, как на приёмке
    kv_V1: '400', kv_V2: '200', kv_ks_on: true, kv_rec_trs: 'eq13',
    kv_M1: ['4,498', '4,496', '4,499'], kv_Mopp: ['-4,54', '-4,534', '-4,546'], kv_M2: ['4,486', '4,489', '4,501'],
  };
  const run = (o) => computeKv({ ...base, ...o });
  const beams = { 120: '0,222', 140: '0,420', 150: '0,746', 200: '1,484' };
  // прямоугольные тубусы: [РИП, a, b, T, P]
  const apps = [[40, 6, 8, 22.6, 1007.5], [40, 4, 15, 22.1, 1007.4], [50, 8, 10, 22.7, 1007.5]];
  // [показания за 1 мин, PDD(2 см)/PDD(0), D приёмки на 2 см в Гр/мин]
  const cases = {
    120: [[[9.532, 9.535, 9.551], 76.41 / 106, 0.524556378654961], [[9.016, 9.016, 9.02], 72.72 / 101.4, 0.495063214539923], [[6.574, 6.576, 6.58], 66.96 / 87.97, 0.361765188578338]],
    140: [[[11.6, 11.59, 11.59], 101.4 / 133.3, 0.637503349277362], [[11.03, 11.03, 11.04], 96.7 / 128.6, 0.605744211195898], [[8.076, 8.068, 8.073], 89.45 / 111.7, 0.444037890106519]],
    150: [[[8.671, 8.674, 8.673], 83.14 / 105.4, 0.476899429025256], [[8.274, 8.273, 8.274], 79.2 / 101.7, 0.454234956679559], [[6.057, 6.06, 6.06], 73.23 / 88.48, 0.333289702624858]],
    200: [[[8.666, 8.66, 8.669], 90.74 / 114.2, 0.476477848316993], [[8.279, 8.281, 8.283], 86.92 / 109.7, 0.454637566125067], [[6.017, 6.021, 6.019], 79.88 / 95.35, 0.331089407509329]],
  };
  for (const [kv, rows] of Object.entries(cases)) {
    rows.forEach(([M, pdd, theirs], i) => {
      const [ssd, a, b, T, P] = apps[i];
      const r = run({ kv_kv: kv, kv_hvl: beams[kv], kv_cone: String(a), kv_cone_b: String(b), kv_ssd: String(ssd), kv_env_T: c(T), kv_env_P: c(P), kv_Mc: M.map(c), kv_pdd2: c((pdd * 100).toFixed(6)) });
      const x = r.trs.ctrl;
      assert.equal(x.blocked, false);
      assert.match(r.notRev1.join(';'), /k_Q = 1/);
      const d2 = (theirs / x.perUnit - 1) * 100;
      const ds = (theirs / pdd / x.perUnitSurf - 1) * 100;
      assert.ok(Math.abs(d2 - P0) < 0.002, `${kv} кВ, тубус ${i + 1}: ${d2}`);
      assert.ok(Math.abs(ds - P0) < 0.002, `${kv} кВ, тубус ${i + 1}, поверхность: ${ds}`);
    });
  }
  const r = run({ kv_kv: '120', kv_hvl: '0,222', kv_cone: '8', kv_cone_b: '10', kv_ssd: '50', kv_env_T: '20', kv_env_P: '1013,25' });
  assert.ok(Math.abs(r.trs.ks - 1.00121722345502) < 1e-9);
  assert.ok(Math.abs(r.trs.kpol - 1.00470614392648) < 1e-9);
  // k_pol > 1,004 — отступление от критерия камеры эталонного класса
  assert.ok(r.compliance.reasons.some((x) => /k_pol = 1,0047/.test(x.text)));
  // тубус 8 × 10 см сопоставим с 10 × 10 см (табл. 31, сноска c); твёрдая вода — не вода: нестандартные условия
  assert.equal(r.compliance.conditions.find((x) => x.id === 'kvMedField').state, 'met');
  assert.ok(r.compliance.reasons.some((x) => /фантом — свой материал «твёрдая вода \(марка не указана\)»: для средних энергий твердые фантомы/.test(x.text)));
  // 4 × 15 см вытянут больше чем вдвое — предупреждение о круге той же площади; PDD в RW3 — SSRMP No 9 не рекомендует
  const long = run({ kv_kv: '120', kv_hvl: '0,222', kv_cone: '4', kv_cone_b: '15', kv_ssd: '40', kv_env_T: '20', kv_env_P: '1013,25', kv_pdd2: '70' });
  assert.ok(long.messages.some((m) => m.level === 'warn' && /вытянуто больше чем вдвое/.test(m.text)));
  assert.equal(long.flags.kv_pdd_phantom, 'warn');
  assert.ok(long.messages.some((m) => m.level === 'warn' && /PDD\(2 см\) снята в фантоме: RW3 \(PTW\); SSRMP No 9 не рекомендует/.test(m.text)));
});

test('Терад 200 как один приезд (0.37.0): серия k_pol и k_s только в режиме 120 кВ — режимы 140–200 кВ берут её, доза та же; 23342 — своя камера', () => {
  // как на приёмке: одна серия 400/200 В на все пучки Farmer; в приезде она — в строке 1 режима 120 кВ
  const farmer = splitKvVisitForm({
    ...KV_DEFAULTS,
    kv_ch_model: 'PTW30013', kv_cal: 'ndw', kv_qo: 'co60', kv_cert_form: 'co', kv_n: '0,05389', kv_n_unit: 'Gy/nC',
    kv_T0: '20', kv_P0: '101,325', kv_kelec: '1', kv_V1: '400', kv_V2: '200', kv_ks_on: true, kv_rec_trs: 'eq13',
  }).chamber;
  const lowCh = splitKvVisitForm(LOW).chamber;
  const medMode = (kv, hvl) => ({
    ...splitKvVisitForm({ ...KV_DEFAULTS, kv_range: 'medium', kv_kv: kv, kv_hvl: hvl, kv_phantom: 'custom', kv_ph_name: 'твёрдая вода (марка не указана)', kv_pdd_phantom: 'rw3', kv_set_unit: 'min', kv_timer_mode: 'none' }).mode,
  });
  const beams = { 120: '0,222', 140: '0,420', 150: '0,746', 200: '1,484' };
  const apps = [[40, 6, 8, 22.6, 1007.5], [40, 4, 15, 22.1, 1007.4], [50, 8, 10, 22.7, 1007.5]];
  const cases = {
    120: [[[9.532, 9.535, 9.551], 0.524556378654961], [[9.016, 9.016, 9.02], 0.495063214539923], [[6.574, 6.576, 6.58], 0.361765188578338]],
    140: [[[11.6, 11.59, 11.59], 0.637503349277362], [[11.03, 11.03, 11.04], 0.605744211195898], [[8.076, 8.068, 8.073], 0.444037890106519]],
    150: [[[8.671, 8.674, 8.673], 0.476899429025256], [[8.274, 8.273, 8.274], 0.454234956679559], [[6.057, 6.06, 6.06], 0.333289702624858]],
    200: [[[8.666, 8.66, 8.669], 0.476477848316993], [[8.279, 8.281, 8.283], 0.454637566125067], [[6.017, 6.021, 6.019], 0.331089407509329]],
  };
  const modes = Object.entries(cases).map(([kv, rows]) => ({
    shared: medMode(kv, beams[kv]),
    chamber: 0,
    active: 0,
    rows: rows.map(([M], i) => {
      const [ssd, a, b, T, P] = apps[i];
      const row = { kv_cone_shape: 'rect', kv_cone: String(a), kv_cone_b: String(b), kv_ssd: String(ssd), kv_set: '1', kv_env_T: c(T), kv_env_P: c(P), kv_M1: M.map(c), kv_Mc: M.map(c) };
      if (kv === '120' && i === 0) Object.assign(row, { kv_M1: ['4,498', '4,496', '4,499'], kv_Mopp: ['-4,54', '-4,534', '-4,546'], kv_M2: ['4,486', '4,489', '4,501'] });
      return row;
    }),
  }));
  // режим 50 кВ с камерой 23342 (вторая камера приезда): k_pol у неё не измерялся и из Farmer не берётся
  const [, shape, size, ssd, M, T, P] = LOW_ROWS[50][2];
  modes.push({ shared: splitKvVisitForm({ ...LOW, kv_kv: '50', kv_hvl: LOW_BEAMS[50][0] }).mode, chamber: 1, active: 0, rows: [{ kv_cone_shape: shape, kv_cone: c(size), kv_ssd: String(ssd), kv_set: '1', kv_env_T: c(T), kv_env_P: c(P), kv_M1: M.map(c) }] });
  const visit = normalizeKvVisit({ common: splitKvVisitForm({ ...KV_DEFAULTS, kv_env_P_unit: 'hPa' }).common, chambers: [farmer, lowCh], modes, mode: 0 });
  const r = computeKvVisit(visit);
  assert.deepEqual(r.modes.map((m) => [m.polMode, m.ksMode]), [[-1, -1], [0, 0], [0, 0], [0, 0], [-1, -1]]);
  Object.values(cases).forEach((rows, m) => {
    rows.forEach(([, theirs], i) => {
      const x = r.modes[m].results[i];
      assert.equal(x.trs.ctrl.blocked, false, `${Object.keys(cases)[m]} кВ, тубус ${i + 1}`);
      assert.ok(Math.abs((theirs / x.trs.ctrl.perUnit - 1) * 100 - P0) < 0.002, `${Object.keys(cases)[m]} кВ, тубус ${i + 1}`);
      assert.ok(Math.abs(x.trs.kpol - 1.00470614392648) < 1e-9);
      assert.ok(Math.abs(x.trs.ks - 1.00121722345502) < 1e-9);
    });
  });
  assert.match(r.modes[3].results[0].trs.kpolFrom, /^режима 1 \(120 кВ, СПО 0,222 мм Cu\)$/);
  // 50 кВ: k_pol = 1 с предупреждением, k_s = 1 (у камеры 23342 метод двух напряжений не включён); доза — как отдельный расчёт
  const lowR = r.modes[4].results[0];
  assert.equal(lowR.trs.kpol, 1);
  assert.equal(lowR.trs.ks, 1);
  assert.equal(lowR.trs.perUnit, low(50, LOW_ROWS[50][2]).trs.perUnit);
});
