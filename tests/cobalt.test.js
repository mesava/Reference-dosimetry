// ⁶⁰Co: сверка расчёта с ручным вычислением по формулам TRS-398 (гл. 5) и TG-51.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCobalt, timerError, timerErrorMultiple, normalizeCobalt, decayFactor, CO60_HALF_LIFE_DAYS } from '../src/core/cobalt.js';
import { SAMPLE_COBALT } from '../src/core/sample-cobalt.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const errorsOf = (r) => r.messages.filter((m) => m.level === 'error');

/** Оба протокола на одних данных: расчёты по TRS-398 и по TG-51 по отдельности (режима «оба» в калькуляторе нет). */
const both = (compute, form) => {
  const a = compute({ ...form, protocol: 'trs' });
  const b = compute({ ...form, protocol: 'tg51' });
  return { ...a, tg51: b.tg51, messages: [...a.messages, ...b.messages], flags: { ...b.flags, ...a.flags } };
};

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
  const r = both(computeCobalt, { ...SAMPLE_COBALT, co_zref: '10', co_rec_trs: 'eq16', co_pdd: '55,6' });
  near(r.trs.ks, r.tg51.Pion, 1e-12);
  const n = 3;
  near(r.tg51.Pion, (1 - n * n) / (r.inputs.ratio12 - n * n), 1e-12);
});

test('TG-51 на глубине 5 см — предупреждение', () => {
  const r = computeCobalt({ ...SAMPLE_COBALT, protocol: 'tg51' });
  assert.equal(r.flags.co_zref, 'warn');
  const r10 = computeCobalt({ ...SAMPLE_COBALT, protocol: 'tg51', co_zref: '10', co_pdd: '55,6' });
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
  const flat = computeCobalt({ ...SAMPLE_COBALT, co_ref_date: '', co_act_date: '' });
  assert.equal(flat.depth.expected, 148.6);
  // старое поле co_expected переносится
  assert.equal(normalizeCobalt({ co_expected: '150' }).co_ref_rate, '150');
});

test('Ошибка таймера: одно облучение t против n облучений по t/n', () => {
  // Ṁ = 25 нКл/мин, τ = 0,02 мин: M₁ = 25·(1 + 0,02), M₅ = 25·(1 + 5·0,02)
  const r = timerErrorMultiple(1, 5, 25 * 1.02, 25 * 1.1);
  near(r.tau, 0.02, 1e-12);
  assert.ok(timerErrorMultiple(1, 1, 25, 25).error, 'n ≥ 2');
  const f = computeCobalt({ ...SAMPLE_COBALT, co_timer_mode: 'nexp', co_nx_t: '1', co_nx_n: '5', co_nx_M1: ['25,50', '25,50', '25,50'], co_nx_Mn: ['27,50', '27,50', '27,50'] });
  near(f.timer.tau, (1 * (27.5 - 25.5)) / (5 * 25.5 - 27.5), 1e-12);
  assert.deepEqual(errorsOf(f), []);
});

test('Заряд на интервале внутри облучения: τ не учитывается', () => {
  const w = computeCobalt({ ...SAMPLE_COBALT, co_timer_mode: 'window' });
  assert.equal(w.timer.tau, 0);
  near(w.trs.rate, (w.trs.D / 1) * 100, 1e-12);
  assert.equal(w.flags.co_timer_mode, undefined, 'без предупреждения «не учтена»');
});

test('Контрольные измерения: поправки из основных серий, итог по контрольным показаниям', () => {
  const r = computeCobalt(SAMPLE_COBALT);
  assert.ok(r.ctrl.on && r.trs.ctrl.ok && !r.trs.ctrl.blocked);
  const product = r.trs.M / Math.abs(r.inputs.M1.mean);
  const mc = mean([25.61, 25.6, 25.61]);
  near(r.trs.ctrl.M, mc * product, 1e-12);
  near(r.trs.ctrl.rate, (mc * product * 0.04523 / (1 + r.timer.tau)) * 100, 1e-9);
  // ошибка в контрольных измерениях не блокирует основной результат
  const bad = computeCobalt({ ...SAMPLE_COBALT, co_Mc: ['25,6', '', 'abc'] });
  assert.ok(bad.trs.ctrl.blocked && !bad.trs.blocked);
  // без контрольных показаний раздела нет
  assert.ok(!computeCobalt({ ...SAMPLE_COBALT, co_Mc: ['', '', ''] }).ctrl.on);
});

test('Активность источника на дату измерения; сравнение от даты установки', () => {
  const r = computeCobalt(SAMPLE_COBALT);
  const days = (Date.parse('2026-09-15') - Date.parse('2024-02-12')) / 86400000;
  near(r.source.A, 10500 * Math.pow(2, -days / CO60_HALF_LIFE_DAYS), 1e-9);
  near(r.source.ATBq, r.source.A * 0.037, 1e-9);
  const fromInstall = computeCobalt({ ...SAMPLE_COBALT, co_ref_rate: '160', co_ref_date: '' });
  near(fromInstall.depth.expected, 160 * Math.pow(2, -days / CO60_HALF_LIFE_DAYS), 1e-9);
  assert.ok(fromInstall.depth.refDateFromSource);
});

test('Установка по РИК: пересчёт на z_max через TMR или через PDD при РИП = РИК − z_ref', () => {
  const sad = { ...SAMPLE_COBALT, co_geometry: 'SAD', co_distance: '80', co_tmr: '0,904' };
  const t = computeCobalt(sad);
  near(t.trs.rateMax, t.trs.rate / 0.904, 1e-12);
  const p = computeCobalt({ ...sad, co_dd_sad: 'pdd', co_pdd: '76,0' });
  near(p.trs.rateMax, p.trs.rate / 0.76, 1e-12);
  assert.equal(p.depth.pddSsd, 75);
  assert.match(p.depth.label, /РИП 75 см/);
});

test('Камера из списка; старое текстовое название переносится', () => {
  assert.equal(normalizeCobalt({ co_ch_model: 'NE 2571' }).co_ch_model, 'NE2571');
  const pp = normalizeCobalt({ co_ch_model: 'PTW 34001 Roos' });
  assert.equal(pp.co_ch_model, 'PP:ROOS');
  const unknown = normalizeCobalt({ co_ch_model: 'Самодельная 1', co_ch_type: 'pp' });
  assert.equal(unknown.co_ch_model, 'CUSTOM');
  assert.equal(unknown.co_cc_model, 'Самодельная 1');
  assert.equal(unknown.co_cc_type, 'pp');
  const r = computeCobalt({ ...SAMPLE_COBALT, co_ch_model: 'PP:ROOS' });
  assert.equal(r.chamber.type, 'pp');
  assert.ok(computeCobalt({ ...SAMPLE_COBALT, co_ch_model: '' }).flags.co_ch_model === 'error');
});

test('Влажность и температура: вне 20–80 % и 15–25 °C — предупреждение', () => {
  const r = computeCobalt({ ...SAMPLE_COBALT, co_env_H: '85', co_env_T: '26' });
  assert.equal(r.flags.co_env_H, 'warn');
  assert.equal(r.flags.co_env_T, 'warn');
  const ok = computeCobalt({ ...SAMPLE_COBALT, co_env_H: '45' });
  assert.equal(ok.flags.co_env_H, undefined);
  near(ok.inputs.H, 45, 1e-12);
});

test('Проверки по итогам ревью: Mₙ как среднее, t + τ контрольных ≤ 0, изменение при ошибках', () => {
  const avg = computeCobalt({ ...SAMPLE_COBALT, co_timer_mode: 'nexp', co_nx_t: '1', co_nx_n: '5', co_nx_M1: ['25,5'], co_nx_Mn: ['5,2'] });
  assert.equal(avg.flags.co_nx_Mn, 'error', 'Mₙ введено как среднее за одно облучение');
  const neg = computeCobalt({ ...SAMPLE_COBALT, co_timer_mode: 'manual', co_tau: '-0,02', co_ctrl_time: '0,01' });
  assert.equal(neg.flags.co_ctrl_time, 'error');
  assert.ok(neg.trs.ctrl.blocked && !neg.trs.blocked);
  const pol = computeCobalt({ ...SAMPLE_COBALT, co_Mc: ['-25,6', '-25,6'] });
  assert.equal(pol.ctrl.changePct, undefined);
  // результат по контрольным не показывается, если заблокирован основной
  const blocked = computeCobalt({ ...SAMPLE_COBALT, co_ndw: '' });
  assert.ok(blocked.trs.blocked && blocked.trs.ctrl.blocked);
});

test('⁶⁰Co: доза за облучение в сГр; значение для сравнения на z_max или на опорной глубине', () => {
  const r = computeCobalt(SAMPLE_COBALT);
  assert.equal(r.depth.expectedAt, 'zmax');
  near(r.trs.DcGy, r.trs.D * 100, 1e-12);
  const ref = computeCobalt({ ...SAMPLE_COBALT, co_ref_at: 'zref', co_ref_rate: '120' });
  assert.equal(ref.depth.expectedAt, 'zref');
  near(ref.trs.deviation, (ref.trs.rate / ref.depth.expected - 1) * 100, 1e-9);
  const off = computeCobalt({ ...SAMPLE_COBALT, co_dd_on: false, co_ref_rate: '120' });
  assert.equal(off.depth.expectedAt, 'zref');
  near(off.trs.deviation, (off.trs.rate / off.depth.expected - 1) * 100, 1e-9);
  assert.equal(off.trs.rateMax, undefined);
});
