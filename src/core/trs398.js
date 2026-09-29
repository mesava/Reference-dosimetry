// МАГАТЭ TRS-398 Rev.1 (2024), глава 6 (пучки фотонов высоких энергий) и раздел 4.4.3.
import { ru } from './units.js';

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
    return { value: a0 + a1 * r + a2 * r * r, equation: `ур. (13), табл. 10, V1/V2 = ${key}`, n, notes };
  }
  if (beam === 'scanned') {
    return { value: NaN, n, error: 'для импульсно-сканирующего пучка V1/V2 должно быть 2; 2,5; 3; 3,5; 4 или 5 (табл. 10)', notes };
  }
  const value = 1 + (r - 1) / (n - 1);
  if (value >= 1.03) notes.push('ур. (14) даёт точность 0,1 % только при k_s < 1,03; выберите V1/V2 из табл. 10');
  return { value, equation: 'ур. (14): 1 + (M1/M2 − 1)/(n − 1)', n, notes };
}

/** Ур. (34) = (97): k_Q по TPR20,10 с параметрами камеры a, b (табл. 45). */
export function kQFit({ a, b }, tpr) {
  return (1 + Math.exp((a - TRS_TPR_CO60) / b)) / (1 + Math.exp((a - tpr) / b));
}

export function kQ(chamber, tpr) {
  if (!chamber) return { error: 'камера не выбрана' };
  if (!chamber.trs) return { error: 'для этой камеры в TRS-398 Rev.1 нет параметров k_Q (табл. 45)' };
  if (!Number.isFinite(tpr)) return { error: 'нет TPR20,10' };
  if (tpr < TRS_TPR_MIN || tpr > TRS_TPR_MAX) {
    return { error: `TPR20,10 = ${ru(tpr, 3)} вне диапазона табл. 16 (0,56–0,82)` };
  }
  return { value: kQFit(chamber.trs, tpr), source: 'TRS-398 Rev.1, ур. (34), табл. 45' };
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
