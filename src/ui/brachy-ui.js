// Вкладка «Брахитерапия»: листы «Колодезная камера» (IAEA TRS-492), «Максимум отклика» (TRS-492, разд. 8.2.1),
// «Фантом PTW 9193» (DIN 6809-2, DGMP-Bericht 13, руководство PTW), «Сличение камер» (TRS-492, разд. 7.7), «Стабильность»
// (разд. 8.4–8.5) и «Распад» (TRS-492, разд. 3.4, 7.3). Сертификат
// источника — общий для листов. Расчёт — core/brachy-sheets.js; черновик формы — в этом браузере.
import { L, refText, getLang } from '../core/i18n.js';
import { PRESSURE_UNITS, unitLabel, parseNumber } from '../core/units.js';
import { HALF_LIVES, KSM_SOURCES, PTW_TO_DGMP, APPLICATOR_KA_STEEL, CERT_TOLERANCE } from '../core/brachy-data.js';
import { kDec } from '../core/brachy.js';
import {
  BRACHY_DEFAULTS, normalizeBrachy, computeBrachyWell, computeBrachyPhantom, computeBrachySweet, computeBrachyDecay, computeBrachyCross, computeBrachyStability, computeBrachyTg43, fieldTime,
  STRENGTH_UNITS, ACTIVITY_UNITS, GAMMA_UNITS, WELL_N_UNITS, PHANTOM_N_UNITS, CURRENT_UNITS, DOSE_SOURCES,
} from '../core/brachy-sheets.js';
import { $, esc, fmt, fmtSigned, richText, armButton, downloadText, savedFileName, printToPdf, versionText, pinSignaturesForPrint } from './common.js';
import { scatterChart, legendSwatch } from './chart.js';
import { renderCells, readCells, setupCells } from './widgets.js';
import { cellsHtml } from './journal-common.js';
import { tipAttr } from './brachy-tips.js';
import { wellBudget, phantomBudget } from '../core/brachy-unc.js';
import { parseOverrides } from '../core/uncertainty.js';
import { brachyMachines, sourceOn, sourceText, sourceModelName, sourceToForm, certRowsFor, wellChamberToForm, phantomChamberToForm, isWellModel, wellChamberLabel } from '../core/brachy-journal.js';
import { chamberText, chamberUse, cobaltCapable, activeOnly, dayNumber, orgText } from '../core/journal.js';
import { getJournal, onJournal, updateJournal } from './journal-store.js';
import { drawChart, legendHtml, segmentLine, trendLine, signalsHtml, pointRules } from './journal-spc-ui.js';
import { controlChart } from '../core/spc.js';
import { sampleBrachy, isBrachySample } from '../core/sample-brachy.js';
import { BRACHY_RECORD_SHEETS, BRACHY_DATE_KEY, brachySheetText, recordBrachy, brachyRecordsOf, formFromRecord, removeBrachyRecord } from '../core/brachy-records.js';

const KEY = 'reference-dosimetry.brachy';
const SHEETS = ['well', 'sweet', 'phantom', 'cross', 'stab', 'decay', 'tg43', 'log'];
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

// ------------------------------------------------------------ выбор из «Оборудования» (с 0.75.0)
// Афтерлоадер и источник, колодезная камера и строка её сертификата, камера фантома — из журнала отделения. Выбранное
// подставляется в поля листа (их можно поправить); в черновике хранятся только id выбранного.
const isoToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
/** Дата измерения листа: по ней выбирается источник, стоявший в аппарате. */
const measDate = () => (sheet === 'sweet' ? form.s_date : sheet === 'phantom' ? form.p_date : sheet === 'cross' ? form.x_ref_date : sheet === 'stab' ? form.st_date : form.w_date) || isoToday();
const MEAS_DATE_IDS = ['br_w_date', 'br_p_date', 'br_x_ref_date', 'br_st_date', 'br_s_date'];
/** Афтерлоадер и источник журнала по выбору: явно выбранный источник или стоявший в аппарате на дату измерения. */
function journalSource() {
  const m = brachyMachines(getJournal()).find((x) => x.id === form.j_machine) ?? null;
  if (!m) return { m: null, s: null };
  const s = form.j_source ? m.sources.find((x) => x.id === form.j_source) ?? null : sourceOn(m, measDate());
  return { m, s };
}
const wellChambers = () => activeOnly(getJournal().chambers).filter((c) => isWellModel(c.form?.ch_model));
const chamberById = (id) => (id ? getJournal().chambers.find((c) => c.id === id) ?? null : null);
/** Строка сертификата камеры c для нуклида листа: выбранная (поле key) или первая. */
function certRow(c, key) {
  const rows = certRowsFor(c, form.nuclide);
  return rows.find((r) => r.id === form[key]) ?? rows[0] ?? null;
}
/** Подставить источник журнала в поля листа. */
function applySource() {
  const { m, s } = journalSource();
  if (s) Object.assign(form, sourceToForm(s, m));
}
/** Подставить колодезную камеру и строку сертификата; k_sm,sm0 — по моделям источника аппарата и источника калибровки. */
function applyWell() {
  const c = chamberById(form.j_well);
  const row = c && certRow(c, 'j_row');
  if (!row) return;
  const sm = journalSource().s?.model ?? '';
  Object.assign(form, wellChamberToForm(c, row, { name: wellChamberLabel(c.form), sourceModel: sm }));
  // TRS-492, табл. 8 — только для Standard Imaging HDR 1000 Plus (держатель 70010) и моделей источников таблицы
  const inTable = (id) => KSM_SOURCES.some((k) => k.id === id);
  if (c.form?.ch_model === 'SIHDR1000P' && row.sm0 && sm && row.sm0 !== sm && inTable(row.sm0) && inTable(sm)) Object.assign(form, { w_ksm_mode: 'table', w_sm: sm, w_sm0: row.sm0 });
}
/** Камеры для фантома: отмеченные для брахитерапии, затем остальные с N_D,w в ⁶⁰Co. */
function phantomChambers() {
  const j = getJournal();
  const all = activeOnly(j.chambers).filter((c) => cobaltCapable(c.form));
  const marked = all.filter((c) => chamberUse(c, j).brachy);
  return { marked, other: all.filter((c) => !marked.includes(c) && String(c.form?.ch_ndw ?? '').trim()) };
}
const modelName = (c) => chamberText({ ...c, form: { ...c.form, ch_serial: '' } });
function applyPhantom() {
  const c = chamberById(form.j_phantom);
  if (c) Object.assign(form, phantomChamberToForm(c, { name: modelName(c) }));
}
/** Эталонная и рабочая камеры листа «Сличение камер»: модель, номер, N эталонной с T₀ и P₀, прежний N рабочей. */
function applyCross() {
  const ref = chamberById(form.j_ref);
  const rr = ref && certRow(ref, 'j_ref_row');
  if (rr) {
    Object.assign(form, { x_ref_model: wellChamberLabel(ref.form), x_ref_serial: String(ref.form?.ch_serial ?? ''), x_ref_N: rr.N, x_ref_N_unit: rr.N_unit, x_T0: ref.brachy?.T0 || '20', x_P0: ref.brachy?.P0 || '101,325', x_P0_unit: 'kPa' });
  }
  const fld = chamberById(form.j_fld);
  if (fld) {
    const fr = certRow(fld, 'j_fld_row');
    Object.assign(form, { x_fld_model: wellChamberLabel(fld.form), x_fld_serial: String(fld.form?.ch_serial ?? '') });
    if (fr && (!rr || fr.N_unit === rr.N_unit)) form.x_fld_prev = fr.N;
  }
}
const chOpts = (list, cur) => list.map((c) => opt(c.id, chamberText(c) || L('камера без названия', 'unnamed chamber'), cur)).join('');
/** Выбор строки сертификата камеры c (поле key). */
function rowSelect(c, key, label) {
  if (!c) return '';
  const rows = certRowsFor(c, form.nuclide);
  const cur = certRow(c, key)?.id ?? '';
  const nuc = HALF_LIVES[form.nuclide]?.label ?? form.nuclide;
  const o = rows.length
    ? rows.map((r) => opt(r.id, `${r.label || L('строка', 'row')} — N = ${r.N || '—'}`, cur)).join('')
    : opt('', L(`нет строк для ${nuc}`, `no rows for ${nuc}`), '');
  return select(key, label, o, { span: ' span-2' });
}
const EQ_HINT = () => L('Афтерлоадер с источниками и камеры с сертификатами можно завести в «Оборудовании» — тогда их данные подставятся сюда сами.', 'Afterloaders with their sources and chambers with certificates can be entered in Equipment: then their data are filled in here.');
const NOT_EQ = () => L('— не из «Оборудования» —', '— not from Equipment —');
function journalSourceHtml() {
  const ms = brachyMachines(getJournal());
  if (!ms.length) return '';
  const { m, s } = journalSource();
  const mOpts = opt('', NOT_EQ(), form.j_machine) + ms.map((x) => opt(x.id, x.name || L('афтерлоадер без названия', 'unnamed afterloader'), form.j_machine)).join('');
  const auto = m ? sourceOn(m, measDate()) : null;
  const none = L('источника нет', 'no source');
  const sOpts = m ? opt('', L(`по дате измерения: ${sourceText(auto) || none}`, `by the measurement date: ${sourceText(auto) || none}`), form.j_source) + [...m.sources].reverse().map((x) => opt(x.id, sourceText(x) || L('источник без данных', 'source without data'), form.j_source)).join('') : '';
  return `${select('j_machine', L('Афтерлоадер из «Оборудования»', 'Afterloader from Equipment'), mOpts, { span: ' span-2' })}
    ${m ? select('j_source', L('Источник', 'Source'), sOpts, { span: ' span-2' }) : ''}
    ${m && !s ? `<p class="sub-hint span-all">${esc(L('На дату измерения источника в аппарате нет: проверьте даты установки и замены в «Оборудовании».', 'There is no source in the afterloader on the measurement date: check the installation and replacement dates in Equipment.'))}</p>` : ''}`;
}
function journalWellHtml(rows = true) {
  const list = wellChambers();
  if (!list.length) return '';
  const c = chamberById(form.j_well);
  return `${select('j_well', L('Камера из «Оборудования»', 'Chamber from Equipment'), opt('', NOT_EQ(), form.j_well) + chOpts(list, form.j_well), { span: ' span-2' })}
    ${rows ? rowSelect(c, 'j_row', L('Строка сертификата', 'Certificate row')) : ''}`;
}
/** Только афтерлоадер (лист «Максимум отклика»: положение зависит от аппарата и ампулопровода). */
function journalMachineHtml() {
  const ms = brachyMachines(getJournal());
  if (!ms.length) return '';
  return select('j_machine', L('Афтерлоадер из «Оборудования»', 'Afterloader from Equipment'), opt('', NOT_EQ(), form.j_machine) + ms.map((x) => opt(x.id, x.name || L('афтерлоадер без названия', 'unnamed afterloader'), form.j_machine)).join(''), { span: ' span-2' });
}
function journalPhantomHtml() {
  const { marked, other } = phantomChambers();
  if (!marked.length && !other.length) return '';
  const o = opt('', NOT_EQ(), form.j_phantom) + chOpts(marked, form.j_phantom)
    + (other.length ? `<optgroup label="${esc(L('другие камеры с N_D,w в ⁶⁰Co', 'other chambers with N_D,w in ⁶⁰Co'))}">${chOpts(other, form.j_phantom)}</optgroup>` : '');
  return select('j_phantom', L('Камера из «Оборудования»', 'Chamber from Equipment'), o, { span: ' span-2' });
}
function journalCrossHtml(pre) {
  const list = wellChambers();
  if (!list.length) return '';
  const key = pre === 'x_ref_' ? 'j_ref' : 'j_fld';
  const c = chamberById(form[key]);
  return `${select(key, L('Камера из «Оборудования»', 'Chamber from Equipment'), opt('', NOT_EQ(), form[key]) + chOpts(list, form[key]), { span: ' span-2' })}
    ${rowSelect(c, `${key}_row`, pre === 'x_ref_' ? L('Строка сертификата', 'Certificate row') : L('Строка сертификата (прежний N)', 'Certificate row (previous N)'))}`;
}
const anyEquipment = () => brachyMachines(getJournal()).length || wellChambers().length;

// ------------------------------------------------------------ запись в журнал и лист «Журнал» (с 0.76.0)
// Измерения листов «Колодезная камера», «Фантом PTW 9193», «Стабильность», «Сличение камер», «Максимум отклика»
// записываются в журнал отделения (j.brachyRecords, core/brachy-records.js); лист «Журнал» — список записей с отбором
// по аппарату или камере, тренд отклонения от сертификата источника и от исходного значения камеры.
const staffNames = () => (getJournal().staff ?? []).map((s) => String(s.name ?? '').trim()).filter(Boolean);
/** Результат листа sh по текущей форме. */
function sheetCompute(sh = sheet) {
  const o = { offsetMin: offsetMin() };
  if (sh === 'well') return computeBrachyWell(form, o);
  if (sh === 'phantom') return computeBrachyPhantom(form, o);
  if (sh === 'stab') return computeBrachyStability(form, o);
  if (sh === 'cross') return computeBrachyCross(form, o);
  return computeBrachySweet(form);
}
const logLink = () => {
  const n = (getJournal().brachyRecords ?? []).length;
  return `<a href="#brachy/log" data-goto="brachy/log">${esc(L(`Журнал брахитерапии (записей: ${n})`, `Brachytherapy journal (${n} records)`))}</a>`;
};
function recordHtml(n) {
  if (!BRACHY_RECORD_SHEETS.includes(sheet)) return '';
  const by = ['well', 'phantom', 'sweet'].includes(sheet) ? L('по афтерлоадеру', 'by afterloader') : L('по камере', 'by chamber');
  return `<section class="start-card plates-card"><h2><span class="step-no">${n}</span> ${esc(L('Запись в журнал', 'Journal record'))}</h2>
    <datalist id="br-staff">${staffNames().map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
    <div class="grid">
      ${text('rec_staff', L('Выполнил(и)', 'Performed by'), { list: 'br-staff', ph: L('через запятую', 'comma-separated'), span: ' span-2' })}
      ${text('rec_notes', L('Примечание к записи', 'Record note'), { span: ' span-2' })}
    </div>
    <div class="actions"><button type="button" data-br="record">${esc(L('Записать в журнал', 'Record to the journal'))}</button>${logLink()}</div>
    <p class="sub-hint">${esc(L(`Запись — измерение этого листа за день ${by} из «Оборудования»: повторная запись того же дня заменяет прежнюю. Записи хранятся в журнале отделения — сохраните его в файл, если автосохранение не включено.`, `A record is the measurement of this sheet on a day ${by} from Equipment: recording the same day again replaces the earlier one. The records are kept in the department journal: save it to the file if autosave is off.`))}</p>
  </section>`;
}

function doRecord() {
  readForm();
  const r = sheetCompute();
  const src = ['well', 'phantom'].includes(sheet) ? journalSource().s?.id ?? '' : '';
  let res = null;
  updateJournal((j) => {
    res = recordBrachy(j, { sheet, form, r, staff: String(form.rec_staff ?? '').split(/[,;]/), notes: form.rec_notes, sourceId: src, today: isoToday() });
    return res.error ? j : res.journal;
  }, 'brachy');
  if (res.error) {
    status(res.error);
    return;
  }
  form.rec_notes = '';
  persist();
  render();
  const what = brachySheetText(sheet);
  status(res.replaced
    ? L(`Запись в журнале заменена: ${what}, ${isoDateText(res.record.date)}. Сохраните журнал в файл, если автосохранение не включено.`, `The journal record has been replaced: ${what}, ${isoDateText(res.record.date)}. Save the journal file if autosave is off.`)
    : L(`Записано в журнал: ${what}, ${isoDateText(res.record.date)}. Записи — лист «Журнал»; сохраните журнал в файл, если автосохранение не включено.`, `Recorded to the journal: ${what}, ${isoDateText(res.record.date)}. The records are on the Journal sheet; save the journal file if autosave is off.`));
}

// ------------------------------------------------------------ протокол измерения (с 0.77.0)
// Протокол листа, измерение которого записывается в журнал: шапка (дата, учреждение, аппарат, источник, средства и
// условия измерений, методика), результат (те же числа, что на листе, без кнопок), неопределённость (колодезная камера,
// фантом), заключение, примечание и подписи. Печатается отдельно от листа (body.print-br-protocol, styles.css); PDF —
// то же окно печати. Протокол записи журнала — «Открыть» запись на листе «Журнал», затем «Печать протокола».
let protOpen = false;
const pStr = (v) => String(v ?? '').trim();
const pRow = (k, v) => (v ? `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>` : '');
const pressText = (v, unit) => (pStr(v) ? `${esc(pStr(v))} ${esc(unitLabel(PRESSURE_UNITS[unit]) ?? '')}` : '');
const climateText = (T, P, unit) => [pStr(T) ? `T ${esc(pStr(T))} °C` : '', P ? `P ${P}` : ''].filter(Boolean).join('; ');
const serialText = (s) => (pStr(s) ? L(` № ${esc(pStr(s))}`, ` S/N ${esc(pStr(s))}`) : '');
/** Сертификат колодезной камеры из «Оборудования» (если выбрана): номер, лаборатория, дата калибровки. */
function eqCertText(id) {
  const b = chamberById(id)?.brachy;
  if (!b) return '';
  const parts = [pStr(b.cert) ? L(`сертификат № ${esc(b.cert)}`, `certificate No. ${esc(b.cert)}`) : '', pStr(b.calDate) ? L(`калибровка ${esc(isoDateText(b.calDate))}`, `calibrated ${esc(isoDateText(b.calDate))}`) : '', esc(pStr(b.lab))].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')})` : '';
}
const wellN = () => (pStr(form.w_N) ? `; N = ${esc(pStr(form.w_N))} ${esc(unitLabel(WELL_N_UNITS[form.w_N_unit]) ?? '')}` : '');
function protDevices() {
  const well = () => `${esc(pStr(form.w_model) || L('колодезная камера', 'well-type chamber'))}${serialText(form.w_serial)}${eqCertText(form.j_well)}`;
  if (sheet === 'well') return `${well()}${wellN()}`;
  if (sheet === 'sweet') return well();
  if (sheet === 'stab') {
    const c = chamberById(form.j_well);
    return c ? esc(chamberText(c)) : '';
  }
  if (sheet === 'phantom') {
    const n = pStr(form.p_N) ? `; ${form.p_calib === 'Nw' ? 'N_D,w' : form.p_calib === 'Na' ? 'N_K' : 'N_X'} = ${esc(pStr(form.p_N))} ${esc(unitLabel(PHANTOM_N_UNITS[form.p_N_unit]) ?? '')}` : '';
    return `${esc(pStr(form.p_model) || L('камера', 'chamber'))}${serialText(form.p_serial)}${sub(n)}; ${esc(L('фантом PTW 9193', 'PTW 9193 phantom'))}`;
  }
  const ref = `${esc(L('эталонная', 'reference'))}: ${esc(pStr(form.x_ref_model) || '—')}${serialText(form.x_ref_serial)}${eqCertText(form.j_ref)}${pStr(form.x_ref_N) ? `; N_ref = ${esc(pStr(form.x_ref_N))} ${esc(unitLabel(WELL_N_UNITS[form.x_ref_N_unit]) ?? '')}` : ''}`;
  const fld = `${esc(L('рабочая', 'field'))}: ${esc(pStr(form.x_fld_model) || '—')}${serialText(form.x_fld_serial)}`;
  return `${ref}<br>${fld}`;
}
function protClimate() {
  if (sheet === 'well') return climateText(form.w_T, pressText(form.w_P, form.w_P_unit));
  if (sheet === 'phantom') return climateText(form.p_holes?.[0]?.T, pressText(form.p_holes?.[0]?.P, form.p_P_unit));
  if (sheet === 'stab') return form.st_method === 'redundant' ? '' : climateText(form.st_T, pressText(form.st_P, form.st_P_unit));
  if (sheet === 'cross') {
    const a = climateText(form.x_ref_T, pressText(form.x_ref_P, form.x_P_unit));
    const b = climateText(form.x_fld_T, pressText(form.x_fld_P, form.x_P_unit));
    return a === b ? a : [a && L(`эталонная: ${a}`, `reference: ${a}`), b && L(`рабочая: ${b}`, `field: ${b}`)].filter(Boolean).join('<br>');
  }
  return '';
}
function protMethod() {
  const t = {
    well: L('IAEA TRS-492 (2023), гл. 8: ОМВК колодезной камерой (ур. 21, 27); сравнение с сертификатом — разд. 8.6.2', 'IAEA TRS-492 (2023), Ch. 8: RAKR with a well-type chamber (Eq. 21, 27); comparison with the certificate: Sec. 8.6.2'),
    phantom: L('DIN 6809-2, DGMP-Bericht 13, руководство PTW к фантому 9193; сравнение с сертификатом — IAEA TRS-492 (2023), разд. 8.6.2', 'DIN 6809-2, DGMP Report 13, PTW manual of the 9193 phantom; comparison with the certificate: IAEA TRS-492 (2023), Sec. 8.6.2'),
    stab: L(`IAEA TRS-492 (2023), разд. 8.5; метод: ${stabMethodText(form.st_method)}`, `IAEA TRS-492 (2023), Sec. 8.5; method: ${stabMethodText(form.st_method)}`),
    cross: L('IAEA TRS-492 (2023), разд. 7.7, ур. 18–20 (сличение с эталонной камерой)', 'IAEA TRS-492 (2023), Sec. 7.7, Eq. 18–20 (cross-calibration against the reference chamber)'),
    sweet: L('IAEA TRS-492 (2023), разд. 8.2.1 (кривая отклика по положению источника)', 'IAEA TRS-492 (2023), Sec. 8.2.1 (response curve by source position)'),
  }[sheet];
  return esc(t ?? '');
}
function protSource() {
  if (!['well', 'phantom', 'sweet'].includes(sheet)) return '';
  const nuc = HALF_LIVES[form.nuclide]?.label ?? form.nuclide;
  const name = pStr(form.src_name);
  const unit = unitLabel(STRENGTH_UNITS[form.cert_unit] ?? ACTIVITY_UNITS[form.cert_unit]) ?? '';
  const cert = sheet !== 'sweet' && pStr(form.cert_value) ? L(`; по сертификату ${esc(pStr(form.cert_value))} ${esc(unit)}${pStr(form.cert_date) ? ` на ${esc(isoDateText(form.cert_date))}` : ''}`, `; certificate ${esc(pStr(form.cert_value))} ${esc(unit)}${pStr(form.cert_date) ? ` at ${esc(isoDateText(form.cert_date))}` : ''}`) : '';
  return `${esc(nuc)}${name ? `, ${esc(name)}` : ''}${cert}`;
}
function protMachine() {
  if (!['well', 'phantom', 'sweet'].includes(sheet)) return '';
  const m = getJournal().machines.find((x) => x.id === form.j_machine && x.kind === 'brachy');
  return m ? esc([machineName(m), pStr(m.serial) ? L(`№ ${m.serial}`, `S/N ${m.serial}`) : ''].filter(Boolean).join(', ')) : '';
}
/** Результат листа для протокола: то же, что на листе, без кнопок, полей и сведений-подсказок. */
function protResult(done) {
  const results = { well: wellResult, sweet: sweetResult, cross: crossResult, stab: stabResult, phantom: phantomResult };
  const tmp = document.createElement('div');
  tmp.innerHTML = results[sheet]();
  for (const el of tmp.querySelectorAll(done ? '.actions, .jlink-st.none' : '.actions')) el.remove();
  for (const el of tmp.querySelectorAll('input[type="radio"]')) el.replaceWith(el.checked ? '●' : '');
  for (const el of tmp.querySelectorAll('[id]')) el.removeAttribute('id');
  return (done ? '' : `<p class="sub-hint">${esc(L('Расчёт не выполнен: заполните лист.', 'The calculation is not done: complete the sheet.'))}</p>`) + tmp.innerHTML;
}
/** Неопределённость для протокола (колодезная камера, фантом): составляющие и U, k = 2. */
function protUnc() {
  const { b, value } = budgetFor();
  if (!Number.isFinite(b.uc)) return '';
  const rows = b.rows.filter((r) => Number.isFinite(r.value)).map((r) => `<tr><td>${sub(r.label)}</td><td class="v">${esc(uNum(r.value))}</td></tr>`).join('');
  const abs = Number.isFinite(value) ? L(` (±${fmt((value * b.U) / 100, 3)} мГр/ч на 1 м)`, ` (±${fmt((value * b.U) / 100, 3)} mGy/h at 1 m)`) : '';
  return `<table><thead><tr><th>${esc(L('Составляющая', 'Component'))}</th><th class="v">${esc(L('u, % (k = 1)', 'u, % (k = 1)'))}</th></tr></thead><tbody>${rows}
    <tr><th scope="row">${sub(L('Суммарная u_c', 'Combined u_c'))}</th><td class="v">${esc(uNum(b.uc))}</td></tr>
    <tr><th scope="row">${sub(L('Расширенная U, k = 2', 'Expanded U, k = 2'))}</th><td class="v">${esc(fmt(b.U, 1))}</td></tr></tbody></table>
    <p class="kv-prot-note">${sub(L(`Расширенная неопределённость ОМВК ±${fmt(b.U, 1)} %${abs}; ${sheet === 'well' ? 'составляющие — IAEA TRS-492 (2023), табл. 10' : 'составляющие — Ubrich 2014'}, свои значения — с листа.`, `Expanded uncertainty of the RAKR ±${fmt(b.U, 1)}%${abs}; ${sheet === 'well' ? 'components: IAEA TRS-492 (2023), Table 10' : 'components: Ubrich 2014'}, own values from the sheet.`))}</p>`;
}
/** Заключение по результату r листа. */
function protConclusion(r) {
  if (!r?.ok && sheet !== 'phantom') return [];
  if (sheet === 'well' || sheet === 'phantom') {
    if (!Number.isFinite(r.U)) return [];
    const out = [L(`ОМВК на время измерения ${fmt(r.mGyh, 3)} мГр/ч на 1 м (S_K = ${fmt(r.U, 0)} U).`, `RAKR at the measurement time ${fmt(r.mGyh, 3)} mGy/h at 1 m (S_K = ${fmt(r.U, 0)} U).`)];
    if (r.compare) out.push(r.compare.text + (r.compare.ref ? ` (${refText(r.compare.ref)})` : ''));
    else out.push(L('Сравнение с сертификатом источника не выполнено: нет данных сертификата или даты.', 'No comparison with the source certificate: the certificate data or the date are missing.'));
    return out;
  }
  if (sheet === 'stab') {
    if (!Number.isFinite(r.dev)) return [L('Исходное значение не задано: отклонение не вычислено.', 'No baseline: the deviation was not calculated.')];
    return [r.pass
      ? L(`Отклонение от исходного ${fmtSigned(r.dev, 2)} %: в пределах ±${fmt(r.tol, 1)} %. Камера стабильна (IAEA TRS-492, разд. 8.5).`, `Deviation from the baseline ${fmtSigned(r.dev, 2)}%: within ±${fmt(r.tol, 1)}%. The chamber is stable (IAEA TRS-492, Sec. 8.5).`)
      : L(`Отклонение от исходного ${fmtSigned(r.dev, 2)} %: вне ±${fmt(r.tol, 1)} %. Выяснить причину; при подтверждении — внеочередная калибровка камеры (IAEA TRS-492, разд. 8.5).`, `Deviation from the baseline ${fmtSigned(r.dev, 2)}%: outside ±${fmt(r.tol, 1)}%. Find the cause; if confirmed, recalibrate the chamber (IAEA TRS-492, Sec. 8.5).`)];
  }
  if (sheet === 'cross') {
    const nu = unitLabel(WELL_N_UNITS[r.unit]) ?? '';
    const out = [L(`Калибровочный коэффициент рабочей камеры N = ${fmt(+r.N.toPrecision(6), Math.max(0, 5 - Math.floor(Math.log10(Math.abs(r.N)))))} ${nu}.`, `Field chamber calibration coefficient N = ${fmt(+r.N.toPrecision(6), Math.max(0, 5 - Math.floor(Math.log10(Math.abs(r.N)))))} ${nu}.`)];
    if (r.prev) out.push(L(`Отличие от прежнего коэффициента ${fmtSigned(r.prev.dev, 2)} %.`, `Difference from the previous coefficient ${fmtSigned(r.prev.dev, 2)}%.`));
    return out;
  }
  const out = [L(`Максимум отклика в положении ${fmt(r.xPeak, 1)} мм.`, `Response maximum at ${fmt(r.xPeak, 1)} mm.`)];
  if (Number.isFinite(r.atCert?.shift)) out.push(L(`Сдвиг от опорной точки сертификата ${fmtSigned(r.atCert.shift, 1)} мм.`, `Shift from the certificate reference point ${fmtSigned(r.atCert.shift, 1)} mm.`));
  if (Number.isFinite(r.atMeas?.rel)) out.push(L(`Отклик в положении измерения ${fmt(r.atMeas.x, 1)} мм — ${fmt(r.atMeas.rel * 100, 2)} % от максимума.`, `Response at the measurement position ${fmt(r.atMeas.x, 1)} mm: ${fmt(r.atMeas.rel * 100, 2)}% of the maximum.`));
  return out;
}
function protSign() {
  const staff = String(form.rec_staff ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const line = (role, name) =>
    `<tr><th scope="row">${esc(role)}</th><td class="sig-name">${esc(name) || '&nbsp;'}</td><td class="sig-gap"></td><td class="sig-line">&nbsp;</td></tr>
    <tr class="sig-cap"><th></th><td>${esc(L('должность, ФИО', 'position, name'))}</td><td class="sig-gap"></td><td>${esc(L('подпись', 'signature'))}</td></tr>`;
  const rows = [...(staff.length ? staff : ['']).map((n, k) => line(k === 0 ? L('Измерения провёл', 'Measured by') : '', n)), line(L('Протокол проверил', 'Checked by'), '')];
  return `<table class="kv-prot-sign"><tbody>${rows.join('')}</tbody></table>`;
}
/** Протокол измерения листа (HTML). */
function brachyProtocolHtml() {
  const r = sheetCompute();
  const time = pStr(form[{ well: 'w_time', phantom: 'p_time', stab: 'st_time', cross: 'x_ref_time' }[sheet]]);
  const date = pStr(form[BRACHY_DATE_KEY[sheet]]);
  const head = `<h3 class="br-prot-title">${esc(L('Протокол измерения', 'Measurement report'))}<small>${esc(brachySheetText(sheet))}</small></h3>
    <table class="kv-prot-head"><tbody>
    ${pRow(L('Дата', 'Date'), date ? esc(`${isoDateText(date)}${time ? `, ${time}` : ''}`) : '—')}
    ${pRow(L('Учреждение', 'Institution'), esc(orgText(getJournal())) || '—')}
    ${pRow(L('Аппарат', 'Unit'), protMachine())}
    ${pRow(L('Источник', 'Source'), protSource())}
    ${pRow(L('Средства измерений', 'Measuring equipment'), protDevices() || '—')}
    ${pRow(L('Условия измерений', 'Conditions'), protClimate())}
    ${pRow(L('Методика измерений', 'Method'), protMethod())}
  </tbody></table>`;
  const parts = [head];
  let n = 0;
  const sec = (title, body) => {
    n += 1;
    parts.push(`<h4 class="kv-prot-h">${n}. ${esc(title)}</h4>${body}`);
  };
  sec(L('Результат', 'Result'), protResult(sheet === 'phantom' ? !!r.main : !!r.ok));
  if ((sheet === 'well' || sheet === 'phantom') && Number.isFinite(r.U)) sec(L('Неопределённость', 'Uncertainty'), protUnc());
  const concl = protConclusion(r);
  if (concl.length) parts.push(`<h4 class="kv-prot-h">${esc(L('Заключение', 'Conclusion'))}</h4><p>${concl.map(sub).join('<br>')}</p>`);
  const notes = pStr(form.rec_notes);
  if (notes) parts.push(`<h4 class="kv-prot-h">${esc(L('Примечания', 'Notes'))}</h4><p class="kv-prot-notes">${esc(notes)}</p>`);
  // подписи и версия — одним блоком: при переносе на новый лист он ставится внизу листа (pinSignaturesForPrint)
  parts.push(`<div class="prot-end">${protSign()}<p class="kv-prot-ver">${esc(L(`Расчёт: калькулятор «Клиническая дозиметрия», ${versionText()}, https://mesava.github.io/Reference-dosimetry/`, `Calculation: Clinical Dosimetry calculator, ${versionText()}, https://mesava.github.io/Reference-dosimetry/`))}</p></div>`);
  return parts.join('');
}
function protHtml(n) {
  if (!BRACHY_RECORD_SHEETS.includes(sheet)) return '';
  return `<section class="start-card plates-card br-prot-sec"><h2><span class="step-no">${n}</span> ${esc(L('Протокол измерения', 'Measurement report'))}</h2>
    <div class="actions"><button type="button" data-br="prot-print">${esc(L('Печать протокола', 'Print the report'))}</button><button type="button" data-br="prot-pdf">${esc(L('Сохранить протокол в PDF', 'Save the report as PDF'))}</button></div>
    <details class="br-prot-det"${protOpen ? ' open' : ''}><summary>${esc(L('Показать протокол', 'Show the report'))}</summary><div class="kv-prot br-prot" id="br-prot"></div></details>
    <p class="sub-hint">${esc(L('Протокол — по текущим полям листа; печатается без остального листа. Подписи — из поля «Выполнил(и)». Протокол прежнего измерения: лист «Журнал» → «Открыть», затем «Печать протокола».', 'The report follows the current sheet fields and is printed without the rest of the sheet. Signatures come from the “Performed by” field. For an earlier measurement: the Journal sheet → Open, then Print the report.'))}</p>
  </section>`;
}
function protLive() {
  const box = $('#br-prot');
  if (!box) return;
  box.innerHTML = brachyProtocolHtml();
  box.lang = getLang();
  const chart = box.querySelector('.br-chart');
  if (chart) sweetChart(chart);
}
function printProtocol(pdf) {
  readForm();
  const det = document.querySelector('#brachy-root .br-prot-det');
  if (det) det.open = true;
  protLive();
  document.body.classList.add('print-br-protocol');
  const box = $('#br-prot');
  const unpin = pinSignaturesForPrint(box, box?.querySelector('.prot-end'));
  const off = () => {
    unpin();
    document.body.classList.remove('print-br-protocol');
    window.removeEventListener('afterprint', off);
  };
  window.addEventListener('afterprint', off);
  const date = pStr(form[BRACHY_DATE_KEY[sheet]]);
  if (pdf) printToPdf([L('Протокол', 'Report'), L('брахитерапия', 'brachytherapy'), brachySheetText(sheet), date].filter(Boolean).join('_'), status);
  else window.print();
}

// лист «Журнал»
const machineName = (m) => m?.name || L('афтерлоадер без названия', 'unnamed afterloader');
/** Источник записи коротко: модель и номер. */
function recSource(j, r) {
  const m = j.machines.find((x) => x.id === r.machineId);
  const s = m?.sources?.find((x) => x.id === r.sourceId);
  if (!s) return '';
  return [sourceModelName(s), s.serial ? `№ ${s.serial}` : ''].filter(Boolean).join(', ');
}
const isoDateText = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d ?? ''));
  return m ? L(`${m[3]}.${m[2]}.${m[1]}`, String(d)) : String(d ?? '');
};
const stabMethodText = (k) => Object.fromEntries(ST_METHODS())[k] ?? k;
/** Результат записи для таблицы: текст и отметка. */
function recResult(r) {
  const s = r.summary ?? {};
  if (r.sheet === 'well' || r.sheet === 'phantom') {
    const text = L(`${fmt(s.mGyh, 3)} мГр/ч на 1 м (${fmt(s.U, 0)} U)`, `${fmt(s.mGyh, 3)} mGy/h at 1 m (${fmt(s.U, 0)} U)`) + (s.variantLabel ? ` · ${s.variantLabel}` : '');
    return { text, chip: Number.isFinite(s.dev) ? chipHtml({ dev: s.dev, level: s.level || 'ok' }) : '' };
  }
  if (r.sheet === 'stab') {
    const cls = s.pass ? 'ok' : 'out';
    return { text: `${stabMethodText(s.method)}: ${fmt(s.value, 4)} / ${fmt(s.base, 4)}`, chip: Number.isFinite(s.dev) ? `<span class="chip ${cls}">${esc(fmtSigned(s.dev, 2))} % ${esc(L(`от исходного (±${fmt(s.tol, 1)} %)`, `from the baseline (±${fmt(s.tol, 1)}%)`))}</span>` : '' };
  }
  if (r.sheet === 'cross') {
    const u = unitLabel(WELL_N_UNITS[s.unit]) ?? '';
    return { text: `N = ${Number.isFinite(s.N) ? fmt(+s.N.toPrecision(6), Math.max(0, 5 - Math.floor(Math.log10(Math.abs(s.N))))) : '—'} ${u}`, chip: Number.isFinite(s.dev) ? `<span class="chip ${Math.abs(s.dev) <= 0.5 ? 'ok' : 'out'}">${esc(fmtSigned(s.dev, 2))} % ${esc(L('от прежнего', 'from the previous'))}</span>` : '' };
  }
  if (r.sheet === 'sweet') {
    const p = s.plateau;
    const pl = p && Number.isFinite(p.from) && Number.isFinite(p.to) ? L(`; плато 99 %: ${fmt(p.from, 1)}–${fmt(p.to, 1)} мм`, `; 99% plateau: ${fmt(p.from, 1)}–${fmt(p.to, 1)} mm`) : '';
    return { text: L(`максимум ${fmt(s.xPeak, 1)} мм${pl}`, `maximum ${fmt(s.xPeak, 1)} mm${pl}`), chip: Number.isFinite(s.shift) ? `<span class="chip ${Math.abs(s.shift) <= 1 ? 'ok' : 'out'}">${esc(fmtSigned(s.shift, 1))} ${esc(L('мм от сертификата', 'mm from the certificate'))}</span>` : '' };
  }
  return { text: '', chip: '' };
}
/** Отбор на листе «Журнал»: '' — все, «m:id» — афтерлоадер, «c:id» — камера. */
function logFilterOptions(j) {
  const ms = brachyMachines(j);
  const used = new Set((j.brachyRecords ?? []).flatMap((r) => [r.chamberId, r.refChamberId]).filter(Boolean));
  const chs = j.chambers.filter((c) => used.has(c.id) || isWellModel(c.form?.ch_model));
  return opt('', L('все записи', 'all records'), form.log_f)
    + ms.map((m) => opt(`m:${m.id}`, L(`афтерлоадер: ${machineName(m)}`, `afterloader: ${machineName(m)}`), form.log_f)).join('')
    + chs.map((c) => opt(`c:${c.id}`, L(`камера: ${chamberText(c)}`, `chamber: ${chamberText(c)}`), form.log_f)).join('');
}
function logRecords(j) {
  const [k, id] = String(form.log_f ?? '').split(':');
  return brachyRecordsOf(j, k === 'm' ? { machineId: id } : k === 'c' ? { chamberId: id } : {}).slice().reverse();
}
function logHtml() {
  const j = getJournal();
  const all = j.brachyRecords ?? [];
  const recs = logRecords(j);
  const rows = recs.map((r) => {
    const m = j.machines.find((x) => x.id === r.machineId);
    const c = j.chambers.find((x) => x.id === r.chamberId);
    const ref = j.chambers.find((x) => x.id === r.refChamberId);
    const res = recResult(r);
    const who = [m ? machineName(m) : '', c ? chamberText(c) : '', ref ? L(`эталонная: ${chamberText(ref)}`, `reference: ${chamberText(ref)}`) : ''].filter(Boolean).join('; ');
    return `<tr>
      <td data-cap="${esc(L('Дата', 'Date'))}">${esc(isoDateText(r.date))}</td>
      <td data-cap="${esc(L('Вид', 'Kind'))}">${esc(brachySheetText(r.sheet))}${r.summary?.nuclide ? ` · ${esc(HALF_LIVES[r.summary.nuclide]?.label ?? r.summary.nuclide)}` : ''}</td>
      <td data-cap="${esc(L('Аппарат, камера', 'Afterloader, chamber'))}">${esc(who || '—')}${recSource(j, r) ? `<br><small>${esc(recSource(j, r))}</small>` : ''}</td>
      <td data-cap="${esc(L('Результат', 'Result'))}">${esc(res.text)} ${res.chip}${r.notes ? `<br><small>${esc(r.notes)}</small>` : ''}</td>
      <td data-cap="${esc(L('Выполнил', 'Performed by'))}">${esc((r.staff ?? []).join(', ') || '—')}</td>
      <td class="del"><button type="button" class="link-btn" data-br="open" data-rec="${esc(r.id)}">${esc(L('Открыть на листе', 'Open on the sheet'))}</button> <button type="button" class="link-btn danger" data-br-del="${esc(r.id)}">${esc(L('Удалить', 'Delete'))}</button></td>
    </tr>`;
  }).join('');
  return `<section class="start-card plates-card"><h2><span class="step-no">1</span> ${esc(L('Записи', 'Records'))}</h2>
    ${all.length ? `<div class="grid">${select('log_f', L('Показать', 'Show'), logFilterOptions(j), { span: ' span-2' })}</div>` : ''}
    ${recs.length
      ? `<div class="table-wrap"><table class="factors jf-table br-log-t"><thead><tr><th>${esc(L('Дата', 'Date'))}</th><th>${esc(L('Вид', 'Kind'))}</th><th>${esc(L('Аппарат, камера', 'Afterloader, chamber'))}</th><th>${esc(L('Результат', 'Result'))}</th><th>${esc(L('Выполнил', 'Performed by'))}</th><th class="del"><span class="visually-hidden">${esc(L('Действия', 'Actions'))}</span></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="sub-hint">${esc(all.length ? L('По этому отбору записей нет.', 'No records for this selection.') : L('Записей пока нет: на листах «Колодезная камера», «Фантом PTW 9193», «Стабильность», «Сличение камер» и «Максимум отклика» — кнопка «Записать в журнал».', 'No records yet: the Well-type chamber, PTW 9193 phantom, Stability, Cross-calibration and Sweet spot sheets have the Record to the journal button.'))}</p>`}
  </section>
  ${trendHtml(j, recs)}`;
}

/** Группы для контрольных карт: сила источника — по аппарату и листу, стабильность — по камере и методу. */
function spcGroups(j, recs) {
  const groups = new Map();
  const add = (key, g, r) => {
    if (!groups.has(key)) groups.set(key, { ...g, recs: [] });
    groups.get(key).recs.push(r);
  };
  for (const r of recs) {
    if (!Number.isFinite(r.summary?.dev)) continue;
    if (r.sheet === 'well' || r.sheet === 'phantom') {
      const m = j.machines.find((x) => x.id === r.machineId);
      add(`s|${r.machineId}|${r.sheet}`, { kind: 'src', sheet: r.sheet, title: L(`Сила источника, ${r.sheet === 'well' ? 'колодезная камера' : 'фантом PTW 9193'}: ${machineName(m)}`, `Source strength, ${r.sheet === 'well' ? 'well-type chamber' : 'PTW 9193 phantom'}: ${machineName(m)}`) }, r);
    } else if (r.sheet === 'stab') {
      const c = j.chambers.find((x) => x.id === r.chamberId);
      add(`c|${r.chamberId}|${r.summary.method}`, { kind: 'stab', title: L(`Стабильность: ${chamberText(c) || 'камера'} (${stabMethodText(r.summary.method)})`, `Stability: ${chamberText(c) || 'chamber'} (${stabMethodText(r.summary.method)})`), tol: r.summary.tol || 0.5 }, r);
    }
  }
  return [...groups.values()].map((g) => ({ ...g, recs: g.recs.slice().sort((x, y) => String(x.date).localeCompare(String(y.date))) }));
}
/** Точки карты: новый отсчёт — после замены источника (сила источника) или с новым исходным значением (стабильность). */
function spcPoints(g) {
  return g.recs.map((r, i) => {
    const prev = g.recs[i - 1];
    const restart = !!prev && (g.kind === 'src' ? r.sourceId !== prev.sourceId : r.summary.base !== prev.summary.base);
    return { day: dayNumber(r.date), value: r.summary.dev, date: r.date, ...(restart ? { restart: true, reason: g.kind === 'src' ? 'source' : 'baseline' } : {}) };
  });
}
/** Контрольные карты (с 0.76.0): карта индивидуальных значений I-MR, сигналы 3σ и CUSUM, тренд (core/spc.js). */
function trendHtml(j, recs) {
  const groups = spcGroups(j, recs);
  if (!groups.length) return '';
  return `<section class="start-card plates-card"><h2><span class="step-no">2</span> ${esc(L('Тренды и контрольные карты', 'Trends and control charts'))}</h2>
    ${groups.map((g, i) => {
      const tol = g.kind === 'src' ? CERT_TOLERANCE.hdrInvestigate : g.tol;
      const chart = controlChart(spcPoints(g), { tol });
      const tolText = g.kind === 'src'
        ? L(`допуск: ±${CERT_TOLERANCE.hdrInvestigate} % — выяснить причину, ±${CERT_TOLERANCE.hdrStop} % — не использовать (HDR, TRS-492, разд. 8.6.2)`, `tolerance: ±${CERT_TOLERANCE.hdrInvestigate}%: investigate, ±${CERT_TOLERANCE.hdrStop}%: do not use (HDR, TRS-492, Sec. 8.6.2)`)
        : L(`допуск ±${fmt(tol, 1)} % (TRS-492, разд. 8.5)`, `tolerance ±${fmt(tol, 1)}% (TRS-492, Sec. 8.5)`);
      return `<h3 class="sub-h">${esc(g.title)}</h3>
      <div class="chart" id="br-spc-${i}"></div>
      <div class="chart-legend">${legendHtml([
        [{ cls: 't1' }, g.kind === 'src' ? L('отклонение от сертификата', 'deviation from the certificate') : L('отклонение от исходного', 'deviation from the baseline')],
        [{ cls: 'sig', shape: 'square' }, L('сигнал карты', 'chart signal')],
        [{ line: true, cls: 'cl' }, L('центральная линия', 'centre line')],
        [{ line: true, cls: 'lim2' }, '±2σ'],
        [{ line: true, cls: 'lim3', dashed: true }, '±3σ'],
        [{ line: true, cls: 'aux', dashed: true }, tolText],
      ])}</div>
      <div class="hs-spc-summary"><p>${chart.current ? segmentLine(chart) : ''}</p>${chart.trend || chart.trendWait ? `<p>${trendLine(chart, tol)}</p>` : ''}${signalsHtml(chart, () => '', g.kind === 'src' ? L('Сигналов нет: сила источника меняется в пределах обычного разброса.', 'No signals: the source strength varies within its usual scatter.') : L('Сигналов нет: показание камеры меняется в пределах обычного разброса.', 'No signals: the chamber reading varies within its usual scatter.'))}</div>`;
    }).join('')}
    <p class="sub-hint">${esc(L('Отсчёт карты начинается заново после замены источника (сила источника) и с новым исходным значением камеры (стабильность). Сигнал — повод разобраться, а не выход за допуск: точка за 3σ — скачок, накопленная сумма (CUSUM) — небольшой устойчивый сдвиг. σ = MR̄/1,128 по первым 20 записям отсчёта (Montgomery, Introduction to Statistical Quality Control; Pawlicki и др., Med Phys 32 (2005) 2777).', 'The chart count restarts after a source exchange (source strength) and with a new chamber baseline (stability). A signal is a reason to investigate, not an out-of-tolerance result: a point beyond 3σ is a jump, the cumulative sum (CUSUM) a small sustained shift. σ = MR̄/1.128 from the first 20 records of the count (Montgomery, Introduction to Statistical Quality Control; Pawlicki et al., Med Phys 32 (2005) 2777).'))}</p>
  </section>`;
}
function trendCharts() {
  if (sheet !== 'log') return;
  const j = getJournal();
  spcGroups(j, logRecords(j)).forEach((g, i) => {
    const box = $(`#br-spc-${i}`);
    if (!box) return;
    const tol = g.kind === 'src' ? CERT_TOLERANCE.hdrInvestigate : g.tol;
    const chart = controlChart(spcPoints(g), { tol });
    const days = chart.points.map((p) => p.day);
    const x0 = Math.min(...days) - 400;
    const x1 = Math.max(...days) + 400;
    const stop = CERT_TOLERANCE.hdrStop;
    drawChart(box, chart, {
      tol,
      label: L(`Контрольная карта: ${g.title}`, `Control chart: ${g.title}`),
      yLabel: g.kind === 'src' ? L('Отклонение от сертификата, %', 'Deviation from the certificate, %') : L('Отклонение от исходного, %', 'Deviation from the baseline, %'),
      check: () => false,
      pointTitle: (p) => `${isoDateText(p.date)}: ${fmtSigned(p.value, 2)} %${Number.isFinite(p.z) ? ` (${fmtSigned(p.z, 1)}σ)` : ''}${pointRules(p)}`,
      extraLines: g.kind === 'src' ? [stop, -stop].map((a) => ({ cls: 'aux', a, b: 0, x0, x1, dashed: true })) : [],
      extraNotes: g.kind === 'src' ? [{ x: Math.min(...days), y: stop, text: `+${stop} %`, anchor: 'start' }, { x: Math.min(...days), y: -stop, text: `−${stop} %`, anchor: 'start', below: true }] : [],
      yExtra: g.kind === 'src' ? [-stop, stop] : [],
    });
  });
}

function openRecord(id) {
  const rec = (getJournal().brachyRecords ?? []).find((r) => r.id === id);
  if (!rec) return;
  form = normalizeBrachy(formFromRecord(form, rec));
  form.rec_staff = (rec.staff ?? []).join(', ');
  form.rec_notes = rec.notes ?? '';
  sheet = rec.sheet;
  persist();
  location.hash = `#brachy/${rec.sheet}`;
  render();
  status(L(`Открыта запись журнала: ${brachySheetText(rec.sheet)}, ${isoDateText(rec.date)}. Поля листа заменены данными записи.`, `Journal record opened: ${brachySheetText(rec.sheet)}, ${isoDateText(rec.date)}. The sheet fields are replaced with the record data.`));
}

// ------------------------------------------------------------ разметка
function navHtml() {
  const items = [['well', L('Колодезная камера', 'Well-type chamber')], ['sweet', L('Максимум отклика', 'Sweet spot')], ['phantom', L('Фантом PTW 9193', 'PTW 9193 phantom')], ['cross', L('Сличение камер', 'Cross-calibration')], ['stab', L('Стабильность', 'Stability')], ['decay', L('Распад', 'Decay')], ['tg43', L('Доза TG-43', 'TG-43 dose')], ['log', L('Журнал', 'Journal')]];
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
  if (sheet === 'log') {
    return `<p class="start-when">${sub(L(
      'Записи брахитерапии в журнале отделения: сила источника по колодезной камере и в фантоме (с отклонением от сертификата; HDR — выяснить причину при расхождении больше 3 %, не использовать при больше 5 %, IAEA TRS-492, разд. 8.6.2), проверки стабильности камеры (±0,5 %, разд. 8.5), сличения камер и максимум отклика. Запись открывается на своём листе.',
      'Brachytherapy records in the department journal: source strength with the well-type chamber and in the phantom (with the deviation from the certificate; HDR: investigate above 3%, do not use above 5%, IAEA TRS-492, Sec. 8.6.2), chamber stability checks (±0.5%, Sec. 8.5), cross-calibrations and the sweet spot. A record opens on its own sheet.',
    ))}</p>`;
  }
  if (sheet === 'tg43') {
    return `<p class="start-when">${sub(L(
      'Справочно: мощность поглощённой дозы в воде в точках вокруг источника по формализму линейного источника TG-43U1: Ḋ(r,θ) = S_K · Λ · G_L(r,θ)/G_L(1 см, 90°) · g_L(r) · F(r,θ) (Rivard 2004, ур. 1, 4). Λ и g_L(r) — консенсус HEBD (AAPM/ESTRO, 2012); на поперечной оси F = 1. Удобно для проверки значений системы планирования.',
      'For reference: absorbed dose rate to water at points around the source per the TG-43U1 line-source formalism: Ḋ(r,θ) = S_K · Λ · G_L(r,θ)/G_L(1 cm, 90°) · g_L(r) · F(r,θ) (Rivard 2004, Eq. 1, 4). Λ and g_L(r) are HEBD consensus data (AAPM/ESTRO, 2012); F = 1 on the transverse axis. Useful for checking treatment planning system values.',
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
    ${anyEquipment() ? '' : `<p class="sub-hint">${esc(EQ_HINT())} <a href="#equipment">${esc(L('Открыть «Оборудование»', 'Open Equipment'))}</a></p>`}
    <div class="grid">
      ${journalSourceHtml()}
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
      ${journalWellHtml()}
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
      ${journalPhantomHtml()}
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
      ${journalMachineHtml()}
      ${journalWellHtml()}
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

function sweetChart(box = $('#br-sweet-chart')) {
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
      ${journalCrossHtml(pre)}
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
      ${journalWellHtml(false)}
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

// ------------------------------------------------------------ лист «Доза TG-43»
function tg43ParamsHtml() {
  const srcs = DOSE_SOURCES.filter((x) => x.nuclide === form.nuclide && x.lambda);
  const options = [opt('', L('не выбрана', 'not chosen'), form.t_src), ...srcs.map((x) => opt(x.id, x.name, form.t_src)), opt('other', L('другая — ввести Λ, L', 'other: enter Λ, L'), form.t_src)].join('');
  const bases = [['cert', L('по сертификату на дату расчёта', 'from the certificate at the calculation date')], ['well', L('по листу «Колодезная камера»', 'from the Well-type chamber sheet')], ['phantom', L('по листу «Фантом PTW 9193»', 'from the PTW 9193 phantom sheet')], ['manual', L('своя S_K', 'own S_K')]];
  return `<section class="start-card plates-card"><h2><span class="step-no">2</span> ${esc(L('Модель источника и сила', 'Source model and strength'))}</h2>
    <div class="grid">
      ${select('t_src', L('Модель источника (HEBD)', 'Source model (HEBD)'), options, { span: ' span-2' })}
      ${form.t_src === 'other' ? `${num('t_lambda', L('Λ, сГр·ч⁻¹·Ед⁻¹', 'Λ, cGy·h⁻¹·U⁻¹'))}${num('t_L', L('Активная длина L, см (пусто — точечный)', 'Active length L, cm (blank: point source)'))}` : ''}
      ${select('t_basis', L('Сила источника', 'Source strength'), bases.map(([k, t]) => opt(k, t, form.t_basis)).join(''), { span: ' span-2' })}
      ${form.t_basis === 'manual' ? num('t_SK', L('S_K, Ед', 'S_K, U')) : ''}
      ${when('t_', L('Дата расчёта (пусто — сейчас)', 'Calculation date (blank: now)'), L('Время расчёта', 'Calculation time'))}
      ${num('t_th', L('Угол θ к оси источника, °', 'Angle θ to the source axis, °'))}
    </div></section>`;
}

function tg43RowsHtml() {
  const n = Math.max(form.t_r.length, 3);
  const rows = Array.from({ length: n }, (_, i) => `<div class="pair-row br-tg-row"><span class="pair-no">${i + 1}</span>
      <input type="text" class="num" inputmode="decimal" id="br_t_r_${i}" data-tr="${i}" aria-label="${esc(L(`Расстояние ${i + 1}, см`, `Distance ${i + 1}, cm`))}" value="${esc(form.t_r[i] ?? '')}">
      <input type="text" class="num" inputmode="decimal" id="br_t_g_${i}" data-tg="${i}" aria-label="${esc(L(`Своя g_L, строка ${i + 1}`, `Own g_L, row ${i + 1}`))}" placeholder="${esc(L('HEBD', 'HEBD'))}" value="${esc(form.t_g[i] ?? '')}">
      <input type="text" class="num" inputmode="decimal" id="br_t_F_${i}" data-tf="${i}" aria-label="${esc(L(`Своя F, строка ${i + 1}`, `Own F, row ${i + 1}`))}" placeholder="${esc(Math.abs(parseNumber(form.t_th) - 90) < 1e-9 || !form.t_th ? '1' : '')}" value="${esc(form.t_F[i] ?? '')}"></div>`).join('');
  return `<section class="start-card plates-card"><h2><span class="step-no">3</span> ${esc(L('Точки', 'Points'))}</h2>
    <div class="pairs br-tg">
      <div class="pairs-head"><span class="pair-no">№</span><span>${esc(L('r, см', 'r, cm'))}</span><span${tipAttr('t_g', { focus: true })}>${sub(L('Своя g_L(r)', 'Own g_L(r)'))}</span><span${tipAttr('t_F', { focus: true })}>${sub(L('Своя F(r,θ)', 'Own F(r,θ)'))}</span></div>
      <div class="pairs-list">${rows}</div>
      <div class="cells-tools">
        <button type="button" class="icon-btn" data-br="t-add" aria-label="${esc(L('Добавить точку', 'Add a point'))}" title="${esc(L('Добавить точку', 'Add a point'))}">+</button>
        <button type="button" class="icon-btn" data-br="t-del" aria-label="${esc(L('Убрать последнюю точку', 'Remove the last point'))}" title="${esc(L('Убрать последнюю точку', 'Remove the last point'))}"${n <= 1 ? ' disabled' : ''}>−</button>
      </div>
    </div></section>`;
}

function tg43Result() {
  const o = { offsetMin: offsetMin() };
  const r = computeBrachyTg43(form, { ...o, now: Date.now(), well: computeBrachyWell(form, o), phantom: computeBrachyPhantom(form, o) });
  if (!r.ok) return msgHtml(r.messages);
  const s = r.source;
  const cell = (x, n) => `<td class="v">${Number.isFinite(x) ? esc(fmt(x, n)) : '—'}</td>`;
  const rows = r.rows
    .map((x) => `<tr><td class="v">${esc(fmt(x.r, 2))}</td>${cell(x.G, 5)}<td class="v">${Number.isFinite(x.g) ? esc(fmt(x.g, 3)) + (x.gOwn ? '*' : '') : '—'}</td><td class="v">${Number.isFinite(x.F) ? esc(fmt(x.F, 3)) + (x.FOwn ? '*' : '') : '—'}</td>${cell(x.value / 100, 4)}${cell((x.value * 10) / 60, 3)}</tr>`)
    .join('');
  const table = `<div class="table-wrap"><table class="factors br-variants"><thead><tr><th class="v">${esc(L('r, см', 'r, cm'))}</th><th class="v"${tipAttr('t_G', { focus: true })}>${sub('G_L/G_L(1)')}</th><th class="v"${tipAttr('t_g', { focus: true })}>${sub('g_L(r)')}</th><th class="v"${tipAttr('t_F', { focus: true })}>${sub('F(r,θ)')}</th><th class="v">${esc(L('Ḋ, Гр/ч', 'Ḋ, Gy/h'))}</th><th class="v">${esc(L('Ḋ, мГр/мин', 'Ḋ, mGy/min'))}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const atText = r.tNow ? L(`сейчас (${dateText(r.t, form.t_zone)})`, `now (${dateText(r.t, form.t_zone)})`) : dateText(r.t, form.t_zone);
  return `<div class="plates-dose"><span${tipAttr('Dw1', { focus: true })}>${sub(L('Ḋ_w,1 = Λ · S_K (1 см, 90°)', 'Ḋ_w,1 = Λ · S_K (1 cm, 90°)'))}</span><b>${esc(fmt(r.dw1 / 100, 4))} ${esc(L('Гр/ч', 'Gy/h'))}</b></div>
    <p class="sub-hint">${sub(L(`${s.name}: Λ = ${fmt(s.lambda, 3)} сГр·ч⁻¹·Ед⁻¹, L = ${fmt(s.L, 2)} см; S_K = ${fmt(r.SK, 0)} Ед (${r.base.label}) на ${atText}; θ = ${fmt(r.theta, 0)}°.`, `${s.name}: Λ = ${fmt(s.lambda, 3)} cGy·h⁻¹·U⁻¹, L = ${fmt(s.L, 2)} cm; S_K = ${fmt(r.SK, 0)} U (${r.base.label}) at ${atText}; θ = ${fmt(r.theta, 0)}°.`))}${s.ref ? ` <span class="ref">(${esc(refText(s.ref))})</span>` : ''}</p>
    ${table}${r.rows.some((x) => x.gOwn || x.FOwn) ? `<p class="sub-hint">${esc(L('* — своё значение.', '* own value.'))}</p>` : ''}${msgHtml(r.messages)}`;
}

function resultCardHtml(n) {
  return `<section class="start-card plates-card"><h2><span class="step-no">${n}</span> ${esc(L('Результат', 'Result'))}</h2><div id="br-result" aria-live="polite"></div></section>`;
}

function sheetBody() {
  if (sheet === 'log') return logHtml();
  if (sheet === 'sweet') return `${sweetSetupHtml()}${sweetRowsHtml()}${resultCardHtml(3)}${recordHtml(4)}${protHtml(5)}`;
  if (sheet === 'decay') return `${sourceHtml()}${decayParamsHtml()}${resultCardHtml(3)}`;
  if (sheet === 'cross') return `${crossSetupHtml()}${crossChamberHtml(2, 'x_ref_', L('Эталонная камера', 'Reference chamber'))}${crossChamberHtml(3, 'x_fld_', L('Рабочая камера', 'Field chamber'))}${resultCardHtml(4)}${recordHtml(5)}${protHtml(6)}`;
  if (sheet === 'stab') return `${stabSetupHtml()}${stabMeasureHtml()}${resultCardHtml(3)}${recordHtml(4)}${protHtml(5)}`;
  if (sheet === 'tg43') return `${sourceHtml()}${tg43ParamsHtml()}${tg43RowsHtml()}${resultCardHtml(4)}`;
  if (sheet === 'well') return `${sourceHtml()}${wellChamberHtml()}${wellMeasureHtml()}${resultCardHtml(4)}${uncHtml(5)}${recordHtml(6)}${protHtml(7)}`;
  return `${sourceHtml()}${phantomChamberHtml()}${phantomMeasureHtml()}${resultCardHtml(4)}${doseHtml()}${ownKtotHtml()}${uncHtml(7)}${recordHtml(8)}${protHtml(9)}`;
}

function render() {
  const root = $('#brachy-root');
  if (!root) return;
  root.innerHTML = `${navHtml()}
    <div class="plates-banner"><b>${esc(L('Раздел в разработке', 'Section in development'))}</b>: ${esc(L('расчёт, записи в журнал, протокол и пример работают; раздел проверяется на протоколах отделения. Черновик формы хранится в этом браузере.', 'the calculation, journal records, the report and the example work; the section is being checked against the department protocols. The form draft is kept in this browser.'))}</div>
    ${isBrachySample(form) && sheet !== 'log' ? `<p class="demo-flag">${esc(L('Сейчас загружен демонстрационный пример: значения вымышленные. Выбор из «Оборудования» в примере не задан.', 'The demo example is loaded: the values are fictitious. No Equipment selection is set in the example.'))}</p>` : ''}
    ${introHtml()}
    ${sheetBody()}
    ${sheet === 'log' ? '' : `<div class="actions">${['decay', 'tg43'].includes(sheet) ? '' : `<button type="button" data-br="clear">${esc(L('Очистить измерение', 'Clear the measurement'))}</button>`}<button type="button" data-br="sample">${esc(L('Загрузить пример', 'Load the example'))}</button></div>`}`;
  for (const el of root.querySelectorAll('.cells[data-series]')) {
    const key = el.dataset.series;
    const m = key.match(/^p_hole(\d)$/);
    renderCells(el, m ? form.p_holes[+m[1]].M : form[key]);
    setupCells(el, onInput);
  }
  for (const del of root.querySelectorAll('[data-br-del]')) {
    armButton(del, del.textContent, () => L('Удалить запись?', 'Delete the record?'), () => {
      updateJournal((j) => removeBrachyRecord(j, del.dataset.brDel), 'brachy');
      render();
      status(L('Запись удалена. Сохраните журнал в файл, если автосохранение не включено.', 'The record has been deleted. Save the journal file if autosave is off.'));
    });
  }
  trendCharts();
  root.querySelector('.br-prot-det')?.addEventListener('toggle', (e) => {
    protOpen = e.target.open;
  });
  const sample = root.querySelector('[data-br="sample"]');
  if (sample) {
    armButton(sample, sample.textContent, () => L('Заменить поля всех листов примером?', 'Replace the fields of all sheets with the example?'), () => {
      form = normalizeBrachy({ ...sampleBrachy(), rec_staff: form.rec_staff, log_f: form.log_f });
      persist();
      render();
      status(L('Загружен демонстрационный пример (вымышленные данные): источник ¹⁹²Ir HDR, все листы заполнены одним днём измерений 15.09.2026.', 'The demo example is loaded (fictitious data): an HDR ¹⁹²Ir source, all sheets filled with one measurement day, 2026-09-15.'));
    });
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
  const results = { well: wellResult, sweet: sweetResult, decay: decayResult, cross: crossResult, stab: stabResult, phantom: phantomResult, tg43: tg43Result };
  box.innerHTML = results[sheet]();
  if (sheet === 'sweet') sweetChart();
  uncLive();
  protLive();
}

// ------------------------------------------------------------ ввод
function readForm() {
  const root = $('#brachy-root');
  if (!root) return;
  for (const el of root.querySelectorAll('[data-f]')) form[el.dataset.f] = el.value;
  for (const el of root.querySelectorAll('[data-hole]')) form.p_holes[+el.dataset.hole][el.dataset.hf] = el.value;
  for (const el of root.querySelectorAll('[data-sx]')) form.s_x[+el.dataset.sx] = el.value;
  for (const el of root.querySelectorAll('[data-sm]')) form.s_M[+el.dataset.sm] = el.value;
  for (const el of root.querySelectorAll('[data-tr]')) form.t_r[+el.dataset.tr] = el.value;
  for (const el of root.querySelectorAll('[data-tg]')) form.t_g[+el.dataset.tg] = el.value;
  for (const el of root.querySelectorAll('[data-tf]')) form.t_F[+el.dataset.tf] = el.value;
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

/** Выбор из «Оборудования»: подставить данные при смене поля id; true — подставлено, нужна перерисовка. */
function applyJournalPick(id) {
  if (id === 'br_j_machine' || id === 'br_j_source' || (MEAS_DATE_IDS.includes(id) && form.j_machine && !form.j_source)) {
    // другой аппарат — источник по дате измерения; другая дата — источник «по дате» другой
    if (id === 'br_j_machine') form.j_source = '';
    applySource();
    if (form.j_well) applyWell();
    return true;
  }
  if (id === 'br_j_well' || id === 'br_j_row') {
    if (id === 'br_j_well') form.j_row = '';
    applyWell();
    return true;
  }
  if (id === 'br_nuclide' && (form.j_well || form.j_ref || form.j_fld)) {
    if (form.j_well) applyWell();
    if (form.j_ref || form.j_fld) applyCross();
    return true;
  }
  if (id === 'br_j_phantom') {
    applyPhantom();
    return true;
  }
  if (['br_j_ref', 'br_j_ref_row', 'br_j_fld', 'br_j_fld_row'].includes(id)) {
    if (id === 'br_j_ref') form.j_ref_row = '';
    if (id === 'br_j_fld') form.j_fld_row = '';
    applyCross();
    return true;
  }
  return false;
}

function onChange(e) {
  const t = e.target;
  if (t.name === 'br_main') return;
  if (/^br_j_|^br_nuclide$/.test(t.id) || MEAS_DATE_IDS.includes(t.id)) {
    readForm();
    if (applyJournalPick(t.id)) {
      persist();
      render();
      document.getElementById(t.id)?.focus({ preventScroll: true });
      return;
    }
  }
  if (t.dataset.full !== undefined || t.id === 'br_w_unit' || t.id === 'br_s_unit' || t.id === 'br_x_unit' || t.id === 'br_st_unit' || t.id === 'br_t_th') {
    readForm();
    persist();
    render();
  }
}

function onClick(e) {
  const b = e.target.closest('button[data-br]');
  if (!b) return;
  if (b.dataset.br === 'record') {
    doRecord();
    return;
  }
  if (b.dataset.br === 'prot-print' || b.dataset.br === 'prot-pdf') {
    printProtocol(b.dataset.br === 'prot-pdf');
    return;
  }
  if (b.dataset.br === 'open') {
    openRecord(b.dataset.rec);
    return;
  }
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
  } else if (b.dataset.br === 't-add') {
    readForm();
    form.t_r.push('');
    form.t_g.push('');
    form.t_F.push('');
    persist();
    render();
    $(`#br_t_r_${form.t_r.length - 1}`)?.focus();
    return;
  } else if (b.dataset.br === 't-del') {
    readForm();
    if (form.t_r.length > 1) {
      form.t_r.pop();
      form.t_g.length = Math.min(form.t_g.length, form.t_r.length);
      form.t_F.length = Math.min(form.t_F.length, form.t_r.length);
    }
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
  // «Оборудование» изменилось (открыт другой журнал, добавлен источник): списки выбора — заново
  onJournal(({ source } = {}) => {
    // свои записи перерисовывает сам лист; при вводе на листе — не мешать (фокус)
    if (source === 'brachy' || $('#module-brachy')?.hidden || $('#brachy-root')?.contains(document.activeElement)) return;
    render();
  });
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
