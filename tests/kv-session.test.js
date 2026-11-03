// kV-рентген: строки аппликаторов одного пучка (раздел 4 вкладки). Деление формы на общие поля и поля строки,
// старые файлы и черновики (плоская форма) — одна строка, каждая строка считается как отдельный расчёт со своими T, P,
// показаниями и тубусом, k_pol и k_s строк без своих серий — из первой строки с серией (ошибки источника не передаются).
// Режимы аппарата (0.37.0): несколько режимов и камер; режим без своих серий берёт k_pol и k_s из ближайшего по СПО режима с той
// же камерой, τ — из ближайшего по напряжению режима, где она измерена.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKv, KV_DEFAULTS, normalizeKv } from '../src/core/kv.js';
import {
  KV_ROW_KEYS, emptyKvRow, splitKvForm, kvRowForm, normalizeKvSession, kvRowLabel, computeKvSession, kvRowEmpty,
  KV_COMMON_KEYS, KV_CHAMBER_KEYS, KV_MODE_KEYS, splitKvVisitForm, normalizeKvVisit, kvVisitRowForm, computeKvVisit, newKvMode, newKvChamber, kvModeLabel,
} from '../src/core/kv-session.js';
import { SAMPLE_KV, SAMPLE_KV_ROWS, SAMPLE_KV_MODE2 } from '../src/core/sample-kv.js';
import { setLang } from '../src/core/i18n.js';

setLang('ru');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const has = (r, level, re) => r.messages.some((m) => m.level === level && re.test(m.text));
const sample = () => normalizeKvSession({ form: SAMPLE_KV, rows: [SAMPLE_KV, ...SAMPLE_KV_ROWS], active: 0 });

test('деление формы: поля строки и общие поля не пересекаются и вместе дают всю форму', () => {
  const { shared, row } = splitKvForm(SAMPLE_KV);
  assert.deepEqual(Object.keys(row).sort(), [...KV_ROW_KEYS].sort());
  for (const k of KV_ROW_KEYS) assert.ok(!(k in shared), k);
  assert.deepEqual(normalizeKv({ ...shared, ...row }), normalizeKv(SAMPLE_KV));
  // служебные поля и мусор из файла в общие поля не попадают
  const s = splitKvForm({ ...SAMPLE_KV, kv_pol_from: 'строки 9', kv_kpol_fix: 2, junk: 1 });
  for (const k of ['kv_pol_from', 'kv_kpol_fix', 'junk']) assert.ok(!(k in s.shared), k);
  for (const k of Object.keys(s.shared)) assert.ok(k in KV_DEFAULTS, k);
});

test('старый файл или черновик (плоская форма) — одна строка с тем же итогом', () => {
  const sess = normalizeKvSession(SAMPLE_KV);
  assert.equal(sess.rows.length, 1);
  assert.equal(sess.active, 0);
  const all = computeKvSession(sess);
  assert.equal(all.results[0].trs.ctrl.perUnit, computeKv(SAMPLE_KV).trs.ctrl.perUnit);
  near(all.results[0].trs.ctrl.perUnit, 1.0012, 5e-5);
  // файл 0.35 { form } — тоже одна строка
  assert.equal(normalizeKvSession({ app: 'reference-dosimetry', module: 'kv', version: 1, form: SAMPLE_KV }).rows.length, 1);
  // пусто — одна пустая строка
  const empty = normalizeKvSession(null);
  assert.equal(empty.rows.length, 1);
  assert.ok(kvRowEmpty(empty.rows[0]));
});

test('файл со строками: выбранная строка из плоской формы, номер строки ограничен', () => {
  const sess = sample();
  assert.equal(sess.rows.length, 3);
  assert.equal(sess.rows[1].kv_cone_shape, 'rect');
  assert.equal(sess.rows[1].kv_env_T, '21,4');
  // общие поля у всех строк одни: камера, сертификат, пучок
  for (let i = 0; i < 3; i++) assert.equal(kvRowForm(sess, i).kv_ch_model, 'PTW30013');
  const again = normalizeKvSession({ form: kvRowForm(sess, 2), rows: sess.rows, active: 2 });
  assert.equal(again.active, 2);
  assert.deepEqual(again.rows, sess.rows);
  assert.equal(normalizeKvSession({ form: SAMPLE_KV, rows: sess.rows, active: 7 }).active, 0);
  // плоская форма точнее строк: при расхождении берётся она
  const diverged = normalizeKvSession({ form: { ...SAMPLE_KV, kv_env_T: '24,0' }, rows: sess.rows, active: 0 });
  assert.equal(diverged.rows[0].kv_env_T, '24,0');
});

test('каждая строка считается со своими T, P, тубусом и показаниями', () => {
  const sess = sample();
  const all = computeKvSession(sess);
  for (let i = 0; i < 3; i++) {
    const f = kvRowForm(sess, i);
    const T = Number(f.kv_env_T.replace(',', '.'));
    const P = Number(f.kv_env_P.replace(',', '.'));
    near(all.results[i].trs.kTP, ((273.15 + T) / 293.15) * (101.325 / P), 1e-9, `строка ${i + 1}`);
  }
  // тубус 6 × 8 см — круг той же площади: d = 2√(ab/π)
  near(all.results[1].inputs.fClin, 2 * Math.sqrt(48 / Math.PI), 1e-9);
  near(all.results[2].inputs.fClin, 15, 1e-12);
  // демонстрационные строки 2 и 3: в допуске, около +0,5 %
  near(all.results[1].trs.perUnit, 0.9425, 5e-5);
  near(all.results[2].trs.perUnit, 1.0475, 5e-5);
  for (const r of all.results) assert.equal(r.messages.filter((m) => m.level === 'error').length, 0);
});

test('k_pol строк без серии при обратной полярности — из первой строки с серией', () => {
  const sess = sample();
  const all = computeKvSession(sess);
  assert.equal(all.polSrc, 0);
  assert.equal(all.ksSrc, -1);
  const k1 = all.results[0].trs.kpolRaw;
  for (const i of [1, 2]) {
    assert.equal(all.results[i].trs.kpolRaw, k1);
    assert.match(all.results[i].trs.kpolFrom, /^строки 1 \(Ø 10 см\)$/);
    assert.ok(has(all.results[i], 'info', /k_pol = 0,9995 взят из строки 1 \(Ø 10 см\)/));
    assert.ok(!has(all.results[i], 'warn', /обратной полярности не введены/));
  }
  // строка со своей серией считает свой k_pol
  sess.rows[2].kv_Mopp = ['-22,96', '-22,97', '-22,96'];
  const own = computeKvSession(sess);
  assert.equal(own.results[2].trs.kpolFrom, null);
  assert.notEqual(own.results[2].trs.kpolRaw, k1);
  // ни в одной строке нет серии — k_pol = 1 с предупреждением, как раньше
  for (const r of sess.rows) r.kv_Mopp = ['', '', ''];
  const none = computeKvSession(sess);
  assert.equal(none.polSrc, -1);
  for (const r of none.results) assert.ok(has(r, 'warn', /обратной полярности не введены: k_pol принят равным 1/));
});

test('источник k_pol с ошибкой: значение не передаётся, у зависимых строк — ошибка', () => {
  const sess = sample();
  sess.rows[0].kv_Mopp = ['21,93', '-21,94', '-21,93'];
  const all = computeKvSession(sess);
  assert.equal(all.results[0].flags.kv_Mopp, 'error');
  for (const i of [1, 2]) {
    assert.ok(has(all.results[i], 'error', /k_pol из строки 1 \(Ø 10 см\) не вычислен/), `строка ${i + 1}`);
    assert.ok(all.results[i].trs.blocked);
  }
});

test('k_s строк без серии при V₂ — из первой строки с серией (только при включённой рекомбинации)', () => {
  const sess = sample();
  sess.shared.kv_ks_on = true;
  sess.shared.kv_V2 = '100';
  sess.rows[1].kv_M2 = ['20,55', '20,56', '20,55'];
  const all = computeKvSession(sess);
  assert.equal(all.ksSrc, 1);
  const ks = all.results[1].trs.ksRaw;
  assert.ok(ks > 1 && ks < 1.01, String(ks));
  for (const i of [0, 2]) {
    assert.equal(all.results[i].trs.ksRaw, ks);
    assert.match(all.results[i].trs.ksFrom, /строки 2 \(6 × 8 см\)/);
    assert.ok(has(all.results[i], 'info', /k_s = \d,\d{4} взят из строки 2/));
  }
  // рекомбинация выключена — серии V₂ не используются
  sess.shared.kv_ks_on = false;
  const off = computeKvSession(sess);
  assert.equal(off.ksSrc, -1);
  for (const r of off.results) assert.equal(r.trs.ks, 1);
});

test('новая строка: форма тубуса, РИП, задание, T, P и влажность — из предыдущей; размер и показания пустые', () => {
  const sess = sample();
  const row = emptyKvRow(sess.rows[1]);
  assert.equal(row.kv_cone_shape, 'rect');
  assert.equal(row.kv_ssd, '50');
  assert.equal(row.kv_env_T, '21,4');
  assert.equal(row.kv_cone, '');
  assert.deepEqual(row.kv_M1, KV_DEFAULTS.kv_M1);
  assert.ok(kvRowEmpty(row));
  // массив показаний — копия, а не общая ссылка
  row.kv_M1[0] = '1';
  assert.notEqual(KV_DEFAULTS.kv_M1[0], '1');
});

test('подпись строки: круглый, квадратный и прямоугольный тубус', () => {
  assert.equal(kvRowLabel({ kv_cone_shape: 'circle', kv_cone: '6' }), 'Ø 6 см');
  assert.equal(kvRowLabel({ kv_cone_shape: 'square', kv_cone: '10' }), '10 × 10 см');
  assert.equal(kvRowLabel({ kv_cone_shape: 'rect', kv_cone: '4', kv_cone_b: '15' }), '4 × 15 см');
  assert.equal(kvRowLabel({ kv_cone_shape: 'circle', kv_cone: ' ' }), '');
  setLang('en');
  assert.equal(kvRowLabel({ kv_cone_shape: 'circle', kv_cone: '6' }), 'Ø 6 cm');
  setLang('ru');
});

test('стандартный тубус: средние энергии — по табл. 31 (сопоставимый с 10 см, из нескольких — с наибольшим РИП)', () => {
  const sess = sample();
  const all = computeKvSession(sess);
  // Ø 10 см — стандартный; 6 × 8 и Ø 15 см отличаются только полем — нестандартные условия, разд. 9.5
  assert.equal(all.stdRow, 0);
  assert.deepEqual(all.nonRef, [false, true, true]);
  assert.deepEqual(all.results.map((r) => r.compliance.status), ['standard', 'nonstandard', 'nonstandard']);
  // 8 × 10 см (круг Ø 10,09 см) на РИП 60 см — тоже сопоставимый, РИП больше: стандартный он (сноска b)
  sess.rows.push({ ...sess.rows[0], kv_cone_shape: 'rect', kv_cone: '8', kv_cone_b: '10', kv_ssd: '60' });
  const b = computeKvSession(sess);
  assert.equal(b.stdRow, 3);
  assert.deepEqual(b.nonRef, [false, true, true, false]);
  // сопоставимого тубуса нет — стандартного нет, отступления остаются отступлениями
  const small = normalizeKvSession({ form: { ...SAMPLE_KV, ...SAMPLE_KV_ROWS[0] }, rows: [SAMPLE_KV_ROWS[0], SAMPLE_KV_ROWS[1]], active: 0 });
  const c = computeKvSession(small);
  assert.equal(c.stdRow, -1);
  assert.deepEqual(c.nonRef, [false, false]);
  // «самый большой тубус аппарата» (круглый) — стандартный
  small.rows[1].kv_cone_largest = true;
  assert.equal(computeKvSession(small).stdRow, 1);
  // пустая строка не бывает стандартной и не помечается
  const e = normalizeKvSession({ form: SAMPLE_KV, rows: [emptyKvRow(SAMPLE_KV), SAMPLE_KV], active: 1 });
  const ea = computeKvSession(e);
  assert.equal(ea.stdRow, 1);
  assert.deepEqual(ea.nonRef, [false, false]);
});

test('стандартный тубус: низкие энергии N_D,w — поле и РИП как при калибровке (табл. 27), остальные с k_g без отступлений', () => {
  const form = {
    ...KV_DEFAULTS, kv_range: 'low', kv_kv: '50', kv_hvl: '1,0', kv_cone: '5', kv_ssd: '30',
    kv_ch_model: 'PTW23342', kv_foil: true, kv_cal: 'ndw', kv_cert_form: 'k', kv_n: '1,250',
    kv_cq_kv: ['30', '50', '70'], kv_cq_hvl: ['0,36', '1,0', '2,9'], kv_cq_val: ['1,000', '1,012', '1,025'],
    kv_lab_f: '3', kv_lab_ssd: '30', kv_env_T: '21', kv_env_P: '100', kv_set: '1', kv_timer_mode: 'manual', kv_tau: '0',
    kv_M1: ['2,000', '2,001', '1,999'], kv_Mopp: ['2,004', '2,005', '2,003'], kv_phantom: 'pmma', kv_lab_phantom: 'pmma',
  };
  const sess = normalizeKvSession({ form, rows: [form, { ...form, kv_cone: '3' }], active: 0 });
  const all = computeKvSession(sess);
  assert.equal(all.stdRow, 1);
  assert.deepEqual(all.nonRef, [false, false]);
  for (const r of all.results) assert.equal(r.compliance.status, 'standard');
});

// ------------------------------------------------------------ несколько режимов аппарата и камер (0.37.0)
const sampleVisit = () => {
  const v = normalizeKvVisit({ form: SAMPLE_KV, rows: [SAMPLE_KV, ...SAMPLE_KV_ROWS], active: 0 });
  const m2 = newKvMode(v.modes[0]);
  Object.assign(m2.shared, SAMPLE_KV_MODE2.shared);
  m2.rows = SAMPLE_KV_MODE2.rows;
  v.modes.push(m2);
  return normalizeKvVisit(v);
};
const D = (r) => (r.trs.ctrl && !r.trs.ctrl.blocked ? r.trs.ctrl : r.trs).perUnit;

test('режимы аппарата: поля формы делятся на общие, камеры, режима и строки без пересечений', () => {
  const groups = [KV_COMMON_KEYS, KV_CHAMBER_KEYS, KV_MODE_KEYS, KV_ROW_KEYS];
  const all = groups.flat();
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual([...all].sort(), Object.keys(KV_DEFAULTS).sort());
  const p = splitKvVisitForm(SAMPLE_KV);
  assert.deepEqual(normalizeKv({ ...p.common, ...p.chamber, ...p.mode, ...p.row }), normalizeKv(SAMPLE_KV));
  assert.equal(p.chamber.kv_ch_model, 'PTW30013');
  assert.equal(p.mode.kv_kv, '200');
  assert.equal(p.common.kv_machine, SAMPLE_KV.kv_machine);
});

test('режимы аппарата: старые файлы и черновики — один режим с одной камерой; формат 3 читается без потерь', () => {
  const flat = normalizeKvVisit(SAMPLE_KV);
  assert.equal(flat.modes.length, 1);
  assert.equal(flat.chambers.length, 1);
  assert.equal(flat.modes[0].rows.length, 1);
  near(D(computeKvVisit(flat).modes[0].results[0]), 1.0012, 5e-5);
  // формат 2 (0.36): строки одного режима и выбранная строка
  const v2 = normalizeKvVisit({ form: kvRowForm(sample(), 2), rows: sample().rows, active: 2 });
  assert.equal(v2.modes[0].rows.length, 3);
  assert.equal(v2.modes[0].active, 2);
  assert.equal(kvVisitRowForm(v2, 0, 1).kv_env_T, '21,4');
  // формат 3 — те же режимы аппарата после записи в JSON
  const v = sampleVisit();
  const again = normalizeKvVisit(JSON.parse(JSON.stringify({ ...v, form: kvVisitRowForm(v, 0, 0) })));
  assert.deepEqual(again, normalizeKvVisit(JSON.parse(JSON.stringify(v))));
  assert.equal(again.mode, 0);
  // номера режима, камеры и строки ограничиваются; форма точнее частей
  const bad = normalizeKvVisit({ ...JSON.parse(JSON.stringify(v)), mode: 5 });
  assert.equal(bad.mode, 0);
  const w = JSON.parse(JSON.stringify(v));
  w.modes[1].chamber = 3;
  w.modes[1].active = 9;
  w.mode = 1;
  const c = normalizeKvVisit({ ...w, form: { ...kvVisitRowForm(v, 1, 0), kv_env_T: '25,0', kv_ch_serial: '777' } });
  assert.equal(c.modes[1].chamber, 0);
  assert.equal(c.modes[1].active, 0);
  assert.equal(c.modes[1].rows[0].kv_env_T, '25,0');
  assert.equal(c.chambers[0].kv_ch_serial, '777');
});

test('режимы аппарата: режим без своих серий берёт k_pol и τ из режима 1 той же камеры', () => {
  const v = sampleVisit();
  const r = computeKvVisit(v);
  const [m1, m2] = r.modes;
  assert.deepEqual([m1.polMode, m1.ksMode, m1.tauMode], [-1, -1, -1]);
  assert.deepEqual([m2.polMode, m2.ksMode, m2.tauMode], [0, -1, 0]);
  // режим 1 — как раньше
  assert.deepEqual(m1.results.map((x) => Math.round(D(x) * 1e4) / 1e4), [1.0012, 0.9425, 1.0475]);
  // режим 2: k_pol и τ режима 1, итог в допуске
  for (const x of m2.results) {
    assert.equal(x.trs.kpolRaw, m1.kpolFix);
    near(x.timer.tau, m1.timer.tau, 1e-12);
    assert.match(x.timer.from, /^режима 1 \(200 кВ, СПО 1,00 мм Cu\)$/);
    assert.ok(has(x, 'info', /k_pol = 0,9995 взят из режима 1 \(200 кВ, СПО 1,00 мм Cu\): в этом режиме серии при обратной полярности нет/));
    assert.ok(has(x, 'info', /τ = 0,0101 мин взята из режима 1 \(200 кВ, СПО 1,00 мм Cu\): в этом режиме ошибку таймера не измеряли/));
    assert.equal(x.messages.filter((m) => m.level !== 'info').length, 0);
  }
  assert.deepEqual(m2.results.map((x) => Math.round(D(x) * 1e4) / 1e4), [0.914, 0.862]);
  assert.equal(m2.stdRow, 0);
  // своя серия при обратной полярности — свой k_pol
  v.modes[1].rows[0].kv_Mopp = ['-20,09', '-20,10', '-20,09'];
  const own = computeKvVisit(v).modes[1];
  assert.equal(own.polMode, -1);
  assert.equal(own.results[1].trs.kpolFrom, 'строки 1 (Ø 10 см)');
});

test('режимы аппарата: k_pol — только из режима с той же камерой; τ — из любого (таймер — свойство аппарата)', () => {
  const v = sampleVisit();
  v.chambers.push(newKvChamber(v.chambers[0]));
  v.modes[1].chamber = 1;
  const m2 = computeKvVisit(v).modes[1];
  assert.equal(m2.polMode, -1);
  assert.equal(m2.tauMode, 0);
  assert.ok(has(m2.results[0], 'warn', /обратной полярности не введены: k_pol принят равным 1/));
  // новая камера: модель и сертификат пустые, электрометр, T₀, P₀ и напряжения — как у камеры 1
  assert.equal(v.chambers[1].kv_ch_model, '');
  assert.equal(v.chambers[1].kv_n, '');
  assert.equal(v.chambers[1].kv_el_model, SAMPLE_KV.kv_el_model);
  assert.equal(v.chambers[1].kv_V1, '400');
});

test('режимы аппарата: из нескольких режимов с серией — ближайший по СПО; ошибка в серии источника передаётся ошибкой', () => {
  const v = sampleVisit();
  // режим 3: 100 кВ, СПО 0,20 мм Cu, со своей серией при обратной полярности (другой k_pol)
  const m3 = newKvMode(v.modes[0]);
  Object.assign(m3.shared, { kv_kv: '100', kv_hvl: '0,20' });
  m3.rows = [{ ...SAMPLE_KV_MODE2.rows[0], kv_M1: ['15,00', '15,01', '15,00'], kv_Mopp: ['-14,90', '-14,91', '-14,90'] }];
  v.modes.push(normalizeKvVisit({ ...v, modes: [m3] }).modes[0]);
  const near05 = computeKvVisit(v).modes[1];
  // СПО 0,50: ln(1,00/0,50) = 0,69 < ln(0,50/0,20) = 0,92 — режим 1
  assert.equal(near05.polMode, 0);
  v.modes[1].shared.kv_hvl = '0,30';
  const near03 = computeKvVisit(v).modes[1];
  // СПО 0,30: ln(0,30/0,20) = 0,41 < ln(1,00/0,30) = 1,20 — режим 3
  assert.equal(near03.polMode, 2);
  assert.match(near03.results[0].trs.kpolFrom, /^режима 3 \(100 кВ, СПО 0,20 мм Cu\)$/);
  assert.notEqual(near03.results[0].trs.kpolRaw, computeKvVisit(v).modes[0].kpolFix);
  // серия источника с ошибкой — у режима 2 ошибка, а не k_pol = 1
  v.modes[2].rows[0].kv_Mopp = ['14,90', '-14,91', '-14,90'];
  const err = computeKvVisit(v).modes[1];
  assert.equal(err.polMode, 2);
  assert.ok(has(err.results[0], 'error', /k_pol из режима 3 \(100 кВ, СПО 0,20 мм Cu\) не вычислен/));
});

test('режимы аппарата: k_s из режима той же камеры при включённом методе двух напряжений', () => {
  const v = sampleVisit();
  Object.assign(v.chambers[0], { kv_ks_on: true, kv_V2: '100' });
  v.modes[0].rows[0].kv_M2 = ['21,85', '21,86', '21,85'];
  const r = computeKvVisit(v);
  assert.equal(r.modes[0].ksSrc, 0);
  assert.equal(r.modes[1].ksMode, 0);
  const ks = r.modes[0].ksFix;
  assert.ok(ks > 1 && ks < 1.01, String(ks));
  for (const x of r.modes[1].results) {
    assert.equal(x.trs.ksRaw, ks);
    assert.ok(has(x, 'info', /k_s = \d,\d{4} взят из режима 1 \(200 кВ, СПО 1,00 мм Cu\): в этом режиме серии при пониженном напряжении V₂ нет/));
  }
});

test('режимы аппарата: τ — из ближайшего по напряжению режима, в единицах задания; «не учитывать» и чужие единицы — без переноса', () => {
  const v = sampleVisit();
  const tau1 = computeKvVisit(v).modes[0].timer.tau;
  // задание в секундах — τ пересчитывается
  v.modes[1].shared.kv_set_unit = 's';
  for (const row of v.modes[1].rows) row.kv_set = '60';
  const s = computeKvVisit(v).modes[1];
  assert.equal(s.tauMode, 0);
  near(s.results[0].timer.tau, tau1 * 60, 1e-9);
  near(D(s.results[0]), 0.914, 5e-5);
  // задание в МЕ — τ в минутах не переносится
  v.modes[1].shared.kv_set_unit = 'MU';
  assert.equal(computeKvVisit(v).modes[1].tauMode, -1);
  v.modes[1].shared.kv_set_unit = 'min';
  for (const row of v.modes[1].rows) row.kv_set = '1,00';
  // «не учитывать» — выбор пользователя: τ не берётся
  v.modes[1].shared.kv_timer_mode = 'none';
  const off = computeKvVisit(v).modes[1];
  assert.equal(off.tauMode, -1);
  assert.equal(off.results[0].timer.tau, 0);
  assert.ok(has(off.results[0], 'warn', /Ошибка таймера не учтена/));
  // n облучений без показаний — тоже «нет своих данных»
  v.modes[1].shared.kv_timer_mode = 'nexp';
  assert.equal(computeKvVisit(v).modes[1].tauMode, 0);
  // ближайший по напряжению: режим 3 на 160 кВ со своим τ = 0,02 мин
  v.modes[1].shared.kv_timer_mode = 'measured';
  const m3 = newKvMode(v.modes[0]);
  Object.assign(m3.shared, { kv_kv: '160', kv_hvl: '0,70', kv_timer_mode: 'manual', kv_tau: '0,02' });
  m3.rows = [SAMPLE_KV_MODE2.rows[0]];
  v.modes.push(normalizeKvVisit({ ...v, modes: [m3] }).modes[0]);
  const m2 = computeKvVisit(v).modes[1];
  assert.equal(m2.tauMode, 2);
  near(m2.results[0].timer.tau, 0.02, 1e-12);
  // у режима-источника ошибка в данных таймера — у режима 2 ошибка
  v.modes[2].shared.kv_tau = 'abc';
  assert.ok(has(computeKvVisit(v).modes[1].results[0], 'error', /Ошибка таймера из режима 3 \(160 кВ, СПО 0,70 мм Cu\) не вычислена/));
});

test('режимы аппарата: новый режим — камера, фантом, единица задания и тубусы как у образца; пучок, τ и показания пустые', () => {
  const v = sampleVisit();
  const m = newKvMode(v.modes[0]);
  assert.equal(m.chamber, 0);
  assert.equal(m.shared.kv_range, 'medium');
  assert.equal(m.shared.kv_phantom, 'water');
  assert.equal(m.shared.kv_kv, '');
  assert.equal(m.shared.kv_ma, '');
  assert.equal(m.shared.kv_hvl, '');
  assert.deepEqual(m.shared.kv_tt, KV_DEFAULTS.kv_tt);
  // ошибка таймера по двум заданиям: задания T₁ и T₂ — как у образца, показания — свои
  assert.equal(m.shared.kv_timer_mode, 'twopoint');
  assert.deepEqual([m.shared.kv_tp_t1, m.shared.kv_tp_t2], ['6', '60']);
  assert.deepEqual([m.shared.kv_tp_R1, m.shared.kv_tp_R2], [KV_DEFAULTS.kv_tp_R1, KV_DEFAULTS.kv_tp_R2]);
  assert.equal(m.rows.length, 3);
  assert.deepEqual(m.rows.map(kvRowLabel), ['Ø 10 см', '6 × 8 см', 'Ø 15 см']);
  assert.deepEqual(m.rows[0].kv_M1, KV_DEFAULTS.kv_M1);
  assert.equal(m.rows[0].kv_ref, '');
  assert.equal(m.rows[0].kv_env_T, '21,0');
  // известное τ образца — не для нового режима: он берёт τ из ближайшего режима
  v.modes[0].shared.kv_timer_mode = 'manual';
  assert.equal(newKvMode(v.modes[0]).shared.kv_timer_mode, 'twopoint');
  // подпись режима
  assert.equal(kvModeLabel(v.modes[1].shared), '150 кВ, СПО 0,50 мм Cu');
  assert.equal(kvModeLabel(m.shared), '');
  assert.equal(kvModeLabel({ kv_range: 'low', kv_kv: '50', kv_hvl: '' }), '50 кВ');
});

test('режимы аппарата: неизменённый режим не пересчитывается (запоминание по данным режима)', () => {
  const v = sampleVisit();
  const a = computeKvVisit(v);
  v.modes[1].rows[1].kv_env_T = '22,0';
  const b = computeKvVisit(v);
  assert.equal(b.modes[0].results, a.modes[0].results);
  assert.notEqual(b.modes[1].results, a.modes[1].results);
});

test('режимы аппарата: ток трубки — поле режима, для протокола; в расчёт не входит, нечисло — предупреждение', () => {
  assert.ok(KV_MODE_KEYS.includes('kv_ma'));
  const v = sampleVisit();
  assert.deepEqual(v.modes.map((md) => md.shared.kv_ma), ['10', '12']);
  const base = computeKv(SAMPLE_KV);
  assert.equal(base.flags.kv_ma, undefined);
  for (const ma of ['', '25', '0,5']) {
    const r = computeKv({ ...SAMPLE_KV, kv_ma: ma });
    assert.equal(r.flags.kv_ma, undefined, ma);
    assert.equal(r.trs.perUnit, base.trs.perUnit);
  }
  for (const ma of ['десять', '0', '-5']) {
    const r = computeKv({ ...SAMPLE_KV, kv_ma: ma });
    assert.equal(r.flags.kv_ma, 'warn', ma);
    assert.ok(has(r, 'warn', /Ток трубки — число миллиампер больше нуля/));
  }
});
