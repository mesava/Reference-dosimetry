// Референсная дозиметрия пучков электронов.
// TRS-398 Rev.1, глава 7: D_w,Q = M_Q · N_D,w,Q₀ · k_Q,Q₀ (ур. 38), z_ref = 0,6·R50 − 0,1 г/см² (ур. 39),
//   k_Q — табл. 20 (калибровка в ⁶⁰Co), k_Q,Qint — табл. 21 (перекрёстная калибровка, ур. 41–44).
// TG-51 с аддендумом WGTG51 Report 385 (2024): D_w = M · k′_Q · k_Qecal · N_D,w⁶⁰Co (ур. 4),
//   d_ref = 0,6·R50 − 0,1 см (ур. 2), k′_Q и k_Qecal — табл. 4–7, перекрёстная калибровка — ур. (5)–(6).

import { parseNumber, parseCells, isBlank, pressureToKPa, ndwToGyPerNC, ru } from './units.js';
import { temperaturePressure, polarity } from './common.js';
import * as TG51 from './tg51.js';
import * as TRS from './trs398.js';
import { findEChamber, eChamberLabel, interpE, kQprime385, trsFit, R385_RANGE } from './electron-chambers.js';

export const E_DEFAULTS = {
  protocol: 'trs',

  e_institution: '',
  e_machine: '',
  e_beam: '',
  e_energy: '',
  e_date: '',
  e_staff: [''],
  e_notes: '',
  e_ssd: '100',
  e_field: '10',

  e_r50_method: 'i50', // 'i50' — по глубине 50 % ионизации | 'r50' — R50 известен
  e_i50: '',
  e_r50: '',

  e_ch_model: '', // id из E_CHAMBERS | 'OTHER'
  e_other_name: '',
  e_other_type: 'pp', // для 'OTHER': 'pp' | 'cyl'
  e_other_r: '', // радиус полости, мм (для 'OTHER', цилиндрическая)
  e_ch_serial: '',
  e_cal_route: 'co60', // 'co60' — N_D,w в ⁶⁰Co | 'cross' — перекрёстная калибровка в пучке электронов
  e_ndw: '',
  e_ndw_unit: 'Gy/nC',
  e_cross_ndw: '', // TRS-398: N_D,w,Qcross рабочей камеры (ур. 41)
  e_cross_ndw_unit: 'Gy/nC',
  e_cross_r50: '', // TRS-398: R50 пучка перекрёстной калибровки
  e_cross_kn: '', // Report 385: (k_Qecal·N_D,w)_pp (ур. 5)
  e_cross_kn_unit: 'Gy/nC',
  e_T0: '20',
  e_P0: '101,325',
  e_el_model: '',
  e_el_serial: '',
  e_kelec: '1,000',
  e_lab_pol_applied: true,
  e_lab_kpol: '',
  e_lab_ks_applied: true,
  e_lab_ks: '',

  e_env_T: '',
  e_env_P: '',
  e_env_P_unit: 'kPa',

  e_mu: '100',
  e_polarity: '+',
  e_V1: '300',
  e_V2: '100',
  e_beam_mode: 'pulsed', // 'pulsed' | 'scanned'
  e_M1: ['', '', ''],
  e_Mopp: ['', '', ''],
  e_M2: ['', '', ''],
  e_M51: ['', '', ''], // цилиндрическая камера, «оба протокола»: M при V₁ с центром камеры на d_ref (для TG-51)
  e_kleak: '1,000',

  e_kqtrs_mode: 'table', // 'table' (табл. 20 или 21) | 'formula' (прил. II, табл. 47 или 48) | 'manual'
  e_kqtrs_manual: '',
  e_kq51_mode: 'fit', // 'fit' (Report 385) | 'manual'
  e_kq51_manual: '',

  e_dd_on: true,
  e_zmax: '',
  e_pdd: '',
  e_nominal: '1,000',
};

const REF = {
  tg51: 'TG-51 (1999)',
  r385: 'Report 385',
  add: 'аддендум TG-51 (2014)',
  r374: 'WGTG51 Report 374',
  trs: 'TRS-398 Rev.1',
};

const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** Номинальная энергия по названию пучка: «12 МэВ», «6e», «e 9» и т. п. */
export function parseElectronBeam(name) {
  const s = String(name || '');
  const unit = s.match(/(\d+(?:[.,]\d+)?)\s*(?:МэВ|MeV|мэв|е|e|E|Е)(?![а-яa-z])/i);
  const all = s.match(/\d+(?:[.,]\d+)?/g) || [];
  const raw = unit ? unit[1] : all.length === 1 ? all[0] : null;
  return { energy: raw ? Number(raw.replace(',', '.')) : NaN };
}

/** R50 по глубине 50 % ионизации: TRS-398 ур. (37); TG-51 ур. (16)–(17); Report 385 ур. (3). */
export function r50FromI50(i50) {
  if (!(i50 > 0)) return { value: NaN };
  if (i50 <= 10) return { value: 1.029 * i50 - 0.06, equation: 'R50 = 1,029·R50,ion − 0,06 (R50,ion ≤ 10 г/см²)' };
  return { value: 1.059 * i50 - 0.37, equation: 'R50 = 1,059·R50,ion − 0,37 (R50,ion > 10 г/см²)' };
}

export const zrefFromR50 = (r50) => 0.6 * r50 - 0.1;

export function normalizeElectrons(input) {
  const f = { ...E_DEFAULTS, ...input };
  for (const k of ['e_M1', 'e_Mopp', 'e_M2', 'e_M51']) {
    if (!Array.isArray(f[k])) f[k] = isBlank(f[k]) ? ['', '', ''] : String(f[k]).trim().split(/[\s;]+/);
  }
  if (!Array.isArray(f.e_staff) || f.e_staff.length === 0) f.e_staff = [''];
  return f;
}

/** Камера из базы или «другая» с характеристиками из формы (k_Q тогда только вручную). */
export function resolveEChamber(f) {
  if (f.e_ch_model === 'OTHER') {
    const r = parseNumber(f.e_other_r);
    return {
      id: 'OTHER',
      other: true,
      maker: '',
      model: f.e_other_name || 'другая камера',
      type: f.e_other_type === 'cyl' ? 'cyl' : 'pp',
      trsRcylMm: Number.isFinite(r) ? r : NaN,
    };
  }
  return findEChamber(f.e_ch_model);
}

/** Положение камеры по протоколам (для подсказки и протокола). Глубины в см. */
export function positions(chamber, zref) {
  if (!chamber || !Number.isFinite(zref)) return null;
  const out = { type: chamber.type };
  if (chamber.type === 'cyl') {
    const r = chamber.trsRcylMm ?? chamber.rCavMm;
    out.trs = Number.isFinite(r)
      ? { depth: zref + 0.05 * r, text: `центр камеры на 0,5·r_cyl = ${ru(0.5 * r, 2)} мм глубже z_ref, то есть на глубине ${ru(zref + 0.05 * r, 2)} см` }
      : { depth: NaN, text: 'центр камеры на 0,5·r_cyl глубже z_ref (укажите радиус полости)' };
    out.tg51 = { depth: zref, text: `центр камеры на глубине d_ref = ${ru(zref, 2)} см, без сдвига` };
  } else {
    const wet = Number.isFinite(chamber.windowMgCm2) ? chamber.windowMgCm2 / 100 : NaN; // мм водного эквивалента
    out.trs = Number.isFinite(wet)
      ? { depth: zref, front: zref - wet / 10, text: `внутренняя поверхность входного окна на z_ref = ${ru(zref, 2)} см; водоэквивалентная толщина окна ${ru(wet, 2)} мм, наружная поверхность — на ${ru(zref - wet / 10, 2)} см` }
      : { depth: zref, text: `внутренняя поверхность входного окна на z_ref = ${ru(zref, 2)} см с учётом водоэквивалентной толщины окна` };
    const s = chamber.r385?.shiftMm;
    out.tg51 = Number.isFinite(s)
      ? { depth: zref, front: zref - s / 10, text: `наружная поверхность входного окна на ${ru(zref - s / 10, 2)} см: точка измерения на ${ru(s, 1)} мм за ней установлена на d_ref = ${ru(zref, 2)} см` }
      : { depth: zref, text: `точка измерения на d_ref = ${ru(zref, 2)} см` };
  }
  return out;
}

function maxRelDeviation(series) {
  if (!series || series.n < 2 || !series.mean) return 0;
  return Math.max(...series.values.map((v) => Math.abs(v - series.mean) / Math.abs(series.mean)));
}

export function computeElectrons(form) {
  const f = normalizeElectrons(form);
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
  const readCells = (key, label, scope = 'common') => {
    const s = parseCells(f[key]);
    if (s.error) add('error', scope, `«${label}»: ${s.error}.`, null, key);
    else if (s.n === 0) add('error', scope, `Не заполнено поле «${label}».`, null, key);
    else if (s.mean === 0) add('error', scope, `«${label}»: среднее показание равно нулю.`, null, key);
    return s;
  };

  const want51 = f.protocol === 'tg51' || f.protocol === 'both';
  const wantTRS = f.protocol === 'trs' || f.protocol === 'both';
  const energy = parseNumber(f.e_energy);

  // ---------------------------------------------------------- геометрия
  const ssd = read('e_ssd', 'РИП');
  if (Number.isFinite(ssd)) {
    if (ssd < 50 || ssd > 150) add('error', 'common', 'РИП задаётся в сантиметрах (обычно 100).', null, 'e_ssd');
    else {
      if (wantTRS && Math.abs(ssd - 100) > 1e-9) add('warn', 'trs', 'TRS-398 задаёт РИП 100 см.', `${REF.trs}, табл. 19`, 'e_ssd');
      if (want51 && (ssd < 90 || ssd > 110)) add('warn', 'tg51', 'Report 385 допускает для референсных измерений РИП от 90 до 110 см.', `${REF.r385}, разд. 3`, 'e_ssd');
      else if (want51 && Math.abs(ssd - 100) > 1e-9) add('info', 'tg51', 'РИП должно совпадать с тем, при котором вводилась в эксплуатацию система планирования; R50 всё равно измеряют при РИП 100 см.', `${REF.r385}, разд. 3`);
    }
  }
  const field = read('e_field', 'Размер поля');
  if (Number.isFinite(field)) {
    if (field < 2 || field > 40) add('error', 'common', 'Размер поля задаётся одним числом в сантиметрах, например 10.', null, 'e_field');
    else if (field < 10) add('warn', 'common', 'Поле на поверхности фантома должно быть не меньше 10 × 10 см.', `${REF.trs}, табл. 19; ${REF.r385}, разд. 3`, 'e_field');
  }

  // ---------------------------------------------------------- качество пучка
  const quality = { method: f.e_r50_method };
  let r50 = NaN;
  if (f.e_r50_method === 'r50') {
    r50 = read('e_r50', 'R50');
    quality.equation = 'R50 введён (измерен детектором, отвечающим дозе, или известен)';
  } else {
    const i50 = read('e_i50', 'R50,ion (I50)');
    if (Number.isFinite(i50)) {
      if (i50 <= 0) add('error', 'common', 'R50,ion должен быть больше нуля.', null, 'e_i50');
      const r = r50FromI50(i50);
      r50 = r.value;
      quality.i50 = i50;
      quality.equation = r.equation;
      if (want51 && i50 < 1.7) add('warn', 'tg51', 'Формула R50 по I50 проверена для 1,7 ≤ I50 ≤ 10 см.', `${REF.r385}, ур. (3)`, 'e_i50');
    }
  }
  if (Number.isFinite(r50) && (r50 <= 0.3 || r50 > 15)) {
    add('error', 'common', `R50 = ${ru(r50, 2)} г/см² неправдоподобен: вводится в г/см² (см), например 4,9 для пучка 12 МэВ.`, null, ['e_r50', 'e_i50']);
    r50 = NaN;
  }
  const zref = Number.isFinite(r50) ? zrefFromR50(r50) : NaN;
  quality.r50 = r50;
  quality.zref = zref;
  quality.E0 = 2.33 * r50;

  // ---------------------------------------------------------------- камера
  const chamber = resolveEChamber(f);
  if (isBlank(f.e_ch_model)) add('error', 'common', 'Выберите тип камеры.', null, 'e_ch_model');
  if (chamber?.other) {
    add('warn', 'common', 'Для камеры не из списка k_Q берётся только вручную (например, измеренный в лаборатории). Report 385 не рекомендует для электронов камеры, которых нет в его таблицах.', `${REF.r385}, разд. 6.6; ${REF.trs}, табл. 20–21`);
    if (chamber.type === 'cyl' && !Number.isFinite(chamber.trsRcylMm) && wantTRS) add('warn', 'trs', 'Укажите радиус полости: по TRS-398 центр цилиндрической камеры ставят на 0,5·r_cyl глубже z_ref.', `${REF.trs}, табл. 19`, 'e_other_r');
  }
  if (chamber?.sleeve) add('info', 'common', 'Камера не водонепроницаема: используйте тот же чехол (ПММА ≤ 1 мм), что и при калибровке.', `${REF.trs}, разд. 7.2.2`);
  const isCyl = chamber?.type === 'cyl';
  if (isCyl && Number.isFinite(r50) && r50 < 3 && wantTRS) {
    add('error', 'trs', 'При R50 < 3 г/см² TRS-398 допускает только плоскопараллельные камеры.', `${REF.trs}, табл. 19`, 'e_ch_model');
  }
  if (!isCyl && chamber && f.e_cal_route === 'co60' && want51) {
    add('info', 'tg51', 'Report 385 допускает плоскопараллельную камеру, откалиброванную в ⁶⁰Co, если подтверждено её поведение как камеры эталонного класса, в частности стабильность.', `${REF.r385}, разд. 5.3.1, прил. A`);
  }
  if (!isCyl && chamber && f.e_cal_route === 'co60' && wantTRS) {
    add('info', 'trs', 'TRS-398 рекомендует калибровать плоскопараллельную камеру в пучке электронов — в лаборатории или перекрёстно.', `${REF.trs}, разд. 7.2.1`);
  }
  const pos = positions(chamber, zref);

  // калибровочные коэффициенты
  const cross = f.e_cal_route === 'cross';
  let ndw = NaN;
  let ndwRaw = NaN;
  let crossNdw = NaN;
  let crossR50 = NaN;
  let crossKN = NaN;
  if (!cross) {
    ndwRaw = read('e_ndw', 'N_D,w');
    ndw = Number.isFinite(ndwRaw) ? ndwToGyPerNC(ndwRaw, f.e_ndw_unit) : NaN;
    if (Number.isFinite(ndw) && (ndw < 1e-3 || ndw > 5)) add('warn', 'common', `N_D,w = ${ndw.toPrecision(4).replace('.', ',')} Гр/нКл выглядит неправдоподобно: проверьте единицы.`, null, 'e_ndw');
  } else {
    if (wantTRS) {
      const v = read('e_cross_ndw', 'N_D,w,Qcross', 'trs');
      crossNdw = Number.isFinite(v) ? ndwToGyPerNC(v, f.e_cross_ndw_unit) : NaN;
      crossR50 = read('e_cross_r50', 'R50 пучка перекрёстной калибровки', 'trs');
      if (Number.isFinite(crossR50) && crossR50 < 7) add('info', 'trs', 'TRS-398 рекомендует перекрёстную калибровку в пучке с R50 > 7 г/см² (E₀ > 16 МэВ).', `${REF.trs}, разд. 7.6.1`, 'e_cross_r50');
    }
    if (want51) {
      if (isCyl) add('error', 'tg51', 'Report 385 предусматривает перекрёстную калибровку только плоскопараллельной камеры по цилиндрической: для цилиндрической камеры используйте N_D,w в ⁶⁰Co.', `${REF.r385}, разд. 5.3.2`, 'e_cal_route');
      const v = read('e_cross_kn', '(k_Qecal·N_D,w)_pp', 'tg51');
      crossKN = Number.isFinite(v) ? ndwToGyPerNC(v, f.e_cross_kn_unit) : NaN;
    }
  }
  const T0 = read('e_T0', 'T₀ из сертификата');
  const P0 = read('e_P0', 'P₀ из сертификата');
  if (Number.isFinite(T0) && (T0 < 15 || T0 > 25)) add('error', 'common', 'T₀ задаётся в °C (обычно 20 или 22).', null, 'e_T0');
  if (Number.isFinite(P0) && (P0 < 95 || P0 > 105)) add('warn', 'common', 'P₀ задаётся в кПа (обычно 101,325 или 101,33).', null, 'e_P0');
  const kelec = read('e_kelec', 'k_elec (P_elec)');
  if (Number.isFinite(kelec) && Math.abs(kelec - 1) > 0.02) add('warn', 'common', 'k_elec отличается от 1 больше чем на 2 %: проверьте сертификат электрометра.', null, 'e_kelec');

  // ------------------------------------------------------ окружающая среда
  const T = read('e_env_T', 'Температура воды');
  const Pin = read('e_env_P', 'Давление');
  const P = Number.isFinite(Pin) ? pressureToKPa(Pin, f.e_env_P_unit) : NaN;
  if (Number.isFinite(P) && (P < 50 || P > 110)) add('error', 'common', `Давление ${ru(P, 2)} кПа вне правдоподобного диапазона: проверьте единицы.`, null, 'e_env_P');
  if (Number.isFinite(T)) {
    if (T < 5 || T > 40) add('error', 'common', `Температура воды ${T} °C неправдоподобна.`, null, 'e_env_T');
    else if (T < 15 || T > 25) add('info', 'common', 'Температура воды вне 15–25 °C: тепловое расширение полости может стать заметным.', `${REF.add}, разд. 5.A.5`, 'e_env_T');
  }

  // ------------------------------------------------------------- показания
  const mu = read('e_mu', 'Мониторные единицы');
  if (Number.isFinite(mu) && mu <= 0) add('error', 'common', 'Число МЕ должно быть больше нуля.', null, 'e_mu');
  const V1 = read('e_V1', 'Рабочее напряжение V₁');
  const V2 = read('e_V2', 'Пониженное напряжение V₂');
  if (Number.isFinite(V1) && Number.isFinite(V2) && Math.abs(V1) <= Math.abs(V2)) add('error', 'common', 'Рабочее напряжение V₁ должно быть больше пониженного V₂.', null, ['e_V1', 'e_V2']);
  const M1 = readCells('e_M1', 'M при V₁, обычная полярность');
  const Mopp = readCells('e_Mopp', 'M при V₁, обратная полярность');
  const M2 = readCells('e_M2', 'M при V₂');
  // Положения камеры по протоколам: у цилиндрической всегда различаются (0,5·r_cyl),
  // у плоскопараллельной — на разницу водоэквивалентной толщины окна (TRS-398) и сдвига Report 385.
  let posDiffMm = NaN;
  if (pos && !isCyl && Number.isFinite(pos.trs.front) && Number.isFinite(pos.tg51.front)) posDiffMm = Math.abs(pos.trs.front - pos.tg51.front) * 10;
  const separate51 = f.protocol === 'both' && !!chamber && (isCyl || (!!pos && !(posDiffMm <= 0.5)));
  const M51 = separate51 ? readCells('e_M51', 'M при V₁ в положении по Report 385 (TG-51)', 'tg51') : null;
  const series = [[M1, 'при V₁', 'e_M1'], [Mopp, 'обратной полярности', 'e_Mopp'], [M2, 'при V₂', 'e_M2']];
  if (M51) series.push([M51, 'на d_ref для TG-51', 'e_M51']);
  for (const [s, label, key] of series) {
    const d = maxRelDeviation(s);
    const pct = ru(d * 100, 2);
    if (d > 0.05) add('error', 'common', `Показания ${label} расходятся на ${pct} % от среднего: вероятно, ошибка ввода.`, null, key);
    else if (d > 0.005) add('warn', 'common', `Разброс показаний ${label} до ${pct} % от среднего: повторите облучения.`, `${REF.r374}, разд. 4.4.2`, key);
    else if (d > 0.001) add('info', 'common', `Разброс показаний ${label} до ${pct} % от среднего: Report 374 советует повторять облучения, пока отклонение не станет меньше ±0,1 % без тренда.`, `${REF.r374}, разд. 4.4.2`, key);
  }
  const kleak = read('e_kleak', 'Поправка на утечку');
  if (Number.isFinite(kleak) && Math.abs(kleak - 1) > 0.001) add('warn', 'common', 'Утечка больше 0,1 % показания: причину нужно выяснить.', `${REF.r385}, табл. A1; ${REF.trs}, табл. 3`, 'e_kleak');

  const readingsOk = M1.n > 0 && !M1.error && M1.mean !== 0;
  const m1 = readingsOk ? Math.abs(M1.mean) : NaN;
  let kpolRaw = NaN;
  if (readingsOk && Mopp.n > 0 && !Mopp.error) {
    kpolRaw = polarity(M1.mean, Mopp.mean);
    const d = Math.abs(kpolRaw - 1);
    if (d > 0.02) add('warn', 'common', `k_pol = ${ru(kpolRaw, 4)}: эффект полярности больше 2 % — больше, чем допускает Report 385 для камеры эталонного класса. Проверьте камеру, кабель и время стабилизации.`, `${REF.r385}, табл. A1; ${REF.trs}, табл. 3`, 'kpol');
    else if (d > 0.004) add('info', 'common', `k_pol = ${ru(kpolRaw, 4)}: в пучках электронов эффект полярности бывает больше, чем в фотонных, — до 2 % по Report 385; TRS-398 задаёт для камер эталонного класса менее 0,4 %. Поправку обязательно измерять.`, `${REF.r385}, прил. A; ${REF.trs}, табл. 3`, 'kpol');
  }
  // поправки лаборатории относятся к калибровке в ⁶⁰Co; при перекрёстной калибровке показания уже полностью исправлены (TRS-398 ур. 41; Report 385 ур. 5)
  let kpolQ0 = 1;
  if (!f.e_lab_pol_applied && !cross) kpolQ0 = read('e_lab_kpol', 'Поправка на полярность при калибровке');
  const kpol = kpolRaw / kpolQ0;

  const nV = Math.abs(V1) / Math.abs(V2);
  const recOk = readingsOk && M2.n > 0 && !M2.error && M2.mean !== 0 && Number.isFinite(nV) && nV > 1;
  if (readingsOk && M2.n > 0 && Math.sign(M1.mean) !== Math.sign(M2.mean)) add('error', 'common', 'Показания при V₁ и V₂ должны быть сняты при одной и той же (обычной) полярности.', null, 'e_M2');
  const ratio12 = recOk ? Math.abs(M1.mean) / Math.abs(M2.mean) : NaN;
  if (recOk && ratio12 < 1) add('error', 'common', 'k_s (P_ion) не может быть меньше 1: при пониженном напряжении собирается меньше заряда. Проверьте показания и напряжения.', `${REF.trs}, разд. 4.4.3.4`, ['ks', 'Pion', 'e_M2']);
  let ksQ0 = 1;
  if (!f.e_lab_ks_applied && !cross) ksQ0 = read('e_lab_ks', 'Поправка на рекомбинацию при калибровке');

  const r50ok = Number.isFinite(r50);

  // ------------------------------------------------------------- TRS-398
  const trs = { enabled: wantTRS };
  if (wantTRS) {
    trs.kTP = temperaturePressure({ T, P, T0, P0, abs0: TRS.TRS_ABS0 });
    trs.kelec = kelec;
    trs.kpol = kpol;
    trs.kleak = kleak;
    if (recOk) {
      const r = TRS.ks({ m1: M1.mean, m2: M2.mean, v1: Math.abs(V1), v2: Math.abs(V2), beam: f.e_beam_mode });
      trs.ksRaw = r.value;
      trs.ksEquation = r.equation;
      if (r.error) add('error', 'trs', cap(r.error) + '.', `${REF.trs}, табл. 10`, 'ks');
      r.notes.forEach((n) => add('warn', 'trs', cap(n) + '.', `${REF.trs}, разд. 4.4.3.4`, 'ks'));
      if (nV < 3 - 1e-9) add('info', 'trs', 'TRS-398 рекомендует отношение напряжений V₁/V₂ ≥ 3.', `${REF.trs}, разд. 4.4.3.4`);
      trs.ks = r.value / ksQ0;
      if (trs.ks > 1.05) add('error', 'trs', `k_s = ${ru(trs.ks, 4)} > 1,05: метод двух напряжений неприменим.`, `${REF.trs}, табл. 3`, 'ks');
      if (ratio12 >= 1 && trs.ks < 1) add('error', 'trs', `k_s = ${ru(trs.ks, 4)} < 1: так быть не может, проверьте показания и поправку лаборатории.`, `${REF.trs}, разд. 4.4.3.4`, 'ks');
    } else trs.ks = NaN;

    // k_Q,Q₀: таблица (табл. 20/21, линейная интерполяция) и аппроксимация прил. II (табл. 47/48) — рядом для сравнения
    trs.coefficient = cross ? crossNdw : ndw;
    const useFormula = f.e_kqtrs_mode === 'formula';
    if (chamber && !chamber.other && r50ok) {
      if (!cross && chamber.trsT20) {
        const t = interpE(chamber.trsT20, r50);
        trs.kQTable = t.value;
        trs.kQTableError = t.error;
        trs.kQFormula = t.error ? NaN : trsFit(chamber, chamber.trsFit20, r50);
      } else if (cross && chamber.trsT21 && Number.isFinite(crossR50)) {
        const a = interpE(chamber.trsT21, r50);
        const b = interpE(chamber.trsT21, crossR50);
        trs.kQint = a.value;
        trs.kQcrossInt = b.value;
        trs.kQTable = a.value / b.value;
        trs.kQTableError = a.error ? `k_Q,Qint для пучка измерения: ${a.error}` : b.error ? `k_Q,Qint для пучка перекрёстной калибровки: ${b.error}` : null;
        trs.kQFormula = trs.kQTableError ? NaN : trsFit(chamber, chamber.trsFit21, r50) / trsFit(chamber, chamber.trsFit21, crossR50);
      }
      trs.kQDiff = (trs.kQTable / trs.kQFormula - 1) * 100;
    }
    if (f.e_kqtrs_mode === 'manual') {
      trs.kQ = read('e_kqtrs_manual', cross ? 'k_Q,Qcross (TRS-398)' : 'k_Q,Q₀ (TRS-398)', 'trs');
      if (Number.isFinite(trs.kQ) && (trs.kQ < 0.8 || trs.kQ > 1.2)) add('warn', 'trs', 'Введённый k_Q необычен: проверьте значение.', null, 'e_kqtrs_manual');
      trs.kQSource = 'введён вручную (например, измерен в лаборатории)';
    } else if (!chamber || chamber.other) {
      if (chamber?.other) add('error', 'trs', 'Для камеры не из таблиц TRS-398 введите k_Q вручную.', `${REF.trs}, табл. 20–21`, 'e_kqtrs_mode');
      trs.kQ = NaN;
    } else if (!cross) {
      if (!chamber.trsT20) {
        if (chamber.type === 'pp' && chamber.trsT21) {
          add('error', 'trs', `Для ${eChamberLabel(chamber)} TRS-398 не даёт k_Q при калибровке в ⁶⁰Co (табл. 20): нужна калибровка в пучке электронов — перекрёстная или в лаборатории.`, `${REF.trs}, разд. 7.5–7.6, табл. 20–21`, ['e_cal_route', 'kQtrs']);
        } else {
          add('error', 'trs', `Для ${eChamberLabel(chamber)} в TRS-398 нет данных k_Q для электронов (табл. 20–21): для расчёта по TRS-398 введите k_Q вручную.`, `${REF.trs}, табл. 20–21`, ['e_kqtrs_mode', 'kQtrs']);
        }
        trs.kQ = NaN;
      } else if (r50ok) {
        if (trs.kQTableError) add('error', 'trs', `k_Q по табл. 20: ${trs.kQTableError}.`, `${REF.trs}, табл. 20`, ['kQtrs', 'e_i50', 'e_r50']);
        trs.kQ = useFormula ? trs.kQFormula : trs.kQTable;
        trs.kQSource = useFormula
          ? `прил. II, ур. (${chamber.type === 'cyl' ? '99' : '98'}) с параметрами табл. 47 TRS-398`
          : 'табл. 20 TRS-398, линейная интерполяция по R50';
      } else trs.kQ = NaN;
    } else if (!chamber.trsT21) {
      add('error', 'trs', `Для ${eChamberLabel(chamber)} в табл. 21 TRS-398 нет k_Q,Qint: введите k_Q,Qcross вручную.`, `${REF.trs}, табл. 21`, ['e_kqtrs_mode', 'kQtrs']);
      trs.kQ = NaN;
    } else if (r50ok && Number.isFinite(crossR50)) {
      if (trs.kQTableError) add('error', 'trs', `${cap(trs.kQTableError)}.`, `${REF.trs}, табл. 21`, ['kQtrs', 'e_cross_r50']);
      trs.kQ = useFormula ? trs.kQFormula : trs.kQTable;
      trs.kQSource = useFormula
        ? `ур. (44) по аппроксимации прил. II, ур. (${chamber.type === 'cyl' ? '99' : '98'}), табл. 48 TRS-398`
        : 'ур. (44): k_Q,Qcross = k_Q,Qint / k_Qcross,Qint, табл. 21 TRS-398';
    } else trs.kQ = NaN;
    if (r50ok && r50 < 1.4 && f.e_kqtrs_mode !== 'manual') {
      add('warn', 'trs', 'При R50 < 1,4 г/см² TRS-398 рекомендует экспериментально определённые коэффициенты k_Q,Qint: табличные значения здесь не подтверждены измерениями.', `${REF.trs}, табл. 20–21, прим. c`, 'kQtrs');
    }
  }

  // ------------------------------------------------------------- TG-51 + Report 385
  const tg = { enabled: want51 };
  if (want51) {
    tg.PTP = temperaturePressure({ T, P, T0, P0, abs0: TG51.TG51_ABS0 });
    tg.Pelec = kelec;
    tg.Ppol = kpol;
    tg.Pleak = kleak;
    if (recOk) {
      tg.PionRaw = TG51.pIon({ mH: M1.mean, mL: M2.mean, vH: Math.abs(V1), vL: Math.abs(V2), beam: 'pulsed' });
      if (nV < 2 - 1e-9) add('warn', 'tg51', 'TG-51: пониженное напряжение должно быть меньше рабочего как минимум вдвое.', `${REF.tg51}, разд. VII.D.2`, ['e_V1', 'e_V2']);
      tg.Pion = tg.PionRaw / ksQ0;
      if (tg.Pion > 1.05) add('error', 'tg51', `P_ion = ${ru(tg.Pion, 4)} > 1,05: нужна другая камера.`, `${REF.tg51}, разд. VII.D.1`, 'Pion');
      if (ratio12 >= 1 && tg.Pion < 1) add('error', 'tg51', `P_ion = ${ru(tg.Pion, 4)} < 1: так быть не может, проверьте показания и поправку лаборатории.`, `${REF.tg51}, разд. VII.D`, 'Pion');
    } else tg.Pion = NaN;

    if (f.e_kq51_mode === 'manual') {
      tg.kQ = read('e_kq51_manual', 'k_Q (TG-51)', 'tg51');
      if (Number.isFinite(tg.kQ) && (tg.kQ < 0.8 || tg.kQ > 1.2)) add('warn', 'tg51', 'Введённый k_Q необычен: проверьте значение.', null, 'e_kq51_manual');
      tg.kQSource = cross ? 'k′_Q введён вручную' : 'введён вручную';
      if (cross) tg.kQprime = tg.kQ;
    } else if (!chamber || chamber.other || !chamber.r385) {
      if (chamber && (chamber.other || !chamber.r385)) add('error', 'tg51', `Для ${chamber.other ? 'этой камеры' : eChamberLabel(chamber)} в Report 385 нет данных: такие камеры не рекомендуется использовать для электронов; при необходимости введите k_Q вручную.`, `${REF.r385}, разд. 6.6`, ['e_ch_model', 'kQ51']);
      tg.kQ = NaN;
    } else if (r50ok) {
      if (r50 < R385_RANGE[0] - 1e-9 || r50 > R385_RANGE[1] + 1e-9) {
        add('error', 'tg51', `R50 = ${ru(r50, 2)} см вне диапазона Report 385 (1,70–8,70 см): аппроксимации k′_Q там не проверены.`, `${REF.r385}, ур. (7)–(8)`, ['kQ51', 'e_i50', 'e_r50']);
      }
      tg.kQprime = kQprime385(chamber, r50);
      tg.kQecal = chamber.r385.kQecal;
      tg.kQ = cross ? tg.kQprime : tg.kQprime * tg.kQecal;
      tg.kQSource = chamber.type === 'cyl'
        ? `Report 385: k′_Q = ${ru(chamber.r385.a, 3)} + ${ru(chamber.r385.b, 3)}·R50^(−${ru(chamber.r385.c, 3)}) (ур. 7, табл. 5)${cross ? '' : `, k_Qecal = ${ru(tg.kQecal, 3)} (табл. 4)`}`
        : `Report 385: k′_Q = ${ru(chamber.r385.a, 3)} + ${ru(chamber.r385.b, 3)}·exp(−R50/${ru(chamber.r385.c, 3)}) (ур. 8, табл. 7)${cross ? '' : `, k_Qecal = ${ru(tg.kQecal, 3)} (табл. 6)`}`;
    } else tg.kQ = NaN;
    tg.coefficient = cross ? crossKN : ndw;
    if (separate51) {
      add('info', 'tg51', 'Для TG-51 используется отдельная серия показаний в положении по Report 385. P_pol и P_ion для неё взяты из основных серий (положение по TRS-398) — это допущение калькулятора: на таком расстоянии они практически не меняются.');
    }
    if (cross && Number.isFinite(kelec) && Math.abs(kelec - 1) > 1e-9) {
      add('info', 'tg51', 'Для перекрёстно откалиброванной плоскопараллельной камеры TG-51 принимает P_elec = 1: он сокращается. Оставьте другое значение, только если оно применялось и к показаниям рабочей камеры при перекрёстной калибровке.', `${REF.tg51}, разд. VII.B`, 'e_kelec');
    }
  }
  if (isCyl && f.protocol === 'tg51' && chamber?.r385) {
    add('info', 'tg51', 'Report 385: центр цилиндрической камеры устанавливают на d_ref без сдвига — поправка на градиент уже учтена в k_Q = k′_Q·k_Qecal: оба коэффициента рассчитаны для такого положения. Сдвиг точки измерения применяют только при измерении кривой ионизации для R50.', `${REF.r385}, разд. 4, 6.5`);
  }
  if (!isCyl && chamber && f.protocol === 'both') {
    const how = 'Плоскопараллельную камеру по TRS-398 устанавливают по внутренней поверхности входного окна с учётом его водоэквивалентной толщины, а по Report 385 — со сдвигом из табл. 3';
    if (separate51) {
      add('info', 'common', `${how}; ${Number.isFinite(posDiffMm) ? `положения различаются на ${ru(posDiffMm, 1)} мм` : 'разницу положений по имеющимся данным оценить нельзя'}, поэтому для TG-51 нужна отдельная серия показаний.`, `${REF.trs}, табл. 5, 19; ${REF.r385}, табл. 3`, 'e_M51');
    } else {
      add('info', 'common', `${how}; положения различаются на ${ru(posDiffMm, 2)} мм, поэтому одни и те же показания используются для обоих протоколов.`, `${REF.trs}, табл. 5, 19; ${REF.r385}, табл. 3`);
    }
  }

  // ------------------------------------------------------------- пересчёт на z_max
  const depth = { on: !!f.e_dd_on, zref };
  if (depth.on) {
    const readD = (key, label) => {
      const v = parseNumber(f[key]);
      if (!Number.isFinite(v)) add('error', 'depth', isBlank(f[key]) ? `Не заполнено поле «${label}».` : `Не удалось прочитать число в поле «${label}».`, null, key);
      return v;
    };
    depth.zmax = parseNumber(f.e_zmax);
    if (!isBlank(f.e_zmax) && !(depth.zmax > 0 && depth.zmax < 10)) add('warn', 'depth', 'Глубина z_max задаётся в сантиметрах.', null, 'e_zmax');
    const pdd = readD('e_pdd', `PDD(z_ref)`);
    if (Number.isFinite(pdd) && (pdd < 50 || pdd > 100)) add('error', 'depth', 'PDD на опорной глубине вводится в процентах и для z_ref = 0,6·R50 − 0,1 обычно 85–100 %.', null, 'e_pdd');
    depth.factor = pdd / 100;
    depth.label = Number.isFinite(zref) ? `PDD(${ru(zref, 2)} см)/100` : 'PDD(z_ref)/100';
    depth.nominal = parseNumber(f.e_nominal);
    if (!isBlank(f.e_nominal) && !(depth.nominal > 0)) add('warn', 'depth', 'Номинальный выход не распознан: отклонение не считается.', null, 'e_nominal');
    depth.ok = !messages.some((m) => m.level === 'error' && m.scope === 'depth');
  }

  const finish = (x, M, kQ, coef) => {
    x.M = M;
    x.D = M * kQ * coef;
    x.DperMUGy = x.D / mu;
    x.DperMU = x.DperMUGy * 100;
    if (depth.on && depth.ok && Number.isFinite(depth.factor)) {
      x.DmaxPerMUGy = x.DperMUGy / depth.factor;
      x.DmaxPerMU = x.DperMU / depth.factor;
      if (depth.nominal > 0) x.deviation = (x.DmaxPerMU / depth.nominal - 1) * 100;
    }
    x.ok = Number.isFinite(x.D) && x.D > 0;
  };
  if (wantTRS) finish(trs, m1 * trs.kTP * trs.kelec * trs.kpol * trs.ks * trs.kleak, trs.kQ, trs.coefficient);
  if (want51) {
    const m51 = separate51 ? (M51 && M51.n > 0 && !M51.error ? Math.abs(M51.mean) : NaN) : m1;
    finish(tg, m51 * tg.PTP * tg.Pelec * tg.Ppol * tg.Pion * tg.Pleak, tg.kQ, tg.coefficient);
  }
  const devs = [trs.deviation, tg.deviation].filter(Number.isFinite);
  if (devs.some((d) => Math.abs(d) > 2)) add('warn', 'common', 'Отклонение от номинального выхода больше 2 %: перед подстройкой ускорителя перепроверьте ввод и измерения.');

  const hasError = (scope) => messages.some((m) => m.level === 'error' && (m.scope === 'common' || m.scope === scope));
  if (wantTRS && !trs.ok && !hasError('trs')) add('error', 'trs', 'Не удалось вычислить дозу: проверьте R50 и k_Q.');
  if (want51 && !tg.ok && !hasError('tg51')) add('error', 'tg51', 'Не удалось вычислить дозу: проверьте R50 и k_Q.');
  const order = { error: 0, warn: 1, info: 2 };
  messages.sort((a, b) => order[a.level] - order[b.level]);
  trs.blocked = wantTRS && hasError('trs');
  tg.blocked = want51 && hasError('tg51');

  let comparison = null;
  if (want51 && wantTRS && trs.ok && tg.ok && !trs.blocked && !tg.blocked) comparison = { dRel: (tg.D / trs.D - 1) * 100 };

  return {
    protocol: f.protocol,
    form: f,
    chamber,
    positions: pos,
    quality,
    inputs: { T, P, T0, P0, mu, V1, V2, nV, ndw, ndwRaw, crossNdw, crossR50, crossKN, kelec, kleak, energy, ssd, field, M1, Mopp, M2, M51, ratio12, separate51, cross },
    depth,
    trs,
    tg51: tg,
    comparison,
    messages,
    flags,
    hasErrors: messages.some((m) => m.level === 'error'),
  };
}
