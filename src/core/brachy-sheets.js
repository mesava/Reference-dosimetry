// Брахитерапия: расчёт листов «Колодезная камера» и «Фантом PTW 9193» по полям формы (строки, как их вводит
// пользователь). Формулы — core/brachy.js, данные — core/brachy-data.js. Сертификат источника — общий для обоих листов.

import { L } from './i18n.js';
import { parseNumber, isBlank, pressureToKPa, PRESSURE_UNITS, ru } from './units.js';
import { temperaturePressure } from './common.js';
import { HALF_LIVES, KSM_SOURCES, PHANTOM_CO60, PHANTOM_CO60_LITERATURE, APPLICATOR_KA_STEEL } from './brachy-data.js';
import {
  halfLifeDays,
  kDec,
  dateOnlyDecayError,
  parseDateTime,
  certificateToU,
  STRENGTH_UNITS,
  ACTIVITY_UNITS,
  GAMMA_UNITS,
  compareCertificate,
  readingToAmps,
  CURRENT_UNITS,
  kLeak,
  ksWell,
  ksmLookup,
  wellStrength,
  WELL_N_UNITS,
  phantomKzp,
  phantomFactor,
  PHANTOM_N_UNITS,
} from './brachy.js';

const REF = {
  trs492: 'IAEA TRS-492 (2023)',
  dgmp13: 'DGMP-Bericht 13 (1999, испр. изд. 2006)',
  ptw9193: 'руководство PTW 9193 (D402.131.00/05, 2017)',
  azhari: 'Azhari et al. 2012, J. Med. Phys. 37 183–92',
  ubrich14: 'Ubrich et al. 2014, Z. Med. Phys. 24 138–52',
};

const blank3 = () => ['', '', ''];
const hole = () => ({ T: '', P: '', M: blank3() });

/** Поля листов по умолчанию. Значения — строки, как в полях формы. */
export const BRACHY_DEFAULTS = {
  // источник и его сертификат (паспорт)
  nuclide: 'Ir-192',
  half: '', // свой t½, сут (пусто — TRS-492, табл. 3)
  src_name: '', // модель и номер источника
  cert_value: '',
  cert_unit: 'mGy/h', // ключ STRENGTH_UNITS или ACTIVITY_UNITS
  cert_gamma: '', // Γ_δ из сертификата (для активности и для кажущейся активности)
  cert_gamma_unit: 'uGy·m2/(h·GBq)',
  cert_date: '',
  cert_time: '',
  cert_zone: '', // '' — часовой пояс компьютера; 'UTC', '+3', '-5:30' …
  cert_U: '', // расширенная неопределённость сертификата, % (справочно)

  // колодезная камера
  w_model: '',
  w_serial: '',
  w_N: '',
  w_N_unit: 'Gy·m2/(h·A)',
  w_NU: '', // U(k=2) калибровочного коэффициента, %
  w_NAA: '', // N_AA, Бк/А — кажущаяся активность по току (если есть в сертификате)
  w_T0: '20',
  w_P0: '101,325',
  w_P0_unit: 'kPa',
  w_kelec: '1',
  w_ksm_mode: 'none', // 'none' — данных нет (1 и +2 %), 'table' — TRS-492, табл. 8, 'manual'
  w_sm: '',
  w_sm0: '',
  w_ksm: '',
  w_date: '',
  w_time: '',
  w_zone: '',
  w_T: '',
  w_P: '',
  w_P_unit: 'hPa',
  w_unit: 'nA',
  w_I: ['', '', '', '', ''],
  w_leak: '',
  w_pol_plus: '',
  w_pol_minus: '',
  w_ks_m1: '',
  w_ks_m2: '',
  w_ks_v1: '400',
  w_ks_v2: '200',

  // фантом PTW 9193
  p_model: '',
  p_serial: '',
  p_calib: 'Nw', // 'Nw' | 'Na' | 'Ns'
  p_N: '',
  p_N_unit: 'mGy/nC',
  p_T0: '20',
  p_P0: '101,325',
  p_P0_unit: 'kPa',
  p_kQ: '1',
  p_kelec: '1',
  p_tau: '1', // время облучения в каждом положении, мин
  p_date: '',
  p_time: '',
  p_zone: '',
  p_P_unit: 'kPa',
  p_holes: [hole(), hole(), hole(), hole()],
  p_transit: '', // заряд за перемещение источника, нКл
  p_v1: '300',
  p_v2: '150',
  p_pol_plus: blank3(), // при +V1
  p_pol_minus: blank3(), // при −V1
  p_ks_v2: blank3(), // при +V2
  p_kzp: '', // свой k_zp (пусто — по камере, DGMP 13)
  p_ka: 'none', // 'none' | 'steel' | 'manual'
  p_ka_value: '',
  p_main: '', // основной вариант
  p_ktot: '', // свой k_tot (по сличению с колодезной камерой)
  p_wellK: '', // ОМВК по колодезной камере на время измерения в фантоме, мГр/ч — для своего k_tot
};

/** Нормализация черновика: недостающие поля — по умолчанию, массивы — нужной формы. */
export function normalizeBrachy(input) {
  const f = { ...structuredClone(BRACHY_DEFAULTS), ...(input && typeof input === 'object' ? input : {}) };
  for (const [k, v] of Object.entries(BRACHY_DEFAULTS)) {
    if (Array.isArray(v) && !Array.isArray(f[k])) f[k] = structuredClone(v);
    else if (!Array.isArray(v) && typeof f[k] !== 'string') f[k] = f[k] == null ? v : String(f[k]);
  }
  f.p_holes = Array.from({ length: 4 }, (_, i) => {
    const h = f.p_holes[i] && typeof f.p_holes[i] === 'object' ? f.p_holes[i] : {};
    return { T: String(h.T ?? ''), P: String(h.P ?? ''), M: Array.isArray(h.M) && h.M.length ? h.M.map(String) : blank3() };
  });
  if (!Object.hasOwn(HALF_LIVES, f.nuclide)) f.nuclide = 'Ir-192';
  return f;
}

const nums = (arr) => (arr ?? []).map(parseNumber).filter(Number.isFinite);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs) => (xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean(xs)) ** 2, 0) / (xs.length - 1)) : 0);

/** Строка смещения часового пояса для parseDateTime: '' → без пояса (берётся пояс компьютера). */
const zoneText = (z) => {
  const s = String(z ?? '').trim();
  if (!s) return '';
  return s === 'UTC' ? 'UTC' : `UTC${/^[+-]/.test(s) ? s : `+${s}`}`;
};

/** Дата (yyyy-mm-dd), время (hh:mm) и пояс поля → мс UTC; offsetMin — пояс компьютера на эту дату. */
export function fieldTime(date, time, zone, offsetMin) {
  if (isBlank(date)) return { ms: NaN, missing: true };
  const s = `${String(date).trim()}${isBlank(time) ? '' : ` ${String(time).trim()}`}${zoneText(zone) ? ` ${zoneText(zone)}` : ''}`;
  return parseDateTime(s, { defaultOffsetMin: offsetMin });
}

function makeAdd(messages) {
  return (level, text, ref = null, field = null) => messages.push({ level, scope: 'brachy', text, ref, field });
}

function readPressure(raw, unit, add, field, what) {
  const v = parseNumber(raw);
  if (!Number.isFinite(v)) return NaN;
  if (!Object.hasOwn(PRESSURE_UNITS, unit)) {
    add('error', L(`Неизвестная единица давления (${what}).`, `Unknown pressure unit (${what}).`), null, field);
    return NaN;
  }
  return pressureToKPa(v, unit);
}

/**
 * Сертификат источника: сила на дату сертификата (U), время, t½ и замечания. Общая часть обоих листов.
 * @returns {{ U:number, tCert:number, half:number, gammaUperGBq:number, uCert:number, ok:boolean }}
 */
export function readCertificate(f, add, offsetMin) {
  const out = { U: NaN, tCert: NaN, half: NaN, gammaUperGBq: NaN, uCert: parseNumber(f.cert_U), ok: false };
  const h = halfLifeDays(f.nuclide, isBlank(f.half) ? undefined : parseNumber(f.half));
  if (h.error) add('error', L(`Период полураспада: ${h.error}.`, `Half-life: ${h.error}.`), null, 'half');
  out.half = h.days;
  const g = parseNumber(f.cert_gamma);
  if (Number.isFinite(g) && g > 0 && Object.hasOwn(GAMMA_UNITS, f.cert_gamma_unit)) out.gammaUperGBq = g * GAMMA_UNITS[f.cert_gamma_unit].toUperGBq;
  if (isBlank(f.cert_value)) return out;
  const c = certificateToU({ value: parseNumber(f.cert_value), unit: f.cert_unit, gamma: g, gammaUnit: f.cert_gamma_unit });
  if (c.error) {
    add('error', L(`Сертификат источника: ${c.error}.`, `Source certificate: ${c.error}.`), null, c.fromActivity ? 'cert_gamma' : 'cert_value');
    return out;
  }
  if (c.fromActivity) {
    add('info', L('Сила источника получена из активности через Γ_δ сертификата: активность — производная величина, для сравнения лучше ОМВК или S_K из сертификата.', 'The source strength is derived from the activity via the certificate Γ_δ: the activity is a derived quantity; the RAKR or S_K from the certificate is better for the comparison.'), `${REF.trs492}, прил. I; разд. 8.6.2`, 'cert_unit');
  }
  out.U = c.U;
  const t = fieldTime(f.cert_date, f.cert_time, f.cert_zone, offsetMin);
  if (t.missing) {
    add('warn', L('Не указана дата сертификата источника: сравнение с сертификатом невозможно.', 'The source certificate date is not given: no comparison with the certificate.'), null, 'cert_date');
    return out;
  }
  if (t.error) {
    add('error', L(`Дата сертификата: ${t.error}.`, `Certificate date: ${t.error}.`), null, 'cert_date');
    return out;
  }
  if (t.dateOnly && Number.isFinite(out.half)) {
    add('warn', L(`Время в сертификате не указано — принято 00:00 (так считает таблица распада производителя). Если на самом деле позже, ошибка распада — до ${ru(dateOnlyDecayError(out.half) * 100, 2)} % за сутки.`, `The certificate time is not given; 00:00 is assumed (as in the manufacturer's decay table). If it is actually later, the decay error is up to ${(dateOnlyDecayError(out.half) * 100).toFixed(2)}% per day.`), `${REF.trs492}, разд. 7.3`, 'cert_time');
  }
  out.tCert = t.ms;
  out.ok = Number.isFinite(out.half);
  return out;
}

/** Время измерения листа (prefix w_ или p_). */
function readMeasTime(f, pre, add, offsetMin) {
  const t = fieldTime(f[`${pre}date`], f[`${pre}time`], f[`${pre}zone`], offsetMin);
  if (t.missing) return NaN;
  if (t.error) {
    add('error', L(`Дата измерения: ${t.error}.`, `Measurement date: ${t.error}.`), null, `${pre}date`);
    return NaN;
  }
  if (t.dateOnly) add('warn', L('Не указано время измерения: для ¹⁹²Ir час даёт около 0,04 % распада.', 'The measurement time is not given: for ¹⁹²Ir one hour is about 0.04% of decay.'), `${REF.trs492}, разд. 7.3`, `${pre}time`);
  return t.ms;
}

/** Ожидаемая по сертификату сила источника на время измерения и сравнение (TRS-492, ур. 8–9, разд. 8.6.2). */
function certCompare(cert, tMeas, U, add, type = 'hdr') {
  if (!cert.ok || !Number.isFinite(tMeas) || !Number.isFinite(U)) return null;
  const expected = cert.U / kDec(tMeas, cert.tCert, cert.half);
  const days = (tMeas - cert.tCert) / 86400000;
  if (days < -1) add('warn', L('Измерение раньше даты сертификата: проверьте даты.', 'The measurement is before the certificate date: check the dates.'), null, 'cert_date');
  const cmp = compareCertificate({ measured: U, certificate: expected, type });
  add(cmp.level === 'ok' ? 'info' : cmp.level, cmp.text, cmp.ref);
  return { expected, days, ...cmp };
}

// ——— Колодезная камера ———

/**
 * Лист «Колодезная камера»: TRS-492, гл. 8. offsetMin — смещение пояса компьютера от UTC, мин.
 * @returns {object} { ok, mGyh, U, Uref, A, factors, readings, compare, messages }
 */
export function computeBrachyWell(input, { offsetMin = 0 } = {}) {
  const f = normalizeBrachy(input);
  const messages = [];
  const add = makeAdd(messages);
  const cert = readCertificate(f, add, offsetMin);
  const out = { ok: false, messages, cert };
  const N = parseNumber(f.w_N);
  if (!(N > 0)) {
    add(isBlank(f.w_N) ? 'info' : 'error', L('Введите калибровочный коэффициент камеры из её сертификата (строка «аппарат + адаптер + нуклид»).', 'Enter the chamber calibration coefficient from its certificate (the row for afterloader + adapter + nuclide).'), null, 'w_N');
    return out;
  }
  if (!Object.hasOwn(WELL_N_UNITS, f.w_N_unit)) add('error', L('Неизвестная единица калибровочного коэффициента.', 'Unknown calibration coefficient unit.'), null, 'w_N_unit');
  const xs = nums(f.w_I);
  if (!xs.length) {
    add('info', L('Введите показания электрометра в точке максимального отклика.', 'Enter the electrometer readings at the sweet spot.'), null, 'w_I');
    return out;
  }
  if (xs.length < 3) add('warn', L('Меньше трёх показаний: повторяемость не оценить.', 'Fewer than three readings: the repeatability cannot be assessed.'), null, 'w_I');
  if (!Object.hasOwn(CURRENT_UNITS, f.w_unit)) {
    add('error', L('Неизвестная единица тока.', 'Unknown current unit.'), null, 'w_unit');
    return out;
  }
  const m = mean(xs);
  const amps = readingToAmps({ value: m, unit: f.w_unit }).amps;
  out.readings = { n: xs.length, mean: m, relSd: Math.abs(sd(xs) / m) * 100 };
  if (out.readings.relSd > 0.5) add('warn', L(`Разброс показаний ${ru(out.readings.relSd, 2)} % — больше 0,5 %: проверьте прогрев и положение источника.`, `Reading spread ${out.readings.relSd.toFixed(2)}% exceeds 0.5%: check the warm-up and the source position.`), `${REF.trs492}, разд. 8.4`, 'w_I');

  const leak = parseNumber(f.w_leak);
  const kl = kLeak(amps, Number.isFinite(leak) ? readingToAmps({ value: leak, unit: f.w_unit }).amps : NaN);
  if (Number.isFinite(leak) && leak !== 0) {
    if (kl.ignored) add('info', L(`Утечка ${ru(kl.ratio * 100, 3)} % показания — меньше 0,1 %, не учитывается.`, `Leakage is ${(kl.ratio * 100).toFixed(3)}% of the reading, below 0.1%; it is ignored.`), `${REF.trs492}, разд. 8.2.3.4`, 'w_leak');
    else add('info', L(`Утечка ${ru(kl.ratio * 100, 2)} % показания — вычтена (k_leak = ${ru(kl.value, 4)}).`, `Leakage is ${(kl.ratio * 100).toFixed(2)}% of the reading; subtracted (k_leak = ${kl.value.toFixed(4)}).`), `${REF.trs492}, разд. 8.2.3.4`, 'w_leak');
  }

  // k_TP
  let kTP = 1;
  const T = parseNumber(f.w_T);
  const P = readPressure(f.w_P, f.w_P_unit, add, 'w_P', L('измерение', 'measurement'));
  const T0 = parseNumber(f.w_T0);
  const P0 = readPressure(f.w_P0, f.w_P0_unit, add, 'w_P0', L('сертификат камеры', 'chamber certificate'));
  if (Number.isFinite(T) && Number.isFinite(P) && Number.isFinite(T0) && Number.isFinite(P0)) kTP = temperaturePressure({ T, P, T0, P0, abs0: 273.15 });
  else add('warn', L('Нет температуры или давления: k_TP = 1. Камера открытая — поправка нужна (TRS-492, ур. 28).', 'No temperature or pressure: k_TP = 1. The chamber is vented, so the correction is needed (TRS-492, Eq. 28).'), `${REF.trs492}, разд. 8.2.3.1`, 'w_T');
  if (T0 === 22) add('info', L('T0 = 22 °C: так калибруют в Северной Америке; ошибка в T0 на 2 °C — около 0,7 %.', 'T0 = 22 °C is used in North America; a 2 °C error in T0 is about 0.7%.'), `${REF.trs492}, разд. 8.2.3.1`, 'w_T0');

  // k_pol
  let kPol = 1;
  const mp = parseNumber(f.w_pol_plus);
  const mm = parseNumber(f.w_pol_minus);
  if (Number.isFinite(mp) && Number.isFinite(mm) && mp !== 0) kPol = (Math.abs(mp) + Math.abs(mm)) / (2 * Math.abs(mp));

  // k_s
  let kS = 1;
  let ksInfo = null;
  const m1 = parseNumber(f.w_ks_m1);
  const m2 = parseNumber(f.w_ks_m2);
  if (Number.isFinite(m1) && Number.isFinite(m2)) {
    const r = ksWell({ m1, m2, v1: parseNumber(f.w_ks_v1), v2: parseNumber(f.w_ks_v2), model: f.w_model });
    if (r.error) add('error', L(`k_s: ${r.error}.`, `k_s: ${r.error}.`), `${REF.trs492}, разд. 8.2.3.7`, 'w_ks_m1');
    else {
      kS = r.preferLinear ? r.linear : r.value;
      ksInfo = r;
      if (r.preferLinear) add('info', L(`PTW TW/TN33004: k_s по линейной зависимости 1/I от 1/V (Schüller et al. 2015) = ${ru(r.linear, 4)}; по ур. (33) было бы ${ru(r.value, 4)}.`, `PTW TW/TN33004: k_s from the linear 1/I vs 1/V (Schüller et al. 2015) = ${r.linear.toFixed(4)}; Eq. (33) would give ${r.value.toFixed(4)}.`), `${REF.trs492}, разд. 8.2.3.7`, 'w_ks_m1');
    }
  }
  const kElec = isBlank(f.w_kelec) ? 1 : parseNumber(f.w_kelec);
  if (!(kElec > 0)) add('error', L('k_elec должен быть больше нуля.', 'k_elec must be greater than zero.'), null, 'w_kelec');

  // k_sm
  let kSm = 1;
  let ksmU = 0;
  if (f.w_ksm_mode === 'manual') {
    kSm = parseNumber(f.w_ksm);
    if (!(kSm > 0)) add('error', L('Введите k_sm,sm0.', 'Enter k_sm,sm0.'), null, 'w_ksm');
  } else if (f.w_ksm_mode !== 'same') {
    const k = ksmLookup(f.w_sm, f.w_sm0, { withTable: f.w_ksm_mode === 'table' });
    kSm = k.value;
    ksmU = k.u;
    if (k.inTable && kSm !== 1) add('info', L(`k_sm,sm0 = ${ru(kSm, 3)} по TRS-492, табл. 8 (только SI HDR 1000 Plus с держателем 70010).`, `k_sm,sm0 = ${kSm.toFixed(3)} from TRS-492, Table 8 (SI HDR 1000 Plus with holder 70010 only).`), `${REF.trs492}, табл. 8`, 'w_sm');
    if (!k.inTable) add('info', L(`Источник другой модели, чем при калибровке камеры, а данных о поправке нет: k_sm,sm0 = 1, к неопределённости добавляется ${ru(k.u, 0)} %.`, `The source model differs from the calibration source and no correction data exist: k_sm,sm0 = 1, ${k.u}% is added to the uncertainty.`), `${REF.trs492}, разд. 8.3`, 'w_ksm_mode');
  }

  const tMeas = readMeasTime(f, 'w_', add, offsetMin);
  const r = wellStrength({ N, nUnit: f.w_N_unit, amps, kTP, kLeak: kl.value, kElec, kPol, kS, kSm });
  out.ok = Number.isFinite(r.mGyh);
  out.mGyh = r.mGyh;
  out.U = r.U;
  out.tMeas = tMeas;
  out.factors = { kTP, kLeak: kl.value, kElec, kPol, kS, kSm, ksmU, ks: ksInfo };
  out.amps = amps;
  // кажущаяся активность — только справочно (TRS-492, прил. I)
  const NAA = parseNumber(f.w_NAA);
  if (NAA > 0) out.A = (amps * kTP * kl.value * kElec * kPol * kS * NAA) / 1e9;
  else if (cert.gammaUperGBq > 0) out.A = r.U / cert.gammaUperGBq;
  out.Uref = cert.ok && Number.isFinite(tMeas) ? r.U * kDec(tMeas, cert.tCert, cert.half) : NaN;
  out.compare = certCompare(cert, tMeas, r.U, add);
  if (cert.ok && !Number.isFinite(tMeas) && Number.isFinite(cert.U)) add('warn', L('Не указана дата измерения: сравнение с сертификатом невозможно.', 'The measurement date is not given: no comparison with the certificate.'), null, 'w_date');
  const wNU = parseNumber(f.w_NU);
  if (wNU > 0) out.NU = wNU;
  return out;
}

// ——— Фантом PTW 9193 ———

/** Варианты коэффициентов для фантома по нуклиду и типу калибровки: [{ id, label, factor, kA, ref, note }]. */
export function phantomVariants({ nuclide, calib, kzpChamber, kzpOwn, kQ = 1, ka, ktotOwn }) {
  const list = [];
  const ir = nuclide === 'Ir-192';
  const kzp = Number.isFinite(kzpOwn) ? kzpOwn : ir ? kzpChamber : PHANTOM_CO60.kzpAzhari;
  const kzpNote = Number.isFinite(kzpOwn) ? L('свой k_zp', 'own k_zp') : ir ? L('k_zp по камере, DGMP 13', 'k_zp by chamber, DGMP 13') : L('k_zp = 1,276 (Azhari 2012)', 'k_zp = 1.276 (Azhari 2012)');
  if (Number.isFinite(kzp)) {
    const c = phantomFactor({ calib, kzp, kQ, nuclide });
    list.push({ id: 'dgmp', label: ir ? L('DIN 6809-2 / DGMP 13 / руководство PTW', 'DIN 6809-2 / DGMP 13 / PTW manual') : L('DIN 6809-2, постоянные ⁶⁰Co по Azhari', 'DIN 6809-2, ⁶⁰Co constants per Azhari'), factor: c, kA: 1, kzp, note: kzpNote, ref: ir ? `${REF.dgmp13}, ур. (13)–(16); ${REF.ptw9193}` : `${REF.azhari}, табл. 2` });
    const kaSteel = APPLICATOR_KA_STEEL[nuclide];
    if (kaSteel) list.push({ id: 'dgmp-ka', label: L('то же со стальным аппликатором (k_A, Azhari)', 'same with a steel applicator (k_A, Azhari)'), factor: c, kA: kaSteel, kzp, note: kzpNote, ref: `${REF.azhari}, табл. 2` });
    if (ka > 0 && ka !== 1 && ka !== kaSteel) list.push({ id: 'dgmp-own-ka', label: L('то же со своим k_A', 'same with own k_A'), factor: c, kA: ka, kzp, note: kzpNote, ref: null });
  }
  if (!ir && calib === 'Nw') {
    for (const x of PHANTOM_CO60_LITERATURE.filter((y) => y.method !== 'azhari')) {
      list.push({ id: `ubrich-${x.method}-${x.chamber}`, label: x.method === 'mc' ? L(`Ubrich 2014, Монте-Карло, PTW ${x.chamber}`, `Ubrich 2014, Monte Carlo, PTW ${x.chamber}`) : L(`Ubrich 2014, калибровка PTB, PTW ${x.chamber}`, `Ubrich 2014, PTB calibration, PTW ${x.chamber}`), factor: x.kTot, kA: 1, ref: x.ref, note: L('для камеры из статьи', 'for the chamber in the paper') });
    }
  }
  if (Number.isFinite(ktotOwn) && ktotOwn > 0) list.push({ id: 'own', label: L('свой k_tot (сличение с колодезной камерой)', 'own k_tot (comparison with the well-type chamber)'), factor: ktotOwn, kA: 1, ref: null, note: '' });
  return list;
}

/**
 * Лист «Фантом PTW 9193»: DGMP 13 / руководство PTW; 4 положения камеры, у каждого свои T и P (пусто — как у предыдущего).
 * @returns {object} { ok, rate, Dw, variants, main, compare, ktotFromWell, messages }
 */
export function computeBrachyPhantom(input, { offsetMin = 0 } = {}) {
  const f = normalizeBrachy(input);
  const messages = [];
  const add = makeAdd(messages);
  const cert = readCertificate(f, add, offsetMin);
  const out = { ok: false, messages, cert, variants: [] };
  const ir = f.nuclide === 'Ir-192';
  if (!['Ir-192', 'Co-60'].includes(f.nuclide)) {
    add('error', L('Метод фантома PTW 9193 — только для ¹⁹²Ir и ⁶⁰Co.', 'The PTW 9193 phantom method is for ¹⁹²Ir and ⁶⁰Co only.'), null, 'nuclide');
    return out;
  }
  const N0 = parseNumber(f.p_N);
  if (!(N0 > 0)) {
    add(isBlank(f.p_N) ? 'info' : 'error', L('Введите калибровочный коэффициент камеры (⁶⁰Co).', 'Enter the chamber calibration coefficient (⁶⁰Co).'), null, 'p_N');
    return out;
  }
  if (!Object.hasOwn(PHANTOM_N_UNITS, f.p_N_unit)) {
    add('error', L('Неизвестная единица калибровочного коэффициента.', 'Unknown calibration coefficient unit.'), null, 'p_N_unit');
    return out;
  }
  const exposure = f.p_N_unit.startsWith('R');
  if (exposure !== (f.p_calib === 'Ns')) {
    add('error', L('Единица не соответствует типу калибровки: N_s — Р/нКл, N_w и N_a — Гр/нКл.', 'The unit does not match the calibration type: N_s in R/nC, N_w and N_a in Gy/nC.'), null, 'p_N_unit');
    return out;
  }
  const tau = parseNumber(f.p_tau);
  if (!(tau > 0)) {
    add('error', L('Время облучения в положении должно быть больше нуля.', 'The irradiation time per position must be greater than zero.'), null, 'p_tau');
    return out;
  }
  const T0 = parseNumber(f.p_T0);
  const P0 = readPressure(f.p_P0, f.p_P0_unit, add, 'p_P0', L('сертификат камеры', 'chamber certificate'));
  const transit = isBlank(f.p_transit) ? 0 : parseNumber(f.p_transit);
  if (!Number.isFinite(transit)) add('error', L('Не удалось прочитать заряд за перемещение источника.', 'Could not read the transit charge.'), null, 'p_transit');

  // положения камеры
  const holes = [];
  let lastT = NaN;
  let lastP = NaN;
  f.p_holes.forEach((h, i) => {
    const xs = nums(h.M);
    const T = isBlank(h.T) ? lastT : parseNumber(h.T);
    const P = isBlank(h.P) ? lastP : readPressure(h.P, f.p_P_unit, add, `p_hole${i}`, L('измерение', 'measurement'));
    lastT = T;
    lastP = P;
    if (!xs.length) return;
    const kTP = Number.isFinite(T) && Number.isFinite(P) && Number.isFinite(T0) && Number.isFinite(P0) ? temperaturePressure({ T, P, T0, P0, abs0: 273.15 }) : NaN;
    const m = mean(xs) - (Number.isFinite(transit) ? transit : 0);
    holes.push({ i, n: xs.length, raw: mean(xs), M: m, kTP, corr: m * kTP, relSd: Math.abs(sd(xs) / mean(xs)) * 100 });
  });
  out.holes = holes;
  if (!holes.length) {
    add('info', L('Введите заряды в четырёх положениях камеры.', 'Enter the charges at the four chamber positions.'), null, 'p_hole0');
    return out;
  }
  if (holes.some((h) => !Number.isFinite(h.kTP))) {
    add('error', L('Нет температуры или давления для положения камеры: введите их хотя бы в первом положении.', 'No temperature or pressure for a chamber position: enter them at least for the first position.'), null, 'p_hole0');
    return out;
  }
  if (holes.length < 4) add('warn', L(`Измерено ${holes.length} положения из 4: руководство PTW требует среднее по четырём положениям через 90°.`, `${holes.length} of 4 positions were measured: the PTW manual requires the mean over four positions 90° apart.`), REF.ptw9193, 'p_hole0');
  const meanCorr = mean(holes.map((h) => h.corr));
  const spread = holes.length > 1 ? ((Math.max(...holes.map((h) => h.corr)) - Math.min(...holes.map((h) => h.corr))) / meanCorr) * 100 : 0;
  out.spread = spread;
  if (spread > 3) add('warn', L(`Разброс между положениями ${ru(spread, 1)} %: проверьте положение аппликатора в центре фантома.`, `The spread between positions is ${spread.toFixed(1)}%: check that the applicator is in the centre of the phantom.`), REF.ptw9193, 'p_hole0');

  // k_pol, k_s
  const mp = mean(nums(f.p_pol_plus));
  const mm = mean(nums(f.p_pol_minus));
  const m2 = mean(nums(f.p_ks_v2));
  const kPol = Number.isFinite(mp) && Number.isFinite(mm) && mp !== 0 ? (Math.abs(mp) + Math.abs(mm)) / (2 * Math.abs(mp)) : 1;
  let kS = 1;
  if (Number.isFinite(mp) && Number.isFinite(m2)) {
    const r = ksWell({ m1: mp, m2, v1: parseNumber(f.p_v1), v2: parseNumber(f.p_v2) });
    if (r.error) add('error', L(`k_s: ${r.error}.`, `k_s: ${r.error}.`), null, 'p_ks_v2');
    else kS = r.value;
  }
  const kElec = isBlank(f.p_kelec) ? 1 : parseNumber(f.p_kelec);
  const kQ = isBlank(f.p_kQ) ? 1 : parseNumber(f.p_kQ);
  const rate = meanCorr * kPol * kS * kElec * (60 / tau); // нКл/ч
  out.factors = { kPol, kS, kElec, kQ, tau, transit };
  out.rate = rate;
  const N = N0 * PHANTOM_N_UNITS[f.p_N_unit].toBase; // Гр/нКл или Р/нКл

  // мощность дозы в воде в точке измерения (только N_w): Ḋ = N_D,w · Ṁ
  if (f.p_calib === 'Nw') out.Dw = (N * rate * kQ * 1e3) / 60; // мГр/мин

  // варианты
  const kc = phantomKzp(f.p_model);
  const kzpOwn = isBlank(f.p_kzp) ? NaN : parseNumber(f.p_kzp);
  if (ir && !Number.isFinite(kzpOwn) && kc.error) add('warn', L(`k_zp: ${kc.error}.`, `k_zp: ${kc.error}.`), `${REF.dgmp13}, табл. 2.1`, 'p_kzp');
  if (ir && kc.approx && !Number.isFinite(kzpOwn)) add('warn', L(`Для этой камеры в DGMP 13 данных нет: k_V взят у ${kc.dgmp} — полость близка по размерам (приближённо). Точнее — свой k_tot сличением с колодезной камерой.`, `DGMP 13 has no data for this chamber: k_V is taken from ${kc.dgmp}, whose cavity is similar in size (approximate). Your own k_tot from comparison with the well-type chamber is more accurate.`), `${REF.dgmp13}, табл. 2.1–2.2`, 'p_model');
  else if (ir && kc.dgmp && !Number.isFinite(kzpOwn) && kc.dgmp !== 'M23332') add('info', L(`Камера → ${kc.dgmp} в DGMP 13: k_V = ${ru(kc.kV, 4)}, k_zp = 1,187·${ru(kc.kV, 4)}/1,0037 = ${ru(kc.kzp, 4)}.`, `Chamber → ${kc.dgmp} in DGMP 13: k_V = ${kc.kV.toFixed(4)}, k_zp = 1.187·${kc.kV.toFixed(4)}/1.0037 = ${kc.kzp.toFixed(4)}.`), `${REF.dgmp13}, ур. (13), сноска 4, табл. 2.1`, 'p_model');
  const ka = f.p_ka === 'steel' ? APPLICATOR_KA_STEEL[f.nuclide] : f.p_ka === 'manual' ? parseNumber(f.p_ka_value) : 1;
  const ktotOwn = parseNumber(f.p_ktot);
  const vars = phantomVariants({ nuclide: f.nuclide, calib: f.p_calib, kzpChamber: kc.kzp, kzpOwn, kQ, ka, ktotOwn });
  out.variants = vars.map((v) => {
    const mGyh = v.factor * N * rate * v.kA * 1e3;
    return { ...v, mGyh, U: mGyh * 1e3 };
  });
  // свой k_tot по колодезной камере на то же время (N_w)
  const wellK = parseNumber(f.p_wellK);
  if (wellK > 0) out.ktotFromWell = wellK / 1e3 / (N * rate);

  const tMeas = readMeasTime(f, 'p_', add, offsetMin);
  out.tMeas = tMeas;
  const main = out.variants.find((v) => v.id === f.p_main) ?? (ir ? out.variants.find((v) => v.id === 'dgmp') : null) ?? (out.variants.find((v) => v.id === 'own') ?? null);
  out.main = main;
  // сравнение каждого варианта с сертификатом
  if (cert.ok && Number.isFinite(tMeas)) {
    const expected = cert.U / kDec(tMeas, cert.tCert, cert.half);
    out.expected = expected;
    for (const v of out.variants) v.dev = ((v.U - expected) / expected) * 100;
  }
  if (!main) {
    add('info', L('Для ⁶⁰Co в DGMP 13 данных нет: выберите основной вариант в таблице или определите свой k_tot сличением с колодезной камерой на том же источнике.', 'DGMP 13 has no data for ⁶⁰Co: choose the main variant in the table or determine your own k_tot by comparison with the well-type chamber on the same source.'), `${REF.ubrich14}; ${REF.azhari}`, 'p_main');
    return out;
  }
  out.ok = Number.isFinite(main.mGyh);
  out.mGyh = main.mGyh;
  out.U = main.U;
  if (cert.gammaUperGBq > 0) out.A = main.U / cert.gammaUperGBq;
  out.compare = certCompare(cert, tMeas, main.U, add);
  if (cert.ok && !Number.isFinite(tMeas)) add('warn', L('Не указана дата измерения: сравнение с сертификатом невозможно.', 'The measurement date is not given: no comparison with the certificate.'), null, 'p_date');
  return out;
}

export { STRENGTH_UNITS, ACTIVITY_UNITS, GAMMA_UNITS, WELL_N_UNITS, PHANTOM_N_UNITS, CURRENT_UNITS, KSM_SOURCES };
