// Модуль «⁶⁰Co»: связывает форму с расчётным ядром cobalt.js.
import { computeCobalt, CO_DEFAULTS, normalizeCobalt, ACTIVITY_UNITS } from '../core/cobalt.js';
import { SAMPLE_COBALT, SAMPLE_COBALT_EN } from '../core/sample-cobalt.js';
import { L, getLang, refText } from '../core/i18n.js';
import { localizeDecimals } from './i18n.js';
import { coChamberGroups } from '../core/co60-chambers.js';
import { PRESSURE_UNITS, NDW_UNITS, unitLabel } from '../core/units.js';
import { getMyChambers, saveMyChamber, deleteMyChamber } from './store.js';
import { makeCombo, renderCells, readCells, setupCells, renderStaff, readStaff, renderPairs, readPairs, setupPairs } from './widgets.js';
import {
  $, $$, localizeDemo, doseGroupTitle, rawReadingLabel, correctedReadingLabel, fmt, fmtSigned, esc, today, makeStatus, copyText, downloadText,
  currentProtocol, renderOutputs, renderFlags, applyShowRules, armButton, renderSignBlock, printToPdf,
} from './common.js';

const DRAFT_KEY = 'reference-dosimetry.cobalt.v1';
const FILE_TAG = { app: 'reference-dosimetry', module: 'cobalt', version: 1 };
const SERIES_KEYS = ['co_M1', 'co_Mopp', 'co_M2', 'co_nx_M1', 'co_nx_Mn', 'co_Mc'];
const CC_KEYS = ['co_cc_maker', 'co_cc_model', 'co_cc_type'];
const PAIR_KEYS = ['co_tt', 'co_tm'];
const ROOT = () => document.getElementById('module-co60');
let setStatus = () => {};
export const cobaltStatus = (text) => setStatus(text);

const PROTO = {
  trs: { name: 'TRS-398 Rev.1' },
  tg51: { name: 'TG-51' },
};

// ------------------------------------------------------------ список камер
function fillChamberSelect() {
  const sel = $('#co_ch_model');
  const keep = sel.value;
  const parts = [`<option value="">${L('— выберите камеру —', '— select a chamber —')}</option>`];
  for (const g of coChamberGroups()) {
    parts.push(`<optgroup label="${esc(g.label)}">`);
    for (const c of g.items) parts.push(`<option value="${esc(c.id)}">${esc(c.label)}</option>`);
    parts.push('</optgroup>');
  }
  const mine = getMyChambers();
  if (mine.length) {
    parts.push(`<optgroup label="${L('Мои камеры', 'My chambers')}">`);
    for (const c of mine) {
      const name = [c.cc_maker, c.cc_model].filter(Boolean).join(' ') || L('без названия', 'unnamed');
      parts.push(`<option value="${esc(c.id)}">${esc(name)}${c.cc_type === 'pp' ? L(' (плоскопараллельная)', ' (plane-parallel)') : ''}</option>`);
    }
    parts.push('</optgroup>');
  }
  parts.push(`<option value="CUSTOM">${L('Ввести свою камеру…', 'Enter a custom chamber…')}</option>`);
  sel.innerHTML = parts.join('');
  if (keep && sel.querySelector(`option[value="${CSS.escape(keep)}"]`)) sel.value = keep;
}

function fillUnitSelects() {
  $('#co_ndw_unit').innerHTML = Object.entries(NDW_UNITS).map(([k, u]) => `<option value="${k}">${unitLabel(u)}</option>`).join('');
  $('#co_env_P_unit').innerHTML = Object.entries(PRESSURE_UNITS).map(([k, u]) => `<option value="${k}">${unitLabel(u)}</option>`).join('');
}

function fillCustomFields(saved) {
  $('#co_cc_maker').value = saved?.cc_maker ?? '';
  $('#co_cc_model').value = saved?.cc_model ?? '';
  $('#co_cc_type').value = saved?.cc_type === 'pp' ? 'pp' : 'cyl';
}

/** Демонстрационный набор на текущем языке (текстовые поля), числа одинаковые. */
const sampleData = () => (getLang() === 'en' ? { ...SAMPLE_COBALT, ...SAMPLE_COBALT_EN } : SAMPLE_COBALT);
const isDemo = (d) => [SAMPLE_COBALT.co_institution, SAMPLE_COBALT_EN.co_institution].includes(d.co_institution) && [SAMPLE_COBALT.co_machine, SAMPLE_COBALT_EN.co_machine].includes(d.co_machine);

// ------------------------------------------------------------ форма ↔ данные
const seriesBox = (key) => (key === 'co_timer' ? null : $(`#co-sheet .cells[data-series="${key}"]`));
const pairsBox = () => $('#co_timer');

function readForm() {
  const data = {};
  for (const key of Object.keys(CO_DEFAULTS)) {
    if (key === 'protocol') data.protocol = currentProtocol();
    else if (key === 'co_staff') data.co_staff = readStaff($('#co-staff-list'));
    else if (SERIES_KEYS.includes(key)) data[key] = readCells(seriesBox(key));
    else if (PAIR_KEYS.includes(key)) continue;
    else {
      const el = document.getElementById(key);
      if (!el) continue;
      data[key] = el.type === 'checkbox' ? el.checked : el.value;
    }
  }
  const { a, b } = readPairs(pairsBox());
  data.co_tt = a;
  data.co_tm = b;
  return data;
}

function writeForm(values) {
  const data = normalizeCobalt(values);
  if (String(data.co_ch_model).startsWith('MY:') && !getMyChambers().some((c) => c.id === data.co_ch_model)) data.co_ch_model = 'CUSTOM';
  for (const [key, value] of Object.entries(data)) {
    if (key === 'protocol' || PAIR_KEYS.includes(key)) continue;
    if (key === 'co_staff') renderStaff($('#co-staff-list'), value, update);
    else if (SERIES_KEYS.includes(key)) renderCells(seriesBox(key), value);
    else {
      const el = document.getElementById(key);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!value;
      else el.value = value ?? '';
    }
  }
  renderPairs(pairsBox(), data.co_tt, data.co_tm);
  localizeDecimals(ROOT());
}

// ------------------------------------------------------------ видимость и подписи
const zText = (z) => (Number.isFinite(z) ? fmt(z, z % 1 ? 1 : 0) : '—');

function applyVisibility(data, result) {
  applyShowRules(ROOT(), data, data.protocol);
  const sad = data.co_geometry === 'SAD';
  const z = zText(result.inputs.zref);
  const unit = result.inputs.unitLabel;
  $('#co-lbl-distance').textContent = sad ? L('РИК, см', 'SCD, cm') : L('РИП, см', 'SSD, cm');
  const c = result.chamber;
  const custom = String(data.co_ch_model) === 'CUSTOM' || String(data.co_ch_model).startsWith('MY:');
  $('#co-custom-chamber').hidden = !custom;
  $('#co-btn-del-chamber').hidden = !String(data.co_ch_model).startsWith('MY:');
  $('#co-refpoint').textContent = !c
    ? ''
    : c.type === 'pp'
      ? L('Опорная точка — внутренняя поверхность входного окна, в центре окна (TRS-398, табл. 12).', 'Reference point: the inner surface of the entrance window, at its center (TRS-398, Table 12).')
      : L('Опорная точка — на оси камеры в центре объёма полости (TRS-398, табл. 12).', 'Reference point: on the chamber axis at the center of the cavity volume (TRS-398, Table 12).');
  const info = [];
  if (c && !c.custom) {
    info.push(c.type === 'pp' ? L('плоскопараллельная', 'plane-parallel') : L('цилиндрическая', 'cylindrical'));
    if (Number.isFinite(c.rCavMm)) info.push(L(`радиус полости ${fmt(c.rCavMm, 2)} мм`, `cavity radius ${fmt(c.rCavMm, 2)} mm`));
    if (Number.isFinite(c.lengthMm)) info.push(L(`длина полости ${fmt(c.lengthMm, 1)} мм`, `cavity length ${fmt(c.lengthMm, 1)} mm`));
    if (Number.isFinite(c.windowMgCm2)) info.push(L(`входное окно ${fmt(c.windowMgCm2, c.windowMgCm2 < 10 ? 2 : 0)} мг/см²`, `entrance window ${fmt(c.windowMgCm2, c.windowMgCm2 < 10 ? 2 : 0)} mg/cm²`));
    else if (Number.isFinite(c.windowMm)) info.push(L(`входное окно ${fmt(c.windowMm, 1)} мм`, `entrance window ${fmt(c.windowMm, 1)} mm`));
    if (c.type === 'cyl') info.push(c.sleeve ? L('не водонепроницаемая — нужен чехол', 'not waterproof — a waterproof sleeve is required') : L('водонепроницаемая', 'waterproof'));
  }
  $('#co-chamber-info').textContent = info.join(' · ');

  const pddVisible = !sad || data.co_dd_sad === 'pdd';
  $('#co-pdd-field').hidden = !data.co_dd_on || !pddVisible;
  const pddSsd = result.depth.pddSsd;
  $('#co-lbl-pdd').textContent = sad && Number.isFinite(pddSsd) ? L(`PDD(${z}) при РИП ${fmt(pddSsd, 0)} см, %`, `PDD(${z}) at SSD ${fmt(pddSsd, 0)} cm, %`) : `PDD(${z}), %`;
  $('#co-pdd-sub').textContent = sad ? L(`измеренная при РИП ${Number.isFinite(pddSsd) ? fmt(pddSsd, 0) : 'РИК − z_ref'} см`, `measured at SSD ${Number.isFinite(pddSsd) ? fmt(pddSsd, 0) : 'SCD − z_ref'} cm`) : '';
  $('#co-lbl-tmr .term').textContent = `TMR(${z})`;
  const windowMode = data.co_timer_mode === 'window';
  $('#co-lbl-time').textContent = windowMode ? L('Время накопления заряда', 'Charge collection time') : L('Заданное время облучения', 'Set irradiation time');
  $('#co-time-sub').textContent = windowMode ? L('интервал, на котором электрометр накапливал заряд', 'the interval over which the electrometer collected charge') : L('время для всех серий показаний в разделе 5', 'the time for all reading series in section 5');
  $('#co-lbl-tau').textContent = `τ, ${unit}`;
  $('#co-lbl-tt').textContent = L(`Заданное время, ${unit}`, `Set time, ${unit}`);
  $('#co-lbl-nxt').textContent = L(`Время одиночного облучения t, ${unit}`, `Single exposure time t, ${unit}`);
  $('#co-lbl-ctrl-time').textContent = `${windowMode ? L('Время накопления заряда', 'Charge collection time') : L('Время облучения', 'Irradiation time')}, ${unit}`;
  $('#co-dd-hint').textContent = !sad
    ? L(
        `D(z_max) = D(${z} см) / PDD(${z}) · 100. Для ⁶⁰Co z_max ≈ 0,5 см. PDD — клиническая, для того же РИП и поля 10 × 10 см (TRS-398, разд. 5.4.3).`,
        `D(z_max) = D(${z} cm) / PDD(${z}) · 100. For ⁶⁰Co, z_max ≈ 0.5 cm. Use the clinical PDD for the same SSD and a 10 × 10 cm field (TRS-398, Sec. 5.4.3).`,
      )
    : data.co_dd_sad === 'pdd'
      ? L(
          `Установка по РИК через PDD: D(z_max) = D(${z} см) / PDD(${z}) · 100 при РИП ${Number.isFinite(pddSsd) ? fmt(pddSsd, 0) : '—'} см. Это мощность дозы на z_max при той же установке, а не в изоцентре; PDD нужна для этого РИП.`,
          `SCD setup via PDD: D(z_max) = D(${z} cm) / PDD(${z}) · 100 at SSD ${Number.isFinite(pddSsd) ? fmt(pddSsd, 0) : '—'} cm. This is the dose rate at z_max for the same setup, not at the isocenter; the PDD must be for this SSD.`,
        )
      : L(
          `Установка по РИК: мощность дозы переносится на z_max в изоцентре через TMR(${z}) из данных ввода в эксплуатацию (TRS-398, разд. 5.4.3).`,
          `SCD setup: the dose rate is transferred to z_max at the isocenter via TMR(${z}) from the commissioning data (TRS-398, Sec. 5.4.3).`,
        );
  $('#co_ref_at').disabled = !data.co_dd_on;
  $('#co-ref-at-sub').textContent = !data.co_dd_on
    ? L('Без пересчёта на z_max значение для сравнения относится к опорной глубине.', 'Without transfer to z_max the comparison value refers to the reference depth.')
    : L('Итог показывается на этой глубине; отклонение считается от значения на ней.', 'The result is shown at this depth, and the deviation is calculated from the value there.');
  const d = result.depth;
  $('#co-decay-note').textContent = Number.isFinite(d.decay)
    ? L(
        `${d.refDateFromSource ? 'от даты установки источника, ' : ''}распад за ${fmt(d.days, 0)} сут: × ${fmt(d.decay, 4)}`,
        `${d.refDateFromSource ? 'from the source installation date, ' : ''}decay over ${fmt(d.days, 0)} days: × ${fmt(d.decay, 4)}`,
      )
    : Number.isFinite(d.refRate)
      ? L('без поправки на распад', 'no decay correction')
      : '';
  const src = result.source;
  if (Number.isFinite(src.A)) {
    $('#co-act-now').textContent = L(`${fmt(src.ACi, 0)} Ки = ${fmt(src.ATBq, 1)} ТБк`, `${fmt(src.ACi, 0)} Ci = ${fmt(src.ATBq, 1)} TBq`);
    $('#co-act-sub').textContent = L(
      `прошло ${fmt(src.years, 2)} года (${fmt(src.days, 0)} сут), множитель распада ${fmt(src.decay, 4)}`,
      `${fmt(src.years, 2)} years elapsed (${fmt(src.days, 0)} days), decay factor ${fmt(src.decay, 4)}`,
    );
  } else {
    $('#co-act-now').textContent = '—';
    $('#co-act-sub').textContent = src.on ? L('нужны активность, дата установки и дата измерения', 'the activity, installation date and measurement date are required') : '';
  }
}

// ------------------------------------------------------------ вывод
/** Итог: по контрольным измерениям, если они введены и без ошибок, иначе по основным показаниям. */
const primaryOf = (x) => (x.ctrl && !x.ctrl.blocked && !x.blocked ? x.ctrl : x);
/** Итог показывается на глубине, где задано значение для сравнения: на z_max или на опорной глубине. */
const atMaxOf = (x, depth) => depth.expectedAt === 'zmax' && Number.isFinite(x.rateMax);
const rateAt = (x, depth) => (atMaxOf(x, depth) ? x.rateMax : x.rate);

function doseRow(key, x, result) {
  const p = primaryOf(x);
  const fromCtrl = p !== x;
  const atMax = atMaxOf(p, result.depth);
  const hasMax = Number.isFinite(p.rateMax);
  const main = atMax ? p.rateMax : p.rate;
  const mainGy = atMax ? p.rateMaxGy : p.rateGy;
  const z = zText(result.inputs.zref);
  const where = atMax ? L('на z<sub>max</sub>', 'at z<sub>max</sub>') : L(`на ${z} г/см²`, `at ${z} g/cm²`);
  let chip = '';
  if (Number.isFinite(p.deviation) && !x.blocked) {
    const cls = Math.abs(p.deviation) <= 1 ? 'good' : Math.abs(p.deviation) > 2 ? 'bad' : '';
    chip = `<span class="chip ${cls}" title="${L('Отклонение от ожидаемой мощности дозы', 'Deviation from the expected dose rate')}">${fmtSigned(p.deviation, 2)} %</span>`;
  }
  const i = result.inputs;
  const c = result.ctrl;
  const t = fromCtrl ? c.t : i.tSet;
  const tEff = fromCtrl ? c.tEff : i.tEff;
  const tTxt = `${fmt(t, t % 1 ? 2 : 0)} ${i.unitLabel}${result.timer.mode === 'window' ? '' : ` (t + τ = ${fmt(tEff, 3)})`}`;
  const secondary = [
    L(`= ${fmt(mainGy, 4)} Гр/мин ${where}`, `= ${fmt(mainGy, 4)} Gy/min ${where}`),
    L(`D<sub>w</sub>(${z} г/см²) = ${fmt(p.DcGy, 2)} сГр = ${fmt(p.D, 4)} Гр за ${tTxt}`, `D<sub>w</sub>(${z} g/cm²) = ${fmt(p.DcGy, 2)} cGy = ${fmt(p.D, 4)} Gy in ${tTxt}`),
    hasMax
      ? atMax
        ? L(`На ${z} г/см²: ${fmt(p.rate, 2)} сГр/мин`, `At ${z} g/cm²: ${fmt(p.rate, 2)} cGy/min`)
        : L(`На z<sub>max</sub>: ${fmt(p.rateMax, 2)} сГр/мин`, `At z<sub>max</sub>: ${fmt(p.rateMax, 2)} cGy/min`)
      : null,
    fromCtrl
      ? null
      : c.on
        ? L('Контрольные измерения содержат ошибки — мощность дозы по показанию M₁ раздела 5', 'The check measurements contain errors — dose rate from reading M₁ of section 5')
        : L('Контрольные измерения не введены — мощность дозы по показанию M₁ раздела 5', 'No check measurements entered — dose rate from reading M₁ of section 5'),
  ].filter(Boolean).join('<br>');
  return `<div class="dose-row ${x.blocked ? 'blocked' : ''}">
    <div class="proto"><span>${PROTO[key].name}${fromCtrl ? L(' · контрольные измерения', ' · check measurements') : ''}</span>${chip}</div>
    <div class="dose-big">${x.blocked || !Number.isFinite(main) ? '—' : fmt(main, 2)}<small>${L('сГр/мин', 'cGy/min')} ${where}</small></div>
    <div class="secondary">${x.blocked ? L('Исправьте ошибки из списка замечаний', 'Correct the errors listed under Messages') : secondary}</div>
  </div>`;
}

/** Строки таблицы с дозой за облучение (сГр и Гр) и мощностью дозы на опорной глубине и на z_max. */
function doseTableRows(t, g, result, z, tEff, own = [false, false], bold = true) {
  const atMax = result.depth.expectedAt === 'zmax' && result.depth.on;
  const rows = [
    [L(`D<sub>w</sub>(${z}) за облучение, сГр`, `D<sub>w</sub>(${z}) per exposure, cGy`), ['', t.DcGy, 2, true, own[0]], ['', g.DcGy, 2, true, own[1]]],
    [L(`D<sub>w</sub>(${z}) за облучение, Гр`, `D<sub>w</sub>(${z}) per exposure, Gy`), ['', t.D, 4, true, own[0]], ['', g.D, 4, true, own[1]]],
    [`t + τ, ${result.inputs.unitLabel}`, ['', tEff, 4], ['', tEff, 4]],
    [L(`На ${z} г/см², сГр/мин`, `At ${z} g/cm², cGy/min`), ['', t.rate, 2, true, own[0]], ['', g.rate, 2, true, own[1]], bold && !atMax ? 'total' : ''],
    [L(`На ${z} г/см², Гр/мин`, `At ${z} g/cm², Gy/min`), ['', t.rateGy, 4, true, own[0]], ['', g.rateGy, 4, true, own[1]]],
  ];
  if (result.depth.on) {
    rows.push(
      [L('На z<sub>max</sub>, сГр/мин', 'At z<sub>max</sub>, cGy/min'), ['', t.rateMax, 2, true, own[0]], ['', g.rateMax, 2, true, own[1]], bold && atMax ? 'total' : ''],
      [L('На z<sub>max</sub>, Гр/мин', 'At z<sub>max</sub>, Gy/min'), ['', t.rateMaxGy, 4, true, own[0]], ['', g.rateMaxGy, 4, true, own[1]]],
    );
  }
  return rows;
}

function renderReadout(result, data) {
  const keys = [data.protocol];
  const pick = (k) => (k === 'trs' ? result.trs : result.tg51);
  $('#co-dose-rows').innerHTML = keys.map((k) => doseRow(k, pick(k), result)).join('');


  const first = keys.map((k) => ({ k, x: pick(k) })).find((o) => !o.x.blocked && o.x.ok);
  const mv = $('#co-mobile-value');
  if (first) {
    const p = primaryOf(first.x);
    mv.innerHTML = `${first.k === 'trs' ? 'TRS' : 'TG-51'}: <b>${fmt(rateAt(p, result.depth), 2)}</b> ${L('сГр/мин', 'cGy/min')}${Number.isFinite(p.deviation) ? ` (${fmtSigned(p.deviation, 2)} %)` : ''}`;
  } else {
    const n = result.messages.filter((m) => m.level === 'error').length;
    mv.textContent = n ? L(`Ошибок: ${n}`, `Errors: ${n}`) : '—';
  }

  const lvlName = { error: L('Ошибка', 'Error'), warn: L('Внимание', 'Warning'), info: L('Справка', 'Note') };
  const scopeName = { common: '', depth: L('Пересчёт на z_max · ', 'Transfer to z_max · '), ctrl: L('Контрольные измерения · ', 'Check measurements · '), source: L('Источник · ', 'Source · '), trs: 'TRS-398 · ', tg51: 'TG-51 · ' };
  const list = result.messages.filter((m) => ['common', 'depth', 'ctrl', 'source'].includes(m.scope) || keys.includes(m.scope));
  $('#co-messages').innerHTML = list.length
    ? list.map((m) => `<li class="${m.level}"><span class="lvl">${scopeName[m.scope]}${lvlName[m.level]}</span><span>${esc(m.text)}</span>${m.ref ? `<span class="ref">${esc(refText(m.ref))}</span>` : ''}</li>`).join('')
    : `<li class="info"><span class="lvl">${L('Всё в порядке', 'All clear')}</span><span>${L('Замечаний к введённым данным нет.', 'No issues with the entered data.')}</span></li>`;

  const t = result.trs;
  const g = result.tg51;
  const showT = keys.includes('trs');
  const showG = keys.includes('tg51');
  const i = result.inputs;
  const z = zText(i.zref);
  const rows = [
    [L('Температура и давление', 'Temperature and pressure'), ['k<sub>TP</sub>', t.kTP, 4], ['P<sub>TP</sub>', g.PTP, 4]],
    [L('Электрометр', 'Electrometer'), ['k<sub>elec</sub>', t.kelec, 4], ['P<sub>elec</sub>', g.Pelec, 4]],
    [L('Полярность', 'Polarity'), ['k<sub>pol</sub>', t.kpol, 4], ['P<sub>pol</sub>', g.Ppol, 4]],
    [L('Рекомбинация', 'Recombination'), ['k<sub>s</sub>', t.ks, 4], ['P<sub>ion</sub>', g.Pion, 4]],
    [L('Утечка', 'Leakage'), ['k<sub>leak</sub>', t.kleak, 4], ['P<sub>leak</sub>', g.Pleak, 4]],
    [L('N<sub>D,w</sub>, Гр/нКл', 'N<sub>D,w</sub>, Gy/nC'), ['', i.ndw, 5], ['', i.ndw, 5]],
    [L('Поправка на качество', 'Beam quality correction'), ['k<sub>Q</sub>', t.enabled ? 1 : NaN, 3], ['k<sub>Q</sub>', g.enabled ? 1 : NaN, 3]],
  ];
  if (result.depth.on) rows.push([result.depth.label || 'PDD/TMR', ['', result.depth.factor, 4], ['', result.depth.factor, 4]]);
  const tc = t.ctrl || {};
  const gc = g.ctrl || {};
  const bT = t.blocked || !!tc.blocked;
  const bG = g.blocked || !!gc.blocked;
  const ctrlFinal = result.ctrl.on && ((showT && t.ctrl && !bT) || (showG && g.ctrl && !bG));
  const tText = (v) => `${Number.isFinite(v) ? fmt(v, v % 1 ? 2 : 0) : '—'} ${i.unitLabel}`;
  const m1 = Math.abs(i.M1.mean);
  const title = doseGroupTitle({ ctrlOn: result.ctrl.on, ctrlFinal, mainSec: 5, ctrlSec: 6, mainAmount: tText(i.tSet), ctrlAmount: tText(result.ctrl.t) });
  rows.push([title, [], [], 'group']);
  if (ctrlFinal) {
    rows.push([rawReadingLabel(), ['', result.ctrl.mean, 4], ['', result.ctrl.mean, 4]]);
    rows.push([correctedReadingLabel(), ['M', tc.M, 4, true, bT], ['M', gc.M, 4, true, bG]]);
    rows.push(...doseTableRows(tc, gc, result, z, result.ctrl.tEff, [bT, bG], true));
  } else {
    rows.push([rawReadingLabel(), ['', m1, 4], ['', m1, 4]]);
    rows.push([correctedReadingLabel(), ['M', t.M, 4, true], ['M', g.M, 4, true]]);
    rows.push(...doseTableRows(t, g, result, z, i.tEff, [false, false], true));
  }

  const cell = ([sym, v, d, dose, own], blocked) => `<td class="v">${sym ? `<i>${sym}</i> ` : ''}${dose && (blocked || own) ? '—' : fmt(v, d)}</td>`;
  $('#co-factors').innerHTML =
    `<thead><tr><th>${L('Величина', 'Quantity')}</th>${showT ? '<th>TRS-398</th>' : ''}${showG ? '<th>TG-51</th>' : ''}</tr></thead><tbody>` +
    rows.map((r) => (r[3] === 'group' ? `<tr class="group"><td colspan="${1 + showT + showG}">${r[0]}</td></tr>` : `<tr class="${r[3] || ''}"><td>${r[0]}</td>${showT ? cell(r[1], t.blocked) : ''}${showG ? cell(r[2], g.blocked) : ''}</tr>`)).join('') +
    '</tbody>';
}

// ------------------------------------------------------------ протокол текстом
function reportText(data, r) {
  const out = [];
  const line = (k, v) => out.push(`${k}: ${v}`);
  const cells = (a) => (Array.isArray(a) ? a.filter((x) => String(x).trim() !== '').join('; ') : a);
  const i = r.inputs;
  const z = zText(i.zref);
  out.push(L('ПРОТОКОЛ РЕФЕРЕНСНОЙ ДОЗИМЕТРИИ — ⁶⁰Co', 'REFERENCE DOSIMETRY REPORT — ⁶⁰Co'));
  line(L('Протокол', 'Protocol'), PROTO[data.protocol].name);
  line(L('Учреждение', 'Institution'), data.co_institution || '—');
  line(L('Аппарат', 'Machine'), data.co_machine || '—');
  line(L('Дата', 'Date'), data.co_date || '—');
  line(L('Измерения выполнили', 'Measured by'), data.co_staff.filter((s) => s.trim()).join(', ') || '—');
  line(
    L('Геометрия', 'Geometry'),
    L(
      `${data.co_geometry === 'SAD' ? 'РИК' : 'РИП'} = ${data.co_distance} см, поле 10×10 см ${data.co_geometry === 'SAD' ? 'в плоскости камеры' : 'на поверхности воды'}, z_ref = ${z} г/см²`,
      `${data.co_geometry === 'SAD' ? 'SCD' : 'SSD'} = ${data.co_distance} cm, 10×10 cm field ${data.co_geometry === 'SAD' ? 'in the chamber plane' : 'at the water surface'}, z_ref = ${z} g/cm²`,
    ),
  );
  out.push('');
  line(
    L('Камера', 'Chamber'),
    `${r.chamber ? `${r.chamber.label} (${r.chamber.type === 'pp' ? L('плоскопараллельная', 'plane-parallel') : L('цилиндрическая', 'cylindrical')})` : '—'}, ${L('№', 'S/N')} ${data.co_ch_serial || '—'}`,
  );
  line('N_D,w', L(`${data.co_ndw} ${unitLabel(NDW_UNITS[data.co_ndw_unit])} (= ${fmt(i.ndw, 6)} Гр/нКл); T0 = ${data.co_T0} °C, P0 = ${data.co_P0} кПа`, `${data.co_ndw} ${unitLabel(NDW_UNITS[data.co_ndw_unit])} (= ${fmt(i.ndw, 6)} Gy/nC); T0 = ${data.co_T0} °C, P0 = ${data.co_P0} kPa`));
  line(L('Электрометр', 'Electrometer'), `${data.co_el_model || '—'}, ${L('№', 'S/N')} ${data.co_el_serial || '—'}, k_elec = ${data.co_kelec}`);
  line(
    L('Условия', 'Conditions'),
    `T = ${data.co_env_T} °C, P = ${data.co_env_P} ${unitLabel(PRESSURE_UNITS[data.co_env_P_unit])}${String(data.co_env_H ?? '').trim() ? L(`, относительная влажность ${data.co_env_H} %`, `, relative humidity ${data.co_env_H} %`) : ''}`,
  );
  const tm = r.timer;
  const timerTxt =
    data.co_timer_mode === 'measured'
      ? `${L(`по ${tm.n ?? '—'} облучениям`, `from ${tm.n ?? '—'} exposures`)}: ${data.co_tt
          .map((t, k) => [t, data.co_tm[k]])
          .filter(([a, b]) => String(a ?? '').trim() && String(b ?? '').trim())
          .map(([a, b]) => L(`${a} ${i.unitLabel} → ${b} нКл`, `${a} ${i.unitLabel} → ${b} nC`))
          .join('; ')}`
      : data.co_timer_mode === 'nexp'
        ? L(
            `одно облучение ${data.co_nx_t} ${i.unitLabel} (${cells(data.co_nx_M1)} нКл) против ${data.co_nx_n} облучений по t/n (${cells(data.co_nx_Mn)} нКл)`,
            `one exposure of ${data.co_nx_t} ${i.unitLabel} (${cells(data.co_nx_M1)} nC) vs. ${data.co_nx_n} exposures of t/n (${cells(data.co_nx_Mn)} nC)`,
          )
        : data.co_timer_mode === 'manual'
          ? L('введено', 'entered manually')
          : L('не учитывалась', 'not accounted for');
  if (data.co_timer_mode === 'window') {
    line(
      L('Время', 'Time'),
      L(
        `заряд накоплен электрометром за ${data.co_time} ${i.unitLabel} при выдвинутом источнике; ошибка таймера в мощность дозы не входит`,
        `charge collected by the electrometer over ${data.co_time} ${i.unitLabel} with the source in the treatment (exposed) position; the timer error does not enter the dose rate`,
      ),
    );
  } else line(L('Время облучения', 'Irradiation time'), `t = ${data.co_time} ${i.unitLabel}; τ = ${fmt(tm.tau, 4)} ${i.unitLabel} (${timerTxt}); t + τ = ${fmt(i.tEff, 4)} ${i.unitLabel}`);
  line(L('Напряжения', 'Voltages'), L(`V1 = ${data.co_V1} В, V2 = ${data.co_V2} В, обычная полярность ${data.co_polarity}`, `V1 = ${data.co_V1} V, V2 = ${data.co_V2} V, normal polarity ${data.co_polarity}`));
  const mean = L('среднее', 'mean');
  line(L('M(V1, обычная), нКл', 'M(V1, normal), nC'), `${cells(data.co_M1)} → ${mean} ${fmt(Math.abs(i.M1.mean), 4)}`);
  line(L('M(V1, обратная), нКл', 'M(V1, opposite), nC'), `${cells(data.co_Mopp)} → ${mean} ${fmt(Math.abs(i.Mopp.mean), 4)}`);
  line(L('M(V2), нКл', 'M(V2), nC'), `${cells(data.co_M2)} → ${mean} ${fmt(Math.abs(i.M2.mean), 4)}`);
  if (r.ctrl.on) line(L('Контрольные измерения M(V1), нКл', 'Check measurements M(V1), nC'), `${cells(data.co_Mc)} → ${mean} ${fmt(r.ctrl.mean, 4)} ${L('за', 'for')} ${fmt(r.ctrl.t, 2)} ${i.unitLabel}`);
  if (Number.isFinite(r.source.A)) {
    line(
      L('Источник', 'Source'),
      L(
        `${data.co_act0} ${unitLabel(ACTIVITY_UNITS[data.co_act_unit])} на ${data.co_act_date}; на дату измерения ${fmt(r.source.ACi, 0)} Ки = ${fmt(r.source.ATBq, 1)} ТБк`,
        `${data.co_act0} ${unitLabel(ACTIVITY_UNITS[data.co_act_unit])} on ${data.co_act_date}; at the measurement date ${fmt(r.source.ACi, 0)} Ci = ${fmt(r.source.ATBq, 1)} TBq`,
      ),
    );
  }
  out.push('');
  const blocks = [data.protocol];
  for (const k of blocks) {
    const x = k === 'trs' ? r.trs : r.tg51;
    out.push(`— ${PROTO[k].name} —`);
    if (k === 'trs') out.push(`k_TP = ${fmt(x.kTP)}; k_elec = ${fmt(x.kelec)}; k_pol = ${fmt(x.kpol)}; k_s = ${fmt(x.ks)} (${x.ksEquation || '—'}); k_leak = ${fmt(x.kleak)}; k_Q = 1`);
    else {
      out.push(
        L(
          `P_TP = ${fmt(x.PTP)}; P_elec = ${fmt(x.Pelec)}; P_pol = ${fmt(x.Ppol)}; P_ion = ${fmt(x.Pion)} (ур. 11); P_leak = ${fmt(x.Pleak)}; k_Q = 1,000`,
          `P_TP = ${fmt(x.PTP)}; P_elec = ${fmt(x.Pelec)}; P_pol = ${fmt(x.Ppol)}; P_ion = ${fmt(x.Pion)} (Eq. 11); P_leak = ${fmt(x.Pleak)}; k_Q = 1.000`,
        ),
      );
    }
    if (x.blocked) {
      out.push(L('РЕЗУЛЬТАТ НЕ ВЫЧИСЛЕН: есть ошибки ввода (см. замечания).', 'RESULT NOT CALCULATED: there are input errors (see Messages).'));
    } else {
      const describe = (y, title) => {
        const atZmax = r.depth.expectedAt === 'zmax';
        let dev = '';
        if (Number.isFinite(y.deviation)) {
          const dec = Number.isFinite(r.depth.decay)
            ? L(` (${data.co_ref_rate} сГр/мин на ${r.depth.refDate}, распад × ${fmt(r.depth.decay, 4)})`, ` (${data.co_ref_rate} cGy/min on ${r.depth.refDate}, decay × ${fmt(r.depth.decay, 4)})`)
            : '';
          dev = L(`; ожидалось ${fmt(r.depth.expected, 2)} сГр/мин${dec}, отклонение ${fmtSigned(y.deviation, 2)} %`, `; expected ${fmt(r.depth.expected, 2)} cGy/min${dec}, deviation ${fmtSigned(y.deviation, 2)} %`);
        }
        out.push(
          L(
            `${title}: M с поправками = ${fmt(y.M)} нКл; D_w(${z}) = ${fmt(y.DcGy, 2)} сГр = ${fmt(y.D)} Гр за облучение; ${fmt(y.rate, 2)} сГр/мин = ${fmt(y.rateGy, 4)} Гр/мин на z_ref${atZmax ? '' : dev}`,
            `${title}: corrected M = ${fmt(y.M)} nC; D_w(${z}) = ${fmt(y.DcGy, 2)} cGy = ${fmt(y.D)} Gy per exposure; ${fmt(y.rate, 2)} cGy/min = ${fmt(y.rateGy, 4)} Gy/min at z_ref${atZmax ? '' : dev}`,
          ),
        );
        if (r.depth.on && r.depth.ok && Number.isFinite(y.rateMax)) {
          out.push(
            L(
              `  z_max = ${data.co_zmax} см; ${r.depth.label} = ${fmt(r.depth.factor)}; на z_max ${fmt(y.rateMax, 2)} сГр/мин = ${fmt(y.rateMaxGy, 4)} Гр/мин${atZmax ? dev : ''}`,
              `  z_max = ${data.co_zmax} cm; ${r.depth.label} = ${fmt(r.depth.factor)}; at z_max ${fmt(y.rateMax, 2)} cGy/min = ${fmt(y.rateMaxGy, 4)} Gy/min${atZmax ? dev : ''}`,
            ),
          );
        } else if (r.depth.on) {
          out.push(L('  Пересчёт на z_max не выполнен: исправьте данные раздела 7.', '  Transfer to z_max not performed: correct the data in section 7.'));
        }
      };
      if (x.ctrl && !x.ctrl.blocked) describe(x.ctrl, L('По контрольным измерениям (раздел 6)', 'From check measurements (section 6)'));
      else describe(x, r.ctrl.on ? L('По показанию M₁ раздела 5 (контрольные измерения содержат ошибки)', 'From reading M₁ of section 5 (the check measurements contain errors)') : L('По показанию M₁ раздела 5 (контрольные измерения не введены)', 'From reading M₁ of section 5 (no check measurements entered)'));
    }
    out.push('');
  }
  const msgs = r.messages.filter((m) => m.level !== 'info');
  if (msgs.length) {
    out.push(L('Замечания:', 'Messages:'));
    msgs.forEach((m) => out.push(`- ${m.text}${m.ref ? ` [${refText(m.ref)}]` : ''}`));
    out.push('');
  }
  if (data.co_notes) out.push(`${L('Примечания', 'Notes')}: ${data.co_notes}`);
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

/** Загрузка данных из файла или буфера обмена. Бросает ошибку, если файл не от этого модуля. */
export function importCobalt(obj) {
  if (!obj || obj.app !== FILE_TAG.app || typeof obj.form !== 'object') throw new Error(L('Это не файл калькулятора референсной дозиметрии.', 'This is not a reference dosimetry calculator file.'));
  if (obj.module !== FILE_TAG.module) {
    throw new Error(
      L(
        'Это файл другого раздела: откройте его на соответствующей вкладке или вставьте данные через Ctrl+V — нужная вкладка откроется сама.',
        'This file belongs to another section: open it on the corresponding tab, or paste the data with Ctrl+V and the right tab will open automatically.',
      ),
    );
  }
  writeForm(obj.form);
  update();
}

// ------------------------------------------------------------ цикл
let current = { data: null, result: null };
function update() {
  const data = readForm();
  const result = computeCobalt(data);
  current = { data: result.form, result };
  applyVisibility(result.form, result);
  renderOutputs(ROOT(), result);
  renderFlags(ROOT(), result.flags, seriesBox);
  renderReadout(result, result.form);
  $('#co-demo-flag').hidden = !isDemo(data);
  saveDraft(result.form);
  renderSignBlock($('#co-sign'), result.form.co_staff);
}

/** Смена языка: списки с переведёнными подписями, подписи ячеек, десятичный разделитель, пересчёт. */
function refreshForLang() {
  const kept = $$('select', ROOT()).map((sel) => [sel, sel.value]);
  fillUnitSelects();
  fillChamberSelect();
  for (const [sel, v] of kept) if ([...sel.options].some((o) => o.value === v)) sel.value = v;
  $$('#co-sheet .cells').forEach((box) => renderCells(box, readCells(box)));
  { const { a, b } = readPairs(pairsBox()); renderPairs(pairsBox(), a, b); }
  renderStaff($('#co-staff-list'), readStaff($('#co-staff-list')), update);
  localizeDemo(SAMPLE_COBALT, SAMPLE_COBALT_EN);
  localizeDecimals(ROOT());
  update();
}

export function initCobalt() {
  setStatus = makeStatus($('#co-status'));
  fillUnitSelects();
  fillChamberSelect();
  $$('#co-sheet .cells').forEach((box) => setupCells(box, update));
  setupPairs(pairsBox(), update);
  $$('#co-sheet > section .combo').forEach((c) => makeCombo(c));

  const draft = loadDraft();
  writeForm(draft ? draft : sampleData());
  localizeDemo(SAMPLE_COBALT, SAMPLE_COBALT_EN);
  update();
  if (!draft) setStatus(L('Загружен демонстрационный пример. Нажмите «Очистить», чтобы ввести свои данные.', 'Demo example loaded. Press "Clear" to enter your own data.'));

  const sheet = $('#co-sheet');
  sheet.addEventListener('input', update);
  sheet.addEventListener('change', (e) => {
    if (e.target.id === 'co_ch_model') {
      const id = e.target.value;
      if (id.startsWith('MY:')) fillCustomFields(getMyChambers().find((c) => c.id === id));
      else if (id === 'CUSTOM') fillCustomFields(null);
    }
    update();
  });
  $('#co-btn-save-chamber').addEventListener('click', () => {
    const model = $('#co_cc_model').value.trim();
    if (!model) {
      setStatus(L('Укажите модель камеры, чтобы сохранить её.', 'Enter the chamber model to save it.'));
      $('#co_cc_model').focus();
      return;
    }
    const cur = $('#co_ch_model').value;
    const id = cur.startsWith('MY:') ? cur : `MY:${Date.now().toString(36)}`;
    const old = getMyChambers().find((c) => c.id === id) || {};
    const entry = { ...old, id, cc_maker: $('#co_cc_maker').value.trim(), cc_model: model, cc_type: $('#co_cc_type').value };
    if (!saveMyChamber(entry)) {
      setStatus(L('Браузер не дал сохранить камеру: хранилище недоступно.', 'The browser did not allow saving the chamber: storage is unavailable.'));
      return;
    }
    fillChamberSelect();
    $('#co_ch_model').value = id;
    update();
    const saved = [entry.cc_maker, entry.cc_model].filter(Boolean).join(' ');
    setStatus(L(`Камера «${saved}» сохранена в «Мои камеры».`, `Chamber "${saved}" saved to "My chambers".`));
  });
  armButton($('#co-btn-del-chamber'), () => L('Удалить из «Моих камер»', 'Remove from "My chambers"'), () => L('Точно удалить?', 'Remove it?'), () => {
    deleteMyChamber($('#co_ch_model').value);
    fillChamberSelect();
    $('#co_ch_model').value = 'CUSTOM';
    update();
    setStatus(L('Камера удалена из списка; её данные остались в форме.', 'The chamber was removed from the list; its data remain in the form.'));
  });
  document.addEventListener('change', (e) => {
    if (e.target.name === 'protocol') update();
  });
  document.addEventListener('langchange', refreshForLang);

  $('#co-btn-add-staff').addEventListener('click', () => {
    const cur = readStaff($('#co-staff-list'));
    cur.push('');
    renderStaff($('#co-staff-list'), cur, update);
    $$('#co-staff-list .staff-input').at(-1).focus();
    update();
  });
  for (const b of $$('[data-co-preset]')) {
    b.addEventListener('click', () => {
      const [t0, p0] = b.dataset.coPreset.split('|');
      $('#co_T0').value = t0;
      $('#co_P0').value = p0;
      update();
    });
  }
  for (const b of $$('[data-co-distance]')) {
    b.addEventListener('click', () => {
      $('#co_distance').value = b.dataset.coDistance;
      update();
    });
  }

  $('#co-btn-sample').addEventListener('click', () => {
    writeForm(sampleData());
    update();
    setStatus(L('Загружен демонстрационный пример (вымышленные данные).', 'Demo example loaded (fictitious data).'));
  });
  armButton($('#co-btn-clear'), () => L('Очистить', 'Clear'), () => L('Точно очистить?', 'Clear everything?'), () => {
    writeForm({ ...CO_DEFAULTS, co_date: today() });
    update();
    setStatus(L('Форма очищена.', 'The form has been cleared.'));
  });

  const payload = () => JSON.stringify({ ...FILE_TAG, savedAt: new Date().toISOString(), form: current.data }, null, 2);
  $('#co-btn-save').addEventListener('click', () => {
    const name = ['Co60', current.data.co_machine, current.data.co_date].filter(Boolean).join('_').replace(/[^\p{L}\p{N}_.-]+/gu, '-');
    downloadText(payload(), `dosimetry_${name}.json`);
    setStatus(L('Файл сохранён.', 'File saved.'));
  });
  $('#co-btn-load').addEventListener('click', () => $('#co-file-input').click());
  $('#co-file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      importCobalt(JSON.parse(await file.text()));
      setStatus(L(`Открыт файл ${file.name}.`, `Opened file ${file.name}.`));
    } catch (err) {
      setStatus(err instanceof SyntaxError ? L('Файл повреждён: это не JSON.', 'The file is damaged: it is not JSON.') : err.message);
    }
    e.target.value = '';
  });
  $('#co-btn-copy-json').addEventListener('click', () =>
    copyText(payload(), L('Данные скопированы. Чтобы вставить их обратно, нажмите Ctrl+V на странице вне полей ввода.', 'Data copied. To paste them back, press Ctrl+V on the page outside the input fields.'), setStatus),
  );
  $('#co-btn-copy-report').addEventListener('click', () => copyText(reportText(current.data, current.result), L('Протокол скопирован в буфер обмена.', 'Report copied to the clipboard.'), setStatus));
  $('#co-btn-pdf').addEventListener('click', () => printToPdf([L('Дозиметрия', 'Dosimetry'), '⁶⁰Co', current.data.co_machine, current.data.co_date].filter(Boolean).join('_'), setStatus));
  $('#co-btn-print').addEventListener('click', () => window.print());
}
