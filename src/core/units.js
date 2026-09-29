// Разбор чисел и единиц измерения.
// Принимаем десятичную запятую и точку, знак «−» (U+2212), экспоненциальную запись.

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
    return { values: [], n: 0, mean: NaN, sd: NaN, relSd: NaN, error: `не удалось прочитать «${tokens[badIndex]}»` };
  }
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
  return { values, n, mean, sd, relSd: mean !== 0 ? Math.abs(sd / mean) : NaN, error: null };
}

export const PRESSURE_UNITS = {
  kPa: { label: 'кПа', toKPa: (v) => v },
  hPa: { label: 'гПа (мбар)', toKPa: (v) => v / 10 },
  mmHg: { label: 'мм рт. ст.', toKPa: (v) => (v * 101.325) / 760 },
};

export function pressureToKPa(value, unit) {
  const u = PRESSURE_UNITS[unit];
  if (!u) throw new Error(`Неизвестная единица давления: ${unit}`);
  return u.toKPa(value);
}

/** Единицы калибровочного коэффициента N_D,w; показания электрометра — в нКл. */
export const NDW_UNITS = {
  'Gy/nC': { label: 'Гр/нКл', toGyPerNC: (v) => v },
  'cGy/nC': { label: 'сГр/нКл', toGyPerNC: (v) => v / 100 },
  'mGy/nC': { label: 'мГр/нКл', toGyPerNC: (v) => v / 1000 },
  'Gy/C': { label: 'Гр/Кл', toGyPerNC: (v) => v * 1e-9 },
};

export function ndwToGyPerNC(value, unit) {
  const u = NDW_UNITS[unit];
  if (!u) throw new Error(`Неизвестная единица N_D,w: ${unit}`);
  return u.toGyPerNC(value);
}

/** Число для текста сообщений: десятичная запятая и знак «−». */
export function ru(value, digits) {
  if (!Number.isFinite(value)) return String(value);
  return value.toFixed(digits).replace('.', ',').replace('-', '\u2212');
}
