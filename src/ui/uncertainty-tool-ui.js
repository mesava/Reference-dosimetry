// Вкладка «Инструменты» → «Неопределённость»: бюджет неопределённости поглощённой дозы (ядро — core/uncertainty-tool.js,
// образцы — core/uncertainty.js). Данные можно взять с вкладки дозиметрии; сами вкладки дозиметрии бюджет не показывают.
import { computeUncertaintyTool, UT_DEFAULTS, UT_UNITS, ROUTES, normalizeUncTool, unitText } from '../core/uncertainty-tool.js';
import { SAMPLE_UNC, SAMPLE_UNC_EN } from '../core/sample-uncertainty.js';
import { L, getLang, refText } from '../core/i18n.js';
import { localizeDecimals } from './i18n.js';
import { makeCombo, renderCells, readCells, setupCells, renderStaff, readStaff } from './widgets.js';
import { setupBudget, renderBudget, budgetDoseText, budgetReportLines, fmt2sig } from './uncertainty-ui.js';
import {
  $, $$, localizeDemo, fmt, esc, today, makeStatus, copyText, downloadText, currentProtocol, renderOutputs, renderFlags, applyShowRules,
  armButton, renderSignBlock, printToPdf, fileStamp, checkFileFormat, compareWithFile, renderFileNote, versionText, renderNotesFlag, notifyUpdate, flashFields, richText, plainSymbols } from './common.js';

const DRAFT_KEY = 'reference-dosimetry.uncertainty.v1';
const FILE_TAG = { app: 'reference-dosimetry', module: 'uncertainty', version: 1 };
const ROOT = () => document.getElementById('module-uncertainty');
let setStatus = () => {};
export const uncToolStatus = (text) => setStatus(text);

/** Источники данных с вкладок дозиметрии: задаёт app.js (функции вкладок, возвращающие их текущие данные). */
let sources = {};
export const setUncSources = (s) => {
  sources = s || {};
};

const PROTO = { trs: { name: 'TRS-398 Rev.1' }, tg51: { name: 'TG-51' } };
const BEAM_NAME = { co60: () => '⁶⁰Co', photons: () => L('МВ фотоны', 'MV photons'), electrons: () => L('Электроны', 'Electrons') };

// ------------------------------------------------------------ списки
const routeText = (beam, r) =>
  ({
    lab: L('В лаборатории: N_D,w в ⁶⁰Co по свидетельству', 'At the laboratory: N_D,w in ⁶⁰Co from the certificate'),
    crossCo: L('Перекрёстно в ⁶⁰Co по опорной камере', 'Cross-calibrated in ⁶⁰Co against the reference chamber'),
    crossQ:
      beam === 'electrons'
        ? L('Перекрёстно в пучке электронов высокой энергии', 'Cross-calibrated in a high-energy electron beam')
        : L('Перекрёстно в клиническом пучке МВ фотонов (TRS-398, разд. 4.5.2)', 'Cross-calibrated in a clinical MV photon beam (TRS-398, Sec. 4.5.2)'),
  })[r];

function fillRoutes(beam) {
  const sel = $('#unc_route');
  const keep = sel.value;
  sel.innerHTML = ROUTES[beam].map((r) => `<option value="${r}">${esc(plainSymbols(routeText(beam, r)))}</option>`).join('');
  sel.value = ROUTES[beam].includes(keep) ? keep : 'lab';
}
function fillUnits() {
  const sel = $('#unc_unit');
  const keep = sel.value;
  sel.innerHTML = Object.keys(UT_UNITS).map((k) => `<option value="${k}">${esc(unitText(k))}</option>`).join('');
  if (keep) sel.value = keep;
}

const currentBeam = () => $('input[name="unc_beam_type"]:checked')?.value ?? 'photons';
const sampleData = () => (getLang() === 'en' ? { ...SAMPLE_UNC, ...SAMPLE_UNC_EN } : SAMPLE_UNC);
const isDemo = (d) => [SAMPLE_UNC.unc_institution, SAMPLE_UNC_EN.unc_institution].includes(d.unc_institution) && [SAMPLE_UNC.unc_machine, SAMPLE_UNC_EN.unc_machine].includes(d.unc_machine);

// ------------------------------------------------------------ форма ↔ данные
const seriesBox = () => $('#unc-sheet .cells[data-series="unc_M"]');

function readForm() {
  const data = {};
  for (const key of Object.keys(UT_DEFAULTS)) {
    if (key === 'protocol') data.protocol = currentProtocol();
    else if (key === 'unc_beam_type') data.unc_beam_type = currentBeam();
    else if (key === 'unc_staff') data.unc_staff = readStaff($('#unc-staff-list'));
    else if (key === 'unc_M') data.unc_M = readCells(seriesBox());
    else {
      const el = document.getElementById(key);
      if (!el) continue;
      data[key] = el.type === 'checkbox' ? el.checked : el.value;
    }
  }
  return data;
}

function writeForm(values) {
  const data = normalizeUncTool(values);
  const r = document.getElementById(`unc_beam_type_${data.unc_beam_type}`);
  if (r) r.checked = true;
  fillRoutes(data.unc_beam_type);
  for (const [key, value] of Object.entries(data)) {
    if (key === 'protocol' || key === 'unc_beam_type') continue;
    if (key === 'unc_staff') renderStaff($('#unc-staff-list'), value, update);
    else if (key === 'unc_M') renderCells(seriesBox(), value);
    else {
      const el = document.getElementById(key);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!value;
      else el.value = value ?? '';
    }
  }
  localizeDecimals(ROOT());
}

// ------------------------------------------------------------ видимость и подписи
function applyVisibility(data, r) {
  applyShowRules(ROOT(), data, r.protocol);
  const sub = $('#unc-route-sub');
  if (r.route === 'lab') sub.textContent = '';
  else if (r.beam === 'electrons' && r.route === 'crossQ') {
    sub.textContent = L(
      'Типовой бюджет — для перекрёстно откалиброванной камеры: TRS-398, табл. 24 (столбец цилиндрической камеры, разд. 7.10) или Report 385, табл. 9.',
      'The example is for a cross-calibrated chamber: TRS-398, Table 24 (cylindrical chamber column, Sec. 7.10) or Report 385, Table 9.',
    );
  } else {
    sub.textContent = L(
      'В бюджет добавляется строка «Перекрёстная калибровка рабочей камеры», 0,6 %: в квадратуре она увеличивает u_c примерно на 0,2 % — так эту прибавку оценивает TRS-398 (разд. 5.7, 6.8).',
      'A “Cross-calibration of the field chamber” row of 0.6% is added to the budget: added in quadrature, it increases u_c by about 0.2%, which is how TRS-398 estimates this increase (Secs. 5.7, 6.8).',
    );
  }
  const t = r.typeA;
  $('#unc-typea-sub').textContent = t
    ? L(`по ${t.n} показаниям; s/√n относительно среднего`, `from ${t.n} readings; s/√n relative to the mean`)
    : L('нужно не меньше двух показаний', 'at least two readings are needed');
}

// ------------------------------------------------------------ вывод
function renderReadout(r) {
  const b = r.budget;
  const unit = unitText(r.unit);
  const own = b.rows.filter((x) => x.over).length;
  const src = own ? L(`своих строк: ${own}`, `own rows: ${own}`) : b.cert ? L('с U из свидетельства', 'with certificate U') : L('типовой бюджет', 'typical budget');
  const lines = [
    L(`u<sub>c</sub> = ${fmt(b.ucPct, 2)} % (k = 1)`, `u<sub>c</sub> = ${fmt(b.ucPct, 2)}% (k = 1)`),
    Number.isFinite(r.abs) ? L(`Для результата ${fmt(r.value, r.value >= 10 ? 2 : 4)} ${esc(unit)}: ±${fmt2sig(r.abs)} ${esc(unit)}`, `For the result ${fmt(r.value, r.value >= 10 ? 2 : 4)} ${esc(unit)}: ±${fmt2sig(r.abs)} ${esc(unit)}`) : L('Введите результат дозиметрии в разделе 3, чтобы получить U в единицах дозы', 'Enter the dosimetry result in section 3 to get U in dose units'),
    esc(b.template.title),
  ];
  $('#unc-result').innerHTML = `<div class="dose-row">
    <div class="proto"><span>${esc(BEAM_NAME[r.beam]())} · ${esc(PROTO[r.protocol].name)}</span><span class="chip ${b.custom ? 'good' : ''}">${esc(src)}</span></div>
    <div class="dose-big">±${fmt(b.UPct, 1)} %<small>U (k = 2)</small></div>
    <div class="secondary">${lines.join('<br>')}</div>
  </div>`;
  $('#unc-mobile-value').innerHTML = `U = <b>±${fmt(b.UPct, 1)} %</b> (k = 2)`;

  const lvlName = { error: L('Ошибка', 'Error'), warn: L('Внимание', 'Warning'), info: L('Справка', 'Note') };
  $('#unc-messages').innerHTML = r.messages.length
    ? r.messages.map((m) => `<li class="${m.level}"><span class="lvl">${lvlName[m.level]}</span><span>${richText(m.text)}</span>${m.ref ? `<span class="ref">${esc(refText(m.ref))}</span>` : ''}</li>`).join('')
    : `<li class="info"><span class="lvl">${L('Всё в порядке', 'All clear')}</span><span>${L('Замечаний к введённым данным нет.', 'No issues with the entered data.')}</span></li>`;

  const v = (x, d = 2) => (Number.isFinite(x) ? fmt(x, d) : '—');
  const rows = [
    [L('Типовой бюджет', 'Typical budget'), esc(refText(b.template.ref))],
    [L('U из свидетельства', 'U from the certificate'), b.cert ? L(`${fmt(b.cert.U, 2)} % при k = ${fmt(b.cert.k, b.cert.k % 1 ? 2 : 0)}`, `${fmt(b.cert.U, 2)}% at k = ${fmt(b.cert.k, b.cert.k % 1 ? 2 : 0)}`) : L('нет — типовые значения', 'none — typical values')],
    [L('Повторяемость (тип А), %', 'Repeatability (type A), %'), r.typeA ? v(r.typeA.pct, 3) : '—'],
    [L('Своих значений строк', 'Your row values'), String(b.rows.filter((x) => x.over).length)],
  ];
  for (const g of b.groups) if (g.subtotal) rows.push([L(`Суммарная: ${g.title.replace(/\.\s.*$/, '').toLowerCase()}, %`, `Combined: ${g.title.replace(/\.\s.*$/, '').toLowerCase()}, %`), v(g.subtotal.value)]);
  rows.push([L('Суммарная стандартная неопределённость u<sub>c</sub> (k = 1), %', 'Combined standard uncertainty u<sub>c</sub> (k = 1), %'), v(b.ucPct)]);
  const total = [[L('Расширенная неопределённость U (k = 2), %', 'Expanded uncertainty U (k = 2), %'), v(b.UPct, 1)]];
  if (Number.isFinite(r.abs)) total.push([L(`U (k = 2), ${esc(unit)}`, `U (k = 2), ${esc(unit)}`), `±${fmt2sig(r.abs)}`]);
  $('#unc-factors').innerHTML =
    `<thead><tr><th>${L('Величина', 'Quantity')}</th><th>${L('Значение', 'Value')}</th></tr></thead><tbody>` +
    rows.map(([k, x]) => `<tr><td>${k}</td><td class="v">${x}</td></tr>`).join('') +
    total.map(([k, x]) => `<tr class="total"><td>${k}</td><td class="v">${x}</td></tr>`).join('') +
    '</tbody>';
}

// ------------------------------------------------------------ протокол текстом
function reportText(data, r) {
  const out = [];
  const line = (k, val) => out.push(`${k}: ${val}`);
  const b = r.budget;
  const unit = unitText(r.unit);
  out.push(L(`БЮДЖЕТ НЕОПРЕДЕЛЁННОСТИ ПОГЛОЩЁННОЙ ДОЗЫ В ВОДЕ — ${BEAM_NAME[r.beam]().toUpperCase()}`, `ABSORBED DOSE TO WATER UNCERTAINTY BUDGET — ${BEAM_NAME[r.beam]().toUpperCase()}`));
  line(L('Протокол', 'Protocol'), PROTO[r.protocol].name);
  line(L('Калькулятор', 'Calculator'), versionText());
  line(L('Учреждение', 'Institution'), data.unc_institution || '—');
  line(L('Аппарат', 'Machine'), data.unc_machine || '—');
  line(L('Пучок', 'Beam'), data.unc_beam || '—');
  line(L('Дата', 'Date'), data.unc_date || '—');
  line(L('Составил', 'Prepared by'), data.unc_staff.filter((s) => s.trim()).join(', ') || '—');
  if (r.beam === 'electrons') line(L('Камера', 'Chamber'), r.chamberType === 'pp' ? L('плоскопараллельная', 'plane-parallel') : L('цилиндрическая', 'cylindrical'));
  line(L('Калибровка камеры', 'Chamber calibration'), routeText(r.beam, r.route));
  if (r.beam === 'electrons' && Number.isFinite(r.r50)) line('R50', L(`${fmt(r.r50, 2)} г/см²`, `${fmt(r.r50, 2)} g/cm²`));
  line(L('Свидетельство о калибровке', 'Calibration certificate'), b.cert ? L(`U = ${fmt(b.cert.U, 2)} % при k = ${fmt(b.cert.k, b.cert.k % 1 ? 2 : 0)}`, `U = ${fmt(b.cert.U, 2)}% at k = ${fmt(b.cert.k, b.cert.k % 1 ? 2 : 0)}`) : L('не введено — лабораторная часть типового бюджета', 'not entered — laboratory part from the example'));
  const cells = r.series.values?.length ? r.series.values.map((x) => fmt(x, 4)).join('; ') : '—';
  line(L('Показания, нКл', 'Readings, nC'), r.typeA ? L(`${cells} → повторяемость (тип А) ${fmt(r.typeA.pct, 3)} %`, `${cells} → repeatability (type A) ${fmt(r.typeA.pct, 3)}%`) : cells);
  if (Number.isFinite(r.value)) line(L('Результат дозиметрии', 'Dosimetry result'), `${fmt(r.value, r.value >= 10 ? 2 : 4)} ${unit}`);
  out.push('');
  out.push(...budgetReportLines(b, r.value, unit));
  const msgs = r.messages.filter((m) => m.level !== 'info');
  if (msgs.length) {
    out.push('', L('Замечания:', 'Messages:'));
    msgs.forEach((m) => out.push(`- ${m.text}${m.ref ? ` [${refText(m.ref)}]` : ''}`));
  }
  if (data.unc_notes) out.push('', `${L('Примечания', 'Notes')}: ${data.unc_notes}`);
  out.push('', closingNote());
  return out.join('\n');
}

const closingNote = () =>
  L(
    'Типовые бюджеты — примеры из протоколов; бюджет составляет и пересматривает пользователь. Составляющие считаются независимыми и складываются в квадратуре, U = 2·u_c (TRS-398 Rev.1, прил. IV).',
    'The examples are budgets from the protocols; the user sets up and reviews the budget. The components are assumed independent and are added in quadrature, U = 2·u_c (TRS-398 Rev.1, App. IV).',
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

/** Итог для сохранения в файл и сверки при открытии файла. */
function snapshot(r) {
  const num = (x) => (Number.isFinite(x) ? x : null);
  return { protocol: r.protocol, template: r.budget.template.id, value: num(r.UPct), ucPct: num(r.ucPct), abs: num(r.abs) };
}
const SNAP_CMP = { keys: ['value', 'ucPct'], main: 'value', digits: 2, unit: '%' };

export function importUncTool(obj) {
  if (!obj || obj.app !== FILE_TAG.app || typeof obj.form !== 'object') throw new Error(L('Это не файл калькулятора референсной дозиметрии.', 'This is not a reference dosimetry calculator file.'));
  checkFileFormat(obj, FILE_TAG);
  if (obj.module !== FILE_TAG.module) {
    throw new Error(L('Это файл другого раздела: откройте его на соответствующей вкладке или вставьте данные через Ctrl+V — нужная вкладка откроется сама.', 'This file belongs to another section: open it on the corresponding tab, or paste the data with Ctrl+V — the right tab will open automatically.'));
  }
  writeForm(obj.form);
  openedFile = obj;
  update();
}

// ------------------------------------------------------------ данные с вкладки дозиметрии
function pull(target) {
  const s = sources[target]?.();
  if (!s) return;
  const cur = readForm();
  const patch = {
    unc_beam_type: s.beam,
    unc_route: s.route === 'crossQ' ? 'crossQ' : cur.unc_route === 'crossCo' ? 'crossCo' : 'lab',
    unc_M: Array.isArray(s.M) ? s.M.map((x) => String(x ?? '')) : ['', '', ''],
    unc_value: Number.isFinite(s.value) ? fmt(s.value, s.value >= 10 ? 2 : 4) : '',
    unc_unit: s.unit,
  };
  if (s.beam === 'electrons') {
    patch.unc_ch_type = s.chamberType;
    patch.unc_r50 = Number.isFinite(s.r50) ? fmt(s.r50, 2) : '';
  }
  const m = s.meta || {};
  if (m.institution) patch.unc_institution = m.institution;
  if (m.machine) patch.unc_machine = m.machine;
  if (m.beam) patch.unc_beam = m.beam;
  if (m.date) patch.unc_date = m.date;
  if (Array.isArray(m.staff) && m.staff.some((x) => String(x).trim())) patch.unc_staff = m.staff;
  // примечания демонстрационного примера не переносим в чужие данные
  const next = { ...cur, ...patch };
  if (isDemo(cur) && !isDemo(next)) next.unc_notes = '';
  writeForm(next);
  openedFile = null;
  update();
  flashFields(Object.keys(patch).filter((k) => !['unc_M', 'unc_staff'].includes(k)));
  const name = BEAM_NAME[target]();
  setStatus(
    Number.isFinite(s.value)
      ? L(`Данные взяты с вкладки «${name}»: пучок, способ калибровки, показания, результат дозиметрии и сведения об аппарате. Свидетельство и свои значения бюджета не менялись.`, `Data taken from the ${name} tab: beam, calibration route, readings, result and machine details. The certificate and your budget values were not changed.`)
      : L(`Данные взяты с вкладки «${name}», но доза там не вычислена (есть ошибки) — поле «Результат дозиметрии» очищено.`, `Data taken from the ${name} tab, but the dose there is not calculated (there are errors): the Dosimetry result field has been cleared.`),
  );
}

// ------------------------------------------------------------ цикл
let current = { data: null, result: null };
let openedFile = null;
function update() {
  const data = readForm();
  const r = computeUncertaintyTool(data);
  current = { data: r.form, result: r };
  applyVisibility(r.form, r);
  renderBudget($('#unc-budget'), r.budget, { hidden: $('#unc_over'), doseText: budgetDoseText(r.budget, r.value, esc(unitText(r.unit)), '') });
  renderOutputs(ROOT(), r);
  renderFlags(ROOT(), r.flags, (key) => (key === 'unc_M' ? seriesBox() : null));
  renderReadout(r);
  $('#unc-demo-flag').hidden = !isDemo(data);
  renderNotesFlag($('#unc-notes-flag'), data.unc_notes, [SAMPLE_UNC.unc_notes, SAMPLE_UNC_EN.unc_notes], isDemo(data));
  renderFileNote($('#unc-file-note'), openedFile ? compareWithFile(openedFile, snapshot(r), SNAP_CMP) : null);
  saveDraft(r.form);
  renderSignBlock($('#unc-sign'), r.form.unc_staff, closingNote());
  notifyUpdate(ROOT());
}

function refreshForLang() {
  const kept = $$('select', ROOT()).map((sel) => [sel, sel.value]);
  fillRoutes(currentBeam());
  fillUnits();
  for (const [sel, val] of kept) if ([...sel.options].some((o) => o.value === val)) sel.value = val;
  renderCells(seriesBox(), readCells(seriesBox()));
  renderStaff($('#unc-staff-list'), readStaff($('#unc-staff-list')), update);
  localizeDemo(SAMPLE_UNC, SAMPLE_UNC_EN);
  localizeDecimals(ROOT());
  update();
}

export function initUncTool() {
  setStatus = makeStatus($('#unc-status'));
  fillUnits();
  setupCells(seriesBox(), update);
  $$('#unc-sheet > section .combo').forEach((c) => makeCombo(c));
  setupBudget($('#unc-budget'), $('#unc_over'));

  const draft = loadDraft();
  writeForm(draft ? draft : sampleData());
  localizeDemo(SAMPLE_UNC, SAMPLE_UNC_EN);
  update();
  if (!draft) setStatus(L('Загружен демонстрационный пример. Нажмите «Очистить», чтобы ввести свои данные, или возьмите их с вкладки дозиметрии.', 'Demo example loaded. Click "Clear" to enter your own data, or take them from a dosimetry tab.'));

  const sheet = $('#unc-sheet');
  sheet.addEventListener('input', () => {
    openedFile = null;
    update();
  });
  sheet.addEventListener('change', (e) => {
    openedFile = null;
    if (e.target.name === 'unc_beam_type') {
      const beam = currentBeam();
      fillRoutes(beam);
      // единицы итога по умолчанию для пучка, если итог ещё не введён
      if (!$('#unc_value').value.trim()) $('#unc_unit').value = beam === 'co60' ? 'cGymin' : 'Gy100MU';
    }
    update();
  });
  document.addEventListener('change', (e) => {
    if (e.target.name === 'protocol') update();
  });
  document.addEventListener('langchange', refreshForLang);

  $('#unc-sheet .pull-btns').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pull]');
    if (b) pull(b.dataset.pull);
  });
  $('#unc-btn-add-staff').addEventListener('click', () => {
    const cur = readStaff($('#unc-staff-list'));
    cur.push('');
    renderStaff($('#unc-staff-list'), cur, update);
    $$('#unc-staff-list .staff-input').at(-1).focus();
    update();
  });

  $('#unc-btn-sample').addEventListener('click', () => {
    openedFile = null;
    writeForm(sampleData());
    update();
    setStatus(L('Загружен демонстрационный пример (вымышленные данные).', 'Demo example loaded (fictitious data).'));
  });
  armButton($('#unc-btn-clear'), () => L('Очистить', 'Clear'), () => L('Точно очистить?', 'Clear everything?'), () => {
    writeForm({ ...UT_DEFAULTS, unc_beam_type: currentBeam(), unc_unit: currentBeam() === 'co60' ? 'cGymin' : 'Gy100MU', unc_date: today() });
    openedFile = null;
    update();
    setStatus(L('Форма очищена.', 'Form cleared.'));
  });

  const payload = () => JSON.stringify({ ...FILE_TAG, ...fileStamp(snapshot(current.result)), savedAt: new Date().toISOString(), form: current.data }, null, 2);
  $('#unc-btn-save').addEventListener('click', () => {
    const name = [current.data.unc_machine, current.data.unc_beam, current.data.unc_date].filter(Boolean).join('_').replace(/[^\p{L}\p{N}_.-]+/gu, '-') || 'budget';
    downloadText(payload(), `uncertainty_${name}.json`);
    setStatus(L('Файл сохранён.', 'File saved.'));
  });
  $('#unc-btn-load').addEventListener('click', () => $('#unc-file-input').click());
  $('#unc-file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      importUncTool(JSON.parse(await file.text()));
      setStatus(L(`Открыт файл ${file.name}.`, `Opened file ${file.name}.`));
    } catch (err) {
      setStatus(err instanceof SyntaxError ? L('Файл повреждён: это не JSON.', 'The file is damaged: it is not JSON.') : err.message);
    }
    e.target.value = '';
  });
  $('#unc-btn-copy-json').addEventListener('click', () =>
    copyText(payload(), L('Данные скопированы. Чтобы вставить их обратно, нажмите Ctrl+V на странице вне полей ввода.', 'Data copied. To paste them back, press Ctrl+V on the page outside the input fields.'), setStatus),
  );
  $('#unc-btn-copy-report').addEventListener('click', () => copyText(reportText(current.data, current.result), L('Протокол скопирован в буфер обмена.', 'Report copied to the clipboard.'), setStatus));
  $('#unc-btn-pdf').addEventListener('click', () => printToPdf([L('Неопределённость', 'Uncertainty'), current.data.unc_machine, current.data.unc_beam, current.data.unc_date].filter(Boolean).join('_'), setStatus));
  $('#unc-btn-print').addEventListener('click', () => window.print());
}
