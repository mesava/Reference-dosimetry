// Брахитерапия: бюджет неопределённости ОМВК — TRS-492, табл. 10 (колодезная камера) и Ubrich 2014 (фантом PTW 9193).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wellBudget, phantomBudget, WELL_UNC_ROWS, certAgreement } from '../src/core/brachy-unc.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const val = (b, key) => b.rows.find((r) => r.key === key)?.value;

test('Колодезная камера: сценарии TRS-492, табл. 10 — u_c 0,8 % и 2,8 %, U 1,7 % и 5,7 % (с округлением таблицы)', () => {
  const s1 = wellBudget({ ksmMode: 'same' });
  assert.equal(s1.rows.length, WELL_UNC_ROWS.length);
  near(s1.uc, 0.8, 0.005);
  near(s1.U, 1.7, 0.1);
  const s2 = wellBudget({ scenario: '2', ksmMode: 'none' });
  near(s2.uc, 2.8, 0.07);
  near(s2.U, 5.7, 0.05);
  assert.equal(val(s2, 'ksm'), 2);
  assert.equal(val(wellBudget({ ksmMode: 'table' }), 'ksm'), 0.2);
  assert.equal(val(s1, 'ksm'), 0);
});

test('Колодезная камера: U(N) из сертификата, тип А серии, свои значения строк', () => {
  const b = wellBudget({ ksmMode: 'same', NU: 1.5, readings: { n: 4, relSd: 0.6 } });
  near(val(b, 'cal'), 0.75, 1e-12);
  near(val(b, 'current'), 0.3, 1e-12); // 0,6/√4 больше типовых 0,1
  assert.equal(val(wellBudget({ ksmMode: 'same', readings: { n: 5, relSd: 0.1 } }), 'current'), 0.1);
  const o = wellBudget({ ksmMode: 'same', over: JSON.stringify({ setup: '0,5', hum: '0' }) });
  assert.equal(val(o, 'setup'), 0.5);
  assert.equal(val(o, 'hum'), 0);
  assert.ok(o.rows.find((r) => r.key === 'setup').own);
  near(o.uc, Math.sqrt(0.7 ** 2 + 0.1 ** 2 + 0.1 ** 2 + 0.5 ** 2 + 0.1 ** 2 + 0.2 ** 2), 1e-12);
});

test('Фантом PTW 9193: множитель по Ubrich 2014 (МК 0,9 %, PTB 2,7 %, DGMP 5,8 %), свой k_tot, нет данных для Azhari', () => {
  const mc = phantomBudget({ mainId: 'ubrich-mc-30016', nuclide: 'Co-60' });
  assert.deepEqual(mc.rows.map((r) => r.key), ['ndw', 'factor', 'reading', 'tp']);
  near(mc.uc, Math.sqrt(0.55 ** 2 + 0.45 ** 2 + 0.45 ** 2 + 0.2 ** 2), 1e-12);
  near(val(phantomBudget({ mainId: 'ubrich-ptb-30016', nuclide: 'Co-60' }), 'factor'), 1.35, 1e-12);
  near(val(phantomBudget({ mainId: 'dgmp', nuclide: 'Ir-192', NU: 2 }), 'factor'), 2.9, 1e-12);
  assert.equal(val(phantomBudget({ mainId: 'dgmp', nuclide: 'Ir-192', NU: 2 }), 'ndw'), 1);
  // свой k_tot: N сокращается, множитель — u_c колодезной камеры
  const own = phantomBudget({ mainId: 'own', nuclide: 'Co-60', wellUc: 0.8 });
  assert.equal(val(own, 'ndw'), 0);
  assert.equal(val(own, 'factor'), 0.8);
  // постоянные ⁶⁰Co по Azhari и k_A — неопределённость не опубликована: строка без значения и предупреждение
  const az = phantomBudget({ mainId: 'dgmp-ka', nuclide: 'Co-60', kA: 1.0267 });
  assert.equal(az.complete, false);
  assert.ok(Number.isNaN(val(az, 'factor')));
  assert.ok(az.rows.some((r) => r.key === 'ka'));
  assert.equal(az.messages.length, 1);
  const filled = phantomBudget({ mainId: 'dgmp-ka', nuclide: 'Co-60', kA: 1.0267, over: { factor: '3', ka: '0,5' } });
  assert.equal(filled.complete, true);
  // разброс положений: тип А больше типового 0,45 %
  const h = phantomBudget({ mainId: 'ubrich-mc-30016', nuclide: 'Co-60', holes: [{ corr: 1 }, { corr: 1.02 }, { corr: 0.98 }, { corr: 1 }] });
  near(val(h, 'reading'), (Math.sqrt(0.0008 / 3) * 100) / 2, 1e-9);
});

test('Согласие с сертификатом при k = 2 (TRS-492, разд. 8.6.2.1): пересчёт U сертификата, предел, типичные 5 % при k = 3', () => {
  // U сертификата 3 % при k = 2, U измерения 4 %: предел √(9 + 16) = 5 %
  const a = certAgreement({ dev: 4.9, Umeas: 4, Ucert: 3, kCert: 2 });
  assert.ok(a.ok && a.pass && !a.typical);
  assert.ok(Math.abs(a.limit - 5) < 1e-12);
  assert.ok(!certAgreement({ dev: -5.1, Umeas: 4, Ucert: 3, kCert: 2 }).pass);
  // U = 4,5 % при k = 3 → 3 % при k = 2
  assert.ok(Math.abs(certAgreement({ dev: 0, Umeas: 4, Ucert: 4.5, kCert: 3 }).Ucert2 - 3) < 1e-12);
  // пусто — типичные 5 % при k = 3, т. е. 3,33 % при k = 2
  const t = certAgreement({ dev: 1, Umeas: 2.5 });
  assert.ok(t.typical);
  assert.ok(Math.abs(t.Ucert2 - 10 / 3) < 1e-12);
  assert.ok(Math.abs(t.limit - Math.sqrt((10 / 3) ** 2 + 2.5 ** 2)) < 1e-12);
  // нет отклонения — проверки нет
  assert.ok(!certAgreement({ dev: NaN, Umeas: 2 }).ok);
});
