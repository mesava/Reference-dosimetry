// kV-рентген: строки аппликаторов одного пучка (раздел 4 вкладки). Деление формы на общие поля и поля строки,
// старые файлы и черновики (плоская форма) — одна строка, каждая строка считается как отдельный расчёт со своими T, P,
// показаниями и тубусом, k_pol и k_s строк без своих серий — из первой строки с серией (ошибки источника не передаются).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKv, KV_DEFAULTS, normalizeKv } from '../src/core/kv.js';
import { KV_ROW_KEYS, emptyKvRow, splitKvForm, kvRowForm, normalizeKvSession, kvRowLabel, computeKvSession, kvRowEmpty } from '../src/core/kv-session.js';
import { SAMPLE_KV, SAMPLE_KV_ROWS } from '../src/core/sample-kv.js';
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
