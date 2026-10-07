// Вкладка «Инструменты»: перекрёстная калибровка рабочей камеры в пучке ⁶⁰Co, МВ фотонов или электронов
// (ядро — core/crosscal.js) и перенос результата в раздел «Камера и электрометр» нужной вкладки.
import { computeCrossCal, crossCalTargets, CC_DEFAULTS, CC_SERIES, normalizeCrossCal, ccChamberLabel, PP_PREFIX } from '../core/crosscal.js';
import { E_CHAMBERS, eChamberLabel } from '../core/electron-chambers.js';
import { CHAMBERS, chamberLabel, chamberNote } from '../core/chambers.js';
import { SAMPLES_CROSSCAL, SAMPLES_CROSSCAL_EN } from '../core/sample-crosscal.js';
import { L, getLang, refText } from '../core/i18n.js';
import { localizeDecimals } from './i18n.js';
import { PRESSURE_UNITS, NDW_UNITS, unitLabel } from '../core/units.js';
import { makeCombo, renderCells, readCells, setupCells, renderStaff, readStaff } from './widgets.js';
import {
  $, $$, localizeDemo, fmt, esc, today, makeStatus, copyText, downloadText, currentProtocol, renderOutputs, renderFlags, applyShowRules,
  armButton, renderSignBlock, printToPdf, fileStamp, checkFileFormat, compareWithFile, renderFileNote, versionText, renderNotesFlag, precisionNote,
  notifyUpdate,
} from './common.js';

const DRAFT_KEY = 'reference-dosimetry.crosscal.v1';
const FILE_TAG = { app: 'reference-dosimetry', module: 'crosscal', version: 1 };
const ROOT = () => document.getElementById('module-tools');
let setStatus = () => {};
export const crossCalStatus = (text) => setStatus(text);

/** Что делать с результатом по кнопке «Перенести»: задаёт app.js (переход на нужную вкладку). */
let onTransfer = null;
export const setCrossCalTransfer = (fn) => {
  onTransfer = fn;
};

const PROTO = {
  trs: { name: 'TRS-398 Rev.1' },
  tg51: { name: 'TG-51 + Report 385' },
};
const TAB_NAME = { co60: () => '⁶⁰Co', photons: () => L('МВ фотоны', 'MV photons'), electrons: () => L('Электроны', 'Electrons') };

// ------------------------------------------------------------ списки
const OTHER_OPTION = () => `<option value="OTHER">${L('Другая камера (k_Q вручную)…', 'Other chamber (k_Q entered manually)…')}</option>`;
const EMPTY_OPTION = () => `<option value="">${L('— выберите камеру —', '— select a chamber —')}</option>`;

/** Список камер для пучка: электроны — электронная база; фотоны — цилиндрические; ⁶⁰Co — цилиндрические и плоскопараллельные. */
function chamberOptions(type, who) {
  if (type === 'electrons') {
    const group = (t, label) =>
      `<optgroup label="${label}">${E_CHAMBERS.filter((c) => c.type === t)
        .map((c) => {
          const tags = [c.trsT20 ? L('TRS: табл. 20', 'TRS: Table 20') : null, c.trsT21 ? L('TRS: табл. 21', 'TRS: Table 21') : null, c.r385 ? 'Report 385' : null].filter(Boolean).join(', ');
          return `<option value="${c.id}">${esc(eChamberLabel(c))} [${tags}]</option>`;
        })
        .join('')}</optgroup>`;
    const cyl = group('cyl', L('Цилиндрические', 'Cylindrical'));
    const pp = group('pp', L('Плоскопараллельные', 'Plane-parallel'));
    return EMPTY_OPTION() + (who === 'ref' ? cyl + pp : pp + cyl) + OTHER_OPTION();
  }
  const groups = new Map();
  for (const c of CHAMBERS) {
    if (type === 'photons' && !c.trs && !c.trsTable && who === 'ref') continue; // опорной в фотонах нужна камера с k_Q TRS-398
    const g = L(`${c.maker} — цилиндрические`, `${c.maker} — cylindrical`);
    if (!groups.has(g)) groups.set(g, []);
    const tag = type === 'photons' ? (c.trsTable ? L(' [табл. 16]', ' [Table 16]') : c.trs ? L(' [ур. 34]', ' [Eq. 34]') : L(' [нет k_Q TRS-398]', ' [no TRS-398 k_Q]')) : '';
    groups.get(g).push(`<option value="${c.id}">${esc(chamberLabel(c))}${c.note ? ` — ${esc(chamberNote(c))}` : ''}${tag}</option>`);
  }
  let html = EMPTY_OPTION() + [...groups].map(([label, items]) => `<optgroup label="${label}">${items.join('')}</optgroup>`).join('');
  if (type === 'co60') {
    html += `<optgroup label="${L('Плоскопараллельные', 'Plane-parallel')}">${E_CHAMBERS.filter((c) => c.type === 'pp')
      .map((c) => `<option value="${PP_PREFIX}${c.id}">${esc(eChamberLabel(c))}</option>`)
      .join('')}</optgroup>`;
  }
  return html + OTHER_OPTION();
}

let shownType = null;
function fillChamberSelects(type) {
  for (const who of ['ref', 'fld']) {
    const sel = $(`#cc_${who}_model`);
    const keep = sel.value;
    sel.innerHTML = chamberOptions(type, who);
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '';
  }
  shownType = type;
}

function fillSelects(type) {
  fillChamberSelects(type);
  $('#cc_ref_ndw_unit').innerHTML = Object.entries(NDW_UNITS).map(([k, u]) => `<option value="${k}">${unitLabel(u)}</option>`).join('');
  $('#cc_P_unit').innerHTML = Object.entries(PRESSURE_UNITS).map(([k, u]) => `<option value="${k}">${unitLabel(u)}</option>`).join('');
}

const currentType = () => $('input[name="cc_beam_type"]:checked')?.value ?? 'electrons';
const sampleData = (type) => (getLang() === 'en' ? { ...SAMPLES_CROSSCAL[type], ...SAMPLES_CROSSCAL_EN[type] } : SAMPLES_CROSSCAL[type]);
const DEMO_INST = [SAMPLES_CROSSCAL.electrons.cc_institution, SAMPLES_CROSSCAL_EN.electrons.cc_institution];
const DEMO_MACH = Object.values(SAMPLES_CROSSCAL).map((s) => s.cc_machine).concat(Object.values(SAMPLES_CROSSCAL_EN).map((s) => s.cc_machine));
const isDemo = (d) => DEMO_INST.includes(d.cc_institution) && DEMO_MACH.includes(d.cc_machine);

// ------------------------------------------------------------ форма ↔ данные
const seriesBox = (key) => $(`#cc-sheet .cells[data-series="${key}"]`);

function readForm() {
  const data = {};
  for (const key of Object.keys(CC_DEFAULTS)) {
    if (key === 'protocol') data.protocol = currentProtocol();
    else if (key === 'cc_beam_type') data.cc_beam_type = currentType();
    else if (key === 'cc_staff') data.cc_staff = readStaff($('#cc-staff-list'));
    else if (CC_SERIES.includes(key)) data[key] = readCells(seriesBox(key));
    else {
      const el = document.getElementById(key);
      if (!el) continue;
      data[key] = el.type === 'checkbox' ? el.checked : el.value;
    }
  }
  return data;
}

function writeForm(values) {
  const data = normalizeCrossCal(values);
  const r = document.getElementById(`cc_beam_type_${data.cc_beam_type}`);
  if (r) r.checked = true;
  if (shownType !== data.cc_beam_type) fillChamberSelects(data.cc_beam_type);
  for (const [key, value] of Object.entries(data)) {
    if (key === 'protocol' || key === 'cc_beam_type') continue;
    if (key === 'cc_staff') renderStaff($('#cc-staff-list'), value, update);
    else if (CC_SERIES.includes(key)) renderCells(seriesBox(key), value);
    else {
      const el = document.getElementById(key);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!value;
      else el.value = value ?? '';
    }
  }
  // отдельные T и P для рабочей камеры — раскрыть, если заданы
  if (String(data.cc_T2 ?? '').trim() || String(data.cc_P2 ?? '').trim()) $('#cc-tp2').open = true;
  localizeDecimals(ROOT());
}

// ------------------------------------------------------------ сведения о камерах
function chamberInfo(c, type) {
  if (!c) return '';
  if (c.other) return type === 'co60' ? L('камера не из базы', 'chamber not in the database') : L('k_Q вводится вручную.', 'k_Q is entered manually.');
  const bits = [c.type === 'pp' ? L('плоскопараллельная', 'plane-parallel') : L('цилиндрическая', 'cylindrical')];
  if (type === 'electrons') {
    if (c.type === 'cyl' && Number.isFinite(c.trsRcylMm)) bits.push(L(`r_cyl = ${fmt(c.trsRcylMm, 1)} мм (табл. 4 TRS-398)`, `r_cyl = ${fmt(c.trsRcylMm, 1)} mm (TRS-398 Table 4)`));
    const src = [c.trsT20 ? L('TRS-398 табл. 20', 'TRS-398 Table 20') : null, c.trsT21 ? L('табл. 21', 'Table 21') : null, c.r385 ? 'Report 385' : null].filter(Boolean);
    bits.push(src.length ? L(`данные k_Q: ${src.join(', ')}`, `k_Q data: ${src.join(', ')}`) : L('данных k_Q для электронов нет', 'no electron k_Q data'));
  } else if (c.type === 'cyl') {
    if (Number.isFinite(c.rCavMm)) bits.push(L(`радиус полости ${fmt(c.rCavMm, 2)} мм`, `cavity radius ${fmt(c.rCavMm, 2)} mm`));
    if (c.lengthFromDb || (Number.isFinite(c.lengthMm) && !c.other)) bits.push(L(`длина полости ${fmt(c.lengthMm, 1)} мм`, `cavity length ${fmt(c.lengthMm, 1)} mm`));
    if (type === 'photons') bits.push(c.trsTable ? L('k_Q: табл. 16 и ур. (34)', 'k_Q: Table 16 and Eq. (34)') : c.trs ? L('k_Q: ур. (34)', 'k_Q: Eq. (34)') : L('k_Q TRS-398 нет', 'no TRS-398 k_Q'));
    if (c.sleeve) bits.push(L('не водонепроницаема — нужен чехол', 'not waterproof: a sleeve is needed'));
  }
  return bits.join(' · ');
}

function renderPositions(box, p, protocol) {
  if (!p) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML = `<h4>${L('Положение камеры', 'Chamber position')} (${PROTO[protocol].name})</h4><ul><li>${esc(p[protocol].text)}</li></ul>`;
}

function applyVisibility(data, r) {
  applyShowRules(ROOT(), data, r.protocolUsed);
  const type = r.type;
  $('#cc-ref-info').textContent = chamberInfo(r.ref, type);
  $('#cc-fld-info').textContent = chamberInfo(r.fld, type);
  renderPositions($('#cc-ref-positions'), r.positions.ref, r.protocolUsed);
  renderPositions($('#cc-fld-positions'), r.positions.fld, r.protocolUsed);
  for (const who of ['ref', 'fld']) {
    const c = who === 'ref' ? r.ref : r.fld;
    const sub = $(`#cc-${who}-length-sub`);
    const fromDb = c && !c.other ? CHAMBERS.find((x) => x.id === c.id)?.lengthMm : NaN;
    sub.textContent = Number.isFinite(fromDb)
      ? L(`пусто — из базы: ${fmt(fromDb, 1)} мм (табл. 4 TRS-398)`, `empty: from the database, ${fmt(fromDb, 1)} mm (TRS-398 Table 4)`)
      : L('в базе нет — введите по паспорту камеры', 'not in the database: enter it from the chamber specifications');
  }
  // подписи карточки k_Q опорной камеры: электроны — табл. 20 / прил. II; фотоны — табл. 16 / ур. (34)
  const ph = type === 'photons';
  $('#cc-kq-src').innerHTML = ph ? L('k<sub>Qcross</sub>, табл. 16', 'k<sub>Qcross</sub>, Table 16') : L('k<sub>Qcross,Q₀</sub>, табл. 20', 'k<sub>Qcross,Q₀</sub>, Table 20');
  $('#cc-opt-kq-table').textContent = ph ? L('по табл. 16 с интерполяцией по TPR20,10', 'from Table 16, interpolated in TPR20,10') : L('по табл. 20 с интерполяцией по R50', 'from Table 20, interpolated in R50');
  $('#cc-opt-kq-formula').textContent = ph ? L('по формуле (34) с параметрами табл. 45', 'by Eq. (34) with the parameters of Table 45') : L('по аппроксимации прил. II (табл. 47)', 'from the App. II fit (Table 47)');
  $('#cc-lbl-kq-formula').textContent = ph ? L('по формуле (34)', 'by Eq. (34)') : L('по аппроксимации', 'by the fit');
  $('#cc-lbl-kq-table').textContent = ph ? L('по табл. 16', 'from Table 16') : L('по таблице', 'from table');
}

// ------------------------------------------------------------ результат
const resultOf = (r) => (r.protocolUsed === 'tg51' ? { x: r.tg51, value: r.tg51.KN } : { x: r.trs, value: r.trs.N });
function symbol(r, text = false) {
  if (r.protocolUsed === 'tg51') return text ? '(k_Qecal·N_D,w)pp' : '(k<sub>Qecal</sub>·N<sub>D,w</sub>)<sub>pp</sub>';
  if (r.type === 'co60') return text ? 'N_D,w (60Co)' : 'N<sub>D,w</sub> (⁶⁰Co)';
  return text ? 'N_D,w,Qcross' : 'N<sub>D,w,Qcross</sub>';
}
function eqText(r) {
  if (r.protocolUsed === 'tg51') return L('ур. (5)', 'Eq. (5)');
  if (r.type === 'co60') return L('ур. (25), (32)', 'Eqs. (25), (32)');
  if (r.type === 'photons') return L('ур. (27)', 'Eq. (27)');
  return L('ур. (41)', 'Eq. (41)');
}
function protocolRef(r) {
  if (r.protocolUsed === 'tg51') return L('Report 385, разд. 5.3.2, ур. (5)', 'Report 385, Sec. 5.3.2, Eq. (5)');
  if (r.type === 'co60') return L('TRS-398, разд. 4.5.1, 5.5, 6.6, ур. (25), (32), (36)', 'TRS-398, Sec. 4.5.1, 5.5, 6.6, Eqs. (25), (32), (36)');
  if (r.type === 'photons') return L('TRS-398, разд. 4.5.2, ур. (26)–(27)', 'TRS-398, Sec. 4.5.2, Eqs. (26)–(27)');
  return L('TRS-398, разд. 7.6.1, ур. (41)', 'TRS-398, Sec. 7.6.1, Eq. (41)');
}
function qualityText(r, html = true) {
  const q = r.quality;
  const sub = (a, b) => (html ? `${a}<sub>${b}</sub>` : `${a}${b}`);
  if (r.type === 'electrons') return L(`${sub('R', '50')} = ${fmt(q.r50, 3)} г/см²`, `${sub('R', '50')} = ${fmt(q.r50, 3)} g/cm²`);
  if (r.type === 'photons') return `${sub('TPR', '20,10')} = ${fmt(q.tpr, 4)}${q.fff ? L(', БВФ', ', FFF') : ''}`;
  return L(`${sub('z', 'ref')} = ${fmt(q.zref, 0)} г/см²`, `${sub('z', 'ref')} = ${fmt(q.zref, 0)} g/cm²`);
}
function doseText(r, x, html = true) {
  const z = html ? 'z<sub>ref</sub>' : 'z_ref';
  return r.type === 'co60'
    ? L(`Мощность дозы по опорной камере на ${z}: ${fmt(x.DperMin, 4)} Гр/мин (без учёта ошибки таймера)`, `Dose rate from the reference chamber at ${z}: ${fmt(x.DperMin, 4)} Gy/min (timer error not included)`)
    : L(`Доза по опорной камере на ${z}: ${fmt(x.DperMU, 4)} Гр на 100 МЕ`, `Dose from the reference chamber at ${z}: ${fmt(x.DperMU, 4)} Gy per 100 MU`);
}

function snapshot(r) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const { x, value } = resultOf(r);
  if (x.blocked) return { protocol: r.protocolUsed, type: r.type, value: null };
  return { protocol: r.protocolUsed, type: r.type, value: num(value), r50: num(r.quality.r50), tpr: num(r.quality.tpr), kQref: num(r.protocolUsed === 'tg51' ? r.tg51.kQref : r.trs.kQ) };
}
const SNAP_CMP = { keys: ['value', 'r50', 'tpr', 'kQref'], main: 'value', get unit() { return L('Гр/нКл', 'Gy/nC'); } };

/** Кнопки переноса: для ⁶⁰Co — во вкладки «⁶⁰Co» и «МВ фотоны», для фотонов и электронов — в свою вкладку. */
function renderTransfer(r, ok) {
  const targets = crossCalTargets(r);
  const all = r.type === 'co60' ? ['co60', 'photons'] : [r.type];
  $('#cc-transfer-btns').innerHTML = all
    .map((t, i) => {
      const enabled = targets.some((x) => x.target === t);
      return `<button type="button" class="${i === 0 ? 'primary' : ''}" data-target="${t}"${enabled ? '' : ' disabled'}>${L(`Перенести во вкладку «${TAB_NAME[t]()}»`, `Transfer to the ${TAB_NAME[t]()} tab`)}</button>`;
    })
    .join('');
  let note;
  if (!ok) note = L('Кнопка станет доступна, когда коэффициент будет вычислен.', 'The button becomes available once the coefficient is calculated.');
  else if (r.type === 'electrons') {
    note = L(
      `Заполнит раздел 2 вкладки «Электроны»: камера, калибровка «перекрёстная», ${symbol(r)}${r.protocolUsed === 'trs' ? ', R<sub>50</sub> пучка' : ''}, T₀, P₀, электрометр.`,
      `Fills section 2 of the Electrons tab: chamber, cross-calibration, ${symbol(r)}${r.protocolUsed === 'trs' ? ', R<sub>50</sub> of the beam' : ''}, T₀, P₀, electrometer.`,
    );
  } else if (r.type === 'photons') {
    note = L(
      'Заполнит раздел 2 вкладки «МВ фотоны»: камера, калибровка «перекрёстная в пучке МВ фотонов», N<sub>D,w,Qcross</sub>, TPR<sub>20,10</sub> пучка, T₀, P₀, электрометр. Считать там нужно по TRS-398.',
      'Fills section 2 of the MV photons tab: chamber, cross-calibration in an MV photon beam, N<sub>D,w,Qcross</sub>, TPR<sub>20,10</sub> of the beam, T₀, P₀, electrometer. The calculation there must use TRS-398.',
    );
  } else {
    note = L(
      `Заполнит раздел 2 выбранной вкладки: камера, N<sub>D,w</sub> в ⁶⁰Co, T₀, P₀, электрометр; поправки лаборатории отмечены как внесённые.${r.fld?.type === 'pp' ? ' Во вкладку фотонов плоскопараллельную камеру перенести нельзя.' : ''}`,
      `Fills section 2 of the selected tab: chamber, N<sub>D,w</sub> in ⁶⁰Co, T₀, P₀, electrometer; the laboratory corrections are marked as applied.${r.fld?.type === 'pp' ? ' A plane-parallel chamber cannot be transferred to the photons tab.' : ''}`,
    );
  }
  $('#cc-transfer-note').innerHTML = note;
}

function renderReadout(r, data) {
  const { x, value } = resultOf(r);
  const ok = !x.blocked && Number.isFinite(value);
  const fldName = r.fld ? `${esc(ccChamberLabel(r.fld))}${data.cc_fld_serial ? `, ${L('№', 'S/N')} ${esc(data.cc_fld_serial)}` : ''}` : '—';
  const secondary = ok
    ? [
        L(`Рабочая камера: ${fldName}`, `Field chamber: ${fldName}`),
        L(`Пучок ${esc(data.cc_beam || '—')}: ${qualityText(r)}`, `Beam ${esc(data.cc_beam || '—')}: ${qualityText(r)}`),
        L(`T₀ = ${esc(data.cc_T0)} °C, P₀ = ${esc(data.cc_P0)} кПа; k<sub>elec</sub> = ${esc(data.cc_fld_kelec)}`, `T₀ = ${esc(data.cc_T0)} °C, P₀ = ${esc(data.cc_P0)} kPa; k<sub>elec</sub> = ${esc(data.cc_fld_kelec)}`),
        doseText(r, x),
      ].join('<br>')
    : L('Исправьте ошибки из списка замечаний', 'Correct the errors listed under Messages');
  $('#cc-result').innerHTML = `<div class="dose-row ${ok ? '' : 'blocked'}">
    <div class="proto"><span>${PROTO[r.protocolUsed].name} · ${symbol(r)}</span><span>${eqText(r)}</span></div>
    <div class="dose-big">${ok ? fmt(value, 5) : '—'}<small>${L('Гр/нКл', 'Gy/nC')}</small></div>
    <div class="secondary">${secondary}</div>
  </div>`;
  renderTransfer(r, ok);

  const mv = $('#cc-mobile-value');
  if (ok) mv.innerHTML = `${r.protocolUsed === 'tg51' ? '(k·N)pp' : r.type === 'co60' ? 'N<sub>D,w</sub>' : 'N<sub>Qcross</sub>'}: <b>${fmt(value, 5)}</b> ${L('Гр/нКл', 'Gy/nC')}`;
  else {
    const n = r.messages.filter((m) => m.level === 'error').length;
    mv.textContent = n ? L(`Ошибок: ${n}`, `Errors: ${n}`) : '—';
  }

  const lvlName = { error: L('Ошибка', 'Error'), warn: L('Внимание', 'Warning'), info: L('Справка', 'Note') };
  const scopeName = { common: '', trs: 'TRS-398 · ', tg51: 'TG-51 · ' };
  const list = r.messages.filter((m) => m.scope === 'common' || m.scope === r.protocolUsed);
  $('#cc-messages').innerHTML = list.length
    ? list.map((m) => `<li class="${m.level}"><span class="lvl">${scopeName[m.scope]}${lvlName[m.level]}</span><span>${esc(m.text)}</span>${m.ref ? `<span class="ref">${esc(refText(m.ref))}</span>` : ''}</li>`).join('')
    : `<li class="info"><span class="lvl">${L('Всё в порядке', 'All clear')}</span><span>${L('Замечаний к введённым данным нет.', 'No issues with the entered data.')}</span></li>`;

  // таблица: опорная и рабочая камеры рядом
  const i = r.inputs;
  const tg = r.protocolUsed === 'tg51';
  const a = tg ? r.tg51.ref || {} : r.trs.ref || {};
  const b = tg ? r.tg51.fld || {} : r.trs.fld || {};
  const v = (val, d) => (Number.isFinite(val) ? fmt(val, d) : '—');
  const rows = [[L('Среднее показание M₁, нКл', 'Mean reading M₁, nC'), v(i.ref.m1raw, 4), v(i.fld.m1raw, 4)]];
  if (data.cc_monitor) {
    rows.push([L('Среднее M₁/M<sub>монитор</sub>', 'Mean M₁/M<sub>monitor</sub>'), v(i.ref.monitor?.ratio, 5), v(i.fld.monitor?.ratio, 5)]);
    rows.push([L('M₁ по монитору, нКл', 'M₁ normalized to the monitor, nC'), v(i.ref.m1, 4), v(i.fld.m1, 4)]);
  }
  rows.push(
    [tg ? 'P<sub>TP</sub>' : 'k<sub>TP</sub>', v(tg ? a.PTP : a.kTP, 4), v(tg ? b.PTP : b.kTP, 4)],
    [tg ? 'P<sub>elec</sub>' : 'k<sub>elec</sub>', v(tg ? a.Pelec : a.kelec, 4), v(tg ? b.Pelec : b.kelec, 4)],
    [tg ? 'P<sub>pol</sub>' : 'k<sub>pol</sub>', v(tg ? a.Ppol : a.kpol, 4), v(tg ? b.Ppol : b.kpol, 4)],
    [tg ? 'P<sub>ion</sub>' : 'k<sub>s</sub>', v(tg ? a.Pion : a.ks, 4), v(tg ? b.Pion : b.ks, 4)],
  );
  if (r.quality.fff) rows.push(['k<sub>vol</sub>', v(a.kvol, 4), v(b.kvol, 4)]);
  rows.push([L('M с поправками, нКл', 'Corrected M, nC'), v(a.M, 4), v(b.M, 4)]);
  if (tg) rows.push([L('Поправка на качество', 'Beam quality correction'), `<i>k<sub>Q</sub></i> ${v(r.tg51.kQref, 4)}`, `<i>k′<sub>Q</sub></i> ${v(r.tg51.kQprimeFld, 4)}`]);
  else if (r.type === 'electrons') rows.push([L('Поправка на качество', 'Beam quality correction'), `<i>k<sub>Qcross,Q₀</sub></i> ${v(r.trs.kQ, 4)}`, '—']);
  else if (r.type === 'photons') rows.push([L('Поправка на качество', 'Beam quality correction'), `<i>k<sub>Qcross</sub></i> ${v(r.trs.kQ, 4)}`, `<i>k<sub>Qcross</sub></i> ${v(r.trs.kQcrossField, 4)}`]);
  rows.push([L('N<sub>D,w</sub> (⁶⁰Co), Гр/нКл', 'N<sub>D,w</sub> (⁶⁰Co), Gy/nC'), v(i.ndwCert, 5), '—']);
  if (Number.isFinite(i.klab) && Math.abs(i.klab - 1) > 1e-12) rows.push([L('k<sub>лаб</sub>', 'k<sub>lab</sub>'), v(i.klab, 4), '—']);
  const totals = [
    [L('Отношение M<sub>опорн</sub>/M<sub>рабоч</sub>', 'Ratio M<sub>ref</sub>/M<sub>field</sub>'), v(x.ratio, 5)],
    r.type === 'co60'
      ? [L('D<sub>w</sub>(z<sub>ref</sub>) по опорной камере, Гр/мин', 'D<sub>w</sub>(z<sub>ref</sub>) from the reference chamber, Gy/min'), v(x.DperMin, 4)]
      : [L('D<sub>w</sub>(z<sub>ref</sub>) по опорной камере, Гр на 100 МЕ', 'D<sub>w</sub>(z<sub>ref</sub>) from the reference chamber, Gy per 100 MU'), v(x.DperMU, 4)],
    [`${symbol(r)}, ${L('Гр/нКл', 'Gy/nC')}`, x.blocked ? '—' : v(value, 5), 'total'],
  ];
  $('#cc-factors').innerHTML =
    `<thead><tr><th>${L('Величина', 'Quantity')}</th><th>${L('Опорная', 'Reference')}</th><th>${L('Рабочая', 'Field')}</th></tr></thead><tbody>` +
    rows.map(([k, p, q]) => `<tr><td>${k}</td><td class="v">${p}</td><td class="v">${q}</td></tr>`).join('') +
    `<tr class="group"><td colspan="3">${PROTO[r.protocolUsed].name}, ${eqText(r)}</td></tr>` +
    totals.map(([k, p, cls]) => `<tr class="${cls || ''}"><td>${k}</td><td class="v" colspan="2">${p}</td></tr>`).join('') +
    '</tbody>';
}

// ------------------------------------------------------------ протокол текстом
function reportText(data, r) {
  const out = [];
  const line = (k, val) => out.push(`${k}: ${val}`);
  const cells = (arr) => (Array.isArray(arr) ? arr.filter((s) => String(s).trim() !== '').join('; ') : arr);
  const q = r.quality;
  const i = r.inputs;
  const tg = r.protocolUsed === 'tg51';
  const mean = L('среднее', 'mean');
  const beamName = { co60: L('ПУЧОК ⁶⁰Co', '⁶⁰Co BEAM'), photons: L('ПУЧОК МВ ФОТОНОВ', 'MV PHOTON BEAM'), electrons: L('ПУЧОК ЭЛЕКТРОНОВ', 'ELECTRON BEAM') }[r.type];
  out.push(L(`ПРОТОКОЛ ПЕРЕКРЁСТНОЙ КАЛИБРОВКИ ИОНИЗАЦИОННОЙ КАМЕРЫ — ${beamName}`, `IONIZATION CHAMBER CROSS-CALIBRATION REPORT — ${beamName}`));
  line(L('Протокол', 'Protocol'), `${PROTO[r.protocolUsed].name}, ${protocolRef(r)}`);
  line(L('Калькулятор', 'Calculator'), versionText());
  line(L('Учреждение', 'Institution'), data.cc_institution || '—');
  line(L('Аппарат', 'Machine'), data.cc_machine || '—');
  line(L('Пучок', 'Beam'), data.cc_beam || '—');
  line(L('Дата', 'Date'), data.cc_date || '—');
  line(L('Измерения выполнили', 'Measured by'), data.cc_staff.filter((s) => s.trim()).join(', ') || '—');
  if (r.type === 'electrons') {
    line(
      L('Качество пучка', 'Beam quality'),
      L(
        `${q.method === 'i50' ? `R50,ion = ${data.cc_i50} г/см²; ` : ''}R50 = ${fmt(q.r50, 3)} г/см²; z_ref = ${fmt(q.zref, 3)} г/см²; E0 ≈ ${fmt(q.E0, 1)} МэВ`,
        `${q.method === 'i50' ? `R50,ion = ${data.cc_i50} g/cm²; ` : ''}R50 = ${fmt(q.r50, 3)} g/cm²; z_ref = ${fmt(q.zref, 3)} g/cm²; E0 ≈ ${fmt(q.E0, 1)} MeV`,
      ),
    );
  } else if (r.type === 'photons') {
    line(L('Качество пучка', 'Beam quality'), `TPR20,10 = ${fmt(q.tpr, 4)}${q.method === 'pdd2010' ? ` (PDD(20)/PDD(10) = ${data.cc_pdd20}/${data.cc_pdd10})` : ''}; z_ref = 10 ${L('г/см²', 'g/cm²')}${q.fff ? L(`; БВФ, РИД для k_vol ${data.cc_sdd} см`, `; FFF, SDD for k_vol ${data.cc_sdd} cm`) : ''}`);
  } else {
    line(L('Геометрия', 'Geometry'), L(`z_ref = ${data.cc_co_zref} г/см², поле 10 × 10 см`, `z_ref = ${data.cc_co_zref} g/cm², 10 × 10 cm field`));
  }
  const method = data.cc_method === 'side' ? L('бок о бок с перестановкой камер', 'side by side with the chambers swapped') : L('метод замещения', 'substitution method');
  line(
    L('Облучение', 'Irradiation'),
    r.type === 'co60'
      ? L(`${data.cc_time} мин для каждой камеры (${method})`, `${data.cc_time} min for each chamber (${method})`)
      : L(`${data.cc_mu} МЕ для каждой камеры (${method})`, `${data.cc_mu} MU for each chamber (${method})`),
  );
  if (data.cc_monitor) line(L('Внешний монитор', 'External monitor'), L('показания M₁ поделены на показания монитора', 'readings M₁ divided by the monitor readings'));
  line(
    L('Условия', 'Conditions'),
    `T = ${data.cc_T} °C, P = ${data.cc_P} ${unitLabel(PRESSURE_UNITS[data.cc_P_unit])}${String(data.cc_H ?? '').trim() ? L(`, относительная влажность ${data.cc_H} %`, `, relative humidity ${data.cc_H} %`) : ''}` +
      (i.separateTP ? L(`; для рабочей камеры T = ${data.cc_T2 || data.cc_T} °C, P = ${data.cc_P2 || data.cc_P}`, `; for the field chamber T = ${data.cc_T2 || data.cc_T} °C, P = ${data.cc_P2 || data.cc_P}`) : ''),
  );
  line(L('Стандартные условия', 'Reference conditions'), `T0 = ${data.cc_T0} °C, P0 = ${data.cc_P0} ${L('кПа', 'kPa')}`);
  for (const who of ['ref', 'fld']) {
    const c = who === 'ref' ? r.ref : r.fld;
    const p = (k) => data[`cc_${who}_${k}`];
    const x = tg ? r.tg51[who] || {} : r.trs[who] || {};
    const rd = i[who];
    out.push('');
    out.push(who === 'ref' ? L('— Опорная камера —', '— Reference chamber —') : L('— Рабочая камера —', '— Field chamber —'));
    line(L('Камера', 'Chamber'), c ? `${ccChamberLabel(c)} (${c.type === 'pp' ? L('плоскопараллельная', 'plane-parallel') : L('цилиндрическая', 'cylindrical')}), ${L('№', 'S/N')} ${p('serial') || '—'}` : '—');
    if (r.positions[who]) line(L('Положение', 'Position'), r.positions[who][r.protocolUsed].text);
    if (who === 'ref') {
      line('N_D,w (⁶⁰Co)', `${data.cc_ref_ndw} ${unitLabel(NDW_UNITS[data.cc_ref_ndw_unit])} (= ${fmt(i.ndwCert, 6)} ${L('Гр/нКл', 'Gy/nC')})${Number.isFinite(i.klab) && Math.abs(i.klab - 1) > 1e-12 ? L(`; k_лаб = ${fmt(i.klab, 4)}`, `; k_lab = ${fmt(i.klab, 4)}`) : ''}`);
    }
    line(L('Электрометр', 'Electrometer'), `${p('el_model') || '—'}, ${L('№', 'S/N')} ${p('el_serial') || '—'}, k_elec = ${p('kelec')}`);
    line(L('Напряжения', 'Voltages'), L(`V1 = ${p('V1')} В, V2 = ${p('V2')} В, обычная полярность ${p('polarity')}`, `V1 = ${p('V1')} V, V2 = ${p('V2')} V, normal polarity ${p('polarity')}`));
    line(L('M(V1, обычная), нКл', 'M(V1, normal), nC'), `${cells(p('M1'))} → ${mean} ${fmt(Math.abs(rd.M1.mean), 4)}`);
    if (data.cc_monitor) line(L('Монитор при M(V1)', 'Monitor at M(V1)'), `${cells(p('Mem'))} → M1/M_${L('монитор', 'monitor')} = ${fmt(rd.monitor?.ratio, 5)}`);
    line(L('M(V1, обратная), нКл', 'M(V1, opposite), nC'), `${cells(p('Mopp'))} → ${mean} ${fmt(Math.abs(rd.Mopp.mean), 4)}`);
    line(L('M(V2), нКл', 'M(V2), nC'), `${cells(p('M2'))} → ${mean} ${fmt(Math.abs(rd.M2.mean), 4)}`);
    out.push(
      tg
        ? `P_TP = ${fmt(x.PTP)}; P_elec = ${fmt(x.Pelec)}; P_pol = ${fmt(x.Ppol)}; P_ion = ${fmt(x.Pion)}; ${L('M с поправками', 'corrected M')} = ${fmt(x.M)} ${L('нКл', 'nC')}`
        : `k_TP = ${fmt(x.kTP)}; k_elec = ${fmt(x.kelec)}; k_pol = ${fmt(x.kpol)}; k_s = ${fmt(x.ks)}${q.fff ? `; k_vol = ${fmt(x.kvol)}` : ''}; ${L('M с поправками', 'corrected M')} = ${fmt(x.M)} ${L('нКл', 'nC')}`,
    );
    if (who === 'ref') {
      if (tg) out.push(`k_Q = k′_Q·k_Qecal = ${fmt(r.tg51.kQref)} (${r.tg51.kQrefSource || '—'})`);
      else if (r.type === 'electrons') out.push(`k_Qcross,Q0 = ${fmt(r.trs.kQ)} (${r.trs.kQSource || '—'})`);
      else if (r.type === 'photons') out.push(`k_Qcross = ${fmt(r.trs.kQ)} (${r.trs.kQSource || '—'})`);
    } else if (tg) out.push(`k′_Q = ${fmt(r.tg51.kQprimeFld)} (${r.tg51.kQprimeFldSource || '—'})`);
    else if (r.type === 'photons' && Number.isFinite(r.trs.kQcrossField)) out.push(L(`k_Qcross рабочей камеры (для справки) = ${fmt(r.trs.kQcrossField)}`, `k_Qcross of the field chamber (for reference) = ${fmt(r.trs.kQcrossField)}`));
  }
  out.push('');
  const { x, value } = resultOf(r);
  out.push(L('— Результат —', '— Result —'));
  if (x.blocked) out.push(L('РЕЗУЛЬТАТ НЕ ВЫЧИСЛЕН: есть ошибки ввода (см. замечания).', 'RESULT NOT CALCULATED: there are input errors (see Messages).'));
  else {
    out.push(L(`M_опорн/M_рабоч = ${fmt(x.ratio, 5)}`, `M_ref/M_field = ${fmt(x.ratio, 5)}`));
    out.push(doseText(r, x, false));
    const at = r.type === 'electrons' && !tg ? L(` при R50 = ${fmt(q.r50, 3)} г/см²`, ` at R50 = ${fmt(q.r50, 3)} g/cm²`) : r.type === 'photons' ? L(` при TPR20,10 = ${fmt(q.tpr, 4)}`, ` at TPR20,10 = ${fmt(q.tpr, 4)}`) : '';
    out.push(`${symbol(r, true)} = ${fmt(value, 5)} ${L('Гр/нКл', 'Gy/nC')}${at}`);
  }
  const msgs = r.messages.filter((m) => m.level !== 'info' && (m.scope === 'common' || m.scope === r.protocolUsed));
  if (msgs.length) {
    out.push('', L('Замечания:', 'Messages:'));
    msgs.forEach((m) => out.push(`- ${m.text}${m.ref ? ` [${refText(m.ref)}]` : ''}`));
  }
  if (data.cc_notes) out.push('', `${L('Примечания', 'Notes')}: ${data.cc_notes}`);
  out.push('', precisionNote(false));
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

export function importCrossCal(obj) {
  if (!obj || obj.app !== FILE_TAG.app || typeof obj.form !== 'object') throw new Error(L('Это не файл калькулятора референсной дозиметрии.', 'This is not a reference dosimetry calculator file.'));
  checkFileFormat(obj, FILE_TAG);
  if (obj.module !== FILE_TAG.module) {
    throw new Error(L('Это файл другого раздела: откройте его на соответствующей вкладке или вставьте данные через Ctrl+V — нужная вкладка откроется сама.', 'This file belongs to another section: open it on the corresponding tab, or paste the data with Ctrl+V — the right tab will open automatically.'));
  }
  writeForm(obj.form);
  openedFile = obj;
  update();
}

// ------------------------------------------------------------ цикл
let current = { data: null, result: null };
let openedFile = null;
function update() {
  const data = readForm();
  const result = computeCrossCal(data);
  current = { data: result.form, result };
  applyVisibility(result.form, result);
  renderOutputs(ROOT(), result);
  renderFlags(ROOT(), result.flags, seriesBox);
  renderReadout(result, result.form);
  $('#cc-demo-flag').hidden = !isDemo(data);
  const demoNotes = [...Object.values(SAMPLES_CROSSCAL).map((s) => s.cc_notes), ...Object.values(SAMPLES_CROSSCAL_EN).map((s) => s.cc_notes)];
  renderNotesFlag($('#cc-notes-flag'), data.cc_notes, demoNotes, isDemo(data));
  renderFileNote($('#cc-file-note'), openedFile ? compareWithFile(openedFile, snapshot(result), SNAP_CMP) : null);
  saveDraft(result.form);
  renderSignBlock($('#cc-sign'), result.form.cc_staff, false);
  notifyUpdate(ROOT());
}

function refreshForLang() {
  const kept = $$('select', ROOT()).map((sel) => [sel, sel.value]);
  fillSelects(currentType());
  for (const [sel, val] of kept) if ([...sel.options].some((o) => o.value === val)) sel.value = val;
  $$('#cc-sheet .cells').forEach((box) => renderCells(box, readCells(box)));
  renderStaff($('#cc-staff-list'), readStaff($('#cc-staff-list')), update);
  const t = currentType();
  localizeDemo(SAMPLES_CROSSCAL[t], SAMPLES_CROSSCAL_EN[t]);
  localizeDecimals(ROOT());
  update();
}

export function initCrossCal() {
  setStatus = makeStatus($('#cc-status'));
  const draft = loadDraft();
  const start = draft ? normalizeCrossCal(draft) : sampleData('electrons');
  fillSelects(start.cc_beam_type);
  $$('#cc-sheet .cells').forEach((box) => setupCells(box, update));
  $$('#cc-sheet > section .combo').forEach((c) => makeCombo(c));

  writeForm(start);
  localizeDemo(SAMPLES_CROSSCAL[start.cc_beam_type], SAMPLES_CROSSCAL_EN[start.cc_beam_type]);
  update();
  if (!draft) setStatus(L('Загружен демонстрационный пример. Нажмите «Очистить», чтобы ввести свои данные.', 'Demo example loaded. Click "Clear" to enter your own data.'));

  const sheet = $('#cc-sheet');
  sheet.addEventListener('input', () => {
    openedFile = null;
    update();
  });
  sheet.addEventListener('change', (e) => {
    openedFile = null;
    // пучок сменился: другие списки камер; если форма — демонстрационный пример, загрузить пример для этого пучка
    if (e.target.name === 'cc_beam_type') {
      const type = currentType();
      if (isDemo(readForm())) writeForm(sampleData(type));
      else fillChamberSelects(type);
    }
    update();
  });
  document.addEventListener('change', (e) => {
    if (e.target.name === 'protocol') update();
  });
  document.addEventListener('langchange', refreshForLang);

  $('#cc-btn-add-staff').addEventListener('click', () => {
    const cur = readStaff($('#cc-staff-list'));
    cur.push('');
    renderStaff($('#cc-staff-list'), cur, update);
    $$('#cc-staff-list .staff-input').at(-1).focus();
    update();
  });
  for (const b of $$('[data-cc-preset]')) {
    b.addEventListener('click', () => {
      const [t0, p0] = b.dataset.ccPreset.split('|');
      $('#cc_T0').value = t0;
      $('#cc_P0').value = p0;
      localizeDecimals(ROOT());
      update();
    });
  }

  $('#cc-transfer-btns').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-target]');
    if (!b || b.disabled) return;
    const t = crossCalTargets(current.result).find((x) => x.target === b.dataset.target);
    if (t) onTransfer?.(t.target, t.patch, current.result);
  });

  $('#cc-btn-sample').addEventListener('click', () => {
    openedFile = null;
    writeForm(sampleData(currentType()));
    update();
    setStatus(L('Загружен демонстрационный пример (вымышленные данные).', 'Demo example loaded (fictitious data).'));
  });
  armButton($('#cc-btn-clear'), () => L('Очистить', 'Clear'), () => L('Точно очистить?', 'Clear everything?'), () => {
    writeForm({ ...CC_DEFAULTS, cc_beam_type: currentType(), cc_date: today() });
    openedFile = null;
    update();
    setStatus(L('Форма очищена.', 'Form cleared.'));
  });

  const payload = () => JSON.stringify({ ...FILE_TAG, ...fileStamp(snapshot(current.result)), savedAt: new Date().toISOString(), form: current.data }, null, 2);
  $('#cc-btn-save').addEventListener('click', () => {
    const name = [current.data.cc_machine, current.data.cc_beam, current.data.cc_date].filter(Boolean).join('_').replace(/[^\p{L}\p{N}_.-]+/gu, '-') || 'crosscal';
    downloadText(payload(), `crosscal_${name}.json`);
    setStatus(L('Файл сохранён.', 'File saved.'));
  });
  $('#cc-btn-load').addEventListener('click', () => $('#cc-file-input').click());
  $('#cc-file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      importCrossCal(JSON.parse(await file.text()));
      setStatus(L(`Открыт файл ${file.name}.`, `Opened file ${file.name}.`));
    } catch (err) {
      setStatus(err instanceof SyntaxError ? L('Файл повреждён: это не JSON.', 'The file is damaged: it is not JSON.') : err.message);
    }
    e.target.value = '';
  });
  $('#cc-btn-copy-json').addEventListener('click', () =>
    copyText(payload(), L('Данные скопированы. Чтобы вставить их обратно, нажмите Ctrl+V на странице вне полей ввода.', 'Data copied. To paste them back, press Ctrl+V on the page outside the input fields.'), setStatus),
  );
  $('#cc-btn-copy-report').addEventListener('click', () => copyText(reportText(current.data, current.result), L('Протокол скопирован в буфер обмена.', 'Report copied to the clipboard.'), setStatus));
  $('#cc-btn-pdf').addEventListener('click', () => printToPdf([L('Перекрёстная калибровка', 'Cross-calibration'), current.data.cc_machine, current.data.cc_beam, current.data.cc_date].filter(Boolean).join('_'), setStatus));
  $('#cc-btn-print').addEventListener('click', () => window.print());
}
