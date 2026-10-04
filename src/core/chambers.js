// База цилиндрических ионизационных камер для МВ фотонов.
//
// tg51  — аддендум TG-51 2014 (McEwen et al., Med. Phys. 41, 041501), табл. I:
//         k_Q = A + B·10⁻³·x + C·10⁻⁵·x², x = %dd(10)x, 63 < x < 86;
//         kq63 — табличное значение k_Q при x = 63 (для интерполяции к ⁶⁰Co, x = 58).
// tg51Legacy — исходный TG-51 (1999), табл. I: k_Q в узлах %dd(10)x
//         [58, 63, 66, 71, 81, 93], линейная интерполяция. Только для камер,
//         которых нет в аддендуме.
// trs   — TRS-398 Rev.1 (2024), прил. II, табл. 45: параметры a, b уравнения (97)
//         k_Q = [1 + exp((a − 0,57)/b)] / [1 + exp((a − TPR20,10)/b)].
// trsTable — TRS-398 Rev.1, табл. 16: k_Q в узлах TPR20,10 = TRS_TABLE16_TPR (см. trs398.js).
// rCavMm — радиус полости, мм: WGTG51 Report 374, табл. 1; для старых камер — TG-51, табл. III;
//          для PTW 31021 — TRS-398 Rev.1, табл. 4.
// lengthMm — длина полости, мм: TRS-398 Rev.1, табл. 4 (только там, где она указана).
// sleeve — камера не водонепроницаема, нужен чехол (ПММА ≤ 1 мм).
// notes — замечания к камере: scope 'tg51' | 'trs', level 'warn' | 'info'.

// noteEn, textEn — те же пояснения и замечания по-английски.

import { L } from './i18n.js';

/** Пояснение к модели («Фармер 0,6 см³») на текущем языке. */
export const chamberNote = (c) => (c?.note ? L(c.note, c.noteEn) : '');

/** Текст замечания к камере на текущем языке. */
export const noteText = (n) => L(n.text, n.textEn);

export const LEGACY_NODES = [58, 63, 66, 71, 81, 93];

export const CHAMBERS = [
  // ---- Capintec
  { id: 'PR06C', maker: 'Capintec', model: 'PR-06C/G', note: 'Фармер 0,6 см³', noteEn: 'Farmer 0.6 cm³', sleeve: true, rCavMm: 3.2,
    tg51: { A: 0.9519, B: 2.432, C: -2.704, kq63: 0.998 }, trs: { a: 1.06833, b: -0.08262 },
    trsTable: [1.0003, 0.9993, 0.9980, 0.9961, 0.9934, 0.9909, 0.9878, 0.9839, 0.9790, 0.9727, 0.9649, 0.9551] },
  { id: 'PR05', maker: 'Capintec', model: 'PR-05/PR-05P', note: 'данные TG-51 1999 г.', noteEn: 'TG-51 (1999) data', rCavMm: 2.0,
    tg51Legacy: [0.999, 0.997, 0.995, 0.990, 0.972, 0.948],
    notes: [{ scope: 'tg51', level: 'warn', text: 'Аддендум 2014 разрешает эту камеру, только если она отвечает требованиям к камерам эталонного класса (табл. III аддендума).', textEn: 'The 2014 addendum allows this chamber only if it meets the reference-class chamber specification (addendum Table III).' }] },

  // ---- Exradin (Standard Imaging)
  { id: 'A19', maker: 'Exradin', model: 'A19', note: 'водонепроницаемый Фармер', noteEn: 'waterproof Farmer', rCavMm: 3.05,
    tg51: { A: 0.9934, B: 1.384, C: -2.125, kq63: 0.996 }, trs: { a: 1.12024, b: -0.10493 },
    trsTable: [1.0005, 0.9989, 0.9968, 0.9940, 0.9904, 0.9873, 0.9836, 0.9792, 0.9738, 0.9675, 0.9599, 0.9509] },
  { id: 'A12', maker: 'Exradin', model: 'A12', note: 'Фармер 0,6 см³', noteEn: 'Farmer 0.6 cm³', rCavMm: 3.05,
    tg51: { A: 1.0146, B: 0.777, C: -1.666, kq63: 0.997 }, trs: { a: 1.09783, b: -0.09544 },
    trsTable: [1.0004, 0.9991, 0.9973, 0.9948, 0.9915, 0.9887, 0.9852, 0.9809, 0.9756, 0.9693, 0.9615, 0.9521] },
  { id: 'A12S', maker: 'Exradin', model: 'A12S', note: 'короткий Фармер 0,2 см³', noteEn: 'short Farmer 0.2 cm³', rCavMm: 3.05,
    tg51: { A: 0.9692, B: 1.974, C: -2.448, kq63: 0.996 }, trs: { a: 1.11499, b: -0.10057 },
    trsTable: [1.0004, 0.9990, 0.9972, 0.9947, 0.9913, 0.9885, 0.9850, 0.9809, 0.9758, 0.9698, 0.9624, 0.9537] },
  { id: 'A18', maker: 'Exradin', model: 'A18', note: '0,125 см³', noteEn: '0.125 cm³', rCavMm: 2.45,
    tg51: { A: 0.9944, B: 1.286, C: -1.98, kq63: 0.997 }, trs: { a: 1.10487, b: -0.0967 },
    trsTable: [1.0004, 0.9991, 0.9973, 0.9949, 0.9917, 0.9889, 0.9855, 0.9814, 0.9764, 0.9702, 0.9628, 0.9538] },
  { id: 'A1', maker: 'Exradin', model: 'A1', note: '0,06 см³', noteEn: '0.06 cm³', rCavMm: 2.0,
    tg51: { A: 1.0029, B: 1.023, C: -1.803, kq63: 0.996 } },
  { id: 'A1SL', maker: 'Exradin', model: 'A1SL', note: '0,06 см³', noteEn: '0.06 cm³', rCavMm: 2.0,
    tg51: { A: 0.9896, B: 1.41, C: -2.049, kq63: 0.997 }, trs: { a: 1.21633, b: -0.13351 },
    trsTable: [1.0006, 0.9987, 0.9965, 0.9936, 0.9901, 0.9873, 0.9840, 0.9802, 0.9759, 0.9709, 0.9652, 0.9586] },
  { id: 'A26', maker: 'Exradin', model: 'A26', trs: { a: 1.09587, b: -0.09383 },
    trsTable: [1.0004, 0.9991, 0.9974, 0.9951, 0.9919, 0.9891, 0.9857, 0.9816, 0.9765, 0.9702, 0.9626, 0.9533] },
  { id: 'A28', maker: 'Exradin', model: 'A28', trs: { a: 1.12453, b: -0.10278 },
    trsTable: [1.0004, 0.9990, 0.9972, 0.9947, 0.9914, 0.9886, 0.9853, 0.9813, 0.9764, 0.9706, 0.9636, 0.9552] },

  // ---- NE
  { id: 'NE2571', maker: 'NE', model: '2571', note: 'Фармер 0,6 см³', noteEn: 'Farmer 0.6 cm³', sleeve: true, rCavMm: 3.14, lengthMm: 24.1,
    tg51: { A: 0.9882, B: 1.486, C: -2.14, kq63: 0.997 }, trs: { a: 1.08918, b: -0.09222 },
    trsTable: [1.0004, 0.9991, 0.9974, 0.9951, 0.9919, 0.9891, 0.9856, 0.9813, 0.9761, 0.9697, 0.9618, 0.9522] },
  { id: 'NE2561', maker: 'NE', model: '2561 / 2611A', note: 'вторичный эталон NPL', noteEn: 'NPL secondary standard', sleeve: true, rCavMm: 3.7,
    tg51: { A: 0.9722, B: 1.977, C: -2.463, kq63: 0.999 }, trs: { a: 1.07699, b: -0.08732 },
    trsTable: [1.0003, 0.9992, 0.9977, 0.9955, 0.9925, 0.9898, 0.9865, 0.9823, 0.9771, 0.9706, 0.9627, 0.9528] },
  { id: 'NE2505', maker: 'NE', model: '2505/3, 3A', note: 'данные TG-51 1999 г.', noteEn: 'TG-51 (1999) data', sleeve: true, rCavMm: 3.15,
    tg51Legacy: [1.0, 0.998, 0.995, 0.988, 0.972, 0.951] },
  { id: 'NE2577', maker: 'NE', model: '2577', note: 'данные TG-51 1999 г.', noteEn: 'TG-51 (1999) data', sleeve: true, rCavMm: 3.15,
    tg51Legacy: [1.0, 0.998, 0.995, 0.988, 0.972, 0.951] },

  // ---- PTW
  { id: 'PTW30010', maker: 'PTW', model: '30010', note: 'Фармер 0,6 см³', noteEn: 'Farmer 0.6 cm³', sleeve: true, rCavMm: 3.05, lengthMm: 23.0,
    tg51: { A: 1.0093, B: 0.926, C: -1.771, kq63: 0.997 }, trs: { a: 1.12594, b: -0.1074 },
    trsTable: [1.0005, 0.9989, 0.9967, 0.9938, 0.9901, 0.9869, 0.9832, 0.9787, 0.9734, 0.9671, 0.9595, 0.9506] },
  { id: 'PTW30011', maker: 'PTW', model: '30011', note: 'Фармер 0,6 см³', noteEn: 'Farmer 0.6 cm³', sleeve: true, rCavMm: 3.05,
    tg51: { A: 0.9676, B: 2.061, C: -2.528, kq63: 0.997 }, trs: { a: 1.1085, b: -0.10107 },
    trsTable: [1.0005, 0.9989, 0.9969, 0.9942, 0.9906, 0.9875, 0.9838, 0.9793, 0.9739, 0.9674, 0.9595, 0.9501] },
  { id: 'PTW30012', maker: 'PTW', model: '30012', note: 'Фармер 0,6 см³', noteEn: 'Farmer 0.6 cm³', sleeve: true, rCavMm: 3.05, lengthMm: 23.0,
    tg51: { A: 0.9537, B: 2.44, C: -2.75, kq63: 0.998 }, trs: { a: 1.12442, b: -0.10415 },
    trsTable: [1.0004, 0.9990, 0.9970, 0.9944, 0.9910, 0.9881, 0.9846, 0.9804, 0.9754, 0.9694, 0.9622, 0.9536] },
  { id: 'PTW30013', maker: 'PTW', model: '30013', note: 'водонепроницаемый Фармер', noteEn: 'waterproof Farmer', rCavMm: 3.05, lengthMm: 23.0,
    tg51: { A: 0.9652, B: 2.141, C: -2.623, kq63: 0.996 }, trs: { a: 1.18273, b: -0.13256 },
    trsTable: [1.0007, 0.9984, 0.9956, 0.9920, 0.9876, 0.9840, 0.9800, 0.9753, 0.9699, 0.9636, 0.9565, 0.9484] },
  { id: 'PTW31013', maker: 'PTW', model: '31013', note: 'Semiflex 0,3 см³', noteEn: 'Semiflex 0.3 cm³', rCavMm: 2.75, lengthMm: 16.3,
    tg51: { A: 0.9725, B: 1.957, C: -2.498, kq63: 0.997 }, trs: { a: 1.19297, b: -0.13366 },
    trsTable: [1.0007, 0.9985, 0.9958, 0.9924, 0.9882, 0.9848, 0.9810, 0.9765, 0.9714, 0.9655, 0.9588, 0.9511] },
  { id: 'PTW31003', maker: 'PTW', model: '31003', note: 'k_Q как у 31013 по аддендуму TG-51', noteEn: 'k_Q as for the 31013 per the TG-51 addendum', rCavMm: 2.75,
    tg51: { A: 0.9725, B: 1.957, C: -2.498, kq63: 0.997 },
    notes: [{ scope: 'tg51', level: 'info', text: 'Аддендум TG-51, разд. 3.E(i): PTW 31003 идентична 31013, используются её данные. В TRS-398 Rev.1 этой камеры нет.', textEn: 'TG-51 addendum, Sec. 3.E(i): the PTW 31003 is identical to the 31013, whose data are used. This chamber is not listed in TRS-398 Rev.1.' }] },
  { id: 'PTW31010', maker: 'PTW', model: '31010', note: 'Semiflex 0,125 см³', noteEn: 'Semiflex 0.125 cm³', rCavMm: 2.75, lengthMm: 6.5,
    trs: { a: 1.23755, b: -0.15295 },
    trsTable: [1.0008, 0.9982, 0.9952, 0.9914, 0.9869, 0.9835, 0.9795, 0.9750, 0.9700, 0.9643, 0.9579, 0.9507],
    notes: [{ scope: 'trs', level: 'warn', fffOnly: true, text: 'TRS-398 Rev.1, табл. 4: камера не отвечает спецификации эталонного класса; включена как возможный вариант для пучков БВФ и требует дополнительной характеризации.', textEn: 'TRS-398 Rev.1, Table 4: the chamber does not meet the reference-class specification; it is included as a possible option for FFF beams and requires additional characterization.' }] },
  { id: 'PTW31016', maker: 'PTW', model: '31016', note: 'PinPoint 3D', noteEn: 'PinPoint 3D', rCavMm: 1.45,
    trs: { a: 1.1165, b: -0.10841 },
    trsTable: [1.0006, 0.9987, 0.9962, 0.9930, 0.9888, 0.9853, 0.9812, 0.9762, 0.9703, 0.9632, 0.9549, 0.9451],
    notes: [{ scope: 'trs', level: 'warn', fffOnly: true, text: 'TRS-398 Rev.1, табл. 16, прим. b: объём меньше рекомендованного; камера включена для измерений в пучках БВФ.', textEn: 'TRS-398 Rev.1, Table 16, note b: the volume is smaller than recommended; the chamber is included for measurements in FFF beams.' }] },
  { id: 'PTW31021', maker: 'PTW', model: '31021', note: 'Semiflex 3D', noteEn: 'Semiflex 3D', rCavMm: 2.4, lengthMm: 4.8,
    trs: { a: 1.29612, b: -0.16514 },
    trsTable: [1.0007, 0.9984, 0.9957, 0.9925, 0.9886, 0.9856, 0.9823, 0.9786, 0.9744, 0.9697, 0.9645, 0.9587],
    notes: [{ scope: 'trs', level: 'warn', fffOnly: true, text: 'TRS-398 Rev.1, табл. 16, прим. b: объём меньше рекомендованного; камера включена для измерений в пучках БВФ.', textEn: 'TRS-398 Rev.1, Table 16, note b: the volume is smaller than recommended; the chamber is included for measurements in FFF beams.' }] },
  { id: 'PTW31022', maker: 'PTW', model: '31022', note: 'PinPoint 3D', noteEn: 'PinPoint 3D',
    trs: { a: 1.14435, b: -0.1113 },
    trsTable: [1.0005, 0.9989, 0.9968, 0.9940, 0.9905, 0.9875, 0.9840, 0.9798, 0.9749, 0.9690, 0.9621, 0.9540],
    notes: [{ scope: 'trs', level: 'warn', fffOnly: true, text: 'TRS-398 Rev.1, табл. 16, прим. b: объём меньше рекомендованного; камера включена для измерений в пучках БВФ.', textEn: 'TRS-398 Rev.1, Table 16, note b: the volume is smaller than recommended; the chamber is included for measurements in FFF beams.' }] },
  { id: 'PTW30001', maker: 'PTW', model: 'N30001 / N23333', note: 'данные TG-51 1999 г.', noteEn: 'TG-51 (1999) data', sleeve: true, rCavMm: 3.05,
    tg51Legacy: [1.0, 0.996, 0.992, 0.984, 0.967, 0.945] },
  { id: 'PTW30006', maker: 'PTW', model: '30006', note: 'k_Q как у N30001, TG-51 1999 г.', noteEn: 'k_Q as for the N30001, TG-51 (1999)',
    tg51Legacy: [1.0, 0.996, 0.992, 0.984, 0.967, 0.945],
    notes: [{ scope: 'tg51', level: 'info', text: 'TG-51, разд. XI, и аддендум, разд. 3.E(iii): для PTW 30006 используются данные k_Q камеры N30001.', textEn: 'TG-51, Sec. XI, and the addendum, Sec. 3.E(iii): the k_Q data of the N30001 are used for the PTW 30006.' }] },
  { id: 'PTW30002', maker: 'PTW', model: 'N30002', note: 'данные TG-51 1999 г.', noteEn: 'TG-51 (1999) data', sleeve: true, rCavMm: 3.05,
    tg51Legacy: [1.0, 0.997, 0.994, 0.987, 0.97, 0.948] },
  { id: 'PTW30004', maker: 'PTW', model: 'N30004', note: 'данные TG-51 1999 г.', noteEn: 'TG-51 (1999) data', sleeve: true, rCavMm: 3.05,
    tg51Legacy: [1.0, 0.998, 0.995, 0.988, 0.973, 0.952] },

  // ---- IBA
  { id: 'FC65G', maker: 'IBA', model: 'FC65-G', note: 'водонепроницаемый Фармер', noteEn: 'waterproof Farmer', rCavMm: 3.1, lengthMm: 23.0,
    tg51: { A: 0.9708, B: 1.972, C: -2.48, kq63: 0.997 }, trs: { a: 1.09752, b: -0.09642 },
    trsTable: [1.0004, 0.9990, 0.9972, 0.9946, 0.9912, 0.9882, 0.9846, 0.9802, 0.9748, 0.9683, 0.9603, 0.9507] },
  { id: 'FC65P', maker: 'IBA', model: 'FC65-P', note: 'Фармер', noteEn: 'Farmer', rCavMm: 3.1, lengthMm: 23.0,
    tg51: { A: 0.9828, B: 1.664, C: -2.296, kq63: 0.997 }, trs: { a: 1.12374, b: -0.10784 },
    trsTable: [1.0005, 0.9988, 0.9966, 0.9936, 0.9897, 0.9865, 0.9826, 0.9780, 0.9725, 0.9660, 0.9583, 0.9491] },
  { id: 'FC23C', maker: 'IBA', model: 'FC23-C', note: 'короткий Фармер 0,2 см³', noteEn: 'short Farmer 0.2 cm³', rCavMm: 3.1,
    tg51: { A: 0.982, B: 1.579, C: -2.166, kq63: 0.996 }, trs: { a: 1.09189, b: -0.09346 },
    trsTable: [1.0004, 0.9991, 0.9974, 0.9950, 0.9917, 0.9888, 0.9853, 0.9810, 0.9758, 0.9693, 0.9614, 0.9519] },
  { id: 'CC25', maker: 'IBA', model: 'CC25', note: '0,25 см³', noteEn: '0.25 cm³', rCavMm: 3.0,
    tg51: { A: 0.9551, B: 2.353, C: -2.687, kq63: 0.997 }, trs: { a: 1.08981, b: -0.09254 },
    trsTable: [1.0004, 0.9991, 0.9974, 0.9950, 0.9918, 0.9890, 0.9855, 0.9812, 0.9760, 0.9695, 0.9617, 0.9521] },
  { id: 'CC13', maker: 'IBA', model: 'CC13', note: '0,13 см³', noteEn: '0.13 cm³', rCavMm: 3.0, lengthMm: 5.8,
    tg51: { A: 0.9515, B: 2.455, C: -2.768, kq63: 0.996 }, trs: { a: 1.11441, b: -0.1026 },
    trsTable: [1.0005, 0.9989, 0.9969, 0.9942, 0.9906, 0.9876, 0.9839, 0.9795, 0.9742, 0.9678, 0.9601, 0.9510] },
  { id: 'IC10', maker: 'IBA', model: 'IC10 (Wellhöfer)', note: 'k_Q как у CC13 по аддендуму TG-51', noteEn: 'k_Q as for the CC13 per the TG-51 addendum',
    tg51: { A: 0.9515, B: 2.455, C: -2.768, kq63: 0.996 },
    notes: [{ scope: 'tg51', level: 'info', text: 'Аддендум TG-51, разд. 3.E(ii): для IC10 используются данные CC13. В TRS-398 Rev.1 этой камеры нет.', textEn: 'TG-51 addendum, Sec. 3.E(ii): the CC13 data are used for the IC10. This chamber is not listed in TRS-398 Rev.1.' }] },
  { id: 'CC08', maker: 'IBA', model: 'CC08', note: '0,08 см³', noteEn: '0.08 cm³',
    tg51: { A: 0.943, B: 2.637, C: -2.884, kq63: 0.995 } },

  // ---- Sun Nuclear
  { id: 'SNC125c', maker: 'Sun Nuclear', model: 'SNC125c', trs: { a: 1.097, b: -0.09749 },
    trsTable: [1.0005, 0.9991, 0.9971, 0.9944, 0.9908, 0.9878, 0.9840, 0.9794, 0.9739, 0.9671, 0.9590, 0.9492] },
  { id: 'SNC600c', maker: 'Sun Nuclear', model: 'SNC600c', note: 'Фармер', noteEn: 'Farmer', trs: { a: 1.068, b: -0.08485 },
    trsTable: [1.0004, 0.9993, 0.9978, 0.9957, 0.9926, 0.9899, 0.9866, 0.9823, 0.9770, 0.9703, 0.9620, 0.9517] },
];

export function findChamber(id) {
  return CHAMBERS.find((c) => c.id === id) || null;
}

export function chamberLabel(c) {
  return `${c.maker} ${c.model}`;
}
