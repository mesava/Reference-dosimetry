// Перекрёстная калибровка рабочей камеры в пучке электронов высокой энергии по опорной камере,
// откалиброванной в ⁶⁰Co (метод замещения: камеры поочерёдно ставят на z_ref при одном и том же числе МЕ).
//
// TRS-398 Rev.1, разд. 7.6.1, ур. (41):
//   N_D,w,Qcross^field = (M_ref / M_field) · N_D,w,Q₀^ref · k_Qcross,Q₀^ref,
//   k_Qcross,Q₀^ref — k_Q опорной камеры, откалиброванной в ⁶⁰Co (Q₀ = ⁶⁰Co), в пучке Qcross: табл. 20.
//   Показания исправлены на температуру и давление, электрометр, полярность и рекомбинацию (разд. 4.4.3).
//   Дальше рабочая камера используется по ур. (43): D_w,Q = M_Q · N_D,w,Qcross · k_Q,Qcross,
//   k_Q,Qcross = k_Q,Qint / k_Qcross,Qint (ур. 44, табл. 21) — это делает вкладка «Электроны».
// WGTG51 Report 385 (2024), разд. 5.3.2, ур. (5):
//   (k_Qecal·N_D,w)_pp = (M · k′_Q · k_Qecal · N_D,w)_cyl / (M · k′_Q)_pp,
//   k′_Q — ур. (7), табл. 5 (цилиндрические) и ур. (8), табл. 7 (плоскопараллельные); k_Qecal — табл. 4.
//   Дальше: D_w = (M · k′_Q)_pp · (k_Qecal·N_D,w)_pp (ур. 6).

import { parseNumber, parseCells, isBlank, pressureToKPa, ndwToGyPerNC, ru, dec } from './units.js';
import { L } from './i18n.js';
import { temperaturePressure, polarity, environmentChecks } from './common.js';
import * as TG51 from './tg51.js';
import * as TRS from './trs398.js';
import { findEChamber, eChamberLabel, interpE, kQprime385, trsFit, R385_RANGE } from './electron-chambers.js';
import { r50FromI50, zrefFromR50, positions } from './electrons.js';

export const CC_DEFAULTS = {
  protocol: 'trs',

  cc_institution: '',
  cc_machine: '',
  cc_beam: '',
  cc_date: '',
  cc_staff: [''],
  cc_notes: '',

  // пучок перекрёстной калибровки
  cc_r50_method: 'i50', // 'i50' — по глубине 50 % ионизации | 'r50' — R50 известен
  cc_i50: '',
  cc_r50: '',
  cc_mu: '100',
  cc_beam_mode: 'pulsed', // 'pulsed' | 'scanned' — для k_s по табл. 10 TRS-398

  // опорная камера: калибровка в ⁶⁰Co
  cc_ref_model: '', // id из E_CHAMBERS | 'OTHER'
  cc_ref_other_name: '',
  cc_ref_other_type: 'cyl',
  cc_ref_other_r: '',
  cc_ref_serial: '',
  cc_ref_ndw: '',
  cc_ref_ndw_unit: 'Gy/nC',
  cc_T0: '20',
  cc_P0: '101,325',
  cc_ref_el_model: '',
  cc_ref_el_serial: '',
  cc_ref_kelec: '1,000',
  cc_ref_kqtrs_mode: 'table', // 'table' (табл. 20) | 'formula' (прил. II, табл. 47) | 'manual'
  cc_ref_kqtrs_manual: '',
  cc_ref_kq51_mode: 'fit', // 'fit' (Report 385: k′_Q·k_Qecal) | 'manual'
  cc_ref_kq51_manual: '',

  // рабочая (калибруемая) камера
  cc_fld_model: '',
  cc_fld_other_name: '',
  cc_fld_other_type: 'pp',
  cc_fld_other_r: '',
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
  cc_ref_Mopp: ['', '', ''],
  cc_ref_M2: ['', '', ''],

  // показания рабочей камеры
  cc_fld_polarity: '+',
  cc_fld_V1: '300',
  cc_fld_V2: '100',
  cc_fld_M1: ['', '', ''],
  cc_fld_Mopp: ['', '', ''],
  cc_fld_M2: ['', '', ''],
};

export const CC_SERIES = ['cc_ref_M1', 'cc_ref_Mopp', 'cc_ref_M2', 'cc_fld_M1', 'cc_fld_Mopp', 'cc_fld_M2'];

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
  for (const k of CC_SERIES) {
    if (!Array.isArray(f[k])) f[k] = isBlank(f[k]) ? ['', '', ''] : String(f[k]).trim().split(/[\s;]+/);
  }
  if (!Array.isArray(f.cc_staff) || f.cc_staff.length === 0) f.cc_staff = [''];
  return f;
}

/** Камера из базы или «другая» с характеристиками из формы. who — 'ref' | 'fld'. */
export function resolveCcChamber(f, who) {
  const id = f[`cc_${who}_model`];
  if (id === 'OTHER') {
    const r = parseNumber(f[`cc_${who}_other_r`]);
    return {
      id: 'OTHER',
      other: true,
      maker: '',
      model: f[`cc_${who}_other_name`] || L('другая камера', 'other chamber'),
      type: f[`cc_${who}_other_type`] === 'pp' ? 'pp' : 'cyl',
      trsRcylMm: Number.isFinite(r) ? r : NaN,
    };
  }
  return findEChamber(id);
}

export const ccChamberLabel = (c) => (c ? (c.other ? c.model : eChamberLabel(c)) : '');

function maxRelDeviation(series) {
  if (!series || series.n < 2 || !series.mean) return 0;
  return Math.max(...series.values.map((v) => Math.abs(v - series.mean) / Math.abs(series.mean)));
}

/** Значимых цифр достаточно, чтобы при переносе в другую вкладку не терять точность. */
export const transferNumber = (v) => (Number.isFinite(v) ? dec(Number(v.toPrecision(6)).toString()) : '');

export function computeCrossCal(form) {
  const f = normalizeCrossCal(form);
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

  const want51 = f.protocol === 'tg51';
  const wantTRS = !want51;

  // ---------------------------------------------------------- 1. пучок перекрёстной калибровки
  const quality = { method: f.cc_r50_method };
  let r50 = NaN;
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
  const zref = Number.isFinite(r50) ? zrefFromR50(r50) : NaN;
  quality.r50 = r50;
  quality.zref = zref;
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
  const mu = read('cc_mu', L('Облучение, МЕ', 'Irradiation, MU'));
  if (Number.isFinite(mu) && mu <= 0) add('error', 'common', L('Число МЕ должно быть больше нуля.', 'The number of MU must be greater than zero.'), null, 'cc_mu');

  // ---------------------------------------------------------- 2–3. камеры
  const ref = resolveCcChamber(f, 'ref');
  const fld = resolveCcChamber(f, 'fld');
  if (isBlank(f.cc_ref_model)) add('error', 'common', L('Выберите опорную камеру.', 'Select the reference chamber.'), null, 'cc_ref_model');
  if (isBlank(f.cc_fld_model)) add('error', 'common', L('Выберите рабочую камеру.', 'Select the field chamber.'), null, 'cc_fld_model');
  if (ref && fld && !ref.other && ref.id === fld.id && !isBlank(f.cc_ref_serial) && String(f.cc_ref_serial).trim() === String(f.cc_fld_serial).trim()) {
    add('error', 'common', L('Опорная и рабочая камеры совпадают (та же модель и тот же номер).', 'The reference and field chambers are the same (same model and serial number).'), null, ['cc_ref_serial', 'cc_fld_serial']);
  }
  for (const [c, key] of [[ref, 'cc_ref_other_r'], [fld, 'cc_fld_other_r']]) {
    if (wantTRS && c?.other && c.type === 'cyl' && !Number.isFinite(c.trsRcylMm)) {
      add('warn', 'trs', L('Укажите радиус полости: по TRS-398 центр цилиндрической камеры ставят на 0,5·r_cyl глубже z_ref.', 'Enter the cavity radius: per TRS-398, the center of a cylindrical chamber is placed 0.5·r_cyl deeper than z_ref.'), `${REF.trs}, табл. 19`, key);
    }
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
  if (wantTRS && fld && !fld.other && fld.type === 'pp' && !fld.trsT21) {
    add('warn', 'trs', L(
      `Для ${eChamberLabel(fld)} в табл. 21 TRS-398 нет k_Q,Qint: при работе с перекрёстно откалиброванной камерой k_Q,Qcross придётся вводить вручную.`,
      `TRS-398 Table 21 gives no k_Q,Qint for ${eChamberLabel(fld)}: when the cross-calibrated chamber is used, k_Q,Qcross will have to be entered manually.`,
    ), `${REF.trs}, разд. 7.6.2, табл. 21`, 'cc_fld_model');
  }
  const pos = { ref: positions(ref, zref), fld: positions(fld, zref) };

  const ndwRaw = read('cc_ref_ndw', L('N_D,w опорной камеры', 'N_D,w of the reference chamber'));
  const ndw = Number.isFinite(ndwRaw) ? ndwToGyPerNC(ndwRaw, f.cc_ref_ndw_unit) : NaN;
  if (Number.isFinite(ndw) && (ndw < 1e-3 || ndw > 5)) {
    add('warn', 'common', L(`N_D,w = ${dec(ndw.toPrecision(4))} Гр/нКл выглядит неправдоподобно: проверьте единицы.`, `N_D,w = ${dec(ndw.toPrecision(4))} Gy/nC looks implausible: check the units.`), null, 'cc_ref_ndw');
  }
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
  // для рабочей камеры — свои T и P, если заданы (пустое поле — как для опорной)
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
    for (const [s, label, key] of [[M1, L('при V₁', 'at V₁'), k('M1')], [Mopp, L('обратной полярности', 'at opposite polarity'), k('Mopp')], [M2, L('при V₂', 'at V₂'), k('M2')]]) {
      const d = maxRelDeviation(s);
      const pct = ru(d * 100, 2);
      const who2 = L(name.ru, name.en);
      if (d > 0.05) add('error', 'common', L(`${cap(who2)}: показания ${label} расходятся на ${pct} % от среднего — вероятно, ошибка ввода.`, `${cap(who2)}: readings ${label} differ from the mean by up to ${pct} % — probably a data-entry error.`), null, key);
      else if (d > 0.005) add('warn', 'common', L(`${cap(who2)}: разброс показаний ${label} до ${pct} % от среднего. Повторите облучения; при дрейфе выхода ускорителя повторите и измерение другой камерой.`, `${cap(who2)}: spread of readings ${label} up to ${pct} % of the mean. Repeat the exposures; if the linac output drifts, repeat the measurement with the other chamber as well.`), `${REF.r374}, разд. 4.4.2`, key);
      else if (d > 0.001) add('info', 'common', L(`${cap(who2)}: разброс показаний ${label} до ${pct} % от среднего. Report 374 советует добиваться ±0,1 % без тренда.`, `${cap(who2)}: spread of readings ${label} up to ${pct} % of the mean. Report 374 recommends reaching ±0.1 % with no trend.`), `${REF.r374}, разд. 4.4.2`, key);
    }
    const ok = seriesOk(M1);
    let kpol = NaN;
    if (ok && seriesOk(Mopp)) {
      kpol = polarity(M1.mean, Mopp.mean);
      const dpol = Math.abs(kpol - 1);
      const nm = L(`k_pol (${name.ru})`, `k_pol (${name.en})`);
      if (dpol > 0.02) add('warn', 'common', L(`${nm} = ${ru(kpol, 4)}: эффект полярности больше 2 % — больше, чем допускает Report 385 для камеры эталонного класса. Проверьте камеру, кабель и время стабилизации.`, `${nm} = ${ru(kpol, 4)}: the polarity effect exceeds 2 %, more than Report 385 allows for a reference-class chamber. Check the chamber, the cable and the stabilization time.`), `${REF.r385}, табл. A1; ${REF.trs}, табл. 3`, `kpol_${who}`);
      else if (dpol > 0.004) add('info', 'common', L(`${nm} = ${ru(kpol, 4)}: в пучках электронов эффект полярности бывает больше, чем в фотонных, поэтому поправку измеряют для каждой камеры.`, `${nm} = ${ru(kpol, 4)}: in electron beams the polarity effect can be larger than in photon beams, so the correction is measured for each chamber.`), `${REF.r385}, прил. A; ${REF.trs}, табл. 3`, `kpol_${who}`);
    }
    const nV = Math.abs(V1) / Math.abs(V2);
    const recOk = ok && seriesOk(M2) && Number.isFinite(nV) && nV > 1;
    if (ok && M2.n > 0 && !M2.error && Math.sign(M1.mean) !== Math.sign(M2.mean)) add('error', 'common', L(`${cap(name.ru)}: показания при V₁ и V₂ снимают при одной и той же (обычной) полярности.`, `${cap(name.en)}: readings at V₁ and V₂ are taken at the same (normal) polarity.`), null, k('M2'));
    const ratio12 = recOk ? Math.abs(M1.mean) / Math.abs(M2.mean) : NaN;
    if (recOk && ratio12 < 1) add('error', 'common', L(`${cap(name.ru)}: k_s (P_ion) не может быть меньше 1 — при пониженном напряжении собирается меньше заряда. Проверьте показания и напряжения.`, `${cap(name.en)}: k_s (P_ion) cannot be less than 1 — less charge is collected at the reduced voltage. Check the readings and voltages.`), `${REF.trs}, разд. 4.4.3.4`, [`ks_${who}`, `Pion_${who}`, k('M2')]);
    return { V1, V2, nV, M1, Mopp, M2, m1: ok ? Math.abs(M1.mean) : NaN, kpol, recOk, ratio12, name };
  };
  const rd = { ref: readings('ref'), fld: readings('fld') };

  // ---------------------------------------------------------- рекомбинация по протоколу
  const recombination = (who, scope) => {
    const x = rd[who];
    const nm = (q) => L(`${q} (${x.name.ru})`, `${q} (${x.name.en})`);
    if (!x.recOk) return NaN;
    if (scope === 'trs') {
      const r = TRS.ks({ m1: x.M1.mean, m2: x.M2.mean, v1: Math.abs(x.V1), v2: Math.abs(x.V2), beam: f.cc_beam_mode });
      x.ksEquation = r.equation;
      const who2 = cap(L(x.name.ru, x.name.en));
      if (r.error) add('error', 'trs', `${who2}: ${r.error}.`, `${REF.trs}, табл. 10`, `ks_${who}`);
      r.notes.forEach((n) => add('warn', 'trs', `${who2}: ${n}.`, `${REF.trs}, разд. 4.4.3.4`, `ks_${who}`));
      if (x.nV < 3 - 1e-9) add('info', 'trs', L(`${cap(x.name.ru)}: TRS-398 рекомендует отношение напряжений V₁/V₂ ≥ 3.`, `${cap(x.name.en)}: TRS-398 recommends a voltage ratio V₁/V₂ ≥ 3.`), `${REF.trs}, разд. 4.4.3.4`);
      if (r.value > 1.05) add('error', 'trs', L(`${nm('k_s')} = ${ru(r.value, 4)} > 1,05: метод двух напряжений неприменим.`, `${nm('k_s')} = ${ru(r.value, 4)} > 1.05: the two-voltage method is not applicable.`), `${REF.trs}, табл. 3`, `ks_${who}`);
      if (x.ratio12 >= 1 && r.value < 1) add('error', 'trs', L(`${nm('k_s')} = ${ru(r.value, 4)} < 1: так быть не может, проверьте показания и напряжения.`, `${nm('k_s')} = ${ru(r.value, 4)} < 1 is impossible: check the readings and the voltages.`), `${REF.trs}, разд. 4.4.3.4`, `ks_${who}`);
      return r.value;
    }
    const v = TG51.pIon({ mH: x.M1.mean, mL: x.M2.mean, vH: Math.abs(x.V1), vL: Math.abs(x.V2), beam: 'pulsed' });
    if (x.nV < 2 - 1e-9) add('warn', 'tg51', L(`${cap(x.name.ru)}: по TG-51 пониженное напряжение должно быть меньше рабочего как минимум вдвое.`, `${cap(x.name.en)}: per TG-51, the reduced voltage must be at most half the operating voltage.`), `${REF.tg51}, разд. VII.D.2`, [`cc_${who}_V1`, `cc_${who}_V2`]);
    if (v > 1.05) add('error', 'tg51', L(`${nm('P_ion')} = ${ru(v, 4)} > 1,05: нужна другая камера.`, `${nm('P_ion')} = ${ru(v, 4)} > 1.05: use a different chamber.`), `${REF.tg51}, разд. VII.D.1`, `Pion_${who}`);
    if (x.ratio12 >= 1 && v < 1) add('error', 'tg51', L(`${nm('P_ion')} = ${ru(v, 4)} < 1: так быть не может, проверьте показания и напряжения.`, `${nm('P_ion')} = ${ru(v, 4)} < 1 is impossible: check the readings and the voltages.`), `${REF.tg51}, разд. VII.D`, `Pion_${who}`);
    return v;
  };

  const r50ok = Number.isFinite(r50);
  const corrected = (who, kTP, krec) => rd[who].m1 * kTP * kelec[who] * rd[who].kpol * krec;

  // ------------------------------------------------------------- TRS-398: ур. (41)
  const trs = { enabled: wantTRS };
  if (wantTRS) {
    for (const who of ['ref', 'fld']) {
      const x = (trs[who] = {});
      x.kTP = temperaturePressure({ T: who === 'ref' ? T : T2, P: who === 'ref' ? P : P2, T0, P0, abs0: TRS.TRS_ABS0 });
      x.kelec = kelec[who];
      x.kpol = rd[who].kpol;
      x.ks = recombination(who, 'trs');
      x.ksEquation = rd[who].ksEquation;
      x.M = corrected(who, x.kTP, x.ks);
    }
    // k_Qcross,Q₀ опорной камеры (Q₀ = ⁶⁰Co): табл. 20 или аппроксимация прил. II (табл. 47)
    const mode = f.cc_ref_kqtrs_mode;
    if (ref && !ref.other && ref.trsT20 && r50ok) {
      const t = interpE(ref.trsT20, r50);
      trs.kQTable = t.value;
      trs.kQTableError = t.error;
      trs.kQFormula = t.error ? NaN : trsFit(ref, ref.trsFit20, r50);
      trs.kQDiff = (trs.kQTable / trs.kQFormula - 1) * 100;
    }
    if (mode === 'manual') {
      trs.kQ = read('cc_ref_kqtrs_manual', 'k_Qcross,Q₀ (TRS-398)', 'trs');
      if (Number.isFinite(trs.kQ) && (trs.kQ < 0.8 || trs.kQ > 1.2)) add('warn', 'trs', L('Введённый k_Q необычен: проверьте значение.', 'The entered k_Q is unusual: check the value.'), null, 'cc_ref_kqtrs_manual');
      trs.kQSource = L('введён вручную', 'entered manually');
    } else if (!ref) {
      trs.kQ = NaN;
    } else if (ref.other || !ref.trsT20) {
      add('error', 'trs', L(
        `Для ${ref.other ? 'этой камеры' : eChamberLabel(ref)} в табл. 20 TRS-398 нет k_Q при калибровке в ⁶⁰Co: введите k_Qcross,Q₀ вручную или выберите другую опорную камеру.`,
        `TRS-398 Table 20 gives no k_Q for ${ref.other ? 'this chamber' : eChamberLabel(ref)} calibrated in ⁶⁰Co: enter k_Qcross,Q₀ manually or select another reference chamber.`,
      ), `${REF.trs}, табл. 20`, ['cc_ref_model', 'cc_ref_kqtrs_mode']);
      trs.kQ = NaN;
    } else if (r50ok) {
      if (trs.kQTableError) add('error', 'trs', L(`k_Q опорной камеры по табл. 20: ${trs.kQTableError}.`, `k_Q of the reference chamber from Table 20: ${trs.kQTableError}.`), `${REF.trs}, табл. 20`, ['kQref_trs', 'cc_r50', 'cc_i50']);
      trs.kQ = mode === 'formula' ? trs.kQFormula : trs.kQTable;
      trs.kQSource = mode === 'formula'
        ? L(`прил. II, ур. (${ref.type === 'cyl' ? '99' : '98'}) с параметрами табл. 47 TRS-398`, `App. II, Eq. (${ref.type === 'cyl' ? '99' : '98'}) with the parameters of TRS-398 Table 47`)
        : L('табл. 20 TRS-398, линейная интерполяция по R50', 'TRS-398 Table 20, linear interpolation in R50');
    } else trs.kQ = NaN;
    // ур. (41)
    trs.ratio = trs.ref.M / trs.fld.M;
    trs.N = trs.ratio * ndw * trs.kQ;
    trs.Dcross = trs.ref.M * ndw * trs.kQ; // Гр за отпущенные МЕ на z_ref
    trs.DperMU = (trs.Dcross / mu) * 100; // Гр на 100 МЕ
    trs.ok = Number.isFinite(trs.N) && trs.N > 0;
  }

  // ------------------------------------------------------------- TG-51 + Report 385: ур. (5)
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
    // опорная (цилиндрическая) камера: k_Q = k′_Q·k_Qecal, ур. (7), табл. 4–5
    if (f.cc_ref_kq51_mode === 'manual') {
      tg.kQref = read('cc_ref_kq51_manual', L('k_Q опорной камеры (TG-51)', 'k_Q of the reference chamber (TG-51)'), 'tg51');
      if (Number.isFinite(tg.kQref) && (tg.kQref < 0.8 || tg.kQref > 1.2)) add('warn', 'tg51', L('Введённый k_Q необычен: проверьте значение.', 'The entered k_Q is unusual: check the value.'), null, 'cc_ref_kq51_manual');
      tg.kQrefSource = L('введён вручную', 'entered manually');
    } else if (ref && (ref.other || !ref.r385)) {
      add('error', 'tg51', L(
        `Для ${ref.other ? 'этой камеры' : eChamberLabel(ref)} в Report 385 нет данных: выберите другую опорную камеру или введите k_Q вручную.`,
        `Report 385 gives no data for ${ref.other ? 'this chamber' : eChamberLabel(ref)}: select another reference chamber or enter k_Q manually.`,
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
    // рабочая (плоскопараллельная) камера: k′_Q, ур. (8), табл. 7
    if (f.cc_fld_kq51_mode === 'manual') {
      tg.kQprimeFld = read('cc_fld_kq51_manual', L('k′_Q рабочей камеры (TG-51)', 'k′_Q of the field chamber (TG-51)'), 'tg51');
      if (Number.isFinite(tg.kQprimeFld) && (tg.kQprimeFld < 0.8 || tg.kQprimeFld > 1.2)) add('warn', 'tg51', L('Введённый k′_Q необычен: проверьте значение.', 'The entered k′_Q is unusual: check the value.'), null, 'cc_fld_kq51_manual');
      tg.kQprimeFldSource = L('введён вручную', 'entered manually');
    } else if (fld && (fld.other || !fld.r385)) {
      add('error', 'tg51', L(
        `Для ${fld.other ? 'этой камеры' : eChamberLabel(fld)} в Report 385 нет данных: такие камеры не рекомендуется использовать для электронов; при необходимости введите k′_Q вручную.`,
        `Report 385 gives no data for ${fld.other ? 'this chamber' : eChamberLabel(fld)}: such chambers are not recommended for electron beams; if necessary, enter k′_Q manually.`,
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
    // ур. (5)
    tg.ratio = tg.ref.M / tg.fld.M;
    tg.KN = (tg.ref.M * tg.kQref * ndw) / (tg.fld.M * tg.kQprimeFld);
    tg.Dcross = tg.ref.M * tg.kQref * ndw;
    tg.DperMU = (tg.Dcross / mu) * 100;
    tg.ok = Number.isFinite(tg.KN) && tg.KN > 0;
  }

  // ------------------------------------------------------------- правдоподобие
  const hasError = (scope) => messages.some((m) => m.level === 'error' && (m.scope === 'common' || m.scope === scope));
  const x = wantTRS ? trs : tg;
  const scope = wantTRS ? 'trs' : 'tg51';
  if (!hasError(scope)) {
    if (Number.isFinite(x.DperMU) && (x.DperMU < 0.3 || x.DperMU > 2)) {
      add('warn', 'common', L(
        `Доза по опорной камере на z_ref — ${ru(x.DperMU, 3)} Гр на 100 МЕ: вне обычного диапазона 0,3–2. Проверьте число МЕ, N_D,w опорной камеры и его единицы.`,
        `The dose from the reference chamber at z_ref is ${ru(x.DperMU, 3)} Gy per 100 MU, outside the usual range of 0.3–2. Check the number of MU, the N_D,w of the reference chamber and its units.`,
      ), null, 'cc_mu');
    }
    const value = wantTRS ? trs.N : tg.KN;
    if (Number.isFinite(value) && (value < 1e-3 || value > 5)) {
      add('warn', 'common', L(`Калибровочный коэффициент ${dec(value.toPrecision(4))} Гр/нКл неправдоподобен: проверьте показания и единицы.`, `The calibration coefficient ${dec(value.toPrecision(4))} Gy/nC is implausible: check the readings and units.`));
    }
    if (Number.isFinite(rd.ref.m1) && Number.isFinite(rd.fld.m1) && Math.sign(rd.ref.M1.mean) !== Math.sign(rd.fld.M1.mean)) {
      add('info', 'common', L('Знаки показаний опорной и рабочей камер разные: это нормально, если полярности напряжения у них разные; в расчёт входят модули показаний.', 'The readings of the reference and field chambers have different signs: this is fine if their bias polarities differ; the absolute values of the readings are used.'));
    }
  }
  if (wantTRS && !trs.ok && !hasError('trs')) add('error', 'trs', L('Не удалось вычислить коэффициент: проверьте R50, k_Q и показания.', 'Could not calculate the coefficient: check R50, k_Q and the readings.'));
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
    form: f,
    ref,
    fld,
    positions: pos,
    quality,
    inputs: { T, P, T2, P2, separateTP, T0, P0, mu, ndw, ndwRaw, kelec, H: env.H, ref: rd.ref, fld: rd.fld },
    trs,
    tg51: tg,
    messages,
    flags,
    hasErrors: messages.some((m) => m.level === 'error'),
  };
}

/**
 * Поля вкладки «Электроны» (раздел 2 «Камера и электрометр»), которые заполняет результат.
 * Возвращает null, если результата нет.
 */
export function crossCalTransfer(r) {
  const f = r.form;
  const x = r.protocol === 'tg51' ? r.tg51 : r.trs;
  if (x.blocked || !x.ok) return null;
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
  if (r.protocol === 'tg51') {
    patch.e_cross_kn = transferNumber(r.tg51.KN);
    patch.e_cross_kn_unit = 'Gy/nC';
  } else {
    patch.e_cross_ndw = transferNumber(r.trs.N);
    patch.e_cross_ndw_unit = 'Gy/nC';
    patch.e_cross_r50 = transferNumber(Number(r.quality.r50.toFixed(3)));
  }
  return patch;
}
