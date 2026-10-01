// МАГАТЭ TRS-398 Rev.1 (2024), глава 6 (пучки фотонов высоких энергий) и раздел 4.4.3.
import { ru } from './units.js';
import { L } from './i18n.js';

export const TRS_ABS0 = 273.15;
export const TRS_T0 = 20.0;
export const TRS_P0 = 101.325;

/** Диапазон табл. 16 (TPR20,10). */
export const TRS_TPR_MIN = 0.56;
export const TRS_TPR_MAX = 0.82;
/** TPR20,10, при котором k_Q = 1 по ур. (34)/(97). */
export const TRS_TPR_CO60 = 0.57;

/**
 * Табл. 10: коэффициенты a0, a1, a2 для k_s методом двух напряжений, ур. (13).
 * Ключ — отношение V1/V2.
 */
export const KS_COEFFICIENTS = {
  pulsed: {
    2.0: [2.337, -3.636, 2.299],
    2.5: [1.474, -1.587, 1.114],
    3.0: [1.198, -0.875, 0.677],
    3.5: [1.08, -0.542, 0.463],
    4.0: [1.022, -0.363, 0.341],
    5.0: [0.975, -0.188, 0.214],
  },
  scanned: {
    2.0: [4.711, -8.242, 4.533],
    2.5: [2.719, -3.977, 2.261],
    3.0: [2.001, -2.402, 1.404],
    3.5: [1.665, -1.647, 0.984],
    4.0: [1.468, -1.2, 0.734],
    5.0: [1.279, -0.75, 0.474],
  },
};

function tableKey(n) {
  const keys = Object.keys(KS_COEFFICIENTS.pulsed).map(Number);
  return keys.find((k) => Math.abs(k - n) < 1e-6);
}

/**
 * k_s методом двух напряжений (разд. 4.4.3.4).
 * Если n = V1/V2 есть в табл. 10 — ур. (13): k_s = a0 + a1·(M1/M2) + a2·(M1/M2)².
 * Иначе для импульсного пучка — ур. (14): k_s − 1 = (M1/M2 − 1)/(n − 1), точность 0,1 % при k_s < 1,03.
 * Возвращает { value, equation, n, error, notes }.
 */
export function ks({ m1, m2, v1, v2, beam = 'pulsed' }) {
  const n = v1 / v2;
  const r = Math.abs(m1) / Math.abs(m2);
  const key = tableKey(n);
  const notes = [];
  if (key !== undefined) {
    const table = beam === 'scanned' ? KS_COEFFICIENTS.scanned : KS_COEFFICIENTS.pulsed;
    const [a0, a1, a2] = table[key];
    return {
      value: a0 + a1 * r + a2 * r * r,
      equation: L(`ур. (13), табл. 10, V1/V2 = ${key}`, `Eq. (13), Table 10, V1/V2 = ${key}`),
      n,
      notes,
    };
  }
  if (beam === 'scanned') {
    return {
      value: NaN,
      n,
      error: L(
        'для импульсно-сканирующего пучка V1/V2 должно быть 2; 2,5; 3; 3,5; 4 или 5 (табл. 10)',
        'for a pulsed-scanned beam V1/V2 must be 2, 2.5, 3, 3.5, 4 or 5 (Table 10)',
      ),
      notes,
    };
  }
  const value = 1 + (r - 1) / (n - 1);
  if (value >= 1.03) {
    notes.push(
      L(
        'ур. (14) даёт точность 0,1 % только при k_s < 1,03; выберите V1/V2 из табл. 10',
        'Eq. (14) is accurate to 0.1% only for k_s < 1.03; choose V1/V2 from Table 10',
      ),
    );
  }
  return { value, equation: L('ур. (14): 1 + (M1/M2 − 1)/(n − 1)', 'Eq. (14): 1 + (M1/M2 − 1)/(n − 1)'), n, notes };
}

/** Ур. (34) = (97): k_Q по TPR20,10 с параметрами камеры a, b (табл. 45). */
export function kQFit({ a, b }, tpr) {
  return (1 + Math.exp((a - TRS_TPR_CO60) / b)) / (1 + Math.exp((a - tpr) / b));
}

export function kQ(chamber, tpr) {
  if (!chamber) return { error: L('камера не выбрана', 'no chamber selected') };
  if (!chamber.trs) {
    return { error: L('для этой камеры в TRS-398 Rev.1 нет параметров k_Q (табл. 45)', 'TRS-398 Rev.1 gives no k_Q parameters for this chamber (Table 45)') };
  }
  if (!Number.isFinite(tpr)) return { error: L('нет TPR20,10', 'no TPR20,10') };
  if (tpr < TRS_TPR_MIN || tpr > TRS_TPR_MAX) {
    return {
      error: L(
        `TPR20,10 = ${ru(tpr, 3)} вне диапазона табл. 16 (0,56–0,82)`,
        `TPR20,10 = ${ru(tpr, 3)} is outside the range of Table 16 (0.56–0.82)`,
      ),
    };
  }
  return { value: kQFit(chamber.trs, tpr), source: L('TRS-398 Rev.1, ур. (34), табл. 45', 'TRS-398 Rev.1, Eq. (34), Table 45') };
}

/** Сноска 36: TPR20,10 = 1,2661·PDD20,10 − 0,0595 (пучки СВФ, РИП 100 см, поле 10×10 на поверхности). */
export function tprFromPdd2010(ratio) {
  return 1.2661 * ratio - 0.0595;
}

/**
 * Сноска 36: оценка TPR20,10 по PDD(10) в %, поле 10×10, РИП 100 см.
 * TRS-398 прямо указывает: только для оценки соотношения, не для калибровки пучка.
 */
export function tprEstimateFromPdd10(pdd10) {
  return -0.7898 + 0.0329 * pdd10 - 0.000166 * pdd10 * pdd10;
}

/**
 * Ур. (22): общая оценка k_vol для пучков БВФ.
 * k_vol = 1 + (0,0062·TPR20,10 − 0,0036)·L²·(100/SDD)², L и SDD в сантиметрах.
 */
export function kvolGeneric({ tpr, lengthCm, sddCm }) {
  return 1 + (0.0062 * tpr - 0.0036) * lengthCm * lengthCm * (100 / sddCm) ** 2;
}

/** Узлы TPR20,10 табл. 16. */
export const TRS_TABLE16_TPR = [0.56, 0.59, 0.62, 0.65, 0.68, 0.7, 0.72, 0.74, 0.76, 0.78, 0.8, 0.82];

/**
 * k_Q по табл. 16 с линейной интерполяцией по TPR20,10.
 * TRS-398 даёт значения с четырьмя знаками «чтобы обеспечить плавную интерполяцию» (прим. a к табл. 16).
 */
export function kQFromTable(chamber, tpr) {
  if (!chamber?.trsTable) return { error: L('табличных значений k_Q для этой камеры в табл. 16 нет', 'Table 16 gives no k_Q values for this chamber') };
  if (!Number.isFinite(tpr)) return { error: L('нет TPR20,10', 'no TPR20,10') };
  const xs = TRS_TABLE16_TPR;
  if (tpr < xs[0] || tpr > xs[xs.length - 1]) {
    return {
      error: L(
        `TPR20,10 = ${ru(tpr, 3)} вне диапазона табл. 16 (0,56–0,82)`,
        `TPR20,10 = ${ru(tpr, 3)} is outside the range of Table 16 (0.56–0.82)`,
      ),
    };
  }
  for (let i = 0; i < xs.length - 1; i++) {
    if (tpr >= xs[i] && tpr <= xs[i + 1]) {
      const t = (tpr - xs[i]) / (xs[i + 1] - xs[i]);
      const y = chamber.trsTable[i] + t * (chamber.trsTable[i + 1] - chamber.trsTable[i]);
      return {
        value: y,
        source: L('TRS-398 Rev.1, табл. 16, линейная интерполяция по TPR20,10', 'TRS-398 Rev.1, Table 16, linear interpolation in TPR20,10'),
      };
    }
  }
  return { error: L('не удалось интерполировать табл. 16', 'interpolation in Table 16 failed') };
}

/** Табл. 11: k_vol для пучков БВФ при РИД = 110 см. Строки — длина полости L (см), столбцы — TPR20,10. */
export const TRS_TABLE11 = {
  tpr: [0.6, 0.63, 0.66, 0.69, 0.72, 0.75],
  lengthCm: [0.5, 1.0, 1.5, 2.0, 2.5],
  kvol: [
    [1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    [1.0, 1.0, 1.0, 1.001, 1.001, 1.001],
    [1.0, 1.001, 1.001, 1.001, 1.002, 1.002],
    [1.0, 1.001, 1.002, 1.002, 1.003, 1.004],
    [1.001, 1.002, 1.003, 1.004, 1.005, 1.006],
  ],
  sddCm: 110,
};

function bracket(xs, x) {
  for (let i = 0; i < xs.length - 1; i++) {
    if (x >= xs[i] && x <= xs[i + 1]) return [i, (x - xs[i]) / (xs[i + 1] - xs[i])];
  }
  return null;
}

/** k_vol по табл. 11 с билинейной интерполяцией по L и TPR20,10. */
export function kvolFromTable11({ tpr, lengthCm }) {
  const T = TRS_TABLE11;
  const bt = bracket(T.tpr, tpr);
  if (!bt) {
    return {
      error: L(
        `TPR20,10 = ${ru(tpr, 3)} вне диапазона табл. 11 (0,60–0,75)`,
        `TPR20,10 = ${ru(tpr, 3)} is outside the range of Table 11 (0.60–0.75)`,
      ),
    };
  }
  // для L < 5 мм k_vol не больше, чем в строке 5 мм, где он равен 1,000 при всех TPR20,10
  if (lengthCm > 0 && lengthCm < T.lengthCm[0]) {
    return {
      value: 1,
      source: L('TRS-398 Rev.1, табл. 11', 'TRS-398 Rev.1, Table 11'),
      note: L('L < 5 мм: взята строка 5 мм (k_vol = 1,000)', 'L < 5 mm: the 5 mm row is used (k_vol = 1.000)'),
    };
  }
  const bl = bracket(T.lengthCm, lengthCm);
  if (!bl) {
    return {
      error: L(
        `длина полости ${ru(lengthCm * 10, 1)} мм вне диапазона табл. 11 (5–25 мм)`,
        `cavity length ${ru(lengthCm * 10, 1)} mm is outside the range of Table 11 (5–25 mm)`,
      ),
    };
  }
  const [i, u] = bt;
  const [j, v] = bl;
  const k = T.kvol;
  const at = (jj, ii) => k[jj][ii];
  const value =
    (1 - u) * (1 - v) * at(j, i) + u * (1 - v) * at(j, i + 1) + (1 - u) * v * at(j + 1, i) + u * v * at(j + 1, i + 1);
  return { value, source: L('TRS-398 Rev.1, табл. 11, билинейная интерполяция', 'TRS-398 Rev.1, Table 11, bilinear interpolation') };
}
