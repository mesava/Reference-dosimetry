// Модуль «Электроны»: связывает форму с расчётным ядром electrons.js.
import { computeElectrons, E_DEFAULTS, normalizeElectrons, parseElectronBeam } from '../core/electrons.js';
import { E_CHAMBERS, eChamberLabel } from '../core/electron-chambers.js';
import { SAMPLE_ELECTRONS, SAMPLE_ELECTRONS_EN } from '../core/sample-electrons.js';
import { L, getLang, refText } from '../core/i18n.js';
import { localizeDecimals } from './i18n.js';
import { PRESSURE_UNITS, NDW_UNITS, parseNumber, unitLabel } from '../core/units.js';
import { makeCombo, renderCells, readCells, setupCells, renderStaff, readStaff } from './widgets.js';
import {
  $, $$, localizeDemo, doseGroupTitle, rawReadingLabel, correctedReadingLabel, fmt, fmtSigned, esc, today, makeStatus, copyText, downloadText,
  currentProtocol, renderOutputs, renderFlags, applyShowRules, armButton, renderSignBlock, printToPdf,
  renderCompliance, complianceLine, ctrlErrorText, fileStamp, checkFileFormat, compareWithFile, renderFileNote, versionText, renderNotesFlag, precisionNote,
  notifyUpdate, flashFields, richText, applyProtocol } from './common.js';
import { makeJournalView } from './journal-view.js';

const DRAFT_KEY = 'reference-dosimetry.electrons.v1';
const FILE_TAG = { app: 'reference-dosimetry', module: 'electrons', version: 1 };
const SERIES_KEYS = ['e_M1', 'e_Mopp', 'e_M2', 'e_ctrl_M', 'e_recal_M'];
const ROOT = () => document.getElementById('module-electrons');
let setStatus = () => {};
export const electronsStatus = (text) => setStatus(text);

const PROTO = {
  trs: { name: 'TRS-398 Rev.1' },
  tg51: { name: 'TG-51 + Report 385' },
};

// ------------------------------------------------------------ списки
function fillSelects() {
  const group = (type, label) => {
    const list = E_CHAMBERS.filter((c) => c.type === type);
    return `<optgroup label="${label}">${list
      .map((c) => {
        const tags = [c.trsT20 ? 'TRS: ⁶⁰Co' : null, c.trsT21 ? L('TRS: перекр.', 'TRS: cross-cal.') : null, c.r385 ? 'Report 385' : null].filter(Boolean).join(', ');
        return `<option value="${c.id}">${esc(eChamberLabel(c))} [${tags}]</option>`;
      })
      .join('')}</optgroup>`;
  };
  $('#e_ch_model').innerHTML =
    `<option value="">${L('— выберите камеру —', '— select a chamber —')}</option>` +
    group('pp', L('Плоскопараллельные', 'Plane-parallel')) +
    group('cyl', L('Цилиндрические', 'Cylindrical')) +
    `<option value="OTHER">${L('Другая камера (kQ вводится вручную)…', 'Other chamber (kQ entered manually)…')}</option>`;
  const ndw = Object.entries(NDW_UNITS).map(([k, u]) => `<option value="${k}">${unitLabel(u)}</option>`).join('');
  for (const id of ['#e_ndw_unit', '#e_cross_ndw_unit', '#e_cross_kn_unit']) $(id).innerHTML = ndw;
  $('#e_env_P_unit').innerHTML = Object.entries(PRESSURE_UNITS).map(([k, u]) => `<option value="${k}">${unitLabel(u)}</option>`).join('');
}

/** Демонстрационный набор на текущем языке (текстовые поля), числа одинаковые. */
const sampleData = () => (getLang() === 'en' ? { ...SAMPLE_ELECTRONS, ...SAMPLE_ELECTRONS_EN } : SAMPLE_ELECTRONS);
const isDemo = (d) => [SAMPLE_ELECTRONS.e_institution, SAMPLE_ELECTRONS_EN.e_institution].includes(d.e_institution) && [SAMPLE_ELECTRONS.e_machine, SAMPLE_ELECTRONS_EN.e_machine].includes(d.e_machine);

// ------------------------------------------------------------ форма ↔ данные
const seriesBox = (key) => $(`#e-sheet .cells[data-series="${key}"]`);

function readForm() {
  const data = {};
  for (const key of Object.keys(E_DEFAULTS)) {
    if (key === 'protocol') data.protocol = currentProtocol();
    else if (key === 'e_staff') data.e_staff = readStaff($('#e-staff-list'));
    else if (SERIES_KEYS.includes(key)) data[key] = readCells(seriesBox(key));
    else {
      const el = document.getElementById(key);
      if (!el) continue;
      data[key] = el.type === 'checkbox' ? el.checked : el.value;
    }
  }
  return data;
}

function writeForm(values) {
  const data = normalizeElectrons(values);
  for (const [key, value] of Object.entries(data)) {
    if (key === 'protocol') continue;
    if (key === 'e_staff') renderStaff($('#e-staff-list'), value, update);
    else if (SERIES_KEYS.includes(key)) renderCells(seriesBox(key), value);
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
const zTxt = (z) => (Number.isFinite(z) ? fmt(z, 2) : 'z_ref');

/** Допуск учреждения на отклонение от номинала, % — для подписей. */
const tolText = (r) => fmt(r.recal.tolerance, r.recal.tolerance % 1 ? 1 : 0);

/** Раздел 9 «Требуется калибровка?»: появляется, если доза вне допуска (по умолчанию ±2 %) от номинала. */
function renderRecal(data, r) {
  const rc = r.recal;
  $('#e-recal-section').hidden = !rc.needed;
  $('#e-notes-step-no').textContent = rc.needed ? '10' : '9';
  if (!rc.needed) return;
  const x = data.protocol === 'tg51' ? r.tg51 : r.trs;
  const pre = preOf(x);
  const atMax = r.depth.nominalAt === 'zmax' && Number.isFinite(pre.DmaxPerMU);
  const preV = atMax ? pre.DmaxPerMU : pre.DperMU;
  const where = atMax ? L('на z_max', 'at z_max') : L(`на ${zTxt(r.quality.zref)} см`, `at ${zTxt(r.quality.zref)} cm`);
  $('#e-recal-hint').textContent = L(
    `Доза ${fmt(preV, 4)} Гр на 100 МЕ ${where} отличается от номинального выхода ${fmt(r.depth.nominal, 3)} на ${fmtSigned(pre.deviation, 2)} % — больше допуска ±${tolText(r)} %. Если ускоритель калибруют, выберите «Да» и введите показания после калибровки.`,
    `The dose ${fmt(preV, 4)} Gy per 100 MU ${where} differs from the nominal output ${fmt(r.depth.nominal, 3)} by ${fmtSigned(pre.deviation, 2)} %, more than the ±${tolText(r)} % tolerance. If the linac is being calibrated, choose "Yes" and enter the readings after calibration.`,
  );
  $('#e-recal-pre').textContent = fmt(preV, 4);
  $('#e-recal-pre-sub').textContent = L(`${where}; от номинала ${fmtSigned(pre.deviation, 2)} %`, `${where}; from nominal ${fmtSigned(pre.deviation, 2)} %`);
  const post = x.recal && !x.recal.blocked ? x.recal : null;
  const postV = post ? (atMax ? post.DmaxPerMU : post.DperMU) : NaN;
  $('#e-recal-post').textContent = post ? fmt(postV, 4) : '—';
  $('#e-recal-post-sub').textContent = post && Number.isFinite(post.deviation) ? L(`${where}; от номинала ${fmtSigned(post.deviation, 2)} %`, `${where}; from nominal ${fmtSigned(post.deviation, 2)} %`) : '';
  $('#e-recal-diff').textContent = post && Number.isFinite(post.preVsNew) ? `${fmtSigned(post.preVsNew, 2)} %` : '—';
}

function applyVisibility(data, r) {
  applyShowRules(ROOT(), data, data.protocol);
  renderRecal(data, r);
  const c = r.chamber;
  const cross = data.e_cal_route === 'cross';
  $('#e_nominal_at').disabled = !data.e_dd_on;
  $('#e-nominal-sub').textContent = !data.e_dd_on
    ? L('Без пересчёта на z_max номинальный выход относится к опорной глубине.', 'Without transfer to z_max the nominal output refers to the reference depth.')
    : L('Итог показывается на этой глубине; отклонение считается от номинала на ней.', 'The result is shown at this depth, and the deviation is calculated from the nominal output there.');
  $('#e-opt-trs-table').textContent = cross
    ? L('по табл. 21: k_Q,Qint / k_Qcross,Qint (ур. 44)', 'from Table 21: k_Q,Qint / k_Qcross,Qint (Eq. 44)')
    : L('по табл. 20 с интерполяцией по R50', 'from Table 20, interpolated in R50');
  $('#e-opt-trs-formula').textContent = cross
    ? L('по аппроксимации прил. II (табл. 48), ур. (44)', 'from the App. II fit (Table 48), Eq. (44)')
    : L('по аппроксимации прил. II (табл. 47)', 'from the App. II fit (Table 47)');
  $('#e-lbl-kqtrs').innerHTML = cross ? 'k<sub>Q,Qcross</sub>' : 'k<sub>Q,Q₀</sub>';
  $('#e-lbl-kq51').innerHTML = cross ? 'k′<sub>Q</sub>' : 'k<sub>Q</sub>';
  $('#e-lbl-kq51-used').innerHTML = cross ? L('k′<sub>Q</sub> в расчёте', 'k′<sub>Q</sub> used') : 'k<sub>Q</sub> = k′<sub>Q</sub>·k<sub>Qecal</sub>';
  $('#e-lbl-pdd').textContent = L(`PDD(${zTxt(r.quality.zref)} см), %`, `PDD(${zTxt(r.quality.zref)} cm), %`);
  const field = parseNumber(data.e_field);
  $('#e-field-view').textContent = Number.isFinite(field) ? `${fmt(field, field % 1 ? 1 : 0)} × ${fmt(field, field % 1 ? 1 : 0)} ${L('см', 'cm')}` : '';

  // подсказка к измерению R50 для выбранной камеры
  const bits = [L('Кривую ионизации измеряют при РИП 100 см и поле не меньше 10 × 10 см, сканируя к поверхности.', 'The depth-ionization curve is measured at SSD 100 cm with a field of at least 10 × 10 cm, scanning toward the surface.')];
  if (c?.type === 'pp') {
    bits.push(L('TRS-398: точка измерения — внутренняя поверхность входного окна с учётом его водоэквивалентной толщины.', 'TRS-398: the point of measurement is the inner surface of the entrance window, taking its water-equivalent thickness into account.'));
    if (c.r385) bits.push(L(`Report 385: точка измерения ${fmt(c.r385.shiftMm, 1)} мм за наружной поверхностью окна (табл. 3).`, `Report 385: the point of measurement is ${fmt(c.r385.shiftMm, 1)} mm behind the outer surface of the window (Table 3).`));
  } else if (c?.type === 'cyl') {
    const rc = c.trsRcylMm ?? c.rCavMm;
    if (Number.isFinite(rc)) bits.push(L(`TRS-398: кривую сдвигают на 0,5·r_cyl = ${fmt(0.5 * rc, 2)} мм к поверхности.`, `TRS-398: the curve is shifted by 0.5·r_cyl = ${fmt(0.5 * rc, 2)} mm toward the surface.`));
    if (c.r385) bits.push(L(`Report 385: сдвиг ${fmt(c.r385.shiftMm, 1)} мм выше центра камеры (табл. 2).`, `Report 385: shift of ${fmt(c.r385.shiftMm, 1)} mm upstream of the chamber center (Table 2).`));
  }
  $('#e-epom-hint').textContent = bits.join(' ');
}

function renderChamberInfo(r) {
  const c = r.chamber;
  const info = $('#e-chamber-info');
  if (!c) info.textContent = '';
  else if (c.other) info.innerHTML = richText(L('k_Q вводится вручную в разделе 6.', 'k_Q is entered manually in section 6.'));
  else {
    const bits = [c.type === 'pp' ? L('плоскопараллельная', 'plane-parallel') : L('цилиндрическая', 'cylindrical')];
    if (c.type === 'pp' && Number.isFinite(c.windowMgCm2)) bits.push(L(`входное окно ${fmt(c.windowMgCm2, c.windowMgCm2 < 10 ? 2 : 0)} мг/см²`, `entrance window ${fmt(c.windowMgCm2, c.windowMgCm2 < 10 ? 2 : 0)} mg/cm²`));
    else if (c.type === 'pp' && Number.isFinite(c.windowMm)) bits.push(L(`входное окно ${fmt(c.windowMm, 1)} мм`, `entrance window ${fmt(c.windowMm, 1)} mm`));
    if (c.type === 'cyl' && Number.isFinite(c.trsRcylMm)) bits.push(L(`r_cyl = ${fmt(c.trsRcylMm, 1)} мм (табл. 4 TRS-398)`, `r_cyl = ${fmt(c.trsRcylMm, 1)} mm (TRS-398 Table 4)`));
    const src = [c.trsT20 ? L('TRS-398 табл. 20', 'TRS-398 Table 20') : null, c.trsT21 ? L('табл. 21', 'Table 21') : null, c.r385 ? 'Report 385' : null].filter(Boolean);
    bits.push(L(`данные k_Q: ${src.join(', ')}`, `k_Q data: ${src.join(', ')}`));
    info.innerHTML = richText(bits.join(' · '));
  }
  const p = r.positions;
  const box = $('#e-positions');
  if (!p) {
    box.hidden = true;
    return;
  }
  const keys = [r.protocol];
  box.hidden = false;
  box.innerHTML = `<h4>${L('Положение камеры', 'Chamber position')}</h4><ul>${keys.map((k) => `<li><b>${PROTO[k].name}:</b> ${richText(p[k].text)}</li>`).join('')}</ul>`;
}

// ------------------------------------------------------------ вывод
/** Доза до калибровки: по контрольным измерениям, если они введены и без ошибок, иначе по M₁ раздела 5. */
const preOf = (x) => (x.ctrl && !x.ctrl.blocked && !x.blocked ? x.ctrl : x);
/** Контрольные измерения введены, но с ошибками: итога нет (подменять его показанием M₁ нельзя). */
const ctrlFailed = (x) => !x.blocked && !!x.ctrl?.blocked;
/** Итог: после калибровки ускорителя (раздел 9), если она проведена, иначе — доза до калибровки. */
const primaryOf = (x) => (x.recal && !x.recal.blocked && !x.blocked ? x.recal : preOf(x));

/** Итог показывается на глубине, где задан номинальный выход: на z_max или на опорной глубине. */
const atMaxOf = (y, r) => r.depth.nominalAt === 'zmax' && Number.isFinite(y.DmaxPerMU);

/** Итог для сохранения в файл и сверки при открытии файла. */
function snapshot(r) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const x = r.protocol === 'tg51' ? r.tg51 : r.trs;
  if (x.blocked || ctrlFailed(x)) return { protocol: r.protocol, value: null };
  const p = primaryOf(x);
  return {
    protocol: r.protocol,
    source: p === x.recal ? 'recal' : p === x.ctrl ? 'ctrl' : 'main',
    value: num(atMaxOf(p, r) ? p.DmaxPerMU : p.DperMU),
    DperMU: num(p.DperMU),
    DmaxPerMU: num(p.DmaxPerMU),
    deviation: num(p.deviation),
    kQ: num(x.kQ),
    compliance: r.compliance?.status ?? null,
  };
}
const SNAP_CMP = { keys: ['value', 'DperMU', 'DmaxPerMU', 'kQ'], main: 'value', get unit() { return L('Гр на 100 МЕ', 'Gy per 100 MU'); } };

function doseRow(key, x, r) {
  const p = primaryOf(x);
  const fromRecal = p === x.recal;
  const fromCtrl = p === x.ctrl;
  const atMax = atMaxOf(p, r);
  const hasMax = Number.isFinite(p.DmaxPerMU);
  const main = atMax ? p.DmaxPerMU : p.DperMU;
  const z = zTxt(r.quality.zref);
  const where = atMax ? L('на z<sub>max</sub>', 'at z<sub>max</sub>') : L(`на ${z} см`, `at ${z} cm`);
  const failed = ctrlFailed(x);
  const none = x.blocked || failed;
  let chip = '';
  if (Number.isFinite(p.deviation) && !none) {
    const cls = Math.abs(p.deviation) <= 1 ? 'good' : Math.abs(p.deviation) > r.recal.tolerance ? 'bad' : '';
    chip = `<span class="chip ${cls}" title="${L('Отклонение от номинального выхода', 'Deviation from the nominal output')}">${fmtSigned(p.deviation, 2)} %</span>`;
  }
  const units = fromRecal ? r.recal.mu : fromCtrl ? r.ctrl.mu : r.inputs.mu;
  const unitsTxt = Number.isFinite(units) ? fmt(units, 0) : '—';
  const doseLine = (lbl, cgy, gy) => `${lbl} = ${fmt(cgy, 2)} ${L('сГр', 'cGy')} = ${fmt(gy, 4)} ${L('Гр', 'Gy')} ${L(`за ${unitsTxt} МЕ`, `for ${unitsTxt} MU`)}`;
  const secondary = [
    doseLine(L(`D<sub>w</sub>(${z} см)`, `D<sub>w</sub>(${z} cm)`), p.DcGy, p.D),
    hasMax ? doseLine('D(z<sub>max</sub>)', p.DmaxcGy, p.Dmax) : null,
    hasMax
      ? atMax
        ? L(`На ${z} см: ${fmt(p.DperMU, 4)} Гр на 100 МЕ`, `At ${z} cm: ${fmt(p.DperMU, 4)} Gy per 100 MU`)
        : L(`На z<sub>max</sub>: ${fmt(p.DmaxPerMU, 4)} Гр на 100 МЕ`, `At z<sub>max</sub>: ${fmt(p.DmaxPerMU, 4)} Gy per 100 MU`)
      : null,
    fromRecal && p.pre
      ? L(
          `До калибровки: ${fmt(atMax ? p.pre.DmaxPerMU : p.pre.DperMU, 4)} Гр на 100 МЕ (от номинала ${fmtSigned(p.pre.deviation, 2)} %; от дозы после калибровки ${fmtSigned(p.preVsNew, 2)} %)`,
          `Before calibration: ${fmt(atMax ? p.pre.DmaxPerMU : p.pre.DperMU, 4)} Gy per 100 MU (from nominal ${fmtSigned(p.pre.deviation, 2)} %; from the dose after calibration ${fmtSigned(p.preVsNew, 2)} %)`,
        )
      : null,
    fromRecal || fromCtrl ? null : L('Контрольные измерения не введены — доза по показанию M₁ раздела 5', 'No check measurements entered — dose from reading M₁ of section 5'),
    !fromRecal && r.recal.needed
      ? r.recal.answer === 'no'
        ? L(`Вне допуска ±${tolText(r)} %; калибровка не проводилась`, `Outside the ±${tolText(r)} % tolerance; no calibration performed`)
        : L(`Вне допуска ±${tolText(r)} % — см. раздел 9 «Требуется калибровка?»`, `Outside the ±${tolText(r)} % tolerance — see section 9 "Calibration required?"`)
      : null,
  ].filter(Boolean).join('<br>');
  return `<div class="dose-row ${none ? 'blocked' : ''}">
    <div class="proto"><span>${PROTO[key].name}${fromRecal ? L(' · после калибровки', ' · after calibration') : fromCtrl || failed ? L(' · контрольные измерения', ' · check measurements') : ''}</span>${chip}</div>
    <div class="dose-big">${none || !Number.isFinite(main) ? '—' : fmt(main, 4)}<small>${L('Гр на 100 МЕ', 'Gy per 100 MU')} ${where}</small></div>
    <div class="secondary">${x.blocked ? L('Исправьте ошибки из списка замечаний', 'Correct the errors listed under Messages') : failed ? ctrlErrorText(7, 5) : secondary}</div>
  </div>`;
}

/** Строки таблицы с дозой: сГр и Гр за отпущенные МЕ и Гр на 100 МЕ — на опорной глубине и на z_max. */
function doseTableRows(t, g, r, z, units, own = [false, false], bold = true) {
  const u = Number.isFinite(units) ? fmt(units, 0) : '—';
  const atMax = r.depth.nominalAt === 'zmax' && r.depth.on;
  const rows = [
    [L(`D<sub>w</sub>(${z} см) за ${u} МЕ, сГр`, `D<sub>w</sub>(${z} cm) for ${u} MU, cGy`), ['', t.DcGy, 2, true, own[0]], ['', g.DcGy, 2, true, own[1]]],
    [L(`D<sub>w</sub>(${z} см) за ${u} МЕ, Гр`, `D<sub>w</sub>(${z} cm) for ${u} MU, Gy`), ['', t.D, 4, true, own[0]], ['', g.D, 4, true, own[1]]],
    [L(`На ${z} см, Гр на 100 МЕ`, `At ${z} cm, Gy per 100 MU`), ['', t.DperMU, 4, true, own[0]], ['', g.DperMU, 4, true, own[1]], bold && !atMax ? 'total' : ''],
  ];
  if (r.depth.on) {
    rows.push(
      [L(`D(z<sub>max</sub>) за ${u} МЕ, сГр`, `D(z<sub>max</sub>) for ${u} MU, cGy`), ['', t.DmaxcGy, 2, true, own[0]], ['', g.DmaxcGy, 2, true, own[1]]],
      [L(`D(z<sub>max</sub>) за ${u} МЕ, Гр`, `D(z<sub>max</sub>) for ${u} MU, Gy`), ['', t.Dmax, 4, true, own[0]], ['', g.Dmax, 4, true, own[1]]],
      [L('На z<sub>max</sub>, Гр на 100 МЕ', 'At z<sub>max</sub>, Gy per 100 MU'), ['', t.DmaxPerMU, 4, true, own[0]], ['', g.DmaxPerMU, 4, true, own[1]], bold && atMax ? 'total' : ''],
    );
  }
  return rows;
}

function renderReadout(r, data) {
  const keys = [data.protocol];
  const pick = (k) => (k === 'trs' ? r.trs : r.tg51);
  $('#e-dose-rows').innerHTML = keys.map((k) => doseRow(k, pick(k), r)).join('');
  renderCompliance($('#e-compliance'), r.compliance, PROTO[data.protocol].name);

  const first = keys.map((k) => ({ k, x: pick(k) })).find((o) => !o.x.blocked && o.x.ok && !ctrlFailed(o.x));
  const mv = $('#e-mobile-value');
  if (first) {
    const p = primaryOf(first.x);
    const val = atMaxOf(p, r) ? p.DmaxPerMU : p.DperMU;
    mv.innerHTML = `${first.k === 'trs' ? 'TRS' : 'TG-51'}: <b>${fmt(val, 4)}</b> ${L('Гр/100 МЕ', 'Gy/100 MU')}${Number.isFinite(p.deviation) ? ` (${fmtSigned(p.deviation, 2)} %)` : ''}`;
  } else {
    const n = r.messages.filter((m) => m.level === 'error').length;
    mv.textContent = n ? L(`Ошибок: ${n}`, `Errors: ${n}`) : '—';
  }

  const lvlName = { error: L('Ошибка', 'Error'), warn: L('Внимание', 'Warning'), info: L('Справка', 'Note') };
  const scopeName = { common: '', depth: L('Пересчёт на z_max · ', 'Transfer to z_max · '), ctrl: L('Контрольные измерения · ', 'Check measurements · '), recal: L('Калибровка · ', 'Calibration · '), trs: 'TRS-398 · ', tg51: 'TG-51 · ' };
  const list = r.messages.filter((m) => ['common', 'depth', 'ctrl', 'recal'].includes(m.scope) || keys.includes(m.scope));
  $('#e-messages').innerHTML = list.length
    ? list.map((m) => `<li class="${m.level}"><span class="lvl">${scopeName[m.scope]}${lvlName[m.level]}</span><span>${richText(m.text)}</span>${m.ref ? `<span class="ref">${esc(refText(m.ref))}</span>` : ''}</li>`).join('')
    : `<li class="info"><span class="lvl">${L('Всё в порядке', 'All clear')}</span><span>${L('Замечаний к введённым данным нет.', 'No issues with the entered data.')}</span></li>`;

  const t = r.trs;
  const g = r.tg51;
  const showT = keys.includes('trs');
  const showG = keys.includes('tg51');
  const z = zTxt(r.quality.zref);
  const cross = r.inputs.cross;
  const rows = [
    [L('Температура и давление', 'Temperature and pressure'), ['k<sub>TP</sub>', t.kTP, 4], ['P<sub>TP</sub>', g.PTP, 4]],
    [L('Электрометр', 'Electrometer'), ['k<sub>elec</sub>', t.kelec, 4], ['P<sub>elec</sub>', g.Pelec, 4]],
    [L('Полярность', 'Polarity'), ['k<sub>pol</sub>', t.kpol, 4], ['P<sub>pol</sub>', g.Ppol, 4]],
    [L('Рекомбинация', 'Recombination'), ['k<sub>s</sub>', t.ks, 4], ['P<sub>ion</sub>', g.Pion, 4]],
    [L('Утечка', 'Leakage'), ['k<sub>leak</sub>', t.kleak, 4], ['P<sub>leak</sub>', g.Pleak, 4]],
    [L('R<sub>50</sub>, г/см²', 'R<sub>50</sub>, g/cm²'), ['', r.quality.r50, 3], ['', r.quality.r50, 3]],
    cross
      ? [L('Калибровочный коэффициент, Гр/нКл', 'Calibration coefficient, Gy/nC'), ['N<sub>D,w,Qcross</sub>', t.coefficient, 5], ['(k<sub>Qecal</sub>N<sub>D,w</sub>)<sub>pp</sub>', g.coefficient, 5]]
      : [L('N<sub>D,w</sub>, Гр/нКл', 'N<sub>D,w</sub>, Gy/nC'), ['', r.inputs.ndw, 5], ['', r.inputs.ndw, 5]],
    cross
      ? [L('Поправка на качество', 'Beam quality correction'), ['k<sub>Q,Qcross</sub>', t.kQ, 4], ['k′<sub>Q</sub>', g.kQ, 4]]
      : [L('Поправка на качество', 'Beam quality correction'), ['k<sub>Q</sub>', t.kQ, 4], ['k<sub>Q</sub>', g.kQ, 4]],
  ];
  if (!cross) rows.push([L('Поправочный множитель лаборатории', 'Laboratory correction multiplier'), [L('k<sub>лаб</sub>', 'k<sub>lab</sub>'), r.inputs.klab, 4], [L('k<sub>лаб</sub>', 'k<sub>lab</sub>'), r.inputs.klab, 4]]);
  if (r.depth.on) rows.push([r.depth.label, ['', r.depth.factor, 4], ['', r.depth.factor, 4]]);
  const tc = t.ctrl || {};
  const gc = g.ctrl || {};
  const bT = !!tc.blocked;
  const bG = !!gc.blocked;
  const ctrlFinal = r.ctrl.on && ((showT && t.ctrl && !bT) || (showG && g.ctrl && !bG));
  const muText = (u) => L(`${Number.isFinite(u) ? fmt(u, 0) : '—'} МЕ`, `${Number.isFinite(u) ? fmt(u, 0) : '—'} MU`);
  const i = r.inputs;
  const rawT = Math.abs(i.M1.mean);
  const title = doseGroupTitle({ ctrlOn: r.ctrl.on, ctrlFinal, mainSec: 5, ctrlSec: 7, mainAmount: muText(r.inputs.mu), ctrlAmount: muText(r.ctrl.mu) });
  const tr = t.recal || {};
  const gr = g.recal || {};
  const rT = !!tr.blocked;
  const rG = !!gr.blocked;
  const recalFinal = r.recal.on && ((showT && t.recal && !rT) || (showG && g.recal && !rG));
  const atMaxNom = r.depth.nominalAt === 'zmax' && r.depth.on;
  const preAt = (y) => (y?.pre ? (atMaxNom ? y.pre.DmaxPerMU : y.pre.DperMU) : NaN);
  const signed = (v) => (Number.isFinite(v) ? `${fmtSigned(v, 2)} %` : '—');
  if (recalFinal) {
    rows.push([L(`Поглощённая доза — после калибровки ускорителя (раздел 9), ${muText(r.recal.mu)}`, `Absorbed dose — after the linac calibration (section 9), ${muText(r.recal.mu)}`), [], [], 'group']);
    rows.push([rawReadingLabel(), ['', r.recal.mean, 4], ['', r.recal.mean, 4]]);
    rows.push([correctedReadingLabel(), ['M<sub>Q</sub>', tr.M, 4, true, rT], ['M', gr.M, 4, true, rG]]);
    rows.push(...doseTableRows(tr, gr, r, z, r.recal.mu, [rT, rG], true));
    const where = atMaxNom ? 'z<sub>max</sub>' : L(`${z} см`, `${z} cm`);
    rows.push([L(`До калибровки, на ${where}, Гр на 100 МЕ (для справки)`, `Before calibration, at ${where}, Gy per 100 MU (for reference)`), ['', preAt(tr), 4], ['', preAt(gr), 4]]);
    rows.push([L('Доза до калибровки относительно дозы после калибровки', 'Dose before calibration relative to the dose after calibration'), ['', signed(tr.preVsNew)], ['', signed(gr.preVsNew)]]);
  } else {
  rows.push([title, [], [], 'group']);
  if (r.ctrl.on) {
    // контрольные измерения с ошибками: строки остаются, значения — прочерки
    rows.push([rawReadingLabel(), ['', r.ctrl.mean, 4], ['', r.ctrl.mean, 4]]);
    rows.push([correctedReadingLabel(), ['M<sub>Q</sub>', tc.M, 4, true, bT], ['M', gc.M, 4, true, bG]]);
    rows.push(...doseTableRows(tc, gc, r, z, r.ctrl.mu, [bT, bG], true));
  } else {
    rows.push([rawReadingLabel(), ['', rawT, 4], ['', rawT, 4]]);
    rows.push([correctedReadingLabel(), ['M<sub>Q</sub>', t.M, 4, true], ['M', g.M, 4, true]]);
    rows.push(...doseTableRows(t, g, r, z, i.mu, [false, false], true));
  }
  }

  const cell = ([sym, v, d, dose, own], blocked) => `<td class="v">${sym ? `<i>${sym}</i> ` : ''}${dose && (blocked || own) ? '—' : typeof v === 'string' ? v : fmt(v, d)}</td>`;
  const span = 1 + showT + showG;
  $('#e-factors').innerHTML =
    `<thead><tr><th>${L('Величина', 'Quantity')}</th>${showT ? '<th>TRS-398</th>' : ''}${showG ? '<th>TG-51</th>' : ''}</tr></thead><tbody>` +
    rows.map((row) => (row[3] === 'group' ? `<tr class="group"><td colspan="${span}">${row[0]}</td></tr>` : `<tr class="${row[3] || ''}"><td>${row[0]}</td>${showT ? cell(row[1], t.blocked) : ''}${showG ? cell(row[2], g.blocked) : ''}</tr>`)).join('') +
    '</tbody>';
}

// ------------------------------------------------------------ протокол текстом
function reportText(data, r) {
  const out = [];
  const line = (k, v) => out.push(`${k}: ${v}`);
  const cells = (a) => (Array.isArray(a) ? a.filter((x) => String(x).trim() !== '').join('; ') : a);
  const c = r.chamber;
  const q = r.quality;
  const i = r.inputs;
  const mean = L('среднее', 'mean');
  out.push(L('ПРОТОКОЛ РЕФЕРЕНСНОЙ ДОЗИМЕТРИИ — ПУЧОК ЭЛЕКТРОНОВ', 'REFERENCE DOSIMETRY REPORT — ELECTRONS'));
  line(L('Протокол', 'Protocol'), PROTO[data.protocol].name);
  line(L('Калькулятор', 'Calculator'), versionText());
  line(L('Учреждение', 'Institution'), data.e_institution || '—');
  line(L('Аппарат', 'Machine'), data.e_machine || '—');
  const beamE = parseElectronBeam(data.e_beam).energy;
  const showE = data.e_energy && !(Number.isFinite(beamE) && Math.abs(beamE - parseNumber(data.e_energy)) < 1e-9);
  line(L('Пучок', 'Beam'), `${data.e_beam || '—'}${showE ? `, ${data.e_energy} ${L('МэВ', 'MeV')}` : ''}`);
  line(L('Дата', 'Date'), data.e_date || '—');
  line(L('Измерения выполнили', 'Measured by'), data.e_staff.filter((s) => s.trim()).join(', ') || '—');
  line(L('Геометрия', 'Geometry'), L(`РИП = ${data.e_ssd} см, поле ${data.e_field}×${data.e_field} см на поверхности воды`, `SSD = ${data.e_ssd} cm, field ${data.e_field}×${data.e_field} cm at the water surface`));
  line(
    L('Качество пучка', 'Beam quality'),
    L(
      `${q.method === 'i50' ? `R50,ion = ${data.e_i50} г/см²; ` : ''}R50 = ${fmt(q.r50, 3)} г/см²; z_ref = ${fmt(q.zref, 3)} г/см²; E0 ≈ ${fmt(q.E0, 1)} МэВ`,
      `${q.method === 'i50' ? `R50,ion = ${data.e_i50} g/cm²; ` : ''}R50 = ${fmt(q.r50, 3)} g/cm²; z_ref = ${fmt(q.zref, 3)} g/cm²; E0 ≈ ${fmt(q.E0, 1)} MeV`,
    ),
  );
  out.push('');
  line(
    L('Камера', 'Chamber'),
    c
      ? `${c.other ? data.e_other_name || L('другая камера', 'other chamber') : eChamberLabel(c)} (${c.type === 'pp' ? L('плоскопараллельная', 'plane-parallel') : L('цилиндрическая', 'cylindrical')}), ${L('№', 'S/N')} ${data.e_ch_serial || '—'}`
      : '—',
  );
  if (r.positions) {
    const keys = [data.protocol];
    keys.forEach((k) => line(L(`Положение (${PROTO[k].name})`, `Position (${PROTO[k].name})`), r.positions[k].text));
  }
  if (i.cross) {
    if (r.trs.enabled) line('N_D,w,Qcross (TRS-398)', L(`${data.e_cross_ndw} ${unitLabel(NDW_UNITS[data.e_cross_ndw_unit])} при R50 = ${data.e_cross_r50} г/см²`, `${data.e_cross_ndw} ${unitLabel(NDW_UNITS[data.e_cross_ndw_unit])} at R50 = ${data.e_cross_r50} g/cm²`));
    if (r.tg51.enabled) line('(k_Qecal·N_D,w)pp (Report 385)', `${data.e_cross_kn} ${unitLabel(NDW_UNITS[data.e_cross_kn_unit])}`);
  } else {
    line('N_D,w (⁶⁰Co)', `${data.e_ndw} ${unitLabel(NDW_UNITS[data.e_ndw_unit])} (= ${fmt(i.ndw, 6)} ${L('Гр/нКл', 'Gy/nC')}); ${L('k_лаб', 'k_lab')} = ${fmt(i.klab, 4)}`);
  }
  line(L('Стандартные условия', 'Reference conditions'), `T0 = ${data.e_T0} °C, P0 = ${data.e_P0} ${L('кПа', 'kPa')}`);
  line(L('Электрометр', 'Electrometer'), `${data.e_el_model || '—'}, ${L('№', 'S/N')} ${data.e_el_serial || '—'}, k_elec = ${data.e_kelec}`);
  line(
    L('Условия', 'Conditions'),
    `T = ${data.e_env_T} °C, P = ${data.e_env_P} ${unitLabel(PRESSURE_UNITS[data.e_env_P_unit])}${String(data.e_env_H ?? '').trim() ? L(`, относительная влажность ${data.e_env_H} %`, `, relative humidity ${data.e_env_H} %`) : ''}`,
  );
  const fixed = data.e_fixed;
  line(L('Облучение', 'Irradiation'), fixed ? L(`${data.e_mu} МЕ, V1 = ${data.e_V1} В, обычная полярность ${data.e_polarity}`, `${data.e_mu} MU, V1 = ${data.e_V1} V, normal polarity ${data.e_polarity}`) : L(`${data.e_mu} МЕ, V1 = ${data.e_V1} В, V2 = ${data.e_V2} В, обычная полярность ${data.e_polarity}`, `${data.e_mu} MU, V1 = ${data.e_V1} V, V2 = ${data.e_V2} V, normal polarity ${data.e_polarity}`));
  line(L('M(V1, обычная), нКл', 'M(V1, normal), nC'), `${cells(data.e_M1)} → ${mean} ${fmt(Math.abs(i.M1.mean), 4)}`);
  if (fixed) {
    const [kp, kx] = data.protocol === 'tg51' ? ['P_pol', 'P_ion'] : ['k_pol', 'k_s'];
    line(L('Проверка выхода', 'Output check'), L(`${kp} = ${data.e_fixed_kpol}, ${kx} = ${data.e_fixed_ks} — из калибровки${data.e_fixed_from ? ` от ${data.e_fixed_from}` : ''}; обратная полярность и V2 не измерялись`, `${kp} = ${data.e_fixed_kpol}, ${kx} = ${data.e_fixed_ks} from the calibration${data.e_fixed_from ? ` of ${data.e_fixed_from}` : ''}; the opposite polarity and V2 were not measured`));
  } else {
    line(L('M(V1, обратная), нКл', 'M(V1, opposite), nC'), `${cells(data.e_Mopp)} → ${mean} ${fmt(Math.abs(i.Mopp.mean), 4)}`);
    line(L('M(V2), нКл', 'M(V2), nC'), `${cells(data.e_M2)} → ${mean} ${fmt(Math.abs(i.M2.mean), 4)}`);
  }
  if (r.ctrl.on) line(L('Контрольные измерения M(V1), нКл', 'Check measurements M(V1), nC'), `${cells(data.e_ctrl_M)} → ${mean} ${fmt(r.ctrl.mean, 4)} ${L(`за ${fmt(r.ctrl.mu, 0)} МЕ`, `for ${fmt(r.ctrl.mu, 0)} MU`)}`);
  if (r.recal.needed) {
    const ans = r.recal.answer === 'yes' ? L('да', 'yes') : r.recal.answer === 'no' ? L('нет', 'no') : L('не указано', 'not specified');
    line(L(`Требуется калибровка (доза вне допуска ±${tolText(r)} %)`, `Calibration required (dose outside the ±${tolText(r)} % tolerance)`), ans);
  }
  if (r.recal.on && r.recal.M?.n > 0) line(L('Показания после калибровки M(V1), нКл', 'Readings after calibration M(V1), nC'), `${cells(data.e_recal_M)} → ${mean} ${fmt(r.recal.mean, 4)} ${L(`за ${fmt(r.recal.mu, 0)} МЕ`, `for ${fmt(r.recal.mu, 0)} MU`)}`);
  out.push('');
  const blocks = [data.protocol];
  for (const k of blocks) {
    const x = k === 'trs' ? r.trs : r.tg51;
    out.push(`— ${PROTO[k].name} —`);
    if (k === 'trs') {
      out.push(`k_TP = ${fmt(x.kTP)}; k_elec = ${fmt(x.kelec)}; k_pol = ${fmt(x.kpol)}; k_s = ${fmt(x.ks)}; k_leak = ${fmt(x.kleak)}`);
      out.push(`k_Q = ${fmt(x.kQ)} (${x.kQSource || '—'})`);
    } else {
      out.push(`P_TP = ${fmt(x.PTP)}; P_elec = ${fmt(x.Pelec)}; P_pol = ${fmt(x.Ppol)}; P_ion = ${fmt(x.Pion)}; P_leak = ${fmt(x.Pleak)}`);
      out.push(`${i.cross ? 'k′_Q' : 'k_Q'} = ${fmt(x.kQ)} (${x.kQSource || '—'})`);
    }
    if (x.blocked) out.push(L('РЕЗУЛЬТАТ НЕ ВЫЧИСЛЕН: есть ошибки ввода (см. замечания).', 'RESULT NOT CALCULATED: there are input errors (see Messages).'));
    else {
      const describe = (y, title, units) => {
        const z0 = zTxt(q.zref);
        const u = fmt(units, 0);
        const atZmax = r.depth.nominalAt === 'zmax';
        const dev = Number.isFinite(y.deviation)
          ? L(`; отклонение от номинала (${atZmax ? 'на z_max' : `на ${z0} см`}) ${fmtSigned(y.deviation, 2)} %`, `; deviation from nominal (${atZmax ? 'at z_max' : `at ${z0} cm`}) ${fmtSigned(y.deviation, 2)} %`)
          : '';
        out.push(
          L(
            `${title}: M с поправками = ${fmt(y.M)} нКл; D_w(${z0} см) = ${fmt(y.DcGy, 2)} сГр = ${fmt(y.D)} Гр за ${u} МЕ; ${fmt(y.DperMU)} Гр на 100 МЕ${atZmax ? '' : dev}`,
            `${title}: corrected M = ${fmt(y.M)} nC; D_w(${z0} cm) = ${fmt(y.DcGy, 2)} cGy = ${fmt(y.D)} Gy for ${u} MU; ${fmt(y.DperMU)} Gy per 100 MU${atZmax ? '' : dev}`,
          ),
        );
        if (r.depth.on && r.depth.ok && Number.isFinite(y.DmaxPerMU)) {
          const zmax = data.e_zmax ? `z_max = ${data.e_zmax} ${L('см', 'cm')}; ` : '';
          out.push(
            L(
              `  ${zmax}${r.depth.label} = ${fmt(r.depth.factor)}; D(z_max) = ${fmt(y.DmaxcGy, 2)} сГр = ${fmt(y.Dmax)} Гр за ${u} МЕ; ${fmt(y.DmaxPerMU)} Гр на 100 МЕ${atZmax ? dev : ''}`,
              `  ${zmax}${r.depth.label} = ${fmt(r.depth.factor)}; D(z_max) = ${fmt(y.DmaxcGy, 2)} cGy = ${fmt(y.Dmax)} Gy for ${u} MU; ${fmt(y.DmaxPerMU)} Gy per 100 MU${atZmax ? dev : ''}`,
            ),
          );
        } else if (r.depth.on) out.push(L('  Пересчёт на z_max не выполнен: исправьте данные раздела 8.', '  Transfer to z_max not performed: correct the data in section 8.'));
      };
      if (x.recal && !x.recal.blocked) {
        describe(x.recal, L('После калибровки ускорителя (раздел 9)', 'After the linac calibration (section 9)'), r.recal.mu);
        if (x.recal.pre) {
          const preV = r.depth.nominalAt === 'zmax' ? x.recal.pre.DmaxPerMU : x.recal.pre.DperMU;
          out.push(
            L(
              `  До калибровки: ${fmt(preV)} Гр на 100 МЕ; отклонение от номинала ${fmtSigned(x.recal.pre.deviation, 2)} %; от дозы после калибровки ${fmtSigned(x.recal.preVsNew, 2)} %`,
              `  Before calibration: ${fmt(preV)} Gy per 100 MU; deviation from nominal ${fmtSigned(x.recal.pre.deviation, 2)} %; from the dose after calibration ${fmtSigned(x.recal.preVsNew, 2)} %`,
            ),
          );
        }
      } else if (x.ctrl && !x.ctrl.blocked) describe(x.ctrl, L('По контрольным измерениям (раздел 7)', 'From check measurements (section 7)'), r.ctrl.mu);
      else if (r.ctrl.on) out.push(L('РЕЗУЛЬТАТ НЕ ВЫЧИСЛЕН: в контрольных измерениях (раздел 7) ошибки (см. замечания).', 'RESULT NOT CALCULATED: the check measurements (section 7) contain errors (see Messages).'));
      else describe(x, L('По показанию M₁ раздела 5 (контрольные измерения не введены)', 'From reading M₁ of section 5 (no check measurements entered)'), i.mu);
      const cl = complianceLine(r.compliance, PROTO[k].name);
      if (cl) out.push(cl);
    }
    out.push('');
  }
  const msgs = r.messages.filter((m) => m.level !== 'info');
  if (msgs.length) {
    out.push(L('Замечания:', 'Messages:'));
    msgs.forEach((m) => out.push(`- ${m.text}${m.ref ? ` [${refText(m.ref)}]` : ''}`));
    out.push('');
  }
  if (data.e_notes) out.push(`${L('Примечания', 'Notes')}: ${data.e_notes}`);
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

/** Загрузка данных из файла или буфера обмена. */
export function importElectrons(obj) {
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
 * Данные вкладки для инструмента «Неопределённость» (кнопка «Взять данные с вкладки»): тип камеры, способ
 * калибровки, R50, серия показаний итога, итог и сведения об аппарате. Сама вкладка бюджет не показывает.
 */
export function electronsUncSource() {
  const { data, result } = current;
  if (!result) return null;
  const x = result.protocol === 'tg51' ? result.tg51 : result.trs;
  const none = x.blocked || ctrlFailed(x);
  const p = primaryOf(x);
  return {
    beam: 'electrons',
    route: data.e_cal_route === 'cross' ? 'crossQ' : 'co60',
    chamberType: result.chamber?.type === 'cyl' ? 'cyl' : 'pp',
    r50: result.quality?.r50,
    M: p === x.recal ? data.e_recal_M : p === x.ctrl ? data.e_ctrl_M : data.e_M1,
    value: none ? NaN : atMaxOf(p, result) ? p.DmaxPerMU : p.DperMU,
    unit: 'Gy100MU',
    meta: { institution: data.e_institution, machine: data.e_machine, beam: data.e_beam, date: data.e_date, staff: data.e_staff },
  };
}
/**
 * k_s (P_ion) на опорной глубине, измеренный методом двух напряжений (без деления на k_s в пучке калибровки), —
 * для поправки на рекомбинацию по глубине в «Кривой дозы электронов». null, если его нет.
 */
export function electronsKsInfo() {
  const { data, result } = current;
  if (!result) return null;
  const tg = result.protocol === 'tg51';
  const ks = tg ? result.tg51?.PionRaw : result.trs?.ksRaw;
  if (!Number.isFinite(ks)) return null;
  const c = result.chamber;
  const chamber = [c && c.maker && c.model ? eChamberLabel(c) : '', data.e_ch_serial ? `${L('№', 'S/N')} ${data.e_ch_serial}` : ''].filter(Boolean).join(' ');
  return { ks, tg, chamber, V1: data.e_V1, beam: data.e_beam, date: data.e_date };
}
/** Открытый файл: пока форму не меняли, итог сверяется с сохранённым в файле. */
let openedFile = null;
function update() {
  const data = readForm();
  const result = computeElectrons(data);
  current = { data: result.form, result };
  applyVisibility(result.form, result);
  renderOutputs(ROOT(), result);
  renderFlags(ROOT(), result.flags, seriesBox);
  renderChamberInfo(result);
  renderReadout(result, result.form);
  $('#e-demo-flag').hidden = !isDemo(data);
  renderNotesFlag($('#e-notes-flag'), data.e_notes, [SAMPLE_ELECTRONS.e_notes, SAMPLE_ELECTRONS_EN.e_notes], isDemo(data));
  renderFileNote($('#e-file-note'), openedFile ? compareWithFile(openedFile, snapshot(result), SNAP_CMP) : null);
  saveDraft(result.form);
  renderSignBlock($('#e-sign'), result.form.e_staff);
  notifyUpdate(ROOT());
}

/** Подстановка значений из другой вкладки (перекрёстная калибровка из «Инструментов»): остальные поля не меняются. */
export function applyElectronsPatch(patch) {
  writeForm({ ...readForm(), ...patch });
  openedFile = null;
  update();
  flashFields(Object.keys(patch));
}

// ------------------------------------------------------------ связь с журналом
// «Все настройки» пучка электронов из «Оборудования» и «Открыть во вкладке» из сеанса — плашка над рабочим листом.
const journalView = makeJournalView({
  bar: () => $('#e-journal-bar'),
  storageKey: 'reference-dosimetry.electrons.journal-view.v1',
  readForm: () => normalizeElectrons(readForm()),
  writeForm: (form, withProtocol) => {
    if (withProtocol) applyProtocol(normalizeElectrons(form).protocol);
    writeForm(form);
  },
  refresh: () => {
    openedFile = null;
    update();
  },
  setStatus: (t) => setStatus(t),
});
/** Куда записывать настройки пучка из вкладки по «Сохранить в журнал». */
export const setElectronsJournalSave = (fn) => journalView.setSave(fn);
/** Текущая форма вкладки (для «Пучок из вкладки «Электроны»»). */
export const electronsCurrentForm = () => normalizeElectrons(readForm());
/** Загрузить форму журнала во вкладку (протокол в шапке ставится по форме). */
export const showInElectrons = (form, opts) => journalView.show(form, opts);

function onBeamInput() {
  const { energy } = parseElectronBeam($('#e_beam').value);
  if (Number.isFinite(energy)) $('#e_energy').value = getLang() === 'en' ? String(energy) : String(energy).replace('.', ',');
}

/** Смена языка: списки с переведёнными подписями, подписи ячеек, десятичный разделитель, пересчёт. */
function refreshForLang() {
  const kept = $$('select', ROOT()).map((sel) => [sel, sel.value]);
  fillSelects();
  for (const [sel, v] of kept) if ([...sel.options].some((o) => o.value === v)) sel.value = v;
  $$('#e-sheet .cells').forEach((box) => renderCells(box, readCells(box)));
  renderStaff($('#e-staff-list'), readStaff($('#e-staff-list')), update);
  localizeDemo(SAMPLE_ELECTRONS, SAMPLE_ELECTRONS_EN);
  localizeDecimals(ROOT());
  update();
  journalView.render();
}

export function initElectrons() {
  setStatus = makeStatus($('#e-status'));
  fillSelects();
  $$('#e-sheet .cells').forEach((box) => setupCells(box, update));
  $$('#e-sheet > section .combo').forEach((c) => makeCombo(c));

  const draft = loadDraft();
  writeForm(draft ? draft : sampleData());
  localizeDemo(SAMPLE_ELECTRONS, SAMPLE_ELECTRONS_EN);
  // во вкладке был пучок журнала (страницу перезагрузили): плашка с возвратом прежних данных остаётся
  journalView.load();
  update();
  if (!draft) setStatus(L('Загружен демонстрационный пример. Нажмите «Очистить», чтобы ввести свои данные.', 'Demo example loaded. Click "Clear" to enter your own data.'));

  const sheet = $('#e-sheet');
  sheet.addEventListener('input', (e) => {
    openedFile = null;
    if (e.target.id === 'e_beam') onBeamInput();
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

  $('#e-btn-add-staff').addEventListener('click', () => {
    const cur = readStaff($('#e-staff-list'));
    cur.push('');
    renderStaff($('#e-staff-list'), cur, update);
    $$('#e-staff-list .staff-input').at(-1).focus();
    update();
  });
  for (const b of $$('[data-e-preset]')) {
    b.addEventListener('click', () => {
      const [t0, p0] = b.dataset.ePreset.split('|');
      $('#e_T0').value = t0;
      $('#e_P0').value = p0;
      update();
    });
  }

  $('#e-btn-sample').addEventListener('click', () => {
    openedFile = null;
    writeForm(sampleData());
    update();
    setStatus(L('Загружен демонстрационный пример (вымышленные данные).', 'Demo example loaded (fictitious data).'));
  });
  armButton($('#e-btn-clear'), () => L('Очистить', 'Clear'), () => L('Точно очистить?', 'Clear everything?'), () => {
    writeForm({ ...E_DEFAULTS, e_date: today() });
    openedFile = null;
    update();
    setStatus(L('Форма очищена.', 'Form cleared.'));
  });

  const payload = () => JSON.stringify({ ...FILE_TAG, ...fileStamp(snapshot(current.result)), savedAt: new Date().toISOString(), form: current.data }, null, 2);
  $('#e-btn-save').addEventListener('click', () => {
    const name = [current.data.e_machine, current.data.e_beam, current.data.e_date].filter(Boolean).join('_').replace(/[^\p{L}\p{N}_.-]+/gu, '-') || 'electrons';
    downloadText(payload(), `dosimetry_${name}.json`);
    setStatus(L('Файл сохранён.', 'File saved.'));
  });
  $('#e-btn-load').addEventListener('click', () => $('#e-file-input').click());
  $('#e-file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      importElectrons(JSON.parse(await file.text()));
      setStatus(L(`Открыт файл ${file.name}.`, `Opened file ${file.name}.`));
    } catch (err) {
      setStatus(err instanceof SyntaxError ? L('Файл повреждён: это не JSON.', 'The file is damaged: it is not JSON.') : err.message);
    }
    e.target.value = '';
  });
  $('#e-btn-copy-json').addEventListener('click', () =>
    copyText(payload(), L('Данные скопированы. Чтобы вставить их обратно, нажмите Ctrl+V на странице вне полей ввода.', 'Data copied. To paste them back, press Ctrl+V on the page outside the input fields.'), setStatus),
  );
  $('#e-btn-copy-report').addEventListener('click', () => copyText(reportText(current.data, current.result), L('Протокол скопирован в буфер обмена.', 'Report copied to the clipboard.'), setStatus));
  $('#e-btn-pdf').addEventListener('click', () => printToPdf([L('Дозиметрия', 'Dosimetry'), L('электроны', 'electrons'), current.data.e_machine, current.data.e_beam, current.data.e_date].filter(Boolean).join('_'), setStatus));
  $('#e-btn-print').addEventListener('click', () => window.print());
}
