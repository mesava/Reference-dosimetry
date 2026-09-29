// Проверка отдельных формул на примерах из документов и на тождествах.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, parseSeries, pressureToKPa, ndwToGyPerNC } from '../src/core/units.js';
import { temperaturePressure, polarity } from '../src/core/common.js';
import { pIon, pdd10x, kQ as kQ51 } from '../src/core/tg51.js';
import { ks, KS_COEFFICIENTS, kvolGeneric, tprFromPdd2010 } from '../src/core/trs398.js';
import { parseProfile, kvolFromProfile } from '../src/core/profile.js';
import { findChamber } from '../src/core/chambers.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);

test('Разбор чисел: запятая, точка, минус, экспонента', () => {
  assert.equal(parseNumber('101,325'), 101.325);
  assert.equal(parseNumber('101.325'), 101.325);
  assert.equal(parseNumber('−12,5'), -12.5);
  assert.equal(parseNumber('5,335e-2'), 0.05335);
  assert.equal(parseNumber('5.335E7'), 5.335e7);
  assert.equal(parseNumber('101 325'), 101325);
  assert.ok(Number.isNaN(parseNumber('')));
  assert.ok(Number.isNaN(parseNumber('abc')));
  assert.ok(Number.isNaN(parseNumber('1,2,3')));
});

test('Серия показаний', () => {
  const a = parseSeries('13,17 13,19;13,18');
  assert.equal(a.n, 3);
  near(a.mean, 13.18, 1e-12);
  const b = parseSeries('13.17, 13.19');
  assert.equal(b.n, 2);
  near(b.mean, 13.18, 1e-12);
  assert.ok(parseSeries('13,17 x').error);
  assert.equal(parseSeries('').n, 0);
});

test('Единицы давления и N_D,w', () => {
  near(pressureToKPa(760, 'mmHg'), 101.325, 1e-9);
  near(pressureToKPa(1013.25, 'hPa'), 101.325, 1e-9);
  near(ndwToGyPerNC(5.335e7, 'Gy/C'), 0.05335, 1e-15);
  near(ndwToGyPerNC(5.335, 'cGy/nC'), 0.05335, 1e-15);
});

test('P_TP (TG-51): тождества', () => {
  near(temperaturePressure({ T: 22, P: 101.33, T0: 22, P0: 101.33, abs0: 273.2 }), 1, 1e-12);
  // (273,2 + 20)/295,2 · 101,33/100 = 1,006435
  near(temperaturePressure({ T: 20, P: 100, T0: 22, P0: 101.33, abs0: 273.2 }), 1.006435, 5e-7);
});

test('k_TP (TRS-398): стандартные условия дают 1', () => {
  near(temperaturePressure({ T: 20, P: 101.325, T0: 20, P0: 101.325, abs0: 273.15 }), 1, 1e-12);
});

test('Полярность: знаки показаний не влияют', () => {
  near(polarity(12.0, -12.1), (12 + 12.1) / 24, 1e-15);
  near(polarity(-12.0, 12.1), (12 + 12.1) / 24, 1e-15);
  near(polarity(12.0, 12.1), (12 + 12.1) / 24, 1e-15);
});

test('P_ion по ур. (12) и (11) TG-51', () => {
  // n = 2, M_H/M_L = 1,003 → (1 − 2)/(1,003 − 2) = 1,003009
  near(pIon({ mH: 1.003, mL: 1, vH: 300, vL: 150 }), 1 / 0.997, 1e-12);
  near(pIon({ mH: 1, mL: 1, vH: 300, vL: 100 }), 1, 1e-12);
  // непрерывный пучок, n = 2: (1 − 4)/(1,001 − 4)
  near(pIon({ mH: 1.001, mL: 1, vH: 300, vL: 150, beam: 'continuous' }), -3 / (1.001 - 4), 1e-12);
});

test('k_s по ур. (13): при M1 = M2 табл. 10 даёт ≈ 1', () => {
  // Аппроксимации табл. 10 не проходят точно через 1: сумма коэффициентов
  // 1,000–1,001 для импульсного и 1,002–1,003 для импульсно-сканирующего пучка.
  const tol = { pulsed: 0.0011, scanned: 0.0031 };
  for (const beam of ['pulsed', 'scanned']) {
    for (const [n, [a0, a1, a2]] of Object.entries(KS_COEFFICIENTS[beam])) {
      near(a0 + a1 + a2, 1, tol[beam], `${beam} n=${n}: сумма коэффициентов`);
    }
  }
});

test('k_s: ур. (13) и ур. (14) согласуются в пределах 0,1 % при k_s < 1,03 (импульсный пучок)', () => {
  for (const n of [2, 2.5, 3, 3.5, 4, 5]) {
    for (const r of [1.001, 1.005, 1.01, 1.02]) {
      const eq13 = ks({ m1: r, m2: 1, v1: 300, v2: 300 / n }).value;
      const eq14 = 1 + (r - 1) / (n - 1);
      if (eq14 < 1.03) near(eq13, eq14, 0.001, `n=${n}, M1/M2=${r}`);
    }
  }
  const off = ks({ m1: 1.004, m2: 1, v1: 300, v2: 130 });
  assert.match(off.equation, /ур\. \(14\)/);
  near(off.value, 1 + 0.004 / (300 / 130 - 1), 1e-12);
  assert.ok(ks({ m1: 1.004, m2: 1, v1: 300, v2: 130, beam: 'scanned' }).error);
});

test('TG-51 P_ion и TRS-398 k_s близки для одних и тех же показаний', () => {
  const r = 1.0035;
  const p = pIon({ mH: r, mL: 1, vH: 300, vL: 100 });
  const k = ks({ m1: r, m2: 1, v1: 300, v2: 100 }).value;
  near(p, k, 0.0005);
});

test('%dd(10)x: уравнения (13)–(15) и пороги', () => {
  near(pdd10x({ method: 'foil50', pdd10Pb: 73 }).value, 73, 1e-9);
  near(pdd10x({ method: 'foil50', pdd10Pb: 72.9 }).value, 72.9, 1e-12);
  near(pdd10x({ method: 'foil50', pdd10Pb: 80 }).value, (0.8905 + 0.0015 * 80) * 80, 1e-12);
  near(pdd10x({ method: 'foil30', pdd10Pb: 71 }).value, 70.932, 1e-3);
  near(pdd10x({ method: 'foil30', pdd10Pb: 70.9 }).value, 70.9, 1e-12);
  near(pdd10x({ method: 'interim', pdd10: 75 }).value, 75, 1e-12);
  near(pdd10x({ method: 'interim', pdd10: 89 }).value, 92.763, 1e-9);
  assert.ok(pdd10x({ method: 'interim', pdd10: 89.1 }).error);
  assert.ok(pdd10x({ method: 'open', pdd10: 75.1 }).error);
  near(pdd10x({ method: 'open', pdd10: 66.2 }).value, 66.2, 1e-12);
});

test('Halcyon 6 МВ БВФ (Lloyd et al. 2018): k_Q для PTW 30013', () => {
  const c = findChamber('PTW30013');
  // с фольгой в 30 см: %dd(10)Pb = 63,6 < 71 → %dd(10)x = 63,6 → k_Q = 0,995
  const x = pdd10x({ method: 'foil30', pdd10Pb: 63.6 }).value;
  assert.equal(x, 63.6);
  assert.equal(Number(kQ51(c, x).value.toFixed(3)), 0.995);
  // без фольги: 62,9 — ниже диапазона аппроксимации, интерполяция к ⁶⁰Co → 0,996
  assert.equal(Number(kQ51(c, 62.9).value.toFixed(3)), 0.996);
  near(kQ51(c, 62.9).value, 1 + ((62.9 - 58) / 5) * (0.996 - 1), 1e-12);
  // PinPoint, значение с рис. 3: 63,2 → 0,996
  assert.equal(Number(kQ51(c, 63.2).value.toFixed(3)), 0.996);
});

test('TPR20,10 по PDD20,10 (сноска 36 TRS-398)', () => {
  near(tprFromPdd2010(0.58), 1.2661 * 0.58 - 0.0595, 1e-15);
});

test('k_vol по ур. (22) и табл. 11 TRS-398: расхождение не больше 0,001', () => {
  const tpr = [0.6, 0.63, 0.66, 0.69, 0.72, 0.75];
  const table = {
    0.5: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    1.0: [1.0, 1.0, 1.0, 1.001, 1.001, 1.001],
    1.5: [1.0, 1.001, 1.001, 1.001, 1.002, 1.002],
    2.0: [1.0, 1.001, 1.002, 1.002, 1.003, 1.004],
    2.5: [1.001, 1.002, 1.003, 1.004, 1.005, 1.006],
  };
  for (const [L, row] of Object.entries(table)) {
    row.forEach((v, i) => near(kvolGeneric({ tpr: tpr[i], lengthCm: Number(L), sddCm: 110 }), v, 0.001, `L=${L}, TPR=${tpr[i]}`));
  }
});

test('k_vol по профилю: плоский профиль даёт 1, парабола — аналитический ответ', () => {
  const flat = parseProfile(Array.from({ length: 41 }, (_, i) => `${i - 20} 100`).join('\n'));
  near(kvolFromProfile(flat.points, 23).value, 1, 1e-12);
  // OAR = 1 − c·y², среднее по [−L/2, L/2] = 1 − c·L²/12
  const c = 2e-5;
  const pts = Array.from({ length: 401 }, (_, i) => {
    const y = -20 + i * 0.1;
    return `${y.toFixed(1).replace('.', ',')}\t${(1 - c * y * y).toFixed(9)}`;
  }).join('\n');
  const prof = parseProfile(pts);
  assert.equal(prof.error, null);
  const L = 23;
  near(kvolFromProfile(prof.points, L).value, 1 / (1 - (c * L * L) / 12), 1e-6);
  assert.ok(kvolFromProfile(prof.points, 50).error, 'профиль короче камеры');
});

test('Разбор профиля: заголовок пропускается, повторы запрещены', () => {
  assert.equal(parseProfile('x y\n-1 1\n0 1\n1 1').points.length, 3);
  assert.ok(parseProfile('-1 1\n-1 1\n0 1').error);
});
