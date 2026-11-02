// Модуль «kV-рентген»: связывает форму с расчётным ядром kv.js (TRS-398 Rev.1, разд. 8 и 9).
import { computeKv, KV_DEFAULTS, normalizeKv } from '../core/kv.js';
import { KV_CHAMBERS, kvChamberLabel } from '../core/kv-tables.js';
import { TG61_T8_CHAMBER } from '../core/kv-tg61.js';
import { SAMPLE_KV, SAMPLE_KV_EN } from '../core/sample-kv.js';
import { L, getLang, refText } from '../core/i18n.js';
import { localizeDecimals } from './i18n.js';
import { PRESSURE_UNITS, NDW_UNITS, unitLabel, dec } from '../core/units.js';
import { getMyChambers, saveMyChamber, deleteMyChamber } from './store.js';
import { makeCombo, renderCells, readCells, setupCells, renderStaff, readStaff, renderPairs, readPairs, setupPairs } from './widgets.js';
import {
  $, $$, localizeDemo, doseGroupTitle, rawReadingLabel, correctedReadingLabel, fmt, fmtSigned, esc, today, makeStatus, copyText, downloadText,
  renderOutputs, renderFlags, applyShowRules, armButton, renderSignBlock, printToPdf, renderCompliance, complianceLine, ctrlErrorText,
  fileStamp, checkFileFormat, compareWithFile, renderFileNote, versionText, renderNotesFlag, precisionNote, notifyUpdate, richText,
  inlineResultHtml, setInlineResult } from './common.js';

const DRAFT_KEY = 'reference-dosimetry.kv.v1';
const FILE_TAG = { app: 'reference-dosimetry', module: 'kv', version: 1 };
const SERIES_KEYS = ['kv_M1', 'kv_Mopp', 'kv_M2', 'kv_nx_M1', 'kv_nx_Mn', 'kv_Mc'];
const PAIR_KEYS = ['kv_tt', 'kv_tm'];
const CERT_KEYS = ['kv_cq_kv', 'kv_cq_hvl', 'kv_cq_val'];
const PROTO_NAME = 'TRS-398 Rev.1';
const ROOT = () => document.getElementById('module-kv');
let setStatus = () => {};
export const kvStatus = (text) => setStatus(text);

// ------------------------------------------------------------ списки
const volText = (v) => dec(String(v));

function fillChamberSelect() {
  const sel = $('#kv_ch_model');
  const keep = sel.value;
  const opt = (c) => `<option value="${esc(c.id)}">${esc(kvChamberLabel(c))} (${volText(c.volume)} ${L('см³', 'cm³')})</option>`;
  const parts = [`<option value="">${L('— выберите камеру —', '— select a chamber —')}</option>`];
  parts.push(`<optgroup label="${esc(L('Плоскопараллельные — низкие энергии', 'Plane-parallel — low energies'))}">`, ...KV_CHAMBERS.filter((c) => c.type === 'pp').map(opt), '</optgroup>');
  parts.push(`<optgroup label="${esc(L('Цилиндрические — средние энергии (табл. 32)', 'Cylindrical — medium energies (Table 32)'))}">`, ...KV_CHAMBERS.filter((c) => c.type === 'cyl').map(opt), '</optgroup>');
  const mine = getMyChambers();
  if (mine.length) {
    parts.push(`<optgroup label="${L('Мои камеры', 'My chambers')}">`);
    for (const c of mine) {
      const name = [c.cc_maker, c.cc_model].filter(Boolean).join(' ') || L('без названия', 'unnamed');
      parts.push(`<option value="${esc(c.id)}">${esc(name)}${c.cc_type === 'pp' ? L(' (плоскопараллельная)', ' (plane-parallel)') : L(' (цилиндрическая)', ' (cylindrical)')}</option>`);
    }
    parts.push('</optgroup>');
  }
  parts.push(`<option value="CUSTOM">${L('Ввести свою камеру…', 'Enter a custom chamber…')}</option>`);
  sel.innerHTML = parts.join('');
  if (keep && sel.querySelector(`option[value="${CSS.escape(keep)}"]`)) sel.value = keep;
}

function fillUnitSelects() {
  $('#kv_n_unit').innerHTML = Object.entries(NDW_UNITS).map(([k, u]) => `<option value="${k}">${unitLabel(u)}</option>`).join('');
  $('#kv_env_P_unit').innerHTML = Object.entries(PRESSURE_UNITS).map(([k, u]) => `<option value="${k}">${unitLabel(u)}</option>`).join('');
}

function fillCustomFields(saved) {
  $('#kv_cc_maker').value = saved?.cc_maker ?? '';
  $('#kv_cc_model').value = saved?.cc_model ?? '';
  $('#kv_cc_type').value = saved?.cc_type === 'cyl' ? 'cyl' : 'pp';
}

/** Демонстрационный набор на текущем языке (текстовые поля), числа одинаковые. */
const sampleData = () => (getLang() === 'en' ? { ...SAMPLE_KV, ...SAMPLE_KV_EN } : SAMPLE_KV);
const isDemo = (d) => [SAMPLE_KV.kv_institution, SAMPLE_KV_EN.kv_institution].includes(d.kv_institution) && [SAMPLE_KV.kv_machine, SAMPLE_KV_EN.kv_machine].includes(d.kv_machine);

// ------------------------------------------------------------ таблица качеств сертификата
const certList = () => $('#kv-cert-rows');

function renderCert(kvs, hvls, vals) {
  const n = Math.max(1, kvs?.length || 0, hvls?.length || 0, vals?.length || 0);
  const cell = (cls, key, i, v, label) =>
    `<input type="text" class="num ${cls}" inputmode="decimal" id="${key}_${i}" aria-label="${esc(label)}, ${L('качество', 'quality')} ${i + 1}" value="${esc(v ?? '')}">`;
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(`<div class="pair-row"><span class="pair-no">${i + 1}</span>${cell('cq-kv', 'kv_cq_kv', i, kvs?.[i], L('Напряжение, кВ', 'Voltage, kV'))}${cell('cq-hvl', 'kv_cq_hvl', i, hvls?.[i], L('СПО', 'HVL'))}${cell('cq-val', 'kv_cq_val', i, vals?.[i], L('Значение из сертификата', 'Certificate value'))}</div>`);
  }
  certList().innerHTML = rows.join('');
  $('#kv-cert-remove').disabled = n <= 1;
}

function readCert() {
  const col = (cls) => $$(`#kv-cert-rows .${cls}`).map((i) => i.value);
  return { kv: col('cq-kv'), hvl: col('cq-hvl'), val: col('cq-val') };
}

// ------------------------------------------------------------ форма ↔ данные
const seriesBox = (key) => $(`#kv-sheet .cells[data-series="${key}"]`);
const pairsBox = () => $('#kv_timer');

function readForm() {
  const data = {};
  for (const key of Object.keys(KV_DEFAULTS)) {
    if (key === 'protocol') data.protocol = 'trs';
    else if (key === 'kv_staff') data.kv_staff = readStaff($('#kv-staff-list'));
    else if (SERIES_KEYS.includes(key)) data[key] = readCells(seriesBox(key));
    else if (PAIR_KEYS.includes(key) || CERT_KEYS.includes(key)) continue;
    else {
      const el = document.getElementById(key);
      if (!el) continue;
      data[key] = el.type === 'checkbox' ? el.checked : el.value;
    }
  }
  const { a, b } = readPairs(pairsBox());
  data.kv_tt = a;
  data.kv_tm = b;
  const c = readCert();
  data.kv_cq_kv = c.kv;
  data.kv_cq_hvl = c.hvl;
  data.kv_cq_val = c.val;
  return data;
}

function writeForm(values) {
  const data = normalizeKv(values);
  if (String(data.kv_ch_model).startsWith('MY:') && !getMyChambers().some((c) => c.id === data.kv_ch_model)) data.kv_ch_model = 'CUSTOM';
  for (const [key, value] of Object.entries(data)) {
    if (key === 'protocol' || PAIR_KEYS.includes(key) || CERT_KEYS.includes(key)) continue;
    if (key === 'kv_staff') renderStaff($('#kv-staff-list'), value, update);
    else if (SERIES_KEYS.includes(key)) renderCells(seriesBox(key), value);
    else {
      const el = document.getElementById(key);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!value;
      else el.value = value ?? '';
    }
  }
  renderPairs(pairsBox(), data.kv_tt, data.kv_tm);
  renderCert(data.kv_cq_kv, data.kv_cq_hvl, data.kv_cq_val);
  localizeDecimals(ROOT());
}

// ------------------------------------------------------------ подписи по ветке расчёта
const nSym = (cal) => (cal === 'nk' ? 'K' : 'D,w');
const html = (el, s) => {
  if (el && el.innerHTML !== s) el.innerHTML = s;
};

/** Уравнение ветки: подсказка раздела 7. */
function eqHint(r) {
  const key = `${r.range}-${r.cal}`;
  const co = r.qo === 'co60';
  return {
    'low-ndw': L(
      'Ур. (52): D_w,z=0 = M_Q · N_D,w,Q · k_g — плоскопараллельная камера на поверхности фантома. k_g учитывает отличие поля и РИП от лабораторных; при тех же поле и РИП k_g = 1.',
      'Eq. (52): D_w,z=0 = M_Q · N_D,w,Q · k_g, with a plane-parallel chamber at the phantom surface. k_g corrects for the difference of the field and SSD from the laboratory ones; with the same field and SSD, k_g = 1.',
    ),
    'low-nk': L(
      'Ур. (50)–(51): D_w,z=0 = M_Q · N_K,Q · B_w · [μen/ρ]w,air FIA — камера в свободном воздухе на РИП. B_w — по кВ, СПО, полю и РИП, [μen/ρ]w,air — по СПО.',
      'Eqs (50)–(51): D_w,z=0 = M_Q · N_K,Q · B_w · [μen/ρ]w,air FIA, with the chamber free in air at the SSD. B_w depends on the kV, HVL, field and SSD; [μen/ρ]w,air on the HVL.',
    ),
    'medium-nk': L(
      'Ур. (57): D_w,z=2 = M_Q · N_K,Q · [μen/ρ]w,air z=2 · p_ch — цилиндрическая камера в воде на глубине 2 г/см². p_ch — по табл. 32.',
      'Eq. (57): D_w,z=2 = M_Q · N_K,Q · [μen/ρ]w,air z=2 · p_ch, with a cylindrical chamber in water at a depth of 2 g/cm². p_ch from Table 32.',
    ),
    'medium-ndw': co
      ? L(
          'DIN 6809-4: D_w,z=2 = M_Q · N_D,w(⁶⁰Co) · k_Q,M · k_z · k_g, k_z = 1 — не по TRS-398 Rev.1, результат помечается как нестандартный.',
          'DIN 6809-4: D_w,z=2 = M_Q · N_D,w(⁶⁰Co) · k_Q,M · k_z · k_g, k_z = 1. This is not TRS-398 Rev.1, and the result is flagged as non-standard.',
        )
      : L(
          'Ур. (58): D_w,z=2 = M_Q · N_D,w,Q · k_g — цилиндрическая камера в воде на глубине 2 г/см². k_g по ур. (90): отношение [μen/ρ]w,air z=2 для поля и РИП клиники и лаборатории.',
          'Eq. (58): D_w,z=2 = M_Q · N_D,w,Q · k_g, with a cylindrical chamber in water at a depth of 2 g/cm². k_g by Eq. (90): the ratio of [μen/ρ]w,air z=2 for the clinical and laboratory field and SSD.',
        ),
  }[key];
}

function readingsHint(r) {
  const where =
    r.range === 'medium'
      ? L('Цилиндрическая камера в воде, центр полости на глубине 2 г/см², поле на поверхности воды.', 'Cylindrical chamber in water, the cavity center at a depth of 2 g/cm², the field defined at the water surface.')
      : r.cal === 'nk'
        ? L('Камера в свободном воздухе, опорная точка — на РИП, без фантома и других рассеивателей рядом.', 'Chamber free in air, the reference point at the SSD, with no phantom or other scattering material nearby.')
        : L('Плоскопараллельная камера на поверхности фантома (ПММА или водоэквивалентного), опорная точка — на РИП.', 'Plane-parallel chamber at the surface of a PMMA or water-equivalent phantom, the reference point at the SSD.');
  return `${where} ${L('Все серии — при одном задании из раздела 3; значения можно вводить со знаком или без. Кнопка «+» добавляет ячейку.', 'All series at the same setting from section 3; values may be entered with or without a sign. The "+" button adds a cell.')}`;
}

function kgSourceText(kg) {
  switch (kg?.source) {
    case 'same': return L('поле и РИП как в лаборатории: k_g = 1', 'field and SSD as at the laboratory: k_g = 1');
    case 'table': return L(`табл. ${kg.table}: по ln(СПО) между качествами TW, по полю — между строками`, `Table ${kg.table}: by ln(HVL) between the TW qualities, by field between rows`);
    case 'eq90': return L('ур. (90): [μen/ρ]z=2 клиники / лаборатории по данным Andreo', 'Eq. (90): clinical / laboratory [μen/ρ]z=2 from the Andreo data');
    case 'eq85': return L('ур. (85): отношение N_K^PMMA × отношение B_w', 'Eq. (85): N_K^PMMA ratio × B_w ratio');
    case 'lab': return L('значение лаборатории', 'laboratory value');
    case 'one': return L('принят равным 1 — не по TRS-398 Rev.1', 'taken as 1, not TRS-398 Rev.1');
    default: return '';
  }
}

function applyVisibility(data, result) {
  applyShowRules(ROOT(), data, 'trs');
  const low = result.range === 'low';
  const mat = result.material;
  const co = result.qo === 'co60';
  const unit = result.inputs.unitLabel;
  const rate = result.trs.rateLabel;
  const windowMode = data.kv_timer_mode === 'window';
  const timeSet = data.kv_set_unit === 'min' || data.kv_set_unit === 's';

  $('#kv-lbl-hvl').textContent = L(`СПО, мм ${mat}`, `HVL, mm ${mat}`);
  $('#kv-lbl-cq-hvl').textContent = L(`СПО, мм ${mat}`, `HVL, mm ${mat}`);
  $('#kv-lbl-cone').textContent = data.kv_cone_shape === 'square' ? L('Сторона поля, см', 'Field side, cm') : L('Диаметр поля, см', 'Field diameter, cm');
  $('#kv-lbl-lab-f').textContent = data.kv_lab_shape === 'square' ? L('Сторона, см', 'Side, cm') : L('Диаметр, см', 'Diameter, cm');

  // камера
  const c = result.chamber;
  const id = String(data.kv_ch_model);
  $('#kv-custom-chamber').hidden = !(id === 'CUSTOM' || id.startsWith('MY:'));
  $('#kv-btn-del-chamber').hidden = !id.startsWith('MY:');
  const info = [];
  if (c && !c.custom) {
    info.push(c.type === 'pp' ? L('плоскопараллельная', 'plane-parallel') : L('цилиндрическая', 'cylindrical'));
    info.push(L(`${volText(c.volume)} см³`, `${volText(c.volume)} cm³`));
    if (c.type === 'pp') info.push(c.table7 ? L('TRS-398, табл. 7', 'TRS-398, Table 7') : L('нет в табл. 7 TRS-398', 'not in TRS-398 Table 7'));
    if (c.kgTable) info.push(L(`k_g — табл. ${c.kgTable === 'T28' ? 28 : 29}`, `k_g: Table ${c.kgTable === 'T28' ? 28 : 29}`));
    if (c.pch) info.push(L('p_ch — табл. 32', 'p_ch: Table 32'));
  }
  html($('#kv-chamber-info'), richText(info.join(' · ')));
  $('#kv-foil-field').hidden = !(c && c.type === 'pp');

  // сертификат
  const ns = nSym(result.cal);
  const form = data.kv_cert_form;
  html($('#kv-lbl-n'), form === 'k' ? L('N<sub>Д</sub>', 'N<sub>D</sub>') : `N<sub>${ns},Qo</sub>`);
  html(
    $('#kv-n-sub'),
    richText(
      form === 'k'
        ? L('из протокола поверки; N_Q = N_Д · K(СПО)', 'from the calibration report; N_Q = N_D · K(HVL)')
        : co
          ? L('в пучке ⁶⁰Co на глубине 5 см', 'in the ⁶⁰Co beam at a depth of 5 cm')
          : L('при опорном качестве Qo; N_Q = N_Qo · k_Q(СПО)', 'at the reference quality Qo; N_Q = N_Qo · k_Q(HVL)'),
    ),
  );
  html($('#kv-lbl-cq-val'), form === 'n' ? `N<sub>${ns}</sub>` : form === 'k' ? 'K' : co ? 'k<sub>Q,M</sub>' : 'k<sub>Q</sub>');
  html(
    $('#kv-lbl-cert-value'),
    form === 'n' ? L(`N<sub>${ns}</sub> для пучка (единицы таблицы)`, `N<sub>${ns}</sub> for the beam (table units)`) : form === 'k' ? L('K для пучка', 'K for the beam') : L('k<sub>Q</sub> для пучка', 'k<sub>Q</sub> for the beam'),
  );
  html($('#kv-lbl-nq'), L(`N<sub>${ns},Q</sub>, Гр/нКл`, `N<sub>${ns},Q</sub>, Gy/nC`));
  html(
    $('#kv-cert-note'),
    richText(
      L(
        `Строка — качество из сертификата: напряжение (для записи), СПО в мм ${mat} и значение. Порядок строк любой. СПО пучка должен лежать между крайними качествами, иначе значение экстраполируется по ln(СПО) с предупреждением.${form === 'k' ? ' K заменяет k_Q: N_Q = N_Д · K.' : ''}`,
        `Each row is a quality from the certificate: the voltage (for the record), the HVL in mm ${mat} and the value. Rows may be in any order. The beam HVL should lie between the outermost qualities; otherwise the value is extrapolated in ln(HVL) with a warning.${form === 'k' ? ' K replaces k_Q: N_Q = N_D · K.' : ''}`,
      ),
    ),
  );
  html(
    $('#kv-lab-hint'),
    richText(
      co
        ? L('Поле и РИП, при которых измерены k_Q,M рентгеновских качеств (DIN 6809-4): по ним считается k_g (раздел 7).', 'The field and SSD at which the x-ray k_Q,M were measured (DIN 6809-4): k_g is calculated from them (section 7).')
        : L('Поле и РИП, при которых получены коэффициенты сертификата: если клинические другие, нужна поправка k_g (раздел 7).', 'The field and SSD at which the certificate coefficients were obtained: if the clinical ones differ, a k_g correction is needed (section 7).'),
    ),
  );

  // задание облучения и таймер
  $('#kv-lbl-set').textContent = windowMode ? L('Время накопления заряда', 'Charge collection time') : L('Задание облучения', 'Exposure setting');
  $('#kv-set-sub').textContent = windowMode ? L('интервал, на котором электрометр накапливал заряд', 'the interval over which the electrometer collected charge') : L('одно и то же для всех серий показаний в разделе 4', 'the same for all reading series in section 4');
  $('#kv-lbl-timer-mode').textContent = timeSet ? L('Ошибка таймера τ', 'Timer error τ') : L('Концевой эффект τ', 'End effect τ');
  $('#kv-lbl-tau').textContent = `τ, ${unit}`;
  $('#kv-lbl-tt').textContent = L(`Задание, ${unit}`, `Setting, ${unit}`);
  $('#kv-lbl-nxt').textContent = L(`Задание одиночного облучения X, ${unit}`, `Single exposure setting X, ${unit}`);
  $('#kv-lbl-ctrl-set').textContent = windowMode ? L(`Время накопления заряда, ${unit}`, `Charge collection time, ${unit}`) : L(`Задание облучения, ${unit}`, `Exposure setting, ${unit}`);
  const winOpt = $('#kv_timer_mode option[value="window"]');
  if (winOpt) winOpt.disabled = !timeSet && !windowMode;

  // показания
  $('#kv-readings-hint').textContent = readingsHint(result);

  // раздел 7
  html($('#kv-eq-hint'), richText(eqHint(result)));
  const autoOpt = $('#kv_kg_src option[value="auto"]');
  autoOpt.textContent = low ? L('по табл. 28–29 TRS-398 Rev.1 (PTW 23342, 23344)', 'by TRS-398 Rev.1 Tables 28–29 (PTW 23342, 23344)') : L('по ур. (90) TRS-398 Rev.1 (данные Andreo)', 'by TRS-398 Rev.1 Eq. (90) (Andreo data)');
  const eq85 = $('#kv_kg_src option[value="eq85"]');
  eq85.hidden = !low;
  eq85.disabled = !low;
  const kg = result.trs.kg;
  html($('#kv-kg-sub'), richText(kgSourceText(kg)));
  $('#kv-kg-bykv').hidden = kg.source !== 'table';
  $('#kv-kg-spread').hidden = kg.source !== 'table';
  $('#kv-kg-bw').hidden = kg.source !== 'eq85';
  $('#kv-pch-field').hidden = !(result.range === 'medium' && result.cal === 'nk' && c && !c.pch);
  const ph = result.trs.phys;
  html($('#kv-muen-sub'), low ? L('FIA, по СПО', 'FIA, by HVL') : L('на 2 см, по кВ, СПО, полю и РИП', 'at 2 cm, by kV, HVL, field and SSD'));
  html($('#kv-pch-sub'), ph.pchSource === 'table32' ? L('табл. 32, по ln(СПО)', 'Table 32, by ln(HVL)') : ph.pchSource === 'manual' ? L('введён вручную', 'entered manually') : '');
  const std = c?.type === 'cyl' ? 5 : 10;
  html($('#kv-nkfs-sub'), L(`стандартное поле — Ø ${std} см; для другого поля — рис. 11 TRS-398 или от лаборатории; пусто — 1`, `standard field: ${std} cm diameter; for another field, from TRS-398 Fig. 11 or the laboratory; empty means 1`));
  $('#kv-lbl-surf').textContent = L(`На поверхности, ${rate}`, `At the surface, ${rate}`);
  $('#kv-lbl-ref').textContent = L(`Значение для сравнения, ${rate}`, `Comparison value, ${rate}`);

  // справочное сравнение с другим протоколом
  html($('#kv-pc-hint'), symText(pcHint(result)));
  $('#kv-tg61-pq-field').hidden = !(result.range === 'medium' && result.cal === 'nk' && c && (c.custom || !TG61_T8_CHAMBER[c.id]));
  renderPcTable(result);
}

// ------------------------------------------------------------ справочное сравнение (TG-61, DIN 6809-4, SSRMP No 9)
/** Короткое имя сравниваемого протокола для заголовков. */
const pcShort = (cmp) => cmp.short;
/** Текст с символами: X_abc — нижний индекс, [μen/ρ]w,air — с индексами. */
const symText = (t) => richText(t).replace(/\[μen\/ρ\]w,air/g, '[μ<sub>en</sub>/ρ]<sub>w,air</sub>');

/** Что и как сравнивается в текущей ветке. */
function pcHint(r) {
  if (r.cal === 'nk' && r.range === 'low') {
    return L(
      'Ветка N_K сравнивается с AAPM TG-61, методом в воздухе (ур. 3): D = M · N_K · B_w · P_stem,air · [μen/ρ]w,air; B_w — табл. V (Grosswendt), [μen/ρ]w,air — табл. IV.',
      'The N_K branch is compared with AAPM TG-61, the in-air method (Eq. 3): D = M · N_K · B_w · P_stem,air · [μen/ρ]w,air; B_w from Table V (Grosswendt), [μen/ρ]w,air from Table IV.',
    );
  }
  if (r.cal === 'nk') {
    return L(
      'Ветка N_K сравнивается с AAPM TG-61, методом в фантоме на 2 см (ур. 4): D = M · N_K · P_Q,cham · P_sheath · [μen/ρ]w,air; [μen/ρ]w,air на 2 см — табл. VII, P_Q,cham — табл. VIII, P_sheath — табл. IX.',
      'The N_K branch is compared with AAPM TG-61, the in-phantom method at 2 cm (Eq. 4): D = M · N_K · P_Q,cham · P_sheath · [μen/ρ]w,air; [μen/ρ]w,air at 2 cm from Table VII, P_Q,cham from Table VIII, P_sheath from Table IX.',
    );
  }
  return L(
    `Ветка N_D,w сравнивается с ${r.qo === 'co60' ? 'DIN 6809-4' : 'DIN 6809-4 и SSRMP No 9'}: D = M · N_D,w,Q без поправки на поле и РИП (k_g = 1). У TG-61 варианта для N_D,w нет.`,
    `The N_D,w branch is compared with ${r.qo === 'co60' ? 'DIN 6809-4' : 'DIN 6809-4 and SSRMP No 9'}: D = M · N_D,w,Q with no field and SSD correction (k_g = 1). TG-61 has no N_D,w variant.`,
  );
}

/** Таблица пар множителей «протокол — Rev.1» в разделе 7. */
function renderPcTable(r) {
  const table = $('#kv-pc-table');
  const cmp = r.compare;
  if (!cmp?.kind) {
    html(table, '');
    return;
  }
  if (!cmp.rows.length) {
    html(table, `<tbody><tr><td>${L('Сравнение не посчитано', 'Comparison not calculated')}: ${richText(cmp.reason ?? '—')}.</td></tr></tbody>`);
    return;
  }
  const cell = (v, src) => `<td class="v">${Number.isFinite(v) ? fmt(v, 4) : '—'}<span class="src">${richText(src)}</span></td>`;
  const rows = cmp.rows.map((x) => `<tr><td>${richText(x.label)} <i>${symText(x.sym)}</i></td>${cell(x.cmp, x.cmpSrc)}${cell(x.rev1, x.rev1Src)}</tr>`).join('');
  const total = `<tr class="total"><td>${L(`Отношение доз ${pcShort(cmp)} / Rev.1`, `Dose ratio ${pcShort(cmp)} / Rev.1`)}</td><td class="v" colspan="2">${fmt(cmp.ratio, 4)} (${fmtSigned(cmp.diffPct, 2)} %)</td></tr>`;
  const notes = cmp.notes.map((n) => `<tr><td colspan="3" class="note">${richText(n)}</td></tr>`).join('');
  html(table, `<thead><tr><th>${L('Множитель', 'Factor')}</th><th>${esc(pcShort(cmp))}</th><th>${PROTO_NAME}</th></tr></thead><tbody>${rows}${total}${notes}</tbody>`);
}

/** Справочная строка под итогом: доза по сравниваемому протоколу и отличие от Rev.1. */
function protoCmpRow(result) {
  const cmp = result.compare;
  const x = result.trs;
  const p = primaryOf(x);
  const none = x.blocked || ctrlFailed(x);
  const zTxt = result.range === 'low' ? L('на поверхности', 'at the surface') : L('на 2 г/см²', 'at 2 g/cm²');
  const head = `${L('Справочно', 'For reference')} · ${cmp.title}`;
  if (none || !cmp.available) {
    const why = none ? L('итога по TRS-398 Rev.1 нет — сравнивать не с чем', 'there is no TRS-398 Rev.1 result to compare with') : L(`не посчитано: ${cmp.reason}`, `not calculated: ${cmp.reason}`);
    return `<div class="proto"><span>${richText(head)}</span></div><div class="secondary">${richText(why)}</div>`;
  }
  const chip = `<span class="chip" title="${L('Отличие от итога по TRS-398 Rev.1', 'Difference from the TRS-398 Rev.1 result')}">${fmtSigned(cmp.diffPct, 2)} %</span>`;
  return `<div class="proto"><span>${richText(head)}</span>${chip}</div>
    <div class="ref-value">${fmt(p.perUnit * cmp.ratio, 4)}<small>${x.rateLabel} ${zTxt}</small></div>
    <div class="secondary">${L('отличие от Rev.1 — в разделе 7; на итог не влияет', 'the difference from Rev.1 is broken down in section 7; does not affect the result')}</div>`;
}

// ------------------------------------------------------------ вывод
/** Итог: по контрольным измерениям, если они введены и без ошибок, иначе по основным показаниям. */
const primaryOf = (x) => (x.ctrl && !x.ctrl.blocked && !x.blocked ? x.ctrl : x);
/** Контрольные измерения введены, но с ошибками: итога нет. */
const ctrlFailed = (x) => !x.blocked && !!x.ctrl?.blocked;
/** Средние энергии: итог на поверхности, если значение для сравнения задано там и введена PDD(2 см). */
const atSurfOf = (p, r) => r.range === 'medium' && r.cmp.at === 'surface' && Number.isFinite(p.perUnitSurf);
const valueAt = (p, r) => (atSurfOf(p, r) ? p.perUnitSurf : p.perUnit);
const whereText = (r, atSurf) => (r.range === 'low' || atSurf ? L('на поверхности', 'at the surface') : L('на 2 г/см²', 'at 2 g/cm²'));
const setText = (r, X) => `${Number.isFinite(X) ? fmt(X, X % 1 ? 2 : 0) : '—'} ${r.inputs.unitLabel}`;

/** Итог для сохранения в файл и сверки при открытии файла. */
function snapshot(result) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const x = result.trs;
  if (x.blocked || ctrlFailed(x)) return { protocol: 'trs', value: null };
  const p = primaryOf(x);
  return {
    protocol: 'trs',
    source: p === x.ctrl ? 'ctrl' : 'main',
    unit: result.inputs.unit,
    value: num(valueAt(p, result)),
    perUnit: num(p.perUnit),
    perUnitSurf: num(p.perUnitSurf),
    D: num(p.D),
    deviation: num(p.deviation),
    compliance: result.compliance?.status ?? null,
  };
}
const snapCmp = (result) => ({ keys: ['value', 'perUnit', 'D'], main: 'value', digits: 4, unit: result.trs.rateLabel });

/** Метод расчёта для подписи итога: уравнение TRS-398 Rev.1 или DIN 6809-4 при Qo = ⁶⁰Co. */
const methodText = (r) => (r.qo === 'co60' ? L('DIN 6809-4, Qo = ⁶⁰Co (не TRS-398 Rev.1)', 'DIN 6809-4, Qo = ⁶⁰Co (not TRS-398 Rev.1)') : `${PROTO_NAME}, ${r.trs.equation}`);

function doseRow(result) {
  const x = result.trs;
  const p = primaryOf(x);
  const fromCtrl = p !== x;
  const failed = ctrlFailed(x);
  const none = x.blocked || failed;
  const atSurf = atSurfOf(p, result);
  const main = valueAt(p, result);
  const unit = x.rateLabel;
  const where = whereText(result, atSurf);
  let chip = '';
  if (Number.isFinite(p.deviation) && !none) {
    const tol = result.cmp.tolerance;
    const cls = Math.abs(p.deviation) <= tol / 2 ? 'good' : Math.abs(p.deviation) > tol ? 'bad' : '';
    chip = `<span class="chip ${cls}" title="${L('Отклонение от значения для сравнения', 'Deviation from the comparison value')}">${fmtSigned(p.deviation, 2)} %</span>`;
  }
  const i = result.inputs;
  const X = fromCtrl ? result.ctrl.X : i.X;
  const Xe = fromCtrl ? result.ctrl.Xeff : i.Xeff;
  const xTxt = `${setText(result, X)}${result.timer.mode === 'window' ? '' : ` (X + τ = ${fmt(Xe, 3)})`}`;
  const zTxt = result.range === 'low' ? L('на поверхности', 'at the surface') : L('на 2 г/см²', 'at 2 g/cm²');
  const secondary = [
    L(`D<sub>w</sub> ${zTxt} = ${fmt(p.DcGy, 2)} сГр = ${fmt(p.D, 4)} Гр за ${xTxt}`, `D<sub>w</sub> ${zTxt} = ${fmt(p.DcGy, 2)} cGy = ${fmt(p.D, 4)} Gy in ${xTxt}`),
    Number.isFinite(p.perUnitSurf)
      ? atSurf
        ? L(`На 2 г/см²: ${fmt(p.perUnit, 4)} ${unit}`, `At 2 g/cm²: ${fmt(p.perUnit, 4)} ${unit}`)
        : L(`На поверхности (через PDD): ${fmt(p.perUnitSurf, 4)} ${unit}`, `At the surface (via PDD): ${fmt(p.perUnitSurf, 4)} ${unit}`)
      : null,
    fromCtrl ? null : L('Контрольные измерения не введены — по показанию M₁ раздела 4', 'No check measurements entered — from reading M₁ of section 4'),
  ].filter(Boolean).join('<br>');
  return `<div class="dose-row ${none ? 'blocked' : ''}">
    <div class="proto"><span>${esc(methodText(result))}${fromCtrl || failed ? L(' · контрольные измерения', ' · check measurements') : ''}</span>${chip}</div>
    <div class="dose-big">${none || !Number.isFinite(main) ? '—' : fmt(main, 4)}<small>${unit} ${where}</small></div>
    <div class="secondary">${x.blocked ? L('Исправьте ошибки из списка замечаний', 'Correct the errors listed under Messages') : failed ? ctrlErrorText(6, 4) : secondary}</div>
  </div>`;
}

function renderReadout(result, data) {
  const x = result.trs;
  $('#kv-dose-rows').innerHTML = doseRow(result);
  const pc = $('#kv-proto-cmp');
  pc.hidden = !result.compare?.kind;
  if (result.compare?.kind) html(pc, protoCmpRow(result));
  renderCompliance($('#kv-compliance'), result.compliance, PROTO_NAME);

  const nr = $('#kv-notrev1-flag');
  nr.hidden = !result.notRev1.length;
  if (result.notRev1.length) html(nr, richText(L(`Расчёт не по TRS-398 Rev.1: ${result.notRev1.join('; ')}. Результат — не референсная дозиметрия по TRS-398 Rev.1.`, `Calculation not according to TRS-398 Rev.1: ${result.notRev1.join('; ')}. The result is not reference dosimetry per TRS-398 Rev.1.`)));
  const cite = $('#kv-andreo-cite');
  cite.hidden = !result.andreo.citation;
  if (result.andreo.citation) html(cite, `B<sub>w</sub>, [μ<sub>en</sub>/ρ]<sub>w,air</sub>: ${esc(result.andreo.citation)}`);

  const p = primaryOf(x);
  const none = x.blocked || ctrlFailed(x);
  const atSurf = atSurfOf(p, result);
  const mv = $('#kv-mobile-value');
  if (!none && x.ok) {
    mv.innerHTML = `kV: <b>${fmt(valueAt(p, result), 4)}</b> ${x.rateLabel}${Number.isFinite(p.deviation) ? ` (${fmtSigned(p.deviation, 2)} %)` : ''}`;
  } else {
    const n = result.messages.filter((m) => m.level === 'error').length;
    mv.textContent = n ? L(`Ошибок: ${n}`, `Errors: ${n}`) : '—';
  }

  // строка итога в разделах 4 и 6 — те же числа, что в окне результата
  setInlineResult(ROOT(), inlineResultHtml({
    value: none ? NaN : valueAt(p, result),
    digits: 4,
    unit: x.rateLabel,
    where: whereText(result, atSurf),
    deviation: p.deviation,
    tol: result.cmp.tolerance,
    devLabel: L('от значения для сравнения', 'from the comparison value'),
    source: p !== x
      ? L('по контрольным измерениям (раздел 6)', 'from the check measurements (section 6)')
      : L('по показанию M₁ раздела 4 (контрольные измерения не введены)', 'from reading M₁ of section 4 (no check measurements entered)'),
    errors: result.messages.filter((m) => m.level === 'error').length,
    failedText: ctrlFailed(x) ? L('не посчитан — ошибки в контрольных измерениях (раздел 6)', 'not calculated: errors in the check measurements (section 6)') : '',
  }));

  const lvlName = { error: L('Ошибка', 'Error'), warn: L('Внимание', 'Warning'), info: L('Справка', 'Note') };
  const scopeName = { common: '', trs: '', depth: L('Пересчёт на поверхность · ', 'Transfer to the surface · '), ctrl: L('Контрольные измерения · ', 'Check measurements · ') };
  const list = result.messages;
  $('#kv-messages').innerHTML = list.length
    ? list.map((m) => `<li class="${m.level}"><span class="lvl">${scopeName[m.scope] ?? ''}${lvlName[m.level]}</span><span>${richText(m.text)}</span>${m.ref ? `<span class="ref">${esc(refText(m.ref))}</span>` : ''}</li>`).join('')
    : `<li class="info"><span class="lvl">${L('Всё в порядке', 'All clear')}</span><span>${L('Замечаний к введённым данным нет.', 'No issues with the entered data.')}</span></li>`;

  // таблица поправок
  const c = result.cert;
  const ns = nSym(result.cal);
  const ph = x.phys;
  const rows = [
    [L('Температура и давление', 'Temperature and pressure'), 'k<sub>TP</sub>', x.kTP, 4],
    [L('Электрометр', 'Electrometer'), 'k<sub>elec</sub>', x.kelec, 4],
    [L('Полярность', 'Polarity'), 'k<sub>pol</sub>', x.kpol, 4],
    [L('Рекомбинация', 'Recombination'), 'k<sub>s</sub>', x.ks, 4],
    [L('Утечка', 'Leakage'), 'k<sub>leak</sub>', x.kleak, 4],
  ];
  if (data.kv_cert_form !== 'n') {
    rows.push([data.kv_cert_form === 'k' ? L('N<sub>Д</sub> из сертификата, Гр/нКл', 'N<sub>D</sub> from the certificate, Gy/nC') : L(`N<sub>${ns},Qo</sub> из сертификата, Гр/нКл`, `N<sub>${ns},Qo</sub> from the certificate, Gy/nC`), '', c.base, 6]);
  }
  rows.push([
    data.kv_cert_form === 'n' ? L(`N<sub>${ns}</sub> для СПО пучка (единицы таблицы)`, `N<sub>${ns}</sub> at the beam HVL (table units)`) : data.kv_cert_form === 'k' ? L('K для СПО пучка', 'K at the beam HVL') : L('k<sub>Q</sub> для СПО пучка', 'k<sub>Q</sub> at the beam HVL'),
    '', c.value, data.kv_cert_form === 'n' ? 6 : 4,
  ]);
  rows.push([L(`N<sub>${ns},Q</sub>, Гр/нКл`, `N<sub>${ns},Q</sub>, Gy/nC`), '', c.NQ, 6]);
  if (result.cal === 'ndw') {
    rows.push([L('Поле и РИП', 'Field and SSD'), 'k<sub>g</sub>', x.kg.value, 4]);
    if (result.qo === 'co60') rows.push([L('Глубина калибровки', 'Calibration depth'), 'k<sub>z</sub>', c.kz, 3]);
  } else if (result.range === 'low') {
    rows.push([L('Отношение коэффициентов поглощения энергии', 'Mass energy-absorption coefficient ratio'), '[μ<sub>en</sub>/ρ]<sub>w,air</sub>', ph.muen, 4]);
    rows.push([L('Обратное рассеяние', 'Backscatter'), 'B<sub>w</sub>', ph.bw, 4]);
    rows.push([L('Поправка N<sub>K</sub> на размер поля', 'N<sub>K</sub> field-size correction'), '', ph.nkFs, 4]);
  } else {
    rows.push([L('Отношение коэффициентов поглощения энергии на 2 см', 'Mass energy-absorption coefficient ratio at 2 cm'), '[μ<sub>en</sub>/ρ]<sub>w,air</sub>', ph.muen, 4]);
    rows.push([L('Камера в фантоме', 'Chamber in phantom'), 'p<sub>ch</sub>', ph.pch, 4]);
  }
  const ctrlOn = result.ctrl.on;
  const tc = x.ctrl || {};
  const bC = x.blocked || !!tc.blocked;
  const ctrlFinal = ctrlOn && x.ctrl && !bC;
  const i = result.inputs;
  const title = doseGroupTitle({ ctrlOn, ctrlFinal, mainSec: 4, ctrlSec: 6, mainAmount: setText(result, i.X), ctrlAmount: setText(result, result.ctrl.X) });
  rows.push([title, '', NaN, 0, 'group']);
  const y = ctrlOn ? tc : x;
  const blocked = ctrlOn ? bC : x.blocked;
  const zTxt = result.range === 'low' ? L('на поверхности', 'at the surface') : L('на 2 г/см²', 'at 2 g/cm²');
  rows.push([rawReadingLabel(), '', ctrlOn ? result.ctrl.mean : Math.abs(i.M1.mean), 4]);
  rows.push([correctedReadingLabel(), 'M', y.M, 4, '', true]);
  rows.push([L(`D<sub>w</sub> ${zTxt} за облучение, сГр`, `D<sub>w</sub> ${zTxt} per exposure, cGy`), '', y.DcGy, 2, '', true]);
  rows.push([L(`D<sub>w</sub> ${zTxt} за облучение, Гр`, `D<sub>w</sub> ${zTxt} per exposure, Gy`), '', y.D, 4, '', true]);
  rows.push([`X + τ, ${i.unitLabel}`, '', ctrlOn ? result.ctrl.Xeff : i.Xeff, 4]);
  rows.push([`${zTxt[0].toUpperCase()}${zTxt.slice(1)}, ${x.rateLabel}`, '', y.perUnit, 4, atSurf ? '' : 'total', true]);
  if (result.depth.on) {
    rows.push([L('PDD(2 см), %', 'PDD(2 cm), %'), '', result.depth.pdd, 1]);
    rows.push([L(`На поверхности, ${x.rateLabel}`, `At the surface, ${x.rateLabel}`), '', y.perUnitSurf, 4, atSurf ? 'total' : '', true]);
  }
  $('#kv-factors').innerHTML =
    `<thead><tr><th>${L('Величина', 'Quantity')}</th><th>${PROTO_NAME}</th></tr></thead><tbody>` +
    rows
      .map(([label, sym, v, d, cls, dose]) =>
        cls === 'group'
          ? `<tr class="group"><td colspan="2">${label}</td></tr>`
          : `<tr class="${cls || ''}"><td>${label}</td><td class="v">${sym ? `<i>${sym}</i> ` : ''}${dose && blocked ? '—' : fmt(v, d)}</td></tr>`,
      )
      .join('') +
    '</tbody>';
}

// ------------------------------------------------------------ протокол текстом
function reportText(data, r) {
  const out = [];
  const line = (k, v) => out.push(`${k}: ${v}`);
  const cells = (a) => (Array.isArray(a) ? a.filter((s) => String(s).trim() !== '').join('; ') : a);
  const i = r.inputs;
  const x = r.trs;
  const mat = r.material;
  const ns = r.cal === 'nk' ? 'N_K' : 'N_D,w';
  const plain = (s) => String(s).replace(/<\/?su[bp]>/g, '');
  out.push(L('ПРОТОКОЛ РЕФЕРЕНСНОЙ ДОЗИМЕТРИИ — kV-РЕНТГЕН', 'REFERENCE DOSIMETRY REPORT — kV X-RAYS'));
  line(L('Протокол', 'Protocol'), `${methodText(r)}${r.qo === 'co60' ? '' : r.range === 'low' ? L(' (разд. 8, низкие энергии)', ' (Sec. 8, low energies)') : L(' (разд. 9, средние энергии)', ' (Sec. 9, medium energies)')}`);
  if (r.notRev1.length) line(L('Не по TRS-398 Rev.1', 'Not TRS-398 Rev.1'), r.notRev1.join('; '));
  line(L('Калькулятор', 'Calculator'), versionText());
  line(L('Учреждение', 'Institution'), data.kv_institution || '—');
  line(L('Аппарат', 'Machine'), data.kv_machine || '—');
  line(L('Дата', 'Date'), data.kv_date || '—');
  line(L('Измерения выполнили', 'Measured by'), data.kv_staff.filter((s) => s.trim()).join(', ') || '—');
  line(L('Пучок', 'Beam'), L(`${data.kv_kv || '—'} кВ, СПО ${data.kv_hvl || '—'} мм ${mat}${data.kv_filter ? `, фильтр ${data.kv_filter}` : ''}`, `${data.kv_kv || '—'} kV, HVL ${data.kv_hvl || '—'} mm ${mat}${data.kv_filter ? `, filter ${data.kv_filter}` : ''}`));
  const sq = data.kv_cone_shape === 'square';
  const coneTxt = sq
    ? L(`квадратный тубус ${data.kv_cone || '—'} см (круг той же площади Ø ${fmt(i.fClin, 2)} см)`, `square applicator ${data.kv_cone || '—'} cm (circle of equal area, ${fmt(i.fClin, 2)} cm diameter)`)
    : L(`тубус Ø ${data.kv_cone || '—'} см`, `applicator ${data.kv_cone || '—'} cm diameter`);
  line(L('Геометрия', 'Geometry'), L(`${coneTxt}, РИП ${data.kv_ssd || '—'} см${r.range === 'medium' && data.kv_cone_largest ? ', самый большой тубус аппарата' : ''}; ${r.range === 'low' ? 'доза на поверхности' : 'доза на глубине 2 г/см² в воде'}`, `${coneTxt}, SSD ${data.kv_ssd || '—'} cm${r.range === 'medium' && data.kv_cone_largest ? ', largest applicator of the unit' : ''}; ${r.range === 'low' ? 'dose at the surface' : 'dose at a depth of 2 g/cm² in water'}`));
  out.push('');
  line(L('Камера', 'Chamber'), `${r.chamber ? `${r.chamber.label} (${r.chamber.type === 'pp' ? L('плоскопараллельная', 'plane-parallel') : L('цилиндрическая', 'cylindrical')})` : '—'}, ${L('№', 'S/N')} ${data.kv_ch_serial || '—'}${r.chamber?.type === 'pp' && data.kv_foil ? L(', с фольгой 0,2 мм', ', with a 0.2 mm foil') : ''}`);
  const unitN = unitLabel(NDW_UNITS[data.kv_n_unit]);
  const formTxt =
    data.kv_cert_form === 'k'
      ? L(`N_Д = ${data.kv_n} ${unitN}, множитель K по качествам`, `N_D = ${data.kv_n} ${unitN}, multiplier K per quality`)
      : data.kv_cert_form === 'n'
        ? L(`${ns} по качествам, ${unitN}`, `${ns} per quality, ${unitN}`)
        : L(`${ns},Qo = ${data.kv_n} ${unitN}${r.qo === 'co60' ? ' (⁶⁰Co, 5 см)' : ''}, k_Q по качествам`, `${ns},Qo = ${data.kv_n} ${unitN}${r.qo === 'co60' ? ' (⁶⁰Co, 5 cm)' : ''}, k_Q per quality`);
  line(L('Сертификат', 'Certificate'), formTxt);
  // как введено в таблицу (с теми же знаками), по возрастанию СПО
  const raw = (key, q) => String(data[key][q.row - 1] ?? '').trim();
  const qs = r.cert.rows?.map((q) => `${raw('kv_cq_kv', q) ? L(`${raw('kv_cq_kv', q)} кВ / `, `${raw('kv_cq_kv', q)} kV / `) : ''}${raw('kv_cq_hvl', q)} ${L('мм', 'mm')} ${mat} → ${raw('kv_cq_val', q)}`).join('; ');
  if (qs) line(L('Качества сертификата', 'Certificate qualities'), qs);
  const valName = data.kv_cert_form === 'k' ? 'K' : data.kv_cert_form === 'n' ? ns : 'k_Q';
  line(L('Для СПО пучка', 'At the beam HVL'), `${valName} = ${fmt(r.cert.value, data.kv_cert_form === 'n' ? 6 : 4)}; ${ns},Q = ${fmt(r.cert.NQ, 6)} ${L('Гр/нКл', 'Gy/nC')}${r.cert.interp?.extrapolated ? L(' (экстраполяция)', ' (extrapolated)') : ''}`);
  if (r.cal === 'ndw') {
    const labTxt = data.kv_lab_shape === 'square' ? L(`квадратное поле ${data.kv_lab_f || '—'} см`, `square field ${data.kv_lab_f || '—'} cm`) : L(`поле Ø ${data.kv_lab_f || '—'} см`, `field ${data.kv_lab_f || '—'} cm diameter`);
    line(L('Калибровка в лаборатории', 'Laboratory calibration'), L(`${labTxt}, РИП ${data.kv_lab_ssd || '—'} см`, `${labTxt}, SSD ${data.kv_lab_ssd || '—'} cm`));
  }
  line(L('Стандартные условия', 'Reference conditions'), L(`T0 = ${data.kv_T0} °C, P0 = ${data.kv_P0} кПа`, `T0 = ${data.kv_T0} °C, P0 = ${data.kv_P0} kPa`));
  line(L('Электрометр', 'Electrometer'), `${data.kv_el_model || '—'}, ${L('№', 'S/N')} ${data.kv_el_serial || '—'}, k_elec = ${data.kv_kelec}`);
  line(L('Условия', 'Conditions'), `T = ${data.kv_env_T} °C, P = ${data.kv_env_P} ${unitLabel(PRESSURE_UNITS[data.kv_env_P_unit])}${String(data.kv_env_H ?? '').trim() ? L(`, относительная влажность ${data.kv_env_H} %`, `, relative humidity ${data.kv_env_H} %`) : ''}`);
  const tm = r.timer;
  const u = i.unitLabel;
  const timerTxt =
    data.kv_timer_mode === 'measured'
      ? `${L(`по ${tm.n ?? '—'} облучениям`, `from ${tm.n ?? '—'} exposures`)}: ${data.kv_tt
          .map((t, k) => [t, data.kv_tm[k]])
          .filter(([a, b]) => String(a ?? '').trim() && String(b ?? '').trim())
          .map(([a, b]) => L(`${a} ${u} → ${b} нКл`, `${a} ${u} → ${b} nC`))
          .join('; ')}`
      : data.kv_timer_mode === 'nexp'
        ? L(`одно облучение ${data.kv_nx_t} ${u} (${cells(data.kv_nx_M1)} нКл) против ${data.kv_nx_n} облучений по X/n (${cells(data.kv_nx_Mn)} нКл)`, `one exposure of ${data.kv_nx_t} ${u} (${cells(data.kv_nx_M1)} nC) vs. ${data.kv_nx_n} exposures of X/n (${cells(data.kv_nx_Mn)} nC)`)
        : data.kv_timer_mode === 'manual'
          ? L('введено', 'entered manually')
          : L('не учитывалась', 'not accounted for');
  if (data.kv_timer_mode === 'window') {
    line(L('Время', 'Time'), L(`заряд накоплен электрометром за ${data.kv_set} ${u} при включённой трубке; ошибка таймера в результат не входит`, `charge collected by the electrometer over ${data.kv_set} ${u} with the tube on; the timer error does not enter the result`));
  } else line(L('Задание облучения', 'Exposure setting'), `X = ${data.kv_set} ${u}; τ = ${fmt(tm.tau, 4)} ${u} (${timerTxt}); X + τ = ${fmt(i.Xeff, 4)} ${u}`);
  line(L('Напряжения', 'Voltages'), data.kv_ks_on ? L(`V1 = ${data.kv_V1} В, V2 = ${data.kv_V2} В, обычная полярность ${data.kv_polarity}`, `V1 = ${data.kv_V1} V, V2 = ${data.kv_V2} V, normal polarity ${data.kv_polarity}`) : L(`V1 = ${data.kv_V1} В, обычная полярность ${data.kv_polarity}`, `V1 = ${data.kv_V1} V, normal polarity ${data.kv_polarity}`));
  const mean = L('среднее', 'mean');
  line(L('M(V1, обычная), нКл', 'M(V1, normal), nC'), `${cells(data.kv_M1)} → ${mean} ${fmt(Math.abs(i.M1.mean), 4)}`);
  if (i.Mopp.n > 0) line(L('M(V1, обратная), нКл', 'M(V1, opposite), nC'), `${cells(data.kv_Mopp)} → ${mean} ${fmt(Math.abs(i.Mopp.mean), 4)}`);
  else line(L('M(V1, обратная)', 'M(V1, opposite)'), L('не измерялось (k_pol = 1)', 'not measured (k_pol = 1)'));
  if (data.kv_ks_on) line(L('M(V2), нКл', 'M(V2), nC'), `${cells(data.kv_M2)} → ${mean} ${fmt(Math.abs(i.M2.mean), 4)}`);
  if (r.ctrl.on) line(L('Контрольные измерения M(V1), нКл', 'Check measurements M(V1), nC'), `${cells(data.kv_Mc)} → ${mean} ${fmt(r.ctrl.mean, 4)} ${L('за', 'for')} ${setText(r, r.ctrl.X)}`);
  out.push('');
  out.push(`— ${PROTO_NAME} —`);
  out.push(`k_TP = ${fmt(x.kTP)}; k_elec = ${fmt(x.kelec)}; k_pol = ${fmt(x.kpol)}; k_s = ${fmt(x.ks)}; k_leak = ${fmt(x.kleak)}`);
  const ph = x.phys;
  if (r.cal === 'ndw') {
    out.push(`k_g = ${fmt(x.kg.value)} (${plain(kgSourceText(x.kg)) || '—'})${r.qo === 'co60' ? '; k_z = 1' : ''}`);
  } else if (r.range === 'low') {
    out.push(`[μen/ρ]w,air FIA = ${fmt(ph.muen)}; B_w = ${fmt(ph.bw)}; ${L('поправка N_K на поле', 'N_K field correction')} = ${fmt(ph.nkFs)}`);
  } else {
    out.push(`[μen/ρ]w,air z=2 = ${fmt(ph.muen)}; p_ch = ${fmt(ph.pch)} (${ph.pchSource === 'table32' ? L('табл. 32', 'Table 32') : L('введён вручную', 'entered manually')})`);
  }
  if (x.blocked) {
    out.push(L('РЕЗУЛЬТАТ НЕ ВЫЧИСЛЕН: есть ошибки ввода (см. замечания).', 'RESULT NOT CALCULATED: there are input errors (see Messages).'));
  } else {
    const zTxt = r.range === 'low' ? L('на поверхности', 'at the surface') : L('на 2 г/см²', 'at 2 g/cm²');
    const describe = (y, title) => {
      let dev = '';
      if (Number.isFinite(y.deviation)) {
        const tol = r.cmp.tolerance;
        const tolTxt = fmt(tol, tol % 1 ? 1 : 0);
        const inTol = Math.abs(y.deviation) <= tol ? L(`в допуске ±${tolTxt} %`, `within ±${tolTxt} %`) : L(`вне допуска ±${tolTxt} %`, `outside ±${tolTxt} %`);
        const at = r.cmp.at === 'surface' ? L('на поверхности', 'at the surface') : zTxt;
        dev = L(`; значение для сравнения ${fmt(r.cmp.ref, 4)} ${x.rateLabel} ${at}, отклонение ${fmtSigned(y.deviation, 2)} % (${inTol})`, `; comparison value ${fmt(r.cmp.ref, 4)} ${x.rateLabel} ${at}, deviation ${fmtSigned(y.deviation, 2)} % (${inTol})`);
      }
      out.push(
        L(
          `${title}: M с поправками = ${fmt(y.M)} нКл; D_w ${zTxt} = ${fmt(y.DcGy, 2)} сГр = ${fmt(y.D)} Гр за облучение; ${fmt(y.perUnit, 4)} ${x.rateLabel}${dev}`,
          `${title}: corrected M = ${fmt(y.M)} nC; D_w ${zTxt} = ${fmt(y.DcGy, 2)} cGy = ${fmt(y.D)} Gy per exposure; ${fmt(y.perUnit, 4)} ${x.rateLabel}${dev}`,
        ),
      );
      if (r.depth.on && Number.isFinite(y.perUnitSurf)) out.push(L(`  PDD(2 см) = ${fmt(r.depth.pdd, 1)} %; на поверхности ${fmt(y.perUnitSurf, 4)} ${x.rateLabel}`, `  PDD(2 cm) = ${fmt(r.depth.pdd, 1)} %; at the surface ${fmt(y.perUnitSurf, 4)} ${x.rateLabel}`));
    };
    if (x.ctrl && !x.ctrl.blocked) describe(x.ctrl, L('По контрольным измерениям (раздел 6)', 'From check measurements (section 6)'));
    else if (r.ctrl.on) out.push(L('РЕЗУЛЬТАТ НЕ ВЫЧИСЛЕН: в контрольных измерениях (раздел 6) ошибки (см. замечания).', 'RESULT NOT CALCULATED: the check measurements (section 6) contain errors (see Messages).'));
    else describe(x, L('По показанию M₁ раздела 4 (контрольные измерения не введены)', 'From reading M₁ of section 4 (no check measurements entered)'));
    const cl = complianceLine(r.compliance, PROTO_NAME);
    if (cl) out.push(cl);
  }
  if (r.andreo.citation) out.push(L(`B_w и [μen/ρ]w,air — данные: ${r.andreo.citation}`, `B_w and [μen/ρ]w,air data: ${r.andreo.citation}`));
  const cmp = r.compare;
  if (cmp?.kind) {
    out.push('');
    out.push(L(`— Справочно: ${cmp.title} (на итог не влияет) —`, `— For reference: ${cmp.title} (does not affect the result) —`));
    const p = primaryOf(x);
    if (x.blocked || ctrlFailed(x)) out.push(L('Итога по TRS-398 Rev.1 нет — сравнивать не с чем.', 'There is no TRS-398 Rev.1 result to compare with.'));
    else if (!cmp.available) out.push(L(`Не посчитано: ${cmp.reason}.`, `Not calculated: ${cmp.reason}.`));
    else {
      const zTxt = r.range === 'low' ? L('на поверхности', 'at the surface') : L('на 2 г/см²', 'at 2 g/cm²');
      out.push(L(`${fmt(p.perUnit * cmp.ratio, 4)} ${x.rateLabel} ${zTxt}; отличие от ${PROTO_NAME} ${fmtSigned(cmp.diffPct, 2)} % (отношение доз ${fmt(cmp.ratio, 4)})`, `${fmt(p.perUnit * cmp.ratio, 4)} ${x.rateLabel} ${zTxt}; difference from ${PROTO_NAME} ${fmtSigned(cmp.diffPct, 2)} % (dose ratio ${fmt(cmp.ratio, 4)})`));
      const short = pcShort(cmp);
      cmp.rows.forEach((y) => out.push(`  ${y.sym}: ${short} ${fmt(y.cmp, 4)} (${y.cmpSrc}); Rev.1 ${Number.isFinite(y.rev1) ? fmt(y.rev1, 4) : '—'} (${y.rev1Src})`));
      cmp.notes.forEach((n) => out.push(`  ${n}`));
    }
    out.push(`  [${refText(cmp.ref)}]`);
  }
  out.push('');
  const msgs = r.messages.filter((m) => m.level !== 'info');
  if (msgs.length) {
    out.push(L('Замечания:', 'Messages:'));
    msgs.forEach((m) => out.push(`- ${m.text}${m.ref ? ` [${refText(m.ref)}]` : ''}`));
    out.push('');
  }
  if (data.kv_notes) out.push(`${L('Примечания', 'Notes')}: ${data.kv_notes}`);
  out.push('', precisionNote());
  return out.join('\n');
}

// ------------------------------------------------------------ сохранение
function saveDraft(data) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  } catch {
    /* хранилище недоступно */
  }
}
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Открытый файл: пока форму не меняли, итог сверяется с сохранённым в файле. */
let openedFile = null;

/** Загрузка данных из файла или буфера обмена. Бросает ошибку, если файл не от этого модуля. */
export function importKv(obj) {
  if (!obj || obj.app !== FILE_TAG.app || typeof obj.form !== 'object') throw new Error(L('Это не файл калькулятора референсной дозиметрии.', 'This is not a reference dosimetry calculator file.'));
  checkFileFormat(obj, FILE_TAG);
  if (obj.module !== FILE_TAG.module) {
    throw new Error(
      L(
        'Это файл другого раздела: откройте его на соответствующей вкладке или вставьте данные через Ctrl+V — нужная вкладка откроется сама.',
        'This file belongs to another section: open it on the corresponding tab, or paste the data with Ctrl+V and the right tab will open automatically.',
      ),
    );
  }
  writeForm(obj.form);
  openedFile = obj;
  update();
}

// ------------------------------------------------------------ цикл
let current = { data: null, result: null };

function update() {
  const data = readForm();
  const result = computeKv(data);
  current = { data: result.form, result };
  applyVisibility(result.form, result);
  renderOutputs(ROOT(), result);
  renderFlags(ROOT(), result.flags, seriesBox);
  renderReadout(result, result.form);
  $('#kv-demo-flag').hidden = !isDemo(data);
  renderNotesFlag($('#kv-notes-flag'), data.kv_notes, [SAMPLE_KV.kv_notes, SAMPLE_KV_EN.kv_notes], isDemo(data));
  renderFileNote($('#kv-file-note'), openedFile ? compareWithFile(openedFile, snapshot(result), snapCmp(result)) : null);
  saveDraft(result.form);
  renderSignBlock($('#kv-sign'), result.form.kv_staff);
  notifyUpdate(ROOT());
}

/** Смена языка: списки с переведёнными подписями, подписи ячеек, десятичный разделитель, пересчёт. */
function refreshForLang() {
  const kept = $$('select', ROOT()).map((sel) => [sel, sel.value]);
  fillUnitSelects();
  fillChamberSelect();
  for (const [sel, v] of kept) if ([...sel.options].some((o) => o.value === v)) sel.value = v;
  $$('#kv-sheet .cells').forEach((box) => renderCells(box, readCells(box)));
  {
    const { a, b } = readPairs(pairsBox());
    renderPairs(pairsBox(), a, b);
  }
  {
    const c = readCert();
    renderCert(c.kv, c.hvl, c.val);
  }
  renderStaff($('#kv-staff-list'), readStaff($('#kv-staff-list')), update);
  localizeDemo(SAMPLE_KV, SAMPLE_KV_EN);
  localizeDecimals(ROOT());
  update();
}

export function initKv() {
  setStatus = makeStatus($('#kv-status'));
  fillUnitSelects();
  fillChamberSelect();
  $$('#kv-sheet .cells').forEach((box) => setupCells(box, update));
  setupPairs(pairsBox(), update);
  $$('#kv-sheet > section .combo').forEach((c) => makeCombo(c));

  const draft = loadDraft();
  // без черновика вкладка открывается пустой: пример — только по кнопке «Загрузить пример»
  writeForm(draft ? draft : { ...KV_DEFAULTS, kv_date: today() });
  localizeDemo(SAMPLE_KV, SAMPLE_KV_EN);
  update();
  if (!draft) setStatus(L('Введите свои данные или нажмите «Загрузить пример» (раздел «Данные»), чтобы посмотреть расчёт на вымышленных значениях.', 'Enter your own data or click "Load example" (the Data panel) to see the calculation on fictitious values.'));

  const sheet = $('#kv-sheet');
  sheet.addEventListener('input', () => {
    openedFile = null;
    update();
  });
  sheet.addEventListener('change', (e) => {
    openedFile = null;
    if (e.target.id === 'kv_ch_model') {
      const id = e.target.value;
      if (id.startsWith('MY:')) fillCustomFields(getMyChambers().find((c) => c.id === id));
      else if (id === 'CUSTOM') fillCustomFields(null);
    }
    update();
  });

  $('#kv-cert-add').addEventListener('click', () => {
    const c = readCert();
    renderCert([...c.kv, ''], [...c.hvl, ''], [...c.val, '']);
    $$('#kv-cert-rows .cq-kv').at(-1).focus();
    openedFile = null;
    update();
  });
  $('#kv-cert-remove').addEventListener('click', () => {
    const c = readCert();
    if (c.hvl.length <= 1) return;
    renderCert(c.kv.slice(0, -1), c.hvl.slice(0, -1), c.val.slice(0, -1));
    openedFile = null;
    update();
  });

  $('#kv-btn-save-chamber').addEventListener('click', () => {
    const model = $('#kv_cc_model').value.trim();
    if (!model) {
      setStatus(L('Укажите модель камеры, чтобы сохранить её.', 'Enter the chamber model to save it.'));
      $('#kv_cc_model').focus();
      return;
    }
    const cur = $('#kv_ch_model').value;
    const id = cur.startsWith('MY:') ? cur : `MY:${Date.now().toString(36)}`;
    const old = getMyChambers().find((c) => c.id === id) || {};
    const entry = { ...old, id, cc_maker: $('#kv_cc_maker').value.trim(), cc_model: model, cc_type: $('#kv_cc_type').value };
    if (!saveMyChamber(entry)) {
      setStatus(L('Браузер не дал сохранить камеру: хранилище недоступно.', 'The browser did not allow saving the chamber: storage is unavailable.'));
      return;
    }
    fillChamberSelect();
    $('#kv_ch_model').value = id;
    update();
    const saved = [entry.cc_maker, entry.cc_model].filter(Boolean).join(' ');
    setStatus(L(`Камера «${saved}» сохранена в «Мои камеры».`, `Chamber "${saved}" saved to "My chambers".`));
  });
  armButton($('#kv-btn-del-chamber'), () => L('Удалить из «Моих камер»', 'Remove from "My chambers"'), () => L('Точно удалить?', 'Remove it?'), () => {
    deleteMyChamber($('#kv_ch_model').value);
    fillChamberSelect();
    $('#kv_ch_model').value = 'CUSTOM';
    update();
    setStatus(L('Камера удалена из списка; её данные остались в форме.', 'The chamber was removed from the list; its data remain in the form.'));
  });
  document.addEventListener('langchange', refreshForLang);

  $('#kv-btn-add-staff').addEventListener('click', () => {
    const cur = readStaff($('#kv-staff-list'));
    cur.push('');
    renderStaff($('#kv-staff-list'), cur, update);
    $$('#kv-staff-list .staff-input').at(-1).focus();
    update();
  });
  for (const b of $$('[data-kv-preset]')) {
    b.addEventListener('click', () => {
      const [t0, p0] = b.dataset.kvPreset.split('|');
      $('#kv_T0').value = t0;
      $('#kv_P0').value = p0;
      localizeDecimals(ROOT());
      update();
    });
  }

  $('#kv-btn-sample').addEventListener('click', () => {
    openedFile = null;
    writeForm(sampleData());
    update();
    setStatus(L('Загружен демонстрационный пример (вымышленные данные).', 'Demo example loaded (fictitious data).'));
  });
  armButton($('#kv-btn-clear'), () => L('Очистить', 'Clear'), () => L('Точно очистить?', 'Clear everything?'), () => {
    writeForm({ ...KV_DEFAULTS, kv_date: today() });
    openedFile = null;
    update();
    setStatus(L('Форма очищена.', 'The form has been cleared.'));
  });

  const payload = () => JSON.stringify({ ...FILE_TAG, ...fileStamp(snapshot(current.result)), savedAt: new Date().toISOString(), form: current.data }, null, 2);
  $('#kv-btn-save').addEventListener('click', () => {
    const name = ['kV', current.data.kv_machine, current.data.kv_date].filter(Boolean).join('_').replace(/[^\p{L}\p{N}_.-]+/gu, '-');
    downloadText(payload(), `dosimetry_${name}.json`);
    setStatus(L('Файл сохранён.', 'File saved.'));
  });
  $('#kv-btn-load').addEventListener('click', () => $('#kv-file-input').click());
  $('#kv-file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      importKv(JSON.parse(await file.text()));
      setStatus(L(`Открыт файл ${file.name}.`, `Opened file ${file.name}.`));
    } catch (err) {
      setStatus(err instanceof SyntaxError ? L('Файл повреждён: это не JSON.', 'The file is damaged: it is not JSON.') : err.message);
    }
    e.target.value = '';
  });
  $('#kv-btn-copy-json').addEventListener('click', () =>
    copyText(payload(), L('Данные скопированы. Чтобы вставить их обратно, нажмите Ctrl+V на странице вне полей ввода.', 'Data copied. To paste them back, press Ctrl+V on the page outside the input fields.'), setStatus),
  );
  $('#kv-btn-copy-report').addEventListener('click', () => copyText(reportText(current.data, current.result), L('Протокол скопирован в буфер обмена.', 'Report copied to the clipboard.'), setStatus));
  $('#kv-btn-pdf').addEventListener('click', () => printToPdf([L('Дозиметрия', 'Dosimetry'), 'kV', current.data.kv_machine, current.data.kv_date].filter(Boolean).join('_'), setStatus));
  $('#kv-btn-print').addEventListener('click', () => window.print());
}
