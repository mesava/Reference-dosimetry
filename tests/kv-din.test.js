// Пересчёт СПО между мм Al и мм Cu по DIN 6809-4:2020, табл. 5 (справочно, не TRS-398 Rev.1): узлы таблицы, сверка
// с качествами, где СПО известны в обоих металлах (TG-61, табл. II; TRS-398 Rev.1, табл. 53), строки сертификата
// в другом металле, пометка «не по Rev.1» и чувствительность значения для пучка. Здесь же — глубина калибровки
// коэффициентов (2 г/см² по Rev.1 или 5 см по DIN 6809-4 с k_z = 1) отдельно от опорного качества Qo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIN_TH, DIN_HVL_DEV, dinHvlConvert } from '../src/core/kv-din.js';
import { computeKv, certRows, certDinSensitivity, normalizeKv } from '../src/core/kv.js';
import { computeUncertaintyTool, UT_DEFAULTS } from '../src/core/uncertainty-tool.js';
import { setLang } from '../src/core/i18n.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const errors = (r) => r.messages.filter((m) => m.level === 'error').map((m) => m.text);
const has = (r, level, re) => r.messages.some((m) => m.level === level && re.test(m.text));

test('DIN 6809-4, табл. 5: в узлах — значения таблицы в обе стороны, между узлами — монотонно, вне таблицы — экстраполяция', () => {
  assert.equal(DIN_TH.length, 8);
  for (let i = 1; i < DIN_TH.length; i++) {
    assert.ok(DIN_TH[i].al > DIN_TH[i - 1].al && DIN_TH[i].cu > DIN_TH[i - 1].cu, DIN_TH[i].code);
  }
  for (const q of DIN_TH) {
    near(dinHvlConvert(q.al, 'Al').value, q.cu, 1e-12, q.code);
    near(dinHvlConvert(q.cu, 'Cu').value, q.al, 1e-12, q.code);
    assert.equal(dinHvlConvert(q.al, 'Al').extrapolated, null);
  }
  // туда и обратно — то же значение (кусочно-линейная по ln–ln функция обратима)
  for (const x of [3, 5.58, 9.5, 15, 25]) near(dinHvlConvert(dinHvlConvert(x, 'Al').value, 'Cu').value, x, 1e-9 * x);
  // середина отрезка TH 120–TH 140 по ln(СПО в Al) — середина по ln(СПО в Cu)
  near(dinHvlConvert(Math.sqrt(6.26 * 8.21), 'Al').value, Math.sqrt(0.29 * 0.46), 1e-12);
  const lo = dinHvlConvert(2.48, 'Al');
  assert.equal(lo.extrapolated, 'below');
  assert.equal(lo.to, 'Cu');
  assert.equal(lo.min, 4.63);
  assert.equal(dinHvlConvert(4, 'Cu').extrapolated, 'above');
  assert.ok(Number.isNaN(dinHvlConvert(0, 'Al').value));
  assert.ok(Number.isNaN(dinHvlConvert(NaN, 'Cu').value));
});

test('Сверка пересчёта: TG-61 M150 и M200, МБМВ 100 кВ — отклонения в пределах оценки ±5 % (вне табл. 5 — около неё)', () => {
  // TG-61 (Ma et al. 2001), табл. II; TRS-398 Rev.1, табл. 53 (МБМВ, 100 кВ)
  const dev = (al, cu) => (dinHvlConvert(al, 'Al').value / cu - 1) * 100;
  near(dev(10.2, 0.67), 2.8, 0.05, 'M150');
  near(dev(14.9, 1.69), 4.4, 0.05, 'M200');
  near(dev(4.0, 0.15), -4.8, 0.05, 'МБМВ 100 кВ');
  for (const [al, cu] of [[10.2, 0.67], [14.9, 1.69]]) assert.ok(Math.abs(dev(al, cu)) <= DIN_HVL_DEV * 100);
  // поверка ВНИИФТРИ в мм Al: 120 кВ, 5,58 мм Al — внутри таблицы; 100 кВ, 2,48 мм Al — ниже TH 100
  near(dinHvlConvert(5.58, 'Al').value, 0.2418, 5e-5);
  near(dinHvlConvert(2.48, 'Al').value, 0.0671, 5e-5);
});

// Средние энергии, N_D,w с рентгеновским Qo: поверка «N_Д и K», качества 100 и 120 кВ — СПО в мм Al, остальные — в мм Cu
const MED_NDW = {
  kv_range: 'medium', kv_kv: '120', kv_hvl: '0,224', kv_cone: '10', kv_ssd: '50', kv_ch_model: 'PTW30013',
  kv_cal: 'ndw', kv_qo: 'kv', kv_cal_depth: '2', kv_cert_form: 'k', kv_n: '0,05389', kv_n_unit: 'Gy/nC',
  kv_cq_kv: ['100', '120', '140', '150', '200'], kv_cq_hvl: ['2,48', '5,58', '0,42', '0,768', '1,45'], kv_cq_mat: ['Al', 'Al', 'Cu', 'Cu', 'Cu'],
  kv_cq_val: ['1,010', '1,000', '0,995', '0,993', '0,990'],
  kv_lab_shape: 'square', kv_lab_f: '10', kv_lab_ssd: '100', kv_phantom: 'water', kv_lab_phantom: 'water',
  kv_env_T: '21', kv_env_P: '100', kv_set_unit: 'min', kv_set: '1', kv_timer_mode: 'none',
  kv_M1: ['2,000', '2,001', '1,999'], kv_Mopp: ['2,004', '2,005', '2,003'],
};

test('Строки сертификата в другом металле: без пересчёта не используются, с пересчётом — оценка «не по Rev.1» с чувствительностью', () => {
  const f = normalizeKv(MED_NDW);
  const plain = certRows(f, 'Cu');
  assert.deepEqual(plain.rows.map((r) => r.row), [3, 4, 5]);
  assert.deepEqual(plain.other.map((x) => [x.row, x.mat]), [[1, 'Al'], [2, 'Al']]);
  const din = certRows(f, 'Cu', { din: true });
  assert.deepEqual(din.rows.map((r) => r.row), [1, 2, 3, 4, 5]);
  near(din.rows[1].hvl, dinHvlConvert(5.58, 'Al').value, 1e-12);
  assert.equal(din.rows[0].extrapolated, 'below');
  assert.equal(din.rows[1].matSrc, 'Al');
  // пустой металл строки (файлы до 0.49.3) — как у пучка
  assert.deepEqual(certRows(normalizeKv({ ...MED_NDW, kv_cq_mat: undefined }), 'Cu').rows.length, 5);

  // без пересчёта: СПО пучка 0,224 мм Cu ниже качеств в мм Cu — экстраполяция и предупреждение о строках в мм Al
  const off = computeKv(MED_NDW);
  assert.deepEqual(errors(off), []);
  assert.ok(has(off, 'warn', /Строки 1, 2 сертификата — СПО в мм Al/));
  assert.ok(off.cert.interp.extrapolated);
  assert.equal(off.cert.din, undefined);
  assert.equal(off.cert.other.length, 2);
  assert.equal(off.compliance.status, 'standard');

  // с пересчётом: строки 1 и 2 идут в интерполяцию, расчёт помечен как не по Rev.1, в замечании — изменение K
  const on = computeKv({ ...MED_NDW, kv_cq_din: true });
  assert.deepEqual(errors(on), []);
  assert.ok(!on.cert.interp.extrapolated);
  assert.equal(on.compliance.status, 'nonstandard');
  assert.ok(on.notRev1.some((t) => /DIN 6809-4, табл\. 5/.test(t)));
  assert.ok(has(on, 'warn', /оценка, не TRS-398 Rev\.1/));
  assert.ok(has(on, 'warn', /Строки 1 — вне диапазона табл\. 5/));
  assert.deepEqual(on.cert.din.extrapolated, [1]);
  // чувствительность: K для пучка при сдвиге пересчитанных СПО на ±5 %, u = δ/√3
  const d = certDinSensitivity(certRows(normalizeKv(on.form), 'Cu', { din: true }).rows, 0.224);
  near(on.cert.din.deltaPct, d * 100, 1e-12);
  near(on.cert.din.uPct, (d * 100) / Math.sqrt(3), 1e-12);
  assert.ok(on.cert.din.deltaPct > 0 && on.cert.din.deltaPct < 1, String(on.cert.din.deltaPct));
  // без пересчитанных строк чувствительности нет
  assert.ok(Number.isNaN(certDinSensitivity(plain.rows, 0.5)));
});

test('Глубина калибровки отдельно от Qo: 2 г/см² — по Rev.1 без k_z, 5 см — DIN 6809-4 с k_z = 1 и пометкой; старые файлы', () => {
  const base = { ...MED_NDW, kv_hvl: '1,0', kv_kv: '200', kv_cq_mat: ['Cu', 'Cu', 'Cu', 'Cu', 'Cu'], kv_cq_hvl: ['0,2', '0,42', '0,768', '1,45', '2,5'] };
  const at2 = computeKv(base);
  assert.deepEqual(errors(at2), []);
  assert.equal(at2.cert.kz, undefined);
  assert.equal(at2.depth5, false);
  assert.equal(at2.compliance.status, 'standard');
  // рентгеновское Qo на 5 см (DIN 6809-4, табл. 4): k_z = 1, нестандартные условия, замечание у поля глубины
  const at5 = computeKv({ ...base, kv_cal_depth: '5' });
  assert.deepEqual(errors(at5), []);
  assert.equal(at5.cert.kz, 1);
  assert.equal(at5.depth5, true);
  assert.equal(at5.compliance.status, 'nonstandard');
  assert.equal(at5.flags.kv_cal_depth, 'warn');
  near(at5.trs.D, at2.trs.D, 1e-12 * at2.trs.D);
  // Qo = ⁶⁰Co на 2 г/см² (поверка ВНИИФТРИ: N_Д в ⁶⁰Co и K качеств на 2 г/см²): ур. (58) Rev.1, без k_z
  const co2 = computeKv({ ...base, kv_qo: 'co60' });
  assert.deepEqual(errors(co2), []);
  assert.equal(co2.cert.kz, undefined);
  assert.ok(has(co2, 'info', /ур\. \(58\)/));
  // файлы до 0.49.3: Qo = ⁶⁰Co без глубины — калибровка на 5 см по DIN
  assert.equal(normalizeKv({ kv_qo: 'co60' }).kv_cal_depth, '5');
  assert.equal(normalizeKv({ kv_qo: 'kv' }).kv_cal_depth, '2');
  assert.equal(normalizeKv({ kv_qo: 'co60', kv_cal_depth: '2' }).kv_cal_depth, '2');
  // плоскопараллельная камера в средних энергиях — ошибка (Rev.1, разд. 9.2.1, табл. 31)
  const pp = computeKv({ ...base, kv_ch_model: 'PTW23342' });
  assert.ok(errors(pp).some((t) => /Плоскопараллельная камера не для средних энергий/.test(t)));
});

test('Бюджет неопределённости: строка пересчёта СПО по DIN после интерполяции, предупреждение «не по Rev.1»', () => {
  const tool = (o) => computeUncertaintyTool({ ...UT_DEFAULTS, unc_beam_type: 'kv', unc_kv_range: 'medium', ...o });
  const plain = tool({});
  const t = tool({ unc_kv_hvldin: '0,3' });
  const keys = t.budget.rows.map((r) => r.key.split('.')[1]);
  assert.equal(keys.indexOf('st_hvldin'), keys.indexOf('st_interp') + 1);
  const row = t.budget.rows.find((r) => r.key.endsWith('.st_hvldin'));
  assert.equal(row.def, 0.3);
  assert.match(row.ref, /^DIN 6809-4:2020, табл\. 5/);
  near(t.ucPct, Math.hypot(plain.ucPct, 0.3), 1e-12);
  assert.equal(t.flags.unc_kv_hvldin, 'warn');
  // низкие энергии — тоже
  assert.ok(tool({ unc_kv_range: 'low', unc_kv_hvldin: '0,2' }).budget.rows.some((r) => r.key.endsWith('.st_hvldin')));
  // неправдоподобное значение — предупреждение, строки нет
  const bad = tool({ unc_kv_hvldin: '25' });
  assert.ok(!bad.budget.rows.some((r) => r.key.endsWith('.st_hvldin')));
  assert.equal(bad.flags.unc_kv_hvldin, 'warn');
});

test('по-английски: замечания пересчёта СПО без кириллицы', () => {
  setLang('en');
  try {
    const on = computeKv({ ...MED_NDW, kv_cq_din: true });
    const off = computeKv(MED_NDW);
    for (const m of [...on.messages, ...off.messages]) assert.ok(!/[а-яё]/i.test(m.text), m.text);
    for (const t of on.notRev1) assert.ok(!/[а-яё]/i.test(t), t);
    const u = computeUncertaintyTool({ ...UT_DEFAULTS, unc_beam_type: 'kv', unc_kv_hvldin: '0,3' });
    const row = u.budget.rows.find((r) => r.key.endsWith('.st_hvldin'));
    assert.ok(!/[а-яё]/i.test(row.label + row.how), row.label);
  } finally {
    setLang('ru');
  }
});
