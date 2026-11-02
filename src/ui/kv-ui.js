// Модуль «kV-рентген»: связывает форму с расчётным ядром kv.js (TRS-398 Rev.1, разд. 8 и 9).
import { KV_DEFAULTS, normalizeKv } from '../core/kv.js';
import { emptyKvRow, kvRowForm, normalizeKvSession, kvRowLabel, computeKvSession, kvRowEmpty, splitKvForm, KV_ROW_KEYS } from '../core/kv-session.js';
import { KV_CHAMBERS, kvChamberLabel, KV_PHANTOMS, resolveKvPhantom, kvPhantomStatus } from '../core/kv-tables.js';
import { TG61_T8_CHAMBER } from '../core/kv-tg61.js';
import { SAMPLE_KV, SAMPLE_KV_EN, SAMPLE_KV_ROWS } from '../core/sample-kv.js';
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

// черновик: { form, rows, active } (до 0.36.0 — плоская форма одного расчёта, читается как одна строка)
const DRAFT_KEY = 'reference-dosimetry.kv.v1';
// формат 2 (0.36.0): строки аппликаторов rows и выбранная строка active; form — плоская форма выбранной строки
const FILE_TAG = { app: 'reference-dosimetry', module: 'kv', version: 2 };
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

// ------------------------------------------------------------ таблица аппликаторов (раздел 4)
/** Строки аппликаторов: общие поля, строки и выбранная строка. Поля выбранной строки показаны в разделах формы. */
let sess = normalizeKvSession(null);
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
    <td class="no"><button type="button" class="kv-row-pick" aria-pressed="${active}" aria-label="${esc(L(`Строка ${i + 1}: показать подробно в разделах ниже`, `Row ${i + 1}: show in detail in the sections below`))}" title="${esc(L('Показать строку подробно в разделах ниже', 'Show the row in detail in the sections below'))}">${i + 1}</button></td>
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
  writeForm(kvRowForm(sess, i));
  update({ fromTable: true });
}

function addRow() {
  sess.rows.push(emptyKvRow(sess.rows.at(-1)));
  sess.active = sess.rows.length - 1;
  writeForm(kvRowForm(sess, sess.active));
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
  writeForm(kvRowForm(sess, sess.active));
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

    const empty = kvRowEmpty(sess.rows[i]);
    const errs = r.messages.filter((m) => m.level === 'error');
    const warns = r.messages.filter((m) => m.level === 'warn');
    const lvl = empty ? 'empty' : errs.length ? 'error' : warns.length ? 'warn' : 'ok';
    const tip = empty
      ? L('Строка не заполнена', 'The row is empty')
      : errs.length
        ? L(`Ошибок: ${errs.length}. ${errs[0].text}`, `Errors: ${errs.length}. ${errs[0].text}`)
        : warns.length
          ? L(`Предупреждений: ${warns.length}. ${warns[0].text}`, `Warnings: ${warns.length}. ${warns[0].text}`)
          : L('Замечаний нет', 'No issues');
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
  });

  // откуда k_pol и k_s у строк без своих серий
  const from = (j) => {
    const lab = kvRowLabel(sess.rows[j]);
    return L(`строки ${j + 1}${lab ? ` (${lab})` : ''}`, `row ${j + 1}${lab ? ` (${lab})` : ''}`);
  };
  const notes = [];
  if (n > 1 && all.results.some((r) => r.trs.kpolFrom)) notes.push(L(`k_pol строк без серии при обратной полярности — из ${from(all.polSrc)}.`, `k_pol of the rows without an opposite-polarity series is taken from ${from(all.polSrc)}.`));
  if (n > 1 && all.results.some((r) => r.trs.ksFrom)) notes.push(L(`k_s строк без серии при V₂ — из ${from(all.ksSrc)}.`, `k_s of the rows without a V₂ series is taken from ${from(all.ksSrc)}.`));
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
  of.hidden = n <= 1;
  if (n > 1) {
    const row = sess.rows[sess.active];
    const lab = kvRowLabel(row);
    const ssd = String(row.kv_ssd ?? '').trim();
    of.textContent = L(
      `Строка ${sess.active + 1} из ${n}${lab ? ` · ${lab}` : ''}${ssd ? ` · РИП ${ssd} см` : ''}`,
      `Row ${sess.active + 1} of ${n}${lab ? ` · ${lab}` : ''}${ssd ? ` · SSD ${ssd} cm` : ''}`,
    );
  }
}

// ------------------------------------------------------------ подписи по ветке расчёта
const nSym = (cal) => (cal === 'nk' ? 'K' : 'D,w');
const html = (el, s) => {
  if (el && el.innerHTML !== s) el.innerHTML = s;
};

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
  $('#kv-lbl-cq-hvl').textContent = L(`СПО, мм ${mat}`, `HVL, mm ${mat}`);
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
        ? L('Поле и РИП, при которых измерены k_Q,M рентгеновских качеств (DIN 6809-4): по ним считается k_g (раздел 8).', 'The field and SSD at which the x-ray k_Q,M were measured (DIN 6809-4): k_g is calculated from them (section 8).')
        : L('Поле и РИП, при которых получены коэффициенты сертификата: если клинические другие, нужна поправка k_g (раздел 8).', 'The field and SSD at which the certificate coefficients were obtained: if the clinical ones differ, a k_g correction is needed (section 8).'),
    ),
  );

  // задание облучения и таймер
  $('#kv-lbl-set').textContent = windowMode ? L('Время накопления заряда', 'Charge collection time') : L('Задание облучения', 'Exposure setting');
  $('#kv-set-sub').textContent = windowMode ? L('интервал, на котором электрометр накапливал заряд', 'the interval over which the electrometer collected charge') : L('одно и то же для всех серий показаний строки в разделе 5', 'the same for all reading series of the row in section 5');
  $('#kv-lbl-timer-mode').textContent = timeSet ? L('Ошибка таймера τ', 'Timer error τ') : L('Концевой эффект τ', 'End effect τ');
  $('#kv-lbl-tau').textContent = `τ, ${unit}`;
  $('#kv-lbl-tt').textContent = L(`Задание, ${unit}`, `Setting, ${unit}`);
  $('#kv-lbl-nxt').textContent = L(`Задание одиночного облучения X, ${unit}`, `Single exposure setting X, ${unit}`);
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
function reportText(data, r, all = null) {
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
  // строки аппликаторов: коротко все, подробно ниже — выбранная
  if (all && sess.rows.length > 1) {
    out.push('');
    out.push(L(`Аппликаторы (${sess.rows.length}); подробно ниже — строка ${sess.active + 1}:`, `Applicators (${sess.rows.length}); row ${sess.active + 1} is detailed below:`));
    sess.rows.forEach((row, k) => {
      const y = all.results[k];
      const t = y.trs;
      const p = primaryOf(t);
      const none = t.blocked || ctrlFailed(t);
      const at = whereText(y, atSurfOf(p, y));
      const lab = kvRowLabel(row) || '—';
      const ssd = String(row.kv_ssd ?? '').trim() || '—';
      const env = `T = ${String(row.kv_env_T ?? '').trim() || '—'} °C, P = ${String(row.kv_env_P ?? '').trim() || '—'} ${unitLabel(PRESSURE_UNITS[data.kv_env_P_unit])}`;
      const dose = none ? L('не вычислена (см. замечания строки)', 'not calculated (see the row messages)') : `${fmt(valueAt(p, y), 4)} ${t.rateLabel} ${at}`;
      const dev = !none && Number.isFinite(p.deviation) ? L(`, отклонение ${fmtSigned(p.deviation, 2)} %`, `, deviation ${fmtSigned(p.deviation, 2)} %`) : '';
      const from = [t.kpolFrom ? L(`k_pol из ${t.kpolFrom}`, `k_pol from ${t.kpolFrom}`) : '', t.ksFrom ? L(`k_s из ${t.ksFrom}`, `k_s from ${t.ksFrom}`) : ''].filter(Boolean).join(', ');
      out.push(
        L(
          `  ${k + 1}. ${lab}, РИП ${ssd} см; ${env}; M₁ ${cells(row.kv_M1) || '—'} нКл; k_TP = ${fmt(t.kTP)}; D = ${dose}${dev}${from ? ` (${from})` : ''}`,
          `  ${k + 1}. ${lab}, SSD ${ssd} cm; ${env}; M₁ ${cells(row.kv_M1) || '—'} nC; k_TP = ${fmt(t.kTP)}; D = ${dose}${dev}${from ? ` (${from})` : ''}`,
        ),
      );
    });
    out.push('');
  }
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
          : L(`${ns},Qo = ${data.kv_n} ${unitN}${r.qo === 'co60' ? ' (⁶⁰Co, 5 см)' : ''}, k_Q по качествам`, `${ns},Qo = ${data.kv_n} ${unitN}${r.qo === 'co60' ? ' (⁶⁰Co, 5 cm)' : ''}, k_Q per quality`);
  line(L('Сертификат', 'Certificate'), formTxt);
  // как введено в таблицу (с теми же знаками), по возрастанию СПО
  const raw = (key, q) => String(data[key][q.row - 1] ?? '').trim();
  const qs = r.cert.rows?.map((q) => `${raw('kv_cq_kv', q) ? L(`${raw('kv_cq_kv', q)} кВ / `, `${raw('kv_cq_kv', q)} kV / `) : ''}${raw('kv_cq_hvl', q)} ${L('мм', 'mm')} ${mat} → ${raw('kv_cq_val', q)}`).join('; ');
  if (qs) line(L('Качества сертификата', 'Certificate qualities'), qs);
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
  else if (x.kpolFrom) line(L('M(V1, обратная)', 'M(V1, opposite)'), L(`в этой строке не измерялось; k_pol из ${x.kpolFrom}`, `not measured in this row; k_pol from ${x.kpolFrom}`));
  else line(L('M(V1, обратная)', 'M(V1, opposite)'), L('не измерялось (k_pol = 1)', 'not measured (k_pol = 1)'));
  if (data.kv_ks_on && x.ksFrom) line(L('M(V2)', 'M(V2)'), L(`в этой строке не измерялось; k_s из ${x.ksFrom}`, `not measured in this row; k_s from ${x.ksFrom}`));
  else if (data.kv_ks_on) line(L('M(V2), нКл', 'M(V2), nC'), `${cells(data.kv_M2)} → ${mean} ${fmt(Math.abs(i.M2.mean), 4)}`);
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
      if (r.depth.on && Number.isFinite(y.perUnitSurf)) {
        const pp = r.depth.phantom ? L(` (фантом: ${phName(r.depth.phantom)})`, ` (phantom: ${phName(r.depth.phantom)})`) : '';
        out.push(L(`  PDD(2 см) = ${fmt(r.depth.pdd, 1)} %${pp}; на поверхности ${fmt(y.perUnitSurf, 4)} ${x.rateLabel}`, `  PDD(2 cm) = ${fmt(r.depth.pdd, 1)} %${pp}; at the surface ${fmt(y.perUnitSurf, 4)} ${x.rateLabel}`));
      }
    };
    if (x.ctrl && !x.ctrl.blocked) describe(x.ctrl, L('По контрольным измерениям (раздел 7)', 'From check measurements (section 7)'));
    else if (r.ctrl.on) out.push(L('РЕЗУЛЬТАТ НЕ ВЫЧИСЛЕН: в контрольных измерениях (раздел 7) ошибки (см. замечания).', 'RESULT NOT CALCULATED: the check measurements (section 7) contain errors (see Messages).'));
    else describe(x, L('По показанию M₁ раздела 5 (контрольные измерения не введены)', 'From reading M₁ of section 5 (no check measurements entered)'));
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
  sess = normalizeKvSession(obj);
  writeForm(kvRowForm(sess, sess.active));
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
    // калибровки в рентгене нет: k_g = 1 — в бюджете как k_g = 1 по DIN
    kvKg: src === 'same' || src === 'one' ? src : src === 'nocal' ? 'one' : 'calc',
    kvKq: result.cert.kq1 ? 'one' : 'cert',
    M: p === x.ctrl ? data.kv_Mc : data.kv_M1,
    // доза на опорной глубине (поверхность или 2 г/см²): бюджет Rev.1 составлен для неё
    value: none ? NaN : p.perUnit,
    unit: { min: 'Gymin', s: 'Gymin', Gy: 'GyGy', MU: 'cGyMU' }[i.unit] ?? 'Gymin',
    ki: null,
    meta: { institution: data.kv_institution, machine: data.kv_machine, beam, date: data.kv_date, staff: data.kv_staff },
  };
}

// ------------------------------------------------------------ цикл
let current = { data: null, result: null, all: null };

/** Сверка с открытым файлом: итог выбранной строки с её итогом в файле (у файлов до 0.36.0 — одна строка). */
function fileNote(result) {
  if (!openedFile) return null;
  const saved = Array.isArray(openedFile.rowResults) ? openedFile.rowResults[sess.active] : (Number(openedFile.active) || 0) === sess.active ? openedFile.result : null;
  return saved ? compareWithFile({ ...openedFile, result: saved }, snapshot(result), snapCmp(result)) : null;
}

/**
 * Пересчёт. opts.fromTable — ввод пришёл из таблицы аппликаторов или выбрана строка: поля формы уже совпадают
 * со строкой, таблица не перерисовывается (фокус остаётся в ней). Иначе поля формы читаются в выбранную строку и
 * таблица строится заново.
 */
function update(opts = {}) {
  if (!opts.fromTable) {
    const { shared, row } = splitKvForm(readForm());
    sess.shared = shared;
    sess.rows[sess.active] = row;
  }
  const all = computeKvSession(sess);
  const result = all.results[sess.active];
  const data = normalizeKv(kvRowForm(sess, sess.active));
  current = { data, result, all };
  if (!opts.fromTable) renderRows(data, result);
  applyVisibility(data, result);
  renderOutputs(ROOT(), result);
  renderFlags(ROOT(), result.flags, seriesBox);
  renderReadout(result, data);
  renderRowsState(all);
  $('#kv-demo-flag').hidden = !isDemo(data);
  renderNotesFlag($('#kv-notes-flag'), data.kv_notes, [SAMPLE_KV.kv_notes, SAMPLE_KV_EN.kv_notes], isDemo(data));
  renderFileNote($('#kv-file-note'), fileNote(result));
  saveDraft({ form: data, rows: sess.rows, active: sess.active });
  renderSignBlock($('#kv-sign'), data.kv_staff);
  notifyUpdate(ROOT());
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
  fillPhantomSelects();
  $$('#kv-sheet .cells').forEach((box) => setupCells(box, update));
  setupPairs(pairsBox(), update);
  $$('#kv-sheet > section .combo').forEach((c) => makeCombo(c));

  const draft = loadDraft();
  // без черновика вкладка открывается пустой: пример — только по кнопке «Загрузить пример»
  sess = normalizeKvSession(draft && typeof draft === 'object' ? draft : { ...KV_DEFAULTS, kv_date: today() });
  writeForm(kvRowForm(sess, sess.active));
  localizeDemo(SAMPLE_KV, SAMPLE_KV_EN);
  update();
  if (!draft) setStatus(L('Введите свои данные или нажмите «Загрузить пример» (раздел «Данные»), чтобы посмотреть расчёт на вымышленных значениях.', 'Enter your own data or click "Load example" (the Data panel) to see the calculation on fictitious values.'));

  const sheet = $('#kv-sheet');
  const inTable = (el) => !!el?.closest?.('#kv-rows-body');
  sheet.addEventListener('input', (e) => {
    if (inTable(e.target)) return onRowInput(e.target);
    openedFile = null;
    update();
  });
  sheet.addEventListener('change', (e) => {
    // список формы тубуса в таблице уже обработан по событию input
    if (inTable(e.target)) return;
    openedFile = null;
    if (e.target.id === 'kv_ch_model') {
      const id = e.target.value;
      if (id.startsWith('MY:')) fillCustomFields(getMyChambers().find((c) => c.id === id));
      else if (id === 'CUSTOM') fillCustomFields(null);
    }
    update();
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
    const s = sampleData();
    sess = normalizeKvSession({ form: s, rows: [s, ...SAMPLE_KV_ROWS], active: 0 });
    writeForm(kvRowForm(sess, 0));
    update();
    setStatus(L('Загружен демонстрационный пример (вымышленные данные).', 'Demo example loaded (fictitious data).'));
  });
  armButton($('#kv-btn-clear'), () => L('Очистить', 'Clear'), () => L('Точно очистить?', 'Clear everything?'), () => {
    sess = normalizeKvSession({ ...KV_DEFAULTS, kv_date: today() });
    writeForm(kvRowForm(sess, 0));
    openedFile = null;
    update();
    setStatus(L('Форма очищена.', 'The form has been cleared.'));
  });

  // result — итог выбранной строки (как в файлах до 0.36.0), rowResults — итоги всех строк для сверки при открытии
  const payload = () =>
    JSON.stringify(
      { ...FILE_TAG, ...fileStamp(snapshot(current.result)), rowResults: current.all.results.map(snapshot), savedAt: new Date().toISOString(), form: current.data, rows: sess.rows, active: sess.active },
      null,
      2,
    );
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
  $('#kv-btn-copy-report').addEventListener('click', () => copyText(reportText(current.data, current.result, current.all), L('Протокол скопирован в буфер обмена.', 'Report copied to the clipboard.'), setStatus));
  $('#kv-btn-pdf').addEventListener('click', () => printToPdf([L('Дозиметрия', 'Dosimetry'), 'kV', current.data.kv_machine, current.data.kv_date].filter(Boolean).join('_'), setStatus));
  $('#kv-btn-print').addEventListener('click', () => window.print());
}
