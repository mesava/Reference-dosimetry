// Брахитерапия: расчёт листов «Колодезная камера» и «Фантом PTW 9193» по полям формы (строки, как их вводит
// пользователь). Формулы — core/brachy.js, данные — core/brachy-data.js. Сертификат источника — общий для обоих листов.

import { L } from './i18n.js';
import { parseNumber, isBlank, pressureToKPa, PRESSURE_UNITS, ru } from './units.js';
import { temperaturePressure } from './common.js';
import { HALF_LIVES, KSM_SOURCES, STABILITY_TOL, WELL_REPEAT, GL_R_IR, GL_R_CO, GL_TABLE, GL_REF, PHANTOM_CO60, PHANTOM_CO60_LITERATURE, PHANTOM_IR_LITERATURE, APPLICATOR_KA_STEEL, DOSE_SOURCES, UBRICH_KTOT_DW1, UBRICH_KTOT_DW1_REF } from './brachy-data.js';
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
  wellDoseRate,
  isDwUnit,
  WELL_N_UNITS,
  phantomKzp,
  phantomFactor,
  PHANTOM_N_UNITS,
  tg43Transverse,
  sweetSpot,
  responseAt,
  strengthAt,
  timeForStrength,
  decayDates,
  crossCalibrate,
  wellRepeatability,
  geometryLineAt,
  geometryLine,
  interpTable,
} from './brachy.js';
import { hebdF, HEBD_F } from './brachy-hebd-f.js';

const REF = {
  trs492: 'IAEA TRS-492 (2023)',
  dgmp13: 'DGMP-Bericht 13 (1999, испр. изд. 2006)',
  ptw9193: 'руководство PTW 9193 (D402.131.00/05, 2017)',
  azhari: 'Azhari et al. 2012, J. Med. Phys. 37 183–92',
  ubrich14: 'Ubrich et al. 2014, Z. Med. Phys. 24 138–52',
  hebd: 'Perez-Calatayud et al. 2012, AAPM Report 229 (HEBD, AAPM/ESTRO)',
  tg43: 'Rivard et al. 2004, Med. Phys. 31 633–74 (TG-43U1)',
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
  cert_U: '', // расширенная неопределённость сертификата, % — для проверки согласия (TRS-492, разд. 8.6.2.1)
  cert_k: '2', // коэффициент охвата этой неопределённости: '2' или '3'
  // выбор из «Оборудования» (с 0.75.0): id афтерлоадера и источника ('' — по дате измерения), камер и строк сертификата
  j_machine: '',
  j_source: '',
  j_well: '',
  j_row: '',
  j_phantom: '',
  j_ref: '',
  j_ref_row: '',
  j_fld: '',
  j_fld_row: '',
  // запись в журнал (с 0.76.0): кто выполнил, примечание
  rec_staff: '',
  rec_notes: '',

  // колодезная камера
  w_model: '',
  w_serial: '',
  w_N: '',
  w_N_unit: 'Gy·m2/(h·A)', // с 0.79.0 и Гр·ч⁻¹·А⁻¹ — калибровка в Ḋw (TRS-492, разд. 7.4)
  w_src: '', // модель источника для Λ при калибровке в Ḋw (DOSE_SOURCES; 'other' — свой Λ); пусто — как на листах фантома и TG-43
  w_lambda: '', // свой Λ, сГр·ч⁻¹·Ед⁻¹
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
  w_I: ['', '', '', '', ''], // введение источника 1 (TRS-492, разд. 8.2.2)
  w_I2: ['', '', '', '', ''], // введение 2
  w_I3: ['', '', '', '', ''], // введение 3
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
  p_NU: '', // U(N) камеры в фантоме, k = 2, % (для бюджета неопределённости)
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
  // поглощённая доза в воде: модель источника (DOSE_SOURCES) или 'other' — свои Λ, L, g_L(8 см)
  p_src: '',
  p_lambda: '',
  p_L: '',
  p_gL8: '',

  // максимум отклика колодезной камеры: положения источника, мм, и показания
  s_x: ['', '', '', '', ''],
  s_M: ['', '', '', '', ''],
  s_step: '2,5',
  s_unit: 'nA',
  s_ref: '', // система отсчёта положения (например, «по пульту аппарата, от конца канала»)
  s_date: '',
  s_cert_pos: '', // положение опорной точки в сертификате камеры, мм
  s_method: 'trs', // 'trs' — парабола по ±20 мм (TRS-492, ур. 25–26), 'ivb' — первый локальный максимум от входа (SI IVB 1000)
  s_entry: 'low', // для 'ivb': вход в камеру со стороны меньших ('low') или больших ('high') положений
  w_pos: '', // положение источника при измерении на листе «Колодезная камера», мм

  // распад: таблица силы источника по датам
  d_basis: 'cert', // 'cert' | 'well' | 'phantom' — от сертификата или от измерения
  d_from: '',
  d_to: '',
  d_n: '',
  d_unit: '', // 'd' | 'w' | 'm'; пусто — по нуклиду
  d_zone: '',
  d_target: '',
  d_target_unit: 'mGy/h',

  // сличение (кросс-калибровка) рабочей колодезной камеры по эталонной, TRS-492, разд. 7.7
  x_unit: 'nA',
  x_T0: '20',
  x_P0: '101,325',
  x_P0_unit: 'kPa',
  x_P_unit: 'hPa',
  x_ksm: '', // k_sm,sm0 для N эталонной камеры (пусто — 1: тот же источник, что при её калибровке)
  x_ref_model: '',
  x_ref_serial: '',
  x_ref_N: '',
  x_ref_N_unit: 'Gy·m2/(h·A)',
  x_ref_kelec: '1',
  x_ref_I: ['', '', '', '', ''],
  x_ref_leak: '',
  x_ref_T: '',
  x_ref_P: '',
  x_ref_date: '',
  x_ref_time: '',
  x_ref_zone: '',
  x_fld_model: '',
  x_fld_serial: '',
  x_fld_I: ['', '', '', '', ''],
  x_fld_leak: '',
  x_fld_T: '',
  x_fld_P: '',
  x_fld_date: '',
  x_fld_time: '',
  x_fld_zone: '',
  x_fld_prev: '', // прежний калибровочный коэффициент рабочей камеры (в единице эталонного), для сравнения

  // стабильность колодезной камеры, TRS-492, разд. 8.4–8.5
  st_method: 'check', // 'check' — контрольный источник (8.5.2), 'beam' — внешний пучок (8.5.3), 'hdr' — источник HDR (8.5.4), 'redundant' — вторая камера (8.5.1)
  st_check_nuclide: 'Cs-137',
  st_half: '', // свой t½ контрольного источника, сут (пусто — TRS-492, табл. 3)
  st_unit: 'pA',
  st_T0: '20',
  st_P0: '101,325',
  st_P0_unit: 'kPa',
  st_P_unit: 'hPa',
  st_base: '', // исходное значение: показание, приведённое к T0, P0 (для 'redundant' — отношение)
  st_base_date: '',
  st_base_time: '',
  st_base_zone: '',
  st_I: ['', '', '', '', ''],
  st_I2: ['', '', '', '', ''], // вторая камера (8.5.1)
  st_T: '',
  st_P: '',
  st_date: '',
  st_time: '',
  st_zone: '',

  // бюджет неопределённости (TRS-492, разд. 9, табл. 10; Ubrich 2014): сценарий и свои значения строк (JSON)
  u_scen: '1',
  u_over_w: '',
  u_over_p: '',

  // доза в воде по TG-43 (справочно): модель источника, сила источника, точки (r, θ)
  t_src: '',
  t_lambda: '',
  t_L: '',
  t_basis: 'cert', // 'cert' | 'well' | 'phantom' | 'manual'
  t_SK: '', // своя S_K, Ед (для 'manual')
  t_date: '', // пусто — сейчас
  t_time: '',
  t_zone: '',
  t_th: '90',
  t_r: ['1', '2', '3', '5', '8'],
  t_g: ['', '', '', '', ''],
  t_F: ['', '', '', '', ''],
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
 * Модель источника для Λ при калибровке колодезной камеры в Ḋw: поле w_src, пусто — как на листах фантома и TG-43;
 * 'other' — свой Λ (w_lambda). Возвращает { id, name, lambda, ref } или null.
 */
export function wellLambdaSource(f) {
  const id = f.w_src || f.p_src || f.t_src;
  if (id === 'other') {
    const lambda = parseNumber(f.w_lambda);
    return lambda > 0 ? { id: 'other', name: L('своя модель', 'own model'), lambda, ref: null } : null;
  }
  const s = DOSE_SOURCES.find((x) => x.id === id && x.nuclide === f.nuclide && x.lambda);
  return s ? { id: s.id, name: s.name, lambda: s.lambda, ref: s.ref } : null;
}

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
  const sets = [f.w_I, f.w_I2, f.w_I3].map(nums);
  if (!sets.some((x) => x.length)) {
    add('info', L('Введите показания электрометра в точке максимального отклика — по серии на каждое введение источника.', 'Enter the electrometer readings at the sweet spot, one series per source insertion.'), null, 'w_I');
    return out;
  }
  if (!Object.hasOwn(CURRENT_UNITS, f.w_unit)) {
    add('error', L('Неизвестная единица тока.', 'Unknown current unit.'), null, 'w_unit');
    return out;
  }
  const rep = wellRepeatability(sets);
  const m = rep.mean;
  const amps = readingToAmps({ value: m, unit: f.w_unit }).amps;
  out.readings = { n: rep.n, mean: m, relSd: rep.relSd, sdMean: rep.sdMean, sets: rep.sets, spread: rep.spread, checks: rep.checks, insertions: rep.sets.length };
  const keys = ['w_I', 'w_I2', 'w_I3'];
  const idx = sets.map((x, i) => (x.length ? i : -1)).filter((i) => i >= 0);
  const fieldOf = (k) => keys[idx[k]] ?? 'w_I';
  const ref822 = `${REF.trs492}, разд. 8.2.2`;
  const R = WELL_REPEAT;
  for (const c of rep.checks) {
    if (c.pass) continue;
    const no = idx[c.set ?? 0] + 1;
    if (c.id === 'insertions') add('warn', L(`Введений источника ${c.value}: TRS-492 советует не меньше ${R.insertions} — каждое введение заново ставит источник в точку максимума.`, `${c.value} source insertion(s): TRS-492 advises at least ${R.insertions}; each insertion repositions the source at the sweet spot.`), ref822, 'w_I');
    else if (c.id === 'readings') add('warn', L(`Введение ${no}: показаний ${c.value}, нужно не меньше ${R.readings}.`, `Insertion ${no}: ${c.value} readings, at least ${R.readings} are needed.`), ref822, fieldOf(c.set));
    else if (c.id === 'trend') add('warn', L(`Введение ${no}: показания монотонно ${rep.sets[c.set].dir > 0 ? 'растут' : 'падают'} (на ${ru(c.value, 2)} % — больше ${ru(R.trend, 1)} %): камера ещё не стабилизировалась — дождитесь стабилизации и повторите.`, `Insertion ${no}: the readings drift monotonically (by ${c.value.toFixed(2)}%, more than ${R.trend}%): the chamber has not stabilised; wait and repeat.`), ref822, fieldOf(c.set));
    else if (c.id === 'sdMean') add('warn', L(`Введение ${no}: относительное стандартное отклонение среднего ${ru(c.value, 3)} % — больше ${ru(R.sdMean, 1)} %.`, `Insertion ${no}: the relative standard deviation of the mean is ${c.value.toFixed(3)}%, more than ${R.sdMean}%.`), ref822, fieldOf(c.set));
    else if (c.id === 'sets') add('warn', L(`Средние по введениям расходятся на ${ru(c.value, 2)} % — больше ${ru(R.sets, 1)} %: проверьте положение источника и прогрев; такие расхождения нужно выяснить.`, `The insertion means differ by ${c.value.toFixed(2)}%, more than ${R.sets}%: check the source position and the warm-up; such differences should be investigated.`), ref822, 'w_I2');
  }
  if (rep.checks.length && rep.checks.every((c) => c.pass)) add('info', L(`Повторяемость в норме: ${rep.sets.length} введения, разброс средних ${ru(rep.spread, 2)} %.`, `Repeatability is fine: ${rep.sets.length} insertions, spread of the means ${rep.spread.toFixed(2)}%.`), ref822, 'w_I');

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
  let r;
  if (isDwUnit(f.w_N_unit)) {
    // калибровка в мощности поглощённой дозы в воде: TRS-492, разд. 7.4, ур. (11), (14); k_Dw,sm,sm0 не применяется
    const ref74 = `${REF.trs492}, разд. 7.4`;
    if (kSm !== 1) add('info', L(`Камера калибрована в Ḋw: поправку на модель источника k_Dw,sm,sm0 TRS-492 пока не рекомендует (нет данных) — ${ru(kSm, 3)} не применяется.`, `The chamber is calibrated in Ḋw: TRS-492 does not yet recommend a source model correction k_Dw,sm,sm0 (no data); ${kSm.toFixed(3)} is not applied.`), ref74, 'w_ksm_mode');
    kSm = 1;
    const src = wellLambdaSource(f);
    r = wellDoseRate({ N, nUnit: f.w_N_unit, amps, kTP, kLeak: kl.value, kElec, kPol, kS, lambda: src?.lambda ?? NaN });
    out.formalism = 'Dw';
    out.Dw = r.Dw;
    out.lambdaSrc = src;
    r.mGyh = r.U / 1e3;
    if (!src) add('info', L('Калибровка в Ḋw: для сравнения с сертификатом источника (S_K) выберите модель источника — S_K = Ḋw,1/Λ (Λ — консенсус HEBD).', 'Calibration in Ḋw: to compare with the source certificate (S_K), choose the source model; S_K = Ḋw,1/Λ (Λ: HEBD consensus).'), REF.hebd, 'w_src');
    else add('info', L(`Камера калибрована в Ḋw: результат — мощность дозы в воде в точке 1 см, 90° (TRS-492, ур. 11, 14). S_K = Ḋw,1/Λ, Λ = ${ru(src.lambda, 3)} сГр·ч⁻¹·Ед⁻¹ (${src.name}); в сравнение с сертификатом входит и неопределённость Λ.`, `The chamber is calibrated in Ḋw: the result is the dose rate to water at 1 cm, 90° (TRS-492, Eq. 11, 14). S_K = Ḋw,1/Λ, Λ = ${src.lambda.toFixed(3)} cGy·h⁻¹·U⁻¹ (${src.name}); the comparison with the certificate also carries the uncertainty of Λ.`), ref74, 'w_src');
  } else r = wellStrength({ N, nUnit: f.w_N_unit, amps, kTP, kLeak: kl.value, kElec, kPol, kS, kSm });
  out.ok = out.formalism === 'Dw' ? Number.isFinite(out.Dw) : Number.isFinite(r.mGyh);
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
  if (calib === 'Nw') {
    for (const x of ir ? PHANTOM_IR_LITERATURE : PHANTOM_CO60_LITERATURE.filter((y) => y.method !== 'azhari')) {
      list.push({ id: `ubrich-${x.method}-${x.chamber}`, label: x.method === 'mc' ? L(`Ubrich 2014, Монте-Карло, PTW ${x.chamber}`, `Ubrich 2014, Monte Carlo, PTW ${x.chamber}`) : L(`Ubrich 2014, калибровка PTB, PTW ${x.chamber}`, `Ubrich 2014, PTB calibration, PTW ${x.chamber}`), factor: x.kTot, kA: 1, ref: x.ref, note: ir ? L('для камеры из статьи; источник μSelectron V2', 'for the chamber in the paper; μSelectron V2 source') : L('для камеры из статьи', 'for the chamber in the paper') });
    }
  }
  if (Number.isFinite(ktotOwn) && ktotOwn > 0) list.push({ id: 'own', label: L('свой k_tot (сличение с колодезной камерой)', 'own k_tot (comparison with the well-type chamber)'), factor: ktotOwn, kA: 1, ref: null, note: '' });
  return list;
}

/** Порог предупреждения о разбросе между четырьмя положениями камеры, %: практический, не из руководства PTW. */
const PHANTOM_SPREAD_WARN = 3;

/** Расстояние до точки измерения в фантоме PTW 9193, см (руководство PTW, DGMP 13). */
const PHANTOM_R = 8;

/**
 * Поглощённая доза в воде по измерению в фантоме (только калибровка N_w):
 * — в точке измерения Ḋ_w = N_D,w · Ṁ (руководство PTW 9193, ур. 15; среда — ПММА фантома);
 * — референсная Ḋ_w,1 на 1 см в воде: (k_tot)Ḋw,1 · N_D,w · Ṁ (Ubrich 2014, ур. 6, табл. 7) и Λ · S_K (TG-43U1, ур. 1;
 *   Λ — HEBD) по основному варианту и по сертификату;
 * — Ḋ_w на 8 см в воде на поперечной оси: Ḋ_w,1 · G_L(8)/G_L(1) · g_L(8) (TG-43U1, ур. 1, 4).
 * Мощности — мГр/мин.
 */
function phantomDose({ f, N, rate, kQ, holes, kHole, main, expectedU }) {
  const messages = [];
  const add = makeAdd(messages);
  const dose = { messages, rows: [] };
  if (f.p_calib !== 'Nw') {
    add('info', L('Поглощённая доза в воде считается при калибровке камеры в поглощённой дозе в воде (N_w).', 'The absorbed dose to water is calculated for a chamber calibrated in absorbed dose to water (N_w).'), null, 'p_calib');
    return dose;
  }
  const toMin = (perHour) => perHour / 60;
  dose.point = toMin(N * rate * kQ * 1e3);
  dose.holes = holes.map((h) => ({ i: h.i, value: toMin(N * h.corr * kHole * kQ * 1e3) }));

  // модель источника: Λ, L, g_L(8)
  let src = DOSE_SOURCES.find((x) => x.id === f.p_src && x.nuclide === f.nuclide) ?? null;
  let lambda = src?.lambda ?? NaN;
  let len = src?.L ?? NaN;
  let gL8 = src?.gL8 ?? NaN;
  let ref = src?.ref ?? null;
  if (f.p_src === 'other') {
    lambda = parseNumber(f.p_lambda);
    len = isBlank(f.p_L) ? 0 : parseNumber(f.p_L);
    gL8 = parseNumber(f.p_gL8);
    ref = null;
    src = { id: 'other', name: L('своя модель', 'own model') };
    if (!(lambda > 0)) add('info', L('Введите Λ источника (сГр·ч⁻¹·Ед⁻¹) из консенсусных данных TG-43 для вашей модели или из паспорта.', 'Enter the source Λ (cGy·h⁻¹·U⁻¹) from the TG-43 consensus data for your model or from the source documentation.'), REF.tg43, 'p_lambda');
    if (!(len >= 0)) add('error', L('Не удалось прочитать активную длину L.', 'Could not read the active length L.'), null, 'p_L');
  }
  dose.source = src ? { id: src.id, name: src.name, lambda, L: len, gL8, ref } : null;
  if (!src) {
    add('info', L('Выберите модель источника — тогда появятся Ḋ_w,1 на 1 см и Ḋ_w на 8 см в воде (TG-43).', 'Choose the source model to get Ḋ_w,1 at 1 cm and Ḋ_w at 8 cm in water (TG-43).'), null, 'p_src');
    return dose;
  }

  if (lambda > 0 && main && Number.isFinite(main.U)) dose.rows.push({ id: 'main', label: L(`Λ · S_K, S_K — основной вариант (${main.label})`, `Λ · S_K, S_K from the main variant (${main.label})`), dw1: (lambda * main.U) / 6, ref: `${REF.tg43}, ур. (1)` });
  const ub = UBRICH_KTOT_DW1[src.id];
  if (ub) {
    for (const [ch, k] of Object.entries(ub)) dose.rows.push({ id: `ubrich-${ch}`, label: L(`Ubrich 2014, (k_tot)Ḋw,1 для PTW ${ch}`, `Ubrich 2014, (k_tot)Ḋw,1 for PTW ${ch}`), factor: k, dw1: toMin(k * N * rate * 1e3), ref: UBRICH_KTOT_DW1_REF, note: L('для камеры из статьи', 'for the chamber in the paper') });
  } else if (src.id !== 'other') {
    add('info', L('Для этой модели источника в Ubrich 2014 (табл. 7) нет (k_tot)Ḋw,1: Ḋ_w,1 — только через Λ · S_K.', 'Ubrich 2014 (Table 7) gives no (k_tot)Ḋw,1 for this source model: Ḋ_w,1 only via Λ · S_K.'), UBRICH_KTOT_DW1_REF, 'p_src');
  }
  if (!(lambda > 0) && src.id !== 'other') add('info', L('Для этой модели в HEBD нет Λ и g_L: Ḋ_w на 8 см в воде не пересчитывается (можно выбрать «Другая» и ввести свои).', 'HEBD gives no Λ and g_L for this model: Ḋ_w at 8 cm in water is not calculated (choose “Other” and enter your own).'), REF.hebd, 'p_src');
  if (lambda > 0 && Number.isFinite(expectedU)) dose.expected = (lambda * expectedU) / 6;
  const to8 = len >= 0 && gL8 > 0;
  if (to8) dose.gRatio = tg43Transverse({ dw1: 1, r: PHANTOM_R, L: len, gL: 1 }).gRatio;
  for (const row of dose.rows) {
    if (to8) row.d8 = tg43Transverse({ dw1: row.dw1, r: PHANTOM_R, L: len, gL: gL8 }).value;
    if (Number.isFinite(dose.expected)) row.dev = ((row.dw1 - dose.expected) / dose.expected) * 100;
  }
  if (to8 && Number.isFinite(dose.expected)) dose.expected8 = dose.expected * dose.gRatio * gL8;
  return dose;
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
  // 3 % — практический порог калькулятора: руководство PTW числа не даёт, только требует среднее по четырём положениям,
  // чтобы выявить анизотропию поля или нецентральное положение источника
  if (spread > PHANTOM_SPREAD_WARN) add('warn', L(`Разброс между положениями ${ru(spread, 1)} % — больше ${PHANTOM_SPREAD_WARN} % (практический порог калькулятора; в руководстве PTW числа нет): проверьте, что аппликатор в центре фантома и источник выведен до конца.`, `The spread between positions is ${spread.toFixed(1)}%, more than ${PHANTOM_SPREAD_WARN}% (a practical threshold of this calculator; the PTW manual gives no number): check that the applicator is in the centre of the phantom and the source is fully extended.`), `${REF.ptw9193}, разд. 6.1`, 'p_hole0');

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
  const kHole = kPol * kS * kElec * (60 / tau);
  out.dose = phantomDose({ f, N, rate, kQ, holes, kHole, main, expectedU: out.expected });
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

// ——— Максимум отклика колодезной камеры ———

/**
 * Лист «Максимум отклика»: опорная точка колодезной камеры по кривой «положение — показание» (TRS-492, разд. 8.2.1,
 * рис. 6); отклик в положении измерения листа «Колодезная камера» и в положении из сертификата камеры.
 */
export function computeBrachySweet(input) {
  const f = normalizeBrachy(input);
  const messages = [];
  const add = makeAdd(messages);
  const pts = [];
  const n = Math.max(f.s_x.length, f.s_M.length);
  for (let i = 0; i < n; i++) {
    const x = parseNumber(f.s_x[i]);
    const m = parseNumber(f.s_M[i]);
    if (isBlank(f.s_x[i]) && isBlank(f.s_M[i])) continue;
    if (!Number.isFinite(x) || !Number.isFinite(m)) {
      add('warn', L(`Строка ${i + 1}: нужны и положение, и показание — строка пропущена.`, `Row ${i + 1}: both the position and the reading are needed; the row is skipped.`), null, `s_x_${i}`);
      continue;
    }
    pts.push({ x, m });
  }
  const out = { ok: false, messages, n: pts.length };
  if (pts.length < 3) {
    add('info', L('Введите показания хотя бы в трёх положениях источника; шаг — не больше 2,5 мм, не меньше 10 мм в обе стороны от ожидаемого максимума.', 'Enter readings at no fewer than three source positions; step at most 2.5 mm, at least 10 mm on both sides of the expected maximum.'), `${REF.trs492}, разд. 8.2.1`, 's_x_0');
    return out;
  }
  const r = sweetSpot(pts, { method: f.s_method === 'ivb' ? 'ivb' : 'trs', entry: f.s_entry === 'high' ? 'high' : 'low' });
  if (r.error) {
    add('error', L(`Кривая отклика: ${r.error}.`, `Response curve: ${r.error}.`), null, 's_x_0');
    return out;
  }
  Object.assign(out, r, { ok: true });
  if (r.warnings.includes('step')) add('warn', L(`Наибольший шаг между положениями ${ru(r.maxStep, 1)} мм — больше 2,5 мм: максимум найден грубее.`, `The largest step between positions is ${r.maxStep.toFixed(1)} mm, above 2.5 mm: the maximum is less precise.`), `${REF.trs492}, разд. 8.2.1`, 's_step');
  if (r.warnings.includes('edge')) add('warn', L('Наибольшее показание — в крайнем положении: максимум, вероятно, за пределами кривой. Продолжите измерения дальше.', 'The largest reading is at an end position: the maximum is probably outside the curve. Extend the measurements.'), `${REF.trs492}, разд. 8.2.1`, 's_x_0');
  else if (r.warnings.includes('margin')) add('warn', L(`Кривая заходит за максимум меньше чем на 10 мм (вниз ${ru(r.margin.below, 1)} мм, вверх ${ru(r.margin.above, 1)} мм): плато может быть оценено не полностью.`, `The curve extends less than 10 mm beyond the maximum (down ${r.margin.below.toFixed(1)} mm, up ${r.margin.above.toFixed(1)} mm): the plateau may be incomplete.`), `${REF.trs492}, разд. 8.2.1`, 's_x_0');
  const ref821 = `${REF.trs492}, разд. 8.2.1`;
  if (r.method === 'trs') {
    add('info', L(`Максимум — вершина параболы I(x) = ax² + bx + c по ${r.fit.n} точкам в ±20 мм (TRS-492, ур. 25–26).`, `The maximum is the vertex of the parabola I(x) = ax² + bx + c over ${r.fit.n} points within ±20 mm (TRS-492, Eq. 25–26).`), ref821, 's_x_0');
    if (r.top && Math.abs(r.top.xPeak - r.xPeak) > 0.5) add('warn', L(`Парабола только по вершине кривой даёт ${ru(r.top.xPeak, 1)} мм — на ${ru(Math.abs(r.top.xPeak - r.xPeak), 1)} мм от параболы TRS: кривая несимметрична, проверьте точки и выбор метода.`, `A parabola over the top of the curve only gives ${r.top.xPeak.toFixed(1)} mm, ${Math.abs(r.top.xPeak - r.xPeak).toFixed(1)} mm from the TRS parabola: the curve is asymmetric; check the points and the method.`), ref821, 's_x_0');
  } else if (r.warnings.includes('trs-fail')) {
    add('warn', L(r.method === 'parabola' ? 'Парабола по ±20 мм (TRS-492, ур. 25–26) не выпуклая или её вершина вне точек — взята парабола по вершине кривой.' : 'Парабола по ±20 мм (TRS-492, ур. 25–26) и по вершине не получилась — взято наибольшее показание.', r.method === 'parabola' ? 'The parabola over ±20 mm (TRS-492, Eq. 25–26) is not convex or its vertex is outside the points; the parabola over the top of the curve is used.' : 'Neither the ±20 mm parabola (TRS-492, Eq. 25–26) nor the top parabola could be fitted; the largest reading is used.'), ref821, 's_x_0');
  }
  if (f.s_method === 'ivb') {
    if (r.warnings.includes('no-local')) add('warn', L('Локального максимума на кривой нет: продлите измерения от входа в камеру. Взято наибольшее показание.', 'There is no local maximum on the curve: extend the measurements from the chamber entrance. The largest reading is used.'), ref821, 's_entry');
    else add('info', L('SI IVB 1000: максимум — первый локальный от входа в камеру (TRS-492, разд. 8.2.1), уточнён параболой по трём точкам.', 'SI IVB 1000: the maximum is the first local one from the chamber entrance (TRS-492, Sec. 8.2.1), refined by a parabola through three points.'), ref821, 's_entry');
  } else if (/IVB/i.test(f.w_model)) add('warn', L('Камера SI IVB 1000: её кривую параболой не описать — выберите метод «первый локальный максимум от входа».', 'SI IVB 1000 chamber: its curve cannot be described by a parabola; choose the method “first local maximum from the entrance”.'), ref821, 's_method');
  // отклик в положении измерения и в положении сертификата
  const resp = (x) => (Number.isFinite(x) ? responseAt(r, x) : NaN);
  const wPos = parseNumber(f.w_pos);
  out.atMeas = { x: wPos, rel: resp(wPos) };
  if (Number.isFinite(wPos)) {
    if (!Number.isFinite(out.atMeas.rel)) add('warn', L('Положение измерения листа «Колодезная камера» вне кривой отклика.', 'The measurement position of the Well-type chamber sheet is outside the response curve.'), null, 'w_pos');
    else if (out.atMeas.rel < 0.999) add('warn', L(`В положении измерения ${ru(wPos, 1)} мм отклик ${ru(out.atMeas.rel * 100, 2)} % от максимума: показание занижено на ${ru((1 - out.atMeas.rel) * 100, 2)} %. Мерьте в максимуме (${ru(r.xPeak, 1)} мм).`, `At the measurement position ${wPos} mm the response is ${(out.atMeas.rel * 100).toFixed(2)}% of the maximum: the reading is ${((1 - out.atMeas.rel) * 100).toFixed(2)}% low. Measure at the maximum (${r.xPeak.toFixed(1)} mm).`), `${REF.trs492}, разд. 8.2.1`, 'w_pos');
  }
  const cPos = parseNumber(f.s_cert_pos);
  out.atCert = { x: cPos, rel: resp(cPos) };
  if (Number.isFinite(cPos) && Number.isFinite(r.xPeak)) {
    out.atCert.shift = r.xPeak - cPos;
    if (Math.abs(out.atCert.shift) > 1) add('warn', L(`Максимум сдвинут относительно сертификата камеры на ${ru(out.atCert.shift, 1)} мм: проверьте систему отсчёта положения (длину ампулопровода, глубину катетера) — при калибровке и сейчас она должна быть одной.`, `The maximum is shifted by ${out.atCert.shift.toFixed(1)} mm from the chamber certificate: check the position reference (transfer tube length, catheter depth); it must be the same as at the calibration.`), `${REF.trs492}, разд. 8.2.1`, 's_cert_pos');
  }
  return out;
}

// ——— Распад ———

/** Шаг таблицы распада по умолчанию: ¹⁹²Ir — неделя до 16 недель, ⁶⁰Co — месяц до 5 лет, прочие — сутки до 2 T½. */
function decayDefaults(nuclide, half) {
  if (nuclide === 'Ir-192') return { n: 1, unit: 'w', span: 16 * 7 };
  if (nuclide === 'Co-60') return { n: 1, unit: 'm', span: 5 * 365.25 };
  return { n: Math.max(1, Math.round(half / 10)), unit: 'd', span: 2 * half };
}

/**
 * Лист «Распад»: сила источника по датам от сертификата или от измерения (TRS-492, ур. 8–9; разд. 3.4.2 — время в UTC,
 * ISO 8601), дата, когда сила упадёт до заданной. sources — результаты листов (well, phantom) для базы «от измерения».
 */
export function computeBrachyDecay(input, { offsetMin = 0, well = null, phantom = null } = {}) {
  const f = normalizeBrachy(input);
  const messages = [];
  const add = makeAdd(messages);
  const cert = readCertificate(f, add, offsetMin);
  const out = { ok: false, messages, cert, rows: [] };
  let base = null;
  if (f.d_basis === 'well' || f.d_basis === 'phantom') {
    const r = f.d_basis === 'well' ? well : phantom;
    if (r?.ok && Number.isFinite(r.U) && Number.isFinite(r.tMeas)) base = { U: r.U, t: r.tMeas, label: f.d_basis === 'well' ? L('измерение колодезной камерой', 'well-type chamber measurement') : L('измерение в фантоме PTW 9193', 'PTW 9193 phantom measurement') };
    else add('info', L('На выбранном листе нет результата с датой измерения — таблица от сертификата.', 'The chosen sheet has no result with a measurement date; the table starts from the certificate.'), null, 'd_basis');
  }
  if (!base && cert.ok) base = { U: cert.U, t: cert.tCert, label: L('сертификат источника', 'source certificate') };
  if (!base) {
    if (!messages.some((m) => m.level === 'error')) add('info', L('Введите силу источника и дату сертификата в разделе 1.', 'Enter the source strength and the certificate date in section 1.'), null, 'cert_value');
    return out;
  }
  const half = cert.half;
  if (!Number.isFinite(half)) return out;
  out.base = base;
  out.half = half;
  const def = decayDefaults(f.nuclide, half);
  const tFrom = isBlank(f.d_from) ? base.t : fieldTime(f.d_from, '', f.d_zone, offsetMin).ms;
  if (!Number.isFinite(tFrom)) {
    add('error', L('Не удалось прочитать дату начала таблицы.', 'Could not read the table start date.'), null, 'd_from');
    return out;
  }
  const tTo = isBlank(f.d_to) ? tFrom + def.span * 86400000 : fieldTime(f.d_to, '', f.d_zone, offsetMin).ms;
  if (!Number.isFinite(tTo) || tTo < tFrom) {
    add('error', L('Дата конца таблицы должна быть не раньше начала.', 'The table end date must not be before the start.'), null, 'd_to');
    return out;
  }
  const n = isBlank(f.d_n) ? def.n : parseNumber(f.d_n);
  const unit = ['d', 'w', 'm'].includes(f.d_unit) ? f.d_unit : def.unit;
  if (!(n > 0)) {
    add('error', L('Шаг таблицы должен быть больше нуля.', 'The table step must be greater than zero.'), null, 'd_n');
    return out;
  }
  out.step = { n, unit };
  const dates = decayDates(tFrom, tTo, n, unit);
  if (dates.length >= 500) add('warn', L('Таблица ограничена 500 строками: увеличьте шаг.', 'The table is limited to 500 rows: increase the step.'), null, 'd_n');
  out.rows = dates.map((t) => {
    const U = strengthAt(base.U, base.t, t, half);
    return { t, days: (t - base.t) / 86400000, frac: U / base.U, U, mGyh: U / 1e3, A: cert.gammaUperGBq > 0 ? U / cert.gammaUperGBq : NaN };
  });
  // дата достижения заданной силы
  if (!isBlank(f.d_target)) {
    const c = certificateToU({ value: parseNumber(f.d_target), unit: f.d_target_unit, gamma: parseNumber(f.cert_gamma), gammaUnit: f.cert_gamma_unit });
    if (c.error) add('error', L(`Пороговая сила источника: ${c.error}.`, `Threshold source strength: ${c.error}.`), null, 'd_target');
    else {
      out.target = { U: c.U, t: timeForStrength(base.U, base.t, c.U, half) };
      if (c.U > base.U) add('info', L('Пороговая сила больше исходной — она была раньше даты отсчёта.', 'The threshold is above the base strength: it was reached before the base date.'), null, 'd_target');
    }
  }
  out.ok = out.rows.length > 0;
  return out;
}

// ——— Показания колодезной камеры: среднее, утечка, k_TP (общая часть сличения и стабильности) ———

/**
 * Серия показаний камеры, приведённая к T0, P0: M = M̄ · k_leak · k_TP (TRS-492, разд. 8.2.3.1, 8.2.3.4).
 * series — массив строк показаний; T0, P0 (кПа) — условия приведения; fieldT, fieldI — поля для замечаний.
 */
function chamberReading({ series, unit, leak, T, P, P_unit, T0, P0, fieldT, fieldI, what }, add) {
  const xs = nums(series);
  if (!xs.length) return null;
  const m = mean(xs);
  const out = { n: xs.length, mean: m, relSd: xs.length > 1 ? Math.abs(sd(xs) / m) * 100 : NaN, kTP: 1, kLeak: 1 };
  if (xs.length < 3) add('warn', L(`${what}: меньше трёх показаний — повторяемость не оценить.`, `${what}: fewer than three readings; the repeatability cannot be assessed.`), `${REF.trs492}, разд. 8.4`, fieldI);
  if (out.relSd > 0.5) add('warn', L(`${what}: разброс показаний ${ru(out.relSd, 2)} % — больше 0,5 %: проверьте прогрев и положение источника.`, `${what}: reading spread ${out.relSd.toFixed(2)}% exceeds 0.5%: check the warm-up and the source position.`), `${REF.trs492}, разд. 8.4`, fieldI);
  const lk = parseNumber(leak);
  if (Number.isFinite(lk) && lk !== 0) {
    const kl = kLeak(readingToAmps({ value: m, unit }).amps, readingToAmps({ value: lk, unit }).amps);
    out.kLeak = kl.value;
  }
  const t = parseNumber(T);
  const p = readPressure(P, P_unit, add, fieldT.replace(/T$/, 'P'), what);
  if (Number.isFinite(t) && Number.isFinite(p) && Number.isFinite(T0) && Number.isFinite(P0)) out.kTP = temperaturePressure({ T: t, P: p, T0, P0, abs0: 273.15 });
  else add('warn', L(`${what}: нет температуры или давления — k_TP = 1.`, `${what}: no temperature or pressure; k_TP = 1.`), `${REF.trs492}, разд. 8.2.3.1`, fieldT);
  out.corr = m * out.kLeak * out.kTP;
  return out;
}

// ——— Сличение (кросс-калибровка) колодезных камер ———

/**
 * Лист «Сличение камер»: калибровочный коэффициент рабочей колодезной камеры по эталонной на том же источнике:
 * N_field = M_ref(t_ref)/M_field(t_ref) · N_ref · k_sm,sm0 (TRS-492, разд. 7.7, ур. 18–20). Показания приводятся
 * к одним T0, P0 и, если сняты в разное время, к времени измерения эталонной камерой по распаду.
 */
export function computeBrachyCross(input, { offsetMin = 0 } = {}) {
  const f = normalizeBrachy(input);
  const messages = [];
  const add = makeAdd(messages);
  const out = { ok: false, messages };
  const h = halfLifeDays(f.nuclide, isBlank(f.half) ? undefined : parseNumber(f.half));
  out.half = h.days;
  const Nref = parseNumber(f.x_ref_N);
  if (!(Nref > 0)) {
    add(isBlank(f.x_ref_N) ? 'info' : 'error', L('Введите калибровочный коэффициент эталонной камеры из её сертификата — для того же нуклида и того же держателя источника.', 'Enter the reference chamber calibration coefficient from its certificate, for the same nuclide and the same source holder.'), `${REF.trs492}, разд. 7.7`, 'x_ref_N');
    return out;
  }
  if (!Object.hasOwn(WELL_N_UNITS, f.x_ref_N_unit)) add('error', L('Неизвестная единица калибровочного коэффициента.', 'Unknown calibration coefficient unit.'), null, 'x_ref_N_unit');
  if (!Object.hasOwn(CURRENT_UNITS, f.x_unit)) {
    add('error', L('Неизвестная единица тока.', 'Unknown current unit.'), null, 'x_unit');
    return out;
  }
  const T0 = parseNumber(f.x_T0);
  const P0 = readPressure(f.x_P0, f.x_P0_unit, add, 'x_P0', L('условия приведения', 'reference conditions'));
  const common = { unit: f.x_unit, P_unit: f.x_P_unit, T0, P0 };
  const ref = chamberReading({ ...common, series: f.x_ref_I, leak: f.x_ref_leak, T: f.x_ref_T, P: f.x_ref_P, fieldT: 'x_ref_T', fieldI: 'x_ref_I', what: L('Эталонная камера', 'Reference chamber') }, add);
  const fld = chamberReading({ ...common, series: f.x_fld_I, leak: f.x_fld_leak, T: f.x_fld_T, P: f.x_fld_P, fieldT: 'x_fld_T', fieldI: 'x_fld_I', what: L('Рабочая камера', 'Field chamber') }, add);
  if (!ref || !fld) {
    add('info', L('Введите показания обеих камер с одним и тем же источником в положении максимального отклика.', 'Enter the readings of both chambers with the same source at the sweet spot.'), `${REF.trs492}, разд. 7.7`, ref ? 'x_fld_I' : 'x_ref_I');
    return out;
  }
  const kElec = isBlank(f.x_ref_kelec) ? 1 : parseNumber(f.x_ref_kelec);
  if (!(kElec > 0)) add('error', L('k_elec должен быть больше нуля.', 'k_elec must be greater than zero.'), null, 'x_ref_kelec');
  ref.kElec = kElec;
  ref.corr *= kElec;
  const kSm = isBlank(f.x_ksm) ? 1 : parseNumber(f.x_ksm);
  if (!(kSm > 0)) add('error', L('k_sm,sm0 должен быть больше нуля.', 'k_sm,sm0 must be greater than zero.'), null, 'x_ksm');
  // приведение к одному времени (TRS-492, разд. 7.7: «both measurements … refer to the same time t_ref»)
  const tRef = readMeasTime(f, 'x_ref_', add, offsetMin);
  const tFld = readMeasTime(f, 'x_fld_', add, offsetMin);
  let kd = 1;
  if (Number.isFinite(tRef) && Number.isFinite(tFld) && tRef !== tFld) {
    if (!Number.isFinite(h.days)) add('error', L('Не задан период полураспада.', 'The half-life is not set.'), null, 'half');
    else kd = kDec(tFld, tRef, h.days);
  } else if (Number.isFinite(tRef) !== Number.isFinite(tFld)) add('warn', L('Время указано только у одной камеры: показания не приведены к одному времени. Если между измерениями прошло больше нескольких минут, укажите оба.', 'The time is given for one chamber only: the readings are not brought to the same time. If more than a few minutes passed between the measurements, give both.'), `${REF.trs492}, разд. 7.7`, Number.isFinite(tRef) ? 'x_fld_date' : 'x_ref_date');
  fld.kDec = kd;
  fld.corrT = fld.corr * kd;
  out.ref = ref;
  out.fld = fld;
  out.kSm = kSm;
  out.kDec = kd;
  out.dtHours = Number.isFinite(tRef) && Number.isFinite(tFld) ? (tFld - tRef) / 3600000 : NaN;
  if (Math.sign(ref.corr) !== Math.sign(fld.corrT)) add('warn', L('Знаки показаний камер разные: проверьте полярность.', 'The chamber readings have different signs: check the polarity.'), null, 'x_fld_I');
  out.ratio = Math.abs(ref.corr / fld.corrT);
  out.N = crossCalibrate({ mRef: Math.abs(ref.corr), mField: Math.abs(fld.corrT), nRef: Nref, kSm });
  out.unit = f.x_ref_N_unit;
  const prev = parseNumber(f.x_fld_prev);
  if (prev > 0) {
    out.prev = { N: prev, dev: (out.N / prev - 1) * 100 };
    if (Math.abs(out.prev.dev) > STABILITY_TOL) add('warn', L(`Новый коэффициент отличается от прежнего на ${ru(out.prev.dev, 2)} % — больше 0,5 %: проверьте условия сличения и стабильность рабочей камеры.`, `The new coefficient differs from the previous one by ${out.prev.dev.toFixed(2)}%, more than 0.5%: check the cross-calibration conditions and the field chamber stability.`), `${REF.trs492}, разд. 8.5`, 'x_fld_prev');
  }
  add('info', L('Тот же нуклид, что при калибровке эталонной камеры, и её держатель источника; пересчёт между нуклидами не допускается.', 'Same nuclide as in the reference chamber calibration, with its source holder; conversion between nuclides is not permitted.'), `${REF.trs492}, разд. 7.7`, null);
  out.ok = Number.isFinite(out.N) && !messages.some((m) => m.level === 'error');
  return out;
}

// ——— Стабильность колодезной камеры ———

/** Методы проверки долговременной стабильности, TRS-492, разд. 8.5.1–8.5.4; tol — допуск, %. */
export const STABILITY_METHODS = {
  check: { sec: '8.5.2', tol: STABILITY_TOL },
  beam: { sec: '8.5.3', tol: STABILITY_TOL },
  hdr: { sec: '8.5.4', tol: STABILITY_TOL },
  redundant: { sec: '8.5.1', tol: 0.1 },
};

/**
 * Лист «Стабильность»: показание, приведённое к T0, P0 и к дате исходного значения по распаду, против исходного
 * значения (TRS-492, разд. 8.5: ±0,5 %; для второй камеры — отношение показаний, ±0,1 % от среднего, разд. 8.5.1).
 * Повторяемость серии — разд. 8.4.
 */
export function computeBrachyStability(input, { offsetMin = 0 } = {}) {
  const f = normalizeBrachy(input);
  const messages = [];
  const add = makeAdd(messages);
  const method = Object.hasOwn(STABILITY_METHODS, f.st_method) ? f.st_method : 'check';
  const meta = STABILITY_METHODS[method];
  const out = { ok: false, messages, method, tol: meta.tol, sec: meta.sec };
  if (!Object.hasOwn(CURRENT_UNITS, f.st_unit)) {
    add('error', L('Неизвестная единица тока.', 'Unknown current unit.'), null, 'st_unit');
    return out;
  }
  const T0 = parseNumber(f.st_T0);
  const P0 = readPressure(f.st_P0, f.st_P0_unit, add, 'st_P0', L('условия приведения', 'reference conditions'));
  const common = { unit: f.st_unit, P_unit: f.st_P_unit, T0, P0, T: f.st_T, P: f.st_P, fieldT: 'st_T' };
  const r1 = chamberReading({ ...common, series: f.st_I, fieldI: 'st_I', what: method === 'redundant' ? L('Камера 1', 'Chamber 1') : L('Показания', 'Readings') }, add);
  if (!r1) {
    add('info', L('Введите показания проверки (ток или заряд за одно и то же время).', 'Enter the check readings (current or charge over the same time).'), `${REF.trs492}, разд. 8.5`, 'st_I');
    return out;
  }
  out.r1 = r1;
  let value;
  if (method === 'redundant') {
    const r2 = chamberReading({ ...common, series: f.st_I2, fieldI: 'st_I2', what: L('Камера 2', 'Chamber 2') }, add);
    if (!r2) {
      add('info', L('Введите показания второй камеры с тем же источником.', 'Enter the second chamber readings with the same source.'), `${REF.trs492}, разд. 8.5.1`, 'st_I2');
      return out;
    }
    out.r2 = r2;
    // одна среда: k_TP одинаковый и сокращается; распад — тоже (одно время)
    value = r1.corr / r2.corr;
    out.kDec = 1;
  } else {
    // распад от даты исходного значения: для внешнего пучка — нет
    let kd = 1;
    const tb = fieldTime(f.st_base_date, f.st_base_time, f.st_base_zone, offsetMin);
    const tn = fieldTime(f.st_date, f.st_time, f.st_zone, offsetMin);
    if (tn.error) add('error', L(`Дата проверки: ${tn.error}.`, `Check date: ${tn.error}.`), null, 'st_date');
    const tNow = tn.ms;
    if (tb.error) add('error', L(`Дата исходного значения: ${tb.error}.`, `Baseline date: ${tb.error}.`), null, 'st_base_date');
    const nuclide = method === 'check' ? f.st_check_nuclide : method === 'hdr' ? f.nuclide : null;
    if (nuclide) {
      const own = method === 'hdr' ? f.half : f.st_half;
      const h = halfLifeDays(nuclide, isBlank(own) ? undefined : parseNumber(own));
      if (h.error) add('error', L(`Период полураспада: ${h.error}.`, `Half-life: ${h.error}.`), null, method === 'hdr' ? 'half' : 'st_half');
      out.half = h.days;
      out.nuclide = nuclide;
      if ((tn.dateOnly || tb.dateOnly) && Number.isFinite(h.days) && dateOnlyDecayError(h.days) > 0.001) add('warn', L(`Дата без времени: для ${HALF_LIVES[nuclide]?.label ?? nuclide} сутки — до ${ru(dateOnlyDecayError(h.days) * 100, 2)} % распада. Укажите время исходного измерения и проверки.`, `A date without the time: for ${HALF_LIVES[nuclide]?.label ?? nuclide} one day is up to ${(dateOnlyDecayError(h.days) * 100).toFixed(2)}% of decay. Give the times of the baseline and of the check.`), `${REF.trs492}, разд. 7.3`, tn.dateOnly ? 'st_time' : 'st_base_time');
      if (Number.isFinite(tNow) && Number.isFinite(tb.ms) && Number.isFinite(h.days)) {
        kd = kDec(tNow, tb.ms, h.days);
        out.days = (tNow - tb.ms) / 86400000;
        if (method === 'hdr' && nuclide === 'Ir-192' && out.days > 120) add('warn', L(`С исходного измерения прошло ${ru(out.days, 0)} сут: с ¹⁹²Ir метод годится на несколько месяцев — до замены источника.`, `${out.days.toFixed(0)} days since the baseline: with ¹⁹²Ir the method works for a few months, until the source exchange.`), `${REF.trs492}, разд. 8.5.4`, 'st_base_date');
      } else if (!isBlank(f.st_base)) add('warn', L('Нужны даты исходного значения и проверки: без них распад не учтён.', 'The baseline and check dates are needed; without them the decay is not corrected.'), `${REF.trs492}, разд. 8.5.2`, Number.isFinite(tb.ms) ? 'st_date' : 'st_base_date');
    }
    out.kDec = kd;
    value = r1.corr * kd;
  }
  out.value = value;
  const base = parseNumber(f.st_base);
  if (!Number.isFinite(base) || base === 0) {
    add('info', method === 'redundant'
      ? L('Введите исходное отношение показаний (текущее среднее прошлых сличений) — или запишите это значение как исходное.', 'Enter the baseline reading ratio (running mean of past comparisons), or record this value as the baseline.')
      : L('Введите исходное значение (при вводе камеры в работу и после каждой калибровки) — или запишите это значение как исходное.', 'Enter the baseline (set at commissioning and after each calibration), or record this value as the baseline.'), `${REF.trs492}, разд. 8.5`, 'st_base');
    out.ok = true;
    return out;
  }
  out.base = base;
  out.dev = (value / base - 1) * 100;
  out.pass = Math.abs(out.dev) <= meta.tol + 1e-9;
  if (out.pass) add('info', L(`Отклонение от исходного ${ru(out.dev, 2)} % — в пределах ±${ru(meta.tol, 1)} %.`, `Deviation from the baseline ${out.dev.toFixed(2)}%: within ±${meta.tol}%.`), `${REF.trs492}, разд. ${meta.sec}`, 'st_base');
  else add('warn', method === 'redundant'
    ? L(`Отношение показаний камер изменилось на ${ru(out.dev, 2)} % — больше ±0,1 %: возможна неисправность одной из камер; проверьте контрольным источником.`, `The chamber reading ratio changed by ${out.dev.toFixed(2)}%, more than ±0.1%: one of the chambers may be faulty; check with a check source.`)
    : L(`Отклонение от исходного ${ru(out.dev, 2)} % — больше ±0,5 %: выясните причину; возможно, камере нужна повторная калибровка.`, `Deviation from the baseline ${out.dev.toFixed(2)}%, more than ±0.5%: investigate; the chamber may need recalibration.`), `${REF.trs492}, разд. ${meta.sec}`, 'st_base');
  out.ok = true;
  return out;
}

// ——— Доза в воде по TG-43 (справочно) ———

/**
 * Лист «Доза TG-43»: мощность поглощённой дозы в воде в точках (r, θ) по формализму линейного источника TG-43U1
 * (ур. 1, 4): Ḋ = S_K · Λ · G_L(r,θ)/G_L(1 см, 90°) · g_L(r) · F(r,θ). Λ и g_L(r) — консенсус HEBD (табл. IV, V,
 * LII, LIII); F(r,θ) = 1 на поперечной оси, в других направлениях — своя (таблицы F в HEBD для каждой модели).
 * Сила источника — по сертификату на дату расчёта, по листу «Колодезная камера» или «Фантом» (с распадом) или своя.
 * now — текущее время, мс UTC (если дата не указана).
 */
export function computeBrachyTg43(input, { offsetMin = 0, now = Date.now(), well = null, phantom = null } = {}) {
  const f = normalizeBrachy(input);
  const messages = [];
  const add = makeAdd(messages);
  const out = { ok: false, messages, rows: [] };
  // модель источника
  let src = DOSE_SOURCES.find((x) => x.id === f.t_src && x.nuclide === f.nuclide && x.lambda);
  if (f.t_src === 'other') {
    const lambda = parseNumber(f.t_lambda);
    const Lc = isBlank(f.t_L) ? 0 : parseNumber(f.t_L);
    if (!(lambda > 0)) {
      add(isBlank(f.t_lambda) ? 'info' : 'error', L('Введите постоянную мощности дозы Λ своей модели источника.', 'Enter the dose rate constant Λ of your source model.'), null, 't_lambda');
      return out;
    }
    if (!(Lc >= 0)) {
      add('error', L('Активная длина L не может быть отрицательной.', 'The active length L cannot be negative.'), null, 't_L');
      return out;
    }
    src = { id: 'other', name: L('своя модель', 'own model'), lambda, L: Lc, ref: null };
  }
  if (!src) {
    add('info', L('Выберите модель источника: Λ и g_L(r) — консенсусные данные HEBD.', 'Choose the source model: Λ and g_L(r) are HEBD consensus data.'), REF.hebd, 't_src');
    return out;
  }
  out.source = src;
  const table = GL_TABLE[src.id];
  const rs = f.nuclide === 'Co-60' ? GL_R_CO : GL_R_IR;
  // сила источника на время расчёта
  const cert = readCertificate(f, () => {}, offsetMin);
  const tt = fieldTime(f.t_date, f.t_time, f.t_zone, offsetMin);
  if (tt.error) add('error', L(`Дата расчёта: ${tt.error}.`, `Calculation date: ${tt.error}.`), null, 't_date');
  const t = tt.missing ? now : tt.ms;
  out.t = t;
  out.tNow = tt.missing;
  let base = null;
  if (f.t_basis === 'manual') {
    const SK = parseNumber(f.t_SK);
    if (SK > 0) base = { U: SK, t: NaN, label: L('своя S_K', 'own S_K') };
    else add(isBlank(f.t_SK) ? 'info' : 'error', L('Введите силу воздушной кермы S_K, Ед.', 'Enter the air kerma strength S_K, U.'), null, 't_SK');
  } else if (f.t_basis === 'well' || f.t_basis === 'phantom') {
    const r = f.t_basis === 'well' ? well : phantom;
    if (r?.ok && Number.isFinite(r.U) && Number.isFinite(r.tMeas)) base = { U: r.U, t: r.tMeas, label: f.t_basis === 'well' ? L('измерение колодезной камерой', 'well-type chamber measurement') : L('измерение в фантоме PTW 9193', 'PTW 9193 phantom measurement') };
    else add('info', L('На выбранном листе нет результата с датой измерения.', 'The chosen sheet has no result with a measurement date.'), null, 't_basis');
  } else if (cert.ok && Number.isFinite(cert.U)) base = { U: cert.U, t: cert.tCert, label: L('сертификат источника', 'source certificate') };
  else add('info', L('Введите силу источника и дату сертификата в разделе 1.', 'Enter the source strength and the certificate date in section 1.'), null, 'cert_value');
  if (!base || !Number.isFinite(t)) return out;
  const SK = Number.isFinite(base.t) && Number.isFinite(cert.half) ? strengthAt(base.U, base.t, t, cert.half) : base.U;
  out.base = base;
  out.SK = SK;
  out.dw1 = SK * src.lambda; // сГр/ч на 1 см
  const th = isBlank(f.t_th) ? 90 : parseNumber(f.t_th);
  if (!(th >= 0 && th <= 180)) {
    add('error', L('Угол θ — от 0° до 180°.', 'The angle θ must be from 0° to 180°.'), null, 't_th');
    return out;
  }
  out.theta = th;
  const g1 = geometryLine(1, src.L);
  const n = Math.max(f.t_r.length, f.t_g.length, f.t_F.length);
  let needF = false;
  let needG = false;
  const extra = new Set();
  const fExtra = new Set();
  for (let i = 0; i < n; i++) {
    const r = parseNumber(f.t_r[i]);
    if (!Number.isFinite(r)) continue;
    if (!(r > 0)) {
      add('error', L(`Строка ${i + 1}: расстояние должно быть больше нуля.`, `Row ${i + 1}: the distance must be greater than zero.`), null, `t_r_${i}`);
      continue;
    }
    const ownG = parseNumber(f.t_g[i]);
    const ownF = parseNumber(f.t_F[i]);
    let gTab = table ? interpTable(rs, table, r) : NaN;
    // вне таблицы — по HEBD, табл. III: ближе r_min — ближайшее значение, дальше r_max — линейно по двум последним точкам
    let gExtra = '';
    if (table && !Number.isFinite(gTab)) {
      const k = rs.length - 1;
      if (r < rs[0]) [gTab, gExtra] = [table[0], 'near'];
      else [gTab, gExtra] = [table[k] + ((table[k] - table[k - 1]) / (rs[k] - rs[k - 1])) * (r - rs[k]), 'far'];
    }
    const g = Number.isFinite(ownG) ? ownG : gTab;
    if (!Number.isFinite(ownG) && gExtra) extra.add(gExtra);
    // F(r,θ): своё значение; на поперечной оси — 1; иначе — таблица HEBD модели (билинейно, вне таблицы по r — ближайшее)
    const fTab = Number.isFinite(ownF) || Math.abs(th - 90) < 1e-9 ? null : hebdF(src.id, r, th);
    const F = Number.isFinite(ownF) ? ownF : Math.abs(th - 90) < 1e-9 ? 1 : fTab ? fTab.value : NaN;
    if (fTab?.extra) fExtra.add(fTab.extra);
    const G = geometryLineAt(r, th, src.L) / g1;
    if (!Number.isFinite(g)) needG = true;
    if (!Number.isFinite(F)) needF = true;
    const value = out.dw1 * G * g * F;
    out.rows.push({ i, r, G, g, gOwn: Number.isFinite(ownG), gExtra: Number.isFinite(ownG) ? '' : gExtra, F, FOwn: Number.isFinite(ownF), FTab: !!fTab, FExtra: fTab?.extra ?? '', value });
  }
  if (extra.size) add('info', L(`g_L(r) вне таблицы HEBD (${ru(rs[0], 2)}–${ru(rs[rs.length - 1], 0)} см) экстраполирована по HEBD, табл. III: ${[extra.has('near') ? `ближе ${ru(rs[0], 2)} см — значение на ${ru(rs[0], 2)} см` : '', extra.has('far') ? `дальше ${ru(rs[rs.length - 1], 0)} см — линейно по двум последним точкам` : ''].filter(Boolean).join('; ')}.`, `g_L(r) outside the HEBD table (${rs[0]}–${rs[rs.length - 1]} cm) is extrapolated per HEBD Table III: ${[extra.has('near') ? `closer than ${rs[0]} cm, the value at ${rs[0]} cm` : '', extra.has('far') ? `beyond ${rs[rs.length - 1]} cm, linearly from the last two points` : ''].filter(Boolean).join('; ')}.`), `${REF.hebd}, табл. III`, 't_r_0');
  if (extra.has('near')) add('warn', L(`Точка ближе ${ru(rs[0], 2)} см к центру источника — у самой капсулы: формализм TG-43 там неточен.`, `A point closer than ${rs[0]} cm to the source centre is next to the capsule: the TG-43 formalism is inaccurate there.`), `${REF.hebd}, разд. III`, 't_r_0');
  if (needG) add('warn', L('Для своей модели введите g_L(r) в каждой строке.', 'For your own model, enter g_L(r) in each row.'), GL_REF[f.nuclide] ?? null, 't_r_0');
  const ft = HEBD_F[src.id];
  if (out.rows.some((x) => x.FTab)) add('info', L(`F(r,θ) — по таблице HEBD (табл. ${ft.table}, r ${ru(ft.r[0], 0)}–${ru(ft.r[ft.r.length - 1], 0)} см, θ 0–180°), билинейная интерполяция${fExtra.has('far') ? `; дальше ${ru(ft.r[ft.r.length - 1], 0)} см — значение на ${ru(ft.r[ft.r.length - 1], 0)} см (табл. III)` : ''}.`, `F(r,θ) from the HEBD table (Table ${ft.table}, r ${ft.r[0]}–${ft.r[ft.r.length - 1]} cm, θ 0–180°), bilinear interpolation${fExtra.has('far') ? `; beyond ${ft.r[ft.r.length - 1]} cm, the value at ${ft.r[ft.r.length - 1]} cm (Table III)` : ''}.`), `${REF.hebd}, табл. ${ft.table}, III`, 't_th');
  if (needF) add('warn', L(`Вне поперечной оси (θ = ${ru(th, 0)}°) нужна функция анизотропии F(r,θ) — возьмите из таблиц HEBD для своей модели.`, `Off the transverse axis (θ = ${th}°) the anisotropy function F(r,θ) is needed: take it from the HEBD tables for your model.`), REF.hebd, 't_th');
  if (f.t_basis !== 'manual' && !Number.isFinite(cert.half) && Number.isFinite(base.t)) add('error', L('Не задан период полураспада.', 'The half-life is not set.'), null, 'half');
  add('info', L('Справочно: формализм TG-43 не учитывает неоднородности и ограниченность среды. Для проверки системы планирования — таблицы «вдоль-поперёк» HEBD для своей модели.', 'For reference: the TG-43 formalism ignores heterogeneities and finite scatter conditions. For a TPS check, use the HEBD along-away tables for your model.'), `${REF.tg43}; ${REF.hebd}`, null);
  out.ok = out.rows.length > 0;
  return out;
}

export { STRENGTH_UNITS, ACTIVITY_UNITS, GAMMA_UNITS, WELL_N_UNITS, PHANTOM_N_UNITS, CURRENT_UNITS, KSM_SOURCES, DOSE_SOURCES, isDwUnit };
