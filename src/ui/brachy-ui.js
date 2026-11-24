// Вкладка «Брахитерапия»: листы «Колодезная камера» (IAEA TRS-492) и «Фантом PTW 9193» (DIN 6809-2, DGMP-Bericht 13,
// руководство PTW). Сертификат источника — общий для обоих листов. Расчёт — core/brachy-sheets.js; черновик формы —
// в этом браузере. Журнал, неопределённость и протокол — следующие этапы.
import { L, refText } from '../core/i18n.js';
import { PRESSURE_UNITS, unitLabel, parseNumber } from '../core/units.js';
import { HALF_LIVES, KSM_SOURCES, PTW_TO_DGMP, APPLICATOR_KA_STEEL } from '../core/brachy-data.js';
import { kDec } from '../core/brachy.js';
import {
  BRACHY_DEFAULTS, normalizeBrachy, computeBrachyWell, computeBrachyPhantom, fieldTime,
  STRENGTH_UNITS, ACTIVITY_UNITS, GAMMA_UNITS, WELL_N_UNITS, PHANTOM_N_UNITS, CURRENT_UNITS, DOSE_SOURCES,
} from '../core/brachy-sheets.js';
import { $, esc, fmt, fmtSigned, richText, armButton } from './common.js';
import { renderCells, readCells, setupCells } from './widgets.js';
import { cellsHtml } from './journal-common.js';
import { tipAttr } from './brachy-tips.js';

const KEY = 'reference-dosimetry.brachy';
const SHEETS = ['well', 'phantom'];
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
  const items = [['well', L('Колодезная камера', 'Well-type chamber')], ['phantom', L('Фантом PTW 9193', 'PTW 9193 phantom')]];
  return `<nav class="kv-pages" aria-label="${esc(L('Листы вкладки', 'Tab sheets'))}">${items.map(([k, t]) => `<a href="#brachy/${k}" data-goto="brachy/${k}"${k === sheet ? ' aria-current="page"' : ''}>${esc(t)}</a>`).join('')}</nav>`;
}

function introHtml() {
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

function resultCardHtml(n) {
  return `<section class="start-card plates-card"><h2><span class="step-no">${n}</span> ${esc(L('Результат', 'Result'))}</h2><div id="br-result" aria-live="polite"></div></section>`;
}

function render() {
  const root = $('#brachy-root');
  if (!root) return;
  root.innerHTML = `${navHtml()}
    <div class="plates-banner"><b>${esc(L('Раздел в разработке', 'Section in development'))}</b>: ${esc(L('расчёт работает, запись в журнал, бюджет неопределённости и протокол появятся на следующих этапах. Черновик формы хранится в этом браузере.', 'the calculation works; journal records, the uncertainty budget and the report come in the next stages. The form draft is kept in this browser.'))}</div>
    ${introHtml()}
    ${sourceHtml()}
    ${sheet === 'well' ? `${wellChamberHtml()}${wellMeasureHtml()}` : `${phantomChamberHtml()}${phantomMeasureHtml()}`}
    ${resultCardHtml(4)}${sheet === 'phantom' ? `${doseHtml()}${ownKtotHtml()}` : ''}
    <div class="actions"><button type="button" data-br="clear">${esc(L('Очистить измерение', 'Clear the measurement'))}</button></div>`;
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
  box.innerHTML = sheet === 'well' ? wellResult() : phantomResult();
}

// ------------------------------------------------------------ ввод
function readForm() {
  const root = $('#brachy-root');
  if (!root) return;
  for (const el of root.querySelectorAll('[data-f]')) form[el.dataset.f] = el.value;
  for (const el of root.querySelectorAll('[data-hole]')) form.p_holes[+el.dataset.hole][el.dataset.hf] = el.value;
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
  if (t.dataset.full !== undefined || t.id === 'br_w_unit') {
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

/** Открыть лист (адрес #brachy/well, #brachy/phantom; без листа — тот, с которым работали). */
export function renderBrachy(s) {
  if (SHEETS.includes(s)) sheet = s;
  persist();
  render();
}

/** Лист, с которым работали последним. */
export const brachySheet = () => sheet;
export const brachyStatus = (t) => status(t);
