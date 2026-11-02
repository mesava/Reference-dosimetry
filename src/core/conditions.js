// Референсные условия протоколов: явный перечень условий для ⁶⁰Co, МВ фотонов и электронов.
//
// Статус «референсные условия соблюдены / нестандартные условия» строится только из этого перечня, а не из
// замечаний: каждое условие проверяется по значениям расчёта (ctx) и получает одно из состояний:
//   met     — условие выполнено;
//   notmet  — отступление от протокола (результат — не референсная дозиметрия по нему);
//   unknown — проверить нельзя: нужного значения нет (это не считается выполнением, в протоколе — «не проверено»);
//   na      — к этому расчёту не относится (например, условие для пучков БВФ в пучке с фильтром).
// Проверка возвращает true / false / null (нет данных) / 'na'. Отсутствующее значение (undefined, NaN) — всегда
// «не проверено», поэтому забытое значение не превращается в «соблюдено».
//
// Условия не добавляют требований сверх протоколов: это те же проверки, что дают замечания в расчёте, с теми же
// пределами и источниками. Ручная геометрия, другое поле или глубина допустимы: расчёт выполняется, но с пометкой
// «нестандартные условия» и причиной.

import { L } from './i18n.js';
import { ru } from './units.js';

export const GROUPS = {
  geometry: () => L('Геометрия', 'Geometry'),
  quality: () => L('Качество пучка', 'Beam quality'),
  detector: () => L('Камера', 'Chamber'),
  coefficients: () => L('Коэффициенты', 'Coefficients'),
  route: () => L('Путь калибровки', 'Calibration route'),
};

const REF = {
  trs: 'TRS-398 Rev.1',
  tg51: 'TG-51 (1999)',
  add: 'аддендум TG-51 (2014)',
  r374: 'WGTG51 Report 374',
  r385: 'Report 385',
};
const { trs: TRS, tg51: TG51, add: ADD, r374: R374, r385: R385 } = REF;

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const cm = (x) => ru(x, x % 1 ? 1 : 0);
const eq = (a, b) => Math.abs(a - b) < 1e-9;

/** Значение есть → проверка, нет → «не проверено». */
const need = (x, test) => (num(x) === null ? null : test(x));

// --------------------------------------------------------------- общие условия камеры (эталонный класс)

const leakage = {
  id: 'leakage',
  group: 'detector',
  scope: 'common',
  label: () => L('утечка не больше 0,1 % показания', 'leakage not above 0.1 % of the reading'),
  ref: `${ADD}, табл. III; ${TRS}, табл. 3`,
  check: (c) => need(c.kleak, (k) => Math.abs(k - 1) <= 0.001 + 1e-12),
  reason: () => L('утечка больше 0,1 %: камера не отвечает критерию эталонного класса', 'leakage above 0.1 %: the chamber does not meet the reference-class criterion'),
};

/** Эффект полярности: limit — допустимое |k_pol − 1|. При k_pol из калибровки (проверка выхода) — не относится. */
const polarityCond = (limit, ref, reason) => ({
  id: 'polarity',
  group: 'detector',
  scope: 'common',
  label: () => L(`эффект полярности не больше ${ru(limit * 100, 1)} %`, `polarity effect not above ${ru(limit * 100, 1)} %`),
  ref,
  check: (c) => (c.kpolFixed ? 'na' : need(c.kpolRaw, (k) => Math.abs(k - 1) <= limit + 1e-12)),
  reason,
});

// ------------------------------------------------------------------------------------------- ⁶⁰Co

export const COBALT_CONDITIONS = [
  {
    id: 'distance',
    group: 'geometry',
    scope: 'trs',
    label: () => L('РИП или РИК 80 или 100 см', 'SSD or SCD 80 or 100 cm'),
    ref: `${TRS}, табл. 12`,
    check: (c) => need(c.distance, (d) => eq(d, 80) || eq(d, 100)),
    reason: (c) => L(`расстояние ${cm(c.distance)} см вместо 80 или 100 см`, `distance ${cm(c.distance)} cm instead of 80 or 100 cm`),
  },
  {
    id: 'zref',
    group: 'geometry',
    scope: 'tg51',
    label: () => L('глубина 10 г/см²', 'depth 10 g/cm²'),
    ref: `${TG51}, разд. IX.A`,
    check: (c) => need(c.zref, (z) => eq(z, 10)),
    reason: (c) => L(`z_ref = ${ru(c.zref, 0)} г/см² вместо 10 г/см²`, `z_ref = ${ru(c.zref, 0)} g/cm² instead of 10 g/cm²`),
  },
  {
    id: 'refclass',
    group: 'detector',
    scope: 'common',
    label: () => L('камера эталонного класса', 'reference-class chamber'),
    ref: `${TRS}, табл. 4`,
    check: (c) => (c.chamber ? !c.chamber.notReferenceClass : null),
    reason: () => L('камера не эталонного класса (TRS-398 Rev.1, табл. 4)', 'chamber not of reference class (TRS-398 Rev.1, Table 4)'),
  },
  leakage,
  polarityCond(0.004, `${TRS}, табл. 3; ${ADD}, табл. III`, (c) =>
    L(`k_pol = ${ru(c.kpolRaw, 4)}: эффект полярности больше 0,4 % (критерий эталонного класса)`, `k_pol = ${ru(c.kpolRaw, 4)}: polarity effect above 0.4 % (reference-class criterion)`),
  ),
];

// ------------------------------------------------------------------------------------- МВ фотоны

/** Камера включена в TRS-398 Rev.1 только для пучков БВФ (табл. 4; табл. 16, прим. b). */
const fffOnlyChamber = (ch) => !!ch && !ch.custom && (ch.notes || []).some((n) => n.scope === 'trs' && n.fffOnly);
const chamberName = (c) => c.chamberLabel || L('камера', 'chamber');

export const PHOTON_CONDITIONS = [
  {
    id: 'ssd',
    group: 'geometry',
    scope: 'trs',
    label: () => L('РИП 100 см (или РИК 100 см при установке по РИО)', 'SSD 100 cm (or SCD 100 cm for an SAD setup)'),
    ref: `${TRS}, табл. 14–15`,
    check: (c) => (c.geometry?.kind === 'manual' ? need(c.geometry.ssd, (s) => eq(s, 100)) : c.geometry ? true : null),
    reason: (c) => L(`РИП ${cm(c.geometry.ssd)} см вместо 100 см`, `SSD ${cm(c.geometry.ssd)} cm instead of 100 cm`),
  },
  {
    id: 'field',
    group: 'geometry',
    scope: 'common',
    label: () => L('поле 10 × 10 см', '10 × 10 cm field'),
    ref: `${TRS}, табл. 15; ${TG51}, разд. IX.A`,
    check: (c) => need(c.geometry?.field, (x) => eq(x, 10)),
    reason: (c) => {
      const x = cm(c.geometry.field);
      return L(`поле ${x} × ${x} см вместо 10 × 10 см`, `${x} × ${x} cm field instead of 10 × 10 cm`);
    },
  },
  {
    id: 'depth',
    group: 'geometry',
    scope: 'common',
    label: () => L('глубина 10 г/см²', 'depth 10 g/cm²'),
    ref: `${TRS}, табл. 15; ${TG51}, разд. IX.A`,
    check: (c) => need(c.geometry?.depth, (z) => eq(z, 10)),
    reason: (c) => L(`глубина ${cm(c.geometry.depth)} см вместо 10 см`, `depth ${cm(c.geometry.depth)} cm instead of 10 cm`),
  },
  {
    id: 'fffEnergy',
    group: 'quality',
    scope: 'trs',
    label: () => L('пучок БВФ не выше ~10 МВ', 'FFF beam not above ~10 MV'),
    ref: `${TRS}, разд. 6.1`,
    check: (c) => (!c.fff ? 'na' : need(c.energy, (e) => e <= 10)),
    reason: (c) => L(`пучок БВФ ${cm(c.energy)} МВ: выше ~10 МВ`, `${cm(c.energy)} MV FFF beam: above ~10 MV`),
    unknown: () => L('не указана номинальная энергия пучка БВФ', 'the nominal energy of the FFF beam is not given'),
  },
  {
    id: 'fffFoil',
    group: 'quality',
    scope: 'tg51',
    label: () => L('%dd(10) пучка БВФ — со свинцовой фольгой', '%dd(10) of an FFF beam with the lead foil'),
    ref: `${ADD}, разд. 4.K(3); ${R374}, разд. 3.3`,
    check: (c) => (!c.fff ? 'na' : c.q51Method ? c.q51Method !== 'open' && c.q51Method !== 'interim' : null),
    reason: () => L('%dd(10) пучка БВФ без свинцовой фольги', '%dd(10) of an FFF beam without the lead foil'),
  },
  {
    id: 'fffOnlyChamber',
    group: 'detector',
    scope: 'trs',
    label: () => L('камера предусмотрена протоколом для этого пучка', 'chamber provided for by the protocol for this beam'),
    ref: `${TRS}, табл. 4, 16`,
    check: (c) => (c.chamber ? !(fffOnlyChamber(c.chamber) && !c.fff) : null),
    reason: (c) =>
      L(`${chamberName(c)} в пучке с выравнивающим фильтром: камера включена в протокол только для БВФ`, `${chamberName(c)} in a beam with a flattening filter: the chamber is included in the protocol for FFF beams only`),
  },
  leakage,
  polarityCond(0.004, `${TRS}, табл. 3; ${ADD}, табл. III`, (c) =>
    L(`k_pol = ${ru(c.kpolRaw, 4)}: эффект полярности больше 0,4 % (критерий эталонного класса)`, `k_pol = ${ru(c.kpolRaw, 4)}: polarity effect above 0.4% (reference-class criterion)`),
  ),
  {
    id: 'kQ',
    group: 'coefficients',
    scope: 'trs',
    label: () => L('k_Q для этой камеры: TRS-398 Rev.1 или лаборатория', 'k_Q for this chamber: TRS-398 Rev.1 or the laboratory'),
    ref: `${TRS}, разд. 6.5`,
    // k_Q по камере-аналогу (своя камера без a, b и без лабораторного k_Q) — отступление
    check: (c) => (c.chamber ? !(c.kQMode !== 'manual' && c.chamber.custom && c.chamber.trs && !c.chamber.hasAB) : null),
    reason: (c) => {
      const an = c.analogLabel || '';
      return L(`k_Q по камере-аналогу ${an}: в TRS-398 Rev.1 нет данных для этой камеры`, `k_Q from the analogue chamber ${an}: TRS-398 Rev.1 has no data for this chamber`);
    },
  },
];

// ------------------------------------------------------------------------------------------ электроны

export const ELECTRON_CONDITIONS = [
  {
    id: 'ssd',
    group: 'geometry',
    scope: 'trs',
    label: () => L('РИП 100 см', 'SSD 100 cm'),
    ref: `${TRS}, табл. 19`,
    check: (c) => need(c.ssd, (s) => eq(s, 100)),
    reason: (c) => L(`РИП ${cm(c.ssd)} см вместо 100 см`, `SSD ${cm(c.ssd)} cm instead of 100 cm`),
  },
  {
    id: 'ssd385',
    group: 'geometry',
    scope: 'tg51',
    label: () => L('РИП 90–110 см', 'SSD 90–110 cm'),
    ref: `${R385}, разд. 3`,
    check: (c) => need(c.ssd, (s) => s >= 90 - 1e-9 && s <= 110 + 1e-9),
    reason: (c) => L(`РИП ${cm(c.ssd)} см вне 90–110 см`, `SSD ${cm(c.ssd)} cm outside 90–110 cm`),
  },
  {
    id: 'field',
    group: 'geometry',
    scope: 'common',
    label: () => L('поле не меньше 10 × 10 см', 'field at least 10 × 10 cm'),
    ref: `${TRS}, табл. 19; ${R385}, разд. 3`,
    check: (c) => need(c.field, (x) => x >= 10 - 1e-9),
    reason: (c) => {
      const x = cm(c.field);
      return L(`поле ${x} × ${x} см меньше 10 × 10 см`, `${x} × ${x} cm field smaller than 10 × 10 cm`);
    },
  },
  {
    id: 'r50range',
    group: 'quality',
    scope: 'tg51',
    label: () => L('R50 в области Report 385 (1,70–8,70 см)', 'R50 within the scope of Report 385 (1.70–8.70 cm)'),
    ref: `${R385}, разд. 1`,
    // при любом способе k_Q: ручной k_Q не расширяет область документа
    check: (c) => need(c.r50, (r) => r >= 1.7 - 1e-9 && r <= 8.7 + 1e-9),
    reason: (c) => L(`R50 = ${ru(c.r50, 2)} см вне области Report 385 (1,70–8,70 см)`, `R50 = ${ru(c.r50, 2)} cm outside the scope of Report 385 (1.70–8.70 cm)`),
  },
  {
    id: 'kQtrs',
    group: 'coefficients',
    scope: 'trs',
    label: () => L('k_Q по данным TRS-398 Rev.1 (или измерен)', 'k_Q from TRS-398 Rev.1 data (or measured)'),
    ref: `${TRS}, табл. 20–21, прил. II`,
    check: (c) => (c.chamber ? !c.kQNonstandard : null),
    reason: (c) =>
      c.kQNonstandard === 'trs2004'
        ? L(`${chamberName(c)}: k_Q из табл. 18 TRS-398 первого издания — TRS-398 Rev.1 для этой камеры при калибровке в ⁶⁰Co k_Q не даёт`, `${chamberName(c)}: k_Q from TRS-398 first edition Table 18; TRS-398 Rev.1 gives no k_Q for this chamber calibrated in ⁶⁰Co`)
        : L(`${chamberName(c)}: k_Q рассчитан по Report 385 — TRS-398 Rev.1 для этой камеры при калибровке в ⁶⁰Co k_Q не даёт`, `${chamberName(c)}: k_Q calculated per Report 385; TRS-398 Rev.1 gives no k_Q for this chamber calibrated in ⁶⁰Co`),
  },
  {
    id: 'chamber385',
    group: 'detector',
    scope: 'tg51',
    label: () => L('камера из таблиц Report 385', 'chamber from the Report 385 tables'),
    ref: `${R385}, разд. 6.6`,
    check: (c) => (c.chamber ? !c.chamber.other && !!c.chamber.r385 : null),
    reason: (c) =>
      c.chamber.other
        ? L('камера не из таблиц Report 385', 'chamber not in the Report 385 tables')
        : L(`${chamberName(c)}: нет данных Report 385, k_Q введён вручную`, `${chamberName(c)}: no Report 385 data, k_Q entered manually`),
  },
  leakage,
  polarityCond(0.02, `${R385}, табл. A1; ${TRS}, табл. 3`, (c) =>
    L(`k_pol = ${ru(c.kpolRaw, 4)}: эффект полярности больше 2 %`, `k_pol = ${ru(c.kpolRaw, 4)}: polarity effect above 2 %`),
  ),
];

// ------------------------------------------------------------------------------------- kV-рентген
// Табл. 26 (низкие энергии, N_K — камера в свободном воздухе), табл. 27 (низкие, N_D,w — на поверхности фантома),
// табл. 31 (средние энергии — в воде на 2 г/см²). Поле и РИП, отличные от лабораторных, допустимы, если k_g взят по
// Rev.1 (ур. 52, 58); k_g = 1 вместо нужного, p_ch вручную и Qo = ⁶⁰Co — отступления. Фантом: низкие энергии — ПММА или
// водоэквивалентный пластик, тот же, что при калибровке (табл. 27, разд. 8.2.2); средние — вода (разд. 4.2.3, табл. 31).

const DIN = 'DIN 6809-4:2020';
const kvOnly = (range, cal, test) => (c) => (c.range === range && (!cal || c.cal === cal) ? test(c) : 'na');
const r1 = (x) => cm(Math.round(x * 10) / 10);
/** Поле тубуса как задано: Ø d, a × a или a × b. */
const fieldTxt = (c) => (c.coneShape === 'square' ? `${r1(c.coneSize)} × ${r1(c.coneSize)}` : c.coneShape === 'rect' ? `${r1(c.coneSize)} × ${r1(c.coneB)}` : `Ø ${r1(c.fClin)}`);
/** Стандартное поле Rev.1: круг диаметром s или квадрат s × s (разд. 8.4.1, табл. 26, 31). */
const isStdField = (c, s, tol) =>
  c.coneShape === 'square' ? Math.abs(c.coneSize - s) < tol : c.coneShape === 'rect' ? Math.abs(c.coneSize - s) < tol && Math.abs(c.coneB - s) < tol : Math.abs(c.fClin - s) < tol;
/** Средние энергии: тубус, сопоставимый с 10 × 10 см или Ø 10 см (табл. 31, сноска c) — круг той же площади от 9,5 до 11,8 см. */
const medComparable = (d) => d > 9.5 && d < 20 / Math.sqrt(Math.PI) + 0.5;
const phantomName = (p) => p?.name ?? L('не указан', 'not specified');

export const KV_CONDITIONS = [
  {
    id: 'kvLowNkChamber',
    group: 'detector',
    scope: 'trs',
    label: () => L('плоскопараллельная камера до 100 кВ или цилиндрическая выше 70 кВ', 'plane-parallel chamber up to 100 kV or cylindrical above 70 kV'),
    ref: `${TRS}, табл. 26`,
    check: kvOnly('low', 'nk', (c) => (c.chamber && num(c.kv) !== null ? (c.chamber.type === 'pp' ? c.kv <= 100 : c.kv >= 70) : null)),
    reason: (c) => (c.chamber.type === 'pp'
      ? L(`плоскопараллельная камера при ${cm(c.kv)} кВ (выше 100 кВ)`, `plane-parallel chamber at ${cm(c.kv)} kV (above 100 kV)`)
      : L(`цилиндрическая камера при ${cm(c.kv)} кВ (ниже 70 кВ)`, `cylindrical chamber at ${cm(c.kv)} kV (below 70 kV)`)),
  },
  {
    id: 'kvLowNkField',
    group: 'geometry',
    scope: 'trs',
    label: () => L('поле Ø 10 см или 10 × 10 см (плоскопараллельная камера), Ø 5 см или 5 × 5 см (цилиндрическая) либо N_K с поправкой на поле', 'field 10 cm in diameter or 10 × 10 cm (plane-parallel chamber), 5 cm in diameter or 5 × 5 cm (cylindrical), or N_K corrected for the field'),
    ref: `${TRS}, разд. 8.4.1, табл. 26, рис. 11`,
    check: kvOnly('low', 'nk', (c) => (c.chamber ? need(c.fClin, () => c.nkFsGiven || isStdField(c, c.chamber.type === 'cyl' ? 5 : 10, 0.05)) : null)),
    reason: (c) => L(`поле ${fieldTxt(c)} см без поправки N_K на размер поля`, `field of ${fieldTxt(c)} cm without an N_K field-size correction`),
  },
  {
    id: 'kvLowNdwChamber',
    group: 'detector',
    scope: 'trs',
    label: () => L('плоскопараллельная камера на поверхности фантома', 'plane-parallel chamber at the phantom surface'),
    ref: `${TRS}, табл. 27`,
    check: kvOnly('low', 'ndw', (c) => (c.chamber ? c.chamber.type === 'pp' : null)),
    reason: () => L('камера не плоскопараллельная', 'the chamber is not plane-parallel'),
  },
  {
    id: 'kvLowPhantom',
    group: 'geometry',
    scope: 'trs',
    label: () => L('фантом из ПММА или водоэквивалентного пластика', 'phantom of PMMA or a water-equivalent plastic'),
    ref: `${TRS}, табл. 27, разд. 8.2.2`,
    check: kvOnly('low', 'ndw', (c) => (!c.phantomStatus || c.phantomStatus.state === 'unknown' ? null : c.phantomStatus.state !== 'no')),
    reason: (c) => L(`фантом — ${phantomName(c.phantom)}: не ПММА и не водоэквивалентный пластик`, `phantom: ${phantomName(c.phantom)}, neither PMMA nor a water-equivalent plastic`),
    unknown: (c) =>
      c.phantom
        ? L(`фантом — ${phantomName(c.phantom)}: водоэквивалентность проверьте по данным производителя`, `phantom: ${phantomName(c.phantom)}; check its water equivalence against the manufacturer data`)
        : L('не указан материал фантома', 'the phantom material is not specified'),
  },
  {
    id: 'kvLowPhantomLab',
    group: 'geometry',
    scope: 'trs',
    label: () => L('фантом тот же, на котором калибровалась камера', 'the same phantom as at the chamber calibration'),
    ref: `${TRS}, разд. 8.2.2; SSRMP No 9, разд. 2.3`,
    check: kvOnly('low', 'ndw', (c) => (c.phantom && c.labPhantom ? c.phantom.id === c.labPhantom.id : null)),
    reason: (c) => L(`фантом — ${phantomName(c.phantom)}, а камера калибровалась на фантоме ${phantomName(c.labPhantom)}: камера калибруется вместе с фантомом`, `phantom: ${phantomName(c.phantom)}, while the chamber was calibrated on ${phantomName(c.labPhantom)}; the chamber is calibrated together with its phantom`),
    unknown: (c) => (c.phantom ? L('не указан фантом, на котором калибровалась камера', 'the phantom used at the chamber calibration is not specified') : L('не указан материал фантома', 'the phantom material is not specified')),
  },
  {
    id: 'kvGeometry',
    group: 'geometry',
    scope: 'trs',
    label: () => L('поле и РИП как при калибровке или поправка k_g по TRS-398 Rev.1', 'field and SSD as at calibration, or a k_g correction according to TRS-398 Rev.1'),
    ref: `${TRS}, табл. 27, ур. (52), (58)`,
    check: (c) => (c.cal !== 'ndw' ? 'na' : c.sameGeometry ? true : c.kgSource ? !['one', 'nocal'].includes(c.kgSource) : null),
    reason: (c) =>
      c.kgSource === 'nocal'
        ? L('калибровки в рентгене нет: k_g не к чему отнести, принят равным 1', 'no x-ray calibration: k_g has nothing to refer to and is taken as 1')
        : L('поле или РИП не как в лаборатории, а k_g принят равным 1 (как DIN 6809-4 и SSRMP No 9)', 'field or SSD different from the laboratory, with k_g taken as 1 (as in DIN 6809-4 and SSRMP No 9)'),
  },
  {
    id: 'kvMedChamber',
    group: 'detector',
    scope: 'trs',
    label: () => L('цилиндрическая камера на глубине 2 г/см²', 'cylindrical chamber at a depth of 2 g/cm²'),
    ref: `${TRS}, табл. 31`,
    check: kvOnly('medium', null, (c) => (c.chamber ? c.chamber.type === 'cyl' : null)),
    reason: () => L('камера не цилиндрическая', 'the chamber is not cylindrical'),
  },
  {
    id: 'kvMedField',
    group: 'geometry',
    scope: 'trs',
    label: () => L('поле 10 × 10 см или Ø 10 см, тубус сопоставимого размера или самый большой квадратный или круглый тубус аппарата', 'field 10 × 10 cm or 10 cm in diameter, an applicator of comparable size, or the largest square or circular applicator of the unit'),
    ref: `${TRS}, табл. 31, сноска c`,
    check: kvOnly('medium', null, (c) => need(c.fClin, (d) => medComparable(d) || (c.coneLargest && c.coneShape !== 'rect'))),
    reason: (c) =>
      c.coneLargest
        ? L(`самый большой тубус аппарата прямоугольный (${fieldTxt(c)} см): TRS-398 Rev.1 в этом случае берёт самый большой квадратный или круглый`, `the largest applicator of the unit is rectangular (${fieldTxt(c)} cm): TRS-398 Rev.1 then takes the largest square or circular one`)
        : L(`поле ${fieldTxt(c)} см вместо 10 × 10 см или Ø 10 см (если больших тубусов нет, отметьте «самый большой тубус»)`, `field of ${fieldTxt(c)} cm instead of 10 × 10 cm or 10 cm in diameter (if there are no larger applicators, mark "largest applicator")`),
  },
  {
    id: 'kvMedPhantom',
    group: 'geometry',
    scope: 'trs',
    label: () => L('водный фантом', 'water phantom'),
    ref: `${TRS}, разд. 4.2.3, табл. 31`,
    check: kvOnly('medium', null, (c) => (c.phantom ? c.phantom.kind === 'water' : null)),
    reason: (c) => L(`фантом — ${phantomName(c.phantom)}: для средних энергий твердые фантомы, в том числе водоэквивалентные пластики, не допускаются`, `phantom: ${phantomName(c.phantom)}; solid phantoms, including water-equivalent plastics, are not allowed for medium energies`),
    unknown: () => L('не указан материал фантома', 'the phantom material is not specified'),
  },
  {
    id: 'kvQo',
    group: 'route',
    scope: 'trs',
    label: () => L('калибровка камеры в рентгеновских качествах (Qo — kV-качество)', 'chamber calibrated in x-ray qualities (Qo is a kV quality)'),
    ref: `${TRS}, разд. 9.2.1; ${DIN}, разд. 6.4.2`,
    check: (c) => (c.range === 'medium' && c.cal === 'ndw' ? c.qo !== 'co60' : 'na'),
    reason: (c) =>
      c.kq1
        ? L('камера откалибрована только в ⁶⁰Co, k_Q = 1 — ни TRS-398 Rev.1, ни DIN 6809-4', 'the chamber is calibrated in ⁶⁰Co only, k_Q = 1: neither TRS-398 Rev.1 nor DIN 6809-4')
        : L('Qo = ⁶⁰Co с k_Q,M рентгеновских качеств — способ DIN 6809-4, не TRS-398 Rev.1', 'Qo = ⁶⁰Co with x-ray k_Q,M is the DIN 6809-4 method, not TRS-398 Rev.1'),
  },
  {
    id: 'kvPch',
    group: 'coefficients',
    scope: 'trs',
    label: () => L('p_ch по табл. 32', 'p_ch from Table 32'),
    ref: `${TRS}, табл. 32`,
    check: kvOnly('medium', 'nk', (c) => (c.pchSource ? c.pchSource === 'table32' : null)),
    reason: () => L('p_ch введён вручную: камеры нет в табл. 32', 'p_ch entered manually: the chamber is not in Table 32'),
  },
  leakage,
  polarityCond(0.004, `${TRS}, табл. 3`, (c) =>
    L(`k_pol = ${ru(c.kpolRaw, 4)}: эффект полярности больше 0,4 % (критерий эталонного класса)`, `k_pol = ${ru(c.kpolRaw, 4)}: polarity effect above 0.4 % (reference-class criterion)`),
  ),
];

/**
 * Проверка перечня условий для выбранного протокола (scope — 'trs' | 'tg51').
 * Возвращает [{ id, group, scope, state, label, reason, ref }].
 */
export function evaluateConditions(spec, ctx, scope) {
  const out = [];
  for (const c of spec) {
    if (c.scope !== 'common' && c.scope !== scope) continue;
    let r;
    try {
      r = c.check(ctx);
    } catch {
      r = null;
    }
    const state = r === 'na' ? 'na' : r === true ? 'met' : r === false ? 'notmet' : 'unknown';
    const item = { id: c.id, group: c.group, scope: c.scope, state, label: c.label(), ref: c.ref };
    if (state === 'notmet') item.reason = c.reason(ctx);
    if (state === 'unknown') item.reason = c.unknown ? c.unknown(ctx) : c.label();
    out.push(item);
  }
  return out;
}

/**
 * Соответствие референсным условиям выбранного протокола по перечню условий.
 * standard — все проверенные условия выполнены (непроверенные перечислены в unchecked);
 * nonstandard — доза посчитана, но есть отступления (reasons); invalid — итог не вычислен.
 */
export function complianceFromConditions(conditions, hasResult) {
  if (!hasResult) return { status: 'invalid', reasons: [], unchecked: [], conditions };
  const reasons = conditions.filter((c) => c.state === 'notmet').map((c) => ({ text: c.reason, ref: c.ref }));
  const unchecked = conditions.filter((c) => c.state === 'unknown').map((c) => ({ text: c.reason, ref: c.ref }));
  return { status: reasons.length ? 'nonstandard' : 'standard', reasons, unchecked, conditions };
}
