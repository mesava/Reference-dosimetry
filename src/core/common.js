// Поправки, общие для TG-51 и TRS-398: давление и температура, полярность.

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
