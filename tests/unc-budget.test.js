// Приёмка на независимых данных: бюджет неопределённости D_w,Q для пучка 6 МВ Elekta Versa HD (20.08.2026, PTW 30013,
// TRS-398 Rev.1, табл. 17), составленный отделением в Excel по фактическим измерениям и свидетельствам. Данные обезличены.
//
// Строки листа: N_D,w — U = 1,1 % (k = 2) из свидетельства; долговременная стабильность 0,2 % и установка стандартных
// условий 0,3 % — типовые из табл. 17; показания M_Q — тип А по шести повторам (s/√3, доза — среднее трёх экспозиций);
// поправки k_i разложены: k_TP 0,086 %, k_pol 0,009 %, k_s 0,018 %, k_elec 0,289 % (±0,5 % /√3), k_vol — 0; k_Q — 0,6 %.
// Итог листа: u₂ = 0,762 %, u_c = 0,940 %, U = 1,880 % (k = 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeUncertaintyTool, UT_DEFAULTS } from '../src/core/uncertainty-tool.js';
import { computePhotons, FORM_DEFAULTS } from '../src/core/photons.js';

const c = (x) => String(x).replace('.', ',');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} ≠ ${b} (±${tol})`);

const XL = {
  ndw: 0.55,
  stab: 0.2,
  setup: 0.3,
  read: 0.01281803283217, // s(6 повторов)/√3 относительно среднего, %
  kTP: 0.08601431317814821,
  kpol: 0.00906782496522171,
  ks: 0.017653720182309814,
  kelec: 0.2886751345948129,
  kq: 0.6,
  u2: 0.7624237513721642,
  uc: 0.9401010459819751,
  U: 1.8802020919639502,
};
const REPEATS = ['18,38', '18,39', '18,39', '18,39', '18,39', '18,39'];
const BASE = { ...UT_DEFAULTS, protocol: 'trs', unc_beam_type: 'photons', unc_route: 'lab', unc_cert_U: '1,1', unc_cert_k: '2', unc_M: REPEATS };

test('Versa HD 6 МВ: со своими значениями строк бюджет совпадает с независимым расчётом', () => {
  const ki = Math.sqrt(XL.kTP ** 2 + XL.kpol ** 2 + XL.ks ** 2 + XL.kelec ** 2);
  near(ki, 0.30187029448211217, 1e-12, 'k_i: сумма в квадратуре, как в листе');
  const r = computeUncertaintyTool({ ...BASE, unc_over: JSON.stringify({ 't17.st_read': c(XL.read), 't17.st_ki': c(ki) }) });
  assert.equal(r.budget.template.id, 't17');
  near(r.ucPct, XL.uc, 1e-12, 'u_c');
  near(r.UPct, XL.U, 1e-12, 'U (k = 2)');
  const st2 = r.budget.rows.filter((row) => /\.st_/.test(row.key)).map((row) => row.value);
  near(Math.sqrt(st2.reduce((s, v) => s + v * v, 0)), XL.u2, 1e-12, 'u₂ — этап 2');
});

test('Versa HD 6 МВ: типовой бюджет табл. 17 с U из свидетельства — 0,99 % / 1,97 %', () => {
  const r = computeUncertaintyTool(BASE);
  near(r.ucPct, Math.sqrt(0.55 ** 2 + 0.2 ** 2 + 0.3 ** 2 + 0.3 ** 2 + 0.3 ** 2 + 0.6 ** 2), 1e-12, 'u_c');
  // повторяемость шести показаний: s/√6 = 0,0017 нКл меньше разрешения 0,01/√12 = 0,0029 нКл — берётся разрешение;
  // 0,016 % меньше типовых 0,3 % — в расчёт идёт 0,3 %
  near(r.typeA.pct, (0.01 / Math.sqrt(12) / 18.388333333333332) * 100, 1e-12, 'тип А по шести повторам, граница по разрешению');
  assert.equal(r.typeA.fromRes, true);
  // как в листе: s по шести повторам, доза — среднее трёх, без границы по разрешению (δ задано малым)
  const xl = computeUncertaintyTool({ ...BASE, unc_m: '3', unc_res: '0,0001' });
  near(xl.typeA.pct, XL.read, 1e-12, 'тип А: s/√3, как в листе');
  assert.equal(r.budget.rows.find((row) => row.key === 't17.st_read').value, 0.3);
});

test('Versa HD 6 МВ: доза листа (k_Q 0,9876, k_pol и k_s по серии 400/200 В) — до 0,001 %', () => {
  const f = {
    ...FORM_DEFAULTS, protocol: 'trs', setup_geometry: 'SAD', ch_model: 'PTW30013', ch_ndw: c(0.05389), ch_klab: '1', ch_T0: '20', ch_P0: '101,325',
    env_T: c(21.7), env_P: c(1000.335), env_P_unit: 'hPa', rd_mu: '100', rd_V1: '400', rd_V2: '200',
    rd_M1: ['18,38', '18,39', '18,39'], rd_Mopp: ['-18,4', '-18,4', '-18,4'], rd_M2: ['18,34', '18,34', '18,34'], ctrl_M: ['18,39', '18,39', '18,39'],
    qtrs_method: 'ratio', qtrs_v20: c(0.6823), qtrs_v10: '1', dd_on: false, dd_nominal_at: 'zref', kqtrs_mode: 'manual', kqtrs_manual: c(0.9876),
  };
  const t = computePhotons(f).trs;
  near(t.kpol, 1.0003625815808554, 1e-12, 'k_pol');
  near(t.ks, 1.002462722322579, 1e-12, 'k_s (V₁/V₂ = 2)');
  near(t.kTP / 1.018783622220526, 1, 2e-6, 'k_TP (273,15 вместо 273,2)');
  near(t.ctrl.DcGy / 99.9950770370815, 1, 1e-5, 'D_w(z_ref), сГр за 100 МЕ');
  // k_Q по табл. 16 TRS-398 Rev.1 при TPR 0,6823 — 0,9872, а не 0,9876 из листа
  const kq = computePhotons({ ...f, kqtrs_mode: 'table' }).trs.kQ;
  near(kq, 0.98719, 5e-5, 'k_Q по табл. 16');
});

test('Versa HD 6 МВ: раскрытие k_i воспроизводит k_TP, k_pol, k_s листа и итог 0,302 %', async () => {
  const { kiBreakdown, seriesUncertainty, resolutionOf } = await import('../src/core/unc-ki.js');
  const series = {
    Mp: ['18,38', '18,39', '18,39'], Mm: ['-18,40', '-18,40', '-18,40'], M2: ['18,34', '18,34', '18,34'],
    ks: { kind: 'trs', v1: 400, v2: 200, beam: 'pulsed' }, T: 21.7, P: 100.0335,
  };
  const own = { kelec: c(XL.kelec), kTP: '0', kpol: '0', ks: '0', kh: '0', kleak: '0', pre: '0', kvol: '0' };
  // как в листе: u(T) = 0,130 °C, u(P) = 0,739 гПа; одинаковые показания — s = 0 (разрешение не учитывается)
  const spec = { on: true, uT: c(0.13012814197295386), uP: c(0.07385345850624393), series, own };
  const b = kiBreakdown('photons', spec, { res: 1e-9 });
  const f = Object.fromEntries(b.factors.map((x) => [x.key, x]));
  near(f.kTP.meas, XL.kTP, 1e-12, 'k_TP по u(T), u(P)');
  near(f.kpol.meas, XL.kpol, 1e-12, 'k_pol по сериям M₊, M₋');
  near(f.ks.meas, XL.ks, 1e-9, 'k_s по сериям при 400 и 200 В');
  near(b.pct, 0.30187029448211217, 1e-9, 'итог k_i');
  // в бюджете строка k_i заменяется раскрытием; со своим M_Q — итог листа
  const r = computeUncertaintyTool({ ...BASE, unc_res: '0,000000001', unc_ki: JSON.stringify(spec), unc_over: JSON.stringify({ 't17.st_read': c(XL.read), 't17.st_ki': '5' }) });
  const ki = r.budget.rows.find((x) => x.key === 't17.st_ki');
  assert.equal(ki.fromKi, true);
  assert.equal(ki.over, undefined, 'своё значение строки k_i при раскрытии не действует');
  near(r.ucPct, XL.uc, 1e-9, 'u_c');
  // с разрешением 0,01 нКл (запись показаний) одинаковые показания дают не ноль: k_pol и k_s растут
  const br = kiBreakdown('photons', spec, { res: resolutionOf(series.Mp, series.Mm, series.M2) });
  assert.equal(resolutionOf(['18,4'], ['18,39']), 0.01, 'шаг — самый мелкий по сериям');
  assert.ok(br.factors.find((x) => x.key === 'kpol').meas > XL.kpol);
  near(seriesUncertainty(['18,40', '18,40', '18,40'], { res: 0.01 }).u, 0.01 / Math.sqrt(12), 1e-15, 'δ/√12');
  // без своих оценок — большее из «по измерениям» и типового (аддендум TG-51, пример (i)): итог ≈ 0,21 %
  const typ = kiBreakdown('photons', { on: true, series }, { res: 0.01 });
  near(typ.pct, Math.sqrt(0.1 ** 2 + 0.05 ** 2 + 0.07 ** 2 + 0.05 ** 2 + 0.1 ** 2 + 0.05 ** 2 + 0.1 ** 2 + 0.05 ** 2), 1e-12, 'типовые значения');
  assert.ok(typ.messages.some((m) => m.level === 'info'));
  // TG-51: поправки уже разложены в бюджете — раскрытие не применяется
  const tg = computeUncertaintyTool({ ...BASE, protocol: 'tg51', unc_ki: JSON.stringify(spec) });
  assert.equal(tg.budget.ki, null);
});

test('Свои значения строк: статус и комментарий попадают в бюджет', () => {
  const r = computeUncertaintyTool({ ...BASE, unc_over: JSON.stringify({ 't17.st_read': '0,1' }), unc_row_notes: JSON.stringify({ 't17.st_read': { st: 'temp', text: 'монитор' }, 't17.st_kq': { st: 'fact', text: 'не своё' } }) });
  assert.deepEqual(r.budget.rows.find((x) => x.key === 't17.st_read').note, { st: 'temp', text: 'монитор' });
  assert.equal(r.budget.rows.find((x) => x.key === 't17.st_kq').note, undefined, 'у строки без своего значения комментарий не выводится');
});
