// Расчёт поглощённой дозы в воде для МВ фотонов по TG-51 (+ аддендум 2014) и TRS-398 Rev.1.
// Принимает значения полей формы (строки и массивы строк, как их ввёл пользователь) и возвращает
// все промежуточные поправки, итоговую дозу, замечания с источниками и флаги для подсветки полей.

import { parseNumber, parseCells, isBlank, pressureToKPa, ndwToGyPerNC, ru, dec, parseBeamName } from './units.js';
import { L } from './i18n.js';
import { temperaturePressure, polarity, environmentChecks, outputPlausibility, readTolerance, complianceOf } from './common.js';
import * as TG51 from './tg51.js';
import * as TRS from './trs398.js';
import { findChamber, chamberLabel, noteText } from './chambers.js';
import { parseProfile, kvolFromProfile } from './profile.js';

export const FORM_DEFAULTS = {
  protocol: 'trs', // 'trs' | 'tg51'

  meta_institution: '',
  meta_machine: '',
  meta_beam: '',
  meta_energy: '',
  meta_fff: false,
  meta_date: '',
  meta_staff: [''],
  meta_notes: '',

  setup_geometry: 'SSD', // 'SSD' | 'SAD' | 'manual'
  setup_ssd: '100',
  setup_field: '10',
  setup_depth: '10',

  ch_model: '', // id камеры из базы | 'CUSTOM' | 'MY:…' (сохранённая своя камера)
  ch_serial: '',
  ch_ndw: '',
  ch_ndw_unit: 'Gy/nC',
  ch_klab: '1,000', // поправочный множитель K из протокола поверки (например, ВНИИФТРИ); пусто — 1
  // калибровка камеры: 'co60' — N_D,w в ⁶⁰Co (лаборатория или перекрёстная калибровка в ⁶⁰Co);
  // 'cross' — перекрёстная калибровка в клиническом пучке МВ фотонов Q_cross (TRS-398, разд. 4.5.2–4.5.3)
  ch_cal_route: 'co60',
  ch_cross_ndw: '', // N_D,w,Qcross рабочей камеры (ур. 27)
  ch_cross_ndw_unit: 'Gy/nC',
  ch_cross_tpr: '', // TPR20,10 пучка перекрёстной калибровки
  ch_T0: '20',
  ch_P0: '101,325',

  // своя камера
  cc_maker: '',
  cc_model: '',
  cc_volume: '',
  cc_length: '',
  cc_radius: '',
  cc_wall: '',
  cc_wall_thickness: '',
  cc_electrode: '',
  cc_waterproof: true,
  cc_analog: '',
  cc_a: '',
  cc_b: '',

  el_model: '',
  el_serial: '',
  el_kelec: '1,000',
  lab_pol_applied: true,
  lab_kpol: '',
  lab_ks_applied: true,
  lab_ks: '',

  env_T: '',
  env_H: '', // относительная влажность, % — для записи и проверки 20–80 %
  env_P: '',
  env_P_unit: 'kPa',

  rd_mu: '100',
  rd_polarity: '+',
  rd_V1: '300',
  rd_V2: '100',
  rd_beam: 'pulsed', // 'pulsed' | 'scanned'
  rd_M1: ['', '', ''],
  rd_Mopp: ['', '', ''],
  rd_M2: ['', '', ''],
  rd_kleak: '1,000',
  // проверка выхода (журнал): k_pol и k_s не измеряются, а берутся из последней калибровки этого пучка
  rd_fixed: false,
  rd_fixed_kpol: '', // k_pol, измеренный при калибровке
  rd_fixed_ks: '', // k_s (P_ion), измеренный при калибровке (до деления на значение лаборатории)
  rd_fixed_from: '', // дата калибровки, из которой взяты значения

  q51_method: 'open', // 'open' | 'foil50' | 'foil30' | 'interim' | 'manual'
  q51_pdd10: '',
  q51_pdd10pb: '',
  q51_manual: '',

  qtrs_method: 'ratio', // 'ratio' (измерение на 20 и 10 см) | 'pdd2010' (через PDD)
  qtrs_v20: '',
  qtrs_v10: '',
  qtrs_fff_pdd10: '',

  // поправка на рекомбинацию по глубине для показателя качества (TRS-398 Rev.1, разд. 4.4.3.4 e и разд. 6 о TPR20,10:
  // при изменении с глубиной учесть рекомбинацию на обеих глубинах); общая часть k_s пропорциональна показанию
  q_rec_on: false,
  q_rec_ks: '', // k_s (P_ion) на 10 см для камеры, которой измерено отношение; пусто — из раздела 4
  q_rec_cinit: '', // начальная рекомбинация, %; пусто — 0

  kqtrs_mode: 'formula', // 'formula' | 'table' | 'manual'
  kqtrs_manual: '',
  kq51_manual_on: false,
  kq51_manual: '',

  prof_mode: 'formula22', // 'formula22' | 'table11' | 'manual' | 'profile' (только для БВФ)
  prof_value: '',
  prof_length: '',
  prof_sdd: '',
  prof_text: '',

  // контрольные измерения: обычная полярность, V₁; поправки — из раздела 4
  ctrl_M: ['', '', ''],
  ctrl_mu: '', // пусто — столько же МЕ, сколько в разделе 4
  // калибровка (подстройка) ускорителя, если доза вне ±2 % от номинала: ответ и показания после неё
  recal_needed: '', // '' | 'yes' | 'no'
  recal_M: ['', '', ''],
  recal_mu: '', // пусто — как в разделе 7 (или 4)

  dd_on: true,
  dd_sad: 'tmr', // установка по РИО: 'tmr' | 'pdd' (PDD при РИП = 100 − z_ref)
  dd_zmax: '',
  dd_pdd: '',
  dd_tmr: '',
  dd_nominal: '1,000',
  dd_tol: '2', // допуск учреждения на отклонение от номинала, %
  dd_nominal_at: 'dmax', // где задан номинальный выход: 'dmax' (после пересчёта) | 'zref' (аппарат калибруют на опорной глубине)
};

const REF = {
  tg51: 'TG-51 (1999)',
  add: 'аддендум TG-51 (2014)',
  r374: 'WGTG51 Report 374',
  trs: 'TRS-398 Rev.1',
};

/** Приводит данные из старых сохранённых файлов к текущей форме. */
export function normalizeForm(input) {
  const f = { ...FORM_DEFAULTS, ...input };
  if (f.protocol !== 'tg51') f.protocol = 'trs'; // режима «оба протокола» больше нет
  const cells = (v) => (Array.isArray(v) ? v.map((x) => String(x ?? '')) : String(v ?? '').trim() === '' ? ['', '', ''] : String(v).replace(/,(?=\s)/g, ' ').trim().split(/[\s;]+/));
  f.rd_M1 = cells(f.rd_M1);
  f.rd_Mopp = cells(f.rd_Mopp);
  f.rd_M2 = cells(f.rd_M2);
  f.ctrl_M = cells(f.ctrl_M);
  f.recal_M = cells(f.recal_M);
  f.rd_fixed = f.rd_fixed === true || f.rd_fixed === 'true';
  if (!Array.isArray(f.meta_staff)) f.meta_staff = [String(f.meta_staff ?? '')];
  if (input && 'meta_physicist' in input && !('meta_staff' in input)) f.meta_staff = [String(input.meta_physicist ?? '')];
  if (f.meta_staff.length === 0) f.meta_staff = [''];
  if (f.ch_model === 'OTHER') f.ch_model = 'CUSTOM';
  if (input && input.qtrs_method === 'direct') {
    f.qtrs_method = 'ratio';
    f.qtrs_v20 = String(input.qtrs_tpr ?? '');
    f.qtrs_v10 = '1';
  } else if (input && input.qtrs_method === 'ratio' && 'qtrs_m20' in input && !('qtrs_v20' in input)) {
    f.qtrs_v20 = input.qtrs_m20;
    f.qtrs_v10 = input.qtrs_m10;
  } else if (input && input.qtrs_method === 'pdd2010' && 'qtrs_pdd20' in input && !('qtrs_v20' in input)) {
    f.qtrs_v20 = input.qtrs_pdd20;
    f.qtrs_v10 = input.qtrs_pdd10;
  }
  if (input && 'kqtrs_manual_on' in input && !('kqtrs_mode' in input)) f.kqtrs_mode = input.kqtrs_manual_on ? 'manual' : 'formula';
  if (f.prof_mode === 'generic') f.prof_mode = 'formula22';
  if (f.prof_mode === 'none') {
    // раньше «не применяется» означало k_vol = 1 — сохраняем это явно
    f.prof_mode = 'manual';
    if (isBlank(f.prof_value)) f.prof_value = '1,000';
  }
  return f;
}

/** Максимальное относительное отклонение отдельного показания от среднего. */
function maxRelDeviation(series) {
  if (!series || series.n < 2 || !series.mean) return 0;
  return Math.max(...series.values.map((v) => Math.abs(v - series.mean) / Math.abs(series.mean)));
}

// первая буква — заглавная, кроме обозначений величин (k_Q, k′_Q, …)
const cap = (s) => (/^[a-z][_′]/.test(s) ? s : s[0].toUpperCase() + s.slice(1));

/** Камера из базы или своя камера, собранная из полей cc_*. */
export function resolveChamber(f) {
  if (f.ch_model === 'CUSTOM' || String(f.ch_model).startsWith('MY:')) {
    const analog = findChamber(f.cc_analog);
    const a = parseNumber(f.cc_a);
    const b = parseNumber(f.cc_b);
    const hasAB = Number.isFinite(a) && Number.isFinite(b);
    return {
      id: f.ch_model,
      custom: true,
      maker: f.cc_maker || L('Своя камера', 'Custom chamber'),
      model: f.cc_model || '',
      rCavMm: parseNumber(f.cc_radius),
      lengthMm: parseNumber(f.cc_length),
      sleeve: !f.cc_waterproof,
      analog,
      hasAB,
      trs: hasAB ? { a, b } : analog?.trs ?? null,
      trsTable: hasAB ? null : analog?.trsTable ?? null,
      tg51: analog?.tg51 ?? null,
      tg51Legacy: analog?.tg51Legacy ?? null,
    };
  }
  return findChamber(f.ch_model);
}

/** Условия измерения дозы по выбранной геометрии. */
function geometry(f) {
  if (f.setup_geometry === 'manual') {
    return {
      kind: 'manual',
      ssd: parseNumber(f.setup_ssd),
      field: parseNumber(f.setup_field),
      depth: parseNumber(f.setup_depth),
    };
  }
  if (f.setup_geometry === 'SAD') return { kind: 'SAD', ssd: 90, field: 10, depth: 10, sad: 100 };
  return { kind: 'SSD', ssd: 100, field: 10, depth: 10 };
}

/**
 * Поправка на рекомбинацию по глубине для отношения показаний: общая часть k_s пропорциональна показанию
 * (дозе за импульс), k_s(z) = 1 + C_init + (k_s,ref − 1 − C_init)·M(z)/M_ref.
 * Возвращает k_s на другой глубине при известном k_s на опорной и отношении показаний M(z)/M_ref.
 */
export function ksAtRatio(ksRef, cInit, ratio) {
  const gen = Math.max(0, ksRef - 1 - cInit);
  return 1 + cInit + gen * ratio;
}

export function computePhotons(form) {
  const f = normalizeForm(form);
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
  /** Параметры поправки на рекомбинацию по глубине для показателя качества; null — поправка не вносится. */
  const recDepth = (ksTab, scope) => {
    if (!f.q_rec_on) return null;
    const own = !isBlank(f.q_rec_ks);
    const ks = own ? parseNumber(f.q_rec_ks) : ksTab;
    if (!Number.isFinite(ks) || ks < 1 || ks > 1.1) {
      add('warn', scope, L('Поправка на рекомбинацию по глубине не внесена: нужен k_s на 10 см (от 1 до 1,1) — введите его или снимите показания при двух напряжениях в разделе 4.', 'The recombination correction with depth is not applied: k_s at 10 cm (1 to 1.1) is needed — enter it or take readings at two voltages in section 4.'), null, 'q_rec_ks');
      return null;
    }
    const ci = isBlank(f.q_rec_cinit) ? 0 : parseNumber(f.q_rec_cinit) / 100;
    if (!Number.isFinite(ci) || ci < 0 || ci > 0.01) {
      add('warn', scope, L('Начальная рекомбинация вводится в процентах, от 0 до 1 %: поправка по глубине не внесена.', 'Initial recombination is entered in percent, from 0 to 1%: the depth correction is not applied.'), null, 'q_rec_cinit');
      return null;
    }
    return { ks, ci, src: own ? 'entered' : 'section4' };
  };

  const want51 = f.protocol === 'tg51';
  const wantTRS = !want51;
  const fff = !!f.meta_fff;
  // номинальная энергия: из поля, а если оно пустое — из названия пучка (в интерфейсе поле заполняется так же)
  const energy = Number.isFinite(parseNumber(f.meta_energy)) ? parseNumber(f.meta_energy) : parseBeamName(f.meta_beam).energy;
  // Признак БВФ ставится по названию пучка; если название о фильтре ничего не говорит, напоминаем проверить флажок
  if (!fff && parseBeamName(f.meta_beam).fff === null) {
    add(
      'info',
      'common',
      L(
        'Пучок считается пучком с выравнивающим фильтром. Если это пучок без фильтра (БВФ), отметьте флажок в разделе 1: от него зависят поправка k_vol и проверки качества пучка.',
        'The beam is treated as a beam with a flattening filter. If it is a flattening-filter-free (FFF) beam, select the checkbox in section 1: the k_vol correction and the beam quality checks depend on it.',
      ),
      null,
      'meta_fff',
    );
  }

  const emptyField = (label) => L(`Не заполнено поле «${label}».`, `Field "${label}" is empty.`);
  const unreadable = (label) => L(`Не удалось прочитать число в поле «${label}».`, `Could not read a number in field "${label}".`);
  const read = (key, label, scope = 'common') => {
    const v = parseNumber(f[key]);
    if (!Number.isFinite(v)) {
      add('error', scope, isBlank(f[key]) ? emptyField(label) : unreadable(label), null, key);
    }
    return v;
  };
  const readCells = (key, label) => {
    const s = parseCells(f[key]);
    if (s.error) add('error', 'common', L(`«${label}»: ${s.error}.`, `"${label}": ${s.error}.`), null, key);
    else if (s.n === 0) add('error', 'common', emptyField(label), null, key);
    else if (s.mean === 0) add('error', 'common', L(`«${label}»: среднее показание равно нулю.`, `"${label}": the mean reading is zero.`), null, key);
    return s;
  };

  // ------------------------------------------------------------ геометрия
  const geo = geometry(f);
  if (geo.kind === 'manual') {
    if (!Number.isFinite(geo.ssd)) read('setup_ssd', L('РИП', 'SSD'));
    else if (geo.ssd < 50 || geo.ssd > 150) add('error', 'common', L('РИП задаётся в сантиметрах (обычно 100).', 'SSD is entered in centimeters (usually 100).'), null, 'setup_ssd');
    else if (Math.abs(geo.ssd - 100) > 1e-9) {
      add(
        'info',
        'common',
        L(
          'РИП отличается от 100 см: TRS-398 задаёт 100 см (табл. 15), TG-51 допускает обычное клиническое расстояние. Качество пучка в любом случае измеряют при 100 см.',
          'SSD differs from 100 cm: TRS-398 specifies 100 cm (Table 15), while TG-51 allows the usual clinical distance. Beam quality is measured at 100 cm in either case.',
        ),
        `${REF.trs}, табл. 14–15; ${REF.tg51}, разд. IX.A`,
        'setup_ssd',
        wantTRS ? L(`РИП ${ru(geo.ssd, geo.ssd % 1 ? 1 : 0)} см вместо 100 см`, `SSD ${ru(geo.ssd, geo.ssd % 1 ? 1 : 0)} cm instead of 100 cm`) : null,
      );
    }
    if (!Number.isFinite(geo.field)) read('setup_field', L('Размер поля', 'Field size'));
    else if (geo.field < 2 || geo.field > 40) {
      add('error', 'common', L('Размер поля задаётся одним числом в сантиметрах, например 10.', 'Field size is entered as a single number in centimeters, e.g. 10.'), null, 'setup_field');
    } else if (Math.abs(geo.field - 10) > 1e-9) {
      add(
        'warn',
        'common',
        L(
          'Стандартное поле — 10 × 10 см: при другом размере результат не является референсной дозой по протоколу.',
          'The reference field is 10 × 10 cm: with any other field size the result is not the reference dose as defined by the protocol.',
        ),
        `${REF.trs}, табл. 15; ${REF.tg51}, разд. IX.A`,
        'setup_field',
        L(`поле ${ru(geo.field, geo.field % 1 ? 1 : 0)} × ${ru(geo.field, geo.field % 1 ? 1 : 0)} см вместо 10 × 10 см`, `${ru(geo.field, geo.field % 1 ? 1 : 0)} × ${ru(geo.field, geo.field % 1 ? 1 : 0)} cm field instead of 10 × 10 cm`),
      );
    }
    if (!Number.isFinite(geo.depth)) read('setup_depth', L('Глубина камеры', 'Chamber depth'));
    else if (geo.depth < 0.5 || geo.depth > 30) {
      add('error', 'common', L('Глубина камеры задаётся в сантиметрах, например 10.', 'Chamber depth is entered in centimeters, e.g. 10.'), null, 'setup_depth');
    } else if (Math.abs(geo.depth - 10) > 1e-9) {
      add(
        'warn',
        'common',
        L(
          'Опорная глубина для МВ фотонов — 10 г/см²: k_Q в обоих протоколах относится к ней.',
          'The reference depth for MV photons is 10 g/cm²: k_Q in both protocols refers to this depth.',
        ),
        `${REF.trs}, табл. 15; ${REF.tg51}, разд. IX.A`,
        'setup_depth',
        L(`глубина ${ru(geo.depth, geo.depth % 1 ? 1 : 0)} см вместо 10 см`, `depth ${ru(geo.depth, geo.depth % 1 ? 1 : 0)} cm instead of 10 cm`),
      );
    }
  }
  const zref = geo.depth;

  // ---------------------------------------------------------------- камера
  const chamber = resolveChamber(f);
  if (isBlank(f.ch_model)) add('error', 'common', L('Выберите тип камеры.', 'Select the chamber type.'), null, 'ch_model');
  if (chamber?.custom) {
    if (isBlank(f.cc_model)) add('warn', 'common', L('Укажите модель своей камеры: она попадёт в протокол.', 'Enter the model of your chamber: it will appear in the report.'), null, 'cc_model');
  }
  if (chamber?.sleeve) {
    add(
      'info',
      'common',
      L(
        'Камера не водонепроницаема: используйте тот же чехол (ПММА ≤ 1 мм), что и при калибровке.',
        'The chamber is not waterproof: use the same waterproofing sleeve (PMMA ≤ 1 mm) as at calibration.',
      ),
      `${REF.tg51}, разд. V.A; ${REF.trs}, разд. 6.2.2`,
    );
  }

  // Рабочая камера, откалиброванная перекрёстно в клиническом пучке Q_cross (TRS-398, разд. 4.5.2–4.5.3):
  // вместо N_D,w в ⁶⁰Co — N_D,w,Qcross, k_Q,Qcross = k_Q/k_Qcross (ур. 30). TG-51 такого пути не описывает.
  const cross = f.ch_cal_route === 'cross';
  const ndwKey = cross ? 'ch_cross_ndw' : 'ch_ndw';
  const ndwRaw = read(ndwKey, cross ? 'N_D,w,Qcross' : 'N_D,w');
  const ndw = Number.isFinite(ndwRaw) ? ndwToGyPerNC(ndwRaw, cross ? f.ch_cross_ndw_unit : f.ch_ndw_unit) : NaN;
  if (Number.isFinite(ndw) && (ndw < 1e-3 || ndw > 5)) {
    const v = dec(ndw.toPrecision(4));
    add('warn', 'common', L(`N_D,w = ${v} Гр/нКл выглядит неправдоподобно: проверьте единицы.`, `N_D,w = ${v} Gy/nC looks implausible: check the units.`), null, ndwKey);
  }
  let tprCross = NaN;
  if (cross) {
    if (want51) {
      add(
        'error',
        'tg51',
        L(
          'TG-51 и его аддендумы не описывают калибровку рабочей камеры в клиническом пучке МВ фотонов: для такой камеры считайте по TRS-398 (разд. 4.5.2–4.5.3).',
          'TG-51 and its addenda do not describe calibrating a field chamber in a clinical MV photon beam: for such a chamber, calculate per TRS-398 (Sec. 4.5.2–4.5.3).',
        ),
        `${REF.trs}, разд. 4.5.2`,
        'ch_cal_route',
      );
    } else {
      tprCross = read('ch_cross_tpr', L('TPR20,10 пучка перекрёстной калибровки', 'TPR20,10 of the cross-calibration beam'), 'trs');
      if (Number.isFinite(tprCross) && (tprCross < 0.5 || tprCross > 0.9)) {
        add('error', 'trs', L(`TPR20,10 пучка перекрёстной калибровки ${ru(tprCross, 3)} неправдоподобно.`, `TPR20,10 of the cross-calibration beam ${ru(tprCross, 3)} is implausible.`), null, 'ch_cross_tpr');
        tprCross = NaN;
      }
    }
  }
  // Поправочный множитель из протокола поверки (в протоколах ВНИИФТРИ — «значение поправочного
  // множителя K» рядом с N_D): калибровочный коэффициент умножается на него. Протоколы TG-51 и
  // TRS-398 такой величины не вводят; пустое поле — 1. Для перекрёстно откалиброванной камеры он
  // уже учтён в N_D,w,Qcross (через коэффициент опорной камеры).
  const klab = cross || isBlank(f.ch_klab) ? 1 : parseNumber(f.ch_klab);
  if (!Number.isFinite(klab) || klab <= 0) add('error', 'common', L('Не удалось прочитать k_лаб: введите поправочный множитель из протокола поверки (обычно 1,000).', 'Could not read k_lab: enter the correction multiplier from the calibration certificate (usually 1.000).'), null, 'ch_klab');
  else if (Math.abs(klab - 1) > 0.05) add('warn', 'common', L('k_лаб отличается от 1 больше чем на 5 %: проверьте протокол поверки.', 'k_lab differs from 1 by more than 5%: check the calibration certificate.'), null, 'ch_klab');
  const ndwEff = ndw * klab; // N_D,w с поправочным множителем лаборатории
  const T0 = read('ch_T0', L('T₀ из сертификата', 'T₀ from the certificate'));
  const P0 = read('ch_P0', L('P₀ из сертификата', 'P₀ from the certificate'));
  if (Number.isFinite(T0) && (T0 < 15 || T0 > 25)) add('error', 'common', L('T₀ задаётся в °C (обычно 20 или 22).', 'T₀ is entered in °C (usually 20 or 22).'), null, 'ch_T0');
  if (Number.isFinite(T0) && f.protocol === 'tg51' && Math.abs(T0 - TG51.TG51_T0) > 1e-9) {
    add(
      'info',
      'tg51',
      L(
        'Проверьте стандартные условия в сертификате: у лабораторий ADCL это 22 °C и 101,33 кПа, в формуле P_TP используются значения из сертификата.',
        'Check the reference conditions in the certificate: for ADCLs they are 22 °C and 101.33 kPa; the P_TP formula uses the values from the certificate.',
      ),
      `${REF.tg51}, ур. (10)`,
    );
  }
  if (Number.isFinite(P0) && (P0 < 95 || P0 > 105)) add('warn', 'common', L('P₀ задаётся в кПа (обычно 101,325 или 101,33).', 'P₀ is entered in kPa (usually 101.325 or 101.33).'), null, 'ch_P0');
  const kelec = read('el_kelec', 'k_elec (P_elec)');
  if (Number.isFinite(kelec) && Math.abs(kelec - 1) > 0.02) {
    add('warn', 'common', L('k_elec отличается от 1 больше чем на 2 %: проверьте сертификат электрометра.', 'k_elec differs from 1 by more than 2%: check the electrometer calibration certificate.'), null, 'el_kelec');
  }

  // ------------------------------------------------------------ окружающая среда
  const T = read('env_T', L('Температура воды', 'Water temperature'));
  const Pin = read('env_P', L('Давление', 'Pressure'));
  const P = Number.isFinite(Pin) ? pressureToKPa(Pin, f.env_P_unit) : NaN;
  if (Number.isFinite(P) && (P < 50 || P > 110)) {
    add('error', 'common', L(`Давление ${ru(P, 2)} кПа вне правдоподобного диапазона: проверьте единицы.`, `Pressure ${ru(P, 2)} kPa is outside the plausible range: check the units.`), null, 'env_P');
  }
  const env = environmentChecks({ T, Hraw: f.env_H, keyT: 'env_T', keyH: 'env_H', parseNumber, isBlank, ru });
  env.items.forEach(([level, text, ref, key]) => add(level, 'common', text, ref, key));

  // ------------------------------------------------------------- показания
  const mu = read('rd_mu', L('Мониторные единицы', 'Monitor units'));
  if (Number.isFinite(mu) && mu <= 0) add('error', 'common', L('Число МЕ должно быть больше нуля.', 'The number of MU must be greater than zero.'), null, 'rd_mu');
  const V1 = read('rd_V1', L('Рабочее напряжение V₁', 'Operating voltage V₁'));
  const fixed = f.rd_fixed;
  const V2 = fixed ? NaN : read('rd_V2', L('Пониженное напряжение V₂', 'Reduced voltage V₂'));
  if (Number.isFinite(V1) && Number.isFinite(V2) && Math.abs(V1) <= Math.abs(V2)) {
    add('error', 'common', L('Рабочее напряжение V₁ должно быть больше пониженного V₂.', 'The operating voltage V₁ must be higher than the reduced voltage V₂.'), null, ['rd_V1', 'rd_V2']);
  }
  if (Number.isFinite(V1) && Math.abs(V1) > 300) {
    if (want51) {
      add('warn', 'tg51', L('Аддендум TG-51 рекомендует для цилиндрических камер не более 300 В.', 'The TG-51 addendum recommends no more than 300 V for cylindrical chambers.'), `${REF.add}, разд. 4.E`, 'rd_V1');
    }
  }
  const M1 = readCells('rd_M1', L('M при V₁, обычная полярность', 'M at V₁, normal polarity'));
  // при проверке выхода обратная полярность и V₂ не измеряются
  const Mopp = fixed ? parseCells([]) : readCells('rd_Mopp', L('M при V₁, обратная полярность', 'M at V₁, opposite polarity'));
  const M2 = fixed ? parseCells([]) : readCells('rd_M2', L('M при V₂', 'M at V₂'));
  let fixedKs = NaN;
  if (fixed) {
    const fk = read('rd_fixed_kpol', L('k_pol из калибровки', 'k_pol from the calibration'));
    fixedKs = read('rd_fixed_ks', L('k_s из калибровки', 'k_s from the calibration'));
    if (Number.isFinite(fk) && Math.abs(fk - 1) > 0.05) add('error', 'common', L(`k_pol из калибровки ${ru(fk, 4)} неправдоподобен.`, `k_pol from the calibration ${ru(fk, 4)} is implausible.`), null, 'rd_fixed_kpol');
    if (Number.isFinite(fixedKs) && (fixedKs < 1 || fixedKs > 1.05)) add('error', 'common', L(`k_s из калибровки ${ru(fixedKs, 4)} вне 1–1,05.`, `k_s from the calibration ${ru(fixedKs, 4)} is outside 1–1.05.`), null, 'rd_fixed_ks');
    const from = String(f.rd_fixed_from ?? '').trim();
    const [kp, kx] = want51 ? ['P_pol', 'P_ion'] : ['k_pol', 'k_s'];
    if (Number.isFinite(fk) && Number.isFinite(fixedKs)) {
      add(
        'info',
        'common',
        L(
          `Проверка выхода: ${kp} = ${ru(fk, 4)} и ${kx} = ${ru(fixedKs, 4)} взяты из калибровки${from ? ` от ${from}` : ''}, обратная полярность и V₂ не измерялись.`,
          `Output check: ${kp} = ${ru(fk, 4)} and ${kx} = ${ru(fixedKs, 4)} are taken from the calibration${from ? ` of ${from}` : ''}; the opposite polarity and V₂ were not measured.`,
        ),
        null,
      );
    }
  }
  const seriesChecks = [
    [M1, L('при V₁', 'at V₁'), 'rd_M1'],
    [Mopp, L('обратной полярности', 'at opposite polarity'), 'rd_Mopp'],
    [M2, L('при V₂', 'at V₂'), 'rd_M2'],
  ];
  for (const [s, label, key] of seriesChecks) {
    const d = maxRelDeviation(s);
    const pct = ru(d * 100, 2);
    if (d > 0.05) {
      add('error', 'common', L(`Показания ${label} расходятся на ${pct} % от среднего: вероятно, ошибка ввода.`, `Readings ${label} deviate by ${pct}% from the mean: probably an input error.`), null, key);
    } else if (d > 0.005) {
      add(
        'warn',
        'common',
        L(
          `Разброс показаний ${label} до ${pct} % от среднего: ускоритель или камера нестабильны; Report 374 советует повторять облучения, пока отклонение не станет меньше ±0,1 % без тренда.`,
          `Readings ${label} scatter by up to ${pct}% from the mean: the linac or the chamber is unstable; Report 374 advises repeating irradiations until the deviation is below ±0.1% with no trend.`,
        ),
        `${REF.r374}, разд. 4.4.2`,
        key,
      );
    } else if (d > 0.001) {
      add(
        'info',
        'common',
        L(
          `Разброс показаний ${label} до ${pct} % от среднего: Report 374 советует повторять облучения, пока отклонение не станет меньше ±0,1 % без тренда.`,
          `Readings ${label} scatter by up to ${pct}% from the mean: Report 374 advises repeating irradiations until the deviation is below ±0.1% with no trend.`,
        ),
        `${REF.r374}, разд. 4.4.2`,
        key,
      );
    }
  }
  const kleak = read('rd_kleak', L('Поправка на утечку', 'Leakage correction'));
  if (Number.isFinite(kleak) && Math.abs(kleak - 1) > 0.001) {
    add(
      'warn',
      'common',
      L(
        'Утечка больше 0,1 % показания: камера не отвечает критерию эталонного класса, причину нужно выяснить.',
        'Leakage exceeds 0.1% of the reading: the chamber does not meet the reference-class criterion; the cause must be investigated.',
      ),
      `${REF.add}, табл. III; ${REF.trs}, табл. 3`,
      'rd_kleak',
      L('утечка больше 0,1 %: камера не отвечает критерию эталонного класса', 'leakage above 0.1%: the chamber does not meet the reference-class criterion'),
    );
  }

  const readingsOk = M1.n > 0 && !M1.error && M1.mean !== 0;
  const m1 = readingsOk ? Math.abs(M1.mean) : NaN;

  // полярность
  let kpolRaw = fixed ? parseNumber(f.rd_fixed_kpol) : NaN;
  if (!fixed && readingsOk && Mopp.n > 0 && !Mopp.error) {
    kpolRaw = polarity(M1.mean, Mopp.mean);
    if (Math.abs(kpolRaw - 1) > 0.004) {
      add(
        'warn',
        'common',
        L(
          `k_pol = ${ru(kpolRaw, 4)} выходит за пределы 1 ± 0,004: для камеры эталонного класса эффект полярности должен быть меньше 0,4 %. Проверьте камеру, кабель и время стабилизации после смены полярности.`,
          `k_pol = ${ru(kpolRaw, 4)} is outside 1 ± 0.004: for a reference-class chamber the polarity effect must be below 0.4%. Check the chamber, the cable and the stabilization time after changing polarity.`,
        ),
        `${REF.trs}, табл. 3; ${REF.add}, табл. III`,
        'kpol',
        L(`k_pol = ${ru(kpolRaw, 4)}: эффект полярности больше 0,4 % (критерий эталонного класса)`, `k_pol = ${ru(kpolRaw, 4)}: polarity effect above 0.4% (reference-class criterion)`),
      );
    }
    if (Math.abs(kpolRaw - 1) > 0.003 && Number.isFinite(energy) && energy <= 6 && f.lab_pol_applied && want51) {
      add(
        'info',
        'tg51',
        L(
          'P_pol отличается от 1 больше чем на 0,3 % при энергии ≤ 6 МВ: TG-51 требует знать P_pol в пучке лаборатории. Если лаборатория не вносила поправку на полярность, снимите отметку в разделе 2 и введите это значение.',
          'P_pol differs from 1 by more than 0.3% at an energy ≤ 6 MV: TG-51 requires P_pol in the laboratory beam to be known. If the laboratory did not apply a polarity correction, clear the checkbox in section 2 and enter that value.',
        ),
        `${REF.tg51}, разд. VII.A`,
        'kpol',
      );
    }
  }
  // поправки лаборатории относятся к калибровке в ⁶⁰Co; при перекрёстной калибровке показания уже полностью исправлены
  let kpolQ0 = 1;
  if (!f.lab_pol_applied && !cross) kpolQ0 = read('lab_kpol', L('Поправка на полярность при калибровке', 'Polarity correction at calibration'));
  const kpol = kpolRaw / kpolQ0;

  // рекомбинация
  const nV = Math.abs(V1) / Math.abs(V2);
  const recOk = readingsOk && M2.n > 0 && !M2.error && M2.mean !== 0 && Number.isFinite(nV) && nV > 1;
  if (readingsOk && M2.n > 0 && Math.sign(M1.mean) !== Math.sign(M2.mean)) {
    add('error', 'common', L('Показания при V₁ и V₂ должны быть сняты при одной и той же (обычной) полярности.', 'Readings at V₁ and V₂ must be taken at the same (normal) polarity.'), null, 'rd_M2');
  }
  const ratio12 = recOk ? Math.abs(M1.mean) / Math.abs(M2.mean) : NaN;
  if (recOk && ratio12 < 1) {
    add(
      'error',
      'common',
      L(
        'k_s (P_ion) не может быть меньше 1: при пониженном напряжении собирается меньше заряда. Показание при V₂ больше, чем при V₁ — проверьте показания и напряжения.',
        'k_s (P_ion) cannot be less than 1: less charge is collected at the reduced voltage. The reading at V₂ is greater than at V₁ — check the readings and the voltages.',
      ),
      `${REF.trs}, разд. 4.4.3.4`,
      ['ks', 'Pion', 'rd_M2'],
    );
  }
  let ksQ0 = 1;
  if (!f.lab_ks_applied && !cross) ksQ0 = read('lab_ks', L('Поправка на рекомбинацию при калибровке', 'Recombination correction at calibration'));

  // ------------------------------------------------------------- TRS-398
  const trs = { enabled: wantTRS };
  if (wantTRS) {
    trs.kTP = temperaturePressure({ T, P, T0, P0, abs0: TRS.TRS_ABS0 });
    trs.kelec = kelec;
    trs.kpol = kpol;
    trs.kpolRaw = kpolRaw;
    trs.kpolQ0 = kpolQ0;
    trs.kleak = kleak;
    if (recOk) {
      const r = TRS.ks({ m1: M1.mean, m2: M2.mean, v1: Math.abs(V1), v2: Math.abs(V2), beam: f.rd_beam });
      trs.ksRaw = r.value;
      trs.ksEquation = r.equation;
      if (r.error) add('error', 'trs', cap(r.error) + '.', `${REF.trs}, табл. 10`, 'ks');
      r.notes.forEach((n) => add('warn', 'trs', cap(n) + '.', `${REF.trs}, разд. 4.4.3.4`, 'ks'));
      if (nV < 3 - 1e-9) add('info', 'trs', L('TRS-398 рекомендует отношение напряжений V₁/V₂ ≥ 3.', 'TRS-398 recommends a voltage ratio V₁/V₂ ≥ 3.'), `${REF.trs}, разд. 4.4.3.4`);
      trs.ks = r.value / ksQ0;
      trs.ksQ0 = ksQ0;
      // Пороги относятся к рекомбинации в пучке пользователя, то есть к измеренному k_s. Отношение k_s,Q/k_s,Q₀
      // (если лаборатория не вносила поправку) может законно быть и меньше 1.
      if (trs.ksRaw > 1.05) {
        add(
          'error',
          'trs',
          L(
            `k_s = ${ru(trs.ksRaw, 4)} > 1,05: метод двух напряжений неприменим, нужна другая камера или другой метод.`,
            `k_s = ${ru(trs.ksRaw, 4)} > 1.05: the two-voltage method is not applicable; another chamber or another method is needed.`,
          ),
          `${REF.trs}, табл. 3`,
          'ks',
        );
      }
      if (ratio12 >= 1 && trs.ksRaw < 1) {
        add(
          'error',
          'trs',
          L(
            `k_s = ${ru(trs.ksRaw, 4)} < 1: так быть не может, проверьте показания и напряжения.`,
            `k_s = ${ru(trs.ksRaw, 4)} < 1: this is impossible; check the readings and the voltages.`,
          ),
          `${REF.trs}, разд. 4.4.3.4`,
          'ks',
        );
      }
    } else if (fixed && Number.isFinite(fixedKs)) {
      trs.ksRaw = fixedKs;
      trs.ks = fixedKs / ksQ0;
      trs.ksQ0 = ksQ0;
      trs.ksFixed = true;
      const fromTxt = String(f.rd_fixed_from ?? '').trim();
      trs.ksEquation = L(`из калибровки${fromTxt ? ` от ${fromTxt}` : ''} (проверка выхода)`, `from the calibration${fromTxt ? ` of ${fromTxt}` : ''} (output check)`);
    } else {
      trs.ks = NaN;
    }

    // качество пучка
    let tpr = NaN;
    const v20 = parseNumber(f.qtrs_v20);
    const v10 = parseNumber(f.qtrs_v10);
    const label20 = f.qtrs_method === 'pdd2010' ? 'PDD(20)' : L('M на 20 см', 'M at 20 cm');
    const label10 = f.qtrs_method === 'pdd2010' ? 'PDD(10)' : L('M на 10 см', 'M at 10 cm');
    if (!Number.isFinite(v20)) read('qtrs_v20', label20, 'trs');
    if (!Number.isFinite(v10)) read('qtrs_v10', label10, 'trs');
    if (Number.isFinite(v10) && v10 === 0) add('error', 'trs', L(`${label10} не может быть нулевым.`, `${label10} cannot be zero.`), null, 'qtrs_v10');
    if (Number.isFinite(v20) && Number.isFinite(v10) && v10 !== 0) {
      let ratio = Math.abs(v20) / Math.abs(v10);
      // поправка на рекомбинацию по глубине: k_s(20)/k_s(10), общая часть пропорциональна показанию
      const rc = recDepth(trs.ksRaw, 'trs');
      if (rc) {
        const ks20 = ksAtRatio(rc.ks, rc.ci, ratio);
        trs.recDepth = { ks10: rc.ks, ks20, factor: ks20 / rc.ks, raw: ratio, ksSource: rc.src };
        ratio *= ks20 / rc.ks;
        add('info', 'trs', L(`Поправка на рекомбинацию по глубине: k_s(20)/k_s(10) = ${ru(ks20 / rc.ks, 5)}; без неё отношение ${ru(trs.recDepth.raw, 4)}.`, `Recombination correction with depth: k_s(20)/k_s(10) = ${ru(ks20 / rc.ks, 5)}; without it the ratio is ${ru(trs.recDepth.raw, 4)}.`), `${REF.trs}, разд. 4.4.3.4 e, 6.3.2`);
        messages[messages.length - 1].recDepth = true;
      }
      if (f.qtrs_method === 'pdd2010') {
        tpr = TRS.tprFromPdd2010(ratio);
        trs.tprEquation = L('сноска 36: TPR20,10 = 1,2661·PDD(20)/PDD(10) − 0,0595', 'footnote 36: TPR20,10 = 1.2661·PDD(20)/PDD(10) − 0.0595');
        trs.pdd2010 = ratio;
        if (fff) {
          add(
            'info',
            'trs',
            L(
              'Формула TPR20,10 через PDD20,10 выведена для пучков с выравнивающим фильтром; по TRS-398 её можно с известной долей точности применять и к БВФ.',
              'The TPR20,10–PDD20,10 relation was derived for beams with a flattening filter; according to TRS-398 it can also be applied to FFF beams to a reasonable approximation.',
            ),
            `${REF.trs}, сноска 36`,
          );
        }
      } else {
        tpr = ratio;
        trs.tprEquation = L(
          'TPR20,10 = M(20 см)/M(10 см) при РИК 100 см, поле 10 × 10 см в плоскости камеры',
          'TPR20,10 = M(20 cm)/M(10 cm) at SCD 100 cm, 10 × 10 cm field at the chamber plane',
        );
      }
    }
    if (Number.isFinite(tpr) && (tpr < 0.5 || tpr > 0.9)) {
      add(
        'error',
        'trs',
        L(`TPR20,10 = ${ru(tpr, 3)} неправдоподобно: проверьте значения на 20 и 10 см.`, `TPR20,10 = ${ru(tpr, 3)} is implausible: check the values at 20 and 10 cm.`),
        null,
        ['tpr', 'qtrs_v20', 'qtrs_v10'],
      );
    }
    trs.tpr = tpr;
    if (fff && Number.isFinite(energy) && energy > 10) {
      add('warn', 'trs', L('TRS-398 Rev.1 распространяется на пучки БВФ только до ~10 МВ.', 'TRS-398 Rev.1 covers FFF beams only up to ~10 MV.'), `${REF.trs}, разд. 6.1`, null, L(`пучок БВФ ${ru(energy, energy % 1 ? 1 : 0)} МВ: выше ~10 МВ`, `${ru(energy, energy % 1 ? 1 : 0)} MV FFF beam: above ~10 MV`));
    } else if (fff && !Number.isFinite(energy)) {
      add(
        'warn',
        'trs',
        L(
          'Укажите номинальную энергию пучка (раздел 1): TRS-398 Rev.1 распространяется на пучки БВФ только до ~10 МВ, без энергии это не проверить.',
          'Enter the nominal beam energy (section 1): TRS-398 Rev.1 covers FFF beams only up to ~10 MV, and this cannot be checked without the energy.',
        ),
        `${REF.trs}, разд. 6.1`,
        'meta_energy',
      );
    }

    // оценка TPR20,10 для БВФ по PDD(10) — только для сравнения
    if (fff) {
      // sourceKey: 'entered' | 'pdd2010' | 'dd' — не зависит от языка; source — подпись для интерфейса
      let src = null;
      let srcKey = null;
      let pdd10 = parseNumber(f.qtrs_fff_pdd10);
      if (Number.isFinite(pdd10)) {
        src = L('введено', 'entered');
        srcKey = 'entered';
      } else if (f.qtrs_method === 'pdd2010' && Number.isFinite(v10)) {
        pdd10 = v10;
        src = L('PDD(10) из определения TPR20,10', 'PDD(10) from the TPR20,10 determination');
        srcKey = 'pdd2010';
      } else if (geo.kind === 'SSD' && Number.isFinite(parseNumber(f.dd_pdd))) {
        pdd10 = parseNumber(f.dd_pdd);
        src = L('PDD(10) из раздела 8', 'PDD(10) from section 8');
        srcKey = 'dd';
      }
      if (Number.isFinite(pdd10)) {
        if (pdd10 < 50 || pdd10 > 90) {
          add(
            'warn',
            'trs',
            L('PDD(10) для оценки TPR20,10 вне 50–90 %: проверьте ввод.', 'PDD(10) for the TPR20,10 estimate is outside 50–90%: check the input.'),
            null,
            srcKey === 'entered' ? 'qtrs_fff_pdd10' : null,
          );
        }
        const est = TRS.tprEstimateFromPdd10(pdd10);
        trs.fffEstimate = { pdd10, value: est, source: src, sourceKey: srcKey, diff: Number.isFinite(tpr) ? (tpr / est - 1) * 100 : NaN };
      }
    }

    // k_Q: формула (34), табл. 16, вручную
    const kf = TRS.kQ(chamber, tpr);
    const kt = TRS.kQFromTable(chamber, tpr);
    trs.kQFormula = kf.value;
    trs.kQTable = kt.value;
    if (Number.isFinite(kf.value) && Number.isFinite(kt.value)) trs.kQDiff = (kt.value / kf.value - 1) * 100;
    const mode = f.kqtrs_mode;
    if (mode === 'manual') {
      trs.kQ = read('kqtrs_manual', cross ? 'k_Q,Qcross (TRS-398)' : L('k_Q (TRS-398), измеренный в лаборатории', 'k_Q (TRS-398) measured by the laboratory'), 'trs');
      trs.kQSource = cross ? L('k_Q,Qcross введён вручную', 'k_Q,Qcross entered manually') : L('измерен в лаборатории для этой камеры', 'measured by the laboratory for this chamber');
      if (Number.isFinite(trs.kQ) && (trs.kQ < 0.9 || trs.kQ > 1.02)) {
        add('warn', 'trs', L('k_Q для МВ фотонов обычно 0,94–1,00: проверьте ввод.', 'k_Q for MV photons is usually 0.94–1.00: check the input.'), null, 'kqtrs_manual');
      }
    } else {
      const k = mode === 'table' ? kt : kf;
      if (!chamber || isBlank(f.ch_model)) {
        /* ошибка «выберите камеру» уже есть */
      } else if (chamber.custom && !chamber.trs) {
        add(
          'error',
          'trs',
          L(
            'Для своей камеры нет данных TRS-398: выберите аналог из табл. 45, задайте a и b или введите k_Q, измеренный в лаборатории.',
            'There are no TRS-398 data for your chamber: select an analogue chamber from Table 45, enter a and b, or enter k_Q measured by the laboratory.',
          ),
          `${REF.trs}, разд. 6.5`,
          ['kQtrs', 'cc_analog'],
        );
      } else if (!chamber.trs) {
        add(
          'error',
          'trs',
          L('Для этой камеры в TRS-398 Rev.1 нет k_Q: введите значение, измеренное в лаборатории.', 'TRS-398 Rev.1 gives no k_Q for this chamber: enter the value measured by the laboratory.'),
          `${REF.trs}, табл. 45`,
          'kQtrs',
        );
      } else if (mode === 'table' && !chamber.trsTable) {
        add(
          'error',
          'trs',
          L('Табличные значения есть только для камер из табл. 16: выберите расчёт по формуле (34).', 'Tabulated values exist only for the chambers in Table 16: select calculation by Eq. (34).'),
          `${REF.trs}, табл. 16`,
          'kQtrs',
        );
      } else if (k.error && Number.isFinite(tpr)) {
        add('error', 'trs', cap(k.error) + '.', `${REF.trs}, табл. 16`, ['kQtrs', 'tpr']);
      }
      trs.kQ = k.value;
      trs.kQSource = k.source;
      if (cross) {
        // ур. (30): k_Q,Qcross = k_Q(Q)/k_Q(Q_cross), оба — тем же способом (табл. 16 или ур. 34)
        const kc = mode === 'table' ? TRS.kQFromTable(chamber, tprCross) : TRS.kQ(chamber, tprCross);
        trs.kQcross = kc.value;
        trs.kQQ = k.value;
        if (kc.error && Number.isFinite(tprCross) && chamber?.trs) add('error', 'trs', L(`k_Q в пучке перекрёстной калибровки: ${kc.error}.`, `k_Q in the cross-calibration beam: ${kc.error}.`), `${REF.trs}, табл. 16`, ['kQtrs', 'ch_cross_tpr']);
        trs.kQ = k.value / kc.value;
        trs.kQSource = L(
          `ур. (30): k_Q,Qcross = k_Q(TPR20,10)/k_Q(TPR20,10 пучка перекрёстной калибровки = ${ru(tprCross, 3)}); ${k.source || ''}`,
          `Eq. (30): k_Q,Qcross = k_Q(TPR20,10)/k_Q(TPR20,10 of the cross-calibration beam = ${ru(tprCross, 3)}); ${k.source || ''}`,
        );
      }
      if (chamber?.custom && chamber.trs) {
        if (chamber.hasAB) {
          add('info', 'trs', L('k_Q рассчитан по ур. (34) с параметрами a и b, введёнными для своей камеры.', 'k_Q is calculated by Eq. (34) with the parameters a and b entered for your chamber.'), `${REF.trs}, ур. (34)`);
        } else {
          const an = chamberLabel(chamber.analog);
          add(
            'warn',
            'trs',
            L(
              `В TRS-398 Rev.1 нет данных для этой камеры; k_Q взят по камере-аналогу ${an}. Предпочтительнее k_Q, измеренный в лаборатории.`,
              `TRS-398 Rev.1 has no data for this chamber; k_Q is taken from the analogue chamber ${an}. A k_Q measured by the laboratory is preferable.`,
            ),
            `${REF.trs}, разд. 6.5`,
            'kQtrs',
            L(`k_Q по камере-аналогу ${an}: в TRS-398 Rev.1 нет данных для этой камеры`, `k_Q from the analogue chamber ${an}: TRS-398 Rev.1 has no data for this chamber`),
          );
        }
      }
    }
    // Камеры, включённые в TRS-398 Rev.1 только для пучков БВФ (табл. 4; табл. 16, прим. b): в пучке БВФ — справка,
    // в пучке с выравнивающим фильтром — отступление от протокола.
    if (!chamber?.custom) {
      for (const n of (chamber?.notes || []).filter((x) => x.scope === 'trs')) {
        if (n.fffOnly && fff) add('info', 'trs', noteText(n), null, null);
        else if (n.fffOnly) {
          add(
            'warn',
            'trs',
            `${noteText(n)} ${L('Для пучков с выравнивающим фильтром TRS-398 Rev.1 её не предусматривает: для них нужна камера эталонного класса.', 'TRS-398 Rev.1 does not provide for it in beams with a flattening filter: a reference-class chamber is needed for them.')}`,
            `${REF.trs}, табл. 4, 16`,
            'ch_model',
            L(`${chamberLabel(chamber)} в пучке с выравнивающим фильтром: камера включена в протокол только для БВФ`, `${chamberLabel(chamber)} in a beam with a flattening filter: the chamber is included in the protocol for FFF beams only`),
          );
        } else add(n.level, 'trs', noteText(n));
      }
    }
  }

  // ------------------------------------------------------------- TG-51
  const tg = { enabled: want51 };
  if (want51) {
    tg.PTP = temperaturePressure({ T, P, T0, P0, abs0: TG51.TG51_ABS0 });
    tg.Pelec = kelec;
    tg.Ppol = kpol;
    tg.PpolRaw = kpolRaw;
    tg.PpolQ0 = kpolQ0;
    tg.Pleak = kleak;
    if (recOk) {
      tg.PionRaw = TG51.pIon({ mH: M1.mean, mL: M2.mean, vH: Math.abs(V1), vL: Math.abs(V2), beam: 'pulsed' });
      if (nV < 2 - 1e-9) {
        add(
          'warn',
          'tg51',
          L('TG-51: пониженное напряжение должно быть меньше рабочего как минимум вдвое.', 'TG-51: the reduced voltage must be no more than half the operating voltage.'),
          `${REF.tg51}, разд. VII.D.2`,
          ['rd_V1', 'rd_V2'],
        );
      }
      if (tg.PionRaw > 1.05) {
        add(
          'error',
          'tg51',
          L(
            `P_ion = ${ru(tg.PionRaw, 4)} > 1,05: неопределённость поправки недопустима, нужна другая камера.`,
            `P_ion = ${ru(tg.PionRaw, 4)} > 1.05: the uncertainty of the correction is unacceptable; another chamber is needed.`,
          ),
          `${REF.tg51}, разд. VII.D.1`,
          'Pion',
        );
      }
      tg.Pion = tg.PionRaw / ksQ0;
      tg.PionQ0 = ksQ0;
      if (ratio12 >= 1 && tg.PionRaw < 1) {
        add(
          'error',
          'tg51',
          L(
            `P_ion = ${ru(tg.PionRaw, 4)} < 1: так быть не может, проверьте показания и напряжения.`,
            `P_ion = ${ru(tg.PionRaw, 4)} < 1: this is impossible; check the readings and the voltages.`,
          ),
          `${REF.tg51}, разд. VII.D`,
          'Pion',
        );
      }
      if (!f.lab_ks_applied) {
        add(
          'info',
          'tg51',
          L(
            'TG-51 предполагает, что N_D,w отнесён к полному собиранию заряда. Раз лаборатория не вносила поправку на рекомбинацию, P_ion поделён на её значение при калибровке.',
            'TG-51 assumes that N_D,w refers to full charge collection. Since the laboratory did not apply a recombination correction, P_ion has been divided by its value at calibration.',
          ),
          `${REF.tg51}, ур. (7), разд. VII.D.1`,
        );
      }
    } else if (fixed && Number.isFinite(fixedKs)) {
      tg.PionRaw = fixedKs;
      tg.Pion = fixedKs / ksQ0;
      tg.PionQ0 = ksQ0;
      tg.PionFixed = true;
    } else {
      tg.Pion = NaN;
    }

    // поправка на рекомбинацию по глубине: %dd(10) × P_ion(10)/P_ion(d_max), общая часть пропорциональна показанию
    let pdd10In = parseNumber(f.q51_pdd10);
    let pdd10PbIn = parseNumber(f.q51_pdd10pb);
    if (f.q_rec_on && ['open', 'interim', 'foil50', 'foil30'].includes(f.q51_method)) {
      const foil = f.q51_method.startsWith('foil');
      const raw = foil ? pdd10PbIn : pdd10In;
      const rc = Number.isFinite(raw) && raw > 0 ? recDepth(tg.PionRaw, 'tg51') : null;
      if (rc) {
        const ksMax = ksAtRatio(rc.ks, rc.ci, 100 / raw);
        tg.recDepth = { ks10: rc.ks, ksMax, factor: rc.ks / ksMax, raw, ksSource: rc.src };
        if (foil) pdd10PbIn = raw * tg.recDepth.factor;
        else pdd10In = raw * tg.recDepth.factor;
        add('info', 'tg51', L(`Поправка на рекомбинацию по глубине: P_ion(10)/P_ion(d_max) = ${ru(tg.recDepth.factor, 5)}; %dd(10)${foil ? 'Pb' : ''} без неё ${ru(raw, 2)} %.`, `Recombination correction with depth: P_ion(10)/P_ion(d_max) = ${ru(tg.recDepth.factor, 5)}; %dd(10)${foil ? 'Pb' : ''} without it ${ru(raw, 2)}%.`), `${REF.trs}, разд. 4.4.3.4 e`);
        messages[messages.length - 1].recDepth = true;
      }
    }
    const q = TG51.pdd10x({
      method: f.q51_method,
      pdd10: pdd10In,
      pdd10Pb: pdd10PbIn,
      manual: parseNumber(f.q51_manual),
    });
    if (q.error) add('error', 'tg51', cap(q.error) + '.', `${REF.tg51}, разд. VIII.B`, 'pdd10x');
    tg.pdd10x = q.value;
    tg.pdd10xEquation = q.equation;
    if (fff && f.q51_method === 'interim') {
      add(
        'error',
        'tg51',
        L(
          'Промежуточная формула (15) верна только для пучков с выравнивающим фильтром; для БВФ измерьте %dd(10)Pb со свинцовой фольгой.',
          'The interim formula (15) is valid only for beams with a flattening filter; for FFF beams measure %dd(10)Pb with the lead foil.',
        ),
        `${REF.add}, разд. 4.K(3)`,
        'q51_method',
      );
    } else if (fff && f.q51_method === 'open') {
      add(
        'warn',
        'tg51',
        L(
          'Для всех пучков БВФ, в том числе ниже 10 МВ, %dd(10) измеряют со свинцовой фольгой. Расчёт без фольги — отступление от прямых рекомендаций аддендума TG-51 и Report 374: результат можно использовать только для сравнения.',
          'For all FFF beams, including those below 10 MV, %dd(10) is measured with the lead foil. A calculation without the foil departs from the explicit recommendations of the TG-51 addendum and Report 374: the result may be used for comparison only.',
        ),
        `${REF.add}, разд. 4.K(3); ${REF.r374}, разд. 3.3`,
        'q51_method',
        L('%dd(10) пучка БВФ без свинцовой фольги', '%dd(10) of an FFF beam without the lead foil'),
      );
    } else if (f.q51_method === 'interim' && !q.error) {
      add(
        'info',
        'tg51',
        L(
          'Формула (15) без фольги допустима только для пучков с фильтром и при расстоянии от шторок до поверхности воды не меньше 45 см; в бюджет неопределённости добавляют компонент (ошибка k_Q до ~0,2 %).',
          'The no-foil formula (15) is acceptable only for beams with a flattening filter and a jaw-to-water-surface distance of at least 45 cm; an extra component is added to the uncertainty budget (k_Q error up to ~0.2%).',
        ),
        `${REF.tg51}, разд. VIII.B; ${REF.add}, разд. 4.H`,
      );
    }
    if ((f.q51_method === 'foil50' || f.q51_method === 'foil30') && !q.error) {
      add(
        'info',
        'tg51',
        L('Уберите свинцовую фольгу перед измерением дозы: забытая фольга даёт ошибку до 5 %.', 'Remove the lead foil before measuring the dose: a forgotten foil causes an error of up to 5%.'),
        `${REF.r374}, разд. 3.3`,
      );
    }

    if (f.kq51_manual_on) {
      tg.kQ = read('kq51_manual', L('k_Q (TG-51) вручную', 'k_Q (TG-51), manual'), 'tg51');
      tg.kQSource = L('введено вручную', 'entered manually');
    } else {
      const k = TG51.kQ(chamber, q.value);
      if (!chamber || isBlank(f.ch_model)) {
        /* ошибка «выберите камеру» уже есть */
      } else if (chamber.custom && !chamber.tg51 && !chamber.tg51Legacy) {
        add(
          'error',
          'tg51',
          L('Для своей камеры выберите аналог с данными TG-51 или введите k_Q вручную.', 'For your chamber, select an analogue chamber with TG-51 data or enter k_Q manually.'),
          `${REF.tg51}, разд. XI`,
          ['kQ51', 'cc_analog'],
        );
      } else if (!chamber.tg51 && !chamber.tg51Legacy) {
        add('error', 'tg51', L('Для этой камеры в TG-51 нет k_Q: введите значение вручную.', 'TG-51 gives no k_Q for this chamber: enter the value manually.'), `${REF.add}, табл. I`, 'kQ51');
      } else if (k.error && Number.isFinite(q.value)) {
        add('error', 'tg51', cap(k.error) + '.', `${REF.add}, табл. I`, ['kQ51', 'pdd10x']);
      }
      tg.kQ = k.value;
      tg.kQSource = k.source;
      if (chamber?.custom && (chamber.tg51 || chamber.tg51Legacy)) {
        const an = chamberLabel(chamber.analog);
        add(
          'info',
          'tg51',
          L(
            `k_Q взят по ближайшей камере ${an}. TG-51: совпадать должны материал стенки, радиус полости, наличие алюминиевого электрода и толщина стенки; тогда точность около 0,5 %.`,
            `k_Q is taken from the closest chamber, ${an}. TG-51: the wall material, cavity radius, presence of an aluminum electrode and wall thickness must match; the accuracy is then about 0.5%.`,
          ),
          `${REF.tg51}, разд. XI`,
        );
      } else if (chamber?.tg51Legacy) {
        add(
          'info',
          'tg51',
          L('Для этой камеры используются данные исходного TG-51 (1999): в аддендуме её нет.', 'Data from the original TG-51 (1999) are used for this chamber: it is not included in the addendum.'),
          `${REF.add}, разд. 3.E`,
        );
      }
    }
    if (!chamber?.custom) (chamber?.notes || []).filter((n) => n.scope === 'tg51').forEach((n) => add(n.level, 'tg51', noteText(n)));
  }

  // --------------------------------------- поправка на профиль (k_vol / P_rp)
  let lengthMm = parseNumber(f.prof_length);
  if (!Number.isFinite(lengthMm) && Number.isFinite(chamber?.lengthMm)) lengthMm = chamber.lengthMm;
  const sddGeometry = geo.kind === 'SAD' ? 100 : geo.ssd + geo.depth;
  let sddCm = parseNumber(f.prof_sdd);
  if (!Number.isFinite(sddCm)) sddCm = sddGeometry;

  let prof = { value: 1, method: L('не применяется: пучок с выравнивающим фильтром', 'not applicable: beam with a flattening filter'), active: false };
  if (fff) {
    prof = { value: NaN, method: '', active: true };
    const tpr = trs.tpr;
    const needTpr = () => {
      if (!wantTRS) {
        add(
          'error',
          'common',
          L(
            'Для расчёта k_vol по TRS-398 нужен TPR20,10: включите протокол TRS-398 или введите значение вручную.',
            'Calculating k_vol per TRS-398 requires TPR20,10: enable the TRS-398 protocol or enter the value manually.',
          ),
          null,
          'prof_mode',
        );
      }
    };
    const noLength = () => add('error', 'common', L('Укажите длину полости камеры (мм).', 'Enter the chamber cavity length (mm).'), null, 'prof_length');
    if (f.prof_mode === 'manual') {
      const v = read('prof_value', 'k_vol / P_rp');
      prof = { value: v, method: L('введено вручную', 'entered manually'), active: true };
    } else if (f.prof_mode === 'formula22' || f.prof_mode === 'table11') {
      needTpr();
      if (!Number.isFinite(lengthMm)) noLength();
      else if (lengthMm <= 0) add('error', 'common', L('Длина полости должна быть больше нуля.', 'The cavity length must be greater than zero.'), null, 'prof_length');
      else if (wantTRS && Number.isFinite(tpr)) {
        const Ltxt = ru(lengthMm, 1);
        if (lengthMm < 1 || lengthMm > 40) {
          add(
            'warn',
            'common',
            L(`Длина полости ${Ltxt} мм необычна: проверьте, что она введена в миллиметрах.`, `A cavity length of ${Ltxt} mm is unusual: check that it is entered in millimeters.`),
            null,
            'prof_length',
          );
        }
        if (f.prof_mode === 'formula22' && (sddCm < 80 || sddCm > 150)) {
          add(
            'warn',
            'common',
            L(`РИД ${ru(sddCm, 0)} см необычно: проверьте, что оно введено в сантиметрах.`, `An SDD of ${ru(sddCm, 0)} cm is unusual: check that it is entered in centimeters.`),
            null,
            'prof_sdd',
          );
        }
        if (f.prof_mode === 'formula22') {
          const v = TRS.kvolGeneric({ tpr, lengthCm: lengthMm / 10, sddCm });
          prof = {
            value: v,
            method: L(`ур. (22) TRS-398: L = ${Ltxt} мм, РИД = ${ru(sddCm, 0)} см`, `TRS-398 Eq. (22): L = ${Ltxt} mm, SDD = ${ru(sddCm, 0)} cm`),
            active: true,
          };
        } else {
          const r = TRS.kvolFromTable11({ tpr, lengthCm: lengthMm / 10 });
          if (r.error) {
            add(
              'error',
              'common',
              L(cap(r.error) + '. Используйте формулу (22) или своё значение.', cap(r.error) + '. Use Eq. (22) or your own value.'),
              `${REF.trs}, табл. 11`,
              ['kvol', 'prof_length'],
            );
          }
          prof = { value: r.value, method: L(`табл. 11 TRS-398: L = ${Ltxt} мм, РИД 110 см`, `TRS-398 Table 11: L = ${Ltxt} mm, SDD 110 cm`), active: true };
          if (r.note) prof.method += `; ${r.note}`;
          if (Math.abs(sddGeometry - TRS.TRS_TABLE11.sddCm) > 0.5) {
            const sddTxt = ru(sddGeometry, 0);
            add(
              'warn',
              'common',
              L(
                `Табл. 11 рассчитана для РИД = 110 см, а в вашей геометрии РИД = ${sddTxt} см: используйте формулу (22).`,
                `Table 11 was calculated for SDD = 110 cm, but in your geometry SDD = ${sddTxt} cm: use Eq. (22).`,
              ),
              `${REF.trs}, табл. 11`,
              'kvol',
            );
          }
        }
        if (want51) {
          add(
            'info',
            'tg51',
            L('В TG-51 P_rp определяют по измеренному профилю; здесь использована оценка TRS-398.', 'In TG-51, P_rp is determined from a measured profile; the TRS-398 estimate is used here.'),
            `${REF.r374}, ур. (8)`,
          );
        }
      }
    } else if (f.prof_mode === 'profile') {
      const parsed = parseProfile(f.prof_text);
      if (parsed.error) add('error', 'common', L(`Профиль: ${parsed.error}.`, `Profile: ${parsed.error}.`), null, 'prof_text');
      else if (parsed.points.length === 0) {
        add('error', 'common', L('Вставьте измеренный профиль: в каждой строке положение (мм) и значение.', 'Paste the measured profile: position (mm) and value on each line.'), null, 'prof_text');
      } else if (!Number.isFinite(lengthMm)) noLength();
      else {
        const r = kvolFromProfile(parsed.points, lengthMm);
        if (r.error) add('error', 'common', L(`Профиль: ${r.error}.`, `Profile: ${r.error}.`), null, 'prof_text');
        const n = parsed.points.length;
        const Ltxt = ru(lengthMm, 1);
        prof = {
          value: r.value,
          method: L(`ур. (21) TRS-398 по измеренному профилю (точек: ${n}), L = ${Ltxt} мм`, `TRS-398 Eq. (21) from the measured profile (${n} points), L = ${Ltxt} mm`),
          active: true,
        };
        if (want51) {
          add(
            'info',
            'tg51',
            L(
              'Для пучков БВФ аддендум TG-51 допускает, что может понадобиться двумерный профиль; здесь используется одномерное усреднение вдоль оси камеры (ур. 20–21 TRS-398).',
              'For FFF beams the TG-51 addendum notes that a two-dimensional profile may be needed; one-dimensional averaging along the chamber axis is used here (TRS-398 Eqs. 20–21).',
            ),
            `${REF.add}, разд. 5.C.7`,
          );
        }
      }
    }
    if (Number.isFinite(prof.value) && (prof.value < 0.99 || prof.value > 1.03)) {
      add(
        'warn',
        'common',
        L(
          `k_vol = ${ru(prof.value, 4)} — необычное значение: проверьте длину камеры и способ расчёта.`,
          `k_vol = ${ru(prof.value, 4)} is an unusual value: check the chamber length and the calculation method.`,
        ),
        null,
        'kvol',
      );
    }
  }
  trs.kvol = prof.value;
  tg.Prp = prof.value;

  // ------------------------------------------------------------- доза
  const depth = { on: !!f.dd_on, geometry: geo.kind, zref };
  if (depth.on) {
    // замечания раздела 8 не блокируют дозу на опорной глубине, только пересчёт на d_max
    const readD = (key, label) => {
      const v = parseNumber(f[key]);
      if (!Number.isFinite(v)) add('error', 'depth', isBlank(f[key]) ? emptyField(label) : unreadable(label), null, key);
      return v;
    };
    depth.zmax = readD('dd_zmax', L('Глубина d_max', 'Depth d_max'));
    if (Number.isFinite(depth.zmax) && (depth.zmax <= 0 || depth.zmax >= zref)) {
      add(
        'error',
        'depth',
        L(
          `Глубина d_max задаётся в сантиметрах и должна быть меньше глубины измерения (${ru(zref, 1)} см).`,
          `Depth d_max is entered in centimeters and must be less than the measurement depth (${ru(zref, 1)} cm).`,
        ),
        null,
        'dd_zmax',
      );
    }
    depth.method = geo.kind === 'SAD' && f.dd_sad !== 'pdd' ? 'tmr' : 'pdd';
    depth.pddSsd = geo.ssd;
    const z0 = ru(zref, 0);
    if (depth.method === 'tmr') {
      const tmr = readD('dd_tmr', L(`TMR(${z0}) для пересчёта на d_max`, `TMR(${z0}) for transfer to d_max`));
      if (Number.isFinite(tmr) && (tmr <= 0.2 || tmr > 1)) {
        add('error', 'depth', L('TMR вводится как отношение (например, 0,736), а не в процентах.', 'TMR is entered as a ratio (e.g. 0.736), not as a percentage.'), null, 'dd_tmr');
      }
      depth.factor = tmr;
      depth.label = L(`TMR(${z0} см)`, `TMR(${z0} cm)`);
    } else {
      const pdd = readD('dd_pdd', L(`PDD(${z0}) для пересчёта на d_max`, `PDD(${z0}) for transfer to d_max`));
      if (Number.isFinite(pdd) && (pdd < 20 || pdd > 100)) add('error', 'depth', L('PDD вводится в процентах, от 20 до 100.', 'PDD is entered as a percentage, from 20 to 100.'), null, 'dd_pdd');
      depth.factor = pdd / 100;
      const ssdTxt = ru(geo.ssd, 0);
      depth.label = L(`PDD(${z0} см)/100${geo.kind === 'SAD' ? ` при РИП ${ssdTxt} см` : ''}`, `PDD(${z0} cm)/100${geo.kind === 'SAD' ? ` at SSD ${ssdTxt} cm` : ''}`);
      if (geo.kind === 'SAD') {
        add(
          'info',
          'depth',
          L(
            `Установка по РИО, пересчёт через PDD: результат — доза на d_max при той же установке (РИП ${ssdTxt} см), а не в изоцентре. PDD должна быть измерена при РИП ${ssdTxt} см: PDD при РИП 100 см здесь даст ошибку порядка 1,5–2 %.`,
            `SAD setup with transfer via PDD: the result is the dose at d_max for the same setup (SSD ${ssdTxt} cm), not at the isocenter. The PDD must be measured at SSD ${ssdTxt} cm: using a PDD measured at SSD 100 cm would cause an error of about 1.5–2%.`,
          ),
          `${REF.trs}, разд. 6.4.3`,
        );
      }
    }
    depth.ok = !messages.some((m) => m.level === 'error' && m.scope === 'depth');
  }
  // Номинальный выход: на d_max (после пересчёта) или на опорной глубине — не все аппараты калибруют на d_max.
  // Без пересчёта на d_max он всегда относится к опорной глубине.
  depth.nominal = parseNumber(f.dd_nominal);
  depth.nominalAt = depth.on && f.dd_nominal_at !== 'zref' ? 'dmax' : 'zref';
  if (!isBlank(f.dd_nominal) && !(depth.nominal > 0)) {
    add('warn', 'common', L('Номинальный выход не распознан: отклонение от номинала не считается.', 'Nominal output not recognized: the deviation from nominal is not calculated.'), null, 'dd_nominal');
  }
  // допуск учреждения на отклонение от номинала (по умолчанию 2 %)
  depth.tolerance = readTolerance(f.dd_tol, { add, parseNumber, isBlank, field: 'dd_tol' });
  const tol = depth.tolerance;
  const tolTxt = ru(tol, tol % 1 ? 1 : 0);

  // ------------------------------------------------------- контрольные измерения
  // Показания при обычной полярности и V₁ после определения поправок (и, возможно, подстройки
  // ускорителя): k_pol, k_s (P_pol, P_ion) и остальные поправки берутся из раздела 4.
  const ctrlRaw = parseCells(f.ctrl_M);
  const ctrl = { on: ctrlRaw.n > 0 || !!ctrlRaw.error };
  if (ctrl.on) {
    ctrl.M = parseCells(f.ctrl_M);
    if (ctrl.M.error) add('error', 'ctrl', L(`«Контрольные измерения»: ${ctrl.M.error}.`, `"Check measurements": ${ctrl.M.error}.`), null, 'ctrl_M');
    else if (ctrl.M.mean === 0) add('error', 'ctrl', L('«Контрольные измерения»: среднее показание равно нулю.', '"Check measurements": the mean reading is zero.'), null, 'ctrl_M');
    if (ctrl.M.n >= 2 && ctrl.M.mean) {
      const d = Math.max(...ctrl.M.values.map((v) => Math.abs(v - ctrl.M.mean) / Math.abs(ctrl.M.mean)));
      const pct = ru(d * 100, 2);
      if (d > 0.05) {
        add('error', 'ctrl', L(`Контрольные показания расходятся на ${pct} % от среднего: вероятно, ошибка ввода.`, `Check readings deviate by ${pct}% from the mean: probably an input error.`), null, 'ctrl_M');
      } else if (d > 0.005) {
        add(
          'warn',
          'ctrl',
          L(`Разброс контрольных показаний до ${pct} % от среднего: повторите облучения.`, `Check readings scatter by up to ${pct}% from the mean: repeat the irradiations.`),
          `${REF.r374}, разд. 4.4.2`,
          'ctrl_M',
        );
      } else if (d > 0.001) {
        add(
          'info',
          'ctrl',
          L(
            `Разброс контрольных показаний до ${pct} % от среднего: Report 374 советует добиваться ±0,1 % без тренда.`,
            `Check readings scatter by up to ${pct}% from the mean: Report 374 advises achieving ±0.1% with no trend.`,
          ),
          `${REF.r374}, разд. 4.4.2`,
          'ctrl_M',
        );
      }
    }
    if (readingsOk && ctrl.M.n > 0 && !ctrl.M.error && ctrl.M.mean !== 0 && Math.sign(ctrl.M.mean) !== Math.sign(M1.mean)) {
      add(
        'error',
        'ctrl',
        L('Контрольные измерения снимают при той же (обычной) полярности, что и M при V₁.', 'Check measurements are taken at the same (normal) polarity as M at V₁.'),
        null,
        'ctrl_M',
      );
    }
    ctrl.mu = isBlank(f.ctrl_mu) ? mu : parseNumber(f.ctrl_mu);
    if (!isBlank(f.ctrl_mu) && !(ctrl.mu > 0)) {
      add('error', 'ctrl', L('Число МЕ для контрольных измерений должно быть больше нуля.', 'The number of MU for check measurements must be greater than zero.'), null, 'ctrl_mu');
    }
    ctrl.mean = ctrl.M.n > 0 && !ctrl.M.error ? Math.abs(ctrl.M.mean) : NaN;
    const ctrlErr = messages.some((m) => m.level === 'error' && m.scope === 'ctrl');
    if (!ctrlErr && Number.isFinite(ctrl.mean) && Number.isFinite(m1) && ctrl.mu > 0 && mu > 0) ctrl.changePct = ((ctrl.mean / ctrl.mu) / (m1 / mu) - 1) * 100;
  }

  const finish = (x, M, kQ, units = mu) => {
    x.M = M;
    x.D = M * kQ * ndwEff; // Гр
    x.DcGy = x.D * 100; // сГр за отпущенные МЕ
    x.units = units;
    x.DperMUGy = x.D / units; // Гр/МЕ
    x.DperMU = x.DperMUGy * 100; // сГр/МЕ (= Гр на 100 МЕ)
    if (depth.on && depth.ok && Number.isFinite(depth.factor)) {
      x.Dmax = x.D / depth.factor;
      x.DmaxcGy = x.Dmax * 100;
      x.DmaxPerMUGy = x.DperMUGy / depth.factor;
      x.DmaxPerMU = x.DperMU / depth.factor;
    }
    const atNominal = depth.nominalAt === 'dmax' ? x.DmaxPerMU : x.DperMU;
    if (depth.nominal > 0 && Number.isFinite(atNominal)) x.deviation = (atNominal / depth.nominal - 1) * 100;
    x.ok = Number.isFinite(x.D) && x.D > 0;
  };

  const productTRS = wantTRS ? trs.kTP * trs.kelec * trs.kpol * trs.ks * trs.kleak * trs.kvol : NaN;
  const product51 = want51 ? tg.PTP * tg.Pion * tg.Ppol * tg.Pelec * tg.Pleak * tg.Prp : NaN;
  if (wantTRS) finish(trs, m1 * productTRS, trs.kQ);
  if (want51) finish(tg, m1 * product51, tg.kQ);
  const ctrlBlocked = messages.some((m) => m.level === 'error' && m.scope === 'ctrl');
  if (ctrl.on) {
    if (wantTRS) finish((trs.ctrl = {}), ctrl.mean * productTRS, trs.kQ, ctrl.mu);
    if (want51) finish((tg.ctrl = {}), ctrl.mean * product51, tg.kQ, ctrl.mu);
    for (const x of [trs.ctrl, tg.ctrl]) if (x) x.blocked = ctrlBlocked || !x.ok;
  }

  // Отклонение от номинала оценивается по итоговому результату: по контрольным измерениям, если они есть.
  // Если контрольные измерения введены, но содержат ошибки, итога нет: подменять его показанием M₁ раздела 4 нельзя.
  const mainBlocked = (scope) => messages.some((m) => m.level === 'error' && (m.scope === 'common' || m.scope === scope));
  const final = (x, scope) => (mainBlocked(scope) ? {} : x.ctrl ? (x.ctrl.blocked ? {} : x.ctrl) : x);

  // ---------------------------------------------- калибровка (подстройка) ускорителя
  // Если доза (по контрольным измерениям, иначе по M₁ раздела 4) отличается от номинального выхода
  // больше допуска (по умолчанию ±2 %), предлагается калибровка. После подстройки снимают новые показания при V₁ и
  // обычной полярности в той же геометрии; поправки те же, итог — по новым показаниям, прежний
  // результат остаётся для справки.
  const recal = { tolerance: tol, answer: f.recal_needed === 'yes' || f.recal_needed === 'no' ? f.recal_needed : '' };
  const pre = { trs: wantTRS ? final(trs, 'trs') : {}, tg51: want51 ? final(tg, 'tg51') : {} };
  recal.preDeviation = [pre.trs.deviation, pre.tg51.deviation].filter(Number.isFinite);
  recal.needed = recal.preDeviation.some((d) => Math.abs(d) > tol);
  recal.on = recal.needed && recal.answer === 'yes';
  if (recal.needed && !recal.answer) {
    add('info', 'recal', L(`Доза отличается от номинального выхода больше чем на ±${tolTxt} %: ответьте в разделе 9, требуется ли калибровка.`, `The dose differs from the nominal output by more than ±${tolTxt}%: answer in section 9 whether calibration is required.`), null, 'recal_needed');
  }
  if (recal.on) {
    const s = parseCells(f.recal_M);
    recal.M = s;
    if (s.n === 0 && !s.error) {
      add('info', 'recal', L('Введите показания после калибровки ускорителя (раздел 9): до этого итог — по прежним показаниям.', 'Enter the readings after the linac calibration (section 9); until then the result is based on the previous readings.'), null, 'recal_M');
    } else {
      if (s.error) add('error', 'recal', L(`«Показания после калибровки»: ${s.error}.`, `"Readings after calibration": ${s.error}.`), null, 'recal_M');
      else if (s.mean === 0) add('error', 'recal', L('«Показания после калибровки»: среднее показание равно нулю.', '"Readings after calibration": the mean reading is zero.'), null, 'recal_M');
      const d = maxRelDeviation(s);
      const pct = ru(d * 100, 2);
      if (d > 0.05) add('error', 'recal', L(`Показания после калибровки расходятся на ${pct} % от среднего: вероятно, ошибка ввода.`, `Readings after calibration deviate by ${pct}% from the mean: probably an input error.`), null, 'recal_M');
      else if (d > 0.005) add('warn', 'recal', L(`Разброс показаний после калибровки до ${pct} % от среднего: повторите облучения.`, `Readings after calibration scatter by up to ${pct}% from the mean: repeat the irradiations.`), `${REF.r374}, разд. 4.4.2`, 'recal_M');
      if (readingsOk && !s.error && s.mean !== 0 && Math.sign(s.mean) !== Math.sign(M1.mean)) {
        add('error', 'recal', L('Показания после калибровки снимают при той же (обычной) полярности, что и M при V₁.', 'Readings after calibration are taken at the same (normal) polarity as M at V₁.'), null, 'recal_M');
      }
      recal.mu = isBlank(f.recal_mu) ? (ctrl.on && ctrl.mu > 0 ? ctrl.mu : mu) : parseNumber(f.recal_mu);
      if (!isBlank(f.recal_mu) && !(recal.mu > 0)) add('error', 'recal', L('Число МЕ после калибровки должно быть больше нуля.', 'The number of MU after calibration must be greater than zero.'), null, 'recal_mu');
      recal.mean = s.n > 0 && !s.error ? Math.abs(s.mean) : NaN;
      const recalErr = messages.some((m) => m.level === 'error' && m.scope === 'recal');
      const atNominal = (y) => (depth.nominalAt === 'dmax' ? y.DmaxPerMU : y.DperMU);
      for (const [want, x, product, p] of [[wantTRS, trs, productTRS, pre.trs], [want51, tg, product51, pre.tg51]]) {
        if (!want) continue;
        finish((x.recal = {}), recal.mean * product, x.kQ, recal.mu);
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
  outputPlausibility(finals, { add, ru, tol, muSections: L('разделы 4 и 7', 'sections 4 and 7'), zrefText: L(`(${ru(zref, 0)} см)`, `(${ru(zref, 0)} cm)`) });

  const hasError = (scope) => messages.some((m) => m.level === 'error' && (m.scope === 'common' || m.scope === scope));
  const noDose = () => L('Не удалось вычислить дозу: проверьте качество пучка и k_Q.', 'Could not calculate the dose: check the beam quality and k_Q.');
  if (wantTRS && !trs.ok && !hasError('trs')) add('error', 'trs', noDose());
  if (want51 && !tg.ok && !hasError('tg51')) add('error', 'tg51', noDose());

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

  // что изменила поправка на рекомбинацию по глубине: k_Q и доза на опорной глубине без неё
  if (trs.recDepth || tg.recDepth) {
    const base = computePhotons({ ...f, q_rec_on: false });
    const rel = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? (a / b - 1) * 100 : NaN);
    for (const [x, b, scope] of [[trs, base.trs, 'trs'], [tg, base.tg51, 'tg51']]) {
      if (!x.recDepth) continue;
      x.recDepth.kQRaw = b.kQ;
      x.recDepth.dKQ = rel(x.kQ, b.kQ);
      x.recDepth.dDose = rel(x.DperMU, b.DperMU);
      const m = messages.find((q) => q.recDepth && q.scope === scope);
      const d = x.recDepth.dDose;
      const dTxt = `${d > 0 ? '+' : ''}${ru(d, 3)}`;
      if (m && Number.isFinite(d)) m.text += L(` k_Q и доза изменились на ${dTxt} %.`, ` k_Q and the dose change by ${dTxt}%.`);
    }
  }

  return {
    protocol: f.protocol,
    form: f,
    chamber,
    geometry: geo,
    ctrl,
    recal,
    compliance,
    inputs: { H: env.H,
      T, P, T0, P0, mu, V1, V2, nV, ndw, ndwRaw, klab, ndwEff, kelec, kleak, energy, fff, cross, tprCross,
      M1, Mopp, M2, ratio12, lengthMm, sddCm,
    },
    profile: prof,
    depth,
    trs,
    tg51: tg,
    messages,
    flags,
    hasErrors: messages.some((m) => m.level === 'error'),
  };
}
