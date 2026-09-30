// Интерфейс калькулятора МВ фотонов: связывает форму с расчётным ядром.
import { computePhotons, FORM_DEFAULTS, normalizeForm } from '../core/photons.js';
import { SAMPLE_FORM } from '../core/sample.js';
import { CHAMBERS, findChamber, chamberLabel } from '../core/chambers.js';
import { PRESSURE_UNITS, NDW_UNITS, parseBeamName, parseNumber } from '../core/units.js';
import { TERMS } from './terms.js';
import { getMyChambers, saveMyChamber, deleteMyChamber } from './store.js';
import { makeCombo, renderCells, readCells, setupCells, renderStaff, readStaff } from './widgets.js';

const DRAFT_KEY = 'reference-dosimetry.photons.v2';
const FILE_TAG = { app: 'reference-dosimetry', module: 'photons', version: 2 };
const SERIES_KEYS = ['rd_M1', 'rd_Mopp', 'rd_M2'];
const CC_KEYS = ['cc_maker', 'cc_model', 'cc_volume', 'cc_length', 'cc_radius', 'cc_wall', 'cc_wall_thickness', 'cc_electrode', 'cc_waterproof', 'cc_analog', 'cc_a', 'cc_b'];
const framed = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const numberFormats = new Map();
function fmt(value, digits = 4) {
  if (!Number.isFinite(value)) return '—';
  if (!numberFormats.has(digits)) {
    numberFormats.set(digits, new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }));
  }
  return numberFormats.get(digits).format(value).replace('-', '−');
}
function fmtSigned(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return (value > 0 ? '+' : value < 0 ? '−' : '±') + fmt(Math.abs(value), digits);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
const isCustom = (id) => id === 'CUSTOM' || String(id).startsWith('MY:');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ------------------------------------------------------------ списки
function chamberOptions() {
  const groups = new Map();
  for (const c of CHAMBERS) {
    if (!groups.has(c.maker)) groups.set(c.maker, []);
    groups.get(c.maker).push(c);
  }
  return groups;
}

function fillChamberSelect() {
  const sel = $('#ch_model');
  const keep = sel.value;
  const parts = ['<option value="">— выберите камеру —</option>'];
  for (const [maker, list] of chamberOptions()) {
    parts.push(`<optgroup label="${esc(maker)}">`);
    for (const c of list) {
      const tags = [c.tg51 || c.tg51Legacy ? 'TG-51' : null, c.trs ? 'TRS-398' : null].filter(Boolean).join(', ');
      parts.push(`<option value="${c.id}">${esc(c.model)}${c.note ? ' — ' + esc(c.note) : ''} [${tags}]</option>`);
    }
    parts.push('</optgroup>');
  }
  const mine = getMyChambers();
  if (mine.length) {
    parts.push('<optgroup label="Мои камеры">');
    for (const c of mine) parts.push(`<option value="${esc(c.id)}">${esc([c.cc_maker, c.cc_model].filter(Boolean).join(' ') || 'без названия')}</option>`);
    parts.push('</optgroup>');
  }
  parts.push('<option value="CUSTOM">Ввести свою камеру…</option>');
  sel.innerHTML = parts.join('');
  if (keep && $(`#ch_model option[value="${CSS.escape(keep)}"]`)) sel.value = keep;
}

function fillSelects() {
  fillChamberSelect();
  const analog = ['<option value="">— нет —</option>'];
  for (const [maker, list] of chamberOptions()) {
    analog.push(`<optgroup label="${esc(maker)}">`);
    for (const c of list) analog.push(`<option value="${c.id}">${esc(chamberLabel(c))}</option>`);
    analog.push('</optgroup>');
  }
  $('#cc_analog').innerHTML = analog.join('');
  $('#ch_ndw_unit').innerHTML = Object.entries(NDW_UNITS).map(([k, u]) => `<option value="${k}">${u.label}</option>`).join('');
  $('#env_P_unit').innerHTML = Object.entries(PRESSURE_UNITS).map(([k, u]) => `<option value="${k}">${u.label}</option>`).join('');
}

// ------------------------------------------------------------ форма ↔ данные
const seriesBox = (key) => $(`.cells[data-series="${key}"]`);

function readForm() {
  const data = {};
  for (const key of Object.keys(FORM_DEFAULTS)) {
    if (key === 'protocol') data.protocol = $('input[name="protocol"]:checked')?.value ?? 'trs';
    else if (key === 'meta_staff') data.meta_staff = readStaff($('#staff-list'));
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
  const data = normalizeForm(values);
  if (isCustom(data.ch_model) && data.ch_model !== 'CUSTOM' && !getMyChambers().some((c) => c.id === data.ch_model)) {
    data.ch_model = 'CUSTOM';
  }
  for (const [key, value] of Object.entries(data)) {
    if (key === 'protocol') {
      const r = document.getElementById(`protocol_${value}`);
      if (r) r.checked = true;
    } else if (key === 'meta_staff') {
      renderStaff($('#staff-list'), value, update);
    } else if (SERIES_KEYS.includes(key)) {
      renderCells(seriesBox(key), value);
    } else {
      const el = document.getElementById(key);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!value;
      else el.value = value ?? '';
    }
  }
}

function fillCustomFields(saved) {
  for (const k of CC_KEYS) {
    const el = document.getElementById(k);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = saved ? !!saved[k] : FORM_DEFAULTS[k];
    else el.value = saved ? saved[k] ?? '' : FORM_DEFAULTS[k];
  }
}

// ------------------------------------------------------------ видимость и подписи
function applyVisibility(data, result) {
  const p = data.protocol;
  for (const el of $$('[data-protocol]')) {
    el.hidden = !(p === 'both' || p === el.dataset.protocol);
  }
  for (const el of $$('[data-show]')) {
    el.hidden = !el.dataset.show.split(';').every((cond) => {
      const [key, vals] = cond.split(':');
      const v = data[key];
      return vals.split(',').includes(typeof v === 'boolean' ? String(v) : v);
    });
  }
  for (const el of $$('[data-standalone]')) el.hidden = framed;

  $('#custom-chamber').hidden = !isCustom(data.ch_model);
  $('#btn-del-chamber').hidden = !String(data.ch_model).startsWith('MY:');

  // раздел 6 активен только для БВФ; формула (22) и табл. 11 требуют TPR20,10, то есть протокол TRS-398
  const fff = !!data.meta_fff;
  const trsOn = p !== 'tg51';
  $('#kvol-fields').disabled = !fff;
  $('#step-kvol').classList.toggle('inactive', !fff);
  for (const v of ['formula22', 'table11']) {
    const opt = $(`#prof_mode option[value="${v}"]`);
    opt.disabled = !trsOn;
  }
  $('#kvol-hint').textContent = !fff
    ? 'Недоступно: в калькуляторе для пучков с выравнивающим фильтром принимается k_vol = P_rp = 1. Протоколы допускают эту поправку и для таких пучков при неоднородном профиле (TRS-398, табл. 15, прим. c; аддендум TG-51, разд. 5.C.7). Отметьте БВФ в разделе 1, если это ваш случай.'
    : trsOn
      ? 'Пучок без выравнивающего фильтра: поправка обязательна, если камера не короткая. Одна и та же поправка применяется в обоих протоколах.'
      : 'Формула (22) и табл. 11 взяты из TRS-398 и требуют TPR20,10: в режиме «только TG-51» введите P_rp по измеренному профилю.';

  // подписи, зависящие от выбора
  const pdd = data.qtrs_method === 'pdd2010';
  $('#lbl-v20').textContent = pdd ? 'PDD(20), %' : 'M на 20 см';
  $('#lbl-v10').textContent = pdd ? 'PDD(10), %' : 'M на 10 см';
  const z = result.depth.zref;
  const zTxt = Number.isFinite(z) ? fmt(z, z % 1 ? 1 : 0) : '10';
  $('#lbl-dd-pdd').textContent = `PDD(${zTxt}), %`;
  $('label[for="dd_tmr"]').textContent = `TMR(${zTxt})`;
  $('#dd-hint').textContent =
    data.setup_geometry === 'SAD'
      ? 'Геометрия РИО: по протоколу доза переносится на d_max через TMR из данных ввода в эксплуатацию (TRS-398, разд. 6.4.3; TG-51, разд. IX.C).'
      : `D(d_max) = D(${zTxt} см) / PDD(${zTxt}) · 100. PDD берут клиническую, из данных ввода в эксплуатацию и системы планирования.`;
  const field = parseNumber(data.setup_field);
  $('#field-view').textContent = Number.isFinite(field) ? `${fmt(field, field % 1 ? 1 : 0)} × ${fmt(field, field % 1 ? 1 : 0)} см` : '';
  $('#sdd-hint').textContent = `Если оставить пустым: ${fmt(result.inputs.sddCm, 0)} см (по геометрии из раздела 1).`;
  const src = result.trs?.fffEstimate?.source;
  $('#fff-pdd-src').textContent = src && src !== 'введено' ? `Взято: ${src}.` : '';
}

// ------------------------------------------------------------ вывод
function renderInline(result, data) {
  const ctx = result;
  for (const el of $$('[data-out]')) {
    let v = get(ctx, el.dataset.out);
    if (el.dataset.abs && Number.isFinite(v)) v = Math.abs(v);
    const d = Number(el.dataset.digits ?? 4);
    el.textContent = Number.isFinite(v) ? (el.dataset.signed ? fmtSigned(v, d) : fmt(v, d)) + (el.dataset.suffix || '') : '—';
  }
  for (const el of $$('[data-out-text]')) {
    const v = get(ctx, el.dataset.outText);
    el.textContent = v ? String(v) : '';
  }

  // подсветка полей по флагам расчёта
  for (const el of $$('.flag-error, .flag-warn')) el.classList.remove('flag-error', 'flag-warn');
  for (const [key, level] of Object.entries(result.flags)) {
    if (level === 'info') continue;
    const cls = level === 'error' ? 'flag-error' : 'flag-warn';
    $$(`[data-flag="${key}"]`).forEach((el) => el.classList.add(cls));
    const input = document.getElementById(key);
    if (input) input.classList.add(cls);
    const box = seriesBox(key);
    if (box) box.classList.add(cls);
  }

  const c = result.chamber;
  const info = $('#chamber-info');
  if (c && !c.custom) {
    const bits = [];
    if (c.rCavMm) bits.push(`радиус полости ${fmt(c.rCavMm, 2)} мм`);
    if (c.lengthMm) bits.push(`длина полости ${fmt(c.lengthMm, 1)} мм`);
    const srcs = [c.tg51 ? 'аддендум TG-51' : c.tg51Legacy ? 'TG-51 (1999)' : null, c.trs ? 'TRS-398 Rev.1 (формула и табл. 16)' : null].filter(Boolean);
    bits.push(`данные k_Q: ${srcs.join(', ')}`);
    info.textContent = bits.join(' · ');
  } else if (c?.custom) {
    info.textContent = 'Заполните характеристики камеры ниже и укажите, откуда брать k_Q.';
  } else {
    info.textContent = '';
  }
  $('#shift-hint').textContent = Number.isFinite(c?.rCavMm)
    ? `Качество пучка измеряют при каждой референсной дозиметрии. Кривую ионизации цилиндрической камеры сдвигают к поверхности на 0,6·r = ${fmt(0.6 * c.rCavMm, 1)} мм.`
    : 'Качество пучка измеряют при каждой референсной дозиметрии.';
  $('#length-hint').textContent = Number.isFinite(c?.lengthMm)
    ? `Если оставить пустым, возьмётся ${fmt(c.lengthMm, 1)} мм${c.custom ? ' из характеристик камеры' : ' из табл. 4 TRS-398'}.`
    : 'Длина полости по данным производителя.';
}

const PROTO = {
  trs: { name: 'TRS-398 Rev.1' },
  tg51: { name: 'TG-51 + аддендум 2014' },
};

function doseRow(key, x, result) {
  const depthOn = result.depth.on && Number.isFinite(x.DmaxPerMU);
  const main = depthOn ? x.DmaxPerMU : x.DperMU;
  const mainGy = depthOn ? x.DmaxPerMUGy : x.DperMUGy;
  const z = result.depth.zref;
  const zTxt = Number.isFinite(z) ? fmt(z, z % 1 ? 1 : 0) : '10';
  const where = depthOn ? 'на d<sub>max</sub>' : `на ${zTxt} см`;
  let chip = '';
  if (depthOn && Number.isFinite(x.deviation) && !x.blocked) {
    const cls = Math.abs(x.deviation) <= 1 ? 'good' : Math.abs(x.deviation) > 2 ? 'bad' : '';
    chip = `<span class="chip ${cls}" title="Отклонение от номинального выхода">${fmtSigned(x.deviation, 2)} %</span>`;
  }
  const mu = result.inputs.mu;
  const secondary = [
    `${fmt(mainGy, 6)} Гр/МЕ ${where}`,
    `D<sub>w</sub>(${zTxt} см) = ${fmt(x.D, 4)} Гр${Number.isFinite(mu) ? ` за ${fmt(mu, 0)} МЕ` : ''}`,
    depthOn ? `${fmt(x.DperMU, 4)} сГр/МЕ на ${zTxt} см` : null,
  ].filter(Boolean).join('<br>');
  return `<div class="dose-row ${x.blocked ? 'blocked' : ''}">
    <div class="proto"><span>${PROTO[key].name}</span>${chip}</div>
    <div class="dose-big">${x.blocked || !Number.isFinite(main) ? '—' : fmt(main, 4)}<small>сГр/МЕ ${where}</small></div>
    <div class="secondary">${x.blocked ? 'Исправьте ошибки из списка замечаний' : secondary}</div>
  </div>`;
}

function renderReadout(result, data) {
  const keys = data.protocol === 'both' ? ['trs', 'tg51'] : [data.protocol];
  $('#dose-rows').innerHTML = keys.map((k) => doseRow(k, k === 'trs' ? result.trs : result.tg51, result)).join('');

  const delta = $('#delta');
  if (result.comparison && !result.trs.blocked && !result.tg51.blocked) {
    delta.hidden = false;
    delta.innerHTML = `TG-51 относительно TRS-398: <b>${fmtSigned(result.comparison.dRel, 2)} %</b>`;
  } else {
    delta.hidden = true;
  }

  const first = keys.map((k) => ({ k, x: k === 'trs' ? result.trs : result.tg51 })).find((o) => !o.x.blocked && o.x.ok);
  const mv = $('#mobile-value');
  if (first) {
    const val = result.depth.on && Number.isFinite(first.x.DmaxPerMU) ? first.x.DmaxPerMU : first.x.DperMU;
    mv.innerHTML = `${first.k === 'trs' ? 'TRS' : 'TG-51'}: <b>${fmt(val, 4)}</b> сГр/МЕ${Number.isFinite(first.x.deviation) ? ` (${fmtSigned(first.x.deviation, 2)} %)` : ''}`;
  } else {
    const n = result.messages.filter((m) => m.level === 'error').length;
    mv.textContent = n ? `Ошибок: ${n}` : '—';
  }

  const lvlName = { error: 'Ошибка', warn: 'Внимание', info: 'Справка' };
  const scopeName = { common: '', depth: 'Пересчёт на d_max · ', trs: 'TRS-398 · ', tg51: 'TG-51 · ' };
  const list = result.messages.filter((m) => m.scope === 'common' || m.scope === 'depth' || keys.includes(m.scope));
  $('#messages').innerHTML = list.length
    ? list.map((m) => `<li class="${m.level}"><span class="lvl">${scopeName[m.scope]}${lvlName[m.level]}</span><span>${esc(m.text)}</span>${m.ref ? `<span class="ref">${esc(m.ref)}</span>` : ''}</li>`).join('')
    : '<li class="info"><span class="lvl">Всё в порядке</span><span>Замечаний к введённым данным нет.</span></li>';

  const t = result.trs;
  const g = result.tg51;
  const showT = keys.includes('trs');
  const showG = keys.includes('tg51');
  const z = result.depth.zref;
  const zTxt = Number.isFinite(z) ? fmt(z, z % 1 ? 1 : 0) : '10';
  const rows = [
    ['Температура и давление', ['k<sub>TP</sub>', t.kTP, 4], ['P<sub>TP</sub>', g.PTP, 4]],
    ['Электрометр', ['k<sub>elec</sub>', t.kelec, 4], ['P<sub>elec</sub>', g.Pelec, 4]],
    ['Полярность', ['k<sub>pol</sub>', t.kpol, 4], ['P<sub>pol</sub>', g.Ppol, 4]],
    ['Рекомбинация', ['k<sub>s</sub>', t.ks, 4], ['P<sub>ion</sub>', g.Pion, 4]],
    ['Утечка', ['k<sub>leak</sub>', t.kleak, 4], ['P<sub>leak</sub>', g.Pleak, 4]],
    ['Усреднение по объёму', ['k<sub>vol</sub>', t.kvol, 4], ['P<sub>rp</sub>', g.Prp, 4]],
    ['Исправленное показание, нКл', ['M<sub>Q</sub>', t.M, 4], ['M', g.M, 4]],
    ['Качество пучка', ['TPR<sub>20,10</sub>', t.tpr, 4], ['%dd(10)<sub>x</sub>', g.pdd10x, 2]],
    ['Поправка на качество', ['k<sub>Q</sub>', t.kQ, 4], ['k<sub>Q</sub>', g.kQ, 4]],
    ['N<sub>D,w</sub>, Гр/нКл', ['', result.inputs.ndw, 5], ['', result.inputs.ndw, 5]],
    [`D<sub>w</sub>(${zTxt} см), Гр`, ['', t.D, 4, true], ['', g.D, 4, true], 'total'],
    [`На ${zTxt} см, сГр/МЕ`, ['', t.DperMU, 4, true], ['', g.DperMU, 4, true]],
    [`На ${zTxt} см, Гр/МЕ`, ['', t.DperMUGy, 6, true], ['', g.DperMUGy, 6, true]],
  ];
  if (result.depth.on) {
    rows.push([result.depth.label, ['', result.depth.factor, 4], ['', result.depth.factor, 4]]);
    rows.push(['На d<sub>max</sub>, сГр/МЕ', ['', t.DmaxPerMU, 4, true], ['', g.DmaxPerMU, 4, true], 'total']);
    rows.push(['На d<sub>max</sub>, Гр/МЕ', ['', t.DmaxPerMUGy, 6, true], ['', g.DmaxPerMUGy, 6, true]]);
  }
  const cell = ([sym, v, d, dose], blocked) => `<td class="v">${sym ? `<i>${sym}</i> ` : ''}${dose && blocked ? '—' : fmt(v, d)}</td>`;
  $('#factors').innerHTML =
    `<thead><tr><th>Величина</th>${showT ? '<th>TRS-398</th>' : ''}${showG ? '<th>TG-51</th>' : ''}</tr></thead><tbody>` +
    rows.map((r) => `<tr class="${r[3] || ''}"><td>${r[0]}</td>${showT ? cell(r[1], t.blocked) : ''}${showG ? cell(r[2], g.blocked) : ''}</tr>`).join('') +
    '</tbody>';
}

// ------------------------------------------------------------ протокол текстом
function geometryText(data) {
  if (data.setup_geometry === 'SAD') return 'РИО = 100 см, поле 10×10 см в плоскости камеры, камера на глубине 10 см';
  if (data.setup_geometry === 'manual') return `РИП = ${data.setup_ssd} см, поле ${data.setup_field}×${data.setup_field} см, камера на глубине ${data.setup_depth} см`;
  return 'РИП = 100 см, поле 10×10 см на поверхности воды, камера на глубине 10 см';
}

function reportText(data, r) {
  const L = [];
  const c = r.chamber;
  const line = (k, v) => L.push(`${k}: ${v}`);
  const cells = (a) => (Array.isArray(a) ? a.filter((x) => String(x).trim() !== '').join('; ') : a);
  L.push('ПРОТОКОЛ РЕФЕРЕНСНОЙ ДОЗИМЕТРИИ — МВ ФОТОНЫ');
  line('Протокол', data.protocol === 'both' ? 'TRS-398 Rev.1 и TG-51 (+ аддендум 2014)' : PROTO[data.protocol].name);
  line('Учреждение', data.meta_institution || '—');
  line('Аппарат', data.meta_machine || '—');
  const beamE = parseBeamName(data.meta_beam).energy;
  const showE = data.meta_energy && !(Number.isFinite(beamE) && Math.abs(beamE - parseNumber(data.meta_energy)) < 1e-9);
  const showF = data.meta_fff && parseBeamName(data.meta_beam).fff !== true;
  line('Пучок', `${data.meta_beam || '—'}${showE ? `, ${data.meta_energy} МВ` : ''}${showF ? ', БВФ' : ''}`);
  line('Дата', data.meta_date || '—');
  line('Измерения выполнили', data.meta_staff.filter((s) => s.trim()).join(', ') || '—');
  line('Геометрия', geometryText(data));
  L.push('');
  if (c?.custom) {
    line('Камера', `своя: ${[data.cc_maker, data.cc_model].filter(Boolean).join(' ') || '—'}, № ${data.ch_serial || '—'}`);
    line('Характеристики', `V = ${data.cc_volume || '—'} см³, L = ${data.cc_length || '—'} мм, r = ${data.cc_radius || '—'} мм, стенка ${data.cc_wall || '—'} ${data.cc_wall_thickness ? `(${data.cc_wall_thickness} г/см²)` : ''}, электрод ${data.cc_electrode || '—'}, ${data.cc_waterproof ? 'водонепроницаемая' : 'не водонепроницаемая'}`);
    if (c.analog) line('Аналог для k_Q', chamberLabel(c.analog));
    if (c.hasAB) line('Параметры ур. (34)', `a = ${data.cc_a}, b = ${data.cc_b}`);
  } else {
    line('Камера', c ? `${chamberLabel(c)}, № ${data.ch_serial || '—'}` : '—');
  }
  line('N_D,w', `${data.ch_ndw} ${NDW_UNITS[data.ch_ndw_unit]?.label ?? ''} (= ${fmt(r.inputs.ndw, 6)} Гр/нКл); T0 = ${data.ch_T0} °C, P0 = ${data.ch_P0} кПа`);
  line('Электрометр', `${data.el_model || '—'}, № ${data.el_serial || '—'}, k_elec = ${data.el_kelec}`);
  line('Условия', `T = ${data.env_T} °C, P = ${data.env_P} ${PRESSURE_UNITS[data.env_P_unit]?.label ?? ''}`);
  line('Облучение', `${data.rd_mu} МЕ, V1 = ${data.rd_V1} В, V2 = ${data.rd_V2} В, обычная полярность ${data.rd_polarity}`);
  line('M(V1, обычная), нКл', `${cells(data.rd_M1)} → среднее ${fmt(Math.abs(r.inputs.M1.mean), 4)}`);
  line('M(V1, обратная), нКл', `${cells(data.rd_Mopp)} → среднее ${fmt(Math.abs(r.inputs.Mopp.mean), 4)}`);
  line('M(V2), нКл', `${cells(data.rd_M2)} → среднее ${fmt(Math.abs(r.inputs.M2.mean), 4)}`);
  L.push('');
  const blocks = data.protocol === 'both' ? ['trs', 'tg51'] : [data.protocol];
  for (const k of blocks) {
    const x = k === 'trs' ? r.trs : r.tg51;
    L.push(`— ${PROTO[k].name} —`);
    if (k === 'trs') {
      L.push(`k_TP = ${fmt(x.kTP)}; k_elec = ${fmt(x.kelec)}; k_pol = ${fmt(x.kpol)}; k_s = ${fmt(x.ks)}; k_leak = ${fmt(x.kleak)}; k_vol = ${fmt(x.kvol)}`);
      L.push(`TPR20,10 = ${fmt(x.tpr)} (${x.tprEquation || '—'})`);
      if (x.fffEstimate) L.push(`Оценка TPR20,10 по PDD(10) = ${fmt(x.fffEstimate.pdd10, 1)} %: ${fmt(x.fffEstimate.value)} (не для калибровки)`);
      L.push(`k_Q: по формуле (34) ${fmt(x.kQFormula)}, по табл. 16 ${fmt(x.kQTable)}; в расчёте ${fmt(x.kQ)} (${x.kQSource || '—'})`);
    } else {
      L.push(`P_TP = ${fmt(x.PTP)}; P_elec = ${fmt(x.Pelec)}; P_pol = ${fmt(x.Ppol)}; P_ion = ${fmt(x.Pion)}; P_leak = ${fmt(x.Pleak)}; P_rp = ${fmt(x.Prp)}`);
      L.push(`%dd(10)x = ${fmt(x.pdd10x, 2)} (${x.pdd10xEquation || '—'}); k_Q = ${fmt(x.kQ)} (${x.kQSource || '—'})`);
    }
    if (x.blocked) {
      L.push('РЕЗУЛЬТАТ НЕ ВЫЧИСЛЕН: есть ошибки ввода (см. замечания).');
    } else {
      L.push(`M = ${fmt(x.M)} нКл; D_w(${fmt(r.depth.zref, 0)} см) = ${fmt(x.D)} Гр; ${fmt(x.DperMU)} сГр/МЕ = ${fmt(x.DperMUGy, 6)} Гр/МЕ`);
      if (r.depth.on && r.depth.ok) {
        L.push(`d_max = ${data.dd_zmax} см; ${r.depth.label} = ${fmt(r.depth.factor)}; D на d_max = ${fmt(x.DmaxPerMU)} сГр/МЕ = ${fmt(x.DmaxPerMUGy, 6)} Гр/МЕ${Number.isFinite(x.deviation) ? `; отклонение от номинала ${fmtSigned(x.deviation, 2)} %` : ''}`);
      } else if (r.depth.on) {
        L.push('Пересчёт на d_max не выполнен: исправьте данные раздела 7.');
      }
    }
    L.push('');
  }
  if (r.comparison) L.push(`TG-51 относительно TRS-398: ${fmtSigned(r.comparison.dRel, 2)} %`, '');
  const msgs = r.messages.filter((m) => m.level !== 'info');
  if (msgs.length) {
    L.push('Замечания:');
    msgs.forEach((m) => L.push(`- ${m.text}${m.ref ? ` [${m.ref}]` : ''}`));
    L.push('');
  }
  if (data.meta_notes) L.push(`Примечания: ${data.meta_notes}`);
  return L.join('\n');
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
    const raw = localStorage.getItem(DRAFT_KEY) || localStorage.getItem('reference-dosimetry.photons.v1');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setStatus(text) {
  const s = $('#status');
  s.textContent = text;
  clearTimeout(setStatus.t);
  setStatus.t = setTimeout(() => (s.textContent = ''), 6000);
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(okMsg);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    setStatus(ok ? okMsg : 'Браузер не дал скопировать: выделите текст вручную.');
  }
}

function importData(obj) {
  if (!obj || obj.app !== FILE_TAG.app || obj.module !== FILE_TAG.module || typeof obj.form !== 'object') {
    throw new Error('Это не файл калькулятора МВ фотонов.');
  }
  writeForm(obj.form);
  update();
}

// ------------------------------------------------------------ справки
function openTerm(key) {
  const t = TERMS[key];
  if (!t) return;
  $('#term-title').innerHTML = t.title;
  $('#term-body').innerHTML = t.html;
  const dlg = $('#term-dialog');
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  $('#term-body').scrollTop = 0;
}

// ------------------------------------------------------------ цикл
let current = { data: null, result: null };
function update() {
  if ($('input[name="protocol"]:checked')?.value === 'tg51' && $('#meta_fff').checked && $('#prof_mode').value !== 'manual') {
    $('#prof_mode').value = 'manual';
  }
  const data = readForm();
  const result = computePhotons(data);
  current = { data: result.form, result };
  applyVisibility(result.form, result);
  renderInline(result, result.form);
  renderReadout(result, result.form);
  $('#demo-flag').hidden = !(data.meta_institution === SAMPLE_FORM.meta_institution && data.meta_machine === SAMPLE_FORM.meta_machine);
  saveDraft(result.form);
}

let lastBeamFff = null;
function onBeamInput() {
  const name = $('#meta_beam').value;
  if (!name.trim()) return;
  const { energy, fff } = parseBeamName(name);
  if (Number.isFinite(energy)) $('#meta_energy').value = String(energy).replace('.', ',');
  // галочку БВФ меняем, только если название явно говорит БВФ/СВФ или раньше говорило БВФ, а теперь нет
  if (fff !== null) $('#meta_fff').checked = fff;
  else if (lastBeamFff === true) $('#meta_fff').checked = false;
  lastBeamFff = fff;
}

function init() {
  fillSelects();
  $$('.cells').forEach((box) => setupCells(box, update));
  $$('#sheet > section .combo').forEach((c) => makeCombo(c));

  const draft = loadDraft();
  writeForm(draft ? draft : SAMPLE_FORM);
  lastBeamFff = parseBeamName($('#meta_beam').value).fff;
  update();
  if (!draft) setStatus('Загружен демонстрационный пример. Нажмите «Очистить», чтобы ввести свои данные.');

  document.addEventListener('input', (e) => {
    if (e.target.id === 'meta_beam') onBeamInput();
    if (e.target.closest('#sheet, .protocol-switch')) update();
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'ch_model') {
      const id = e.target.value;
      if (id.startsWith('MY:')) fillCustomFields(getMyChambers().find((c) => c.id === id));
      else if (id === 'CUSTOM') fillCustomFields(null);
    }
    if (e.target.closest('#sheet, .protocol-switch')) update();
  });

  $('#btn-add-staff').addEventListener('click', () => {
    const cur = readStaff($('#staff-list'));
    cur.push('');
    renderStaff($('#staff-list'), cur, update);
    $$('#staff-list .staff-input').at(-1).focus();
    update();
  });

  for (const b of $$('[data-preset-ref]')) {
    b.addEventListener('click', () => {
      const [t0, p0] = b.dataset.presetRef.split('|');
      $('#ch_T0').value = t0;
      $('#ch_P0').value = p0;
      update();
    });
  }

  // свои камеры
  $('#btn-save-chamber').addEventListener('click', () => {
    const data = readForm();
    if (!data.cc_model.trim()) {
      setStatus('Укажите модель камеры, чтобы сохранить её.');
      $('#cc_model').focus();
      return;
    }
    const id = String(data.ch_model).startsWith('MY:') ? data.ch_model : `MY:${Date.now().toString(36)}`;
    const entry = { id };
    for (const k of CC_KEYS) entry[k] = data[k];
    if (!saveMyChamber(entry)) {
      setStatus('Браузер не дал сохранить камеру: хранилище недоступно.');
      return;
    }
    fillChamberSelect();
    $('#ch_model').value = id;
    update();
    setStatus(`Камера «${[data.cc_maker, data.cc_model].filter(Boolean).join(' ')}» сохранена в «Мои камеры».`);
  });
  const delBtn = $('#btn-del-chamber');
  delBtn.addEventListener('click', () => {
    if (!delBtn.dataset.armed) {
      delBtn.dataset.armed = '1';
      delBtn.classList.add('danger-armed');
      delBtn.textContent = 'Точно удалить?';
      setTimeout(() => {
        delete delBtn.dataset.armed;
        delBtn.classList.remove('danger-armed');
        delBtn.textContent = 'Удалить из «Моих камер»';
      }, 4000);
      return;
    }
    delete delBtn.dataset.armed;
    delBtn.classList.remove('danger-armed');
    delBtn.textContent = 'Удалить из «Моих камер»';
    deleteMyChamber($('#ch_model').value);
    fillChamberSelect();
    $('#ch_model').value = 'CUSTOM';
    update();
    setStatus('Камера удалена из списка; её данные остались в форме.');
  });

  // справки по коэффициентам
  document.addEventListener('click', (e) => {
    const term = e.target.closest('.term');
    if (term) {
      e.preventDefault();
      openTerm(term.dataset.term);
    }
  });
  const dlg = $('#term-dialog');
  $('#term-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });

  $('#btn-sample').addEventListener('click', () => {
    writeForm(SAMPLE_FORM);
    update();
    setStatus('Загружен демонстрационный пример (вымышленные данные).');
  });

  const clearBtn = $('#btn-clear');
  clearBtn.addEventListener('click', () => {
    if (clearBtn.dataset.armed) {
      delete clearBtn.dataset.armed;
      clearBtn.classList.remove('danger-armed');
      clearBtn.textContent = 'Очистить';
      writeForm({ ...FORM_DEFAULTS, protocol: current.data?.protocol ?? 'trs', meta_date: today() });
      update();
      setStatus('Форма очищена.');
      return;
    }
    clearBtn.dataset.armed = '1';
    clearBtn.classList.add('danger-armed');
    clearBtn.textContent = 'Точно очистить?';
    setTimeout(() => {
      if (clearBtn.dataset.armed) {
        delete clearBtn.dataset.armed;
        clearBtn.classList.remove('danger-armed');
        clearBtn.textContent = 'Очистить';
      }
    }, 4000);
  });

  const payload = () => JSON.stringify({ ...FILE_TAG, savedAt: new Date().toISOString(), form: current.data }, null, 2);

  $('#btn-save').addEventListener('click', () => {
    const blob = new Blob([payload()], { type: 'application/json' });
    const a = document.createElement('a');
    const name = [current.data.meta_machine, current.data.meta_beam, current.data.meta_date].filter(Boolean).join('_').replace(/[^\p{L}\p{N}_.-]+/gu, '-') || 'photons';
    a.href = URL.createObjectURL(blob);
    a.download = `dosimetry_${name}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
    setStatus('Файл сохранён.');
  });

  $('#btn-load').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      importData(JSON.parse(await file.text()));
      setStatus(`Открыт файл ${file.name}.`);
    } catch (err) {
      setStatus(err instanceof SyntaxError ? 'Файл повреждён: это не JSON.' : err.message);
    }
    e.target.value = '';
  });

  document.addEventListener('paste', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    const text = e.clipboardData?.getData('text');
    if (!text || !text.includes('"reference-dosimetry"')) return;
    try {
      importData(JSON.parse(text));
      setStatus('Данные вставлены из буфера обмена.');
    } catch (err) {
      setStatus(err.message);
    }
  });

  $('#btn-copy-json').addEventListener('click', () => copyText(payload(), 'Данные скопированы. Чтобы вставить их обратно, нажмите Ctrl+V на странице вне полей ввода.'));
  $('#btn-copy-report').addEventListener('click', () => copyText(reportText(current.data, current.result), 'Протокол скопирован в буфер обмена.'));
  $('#btn-print').addEventListener('click', () => window.print());
}

init();
