// kV-рентген, средние энергии: камера откалибрована только в ⁶⁰Co (калибровки в рентгене нет) — k_Q = 1
// с пометкой «не по TRS-398 Rev.1 и не по DIN 6809-4». Сверка с приёмкой, где так и считали, — tests/kv-terad.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKv, KV_DEFAULTS } from '../src/core/kv.js';
import { computeUncertaintyTool, UT_DEFAULTS } from '../src/core/uncertainty-tool.js';
import { setLang } from '../src/core/i18n.js';

// Farmer PTW 30013, N_D,w(⁶⁰Co); k_s и k_pol — серия 400/200 В
const BASE = {
  ...KV_DEFAULTS,
  kv_range: 'medium', kv_ch_model: 'PTW30013', kv_cal: 'ndw', kv_qo: 'co60', kv_cert_form: 'co', kv_n: '0,05389', kv_n_unit: 'Gy/nC',
  kv_cone_shape: 'square', kv_cone: '8,944', kv_ssd: '50', kv_T0: '20', kv_P0: '101,325', kv_kelec: '1', kv_env_P_unit: 'hPa',
  kv_set_unit: 'min', kv_set: '1', kv_timer_mode: 'none',
  kv_V1: '400', kv_V2: '200', kv_ks_on: true, kv_rec_trs: 'eq13',
  kv_M1: ['4,498', '4,496', '4,499'], kv_Mopp: ['-4,54', '-4,534', '-4,546'], kv_M2: ['4,486', '4,489', '4,501'],
};
const run = (o) => computeKv({ ...BASE, ...o });

test('только N_D,w в ⁶⁰Co: k_Q = 1, k_g = 1 без лабораторной геометрии, пометка «не по Rev.1 и не по DIN»', () => {
  const r = run({ kv_kv: '120', kv_hvl: '0,222', kv_env_T: '22,6', kv_env_P: '1007,5', kv_Mc: ['9,532', '9,535', '9,551'] });
  assert.equal(r.hasErrors, false, r.messages.filter((m) => m.level === 'error').map((m) => m.text).join('\n'));
  assert.equal(r.cert.kQ, 1);
  assert.equal(r.cert.kq1, true);
  assert.equal(r.cert.NQ, 0.05389);
  assert.equal(r.cert.rows.length, 0);
  // поле и РИП лаборатории не нужны: калибровки в рентгене нет
  assert.equal(r.trs.kg.value, 1);
  assert.equal(r.trs.kg.source, 'nocal');
  assert.ok(!r.messages.some((m) => /лаборатори/.test(m.text) && m.level === 'error'));
  // D = M̄ · N · k_TP · k_pol · k_s
  const M = (9.532 + 9.535 + 9.551) / 3;
  const x = r.trs.ctrl;
  assert.ok(Math.abs(x.D - M * 0.05389 * r.trs.kTP * r.trs.kpol * r.trs.ks) < 1e-12);
  // пометки: итог, условия, предупреждение у формы сертификата
  assert.match(r.notRev1.join('; '), /k_Q = 1: камера откалибрована только в ⁶⁰Co.*не по Rev\.1 и не по DIN 6809-4/);
  assert.equal(r.notRev1.length, 1);
  assert.ok(r.messages.some((m) => m.level === 'warn' && /ни TRS-398 Rev\.1 \(разд\. 9\.2\.1\), ни DIN 6809-4 \(разд\. 6\.4\.2\)/.test(m.text)));
  assert.equal(r.flags.kv_cert_form, 'warn');
  assert.equal(r.compliance.status, 'nonstandard');
  assert.ok(r.compliance.reasons.some((x) => /только в ⁶⁰Co, k_Q = 1 — ни TRS-398 Rev\.1, ни DIN 6809-4/.test(x.text)));
  assert.ok(r.compliance.reasons.some((x) => /калибровки в рентгене нет: k_g не к чему отнести/.test(x.text)));
  // справочное сравнение с DIN не считается: DIN тоже требует k_Q,M
  assert.equal(r.compare.available, false);
  assert.match(r.compare.reason, /DIN 6809-4, как и Rev\.1, требует k_Q,M/);
});

test('вариант «только ⁶⁰Co» — только при Qo = ⁶⁰Co (средние энергии, N_D,w)', () => {
  for (const o of [{ kv_qo: 'kv' }, { kv_cal: 'nk' }, { kv_range: 'low', kv_ch_model: 'PTW23342', kv_kv: '50', kv_hvl: '1' }]) {
    const r = run({ kv_kv: '120', kv_hvl: '0,222', kv_env_T: '20', kv_env_P: '1013,25', ...o });
    assert.ok(r.messages.some((m) => m.level === 'error' && /только N_D,w в ⁶⁰Co \(k_Q = 1\)/.test(m.text)), JSON.stringify(o));
    assert.equal(r.flags.kv_cert_form, 'error');
    assert.notEqual(r.cert.kq1, true);
  }
});

test('бюджет: строка «k_Q = 1» без типового значения — u_c её не включает, пока нет своей оценки', () => {
  const tool = (o) => computeUncertaintyTool({ ...UT_DEFAULTS, unc_beam_type: 'kv', unc_kv_range: 'medium', unc_kv_cal: 'ndw', unc_kv_qo: 'co60', ...o });
  const din = tool({});
  const t = tool({ unc_kv_kq: 'one' });
  const row = t.budget.rows.find((r) => r.key === 't33ndw.st_kq1');
  assert.ok(row);
  assert.ok(Number.isNaN(row.def));
  assert.ok(Number.isNaN(row.value));
  assert.match(row.ref, /не TRS-398 Rev\.1 и не DIN 6809-4/);
  // строка стоит после k_z; без своей оценки u_c — как у DIN-бюджета
  const keys = t.budget.rows.map((r) => r.key.split('.')[1]);
  assert.equal(keys.indexOf('st_kq1'), keys.indexOf('st_kz') + 1);
  assert.ok(Math.abs(t.ucPct - din.ucPct) < 1e-12);
  assert.equal(t.flags.unc_kv_kq, 'warn');
  assert.ok(t.messages.some((m) => /u_c занижена/.test(m.text)));
  assert.match(t.budget.template.note, /Камера откалибрована только в ⁶⁰Co, k_Q = 1/);
  // своя оценка входит в u_c
  const own = tool({ unc_kv_kq: 'one', unc_over: JSON.stringify({ 't33ndw.st_kq1': '3' }) });
  assert.ok(Math.abs(own.ucPct - Math.hypot(din.ucPct, 3)) < 1e-12);
  assert.ok(own.messages.some((m) => /u_c включает вашу оценку/.test(m.text)));
  // без Qo = ⁶⁰Co выбор не действует
  for (const o of [{ unc_kv_qo: 'kv' }, { unc_kv_range: 'low' }, { unc_kv_cal: 'nk' }]) {
    const x = tool({ unc_kv_kq: 'one', ...o });
    assert.ok(!x.budget.rows.some((r) => r.key.endsWith('.st_kq1')));
    assert.equal(x.flags.unc_kv_kq, undefined);
  }
});

test('по-английски: замечания и строки варианта k_Q = 1 без кириллицы', () => {
  setLang('en');
  try {
    const r = run({ kv_kv: '120', kv_hvl: '0,222', kv_env_T: '22,6', kv_env_P: '1007,5' });
    const t = computeUncertaintyTool({ ...UT_DEFAULTS, unc_beam_type: 'kv', unc_kv_range: 'medium', unc_kv_qo: 'co60', unc_kv_kq: 'one' });
    const texts = [
      ...r.notRev1, ...r.messages.map((m) => m.text), ...r.compliance.reasons.map((x) => x.text), r.compare.reason,
      t.budget.template.note, ...t.budget.rows.flatMap((x) => [x.label, x.how]), ...t.messages.map((m) => m.text),
    ];
    for (const s of texts) assert.ok(!/[А-Яа-яЁё]/.test(s), s);
  } finally {
    setLang('ru');
  }
});
