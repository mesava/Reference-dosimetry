// Электроны: сверка таблиц TRS-398 и аппроксимаций Report 385, ручной расчёт по формулам протоколов.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E_CHAMBERS, E_NODES, findEChamber, interpE, kQprime385, trsFit } from '../src/core/electron-chambers.js';
import { computeElectrons, r50FromI50, zrefFromR50, parseElectronBeam, positions } from '../src/core/electrons.js';
import { SAMPLE_ELECTRONS } from '../src/core/sample-electrons.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const errorsOf = (r, scope) => r.messages.filter((m) => m.level === 'error' && (!scope || m.scope === scope || m.scope === 'common'));

test('TRS-398 табл. 20 / табл. 21: отношение постоянно для каждой камеры (k_Qint)', () => {
  // Известная особенность: PTW 30013 при R50 = 3,0 — отношение выпадает на 0,04 % (см. docs/electrons.md).
  const known = { PTW30013: [4] };
  for (const c of E_CHAMBERS.filter((x) => x.trsT20 && x.trsT21)) {
    const ratios = E_NODES.map((_, i) => (c.trsT20[i] == null || known[c.id]?.includes(i) ? null : c.trsT20[i] / c.trsT21[i])).filter((x) => x != null);
    const spread = Math.max(...ratios) - Math.min(...ratios);
    assert.ok(spread < 2e-4, `${c.id}: разброс k_Q/k_Q,Qint ${spread}`);
  }
  const p = findEChamber('PTW30013');
  near(p.trsT20[4] / p.trsT21[4] - p.trsT20[5] / p.trsT21[5], 0.0004, 1e-4, 'выпадающее значение PTW 30013 при 3,0');
});

test('TRS-398 табл. 21: k_Q,Qint = 1 при R50 = 7,5 г/см²', () => {
  for (const c of E_CHAMBERS.filter((x) => x.trsT21)) {
    near(interpE(c.trsT21, 7.5).value, 1, 1e-3, c.id);
    // значения убывают с ростом R50
    const v = c.trsT21.filter((x) => x != null);
    for (let i = 1; i < v.length; i++) assert.ok(v[i] < v[i - 1], `${c.id}: не убывает в узле ${i}`);
  }
  for (const c of E_CHAMBERS.filter((x) => x.trsT20)) {
    const v = c.trsT20.filter((x) => x != null);
    for (let i = 1; i < v.length; i++) assert.ok(v[i] < v[i - 1], `${c.id} (табл. 20): не убывает в узле ${i}`);
  }
});

test('Report 385: k′_Q = 1 при R50 = 7,5 см (Q_ecal) для всех камер', () => {
  for (const c of E_CHAMBERS.filter((x) => x.r385)) near(kQprime385(c, 7.5), 1, 2e-3, c.id);
  // форма аппроксимации: у цилиндрических степенная, у плоскопараллельных экспонента
  near(kQprime385(findEChamber('NE2571'), 4), 0.977 + 0.117 * Math.pow(4, -0.817), 1e-15);
  near(kQprime385(findEChamber('ROOS'), 4), 0.984 + 0.134 * Math.exp(-4 / 3.511), 1e-15);
});

test('R50 по I50 и опорная глубина', () => {
  near(r50FromI50(4.8).value, 1.029 * 4.8 - 0.06, 1e-12);
  near(r50FromI50(11).value, 1.059 * 11 - 0.37, 1e-12);
  near(zrefFromR50(5), 2.9, 1e-12);
  assert.equal(parseElectronBeam('12 МэВ').energy, 12);
  assert.equal(parseElectronBeam('6e').energy, 6);
  assert.equal(parseElectronBeam('Пучок 9').energy, 9);
  assert.ok(Number.isNaN(parseElectronBeam('').energy));
});

test('Положение камеры: TRS-398 со сдвигом 0,5·r_cyl, Report 385 — центр на d_ref', () => {
  const p = positions(findEChamber('NE2571'), 2.9);
  near(p.trs.depth, 2.9 + 0.16, 1e-12);
  near(p.tg51.depth, 2.9, 1e-12);
  const pp = positions(findEChamber('ROOS'), 2.9);
  near(pp.trs.front, 2.9 - 0.132, 1e-12);
  near(pp.tg51.front, 2.9 - 0.16, 1e-12);
});

test('Демо-набор: TRS-398 совпадает с ручным расчётом', () => {
  const r = computeElectrons(SAMPLE_ELECTRONS);
  assert.deepEqual(errorsOf(r), []);
  const R50 = 1.029 * 4.8 - 0.06;
  near(r.quality.r50, R50, 1e-12);
  near(r.quality.zref, 0.6 * R50 - 0.1, 1e-12);
  const M1 = mean([19.86, 19.85, 19.87]);
  const Mopp = mean([19.94, 19.93, 19.95]);
  const M2 = mean([19.77, 19.76, 19.78]);
  const kTP = ((273.15 + 21.4) / 293.15) * (101.325 / 99.62);
  const kpol = (M1 + Mopp) / (2 * M1);
  const q = M1 / M2;
  const ks = 1.198 - 0.875 * q + 0.677 * q * q;
  // табл. 20, PTW 30013: 4,5 → 0,9180; 5,0 → 0,9155
  const kQ = 0.918 + ((R50 - 4.5) / 0.5) * (0.9155 - 0.918);
  near(r.trs.kQ, kQ, 1e-12, 'k_Q');
  const D = M1 * kTP * kpol * ks * kQ * 0.05335;
  near(r.trs.D, D, 1e-12, 'D');
  near(r.trs.DmaxPerMU, (D / 100) * 100 / 0.996, 1e-12, 'сГр/МЕ на z_max');
});

test('TG-51 + Report 385 совпадает с ручным расчётом', () => {
  const r = computeElectrons({ ...SAMPLE_ELECTRONS, protocol: 'tg51' });
  assert.deepEqual(errorsOf(r, 'tg51'), []);
  const R50 = 1.029 * 4.8 - 0.06;
  const kQp = 0.978 + 0.112 * Math.pow(R50, -0.816);
  near(r.tg51.kQprime, kQp, 1e-12);
  near(r.tg51.kQ, kQp * 0.901, 1e-12);
  const M1 = mean([19.86, 19.85, 19.87]);
  const M2 = mean([19.77, 19.76, 19.78]);
  const Mopp = mean([19.94, 19.93, 19.95]);
  const PTP = ((273.2 + 21.4) / 293.2) * (101.325 / 99.62);
  const Pion = (1 - 3) / (M1 / M2 - 3);
  const Ppol = (M1 + Mopp) / (2 * M1);
  near(r.tg51.D, M1 * PTP * Pion * Ppol * kQp * 0.901 * 0.05335, 1e-12);
});

test('Оба протокола, цилиндрическая камера: для TG-51 берётся показание на d_ref', () => {
  const r = computeElectrons({ ...SAMPLE_ELECTRONS, protocol: 'both' });
  assert.ok(r.inputs.separate51);
  const trsOnly = computeElectrons({ ...SAMPLE_ELECTRONS, protocol: 'tg51' });
  near(r.tg51.D / trsOnly.tg51.D, mean([19.88, 19.87, 19.89]) / mean([19.86, 19.85, 19.87]), 1e-12);
  assert.ok(r.comparison);
  const pp = computeElectrons({ ...SAMPLE_ELECTRONS, protocol: 'both', e_ch_model: 'ROOS' });
  assert.ok(!pp.inputs.separate51);
});

test('Перекрёстная калибровка: TRS-398 ур. (44), Report 385 ур. (6)', () => {
  const f = { ...SAMPLE_ELECTRONS, protocol: 'both', e_ch_model: 'ROOS', e_cal_route: 'cross', e_cross_ndw: '0,0801', e_cross_r50: '7,8', e_cross_kn: '0,0720' };
  const r = computeElectrons(f);
  assert.deepEqual(errorsOf(r), []);
  const roos = findEChamber('ROOS');
  const kQ = interpE(roos.trsT21, r.quality.r50).value / interpE(roos.trsT21, 7.8).value;
  near(r.trs.kQ, kQ, 1e-12);
  const Mtrs = r.trs.M;
  near(r.trs.D, Mtrs * kQ * 0.0801, 1e-12);
  near(r.tg51.D, r.tg51.M * kQprime385(roos, r.quality.r50) * 0.072, 1e-12);
  // цилиндрическую камеру Report 385 перекрёстно не калибрует
  const cyl = computeElectrons({ ...f, e_ch_model: 'PTW30013' });
  assert.ok(cyl.tg51.blocked);
});

test('Ограничения: цилиндрическая камера при R50 < 3 (TRS), диапазон Report 385, нет данных табл. 20', () => {
  const low = computeElectrons({ ...SAMPLE_ELECTRONS, protocol: 'both', e_i50: '2,5' });
  assert.ok(low.trs.blocked, 'TRS: цилиндрическая при R50 < 3');
  assert.ok(!low.tg51.blocked, 'Report 385 допускает цилиндрическую камеру во всех пучках');
  const high = computeElectrons({ ...SAMPLE_ELECTRONS, protocol: 'tg51', e_r50_method: 'r50', e_r50: '9,5' });
  assert.ok(high.tg51.blocked);
  const manual = computeElectrons({ ...SAMPLE_ELECTRONS, protocol: 'tg51', e_r50_method: 'r50', e_r50: '9,5', e_kq51_mode: 'manual', e_kq51_manual: '0,905' });
  assert.ok(!manual.tg51.blocked);
  const adv = computeElectrons({ ...SAMPLE_ELECTRONS, e_ch_model: 'ADVMARKUS' });
  assert.ok(adv.trs.blocked, 'для Advanced Markus нет k_Q при калибровке в ⁶⁰Co');
  const p30012 = computeElectrons({ ...SAMPLE_ELECTRONS, protocol: 'tg51', e_ch_model: 'PTW30012' });
  assert.ok(p30012.tg51.blocked, 'PTW 30012 нет в Report 385');
});

test('Полярность: до 2 % — справка, больше — предупреждение', () => {
  const small = computeElectrons({ ...SAMPLE_ELECTRONS, e_Mopp: ['-20,05', '-20,05', '-20,05'] });
  assert.equal(small.flags.kpol, 'info');
  const big = computeElectrons({ ...SAMPLE_ELECTRONS, e_Mopp: ['-20,70', '-20,70', '-20,70'] });
  assert.equal(big.flags.kpol, 'warn');
});

test('Пересчёт на z_max не блокирует дозу на z_ref', () => {
  const r = computeElectrons({ ...SAMPLE_ELECTRONS, e_pdd: '' });
  assert.ok(!r.trs.blocked && Number.isFinite(r.trs.DperMU));
  assert.equal(r.trs.DmaxPerMU, undefined);
});

test('TRS-398 прил. II: аппроксимации (табл. 47–48) воспроизводят табл. 20–21', () => {
  for (const c of E_CHAMBERS) {
    for (const [tab, fit] of [[c.trsT20, c.trsFit20], [c.trsT21, c.trsFit21]]) {
      if (!tab) continue;
      assert.ok(fit, `${c.id}: нет параметров аппроксимации`);
      E_NODES.forEach((x, i) => {
        if (tab[i] == null) return;
        near(trsFit(c, fit, x), tab[i], 1e-3, `${c.id} при R50 = ${x}`);
      });
    }
  }
});

test('Режим «аппроксимация» и сравнение с таблицей', () => {
  const r = computeElectrons({ ...SAMPLE_ELECTRONS, e_kqtrs_mode: 'formula' });
  const c = findEChamber('PTW30013');
  near(r.trs.kQ, 0.888 + 0.101 * Math.pow(r.quality.r50, -0.816), 1e-12);
  near(r.trs.kQDiff, (r.trs.kQTable / r.trs.kQFormula - 1) * 100, 1e-12);
  assert.ok(Math.abs(r.trs.kQDiff) < 0.1);
  assert.ok(c.trsFit20);
});

test('Плоскопараллельная камера, оба протокола: отдельная серия, если положения различаются больше чем на 0,5 мм', () => {
  const roos = computeElectrons({ ...SAMPLE_ELECTRONS, protocol: 'both', e_ch_model: 'ROOS' });
  assert.ok(!roos.inputs.separate51, 'Roos: 1,32 мм против 1,6 мм');
  const a10 = computeElectrons({ ...SAMPLE_ELECTRONS, protocol: 'both', e_ch_model: 'A10', e_kqtrs_mode: 'manual', e_kqtrs_manual: '0,91' });
  assert.ok(a10.inputs.separate51, 'A10: 0,04 мм против 1,5 мм');
});

test('Перекрёстная калибровка: поправки лаборатории для ⁶⁰Co не применяются', () => {
  const f = { ...SAMPLE_ELECTRONS, protocol: 'trs', e_ch_model: 'ROOS', e_cal_route: 'cross', e_cross_ndw: '0,08', e_cross_r50: '7,8' };
  const a = computeElectrons(f);
  const b = computeElectrons({ ...f, e_lab_pol_applied: false, e_lab_kpol: '1,01', e_lab_ks_applied: false, e_lab_ks: '1,01' });
  near(a.trs.D, b.trs.D, 1e-15);
});
