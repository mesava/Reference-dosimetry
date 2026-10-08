// Вкладка «Инструменты» → «Кривая дозы электронов»: пересчёт кривой ионизации в кривую глубинной дозы
// (ядро — core/edepth.js). Результат (R50,ion или R50, PDD(z_ref), z_max) переносится во вкладку «Электроны».
import { computeEdepth, ED_DEFAULTS, ED_CHAMBERS, normalizeEdepth, curveCsv, valueAt, swAirBurns } from '../core/edepth.js';
import { eChamberLabel } from '../core/electron-chambers.js';
import { SAMPLE_EDEPTH, SAMPLE_EDEPTH_EN } from '../core/sample-edepth.js';
import { L, getLang, refText } from '../core/i18n.js';
import { localizeDecimals } from './i18n.js';
import { makeCombo, renderStaff, readStaff } from './widgets.js';
import { scatterChart, legendSwatch } from './chart.js';
import { jaffeRecInfo, jaffeSourceText } from './jaffe-ui.js';
import { electronsKsInfo } from './electrons-ui.js';
import {
  $, $$, localizeDemo, fmt, fmtSigned, esc, today, makeStatus, copyText, downloadText, currentProtocol, renderFlags, applyShowRules,
  armButton, renderSignBlock, printToPdf, fileStamp, checkFileFormat, compareWithFile, renderFileNote, versionText, renderNotesFlag, notifyUpdate, richText } from './common.js';

const DRAFT_KEY = 'reference-dosimetry.edepth.v1';
const FILE_TAG = { app: 'reference-dosimetry', module: 'edepth', version: 1 };
const ROOT = () => document.getElementById('module-edepth');
let setStatus = () => {};
export const edepthStatus = (text) => setStatus(text);

/** Перенос во вкладку «Электроны»: задаёт app.js. */
let transfer = () => {};
export const setEdepthTransfer = (fn) => {
  transfer = fn || (() => {});
};

const PROTO = { trs: 'TRS-398 Rev.1', tg51: 'TG-51 + Report 385' };
const cm = (v, d = 2) => L(`${fmt(v, d)} см`, `${fmt(v, d)} cm`);
const gcm2 = (v, d = 2) => L(`${fmt(v, d)} г/см²`, `${fmt(v, d)} g/cm²`);
const pct = (v, d = 1) => L(`${fmt(v, d)} %`, `${fmt(v, d)}%`);
const rich = richText;

const sampleData = () => (getLang() === 'en' ? { ...SAMPLE_EDEPTH, ...SAMPLE_EDEPTH_EN } : SAMPLE_EDEPTH);
const isDemo = (d) => [SAMPLE_EDEPTH.ed_institution, SAMPLE_EDEPTH_EN.ed_institution].includes(d.ed_institution) && [SAMPLE_EDEPTH.ed_machine, SAMPLE_EDEPTH_EN.ed_machine].includes(d.ed_machine);

// ------------------------------------------------------------ списки
function fillChambers() {
  const sel = $('#ed_ch_model');
  const keep = sel.value;
  const opt = (c) => `<option value="${c.id}">${esc(eChamberLabel(c))}</option>`;
  sel.innerHTML =
    `<optgroup label="${esc(L('Плоскопараллельные', 'Plane-parallel'))}">${ED_CHAMBERS.filter((c) => c.type === 'pp').map(opt).join('')}</optgroup>` +
    `<optgroup label="${esc(L('Цилиндрические', 'Cylindrical'))}">${ED_CHAMBERS.filter((c) => c.type === 'cyl').map(opt).join('')}</optgroup>` +
    `<option value="OTHER">${esc(L('Другая камера', 'Other chamber'))}</option>`;
  if (keep) sel.value = keep;
}

// ------------------------------------------------------------ форма ↔ данные
const RADIOS = ['ed_detector', 'ed_unit'];
function readForm() {
  const data = {};
  for (const key of Object.keys(ED_DEFAULTS)) {
    if (key === 'protocol') data.protocol = currentProtocol();
    else if (RADIOS.includes(key)) data[key] = $(`input[name="${key}"]:checked`)?.value ?? ED_DEFAULTS[key];
    else if (key === 'ed_staff') data.ed_staff = readStaff($('#ed-staff-list'));
    else {
      const el = document.getElementById(key);
      if (el) data[key] = el.type === 'checkbox' ? el.checked : el.value;
    }
  }
  return data;
}

function writeForm(values) {
  const f = normalizeEdepth(values);
  for (const key of RADIOS) {
    const r = document.getElementById(`${key}_${f[key]}`);
    if (r) r.checked = true;
  }
  renderStaff($('#ed-staff-list'), f.ed_staff, update);
  for (const [key, value] of Object.entries(f)) {
    if (Array.isArray(value) || key === 'protocol' || RADIOS.includes(key)) continue;
    const el = document.getElementById(key);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = value ?? '';
  }
  localizeDecimals(ROOT()); // поля .num; данные кривой (textarea) остаются как есть
}

// ------------------------------------------------------------ вывод
function renderInputsInfo(r) {
  const s = r.shift;
  const mm = Number.isFinite(s?.value) ? s.value * 10 : NaN;
  $('#ed-shift-out').textContent = Number.isFinite(mm) ? (Math.abs(mm) < 1e-9 ? fmt(0, 2) : fmtSigned(mm, 2)) : '—';
  $('#ed-shift-sub').innerHTML = s?.text ? `${rich(s.text)}${s.ref ? ` (${esc(refText(s.ref))})` : ''}` : '';
  const p = r.parsed;
  const pts = r.points;
  const unit = r.form.ed_unit === 'cm' ? L('см', 'cm') : L('мм', 'mm');
  let sub = '';
  if (p?.n) {
    const k = r.form.ed_unit === 'cm' ? 1 : 10;
    const z0 = pts.length ? (pts[0].z * k) : NaN;
    const z1 = pts.length ? (pts[pts.length - 1].z * k) : NaN;
    sub = L(`Точек: ${p.n}`, `Points: ${p.n}`) + (Number.isFinite(z0) ? L(`, глубина ${fmt(z0, 1)}–${fmt(z1, 1)} ${unit} в данных`, `, depth ${fmt(z0, 1)}–${fmt(z1, 1)} ${unit} in the data`) : '') + (p.skipped ? L(`; строк без двух чисел (заголовки, комментарии) пропущено: ${p.skipped}`, `; lines without two numbers (headers, comments) skipped: ${p.skipped}`) : '');
  }
  $('#ed-data-sub').textContent = sub;

  // поправки по глубине
  const c = r.corr || {};
  const ksPts = r.points.filter((q) => Number.isFinite(q.ks));
  $('#ed-rec-out').textContent = c.rec && ksPts.length
    ? L(`${fmt(c.ksRef, 4)} на опорной глубине; от ${fmt(Math.max(...ksPts.map((q) => q.ks)), 4)} на максимуме до ${fmt(c.ksAtI50, 4)} на глубине 50 % ионизации`, `${fmt(c.ksRef, 4)} at the reference depth; from ${fmt(Math.max(...ksPts.map((q) => q.ks)), 4)} at the maximum to ${fmt(c.ksAtI50, 4)} at the 50% ionization depth`)
    : '—';
  $('#ed-pol-out').textContent = c.pol ? (c.kpolMax - c.kpolMin < 5e-5 ? fmt(c.kpolMin, 4) : `${fmt(c.kpolMin, 4)}–${fmt(c.kpolMax, 4)}`) : '—';
  // номера разделов: без камеры раздела поправок нет
  const shift = r.chamberMode ? 0 : 1;
  $('#ed-step-chart').textContent = String(5 - shift);
  $('#ed-step-notes').textContent = String(6 - shift);
}

let lastResult = null;
function renderChart(r) {
  lastResult = r;
  const box = $('#ed-chart');
  const legend = $('#ed-legend');
  if (r.blocked || !r.points.length) {
    box.innerHTML = `<p class="chart-empty">${r.hasErrors && r.parsed?.n ? L('График появится, когда будут исправлены ошибки — см. «Замечания».', 'The plot appears once the errors are fixed — see Messages.') : L('График появится, когда кривая будет прочитана и дойдёт до 50 %.', 'The plot appears once the curve is read and reaches 50%.')}</p>`;
    legend.innerHTML = '';
    return;
  }
  const P = r.points;
  const series = [];
  if (r.chamberMode) series.push({ cls: 's2', line: true, dashed: true, points: P.map((p) => ({ x: p.zEff, y: p.I })) });
  series.push({ cls: 's1', line: true, points: P.map((p) => ({ x: p.zEff, y: p.D })) });
  const lines = [];
  if (r.tangent && Number.isFinite(r.rp)) {
    const zA = Number.isFinite(r.r80) ? r.r80 - 0.3 : r.rp - 1;
    lines.push({ cls: 'aux', a: r.tangent.a, b: r.tangent.b, x0: zA, x1: r.rp + 0.1 });
    if (r.background?.measured) lines.push({ cls: 'aux', a: r.background.a, b: r.background.b, x0: r.rp - 0.4, x1: P[P.length - 1].zEff });
  }
  const vlines = [
    { x: r.zref, label: 'z_ref', row: 0 },
    { x: r.r80, label: 'R_80', row: 1 },
    { x: r.r50, label: 'R_50', row: 0 },
    { x: r.rp, label: 'R_p', row: 1 },
  ].filter((v) => Number.isFinite(v.x));
  const zs = P.map((p) => p.zEff);
  scatterChart(box, {
    label: L('Кривые ионизации и глубинной дозы электронов', 'Electron depth-ionization and depth-dose curves'),
    xLabel: L('Глубина точки измерения, см', 'Depth of the point of measurement, cm'),
    yLabel: L('% от максимума', '% of maximum'),
    fmt,
    xInclude: [0],
    yInclude: [0, 100],
    aspect: 0.55,
    series,
    lines,
    vlines,
    crosshair: (x) => {
      let i = 0;
      for (let k = 1; k < zs.length; k++) if (Math.abs(zs[k] - x) < Math.abs(zs[i] - x)) i = k;
      const p = P[i];
      const rows = [{ cls: 's1', y: p.D, text: L(`доза ${fmt(p.D, 1)} %`, `dose ${fmt(p.D, 1)}%`) }];
      if (r.chamberMode) rows.push({ cls: 's2', y: p.I, text: L(`ионизация ${fmt(p.I, 1)} %`, `ionization ${fmt(p.I, 1)}%`) });
      return { x: p.zEff, head: `z = ${cm(p.zEff)}`, rows };
    },
  });
  const items = [[legendSwatch({ line: true, cls: 's1' }), L('Доза', 'Dose')]];
  if (r.chamberMode) items.push([legendSwatch({ line: true, dashed: true, cls: 's2' }), r.corr?.rec || r.corr?.pol ? L('Ионизация (с поправками по глубине)', 'Ionization (with depth corrections)') : L('Ионизация (измерено)', 'Ionization (measured)')]);
  if (r.tangent) items.push([legendSwatch({ line: true, cls: 'aux' }), L('Касательная и фон для R_p', 'Tangent and background for R_p')]);
  legend.innerHTML = items.map(([sw, t]) => `<span class="item">${sw}<span>${rich(t)}</span></span>`).join('');
}

function renderReadout(r) {
  const proto = `${esc(r.form.ed_beam || L('Пучок электронов', 'Electron beam'))} · ${PROTO[r.protocol]}`;
  const chip = `<span class="chip">${esc(r.chamberMode ? L('по кривой ионизации', 'from ionization') : L('детектор дозы', 'dose detector'))}</span>`;
  if (r.blocked) {
    $('#ed-result').innerHTML = `<div class="dose-row blocked"><div class="proto"><span>${proto}</span>${chip}</div><div class="dose-big">—</div><div class="secondary">${esc(L('Нет результата: см. замечания.', 'No result: see Messages.'))}</div></div>`;
    $('#ed-mobile-value').innerHTML = '—';
    $('#ed-btn-transfer').disabled = true;
    $('#ed-transfer-note').innerHTML = r.hasErrors && r.parsed?.n
      ? L('Кнопка станет доступна, когда будут исправлены ошибки — см. «Замечания».', 'The button becomes available once the errors are fixed — see Messages.')
      : L('Кнопка станет доступна, когда будет найден R<sub>50</sub>.', 'The button becomes available once R<sub>50</sub> is found.');
    return;
  }
  const lines = [];
  if (r.chamberMode) lines.push(`I<sub>50</sub> (R<sub>50,ion</sub>) = ${gcm2(r.i50)}`);
  lines.push(`z<sub>ref</sub> = ${gcm2(r.zref)}; PDD(z<sub>ref</sub>) = ${Number.isFinite(r.pddZref) ? pct(r.pddZref) : '—'}`);
  lines.push(`R<sub>100</sub> = ${cm(r.r100)}; R<sub>80</sub> = ${Number.isFinite(r.r80) ? cm(r.r80) : '—'}`);
  if (Number.isFinite(r.rp)) lines.push(`R<sub>p</sub> = ${cm(r.rp)}${Number.isFinite(r.dx) && r.background?.measured ? `; D<sub>x</sub> = ${pct(r.dx)}` : ''}`);
  lines.push(L(`E<sub>0</sub> ≈ ${fmt(r.e0, 1)} МэВ`, `E<sub>0</sub> ≈ ${fmt(r.e0, 1)} MeV`));
  $('#ed-result').innerHTML = `<div class="dose-row">
    <div class="proto"><span>${proto}</span>${chip}</div>
    <div class="dose-big">R<sub>50</sub> = ${fmt(r.r50, 2)}<small>${esc(L('г/см²', 'g/cm²'))}</small></div>
    <div class="secondary">${lines.join('<br>')}</div>
  </div>`;
  $('#ed-mobile-value').innerHTML = `R<sub>50</sub> = <b>${fmt(r.r50, 2)}</b>${Number.isFinite(r.pddZref) ? ` · PDD(z<sub>ref</sub>) = ${pct(r.pddZref)}` : ''}`;
  $('#ed-btn-transfer').disabled = false;
  $('#ed-transfer-note').innerHTML = r.chamberMode
    ? L('Заполнит во вкладке «Электроны» R<sub>50,ion</sub> (I<sub>50</sub>) в разделе 3, PDD(z<sub>ref</sub>) и z<sub>max</sub> в разделе 8.', 'Fills in the Electrons tab: R<sub>50,ion</sub> (I<sub>50</sub>) in section 3, PDD(z<sub>ref</sub>) and z<sub>max</sub> in section 8.')
    : L('Заполнит во вкладке «Электроны» R<sub>50</sub> в разделе 3, PDD(z<sub>ref</sub>) и z<sub>max</sub> в разделе 8.', 'Fills in the Electrons tab: R<sub>50</sub> in section 3, PDD(z<sub>ref</sub>) and z<sub>max</sub> in section 8.');
}

function renderMessages(r) {
  const lvlName = { error: L('Ошибка', 'Error'), warn: L('Внимание', 'Warning'), info: L('Справка', 'Note') };
  $('#ed-messages').innerHTML = r.messages.length
    ? r.messages.map((m) => `<li class="${m.level}"><span class="lvl">${lvlName[m.level]}</span><span>${richText(m.text)}</span>${m.ref ? `<span class="ref">${esc(refText(m.ref))}</span>` : ''}</li>`).join('')
    : `<li class="info"><span class="lvl">${L('Всё в порядке', 'All clear')}</span><span>${L('Замечаний к введённым данным нет.', 'No issues with the entered data.')}</span></li>`;
}

/** Строки сводки: [подпись (HTML), значение (HTML)]. */
function summaryRows(r) {
  const v = (x, d = 2) => (Number.isFinite(x) ? fmt(x, d) : '—');
  const det = r.chamberMode ? (r.chamber ? esc(r.chamber.other ? `${L('другая', 'other')}, ${r.chamber.type === 'cyl' ? L('цилиндрическая', 'cylindrical') : L('плоскопараллельная', 'plane-parallel')}` : eChamberLabel(r.chamber)) : '—') : L('детектор дозы', 'dose detector');
  const rows = [
    [L('Протокол', 'Protocol'), PROTO[r.protocol]],
    [L('Детектор', 'Detector'), det],
    [L('Сдвиг глубины Δ, мм', 'Depth shift Δ, mm'), Number.isFinite(r.shift?.value) ? (Math.abs(r.shift.value) < 1e-9 ? fmt(0, 2) : fmtSigned(r.shift.value * 10, 2)) : '—'],
  ];
  if (r.blocked) return rows;
  rows.push([L('Точек кривой', 'Curve points'), String(r.points.length)]);
  if (Number.isFinite(r.maxStep)) rows.push([L('Наибольший шаг на спаде, мм', 'Largest step on the falloff, mm'), v(r.maxStep * 10, 1)]);
  const c = r.corr || {};
  if (c.rec) rows.push([L('Поправка на рекомбинацию по глубине, k<sub>s</sub>', 'Recombination correction with depth, k<sub>s</sub>'), L(`${fmt(c.ksRef, 4)} на z<sub>ref</sub>, ${fmt(c.ksMax, 4)} на максимуме, ${fmt(c.ksAtI50, 4)} на I<sub>50</sub>; C<sub>init</sub> = ${fmt(c.cInit * 100, 3)} %`, `${fmt(c.ksRef, 4)} at z<sub>ref</sub>, ${fmt(c.ksMax, 4)} at the maximum, ${fmt(c.ksAtI50, 4)} at I<sub>50</sub>; C<sub>init</sub> = ${fmt(c.cInit * 100, 3)}%`)]);
  if (c.pol) rows.push([L('Поправка на полярность по глубине, k<sub>pol</sub>', 'Polarity correction with depth, k<sub>pol</sub>'), c.kpolMax - c.kpolMin < 5e-5 ? fmt(c.kpolMin, 4) : `${fmt(c.kpolMin, 4)}–${fmt(c.kpolMax, 4)}`]);
  if ((c.rec || c.pol) && Number.isFinite(c.dI50mm)) {
    rows.push([L('Изменение I<sub>50</sub> от поправок, мм', 'Change of I<sub>50</sub> due to the corrections, mm'), fmtSigned(c.dI50mm, 3)]);
    rows.push([L('Изменение PDD(z<sub>ref</sub>) от поправок, %', 'Change of PDD(z<sub>ref</sub>) due to the corrections, %'), fmtSigned(c.dPddZref, 3)]);
  }
  if (r.chamberMode) {
    rows.push([L('R<sub>50,ion</sub> (I<sub>50</sub>), г/см²', 'R<sub>50,ion</sub> (I<sub>50</sub>), g/cm²'), v(r.i50, 3)]);
    rows.push([L('R<sub>50</sub> по ур. 37, г/см²', 'R<sub>50</sub> per Eq. 37, g/cm²'), v(r.r50, 3)]);
    rows.push([L('Глубина 50 % на кривой дозы, см', '50% depth of the dose curve, cm'), v(r.r50dose, 3)]);
    rows.push([L('s<sub>w,air</sub> на z<sub>ref</sub>', 's<sub>w,air</sub> at z<sub>ref</sub>'), v(swAirBurns(r.r50, r.zref), 4)]);
  } else {
    rows.push([L('R<sub>50</sub> по кривой, г/см²', 'R<sub>50</sub> from the curve, g/cm²'), v(r.r50, 3)]);
  }
  rows.push(
    [L('R<sub>100</sub> (z<sub>max</sub>), см', 'R<sub>100</sub> (z<sub>max</sub>), cm'), v(r.r100)],
    [L('R<sub>90</sub>, см', 'R<sub>90</sub>, cm'), v(r.r90)],
    [L('R<sub>80</sub>, см', 'R<sub>80</sub>, cm'), v(r.r80)],
    [L('R<sub>p</sub>, см', 'R<sub>p</sub>, cm'), v(r.rp)],
    [L('D<sub>x</sub> (тормозной фон), %', 'D<sub>x</sub> (bremsstrahlung), %'), r.background?.measured ? v(r.dx, 1) : '—'],
    [L('z<sub>ref</sub> = 0,6·R<sub>50</sub> − 0,1, г/см²', 'z<sub>ref</sub> = 0.6·R<sub>50</sub> − 0.1, g/cm²'), v(r.zref)],
    [L('PDD(z<sub>ref</sub>), %', 'PDD(z<sub>ref</sub>), %'), v(r.pddZref, 1)],
    [L('E<sub>0</sub> ≈ 2,33·R<sub>50</sub>, МэВ', 'E<sub>0</sub> ≈ 2.33·R<sub>50</sub>, MeV'), v(r.e0, 1)],
  );
  return rows;
}

function renderSummary(r) {
  $('#ed-factors').innerHTML =
    `<thead><tr><th>${L('Величина', 'Quantity')}</th><th>${L('Значение', 'Value')}</th></tr></thead><tbody>` +
    summaryRows(r).map(([k, x]) => `<tr><td>${k}</td><td class="v">${x}</td></tr>`).join('') +
    '</tbody>';
}

// ------------------------------------------------------------ протокол текстом
const plain = (html) => String(html).replace(/<sub>(.*?)<\/sub>/g, '_$1').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function reportText(data, r) {
  const out = [];
  const line = (k, val) => out.push(`${k}: ${val}`);
  out.push(L('КРИВАЯ ГЛУБИННОЙ ДОЗЫ ЭЛЕКТРОНОВ', 'ELECTRON DEPTH-DOSE CURVE'));
  line(L('Протокол', 'Protocol'), PROTO[r.protocol]);
  line(L('Калькулятор', 'Calculator'), versionText());
  line(L('Учреждение', 'Institution'), data.ed_institution || '—');
  line(L('Аппарат и пучок', 'Machine and beam'), [data.ed_machine, data.ed_beam].filter(Boolean).join(', ') || '—');
  line(L('РИП и поле', 'SSD and field'), [data.ed_ssd && L(`РИП ${data.ed_ssd} см`, `SSD ${data.ed_ssd} cm`), data.ed_field && L(`поле ${data.ed_field} см`, `field ${data.ed_field} cm`)].filter(Boolean).join(', ') || '—');
  line(L('Дата', 'Date'), data.ed_date || '—');
  line(L('Выполнил', 'Performed by'), data.ed_staff.filter((s) => s.trim()).join(', ') || '—');
  if (r.shift?.text) line(L('Сдвиг глубины', 'Depth shift'), `${plain(rich(r.shift.text))}${r.shift.ref ? ` (${refText(r.shift.ref)})` : ''}`);
  out.push('', L('Результаты:', 'Results:'));
  for (const [k, v] of summaryRows(r)) out.push(`  ${plain(k)}: ${plain(v)}`);
  if (!r.blocked) {
    // кривая дозы через 5 мм — для протокола; полная кривая — в CSV
    const zs = r.points.map((p) => p.zEff);
    const Ds = r.points.map((p) => p.D);
    const Is = r.points.map((p) => p.I);
    out.push('', r.chamberMode ? L('Кривая (z, см — ионизация, % — доза, %), через 0,5 см:', 'Curve (z, cm — ionization, % — dose, %), every 0.5 cm:') : L('Кривая (z, см — доза, %), через 0,5 см:', 'Curve (z, cm — dose, %), every 0.5 cm:'));
    for (let z = 0; z <= zs[zs.length - 1] + 1e-9; z += 0.5) {
      const d = valueAt(zs, Ds, z);
      if (!Number.isFinite(d)) continue;
      out.push(`  ${fmt(z, 1)} — ${r.chamberMode ? `${fmt(valueAt(zs, Is, z), 1)} — ` : ''}${fmt(d, 1)}`);
    }
  }
  const msgs = r.messages.filter((m) => m.level !== 'info');
  if (msgs.length) {
    out.push('', L('Замечания:', 'Messages:'));
    msgs.forEach((m) => out.push(`- ${m.text}${m.ref ? ` [${refText(m.ref)}]` : ''}`));
  }
  if (data.ed_notes) out.push('', `${L('Примечания', 'Notes')}: ${data.ed_notes}`);
  out.push('', closingNote());
  return out.join('\n');
}

const closingNote = () =>
  L(
    'Доза ∝ показание × s_w,air(R50, z) (TRS-398 Rev.1, разд. 7.7.1, табл. 22); s_w,air — выражение Burns et al. (Med. Phys. 23, 489, 1996); R50 = 1,029·I50 − 0,06 (ур. 37). Изменение поправки на возмущение с глубиной не учитывается. Значения приводятся с запасом знаков: это точность вычислений, а не измерения.',
    'Dose ∝ reading × s_w,air(R50, z) (TRS-398 Rev.1, Sec. 7.7.1, Table 22); s_w,air from the expression of Burns et al. (Med. Phys. 23, 489, 1996); R50 = 1.029·I50 − 0.06 (Eq. 37). The variation of the perturbation correction with depth is not taken into account. Extra digits are computational precision, not measurement accuracy.',
  );

// ------------------------------------------------------------ сохранение
function saveDraft(data) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  } catch {
    /* хранилище недоступно или переполнено */
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

function snapshot(r) {
  const num = (x) => (Number.isFinite(x) ? x : null);
  return { protocol: r.protocol, value: num(r.r50), i50: num(r.i50), pddZref: num(r.pddZref), r80: num(r.r80) };
}
const SNAP_CMP = { keys: ['value', 'i50', 'pddZref', 'r80'], main: 'value', digits: 3, get unit() { return L('г/см²', 'g/cm²'); } };

export function importEdepth(obj) {
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
  const r = computeEdepth(data);
  current = { data: r.form, result: r };
  applyShowRules(ROOT(), r.form, r.protocol);
  renderInputsInfo(r);
  renderFlags(ROOT(), r.flags);
  renderChart(r);
  renderReadout(r);
  renderMessages(r);
  renderSummary(r);
  $('#ed-demo-flag').hidden = !isDemo(data);
  renderNotesFlag($('#ed-notes-flag'), data.ed_notes, [SAMPLE_EDEPTH.ed_notes, SAMPLE_EDEPTH_EN.ed_notes], isDemo(data));
  renderFileNote($('#ed-file-note'), openedFile ? compareWithFile(openedFile, snapshot(r), SNAP_CMP) : null);
  saveDraft(r.form);
  renderSignBlock($('#ed-sign'), r.form.ed_staff, closingNote());
  notifyUpdate(ROOT());
}

function refreshForLang() {
  const kept = $('#ed_ch_model').value;
  fillChambers();
  $('#ed_ch_model').value = kept;
  renderStaff($('#ed-staff-list'), readStaff($('#ed-staff-list')), update);
  localizeDemo(SAMPLE_EDEPTH, SAMPLE_EDEPTH_EN);
  update();
}

/** Значения для вкладки «Электроны». */
function transferPatch(r) {
  const patch = { e_dd_on: true };
  if (r.chamberMode) {
    patch.e_r50_method = 'i50';
    patch.e_i50 = fmt(r.i50, 2);
  } else {
    patch.e_r50_method = 'r50';
    patch.e_r50 = fmt(r.r50, 2);
  }
  if (Number.isFinite(r.pddZref)) patch.e_pdd = fmt(r.pddZref, 1);
  if (Number.isFinite(r.r100)) patch.e_zmax = fmt(r.r100, 2);
  return patch;
}

export function initEdepth() {
  setStatus = makeStatus($('#ed-status'));
  fillChambers();
  $$('#ed-sheet > section .combo').forEach((c) => makeCombo(c));

  const draft = loadDraft();
  writeForm(draft ? draft : sampleData());
  localizeDemo(SAMPLE_EDEPTH, SAMPLE_EDEPTH_EN);
  update();
  if (!draft) setStatus(L('Загружен демонстрационный пример. Нажмите «Очистить», чтобы вставить свою кривую.', 'Demo example loaded. Click "Clear" to paste your own curve.'));

  const sheet = $('#ed-sheet');
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

  if (typeof ResizeObserver === 'function') {
    let w0 = 0;
    new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (!w || w === w0 || !lastResult) return;
      w0 = w;
      renderChart(lastResult);
    }).observe($('#ed-chart'));
  }

  $('#ed-btn-add-staff').addEventListener('click', () => {
    const cur = readStaff($('#ed-staff-list'));
    cur.push('');
    renderStaff($('#ed-staff-list'), cur, update);
    $$('#ed-staff-list .staff-input').at(-1).focus();
    update();
  });

  // файл кривой (экспорт сканера)
  $('#ed-btn-file').addEventListener('click', () => $('#ed-curve-input').click());
  $('#ed-curve-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      $('#ed_data').value = await file.text();
      openedFile = null;
      update();
      const r = current.result;
      setStatus(L(`Кривая загружена из файла ${file.name}: точек — ${r.parsed?.n ?? 0}.`, `Curve loaded from ${file.name}: ${r.parsed?.n ?? 0} points.`));
    } catch {
      setStatus(L('Не удалось прочитать файл.', 'Could not read the file.'));
    }
    e.target.value = '';
  });
  $('#ed-btn-cinit-jaffe').addEventListener('click', () => {
    const info = jaffeRecInfo();
    const note = $('#ed-cinit-note');
    if (!info) {
      note.innerHTML = richText(L('В «Графике Яффе» нет начальной рекомбинации: нужны показания при V₁ и V₂ в трёх и более условиях (раздел 5) или непрерывный пучок с осью 1/V.', 'The Jaffé plot has no initial recombination: readings at V₁ and V₂ in three or more conditions (section 5) or a continuous beam with the 1/V axis are needed.'));
      return;
    }
    $('#ed_rec_cinit').value = fmt(Math.max(0, info.cInit) * 100, 3);
    openedFile = null;
    update();
    note.innerHTML = richText(jaffeSourceText(info));
  });
  $('#ed-btn-ks-electrons').addEventListener('click', () => {
    const info = electronsKsInfo();
    const note = $('#ed-ks-note');
    if (!info) {
      note.innerHTML = richText(L('Во вкладке «Электроны» k_s не определён: нужны показания при двух напряжениях (раздел 5).', 'The Electrons tab has no k_s: readings at two voltages are needed (section 5).'));
      return;
    }
    $('#ed_rec_ks').value = fmt(info.ks, 4);
    openedFile = null;
    update();
    const who = [info.chamber, info.beam, info.V1 ? `V₁ = ${info.V1} ${L('В', 'V')}` : ''].filter(Boolean).join(', ');
    note.innerHTML = richText(L(`Из вкладки «Электроны»${who ? ` (${who})` : ''}: ${info.tg ? 'P_ion' : 'k_s'} методом двух напряжений. Проверьте, что это та же камера и тот же пучок.`, `From the Electrons tab${who ? ` (${who})` : ''}: ${info.tg ? 'P_ion' : 'k_s'} by the two-voltage method. Check that it is the same chamber and beam.`));
  });
  $('#ed-btn-pol-file').addEventListener('click', () => $('#ed-pol-input').click());
  $('#ed-pol-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      $('#ed_pol_data').value = await file.text();
      openedFile = null;
      update();
      setStatus(L(`Кривая при обратной полярности загружена из файла ${file.name}.`, `Opposite-polarity curve loaded from ${file.name}.`));
    } catch {
      setStatus(L('Не удалось прочитать файл.', 'Could not read the file.'));
    }
    e.target.value = '';
  });
  $('#ed-btn-csv').addEventListener('click', () => {
    const r = current.result;
    if (r.blocked) {
      setStatus(L('Кривой дозы пока нет: см. замечания.', 'There is no dose curve yet: see Messages.'));
      return;
    }
    const name = [current.data.ed_machine, current.data.ed_beam, current.data.ed_date].filter(Boolean).join('_').replace(/[^\p{L}\p{N}_.-]+/gu, '-') || 'curve';
    downloadText(curveCsv(r, { dec: getLang() === 'en' ? '.' : ',' }), `pdd_${name}.csv`, 'text/csv');
    setStatus(L('Кривая дозы сохранена: глубина точки измерения, см, и PDD, %; разделитель — точка с запятой.', 'Dose curve saved: depth of the point of measurement, cm, and PDD, %; the separator is a semicolon.'));
  });
  $('#ed-btn-transfer').addEventListener('click', () => {
    const r = current.result;
    if (r.blocked) return;
    transfer(transferPatch(r));
  });

  $('#ed-btn-sample').addEventListener('click', () => {
    openedFile = null;
    writeForm(sampleData());
    update();
    setStatus(L('Загружен демонстрационный пример (вымышленные данные).', 'Demo example loaded (fictitious data).'));
  });
  armButton($('#ed-btn-clear'), () => L('Очистить', 'Clear'), () => L('Точно очистить?', 'Clear everything?'), () => {
    const cur = readForm();
    writeForm({ ...ED_DEFAULTS, ed_detector: cur.ed_detector, ed_ch_model: cur.ed_ch_model, ed_unit: cur.ed_unit, ed_date: today() });
    openedFile = null;
    update();
    setStatus(L('Форма очищена; камера и единицы глубины оставлены.', 'Form cleared; the chamber and depth units are kept.'));
  });

  const payload = () => JSON.stringify({ ...FILE_TAG, ...fileStamp(snapshot(current.result)), savedAt: new Date().toISOString(), form: current.data }, null, 2);
  $('#ed-btn-save').addEventListener('click', () => {
    const name = [current.data.ed_machine, current.data.ed_beam, current.data.ed_date].filter(Boolean).join('_').replace(/[^\p{L}\p{N}_.-]+/gu, '-') || 'edepth';
    downloadText(payload(), `edepth_${name}.json`);
    setStatus(L('Файл сохранён.', 'File saved.'));
  });
  $('#ed-btn-load').addEventListener('click', () => $('#ed-file-input').click());
  $('#ed-file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      importEdepth(JSON.parse(await file.text()));
      setStatus(L(`Открыт файл ${file.name}.`, `Opened file ${file.name}.`));
    } catch (err) {
      setStatus(err instanceof SyntaxError ? L('Файл повреждён: это не JSON. Кривую сканера открывайте кнопкой в разделе 3.', 'The file is damaged: it is not JSON. Open a scanner curve with the button in section 3.') : err.message);
    }
    e.target.value = '';
  });
  $('#ed-btn-copy-json').addEventListener('click', () =>
    copyText(payload(), L('Данные скопированы. Чтобы вставить их обратно, нажмите Ctrl+V на странице вне полей ввода.', 'Data copied. To paste them back, press Ctrl+V on the page outside the input fields.'), setStatus),
  );
  $('#ed-btn-copy-report').addEventListener('click', () => copyText(reportText(current.data, current.result), L('Протокол скопирован в буфер обмена.', 'Report copied to the clipboard.'), setStatus));
  $('#ed-btn-pdf').addEventListener('click', () => printToPdf([L('Кривая дозы', 'Depth dose'), current.data.ed_machine, current.data.ed_beam, current.data.ed_date].filter(Boolean).join('_'), setStatus));
  $('#ed-btn-print').addEventListener('click', () => window.print());
}
