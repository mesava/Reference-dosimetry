// Референсная дозиметрия пучков гамма-излучения ⁶⁰Co.
// TRS-398 Rev.1, глава 5: D_w = M · N_D,w (k_Q = 1), z_ref = 5 или 10 г/см², РИП/РИК 80 или 100 см, поле 10 × 10 см.
// TG-51 (1999): D_w = M · N_D,w⁶⁰Co (k_Q = 1,000), опорная глубина 10 см.
// Непрерывный пучок: рекомбинация — TRS-398 разд. 4.4.3.4 b) (ур. 13 или 16), TG-51 ур. (11).
// Ошибка таймера — TRS-398 разд. 5.4.2; TG-51 разд. VII («shutter timing error»).

import { parseNumber, parseCells, isBlank, pressureToKPa, ndwToGyPerNC, ru, dec } from './units.js';
import { L } from './i18n.js';
import { temperaturePressure, polarity, environmentChecks, complianceOf } from './common.js';
import { resolveCoChamber, matchCoChamberByName } from './co60-chambers.js';
import * as TG51 from './tg51.js';
import * as TRS from './trs398.js';
import { uncertaintyBudget, typeAOf, mergeBudgetMessages } from './uncertainty.js';

export const CO_DEFAULTS = {
  protocol: 'trs',

  co_institution: '',
  co_machine: '',
  co_date: '',
  co_staff: [''],
  co_notes: '',

  co_geometry: 'SSD', // 'SSD' | 'SAD'
  co_distance: '80', // см
  co_zref: '5', // г/см²

  co_ch_model: '', // id камеры из базы (co60-chambers.js), 'PP:…', 'MY:…' или 'CUSTOM'
  co_cc_maker: '', // своя камера
  co_cc_model: '',
  co_cc_type: 'cyl', // 'cyl' | 'pp'
  co_ch_serial: '',
  co_ndw: '',
  co_ndw_unit: 'Gy/nC',
  co_T0: '20',
  co_P0: '101,325',
  co_el_model: '',
  co_el_serial: '',
  co_kelec: '1,000',
  co_lab_pol_applied: true,
  co_lab_kpol: '',
  co_lab_ks_applied: true,
  co_lab_ks: '',

  co_env_T: '',
  co_env_H: '',
  co_env_P: '',
  co_env_P_unit: 'kPa',

  co_time: '1',
  co_time_unit: 'min', // 'min' | 's'
  // 'measured' — серия облучений с разным временем; 'nexp' — одно облучение t против n облучений по t/n;
  // 'manual' — известное τ; 'window' — заряд накоплен электрометром на интервале, когда источник уже выдвинут; 'none'
  co_timer_mode: 'measured',
  co_tau: '',
  co_tt: ['', ''],
  co_tm: ['', ''],
  co_nx_t: '1', // время одиночного облучения
  co_nx_n: '5',
  co_nx_M1: ['', '', ''], // показание за одно облучение t
  co_nx_Mn: ['', '', ''], // показание за n облучений по t/n

  co_V1: '300',
  co_V2: '100',
  co_polarity: '+',
  co_M1: ['', '', ''],
  co_Mopp: ['', '', ''],
  co_M2: ['', '', ''],
  co_kleak: '1,000',
  co_rec_trs: 'eq13', // 'eq13' | 'eq16'

  // контрольные измерения: обычная полярность, V₁; поправки — из основных серий
  co_Mc: ['', '', ''],
  co_ctrl_time: '', // пусто — то же время, что в основных сериях

  co_dd_on: true,
  co_zmax: '0,5',
  co_dd_sad: 'tmr', // установка по РИК: 'tmr' | 'pdd' (PDD при РИП = РИК − z_ref)
  co_pdd: '',
  co_tmr: '',
  co_act0: '', // активность источника при установке
  co_act_unit: 'Ci', // 'Ci' | 'TBq'
  co_act_date: '', // дата установки источника (дата паспортной активности)
  co_ref_rate: '', // сГр/мин при вводе в эксплуатацию или предыдущей калибровке
  co_ref_at: 'zmax', // на какой глубине задано значение для сравнения: 'zmax' | 'zref'
  co_ref_date: '', // дата, к которой относится co_ref_rate; пусто — дата установки источника, если указана

  // бюджет неопределённости (uncertainty.js): образец — TRS-398, табл. 13 (TG-51 бюджета для ⁶⁰Co не даёт)
  co_unc_cert_U: '',
  co_unc_cert_k: '2',
  co_unc_cross: false,
  co_unc_over: '',
};

export const ACTIVITY_UNITS = { Ci: { label: 'Ки', labelEn: 'Ci', toTBq: 0.037 }, TBq: { label: 'ТБк', labelEn: 'TBq', toTBq: 1 } };

/** Период полураспада ⁶⁰Co: 5,2711 года (оценка DDEP: Bé et al., Monographie BIPM-5, т. 3, 2006), в сутках. */
export const CO60_HALF_LIFE_DAYS = 5.2711 * 365.25;

/** Множитель распада между двумя датами ISO (YYYY-MM-DD). */
export function decayFactor(fromIso, toIso) {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { error: L('не удалось прочитать даты', 'could not read the dates') };
  const days = (b - a) / 86400000;
  return { days, factor: Math.pow(2, -days / CO60_HALF_LIFE_DAYS) };
}

const REF = {
  tg51: 'TG-51 (1999)',
  add: 'аддендум TG-51 (2014)',
  r374: 'WGTG51 Report 374',
  trs: 'TRS-398 Rev.1',
};

// первая буква — заглавная, кроме обозначений величин (k_Q, k′_Q, …)
const cap = (s) => (/^[a-z][_′]/.test(s) ? s : s[0].toUpperCase() + s.slice(1));

export function normalizeCobalt(input) {
  const f = { ...CO_DEFAULTS, ...input };
  if (f.protocol !== 'tg51') f.protocol = 'trs'; // режима «оба протокола» больше нет
  for (const k of ['co_M1', 'co_Mopp', 'co_M2']) if (!Array.isArray(f[k])) f[k] = isBlank(f[k]) ? ['', '', ''] : String(f[k]).trim().split(/[\s;]+/);
  for (const k of ['co_tt', 'co_tm']) if (!Array.isArray(f[k])) f[k] = ['', ''];
  if (f.co_unc_over && typeof f.co_unc_over === 'object') f.co_unc_over = JSON.stringify(f.co_unc_over);
  for (const k of ['co_nx_M1', 'co_nx_Mn', 'co_Mc']) if (!Array.isArray(f[k])) f[k] = isBlank(f[k]) ? ['', '', ''] : String(f[k]).trim().split(/[\s;]+/);
  // до появления списка камер модель вводилась текстом, а тип — отдельно
  if (!isBlank(f.co_ch_model) && !resolveCoChamber(f) && !String(f.co_ch_model).startsWith('MY:')) {
    const id = matchCoChamberByName(f.co_ch_model);
    if (id) f.co_ch_model = id;
    else {
      f.co_cc_model = f.co_ch_model;
      f.co_cc_type = input?.co_ch_type === 'pp' ? 'pp' : 'cyl';
      f.co_ch_model = 'CUSTOM';
    }
  }
  delete f.co_ch_type;
  if (!isBlank(input?.co_expected) && isBlank(f.co_ref_rate)) f.co_ref_rate = input.co_expected;
  delete f.co_expected;
  if (!Array.isArray(f.co_staff) || f.co_staff.length === 0) f.co_staff = [''];
  return f;
}

/**
 * Ошибка таймера по серии облучений с разным заданным временем.
 * Показание пропорционально фактическому времени облучения: M = Ṁ·(t + τ).
 * Прямая M = a·t + b по методу наименьших квадратов даёт τ = b/a.
 */
export function timerError(times, readings) {
  const pts = [];
  for (let i = 0; i < Math.max(times.length, readings.length); i++) {
    const t = parseNumber(times[i]);
    const m = parseNumber(readings[i]);
    if (isBlank(times[i]) && isBlank(readings[i])) continue;
    if (!Number.isFinite(t) || !Number.isFinite(m)) return { error: L(`строка ${i + 1}: нужно время и показание`, `row ${i + 1}: both time and reading are required`) };
    pts.push({ t, m: Math.abs(m) });
  }
  if (pts.length < 2) return { error: L('нужны хотя бы два облучения с разным временем', 'at least two exposures with different times are required') };
  const n = pts.length;
  const st = pts.reduce((s, p) => s + p.t, 0);
  const sm = pts.reduce((s, p) => s + p.m, 0);
  const stt = pts.reduce((s, p) => s + p.t * p.t, 0);
  const stm = pts.reduce((s, p) => s + p.t * p.m, 0);
  const den = n * stt - st * st;
  if (Math.abs(den) < 1e-12) return { error: L('времена облучения должны различаться', 'the exposure times must differ') };
  const a = (n * stm - st * sm) / den;
  const b = (sm - a * st) / n;
  if (!(a > 0)) return { error: L('показание должно расти с временем облучения', 'the reading must increase with exposure time') };
  let residual = 0;
  if (n > 2) residual = Math.sqrt(pts.reduce((s, p) => s + (p.m - (a * p.t + b)) ** 2, 0) / (n - 2)) / (sm / n);
  return { tau: b / a, slope: a, intercept: b, n, residual };
}

/**
 * Ошибка таймера по двум измерениям: одно облучение временем t (показание M₁) и n облучений
 * по t/n подряд (суммарное показание Mₙ). M₁ = Ṁ·(t + τ), Mₙ = Ṁ·(t + n·τ), откуда
 * τ = t·(Mₙ − M₁)/(n·M₁ − Mₙ).
 */
export function timerErrorMultiple(t, n, m1, mn) {
  if (!(t > 0)) return { error: L('время одиночного облучения должно быть больше нуля', 'the single exposure time must be greater than zero') };
  if (!(Number.isInteger(n) && n >= 2)) return { error: L('число облучений n должно быть целым, не меньше 2', 'the number of exposures n must be an integer of at least 2') };
  const a = Math.abs(m1);
  const b = Math.abs(mn);
  if (!(a > 0) || !(b > 0)) return { error: L('нужны оба показания', 'both readings are required') };
  const den = n * a - b;
  if (Math.abs(den) < 1e-12 * a) return { error: L('показания несовместимы: n·M₁ = Mₙ', 'inconsistent readings: n·M₁ = Mₙ') };
  return { tau: (t * (b - a)) / den };
}

export function computeCobalt(form) {
  const f = normalizeCobalt(form);
  const messages = [];
  const flags = {};
  const rank = { info: 0, warn: 1, error: 2 };
  const flag = (key, level) => {
    if (!flags[key] || rank[level] > rank[flags[key]]) flags[key] = level;
  };
  // nonstd — краткая причина, если замечание означает отступление от референсных условий протокола
  const add = (level, scope, text, ref = null, field = null, nonstd = null) => {
    messages.push(nonstd ? { level, scope, text, ref, nonstd } : { level, scope, text, ref });
    if (field) [].concat(field).forEach((k) => flag(k, level));
  };
  const read = (key, label, scope = 'common') => {
    const v = parseNumber(f[key]);
    if (!Number.isFinite(v)) add('error', scope, isBlank(f[key]) ? L(`Не заполнено поле «${label}».`, `Field "${label}" is empty.`) : L(`Не удалось прочитать число в поле «${label}».`, `Could not read the number in field "${label}".`), null, key);
    return v;
  };
  const readCells = (key, label, scope = 'common') => {
    const s = parseCells(f[key]);
    if (s.error) add('error', scope, L(`«${label}»: ${s.error}.`, `"${label}": ${s.error}.`), null, key);
    else if (s.n === 0) add('error', scope, L(`Не заполнено поле «${label}».`, `Field "${label}" is empty.`), null, key);
    else if (s.mean === 0) add('error', scope, L(`«${label}»: среднее показание равно нулю.`, `"${label}": the mean reading is zero.`), null, key);
    return s;
  };
  const spread = (s, label, key, scope = 'common') => {
    if (!s || s.n < 2 || !s.mean) return;
    const d = Math.max(...s.values.map((v) => Math.abs(v - s.mean) / Math.abs(s.mean)));
    const pct = ru(d * 100, 2);
    if (d > 0.05) add('error', scope, L(`Показания ${label} расходятся на ${pct} % от среднего: вероятно, ошибка ввода.`, `Readings ${label} differ from the mean by up to ${pct} %: probably a data-entry error.`), null, key);
    else if (d > 0.005) add('warn', scope, L(`Разброс показаний ${label} до ${pct} % от среднего: повторите облучения.`, `Spread of readings ${label} up to ${pct} % of the mean: repeat the exposures.`), `${REF.r374}, разд. 4.4.2`, key);
    else if (d > 0.001) add('info', scope, L(`Разброс показаний ${label} до ${pct} % от среднего: Report 374 советует повторять облучения, пока отклонение не станет меньше ±0,1 % без тренда.`, `Spread of readings ${label} up to ${pct} % of the mean: Report 374 recommends repeating exposures until the deviation is below ±0.1 % with no trend.`), `${REF.r374}, разд. 4.4.2`, key);
  };

  const want51 = f.protocol === 'tg51';
  const wantTRS = !want51;

  // ------------------------------------------------------------ геометрия
  const distance = read('co_distance', L('Расстояние', 'Distance'));
  if (Number.isFinite(distance)) {
    if (distance < 50 || distance > 150) add('error', 'common', L('Расстояние задаётся в сантиметрах (обычно 80 или 100).', 'The distance is entered in centimeters (usually 80 or 100).'), null, 'co_distance');
    else if (distance !== 80 && distance !== 100) {
      add('info', 'common', L('TRS-398 задаёт РИП или РИК 80 или 100 см — то, что используется клинически.', 'TRS-398 specifies an SSD or SCD of 80 or 100 cm, whichever is used clinically.'), `${REF.trs}, табл. 12`, 'co_distance', wantTRS ? L(`расстояние ${ru(distance, distance % 1 ? 1 : 0)} см вместо 80 или 100 см`, `distance ${ru(distance, distance % 1 ? 1 : 0)} cm instead of 80 or 100 cm`) : null);
    }
  }
  const zref = parseNumber(f.co_zref);
  if (want51 && zref !== 10) {
    add('warn', 'tg51', L('TG-51 определяет дозу на глубине 10 см: для z_ref = 5 г/см² считайте по TRS-398 или выберите 10 г/см².', 'TG-51 specifies the dose at a depth of 10 cm: for z_ref = 5 g/cm², use TRS-398 or select 10 g/cm².'), `${REF.tg51}, разд. IX.A`, 'co_zref', L(`z_ref = ${ru(zref, 0)} г/см² вместо 10 г/см²`, `z_ref = ${ru(zref, 0)} g/cm² instead of 10 g/cm²`));
  }

  // ---------------------------------------------------------------- камера
  const chamber = resolveCoChamber(f);
  if (!chamber) add('error', 'common', L('Выберите камеру.', 'Select a chamber.'), null, 'co_ch_model');
  if (chamber?.type === 'pp') {
    add('info', 'trs', L('Плоскопараллельную камеру можно использовать в пучке ⁶⁰Co, если она откалибрована в пучке того же качества. Опорная точка — внутренняя поверхность входного окна, в центре окна.', 'A plane-parallel chamber may be used in a ⁶⁰Co beam if it was calibrated in a beam of the same quality. The reference point is the inner surface of the entrance window, at its center.'), `${REF.trs}, разд. 5.2.1, сноска 29`);
  }
  if (chamber?.sleeve) add('info', 'common', L('Камера не водонепроницаема: используйте тот же чехол (ПММА ≤ 1 мм), что и при калибровке.', 'The chamber is not waterproof: use the same waterproofing sleeve (PMMA ≤ 1 mm) as at calibration.'), `${REF.trs}, разд. 4.2.4; ${REF.tg51}, разд. V.A`);
  if (chamber?.notReferenceClass) add('info', 'common', L('По TRS-398 Rev.1 (табл. 4) камера не отвечает спецификации эталонного класса: для калибровки пучка лучше использовать камеру эталонного класса.', 'According to TRS-398 Rev.1 (Table 4), this chamber does not meet the reference-class specification: a reference-class chamber is preferable for beam calibration.'), `${REF.trs}, табл. 4`, null, L('камера не эталонного класса (TRS-398 Rev.1, табл. 4)', 'chamber not of reference class (TRS-398 Rev.1, Table 4)'));
  const ndwRaw = read('co_ndw', 'N_D,w');
  const ndw = Number.isFinite(ndwRaw) ? ndwToGyPerNC(ndwRaw, f.co_ndw_unit) : NaN;
  if (Number.isFinite(ndw) && (ndw < 1e-3 || ndw > 5)) {
    add('warn', 'common', L(`N_D,w = ${dec(ndw.toPrecision(4))} Гр/нКл выглядит неправдоподобно: проверьте единицы.`, `N_D,w = ${dec(ndw.toPrecision(4))} Gy/nC looks implausible: check the units.`), null, 'co_ndw');
  }
  const T0 = read('co_T0', L('T₀ из сертификата', 'T₀ from the certificate'));
  const P0 = read('co_P0', L('P₀ из сертификата', 'P₀ from the certificate'));
  if (Number.isFinite(T0) && (T0 < 15 || T0 > 25)) add('error', 'common', L('T₀ задаётся в °C (обычно 20 или 22).', 'T₀ is entered in °C (usually 20 or 22).'), null, 'co_T0');
  if (Number.isFinite(P0) && (P0 < 95 || P0 > 105)) add('warn', 'common', L('P₀ задаётся в кПа (обычно 101,325 или 101,33).', 'P₀ is entered in kPa (usually 101.325 or 101.33).'), null, 'co_P0');
  const kelec = read('co_kelec', 'k_elec (P_elec)');
  if (Number.isFinite(kelec) && Math.abs(kelec - 1) > 0.02) add('warn', 'common', L('k_elec отличается от 1 больше чем на 2 %: проверьте сертификат электрометра.', 'k_elec differs from 1 by more than 2 %: check the electrometer calibration certificate.'), null, 'co_kelec');

  // ------------------------------------------------------------ окружающая среда
  const T = read('co_env_T', L('Температура воды', 'Water temperature'));
  const Pin = read('co_env_P', L('Давление', 'Pressure'));
  const P = Number.isFinite(Pin) ? pressureToKPa(Pin, f.co_env_P_unit) : NaN;
  if (Number.isFinite(P) && (P < 50 || P > 110)) add('error', 'common', L(`Давление ${ru(P, 2)} кПа вне правдоподобного диапазона: проверьте единицы.`, `Pressure ${ru(P, 2)} kPa is outside the plausible range: check the units.`), null, 'co_env_P');
  const env = environmentChecks({ T, Hraw: f.co_env_H, keyT: 'co_env_T', keyH: 'co_env_H', parseNumber, isBlank, ru });
  env.items.forEach(([level, text, ref, key]) => add(level, 'common', text, ref, key));

  // ------------------------------------------------------------ время и таймер
  const windowMode = f.co_timer_mode === 'window';
  const tSet = read('co_time', windowMode ? L('Время накопления заряда', 'Charge collection time') : L('Заданное время облучения', 'Set irradiation time'));
  if (Number.isFinite(tSet) && tSet <= 0) add('error', 'common', L('Время облучения должно быть больше нуля.', 'The irradiation time must be greater than zero.'), null, 'co_time');
  const unitLabel = f.co_time_unit === 's' ? L('с', 's') : L('мин', 'min');
  const toMin = f.co_time_unit === 's' ? 1 / 60 : 1;
  let tau = 0;
  let timer = { mode: f.co_timer_mode };
  if (f.co_timer_mode === 'manual') {
    tau = read('co_tau', L('Ошибка таймера τ', 'Timer error τ'));
  } else if (f.co_timer_mode === 'window') {
    add('info', 'common', L('Заряд накоплен электрометром на интервале, когда источник уже в рабочем положении: ошибка таймера в мощность дозы не входит. Все серии, включая контрольные, нужно снимать так же. Для расчёта времени облучения пациентов ошибку таймера всё равно нужно знать.', 'Charge was collected by the electrometer over an interval with the source already in the treatment (exposed) position, so the timer error does not enter the dose rate. All series, including the check measurements, must be taken the same way. The timer error must still be known for calculating patient treatment times.'), `${REF.trs}, разд. 5.4.2`);
  } else if (f.co_timer_mode === 'nexp') {
    const tn = read('co_nx_t', L('Время одиночного облучения t', 'Single exposure time t'));
    const n = read('co_nx_n', L('Число облучений n', 'Number of exposures n'));
    const A = readCells('co_nx_M1', L('Показание за одно облучение t', 'Reading for one exposure t'));
    const B = readCells('co_nx_Mn', L('Показание за n облучений по t/n', 'Reading for n exposures of t/n'));
    spread(A, L('за одно облучение', 'for one exposure'), 'co_nx_M1');
    spread(B, L('за n облучений', 'for n exposures'), 'co_nx_Mn');
    if (Number.isFinite(tn) && Number.isFinite(n) && A.n > 0 && B.n > 0 && !A.error && !B.error) {
      const r = timerErrorMultiple(tn, n, A.mean, B.mean);
      if (r.error) add('error', 'common', L(`Ошибка таймера: ${r.error}.`, `Timer error: ${r.error}.`), null, ['co_nx_n', 'co_nx_M1', 'co_nx_Mn']);
      else if (Math.abs(r.tau / tn) > 0.2 || Math.abs(B.mean) < 0.5 * Math.abs(A.mean) || Math.abs(B.mean) > 2 * Math.abs(A.mean)) {
        add('error', 'common', L(`Ошибка таймера ${ru(r.tau, 3)} ${f.co_time_unit === 's' ? 'с' : 'мин'} неправдоподобна: суммарное показание за n облучений по t/n должно быть близко к показанию за одно облучение t. Проверьте, что Mₙ — сумма за все n облучений, а не среднее за одно.`, `Timer error ${ru(r.tau, 3)} ${unitLabel} is implausible: the total reading for n exposures of t/n should be close to the reading for one exposure t. Check that Mₙ is the sum over all n exposures, not the mean per exposure.`), null, ['co_nx_M1', 'co_nx_Mn']);
      } else {
        tau = r.tau;
        timer = { ...timer, t: tn, n, M1: Math.abs(A.mean), Mn: Math.abs(B.mean) };
      }
    }
  } else if (f.co_timer_mode === 'measured') {
    const r = timerError(f.co_tt, f.co_tm);
    if (r.error) add('error', 'common', L(`Ошибка таймера: ${r.error}.`, `Timer error: ${r.error}.`), null, 'co_timer');
    else {
      tau = r.tau;
      timer = { ...timer, ...r, residualPct: r.n > 2 ? r.residual * 100 : NaN };
      if (r.residual > 0.002) add('warn', 'common', L(`Показания при разных временах плохо ложатся на прямую (разброс ${ru(r.residual * 100, 2)} %): повторите облучения.`, `Readings at different times fit a straight line poorly (residual ${ru(r.residual * 100, 2)} %): repeat the exposures.`), null, 'co_timer');
    }
  } else {
    add('warn', 'common', L('Ошибка таймера не учтена. Для аппаратов с ⁶⁰Co она может заметно влиять на показание; её нужно определить.', 'Timer error not accounted for. On ⁶⁰Co units it can noticeably affect the reading; it must be determined.'), `${REF.trs}, разд. 5.4.2; ${REF.tg51}, разд. VII`, 'co_timer_mode');
  }
  timer.tau = tau;
  const tEff = tSet + tau;
  if (Number.isFinite(tau) && Number.isFinite(tSet) && tSet > 0) {
    timer.relative = tau / tSet;
    timer.relativePct = timer.relative * 100;
    if (tEff <= 0) add('error', 'common', L('Фактическое время облучения t + τ получилось неположительным: проверьте ошибку таймера.', 'The actual irradiation time t + τ is not positive: check the timer error.'), null, 'co_tau');
    else if (Math.abs(tau / tSet) > 0.05) add('warn', 'common', L(`Ошибка таймера ${ru(tau, 3)} ${unitLabel} — больше 5 % от времени облучения: проверьте измерения.`, `Timer error ${ru(tau, 3)} ${unitLabel} exceeds 5 % of the irradiation time: check the measurements.`), null, ['co_tau', 'co_timer']);
  }
  const tEffMin = tEff * toMin;

  // ------------------------------------------------------------- показания
  const V1 = read('co_V1', L('Рабочее напряжение V₁', 'Operating voltage V₁'));
  const V2 = read('co_V2', L('Пониженное напряжение V₂', 'Reduced voltage V₂'));
  if (Number.isFinite(V1) && Number.isFinite(V2) && Math.abs(V1) <= Math.abs(V2)) add('error', 'common', L('Рабочее напряжение V₁ должно быть больше пониженного V₂.', 'Operating voltage V₁ must be higher than reduced voltage V₂.'), null, ['co_V1', 'co_V2']);
  if (want51 && Number.isFinite(V1) && Math.abs(V1) > 300 && chamber?.type !== 'pp') add('warn', 'tg51', L('Аддендум TG-51 рекомендует для цилиндрических камер не более 300 В.', 'The TG-51 addendum recommends no more than 300 V for cylindrical chambers.'), `${REF.add}, разд. 4.E`, 'co_V1');
  const M1 = readCells('co_M1', L('M при V₁, обычная полярность', 'M at V₁, normal polarity'));
  const Mopp = readCells('co_Mopp', L('M при V₁, обратная полярность', 'M at V₁, opposite polarity'));
  const M2 = readCells('co_M2', L('M при V₂', 'M at V₂'));
  spread(M1, L('при V₁', 'at V₁'), 'co_M1');
  spread(Mopp, L('обратной полярности', 'at opposite polarity'), 'co_Mopp');
  spread(M2, L('при V₂', 'at V₂'), 'co_M2');
  const kleak = read('co_kleak', L('Поправка на утечку', 'Leakage correction'));
  if (Number.isFinite(kleak) && Math.abs(kleak - 1) > 0.001) add('warn', 'common', L('Утечка больше 0,1 % показания: причину нужно выяснить.', 'Leakage exceeds 0.1 % of the reading: the cause must be found.'), `${REF.add}, табл. III; ${REF.trs}, табл. 3`, 'co_kleak', L('утечка больше 0,1 %: камера не отвечает критерию эталонного класса', 'leakage above 0.1 %: the chamber does not meet the reference-class criterion'));

  const readingsOk = M1.n > 0 && !M1.error && M1.mean !== 0;
  const m1 = readingsOk ? Math.abs(M1.mean) : NaN;
  let kpolRaw = NaN;
  if (readingsOk && Mopp.n > 0 && !Mopp.error) {
    kpolRaw = polarity(M1.mean, Mopp.mean);
    if (Math.abs(kpolRaw - 1) > 0.004) {
      add('warn', 'common', L(`k_pol = ${ru(kpolRaw, 4)} выходит за пределы 1 ± 0,004: для камеры эталонного класса эффект полярности должен быть меньше 0,4 %.`, `k_pol = ${ru(kpolRaw, 4)} is outside 1 ± 0.004: for a reference-class chamber the polarity effect should be below 0.4 %.`), `${REF.trs}, табл. 3; ${REF.add}, табл. III`, 'kpol', L(`k_pol = ${ru(kpolRaw, 4)}: эффект полярности больше 0,4 % (критерий эталонного класса)`, `k_pol = ${ru(kpolRaw, 4)}: polarity effect above 0.4 % (reference-class criterion)`));
    }
  }
  let kpolQ0 = 1;
  if (!f.co_lab_pol_applied) kpolQ0 = read('co_lab_kpol', L('Поправка на полярность при калибровке', 'Polarity correction at calibration'));
  const kpol = kpolRaw / kpolQ0;

  const nV = Math.abs(V1) / Math.abs(V2);
  const recOk = readingsOk && M2.n > 0 && !M2.error && M2.mean !== 0 && Number.isFinite(nV) && nV > 1;
  if (readingsOk && M2.n > 0 && Math.sign(M1.mean) !== Math.sign(M2.mean)) add('error', 'common', L('Показания при V₁ и V₂ должны быть сняты при одной и той же (обычной) полярности.', 'Readings at V₁ and V₂ must be taken at the same (normal) polarity.'), null, 'co_M2');
  const ratio12 = recOk ? Math.abs(M1.mean) / Math.abs(M2.mean) : NaN;
  if (recOk && ratio12 < 1) {
    add('error', 'common', L('k_s (P_ion) не может быть меньше 1: при пониженном напряжении собирается меньше заряда. Проверьте показания и напряжения.', 'k_s (P_ion) cannot be less than 1: less charge is collected at the reduced voltage. Check the readings and voltages.'), `${REF.trs}, разд. 4.4.3.4`, ['ks', 'Pion', 'co_M2']);
  }
  let ksQ0 = 1;
  if (!f.co_lab_ks_applied) ksQ0 = read('co_lab_ks', L('Поправка на рекомбинацию при калибровке', 'Recombination correction at calibration'));

  // ------------------------------------------------------- контрольные измерения
  // Три облучения при обычной полярности и V₁ после определения поправок: k_pol и k_s берутся
  // из основных серий, итоговая мощность дозы считается по контрольным показаниям.
  const ctrlRaw = parseCells(f.co_Mc);
  const ctrl = { on: ctrlRaw.n > 0 || !!ctrlRaw.error };
  if (ctrl.on) {
    ctrl.M = readCells('co_Mc', L('Контрольные измерения', 'Check measurements'), 'ctrl');
    spread(ctrl.M, L('контрольных измерений', 'of the check measurements'), 'co_Mc', 'ctrl');
    if (readingsOk && ctrl.M.n > 0 && !ctrl.M.error && ctrl.M.mean !== 0 && Math.sign(ctrl.M.mean) !== Math.sign(M1.mean)) {
      add('error', 'ctrl', L('Контрольные измерения снимают при той же (обычной) полярности, что и M при V₁.', 'Check measurements must be taken at the same (normal) polarity as M at V₁.'), null, 'co_Mc');
    }
    ctrl.t = isBlank(f.co_ctrl_time) ? tSet : read('co_ctrl_time', L('Время контрольного облучения', 'Control exposure time'), 'ctrl');
    if (Number.isFinite(ctrl.t) && ctrl.t <= 0) add('error', 'ctrl', L('Время контрольного облучения должно быть больше нуля.', 'The control exposure time must be greater than zero.'), null, 'co_ctrl_time');
    ctrl.tEff = ctrl.t + tau;
    ctrl.tEffMin = ctrl.tEff * toMin;
    if (ctrl.t > 0 && Number.isFinite(tau) && !(ctrl.tEff > 0)) add('error', 'ctrl', L('Фактическое время контрольного облучения t + τ получилось неположительным: проверьте время и ошибку таймера.', 'The actual control exposure time t + τ is not positive: check the time and the timer error.'), null, 'co_ctrl_time');
    ctrl.mean = ctrl.M.n > 0 && !ctrl.M.error ? Math.abs(ctrl.M.mean) : NaN;
    const ctrlErr = messages.some((m) => m.level === 'error' && m.scope === 'ctrl');
    if (!ctrlErr && Number.isFinite(ctrl.mean) && Number.isFinite(m1) && ctrl.tEff > 0 && tEff > 0) {
      ctrl.changePct = ((ctrl.mean / ctrl.tEff) / (m1 / tEff) - 1) * 100;
    }
  }

  // ------------------------------------------------------------- TRS-398
  const trs = { enabled: wantTRS };
  if (wantTRS) {
    if (Number.isFinite(zref) && zref !== 5 && zref !== 10) add('error', 'trs', L('TRS-398 допускает z_ref = 5 или 10 г/см².', 'TRS-398 allows z_ref = 5 or 10 g/cm².'), `${REF.trs}, табл. 12`, 'co_zref');
    trs.kTP = temperaturePressure({ T, P, T0, P0, abs0: TRS.TRS_ABS0 });
    trs.kelec = kelec;
    trs.kpol = kpol;
    trs.kleak = kleak;
    if (recOk) {
      if (f.co_rec_trs === 'eq16') {
        trs.ksRaw = (nV * nV - 1) / (nV * nV - ratio12);
        trs.ksEquation = L('ур. (16): k_s = (n² − 1)/(n² − M₁/M₂), общая рекомбинация в непрерывном пучке', 'Eq. (16): k_s = (n² − 1)/(n² − M₁/M₂), general recombination in a continuous beam');
      } else {
        const r = TRS.ks({ m1: M1.mean, m2: M2.mean, v1: Math.abs(V1), v2: Math.abs(V2), beam: 'pulsed' });
        trs.ksRaw = r.value;
        trs.ksEquation = L(`${r.equation}; в непрерывном пучке преобладает начальная рекомбинация (разд. 4.4.3.4 b)`, `${r.equation}; initial recombination dominates in a continuous beam (Sec. 4.4.3.4 b)`);
        if (r.error) add('error', 'trs', cap(r.error) + '.', `${REF.trs}, табл. 10`, 'ks');
        r.notes.forEach((n) => add('warn', 'trs', cap(n) + '.', `${REF.trs}, разд. 4.4.3.4`, 'ks'));
      }
      trs.ks = trs.ksRaw / ksQ0;
      // пороги — по измеренному k_s (рекомбинация в пучке пользователя); отношение k_s,Q/k_s,Q₀ может быть < 1
      if (trs.ksRaw > 1.05) add('error', 'trs', L(`k_s = ${ru(trs.ksRaw, 4)} > 1,05: метод двух напряжений неприменим.`, `k_s = ${ru(trs.ksRaw, 4)} > 1.05: the two-voltage method is not applicable.`), `${REF.trs}, табл. 3`, 'ks');
      if (ratio12 >= 1 && trs.ksRaw < 1) add('error', 'trs', L(`k_s = ${ru(trs.ksRaw, 4)} < 1: так быть не может, проверьте показания и напряжения.`, `k_s = ${ru(trs.ksRaw, 4)} < 1 is impossible: check the readings and the voltages.`), `${REF.trs}, разд. 4.4.3.4`, 'ks');
    } else trs.ks = NaN;
  }

  // ------------------------------------------------------------- TG-51
  const tg = { enabled: want51 };
  if (want51) {
    tg.PTP = temperaturePressure({ T, P, T0, P0, abs0: TG51.TG51_ABS0 });
    tg.Pelec = kelec;
    tg.Ppol = kpol;
    tg.Pleak = kleak;
    if (recOk) {
      tg.PionRaw = TG51.pIon({ mH: M1.mean, mL: M2.mean, vH: Math.abs(V1), vL: Math.abs(V2), beam: 'continuous' });
      if (nV < 2 - 1e-9) add('warn', 'tg51', L('TG-51: пониженное напряжение должно быть меньше рабочего как минимум вдвое.', 'TG-51: the reduced voltage must be at most half the operating voltage.'), `${REF.tg51}, разд. VII.D.2`, ['co_V1', 'co_V2']);
      tg.Pion = tg.PionRaw / ksQ0;
      if (tg.PionRaw > 1.05) add('error', 'tg51', L(`P_ion = ${ru(tg.PionRaw, 4)} > 1,05: нужна другая камера.`, `P_ion = ${ru(tg.PionRaw, 4)} > 1.05: use a different chamber.`), `${REF.tg51}, разд. VII.D.1`, 'Pion');
      if (ratio12 >= 1 && tg.PionRaw < 1) add('error', 'tg51', L(`P_ion = ${ru(tg.PionRaw, 4)} < 1: так быть не может, проверьте показания и напряжения.`, `P_ion = ${ru(tg.PionRaw, 4)} < 1 is impossible: check the readings and the voltages.`), `${REF.tg51}, разд. VII.D`, 'Pion');
    } else tg.Pion = NaN;
  }

  // ------------------------------------------------------------- пересчёт на z_max
  const depth = { on: !!f.co_dd_on, zref, geometry: f.co_geometry };
  if (depth.on) {
    const readD = (key, label) => {
      const v = parseNumber(f[key]);
      if (!Number.isFinite(v)) add('error', 'depth', isBlank(f[key]) ? L(`Не заполнено поле «${label}».`, `Field "${label}" is empty.`) : L(`Не удалось прочитать число в поле «${label}».`, `Could not read the number in field "${label}".`), null, key);
      return v;
    };
    depth.zmax = readD('co_zmax', L('Глубина z_max', 'Depth z_max'));
    if (Number.isFinite(depth.zmax) && (depth.zmax <= 0 || depth.zmax >= zref)) add('error', 'depth', L(`Глубина z_max должна быть меньше опорной (${ru(zref, 0)} см).`, `Depth z_max must be less than the reference depth (${ru(zref, 0)} cm).`), null, 'co_zmax');
    depth.method = f.co_geometry === 'SAD' && f.co_dd_sad !== 'pdd' ? 'tmr' : 'pdd';
    depth.pddSsd = f.co_geometry === 'SAD' ? distance - zref : distance;
    if (depth.method === 'tmr') {
      const tmr = readD('co_tmr', `TMR(${ru(zref, 0)})`);
      if (Number.isFinite(tmr) && (tmr <= 0.2 || tmr > 1)) add('error', 'depth', L('TMR вводится как отношение (например, 0,904), а не в процентах.', 'TMR is entered as a ratio (e.g. 0.904), not as a percentage.'), null, 'co_tmr');
      depth.factor = tmr;
      depth.label = L(`TMR(${ru(zref, 0)} см)`, `TMR(${ru(zref, 0)} cm)`);
    } else {
      const pdd = readD('co_pdd', `PDD(${ru(zref, 0)})`);
      if (Number.isFinite(pdd) && (pdd < 20 || pdd > 100)) add('error', 'depth', L('PDD вводится в процентах, от 20 до 100.', 'PDD is entered as a percentage, from 20 to 100.'), null, 'co_pdd');
      depth.factor = pdd / 100;
      depth.label = L(
        `PDD(${ru(zref, 0)} см)/100${f.co_geometry === 'SAD' && Number.isFinite(depth.pddSsd) ? ` при РИП ${ru(depth.pddSsd, 0)} см` : ''}`,
        `PDD(${ru(zref, 0)} cm)/100${f.co_geometry === 'SAD' && Number.isFinite(depth.pddSsd) ? ` at SSD ${ru(depth.pddSsd, 0)} cm` : ''}`,
      );
      if (f.co_geometry === 'SAD' && Number.isFinite(depth.pddSsd)) {
        add('info', 'depth', L(`Установка по РИК, пересчёт через PDD: результат — мощность дозы на z_max при той же установке (РИП ${ru(depth.pddSsd, 0)} см), а не в изоцентре. PDD должна быть измерена при РИП ${ru(depth.pddSsd, 0)} см.`, `SCD setup with conversion via PDD: the result is the dose rate at z_max for the same setup (SSD ${ru(depth.pddSsd, 0)} cm), not at the isocenter. The PDD must be measured at SSD ${ru(depth.pddSsd, 0)} cm.`), `${REF.trs}, разд. 5.4.3`);
      }
    }
    depth.ok = !messages.some((m) => m.level === 'error' && m.scope === 'depth');
  }
  // Сравнение с ожидаемой мощностью дозы — на z_max (после пересчёта) или на опорной глубине.
  depth.expectedAt = depth.on && f.co_ref_at !== 'zref' ? 'zmax' : 'zref';
  // ожидаемая мощность дозы: значение при вводе в эксплуатацию или предыдущей калибровке,
  // приведённое к дате измерения по распаду ⁶⁰Co; без своей даты — от даты установки источника
  const refRate = parseNumber(f.co_ref_rate);
  const refDate = isBlank(f.co_ref_date) ? f.co_act_date : f.co_ref_date;
  const refKey = isBlank(f.co_ref_date) ? 'co_act_date' : 'co_ref_date';
  depth.refDate = refDate;
  depth.refDateFromSource = isBlank(f.co_ref_date) && !isBlank(f.co_act_date);
  if (!isBlank(f.co_ref_rate) && !(refRate > 0)) add('warn', 'common', L('Мощность дозы для сравнения должна быть положительным числом (сГр/мин).', 'The comparison dose rate must be a positive number (cGy/min).'), null, 'co_ref_rate');
  if (refRate > 0) {
    depth.refRate = refRate;
    depth.expected = refRate;
    if (!isBlank(refDate)) {
      if (depth.refDateFromSource) add('info', 'common', L(`Для мощности дозы сравнения не указана дата — она пересчитана от даты установки источника (${refDate}). Если это значение предыдущей калибровки, укажите его дату.`, `No date is given for the comparison dose rate, so it is decay-corrected from the source installation date (${refDate}). If this value comes from a previous calibration, enter its date.`), null, 'co_ref_date');
      if (isBlank(f.co_date)) add('warn', 'common', L('Укажите дату измерения (раздел 1), чтобы учесть распад ⁶⁰Co.', 'Enter the measurement date (section 1) to account for ⁶⁰Co decay.'), null, ['co_date', refKey]);
      else {
        const d = decayFactor(refDate, f.co_date);
        if (d.error) add('warn', 'common', L(`Поправка на распад: ${d.error}.`, `Decay correction: ${d.error}.`), null, refKey);
        else {
          if (d.days < 0) add('warn', 'common', L('Дата значения для сравнения позже даты измерения: проверьте даты.', 'The date of the comparison value is later than the measurement date: check the dates.'), null, refKey);
          depth.days = d.days;
          depth.decay = d.factor;
          depth.expected = refRate * d.factor;
        }
      }
    }
  }

  // ------------------------------------------------------- активность источника
  const source = { on: !isBlank(f.co_act0) };
  if (source.on) {
    const a0 = parseNumber(f.co_act0);
    const u = ACTIVITY_UNITS[f.co_act_unit] ?? ACTIVITY_UNITS.Ci;
    if (!(a0 > 0)) add('warn', 'source', L('Активность источника должна быть положительным числом.', 'The source activity must be a positive number.'), null, 'co_act0');
    else {
      source.A0 = a0;
      source.unit = L(u.label, u.labelEn);
      source.A0TBq = a0 * u.toTBq;
      if (isBlank(f.co_act_date)) add('warn', 'source', L('Укажите дату установки источника (дату паспортной активности), чтобы пересчитать активность на дату измерения.', 'Enter the source installation date (the date of the certified activity) to decay-correct the activity to the measurement date.'), null, 'co_act_date');
      else if (isBlank(f.co_date)) add('warn', 'source', L('Укажите дату измерения (раздел 1), чтобы пересчитать активность источника.', 'Enter the measurement date (section 1) to decay-correct the source activity.'), null, ['co_date', 'co_act_date']);
      else {
        const d = decayFactor(f.co_act_date, f.co_date);
        if (d.error) add('warn', 'source', L(`Активность источника: ${d.error}.`, `Source activity: ${d.error}.`), null, 'co_act_date');
        else {
          if (d.days < 0) add('warn', 'source', L('Дата установки источника позже даты измерения: проверьте даты.', 'The source installation date is later than the measurement date: check the dates.'), null, 'co_act_date');
          source.days = d.days;
          source.years = d.days / 365.25;
          source.decay = d.factor;
          source.A = a0 * d.factor;
          source.ATBq = source.A0TBq * d.factor;
          source.ACi = source.ATBq / ACTIVITY_UNITS.Ci.toTBq;
        }
      }
    }
  }

  const finish = (x, M, tMin) => {
    x.M = M;
    x.D = M * ndw; // Гр за облучение
    x.rateGy = x.D / tMin; // Гр/мин на z_ref
    x.rate = x.rateGy * 100; // сГр/мин
    if (depth.on && depth.ok && Number.isFinite(depth.factor)) {
      x.rateMaxGy = x.rateGy / depth.factor;
      x.rateMax = x.rate / depth.factor;
    }
    x.DcGy = x.D * 100; // сГр за облучение
    const atExpected = depth.expectedAt === 'zmax' ? x.rateMax : x.rate;
    if (depth.expected > 0 && Number.isFinite(atExpected)) x.deviation = (atExpected / depth.expected - 1) * 100;
    x.ok = Number.isFinite(x.D) && x.D > 0 && Number.isFinite(x.rate) && x.rate > 0;
  };
  const productTRS = wantTRS ? trs.kTP * trs.kelec * trs.kpol * trs.ks * trs.kleak : NaN;
  const product51 = want51 ? tg.PTP * tg.Pelec * tg.Ppol * tg.Pion * tg.Pleak : NaN;
  if (wantTRS) finish(trs, m1 * productTRS, tEffMin);
  if (want51) finish(tg, m1 * product51, tEffMin);
  const ctrlBlocked = messages.some((m) => m.level === 'error' && m.scope === 'ctrl');
  if (ctrl.on) {
    if (wantTRS) finish((trs.ctrl = {}), ctrl.mean * productTRS, ctrl.tEffMin);
    if (want51) finish((tg.ctrl = {}), ctrl.mean * product51, ctrl.tEffMin);
    for (const x of [trs.ctrl, tg.ctrl]) if (x) x.blocked = ctrlBlocked || !x.ok;
  }

  const hasError = (scope) => messages.some((m) => m.level === 'error' && (m.scope === 'common' || m.scope === scope));
  if (wantTRS && !trs.ok && !hasError('trs')) add('error', 'trs', L('Не удалось вычислить дозу: проверьте ввод.', 'Could not calculate the dose: check the input.'));
  if (want51 && !tg.ok && !hasError('tg51')) add('error', 'tg51', L('Не удалось вычислить дозу: проверьте ввод.', 'Could not calculate the dose: check the input.'));

  // бюджет неопределённости (на итог не влияет); тип А — по серии, по которой посчитан итог
  const unc = uncertaintyBudget({
    beam: 'co60', protocol: f.protocol, crossCo: !!f.co_unc_cross, certU: f.co_unc_cert_U, certK: f.co_unc_cert_k, over: f.co_unc_over,
    typeA: typeAOf(ctrl.on ? ctrl.M : M1), prefix: 'co_',
  });
  mergeBudgetMessages(unc, add);

  const order = { error: 0, warn: 1, info: 2 };
  messages.sort((a, b) => order[a.level] - order[b.level]);
  trs.blocked = wantTRS && hasError('trs');
  tg.blocked = want51 && hasError('tg51');
  if (trs.ctrl) trs.ctrl.blocked = trs.ctrl.blocked || trs.blocked;
  if (tg.ctrl) tg.ctrl.blocked = tg.ctrl.blocked || tg.blocked;

  // соответствие референсным условиям выбранного протокола; если контрольные измерения введены с ошибками, итога нет
  const activeKey = wantTRS ? 'trs' : 'tg51';
  const ax = wantTRS ? trs : tg;
  const shown = ax.blocked ? {} : ctrl.on ? (ax.ctrl && !ax.ctrl.blocked ? ax.ctrl : {}) : ax;
  const compliance = complianceOf(messages, activeKey, Number.isFinite(shown.rate));

  return {
    protocol: f.protocol,
    form: f,
    chamber,
    compliance,
    inputs: { T, P, H: env.H, T0, P0, V1, V2, nV, ndw, kelec, kleak, M1, Mopp, M2, ratio12, tSet, tEff, tEffMin, unitLabel, distance, zref },
    timer,
    ctrl,
    source,
    depth,
    trs,
    tg51: tg,
    unc,
    messages,
    flags,
    hasErrors: messages.some((m) => m.level === 'error'),
  };
}
