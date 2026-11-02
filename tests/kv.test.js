// kV-рентген (TRS-398 Rev.1, разд. 8 и 9): таблицы 28, 29, 32 по источнику, интерполяция сертификата по ln(СПО),
// четыре ветки против ручного произведения множителей, согласованность ветвей N_K и N_D,w (прил. I), k_g,
// Qo = ⁶⁰Co (DIN 6809-4), ошибка таймера, единицы задания и проверки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKv, certValue, equivalentDiameter } from '../src/core/kv.js';
import { kgFromTable, pchFromTable32, interpLog, TRS_TABLE28, TRS_TABLE29, TW_COLUMNS, KG_TABLE_F, TRS_TABLE32 } from '../src/core/kv-tables.js';
import { kvCalculator } from '../src/core/kv-data.js';
import { setLang } from '../src/core/i18n.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const errors = (r) => r.messages.filter((m) => m.level === 'error').map((m) => m.text);
const has = (r, level, re) => r.messages.some((m) => m.level === level && re.test(m.text));
const kTP = (T, P, T0 = 20, P0 = 101.325) => ((273.15 + T) / (273.15 + T0)) * (P0 / P);
const kv = kvCalculator();

// Низкие энергии, N_D,w: PTW 23342 на поверхности ПММА, поверка N_Д × K (ВНИИФТРИ: РИП 30 см, Ø 3 см).
const LOW_NDW = {
  kv_range: 'low', kv_kv: '50', kv_hvl: '1,0', kv_cone: '5', kv_ssd: '30',
  kv_ch_model: 'PTW23342', kv_foil: true, kv_cal: 'ndw', kv_cert_form: 'k', kv_n: '1,250',
  kv_cq_kv: ['30', '50', '70'], kv_cq_hvl: ['0,36', '1,0', '2,9'], kv_cq_val: ['1,000', '1,012', '1,025'],
  kv_lab_f: '3', kv_lab_ssd: '30', kv_env_T: '21', kv_env_P: '100', kv_set_unit: 'min', kv_set: '1',
  kv_timer_mode: 'manual', kv_tau: '0,01', kv_M1: ['2,000', '2,001', '1,999'], kv_Mopp: ['2,004', '2,005', '2,003'],
  kv_phantom: 'pmma', kv_lab_phantom: 'pmma',
};
// Средние энергии, N_K: PTW 30013 в воде на 2 см.
const MED_NK = {
  ...LOW_NDW, kv_range: 'medium', kv_kv: '200', kv_hvl: '1,0', kv_cone: '10', kv_ssd: '50', kv_ch_model: 'PTW30013', kv_foil: false,
  kv_cal: 'nk', kv_cert_form: 'kq', kv_n: '0,045', kv_cq_kv: ['150', '200', '250'], kv_cq_hvl: ['0,5', '1', '2'], kv_cq_val: ['0,995', '1,000', '1,010'],
  kv_lab_f: '', kv_lab_ssd: '', kv_phantom: 'water',
};
const M1 = mean([2, 2.001, 1.999]);
const kpolOf = (m, mo) => (Math.abs(m) + Math.abs(mo)) / (2 * Math.abs(m));
const KPOL = kpolOf(M1, mean([2.004, 2.005, 2.003]));

test('Табл. 28, 29: в узлах — значения таблиц, между столбцами — по ln(СПО), вне таблицы — не предлагается', () => {
  // проверка переноса: строка f = 3 см — единицы, крайние значения таблиц
  for (const t of [TRS_TABLE28, TRS_TABLE29]) {
    assert.equal(t.length, KG_TABLE_F.length);
    t.forEach((row) => assert.equal(row.length, TW_COLUMNS.length));
    assert.deepEqual(t[1], [1, 1, 1, 1, 1, 1, 1]);
  }
  assert.equal(TRS_TABLE28[7][6], 0.91);
  assert.equal(TRS_TABLE29[6][6], 0.9);
  assert.equal(TRS_TABLE29[0][6], 1.04);
  // узлы: TW70 (2,94 мм Al), f = 10 см → 0,93 (табл. 28) и 0,93 (табл. 29); лаборатория 3 см
  near(kgFromTable('T28', { kv: 70, hvl: 2.94 }, 10, 3).value, 0.93, 1e-12);
  near(kgFromTable('T29', { kv: 100, hvl: 4.41 }, 15, 3).value, 0.9, 1e-12);
  near(kgFromTable('T28', { kv: 70, hvl: 2.94 }, 10, 3).byKv, 0.93, 1e-12);
  // середина по ln(СПО) между TW40 и TW50 при f = 15 см: (0,98 + 0,95)/2
  const mid = Math.sqrt(0.741 * 0.94);
  near(kgFromTable('T28', { kv: 45, hvl: mid }, 15, 3).value, (0.98 + 0.95) / 2, 1e-12);
  // поле между строками 10 и 15 см — линейно; поле лаборатории не 3 см — перенормировка T(f_clin)/T(f_lab)
  near(kgFromTable('T28', { kv: 100, hvl: 4.41 }, 12.5, 3).value, (0.93 + 0.92) / 2, 1e-12);
  near(kgFromTable('T28', { kv: 100, hvl: 4.41 }, 20, 10).value, 0.91 / 0.93, 1e-12);
  // вне таблицы: поле 25 см, СПО 6 мм Al
  assert.equal(kgFromTable('T28', { kv: 70, hvl: 2.94 }, 25, 3).inRange.f, false);
  assert.equal(kgFromTable('T28', { kv: 120, hvl: 6 }, 10, 3).inRange.hvl, false);
  assert.ok(Number.isNaN(kgFromTable('T28', { kv: 120, hvl: 6 }, 10, 3).value));
});

test('Табл. 32: p_ch в узлах, между узлами по ln(СПО), за пределами — крайнее значение', () => {
  assert.equal(TRS_TABLE32.hvl.length, 9);
  for (const k of Object.keys(TRS_TABLE32.pch)) assert.equal(TRS_TABLE32.pch[k].length, 9);
  near(pchFromTable32('30013', 0.838).value, 1.016, 1e-12);
  near(pchFromTable32('FC65-G', 0.838).value, 1.018, 1e-12);
  near(pchFromTable32('A12', 0.108).value, 0.99, 1e-12);
  const mid = Math.sqrt(0.477 * 0.838);
  near(pchFromTable32('2571', mid).value, (1.015 + 1.017) / 2, 1e-12);
  assert.deepEqual(pchFromTable32('FC65-P', 5), { value: 0.995, extrapolated: 'above' });
  assert.equal(pchFromTable32('нет такой', 1), null);
});

test('Сертификат: интерполяция по ln(СПО) — в узлах точно, в середине среднее; таблица N даёт ту же дозу, что N_Qo·k_Q', () => {
  const rows = [{ hvl: 0.5, val: 0.99 }, { hvl: 2, val: 1.03 }];
  near(certValue(rows, 0.5).value, 0.99, 1e-12);
  near(certValue(rows, 2).value, 1.03, 1e-12);
  near(certValue(rows, 1).value, 1.01, 1e-12); // ln 1 — середина между ln 0,5 и ln 2
  assert.equal(certValue(rows, 3).extrapolated, 'above');
  assert.equal(interpLog([1], [5], 1).extrapolated, null);
  const kq = computeKv(MED_NK);
  const n = computeKv({ ...MED_NK, kv_cert_form: 'n', kv_n: '', kv_cq_val: ['0,044775', '0,045', '0,04545'] });
  assert.deepEqual(errors(kq), []);
  assert.deepEqual(errors(n), []);
  near(n.trs.D, kq.trs.D, 1e-12 * kq.trs.D);
  // N_Д × K: K заменяет k_Q, N_Q = N_Д · K
  const k = computeKv({ ...MED_NK, kv_cert_form: 'k' });
  near(k.cert.NQ, kq.cert.NQ, 1e-15);
  assert.equal(k.cert.K, 1);
});

test('Низкие энергии, N_D,w (ур. 52): доза = M · k_TP · k_pol · N_Д · K(СПО) · k_g(табл. 28)', () => {
  const r = computeKv(LOW_NDW);
  assert.deepEqual(errors(r), []);
  const K = 1.012; // СПО пучка совпадает со строкой поверки
  const kg = kgFromTable('T28', { kv: 50, hvl: 1 }, 5, 3);
  const D = M1 * kTP(21, 100) * KPOL * 1.25 * K * kg.value;
  near(r.trs.D, D, 1e-12 * D);
  near(r.trs.perUnit, D / 1.01, 1e-12 * D);
  assert.equal(r.trs.kg.source, 'table');
  near(r.trs.kg.value, 0.98 + (0.97 - 0.98) * (Math.log(1 / 0.94) / Math.log(2.94 / 0.94)), 1e-12);
  near(r.trs.kg.byKv, 0.98, 1e-12);
  assert.ok(r.trs.kg.spreadPct > 0 && r.trs.kg.spreadPct < 0.1);
  assert.equal(r.compliance.status, 'standard');
  assert.equal(r.andreo.citation, null); // табл. 28 — без данных Andreo
});

test('Низкие энергии, N_K (ур. 50–51): доза = M · поправки · N_K · k_Q · [μen/ρ]FIA · B_w', () => {
  const r = computeKv({ ...LOW_NDW, kv_cal: 'nk', kv_cert_form: 'kq', kv_n: '1,1', kv_cq_val: ['0,99', '1,00', '1,02'], kv_cone: '10' });
  assert.deepEqual(errors(r), []);
  const D = M1 * kTP(21, 100) * KPOL * 1.1 * 1.0 * kv.muenFIA(1, 'Al').raw * kv.bw(50, 1, 30, 10).raw;
  near(r.trs.D, D, 1e-12 * D);
  assert.equal(r.compliance.status, 'standard');
  assert.match(r.andreo.citation, /Andreo P 2019/);
  // поле не 10 см без поправки N_K на поле — справка и нестандартные условия; с поправкой — по Rev.1
  const small = computeKv({ ...LOW_NDW, kv_cal: 'nk', kv_cert_form: 'kq', kv_n: '1,1', kv_cq_val: ['0,99', '1,00', '1,02'], kv_cone: '5' });
  assert.ok(has(small, 'info', /рис\. 11/));
  assert.equal(small.compliance.status, 'nonstandard');
  const corr = computeKv({ ...LOW_NDW, kv_cal: 'nk', kv_cert_form: 'kq', kv_n: '1,1', kv_cq_val: ['0,99', '1,00', '1,02'], kv_cone: '5', kv_nk_fs: '0,98' });
  assert.equal(corr.compliance.status, 'standard');
  near(corr.trs.D / small.trs.D, 0.98 * (kv.bw(50, 1, 30, 5).raw / kv.bw(50, 1, 30, 5).raw), 1e-12);
});

test('Средние энергии, N_K (ур. 57): доза = M · поправки · N_K · k_Q · [μen/ρ]z=2 · p_ch(табл. 32); пересчёт на поверхность по PDD', () => {
  const r = computeKv({ ...MED_NK, kv_pdd2: '90' });
  assert.deepEqual(errors(r), []);
  const pch = pchFromTable32('30013', 1).value;
  const D = M1 * kTP(21, 100) * KPOL * 0.045 * 1.0 * kv.muenZ2(200, 1, 50, 10).raw * pch;
  near(r.trs.D, D, 1e-12 * D);
  near(r.trs.Dsurf, (D * 100) / 90, 1e-12 * D);
  assert.equal(r.trs.phys.pchSource, 'table32');
  assert.equal(r.compliance.status, 'standard');
  // PDD с ошибкой не блокирует дозу на 2 см
  const bad = computeKv({ ...MED_NK, kv_pdd2: '0,9' });
  assert.equal(bad.trs.blocked, false);
  near(bad.trs.D, D, 1e-12 * D);
  assert.equal(bad.trs.Dsurf, undefined);
  assert.ok(bad.messages.some((m) => m.level === 'error' && m.scope === 'depth'));
});

test('Средние энергии, N_D,w (ур. 58): k_g по ур. (90) = отношение [μen/ρ]z=2 клиника/лаборатория', () => {
  const r = computeKv({ ...MED_NK, kv_cal: 'ndw', kv_n: '0,05', kv_lab_f: '10', kv_lab_ssd: '100', kv_cone: '5' });
  assert.deepEqual(errors(r), []);
  const kg = kv.kgMuenZ2(200, 1, { ssd: 100, f: 10 }, { ssd: 50, f: 5 });
  near(r.trs.kg.value, kg.value, 5e-5);
  assert.equal(r.trs.kg.source, 'eq90');
  const D = M1 * kTP(21, 100) * KPOL * 0.05 * r.trs.kg.value;
  near(r.trs.D, D, 1e-12 * D);
  // поле и РИП как в лаборатории — k_g = 1
  const same = computeKv({ ...MED_NK, kv_cal: 'ndw', kv_n: '0,05', kv_lab_f: '10', kv_lab_ssd: '50' });
  assert.equal(same.trs.kg.value, 1);
  assert.equal(same.trs.kg.source, 'same');
});

test('Приложение I: N_D,w, полученный из N_K через те же данные, даёт ту же дозу, что ветка N_K', () => {
  // средние энергии: N_D,w(лаб.) = N_K · [μen/ρ]z=2(лаб.) · p_ch; k_g по ур. (90) переносит на поле клиники
  const lab = { f: 10, ssd: 100 };
  const pch = pchFromTable32('30013', 1).value;
  const nk = computeKv({ ...MED_NK, kv_cone: '5', kv_cq_kv: ['200'], kv_cq_hvl: ['1'], kv_cq_val: ['1'] });
  const ndwLab = 0.045 * kv.muenZ2(200, 1, lab.ssd, lab.f).raw * pch;
  const ndw = computeKv({ ...MED_NK, kv_cone: '5', kv_cal: 'ndw', kv_cert_form: 'n', kv_n_unit: 'Gy/nC', kv_cq_kv: ['200'], kv_cq_hvl: ['1'], kv_cq_val: [String(ndwLab)], kv_lab_f: '10', kv_lab_ssd: '100' });
  assert.deepEqual(errors(nk), []);
  assert.deepEqual(errors(ndw), []);
  near(ndw.trs.D, nk.trs.D, 1e-9 * nk.trs.D);
  // низкие энергии: N_D,w^PMMA(лаб.) = N_K · [μen/ρ]FIA · B_w(лаб.), k_g по ур. (85) с отношением N_K^PMMA = 1
  const lowNk = computeKv({ ...LOW_NDW, kv_cal: 'nk', kv_cert_form: 'kq', kv_n: '1,1', kv_cq_kv: ['50'], kv_cq_hvl: ['1'], kv_cq_val: ['1'], kv_cone: '10' });
  const ndwLow = 1.1 * kv.muenFIA(1, 'Al').raw * kv.bw(50, 1, 30, 3).raw;
  const lowNdw = computeKv({ ...LOW_NDW, kv_cone: '10', kv_cert_form: 'n', kv_cq_kv: ['50'], kv_cq_hvl: ['1'], kv_cq_val: [String(ndwLow)], kv_kg_src: 'eq85', kv_kg_nk: '1' });
  assert.deepEqual(errors(lowNk), []);
  assert.deepEqual(errors(lowNdw), []);
  assert.equal(lowNdw.trs.kg.source, 'eq85');
  near(lowNdw.trs.D, lowNk.trs.D, 1e-9 * lowNk.trs.D);
});

test('k_g для низких энергий: значение лаборатории, ур. (85), k_g = 1 «как DIN» — не по Rev.1, без источника — ошибка', () => {
  const lab = computeKv({ ...LOW_NDW, kv_kg_src: 'lab', kv_kg_lab: '0,985' });
  assert.equal(lab.trs.kg.value, 0.985);
  assert.equal(lab.compliance.status, 'standard');
  const eq85 = computeKv({ ...LOW_NDW, kv_kg_src: 'eq85', kv_kg_nk: '1,01' });
  near(eq85.trs.kg.value, 1.01 * (kv.bw(50, 1, 30, 5).raw / kv.bw(50, 1, 30, 3).raw), 1e-12);
  assert.match(eq85.andreo.citation, /Andreo/);
  const one = computeKv({ ...LOW_NDW, kv_kg_src: 'one' });
  assert.equal(one.trs.kg.value, 1);
  assert.equal(one.compliance.status, 'nonstandard');
  assert.ok(one.notRev1.length === 1);
  assert.ok(has(one, 'warn', /DIN 6809-4 и SSRMP/));
  // своя камера без табл. 28–29: k_g взять неоткуда — итога по Rev.1 нет
  const custom = computeKv({ ...LOW_NDW, kv_ch_model: 'CUSTOM', kv_cc_type: 'pp', kv_cc_model: 'X' });
  assert.ok(errors(custom).some((t) => /k_g взять неоткуда/.test(t)));
  assert.equal(custom.trs.blocked, true);
  // поле вне табл. 28 (25 см)
  const big = computeKv({ ...LOW_NDW, kv_cone: '25' });
  assert.ok(errors(big).some((t) => /2–20 см/.test(t)));
  // то же поле и РИП, что в лаборатории, — k_g = 1 без таблиц
  const same = computeKv({ ...LOW_NDW, kv_ch_model: 'CUSTOM', kv_cc_type: 'pp', kv_cone: '3' });
  assert.deepEqual(errors(same), []);
  assert.equal(same.trs.kg.source, 'same');
  // сертификат PTW (РИП 50 см) и клиника 30 см при том же поле: табл. 28 даёт 1, справка про РИП
  const ptw = computeKv({ ...LOW_NDW, kv_cone: '3', kv_lab_ssd: '50' });
  near(ptw.trs.kg.value, 1, 1e-12);
  assert.ok(has(ptw, 'info', /обычных клинических РИП/));
});

test('Qo = ⁶⁰Co (DIN 6809-4): та же доза, что при эквивалентном kV-Qo, пометка «нестандартные условия»; без k_Q,M — ошибка', () => {
  const base = { ...MED_NK, kv_cal: 'ndw', kv_lab_f: '10', kv_lab_ssd: '50' };
  const kvQo = computeKv({ ...base, kv_n: '0,053', kv_cq_val: ['0,99', '1', '1,01'] });
  const co = computeKv({ ...base, kv_qo: 'co60', kv_n: '0,05', kv_cq_val: ['1,0494', '1,06', '1,0706'] });
  assert.deepEqual(errors(co), []);
  near(co.trs.D, kvQo.trs.D, 1e-9 * kvQo.trs.D);
  assert.equal(co.cert.kz, 1);
  assert.equal(co.compliance.status, 'nonstandard');
  assert.equal(kvQo.compliance.status, 'standard');
  assert.ok(has(co, 'warn', /DIN 6809-4/));
  // сертификат только с ⁶⁰Co (как у PTW 30013): ошибка
  const only = computeKv({ ...base, kv_qo: 'co60', kv_n: '0,05', kv_cq_kv: [''], kv_cq_hvl: [''], kv_cq_val: [''] });
  assert.ok(errors(only).some((t) => /только с ⁶⁰Co/.test(t)));
  assert.equal(only.trs.blocked, true);
  const nForm = computeKv({ ...base, kv_qo: 'co60', kv_cert_form: 'n' });
  assert.ok(errors(nForm).some((t) => /k_Q,M/.test(t)));
});

test('Задание облучения: τ по серии и по n облучениям; Гр/Гр, Гр/мин (из секунд), сГр/МЕ', () => {
  const D0 = computeKv({ ...MED_NK, kv_timer_mode: 'none' }).trs.D;
  // серия: M = a·(X + τ), τ = 0,02 мин
  const ser = computeKv({ ...MED_NK, kv_timer_mode: 'measured', kv_tt: ['0,5', '1', '2'], kv_tm: ['0,52', '1,02', '2,02'] });
  near(ser.timer.tau, 0.02, 1e-12);
  near(ser.trs.perUnit, D0 / 1.02, 1e-12);
  // одно облучение X против n облучений по X/n (рабочая запись)
  const nexp = computeKv({ ...MED_NK, kv_timer_mode: 'nexp', kv_nx_t: '1', kv_nx_n: '5', kv_nx_M1: ['1,02'], kv_nx_Mn: ['1,10'] });
  near(nexp.timer.tau, (1 * (1.1 - 1.02)) / (5 * 1.02 - 1.1), 1e-12);
  // секунды: итог в Гр/мин
  const sec = computeKv({ ...MED_NK, kv_set_unit: 's', kv_set: '60', kv_timer_mode: 'none' });
  near(sec.trs.perUnit, D0, 1e-12);
  assert.equal(sec.trs.rateLabel, 'Гр/мин');
  // МЕ: сГр/МЕ
  const mu = computeKv({ ...MED_NK, kv_set_unit: 'MU', kv_set: '200', kv_timer_mode: 'manual', kv_tau: '0,5' });
  near(mu.trs.perUnit, (D0 * 100) / 200.5, 1e-12);
  assert.equal(mu.trs.rateLabel, 'сГр/МЕ');
  // Гр: отношение измеренной дозы к заданной
  const gy = computeKv({ ...MED_NK, kv_set_unit: 'Gy', kv_set: '0,1', kv_timer_mode: 'none' });
  near(gy.trs.perUnit, D0 / 0.1, 1e-12);
  // накопление на интервале — только для времени
  const win = computeKv({ ...MED_NK, kv_set_unit: 'MU', kv_set: '200', kv_timer_mode: 'window' });
  assert.ok(errors(win).some((t) => /только при задании облучения по времени/.test(t)));
});

test('Проверки: недостижимый СПО, тип камеры, экстраполяция сертификата, одно качество, полярность, k_s', () => {
  // 50 кВ и 8 мм Al: больше СПО моноэнергетических фотонов 50 кэВ — ошибка
  const unphys = computeKv({ ...LOW_NDW, kv_hvl: '8' });
  assert.ok(errors(unphys).some((t) => /недостижим/.test(t)));
  assert.equal(unphys.trs.blocked, true);
  // СПО в мм Al вместо мм Cu (типичная путаница единиц): 200 кВ и 12 «мм Cu» (≈ 1 мм Cu = 12 мм Al)
  assert.ok(errors(computeKv({ ...MED_NK, kv_hvl: '12' })).some((t) => /мм Al или мм Cu/.test(t)));
  // плоскопараллельная камера в средних энергиях — предупреждение и нестандартные условия
  const pp = computeKv({ ...MED_NK, kv_ch_model: 'PTW23342', kv_pch: '1,0' });
  assert.ok(has(pp, 'warn', /только цилиндрические/));
  assert.equal(pp.compliance.status, 'nonstandard');
  // камера не из табл. 32 — p_ch вручную, предупреждение, не по Rev.1
  const own = computeKv({ ...MED_NK, kv_ch_model: 'CUSTOM', kv_cc_type: 'cyl', kv_cc_model: 'Y', kv_pch: '1,01' });
  assert.deepEqual(errors(own), []);
  assert.equal(own.trs.phys.pch, 1.01);
  assert.ok(has(own, 'warn', /нет в табл\. 32/));
  assert.equal(own.compliance.status, 'nonstandard');
  // СПО пучка вне таблицы сертификата — экстраполяция с предупреждением
  const ext = computeKv({ ...MED_NK, kv_hvl: '3' });
  assert.ok(has(ext, 'warn', /экстраполирован по ln\(СПО\)/));
  near(ext.cert.value, 1.01 + ((1.01 - 1.0) * Math.log(3 / 2)) / Math.log(2), 1e-12);
  // одно качество, не совпадающее с пучком, — ошибка
  const one = computeKv({ ...MED_NK, kv_cq_kv: ['150'], kv_cq_hvl: ['0,5'], kv_cq_val: ['1'] });
  assert.ok(errors(one).some((t) => /одно качество/.test(t)));
  // повтор СПО и пустая таблица
  assert.ok(errors(computeKv({ ...MED_NK, kv_cq_hvl: ['1', '1', '2'] })).some((t) => /повторяется/.test(t)));
  assert.ok(errors(computeKv({ ...MED_NK, kv_cq_kv: [''], kv_cq_hvl: [''], kv_cq_val: [''] })).some((t) => /общий k_Q по типу камеры/.test(t)));
  // без обратной полярности — k_pol = 1 с предупреждением; полярность в условиях «не проверено»
  const nopol = computeKv({ ...MED_NK, kv_Mopp: ['', '', ''] });
  assert.equal(nopol.trs.kpol, 1);
  assert.ok(has(nopol, 'warn', /k_pol принят равным 1/));
  assert.equal(nopol.compliance.unchecked.length, 1);
  // метод двух напряжений по флажку: ур. (13), табл. 10
  const ks = computeKv({ ...MED_NK, kv_ks_on: true, kv_V2: '100', kv_M2: ['1,996', '1,997', '1,995'] });
  assert.deepEqual(errors(ks), []);
  assert.ok(ks.trs.ks > 1 && ks.trs.ks < 1.01);
  // тип камеры для воздушного метода ниже 70 кВ
  assert.ok(has(computeKv({ ...LOW_NDW, kv_cal: 'nk', kv_ch_model: 'PTW30013', kv_cert_form: 'kq', kv_n: '0,045', kv_cone: '5' }), 'warn', /только при 70 кВ и выше/));
  // фольга выше 40 кВ у плоскопараллельной камеры
  assert.ok(has(computeKv({ ...LOW_NDW, kv_foil: false }), 'info', /фольгу 0,2 мм/));
  // поле средних энергий не 10 см: нестандартно, но «самый большой тубус» — по табл. 31
  assert.equal(computeKv({ ...MED_NK, kv_cone: '5' }).compliance.status, 'nonstandard');
  assert.equal(computeKv({ ...MED_NK, kv_cone: '5', kv_cone_largest: true }).compliance.status, 'standard');
});

test('Квадратный тубус → круг равной площади; сообщения по-английски', () => {
  near(equivalentDiameter('square', 10), 20 / Math.sqrt(Math.PI), 1e-12);
  assert.equal(equivalentDiameter('circle', 10), 10);
  const sq = computeKv({ ...MED_NK, kv_cone_shape: 'square', kv_cone: '10' });
  near(sq.inputs.fClin, 11.2838, 1e-4);
  setLang('en');
  try {
    const r = computeKv({ ...LOW_NDW, kv_hvl: '8' });
    assert.ok(r.messages.every((m) => !/[А-Яа-яЁё]/.test(m.text)), r.messages.map((m) => m.text).join('\n'));
  } finally {
    setLang('ru');
  }
});
