// Брахитерапия: бюджет неопределённости силы источника (ОМВК) — по колодезной камере (IAEA TRS-492, разд. 9,
// табл. 10, этап 4 — измерение в больнице) и по фантому PTW 9193 (Ubrich et al. 2014, разд. 4 и подпись к табл. 5).
// Все значения — относительные стандартные неопределённости, % (k = 1); составляющие некоррелированы и
// складываются в квадратуре; расширенная U = 2·u_c. Значения таблиц — примеры: TRS-492 требует оценки по своей
// процедуре и оборудованию, поэтому каждую строку можно заменить своим значением.

import { L } from './i18n.js';
import { parseNumber, isBlank, ru } from './units.js';
import { quad, parseOverrides, COVERAGE_K } from './uncertainty.js';

const T492 = 'IAEA TRS-492 (2023)';
const UBR = 'Ubrich et al. 2014, Z. Med. Phys. 24 138–52';

/**
 * Колодезная камера: TRS-492, табл. 10 (HDR ¹⁹²Ir), сценарии 1 и 2. Строка cal — этапы 1–3 (калибровка камеры в
 * лаборатории) одной строкой: её заменяет неопределённость N из сертификата камеры (U/2).
 */
export const WELL_UNC_ROWS = [
  { key: 'cal', def: [0.7, 1.9], ref: `${T492}, табл. 10, этапы 1–3` },
  { key: 'stab', def: [0.1, 0.2], ref: `${T492}, табл. 10, этап 4` },
  { key: 'current', def: [0.1, 0.3], ref: `${T492}, табл. 10, этап 4` },
  { key: 'setup', def: [0.2, 0.3], ref: `${T492}, табл. 10, этап 4` },
  { key: 'ks', def: [0.1, 0.2], ref: `${T492}, табл. 10, этап 4` },
  { key: 'tp', def: [0.2, 0.5], ref: `${T492}, табл. 10, этап 4` },
  { key: 'hum', def: [0.2, 0.3], ref: `${T492}, табл. 10, этап 4` },
  { key: 'ksm', def: [0, 2], ref: `${T492}, табл. 10, этап 4; разд. 9` },
];

/** Расширенные (k = 2) неопределённости множителя фантома по Ubrich 2014 (подпись к табл. 5, разд. 4), %. */
export const PHANTOM_FACTOR_U = { mc: 0.9, ptb: 2.7, dgmp: 5.8 };
/** N_D,w камеры PTW (k = 2) и показание в фантоме M_PMMA (k = 2), % — Ubrich 2014, табл. 2 и разд. 4. */
export const PHANTOM_N_U = 1.1;
export const PHANTOM_M_U = 0.9;

const label = (key) => ({
  cal: L('Калибровочный коэффициент N (этапы 1–3: лаборатория)', 'Calibration coefficient N (steps 1–3: laboratory)'),
  stab: L('Долговременная стабильность камеры', 'Long term stability of the chamber'),
  current: L('Измерение тока', 'Current measurement'),
  setup: L('Установка и положение источника', 'Set-up and source positioning'),
  ks: L('Поправка на рекомбинацию k_s', 'Ion recombination correction k_s'),
  tp: L('Поправка k_TP', 'Correction k_TP'),
  hum: L('Влажность', 'Humidity'),
  ksm: L('Поправка на модель источника k_sm,sm0', 'Source model correction k_sm,sm0'),
  ndw: L('Калибровочный коэффициент камеры N_D,w (N_a)', 'Chamber calibration coefficient N_D,w (N_a)'),
  factor: L('Множитель фантома (k_zp, k_r … или k_tot)', 'Phantom factor (k_zp, k_r … or k_tot)'),
  reading: L('Показание в фантоме M (4 положения, позиционирование)', 'Phantom reading M (4 positions, positioning)'),
  ka: L('Поправка на аппликатор k_A', 'Applicator correction k_A'),
})[key];

/** Строка бюджета: своё значение (если введено) заменяет типовое. */
function makeRow(key, def, ref, how, over, prefix) {
  const own = parseNumber(over[key]);
  const hasOwn = !isBlank(over[key]) && Number.isFinite(own) && own >= 0;
  return { key, id: `${prefix}${key}`, label: label(key), def, value: hasOwn ? own : def, own: hasOwn, ref, how, missing: !hasOwn && !Number.isFinite(def) };
}

function finish(rows, messages) {
  const used = rows.filter((r) => Number.isFinite(r.value));
  const uc = quad(used.map((r) => r.value));
  const missing = rows.filter((r) => r.missing);
  if (missing.length) {
    messages.push({ level: 'warn', text: L(`Нет опубликованной неопределённости: ${missing.map((r) => r.label).join('; ')} — u_c её не включает; введите свою оценку в поле «Своё».`, `No published uncertainty: ${missing.map((r) => r.label).join('; ')}; u_c does not include it; enter your own estimate in the “Own” field.`), ref: null });
  }
  return { rows, uc, U: COVERAGE_K * uc, k: COVERAGE_K, complete: !missing.length, messages };
}

/**
 * Бюджет по колодезной камере.
 * @param {{scenario?:'1'|'2', NU?:number, ksmMode?:string, readings?:{n:number, relSd:number}, over?:string|object}} o
 *   NU — U(N) из сертификата камеры, % (k = 2); ksmMode — как на листе (same | table | none | manual).
 */
export function wellBudget(o = {}) {
  const s = o.scenario === '2' ? 1 : 0;
  const over = parseOverrides(o.over);
  const messages = [];
  const rows = WELL_UNC_ROWS.map((spec) => {
    let def = spec.def[s];
    let how = '';
    if (spec.key === 'cal' && o.NU > 0) {
      def = o.NU / COVERAGE_K;
      how = L(`Из сертификата камеры: U = ${ru(o.NU, 2)} % (k = 2) → ${ru(def, 2)} %; в табл. 10 — ${ru(spec.def[s], 1)} %.`, `From the chamber certificate: U = ${o.NU}% (k = 2) → ${def.toFixed(2)}%; Table 10 gives ${spec.def[s]}%.`);
    } else if (spec.key === 'cal') {
      how = L('Типовое по табл. 10 (этапы 1–3); точнее — U из сертификата камеры (лист, раздел 2).', 'Example per Table 10 (steps 1–3); better: U from the chamber certificate (sheet, section 2).');
    }
    if (spec.key === 'current' && o.readings?.n >= 2 && Number.isFinite(o.readings.relSd)) {
      const a = o.readings.relSd / Math.sqrt(o.readings.n);
      how = L(`Ваша серия: стандартное отклонение среднего ${ru(a, 3)} % (n = ${o.readings.n}, тип А); в расчёт идёт большее из него и типового.`, `Your series: standard deviation of the mean ${a.toFixed(3)}% (n = ${o.readings.n}, type A); the larger of it and the example is used.`);
      if (a > def) def = a;
    }
    if (spec.key === 'ksm') {
      if (o.ksmMode === 'same') {
        def = 0;
        how = L('Тот же источник, что при калибровке камеры: поправки нет.', 'Same source as at the chamber calibration: no correction.');
      } else if (o.ksmMode === 'table') {
        def = 0.2;
        how = L('k_sm,sm0 по TRS-492, табл. 8: 0,2 % (как в табл. 10, этап 2, сценарий 2).', 'k_sm,sm0 per TRS-492, Table 8: 0.2% (as in Table 10, step 2, scenario 2).');
      } else if (o.ksmMode === 'none') {
        def = 2;
        how = L('Модели нет в табл. 8: k_sm,sm0 = 1 и не меньше 2 % (наибольшая поправка табл. 8 — 1,8 %).', 'The model is not in Table 8: k_sm,sm0 = 1 and at least 2% (the largest Table 8 correction is 1.8%).');
      } else {
        how = L('Своё значение k_sm,sm0 — введите и его неопределённость.', 'Own k_sm,sm0: enter its uncertainty as well.');
      }
    }
    return makeRow(spec.key, def, spec.ref, how, over, 'bu_w_');
  });
  return finish(rows, messages);
}

/** Неопределённость множителя фантома по основному варианту (k = 1), % или NaN, и пояснение. */
function factorU(mainId, nuclide, ownWellUc) {
  if (!mainId) return { u: NaN, how: '' };
  if (mainId === 'own') return { u: ownWellUc, how: L('Свой k_tot: N_D,w сокращается, остаётся u_c колодезной камеры (бюджет листа «Колодезная камера») — показание в фантоме учтено строкой ниже.', 'Own k_tot: N_D,w cancels; the well-type chamber u_c remains (Well-type chamber sheet budget); the phantom reading is the row below.'), own: true };
  if (mainId.startsWith('ubrich-mc')) return { u: PHANTOM_FACTOR_U.mc / 2, how: L('Монте-Карло, Ubrich 2014: U = 0,9 % (k = 2).', 'Monte Carlo, Ubrich 2014: U = 0.9% (k = 2).') };
  if (mainId.startsWith('ubrich-ptb')) return { u: PHANTOM_FACTOR_U.ptb / 2, how: L('Калибровка PTB, Ubrich 2014: U = 2,7 % (k = 2).', 'PTB calibration, Ubrich 2014: U = 2.7% (k = 2).') };
  if (nuclide === 'Ir-192' && mainId.startsWith('dgmp')) return { u: PHANTOM_FACTOR_U.dgmp / 2, how: L('DGMP 13: в самом отчёте неопределённости нет; оценка Ubrich 2014 по Krieger — U = 5,8 % (k = 2).', 'DGMP 13 itself gives no uncertainty; Ubrich 2014 estimate after Krieger: U = 5.8% (k = 2).') };
  return { u: NaN, how: L('Для постоянных ⁶⁰Co по Azhari 2012 неопределённость не опубликована.', 'No uncertainty is published for the ⁶⁰Co constants per Azhari 2012.') };
}

/**
 * Бюджет по фантому PTW 9193.
 * @param {{scenario?:'1'|'2', NU?:number, mainId?:string, nuclide?:string, holes?:{corr:number}[], kA?:number,
 *   wellUc?:number, over?:string|object}} o
 */
export function phantomBudget(o = {}) {
  const s = o.scenario === '2' ? 1 : 0;
  const over = parseOverrides(o.over);
  const messages = [];
  const rows = [];
  const own = o.mainId === 'own';
  const f = factorU(o.mainId, o.nuclide, o.wellUc);
  // N_D,w своей камеры: для своего k_tot сокращается (k_tot = K_колодезная/(N·M), K = k_tot·N·M); для множителей
  // из литературы — отдельная строка (их неопределённость у Ubrich относится к самому множителю)
  const nIn = own;
  const nDef = nIn ? 0 : o.NU > 0 ? o.NU / COVERAGE_K : PHANTOM_N_U / COVERAGE_K;
  const nHow = nIn
    ? L('Сокращается: свой k_tot определён с той же камерой и тем же N.', 'Cancels: own k_tot was determined with the same chamber and N.')
    : o.NU > 0 ? L(`Из сертификата камеры: U = ${ru(o.NU, 2)} % (k = 2).`, `From the chamber certificate: U = ${o.NU}% (k = 2).`) : L('Типовое: PTW, U = 1,1 % (k = 2), Ubrich 2014, табл. 2; точнее — U из своего сертификата.', 'Example: PTW, U = 1.1% (k = 2), Ubrich 2014, Table 2; better: U from your certificate.');
  rows.push(makeRow('ndw', nDef, `${UBR}, табл. 2`, nHow, over, 'bu_p_'));
  rows.push(makeRow('factor', f.u, own ? `${T492}, разд. 9` : `${UBR}, разд. 4, табл. 5`, f.how, over, 'bu_p_'));
  let mDef = PHANTOM_M_U / COVERAGE_K;
  let mHow = L('Типовое: U = 0,9 % (k = 2), Ubrich 2014, разд. 4.', 'Example: U = 0.9% (k = 2), Ubrich 2014, Sec. 4.');
  const hs = (o.holes ?? []).map((h) => h.corr).filter(Number.isFinite);
  if (hs.length >= 2) {
    const m = hs.reduce((a, b) => a + b, 0) / hs.length;
    const sd = Math.sqrt(hs.reduce((a, x) => a + (x - m) ** 2, 0) / (hs.length - 1));
    const a = (Math.abs(sd / m) * 100) / Math.sqrt(hs.length);
    mHow += L(` Ваши ${hs.length} положения: стандартное отклонение среднего ${ru(a, 3)} %; в расчёт идёт большее.`, ` Your ${hs.length} positions: standard deviation of the mean ${a.toFixed(3)}%; the larger is used.`);
    if (a > mDef) mDef = a;
  }
  rows.push(makeRow('reading', mDef, `${UBR}, разд. 4`, mHow, over, 'bu_p_'));
  rows.push(makeRow('tp', WELL_UNC_ROWS.find((r) => r.key === 'tp').def[s], `${T492}, табл. 10, этап 4`, L('Как для колодезной камеры (табл. 10).', 'As for the well-type chamber (Table 10).'), over, 'bu_p_'));
  if (o.kA > 0 && o.kA !== 1) rows.push(makeRow('ka', NaN, 'Azhari et al. 2012, J. Med. Phys. 37 183–92', L('Azhari 2012 неопределённость k_A не приводит.', 'Azhari 2012 gives no uncertainty for k_A.'), over, 'bu_p_'));
  return finish(rows, messages);
}

export { quad };
