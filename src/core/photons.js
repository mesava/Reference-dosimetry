// Расчёт поглощённой дозы в воде для МВ фотонов по TG-51 (+ аддендум 2014) и TRS-398 Rev.1.
// Принимает значения полей формы (строки и массивы строк, как их ввёл пользователь) и возвращает
// все промежуточные поправки, итоговую дозу, замечания с источниками и флаги для подсветки полей.

import { parseNumber, parseCells, isBlank, pressureToKPa, ndwToGyPerNC, ru, dec } from './units.js';
import { L } from './i18n.js';
import { temperaturePressure, polarity, environmentChecks } from './common.js';
import * as TG51 from './tg51.js';
import * as TRS from './trs398.js';
import { findChamber, chamberLabel, noteText } from './chambers.js';
import { parseProfile, kvolFromProfile } from './profile.js';

export const FORM_DEFAULTS = {
  protocol: 'trs', // 'trs' | 'tg51' | 'both'

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

  q51_method: 'open', // 'open' | 'foil50' | 'foil30' | 'interim' | 'manual'
  q51_pdd10: '',
  q51_pdd10pb: '',
  q51_manual: '',

  qtrs_method: 'ratio', // 'ratio' (измерение на 20 и 10 см) | 'pdd2010' (через PDD)
  qtrs_v20: '',
  qtrs_v10: '',
  qtrs_fff_pdd10: '',

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

  dd_on: true,
  dd_sad: 'tmr', // установка по РИО: 'tmr' | 'pdd' (PDD при РИП = 100 − z_ref)
  dd_zmax: '',
  dd_pdd: '',
  dd_tmr: '',
  dd_nominal: '1,000',
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
  const cells = (v) => (Array.isArray(v) ? v.map((x) => String(x ?? '')) : String(v ?? '').trim() === '' ? ['', '', ''] : String(v).replace(/,(?=\s)/g, ' ').trim().split(/[\s;]+/));
  f.rd_M1 = cells(f.rd_M1);
  f.rd_Mopp = cells(f.rd_Mopp);
  f.rd_M2 = cells(f.rd_M2);
  f.ctrl_M = cells(f.ctrl_M);
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

export function computePhotons(form) {
  const f = normalizeForm(form);
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

  const want51 = f.protocol === 'tg51' || f.protocol === 'both';
  const wantTRS = f.protocol === 'trs' || f.protocol === 'both';
  const fff = !!f.meta_fff;
  const energy = parseNumber(f.meta_energy);

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

  const ndwRaw = read('ch_ndw', 'N_D,w');
  const ndw = Number.isFinite(ndwRaw) ? ndwToGyPerNC(ndwRaw, f.ch_ndw_unit) : NaN;
  if (Number.isFinite(ndw) && (ndw < 1e-3 || ndw > 5)) {
    const v = dec(ndw.toPrecision(4));
    add('warn', 'common', L(`N_D,w = ${v} Гр/нКл выглядит неправдоподобно: проверьте единицы.`, `N_D,w = ${v} Gy/nC looks implausible: check the units.`), null, 'ch_ndw');
  }
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
  const V2 = read('rd_V2', L('Пониженное напряжение V₂', 'Reduced voltage V₂'));
  if (Number.isFinite(V1) && Number.isFinite(V2) && Math.abs(V1) <= Math.abs(V2)) {
    add('error', 'common', L('Рабочее напряжение V₁ должно быть больше пониженного V₂.', 'The operating voltage V₁ must be higher than the reduced voltage V₂.'), null, ['rd_V1', 'rd_V2']);
  }
  if (Number.isFinite(V1) && Math.abs(V1) > 300) {
    if (want51) {
      add('warn', 'tg51', L('Аддендум TG-51 рекомендует для цилиндрических камер не более 300 В.', 'The TG-51 addendum recommends no more than 300 V for cylindrical chambers.'), `${REF.add}, разд. 4.E`, 'rd_V1');
    }
  }
  const M1 = readCells('rd_M1', L('M при V₁, обычная полярность', 'M at V₁, normal polarity'));
  const Mopp = readCells('rd_Mopp', L('M при V₁, обратная полярность', 'M at V₁, opposite polarity'));
  const M2 = readCells('rd_M2', L('M при V₂', 'M at V₂'));
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
    );
  }

  const readingsOk = M1.n > 0 && !M1.error && M1.mean !== 0;
  const m1 = readingsOk ? Math.abs(M1.mean) : NaN;

  // полярность
  let kpolRaw = NaN;
  if (readingsOk && Mopp.n > 0 && !Mopp.error) {
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
  let kpolQ0 = 1;
  if (!f.lab_pol_applied) kpolQ0 = read('lab_kpol', L('Поправка на полярность при калибровке', 'Polarity correction at calibration'));
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
  if (!f.lab_ks_applied) ksQ0 = read('lab_ks', L('Поправка на рекомбинацию при калибровке', 'Recombination correction at calibration'));

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
      if (trs.ks > 1.05) {
        add(
          'error',
          'trs',
          L(
            `k_s = ${ru(trs.ks, 4)} > 1,05: метод двух напряжений неприменим, нужна другая камера или другой метод.`,
            `k_s = ${ru(trs.ks, 4)} > 1.05: the two-voltage method is not applicable; another chamber or another method is needed.`,
          ),
          `${REF.trs}, табл. 3`,
          'ks',
        );
      }
      if (ratio12 >= 1 && trs.ks < 1) {
        add(
          'error',
          'trs',
          L(
            `k_s = ${ru(trs.ks, 4)} < 1: так быть не может, проверьте показания и поправку лаборатории.`,
            `k_s = ${ru(trs.ks, 4)} < 1: this is impossible; check the readings and the laboratory correction.`,
          ),
          `${REF.trs}, разд. 4.4.3.4`,
          'ks',
        );
      }
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
      const ratio = Math.abs(v20) / Math.abs(v10);
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
      add('warn', 'trs', L('TRS-398 Rev.1 распространяется на пучки БВФ только до ~10 МВ.', 'TRS-398 Rev.1 covers FFF beams only up to ~10 MV.'), `${REF.trs}, разд. 6.1`);
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
      trs.kQ = read('kqtrs_manual', L('k_Q (TRS-398), измеренный в лаборатории', 'k_Q (TRS-398) measured by the laboratory'), 'trs');
      trs.kQSource = L('измерен в лаборатории для этой камеры', 'measured by the laboratory for this chamber');
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
          );
        }
      }
    }
    if (!chamber?.custom) (chamber?.notes || []).filter((n) => n.scope === 'trs').forEach((n) => add(n.level, 'trs', noteText(n)));
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
      if (ratio12 >= 1 && tg.Pion < 1) {
        add(
          'error',
          'tg51',
          L(
            `P_ion = ${ru(tg.Pion, 4)} < 1: так быть не может, проверьте показания и поправку лаборатории.`,
            `P_ion = ${ru(tg.Pion, 4)} < 1: this is impossible; check the readings and the laboratory correction.`,
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
    } else {
      tg.Pion = NaN;
    }

    const q = TG51.pdd10x({
      method: f.q51_method,
      pdd10: parseNumber(f.q51_pdd10),
      pdd10Pb: parseNumber(f.q51_pdd10pb),
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
        L('Для всех пучков БВФ, в том числе ниже 10 МВ, %dd(10) измеряют со свинцовой фольгой.', 'For all FFF beams, including those below 10 MV, %dd(10) is measured with the lead foil.'),
        `${REF.add}, разд. 4.K(3); ${REF.r374}, разд. 3.3`,
        'q51_method',
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
    x.D = M * kQ * ndw; // Гр
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

  // отклонение от номинала оценивается по итоговому результату: по контрольным измерениям, если они есть
  const mainBlocked = (scope) => messages.some((m) => m.level === 'error' && (m.scope === 'common' || m.scope === scope));
  const final = (x, scope) => (mainBlocked(scope) ? {} : x.ctrl && !x.ctrl.blocked ? x.ctrl : x);
  const devs = [wantTRS ? final(trs, 'trs').deviation : NaN, want51 ? final(tg, 'tg51').deviation : NaN].filter(Number.isFinite);
  if (devs.some((d) => Math.abs(d) > 2)) {
    add(
      'warn',
      'common',
      L(
        'Отклонение от номинального выхода больше 2 %: перед подстройкой ускорителя перепроверьте ввод и измерения.',
        'The deviation from the nominal output exceeds 2%: recheck the input and the measurements before adjusting the linac.',
      ),
    );
  }

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

  let comparison = null;
  if (want51 && wantTRS && tg.ok && trs.ok && !tg.blocked && !trs.blocked) comparison = { dRel: (tg.D / trs.D - 1) * 100 };

  return {
    protocol: f.protocol,
    form: f,
    chamber,
    geometry: geo,
    ctrl,
    inputs: { H: env.H,
      T, P, T0, P0, mu, V1, V2, nV, ndw, ndwRaw, kelec, kleak, energy, fff,
      M1, Mopp, M2, ratio12, lengthMm, sddCm,
    },
    profile: prof,
    depth,
    trs,
    tg51: tg,
    comparison,
    messages,
    flags,
    hasErrors: messages.some((m) => m.level === 'error'),
  };
}
