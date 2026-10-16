// Подписи правил контрольной карты (core/spc.js) — для интерфейса и выгрузки журнала.
import { L } from './i18n.js';

/** Подпись правила карты. */
export const signalText = (key) =>
  ({
    '3s': L('точка за 3σ', 'a point beyond 3σ'),
    '2of3': L('2 из 3 точек за 2σ по одну сторону', '2 of 3 points beyond 2σ on one side'),
    run8: L('8 точек подряд по одну сторону от центральной линии', '8 points in a row on one side of the centre line'),
    trend6: L('6 точек подряд растут или убывают', '6 points in a row increasing or decreasing'),
    cusumUp: L('накопленная сумма: устойчивый сдвиг вверх (CUSUM)', 'cumulative sum: a sustained upward shift (CUSUM)'),
    cusumDown: L('накопленная сумма: устойчивый сдвиг вниз (CUSUM)', 'cumulative sum: a sustained downward shift (CUSUM)'),
  })[key] ?? key;
