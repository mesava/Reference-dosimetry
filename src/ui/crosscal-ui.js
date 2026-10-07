// Вкладка «Инструменты»: перекрёстная калибровка рабочей камеры в пучке электронов (ядро — core/crosscal.js).
import { computeCrossCal, crossCalTransfer, CC_DEFAULTS, CC_SERIES, normalizeCrossCal, ccChamberLabel } from '../core/crosscal.js';
import { E_CHAMBERS, eChamberLabel } from '../core/electron-chambers.js';
import { SAMPLE_CROSSCAL, SAMPLE_CROSSCAL_EN } from '../core/sample-crosscal.js';
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

/** Что делать с результатом по кнопке «Перенести»: задаёт app.js (переход на вкладку «Электроны»). */
let onTransfer = null;
export const setCrossCalTransfer = (fn) => {
  onTransfer = fn;
};

const PROTO = {
  trs: { name: 'TRS-398 Rev.1' },
  tg51: { name: 'TG-51 + Report 385' },
};

// ------------------------------------------------------------ списки
function chamberOptions(first) {
  const group = (type, label) => {
    const list = E_CHAMBERS.filter((c) => c.type === type);
    return `<optgroup label="${label}">${list
      .map((c) => {
        const tags = [c.trsT20 ? L('TRS: табл. 20', 'TRS: Table 20') : null, c.trsT21 ? L('TRS: табл. 21', 'TRS: Table 21') : null, c.r385 ? 'Report 385' : null].filter(Boolean).join(', ');
        return `<option value="${c.id}">${esc(eChamberLabel(c))} [${tags}]</option>`;
      })
      .join('')}</optgroup>`;
  };
  const cyl = group('cyl', L('Цилиндрические', 'Cylindrical'));
  const pp = group('pp', L('Плоскопараллельные', 'Plane-parallel'));
  return (
    `<option value="">${L('— выберите камеру —', '— select a chamber —')}</option>` +
    (first === 'cyl' ? cyl + pp : pp + cyl) +
    `<option value="OTHER">${L('Другая камера (k_Q вручную)…', 'Other chamber (k_Q entered manually)…')}</option>`
  );
}

function fillSelects() {
  $('#cc_ref_model').innerHTML = chamberOptions('cyl');
  $('#cc_fld_model').innerHTML = chamberOptions('pp');
  $('#cc_ref_ndw_unit').innerHTML = Object.entries(NDW_UNITS).map(([k, u]) => `<option value="${k}">${unitLabel(u)}</option>`).join('');
  $('#cc_P_unit').innerHTML = Object.entries(PRESSURE_UNITS).map(([k, u]) => `<option value="${k}">${unitLabel(u)}</option>`).join('');
}

const sampleData = () => (getLang() === 'en' ? { ...SAMPLE_CROSSCAL, ...SAMPLE_CROSSCAL_EN } : SAMPLE_CROSSCAL);
const isDemo = (d) => [SAMPLE_CROSSCAL.cc_institution, SAMPLE_CROSSCAL_EN.cc_institution].includes(d.cc_institution) && [SAMPLE_CROSSCAL.cc_machine, SAMPLE_CROSSCAL_EN.cc_machine].includes(d.cc_machine);

// ------------------------------------------------------------ форма ↔ данные
const seriesBox = (key) => $(`#cc-sheet .cells[data-series="${key}"]`);

function readForm() {
  const data = {};
  for (const key of Object.keys(CC_DEFAULTS)) {
    if (key === 'protocol') data.protocol = currentProtocol();
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
  for (const [key, value] of Object.entries(data)) {
    if (key === 'protocol') continue;
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
function chamberInfo(c) {
  if (!c) return '';
  if (c.other) return L('k_Q вводится вручную.', 'k_Q is entered manually.');
  const bits = [c.type === 'pp' ? L('плоскопараллельная', 'plane-parallel') : L('цилиндрическая', 'cylindrical')];
  if (c.type === 'cyl' && Number.isFinite(c.trsRcylMm)) bits.push(L(`r_cyl = ${fmt(c.trsRcylMm, 1)} мм (табл. 4 TRS-398)`, `r_cyl = ${fmt(c.trsRcylMm, 1)} mm (TRS-398 Table 4)`));
  const src = [c.trsT20 ? L('TRS-398 табл. 20', 'TRS-398 Table 20') : null, c.trsT21 ? L('табл. 21', 'Table 21') : null, c.r385 ? 'Report 385' : null].filter(Boolean);
  bits.push(src.length ? L(`данные k_Q: ${src.join(', ')}`, `k_Q data: ${src.join(', ')}`) : L('данных k_Q для электронов нет', 'no electron k_Q data'));
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
  applyShowRules(ROOT(), data, data.protocol);
  $('#cc-ref-info').textContent = chamberInfo(r.ref);
  $('#cc-fld-info').textContent = chamberInfo(r.fld);
  renderPositions($('#cc-ref-positions'), r.positions.ref, data.protocol);
  renderPositions($('#cc-fld-positions'), r.positions.fld, data.protocol);
}

// ------------------------------------------------------------ результат
const resultOf = (r) => (r.protocol === 'tg51' ? { x: r.tg51, value: r.tg51.KN } : { x: r.trs, value: r.trs.N });
const symbol = (protocol) => (protocol === 'tg51' ? '(k<sub>Qecal</sub>·N<sub>D,w</sub>)<sub>pp</sub>' : 'N<sub>D,w,Qcross</sub>');
const symbolText = (protocol) => (protocol === 'tg51' ? '(k_Qecal·N_D,w)pp' : 'N_D,w,Qcross');

function snapshot(r) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const { x, value } = resultOf(r);
  if (x.blocked) return { protocol: r.protocol, value: null };
  return { protocol: r.protocol, value: num(value), r50: num(r.quality.r50), kQref: num(r.protocol === 'tg51' ? r.tg51.kQref : r.trs.kQ) };
}
const SNAP_CMP = { keys: ['value', 'r50', 'kQref'], main: 'value', get unit() { return L('Гр/нКл', 'Gy/nC'); } };

function renderReadout(r, data) {
  const { x, value } = resultOf(r);
  const ok = !x.blocked && Number.isFinite(value);
  const fldName = r.fld ? `${esc(ccChamberLabel(r.fld))}${data.cc_fld_serial ? `, ${L('№', 'S/N')} ${esc(data.cc_fld_serial)}` : ''}` : '—';
  const secondary = ok
    ? [
        L(`Рабочая камера: ${fldName}`, `Field chamber: ${fldName}`),
        L(`Пучок ${esc(data.cc_beam || '—')}: R<sub>50</sub> = ${fmt(r.quality.r50, 3)} г/см²`, `Beam ${esc(data.cc_beam || '—')}: R<sub>50</sub> = ${fmt(r.quality.r50, 3)} g/cm²`),
        L(`T₀ = ${esc(data.cc_T0)} °C, P₀ = ${esc(data.cc_P0)} кПа; k<sub>elec</sub> = ${esc(data.cc_fld_kelec)}`, `T₀ = ${esc(data.cc_T0)} °C, P₀ = ${esc(data.cc_P0)} kPa; k<sub>elec</sub> = ${esc(data.cc_fld_kelec)}`),
        L(`Доза по опорной камере на z<sub>ref</sub>: ${fmt(x.DperMU, 4)} Гр на 100 МЕ`, `Dose from the reference chamber at z<sub>ref</sub>: ${fmt(x.DperMU, 4)} Gy per 100 MU`),
      ].join('<br>')
    : L('Исправьте ошибки из списка замечаний', 'Correct the errors listed under Messages');
  $('#cc-result').innerHTML = `<div class="dose-row ${ok ? '' : 'blocked'}">
    <div class="proto"><span>${PROTO[r.protocol].name} · ${symbol(r.protocol)}</span><span>${r.protocol === 'tg51' ? L('ур. (5)', 'Eq. (5)') : L('ур. (41)', 'Eq. (41)')}</span></div>
    <div class="dose-big">${ok ? fmt(value, 5) : '—'}<small>${L('Гр/нКл', 'Gy/nC')}</small></div>
    <div class="secondary">${secondary}</div>
  </div>`;
  $('#cc-btn-transfer').disabled = !ok;
  $('#cc-transfer-note').innerHTML = ok
    ? L(
        `Заполнит раздел 2 вкладки «Электроны»: камера, калибровка «перекрёстная», ${symbol(r.protocol)}${r.protocol === 'trs' ? ', R<sub>50</sub> пучка' : ''}, T₀, P₀, электрометр.`,
        `Fills section 2 of the Electrons tab: chamber, cross-calibration, ${symbol(r.protocol)}${r.protocol === 'trs' ? ', R<sub>50</sub> of the beam' : ''}, T₀, P₀, electrometer.`,
      )
    : L('Кнопка станет доступна, когда коэффициент будет вычислен.', 'The button becomes available once the coefficient is calculated.');

  const mv = $('#cc-mobile-value');
  if (ok) mv.innerHTML = `${r.protocol === 'tg51' ? '(k·N)pp' : 'N<sub>Qcross</sub>'}: <b>${fmt(value, 5)}</b> ${L('Гр/нКл', 'Gy/nC')}`;
  else {
    const n = r.messages.filter((m) => m.level === 'error').length;
    mv.textContent = n ? L(`Ошибок: ${n}`, `Errors: ${n}`) : '—';
  }

  const lvlName = { error: L('Ошибка', 'Error'), warn: L('Внимание', 'Warning'), info: L('Справка', 'Note') };
  const scopeName = { common: '', trs: 'TRS-398 · ', tg51: 'TG-51 · ' };
  const list = r.messages.filter((m) => m.scope === 'common' || m.scope === r.protocol);
  $('#cc-messages').innerHTML = list.length
    ? list.map((m) => `<li class="${m.level}"><span class="lvl">${scopeName[m.scope]}${lvlName[m.level]}</span><span>${esc(m.text)}</span>${m.ref ? `<span class="ref">${esc(refText(m.ref))}</span>` : ''}</li>`).join('')
    : `<li class="info"><span class="lvl">${L('Всё в порядке', 'All clear')}</span><span>${L('Замечаний к введённым данным нет.', 'No issues with the entered data.')}</span></li>`;

  // таблица: опорная и рабочая камеры рядом
  const i = r.inputs;
  const tg = r.protocol === 'tg51';
  const a = tg ? r.tg51.ref || {} : r.trs.ref || {};
  const b = tg ? r.tg51.fld || {} : r.trs.fld || {};
  const v = (val, d) => (Number.isFinite(val) ? fmt(val, d) : '—');
  const rows = [
    [L('Среднее показание M₁, нКл', 'Mean reading M₁, nC'), v(i.ref.m1, 4), v(i.fld.m1, 4)],
    [tg ? 'P<sub>TP</sub>' : 'k<sub>TP</sub>', v(tg ? a.PTP : a.kTP, 4), v(tg ? b.PTP : b.kTP, 4)],
    [tg ? 'P<sub>elec</sub>' : 'k<sub>elec</sub>', v(tg ? a.Pelec : a.kelec, 4), v(tg ? b.Pelec : b.kelec, 4)],
    [tg ? 'P<sub>pol</sub>' : 'k<sub>pol</sub>', v(tg ? a.Ppol : a.kpol, 4), v(tg ? b.Ppol : b.kpol, 4)],
    [tg ? 'P<sub>ion</sub>' : 'k<sub>s</sub>', v(tg ? a.Pion : a.ks, 4), v(tg ? b.Pion : b.ks, 4)],
    [L('M с поправками, нКл', 'Corrected M, nC'), v(a.M, 4), v(b.M, 4)],
    tg
      ? [L('Поправка на качество', 'Beam quality correction'), `<i>k<sub>Q</sub></i> ${v(r.tg51.kQref, 4)}`, `<i>k′<sub>Q</sub></i> ${v(r.tg51.kQprimeFld, 4)}`]
      : [L('Поправка на качество', 'Beam quality correction'), `<i>k<sub>Qcross,Q₀</sub></i> ${v(r.trs.kQ, 4)}`, '—'],
    [L('N<sub>D,w</sub> (⁶⁰Co), Гр/нКл', 'N<sub>D,w</sub> (⁶⁰Co), Gy/nC'), v(i.ndw, 5), '—'],
  ];
  const x2 = tg ? r.tg51 : r.trs;
  const totals = [
    [L('Отношение M<sub>опорн</sub>/M<sub>рабоч</sub>', 'Ratio M<sub>ref</sub>/M<sub>field</sub>'), v(x2.ratio, 5)],
    [L(`D<sub>w</sub>(z<sub>ref</sub>) по опорной камере, Гр на 100 МЕ`, `D<sub>w</sub>(z<sub>ref</sub>) from the reference chamber, Gy per 100 MU`), v(x2.DperMU, 4)],
    [`${symbol(r.protocol)}, ${L('Гр/нКл', 'Gy/nC')}`, x.blocked ? '—' : v(value, 5), 'total'],
  ];
  $('#cc-factors').innerHTML =
    `<thead><tr><th>${L('Величина', 'Quantity')}</th><th>${L('Опорная', 'Reference')}</th><th>${L('Рабочая', 'Field')}</th></tr></thead><tbody>` +
    rows.map(([k, p, q]) => `<tr><td>${k}</td><td class="v">${p}</td><td class="v">${q}</td></tr>`).join('') +
    `<tr class="group"><td colspan="3">${PROTO[r.protocol].name}, ${tg ? L('ур. (5)', 'Eq. (5)') : L('ур. (41)', 'Eq. (41)')}</td></tr>` +
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
  const tg = r.protocol === 'tg51';
  const mean = L('среднее', 'mean');
  out.push(L('ПРОТОКОЛ ПЕРЕКРЁСТНОЙ КАЛИБРОВКИ ИОНИЗАЦИОННОЙ КАМЕРЫ — ПУЧОК ЭЛЕКТРОНОВ', 'IONIZATION CHAMBER CROSS-CALIBRATION REPORT — ELECTRON BEAM'));
  line(L('Протокол', 'Protocol'), `${PROTO[r.protocol].name}, ${tg ? L('Report 385, разд. 5.3.2, ур. (5)', 'Report 385, Sec. 5.3.2, Eq. (5)') : L('TRS-398, разд. 7.6.1, ур. (41)', 'TRS-398, Sec. 7.6.1, Eq. (41)')}`);
  line(L('Калькулятор', 'Calculator'), versionText());
  line(L('Учреждение', 'Institution'), data.cc_institution || '—');
  line(L('Аппарат', 'Machine'), data.cc_machine || '—');
  line(L('Пучок', 'Beam'), data.cc_beam || '—');
  line(L('Дата', 'Date'), data.cc_date || '—');
  line(L('Измерения выполнили', 'Measured by'), data.cc_staff.filter((s) => s.trim()).join(', ') || '—');
  line(
    L('Качество пучка', 'Beam quality'),
    L(
      `${q.method === 'i50' ? `R50,ion = ${data.cc_i50} г/см²; ` : ''}R50 = ${fmt(q.r50, 3)} г/см²; z_ref = ${fmt(q.zref, 3)} г/см²; E0 ≈ ${fmt(q.E0, 1)} МэВ`,
      `${q.method === 'i50' ? `R50,ion = ${data.cc_i50} g/cm²; ` : ''}R50 = ${fmt(q.r50, 3)} g/cm²; z_ref = ${fmt(q.zref, 3)} g/cm²; E0 ≈ ${fmt(q.E0, 1)} MeV`,
    ),
  );
  line(L('Облучение', 'Irradiation'), L(`${data.cc_mu} МЕ для каждой камеры (метод замещения)`, `${data.cc_mu} MU for each chamber (substitution method)`));
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
    if (r.positions[who]) line(L('Положение', 'Position'), r.positions[who][r.protocol].text);
    if (who === 'ref') line('N_D,w (⁶⁰Co)', `${data.cc_ref_ndw} ${unitLabel(NDW_UNITS[data.cc_ref_ndw_unit])} (= ${fmt(i.ndw, 6)} ${L('Гр/нКл', 'Gy/nC')})`);
    line(L('Электрометр', 'Electrometer'), `${p('el_model') || '—'}, ${L('№', 'S/N')} ${p('el_serial') || '—'}, k_elec = ${p('kelec')}`);
    line(L('Напряжения', 'Voltages'), L(`V1 = ${p('V1')} В, V2 = ${p('V2')} В, обычная полярность ${p('polarity')}`, `V1 = ${p('V1')} V, V2 = ${p('V2')} V, normal polarity ${p('polarity')}`));
    line(L('M(V1, обычная), нКл', 'M(V1, normal), nC'), `${cells(p('M1'))} → ${mean} ${fmt(Math.abs(rd.M1.mean), 4)}`);
    line(L('M(V1, обратная), нКл', 'M(V1, opposite), nC'), `${cells(p('Mopp'))} → ${mean} ${fmt(Math.abs(rd.Mopp.mean), 4)}`);
    line(L('M(V2), нКл', 'M(V2), nC'), `${cells(p('M2'))} → ${mean} ${fmt(Math.abs(rd.M2.mean), 4)}`);
    out.push(
      tg
        ? `P_TP = ${fmt(x.PTP)}; P_elec = ${fmt(x.Pelec)}; P_pol = ${fmt(x.Ppol)}; P_ion = ${fmt(x.Pion)}; ${L('M с поправками', 'corrected M')} = ${fmt(x.M)} ${L('нКл', 'nC')}`
        : `k_TP = ${fmt(x.kTP)}; k_elec = ${fmt(x.kelec)}; k_pol = ${fmt(x.kpol)}; k_s = ${fmt(x.ks)}; ${L('M с поправками', 'corrected M')} = ${fmt(x.M)} ${L('нКл', 'nC')}`,
    );
    if (who === 'ref') out.push(tg ? `k_Q = k′_Q·k_Qecal = ${fmt(r.tg51.kQref)} (${r.tg51.kQrefSource || '—'})` : `k_Qcross,Q0 = ${fmt(r.trs.kQ)} (${r.trs.kQSource || '—'})`);
    else if (tg) out.push(`k′_Q = ${fmt(r.tg51.kQprimeFld)} (${r.tg51.kQprimeFldSource || '—'})`);
  }
  out.push('');
  const { x, value } = resultOf(r);
  out.push(L('— Результат —', '— Result —'));
  if (x.blocked) out.push(L('РЕЗУЛЬТАТ НЕ ВЫЧИСЛЕН: есть ошибки ввода (см. замечания).', 'RESULT NOT CALCULATED: there are input errors (see Messages).'));
  else {
    out.push(L(`M_опорн/M_рабоч = ${fmt(x.ratio, 5)}`, `M_ref/M_field = ${fmt(x.ratio, 5)}`));
    out.push(L(`Доза по опорной камере на z_ref: ${fmt(x.DperMU, 4)} Гр на 100 МЕ`, `Dose from the reference chamber at z_ref: ${fmt(x.DperMU, 4)} Gy per 100 MU`));
    out.push(`${symbolText(r.protocol)} = ${fmt(value, 5)} ${L('Гр/нКл', 'Gy/nC')}${tg ? '' : L(` при R50 = ${fmt(q.r50, 3)} г/см²`, ` at R50 = ${fmt(q.r50, 3)} g/cm²`)}`);
  }
  const msgs = r.messages.filter((m) => m.level !== 'info' && (m.scope === 'common' || m.scope === r.protocol));
  if (msgs.length) {
    out.push('', L('Замечания:', 'Messages:'));
    msgs.forEach((m) => out.push(`- ${m.text}${m.ref ? ` [${refText(m.ref)}]` : ''}`));
  }
  if (data.cc_notes) out.push('', `${L('Примечания', 'Notes')}: ${data.cc_notes}`);
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
  renderNotesFlag($('#cc-notes-flag'), data.cc_notes, [SAMPLE_CROSSCAL.cc_notes, SAMPLE_CROSSCAL_EN.cc_notes], isDemo(data));
  renderFileNote($('#cc-file-note'), openedFile ? compareWithFile(openedFile, snapshot(result), SNAP_CMP) : null);
  saveDraft(result.form);
  renderSignBlock($('#cc-sign'), result.form.cc_staff);
  notifyUpdate(ROOT());
}

function refreshForLang() {
  const kept = $$('select', ROOT()).map((sel) => [sel, sel.value]);
  fillSelects();
  for (const [sel, val] of kept) if ([...sel.options].some((o) => o.value === val)) sel.value = val;
  $$('#cc-sheet .cells').forEach((box) => renderCells(box, readCells(box)));
  renderStaff($('#cc-staff-list'), readStaff($('#cc-staff-list')), update);
  localizeDemo(SAMPLE_CROSSCAL, SAMPLE_CROSSCAL_EN);
  localizeDecimals(ROOT());
  update();
}

export function initCrossCal() {
  setStatus = makeStatus($('#cc-status'));
  fillSelects();
  $$('#cc-sheet .cells').forEach((box) => setupCells(box, update));
  $$('#cc-sheet > section .combo').forEach((c) => makeCombo(c));

  const draft = loadDraft();
  writeForm(draft ? draft : sampleData());
  localizeDemo(SAMPLE_CROSSCAL, SAMPLE_CROSSCAL_EN);
  update();
  if (!draft) setStatus(L('Загружен демонстрационный пример. Нажмите «Очистить», чтобы ввести свои данные.', 'Demo example loaded. Click "Clear" to enter your own data.'));

  const sheet = $('#cc-sheet');
  sheet.addEventListener('input', () => {
    openedFile = null;
    update();
  });
  sheet.addEventListener('change', () => {
    openedFile = null;
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

  $('#cc-btn-transfer').addEventListener('click', () => {
    const patch = crossCalTransfer(current.result);
    if (!patch) return;
    onTransfer?.(patch, current.result);
  });

  $('#cc-btn-sample').addEventListener('click', () => {
    openedFile = null;
    writeForm(sampleData());
    update();
    setStatus(L('Загружен демонстрационный пример (вымышленные данные).', 'Demo example loaded (fictitious data).'));
  });
  armButton($('#cc-btn-clear'), () => L('Очистить', 'Clear'), () => L('Точно очистить?', 'Clear everything?'), () => {
    writeForm({ ...CC_DEFAULTS, cc_date: today() });
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
