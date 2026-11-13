// kV-рентген, раздел 5 «k_pol и k_s» (0.59.0): серии режима при +V₁, −V₁ и V₂ с одним аппликатором — как в рабочих
// книгах (k_pol по ур. (11), k_s по ур. (13) с табл. 10, TRS-398 Rev.1 разд. 4.4.3.3, 4.4.3.4 b); тонкооконные камеры
// до 100 кВ — k_pol = k_s = 1 без серий (разд. 4.4.3.3 а); k_s < 1 в пределах разброса — 1; перенос серий из строк
// файлов до 0.59.0 (migrateKvPk) не меняет итог. Показания вымышленные.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKv } from '../src/core/kv.js';
import { normalizeKvSession, computeKvSession, normalizeKvVisit, computeKvVisit, migrateKvPk } from '../src/core/kv-session.js';
import { SAMPLE_KV, SAMPLE_KV_ROWS } from '../src/core/sample-kv.js';
import { setLang } from '../src/core/i18n.js';

setLang('ru');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const errors = (r) => r.messages.filter((m) => m.level === 'error').map((m) => m.text);
const has = (r, level, re) => r.messages.some((m) => m.level === level && re.test(m.text));
const E3 = ['', '', ''];

// Низкие энергии: PTW 23342 (тонкое окно), 50 кВ.
const LOW = {
  kv_range: 'low', kv_kv: '50', kv_hvl: '1,0', kv_cone: '5', kv_ssd: '30',
  kv_ch_model: 'PTW23342', kv_foil: true, kv_cal: 'ndw', kv_cert_form: 'k', kv_n: '1,250',
  kv_cq_kv: ['30', '50', '70'], kv_cq_hvl: ['0,36', '1,0', '2,9'], kv_cq_val: ['1,000', '1,012', '1,025'],
  kv_lab_f: '3', kv_lab_ssd: '30', kv_env_T: '21', kv_env_P: '100', kv_set_unit: 'min', kv_set: '1',
  kv_timer_mode: 'manual', kv_tau: '0,01', kv_M1: ['2,000', '2,001', '1,999'],
  kv_phantom: 'pmma', kv_lab_phantom: 'pmma', kv_V1: '300', kv_V2: '150',
};
// Средние энергии: фармеровская PTW 30013 в воде, 120 кВ; серии +400 / −400 / +200 В — как в рабочей книге.
const FARMER = {
  ...LOW, kv_range: 'medium', kv_kv: '120', kv_hvl: '0,25', kv_cone: '10', kv_ssd: '50', kv_ch_model: 'PTW30013', kv_foil: false,
  kv_cal: 'nk', kv_cert_form: 'kq', kv_n: '0,0450', kv_cq_kv: ['100', '150', '200'], kv_cq_hvl: ['0,15', '0,5', '1'], kv_cq_val: ['0,995', '1,000', '1,005'],
  kv_lab_f: '', kv_lab_ssd: '', kv_phantom: 'water', kv_V1: '400', kv_V2: '200', kv_ks_on: true,
  kv_M1: ['10,20', '10,21', '10,20'],
  kv_pk_app: 'Ø 10 см', kv_pk_M: ['10,000', '10,002', '10,001'], kv_pk_Mopp: ['-10,090', '-10,092', '-10,091'], kv_pk_M2: ['9,990', '9,991', '9,990'],
};

test('тонкооконная камера до 100 кВ: k_pol = k_s = 1 без серий; флажок «измерить» — по сериям', () => {
  // серии введены, но не используются
  const r = computeKv({ ...LOW, kv_pk_M: ['2,000', '2,001', '1,999'], kv_pk_Mopp: ['-2,010', '-2,011', '-2,009'], kv_ks_on: true, kv_pk_M2: ['1,990', '1,991', '1,990'] });
  assert.deepEqual(errors(r), []);
  assert.equal(r.trs.pkThin, true);
  assert.equal(r.trs.kpol, 1);
  assert.equal(r.trs.ks, 1);
  assert.ok(has(r, 'info', /k_pol = 1 и k_s = 1 не измеряются: у тонкооконной плоскопараллельной камеры .* 4\.4\.3\.3 а\)/));
  assert.ok(!has(r, 'warn', /обратной полярности не введены/));
  // флажок — серии считаются как у любой камеры
  const m = computeKv({ ...LOW, kv_pk_measure: true, kv_pk_M: ['2,000', '2,001', '1,999'], kv_pk_Mopp: ['-2,010', '-2,011', '-2,009'] });
  assert.equal(m.trs.pkThin, false);
  near(m.trs.kpolRaw, (2 + 2.01) / (2 * 2), 1e-12);
  // выше 100 кВ (или не тонкое окно) — измеряются
  assert.equal(computeKv({ ...FARMER }).trs.pkThin, false);
  assert.equal(computeKv({ ...FARMER, kv_ch_model: 'PTW23342', kv_kv: '120' }).trs.thinWindow, false);
});

test('фармеровская камера: k_pol и k_s — по сериям раздела 5 (своя серия при +V₁), а не по показанию строки', () => {
  const r = computeKv(FARMER);
  assert.deepEqual(errors(r), []);
  assert.equal(r.trs.pkSeries, true);
  const Mp = mean([10, 10.002, 10.001]);
  const Mm = mean([10.09, 10.092, 10.091]);
  const M2 = mean([9.99, 9.991, 9.99]);
  // ур. (11)
  near(r.trs.kpolRaw, (Mp + Mm) / (2 * Mp), 1e-12);
  // ур. (13), табл. 10 (импульсный пучок, V₁/V₂ = 2): a₀ = 2,337, a₁ = −3,636, a₂ = 2,299
  const q = Mp / M2;
  near(r.trs.ksRaw, 2.337 - 3.636 * q + 2.299 * q * q, 1e-9);
  assert.ok(r.trs.ksRaw > 1 && r.trs.ksRaw < 1.002);
  // итог по строке: показание строки × k_pol × k_s
  near(r.inputs.Mref.mean, Mp, 1e-12);
  // показание строки не влияет на k_pol и k_s
  const other = computeKv({ ...FARMER, kv_M1: ['11,00', '11,01', '11,00'] });
  assert.equal(other.trs.kpolRaw, r.trs.kpolRaw);
  assert.equal(other.trs.ksRaw, r.trs.ksRaw);
});

test('k_s < 1 в пределах разброса показаний — 1 с пометкой; больше разброса — ошибка «перемерить»', () => {
  // M(V₂) больше M(V₁) на 0,02 % при разбросе серий 0,1 % — шум
  const noise = computeKv({ ...FARMER, kv_pk_M2: ['10,003', '10,003', '10,003'] });
  assert.deepEqual(errors(noise), []);
  assert.equal(noise.trs.ks, 1);
  assert.ok(noise.trs.ksNoise && noise.trs.ksNoise.raw < 1);
  assert.ok(has(noise, 'info', /в пределах разброса показаний/));
  // на 1 % больше — ошибка
  const bad = computeKv({ ...FARMER, kv_pk_M2: ['10,10', '10,10', '10,10'] });
  assert.ok(errors(bad).some((t) => /k_s нужно перемерить/.test(t)));
});

test('режим: все строки берут k_pol и k_s из серий раздела 5; старый файл с серией в строке переносится без изменения итога', () => {
  // файл до 0.59.0: серия при обратной полярности — в строке 1
  const legacy = { ...SAMPLE_KV, kv_pk_app: '', kv_pk_M: E3, kv_pk_Mopp: E3, kv_Mopp: ['-21,93', '-21,94', '-21,93'] };
  const before = computeKvSession(normalizeKvSession({ form: legacy, rows: [legacy, ...SAMPLE_KV_ROWS], active: 0 }));
  const v = normalizeKvVisit({ form: legacy, rows: [legacy, ...SAMPLE_KV_ROWS], active: 0 });
  const sh = v.modes[0].shared;
  assert.deepEqual(sh.kv_pk_Mopp, ['-21,93', '-21,94', '-21,93']);
  assert.deepEqual(sh.kv_pk_M, legacy.kv_M1);
  assert.match(sh.kv_pk_app, /Ø 10 см/);
  assert.deepEqual(v.modes[0].rows[0].kv_Mopp, E3);
  const after = computeKvVisit(v).modes[0];
  after.results.forEach((x, i) => {
    near(x.trs.perUnit, before.results[i].trs.perUnit, 1e-12, `строка ${i + 1}`);
    assert.equal(x.trs.pkSeries, true);
    assert.equal(x.trs.kpolFrom, null);
  });
  // повторная нормализация ничего не меняет
  assert.deepEqual(migrateKvPk(JSON.parse(JSON.stringify(v))), JSON.parse(JSON.stringify(v)));
  // серии k_pol и k_s в разных строках — не переносятся (каждая строка считает по своим)
  const two = normalizeKvVisit({ form: legacy, rows: [legacy, { ...SAMPLE_KV_ROWS[0], kv_M2: ['20,50', '20,51', '20,50'] }], active: 0 });
  assert.deepEqual(two.modes[0].shared.kv_pk_Mopp, E3);
  assert.deepEqual(two.modes[0].rows[0].kv_Mopp, ['-21,93', '-21,94', '-21,93']);
});
