// Справочное сравнение kV-рентгена с другими протоколами (шаг 4 плана модуля). На итог TRS-398 Rev.1 не влияет.
//   Ветки N_K — AAPM TG-61 (Ma и др. 2001):
//     низкие энергии — метод в воздухе, ур. (3): D = M · N_K · B_w · P_stem,air · [μen/ρ]w,air(воздух);
//     средние энергии — метод в фантоме на 2 см, ур. (4): D = M · N_K · P_Q,cham · P_sheath · [μen/ρ]w,air(вода).
//   Ветки N_D,w — DIN 6809-4:2020 и SSRMP No 9 (2023): D = M · N_D,w,Q, поправка на поле и РИП принята равной 1.
// Показание M и N_Q те же, что в расчёте по Rev.1 (те же поправки и интерполяция сертификата), поэтому отношение доз
// показывает только разницу данных и формализма. Результат — отношение D(протокол)/D(Rev.1) и пары множителей.

import { parseNumber, isBlank, ru, dec } from './units.js';
import { L } from './i18n.js';
import { tg61MuenAir, tg61Bw, tg61MuenWater, tg61PQcham, tg61Psheath } from './kv-tg61.js';

const TG61 = 'AAPM TG-61';
const DIN = 'DIN 6809-4:2020';
const SSRMP = 'SSRMP No 9';

/** Материалы водозащитного чехла из табл. IX TG-61. */
export const TG61_SLEEVES = {
  none: { ru: 'без чехла', en: 'no sleeve' },
  pmma: { ru: 'ПММА', en: 'PMMA' },
  polystyrene: { ru: 'полистирол', en: 'polystyrene' },
  nylon: { ru: 'нейлон', en: 'nylon' },
};

const rangeText = (r, unit) => `${dec(r[0])}–${dec(r[1])}${unit ? ` ${unit}` : ''}`;

/**
 * Строка сравнения для текущей ветки.
 * @param {object} f — нормализованная форма
 * @param {object} s — состояние расчёта Rev.1: { range, cal, qo, kv, hvl, ssd, fClin, chamber, phys, kg }
 * @returns {{kind, short, title, ref, available, reason?, ratio, diffPct, rows, notes, flags}}
 */
export function compareKv(f, s) {
  const { range, cal } = s;
  const notes = [];
  const flags = [];
  const out = (kind, short, title, ref) => ({ kind, short, title, ref, available: false, ratio: NaN, diffPct: NaN, rows: [], notes, flags });

  if (cal === 'nk' && range === 'low') return tg61Air(f, s, out('tg61-air', 'TG-61', L('TG-61, метод в воздухе', 'TG-61, in-air method'), `${TG61}, ур. (3), табл. IV, V`));
  if (cal === 'nk') return tg61Phantom(f, s, out('tg61-phantom', 'TG-61', L('TG-61, метод в фантоме на 2 см', 'TG-61, in-phantom method at 2 cm'), `${TG61}, ур. (4), табл. VII–IX`));
  if (s.qo === 'co60') return dinSsrmp(s, out('din', 'DIN 6809-4', L('DIN 6809-4, k_g = 1', 'DIN 6809-4, k_g = 1'), `${DIN}, разд. 6.4`));
  return dinSsrmp(s, out('din', 'DIN / SSRMP', L('DIN 6809-4 и SSRMP No 9, k_g = 1', 'DIN 6809-4 and SSRMP No 9, k_g = 1'), `${DIN}, разд. 6.3, 6.4; ${SSRMP}, разд. 5.3.5`));
}

const finish = (r, ratio) => {
  r.ratio = ratio;
  r.diffPct = (ratio - 1) * 100;
  r.available = Number.isFinite(ratio) && ratio > 0;
  return r;
};

/** Низкие энергии, N_K: TG-61 ур. (3) против Rev.1 ур. (50)–(51). */
function tg61Air(f, s, r) {
  const { kv, hvl, ssd, fClin, phys } = s;
  if (!(Number.isFinite(phys.muen) && Number.isFinite(phys.bw))) {
    r.reason = L('множители Rev.1 не определены — сравнивать не с чем', 'the Rev.1 factors are not determined, so there is nothing to compare');
    return r;
  }
  const mu = tg61MuenAir(hvl);
  const bw = tg61Bw(hvl, ssd, fClin);
  if (!Number.isFinite(mu.value)) {
    r.reason = L(`СПО ${ru(hvl, 3)} мм Al вне табл. IV TG-61 (${rangeText(mu.range, 'мм Al')})`, `HVL ${ru(hvl, 3)} mm Al is outside TG-61 Table IV (${rangeText(mu.range, 'mm Al')})`);
    return r;
  }
  if (!Number.isFinite(bw.value)) {
    r.reason = {
      hvl: L(`СПО ${ru(hvl, 3)} мм Al вне табл. V TG-61 (${rangeText(bw.range, 'мм Al')})`, `HVL ${ru(hvl, 3)} mm Al is outside TG-61 Table V (${rangeText(bw.range, 'mm Al')})`),
      ssd: L(`РИП ${ru(ssd, 1)} см вне табл. V TG-61 (${rangeText(bw.range, 'см')})`, `SSD ${ru(ssd, 1)} cm is outside TG-61 Table V (${rangeText(bw.range, 'cm')})`),
      d: L(`диаметр поля ${ru(fClin, 2)} см вне табл. V TG-61 (${rangeText(bw.range, 'см')})`, `field diameter ${ru(fClin, 2)} cm is outside TG-61 Table V (${rangeText(bw.range, 'cm')})`),
      'hvl-short-ssd': L(`при РИП меньше 10 см табл. V TG-61 доходит только до 4 мм Al, а СПО пучка ${ru(hvl, 3)} мм Al`, `at SSDs below 10 cm TG-61 Table V only goes up to 4 mm Al, and the beam HVL is ${ru(hvl, 3)} mm Al`),
    }[bw.out];
    return r;
  }
  const pstem = Number.isFinite(phys.nkFs) ? phys.nkFs : 1;
  r.rows = [
    { label: L('Отношение коэффициентов поглощения энергии', 'Mass energy-absorption coefficient ratio'), sym: '[μen/ρ]w,air', cmp: mu.value, cmpSrc: L('табл. IV, по СПО', 'Table IV, by HVL'), rev1: phys.muen, rev1Src: L('Andreo, FIA', 'Andreo, FIA') },
    { label: L('Обратное рассеяние', 'Backscatter'), sym: 'B_w', cmp: bw.value, cmpSrc: L('табл. V (Grosswendt), по СПО, полю и РИП', 'Table V (Grosswendt), by HVL, field and SSD'), rev1: phys.bw, rev1Src: L('Andreo, по кВ, СПО, полю и РИП', 'Andreo, by kV, HVL, field and SSD') },
    { label: L('Поправка N_K на поле', 'N_K field correction'), sym: 'P_stem,air', cmp: pstem, cmpSrc: L('та же, что в Rev.1', 'the same as in Rev.1'), rev1: pstem, rev1Src: L('рис. 11 или лаборатория; пусто — 1', 'Fig. 11 or the laboratory; empty means 1') },
  ];
  r.notes.push(L(
    'P_stem,air TG-61 и поправка N_K на поле в Rev.1 учитывают одно и то же — рассеяние от корпуса камеры при поле, отличном от лабораторного; в сравнении взято одно значение.',
    'TG-61 P_stem,air and the Rev.1 N_K field correction account for the same effect, scatter from the chamber body in a field different from the laboratory one; the comparison uses one value.',
  ));
  if (kv < 40) r.notes.push(L(`TG-61 рассчитан на 40–300 кВ: при ${ru(kv, 0)} кВ сравнение выходит за его рамки.`, `TG-61 covers 40–300 kV: at ${ru(kv, 0)} kV the comparison is outside its scope.`));
  if (f.kv_cone_shape === 'square') r.notes.push(L('Квадратное поле и в TG-61 заменено кругом равной площади.', 'The square field is replaced by a circle of equal area for TG-61 as well.'));
  return finish(r, (mu.value / phys.muen) * (bw.value / phys.bw));
}

/** Средние энергии, N_K: TG-61 ур. (4) против Rev.1 ур. (57). */
function tg61Phantom(f, s, r) {
  const { kv, hvl, ssd, fClin, chamber, phys } = s;
  if (!(Number.isFinite(phys.muen) && Number.isFinite(phys.pch))) {
    r.reason = L('множители Rev.1 не определены — сравнивать не с чем', 'the Rev.1 factors are not determined, so there is nothing to compare');
    return r;
  }
  const mu = tg61MuenWater(hvl);
  if (!Number.isFinite(mu.value)) {
    r.reason = L(`СПО ${ru(hvl, 3)} мм Cu вне табл. VII TG-61 (${rangeText(mu.range, 'мм Cu')})`, `HVL ${ru(hvl, 3)} mm Cu is outside TG-61 Table VII (${rangeText(mu.range, 'mm Cu')})`);
    return r;
  }
  // P_Q,cham: табл. VIII или значение пользователя
  let pq = tg61PQcham(chamber?.custom ? '' : chamber?.id, hvl);
  let pqSrc = L(`табл. VIII (${pq.column ?? ''}), по СПО`, `Table VIII (${pq.column ?? ''}), by HVL`);
  if (pq.out === 'hvl') {
    r.reason = L(`СПО ${ru(hvl, 3)} мм Cu вне табл. VIII TG-61 (${rangeText(pq.range, 'мм Cu')})`, `HVL ${ru(hvl, 3)} mm Cu is outside TG-61 Table VIII (${rangeText(pq.range, 'mm Cu')})`);
    return r;
  }
  if (pq.out === 'chamber') {
    const v = parseNumber(f.kv_tg61_pq);
    if (isBlank(f.kv_tg61_pq)) {
      r.reason = L(
        `${chamber?.custom ? 'своей камеры' : `камеры ${chamber?.label ?? ''}`} нет в табл. VIII TG-61: чтобы получить сравнение, введите P_Q,cham из литературы`,
        `${chamber?.custom ? 'the custom chamber' : chamber?.label ?? 'the chamber'} is not in TG-61 Table VIII: to get the comparison, enter P_Q,cham from the literature`,
      );
      return r;
    }
    if (!(v >= 0.95 && v <= 1.05)) {
      r.reason = L('P_Q,cham для TG-61 должен быть числом от 0,95 до 1,05', 'P_Q,cham for TG-61 must be a number from 0.95 to 1.05');
      r.flags.push('kv_tg61_pq');
      return r;
    }
    pq = { value: v };
    pqSrc = L('введён вручную', 'entered manually');
  }
  // P_sheath: табл. IX
  const mat = TG61_SLEEVES[f.kv_tg61_sleeve] ? f.kv_tg61_sleeve : 'none';
  const t = parseNumber(f.kv_tg61_sleeve_t);
  const ps = tg61Psheath(mat, t, hvl);
  if (!Number.isFinite(ps.value)) {
    r.reason = ps.out === 't'
      ? L('толщина чехла для табл. IX TG-61 — от 0,5 до 3 мм', 'the sleeve thickness for TG-61 Table IX is 0.5 to 3 mm')
      : L(`СПО ${ru(hvl, 3)} мм Cu вне табл. IX TG-61 (${rangeText(ps.range ?? [0.1, 5], 'мм Cu')})`, `HVL ${ru(hvl, 3)} mm Cu is outside TG-61 Table IX (${rangeText(ps.range ?? [0.1, 5], 'mm Cu')})`);
    if (ps.out === 't') r.flags.push('kv_tg61_sleeve_t');
    return r;
  }
  const sleeve = TG61_SLEEVES[mat];
  r.rows = [
    { label: L('Отношение коэффициентов поглощения энергии на 2 см', 'Mass energy-absorption coefficient ratio at 2 cm'), sym: '[μen/ρ]w,air', cmp: mu.value, cmpSrc: L('табл. VII, по СПО; поле 10×10 см², РИП 50 см', 'Table VII, by HVL; 10×10 cm² field, 50 cm SSD'), rev1: phys.muen, rev1Src: L('Andreo, по кВ, СПО, полю и РИП', 'Andreo, by kV, HVL, field and SSD') },
    { label: L('Камера в фантоме', 'Chamber in phantom'), sym: 'P_Q,cham / p_ch', cmp: pq.value, cmpSrc: pqSrc, rev1: phys.pch, rev1Src: phys.pchSource === 'table32' ? L('табл. 32, по ln(СПО)', 'Table 32, by ln(HVL)') : L('введён вручную', 'entered manually') },
    { label: L('Водозащитный чехол', 'Waterproofing sleeve'), sym: 'P_sheath', cmp: ps.value, cmpSrc: mat === 'none' ? L('без чехла', 'no sleeve') : L(`табл. IX, ${sleeve.ru} ${ru(t, 1)} мм`, `Table IX, ${sleeve.en} ${dec(t)} mm`), rev1: NaN, rev1Src: L('в Rev.1 отдельного множителя нет', 'no separate factor in Rev.1') },
  ];
  if (kv < 100) r.notes.push(L(`Метод TG-61 в фантоме — для 100–300 кВ; при ${ru(kv, 0)} кВ TG-61 предписывает воздушный метод.`, `The TG-61 in-phantom method is for 100–300 kV; at ${ru(kv, 0)} kV TG-61 prescribes the in-air method.`));
  const d10 = 20 / Math.sqrt(Math.PI); // круг той же площади, что 10×10 см²
  if (Number.isFinite(fClin) && Math.abs(fClin / d10 - 1) > 0.25) {
    r.notes.push(L(
      `Табл. VII и VIII TG-61 даны для поля 10×10 см² (круг Ø ${ru(d10, 1)} см); поправки на поле по рис. 3 и 4 TG-61 в сравнение не входят, а данные Andreo в Rev.1 учитывают поле Ø ${ru(fClin, 1)} см.`,
      `TG-61 Tables VII and VIII are for a 10×10 cm² field (a ${dec(d10.toFixed(1))} cm circle); the field corrections of TG-61 Figs 3 and 4 are not included, while the Andreo data in Rev.1 account for the ${dec(fClin.toFixed(1))} cm field.`,
    ));
  }
  if (Number.isFinite(ssd) && Math.abs(ssd - 50) > 1e-6) r.notes.push(L(`Табл. VII TG-61 — для РИП 50 см, данные Andreo — для РИП ${ru(ssd, 0)} см.`, `TG-61 Table VII is for a 50 cm SSD, the Andreo data for ${dec(ssd)} cm.`));
  return finish(r, (mu.value / phys.muen) * ((pq.value * ps.value) / phys.pch));
}

/** Ветки N_D,w: DIN 6809-4 и SSRMP No 9 берут поправку на поле и РИП равной 1. */
function dinSsrmp(s, r) {
  const { range, qo, ssd, fClin, kg } = s;
  if (!Number.isFinite(kg.value)) {
    r.reason = L('k_g по Rev.1 не определён — сравнивать не с чем', 'k_g per Rev.1 is not determined, so there is nothing to compare');
    return r;
  }
  r.rows = [
    { label: L('Поле и РИП', 'Field and SSD'), sym: 'k_g', cmp: 1, cmpSrc: range === 'low' ? L('DIN: k_g = 1; SSRMP: k_FS/SSD = 1', 'DIN: k_g = 1; SSRMP: k_FS/SSD = 1') : L('DIN: k_F = 1; SSRMP: k_FS/SSD = 1', 'DIN: k_F = 1; SSRMP: k_FS/SSD = 1'), rev1: kg.value, rev1Src: kgSourceName(kg.source) },
  ];
  if (kg.source === 'same') r.notes.push(L('Поле и РИП как в лаборатории: k_g = 1 и в Rev.1, результаты совпадают.', 'The field and SSD are as at the laboratory: k_g = 1 in Rev.1 too, and the results agree.'));
  else if (kg.source === 'one') r.notes.push(L('В расчёте уже принят k_g = 1 — подход DIN и SSRMP, поэтому строка совпадает с итогом.', 'The calculation already uses k_g = 1, the DIN and SSRMP approach, so this line equals the result.'));
  if (range === 'low') {
    r.notes.push(L('DIN 6809-4 и SSRMP No 9 берут поправку на поле и РИП равной 1 с неопределённостью 2 %.', 'DIN 6809-4 and SSRMP No 9 take the field and SSD correction as 1 with a 2 % uncertainty.'));
    if ((Number.isFinite(fClin) && fClin > 5 + 1e-6) || (Number.isFinite(ssd) && ssd > 30 + 1e-6)) {
      r.notes.push(L(
        'SSRMP допускает k_FS/SSD = 1 только при поле 2–5 см и РИП до 30 см; для бо́льших полей и РИП он рекомендует переходить от опорного поля через факторы выхода.',
        'SSRMP allows k_FS/SSD = 1 only for 2–5 cm fields and SSDs up to 30 cm; for larger fields and SSDs it recommends going from the reference field via output factors.',
      ));
    }
  } else if (qo === 'co60') {
    r.notes.push(L('При Qo = ⁶⁰Co расчёт идёт по DIN 6809-4 (k_z = 1); строка отличается от итога только k_g: DIN берёт k_F = 1 с неопределённостью 1,3 %.', 'With Qo = ⁶⁰Co the calculation follows DIN 6809-4 (k_z = 1); this line differs from the result only by k_g: DIN takes k_F = 1 with a 1.3 % uncertainty.'));
  } else {
    r.notes.push(L('DIN 6809-4 берёт k_F = 1 с неопределённостью 1,3 %, SSRMP No 9 — k_FS/SSD = 1 с неопределённостью 0,5 % при поле, близком к 10 см.', 'DIN 6809-4 takes k_F = 1 with a 1.3 % uncertainty, SSRMP No 9 takes k_FS/SSD = 1 with a 0.5 % uncertainty for fields close to 10 cm.'));
  }
  return finish(r, 1 / kg.value);
}

function kgSourceName(src) {
  return {
    same: L('поле и РИП как в лаборатории', 'field and SSD as at the laboratory'),
    lab: L('значение лаборатории', 'laboratory value'),
    one: L('k_g = 1 (не по Rev.1)', 'k_g = 1 (not Rev.1)'),
    eq90: L('ур. (90), данные Andreo', 'Eq. (90), Andreo data'),
    eq85: L('ур. (85)', 'Eq. (85)'),
    table: L('табл. 28–29', 'Tables 28–29'),
  }[src] ?? '';
}
