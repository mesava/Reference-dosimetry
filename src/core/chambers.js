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
// rCavMm — радиус полости, мм: WGTG51 Report 374, табл. 1; для старых камер — TG-51, табл. III;
//          для PTW 31021 — TRS-398 Rev.1, табл. 4.
// lengthMm — длина полости, мм: TRS-398 Rev.1, табл. 4 (только там, где она указана).
// sleeve — камера не водонепроницаема, нужен чехол (ПММА ≤ 1 мм).
// notes — замечания к камере: scope 'tg51' | 'trs', level 'warn' | 'info'.

export const LEGACY_NODES = [58, 63, 66, 71, 81, 93];

export const CHAMBERS = [
  // ---- Capintec
  { id: 'PR06C', maker: 'Capintec', model: 'PR-06C/G', note: 'Фармер 0,6 см³', sleeve: true, rCavMm: 3.2,
    tg51: { A: 0.9519, B: 2.432, C: -2.704, kq63: 0.998 }, trs: { a: 1.06833, b: -0.08262 } },
  { id: 'PR05', maker: 'Capintec', model: 'PR-05/PR-05P', note: 'данные TG-51 1999 г.', rCavMm: 2.0,
    tg51Legacy: [0.999, 0.997, 0.995, 0.990, 0.972, 0.948],
    notes: [{ scope: 'tg51', level: 'warn', text: 'Аддендум 2014 разрешает эту камеру, только если она отвечает требованиям к камерам эталонного класса (табл. III аддендума).' }] },

  // ---- Exradin (Standard Imaging)
  { id: 'A19', maker: 'Exradin', model: 'A19', note: 'водонепроницаемый Фармер', rCavMm: 3.05,
    tg51: { A: 0.9934, B: 1.384, C: -2.125, kq63: 0.996 }, trs: { a: 1.12024, b: -0.10493 } },
  { id: 'A12', maker: 'Exradin', model: 'A12', note: 'Фармер 0,6 см³', rCavMm: 3.05,
    tg51: { A: 1.0146, B: 0.777, C: -1.666, kq63: 0.997 }, trs: { a: 1.09783, b: -0.09544 } },
  { id: 'A12S', maker: 'Exradin', model: 'A12S', note: 'короткий Фармер 0,2 см³', rCavMm: 3.05,
    tg51: { A: 0.9692, B: 1.974, C: -2.448, kq63: 0.996 }, trs: { a: 1.11499, b: -0.10057 } },
  { id: 'A18', maker: 'Exradin', model: 'A18', note: '0,125 см³', rCavMm: 2.45,
    tg51: { A: 0.9944, B: 1.286, C: -1.98, kq63: 0.997 }, trs: { a: 1.10487, b: -0.0967 } },
  { id: 'A1', maker: 'Exradin', model: 'A1', note: '0,06 см³', rCavMm: 2.0,
    tg51: { A: 1.0029, B: 1.023, C: -1.803, kq63: 0.996 } },
  { id: 'A1SL', maker: 'Exradin', model: 'A1SL', note: '0,06 см³', rCavMm: 2.0,
    tg51: { A: 0.9896, B: 1.41, C: -2.049, kq63: 0.997 }, trs: { a: 1.21633, b: -0.13351 } },
  { id: 'A26', maker: 'Exradin', model: 'A26', trs: { a: 1.09587, b: -0.09383 } },
  { id: 'A28', maker: 'Exradin', model: 'A28', trs: { a: 1.12453, b: -0.10278 } },

  // ---- NE
  { id: 'NE2571', maker: 'NE', model: '2571', note: 'Фармер 0,6 см³', sleeve: true, rCavMm: 3.14, lengthMm: 24.1,
    tg51: { A: 0.9882, B: 1.486, C: -2.14, kq63: 0.997 }, trs: { a: 1.08918, b: -0.09222 } },
  { id: 'NE2561', maker: 'NE', model: '2561 / 2611A', note: 'вторичный эталон NPL', sleeve: true, rCavMm: 3.7,
    tg51: { A: 0.9722, B: 1.977, C: -2.463, kq63: 0.999 }, trs: { a: 1.07699, b: -0.08732 } },
  { id: 'NE2505', maker: 'NE', model: '2505/3, 3A', note: 'данные TG-51 1999 г.', sleeve: true, rCavMm: 3.15,
    tg51Legacy: [1.0, 0.998, 0.995, 0.988, 0.972, 0.951] },
  { id: 'NE2577', maker: 'NE', model: '2577', note: 'данные TG-51 1999 г.', sleeve: true, rCavMm: 3.15,
    tg51Legacy: [1.0, 0.998, 0.995, 0.988, 0.972, 0.951] },

  // ---- PTW
  { id: 'PTW30010', maker: 'PTW', model: '30010', note: 'Фармер 0,6 см³', sleeve: true, rCavMm: 3.05, lengthMm: 23.0,
    tg51: { A: 1.0093, B: 0.926, C: -1.771, kq63: 0.997 }, trs: { a: 1.12594, b: -0.1074 } },
  { id: 'PTW30011', maker: 'PTW', model: '30011', note: 'Фармер 0,6 см³', sleeve: true, rCavMm: 3.05,
    tg51: { A: 0.9676, B: 2.061, C: -2.528, kq63: 0.997 }, trs: { a: 1.1085, b: -0.10107 } },
  { id: 'PTW30012', maker: 'PTW', model: '30012', note: 'Фармер 0,6 см³', sleeve: true, rCavMm: 3.05, lengthMm: 23.0,
    tg51: { A: 0.9537, B: 2.44, C: -2.75, kq63: 0.998 }, trs: { a: 1.12442, b: -0.10415 } },
  { id: 'PTW30013', maker: 'PTW', model: '30013', note: 'водонепроницаемый Фармер', rCavMm: 3.05, lengthMm: 23.0,
    tg51: { A: 0.9652, B: 2.141, C: -2.623, kq63: 0.996 }, trs: { a: 1.18273, b: -0.13256 } },
  { id: 'PTW31013', maker: 'PTW', model: '31013', note: 'Semiflex 0,3 см³', rCavMm: 2.75, lengthMm: 16.3,
    tg51: { A: 0.9725, B: 1.957, C: -2.498, kq63: 0.997 }, trs: { a: 1.19297, b: -0.13366 } },
  { id: 'PTW31003', maker: 'PTW', model: '31003', note: 'k_Q как у 31013 по аддендуму TG-51', rCavMm: 2.75,
    tg51: { A: 0.9725, B: 1.957, C: -2.498, kq63: 0.997 },
    notes: [{ scope: 'tg51', level: 'info', text: 'Аддендум TG-51, разд. 3.E(i): PTW 31003 идентична 31013, используются её данные. В TRS-398 Rev.1 этой камеры нет.' }] },
  { id: 'PTW31010', maker: 'PTW', model: '31010', note: 'Semiflex 0,125 см³', rCavMm: 2.75, lengthMm: 6.5,
    trs: { a: 1.23755, b: -0.15295 },
    notes: [{ scope: 'trs', level: 'warn', text: 'TRS-398 Rev.1, табл. 4: камера не отвечает спецификации эталонного класса; включена как возможный вариант для пучков БВФ и требует дополнительной характеризации.' }] },
  { id: 'PTW31016', maker: 'PTW', model: '31016', note: 'PinPoint 3D', rCavMm: 1.45,
    trs: { a: 1.1165, b: -0.10841 },
    notes: [{ scope: 'trs', level: 'warn', text: 'TRS-398 Rev.1, табл. 16, прим. b: объём меньше рекомендованного; камера включена для измерений в пучках БВФ.' }] },
  { id: 'PTW31021', maker: 'PTW', model: '31021', note: 'Semiflex 3D', rCavMm: 2.4, lengthMm: 4.8,
    trs: { a: 1.29612, b: -0.16514 },
    notes: [{ scope: 'trs', level: 'warn', text: 'TRS-398 Rev.1, табл. 16, прим. b: объём меньше рекомендованного; камера включена для измерений в пучках БВФ.' }] },
  { id: 'PTW31022', maker: 'PTW', model: '31022', note: 'PinPoint 3D',
    trs: { a: 1.14435, b: -0.1113 },
    notes: [{ scope: 'trs', level: 'warn', text: 'TRS-398 Rev.1, табл. 16, прим. b: объём меньше рекомендованного; камера включена для измерений в пучках БВФ.' }] },
  { id: 'PTW30001', maker: 'PTW', model: 'N30001 / N23333', note: 'данные TG-51 1999 г.', sleeve: true, rCavMm: 3.05,
    tg51Legacy: [1.0, 0.996, 0.992, 0.984, 0.967, 0.945] },
  { id: 'PTW30006', maker: 'PTW', model: '30006', note: 'k_Q как у N30001, TG-51 1999 г.',
    tg51Legacy: [1.0, 0.996, 0.992, 0.984, 0.967, 0.945],
    notes: [{ scope: 'tg51', level: 'info', text: 'TG-51, разд. XI, и аддендум, разд. 3.E(iii): для PTW 30006 используются данные k_Q камеры N30001.' }] },
  { id: 'PTW30002', maker: 'PTW', model: 'N30002', note: 'данные TG-51 1999 г.', sleeve: true, rCavMm: 3.05,
    tg51Legacy: [1.0, 0.997, 0.994, 0.987, 0.97, 0.948] },
  { id: 'PTW30004', maker: 'PTW', model: 'N30004', note: 'данные TG-51 1999 г.', sleeve: true, rCavMm: 3.05,
    tg51Legacy: [1.0, 0.998, 0.995, 0.988, 0.973, 0.952] },

  // ---- IBA
  { id: 'FC65G', maker: 'IBA', model: 'FC65-G', note: 'водонепроницаемый Фармер', rCavMm: 3.1, lengthMm: 23.0,
    tg51: { A: 0.9708, B: 1.972, C: -2.48, kq63: 0.997 }, trs: { a: 1.09752, b: -0.09642 } },
  { id: 'FC65P', maker: 'IBA', model: 'FC65-P', note: 'Фармер', rCavMm: 3.1, lengthMm: 23.0,
    tg51: { A: 0.9828, B: 1.664, C: -2.296, kq63: 0.997 }, trs: { a: 1.12374, b: -0.10784 } },
  { id: 'FC23C', maker: 'IBA', model: 'FC23-C', note: 'короткий Фармер 0,2 см³', rCavMm: 3.1,
    tg51: { A: 0.982, B: 1.579, C: -2.166, kq63: 0.996 }, trs: { a: 1.09189, b: -0.09346 } },
  { id: 'CC25', maker: 'IBA', model: 'CC25', note: '0,25 см³', rCavMm: 3.0,
    tg51: { A: 0.9551, B: 2.353, C: -2.687, kq63: 0.997 }, trs: { a: 1.08981, b: -0.09254 } },
  { id: 'CC13', maker: 'IBA', model: 'CC13', note: '0,13 см³', rCavMm: 3.0, lengthMm: 5.8,
    tg51: { A: 0.9515, B: 2.455, C: -2.768, kq63: 0.996 }, trs: { a: 1.11441, b: -0.1026 } },
  { id: 'IC10', maker: 'IBA', model: 'IC10 (Wellhöfer)', note: 'k_Q как у CC13 по аддендуму TG-51',
    tg51: { A: 0.9515, B: 2.455, C: -2.768, kq63: 0.996 },
    notes: [{ scope: 'tg51', level: 'info', text: 'Аддендум TG-51, разд. 3.E(ii): для IC10 используются данные CC13. В TRS-398 Rev.1 этой камеры нет.' }] },
  { id: 'CC08', maker: 'IBA', model: 'CC08', note: '0,08 см³',
    tg51: { A: 0.943, B: 2.637, C: -2.884, kq63: 0.995 } },

  // ---- Sun Nuclear
  { id: 'SNC125c', maker: 'Sun Nuclear', model: 'SNC125c', trs: { a: 1.097, b: -0.09749 } },
  { id: 'SNC600c', maker: 'Sun Nuclear', model: 'SNC600c', note: 'Фармер', trs: { a: 1.068, b: -0.08485 } },
];

export function findChamber(id) {
  return CHAMBERS.find((c) => c.id === id) || null;
}

export function chamberLabel(c) {
  return `${c.maker} ${c.model}`;
}
