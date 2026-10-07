// Перекрёстная калибровка (вкладка «Инструменты»): ручной расчёт по TRS-398 ур. (41) и Report 385 ур. (5),
// сквозная проверка с вкладкой «Электроны» и перенос результата.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCrossCal, crossCalTransfer, transferNumber, CC_DEFAULTS } from '../src/core/crosscal.js';
import { SAMPLE_CROSSCAL } from '../src/core/sample-crosscal.js';
import { computeElectrons, E_DEFAULTS } from '../src/core/electrons.js';
import { findEChamber, interpE, kQprime385 } from '../src/core/electron-chambers.js';
import { KS_COEFFICIENTS } from '../src/core/trs398.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const mean = (xs) => xs.map((x) => Number(String(x).replace(',', '.'))).reduce((s, x) => s + x, 0) / xs.length;
const num = (s) => Number(String(s).replace(',', '.'));
const errors = (r) => r.messages.filter((m) => m.level === 'error');
const has = (r, level, re) => r.messages.some((m) => m.level === level && re.test(m.text));

/** Исправленное показание вручную: TRS-398 (k_TP с 273,15, k_s по табл. 10) или TG-51 (P_TP с 273,2, P_ion ур. 12). */
function corrected(f, who, protocol) {
  const M1 = Math.abs(mean(f[`cc_${who}_M1`]));
  const Mopp = Math.abs(mean(f[`cc_${who}_Mopp`]));
  const M2 = Math.abs(mean(f[`cc_${who}_M2`]));
  const V1 = num(f[`cc_${who}_V1`]);
  const V2 = num(f[`cc_${who}_V2`]);
  const abs0 = protocol === 'tg51' ? 273.2 : 273.15;
  const kTP = ((abs0 + num(f.cc_T)) / (abs0 + num(f.cc_T0))) * (num(f.cc_P0) / num(f.cc_P));
  const kpol = (M1 + Mopp) / (2 * M1);
  let krec;
  if (protocol === 'tg51') krec = (1 - V1 / V2) / (M1 / M2 - V1 / V2);
  else {
    const [a0, a1, a2] = KS_COEFFICIENTS.pulsed[V1 / V2];
    const r = M1 / M2;
    krec = a0 + a1 * r + a2 * r * r;
  }
  return M1 * kTP * num(f[`cc_${who}_kelec`]) * kpol * krec;
}

test('демонстрационный пример: без замечаний по обоим протоколам', () => {
  for (const protocol of ['trs', 'tg51']) {
    const r = computeCrossCal({ ...SAMPLE_CROSSCAL, protocol });
    assert.deepEqual(r.messages.filter((m) => m.level !== 'info').map((m) => m.text), [], protocol);
  }
});

test('TRS-398 ур. (41): N_D,w,Qcross = (M_ref/M_field)·N_D,w·k_Qcross (табл. 20)', () => {
  const f = SAMPLE_CROSSCAL;
  const r = computeCrossCal({ ...f, protocol: 'trs' });
  const r50 = 1.029 * 7.4 - 0.06; // ур. (37)
  const kQ = interpE(findEChamber('PTW30013').trsT20, r50).value;
  // табл. 20, PTW 30013: 0,9090 при 7,0 и 0,9068 при 8,0 г/см²
  near(kQ, 0.9090 + ((r50 - 7) / 1) * (0.9068 - 0.9090), 1e-12, 'интерполяция табл. 20');
  const Mref = corrected(f, 'ref', 'trs');
  const Mfld = corrected(f, 'fld', 'trs');
  near(r.trs.ref.M, Mref, 1e-9, 'M опорной');
  near(r.trs.fld.M, Mfld, 1e-9, 'M рабочей');
  const N = (Mref / Mfld) * 0.05335 * kQ;
  near(r.trs.N, N, 1e-12, 'N_D,w,Qcross');
  near(r.trs.N, 0.07764, 5e-6, 'значение примера');
  near(r.trs.DperMU, Mref * 0.05335 * kQ, 1e-12, 'доза по опорной камере, Гр на 100 МЕ при 100 МЕ');
});

test('Report 385 ур. (5): (k_Qecal·N_D,w)_pp = (M k′_Q k_Qecal N)_cyl / (M k′_Q)_pp', () => {
  const f = SAMPLE_CROSSCAL;
  const r = computeCrossCal({ ...f, protocol: 'tg51' });
  const r50 = 1.029 * 7.4 - 0.06;
  const cyl = findEChamber('PTW30013');
  const pp = findEChamber('ROOS');
  // табл. 4–5: PTW 30013 — k_Qecal = 0,901, k′_Q = 0,978 + 0,112·R50^(−0,816); табл. 7: Roos — 0,984 + 0,134·exp(−R50/3,511)
  near(kQprime385(cyl, r50), 0.978 + 0.112 * Math.pow(r50, -0.816), 1e-12);
  near(kQprime385(pp, r50), 0.984 + 0.134 * Math.exp(-r50 / 3.511), 1e-12);
  const kQcyl = kQprime385(cyl, r50) * 0.901;
  const KN = (corrected(f, 'ref', 'tg51') * kQcyl * 0.05335) / (corrected(f, 'fld', 'tg51') * kQprime385(pp, r50));
  near(r.tg51.kQref, kQcyl, 1e-12, 'k_Q цилиндрической');
  near(r.tg51.KN, KN, 1e-12, '(k_Qecal·N_D,w)_pp');
  near(r.tg51.KN, 0.07705, 5e-6, 'значение примера');
});

/**
 * Сквозная проверка: коэффициент из «Инструментов» на вкладке «Электроны» в том же пучке и с теми же показаниями
 * рабочей камеры даёт ту же дозу, что опорная камера (TRS-398: k_Q,Qcross = 1 при Q = Qcross; Report 385: ур. 6).
 */
test('перенос во вкладку «Электроны»: доза рабочей камерой в пучке перекрёстной калибровки равна дозе опорной', () => {
  for (const protocol of ['trs', 'tg51']) {
    const cc = computeCrossCal({ ...SAMPLE_CROSSCAL, protocol });
    const patch = crossCalTransfer(cc);
    assert.ok(patch, protocol);
    const e = computeElectrons({
      ...E_DEFAULTS,
      ...patch,
      protocol,
      e_r50_method: 'i50',
      e_i50: SAMPLE_CROSSCAL.cc_i50,
      e_env_T: SAMPLE_CROSSCAL.cc_T,
      e_env_P: SAMPLE_CROSSCAL.cc_P,
      e_mu: SAMPLE_CROSSCAL.cc_mu,
      e_V1: SAMPLE_CROSSCAL.cc_fld_V1,
      e_V2: SAMPLE_CROSSCAL.cc_fld_V2,
      e_M1: SAMPLE_CROSSCAL.cc_fld_M1,
      e_Mopp: SAMPLE_CROSSCAL.cc_fld_Mopp,
      e_M2: SAMPLE_CROSSCAL.cc_fld_M2,
      e_dd_on: false,
      e_nominal: '',
    });
    assert.deepEqual(errors(e).map((m) => m.text), [], protocol);
    const x = protocol === 'tg51' ? e.tg51 : e.trs;
    const ref = protocol === 'tg51' ? cc.tg51 : cc.trs;
    // перенос округляет коэффициент до 6 значащих цифр, R50 — до 0,001 г/см²
    if (protocol === 'trs') near(x.kQ, 1, 1e-5, 'k_Q,Qcross в том же пучке');
    near(x.DperMU / ref.DperMU, 1, 1e-5, `${protocol}: доза рабочей камерой / опорной`);
  }
});

test('перенос: поля раздела 2 вкладки «Электроны»', () => {
  const trs = crossCalTransfer(computeCrossCal({ ...SAMPLE_CROSSCAL, protocol: 'trs' }));
  assert.equal(trs.e_ch_model, 'ROOS');
  assert.equal(trs.e_cal_route, 'cross');
  assert.equal(trs.e_cross_ndw_unit, 'Gy/nC');
  assert.equal(trs.e_cross_r50, '7,555');
  assert.equal(trs.e_T0, '20');
  assert.equal(trs.e_P0, '101,325');
  assert.equal(trs.e_kelec, '1,000');
  assert.ok(!('e_cross_kn' in trs));
  const tg = crossCalTransfer(computeCrossCal({ ...SAMPLE_CROSSCAL, protocol: 'tg51' }));
  assert.ok('e_cross_kn' in tg && !('e_cross_ndw' in tg));
  // ошибка — переносить нечего
  assert.equal(crossCalTransfer(computeCrossCal({ ...SAMPLE_CROSSCAL, cc_ref_ndw: '' })), null);
  // «другая» рабочая камера переносится вместе с моделью и типом
  const other = crossCalTransfer(computeCrossCal({ ...SAMPLE_CROSSCAL, cc_fld_model: 'OTHER', cc_fld_other_name: 'X', cc_fld_other_type: 'pp' }));
  assert.equal(other.e_ch_model, 'OTHER');
  assert.equal(other.e_other_name, 'X');
});

test('transferNumber: 6 значащих цифр, десятичный разделитель языка', () => {
  for (const v of [0.0776361733, 0.07705098844, 1.234567891, 53.3512345]) {
    const s = transferNumber(v);
    near(num(s) / v, 1, 1e-5, s);
  }
  assert.equal(transferNumber(NaN), '');
});

test('TG-51: опорная камера — только цилиндрическая, рабочая — только плоскопараллельная', () => {
  const a = computeCrossCal({ ...SAMPLE_CROSSCAL, protocol: 'tg51', cc_ref_model: 'NACP02' });
  assert.ok(errors(a).some((m) => /опорной должна быть цилиндрическая/.test(m.text)));
  assert.equal(a.flags.cc_ref_model, 'error');
  const b = computeCrossCal({ ...SAMPLE_CROSSCAL, protocol: 'tg51', cc_fld_model: 'FC65G' });
  assert.ok(errors(b).some((m) => /только плоскопараллельной камеры/.test(m.text)));
  // TRS-398 таких ограничений не ставит
  assert.deepEqual(errors(computeCrossCal({ ...SAMPLE_CROSSCAL, protocol: 'trs', cc_fld_model: 'FC65G' })), []);
});

test('TRS-398: опорная камера без данных табл. 20 — ошибка; ручной k_Q снимает её', () => {
  const a = computeCrossCal({ ...SAMPLE_CROSSCAL, protocol: 'trs', cc_ref_model: 'ADVMARKUS' });
  assert.ok(errors(a).some((m) => /табл\. 20 TRS-398 нет k_Q/.test(m.text)));
  const b = computeCrossCal({ ...SAMPLE_CROSSCAL, protocol: 'trs', cc_ref_model: 'ADVMARKUS', cc_ref_kqtrs_mode: 'manual', cc_ref_kqtrs_manual: '0,9' });
  assert.deepEqual(errors(b), []);
  near(b.trs.kQ, 0.9, 1e-12);
});

test('рекомендации по пучку: TRS-398 — R50 > 7 г/см², TG-51 — выше 10 МэВ', () => {
  const lo = { ...SAMPLE_CROSSCAL, cc_i50: '4,00' }; // R50 ≈ 4,06, E0 ≈ 9,5 МэВ
  assert.ok(has(computeCrossCal({ ...lo, protocol: 'trs' }), 'warn', /R50 > 7/));
  assert.ok(has(computeCrossCal({ ...lo, protocol: 'tg51' }), 'warn', /выше 10 МэВ/));
  assert.ok(!has(computeCrossCal({ ...SAMPLE_CROSSCAL, protocol: 'trs' }), 'warn', /R50 > 7/));
});

test('та же камера в роли опорной и рабочей — ошибка', () => {
  const r = computeCrossCal({ ...SAMPLE_CROSSCAL, cc_fld_model: 'PTW30013', cc_fld_serial: SAMPLE_CROSSCAL.cc_ref_serial });
  assert.ok(errors(r).some((m) => /совпадают/.test(m.text)));
});

test('свои T и P для рабочей камеры меняют только её k_TP', () => {
  const a = computeCrossCal({ ...SAMPLE_CROSSCAL, protocol: 'trs' });
  const b = computeCrossCal({ ...SAMPLE_CROSSCAL, protocol: 'trs', cc_T2: '22,3', cc_P2: '100,80' });
  near(b.trs.ref.kTP, a.trs.ref.kTP, 1e-15);
  near(b.trs.fld.kTP, ((273.15 + 22.3) / 293.15) * (101.325 / 100.8), 1e-12);
  near(b.trs.N / a.trs.N, a.trs.fld.kTP / b.trs.fld.kTP, 1e-12);
});

test('пустая форма: ошибки, итога нет', () => {
  const r = computeCrossCal({ ...CC_DEFAULTS });
  assert.ok(errors(r).length > 5);
  assert.ok(r.trs.blocked);
  assert.ok(!Number.isFinite(r.trs.N) || r.trs.blocked);
});

test('k_s > 1,05 и разброс показаний: ошибки и флажки у нужной камеры', () => {
  const r = computeCrossCal({ ...SAMPLE_CROSSCAL, protocol: 'trs', cc_fld_M2: ['11,5', '11,5', '11,5'] });
  assert.ok(errors(r).some((m) => /k_s \(рабочая камера\)/.test(m.text)));
  assert.equal(r.flags.ks_fld, 'error');
  assert.equal(r.flags.ks_ref, undefined);
  const s = computeCrossCal({ ...SAMPLE_CROSSCAL, cc_ref_M1: ['20,52', '20,53', '20,71'] });
  assert.equal(s.flags.cc_ref_M1, 'warn');
});

// ------------------------------------------------------------ ⁶⁰Co и МВ фотоны (TRS-398, разд. 4.5, 5.5, 6.6)
import { SAMPLE_CROSSCAL_PHOTONS, SAMPLE_CROSSCAL_CO60 } from '../src/core/sample-crosscal.js';
import { crossCalTargets } from '../src/core/crosscal.js';
import { computePhotons, FORM_DEFAULTS } from '../src/core/photons.js';
import { findChamber } from '../src/core/chambers.js';
import { kQFromTable, kQ as kQtrs, kvolGeneric } from '../src/core/trs398.js';

const noMon = { ...SAMPLE_CROSSCAL_PHOTONS, cc_monitor: false };

test('демонстрационные примеры ⁶⁰Co и фотонов: без замечаний; TG-51 — расчёт по TRS-398 со справкой', () => {
  for (const s of [SAMPLE_CROSSCAL_CO60, SAMPLE_CROSSCAL_PHOTONS]) {
    const r = computeCrossCal(s);
    assert.deepEqual(r.messages.filter((m) => m.level !== 'info').map((m) => m.text), [], s.cc_beam_type);
    const g = computeCrossCal({ ...s, protocol: 'tg51' });
    assert.equal(g.protocolUsed, 'trs');
    assert.ok(g.messages.some((m) => /не описывают перекрёстную калибровку/.test(m.text)));
    near(g.trs.N, r.trs.N, 1e-15, 'TG-51 в шапке не меняет результат');
  }
});

test('⁶⁰Co, ур. (25)/(32): N_D,w рабочей = (M_ref/M_field)·N_D,w опорной, k_Q = 1', () => {
  const f = SAMPLE_CROSSCAL_CO60;
  const r = computeCrossCal(f);
  // k_s по ур. (13), табл. 10 (V1/V2 = 3) — как во вкладке ⁶⁰Co
  const N = (corrected(f, 'ref', 'trs') / corrected(f, 'fld', 'trs')) * 0.05335;
  assert.equal(r.trs.kQ, 1);
  near(r.trs.N, N, 1e-12);
  near(r.trs.DperMin, corrected(f, 'ref', 'trs') * 0.05335 / 1, 1e-12, 'мощность дозы по опорной камере, Гр/мин');
  // ур. (16) для непрерывного пучка
  const r16 = computeCrossCal({ ...f, cc_rec_co: 'eq16' });
  const n = 3;
  const ks16 = (who) => (n * n - 1) / (n * n - Math.abs(mean(f[`cc_${who}_M1`])) / Math.abs(mean(f[`cc_${who}_M2`])));
  near(r16.trs.ref.ks, ks16('ref'), 1e-12);
  // k_лаб умножает N_D,w опорной камеры, а значит и результат
  near(computeCrossCal({ ...f, cc_ref_klab: '1,002' }).trs.N / r.trs.N, 1.002, 1e-12);
});

test('⁶⁰Co: перенос во вкладки «⁶⁰Co» и «МВ фотоны»; плоскопараллельная — только в ⁶⁰Co', () => {
  const r = computeCrossCal(SAMPLE_CROSSCAL_CO60);
  const t = crossCalTargets(r);
  assert.deepEqual(t.map((x) => x.target), ['co60', 'photons']);
  assert.equal(t[0].patch.co_ch_model, 'A19');
  assert.equal(t[0].patch.co_lab_pol_applied, true);
  assert.equal(t[1].patch.ch_cal_route, 'co60');
  assert.equal(t[1].patch.ch_klab, '1,000');
  near(num(t[1].patch.ch_ndw) / r.trs.N, 1, 1e-5);
  const pp = crossCalTargets(computeCrossCal({ ...SAMPLE_CROSSCAL_CO60, cc_fld_model: 'PP:ROOS' }));
  assert.deepEqual(pp.map((x) => x.target), ['co60']);
  assert.equal(pp[0].patch.co_ch_model, 'PP:ROOS');
});

test('фотоны, ур. (27): N_D,w,Qcross = (M_ref/M_field)·N_D,w·k_Qcross (табл. 16 или ур. 34)', () => {
  const f = noMon;
  const r = computeCrossCal(f);
  const kq = kQFromTable(findChamber('PTW30013'), 0.67).value;
  near(r.trs.kQ, kq, 1e-15, 'табл. 16');
  near(r.trs.N, (corrected(f, 'ref', 'trs') / corrected(f, 'fld', 'trs')) * 0.05335 * kq, 1e-12);
  const rf = computeCrossCal({ ...f, cc_ref_kqtrs_mode: 'formula' });
  near(rf.trs.kQ, kQtrs(findChamber('PTW30013'), 0.67).value, 1e-15, 'ур. (34)');
  // TPR через PDD(20)/PDD(10): сноска 36
  const rp = computeCrossCal({ ...f, cc_tpr_method: 'pdd2010', cc_pdd20: '38,5', cc_pdd10: '66,8' });
  near(rp.quality.tpr, 1.2661 * (38.5 / 66.8) - 0.0595, 1e-12);
  // k_Qcross рабочей камеры — для справки (нужен в ур. 30)
  near(r.trs.kQcrossField, kQFromTable(findChamber('FC65G'), 0.67).value, 1e-15);
});

test('фотоны, сквозная проверка: в том же пучке рабочая камера на вкладке «МВ фотоны» даёт дозу опорной (k_Q,Qcross = 1)', () => {
  const cc = computeCrossCal(noMon);
  const patch = crossCalTargets(cc)[0].patch;
  assert.equal(patch.ch_cal_route, 'cross');
  const p = computePhotons({
    ...FORM_DEFAULTS,
    ...patch,
    protocol: 'trs',
    setup_geometry: 'SSD',
    qtrs_method: 'ratio',
    qtrs_v20: '0,67',
    qtrs_v10: '1',
    kqtrs_mode: 'table',
    env_T: noMon.cc_T,
    env_P: noMon.cc_P,
    rd_mu: noMon.cc_mu,
    rd_V1: noMon.cc_fld_V1,
    rd_V2: noMon.cc_fld_V2,
    rd_M1: noMon.cc_fld_M1,
    rd_Mopp: noMon.cc_fld_Mopp,
    rd_M2: noMon.cc_fld_M2,
    meta_beam: '6 МВ',
    dd_on: false,
    dd_nominal: '',
  });
  assert.deepEqual(p.messages.filter((m) => m.level === 'error').map((m) => m.text), []);
  near(p.trs.kQ, 1, 1e-12, 'k_Q,Qcross в том же пучке');
  near(p.trs.DperMU / cc.trs.DperMU, 1, 1e-5, 'доза рабочей камерой / опорной');
  // в другом пучке: k_Q,Qcross = k_Q(Q)/k_Q(Q_cross) рабочей камеры (ур. 30)
  const p2 = computePhotons({ ...FORM_DEFAULTS, ...patch, protocol: 'trs', qtrs_method: 'ratio', qtrs_v20: '0,74', qtrs_v10: '1', kqtrs_mode: 'table', env_T: '20', env_P: '101,3', rd_M1: ['10'], rd_Mopp: ['-10'], rd_M2: ['9,99'], meta_beam: '10 МВ' });
  const fc = findChamber('FC65G');
  near(p2.trs.kQ, kQFromTable(fc, 0.74).value / kQFromTable(fc, 0.67).value, 1e-12);
  // TG-51: калибровка рабочей камеры в пучке МВ фотонов не описана — ошибка
  const g = computePhotons({ ...FORM_DEFAULTS, ...patch, protocol: 'tg51' });
  assert.ok(g.messages.some((m) => m.level === 'error' && /TG-51 и его аддендумы не описывают калибровку рабочей камеры/.test(m.text)));
});

test('фотоны: нормировка на внешний монитор — отношение M₁/M_монитор', () => {
  const f = SAMPLE_CROSSCAL_PHOTONS;
  const r = computeCrossCal(f);
  const ratio = (who) => mean(f[`cc_${who}_M1`].map((v, i) => num(v) / num(f[`cc_${who}_Mem`][i])));
  near(r.inputs.ref.monitor.ratio, ratio('ref'), 1e-12);
  // M_ref/M_field (без k_TP, k_pol, k_s) = отношение нормированных показаний
  const corr = (who) => r.trs[who].kTP * r.trs[who].kelec * r.trs[who].kpol * r.trs[who].ks;
  near(r.trs.ratio, (ratio('ref') * corr('ref')) / (ratio('fld') * corr('fld')), 1e-12);
  // не хватает показания монитора — ошибка
  const bad = computeCrossCal({ ...f, cc_ref_Mem: ['5,012', '', '5,011'] });
  assert.equal(bad.flags.cc_ref_Mem, 'error');
});

test('фотоны БВФ: показания обеих камер исправлены на k_vol по ур. (22) со своими длинами полостей', () => {
  const f = { ...noMon, cc_fff: true, cc_sdd: '110', cc_fld_model: 'PTW31010' }; // Semiflex 0,125 см³, L = 6,5 мм
  const r = computeCrossCal(f);
  const kvRef = kvolGeneric({ tpr: 0.67, lengthCm: 2.3, sddCm: 110 });
  const kvFld = kvolGeneric({ tpr: 0.67, lengthCm: 0.65, sddCm: 110 });
  near(r.trs.ref.kvol, kvRef, 1e-15);
  near(r.trs.fld.kvol, kvFld, 1e-15);
  const r0 = computeCrossCal({ ...f, cc_fff: false });
  near(r.trs.N / r0.trs.N, kvRef / kvFld, 1e-12);
  // камеры без длины в базе — нужно ввести
  const g = computeCrossCal({ ...f, cc_fld_model: 'A12' });
  assert.equal(g.flags.cc_fld_length, 'error');
  near(computeCrossCal({ ...f, cc_fld_model: 'A12', cc_fld_length: '21,6' }).trs.fld.kvol, kvolGeneric({ tpr: 0.67, lengthCm: 2.16, sddCm: 110 }), 1e-15);
  // PTW 31010 в пучке с выравнивающим фильтром — предупреждение (включена в TRS-398 только для БВФ)
  assert.ok(computeCrossCal({ ...f, cc_fff: false }).messages.some((m) => m.level === 'warn' && m.text.includes('выравнивающим фильтром')));
});
