// Сквозной расчёт: результат computePhotons сверяется с расчётом «вручную» по формулам протоколов.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePhotons, normalizeForm, FORM_DEFAULTS } from '../src/core/photons.js';
import { SAMPLE_FORM } from '../src/core/sample.js';
import { findChamber } from '../src/core/chambers.js';
import { kQFit, kQFromTable, kvolFromTable11, kvolGeneric, TRS_TABLE16_TPR, TRS_TABLE11 } from '../src/core/trs398.js';
import { parseCells, parseBeamName } from '../src/core/units.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const errorsOf = (r) => r.messages.filter((m) => m.level === 'error');

test('Демо-набор: TRS-398 Rev.1 и TG-51 совпадают с ручным расчётом', () => {
  const r = computePhotons(SAMPLE_FORM);
  assert.deepEqual(errorsOf(r), [], 'в демо-наборе не должно быть ошибок');

  const M1 = mean([12.346, 12.348, 12.345]);
  const Mopp = mean([12.339, 12.341, 12.34]);
  const M2 = mean([12.302, 12.304, 12.303]);
  const ndw = 0.05335;
  const kpol = (M1 + Mopp) / (2 * M1);
  const tpr = 8.35 / 12.5;

  // TRS-398 Rev.1
  const kTP = ((273.15 + 21.4) / (273.15 + 20)) * (101.325 / 99.62);
  const r12 = M1 / M2;
  const ksExp = 1.198 - 0.875 * r12 + 0.677 * r12 * r12; // табл. 10, n = 3
  const a = 1.18273;
  const b = -0.13256;
  const kQtrs = (1 + Math.exp((a - 0.57) / b)) / (1 + Math.exp((a - tpr) / b));
  const Dtrs = M1 * kTP * kpol * ksExp * ndw * kQtrs;
  near(r.trs.tpr, 0.668, 1e-12, 'TPR20,10');
  near(r.trs.kTP, kTP, 1e-12, 'k_TP');
  near(r.trs.ks, ksExp, 1e-12, 'k_s');
  near(r.trs.kQ, kQtrs, 1e-12, 'k_Q TRS');
  near(r.trs.D, Dtrs, 1e-12, 'D TRS');
  near(r.trs.DperMUGy, Dtrs / 100, 1e-15, 'Гр/МЕ');
  near(r.trs.DmaxPerMU, Dtrs / 0.664, 1e-12, 'D(d_max)/МЕ TRS');
  near(r.trs.DmaxPerMUGy, Dtrs / 100 / 0.664, 1e-15, 'D(d_max), Гр/МЕ');

  // TG-51 + аддендум
  const PTP = ((273.2 + 21.4) / (273.2 + 20)) * (101.325 / 99.62);
  const Pion = (1 - 3) / (r12 - 3);
  const kQ51 = 0.9652 + 2.141e-3 * 66.4 - 2.623e-5 * 66.4 * 66.4;
  const D51 = M1 * PTP * Pion * kpol * ndw * kQ51;
  near(r.tg51.PTP, PTP, 1e-12, 'P_TP');
  near(r.tg51.Pion, Pion, 1e-12, 'P_ion');
  near(r.tg51.kQ, kQ51, 1e-12, 'k_Q TG-51');
  near(r.tg51.D, D51, 1e-12, 'D TG-51');

  near(r.comparison.dRel, (D51 / Dtrs - 1) * 100, 1e-9, 'расхождение протоколов');
  assert.ok(r.trs.DmaxPerMU > 0.98 && r.trs.DmaxPerMU < 1.02);
  // пучок с фильтром: k_vol не применяется
  assert.equal(r.profile.active, false);
  assert.equal(r.trs.kvol, 1);
});

test('Report 374, прил. A.3.2: пересчёт на d_max через PDD', () => {
  const form = {
    ...FORM_DEFAULTS,
    protocol: 'tg51',
    ch_model: 'NE2571',
    ch_ndw: '1',
    ch_T0: '22',
    ch_P0: '101,33',
    env_T: '22',
    env_P: '101,33',
    rd_mu: '100',
    rd_V1: '300',
    rd_V2: '150',
    rd_M1: ['0,66'],
    rd_Mopp: ['0,66'],
    rd_M2: ['0,66'],
    q51_method: 'manual',
    q51_manual: '66',
    kq51_manual_on: true,
    kq51_manual: '1',
    dd_zmax: '1,5',
    dd_pdd: '66,0',
  };
  const r = computePhotons(form);
  near(r.tg51.DperMU, 0.66, 1e-12);
  near(r.tg51.DmaxPerMU, 1.0, 1e-12);
  // k_Q = 0,9985 и %dd(10) = 67,0 → 0,65901/0,67 = 0,98360 (в отчёте опечатка 0,6659)
  const r2 = computePhotons({ ...form, kq51_manual: '0,9985', dd_pdd: '67,0' });
  near(r2.tg51.DperMU, 0.65901, 1e-12);
  near(r2.tg51.DmaxPerMU, 0.9836, 5e-5);
});

test('Проверки: P_ion > 1,05, формула (15) для БВФ, давление в неверных единицах', () => {
  const r1 = computePhotons({ ...SAMPLE_FORM, rd_M2: ['11,2', '11,2', '11,2'] });
  assert.ok(errorsOf(r1).some((m) => /P_ion/.test(m.text)));
  assert.ok(errorsOf(r1).some((m) => /k_s/.test(m.text)));
  assert.ok(r1.tg51.blocked && r1.trs.blocked);
  assert.equal(r1.flags.ks, 'error');
  assert.equal(r1.flags.Pion, 'error');

  const r2 = computePhotons({ ...SAMPLE_FORM, meta_fff: true, q51_method: 'interim' });
  assert.ok(errorsOf(r2).some((m) => /БВФ/.test(m.text)));

  const r3 = computePhotons({ ...SAMPLE_FORM, env_P: '747' });
  assert.ok(errorsOf(r3).some((m) => /Давление/.test(m.text)));
  assert.equal(r3.flags.env_P, 'error');
  const r4 = computePhotons({ ...SAMPLE_FORM, env_P: '747', env_P_unit: 'mmHg' });
  assert.deepEqual(errorsOf(r4), []);
});

test('k_s < 1 блокирует расчёт и подсвечивает поле', () => {
  const r = computePhotons({ ...SAMPLE_FORM, rd_M2: ['12,40', '12,40', '12,40'] });
  assert.ok(errorsOf(r).some((m) => /не может быть меньше 1/.test(m.text)));
  assert.equal(r.flags.ks, 'error');
  assert.ok(r.trs.blocked && r.tg51.blocked);
});

test('k_pol за пределами 1 ± 0,004 подсвечивается', () => {
  const ok = computePhotons(SAMPLE_FORM);
  assert.equal(ok.flags.kpol, undefined);
  const bad = computePhotons({ ...SAMPLE_FORM, rd_Mopp: ['-12,24', '-12,24', '-12,24'] });
  assert.equal(bad.flags.kpol, 'warn');
  assert.ok(bad.messages.some((m) => m.level === 'warn' && /k_pol/.test(m.text)));
});

test('Лаборатория не вносила поправки: k′_pol = k_pol/k_pol,Q0 и k_s/k_s,Q0', () => {
  const r0 = computePhotons(SAMPLE_FORM);
  const r = computePhotons({ ...SAMPLE_FORM, lab_pol_applied: false, lab_kpol: '1,002', lab_ks_applied: false, lab_ks: '1,001' });
  near(r.trs.kpol, r0.trs.kpol / 1.002, 1e-12);
  near(r.trs.ks, r0.trs.ks / 1.001, 1e-12);
  near(r.tg51.Ppol, r0.tg51.Ppol / 1.002, 1e-12);
  near(r.tg51.Pion, r0.tg51.Pion / 1.001, 1e-12);
  near(r.comparison.dRel, r0.comparison.dRel, 1e-9);
});

test('k_Q по TRS-398: формула (34) и табл. 16 рядом; выбор способа', () => {
  const r = computePhotons(SAMPLE_FORM);
  const c = findChamber('PTW30013');
  near(r.trs.kQFormula, kQFit(c.trs, 0.668), 1e-12);
  // 0,668 между узлами 0,65 и 0,68
  const t = (0.668 - 0.65) / 0.03;
  near(r.trs.kQTable, 0.992 + t * (0.9876 - 0.992), 1e-12);
  const rt = computePhotons({ ...SAMPLE_FORM, kqtrs_mode: 'table' });
  near(rt.trs.kQ, rt.trs.kQTable, 1e-15);
  const rm = computePhotons({ ...SAMPLE_FORM, kqtrs_mode: 'manual', kqtrs_manual: '0,9901' });
  near(rm.trs.kQ, 0.9901, 1e-15);
});

test('Табл. 16: интерполяция точно проходит через узлы для всех 26 камер', () => {
  let n = 0;
  for (const id of ['NE2571', 'PTW30013', 'FC65G', 'CC13', 'SNC600c', 'PTW31021']) {
    const c = findChamber(id);
    TRS_TABLE16_TPR.forEach((x, i) => near(kQFromTable(c, x).value, c.trsTable[i], 1e-12, `${id} ${x}`));
    n++;
  }
  assert.equal(n, 6);
  assert.ok(kQFromTable(findChamber('NE2571'), 0.83).error);
  assert.ok(kQFromTable(findChamber('A1'), 0.7).error);
});

test('Табл. 11: билинейная интерполяция проходит через узлы и лежит между ними', () => {
  TRS_TABLE11.lengthCm.forEach((L, j) =>
    TRS_TABLE11.tpr.forEach((x, i) => near(kvolFromTable11({ tpr: x, lengthCm: L }).value, TRS_TABLE11.kvol[j][i], 1e-12)),
  );
  near(kvolFromTable11({ tpr: 0.675, lengthCm: 2.25 }).value, (1.002 + 1.002 + 1.003 + 1.004) / 4, 1e-12);
  assert.ok(kvolFromTable11({ tpr: 0.59, lengthCm: 2 }).error);
  assert.ok(kvolFromTable11({ tpr: 0.7, lengthCm: 3 }).error);
  // L < 5 мм (например, PTW 31021, 4,8 мм): строка 5 мм, k_vol = 1,000
  assert.equal(kvolFromTable11({ tpr: 0.7, lengthCm: 0.48 }).value, 1);
});

test('k_vol: только для БВФ; формула (22), табл. 11, своё значение', () => {
  const base = { ...SAMPLE_FORM, meta_fff: true, q51_method: 'foil30', q51_pdd10pb: '66,4' };
  const f22 = computePhotons({ ...base, prof_mode: 'formula22' });
  near(f22.profile.value, kvolGeneric({ tpr: 0.668, lengthCm: 2.3, sddCm: 110 }), 1e-12);
  const t11 = computePhotons({ ...base, prof_mode: 'table11' });
  near(t11.profile.value, kvolFromTable11({ tpr: 0.668, lengthCm: 2.3 }).value, 1e-12);
  const man = computePhotons({ ...base, prof_mode: 'manual', prof_value: '1,004' });
  const r0 = computePhotons(SAMPLE_FORM);
  near(man.trs.kvol, 1.004, 1e-15);
  // без галочки БВФ способ игнорируется
  const flat = computePhotons({ ...SAMPLE_FORM, prof_mode: 'manual', prof_value: '1,004' });
  near(flat.trs.D, r0.trs.D, 1e-15);
});

test('k_vol по измеренному профилю (ур. 21 TRS-398)', () => {
  const text = 'y, мм\tдоза\n' + Array.from({ length: 31 }, (_, i) => `${i - 15} ${(100 * (1 - 1e-5 * (i - 15) ** 2)).toFixed(6).replace('.', ',')}`).join('\n');
  const base = { ...SAMPLE_FORM, meta_fff: true, q51_method: 'foil30', q51_pdd10pb: '66,4', prof_mode: 'profile', prof_text: text };
  const r = computePhotons(base);
  // парабола OAR = 1 − c·y²: среднее по [−L/2, L/2] = 1 − c·L²/12, L = 23 мм (табл. 4 для PTW 30013)
  near(r.profile.value, 1 / (1 - (1e-5 * 23 * 23) / 12), 2e-6);
  const tg = computePhotons({ ...base, protocol: 'tg51' });
  near(tg.tg51.Prp, r.profile.value, 1e-15, 'по профилю — доступно и в режиме TG-51');
  const empty = computePhotons({ ...base, prof_text: '' });
  assert.equal(empty.flags.prof_text, 'error');
  const short = computePhotons({ ...base, prof_length: '40' });
  assert.equal(short.flags.prof_text, 'error', 'профиль короче камеры');
});

test('Оценка TPR20,10 для БВФ по PDD(10) — только для сравнения', () => {
  const r = computePhotons({ ...SAMPLE_FORM, meta_fff: true, q51_method: 'foil30', q51_pdd10pb: '66,4', qtrs_fff_pdd10: '63,0' });
  near(r.trs.fffEstimate.value, -0.7898 + 0.0329 * 63 - 0.000166 * 63 * 63, 1e-12);
  near(r.trs.tpr, 0.668, 1e-12, 'k_Q считается по измеренному TPR, а не по оценке');
  const flat = computePhotons(SAMPLE_FORM);
  assert.equal(flat.trs.fffEstimate, undefined);
});

test('TPR20,10 через PDD(20)/PDD(10)', () => {
  const r = computePhotons({ ...SAMPLE_FORM, qtrs_method: 'pdd2010', qtrs_v20: '38,5', qtrs_v10: '66,4' });
  near(r.trs.tpr, 1.2661 * (38.5 / 66.4) - 0.0595, 1e-12);
});

test('Своя камера: аналог из базы, параметры a и b, k_Q вручную', () => {
  const custom = { ...SAMPLE_FORM, ch_model: 'CUSTOM', cc_model: 'Тестовая', cc_length: '23', cc_radius: '3,05' };
  const none = computePhotons(custom);
  assert.ok(none.trs.blocked && none.tg51.blocked);
  assert.equal(none.flags.cc_analog, 'error');

  const analog = computePhotons({ ...custom, cc_analog: 'PTW30013' });
  const r0 = computePhotons(SAMPLE_FORM);
  near(analog.trs.kQ, r0.trs.kQ, 1e-15);
  near(analog.tg51.kQ, r0.tg51.kQ, 1e-15);
  assert.ok(analog.messages.some((m) => m.scope === 'trs' && /аналог/.test(m.text)));

  const ab = computePhotons({ ...custom, protocol: 'trs', cc_a: '1,1', cc_b: '-0,1' });
  near(ab.trs.kQ, kQFit({ a: 1.1, b: -0.1 }, 0.668), 1e-12);
  assert.ok(!ab.trs.blocked);
  const abTable = computePhotons({ ...custom, protocol: 'trs', cc_a: '1,1', cc_b: '-0,1', kqtrs_mode: 'table' });
  assert.ok(abTable.trs.blocked, 'для своих a, b табличных значений нет');

  const man = computePhotons({ ...custom, protocol: 'trs', kqtrs_mode: 'manual', kqtrs_manual: '0,99' });
  assert.ok(!man.trs.blocked);
});

test('Геометрия: ручной ввод, предупреждения о нестандартных условиях', () => {
  const r = computePhotons({ ...SAMPLE_FORM, setup_geometry: 'manual', setup_ssd: '100', setup_field: '10', setup_depth: '10' });
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.flags.setup_depth, undefined);
  const d5 = computePhotons({ ...SAMPLE_FORM, setup_geometry: 'manual', setup_ssd: '100', setup_field: '10', setup_depth: '5' });
  assert.equal(d5.flags.setup_depth, 'warn');
  assert.equal(d5.depth.label, 'PDD(5 см)/100');
  const f15 = computePhotons({ ...SAMPLE_FORM, setup_geometry: 'manual', setup_ssd: '100', setup_field: '15', setup_depth: '10' });
  assert.equal(f15.flags.setup_field, 'warn');
  const sddDefault = computePhotons({ ...SAMPLE_FORM, meta_fff: true, q51_method: 'foil30', q51_pdd10pb: '66', setup_geometry: 'manual', setup_ssd: '90', setup_field: '10', setup_depth: '10' });
  near(sddDefault.inputs.sddCm, 100, 1e-12);
});

test('Геометрия РИО: пересчёт через TMR', () => {
  const r = computePhotons({ ...SAMPLE_FORM, setup_geometry: 'SAD', dd_tmr: '0,736' });
  near(r.trs.DmaxPerMU, r.trs.DperMU / 0.736, 1e-12);
  const bad = computePhotons({ ...SAMPLE_FORM, setup_geometry: 'SAD', dd_tmr: '73,6' });
  assert.ok(errorsOf(bad).some((m) => /TMR/.test(m.text)));
});

test('Глубина d_max обязательна для пересчёта, но не блокирует дозу на опорной глубине', () => {
  const noZ = computePhotons({ ...SAMPLE_FORM, dd_zmax: '' });
  assert.equal(noZ.flags.dd_zmax, 'error');
  assert.ok(!noZ.trs.blocked && Number.isFinite(noZ.trs.D));
  assert.equal(noZ.trs.DmaxPerMU, undefined);
  const deep = computePhotons({ ...SAMPLE_FORM, dd_zmax: '12' });
  assert.equal(deep.flags.dd_zmax, 'error');
  const noNominal = computePhotons({ ...SAMPLE_FORM, dd_nominal: '' });
  assert.ok(Number.isFinite(noNominal.trs.DmaxPerMU));
  assert.equal(noNominal.trs.deviation, undefined);
});

test('P_ion < 1 после деления на поправку лаборатории блокирует TG-51', () => {
  const r = computePhotons({ ...SAMPLE_FORM, protocol: 'tg51', lab_ks_applied: false, lab_ks: '1,005' });
  assert.ok(r.tg51.blocked);
  assert.equal(r.flags.Pion, 'error');
});

test('Заблокированный результат не участвует в сравнении протоколов', () => {
  const r = computePhotons({ ...SAMPLE_FORM, rd_M2: ['12,50', '12,50', '12,50'] });
  assert.equal(r.comparison, null);
});

test('Большой разброс показаний: предупреждение или ошибка', () => {
  const warn = computePhotons({ ...SAMPLE_FORM, rd_M1: ['12,30', '12,45'] });
  assert.ok(warn.messages.some((m) => m.level === 'warn' && /Разброс/.test(m.text)));
  const err = computePhotons({ ...SAMPLE_FORM, rd_M1: ['12', '346', '12,348'] });
  assert.ok(errorsOf(err).some((m) => /расходятся/.test(m.text)));
});

test('Ячейки показаний: пустые пропускаются, ошибка указывает номер ячейки', () => {
  const s = parseCells(['12,3', '', '12,5', '']);
  assert.equal(s.n, 2);
  near(s.mean, 12.4, 1e-12);
  assert.match(parseCells(['12,3', 'abc']).error, /ячейку 2/);
});

test('Название пучка → номинальная энергия и БВФ', () => {
  assert.deepEqual(parseBeamName('6 МВ'), { energy: 6, fff: null });
  assert.deepEqual(parseBeamName('10 МВ БВФ'), { energy: 10, fff: true });
  assert.deepEqual(parseBeamName('6X FFF'), { energy: 6, fff: true });
  assert.deepEqual(parseBeamName('15MV'), { energy: 15, fff: null });
  assert.deepEqual(parseBeamName('6 MV WFF'), { energy: 6, fff: false }, 'WFF — с выравнивающим фильтром');
  assert.deepEqual(parseBeamName('Пучок 2: 6 МВ'), { energy: 6, fff: null }, 'энергия — число перед МВ');
  assert.ok(Number.isNaN(parseBeamName('фотоны').energy));
});

test('Старые файлы: показания строкой, медицинский физик, TPR напрямую', () => {
  const f = normalizeForm({ rd_M1: '12,346 12,348', meta_physicist: 'Иванов', qtrs_method: 'direct', qtrs_tpr: '0,668', ch_model: 'OTHER', kqtrs_manual_on: true });
  assert.deepEqual(f.rd_M1, ['12,346', '12,348']);
  assert.deepEqual(f.meta_staff, ['Иванов']);
  assert.equal(f.qtrs_method, 'ratio');
  assert.equal(f.ch_model, 'CUSTOM');
  assert.equal(f.kqtrs_mode, 'manual');
  const none = normalizeForm({ prof_mode: 'none' });
  assert.equal(none.prof_mode, 'manual');
  assert.equal(none.prof_value, '1,000');
  assert.equal(normalizeForm({ prof_mode: 'profile' }).prof_mode, 'profile');
  const r = computePhotons({ ...SAMPLE_FORM, qtrs_method: 'direct', qtrs_tpr: '0,668', qtrs_v20: undefined, qtrs_v10: undefined });
  near(r.trs.tpr, 0.668, 1e-12);
});

test('Контрольные измерения (Versa HD): поправки раздела 4, итог по контрольным показаниям', () => {
  // пример из рабочей таблицы: PTW 31010, 6 МВ БВФ, РИО 100 см, 500 МЕ, k_Q введён вручную
  const f = {
    ...FORM_DEFAULTS, protocol: 'trs', meta_beam: '6 FFF', meta_fff: true, setup_geometry: 'SAD',
    ch_model: 'PTW31010', ch_ndw: '0,297', ch_T0: '20', ch_P0: '101,325', el_kelec: '1',
    env_T: '21,8', env_P: '1014,42', env_P_unit: 'hPa', rd_mu: '500', rd_V1: '400', rd_V2: '200',
    rd_M1: ['16,67', '16,67', '16,66'], rd_Mopp: ['16,65', '16,66', '16,66'], rd_M2: ['16,54', '16,55', '16,55'],
    qtrs_method: 'ratio', qtrs_v20: '0,6785', qtrs_v10: '1', kqtrs_mode: 'manual', kqtrs_manual: '0,9892',
    prof_mode: 'formula22', prof_length: '6,5', prof_sdd: '100', dd_on: false,
    ctrl_M: ['16,83', '16,83', '16,81'],
  };
  const r = computePhotons(f);
  assert.deepEqual(r.messages.filter((m) => m.level === 'error'), []);
  // таблица пользователя (ячейки H10/500 и «до калибровки»), k_TP с 273,2 — разница 1e-6
  const F = (16.67 + 16.67 + 16.66) / 3;
  const kTP = ((273.2 + 21.8) * 1013.25) / ((273.2 + 20) * 1014.42);
  const q = F / ((16.54 + 16.55 + 16.55) / 3);
  const ks = 2.337 - 3.636 * q + 2.299 * q * q;
  const kpol = (F + (16.65 + 16.66 + 16.66) / 3) / (2 * F);
  const kvol = 1 + (0.0062 * 0.6785 - 0.0036) * 0.65 ** 2;
  const k = kTP * ks * kpol * kvol * 0.9892 * 0.297;
  near(r.trs.DperMU, (F * k) / 5, 2e-5, 'до калибровки, сГр/МЕ');
  near(r.trs.ctrl.DperMU, (((16.83 + 16.83 + 16.81) / 3) * k) / 5, 2e-5, 'по контрольным, сГр/МЕ');
  near(r.trs.ctrl.DperMU, 1.00044, 1e-4, 'совпадает с ячейкой G10 таблицы');
  // контрольные при другом числе МЕ приводятся к той же величине на МЕ
  const r200 = computePhotons({ ...f, ctrl_M: ['6,733', '6,733', '6,725'], ctrl_mu: '200' });
  near(r200.trs.ctrl.DperMU, (((6.733 + 6.733 + 6.725) / 3) * k) / 2, 2e-5);
});

test('Установка по РИО: пересчёт на d_max через TMR или через PDD при РИП 90 см', () => {
  const base = { ...SAMPLE_FORM, setup_geometry: 'SAD', dd_on: true, dd_zmax: '1,5', dd_tmr: '0,736' };
  const t = computePhotons(base);
  near(t.trs.DmaxPerMU, t.trs.DperMU / 0.736, 1e-12);
  const p = computePhotons({ ...base, dd_sad: 'pdd', dd_pdd: '66,4' });
  near(p.trs.DmaxPerMU, p.trs.DperMU / 0.664, 1e-12);
  assert.equal(p.depth.pddSsd, 90);
  assert.match(p.depth.label, /РИП 90 см/);
});

test('Доза в сГр и Гр за отпущенные МЕ; номинальный выход на опорной глубине или на d_max', () => {
  // Versa HD, 6 МВ БВФ, РИО: аппарат калибруют на 10 см — 1 сГр/МЕ (1 Гр на 100 МЕ) на опорной глубине
  const f = {
    ...FORM_DEFAULTS, protocol: 'trs', meta_beam: '6 FFF', meta_fff: true, setup_geometry: 'SAD',
    ch_model: 'PTW31010', ch_ndw: '0,297', ch_T0: '20', ch_P0: '101,325', el_kelec: '1',
    env_T: '21,8', env_P: '1014,42', env_P_unit: 'hPa', rd_mu: '500', rd_V1: '400', rd_V2: '200',
    rd_M1: ['16,67', '16,67', '16,66'], rd_Mopp: ['16,65', '16,66', '16,66'], rd_M2: ['16,54', '16,55', '16,55'],
    qtrs_method: 'ratio', qtrs_v20: '0,6785', qtrs_v10: '1', kqtrs_mode: 'manual', kqtrs_manual: '0,9892',
    prof_mode: 'formula22', prof_length: '6,5', prof_sdd: '100', dd_on: false,
    ctrl_M: ['16,83', '16,83', '16,81'], dd_nominal: '1,000',
  };
  const r = computePhotons(f);
  assert.equal(r.depth.nominalAt, 'zref', 'без пересчёта на d_max номинал — на опорной глубине');
  const c = r.trs.ctrl;
  near(c.DcGy, 500.22, 0.05, 'D_w(10) за 500 МЕ, сГр');
  near(c.D, c.DcGy / 100, 1e-12, 'то же в Гр');
  near(c.DperMU, c.DcGy / 500, 1e-12, 'сГр/МЕ = Гр на 100 МЕ');
  near(c.DperMUGy * 100, c.DperMU, 1e-12);
  near(c.deviation, (c.DperMU / 1 - 1) * 100, 1e-9, 'отклонение по опорной глубине');
  near(c.deviation, 0.044, 0.01);
  assert.equal(c.Dmax, undefined);

  // с пересчётом на d_max: номинал на d_max (по умолчанию) или на опорной глубине
  const atMax = computePhotons({ ...SAMPLE_FORM, dd_nominal: '1,000', dd_nominal_at: 'dmax' });
  const atRef = computePhotons({ ...SAMPLE_FORM, dd_nominal: '0,670', dd_nominal_at: 'zref' });
  for (const x of [atMax.trs, atMax.tg51, atRef.trs]) {
    near(x.Dmax, x.D / atMax.depth.factor, 1e-12, 'D(d_max) = D(z_ref)/PDD');
    near(x.DmaxcGy, x.Dmax * 100, 1e-12);
    near(x.DmaxPerMU, x.DmaxcGy / x.units, 1e-12);
  }
  assert.equal(atMax.depth.nominalAt, 'dmax');
  assert.equal(atRef.depth.nominalAt, 'zref');
  near(atMax.trs.deviation, (atMax.trs.DmaxPerMU - 1) * 100, 1e-9);
  near(atRef.trs.deviation, (atRef.trs.DperMU / 0.67 - 1) * 100, 1e-9);
  // выключенный пересчёт переводит номинал на опорную глубину, даже если выбрано «на d_max»
  const off = computePhotons({ ...SAMPLE_FORM, dd_on: false, dd_nominal: '0,670', dd_nominal_at: 'dmax' });
  assert.equal(off.depth.nominalAt, 'zref');
  near(off.trs.deviation, (off.trs.DperMU / 0.67 - 1) * 100, 1e-9);
});

test('k_лаб: поправочный множитель из протокола поверки умножает N_D,w', () => {
  const base = computePhotons({ ...SAMPLE_FORM, protocol: 'both' });
  assert.equal(base.inputs.klab, 1, 'по умолчанию 1');
  const k = computePhotons({ ...SAMPLE_FORM, protocol: 'both', ch_klab: '1,0020' });
  assert.deepEqual(errorsOf(k), []);
  near(k.trs.D, base.trs.D * 1.002, 1e-12, 'TRS-398');
  near(k.tg51.D, base.tg51.D * 1.002, 1e-12, 'TG-51');
  near(k.inputs.ndwEff, k.inputs.ndw * 1.002, 1e-15);
  // пустое поле — 1; нечисло — ошибка; большое отклонение — предупреждение
  near(computePhotons({ ...SAMPLE_FORM, ch_klab: '' }).trs.D, base.trs.D, 1e-12);
  assert.ok(errorsOf(computePhotons({ ...SAMPLE_FORM, ch_klab: 'abc' })).some((m) => /k_лаб/.test(m.text)));
  assert.ok(computePhotons({ ...SAMPLE_FORM, ch_klab: '1,08' }).messages.some((m) => m.level === 'warn' && /k_лаб/.test(m.text)));
  // старые файлы без поля
  const { ch_klab, ...old } = normalizeForm(SAMPLE_FORM);
  near(computePhotons(old).trs.D, base.trs.D, 1e-12);
});

test('Versa HD 6 FFF (рабочая книга, 25.08.2026): совпадение с ячейками H10, G10; проверка числа МЕ', () => {
  const f = {
    ...FORM_DEFAULTS, protocol: 'trs', meta_beam: '6 FFF', meta_fff: true, setup_geometry: 'SAD',
    ch_model: 'PTW31010', ch_ndw: '0,297', ch_T0: '20', ch_P0: '101,325', el_kelec: '1',
    env_T: '21,8', env_P: '1014,42', env_P_unit: 'hPa', rd_mu: '500', rd_V1: '400', rd_V2: '200',
    rd_M1: ['16,67', '16,67', '16,66'], rd_Mopp: ['-16,65', '-16,66', '-16,66'], rd_M2: ['16,54', '16,55', '16,55'],
    qtrs_method: 'pdd2010', qtrs_v20: '39,16', qtrs_v10: '67,22', kqtrs_mode: 'manual', kqtrs_manual: '0,9871',
    prof_mode: 'formula22', prof_length: '6,5', prof_sdd: '100', dd_on: false, dd_nominal: '1,000',
    ctrl_M: ['16,83', '16,83', '16,81'],
  };
  const r = computePhotons(f);
  assert.deepEqual(errorsOf(r), []);
  // L6: в таблице 273,2; в TRS-398 Rev.1, ур. (10) — 273,15 (разница 1e-6)
  near(r.trs.kTP, 1.0049787050271242, 2e-6, 'L6');
  near(r.trs.ks, 1.0070975468173424, 1e-9, 'O10 = G42');
  near(r.trs.kpol, 0.9997, 1e-6, 'P10 = H42');
  near(r.trs.tpr, 1.2661 * (39.16 / 67.22) - 0.0595, 1e-12, 'TPR20,10 через PDD, S10 = 0,6781');
  near(r.trs.ctrl.DcGy, 499.15916502012834, 2e-3, 'H10, сГр за 500 МЕ (k_vol по текущему TPR — разница 1e-6)');
  near(r.trs.ctrl.DperMU, 0.9983183300402567, 5e-6, 'G10, Гр на 100 МЕ');
  // k_Q по формуле (34) = ячейка AC10 «Kq (тек.расч.)»
  const formula = computePhotons({ ...f, kqtrs_mode: 'formula' });
  // AC10 считается по округлённому TPR = 0,6781; калькулятор — по неокруглённому 0,678097
  near(formula.trs.kQ, 0.9872586888502661, 1e-5, 'AC10');
  // число МЕ с ошибкой в 10 раз: предупреждение с подсказкой
  const typo = computePhotons({ ...f, rd_mu: '50' });
  const w = typo.messages.filter((m) => m.level === 'warn').map((m) => m.text);
  assert.ok(w.some((t) => /вне обычного диапазона/.test(t) && /50 вместо 500/.test(t) && /сейчас 50 МЕ/.test(t)), w.join(' | '));
  assert.ok(w.some((t) => /больше 20 %/.test(t)));
  assert.ok(!r.messages.some((m) => /вне обычного диапазона|больше 20 %/.test(m.text)), 'при 500 МЕ замечаний нет');
});

test('Калибровка ускорителя при отклонении больше ±2 %: раздел 9, доза после калибровки — итог', () => {
  const f = {
    ...FORM_DEFAULTS, protocol: 'trs', meta_beam: '6 FFF', meta_fff: true, setup_geometry: 'SAD',
    ch_model: 'PTW31010', ch_ndw: '0,297', ch_T0: '20', ch_P0: '101,325', el_kelec: '1',
    env_T: '21,8', env_P: '1014,42', env_P_unit: 'hPa', rd_mu: '500', rd_V1: '400', rd_V2: '200',
    rd_M1: ['16,67', '16,67', '16,66'], rd_Mopp: ['-16,65', '-16,66', '-16,66'], rd_M2: ['16,54', '16,55', '16,55'],
    qtrs_method: 'pdd2010', qtrs_v20: '39,16', qtrs_v10: '67,22', kqtrs_mode: 'manual', kqtrs_manual: '0,9871',
    prof_mode: 'formula22', prof_length: '6,5', prof_sdd: '100', dd_on: false,
    ctrl_M: ['16,83', '16,83', '16,81'],
  };
  // в допуске: раздел 9 не нужен, показания после калибровки не учитываются
  const ok = computePhotons({ ...f, dd_nominal: '1,000', recal_needed: 'yes', recal_M: ['17', '17', '17'] });
  assert.equal(ok.recal.needed, false);
  assert.equal(ok.trs.recal, undefined);
  // вне допуска (номинал 1,03 → −3,1 %)
  const out = computePhotons({ ...f, dd_nominal: '1,030' });
  assert.equal(out.recal.needed, true);
  assert.ok(out.messages.some((m) => m.scope === 'recal' && /раздел/.test(m.text)));
  assert.equal(computePhotons({ ...f, dd_nominal: '1,030', recal_needed: 'no' }).recal.on, false);
  // «да» и новые показания: итог по ним, прежняя доза — для справки
  const r = computePhotons({ ...f, dd_nominal: '1,030', recal_needed: 'yes', recal_M: ['17,34', '17,34', '17,32'] });
  assert.deepEqual(errorsOf(r), []);
  const c = r.trs.ctrl;
  const n = r.trs.recal;
  near(n.DperMU, c.DperMU * (mean([17.34, 17.34, 17.32]) / mean([16.83, 16.83, 16.81])), 1e-12, 'те же поправки, новый заряд');
  near(n.deviation, (n.DperMU / 1.03 - 1) * 100, 1e-9);
  near(n.pre.deviation, c.deviation, 1e-12);
  near(n.preVsNew, (c.DperMU / n.DperMU - 1) * 100, 1e-9, 'доза до калибровки относительно новой');
  assert.ok(Math.abs(n.deviation) < 2);
  assert.ok(!r.messages.some((m) => /больше 2 %/.test(m.text)), 'после калибровки в допуске — без предупреждения');
});
