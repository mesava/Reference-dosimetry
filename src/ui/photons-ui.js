// Модуль «МВ фотоны»: связывает форму с расчётным ядром.
import { computePhotons, FORM_DEFAULTS, normalizeForm } from '../core/photons.js';
import { SAMPLE_FORM, SAMPLE_FORM_EN } from '../core/sample.js';
import { L, getLang, refText } from '../core/i18n.js';
import { localizeDecimals } from './i18n.js';
import { CHAMBERS, chamberLabel, chamberNote } from '../core/chambers.js';
import { PRESSURE_UNITS, NDW_UNITS, parseBeamName, parseNumber, unitLabel } from '../core/units.js';
import { getMyChambers, saveMyChamber, deleteMyChamber } from './store.js';
import { makeCombo, renderCells, readCells, setupCells, renderStaff, readStaff } from './widgets.js';
import { setupBudget, renderBudget, doseUncLine, budgetDoseText, budgetFactorRows, budgetReportLines } from './uncertainty-ui.js';
import {
  $, $$, localizeDemo, doseGroupTitle, rawReadingLabel, correctedReadingLabel, fmt, fmtSigned, esc, today, makeStatus, copyText, downloadText, getActiveModule,
  currentProtocol, applyProtocol, renderOutputs, renderFlags, applyShowRules, armButton, renderSignBlock, printToPdf,
  renderCompliance, complianceLine, ctrlErrorText, fileStamp, checkFileFormat, compareWithFile, renderFileNote, versionText, renderNotesFlag, precisionNote,
  notifyUpdate, flashFields,
} from './common.js';

const DRAFT_KEY = 'reference-dosimetry.photons.v2';
const FILE_TAG = { app: 'reference-dosimetry', module: 'photons', version: 2 };
const SERIES_KEYS = ['rd_M1', 'rd_Mopp', 'rd_M2', 'ctrl_M', 'recal_M'];
const CC_KEYS = ['cc_maker', 'cc_model', 'cc_volume', 'cc_length', 'cc_radius', 'cc_wall', 'cc_wall_thickness', 'cc_electrode', 'cc_waterproof', 'cc_analog', 'cc_a', 'cc_b'];
const ROOT = () => document.getElementById('module-photons');
let setStatus = () => {};
export const photonsStatus = (text) => setStatus(text);

const isCustom = (id) => id === 'CUSTOM' || String(id).startsWith('MY:');

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
  const parts = [`<option value="">${L('— выберите камеру —', '— select a chamber —')}</option>`];
  for (const [maker, list] of chamberOptions()) {
    parts.push(`<optgroup label="${esc(maker)}">`);
    for (const c of list) {
      const tags = [c.tg51 || c.tg51Legacy ? 'TG-51' : null, c.trs ? 'TRS-398' : null].filter(Boolean).join(', ');
      parts.push(`<option value="${c.id}">${esc(c.model)}${c.note ? ' — ' + esc(chamberNote(c)) : ''} [${tags}]</option>`);
    }
    parts.push('</optgroup>');
  }
  const mine = getMyChambers().filter((c) => c.cc_type !== 'pp'); // плоскопараллельные для фотонов не рекомендуются
  if (mine.length) {
    parts.push(`<optgroup label="${L('Мои камеры', 'My chambers')}">`);
    for (const c of mine) parts.push(`<option value="${esc(c.id)}">${esc([c.cc_maker, c.cc_model].filter(Boolean).join(' ') || L('без названия', 'unnamed'))}</option>`);
    parts.push('</optgroup>');
  }
  parts.push(`<option value="CUSTOM">${L('Ввести свою камеру…', 'Enter a custom chamber…')}</option>`);
  sel.innerHTML = parts.join('');
  if (keep && $(`#ch_model option[value="${CSS.escape(keep)}"]`)) sel.value = keep;
}

function fillSelects() {
  fillChamberSelect();
  const analog = [`<option value="">${L('— нет —', '— none —')}</option>`];
  for (const [maker, list] of chamberOptions()) {
    analog.push(`<optgroup label="${esc(maker)}">`);
    for (const c of list) analog.push(`<option value="${c.id}">${esc(chamberLabel(c))}</option>`);
    analog.push('</optgroup>');
  }
  $('#cc_analog').innerHTML = analog.join('');
  for (const id of ['#ch_ndw_unit', '#ch_cross_ndw_unit']) $(id).innerHTML = Object.entries(NDW_UNITS).map(([k, u]) => `<option value="${k}">${unitLabel(u)}</option>`).join('');
  $('#env_P_unit').innerHTML = Object.entries(PRESSURE_UNITS).map(([k, u]) => `<option value="${k}">${unitLabel(u)}</option>`).join('');
}

/** Демонстрационный набор на текущем языке (текстовые поля), числа одинаковые. */
const sampleData = () => (getLang() === 'en' ? { ...SAMPLE_FORM, ...SAMPLE_FORM_EN } : SAMPLE_FORM);
const isDemo = (d) => [SAMPLE_FORM.meta_institution, SAMPLE_FORM_EN.meta_institution].includes(d.meta_institution) && [SAMPLE_FORM.meta_machine, SAMPLE_FORM_EN.meta_machine].includes(d.meta_machine);

// ------------------------------------------------------------ форма ↔ данные
const seriesBox = (key) => $(`#sheet .cells[data-series="${key}"]`);

function readForm() {
  const data = {};
  for (const key of Object.keys(FORM_DEFAULTS)) {
    if (key === 'protocol') data.protocol = currentProtocol();
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

function writeForm(values, { withProtocol = false } = {}) {
  const data = normalizeForm(values);
  if (isCustom(data.ch_model) && data.ch_model !== 'CUSTOM' && !getMyChambers().some((c) => c.id === data.ch_model)) {
    data.ch_model = 'CUSTOM';
  }
  for (const [key, value] of Object.entries(data)) {
    if (key === 'protocol') {
      if (withProtocol) applyProtocol(value);
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
  localizeDecimals(ROOT());
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
/** Номер раздела «Неопределённость»: после раздела 9 «Требуется калибровка?», если он показан. */
const uncSectionNo = (result) => (result.recal.needed ? 10 : 9);

/** Допуск учреждения на отклонение от номинала, % — для подписей. */
const tolText = (result) => fmt(result.recal.tolerance, result.recal.tolerance % 1 ? 1 : 0);

/** Раздел 9 «Требуется калибровка?»: появляется, если доза вне допуска (по умолчанию ±2 %) от номинала. */
function renderRecal(data, result) {
  const rc = result.recal;
  $('#recal-section').hidden = !rc.needed;
  $('#unc-step-no').textContent = String(uncSectionNo(result));
  $('#notes-step-no').textContent = String(uncSectionNo(result) + 1);
  if (!rc.needed) return;
  const x = data.protocol === 'tg51' ? result.tg51 : result.trs;
  const pre = preOf(x);
  const atMax = result.depth.nominalAt === 'dmax' && Number.isFinite(pre.DmaxPerMU);
  const preV = atMax ? pre.DmaxPerMU : pre.DperMU;
  const z = result.depth.zref;
  const zTxt = Number.isFinite(z) ? fmt(z, z % 1 ? 1 : 0) : '10';
  const where = atMax ? L('на d_max', 'at d_max') : L(`на ${zTxt} см`, `at ${zTxt} cm`);
  $('#recal-hint').textContent = L(
    `Доза ${fmt(preV, 4)} Гр на 100 МЕ ${where} отличается от номинального выхода ${fmt(result.depth.nominal, 3)} на ${fmtSigned(pre.deviation, 2)} % — больше допуска ±${tolText(result)} %. Если ускоритель калибруют, выберите «Да» и введите показания после калибровки.`,
    `The dose ${fmt(preV, 4)} Gy per 100 MU ${where} differs from the nominal output ${fmt(result.depth.nominal, 3)} by ${fmtSigned(pre.deviation, 2)} %, more than the ±${tolText(result)} % tolerance. If the linac is being calibrated, choose "Yes" and enter the readings after calibration.`,
  );
  $('#recal-pre').textContent = fmt(preV, 4);
  $('#recal-pre-sub').textContent = L(`${where}; от номинала ${fmtSigned(pre.deviation, 2)} %`, `${where}; from nominal ${fmtSigned(pre.deviation, 2)} %`);
  const post = x.recal && !x.recal.blocked ? x.recal : null;
  const postV = post ? (atMax ? post.DmaxPerMU : post.DperMU) : NaN;
  $('#recal-post').textContent = post ? fmt(postV, 4) : '—';
  $('#recal-post-sub').textContent = post && Number.isFinite(post.deviation) ? L(`${where}; от номинала ${fmtSigned(post.deviation, 2)} %`, `${where}; from nominal ${fmtSigned(post.deviation, 2)} %`) : '';
  $('#recal-diff').textContent = post && Number.isFinite(post.preVsNew) ? `${fmtSigned(post.preVsNew, 2)} %` : '—';
}

function applyVisibility(data, result) {
  const p = data.protocol;
  applyShowRules(ROOT(), data, p);
  renderRecal(data, result);

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
    ? L(
        'Недоступно: в калькуляторе для пучков с выравнивающим фильтром принимается k_vol = P_rp = 1. Протоколы допускают эту поправку и для таких пучков при неоднородном профиле (TRS-398, табл. 15, прим. c; аддендум TG-51, разд. 5.C.7). Отметьте БВФ в разделе 1, если это ваш случай.',
        'Not available: for beams with a flattening filter the calculator assumes k_vol = P_rp = 1. The protocols allow this correction for such beams too when the profile is non-uniform (TRS-398, Table 15, note c; TG-51 addendum, Sec. 5.C.7). Select FFF in section 1 if this applies to your beam.',
      )
    : trsOn
      ? L(
          'Пучок без выравнивающего фильтра: поправка обязательна, если камера не короткая. Одна и та же поправка применяется в обоих протоколах.',
          'Flattening-filter-free beam: the correction is required unless the chamber is short. The same correction is applied in both protocols.',
        )
      : L(
          'Формула (22) и табл. 11 взяты из TRS-398 и требуют TPR20,10: в режиме «только TG-51» рассчитайте P_rp по измеренному профилю или введите своё значение.',
          'Eq. (22) and Table 11 come from TRS-398 and require TPR20,10: in "TG-51 only" mode, calculate P_rp from a measured profile or enter your own value.',
        );

  // подписи, зависящие от выбора
  const pdd = data.qtrs_method === 'pdd2010';
  $('#lbl-v20').textContent = pdd ? 'PDD(20), %' : L('M на 20 см', 'M at 20 cm');
  $('#lbl-v10').textContent = pdd ? 'PDD(10), %' : L('M на 10 см', 'M at 10 cm');
  const z = result.depth.zref;
  const zTxt = Number.isFinite(z) ? fmt(z, z % 1 ? 1 : 0) : '10';
  const sad = data.setup_geometry === 'SAD';
  const ssd = result.geometry?.ssd;
  const ssdTxt = Number.isFinite(ssd) ? fmt(ssd, ssd % 1 ? 1 : 0) : '—';
  $('#dd-pdd-field').hidden = !data.dd_on || (sad && data.dd_sad !== 'pdd');
  $('#dd_nominal_at').disabled = !data.dd_on;
  $('#dd-nominal-sub').textContent = !data.dd_on
    ? L('Без пересчёта на d_max номинальный выход относится к опорной глубине.', 'Without transfer to d_max the nominal output refers to the reference depth.')
    : L('Итог показывается на этой глубине; отклонение считается от номинала на ней.', 'The result is shown at this depth, and the deviation is calculated from the nominal output there.');
  $('#lbl-dd-pdd').textContent = sad ? L(`PDD(${zTxt}) при РИП ${ssdTxt} см, %`, `PDD(${zTxt}) at SSD ${ssdTxt} cm, %`) : `PDD(${zTxt}), %`;
  $('#dd-pdd-sub').textContent = sad ? L(`измеренная при РИП ${ssdTxt} см; PDD при РИП 100 см здесь не подходит`, `measured at SSD ${ssdTxt} cm; PDD at SSD 100 cm is not suitable here`) : '';
  $('#lbl-dd-tmr .term').textContent = `TMR(${zTxt})`;
  $('#dd-hint').textContent = !sad
    ? L(
        `D(d_max) = D(${zTxt} см) / PDD(${zTxt}) · 100. PDD берут клиническую, из данных ввода в эксплуатацию и системы планирования.`,
        `D(d_max) = D(${zTxt} cm) / PDD(${zTxt}) · 100. Use the clinical PDD from the commissioning data and the treatment planning system.`,
      )
    : data.dd_sad === 'pdd'
      ? L(
          `Установка по РИО через PDD: D(d_max) = D(${zTxt} см) / PDD(${zTxt}) · 100 при РИП ${ssdTxt} см. Это доза на d_max при той же установке (РИП ${ssdTxt} см), а не в изоцентре; PDD нужна для этого РИП (TRS-398, разд. 6.4.3, рабочая запись 6.9).`,
          `SAD setup via PDD: D(d_max) = D(${zTxt} cm) / PDD(${zTxt}) · 100 at SSD ${ssdTxt} cm. This is the dose at d_max in the same setup (SSD ${ssdTxt} cm), not at the isocenter; the PDD must be for this SSD (TRS-398, Sec. 6.4.3, worksheet 6.9).`,
        )
      : L(
          'Установка по РИО: доза переносится на d_max в изоцентре через TMR из данных ввода в эксплуатацию (TRS-398, разд. 6.4.3; TG-51, разд. IX.C).',
          'SAD setup: the dose is transferred to d_max at the isocenter using the TMR from the commissioning data (TRS-398, Sec. 6.4.3; TG-51, Sec. IX.C).',
        );
  const field = parseNumber(data.setup_field);
  $('#field-view').textContent = Number.isFinite(field) ? `${fmt(field, field % 1 ? 1 : 0)} × ${fmt(field, field % 1 ? 1 : 0)} ${L('см', 'cm')}` : '';
  $('#sdd-hint').textContent = L(
    `Если оставить пустым: ${fmt(result.inputs.sddCm, 0)} см (по геометрии из раздела 1).`,
    `If left blank: ${fmt(result.inputs.sddCm, 0)} cm (from the geometry in section 1).`,
  );
  const src = result.trs?.fffEstimate?.source;
  $('#fff-pdd-src').textContent = src && src !== L('введено', 'entered') ? L(`Взято: ${src}.`, `Source: ${src}.`) : '';
}

// ------------------------------------------------------------ вывод
function renderInline(result, data) {
  renderOutputs(ROOT(), result);
  renderFlags(ROOT(), result.flags, seriesBox);

  const c = result.chamber;
  const info = $('#chamber-info');
  if (c && !c.custom) {
    const bits = [];
    if (c.rCavMm) bits.push(L(`радиус полости ${fmt(c.rCavMm, 2)} мм`, `cavity radius ${fmt(c.rCavMm, 2)} mm`));
    if (c.lengthMm) bits.push(L(`длина полости ${fmt(c.lengthMm, 1)} мм`, `cavity length ${fmt(c.lengthMm, 1)} mm`));
    const srcs = [c.tg51 ? L('аддендум TG-51', 'TG-51 addendum') : c.tg51Legacy ? 'TG-51 (1999)' : null, c.trs ? L('TRS-398 Rev.1 (формула и табл. 16)', 'TRS-398 Rev.1 (formula and Table 16)') : null].filter(Boolean);
    bits.push(L(`данные k_Q: ${srcs.join(', ')}`, `k_Q data: ${srcs.join(', ')}`));
    info.textContent = bits.join(' · ');
  } else if (c?.custom) {
    info.textContent = L('Заполните характеристики камеры ниже и укажите, откуда брать k_Q.', 'Fill in the chamber characteristics below and specify where to take k_Q from.');
  } else {
    info.textContent = '';
  }
  $('#shift-hint').textContent = Number.isFinite(c?.rCavMm)
    ? L(
        `Качество пучка измеряют при каждой референсной дозиметрии. Кривую ионизации цилиндрической камеры сдвигают к поверхности на 0,6·r = ${fmt(0.6 * c.rCavMm, 1)} мм.`,
        `Beam quality is measured at every reference dosimetry session. The depth-ionization curve of a cylindrical chamber is shifted toward the surface by 0.6·r = ${fmt(0.6 * c.rCavMm, 1)} mm.`,
      )
    : L('Качество пучка измеряют при каждой референсной дозиметрии.', 'Beam quality is measured at every reference dosimetry session.');
  $('#length-hint').textContent = Number.isFinite(c?.lengthMm)
    ? L(
        `Если оставить пустым, возьмётся ${fmt(c.lengthMm, 1)} мм${c.custom ? ' из характеристик камеры' : ' из табл. 4 TRS-398'}.`,
        `If left blank, ${fmt(c.lengthMm, 1)} mm${c.custom ? ' from the chamber characteristics' : ' from TRS-398 Table 4'} will be used.`,
      )
    : L('Длина полости по данным производителя.', 'Cavity length according to the manufacturer.');
}

const PROTO = {
  trs: { name: 'TRS-398 Rev.1' },
  tg51: {
    get name() {
      return L('TG-51 + аддендум 2014', 'TG-51 + 2014 addendum');
    },
  },
};

/** Доза до калибровки: по контрольным измерениям, если они введены и без ошибок, иначе по M₁ раздела 4. */
const preOf = (x) => (x.ctrl && !x.ctrl.blocked && !x.blocked ? x.ctrl : x);
/** Контрольные измерения введены, но с ошибками: итога нет (подменять его показанием M₁ нельзя). */
const ctrlFailed = (x) => !x.blocked && !!x.ctrl?.blocked;
/** Итог: после калибровки ускорителя (раздел 9), если она проведена, иначе — доза до калибровки. */
const primaryOf = (x) => (x.recal && !x.recal.blocked && !x.blocked ? x.recal : preOf(x));

/** Итог показывается на глубине, где задан номинальный выход: на d_max или на опорной глубине. */
const atMaxOf = (y, result) => result.depth.nominalAt === 'dmax' && Number.isFinite(y.DmaxPerMU);

/** Итог для сохранения в файл и сверки при открытии файла. */
function snapshot(result) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const x = result.protocol === 'tg51' ? result.tg51 : result.trs;
  if (x.blocked || ctrlFailed(x)) return { protocol: result.protocol, value: null };
  const p = primaryOf(x);
  return {
    protocol: result.protocol,
    source: p === x.recal ? 'recal' : p === x.ctrl ? 'ctrl' : 'main',
    value: num(atMaxOf(p, result) ? p.DmaxPerMU : p.DperMU),
    DperMU: num(p.DperMU),
    DmaxPerMU: num(p.DmaxPerMU),
    deviation: num(p.deviation),
    kQ: num(x.kQ),
    compliance: result.compliance?.status ?? null,
  };
}
const SNAP_CMP = { keys: ['value', 'DperMU', 'DmaxPerMU', 'kQ'], main: 'value', get unit() { return L('Гр на 100 МЕ', 'Gy per 100 MU'); } };

function doseRow(key, x, result) {
  const p = primaryOf(x);
  const fromRecal = p === x.recal;
  const fromCtrl = p === x.ctrl;
  const atMax = atMaxOf(p, result);
  const hasMax = Number.isFinite(p.DmaxPerMU);
  const main = atMax ? p.DmaxPerMU : p.DperMU;
  const z = result.depth.zref;
  const zTxt = Number.isFinite(z) ? fmt(z, z % 1 ? 1 : 0) : '10';
  const where = atMax ? L('на d<sub>max</sub>', 'at d<sub>max</sub>') : L(`на ${zTxt} см`, `at ${zTxt} cm`);
  const failed = ctrlFailed(x);
  const none = x.blocked || failed;
  let chip = '';
  if (Number.isFinite(p.deviation) && !none) {
    const cls = Math.abs(p.deviation) <= 1 ? 'good' : Math.abs(p.deviation) > result.recal.tolerance ? 'bad' : '';
    chip = `<span class="chip ${cls}" title="${L('Отклонение от номинального выхода', 'Deviation from the nominal output')}">${fmtSigned(p.deviation, 2)} %</span>`;
  }
  const units = fromRecal ? result.recal.mu : fromCtrl ? result.ctrl.mu : result.inputs.mu;
  const unitsTxt = Number.isFinite(units) ? fmt(units, 0) : '—';
  const doseLine = (lbl, cgy, gy) => `${lbl} = ${fmt(cgy, 2)} ${L('сГр', 'cGy')} = ${fmt(gy, 4)} ${L('Гр', 'Gy')} ${L(`за ${unitsTxt} МЕ`, `for ${unitsTxt} MU`)}`;
  const secondary = [
    doseLine(L(`D<sub>w</sub>(${zTxt} см)`, `D<sub>w</sub>(${zTxt} cm)`), p.DcGy, p.D),
    hasMax ? doseLine('D(d<sub>max</sub>)', p.DmaxcGy, p.Dmax) : null,
    hasMax
      ? atMax
        ? L(`На ${zTxt} см: ${fmt(p.DperMU, 4)} Гр на 100 МЕ`, `At ${zTxt} cm: ${fmt(p.DperMU, 4)} Gy per 100 MU`)
        : L(`На d<sub>max</sub>: ${fmt(p.DmaxPerMU, 4)} Гр на 100 МЕ`, `At d<sub>max</sub>: ${fmt(p.DmaxPerMU, 4)} Gy per 100 MU`)
      : null,
    fromRecal && p.pre
      ? L(
          `До калибровки: ${fmt(atMax ? p.pre.DmaxPerMU : p.pre.DperMU, 4)} Гр на 100 МЕ (от номинала ${fmtSigned(p.pre.deviation, 2)} %; от дозы после калибровки ${fmtSigned(p.preVsNew, 2)} %)`,
          `Before calibration: ${fmt(atMax ? p.pre.DmaxPerMU : p.pre.DperMU, 4)} Gy per 100 MU (from nominal ${fmtSigned(p.pre.deviation, 2)} %; from the dose after calibration ${fmtSigned(p.preVsNew, 2)} %)`,
        )
      : null,
    fromRecal || fromCtrl ? null : L('Контрольные измерения не введены — доза по показанию M₁ раздела 4', 'No check measurements entered — dose from reading M₁ of section 4'),
    !fromRecal && result.recal.needed
      ? result.recal.answer === 'no'
        ? L(`Вне допуска ±${tolText(result)} %; калибровка не проводилась`, `Outside the ±${tolText(result)} % tolerance; no calibration performed`)
        : L(`Вне допуска ±${tolText(result)} % — см. раздел 9 «Требуется калибровка?»`, `Outside the ±${tolText(result)} % tolerance — see section 9 "Calibration required?"`)
      : null,
  ].filter(Boolean).join('<br>');
  return `<div class="dose-row ${none ? 'blocked' : ''}">
    <div class="proto"><span>${PROTO[key].name}${fromRecal ? L(' · после калибровки', ' · after calibration') : fromCtrl || failed ? L(' · контрольные измерения', ' · check measurements') : ''}</span>${chip}</div>
    <div class="dose-big">${none || !Number.isFinite(main) ? '—' : fmt(main, 4)}<small>${L('Гр на 100 МЕ', 'Gy per 100 MU')} ${where}</small></div>
    <div class="secondary">${x.blocked ? L('Исправьте ошибки из списка замечаний', 'Correct the errors listed under Messages') : failed ? ctrlErrorText(7, 4) : secondary}</div>
    ${none || !Number.isFinite(main) ? '' : doseUncLine(result.unc, main, L('Гр на 100 МЕ', 'Gy per 100 MU'), 's-unc', uncSectionNo(result))}
  </div>`;
}

/** Итог для бюджета неопределённости: значение и где оно задано (или NaN, если итога нет). */
function uncTarget(result) {
  const x = result.protocol === 'tg51' ? result.tg51 : result.trs;
  if (x.blocked || ctrlFailed(x)) return { value: NaN, where: '' };
  const p = primaryOf(x);
  const atMax = atMaxOf(p, result);
  const z = result.depth.zref;
  const zTxt = Number.isFinite(z) ? fmt(z, z % 1 ? 1 : 0) : '10';
  return { value: atMax ? p.DmaxPerMU : p.DperMU, where: atMax ? L('на d<sub>max</sub>', 'at d<sub>max</sub>') : L(`на ${zTxt} см`, `at ${zTxt} cm`) };
}

function renderUnc(result) {
  const t = uncTarget(result);
  renderBudget($('#unc-budget'), result.unc, { hidden: $('#unc_over'), doseText: budgetDoseText(result.unc, t.value, L('Гр на 100 МЕ', 'Gy per 100 MU'), t.where) });
}

/** Строки таблицы с дозой: сГр и Гр за отпущенные МЕ и Гр на 100 МЕ — на опорной глубине и на d_max. */
function doseTableRows(t, g, result, zTxt, units, own = [false, false], bold = true) {
  const u = Number.isFinite(units) ? fmt(units, 0) : '—';
  const atMax = result.depth.nominalAt === 'dmax' && result.depth.on;
  const rows = [
    [L(`D<sub>w</sub>(${zTxt} см) за ${u} МЕ, сГр`, `D<sub>w</sub>(${zTxt} cm) for ${u} MU, cGy`), ['', t.DcGy, 2, true, own[0]], ['', g.DcGy, 2, true, own[1]]],
    [L(`D<sub>w</sub>(${zTxt} см) за ${u} МЕ, Гр`, `D<sub>w</sub>(${zTxt} cm) for ${u} MU, Gy`), ['', t.D, 4, true, own[0]], ['', g.D, 4, true, own[1]]],
    [L(`На ${zTxt} см, Гр на 100 МЕ`, `At ${zTxt} cm, Gy per 100 MU`), ['', t.DperMU, 4, true, own[0]], ['', g.DperMU, 4, true, own[1]], bold && !atMax ? 'total' : ''],
  ];
  if (result.depth.on) {
    rows.push(
      [L(`D(d<sub>max</sub>) за ${u} МЕ, сГр`, `D(d<sub>max</sub>) for ${u} MU, cGy`), ['', t.DmaxcGy, 2, true, own[0]], ['', g.DmaxcGy, 2, true, own[1]]],
      [L(`D(d<sub>max</sub>) за ${u} МЕ, Гр`, `D(d<sub>max</sub>) for ${u} MU, Gy`), ['', t.Dmax, 4, true, own[0]], ['', g.Dmax, 4, true, own[1]]],
      [L('На d<sub>max</sub>, Гр на 100 МЕ', 'At d<sub>max</sub>, Gy per 100 MU'), ['', t.DmaxPerMU, 4, true, own[0]], ['', g.DmaxPerMU, 4, true, own[1]], bold && atMax ? 'total' : ''],
    );
  }
  return rows;
}

function renderReadout(result, data) {
  const keys = [data.protocol];
  $('#dose-rows').innerHTML = keys.map((k) => doseRow(k, k === 'trs' ? result.trs : result.tg51, result)).join('');
  renderCompliance($('#compliance'), result.compliance, PROTO[data.protocol].name);

  const first = keys.map((k) => ({ k, x: k === 'trs' ? result.trs : result.tg51 })).find((o) => !o.x.blocked && o.x.ok && !ctrlFailed(o.x));
  const mv = $('#mobile-value');
  if (first) {
    const p = primaryOf(first.x);
    const val = atMaxOf(p, result) ? p.DmaxPerMU : p.DperMU;
    mv.innerHTML = `${first.k === 'trs' ? 'TRS' : 'TG-51'}: <b>${fmt(val, 4)}</b> ${L('Гр/100 МЕ', 'Gy/100 MU')}${Number.isFinite(p.deviation) ? ` (${fmtSigned(p.deviation, 2)} %)` : ''}`;
  } else {
    const n = result.messages.filter((m) => m.level === 'error').length;
    mv.textContent = n ? L(`Ошибок: ${n}`, `Errors: ${n}`) : '—';
  }

  const lvlName = { error: L('Ошибка', 'Error'), warn: L('Внимание', 'Warning'), info: L('Справка', 'Note') };
  const scopeName = { common: '', depth: L('Пересчёт на d_max · ', 'Transfer to d_max · '), ctrl: L('Контрольные измерения · ', 'Check measurements · '), recal: L('Калибровка · ', 'Calibration · '), unc: L('Неопределённость · ', 'Uncertainty · '), trs: 'TRS-398 · ', tg51: 'TG-51 · ' };
  const list = result.messages.filter((m) => ['common', 'depth', 'ctrl', 'recal', 'unc'].includes(m.scope) || keys.includes(m.scope));
  $('#messages').innerHTML = list.length
    ? list.map((m) => `<li class="${m.level}"><span class="lvl">${scopeName[m.scope]}${lvlName[m.level]}</span><span>${esc(m.text)}</span>${m.ref ? `<span class="ref">${esc(refText(m.ref))}</span>` : ''}</li>`).join('')
    : `<li class="info"><span class="lvl">${L('Всё в порядке', 'All clear')}</span><span>${L('Замечаний к введённым данным нет.', 'No issues with the entered data.')}</span></li>`;

  const t = result.trs;
  const g = result.tg51;
  const showT = keys.includes('trs');
  const showG = keys.includes('tg51');
  const z = result.depth.zref;
  const zTxt = Number.isFinite(z) ? fmt(z, z % 1 ? 1 : 0) : '10';
  const rows = [
    [L('Температура и давление', 'Temperature and pressure'), ['k<sub>TP</sub>', t.kTP, 4], ['P<sub>TP</sub>', g.PTP, 4]],
    [L('Электрометр', 'Electrometer'), ['k<sub>elec</sub>', t.kelec, 4], ['P<sub>elec</sub>', g.Pelec, 4]],
    [L('Полярность', 'Polarity'), ['k<sub>pol</sub>', t.kpol, 4], ['P<sub>pol</sub>', g.Ppol, 4]],
    [L('Рекомбинация', 'Recombination'), ['k<sub>s</sub>', t.ks, 4], ['P<sub>ion</sub>', g.Pion, 4]],
    [L('Утечка', 'Leakage'), ['k<sub>leak</sub>', t.kleak, 4], ['P<sub>leak</sub>', g.Pleak, 4]],
    [L('Усреднение по объёму', 'Volume averaging'), ['k<sub>vol</sub>', t.kvol, 4], ['P<sub>rp</sub>', g.Prp, 4]],
    [L('Качество пучка', 'Beam quality'), ['TPR<sub>20,10</sub>', t.tpr, 4], ['%dd(10)<sub>x</sub>', g.pdd10x, 2]],
    [L('Поправка на качество', 'Beam quality correction'), [result.inputs.cross ? 'k<sub>Q,Qcross</sub>' : 'k<sub>Q</sub>', t.kQ, 4], ['k<sub>Q</sub>', g.kQ, 4]],
    result.inputs.cross
      ? [L('N<sub>D,w,Qcross</sub>, Гр/нКл', 'N<sub>D,w,Qcross</sub>, Gy/nC'), ['', result.inputs.ndw, 5], ['', result.inputs.ndw, 5]]
      : [L('N<sub>D,w</sub>, Гр/нКл', 'N<sub>D,w</sub>, Gy/nC'), ['', result.inputs.ndw, 5], ['', result.inputs.ndw, 5]],
  ];
  if (result.inputs.cross) rows.push([L('TPR<sub>20,10</sub> пучка перекрёстной калибровки', 'TPR<sub>20,10</sub> of the cross-calibration beam'), ['', result.inputs.tprCross, 4], ['', NaN, 4]]);
  else rows.push([L('Поправочный множитель лаборатории', 'Laboratory correction multiplier'), [L('k<sub>лаб</sub>', 'k<sub>lab</sub>'), result.inputs.klab, 4], [L('k<sub>лаб</sub>', 'k<sub>lab</sub>'), result.inputs.klab, 4]]);
  if (result.depth.on) rows.push([result.depth.label, ['', result.depth.factor, 4], ['', result.depth.factor, 4]]);
  const tc = t.ctrl || {};
  const gc = g.ctrl || {};
  const bT = !!tc.blocked;
  const bG = !!gc.blocked;
  const ctrlFinal = result.ctrl.on && ((showT && t.ctrl && !bT) || (showG && g.ctrl && !bG));
  const muText = (u) => L(`${Number.isFinite(u) ? fmt(u, 0) : '—'} МЕ`, `${Number.isFinite(u) ? fmt(u, 0) : '—'} MU`);
  const m1 = Math.abs(result.inputs.M1.mean);
  const title = doseGroupTitle({ ctrlOn: result.ctrl.on, ctrlFinal, mainSec: 4, ctrlSec: 7, mainAmount: muText(result.inputs.mu), ctrlAmount: muText(result.ctrl.mu) });
  const tr = t.recal || {};
  const gr = g.recal || {};
  const rT = !!tr.blocked;
  const rG = !!gr.blocked;
  const recalFinal = result.recal.on && ((showT && t.recal && !rT) || (showG && g.recal && !rG));
  const atMaxNom = result.depth.nominalAt === 'dmax' && result.depth.on;
  const preAt = (y) => (y?.pre ? (atMaxNom ? y.pre.DmaxPerMU : y.pre.DperMU) : NaN);
  const signed = (v) => (Number.isFinite(v) ? `${fmtSigned(v, 2)} %` : '—');
  if (recalFinal) {
    rows.push([L(`Поглощённая доза — после калибровки ускорителя (раздел 9), ${muText(result.recal.mu)}`, `Absorbed dose — after the linac calibration (section 9), ${muText(result.recal.mu)}`), [], [], 'group']);
    rows.push([rawReadingLabel(), ['', result.recal.mean, 4], ['', result.recal.mean, 4]]);
    rows.push([correctedReadingLabel(true), ['M<sub>Q</sub>', tr.M, 4, true, rT], ['M', gr.M, 4, true, rG]]);
    rows.push(...doseTableRows(tr, gr, result, zTxt, result.recal.mu, [rT, rG], true));
    const where = atMaxNom ? 'd<sub>max</sub>' : L(`${zTxt} см`, `${zTxt} cm`);
    rows.push([L(`До калибровки, на ${where}, Гр на 100 МЕ (для справки)`, `Before calibration, at ${where}, Gy per 100 MU (for reference)`), ['', preAt(tr), 4], ['', preAt(gr), 4]]);
    rows.push([L('Доза до калибровки относительно дозы после калибровки', 'Dose before calibration relative to the dose after calibration'), ['', signed(tr.preVsNew)], ['', signed(gr.preVsNew)]]);
  } else {
  rows.push([title, [], [], 'group']);
  if (result.ctrl.on) {
    // контрольные измерения с ошибками: строки остаются, значения — прочерки
    rows.push([rawReadingLabel(), ['', result.ctrl.mean, 4], ['', result.ctrl.mean, 4]]);
    rows.push([correctedReadingLabel(true), ['M<sub>Q</sub>', tc.M, 4, true, bT], ['M', gc.M, 4, true, bG]]);
    rows.push(...doseTableRows(tc, gc, result, zTxt, result.ctrl.mu, [bT, bG], true));
  } else {
    rows.push([rawReadingLabel(), ['', m1, 4], ['', m1, 4]]);
    rows.push([correctedReadingLabel(true), ['M<sub>Q</sub>', t.M, 4, true], ['M', g.M, 4, true]]);
    rows.push(...doseTableRows(t, g, result, zTxt, result.inputs.mu, [false, false], true));
  }
  }

  if (!(showT ? t : g).blocked) rows.push(...budgetFactorRows(result.unc));

  const cell = ([sym, v, d, dose, own], blocked) => `<td class="v">${sym ? `<i>${sym}</i> ` : ''}${dose && (blocked || own) ? '—' : typeof v === 'string' ? v : fmt(v, d)}</td>`;
  const span = 1 + showT + showG;
  $('#factors').innerHTML =
    `<thead><tr><th>${L('Величина', 'Quantity')}</th>${showT ? '<th>TRS-398</th>' : ''}${showG ? '<th>TG-51</th>' : ''}</tr></thead><tbody>` +
    rows.map((r) => (r[3] === 'group' ? `<tr class="group"><td colspan="${span}">${r[0]}</td></tr>` : `<tr class="${r[3] || ''}"><td>${r[0]}</td>${showT ? cell(r[1], t.blocked) : ''}${showG ? cell(r[2], g.blocked) : ''}</tr>`)).join('') +
    '</tbody>';
}

// ------------------------------------------------------------ протокол текстом
function geometryText(data) {
  if (data.setup_geometry === 'SAD') return L('РИО = 100 см, поле 10×10 см в плоскости камеры, камера на глубине 10 см', 'SAD = 100 cm, 10×10 cm field at the chamber plane, chamber at 10 cm depth');
  if (data.setup_geometry === 'manual') {
    return L(
      `РИП = ${data.setup_ssd} см, поле ${data.setup_field}×${data.setup_field} см, камера на глубине ${data.setup_depth} см`,
      `SSD = ${data.setup_ssd} cm, ${data.setup_field}×${data.setup_field} cm field, chamber at ${data.setup_depth} cm depth`,
    );
  }
  return L('РИП = 100 см, поле 10×10 см на поверхности воды, камера на глубине 10 см', 'SSD = 100 cm, 10×10 cm field at the water surface, chamber at 10 cm depth');
}

function reportText(data, r) {
  const out = [];
  const c = r.chamber;
  const line = (k, v) => out.push(`${k}: ${v}`);
  const cells = (a) => (Array.isArray(a) ? a.filter((x) => String(x).trim() !== '').join('; ') : a);
  out.push(L('ПРОТОКОЛ РЕФЕРЕНСНОЙ ДОЗИМЕТРИИ — МВ ФОТОНЫ', 'REFERENCE DOSIMETRY REPORT — MV PHOTONS'));
  line(L('Протокол', 'Protocol'), PROTO[data.protocol].name);
  line(L('Калькулятор', 'Calculator'), versionText());
  line(L('Учреждение', 'Institution'), data.meta_institution || '—');
  line(L('Аппарат', 'Machine'), data.meta_machine || '—');
  const beamE = parseBeamName(data.meta_beam).energy;
  const showE = data.meta_energy && !(Number.isFinite(beamE) && Math.abs(beamE - parseNumber(data.meta_energy)) < 1e-9);
  const showF = data.meta_fff && parseBeamName(data.meta_beam).fff !== true;
  line(L('Пучок', 'Beam'), `${data.meta_beam || '—'}${showE ? L(`, ${data.meta_energy} МВ`, `, ${data.meta_energy} MV`) : ''}${showF ? L(', БВФ', ', FFF') : ''}`);
  line(L('Дата', 'Date'), data.meta_date || '—');
  line(L('Измерения выполнили', 'Measured by'), data.meta_staff.filter((s) => s.trim()).join(', ') || '—');
  line(L('Геометрия', 'Geometry'), geometryText(data));
  out.push('');
  if (c?.custom) {
    const ccName = [data.cc_maker, data.cc_model].filter(Boolean).join(' ') || '—';
    line(L('Камера', 'Chamber'), L(`своя: ${ccName}, № ${data.ch_serial || '—'}`, `custom: ${ccName}, S/N ${data.ch_serial || '—'}`));
    line(
      L('Характеристики', 'Characteristics'),
      L(
        `V = ${data.cc_volume || '—'} см³, L = ${data.cc_length || '—'} мм, r = ${data.cc_radius || '—'} мм, стенка ${data.cc_wall || '—'} ${data.cc_wall_thickness ? `(${data.cc_wall_thickness} г/см²)` : ''}, электрод ${data.cc_electrode || '—'}, ${data.cc_waterproof ? 'водонепроницаемая' : 'не водонепроницаемая'}`,
        `V = ${data.cc_volume || '—'} cm³, L = ${data.cc_length || '—'} mm, r = ${data.cc_radius || '—'} mm, wall ${data.cc_wall || '—'} ${data.cc_wall_thickness ? `(${data.cc_wall_thickness} g/cm²)` : ''}, electrode ${data.cc_electrode || '—'}, ${data.cc_waterproof ? 'waterproof' : 'not waterproof'}`,
      ),
    );
    if (c.analog) line(L('Аналог для k_Q', 'Analogous chamber for k_Q'), chamberLabel(c.analog));
    if (c.hasAB) line(L('Параметры ур. (34)', 'Parameters of Eq. (34)'), `a = ${data.cc_a}, b = ${data.cc_b}`);
  } else {
    line(L('Камера', 'Chamber'), c ? L(`${chamberLabel(c)}, № ${data.ch_serial || '—'}`, `${chamberLabel(c)}, S/N ${data.ch_serial || '—'}`) : '—');
  }
  if (r.inputs.cross) {
    const u = unitLabel(NDW_UNITS[data.ch_cross_ndw_unit]);
    line(
      L('N_D,w,Qcross (перекрёстная калибровка, TRS-398 ур. 27)', 'N_D,w,Qcross (cross-calibration, TRS-398 Eq. 27)'),
      L(`${data.ch_cross_ndw} ${u} (= ${fmt(r.inputs.ndw, 6)} Гр/нКл) при TPR20,10 = ${data.ch_cross_tpr}; T0 = ${data.ch_T0} °C, P0 = ${data.ch_P0} кПа`, `${data.ch_cross_ndw} ${u} (= ${fmt(r.inputs.ndw, 6)} Gy/nC) at TPR20,10 = ${data.ch_cross_tpr}; T0 = ${data.ch_T0} °C, P0 = ${data.ch_P0} kPa`),
    );
  } else {
    const ndwUnit = unitLabel(NDW_UNITS[data.ch_ndw_unit]);
    line('N_D,w', L(`${data.ch_ndw} ${ndwUnit} (= ${fmt(r.inputs.ndw, 6)} Гр/нКл); k_лаб = ${fmt(r.inputs.klab, 4)}; T0 = ${data.ch_T0} °C, P0 = ${data.ch_P0} кПа`, `${data.ch_ndw} ${ndwUnit} (= ${fmt(r.inputs.ndw, 6)} Gy/nC); k_lab = ${fmt(r.inputs.klab, 4)}; T0 = ${data.ch_T0} °C, P0 = ${data.ch_P0} kPa`));
  }
  line(L('Электрометр', 'Electrometer'), L(`${data.el_model || '—'}, № ${data.el_serial || '—'}, k_elec = ${data.el_kelec}`, `${data.el_model || '—'}, S/N ${data.el_serial || '—'}, k_elec = ${data.el_kelec}`));
  const hasH = String(data.env_H ?? '').trim();
  line(L('Условия', 'Conditions'), `T = ${data.env_T} °C, P = ${data.env_P} ${unitLabel(PRESSURE_UNITS[data.env_P_unit])}${hasH ? L(`, относительная влажность ${data.env_H} %`, `, relative humidity ${data.env_H} %`) : ''}`);
  line(L('Облучение', 'Irradiation'), L(`${data.rd_mu} МЕ, V1 = ${data.rd_V1} В, V2 = ${data.rd_V2} В, обычная полярность ${data.rd_polarity}`, `${data.rd_mu} MU, V1 = ${data.rd_V1} V, V2 = ${data.rd_V2} V, normal polarity ${data.rd_polarity}`));
  const mean = L('среднее', 'mean');
  line(L('M(V1, обычная), нКл', 'M(V1, normal), nC'), `${cells(data.rd_M1)} → ${mean} ${fmt(Math.abs(r.inputs.M1.mean), 4)}`);
  line(L('M(V1, обратная), нКл', 'M(V1, opposite), nC'), `${cells(data.rd_Mopp)} → ${mean} ${fmt(Math.abs(r.inputs.Mopp.mean), 4)}`);
  line(L('M(V2), нКл', 'M(V2), nC'), `${cells(data.rd_M2)} → ${mean} ${fmt(Math.abs(r.inputs.M2.mean), 4)}`);
  if (r.ctrl.on) line(L('Контрольные измерения M(V1), нКл', 'Check measurements M(V1), nC'), L(`${cells(data.ctrl_M)} → среднее ${fmt(r.ctrl.mean, 4)} за ${fmt(r.ctrl.mu, 0)} МЕ`, `${cells(data.ctrl_M)} → mean ${fmt(r.ctrl.mean, 4)} for ${fmt(r.ctrl.mu, 0)} MU`));
  if (r.recal.needed) {
    const ans = r.recal.answer === 'yes' ? L('да', 'yes') : r.recal.answer === 'no' ? L('нет', 'no') : L('не указано', 'not specified');
    line(L(`Требуется калибровка (доза вне допуска ±${tolText(r)} %)`, `Calibration required (dose outside the ±${tolText(r)} % tolerance)`), ans);
  }
  if (r.recal.on && r.recal.M?.n > 0) line(L('Показания после калибровки M(V1), нКл', 'Readings after calibration M(V1), nC'), L(`${cells(data.recal_M)} → среднее ${fmt(r.recal.mean, 4)} за ${fmt(r.recal.mu, 0)} МЕ`, `${cells(data.recal_M)} → mean ${fmt(r.recal.mean, 4)} for ${fmt(r.recal.mu, 0)} MU`));
  out.push('');
  const blocks = [data.protocol];
  for (const k of blocks) {
    const x = k === 'trs' ? r.trs : r.tg51;
    out.push(`— ${PROTO[k].name} —`);
    if (k === 'trs') {
      out.push(`k_TP = ${fmt(x.kTP)}; k_elec = ${fmt(x.kelec)}; k_pol = ${fmt(x.kpol)}; k_s = ${fmt(x.ks)}; k_leak = ${fmt(x.kleak)}; k_vol = ${fmt(x.kvol)}`);
      out.push(`TPR20,10 = ${fmt(x.tpr)} (${x.tprEquation || '—'})`);
      if (x.fffEstimate) {
        out.push(
          L(
            `Оценка TPR20,10 по PDD(10) = ${fmt(x.fffEstimate.pdd10, 1)} %: ${fmt(x.fffEstimate.value)} (не для калибровки)`,
            `TPR20,10 estimate from PDD(10) = ${fmt(x.fffEstimate.pdd10, 1)} %: ${fmt(x.fffEstimate.value)} (not for calibration)`,
          ),
        );
      }
      out.push(
        L(
          `k_Q: по формуле (34) ${fmt(x.kQFormula)}, по табл. 16 ${fmt(x.kQTable)}; в расчёте ${fmt(x.kQ)} (${x.kQSource || '—'})`,
          `k_Q: by Eq. (34) ${fmt(x.kQFormula)}, from Table 16 ${fmt(x.kQTable)}; used ${fmt(x.kQ)} (${x.kQSource || '—'})`,
        ),
      );
    } else {
      out.push(`P_TP = ${fmt(x.PTP)}; P_elec = ${fmt(x.Pelec)}; P_pol = ${fmt(x.Ppol)}; P_ion = ${fmt(x.Pion)}; P_leak = ${fmt(x.Pleak)}; P_rp = ${fmt(x.Prp)}`);
      out.push(`%dd(10)x = ${fmt(x.pdd10x, 2)} (${x.pdd10xEquation || '—'}); k_Q = ${fmt(x.kQ)} (${x.kQSource || '—'})`);
    }
    if (x.blocked) {
      out.push(L('РЕЗУЛЬТАТ НЕ ВЫЧИСЛЕН: есть ошибки ввода (см. замечания).', 'RESULT NOT CALCULATED: there are input errors (see Messages).'));
    } else {
      const describe = (y, title, units) => {
        const z0 = fmt(r.depth.zref, 0);
        const u = fmt(units, 0);
        const dev = Number.isFinite(y.deviation)
          ? L(`; отклонение от номинала (${r.depth.nominalAt === 'dmax' ? 'на d_max' : `на ${z0} см`}) ${fmtSigned(y.deviation, 2)} %`, `; deviation from nominal (${r.depth.nominalAt === 'dmax' ? 'at d_max' : `at ${z0} cm`}) ${fmtSigned(y.deviation, 2)} %`)
          : '';
        out.push(
          L(
            `${title}: M с поправками = ${fmt(y.M)} нКл; D_w(${z0} см) = ${fmt(y.DcGy, 2)} сГр = ${fmt(y.D)} Гр за ${u} МЕ; ${fmt(y.DperMU)} Гр на 100 МЕ${r.depth.nominalAt === 'zref' ? dev : ''}`,
            `${title}: corrected M = ${fmt(y.M)} nC; D_w(${z0} cm) = ${fmt(y.DcGy, 2)} cGy = ${fmt(y.D)} Gy for ${u} MU; ${fmt(y.DperMU)} Gy per 100 MU${r.depth.nominalAt === 'zref' ? dev : ''}`,
          ),
        );
        if (r.depth.on && r.depth.ok) {
          out.push(
            L(
              `  d_max = ${data.dd_zmax} см; ${r.depth.label} = ${fmt(r.depth.factor)}; D(d_max) = ${fmt(y.DmaxcGy, 2)} сГр = ${fmt(y.Dmax)} Гр за ${u} МЕ; ${fmt(y.DmaxPerMU)} Гр на 100 МЕ${r.depth.nominalAt === 'dmax' ? dev : ''}`,
              `  d_max = ${data.dd_zmax} cm; ${r.depth.label} = ${fmt(r.depth.factor)}; D(d_max) = ${fmt(y.DmaxcGy, 2)} cGy = ${fmt(y.Dmax)} Gy for ${u} MU; ${fmt(y.DmaxPerMU)} Gy per 100 MU${r.depth.nominalAt === 'dmax' ? dev : ''}`,
            ),
          );
        } else if (r.depth.on) {
          out.push(L('  Пересчёт на d_max не выполнен: исправьте данные раздела 8.', '  Transfer to d_max not performed: correct the data in section 8.'));
        }
      };
      if (x.recal && !x.recal.blocked) {
        describe(x.recal, L('После калибровки ускорителя (раздел 9)', 'After the linac calibration (section 9)'), r.recal.mu);
        if (x.recal.pre) {
          const preV = r.depth.nominalAt === 'dmax' ? x.recal.pre.DmaxPerMU : x.recal.pre.DperMU;
          out.push(
            L(
              `  До калибровки: ${fmt(preV)} Гр на 100 МЕ; отклонение от номинала ${fmtSigned(x.recal.pre.deviation, 2)} %; от дозы после калибровки ${fmtSigned(x.recal.preVsNew, 2)} %`,
              `  Before calibration: ${fmt(preV)} Gy per 100 MU; deviation from nominal ${fmtSigned(x.recal.pre.deviation, 2)} %; from the dose after calibration ${fmtSigned(x.recal.preVsNew, 2)} %`,
            ),
          );
        }
      } else if (x.ctrl && !x.ctrl.blocked) describe(x.ctrl, L('По контрольным измерениям (раздел 7)', 'From check measurements (section 7)'), r.ctrl.mu);
      else if (r.ctrl.on) out.push(L('РЕЗУЛЬТАТ НЕ ВЫЧИСЛЕН: в контрольных измерениях (раздел 7) ошибки (см. замечания).', 'RESULT NOT CALCULATED: the check measurements (section 7) contain errors (see Messages).'));
      else describe(x, L('По показанию M₁ раздела 4 (контрольные измерения не введены)', 'From reading M₁ of section 4 (no check measurements entered)'), r.inputs.mu);
      const cl = complianceLine(r.compliance, PROTO[k].name);
      if (cl) out.push(cl);
    }
    out.push('');
  }
  const ut = uncTarget(r);
  if (Number.isFinite(ut.value)) out.push(...budgetReportLines(r.unc, ut.value, L('Гр на 100 МЕ', 'Gy per 100 MU')), '');
  const msgs = r.messages.filter((m) => m.level !== 'info');
  if (msgs.length) {
    out.push(L('Замечания:', 'Messages:'));
    msgs.forEach((m) => out.push(`- ${m.text}${m.ref ? ` [${refText(m.ref)}]` : ''}`));
    out.push('');
  }
  if (data.meta_notes) out.push(L(`Примечания: ${data.meta_notes}`, `Notes: ${data.meta_notes}`));
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
    const raw = localStorage.getItem(DRAFT_KEY) || localStorage.getItem('reference-dosimetry.photons.v1');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Загрузка данных из файла или буфера обмена. Бросает ошибку, если файл не от этого модуля. */
export function importPhotons(obj) {
  if (!obj || obj.app !== FILE_TAG.app || typeof obj.form !== 'object') throw new Error(L('Это не файл калькулятора референсной дозиметрии.', 'This is not a reference dosimetry calculator file.'));
  checkFileFormat(obj, FILE_TAG);
  if (obj.module !== FILE_TAG.module) {
    throw new Error(
      L(
        'Это файл другого раздела: откройте его на соответствующей вкладке или вставьте данные через Ctrl+V — нужная вкладка откроется сама.',
        'This file belongs to another section: open it on the corresponding tab, or paste the data with Ctrl+V and the right tab will open automatically.',
      ),
    );
  }
  writeForm(obj.form);
  openedFile = obj;
  update();
}

// ------------------------------------------------------------ цикл
let current = { data: null, result: null };
/** Открытый файл: пока форму не меняли, итог сверяется с сохранённым в файле. */
let openedFile = null;

/** Подстановка значений из другой вкладки (перекрёстная калибровка из «Инструментов»): остальные поля не меняются. */
export function applyPhotonsPatch(patch) {
  writeForm({ ...readForm(), ...patch });
  openedFile = null;
  update();
  flashFields(Object.keys(patch));
}

function update() {
  // формула (22) и табл. 11 требуют TPR20,10, то есть протокол TRS-398
  if (currentProtocol() === 'tg51' && ['formula22', 'table11'].includes($('#prof_mode').value)) {
    $('#prof_mode').value = 'manual';
  }
  const data = readForm();
  const result = computePhotons(data);
  current = { data: result.form, result };
  applyVisibility(result.form, result);
  renderUnc(result);
  renderInline(result, result.form);
  renderReadout(result, result.form);
  $('#demo-flag').hidden = !isDemo(data);
  renderNotesFlag($('#notes-flag'), data.meta_notes, [SAMPLE_FORM.meta_notes, SAMPLE_FORM_EN.meta_notes], isDemo(data));
  renderFileNote($('#file-note'), openedFile ? compareWithFile(openedFile, snapshot(result), SNAP_CMP) : null);
  saveDraft(result.form);
  renderSignBlock($('#sign'), result.form.meta_staff);
  notifyUpdate(ROOT());
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

/** Смена языка: списки с переведёнными подписями, подписи ячеек, десятичный разделитель, пересчёт. */
function refreshForLang() {
  const kept = $$('select', ROOT()).map((sel) => [sel, sel.value]);
  fillSelects();
  for (const [sel, v] of kept) if ([...sel.options].some((o) => o.value === v)) sel.value = v;
  $$('#sheet .cells').forEach((box) => renderCells(box, readCells(box)));
  renderStaff($('#staff-list'), readStaff($('#staff-list')), update);
  localizeDemo(SAMPLE_FORM, SAMPLE_FORM_EN);
  localizeDecimals(ROOT());
  update();
}

export function initPhotons() {
  setStatus = makeStatus($('#status'));
  fillSelects();
  $$('#sheet .cells').forEach((box) => setupCells(box, update));
  $$('#sheet > section .combo').forEach((c) => makeCombo(c));
  setupBudget($('#unc-budget'), $('#unc_over'));

  const draft = loadDraft();
  writeForm(draft ? draft : sampleData());
  localizeDemo(SAMPLE_FORM, SAMPLE_FORM_EN);
  lastBeamFff = parseBeamName($('#meta_beam').value).fff;
  update();
  if (!draft) setStatus(L('Загружен демонстрационный пример. Нажмите «Очистить», чтобы ввести свои данные.', 'Demo example loaded. Click "Clear" to enter your own data.'));

  const sheet = $('#sheet');
  sheet.addEventListener('input', (e) => {
    openedFile = null;
    if (e.target.id === 'meta_beam') onBeamInput();
    update();
  });
  sheet.addEventListener('change', (e) => {
    openedFile = null;
    if (e.target.id === 'ch_model') {
      const id = e.target.value;
      if (id.startsWith('MY:')) fillCustomFields(getMyChambers().find((c) => c.id === id));
      else if (id === 'CUSTOM') fillCustomFields(null);
    }
    update();
  });
  document.addEventListener('change', (e) => {
    if (e.target.name === 'protocol') update();
  });
  document.addEventListener('langchange', refreshForLang);

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
      setStatus(L('Укажите модель камеры, чтобы сохранить её.', 'Enter the chamber model to save it.'));
      $('#cc_model').focus();
      return;
    }
    const id = String(data.ch_model).startsWith('MY:') ? data.ch_model : `MY:${Date.now().toString(36)}`;
    const entry = { id };
    for (const k of CC_KEYS) entry[k] = data[k];
    if (!saveMyChamber(entry)) {
      setStatus(L('Браузер не дал сохранить камеру: хранилище недоступно.', 'The browser did not allow saving the chamber: storage is unavailable.'));
      return;
    }
    fillChamberSelect();
    $('#ch_model').value = id;
    update();
    const ccName = [data.cc_maker, data.cc_model].filter(Boolean).join(' ');
    setStatus(L(`Камера «${ccName}» сохранена в «Мои камеры».`, `Chamber "${ccName}" saved to "My chambers".`));
  });
  armButton($('#btn-del-chamber'), () => L('Удалить из «Моих камер»', 'Remove from "My chambers"'), () => L('Точно удалить?', 'Remove it?'), () => {
    deleteMyChamber($('#ch_model').value);
    fillChamberSelect();
    $('#ch_model').value = 'CUSTOM';
    update();
    setStatus(L('Камера удалена из списка; её данные остались в форме.', 'The chamber was removed from the list; its data remain in the form.'));
  });

  $('#btn-sample').addEventListener('click', () => {
    openedFile = null;
    writeForm(sampleData());
    update();
    setStatus(L('Загружен демонстрационный пример (вымышленные данные).', 'Demo example loaded (fictitious data).'));
  });

  armButton($('#btn-clear'), () => L('Очистить', 'Clear'), () => L('Точно очистить?', 'Clear everything?'), () => {
    writeForm({ ...FORM_DEFAULTS, meta_date: today() });
    openedFile = null;
    lastBeamFff = null;
    update();
    setStatus(L('Форма очищена.', 'Form cleared.'));
  });

  const payload = () => JSON.stringify({ ...FILE_TAG, ...fileStamp(snapshot(current.result)), savedAt: new Date().toISOString(), form: current.data }, null, 2);

  $('#btn-save').addEventListener('click', () => {
    const name = [current.data.meta_machine, current.data.meta_beam, current.data.meta_date].filter(Boolean).join('_').replace(/[^\p{L}\p{N}_.-]+/gu, '-') || 'photons';
    downloadText(payload(), `dosimetry_${name}.json`);
    setStatus(L('Файл сохранён.', 'File saved.'));
  });

  $('#btn-load').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      importPhotons(JSON.parse(await file.text()));
      setStatus(L(`Открыт файл ${file.name}.`, `Opened file ${file.name}.`));
    } catch (err) {
      setStatus(err instanceof SyntaxError ? L('Файл повреждён: это не JSON.', 'The file is damaged: it is not JSON.') : err.message);
    }
    e.target.value = '';
  });

  $('#btn-copy-json').addEventListener('click', () =>
    copyText(payload(), L('Данные скопированы. Чтобы вставить их обратно, нажмите Ctrl+V на странице вне полей ввода.', 'Data copied. To paste them back, press Ctrl+V on the page outside the input fields.'), setStatus),
  );
  $('#btn-copy-report').addEventListener('click', () => copyText(reportText(current.data, current.result), L('Протокол скопирован в буфер обмена.', 'Report copied to the clipboard.'), setStatus));
  $('#btn-pdf').addEventListener('click', () => printToPdf([L('Дозиметрия', 'Dosimetry'), current.data.meta_machine, current.data.meta_beam, current.data.meta_date].filter(Boolean).join('_'), setStatus));
  $('#btn-print').addEventListener('click', () => window.print());
}
