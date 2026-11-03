// Лист «Сводка и протокол» вкладки kV-рентген (0.45.0): строки проверки радиационного выхода (база, измерение,
// отклонение D/D_баз − 1, допуск и решение о калибровке), таблица мощности дозы «аппликатор × режим» по диапазонам и
// глубинам (как форма «Сводная»), условия измерения и итоги листов СПО, таймера, линейности и воспроизводимости.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKvVisit, computeKvVisit, newKvMode } from '../src/core/kv-session.js';
import { SAMPLE_KV, SAMPLE_KV_ROWS, SAMPLE_KV_MODE2 } from '../src/core/sample-kv.js';
import { kvOutputRows, kvDoseMatrix, kvClimate, kvSheetChecks } from '../src/core/kv-summary.js';

const sampleVisit = () => {
  const v = normalizeKvVisit({ form: SAMPLE_KV, rows: [SAMPLE_KV, ...SAMPLE_KV_ROWS], active: 0 });
  const m2 = newKvMode(v.modes[0]);
  Object.assign(m2.shared, SAMPLE_KV_MODE2.shared);
  m2.rows = SAMPLE_KV_MODE2.rows.map((r) => ({ ...r }));
  v.modes.push(m2);
  return normalizeKvVisit(v);
};
const D = (r) => (r.trs.ctrl && !r.trs.ctrl.blocked ? r.trs.ctrl : r.trs).perUnit;
const ru = (x) => String(x).replace('.', ',');

test('проверка выхода: все измеренные строки по порядку, D и отклонение — как в сводке по режимам, решение по допуску', () => {
  const v = sampleVisit();
  const vr = computeKvVisit(v);
  const rows = kvOutputRows(v, vr);
  assert.deepEqual(rows.map((r) => [r.m, r.i, r.label, r.ssd, r.std, r.where, r.verdict]), [
    [0, 0, 'Ø 10 см', '50', true, 'zref', 'ok'],
    [0, 1, '6 × 8 см', '50', false, 'zref', 'ok'],
    [0, 2, 'Ø 15 см', '50', false, 'zref', 'ok'],
    [1, 0, 'Ø 10 см', '50', true, 'zref', 'ok'],
    [1, 1, '6 × 8 см', '50', false, 'zref', 'ok'],
  ]);
  for (const r of rows) {
    const res = vr.modes[r.m].results[r.i];
    assert.equal(r.D, D(res));
    assert.equal(r.base, res.cmp.ref);
    assert.ok(Math.abs(r.dev - (r.D / r.base - 1) * 100) < 1e-9);
    assert.equal(r.tol, 2);
    assert.equal(r.unit, 'Гр/мин');
  }
});

test('проверка выхода: больше допуска — калибровка, без базы, база на поверхности без PDD, ошибка, строки без показаний', () => {
  const v = sampleVisit();
  const vr0 = computeKvVisit(v);
  const d0 = D(vr0.modes[0].results[1]);
  // база на 3 % ниже измеренного — больше допуска ±2 %, при допуске 3,5 % — в допуске
  v.modes[0].rows[1].kv_ref = ru((d0 / 1.03).toFixed(4));
  v.modes[0].rows[2].kv_ref = '';
  v.modes[1].rows[0].kv_M1 = ['abc'];
  v.modes[1].rows.push({ ...v.modes[1].rows[1], kv_M1: ['', '', ''], kv_ref: '' });
  let rows = kvOutputRows(v, computeKvVisit(v));
  assert.deepEqual(rows.map((r) => r.verdict), ['ok', 'over', 'nobase', 'error', 'ok']);
  const over = rows[1];
  assert.ok(over.dev > 2.9 && over.dev < 3.1, String(over.dev));
  assert.ok(Number.isNaN(rows[3].D));
  v.common.kv_tol = '3,5';
  rows = kvOutputRows(v, computeKvVisit(v));
  assert.equal(rows[1].verdict, 'ok');
  assert.equal(rows[1].tol, 3.5);
  // база на поверхности: с PDD — сравнение на поверхности, без PDD — сравнить не с чем
  v.modes[0].shared.kv_ref_at = 'surface';
  v.modes[0].rows[0].kv_ref = '1,1300';
  v.modes[0].rows[1].kv_pdd2 = '';
  rows = kvOutputRows(v, computeKvVisit(v));
  assert.equal(rows[0].where, 'surface');
  assert.equal(rows[0].D, rows[0].perUnitSurf);
  assert.equal(rows[0].verdict, 'ok');
  assert.equal(rows[1].where, 'zref');
  assert.equal(rows[1].verdict, 'na');
});

test('«Сводная»: аппликатор × режим, средние энергии на 2 г/см² и на поверхности, низкие — на поверхности', () => {
  const v = sampleVisit();
  let vr = computeKvVisit(v);
  let blocks = kvDoseMatrix(v, vr);
  assert.deepEqual(blocks.map((b) => [b.range, b.at, b.modes, b.unit, b.apps.map((a) => a.label)]), [
    ['medium', 'zref', [0, 1], 'Гр/мин', ['Ø 10 см', '6 × 8 см', 'Ø 15 см']],
    ['medium', 'surface', [0, 1], 'Гр/мин', ['Ø 10 см', '6 × 8 см', 'Ø 15 см']],
  ]);
  const [z, s] = blocks;
  const k15 = z.apps[2].key;
  assert.equal(z.cells[`1|${k15}`], undefined);
  const c = z.cells[`0|${z.apps[0].key}`];
  assert.equal(c.D, D(vr.modes[0].results[0]));
  assert.equal(c.verdict, 'ok');
  // на поверхности — доза по PDD, без отклонения (значение для сравнения задано на 2 г/см²)
  const cs = s.cells[`0|${s.apps[0].key}`];
  assert.ok(cs.D > c.D);
  assert.ok(Number.isNaN(cs.dev));
  assert.equal(cs.verdict, '');
  // режим низких энергий в секундах: отдельный блок «на поверхности», единица — по режиму
  const m3 = newKvMode(v.modes[1]);
  Object.assign(m3.shared, { kv_range: 'low', kv_kv: '50', kv_hvl: '1,0' });
  for (const r of m3.rows) r.kv_M1 = ['1,0', '1,0', '1,0'];
  v.modes.push(m3);
  vr = computeKvVisit(v);
  blocks = kvDoseMatrix(v, vr);
  assert.deepEqual(blocks.map((b) => [b.range, b.at]), [['low', 'surface'], ['medium', 'zref'], ['medium', 'surface']]);
  // без PDD у всех строк средних энергий — блока «на поверхности» нет
  for (const md of v.modes) for (const r of md.rows) r.kv_pdd2 = '';
  blocks = kvDoseMatrix(v, computeKvVisit(v));
  assert.deepEqual(blocks.map((b) => [b.range, b.at]), [['low', 'surface'], ['medium', 'zref']]);
});

test('условия измерения и итоги листов для протокола', () => {
  const v = sampleVisit();
  const vr = computeKvVisit(v);
  const cl = kvClimate(v);
  assert.deepEqual([cl.T.min, cl.T.max, cl.H.min, cl.H.max, cl.P.min, cl.P.max, cl.pUnit], [21, 21.8, 44, 45, 100.4, 100.5, 'kPa']);
  const ch = kvSheetChecks(v, vr);
  assert.deepEqual(ch.hvl.map((h) => [h.m, h.ok, h.apply, h.nominal]), [[0, true, true, '1,00'], [1, true, true, '0,50']]);
  // ошибка таймера — своя только у режима 1 (режим 2 берёт τ из режима 1)
  assert.deepEqual(ch.timer.map((t) => [t.m, t.tol, t.inTol, t.ok]), [[0, 3, true, true]]);
  assert.deepEqual(ch.ln.map((a) => [a.m, a.ok, a.q, a.dOver, a.clOver]), [[0, true, [0.5, 1, 2], false, false], [1, true, [0.5, 1, 2], false, false]]);
  assert.deepEqual(ch.rp.map((b) => [b.m, b.ok, b.n, b.over]), [[0, true, 5, false], [1, true, 5, false]]);
  assert.deepEqual(ch.output, { n: 5, ok: 5, over: 0, nobase: 0, na: 0, error: 0 });
  // допуски строже — вне допуска
  Object.assign(v.common, { kv_ln_tol: '1', kv_ln_cl_tol: '0,005', kv_rp_tol: '0,1', kv_tau_tol: '0,5' });
  const ch2 = kvSheetChecks(v, computeKvVisit(v));
  assert.deepEqual(ch2.ln.map((a) => [a.dOver, a.clOver]), [[true, true], [true, true]]);
  assert.deepEqual(ch2.rp.map((b) => b.over), [true, true]);
  assert.deepEqual(ch2.timer.map((t) => t.inTol), [false]);
  assert.deepEqual(ch2.lnTol, { d: 1, cl: 0.005 });
});
