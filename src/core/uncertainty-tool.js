// Инструмент «Неопределённость» (вкладка «Инструменты»): бюджет неопределённости поглощённой дозы в воде
// на опорной глубине для выбранного пучка, протокола, типа камеры и способа её калибровки.
// Сам бюджет — uncertainty.js (образцы TRS-398 табл. 13, 17, 24; аддендум TG-51 табл. II; Report 385 табл. 8, 9);
// здесь — форма инструмента, проверка ввода, повторяемость серии показаний и U в единицах итога.

import { parseNumber, parseCells, isBlank, ru } from './units.js';
import { L } from './i18n.js';
import { uncertaintyBudget, typeAOf } from './uncertainty.js';

export const UT_DEFAULTS = {
  protocol: 'trs',

  unc_institution: '',
  unc_machine: '',
  unc_beam: '',
  unc_date: '',
  unc_staff: [''],
  unc_notes: '',

  unc_beam_type: 'photons', // 'co60' | 'photons' | 'electrons'
  unc_ch_type: 'cyl', // электроны: 'cyl' | 'pp'
  // калибровка камеры: 'lab' — N_D,w в ⁶⁰Co из лаборатории; 'crossCo' — перекрёстная калибровка в ⁶⁰Co по опорной камере;
  // 'crossQ' — перекрёстная калибровка в клиническом пучке (фотоны: Q_cross, TRS-398 разд. 4.5.2; электроны: пучок электронов)
  unc_route: 'lab',
  unc_r50: '', // электроны, г/см²: для плоскопараллельной камеры при R50 < 2 г/см² k_Q — 0,8 % (табл. 24, прим. c)
  unc_sit: 'i', // пример TG-51: (i) или (ii)

  unc_cert_U: '', // расширенная неопределённость N_D,w из свидетельства, %
  unc_cert_k: '2',

  unc_M: ['', '', ''], // серия показаний, по которой посчитан итог, — для повторяемости (тип А)
  unc_value: '', // итог — для U в единицах дозы (по желанию)
  unc_unit: 'Gy100MU',

  unc_over: '', // свои значения строк бюджета: JSON { ключ: значение }
};

/** Единицы итога: подписи на обоих языках. */
export const UT_UNITS = {
  Gy100MU: { ru: 'Гр на 100 МЕ', en: 'Gy per 100 MU' },
  cGyMU: { ru: 'сГр/МЕ', en: 'cGy/MU' },
  cGymin: { ru: 'сГр/мин', en: 'cGy/min' },
  Gymin: { ru: 'Гр/мин', en: 'Gy/min' },
  Gy: { ru: 'Гр', en: 'Gy' },
  cGy: { ru: 'сГр', en: 'cGy' },
};
export const unitText = (key) => {
  const u = UT_UNITS[key] ?? UT_UNITS.Gy100MU;
  return L(u.ru, u.en);
};

/** Способы калибровки камеры, допустимые для пучка. */
export const ROUTES = { co60: ['lab', 'crossCo'], photons: ['lab', 'crossCo', 'crossQ'], electrons: ['lab', 'crossCo', 'crossQ'] };

const BEAMS = ['co60', 'photons', 'electrons'];
const REF = { trs: 'TRS-398 Rev.1' };

export function normalizeUncTool(input) {
  const f = { ...UT_DEFAULTS, ...input };
  if (f.protocol !== 'tg51') f.protocol = 'trs';
  if (!BEAMS.includes(f.unc_beam_type)) f.unc_beam_type = 'photons';
  if (f.unc_ch_type !== 'pp') f.unc_ch_type = 'cyl';
  if (!ROUTES[f.unc_beam_type].includes(f.unc_route)) f.unc_route = 'lab';
  if (f.unc_sit !== 'ii') f.unc_sit = 'i';
  if (!UT_UNITS[f.unc_unit]) f.unc_unit = f.unc_beam_type === 'co60' ? 'cGymin' : 'Gy100MU';
  if (!Array.isArray(f.unc_M)) f.unc_M = isBlank(f.unc_M) ? ['', '', ''] : String(f.unc_M).trim().split(/[\s;]+/);
  if (!Array.isArray(f.unc_staff) || f.unc_staff.length === 0) f.unc_staff = [''];
  if (f.unc_over && typeof f.unc_over === 'object') f.unc_over = JSON.stringify(f.unc_over);
  return f;
}

export function computeUncertaintyTool(form) {
  const f = normalizeUncTool(form);
  const messages = [];
  const flags = {};
  const rank = { info: 0, warn: 1, error: 2 };
  const add = (level, text, ref = null, field = null) => {
    messages.push({ level, scope: 'common', text, ref });
    for (const k of [].concat(field ?? [])) if (!flags[k] || rank[level] > rank[flags[k]]) flags[k] = level;
  };

  const beam = f.unc_beam_type;
  const route = f.unc_route;
  const tg = f.protocol === 'tg51';
  const electrons = beam === 'electrons';
  const chamberType = electrons ? f.unc_ch_type : 'cyl';

  // качество пучка электронов: нужно только для плоскопараллельной камеры по TRS-398 (R50 < 2 г/см²)
  let r50 = NaN;
  if (electrons && !isBlank(f.unc_r50)) {
    r50 = parseNumber(f.unc_r50);
    if (!Number.isFinite(r50)) add('warn', L('Не удалось прочитать R50.', 'Could not read R50.'), null, 'unc_r50');
    else if (r50 < 1 || r50 > 20) {
      add('warn', L(`R50 = ${ru(r50, 2)} г/см² неправдоподобно.`, `R50 = ${ru(r50, 2)} g/cm² is implausible.`), null, 'unc_r50');
      r50 = NaN;
    }
  }
  if (electrons && !tg && chamberType === 'cyl' && Number.isFinite(r50) && r50 < 3) {
    add('warn', L('Цилиндрические камеры TRS-398 допускает в пучках электронов только при R50 ≥ 3 г/см².', 'TRS-398 allows cylindrical chambers in electron beams only for R50 ≥ 3 g/cm².'), `${REF.trs}, табл. 19`, ['unc_r50', 'unc_ch_type']);
  }

  // сочетания, которых протоколы не описывают
  if (beam === 'photons' && route === 'crossQ' && tg) {
    add(
      'warn',
      L(
        'TG-51 и его аддендумы не описывают калибровку рабочей камеры в клиническом пучке МВ фотонов (это TRS-398, разд. 4.5.2). Строка перекрёстной калибровки — оценка по TRS-398.',
        'TG-51 and its addenda do not describe calibrating a field chamber in a clinical MV photon beam (this is TRS-398, Sec. 4.5.2). The cross-calibration row is an estimate per TRS-398.',
      ),
      `${REF.trs}, разд. 4.5.2`,
      'unc_route',
    );
  }
  if (electrons && route === 'crossQ' && tg && chamberType === 'cyl') {
    add(
      'warn',
      L('Report 385 описывает перекрёстную калибровку плоскопараллельной камеры по цилиндрической: для цилиндрической рабочей камеры табл. 9 — лишь приближение.', 'Report 385 describes cross-calibrating a plane-parallel chamber against a cylindrical one: for a cylindrical field chamber, Table 9 is only an approximation.'),
      'Report 385, разд. 5.3.2',
      ['unc_route', 'unc_ch_type'],
    );
  }

  // серия показаний: повторяемость (тип А)
  const series = parseCells(f.unc_M);
  if (series.error) add('warn', L(`Показания: ${series.error}.`, `Readings: ${series.error}.`), null, 'unc_M');
  else if (series.n === 1) add('info', L('Для повторяемости (тип А) нужно не меньше двух показаний.', 'At least two readings are needed for the repeatability (type A).'), null, 'unc_M');
  const typeA = series.error ? null : typeAOf(series);
  if (typeA && series.mean !== 0) {
    const d = Math.max(...series.values.map((v) => Math.abs(v - series.mean) / Math.abs(series.mean)));
    if (d > 0.05) add('warn', L(`Показания расходятся на ${ru(d * 100, 1)} % от среднего: вероятно, ошибка ввода.`, `Readings deviate by ${ru(d * 100, 1)}% from the mean: probably an input error.`), null, 'unc_M');
    else if (d > 0.005) add('info', L(`Разброс показаний до ${ru(d * 100, 2)} % от среднего: Report 374 советует добиваться ±0,1 % без тренда.`, `Readings scatter by up to ${ru(d * 100, 2)}% from the mean: Report 374 advises achieving ±0.1% with no trend.`), 'WGTG51 Report 374, разд. 4.4.2', 'unc_M');
  }

  // итог (по желанию) — для U в единицах дозы
  let value = NaN;
  if (!isBlank(f.unc_value)) {
    value = parseNumber(f.unc_value);
    if (!Number.isFinite(value) || value <= 0) {
      add('warn', L('Не удалось прочитать итог: U в единицах дозы не вычислена.', 'Could not read the result: U in dose units is not calculated.'), null, 'unc_value');
      value = NaN;
    }
  }

  const budget = uncertaintyBudget({
    beam,
    protocol: f.protocol,
    chamberType,
    crossQ: beam === 'photons' && route === 'crossQ',
    crossE: electrons && route === 'crossQ',
    crossCo: route === 'crossCo',
    r50,
    situation: f.unc_sit,
    certU: f.unc_cert_U,
    certK: f.unc_cert_k,
    over: f.unc_over,
    typeA,
    prefix: '',
  });
  for (const m of budget.messages) add(m.level, m.text, m.ref, m.field);

  const order = { error: 0, warn: 1, info: 2 };
  messages.sort((a, b) => order[a.level] - order[b.level]);
  const abs = Number.isFinite(value) ? (value * budget.UPct) / 100 : NaN;
  return {
    protocol: f.protocol,
    form: f,
    beam,
    route,
    chamberType,
    r50,
    series,
    typeA,
    value,
    unit: f.unc_unit,
    abs,
    budget,
    ucPct: budget.ucPct,
    UPct: budget.UPct,
    messages,
    flags,
    hasErrors: messages.some((m) => m.level === 'error'),
  };
}
