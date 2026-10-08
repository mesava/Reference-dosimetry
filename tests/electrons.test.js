// Электроны: сверка таблиц TRS-398 и аппроксимаций Report 385, ручной расчёт по формулам протоколов.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E_CHAMBERS, E_NODES, findEChamber, interpE, kQprime385, trsFit } from '../src/core/electron-chambers.js';
import { computeElectrons, r50FromI50, zrefFromR50, parseElectronBeam, positions } from '../src/core/electrons.js';
import { SAMPLE_ELECTRONS } from '../src/core/sample-electrons.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const errorsOf = (r, scope) => r.messages.filter((m) => m.level === 'error' && (!scope || m.scope === scope || m.scope === 'common'));

/** Оба протокола на одних данных: расчёты по TRS-398 и по TG-51 по отдельности (режима «оба» в калькуляторе нет). */
const both = (form) => {
  const a = computeElectrons({ ...form, protocol: 'trs' });
  const b = computeElectrons({ ...form, protocol: 'tg51' });
  return { ...a, tg51: b.tg51, messages: [...a.messages, ...b.messages], flags: { ...b.flags, ...a.flags } };
};

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

test('Перекрёстная калибровка: TRS-398 ур. (44), Report 385 ур. (6)', () => {
  const f = { ...SAMPLE_ELECTRONS, e_ch_model: 'ROOS', e_cal_route: 'cross', e_cross_ndw: '0,0801', e_cross_r50: '7,8', e_cross_kn: '0,0720' };
  const r = both(f);
  assert.deepEqual(errorsOf(r), []);
  const roos = findEChamber('ROOS');
  const kQ = interpE(roos.trsT21, r.quality.r50).value / interpE(roos.trsT21, 7.8).value;
  near(r.trs.kQ, kQ, 1e-12);
  const Mtrs = r.trs.M;
  near(r.trs.D, Mtrs * kQ * 0.0801, 1e-12);
  near(r.tg51.D, r.tg51.M * kQprime385(roos, r.quality.r50) * 0.072, 1e-12);
  // цилиндрическую камеру Report 385 перекрёстно не калибрует
  const cyl = computeElectrons({ ...f, protocol: 'tg51', e_ch_model: 'PTW30013' });
  assert.ok(cyl.tg51.blocked);
});

test('Ограничения: цилиндрическая камера при R50 < 3 (TRS), диапазон Report 385, нет данных табл. 20', () => {
  const low = both({ ...SAMPLE_ELECTRONS, e_i50: '2,5' });
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

test('Перекрёстная калибровка: поправки лаборатории для ⁶⁰Co не применяются', () => {
  const f = { ...SAMPLE_ELECTRONS, protocol: 'trs', e_ch_model: 'ROOS', e_cal_route: 'cross', e_cross_ndw: '0,08', e_cross_r50: '7,8' };
  const a = computeElectrons(f);
  const b = computeElectrons({ ...f, e_lab_pol_applied: false, e_lab_kpol: '1,01', e_lab_ks_applied: false, e_lab_ks: '1,01' });
  near(a.trs.D, b.trs.D, 1e-15);
});

test('Электроны: доза в сГр и Гр; номинальный выход на z_max или на опорной глубине', () => {
  const S = SAMPLE_ELECTRONS;
  const atMax = computeElectrons({ ...S, protocol: 'trs', e_nominal: '1,000', e_nominal_at: 'zmax' });
  const x = atMax.trs;
  assert.equal(atMax.depth.nominalAt, 'zmax');
  near(x.DcGy, x.D * 100, 1e-12);
  near(x.Dmax, x.D / atMax.depth.factor, 1e-12);
  near(x.DmaxcGy, x.Dmax * 100, 1e-12);
  near(x.DmaxPerMU, x.DmaxcGy / parseFloat(S.e_mu), 1e-12);
  near(x.deviation, (x.DmaxPerMU - 1) * 100, 1e-9);
  const atRef = computeElectrons({ ...S, protocol: 'trs', e_nominal: '0,98', e_nominal_at: 'zref' });
  assert.equal(atRef.depth.nominalAt, 'zref');
  near(atRef.trs.deviation, (atRef.trs.DperMU / 0.98 - 1) * 100, 1e-9);
  const off = computeElectrons({ ...S, protocol: 'trs', e_dd_on: false, e_nominal: '0,98' });
  assert.equal(off.depth.nominalAt, 'zref');
  near(off.trs.deviation, (off.trs.DperMU / 0.98 - 1) * 100, 1e-9);
  assert.equal(off.trs.Dmax, undefined);
});

test('Электроны: доза на МЕ вне 0,3–2 сГр/МЕ — предупреждение о числе МЕ', () => {
  const ok = computeElectrons({ ...SAMPLE_ELECTRONS, protocol: 'trs' });
  assert.ok(!ok.messages.some((m) => /вне обычного диапазона/.test(m.text)));
  const typo = computeElectrons({ ...SAMPLE_ELECTRONS, protocol: 'trs', e_mu: String(parseFloat(SAMPLE_ELECTRONS.e_mu) / 10) });
  assert.ok(typo.messages.some((m) => m.level === 'warn' && /вне обычного диапазона/.test(m.text)));
});

test('Контрольные измерения: итог по ним с поправками из раздела 5 (TRS-398 и TG-51)', () => {
  const S = SAMPLE_ELECTRONS;
  for (const protocol of ['trs', 'tg51']) {
    const key = protocol === 'trs' ? 'trs' : 'tg51';
    // те же показания, что в разделе 5 — та же доза
    const same = computeElectrons({ ...S, protocol, e_ctrl_M: S.e_M1 });
    assert.deepEqual(errorsOf(same), []);
    near(same[key].ctrl.D, same[key].D, 1e-12, protocol);
    near(same.ctrl.changePct, 0, 1e-9);
    // показания на 1 % больше при вдвое большем числе МЕ: на МЕ — на 1 % больше
    const up = (a) => a.map((v) => String(parseFloat(String(v).replace(',', '.')) * 2 * 1.01));
    const r = computeElectrons({ ...S, protocol, e_ctrl_M: up(S.e_M1), e_ctrl_mu: String(2 * parseFloat(S.e_mu)) });
    assert.deepEqual(errorsOf(r), []);
    near(r[key].ctrl.DperMU, r[key].DperMU * 1.01, 1e-9);
    near(r.ctrl.changePct, 1, 1e-9);
    near(r[key].ctrl.DcGy, r[key].ctrl.D * 100, 1e-12);
  }
  // другая полярность — ошибка контрольных измерений, основной результат не блокируется
  const neg = (a) => a.map((v) => `-${String(v).replace(/^[-+]/, '')}`);
  const pos = (a) => a.map((v) => String(v).replace(/^[-+]/, ''));
  const flip = computeElectrons({ ...S, protocol: 'trs', e_ctrl_M: /^-/.test(String(S.e_M1[0])) ? pos(S.e_M1) : neg(S.e_M1) });
  assert.ok(flip.messages.some((m) => m.level === 'error' && m.scope === 'ctrl' && /полярности/.test(m.text)));
  assert.ok(flip.trs.ctrl.blocked && !flip.trs.blocked);
});

test('Электроны: калибровка ускорителя при отклонении больше ±2 % (раздел 9)', () => {
  const S = SAMPLE_ELECTRONS;
  const scale = (a, k) => a.map((v) => String(parseFloat(String(v).replace(',', '.')) * k));
  assert.equal(computeElectrons({ ...S, protocol: 'trs', e_nominal: '1,000' }).recal.needed, false);
  for (const protocol of ['trs', 'tg51']) {
    const key = protocol === 'trs' ? 'trs' : 'tg51';
    const base = { ...S, protocol, e_nominal: '1,050', e_ctrl_M: S.e_M1 };
    const out = computeElectrons(base);
    assert.ok(out.recal.needed);
    assert.ok(out.messages.some((m) => m.scope === 'recal'));
    const r = computeElectrons({ ...base, e_recal_needed: 'yes', e_recal_M: scale(S.e_M1, 1.05) });
    assert.deepEqual(errorsOf(r), []);
    const x = r[key];
    near(x.recal.DperMU, x.ctrl.DperMU * 1.05, 1e-9);
    near(x.recal.preVsNew, (1 / 1.05 - 1) * 100, 1e-9);
    near(x.recal.pre.deviation, x.ctrl.deviation, 1e-12);
  }
});

// Данные — рабочая книга реальной калибровки (Roos, 8 МэВ), как в workbook.test.js
const RB = {
  protocol: 'trs', e_ssd: '100', e_field: '10', e_r50_method: 'r50', e_r50: '3,186', e_ch_model: 'ROOS', e_cal_route: 'co60', e_ndw: '0,08287',
  e_T0: '20', e_P0: '101,325', e_kelec: '1', e_env_T: '22,95', e_env_P: '1030,315', e_env_P_unit: 'hPa', e_mu: '100', e_polarity: '+',
  e_V1: '200', e_V2: '100', e_beam_mode: 'pulsed', e_dd_on: true, e_pdd: '99,5536', e_nominal: '1,000', e_nominal_at: 'zmax', e_kqtrs_mode: 'manual', e_kqtrs_manual: '0,9319',
  e_M1: ['12,93', '12,93', '12,94'], e_Mopp: ['-12,92', '-12,94', '-12,95'], e_M2: ['12,85', '12,86', '12,86'],
};

test('Электроны: k_лаб умножает N_D,w в ⁶⁰Co (как на вкладке «МВ фотоны»), при перекрёстной калибровке не применяется', () => {
  for (const protocol of ['trs', 'tg51']) {
    const a = computeElectrons({ ...RB, protocol });
    const b = computeElectrons({ ...RB, protocol, e_klab: '1,0123' });
    const x = protocol === 'trs' ? 'trs' : 'tg51';
    near(b[x].DperMU / a[x].DperMU, 1.0123, 1e-12, `${protocol}: доза ∝ k_лаб`);
    assert.equal(b.inputs.klab, 1.0123);
  }
  assert.equal(computeElectrons({ ...RB, e_klab: '' }).inputs.klab, 1, 'пусто — 1');
  const bad = computeElectrons({ ...RB, e_klab: 'abc' });
  assert.equal(bad.flags.e_klab, 'error');
  assert.equal(computeElectrons({ ...RB, e_klab: '1,07' }).flags.e_klab, 'warn');
  const cross = computeElectrons({ ...RB, e_cal_route: 'cross', e_cross_ndw: '0,0775', e_cross_r50: '7,5', e_klab: '1,05' });
  assert.equal(cross.inputs.klab, 1, 'при перекрёстной калибровке k_лаб не применяется');
});

test('Электроны, проверка выхода: k_pol и k_s из калибровки — та же доза по тем же показаниям; без них — ошибка', () => {
  for (const protocol of ['trs', 'tg51']) {
    const x = protocol === 'trs' ? 'trs' : 'tg51';
    const cal = computeElectrons({ ...RB, protocol });
    const kpol = protocol === 'trs' ? cal.trs.kpolRaw : cal.tg51.PpolRaw;
    const ks = protocol === 'trs' ? cal.trs.ksRaw : cal.tg51.PionRaw;
    assert.ok(Number.isFinite(kpol) && Number.isFinite(ks));
    const chk = computeElectrons({ ...RB, protocol, e_fixed: true, e_Mopp: ['', '', ''], e_M2: ['', '', ''], e_V2: '', e_fixed_kpol: String(kpol).replace('.', ','), e_fixed_ks: String(ks).replace('.', ','), e_fixed_from: '25.08.2026' });
    assert.deepEqual(chk.messages.filter((m) => m.level === 'error').map((m) => m.text), [], protocol);
    near(chk[x].DperMU, cal[x].DperMU, 1e-12, `${protocol}: доза`);
    assert.equal(protocol === 'trs' ? chk.trs.ksFixed : chk.tg51.PionFixed, true);
    assert.ok(chk.messages.some((m) => m.level === 'info' && /25\.08\.2026/.test(m.text)));
  }
  const empty = computeElectrons({ ...RB, e_fixed: 'true' });
  assert.equal(empty.flags.e_fixed_ks, 'error');
  assert.equal(empty.flags.e_fixed_kpol, 'error');
  assert.ok(!empty.messages.some((m) => /NaN/.test(m.text)));
  assert.equal(computeElectrons({ ...RB, e_fixed: true, e_fixed_kpol: '1', e_fixed_ks: '0,99' }).flags.e_fixed_ks, 'error', 'k_s < 1');
});
