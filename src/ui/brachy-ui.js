// Вкладка «Брахитерапия»: листы «Колодезная камера» (IAEA TRS-492), «Максимум отклика» (TRS-492, разд. 8.2.1),
// «Фантом PTW 9193» (DIN 6809-2, DGMP-Bericht 13, руководство PTW), «Сличение камер» (TRS-492, разд. 7.7), «Стабильность»
// (разд. 8.4–8.5) и «Распад» (TRS-492, разд. 3.4, 7.3). Сертификат
// источника — общий для листов. Расчёт — core/brachy-sheets.js; черновик формы — в этом браузере.
import { L, refText } from '../core/i18n.js';
import { PRESSURE_UNITS, unitLabel, parseNumber } from '../core/units.js';
import { HALF_LIVES, KSM_SOURCES, PTW_TO_DGMP, APPLICATOR_KA_STEEL } from '../core/brachy-data.js';
import { kDec } from '../core/brachy.js';
import {
  BRACHY_DEFAULTS, normalizeBrachy, computeBrachyWell, computeBrachyPhantom, computeBrachySweet, computeBrachyDecay, computeBrachyCross, computeBrachyStability, fieldTime,
  STRENGTH_UNITS, ACTIVITY_UNITS, GAMMA_UNITS, WELL_N_UNITS, PHANTOM_N_UNITS, CURRENT_UNITS, DOSE_SOURCES,
} from '../core/brachy-sheets.js';
import { $, esc, fmt, fmtSigned, richText, armButton, downloadText, savedFileName } from './common.js';
import { scatterChart, legendSwatch } from './chart.js';
import { renderCells, readCells, setupCells } from './widgets.js';
import { cellsHtml } from './journal-common.js';
import { tipAttr } from './brachy-tips.js';
import { wellBudget, phantomBudget } from '../core/brachy-unc.js';
import { parseOverrides } from '../core/uncertainty.js';

const KEY = 'reference-dosimetry.brachy';
const SHEETS = ['well', 'sweet', 'phantom', 'cross', 'stab', 'decay'];
let sheet = 'well';
let form = normalizeBrachy({});
let statusEl = null;

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && typeof v === 'object') {
      form = normalizeBrachy(v.form);
      if (SHEETS.includes(v.sheet)) sheet = v.sheet;
    }
  } catch {
    /* хранилище недоступно */
  }
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ sheet, form }));
  } catch {
    /* хранилище недоступно */
  }
}
const status = (t) => {
  if (statusEl) statusEl.textContent = t;
};
/** Смещение пояса компьютера от UTC, мин. */
const offsetMin = () => -new Date().getTimezoneOffset();
const zoneName = (min) => `UTC${min >= 0 ? '+' : '−'}${Math.floor(Math.abs(min) / 60)}${Math.abs(min) % 60 ? `:${String(Math.abs(min) % 60).padStart(2, '0')}` : ''}`;
const sub = (s) => richText(s);

// ------------------------------------------------------------ поля
const opt = (v, t, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`;
const unitOpts = (units, cur) => Object.entries(units).map(([k, u]) => opt(k, unitLabel(u), cur)).join('');
const num = (key, label, { hint = '', ph = '', span = '' } = {}) =>
  `<div class="field${span}"><label for="br_${key}"${tipAttr(key)}>${sub(label)}</label><input type="text" class="num" inputmode="decimal" id="br_${key}" data-f="${key}" value="${esc(form[key])}"${ph ? ` placeholder="${esc(ph)}"` : ''}${hint ? ` title="${esc(hint)}"` : ''}></div>`;
const text = (key, label, { ph = '', list = '', span = '' } = {}) =>
  `<div class="field${span}"><label for="br_${key}"${tipAttr(key)}>${sub(label)}</label><input type="text" id="br_${key}" data-f="${key}" value="${esc(form[key])}"${ph ? ` placeholder="${esc(ph)}"` : ''}${list ? ` list="${list}"` : ''}></div>`;
const select = (key, label, options, { full = true, span = '' } = {}) =>
  `<div class="field${span}"><label for="br_${key}"${tipAttr(key)}>${sub(label)}</label><select id="br_${key}" data-f="${key}"${full ? ' data-full' : ''}>${options}</select></div>`;
const numUnit = (key, label, units, unitKey, { ph = '', span = '' } = {}) =>
  `<div class="field${span}"><label for="br_${key}"${tipAttr(key)}>${sub(label)}</label><div class="inline"><input type="text" class="num" inputmode="decimal" id="br_${key}" data-f="${key}" value="${esc(form[key])}"${ph ? ` placeholder="${esc(ph)}"` : ''}><select id="br_${unitKey}" data-f="${unitKey}" aria-label="${esc(L('Единица', 'Unit'))}">${typeof units === 'string' ? units : unitOpts(units, form[unitKey])}</select></div></div>`;

function zoneOpts(cur) {
  const here = zoneName(offsetMin());
  const items = [opt('', L(`как на компьютере (${here})`, `as on this computer (${here})`), cur), opt('UTC', 'UTC', cur)];
  for (let h = -12; h <= 14; h++) if (h) items.push(opt(`${h > 0 ? '+' : ''}${h}`, `UTC${h > 0 ? '+' : '−'}${Math.abs(h)}`, cur));
  items.push(opt('+5:30', 'UTC+5:30', cur));
  return items.join('');
}
/** Дата, время и часовой пояс (prefix: cert_, w_, p_). */
const when = (pre, label, timeHint) => `<div class="field"><label for="br_${pre}date">${esc(label)}</label><input type="date" id="br_${pre}date" data-f="${pre}date" value="${esc(form[`${pre}date`])}"></div>
  <div class="field"><label for="br_${pre}time">${esc(L('Время', 'Time'))}</label><input type="time" id="br_${pre}time" data-f="${pre}time" value="${esc(form[`${pre}time`])}" title="${esc(timeHint)}"></div>
  <div class="field"><label for="br_${pre}zone">${esc(L('Часовой пояс', 'Time zone'))}</label><select id="br_${pre}zone" data-f="${pre}zone">${zoneOpts(form[`${pre}zone`])}</select></div>`;

// ------------------------------------------------------------ разметка
function navHtml() {
  const items = [['well', L('Колодезная камера', 'Well-type chamber')], ['sweet', L('Максимум отклика', 'Sweet spot')], ['phantom', L('Фантом PTW 9193', 'PTW 9193 phantom')], ['cross', L('Сличение камер', 'Cross-calibration')], ['stab', L('Стабильность', 'Stability')], ['decay', L('Распад', 'Decay')]];
  return `<nav class="kv-pages" aria-label="${esc(L('Листы вкладки', 'Tab sheets'))}">${items.map(([k, t]) => `<a href="#brachy/${k}" data-goto="brachy/${k}"${k === sheet ? ' aria-current="page"' : ''}>${esc(t)}</a>`).join('')}</nav>`;
}

function introHtml() {
  if (sheet === 'sweet') {
    return `<p class="start-when">${sub(L(
      'Опорная точка колодезной камеры — положение источника с наибольшим откликом. Источник проходит ряд положений с шагом не больше 2,5 мм, не меньше 10 мм в обе стороны от ожидаемого максимума; по кривой находится максимум и плато. Положение зависит от системы отсчёта (длина ампулопровода, глубина катетера), поэтому его проверяют при каждом измерении силы источника (IAEA TRS-492, разд. 8.2.1).',
      'The reference point of a well-type chamber is the source position with the largest response. The source steps through positions at most 2.5 mm apart, at least 10 mm on both sides of the expected maximum; the curve gives the maximum and the plateau. The position depends on the reference system (transfer tube length, catheter depth), so it is checked at every source strength measurement (IAEA TRS-492, Sec. 8.2.1).',
    ))}</p>`;
  }
  if (sheet === 'cross') {
    return `<p class="start-when">${sub(L(
      'Калибровочный коэффициент рабочей колодезной камеры по эталонной (с сертификатом лаборатории): один и тот же источник того же нуклида поочерёдно в обеих камерах, в положении максимального отклика; эталонная — в своём держателе. N_field = M_ref/M_field · N_ref · k_sm,sm0 (IAEA TRS-492, разд. 7.7, ур. 18–20). Пересчёт между нуклидами (¹⁹²Ir ↔ ⁶⁰Co) не допускается.',
      'Calibration coefficient of the field well-type chamber from the reference one (with a laboratory certificate): the same source of the same nuclide in both chambers in turn, at the sweet spot; the reference chamber in its own holder. N_field = M_ref/M_field · N_ref · k_sm,sm0 (IAEA TRS-492, Sec. 7.7, Eq. 18–20). Conversion between nuclides (¹⁹²Ir ↔ ⁶⁰Co) is not permitted.',
    ))}</p>`;
  }
  if (sheet === 'stab') {
    return `<p class="start-when">${sub(L(
      'Проверка стабильности колодезной камеры: не реже четырёх раз в год, до и после каждой замены источника. Показание с поправками на T, P и распад сравнивается с исходным, допуск ±0,5 %; при второй камере — отношение показаний, ±0,1 % (IAEA TRS-492, разд. 8.4–8.5). Исходное значение задают при вводе в работу и после каждой калибровки.',
      'Well-type chamber stability check: at least four times a year and before and after each source exchange. The reading corrected for T, P and decay is compared with the baseline, tolerance ±0.5%; with a redundant chamber, the reading ratio, ±0.1% (IAEA TRS-492, Sec. 8.4–8.5). The baseline is set at commissioning and after each recalibration.',
    ))}</p>`;
  }
  if (sheet === 'decay') {
    return `<p class="start-when">${sub(L(
      'Сила источника по датам: от сертификата или от своего измерения, K̇(t) = K̇(t_0) · 2^(−Δt/T½) (IAEA TRS-492, ур. 8–9, табл. 3). Время — по выбранному поясу и в UTC (ISO 8601, разд. 3.4.2). Можно найти дату, когда сила упадёт до порога замены источника.',
      'Source strength by date, from the certificate or from your own measurement: K̇(t) = K̇(t_0) · 2^(−Δt/T½) (IAEA TRS-492, Eq. 8–9, Table 3). Times in the chosen zone and in UTC (ISO 8601, Sec. 3.4.2). You can find the date when the strength falls to the source replacement threshold.',
    ))}</p>`;
  }
  return sheet === 'well'
    ? `<p class="start-when">${sub(L(
        'Сила источника по колодезной камере (IAEA TRS-492, гл. 7–8): ОМВК K̇_δ,R и сила воздушной кермы S_K (численно S_K в U = ОМВК в мкГр/ч на 1 м). Калибровочный коэффициент — из строки сертификата камеры для своего аппарата, адаптера и нуклида. Перевод между ¹⁹²Ir и ⁶⁰Co не допускается.',
        'Source strength with a well-type chamber (IAEA TRS-492, Ch. 7–8): reference air kerma rate K̇_δ,R and air kerma strength S_K (S_K in U numerically equals the RAKR in µGy/h at 1 m). The calibration coefficient comes from the chamber certificate row for your afterloader, adapter and nuclide. Conversion between ¹⁹²Ir and ⁶⁰Co is not permitted.',
      ))}</p>`
    : `<p class="start-when">${sub(L(
        'Сила источника в цилиндрическом фантоме PTW 9193 по DIN 6809-2 / руководству PTW 9193 (DGMP-Bericht 13): камера в четырёх положениях через 90° на 8 см от источника, калибровочный коэффициент в пучке ⁶⁰Co. Для ⁶⁰Co в DGMP 13 данных нет — в таблице вариантов литературные коэффициенты и свой k_tot по сличению с колодезной камерой.',
        'Source strength in the PTW 9193 cylindrical phantom per DIN 6809-2 / the PTW 9193 manual (DGMP Report 13): the chamber at four positions 90° apart, 8 cm from the source, calibration coefficient in a ⁶⁰Co beam. DGMP 13 has no data for ⁶⁰Co: the variant table lists literature factors and your own k_tot from comparison with the well-type chamber.',
      ))}</p>`;
}

function sourceHtml() {
  const nucOpts = Object.entries(HALF_LIVES).map(([k, h]) => opt(k, h.label, form.nuclide)).join('');
  const h = HALF_LIVES[form.nuclide];
  const unitAll = `<optgroup label="${esc(L('Сила источника', 'Source strength'))}">${unitOpts(STRENGTH_UNITS, form.cert_unit)}</optgroup><optgroup label="${esc(L('Активность (нужна Γ_δ)', 'Activity (Γ_δ needed)'))}">${unitOpts(ACTIVITY_UNITS, form.cert_unit)}</optgroup>`;
  return `<section class="start-card plates-card"><h2><span class="step-no">1</span> ${esc(L('Источник и его сертификат', 'Source and its certificate'))}</h2>
    <div class="grid">
      ${select('nuclide', L('Радионуклид', 'Radionuclide'), nucOpts)}
      ${num('half', L('Свой t½, сут', 'Own t½, days'), { ph: h ? String(+h.days.toFixed(3)).replace('.', L(',', '.')) : '', hint: L('Пусто — TRS-492, табл. 3', 'Blank: TRS-492, Table 3') })}
      ${text('src_name', L('Модель и номер источника', 'Source model and number'), { span: ' span-2' })}
      ${numUnit('cert_value', L('Значение в сертификате', 'Certificate value'), unitAll, 'cert_unit', { span: ' span-2' })}
      ${numUnit('cert_gamma', L('Γ_δ из сертификата', 'Γ_δ from the certificate'), GAMMA_UNITS, 'cert_gamma_unit', { span: ' span-2' })}
      ${num('cert_U', L('Неопределённость сертификата, %', 'Certificate uncertainty, %'))}
      ${when('cert_', L('Дата сертификата', 'Certificate date'), L('Пусто — 00:00 (как в таблице распада производителя)', "Blank: 00:00 (as in the manufacturer's decay table)"))}
    </div>
    <p class="sub-hint" id="br-cert-live"></p></section>`;
}

function wellChamberHtml() {
  const smOpts = (cur) => opt('', '—', cur) + KSM_SOURCES.map((s) => opt(s.id, s.name, cur)).join('');
  const modes = [['none', L('другая модель, данных нет (1 и +2 %)', 'another model, no data (1 and +2%)')], ['same', L('тот же источник, что при калибровке', 'same source as at calibration')], ['table', L('TRS-492, табл. 8 (SI HDR 1000 Plus + 70010)', 'TRS-492, Table 8 (SI HDR 1000 Plus + 70010)')], ['manual', L('ввести вручную', 'enter manually')]];
  const m = form.w_ksm_mode;
  return `<section class="start-card plates-card"><h2><span class="step-no">2</span> ${esc(L('Колодезная камера и её сертификат', 'Well-type chamber and its certificate'))}</h2>
    <div class="grid">
      ${text('w_model', L('Камера', 'Chamber'), { ph: 'PTW TM33004' })}
      ${text('w_serial', L('Заводской номер', 'Serial number'))}
      ${numUnit('w_N', L('Калибровочный коэффициент N', 'Calibration coefficient N'), WELL_N_UNITS, 'w_N_unit', { span: ' span-2' })}
      ${num('w_NU', L('U(N), k = 2, %', 'U(N), k = 2, %'))}
      ${num('w_NAA', L('N_AA, Бк/А (если есть)', 'N_AA, Bq/A (if given)'), { hint: L('Кажущаяся активность по току — только справочно', 'Apparent activity from the current, for reference only') })}
      ${num('w_T0', L('T0 из сертификата, °C', 'T0 from the certificate, °C'))}
      ${numUnit('w_P0', L('P0 из сертификата', 'P0 from the certificate'), PRESSURE_UNITS, 'w_P0_unit')}
      ${num('w_kelec', L('k_elec', 'k_elec'), { hint: L('1 — если камера и электрометр калиброваны вместе', '1 if the chamber and electrometer are calibrated together') })}
      ${select('w_ksm_mode', L('Модель источника и k_sm,sm0', 'Source model and k_sm,sm0'), modes.map(([k, t]) => opt(k, t, m)).join(''), { span: ' span-2' })}
      ${m === 'table' ? `${select('w_sm', L('Источник (sm)', 'Source (sm)'), smOpts(form.w_sm))}${select('w_sm0', L('Источник калибровки (sm0)', 'Calibration source (sm0)'), smOpts(form.w_sm0))}` : ''}
      ${m === 'manual' ? num('w_ksm', L('k_sm,sm0', 'k_sm,sm0')) : ''}
    </div></section>`;
}

function wellMeasureHtml() {
  return `<section class="start-card plates-card"><h2><span class="step-no">3</span> ${esc(L('Измерение в точке максимального отклика', 'Measurement at the sweet spot'))}</h2>
    <div class="grid">
      ${when('w_', L('Дата измерения', 'Measurement date'), L('Время измерения', 'Measurement time'))}
      ${num('w_T', L('Температура, °C', 'Temperature, °C'))}
      ${numUnit('w_P', L('Давление', 'Pressure'), PRESSURE_UNITS, 'w_P_unit')}
      ${select('w_unit', L('Единица тока', 'Current unit'), unitOpts(CURRENT_UNITS, form.w_unit))}
      ${num('w_pos', L('Положение источника, мм', 'Source position, mm'), { hint: L('Лист «Максимум отклика» проверяет, что это максимум', 'The Sweet spot sheet checks that this is the maximum') })}
    </div>
    <div class="series">${cellsHtml('w_I', L('Ток', 'Current'), form.w_I, unitLabel(CURRENT_UNITS[form.w_unit]))}</div>
    <div class="grid">
      ${num('w_leak', L('Ток утечки (без источника)', 'Leakage current (no source)'))}
      ${num('w_pol_plus', L('k_pol: показание при рабочей полярности', 'k_pol: reading at the routine polarity'))}
      ${num('w_pol_minus', L('k_pol: при противоположной', 'k_pol: at the opposite polarity'))}
      ${num('w_ks_m1', L('k_s: показание при V1', 'k_s: reading at V1'))}
      ${num('w_ks_m2', L('k_s: при V2', 'k_s: at V2'))}
      ${num('w_ks_v1', L('V1, В', 'V1, V'))}
      ${num('w_ks_v2', L('V2, В', 'V2, V'))}
    </div>
    <p class="sub-hint">${sub(L('k_pol и k_s — по желанию: калибруют обычно при одной полярности, рекомбинация HDR обычно меньше 0,1 % (TRS-492, разд. 8.2.3.6–8.2.3.7). Пустые поля — поправка равна 1.', 'k_pol and k_s are optional: calibration is usually at one polarity, HDR recombination is usually below 0.1% (TRS-492, Sec. 8.2.3.6–8.2.3.7). Blank fields: the correction is 1.'))}</p></section>`;
}

function phantomChamberHtml() {
  const models = [...Object.keys(PTW_TO_DGMP).map((k) => (k.length > 5 ? `PTW ${k}` : `PTW ${k}`)), 'IBA FC65-G'];
  const calibs = [['Nw', L('N_w — поглощённая доза в воде', 'N_w: absorbed dose to water')], ['Na', L('N_a — воздушная керма', 'N_a: air kerma')], ['Ns', L('N_s — экспозиционная доза', 'N_s: exposure')]];
  const kaOpts = [['none', L('нет (1)', 'none (1)')], ['steel', L(`стальной аппликатор: ${fmt(APPLICATOR_KA_STEEL[form.nuclide] ?? NaN, 4)} (Azhari)`, `steel applicator: ${fmt(APPLICATOR_KA_STEEL[form.nuclide] ?? NaN, 4)} (Azhari)`)], ['manual', L('ввести', 'enter')]];
  return `<section class="start-card plates-card"><h2><span class="step-no">2</span> ${esc(L('Камера в фантоме', 'Chamber in the phantom'))}</h2>
    <datalist id="br-models">${models.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    <div class="grid">
      ${text('p_model', L('Камера', 'Chamber'), { ph: 'PTW 30013', list: 'br-models' })}
      ${text('p_serial', L('Заводской номер', 'Serial number'))}
      ${select('p_calib', L('Калибровка в ⁶⁰Co', 'Calibration in ⁶⁰Co'), calibs.map(([k, t]) => opt(k, t, form.p_calib)).join(''), { span: ' span-2' })}
      ${numUnit('p_N', L('Калибровочный коэффициент', 'Calibration coefficient'), PHANTOM_N_UNITS, 'p_N_unit', { span: ' span-2' })}
      ${num('p_NU', L('U(N), k = 2, %', 'U(N), k = 2, %'))}
      ${num('p_T0', L('T0 из сертификата, °C', 'T0 from the certificate, °C'))}
      ${numUnit('p_P0', L('P0 из сертификата', 'P0 from the certificate'), PRESSURE_UNITS, 'p_P0_unit')}
      ${num('p_kQ', L('k_Q (¹⁹²Ir к ⁶⁰Co)', 'k_Q (¹⁹²Ir to ⁶⁰Co)'), { hint: L('Для современных компактных камер — 1 (руководство PTW, табл. 1)', 'For modern compact chambers: 1 (PTW manual, Table 1)') })}
      ${num('p_kelec', L('k_elec', 'k_elec'))}
      ${num('p_kzp', L('Свой k_zp (пусто — по камере)', 'Own k_zp (blank: by chamber)'))}
      ${select('p_ka', L('k_A аппликатора', 'Applicator k_A'), kaOpts.map(([k, t]) => opt(k, t, form.p_ka)).join(''))}
      ${form.p_ka === 'manual' ? num('p_ka_value', L('k_A', 'k_A')) : ''}
    </div>
    <p class="sub-hint">${sub(L('k_zp = 1,187 для камеры M23332 (DGMP 13, ур. 13); для другой камеры — ×k_V/1,0037 по DGMP 13, табл. 2.1 (PTW 30013, 30010 → M30001; 30015 → M23331; 30016 → M23332; 31010 → M233642). k_A нужен, если показание сравнивают с сертификатом источника, а измеряли в стальном аппликаторе.', 'k_zp = 1.187 for the M23332 chamber (DGMP 13, Eq. 13); for another chamber ×k_V/1.0037 per DGMP 13, Table 2.1 (PTW 30013, 30010 → M30001; 30015 → M23331; 30016 → M23332; 31010 → M233642). k_A is needed when the reading is compared with the source certificate but measured in a steel applicator.'))}</p></section>`;
}

function phantomMeasureHtml() {
  const angle = ['0°', '90°', '180°', '270°'];
  const holes = form.p_holes
    .map((h, i) => `<div class="grid br-hole">
        <div class="field"><label for="br_h${i}_T">${esc(L(`Положение ${i + 1} (${angle[i]}): T, °C`, `Position ${i + 1} (${angle[i]}): T, °C`))}</label><input type="text" class="num" inputmode="decimal" id="br_h${i}_T" data-hole="${i}" data-hf="T" value="${esc(h.T)}"${i ? ` placeholder="${esc(L('как выше', 'as above'))}"` : ''}></div>
        <div class="field"><label for="br_h${i}_P">${esc(L('P', 'P'))}</label><input type="text" class="num" inputmode="decimal" id="br_h${i}_P" data-hole="${i}" data-hf="P" value="${esc(h.P)}"${i ? ` placeholder="${esc(L('как выше', 'as above'))}"` : ''}></div>
      </div>
      <div class="series">${cellsHtml(`p_hole${i}`, L(`Заряды в положении ${i + 1}`, `Charges at position ${i + 1}`), h.M)}</div>`)
    .join('');
  return `<section class="start-card plates-card"><h2><span class="step-no">3</span> ${esc(L('Измерение в фантоме', 'Measurement in the phantom'))}</h2>
    <div class="grid">
      ${when('p_', L('Дата измерения', 'Measurement date'), L('Время измерения', 'Measurement time'))}
      ${num('p_tau', L('Время облучения в положении, мин', 'Irradiation time per position, min'))}
      ${select('p_P_unit', L('Единица давления', 'Pressure unit'), unitOpts(PRESSURE_UNITS, form.p_P_unit), { full: false })}
      ${num('p_transit', L('Заряд за перемещение источника, нКл', 'Transit charge, nC'), { hint: L('Вычитается из среднего в каждом положении', 'Subtracted from the mean at each position') })}
    </div>
    ${holes}
    <h3>${sub(L('k_pol и k_s (по желанию)', 'k_pol and k_s (optional)'))}</h3>
    <div class="grid">${num('p_v1', L('V1, В', 'V1, V'))}${num('p_v2', L('V2, В', 'V2, V'))}</div>
    <div class="series">${cellsHtml('p_pol_plus', L('При +V1', 'At +V1'), form.p_pol_plus)}</div>
    <div class="series">${cellsHtml('p_pol_minus', L('При −V1', 'At −V1'), form.p_pol_minus)}</div>
    <div class="series">${cellsHtml('p_ks_v2', L('При +V2', 'At +V2'), form.p_ks_v2)}</div>
    <p class="sub-hint">${sub(L('k_pol = (|M+| + |M−|)/(2|M+|); k_s = 3/(4 − M1/M2) при V2 = V1/2 (TRS-492, ур. 32–33).', 'k_pol = (|M+| + |M−|)/(2|M+|); k_s = 3/(4 − M1/M2) for V2 = V1/2 (TRS-492, Eq. 32–33).'))}</p></section>`;
}

function doseHtml() {
  const srcs = DOSE_SOURCES.filter((x) => x.nuclide === form.nuclide);
  const options = [opt('', L('не выбрана', 'not chosen'), form.p_src), ...srcs.map((x) => opt(x.id, x.name, form.p_src)), opt('other', L('другая — ввести Λ, L, g_L(8 см)', 'other: enter Λ, L, g_L(8 cm)'), form.p_src)].join('');
  const manual = form.p_src === 'other'
    ? `${num('p_lambda', L('Λ, сГр·ч⁻¹·Ед⁻¹', 'Λ, cGy·h⁻¹·U⁻¹'))}${num('p_L', L('Активная длина L, см (пусто — точечный)', 'Active length L, cm (blank: point source)'))}${num('p_gL8', L('g_L(8 см)', 'g_L(8 cm)'))}`
    : '';
  return `<section class="start-card plates-card"><h2><span class="step-no">5</span> ${esc(L('Поглощённая доза в воде', 'Absorbed dose to water'))}</h2>
    <div class="grid">${select('p_src', L('Модель источника (Λ и g_L по HEBD)', 'Source model (Λ and g_L per HEBD)'), options, { span: ' span-2' })}${manual}</div>
    <div id="br-dose" aria-live="polite"></div>
    <p class="sub-hint">${sub(L('В точке измерения Ḋ_w = N_D,w · Ṁ — в ПММА фантома (руководство PTW 9193, ур. 15). Ḋ_w,1 — референсная мощность дозы в воде на 1 см: (k_tot)Ḋw,1 · N_D,w · Ṁ (Ubrich 2014, ур. 6, табл. 7) или Λ · S_K (TG-43U1, ур. 1). На 8 см в воде, на поперечной оси: Ḋ_w,1 · G_L(8)/G_L(1) · g_L(8) (TG-43U1, ур. 1, 4) — это не то же, что доза в точке измерения в фантоме.', 'At the measurement point Ḋ_w = N_D,w · Ṁ, in the PMMA phantom (PTW 9193 manual, Eq. 15). Ḋ_w,1 is the reference dose rate to water at 1 cm: (k_tot)Ḋw,1 · N_D,w · Ṁ (Ubrich 2014, Eq. 6, Table 7) or Λ · S_K (TG-43U1, Eq. 1). At 8 cm in water on the transverse axis: Ḋ_w,1 · G_L(8)/G_L(1) · g_L(8) (TG-43U1, Eq. 1, 4); this is not the same as the dose at the measurement point in the phantom.'))}</p></section>`;
}

function ownKtotHtml() {
  return `<section class="start-card plates-card"><h2><span class="step-no">6</span> ${sub(L('Свой k_tot по колодезной камере', 'Own k_tot from the well-type chamber'))}</h2>
    <div class="grid">
      ${num('p_wellK', L('ОМВК по колодезной камере на время измерения в фантоме, мГр/ч', 'RAKR from the well-type chamber at the phantom measurement time, mGy/h'), { span: ' span-2' })}
      ${num('p_ktot', L('Свой k_tot', 'Own k_tot'))}
    </div>
    <p class="sub-hint" id="br-ktot-live"></p>
    <div class="actions"><button type="button" data-br="wellk">${esc(L('Взять с листа «Колодезная камера»', 'Take from the Well-type chamber sheet'))}</button><button type="button" data-br="usektot">${esc(L('Использовать как свой k_tot', 'Use as own k_tot'))}</button></div>
    <p class="sub-hint">${sub(L('k_tot = K̇_колодезная / (N · Ṁ): тот же источник; ОМВК колодезной камеры пересчитывается на время измерения в фантоме по распаду. Аппликатор, в котором мерили в фантоме, входит в k_tot. Определив k_tot один раз, дальше сила источника считается по фантому с ним.', 'k_tot = K̇_well / (N · Ṁ): same source; the well-type chamber RAKR is decay-corrected to the phantom measurement time. The applicator used in the phantom is included in k_tot. Once k_tot is determined, the source strength is calculated from the phantom with it.'))}</p></section>`;
}

// ------------------------------------------------------------ лист «Максимум отклика»
function sweetSetupHtml() {
  return `<section class="start-card plates-card"><h2><span class="step-no">1</span> ${esc(L('Камера и система отсчёта', 'Chamber and position reference'))}</h2>
    <div class="grid">
      ${text('w_model', L('Камера', 'Chamber'), { ph: 'PTW TM33004' })}
      <div class="field"><label for="br_s_date">${esc(L('Дата', 'Date'))}</label><input type="date" id="br_s_date" data-f="s_date" value="${esc(form.s_date)}"></div>
      ${text('s_ref', L('Система отсчёта положения', 'Position reference'), { ph: L('по пульту аппарата, ампулопровод №…', 'as on the afterloader console, transfer tube no. …'), span: ' span-2' })}
      ${num('s_cert_pos', L('Опорная точка по сертификату камеры, мм', 'Reference point in the chamber certificate, mm'))}
      ${num('s_step', L('Шаг положений, мм', 'Position step, mm'))}
      ${select('s_unit', L('Единица тока', 'Current unit'), unitOpts(CURRENT_UNITS, form.s_unit))}
    </div></section>`;
}

function sweetRowsHtml() {
  const n = Math.max(form.s_x.length, form.s_M.length, 3);
  const u = unitLabel(CURRENT_UNITS[form.s_unit]) ?? '';
  const rows = Array.from({ length: n }, (_, i) => `<div class="pair-row"><span class="pair-no">${i + 1}</span>
      <input type="text" class="num" inputmode="decimal" id="br_s_x_${i}" data-sx="${i}" aria-label="${esc(L(`Положение ${i + 1}, мм`, `Position ${i + 1}, mm`))}" value="${esc(form.s_x[i] ?? '')}">
      <input type="text" class="num" inputmode="decimal" id="br_s_M_${i}" data-sm="${i}" aria-label="${esc(L(`Показание ${i + 1}`, `Reading ${i + 1}`))}" value="${esc(form.s_M[i] ?? '')}"></div>`).join('');
  return `<section class="start-card plates-card"><h2><span class="step-no">2</span> ${esc(L('Кривая отклика', 'Response curve'))}</h2>
    <div class="pairs br-sweet">
      <div class="pairs-head"><span class="pair-no">№</span><span${tipAttr('s_x', { focus: true })}>${esc(L('Положение, мм', 'Position, mm'))}</span><span>${esc(L(`Показание, ${u}`, `Reading, ${u}`))}</span></div>
      <div class="pairs-list">${rows}</div>
      <div class="cells-tools">
        <button type="button" class="icon-btn" data-br="s-add" aria-label="${esc(L('Добавить положение (+шаг)', 'Add a position (+step)'))}" title="${esc(L('Добавить положение (+шаг)', 'Add a position (+step)'))}">+</button>
        <button type="button" class="icon-btn" data-br="s-del" aria-label="${esc(L('Убрать последнее положение', 'Remove the last position'))}" title="${esc(L('Убрать последнее положение', 'Remove the last position'))}"${n <= 3 ? ' disabled' : ''}>−</button>
      </div>
      <p class="eq">${sub(L('Кнопка «+» ставит в следующую строку положение «последнее + шаг». Показания — ток или заряд за одно и то же время; поправки к ним не нужны: важна только форма кривой.', 'The “+” button puts “last + step” into the next row. Readings are currents or charges over the same time; no corrections are needed, only the curve shape matters.'))}</p>
    </div></section>`;
}

function sweetResult() {
  const r = computeBrachySweet(form);
  if (!r.ok) return msgHtml(r.messages);
  const pl = (k) => (Number.isFinite(r.plateau[k].from) && Number.isFinite(r.plateau[k].to) ? L(`${fmt(r.plateau[k].from, 1)}–${fmt(r.plateau[k].to, 1)} мм (ширина ${fmt(r.plateau[k].to - r.plateau[k].from, 1)} мм)`, `${fmt(r.plateau[k].from, 1)}–${fmt(r.plateau[k].to, 1)} mm (width ${fmt(r.plateau[k].to - r.plateau[k].from, 1)} mm)`) : L('за пределами кривой', 'beyond the curve'));
  const u = unitLabel(CURRENT_UNITS[form.s_unit]) ?? '';
  const rows = [
    [L('Максимум', 'Maximum'), `${fmt(r.mPeak, 4)} ${u}; ${r.method === 'parabola' ? L(`вершина параболы по ${r.fit.n} точкам`, `parabola vertex over ${r.fit.n} points`) : L('наибольшее показание', 'largest reading')}`, 'xPeak'],
    [L('Плато ≥ 99,5 %', 'Plateau ≥ 99.5%'), pl(99.5), 'plateau'],
    [L('Плато ≥ 99 %', 'Plateau ≥ 99%'), pl(99), 'plateau'],
    [L('Наибольший шаг', 'Largest step'), `${fmt(r.maxStep, 2)} ${L('мм', 'mm')}`, 's_step'],
    Number.isFinite(r.atMeas.rel) ? [L('Отклик в положении измерения', 'Response at the measurement position'), `${fmt(r.atMeas.x, 1)} ${L('мм', 'mm')}: ${fmt(r.atMeas.rel * 100, 2)} %`, 'w_pos'] : null,
    Number.isFinite(r.atCert.x) ? [L('Опорная точка сертификата', 'Certificate reference point'), `${fmt(r.atCert.x, 1)} ${L('мм', 'mm')}${Number.isFinite(r.atCert.rel) ? `: ${fmt(r.atCert.rel * 100, 2)} %` : ''}${Number.isFinite(r.atCert.shift) ? L(`, сдвиг ${fmtSigned(r.atCert.shift, 1)} мм`, `, shift ${fmtSigned(r.atCert.shift, 1)} mm`) : ''}`, 's_cert_pos'] : null,
  ];
  const table = `<div class="table-wrap"><table class="factors br-variants"><thead><tr><th class="v">${esc(L('Положение, мм', 'Position, mm'))}</th><th class="v">${esc(L(`Показание, ${u}`, `Reading, ${u}`))}</th><th class="v">${esc(L('Отклик, %', 'Response, %'))}</th></tr></thead><tbody>${r.points
    .map((p, i) => `<tr${Math.abs(p.x - r.xPeak) < 1e-9 ? ' class="current"' : ''}><td class="v">${esc(fmt(p.x, 1))}</td><td class="v">${esc(fmt(p.m, 4))}</td><td class="v">${esc(fmt(r.rel[i].rel * 100, 2))}</td></tr>`)
    .join('')}</tbody></table></div>`;
  return `<div class="plates-dose"><span${tipAttr('xPeak', { focus: true })}>${esc(L('Максимум отклика', 'Response maximum'))}</span><b>${esc(fmt(r.xPeak, 1))} ${esc(L('мм', 'mm'))}</b></div>
    <div class="actions"><button type="button" data-br="s-use">${esc(L(`Мерить в ${fmt(r.xPeak, 1)} мм на листе «Колодезная камера»`, `Measure at ${fmt(r.xPeak, 1)} mm on the Well-type chamber sheet`))}</button></div>
    <div class="br-chart" id="br-sweet-chart"></div>
    <p class="chart-legend">${legendSwatch({ cls: 's1' })} ${esc(L('измерения', 'measurements'))} ${legendSwatch({ cls: 's2', line: true })} ${esc(L('парабола у вершины', 'parabola at the top'))}</p>
    ${factorRows(rows)}${table}${msgHtml(r.messages)}`;
}

function sweetChart() {
  const box = $('#br-sweet-chart');
  if (!box) return;
  const r = computeBrachySweet(form);
  if (!r.ok) return;
  const series = [{ cls: 's1', shape: 'circle', points: r.rel.map((p) => ({ x: p.x, y: p.rel * 100, title: `${fmt(p.x, 1)} ${L('мм', 'mm')}: ${fmt(p.rel * 100, 2)} %` })) }];
  if (r.fit) {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const x = r.fit.from + ((r.fit.to - r.fit.from) * i) / 40;
      const dx = x - r.fit.x0;
      pts.push({ x, y: ((r.fit.c0 + r.fit.c1 * dx + r.fit.c2 * dx * dx) / Math.abs(r.mPeak)) * 100 });
    }
    series.push({ cls: 's2', line: true, points: pts });
  }
  const vlines = [{ x: r.xPeak, label: L(`максимум ${fmt(r.xPeak, 1)}`, `maximum ${fmt(r.xPeak, 1)}`) }];
  if (Number.isFinite(r.atMeas.rel)) vlines.push({ x: r.atMeas.x, label: L('измерение', 'measurement'), row: 1 });
  if (Number.isFinite(r.atCert.rel)) vlines.push({ x: r.atCert.x, label: L('сертификат', 'certificate'), row: 1 });
  scatterChart(box, {
    label: L('Относительный отклик колодезной камеры по положению источника', 'Relative well-type chamber response by source position'),
    xLabel: L('Положение источника, мм', 'Source position, mm'),
    yLabel: L('Отклик, %', 'Response, %'),
    fmt: (v, d) => fmt(v, d),
    series,
    vlines,
    aspect: 0.45,
    minHeight: 220,
    maxHeight: 360,
  });
}

// ------------------------------------------------------------ лист «Распад»
function decayParamsHtml() {
  const bases = [['cert', L('от сертификата источника', 'from the source certificate')], ['well', L('от измерения колодезной камерой', 'from the well-type chamber measurement')], ['phantom', L('от измерения в фантоме PTW 9193', 'from the PTW 9193 phantom measurement')]];
  const units = [['', L('по нуклиду', 'by nuclide')], ['d', L('сутки', 'days')], ['w', L('недели', 'weeks')], ['m', L('месяцы', 'months')]];
  const tUnits = `<optgroup label="${esc(L('Сила источника', 'Source strength'))}">${unitOpts(STRENGTH_UNITS, form.d_target_unit)}</optgroup><optgroup label="${esc(L('Активность (нужна Γ_δ)', 'Activity (Γ_δ needed)'))}">${unitOpts(ACTIVITY_UNITS, form.d_target_unit)}</optgroup>`;
  return `<section class="start-card plates-card"><h2><span class="step-no">2</span> ${esc(L('Таблица', 'Table'))}</h2>
    <div class="grid">
      ${select('d_basis', L('Отсчёт', 'Base'), bases.map(([k, t]) => opt(k, t, form.d_basis)).join(''), { span: ' span-2' })}
      <div class="field"><label for="br_d_from">${esc(L('С даты (пусто — с даты отсчёта)', 'From (blank: the base date)'))}</label><input type="date" id="br_d_from" data-f="d_from" value="${esc(form.d_from)}"></div>
      <div class="field"><label for="br_d_to">${esc(L('По дату (пусто — по умолчанию)', 'To (blank: default)'))}</label><input type="date" id="br_d_to" data-f="d_to" value="${esc(form.d_to)}"></div>
      ${num('d_n', L('Шаг', 'Step'), { ph: '1' })}
      ${select('d_unit', L('Единица шага', 'Step unit'), units.map(([k, t]) => opt(k, t, form.d_unit)).join(''))}
      <div class="field"><label for="br_d_zone">${esc(L('Часовой пояс таблицы', 'Table time zone'))}</label><select id="br_d_zone" data-f="d_zone">${zoneOpts(form.d_zone)}</select></div>
      ${numUnit('d_target', L('Порог замены источника', 'Source replacement threshold'), tUnits, 'd_target_unit', { span: ' span-2' })}
    </div></section>`;
}

/** Дата и время в поясе zone ('' — компьютера, 'UTC', '+3', '+5:30'): «ДД.ММ.ГГГГ ЧЧ:ММ». */
function zoneMinutes(zone) {
  if (!zone) return offsetMin();
  if (zone === 'UTC') return 0;
  const m = String(zone).match(/^([+-])(\d{1,2})(?::(\d{2}))?$/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : offsetMin();
}
function dateText(t, zone, withTime = true) {
  const d = new Date(t + zoneMinutes(zone) * 60000);
  const p = (x) => String(x).padStart(2, '0');
  const day = L(`${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`, `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`);
  return withTime ? `${day} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : day;
}
const isoUtc = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + 'Z';

function decayCompute() {
  const o = { offsetMin: offsetMin() };
  return computeBrachyDecay(form, { ...o, well: computeBrachyWell(form, o), phantom: computeBrachyPhantom(form, o) });
}

function decayResult() {
  const r = decayCompute();
  if (!r.ok) return msgHtml(r.messages);
  const z = form.d_zone;
  const hasA = r.rows.some((x) => Number.isFinite(x.A));
  const head = `<div class="plates-dose"><span>${esc(L('Отсчёт', 'Base'))} — ${esc(r.base.label)}</span><b>${esc(fmt(r.base.U / 1e3, 3))} ${esc(L('мГр/ч на 1 м', 'mGy/h at 1 m'))}</b><span>${esc(dateText(r.base.t, z))}</span></div>`;
  const target = r.target && Number.isFinite(r.target.t)
    ? `<p class="sub-hint"${tipAttr('d_target')}>${sub(L(`Сила ${fmt(r.target.U / 1e3, 3)} мГр/ч на 1 м (${fmt(r.target.U, 0)} U) — ${dateText(r.target.t, z)} (${isoUtc(r.target.t)}), через ${fmt((r.target.t - r.base.t) / 86400000, 1)} сут от отсчёта.`, `Strength ${fmt(r.target.U / 1e3, 3)} mGy/h at 1 m (${fmt(r.target.U, 0)} U): ${dateText(r.target.t, z)} (${isoUtc(r.target.t)}), ${fmt((r.target.t - r.base.t) / 86400000, 1)} d after the base.`))}</p>`
    : '';
  const table = `<div class="table-wrap"><table class="factors br-variants br-decay"><thead><tr><th>${esc(L('Дата', 'Date'))}</th><th>UTC</th><th class="v">${esc(L('Сутки', 'Days'))}</th><th class="v"${tipAttr('frac', { focus: true })}>${esc(L('Доля', 'Fraction'))}</th><th class="v"${tipAttr('RAKR', { focus: true })}>${esc(L('ОМВК, мГр/ч', 'RAKR, mGy/h'))}</th><th class="v">S_K, U</th>${hasA ? `<th class="v"${tipAttr('cert_gamma', { focus: true })}>${esc(L('A_app, ГБк', 'A_app, GBq'))}</th>` : ''}</tr></thead><tbody>${r.rows
    .map((x) => `<tr><td>${esc(dateText(x.t, z))}</td><td><small>${esc(isoUtc(x.t))}</small></td><td class="v">${esc(fmt(x.days, 1))}</td><td class="v">${esc(fmt(x.frac, 4))}</td><td class="v">${esc(fmt(x.mGyh, 3))}</td><td class="v">${esc(fmt(x.U, 0))}</td>${hasA ? `<td class="v">${esc(fmt(x.A, 2))}</td>` : ''}</tr>`)
    .join('')}</tbody></table></div>`;
  const stepText = { d: L('сут', 'd'), w: L('нед.', 'wk'), m: L('мес.', 'mo') }[r.step.unit];
  return `${head}<p class="sub-hint">${sub(L(`T½ = ${fmt(r.half, 3)} сут; шаг ${fmt(r.step.n, 0)} ${stepText}; ${r.rows.length} строк.`, `T½ = ${fmt(r.half, 3)} d; step ${fmt(r.step.n, 0)} ${stepText}; ${r.rows.length} rows.`))}</p>${target}
    <div class="actions"><button type="button" data-br="d-csv">${esc(L('Скачать таблицу (CSV)', 'Download the table (CSV)'))}</button></div>${table}${msgHtml(r.messages)}`;
}

function decayCsv() {
  const r = decayCompute();
  if (!r.ok) return;
  const en = L('ru', 'en') === 'en';
  const sep = en ? ',' : ';';
  const num = (v, d) => (Number.isFinite(v) ? (en ? v.toFixed(d) : v.toFixed(d).replace('.', ',')) : '');
  const head = [L('Дата', 'Date'), 'UTC', L('Сутки', 'Days'), L('Доля', 'Fraction'), L('ОМВК, мГр/ч на 1 м', 'RAKR, mGy/h at 1 m'), 'S_K, U', L('A_app, ГБк', 'A_app, GBq')];
  const lines = [head.join(sep), ...r.rows.map((x) => [dateText(x.t, form.d_zone), isoUtc(x.t), num(x.days, 2), num(x.frac, 5), num(x.mGyh, 4), num(x.U, 1), num(x.A, 3)].join(sep))];
  downloadText(`\ufeff${lines.join('\r\n')}\r\n`, savedFileName(L('таблица-распада', 'decay-table'), [form.src_name, HALF_LIVES[form.nuclide]?.label, new Date(r.base.t).toISOString().slice(0, 10)], 'csv'), 'text/csv;charset=utf-8');
  status(L('Таблица распада сохранена.', 'The decay table has been saved.'));
}

// ------------------------------------------------------------ лист «Сличение камер»
const nucSelect = () => select('nuclide', L('Радионуклид', 'Radionuclide'), Object.entries(HALF_LIVES).map(([k, h]) => opt(k, h.label, form.nuclide)).join(''));

function crossSetupHtml() {
  return `<section class="start-card plates-card"><h2><span class="step-no">1</span> ${esc(L('Источник и условия', 'Source and conditions'))}</h2>
    <div class="grid">
      ${nucSelect()}
      ${select('x_unit', L('Единица тока', 'Current unit'), unitOpts(CURRENT_UNITS, form.x_unit))}
      ${select('x_P_unit', L('Единица давления', 'Pressure unit'), unitOpts(PRESSURE_UNITS, form.x_P_unit))}
      ${num('x_T0', L('T0, °C', 'T0, °C'))}
      ${numUnit('x_P0', L('P0', 'P0'), PRESSURE_UNITS, 'x_P0_unit')}
      ${num('x_ksm', L('k_sm,sm0 (пусто — 1)', 'k_sm,sm0 (blank: 1)'))}
    </div></section>`;
}

function crossChamberHtml(n, pre, title) {
  const isRef = pre === 'x_ref_';
  return `<section class="start-card plates-card"><h2><span class="step-no">${n}</span> ${esc(title)}</h2>
    <div class="grid">
      ${text(`${pre}model`, L('Камера', 'Chamber'), { ph: 'PTW TM33004' })}
      ${text(`${pre}serial`, L('Заводской номер', 'Serial number'))}
      ${isRef ? `${numUnit('x_ref_N', L('Калибровочный коэффициент N_ref', 'Calibration coefficient N_ref'), WELL_N_UNITS, 'x_ref_N_unit', { span: ' span-2' })}${num('x_ref_kelec', L('k_elec', 'k_elec'))}` : num('x_fld_prev', L('Прежний N (для сравнения)', 'Previous N (for comparison)'))}
      ${when(pre, L('Дата измерения', 'Measurement date'), L('Время измерения', 'Measurement time'))}
      ${num(`${pre}T`, L('Температура, °C', 'Temperature, °C'))}
      ${num(`${pre}P`, L(`Давление, ${unitLabel(PRESSURE_UNITS[form.x_P_unit]) ?? ''}`, `Pressure, ${unitLabel(PRESSURE_UNITS[form.x_P_unit]) ?? ''}`))}
      ${num(`${pre}leak`, L('Ток утечки', 'Leakage current'))}
    </div>
    <div class="series">${cellsHtml(`${pre}I`, L('Ток', 'Current'), form[`${pre}I`], unitLabel(CURRENT_UNITS[form.x_unit]))}</div></section>`;
}

function crossResult() {
  const r = computeBrachyCross(form, { offsetMin: offsetMin() });
  if (!r.ok) return msgHtml(r.messages);
  const u = unitLabel(CURRENT_UNITS[form.x_unit]) ?? '';
  const nu = unitLabel(WELL_N_UNITS[r.unit]) ?? '';
  const chip = r.prev ? `<span class="chip ${Math.abs(r.prev.dev) <= 0.5 ? 'ok' : 'out'}">${esc(fmtSigned(r.prev.dev, 2))} % ${esc(L('от прежнего', 'from the previous'))}</span>` : '';
  const line = (c) => `${fmt(c.mean, 4)} ${u} (n = ${c.n}${Number.isFinite(c.relSd) ? `, ${L('разброс', 'spread')} ${fmt(c.relSd, 2)} %` : ''}) · k_TP ${fmt(c.kTP, 4)}${c.kLeak !== 1 ? ` · k_leak ${fmt(c.kLeak, 4)}` : ''}${c.kElec && c.kElec !== 1 ? ` · k_elec ${fmt(c.kElec, 4)}` : ''}${c.kDec && c.kDec !== 1 ? ` · k_dec ${fmt(c.kDec, 5)}` : ''} = ${fmt(c.corrT ?? c.corr, 4)}`;
  const rows = [
    [L('M_ref, эталонная', 'M_ref, reference'), line(r.ref)],
    [L('M_field, рабочая', 'M_field, field'), line(r.fld)],
    Number.isFinite(r.dtHours) && r.dtHours !== 0 ? ['k_dec', L(`${fmt(r.kDec, 5)} (рабочая на ${fmt(r.dtHours * 60, 0)} мин позже)`, `${fmt(r.kDec, 5)} (field ${fmt(r.dtHours * 60, 0)} min later)`), 'x_kdec'] : null,
    ['M_ref/M_field', fmt(r.ratio, 5)],
    ['k_sm,sm0', fmt(r.kSm, 4), 'x_ksm'],
    [L('Формула', 'Formula'), L('N_field = M_ref/M_field · N_ref · k_sm,sm0 (TRS-492, ур. 18–20)', 'N_field = M_ref/M_field · N_ref · k_sm,sm0 (TRS-492, Eq. 18–20)')],
  ];
  return `<div class="plates-dose"><span${tipAttr('x_N', { focus: true })}>${sub(L('N рабочей камеры', 'Field chamber N'))}</span><b>${esc(fmt(r.N, Math.max(0, 5 - Math.floor(Math.log10(Math.abs(r.N))))))} ${esc(nu)}</b>${chip}</div>
    <p class="sub-hint">${sub(L(`При T0 = ${form.x_T0} °C, P0 = ${form.x_P0} ${unitLabel(PRESSURE_UNITS[form.x_P0_unit]) ?? ''}; ${HALF_LIVES[form.nuclide]?.label ?? ''}.`, `At T0 = ${form.x_T0} °C, P0 = ${form.x_P0} ${unitLabel(PRESSURE_UNITS[form.x_P0_unit]) ?? ''}; ${HALF_LIVES[form.nuclide]?.label ?? ''}.`))}</p>
    <div class="actions"><button type="button" data-br="x-use">${esc(L('Перенести на лист «Колодезная камера»', 'Move to the Well-type chamber sheet'))}</button></div>
    ${factorRows(rows)}${msgHtml(r.messages)}`;
}

// ------------------------------------------------------------ лист «Стабильность»
const ST_METHODS = () => [
  ['check', L('контрольный источник (8.5.2), ±0,5 %', 'check source (8.5.2), ±0.5%')],
  ['beam', L('внешний пучок 6 МВ / ⁶⁰Co (8.5.3), ±0,5 %', 'external beam 6 MV / ⁶⁰Co (8.5.3), ±0.5%')],
  ['hdr', L('источник HDR до замены (8.5.4), ±0,5 %', 'HDR source until exchange (8.5.4), ±0.5%')],
  ['redundant', L('вторая камера (8.5.1), ±0,1 %', 'redundant chamber (8.5.1), ±0.1%')],
];

function stabSetupHtml() {
  const m = form.st_method;
  const nucs = ['Cs-137', 'Sr-90', 'Co-60'].map((k) => opt(k, HALF_LIVES[k].label, form.st_check_nuclide)).join('');
  return `<section class="start-card plates-card"><h2><span class="step-no">1</span> ${esc(L('Метод и исходное значение', 'Method and baseline'))}</h2>
    <div class="grid">
      ${select('st_method', L('Метод', 'Method'), ST_METHODS().map(([k, t]) => opt(k, t, m)).join(''), { span: ' span-2' })}
      ${m === 'check' ? `${select('st_check_nuclide', L('Контрольный источник', 'Check source'), nucs)}${num('st_half', L('Свой t½, сут', 'Own t½, days'), { hint: L('Пусто — TRS-492, табл. 3; например, для ²⁴¹Am', 'Blank: TRS-492, Table 3; e.g. for ²⁴¹Am') })}` : ''}
      ${m === 'hdr' ? nucSelect() : ''}
      ${select('st_unit', L('Единица тока', 'Current unit'), unitOpts(CURRENT_UNITS, form.st_unit))}
      ${m === 'redundant' ? '' : `${num('st_T0', L('T0, °C', 'T0, °C'))}${numUnit('st_P0', L('P0', 'P0'), PRESSURE_UNITS, 'st_P0_unit')}`}
      ${num('st_base', m === 'redundant' ? L('Исходное отношение M1/M2', 'Baseline ratio M1/M2') : L(`Исходное значение, ${unitLabel(CURRENT_UNITS[form.st_unit]) ?? ''}`, `Baseline, ${unitLabel(CURRENT_UNITS[form.st_unit]) ?? ''}`))}
      ${m === 'redundant' || m === 'beam' ? '' : when('st_base_', L('Дата исходного значения', 'Baseline date'), L('Время исходного измерения', 'Baseline measurement time'))}
    </div></section>`;
}

function stabMeasureHtml() {
  const m = form.st_method;
  const u = unitLabel(CURRENT_UNITS[form.st_unit]);
  return `<section class="start-card plates-card"><h2><span class="step-no">2</span> ${esc(L('Проверка', 'Check'))}</h2>
    <div class="grid">
      ${when('st_', L('Дата проверки', 'Check date'), L('Время проверки', 'Check time'))}
      ${num('st_T', L('Температура, °C', 'Temperature, °C'))}
      ${numUnit('st_P', L('Давление', 'Pressure'), PRESSURE_UNITS, 'st_P_unit')}
    </div>
    <div class="series">${cellsHtml('st_I', m === 'redundant' ? L('Камера 1', 'Chamber 1') : L('Показания', 'Readings'), form.st_I, u)}</div>
    ${m === 'redundant' ? `<div class="series">${cellsHtml('st_I2', L('Камера 2', 'Chamber 2'), form.st_I2, u)}</div>` : ''}
    <p class="sub-hint">${sub(m === 'redundant'
      ? L('Один источник поочерёдно в обеих камерах, в одно время: k_TP и распад сокращаются.', 'One source in both chambers in turn, at the same time: k_TP and decay cancel.')
      : m === 'beam'
        ? L('Воспроизводимая геометрия: камера на полу при большом РИП, поле накрывает всю камеру, электрометр дальше 3 м от пучка, стол убран; облучение — несколько минут; выход пучка известен по своему протоколу.', 'Reproducible geometry: the chamber on the floor at an extended SSD, the field covers the whole chamber, the electrometer more than 3 m from the beam, the couch retracted; a few minutes of irradiation; beam output known per the local protocol.')
        : L('Контрольный источник — в своём держателе на оси камеры, у максимума отклика, с тем же поворотом держателя.', 'The check source in its holder on the chamber axis, near the sweet spot, with the same holder rotation.'))}</p></section>`;
}

function stabResult() {
  const r = computeBrachyStability(form, { offsetMin: offsetMin() });
  if (!r.ok) return msgHtml(r.messages);
  const u = unitLabel(CURRENT_UNITS[form.st_unit]) ?? '';
  const red = r.method === 'redundant';
  const valText = red ? fmt(r.value, 5) : `${fmt(r.value, 4)} ${u}`;
  const chip = Number.isFinite(r.dev) ? `<span class="chip ${r.pass ? 'ok' : 'out'}">${esc(r.pass ? L(`в пределах ±${fmt(r.tol, 1)} %`, `within ±${fmt(r.tol, 1)}%`) : L(`вне ±${fmt(r.tol, 1)} %`, `outside ±${fmt(r.tol, 1)}%`))}</span>` : '';
  const head = Number.isFinite(r.dev)
    ? `<div class="plates-dose"><span${tipAttr('st_dev', { focus: true })}>${esc(L('Отклонение от исходного', 'Deviation from the baseline'))}</span><b>${esc(fmtSigned(r.dev, 2))} %</b>${chip}</div>`
    : `<div class="plates-dose"><span>${esc(red ? L('Отношение M1/M2', 'Ratio M1/M2') : L('Приведённое показание', 'Corrected reading'))}</span><b>${esc(valText)}</b></div>`;
  const rd = (c) => `${fmt(c.mean, 4)} ${u} (n = ${c.n}${Number.isFinite(c.relSd) ? `, ${L('разброс', 'spread')} ${fmt(c.relSd, 2)} %` : ''})`;
  const rows = [
    [red ? L('Камера 1, среднее', 'Chamber 1, mean') : L('Среднее показание', 'Mean reading'), rd(r.r1), 'repeat'],
    red && r.r2 ? [L('Камера 2, среднее', 'Chamber 2, mean'), rd(r.r2), 'repeat'] : null,
    red ? null : ['k_TP', fmt(r.r1.kTP, 4), 'kTP'],
    !red && r.nuclide ? ['k_dec', `${fmt(r.kDec, 5)}${Number.isFinite(r.days) ? L(` (${HALF_LIVES[r.nuclide]?.label ?? ''}, ${fmt(r.days, 1)} сут от исходного)`, ` (${HALF_LIVES[r.nuclide]?.label ?? ''}, ${fmt(r.days, 1)} d from the baseline)`) : ''}`, 'st_check_nuclide'] : null,
    [red ? L('Отношение M1/M2', 'Ratio M1/M2') : L('Приведённое показание M', 'Corrected reading M'), valText],
    Number.isFinite(r.base) ? [L('Исходное значение', 'Baseline'), red ? fmt(r.base, 5) : `${fmt(r.base, 4)} ${u}`, 'st_base'] : null,
  ];
  return `${head}<div class="actions"><button type="button" data-br="st-base">${esc(L('Записать это значение как исходное', 'Record this value as the baseline'))}</button></div>${factorRows(rows)}${msgHtml(r.messages)}`;
}

// ------------------------------------------------------------ бюджет неопределённости (колодезная камера, фантом)
/** Бюджет листа: колодезная камера — TRS-492, табл. 10; фантом — Ubrich 2014. Возвращает { b, value } (value — мГр/ч). */
function budgetFor() {
  const w = computeBrachyWell(form, { offsetMin: offsetMin() });
  const wb = wellBudget({ scenario: form.u_scen, NU: parseNumber(form.w_NU), ksmMode: form.w_ksm_mode, readings: w.readings, over: form.u_over_w });
  if (sheet === 'well') return { b: wb, value: w.ok ? w.mGyh : NaN, which: 'w' };
  const r = computeBrachyPhantom(form, { offsetMin: offsetMin() });
  const b = phantomBudget({ scenario: form.u_scen, NU: parseNumber(form.p_NU), mainId: r.main?.id, nuclide: form.nuclide, holes: r.holes, kA: r.main?.kA, wellUc: wb.uc, over: form.u_over_p });
  return { b, value: r.main ? r.mGyh : NaN, which: 'p' };
}

const uNum = (v) => (Number.isFinite(v) ? fmt(v, 2) : '—');

function uncHtml(n) {
  const { b, which } = budgetFor();
  const over = parseOverrides(form[`u_over_${which}`]);
  const rows = b.rows
    .map((r) => `<tr data-ur="${esc(r.key)}"><td>${sub(r.label)}<br><small class="u-how">${sub(r.how)}</small>${r.ref ? ` <small class="ref">(${esc(refText(r.ref))})</small>` : ''}</td><td class="v u-def">${esc(uNum(r.def))}</td><td class="v"><input type="text" class="num u-own" inputmode="decimal" data-uk="${esc(r.key)}" aria-label="${esc(L(`Своё значение: ${r.label}`, `Own value: ${r.label}`))}" value="${esc(over[r.key] ?? '')}"></td><td class="v u-val">${esc(uNum(r.value))}</td></tr>`)
    .join('');
  const scen = [['1', L('сценарий 1: контролируемые условия', 'scenario 1: controlled conditions')], ['2', L('сценарий 2: условия не контролируются', 'scenario 2: conditions not controlled')]];
  return `<section class="start-card plates-card"><h2><span class="step-no">${n}</span> ${esc(L('Неопределённость', 'Uncertainty'))}</h2>
    <div class="grid">${select('u_scen', L('Типовые значения', 'Example values'), scen.map(([k, t]) => opt(k, t, form.u_scen)).join(''), { span: ' span-2' })}</div>
    <div class="table-wrap"><table class="factors br-variants br-unc"><thead><tr><th>${esc(L('Составляющая', 'Component'))}</th><th class="v">${esc(L('Типовое, %', 'Example, %'))}</th><th class="v">${esc(L('Своё, %', 'Own, %'))}</th><th class="v">${esc(L('Принято, %', 'Used, %'))}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div id="br-unc-sum" aria-live="polite"></div>
    <p class="sub-hint">${sub(which === 'w'
      ? L('Относительные стандартные неопределённости (k = 1), складываются в квадратуре; U = 2·u_c. Значения TRS-492, табл. 10 — пример для HDR ¹⁹²Ir: оцените свои по своей процедуре и оборудованию (лучше — по результатам контроля приборов) и введите в «Своё».', 'Relative standard uncertainties (k = 1), added in quadrature; U = 2·u_c. TRS-492 Table 10 values are an example for HDR ¹⁹²Ir: estimate your own from your procedure and equipment (preferably from instrument QC) and enter them under “Own”.')
      : L('Относительные стандартные неопределённости (k = 1), складываются в квадратуре; U = 2·u_c. Ubrich 2014 даёт расширенные неопределённости множителя: Монте-Карло 0,9 %, калибровка PTB 2,7 %, DGMP 13 — 5,8 %; N_D,w (PTW) 1,1 %, показание 0,9 %. Свои значения — в «Своё».', 'Relative standard uncertainties (k = 1), added in quadrature; U = 2·u_c. Ubrich 2014 gives expanded factor uncertainties: Monte Carlo 0.9%, PTB calibration 2.7%, DGMP 13 5.8%; N_D,w (PTW) 1.1%, reading 0.9%. Enter your own under “Own”.'))}</p>
    <div class="actions"><button type="button" data-br="u-clear">${esc(L('Очистить свои значения', 'Clear own values'))}</button></div></section>`;
}

/** Обновляет числа бюджета без перерисовки полей «Своё». */
function uncLive() {
  const sum = $('#br-unc-sum');
  if (!sum) return;
  const { b, value } = budgetFor();
  const keys = new Set(b.rows.map((r) => r.key));
  const shown = [...document.querySelectorAll('#brachy-root tr[data-ur]')].map((tr) => tr.dataset.ur);
  if (shown.length !== keys.size || shown.some((k) => !keys.has(k))) {
    render();
    return;
  }
  for (const r of b.rows) {
    const tr = document.querySelector(`#brachy-root tr[data-ur="${r.key}"]`);
    tr.querySelector('.u-def').textContent = uNum(r.def);
    tr.querySelector('.u-val').textContent = uNum(r.value);
    tr.querySelector('.u-how').innerHTML = sub(r.how);
  }
  const abs = Number.isFinite(value) ? L(` → ±${fmt((value * b.U) / 100, 3)} мГр/ч на 1 м (ОМВК ${fmt(value, 3)} мГр/ч)`, ` → ±${fmt((value * b.U) / 100, 3)} mGy/h at 1 m (RAKR ${fmt(value, 3)} mGy/h)`) : '';
  sum.innerHTML = `<div class="plates-dose"><span${tipAttr('u_c', { focus: true })}>${sub(L('Расширенная неопределённость ОМВК, k = 2', 'Expanded uncertainty of the RAKR, k = 2'))}</span><b>±${esc(fmt(b.U, 1))} %</b></div>
    <p class="sub-hint">${sub(L(`u_c = ${fmt(b.uc, 2)} %; U = ${fmt(b.k, 0)} · u_c = ${fmt(b.U, 2)} %${abs}.`, `u_c = ${fmt(b.uc, 2)}%; U = ${fmt(b.k, 0)} · u_c = ${fmt(b.U, 2)}%${abs}.`))}</p>${msgHtml(b.messages)}`;
}

function resultCardHtml(n) {
  return `<section class="start-card plates-card"><h2><span class="step-no">${n}</span> ${esc(L('Результат', 'Result'))}</h2><div id="br-result" aria-live="polite"></div></section>`;
}

function sheetBody() {
  if (sheet === 'sweet') return `${sweetSetupHtml()}${sweetRowsHtml()}${resultCardHtml(3)}`;
  if (sheet === 'decay') return `${sourceHtml()}${decayParamsHtml()}${resultCardHtml(3)}`;
  if (sheet === 'cross') return `${crossSetupHtml()}${crossChamberHtml(2, 'x_ref_', L('Эталонная камера', 'Reference chamber'))}${crossChamberHtml(3, 'x_fld_', L('Рабочая камера', 'Field chamber'))}${resultCardHtml(4)}`;
  if (sheet === 'stab') return `${stabSetupHtml()}${stabMeasureHtml()}${resultCardHtml(3)}`;
  if (sheet === 'well') return `${sourceHtml()}${wellChamberHtml()}${wellMeasureHtml()}${resultCardHtml(4)}${uncHtml(5)}`;
  return `${sourceHtml()}${phantomChamberHtml()}${phantomMeasureHtml()}${resultCardHtml(4)}${doseHtml()}${ownKtotHtml()}${uncHtml(7)}`;
}

function render() {
  const root = $('#brachy-root');
  if (!root) return;
  root.innerHTML = `${navHtml()}
    <div class="plates-banner"><b>${esc(L('Раздел в разработке', 'Section in development'))}</b>: ${esc(L('расчёт работает; запись в журнал и протокол появятся на следующих этапах. Черновик формы хранится в этом браузере.', 'the calculation works; journal records and the report come in the next stages. The form draft is kept in this browser.'))}</div>
    ${introHtml()}
    ${sheetBody()}
    ${sheet === 'decay' ? '' : `<div class="actions"><button type="button" data-br="clear">${esc(L('Очистить измерение', 'Clear the measurement'))}</button></div>`}`;
  for (const el of root.querySelectorAll('.cells[data-series]')) {
    const key = el.dataset.series;
    const m = key.match(/^p_hole(\d)$/);
    renderCells(el, m ? form.p_holes[+m[1]].M : form[key]);
    setupCells(el, onInput);
  }
  const clear = root.querySelector('[data-br="clear"]');
  if (clear) {
    armButton(clear, clear.textContent, () => L('Очистить показания этого листа?', 'Clear the readings of this sheet?'), () => {
      if (sheet === 'well') Object.assign(form, { w_I: [...BRACHY_DEFAULTS.w_I], w_leak: '', w_T: '', w_P: '', w_pol_plus: '', w_pol_minus: '', w_ks_m1: '', w_ks_m2: '', w_date: '', w_time: '' });
      else if (sheet === 'sweet') Object.assign(form, { s_x: [...BRACHY_DEFAULTS.s_x], s_M: [...BRACHY_DEFAULTS.s_M], s_date: '' });
      else if (sheet === 'cross') Object.assign(form, { x_ref_I: [...BRACHY_DEFAULTS.x_ref_I], x_fld_I: [...BRACHY_DEFAULTS.x_fld_I], x_ref_leak: '', x_fld_leak: '', x_ref_T: '', x_ref_P: '', x_fld_T: '', x_fld_P: '', x_ref_date: '', x_ref_time: '', x_fld_date: '', x_fld_time: '' });
      else if (sheet === 'stab') Object.assign(form, { st_I: [...BRACHY_DEFAULTS.st_I], st_I2: [...BRACHY_DEFAULTS.st_I2], st_T: '', st_P: '', st_date: '', st_time: '' });
      else Object.assign(form, { p_holes: structuredClone(BRACHY_DEFAULTS.p_holes), p_transit: '', p_pol_plus: ['', '', ''], p_pol_minus: ['', '', ''], p_ks_v2: ['', '', ''], p_date: '', p_time: '', p_wellK: '' });
      persist();
      render();
      status(L('Показания листа очищены.', 'The sheet readings have been cleared.'));
    });
  }
  live();
}

// ------------------------------------------------------------ результат
const msgHtml = (msgs) =>
  msgs
    .map((m) => `<p class="jlink-st ${m.level === 'info' ? 'none' : m.level === 'error' ? 'warn br-err' : 'warn'}">${sub(m.text)}${m.ref ? ` <span class="ref">(${esc(refText(m.ref))})</span>` : ''}</p>`)
    .join('');
const chipHtml = (cmp) => (cmp ? `<span class="chip ${cmp.level === 'ok' ? 'ok' : cmp.level === 'warn' ? 'out' : 'error'}">${esc(fmtSigned(cmp.dev, 2))} % ${esc(L('от сертификата', 'from the certificate'))}</span>` : '');
const uText = (U) => `${fmt(U, 0)} U`;
const factorRows = (rows) => `<table class="factors"><tbody>${rows.filter(Boolean).map(([k, v, tip]) => `<tr><th${tip ? tipAttr(tip, { focus: true }) : ''}>${sub(k)}</th><td>${sub(v)}</td></tr>`).join('')}</tbody></table>`;

function certLive() {
  const el = $('#br-cert-live');
  if (!el) return;
  const r = sheet === 'well' ? computeBrachyWell(form, { offsetMin: offsetMin() }) : computeBrachyPhantom(form, { offsetMin: offsetMin() });
  const c = r.cert;
  if (!Number.isFinite(c.U)) {
    el.innerHTML = '';
    return;
  }
  const parts = [L(`На дату сертификата: S_K = ${uText(c.U)} (ОМВК ${fmt(c.U / 1e3, 3)} мГр/ч на 1 м)`, `At the certificate date: S_K = ${uText(c.U)} (RAKR ${fmt(c.U / 1e3, 3)} mGy/h at 1 m)`)];
  if (c.gammaUperGBq > 0) parts.push(L(`кажущаяся активность ${fmt(c.U / c.gammaUperGBq, 2)} ГБк`, `apparent activity ${fmt(c.U / c.gammaUperGBq, 2)} GBq`));
  const t = r.tMeas;
  if (c.ok && Number.isFinite(t)) {
    const e = c.U / kDec(t, c.tCert, c.half);
    parts.push(L(`на дату измерения (${fmt((t - c.tCert) / 86400000, 2)} сут, t½ = ${fmt(c.half, 3)} сут): ${uText(e)}, ${fmt(e / 1e3, 3)} мГр/ч`, `at the measurement date (${fmt((t - c.tCert) / 86400000, 2)} d, t½ = ${fmt(c.half, 3)} d): ${uText(e)}, ${fmt(e / 1e3, 3)} mGy/h`));
  }
  el.innerHTML = `${parts.map(sub).join('; ')}.`;
}

function wellResult() {
  const r = computeBrachyWell(form, { offsetMin: offsetMin() });
  if (!r.ok) return msgHtml(r.messages);
  const f = r.factors;
  const rows = [
    [L('Среднее показание', 'Mean reading'), `${fmt(r.readings.mean, 4)} ${unitLabel(CURRENT_UNITS[form.w_unit])} (n = ${r.readings.n}, ${L('разброс', 'spread')} ${fmt(r.readings.relSd, 2)} %)`],
    ['k_TP', fmt(f.kTP, 4), 'kTP'],
    f.kLeak !== 1 ? ['k_leak', fmt(f.kLeak, 4), 'kLeak'] : null,
    ['k_elec', fmt(f.kElec, 4), 'kElec'],
    ['k_pol', fmt(f.kPol, 4), 'kPol'],
    ['k_s', `${fmt(f.kS, 4)}${f.ks ? ` (${f.ks.preferLinear ? L('линейно', 'linear') : f.ks.equation})` : ''}`, 'kS'],
    ['k_sm,sm0', `${fmt(f.kSm, 3)}${f.ksmU ? L(` (+${fmt(f.ksmU, 0)} % к неопределённости)`, ` (+${fmt(f.ksmU, 0)}% to the uncertainty)`) : ''}`, 'kSm'],
    [L('Формула', 'Formula'), L('K̇ = N · I · k_TP · k_leak · k_elec · k_pol · k_s · k_sm,sm0 (TRS-492, ур. 21, 27)', 'K̇ = N · I · k_TP · k_leak · k_elec · k_pol · k_s · k_sm,sm0 (TRS-492, Eq. 21, 27)')],
  ];
  const more = [L(`S_K = ${uText(r.U)}`, `S_K = ${uText(r.U)}`)];
  if (Number.isFinite(r.Uref)) more.push(L(`на дату сертификата ${uText(r.Uref)}`, `at the certificate date ${uText(r.Uref)}`));
  if (Number.isFinite(r.A)) more.push(L(`кажущаяся активность ${fmt(r.A, 2)} ГБк (справочно)`, `apparent activity ${fmt(r.A, 2)} GBq (for reference)`));
  if (r.compare) more.push(L(`по сертификату на дату измерения ${fmt(r.compare.expected / 1e3, 3)} мГр/ч`, `certificate value at the measurement date ${fmt(r.compare.expected / 1e3, 3)} mGy/h`));
  return `<div class="plates-dose"><span>${esc(L('ОМВК на время измерения', 'RAKR at the measurement time'))}</span><b>${esc(fmt(r.mGyh, 3))} ${esc(L('мГр/ч на 1 м', 'mGy/h at 1 m'))}</b>${chipHtml(r.compare)}</div>
    <p class="sub-hint">${more.map(sub).join('; ')}.</p>${factorRows(rows)}${msgHtml(r.messages)}`;
}

function phantomResult() {
  const r = computeBrachyPhantom(form, { offsetMin: offsetMin() });
  if (!r.variants.length && !r.rate) return msgHtml(r.messages);
  const f = r.factors ?? {};
  const head = r.main
    ? `<div class="plates-dose"><span>${esc(L('ОМВК на время измерения', 'RAKR at the measurement time'))} — ${sub(r.main.label)}</span><b>${esc(fmt(r.mGyh, 3))} ${esc(L('мГр/ч на 1 м', 'mGy/h at 1 m'))}</b>${chipHtml(r.compare)}</div>`
    : '';
  const more = [];
  if (r.main) more.push(`S_K = ${uText(r.U)}`);
  if (Number.isFinite(r.A)) more.push(L(`кажущаяся активность ${fmt(r.A, 2)} ГБк (справочно)`, `apparent activity ${fmt(r.A, 2)} GBq (for reference)`));
  if (Number.isFinite(r.Dw)) more.push(L(`мощность дозы в воде в точке измерения ${fmt(r.Dw, 3)} мГр/мин — раздел 5`, `dose rate to water at the measurement point ${fmt(r.Dw, 3)} mGy/min: section 5`));
  const holes = (r.holes ?? []).map((h) => `${h.i + 1}: ${fmt(h.raw, 4)} → ${fmt(h.corr, 4)}`).join('; ');
  const rows = [
    [L('Положения: среднее → с k_TP и без транзита, нКл', 'Positions: mean → with k_TP, transit removed, nC'), holes],
    Number.isFinite(r.spread) ? [L('Разброс положений', 'Spread of positions'), `${fmt(r.spread, 2)} %`, 'spread'] : null,
    ['k_pol', fmt(f.kPol, 4), 'kPol'],
    ['k_s', fmt(f.kS, 4), 'kS'],
    ['k_elec', fmt(f.kElec, 4), 'kElec'],
    ['Ṁ', `${fmt(r.rate, 3)} ${L('нКл/ч', 'nC/h')} (k_τ = 60/τ)`, 'Mdot'],
    ['k_r', fmt(0.0064, 4), 'kr'],
  ];
  const cmpHead = Number.isFinite(r.expected) ? `<th class="v"${tipAttr('dev', { focus: true })}>${esc(L('От сертификата', 'From the certificate'))}</th>` : '';
  const table = r.variants.length
    ? `<div class="table-wrap"><table class="factors br-variants"><thead><tr><th>${esc(L('Основной', 'Main'))}</th><th>${esc(L('Вариант', 'Variant'))}</th><th class="v"${tipAttr('factor', { focus: true })}>${esc(L('Множитель', 'Factor'))}</th><th class="v"${tipAttr('kA', { focus: true })}>${sub('k_A')}</th><th class="v"${tipAttr('RAKR', { focus: true })}>${esc(L('ОМВК, мГр/ч', 'RAKR, mGy/h'))}</th>${cmpHead}</tr></thead><tbody>${r.variants
        .map((v) => `<tr${r.main?.id === v.id ? ' class="current"' : ''}><td><input type="radio" name="br_main" value="${esc(v.id)}" aria-label="${esc(L('Основной вариант', 'Main variant'))}"${r.main?.id === v.id ? ' checked' : ''}></td><td>${sub(v.label)}${v.note ? `<br><small>${sub(v.note)}${v.kzp ? `: ${fmt(v.kzp, 4)}` : ''}</small>` : ''}${v.ref ? `<br><small class="ref">${esc(refText(v.ref))}</small>` : ''}</td><td class="v">${esc(fmt(v.factor * 1e3, 4))}·10⁻³</td><td class="v">${esc(fmt(v.kA, 4))}</td><td class="v">${esc(fmt(v.mGyh, 3))}</td>${cmpHead ? `<td class="v">${esc(fmtSigned(v.dev, 2))} %</td>` : ''}</tr>`)
        .join('')}</tbody></table></div>`
    : '';
  return `${head}${more.length ? `<p class="sub-hint">${more.map(sub).join('; ')}.</p>` : ''}${table}${factorRows(rows)}${msgHtml(r.messages)}`;
}

function doseResult(r) {
  const d = r.dose;
  if (!d) return '';
  if (!Number.isFinite(d.point)) return msgHtml(d.messages);
  const holes = (d.holes ?? []).map((h) => `${h.i + 1}: ${fmt(h.value, 3)}`).join('; ');
  const head = `<div class="plates-dose"><span${tipAttr('Dw', { focus: true })}>${sub(L('Ḋ_w в точке измерения (8 см в фантоме)', 'Ḋ_w at the measurement point (8 cm in the phantom)'))}</span><b>${esc(fmt(d.point, 3))} ${esc(L('мГр/мин', 'mGy/min'))}</b></div>
    <p class="sub-hint">${sub(L(`${fmt(d.point / 10, 4)} сГр/мин, ${fmt((d.point * 60) / 1e3, 4)} Гр/ч; по положениям, мГр/мин: ${holes}.`, `${fmt(d.point / 10, 4)} cGy/min, ${fmt((d.point * 60) / 1e3, 4)} Gy/h; by position, mGy/min: ${holes}.`))}</p>`;
  const cmp = Number.isFinite(d.expected);
  const cell = (x, n = 3) => `<td class="v">${Number.isFinite(x) ? esc(fmt(x, n)) : '—'}</td>`;
  const rows = d.rows
    .map((x) => `<tr${x.id === 'main' ? ' class="current"' : ''}><td>${sub(x.label)}${x.factor ? `<br><small>${sub('(k_tot)Ḋw,1')} = ${esc(fmt(x.factor, 2))}${x.note ? `, ${sub(x.note)}` : ''}</small>` : ''}${x.ref ? `<br><small class="ref">${esc(refText(x.ref))}</small>` : ''}</td>${cell(x.dw1, 1)}${cell(x.d8)}${cmp ? `<td class="v">${esc(fmtSigned(x.dev, 2))} %</td>` : ''}</tr>`)
    .join('');
  const certRow = cmp ? `<tr><td>${sub(L('По сертификату: Λ · S_K на дату измерения', 'Certificate: Λ · S_K at the measurement date'))}</td>${cell(d.expected, 1)}${cell(d.expected8)}<td class="v">—</td></tr>` : '';
  const table = d.rows.length
    ? `<div class="table-wrap"><table class="factors br-variants"><thead><tr><th>${esc(L('Способ', 'Method'))}</th><th class="v"${tipAttr('Dw1', { focus: true })}>${sub(L('Ḋ_w,1 (1 см), мГр/мин', 'Ḋ_w,1 (1 cm), mGy/min'))}</th><th class="v"${tipAttr('Dw8', { focus: true })}>${sub(L('Ḋ_w (8 см, вода), мГр/мин', 'Ḋ_w (8 cm, water), mGy/min'))}</th>${cmp ? `<th class="v"${tipAttr('dev', { focus: true })}>${esc(L('От сертификата', 'From the certificate'))}</th>` : ''}</tr></thead><tbody>${rows}${certRow}</tbody></table></div>`
    : '';
  const s = d.source;
  const info = s && Number.isFinite(d.gRatio)
    ? `<p class="sub-hint">${sub(L(`${s.name}: Λ = ${fmt(s.lambda, 3)} сГр·ч⁻¹·Ед⁻¹, L = ${fmt(s.L, 2)} см, G_L(8)/G_L(1) = ${fmt(d.gRatio, 6)}, g_L(8) = ${fmt(s.gL8, 3)}`, `${s.name}: Λ = ${fmt(s.lambda, 3)} cGy·h⁻¹·U⁻¹, L = ${fmt(s.L, 2)} cm, G_L(8)/G_L(1) = ${fmt(d.gRatio, 6)}, g_L(8) = ${fmt(s.gL8, 3)}`))}${s.ref ? ` <span class="ref">(${esc(refText(s.ref))})</span>` : ''}.</p>`
    : '';
  return `${head}${table}${info}${msgHtml(d.messages)}`;
}

/** ОМВК листа «Колодезная камера», пересчитанная на время измерения в фантоме (тот же нуклид). */
function wellKFromSheet() {
  const w = computeBrachyWell(form, { offsetMin: offsetMin() });
  if (!w.ok || !Number.isFinite(w.tMeas)) return NaN;
  const t = fieldTime(form.p_date, form.p_time, form.p_zone, offsetMin());
  if (!Number.isFinite(t.ms)) return NaN;
  const half = w.cert.half;
  return Number.isFinite(half) ? w.mGyh / kDec(t.ms, w.tMeas, half) : NaN;
}

function live() {
  const box = $('#br-result');
  certLive();
  for (const o of document.querySelectorAll('#brachy-root output[data-mean]')) {
    const v = readCells(document.querySelector(`#brachy-root .cells[data-series="${o.dataset.mean}"]`)).map(parseNumber).filter(Number.isFinite);
    o.textContent = v.length ? fmt(v.reduce((a, x) => a + x, 0) / v.length, 4) : '';
  }
  if (!box) return;
  if (sheet === 'phantom') {
    const r = computeBrachyPhantom(form, { offsetMin: offsetMin() });
    const k = $('#br-ktot-live');
    if (k) k.innerHTML = Number.isFinite(r.ktotFromWell) ? sub(L(`k_tot по сличению = ${fmt(r.ktotFromWell * 1e3, 4)}·10⁻³ (для N в Гр/нКл)`, `k_tot from the comparison = ${fmt(r.ktotFromWell * 1e3, 4)}·10⁻³ (for N in Gy/nC)`)) : '';
    const use = document.querySelector('#brachy-root [data-br="usektot"]');
    if (use) use.disabled = !Number.isFinite(r.ktotFromWell);
    const take = document.querySelector('#brachy-root [data-br="wellk"]');
    if (take) take.disabled = !Number.isFinite(wellKFromSheet());
    const dose = $('#br-dose');
    if (dose) dose.innerHTML = doseResult(r);
  }
  const results = { well: wellResult, sweet: sweetResult, decay: decayResult, cross: crossResult, stab: stabResult, phantom: phantomResult };
  box.innerHTML = results[sheet]();
  if (sheet === 'sweet') sweetChart();
  uncLive();
}

// ------------------------------------------------------------ ввод
function readForm() {
  const root = $('#brachy-root');
  if (!root) return;
  for (const el of root.querySelectorAll('[data-f]')) form[el.dataset.f] = el.value;
  for (const el of root.querySelectorAll('[data-hole]')) form.p_holes[+el.dataset.hole][el.dataset.hf] = el.value;
  for (const el of root.querySelectorAll('[data-sx]')) form.s_x[+el.dataset.sx] = el.value;
  for (const el of root.querySelectorAll('[data-sm]')) form.s_M[+el.dataset.sm] = el.value;
  const own = root.querySelectorAll('input[data-uk]');
  if (own.length) {
    const o = {};
    for (const el of own) if (el.value.trim()) o[el.dataset.uk] = el.value.trim();
    form[`u_over_${sheet === 'well' ? 'w' : 'p'}`] = Object.keys(o).length ? JSON.stringify(o) : '';
  }
  for (const el of root.querySelectorAll('.cells[data-series]')) {
    const key = el.dataset.series;
    const m = key.match(/^p_hole(\d)$/);
    if (m) form.p_holes[+m[1]].M = readCells(el);
    else form[key] = readCells(el);
  }
}

function onInput(e) {
  // выбор основного варианта: событие input приходит раньше change, а таблица после него перерисовывается
  if (e?.target?.name === 'br_main') {
    form.p_main = e.target.value;
    persist();
    live();
    return;
  }
  readForm();
  persist();
  live();
}

function onChange(e) {
  const t = e.target;
  if (t.name === 'br_main') return;
  if (t.dataset.full !== undefined || t.id === 'br_w_unit' || t.id === 'br_s_unit' || t.id === 'br_x_unit' || t.id === 'br_st_unit') {
    readForm();
    persist();
    render();
  }
}

function onClick(e) {
  const b = e.target.closest('button[data-br]');
  if (!b) return;
  if (b.dataset.br === 'wellk') {
    const k = wellKFromSheet();
    if (Number.isFinite(k)) form.p_wellK = String(+k.toFixed(4)).replace('.', L(',', '.'));
  } else if (b.dataset.br === 'usektot') {
    const r = computeBrachyPhantom(form, { offsetMin: offsetMin() });
    if (Number.isFinite(r.ktotFromWell)) {
      form.p_ktot = String(+r.ktotFromWell.toPrecision(5)).replace('.', L(',', '.'));
      form.p_main = 'own';
    }
  } else if (b.dataset.br === 's-add') {
    readForm();
    // следующее положение = последнее заполненное + шаг; в первую пустую строку после него или в новую
    let li = -1;
    form.s_x.forEach((v, i) => { if (Number.isFinite(parseNumber(v))) li = i; });
    const last = li >= 0 ? parseNumber(form.s_x[li]) : NaN;
    const step = parseNumber(form.s_step);
    const next = Number.isFinite(last) && Number.isFinite(step) ? String(+(last + step).toFixed(3)).replace('.', L(',', '.')) : '';
    const i = li + 1;
    if (i < form.s_x.length && !String(form.s_x[i] ?? '').trim()) form.s_x[i] = next;
    else {
      form.s_x.push(next);
      while (form.s_M.length < form.s_x.length - 1) form.s_M.push('');
      form.s_M.push('');
    }
    persist();
    render();
    $(`#br_s_M_${i < form.s_x.length ? i : form.s_x.length - 1}`)?.focus();
    return;
  } else if (b.dataset.br === 's-del') {
    readForm();
    if (form.s_x.length > 3) {
      form.s_x.pop();
      form.s_M.pop();
    }
  } else if (b.dataset.br === 's-use') {
    const r = computeBrachySweet(form);
    if (!r.ok) return;
    form.w_pos = String(+r.xPeak.toFixed(1)).replace('.', L(',', '.'));
    status(L(`Положение измерения на листе «Колодезная камера» — ${form.w_pos} мм.`, `Measurement position on the Well-type chamber sheet: ${form.w_pos} mm.`));
  } else if (b.dataset.br === 'x-use') {
    const r = computeBrachyCross(form, { offsetMin: offsetMin() });
    if (!r.ok) return;
    Object.assign(form, {
      w_N: String(+r.N.toPrecision(6)).replace('.', L(',', '.')),
      w_N_unit: r.unit,
      w_T0: form.x_T0,
      w_P0: form.x_P0,
      w_P0_unit: form.x_P0_unit,
      w_kelec: '1',
      ...(form.x_fld_model ? { w_model: form.x_fld_model } : {}),
      ...(form.x_fld_serial ? { w_serial: form.x_fld_serial } : {}),
    });
    status(L(`Калибровочный коэффициент рабочей камеры перенесён на лист «Колодезная камера»: ${form.w_N}.`, `The field chamber calibration coefficient has been moved to the Well-type chamber sheet: ${form.w_N}.`));
  } else if (b.dataset.br === 'st-base') {
    const r = computeBrachyStability(form, { offsetMin: offsetMin() });
    if (!r.ok || !Number.isFinite(r.value)) return;
    // исходное на дату проверки: показание с k_TP, без пересчёта по распаду к прежней дате
    const v = r.method === 'redundant' ? r.value : r.r1.corr;
    Object.assign(form, { st_base: String(+v.toPrecision(6)).replace('.', L(',', '.')), st_base_date: form.st_date, st_base_time: form.st_time, st_base_zone: form.st_zone });
    status(L(`Исходное значение — ${form.st_base}.`, `Baseline: ${form.st_base}.`));
  } else if (b.dataset.br === 'u-clear') {
    form[`u_over_${sheet === 'well' ? 'w' : 'p'}`] = '';
  } else if (b.dataset.br === 'd-csv') {
    decayCsv();
    return;
  } else return;
  persist();
  render();
}

/** Подключить вкладку «Брахитерапия». */
export function initBrachy() {
  statusEl = $('#brachy-status');
  load();
  const root = $('#brachy-root');
  root?.addEventListener('input', onInput);
  root?.addEventListener('change', onChange);
  root?.addEventListener('click', onClick);
  document.addEventListener('langchange', render);
}

/** Открыть лист (адрес #brachy/well, #brachy/sweet, #brachy/phantom, #brachy/cross, #brachy/stab, #brachy/decay; без листа — тот, с которым работали). */
export function renderBrachy(s) {
  if (SHEETS.includes(s)) sheet = s;
  persist();
  render();
}

/** Лист, с которым работали последним. */
export const brachySheet = () => sheet;
export const brachyStatus = (t) => status(t);
