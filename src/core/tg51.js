// AAPM TG-51 (Almond et al., 1999) и аддендум для фотонов (McEwen et al., 2014).
import { ru } from './units.js';
import { LEGACY_NODES } from './chambers.js';

export const TG51_ABS0 = 273.2;
export const TG51_T0 = 22.0;
export const TG51_P0 = 101.33;

/** Диапазон аппроксимации аддендума: 63 < %dd(10)x < 86. */
export const ADD_FIT_MIN = 63;
export const ADD_FIT_MAX = 86;
/** %dd(10)x, приписанный ⁶⁰Co для интерполяции (аддендум, разд. 3.D). */
export const CO60_PDD10X = 58;

/**
 * P_ion методом двух напряжений.
 * Импульсный пучок, ур. (12): P_ion = (1 − n)/(M_H/M_L − n).
 * Непрерывный пучок (⁶⁰Co), ур. (11): P_ion = (1 − n²)/(M_H/M_L − n²).
 * n = V_H/V_L.
 */
export function pIon({ mH, mL, vH, vL, beam = 'pulsed' }) {
  const n = vH / vL;
  const r = Math.abs(mH) / Math.abs(mL);
  if (beam === 'continuous') return (1 - n * n) / (r - n * n);
  return (1 - n) / (r - n);
}

/**
 * %dd(10)x по разделу VIII.B TG-51.
 * method:
 *   'open'    — открытый пучок, без фольги: %dd(10)x = %dd(10) (только %dd(10) ≤ 75 %);
 *   'foil50'  — фольга 1 мм Pb в 50 ± 5 см от поверхности, ур. (13), порог 73 %;
 *   'foil30'  — фольга в 30 ± 1 см, ур. (14), порог 71 %;
 *   'interim' — промежуточная формула без фольги, ур. (15), 75 % < %dd(10) ≤ 89 %;
 *   'manual'  — %dd(10)x введён напрямую.
 * Возвращает { value, equation, error }.
 */
export function pdd10x({ method, pdd10, pdd10Pb, manual }) {
  switch (method) {
    case 'open':
      if (!Number.isFinite(pdd10)) return { error: 'не введено %dd(10)' };
      if (pdd10 > 75) {
        return { value: NaN, error: 'при %dd(10) > 75 % без фольги нельзя: нужна свинцовая фольга или промежуточная формула (15)' };
      }
      return { value: pdd10, equation: '%dd(10)x = %dd(10) (энергия ниже 10 МВ)' };
    case 'foil50':
      if (!Number.isFinite(pdd10Pb)) return { error: 'не введено %dd(10)Pb' };
      if (pdd10Pb >= 73) {
        return { value: (0.8905 + 0.0015 * pdd10Pb) * pdd10Pb, equation: 'ур. (13): (0,8905 + 0,00150·%dd(10)Pb)·%dd(10)Pb' };
      }
      return { value: pdd10Pb, equation: '%dd(10)Pb < 73 % → %dd(10)x = %dd(10)Pb' };
    case 'foil30':
      if (!Number.isFinite(pdd10Pb)) return { error: 'не введено %dd(10)Pb' };
      if (pdd10Pb >= 71) {
        return { value: (0.8116 + 0.00264 * pdd10Pb) * pdd10Pb, equation: 'ур. (14): (0,8116 + 0,00264·%dd(10)Pb)·%dd(10)Pb' };
      }
      return { value: pdd10Pb, equation: '%dd(10)Pb < 71 % → %dd(10)x = %dd(10)Pb' };
    case 'interim':
      if (!Number.isFinite(pdd10)) return { error: 'не введено %dd(10)' };
      if (pdd10 <= 75) return { value: pdd10, equation: '%dd(10) ≤ 75 % → %dd(10)x = %dd(10)' };
      if (pdd10 > 89) return { value: NaN, error: 'промежуточная формула (15) применима только до %dd(10) = 89 %' };
      return { value: 1.267 * pdd10 - 20.0, equation: 'ур. (15): 1,267·%dd(10) − 20,0' };
    case 'manual':
      if (!Number.isFinite(manual)) return { error: 'не введено %dd(10)x' };
      return { value: manual, equation: 'введено вручную' };
    default:
      return { error: `неизвестный способ определения %dd(10)x: ${method}` };
  }
}

/** Аппроксимация аддендума, ур. (1). */
export function kQAddendumFit({ A, B, C }, x) {
  return A + B * 1e-3 * x + C * 1e-5 * x * x;
}

function interpolate(xs, ys, x) {
  for (let i = 0; i < xs.length - 1; i++) {
    if (x >= xs[i] && x <= xs[i + 1]) {
      const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
      return ys[i] + t * (ys[i + 1] - ys[i]);
    }
  }
  return NaN;
}

/**
 * k_Q для камеры при данном %dd(10)x.
 * Аддендум 2014: аппроксимация при 63 < x < 86; при 58 ≤ x ≤ 63 — линейная интерполяция
 * между табличным k_Q(63) и k_Q = 1,000 при x = 58 (разд. 3.D).
 * Для камер только из TG-51 1999: линейная интерполяция по табл. I (58–93).
 * Возвращает { value, source, error }.
 */
export function kQ(chamber, x) {
  if (!chamber) return { error: 'камера не выбрана' };
  if (!Number.isFinite(x)) return { error: 'нет %dd(10)x' };
  if (chamber.tg51) {
    if (x > ADD_FIT_MIN && x < ADD_FIT_MAX) {
      return { value: kQAddendumFit(chamber.tg51, x), source: 'аддендум TG-51 (2014), табл. I, ур. (1)' };
    }
    if (x >= CO60_PDD10X && x <= ADD_FIT_MIN) {
      const t = (x - CO60_PDD10X) / (ADD_FIT_MIN - CO60_PDD10X);
      return {
        value: 1 + t * (chamber.tg51.kq63 - 1),
        source: 'аддендум TG-51, разд. 3.D: интерполяция между k_Q(63) и 1,000 при 58',
      };
    }
    return { error: `%dd(10)x = ${ru(x, 1)} вне диапазона данных аддендума (58–86)` };
  }
  if (chamber.tg51Legacy) {
    const v = interpolate(LEGACY_NODES, chamber.tg51Legacy, x);
    if (!Number.isFinite(v)) return { error: `%dd(10)x = ${ru(x, 1)} вне диапазона табл. I TG-51 (58–93)` };
    return { value: v, source: 'TG-51 (1999), табл. I, линейная интерполяция' };
  }
  return { error: 'для этой камеры в TG-51 и аддендуме нет данных k_Q' };
}
