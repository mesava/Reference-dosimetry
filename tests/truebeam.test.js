// Приёмка на независимых данных: протоколы калибровки Varian TrueBeam от 30.06.2026 — фотоны 6 МВ, 6 МВ БВФ, 10 МВ,
// 10 МВ БВФ, камера IBA FC65-P, TRS-398, РИП 100 см, z_ref = 10 см. Эталон — расчёт отделения в Excel (свой шаблон
// протокола, не связанный с калькулятором). Данные обезличены: без учреждения, ФИО и заводских номеров.
//
// Как устроен эталонный лист: M_Q = M₁·k_TP·k_elec·k_pol·k_s·k_FFF·C, D(z_ref) = M_Q·N_D,w·k_Q, D(z_max) = D(z_ref)·100/PDD(10).
// C — поправочный множитель из свидетельства о поверке (в калькуляторе k_лаб); k_Q взят по таблице; k_s — метод двух
// напряжений с коэффициентами a₀ = 1,198, a₁ = −0,8753, a₂ = 0,6773 (V₁/V₂ = 3); k_TP — с 273,2 (TRS-398 Rev.1 — 273,15);
// k_FFF = 1,003 для обоих пучков БВФ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePhotons, FORM_DEFAULTS } from '../src/core/photons.js';
import { kvolGeneric } from '../src/core/trs398.js';

const c = (x) => String(x).replace('.', ',');
const cells = (a) => a.map(c);
const near = (a, b, rel, msg) => assert.ok(Math.abs(a / b - 1) <= rel, `${msg}: ${a} ≠ ${b} (±${rel * 100} %)`);

const BASE = {
  ...FORM_DEFAULTS, protocol: 'trs', setup_geometry: 'SSD', setup_ssd: '100', setup_field: '10', setup_depth: '10',
  ch_model: 'FC65P', ch_ndw: c(0.0479), ch_ndw_unit: 'Gy/nC', ch_klab: c(1.008), ch_T0: '20', ch_P0: c(101.3), el_kelec: '1',
  env_T: c(21.5), env_P: c(99.79), env_P_unit: 'kPa', env_H: '50', rd_mu: '100', rd_V1: '300', rd_V2: '100', rd_polarity: '+',
  qtrs_method: 'ratio', qtrs_v10: '1', dd_on: true, dd_zmax: c(1.45), dd_nominal: '1,000', dd_nominal_at: 'dmax',
};

// xl — значения эталонного листа (вычисленные Excel, без округления)
const BEAMS = [
  { beam: '6 МВ', fff: false, tpr: 0.667, kq: 0.9914, kfff: 1, pdd: 66.2,
    M1: [13.55, 13.55, 13.56], Mopp: [-13.56, -13.56, -13.56], M2: [13.46, 13.47, 13.46],
    xl: { kTP: 1.020325152123689, kpol: 1.0002459419576981, ks: 1.003234302061462, D: 0.6642611351339645, Dmax: 1.0034156119848405 } },
  { beam: '6 МВ БВФ', fff: true, tpr: 0.632, kq: 0.9954, kfff: 1.003, pdd: 63.21,
    M1: [12.81, 12.83, 12.82], Mopp: [-12.82, -12.83, -12.82], M2: [12.64, 12.65, 12.64],
    xl: { kTP: 1.020325152123689, kpol: 1.0001300052002078, ks: 1.0068295521416817, D: 0.6349413981227329, Dmax: 1.0044951718442223 } },
  { beam: '10 МВ', fff: false, tpr: 0.74, kq: 0.978, kfff: 1, pdd: 73.61,
    M1: [15.29, 15.28, 15.28], Mopp: [-15.28, -15.28, -15.28], M2: [15.17, 15.17, 15.19],
    xl: { kTP: 1.020325152123689, kpol: 0.9998909487459106, ks: 1.0034021368937842, D: 0.7387869864744925, Dmax: 1.0036503008755502 } },
  { beam: '10 МВ БВФ', fff: true, tpr: 0.706, kq: 0.9853, kfff: 1.003, pdd: 70.94,
    M1: [14.42, 14.42, 14.42], Mopp: [-14.42, -14.43, -14.43], M2: [14.06, 14.08, 14.08],
    xl: { kTP: 1.020325152123689, kpol: 1.000231160425335, ks: 1.012217508298886, D: 0.7107936502318296, Dmax: 1.0019645478317305 } },
];
const formOf = (b, extra = {}) => ({
  ...BASE, meta_beam: b.beam, meta_fff: b.fff, qtrs_v20: c(b.tpr), dd_pdd: c(b.pdd),
  rd_M1: cells(b.M1), rd_Mopp: cells(b.Mopp), rd_M2: cells(b.M2), ...extra,
});

test('TrueBeam, 4 пучка фотонов: поправки k_TP, k_pol, k_s — как в независимом расчёте', () => {
  for (const b of BEAMS) {
    const r = computePhotons(formOf(b));
    assert.deepEqual(r.messages.filter((m) => m.level === 'error'), [], b.beam);
    assert.equal(r.compliance.status, 'standard', b.beam);
    near(r.trs.kpol, b.xl.kpol, 1e-12, `${b.beam}: k_pol`);
    near(r.trs.kTP, b.xl.kTP, 2e-6, `${b.beam}: k_TP (273,15 вместо 273,2)`);
    near(r.trs.ks, b.xl.ks, 1e-5, `${b.beam}: k_s (коэффициенты a₀, a₁, a₂ с другим числом знаков)`);
  }
});

test('TrueBeam: с теми же k_Q и k_vol, что в листе, доза на z_ref и d_max совпадает', () => {
  for (const b of BEAMS) {
    const r = computePhotons(formOf(b, { kqtrs_mode: 'manual', kqtrs_manual: c(b.kq), ...(b.fff ? { prof_mode: 'manual', prof_value: c(b.kfff) } : {}) }));
    near(r.trs.DperMU, b.xl.D, 3e-5, `${b.beam}: D(z_ref) за 100 МЕ`);
    near(r.trs.DmaxPerMU, b.xl.Dmax, 3e-5, `${b.beam}: D(d_max) за 100 МЕ`);
  }
});

test('TrueBeam: k_Q по табл. 16 TRS-398 Rev.1 для FC65-P — значения листа; по формуле — в пределах 0,015 %', () => {
  for (const b of BEAMS) {
    const t = computePhotons(formOf(b, { kqtrs_mode: 'table' })).trs;
    assert.ok(Math.abs(t.kQ - b.kq) <= 5e-5, `${b.beam}: k_Q табл. 16 ${t.kQ} ≠ ${b.kq}`);
    near(t.kQFormula, b.kq, 1.5e-4, `${b.beam}: k_Q по формуле`);
  }
});

test('TrueBeam, пучки БВФ: k_vol по TRS-398 Rev.1 зависит от TPR — в листе одно значение 1,003 для обоих', () => {
  // FC65-P: длина полости 2,3 см; РИД 110 см (РИП 100 см + 10 см). Ур. (22): 6 МВ БВФ — 1,0014, 10 МВ БВФ — 1,0034.
  const [b6, b10] = BEAMS.filter((b) => b.fff);
  const k6 = computePhotons(formOf(b6)).trs;
  const k10 = computePhotons(formOf(b10)).trs;
  near(k6.kvol, kvolGeneric({ tpr: 0.632, lengthCm: 2.3, sddCm: 110 }), 1e-12, '6 МВ БВФ: k_vol по ур. (22)');
  near(k10.kvol, kvolGeneric({ tpr: 0.706, lengthCm: 2.3, sddCm: 110 }), 1e-12, '10 МВ БВФ: k_vol по ур. (22)');
  assert.equal(k6.kvol.toFixed(4), '1.0014');
  assert.equal(k10.kvol.toFixed(4), '1.0034');
  // табл. 11 даёт то же с точностью до 0,0005
  for (const [b, k] of [[b6, k6], [b10, k10]]) {
    const t11 = computePhotons(formOf(b, { prof_mode: 'table11' })).trs.kvol;
    assert.ok(Math.abs(t11 - k.kvol) <= 5e-4, `${b.beam}: табл. 11 ${t11} vs ур. (22) ${k.kvol}`);
  }
  // разница доз с листом при прочих равных — ровно отношение k_vol
  for (const [b, k] of [[b6, k6], [b10, k10]]) {
    const same = computePhotons(formOf(b, { kqtrs_mode: 'manual', kqtrs_manual: c(b.kq) })).trs;
    near(same.DperMU / b.xl.D, k.kvol / b.kfff, 3e-5, `${b.beam}: расхождение с листом объясняется k_vol`);
  }
});
