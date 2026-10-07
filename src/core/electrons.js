// Референсная дозиметрия пучков электронов.
// TRS-398 Rev.1, глава 7: D_w,Q = M_Q · N_D,w,Q₀ · k_Q,Q₀ (ур. 38), z_ref = 0,6·R50 − 0,1 г/см² (ур. 39),
//   k_Q — табл. 20 (калибровка в ⁶⁰Co), k_Q,Qint — табл. 21 (перекрёстная калибровка, ур. 41–44).
// TG-51 с аддендумом WGTG51 Report 385 (2024): D_w = M · k′_Q · k_Qecal · N_D,w⁶⁰Co (ур. 4),
//   d_ref = 0,6·R50 − 0,1 см (ур. 2), k′_Q и k_Qecal — табл. 4–7, перекрёстная калибровка — ур. (5)–(6).

import { parseNumber, parseCells, isBlank, pressureToKPa, ndwToGyPerNC, ru, dec } from './units.js';
import { L } from './i18n.js';
import { temperaturePressure, polarity, environmentChecks, outputPlausibility, readTolerance, complianceOf } from './common.js';
import * as TG51 from './tg51.js';
import * as TRS from './trs398.js';
import { findEChamber, eChamberLabel, interpE, kQprime385, trsFit, R385_RANGE } from './electron-chambers.js';
import { uncertaintyBudget, typeAOf, mergeBudgetMessages } from './uncertainty.js';

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
  e_env_H: '',
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
  // контрольные измерения: обычная полярность, V₁; поправки — из основных серий (раздел 5)
  e_ctrl_M: ['', '', ''],
  e_ctrl_mu: '', // пусто — столько же МЕ, сколько в разделе 5
  // калибровка (подстройка) ускорителя, если доза вне ±2 % от номинала: ответ и показания после неё
  e_recal_needed: '', // '' | 'yes' | 'no'
  e_recal_M: ['', '', ''],
  e_recal_mu: '', // пусто — как в разделе 7 (или 5)
  e_kleak: '1,000',

  e_kqtrs_mode: 'table', // 'table' (табл. 20 или 21) | 'formula' (прил. II, табл. 47 или 48) | 'manual'
  e_kqtrs_manual: '',
  e_kq51_mode: 'fit', // 'fit' (Report 385) | 'manual'
  e_kq51_manual: '',

  e_dd_on: true,
  e_zmax: '',
  e_pdd: '',
  e_nominal: '1,000',
  e_tol: '2', // допуск учреждения на отклонение от номинала, %
  e_nominal_at: 'zmax', // где задан номинальный выход: 'zmax' (после пересчёта) | 'zref'

  // бюджет неопределённости (uncertainty.js) — как у фотонов
  e_unc_cert_U: '',
  e_unc_cert_k: '2',
  e_unc_sit: 'i',
  e_unc_cross: false,
  e_unc_over: '',
};

const REF = {
  tg51: 'TG-51 (1999)',
  r385: 'Report 385',
  add: 'аддендум TG-51 (2014)',
  r374: 'WGTG51 Report 374',
  trs: 'TRS-398 Rev.1',
};

// первая буква — заглавная, кроме обозначений величин (k_Q, k′_Q, …)
const cap = (s) => (/^[a-z][_′]/.test(s) ? s : s[0].toUpperCase() + s.slice(1));

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
  if (i50 <= 10) return { value: 1.029 * i50 - 0.06, equation: L('R50 = 1,029·R50,ion − 0,06 (R50,ion ≤ 10 г/см²)', 'R50 = 1.029·R50,ion − 0.06 (R50,ion ≤ 10 g/cm²)') };
  return { value: 1.059 * i50 - 0.37, equation: L('R50 = 1,059·R50,ion − 0,37 (R50,ion > 10 г/см²)', 'R50 = 1.059·R50,ion − 0.37 (R50,ion > 10 g/cm²)') };
}

export const zrefFromR50 = (r50) => 0.6 * r50 - 0.1;

export function normalizeElectrons(input) {
  const f = { ...E_DEFAULTS, ...input };
  if (f.protocol !== 'tg51') f.protocol = 'trs'; // режима «оба протокола» больше нет
  for (const k of ['e_M1', 'e_Mopp', 'e_M2', 'e_ctrl_M', 'e_recal_M']) {
    if (!Array.isArray(f[k])) f[k] = isBlank(f[k]) ? ['', '', ''] : String(f[k]).trim().split(/[\s;]+/);
  }
  if (!Array.isArray(f.e_staff) || f.e_staff.length === 0) f.e_staff = [''];
  if (f.e_unc_over && typeof f.e_unc_over === 'object') f.e_unc_over = JSON.stringify(f.e_unc_over);
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
      model: f.e_other_name || L('другая камера', 'other chamber'),
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
      ? {
          depth: zref + 0.05 * r,
          text: L(
            `центр камеры на 0,5·r_cyl = ${ru(0.5 * r, 2)} мм глубже z_ref, то есть на глубине ${ru(zref + 0.05 * r, 2)} см`,
            `chamber center 0.5·r_cyl = ${ru(0.5 * r, 2)} mm deeper than z_ref, i.e. at a depth of ${ru(zref + 0.05 * r, 2)} cm`,
          ),
        }
      : { depth: NaN, text: L('центр камеры на 0,5·r_cyl глубже z_ref (укажите радиус полости)', 'chamber center 0.5·r_cyl deeper than z_ref (enter the cavity radius)') };
    out.tg51 = { depth: zref, text: L(`центр камеры на глубине d_ref = ${ru(zref, 2)} см, без сдвига`, `chamber center at d_ref = ${ru(zref, 2)} cm, no shift`) };
  } else {
    const wet = Number.isFinite(chamber.windowMgCm2) ? chamber.windowMgCm2 / 100 : NaN; // мм водного эквивалента
    out.trs = Number.isFinite(wet)
      ? {
          depth: zref,
          front: zref - wet / 10,
          text: L(
            `внутренняя поверхность входного окна на z_ref = ${ru(zref, 2)} см; водоэквивалентная толщина окна ${ru(wet, 2)} мм, наружная поверхность — на ${ru(zref - wet / 10, 2)} см`,
            `inner surface of the entrance window at z_ref = ${ru(zref, 2)} cm; water-equivalent window thickness ${ru(wet, 2)} mm, outer surface at ${ru(zref - wet / 10, 2)} cm`,
          ),
        }
      : {
          depth: zref,
          text: L(
            `внутренняя поверхность входного окна на z_ref = ${ru(zref, 2)} см с учётом водоэквивалентной толщины окна`,
            `inner surface of the entrance window at z_ref = ${ru(zref, 2)} cm, accounting for the water-equivalent window thickness`,
          ),
        };
    const s = chamber.r385?.shiftMm;
    out.tg51 = Number.isFinite(s)
      ? {
          depth: zref,
          front: zref - s / 10,
          text: L(
            `наружная поверхность входного окна на ${ru(zref - s / 10, 2)} см: точка измерения на ${ru(s, 1)} мм за ней установлена на d_ref = ${ru(zref, 2)} см`,
            `outer surface of the entrance window at ${ru(zref - s / 10, 2)} cm, so that the point of measurement ${ru(s, 1)} mm behind it is at d_ref = ${ru(zref, 2)} cm`,
          ),
        }
      : { depth: zref, text: L(`точка измерения на d_ref = ${ru(zref, 2)} см`, `point of measurement at d_ref = ${ru(zref, 2)} cm`) };
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
  // nonstd — краткая причина, если замечание означает отступление от референсных условий протокола
  const add = (level, scope, text, ref = null, field = null, nonstd = null) => {
    messages.push(nonstd ? { level, scope, text, ref, nonstd } : { level, scope, text, ref });
    if (field) [].concat(field).forEach((k) => flag(k, level));
  };
  const read = (key, label, scope = 'common') => {
    const v = parseNumber(f[key]);
    if (!Number.isFinite(v)) {
      add('error', scope, isBlank(f[key]) ? L(`Не заполнено поле «${label}».`, `Field "${label}" is empty.`) : L(`Не удалось прочитать число в поле «${label}».`, `Could not read the number in field "${label}".`), null, key);
    }
    return v;
  };
  const readCells = (key, label, scope = 'common') => {
    const s = parseCells(f[key]);
    if (s.error) add('error', scope, L(`«${label}»: ${s.error}.`, `"${label}": ${s.error}.`), null, key);
    else if (s.n === 0) add('error', scope, L(`Не заполнено поле «${label}».`, `Field "${label}" is empty.`), null, key);
    else if (s.mean === 0) add('error', scope, L(`«${label}»: среднее показание равно нулю.`, `"${label}": the mean reading is zero.`), null, key);
    return s;
  };

  const want51 = f.protocol === 'tg51';
  const wantTRS = !want51;
  const energy = parseNumber(f.e_energy);

  // ---------------------------------------------------------- геометрия
  const ssd = read('e_ssd', L('РИП', 'SSD'));
  if (Number.isFinite(ssd)) {
    if (ssd < 50 || ssd > 150) add('error', 'common', L('РИП задаётся в сантиметрах (обычно 100).', 'SSD is entered in centimeters (usually 100).'), null, 'e_ssd');
    else {
      const ssdTxt = ru(ssd, ssd % 1 ? 1 : 0);
      if (wantTRS && Math.abs(ssd - 100) > 1e-9) add('warn', 'trs', L('TRS-398 задаёт РИП 100 см.', 'TRS-398 specifies an SSD of 100 cm.'), `${REF.trs}, табл. 19`, 'e_ssd', L(`РИП ${ssdTxt} см вместо 100 см`, `SSD ${ssdTxt} cm instead of 100 cm`));
      if (want51 && (ssd < 90 || ssd > 110)) add('warn', 'tg51', L('Report 385 допускает для референсных измерений РИП от 90 до 110 см.', 'Report 385 allows an SSD of 90 to 110 cm for reference measurements.'), `${REF.r385}, разд. 3`, 'e_ssd', L(`РИП ${ssdTxt} см вне 90–110 см`, `SSD ${ssdTxt} cm outside 90–110 cm`));
      else if (want51 && Math.abs(ssd - 100) > 1e-9) {
        add('info', 'tg51', L(
          'РИП должно совпадать с тем, при котором вводилась в эксплуатацию система планирования; R50 всё равно измеряют при РИП 100 см.',
          'The SSD should match the one used to commission the treatment planning system; R50 is still measured at SSD 100 cm.',
        ), `${REF.r385}, разд. 3`);
      }
    }
  }
  const field = read('e_field', L('Размер поля', 'Field size'));
  if (Number.isFinite(field)) {
    if (field < 2 || field > 40) add('error', 'common', L('Размер поля задаётся одним числом в сантиметрах, например 10.', 'Field size is entered as a single number in centimeters, e.g. 10.'), null, 'e_field');
    else if (field < 10) add('warn', 'common', L('Поле на поверхности фантома должно быть не меньше 10 × 10 см.', 'The field at the phantom surface must be at least 10 × 10 cm.'), `${REF.trs}, табл. 19; ${REF.r385}, разд. 3`, 'e_field', L(`поле ${ru(field, field % 1 ? 1 : 0)} × ${ru(field, field % 1 ? 1 : 0)} см меньше 10 × 10 см`, `${ru(field, field % 1 ? 1 : 0)} × ${ru(field, field % 1 ? 1 : 0)} cm field smaller than 10 × 10 cm`));
  }

  // ---------------------------------------------------------- качество пучка
  const quality = { method: f.e_r50_method };
  let r50 = NaN;
  if (f.e_r50_method === 'r50') {
    r50 = read('e_r50', 'R50');
    quality.equation = L('R50 введён (измерен детектором, отвечающим дозе, или известен)', 'R50 entered (measured with a dose-responding detector, or known)');
  } else {
    const i50 = read('e_i50', 'R50,ion (I50)');
    if (Number.isFinite(i50)) {
      if (i50 <= 0) add('error', 'common', L('R50,ion должен быть больше нуля.', 'R50,ion must be greater than zero.'), null, 'e_i50');
      const r = r50FromI50(i50);
      r50 = r.value;
      quality.i50 = i50;
      quality.equation = r.equation;
      if (want51 && i50 < 1.7) add('warn', 'tg51', L('Формула R50 по I50 проверена для 1,7 ≤ I50 ≤ 10 см.', 'The R50-from-I50 formula is verified for 1.7 ≤ I50 ≤ 10 cm.'), `${REF.r385}, ур. (3)`, 'e_i50');
    }
  }
  if (Number.isFinite(r50) && (r50 <= 0.3 || r50 > 15)) {
    add('error', 'common', L(
      `R50 = ${ru(r50, 2)} г/см² неправдоподобен: вводится в г/см² (см), например 4,9 для пучка 12 МэВ.`,
      `R50 = ${ru(r50, 2)} g/cm² is implausible: enter it in g/cm² (cm), e.g. 4.9 for a 12 MeV beam.`,
    ), null, ['e_r50', 'e_i50']);
    r50 = NaN;
  }
  const zref = Number.isFinite(r50) ? zrefFromR50(r50) : NaN;
  quality.r50 = r50;
  quality.zref = zref;
  quality.E0 = 2.33 * r50;

  // ---------------------------------------------------------------- камера
  const chamber = resolveEChamber(f);
  if (isBlank(f.e_ch_model)) add('error', 'common', L('Выберите тип камеры.', 'Select the chamber type.'), null, 'e_ch_model');
  if (chamber?.other) {
    add('warn', 'common', L(
      'Для камеры не из списка k_Q берётся только вручную (например, измеренный в лаборатории). Report 385 не рекомендует для электронов камеры, которых нет в его таблицах.',
      'For a chamber not in the list, k_Q can only be entered manually (e.g. measured by a calibration laboratory). Report 385 does not recommend chambers absent from its tables for electron beams.',
    ), `${REF.r385}, разд. 6.6; ${REF.trs}, табл. 20–21`, null, want51 ? L('камера не из таблиц Report 385', 'chamber not in the Report 385 tables') : null);
    if (chamber.type === 'cyl' && !Number.isFinite(chamber.trsRcylMm) && wantTRS) {
      add('warn', 'trs', L(
        'Укажите радиус полости: по TRS-398 центр цилиндрической камеры ставят на 0,5·r_cyl глубже z_ref.',
        'Enter the cavity radius: per TRS-398, the center of a cylindrical chamber is placed 0.5·r_cyl deeper than z_ref.',
      ), `${REF.trs}, табл. 19`, 'e_other_r');
    }
  }
  if (chamber?.sleeve) add('info', 'common', L('Камера не водонепроницаема: используйте тот же чехол (ПММА ≤ 1 мм), что и при калибровке.', 'The chamber is not waterproof: use the same waterproofing sleeve (PMMA ≤ 1 mm) as during calibration.'), `${REF.trs}, разд. 7.2.2`);
  const isCyl = chamber?.type === 'cyl';
  if (isCyl && Number.isFinite(r50) && r50 < 3 && wantTRS) {
    add('error', 'trs', L('При R50 < 3 г/см² TRS-398 допускает только плоскопараллельные камеры.', 'For R50 < 3 g/cm², TRS-398 allows only plane-parallel chambers.'), `${REF.trs}, табл. 19`, 'e_ch_model');
  }
  if (!isCyl && chamber && f.e_cal_route === 'co60' && want51) {
    add('info', 'tg51', L(
      'Report 385 допускает плоскопараллельную камеру, откалиброванную в ⁶⁰Co, если подтверждено её поведение как камеры эталонного класса, в частности стабильность.',
      'Report 385 allows a plane-parallel chamber calibrated in ⁶⁰Co if its reference-class behavior, in particular its stability, has been verified.',
    ), `${REF.r385}, разд. 5.3.1, прил. A`);
  }
  if (!isCyl && chamber && f.e_cal_route === 'co60' && wantTRS) {
    add('info', 'trs', L(
      'TRS-398 рекомендует калибровать плоскопараллельную камеру в пучке электронов — в лаборатории или перекрёстно.',
      'TRS-398 recommends calibrating a plane-parallel chamber in an electron beam, either at a calibration laboratory or by cross-calibration.',
    ), `${REF.trs}, разд. 7.2.1`);
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
    if (Number.isFinite(ndw) && (ndw < 1e-3 || ndw > 5)) {
      add('warn', 'common', L(
        `N_D,w = ${dec(ndw.toPrecision(4))} Гр/нКл выглядит неправдоподобно: проверьте единицы.`,
        `N_D,w = ${dec(ndw.toPrecision(4))} Gy/nC looks implausible: check the units.`,
      ), null, 'e_ndw');
    }
  } else {
    if (wantTRS) {
      const v = read('e_cross_ndw', 'N_D,w,Qcross', 'trs');
      crossNdw = Number.isFinite(v) ? ndwToGyPerNC(v, f.e_cross_ndw_unit) : NaN;
      crossR50 = read('e_cross_r50', L('R50 пучка перекрёстной калибровки', 'R50 of the cross-calibration beam'), 'trs');
      if (Number.isFinite(crossR50) && crossR50 < 7) add('info', 'trs', L('TRS-398 рекомендует перекрёстную калибровку в пучке с R50 > 7 г/см² (E₀ > 16 МэВ).', 'TRS-398 recommends cross-calibration in a beam with R50 > 7 g/cm² (E₀ > 16 MeV).'), `${REF.trs}, разд. 7.6.1`, 'e_cross_r50');
    }
    if (want51) {
      if (isCyl) {
        add('error', 'tg51', L(
          'Report 385 предусматривает перекрёстную калибровку только плоскопараллельной камеры по цилиндрической: для цилиндрической камеры используйте N_D,w в ⁶⁰Co.',
          'Report 385 provides cross-calibration only of a plane-parallel chamber against a cylindrical one: for a cylindrical chamber, use N_D,w in ⁶⁰Co.',
        ), `${REF.r385}, разд. 5.3.2`, 'e_cal_route');
      }
      const v = read('e_cross_kn', '(k_Qecal·N_D,w)_pp', 'tg51');
      crossKN = Number.isFinite(v) ? ndwToGyPerNC(v, f.e_cross_kn_unit) : NaN;
    }
  }
  const T0 = read('e_T0', L('T₀ из сертификата', 'T₀ from the certificate'));
  const P0 = read('e_P0', L('P₀ из сертификата', 'P₀ from the certificate'));
  if (Number.isFinite(T0) && (T0 < 15 || T0 > 25)) add('error', 'common', L('T₀ задаётся в °C (обычно 20 или 22).', 'T₀ is entered in °C (usually 20 or 22).'), null, 'e_T0');
  if (Number.isFinite(P0) && (P0 < 95 || P0 > 105)) add('warn', 'common', L('P₀ задаётся в кПа (обычно 101,325 или 101,33).', 'P₀ is entered in kPa (usually 101.325 or 101.33).'), null, 'e_P0');
  const kelec = read('e_kelec', 'k_elec (P_elec)');
  if (Number.isFinite(kelec) && Math.abs(kelec - 1) > 0.02) add('warn', 'common', L('k_elec отличается от 1 больше чем на 2 %: проверьте сертификат электрометра.', 'k_elec differs from 1 by more than 2 %: check the electrometer calibration certificate.'), null, 'e_kelec');

  // ------------------------------------------------------ окружающая среда
  const T = read('e_env_T', L('Температура воды', 'Water temperature'));
  const Pin = read('e_env_P', L('Давление', 'Pressure'));
  const P = Number.isFinite(Pin) ? pressureToKPa(Pin, f.e_env_P_unit) : NaN;
  if (Number.isFinite(P) && (P < 50 || P > 110)) add('error', 'common', L(`Давление ${ru(P, 2)} кПа вне правдоподобного диапазона: проверьте единицы.`, `Pressure ${ru(P, 2)} kPa is outside the plausible range: check the units.`), null, 'e_env_P');
  const env = environmentChecks({ T, Hraw: f.e_env_H, keyT: 'e_env_T', keyH: 'e_env_H', parseNumber, isBlank, ru });
  env.items.forEach(([level, text, ref, key]) => add(level, 'common', text, ref, key));

  // ------------------------------------------------------------- показания
  const mu = read('e_mu', L('Мониторные единицы', 'Monitor units'));
  if (Number.isFinite(mu) && mu <= 0) add('error', 'common', L('Число МЕ должно быть больше нуля.', 'The number of MU must be greater than zero.'), null, 'e_mu');
  const V1 = read('e_V1', L('Рабочее напряжение V₁', 'Operating voltage V₁'));
  const V2 = read('e_V2', L('Пониженное напряжение V₂', 'Reduced voltage V₂'));
  if (Number.isFinite(V1) && Number.isFinite(V2) && Math.abs(V1) <= Math.abs(V2)) add('error', 'common', L('Рабочее напряжение V₁ должно быть больше пониженного V₂.', 'The operating voltage V₁ must be higher than the reduced voltage V₂.'), null, ['e_V1', 'e_V2']);
  const M1 = readCells('e_M1', L('M при V₁, обычная полярность', 'M at V₁, normal polarity'));
  const Mopp = readCells('e_Mopp', L('M при V₁, обратная полярность', 'M at V₁, opposite polarity'));
  const M2 = readCells('e_M2', L('M при V₂', 'M at V₂'));
  const series = [
    [M1, L('при V₁', 'at V₁'), 'e_M1', 'common'],
    [Mopp, L('обратной полярности', 'at opposite polarity'), 'e_Mopp', 'common'],
    [M2, L('при V₂', 'at V₂'), 'e_M2', 'common'],
  ];
  for (const [s, label, key, scope] of series) {
    const d = maxRelDeviation(s);
    const pct = ru(d * 100, 2);
    if (d > 0.05) add('error', scope, L(`Показания ${label} расходятся на ${pct} % от среднего: вероятно, ошибка ввода.`, `Readings ${label} differ from the mean by up to ${pct} %: probably a data-entry error.`), null, key);
    else if (d > 0.005) add('warn', scope, L(`Разброс показаний ${label} до ${pct} % от среднего: повторите облучения.`, `Spread of readings ${label} up to ${pct} % of the mean: repeat the exposures.`), `${REF.r374}, разд. 4.4.2`, key);
    else if (d > 0.001) add('info', scope, L(`Разброс показаний ${label} до ${pct} % от среднего: Report 374 советует повторять облучения, пока отклонение не станет меньше ±0,1 % без тренда.`, `Spread of readings ${label} up to ${pct} % of the mean: Report 374 recommends repeating exposures until the deviation is below ±0.1 % with no trend.`), `${REF.r374}, разд. 4.4.2`, key);
  }
  const kleak = read('e_kleak', L('Поправка на утечку', 'Leakage correction'));
  if (Number.isFinite(kleak) && Math.abs(kleak - 1) > 0.001) add('warn', 'common', L('Утечка больше 0,1 % показания: причину нужно выяснить.', 'Leakage exceeds 0.1 % of the reading: the cause must be found.'), `${REF.r385}, табл. A1; ${REF.trs}, табл. 3`, 'e_kleak', L('утечка больше 0,1 %: камера не отвечает критерию эталонного класса', 'leakage above 0.1 %: the chamber does not meet the reference-class criterion'));

  const seriesOk = (x) => x && x.n > 0 && !x.error && x.mean !== 0;
  const checkPolarity = (value, name, scope, flagKey) => {
    const d = Math.abs(value - 1);
    if (d > 0.02) add('warn', scope, L(`${name} = ${ru(value, 4)}: эффект полярности больше 2 % — больше, чем допускает Report 385 для камеры эталонного класса. Проверьте камеру, кабель и время стабилизации.`, `${name} = ${ru(value, 4)}: the polarity effect exceeds 2 %, more than Report 385 allows for a reference-class chamber. Check the chamber, the cable and the stabilization time.`), `${REF.r385}, табл. A1; ${REF.trs}, табл. 3`, flagKey, L(`${name} = ${ru(value, 4)}: эффект полярности больше 2 %`, `${name} = ${ru(value, 4)}: polarity effect above 2 %`));
    else if (d > 0.004) add('info', scope, L(`${name} = ${ru(value, 4)}: в пучках электронов эффект полярности бывает больше, чем в фотонных, — до 2 % по Report 385; TRS-398 задаёт для камер эталонного класса менее 0,4 %. Поправку обязательно измерять.`, `${name} = ${ru(value, 4)}: in electron beams the polarity effect can be larger than in photon beams, up to 2 % according to Report 385; TRS-398 specifies less than 0.4 % for reference-class chambers. The correction must always be measured.`), `${REF.r385}, прил. A; ${REF.trs}, табл. 3`, flagKey);
  };
  const readingsOk = seriesOk(M1);
  const m1 = readingsOk ? Math.abs(M1.mean) : NaN;
  let kpolRaw = NaN;
  if (readingsOk && Mopp.n > 0 && !Mopp.error) {
    kpolRaw = polarity(M1.mean, Mopp.mean);
    checkPolarity(kpolRaw, 'k_pol', 'common', 'kpol');
  }
  // поправки лаборатории относятся к калибровке в ⁶⁰Co; при перекрёстной калибровке показания уже полностью исправлены (TRS-398 ур. 41; Report 385 ур. 5)
  let kpolQ0 = 1;
  if (!f.e_lab_pol_applied && !cross) kpolQ0 = read('e_lab_kpol', L('Поправка на полярность при калибровке', 'Polarity correction at calibration'));
  const kpol = kpolRaw / kpolQ0;

  const nV = Math.abs(V1) / Math.abs(V2);
  const recOk = readingsOk && seriesOk(M2) && Number.isFinite(nV) && nV > 1;
  if (readingsOk && M2.n > 0 && Math.sign(M1.mean) !== Math.sign(M2.mean)) add('error', 'common', L('Показания при V₁ и V₂ должны быть сняты при одной и той же (обычной) полярности.', 'Readings at V₁ and V₂ must be taken at the same (normal) polarity.'), null, 'e_M2');
  const ratio12 = recOk ? Math.abs(M1.mean) / Math.abs(M2.mean) : NaN;
  if (recOk && ratio12 < 1) {
    add('error', 'common', L('k_s (P_ion) не может быть меньше 1: при пониженном напряжении собирается меньше заряда. Проверьте показания и напряжения.', 'k_s (P_ion) cannot be less than 1: less charge is collected at the reduced voltage. Check the readings and voltages.'), `${REF.trs}, разд. 4.4.3.4`, ['ks', 'Pion', 'e_M2']);
  }

  let ksQ0 = 1;
  if (!f.e_lab_ks_applied && !cross) ksQ0 = read('e_lab_ks', L('Поправка на рекомбинацию при калибровке', 'Recombination correction at calibration'));

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
      if (nV < 3 - 1e-9) add('info', 'trs', L('TRS-398 рекомендует отношение напряжений V₁/V₂ ≥ 3.', 'TRS-398 recommends a voltage ratio V₁/V₂ ≥ 3.'), `${REF.trs}, разд. 4.4.3.4`);
      trs.ks = r.value / ksQ0;
      // пороги — по измеренному k_s (рекомбинация в пучке пользователя); отношение k_s,Q/k_s,Q₀ может быть < 1
      if (trs.ksRaw > 1.05) add('error', 'trs', L(`k_s = ${ru(trs.ksRaw, 4)} > 1,05: метод двух напряжений неприменим.`, `k_s = ${ru(trs.ksRaw, 4)} > 1.05: the two-voltage method is not applicable.`), `${REF.trs}, табл. 3`, 'ks');
      if (ratio12 >= 1 && trs.ksRaw < 1) add('error', 'trs', L(`k_s = ${ru(trs.ksRaw, 4)} < 1: так быть не может, проверьте показания и напряжения.`, `k_s = ${ru(trs.ksRaw, 4)} < 1 is impossible: check the readings and the voltages.`), `${REF.trs}, разд. 4.4.3.4`, 'ks');
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
        trs.kQTableError = a.error
          ? L(`k_Q,Qint для пучка измерения: ${a.error}`, `k_Q,Qint for the measured beam: ${a.error}`)
          : b.error
            ? L(`k_Q,Qint для пучка перекрёстной калибровки: ${b.error}`, `k_Q,Qint for the cross-calibration beam: ${b.error}`)
            : null;
        trs.kQFormula = trs.kQTableError ? NaN : trsFit(chamber, chamber.trsFit21, r50) / trsFit(chamber, chamber.trsFit21, crossR50);
      }
      trs.kQDiff = (trs.kQTable / trs.kQFormula - 1) * 100;
    }
    if (f.e_kqtrs_mode === 'manual') {
      trs.kQ = read('e_kqtrs_manual', cross ? 'k_Q,Qcross (TRS-398)' : 'k_Q,Q₀ (TRS-398)', 'trs');
      if (Number.isFinite(trs.kQ) && (trs.kQ < 0.8 || trs.kQ > 1.2)) add('warn', 'trs', L('Введённый k_Q необычен: проверьте значение.', 'The entered k_Q is unusual: check the value.'), null, 'e_kqtrs_manual');
      trs.kQSource = L('введён вручную (например, измерен в лаборатории)', 'entered manually (e.g. measured by a calibration laboratory)');
    } else if (!chamber || chamber.other) {
      if (chamber?.other) add('error', 'trs', L('Для камеры не из таблиц TRS-398 введите k_Q вручную.', 'For a chamber not in the TRS-398 tables, enter k_Q manually.'), `${REF.trs}, табл. 20–21`, 'e_kqtrs_mode');
      trs.kQ = NaN;
    } else if (!cross) {
      if (!chamber.trsT20) {
        if (chamber.type === 'pp' && chamber.trsT21) {
          add('error', 'trs', L(
            `Для ${eChamberLabel(chamber)} TRS-398 не даёт k_Q при калибровке в ⁶⁰Co (табл. 20): нужна калибровка в пучке электронов — перекрёстная или в лаборатории.`,
            `TRS-398 gives no k_Q for ${eChamberLabel(chamber)} calibrated in ⁶⁰Co (Table 20): calibration in an electron beam is required, either by cross-calibration or at a calibration laboratory.`,
          ), `${REF.trs}, разд. 7.5–7.6, табл. 20–21`, ['e_cal_route', 'kQtrs']);
        } else {
          add('error', 'trs', L(
            `Для ${eChamberLabel(chamber)} в TRS-398 нет данных k_Q для электронов (табл. 20–21): для расчёта по TRS-398 введите k_Q вручную.`,
            `TRS-398 gives no electron-beam k_Q data for ${eChamberLabel(chamber)} (Tables 20–21): to calculate per TRS-398, enter k_Q manually.`,
          ), `${REF.trs}, табл. 20–21`, ['e_kqtrs_mode', 'kQtrs']);
        }
        trs.kQ = NaN;
      } else if (r50ok) {
        if (trs.kQTableError) add('error', 'trs', L(`k_Q по табл. 20: ${trs.kQTableError}.`, `k_Q from Table 20: ${trs.kQTableError}.`), `${REF.trs}, табл. 20`, ['kQtrs', 'e_i50', 'e_r50']);
        trs.kQ = useFormula ? trs.kQFormula : trs.kQTable;
        trs.kQSource = useFormula
          ? L(`прил. II, ур. (${chamber.type === 'cyl' ? '99' : '98'}) с параметрами табл. 47 TRS-398`, `App. II, Eq. (${chamber.type === 'cyl' ? '99' : '98'}) with the parameters of TRS-398 Table 47`)
          : L('табл. 20 TRS-398, линейная интерполяция по R50', 'TRS-398 Table 20, linear interpolation in R50');
      } else trs.kQ = NaN;
    } else if (!chamber.trsT21) {
      add('error', 'trs', L(`Для ${eChamberLabel(chamber)} в табл. 21 TRS-398 нет k_Q,Qint: введите k_Q,Qcross вручную.`, `TRS-398 Table 21 gives no k_Q,Qint for ${eChamberLabel(chamber)}: enter k_Q,Qcross manually.`), `${REF.trs}, табл. 21`, ['e_kqtrs_mode', 'kQtrs']);
      trs.kQ = NaN;
    } else if (r50ok && Number.isFinite(crossR50)) {
      if (trs.kQTableError) add('error', 'trs', `${cap(trs.kQTableError)}.`, `${REF.trs}, табл. 21`, ['kQtrs', 'e_cross_r50']);
      trs.kQ = useFormula ? trs.kQFormula : trs.kQTable;
      trs.kQSource = useFormula
        ? L(`ур. (44) по аппроксимации прил. II, ур. (${chamber.type === 'cyl' ? '99' : '98'}), табл. 48 TRS-398`, `Eq. (44) with the fit of App. II, Eq. (${chamber.type === 'cyl' ? '99' : '98'}), TRS-398 Table 48`)
        : L('ур. (44): k_Q,Qcross = k_Q,Qint / k_Qcross,Qint, табл. 21 TRS-398', 'Eq. (44): k_Q,Qcross = k_Q,Qint / k_Qcross,Qint, TRS-398 Table 21');
    } else trs.kQ = NaN;
    if (r50ok && r50 < 1.4 && f.e_kqtrs_mode !== 'manual') {
      add('warn', 'trs', L(
        'При R50 < 1,4 г/см² TRS-398 рекомендует экспериментально определённые коэффициенты k_Q,Qint: табличные значения здесь не подтверждены измерениями.',
        'For R50 < 1.4 g/cm², TRS-398 recommends experimentally determined k_Q,Qint factors: the tabulated values here are not confirmed by measurements.',
      ), `${REF.trs}, табл. 20–21, прим. c`, 'kQtrs');
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
      if (nV < 2 - 1e-9) add('warn', 'tg51', L('TG-51: пониженное напряжение должно быть меньше рабочего как минимум вдвое.', 'TG-51: the reduced voltage must be at most half the operating voltage.'), `${REF.tg51}, разд. VII.D.2`, ['e_V1', 'e_V2']);
      tg.Pion = tg.PionRaw / ksQ0;
      if (tg.PionRaw > 1.05) add('error', 'tg51', L(`P_ion = ${ru(tg.PionRaw, 4)} > 1,05: нужна другая камера.`, `P_ion = ${ru(tg.PionRaw, 4)} > 1.05: use a different chamber.`), `${REF.tg51}, разд. VII.D.1`, 'Pion');
      if (ratio12 >= 1 && tg.PionRaw < 1) add('error', 'tg51', L(`P_ion = ${ru(tg.PionRaw, 4)} < 1: так быть не может, проверьте показания и напряжения.`, `P_ion = ${ru(tg.PionRaw, 4)} < 1 is impossible: check the readings and the voltages.`), `${REF.tg51}, разд. VII.D`, 'Pion');
    } else tg.Pion = NaN;

    if (f.e_kq51_mode === 'manual') {
      tg.kQ = read('e_kq51_manual', 'k_Q (TG-51)', 'tg51');
      if (Number.isFinite(tg.kQ) && (tg.kQ < 0.8 || tg.kQ > 1.2)) add('warn', 'tg51', L('Введённый k_Q необычен: проверьте значение.', 'The entered k_Q is unusual: check the value.'), null, 'e_kq51_manual');
      tg.kQSource = cross ? L('k′_Q введён вручную', 'k′_Q entered manually') : L('введён вручную', 'entered manually');
      if (cross) tg.kQprime = tg.kQ;
      // камера из списка, но без данных Report 385: ручной k_Q не делает расчёт расчётом по Report 385 (разд. 6.6)
      if (chamber && !chamber.other && !chamber.r385) {
        add('warn', 'tg51', L(
          `Для ${eChamberLabel(chamber)} в Report 385 нет данных: такие камеры пока не рекомендуется использовать для референсной дозиметрии электронов. С введённым вручную k_Q расчёт не является расчётом по Report 385.`,
          `Report 385 gives no data for ${eChamberLabel(chamber)}: such chambers are not yet recommended for electron reference dosimetry. With a manually entered k_Q, the calculation is not a Report 385 calculation.`,
        ), `${REF.r385}, разд. 6.6`, ['e_ch_model', 'e_kq51_manual'], L(`${eChamberLabel(chamber)}: нет данных Report 385, k_Q введён вручную`, `${eChamberLabel(chamber)}: no Report 385 data, k_Q entered manually`));
      }
    } else if (!chamber || chamber.other || !chamber.r385) {
      if (chamber && (chamber.other || !chamber.r385)) add('error', 'tg51', L(
        `Для ${chamber.other ? 'этой камеры' : eChamberLabel(chamber)} в Report 385 нет данных: такие камеры не рекомендуется использовать для электронов; при необходимости введите k_Q вручную.`,
        `Report 385 gives no data for ${chamber.other ? 'this chamber' : eChamberLabel(chamber)}: such chambers are not recommended for electron beams; if necessary, enter k_Q manually.`,
      ), `${REF.r385}, разд. 6.6`, ['e_ch_model', 'kQ51']);
      tg.kQ = NaN;
    } else if (r50ok) {
      if (r50 < R385_RANGE[0] - 1e-9 || r50 > R385_RANGE[1] + 1e-9) {
        add('error', 'tg51', L(`R50 = ${ru(r50, 2)} см вне диапазона Report 385 (1,70–8,70 см): аппроксимации k′_Q там не проверены.`, `R50 = ${ru(r50, 2)} cm is outside the Report 385 range (1.70–8.70 cm): the k′_Q fits have not been verified there.`), `${REF.r385}, ур. (7)–(8)`, ['kQ51', 'e_i50', 'e_r50']);
      }
      tg.kQprime = kQprime385(chamber, r50);
      tg.kQecal = chamber.r385.kQecal;
      tg.kQ = cross ? tg.kQprime : tg.kQprime * tg.kQecal;
      tg.kQSource = chamber.type === 'cyl'
        ? L(
            `Report 385: k′_Q = ${ru(chamber.r385.a, 3)} + ${ru(chamber.r385.b, 3)}·R50^(−${ru(chamber.r385.c, 3)}) (ур. 7, табл. 5)${cross ? '' : `, k_Qecal = ${ru(tg.kQecal, 3)} (табл. 4)`}`,
            `Report 385: k′_Q = ${ru(chamber.r385.a, 3)} + ${ru(chamber.r385.b, 3)}·R50^(−${ru(chamber.r385.c, 3)}) (Eq. 7, Table 5)${cross ? '' : `, k_Qecal = ${ru(tg.kQecal, 3)} (Table 4)`}`,
          )
        : L(
            `Report 385: k′_Q = ${ru(chamber.r385.a, 3)} + ${ru(chamber.r385.b, 3)}·exp(−R50/${ru(chamber.r385.c, 3)}) (ур. 8, табл. 7)${cross ? '' : `, k_Qecal = ${ru(tg.kQecal, 3)} (табл. 6)`}`,
            `Report 385: k′_Q = ${ru(chamber.r385.a, 3)} + ${ru(chamber.r385.b, 3)}·exp(−R50/${ru(chamber.r385.c, 3)}) (Eq. 8, Table 7)${cross ? '' : `, k_Qecal = ${ru(tg.kQecal, 3)} (Table 6)`}`,
          );
    } else tg.kQ = NaN;
    tg.coefficient = cross ? crossKN : ndw;
    if (cross && Number.isFinite(kelec) && Math.abs(kelec - 1) > 1e-9) {
      add('info', 'tg51', L(
        'Для перекрёстно откалиброванной плоскопараллельной камеры TG-51 принимает P_elec = 1: он сокращается. Оставьте другое значение, только если оно применялось и к показаниям рабочей камеры при перекрёстной калибровке.',
        'For a cross-calibrated plane-parallel chamber, TG-51 takes P_elec = 1, since it cancels out. Keep a different value only if it was also applied to the field chamber readings during cross-calibration.',
      ), `${REF.tg51}, разд. VII.B`, 'e_kelec');
    }
  }
  if (isCyl && f.protocol === 'tg51' && chamber?.r385) {
    add('info', 'tg51', L(
      'Report 385: центр цилиндрической камеры устанавливают на d_ref без сдвига — поправка на градиент уже учтена в k_Q = k′_Q·k_Qecal: оба коэффициента рассчитаны для такого положения. Сдвиг точки измерения применяют только при измерении кривой ионизации для R50.',
      'Report 385: the center of a cylindrical chamber is placed at d_ref without a shift, since the gradient correction is already included in k_Q = k′_Q·k_Qecal: both factors were calculated for this position. The shift of the point of measurement is applied only when measuring the depth-ionization curve for R50.',
    ), `${REF.r385}, разд. 4, 6.5`);
  }

  // ------------------------------------------------------------- пересчёт на z_max
  const depth = { on: !!f.e_dd_on, zref };
  if (depth.on) {
    const readD = (key, label) => {
      const v = parseNumber(f[key]);
      if (!Number.isFinite(v)) add('error', 'depth', isBlank(f[key]) ? L(`Не заполнено поле «${label}».`, `Field "${label}" is empty.`) : L(`Не удалось прочитать число в поле «${label}».`, `Could not read the number in field "${label}".`), null, key);
      return v;
    };
    depth.zmax = parseNumber(f.e_zmax);
    if (!isBlank(f.e_zmax) && !(depth.zmax > 0 && depth.zmax < 10)) add('warn', 'depth', L('Глубина z_max задаётся в сантиметрах.', 'Depth z_max is entered in centimeters.'), null, 'e_zmax');
    const pdd = readD('e_pdd', `PDD(z_ref)`);
    if (Number.isFinite(pdd) && (pdd < 50 || pdd > 100)) add('error', 'depth', L('PDD на опорной глубине вводится в процентах и для z_ref = 0,6·R50 − 0,1 обычно 85–100 %.', 'PDD at the reference depth is entered as a percentage; for z_ref = 0.6·R50 − 0.1 it is usually 85–100 %.'), null, 'e_pdd');
    depth.factor = pdd / 100;
    depth.label = Number.isFinite(zref) ? L(`PDD(${ru(zref, 2)} см)/100`, `PDD(${ru(zref, 2)} cm)/100`) : 'PDD(z_ref)/100';
    depth.ok = !messages.some((m) => m.level === 'error' && m.scope === 'depth');
  }
  // Номинальный выход: на z_max (после пересчёта) или на опорной глубине; без пересчёта — на опорной глубине.
  depth.nominal = parseNumber(f.e_nominal);
  depth.nominalAt = depth.on && f.e_nominal_at !== 'zref' ? 'zmax' : 'zref';
  if (!isBlank(f.e_nominal) && !(depth.nominal > 0)) add('warn', 'common', L('Номинальный выход не распознан: отклонение не считается.', 'Nominal output not recognized: the deviation is not calculated.'), null, 'e_nominal');
  // допуск учреждения на отклонение от номинала (по умолчанию 2 %)
  depth.tolerance = readTolerance(f.e_tol, { add, parseNumber, isBlank, field: 'e_tol' });
  const tol = depth.tolerance;
  const tolTxt = ru(tol, tol % 1 ? 1 : 0);

  // ------------------------------------------------------- контрольные измерения
  // Показания при обычной полярности и V₁ после определения поправок (и, возможно, подстройки
  // ускорителя): все поправки берутся из основных серий.
  const ctrlSeries = (key, label, ref) => {
    const s = parseCells(f[key]);
    if (s.n === 0 && !s.error) return null;
    if (s.error) add('error', 'ctrl', L(`«${label.ru}»: ${s.error}.`, `"${label.en}": ${s.error}.`), null, key);
    else if (s.mean === 0) add('error', 'ctrl', L(`«${label.ru}»: среднее показание равно нулю.`, `"${label.en}": the mean reading is zero.`), null, key);
    const d = maxRelDeviation(s);
    const pct = ru(d * 100, 2);
    if (d > 0.05) add('error', 'ctrl', L(`Контрольные показания расходятся на ${pct} % от среднего: вероятно, ошибка ввода.`, `Check readings differ from the mean by up to ${pct} %: probably an input error.`), null, key);
    else if (d > 0.005) add('warn', 'ctrl', L(`Разброс контрольных показаний до ${pct} % от среднего: повторите облучения.`, `Check readings scatter by up to ${pct} % from the mean: repeat the irradiations.`), `${REF.r374}, разд. 4.4.2`, key);
    else if (d > 0.001) add('info', 'ctrl', L(`Разброс контрольных показаний до ${pct} % от среднего: Report 374 советует добиваться ±0,1 % без тренда.`, `Check readings scatter by up to ${pct} % from the mean: Report 374 advises reaching ±0.1 % with no trend.`), `${REF.r374}, разд. 4.4.2`, key);
    if (!s.error && s.mean !== 0 && seriesOk(ref) && Math.sign(s.mean) !== Math.sign(ref.mean)) {
      add('error', 'ctrl', L('Контрольные измерения снимают при той же (обычной) полярности, что и M при V₁.', 'Check measurements are taken at the same (normal) polarity as M at V₁.'), null, key);
    }
    return s;
  };
  const ctrl = { on: false };
  const cMain = ctrlSeries('e_ctrl_M', { ru: 'Контрольные измерения', en: 'Check measurements' }, M1);
  ctrl.on = !!cMain;
  if (ctrl.on) {
    ctrl.mu = isBlank(f.e_ctrl_mu) ? mu : parseNumber(f.e_ctrl_mu);
    if (!isBlank(f.e_ctrl_mu) && !(ctrl.mu > 0)) add('error', 'ctrl', L('Число МЕ для контрольных измерений должно быть больше нуля.', 'The number of MU for check measurements must be greater than zero.'), null, 'e_ctrl_mu');
    const meanOf = (s) => (s && s.n > 0 && !s.error ? Math.abs(s.mean) : NaN);
    ctrl.M = cMain;
    ctrl.mean = meanOf(cMain);
    const ctrlErr = messages.some((m) => m.level === 'error' && m.scope === 'ctrl');
    if (!ctrlErr && ctrl.mu > 0 && mu > 0 && Number.isFinite(ctrl.mean) && Number.isFinite(m1)) ctrl.changePct = ((ctrl.mean / ctrl.mu) / (m1 / mu) - 1) * 100;
  }

  const finish = (x, M, kQ, coef, units = mu) => {
    x.M = M;
    x.D = M * kQ * coef;
    x.DcGy = x.D * 100; // сГр за отпущенные МЕ
    x.units = units;
    x.DperMUGy = x.D / units;
    x.DperMU = x.DperMUGy * 100; // сГр/МЕ (= Гр на 100 МЕ)
    if (depth.on && depth.ok && Number.isFinite(depth.factor)) {
      x.Dmax = x.D / depth.factor;
      x.DmaxcGy = x.Dmax * 100;
      x.DmaxPerMUGy = x.DperMUGy / depth.factor;
      x.DmaxPerMU = x.DperMU / depth.factor;
    }
    const atNominal = depth.nominalAt === 'zmax' ? x.DmaxPerMU : x.DperMU;
    if (depth.nominal > 0 && Number.isFinite(atNominal)) x.deviation = (atNominal / depth.nominal - 1) * 100;
    x.ok = Number.isFinite(x.D) && x.D > 0;
  };
  const productTRS = wantTRS ? trs.kTP * trs.kelec * trs.kpol * trs.ks * trs.kleak : NaN;
  const product51 = want51 ? tg.PTP * tg.Pelec * tg.Ppol * tg.Pion * tg.Pleak : NaN;
  if (wantTRS) finish(trs, m1 * productTRS, trs.kQ, trs.coefficient);
  if (want51) finish(tg, m1 * product51, tg.kQ, tg.coefficient);
  if (ctrl.on) {
    const ctrlBlocked = messages.some((m) => m.level === 'error' && m.scope === 'ctrl');
    if (wantTRS) finish((trs.ctrl = {}), ctrl.mean * productTRS, trs.kQ, trs.coefficient, ctrl.mu);
    if (want51) finish((tg.ctrl = {}), ctrl.mean * product51, tg.kQ, tg.coefficient, ctrl.mu);
    for (const x of [trs.ctrl, tg.ctrl]) if (x) x.blocked = ctrlBlocked || !x.ok;
  }
  // Отклонение от номинала — по итоговому результату: по контрольным измерениям, если они есть.
  // Если контрольные измерения введены, но содержат ошибки, итога нет: подменять его показанием M₁ раздела 5 нельзя.
  const mainBlocked = (scope) => messages.some((m) => m.level === 'error' && (m.scope === 'common' || m.scope === scope));
  const final = (x, scope) => (mainBlocked(scope) ? {} : x.ctrl ? (x.ctrl.blocked ? {} : x.ctrl) : x);

  // ---------------------------------------------- калибровка (подстройка) ускорителя
  // Если доза (по контрольным измерениям, иначе по M₁ раздела 5) отличается от номинального выхода
  // больше допуска (по умолчанию ±2 %), предлагается калибровка. После подстройки снимают новые показания при V₁ и
  // обычной полярности; поправки те же, итог — по новым показаниям, прежний результат остаётся для справки.
  const recal = { tolerance: tol, answer: f.e_recal_needed === 'yes' || f.e_recal_needed === 'no' ? f.e_recal_needed : '' };
  const pre = { trs: wantTRS ? final(trs, 'trs') : {}, tg51: want51 ? final(tg, 'tg51') : {} };
  recal.preDeviation = [pre.trs.deviation, pre.tg51.deviation].filter(Number.isFinite);
  recal.needed = recal.preDeviation.some((d) => Math.abs(d) > tol);
  recal.on = recal.needed && recal.answer === 'yes';
  if (recal.needed && !recal.answer) {
    add('info', 'recal', L(`Доза отличается от номинального выхода больше чем на ±${tolTxt} %: ответьте в разделе 9, требуется ли калибровка.`, `The dose differs from the nominal output by more than ±${tolTxt}%: answer in section 9 whether calibration is required.`), null, 'e_recal_needed');
  }
  if (recal.on) {
    const recalSeries = (key, label, ref) => {
      const s = parseCells(f[key]);
      if (s.n === 0 && !s.error) return null;
      if (s.error) add('error', 'recal', L(`«${label.ru}»: ${s.error}.`, `"${label.en}": ${s.error}.`), null, key);
      else if (s.mean === 0) add('error', 'recal', L(`«${label.ru}»: среднее показание равно нулю.`, `"${label.en}": the mean reading is zero.`), null, key);
      const d = maxRelDeviation(s);
      const pct = ru(d * 100, 2);
      if (d > 0.05) add('error', 'recal', L(`Показания после калибровки расходятся на ${pct} % от среднего: вероятно, ошибка ввода.`, `Readings after calibration differ from the mean by up to ${pct} %: probably an input error.`), null, key);
      else if (d > 0.005) add('warn', 'recal', L(`Разброс показаний после калибровки до ${pct} % от среднего: повторите облучения.`, `Readings after calibration scatter by up to ${pct} % from the mean: repeat the irradiations.`), `${REF.r374}, разд. 4.4.2`, key);
      if (!s.error && s.mean !== 0 && seriesOk(ref) && Math.sign(s.mean) !== Math.sign(ref.mean)) {
        add('error', 'recal', L('Показания после калибровки снимают при той же (обычной) полярности, что и M при V₁.', 'Readings after calibration are taken at the same (normal) polarity as M at V₁.'), null, key);
      }
      return s;
    };
    const rMain = recalSeries('e_recal_M', { ru: 'Показания после калибровки', en: 'Readings after calibration' }, M1);
    if (!rMain) {
      add('info', 'recal', L('Введите показания после калибровки ускорителя (раздел 9): до этого итог — по прежним показаниям.', 'Enter the readings after the linac calibration (section 9); until then the result is based on the previous readings.'), null, 'e_recal_M');
    } else {
      recal.mu = isBlank(f.e_recal_mu) ? (ctrl.on && ctrl.mu > 0 ? ctrl.mu : mu) : parseNumber(f.e_recal_mu);
      if (!isBlank(f.e_recal_mu) && !(recal.mu > 0)) add('error', 'recal', L('Число МЕ после калибровки должно быть больше нуля.', 'The number of MU after calibration must be greater than zero.'), null, 'e_recal_mu');
      const meanOfR = (s) => (s && s.n > 0 && !s.error ? Math.abs(s.mean) : NaN);
      recal.M = rMain;
      recal.mean = meanOfR(rMain);
      const recalErr = messages.some((m) => m.level === 'error' && m.scope === 'recal');
      const atNominal = (y) => (depth.nominalAt === 'zmax' ? y.DmaxPerMU : y.DperMU);
      for (const [want, x, M, product, p] of [[wantTRS, trs, recal.mean, productTRS, pre.trs], [want51, tg, recal.mean, product51, pre.tg51]]) {
        if (!want) continue;
        finish((x.recal = {}), M * product, x.kQ, x.coefficient, recal.mu);
        x.recal.blocked = recalErr || !x.recal.ok;
        if (Number.isFinite(p.DperMU)) {
          x.recal.pre = { DperMU: p.DperMU, DmaxPerMU: p.DmaxPerMU, deviation: p.deviation, units: p.units, fromCtrl: p === x.ctrl };
          const a = atNominal(p);
          const b = atNominal(x.recal);
          if (Number.isFinite(a) && Number.isFinite(b) && b > 0) x.recal.preVsNew = (a / b - 1) * 100;
        }
      }
      // большая подстройка: если менялась доза за импульс (а не только калибровка мониторной камеры), k_s нужно перемерить
      const shift = [trs.recal, tg.recal].map((y) => y?.preVsNew).find(Number.isFinite);
      if (Number.isFinite(shift) && Math.abs(shift) > 2) {
        add(
          'info',
          'recal',
          L(
            `Выход после подстройки изменился на ${ru(Math.abs(shift), 1)} %. Если при этом менялась доза за импульс (ток пушки, частота импульсов), а не только калибровка мониторной камеры, перемерьте k_s (P_ion): рекомбинация зависит от дозы за импульс.`,
            `The output changed by ${ru(Math.abs(shift), 1)}% after the adjustment. If the dose per pulse changed (gun current, pulse repetition frequency) and not only the monitor chamber calibration, remeasure k_s (P_ion): recombination depends on the dose per pulse.`,
          ),
          `${REF.trs}, разд. 4.4.3.4; ${REF.r374}, разд. 4.4.4`,
        );
      }
    }
  }
  // итог: после калибровки, если она проведена и без ошибок
  const actual = (x, scope) => {
    const y = final(x, scope);
    return y === x.ctrl || y === x ? (x.recal && !x.recal.blocked ? x.recal : y) : y;
  };
  const finals = [];
  for (const [want, x, scope] of [[wantTRS, trs, 'trs'], [want51, tg, 'tg51']]) {
    if (!want) continue;
    const y = actual(x, scope);
    if (Number.isFinite(y.DperMU)) finals.push({ x: y, units: y.units });
  }
  outputPlausibility(finals, { add, ru, tol, muSections: L('разделы 5 и 7', 'sections 5 and 7'), zrefText: Number.isFinite(zref) ? L(`(${ru(zref, 2)} см)`, `(${ru(zref, 2)} cm)`) : 'z_ref' });

  const hasError = (scope) => messages.some((m) => m.level === 'error' && (m.scope === 'common' || m.scope === scope));
  if (wantTRS && !trs.ok && !hasError('trs')) add('error', 'trs', L('Не удалось вычислить дозу: проверьте R50 и k_Q.', 'Could not calculate the dose: check R50 and k_Q.'));
  if (want51 && !tg.ok && !hasError('tg51')) add('error', 'tg51', L('Не удалось вычислить дозу: проверьте R50 и k_Q.', 'Could not calculate the dose: check R50 and k_Q.'));
  // P_pol считается по тем же показаниям, что и k_pol: подсветка общая
  if (flags.kpol) flags.Ppol = flags.kpol;

  // бюджет неопределённости (на итог дозы не влияет); тип А — по серии, по которой посчитан итог
  const xAct = wantTRS ? trs : tg;
  const yAct = actual(xAct, wantTRS ? 'trs' : 'tg51');
  const doseSeries = yAct === xAct.recal ? recal.M : yAct === xAct.ctrl ? ctrl.M : M1;
  const crossE = f.e_cal_route === 'cross';
  const unc = uncertaintyBudget({
    beam: 'electrons', protocol: f.protocol, chamberType: chamber?.type === 'cyl' ? 'cyl' : 'pp', crossE, crossCo: !crossE && !!f.e_unc_cross,
    r50: quality.r50, situation: f.e_unc_sit, certU: f.e_unc_cert_U, certK: f.e_unc_cert_k, over: f.e_unc_over, typeA: typeAOf(doseSeries), prefix: 'e_',
  });
  mergeBudgetMessages(unc, add);

  const order = { error: 0, warn: 1, info: 2 };
  messages.sort((a, b) => order[a.level] - order[b.level]);
  trs.blocked = wantTRS && hasError('trs');
  tg.blocked = want51 && hasError('tg51');
  if (trs.ctrl) trs.ctrl.blocked = trs.ctrl.blocked || trs.blocked;
  if (tg.ctrl) tg.ctrl.blocked = tg.ctrl.blocked || tg.blocked;
  if (trs.recal) trs.recal.blocked = trs.recal.blocked || trs.blocked;
  if (tg.recal) tg.recal.blocked = tg.recal.blocked || tg.blocked;

  // соответствие референсным условиям выбранного протокола
  const activeKey = wantTRS ? 'trs' : 'tg51';
  const shown = actual(wantTRS ? trs : tg, activeKey);
  const compliance = complianceOf(messages, activeKey, Number.isFinite(shown.DperMU));

  return {
    protocol: f.protocol,
    form: f,
    chamber,
    positions: pos,
    quality,
    compliance,
    inputs: { H: env.H,
      T, P, T0, P0, mu, V1, V2, nV, ndw, ndwRaw, crossNdw, crossR50, crossKN, kelec, kleak, energy, ssd, field,
      M1, Mopp, M2, ratio12, cross,
    },
    depth,
    ctrl,
    recal,
    trs,
    tg51: tg,
    unc,
    messages,
    flags,
    hasErrors: messages.some((m) => m.level === 'error'),
  };
}
