// Модуль «kV-рентген»: связывает форму с расчётным ядром kv.js (TRS-398 Rev.1, разд. 8 и 9).
import { certText } from '../core/journal.js';
import { KV_DEFAULTS, KV_SET_UNITS, KV_RANGES, normalizeKv, certRows, certValue, certDinSensitivity, timerSeriesGrid } from '../core/kv.js';
import { DIN_TH, DIN_HVL_DEV, dinHvlConvert } from '../core/kv-din.js';
import {
  emptyKvRow, kvRowLabel, kvRowEmpty, KV_ROW_KEYS, normalizeKvVisit, splitKvVisitForm, kvVisitRowForm, computeKvVisit, newKvMode, newKvChamber,
  kvModeFrom } from '../core/kv-session.js';
import { KV_CHAMBERS, kvChamberLabel, KV_PHANTOMS, resolveKvPhantom, kvPhantomStatus } from '../core/kv-tables.js';
import { TG61_T8_CHAMBER } from '../core/kv-tg61.js';
import { SAMPLE_KV, SAMPLE_KV_EN, SAMPLE_KV_ROWS, SAMPLE_KV_MODE2, SAMPLE_KV_MODE2_EN } from '../core/sample-kv.js';
import { L, getLang, refText } from '../core/i18n.js';
import { localizeDecimals } from './i18n.js';
import { PRESSURE_UNITS, NDW_UNITS, unitLabel, dec, parseCells, parseNumber } from '../core/units.js';
import { getMyChambers, saveMyChamber, deleteMyChamber } from './store.js';
import { makeCombo, renderCells, readCells, setupCells, renderStaff, readStaff } from './widgets.js';
import { refreshSectionNav } from './section-nav.js';
import { scatterChart, legendSwatch } from './chart.js';
import { setupKvJournal, renderKvJournal } from './kv-journal-ui.js';
import { setupKvHvl, renderHvlSheet, renderPlates, readPlates, hvlFieldSub, hvlReportLines } from './kv-hvl-ui.js';
import { KV_PLATE_KEYS, hvlDecimals } from '../core/kv-hvl.js';
import { setupKvQa, renderQaSheets, qaPageState, qaReportLines } from './kv-qa-ui.js';
import { setupKvSummary, renderSummarySheets, outputReportLines } from './kv-summary-ui.js';
import { kvModeName, kvChamberName, kvHvlSourceText } from '../core/kv-summary.js';
import { kvRecModeText, kvJournalInputs } from '../core/kv-records.js';
import { kvJournalFrom } from '../core/kv-session.js';
import { getJournal, onJournal, updateJournal } from './journal-store.js';
import { makeJournalView } from './journal-view.js';
import {
  $, $$, localizeDemo, doseGroupTitle, rawReadingLabel, correctedReadingLabel, fmt, fmtSigned, esc, today, makeStatus, copyText, downloadText,
  renderOutputs, renderFlags, applyShowRules, armButton, renderSignBlock, printToPdf, renderCompliance, complianceLine, ctrlErrorText,
  fileStamp, checkFileFormat, compareWithFile, renderFileNote, versionText, renderNotesFlag, precisionNote, notifyUpdate, richText,
  inlineResultHtml, setInlineResult, dateText } from './common.js';

// черновик: все режимы { version: 3, common, chambers, modes, mode } (0.36 — { form, rows, active }, до 0.36.0 — плоская
// форма одного расчёта; старые черновики читаются как один режим)
const DRAFT_KEY = 'reference-dosimetry.kv.v1';
// формат 3 (0.37.0): режимы аппарата — общие поля common, камеры chambers, режимы modes со строками аппликаторов, выбранный
// режим mode; form — плоская форма выбранной строки выбранного режима. Формат 2 (0.36): rows и active одного режима.
const FILE_TAG = { app: 'reference-dosimetry', module: 'kv', version: 3 };
const SERIES_KEYS = ['kv_M1', 'kv_Mopp', 'kv_M2', 'kv_nx_M1', 'kv_nx_Mn', 'kv_tp_R1', 'kv_tp_R2', 'kv_Mc', 'kv_hl_D0', 'kv_hl_D1', 'kv_hl_D2', 'kv_hl_Dc', 'kv_ln_M1', 'kv_ln_M2', 'kv_ln_M3', 'kv_ln_M4', 'kv_ln_M5', 'kv_rp_M'];
// серия облучений с разным заданием: задания — столбцы таблицы, повторные показания — строки (раздел 3)
const TS_KEYS = ['kv_ts_t', 'kv_ts_R'];
const CERT_KEYS = ['kv_cq_kv', 'kv_cq_hvl', 'kv_cq_mat', 'kv_cq_val'];
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

/** Списки материала фантома: вода, ПММА, водоэквивалентные пластики, полистирол, свой материал. */
function fillPhantomSelects() {
  const opt = (p) => `<option value="${p.id}">${esc(p.name())}</option>`;
  const wep = KV_PHANTOMS.filter((p) => p.kind === 'wep');
  const body = [
    ...KV_PHANTOMS.filter((p) => p.kind === 'water' || p.kind === 'pmma').map(opt),
    `<optgroup label="${esc(L('Водоэквивалентные пластики', 'Water-equivalent plastics'))}">`,
    ...wep.map(opt),
    '</optgroup>',
    ...KV_PHANTOMS.filter((p) => p.kind === 'ps').map(opt),
  ].join('');
  const fill = (id, customText) => {
    const sel = $(id);
    const keep = sel.value;
    sel.innerHTML = `<option value="">${esc(L('— не указан —', '— not specified —'))}</option>${body}<option value="custom">${esc(customText)}</option>`;
    if (keep && sel.querySelector(`option[value="${CSS.escape(keep)}"]`)) sel.value = keep;
  };
  fill('#kv_phantom', L('свой материал…', 'custom material…'));
  fill('#kv_lab_phantom', L('свой материал (описан в разделе 1)', 'custom material (described in section 1)'));
  fill('#kv_pdd_phantom', L('свой материал (описан в разделе 1)', 'custom material (described in section 1)'));
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
/** Демонстрационный пример: режим 1 — 200 кВ с тремя аппликаторами, режим 2 — 150 кВ с двумя (k_pol и τ — из режима 1). */
function sampleVisit(s) {
  const v = normalizeKvVisit({ form: s, rows: [s, ...SAMPLE_KV_ROWS], active: 0 });
  const m2 = newKvMode(v.modes[0]);
  Object.assign(m2.shared, SAMPLE_KV_MODE2.shared, getLang() === 'en' ? SAMPLE_KV_MODE2_EN : {});
  m2.rows = SAMPLE_KV_MODE2.rows;
  v.modes.push(m2);
  return normalizeKvVisit(v);
}
/** Текстовые поля примера в невыбранных режимах и камерах — на текущем языке (выбранные — localizeDemo в форме). */
function localizeVisitDemo() {
  const en = getLang() === 'en';
  const swap = (obj, ruS, enS) => {
    for (const [k, ev] of Object.entries(enS)) if (typeof ruS[k] === 'string' && obj[k] === (en ? ruS[k] : ev)) obj[k] = en ? ev : ruS[k];
  };
  for (const md of visit.modes) {
    swap(md.shared, SAMPLE_KV, SAMPLE_KV_EN);
    swap(md.shared, SAMPLE_KV_MODE2.shared, SAMPLE_KV_MODE2_EN);
  }
  for (const ch of visit.chambers) swap(ch, SAMPLE_KV, SAMPLE_KV_EN);
}
const isDemo = (d) => [SAMPLE_KV.kv_institution, SAMPLE_KV_EN.kv_institution].includes(d.kv_institution) && [SAMPLE_KV.kv_machine, SAMPLE_KV_EN.kv_machine].includes(d.kv_machine);

// ------------------------------------------------------------ таблица качеств сертификата
const certList = () => $('#kv-cert-rows');

// металл СПО пучка — по диапазону энергий (прил. III Rev.1: до 100 кВ — Al, выше — Cu)
const beamMat = () => KV_RANGES[$('#kv_range')?.value]?.material ?? 'Al';

/**
 * Таблица качеств сертификата: c = { kv, hvl, mat, val } — столбцы. Металл СПО у строки свой: пустой (файлы до 0.49.3 и
 * новые строки) показывается как металл пучка и помечается data-auto — такой список следует за диапазоном энергий, пока его
 * не выберут вручную.
 */
function renderCert({ kv = [], hvl = [], mat = [], val = [] } = {}) {
  const n = Math.max(1, kv.length, hvl.length, mat.length, val.length);
  const no = (i) => `${L('качество', 'quality')} ${i + 1}`;
  const cell = (cls, key, i, v, label) =>
    `<input type="text" class="num ${cls}" inputmode="decimal" id="${key}_${i}" aria-label="${esc(label)}, ${no(i)}" value="${esc(v ?? '')}">`;
  const metal = (i) => {
    const m = mat[i] === 'Al' || mat[i] === 'Cu' ? mat[i] : '';
    const v = m || beamMat();
    const opt = (x) => `<option value="${x}"${x === v ? ' selected' : ''}>${x}</option>`;
    return `<select class="cq-mat" id="kv_cq_mat_${i}" aria-label="${esc(L('Металл СПО', 'HVL metal'))}, ${no(i)}"${m ? '' : ' data-auto="1"'}>${opt('Al')}${opt('Cu')}</select>`;
  };
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(`<div class="pair-row"><span class="pair-no">${i + 1}</span>${cell('cq-kv', 'kv_cq_kv', i, kv[i], L('Напряжение, кВ', 'Voltage, kV'))}${cell('cq-hvl', 'kv_cq_hvl', i, hvl[i], L('СПО', 'HVL'))}${metal(i)}${cell('cq-val', 'kv_cq_val', i, val[i], L('Значение из сертификата', 'Certificate value'))}</div>`);
  }
  certList().innerHTML = rows.join('');
  $('#kv-cert-remove').disabled = n <= 1;
}

function readCert() {
  const col = (cls) => $$(`#kv-cert-rows .${cls}`).map((i) => i.value);
  const mat = $$('#kv-cert-rows .cq-mat').map((s) => (s.dataset.auto ? '' : s.value));
  return { kv: col('cq-kv'), hvl: col('cq-hvl'), mat, val: col('cq-val') };
}

// ------------------------------------------------------------ форма ↔ данные
const seriesBox = (key) => $(`#kv-sheet .cells[data-series="${key}"]`);

// ------------------------------------------------------------ серия облучений с разным заданием (раздел 3)
const tsGrid = () => $('#kv-ts-grid');
/** Единица заданий серии: при задании по времени — выбранная (с или мин), иначе — единица задания. */
function tsUnitText() {
  const set = $('#kv_set_unit')?.value;
  const u = KV_SET_UNITS[KV_SET_UNITS[set]?.time ? ($('#kv_ts_unit')?.value === 'min' ? 'min' : 's') : set] ?? KV_SET_UNITS.s;
  return L(u.label, u.labelEn);
}

/**
 * Таблица серии, как в книге учреждения: столбец — задание, под ним повторные показания и среднее. Поля идут в документе
 * по столбцам (сетка с grid-auto-flow: column), поэтому Tab ведёт вниз по столбцу — в порядке облучений.
 */
function renderTs(t, R) {
  const g = timerSeriesGrid(t, R);
  const rows = g.R[0].length;
  const u = tsUnitText();
  const box = tsGrid();
  box.style.setProperty('--ts-rows', String(rows + 3));
  const cell = [`<span class="ts-h ts-no">№</span>`, `<span class="ts-h" id="kv-lbl-tt">${esc(L(`Задание, ${u}`, `Setting, ${u}`))}</span>`];
  for (let i = 0; i < rows; i++) cell.push(`<span class="ts-h">${esc(L(`M${i + 1}, нКл`, `M${i + 1}, nC`))}</span>`);
  cell.push(`<span class="ts-h ts-mean-h">${esc(L('Среднее, нКл', 'Mean, nC'))}</span>`);
  g.t.forEach((tv, j) => {
    const no = j + 1;
    const flag = ` data-flag="kv_ts_${j}"`;
    cell.push(`<span class="ts-no">${no}</span>`);
    cell.push(`<input type="text" class="num ts-t" inputmode="decimal" id="kv_ts_t_${j}" data-j="${j}"${flag} aria-label="${esc(L(`Задание ${no}, ${u}`, `Setting ${no}, ${u}`))}" value="${esc(tv)}">`);
    for (let i = 0; i < rows; i++) {
      cell.push(`<input type="text" class="num ts-m" inputmode="decimal" id="kv_ts_R_${j}_${i}" data-j="${j}" data-i="${i}"${flag} aria-label="${esc(L(`Задание ${no}: показание ${i + 1}, нКл`, `Setting ${no}: reading ${i + 1}, nC`))}" value="${esc(g.R[j][i])}">`);
    }
    cell.push(`<output class="ts-mean" data-j="${j}"${flag}></output>`);
  });
  box.innerHTML = cell.join('');
  $('#kv-ts-del-col').disabled = g.t.length <= 2;
  $('#kv-ts-del-row').disabled = rows <= 1;
  renderTsMeans();
}

function readTs() {
  const box = tsGrid();
  const t = $$('.ts-t', box).map((i) => i.value);
  const R = t.map(() => []);
  for (const i of $$('.ts-m', box)) R[Number(i.dataset.j)][Number(i.dataset.i)] = i.value;
  return { kv_ts_t: t, kv_ts_R: R };
}

/** Средние показания под столбцами: 4 значащие цифры. */
function renderTsMeans() {
  const { kv_ts_R: R } = readTs();
  for (const o of $$('.ts-mean', tsGrid())) {
    const c = parseCells(R[Number(o.dataset.j)]);
    o.textContent = c.n > 0 && !c.error ? sigFmt(Math.abs(c.mean), 4) : '';
  }
}

function setupTs() {
  const grow = (dc, dr) => {
    const { kv_ts_t: t, kv_ts_R: R } = readTs();
    if (dc > 0) {
      t.push('');
      R.push(Array.from({ length: R[0]?.length || 3 }, () => ''));
    } else if (dc < 0 && t.length > 2) {
      t.pop();
      R.pop();
    }
    if (dr > 0) R.forEach((c) => c.push(''));
    else if (dr < 0 && (R[0]?.length ?? 0) > 1) R.forEach((c) => c.pop());
    renderTs(t, R);
    if (dc > 0) $(`#kv_ts_t_${t.length - 1}`)?.focus();
    if (dr > 0) $(`#kv_ts_R_0_${R[0].length - 1}`)?.focus();
    update();
  };
  $('#kv-ts-add-col').addEventListener('click', () => grow(1, 0));
  $('#kv-ts-del-col').addEventListener('click', () => grow(-1, 0));
  $('#kv-ts-add-row').addEventListener('click', () => grow(0, 1));
  $('#kv-ts-del-row').addEventListener('click', () => grow(0, -1));
}

function readForm() {
  const data = {};
  for (const key of Object.keys(KV_DEFAULTS)) {
    if (key === 'protocol') data.protocol = 'trs';
    else if (key === 'kv_staff') data.kv_staff = readStaff($('#kv-staff-list'));
    else if (SERIES_KEYS.includes(key)) data[key] = readCells(seriesBox(key));
    else if (TS_KEYS.includes(key) || CERT_KEYS.includes(key) || KV_PLATE_KEYS.includes(key)) continue;
    else {
      const el = document.getElementById(key);
      if (!el) continue;
      data[key] = el.type === 'checkbox' ? el.checked : el.value;
    }
  }
  Object.assign(data, readPlates());
  Object.assign(data, readTs());
  const c = readCert();
  data.kv_cq_kv = c.kv;
  data.kv_cq_hvl = c.hvl;
  data.kv_cq_mat = c.mat;
  data.kv_cq_val = c.val;
  return data;
}

function writeForm(values) {
  const data = normalizeKv(values);
  if (String(data.kv_ch_model).startsWith('MY:') && !getMyChambers().some((c) => c.id === data.kv_ch_model)) data.kv_ch_model = 'CUSTOM';
  for (const [key, value] of Object.entries(data)) {
    if (key === 'protocol' || TS_KEYS.includes(key) || CERT_KEYS.includes(key) || KV_PLATE_KEYS.includes(key)) continue;
    if (key === 'kv_staff') renderStaff($('#kv-staff-list'), value, update);
    else if (SERIES_KEYS.includes(key)) renderCells(seriesBox(key), value);
    else {
      const el = document.getElementById(key);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!value;
      else el.value = value ?? '';
    }
  }
  renderTs(data.kv_ts_t, data.kv_ts_R);
  renderCert({ kv: data.kv_cq_kv, hvl: data.kv_cq_hvl, mat: data.kv_cq_mat, val: data.kv_cq_val });
  renderPlates(data);
  localizeDecimals(ROOT());
}

// ------------------------------------------------------------ таблица аппликаторов (раздел 4)
/** Все режимы аппарата: общие поля, камеры, режимы со строками аппликаторов и выбранный режим (kv-session.js). */
let visit = normalizeKvVisit(null);
/** Выбранный режим. */
const mode = () => visit.modes[visit.mode];
/** Строки и выбранная строка выбранного режима. Поля выбранной строки показаны в разделах формы. */
const sess = {
  get rows() {
    return mode().rows;
  },
  get active() {
    return mode().active;
  },
  set active(i) {
    mode().active = i;
  },
};
/** Плоская форма строки i выбранного режима. */
const rowForm = (i) => kvVisitRowForm(visit, visit.mode, i);

// текстовые поля: в них число с запятой или точкой — не число (серийный номер, фильтр), разделитель не меняется
const TEXT_KEYS = new Set(['kv_institution', 'kv_machine', 'kv_jmachine', 'kv_jmode', 'kv_date', 'kv_staff', 'kv_notes', 'kv_filter', 'kv_ph_name', 'kv_ph_note', 'kv_cc_maker', 'kv_cc_model', 'kv_ch_serial', 'kv_cert_no', 'kv_cert_date', 'kv_cert_lab', 'kv_cert_src', 'kv_el_model', 'kv_el_serial', 'kv_hl_app', 'kv_pl_name', 'kv_pl_mat', 'kv_ln_app', 'kv_rp_app', 'kv_method', 'kv_checker']);
/**
 * Десятичный разделитель в числах всех режимов, камер и строк — языка интерфейса (поля формы — localizeDecimals; здесь —
 * невыбранные режимы, камеры и строки: их числа видны в подписях режимов, сводке и протоколе).
 */
function localizeVisitNumbers() {
  const en = getLang() === 'en';
  const loc = (v) => (typeof v === 'string' && /^\s*[+\-−]?\d+[.,]\d+\s*$/.test(v) ? (en ? v.replace(',', '.') : v.replace('.', ',')) : v);
  const walk = (obj) => {
    for (const [k, v] of Object.entries(obj)) if (!TEXT_KEYS.has(k)) obj[k] = Array.isArray(v) ? v.map(loc) : loc(v);
  };
  walk(visit.common);
  visit.chambers.forEach(walk);
  for (const md of visit.modes) {
    walk(md.shared);
    md.rows.forEach(walk);
  }
}
/** Новые данные вкладки (файл, черновик, пример, очистка): числа — с разделителем языка интерфейса. */
function setVisit(v) {
  visit = v;
  localizeVisitNumbers();
}
const rowsBody = () => $('#kv-rows-body');
const rowWord = (i) => L(`строка ${i + 1}`, `row ${i + 1}`);
/** Ячеек показаний M₁ в строке таблицы: не меньше трёх и не меньше введённых (больше — кнопкой «+» в разделе 5). */
const mCount = (row) => Math.max(3, Array.isArray(row.kv_M1) ? row.kv_M1.length : 0);
const coneLabel = (shape) => (shape === 'square' ? L('Сторона поля, см', 'Field side, cm') : shape === 'rect' ? L('Сторона a, см', 'Side a, cm') : L('Диаметр поля, см', 'Field diameter, cm'));

function rowInput(i, key, value, label, j = null) {
  const id = j === null ? `kvr${i}_${key}` : `kvr${i}_${key}_${j}`;
  return `<input type="text" class="num" inputmode="decimal" id="${id}" data-k="${key}"${j === null ? '' : ` data-j="${j}"`} aria-label="${esc(`${label}, ${rowWord(i)}`)}" value="${esc(value ?? '')}">`;
}

/** Подписи колонок с единицами: задание, давление, мощность дозы. */
function rowCaps(data, result) {
  const u = result.inputs.unitLabel;
  const pu = unitLabel(PRESSURE_UNITS[data.kv_env_P_unit]);
  return {
    set: data.kv_timer_mode === 'window' ? L(`Время, ${u}`, `Time, ${u}`) : L(`Задание, ${u}`, `Setting, ${u}`),
    p: `P, ${pu}`,
    pLabel: L(`Давление, ${pu}`, `Pressure, ${pu}`),
    d: `D, ${result.trs.rateLabel}`,
  };
}

function rowHtml(row, i, n, caps) {
  const shape = row.kv_cone_shape;
  const rect = shape === 'rect';
  const opt = (v, t, title) => `<option value="${v}" title="${esc(title)}"${shape === v ? ' selected' : ''}>${t}</option>`;
  const m = Array.from({ length: mCount(row) }, (_, j) => rowInput(i, 'kv_M1', row.kv_M1?.[j], L(`Показание M₁ № ${j + 1}, нКл`, `Reading M₁ no. ${j + 1}, nC`), j)).join('');
  const active = i === sess.active;
  const cap = (s) => ` data-cap="${esc(s)}"`;
  return `<tr data-i="${i}"${active ? ' class="active"' : ''}>
    <td class="no"><span class="kv-std" hidden></span><button type="button" class="kv-row-pick" aria-pressed="${active}" aria-label="${esc(L(`Строка ${i + 1}: показать подробно в разделах ниже`, `Row ${i + 1}: show in detail in the sections below`))}" title="${esc(L('Показать строку подробно в разделах ниже', 'Show the row in detail in the sections below'))}">${i + 1}</button></td>
    <td class="cone"${cap(L('Аппликатор, см', 'Applicator, cm'))}><span class="cone-in"><select data-k="kv_cone_shape" id="kvr${i}_kv_cone_shape" aria-label="${esc(`${L('Тубус', 'Applicator')}, ${rowWord(i)}`)}">${opt('circle', 'Ø', L('круглый', 'circular'))}${opt('square', '□', L('квадратный', 'square'))}${opt('rect', '▭', L('прямоугольный', 'rectangular'))}</select>${rowInput(i, 'kv_cone', row.kv_cone, coneLabel(shape))}<span class="x"${rect ? '' : ' hidden'}>×</span>${rowInput(i, 'kv_cone_b', row.kv_cone_b, L('Сторона b, см', 'Side b, cm')).replace('<input ', `<input${rect ? '' : ' hidden'} `)}</span></td>
    <td${cap(L('РИП, см', 'SSD, cm'))}>${rowInput(i, 'kv_ssd', row.kv_ssd, L('РИП, см', 'SSD, cm'))}</td>
    <td${cap(caps.set)}>${rowInput(i, 'kv_set', row.kv_set, caps.set)}</td>
    <td${cap('T, °C')}>${rowInput(i, 'kv_env_T', row.kv_env_T, L('Температура, °C', 'Temperature, °C'))}</td>
    <td${cap(caps.p)}>${rowInput(i, 'kv_env_P', row.kv_env_P, caps.pLabel)}</td>
    <td class="m"${cap(L('M₁, нКл', 'M₁, nC'))}><span class="m-in">${m}</span></td>
    <td data-show="kv_range:medium"${cap(L('PDD(2 см), %', 'PDD(2 cm), %'))}>${rowInput(i, 'kv_pdd2', row.kv_pdd2, L('PDD(2 см), %', 'PDD(2 cm), %'))}</td>
    <td${cap(L('Сравнить с', 'Compare with'))}>${rowInput(i, 'kv_ref', row.kv_ref, L('Значение для сравнения', 'Comparison value'))}</td>
    <td class="v" data-o="ktp"${cap('k_TP')}></td>
    <td class="v" data-o="kg" data-show="kv_cal:ndw"${cap('k_g')}></td>
    <td class="v fix fix-d" data-o="d"${cap(caps.d)}></td>
    <td class="v fix fix-dev" data-o="dev"${cap(L('откл., %', 'dev., %'))}></td>
    <td class="act fix fix-act"><span class="st" role="img"></span><button type="button" class="kv-row-del" aria-label="${esc(L(`Удалить строку ${i + 1}`, `Delete row ${i + 1}`))}" title="${esc(L('Удалить строку', 'Delete the row'))}"${n <= 1 ? ' disabled' : ''}>×</button></td>
  </tr>`;
}

function renderRows(data, result) {
  const caps = rowCaps(data, result);
  const n = sess.rows.length;
  rowsBody().innerHTML = sess.rows.map((row, i) => rowHtml(row, i, n, caps)).join('');
  $('#kv-rows-h-set').textContent = caps.set;
  $('#kv-rows-h-p').textContent = caps.p;
  $('#kv-rows-h-d').textContent = caps.d;
  localizeDecimals(rowsBody());
}

/** Поле выбранной строки в разделах формы — то же значение, что в таблице. */
function writeDetail(key, value) {
  if (SERIES_KEYS.includes(key)) return renderCells(seriesBox(key), value);
  const el = document.getElementById(key);
  if (!el) return;
  if (el.type === 'checkbox') el.checked = !!value;
  else el.value = value ?? '';
}

/** Ввод в таблице: значение — в строку; у выбранной строки — и в поле раздела формы. */
function onRowInput(el) {
  const tr = el.closest('tr[data-i]');
  const i = Number(tr?.dataset.i);
  const key = el.dataset.k;
  const row = sess.rows[i];
  if (!row || !key) return;
  if (el.dataset.j !== undefined) {
    const j = Number(el.dataset.j);
    const a = Array.isArray(row[key]) ? [...row[key]] : [];
    while (a.length <= j) a.push('');
    a[j] = el.value;
    row[key] = a;
  } else row[key] = el.value;
  if (key === 'kv_cone_shape') {
    const rect = el.value === 'rect';
    tr.querySelector('.cone-in .x').hidden = !rect;
    tr.querySelector('[data-k="kv_cone_b"]').hidden = !rect;
    tr.querySelector('[data-k="kv_cone"]').setAttribute('aria-label', `${coneLabel(el.value)}, ${rowWord(i)}`);
  }
  if (i === sess.active) writeDetail(key, row[key]);
  openedFile = null;
  update({ fromTable: true });
}

/** Выбор строки: её поля — в разделы формы, итог и замечания — по ней. Таблица не перерисовывается (фокус остаётся). */
function selectRow(i) {
  if (i === sess.active || !sess.rows[i]) return;
  sess.active = i;
  writeForm(rowForm(i));
  update({ fromTable: true });
}

function addRow() {
  sess.rows.push(emptyKvRow(sess.rows.at(-1)));
  sess.active = sess.rows.length - 1;
  writeForm(rowForm(sess.active));
  openedFile = null;
  update();
  $(`#kvr${sess.active}_kv_cone`)?.focus();
}

function deleteRow(i) {
  if (sess.rows.length <= 1 || !sess.rows[i]) return;
  const wasActive = sess.active === i;
  sess.rows.splice(i, 1);
  if (sess.active > i) sess.active--;
  else if (wasActive) sess.active = Math.min(i, sess.rows.length - 1);
  // поля выбранной строки в разделах формы: та же строка (с новым номером) или соседняя, если удалили выбранную
  writeForm(rowForm(sess.active));
  openedFile = null;
  update();
}

/** Удаление строки с данными — вторым нажатием в течение 4 с; пустая строка удаляется сразу. */
function onDeleteClick(btn) {
  const i = Number(btn.closest('tr[data-i]')?.dataset.i);
  if (!sess.rows[i]) return;
  if (kvRowEmpty(sess.rows[i]) || btn.classList.contains('armed')) {
    deleteRow(i);
    setStatus(L(`Строка ${i + 1} удалена.`, `Row ${i + 1} deleted.`));
    return;
  }
  const label = btn.getAttribute('aria-label');
  btn.classList.add('armed');
  btn.setAttribute('aria-label', L(`Нажмите ещё раз, чтобы удалить строку ${i + 1}`, `Click again to delete row ${i + 1}`));
  setStatus(L(`В строке ${i + 1} есть данные: нажмите × ещё раз, чтобы удалить её.`, `Row ${i + 1} contains data: click × again to delete it.`));
  setTimeout(() => {
    if (!btn.isConnected) return;
    btn.classList.remove('armed');
    btn.setAttribute('aria-label', label);
  }, 4000);
}

/**
 * Состояние строки для точки в таблице: пустая, ошибки, предупреждения или без замечаний, и подсказка. Строка без
 * показаний M₁ (например, тубусы нового режима) ещё не измерена: она серая, а не красная.
 */
function rowState(r, row) {
  if (kvRowEmpty(row)) return { lvl: 'empty', tip: L('Строка не заполнена', 'The row is empty') };
  const m = parseCells(row.kv_M1);
  if (m.n === 0 && !m.error) return { lvl: 'empty', tip: L('Показаний ещё нет', 'No readings yet') };
  const errs = r.messages.filter((m) => m.level === 'error');
  const warns = r.messages.filter((m) => m.level === 'warn');
  if (errs.length) return { lvl: 'error', tip: L(`Ошибок: ${errs.length}. ${errs[0].text}`, `Errors: ${errs.length}. ${errs[0].text}`) };
  if (warns.length) return { lvl: 'warn', tip: L(`Предупреждений: ${warns.length}. ${warns[0].text}`, `Warnings: ${warns.length}. ${warns[0].text}`) };
  return { lvl: 'ok', tip: L('Замечаний нет', 'No issues') };
}

// ------------------------------------------------------------ режимы аппарата и камеры
const LVL_RANK = { empty: 0, ok: 1, warn: 2, error: 3 };
/** Состояние режима — худшее из его строк. */
function modeState(mr, md) {
  let lvl = 'empty';
  mr.results.forEach((r, i) => {
    const l = rowState(r, md.rows[i]).lvl;
    if (LVL_RANK[l] > LVL_RANK[lvl]) lvl = l;
  });
  return lvl;
}
const modeName = (m) => kvModeName(visit, m);
/** Пучок режима для протокола: напряжение, ток, СПО и фильтр — что введено. */
function modeBeamText(f) {
  const t = (k) => String(f[k] ?? '').trim();
  const mat = f.kv_range === 'medium' ? 'Cu' : 'Al';
  const parts = [
    t('kv_kv') && L(`${t('kv_kv')} кВ`, `${t('kv_kv')} kV`),
    t('kv_ma') && L(`${t('kv_ma')} мА`, `${t('kv_ma')} mA`),
    t('kv_hvl') && L(`СПО ${t('kv_hvl')} мм ${mat}`, `HVL ${t('kv_hvl')} mm ${mat}`),
    t('kv_filter') && L(`фильтр ${t('kv_filter')}`, `filter ${t('kv_filter')}`),
  ].filter(Boolean);
  return parts.join(', ') || L('пучок не задан', 'beam not set');
}

/** Название камеры: модель и серийный номер. */
const chamberName = kvChamberName;
/** Номера режимов (с 1), в которых выбрана камера j. */
const chamberModes = (j) => visit.modes.flatMap((md, m) => (md.chamber === j ? [m + 1] : []));

// ------------------------------------------------------------ таблица режимов (раздел 1)
const modesBody = () => $('#kv-modes');
/** Варианты списка камер: введённые камеры и «новая камера»; short — без слова «Камера» (в таблице режимов оно в заголовке). */
const chamberOptions = (cur, short = false) =>
  visit.chambers.map((ch, j) => `<option value="${j}"${j === cur ? ' selected' : ''}>${short ? j + 1 : esc(L(`Камера ${j + 1}`, `Chamber ${j + 1}`))} — ${esc(chamberName(ch))}</option>`).join('') +
  `<option value="new">${esc(L('+ новая камера…', '+ new chamber…'))}</option>`;

/** Строка режима: номер с точкой состояния (открывает режим), диапазон, кВ, мА, фильтр, СПО и камера — ввод прямо в таблице. */
function modeRowHtml(m) {
  const md = visit.modes[m];
  const f = md.shared;
  const on = m === visit.mode;
  const who = L(`режим ${m + 1}`, `mode ${m + 1}`);
  const cap = (t) => ` data-cap="${esc(t)}"`;
  const mat = f.kv_range === 'medium' ? 'Cu' : 'Al';
  const inp = (key, label, num = true) =>
    `<input type="text"${num ? ' class="num" inputmode="decimal"' : ''} id="kvm${m}_${key}" data-k="${key}" aria-label="${esc(`${label}, ${who}`)}" value="${esc(f[key] ?? '')}">`;
  const opt = (v, t) => `<option value="${v}"${f.kv_range === v ? ' selected' : ''}>${esc(t)}</option>`;
  return `<tr data-mr="${m}"${on ? ' class="active"' : ''}>
    <td class="no"><button type="button" class="kv-mode${on ? ' active' : ''}" data-m="${m}" aria-pressed="${on}"><span class="st" aria-hidden="true"></span><b>${m + 1}</b></button></td>
    <td class="rng"${cap(L('Диапазон', 'Range'))}><select id="kvm${m}_kv_range" data-k="kv_range" aria-label="${esc(L(`Диапазон энергий, ${who}`, `Energy range, ${who}`))}">${opt('low', L('низкие', 'low'))}${opt('medium', L('средние', 'medium'))}</select></td>
    <td class="kv"${cap(L('Напряжение, кВ', 'Voltage, kV'))}>${inp('kv_kv', L('Напряжение на трубке, кВ', 'Tube voltage, kV'))}</td>
    <td class="ma"${cap(L('Ток, мА', 'Current, mA'))}>${inp('kv_ma', L('Ток трубки, мА', 'Tube current, mA'))}</td>
    <td class="flt"${cap(L('Фильтр', 'Filter'))}>${inp('kv_filter', L('Фильтр', 'Filter'), false)}</td>
    <td class="hvl"${cap(L(`СПО, мм ${mat}`, `HVL, mm ${mat}`))}><span class="hvl-in">${inp('kv_hvl', L(`СПО, мм ${mat}`, `HVL, mm ${mat}`))}<span class="u">${mat}</span></span></td>
    <td class="ch"${cap(L('Камера', 'Chamber'))}><select id="kvm${m}_ch" data-ch aria-label="${esc(L(`Камера, ${who}`, `Chamber, ${who}`))}">${chamberOptions(md.chamber, true)}</select></td>
  </tr>`;
}

/** Таблица режимов: строится заново, кроме ввода в ней самой (фокус остаётся в поле); состояние — всегда. */
function renderModes(vr, rebuild = true) {
  if (rebuild) {
    modesBody().innerHTML = visit.modes.map((_, m) => modeRowHtml(m)).join('');
    localizeDecimals(modesBody());
  }
  visit.modes.forEach((md, m) => {
    const tr = modesBody().querySelector(`tr[data-mr="${m}"]`);
    if (!tr) return;
    const on = m === visit.mode;
    const lvl = modeState(vr.modes[m], md);
    const tip = { empty: L('строки не заполнены', 'rows are empty'), ok: L('замечаний нет', 'no issues'), warn: L('есть предупреждения', 'there are warnings'), error: L('есть ошибки', 'there are errors') }[lvl];
    const title = L(`Режим ${m + 1}: ${modeName(m)}; ${tip}. Открыть в разделах формы`, `Mode ${m + 1}: ${modeName(m)}; ${tip}. Open in the form sections`);
    const b = tr.querySelector('.kv-mode');
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
    b.title = title;
    b.setAttribute('aria-label', title);
    b.querySelector('.st').className = `st ${lvl}`;
    tr.classList.toggle('active', on);
    // подсветка полей — по замечаниям выбранной строки режима; у режима без показаний не подсвечивается
    const r = vr.modes[m].results[md.active] ?? vr.modes[m].results[0];
    for (const el of tr.querySelectorAll('[data-k]')) {
      const fl = lvl === 'empty' ? null : r.flags[el.dataset.k];
      el.classList.toggle('flag-error', fl === 'error');
      el.classList.toggle('flag-warn', fl === 'warn');
    }
  });
  $('#kv-btn-del-mode').hidden = visit.modes.length <= 1;
}

/** Ввод в таблице режимов: значение — в режим; у выбранного режима — и в поле раздела 1. */
function onModeInput(el) {
  const m = Number(el.closest('tr[data-mr]')?.dataset.mr);
  const md = visit.modes[m];
  const key = el.dataset.k;
  if (!md || !key) return;
  md.shared[key] = el.value;
  if (m === visit.mode) writeDetail(key, el.value);
  openedFile = null;
  // диапазон меняет единицу СПО в строке: таблица строится заново, фокус возвращается в список
  if (key === 'kv_range') {
    update();
    $(`#kvm${m}_kv_range`)?.focus();
    return;
  }
  update({ fromModes: true });
}

/**
 * Камера режима в разделе 2 (с 0.50.0 — только показывается): «Режим 2 — камера 1: PTW 30013 № 0000». Камеру режима
 * выбирают в столбце «Камера» таблицы режимов (раздел 1), у режима из «Оборудования» — в «Оборудовании».
 */
function renderChamberPick() {
  const cur = mode().chamber;
  const linked = modeLinked(visit.mode);
  const ch = visit.chambers.length > 1 ? L(`камера ${cur + 1}: `, `chamber ${cur + 1}: `) : '';
  $('#kv-mode-chamber').textContent = L(`Режим ${visit.mode + 1} — ${ch}${chamberName(visit.chambers[cur])}`, `Mode ${visit.mode + 1}: ${ch}${chamberName(visit.chambers[cur])}`);
  const used = chamberModes(cur);
  $('#kv-btn-del-ch').hidden = visit.chambers.length <= 1 || linked;
  const where = used.length > 1 ? L(`Камера ${cur + 1} выбрана в режимах ${used.join(', ')}: поля ниже меняют её во всех этих режимах.`, `Chamber ${cur + 1} is used in modes ${used.join(', ')}: the fields below change it in all of them.`) : '';
  // у режима из «Оборудования» откуда камера — в отметке ниже (applyLock); «раздел 4» — раздел «Оборудования»
  html($('#kv-mode-chamber-sub'), linked
    ? `<span data-sec-target="equipment">${esc(L('Выбирается в «Оборудовании», раздел 2, карточка аппарата, таблица «Камеры режимов».', 'Selected in Equipment, section 2, the unit card, the Chambers of the modes table.'))}</span>`
    : esc([where, L('Камера режима выбирается в столбце «Камера» таблицы режимов (раздел 1); там же «+ новая камера…» — она берёт электрометр, T₀, P₀ и напряжения текущей.', 'The chamber of the mode is selected in the Chamber column of the modes table (section 1); “+ new chamber…” is there too: it takes the electrometer, T₀, P₀ and voltages of the current one.')].filter(Boolean).join(' ')));
}

// ------------------------------------------------------------ связь с «Оборудованием»: постоянное только показывается
// С 0.50.0: у режима, подставленного из аппарата «Оборудования», пучок (диапазон, кВ, мА, фильтр, номинальный СПО),
// камера с kV-сертификатом и аппликаторы правятся там, во вкладке поля закрыты. Электрометр (на день измерений),
// задания, показания и всё измеренное вводятся как обычно. Без аппарата из «Оборудования» вкладка работает как раньше.
/** Аппарат «Оборудования», с которым связана вкладка; null — ручной ввод (или аппарата в журнале нет). */
function linkedMachine() {
  const id = visit.common.kv_jmachine;
  return id ? getJournal().machines.find((x) => x.kind === 'kv' && x.id === id) ?? null : null;
}
/** Режим m вкладки подставлен из режима аппарата «Оборудования» (и такой режим там есть). */
function modeLinked(m, mach = linkedMachine()) {
  const id = visit.modes[m]?.shared.kv_jmode;
  return !!(mach && id && mach.modes.some((x) => x.id === id));
}
const LOCK_BEAM = ['kv_range', 'kv_kv', 'kv_ma', 'kv_filter', 'kv_hvl'];
const LOCK_CHAMBER = [
  'kv_ch_model', 'kv_cc_maker', 'kv_cc_model', 'kv_cc_type', 'kv_ch_serial', 'kv_foil', 'kv_cert_no', 'kv_cert_date', 'kv_cert_lab', 'kv_cal', 'kv_qo', 'kv_cal_depth', 'kv_cert_form', 'kv_n', 'kv_n_unit',
  'kv_lab_shape', 'kv_lab_f', 'kv_lab_ssd', 'kv_lab_phantom', 'kv_T0', 'kv_P0', 'kv_lab_pol_applied', 'kv_lab_kpol', 'kv_lab_ks_applied', 'kv_lab_ks',
];
const LOCK_ROW = ['kv_cone_shape', 'kv_cone', 'kv_cone_b', 'kv_ssd'];
const LOCK_TITLE = () => L('Из «Оборудования»: правится там', 'From Equipment: edited there');
/** Поле закрыто для правки: текстовое — только для чтения, список, флажок и кнопка — недоступны. */
function lockEl(el, on) {
  if (!el) return;
  if (el.tagName === 'INPUT' && el.type === 'text') el.readOnly = on;
  else el.disabled = on;
  el.classList.toggle('locked', on);
  if (on) el.title = LOCK_TITLE();
  else if (el.title === LOCK_TITLE()) el.removeAttribute('title');
}
/** Закрыть постоянное у режимов из «Оборудования» (таблица режимов, разделы 1, 2 и 4) и показать, где оно правится. */
function applyLock() {
  const mach = linkedMachine();
  const cur = modeLinked(visit.mode, mach);
  for (const k of [...LOCK_BEAM, ...LOCK_CHAMBER, ...LOCK_ROW]) lockEl(document.getElementById(k), cur);
  for (const el of $$('#kv-cert-rows input, #kv-cert-rows select')) lockEl(el, cur);
  for (const el of $$('[data-kv-preset]')) lockEl(el, cur);
  lockEl($('#kv-cert-add'), cur);
  $('#kv-cert-remove').disabled = cur || $$('#kv-cert-rows .pair-row').length <= 1;
  for (const tr of $$('#kv-modes tr[data-mr]')) {
    const on = modeLinked(Number(tr.dataset.mr), mach);
    for (const el of tr.querySelectorAll('[data-k], [data-ch]')) lockEl(el, on);
  }
  for (const el of $$(LOCK_ROW.map((k) => `#kv-rows-body [data-k="${k}"]`).join(', '))) lockEl(el, cur);
  lockEl($('#kv-btn-add-row'), cur);
  lockEl($('#kv-btn-add-mode'), !!mach);
  const eq = `<a href="#equipment" data-module="equipment">${esc(L('«Оборудования»', 'Equipment'))}</a>`;
  // ссылки «раздел N» в этих пояснениях — на разделы «Оборудования»
  const eqSec = (t) => `<span data-sec-target="equipment">${esc(t)}</span>`;
  const chNote = $('#kv-ch-lock');
  chNote.hidden = !cur;
  if (cur) html(chNote, L(`Камера и kV-сертификат — из ${eq} (${eqSec('раздел 4, карточка камеры')}): здесь они только показываются. Электрометр, напряжения и полярность можно задать на день измерений. Пересчёт СПО по DIN 6809-4 из окна пересчёта записывается в kV-сертификат камеры.`, `The chamber and the kV certificate come from ${eq} (${eqSec('section 4, the chamber card')}): here they are only shown. The electrometer, voltages and polarity can be set for the day of measurement. The DIN 6809-4 HVL conversion chosen in the conversion window is saved to the kV certificate of the chamber.`));
  // kV-сертификат на дату измерения (с 0.53.0): дата раньше действующего — сертификат из истории камеры
  const vc = visit.chambers[mode().chamber] ?? {};
  const onDate = $('#kv-cert-on-date');
  const src = cur ? String(vc.kv_cert_src ?? '') : '';
  onDate.hidden = !src;
  if (src) {
    html(onDate, src === 'newer'
      ? L(`Дата измерения раньше действующего kV-сертификата камеры (№ ${esc(vc.kv_cert_no || '—')} от ${esc(vc.kv_cert_date ? dateText(vc.kv_cert_date) : '—')}), а прежнего в истории камеры нет: расчёт — по действующему. Если измерение считалось по прежнему сертификату, внесите его в историю камеры (${eqSec('раздел 4, карточка камеры')}).`, `The measurement date is earlier than the current kV certificate of the chamber (No. ${esc(vc.kv_cert_no || '—')} of ${esc(vc.kv_cert_date ? dateText(vc.kv_cert_date) : '—')}), and the chamber history has no earlier one: the calculation uses the current one. If the measurement was calculated with the earlier certificate, add it to the chamber history (${eqSec('section 4, the chamber card')}).`)
      : src === 'early'
      ? L(`Дата измерения раньше всех kV-сертификатов камеры в «Оборудовании»: подставлен самый ранний из истории (№ ${esc(vc.kv_cert_no || '—')}). Проверьте, по какому сертификату считалось это измерение.`, `The measurement date is earlier than all kV certificates of the chamber in Equipment: the earliest one from the history is used (No. ${esc(vc.kv_cert_no || '—')}). Check which certificate this measurement was calculated with.`)
      : L(`Дата измерения раньше действующего kV-сертификата камеры: подставлен сертификат из истории (${eqSec('раздел 4, карточка камеры')}), действовавший на эту дату.`, `The measurement date is earlier than the current kV certificate of the chamber: the certificate from the history (${eqSec('section 4, the chamber card')}) valid on that date is used.`));
  }
  const rowNote = $('#kv-rows-lock');
  rowNote.hidden = !cur;
  if (cur) html(rowNote, L(`Аппликаторы режима — из ${eq} (${eqSec('раздел 2, аппарат')}): форма, размер и РИП здесь не правятся; лишнюю строку можно удалить.`, `The applicators of the mode come from ${eq} (${eqSec('section 2, the unit')}): the shape, size and SSD are not edited here; an unneeded row can be deleted.`));
}

/**
 * «Подставить в расчёт» / «Не пересчитывать» и флажок пересчёта СПО по DIN 6809-4 у режима из «Оборудования»: выбор —
 * часть kV-сертификата камеры, он записывается и в её запись журнала.
 */
function syncDinToJournal() {
  const mach = linkedMachine();
  if (!modeLinked(visit.mode, mach)) return;
  const x = mach.modes.find((y) => y.id === mode().shared.kv_jmode);
  const on = !!$('#kv_cq_din').checked;
  // вкладка прошлой даты с сертификатом из истории: действующий kV-сертификат камеры её выбором не меняется
  if (['history', 'early'].includes(String(visit.chambers[mode().chamber]?.kv_cert_src ?? ''))) return;
  let done = false;
  updateJournal((j) => {
    const ch = j.chambers.find((c) => c.id === x?.chamberId);
    if (!ch || !!ch.kv?.kv_cq_din === on) return j;
    ch.kv = { ...(ch.kv ?? {}), kv_cq_din: on };
    done = true;
    return j;
  }, 'kv');
  if (done) setStatus(L(`Пересчёт СПО по DIN 6809-4 ${on ? 'включён' : 'выключен'} и записан в kV-сертификат камеры в «Оборудовании». Сохраните журнал в файл.`, `The DIN 6809-4 HVL conversion is ${on ? 'on' : 'off'} and saved to the kV certificate of the chamber in Equipment. Save the journal to the file.`));
}

/** Номер режима и камеры у заголовков разделов 2–8, если их несколько. */
function renderSectionTags() {
  const tag = (id, t) => {
    const h = document.getElementById(id);
    if (!h) return;
    if (t) h.dataset.tag = t;
    else h.removeAttribute('data-tag');
  };
  const mt = visit.modes.length > 1 ? L(` · режим ${visit.mode + 1}`, ` · mode ${visit.mode + 1}`) : '';
  for (const id of ['kv-sh1', 'kv-s3', 'kv-ln1', 'kv-rp1', 'kv-s4', 'kv-s5', 'kv-s6', 'kv-s7', 'kv-s8']) tag(id, mt);
  tag('kv-s2', visit.chambers.length > 1 ? L(` · камера ${mode().chamber + 1}`, ` · chamber ${mode().chamber + 1}`) : '');
}

/** Что взято из журнала (последняя калибровка режима): «k_pol, τ и СПО» и дата; null — ничего. */
function journalUsed(mr) {
  const jx = mr.jx;
  if (!jx) return null;
  const names = [['pol', 'k_pol'], ['ks', 'k_s'], ['tau', 'τ'], ['hvl', L('СПО', 'HVL')]].filter(([k]) => jx[k]).map(([, n]) => n);
  if (!names.length) return null;
  const date = jx.pol?.date ?? jx.ks?.date ?? jx.tau?.date ?? jx.hvl?.date ?? jx.cal?.date ?? '';
  const and = L(' и ', ' and ');
  return { names: names.length > 1 ? `${names.slice(0, -1).join(', ')}${and}${names[names.length - 1]}` : names[0], date };
}

/** Что взято из других режимов и из журнала: «k_pol и τ — из режима 1 (…)», «k_pol и СПО — из калибровки 15.09.2026». */
function borrowedText(mr) {
  const by = new Map();
  for (const [key, name] of [['polMode', 'k_pol'], ['ksMode', 'k_s'], ['tauMode', 'τ']]) {
    const j = mr[key];
    if (j >= 0) by.set(j, [...(by.get(j) ?? []), name]);
  }
  const out = [...by].map(([j, names]) => L(`${names.join(' и ')} — из ${kvModeFrom(visit, j)}`, `${names.join(' and ')} from ${kvModeFrom(visit, j)}`));
  const ju = journalUsed(mr);
  if (ju) out.push(L(`${ju.names} — из ${kvJournalFrom(ju.date)}`, `${ju.names} from ${kvJournalFrom(ju.date)}`));
  return out.join('; ');
}

/** Сводка по режимам (раздел 9): все режимы и строки, итог, отклонение и состояние; номер строки открывает её. */
function renderSummary(vr) {
  const cap = (t) => ` data-cap="${esc(t)}"`;
  const trs = [];
  const notes = [];
  visit.modes.forEach((md, m) => {
    const mr = vr.modes[m];
    md.rows.forEach((row, i) => {
      const r = mr.results[i];
      const x = r.trs;
      const p = primaryOf(x);
      const none = x.blocked || ctrlFailed(x);
      const v = none ? NaN : valueAt(p, r);
      const dev = none ? NaN : p.deviation;
      const tol = r.cmp.tolerance;
      const devCls = !Number.isFinite(dev) ? '' : Math.abs(dev) <= tol / 2 ? ' good' : Math.abs(dev) > tol ? ' bad' : '';
      const { lvl, tip } = rowState(r, row);
      const on = m === visit.mode && i === md.active;
      const std = md.rows.length > 1 && i === mr.stdRow;
      const unit = `${x.rateLabel}, ${whereText(r, atSurfOf(p, r))}`;
      const ref = Number.isFinite(r.cmp.ref) ? fmt(r.cmp.ref, 4) : '—';
      trs.push(`<tr data-m="${m}" data-i="${i}" class="${i === 0 ? 'grp' : ''}${on ? ' active' : ''}">
        <td class="no"><button type="button" class="kv-sum-pick" aria-label="${esc(L(`Открыть режим ${m + 1}, строку ${i + 1}`, `Open mode ${m + 1}, row ${i + 1}`))}">${m + 1}.${i + 1}</button></td>
        <td class="mode"${cap(L('Режим', 'Mode'))}>${i === 0 ? esc(modeName(m)) : ''}</td>
        <td class="ch"${cap(L('Камера', 'Chamber'))}>${i === 0 ? esc(L(`камера ${md.chamber + 1}`, `chamber ${md.chamber + 1}`)) : ''}</td>
        <td class="app"${cap(L('Аппликатор', 'Applicator'))}>${esc(kvRowLabel(row) || '—')}${std ? ` <span class="kv-std" title="${esc(L('Стандартный тубус', 'Reference applicator'))}">${L('ст.', 'ref.')}</span>` : ''}</td>
        <td class="v ssd"${cap(L('РИП, см', 'SSD, cm'))}>${esc(String(row.kv_ssd ?? '').trim() || '—')}</td>
        <td class="v d"${cap('D')}>${Number.isFinite(v) ? fmt(v, 4) : '—'}<small>${esc(unit)}</small></td>
        <td class="v ref"${cap(L('Сравнить с', 'Compare with'))}>${ref}</td>
        <td class="v dev${devCls}"${cap(L('Откл., %', 'Dev., %'))}>${fmtSigned(dev, 2)}</td>
        <td class="act"><span class="st ${lvl}" role="img" title="${esc(tip)}" aria-label="${esc(tip)}"></span></td>
      </tr>`);
    });
    const b = borrowedText(mr);
    if (b) notes.push(L(`Режим ${m + 1}: ${b}.`, `Mode ${m + 1}: ${b}.`));
  });
  html($('#kv-sum-body'), trs.join(''));
  localizeDecimals($('#kv-sum-body'));
  const note = $('#kv-sum-note');
  note.hidden = !notes.length;
  html(note, richText(notes.join(' ')));
}

// ------------------------------------------------------------ ошибка таймера по режимам (раздел 3)
const timerBody = () => $('#kv-timer-body');
/** Ячеек показаний в строке таблицы таймера: не меньше трёх и не меньше введённых (больше — кнопкой «+» выше). */
const tpCount = (a) => Math.max(3, Array.isArray(a) ? a.length : 0);
const isTimeUnit = (u) => !!KV_SET_UNITS[u]?.time;
/** Знаков после запятой у допуска на |τ|: как введено, до двух. */
const tolDigits = (x) => (Number.isInteger(x) ? 0 : Number.isInteger(Math.round(x * 1e6) / 1e5) ? 1 : 2);
/** Единица T₁, T₂ и τ режима в таблице: секунды при задании по времени, иначе единица задания. */
const tpUnit = (f) => (isTimeUnit(f.kv_set_unit) ? L('с', 's') : L(KV_SET_UNITS[f.kv_set_unit]?.label ?? '', KV_SET_UNITS[f.kv_set_unit]?.labelEn ?? ''));
/** Способ ошибки таймера, данные которого в таблицу не помещаются: что о нём сказать в строке режима. */
function timerMethodText(f) {
  switch (f.kv_timer_mode) {
    case 'measured': return L('серия облучений с разным заданием — данные выше, в разделе 3 этого режима', 'series of exposures with different settings: the data are above, in section 3 of this mode');
    case 'nexp': return L('одно облучение X против n облучений по X/n — данные выше, в разделе 3 этого режима', 'one exposure X vs. n exposures of X/n: the data are above, in section 3 of this mode');
    case 'manual': return L('известное значение — выше, в разделе 3 этого режима', 'known value: above, in section 3 of this mode');
    case 'window': return L('заряд накоплен при включённой трубке: τ в дозу не входит', 'charge collected with the tube on: τ does not enter the dose');
    default: return L('не учитывается', 'disregarded');
  }
}

function timerRowHtml(m) {
  const f = visit.modes[m].shared;
  const on = m === visit.mode;
  const u = tpUnit(f);
  const who = L(`режим ${m + 1}`, `mode ${m + 1}`);
  const cap = (t) => ` data-cap="${esc(t)}"`;
  const inp = (key, value, label, j = null) =>
    `<input type="text" class="num" inputmode="decimal" id="kvt${m}_${key}${j === null ? '' : `_${j}`}" data-k="${key}"${j === null ? '' : ` data-j="${j}"`} aria-label="${esc(`${label}, ${who}`)}" value="${esc(value ?? '')}">`;
  const cells = (key, t) => `<span class="m-in">${Array.from({ length: tpCount(f[key]) }, (_, j) => inp(key, f[key]?.[j], L(`Показание при ${t} № ${j + 1}, нКл`, `Reading at ${t} no. ${j + 1}, nC`), j)).join('')}</span>`;
  const body = f.kv_timer_mode === 'twopoint'
    ? `<td class="t t1"${cap(`T₁, ${u}`)}>${inp('kv_tp_t1', f.kv_tp_t1, L(`Задание T₁, ${u}`, `Setting T₁, ${u}`))}</td>
      <td class="r r1"${cap(L('Показания при T₁, нКл', 'Readings at T₁, nC'))}>${cells('kv_tp_R1', 'T₁')}</td>
      <td class="t t2"${cap(`T₂, ${u}`)}>${inp('kv_tp_t2', f.kv_tp_t2, L(`Задание T₂, ${u}`, `Setting T₂, ${u}`))}</td>
      <td class="r r2"${cap(L('Показания при T₂, нКл', 'Readings at T₂, nC'))}>${cells('kv_tp_R2', 'T₂')}</td>`
    : `<td class="other" colspan="4">${esc(timerMethodText(f))}</td>`;
  return `<tr data-m="${m}"${on ? ' class="active"' : ''}>
    <td class="no"><button type="button" class="kv-tm-pick" aria-pressed="${on}" aria-label="${esc(L(`Режим ${m + 1}: открыть в разделах формы`, `Mode ${m + 1}: open in the form sections`))}" title="${esc(L('Открыть режим в разделах формы', 'Open the mode in the form sections'))}">${m + 1}</button></td>
    <td class="mode"${cap(L('Режим', 'Mode'))}>${esc(modeName(m))}</td>
    ${body}
    <td class="v tau" data-o="tau"${cap(`τ, ${u}`)}></td>
    <td class="act"><span class="st" role="img"></span></td>
  </tr>`;
}

/** Число с n значащими цифрами. */
const sigFmt = (v, n = 5) => {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  return fmt(v, a > 0 ? Math.max(0, Math.min(8, n - 1 - Math.floor(Math.log10(a)))) : 0);
};

/**
 * График ошибки таймера, как в книге учреждения: по оси x — показание, по оси y — задание облучения. Прямая — та же, по
 * которой посчитана τ (R = Ṁ·(T + τ), т. е. T = R/Ṁ − τ): при нулевом показании она проходит через T = −τ.
 */
function renderTimerChart(data, result) {
  const wrap = $('#kv-timer-chart-wrap');
  const t = result.timer;
  const U = KV_SET_UNITS[data.kv_set_unit] ?? KV_SET_UNITS.min;
  let unit = L(U.label, U.labelEn);
  let pts = [];
  const raw = [];
  let k = NaN;
  let tau = NaN;
  if (data.kv_timer_mode === 'measured' && Number.isFinite(t.slope) && Array.isArray(t.points) && !t.from) {
    // только средние при каждом задании: по ним проведена прямая
    const tu = KV_SET_UNITS[t.tUnit] ?? U;
    unit = L(tu.label, tu.labelEn);
    pts = t.points.map((p) => ({ x: p.mean, y: p.t, n: p.n }));
    k = 1 / t.slope;
    tau = t.tauT;
  } else if (data.kv_timer_mode === 'twopoint' && Number.isFinite(t.tauT) && !t.from) {
    if (U.time) unit = L('с', 's');
    pts = [{ x: t.R1, y: t.t1 }, { x: t.R2, y: t.t2 }];
    for (const [key, T] of [['kv_tp_R1', t.t1], ['kv_tp_R2', t.t2]]) for (const v of parseCells(data[key]).values) raw.push({ x: Math.abs(v), y: T, hollow: true });
    k = (t.t2 - t.t1) / (t.R2 - t.R1);
    tau = t.tauT;
  }
  wrap.hidden = pts.length < 2 || !Number.isFinite(k) || !Number.isFinite(tau);
  if (wrap.hidden) return;
  const n = pts.length;
  // τ — с теми же знаками, что в таблице по режимам и выводах: секунды — два, иначе — четыре
  const tDig = unit === L('с', 's') ? 2 : 4;
  // R² — квадрат коэффициента корреляции (тот же для прямой T(R) и R(T))
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const syy = pts.reduce((s, p) => s + (p.y - my) ** 2, 0);
  const r2 = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : NaN;
  const xMax = Math.max(...pts.map((p) => p.x), ...raw.map((p) => p.x));
  const tip = (p) => L(`задание ${sigFmt(p.y)} ${unit}, показание ${sigFmt(p.x)} нКл`, `setting ${sigFmt(p.y)} ${unit}, reading ${sigFmt(p.x)} nC`);
  const meanTip = (p) => (p.n ? L(`среднее из ${p.n}: `, `mean of ${p.n}: `) : raw.length ? L('среднее: ', 'mean: ') : '');
  const series = [];
  if (raw.length) series.push({ cls: 's1', points: raw.map((p) => ({ ...p, title: tip(p) })) });
  series.push({ cls: 's1', points: pts.map((p) => ({ ...p, title: meanTip(p) + tip(p) })) });
  series.push({ cls: 's2', shape: 'diamond', points: [{ x: 0, y: -tau, title: L(`T = −τ = ${fmtSigned(-tau, tDig)} ${unit}`, `T = −τ = ${fmtSigned(-tau, tDig)} ${unit}`) }] });
  scatterChart($('#kv-timer-chart'), {
    label: L('Ошибка таймера: задание облучения от показания электрометра', 'Timer error: exposure setting versus electrometer reading'),
    xLabel: L('Показание электрометра, нКл', 'Electrometer reading, nC'),
    yLabel: L(`Задание T, ${unit}`, `Setting T, ${unit}`),
    fmt,
    xInclude: [0],
    yInclude: [0, -tau],
    aspect: 0.5,
    series,
    lines: [{ cls: 's1', a: -tau, b: k, x0: 0, x1: xMax * 1.05 }],
    notes: [{ x: 0, y: -tau, text: `−τ`, below: tau > 0 }],
  });
  const items = [[legendSwatch({ cls: 's1' }), raw.length ? L('средние показания при T₁ и T₂', 'mean readings at T₁ and T₂') : L('средние показания при каждом задании', 'mean readings at each setting')]];
  if (raw.length) items.push([legendSwatch({ cls: 's1', hollow: true }), L('отдельные показания', 'individual readings')]);
  items.push([legendSwatch({ line: true, cls: 's1' }), L('прямая T = k·M + c', 'line T = k·M + c')]);
  items.push([legendSwatch({ cls: 's2', shape: 'diamond' }), L('пересечение с осью задания: T = −τ', 'intercept on the setting axis: T = −τ')]);
  html($('#kv-timer-legend'), items.map(([sw, s]) => `<span class="item">${sw}<span>${esc(s)}</span></span>`).join(''));
  const c = -tau;
  const r2Txt = n > 2 ? `, R² = ${fmt(r2, 5)}` : L(' (через две точки)', ' (through two points)');
  html(
    $('#kv-timer-eq'),
    richText(
      L(
        `Прямая: T = ${sigFmt(k)}·M ${c < 0 ? '−' : '+'} ${sigFmt(Math.abs(c))} ${unit}${r2Txt}. При нулевом показании задание равно −τ, откуда τ = ${fmtSigned(tau, tDig)} ${unit}. Это та же τ, что входит в дозу: D/(X + τ).`,
        `Line: T = ${sigFmt(k)}·M ${c < 0 ? '−' : '+'} ${sigFmt(Math.abs(c))} ${unit}${r2Txt}. At zero reading the setting equals −τ, hence τ = ${fmtSigned(tau, tDig)} ${unit}. This is the same τ that enters the dose: D/(X + τ).`,
      ),
    ),
  );
}

/** Таблица ошибки таймера по режимам: строится заново, кроме ввода в ней самой (фокус остаётся в поле). */
function renderTimerTable() {
  const block = $('#kv-timer-block');
  block.hidden = visit.modes.length <= 1;
  if (block.hidden) return;
  timerBody().innerHTML = visit.modes.map((_, m) => timerRowHtml(m)).join('');
  localizeDecimals(timerBody());
}

/** Поля таймера в замечаниях режима: по ним — подсветка полей строки таблицы и её состояние. */
const TIMER_FLAG_KEYS = ['kv_tp_t1', 'kv_tp_t2', 'kv_tp_R1', 'kv_tp_R2', 'kv_timer', 'kv_nx_t', 'kv_nx_n', 'kv_nx_M1', 'kv_nx_Mn', 'kv_tau', 'kv_timer_mode', 'kv_tau_tol'];

/** Состояние ошибки таймера режима для точки в таблице и подсказка. */
function timerRowState(m, mr) {
  const r = mr.results[visit.modes[m].active] ?? mr.results[0];
  const t = r.timer;
  const lv = (k) => r.flags[k];
  const err = TIMER_FLAG_KEYS.some((k) => lv(k) === 'error');
  const warn = TIMER_FLAG_KEYS.some((k) => lv(k) === 'warn');
  const st = mr.timer.state;
  if (st === 'none' && mr.tauMode < 0 && !mr.jx?.tau && !err) return { lvl: 'empty', tip: L('Показаний ещё нет', 'No readings yet') };
  if (err) return { lvl: 'error', tip: L(`Ошибка в данных ошибки таймера: см. замечания режима ${m + 1}`, `The timer error data contain an error: see the messages of mode ${m + 1}`) };
  if (st === 'none') {
    const src = mr.jx?.tau ? kvJournalFrom(mr.jx.tau.date) : kvModeFrom(visit, mr.tauMode);
    return { lvl: 'empty', tip: L(`Своих показаний нет: τ — из ${src}`, `No readings of its own: τ from ${src}`) };
  }
  if (st === 'off') return { lvl: 'empty', tip: L('Ошибка таймера не учитывается', 'The timer error is disregarded') };
  if (st === 'window') return { lvl: 'empty', tip: L('Заряд накоплен при включённой трубке: τ в дозу не входит', 'Charge collected with the tube on: τ does not enter the dose') };
  const tolTxt = (x) => fmt(x, tolDigits(x));
  if (t.tol && !t.inTol) return { lvl: 'warn', tip: L(`|τ| больше допуска ${tolTxt(t.tol)} с`, `|τ| exceeds the tolerance of ${tolTxt(t.tol)} s`) };
  if (warn) return { lvl: 'warn', tip: L(`Есть предупреждения: см. замечания режима ${m + 1}`, `There are warnings: see the messages of mode ${m + 1}`) };
  return { lvl: 'ok', tip: t.tol ? L(`В допуске ${tolTxt(t.tol)} с`, `Within the tolerance of ${tolTxt(t.tol)} s`) : L('Замечаний нет', 'No issues') };
}

/** τ, подсветка полей и состояние строк таблицы таймера; итог по допуску — под таблицей. */
function renderTimerState(vr) {
  if ($('#kv-timer-block').hidden) return;
  const over = [];
  let tol = NaN;
  vr.modes.forEach((mr, m) => {
    const tr = timerBody().querySelector(`tr[data-m="${m}"]`);
    if (!tr) return;
    const f = visit.modes[m].shared;
    const r = mr.results[visit.modes[m].active] ?? mr.results[0];
    const t = r.timer;
    const { lvl, tip } = timerRowState(m, mr);
    const time = isTimeUnit(f.kv_set_unit);
    const v = time ? t.tauS : t.tau;
    const shown = mr.timer.state === 'own' || mr.tauMode >= 0 || mr.jx?.tau ? v : NaN;
    const from = mr.jx?.tau
      ? `<small>${esc(L(`из калибровки ${dateText(mr.jx.tau.date)}`, `from the calibration of ${dateText(mr.jx.tau.date)}`))}</small>`
      : mr.tauMode >= 0 ? `<small>${esc(L(`из режима ${mr.tauMode + 1}`, `from mode ${mr.tauMode + 1}`))}</small>` : '';
    html(tr.querySelector('[data-o="tau"]'), Number.isFinite(shown) && lvl !== 'error' ? `${fmtSigned(shown, time ? 2 : 3)} ${esc(tpUnit(f))}${from}` : '—');
    const stEl = tr.querySelector('.st');
    stEl.className = `st ${lvl}`;
    stEl.title = tip;
    stEl.setAttribute('aria-label', tip);
    for (const el of tr.querySelectorAll('[data-k]')) {
      const fl = lvl === 'empty' ? null : r.flags[el.dataset.k];
      el.classList.toggle('flag-error', fl === 'error');
      el.classList.toggle('flag-warn', fl === 'warn');
    }
    const on = m === visit.mode;
    tr.classList.toggle('active', on);
    tr.querySelector('.kv-tm-pick').setAttribute('aria-pressed', String(on));
    if (t.tol) tol = t.tol;
    if (t.tol && !t.inTol) over.push(m + 1);
  });
  localizeDecimals(timerBody());
  const note = $('#kv-timer-note');
  const tolRaw = String(visit.common.kv_tau_tol ?? '').trim();
  const txt = !tolRaw
    ? L('Допуск на |τ| не задан (поле «Допуск на |τ|, с» выше): τ не сравнивается с допуском.', 'No |τ| tolerance is set (the "Tolerance on |τ|, s" field above): τ is not compared with a tolerance.')
    : !Number.isFinite(tol)
      ? ''
      : over.length
        ? L(`Допуск |τ| ≤ ${fmt(tol, tolDigits(tol))} с (по методике учреждения): больше допуска — ${over.length > 1 ? 'режимы' : 'режим'} ${over.join(', ')}.`, `Tolerance |τ| ≤ ${fmt(tol, tolDigits(tol))} s (local procedure): exceeded in ${over.length > 1 ? 'modes' : 'mode'} ${over.join(', ')}.`)
        : L(`Допуск |τ| ≤ ${fmt(tol, tolDigits(tol))} с (по методике учреждения): у всех режимов со своей τ — в допуске.`, `Tolerance |τ| ≤ ${fmt(tol, tolDigits(tol))} s (local procedure): all modes with their own τ are within it.`);
  note.hidden = !txt;
  note.textContent = txt;
}

/** Ввод в таблице таймера: значение — в режим; у выбранного режима — и в поле раздела 3. */
function onTimerInput(el) {
  const m = Number(el.closest('tr[data-m]')?.dataset.m);
  const md = visit.modes[m];
  const key = el.dataset.k;
  if (!md || !key) return;
  if (el.dataset.j !== undefined) {
    const j = Number(el.dataset.j);
    const a = Array.isArray(md.shared[key]) ? [...md.shared[key]] : [];
    while (a.length <= j) a.push('');
    a[j] = el.value;
    md.shared[key] = a;
  } else md.shared[key] = el.value;
  if (m === visit.mode) writeDetail(key, md.shared[key]);
  openedFile = null;
  update({ fromTimer: true });
}

/** Переход к режиму m: его камера, пучок и выбранная строка — в разделы формы. */
function selectMode(m) {
  if (m === visit.mode || !visit.modes[m]) return;
  visit.mode = m;
  writeForm(rowForm(sess.active));
  update();
  $(`#kv-modes [data-m="${m}"]`)?.focus();
}

function addMode() {
  visit.modes.push(newKvMode(mode()));
  visit.mode = visit.modes.length - 1;
  writeForm(rowForm(0));
  openedFile = null;
  update();
  $('#kv_kv').focus();
  setStatus(L(`Добавлен режим ${visit.mode + 1}: введите напряжение и СПО. Камера, фантом и тубусы — как в предыдущем режиме.`, `Mode ${visit.mode + 1} added: enter the voltage and HVL. The chamber, phantom and applicators are as in the previous mode.`));
}

function deleteMode() {
  if (visit.modes.length <= 1) return;
  const m = visit.mode;
  visit.modes.splice(m, 1);
  visit.mode = Math.min(m, visit.modes.length - 1);
  writeForm(rowForm(sess.active));
  openedFile = null;
  update();
  setStatus(L(`Режим ${m + 1} удалён.`, `Mode ${m + 1} deleted.`));
}

/**
 * Камера режима m (по умолчанию выбранного): одна из введённых камер или новая. Новая камера открывается в разделе 2
 * вместе с режимом: там вводятся модель и сертификат.
 */
function pickChamber(value, m = visit.mode) {
  const md = visit.modes[m];
  if (!md) return;
  const isNew = value === 'new';
  if (isNew) {
    visit.chambers.push(newKvChamber(visit.chambers[md.chamber]));
    md.chamber = visit.chambers.length - 1;
    visit.mode = m;
  } else if (visit.chambers[Number(value)]) md.chamber = Number(value);
  writeForm(rowForm(sess.active));
  openedFile = null;
  update();
  if (isNew) setStatus(L(`Режим ${m + 1}: добавлена камера ${md.chamber + 1}. Выберите модель и введите сертификат в разделе 2.`, `Mode ${m + 1}: chamber ${md.chamber + 1} added. Select the model and enter the certificate in section 2.`));
}

/** Камера, на которую переходят режимы удаляемой камеры k: первая из оставшихся (номер до удаления). */
const chamberHeir = (k) => (k === 0 ? 1 : 0);
/** «режим 2» или «режимы 1, 2, 3». */
const modesWord = (list) => (list.length > 1 ? L(`режимы ${list.join(', ')}`, `modes ${list.join(', ')}`) : L(`режим ${list[0]}`, `mode ${list[0]}`));
/** Подтверждение удаления камеры выбранного режима: какие режимы и на какую камеру перейдут. */
function deleteChamberQuestion() {
  const k = mode().chamber;
  const h = chamberHeir(k);
  const used = chamberModes(k);
  return L(`Точно удалить камеру ${k + 1}? ${used.length > 1 ? 'Режимы' : 'Режим'} ${used.join(', ')} ${used.length > 1 ? 'перейдут' : 'перейдёт'} на камеру ${h + 1}.`, `Delete chamber ${k + 1}? ${used.length > 1 ? 'Modes' : 'Mode'} ${used.join(', ')} will use chamber ${h + 1}.`);
}
/** Удаление камеры выбранного режима (любой, пока камер больше одной): её режимы переходят на первую из оставшихся. */
function deleteChamber() {
  const k = mode().chamber;
  if (visit.chambers.length <= 1) return;
  const h = chamberHeir(k);
  const used = chamberModes(k);
  visit.chambers.splice(k, 1);
  const nh = h > k ? h - 1 : h;
  for (const md of visit.modes) md.chamber = md.chamber === k ? nh : md.chamber > k ? md.chamber - 1 : md.chamber;
  writeForm(rowForm(sess.active));
  openedFile = null;
  update();
  const name = chamberName(visit.chambers[nh]);
  setStatus(L(`Камера ${k + 1} удалена; ${modesWord(used)} — с камерой ${nh + 1} (${name}).`, `Chamber ${k + 1} deleted; ${modesWord(used)} now ${used.length > 1 ? 'use' : 'uses'} chamber ${nh + 1} (${name}).`));
}

/** Строка i режима m из сводки: режим и строка выбираются, фокус — на номер строки в таблице раздела 4. */
function openRow(m, i) {
  if (!visit.modes[m]?.rows[i]) return;
  visit.mode = m;
  visit.modes[m].active = i;
  writeForm(rowForm(i));
  update();
  showPage('dose');
  rowsBody().querySelector(`tr[data-i="${i}"] .kv-row-pick`)?.focus();
}

// ------------------------------------------------------------ листы вкладки (как ярлыки листов в Excel)
// Разделы формы разнесены по листам (data-kv-page); виден один лист, у каждого — своя ссылка #kv/<лист>.
// Печать и PDF — все разделы, как раньше, кроме протокола измерений: он печатается отдельно (лист «Сводка и протокол»).
const PAGE_KEY = 'reference-dosimetry.kv.page';
const KV_PAGES = ['modes', 'hvl', 'timer', 'linearity', 'repro', 'dose', 'summary'];
const WIP_PAGES = new Set();
/** Листы по выбранному режиму: над ними — строка выбора режима (при двух режимах и больше). */
const MODE_PAGES = new Set(['hvl', 'timer', 'linearity', 'repro', 'dose']);
const pageOf = (key) => (KV_PAGES.includes(key) ? key : 'modes');
let page = (() => {
  try {
    return pageOf(localStorage.getItem(PAGE_KEY));
  } catch {
    return 'modes';
  }
})();
const pageFromHash = () => /^#kv\/([a-z]+)$/.exec(location.hash)?.[1];

/** Открыть лист: его разделы видны, остальные скрыты; адрес — #kv/<лист>, если вкладка открыта. */
function showPage(key, { hash = true } = {}) {
  page = pageOf(key);
  for (const el of $$('#kv-sheet [data-kv-page]')) el.classList.toggle('page-off', el.dataset.kvPage !== page);
  const nav = $('#kv-pages');
  for (const a of $$('a[data-kv-go]', nav)) {
    if (a.dataset.kvGo !== page) {
      a.removeAttribute('aria-current');
      continue;
    }
    a.setAttribute('aria-current', 'page');
    // на телефоне ряд ярлыков прокручивается вбок: открытый лист — в видимой части ряда
    if (nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, a.offsetLeft - nav.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2);
  }
  try {
    localStorage.setItem(PAGE_KEY, page);
  } catch {
    /* хранилище недоступно */
  }
  if (hash && !ROOT().hidden && location.hash !== `#kv/${page}`) {
    try {
      history.replaceState(null, '', `#kv/${page}`);
    } catch {
      /* в некоторых просмотрщиках адрес не меняется */
    }
  }
  renderModeBar();
  refreshSectionNav(ROOT());
}

/** Вкладка открыта (app.js): лист из адреса #kv/<лист>, иначе тот, с которым работали. */
export function kvShown() {
  const h = pageFromHash();
  showPage(KV_PAGES.includes(h) ? h : page);
}

/** Строка выбора режима над листами «СПО и k_Q», «Ошибка таймера» и «Поглощённая доза». */
function renderModeBar() {
  const bar = $('#kv-modebar');
  if (!bar || !current) return;
  const show = MODE_PAGES.has(page) && visit.modes.length > 1;
  bar.hidden = !show;
  if (!show) return;
  html(
    $('#kv-modebar-list'),
    visit.modes
      .map((md, m) => {
        const on = m === visit.mode;
        const lvl = modeState(current.vr.modes[m], md);
        const kv = String(md.shared.kv_kv ?? '').trim();
        const title = L(`Режим ${m + 1}: ${modeName(m)}`, `Mode ${m + 1}: ${modeName(m)}`);
        return `<button type="button" class="kv-mode${on ? ' active' : ''}" data-m="${m}" aria-pressed="${on}" title="${esc(title)}"><span class="st ${lvl}" aria-hidden="true"></span><b>${m + 1}</b>${kv ? ` ${esc(kv)} ${L('кВ', 'kV')}` : ''}</button>`;
      })
      .join(''),
  );
}

/**
 * Состояние листа по форме: ошибка или предупреждение (подсвеченные поля), заполнен, пуст. Лист дозы — худшее из
 * состояний режимов (по строкам аппликаторов), заготовки — «готовится», сводка — без отметки.
 */
function pageState(key) {
  if (WIP_PAGES.has(key)) return 'wip';
  if (key === 'summary') return 'none';
  if (key === 'dose') {
    let lvl = 'empty';
    visit.modes.forEach((md, m) => {
      const l = modeState(current.vr.modes[m], md);
      if (LVL_RANK[l] > LVL_RANK[lvl]) lvl = l;
    });
    return lvl === 'ok' ? 'done' : lvl;
  }
  const shown = (el) => !el.closest('[hidden]');
  if (key === 'linearity' || key === 'repro') {
    // худшее из проверок всех режимов; подсветка полей выбранного режима — поверх
    const st = qaPageState(current.vr, key);
    const secs = $$(`#kv-sheet [data-kv-page="${key}"]`);
    if (st === 'error' || secs.some((sec) => [...sec.querySelectorAll('.flag-error')].some(shown))) return 'error';
    if (st === 'warn' || secs.some((sec) => [...sec.querySelectorAll('.flag-warn')].some(shown))) return 'warn';
    return st;
  }
  let st = 'empty';
  if (key === 'hvl') {
    // лист СПО — худшее из измерений всех режимов (форма показывает только выбранный режим)
    const rank = { empty: 0, done: 1, warn: 2, error: 3 };
    for (const { hvl: h } of current.vr.modes) {
      const l = h.state === 'empty' ? 'empty' : h.state === 'error' || h.messages.some((m) => m.level === 'error') ? 'error' : h.messages.some((m) => m.level === 'warn') ? 'warn' : 'done';
      if (rank[l] > rank[st]) st = l;
    }
    if (st === 'error') return st;
  }
  for (const sec of $$(`#kv-sheet [data-kv-page="${key}"]`)) {
    if ([...sec.querySelectorAll('.flag-error')].some(shown)) return 'error';
    if ([...sec.querySelectorAll('.flag-warn')].some(shown)) st = 'warn';
    else if (st === 'empty' && [...sec.querySelectorAll('input[type="text"], input[type="date"], textarea')].some((f) => shown(f) && f.value.trim() !== '')) st = 'done';
  }
  return st;
}
const PAGE_STATE_TEXT = () => ({
  wip: L('лист готовится', 'sheet in preparation'),
  empty: L('не заполнен', 'not filled in'),
  done: L('заполнен', 'filled in'),
  warn: L('есть предупреждения', 'has warnings'),
  error: L('есть ошибки', 'has errors'),
  none: '',
});
function renderPageStates() {
  const texts = PAGE_STATE_TEXT();
  for (const a of $$('#kv-pages a[data-kv-go]')) {
    const st = pageState(a.dataset.kvGo);
    a.dataset.state = st;
    const name = a.textContent.replace(/\s+/g, ' ').trim();
    if (texts[st]) a.title = `${name}: ${texts[st]}`;
    else a.removeAttribute('title');
  }
}

/** «строка 1 (Ø 10 см)» — название строки в тексте. */
const rowName = (j) => {
  const lab = kvRowLabel(sess.rows[j]);
  return L(`строка ${j + 1}${lab ? ` (${lab})` : ''}`, `row ${j + 1}${lab ? ` (${lab})` : ''}`);
};
/** Откуда стандартный тубус: табл. 31 (средние энергии), 26 (низкие, N_K), 27 (низкие, N_D,w — как при калибровке). */
const stdRef = (r) => (r.range === 'medium' ? L('табл. 31', 'Table 31') : r.cal === 'nk' ? L('табл. 26', 'Table 26') : L('поле и РИП как при калибровке, табл. 27', 'field and SSD as at calibration, Table 27'));

/**
 * Соответствие условиям для показа: у нестандартного тубуса при стандартном в таблице — «измерение в нестандартных
 * условиях (разд. 9.5)» вместо «нестандартные условия, результат нельзя считать референсной дозиметрией».
 */
function rowCompliance(all, i) {
  const r = all?.results[i];
  if (!r) return null;
  if (!all.nonRef[i] || r.compliance.status === 'invalid') return r.compliance;
  return {
    ...r.compliance,
    status: 'nonref',
    title: L('Тубус не стандартный', 'Non-reference applicator'),
    text: L(
      `измерение в нестандартных условиях (${PROTO_NAME}, разд. 9.5); референсная доза — по стандартному тубусу, ${rowName(all.stdRow)}`,
      `a measurement under non-reference conditions (${PROTO_NAME}, Sec. 9.5); the reference dose is from the reference applicator, ${rowName(all.stdRow)}`,
    ),
  };
}

/** Поле «Сравнить с» (в таблице или в разделе 8): база из журнала kV — подсказкой в поле и во всплывающей подписи. */
function refHint(el, r) {
  if (!el) return;
  const j = r.cmp.src === 'journal';
  const ph = j ? fmt(r.cmp.ref, 4) : '';
  if (el.placeholder !== ph) el.placeholder = ph;
  const tip = j ? L(`Из калибровки ${dateText(r.cmp.date)} (журнал). Введите число, чтобы сравнить с другим значением.`, `From the calibration of ${dateText(r.cmp.date)} (journal). Enter a number to compare with another value.`) : '';
  if (el.title !== tip) el.title = tip;
}

/** Итоги строк в таблице, подсветка полей, состояние строк, источники k_pol и k_s, номер строки у полей разделов. */
function renderRowsState(all) {
  const n = sess.rows.length;
  all.results.forEach((r, i) => {
    const tr = rowsBody().querySelector(`tr[data-i="${i}"]`);
    if (!tr) return;
    const x = r.trs;
    const p = primaryOf(x);
    const none = x.blocked || ctrlFailed(x);
    const set = (k, s) => {
      const td = tr.querySelector(`[data-o="${k}"]`);
      if (td && td.textContent !== s) td.textContent = s;
      return td;
    };
    set('ktp', fmt(x.kTP, 4));
    set('kg', fmt(x.kg?.value, 4));
    set('d', none ? '—' : fmt(valueAt(p, r), 4));
    const dev = none ? NaN : p.deviation;
    const tol = r.cmp.tolerance;
    const devTd = set('dev', fmtSigned(dev, 2));
    devTd.classList.toggle('good', Number.isFinite(dev) && Math.abs(dev) <= tol / 2);
    devTd.classList.toggle('bad', Number.isFinite(dev) && Math.abs(dev) > tol);
    // «Сравнить с» пусто — база из журнала: значение подсказкой в поле
    refHint(tr.querySelector('[data-k="kv_ref"]'), r);

    const empty = kvRowEmpty(sess.rows[i]);
    const { lvl, tip } = rowState(r, sess.rows[i]);
    const st = tr.querySelector('.st');
    st.className = `st ${lvl}`;
    st.title = tip;
    st.setAttribute('aria-label', tip);
    // подсветка полей строки — по её расчёту (у пустой строки не подсвечиваем: её ещё не начали заполнять)
    for (const el of tr.querySelectorAll('[data-k]')) {
      const f = empty ? null : r.flags[el.dataset.k];
      el.classList.toggle('flag-error', f === 'error');
      el.classList.toggle('flag-warn', f === 'warn');
    }
    const active = i === sess.active;
    tr.classList.toggle('active', active);
    tr.querySelector('.kv-row-pick').setAttribute('aria-pressed', String(active));
    // стандартный тубус — метка у номера строки (при одной строке не нужна)
    const std = tr.querySelector('.kv-std');
    const isStd = n > 1 && i === all.stdRow;
    std.hidden = !isStd;
    if (isStd) {
      std.textContent = L('ст.', 'ref.');
      std.title = L(`Стандартный тубус (${stdRef(r)}): по нему референсная доза`, `Reference applicator (${stdRef(r)}): the reference dose is from it`);
    }
  });

  // откуда k_pol и k_s у строк без своих серий
  const from = (j) => {
    const lab = kvRowLabel(sess.rows[j]);
    return L(`строки ${j + 1}${lab ? ` (${lab})` : ''}`, `row ${j + 1}${lab ? ` (${lab})` : ''}`);
  };
  const notes = [];
  const r0 = all.results[sess.active];
  if (n > 1 && all.stdRow >= 0) {
    notes.push(L(`Стандартный тубус (${stdRef(r0)}) — ${rowName(all.stdRow)}, метка «ст.»: по нему референсная доза.`, `The reference applicator (${stdRef(r0)}) is ${rowName(all.stdRow)}, marked "ref.": the reference dose is from it.`));
    if (all.nonRef.some(Boolean)) notes.push(L('Тубусы, отличающиеся от него только полем, — измерения в нестандартных условиях (TRS-398 Rev.1, разд. 9.5).', 'Applicators that differ from it only in the field size are measurements under non-reference conditions (TRS-398 Rev.1, Sec. 9.5).'));
  } else if (n > 1 && r0.range === 'medium') {
    notes.push(L('Стандартного тубуса в таблице нет: по табл. 31 это поле 10 × 10 см или Ø 10 см, тубус сопоставимого размера или самый большой квадратный или круглый (отметьте «Самый большой тубус аппарата» в разделе 1).', 'There is no reference applicator in the table: by Table 31 it is a 10 × 10 cm or 10 cm diameter field, an applicator of comparable size, or the largest square or circular one (tick "Largest applicator of the unit" in section 1).'));
  }
  if (n > 1 && all.polSrc >= 0 && all.results.some((r) => r.trs.kpolFrom)) notes.push(L(`k_pol строк без серии при обратной полярности — из ${from(all.polSrc)}.`, `k_pol of the rows without an opposite-polarity series is taken from ${from(all.polSrc)}.`));
  if (n > 1 && all.ksSrc >= 0 && all.results.some((r) => r.trs.ksFrom)) notes.push(L(`k_s строк без серии при V₂ — из ${from(all.ksSrc)}.`, `k_s of the rows without a V₂ series is taken from ${from(all.ksSrc)}.`));
  // серий нет во всём режиме: k_pol и k_s — из ближайшего по СПО режима с той же камерой
  if (all.polMode >= 0) notes.push(L(`В этом режиме серии при обратной полярности нет: k_pol — из ${kvModeFrom(visit, all.polMode)}, ближайшего по СПО с той же камерой.`, `This mode has no opposite-polarity series: k_pol is taken from ${kvModeFrom(visit, all.polMode)}, the nearest in HVL with the same chamber.`));
  if (all.ksMode >= 0) notes.push(L(`В этом режиме серии при V₂ нет: k_s — из ${kvModeFrom(visit, all.ksMode)}, ближайшего по СПО с той же камерой.`, `This mode has no V₂ series: k_s is taken from ${kvModeFrom(visit, all.ksMode)}, the nearest in HVL with the same chamber.`));
  // журнал kV: базы строк и, при проверке выхода, поправки — из последней калибровки режима
  const ju = journalUsed(all);
  if (ju) notes.push(L(`Проверка выхода: ${ju.names} — из ${kvJournalFrom(ju.date)} (последняя калибровка режима в журнале).`, `Output check: ${ju.names} from ${kvJournalFrom(ju.date)} (the last calibration of the mode in the journal).`));
  const jb = all.results.filter((r, i) => r.cmp.src === 'journal' && !kvRowEmpty(sess.rows[i]));
  if (jb.length) {
    const dates = [...new Set(jb.map((r) => r.cmp.date))].map(dateText).join(', ');
    notes.push(L(`«Сравнить с» строк без своего значения — мощность дозы того же аппликатора при калибровке ${dates} (журнал): введите число, чтобы сравнить с другим.`, `“Compare with” of the rows without a value of their own is the dose rate of the same applicator at the calibration of ${dates} (journal); enter a number to compare with another value.`));
  } else if (all.jx && !all.jx.cal) notes.push(L('Калибровок этого режима в журнале раньше даты вкладки нет: базу «Сравнить с» введите вручную.', 'There are no calibrations of this mode in the journal before the date of the tab: enter the “Compare with” baseline by hand.'));
  if (all.jx?.chamberOther && (all.polSrc < 0 || (all.ksOn && all.ksSrc < 0))) notes.push(L('Камера режима — не та, что при последней калибровке: k_pol и k_s из журнала не подставлены.', 'The chamber of the mode differs from the one at the last calibration: k_pol and k_s are not taken from the journal.'));
  const note = $('#kv-rows-note');
  note.hidden = !notes.length;
  html(note, richText(notes.join(' ')));

  // номер выбранной строки у её полей в разделах формы и в окне результата
  const tag = n > 1 ? L(` · строка ${sess.active + 1}`, ` · row ${sess.active + 1}`) : '';
  for (const key of KV_ROW_KEYS) {
    const els = [document.querySelector(`#kv-sheet label[for="${key}"]`), seriesBox(key)?.querySelector('.label'), key === 'kv_cone_largest' ? document.getElementById(key)?.nextElementSibling : null];
    for (const el of els) {
      if (!el) continue;
      if (tag) el.dataset.row = tag;
      else el.removeAttribute('data-row');
    }
  }
  const of = $('#kv-row-of');
  const nm = visit.modes.length;
  of.hidden = n <= 1 && nm <= 1;
  if (!of.hidden) {
    const row = sess.rows[sess.active];
    const lab = kvRowLabel(row);
    const ssd = String(row.kv_ssd ?? '').trim();
    const std = n > 1 && sess.active === all.stdRow;
    of.textContent = [
      nm > 1 ? L(`Режим ${visit.mode + 1} из ${nm} · ${modeName(visit.mode)}`, `Mode ${visit.mode + 1} of ${nm} · ${modeName(visit.mode)}`) : '',
      n > 1 ? L(`Строка ${sess.active + 1} из ${n}`, `Row ${sess.active + 1} of ${n}`) : '',
      lab,
      ssd ? L(`РИП ${ssd} см`, `SSD ${ssd} cm`) : '',
      std ? L('стандартный тубус', 'reference applicator') : '',
    ].filter(Boolean).join(' · ');
  }

  // τ из другого режима — пометка в разделе 3
  const tf = $('#kv-timer-from');
  tf.hidden = all.tauMode < 0 && !all.jx?.tau;
  if (all.jx?.tau) {
    html(tf, richText(L(`Своих данных в этой проверке нет: τ взята из ${kvJournalFrom(all.jx.tau.date)} — последней калибровки режима в журнале. Чтобы не учитывать τ, выберите «не учитывать».`, `This check has no data of its own: τ is taken from ${kvJournalFrom(all.jx.tau.date)}, the last calibration of the mode in the journal. To ignore τ, select "disregard".`)));
  } else if (all.tauMode >= 0) {
    const time = all.timer.unit === 'min' || all.timer.unit === 's';
    html(tf, richText(time
      ? L(`Своих данных ошибки таймера в этом режиме нет: τ взята из ${kvModeFrom(visit, all.tauMode)} — ближайшего по напряжению режима, где она измерена. Чтобы не учитывать τ, выберите «не учитывать».`, `This mode has no timer error data of its own: τ is taken from ${kvModeFrom(visit, all.tauMode)}, the mode with the nearest voltage where it was measured. To ignore τ, select "disregard".`)
      : L(`Своих данных концевого эффекта в этом режиме нет: τ взят из ${kvModeFrom(visit, all.tauMode)}. Чтобы не учитывать τ, выберите «не учитывать».`, `This mode has no end-effect data of its own: τ is taken from ${kvModeFrom(visit, all.tauMode)}. To ignore τ, select "disregard".`)));
  }
}

// ------------------------------------------------------------ подписи по ветке расчёта
const nSym = (cal) => (cal === 'nk' ? 'K' : 'D,w');
const html = (el, s) => {
  if (el && el.innerHTML !== s) el.innerHTML = s;
};

/**
 * Строка над таблицей аппликаторов (лист «Поглощённая доза»): пучок режима, СПО (измеренный или из таблицы режимов),
 * значение сертификата для него и τ. Здесь они только показываются: вводятся на листах «СПО и k_Q» и «Ошибка таймера».
 */
function renderDoseBeam(r, all) {
  const i = r.inputs;
  const form = r.form?.kv_cert_form;
  const valName = form === 'k' ? 'K' : form === 'n' ? (r.cal === 'nk' ? 'N_K,Q' : 'N_D,w,Q') : 'k_Q';
  const t = r.timer ?? {};
  const st = all.timer?.state;
  const tau = st === 'window'
    ? L('τ в дозу не входит', 'τ does not enter the dose')
    : st === 'off'
      ? L('τ не учитывается', 'τ disregarded')
      : Number.isFinite(t.tauS) ? `τ = ${fmtSigned(t.tauS, 2)} ${L('с', 's')}` : Number.isFinite(t.tau) ? `τ = ${fmtSigned(t.tau, 3)} ${i.unitLabel}` : '';
  const parts = [
    Number.isFinite(i.kv) ? L(`${fmt(i.kv, i.kv % 1 ? 1 : 0)} кВ`, `${fmt(i.kv, i.kv % 1 ? 1 : 0)} kV`) : '',
    Number.isFinite(i.hvl) ? L(`СПО ${fmt(i.hvl, hvlDecimals(i.hvl))} мм ${r.material} (${kvHvlSourceText(i)})`, `HVL ${fmt(i.hvl, hvlDecimals(i.hvl))} mm ${r.material} (${kvHvlSourceText(i)})`) : '',
    Number.isFinite(r.cert?.value) ? `${valName} = ${fmt(r.cert.value, form === 'n' ? 6 : 4)}` : '',
    tau,
  ].filter(Boolean);
  const who = visit.modes.length > 1 ? L(`Режим ${visit.mode + 1}`, `Mode ${visit.mode + 1}`) : L('Пучок', 'Beam');
  html($('#kv-dose-beam'), parts.length ? richText(L(`${who}: ${parts.join(' · ')}. СПО и k_Q — лист «СПО и k_Q», τ — лист «Ошибка таймера».`, `${who}: ${parts.join(' · ')}. The HVL and k_Q come from the “HVL and k_Q” sheet, τ from the “Timer error” sheet.`)) : '');
}

/** Уравнение ветки: подсказка раздела 8. */
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
    'medium-ndw': r.depth5 || r.cert?.kq1
      ? L(
          `DIN 6809-4: D_w,z=2 = M_Q · N_D,w${co ? '(⁶⁰Co)' : ',Qo'} · k_Q,M · k_z · k_g, k_z = 1 — коэффициенты на 5 см, доза на 2 см; не по TRS-398 Rev.1, результат помечается как нестандартный.`,
          `DIN 6809-4: D_w,z=2 = M_Q · N_D,w${co ? '(⁶⁰Co)' : ',Qo'} · k_Q,M · k_z · k_g, k_z = 1: coefficients at 5 cm, dose at 2 cm. This is not TRS-398 Rev.1, and the result is flagged as non-standard.`,
        )
      : L(
          `Ур. (58): D_w,z=2 = M_Q · N_D,w,Q · k_g — цилиндрическая камера в воде на глубине 2 г/см²${co ? '; N_D,w,Q = N_D,w(⁶⁰Co) · k(Q), коэффициенты рентгеновских качеств на 2 г/см²' : ''}. k_g по ур. (90): отношение [μen/ρ]w,air z=2 для поля и РИП клиники и лаборатории.`,
          `Eq. (58): D_w,z=2 = M_Q · N_D,w,Q · k_g, with a cylindrical chamber in water at a depth of 2 g/cm²${co ? '; N_D,w,Q = N_D,w(⁶⁰Co) · k(Q), with the x-ray quality coefficients at 2 g/cm²' : ''}. k_g by Eq. (90): the ratio of [μen/ρ]w,air z=2 for the clinical and laboratory field and SSD.`,
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
  return `${where} ${L('Все серии — при одном задании строки (раздел 3 и таблица раздела 4); значения можно вводить со знаком или без. Кнопка «+» добавляет ячейку.', 'All series at the same setting of the row (section 3 and the table in section 4); values may be entered with or without a sign. The "+" button adds a cell.')}`;
}

function kgSourceText(kg) {
  switch (kg?.source) {
    case 'same': return L('поле и РИП как в лаборатории: k_g = 1', 'field and SSD as at the laboratory: k_g = 1');
    case 'table': return L(`табл. ${kg.table}: по ln(СПО) между качествами TW, по полю — между строками`, `Table ${kg.table}: by ln(HVL) between the TW qualities, by field between rows`);
    case 'eq90': return L('ур. (90): [μen/ρ]z=2 клиники / лаборатории по данным Andreo', 'Eq. (90): clinical / laboratory [μen/ρ]z=2 from the Andreo data');
    case 'eq85': return L('ур. (85): отношение N_K^PMMA × отношение B_w', 'Eq. (85): N_K^PMMA ratio × B_w ratio');
    case 'lab': return L('значение лаборатории', 'laboratory value');
    case 'one': return L('принят равным 1 — не по TRS-398 Rev.1', 'taken as 1, not TRS-398 Rev.1');
    case 'nocal': return L('калибровки в рентгене нет: k_g не к чему отнести, принят равным 1 (не по Rev.1 и DIN)', 'no x-ray calibration: k_g has nothing to refer to and is taken as 1 (neither Rev.1 nor DIN)');
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
  // металл СПО строк сертификата, не выбранный вручную, следует за пучком
  for (const s of $$('#kv-cert-rows .cq-mat[data-auto]')) s.value = mat;
  const shape = data.kv_cone_shape;
  $('#kv-lbl-cone').textContent = shape === 'square' ? L('Сторона поля, см', 'Field side, cm') : shape === 'rect' ? L('Сторона a, см', 'Side a, cm') : L('Диаметр поля, см', 'Field diameter, cm');
  $('#kv-feq-sub').textContent = shape === 'rect' ? 'd = 2√(ab/π)' : 'd = 2a/√π';

  // фантом: у воздушного метода низких энергий его нет; подсказка — что о материале говорят источники
  const phm = result.phantom;
  $('#kv-phantom-block').hidden = low && result.cal === 'nk';
  $('#kv-ph-custom').hidden = !phm.customUsed;
  html(
    $('#kv-phantom-sub'),
    richText(
      phm.status
        ? phm.status.text
        : low
          ? L('ПММА или водоэквивалентный пластик, тот же, что при калибровке (TRS-398 Rev.1, табл. 27, разд. 8.2.2)', 'PMMA or a water-equivalent plastic, the same as at calibration (TRS-398 Rev.1, Table 27, Sec. 8.2.2)')
          : L('только вода (TRS-398 Rev.1, разд. 4.2.3, табл. 31; TG-61, разд. IV.A)', 'water only (TRS-398 Rev.1, Sec. 4.2.3, Table 31; TG-61, Sec. IV.A)'),
    ),
  );
  const pddSt = result.depth.phantomStatus ?? kvPhantomStatus(resolveKvPhantom(data.kv_pdd_phantom, data.kv_ph_name), 'pdd');
  html(
    $('#kv-pdd-phantom-sub'),
    richText(
      pddSt
        ? pddSt.text
        : L('для PDD в kV SSRMP No 9 рекомендует воду, A-150, Plastic Water DT, Solid Water RMI 457, Virtual Water (разд. 5.7.1.2)', 'for PDD in kV beams SSRMP No 9 recommends water, A-150, Plastic Water DT, Solid Water RMI 457 or Virtual Water (Sec. 5.7.1.2)'),
    ),
  );
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
  // плоскопараллельную камеру калибруют на поверхности фантома (низкие энергии): Qo и глубина средних энергий ей не нужны
  if (c && c.type === 'pp') for (const k of ['kv_qo', 'kv_cal_depth']) $(`#${k}`).closest('.field').hidden = true;
  // способ ошибки таймера «X против n облучений по X/n» (до 0.49.3) — в списке, только если он уже выбран
  $('#kv_timer_mode option[value="nexp"]').hidden = data.kv_timer_mode !== 'nexp';
  // k_z (DIN 6809-4) — только когда коэффициенты отнесены к 5 см или k_Q принят равным 1
  if (!Number.isFinite(result.cert?.kz)) $('#kv-kz-field').hidden = true;
  // пересчёт СПО по DIN: флажок — когда в сертификате есть строки в другом металле (или пересчёт уже включён)
  const otherRows = result.cert?.other ?? [];
  $('#kv-din-box').hidden = !(otherRows.length || data.kv_cq_din);
  const otherMat = mat === 'Al' ? 'Cu' : 'Al';
  html(
    $('#kv-din-sub'),
    richText(
      !otherRows.length
        ? L(`строк с СПО в мм ${otherMat} в таблице нет`, `the table has no rows with the HVL in mm ${otherMat}`)
        : Number.isFinite(result.cert.din?.uPct) && result.cert.din.deltaPct < 0.005
          ? L(`строки ${otherRows.map((x) => x.row).join(', ')}: на значение для пучка пересчёт практически не влияет (меньше 0,01 %)`, `rows ${otherRows.map((x) => x.row).join(', ')}: the conversion practically does not affect the value for the beam (less than 0.01 %)`)
        : Number.isFinite(result.cert.din?.uPct)
          ? L(`строки ${otherRows.map((x) => x.row).join(', ')}: ${dinValueName(data.kv_cert_form)} для пучка зависит от пересчёта на ${fmt(result.cert.din.deltaPct, 2)} % (u = ${fmt(result.cert.din.uPct, 2)} %) — подробнее в окне пересчёта`, `rows ${otherRows.map((x) => x.row).join(', ')}: ${dinValueName(data.kv_cert_form)} for the beam depends on the conversion by ${fmt(result.cert.din.deltaPct, 2)} % (u = ${fmt(result.cert.din.uPct, 2)} %); details in the conversion window`)
          : L(`строки ${otherRows.map((x) => x.row).join(', ')} — СПО в мм ${otherMat}; как считается и насколько это точно — в окне пересчёта`, `rows ${otherRows.map((x) => x.row).join(', ')} give the HVL in mm ${otherMat}; how it is calculated and how accurate it is, see the conversion window`),
    ),
  );

  // сертификат
  const ns = nSym(result.cal);
  const form = data.kv_cert_form;
  const coOpt = $('#kv_cert_form option[value="co"]');
  coOpt.hidden = !co && form !== 'co';
  coOpt.disabled = !co && form !== 'co';
  html($('#kv-lbl-n'), form === 'k' ? L('N<sub>Д</sub>', 'N<sub>D</sub>') : `N<sub>${ns},Qo</sub>`);
  html(
    $('#kv-n-sub'),
    richText(
      form === 'k'
        ? L('из протокола поверки; N_Q = N_Д · K(СПО)', 'from the calibration report; N_Q = N_D · K(HVL)')
        : form === 'co'
          ? L('в пучке ⁶⁰Co на глубине 5 см; калибровки в рентгене нет — k_Q = 1', 'in the ⁶⁰Co beam at a depth of 5 cm; no x-ray calibration, so k_Q = 1')
          : co
          ? L('N_D,w в пучке ⁶⁰Co; N_Q = N · k_Q,M(СПО)', 'N_D,w in the ⁶⁰Co beam; N_Q = N · k_Q,M(HVL)')
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
        `Строка — качество из сертификата: напряжение (для записи), СПО с металлом, как в сертификате, и значение. Порядок строк любой. В интерполяцию идут строки с СПО в мм ${mat}, как у пучка; строки в другом металле — только после пересчёта по DIN 6809-4 (справочно). СПО пучка должен лежать между крайними качествами, иначе значение экстраполируется по ln(СПО) с предупреждением.${form === 'k' ? ' K заменяет k_Q: N_Q = N_Д · K.' : ''}`,
        `Each row is a quality from the certificate: the voltage (for the record), the HVL with its metal as in the certificate, and the value. Rows may be in any order. Rows with the HVL in mm ${mat}, as for the beam, are used in the interpolation; rows in the other metal only after the DIN 6809-4 conversion (for reference). The beam HVL should lie between the outermost qualities; otherwise the value is extrapolated in ln(HVL) with a warning.${form === 'k' ? ' K replaces k_Q: N_Q = N_D · K.' : ''}`,
      ),
    ),
  );
  html(
    $('#kv-lab-hint'),
    richText(
      co
        ? L('Поле и РИП, при которых измерены коэффициенты рентгеновских качеств (k_Q,M или K): по ним считается k_g (раздел 8).', 'The field and SSD at which the x-ray quality coefficients (k_Q,M or K) were measured: k_g is calculated from them (section 8).')
        : L('Поле и РИП, при которых получены коэффициенты сертификата: если клинические другие, нужна поправка k_g (раздел 8).', 'The field and SSD at which the certificate coefficients were obtained: if the clinical ones differ, a k_g correction is needed (section 8).'),
    ),
  );

  // задание облучения и таймер
  $('#kv-lbl-set').textContent = windowMode ? L('Время накопления заряда', 'Charge collection time') : L('Задание облучения', 'Exposure setting');
  $('#kv-set-sub').textContent = windowMode ? L('интервал, на котором электрометр накапливал заряд', 'the interval over which the electrometer collected charge') : L('одно и то же для всех серий показаний строки в разделе 5', 'the same for all reading series of the row in section 5');
  $('#kv-lbl-timer-mode').textContent = timeSet ? L('Ошибка таймера τ', 'Timer error τ') : L('Концевой эффект τ', 'End effect τ');
  $('#kv-lbl-tau').textContent = `τ, ${unit}`;
  {
    // единица заданий серии — в шапке таблицы и подписях её полей
    const u = tsUnitText();
    const lbl = $('#kv-lbl-tt');
    if (lbl) lbl.textContent = L(`Задание, ${u}`, `Setting, ${u}`);
    for (const i of $$('#kv-ts-grid .ts-t')) i.setAttribute('aria-label', L(`Задание ${Number(i.dataset.j) + 1}, ${u}`, `Setting ${Number(i.dataset.j) + 1}, ${u}`));
  }
  $('#kv-lbl-nxt').textContent = L(`Задание одиночного облучения X, ${unit}`, `Single exposure setting X, ${unit}`);
  // две точки: при задании по времени T₁ и T₂ — в секундах
  const tpUnit = timeSet ? L('с', 's') : unit;
  $('#kv-lbl-tp1').textContent = L(`Задание T₁, ${tpUnit}`, `Setting T₁, ${tpUnit}`);
  $('#kv-lbl-tp2').textContent = L(`Задание T₂, ${tpUnit}`, `Setting T₂, ${tpUnit}`);
  $('#kv-tp1-sub').textContent = timeSet ? L('короткое, например 6 с', 'short, e.g. 6 s') : L('меньшее задание', 'the smaller setting');
  $('#kv-tp2-sub').textContent = timeSet ? L('длинное, например 60 с', 'long, e.g. 60 s') : L('большее задание', 'the larger setting');
  $('#kv-lbl-ctrl-set').textContent = windowMode ? L(`Время накопления заряда, ${unit}`, `Charge collection time, ${unit}`) : L(`Задание облучения, ${unit}`, `Exposure setting, ${unit}`);
  const winOpt = $('#kv_timer_mode option[value="window"]');
  if (winOpt) winOpt.disabled = !timeSet && !windowMode;

  // показания
  $('#kv-readings-hint').textContent = readingsHint(result);

  // раздел 8
  html($('#kv-eq-hint'), richText(eqHint(result)));
  const autoOpt = $('#kv_kg_src option[value="auto"]');
  autoOpt.textContent = low ? L('по табл. 28–29 TRS-398 Rev.1 (PTW 23342, 23344)', 'by TRS-398 Rev.1 Tables 28–29 (PTW 23342, 23344)') : L('по ур. (90) TRS-398 Rev.1 (данные Andreo)', 'by TRS-398 Rev.1 Eq. (90) (Andreo data)');
  const eq85 = $('#kv_kg_src option[value="eq85"]');
  eq85.hidden = !low;
  eq85.disabled = !low;
  const kg = result.trs.kg;
  $('#kv_kg_src').disabled = kg.source === 'nocal';
  html($('#kv-kg-sub'), richText(kgSourceText(kg)));
  $('#kv-kg-bykv').hidden = kg.source !== 'table';
  $('#kv-kg-spread').hidden = kg.source !== 'table';
  $('#kv-kg-bw').hidden = kg.source !== 'eq85';
  // k_g лаборатории: при «лаборатории» — у каждой строки; при табл. 28–29 — только для тубуса, которого в таблице нет
  const kgSrc = $('#kv_kg_src').value;
  $('#kv-kglab-field').hidden = !(kgSrc === 'lab' || (kgSrc === 'auto' && low));
  $('#kv-kglab-sub').hidden = kgSrc !== 'auto';
  $('#kv-pch-field').hidden = !(result.range === 'medium' && result.cal === 'nk' && c && !c.pch);
  const ph = result.trs.phys;
  html($('#kv-muen-sub'), low ? L('FIA, по СПО', 'FIA, by HVL') : L('на 2 см, по кВ, СПО, полю и РИП', 'at 2 cm, by kV, HVL, field and SSD'));
  html($('#kv-pch-sub'), ph.pchSource === 'table32' ? L('табл. 32, по ln(СПО)', 'Table 32, by ln(HVL)') : ph.pchSource === 'manual' ? L('введён вручную', 'entered manually') : '');
  const std = c?.type === 'cyl' ? 5 : 10;
  html($('#kv-nkfs-sub'), L(`стандартное поле — Ø ${std} см; для другого поля — рис. 11 TRS-398 или от лаборатории; пусто — 1`, `standard field: ${std} cm diameter; for another field, from TRS-398 Fig. 11 or the laboratory; empty means 1`));
  $('#kv-lbl-surf').textContent = L(`На поверхности, ${rate}`, `At the surface, ${rate}`);
  $('#kv-lbl-ref').textContent = L(`Значение для сравнения, ${rate}`, `Comparison value, ${rate}`);
  refHint($('#kv_ref'), result);
  html($('#kv-ref-sub'), esc(result.cmp.src === 'journal'
    ? L(`пусто — мощность дозы при калибровке ${dateText(result.cmp.date)} (журнал); можно ввести другое`, `empty: the dose rate at the calibration of ${dateText(result.cmp.date)} (journal); you may enter another value`)
    : L('при вводе в эксплуатацию или предыдущей калибровке; можно не заполнять', 'at commissioning or at the previous calibration; optional')));

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
    `Ветка N_D,w сравнивается с ${r.qo === 'co60' || r.depth5 ? 'DIN 6809-4' : 'DIN 6809-4 и SSRMP No 9'}: D = M · N_D,w,Q без поправки на поле и РИП (k_g = 1). У TG-61 варианта для N_D,w нет.`,
    `The N_D,w branch is compared with ${r.qo === 'co60' ? 'DIN 6809-4' : 'DIN 6809-4 and SSRMP No 9'}: D = M · N_D,w,Q with no field and SSD correction (k_g = 1). TG-61 has no N_D,w variant.`,
  );
}

/** Таблица пар множителей «протокол — Rev.1» в разделе 8. */
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
    <div class="secondary">${L('отличие от Rev.1 — в разделе 8; на итог не влияет', 'the difference from Rev.1 is broken down in section 8; does not affect the result')}</div>`;
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

/** Метод расчёта для подписи итога: уравнение TRS-398 Rev.1 или DIN 6809-4 при коэффициентах на 5 см (k_z = 1). */
const dinMethod = (r) => r.depth5 || r.cert?.kq1;
const methodText = (r) => (dinMethod(r) ? L(`DIN 6809-4, ${r.qo === 'co60' ? 'Qo = ⁶⁰Co, ' : ''}калибровка на 5 см (не TRS-398 Rev.1)`, `DIN 6809-4, ${r.qo === 'co60' ? 'Qo = ⁶⁰Co, ' : ''}calibration at 5 cm (not TRS-398 Rev.1)`) : `${PROTO_NAME}, ${r.trs.equation}`);

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
    fromCtrl ? null : L('Контрольные измерения не введены — по показанию M₁ раздела 5', 'No check measurements entered — from reading M₁ of section 5'),
  ].filter(Boolean).join('<br>');
  return `<div class="dose-row ${none ? 'blocked' : ''}">
    <div class="proto"><span>${esc(methodText(result))}${fromCtrl || failed ? L(' · контрольные измерения', ' · check measurements') : ''}</span>${chip}</div>
    <div class="dose-big">${none || !Number.isFinite(main) ? '—' : fmt(main, 4)}<small>${unit} ${where}</small></div>
    <div class="secondary">${x.blocked ? L('Исправьте ошибки из списка замечаний', 'Correct the errors listed under Messages') : failed ? ctrlErrorText(7, 5) : secondary}</div>
  </div>`;
}

function renderReadout(result, data) {
  const x = result.trs;
  $('#kv-dose-rows').innerHTML = doseRow(result);
  const pc = $('#kv-proto-cmp');
  pc.hidden = !result.compare?.kind;
  if (result.compare?.kind) html(pc, protoCmpRow(result));
  renderCompliance($('#kv-compliance'), rowCompliance(current.all, sess.active) ?? result.compliance, PROTO_NAME);

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

  // строка итога в разделах 5 и 7 — те же числа, что в окне результата
  setInlineResult(ROOT(), inlineResultHtml({
    value: none ? NaN : valueAt(p, result),
    digits: 4,
    unit: x.rateLabel,
    where: whereText(result, atSurf),
    deviation: p.deviation,
    tol: result.cmp.tolerance,
    devLabel: L('от значения для сравнения', 'from the comparison value'),
    source: p !== x
      ? L('по контрольным измерениям (раздел 7)', 'from the check measurements (section 7)')
      : L('по показанию M₁ раздела 5 (контрольные измерения не введены)', 'from reading M₁ of section 5 (no check measurements entered)'),
    errors: result.messages.filter((m) => m.level === 'error').length,
    failedText: ctrlFailed(x) ? L('не посчитан — ошибки в контрольных измерениях (раздел 7)', 'not calculated: errors in the check measurements (section 7)') : '',
  }));

  const lvlName = { error: L('Ошибка', 'Error'), warn: L('Внимание', 'Warning'), info: L('Справка', 'Note') };
  const scopeName = { common: '', trs: '', depth: L('Пересчёт на поверхность · ', 'Transfer to the surface · '), ctrl: L('Контрольные измерения · ', 'Check measurements · '), hvl: L('Измерение СПО · ', 'HVL measurement · '), ln: L('Линейность · ', 'Linearity · '), rp: L('Воспроизводимость · ', 'Reproducibility · ') };
  // замечания к измерению СПО (лист «СПО и k_Q»), линейности и воспроизводимости режима — среди замечаний строки, по уровню
  const order = { error: 0, warn: 1, info: 2 };
  const extra = ['hvl', 'ln', 'rp'].flatMap((k) => (current.all?.[k]?.messages ?? []).map((m) => ({ ...m, scope: k })));
  const list = [...extra, ...result.messages].sort((a, b) => order[a.level] - order[b.level]);
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
    data.kv_cert_form === 'n'
      ? L(`N<sub>${ns}</sub> для СПО пучка (единицы таблицы)`, `N<sub>${ns}</sub> at the beam HVL (table units)`)
      : data.kv_cert_form === 'k'
        ? L('K для СПО пучка', 'K at the beam HVL')
        : c.kq1
          ? L('k<sub>Q</sub> принят равным 1 (калибровки в рентгене нет)', 'k<sub>Q</sub> taken as 1 (no x-ray calibration)')
          : L('k<sub>Q</sub> для СПО пучка', 'k<sub>Q</sub> at the beam HVL'),
    '', c.value, data.kv_cert_form === 'n' ? 6 : 4,
  ]);
  rows.push([L(`N<sub>${ns},Q</sub>, Гр/нКл`, `N<sub>${ns},Q</sub>, Gy/nC`), '', c.NQ, 6]);
  if (result.cal === 'ndw') {
    rows.push([L('Поле и РИП', 'Field and SSD'), 'k<sub>g</sub>', x.kg.value, 4]);
    if (Number.isFinite(c.kz)) rows.push([L('Глубина калибровки', 'Calibration depth'), 'k<sub>z</sub>', c.kz, 3]);
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
  const title = doseGroupTitle({ ctrlOn, ctrlFinal, mainSec: 5, ctrlSec: 7, mainAmount: setText(result, i.X), ctrlAmount: setText(result, result.ctrl.X) });
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
/** Строки аппликаторов режима коротко для протокола: тубус, РИП, T, P, M₁, k_TP, доза, отклонение, откуда k_pol и k_s. */
function rowsReport(md, mr, pUnit) {
  const cells = (a) => (Array.isArray(a) ? a.filter((v) => String(v).trim() !== '').join('; ') : a);
  return md.rows.map((row, k) => {
    const y = mr.results[k];
    const t = y.trs;
    const p = primaryOf(t);
    const none = t.blocked || ctrlFailed(t);
    const at = whereText(y, atSurfOf(p, y));
    const lab = kvRowLabel(row) || '—';
    const ssd = String(row.kv_ssd ?? '').trim() || '—';
    const env = `T = ${String(row.kv_env_T ?? '').trim() || '—'} °C, P = ${String(row.kv_env_P ?? '').trim() || '—'} ${pUnit}`;
    const dose = none ? L('не вычислена (см. замечания строки)', 'not calculated (see the row messages)') : `${fmt(valueAt(p, y), 4)} ${t.rateLabel} ${at}`;
    const dev = !none && Number.isFinite(p.deviation) ? L(`, отклонение ${fmtSigned(p.deviation, 2)} %`, `, deviation ${fmtSigned(p.deviation, 2)} %`) : '';
    // из другого режима — сказано в строке режима, у строк не повторяется
    const from = [t.kpolFrom && mr.polSrc >= 0 ? L(`k_pol из ${t.kpolFrom}`, `k_pol from ${t.kpolFrom}`) : '', t.ksFrom && mr.ksSrc >= 0 ? L(`k_s из ${t.ksFrom}`, `k_s from ${t.ksFrom}`) : ''].filter(Boolean).join(', ');
    const std = md.rows.length > 1 && k === mr.stdRow;
    return L(
      `  ${k + 1}. ${lab}${std ? ' (стандартный тубус)' : ''}, РИП ${ssd} см; ${env}; M₁ ${cells(row.kv_M1) || '—'} нКл; k_TP = ${fmt(t.kTP)}; D = ${dose}${dev}${from ? ` (${from})` : ''}`,
      `  ${k + 1}. ${lab}${std ? ' (reference applicator)' : ''}, SSD ${ssd} cm; ${env}; M₁ ${cells(row.kv_M1) || '—'} nC; k_TP = ${fmt(t.kTP)}; D = ${dose}${dev}${from ? ` (${from})` : ''}`,
    );
  });
}

/** Ошибка таймера режима m одной строкой протокола: данные, τ и допуск. */
function timerReportLine(m, mr) {
  const f = visit.modes[m].shared;
  const r = mr.results[visit.modes[m].active] ?? mr.results[0];
  const t = r.timer;
  const u = tpUnit(f);
  const time = isTimeUnit(f.kv_set_unit);
  const cells = (a) => (Array.isArray(a) ? a.filter((v) => String(v).trim() !== '').join('; ') : '');
  const tauTxt = (v) => `τ = ${fmtSigned(v, time ? 2 : 3)} ${u}`;
  const tolTxt = t.tol ? (t.inTol ? L(` (в допуске ${fmt(t.tol, tolDigits(t.tol))} с)`, ` (within ${fmt(t.tol, tolDigits(t.tol))} s)`) : L(` (больше допуска ${fmt(t.tol, tolDigits(t.tol))} с)`, ` (exceeds ${fmt(t.tol, tolDigits(t.tol))} s)`)) : '';
  const v = time ? t.tauS : t.tau;
  const st = mr.timer.state;
  let txt;
  if (st === 'none' && mr.jx?.tau) txt = L(`не измерялась; ${tauTxt(v)} из ${kvJournalFrom(mr.jx.tau.date)}`, `not measured; ${tauTxt(v)} from ${kvJournalFrom(mr.jx.tau.date)}`);
  else if (st === 'none' && mr.tauMode >= 0) txt = L(`не измерялась; ${tauTxt(v)} из режима ${mr.tauMode + 1}`, `not measured; ${tauTxt(v)} from mode ${mr.tauMode + 1}`);
  else if (st === 'none') txt = L('не измерялась', 'not measured');
  else if (st === 'off') txt = L('не учитывалась', 'not accounted for');
  else if (st === 'window') txt = L('заряд накоплен при включённой трубке, τ в дозу не входит', 'charge collected with the tube on, τ does not enter the dose');
  else {
    const how = f.kv_timer_mode === 'twopoint'
      ? L(`T₁ = ${f.kv_tp_t1} ${u}: ${cells(f.kv_tp_R1) || '—'} нКл; T₂ = ${f.kv_tp_t2} ${u}: ${cells(f.kv_tp_R2) || '—'} нКл`, `T₁ = ${f.kv_tp_t1} ${u}: ${cells(f.kv_tp_R1) || '—'} nC; T₂ = ${f.kv_tp_t2} ${u}: ${cells(f.kv_tp_R2) || '—'} nC`)
      : f.kv_timer_mode === 'measured' ? L('серия облучений', 'series of exposures') : f.kv_timer_mode === 'nexp' ? L('X против n облучений по X/n', 'X vs. n exposures of X/n') : L('введено', 'entered manually');
    txt = Number.isFinite(v) && !TIMER_FLAG_KEYS.some((k) => r.flags[k] === 'error') ? `${how}; ${tauTxt(v)}${tolTxt}` : L(`${how}; τ не вычислена (см. замечания)`, `${how}; τ not calculated (see the messages)`);
  }
  return L(`Режим ${m + 1} (${modeName(m)}): ${txt}`, `Mode ${m + 1} (${modeName(m)}): ${txt}`);
}

/** Серия облучений в протоколе: «по 9 заданиям, прямая по средним: 6 с: 2,04; 2,022; 2,028 → 2,030 нКл; …». */
function tsReportText(data, tm) {
  const tu = KV_SET_UNITS[isTimeUnit(data.kv_set_unit) ? data.kv_ts_unit : data.kv_set_unit] ?? KV_SET_UNITS.s;
  const u = L(tu.label, tu.labelEn);
  const cols = data.kv_ts_t
    .map((t, j) => [String(t ?? '').trim(), data.kv_ts_R[j] ?? []])
    .filter(([t, c]) => t && parseCells(c).n > 0 && !parseCells(c).error)
    .map(([t, c]) => {
      const vals = c.map((v) => String(v ?? '').trim()).filter(Boolean).join('; ');
      const m = sigFmt(Math.abs(parseCells(c).mean), 4);
      return L(`${t} ${u}: ${vals} → ${m} нКл`, `${t} ${u}: ${vals} → ${m} nC`);
    });
  const tauT = Number.isFinite(tm.tauT) && tm.tUnit !== data.kv_set_unit ? `, τ = ${fmtSigned(tm.tauT, tm.tUnit === 's' ? 2 : 4)} ${u}` : '';
  return L(`по ${cols.length} заданиям, прямая по средним: ${cols.join('; ')}${tauT}`, `from ${cols.length} settings, line through the means: ${cols.join('; ')}${tauT}`);
}

function reportText(data, r, all = null, vr = null) {
  const out = [];
  const line = (k, v) => out.push(`${k}: ${v}`);
  const cells = (a) => (Array.isArray(a) ? a.filter((s) => String(s).trim() !== '').join('; ') : a);
  const i = r.inputs;
  const x = r.trs;
  const mat = r.material;
  const ns = r.cal === 'nk' ? 'N_K' : 'N_D,w';
  const plain = (s) => String(s).replace(/<\/?su[bp]>/g, '');
  out.push(L('ПРОТОКОЛ РЕФЕРЕНСНОЙ ДОЗИМЕТРИИ — kV-РЕНТГЕН', 'REFERENCE DOSIMETRY REPORT — kV X-RAYS'));
  line(L('Протокол', 'Protocol'), `${methodText(r)}${dinMethod(r) ? '' : r.range === 'low' ? L(' (разд. 8, низкие энергии)', ' (Sec. 8, low energies)') : L(' (разд. 9, средние энергии)', ' (Sec. 9, medium energies)')}`);
  if (r.notRev1.length) line(L('Не по TRS-398 Rev.1', 'Not TRS-398 Rev.1'), r.notRev1.join('; '));
  line(L('Калькулятор', 'Calculator'), versionText());
  line(L('Учреждение', 'Institution'), data.kv_institution || '—');
  line(L('Аппарат', 'Machine'), data.kv_machine || '—');
  line(L('Дата', 'Date'), data.kv_date || '—');
  line(L('Вид измерения', 'Measurement'), kvRecModeText(data.kv_rec_mode));
  line(L('Измерения выполнили', 'Measured by'), data.kv_staff.filter((s) => s.trim()).join(', ') || '—');
  const hvlTxt = i.hvlSource !== 'table' ? L(`${fmt(i.hvl, hvlDecimals(i.hvl))} мм ${mat} (${kvHvlSourceText(i)})`, `${fmt(i.hvl, hvlDecimals(i.hvl))} mm ${mat} (${kvHvlSourceText(i)})`) : `${data.kv_hvl || '—'} ${L('мм', 'mm')} ${mat}`;
  line(vr && visit.modes.length > 1 ? L(`Пучок (режим ${visit.mode + 1})`, `Beam (mode ${visit.mode + 1})`) : L('Пучок', 'Beam'), L(`${data.kv_kv || '—'} кВ${data.kv_ma ? `, ${data.kv_ma} мА` : ''}, СПО ${hvlTxt}${data.kv_filter ? `, фильтр ${data.kv_filter}` : ''}`, `${data.kv_kv || '—'} kV${data.kv_ma ? `, ${data.kv_ma} mA` : ''}, HVL ${hvlTxt}${data.kv_filter ? `, filter ${data.kv_filter}` : ''}`));
  // режимы и строки аппликаторов: коротко все, подробно ниже — выбранная строка выбранного режима
  const pUnit = unitLabel(PRESSURE_UNITS[data.kv_env_P_unit]);
  if (vr && visit.modes.length > 1) {
    out.push('');
    out.push(L(`Режимы аппарата (${visit.modes.length}); подробно ниже — режим ${visit.mode + 1}, строка ${sess.active + 1}:`, `Modes of the unit (${visit.modes.length}); mode ${visit.mode + 1}, row ${sess.active + 1} is detailed below:`));
    visit.modes.forEach((md, m) => {
      const b = borrowedText(vr.modes[m]);
      const ch = L(`камера ${md.chamber + 1} (${chamberName(visit.chambers[md.chamber])})`, `chamber ${md.chamber + 1} (${chamberName(visit.chambers[md.chamber])})`);
      out.push(L(`Режим ${m + 1}: ${modeBeamText(md.shared)}; ${ch}${b ? `; ${b}` : ''}`, `Mode ${m + 1}: ${modeBeamText(md.shared)}; ${ch}${b ? `; ${b}` : ''}`));
      rowsReport(md, vr.modes[m], pUnit).forEach((l) => out.push(l));
    });
    out.push('');
    const tolRaw = String(data.kv_tau_tol ?? '').trim();
    out.push(tolRaw ? L(`Ошибка таймера по режимам (допуск |τ| ≤ ${tolRaw} с — по методике учреждения):`, `Timer error by mode (tolerance |τ| ≤ ${tolRaw} s, local procedure):`) : L('Ошибка таймера по режимам:', 'Timer error by mode:'));
    visit.modes.forEach((_, m) => out.push(`  ${timerReportLine(m, vr.modes[m])}`));
    out.push('');
  } else if (all && sess.rows.length > 1) {
    out.push('');
    out.push(L(`Аппликаторы (${sess.rows.length}); подробно ниже — строка ${sess.active + 1}:`, `Applicators (${sess.rows.length}); row ${sess.active + 1} is detailed below:`));
    rowsReport(mode(), all, pUnit).forEach((l) => out.push(l));
    out.push('');
  }
  // измерение СПО и значение сертификата по режимам (лист «СПО и k_Q»)
  const hvlLines = vr ? hvlReportLines(visit, vr) : [];
  if (hvlLines.length) {
    hvlLines.forEach((l) => out.push(l));
    out.push('');
  }
  // линейность и воспроизводимость по режимам (листы «Линейность» и «Воспроизводимость»)
  if (vr) qaReportLines(visit, vr).forEach((l) => out.push(l));
  // проверка радиационного выхода: база, измерение, отклонение и калибровка по всем строкам (лист «Сводка и протокол»)
  if (vr) outputReportLines(visit, vr).forEach((l) => out.push(l));
  const coneTxt =
    data.kv_cone_shape === 'square'
      ? L(`квадратный тубус ${data.kv_cone || '—'} см (круг той же площади Ø ${fmt(i.fClin, 2)} см)`, `square applicator ${data.kv_cone || '—'} cm (circle of equal area, ${fmt(i.fClin, 2)} cm diameter)`)
      : data.kv_cone_shape === 'rect'
        ? L(`прямоугольный тубус ${data.kv_cone || '—'} × ${data.kv_cone_b || '—'} см (круг той же площади Ø ${fmt(i.fClin, 2)} см)`, `rectangular applicator ${data.kv_cone || '—'} × ${data.kv_cone_b || '—'} cm (circle of equal area, ${fmt(i.fClin, 2)} cm diameter)`)
        : L(`тубус Ø ${data.kv_cone || '—'} см`, `applicator ${data.kv_cone || '—'} cm diameter`);
  line(L('Геометрия', 'Geometry'), L(`${coneTxt}, РИП ${data.kv_ssd || '—'} см${r.range === 'medium' && data.kv_cone_largest ? ', самый большой тубус аппарата' : ''}; ${r.range === 'low' ? 'доза на поверхности' : 'доза на глубине 2 г/см² в воде'}`, `${coneTxt}, SSD ${data.kv_ssd || '—'} cm${r.range === 'medium' && data.kv_cone_largest ? ', largest applicator of the unit' : ''}; ${r.range === 'low' ? 'dose at the surface' : 'dose at a depth of 2 g/cm² in water'}`));
  const phx = r.phantom;
  const customTxt = () => {
    const parts = [String(data.kv_ph_rho ?? '').trim() ? L(`плотность ${data.kv_ph_rho} г/см³`, `density ${data.kv_ph_rho} g/cm³`) : '', String(data.kv_ph_note ?? '').trim()].filter(Boolean);
    return parts.length ? ` (${parts.join('; ')})` : '';
  };
  const phName = (p) => (p ? `${p.name}${p.kind === 'custom' ? customTxt() : ''}` : L('не указан', 'not specified'));
  if (!(r.range === 'low' && r.cal === 'nk')) line(L('Фантом', 'Phantom'), phName(phx.clin));
  out.push('');
  line(L('Камера', 'Chamber'), `${r.chamber ? `${r.chamber.label} (${r.chamber.type === 'pp' ? L('плоскопараллельная', 'plane-parallel') : L('цилиндрическая', 'cylindrical')})` : '—'}, ${L('№', 'S/N')} ${data.kv_ch_serial || '—'}${r.chamber?.type === 'pp' && data.kv_foil ? L(', с фольгой 0,2 мм', ', with a 0.2 mm foil') : ''}`);
  const unitN = unitLabel(NDW_UNITS[data.kv_n_unit]);
  const formTxt =
    data.kv_cert_form === 'k'
      ? L(`N_Д = ${data.kv_n} ${unitN}, множитель K по качествам`, `N_D = ${data.kv_n} ${unitN}, multiplier K per quality`)
      : data.kv_cert_form === 'n'
        ? L(`${ns} по качествам, ${unitN}`, `${ns} per quality, ${unitN}`)
        : data.kv_cert_form === 'co'
          ? L(`${ns},Qo = ${data.kv_n} ${unitN} (⁶⁰Co, 5 см); калибровки в рентгене нет, k_Q = 1 (не по Rev.1 и DIN 6809-4)`, `${ns},Qo = ${data.kv_n} ${unitN} (⁶⁰Co, 5 cm); no x-ray calibration, k_Q = 1 (neither Rev.1 nor DIN 6809-4)`)
          : L(`${ns},Qo = ${data.kv_n} ${unitN}${r.qo === 'co60' ? ' (⁶⁰Co)' : ''}, k_Q по качествам`, `${ns},Qo = ${data.kv_n} ${unitN}${r.qo === 'co60' ? ' (⁶⁰Co)' : ''}, k_Q per quality`);
  const depthTxt = r.range === 'medium' && r.cal === 'ndw' && data.kv_cert_form !== 'co' ? L(`; коэффициенты на глубине ${r.depth5 ? '5 см (DIN 6809-4)' : '2 г/см²'}`, `; coefficients at a depth of ${r.depth5 ? '5 cm (DIN 6809-4)' : '2 g/cm²'}`) : '';
  line(L('Сертификат', 'Certificate'), formTxt + depthTxt);
  // свидетельство (с 0.53.0): №, дата калибровки, лаборатория
  const certNo = certText({ no: data.kv_cert_no, date: data.kv_cert_date, lab: data.kv_cert_lab });
  if (certNo) line(L('Свидетельство', 'Calibration certificate'), certNo);
  // как введено в таблицу (с теми же знаками), по возрастанию СПО
  const raw = (key, q) => String(data[key][q.row - 1] ?? '').trim();
  const kvTxt = (q) => (raw('kv_cq_kv', q) ? L(`${raw('kv_cq_kv', q)} кВ / `, `${raw('kv_cq_kv', q)} kV / `) : '');
  const dinTxt = (q) => (q.din ? L(` (≈ ${fmt(q.hvl, 3)} мм ${mat} по DIN 6809-4${q.extrapolated ? ', экстраполяция' : ''})`, ` (≈ ${fmt(q.hvl, 3)} mm ${mat} by DIN 6809-4${q.extrapolated ? ', extrapolated' : ''})`) : '');
  const qs = r.cert.rows?.map((q) => `${kvTxt(q)}${raw('kv_cq_hvl', q)} ${L('мм', 'mm')} ${q.matSrc ?? mat}${dinTxt(q)} → ${raw('kv_cq_val', q)}`).join('; ');
  if (qs) line(L('Качества сертификата', 'Certificate qualities'), qs);
  // строки в другом металле без пересчёта в расчёт не вошли
  const unused = data.kv_cq_din ? [] : r.cert.other ?? [];
  if (unused.length) line(L('Не использованы (СПО в другом металле)', 'Not used (HVL in the other metal)'), unused.map((q) => `${kvTxt(q)}${raw('kv_cq_hvl', q)} ${L('мм', 'mm')} ${q.mat} → ${raw('kv_cq_val', q)}`).join('; '));
  if (Number.isFinite(r.cert.din?.uPct)) {
    line(
      L('Пересчёт СПО Al ↔ Cu', 'HVL conversion Al ↔ Cu'),
      L(
        `DIN 6809-4, табл. 5 (оценка, не TRS-398 Rev.1): при ±${fmt(r.cert.din.dev * 100, 0)} % по СПО значение для пучка меняется на ${fmt(r.cert.din.deltaPct, 2)} %, u = ${fmt(r.cert.din.uPct, 2)} %`,
        `DIN 6809-4, Table 5 (an estimate, not TRS-398 Rev.1): ±${fmt(r.cert.din.dev * 100, 0)} % in HVL changes the value for the beam by ${fmt(r.cert.din.deltaPct, 2)} %, u = ${fmt(r.cert.din.uPct, 2)} %`,
      ),
    );
  }
  const valName = data.kv_cert_form === 'k' ? 'K' : data.kv_cert_form === 'n' ? ns : 'k_Q';
  line(L('Для СПО пучка', 'At the beam HVL'), `${valName} = ${fmt(r.cert.value, data.kv_cert_form === 'n' ? 6 : 4)}; ${ns},Q = ${fmt(r.cert.NQ, 6)} ${L('Гр/нКл', 'Gy/nC')}${r.cert.interp?.extrapolated ? L(' (экстраполяция)', ' (extrapolated)') : ''}${r.cert.kq1 ? L(' (принят: калибровки в рентгене нет)', ' (assumed: no x-ray calibration)') : ''}`);
  if (r.cal === 'ndw' && data.kv_cert_form !== 'co') {
    const labTxt = data.kv_lab_shape === 'square' ? L(`квадратное поле ${data.kv_lab_f || '—'} см`, `square field ${data.kv_lab_f || '—'} cm`) : L(`поле Ø ${data.kv_lab_f || '—'} см`, `field ${data.kv_lab_f || '—'} cm diameter`);
    const labPh = r.range === 'low' ? L(`; фантом: ${phName(phx.lab)}`, `; phantom: ${phName(phx.lab)}`) : '';
    line(L('Калибровка в лаборатории', 'Laboratory calibration'), L(`${labTxt}, РИП ${data.kv_lab_ssd || '—'} см${labPh}`, `${labTxt}, SSD ${data.kv_lab_ssd || '—'} cm${labPh}`));
  }
  line(L('Стандартные условия', 'Reference conditions'), L(`T0 = ${data.kv_T0} °C, P0 = ${data.kv_P0} кПа`, `T0 = ${data.kv_T0} °C, P0 = ${data.kv_P0} kPa`));
  line(L('Электрометр', 'Electrometer'), `${data.kv_el_model || '—'}, ${L('№', 'S/N')} ${data.kv_el_serial || '—'}, k_elec = ${data.kv_kelec}`);
  line(L('Условия', 'Conditions'), `T = ${data.kv_env_T} °C, P = ${data.kv_env_P} ${unitLabel(PRESSURE_UNITS[data.kv_env_P_unit])}${String(data.kv_env_H ?? '').trim() ? L(`, относительная влажность ${data.kv_env_H} %`, `, relative humidity ${data.kv_env_H} %`) : ''}`);
  const tm = r.timer;
  const u = i.unitLabel;
  const tpU = isTimeUnit(data.kv_set_unit) ? L('с', 's') : u;
  const tolNote = tm.tol ? (tm.inTol ? L(`, в допуске ${fmt(tm.tol, tolDigits(tm.tol))} с`, `, within ${fmt(tm.tol, tolDigits(tm.tol))} s`) : L(`, больше допуска ${fmt(tm.tol, tolDigits(tm.tol))} с`, `, exceeds ${fmt(tm.tol, tolDigits(tm.tol))} s`)) : '';
  const timerTxt =
    data.kv_timer_mode === 'twopoint'
      ? L(
        `по двум заданиям: T₁ = ${data.kv_tp_t1} ${tpU} (${cells(data.kv_tp_R1)} нКл), T₂ = ${data.kv_tp_t2} ${tpU} (${cells(data.kv_tp_R2)} нКл)${data.kv_set_unit === 'min' && Number.isFinite(tm.tauS) ? `, τ = ${fmtSigned(tm.tauS, 2)} с` : ''}`,
        `from two settings: T₁ = ${data.kv_tp_t1} ${tpU} (${cells(data.kv_tp_R1)} nC), T₂ = ${data.kv_tp_t2} ${tpU} (${cells(data.kv_tp_R2)} nC)${data.kv_set_unit === 'min' && Number.isFinite(tm.tauS) ? `, τ = ${fmtSigned(tm.tauS, 2)} s` : ''}`,
      )
      : data.kv_timer_mode === 'measured'
      ? tsReportText(data, tm)
      : data.kv_timer_mode === 'nexp'
        ? L(`одно облучение ${data.kv_nx_t} ${u} (${cells(data.kv_nx_M1)} нКл) против ${data.kv_nx_n} облучений по X/n (${cells(data.kv_nx_Mn)} нКл)`, `one exposure of ${data.kv_nx_t} ${u} (${cells(data.kv_nx_M1)} nC) vs. ${data.kv_nx_n} exposures of X/n (${cells(data.kv_nx_Mn)} nC)`)
        : data.kv_timer_mode === 'manual'
          ? L('введено', 'entered manually')
          : L('не учитывалась', 'not accounted for');
  const timerFull = tm.from ? L(`из ${tm.from}: в этом режиме не измерялась`, `from ${tm.from}: not measured in this mode`) : `${timerTxt}${tolNote}`;
  if (data.kv_timer_mode === 'window') {
    line(L('Время', 'Time'), L(`заряд накоплен электрометром за ${data.kv_set} ${u} при включённой трубке; ошибка таймера в результат не входит`, `charge collected by the electrometer over ${data.kv_set} ${u} with the tube on; the timer error does not enter the result`));
  } else line(L('Задание облучения', 'Exposure setting'), `X = ${data.kv_set} ${u}; τ = ${fmt(tm.tau, 4)} ${u} (${timerFull}); X + τ = ${fmt(i.Xeff, 4)} ${u}`);
  line(L('Напряжения', 'Voltages'), data.kv_ks_on ? L(`V1 = ${data.kv_V1} В, V2 = ${data.kv_V2} В, обычная полярность ${data.kv_polarity}`, `V1 = ${data.kv_V1} V, V2 = ${data.kv_V2} V, normal polarity ${data.kv_polarity}`) : L(`V1 = ${data.kv_V1} В, обычная полярность ${data.kv_polarity}`, `V1 = ${data.kv_V1} V, normal polarity ${data.kv_polarity}`));
  const mean = L('среднее', 'mean');
  line(L('M(V1, обычная), нКл', 'M(V1, normal), nC'), `${cells(data.kv_M1)} → ${mean} ${fmt(Math.abs(i.M1.mean), 4)}`);
  if (i.Mopp.n > 0) line(L('M(V1, обратная), нКл', 'M(V1, opposite), nC'), `${cells(data.kv_Mopp)} → ${mean} ${fmt(Math.abs(i.Mopp.mean), 4)}`);
  else if (x.kpolFrom && all?.jx?.pol) line(L('M(V1, обратная)', 'M(V1, opposite)'), L(`при проверке выхода не измерялось; k_pol из ${x.kpolFrom}`, `not measured in the output check; k_pol from ${x.kpolFrom}`));
  else if (x.kpolFrom && all?.polMode >= 0) line(L('M(V1, обратная)', 'M(V1, opposite)'), L(`в этом режиме не измерялось; k_pol из ${x.kpolFrom}`, `not measured in this mode; k_pol from ${x.kpolFrom}`));
  else if (x.kpolFrom) line(L('M(V1, обратная)', 'M(V1, opposite)'), L(`в этой строке не измерялось; k_pol из ${x.kpolFrom}`, `not measured in this row; k_pol from ${x.kpolFrom}`));
  else line(L('M(V1, обратная)', 'M(V1, opposite)'), L('не измерялось (k_pol = 1)', 'not measured (k_pol = 1)'));
  if (data.kv_ks_on && x.ksFrom && all?.jx?.ks) line(L('M(V2)', 'M(V2)'), L(`при проверке выхода не измерялось; k_s из ${x.ksFrom}`, `not measured in the output check; k_s from ${x.ksFrom}`));
  else if (data.kv_ks_on && x.ksFrom && all?.ksMode >= 0) line(L('M(V2)', 'M(V2)'), L(`в этом режиме не измерялось; k_s из ${x.ksFrom}`, `not measured in this mode; k_s from ${x.ksFrom}`));
  else if (data.kv_ks_on && x.ksFrom) line(L('M(V2)', 'M(V2)'), L(`в этой строке не измерялось; k_s из ${x.ksFrom}`, `not measured in this row; k_s from ${x.ksFrom}`));
  else if (data.kv_ks_on) line(L('M(V2), нКл', 'M(V2), nC'), `${cells(data.kv_M2)} → ${mean} ${fmt(Math.abs(i.M2.mean), 4)}`);
  if (r.ctrl.on) line(L('Контрольные измерения M(V1), нКл', 'Check measurements M(V1), nC'), `${cells(data.kv_Mc)} → ${mean} ${fmt(r.ctrl.mean, 4)} ${L('за', 'for')} ${setText(r, r.ctrl.X)}`);
  out.push('');
  out.push(`— ${PROTO_NAME} —`);
  out.push(`k_TP = ${fmt(x.kTP)}; k_elec = ${fmt(x.kelec)}; k_pol = ${fmt(x.kpol)}; k_s = ${fmt(x.ks)}; k_leak = ${fmt(x.kleak)}`);
  const ph = x.phys;
  if (r.cal === 'ndw') {
    out.push(`k_g = ${fmt(x.kg.value)} (${plain(kgSourceText(x.kg)) || '—'})${Number.isFinite(r.cert.kz) ? '; k_z = 1' : ''}`);
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
      if (r.depth.on && Number.isFinite(y.perUnitSurf)) {
        const pp = r.depth.phantom ? L(` (фантом: ${phName(r.depth.phantom)})`, ` (phantom: ${phName(r.depth.phantom)})`) : '';
        out.push(L(`  PDD(2 см) = ${fmt(r.depth.pdd, 1)} %${pp}; на поверхности ${fmt(y.perUnitSurf, 4)} ${x.rateLabel}`, `  PDD(2 cm) = ${fmt(r.depth.pdd, 1)} %${pp}; at the surface ${fmt(y.perUnitSurf, 4)} ${x.rateLabel}`));
      }
    };
    if (x.ctrl && !x.ctrl.blocked) describe(x.ctrl, L('По контрольным измерениям (раздел 7)', 'From check measurements (section 7)'));
    else if (r.ctrl.on) out.push(L('РЕЗУЛЬТАТ НЕ ВЫЧИСЛЕН: в контрольных измерениях (раздел 7) ошибки (см. замечания).', 'RESULT NOT CALCULATED: the check measurements (section 7) contain errors (see Messages).'));
    else describe(x, L('По показанию M₁ раздела 5 (контрольные измерения не введены)', 'From reading M₁ of section 5 (no check measurements entered)'));
    const cl = complianceLine((all && rowCompliance(all, sess.active)) ?? r.compliance, PROTO_NAME);
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
  setVisit(normalizeKvVisit(obj));
  writeForm(rowForm(sess.active));
  openedFile = obj;
  update();
}

/**
 * Данные вкладки для инструмента «Неопределённость» (кнопка «Взять данные с вкладки»): диапазон энергий, калибровка
 * камеры, опорное качество, как получен k_g, серия показаний итога, доза на опорной глубине и сведения об аппарате.
 * Сама вкладка бюджет не показывает.
 */
export function kvUncSource() {
  const { data, result } = current;
  if (!result) return null;
  const x = result.trs;
  const none = x.blocked || ctrlFailed(x);
  const p = primaryOf(x);
  const i = result.inputs;
  const src = x.kg?.source;
  const beam = [
    Number.isFinite(i.kv) ? L(`${fmt(i.kv, i.kv % 1 ? 1 : 0)} кВ`, `${fmt(i.kv, i.kv % 1 ? 1 : 0)} kV`) : '',
    Number.isFinite(i.hvl) ? L(`СПО ${fmt(i.hvl, 3)} мм ${result.material}`, `HVL ${fmt(i.hvl, 3)} mm ${result.material}`) : '',
  ].filter(Boolean).join(', ');
  return {
    beam: 'kv',
    route: 'lab',
    kvRange: result.range,
    kvCal: result.cal,
    kvQo: result.qo === 'co60' ? 'co60' : 'kv',
    kvDepth: result.depth5 ? '5' : '2',
    // калибровки в рентгене нет: k_g = 1 — в бюджете как k_g = 1 по DIN
    kvKg: src === 'same' || src === 'one' ? src : src === 'nocal' ? 'one' : 'calc',
    kvKq: result.cert.kq1 ? 'one' : 'cert',
    // u от пересчёта СПО строк сертификата по DIN 6809-4, %
    kvHvlDin: result.cert.din?.uPct,
    M: p === x.ctrl ? data.kv_Mc : data.kv_M1,
    // доза на опорной глубине (поверхность или 2 г/см²): бюджет Rev.1 составлен для неё
    value: none ? NaN : p.perUnit,
    unit: { min: 'Gymin', s: 'Gymin', Gy: 'GyGy', MU: 'cGyMU' }[i.unit] ?? 'Gymin',
    ki: null,
    meta: { institution: data.kv_institution, machine: data.kv_machine, beam, date: data.kv_date, staff: data.kv_staff },
  };
}

// ------------------------------------------------------------ пересчёт СПО Al ↔ Cu по DIN 6809-4 (справочно)
// Качества, где СПО известны в обоих металлах: на них оценена точность пересчёта (см. src/core/kv-din.js)
const DIN_CHECKS = () => [
  { name: 'TG-61, M150', al: 10.2, cu: 0.67 },
  { name: 'TG-61, M200', al: 14.9, cu: 1.69 },
  { name: L('TRS-398 Rev.1, табл. 53, 100 кВ', 'TRS-398 Rev.1, Table 53, 100 kV'), al: 4.0, cu: 0.15 },
];

const dinPct = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${fmt(Math.abs(x), 1)} %`;

function dinValueName(form) {
  return form === 'k' ? 'K' : form === 'n' ? 'N' : 'k_Q';
}

/** Пересчёт строк сертификата для окна: строки в другом металле, значение для пучка с пересчётом и без, чувствительность. */
function dinPreview(data, result) {
  const mat = result?.material ?? beamMat();
  const hvl = result?.inputs?.hvl;
  const withDin = certRows(data, mat, { din: true });
  const plain = certRows(data, mat);
  const ok = (t) => t.rows.length > 0 && !t.errors.length && !t.duplicates.length && Number.isFinite(hvl);
  return {
    mat,
    hvl,
    other: withDin.other,
    broken: withDin.errors.length > 0 || withDin.duplicates.length > 0,
    value: ok(withDin) ? certValue(withDin.rows, hvl).value : NaN,
    plain: ok(plain) ? certValue(plain.rows, hvl).value : NaN,
    d: ok(withDin) ? certDinSensitivity(withDin.rows, hvl) : NaN,
  };
}

function dinDialogHtml(data, result) {
  const pv = dinPreview(data, result);
  const { mat } = pv;
  const otherMat = mat === 'Al' ? 'Cu' : 'Al';
  const vn = dinValueName(data.kv_cert_form);
  const dev = fmt(DIN_HVL_DEV * 100, 0);
  const th = DIN_TH.map((q) => `<tr><td>${q.code}</td><td class="n">${q.kv}</td><td class="n">${fmt(q.al, 2)}</td><td class="n">${fmt(q.cu, 2)}</td></tr>`).join('');
  const checks = DIN_CHECKS()
    .map((c) => {
      const r = dinHvlConvert(c.al, 'Al');
      const note = r.extrapolated ? L(' (вне табл. 5)', ' (outside Table 5)') : '';
      return `<tr><td>${esc(c.name)}</td><td class="n">${fmt(c.al, 1)}</td><td class="n">${fmt(c.cu, 2)}</td><td class="n">${fmt(r.value, 3)}</td><td class="n">${dinPct((r.value / c.cu - 1) * 100)}${note}</td></tr>`;
    })
    .join('');
  const out = [];
  out.push(
    `<p>${L(
      `k<sub>Q</sub> (K, N) сертификата интерполируется по СПО пучка, а сравнивать СПО можно только в одном металле (TRS-398 Rev.1, разд. 9.4.4; прил. III: до 100 кВ — Al, выше — Cu). У пучка СПО в мм ${mat}; строки сертификата в мм ${otherMat} без пересчёта в интерполяцию не идут. Лучше всего — СПО в нужном металле от лаборатории или СПО пучка, измеренный в металле сертификата. Если ни то ни другое невозможно, СПО строк можно оценить пересчётом.`,
      `The certificate k<sub>Q</sub> (K, N) is interpolated at the beam HVL, and HVLs can only be compared in one metal (TRS-398 Rev.1, Sec. 9.4.4; App. III: Al up to 100 kV, Cu above). The beam HVL is in mm ${mat}; certificate rows in mm ${otherMat} are not used in the interpolation without a conversion. Best is an HVL in the right metal from the laboratory, or a beam HVL measured in the certificate metal. If neither is possible, the HVL of those rows can be estimated by conversion.`,
    )}</p>`,
  );
  out.push(`<h4>${L('Как считается', 'How it is calculated')}</h4>`);
  out.push(
    `<p>${L(
      'В DIN 6809-4:2020, табл. 5 для серии качеств TH (вольфрамовая трубка, фильтры 4,5–9 мм Al или 4 мм Al + Cu) первый СПО дан в обоих металлах на расстоянии 100 см от фокуса. Между соседними качествами TH ln(СПО в одном металле) считается линейным по ln(СПО в другом). Вне диапазона таблицы продолжается крайний отрезок — это экстраполяция.',
      'DIN 6809-4:2020, Table 5 gives the first HVL in both metals at 100 cm from the focus for the TH series of qualities (tungsten tube, filters of 4.5–9 mm Al or 4 mm Al + Cu). Between neighbouring TH qualities, ln(HVL in one metal) is taken as linear in ln(HVL in the other). Outside the table the outermost segment is extended: this is an extrapolation.',
    )}</p>`,
  );
  out.push(`<table class="din-table"><thead><tr><th>${L('Качество', 'Quality')}</th><th>${L('кВ', 'kV')}</th><th>${L('СПО, мм Al', 'HVL, mm Al')}</th><th>${L('СПО, мм Cu', 'HVL, mm Cu')}</th></tr></thead><tbody>${th}</tbody></table>`);
  out.push(`<h4>${L('Насколько это точно', 'How accurate it is')}</h4>`);
  out.push(
    `<p>${L(
      'Соотношение СПО в Al и в Cu зависит от спектра: один и тот же СПО дают разные сочетания напряжения и фильтрации (TRS-398 Rev.1, разд. 9.3.1), а табл. 5 описывает только спектры TH. Сверка с качествами, у которых СПО известны в обоих металлах:',
      'The relation between HVLs in Al and in Cu depends on the spectrum: the same HVL results from different combinations of voltage and filtration (TRS-398 Rev.1, Sec. 9.3.1), and Table 5 describes only the TH spectra. A check against qualities with HVLs known in both metals:',
    )}</p>`,
  );
  out.push(`<table class="din-table"><thead><tr><th>${L('Качество', 'Quality')}</th><th>${L('мм Al', 'mm Al')}</th><th>${L('мм Cu', 'mm Cu')}</th><th>${L('пересчёт, мм Cu', 'converted, mm Cu')}</th><th>${L('отклонение', 'deviation')}</th></tr></thead><tbody>${checks}</tbody></table>`);
  out.push(
    `<p>${L(
      `Отсюда оценка: ±${dev} % по СПО внутри TH 100–300 (${fmt(DIN_TH[0].al, 2)}–${fmt(DIN_TH.at(-1).al, 2)} мм Al, ${fmt(DIN_TH[0].cu, 2)}–${fmt(DIN_TH.at(-1).cu, 2)} мм Cu); вне этого диапазона отклонение может быть больше. ${vn} меняется с СПО медленно, поэтому ошибка СПО в несколько процентов обычно сдвигает ${vn} для пучка на доли процента — для вашего сертификата это посчитано ниже. Расчёт с пересчитанными СПО — не по TRS-398 Rev.1: он помечается «нестандартные условия», а составляющая неопределённости передаётся в бюджет на вкладке «Неопределённость».`,
      `Hence the estimate: ±${dev} % in HVL within TH 100–300 (${fmt(DIN_TH[0].al, 2)}–${fmt(DIN_TH.at(-1).al, 2)} mm Al, ${fmt(DIN_TH[0].cu, 2)}–${fmt(DIN_TH.at(-1).cu, 2)} mm Cu); outside this range the deviation may be larger. ${vn} changes slowly with the HVL, so an HVL error of a few per cent usually shifts ${vn} for the beam by a fraction of a per cent; for your certificate this is calculated below. A calculation with converted HVLs is not TRS-398 Rev.1: it is marked as non-reference conditions, and the uncertainty component is passed to the budget on the Uncertainty tab.`,
    )}</p>`,
  );
  out.push(`<h4>${L('Ваш сертификат', 'Your certificate')}</h4>`);
  if (data.kv_cert_form === 'co' || !pv.other.length) {
    out.push(
      `<p>${L(
        `В таблице качеств сертификата нет строк с СПО в мм ${otherMat}: пересчитывать нечего. Металл СПО у каждой строки выбирается в столбце «металл» — как в сертификате.`,
        `The certificate quality table has no rows with the HVL in mm ${otherMat}: there is nothing to convert. The HVL metal of each row is chosen in the "metal" column, as in the certificate.`,
      )}</p>`,
    );
  } else {
    const rows = pv.other
      .map((x) => {
        const ext = x.conv.extrapolated ? L('вне табл. 5 — экстраполяция', 'outside Table 5: extrapolation') : '';
        return `<tr><td class="n">${x.row}</td><td class="n">${Number.isFinite(x.kv) ? fmt(x.kv, x.kv % 1 ? 1 : 0) : '—'}</td><td class="n">${fmt(x.hvl, 3)}</td><td class="n">≈ ${fmt(x.conv.value, 3)}</td><td>${ext}</td></tr>`;
      })
      .join('');
    out.push(`<table class="din-table"><thead><tr><th>№</th><th>${L('кВ', 'kV')}</th><th>${L(`СПО, мм ${otherMat}`, `HVL, mm ${otherMat}`)}</th><th>${L(`СПО, мм ${mat}`, `HVL, mm ${mat}`)}</th><th></th></tr></thead><tbody>${rows}</tbody></table>`);
    if (pv.broken) {
      out.push(`<p>${L('В таблице качеств есть незаполненные строки или повторы СПО: исправьте их, чтобы оценить влияние пересчёта на пучок.', 'The quality table has incomplete rows or repeated HVLs: fix them to estimate the effect of the conversion on the beam.')}</p>`);
    } else if (!Number.isFinite(pv.hvl)) {
      out.push(`<p>${L('Укажите СПО пучка, чтобы оценить влияние пересчёта на значение для пучка.', 'Enter the beam HVL to estimate the effect of the conversion on the value for the beam.')}</p>`);
    } else {
      const digits = data.kv_cert_form === 'n' ? 6 : 4;
      const plain = Number.isFinite(pv.plain)
        ? L(`без пересчитанных строк — ${fmt(pv.plain, digits)}`, `without the converted rows, ${fmt(pv.plain, digits)}`)
        : L('без пересчитанных строк значения нет', 'without the converted rows there is no value');
      const tiny = pv.d * 100 < 0.005;
      const sens = !Number.isFinite(pv.d)
        ? ''
        : tiny
          ? L(
              ` Пересчитанные строки на ${vn} для пучка практически не влияют (меньше 0,01 % при отклонении их СПО на ±${dev} %): СПО пучка лежит между качествами в мм ${mat}.`,
              ` The converted rows practically do not affect ${vn} for the beam (less than 0.01 % for a ±${dev} % deviation of their HVLs): the beam HVL lies between the qualities in mm ${mat}.`,
            )
          : L(
              ` При отклонении пересчитанных СПО на ±${dev} % ${vn} для пучка меняется на ${fmt(pv.d * 100, 2)} %; как стандартная неопределённость (прямоугольное распределение) — ${fmt((pv.d * 100) / Math.sqrt(3), 2)} %.`,
              ` A ±${dev} % deviation of the converted HVLs changes ${vn} for the beam by ${fmt(pv.d * 100, 2)} %; as a standard uncertainty (rectangular distribution), ${fmt((pv.d * 100) / Math.sqrt(3), 2)} %.`,
            );
      out.push(`<p>${L(`Для СПО пучка ${fmt(pv.hvl, 3)} мм ${mat}: ${vn} = ${fmt(pv.value, digits)} с пересчитанными строками, ${plain}.`, `At the beam HVL of ${fmt(pv.hvl, 3)} mm ${mat}: ${vn} = ${fmt(pv.value, digits)} with the converted rows, ${plain}.`)}${sens}</p>`);
    }
    out.push(
      `<p><b>${data.kv_cq_din ? L('Сейчас пересчёт включён: эти строки идут в расчёт.', 'The conversion is on: these rows are used in the calculation.') : L('Сейчас пересчёт выключен: эти строки в расчёт не идут.', 'The conversion is off: these rows are not used in the calculation.')}</b></p>`,
    );
    out.push(
      `<div class="din-actions"><button type="button" class="primary" id="kv-din-apply">${L('Подставить в расчёт', 'Use in the calculation')}</button><button type="button" id="kv-din-off">${L('Не пересчитывать', 'Do not convert')}</button></div>`,
    );
  }
  out.push(`<h4>${L('Пересчитать одно значение', 'Convert a single value')}</h4>`);
  out.push(
    `<div class="din-calc"><label for="kv-din-x">${L('СПО', 'HVL')}</label><input type="text" class="num" inputmode="decimal" id="kv-din-x" placeholder="${esc(fmt(5.58, 2))}"><label for="kv-din-from" class="visually-hidden">${L('металл', 'metal')}</label><select id="kv-din-from"><option value="Al">${L('мм Al', 'mm Al')}</option><option value="Cu">${L('мм Cu', 'mm Cu')}</option></select><output id="kv-din-out" aria-live="polite"></output></div>`,
  );
  out.push(`<p class="src">${L('Источники: DIN 6809-4:2020, табл. 5; IAEA TRS-398 Rev.1 (2024), разд. 9.3.1, 9.4.4, прил. III, табл. 53; AAPM TG-61 (Ma et al., Med. Phys. 28, 2001), табл. II.', 'Sources: DIN 6809-4:2020, Table 5; IAEA TRS-398 Rev.1 (2024), Secs 9.3.1, 9.4.4, App. III, Table 53; AAPM TG-61 (Ma et al., Med. Phys. 28, 2001), Table II.')}</p>`);
  return out.join('');
}

function dinCalc() {
  const x = parseNumber($('#kv-din-x')?.value);
  const from = $('#kv-din-from')?.value === 'Cu' ? 'Cu' : 'Al';
  const o = $('#kv-din-out');
  if (!o) return;
  if (!(x > 0)) {
    o.textContent = '';
    return;
  }
  const r = dinHvlConvert(x, from);
  const ext = r.extrapolated ? L(` — вне табл. 5 (${fmt(r.min, 2)}–${fmt(r.max, 2)} мм ${from}), экстраполяция`, ` — outside Table 5 (${fmt(r.min, 2)}–${fmt(r.max, 2)} mm ${from}), extrapolation`) : L(` (±${fmt(DIN_HVL_DEV * 100, 0)} %)`, ` (±${fmt(DIN_HVL_DEV * 100, 0)} %)`);
  o.textContent = L(`≈ ${fmt(r.value, 3)} мм ${r.to}${ext}`, `≈ ${fmt(r.value, 3)} mm ${r.to}${ext}`);
}

function openDinDialog() {
  const dlg = $('#kv-din-dialog');
  $('#kv-din-title').textContent = L('Пересчёт СПО Al ↔ Cu по DIN 6809-4 (справочно)', 'HVL conversion Al ↔ Cu with DIN 6809-4 (for reference)');
  $('#kv-din-close').setAttribute('aria-label', L('Закрыть', 'Close'));
  const data = current.data ?? normalizeKv(readForm());
  html($('#kv-din-body'), dinDialogHtml(data, current.result));
  // в калькулятор — металл строк сертификата, отличный от пучка
  const from = current.result?.material === 'Cu' ? 'Al' : 'Cu';
  if ($('#kv-din-from')) $('#kv-din-from').value = from;
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  $('#kv-din-body').scrollTop = 0;
}

function setDinUse(on) {
  $('#kv_cq_din').checked = on;
  $('#kv-din-dialog').close();
  openedFile = null;
  update();
  syncDinToJournal();
}

function setupDinDialog() {
  const dlg = $('#kv-din-dialog');
  $('#kv-din-open').addEventListener('click', openDinDialog);
  $('#kv-din-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) return dlg.close();
    if (e.target.id === 'kv-din-apply') return setDinUse(true);
    if (e.target.id === 'kv-din-off') return setDinUse(false);
  });
  dlg.addEventListener('input', dinCalc);
  dlg.addEventListener('change', dinCalc);
}

// ------------------------------------------------------------ цикл
let current = { data: null, result: null, all: null, vr: null, jx: null };

/**
 * Сверка с открытым файлом: итог выбранной строки выбранного режима с её итогом в файле (формат 3 — modeResults,
 * формат 2 — rowResults одного режима, до 0.36.0 — один итог).
 */
function fileNote(result) {
  if (!openedFile) return null;
  const f = openedFile;
  let saved = null;
  if (Array.isArray(f.modeResults)) saved = f.modeResults[visit.mode]?.[sess.active] ?? null;
  else if (visit.mode === 0) saved = Array.isArray(f.rowResults) ? f.rowResults[sess.active] : (Number(f.active) || 0) === sess.active ? f.result : null;
  return saved ? compareWithFile({ ...f, result: saved }, snapshot(result), snapCmp(result)) : null;
}

/**
 * Пересчёт. opts.fromTable — ввод пришёл из таблицы аппликаторов или выбрана строка: поля формы уже совпадают
 * со строкой, таблица не перерисовывается (фокус остаётся в ней). Иначе поля формы читаются в выбранную строку и
 * таблица строится заново. opts.fromTimer и opts.fromModes — ввод в таблице таймера или режимов: она не перестраивается.
 */
function update(opts = {}) {
  if (!opts.fromTable) {
    const p = splitKvVisitForm(readForm());
    const md = mode();
    visit.common = p.common;
    visit.chambers[md.chamber] = p.chamber;
    md.shared = p.mode;
    md.rows[md.active] = p.row;
  }
  // журнал kV (с 0.47.0): база «Сравнить с» и, при проверке выхода, k_pol, k_s, τ и СПО — из последней калибровки режима
  const jx = kvJournalInputs(getJournal(), visit, today());
  const vr = computeKvVisit(visit, jx);
  const all = vr.modes[visit.mode];
  if (!opts.fromTimer) renderTimerTable();
  const result = all.results[sess.active];
  const data = normalizeKv(rowForm(sess.active));
  current = { data, result, all, vr, jx };
  if (!opts.fromTable) renderRows(data, result);
  renderChamberPick();
  renderSectionTags();
  renderSummary(vr);
  renderSummarySheets(visit, vr);
  applyVisibility(data, result);
  renderOutputs(ROOT(), result);
  renderFlags(ROOT(), { ...result.flags, ...all.hvl.flags, ...all.ln.flags, ...all.rp.flags }, seriesBox);
  renderReadout(result, data);
  renderTsMeans();
  renderTimerChart(data, result);
  renderHvlSheet(data, vr);
  renderQaSheets(data, vr);
  html($('#kv-hvl-sub'), richText(hvlFieldSub(all.hvl, result)));
  renderDoseBeam(result, all);
  renderRowsState(all);
  // после renderFlags: он снимает подсветку со всех полей вкладки, таблицы режимов и таймера подсвечивают свои заново
  renderModes(vr, !opts.fromModes);
  applyLock();
  renderTimerState(vr);
  renderModeBar();
  renderPageStates();
  renderKvJournal();
  $('#kv-demo-flag').hidden = !isDemo(data);
  renderNotesFlag($('#kv-notes-flag'), data.kv_notes, [SAMPLE_KV.kv_notes, SAMPLE_KV_EN.kv_notes], isDemo(data));
  renderFileNote($('#kv-file-note'), fileNote(result));
  saveDraft({ version: FILE_TAG.version, ...visit });
  renderSignBlock($('#kv-sign'), data.kv_staff);
  notifyUpdate(ROOT());
}

/**
 * Вкладка как файл .json: result — итог выбранной строки выбранного режима (как в файлах до 0.36.0), modeResults —
 * итоги всех строк всех режимов для сверки при открытии. Так же хранится вкладка в записи журнала kV (с 0.46.0).
 */
function payloadObj() {
  return structuredClone({
    ...FILE_TAG,
    ...fileStamp(snapshot(current.result)),
    modeResults: current.vr.modes.map((mr) => mr.results.map(snapshot)),
    // значения из журнала kV, с которыми посчитана вкладка (протокол записи журнала не меняется вместе с журналом)
    journal: current.jx ?? null,
    savedAt: new Date().toISOString(),
    form: current.data,
    common: visit.common,
    chambers: visit.chambers,
    modes: visit.modes,
    mode: visit.mode,
  });
}

// запись журнала kV во вкладке: прежние данные вкладки откладываются и возвращаются кнопкой на плашке (journal-view.js)
let viewFile = null;
const journalView = makeJournalView({
  bar: () => $('#kv-journal-bar'),
  storageKey: 'reference-dosimetry.kv.journal-view.v1',
  readForm: () => ({ version: FILE_TAG.version, ...structuredClone(visit) }),
  writeForm: (v) => {
    setVisit(normalizeKvVisit(v));
    writeForm(rowForm(sess.active));
  },
  refresh: () => {
    // запись журнала сверяется с сохранённым в ней итогом, как открытый файл
    openedFile = viewFile;
    viewFile = null;
    update();
  },
  setStatus: (t) => setStatus(t),
  viewText: (title) => L(
    `Запись журнала: ${title}. Здесь видны все листы, поправки и замечания. Изменения в журнал не попадают, пока не нажата «Заменить запись в журнале» (панель «Журнал» справа).`,
    `Journal record: ${title}. All sheets, corrections and messages are shown here. Changes do not go to the journal until “Replace the journal record” is clicked (the Journal panel on the right).`,
  ),
});

/** Запись журнала kV во вкладке («Журнал и тренды» → «Открыть во вкладке»): file — вкладка из записи. */
export function showKvRecord(file, title) {
  checkFileFormat(file, FILE_TAG);
  viewFile = file;
  journalView.show(file, { mode: 'view', title });
  setStatus(L(`Открыта запись журнала: ${title}.`, `Journal record opened: ${title}.`));
}

/** Смена языка: списки с переведёнными подписями, подписи ячеек, десятичный разделитель, пересчёт. */
function refreshForLang() {
  const kept = $$('select', ROOT()).map((sel) => [sel, sel.value]);
  fillUnitSelects();
  fillChamberSelect();
  fillPhantomSelects();
  for (const [sel, v] of kept) if ([...sel.options].some((o) => o.value === v)) sel.value = v;
  $$('#kv-sheet .cells').forEach((box) => renderCells(box, readCells(box)));
  {
    const ts = readTs();
    renderTs(ts.kv_ts_t, ts.kv_ts_R);
  }
  renderCert(readCert());
  renderStaff($('#kv-staff-list'), readStaff($('#kv-staff-list')), update);
  localizeDemo(SAMPLE_KV, SAMPLE_KV_EN);
  localizeDemo(SAMPLE_KV_MODE2.shared, SAMPLE_KV_MODE2_EN);
  localizeVisitDemo();
  localizeVisitNumbers();
  localizeDecimals(ROOT());
  update();
}

export function initKv() {
  setStatus = makeStatus($('#kv-status'));
  fillUnitSelects();
  fillChamberSelect();
  fillPhantomSelects();
  $$('#kv-sheet .cells').forEach((box) => setupCells(box, update));
  setupTs();
  $$('#kv-sheet > section .combo').forEach((c) => makeCombo(c));

  const draft = loadDraft();
  // без черновика вкладка открывается пустой: пример — только по кнопке «Загрузить пример»
  setVisit(normalizeKvVisit(draft && typeof draft === 'object' ? draft : { ...KV_DEFAULTS, kv_date: today() }));
  writeForm(rowForm(sess.active));
  localizeDemo(SAMPLE_KV, SAMPLE_KV_EN);
  localizeDemo(SAMPLE_KV_MODE2.shared, SAMPLE_KV_MODE2_EN);
  localizeVisitDemo();
  // блок «Журнал отделения»: аппарат из «Оборудования», подстановка режимов, «Сохранить аппарат в Оборудование»
  setupKvJournal({
    getVisit: () => visit,
    replaceVisit: (v) => {
      setVisit(v);
      writeForm(rowForm(sess.active));
      openedFile = null;
      update();
    },
    setLinks: (machineId, modeId) => {
      visit.common.kv_jmachine = machineId;
      visit.modes.forEach((md, i) => (md.shared.kv_jmode = modeId(md, i)));
      writeForm(rowForm(sess.active));
      update();
    },
    status: (t) => setStatus(t),
    isDemo: () => !!current.data && isDemo(current.data),
    // запись в журнал kV (с 0.46.0): расчёт вкладки и вкладка как файл
    vr: () => current.vr,
    jx: () => current.jx,
    file: () => payloadObj(),
  });
  // журнал изменился (запись, удаление, «Оборудование»): базы и значения калибровок — заново
  onJournal(() => update());
  // запись журнала, открытая во вкладке («Журнал и тренды» → «Открыть во вкладке»): плашка над листами
  journalView.load();
  // лист «СПО и k_Q»: набор пластин, переход к режиму из таблицы по режимам
  setupKvHvl({
    getVisit: () => visit,
    changed: () => {
      openedFile = null;
      update();
    },
    status: (t) => setStatus(t),
    material: () => (mode().shared.kv_range === 'medium' ? 'Cu' : 'Al'),
    modeName: (m) => modeName(m),
    chamberName: (j) => L(`${j + 1} — ${chamberName(visit.chambers[j])}`, `${j + 1}: ${chamberName(visit.chambers[j])}`),
    selectMode: (m) => selectMode(m),
  });
  // листы «Линейность» и «Воспроизводимость»: переход к режиму из таблиц по режимам
  setupKvQa({
    getVisit: () => visit,
    modeName: (m) => modeName(m),
    selectMode: (m) => selectMode(m),
    readSeries: (key) => readCells(seriesBox(key)),
    writeSeries: (key, cells) => renderCells(seriesBox(key), cells),
    changed: () => {
      openedFile = null;
      update();
    },
  });
  // лист «Сводка и протокол»: сводная таблица и протокол измерений
  setupKvSummary({
    getVisit: () => visit,
    openRow: (m, i) => openRow(m, i),
    status: (t) => setStatus(t),
  });
  update();
  if (!draft) setStatus(L('Введите свои данные или нажмите «Загрузить пример» (раздел «Данные»), чтобы посмотреть расчёт на вымышленных значениях.', 'Enter your own data or click "Load example" (the Data panel) to see the calculation on fictitious values.'));

  const sheet = $('#kv-sheet');
  const inTable = (el) => !!el?.closest?.('#kv-rows-body');
  const inTimer = (el) => !!el?.closest?.('#kv-timer-body');
  const inModes = (el) => !!el?.closest?.('#kv-modes');
  sheet.addEventListener('input', (e) => {
    if (inTable(e.target)) return onRowInput(e.target);
    if (inTimer(e.target)) return onTimerInput(e.target);
    // камера в таблице режимов — по событию change
    if (inModes(e.target)) return e.target.dataset.ch === undefined ? onModeInput(e.target) : undefined;
    openedFile = null;
    update();
  });
  sheet.addEventListener('change', (e) => {
    // список формы тубуса в таблице уже обработан по событию input; поля таблицы таймера — тоже
    if (inModes(e.target) && e.target.dataset.ch !== undefined) {
      const m = Number(e.target.closest('tr[data-mr]').dataset.mr);
      const isNew = e.target.value === 'new';
      pickChamber(e.target.value, m);
      return (isNew ? $('#kv_ch_model') : $(`#kvm${m}_ch`))?.focus();
    }
    if (inTable(e.target) || inTimer(e.target) || inModes(e.target)) return;
    // текстовое поле уже пересчитано по событию input; change при уходе из него перестроил бы таблицы, и фокус,
    // переходящий в таблицу аппликаторов или режимов, потерялся бы
    if (e.target.matches?.('input[type="text"], textarea')) return;
    openedFile = null;
    if (e.target.id === 'kv_ch_model') {
      const id = e.target.value;
      if (id.startsWith('MY:')) fillCustomFields(getMyChambers().find((c) => c.id === id));
      else if (id === 'CUSTOM') fillCustomFields(null);
    }
    update();
    if (e.target.id === 'kv_cq_din') syncDinToJournal();
  });

  // таблица аппликаторов: ввод в строку выбирает её, номер строки — тоже; × удаляет строку
  rowsBody().addEventListener('focusin', (e) => {
    if (!e.target.dataset?.k) return;
    selectRow(Number(e.target.closest('tr[data-i]')?.dataset.i));
  });
  rowsBody().addEventListener('click', (e) => {
    const pick = e.target.closest('.kv-row-pick');
    if (pick) return selectRow(Number(pick.closest('tr[data-i]').dataset.i));
    const del = e.target.closest('.kv-row-del');
    if (del) onDeleteClick(del);
  });
  $('#kv-btn-add-row').addEventListener('click', addRow);

  // режимы аппарата (раздел 1), камера режима (раздел 2), сводка (раздел 9)
  $('#kv-modes').addEventListener('click', (e) => {
    const b = e.target.closest('.kv-mode');
    if (b) selectMode(Number(b.dataset.m));
  });
  $('#kv-btn-add-mode').addEventListener('click', addMode);
  // листы вкладки: щелчок по ярлыку открывает лист без перехода по адресу (страница не прокручивается в начало)
  showPage(page, { hash: false });
  $('#kv-pages').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-kv-go]');
    if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    showPage(a.dataset.kvGo);
    const nav = $('#kv-pages');
    if (nav.getBoundingClientRect().top < 0) nav.scrollIntoView({ block: 'start' });
  });
  window.addEventListener('hashchange', () => {
    const h = pageFromHash();
    if (KV_PAGES.includes(h)) showPage(h, { hash: false });
  });
  // ссылка «раздел N» ведёт на раздел другого листа (sec-links.js): сначала открыть его лист
  $('#kv-sheet').addEventListener('pagereveal', (e) => showPage(e.target.dataset.kvPage));
  $('#kv-modebar-list').addEventListener('click', (e) => {
    const b = e.target.closest('.kv-mode[data-m]');
    if (!b) return;
    const m = Number(b.dataset.m);
    selectMode(m);
    $(`#kv-modebar-list [data-m="${m}"]`)?.focus();
  });
  armButton($('#kv-btn-del-mode'), () => L('Удалить режим', 'Delete mode'), () => L(`Точно удалить режим ${visit.mode + 1}?`, `Delete mode ${visit.mode + 1}?`), deleteMode);
  armButton($('#kv-btn-del-ch'), () => L('Удалить камеру', 'Delete chamber'), deleteChamberQuestion, deleteChamber);
  timerBody().addEventListener('click', (e) => {
    const b = e.target.closest('.kv-tm-pick');
    const m = Number(b?.closest('tr[data-m]')?.dataset.m);
    if (!b || !visit.modes[m]) return;
    selectMode(m);
    timerBody().querySelector(`tr[data-m="${m}"] .kv-tm-pick`)?.focus();
  });
  $('#kv-sum-body').addEventListener('click', (e) => {
    const b = e.target.closest('.kv-sum-pick');
    const tr = b?.closest('tr[data-m]');
    if (tr) openRow(Number(tr.dataset.m), Number(tr.dataset.i));
  });

  // до обработчиков листа: иначе пересчёт прочтёт металл как «по пучку» и вернёт список назад
  for (const ev of ['input', 'change']) {
    certList().addEventListener(ev, (e) => {
      if (e.target.matches?.('.cq-mat')) delete e.target.dataset.auto;
    });
  }
  setupDinDialog();
  $('#kv-cert-add').addEventListener('click', () => {
    const c = readCert();
    renderCert({ kv: [...c.kv, ''], hvl: [...c.hvl, ''], mat: [...c.mat, ''], val: [...c.val, ''] });
    $$('#kv-cert-rows .cq-kv').at(-1).focus();
    openedFile = null;
    update();
  });
  $('#kv-cert-remove').addEventListener('click', () => {
    const c = readCert();
    if (c.hvl.length <= 1) return;
    renderCert({ kv: c.kv.slice(0, -1), hvl: c.hvl.slice(0, -1), mat: c.mat.slice(0, -1), val: c.val.slice(0, -1) });
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
    const s = sampleData();
    setVisit(sampleVisit(s));
    writeForm(rowForm(0));
    update();
    setStatus(L('Загружен демонстрационный пример (вымышленные данные): два режима, в режиме 2 k_pol и τ взяты из режима 1.', 'Demo example loaded (fictitious data): two modes; mode 2 takes k_pol and τ from mode 1.'));
  });
  armButton($('#kv-btn-clear'), () => L('Очистить', 'Clear'), () => L('Точно очистить?', 'Clear everything?'), () => {
    setVisit(normalizeKvVisit({ ...KV_DEFAULTS, kv_date: today() }));
    writeForm(rowForm(0));
    openedFile = null;
    update();
    setStatus(L('Форма очищена.', 'The form has been cleared.'));
  });

  const payload = () => JSON.stringify(payloadObj(), null, 2);
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
  $('#kv-btn-copy-report').addEventListener('click', () => copyText(reportText(current.data, current.result, current.all, current.vr), L('Протокол скопирован в буфер обмена.', 'Report copied to the clipboard.'), setStatus));
  $('#kv-btn-pdf').addEventListener('click', () => printToPdf([L('Дозиметрия', 'Dosimetry'), 'kV', current.data.kv_machine, current.data.kv_date].filter(Boolean).join('_'), setStatus));
  $('#kv-btn-print').addEventListener('click', () => window.print());
}
