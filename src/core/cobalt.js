// Референсная дозиметрия пучков гамма-излучения ⁶⁰Co.
// TRS-398 Rev.1, глава 5: D_w = M · N_D,w (k_Q = 1), z_ref = 5 или 10 г/см², РИП/РИК 80 или 100 см, поле 10 × 10 см.
// TG-51 (1999): D_w = M · N_D,w⁶⁰Co (k_Q = 1,000), опорная глубина 10 см.
// Непрерывный пучок: рекомбинация — TRS-398 разд. 4.4.3.4 b) (ур. 13 или 16), TG-51 ур. (11).
// Ошибка таймера — TRS-398 разд. 5.4.2; TG-51 разд. VII («shutter timing error»).

import { parseNumber, parseCells, isBlank, pressureToKPa, ndwToGyPerNC, ru } from './units.js';
import { temperaturePressure, polarity } from './common.js';
import * as TG51 from './tg51.js';
import * as TRS from './trs398.js';

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

  co_ch_type: 'cyl', // 'cyl' | 'pp'
  co_ch_model: '',
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
  co_env_P: '',
  co_env_P_unit: 'kPa',

  co_time: '1',
  co_time_unit: 'min', // 'min' | 's'
  co_timer_mode: 'measured', // 'none' | 'manual' | 'measured'
  co_tau: '',
  co_tt: ['', ''],
  co_tm: ['', ''],

  co_V1: '300',
  co_V2: '100',
  co_polarity: '+',
  co_M1: ['', '', ''],
  co_Mopp: ['', '', ''],
  co_M2: ['', '', ''],
  co_kleak: '1,000',
  co_rec_trs: 'eq13', // 'eq13' | 'eq16'

  co_dd_on: true,
  co_zmax: '0,5',
  co_pdd: '',
  co_tmr: '',
  co_ref_rate: '', // сГр/мин на z_max по предыдущей калибровке (или ожидаемое значение)
  co_ref_date: '', // дата, к которой относится co_ref_rate; пусто — без поправки на распад
};

/** Период полураспада ⁶⁰Co: 5,2711 года (DDEP/LNHB), в сутках. */
export const CO60_HALF_LIFE_DAYS = 5.2711 * 365.25;

/** Множитель распада между двумя датами ISO (YYYY-MM-DD). */
export function decayFactor(fromIso, toIso) {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { error: 'не удалось прочитать даты' };
  const days = (b - a) / 86400000;
  return { days, factor: Math.pow(2, -days / CO60_HALF_LIFE_DAYS) };
}

const REF = {
  tg51: 'TG-51 (1999)',
  add: 'аддендум TG-51 (2014)',
  r374: 'WGTG51 Report 374',
  trs: 'TRS-398 Rev.1',
};

const cap = (s) => s[0].toUpperCase() + s.slice(1);

export function normalizeCobalt(input) {
  const f = { ...CO_DEFAULTS, ...input };
  for (const k of ['co_M1', 'co_Mopp', 'co_M2']) if (!Array.isArray(f[k])) f[k] = isBlank(f[k]) ? ['', '', ''] : String(f[k]).trim().split(/[\s;]+/);
  for (const k of ['co_tt', 'co_tm']) if (!Array.isArray(f[k])) f[k] = ['', ''];
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
    if (!Number.isFinite(t) || !Number.isFinite(m)) return { error: `строка ${i + 1}: нужно время и показание` };
    pts.push({ t, m: Math.abs(m) });
  }
  if (pts.length < 2) return { error: 'нужны хотя бы два облучения с разным временем' };
  const n = pts.length;
  const st = pts.reduce((s, p) => s + p.t, 0);
  const sm = pts.reduce((s, p) => s + p.m, 0);
  const stt = pts.reduce((s, p) => s + p.t * p.t, 0);
  const stm = pts.reduce((s, p) => s + p.t * p.m, 0);
  const den = n * stt - st * st;
  if (Math.abs(den) < 1e-12) return { error: 'времена облучения должны различаться' };
  const a = (n * stm - st * sm) / den;
  const b = (sm - a * st) / n;
  if (!(a > 0)) return { error: 'показание должно расти с временем облучения' };
  let residual = 0;
  if (n > 2) residual = Math.sqrt(pts.reduce((s, p) => s + (p.m - (a * p.t + b)) ** 2, 0) / (n - 2)) / (sm / n);
  return { tau: b / a, slope: a, intercept: b, n, residual };
}

export function computeCobalt(form) {
  const f = normalizeCobalt(form);
  const messages = [];
  const flags = {};
  const rank = { info: 0, warn: 1, error: 2 };
  const flag = (key, level) => {
    if (!flags[key] || rank[level] > rank[flags[key]]) flags[key] = level;
  };
  const add = (level, scope, text, ref = null, field = null) => {
    messages.push({ level, scope, text, ref });
    if (field) [].concat(field).forEach((k) => flag(k, level));
  };
  const read = (key, label, scope = 'common') => {
    const v = parseNumber(f[key]);
    if (!Number.isFinite(v)) add('error', scope, isBlank(f[key]) ? `Не заполнено поле «${label}».` : `Не удалось прочитать число в поле «${label}».`, null, key);
    return v;
  };
  const readCells = (key, label) => {
    const s = parseCells(f[key]);
    if (s.error) add('error', 'common', `«${label}»: ${s.error}.`, null, key);
    else if (s.n === 0) add('error', 'common', `Не заполнено поле «${label}».`, null, key);
    else if (s.mean === 0) add('error', 'common', `«${label}»: среднее показание равно нулю.`, null, key);
    return s;
  };

  const want51 = f.protocol === 'tg51' || f.protocol === 'both';
  const wantTRS = f.protocol === 'trs' || f.protocol === 'both';

  // ------------------------------------------------------------ геометрия
  const distance = read('co_distance', 'Расстояние');
  if (Number.isFinite(distance)) {
    if (distance < 50 || distance > 150) add('error', 'common', 'Расстояние задаётся в сантиметрах (обычно 80 или 100).', null, 'co_distance');
    else if (distance !== 80 && distance !== 100) {
      add('info', 'common', 'TRS-398 задаёт РИП или РИК 80 или 100 см — то, что используется клинически.', `${REF.trs}, табл. 12`, 'co_distance');
    }
  }
  const zref = parseNumber(f.co_zref);
  if (want51 && zref !== 10) {
    add('warn', 'tg51', 'TG-51 определяет дозу на глубине 10 см: для z_ref = 5 г/см² считайте по TRS-398 или выберите 10 г/см².', `${REF.tg51}, разд. IX.A`, 'co_zref');
  }
  if (f.co_ch_type === 'pp') {
    add('info', 'trs', 'Плоскопараллельную камеру можно использовать в пучке ⁶⁰Co, если она откалибрована в пучке того же качества. Опорная точка — внутренняя поверхность входного окна, в центре окна.', `${REF.trs}, разд. 5.2.1, сноска 29`);
  }

  // ---------------------------------------------------------------- камера
  const ndwRaw = read('co_ndw', 'N_D,w');
  const ndw = Number.isFinite(ndwRaw) ? ndwToGyPerNC(ndwRaw, f.co_ndw_unit) : NaN;
  if (Number.isFinite(ndw) && (ndw < 1e-3 || ndw > 5)) {
    add('warn', 'common', `N_D,w = ${ndw.toPrecision(4).replace('.', ',')} Гр/нКл выглядит неправдоподобно: проверьте единицы.`, null, 'co_ndw');
  }
  const T0 = read('co_T0', 'T₀ из сертификата');
  const P0 = read('co_P0', 'P₀ из сертификата');
  if (Number.isFinite(T0) && (T0 < 15 || T0 > 25)) add('error', 'common', 'T₀ задаётся в °C (обычно 20 или 22).', null, 'co_T0');
  if (Number.isFinite(P0) && (P0 < 95 || P0 > 105)) add('warn', 'common', 'P₀ задаётся в кПа (обычно 101,325 или 101,33).', null, 'co_P0');
  const kelec = read('co_kelec', 'k_elec (P_elec)');
  if (Number.isFinite(kelec) && Math.abs(kelec - 1) > 0.02) add('warn', 'common', 'k_elec отличается от 1 больше чем на 2 %: проверьте сертификат электрометра.', null, 'co_kelec');

  // ------------------------------------------------------------ окружающая среда
  const T = read('co_env_T', 'Температура воды');
  const Pin = read('co_env_P', 'Давление');
  const P = Number.isFinite(Pin) ? pressureToKPa(Pin, f.co_env_P_unit) : NaN;
  if (Number.isFinite(P) && (P < 50 || P > 110)) add('error', 'common', `Давление ${ru(P, 2)} кПа вне правдоподобного диапазона: проверьте единицы.`, null, 'co_env_P');
  if (Number.isFinite(T)) {
    if (T < 5 || T > 40) add('error', 'common', `Температура воды ${T} °C неправдоподобна.`, null, 'co_env_T');
    else if (T < 15 || T > 25) add('info', 'common', 'Температура воды вне 15–25 °C: тепловое расширение полости может стать заметным.', `${REF.add}, разд. 5.A.5`, 'co_env_T');
  }

  // ------------------------------------------------------------ время и таймер
  const tSet = read('co_time', 'Заданное время облучения');
  if (Number.isFinite(tSet) && tSet <= 0) add('error', 'common', 'Время облучения должно быть больше нуля.', null, 'co_time');
  const unitLabel = f.co_time_unit === 's' ? 'с' : 'мин';
  const toMin = f.co_time_unit === 's' ? 1 / 60 : 1;
  let tau = 0;
  let timer = { mode: f.co_timer_mode };
  if (f.co_timer_mode === 'manual') {
    tau = read('co_tau', 'Ошибка таймера τ');
  } else if (f.co_timer_mode === 'measured') {
    const r = timerError(f.co_tt, f.co_tm);
    if (r.error) add('error', 'common', `Ошибка таймера: ${r.error}.`, null, 'co_timer');
    else {
      tau = r.tau;
      timer = { ...timer, ...r, residualPct: r.n > 2 ? r.residual * 100 : NaN };
      if (r.residual > 0.002) add('warn', 'common', `Показания при разных временах плохо ложатся на прямую (разброс ${ru(r.residual * 100, 2)} %): повторите облучения.`, null, 'co_timer');
    }
  } else {
    add('warn', 'common', 'Ошибка таймера не учтена. Для аппаратов с ⁶⁰Co она может заметно влиять на показание; её нужно определить.', `${REF.trs}, разд. 5.4.2; ${REF.tg51}, разд. VII`, 'co_timer_mode');
  }
  timer.tau = tau;
  const tEff = tSet + tau;
  if (Number.isFinite(tau) && Number.isFinite(tSet) && tSet > 0) {
    timer.relative = tau / tSet;
    timer.relativePct = timer.relative * 100;
    if (tEff <= 0) add('error', 'common', 'Фактическое время облучения t + τ получилось неположительным: проверьте ошибку таймера.', null, 'co_tau');
    else if (Math.abs(tau / tSet) > 0.05) add('warn', 'common', `Ошибка таймера ${ru(tau, 3)} ${unitLabel} — больше 5 % от времени облучения: проверьте измерения.`, null, ['co_tau', 'co_timer']);
  }
  const tEffMin = tEff * toMin;

  // ------------------------------------------------------------- показания
  const V1 = read('co_V1', 'Рабочее напряжение V₁');
  const V2 = read('co_V2', 'Пониженное напряжение V₂');
  if (Number.isFinite(V1) && Number.isFinite(V2) && Math.abs(V1) <= Math.abs(V2)) add('error', 'common', 'Рабочее напряжение V₁ должно быть больше пониженного V₂.', null, ['co_V1', 'co_V2']);
  if (Number.isFinite(V1) && Math.abs(V1) > 300) add('warn', 'common', 'Аддендум TG-51 рекомендует для цилиндрических камер не более 300 В.', `${REF.add}, разд. 4.E`, 'co_V1');
  const M1 = readCells('co_M1', 'M при V₁, обычная полярность');
  const Mopp = readCells('co_Mopp', 'M при V₁, обратная полярность');
  const M2 = readCells('co_M2', 'M при V₂');
  for (const [s, label, key] of [[M1, 'при V₁', 'co_M1'], [Mopp, 'обратной полярности', 'co_Mopp'], [M2, 'при V₂', 'co_M2']]) {
    if (!s || s.n < 2 || !s.mean) continue;
    const d = Math.max(...s.values.map((v) => Math.abs(v - s.mean) / Math.abs(s.mean)));
    const pct = ru(d * 100, 2);
    if (d > 0.05) add('error', 'common', `Показания ${label} расходятся на ${pct} % от среднего: вероятно, ошибка ввода.`, null, key);
    else if (d > 0.005) add('warn', 'common', `Разброс показаний ${label} до ${pct} % от среднего: повторите облучения.`, `${REF.r374}, разд. 4.4.2`, key);
    else if (d > 0.001) add('info', 'common', `Разброс показаний ${label} до ${pct} % от среднего: Report 374 советует повторять облучения, пока отклонение не станет меньше ±0,1 % без тренда.`, `${REF.r374}, разд. 4.4.2`, key);
  }
  const kleak = read('co_kleak', 'Поправка на утечку');
  if (Number.isFinite(kleak) && Math.abs(kleak - 1) > 0.001) add('warn', 'common', 'Утечка больше 0,1 % показания: причину нужно выяснить.', `${REF.add}, табл. III; ${REF.trs}, табл. 3`, 'co_kleak');

  const readingsOk = M1.n > 0 && !M1.error && M1.mean !== 0;
  const m1 = readingsOk ? Math.abs(M1.mean) : NaN;
  let kpolRaw = NaN;
  if (readingsOk && Mopp.n > 0 && !Mopp.error) {
    kpolRaw = polarity(M1.mean, Mopp.mean);
    if (Math.abs(kpolRaw - 1) > 0.004) {
      add('warn', 'common', `k_pol = ${ru(kpolRaw, 4)} выходит за пределы 1 ± 0,004: для камеры эталонного класса эффект полярности должен быть меньше 0,4 %.`, `${REF.trs}, табл. 3; ${REF.add}, табл. III`, 'kpol');
    }
  }
  let kpolQ0 = 1;
  if (!f.co_lab_pol_applied) kpolQ0 = read('co_lab_kpol', 'Поправка на полярность при калибровке');
  const kpol = kpolRaw / kpolQ0;

  const nV = Math.abs(V1) / Math.abs(V2);
  const recOk = readingsOk && M2.n > 0 && !M2.error && M2.mean !== 0 && Number.isFinite(nV) && nV > 1;
  if (readingsOk && M2.n > 0 && Math.sign(M1.mean) !== Math.sign(M2.mean)) add('error', 'common', 'Показания при V₁ и V₂ должны быть сняты при одной и той же (обычной) полярности.', null, 'co_M2');
  const ratio12 = recOk ? Math.abs(M1.mean) / Math.abs(M2.mean) : NaN;
  if (recOk && ratio12 < 1) {
    add('error', 'common', 'k_s (P_ion) не может быть меньше 1: при пониженном напряжении собирается меньше заряда. Проверьте показания и напряжения.', `${REF.trs}, разд. 4.4.3.4`, ['ks', 'Pion', 'co_M2']);
  }
  let ksQ0 = 1;
  if (!f.co_lab_ks_applied) ksQ0 = read('co_lab_ks', 'Поправка на рекомбинацию при калибровке');

  // ------------------------------------------------------------- TRS-398
  const trs = { enabled: wantTRS };
  if (wantTRS) {
    if (Number.isFinite(zref) && zref !== 5 && zref !== 10) add('error', 'trs', 'TRS-398 допускает z_ref = 5 или 10 г/см².', `${REF.trs}, табл. 12`, 'co_zref');
    trs.kTP = temperaturePressure({ T, P, T0, P0, abs0: TRS.TRS_ABS0 });
    trs.kelec = kelec;
    trs.kpol = kpol;
    trs.kleak = kleak;
    if (recOk) {
      if (f.co_rec_trs === 'eq16') {
        trs.ksRaw = (nV * nV - 1) / (nV * nV - ratio12);
        trs.ksEquation = 'ур. (16): k_s = (n² − 1)/(n² − M₁/M₂), общая рекомбинация в непрерывном пучке';
      } else {
        const r = TRS.ks({ m1: M1.mean, m2: M2.mean, v1: Math.abs(V1), v2: Math.abs(V2), beam: 'pulsed' });
        trs.ksRaw = r.value;
        trs.ksEquation = `${r.equation}; в непрерывном пучке преобладает начальная рекомбинация (разд. 4.4.3.4 b)`;
        if (r.error) add('error', 'trs', cap(r.error) + '.', `${REF.trs}, табл. 10`, 'ks');
        r.notes.forEach((n) => add('warn', 'trs', cap(n) + '.', `${REF.trs}, разд. 4.4.3.4`, 'ks'));
      }
      trs.ks = trs.ksRaw / ksQ0;
      if (trs.ks > 1.05) add('error', 'trs', `k_s = ${ru(trs.ks, 4)} > 1,05: метод двух напряжений неприменим.`, `${REF.trs}, табл. 3`, 'ks');
      if (ratio12 >= 1 && trs.ks < 1) add('error', 'trs', `k_s = ${ru(trs.ks, 4)} < 1: так быть не может, проверьте показания и поправку лаборатории.`, `${REF.trs}, разд. 4.4.3.4`, 'ks');
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
      if (nV < 2 - 1e-9) add('warn', 'tg51', 'TG-51: пониженное напряжение должно быть меньше рабочего как минимум вдвое.', `${REF.tg51}, разд. VII.D.2`, ['co_V1', 'co_V2']);
      tg.Pion = tg.PionRaw / ksQ0;
      if (tg.Pion > 1.05) add('error', 'tg51', `P_ion = ${ru(tg.Pion, 4)} > 1,05: нужна другая камера.`, `${REF.tg51}, разд. VII.D.1`, 'Pion');
      if (ratio12 >= 1 && tg.Pion < 1) add('error', 'tg51', `P_ion = ${ru(tg.Pion, 4)} < 1: так быть не может, проверьте показания и поправку лаборатории.`, `${REF.tg51}, разд. VII.D`, 'Pion');
    } else tg.Pion = NaN;
  }

  // ------------------------------------------------------------- пересчёт на z_max
  const depth = { on: !!f.co_dd_on, zref, geometry: f.co_geometry };
  if (depth.on) {
    const readD = (key, label) => {
      const v = parseNumber(f[key]);
      if (!Number.isFinite(v)) add('error', 'depth', isBlank(f[key]) ? `Не заполнено поле «${label}».` : `Не удалось прочитать число в поле «${label}».`, null, key);
      return v;
    };
    depth.zmax = readD('co_zmax', 'Глубина z_max');
    if (Number.isFinite(depth.zmax) && (depth.zmax <= 0 || depth.zmax >= zref)) add('error', 'depth', `Глубина z_max должна быть меньше опорной (${ru(zref, 0)} см).`, null, 'co_zmax');
    if (f.co_geometry === 'SAD') {
      const tmr = readD('co_tmr', `TMR(${ru(zref, 0)})`);
      if (Number.isFinite(tmr) && (tmr <= 0.2 || tmr > 1)) add('error', 'depth', 'TMR вводится как отношение (например, 0,904), а не в процентах.', null, 'co_tmr');
      depth.factor = tmr;
      depth.label = `TMR(${ru(zref, 0)} см)`;
    } else {
      const pdd = readD('co_pdd', `PDD(${ru(zref, 0)})`);
      if (Number.isFinite(pdd) && (pdd < 20 || pdd > 100)) add('error', 'depth', 'PDD вводится в процентах, от 20 до 100.', null, 'co_pdd');
      depth.factor = pdd / 100;
      depth.label = `PDD(${ru(zref, 0)} см)/100`;
    }
    // ожидаемая мощность дозы: предыдущее значение, приведённое к дате измерения по распаду ⁶⁰Co
    const refRate = parseNumber(f.co_ref_rate);
    if (!isBlank(f.co_ref_rate) && !(refRate > 0)) add('warn', 'depth', 'Предыдущая мощность дозы должна быть положительным числом (сГр/мин).', null, 'co_ref_rate');
    if (refRate > 0) {
      depth.refRate = refRate;
      depth.expected = refRate;
      if (!isBlank(f.co_ref_date)) {
        if (isBlank(f.co_date)) add('warn', 'depth', 'Укажите дату измерения (раздел 1), чтобы учесть распад ⁶⁰Co с даты предыдущего значения.', null, ['co_date', 'co_ref_date']);
        else {
          const d = decayFactor(f.co_ref_date, f.co_date);
          if (d.error) add('warn', 'depth', `Поправка на распад: ${d.error}.`, null, 'co_ref_date');
          else {
            if (d.days < 0) add('warn', 'depth', 'Дата предыдущего значения позже даты измерения: проверьте даты.', null, 'co_ref_date');
            depth.days = d.days;
            depth.decay = d.factor;
            depth.expected = refRate * d.factor;
          }
        }
      }
    }
    depth.ok = !messages.some((m) => m.level === 'error' && m.scope === 'depth');
  }

  const finish = (x, M) => {
    x.M = M;
    x.D = M * ndw; // Гр за облучение
    x.rateGy = x.D / tEffMin; // Гр/мин на z_ref
    x.rate = x.rateGy * 100; // сГр/мин
    if (depth.on && depth.ok && Number.isFinite(depth.factor)) {
      x.rateMaxGy = x.rateGy / depth.factor;
      x.rateMax = x.rate / depth.factor;
      if (depth.expected > 0) x.deviation = (x.rateMax / depth.expected - 1) * 100;
    }
    x.ok = Number.isFinite(x.D) && x.D > 0 && Number.isFinite(x.rate) && x.rate > 0;
  };
  if (wantTRS) finish(trs, m1 * trs.kTP * trs.kelec * trs.kpol * trs.ks * trs.kleak);
  if (want51) finish(tg, m1 * tg.PTP * tg.Pelec * tg.Ppol * tg.Pion * tg.Pleak);

  const hasError = (scope) => messages.some((m) => m.level === 'error' && (m.scope === 'common' || m.scope === scope));
  if (wantTRS && !trs.ok && !hasError('trs')) add('error', 'trs', 'Не удалось вычислить дозу: проверьте ввод.');
  if (want51 && !tg.ok && !hasError('tg51')) add('error', 'tg51', 'Не удалось вычислить дозу: проверьте ввод.');
  const order = { error: 0, warn: 1, info: 2 };
  messages.sort((a, b) => order[a.level] - order[b.level]);
  trs.blocked = wantTRS && hasError('trs');
  tg.blocked = want51 && hasError('tg51');

  let comparison = null;
  if (want51 && wantTRS && trs.ok && tg.ok && !trs.blocked && !tg.blocked) comparison = { dRel: (tg.D / trs.D - 1) * 100 };

  return {
    protocol: f.protocol,
    form: f,
    inputs: { T, P, T0, P0, V1, V2, nV, ndw, kelec, kleak, M1, Mopp, M2, ratio12, tSet, tEff, tEffMin, unitLabel, distance, zref },
    timer,
    depth,
    trs,
    tg51: tg,
    comparison,
    messages,
    flags,
    hasErrors: messages.some((m) => m.level === 'error'),
  };
}
