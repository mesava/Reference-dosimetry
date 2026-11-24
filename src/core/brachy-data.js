// Справочные данные раздела «Брахитерапия»: периоды полураспада, поправки на модель источника для колодезной камеры,
// коэффициенты метода цилиндрического фантома (фантом Кригера, PTW 9193) и литературные значения для ⁶⁰Co.
// Каждое число — со ссылкой на таблицу или уравнение источника; проверки — tests/brachy.test.js.

const REF = {
  trs492: 'IAEA TRS-492 (2023)',
  dgmp13: 'DGMP-Bericht 13 (1999, испр. изд. 2006)',
  din: 'DIN 6809-2',
  ptw9193: 'руководство PTW 9193 (D402.131.00/05, 2017)',
  ubrich12: 'Ubrich 2012, магистерская диссертация (TU Kaiserslautern)',
  ubrich14: 'Ubrich et al. 2014, Z. Med. Phys. 24 138–52',
  azhari: 'Azhari et al. 2012, J. Med. Phys. 37 183–92',
  hebd: 'Perez-Calatayud et al. 2012, AAPM Report 229 (HEBD, AAPM/ESTRO)',
  tg43: 'Rivard et al. 2004, Med. Phys. 31 633–74 (TG-43U1)',
};
export { REF as BRACHY_REF };

/** Сутки в году при переводе периода полураспада: TRS-492, разд. 3.2 и 7.3 (с учётом високосных лет). */
export const DAYS_PER_YEAR = 365.242198;

/**
 * Рекомендованные периоды полураспада, сутки: TRS-492, табл. 3 (u — стандартная неопределённость, сут).
 * Значения в годах переведены множителем DAYS_PER_YEAR.
 */
export const HALF_LIVES = {
  'Ir-192': { days: 73.827, u: 0.013, label: '¹⁹²Ir', ref: `${REF.trs492}, табл. 3` },
  'Co-60': { days: 1925.21, u: 0.29, label: '⁶⁰Co', ref: `${REF.trs492}, табл. 3` },
  'I-125': { days: 59.388, u: 0.028, label: '¹²⁵I', ref: `${REF.trs492}, табл. 3` },
  'Pd-103': { days: 16.991, u: 0.019, label: '¹⁰³Pd', ref: `${REF.trs492}, табл. 3` },
  'Cs-131': { days: 9.689, u: 0.016, label: '¹³¹Cs', ref: `${REF.trs492}, табл. 3` },
  'Cs-137': { days: 30.05 * DAYS_PER_YEAR, u: 0.08 * DAYS_PER_YEAR, label: '¹³⁷Cs', ref: `${REF.trs492}, табл. 3 (30,05 года)` },
  'Sr-90': { days: 28.8 * DAYS_PER_YEAR, u: 0.07 * DAYS_PER_YEAR, label: '⁹⁰Sr', ref: `${REF.trs492}, табл. 3 (28,80 года)` },
  'Ru-106': { days: 371.5, u: 2.5, label: '¹⁰⁶Ru/¹⁰⁶Rh', ref: `${REF.trs492}, табл. 3` },
};

/**
 * Модели источников ¹⁹²Ir в TRS-492, табл. 8 (в порядке столбцов таблицы). pdr — источник PDR.
 * Таблица относится только к колодезной камере Standard Imaging HDR 1000 Plus с держателем 70010.
 */
export const KSM_SOURCES = [
  { id: 'flexisource', name: 'Elekta Flexisource HDR Ir-192' },
  { id: 'mhdr-v1', name: 'Elekta microSelectron mHDR-v1 (classic)' },
  { id: 'mhdr-v2', name: 'Elekta microSelectron mHDR-v2' },
  { id: 'gi192m11', name: 'BEBIG HDR Ir-192 GI192M11' },
  { id: 'gammamed-hdr', name: 'Varian GammaMed Plus HDR' },
  { id: 'vs2000', name: 'Varian VariSource VS2000' },
  { id: 'gammamed-pdr', name: 'Varian GammaMed Plus PDR', pdr: true },
];

/**
 * k_sm,sm0: TRS-492, табл. 8 (расчёт Монте-Карло NPL; расширенная неопределённость 0,4 %, k = 2).
 * Строка — модель источника пользователя sm, столбец — модель sm0, с которой калибровали камеру
 * (пример 1 в разд. 8.3: калибровка на Flexisource, измерение VS2000 → 0,987).
 */
export const KSM_TABLE = [
  [1.0, 0.996, 0.996, 0.997, 0.999, 1.013, 1.043],
  [1.004, 1.0, 1.001, 1.001, 1.004, 1.018, 1.047],
  [1.004, 0.999, 1.0, 1.001, 1.003, 1.017, 1.047],
  [1.003, 0.999, 0.999, 1.0, 1.002, 1.016, 1.046],
  [1.001, 0.996, 0.997, 0.998, 1.0, 1.014, 1.043],
  [0.987, 0.983, 0.983, 0.984, 0.986, 1.0, 1.029],
  [0.959, 0.955, 0.955, 0.956, 0.958, 0.972, 1.0],
];

/** Стандартная неопределённость k_sm,sm0 из табл. 8, %: TRS-492, разд. 8.3 (0,4 % при k = 2). */
export const KSM_TABLE_U = 0.2;
/**
 * Нет данных для своей камеры или источника: k_sm,sm0 = 1, к неопределённости добавляется 2 % (стандартная),
 * до 5 % при переходе между HDR и PDR: TRS-492, разд. 8.3 (это «отклонение», а не неопределённость).
 */
export const KSM_NO_DATA_U = 2;
export const KSM_NO_DATA_U_HDR_PDR = 5;

/**
 * Пороги сравнения измеренной силы источника с сертификатом производителя, %: TRS-492, разд. 8.6.2.
 * HDR: больше 3 % — выяснить причину; больше 5 % — клинически не использовать до выяснения.
 * LDR: среднее не меньше чем по 5 зёрнам; больше 5 % — измерить ещё 5 зёрен.
 */
export const CERT_TOLERANCE = { hdrInvestigate: 3, hdrStop: 5, ldr: 5, ldrMinSeeds: 5 };

/** Утечка меньше этой доли показания (0,1 %) в лечебном учреждении не учитывается: TRS-492, разд. 8.2.3.4. */
export const LEAKAGE_IGNORE = 0.001;

/** Долговременная стабильность колодезной камеры: в пределах ±0,5 % от исходного значения, TRS-492, разд. 8.5. */
export const STABILITY_TOL = 0.5;

// ——— Метод цилиндрического фантома (фантом Кригера, PTW 9193): DIN 6809-2, DGMP-Bericht 13, руководство PTW ———

/** Расстояние источник — центр камеры в фантоме, см, и поправка на расстояние k_r = (8/100)²: DGMP 13, ур. (12). */
export const PHANTOM_R_CM = 8;
export const PHANTOM_KR = (PHANTOM_R_CM / 100) ** 2;

/**
 * Геометрический фактор фантома k_zp = 1,187 ± 0,012 для ¹⁹²Ir: DGMP 13, ур. (13); руководство PTW 9193, табл. 1.
 * В него входит поправка на объём камеры M23332 k_V = 1,0037 (r = 8 см); для другой камеры i
 * k_zp,i = k_zp · k_V,i / k_V,M23332 (DGMP 13, сноска 4).
 */
export const PHANTOM_KZP_IR = 1.187;
export const PHANTOM_KZP_IR_U = 0.012;
export const PHANTOM_KZP_REF_CHAMBER = 'M23332';

/**
 * Поправка на объём камеры k_V на расстоянии 8 см: DGMP 13, табл. 2.1 (столбец r = 8,00 см).
 * Геометрия полости (объём, см³; длина и внутренний радиус, см): DGMP 13, табл. 2.2.
 */
export const DGMP_CHAMBERS = {
  M2332: { kV8: 1.0016, volume: 0.1, length: 1.2, radius: 0.175 },
  M23331: { kV8: 1.0051, volume: 1.0, length: 2.2, radius: 0.4 },
  M23332: { kV8: 1.0037, volume: 0.3, length: 1.8, radius: 0.25 },
  M233642: { kV8: 0.9998, volume: 0.125, length: 0.65, radius: 0.275 },
  M30001: { kV8: 1.0072, volume: 0.6, length: 2.3, radius: 0.305 },
};

/**
 * Современные модели PTW → камера DGMP 13 с той же полостью.
 * 30015, 30010, 30016, 31010 — старые обозначения по Ubrich 2012, табл. 2.2;
 * 30013 — та же полость, что у M30001 (r = 3,05 мм, L = 23,0 мм; сверено пользователем по паспорту PTW).
 */
export const PTW_TO_DGMP = {
  '2332': 'M2332',
  '23331': 'M23331',
  '30015': 'M23331',
  '23332': 'M23332',
  '30016': 'M23332',
  '233642': 'M233642',
  '31010': 'M233642',
  '30001': 'M30001',
  '30010': 'M30001',
  '30013': 'M30001',
};

/**
 * Камеры других производителей, приближённо приравненные к камере DGMP 13 по размерам полости (данных DGMP для них нет):
 * IBA FC65-G — полость L ≈ 23,1 мм, r ≈ 3,1 мм (паспорт IBA) против M30001 L 23,0 мм, r 3,05 мм (DGMP 13, табл. 2.2).
 */
export const APPROX_TO_DGMP = [{ re: /FC\s*-?\s*65/i, dgmp: 'M30001', name: 'IBA FC65-G' }];

/**
 * Постоянные для ¹⁹²Ir в фантоме: DGMP 13, гл. 2; руководство PTW 9193, табл. 1 (по DIN 6809-2).
 * g — доля тормозного излучения в воде и воздухе; tWA = (μ_en/ρ)_w/(μ_en/ρ)_a; W/e, В; kRC, Кл/(кг·Р);
 * kwp = kap = 1; kQ = 1 для современных компактных камер.
 */
export const PHANTOM_IR = { gW: 0.001, gA: 0.001, tWA: 1.111, We: 33.97, kRC: 2.58e-4, kwp: 1, kap: 1, kQ: 1 };

/**
 * Итоговые множители руководства PTW 9193 при r = 8 см и k_zp = 1,187 (камера M23332): ур. (9), (11), (13).
 * K̇ (мГр/ч на 1 м) = множитель · k · N · R_zp; N_s — Р/дел., N_w и N_a — мГр/дел., R_zp — дел./ч.
 */
export const PTW_MANUAL_FACTORS = { Ns: 0.0666, Nw: 0.00684, Na: 0.0076 };

/**
 * Мощность дозы в воде в точке измерения фантома: Ḋ_w,zp (сГр/мин; 8 см) = 0,2435 · K̇ (мГр/ч; 1 м),
 * руководство PTW 9193, ур. (15); пример: 4 мГр/ч → 0,974 сГр/мин. Только для ¹⁹²Ir.
 */
export const PHANTOM_DOSE_RATE_FACTOR = 0.2435;

/**
 * k_ges по DGMP 13 для калибровки в N_Dw (без k_ρ): Ubrich 2012, табл. 2.2 — для проверки расчёта k_zp по камерам.
 */
export const UBRICH_KGES_DGMP = { '30015': 6.854e-3, '30010': 6.869e-3, '30016': 6.845e-3, '31010': 6.818e-3 };

/**
 * ⁶⁰Co в фантоме: в DGMP 13 данных нет. Справочные значения общего множителя k_tot (K̇ = k_tot · N_Dw · M), источник
 * BEBIG Co0.A86: Ubrich 2014, табл. 5 (расчёт Монте-Карло и калибровка PTB); Azhari 2012, табл. 2:
 * k_zp = 1,276, g_w = 0,0028, g_a = 0,0032, t_w,a = 1/0,900 → k_tot = 7,370·10⁻³ (без k_A).
 * Рекомендуемый путь — свой k_tot сличением с колодезной камерой на том же источнике.
 */
export const PHANTOM_CO60 = { gW: 0.0028, gA: 0.0032, tWA: 1 / 0.9, kzpAzhari: 1.276 };
export const PHANTOM_CO60_LITERATURE = [
  { chamber: '30015', kTot: 7.053e-3, method: 'mc', ref: `${REF.ubrich14}, табл. 5` },
  { chamber: '30016', kTot: 7.039e-3, method: 'mc', ref: `${REF.ubrich14}, табл. 5` },
  { chamber: '31010', kTot: 6.99e-3, method: 'mc', ref: `${REF.ubrich14}, табл. 5` },
  { chamber: '30015', kTot: 7.145e-3, method: 'ptb', ref: `${REF.ubrich14}, табл. 5` },
  { chamber: '30016', kTot: 7.179e-3, method: 'ptb', ref: `${REF.ubrich14}, табл. 5` },
  { chamber: 'M23332', kTot: 7.37e-3, method: 'azhari', ref: `${REF.azhari}, табл. 2` },
];

/**
 * Поправка на ослабление и рассеяние в стальном аппликаторе k_A: Azhari 2012, табл. 2 и обсуждение
 * (взяты из BEBIG HDRplus 2.2 и Baltas). DGMP 13 определяет K̇ с клиническим аппликатором; для сравнения
 * с сертификатом источника (без аппликатора) показание умножают на k_A.
 */
export const APPLICATOR_KA_STEEL = { 'Ir-192': 1.0165, 'Co-60': 1.0267 };

/**
 * Источники HDR для поглощённой дозы в воде по TG-43 (консенсусные данные HEBD, Perez-Calatayud 2012):
 * Λ — постоянная мощности дозы, сГр·ч⁻¹·Ед⁻¹ (¹⁹²Ir — табл. IV, ⁶⁰Co — табл. LIII); L — активная длина, см;
 * gL8 — радиальная функция g_L(8 см) (¹⁹²Ir — табл. V, для mHDR-v1 — значение для неограниченной среды
 * в скобках; ⁶⁰Co — табл. LII). id совпадают с KSM_SOURCES, где это та же модель. VariSource Classic в HEBD нет —
 * только для (k_tot)Ḋw,1 Ubrich 2014.
 */
export const DOSE_SOURCES = [
  { id: 'mhdr-v1', nuclide: 'Ir-192', name: 'Nucletron microSelectron mHDR-v1 (classic)', lambda: 1.116, L: 0.35, gL8: 0.97 },
  { id: 'mhdr-v2', nuclide: 'Ir-192', name: 'Nucletron microSelectron mHDR-v2', lambda: 1.109, L: 0.35, gL8: 0.972 },
  { id: 'vs2000', nuclide: 'Ir-192', name: 'Varian VariSource VS2000', lambda: 1.1, L: 0.5, gL8: 0.982 },
  { id: 'buchler', nuclide: 'Ir-192', name: 'E&Z BEBIG Buchler', lambda: 1.117, L: 0.13, gL8: 0.971 },
  { id: 'gammamed-12i', nuclide: 'Ir-192', name: 'Varian GammaMed HDR 12i', lambda: 1.118, L: 0.35, gL8: 0.968 },
  { id: 'gammamed-hdr', nuclide: 'Ir-192', name: 'Varian GammaMed HDR Plus', lambda: 1.117, L: 0.35, gL8: 0.968 },
  { id: 'gi192m11', nuclide: 'Ir-192', name: 'E&Z BEBIG GI192M11', lambda: 1.11, L: 0.35, gL8: 0.968 },
  { id: 'ir2a85-2', nuclide: 'Ir-192', name: 'E&Z BEBIG Ir2.A85-2', lambda: 1.109, L: 0.35, gL8: 0.968 },
  { id: 'm19', nuclide: 'Ir-192', name: 'SPEC M-19', lambda: 1.114, L: 0.35, gL8: 0.969 },
  { id: 'flexisource', nuclide: 'Ir-192', name: 'Flexisource (Isodose Control / Elekta)', lambda: 1.113, L: 0.35, gL8: 0.968 },
  { id: 'varisource-classic', nuclide: 'Ir-192', name: 'Varian VariSource Classic', lambda: null, L: null, gL8: null },
  { id: 'gk60m21', nuclide: 'Co-60', name: 'E&Z BEBIG GK60M21', lambda: 1.089, L: 0.35, gL8: 0.884 },
  { id: 'co0a86', nuclide: 'Co-60', name: 'E&Z BEBIG Co0.A86', lambda: 1.092, L: 0.35, gL8: 0.884 },
].map((x) => ({ ...x, ref: x.lambda ? `${REF.hebd}, ${x.nuclide === 'Co-60' ? 'табл. LII, LIII' : 'табл. IV, V'}` : null }));

/**
 * Общий множитель для референсной мощности поглощённой дозы в воде на 1 см (k_tot)Ḋw,1: Ḋ_w,1 = (k_tot)Ḋw,1 · N_Dw · M
 * (Ubrich 2014, ур. 6, табл. 7; Монте-Карло, расширенная статистическая неопределённость 0,3 %). Ḋ_w,1 — в тех же
 * единицах времени, что M. Зависит от геометрии источника — только для перечисленных моделей и камер PTW.
 */
export const UBRICH_KTOT_DW1 = {
  'mhdr-v2': { '30015': 74.2, '30016': 74.55, '31010': 74.07 },
  'mhdr-v1': { '30015': 74.22, '30016': 74.6, '31010': 74.16 },
  'gammamed-12i': { '30015': 74.32, '30016': 74.54, '31010': 74.13 },
  'varisource-classic': { '30015': 69.25, '30016': 69.59, '31010': 69.15 },
  co0a86: { '30015': 77.18, '30016': 77.02, '31010': 76.49 },
};
export const UBRICH_KTOT_DW1_REF = `${REF.ubrich14}, ур. (6), табл. 7`;
