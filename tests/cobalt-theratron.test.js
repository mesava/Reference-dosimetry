// Приёмка на независимых данных: протоколы дозиметрии гамма-терапевтического аппарата ⁶⁰Co (Theratron Equinox 100)
// от 19.09.2025 и 06.03.2026. Эталон — расчёт отделения в Excel (свой шаблон протокола, не связанный с калькулятором).
// Данные обезличены: без учреждения, ФИО и заводских номеров.
//
// Как устроен эталонный лист: D_w(z_ref) = M·k_TP·k_s·k_pol·k_Q·K·N_D,w за 1 мин облучения, k_Q = 1, K = 1,006 — поправочный
// множитель из свидетельства (в калькуляторе k_лаб). k_TP — с P₀ = 101,3 кПа и T₀ = 20 °C; k_s — метод двух напряжений
// с a₀ = 1,198, a₁ = −0,875, a₂ = 0,677 (V₁/V₂ = 3, TRS-398 Rev.1 табл. 10, ур. 13 — как в калькуляторе для непрерывного
// пучка, разд. 4.4.3.4 b); k_pol и k_s — по серии в поле 10 × 10 см, доза — по отдельной серии в каждом поле
// (5 × 5, 10 × 10, 20 × 20 см). Установка: РИП 70 см (РИО 75 см), z_ref = 5 см; ошибка таймера в листе не учитывается.
// В калькуляторе серия каждого поля вводится как контрольные измерения (раздел 6): k_pol и k_s берутся из основных серий.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCobalt, CO_DEFAULTS } from '../src/core/cobalt.js';

const c = (x) => String(x).replace('.', ',');
const cells = (a) => a.map(c);
const near = (a, b, rel, msg) => assert.ok(Math.abs(a / b - 1) <= rel, `${msg}: ${a} ≠ ${b} (±${rel * 100} %)`);

const BASE = {
  ...CO_DEFAULTS, protocol: 'trs', co_geometry: 'SAD', co_distance: '75', co_zref: '5', co_ch_model: 'FC65G',
  co_ndw: c(0.04836), co_ndw_unit: 'Gy/nC', co_klab: c(1.006), co_T0: '20', co_P0: c(101.3), co_kelec: '1',
  co_time: '1', co_time_unit: 'min', co_timer_mode: 'none', co_V1: '300', co_V2: '100', co_polarity: '+', co_rec_trs: 'eq13', co_dd_on: false,
};

// xl — значения эталонного листа (вычисленные Excel, без округления), D — Гр/мин на z_ref = 5 см
const DATES = [
  { date: '2025-09-19', T: 20.8, P: 100.55, H: 47,
    M1: [29.4, 29.4, 29.42], Mopp: [-29.46, -29.46, -29.46], M2: [29.36, 29.36, 29.36],
    fields: { '5×5': [26.64, 26.64, 26.64], '10×10': [29.42, 29.43, 29.42], '20×20': [32.46, 32.46, 32.46] },
    xl: { kTP: 1.0102078405061385, ks: 1.0007630636853955, kpol: 1.0009068238494672,
      D: { '5×5': 1.3114572743669946, '10×10': 1.4484776477524355, '20×20': 1.5979693365597842 } } },
  { date: '2026-03-06', T: 19.76, P: 99.43, H: 28.6,
    M1: [49.38, 49.38, 49.38], Mopp: [-49.46, -49.47, -49.47], M2: [49.27, 49.28, 49.27],
    fields: { '5×5': [44.81, 44.81, 44.82], '10×10': [49.39, 49.39, 49.39], '20×20': [54.45, 54.45, 54.45] },
    xl: { kTP: 1.0179732524502898, ks: 1.0010401094655212, kpol: 1.0008775482651544,
      D: { '5×5': 2.2236186873935324, '10×10': 2.4507109558992832, '20×20': 2.701786020423486 } } },
];
const formOf = (d, extra = {}) => ({
  ...BASE, co_date: d.date, co_env_T: c(d.T), co_env_P: c(d.P), co_env_P_unit: 'kPa', co_env_H: c(d.H),
  co_M1: cells(d.M1), co_Mopp: cells(d.Mopp), co_M2: cells(d.M2), ...extra,
});

test('⁶⁰Co, Theratron Equinox 100: k_TP, k_pol, k_s — как в независимом расчёте', () => {
  for (const d of DATES) {
    const r = computeCobalt(formOf(d));
    assert.deepEqual(r.messages.filter((m) => m.level === 'error'), [], d.date);
    near(r.trs.kTP, d.xl.kTP, 1e-6, `${d.date}: k_TP (в листе T вписана с округлением: разница < 0,0001 %)`);
    near(r.trs.kpol, d.xl.kpol, 1e-12, `${d.date}: k_pol`);
    near(r.trs.ks, d.xl.ks, 1e-12, `${d.date}: k_s (ур. 13, табл. 10)`);
  }
});

test('⁶⁰Co, Theratron Equinox 100: мощность дозы в полях 5×5, 10×10 и 20×20 см совпадает с листом', () => {
  for (const d of DATES) {
    for (const [field, M] of Object.entries(d.fields)) {
      const r = computeCobalt(formOf(d, { co_Mc: cells(M) }));
      assert.equal(r.trs.ctrl.blocked, false, `${d.date}, ${field}`);
      near(r.trs.ctrl.rateGy, d.xl.D[field], 1e-6, `${d.date}, ${field}: D_w(5 см), Гр/мин`);
    }
  }
});

test('⁶⁰Co, Theratron Equinox 100: РИК 75 см — нестандартные условия TRS-398 Rev.1 (табл. 12), таймер — предупреждение', () => {
  for (const d of DATES) {
    const r = computeCobalt(formOf(d, { co_Mc: cells(d.fields['10×10']) }));
    assert.equal(r.compliance.status, 'nonstandard', d.date);
    assert.deepEqual(r.compliance.reasons.map((x) => x.ref), ['TRS-398 Rev.1, табл. 12'], d.date);
    assert.ok(r.messages.some((m) => m.level === 'warn' && /Ошибка таймера не учтена/.test(m.text)), d.date);
    // при РИК 80 или 100 см отступлений нет
    assert.equal(computeCobalt(formOf(d, { co_distance: '100', co_Mc: cells(d.fields['10×10']) })).compliance.status, 'standard', d.date);
  }
});

test('⁶⁰Co, Theratron Equinox 100: P₀ 101,3 вместо 101,325 кПа меняет дозу на 0,025 %, ур. (16) вместо (13) — на 0,03–0,08 %', () => {
  for (const d of DATES) {
    const sheet = computeCobalt(formOf(d, { co_Mc: cells(d.fields['10×10']) })).trs.ctrl.rateGy;
    const p0 = computeCobalt(formOf(d, { co_P0: c(101.325), co_Mc: cells(d.fields['10×10']) })).trs.ctrl.rateGy;
    near(p0 / sheet, 101.325 / 101.3, 1e-12, `${d.date}: P₀`);
    const eq16 = computeCobalt(formOf(d, { co_rec_trs: 'eq16', co_Mc: cells(d.fields['10×10']) })).trs;
    const ratio = Math.abs(d.M1.reduce((a, b) => a + b) / d.M2.reduce((a, b) => a + b));
    near(eq16.ks, (9 - 1) / (9 - ratio), 1e-12, `${d.date}: k_s по ур. (16)`);
    const dPct = (eq16.ctrl.rateGy / sheet - 1) * 100;
    assert.ok(dPct < -0.02 && dPct > -0.09, `${d.date}: ур. (16) даёт ${dPct} %`);
  }
});

test('⁶⁰Co, Theratron Equinox 100: мощность дозы больше 2 Гр/мин при ур. (13) — предупреждение (TRS-398 Rev.1, разд. 4.4.3.4 b)', () => {
  const warned = (r) => r.messages.some((m) => m.level === 'warn' && m.ref === 'TRS-398 Rev.1, разд. 4.4.3.4 b)' && /больше 2 Гр\/мин/.test(m.text));
  const [d1, d2] = DATES; // 1,45 и 2,45 Гр/мин
  assert.equal(warned(computeCobalt(formOf(d1, { co_Mc: cells(d1.fields['20×20']) }))), false, `${d1.date}: 1,6 Гр/мин`);
  const r = computeCobalt(formOf(d2, { co_Mc: cells(d2.fields['10×10']) }));
  assert.ok(warned(r), `${d2.date}: 2,45 Гр/мин`);
  assert.equal(r.flags.co_rec_trs, 'warn');
  // по основной серии без контрольных — тоже; при ур. (16), проверке выхода и по TG-51 — нет
  assert.ok(warned(computeCobalt(formOf(d2))));
  assert.equal(warned(computeCobalt(formOf(d2, { co_rec_trs: 'eq16' }))), false);
  assert.equal(warned(computeCobalt(formOf(d2, { co_fixed: true, co_fixed_kpol: '1,0009', co_fixed_ks: '1,0010' }))), false);
  assert.equal(computeCobalt(formOf(d2, { protocol: 'tg51', co_zref: '10' })).messages.some((m) => /больше 2 Гр\/мин/.test(m.text)), false);
  // доза при этом та же, что в листе
  near(r.trs.ctrl.rateGy, d2.xl.D['10×10'], 1e-6, `${d2.date}: доза`);
});
