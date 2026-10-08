// Вкладка «Инструменты» → «График Яффе»: проверка системы камера — кабель — электрометр (ядро — core/jaffe.js).
import { computeJaffe, JF_DEFAULTS, normalizeJaffe, jaffeChamber } from '../core/jaffe.js';
import { coChamberGroups } from '../core/co60-chambers.js';
import { SAMPLE_JAFFE, SAMPLE_JAFFE_EN } from '../core/sample-jaffe.js';
import { L, getLang, refText } from '../core/i18n.js';
import { localizeDecimals } from './i18n.js';
import { makeCombo, renderStaff, readStaff } from './widgets.js';
import { scatterChart, legendSwatch } from './chart.js';
import {
  $, $$, localizeDemo, fmt, fmtSigned, esc, today, makeStatus, copyText, downloadText, currentProtocol, renderFlags, applyShowRules,
  armButton, renderSignBlock, printToPdf, fileStamp, checkFileFormat, compareWithFile, renderFileNote, versionText, renderNotesFlag, notifyUpdate, richText, dateText } from './common.js';

const DRAFT_KEY = 'reference-dosimetry.jaffe.v1';
const FILE_TAG = { app: 'reference-dosimetry', module: 'jaffe', version: 1 };
const ROOT = () => document.getElementById('module-jaffe');
let setStatus = () => {};
export const jaffeStatus = (text) => setStatus(text);

const PROTO = { trs: 'TRS-398 Rev.1', tg51: 'TG-51' };
const beamName = (b) => ({ pulsed: L('Импульсный пучок', 'Pulsed beam'), scanned: L('Импульсно-сканирующий пучок', 'Pulsed-scanned beam'), continuous: L('Непрерывный пучок (⁶⁰Co)', 'Continuous beam (⁶⁰Co)') })[b];
const ksHtml = (protocol) => (protocol === 'tg51' ? 'P<sub>ion</sub>' : 'k<sub>s</sub>');
const ksText = (protocol) => (protocol === 'tg51' ? 'P_ion' : 'k_s');
/** Подпись в атрибуте (без разметки): индексы символами Юникода. */
const ksCap = (protocol) => (protocol === 'tg51' ? 'Pᵢₒₙ' : 'kₛ');
const V = (v) => L(`${fmt(v, 0)} В`, `${fmt(v, 0)} V`);
const pct = (v, d = 2) => L(`${fmt(v, d)} %`, `${fmt(v, d)}%`);
const pctS = (v, d = 2) => L(`${fmtSigned(v, d)} %`, `${fmtSigned(v, d)}%`);

/** Обозначения с индексом в тексте: k_s → k<sub>s</sub>, V_max, C_init, P_ion, M_нас. */
const rich = richText;

/** Число с n значащими цифрами (для малых коэффициентов вроде b₁). */
const sig = (v, n) => (Number.isFinite(v) && v !== 0 ? fmt(v, Math.max(0, n - 1 - Math.floor(Math.log10(Math.abs(v))))) : fmt(v, n));

/** Отклонение со знаком; ноль после округления — без знака. */
const dev3 = (v) => (Math.abs(v) < 5e-4 ? fmt(0, 3) : fmtSigned(v, 3));

const sampleData = () => (getLang() === 'en' ? { ...SAMPLE_JAFFE, ...SAMPLE_JAFFE_EN } : SAMPLE_JAFFE);
const isDemo = (d) => [SAMPLE_JAFFE.jf_institution, SAMPLE_JAFFE_EN.jf_institution].includes(d.jf_institution) && [SAMPLE_JAFFE.jf_machine, SAMPLE_JAFFE_EN.jf_machine].includes(d.jf_machine);

// ------------------------------------------------------------ таблицы
const pointsBody = () => $('#jf-points-body');
const dppBody = () => $('#jf-dpp-body');
const numInput = (id, flag, label, value) =>
  `<input type="text" class="num" inputmode="decimal" id="${id}" data-flag="${flag}" aria-label="${esc(label)}" value="${esc(value)}">`;

function renderPoints(f) {
  const n = f.jf_V.length;
  const row = (i) => L(`строка ${i + 1}`, `row ${i + 1}`);
  pointsBody().innerHTML = Array.from({ length: n }, (_, i) => `<tr data-i="${i}">
      <td class="no">${i + 1}</td>
      <td data-cap="V, ${esc(L('В', 'V'))}">${numInput(`jf_V_${i}`, `jf_V.${i}`, `${L('Напряжение, В', 'Voltage, V')}, ${row(i)}`, f.jf_V[i])}</td>
      <td data-cap="M">${numInput(`jf_M_${i}`, `jf_M.${i}`, `${L('Показание M', 'Reading M')}, ${row(i)}`, f.jf_M[i])}</td>
      <td data-cap="${esc(L('M обр.', 'M opp.'))}">${numInput(`jf_Mopp_${i}`, `jf_Mopp.${i}`, `${L('Показание при обратной полярности', 'Opposite-polarity reading')}, ${row(i)}`, f.jf_Mopp[i])}</td>
      <td class="use"><input type="checkbox" id="jf_use_${i}" aria-label="${esc(`${L('В прямой', 'In the fit')}, ${row(i)}`)}"${f.jf_use[i] ? ' checked' : ''}></td>
      <td class="v" data-o="ks" data-cap="${esc(ksCap(f.protocol))}"></td>
      <td class="v" data-o="dev" data-cap="${esc(L('откл., %', 'dev., %'))}"></td>
      <td class="v" data-o="kpol" data-cap="kₚₒₗ"></td>
    </tr>`).join('');
  $('#jf-btn-remove-row').disabled = n <= 3;
}

function renderDpp(f) {
  const n = f.jf_dpp_x.length;
  const row = (i) => L(`строка ${i + 1}`, `row ${i + 1}`);
  dppBody().innerHTML = Array.from({ length: n }, (_, i) => `<tr data-i="${i}">
      <td class="no">${i + 1}</td>
      <td class="cond"><input type="text" id="jf_dpp_cond_${i}" aria-label="${esc(`${L('Условие', 'Condition')}, ${row(i)}`)}" value="${esc(f.jf_dpp_cond[i])}" placeholder="${esc(L('РИП, глубина', 'SSD, depth'))}"></td>
      <td class="dx" data-cap="Dₚₚ" data-show="jf_beam_type:pulsed,scanned">${numInput(`jf_dpp_x_${i}`, `jf_dpp_x.${i}`, `${L('Доза за импульс', 'Dose per pulse')}, ${row(i)}`, f.jf_dpp_x[i])}</td>
      <td class="m1" data-cap="M₁">${numInput(`jf_dpp_m1_${i}`, `jf_dpp_m1.${i}`, `${L('Показание при V₁', 'Reading at V₁')}, ${row(i)}`, f.jf_dpp_m1[i])}</td>
      <td class="m2" data-cap="M₂">${numInput(`jf_dpp_m2_${i}`, `jf_dpp_m2.${i}`, `${L('Показание при V₂', 'Reading at V₂')}, ${row(i)}`, f.jf_dpp_m2[i])}</td>
      <td class="ks" data-cap="${esc(ksCap(f.protocol))}">${numInput(`jf_dpp_ks_${i}`, `jf_dpp_ks.${i}`, `${ksText(f.protocol)}, ${row(i)}`, f.jf_dpp_ks[i])}<output class="calc" data-o="ks"></output></td>
      <td class="v" data-o="dev" data-cap="${esc(L('откл., %', 'dev., %'))}"></td>
    </tr>`).join('');
  $('#jf-btn-remove-dpp').disabled = n <= 1;
}

const vals = (sel) => $$(sel, ROOT()).map((i) => i.value);

// ------------------------------------------------------------ список камер
/** Камеры из базы калькулятора (цилиндрические и плоскопараллельные) и «другая» с названием вручную. */
function fillChambers() {
  const sel = $('#jf_ch_model');
  const cur = sel.value;
  sel.innerHTML =
    `<option value="">${esc(L('— выберите камеру —', '— select a chamber —'))}</option>` +
    coChamberGroups().map((g) => `<optgroup label="${esc(g.label)}">${g.items.map((i) => `<option value="${esc(i.id)}">${esc(i.label)}</option>`).join('')}</optgroup>`).join('') +
    `<option value="OTHER">${esc(L('Другая камера — ввести название…', 'Other chamber: enter the name…'))}</option>`;
  sel.value = cur;
}
/** Название камеры с заводским номером — для протокола, файла и подписи у кнопок «Взять из графика Яффе». */
const chamberText = (d, sep = ', ') => [jaffeChamber(d)?.label, d.jf_ch_serial ? `№ ${d.jf_ch_serial}` : ''].filter(Boolean).join(sep);

// ------------------------------------------------------------ форма ↔ данные
function readForm() {
  const data = {};
  for (const key of Object.keys(JF_DEFAULTS)) {
    if (key === 'protocol') data.protocol = currentProtocol();
    else if (['jf_beam_type', 'jf_axis', 'jf_fit'].includes(key)) data[key] = $(`input[name="${key}"]:checked`)?.value ?? JF_DEFAULTS[key];
    else if (key === 'jf_staff') data.jf_staff = readStaff($('#jf-staff-list'));
    else if (key === 'jf_V') data.jf_V = vals('#jf-points-body input[id^="jf_V_"]');
    else if (key === 'jf_M') data.jf_M = vals('#jf-points-body input[id^="jf_M_"]');
    else if (key === 'jf_Mopp') data.jf_Mopp = vals('#jf-points-body input[id^="jf_Mopp_"]');
    else if (key === 'jf_use') data.jf_use = $$('#jf-points-body input[type="checkbox"]').map((c) => c.checked);
    else if (key === 'jf_dpp_cond') data.jf_dpp_cond = vals('#jf-dpp-body input[id^="jf_dpp_cond_"]');
    else if (key === 'jf_dpp_x') data.jf_dpp_x = vals('#jf-dpp-body input[id^="jf_dpp_x_"]');
    else if (key === 'jf_dpp_ks') data.jf_dpp_ks = vals('#jf-dpp-body input[id^="jf_dpp_ks_"]');
    else if (key === 'jf_dpp_m1') data.jf_dpp_m1 = vals('#jf-dpp-body input[id^="jf_dpp_m1_"]');
    else if (key === 'jf_dpp_m2') data.jf_dpp_m2 = vals('#jf-dpp-body input[id^="jf_dpp_m2_"]');
    else {
      const el = document.getElementById(key);
      if (el) data[key] = el.value;
    }
  }
  return data;
}

function writeForm(values) {
  const f = normalizeJaffe(values);
  f.protocol = currentProtocol();
  for (const key of ['jf_beam_type', 'jf_axis', 'jf_fit']) {
    const r = document.getElementById(`${key}_${f[key]}`);
    if (r) r.checked = true;
  }
  renderPoints(f);
  renderDpp(f);
  renderStaff($('#jf-staff-list'), f.jf_staff, update);
  for (const [key, value] of Object.entries(f)) {
    if (Array.isArray(value) || ['protocol', 'jf_beam_type', 'jf_axis', 'jf_fit'].includes(key)) continue;
    const el = document.getElementById(key);
    if (el) el.value = value ?? '';
  }
  localizeDecimals(ROOT());
}

/** Добавить или убрать строку таблицы, сохранив введённое. */
function resizeRows(kind, delta) {
  const f = normalizeJaffe(readForm());
  const keys = kind === 'points' ? ['jf_V', 'jf_M', 'jf_Mopp', 'jf_use'] : ['jf_dpp_cond', 'jf_dpp_x', 'jf_dpp_m1', 'jf_dpp_m2', 'jf_dpp_ks'];
  const min = kind === 'points' ? 3 : 1;
  const n = f[keys[0]].length + delta;
  if (n < min) return;
  for (const k of keys) {
    if (delta > 0) f[k].push(k === 'jf_use' ? true : '');
    else f[k].pop();
  }
  if (kind === 'points') renderPoints(f);
  else renderDpp(f);
  if (delta > 0) {
    const first = kind === 'points' ? `#jf_V_${n - 1}` : `#jf_dpp_cond_${n - 1}`;
    $(first)?.focus();
  }
  update();
}

// ------------------------------------------------------------ вывод: таблицы и графики
function fillRows(r) {
  const byI = new Map(r.points.map((p) => [p.i, p]));
  const manual = r.form.jf_fit === 'manual';
  for (const tr of $$('#jf-points-body tr')) {
    const i = Number(tr.dataset.i);
    const pt = byI.get(i);
    const p = r.fit ? pt : null;
    tr.classList.toggle('empty', !pt);
    const cb = tr.querySelector('input[type="checkbox"]');
    if (!manual) cb.checked = !!p?.inFit;
    tr.classList.toggle('out', !!p && !p.inFit);
    tr.querySelector('[data-o="ks"]').textContent = p ? fmt(p.ks, 4) : '';
    tr.querySelector('[data-o="dev"]').textContent = p ? dev3(p.dev * 100) : '';
    tr.querySelector('[data-o="kpol"]').textContent = p && Number.isFinite(p.kpol) ? fmt(p.kpol, 4) : '';
  }
  const d = r.dpp?.fit ? r.dpp : null;
  const e = r.eq17;
  const byD = new Map((r.dpp?.points || []).map((p) => [p.i, p]));
  for (const tr of $$('#jf-dpp-body tr')) {
    const p = byD.get(Number(tr.dataset.i));
    // k_s по M₁, M₂ — вычислен; иначе поле для готового значения
    const calc = p?.src === 'two';
    tr.classList.toggle('has-m', calc);
    tr.querySelector('output[data-o="ks"]').textContent = calc && Number.isFinite(p.ks) ? fmt(p.ks, 5) : '';
    // отклонение: от прямой по D_pp, если она есть, иначе от прямой ур. 17
    const dv = p && Number.isFinite(p.dev) ? p.dev : p && Number.isFinite(p.dev17) && !d ? p.dev17 : NaN;
    tr.querySelector('[data-o="dev"]').textContent = Number.isFinite(dv) ? dev3(dv) : '';
  }
  $('#jf-b0').textContent = e ? fmt(e.b0, 5) : '—';
  $('#jf-b1').textContent = e ? sig(e.b1, 4) : '—';
  $('#jf-e17-init').textContent = e ? fmt(e.cInit * 100, 3) : '—';
  $('#jf-e17-ksq').textContent = e && Number.isFinite(e.ksQ) ? fmt(e.ksQ, 4) : '—';
  $('#jf-e17-ksref').textContent = e && Number.isFinite(e.ksRef) ? fmt(e.ksRef, 4) : '—';
  $('#jf-e17-ksref-sub').textContent = e && Number.isFinite(e.ksRef) && Number.isFinite(r.ks1)
    ? L(`по графику Яффе ${fmt(r.ks1, 4)} (${fmtSigned((e.ksRef / r.ks1 - 1) * 100, 3)} %); сравнение имеет смысл, если показания сняты при одинаковом числе МЕ`, `from the Jaffé plot ${fmt(r.ks1, 4)} (${fmtSigned((e.ksRef / r.ks1 - 1) * 100, 3)}%); the comparison makes sense if the readings were taken with the same MU`)
    : '';
  $('#jf-cinit').textContent = d ? fmt(d.cInit * 100, 3) : '—';
  $('#jf-cgen').textContent = d ? fmt(d.cGen, 4) : '—';
  $('#jf-cgen-sub').textContent = r.form.jf_dpp_unit === 'rel' ? L('на единицу относительной дозы за импульс', 'per unit of relative dose per pulse') : L('на мГр за импульс', 'per mGy per pulse');
  $('#jf-dpp-dev').textContent = d ? fmt(d.maxDev, 3) : '—';
  // какое значение начальной рекомбинации забирают кнопки «Взять из графика Яффе»
  const use = r.blocked ? null : d ? 'dpp' : e ? 'eq17' : null;
  const useText = L('→ это значение берут кнопки «Взять из графика Яффе» (поправки по глубине)', '→ this value is taken by the "Take from the Jaffé plot" buttons (corrections with depth)');
  $('#jf-e17-use').textContent = use === 'eq17' ? useText : '';
  $('#jf-cinit-use').textContent = use === 'dpp' ? useText : '';
}

let lastResult = null;
function renderCharts(r) {
  lastResult = r;
  renderJaffeChart(r);
  renderDppChart(r);
  renderEq17Chart(r);
}

/** Ур. 17: M₁/M₂ от M₁ по условиям раздела 5. */
function renderEq17Chart(r) {
  const box = $('#jf-e17-chart');
  const e = r.eq17;
  if (!e) {
    box.innerHTML = '';
    return;
  }
  const pm = r.dpp.points.filter((p) => p.src === 'two');
  const xs = pm.map((p) => p.m1);
  const xMax = Math.max(...xs);
  const xMin = Math.min(...xs);
  scatterChart(box, {
    label: L('Ур. 17 TRS-398: M₁/M₂ в зависимости от M₁', 'TRS-398 Eq. 17: M₁/M₂ versus M₁'),
    aspect: 0.4,
    minHeight: 200,
    maxHeight: 260,
    xLabel: L('M₁ при V₁', 'M₁ at V₁'),
    yLabel: 'M₁/M₂',
    fmt,
    xInclude: [0],
    yInclude: [1, e.fit.a],
    series: [{ cls: 's1', shape: 'circle', points: pm.map((p) => ({ x: p.m1, y: p.m1 / p.m2, title: `${p.cond ? `${p.cond}: ` : ''}M₁ = ${fmt(p.m1, 4)}; M₁/M₂ = ${fmt(p.m1 / p.m2, 5)}; ${ksText(r.protocol)} = ${fmt(p.ks17, 5)}` })) }],
    lines: [
      { cls: 's1', a: e.fit.a, b: e.fit.b, x0: xMin, x1: xMax },
      { cls: 's1', a: e.fit.a, b: e.fit.b, x0: 0, x1: xMin, dashed: true },
    ],
    notes: [{ x: 0, y: e.fit.a, text: '1 + b₀', below: true }],
  });
}

function renderJaffeChart(r) {
  const box = $('#jf-chart');
  const legend = $('#jf-legend');
  if (!r.fit) {
    box.innerHTML = `<p class="chart-empty">${L('График появится, когда в таблице будет не меньше трёх точек без ошибок.', 'The plot appears once the table has at least three points without errors.')}</p>`;
    legend.innerHTML = '';
    return;
  }
  const v2 = r.axis === 'v2';
  const K = v2 ? 1e6 : 1e3; // 1/V в кВ⁻¹ (1/V² — в кВ⁻²)
  const KS = ksText(r.protocol);
  const xLabel = v2 ? L('1/V², кВ⁻²', '1/V², kV⁻²') : L('1/V, кВ⁻¹', '1/V, kV⁻¹');
  const tip = (p, opp) => {
    const M = opp ? p.Mopp : p.M;
    const k = opp ? p.ksOpp : p.ks;
    const head = `${V(p.V)}${opp ? L(', обратная полярность', ', opposite polarity') : ''}`;
    return `${head}: M = ${fmt(M, 4)}; ${KS} = ${fmt(k, 4)}${opp ? '' : L(`; откл. от прямой ${fmtSigned(p.dev * 100, 3)} %`, `; deviation from the line ${fmtSigned(p.dev * 100, 3)}%`)}${p.inFit ? '' : L(' — вне линейной области', ' — outside the linear region')}`;
  };
  const series = [{ cls: 's1', shape: 'circle', points: r.points.map((p) => ({ x: p.x * K, y: p.ks, hollow: !p.inFit, title: tip(p, false) })) }];
  const xsAll = r.points.map((p) => p.x * K);
  const xMax = Math.max(...xsAll);
  const win = r.window.map((k) => r.points[k].x * K);
  const wLo = Math.min(...win);
  const wHi = Math.max(...win);
  const slope = (fit) => fit.b / fit.a / K; // y = M_нас/M = 1 + (b/a)·x
  const lines = [
    { cls: 's1', a: 1, b: slope(r.fit), x0: wLo, x1: wHi },
    { cls: 's1', a: 1, b: slope(r.fit), x0: 0, x1: wLo, dashed: true },
    { cls: 's1', a: 1, b: slope(r.fit), x0: wHi, x1: xMax, dashed: true },
  ];
  const hasOpp = !!r.opp;
  if (hasOpp) {
    series.push({ cls: 's2', shape: 'square', points: r.points.filter((p) => Number.isFinite(p.ksOpp)).map((p) => ({ x: p.x * K, y: p.ksOpp, hollow: !p.inFit, title: tip(p, true) })) });
    lines.push({ cls: 's2', a: 1, b: slope(r.opp.fit), x0: 0, x1: xMax, dashed: true });
  }
  const vlines = [];
  if (Number.isFinite(r.V1) && r.V1 > 0) vlines.push({ x: (v2 ? 1 / r.V1 ** 2 : 1 / r.V1) * K, label: `V₁ = ${V(r.V1)}` });
  if (Number.isFinite(r.V2) && r.V2 > 0) vlines.push({ x: (v2 ? 1 / r.V2 ** 2 : 1 / r.V2) * K, label: `V₂ = ${V(r.V2)}` });
  scatterChart(box, {
    label: L(`График Яффе: M_нас/M в зависимости от ${v2 ? '1/V²' : '1/V'}`, `Jaffé plot: M_sat/M versus ${v2 ? '1/V²' : '1/V'}`),
    xLabel,
    yLabel: L(`M_нас/M (= ${KS} при этом V)`, `M_sat/M (= ${KS} at this V)`),
    fmt,
    xInclude: [0],
    yInclude: [1],
    series,
    lines,
    vlines,
    notes: [
      { x: 0, y: 1, text: L('M_нас', 'M_sat'), below: true },
      // подпись у точки с наибольшим напряжением, если выше линейной области идёт умножение заряда
      ...(!r.vMaxOpen && r.messages.some((m) => m.id === 'mult') ? [{ x: r.points[r.points.length - 1].x * K, y: r.points[r.points.length - 1].ks, text: L('умножение заряда', 'charge multiplication'), below: true, anchor: 'middle' }] : []),
    ],
  });
  const items = [
    [legendSwatch({ shape: 'circle', cls: 's1' }), L('Обычная полярность', 'Normal polarity')],
    ...(hasOpp ? [[legendSwatch({ shape: 'square', cls: 's2' }), L('Обратная полярность', 'Opposite polarity')]] : []),
    [legendSwatch({ line: true, cls: 's1' }), L('Прямая по линейной области', 'Line through the linear region')],
    [legendSwatch({ line: true, dashed: true, cls: 's1' }), L('Продолжение прямой', 'Line extension')],
    ...(r.points.some((p) => !p.inFit) ? [[legendSwatch({ shape: 'circle', cls: 's1', hollow: true }), L('Вне линейной области', 'Outside the linear region')]] : []),
  ];
  legend.innerHTML = items.map(([sw, t]) => `<span class="item">${sw}${esc(t)}</span>`).join('');
}

function renderDppChart(r) {
  const box = $('#jf-dpp-chart');
  const d = r.dpp?.fit ? r.dpp : null;
  if (!d || !r.pulsed) {
    box.innerHTML = '';
    return;
  }
  const KS = ksText(r.protocol);
  const unit = r.form.jf_dpp_unit === 'rel' ? L('отн. ед.', 'rel. units') : L('мГр', 'mGy');
  const xs = d.points.map((p) => p.x);
  const xMax = Math.max(...xs);
  const xMin = Math.min(...xs);
  scatterChart(box, {
    label: L(`${KS} в зависимости от дозы за импульс`, `${KS} versus dose per pulse`),
    aspect: 0.4,
    minHeight: 200,
    maxHeight: 260,
    xLabel: L(`D_pp, ${unit}`, `D_pp, ${unit}`),
    yLabel: KS,
    fmt,
    xInclude: [0],
    yInclude: [1, d.fit.a],
    series: [{ cls: 's1', shape: 'circle', points: d.points.map((p) => ({ x: p.x, y: p.ks, title: `${p.cond ? `${p.cond}: ` : ''}D_pp = ${fmt(p.x, 3)} ${unit}; ${KS} = ${fmt(p.ks, 5)}` })) }],
    lines: [
      { cls: 's1', a: d.fit.a, b: d.fit.b, x0: xMin, x1: xMax },
      { cls: 's1', a: d.fit.a, b: d.fit.b, x0: 0, x1: xMin, dashed: true },
    ],
    notes: [{ x: 0, y: d.fit.a, text: '1 + C_init', below: true }],
  });
}

// ------------------------------------------------------------ табло, проверки, сводка
function renderReadout(r) {
  const KS = ksHtml(r.protocol);
  const proto = `${esc(beamName(r.beam))} · ${PROTO[r.protocol]}`;
  const fails = (r.checks || []).filter((c) => c.status === 'fail').length;
  const warns = (r.messages || []).filter((m) => m.level === 'warn').length;
  const chip = r.blocked
    ? ''
    : fails
      ? `<span class="chip bad">${esc(L(`проверок не выполнено: ${fails}`, `checks not met: ${fails}`))}</span>`
      : warns
        ? `<span class="chip warn">${esc(L(`предупреждений: ${warns}`, `warnings: ${warns}`))}</span>`
        : `<span class="chip good">${esc(L('проверки выполнены', 'checks met'))}</span>`;
  if (r.blocked || !Number.isFinite(r.ks1)) {
    $('#jf-result').innerHTML = `<div class="dose-row blocked"><div class="proto"><span>${proto}</span>${chip}</div><div class="dose-big">—</div><div class="secondary">${esc(L('Нет результата: исправьте ошибки в данных (см. замечания).', 'No result: correct the errors in the data (see Messages).'))}</div></div>`;
    $('#jf-mobile-value').innerHTML = '—';
    return;
  }
  const lines = [];
  lines.push(L(`M<sub>нас</sub> = ${fmt(r.Msat, 4)} нКл`, `M<sub>sat</sub> = ${fmt(r.Msat, 4)} nC`) + (Number.isFinite(r.uMsatRel) ? ` (u = ${pct(r.uMsatRel * 100, 3)})` : ''));
  lines.push(L(`Линейная область ${fmt(r.vLow, 0)}–${fmt(r.vHigh, 0)} В`, `Linear region ${fmt(r.vLow, 0)}–${fmt(r.vHigh, 0)} V`) + (r.vMaxOpen ? L(' (умножения заряда в измеренном диапазоне нет)', ' (no charge multiplication in the measured range)') : `; V<sub>max</sub> = ${V(r.vMax)}`));
  if (r.two && Number.isFinite(r.two.value)) lines.push(L(`Метод двух напряжений: ${fmt(r.two.value, 4)} (${pctS(r.two.diffPct)})`, `Two-voltage method: ${fmt(r.two.value, 4)} (${pctS(r.two.diffPct)})`));
  if (r.opp) lines.push(L(`Обратная полярность: ${fmt(r.opp.ks1, 4)} (${pctS(r.opp.diffPct)})`, `Opposite polarity: ${fmt(r.opp.ks1, 4)} (${pctS(r.opp.diffPct)})`));
  $('#jf-result').innerHTML = `<div class="dose-row">
    <div class="proto"><span>${proto}</span>${chip}</div>
    <div class="dose-big">${KS} = ${fmt(r.ks1, 4)}<small>${esc(L(`при V₁ = ${V(r.V1)}`, `at V₁ = ${V(r.V1)}`))}</small></div>
    <div class="secondary">${lines.join('<br>')}</div>
  </div>`;
  $('#jf-mobile-value').innerHTML = `${KS} = <b>${fmt(r.ks1, 4)}</b>${r.vMaxOpen ? '' : ` · V<sub>max</sub> = ${V(r.vMax)}`}`;
}

const STATUS = {
  ok: () => ['✓', L('выполнено', 'met')],
  fail: () => ['✗', L('не выполнено', 'not met')],
  na: () => ['—', L('нет данных', 'no data')],
};

function renderChecks(r) {
  const el = $('#jf-checks');
  if (r.blocked || !r.checks) {
    el.innerHTML = `<li class="na"><span class="st">—</span><span class="txt">${esc(L('Проверки появятся, когда будет результат.', 'The checks appear once there is a result.'))}</span></li>`;
    return;
  }
  el.innerHTML = r.checks
    .map((c) => {
      const [icon, word] = STATUS[c.status]();
      return `<li class="${c.status}"><span class="st"><span aria-hidden="true">${icon}</span> ${esc(word)}</span><span class="txt">${rich(c.label)}</span><span class="val">${rich(c.value)}</span><span class="ref">${esc(refText(c.ref))}</span></li>`;
    })
    .join('');
}

function renderMessages(r) {
  const lvlName = { error: L('Ошибка', 'Error'), warn: L('Внимание', 'Warning'), info: L('Справка', 'Note') };
  $('#jf-messages').innerHTML = r.messages.length
    ? r.messages.map((m) => `<li class="${m.level}"><span class="lvl">${lvlName[m.level]}</span><span>${richText(m.text)}</span>${m.ref ? `<span class="ref">${esc(refText(m.ref))}</span>` : ''}</li>`).join('')
    : `<li class="info"><span class="lvl">${L('Всё в порядке', 'All clear')}</span><span>${L('Замечаний к введённым данным нет.', 'No issues with the entered data.')}</span></li>`;
}

/** Строки сводки: [подпись (HTML), значение (HTML)]. */
function summaryRows(r) {
  const KS = ksHtml(r.protocol);
  const v2 = r.axis === 'v2';
  const rows = [
    [L('Протокол', 'Protocol'), PROTO[r.protocol]],
    [L('Камера', 'Chamber'), r.chamber ? esc(`${r.chamber.label}${r.chamber.type ? ` (${r.chamber.type === 'pp' ? L('плоскопараллельная', 'plane-parallel') : L('цилиндрическая', 'cylindrical')})` : ''}`) : '—'],
    [L('Пучок', 'Beam'), esc(beamName(r.beam))],
    [L('Ось графика', 'Plot axis'), v2 ? '1/V²' : '1/V'],
    [L('Линейная область', 'Linear region'), r.form.jf_fit === 'manual' ? L('выбрана вручную', 'selected manually') : L(`автоматически, допуск ${pct(r.tol, 2)}`, `automatic, tolerance ${pct(r.tol, 2)}`)],
  ];
  if (!r.fit) return rows;
  const A = r.fit.b / r.fit.a;
  rows.push(
    [L('Точек всего / в прямой', 'Points total / in the fit'), `${r.points.length} / ${r.window.length}`],
    [L('Напряжения в прямой', 'Voltages in the fit'), `${fmt(r.vLow, 0)}–${fmt(r.vHigh, 0)} ${L('В', 'V')}`],
    [L('Наибольшее отклонение в прямой, %', 'Largest deviation in the fit, %'), fmt(r.maxDevPct, 3)],
    [L('M<sub>нас</sub>, нКл', 'M<sub>sat</sub>, nC'), fmt(r.Msat, 4)],
    [L('u(M<sub>нас</sub>) по разбросу точек, %', 'u(M<sub>sat</sub>) from the scatter, %'), Number.isFinite(r.uMsatRel) ? fmt(r.uMsatRel * 100, 3) : '—'],
    [v2 ? L(`${KS}(V) = 1 + B/V², B, В²`, `${KS}(V) = 1 + B/V², B, V²`) : L(`${KS}(V) = 1 + A/V, A, В`, `${KS}(V) = 1 + A/V, A, V`), fmt(A, v2 ? 0 : 3)],
    ['V<sub>max</sub>', r.vMaxOpen ? L(`не ниже ${V(r.vHigh)}`, `at least ${V(r.vHigh)}`) : V(r.vMax)],
  );
  if (Number.isFinite(r.ks1)) {
    rows.push([L(`${KS} при V₁ = ${V(r.V1)}: по показанию (M<sub>нас</sub>/M₁)`, `${KS} at V₁ = ${V(r.V1)}: from the reading (M<sub>sat</sub>/M₁)`), Number.isFinite(r.ks1Meas) ? fmt(r.ks1Meas, 4) : '—']);
    rows.push([L(`${KS} при V₁: по прямой`, `${KS} at V₁: from the line`), fmt(r.ks1Line, 4)]);
  }
  if (r.two && Number.isFinite(r.two.value)) {
    rows.push([L(`Метод двух напряжений, V₁/V₂ = ${fmt(r.two.n, 2)} (${rich(r.two.equation)})`, `Two-voltage method, V₁/V₂ = ${fmt(r.two.n, 2)} (${rich(r.two.equation)})`), fmt(r.two.value, 4)]);
    rows.push([L('Отличие от графика, %', 'Difference from the plot, %'), fmtSigned(r.two.diffPct, 3)]);
  }
  if (r.opp) {
    rows.push([L(`${KS} при V₁, обратная полярность`, `${KS} at V₁, opposite polarity`), fmt(r.opp.ks1, 4)]);
    rows.push([L('Отличие от обычной полярности, %', 'Difference from the normal polarity, %'), fmtSigned(r.opp.diffPct, 3)]);
    if (Number.isFinite(r.kpolMin)) rows.push([L('k<sub>pol</sub> в линейной области', 'k<sub>pol</sub> in the linear region'), r.kpolMax - r.kpolMin < 5e-5 ? fmt(r.kpolMin, 4) : `${fmt(r.kpolMin, 4)}–${fmt(r.kpolMax, 4)}`]);
  }
  if (Number.isFinite(r.cInit)) rows.push([L('Начальная рекомбинация, %', 'Initial recombination, %'), fmt(r.cInit * 100, 3)]);
  if (r.eq17) {
    const e = r.eq17;
    rows.push([L('Ур. 17: b₀ / b₁', 'Eq. 17: b₀ / b₁'), `${fmt(e.b0, 5)} / ${sig(e.b1, 4)}`]);
    rows.push([L('Ур. 17: начальная рекомбинация b₀/(n − 1), %', 'Eq. 17: initial recombination b₀/(n − 1), %'), fmt(e.cInit * 100, 3)]);
    if (Number.isFinite(e.ksRef)) rows.push([L(`Ур. 17: ${KS} при M₁ из раздела 3`, `Eq. 17: ${KS} at M₁ of section 3`), fmt(e.ksRef, 4)]);
    if (Number.isFinite(e.ksQ)) rows.push([L(`Ур. 17: ${KS} при M₁ = ${esc(r.form.jf_dpp_mq)}`, `Eq. 17: ${KS} at M₁ = ${esc(r.form.jf_dpp_mq)}`), fmt(e.ksQ, 4)]);
  }
  if (r.dpp?.fit) {
    rows.push(['C<sub>init</sub>, %', fmt(r.dpp.cInit * 100, 3)]);
    rows.push([r.form.jf_dpp_unit === 'rel' ? L('C<sub>gen</sub>, на отн. ед.', 'C<sub>gen</sub>, per rel. unit') : L('C<sub>gen</sub>, на мГр', 'C<sub>gen</sub>, per mGy'), fmt(r.dpp.cGen, 4)]);
  }
  return rows;
}

function renderSummary(r) {
  $('#jf-factors').innerHTML =
    `<thead><tr><th>${L('Величина', 'Quantity')}</th><th>${L('Значение', 'Value')}</th></tr></thead><tbody>` +
    summaryRows(r).map(([k, x]) => `<tr><td>${k}</td><td class="v">${x}</td></tr>`).join('') +
    '</tbody>';
}

// ------------------------------------------------------------ протокол текстом
const plain = (html) => String(html).replace(/<sub>(.*?)<\/sub>/g, '_$1').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function reportText(data, r) {
  const out = [];
  const line = (k, val) => out.push(`${k}: ${val}`);
  out.push(L('ГРАФИК ЯФФЕ — ПРОВЕРКА СИСТЕМЫ КАМЕРА — КАБЕЛЬ — ЭЛЕКТРОМЕТР', 'JAFFÉ PLOT — CHAMBER–CABLE–ELECTROMETER SYSTEM CHECK'));
  line(L('Протокол', 'Protocol'), PROTO[r.protocol]);
  line(L('Калькулятор', 'Calculator'), versionText());
  line(L('Учреждение', 'Institution'), data.jf_institution || '—');
  line(L('Дата', 'Date'), data.jf_date || '—');
  line(L('Выполнил', 'Performed by'), data.jf_staff.filter((s) => s.trim()).join(', ') || '—');
  line(L('Камера', 'Chamber'), chamberText(data) || '—');
  line(L('Электрометр', 'Electrometer'), [data.jf_electrometer, data.jf_el_serial && `№ ${data.jf_el_serial}`].filter(Boolean).join(', ') || '—');
  line(L('Кабель', 'Cable'), data.jf_cable || '—');
  line(L('Аппарат и пучок', 'Machine and beam'), [data.jf_machine, data.jf_beam].filter(Boolean).join(', ') || '—');
  line(L('Тип пучка', 'Beam type'), beamName(r.beam));
  line(L('Условия облучения', 'Irradiation conditions'), data.jf_conditions || '—');
  line(L('Напряжения', 'Voltages'), [Number.isFinite(r.vMan) && L(`производителя ${V(r.vMan)}`, `manufacturer ${V(r.vMan)}`), Number.isFinite(r.V1) && `V₁ = ${V(r.V1)}`, Number.isFinite(r.V2) && `V₂ = ${V(r.V2)}`].filter(Boolean).join('; ') || '—');
  out.push('');
  const KS = ksText(r.protocol);
  out.push(L(`Показания (V, В — M — M обр. — ${KS} = M_нас/M — откл. от прямой, % — k_pol):`, `Readings (V, V — M — M opp. — ${KS} = M_sat/M — deviation from the line, % — k_pol):`));
  for (const p of r.points) {
    // показания — как введены (с тем числом знаков, что дал электрометр)
    const raw = (v) => String(v ?? '').trim().replace(/^[+−-]/, '');
    const cells = [fmt(p.V, 0), raw(data.jf_M[p.i]), Number.isFinite(p.Mopp) ? raw(data.jf_Mopp[p.i]) : '—', r.fit ? fmt(p.ks, 4) : '—', r.fit ? dev3(p.dev * 100) : '—', Number.isFinite(p.kpol) ? fmt(p.kpol, 4) : '—'];
    out.push(`  ${cells.join(' — ')}${r.fit && !p.inFit ? L(' (вне линейной области)', ' (outside the linear region)') : ''}`);
  }
  if (r.dpp?.points?.length) {
    const unit = r.form.jf_dpp_unit === 'rel' ? L('отн. ед.', 'rel. units') : L('мГр', 'mGy');
    out.push('', L(`Разные мощности дозы (условие — D_pp, ${unit} — M₁ — M₂ — ${KS}):`, `Different dose rates (condition — D_pp, ${unit} — M₁ — M₂ — ${KS}):`));
    const raw = (v) => (String(v ?? '').trim() || '—');
    for (const p of r.dpp.points) out.push(`  ${p.cond || '—'} — ${Number.isFinite(p.x) ? fmt(p.x, 3) : '—'} — ${p.src === 'two' ? `${raw(data.jf_dpp_m1[p.i])} — ${raw(data.jf_dpp_m2[p.i])}` : '— — —'} — ${Number.isFinite(p.ks) ? fmt(p.ks, 5) : '—'}${p.src === 'two' ? L(' (метод двух напряжений)', ' (two-voltage method)') : ''}`);
  }
  out.push('', L('Результаты:', 'Results:'));
  for (const [k, v] of summaryRows(r)) out.push(`  ${plain(k)}: ${plain(v)}`);
  if (r.checks) {
    out.push('', L('Проверки системы:', 'System checks:'));
    for (const c of r.checks) out.push(`  [${STATUS[c.status]()[1]}] ${c.label}: ${c.value} (${refText(c.ref)})`);
  }
  const msgs = r.messages.filter((m) => m.level !== 'info');
  if (msgs.length) {
    out.push('', L('Замечания:', 'Messages:'));
    msgs.forEach((m) => out.push(`- ${m.text}${m.ref ? ` [${refText(m.ref)}]` : ''}`));
  }
  if (data.jf_notes) out.push('', `${L('Примечания', 'Notes')}: ${data.jf_notes}`);
  out.push('', closingNote());
  return out.join('\n');
}

const closingNote = () =>
  L(
    'Прямая проводится методом наименьших квадратов по точкам линейной области; k_s = M_нас/M (TRS-398 Rev.1, разд. 4.4.3.4, ур. 15; WGTG51 Report 374, прил. A). Значения приводятся с четырьмя знаками: это точность вычислений, а не измерения.',
    'The line is a least-squares fit to the points of the linear region; k_s = M_sat/M (TRS-398 Rev.1, Sec. 4.4.3.4, Eq. 15; WGTG51 Report 374, App. A). Values are given with four decimals: this is computational precision, not measurement accuracy.',
  );

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

function snapshot(r) {
  const num = (x) => (Number.isFinite(x) ? x : null);
  return { protocol: r.protocol, value: num(r.ks1), Msat: num(r.Msat), vMax: num(r.vMax) };
}
const SNAP_CMP = { keys: ['value', 'Msat', 'vMax'], main: 'value', digits: 4, unit: '' };

export function importJaffe(obj) {
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

/**
 * Начальная рекомбинация по графику Яффе — для поправки на рекомбинацию по глубине в «Кривой дозы электронов»:
 * C_init по дозе за импульс (аддендум TG-51), иначе b₀/(n − 1) по ур. 17 TRS-398. null, если её нет.
 */
export function jaffeRecInfo() {
  const r = current.result;
  if (!r || r.blocked) return null;
  const d = current.data || {};
  const sys = { chamber: chamberText(d, ' '), date: d.jf_date || '' };
  if (r.dpp?.fit) return { cInit: r.dpp.cInit, source: 'dpp', ...sys };
  if (r.eq17) return { cInit: r.eq17.cInit, source: 'eq17', ...sys };
  if (!r.pulsed && Number.isFinite(r.cInit)) return { cInit: r.cInit, source: 'cont', ...sys };
  return null;
}

/** Откуда взята начальная рекомбинация — подпись у кнопки «Взять из графика Яффе». */
export function jaffeSourceText(info) {
  const how = {
    dpp: L('по дозе за импульс (раздел 5)', 'from the dose per pulse (section 5)'),
    eq17: L('b₀/(n − 1) по ур. 17 (раздел 5)', 'b₀/(n − 1) per Eq. 17 (section 5)'),
    cont: L('k_s − 1 при оси 1/V (непрерывный пучок)', 'k_s − 1 on the 1/V axis (continuous beam)'),
  }[info.source];
  const who = [info.chamber, info.date ? dateText(info.date) : ''].filter(Boolean).join(', ');
  return L(`Из «Графика Яффе»${who ? ` (${who})` : ''}: C_init ${how}. Проверьте, что это та же камера.`, `From the Jaffé plot${who ? ` (${who})` : ''}: C_init ${how}. Check that it is the same chamber.`);
}
let openedFile = null;
function update() {
  const data = readForm();
  const r = computeJaffe(data);
  current = { data: r.form, result: r };
  applyShowRules(ROOT(), r.form, r.protocol);
  fillRows(r);
  renderFlags(ROOT(), r.flags);
  renderCharts(r);
  renderReadout(r);
  renderChecks(r);
  renderMessages(r);
  renderSummary(r);
  $('#jf-demo-flag').hidden = !isDemo(data);
  renderNotesFlag($('#jf-notes-flag'), data.jf_notes, [SAMPLE_JAFFE.jf_notes, SAMPLE_JAFFE_EN.jf_notes], isDemo(data));
  renderFileNote($('#jf-file-note'), openedFile ? compareWithFile(openedFile, snapshot(r), SNAP_CMP) : null);
  saveDraft(current.data);
  renderSignBlock($('#jf-sign'), r.form.jf_staff, closingNote());
  notifyUpdate(ROOT());
}

/** Демонстрационные условия в таблице дозы за импульс — на языке интерфейса (свои не трогаются). */
function localizeDppDemo() {
  const en = getLang() === 'en';
  SAMPLE_JAFFE.jf_dpp_cond.forEach((ruV, i) => {
    const enV = SAMPLE_JAFFE_EN.jf_dpp_cond[i];
    const el = document.getElementById(`jf_dpp_cond_${i}`);
    if (el && el.value === (en ? ruV : enV)) el.value = en ? enV : ruV;
  });
}

function refreshForLang() {
  fillChambers();
  const f = normalizeJaffe(readForm());
  renderPoints(f);
  renderDpp(f);
  renderStaff($('#jf-staff-list'), f.jf_staff, update);
  localizeDemo(SAMPLE_JAFFE, SAMPLE_JAFFE_EN);
  localizeDppDemo();
  localizeDecimals(ROOT());
  update();
}

export function initJaffe() {
  setStatus = makeStatus($('#jf-status'));
  $$('#jf-sheet > section .combo').forEach((c) => makeCombo(c));
  fillChambers();

  const draft = loadDraft();
  writeForm(draft ? draft : sampleData());
  localizeDemo(SAMPLE_JAFFE, SAMPLE_JAFFE_EN);
  localizeDppDemo();
  update();
  if (!draft) setStatus(L('Загружен демонстрационный пример. Нажмите «Очистить», чтобы ввести свои данные.', 'Demo example loaded. Click "Clear" to enter your own data.'));

  const sheet = $('#jf-sheet');
  sheet.addEventListener('input', (e) => {
    openedFile = null;
    // флажок «В прямой» при автоматическом выборе переключает на ручной: отмеченное сохраняется
    if (e.target.matches?.('#jf-points-body input[type="checkbox"]')) $('#jf_fit_manual').checked = true;
    update();
  });
  sheet.addEventListener('change', () => {
    openedFile = null;
    update();
  });
  document.addEventListener('change', (e) => {
    if (e.target.name !== 'protocol') return;
    // обозначение k_s / P_ion в подписях строк
    const f = normalizeJaffe(readForm());
    renderPoints(f);
    renderDpp(f);
    localizeDecimals(ROOT());
    update();
  });
  document.addEventListener('langchange', refreshForLang);

  // графики по ширине контейнера: перерисовать при изменении ширины (в том числе когда подраздел открылся)
  if (typeof ResizeObserver === 'function') {
    const widths = new WeakMap();
    const ro = new ResizeObserver((entries) => {
      if (!lastResult) return;
      for (const e of entries) {
        const w = Math.round(e.contentRect.width);
        if (!w || widths.get(e.target) === w) continue;
        widths.set(e.target, w);
        if (e.target.id === 'jf-chart') renderJaffeChart(lastResult);
        else if (e.target.id === 'jf-e17-chart') renderEq17Chart(lastResult);
        else renderDppChart(lastResult);
      }
    });
    ro.observe($('#jf-chart'));
    ro.observe($('#jf-dpp-chart'));
    ro.observe($('#jf-e17-chart'));
  }

  $('#jf-btn-add-row').addEventListener('click', () => resizeRows('points', 1));
  $('#jf-btn-remove-row').addEventListener('click', () => resizeRows('points', -1));
  $('#jf-btn-add-dpp').addEventListener('click', () => resizeRows('dpp', 1));
  $('#jf-btn-remove-dpp').addEventListener('click', () => resizeRows('dpp', -1));
  $('#jf-btn-add-staff').addEventListener('click', () => {
    const cur = readStaff($('#jf-staff-list'));
    cur.push('');
    renderStaff($('#jf-staff-list'), cur, update);
    $$('#jf-staff-list .staff-input').at(-1).focus();
    update();
  });

  $('#jf-btn-sample').addEventListener('click', () => {
    openedFile = null;
    writeForm(sampleData());
    update();
    setStatus(L('Загружен демонстрационный пример (вымышленные данные).', 'Demo example loaded (fictitious data).'));
  });
  armButton($('#jf-btn-clear'), () => L('Очистить', 'Clear'), () => L('Точно очистить?', 'Clear everything?'), () => {
    const beam = $('input[name="jf_beam_type"]:checked')?.value;
    writeForm({ ...JF_DEFAULTS, jf_beam_type: beam, jf_date: today() });
    openedFile = null;
    update();
    setStatus(L('Форма очищена.', 'Form cleared.'));
  });

  const payload = () => JSON.stringify({ ...FILE_TAG, ...fileStamp(snapshot(current.result)), savedAt: new Date().toISOString(), form: current.data }, null, 2);
  $('#jf-btn-save').addEventListener('click', () => {
    const name = [jaffeChamber(current.data)?.label, current.data.jf_ch_serial, current.data.jf_date].filter(Boolean).join('_').replace(/[^\p{L}\p{N}_.-]+/gu, '-') || 'jaffe';
    downloadText(payload(), `jaffe_${name}.json`);
    setStatus(L('Файл сохранён.', 'File saved.'));
  });
  $('#jf-btn-load').addEventListener('click', () => $('#jf-file-input').click());
  $('#jf-file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      importJaffe(JSON.parse(await file.text()));
      setStatus(L(`Открыт файл ${file.name}.`, `Opened file ${file.name}.`));
    } catch (err) {
      setStatus(err instanceof SyntaxError ? L('Файл повреждён: это не JSON.', 'The file is damaged: it is not JSON.') : err.message);
    }
    e.target.value = '';
  });
  $('#jf-btn-copy-json').addEventListener('click', () =>
    copyText(payload(), L('Данные скопированы. Чтобы вставить их обратно, нажмите Ctrl+V на странице вне полей ввода.', 'Data copied. To paste them back, press Ctrl+V on the page outside the input fields.'), setStatus),
  );
  $('#jf-btn-copy-report').addEventListener('click', () => copyText(reportText(current.data, current.result), L('Протокол скопирован в буфер обмена.', 'Report copied to the clipboard.'), setStatus));
  $('#jf-btn-pdf').addEventListener('click', () => printToPdf([L('График Яффе', 'Jaffe plot'), jaffeChamber(current.data)?.label, current.data.jf_ch_serial, current.data.jf_date].filter(Boolean).join('_'), setStatus));
  $('#jf-btn-print').addEventListener('click', () => window.print());
}
