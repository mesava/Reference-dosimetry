// Брахитерапия: сверка ядра с таблицами и примерами TRS-492, DGMP-Bericht 13, руководства PTW 9193, Ubrich 2012/2014,
// Azhari 2012 и с обезличенными числами из сертификатов камеры и источников пользователя.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HALF_LIVES,
  DAYS_PER_YEAR,
  KSM_TABLE,
  KSM_SOURCES,
  UBRICH_KGES_DGMP,
  PHANTOM_CO60_LITERATURE,
  PTW_MANUAL_FACTORS,
  PHANTOM_KZP_IR,
} from '../src/core/brachy-data.js';
import {
  kDec,
  halfLifeDays,
  dateOnlyDecayError,
  parseDateTime,
  certificateToU,
  apparentActivityGBq,
  compareCertificate,
  readingToAmps,
  ksWell,
  isTwTn33004,
  kLeak,
  ksmLookup,
  wellStrength,
  wellCalibration,
  crossCalibrate,
  stabilityCheck,
  computeWell,
  phantomKzp,
  phantomFactor,
  phantomReading,
  phantomStrength,
  phantomOwnFactor,
  phantomDoseRate,
  applicatorKaSteel,
} from '../src/core/brachy.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const rel = (a, b, tolRel, msg) => near(a / b, 1, tolRel, msg);
const DAY = 86400000;

test('TRS-492, табл. 3: периоды полураспада; годы — по 365,242198 сут', () => {
  assert.equal(HALF_LIVES['Ir-192'].days, 73.827);
  assert.equal(HALF_LIVES['Co-60'].days, 1925.21);
  assert.equal(HALF_LIVES['I-125'].days, 59.388);
  assert.equal(HALF_LIVES['Pd-103'].days, 16.991);
  assert.equal(HALF_LIVES['Cs-131'].days, 9.689);
  near(HALF_LIVES['Cs-137'].days, 30.05 * 365.242198, 1e-9);
  near(HALF_LIVES['Sr-90'].days, 28.8 * 365.242198, 1e-9);
  assert.equal(DAYS_PER_YEAR, 365.242198);
  assert.equal(halfLifeDays('Ir-192').days, 73.827);
  assert.deepEqual(halfLifeDays('Ir-192', 73.83), { days: 73.83, own: true });
  assert.ok(halfLifeDays('Xx-1').error);
  assert.ok(halfLifeDays('Ir-192', 0).error);
});

test('TRS-492, ур. (8)–(9): k_dec = 2^((t_meas − t_ref)/t½)', () => {
  const t0 = Date.UTC(2026, 0, 1);
  assert.equal(kDec(t0, t0, 73.827), 1);
  near(kDec(t0 + 73.827 * DAY, t0, 73.827), 2, 1e-12, 'через один период');
  near(kDec(t0, t0 + 73.827 * DAY, 73.827), 0.5, 1e-12, 'на будущее время');
  // дата без времени: принято 00:00, сутки дают для ¹⁹²Ir до 0,94 %
  near(dateOnlyDecayError(73.827) * 100, 0.939, 0.001);
});

test('Сертификат ⁶⁰Co (Co0.A86): таблица распада производителя воспроизводится до 0,01 ГБк', () => {
  // кажущаяся активность 82,66 ГБк на дату сертификата; таблица — на 00:00 первого числа месяца
  const t0 = parseDateTime('2021-10-27').ms;
  const points = [
    ['01.11.2021', 82.51],
    ['01.06.2024', 58.76],
    ['01.11.2026', 42.76],
    ['01.01.2027', 41.83],
  ];
  for (const half of [1925.21, 1925.3]) {
    for (const [d, a] of points) {
      const t = parseDateTime(d).ms;
      near(82.66 / kDec(t, t0, half), a, 0.005, `${d}, t½ = ${half}`);
    }
  }
  // ОМВК 25,29 мГр/ч и Γ_δ = 306 мкГр·м²·ч⁻¹·ГБк⁻¹ → 82,66 ГБк
  const s = certificateToU({ value: 25.29, unit: 'mGy/h' });
  assert.equal(s.U, 25290);
  rel(apparentActivityGBq(s.U, 306), 82.66, 5e-4);
  rel(certificateToU({ value: 82.66, unit: 'GBq', gamma: 306, gammaUnit: 'uGy·m2/(h·GBq)' }).U, 25290, 5e-4);
});

test('Паспорт ¹⁹²Ir: керма 1,79·10⁻⁵ Гр/с на 1 м → 64,44 мГр/ч; распад к дате активности → 535,5 ГБк (паспорт: 537)', () => {
  const s = certificateToU({ value: 1.79e-5, unit: 'Gy/s' });
  near(s.U / 1000, 64.44, 1e-9);
  const tK = parseDateTime('09.10.26 11:00 GMT+3');
  const tA = parseDateTime('20.10.26 8:00 GMT+3');
  assert.ok(tK.zoneGiven && !tK.dateOnly);
  const U = s.U / kDec(tA.ms, tK.ms, 73.827);
  near(U / 1000, 58.185, 0.001);
  // Γ = 30,18 аГр·м²·с⁻¹·Бк⁻¹ = 108,648 мкГр·м²·ч⁻¹·ГБк⁻¹
  const g = certificateToU({ value: 1, unit: 'GBq', gamma: 30.18, gammaUnit: 'aGy·m2/(s·Bq)' }).U;
  near(g, 108.648, 1e-9);
  const A = apparentActivityGBq(U, g);
  near(A, 535.5, 0.1);
  assert.ok(Math.abs(A / 537 - 1) < 0.005, 'расхождение с паспортом — округление, меньше 0,5 %');
  // единицы: 1 Ки = 37 ГБк; 1 U = 1 мкГр/ч на 1 м
  near(certificateToU({ value: 1, unit: 'Ci', gamma: 108.648, gammaUnit: 'uGy·m2/(h·GBq)' }).U, 37 * 108.648, 1e-9);
  assert.equal(certificateToU({ value: 40000, unit: 'U' }).U, 40000);
  assert.ok(certificateToU({ value: 537, unit: 'GBq' }).error, 'активность без Γ');
  assert.ok(certificateToU({ value: 1, unit: 'кг' }).error);
});

test('Дата и время: форматы, часовой пояс, дата без времени', () => {
  const ref = Date.UTC(2026, 9, 20, 5, 0);
  assert.equal(parseDateTime('20.10.26 8:00 GMT+3').ms, ref);
  assert.equal(parseDateTime('20.10.2026 08:00 МСК').ms, ref);
  assert.equal(parseDateTime('2026-10-20T08:00:00+03:00').ms, ref);
  assert.equal(parseDateTime('2026-10-20 05:00 UTC').ms, ref);
  assert.equal(parseDateTime('2026-10-20 05:00Z').ms, ref);
  assert.equal(parseDateTime('2026-10-20 08:00', { defaultOffsetMin: 180 }).ms, ref);
  const noZone = parseDateTime('2026-10-20 05:00');
  assert.equal(noZone.ms, ref);
  assert.equal(noZone.zoneGiven, false);
  const d = parseDateTime('2021-10-27');
  assert.ok(d.dateOnly);
  assert.equal(d.ms, Date.UTC(2021, 9, 27, 0));
  assert.equal(parseDateTime('2021-10-27 UTC+1').ms, Date.UTC(2021, 9, 26, 23));
  assert.ok(parseDateTime('31.02.26').error);
  assert.ok(parseDateTime('20.10.26 25:00').error);
  assert.ok(parseDateTime('20.10.26 8:00 Марс').error);
  assert.ok(parseDateTime('').error);
});

test('TRS-492, табл. 8 и примеры 1–2 разд. 8.3: k_sm,sm0', () => {
  assert.equal(KSM_TABLE.length, KSM_SOURCES.length);
  for (const row of KSM_TABLE) assert.equal(row.length, KSM_SOURCES.length);
  KSM_TABLE.forEach((row, i) => assert.equal(row[i], 1));
  // пример 1: калибровка на Flexisource, измеряется VS2000 → 0,987; пример 2 — наоборот → 1,013
  const ex1 = ksmLookup('vs2000', 'flexisource');
  assert.deepEqual(ex1, { value: 0.987, u: 0.2, inTable: true });
  assert.equal(ksmLookup('flexisource', 'vs2000').value, 1.013);
  assert.equal(ksmLookup('gammamed-pdr', 'flexisource').value, 0.959);
  assert.equal(ksmLookup('gi192m11', 'mhdr-v2').value, 0.999);
  // нет данных: 1 и +2 %; HDR ↔ PDR — 5 %; камера не SI HDR 1000 Plus — таблица не применяется
  assert.deepEqual(ksmLookup('irm-tii192', 'mhdr-v2'), { value: 1, u: 2, inTable: false });
  assert.deepEqual(ksmLookup('irm-tii192', 'gammamed-pdr'), { value: 1, u: 5, inTable: false });
  assert.deepEqual(ksmLookup('vs2000', 'flexisource', { withTable: false }), { value: 1, u: 2, inTable: false });
  assert.equal(ksmLookup('x', 'x').value, 1);
});

test('TRS-492, ур. (33): k_s по двум напряжениям; линейный вариант для TW/TN33004', () => {
  const r = ksWell({ m1: 100.2, m2: 100 });
  near(r.value, 3 / (4 - 1.002), 1e-12);
  near(r.value, 1.000667, 1e-6);
  near(r.linear, 1 / (2 - 1.002), 1e-12);
  assert.equal(r.preferLinear, false);
  assert.match(r.equation, /33/);
  // n = 3 — общая формула TRS-398, ур. (16)
  const g = ksWell({ m1: 100.3, m2: 100, v1: 300, v2: 100 });
  near(g.value, (9 - 1) / (9 - 1.003), 1e-12);
  assert.match(g.equation, /16/);
  assert.equal(isTwTn33004('PTW TW33004'), true);
  assert.equal(isTwTn33004('TN 33004'), true);
  assert.equal(isTwTn33004('TM33004'), false);
  assert.equal(ksWell({ m1: 100.2, m2: 100, model: 'TW33004' }).preferLinear, true);
  assert.ok(ksWell({ m1: 300, m2: 100 }).error);
});

test('Показание, утечка (0,1 %), стабильность (±0,5 %)', () => {
  near(readingToAmps({ value: 60, unit: 'nA' }).amps, 6e-8, 1e-20);
  near(readingToAmps({ value: 600, unit: 'nC', time: 10 }).amps, 6e-8, 1e-20);
  near(readingToAmps({ value: 3.6, unit: 'C', time: 1, timeUnit: 'min' }).amps, 0.06, 1e-15);
  assert.ok(readingToAmps({ value: 600, unit: 'nC' }).error);
  assert.deepEqual(kLeak(100, 0.05), { value: 1, ratio: 0.0005, ignored: true });
  const k = kLeak(100, 0.5);
  near(k.value, 0.995, 1e-12);
  assert.equal(k.ignored, false);
  assert.equal(stabilityCheck(100.4, 100).ok, true);
  assert.equal(stabilityCheck(100.6, 100).ok, false);
});

test('Колодезная камера (N в Гр·м²·ч⁻¹·А⁻¹, как в сертификате PTW): прямой и обратный расчёт', () => {
  // S_K = 40 000 U на t_ref; измерение через 10 суток при 22 °C и 99 кПа (T0 = 20 °C, P0 = 101,325 кПа)
  const N = 9.863e5;
  const kd = 2 ** (10 / 73.827);
  const kTP = ((273.15 + 22) / 293.15) * (101.325 / 99);
  const ks = 3 / (4 - 1.002);
  const amps = (40000e-6 / kd) / N / kTP / ks;
  const tRef = Date.UTC(2026, 9, 20, 5);
  const r = computeWell({
    readings: [amps * 1e9 * 0.9999, amps * 1e9, amps * 1e9 * 1.0001],
    unit: 'nA',
    N,
    nUnit: 'Gy·m2/(h·A)',
    T: 22,
    P: 99,
    ks: { m1: 100.2, m2: 100 },
    tMeas: tRef + 10 * DAY,
    tRef,
    halfDays: 73.827,
    cert: { U: 40000 * 1.02, type: 'hdr' },
  });
  near(r.U, 40000, 1e-6);
  near(r.mGyh, 40, 1e-9);
  near(r.Umeas, 40000 / kd, 1e-6);
  assert.equal(r.messages.filter((m) => m.level === 'error').length, 0);
  near(r.compare.dev, (1 / 1.02 - 1) * 100, 1e-9);
  assert.equal(r.compare.level, 'ok');
  // ур. (23): калибровочный коэффициент по источнику известной силы возвращает N
  rel(wellCalibration({ U: 40000, amps: amps * kTP * ks, kDec: kd }), N, 1e-12);
  // ⁶⁰Co по строке сертификата GK60M21: те же поправки, другой N
  const co = wellStrength({ N: 1.201e6, amps: 20e-9 });
  near(co.mGyh, 1.201e6 * 20e-9 * 1e3, 1e-12);
  // U/нА: 1 U/нА = 10³ Гр·м²·ч⁻¹·А⁻¹
  near(wellStrength({ N: 1, nUnit: 'U/nA', amps: 1e-9 }).U, 1, 1e-12);
  // утечка 0,5 % и нет данных k_sm — замечания
  const w = computeWell({ readings: [50], unit: 'nA', leak: 0.25, N, kSm: { sm: 'irm-tii192', sm0: 'gi192m11' } });
  near(w.factors.kLeak, 0.995, 1e-12);
  assert.ok(w.messages.some((m) => m.level === 'warn'));
  assert.ok(w.messages.some((m) => /8\.3/.test(m.ref ?? '')));
  assert.equal(computeWell({ readings: [], unit: 'nA', N }).messages[0].level, 'error');
});

test('TRS-492, разд. 8.6.2: сравнение с сертификатом — HDR 3/5 %, LDR 5 % и не меньше 5 зёрен', () => {
  assert.equal(compareCertificate({ measured: 102.9, certificate: 100 }).level, 'ok');
  assert.equal(compareCertificate({ measured: 96, certificate: 100 }).level, 'warn');
  assert.equal(compareCertificate({ measured: 106, certificate: 100 }).level, 'error');
  assert.equal(compareCertificate({ measured: 104, certificate: 100, type: 'ldr', seeds: 5 }).level, 'ok');
  assert.equal(compareCertificate({ measured: 104, certificate: 100, type: 'ldr', seeds: 3 }).level, 'warn');
  assert.equal(compareCertificate({ measured: 106, certificate: 100, type: 'ldr', seeds: 5 }).level, 'warn');
  near(compareCertificate({ measured: 97, certificate: 100 }).dev, -3, 1e-12);
});

test('TRS-492, ур. (18): перекрёстная калибровка', () => {
  near(crossCalibrate({ mRef: 50, mField: 25, nRef: 1e6 }), 2e6, 1e-6);
  near(crossCalibrate({ mRef: 50, mField: 25, nRef: 1e6, kSm: 0.987 }), 1.974e6, 1e-6);
});

test('Руководство PTW 9193: множители 0,0666 (N_s), 0,00684 (N_w), 0,00760 (N_a); 4 мГр/ч → 0,974 сГр/мин', () => {
  // ур. (9): N_s в Р/дел., K̇ в мГр/ч → ×1000
  near(phantomFactor({ calib: 'Ns', kzp: PHANTOM_KZP_IR }) * 1e3, PTW_MANUAL_FACTORS.Ns, 5e-5);
  near(phantomFactor({ calib: 'Nw', kzp: PHANTOM_KZP_IR }), PTW_MANUAL_FACTORS.Nw, 5e-6);
  near(phantomFactor({ calib: 'Na', kzp: PHANTOM_KZP_IR }), PTW_MANUAL_FACTORS.Na, 5e-6);
  near(phantomDoseRate(4), 0.974, 5e-4);
  assert.ok(Number.isNaN(phantomDoseRate(4, 'Co-60')));
});

test('DGMP 13, ур. (13), сноска 4, табл. 2.1: k_zp по камере; k_ges совпадает с Ubrich 2012, табл. 2.2', () => {
  const m = phantomKzp('M23332');
  near(m.kzp, 1.187, 1e-12);
  for (const [ch, kges] of Object.entries(UBRICH_KGES_DGMP)) {
    const k = phantomKzp(ch);
    assert.ok(!k.error, ch);
    near(phantomFactor({ calib: 'Nw', kzp: k.kzp }), kges, 6e-7, `PTW ${ch}`);
  }
  // PTW 30013 — та же полость, что у M30001: k_V = 1,0072, k_zp = 1,1911, k_tot = 6,869·10⁻³
  const f = phantomKzp('TM30013');
  assert.equal(f.dgmp, 'M30001');
  assert.equal(f.kV, 1.0072);
  near(f.kzp, 1.1911, 5e-5);
  near(phantomFactor({ calib: 'Nw', kzp: f.kzp }), 6.869e-3, 6e-7);
  assert.ok(phantomKzp('PTW 31013').error);
  assert.deepEqual([phantomKzp('IBA FC65-G').dgmp, phantomKzp('IBA FC65-G').approx, phantomKzp('30013').approx], ['M30001', true, false]);
});

test('⁶⁰Co в фантоме: Azhari 2012 (k_zp = 1,276) → k_tot = 7,370·10⁻³; литература Ubrich 2014 ниже', () => {
  const k = phantomFactor({ calib: 'Nw', kzp: 1.276, nuclide: 'Co-60' });
  near(k, 7.37e-3, 6e-7);
  const az = PHANTOM_CO60_LITERATURE.find((x) => x.method === 'azhari').kTot;
  for (const x of PHANTOM_CO60_LITERATURE.filter((y) => y.method === 'mc')) assert.ok(az / x.kTot - 1 > 0.04, x.chamber);
  near(applicatorKaSteel('Ir-192'), 1.0165, 0);
  near(applicatorKaSteel('Co-60'), 1.0267, 0);
});

test('Фантом: показание (4 положения, транзит, k_τ = 60/τ), сила источника и свой k_tot по колодезной камере', () => {
  const rd = phantomReading({ readings: [10.02, 9.98, 10.01, 9.99], tauMin: 2, transit: 0.05, kRho: 1.01 });
  near(rd.mean, 10, 1e-12);
  near(rd.M, 9.95, 1e-12);
  near(rd.rate, 9.95 * 1.01 * 30, 1e-9);
  const kzp = phantomKzp('30013').kzp;
  const s = phantomStrength({ N: 5.4e-2, rate: rd.rate, calib: 'Nw', kzp });
  near(s.mGyh, phantomFactor({ calib: 'Nw', kzp }) * 5.4e-2 * rd.rate * 1e3, 1e-12);
  near(s.U, s.mGyh * 1e3, 1e-9);
  // k_A стального аппликатора и N в сГр/нКл
  near(phantomStrength({ N: 5.4, nUnit: 'cGy/nC', rate: rd.rate, kzp, kA: 1.0165 }).mGyh, s.mGyh * 1.0165, 1e-9);
  // свой k_tot по сличению возвращает исходные множители
  const own = phantomOwnFactor({ wellMGyh: s.mGyh, N: 5.4e-2, rate: rd.rate });
  near(own.kTot, s.factor, 1e-15);
  near(own.kzp, kzp, 1e-12);
  // ⁶⁰Co: свой k_tot подставляется вместо табличных множителей
  const co = phantomStrength({ N: 5.4e-2, rate: rd.rate, kTot: 7.1e-3, nuclide: 'Co-60' });
  near(co.mGyh, 7.1e-3 * 5.4e-2 * rd.rate * 1e3, 1e-12);
  near(phantomOwnFactor({ wellMGyh: co.mGyh, N: 5.4e-2, rate: rd.rate, nuclide: 'Co-60' }).kzp, 7.1e-3 / phantomFactor({ calib: 'Nw', kzp: 1, nuclide: 'Co-60' }), 1e-12);
});
