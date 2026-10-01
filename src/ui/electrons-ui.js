// Модуль «Электроны»: связывает форму с расчётным ядром electrons.js.
import { computeElectrons, E_DEFAULTS, normalizeElectrons, parseElectronBeam } from '../core/electrons.js';
import { E_CHAMBERS, eChamberLabel } from '../core/electron-chambers.js';
import { SAMPLE_ELECTRONS, SAMPLE_ELECTRONS_EN } from '../core/sample-electrons.js';
import { L, getLang } from '../core/i18n.js';
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
        const tags = [c.trsT20 ? 'TRS: ⁶⁰Co' : null, c.trsT21 ? 'TRS: перекр.' : null, c.r385 ? 'Report 385' : null].filter(Boolean).join(', ');
        return `<option value="${c.id}">${esc(eChamberLabel(c))} [${tags}]</option>`;
      })
      .join('')}</optgroup>`;
  };
  $('#e_ch_model').innerHTML =
    '<option value="">— выберите камеру —</option>' +
    group('pp', 'Плоскопараллельные') +
    group('cyl', 'Цилиндрические') +
    '<option value="OTHER">Другая камера (k_Q вручную)…</option>';
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
  $('#e-grp51-hint').textContent = !sep
    ? ''
    : c?.type === 'cyl'
      ? `Центр камеры на глубине d_ref${p && Number.isFinite(p.tg51?.depth) ? ` = ${fmt(p.tg51.depth, 2)} см` : ''}, без сдвига. Те же МЕ и напряжения; P_pol и P_ion для TG-51 считаются по этим сериям.`
      : 'Камера в положении по Report 385 (см. «Положение камеры» в разделе 3). Те же МЕ и напряжения; P_pol и P_ion для TG-51 считаются по этим сериям.';
  $('#e-opt-trs-table').textContent = cross ? 'по табл. 21: k_Q,Qint / k_Qcross,Qint (ур. 44)' : 'по табл. 20 с интерполяцией по R50';
  $('#e-opt-trs-formula').textContent = cross ? 'по аппроксимации прил. II (табл. 48), ур. (44)' : 'по аппроксимации прил. II (табл. 47)';
  $('#e-lbl-kqtrs').innerHTML = cross ? 'k<sub>Q,Qcross</sub>' : 'k<sub>Q,Q₀</sub>';
  $('#e-lbl-kq51').innerHTML = cross ? 'k′<sub>Q</sub>' : 'k<sub>Q</sub>';
  $('#e-lbl-kq51-used').innerHTML = cross ? 'k′<sub>Q</sub> в расчёте' : 'k<sub>Q</sub> = k′<sub>Q</sub>·k<sub>Qecal</sub>';
  $('#e-lbl-pdd').textContent = `PDD(${zTxt(r.quality.zref)} см), %`;
  const field = parseNumber(data.e_field);
  $('#e-field-view').textContent = Number.isFinite(field) ? `${fmt(field, field % 1 ? 1 : 0)} × ${fmt(field, field % 1 ? 1 : 0)} см` : '';

  // подсказка к измерению R50 для выбранной камеры
  const bits = ['Кривую ионизации измеряют при РИП 100 см и поле не меньше 10 × 10 см, сканируя к поверхности.'];
  if (c?.type === 'pp') {
    bits.push('TRS-398: точка измерения — внутренняя поверхность входного окна с учётом его водоэквивалентной толщины.');
    if (c.r385) bits.push(`Report 385: точка измерения ${fmt(c.r385.shiftMm, 1)} мм за наружной поверхностью окна (табл. 3).`);
  } else if (c?.type === 'cyl') {
    const rc = c.trsRcylMm ?? c.rCavMm;
    if (Number.isFinite(rc)) bits.push(`TRS-398: кривую сдвигают на 0,5·r_cyl = ${fmt(0.5 * rc, 2)} мм к поверхности.`);
    if (c.r385) bits.push(`Report 385: сдвиг ${fmt(c.r385.shiftMm, 1)} мм выше центра камеры (табл. 2).`);
  }
  $('#e-epom-hint').textContent = bits.join(' ');
}

function renderChamberInfo(r) {
  const c = r.chamber;
  const info = $('#e-chamber-info');
  if (!c) info.textContent = '';
  else if (c.other) info.textContent = 'k_Q вводится вручную в разделе 6.';
  else {
    const bits = [c.type === 'pp' ? 'плоскопараллельная' : 'цилиндрическая'];
    if (c.type === 'pp' && Number.isFinite(c.windowMgCm2)) bits.push(`входное окно ${fmt(c.windowMgCm2, c.windowMgCm2 < 10 ? 2 : 0)} мг/см²`);
    else if (c.type === 'pp' && Number.isFinite(c.windowMm)) bits.push(`входное окно ${fmt(c.windowMm, 1)} мм`);
    if (c.type === 'cyl' && Number.isFinite(c.trsRcylMm)) bits.push(`r_cyl = ${fmt(c.trsRcylMm, 1)} мм (табл. 4 TRS-398)`);
    const src = [c.trsT20 ? 'TRS-398 табл. 20' : null, c.trsT21 ? 'табл. 21' : null, c.r385 ? 'Report 385' : null].filter(Boolean);
    bits.push(`данные k_Q: ${src.join(', ')}`);
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
  box.innerHTML = `<h4>Положение камеры</h4><ul>${keys.map((k) => `<li><b>${PROTO[k].name}:</b> ${esc(p[k].text)}</li>`).join('')}</ul>`;
}

// ------------------------------------------------------------ вывод
function doseRow(key, x, r) {
  const depthOn = r.depth.on && Number.isFinite(x.DmaxPerMU);
  const main = depthOn ? x.DmaxPerMU : x.DperMU;
  const z = zTxt(r.quality.zref);
  const where = depthOn ? 'на z<sub>max</sub>' : `на ${z} см`;
  let chip = '';
  if (depthOn && Number.isFinite(x.deviation) && !x.blocked) {
    const cls = Math.abs(x.deviation) <= 1 ? 'good' : Math.abs(x.deviation) > 2 ? 'bad' : '';
    chip = `<span class="chip ${cls}" title="Отклонение от номинального выхода">${fmtSigned(x.deviation, 2)} %</span>`;
  }
  const mu = r.inputs.mu;
  const secondary = [
    `= ${fmt(main, 4)} Гр на 100 МЕ ${where}`,
    `D<sub>w</sub>(${z} см) = ${fmt(x.D, 4)} Гр${Number.isFinite(mu) ? ` за ${fmt(mu, 0)} МЕ` : ''}`,
    depthOn ? `${fmt(x.DperMU, 4)} сГр/МЕ на ${z} см` : null,
  ].filter(Boolean).join('<br>');
  return `<div class="dose-row ${x.blocked ? 'blocked' : ''}">
    <div class="proto"><span>${PROTO[key].name}</span>${chip}</div>
    <div class="dose-big">${x.blocked || !Number.isFinite(main) ? '—' : fmt(main, 4)}<small>сГр/МЕ ${where}</small></div>
    <div class="secondary">${x.blocked ? 'Исправьте ошибки из списка замечаний' : secondary}</div>
  </div>`;
}

function renderReadout(r, data) {
  const keys = data.protocol === 'both' ? ['trs', 'tg51'] : [data.protocol];
  const pick = (k) => (k === 'trs' ? r.trs : r.tg51);
  $('#e-dose-rows').innerHTML = keys.map((k) => doseRow(k, pick(k), r)).join('');
  const delta = $('#e-delta');
  if (r.comparison) {
    delta.hidden = false;
    delta.innerHTML = `TG-51 относительно TRS-398: <b>${fmtSigned(r.comparison.dRel, 2)} %</b>`;
  } else delta.hidden = true;

  const first = keys.map((k) => ({ k, x: pick(k) })).find((o) => !o.x.blocked && o.x.ok);
  const mv = $('#e-mobile-value');
  if (first) {
    const val = r.depth.on && Number.isFinite(first.x.DmaxPerMU) ? first.x.DmaxPerMU : first.x.DperMU;
    mv.innerHTML = `${first.k === 'trs' ? 'TRS' : 'TG-51'}: <b>${fmt(val, 4)}</b> сГр/МЕ${Number.isFinite(first.x.deviation) ? ` (${fmtSigned(first.x.deviation, 2)} %)` : ''}`;
  } else {
    const n = r.messages.filter((m) => m.level === 'error').length;
    mv.textContent = n ? `Ошибок: ${n}` : '—';
  }

  const lvlName = { error: 'Ошибка', warn: 'Внимание', info: 'Справка' };
  const scopeName = { common: '', depth: 'Пересчёт на z_max · ', trs: 'TRS-398 · ', tg51: 'TG-51 · ' };
  const list = r.messages.filter((m) => m.scope === 'common' || m.scope === 'depth' || keys.includes(m.scope));
  $('#e-messages').innerHTML = list.length
    ? list.map((m) => `<li class="${m.level}"><span class="lvl">${scopeName[m.scope]}${lvlName[m.level]}</span><span>${esc(m.text)}</span>${m.ref ? `<span class="ref">${esc(m.ref)}</span>` : ''}</li>`).join('')
    : '<li class="info"><span class="lvl">Всё в порядке</span><span>Замечаний к введённым данным нет.</span></li>';

  const t = r.trs;
  const g = r.tg51;
  const showT = keys.includes('trs');
  const showG = keys.includes('tg51');
  const z = zTxt(r.quality.zref);
  const cross = r.inputs.cross;
  const rows = [
    ['Температура и давление', ['k<sub>TP</sub>', t.kTP, 4], ['P<sub>TP</sub>', g.PTP, 4]],
    ['Электрометр', ['k<sub>elec</sub>', t.kelec, 4], ['P<sub>elec</sub>', g.Pelec, 4]],
    ['Полярность', ['k<sub>pol</sub>', t.kpol, 4], ['P<sub>pol</sub>', g.Ppol, 4]],
    ['Рекомбинация', ['k<sub>s</sub>', t.ks, 4], ['P<sub>ion</sub>', g.Pion, 4]],
    ['Утечка', ['k<sub>leak</sub>', t.kleak, 4], ['P<sub>leak</sub>', g.Pleak, 4]],
    ['Исправленное показание, нКл', ['M<sub>Q</sub>', t.M, 4], ['M', g.M, 4]],
    ['R<sub>50</sub>, г/см²', ['', r.quality.r50, 3], ['', r.quality.r50, 3]],
    cross
      ? ['Калибровочный коэффициент, Гр/нКл', ['N<sub>D,w,Qcross</sub>', t.coefficient, 5], ['(k<sub>Qecal</sub>N<sub>D,w</sub>)<sub>pp</sub>', g.coefficient, 5]]
      : ['N<sub>D,w</sub>, Гр/нКл', ['', t.coefficient, 5], ['', g.coefficient, 5]],
    cross
      ? ['Поправка на качество', ['k<sub>Q,Qcross</sub>', t.kQ, 4], ['k′<sub>Q</sub>', g.kQ, 4]]
      : ['Поправка на качество', ['k<sub>Q</sub>', t.kQ, 4], ['k<sub>Q</sub>', g.kQ, 4]],
    [`D<sub>w</sub>(${z} см), Гр`, ['', t.D, 4, true], ['', g.D, 4, true], 'total'],
    [`На ${z} см, сГр/МЕ = Гр на 100 МЕ`, ['', t.DperMU, 4, true], ['', g.DperMU, 4, true]],
  ];
  if (r.depth.on) {
    rows.push([r.depth.label, ['', r.depth.factor, 4], ['', r.depth.factor, 4]]);
    rows.push(['На z<sub>max</sub>, сГр/МЕ = Гр на 100 МЕ', ['', t.DmaxPerMU, 4, true], ['', g.DmaxPerMU, 4, true], 'total']);
  }
  const cell = ([sym, v, d, dose], blocked) => `<td class="v">${sym ? `<i>${sym}</i> ` : ''}${dose && blocked ? '—' : fmt(v, d)}</td>`;
  $('#e-factors').innerHTML =
    `<thead><tr><th>Величина</th>${showT ? '<th>TRS-398</th>' : ''}${showG ? '<th>TG-51</th>' : ''}</tr></thead><tbody>` +
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
  out.push('ПРОТОКОЛ РЕФЕРЕНСНОЙ ДОЗИМЕТРИИ — ПУЧОК ЭЛЕКТРОНОВ');
  line('Протокол', data.protocol === 'both' ? 'TRS-398 Rev.1 и TG-51 с Report 385' : PROTO[data.protocol].name);
  line('Учреждение', data.e_institution || '—');
  line('Аппарат', data.e_machine || '—');
  const beamE = parseElectronBeam(data.e_beam).energy;
  const showE = data.e_energy && !(Number.isFinite(beamE) && Math.abs(beamE - parseNumber(data.e_energy)) < 1e-9);
  line('Пучок', `${data.e_beam || '—'}${showE ? `, ${data.e_energy} МэВ` : ''}`);
  line('Дата', data.e_date || '—');
  line('Измерения выполнили', data.e_staff.filter((s) => s.trim()).join(', ') || '—');
  line('Геометрия', `РИП = ${data.e_ssd} см, поле ${data.e_field}×${data.e_field} см на поверхности воды`);
  line('Качество пучка', `${q.method === 'i50' ? `R50,ion = ${data.e_i50} г/см²; ` : ''}R50 = ${fmt(q.r50, 3)} г/см²; z_ref = ${fmt(q.zref, 3)} г/см²; E0 ≈ ${fmt(q.E0, 1)} МэВ`);
  out.push('');
  line('Камера', c ? `${c.other ? data.e_other_name || 'другая камера' : eChamberLabel(c)} (${c.type === 'pp' ? 'плоскопараллельная' : 'цилиндрическая'}), № ${data.e_ch_serial || '—'}` : '—');
  if (r.positions) {
    const keys = data.protocol === 'both' ? ['trs', 'tg51'] : [data.protocol];
    keys.forEach((k) => line(`Положение (${PROTO[k].name})`, r.positions[k].text));
  }
  if (i.cross) {
    if (r.trs.enabled) line('N_D,w,Qcross (TRS-398)', `${data.e_cross_ndw} ${NDW_UNITS[data.e_cross_ndw_unit]?.label ?? ''} при R50 = ${data.e_cross_r50} г/см²`);
    if (r.tg51.enabled) line('(k_Qecal·N_D,w)pp (Report 385)', `${data.e_cross_kn} ${NDW_UNITS[data.e_cross_kn_unit]?.label ?? ''}`);
  } else {
    line('N_D,w (⁶⁰Co)', `${data.e_ndw} ${NDW_UNITS[data.e_ndw_unit]?.label ?? ''} (= ${fmt(i.ndw, 6)} Гр/нКл)`);
  }
  line('Стандартные условия', `T0 = ${data.e_T0} °C, P0 = ${data.e_P0} кПа`);
  line('Электрометр', `${data.e_el_model || '—'}, № ${data.e_el_serial || '—'}, k_elec = ${data.e_kelec}`);
  line('Условия', `T = ${data.e_env_T} °C, P = ${data.e_env_P} ${PRESSURE_UNITS[data.e_env_P_unit]?.label ?? ''}${String(data.e_env_H ?? '').trim() ? `, относительная влажность ${data.e_env_H} %` : ''}`);
  line('Облучение', `${data.e_mu} МЕ, V1 = ${data.e_V1} В, V2 = ${data.e_V2} В, обычная полярность ${data.e_polarity}`);
  const at = i.separate51 ? ', положение по TRS-398' : '';
  line(`M(V1, обычная${at}), нКл`, `${cells(data.e_M1)} → среднее ${fmt(Math.abs(i.M1.mean), 4)}`);
  line(`M(V1, обратная${at}), нКл`, `${cells(data.e_Mopp)} → среднее ${fmt(Math.abs(i.Mopp.mean), 4)}`);
  line(`M(V2${at}), нКл`, `${cells(data.e_M2)} → среднее ${fmt(Math.abs(i.M2.mean), 4)}`);
  if (i.separate51) {
    line('M(V1, обычная, положение по Report 385), нКл', `${cells(data.e_M51)} → среднее ${fmt(Math.abs(i.M51?.mean), 4)}`);
    line('M(V1, обратная, положение по Report 385), нКл', `${cells(data.e_Mopp51)} → среднее ${fmt(Math.abs(i.Mopp51?.mean), 4)}`);
    line('M(V2, положение по Report 385), нКл', `${cells(data.e_M251)} → среднее ${fmt(Math.abs(i.M251?.mean), 4)}`);
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
    if (x.blocked) out.push('РЕЗУЛЬТАТ НЕ ВЫЧИСЛЕН: есть ошибки ввода (см. замечания).');
    else {
      out.push(`M = ${fmt(x.M)} нКл; D_w(z_ref) = ${fmt(x.D)} Гр; ${fmt(x.DperMU)} сГр/МЕ (Гр на 100 МЕ) на z_ref`);
      if (r.depth.on && r.depth.ok && Number.isFinite(x.DmaxPerMU)) {
        out.push(`${r.depth.label} = ${fmt(r.depth.factor)}${data.e_zmax ? `; z_max = ${data.e_zmax} см` : ''}; на z_max ${fmt(x.DmaxPerMU)} сГр/МЕ (Гр на 100 МЕ)${Number.isFinite(x.deviation) ? `; отклонение от номинала ${fmtSigned(x.deviation, 2)} %` : ''}`);
      } else if (r.depth.on) out.push('Пересчёт на z_max не выполнен: исправьте данные раздела 7.');
    }
    out.push('');
  }
  if (r.comparison) out.push(`TG-51 относительно TRS-398: ${fmtSigned(r.comparison.dRel, 2)} %`, '');
  const msgs = r.messages.filter((m) => m.level !== 'info');
  if (msgs.length) {
    out.push('Замечания:');
    msgs.forEach((m) => out.push(`- ${m.text}${m.ref ? ` [${m.ref}]` : ''}`));
    out.push('');
  }
  if (data.e_notes) out.push(`Примечания: ${data.e_notes}`);
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
  if (!obj || obj.app !== FILE_TAG.app || typeof obj.form !== 'object') throw new Error('Это не файл калькулятора референсной дозиметрии.');
  if (obj.module !== FILE_TAG.module) throw new Error('Это файл другого раздела: откройте его на соответствующей вкладке или вставьте данные через Ctrl+V — нужная вкладка откроется сама.');
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
  if (Number.isFinite(energy)) $('#e_energy').value = String(energy).replace('.', ',');
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
  if (!draft) setStatus('Загружен демонстрационный пример. Нажмите «Очистить», чтобы ввести свои данные.');

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
    setStatus('Загружен демонстрационный пример (вымышленные данные).');
  });
  armButton($('#e-btn-clear'), 'Очистить', 'Точно очистить?', () => {
    writeForm({ ...E_DEFAULTS, e_date: today() });
    update();
    setStatus('Форма очищена.');
  });

  const payload = () => JSON.stringify({ ...FILE_TAG, savedAt: new Date().toISOString(), form: current.data }, null, 2);
  $('#e-btn-save').addEventListener('click', () => {
    const name = [current.data.e_machine, current.data.e_beam, current.data.e_date].filter(Boolean).join('_').replace(/[^\p{L}\p{N}_.-]+/gu, '-') || 'electrons';
    downloadText(payload(), `dosimetry_${name}.json`);
    setStatus('Файл сохранён.');
  });
  $('#e-btn-load').addEventListener('click', () => $('#e-file-input').click());
  $('#e-file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      importElectrons(JSON.parse(await file.text()));
      setStatus(`Открыт файл ${file.name}.`);
    } catch (err) {
      setStatus(err instanceof SyntaxError ? 'Файл повреждён: это не JSON.' : err.message);
    }
    e.target.value = '';
  });
  $('#e-btn-copy-json').addEventListener('click', () => copyText(payload(), 'Данные скопированы. Чтобы вставить их обратно, нажмите Ctrl+V на странице вне полей ввода.', setStatus));
  $('#e-btn-copy-report').addEventListener('click', () => copyText(reportText(current.data, current.result), 'Протокол скопирован в буфер обмена.', setStatus));
  $('#e-btn-pdf').addEventListener('click', () => printToPdf(['Дозиметрия', 'электроны', current.data.e_machine, current.data.e_beam, current.data.e_date].filter(Boolean).join('_'), setStatus));
  $('#e-btn-print').addEventListener('click', () => window.print());
}
