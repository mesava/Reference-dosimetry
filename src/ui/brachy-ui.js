// Вкладка «Брахитерапия»: листы «Колодезная камера» (IAEA TRS-492), «Максимум отклика» (TRS-492, разд. 8.2.1),
// «Фантом PTW 9193» (DIN 6809-2, DGMP-Bericht 13, руководство PTW), «Сличение камер» (TRS-492, разд. 7.7), «Стабильность»
// (разд. 8.4–8.5), «Распад» (TRS-492, разд. 3.4, 7.3) и «Доза TG-43». Сертификат источника — общий для листов.
// Расчёт — core/brachy-sheets.js; черновик формы — в этом браузере. Раскладка (с 0.79.0) — как у других вкладок: разделы
// листа слева (section-nav.js), табло, замечания и данные справа.
import { L, refText, getLang } from '../core/i18n.js';
import { PRESSURE_UNITS, unitLabel, parseNumber } from '../core/units.js';
import { HALF_LIVES, KSM_SOURCES, PTW_TO_DGMP, APPLICATOR_KA_STEEL } from '../core/brachy-data.js';
import { kDec } from '../core/brachy.js';
import {
  BRACHY_DEFAULTS, normalizeBrachy, computeBrachyWell, isDwUnit, computeBrachyPhantom, computeBrachySweet, computeBrachyDecay, computeBrachyCross, computeBrachyStability, computeBrachyTg43, fieldTime,
  STRENGTH_UNITS, ACTIVITY_UNITS, GAMMA_UNITS, WELL_N_UNITS, PHANTOM_N_UNITS, CURRENT_UNITS, DOSE_SOURCES,
} from '../core/brachy-sheets.js';
import { $, esc, fmt, fmtSigned, richText, armButton, downloadText, savedFileName, printToPdf, versionText, pinSignaturesForPrint, notifyUpdate } from './common.js';
import { scatterChart, legendSwatch } from './chart.js';
import { renderCells, readCells, setupCells } from './widgets.js';
import { cellsHtml, fmtDate } from './journal-common.js';
import { tipAttr } from './brachy-tips.js';
import { wellBudget, phantomBudget, certAgreement } from '../core/brachy-unc.js';
import { parseOverrides } from '../core/uncertainty.js';
import { brachyMachines, sourceOn, sourceText, sourceToForm, certRowsFor, wellChamberToForm, phantomChamberToForm, isWellModel, wellChamberLabel } from '../core/brachy-journal.js';
import { chamberText, chamberUse, cobaltCapable, activeOnly, orgText } from '../core/journal.js';
import { getJournal, onJournal, updateJournal } from './journal-store.js';
import { machineName, isoDateText, chipHtml, ST_METHODS, stabMethodText } from './brachy-log-ui.js';
import { sampleBrachy, isBrachySample } from '../core/sample-brachy.js';
import { BRACHY_RECORD_SHEETS, BRACHY_DATE_KEY, brachySheetText, recordBrachy, formFromRecord, redundantRunningMean } from '../core/brachy-records.js';

const KEY = 'reference-dosimetry.brachy';
// порядок листов — по ходу работы (решение Alex 25.11.2026): распад → стабильность → сличение → максимум отклика → колодезная → фантом → TG-43
const SHEETS = ['decay', 'stab', 'cross', 'sweet', 'well', 'phantom', 'tg43'];
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
  const items = [opt('', L(`местное, ${here}`, `local, ${here}`), cur), opt('UTC', 'UTC', cur)];
  for (let h = -12; h <= 14; h++) if (h) items.push(opt(`${h > 0 ? '+' : ''}${h}`, `UTC${h > 0 ? '+' : '−'}${Math.abs(h)}`, cur));
  items.push(opt('+5:30', 'UTC+5:30', cur));
  return items.join('');
}
/** Дата, время и часовой пояс (prefix: cert_, w_, p_). */
const when = (pre, label, timeHint) => `<div class="field"><label for="br_${pre}date"${tipAttr(`${pre}date`)}>${esc(label)}</label><input type="date" id="br_${pre}date" data-f="${pre}date" value="${esc(form[`${pre}date`])}"></div>
  <div class="field"><label for="br_${pre}time">${esc(L('Время', 'Time'))}</label><input type="time" id="br_${pre}time" data-f="${pre}time" value="${esc(form[`${pre}time`])}" title="${esc(timeHint)}"></div>
  <div class="field"><label for="br_${pre}zone">${esc(L('Часовой пояс', 'Time zone'))}</label><select id="br_${pre}zone" data-f="${pre}zone" title="${esc(L('«Местное» — часовой пояс этого компьютера', '“Local”: the time zone of this computer'))}">${zoneOpts(form[`${pre}zone`])}</select></div>`;

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

// ------------------------------------------------------------ запись в журнал (с 0.76.0)
// Измерения листов «Колодезная камера», «Фантом PTW 9193», «Стабильность», «Сличение камер», «Максимум отклика»
// записываются в журнал отделения (j.brachyRecords, core/brachy-records.js). Список записей и контрольные карты — в
// «Журнале и трендах» (brachy-log-ui.js, с 0.79.0; раньше — отдельный лист «Журнал» вкладки).
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
  return `<a href="#history" data-goto="brachy/log">${esc(L(`Журнал и тренды (записей брахитерапии: ${n})`, `Journal and trends (brachytherapy records: ${n})`))}</a>`;
};
function recordHtml(n) {
  if (!BRACHY_RECORD_SHEETS.includes(sheet)) return '';
  const by = ['well', 'phantom', 'sweet'].includes(sheet) ? L('по афтерлоадеру', 'by afterloader') : L('по камере', 'by chamber');
  return `<section class="step" data-optional><header><span class="step-no">${n}</span><h2>${esc(L('Запись в журнал', 'Journal record'))}</h2></header>
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
    : L(`Записано в журнал: ${what}, ${isoDateText(res.record.date)}. Записи и тренды — в «Журнале и трендах»; сохраните журнал в файл, если автосохранение не включено.`, `Recorded to the journal: ${what}, ${isoDateText(res.record.date)}. The records and trends are in Journal and trends; save the journal file if autosave is off.`));
}

// ------------------------------------------------------------ протокол измерения (с 0.77.0)
// Протокол листа, измерение которого записывается в журнал: шапка (дата, учреждение, аппарат, источник, средства и
// условия измерений, методика), результат (те же числа, что на листе, без кнопок), неопределённость (колодезная камера,
// фантом), заключение, примечание и подписи. Печатается отдельно от листа (body.print-br-protocol, styles.css); PDF —
// то же окно печати. Протокол записи журнала — «Открыть на листе» в «Журнале и трендах», затем «Печать протокола».
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
    if (r.compare) {
      out.push(r.compare.text + (r.compare.ref ? ` (${refText(r.compare.ref)})` : ''));
      const { b } = budgetFor();
      const a = certAgreement({ dev: r.compare.dev, Umeas: b.U, Ucert: parseNumber(form.cert_U), kCert: parseNumber(form.cert_k) });
      if (a.ok) out.push(a.pass
        ? L(`Сертификат и измерение согласуются в пределах расширенных неопределённостей (±${fmt(a.limit, 1)} %, k = 2; IAEA TRS-492, разд. 8.6.2.1).`, `The certificate and the measurement agree within their expanded uncertainties (±${fmt(a.limit, 1)}%, k = 2; IAEA TRS-492, Sec. 8.6.2.1).`)
        : L(`Сертификат и измерение не согласуются в пределах расширенных неопределённостей (±${fmt(a.limit, 1)} %, k = 2): выяснить причину (IAEA TRS-492, разд. 8.6.2.1).`, `The certificate and the measurement do not agree within their expanded uncertainties (±${fmt(a.limit, 1)}%, k = 2): investigate (IAEA TRS-492, Sec. 8.6.2.1).`));
    } else out.push(L('Сравнение с сертификатом источника не выполнено: нет данных сертификата или даты.', 'No comparison with the source certificate: the certificate data or the date are missing.'));
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
  return `<section class="step br-prot-sec"><header><span class="step-no">${n}</span><h2>${esc(L('Протокол измерения', 'Measurement report'))}</h2></header>
    <div class="actions"><button type="button" data-br="prot-print">${esc(L('Печать протокола', 'Print the report'))}</button><button type="button" data-br="prot-pdf">${esc(L('Сохранить протокол в PDF', 'Save the report as PDF'))}</button></div>
    <details class="br-prot-det"${protOpen ? ' open' : ''}><summary>${esc(L('Показать протокол', 'Show the report'))}</summary><div class="kv-prot br-prot" id="br-prot"></div></details>
    <p class="sub-hint">${esc(L('Протокол — по текущим полям листа; печатается без остального листа. Подписи — из поля «Выполнил(и)». Протокол прежнего измерения: «Журнал и тренды» → «Открыть на листе», затем «Печать протокола».', 'The report follows the current sheet fields and is printed without the rest of the sheet. Signatures come from the “Performed by” field. For an earlier measurement: Journal and trends → Open on the sheet, then Print the report.'))}</p>
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

/** Открыть запись журнала на её листе (из «Журнала и трендов»): поля листа — из записи. Возвращает лист или ''. */
export function openBrachyRecord(id) {
  const rec = (getJournal().brachyRecords ?? []).find((r) => r.id === id);
  if (!rec || !SHEETS.includes(rec.sheet)) return '';
  form = normalizeBrachy(formFromRecord(form, rec));
  form.rec_staff = (rec.staff ?? []).join(', ');
  form.rec_notes = rec.notes ?? '';
  sheet = rec.sheet;
  persist();
  status(L(`Открыта запись журнала: ${brachySheetText(rec.sheet)}, ${isoDateText(rec.date)}. Поля листа заменены данными записи.`, `Journal record opened: ${brachySheetText(rec.sheet)}, ${isoDateText(rec.date)}. The sheet fields are replaced with the record data.`));
  return rec.sheet;
}

// ------------------------------------------------------------ разметка
function navHtml() {
  const items = [['decay', L('Распад', 'Decay')], ['stab', L('Стабильность', 'Stability')], ['cross', L('Сличение камер', 'Cross-calibration')], ['sweet', L('Максимум отклика', 'Sweet spot')], ['well', L('Колодезная камера', 'Well-type chamber')], ['phantom', L('Фантом PTW 9193', 'PTW 9193 phantom')], ['tg43', L('Доза TG-43', 'TG-43 dose')]];
  return `<nav class="kv-pages" aria-label="${esc(L('Листы вкладки', 'Tab sheets'))}">${items.map(([k, t]) => `<a href="#brachy/${k}" data-goto="brachy/${k}"${k === sheet ? ' aria-current="page"' : ''}${tipAttr(`tab_${k}`)}>${esc(t)}</a>`).join('')}</nav>`;
}

/** «Сличение камер»: что это, когда и как делается по TRS-492, разд. 7.7 (по просьбе Alex 25.11.2026). */
function crossHowtoHtml() {
  const li = (xs) => xs.map((x) => `<li>${sub(x)}</li>`).join('');
  return `<details class="howto" data-howto="br-cross" open><summary>${esc(L('Что это и как делается по TRS-492', 'What it is and how it is done per TRS-492'))}</summary><div class="howto-body">
    <h3>${esc(L('Что это', 'What it is'))}</h3>
    <p>${sub(L('Прослеживаемость к национальному эталону даёт калибровка камеры в лаборатории. Если в лабораторию отправляют только одну колодезную камеру — эталонную, — коэффициент рабочей камеры, которой мерят повседневно, получают в клинике сличением с эталонной: обе камеры мерят один и тот же источник (IAEA TRS-492, разд. 7.7). Так рабочая камера тоже получает прослеживаемый коэффициент.', 'Traceability to the national standard comes from a laboratory calibration. If only one well-type chamber, the reference one, is sent to the laboratory, the coefficient of the field chamber used day to day is obtained in the clinic by cross-calibration against the reference chamber: both measure the same source (IAEA TRS-492, Sec. 7.7). The field chamber thus also gets a traceable coefficient.'))}</p>
    <h3>${esc(L('Когда нужно', 'When it is needed'))}</h3>
    <ul>${li([
      L('Только если в отделении две колодезные камеры: эталонная с сертификатом лаборатории и рабочая. Если камера одна и калибруется в лаборатории сама — сличение не нужно.', 'Only if the department has two well-type chambers: a reference one with a laboratory certificate and a field one. With one chamber calibrated at the laboratory itself, no cross-calibration is needed.'),
      L('Практически — после каждой калибровки эталонной камеры, при вводе новой рабочей камеры (или нового держателя) и если проверка стабильности рабочей камеры вышла за допуск. Частоту TRS-492 не задаёт.', 'In practice: after each calibration of the reference chamber, for a new field chamber (or a new holder), and if the stability check of the field chamber is out of tolerance. TRS-492 does not set a frequency.'),
    ])}</ul>
    <h3>${esc(L('Как делается', 'How it is done'))}</h3>
    <ol>${li([
      L('Источник — того же нуклида, что при калибровке эталонной камеры (¹⁹²Ir или ⁶⁰Co); пересчёт между нуклидами, интерполяция и расчётные поправки не допускаются. Если модель источника та же, что при калибровке, — k_sm,sm0 = 1, иначе N_ref умножают на поправку на модель источника.', 'A source of the same nuclide as at the reference calibration (¹⁹²Ir or ⁶⁰Co); conversion between nuclides, interpolation and calculated corrections are not permitted. With the same source model as at calibration, k_sm,sm0 = 1; otherwise N_ref is multiplied by the source model correction.'),
      L('Эталонная камера — в том держателе, в котором её калибровали; рабочая — в своём (или в том же). Источник — в том же положении, что при калибровке, обычно в максимуме отклика (лист «Максимум отклика»).', 'The reference chamber in the holder it was calibrated with; the field chamber in its own holder (or the same). The source at the same dwell position as at calibration, usually at the sweet spot (Sweet spot sheet).'),
      L('Камеры и электрометры прогреть; у каждой камеры — своя температура и давление. Показания (ток или заряд за фиксированное время) после стабилизации, с поправками на T, P, утечку, полярность и рекомбинацию: M_ref в эталонной камере, затем M_field в рабочей.', 'Warm up the chambers and electrometers; each chamber has its own temperature and pressure. Readings (current or charge over a fixed time) after stabilization, corrected for T, P, leakage, polarity and recombination: M_ref in the reference chamber, then M_field in the field chamber.'),
      L('Оба показания приводят к одному моменту t_ref поправкой на распад. Если один источник мерят в обеих камерах подряд, в одно время, распад и k_TP сокращаются.', 'Both readings are referred to the same time t_ref with the decay correction. If one source is measured in both chambers one after another at the same time, decay and k_TP cancel.'),
    ])}</ol>
    <h3>${esc(L('Как считается', 'How it is calculated'))}</h3>
    <p>${sub(L('N_field = M_ref(t_ref)/M_field(t_ref) · N_ref · k_sm,sm0 — для ОМВК (ур. 18), S_K (ур. 19) и мощности дозы в воде (ур. 20). N_field действителен в тех же опорных условиях, что при сличении (держатель, положение источника), — его вносят в сертификат рабочей камеры в «Оборудовании» и применяют на листе «Колодезная камера».', 'N_field = M_ref(t_ref)/M_field(t_ref) · N_ref · k_sm,sm0, for the RAKR (Eq. 18), S_K (Eq. 19) and the dose rate to water (Eq. 20). N_field holds under the same reference conditions as in the cross-calibration (holder, source position); it goes into the field chamber certificate in Equipment and is used on the Well-type chamber sheet.'))}</p>
    <h3>${esc(L('Отличие от «Перекрёстной калибровки» в «Инструментах»', 'Difference from Cross-calibration in Tools'))}</h3>
    <p>${sub(L('Идея та же — коэффициент рабочей камеры по эталонной, — но там цилиндрические камеры в пучке ⁶⁰Co или МВ на опорной глубине в воде и N_D,w в Гр/Кл (TRS-398 Rev.1), а здесь колодезные камеры с самим источником брахитерапии и N в Гр·м²·ч⁻¹·А⁻¹ (TRS-492). Одно вместо другого использовать нельзя.', 'The idea is the same, the field chamber coefficient from the reference one, but there it is cylindrical chambers in a ⁶⁰Co or MV beam at the reference depth in water with N_D,w in Gy/C (TRS-398 Rev.1), and here well-type chambers with the brachytherapy source itself and N in Gy·m²·h⁻¹·A⁻¹ (TRS-492). One cannot replace the other.'))}</p>
    <p class="sub-hint">${esc(L('Источник: IAEA TRS-492 (2023), разд. 7.7, ур. (18)–(20); разд. 8.2.', 'Source: IAEA TRS-492 (2023), Sec. 7.7, Eq. (18)–(20); Sec. 8.2.'))}</p>
  </div></details>`;
}

function introHtml() {
  if (sheet === 'sweet') {
    return `<p class="intro">${sub(L(
      'Опорная точка колодезной камеры — положение источника с наибольшим откликом. Источник проходит ряд положений с шагом не больше 2,5 мм, не меньше 10 мм в обе стороны от ожидаемого максимума; по кривой находится максимум и плато. Положение зависит от системы отсчёта (длина ампулопровода, глубина катетера), поэтому его проверяют при каждом измерении силы источника (IAEA TRS-492, разд. 8.2.1).',
      'The reference point of a well-type chamber is the source position with the largest response. The source steps through positions at most 2.5 mm apart, at least 10 mm on both sides of the expected maximum; the curve gives the maximum and the plateau. The position depends on the reference system (transfer tube length, catheter depth), so it is checked at every source strength measurement (IAEA TRS-492, Sec. 8.2.1).',
    ))}</p>`;
  }
  if (sheet === 'cross') {
    return `<p class="intro">${sub(L(
      'Калибровочный коэффициент рабочей колодезной камеры по эталонной (с сертификатом лаборатории): один и тот же источник того же нуклида поочерёдно в обеих камерах, в положении максимального отклика; эталонная — в своём держателе. N_field = M_ref/M_field · N_ref · k_sm,sm0 (IAEA TRS-492, разд. 7.7, ур. 18–20). Пересчёт между нуклидами (¹⁹²Ir ↔ ⁶⁰Co) не допускается.',
      'Calibration coefficient of the field well-type chamber from the reference one (with a laboratory certificate): the same source of the same nuclide in both chambers in turn, at the sweet spot; the reference chamber in its own holder. N_field = M_ref/M_field · N_ref · k_sm,sm0 (IAEA TRS-492, Sec. 7.7, Eq. 18–20). Conversion between nuclides (¹⁹²Ir ↔ ⁶⁰Co) is not permitted.',
    ))}</p>${crossHowtoHtml()}`;
  }
  if (sheet === 'stab') {
    return `<p class="intro">${sub(L(
      'Проверка стабильности колодезной камеры: не реже четырёх раз в год, до и после каждой замены источника. Показание с поправками на T, P и распад сравнивается с исходным, допуск ±0,5 %; при второй камере — отношение показаний, ±0,1 % (IAEA TRS-492, разд. 8.4–8.5). Исходное значение задают при вводе в работу и после каждой калибровки.',
      'Well-type chamber stability check: at least four times a year and before and after each source exchange. The reading corrected for T, P and decay is compared with the baseline, tolerance ±0.5%; with a redundant chamber, the reading ratio, ±0.1% (IAEA TRS-492, Sec. 8.4–8.5). The baseline is set at commissioning and after each recalibration.',
    ))}</p>`;
  }
  if (sheet === 'tg43') {
    return `<p class="intro">${sub(L(
      'Справочно: мощность поглощённой дозы в воде в точках вокруг источника по формализму линейного источника TG-43U1: Ḋ(r,θ) = S_K · Λ · G_L(r,θ)/G_L(1 см, 90°) · g_L(r) · F(r,θ) (Rivard 2004, ур. 1, 4). Λ, g_L(r) и F(r,θ) — консенсус HEBD (AAPM/ESTRO, 2012): F — по таблице модели с билинейной интерполяцией, на поперечной оси F = 1. Удобно для проверки значений системы планирования.',
      'For reference: absorbed dose rate to water at points around the source per the TG-43U1 line-source formalism: Ḋ(r,θ) = S_K · Λ · G_L(r,θ)/G_L(1 cm, 90°) · g_L(r) · F(r,θ) (Rivard 2004, Eq. 1, 4). Λ, g_L(r) and F(r,θ) are HEBD consensus data (AAPM/ESTRO, 2012): F from the model table with bilinear interpolation, F = 1 on the transverse axis. Useful for checking treatment planning system values.',
    ))}</p>`;
  }
  if (sheet === 'decay') {
    return `<p class="intro">${sub(L(
      'Калькулятор распада: активность и ОМВК источника на выбранную дату по данным паспорта — K̇(t) = K̇(t_0) · 2^(−Δt/T½), A(t) = A_0 · 2^(−Δt/T½) (IAEA TRS-492, ур. 8–9, табл. 3). Даты A_0 и K_0 в паспорте могут быть разными. Справочно — проверка через Γ_δ и диапазон по неопределённости паспорта; ниже — прогноз по неделям и дата, когда сила упадёт до порога замены. Время — по выбранному поясу и в UTC (разд. 3.4.2).',
      'Decay calculator: the source activity and RAKR at the chosen date from the certificate data, K̇(t) = K̇(t_0) · 2^(−Δt/T½), A(t) = A_0 · 2^(−Δt/T½) (IAEA TRS-492, Eq. 8–9, Table 3). The certificate may give A_0 and K_0 at different dates. For reference: a check via Γ_δ and the range from the certificate uncertainty; below, a weekly forecast and the date when the strength falls to the replacement threshold. Times in the chosen zone and in UTC (Sec. 3.4.2).',
    ))}</p>`;
  }
  return sheet === 'well'
    ? `<p class="intro">${sub(L(
        'Сила источника по колодезной камере (IAEA TRS-492, гл. 7–8): ОМВК K̇_δ,R и сила воздушной кермы S_K (численно S_K в U = ОМВК в мкГр/ч на 1 м). Калибровочный коэффициент — из строки сертификата камеры для своего аппарата, адаптера и нуклида. Перевод между ¹⁹²Ir и ⁶⁰Co не допускается.',
        'Source strength with a well-type chamber (IAEA TRS-492, Ch. 7–8): reference air kerma rate K̇_δ,R and air kerma strength S_K (S_K in U numerically equals the RAKR in µGy/h at 1 m). The calibration coefficient comes from the chamber certificate row for your afterloader, adapter and nuclide. Conversion between ¹⁹²Ir and ⁶⁰Co is not permitted.',
      ))}</p>`
    : `<p class="intro">${sub(L(
        'Сила источника в цилиндрическом фантоме PTW 9193 по DIN 6809-2 / руководству PTW 9193 (DGMP-Bericht 13): камера в четырёх положениях через 90° на 8 см от источника, калибровочный коэффициент в пучке ⁶⁰Co. Для ⁶⁰Co в DGMP 13 данных нет — в таблице вариантов литературные коэффициенты и свой k_tot по сличению с колодезной камерой.',
        'Source strength in the PTW 9193 cylindrical phantom per DIN 6809-2 / the PTW 9193 manual (DGMP Report 13): the chamber at four positions 90° apart, 8 cm from the source, calibration coefficient in a ⁶⁰Co beam. DGMP 13 has no data for ⁶⁰Co: the variant table lists literature factors and your own k_tot from comparison with the well-type chamber.',
      ))}</p>`;
}

function sourceHtml() {
  const nucOpts = Object.entries(HALF_LIVES).map(([k, h]) => opt(k, h.label, form.nuclide)).join('');
  const h = HALF_LIVES[form.nuclide];
  const unitAll = `<optgroup label="${esc(L('Сила источника', 'Source strength'))}">${unitOpts(STRENGTH_UNITS, form.cert_unit)}</optgroup><optgroup label="${esc(L('Активность (нужна Γ_δ)', 'Activity (Γ_δ needed)'))}">${unitOpts(ACTIVITY_UNITS, form.cert_unit)}</optgroup>`;
  return `<section class="step"><header><span class="step-no">1</span><h2>${esc(L('Источник и его сертификат', 'Source and its certificate'))}</h2></header>
    ${anyEquipment() ? '' : `<p class="sub-hint">${esc(EQ_HINT())} <a href="#equipment">${esc(L('Открыть «Оборудование»', 'Open Equipment'))}</a></p>`}
    <div class="grid">
      ${journalSourceHtml()}
      ${select('nuclide', L('Радионуклид', 'Radionuclide'), nucOpts)}
      ${num('half', L('Свой t½, сут', 'Own t½, days'), { ph: h ? String(+h.days.toFixed(3)).replace('.', L(',', '.')) : '', hint: L('Пусто — TRS-492, табл. 3', 'Blank: TRS-492, Table 3') })}
      ${text('src_name', L('Модель и номер источника', 'Source model and number'), { span: ' span-2' })}
      ${numUnit('cert_value', L('Значение в сертификате', 'Certificate value'), unitAll, 'cert_unit', { span: ' span-2' })}
      ${numUnit('cert_gamma', L('Γ_δ из сертификата', 'Γ_δ from the certificate'), GAMMA_UNITS, 'cert_gamma_unit', { span: ' span-2' })}
      ${num('cert_U', L('Неопределённость сертификата U, %', 'Certificate uncertainty U, %'), { ph: L('пусто — 5 % при k = 3', 'blank: 5% at k = 3') })}
      ${select('cert_k', L('k для U сертификата', 'k of the certificate U'), [['2', 'k = 2 (P ≈ 95 %)'], ['3', 'k = 3 (P ≈ 99,7 %)']].map(([k, t]) => opt(k, t, form.cert_k)).join(''), { full: false })}
      ${when('cert_', L('Дата сертификата', 'Certificate date'), L('Пусто — 00:00 (как в таблице распада производителя)', "Blank: 00:00 (as in the manufacturer's decay table)"))}
    </div>
    <p class="sub-hint" id="br-cert-live"></p></section>`;
}

/** Калибровка в Ḋw (с 0.79.0): модель источника для Λ — S_K = Ḋw,1/Λ для сравнения с сертификатом. */
function wellSrcHtml() {
  const list = DOSE_SOURCES.filter((x) => x.nuclide === form.nuclide && x.lambda);
  const cur = form.w_src || (list.some((x) => x.id === (form.p_src || form.t_src)) ? form.p_src || form.t_src : '');
  const opts = opt('', L('— выберите —', '— choose —'), cur) + list.map((x) => opt(x.id, `${x.name}: Λ = ${fmt(x.lambda, 3)}`, cur)).join('') + opt('other', L('своя модель (свой Λ)', 'own model (own Λ)'), cur);
  return `${select('w_src', L('Модель источника (Λ для S_K)', 'Source model (Λ for S_K)'), opts, { span: ' span-2' })}${cur === 'other' ? num('w_lambda', L('Λ, сГр·ч⁻¹·Ед⁻¹', 'Λ, cGy·h⁻¹·U⁻¹')) : ''}`;
}

function wellChamberHtml() {
  const smOpts = (cur) => opt('', '—', cur) + KSM_SOURCES.map((s) => opt(s.id, s.name, cur)).join('');
  const modes = [['none', L('другая модель, данных нет (1 и +2 %)', 'another model, no data (1 and +2%)')], ['same', L('тот же источник, что при калибровке', 'same source as at calibration')], ['table', L('TRS-492, табл. 8 (SI HDR 1000 Plus + 70010)', 'TRS-492, Table 8 (SI HDR 1000 Plus + 70010)')], ['manual', L('ввести вручную', 'enter manually')]];
  const m = form.w_ksm_mode;
  return `<section class="step"><header><span class="step-no">2</span><h2>${esc(L('Колодезная камера и её сертификат', 'Well-type chamber and its certificate'))}</h2></header>
    <div class="grid">
      ${journalWellHtml()}
      ${text('w_model', L('Камера', 'Chamber'), { ph: 'PTW TM33004' })}
      ${text('w_serial', L('Заводской номер', 'Serial number'))}
      ${numUnit('w_N', L('Калибровочный коэффициент N', 'Calibration coefficient N'), WELL_N_UNITS, 'w_N_unit', { span: ' span-2' })}
      ${num('w_NU', L('U(N), k = 2, %', 'U(N), k = 2, %'))}
      ${isDwUnit(form.w_N_unit) ? wellSrcHtml() : ''}
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
  return `<section class="step"><header><span class="step-no">3</span><h2>${esc(L('Измерение в точке максимального отклика', 'Measurement at the sweet spot'))}</h2></header>
    <div class="grid">
      ${when('w_', L('Дата измерения', 'Measurement date'), L('Время измерения', 'Measurement time'))}
      ${num('w_T', L('Температура, °C', 'Temperature, °C'))}
      ${numUnit('w_P', L('Давление', 'Pressure'), PRESSURE_UNITS, 'w_P_unit')}
      ${select('w_unit', L('Единица тока', 'Current unit'), unitOpts(CURRENT_UNITS, form.w_unit))}
      ${num('w_pos', L('Положение источника, мм', 'Source position, mm'), { hint: L('Лист «Максимум отклика» проверяет, что это максимум', 'The Sweet spot sheet checks that this is the maximum') })}
    </div>
    <p class="sub-hint">${sub(L('Не меньше трёх введений источника в точку максимума, на каждое — не меньше пяти показаний после стабилизации; результат — среднее по введениям (TRS-492, разд. 8.2.2).', 'At least three source insertions at the sweet spot, at least five readings each after stabilisation; the result is the mean over the insertions (TRS-492, Sec. 8.2.2).'))}</p>
    ${['w_I', 'w_I2', 'w_I3'].map((k, i) => `<div class="series">${cellsHtml(k, L(`Введение ${i + 1}: ток`, `Insertion ${i + 1}: current`), form[k], unitLabel(CURRENT_UNITS[form.w_unit]))}</div>`).join('')}
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
  return `<section class="step"><header><span class="step-no">2</span><h2>${esc(L('Камера в фантоме', 'Chamber in the phantom'))}</h2></header>
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
  return `<section class="step"><header><span class="step-no">3</span><h2>${esc(L('Измерение в фантоме', 'Measurement in the phantom'))}</h2></header>
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
  return `<section class="step"><header><span class="step-no">5</span><h2>${esc(L('Поглощённая доза в воде', 'Absorbed dose to water'))}</h2></header>
    <div class="grid">${select('p_src', L('Модель источника (Λ и g_L по HEBD)', 'Source model (Λ and g_L per HEBD)'), options, { span: ' span-2' })}${manual}</div>
    <div id="br-dose" aria-live="polite"></div>
    <p class="sub-hint">${sub(L('В точке измерения Ḋ_w = N_D,w · Ṁ — в ПММА фантома (руководство PTW 9193, ур. 15). Ḋ_w,1 — референсная мощность дозы в воде на 1 см: (k_tot)Ḋw,1 · N_D,w · Ṁ (Ubrich 2014, ур. 6, табл. 7) или Λ · S_K (TG-43U1, ур. 1). На 8 см в воде, на поперечной оси: Ḋ_w,1 · G_L(8)/G_L(1) · g_L(8) (TG-43U1, ур. 1, 4) — это не то же, что доза в точке измерения в фантоме.', 'At the measurement point Ḋ_w = N_D,w · Ṁ, in the PMMA phantom (PTW 9193 manual, Eq. 15). Ḋ_w,1 is the reference dose rate to water at 1 cm: (k_tot)Ḋw,1 · N_D,w · Ṁ (Ubrich 2014, Eq. 6, Table 7) or Λ · S_K (TG-43U1, Eq. 1). At 8 cm in water on the transverse axis: Ḋ_w,1 · G_L(8)/G_L(1) · g_L(8) (TG-43U1, Eq. 1, 4); this is not the same as the dose at the measurement point in the phantom.'))}</p></section>`;
}

function ownKtotHtml() {
  return `<section class="step"><header><span class="step-no">6</span><h2>${sub(L('Свой k_tot по колодезной камере', 'Own k_tot from the well-type chamber'))}</h2></header>
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
  return `<section class="step"><header><span class="step-no">1</span><h2>${esc(L('Камера и система отсчёта', 'Chamber and position reference'))}</h2></header>
    <div class="grid">
      ${journalMachineHtml()}
      ${journalWellHtml()}
      ${text('w_model', L('Камера', 'Chamber'), { ph: 'PTW TM33004' })}
      <div class="field"><label for="br_s_date">${esc(L('Дата', 'Date'))}</label><input type="date" id="br_s_date" data-f="s_date" value="${esc(form.s_date)}"></div>
      ${text('s_ref', L('Система отсчёта положения', 'Position reference'), { ph: L('по пульту аппарата, ампулопровод №…', 'as on the afterloader console, transfer tube no. …'), span: ' span-2' })}
      ${num('s_cert_pos', L('Опорная точка по сертификату камеры, мм', 'Reference point in the chamber certificate, mm'))}
      ${num('s_step', L('Шаг положений, мм', 'Position step, mm'))}
      ${select('s_method', L('Как искать максимум', 'How to find the maximum'), [['trs', L('парабола по ±20 мм (PTW 33004, 33005, SI HDR 1000 Plus)', 'parabola over ±20 mm (PTW 33004, 33005, SI HDR 1000 Plus)')], ['ivb', L('первый локальный максимум от входа (SI IVB 1000)', 'first local maximum from the entrance (SI IVB 1000)')]].map(([k, t]) => opt(k, t, form.s_method)).join(''), { span: ' span-2' })}
      ${form.s_method === 'ivb' ? select('s_entry', L('Вход в камеру — со стороны', 'Chamber entrance is on the side of'), [['low', L('меньших положений', 'smaller positions')], ['high', L('больших положений', 'larger positions')]].map(([k, t]) => opt(k, t, form.s_entry)).join('')) : ''}
      ${select('s_unit', L('Единица тока', 'Current unit'), unitOpts(CURRENT_UNITS, form.s_unit))}
    </div></section>`;
}

function sweetRowsHtml() {
  const n = Math.max(form.s_x.length, form.s_M.length, 3);
  const u = unitLabel(CURRENT_UNITS[form.s_unit]) ?? '';
  const rows = Array.from({ length: n }, (_, i) => `<div class="pair-row"><span class="pair-no">${i + 1}</span>
      <input type="text" class="num" inputmode="decimal" id="br_s_x_${i}" data-sx="${i}" aria-label="${esc(L(`Положение ${i + 1}, мм`, `Position ${i + 1}, mm`))}" value="${esc(form.s_x[i] ?? '')}">
      <input type="text" class="num" inputmode="decimal" id="br_s_M_${i}" data-sm="${i}" aria-label="${esc(L(`Показание ${i + 1}`, `Reading ${i + 1}`))}" value="${esc(form.s_M[i] ?? '')}"></div>`).join('');
  return `<section class="step"><header><span class="step-no">2</span><h2>${esc(L('Кривая отклика', 'Response curve'))}</h2></header>
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
    [L('Максимум', 'Maximum'), `${fmt(r.mPeak, 4)} ${u}; ${r.method === 'trs' ? L(`вершина параболы по ${r.fit.n} точкам в ±20 мм (TRS-492, ур. 25–26)`, `parabola vertex over ${r.fit.n} points within ±20 mm (TRS-492, Eq. 25–26)`) : r.local ? L('первый локальный максимум от входа', 'first local maximum from the entrance') : r.method === 'parabola' ? L(`вершина параболы по ${r.fit.n} точкам у вершины`, `parabola vertex over ${r.fit.n} points at the top`) : L('наибольшее показание', 'largest reading')}`, 'xPeak'],
    r.method === 'trs' && r.top ? [L('Для сравнения: парабола у вершины', 'For comparison: parabola at the top'), `${fmt(r.top.xPeak, 1)} ${L('мм', 'mm')} (${L(`по точкам ≥ 99 %, n = ${r.top.n}`, `points ≥ 99%, n = ${r.top.n}`)})`, 'xPeak'] : null,
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
    <p class="chart-legend">${legendSwatch({ cls: 's1' })} ${esc(L('измерения', 'measurements'))} ${legendSwatch({ cls: 's2', line: true })} ${esc(r.method === 'trs' ? L('парабола по ±20 мм', 'parabola over ±20 mm') : L('парабола у вершины', 'parabola at the top'))}</p>
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
  // подписи «измерение» и «сертификат» в одной строке: близкие положения — одной подписью, чтобы не наползали
  const span = r.points.length > 1 ? r.points[r.points.length - 1].x - r.points[0].x : 0;
  const both = Number.isFinite(r.atMeas.rel) && Number.isFinite(r.atCert.rel) && Math.abs(r.atMeas.x - r.atCert.x) < 0.12 * span;
  if (both) vlines.push({ x: r.atMeas.x, label: L('измерение, сертификат', 'measurement, certificate'), row: 1 });
  else {
    if (Number.isFinite(r.atMeas.rel)) vlines.push({ x: r.atMeas.x, label: L('измерение', 'measurement'), row: 1 });
    if (Number.isFinite(r.atCert.rel)) vlines.push({ x: r.atCert.x, label: L('сертификат', 'certificate'), row: 1 });
  }
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
/** «Распад», раздел 2: опорная активность A₀ со своей датой (как в книге отделения: даты A₀ и K₀ могут быть разными). */
function decayA0Html() {
  return `<section class="step" data-optional><header><span class="step-no">2</span><h2>${esc(L('Опорная активность (справочно)', 'Reference activity (for reference)'))}</h2></header>
    <p class="sub-hint">${sub(L('Если в паспорте активность дана отдельно от ОМВК и на другую дату — введите её здесь. Пусто — активность считается из ОМВК через Γ_δ (или берётся из раздела 1, если сертификат дан в активности). Активность (кажущаяся) — устаревшая величина, только для сверки с паспортом: сила источника и сравнение с сертификатом — по ОМВК (TRS-492, дополнение I).', 'If the certificate gives the activity separately from the RAKR and at another date, enter it here. Blank: the activity is calculated from the RAKR via Γ_δ (or taken from section 1 if the certificate is given as an activity). The (apparent) activity is an antiquated quantity, only for comparison with the certificate: the source strength and the comparison with the certificate use the RAKR (TRS-492, Appendix I).'))}</p>
    <div class="grid">
      ${numUnit('d_A0', L('A₀ — активность', 'A₀, activity'), ACTIVITY_UNITS, 'd_A0_unit', { span: ' span-2' })}
      ${when('d_A0_', L('Дата A₀', 'A₀ date'), L('Пусто — 00:00', 'Blank: 00:00'))}
    </div></section>`;
}

/** «Распад», раздел 3: дата расчёта, отсчёт, прогноз и порог замены. */
function decayParamsHtml() {
  const bases = [['cert', L('от сертификата источника', 'from the source certificate')], ['well', L('от измерения колодезной камерой', 'from the well-type chamber measurement')], ['phantom', L('от измерения в фантоме PTW 9193', 'from the PTW 9193 phantom measurement')]];
  const units = [['w', L('недели', 'weeks')], ['d', L('сутки', 'days')], ['m', L('месяцы', 'months')]];
  const tUnits = `<optgroup label="${esc(L('Сила источника', 'Source strength'))}">${unitOpts(STRENGTH_UNITS, form.d_target_unit)}</optgroup><optgroup label="${esc(L('Активность (нужна Γ_δ)', 'Activity (Γ_δ needed)'))}">${unitOpts(ACTIVITY_UNITS, form.d_target_unit)}</optgroup>`;
  return `<section class="step"><header><span class="step-no">3</span><h2>${esc(L('Дата расчёта и прогноз', 'Calculation date and forecast'))}</h2></header>
    <div class="grid">
      ${when('d_at_', L('Дата расчёта (пусто — сейчас)', 'Calculation date (blank: now)'), L('Пусто — 00:00', 'Blank: 00:00'))}
      ${select('d_basis', L('Отсчёт ОМВК', 'RAKR base'), bases.map(([k, t]) => opt(k, t, form.d_basis)).join(''), { span: ' span-2' })}
      <div class="field"><label for="br_d_from">${esc(L('Прогноз с даты (пусто — с даты расчёта, не раньше даты отсчёта)', 'Forecast from (blank: the calculation date; not before the base date)'))}</label><input type="date" id="br_d_from" data-f="d_from" value="${esc(form.d_from)}"></div>
      <div class="field"><label for="br_d_to">${esc(L('По дату (пусто — 8 строк)', 'To (blank: 8 rows)'))}</label><input type="date" id="br_d_to" data-f="d_to" value="${esc(form.d_to)}"></div>
      ${num('d_n', L('Шаг', 'Step'), { ph: '1' })}
      ${select('d_unit', L('Единица шага', 'Step unit'), units.map(([k, t]) => opt(k, t, form.d_unit || 'w')).join(''))}
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

/** Малые числа (Гр/с, λ): «1,790·10⁻⁵». */
function fmtSci(v, d = 3) {
  if (!Number.isFinite(v)) return '—';
  const [m, e] = v.toExponential(d).split('e');
  const sup = String(Number(e)).replace(/-/g, '⁻').replace(/\d/g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[c]);
  return `${L(m.replace('.', ','), m)}·10${sup}`;
}

function decayResult() {
  const r = decayCompute();
  if (!r.ok) return msgHtml(r.messages);
  const z = form.d_zone;
  const a = r.at;
  const when = `${dateText(a.t, form.d_at_zone || z)}${a.now ? L(' (сейчас)', ' (now)') : ''}`;
  const head = Number.isFinite(a.mGyh)
    ? `<div class="plates-dose"><span${tipAttr('dec_K', { focus: true })}>${esc(L(`ОМВК на ${when}`, `RAKR at ${when}`))}</span><b>${esc(fmt(a.mGyh, 3))} ${esc(L('мГр/ч на 1 м', 'mGy/h at 1 m'))}</b><span>${sub(`S_K = ${fmt(a.U, 0)} U`)}${Number.isFinite(a.A) ? esc(L(`; A = ${fmt(a.A, 2)} ГБк (${fmt(a.Ci, 3)} Ки)`, `; A = ${fmt(a.A, 2)} GBq (${fmt(a.Ci, 3)} Ci)`)) : ''}</span></div>`
    : `<div class="plates-dose"><span${tipAttr('dec_A', { focus: true })}>${esc(L(`Активность на ${when}`, `Activity at ${when}`))}</span><b>${esc(fmt(a.A, 2))} ${esc(L('ГБк', 'GBq'))}</b><span>${esc(fmt(a.Ci, 3))} ${esc(L('Ки', 'Ci'))}</span></div>`;
  const grp = (title) => `<tr class="grp"><th colspan="3">${sub(title)}</th></tr>`;
  const row = (label, v, unit, tip) => `<tr><td${tip ? tipAttr(tip, { focus: true }) : ''}>${sub(label)}</td><td class="v">${esc(v)}</td><td>${sub(unit)}</td></tr>`;
  const rows = [grp(L('Временные интервалы', 'Time intervals'))];
  if (r.a0) rows.push(row(L('От A₀ до даты расчёта', 'From A₀ to the calculation date'), fmt(a.dtA, 3), L('сут', 'd'), 'dec_dt'), row(L('Фактор распада A(t)', 'Decay factor A(t)'), fmt(a.fA, 5), '', 'dec_f'));
  if (r.base) rows.push(row(L(`От K₀ до даты расчёта (${r.base.label})`, `From K₀ to the calculation date (${r.base.label})`), fmt(a.dtK, 3), L('сут', 'd'), 'dec_dt'), row(L('Фактор распада K(t)', 'Decay factor K(t)'), fmt(a.fK, 5), '', 'dec_f'));
  rows.push(row(L(`λ = ln 2 / T½ (T½ = ${fmt(r.half, 3)} сут)`, `λ = ln 2 / T½ (T½ = ${fmt(r.half, 3)} d)`), fmtSci(r.lambda, 4), L('с⁻¹', 's⁻¹'), 'dec_lambda'));
  if (Number.isFinite(a.A)) {
    rows.push(grp(L(`Активность${a.Avia === 'gamma' ? ' (из ОМВК через Γ_δ, справочно)' : ''}`, `Activity${a.Avia === 'gamma' ? ' (from the RAKR via Γ_δ, reference)' : ''}`)),
      row(L('Активность A(t), справочно', 'Activity A(t), for reference'), fmt(a.A, 3), L('ГБк', 'GBq'), 'dec_A'), row(L('Активность A(t), справочно', 'Activity A(t), for reference'), fmt(a.Ci, 4), L('Ки', 'Ci'), 'dec_A'));
    if (Number.isFinite(a.dA)) rows.push(row(L('Изменение от A₀', 'Change from A₀'), fmtSigned(a.dA * 100, 2), '%', 'dec_f'));
  }
  if (Number.isFinite(a.mGyh)) {
    rows.push(grp(L(`Мощность воздушной кермы на 1 м${a.Kvia === 'gamma' ? ' (из активности через Γ_δ)' : ''}`, `Air kerma rate at 1 m${a.Kvia === 'gamma' ? ' (from the activity via Γ_δ)' : ''}`)),
      row(L('Керма K(t)', 'Kerma K(t)'), fmtSci(a.Gys, 4), L('Гр/с', 'Gy/s'), 'dec_K'), row(L('Керма K(t)', 'Kerma K(t)'), fmt(a.mGyh, 4), L('мГр/ч', 'mGy/h'), 'dec_K'),
      row(L('Керма K(t)', 'Kerma K(t)'), fmt(a.uGyh, 1), L('мкГр/ч', 'µGy/h'), 'dec_K'), row(L('Сила воздушной кермы S_K', 'Air kerma strength S_K'), fmt(a.U, 1), 'U', 'dec_K'));
  }
  if (Number.isFinite(a.KfromA)) rows.push(grp(L('Проверка через Γ_δ (справочно)', 'Check via Γ_δ (reference)')), row(L('Керма из активности и Γ_δ', 'Kerma from the activity and Γ_δ'), fmt(a.KfromA, 4), L('мГр/ч', 'mGy/h'), 'dec_gamma'), row(L('Разница двух оценок', 'Difference of the two estimates'), fmtSigned(a.dGamma * 100, 2), '%', 'dec_gamma'));
  if (a.uRange) {
    const u = a.uRange;
    rows.push(grp(L(`Диапазон с учётом неопределённости паспорта (±${fmt(u.u, 1)} %${u.given ? `, k = ${u.k}` : ', типичные, k = 3'})`, `Range with the certificate uncertainty (±${fmt(u.u, 1)}%${u.given ? `, k = ${u.k}` : ', typical, k = 3'})`)),
      row(L('Нижняя граница K(t)', 'Lower limit K(t)'), fmt(u.lo, 4), L('мГр/ч', 'mGy/h'), 'dec_range'), row(L('Верхняя граница K(t)', 'Upper limit K(t)'), fmt(u.hi, 4), L('мГр/ч', 'mGy/h'), 'dec_range'));
  }
  const atTable = `<div class="table-wrap"><table class="factors br-decay-at"><tbody>${rows.join('')}</tbody></table></div>`;
  const target = r.target && Number.isFinite(r.target.t)
    ? `<p class="sub-hint"${tipAttr('d_target')}>${sub(L(`Сила ${fmt(r.target.U / 1e3, 3)} мГр/ч на 1 м (${fmt(r.target.U, 0)} U) — ${dateText(r.target.t, z)} (${isoUtc(r.target.t)}).`, `Strength ${fmt(r.target.U / 1e3, 3)} mGy/h at 1 m (${fmt(r.target.U, 0)} U): ${dateText(r.target.t, z)} (${isoUtc(r.target.t)}).`))}</p>`
    : '';
  const hasA = r.rows.some((x) => Number.isFinite(x.A));
  const hasK = r.rows.some((x) => Number.isFinite(x.mGyh));
  const daysOf = (x) => (r.a0 ? x.daysA : x.days);
  const fracOf = (x) => (r.a0 ? x.fracA : x.frac);
  const table = `<div class="table-wrap"><table class="factors br-variants br-decay"><thead><tr><th>${esc(L('Дата и время', 'Date and time'))}</th><th>UTC</th><th class="v"${tipAttr('dec_dt', { focus: true })}>${esc(r.a0 ? L('Прошло от A₀, сут', 'Since A₀, d') : L('Прошло от K₀, сут', 'Since K₀, d'))}</th>${hasA ? `<th class="v"${tipAttr('dec_A', { focus: true })}>${esc(L('A(t), ГБк', 'A(t), GBq'))}</th><th class="v">${esc(L('A(t), Ки', 'A(t), Ci'))}</th>` : ''}${hasK ? `<th class="v"${tipAttr('dec_K', { focus: true })}>${esc(L('K(t), мГр/ч', 'K(t), mGy/h'))}</th><th class="v">S_K, U</th>` : ''}<th class="v"${tipAttr('frac', { focus: true })}>${esc(L('Сохр., %', 'Left, %'))}</th></tr></thead><tbody>${r.rows
    .map((x) => `<tr><td>${esc(dateText(x.t, z))}</td><td><small>${esc(isoUtc(x.t))}</small></td><td class="v">${esc(fmt(daysOf(x), 2))}</td>${hasA ? `<td class="v">${esc(fmt(x.A, 2))}</td><td class="v">${esc(fmt(x.Ci, 3))}</td>` : ''}${hasK ? `<td class="v">${esc(fmt(x.mGyh, 3))}</td><td class="v">${esc(fmt(x.U, 0))}</td>` : ''}<td class="v">${esc(fmt(fracOf(x) * 100, 2))}</td></tr>`)
    .join('')}</tbody></table></div>`;
  const stepText = { d: L('сут', 'd'), w: L('нед.', 'wk'), m: L('мес.', 'mo') }[r.step.unit];
  return `${head}${atTable}${target}
    <h3>${esc(L('Прогноз', 'Forecast'))}</h3><p class="sub-hint">${sub(L(`Шаг ${fmt(r.step.n, 0)} ${stepText}; ${r.rows.length} строк.`, `Step ${fmt(r.step.n, 0)} ${stepText}; ${r.rows.length} rows.`))}</p>
    <div class="actions"><button type="button" data-br="d-csv">${esc(L('Скачать таблицу (CSV)', 'Download the table (CSV)'))}</button></div>${table}${msgHtml(r.messages)}`;
}

function decayCsv() {
  const r = decayCompute();
  if (!r.ok) return;
  const en = L('ru', 'en') === 'en';
  const sep = en ? ',' : ';';
  const num = (v, d) => (Number.isFinite(v) ? (en ? v.toFixed(d) : v.toFixed(d).replace('.', ',')) : '');
  const head = [L('Дата', 'Date'), 'UTC', r.a0 ? L('Прошло от A₀, сут', 'Since A₀, d') : L('Прошло от K₀, сут', 'Since K₀, d'), L('A(t), ГБк', 'A(t), GBq'), L('A(t), Ки', 'A(t), Ci'), L('K(t), мГр/ч на 1 м', 'K(t), mGy/h at 1 m'), 'S_K, U', L('Сохр., %', 'Left, %')];
  const lines = [head.join(sep), ...r.rows.map((x) => [dateText(x.t, form.d_zone), isoUtc(x.t), num(r.a0 ? x.daysA : x.days, 3), num(x.A, 3), num(x.Ci, 4), num(x.mGyh, 4), num(x.U, 1), num((r.a0 ? x.fracA : x.frac) * 100, 3)].join(sep))];
  downloadText(`﻿${lines.join('\r\n')}\r\n`, savedFileName(L('таблица-распада', 'decay-table'), [form.src_name, HALF_LIVES[form.nuclide]?.label, new Date(r.at.t).toISOString().slice(0, 10)], 'csv'), 'text/csv;charset=utf-8');
  status(L('Таблица распада сохранена.', 'The decay table has been saved.'));
}

// ------------------------------------------------------------ лист «Сличение камер»
const nucSelect = () => select('nuclide', L('Радионуклид', 'Radionuclide'), Object.entries(HALF_LIVES).map(([k, h]) => opt(k, h.label, form.nuclide)).join(''));

function crossSetupHtml() {
  return `<section class="step"><header><span class="step-no">1</span><h2>${esc(L('Источник и условия', 'Source and conditions'))}</h2></header>
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
  return `<section class="step"><header><span class="step-no">${n}</span><h2>${esc(title)}</h2></header>
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

function stabSetupHtml() {
  const m = form.st_method;
  const nucs = ['Cs-137', 'Sr-90', 'Co-60'].map((k) => opt(k, HALF_LIVES[k].label, form.st_check_nuclide)).join('');
  return `<section class="step"><header><span class="step-no">1</span><h2>${esc(L('Метод и исходное значение', 'Method and baseline'))}</h2></header>
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
  return `<section class="step"><header><span class="step-no">2</span><h2>${esc(L('Проверка', 'Check'))}</h2></header>
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
  const one = (n) => n % 10 === 1 && n % 100 !== 11;
  const few = (n) => n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);
  const recs = (n) => (one(n) ? L('записи', 'record') : L('записей', 'records')); // «среднее 1 записи», «среднее 3 записей»
  const recsNom = (n) => (one(n) ? L('запись', 'record') : few(n) ? L('записи', 'records') : L('записей', 'records'));
  const rm = red && form.j_well ? redundantRunningMean(getJournal(), { chamberId: form.j_well, before: form.st_date }) : null;
  const rmBtn = rm?.n ? `<button type="button" data-br="st-runmean">${esc(L(`Исходное — текущее среднее ${rm.n} ${recs(rm.n)} журнала (${fmt(rm.mean, 5)})`, `Baseline: running mean of ${rm.n} journal record${rm.n === 1 ? '' : 's'} (${fmt(rm.mean, 5)})`))}</button>` : '';
  const rmHint = red ? `<p class="sub-hint">${sub(rm?.n
    ? L(`TRS-492 сравнивает отношение с текущим средним прошлых сличений: в журнале ${rm.n} ${recsNom(rm.n)} этой камеры (${fmtDate(rm.from)} — ${fmtDate(rm.to)}).`, `TRS-492 compares the ratio with the running mean of past comparisons: the journal holds ${rm.n} record${rm.n === 1 ? '' : 's'} for this chamber (${fmtDate(rm.from)} to ${fmtDate(rm.to)}).`)
    : L('TRS-492 сравнивает отношение с текущим средним прошлых сличений (разд. 8.5.1). Выберите камеру из «Оборудования» и записывайте сличения в журнал — среднее появится здесь кнопкой.', 'TRS-492 compares the ratio with the running mean of past comparisons (Sec. 8.5.1). Choose the chamber from Equipment and record the comparisons in the journal: the mean will appear here as a button.'))}</p>` : '';
  return `${head}<div class="actions"><button type="button" data-br="st-base">${esc(L('Записать это значение как исходное', 'Record this value as the baseline'))}</button>${rmBtn}</div>${rmHint}${factorRows(rows)}${msgHtml(r.messages)}`;
}

// ------------------------------------------------------------ бюджет неопределённости (колодезная камера, фантом)
/** Бюджет листа: колодезная камера — TRS-492, табл. 10; фантом — Ubrich 2014. Возвращает { b, value } (value — мГр/ч). */
function budgetFor() {
  const w = computeBrachyWell(form, { offsetMin: offsetMin() });
  const wb = wellBudget({ scenario: form.u_scen, NU: parseNumber(form.w_NU), ksmMode: form.w_ksm_mode, readings: w.readings, over: form.u_over_w });
  if (sheet === 'well') return { b: wb, value: w.ok ? w.mGyh : NaN, which: 'w', dev: w.compare?.dev };
  const r = computeBrachyPhantom(form, { offsetMin: offsetMin() });
  const b = phantomBudget({ scenario: form.u_scen, NU: parseNumber(form.p_NU), mainId: r.main?.id, nuclide: form.nuclide, holes: r.holes, kA: r.main?.kA, wellUc: wb.uc, over: form.u_over_p });
  return { b, value: r.main ? r.mGyh : NaN, which: 'p', dev: r.compare?.dev };
}

const uNum = (v) => (Number.isFinite(v) ? fmt(v, 2) : '—');

function uncHtml(n) {
  const { b, which } = budgetFor();
  const over = parseOverrides(form[`u_over_${which}`]);
  const rows = b.rows
    .map((r) => `<tr data-ur="${esc(r.key)}"><td>${sub(r.label)}<br><small class="u-how">${sub(r.how)}</small>${r.ref ? ` <small class="ref">(${esc(refText(r.ref))})</small>` : ''}</td><td class="v u-def">${esc(uNum(r.def))}</td><td class="v"><input type="text" class="num u-own" inputmode="decimal" data-uk="${esc(r.key)}" aria-label="${esc(L(`Своё значение: ${r.label}`, `Own value: ${r.label}`))}" value="${esc(over[r.key] ?? '')}"></td><td class="v u-val">${esc(uNum(r.value))}</td></tr>`)
    .join('');
  const scen = [['1', L('сценарий 1: контролируемые условия', 'scenario 1: controlled conditions')], ['2', L('сценарий 2: условия не контролируются', 'scenario 2: conditions not controlled')]];
  return `<section class="step"><header><span class="step-no">${n}</span><h2>${esc(L('Неопределённость', 'Uncertainty'))}</h2></header>
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
  const { b, value, dev } = budgetFor();
  const keys = new Set(b.rows.map((r) => r.key));
  const shown = [...document.querySelectorAll('#brachy-root tr[data-ur]')].map((tr) => tr.dataset.ur);
  if (shown.length !== keys.size || shown.some((k) => !keys.has(k))) {
    // состав строк бюджета изменился — лист перерисуется после пересчёта (live)
    rerender = true;
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
    <p class="sub-hint">${sub(L(`u_c = ${fmt(b.uc, 2)} %; U = ${fmt(b.k, 0)} · u_c = ${fmt(b.U, 2)} %${abs}.`, `u_c = ${fmt(b.uc, 2)}%; U = ${fmt(b.k, 0)} · u_c = ${fmt(b.U, 2)}%${abs}.`))}</p>${agreeHtml(dev, b.U)}${msgHtml(b.messages)}`;
}

/** Согласие с сертификатом в пределах расширенных неопределённостей (k = 2), TRS-492, разд. 8.6.2.1. */
function agreeHtml(dev, Umeas) {
  if (!Number.isFinite(dev)) return '';
  const a = certAgreement({ dev, Umeas, Ucert: parseNumber(form.cert_U), kCert: parseNumber(form.cert_k) });
  if (!a.ok) return '';
  const uc = a.typical ? L(`U сертификата не указана — взята типичная 5 % при k = 3, т. е. ${fmt(a.Ucert2, 1)} % при k = 2`, `certificate U not given: the typical 5% at k = 3 is used, i.e. ${fmt(a.Ucert2, 1)}% at k = 2`) : L(`U сертификата ${fmt(a.Ucert2, 2)} % при k = 2`, `certificate U ${fmt(a.Ucert2, 2)}% at k = 2`);
  const chip = `<span class="chip ${a.pass ? 'ok' : 'out'}">${esc(a.pass ? L('согласуются', 'agree') : L('не согласуются', 'do not agree'))}</span>`;
  return `<div class="plates-dose"><span${tipAttr('agree', { focus: true })}>${esc(L('Согласие с сертификатом (k = 2)', 'Agreement with the certificate (k = 2)'))}</span><b>${esc(fmtSigned(dev, 2))} % / ±${esc(fmt(a.limit, 2))} %</b>${chip}</div>
    <p class="sub-hint">${sub(L(`Предел √(U_серт² + U_изм²): ${uc}, U измерения ${fmt(Umeas, 2)} %. ${a.pass ? '' : 'Значения сертификата и измерения должны совпадать в пределах своих расширенных неопределённостей — выясните причину расхождения.'} (TRS-492, разд. 8.6.2.1)`, `Limit √(U_cert² + U_meas²): ${uc}, measurement U ${fmt(Umeas, 2)}%. ${a.pass ? '' : 'The certificate and measured values must agree within their expanded uncertainties; investigate the difference.'} (TRS-492, Sec. 8.6.2.1)`))}</p>`;
}

// ------------------------------------------------------------ лист «Доза TG-43»
function tg43ParamsHtml() {
  const srcs = DOSE_SOURCES.filter((x) => x.nuclide === form.nuclide && x.lambda);
  const options = [opt('', L('не выбрана', 'not chosen'), form.t_src), ...srcs.map((x) => opt(x.id, x.name, form.t_src)), opt('other', L('другая — ввести Λ, L', 'other: enter Λ, L'), form.t_src)].join('');
  const bases = [['cert', L('по сертификату на дату расчёта', 'from the certificate at the calculation date')], ['well', L('по листу «Колодезная камера»', 'from the Well-type chamber sheet')], ['phantom', L('по листу «Фантом PTW 9193»', 'from the PTW 9193 phantom sheet')], ['manual', L('своя S_K', 'own S_K')]];
  return `<section class="step"><header><span class="step-no">2</span><h2>${esc(L('Модель источника и сила', 'Source model and strength'))}</h2></header>
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
  return `<section class="step"><header><span class="step-no">3</span><h2>${esc(L('Точки', 'Points'))}</h2></header>
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
    .map((x) => `<tr><td class="v">${esc(fmt(x.r, 2))}</td>${cell(x.G, 5)}<td class="v">${Number.isFinite(x.g) ? esc(fmt(x.g, 3)) + (x.gOwn ? '*' : x.gExtra ? '†' : '') : '—'}</td><td class="v">${Number.isFinite(x.F) ? esc(fmt(x.F, 3)) + (x.FOwn ? '*' : x.FExtra ? '†' : '') : '—'}</td>${cell(x.value / 100, 4)}${cell((x.value * 10) / 60, 3)}</tr>`)
    .join('');
  const table = `<div class="table-wrap"><table class="factors br-variants"><thead><tr><th class="v">${esc(L('r, см', 'r, cm'))}</th><th class="v"${tipAttr('t_G', { focus: true })}>${sub('G_L/G_L(1)')}</th><th class="v"${tipAttr('t_g', { focus: true })}>${sub('g_L(r)')}</th><th class="v"${tipAttr('t_F', { focus: true })}>${sub('F(r,θ)')}</th><th class="v">${esc(L('Ḋ, Гр/ч', 'Ḋ, Gy/h'))}</th><th class="v">${esc(L('Ḋ, мГр/мин', 'Ḋ, mGy/min'))}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const atText = r.tNow ? L(`сейчас (${dateText(r.t, form.t_zone)})`, `now (${dateText(r.t, form.t_zone)})`) : dateText(r.t, form.t_zone);
  return `<div class="plates-dose"><span${tipAttr('Dw1', { focus: true })}>${sub(L('Ḋ_w,1 = Λ · S_K (1 см, 90°)', 'Ḋ_w,1 = Λ · S_K (1 cm, 90°)'))}</span><b>${esc(fmt(r.dw1 / 100, 4))} ${esc(L('Гр/ч', 'Gy/h'))}</b></div>
    <p class="sub-hint">${sub(L(`${s.name}: Λ = ${fmt(s.lambda, 3)} сГр·ч⁻¹·Ед⁻¹, L = ${fmt(s.L, 2)} см; S_K = ${fmt(r.SK, 0)} Ед (${r.base.label}) на ${atText}; θ = ${fmt(r.theta, 0)}°.`, `${s.name}: Λ = ${fmt(s.lambda, 3)} cGy·h⁻¹·U⁻¹, L = ${fmt(s.L, 2)} cm; S_K = ${fmt(r.SK, 0)} U (${r.base.label}) at ${atText}; θ = ${fmt(r.theta, 0)}°.`))}${s.ref ? ` <span class="ref">(${esc(refText(s.ref))})</span>` : ''}</p>
    ${table}${r.rows.some((x) => x.gOwn || x.FOwn) ? `<p class="sub-hint">${esc(L('* — своё значение.', '* own value.'))}</p>` : ''}${r.rows.some((x) => x.gExtra || x.FExtra) ? `<p class="sub-hint">${esc(L('† — экстраполяция по HEBD, табл. III.', '† extrapolated per HEBD Table III.'))}</p>` : ''}${msgHtml(r.messages)}`;
}

function resultCardHtml(n) {
  return `<section class="step"><header><span class="step-no">${n}</span><h2>${esc(L('Результат', 'Result'))}</h2></header><div id="br-result" aria-live="polite"></div></section>`;
}

function sheetBody() {
  if (sheet === 'sweet') return `${sweetSetupHtml()}${sweetRowsHtml()}${resultCardHtml(3)}${recordHtml(4)}${protHtml(5)}`;
  if (sheet === 'decay') return `${sourceHtml()}${decayA0Html()}${decayParamsHtml()}${resultCardHtml(4)}`;
  if (sheet === 'cross') return `${crossSetupHtml()}${crossChamberHtml(2, 'x_ref_', L('Эталонная камера', 'Reference chamber'))}${crossChamberHtml(3, 'x_fld_', L('Рабочая камера', 'Field chamber'))}${resultCardHtml(4)}${recordHtml(5)}${protHtml(6)}`;
  if (sheet === 'stab') return `${stabSetupHtml()}${stabMeasureHtml()}${resultCardHtml(3)}${recordHtml(4)}${protHtml(5)}`;
  if (sheet === 'tg43') return `${sourceHtml()}${tg43ParamsHtml()}${tg43RowsHtml()}${resultCardHtml(4)}`;
  if (sheet === 'well') return `${sourceHtml()}${wellChamberHtml()}${wellMeasureHtml()}${resultCardHtml(4)}${uncHtml(5)}${recordHtml(6)}${protHtml(7)}`;
  return `${sourceHtml()}${phantomChamberHtml()}${phantomMeasureHtml()}${resultCardHtml(4)}${doseHtml()}${ownKtotHtml()}${uncHtml(7)}${recordHtml(8)}${protHtml(9)}`;
}

/** Кнопки панели «Данные» справа: пример и очистка показаний листа. */
function dataActionsHtml() {
  return `${['decay', 'tg43'].includes(sheet) ? '' : `<button type="button" data-br="clear">${esc(L('Очистить измерение', 'Clear the measurement'))}</button>`}<button type="button" class="primary" data-br="sample">${esc(L('Загрузить пример', 'Load the example'))}</button>`;
}
/** Заголовок табло справа по листу. */
const DISPLAY_TITLE = () => ({
  well: L('Сила источника', 'Source strength'),
  phantom: L('Сила источника в фантоме', 'Source strength in the phantom'),
  sweet: L('Максимум отклика', 'Sweet spot'),
  cross: L('Сличение камер', 'Cross-calibration'),
  stab: L('Стабильность камеры', 'Chamber stability'),
  decay: L('Распад источника', 'Source decay'),
  tg43: L('Доза TG-43', 'TG-43 dose'),
});

function render() {
  const root = $('#brachy-root');
  if (!root) return;
  root.innerHTML = `${navHtml()}
    ${isBrachySample(form) ? `<p class="demo-flag">${esc(L('Сейчас загружен демонстрационный пример: значения вымышленные. Выбор из «Оборудования» в примере не задан.', 'The demo example is loaded: the values are fictitious. No Equipment selection is set in the example.'))}</p>` : ''}
    ${introHtml()}
    ${sheetBody()}`;
  for (const el of root.querySelectorAll('.cells[data-series]')) {
    const key = el.dataset.series;
    const m = key.match(/^p_hole(\d)$/);
    renderCells(el, m ? form.p_holes[+m[1]].M : form[key]);
    setupCells(el, onInput);
  }
  root.querySelector('.br-prot-det')?.addEventListener('toggle', (e) => {
    protOpen = e.target.open;
  });
  const title = $('#br-disp-title');
  if (title) title.textContent = DISPLAY_TITLE()[sheet] ?? '';
  const acts = $('#br-data-actions');
  if (acts) acts.innerHTML = dataActionsHtml();
  const sample = acts?.querySelector('[data-br="sample"]');
  if (sample) {
    armButton(sample, sample.textContent, () => L('Заменить поля всех листов примером?', 'Replace the fields of all sheets with the example?'), () => {
      form = normalizeBrachy({ ...sampleBrachy(), rec_staff: form.rec_staff });
      persist();
      render();
      status(L('Загружен демонстрационный пример (вымышленные данные): источник ¹⁹²Ir HDR, все листы заполнены одним днём измерений 15.09.2026.', 'The demo example is loaded (fictitious data): an HDR ¹⁹²Ir source, all sheets filled with one measurement day, 2026-09-15.'));
    });
  }
  const clear = acts?.querySelector('[data-br="clear"]');
  if (clear) {
    armButton(clear, clear.textContent, () => L('Очистить показания этого листа?', 'Clear the readings of this sheet?'), () => {
      if (sheet === 'well') Object.assign(form, { w_I: [...BRACHY_DEFAULTS.w_I], w_I2: [...BRACHY_DEFAULTS.w_I2], w_I3: [...BRACHY_DEFAULTS.w_I3], w_leak: '', w_T: '', w_P: '', w_pol_plus: '', w_pol_minus: '', w_ks_m1: '', w_ks_m2: '', w_date: '', w_time: '' });
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
// Замечания листа (с 0.79.0) — в панели «Замечания» справа, как в других разделах: при пересчёте листа (live)
// msgHtml собирает их в msgSink; вне пересчёта (протокол) — возвращает разметку на месте.
let msgSink = null;
let rerender = false;
const msgHtml = (msgs) => {
  if (msgSink) {
    msgSink.push(...msgs);
    return '';
  }
  return msgs
    .map((m) => `<p class="jlink-st ${m.level === 'info' ? 'none' : m.level === 'error' ? 'warn br-err' : 'warn'}">${sub(m.text)}${m.ref ? ` <span class="ref">(${esc(refText(m.ref))})</span>` : ''}</p>`)
    .join('');
};
const LVL = () => ({ error: L('Ошибка', 'Error'), warn: L('Внимание', 'Warning'), info: L('Справка', 'Note') });
/** Замечания листа справа: ошибки, предупреждения, затем справки; одинаковые — один раз. */
function messagesHtml(msgs) {
  const seen = new Set();
  const order = { error: 0, warn: 1, info: 2 };
  const list = msgs.filter((m) => {
    const k = `${m.level}|${m.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => (order[a.level] ?? 2) - (order[b.level] ?? 2));
  const lvl = LVL();
  return list.length
    ? list.map((m) => `<li class="${m.level === 'error' ? 'error' : m.level === 'warn' ? 'warn' : 'info'}"><span class="lvl">${esc(lvl[m.level] ?? lvl.info)}</span><span>${sub(m.text)}</span>${m.ref ? `<span class="ref">${esc(refText(m.ref))}</span>` : ''}</li>`).join('')
    : `<li class="info"><span class="lvl">${esc(L('Всё в порядке', 'All clear'))}</span><span>${esc(L('Замечаний к введённым данным нет.', 'No issues with the entered data.'))}</span></li>`;
}
/** Табло справа: главная величина листа (первый .plates-dose результата), отметка и пояснение. */
function displayLive(box) {
  const out = $('#br-disp');
  const mob = $('#br-mobile-value');
  if (!out) return;
  const pd = box?.querySelector('.plates-dose');
  const label = pd?.querySelector(':scope > span');
  const value = pd?.querySelector(':scope > b');
  if (!pd || !value) {
    out.innerHTML = `<div class="dose-row blocked"><div class="proto"><span>${esc(DISPLAY_TITLE()[sheet] ?? '')}</span></div><div class="dose-big">—</div><div class="secondary">${esc(L('Нет результата: заполните лист (см. замечания).', 'No result: complete the sheet (see Messages).'))}</div></div>`;
    if (mob) mob.textContent = '—';
    return;
  }
  const chip = pd.querySelector('.chip')?.outerHTML ?? '';
  const next = pd.nextElementSibling;
  const more = next?.matches('p.sub-hint') ? next.innerHTML : '';
  // число — крупно, единица — мелко («35,312 мГр/ч на 1 м»)
  const m = /^([−+-]?[\d\s,.]+(?:·10[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)?)\s*(.*)$/s.exec(value.innerHTML.trim());
  const big = m && m[2] ? `${m[1].trim()}<small>${m[2]}</small>` : value.innerHTML;
  out.innerHTML = `<div class="dose-row"><div class="proto"><span>${label?.innerHTML ?? ''}</span>${chip}</div><div class="dose-big">${big}</div>${more ? `<div class="secondary">${more}</div>` : ''}</div>`;
  if (mob) mob.innerHTML = `<b>${value.innerHTML}</b>`;
}
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
    [L('Среднее показание', 'Mean reading'), `${fmt(r.readings.mean, 4)} ${unitLabel(CURRENT_UNITS[form.w_unit])} (${r.readings.insertions > 1 ? L(`${r.readings.insertions} введения: ${r.readings.sets.map((x) => fmt(x.mean, 4)).join('; ')}; разброс средних ${fmt(r.readings.spread, 2)} %`, `${r.readings.insertions} insertions: ${r.readings.sets.map((x) => fmt(x.mean, 4)).join('; ')}; spread of the means ${fmt(r.readings.spread, 2)}%`) : `n = ${r.readings.n}, ${L('разброс', 'spread')} ${fmt(r.readings.relSd, 2)} %`})`],
    ['k_TP', fmt(f.kTP, 4), 'kTP'],
    f.kLeak !== 1 ? ['k_leak', fmt(f.kLeak, 4), 'kLeak'] : null,
    ['k_elec', fmt(f.kElec, 4), 'kElec'],
    ['k_pol', fmt(f.kPol, 4), 'kPol'],
    ['k_s', `${fmt(f.kS, 4)}${f.ks ? ` (${f.ks.preferLinear ? L('линейно', 'linear') : f.ks.equation})` : ''}`, 'kS'],
    ['k_sm,sm0', `${fmt(f.kSm, 3)}${f.ksmU ? L(` (+${fmt(f.ksmU, 0)} % к неопределённости)`, ` (+${fmt(f.ksmU, 0)}% to the uncertainty)`) : ''}`, 'kSm'],
    [L('Формула', 'Formula'), L('K̇ = N · I · k_TP · k_leak · k_elec · k_pol · k_s · k_sm,sm0 (TRS-492, ур. 21, 27)', 'K̇ = N · I · k_TP · k_leak · k_elec · k_pol · k_s · k_sm,sm0 (TRS-492, Eq. 21, 27)')],
  ];
  if (r.formalism === 'Dw') return wellDwResult(r, rows);
  const more = [L(`S_K = ${uText(r.U)}`, `S_K = ${uText(r.U)}`)];
  if (Number.isFinite(r.Uref)) more.push(L(`на дату сертификата ${uText(r.Uref)}`, `at the certificate date ${uText(r.Uref)}`));
  if (Number.isFinite(r.A)) more.push(L(`кажущаяся активность ${fmt(r.A, 2)} ГБк (справочно)`, `apparent activity ${fmt(r.A, 2)} GBq (for reference)`));
  if (r.compare) more.push(L(`по сертификату на дату измерения ${fmt(r.compare.expected / 1e3, 3)} мГр/ч`, `certificate value at the measurement date ${fmt(r.compare.expected / 1e3, 3)} mGy/h`));
  return `<div class="plates-dose"><span>${esc(L('ОМВК на время измерения', 'RAKR at the measurement time'))}</span><b>${esc(fmt(r.mGyh, 3))} ${esc(L('мГр/ч на 1 м', 'mGy/h at 1 m'))}</b>${chipHtml(r.compare)}</div>
    <p class="sub-hint">${more.map(sub).join('; ')}.</p>${factorRows(rows)}${msgHtml(r.messages)}`;
}

/** Результат при калибровке колодезной камеры в Ḋw (TRS-492, разд. 7.4, ур. 11, 14). */
function wellDwResult(r, rows) {
  const src = r.lambdaSrc;
  const more = [];
  if (Number.isFinite(r.U)) {
    more.push(L(`S_K = Ḋw,1/Λ = ${uText(r.U)} (ОМВК ${fmt(r.mGyh, 3)} мГр/ч на 1 м)`, `S_K = Ḋw,1/Λ = ${uText(r.U)} (RAKR ${fmt(r.mGyh, 3)} mGy/h at 1 m)`));
    if (Number.isFinite(r.Uref)) more.push(L(`на дату сертификата ${uText(r.Uref)}`, `at the certificate date ${uText(r.Uref)}`));
    if (r.compare) more.push(L(`по сертификату на дату измерения Λ · S_K = ${fmt((r.compare.expected * src.lambda) / 100, 4)} Гр/ч`, `certificate at the measurement date Λ · S_K = ${fmt((r.compare.expected * src.lambda) / 100, 4)} Gy/h`));
  }
  const rowsDw = rows.map((x) => {
    if (!x) return x;
    if (x[2] === 'kSm') return [L('k_Dw,sm,sm0', 'k_Dw,sm,sm0'), L('не применяется (TRS-492, разд. 7.4: данных нет)', 'not applied (TRS-492, Sec. 7.4: no data)'), 'kSm'];
    if (x[0] === L('Формула', 'Formula')) return [x[0], L('Ḋ_w,R = N_Dw · I · k_TP · k_leak · k_elec · k_pol · k_s (TRS-492, ур. 11, 14); S_K = Ḋ_w,1/Λ (TG-43U1, ур. 1)', 'Ḋ_w,R = N_Dw · I · k_TP · k_leak · k_elec · k_pol · k_s (TRS-492, Eq. 11, 14); S_K = Ḋ_w,1/Λ (TG-43U1, Eq. 1)')];
    return x;
  });
  if (src) rowsDw.push(['Λ', `${fmt(src.lambda, 3)} ${L('сГр·ч⁻¹·Ед⁻¹', 'cGy·h⁻¹·U⁻¹')} — ${src.name}`, 'w_src']);
  return `<div class="plates-dose"><span${tipAttr('Dw1w', { focus: true })}>${sub(L('Ḋ_w (1 см, 90°) на время измерения', 'Ḋ_w (1 cm, 90°) at the measurement time'))}</span><b>${esc(fmt(r.Dw, 4))} ${esc(L('Гр/ч', 'Gy/h'))}</b>${chipHtml(r.compare)}</div>
    ${more.length ? `<p class="sub-hint">${more.map(sub).join('; ')}.</p>` : ''}${factorRows(rowsDw)}${msgHtml(r.messages)}`;
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
  msgSink = [];
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
  try {
    box.innerHTML = results[sheet]() || `<p class="sub-hint">${esc(L('Нет результата: заполните лист (замечания — справа).', 'No result: complete the sheet (see Messages on the right).'))}</p>`;
    if (sheet === 'sweet') sweetChart();
    uncLive();
  } finally {
    const msgs = msgSink ?? [];
    msgSink = null;
    const list = $('#br-messages');
    if (list) list.innerHTML = messagesHtml(msgs);
  }
  if (rerender) {
    rerender = false;
    render();
    return;
  }
  displayLive(box);
  protLive();
  notifyUpdate($('#module-brachy'));
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
  if (t.dataset.full !== undefined || t.id === 'br_w_unit' || t.id === 'br_w_N_unit' || t.id === 'br_s_unit' || t.id === 'br_x_unit' || t.id === 'br_st_unit' || t.id === 'br_t_th') {
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
  } else if (b.dataset.br === 'st-runmean') {
    readForm();
    const rm = redundantRunningMean(getJournal(), { chamberId: form.j_well, before: form.st_date });
    if (!rm.n) return;
    Object.assign(form, { st_base: String(+rm.mean.toPrecision(6)).replace('.', L(',', '.')), st_base_date: rm.to, st_base_time: '', st_base_zone: '' });
    persist();
    render();
    status(L(`Исходное — текущее среднее записей журнала (${rm.n}): ${form.st_base}.`, `Baseline: running mean of ${rm.n} records, ${form.st_base}.`));
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
