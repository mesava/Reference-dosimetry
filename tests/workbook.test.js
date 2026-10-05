// Сверка с рабочей книгой реальной калибровки (Elekta Versa HD): фотоны 6 и 10 МВ (PTW 30013),
// 6 и 10 МВ БВФ (PTW 31010) — 25.08.2026; электроны 6–15 МэВ (PTW 34001 Roos) — 04.12.2024.
// k_Q берётся тот же, что в книге (введён вручную); остальное калькулятор считает сам.
// Книга использует 273,2 в k_TP, TRS-398 Rev.1, ур. (10) — 273,15: разница ~1e-6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePhotons, FORM_DEFAULTS } from '../src/core/photons.js';
import { computeElectrons, E_DEFAULTS } from '../src/core/electrons.js';

const c = (x) => String(x).replace('.', ',');
const cells = (a) => a.map(c);
const near = (a, b, rel, msg) => assert.ok(Math.abs(a / b - 1) <= rel, `${msg}: ${a} ≠ ${b} (±${rel * 100} %)`);
const errorsOf = (r) => r.messages.filter((m) => m.level === 'error');

const P0 = {
  ...FORM_DEFAULTS, protocol: 'trs', setup_geometry: 'SAD', ch_T0: '20', ch_P0: '101,325', el_kelec: '1',
  env_T: '21,8', env_P: c(1014.42), env_P_unit: 'hPa', rd_V1: '400', rd_V2: '200', rd_polarity: '+',
  dd_on: false, dd_nominal: '1,000', dd_nominal_at: 'zref', qtrs_method: 'ratio', qtrs_v10: '100', kqtrs_mode: 'manual',
};
const PHOTONS = [
  { beam: '6 МВ', fff: false, ch: 'PTW30013', ndw: 0.05389, mu: 100, M1: [18.36, 18.36, 18.36], Mopp: [-18.37, -18.37, -18.38], M2: [18.31, 18.31, 18.32], C: [18.65, 18.64, 18.65], kq: 0.9875, tpr: 0.6805,
    xl: { ks: 1.0024663300825636, kpol: 1.0003631082062454, H: 100.0070960618935 } },
  { beam: '10 МВ', fff: false, ch: 'PTW30013', ndw: 0.05389, mu: 100, M1: [18.73, 18.72, 18.71], Mopp: [-18.74, -18.75, -18.74], M2: [18.66, 18.65, 18.66], C: [18.75, 18.74, 18.75], kq: 0.9758, tpr: 0.7377,
    xl: { ks: 1.0032921713114327, kpol: 1.0006232193732192, H: 99.45987611173346 } },
  { beam: '10 FFF', fff: true, ch: 'PTW31010', ndw: 0.297, mu: 500, M1: [16.67, 16.67, 16.68], Mopp: [-16.68, -16.66, -16.67], M2: [16.52, 16.52, 16.52], C: [16.95, 16.95, 16.96], kq: 0.9789, tpr: 0.7227,
    xl: { ks: 1.009127032820214, kpol: 0.9999000399840062, kvol: 1.00037211265, H: 500.0008479241143 } },
];

test('Рабочая книга, фотоны 6 МВ, 10 МВ, 10 МВ БВФ: k_s, k_pol, k_vol и доза по контрольным измерениям', () => {
  for (const b of PHOTONS) {
    const r = computePhotons({
      ...P0, meta_beam: b.beam, meta_fff: b.fff, ch_model: b.ch, ch_ndw: c(b.ndw), rd_mu: String(b.mu),
      rd_M1: cells(b.M1), rd_Mopp: cells(b.Mopp), rd_M2: cells(b.M2), ctrl_M: cells(b.C), qtrs_v20: c(b.tpr * 100), kqtrs_manual: c(b.kq),
      prof_mode: b.fff ? 'formula22' : 'manual', prof_length: b.fff ? '6,5' : '', prof_sdd: b.fff ? '100' : '',
    });
    assert.deepEqual(errorsOf(r), [], b.beam);
    assert.equal(r.compliance.status, 'standard', b.beam);
    near(r.trs.ks, b.xl.ks, 1e-12, `${b.beam}: k_s`);
    near(r.trs.kpol, b.xl.kpol, 1e-12, `${b.beam}: k_pol`);
    if (b.fff) near(r.trs.kvol, b.xl.kvol, 1e-12, `${b.beam}: k_vol`);
    near(r.trs.ctrl.DcGy, b.xl.H, 3e-6, `${b.beam}: доза за ${b.mu} МЕ`);
  }
});

const E0 = {
  ...E_DEFAULTS, protocol: 'trs', e_ssd: '100', e_field: '10', e_r50_method: 'r50', e_ch_model: 'ROOS', e_cal_route: 'co60', e_ndw: c(0.08287),
  e_T0: '20', e_P0: '101,325', e_kelec: '1', e_env_T: c(22.95), e_env_P: c(1030.315), e_env_P_unit: 'hPa', e_mu: '100', e_polarity: '+',
  e_V1: '200', e_V2: '100', e_beam_mode: 'pulsed', e_dd_on: true, e_nominal: '1,000', e_nominal_at: 'zmax', e_kqtrs_mode: 'manual',
};
const ELECTRONS = [
  { E: 6, r50: 2.4, M1: [12.77, 12.77, 12.78], Mopp: [-12.77, -12.78, -12.77], M2: [12.7, 12.7, 12.7], C: [12.76, 12.78, 12.77], pdd: 99.84, kq: 0.9445, M: 0.9984433571148288, N: 1.0000434265973848, Y: 0.9443772356505641 },
  { E: 8, r50: 3.186, M1: [12.93, 12.93, 12.94], Mopp: [-12.92, -12.94, -12.95], M2: [12.85, 12.86, 12.86], C: [12.94, 12.94, 12.94], pdd: 99.5536, kq: 0.9319, M: 0.9985522570696367, N: 1.0030297820165588, Y: 0.9321930034041774 },
  { E: 10, r50: 3.95, M1: [13.11, 13.11, 13.12], Mopp: [-13.11, -13.11, -13.11], M2: [13.03, 13.03, 13.03], C: [13.11, 13.11, 13.11], pdd: 99.93, kq: 0.9229, M: 1.0020703692507142, N: 1.0027723098676218, Y: 0.9226966898809855 },
  { E: 12, r50: 4.723, M1: [13.14, 13.15, 13.15], Mopp: [-13.13, -13.15, -13.15], M2: [13.06, 13.07, 13.06], C: [13.15, 13.15, 13.16], pdd: 99.68826666666666, kq: 0.9151, M: 0.9968697594814482, N: 0.9999870524529616, Y: 0.9149769695029426 },
  { E: 15, r50: 5.979, M1: [13.14, 13.14, 13.16], Mopp: [-13.14, -13.16, -13.14], M2: [13.06, 13.07, 13.07], C: [13.15, 13.15, 13.15], pdd: 98.62519999999999, kq: 0.9058, M: 0.9863643713733283, N: 1.000113937790066, Y: 0.9055502791294658 },
];

test('Рабочая книга, электроны 6–15 МэВ (Roos): доза на z_ref и z_max, k_Q по Report 385', () => {
  for (const b of ELECTRONS) {
    const f = { ...E0, e_beam: `${b.E} МэВ`, e_energy: String(b.E), e_r50: c(b.r50), e_M1: cells(b.M1), e_Mopp: cells(b.Mopp), e_M2: cells(b.M2), e_ctrl_M: cells(b.C), e_pdd: c(b.pdd), e_kqtrs_manual: c(b.kq) };
    const r = computeElectrons(f);
    assert.deepEqual(errorsOf(r), [], `${b.E} МэВ`);
    near(r.trs.ctrl.DperMU, b.M, 3e-6, `${b.E} МэВ: D(z_ref)`);
    near(r.trs.ctrl.DmaxPerMU, b.N, 3e-6, `${b.E} МэВ: D(z_max)`);
    // Report 385: k_Q = k_Qecal·k′_Q для Roos — как в столбце Y книги
    near(computeElectrons({ ...f, protocol: 'tg51' }).tg51.kQ, b.Y, 1e-12, `${b.E} МэВ: k_Q Report 385`);
  }
  // 8 МэВ: в книге k_Q = 0,9319, а по табл. 20 TRS-398 при R50 = 3,186 г/см² — 0,9324
  const t20 = computeElectrons({ ...E0, e_r50: c(3.186), e_kqtrs_mode: 'table', e_M1: cells([12.93, 12.93, 12.94]), e_Mopp: cells([-12.92, -12.94, -12.95]), e_M2: cells([12.85, 12.86, 12.86]), e_pdd: '99,55' });
  near(t20.trs.kQ, 0.9349 - (0.9349 - 0.9281) * (0.186 / 0.5), 1e-9, 'табл. 20, интерполяция 3,0–3,5 г/см²');
});
