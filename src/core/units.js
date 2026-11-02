// Разбор чисел и единиц измерения.
// Принимаем десятичную запятую и точку, знак «−» (U+2212), экспоненциальную запись.

import { L, getLang } from './i18n.js';

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** Одно число из строки. Возвращает NaN, если строка пустая или некорректная. */
export function parseNumber(input) {
  if (input === null || input === undefined) return NaN;
  if (typeof input === 'number') return input;
  let s = String(input).trim().replace(/−/g, '-').replace(/[\s  ]+/g, '');
  if (s === '') return NaN;
  if ((s.match(/,/g) || []).length === 1 && !s.includes('.')) s = s.replace(',', '.');
  if (!NUMBER_RE.test(s)) return NaN;
  return Number(s);
}

/** true, если в поле ничего не введено. */
export function isBlank(input) {
  return input === null || input === undefined || String(input).trim() === '';
}

/**
 * Серия показаний: числа через пробел, перевод строки или точку с запятой.
 * Запятая считается разделителем, только если за ней идёт пробел («13.17, 13.19»);
 * иначе это десятичная запятая («13,17 13,19»).
 */
export function parseSeries(input) {
  if (isBlank(input)) return { values: [], n: 0, mean: NaN, sd: NaN, relSd: NaN, error: null };
  const tokens = String(input)
    .replace(/−/g, '-')
    .split(/[\s;]+|,(?=\s)/)
    .map((t) => t.replace(/,$/, '').trim())
    .filter((t) => t !== '');
  const values = tokens.map(parseNumber);
  const badIndex = values.findIndex((v) => !Number.isFinite(v));
  if (badIndex >= 0) {
    return { values: [], n: 0, mean: NaN, sd: NaN, relSd: NaN, error: L(`не удалось прочитать «${tokens[badIndex]}»`, `could not read "${tokens[badIndex]}"`) };
  }
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
  return { values, n, mean, sd, relSd: mean !== 0 ? Math.abs(sd / mean) : NaN, error: null };
}

export const PRESSURE_UNITS = {
  kPa: { label: 'кПа', labelEn: 'kPa', toKPa: (v) => v },
  hPa: { label: 'гПа (мбар)', labelEn: 'hPa (mbar)', toKPa: (v) => v / 10 },
  mmHg: { label: 'мм рт. ст.', labelEn: 'mmHg', toKPa: (v) => (v * 101.325) / 760 },
};

/** Подпись единицы на текущем языке. */
export const unitLabel = (u) => (u ? L(u.label, u.labelEn) : '');

export function pressureToKPa(value, unit) {
  const u = Object.hasOwn(PRESSURE_UNITS, unit) ? PRESSURE_UNITS[unit] : null;
  if (!u) throw new Error(L(`Неизвестная единица давления: ${unit}`, `Unknown pressure unit: ${unit}`));
  return u.toKPa(value);
}

/** Единицы калибровочного коэффициента N_D,w; показания электрометра — в нКл. */
export const NDW_UNITS = {
  'Gy/nC': { label: 'Гр/нКл', labelEn: 'Gy/nC', toGyPerNC: (v) => v },
  'cGy/nC': { label: 'сГр/нКл', labelEn: 'cGy/nC', toGyPerNC: (v) => v / 100 },
  'mGy/nC': { label: 'мГр/нКл', labelEn: 'mGy/nC', toGyPerNC: (v) => v / 1000 },
  'Gy/C': { label: 'Гр/Кл', labelEn: 'Gy/C', toGyPerNC: (v) => v * 1e-9 },
};

export function ndwToGyPerNC(value, unit) {
  const u = Object.hasOwn(NDW_UNITS, unit) ? NDW_UNITS[unit] : null;
  if (!u) throw new Error(L(`Неизвестная единица N_D,w: ${unit}`, `Unknown N_D,w unit: ${unit}`));
  return u.toGyPerNC(value);
}

/**
 * Пересчёт N_D,w и давления внутри расчёта: единица не из списка (файл или черновик из другой версии, правленный вручную
 * файл — в списке выбора она становится пустой) даёт ошибку в замечаниях расчёта и NaN, а не исключение, которое
 * останавливало бы всю вкладку. add — функция замечаний модуля: add(уровень, раздел, текст, ссылка, поле).
 */
export function unitConverters(add) {
  const seen = new Set();
  const bad = (what, unit) => {
    const u = String(unit ?? '').trim();
    if (!seen.has(`${what}|${u}`)) {
      seen.add(`${what}|${u}`);
      add('error', 'common', u
        ? L(`Единица ${what} «${u}» неизвестна калькулятору: выберите единицу из списка.`, `The ${what} unit "${u}" is unknown to the calculator: select a unit from the list.`)
        : L(`Не выбрана единица ${what}: выберите её из списка.`, `No ${what} unit is selected: select one from the list.`));
    }
    return NaN;
  };
  return {
    ndw: (v, unit) => (Object.hasOwn(NDW_UNITS, unit) ? NDW_UNITS[unit].toGyPerNC(v) : bad('N_D,w', unit)),
    pressure: (v, unit) => (Object.hasOwn(PRESSURE_UNITS, unit) ? PRESSURE_UNITS[unit].toKPa(v) : bad(L('давления', 'pressure'), unit)),
  };
}

/** Число для текста сообщений: десятичная запятая (по-английски — точка) и знак «−». */
export function ru(value, digits) {
  if (!Number.isFinite(value)) return String(value);
  const s = value.toFixed(digits).replace('-', '\u2212');
  return getLang() === 'en' ? s : s.replace('.', ',');
}

/** Десятичный разделитель текущего языка в строке с числом (например, из toPrecision). */
export const dec = (s) => (getLang() === 'en' ? String(s) : String(s).replace('.', ','));

/**
 * Показания из отдельных ячеек (массив строк). Пустые ячейки пропускаются.
 * Строка вместо массива разбирается как серия через пробел (совместимость со старыми файлами).
 */
export function parseCells(cells) {
  if (!Array.isArray(cells)) return parseSeries(cells);
  const values = [];
  for (let i = 0; i < cells.length; i++) {
    if (isBlank(cells[i])) continue;
    const v = parseNumber(cells[i]);
    if (!Number.isFinite(v)) {
      return { values: [], n: 0, mean: NaN, sd: NaN, relSd: NaN, error: L(`не удалось прочитать ячейку ${i + 1} («${cells[i]}»)`, `could not read cell ${i + 1} ("${cells[i]}")`) };
    }
    values.push(v);
  }
  const n = values.length;
  if (n === 0) return { values: [], n: 0, mean: NaN, sd: NaN, relSd: NaN, error: null };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
  return { values, n, mean, sd, relSd: mean !== 0 ? Math.abs(sd / mean) : NaN, error: null };
}

/**
 * Номинальная энергия и признак БВФ из названия пучка: «6 МВ», «10 МВ БВФ», «6X FFF», «10FFF».
 * fff: true — явно БВФ/FFF; false — явно СВФ/WFF (with flattening filter); null — не указано.
 * Энергия берётся из числа перед «МВ», «MV», «X» или «FFF»; если такого нет, а число в названии одно — из него.
 */
export function parseBeamName(name) {
  const s = String(name || '');
  let fff = null;
  if (/FFF|БВФ|без\s+выравн/i.test(s)) fff = true;
  else if (/\bWFF\b|СВФ|с\s+выравн/i.test(s)) fff = false;
  const unit = s.match(/(\d+(?:[.,]\d+)?)\s*(?:МВ|MV|X|Х|FFF|БВФ)/i);
  const all = s.match(/\d+(?:[.,]\d+)?/g) || [];
  const raw = unit ? unit[1] : all.length === 1 ? all[0] : null;
  const energy = raw ? Number(raw.replace(',', '.')) : NaN;
  return { energy, fff };
}
