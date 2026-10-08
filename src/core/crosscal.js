// Перекрёстная калибровка рабочей камеры по опорной камере, откалиброванной в ⁶⁰Co.
// Камеры поочерёдно (или «бок о бок» с перестановкой) ставят на опорную глубину и облучают одинаково.
//
// ⁶⁰Co — пучок опорного качества Q₀ (TRS-398 Rev.1, разд. 4.5.1, 5.5, 6.6; ур. 25, 32, 36):
//   N_D,w^field = (M_ref / M_field) · N_D,w^ref.
// МВ фотоны, клинический пучок Q_cross (TRS-398 Rev.1, разд. 4.5.2; ур. 26–27):
//   N_D,w,Qcross^field = (M_ref / M_field) · N_D,w,Q₀^ref · k_Qcross^ref, k_Q — табл. 16 (или ур. 34) по TPR20,10.
//   В пучке БВФ показания исправляются на k_vol (ур. 22). Дальше в фотонном пучке Q:
//   k_Q,Qcross^field = k_Q^field / k_Qcross^field (ур. 30) — это делает вкладка «МВ фотоны».
// Электроны (TRS-398 Rev.1, разд. 7.6.1, ур. 41):
//   N_D,w,Qcross^field = (M_ref / M_field) · N_D,w,Q₀^ref · k_Qcross,Q₀^ref, k_Q — табл. 20;
//   дальше k_Q,Qcross = k_Q,Qint / k_Qcross,Qint (ур. 44, табл. 21) — вкладка «Электроны».
// Электроны, WGTG51 Report 385 (2024), разд. 5.3.2, ур. (5):
//   (k_Qecal·N_D,w)_pp = (M · k′_Q · k_Qecal · N_D,w)_cyl / (M · k′_Q)_pp; дальше ур. (6).
// TG-51 и его аддендумы перекрёстную калибровку в пучках ⁶⁰Co и МВ фотонов не описывают:
// для них расчёт всегда по TRS-398.
//
// Показания исправляются на температуру и давление, электрометр, полярность и рекомбинацию
// (TRS-398, разд. 4.4.3). По желанию — нормировка на внешний монитор (TRS-398, разд. 6.6).

import { parseNumber, parseCells, isBlank, pressureToKPa, ndwToGyPerNC, ru, dec } from './units.js';
import { L } from './i18n.js';
import { temperaturePressure, polarity, environmentChecks } from './common.js';
import * as TG51 from './tg51.js';
import * as TRS from './trs398.js';
import { findEChamber, interpE, kQprime385, trsFit, R385_RANGE } from './electron-chambers.js';
import { findChamber, chamberLabel, noteText } from './chambers.js';
import { r50FromI50, zrefFromR50, positions } from './electrons.js';

export const BEAM_TYPES = ['co60', 'photons', 'electrons'];
export const PP_PREFIX = 'PP:'; // плоскопараллельная камера в пучке ⁶⁰Co (как на вкладке ⁶⁰Co)

export const CC_DEFAULTS = {
  protocol: 'trs',

  cc_institution: '',
  cc_machine: '',
  cc_beam: '',
  cc_date: '',
  cc_staff: [''],
  cc_notes: '',

  // пучок перекрёстной калибровки
  cc_beam_type: 'electrons', // 'co60' | 'photons' | 'electrons'
  cc_method: 'sub', // 'sub' — замещение | 'side' — «бок о бок» с перестановкой камер (⁶⁰Co и фотоны)
  cc_monitor: false, // нормировка показаний на внешний монитор
  // электроны
  cc_r50_method: 'i50', // 'i50' — по глубине 50 % ионизации | 'r50' — R50 известен
  cc_i50: '',
  cc_r50: '',
  // МВ фотоны
  cc_tpr_method: 'tpr', // 'tpr' — TPR20,10 известен | 'pdd2010' — через PDD(20)/PDD(10)
  cc_tpr: '',
  cc_pdd20: '',
  cc_pdd10: '',
  cc_fff: false,
  cc_sdd: '110', // РИД для k_vol (ур. 22), см
  // ⁶⁰Co
  cc_co_zref: '5', // г/см²
  cc_time: '1', // время облучения, мин (одно и то же для обеих камер)
  cc_rec_co: 'eq13', // 'eq13' | 'eq16' — k_s в непрерывном пучке
  // ускоритель
  cc_mu: '100',
  cc_beam_mode: 'pulsed', // 'pulsed' | 'scanned' — для k_s по табл. 10 TRS-398

  // опорная камера: калибровка в ⁶⁰Co
  cc_ref_model: '', // id камеры (зависит от пучка) | 'OTHER'
  cc_ref_other_name: '',
  cc_ref_other_type: 'cyl',
  cc_ref_other_r: '',
  cc_ref_length: '', // длина полости, мм (для k_vol в пучке БВФ; пусто — из базы)
  cc_ref_serial: '',
  cc_ref_ndw: '',
  cc_ref_ndw_unit: 'Gy/nC',
  cc_ref_klab: '1,000', // поправочный множитель K из протокола поверки
  cc_T0: '20',
  cc_P0: '101,325',
  cc_ref_el_model: '',
  cc_ref_el_serial: '',
  cc_ref_kelec: '1,000',
  cc_ref_kqtrs_mode: 'table', // 'table' (табл. 20 / 16) | 'formula' (прил. II / ур. 34) | 'manual'
  cc_ref_kqtrs_manual: '',
  cc_ref_kq51_mode: 'fit', // 'fit' (Report 385: k′_Q·k_Qecal) | 'manual'
  cc_ref_kq51_manual: '',

  // рабочая (калибруемая) камера
  cc_fld_model: '',
  cc_fld_other_name: '',
  cc_fld_other_type: 'pp',
  cc_fld_other_r: '',
  cc_fld_length: '',
  cc_fld_serial: '',
  cc_fld_el_model: '',
  cc_fld_el_serial: '',
  cc_fld_kelec: '1,000',
  cc_fld_kq51_mode: 'fit', // 'fit' (Report 385, k′_Q) | 'manual'
  cc_fld_kq51_manual: '',

  // температура и давление; для рабочей камеры — свои, если изменились
  cc_T: '',
  cc_H: '',
  cc_P: '',
  cc_P_unit: 'kPa',
  cc_T2: '',
  cc_P2: '',

  // показания опорной камеры
  cc_ref_polarity: '+',
  cc_ref_V1: '300',
  cc_ref_V2: '100',
  cc_ref_M1: ['', '', ''],
  cc_ref_Mem: ['', '', ''], // показания внешнего монитора при M₁ (по тем же облучениям)
  cc_ref_Mopp: ['', '', ''],
  cc_ref_M2: ['', '', ''],

  // показания рабочей камеры
  cc_fld_polarity: '+',
  cc_fld_V1: '300',
  cc_fld_V2: '100',
  cc_fld_M1: ['', '', ''],
  cc_fld_Mem: ['', '', ''],
  cc_fld_Mopp: ['', '', ''],
  cc_fld_M2: ['', '', ''],
};

export const CC_SERIES = ['cc_ref_M1', 'cc_ref_Mem', 'cc_ref_Mopp', 'cc_ref_M2', 'cc_fld_M1', 'cc_fld_Mem', 'cc_fld_Mopp', 'cc_fld_M2'];

const REF = {
  trs: 'TRS-398 Rev.1',
  r385: 'Report 385',
  tg51: 'TG-51 (1999)',
  r374: 'WGTG51 Report 374',
};

const cap = (s) => (/^[a-z][_′]/.test(s) ? s : s[0].toUpperCase() + s.slice(1));

export function normalizeCrossCal(input) {
  const f = { ...CC_DEFAULTS, ...input };
  if (f.protocol !== 'tg51') f.protocol = 'trs';
  if (!BEAM_TYPES.includes(f.cc_beam_type)) f.cc_beam_type = 'electrons';
  if (f.cc_method !== 'side' || f.cc_beam_type === 'electrons') f.cc_method = 'sub';
  for (const k of CC_SERIES) {
    if (!Array.isArray(f[k])) f[k] = isBlank(f[k]) ? ['', '', ''] : String(f[k]).trim().split(/[\s;]+/);
  }
  if (!Array.isArray(f.cc_staff) || f.cc_staff.length === 0) f.cc_staff = [''];
  return f;
}

/**
 * Камера из базы или «другая» с характеристиками из формы. who — 'ref' | 'fld'.
 * Базы: электроны — electron-chambers.js; МВ фотоны — chambers.js (цилиндрические);
 * ⁶⁰Co — цилиндрические из chambers.js и плоскопараллельные из electron-chambers.js с префиксом «PP:».
 */
export function resolveCcChamber(f, who) {
  const id = String(f[`cc_${who}_model`] ?? '');
  const type = f.cc_beam_type;
  const lengthIn = parseNumber(f[`cc_${who}_length`]);
  if (!id) return null;
  if (id === 'OTHER') {
    const r = parseNumber(f[`cc_${who}_other_r`]);
    return {
      id: 'OTHER',
      other: true,
      maker: '',
      model: f[`cc_${who}_other_name`] || L('другая камера', 'other chamber'),
      type: type === 'photons' ? 'cyl' : f[`cc_${who}_other_type`] === 'pp' ? 'pp' : 'cyl',
      trsRcylMm: Number.isFinite(r) ? r : NaN,
      lengthMm: lengthIn,
    };
  }
  if (type === 'electrons') return findEChamber(id);
  if (type === 'co60' && id.startsWith(PP_PREFIX)) {
    const c = findEChamber(id.slice(PP_PREFIX.length));
    return c && c.type === 'pp' ? c : null;
  }
  const c = findChamber(id);
  if (!c) return null;
  return { ...c, type: 'cyl', lengthMm: Number.isFinite(lengthIn) ? lengthIn : c.lengthMm, lengthFromDb: !Number.isFinite(lengthIn) && Number.isFinite(c.lengthMm) };
}

export const ccChamberLabel = (c) => (c ? (c.other ? c.model : chamberLabel(c)) : '');

/** Положение камеры на опорной глубине: электроны — как на вкладке «Электроны»; ⁶⁰Co — табл. 12; фотоны — табл. 15. */
function positionsFor(type, c, zref) {
  if (!c) return null;
  if (type === 'electrons') return positions(c, zref);
  const z = Number.isFinite(zref) ? ru(zref, 0) : '—';
  const text =
    c.type === 'pp'
      ? L(`точка измерения — внутренняя поверхность входного окна — на z_ref = ${z} г/см² по оси пучка`, `point of measurement (inner surface of the entrance window) at z_ref = ${z} g/cm² on the beam axis`)
      : L(`центр полости камеры на z_ref = ${z} г/см² по оси пучка`, `center of the chamber cavity at z_ref = ${z} g/cm² on the beam axis`);
  return { trs: { text }, tg51: { text } };
}

function maxRelDeviation(series) {
  if (!series || series.n < 2 || !series.mean) return 0;
  return Math.max(...series.values.map((v) => Math.abs(v - series.mean) / Math.abs(series.mean)));
}

/** Значимых цифр достаточно, чтобы при переносе в другую вкладку не терять точность. */
export const transferNumber = (v) => (Number.isFinite(v) ? dec(Number(v.toPrecision(6)).toString()) : '');

export function computeCrossCal(form) {
  const f = normalizeCrossCal(form);
  const type = f.cc_beam_type;
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
    if (!Number.isFinite(v)) {
      add('error', scope, isBlank(f[key]) ? L(`Не заполнено поле «${label}».`, `Field "${label}" is empty.`) : L(`Не удалось прочитать число в поле «${label}».`, `Could not read the number in field "${label}".`), null, key);
    }
    return v;
  };
  const readCells = (key, label) => {
    const s = parseCells(f[key]);
    if (s.error) add('error', 'common', L(`«${label.ru}»: ${s.error}.`, `"${label.en}": ${s.error}.`), null, key);
    else if (s.n === 0) add('error', 'common', L(`Не заполнено поле «${label.ru}».`, `Field "${label.en}" is empty.`), null, key);
    else if (s.mean === 0) add('error', 'common', L(`«${label.ru}»: среднее показание равно нулю.`, `"${label.en}": the mean reading is zero.`), null, key);
    return s;
  };

  // TG-51 описывает перекрёстную калибровку только для электронов (Report 385, разд. 5.3.2)
  const want51 = f.protocol === 'tg51' && type === 'electrons';
  const wantTRS = !want51;
  const protocolUsed = want51 ? 'tg51' : 'trs';
  if (f.protocol === 'tg51' && type !== 'electrons') {
    add('info', 'common', L(
      'TG-51 и его аддендумы не описывают перекрёстную калибровку в пучках ⁶⁰Co и МВ фотонов: здесь расчёт всегда по TRS-398 Rev.1.',
      'TG-51 and its addenda do not describe cross-calibration in ⁶⁰Co and MV photon beams: here the calculation always follows TRS-398 Rev.1.',
    ), `${REF.trs}, разд. 4.5`);
  }
  const linac = type !== 'co60';

  // ---------------------------------------------------------- 1. пучок перекрёстной калибровки
  const quality = { type };
  let r50 = NaN;
  let tpr = NaN;
  let zref = NaN;
  if (type === 'electrons') {
    quality.method = f.cc_r50_method;
    if (f.cc_r50_method === 'r50') {
      r50 = read('cc_r50', 'R50');
      quality.equation = L('R50 введён (измерен детектором, отвечающим дозе, или известен)', 'R50 entered (measured with a dose-responding detector, or known)');
    } else {
      const i50 = read('cc_i50', 'R50,ion (I50)');
      if (Number.isFinite(i50)) {
        if (i50 <= 0) add('error', 'common', L('R50,ion должен быть больше нуля.', 'R50,ion must be greater than zero.'), null, 'cc_i50');
        const r = r50FromI50(i50);
        r50 = r.value;
        quality.i50 = i50;
        quality.equation = r.equation;
      }
    }
    if (Number.isFinite(r50) && (r50 <= 0.3 || r50 > 15)) {
      add('error', 'common', L(
        `R50 = ${ru(r50, 2)} г/см² неправдоподобен: вводится в г/см² (см), например 7,6 для пучка 18 МэВ.`,
        `R50 = ${ru(r50, 2)} g/cm² is implausible: enter it in g/cm² (cm), e.g. 7.6 for an 18 MeV beam.`,
      ), null, ['cc_r50', 'cc_i50']);
      r50 = NaN;
    }
    zref = Number.isFinite(r50) ? zrefFromR50(r50) : NaN;
    quality.E0 = 2.33 * r50;
    if (Number.isFinite(r50)) {
      if (wantTRS && r50 < 7) {
        add('warn', 'trs', L(
          `Для перекрёстной калибровки TRS-398 рекомендует пучок электронов наибольшей энергии, с R50 > 7 г/см² (E₀ > 16 МэВ); сейчас R50 = ${ru(r50, 2)} г/см².`,
          `For cross-calibration, TRS-398 recommends the highest-energy electron beam, with R50 > 7 g/cm² (E₀ > 16 MeV); now R50 = ${ru(r50, 2)} g/cm².`,
        ), `${REF.trs}, разд. 7.6.1`, ['cc_r50', 'cc_i50']);
      }
      if (want51 && quality.E0 <= 10) {
        add('warn', 'tg51', L(
          `TG-51 и Report 385 проводят перекрёстную калибровку в пучке электронов высокой энергии (выше 10 МэВ); сейчас E₀ ≈ ${ru(quality.E0, 1)} МэВ.`,
          `TG-51 and Report 385 perform the cross-calibration in a high-energy electron beam (above 10 MeV); now E₀ ≈ ${ru(quality.E0, 1)} MeV.`,
        ), `${REF.tg51}, разд. X.C; ${REF.r385}, разд. 5.1, 5.3.2`, ['cc_r50', 'cc_i50']);
      }
    }
  } else if (type === 'photons') {
    quality.method = f.cc_tpr_method;
    if (f.cc_tpr_method === 'pdd2010') {
      const p20 = read('cc_pdd20', 'PDD(20)');
      const p10 = read('cc_pdd10', 'PDD(10)');
      if (Number.isFinite(p20) && Number.isFinite(p10) && p10 > 0) {
        quality.pdd2010 = p20 / p10;
        tpr = TRS.tprFromPdd2010(quality.pdd2010);
        quality.equation = L('TPR20,10 = 1,2661·PDD20,10 − 0,0595 (сноска 36 TRS-398)', 'TPR20,10 = 1.2661·PDD20,10 − 0.0595 (TRS-398 footnote 36)');
      }
    } else {
      tpr = read('cc_tpr', 'TPR20,10');
      quality.equation = L('TPR20,10 введён', 'TPR20,10 entered');
    }
    if (Number.isFinite(tpr) && (tpr < 0.5 || tpr > 0.9)) {
      add('error', 'common', L(`TPR20,10 = ${ru(tpr, 3)} неправдоподобно: для МВ фотонов обычно 0,62–0,80.`, `TPR20,10 = ${ru(tpr, 3)} is implausible: for MV photons it is usually 0.62–0.80.`), null, ['cc_tpr', 'cc_pdd20', 'cc_pdd10']);
      tpr = NaN;
    }
    zref = 10;
  } else {
    zref = parseNumber(f.cc_co_zref);
    if (zref !== 5 && zref !== 10) add('error', 'common', L('TRS-398 допускает для ⁶⁰Co z_ref = 5 или 10 г/см².', 'TRS-398 allows z_ref = 5 or 10 g/cm² for ⁶⁰Co.'), `${REF.trs}, табл. 12`, 'cc_co_zref');
  }
  quality.r50 = r50;
  quality.tpr = tpr;
  quality.zref = zref;
  const fff = type === 'photons' && !!f.cc_fff;
  quality.fff = fff;

  // облучение: МЕ у ускорителя, время у аппарата ⁶⁰Co
  const amount = linac ? read('cc_mu', L('Облучение, МЕ', 'Irradiation, MU')) : read('cc_time', L('Время облучения', 'Irradiation time'));
  if (Number.isFinite(amount) && amount <= 0) add('error', 'common', linac ? L('Число МЕ должно быть больше нуля.', 'The number of MU must be greater than zero.') : L('Время облучения должно быть больше нуля.', 'The irradiation time must be greater than zero.'), null, linac ? 'cc_mu' : 'cc_time');
  if (f.cc_method === 'side') {
    add('info', 'common', L(
      'Установка «бок о бок»: камеры облучают одновременно, затем меняют местами и повторяют; для каждой камеры вводятся показания из обоих положений — в расчёт входит среднее. Внешний монитор не нужен, если профиль пучка достаточно однороден.',
      'Side-by-side setup: the chambers are irradiated simultaneously, then swapped and the measurement repeated; enter the readings of each chamber from both positions — their mean is used. No external monitor is needed if the beam profile is sufficiently uniform.',
    ), `${REF.trs}, разд. 4.5, сноска 28; разд. 6.6`);
  } else if (type === 'photons' && !f.cc_monitor) {
    add('info', 'common', L(
      'При замещении TRS-398 советует делить показания на показания внешнего монитора (в фантоме примерно на z_ref, в 3–4 см от камеры): так учитывается нестабильность выхода ускорителя.',
      'For the substitution method, TRS-398 recommends dividing the readings by those of an external monitor (in the phantom at about z_ref, 3–4 cm from the chamber): this accounts for linac output instability.',
    ), `${REF.trs}, разд. 6.6`, 'cc_monitor');
  }

  // ---------------------------------------------------------- 2–3. камеры
  const ref = resolveCcChamber(f, 'ref');
  const fld = resolveCcChamber(f, 'fld');
  if (isBlank(f.cc_ref_model) || !ref) add('error', 'common', L('Выберите опорную камеру.', 'Select the reference chamber.'), null, 'cc_ref_model');
  if (isBlank(f.cc_fld_model) || !fld) add('error', 'common', L('Выберите рабочую камеру.', 'Select the field chamber.'), null, 'cc_fld_model');
  if (ref && fld && !ref.other && ref.id === fld.id && !isBlank(f.cc_ref_serial) && String(f.cc_ref_serial).trim() === String(f.cc_fld_serial).trim()) {
    add('error', 'common', L('Опорная и рабочая камеры совпадают (та же модель и тот же номер).', 'The reference and field chambers are the same (same model and serial number).'), null, ['cc_ref_serial', 'cc_fld_serial']);
  }
  if (type === 'electrons') {
    for (const [c, key] of [[ref, 'cc_ref_other_r'], [fld, 'cc_fld_other_r']]) {
      if (wantTRS && c?.other && c.type === 'cyl' && !Number.isFinite(c.trsRcylMm)) {
        add('warn', 'trs', L('Укажите радиус полости: по TRS-398 центр цилиндрической камеры ставят на 0,5·r_cyl глубже z_ref.', 'Enter the cavity radius: per TRS-398, the center of a cylindrical chamber is placed 0.5·r_cyl deeper than z_ref.'), `${REF.trs}, табл. 19`, key);
      }
    }
  }
  if (type === 'electrons' && wantTRS && ref && ref.type === 'pp') {
    add('info', 'trs', L(
      'Опорная камера плоскопараллельная. TRS-398 описывает перекрёстную калибровку по опорной цилиндрической камере, откалиброванной в ⁶⁰Co (разд. 7.6, рис. 6); ур. (41) допускает и плоскопараллельную, если известен её k_Q (табл. 20 — Roos, NACP-02 — или измеренный в лаборатории). Сами плоскопараллельные камеры TRS-398 советует калибровать в пучке электронов (разд. 7.2.1).',
      'The reference chamber is plane-parallel. TRS-398 describes cross-calibration against a cylindrical reference chamber calibrated in ⁶⁰Co (Sec. 7.6, Fig. 6); Eq. (41) also allows a plane-parallel one if its k_Q is known (Table 20 for Roos and NACP-02, or measured by a laboratory). TRS-398 advises calibrating plane-parallel chambers themselves in an electron beam (Sec. 7.2.1).',
    ), `${REF.trs}, разд. 7.2.1, 7.6`, 'cc_ref_model');
  }
  if (want51) {
    if (ref && ref.type === 'pp') {
      add('error', 'tg51', L(
        'Report 385 предусматривает перекрёстную калибровку плоскопараллельной камеры по откалиброванной в ⁶⁰Co цилиндрической: опорной должна быть цилиндрическая камера.',
        'Report 385 provides cross-calibration of a plane-parallel chamber against a cylindrical chamber calibrated in ⁶⁰Co: the reference chamber must be cylindrical.',
      ), `${REF.r385}, разд. 5.3.2`, 'cc_ref_model');
    }
    if (fld && fld.type === 'cyl') {
      add('error', 'tg51', L(
        'Report 385 предусматривает перекрёстную калибровку только плоскопараллельной камеры; цилиндрическую камеру калибруют в ⁶⁰Co.',
        'Report 385 provides cross-calibration only of a plane-parallel chamber; a cylindrical chamber is calibrated in ⁶⁰Co.',
      ), `${REF.r385}, разд. 5.3.1–5.3.2`, 'cc_fld_model');
    }
  }
  if (type === 'electrons' && wantTRS && fld && !fld.other && fld.type === 'pp' && !fld.trsT21) {
    add('warn', 'trs', L(
      `Для ${chamberLabel(fld)} в табл. 21 TRS-398 нет k_Q,Qint: при работе с перекрёстно откалиброванной камерой k_Q,Qcross придётся вводить вручную.`,
      `TRS-398 Table 21 gives no k_Q,Qint for ${chamberLabel(fld)}: when the cross-calibrated chamber is used, k_Q,Qcross will have to be entered manually.`,
    ), `${REF.trs}, разд. 7.6.2, табл. 21`, 'cc_fld_model');
  }
  if (type === 'photons') {
    if (fld && !fld.other && !fld.trs) {
      add('warn', 'trs', L(
        `Для ${chamberLabel(fld)} в TRS-398 Rev.1 нет k_Q: при работе этой камерой в других пучках k_Q,Qcross придётся вводить вручную.`,
        `TRS-398 Rev.1 gives no k_Q for ${chamberLabel(fld)}: when this chamber is used in other beams, k_Q,Qcross will have to be entered manually.`,
      ), `${REF.trs}, разд. 4.5.3, табл. 16`, 'cc_fld_model');
    }
    // камеры, включённые в TRS-398 Rev.1 только для пучков БВФ (табл. 4; табл. 16, прим. b)
    for (const [c, key] of [[ref, 'cc_ref_model'], [fld, 'cc_fld_model']]) {
      const n = (c?.notes || []).find((x) => x.scope === 'trs' && x.fffOnly);
      if (n && !fff) add('warn', 'trs', `${noteText(n)} ${L('Для пучков с выравнивающим фильтром TRS-398 Rev.1 её не предусматривает.', 'TRS-398 Rev.1 does not provide for it in beams with a flattening filter.')}`, `${REF.trs}, табл. 4, 16`, key);
    }
  }
  const pos = { ref: positionsFor(type, ref, zref), fld: positionsFor(type, fld, zref) };

  const ndwRaw = read('cc_ref_ndw', L('N_D,w опорной камеры', 'N_D,w of the reference chamber'));
  const ndwCert = Number.isFinite(ndwRaw) ? ndwToGyPerNC(ndwRaw, f.cc_ref_ndw_unit) : NaN;
  if (Number.isFinite(ndwCert) && (ndwCert < 1e-3 || ndwCert > 5)) {
    add('warn', 'common', L(`N_D,w = ${dec(ndwCert.toPrecision(4))} Гр/нКл выглядит неправдоподобно: проверьте единицы.`, `N_D,w = ${dec(ndwCert.toPrecision(4))} Gy/nC looks implausible: check the units.`), null, 'cc_ref_ndw');
  }
  // поправочный множитель из протокола поверки (ВНИИФТРИ): N_D,w умножается на него; пусто — 1
  const klab = isBlank(f.cc_ref_klab) ? 1 : parseNumber(f.cc_ref_klab);
  if (!Number.isFinite(klab) || klab <= 0) add('error', 'common', L('Не удалось прочитать k_лаб: введите поправочный множитель из протокола поверки (обычно 1,000).', 'Could not read k_lab: enter the correction multiplier from the calibration certificate (usually 1.000).'), null, 'cc_ref_klab');
  else if (Math.abs(klab - 1) > 0.05) add('warn', 'common', L('k_лаб отличается от 1 больше чем на 5 %: проверьте протокол поверки.', 'k_lab differs from 1 by more than 5%: check the calibration certificate.'), null, 'cc_ref_klab');
  const ndw = ndwCert * klab;
  const T0 = read('cc_T0', L('T₀ из сертификата', 'T₀ from the certificate'));
  const P0 = read('cc_P0', L('P₀ из сертификата', 'P₀ from the certificate'));
  if (Number.isFinite(T0) && (T0 < 15 || T0 > 25)) add('error', 'common', L('T₀ задаётся в °C (обычно 20 или 22).', 'T₀ is entered in °C (usually 20 or 22).'), null, 'cc_T0');
  if (Number.isFinite(P0) && (P0 < 95 || P0 > 105)) add('warn', 'common', L('P₀ задаётся в кПа (обычно 101,325 или 101,33).', 'P₀ is entered in kPa (usually 101.325 or 101.33).'), null, 'cc_P0');
  const kelec = {};
  for (const [who, name] of [['ref', L('опорной камеры', 'of the reference chamber')], ['fld', L('рабочей камеры', 'of the field chamber')]]) {
    const key = `cc_${who}_kelec`;
    kelec[who] = read(key, L(`k_elec ${name}`, `k_elec ${name}`));
    if (Number.isFinite(kelec[who]) && Math.abs(kelec[who] - 1) > 0.02) add('warn', 'common', L('k_elec отличается от 1 больше чем на 2 %: проверьте сертификат электрометра.', 'k_elec differs from 1 by more than 2 %: check the electrometer calibration certificate.'), null, key);
  }
  if (want51 && Number.isFinite(kelec.fld) && Math.abs(kelec.fld - 1) > 1e-9) {
    add('info', 'tg51', L(
      'TG-51 принимает P_elec = 1 для перекрёстно откалиброванной плоскопараллельной камеры: он сокращается. Другое значение оставьте, только если его же будете применять к показаниям этой камеры и дальше (оно переносится во вкладку «Электроны»).',
      'TG-51 takes P_elec = 1 for a cross-calibrated plane-parallel chamber, since it cancels out. Keep a different value only if you will apply the same value to this chamber’s readings later (it is transferred to the Electrons tab).',
    ), `${REF.tg51}, разд. VII.B`, 'cc_fld_kelec');
  }

  // ---------------------------------------------------------- 4. температура и давление
  const T = read('cc_T', L('Температура воды', 'Water temperature'));
  const Pin = read('cc_P', L('Давление', 'Pressure'));
  const P = Number.isFinite(Pin) ? pressureToKPa(Pin, f.cc_P_unit) : NaN;
  if (Number.isFinite(P) && (P < 50 || P > 110)) add('error', 'common', L(`Давление ${ru(P, 2)} кПа вне правдоподобного диапазона: проверьте единицы.`, `Pressure ${ru(P, 2)} kPa is outside the plausible range: check the units.`), null, 'cc_P');
  const env = environmentChecks({ T, Hraw: f.cc_H, keyT: 'cc_T', keyH: 'cc_H', parseNumber, isBlank, ru });
  env.items.forEach(([level, text, r, key]) => add(level, 'common', text, r, key));
  let T2 = T;
  let P2 = P;
  if (!isBlank(f.cc_T2)) {
    T2 = read('cc_T2', L('Температура воды при измерении рабочей камерой', 'Water temperature during the field chamber measurement'));
    if (Number.isFinite(T2) && (T2 < 5 || T2 > 40)) add('error', 'common', L(`Температура воды ${ru(T2, 1)} °C неправдоподобна.`, `Water temperature ${ru(T2, 1)} °C is implausible.`), null, 'cc_T2');
  }
  if (!isBlank(f.cc_P2)) {
    const v = read('cc_P2', L('Давление при измерении рабочей камерой', 'Pressure during the field chamber measurement'));
    P2 = Number.isFinite(v) ? pressureToKPa(v, f.cc_P_unit) : NaN;
    if (Number.isFinite(P2) && (P2 < 50 || P2 > 110)) add('error', 'common', L(`Давление ${ru(P2, 2)} кПа вне правдоподобного диапазона: проверьте единицы.`, `Pressure ${ru(P2, 2)} kPa is outside the plausible range: check the units.`), null, 'cc_P2');
  }
  const separateTP = !isBlank(f.cc_T2) || !isBlank(f.cc_P2);

  // ---------------------------------------------------------- 5–6. показания
  const seriesOk = (x) => x && x.n > 0 && !x.error && x.mean !== 0;
  const readings = (who) => {
    const name = who === 'ref' ? { ru: 'опорная камера', en: 'reference chamber' } : { ru: 'рабочая камера', en: 'field chamber' };
    const k = (s) => `cc_${who}_${s}`;
    const V1 = read(k('V1'), L(`V₁ (${name.ru})`, `V₁ (${name.en})`));
    const V2 = read(k('V2'), L(`V₂ (${name.ru})`, `V₂ (${name.en})`));
    if (Number.isFinite(V1) && Number.isFinite(V2) && Math.abs(V1) <= Math.abs(V2)) add('error', 'common', L(`Рабочее напряжение V₁ должно быть больше пониженного V₂ (${name.ru}).`, `The operating voltage V₁ must be higher than the reduced voltage V₂ (${name.en}).`), null, [k('V1'), k('V2')]);
    const M1 = readCells(k('M1'), { ru: `${cap(name.ru)}: M при V₁, обычная полярность`, en: `${cap(name.en)}: M at V₁, normal polarity` });
    const Mopp = readCells(k('Mopp'), { ru: `${cap(name.ru)}: M при V₁, обратная полярность`, en: `${cap(name.en)}: M at V₁, opposite polarity` });
    const M2 = readCells(k('M2'), { ru: `${cap(name.ru)}: M при V₂`, en: `${cap(name.en)}: M at V₂` });
    const who2 = L(name.ru, name.en);
    for (const [s, label, key] of [[M1, L('при V₁', 'at V₁'), k('M1')], [Mopp, L('обратной полярности', 'at opposite polarity'), k('Mopp')], [M2, L('при V₂', 'at V₂'), k('M2')]]) {
      const d = maxRelDeviation(s);
      const pct = ru(d * 100, 2);
      if (d > 0.05) add('error', 'common', L(`${cap(who2)}: показания ${label} расходятся на ${pct} % от среднего — вероятно, ошибка ввода.`, `${cap(who2)}: readings ${label} differ from the mean by up to ${pct} % — probably a data-entry error.`), null, key);
      else if (d > 0.005) {
        const tip = f.cc_monitor && key === k('M1') ? L(' Показания нормируются на монитор, но разброс самих показаний стоит проверить.', ' The readings are normalized to the monitor, but the spread of the readings themselves is worth checking.') : L(' Повторите облучения; при дрейфе выхода ускорителя повторите и измерение другой камерой.', ' Repeat the exposures; if the output drifts, repeat the measurement with the other chamber as well.');
        add('warn', 'common', L(`${cap(who2)}: разброс показаний ${label} до ${pct} % от среднего.`, `${cap(who2)}: spread of readings ${label} up to ${pct} % of the mean.`) + tip, `${REF.r374}, разд. 4.4.2`, key);
      } else if (d > 0.001) add('info', 'common', L(`${cap(who2)}: разброс показаний ${label} до ${pct} % от среднего. Report 374 советует добиваться ±0,1 % без тренда.`, `${cap(who2)}: spread of readings ${label} up to ${pct} % of the mean. Report 374 recommends reaching ±0.1 % with no trend.`), `${REF.r374}, разд. 4.4.2`, key);
    }
    const ok = seriesOk(M1);
    // нормировка на внешний монитор: отношения M₁ᵢ/M_emᵢ по парам облучений
    let monitor = null;
    if (f.cc_monitor) {
      const raw = Array.isArray(f[k('M1')]) ? f[k('M1')] : [];
      const em = Array.isArray(f[k('Mem')]) ? f[k('Mem')] : [];
      const pairs = [];
      let bad = false;
      const n = Math.max(raw.length, em.length);
      for (let i = 0; i < n; i++) {
        const a = isBlank(raw[i]) ? NaN : parseNumber(raw[i]);
        const b = isBlank(em[i]) ? NaN : parseNumber(em[i]);
        if (isBlank(raw[i]) && isBlank(em[i])) continue;
        if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) {
          bad = true;
          continue;
        }
        pairs.push([Math.abs(a), Math.abs(b)]);
      }
      if (bad) add('error', 'common', L(`${cap(who2)}: для каждого показания M₁ нужно показание монитора за то же облучение (ячейки по порядку).`, `${cap(who2)}: each reading M₁ needs a monitor reading from the same exposure (cells in the same order).`), null, k('Mem'));
      else if (!pairs.length) add('error', 'common', L(`${cap(who2)}: не заполнены показания монитора.`, `${cap(who2)}: the monitor readings are empty.`), null, k('Mem'));
      if (pairs.length && !bad) {
        const ratios = pairs.map(([a, b]) => a / b);
        const rMean = ratios.reduce((s, x) => s + x, 0) / ratios.length;
        const emVals = pairs.map(([, b]) => b);
        monitor = { n: pairs.length, ratio: rMean, emMean: emVals.reduce((s, x) => s + x, 0) / emVals.length, emValues: emVals };
        const d = Math.max(...ratios.map((x) => Math.abs(x / rMean - 1)));
        if (d > 0.005) add('warn', 'common', L(`${cap(who2)}: разброс отношений M₁/M_монитор до ${ru(d * 100, 2)} %.`, `${cap(who2)}: spread of the M₁/M_monitor ratios up to ${ru(d * 100, 2)} %.`), `${REF.r374}, разд. 4.4.2`, k('Mem'));
      }
    }
    let kpol = NaN;
    if (ok && seriesOk(Mopp)) {
      kpol = polarity(M1.mean, Mopp.mean);
      const dpol = Math.abs(kpol - 1);
      const nm = L(`k_pol (${name.ru})`, `k_pol (${name.en})`);
      if (type === 'electrons') {
        if (dpol > 0.02) add('warn', 'common', L(`${nm} = ${ru(kpol, 4)}: эффект полярности больше 2 % — больше, чем допускает Report 385 для камеры эталонного класса. Проверьте камеру, кабель и время стабилизации.`, `${nm} = ${ru(kpol, 4)}: the polarity effect exceeds 2 %, more than Report 385 allows for a reference-class chamber. Check the chamber, the cable and the stabilization time.`), `${REF.r385}, табл. A1; ${REF.trs}, табл. 3`, `kpol_${who}`);
        else if (dpol > 0.004) add('info', 'common', L(`${nm} = ${ru(kpol, 4)}: в пучках электронов эффект полярности бывает больше, чем в фотонных, поэтому поправку измеряют для каждой камеры.`, `${nm} = ${ru(kpol, 4)}: in electron beams the polarity effect can be larger than in photon beams, so the correction is measured for each chamber.`), `${REF.r385}, прил. A; ${REF.trs}, табл. 3`, `kpol_${who}`);
      } else if (dpol > 0.004) {
        add('warn', 'common', L(`${nm} = ${ru(kpol, 4)}: эффект полярности больше 0,4 % — больше, чем допускает TRS-398 для камеры эталонного класса.`, `${nm} = ${ru(kpol, 4)}: the polarity effect exceeds 0.4 %, more than TRS-398 allows for a reference-class chamber.`), `${REF.trs}, табл. 3`, `kpol_${who}`);
      }
    }
    const nV = Math.abs(V1) / Math.abs(V2);
    const recOk = ok && seriesOk(M2) && Number.isFinite(nV) && nV > 1;
    if (ok && M2.n > 0 && !M2.error && Math.sign(M1.mean) !== Math.sign(M2.mean)) add('error', 'common', L(`${cap(name.ru)}: показания при V₁ и V₂ снимают при одной и той же (обычной) полярности.`, `${cap(name.en)}: readings at V₁ and V₂ are taken at the same (normal) polarity.`), null, k('M2'));
    const ratio12 = recOk ? Math.abs(M1.mean) / Math.abs(M2.mean) : NaN;
    if (recOk && ratio12 < 1) add('error', 'common', L(`${cap(name.ru)}: k_s (P_ion) не может быть меньше 1 — при пониженном напряжении собирается меньше заряда. Проверьте показания и напряжения.`, `${cap(name.en)}: k_s (P_ion) cannot be less than 1 — less charge is collected at the reduced voltage. Check the readings and voltages.`), `${REF.trs}, разд. 4.4.3.4`, [`ks_${who}`, `Pion_${who}`, k('M2')]);
    return { V1, V2, nV, M1, Mopp, M2, m1raw: ok ? Math.abs(M1.mean) : NaN, monitor, kpol, recOk, ratio12, name };
  };
  const rd = { ref: readings('ref'), fld: readings('fld') };
  // показание, которое входит в расчёт: среднее M₁ или, с монитором, среднее M₁/M_монитор, умноженное
  // на среднее показание монитора по обеим камерам (масштаб в нКл; на отношение M_ref/M_field не влияет)
  let emBar = NaN;
  if (f.cc_monitor && rd.ref.monitor && rd.fld.monitor) {
    const all = [...rd.ref.monitor.emValues, ...rd.fld.monitor.emValues];
    emBar = all.reduce((s, x) => s + x, 0) / all.length;
  }
  for (const who of ['ref', 'fld']) {
    const x = rd[who];
    x.m1 = f.cc_monitor ? (x.monitor ? x.monitor.ratio * emBar : NaN) : x.m1raw;
  }

  // ---------------------------------------------------------- рекомбинация
  const recombination = (who, scope) => {
    const x = rd[who];
    const nm = (q) => L(`${q} (${x.name.ru})`, `${q} (${x.name.en})`);
    const who2 = cap(L(x.name.ru, x.name.en));
    if (!x.recOk) return NaN;
    if (scope === 'trs') {
      let value;
      if (type === 'co60' && f.cc_rec_co === 'eq16') {
        value = (x.nV * x.nV - 1) / (x.nV * x.nV - x.ratio12);
        x.ksEquation = L('ур. (16): k_s = (n² − 1)/(n² − M₁/M₂), общая рекомбинация в непрерывном пучке', 'Eq. (16): k_s = (n² − 1)/(n² − M₁/M₂), general recombination in a continuous beam');
      } else {
        const r = TRS.ks({ m1: x.M1.mean, m2: x.M2.mean, v1: Math.abs(x.V1), v2: Math.abs(x.V2), beam: type === 'co60' ? 'pulsed' : f.cc_beam_mode });
        value = r.value;
        x.ksEquation = type === 'co60' ? L(`${r.equation}; в непрерывном пучке преобладает начальная рекомбинация (разд. 4.4.3.4 b)`, `${r.equation}; initial recombination dominates in a continuous beam (Sec. 4.4.3.4 b)`) : r.equation;
        if (r.error) add('error', 'trs', `${who2}: ${r.error}.`, `${REF.trs}, табл. 10`, `ks_${who}`);
        r.notes.forEach((n) => add('warn', 'trs', `${who2}: ${n}.`, `${REF.trs}, разд. 4.4.3.4`, `ks_${who}`));
      }
      if (linac && x.nV < 3 - 1e-9) add('info', 'trs', L(`${who2}: TRS-398 рекомендует отношение напряжений V₁/V₂ ≥ 3.`, `${who2}: TRS-398 recommends a voltage ratio V₁/V₂ ≥ 3.`), `${REF.trs}, разд. 4.4.3.4`);
      if (value > 1.05) add('error', 'trs', L(`${nm('k_s')} = ${ru(value, 4)} > 1,05: метод двух напряжений неприменим.`, `${nm('k_s')} = ${ru(value, 4)} > 1.05: the two-voltage method is not applicable.`), `${REF.trs}, табл. 3`, `ks_${who}`);
      if (x.ratio12 >= 1 && value < 1) add('error', 'trs', L(`${nm('k_s')} = ${ru(value, 4)} < 1: так быть не может, проверьте показания и напряжения.`, `${nm('k_s')} = ${ru(value, 4)} < 1 is impossible: check the readings and the voltages.`), `${REF.trs}, разд. 4.4.3.4`, `ks_${who}`);
      return value;
    }
    const v = TG51.pIon({ mH: x.M1.mean, mL: x.M2.mean, vH: Math.abs(x.V1), vL: Math.abs(x.V2), beam: 'pulsed' });
    if (x.nV < 2 - 1e-9) add('warn', 'tg51', L(`${who2}: по TG-51 пониженное напряжение должно быть меньше рабочего как минимум вдвое.`, `${who2}: per TG-51, the reduced voltage must be at most half the operating voltage.`), `${REF.tg51}, разд. VII.D.2`, [`cc_${who}_V1`, `cc_${who}_V2`]);
    if (v > 1.05) add('error', 'tg51', L(`${nm('P_ion')} = ${ru(v, 4)} > 1,05: нужна другая камера.`, `${nm('P_ion')} = ${ru(v, 4)} > 1.05: use a different chamber.`), `${REF.tg51}, разд. VII.D.1`, `Pion_${who}`);
    if (x.ratio12 >= 1 && v < 1) add('error', 'tg51', L(`${nm('P_ion')} = ${ru(v, 4)} < 1: так быть не может, проверьте показания и напряжения.`, `${nm('P_ion')} = ${ru(v, 4)} < 1 is impossible: check the readings and the voltages.`), `${REF.tg51}, разд. VII.D`, `Pion_${who}`);
    return v;
  };

  // ---------------------------------------------------------- k_vol для пучка БВФ (фотоны), ур. (22)
  const kvol = { ref: 1, fld: 1 };
  quality.sdd = NaN;
  if (fff) {
    const sdd = read('cc_sdd', L('РИД для k_vol', 'SDD for k_vol'));
    quality.sdd = sdd;
    if (Number.isFinite(sdd) && (sdd < 50 || sdd > 200)) add('error', 'common', L('РИД задаётся в сантиметрах (обычно 110 при РИП 100 см).', 'SDD is entered in centimeters (usually 110 for SSD 100 cm).'), null, 'cc_sdd');
    for (const [who, c] of [['ref', ref], ['fld', fld]]) {
      const len = c?.lengthMm;
      if (!c) kvol[who] = NaN;
      else if (!Number.isFinite(len)) {
        add('error', 'common', L(`Укажите длину полости ${who === 'ref' ? 'опорной' : 'рабочей'} камеры: она нужна для k_vol в пучке БВФ (ур. 22).`, `Enter the cavity length of the ${who === 'ref' ? 'reference' : 'field'} chamber: it is needed for k_vol in an FFF beam (Eq. 22).`), `${REF.trs}, ур. (22)`, `cc_${who}_length`);
        kvol[who] = NaN;
      } else if (len <= 0 || len > 40) {
        add('error', 'common', L('Длина полости задаётся в миллиметрах (например, 23 для Фармера).', 'The cavity length is entered in millimeters (e.g. 23 for a Farmer chamber).'), null, `cc_${who}_length`);
        kvol[who] = NaN;
      } else kvol[who] = Number.isFinite(tpr) && Number.isFinite(sdd) ? TRS.kvolGeneric({ tpr, lengthCm: len / 10, sddCm: sdd }) : NaN;
    }
    add('info', 'trs', L(
      'Пучок БВФ: показания обеих камер исправлены на усреднение по объёму k_vol по ур. (22). Если длины полостей камер различаются, k_vol у них разный.',
      'FFF beam: the readings of both chambers are corrected for volume averaging k_vol by Eq. (22). If the cavity lengths differ, so does k_vol.',
    ), `${REF.trs}, разд. 4.4.3.5, ур. (22)`);
  }

  const r50ok = Number.isFinite(r50);
  const corrected = (who, kTP, krec) => rd[who].m1 * kTP * kelec[who] * rd[who].kpol * krec * kvol[who];

  // ------------------------------------------------------------- TRS-398: ур. (25)/(32)/(36), (27), (41)
  const trs = { enabled: wantTRS };
  if (wantTRS) {
    for (const who of ['ref', 'fld']) {
      const x = (trs[who] = {});
      x.kTP = temperaturePressure({ T: who === 'ref' ? T : T2, P: who === 'ref' ? P : P2, T0, P0, abs0: TRS.TRS_ABS0 });
      x.kelec = kelec[who];
      x.kpol = rd[who].kpol;
      x.ks = recombination(who, 'trs');
      x.ksEquation = rd[who].ksEquation;
      x.kvol = kvol[who];
      x.M = corrected(who, x.kTP, x.ks);
    }
    const mode = f.cc_ref_kqtrs_mode;
    if (type === 'co60') {
      trs.kQ = 1;
      trs.kQSource = L('Q_cross = Q₀ = ⁶⁰Co: k_Q = 1', 'Q_cross = Q₀ = ⁶⁰Co: k_Q = 1');
    } else if (type === 'photons') {
      // k_Qcross опорной камеры: табл. 16 или ур. (34); для справки — k_Qcross рабочей камеры (нужен дальше в ур. 30)
      const kt = ref && !ref.other ? TRS.kQFromTable(ref, tpr) : { error: null };
      const kf = ref && !ref.other ? TRS.kQ(ref, tpr) : { error: null };
      trs.kQTable = kt.value;
      trs.kQFormula = kf.value;
      if (Number.isFinite(kt.value) && Number.isFinite(kf.value)) trs.kQDiff = (kt.value / kf.value - 1) * 100;
      if (mode === 'manual') {
        trs.kQ = read('cc_ref_kqtrs_manual', 'k_Qcross (TRS-398)', 'trs');
        if (Number.isFinite(trs.kQ) && (trs.kQ < 0.9 || trs.kQ > 1.02)) add('warn', 'trs', L('k_Q для МВ фотонов обычно 0,94–1,00: проверьте ввод.', 'k_Q for MV photons is usually 0.94–1.00: check the input.'), null, 'cc_ref_kqtrs_manual');
        trs.kQSource = L('введён вручную', 'entered manually');
      } else if (!ref) trs.kQ = NaN;
      else if (ref.other || !ref.trs) {
        add('error', 'trs', L(`Для ${ref.other ? 'этой камеры' : chamberLabel(ref)} в TRS-398 Rev.1 нет k_Q: введите k_Qcross вручную или выберите другую опорную камеру.`, `TRS-398 Rev.1 gives no k_Q for ${ref.other ? 'this chamber' : chamberLabel(ref)}: enter k_Qcross manually or select another reference chamber.`), `${REF.trs}, табл. 16, 45`, ['cc_ref_model', 'cc_ref_kqtrs_mode']);
        trs.kQ = NaN;
      } else if (mode === 'table' && !ref.trsTable) {
        add('error', 'trs', L('Табличные значения есть только для камер из табл. 16: выберите расчёт по формуле (34).', 'Tabulated values exist only for the chambers in Table 16: select calculation by Eq. (34).'), `${REF.trs}, табл. 16`, 'cc_ref_kqtrs_mode');
        trs.kQ = NaN;
      } else {
        const k = mode === 'table' ? kt : kf;
        if (k.error && Number.isFinite(tpr)) add('error', 'trs', `${cap(k.error)}.`, `${REF.trs}, табл. 16`, ['kQref_trs', 'cc_tpr']);
        trs.kQ = k.value;
        trs.kQSource = k.source;
      }
      if (fld && !fld.other && fld.trs && Number.isFinite(tpr)) {
        const kk = mode === 'table' && fld.trsTable ? TRS.kQFromTable(fld, tpr) : TRS.kQ(fld, tpr);
        trs.kQcrossField = kk.value;
      }
    } else if (ref && !ref.other && ref.trsT20 && r50ok) {
      const t = interpE(ref.trsT20, r50);
      trs.kQTable = t.value;
      trs.kQTableError = t.error;
      trs.kQFormula = t.error ? NaN : trsFit(ref, ref.trsFit20, r50);
      trs.kQDiff = (trs.kQTable / trs.kQFormula - 1) * 100;
    }
    if (type === 'electrons') {
      if (mode === 'manual') {
        trs.kQ = read('cc_ref_kqtrs_manual', 'k_Qcross,Q₀ (TRS-398)', 'trs');
        if (Number.isFinite(trs.kQ) && (trs.kQ < 0.8 || trs.kQ > 1.2)) add('warn', 'trs', L('Введённый k_Q необычен: проверьте значение.', 'The entered k_Q is unusual: check the value.'), null, 'cc_ref_kqtrs_manual');
        trs.kQSource = L('введён вручную', 'entered manually');
      } else if (!ref) {
        trs.kQ = NaN;
      } else if (ref.other || !ref.trsT20) {
        add('error', 'trs', L(
          `Для ${ref.other ? 'этой камеры' : chamberLabel(ref)} в табл. 20 TRS-398 нет k_Q при калибровке в ⁶⁰Co: введите k_Qcross,Q₀ вручную или выберите другую опорную камеру.`,
          `TRS-398 Table 20 gives no k_Q for ${ref.other ? 'this chamber' : chamberLabel(ref)} calibrated in ⁶⁰Co: enter k_Qcross,Q₀ manually or select another reference chamber.`,
        ), `${REF.trs}, табл. 20`, ['cc_ref_model', 'cc_ref_kqtrs_mode']);
        trs.kQ = NaN;
      } else if (r50ok) {
        if (trs.kQTableError) add('error', 'trs', L(`k_Q опорной камеры по табл. 20: ${trs.kQTableError}.`, `k_Q of the reference chamber from Table 20: ${trs.kQTableError}.`), `${REF.trs}, табл. 20`, ['kQref_trs', 'cc_r50', 'cc_i50']);
        trs.kQ = mode === 'formula' ? trs.kQFormula : trs.kQTable;
        trs.kQSource = mode === 'formula'
          ? L(`прил. II, ур. (${ref.type === 'cyl' ? '99' : '98'}) с параметрами табл. 47 TRS-398`, `App. II, Eq. (${ref.type === 'cyl' ? '99' : '98'}) with the parameters of TRS-398 Table 47`)
          : L('табл. 20 TRS-398, линейная интерполяция по R50', 'TRS-398 Table 20, linear interpolation in R50');
      } else trs.kQ = NaN;
    }
    trs.ratio = trs.ref.M / trs.fld.M;
    trs.N = trs.ratio * ndw * trs.kQ;
    trs.Dcross = trs.ref.M * ndw * trs.kQ; // Гр за отпущенные МЕ (за время облучения у ⁶⁰Co) на z_ref
    trs.DperMU = linac ? (trs.Dcross / amount) * 100 : NaN; // Гр на 100 МЕ
    trs.DperMin = linac ? NaN : trs.Dcross / amount; // Гр/мин без учёта ошибки таймера
    trs.ok = Number.isFinite(trs.N) && trs.N > 0;
  }

  // ------------------------------------------------------------- TG-51 + Report 385: ур. (5) (только электроны)
  const tg = { enabled: want51 };
  if (want51) {
    for (const who of ['ref', 'fld']) {
      const x = (tg[who] = {});
      x.PTP = temperaturePressure({ T: who === 'ref' ? T : T2, P: who === 'ref' ? P : P2, T0, P0, abs0: TG51.TG51_ABS0 });
      x.Pelec = kelec[who];
      x.Ppol = rd[who].kpol;
      x.Pion = recombination(who, 'tg51');
      x.M = corrected(who, x.PTP, x.Pion);
    }
    const rangeCheck = () => {
      if (r50ok && (r50 < R385_RANGE[0] - 1e-9 || r50 > R385_RANGE[1] + 1e-9)) {
        add('error', 'tg51', L(`R50 = ${ru(r50, 2)} см вне диапазона Report 385 (1,70–8,70 см): аппроксимации k′_Q там не проверены.`, `R50 = ${ru(r50, 2)} cm is outside the Report 385 range (1.70–8.70 cm): the k′_Q fits have not been verified there.`), `${REF.r385}, ур. (7)–(8)`, ['cc_r50', 'cc_i50']);
      }
    };
    if (f.cc_ref_kq51_mode === 'manual') {
      tg.kQref = read('cc_ref_kq51_manual', L('k_Q опорной камеры (TG-51)', 'k_Q of the reference chamber (TG-51)'), 'tg51');
      if (Number.isFinite(tg.kQref) && (tg.kQref < 0.8 || tg.kQref > 1.2)) add('warn', 'tg51', L('Введённый k_Q необычен: проверьте значение.', 'The entered k_Q is unusual: check the value.'), null, 'cc_ref_kq51_manual');
      tg.kQrefSource = L('введён вручную', 'entered manually');
    } else if (ref && (ref.other || !ref.r385)) {
      add('error', 'tg51', L(
        `Для ${ref.other ? 'этой камеры' : chamberLabel(ref)} в Report 385 нет данных: выберите другую опорную камеру или введите k_Q вручную.`,
        `Report 385 gives no data for ${ref.other ? 'this chamber' : chamberLabel(ref)}: select another reference chamber or enter k_Q manually.`,
      ), `${REF.r385}, разд. 6.6`, ['cc_ref_model', 'kQref_51']);
      tg.kQref = NaN;
    } else if (ref && r50ok && ref.type === 'cyl') {
      rangeCheck();
      tg.kQprimeRef = kQprime385(ref, r50);
      tg.kQecal = ref.r385.kQecal;
      tg.kQref = tg.kQprimeRef * tg.kQecal;
      tg.kQrefSource = L(
        `Report 385: k′_Q = ${ru(ref.r385.a, 3)} + ${ru(ref.r385.b, 3)}·R50^(−${ru(ref.r385.c, 3)}) (ур. 7, табл. 5), k_Qecal = ${ru(tg.kQecal, 3)} (табл. 4)`,
        `Report 385: k′_Q = ${ru(ref.r385.a, 3)} + ${ru(ref.r385.b, 3)}·R50^(−${ru(ref.r385.c, 3)}) (Eq. 7, Table 5), k_Qecal = ${ru(tg.kQecal, 3)} (Table 4)`,
      );
    } else tg.kQref = NaN;
    if (f.cc_fld_kq51_mode === 'manual') {
      tg.kQprimeFld = read('cc_fld_kq51_manual', L('k′_Q рабочей камеры (TG-51)', 'k′_Q of the field chamber (TG-51)'), 'tg51');
      if (Number.isFinite(tg.kQprimeFld) && (tg.kQprimeFld < 0.8 || tg.kQprimeFld > 1.2)) add('warn', 'tg51', L('Введённый k′_Q необычен: проверьте значение.', 'The entered k′_Q is unusual: check the value.'), null, 'cc_fld_kq51_manual');
      tg.kQprimeFldSource = L('введён вручную', 'entered manually');
    } else if (fld && (fld.other || !fld.r385)) {
      add('error', 'tg51', L(
        `Для ${fld.other ? 'этой камеры' : chamberLabel(fld)} в Report 385 нет данных: такие камеры не рекомендуется использовать для электронов; при необходимости введите k′_Q вручную.`,
        `Report 385 gives no data for ${fld.other ? 'this chamber' : chamberLabel(fld)}: such chambers are not recommended for electron beams; if necessary, enter k′_Q manually.`,
      ), `${REF.r385}, разд. 6.6`, ['cc_fld_model', 'kQfld_51']);
      tg.kQprimeFld = NaN;
    } else if (fld && r50ok && fld.type === 'pp') {
      rangeCheck();
      tg.kQprimeFld = kQprime385(fld, r50);
      tg.kQprimeFldSource = L(
        `Report 385: k′_Q = ${ru(fld.r385.a, 3)} + ${ru(fld.r385.b, 3)}·exp(−R50/${ru(fld.r385.c, 3)}) (ур. 8, табл. 7)`,
        `Report 385: k′_Q = ${ru(fld.r385.a, 3)} + ${ru(fld.r385.b, 3)}·exp(−R50/${ru(fld.r385.c, 3)}) (Eq. 8, Table 7)`,
      );
    } else tg.kQprimeFld = NaN;
    tg.ratio = tg.ref.M / tg.fld.M;
    tg.KN = (tg.ref.M * tg.kQref * ndw) / (tg.fld.M * tg.kQprimeFld);
    tg.Dcross = tg.ref.M * tg.kQref * ndw;
    tg.DperMU = (tg.Dcross / amount) * 100;
    tg.ok = Number.isFinite(tg.KN) && tg.KN > 0;
  }

  // ------------------------------------------------------------- правдоподобие
  const hasError = (scope) => messages.some((m) => m.level === 'error' && (m.scope === 'common' || m.scope === scope));
  const x = wantTRS ? trs : tg;
  if (!hasError(protocolUsed)) {
    if (linac && Number.isFinite(x.DperMU) && (x.DperMU < 0.3 || x.DperMU > 2)) {
      add('warn', 'common', L(
        `Доза по опорной камере на z_ref — ${ru(x.DperMU, 3)} Гр на 100 МЕ: вне обычного диапазона 0,3–2. Проверьте число МЕ, N_D,w опорной камеры и его единицы.`,
        `The dose from the reference chamber at z_ref is ${ru(x.DperMU, 3)} Gy per 100 MU, outside the usual range of 0.3–2. Check the number of MU, the N_D,w of the reference chamber and its units.`,
      ), null, 'cc_mu');
    }
    const value = wantTRS ? trs.N : tg.KN;
    if (Number.isFinite(value) && (value < 1e-3 || value > 5)) {
      add('warn', 'common', L(`Калибровочный коэффициент ${dec(value.toPrecision(4))} Гр/нКл неправдоподобен: проверьте показания и единицы.`, `The calibration coefficient ${dec(value.toPrecision(4))} Gy/nC is implausible: check the readings and units.`));
    }
    if (Number.isFinite(rd.ref.m1raw) && Number.isFinite(rd.fld.m1raw) && Math.sign(rd.ref.M1.mean) !== Math.sign(rd.fld.M1.mean)) {
      add('info', 'common', L('Знаки показаний опорной и рабочей камер разные: это нормально, если полярности напряжения у них разные; в расчёт входят модули показаний.', 'The readings of the reference and field chambers have different signs: this is fine if their bias polarities differ; the absolute values of the readings are used.'));
    }
  }
  if (wantTRS && !trs.ok && !hasError('trs')) add('error', 'trs', L('Не удалось вычислить коэффициент: проверьте качество пучка, k_Q и показания.', 'Could not calculate the coefficient: check the beam quality, k_Q and the readings.'));
  if (want51 && !tg.ok && !hasError('tg51')) add('error', 'tg51', L('Не удалось вычислить коэффициент: проверьте R50, k_Q и показания.', 'Could not calculate the coefficient: check R50, k_Q and the readings.'));
  trs.blocked = wantTRS && hasError('trs');
  tg.blocked = want51 && hasError('tg51');
  for (const who of ['ref', 'fld']) {
    if (flags[`kpol_${who}`]) flags[`Ppol_${who}`] = flags[`kpol_${who}`];
  }
  const order = { error: 0, warn: 1, info: 2 };
  messages.sort((a, b) => order[a.level] - order[b.level]);

  return {
    protocol: f.protocol,
    protocolUsed,
    type,
    form: f,
    ref,
    fld,
    positions: pos,
    quality,
    inputs: { T, P, T2, P2, separateTP, T0, P0, amount, mu: linac ? amount : NaN, time: linac ? NaN : amount, ndw, ndwCert, ndwRaw, klab, kelec, kvol, emBar, H: env.H, ref: rd.ref, fld: rd.fld },
    trs,
    tg51: tg,
    messages,
    flags,
    hasErrors: messages.some((m) => m.level === 'error'),
  };
}

// ------------------------------------------------------------- перенос результата в другие вкладки

/** Камера для вкладки «⁶⁰Co»: те же id (цилиндрические из chambers.js, плоскопараллельные с «PP:»); «другая» — своя камера. */
function coChamberPatch(f) {
  if (f.cc_fld_model === 'OTHER') return { co_ch_model: 'CUSTOM', co_cc_maker: '', co_cc_model: f.cc_fld_other_name, co_cc_type: f.cc_fld_other_type === 'pp' ? 'pp' : 'cyl' };
  return { co_ch_model: f.cc_fld_model };
}

/** Камера для вкладки «МВ фотоны»: только цилиндрические; «другая» — своя камера (аналог для k_Q выбирают там). */
function photonChamberPatch(f) {
  if (f.cc_fld_model === 'OTHER') return { ch_model: 'CUSTOM', cc_maker: '', cc_model: f.cc_fld_other_name, cc_length: f.cc_fld_length };
  return { ch_model: f.cc_fld_model };
}

/**
 * Куда можно перенести результат и какие поля заполнить: [{ target: 'electrons'|'photons'|'co60', patch }].
 * Пусто, если результата нет.
 */
export function crossCalTargets(r) {
  const f = r.form;
  const x = r.protocolUsed === 'tg51' ? r.tg51 : r.trs;
  if (x.blocked || !x.ok) return [];
  if (r.type === 'electrons') {
    const patch = {
      e_ch_model: f.cc_fld_model,
      e_ch_serial: f.cc_fld_serial,
      e_cal_route: 'cross',
      e_T0: f.cc_T0,
      e_P0: f.cc_P0,
      e_el_model: f.cc_fld_el_model,
      e_el_serial: f.cc_fld_el_serial,
      e_kelec: f.cc_fld_kelec,
    };
    if (f.cc_fld_model === 'OTHER') {
      patch.e_other_name = f.cc_fld_other_name;
      patch.e_other_type = f.cc_fld_other_type;
      patch.e_other_r = f.cc_fld_other_r;
    }
    if (r.protocolUsed === 'tg51') {
      patch.e_cross_kn = transferNumber(r.tg51.KN);
      patch.e_cross_kn_unit = 'Gy/nC';
    } else {
      patch.e_cross_ndw = transferNumber(r.trs.N);
      patch.e_cross_ndw_unit = 'Gy/nC';
      patch.e_cross_r50 = transferNumber(Number(r.quality.r50.toFixed(3)));
    }
    return [{ target: 'electrons', patch }];
  }
  const common = { el_model: f.cc_fld_el_model, el_serial: f.cc_fld_el_serial, el_kelec: f.cc_fld_kelec, ch_serial: f.cc_fld_serial, ch_T0: f.cc_T0, ch_P0: f.cc_P0 };
  if (r.type === 'photons') {
    return [{
      target: 'photons',
      patch: { ...photonChamberPatch(f), ...common, ch_cal_route: 'cross', ch_cross_ndw: transferNumber(r.trs.N), ch_cross_ndw_unit: 'Gy/nC', ch_cross_tpr: transferNumber(Number(r.quality.tpr.toFixed(4))) },
    }];
  }
  // ⁶⁰Co: N_D,w рабочей камеры в ⁶⁰Co — для вкладки ⁶⁰Co и (цилиндрической камеры) для вкладки фотонов.
  // Поправки на полярность и рекомбинацию в коэффициент уже внесены — «лаборатория внесла поправки».
  const out = [{
    target: 'co60',
    patch: {
      ...coChamberPatch(f), co_ch_serial: f.cc_fld_serial, co_ndw: transferNumber(r.trs.N), co_ndw_unit: 'Gy/nC', co_T0: f.cc_T0, co_P0: f.cc_P0,
      co_el_model: f.cc_fld_el_model, co_el_serial: f.cc_fld_el_serial, co_kelec: f.cc_fld_kelec, co_lab_pol_applied: true, co_lab_ks_applied: true,
    },
  }];
  if (r.fld?.type === 'cyl') {
    out.push({
      target: 'photons',
      patch: { ...photonChamberPatch(f), ...common, ch_cal_route: 'co60', ch_ndw: transferNumber(r.trs.N), ch_ndw_unit: 'Gy/nC', ch_klab: '1,000', lab_pol_applied: true, lab_ks_applied: true },
    });
  }
  return out;
}

/** Поля одной вкладки (по умолчанию — первой из доступных); null, если переносить нечего. */
export function crossCalTransfer(r, target) {
  const list = crossCalTargets(r);
  const t = target ? list.find((x) => x.target === target) : list[0];
  return t ? t.patch : null;
}
