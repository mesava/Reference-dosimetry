// Модуль «Электроны»: связывает форму с расчётным ядром electrons.js.
import { computeElectrons, E_DEFAULTS, normalizeElectrons, parseElectronBeam } from '../core/electrons.js';
import { E_CHAMBERS, eChamberLabel } from '../core/electron-chambers.js';
import { SAMPLE_ELECTRONS, SAMPLE_ELECTRONS_EN } from '../core/sample-electrons.js';
import { L, getLang, refText } from '../core/i18n.js';
import { localizeDecimals } from './i18n.js';
import { PRESSURE_UNITS, NDW_UNITS, parseNumber, unitLabel } from '../core/units.js';
import { makeCombo, renderCells, readCells, setupCells, renderStaff, readStaff } from './widgets.js';
import {
  $, $$, fmt, fmtSigned, esc, today, makeStatus, copyText, downloadText,
  currentProtocol, renderOutputs, renderFlags, applyShowRules, armButton, renderSignBlock, printToPdf,
} from './common.js';

const DRAFT_KEY = 'reference-dosimetry.electrons.v1';
const FILE_TAG = { app: 'reference-dosimetry', module: 'electrons', version: 1 };
const SERIES_KEYS = ['e_M1', 'e_Mopp', 'e_M2', 'e_M51', 'e_Mopp51', 'e_M251'];
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
    `<option value="OTHER">${L('Другая камера (k_Q вручную)…', 'Other chamber (k_Q entered manually)…')}</option>`;
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

function applyVisibility(data, r) {
  applyShowRules(ROOT(), data, data.protocol);
  const c = r.chamber;
  const cross = data.e_cal_route === 'cross';
  const sep = r.inputs.separate51;
  $('#e-grp51').hidden = !sep;
  $('#e-grp-main-head').hidden = !sep;
  $('#e-ratio51').hidden = !sep;
  $('#e-lbl-ratio12').textContent = sep ? 'M₁/M₂ (TRS-398)' : 'M₁/M₂';
  const p = r.positions;
  const depth51 = p && Number.isFinite(p.tg51?.depth) ? ` = ${fmt(p.tg51.depth, 2)} ${L('см', 'cm')}` : '';
  $('#e-grp51-hint').textContent = !sep
    ? ''
    : c?.type === 'cyl'
      ? L(
          `Центр камеры на глубине d_ref${depth51}, без сдвига. Те же МЕ и напряжения; P_pol и P_ion для TG-51 считаются по этим сериям.`,
          `Chamber center at depth d_ref${depth51}, no shift. Same MU and voltages; P_pol and P_ion for TG-51 are calculated from these series.`,
        )
      : L(
          'Камера в положении по Report 385 (см. «Положение камеры» в разделе 3). Те же МЕ и напряжения; P_pol и P_ion для TG-51 считаются по этим сериям.',
          'Chamber positioned according to Report 385 (see "Chamber position" in section 3). Same MU and voltages; P_pol and P_ion for TG-51 are calculated from these series.',
        );
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
  else if (c.other) info.textContent = L('k_Q вводится вручную в разделе 6.', 'k_Q is entered manually in section 6.');
  else {
    const bits = [c.type === 'pp' ? L('плоскопараллельная', 'plane-parallel') : L('цилиндрическая', 'cylindrical')];
    if (c.type === 'pp' && Number.isFinite(c.windowMgCm2)) bits.push(L(`входное окно ${fmt(c.windowMgCm2, c.windowMgCm2 < 10 ? 2 : 0)} мг/см²`, `entrance window ${fmt(c.windowMgCm2, c.windowMgCm2 < 10 ? 2 : 0)} mg/cm²`));
    else if (c.type === 'pp' && Number.isFinite(c.windowMm)) bits.push(L(`входное окно ${fmt(c.windowMm, 1)} мм`, `entrance window ${fmt(c.windowMm, 1)} mm`));
    if (c.type === 'cyl' && Number.isFinite(c.trsRcylMm)) bits.push(L(`r_cyl = ${fmt(c.trsRcylMm, 1)} мм (табл. 4 TRS-398)`, `r_cyl = ${fmt(c.trsRcylMm, 1)} mm (TRS-398 Table 4)`));
    const src = [c.trsT20 ? L('TRS-398 табл. 20', 'TRS-398 Table 20') : null, c.trsT21 ? L('табл. 21', 'Table 21') : null, c.r385 ? 'Report 385' : null].filter(Boolean);
    bits.push(L(`данные k_Q: ${src.join(', ')}`, `k_Q data: ${src.join(', ')}`));
    info.textContent = bits.join(' · ');
  }
  const p = r.positions;
  const box = $('#e-positions');
  if (!p) {
    box.hidden = true;
    return;
  }
  const keys = r.protocol === 'both' ? ['trs', 'tg51'] : [r.protocol];
  box.hidden = false;
  box.innerHTML = `<h4>${L('Положение камеры', 'Chamber position')}</h4><ul>${keys.map((k) => `<li><b>${PROTO[k].name}:</b> ${esc(p[k].text)}</li>`).join('')}</ul>`;
}

// ------------------------------------------------------------ вывод
function doseRow(key, x, r) {
  const depthOn = r.depth.on && Number.isFinite(x.DmaxPerMU);
  const main = depthOn ? x.DmaxPerMU : x.DperMU;
  const z = zTxt(r.quality.zref);
  const where = depthOn ? L('на z<sub>max</sub>', 'at z<sub>max</sub>') : L(`на ${z} см`, `at ${z} cm`);
  let chip = '';
  if (depthOn && Number.isFinite(x.deviation) && !x.blocked) {
    const cls = Math.abs(x.deviation) <= 1 ? 'good' : Math.abs(x.deviation) > 2 ? 'bad' : '';
    chip = `<span class="chip ${cls}" title="${L('Отклонение от номинального выхода', 'Deviation from nominal output')}">${fmtSigned(x.deviation, 2)} %</span>`;
  }
  const mu = r.inputs.mu;
  const forMu = Number.isFinite(mu) ? L(` за ${fmt(mu, 0)} МЕ`, ` for ${fmt(mu, 0)} MU`) : '';
  const secondary = [
    L(`= ${fmt(main, 4)} Гр на 100 МЕ ${where}`, `= ${fmt(main, 4)} Gy per 100 MU ${where}`),
    L(`D<sub>w</sub>(${z} см) = ${fmt(x.D, 4)} Гр${forMu}`, `D<sub>w</sub>(${z} cm) = ${fmt(x.D, 4)} Gy${forMu}`),
    depthOn ? L(`${fmt(x.DperMU, 4)} сГр/МЕ на ${z} см`, `${fmt(x.DperMU, 4)} cGy/MU at ${z} cm`) : null,
  ].filter(Boolean).join('<br>');
  return `<div class="dose-row ${x.blocked ? 'blocked' : ''}">
    <div class="proto"><span>${PROTO[key].name}</span>${chip}</div>
    <div class="dose-big">${x.blocked || !Number.isFinite(main) ? '—' : fmt(main, 4)}<small>${L('сГр/МЕ', 'cGy/MU')} ${where}</small></div>
    <div class="secondary">${x.blocked ? L('Исправьте ошибки из списка замечаний', 'Correct the errors listed under Messages') : secondary}</div>
  </div>`;
}

function renderReadout(r, data) {
  const keys = data.protocol === 'both' ? ['trs', 'tg51'] : [data.protocol];
  const pick = (k) => (k === 'trs' ? r.trs : r.tg51);
  $('#e-dose-rows').innerHTML = keys.map((k) => doseRow(k, pick(k), r)).join('');
  const delta = $('#e-delta');
  if (r.comparison) {
    delta.hidden = false;
    delta.innerHTML = `${L('TG-51 относительно TRS-398', 'TG-51 relative to TRS-398')}: <b>${fmtSigned(r.comparison.dRel, 2)} %</b>`;
  } else delta.hidden = true;

  const first = keys.map((k) => ({ k, x: pick(k) })).find((o) => !o.x.blocked && o.x.ok);
  const mv = $('#e-mobile-value');
  if (first) {
    const val = r.depth.on && Number.isFinite(first.x.DmaxPerMU) ? first.x.DmaxPerMU : first.x.DperMU;
    mv.innerHTML = `${first.k === 'trs' ? 'TRS' : 'TG-51'}: <b>${fmt(val, 4)}</b> ${L('сГр/МЕ', 'cGy/MU')}${Number.isFinite(first.x.deviation) ? ` (${fmtSigned(first.x.deviation, 2)} %)` : ''}`;
  } else {
    const n = r.messages.filter((m) => m.level === 'error').length;
    mv.textContent = n ? L(`Ошибок: ${n}`, `Errors: ${n}`) : '—';
  }

  const lvlName = { error: L('Ошибка', 'Error'), warn: L('Внимание', 'Warning'), info: L('Справка', 'Note') };
  const scopeName = { common: '', depth: L('Пересчёт на z_max · ', 'Transfer to z_max · '), trs: 'TRS-398 · ', tg51: 'TG-51 · ' };
  const list = r.messages.filter((m) => m.scope === 'common' || m.scope === 'depth' || keys.includes(m.scope));
  $('#e-messages').innerHTML = list.length
    ? list.map((m) => `<li class="${m.level}"><span class="lvl">${scopeName[m.scope]}${lvlName[m.level]}</span><span>${esc(m.text)}</span>${m.ref ? `<span class="ref">${esc(refText(m.ref))}</span>` : ''}</li>`).join('')
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
    [L('Исправленное показание, нКл', 'Corrected reading, nC'), ['M<sub>Q</sub>', t.M, 4], ['M', g.M, 4]],
    [L('R<sub>50</sub>, г/см²', 'R<sub>50</sub>, g/cm²'), ['', r.quality.r50, 3], ['', r.quality.r50, 3]],
    cross
      ? [L('Калибровочный коэффициент, Гр/нКл', 'Calibration coefficient, Gy/nC'), ['N<sub>D,w,Qcross</sub>', t.coefficient, 5], ['(k<sub>Qecal</sub>N<sub>D,w</sub>)<sub>pp</sub>', g.coefficient, 5]]
      : [L('N<sub>D,w</sub>, Гр/нКл', 'N<sub>D,w</sub>, Gy/nC'), ['', t.coefficient, 5], ['', g.coefficient, 5]],
    cross
      ? [L('Поправка на качество', 'Beam quality correction'), ['k<sub>Q,Qcross</sub>', t.kQ, 4], ['k′<sub>Q</sub>', g.kQ, 4]]
      : [L('Поправка на качество', 'Beam quality correction'), ['k<sub>Q</sub>', t.kQ, 4], ['k<sub>Q</sub>', g.kQ, 4]],
    [L(`D<sub>w</sub>(${z} см), Гр`, `D<sub>w</sub>(${z} cm), Gy`), ['', t.D, 4, true], ['', g.D, 4, true], 'total'],
    [L(`На ${z} см, сГр/МЕ = Гр на 100 МЕ`, `At ${z} cm, cGy/MU = Gy per 100 MU`), ['', t.DperMU, 4, true], ['', g.DperMU, 4, true]],
  ];
  if (r.depth.on) {
    rows.push([r.depth.label, ['', r.depth.factor, 4], ['', r.depth.factor, 4]]);
    rows.push([L('На z<sub>max</sub>, сГр/МЕ = Гр на 100 МЕ', 'At z<sub>max</sub>, cGy/MU = Gy per 100 MU'), ['', t.DmaxPerMU, 4, true], ['', g.DmaxPerMU, 4, true], 'total']);
  }
  const cell = ([sym, v, d, dose], blocked) => `<td class="v">${sym ? `<i>${sym}</i> ` : ''}${dose && blocked ? '—' : fmt(v, d)}</td>`;
  $('#e-factors').innerHTML =
    `<thead><tr><th>${L('Величина', 'Quantity')}</th>${showT ? '<th>TRS-398</th>' : ''}${showG ? '<th>TG-51</th>' : ''}</tr></thead><tbody>` +
    rows.map((row) => `<tr class="${row[3] || ''}"><td>${row[0]}</td>${showT ? cell(row[1], t.blocked) : ''}${showG ? cell(row[2], g.blocked) : ''}</tr>`).join('') +
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
  line(L('Протокол', 'Protocol'), data.protocol === 'both' ? L('TRS-398 Rev.1 и TG-51 с Report 385', 'TRS-398 Rev.1 and TG-51 with Report 385') : PROTO[data.protocol].name);
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
    const keys = data.protocol === 'both' ? ['trs', 'tg51'] : [data.protocol];
    keys.forEach((k) => line(L(`Положение (${PROTO[k].name})`, `Position (${PROTO[k].name})`), r.positions[k].text));
  }
  if (i.cross) {
    if (r.trs.enabled) line('N_D,w,Qcross (TRS-398)', L(`${data.e_cross_ndw} ${unitLabel(NDW_UNITS[data.e_cross_ndw_unit])} при R50 = ${data.e_cross_r50} г/см²`, `${data.e_cross_ndw} ${unitLabel(NDW_UNITS[data.e_cross_ndw_unit])} at R50 = ${data.e_cross_r50} g/cm²`));
    if (r.tg51.enabled) line('(k_Qecal·N_D,w)pp (Report 385)', `${data.e_cross_kn} ${unitLabel(NDW_UNITS[data.e_cross_kn_unit])}`);
  } else {
    line('N_D,w (⁶⁰Co)', `${data.e_ndw} ${unitLabel(NDW_UNITS[data.e_ndw_unit])} (= ${fmt(i.ndw, 6)} ${L('Гр/нКл', 'Gy/nC')})`);
  }
  line(L('Стандартные условия', 'Reference conditions'), `T0 = ${data.e_T0} °C, P0 = ${data.e_P0} ${L('кПа', 'kPa')}`);
  line(L('Электрометр', 'Electrometer'), `${data.e_el_model || '—'}, ${L('№', 'S/N')} ${data.e_el_serial || '—'}, k_elec = ${data.e_kelec}`);
  line(
    L('Условия', 'Conditions'),
    `T = ${data.e_env_T} °C, P = ${data.e_env_P} ${unitLabel(PRESSURE_UNITS[data.e_env_P_unit])}${String(data.e_env_H ?? '').trim() ? L(`, относительная влажность ${data.e_env_H} %`, `, relative humidity ${data.e_env_H} %`) : ''}`,
  );
  line(L('Облучение', 'Irradiation'), L(`${data.e_mu} МЕ, V1 = ${data.e_V1} В, V2 = ${data.e_V2} В, обычная полярность ${data.e_polarity}`, `${data.e_mu} MU, V1 = ${data.e_V1} V, V2 = ${data.e_V2} V, normal polarity ${data.e_polarity}`));
  const at = i.separate51 ? L(', положение по TRS-398', ', TRS-398 position') : '';
  line(L(`M(V1, обычная${at}), нКл`, `M(V1, normal${at}), nC`), `${cells(data.e_M1)} → ${mean} ${fmt(Math.abs(i.M1.mean), 4)}`);
  line(L(`M(V1, обратная${at}), нКл`, `M(V1, opposite${at}), nC`), `${cells(data.e_Mopp)} → ${mean} ${fmt(Math.abs(i.Mopp.mean), 4)}`);
  line(L(`M(V2${at}), нКл`, `M(V2${at}), nC`), `${cells(data.e_M2)} → ${mean} ${fmt(Math.abs(i.M2.mean), 4)}`);
  if (i.separate51) {
    line(L('M(V1, обычная, положение по Report 385), нКл', 'M(V1, normal, Report 385 position), nC'), `${cells(data.e_M51)} → ${mean} ${fmt(Math.abs(i.M51?.mean), 4)}`);
    line(L('M(V1, обратная, положение по Report 385), нКл', 'M(V1, opposite, Report 385 position), nC'), `${cells(data.e_Mopp51)} → ${mean} ${fmt(Math.abs(i.Mopp51?.mean), 4)}`);
    line(L('M(V2, положение по Report 385), нКл', 'M(V2, Report 385 position), nC'), `${cells(data.e_M251)} → ${mean} ${fmt(Math.abs(i.M251?.mean), 4)}`);
  }
  out.push('');
  const blocks = data.protocol === 'both' ? ['trs', 'tg51'] : [data.protocol];
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
      out.push(L(`M = ${fmt(x.M)} нКл; D_w(z_ref) = ${fmt(x.D)} Гр; ${fmt(x.DperMU)} сГр/МЕ (Гр на 100 МЕ) на z_ref`, `M = ${fmt(x.M)} nC; D_w(z_ref) = ${fmt(x.D)} Gy; ${fmt(x.DperMU)} cGy/MU (Gy per 100 MU) at z_ref`));
      if (r.depth.on && r.depth.ok && Number.isFinite(x.DmaxPerMU)) {
        const zmax = data.e_zmax ? `; z_max = ${data.e_zmax} ${L('см', 'cm')}` : '';
        const dev = Number.isFinite(x.deviation) ? L(`; отклонение от номинала ${fmtSigned(x.deviation, 2)} %`, `; deviation from nominal ${fmtSigned(x.deviation, 2)} %`) : '';
        out.push(L(`${r.depth.label} = ${fmt(r.depth.factor)}${zmax}; на z_max ${fmt(x.DmaxPerMU)} сГр/МЕ (Гр на 100 МЕ)${dev}`, `${r.depth.label} = ${fmt(r.depth.factor)}${zmax}; at z_max ${fmt(x.DmaxPerMU)} cGy/MU (Gy per 100 MU)${dev}`));
      } else if (r.depth.on) out.push(L('Пересчёт на z_max не выполнен: исправьте данные раздела 7.', 'Transfer to z_max not performed: correct the data in section 7.'));
    }
    out.push('');
  }
  if (r.comparison) out.push(`${L('TG-51 относительно TRS-398', 'TG-51 relative to TRS-398')}: ${fmtSigned(r.comparison.dRel, 2)} %`, '');
  const msgs = r.messages.filter((m) => m.level !== 'info');
  if (msgs.length) {
    out.push(L('Замечания:', 'Messages:'));
    msgs.forEach((m) => out.push(`- ${m.text}${m.ref ? ` [${refText(m.ref)}]` : ''}`));
    out.push('');
  }
  if (data.e_notes) out.push(`${L('Примечания', 'Notes')}: ${data.e_notes}`);
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
  if (obj.module !== FILE_TAG.module) {
    throw new Error(L('Это файл другого раздела: откройте его на соответствующей вкладке или вставьте данные через Ctrl+V — нужная вкладка откроется сама.', 'This file belongs to another section: open it on the corresponding tab, or paste the data with Ctrl+V — the right tab will open automatically.'));
  }
  writeForm(obj.form);
  update();
}

// ------------------------------------------------------------ цикл
let current = { data: null, result: null };
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
  saveDraft(result.form);
  renderSignBlock($('#e-sign'), result.form.e_staff);
}

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
  localizeDecimals(ROOT());
  update();
}

export function initElectrons() {
  setStatus = makeStatus($('#e-status'));
  fillSelects();
  $$('#e-sheet .cells').forEach((box) => setupCells(box, update));
  $$('#e-sheet > section .combo').forEach((c) => makeCombo(c));

  const draft = loadDraft();
  writeForm(draft ? draft : sampleData());
  update();
  if (!draft) setStatus(L('Загружен демонстрационный пример. Нажмите «Очистить», чтобы ввести свои данные.', 'Demo example loaded. Click "Clear" to enter your own data.'));

  const sheet = $('#e-sheet');
  sheet.addEventListener('input', (e) => {
    if (e.target.id === 'e_beam') onBeamInput();
    update();
  });
  sheet.addEventListener('change', update);
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
    writeForm(sampleData());
    update();
    setStatus(L('Загружен демонстрационный пример (вымышленные данные).', 'Demo example loaded (fictitious data).'));
  });
  armButton($('#e-btn-clear'), () => L('Очистить', 'Clear'), () => L('Точно очистить?', 'Clear everything?'), () => {
    writeForm({ ...E_DEFAULTS, e_date: today() });
    update();
    setStatus(L('Форма очищена.', 'Form cleared.'));
  });

  const payload = () => JSON.stringify({ ...FILE_TAG, savedAt: new Date().toISOString(), form: current.data }, null, 2);
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
