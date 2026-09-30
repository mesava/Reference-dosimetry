// ⁶⁰Co: сверка расчёта с ручным вычислением по формулам TRS-398 (гл. 5) и TG-51.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCobalt, timerError, normalizeCobalt, decayFactor, CO60_HALF_LIFE_DAYS } from '../src/core/cobalt.js';
import { SAMPLE_COBALT } from '../src/core/sample-cobalt.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const errorsOf = (r) => r.messages.filter((m) => m.level === 'error');

test('Ошибка таймера: прямая M = Ṁ·(t + τ)', () => {
  const r = timerError(['0,5', '1', '2'], [25 * 0.52, 25 * 1.02, 25 * 2.02].map(String));
  near(r.tau, 0.02, 1e-12);
  near(r.slope, 25, 1e-12);
  // два облучения — точное решение
  const two = timerError(['1', '3'], ['10,1', '30,1']);
  near(two.tau, 0.01, 1e-12);
  assert.ok(timerError(['1', '1'], ['10', '10']).error);
  assert.ok(timerError(['1'], ['10']).error);
});

test('Демо-набор ⁶⁰Co: TRS-398 совпадает с ручным расчётом', () => {
  const r = computeCobalt(SAMPLE_COBALT);
  assert.deepEqual(errorsOf(r), []);
  const M1 = mean([25.6, 25.61, 25.59]);
  const Mopp = mean([25.58, 25.59, 25.58]);
  const M2 = mean([25.58, 25.59, 25.58]);
  const kTP = ((273.15 + 21) / 293.15) * (101.325 / 100.5);
  const kpol = (M1 + Mopp) / (2 * M1);
  const r12 = M1 / M2;
  const ks = 1.198 - 0.875 * r12 + 0.677 * r12 * r12;
  const D = M1 * kTP * kpol * ks * 0.04523;
  const t = timerError(['0,50', '1,00', '2,00'], ['12,93', '25,60', '50,95']);
  near(r.trs.D, D, 1e-12, 'D за облучение');
  near(r.timer.tau, t.tau, 1e-12);
  near(r.trs.rate, (D / (1 + t.tau)) * 100, 1e-9, 'сГр/мин на z_ref');
  near(r.trs.rateMax, (D / (1 + t.tau)) * 100 / 0.788, 1e-9, 'сГр/мин на z_max');
  near(r.trs.rateMaxGy, D / (1 + t.tau) / 0.788, 1e-12, 'Гр/мин');
  assert.ok(r.trs.rateMax > 140 && r.trs.rateMax < 155);
});

test('TRS-398 ур. (16) совпадает с TG-51 ур. (11) для непрерывного пучка', () => {
  const r = computeCobalt({ ...SAMPLE_COBALT, protocol: 'both', co_zref: '10', co_rec_trs: 'eq16', co_pdd: '55,6' });
  near(r.trs.ks, r.tg51.Pion, 1e-12);
  const n = 3;
  near(r.tg51.Pion, (1 - n * n) / (r.inputs.ratio12 - n * n), 1e-12);
});

test('TG-51 на глубине 5 см — предупреждение', () => {
  const r = computeCobalt({ ...SAMPLE_COBALT, protocol: 'both' });
  assert.equal(r.flags.co_zref, 'warn');
  const r10 = computeCobalt({ ...SAMPLE_COBALT, protocol: 'both', co_zref: '10', co_pdd: '55,6' });
  assert.equal(r10.flags.co_zref, undefined);
});

test('Время в секундах даёт ту же мощность дозы', () => {
  const min = computeCobalt({ ...SAMPLE_COBALT, co_timer_mode: 'manual', co_tau: '0,01' });
  const sec = computeCobalt({ ...SAMPLE_COBALT, co_time: '60', co_time_unit: 's', co_timer_mode: 'manual', co_tau: '0,6' });
  near(sec.trs.rate, min.trs.rate, 1e-9);
});

test('Без учёта таймера — предупреждение; k_s < 1 — ошибка', () => {
  const none = computeCobalt({ ...SAMPLE_COBALT, co_timer_mode: 'none' });
  assert.equal(none.flags.co_timer_mode, 'warn');
  const bad = computeCobalt({ ...SAMPLE_COBALT, co_M2: ['25,70', '25,70', '25,70'] });
  assert.equal(bad.flags.ks, 'error');
  assert.ok(bad.trs.blocked);
});

test('Пересчёт на z_max не блокирует мощность дозы на z_ref', () => {
  const r = computeCobalt({ ...SAMPLE_COBALT, co_pdd: '' });
  assert.ok(!r.trs.blocked && Number.isFinite(r.trs.rate));
  assert.equal(r.trs.rateMax, undefined);
});

test('Нормализация: показания строкой', () => {
  assert.deepEqual(normalizeCobalt({ co_M1: '25,6 25,61' }).co_M1, ['25,6', '25,61']);
});

test('Распад ⁶⁰Co: ожидаемая мощность дозы приводится к дате измерения', () => {
  const half = decayFactor('2020-01-01', new Date(Date.parse('2020-01-01') + CO60_HALF_LIFE_DAYS * 86400000).toISOString().slice(0, 10));
  near(half.factor, 0.5, 2e-4, 'за период полураспада');
  const r = computeCobalt(SAMPLE_COBALT);
  near(r.depth.days, 31, 1e-9);
  near(r.depth.expected, 148.6 * Math.pow(2, -31 / CO60_HALF_LIFE_DAYS), 1e-9);
  near(r.trs.deviation, (r.trs.rateMax / r.depth.expected - 1) * 100, 1e-9);
  // без даты предыдущего значения — сравнение без поправки на распад
  const flat = computeCobalt({ ...SAMPLE_COBALT, co_ref_date: '' });
  assert.equal(flat.depth.expected, 148.6);
  // старое поле co_expected переносится
  assert.equal(normalizeCobalt({ co_expected: '150' }).co_ref_rate, '150');
});
