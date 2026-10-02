// Поправки, общие для TG-51 и TRS-398: давление и температура, полярность.

import { L } from './i18n.js';

/** Допуск на отклонение дозы от номинального выхода, после которого предлагается калибровка ускорителя, %. */
export const RECAL_TOL = 2;

const REF = {
  add: 'аддендум TG-51 (2014)',
  r374: 'WGTG51 Report 374',
  trs: 'TRS-398 Rev.1',
};

/**
 * Поправка на температуру и давление.
 * TG-51 (1999), ур. (10): P_TP = (273.2 + T)/(273.2 + 22) · 101.33/P.
 * TRS-398 Rev.1, ур. (10): k_TP = (273.15 + T)/(273.15 + T0) · P0/P.
 * T0 и P0 — стандартные условия из сертификата о калибровке камеры.
 * @param {object} p
 * @param {number} p.T   температура воды у камеры, °C
 * @param {number} p.P   давление, кПа
 * @param {number} p.T0  стандартная температура, °C
 * @param {number} p.P0  стандартное давление, кПа
 * @param {number} p.abs0 273.2 (TG-51) или 273.15 (TRS-398)
 */
export function temperaturePressure({ T, P, T0, P0, abs0 }) {
  return ((abs0 + T) / (abs0 + T0)) * (P0 / P);
}

/**
 * Поправка на полярность.
 * TG-51, ур. (9): P_pol = |(M+ − M−)/(2M)|; TRS-398, ур. (11): k_pol = (|M+| + |M−|)/(2M).
 * Показания вводятся по модулю, поэтому обе формулы сводятся к (|M_норм| + |M_обр|)/(2|M_норм|).
 * @param {number} mNormal   показание при обычно используемой полярности
 * @param {number} mOpposite показание при противоположной полярности
 */
export function polarity(mNormal, mOpposite) {
  return (Math.abs(mNormal) + Math.abs(mOpposite)) / (2 * Math.abs(mNormal));
}

/**
 * Условия измерения: температура воды у камеры и относительная влажность в помещении.
 * - Температура: аддендум TG-51, разд. 5.A.5 — вне 15–25 °C условия «экстремальные», тепловое
 *   расширение камеры перестаёт быть пренебрежимым; Report 374, разд. 4.6 — между 18 и 30 °C
 *   дополнительная поправка меньше 0,1 %.
 * - Влажность: TRS-398 Rev.1, разд. 4.4.3.1 — поправка не нужна при 20–80 %, если N_D,w получен
 *   при ~50 %; аддендум TG-51, разд. 5.A.6 — 20–80 %, в идеале 40–60 %; экстремальная влажность
 *   увеличивает утечку. Влажность в расчёт не входит, поле служит для записи и проверки.
 * @returns {{T:number, H:number, items:Array<[string,string,string|null,string]>}} items — [уровень, текст, ссылка, поле]
 */
export function environmentChecks({ T, Hraw, keyT, keyH, parseNumber, isBlank, ru }) {
  const items = [];
  if (Number.isFinite(T)) {
    if (T < 5 || T > 40) items.push(['error', L(`Температура воды ${ru(T, 1)} °C неправдоподобна.`, `Water temperature ${ru(T, 1)} °C is implausible.`), null, keyT]);
    else if (T < 15 || T > 25) {
      items.push(['warn', L(`Температура воды ${ru(T, 1)} °C — вне обычного диапазона 15–25 °C. Референсную дозиметрию лучше не проводить, пока вода не вернётся в этот диапазон и камера не придёт в тепловое равновесие: тепловое расширение камеры и изменение плотности воды перестают быть пренебрежимыми.`, `Water temperature ${ru(T, 1)} °C is outside the usual 15–25 °C range. Reference dosimetry is best postponed until the water is back within this range and the chamber has reached thermal equilibrium: thermal expansion of the chamber and the change in water density are no longer negligible.`), `${REF.add}, разд. 5.A.5; ${REF.r374}, разд. 4.6`, keyT]);
    }
  }
  let H = NaN;
  if (!isBlank(Hraw)) {
    H = parseNumber(Hraw);
    if (!Number.isFinite(H)) items.push(['warn', L('Не удалось прочитать влажность.', 'Could not read the humidity.'), null, keyH]);
    else if (H < 0 || H > 100) items.push(['warn', L('Относительная влажность задаётся в процентах, от 0 до 100.', 'Relative humidity is entered as a percentage, from 0 to 100.'), null, keyH]);
    else if (H < 20 || H > 80) {
      items.push(['warn', L(`Относительная влажность ${ru(H, 0)} % — вне диапазона 20–80 %, в котором поправка на влажность не нужна. Проводить измерения в таких условиях не рекомендуется: калибровочный коэффициент может быть неприменим, а утечка — увеличиться.`, `Relative humidity ${ru(H, 0)} % is outside the 20–80 % range in which no humidity correction is needed. Measurements under these conditions are not recommended: the calibration coefficient may not apply and leakage may increase.`), `${REF.trs}, разд. 4.4.3.1; ${REF.add}, разд. 5.A.6`, keyH]);
    }
  }
  return { T, H, items };
}

/**
 * Проверка правдоподобия итоговой дозы на МЕ и отклонения от номинала (для фотонов и электронов).
 * Доза на опорной глубине у клинических пучков — порядка 0,5–1,2 сГр/МЕ; значение вне 0,3–2 сГр/МЕ
 * почти всегда означает ошибку ввода (чаще всего — число МЕ с лишним или недостающим нулём).
 * finals — итоговые результаты [{ x, units }], x.DperMU — сГр/МЕ на опорной глубине.
 */
export function outputPlausibility(finals, { add, ru, muSections, zrefText }) {
  const bad = finals.find(({ x }) => Number.isFinite(x?.DperMU) && (x.DperMU < 0.3 || x.DperMU > 2));
  if (bad) {
    const v = ru(bad.x.DperMU, 3);
    const n = ru(bad.units, 0);
    const hint = bad.x.DperMU > 2
      ? L('Похоже, число МЕ указано меньше отпущенного (например, 50 вместо 500).', 'The number of MU seems to be smaller than delivered (e.g. 50 instead of 500).')
      : L('Похоже, число МЕ указано больше отпущенного (например, 500 вместо 50).', 'The number of MU seems to be larger than delivered (e.g. 500 instead of 50).');
    add(
      'warn',
      'common',
      L(
        `Доза на опорной глубине ${zrefText} — ${v} Гр на 100 МЕ: вне обычного диапазона 0,3–2. ${hint} Проверьте число МЕ (${muSections}; сейчас ${n} МЕ), N_D,w и его единицы.`,
        `The dose at the reference depth ${zrefText} is ${v} Gy per 100 MU, outside the usual range of 0.3–2. ${hint} Check the number of MU (${muSections}; now ${n} MU), N_D,w and its units.`,
      ),
    );
  }
  const devs = finals.map(({ x }) => x?.deviation).filter(Number.isFinite);
  if (devs.some((d) => Math.abs(d) > 20)) {
    add(
      'warn',
      'common',
      L(
        'Отклонение от номинального выхода больше 20 %: так бывает почти только из-за ошибки ввода. Проверьте число МЕ, на какой глубине задан номинальный выход (d_max или опорная глубина) и единицы N_D,w.',
        'The deviation from the nominal output exceeds 20%: this almost always means an input error. Check the number of MU, the depth at which the nominal output is defined (d_max or the reference depth) and the units of N_D,w.',
      ),
    );
  } else if (devs.some((d) => Math.abs(d) > 2)) {
    add(
      'warn',
      'common',
      L(
        'Отклонение от номинального выхода больше 2 %: перед подстройкой ускорителя перепроверьте ввод и измерения.',
        'The deviation from the nominal output exceeds 2%: recheck the input and the measurements before adjusting the linac.',
      ),
    );
  }
}
