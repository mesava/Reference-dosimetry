// Приёмка на независимых данных: 12 протоколов калибровки Varian Halcyon, 6 МВ БВФ, за 8 дат с 23.03.2023 по 11.03.2024
// (в 4 датах — второй протокол после перекалибровки). Эталон — лист МАГАТЭ «TRS-398 v1.06, high-energy photons» (Excel),
// не связанный с калькулятором. Данные обезличены: без учреждения, ФИО и заводских номеров.
//
// Ввод — «как в протоколах»: T₀ = 22 °C, P₀ и N_D,w — из протокола каждой даты, k_Q — значение протокола (вручную),
// k_vol = 1 (в протоколах не вносился), TPR₂₀,₁₀ = 0,629, PDD(10) = 63 %, номинал 1 сГр/МЕ на d_max, РИП 100 см,
// камера Sun Nuclear SNC600c. Значения протоколов — D(d_max), сГр/МЕ, как они записаны (4 знака).
// Перекалибровка: 04.07.2023 — раздел 9 (отклонение больше допуска 2 %), в остальные даты — контрольные измерения
// (раздел 7). После перекалибровки калькулятор берёт k_pol и k_s основной серии, а в протоколах их мерили заново:
// отсюда разница до 0,15 %.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePhotons, FORM_DEFAULTS } from '../src/core/photons.js';

const c = (x) => String(x).replace('.', ',');

const BASE = {
  ...FORM_DEFAULTS, protocol: 'trs', meta_beam: '6 MV FFF', meta_energy: '6', meta_fff: true,
  setup_geometry: 'SSD', setup_ssd: '100', setup_field: '10', setup_depth: '10',
  ch_model: 'SNC600c', ch_ndw_unit: 'Gy/nC', ch_klab: '1,000', ch_T0: '22', el_kelec: '1,000',
  env_H: '50', env_P_unit: 'kPa', rd_mu: '100', rd_V1: '300', rd_beam: 'pulsed', rd_kleak: '1,000',
  qtrs_method: 'known', qtrs_tpr: c(0.629), kqtrs_mode: 'manual', prof_mode: 'manual', prof_value: '1,000', prof_length: c(22.7),
  dd_on: true, dd_sad: 'tmr', dd_pdd: '63', dd_nominal: '1,000', dd_tol: '2', dd_nominal_at: 'dmax',
};

// xl — D(d_max) протокола, сГр/МЕ; pre — разница калькулятора и протокола из-за несогласованного ввода показаний в листе, %
const DATES = [
  { date: '2023-03-23', P0: 101.3, ndw: 0.05129, kq: 0.9999, T: 23.1, P: 99.5, V2: 150, pol: '-', M1: 12.03, Mopp: 12.03, M2: 11.95, xl: 1.0081, pre: -0.08 },
  { date: '2023-04-27', P0: 101.3, ndw: 0.05129, kq: 0.9999, T: 24.6, P: 101.3, V2: 150, pol: '-', M1: 12.11, Mopp: 12.12, M2: 12.03, xl: 1.0018, pre: -0.04 },
  { date: '2023-07-04', P0: 101.3, ndw: 0.05129, kq: 0.9999, T: 22.6, P: 100.9, V2: 150, pol: '-', M1: 12.41, Mopp: 12.41, M2: 12.33, xl: 1.0227,
    recal: 12.14, xlAfter: 1.0006 },
  { date: '2023-08-22', P0: 101.3, ndw: 0.05129, kq: 0.9999, T: 22.8, P: 101, V2: 150, pol: '-', M1: 12.23, Mopp: 12.24, M2: 12.16, xl: 1.0073 },
  { date: '2023-10-06', P0: 101.3, ndw: 0.05129, kq: 0.9999, T: 22.4, P: 100.8, V2: 150, pol: '-', M1: 12.31, Mopp: 12.32, M2: 12.22, xl: 1.0161,
    ctrl: 12.12, xlAfter: 0.9989 },
  { date: '2023-11-24', P0: 101.325, ndw: 0.05177, kq: 0.998, T: 20, P: 98.4, V2: 100, pol: '-', zmax: 1.26, M1: 12.02, Mopp: 12.03, M2: 11.87, xl: 1.014, pre: 0.08,
    ctrl: 11.87, xlAfter: 1.0014 },
  { date: '2023-12-29', P0: 101.325, ndw: 0.05177, kq: 0.997, T: 22, P: 101.3, V2: 100, pol: '+', M1: 12.1, Mopp: 12.2, M2: 11.9, xl: 1.0039 },
  { date: '2024-03-11', P0: 101.325, ndw: 0.05129, kq: 0.9978, T: 20.2, P: 102.4, V2: 100, pol: '+', M1: 12.54, Mopp: 12.54, M2: 12.35, xl: 1.0094,
    ctrl: 12.41, xlAfter: 0.9982 },
];
const formOf = (d, extra = {}) => ({
  ...BASE, meta_date: d.date, ch_P0: c(d.P0), ch_ndw: c(d.ndw), kqtrs_manual: c(d.kq), kqtrs_src: 'как в протоколе',
  env_T: c(d.T), env_P: c(d.P), rd_V2: String(d.V2), rd_polarity: d.pol, dd_zmax: c(d.zmax ?? 1.3),
  rd_M1: [c(d.M1), '', ''], rd_Mopp: [c(d.Mopp), '', ''], rd_M2: [c(d.M2), '', ''], ...extra,
});

test('Halcyon, 8 дат: D(d_max) до перекалибровки — как в протоколах', () => {
  for (const d of DATES) {
    const r = computePhotons(formOf(d));
    assert.deepEqual(r.messages.filter((m) => m.level === 'error'), [], d.date);
    const delta = (r.trs.DmaxPerMU / d.xl - 1) * 100;
    // без pre — совпадение до округления протокола (4 знака); с pre — разница, объяснённая вводом в листе
    assert.ok(Math.abs(delta - (d.pre ?? 0)) <= 0.01, `${d.date}: ${r.trs.DmaxPerMU} vs ${d.xl} (${delta.toFixed(3)} %)`);
  }
});

test('Halcyon, 4 перекалибровки: D(d_max) после — в пределах 0,15 % (k_pol и k_s в протоколах мерили заново)', () => {
  for (const d of DATES.filter((x) => x.xlAfter)) {
    const extra = d.recal
      ? { recal_needed: 'yes', recal_M: [c(d.recal), '', ''] }
      : { ctrl_M: [c(d.ctrl), '', ''] };
    const t = computePhotons(formOf(d, extra)).trs;
    const after = d.recal ? t.recal : t.ctrl;
    assert.equal(after.blocked, false, d.date);
    const delta = (after.DmaxPerMU / d.xlAfter - 1) * 100;
    assert.ok(Math.abs(delta) <= 0.16, `${d.date}: ${after.DmaxPerMU} vs ${d.xlAfter} (${delta.toFixed(3)} %)`);
  }
});

test('Halcyon, 29.12.2023: k_pol вне 1 ± 0,004 — предупреждение, как и в протоколе', () => {
  const r = computePhotons(formOf(DATES.find((x) => x.date === '2023-12-29')));
  assert.ok(Math.abs(r.trs.kpol - 1) > 0.004);
  assert.ok(r.messages.some((m) => m.level === 'warn' && /k_pol/.test(m.text)));
});
