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
