// Модельные (вымышленные) данные для частей, которых нет в реальных протоколах: ⁶⁰Co (ошибка таймера,
// пересчёт на z_max, распад), перекрёстная калибровка, электроны цилиндрической камерой, TG-51 целиком,
// СПО качеств TW по DIN 6809-4. Данные не измерены, а построены обратным счётом: задаётся «истинная» доза,
// из неё по формулам первоисточника получаются показания камер; калькулятор должен вернуть ту же дозу.
// Табличные значения ниже переписаны из текста документов (не из кода): TRS-398 Rev.1 табл. 10, 16, 20, 21, 28;
// аддендум TG-51 (2014) табл. I; Report 385 табл. 4–7; DIN 6809-4:2020 табл. 2. Отчёт — docs/validation.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCobalt, CO_DEFAULTS } from '../src/core/cobalt.js';
import { computeCrossCal, crossCalTransfer } from '../src/core/crosscal.js';
import { computePhotons, FORM_DEFAULTS } from '../src/core/photons.js';
import { computeElectrons, E_DEFAULTS } from '../src/core/electrons.js';
import { TW_COLUMNS, kgFromTable } from '../src/core/kv-tables.js';

const rel = (a, b, tol, msg) => assert.ok(Math.abs(a / b - 1) <= tol, `${msg ?? ''}: ${a} ≠ ${b} (отн. ${tol})`);
const fmt = (x) => String(+x.toPrecision(12)).replace('.', ',');
const cells = (x) => [fmt(x), fmt(x), fmt(x)];

// TRS-398 Rev.1: ур. (10) k_TP, (11) k_pol, (13) k_s с табл. 10 (импульсный, V1/V2 = 3); TG-51: ур. (10), (11), (12)
const kTP = (T, P, T0 = 20, P0 = 101.325, a = 273.15) => ((a + T) / (a + T0)) * (P0 / P);
const ks13 = (r) => 1.198 - 0.875 * r + 0.677 * r * r;
const pion51 = (r, n = 3) => (1 - n) / (r - n);
/** Сырые показания (обычная, обратная полярность, V₂) камеры, давшей дозу D. */
function readings(D, N, kQ, { T, P, kpol, r12 }, proto = 'trs', T0 = 20, P0 = 101.325) {
  const k = proto === 'tg51' ? kTP(T, P, T0, P0, 273.2) * kpol * pion51(r12) : kTP(T, P, T0, P0) * kpol * ks13(r12);
  const M1 = D / (N * kQ * k);
  return { M1: cells(M1), Mopp: cells(-(2 * kpol - 1) * M1), M2: cells(M1 / r12) };
}

// --------------------------------------------------------------------------------------------- ⁶⁰Co
const CO = (() => {
  const N = 0.04812, klab = 1.004, T = 22.4, P = 99.2, kpol = 1.0011, r12 = 1.0021, rate = 0.953, tau = 0.0123;
  const raw = rate / (N * klab * kTP(T, P) * kpol * ks13(r12)); // нКл/мин
  const at = (t) => raw * (t + tau);
  const form = {
    ...CO_DEFAULTS, protocol: 'trs', co_geometry: 'SSD', co_distance: '80', co_zref: '5', co_ch_model: 'NE2571',
    co_ndw: fmt(N), co_klab: fmt(klab), co_T0: '20', co_P0: '101,325', co_env_T: fmt(T), co_env_P: fmt(P), co_time: '1',
    co_M1: cells(at(1)), co_Mopp: cells(-(2 * kpol - 1) * at(1)), co_M2: cells(at(1) / r12),
    co_dd_on: true, co_zmax: '0,5', co_pdd: '78,8', co_date: '2026-11-03', co_ref_rate: '150', co_ref_date: '2024-03-01',
    co_act0: '9800', co_act_unit: 'Ci', co_act_date: '2023-07-15',
  };
  return { form, rate, tau, raw, at, r12, kpol };
})();

test('⁶⁰Co (модель): ошибка таймера серией облучений 0,5/1/2 мин — τ и мощность дозы', () => {
  const r = computeCobalt({ ...CO.form, co_timer_mode: 'measured', co_tt: ['0,5', '1', '2'], co_tm: [0.5, 1, 2].map((t) => fmt(CO.at(t))) });
  rel(r.timer.tau, CO.tau, 1e-7, 'τ');
  rel(r.trs.rate, CO.rate * 100, 1e-8, 'сГр/мин на z_ref');
  rel(r.trs.rateMax, (CO.rate * 100) / 0.788, 1e-8, 'на z_max = D(z_ref)/PDD');
});

test('⁶⁰Co (модель): τ по одному облучению t и n облучениям по t/n (TRS-398, 2004, разд. 5.8, сноска b)', () => {
  const MA = CO.raw * (1 + CO.tau);
  const MB = CO.raw * (1 + 5 * CO.tau);
  const r = computeCobalt({ ...CO.form, co_timer_mode: 'nexp', co_nx_t: '1', co_nx_n: '5', co_nx_M1: cells(MA), co_nx_Mn: cells(MB) });
  rel(r.timer.tau, (MB * 1 - MA * 1) / (5 * MA - MB), 1e-7, 'τ = (M_B·t_A − M_A·t_B)/(n·M_A − M_B)');
  rel(r.trs.rate, CO.rate * 100, 1e-8);
});

test('⁶⁰Co (модель): время в секундах, установка по РИК с TMR, контрольное облучение 2 мин', () => {
  const s = computeCobalt({ ...CO.form, co_timer_mode: 'manual', co_tau: fmt(CO.tau * 60), co_time: '60', co_time_unit: 's' });
  rel(s.trs.rate, CO.rate * 100, 1e-8, 'секунды');
  const r = computeCobalt({ ...CO.form, co_geometry: 'SAD', co_dd_sad: 'tmr', co_tmr: '0,904', co_timer_mode: 'manual', co_tau: fmt(CO.tau), co_Mc: cells(CO.at(2)), co_ctrl_time: '2' });
  rel(r.trs.rateMax, (CO.rate * 100) / 0.904, 1e-8, 'D(z_max) = D(z_ref)/TMR');
  rel(r.trs.ctrl.rate, CO.rate * 100, 1e-8, 'контроль');
});

test('⁶⁰Co (модель): распад от даты значения сравнения и от даты установки источника', () => {
  const r = computeCobalt({ ...CO.form, co_timer_mode: 'manual', co_tau: fmt(CO.tau) });
  // T½ = 1925,28 сут (DDEP); в коде 5,2711 г × 365,25 = 1925,27 сут — разница множителя 2·10⁻⁶ за 2,7 года
  const f = (d) => 2 ** (-d / 1925.28);
  assert.equal(r.depth.days, 977);
  rel(r.depth.expected, 150 * f(977), 1e-5, 'ожидаемая мощность дозы');
  rel(r.source.A, 9800 * f(1207), 1e-5, 'активность');
});

test('⁶⁰Co (модель): TG-51, z_ref 10 см — P_TP (273,2), P_ion ур. (11), пересчёт через %dd', () => {
  const r = computeCobalt({ ...CO.form, protocol: 'tg51', co_zref: '10', co_distance: '100', co_timer_mode: 'manual', co_tau: fmt(CO.tau), co_pdd: '55,6' });
  const ptp = kTP(22.4, 99.2, 20, 101.325, 273.2);
  const pion = (1 - 9) / (CO.r12 - 9);
  const rate = CO.raw * ptp * CO.kpol * pion * 0.04812 * 1.004 * 100;
  rel(r.tg51.Pion, pion, 1e-9, 'P_ion');
  rel(r.tg51.rate, rate, 1e-9);
  rel(r.tg51.rateMax, rate / 0.556, 1e-9);
});

// ---------------------------------------------------------------------- перекрёстная калибровка
test('Перекрёстная калибровка (модель), МВ фотоны: PTW 30013 по NE 2571 в TPR 0,70, работа в TPR 0,76 (ур. 27, 30)', () => {
  const T16 = { NE2571: { 0.7: 0.9891 }, PTW30013: { 0.7: 0.984, 0.76: 0.9699 } };
  const Nref = 0.045, Nfld = 0.0535;
  const envR = { T: 21.3, P: 99.85, kpol: 1.0008, r12: 1.006 };
  const envF = { T: 21.7, P: 99.8, kpol: 0.9994, r12: 1.0045 };
  const a = readings(0.8, Nref, T16.NE2571[0.7], envR);
  const b = readings(0.8, Nfld, T16.PTW30013[0.7], envF);
  const r = computeCrossCal({
    protocol: 'trs', cc_beam_type: 'photons', cc_tpr_method: 'tpr', cc_tpr: '0,70', cc_mu: '100', cc_ref_model: 'NE2571', cc_ref_ndw: fmt(Nref),
    cc_ref_kqtrs_mode: 'table', cc_fld_model: 'PTW30013', cc_T: fmt(envR.T), cc_P: fmt(envR.P), cc_T2: fmt(envF.T), cc_P2: fmt(envF.P),
    cc_ref_M1: a.M1, cc_ref_Mopp: a.Mopp, cc_ref_M2: a.M2, cc_fld_M1: b.M1, cc_fld_Mopp: b.Mopp, cc_fld_M2: b.M2,
  });
  rel(r.trs.N, Nfld * T16.PTW30013[0.7], 1e-9, 'N_D,w,Qcross');
  const envQ = { T: 22, P: 100.1, kpol: 0.9992, r12: 1.0052 };
  const q = readings(0.66, Nfld, T16.PTW30013[0.76], envQ);
  const p = computePhotons({ ...FORM_DEFAULTS, ...crossCalTransfer(r, 'photons'), protocol: 'trs', qtrs_method: 'known', qtrs_tpr: '0,76', kqtrs_mode: 'table',
    env_T: fmt(envQ.T), env_P: fmt(envQ.P), rd_M1: q.M1, rd_Mopp: q.Mopp, rd_M2: q.M2, dd_on: false });
  rel(p.trs.DperMU, 0.66, 1e-9, 'доза рабочей камерой');
});

test('Перекрёстная калибровка (модель), ⁶⁰Co: ур. (32) и мощность дозы рабочей камерой на вкладке ⁶⁰Co', () => {
  const env = { T: 20.8, P: 100.4 };
  const a = readings(0.95, 0.045, 1, { ...env, kpol: 1.0006, r12: 1.001 });
  const b = readings(0.95, 0.0535, 1, { ...env, kpol: 1.0011, r12: 1.0014 });
  const r = computeCrossCal({ protocol: 'trs', cc_beam_type: 'co60', cc_co_zref: '5', cc_time: '1', cc_ref_model: 'NE2571', cc_ref_ndw: '0,045', cc_fld_model: 'PTW30013',
    cc_T: fmt(env.T), cc_P: fmt(env.P), cc_ref_M1: a.M1, cc_ref_Mopp: a.Mopp, cc_ref_M2: a.M2, cc_fld_M1: b.M1, cc_fld_Mopp: b.Mopp, cc_fld_M2: b.M2 });
  rel(r.trs.N, 0.0535, 1e-9, 'N_D,w рабочей');
  const q = readings(0.95, 0.0535, 1, { T: 21.5, P: 99.6, kpol: 1.0011, r12: 1.0014 });
  const c = computeCobalt({ ...CO_DEFAULTS, ...crossCalTransfer(r, 'co60'), co_env_T: '21,5', co_env_P: '99,6', co_timer_mode: 'manual', co_tau: '0', co_time: '1',
    co_M1: q.M1, co_Mopp: q.Mopp, co_M2: q.M2, co_dd_on: false });
  rel(c.trs.rate, 95, 1e-9);
});

test('Перекрёстная калибровка (модель), электроны TRS-398: Roos по NE 2571 при R50 = 8, работа при R50 = 3 (ур. 41, 44)', () => {
  const env = { T: 21, P: 100.2 };
  const a = readings(1, 0.045, 0.9075, { ...env, kpol: 1.001, r12: 1.008 }); // табл. 20, NE 2571, R50 = 8
  const b = readings(1, 0.152, 0.896, { ...env, kpol: 1.004, r12: 1.012 }); // табл. 20, Roos, R50 = 8
  const r = computeCrossCal({ protocol: 'trs', cc_beam_type: 'electrons', cc_r50_method: 'r50', cc_r50: '8', cc_mu: '100', cc_ref_model: 'NE2571', cc_ref_ndw: '0,045',
    cc_ref_kqtrs_mode: 'table', cc_fld_model: 'ROOS', cc_T: fmt(env.T), cc_P: fmt(env.P),
    cc_ref_M1: a.M1, cc_ref_Mopp: a.Mopp, cc_ref_M2: a.M2, cc_fld_M1: b.M1, cc_fld_Mopp: b.Mopp, cc_fld_M2: b.M2 });
  rel(r.trs.N, 0.152 * 0.896, 1e-9, 'N_D,w,Qcross');
  const q = readings(1.015, 0.152, 0.9349, { T: 21.4, P: 100, kpol: 1.006, r12: 1.01 }); // табл. 20, Roos, R50 = 3
  const e = computeElectrons({ ...E_DEFAULTS, ...crossCalTransfer(r, 'electrons'), protocol: 'trs', e_r50_method: 'r50', e_r50: '3', e_kqtrs_mode: 'table',
    e_env_T: '21,4', e_env_P: '100', e_M1: q.M1, e_Mopp: q.Mopp, e_M2: q.M2, e_dd_on: false });
  rel(e.trs.kQ, 1.0412 / 0.9979, 1e-9, 'k_Q,Qcross по табл. 21');
  // табл. 21 и табл. 20 согласованы до 2,3·10⁻⁵: столько и расходится доза с «истиной» по табл. 20
  rel(e.trs.DperMU, 1.015, 5e-5, 'доза Roos');
});

test('Перекрёстная калибровка (модель), электроны Report 385: ур. (5)–(6), R50 = 7,5 → 3', () => {
  const kqp = { NE2571: (R) => 0.977 + 0.117 * R ** -0.817, ROOS: (R) => 0.984 + 0.134 * Math.exp(-R / 3.511) }; // табл. 5, 7
  const KN = 0.152 * 0.898;
  const env = { T: 21, P: 100.2 };
  const a = readings(1, 0.045, kqp.NE2571(7.5) * 0.903, { ...env, kpol: 1.001, r12: 1.008 }, 'tg51');
  const b = readings(1, KN, kqp.ROOS(7.5), { ...env, kpol: 1.004, r12: 1.012 }, 'tg51');
  const r = computeCrossCal({ protocol: 'tg51', cc_beam_type: 'electrons', cc_r50_method: 'r50', cc_r50: '7,5', cc_mu: '100', cc_ref_model: 'NE2571', cc_ref_ndw: '0,045',
    cc_fld_model: 'ROOS', cc_T: fmt(env.T), cc_P: fmt(env.P), cc_ref_M1: a.M1, cc_ref_Mopp: a.Mopp, cc_ref_M2: a.M2, cc_fld_M1: b.M1, cc_fld_Mopp: b.Mopp, cc_fld_M2: b.M2 });
  rel(r.tg51.KN, KN, 1e-9, '(k_Qecal·N_D,w)_pp');
  const q = readings(1.015, KN, kqp.ROOS(3), { T: 21.4, P: 100, kpol: 1.006, r12: 1.01 }, 'tg51');
  const e = computeElectrons({ ...E_DEFAULTS, ...crossCalTransfer(r, 'electrons'), protocol: 'tg51', e_r50_method: 'r50', e_r50: '3', e_env_T: '21,4', e_env_P: '100',
    e_M1: q.M1, e_Mopp: q.Mopp, e_M2: q.M2, e_dd_on: false });
  rel(e.tg51.DperMU, 1.015, 1e-9, 'доза Roos, ур. (6)');
});

// ---------------------------------------------------------------- электроны цилиндрической камерой
test('Электроны (модель), NE 2571 в ⁶⁰Co: TRS-398 табл. 20 и Report 385, I50 = 5,7 и 3,1 см', () => {
  const nodes = [3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 10];
  const t20 = [0.9297, 0.9248, 0.921, 0.9181, 0.9157, 0.9137, 0.9121, 0.9095, 0.9075, 0.9047];
  for (const [I50, proto] of [[5.7, 'trs'], [5.7, 'tg51'], [3.1, 'trs']]) {
    const R50 = 1.029 * I50 - 0.06;
    const i = nodes.findIndex((x, j) => R50 >= x && R50 <= nodes[j + 1]);
    const kQ = proto === 'trs'
      ? t20[i] + ((R50 - nodes[i]) / (nodes[i + 1] - nodes[i])) * (t20[i + 1] - t20[i])
      : (0.977 + 0.117 * R50 ** -0.817) * 0.903;
    const q = readings(1, 0.045, kQ, { T: 21.2, P: 100.6, kpol: 1.0007, r12: 1.009 }, proto);
    const e = computeElectrons({ ...E_DEFAULTS, protocol: proto, e_ch_model: 'NE2571', e_ndw: '0,045', e_r50_method: 'i50', e_i50: fmt(I50), e_kqtrs_mode: 'table',
      e_env_T: '21,2', e_env_P: '100,6', e_M1: q.M1, e_Mopp: q.Mopp, e_M2: q.M2, e_dd_on: true, e_pdd: '98,5' });
    const x = proto === 'trs' ? e.trs : e.tg51;
    rel(x.kQ, kQ, 1e-9, `k_Q ${proto} I50 ${I50}`);
    rel(x.DperMU, 1, 1e-9, `D(z_ref) ${proto} I50 ${I50}`);
    rel(x.DmaxPerMU, 1 / 0.985, 1e-9, `D(z_max) ${proto} I50 ${I50}`);
    if (proto === 'trs') assert.match(e.positions.trs.text, new RegExp((0.6 * R50 - 0.1 + 0.16).toFixed(2).replace('.', ',')), 'центр на 0,5·r_cyl = 1,6 мм глубже z_ref');
  }
});

// ------------------------------------------------------------------------------------ TG-51 целиком
test('TG-51 (модель), фотоны: %dd(10)x всеми способами, k_Q аддендума, P_TP, P_ion, P_rp, доза на 10 см и d_max', () => {
  const ADD = { NE2571: [0.9882, 1.486, -2.14], PTW30013: [0.9652, 2.141, -2.623] }; // аддендум, табл. I
  const K63 = { PTW30013: 0.996 }; // аддендум, табл. I, столбец 63 — для интерполяции к 1,000 при 58 (разд. 3.D)
  const kq = (id, x) => (x > 63 ? ADD[id][0] + ADD[id][1] * 1e-3 * x + ADD[id][2] * 1e-5 * x * x : 1 + ((x - 58) / 5) * (K63[id] - 1));
  const scen = [
    { id: 'PTW30013', method: 'open', pdd10: 66.6, x: 66.6 },
    { id: 'PTW30013', method: 'foil50', pdd10pb: 79.8, x: (0.8905 + 0.0015 * 79.8) * 79.8 }, // ур. (13)
    { id: 'NE2571', method: 'foil30', pdd10pb: 76.4, x: (0.8116 + 0.00264 * 76.4) * 76.4 }, // ур. (14)
    { id: 'NE2571', method: 'interim', pdd10: 76.5, x: 1.267 * 76.5 - 20 }, // ур. (15)
    { id: 'PTW30013', method: 'manual', manual: 61.5, x: 61.5 },
    { id: 'PTW30013', method: 'foil50', pdd10pb: 63.4, x: 63.4, fff: true, prp: 1.0042, V2: 150 },
  ];
  for (const s of scen) {
    const n = 300 / (s.V2 ?? 100);
    const T = 22.6, P = 99.4, kpol = 1.0012, Pelec = 0.9995, r12 = 1.0071, D = 0.813, N = 0.0535;
    const k = kTP(T, P, 22, 101.33, 273.2) * kpol * ((1 - n) / (r12 - n)) * Pelec * (s.prp ?? 1);
    const M1 = D / (N * kq(s.id, s.x) * k);
    const r = computePhotons({ ...FORM_DEFAULTS, protocol: 'tg51', meta_fff: !!s.fff, ch_model: s.id, ch_ndw: fmt(N), ch_T0: '22', ch_P0: '101,33', el_kelec: fmt(Pelec),
      env_T: fmt(T), env_P: fmt(P), rd_V2: String(s.V2 ?? 100), rd_M1: cells(M1), rd_Mopp: cells(-(2 * kpol - 1) * M1), rd_M2: cells(M1 / r12),
      q51_method: s.method, q51_pdd10: s.pdd10 ? fmt(s.pdd10) : '', q51_pdd10pb: s.pdd10pb ? fmt(s.pdd10pb) : '', q51_manual: s.manual ? fmt(s.manual) : '',
      prof_mode: s.prp ? 'manual' : 'formula22', prof_value: s.prp ? fmt(s.prp) : '', dd_on: true, dd_pdd: '67', dd_zmax: '1,5' });
    rel(r.tg51.pdd10x, s.x, 1e-12, `%dd(10)x ${s.method}`);
    rel(r.tg51.DperMU, D, 1e-9, `D(10) ${s.method}`);
    rel(r.tg51.DmaxPerMU, D / 0.67, 1e-9, `D(d_max) ${s.method}`);
  }
});

// ------------------------------------------------------------------------- kV: качества TW, DIN 6809-4
test('kV: СПО качеств TW совпадают с DIN 6809-4:2020, табл. 2; k_g по табл. 28 — по ln(СПО) между ними', () => {
  const DIN = { TW10: 0.03, TW20: 0.113, TW30: 0.359, TW40: 0.741, TW50: 0.94, TW70: 2.94, TW100: 4.41 }; // мм Al, прочитано со скана
  for (const c of TW_COLUMNS) assert.equal(c.hvl, DIN[c.name], c.name);
  // 60 кВ, СПО 1,8 мм Al, f = 8 см против f = 3 см: между TW50 (0,98) и TW70 (0,95) табл. 28
  const s = Math.log(1.8 / 0.94) / Math.log(2.94 / 0.94);
  rel(kgFromTable('T28', { kv: 60, hvl: 1.8 }, 8, 3).value, 0.98 + s * (0.95 - 0.98), 1e-12, 'k_g');
});
