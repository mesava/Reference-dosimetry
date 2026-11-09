// Бюджет неопределённости для kV-рентгена: типовые бюджеты TRS-398 Rev.1, табл. 30 (низкие энергии) и 33 (средние),
// столбцы «На основе N_D,w» и «На основе N_K»; k_g = 1 по DIN 6809-4 и Qo = ⁶⁰Co — с пометкой «не по Rev.1».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uncertaintyBudget, pickTemplate, quad } from '../src/core/uncertainty.js';
import { computeUncertaintyTool, normalizeUncTool, UT_DEFAULTS, defaultUnit } from '../src/core/uncertainty-tool.js';
import { setLang } from '../src/core/i18n.js';

const r1 = (x) => Math.round(x * 10) / 10;
const row = (b, key) => b.rows.find((r) => r.key === key);
const kv = (o) => uncertaintyBudget({ beam: 'kv', protocol: 'trs', kvKg: 'calc', ...o });
const tool = (o) => computeUncertaintyTool({ ...UT_DEFAULTS, unc_beam_type: 'kv', ...o });

test('табл. 30 и 33: итоги этапов и суммарная u_c, как в Rev.1; при калибровке прямо в ДЛПЭ — значения прим. c', () => {
  // [диапазон, калибровка, шаблон, этап 1, этап 2, u_c, u_c при калибровке в ДЛПЭ]
  const cases = [
    ['low', 'ndw', 't30ndw', 1.5, 1.7, 2.3, 2.2],
    ['low', 'nk', 't30nk', 0.7, 1.8, 1.9, 1.9],
    ['medium', 'ndw', 't33ndw', 1.1, 1.4, 1.8, 1.7],
    ['medium', 'nk', 't33nk', 0.7, 1.9, 2.0, 1.9],
  ];
  for (const [kvRange, kvCal, id, s1, s2, uc, direct] of cases) {
    assert.equal(pickTemplate({ beam: 'kv', kvRange, kvCal }), id);
    const b = kv({ kvRange, kvCal });
    assert.equal(b.template.id, id);
    assert.equal(b.template.stages, true);
    assert.equal(r1(b.groups[0].subtotal.def), s1, `${id}: этап 1`);
    assert.equal(r1(b.groups[1].subtotal.def), s2, `${id}: этап 2`);
    assert.equal(r1(b.ucPct), uc, `${id}: суммарная`);
    assert.equal(r1(quad(b.rows.filter((r) => !r.key.endsWith('.lab_user')).map((r) => r.def))), direct, `${id}: калибровка в ДЛПЭ`);
    assert.ok(b.template.note.includes(`u_c = ${String(direct).replace('.', ',')}`), `${id}: прим. c в справке`);
    assert.ok(b.rows.every((r) => r.ref.startsWith(`TRS-398 Rev.1, табл. ${id.slice(1, 3)}`)));
    assert.equal(b.messages.length, 0);
  }
  // состав строк по столбцам таблиц
  const keys = (o) => kv(o).rows.map((r) => r.key.split('.')[1]);
  assert.deepEqual(keys({ kvRange: 'low', kvCal: 'ndw' }), ['lab_psdl', 'lab_stab', 'lab_user', 'st_interp', 'st_kg', 'st_stab', 'st_read', 'st_setup', 'st_ki']);
  assert.deepEqual(keys({ kvRange: 'low', kvCal: 'nk' }), ['lab_psdl', 'lab_stab', 'lab_user', 'st_interp', 'st_muen', 'st_bw', 'st_stab', 'st_read', 'st_setup', 'st_ki']);
  assert.deepEqual(keys({ kvRange: 'medium', kvCal: 'nk' }), ['lab_psdl', 'lab_stab', 'lab_user', 'st_interp', 'st_pch', 'st_pchfs', 'st_muen', 'st_stab', 'st_read', 'st_setup', 'st_ki']);
  assert.equal(row(kv({ kvRange: 'low', kvCal: 'ndw' }), 't30ndw.st_kg').def, 1.0);
  assert.equal(row(kv({ kvRange: 'medium', kvCal: 'ndw' }), 't33ndw.st_kg').def, 0.2);
  // показания относительно таймера — строка типа А: колебания выхода аппарата оценивает пользователь
  assert.match(row(kv({ kvRange: 'low', kvCal: 'ndw' }), 't30ndw.st_read').how, /не меньше пяти облучений/);
});

test('k_g: геометрия как в лаборатории — 0; k_g = 1 при другом поле или РИП — 2,0 % / 1,3 % по DIN 6809-4 с пометкой', () => {
  const same = kv({ kvRange: 'low', kvCal: 'ndw', kvKg: 'same' });
  assert.equal(row(same, 't30ndw.st_kg').def, 0);
  assert.equal(same.messages.length, 0);
  for (const [kvRange, u] of [['low', 2.0], ['medium', 1.3]]) {
    const b = kv({ kvRange, kvCal: 'ndw', kvKg: 'one', prefix: '' });
    const r = b.rows.find((x) => x.key.endsWith('.st_kg'));
    assert.equal(r.def, u);
    assert.match(r.ref, /^DIN 6809-4:2020/);
    assert.ok(b.messages.some((m) => m.level === 'warn' && m.field === 'unc_kv_kg' && /не TRS-398 Rev\.1/.test(m.text)));
  }
  // в ветке N_K k_g нет: выбор k_g ни на что не влияет
  const t = tool({ unc_kv_cal: 'nk', unc_kv_kg: 'one' });
  assert.ok(!t.budget.rows.some((r) => r.key.endsWith('.st_kg')));
  assert.ok(!t.messages.some((m) => /k_g = 1/.test(m.text)));
});

test('Qo = ⁶⁰Co (средние энергии, N_D,w): табл. 33 со справкой DIN 6809-4, табл. 7, и предупреждением «не по Rev.1»', () => {
  const t = tool({ unc_kv_range: 'medium', unc_kv_cal: 'ndw', unc_kv_qo: 'co60', unc_kv_depth: '5' });
  assert.equal(t.budget.template.id, 't33ndw');
  // к табл. 33 добавляется k_z = 1 (пересчёт с 5 см на 2 см) — 0,5 % по DIN 6809-4
  const kz = row(t.budget, 't33ndw.st_kz');
  assert.equal(kz.def, 0.5);
  assert.match(kz.ref, /^DIN 6809-4:2020/);
  assert.ok(Math.abs(t.ucPct - Math.hypot(tool({ unc_kv_range: 'medium' }).ucPct, 0.5)) < 1e-12);
  assert.equal(r1(t.ucPct), 1.9);
  assert.match(t.budget.template.title, /Qo = ⁶⁰Co/);
  assert.match(t.budget.template.title, /на 5 см, DIN 6809-4/);
  assert.match(t.budget.template.note, /DIN 6809-4, табл\. 7.*u_c = 1,80 %/);
  assert.equal(t.flags.unc_kv_depth, 'warn');
  // Qo = ⁶⁰Co, коэффициенты на 2 г/см² (как в поверке ВНИИФТРИ): ур. (58) Rev.1 — без k_z и без предупреждения
  const at2 = tool({ unc_kv_range: 'medium', unc_kv_cal: 'ndw', unc_kv_qo: 'co60' });
  assert.ok(!at2.budget.rows.some((r) => r.key.endsWith('.st_kz')));
  assert.ok(Math.abs(at2.ucPct - tool({ unc_kv_range: 'medium' }).ucPct) < 1e-12);
  assert.match(at2.budget.template.title, /Qo = ⁶⁰Co\)$/);
  assert.equal(at2.flags.unc_kv_depth, undefined);
  // рентгеновское Qo на 5 см — тоже k_z = 1 по DIN
  const x5 = tool({ unc_kv_range: 'medium', unc_kv_cal: 'ndw', unc_kv_qo: 'kv', unc_kv_depth: '5' });
  assert.equal(row(x5.budget, 't33ndw.st_kz').def, 0.5);
  assert.doesNotMatch(x5.budget.template.note, /табл\. 7/);
  // файлы до 0.49.3: Qo = ⁶⁰Co без глубины читается как 5 см
  assert.equal(normalizeUncTool({ unc_kv_qo: 'co60' }).unc_kv_depth, '5');
  assert.equal(normalizeUncTool({ unc_kv_qo: 'co60', unc_kv_depth: '2' }).unc_kv_depth, '2');
  // для низких энергий и для N_K опорного качества ⁶⁰Co нет — выбор не действует
  for (const o of [{ unc_kv_range: 'low' }, { unc_kv_range: 'medium', unc_kv_cal: 'nk' }]) {
    const x = tool({ ...o, unc_kv_qo: 'co60' });
    assert.ok(!/⁶⁰Co/.test(x.budget.template.title));
    assert.ok(!x.budget.rows.some((r) => r.key.endsWith('.st_kz')));
    assert.equal(x.flags.unc_kv_qo, undefined);
  }
});

test('инструмент: kV-рентген — свидетельство N_K, без раскрытия k_i, единицы и глубина итога', () => {
  // U из свидетельства заменяет этап 1; строка названа по калибровочному коэффициенту
  const nk = tool({ unc_kv_cal: 'nk', unc_cert_U: '1,6', unc_cert_k: '2' });
  const cert = nk.budget.rows.find((r) => r.certRow);
  assert.match(cert.label, /^N_K из свидетельства/);
  assert.equal(nk.budget.rows.filter((r) => r.replaced).length, 3);
  assert.ok(Math.abs(nk.budget.groups[0].subtotal.value - 0.8) < 1e-12);
  assert.match(tool({ unc_cert_U: '1,6' }).budget.rows.find((r) => r.certRow).label, /^N_D,w из свидетельства/);
  // раскрытие k_i и установки — по типовым значениям МВ-пучков: для kV его нет, строки — типовые 0,8 % и 1,0 %
  const on = tool({ unc_ki: JSON.stringify({ on: true }), unc_setup: JSON.stringify({ on: true }) });
  assert.equal(on.budget.ki, null);
  assert.equal(on.budget.setup, null);
  assert.equal(row(on.budget, 't30ndw.st_ki').value, 0.8);
  assert.equal(row(on.budget, 't30ndw.st_setup').value, 1.0);
  // повторяемость серии (тип А) больше 0,1 % — идёт в строку показаний
  const a = tool({ unc_M: ['10,00', '10,05', '9,95'] });
  assert.equal(row(a.budget, 't30ndw.st_read').type, 'A');
  // единицы, способ калибровки, глубина итога
  assert.equal(defaultUnit('kv'), 'Gymin');
  assert.equal(normalizeUncTool({ unc_beam_type: 'kv', unc_unit: 'xx' }).unc_unit, 'Gymin');
  assert.equal(normalizeUncTool({ unc_beam_type: 'kv', unc_route: 'crossCo' }).unc_route, 'lab');
  assert.equal(normalizeUncTool({ unc_beam_type: 'kv', unc_value_at: 'max' }).unc_value_at, 'zref');
  assert.equal(normalizeUncTool({ unc_beam_type: 'kv', unc_kv_range: 'x', unc_kv_cal: 'y', unc_kv_kg: 'z' }).unc_kv_kg, 'calc');
  const v = tool({ unc_value: '0,5000', unc_unit: 'GyGy', unc_value_at: 'max', unc_transfer_u: '3' });
  assert.equal(v.valueAt, 'zref');
  assert.ok(Math.abs(v.abs - (0.5 * v.UPct) / 100) < 1e-12);
  // TG-51 kV-рентген не охватывает — бюджет TRS-398 Rev.1 со справкой
  const tg = tool({ protocol: 'tg51' });
  assert.equal(tg.budget.template.id, 't30ndw');
  assert.match(tg.budget.template.note, /TG-51 не охватывает kV-рентген/);
});

test('по-английски: заголовки, строки и справки без кириллицы', () => {
  setLang('en');
  try {
    for (const o of [{ unc_kv_range: 'low' }, { unc_kv_range: 'low', unc_kv_cal: 'nk' }, { unc_kv_range: 'medium', unc_kv_qo: 'co60', unc_kv_kg: 'one' }, { unc_kv_range: 'medium', unc_kv_cal: 'nk', protocol: 'tg51' }]) {
      const t = tool(o);
      const b = t.budget;
      const texts = [b.template.title, b.template.note, ...b.groups.map((g) => g.title), ...b.rows.flatMap((r) => [r.label, r.how]), ...t.messages.map((m) => m.text)];
      for (const s of texts) assert.ok(!/[А-Яа-яЁё]/.test(s), s);
    }
  } finally {
    setLang('ru');
  }
});
