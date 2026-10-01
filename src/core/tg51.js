// AAPM TG-51 (Almond et al., 1999) и аддендум для фотонов (McEwen et al., 2014).
import { ru } from './units.js';
import { L } from './i18n.js';
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
      if (!Number.isFinite(pdd10)) return { error: L('не введено %dd(10)', '%dd(10) not entered') };
      if (pdd10 > 75) {
        return {
          value: NaN,
          error: L(
            'при %dd(10) > 75 % без фольги нельзя: нужна свинцовая фольга или промежуточная формула (15)',
            'the open-beam method cannot be used for %dd(10) > 75%: a lead foil or the interim formula (15) is required',
          ),
        };
      }
      return { value: pdd10, equation: L('%dd(10)x = %dd(10) (энергия ниже 10 МВ)', '%dd(10)x = %dd(10) (energy below 10 MV)') };
    case 'foil50':
      if (!Number.isFinite(pdd10Pb)) return { error: L('не введено %dd(10)Pb', '%dd(10)Pb not entered') };
      if (pdd10Pb >= 73) {
        return {
          value: (0.8905 + 0.0015 * pdd10Pb) * pdd10Pb,
          equation: L('ур. (13): (0,8905 + 0,00150·%dd(10)Pb)·%dd(10)Pb', 'Eq. (13): (0.8905 + 0.00150·%dd(10)Pb)·%dd(10)Pb'),
        };
      }
      return { value: pdd10Pb, equation: '%dd(10)Pb < 73 % → %dd(10)x = %dd(10)Pb' };
    case 'foil30':
      if (!Number.isFinite(pdd10Pb)) return { error: L('не введено %dd(10)Pb', '%dd(10)Pb not entered') };
      if (pdd10Pb >= 71) {
        return {
          value: (0.8116 + 0.00264 * pdd10Pb) * pdd10Pb,
          equation: L('ур. (14): (0,8116 + 0,00264·%dd(10)Pb)·%dd(10)Pb', 'Eq. (14): (0.8116 + 0.00264·%dd(10)Pb)·%dd(10)Pb'),
        };
      }
      return { value: pdd10Pb, equation: '%dd(10)Pb < 71 % → %dd(10)x = %dd(10)Pb' };
    case 'interim':
      if (!Number.isFinite(pdd10)) return { error: L('не введено %dd(10)', '%dd(10) not entered') };
      if (pdd10 <= 75) return { value: pdd10, equation: '%dd(10) ≤ 75 % → %dd(10)x = %dd(10)' };
      if (pdd10 > 89) {
        return {
          value: NaN,
          error: L('промежуточная формула (15) применима только до %dd(10) = 89 %', 'the interim formula (15) is applicable only up to %dd(10) = 89%'),
        };
      }
      return { value: 1.267 * pdd10 - 20.0, equation: L('ур. (15): 1,267·%dd(10) − 20,0', 'Eq. (15): 1.267·%dd(10) − 20.0') };
    case 'manual':
      if (!Number.isFinite(manual)) return { error: L('не введено %dd(10)x', '%dd(10)x not entered') };
      return { value: manual, equation: L('введено вручную', 'entered manually') };
    default:
      return { error: L(`неизвестный способ определения %dd(10)x: ${method}`, `unknown %dd(10)x method: ${method}`) };
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
  if (!chamber) return { error: L('камера не выбрана', 'no chamber selected') };
  if (!Number.isFinite(x)) return { error: L('нет %dd(10)x', 'no %dd(10)x') };
  if (chamber.tg51) {
    if (x > ADD_FIT_MIN && x < ADD_FIT_MAX) {
      return {
        value: kQAddendumFit(chamber.tg51, x),
        source: L('аддендум TG-51 (2014), табл. I, ур. (1)', 'TG-51 addendum (2014), Table I, Eq. (1)'),
      };
    }
    if (x >= CO60_PDD10X && x <= ADD_FIT_MIN) {
      const t = (x - CO60_PDD10X) / (ADD_FIT_MIN - CO60_PDD10X);
      return {
        value: 1 + t * (chamber.tg51.kq63 - 1),
        source: L(
          'аддендум TG-51, разд. 3.D: интерполяция между k_Q(63) и 1,000 при 58',
          'TG-51 addendum, Sec. 3.D: interpolation between k_Q(63) and 1.000 at 58',
        ),
      };
    }
    return {
      error: L(
        `%dd(10)x = ${ru(x, 1)} вне диапазона данных аддендума (58–86)`,
        `%dd(10)x = ${ru(x, 1)} is outside the range of the addendum data (58–86)`,
      ),
    };
  }
  if (chamber.tg51Legacy) {
    const v = interpolate(LEGACY_NODES, chamber.tg51Legacy, x);
    if (!Number.isFinite(v)) {
      return {
        error: L(
          `%dd(10)x = ${ru(x, 1)} вне диапазона табл. I TG-51 (58–93)`,
          `%dd(10)x = ${ru(x, 1)} is outside the range of TG-51 Table I (58–93)`,
        ),
      };
    }
    return { value: v, source: L('TG-51 (1999), табл. I, линейная интерполяция', 'TG-51 (1999), Table I, linear interpolation') };
  }
  return { error: L('для этой камеры в TG-51 и аддендуме нет данных k_Q', 'TG-51 and its addendum give no k_Q data for this chamber') };
}
