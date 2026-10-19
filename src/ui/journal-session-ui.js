// «Журнал» → «Сеанс»: калибровка или проверка выхода всех пучков аппарата за один заход.
// Каждый пучок считается ядром вкладки дозиметрии («МВ фотоны», «Электроны», «⁶⁰Co»; journal.js собирает её форму
// из профилей и показаний);
// результат записывается в журнал кнопкой «Записать сеанс в журнал».
import { L, refText, getLang } from '../core/i18n.js';
import { PRESSURE_UNITS, unitLabel, isBlank, parseNumber } from '../core/units.js';
import {
  computeSessionBeam, finalizeSession, upsertSession, chamberText, certText, electrometerText, machineOf, equipmentDue, recordedBase, SESSION_DEFAULTS, uid,
  beamKeys, beamKind, chamberFormFromElectrons, elFormFromElectrons, chamberFormFromCobalt, elFormFromCobalt,
  sessionEquipDefaults, photonCapable, electronCapable, cobaltCapable,
} from '../core/journal.js';
import { FORM_DEFAULTS } from '../core/photons.js';
import { E_DEFAULTS } from '../core/electrons.js';
import { CO_DEFAULTS } from '../core/cobalt.js';
import { $, $$, esc, fmt, fmtSigned, today, makeStatus, copyText, currentProtocol, applyProtocol, notifyUpdate, richText, armButton, renderSignBlock, printToPdf, versionText } from './common.js';
import { localizeDecimals } from './i18n.js';
import { renderCells, readCells, setupCells, renderStaff, readStaff, makeCombo, renderPairs, readPairs, setupPairs } from './widgets.js';
import { getJournal, setJournal, onJournal } from './journal-store.js';
import { setupFilePanel, machineOptions, fmtDate, cellsHtml } from './journal-common.js';
import { finalizeChecks } from '../core/journal-check.js';
import { addCheck, secondChambers, checksHtml, setupCheckCells, readChecks, resetsRecorded, computeChecks, renderCheckResults, checksReadoutHtml, checkPanelMessages, checkReportLines } from './journal-check-ui.js';

const DRAFT_KEY = 'reference-dosimetry.session.v1';
const ROOT = () => $('#module-session');
let setStatus = () => {};
let bridge = { openInTab: () => {}, openEquipment: () => {} };
/** Связь с вкладками дозиметрии (показать там пучок сеанса: openInTab(kind, form, title)) и с «Оборудованием». */
export const setSessionBridge = (b) => (bridge = { ...bridge, ...b });

/**
 * Сеанс на форме: { id, machineId, date, mode, staff, notes, env, beams: { [beamId]: показания }, dirty }.
 * У пучка открытого из журнала сеанса есть base — настройки пучка, камеры и электрометра, записанные в сеансе:
 * сеанс считается по ним, пока не нажата «Пересчитать по текущему «Оборудованию»». dirty — есть правки после записи.
 */
let draft = { id: '', machineId: '', date: '', mode: 'cal', staff: [''], notes: '', env: { T: '', P: '', P_unit: 'kPa', H: '' }, equip: {}, beams: {}, checks: [], dirty: false };
let computed = []; // [{ beam, calc }] по пучкам формы
let checkComp = { items: [], verdicts: [] }; // проверки дозиметра второй камерой (journal-check-ui.js)
/** Число из профиля или общего поля — с десятичным разделителем текущего языка (для подсказок в полях). */
const locNum = (v) => (getLang() === 'en' ? String(v ?? '').replace(/(\d),(\d)/g, '$1.$2') : String(v ?? '').replace(/(\d)\.(\d)/g, '$1,$2'));

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* хранилище недоступно */
  }
}
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (d && typeof d === 'object') draft = { ...draft, ...d, env: { ...draft.env, ...(d.env || {}) }, equip: d.equip && typeof d.equip === 'object' ? d.equip : {}, beams: d.beams || {}, checks: Array.isArray(d.checks) ? d.checks : [] };
  } catch {
    /* повреждённый черновик */
  }
}

const KIND_ORDER = ['photon', 'electron', 'cobalt'];
/** Пучки сеанса: используемые в сеансах и те, что есть в открытом из журнала сеансе; фотоны, электроны, ⁶⁰Co. */
const activeBeams = (m) => {
  const list = m ? m.beams.filter((b) => b.active !== false || draft.beams[b.id]?.base) : [];
  return KIND_ORDER.flatMap((kind) => list.filter((b) => beamKind(b) === kind));
};
/** Серии показаний пучка данного вида (ячейки): имена полей; у ⁶⁰Co — и показания для ошибки таймера t против n·t/n. */
const seriesKeys = (k) => [k.M1, k.Mopp, k.M2, k.ctrl, k.recal, ...(k.timer || []).filter((x) => x === 'co_nx_M1' || x === 'co_nx_Mn')].filter(Boolean);
/** Облучения с разным временем (⁶⁰Co): пары «время — показание». */
const PAIRS = ['co_tt', 'co_tm'];
const timeUnit = (f) => (f.co_time_unit === 's' ? L('с', 's') : L('мин', 'min'));
const tg51 = () => currentProtocol() === 'tg51';
/** Поле %dd(10) пучка по способу TG-51. */
const q51Field = (f) => {
  const m = f.q51_method;
  if (m === 'foil50' || m === 'foil30') return ['q51_pdd10pb', L('%dd(10)<sub>Pb</sub> с фольгой, %', '%dd(10)<sub>Pb</sub> with foil, %')];
  if (m === 'manual') return ['q51_manual', '%dd(10)<sub>x</sub>, %'];
  return ['q51_pdd10', L('%dd(10), открытый пучок, %', '%dd(10), open beam, %')];
};
const blank3 = () => ['', '', ''];
const hasValues = (cells) => (cells || []).some((v) => !isBlank(v));

// ------------------------------------------------------------ камера и электрометр сеанса
// Камера и электрометр выбираются в сеансе (раздел 1), а не у пучка: своя камера для пучков каждого вида (фотоны,
// электроны, ⁶⁰Co) и один электрометр. По умолчанию — те, которыми мерили этот аппарат в последнем записанном сеансе.
const CAPABLE = { photon: photonCapable, electron: electronCapable, cobalt: cobaltCapable };
const DEFAULTS = { photon: FORM_DEFAULTS, electron: E_DEFAULTS, cobalt: CO_DEFAULTS };
const KIND_NAME = { photon: () => L('для фотонов', 'for photons'), electron: () => L('для электронов', 'for electrons'), cobalt: () => L('для ⁶⁰Co', 'for ⁶⁰Co') };
/** Камера и электрометр сеанса для пучков данного вида: выбранные в разделе 1 или по умолчанию. */
function sessionEquip(j, kind) {
  const def = sessionEquipDefaults(j, draft.machineId, kind);
  const e = draft.equip || {};
  const chamberId = e[kind] && j.chambers.some((c) => c.id === e[kind] && CAPABLE[kind](c.form)) ? e[kind] : def.chamberId;
  const elFirst = KIND_ORDER.map((k) => sessionEquipDefaults(j, draft.machineId, k).electrometerId).find(Boolean) || def.electrometerId;
  const electrometerId = e.el && j.electrometers.some((x) => x.id === e.el) ? e.el : elFirst;
  return { chamberId, electrometerId };
}
/** Списки камер (по видам пучков аппарата) и электрометра в разделе 1. */
function renderEquip() {
  const box = $('#js-equip');
  if (!box) return;
  const j = getJournal();
  const m = machineOf(j, draft.machineId);
  const kinds = KIND_ORDER.filter((k) => activeBeams(m).some((b) => beamKind(b) === k));
  if (!m || !kinds.length) {
    box.innerHTML = `<p class="sub-hint span-2">${esc(L('Выберите аппарат с пучками.', 'Select a machine with beams.'))}</p>`;
    return;
  }
  const opts = (list, cur, text, empty) => [`<option value=""${cur ? '' : ' selected'}>${esc(empty)}</option>`, ...list.map((x) => `<option value="${esc(x.id)}"${x.id === cur ? ' selected' : ''}>${esc(text(x))}</option>`)].join('');
  const chField = (kind) => {
    const list = j.chambers.filter((c) => CAPABLE[kind](c.form));
    const cur = sessionEquip(j, kind).chamberId;
    const label = kinds.length > 1 ? L(`Камера ${KIND_NAME[kind]()}`, `Chamber ${KIND_NAME[kind]()}`) : L('Камера', 'Chamber');
    return `<div class="field"><label for="js_eq_${kind}">${esc(label)}</label><select id="js_eq_${kind}" data-eq="${kind}">${opts(list, cur, (c) => chamberText(c) || L('камера без названия', 'unnamed chamber'), list.length ? L('— камера —', '— chamber —') : L('нет подходящих камер', 'no suitable chambers'))}</select>${list.length ? '' : `<span class="sub">${esc(L('добавьте камеру в «Оборудовании» → «Камеры»', 'add a chamber in Equipment → Chambers'))}</span>`}</div>`;
  };
  const elCur = sessionEquip(j, kinds[0]).electrometerId;
  box.innerHTML = kinds.map(chField).join('') +
    `<div class="field"><label for="js_eq_el">${esc(L('Электрометр', 'Electrometer'))}</label><select id="js_eq_el" data-eq="el">${opts(j.electrometers, elCur, (e) => electrometerText(e) || L('электрометр без названия', 'unnamed electrometer'), j.electrometers.length ? L('— электрометр —', '— electrometer —') : L('нет электрометров', 'no electrometers'))}</select>${j.electrometers.length ? '' : `<span class="sub">${esc(L('добавьте электрометр в «Оборудовании» → «Электрометры»', 'add an electrometer in Equipment → Electrometers'))}</span>`}</div>`;
}

// ------------------------------------------------------------ разметка пучка
/** Условия измерения пучка в сеансе: геометрия, напряжения, полярность, МЕ (у ⁶⁰Co — время); по умолчанию — из настроек пучка. */
function setupFields(id, kind, f, d, mode) {
  const v = (key) => esc(d[key] ?? f[key] ?? '');
  const num = (key, label, cls = '') => `<div class="field ${cls}"><label for="jsb-${id}-${key}">${label}</label><input type="text" id="jsb-${id}-${key}" data-sb="${key}" class="num" inputmode="decimal" value="${v(key)}"></div>`;
  const sel = (key, label, options) => {
    const cur = d[key] ?? f[key] ?? '';
    return `<div class="field"><label for="jsb-${id}-${key}">${label}</label><select id="jsb-${id}-${key}" data-sb="${key}">${options.map(([o, t]) => `<option value="${esc(o)}"${o === cur ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
  };
  const pol = (key) => sel(key, L('Полярность', 'Polarity'), [['+', L('положительная (+)', 'positive (+)')], ['-', L('отрицательная (−)', 'negative (−)')]]);
  const geom = [['SSD', L('РИП 100 см, камера на 10 см', 'SSD 100 cm, chamber at 10 cm')], ['SAD', L('РИО 100 см, камера на 10 см', 'SAD 100 cm, chamber at 10 cm')]];
  if ((d.setup_geometry ?? f.setup_geometry) === 'manual') geom.push(['manual', L('своя (задана во вкладке «МВ фотоны»)', 'custom (set in the MV photons tab)')]);
  const fields = {
    photon: [sel('setup_geometry', L('Установка', 'Setup'), geom), num('rd_V1', L('V₁ рабочее, В', 'V₁ operating, V')), mode === 'cal' ? num('rd_V2', L('V₂ пониженное, В', 'V₂ reduced, V')) : '', pol('rd_polarity'), num('rd_mu', L('МЕ за облучение', 'MU per irradiation'))],
    electron: [num('e_ssd', L('РИП, см', 'SSD, cm')), num('e_V1', L('V₁ рабочее, В', 'V₁ operating, V')), mode === 'cal' ? num('e_V2', L('V₂ пониженное, В', 'V₂ reduced, V')) : '', pol('e_polarity'), num('e_mu', L('МЕ за облучение', 'MU per irradiation'))],
    cobalt: [num('co_V1', L('V₁ рабочее, В', 'V₁ operating, V')), mode === 'cal' ? num('co_V2', L('V₂ пониженное, В', 'V₂ reduced, V')) : '', pol('co_polarity'), num('co_time', L(`Время облучения, ${timeUnit(f)}`, `Irradiation time, ${timeUnit(f)}`))],
  }[kind];
  return `<div class="grid three jsb-setup">${fields.join('')}</div>`;
}

function beamCard(j, m, b, mode) {
  const d = draft.beams[b.id] || {};
  const id = b.id;
  const kind = beamKind(b);
  const k = beamKeys(kind);
  const electron = kind === 'electron';
  // у открытого из журнала сеанса — камера, электрометр и настройки, записанные в нём
  const cobalt = kind === 'cobalt';
  const chFrom = { electron: chamberFormFromElectrons, cobalt: chamberFormFromCobalt }[kind] ?? ((x) => x);
  const elFrom = { electron: elFormFromElectrons, cobalt: elFormFromCobalt }[kind] ?? ((x) => x);
  const eq = sessionEquip(j, kind);
  const ch = d.base ? { form: chFrom(d.base) } : j.chambers.find((c) => c.id === eq.chamberId);
  const el = d.base ? { form: elFrom(d.base) } : j.electrometers.find((e) => e.id === eq.electrometerId);
  const f = { ...DEFAULTS[kind], ...(d.base || b.form || {}) };
  const noChamber = !d.base && !ch;
  const info = [chamberText(ch) || L('камера не выбрана', 'no chamber selected'), electrometerText(el) || L('электрометр не выбран', 'no electrometer selected')].join(' · ');
  const [kp, kx] = tg51() ? ['P<sub>pol</sub>', 'P<sub>ion</sub>'] : ['k<sub>pol</sub>', 'k<sub>s</sub>'];
  const inp = (key, label, { ph = '', sub = '', cls = '' } = {}) =>
    `<div class="field ${cls}"><label for="jsb-${id}-${key}">${label}</label><input type="text" id="jsb-${id}-${key}" data-sb="${key}" class="num" inputmode="decimal" value="${esc(d[key] ?? '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
  let quality;
  if (cobalt) {
    // качество пучка ⁶⁰Co не измеряют; при калибровке — облучения для ошибки таймера по способу из настроек пучка
    const u = timeUnit(f);
    const mode = f.co_timer_mode || 'measured';
    quality = {
      measured: `<div class="pairs" data-a="jsb-${id}-co_tt" data-b="jsb-${id}-co_tm" data-label-a="${esc(L('Заданное время', 'Set time'))}" data-label-b="${esc(L('Показание', 'Reading'))}">
          <span class="label">${esc(L('Ошибка таймера: облучения с разным временем', 'Timer error: exposures of different duration'))}</span>
          <div class="pairs-head"><span class="pair-no">№</span><span>${esc(L(`Заданное время, ${u}`, `Set time, ${u}`))}</span><span>${esc(L('Показание, нКл', 'Reading, nC'))}</span></div>
          <div class="pairs-list"></div>
          <div class="cells-tools">
            <button type="button" class="icon-btn pair-add" aria-label="${esc(L('Добавить облучение', 'Add an exposure'))}" title="${esc(L('Добавить облучение', 'Add an exposure'))}">+</button>
            <button type="button" class="icon-btn pair-remove" aria-label="${esc(L('Убрать последнее облучение', 'Remove the last exposure'))}" title="${esc(L('Убрать последнее облучение', 'Remove the last exposure'))}">−</button>
          </div>
        </div>`,
      nexp: `<div class="series">
          ${cellsHtml(`jsb-${id}-co_nx_M1`, L(`Ошибка таймера: показание за одно облучение t = ${locNum(f.co_nx_t)} ${u}`, `Timer error: reading for one exposure t = ${locNum(f.co_nx_t)} ${u}`), d.co_nx_M1 || blank3())}
          ${cellsHtml(`jsb-${id}-co_nx_Mn`, L(`суммарное показание за n = ${locNum(f.co_nx_n)} облучений по t/n`, `total reading for n = ${locNum(f.co_nx_n)} exposures of t/n`), d.co_nx_Mn || blank3())}
        </div>`,
      manual: `<div class="grid three">${inp('co_tau', `τ, ${u}`, { ph: locNum(f.co_tau), sub: L('ошибка таймера; пусто — из «Оборудования»', 'timer error; blank: from Equipment') })}</div>`,
      window: `<p class="sub-hint">${esc(L('Заряд накапливается при выдвинутом источнике: ошибка таймера в мощность дозы не входит.', 'Charge is collected with the source exposed: the timer error does not enter the dose rate.'))}</p>`,
      none: `<p class="jsb-warn">${esc(L('Ошибка таймера не учитывается (так задано в «Оборудовании»).', 'The timer error is not accounted for (as set in Equipment).'))}</p>`,
    }[mode] ?? '';
  } else if (electron) {
    const i50 = f.e_r50_method !== 'r50';
    quality = `<div class="grid three">
            ${i50 ? inp('e_i50', L('R<sub>50,ion</sub> (I<sub>50</sub>), г/см²', 'R<sub>50,ion</sub> (I<sub>50</sub>), g/cm²'), { ph: locNum(f.e_i50) }) : inp('e_r50', L('R<sub>50</sub>, г/см²', 'R<sub>50</sub>, g/cm²'), { ph: locNum(f.e_r50) })}
            ${inp('e_pdd', L('PDD(z<sub>ref</sub>), %', 'PDD(z<sub>ref</sub>), %'), { ph: locNum(f.e_pdd), sub: L('качество пучка; пусто — последнее из «Оборудования»', 'beam quality; blank: the last one from Equipment') })}
          </div>`;
  } else if (tg51()) {
    const [q51Key, q51Label] = q51Field(f);
    quality = `<div class="grid three">
            ${inp(q51Key, q51Label, { ph: locNum(f[q51Key]), sub: L('качество пучка (TG-51); пусто — последнее из «Оборудования», там же способ', 'beam quality (TG-51); blank: the last one from Equipment, where the method is set') })}
          </div>`;
  } else {
    const pdd = f.qtrs_method === 'pdd2010';
    quality = `<div class="grid three">
            ${inp('qtrs_v20', pdd ? 'PDD(20)' : L('M на 20 см', 'M at 20 cm'), { ph: locNum(f.qtrs_v20) })}
            ${inp('qtrs_v10', pdd ? 'PDD(10)' : L('M на 10 см', 'M at 10 cm'), { ph: locNum(f.qtrs_v10), sub: L('качество пучка; пусто — последнее из «Оборудования»', 'beam quality; blank: the last one from Equipment') })}
          </div>`;
  }
  return `<div class="jcard jsb${d.include === false ? ' off' : ''}" data-beam="${esc(id)}" data-kind="${kind}">
    <div class="jcard-head"><label class="check"><input type="checkbox" data-sb="include"${d.include === false ? '' : ' checked'}> <b>${esc(b.name || '—')}</b></label><span class="chip jsb-chip" data-chip></span></div>
    <p class="jsb-info">${richText(info)}</p>
    ${noChamber ? `<p class="jsb-warn">${esc(L('Камера не выбрана: выберите её в разделе 1 «Аппарат и условия» (камеры заводятся в «Оборудовании»).', 'No chamber selected: choose one in section 1, Machine and conditions (chambers are added in Equipment).'))}</p>` : ''}
    <div class="jsb-body">
      ${setupFields(id, kind, f, d, mode)}
      <div class="grid three">
        ${inp('env_T', L('Температура воды, °C', 'Water temperature, °C'), { ph: locNum(draft.env.T), sub: L('пусто — общая', 'blank — common') })}
        ${inp('env_P', L('Давление', 'Pressure'), { ph: locNum(draft.env.P), sub: L('пусто — общее', 'blank — common') })}
      </div>
      <div class="series">
        ${cellsHtml(`jsb-${id}-${k.M1}`, L('M при V₁, обычная полярность', 'M at V₁, normal polarity'), d[k.M1] || blank3())}
        ${mode === 'cal' ? cellsHtml(`jsb-${id}-${k.Mopp}`, L('M при V₁, обратная полярность', 'M at V₁, opposite polarity'), d[k.Mopp] || blank3()) : ''}
        ${mode === 'cal' ? cellsHtml(`jsb-${id}-${k.M2}`, L('M при V₂', 'M at V₂'), d[k.M2] || blank3()) : ''}
      </div>
      ${mode === 'cal'
        ? quality
        : `<div class="grid three">
            ${inp(k.fixedKpol, L(`${kp} из калибровки`, `${kp} from the calibration`), { sub: L('пусто — из журнала', 'blank: from the journal') })}
            ${inp(k.fixedKs, L(`${kx} из калибровки`, `${kx} from the calibration`), { sub: L('пусто — из журнала', 'blank: from the journal') })}
            <div class="field"><label for="jsb-${id}-${k.fixedFrom}">${esc(L('Дата калибровки', 'Calibration date'))}</label><input type="text" id="jsb-${id}-${k.fixedFrom}" data-sb="${k.fixedFrom}" data-fixed-from value="${esc(d[k.fixedFrom] ?? '')}"><span class="sub">${esc(L('для протокола, если значения введены вручную', 'for the report if the values are entered manually'))}</span></div>
            ${cobalt && f.co_timer_mode !== 'window' && f.co_timer_mode !== 'none' ? inp(k.fixedTau, L(`τ из калибровки, ${timeUnit(f)}`, `τ from the calibration, ${timeUnit(f)}`), { sub: L('пусто — из журнала', 'blank: from the journal') }) : ''}
          </div>
          <p class="sub-hint" data-fixed-note></p>`}
      <details class="jsb-more"${hasValues(d[k.ctrl]) || (k.recal && hasValues(d[k.recal])) ? ' open' : ''}>
        <summary>${esc(cobalt ? L('Контрольные измерения', 'Check measurements') : L('Контрольные измерения и подстройка ускорителя', 'Check measurements and linac adjustment'))}</summary>
        <div class="series">
          ${cellsHtml(`jsb-${id}-${k.ctrl}`, L('Контрольные измерения, M при V₁', 'Check measurements, M at V₁'), d[k.ctrl] || blank3())}
        </div>
        ${cobalt ? '' : `<div class="grid">
          <div class="field"><label for="jsb-${id}-${k.recalNeeded}">${esc(L('Ускоритель подстраивали?', 'Was the linac adjusted?'))}</label><select id="jsb-${id}-${k.recalNeeded}" data-sb="${k.recalNeeded}" data-recal-needed><option value="">—</option><option value="yes"${d[k.recalNeeded] === 'yes' ? ' selected' : ''}>${esc(L('да', 'yes'))}</option><option value="no"${d[k.recalNeeded] === 'no' ? ' selected' : ''}>${esc(L('нет', 'no'))}</option></select><span class="sub">${esc(L('если выход был вне допуска', 'if the output was out of tolerance'))}</span></div>
        </div>
        <div class="series" data-recal${d[k.recalNeeded] === 'yes' ? '' : ' hidden'}>
          ${cellsHtml(`jsb-${id}-${k.recal}`, L('После подстройки, M при V₁', 'After adjustment, M at V₁'), d[k.recal] || blank3())}
        </div>`}
      </details>
      <div class="jsb-result" data-result></div>
    </div>
  </div>`;
}

// ------------------------------------------------------------ форма ↔ черновик
function renderBeams() {
  renderEquip();
  const j = getJournal();
  const m = machineOf(j, draft.machineId);
  const box = $('#js-beams');
  if (!m) {
    box.innerHTML = `<p class="sub-hint">${esc(j.machines.length ? L('Выберите аппарат.', 'Select a machine.') : L('В журнале нет аппаратов: добавьте их в «Оборудовании» или откройте файл журнала.', 'The journal has no machines: add them in Equipment or open a journal file.'))}</p>`;
    return;
  }
  const beams = activeBeams(m);
  const recorded = beams.some((b) => draft.beams[b.id]?.base);
  const note = recorded
    ? `<div class="jsb-recorded"><p>${L(
        'Сеанс посчитан по настройкам, записанным в нём: камера, N<sub>D,w</sub>, электрометр и настройки пучка — как в день сеанса. Изменения в «Оборудовании» на него не влияют.',
        'The session is calculated with the settings recorded in it: chamber, N<sub>D,w</sub>, electrometer and beam settings as on the session day. Changes in Equipment do not affect it.',
      )}</p><button type="button" class="link-btn" id="js-btn-current">${esc(L('Пересчитать по текущему «Оборудованию»', 'Recalculate with the current Equipment'))}</button></div>`
    : '';
  // пучки фотонов и электронов — отдельными группами, если у аппарата есть и те и другие
  const both = new Set(beams.map(beamKind)).size > 1;
  const groupTitle = (kind) => `<h3 class="sub-h jsb-group">${esc({ electron: L('Пучки электронов', 'Electron beams'), cobalt: L('Пучки ⁶⁰Co', '⁶⁰Co beams') }[kind] ?? L('Пучки фотонов', 'Photon beams'))}</h3>`;
  const cards = beams.map((b, i) => (both && (i === 0 || beamKind(beams[i - 1]) !== beamKind(b)) ? groupTitle(beamKind(b)) : '') + beamCard(j, m, b, draft.mode)).join('');
  box.innerHTML = note + (cards || `<p class="sub-hint">${esc(L('У аппарата нет пучков: добавьте их в «Оборудовании».', 'The machine has no beams: add them in Equipment.'))}</p>`);
  for (const b of beams) {
    const d = draft.beams[b.id] || {};
    for (const key of seriesKeys(beamKeys(beamKind(b)))) {
      const c = box.querySelector(`.cells[data-series="jsb-${b.id}-${key}"]`);
      if (!c) continue;
      renderCells(c, d[key] || blank3());
      setupCells(c, onEdit);
    }
    const pairs = box.querySelector(`.pairs[data-a="jsb-${b.id}-co_tt"]`);
    if (pairs) {
      renderPairs(pairs, d.co_tt || ['', ''], d.co_tm || ['', '']);
      setupPairs(pairs, onEdit);
    }
  }
  localizeDecimals(box);
  renderChecks();
}

/** Карточки проверок дозиметра второй камерой (раздел 3, по желанию). */
function renderChecks() {
  const j = getJournal();
  const m = machineOf(j, draft.machineId);
  const box = $('#js-checks');
  const beams = activeBeams(m);
  // проверки пучков другого аппарата к этому сеансу не относятся
  draft.checks = (draft.checks || []).filter((c) => beams.some((b) => b.id === c.beamId));
  box.innerHTML = checksHtml(j, beams, draft.beams, draft.checks, { tg: tg51() });
  setupCheckCells(box, draft.checks, onEdit);
  localizeDecimals(box);
  $('#js-btn-add-check').disabled = !beams.length;
}

function writeHead() {
  const j = getJournal();
  if (!draft.machineId || !machineOf(j, draft.machineId)) draft.machineId = j.machines[0]?.id ?? '';
  $('#js_machine').innerHTML = machineOptions(j, draft.machineId);
  $('#js_machine').value = draft.machineId;
  const r = document.getElementById(`js_mode_${draft.mode}`);
  if (r) r.checked = true;
  $('#js_date').value = draft.date || today();
  renderStaff($('#js-staff-list'), draft.staff, onEdit);
  $('#js_T').value = draft.env.T ?? '';
  $('#js_P').value = draft.env.P ?? '';
  $('#js_P_unit').value = draft.env.P_unit || 'kPa';
  $('#js_H').value = draft.env.H ?? '';
  $('#js_notes').value = draft.notes ?? '';
}

/** Прочитать форму в черновик. */
function readDraft() {
  draft.machineId = $('#js_machine').value;
  draft.mode = $('input[name="js_mode"]:checked')?.value === 'check' ? 'check' : 'cal';
  draft.date = $('#js_date').value;
  draft.staff = readStaff($('#js-staff-list'));
  draft.env = { T: $('#js_T').value, P: $('#js_P').value, P_unit: $('#js_P_unit').value, H: $('#js_H').value };
  draft.notes = $('#js_notes').value;
  draft.equip = { ...(draft.equip || {}) };
  for (const sel of $$('#js-equip [data-eq]')) draft.equip[sel.dataset.eq] = sel.value;
  const j = getJournal();
  for (const card of $$('#js-beams .jsb')) {
    const id = card.dataset.beam;
    const d = { ...(draft.beams[id] || {}) };
    d.include = card.querySelector('[data-sb="include"]').checked;
    for (const el of card.querySelectorAll('[data-sb]:not([data-sb="include"])')) d[el.dataset.sb] = el.value;
    for (const key of seriesKeys(beamKeys(card.dataset.kind))) {
      const c = card.querySelector(`.cells[data-series="jsb-${id}-${key}"]`);
      if (c) d[key] = readCells(c);
    }
    const pairs = card.querySelector(`.pairs[data-a="jsb-${id}-co_tt"]`);
    if (pairs) [d[PAIRS[0]], d[PAIRS[1]]] = Object.values(readPairs(pairs));
    // камера и электрометр сеанса (у открытого из журнала сеанса — записанные в нём)
    if (!d.base) Object.assign(d, sessionEquip(j, card.dataset.kind));
    draft.beams[id] = d;
  }
  draft.checks = readChecks($('#js-checks'), draft.checks || []);
}

/** Сеанс для расчёта и записи из черновика (только пучки текущего аппарата). */
function sessionObject() {
  const j = getJournal();
  const m = machineOf(j, draft.machineId);
  return {
    ...SESSION_DEFAULTS,
    id: draft.id || '',
    machineId: draft.machineId,
    date: draft.date || today(),
    mode: draft.mode,
    protocol: currentProtocol(),
    staff: draft.staff,
    notes: draft.notes,
    env: { ...draft.env },
    beams: activeBeams(m).map((b) => {
      const d = draft.beams[b.id] || {};
      // камера и электрометр — выбранные в сеансе; у пучка открытого из журнала сеанса — записанные в нём
      return { beamId: b.id, include: d.include !== false, ...d, ...(d.base ? {} : sessionEquip(j, beamKind(b))) };
    }),
  };
}

// ------------------------------------------------------------ расчёт и вывод
const chipOf = (sum, started, kind = 'photon') => {
  if (!started) return ['empty', L('нет показаний', 'no readings')];
  if (!sum.ok) return ['error', L('есть ошибки', 'has errors')];
  if (sum.status === 'out') return ['out', L(`вне допуска ±${fmt(sum.tol, sum.tol % 1 ? 1 : 0)} %`, `out of ±${fmt(sum.tol, sum.tol % 1 ? 1 : 0)}%`)];
  if (sum.status === 'nonominal') return ['ok', kind === 'cobalt' ? L('посчитано, сравнивать не с чем', 'calculated, nothing to compare with') : L('посчитано, номинал не задан', 'calculated, no nominal')];
  return ['ok', L(`в допуске ±${fmt(sum.tol, sum.tol % 1 ? 1 : 0)} %`, `within ±${fmt(sum.tol, sum.tol % 1 ? 1 : 0)}%`)];
};
const atText = (s) => ({ dmax: 'd_max', zmax: 'z_max' })[s.at] ?? 'z_ref';
/** Показатель качества пучка для подписи: R50 (электроны), %dd(10)x (TG-51) или TPR20,10. */
const qualityText = (sum, kind, tg) =>
  !Number.isFinite(sum.quality) ? '' : kind === 'electron' ? L(`R50 = ${fmt(sum.quality, 3)} г/см²`, `R50 = ${fmt(sum.quality, 3)} g/cm²`) : tg ? `%dd(10)x = ${fmt(sum.quality, 2)}` : `TPR20,10 = ${fmt(sum.quality, 4)}`;
/** Название вкладки дозиметрии для пучка данного вида. */
const tabName = (kind) => ({ electron: L('«Электроны»', 'Electrons'), cobalt: L('«⁶⁰Co»', '⁶⁰Co') })[kind] ?? L('«МВ фотоны»', 'MV photons');
/** Итог пучка: число и единица (Гр на 100 МЕ или сГр/мин у ⁶⁰Co). */
const valueText = (sum, kind) => (kind === 'cobalt' ? [fmt(sum.value, 2), L('сГр/мин на', 'cGy/min at')] : [fmt(sum.value, 4), L('Гр на 100 МЕ на', 'Gy per 100 MU at')]);
/** ⁶⁰Co: с чем сравнивалась мощность дозы (для подписи под итогом и протокола). */
function comparisonText(calc) {
  const ref = calc.ref;
  const dpt = calc.result.depth;
  if (!ref) return '';
  const exp = Number.isFinite(dpt.expected) ? `${fmt(dpt.expected, 2)} ${L('сГр/мин', 'cGy/min')}` : '';
  const decay = Number.isFinite(dpt.decay) ? L(`, распад × ${fmt(dpt.decay, 4)}`, `, decay × ${fmt(dpt.decay, 4)}`) : '';
  const at = dpt.expectedAt === 'zmax' ? 'z_max' : 'z_ref';
  const fb = ref.atFallback ? L(' — на z_ref: в той калибровке не было пересчёта на z_max', '; at z_ref: that calibration had no transfer to z_max') : '';
  if (ref.src === 'journal') return L(`ожидалось ${exp} на ${at}: калибровка от ${fmtDate(ref.last.date)} (${fmt(dpt.refRate, 2)} сГр/мин${decay})${fb}`, `expected ${exp} at ${at}: the calibration of ${fmtDate(ref.last.date)} (${fmt(dpt.refRate, 2)} cGy/min${decay})${fb}`);
  if (ref.src === 'recorded') return exp ? L(`ожидалось ${exp} на ${at}, как записано в сеансе (${fmt(dpt.refRate, 2)} сГр/мин на ${fmtDate(dpt.refDate)}${decay})`, `expected ${exp} at ${at}, as recorded in the session (${fmt(dpt.refRate, 2)} cGy/min on ${fmtDate(dpt.refDate)}${decay})`) : '';
  const why = [
    ref.newSource ? L(`после замены источника (калибровка от ${fmtDate(ref.last.date)} — с прежним источником)`, `after the source replacement (the calibration of ${fmtDate(ref.last.date)} used the previous source)`) : '',
    ref.wanted && !ref.last ? L('калибровки этого пучка в журнале ещё нет', 'the journal has no calibration of this beam yet') : '',
    ref.wanted && ref.last && !ref.newSource ? L(`в калибровке от ${fmtDate(ref.last.date)} нет мощности дозы на этой глубине`, `the calibration of ${fmtDate(ref.last.date)} has no dose rate at this depth`) : '',
    ref.staleProfile ? L('значение из «Оборудования» датировано раньше установки источника — оно относится к прежнему источнику', 'the value in Equipment is dated before the source installation, so it refers to the previous source') : '',
  ].filter(Boolean).join('; ');
  if (ref.src === 'profile') return L(`ожидалось ${exp} на ${at}: значение из «Оборудования» (${fmt(dpt.refRate, 2)} сГр/мин${dpt.refDate ? ` на ${fmtDate(dpt.refDate)}` : ''}${decay})${why ? `, ${why}` : ''}`, `expected ${exp} at ${at}: the value from Equipment (${fmt(dpt.refRate, 2)} cGy/min${dpt.refDate ? ` on ${fmtDate(dpt.refDate)}` : ''}${decay})${why ? `, ${why}` : ''}`);
  return L(`сравнивать не с чем${why ? `: ${why}` : ''} — задайте мощность дозы для сравнения в «Оборудовании»`, `nothing to compare with${why ? `: ${why}` : ''}; set the comparison dose rate in Equipment`);
}
const lvlName = () => ({ error: L('Ошибка', 'Error'), warn: L('Внимание', 'Warning'), info: L('Справка', 'Note') });

function compute() {
  const j = getJournal();
  const s = sessionObject();
  computed = s.beams.map((b) => {
    const calc = computeSessionBeam(j, s, b);
    const kind = calc?.kind ?? 'photon';
    return { input: b, calc, kind, started: hasValues(b[beamKeys(kind).M1]) };
  });
  checkComp = computeChecks(j, s, draft.checks || [], new Map(computed.map((c) => [c.input.beamId, c])));
  return s;
}

function renderResults() {
  const s = compute();
  const tg = s.protocol === 'tg51';
  for (const { input, calc, started, kind } of computed) {
    const card = $(`#js-beams .jsb[data-beam="${CSS.escape(input.beamId)}"]`);
    if (!card || !calc) continue;
    const k = beamKeys(kind);
    card.classList.toggle('off', input.include === false);
    const sum = calc.summary;
    const [cls, text] = chipOf(sum, started, kind);
    const chip = card.querySelector('[data-chip]');
    chip.className = `chip jsb-chip ${cls}`;
    chip.textContent = input.include === false ? L('не участвует', 'excluded') : text;
    // средние показаний
    for (const out of card.querySelectorAll('output[data-mean]')) {
      const c = card.querySelector(`.cells[data-series="${CSS.escape(out.dataset.mean)}"]`);
      const v = readCells(c).map(parseNumber).filter(Number.isFinite);
      out.textContent = v.length ? fmt(Math.abs(v.reduce((a, x) => a + x, 0) / v.length), 4) : '';
    }
    card.querySelector('[data-recal]')?.toggleAttribute('hidden', card.querySelector('[data-recal-needed]')?.value !== 'yes');
    // откуда k_pol и k_s при проверке выхода
    const note = card.querySelector('[data-fixed-note]');
    if (note) {
      const [kp, kx] = tg ? ['P_pol', 'P_ion'] : ['k_pol', 'k_s'];
      const src = calc.fixedSrc || {};
      const valOf = (key) => parseNumber(calc.form[key]);
      const from = calc.form[k.fixedFrom];
      const whence = (code) =>
        ({
          manual: L('введён вручную', 'entered manually'),
          recorded: L(`как записано в сеансе${from ? ` (калибровка от ${from})` : ''}`, `as recorded in the session${from ? ` (calibration of ${from})` : ''}`),
          journal: L(`из калибровки этого пучка от ${fmtDate(calc.last?.date)}`, `from this beam's calibration of ${fmtDate(calc.last?.date)}`),
        })[code];
      const part = (name, key, code, digits = 4) => (code === 'none' ? L(`${name}: нет ни калибровки в журнале, ни значения вручную`, `${name}: neither a calibration in the journal nor a manual value`) : `${name} = ${fmt(valOf(key), digits)}${name === 'τ' ? ` ${timeUnit(calc.form)}` : ''} — ${whence(code)}`);
      const q = qualityText(sum, kind, tg);
      // τ (⁶⁰Co): из калибровки или, без неё, известное значение из «Оборудования»
      const tauWhy = calc.last ? L(`в калибровке от ${fmtDate(calc.last.date)} τ не определялась`, `τ was not determined at the calibration of ${fmtDate(calc.last.date)}`) : L('калибровки в журнале нет', 'no calibration in the journal');
      const tauPart = !src.tau ? '' : src.tau === 'profile' ? `; τ = ${fmt(valOf('co_tau'), 4)} ${timeUnit(calc.form)} — ${L(`из «Оборудования» (${tauWhy})`, `from Equipment (${tauWhy})`)}` : src.tau === 'none' && calc.last ? `; ${L(`τ: в калибровке от ${fmtDate(calc.last.date)} она не определялась — введите τ вручную или задайте известное значение в «Оборудовании»`, `τ: it was not determined at the calibration of ${fmtDate(calc.last.date)}; enter τ manually or set a known value in Equipment`)}` : `; ${part('τ', 'co_tau', src.tau)}`;
      let text;
      if (src.kpol === 'none' && src.ks === 'none') {
        text = L(`В журнале нет калибровки этого пучка до даты сеанса: проведите сеанс «Калибровка» или введите ${kp} и ${kx}${src.tau ? ' и τ' : ''} из последней калибровки вручную.`, `The journal has no calibration of this beam before the session date: run a Calibration session or enter ${kp} and ${kx}${src.tau ? ' and τ' : ''} from the last calibration manually.`);
      } else if (src.kpol === src.ks) {
        text = `${kp} = ${fmt(valOf(k.fixedKpol), 4)} ${L('и', 'and')} ${kx} = ${fmt(valOf(k.fixedKs), 4)} — ${whence(src.ks)}${tauPart}${q ? `; ${q}` : ''}.`;
      } else {
        text = `${part(kp, k.fixedKpol, src.kpol)}; ${part(kx, k.fixedKs, src.ks)}${tauPart}${q ? `; ${q}` : ''}.`;
      }
      note.innerHTML = richText(text);
      // в пустых полях — значения, которые будут использованы
      for (const [key, code] of [[k.fixedKpol, src.kpol], [k.fixedKs, src.ks], ...(src.tau ? [['co_tau', src.tau]] : [])]) {
        const el = card.querySelector(`[data-sb="${key}"]`);
        if (el) el.placeholder = code !== 'manual' && Number.isFinite(valOf(key)) ? fmt(valOf(key), 4) : '';
      }
      const fe = card.querySelector('[data-fixed-from]');
      if (fe) fe.placeholder = isBlank(input[k.fixedFrom]) && from ? from : '';
    }
    // итог пучка
    const res = card.querySelector('[data-result]');
    // разметку меняем, только если она изменилась: иначе щелчок по кнопке сразу после ввода (change при уходе
    // из поля) попадал бы в уже заменённую кнопку
    const put = (html) => {
      if (res._html === html) return;
      res._html = html;
      res.innerHTML = html;
    };
    if (!started) {
      put('');
      continue;
    }
    const lines = [];
    if (sum.hasValue) {
      const [vTxt, vUnit] = valueText(sum, kind);
      lines.push(`<p class="jsb-dose"><b>${vTxt}</b> ${esc(vUnit)} ${richText(atText(sum))}${Number.isFinite(sum.deviation) ? ` · ${esc(kind === 'cobalt' ? L('от ожидаемой', 'from expected') : L('от номинала', 'from nominal'))} <b>${fmtSigned(sum.deviation, 2)} %</b>` : ''}${sum.source === 'ctrl' ? ` · ${esc(L('по контрольным измерениям', 'from check measurements'))}` : sum.source === 'recal' ? ` · ${esc(L('после подстройки', 'after adjustment'))}${Number.isFinite(sum.preDeviation) ? ` (${esc(L('до неё', 'before'))} ${fmtSigned(sum.preDeviation, 2)} %)` : ''}` : ''}</p>`);
      const ks = tg ? 'P_ion' : 'k_s';
      const kp = tg ? 'P_pol' : 'k_pol';
      const prev = calc.prev && s.mode === 'cal' ? L(` (прошлая калибровка ${fmtDate(calc.prev.date)}: ${fmt(calc.prev.kpol, 4)} и ${fmt(calc.prev.ks, 4)})`, ` (previous calibration ${fmtDate(calc.prev.date)}: ${fmt(calc.prev.kpol, 4)} and ${fmt(calc.prev.ks, 4)})`) : '';
      const tauTxt = kind === 'cobalt' && Number.isFinite(calc.result.timer?.tau) && calc.result.timer.mode !== 'window' && calc.result.timer.mode !== 'none' ? `; τ = ${fmt(calc.result.timer.tau, 4)} ${timeUnit(calc.form)}` : '';
      const kqTxt = kind === 'cobalt' ? '' : `; ${sum.kQName || 'k_Q'} = ${fmt(sum.kQ, 4)}`;
      lines.push(`<p class="jsb-k">${richText(`${kp} = ${fmt(sum.kpolRaw, 4)}, ${ks} = ${fmt(sum.ksRaw, 4)}${sum.ksFixed ? L(' (из калибровки)', ' (from the calibration)') : ''}${prev}${tauTxt}${kqTxt}${Number.isFinite(sum.quality) ? `; ${qualityText(sum, kind, tg)}` : ''}`).replace(/k′_Q/g, 'k′<sub>Q</sub>')}</p>`);
      if (kind === 'cobalt') {
        const rt = comparisonText(calc);
        if (rt) lines.push(`<p class="jsb-k">${richText(rt)}</p>`);
      }
      if (Number.isFinite(sum.dKpol) && Math.abs(sum.dKpol) > 0.2) lines.push(`<p class="jsb-warn">${richText(L(`k_pol изменился на ${fmtSigned(sum.dKpol, 2)} % с прошлой калибровки: при изменении больше 0,2 % Report 374 советует выяснить причину (камера, кабель, электрометр).`, `k_pol changed by ${fmtSigned(sum.dKpol, 2)}% since the previous calibration: for a change above 0.2%, Report 374 advises investigating the cause (chamber, cable, electrometer).`))}</p>`);
    }
    // справки со ссылкой на протокол (рекомендации) видны всегда; список свёрнут, если нет ошибок
    const msgs = calc.result.messages.filter((m) => m.level !== 'info' || m.ref || m.cal || !sum.ok);
    const errs = msgs.filter((m) => m.level === 'error').length;
    if (errs && sum.hasValue) lines.push(`<p class="jsb-warn">${esc(L('Доза посчитана, но в настройках есть ошибки: пока их не исправить, пучок не записывается в журнал.', 'The dose is calculated, but the settings contain errors: until they are fixed, the beam is not recorded in the journal.'))}</p>`);
    if (msgs.length) {
      // замечания — те же, что на вкладке дозиметрии: подсказать, где исправлять
      const tab = tabName(kind);
      const where = errs
        ? `<li class="info"><span class="lvl">${esc(L('Где исправить', 'Where to fix'))}</span><span>${esc(
            calc.recorded
              ? L(`Замечания — те же, что на вкладке ${tab}; ссылка на раздел открывает пучок на вкладке, на этом разделе. Показания и условия исправляются здесь. Сеанс посчитан по записанным в нём настройкам: чтобы применить исправленные в «Оборудовании», нажмите «Пересчитать по текущему «Оборудованию»» в начале раздела.`, `The messages are those of the ${tab} tab; a section link opens the beam in the tab at that section. Readings and conditions are fixed here. The session is calculated with the settings recorded in it: to apply settings fixed in Equipment, click "Recalculate with the current Equipment" at the start of the section.`)
              : L(`Замечания — те же, что на вкладке ${tab}; ссылка на раздел открывает пучок на вкладке, на этом разделе. Показания и условия исправляются здесь, настройки пучка, камеры и электрометра — в «Оборудовании».`, `The messages are those of the ${tab} tab; a section link opens the beam in the tab at that section. Readings and conditions are fixed here; beam, chamber and electrometer settings are fixed in Equipment.`),
          )}</span></li>`
        : '';
      lines.push(`<details class="jsb-msgs"${errs ? ' open' : ''}><summary>${esc(L(`Замечания: ${msgs.length}`, `Messages: ${msgs.length}`))}${errs ? ` · ${esc(L(`ошибок ${errs}`, `${errs} errors`))}` : ''}</summary><ul class="messages">${msgs.map((m) => `<li class="${m.level}"><span class="lvl">${esc(lvlName()[m.level])}</span><span>${richText(m.text)}</span>${m.ref ? `<span class="ref">${esc(refText(m.ref))}</span>` : ''}</li>`).join('')}${where}</ul></details>`);
    }
    lines.push(`<div class="row-tools"><button type="button" class="link-btn" data-open-tab="${esc(input.beamId)}">${esc(L(`Открыть во вкладке ${tabName(kind)}: все поправки и PDF по пучку`, `Open in the ${tabName(kind)} tab: all corrections and a PDF for the beam`))}</button>${errs && !calc.recorded ? `<button type="button" class="link-btn" data-goto-eq="${esc(input.beamId)}">${esc(L('Открыть пучок в «Оборудовании»', 'Open the beam in Equipment'))}</button>` : ''}</div>`);
    put(lines.join(''));
  }
  renderCheckResults($('#js-checks'), checkComp.items);
  renderReadout(s);
}

function renderReadout(s) {
  const j = getJournal();
  const m = machineOf(j, s.machineId);
  const rows = computed.filter((c) => c.input.include !== false && c.calc);
  const okN = rows.filter((c) => c.started && c.calc.summary.ok && c.calc.summary.status !== 'out').length;
  const outN = rows.filter((c) => c.started && c.calc.summary.status === 'out').length;
  const errN = rows.filter((c) => c.started && !c.calc.summary.ok).length;
  const head = `${esc(m?.name || '—')} · ${esc(s.mode === 'cal' ? L('калибровка', 'calibration') : L('проверка выхода', 'output check'))} · ${esc(fmtDate(s.date))} · ${s.protocol === 'tg51' ? 'TG-51' : 'TRS-398 Rev.1'}`;
  // единица итога: Гр на 100 МЕ (ускоритель) или сГр/мин (⁶⁰Co); если в сеансе и то и другое — единица в ячейке
  const coRows = rows.filter((c) => c.kind === 'cobalt').length;
  const mixed = coRows > 0 && coRows < rows.length;
  const unitHead = mixed ? L('Итог', 'Result') : coRows ? L('сГр/мин', 'cGy/min') : L('Гр/100 МЕ', 'Gy/100 MU');
  const table = rows.length
    ? `<table class="factors jsum"><thead><tr><th>${esc(L('Пучок', 'Beam'))}</th><th class="v">${esc(unitHead)}</th><th class="v">${esc(L('Δ, %', 'Δ, %'))}</th></tr></thead><tbody>${rows
        .map(({ calc, started, kind }) => {
          const sum = calc.summary;
          const [cls] = chipOf(sum, started, kind);
          const v = started && sum.hasValue ? `${valueText(sum, kind)[0]}${mixed ? ` <small>${esc(kind === 'cobalt' ? L('сГр/мин', 'cGy/min') : L('Гр/100 МЕ', 'Gy/100 MU'))}</small>` : ''}` : '—';
          return `<tr class="st-${cls}"><td>${esc(calc.beam.name)}</td><td class="v">${v}</td><td class="v">${started && Number.isFinite(sum.deviation) ? fmtSigned(sum.deviation, 2) : '—'}</td></tr>`;
        })
        .join('')}</tbody></table>`
    : '';
  // считаются пучки с показаниями: калибровка одних электронов не «недоделанный» сеанс фотонов
  const startedN = okN + outN + errN;
  const chip = errN
    ? `<span class="chip bad">${esc(L(`с ошибками: ${errN}`, `with errors: ${errN}`))}</span>`
    : outN
      ? `<span class="chip warn">${esc(L(`вне допуска: ${outN}`, `out of tolerance: ${outN}`))}</span>`
      : okN && okN === rows.length
        ? `<span class="chip good">${esc(L('все в допуске', 'all within tolerance'))}</span>`
        : okN && okN === startedN
          ? `<span class="chip good">${esc(L(`измеренные в допуске: ${okN}`, `measured within tolerance: ${okN}`))}</span>`
          : '';
  $('#js-result').innerHTML = `<div class="dose-row"><div class="proto"><span>${head}</span>${chip}</div>${table || `<div class="secondary">${esc(L('Введите показания пучков.', 'Enter the beam readings.'))}</div>`}${checksReadoutHtml(j, checkComp.items)}</div>`;
  $('#js-mobile-value').textContent = rows.length ? L(`в допуске ${okN}, вне ${outN}, ошибок ${errN}`, `ok ${okN}, out ${outN}, errors ${errN}`) : '—';
  // замечания сеанса
  const msgs = [];
  for (const d of equipmentDue(j, s.date || today())) {
    msgs.push(['warn', d.status === 'overdue' ? L(`${d.text}: срок калибровки прошёл (${fmtDate(d.dueDate)}).`, `${d.text}: calibration overdue (${fmtDate(d.dueDate)}).`) : L(`${d.text}: срок калибровки ${fmtDate(d.dueDate)}, осталось ${d.days} дн.`, `${d.text}: calibration due ${fmtDate(d.dueDate)}, ${d.days} days left.`)]);
  }
  if (draft.id) msgs.push(['info', L('Редактируется сеанс, уже записанный в журнал: «Записать сеанс в журнал» заменит его.', 'A session already in the journal is being edited: "Record the session in the journal" will replace it.')]);
  if (errN) msgs.push(['warn', L('Пучки с ошибками в журнал не записываются — исправьте их или снимите отметку у пучка.', 'Beams with errors are not recorded in the journal: fix them or clear the beam checkbox.')]);
  msgs.push(...checkPanelMessages(j, checkComp));
  $('#js-messages').innerHTML = msgs.length
    ? msgs.map(([lvl, t]) => `<li class="${lvl}"><span class="lvl">${esc(lvlName()[lvl])}</span><span>${richText(t)}</span></li>`).join('')
    : `<li class="info"><span class="lvl">${esc(L('Всё в порядке', 'All clear'))}</span><span>${esc(L('Сроки калибровки камер и электрометров в порядке.', 'Chamber and electrometer calibrations are within their dates.'))}</span></li>`;
  renderSignBlock($('#js-sign'), s.staff);
  notifyUpdate(ROOT());
}

function onEdit() {
  readDraft();
  draft.dirty = true;
  saveDraft();
  renderResults();
}

/** В сеансе есть показания, не записанные в журнал (для подтверждения перед открытием другого сеанса). */
export const sessionUnsaved = () => !!draft.dirty && (Object.values(draft.beams).some((b) => hasValues(b?.rd_M1) || hasValues(b?.e_M1) || hasValues(b?.co_M1)) || (draft.checks || []).some((c) => hasValues(c.M)));

// ------------------------------------------------------------ действия
function record() {
  readDraft();
  const j = getJournal();
  const s = sessionObject();
  if (!s.id) s.id = uid('s');
  // в журнал — только пучки с результатом без ошибок
  const live = computed.filter((c) => c.input.include !== false && c.calc);
  const okIds = new Set(live.filter((c) => c.started && c.calc.summary.ok).map((c) => c.input.beamId));
  s.beams = s.beams.filter((b) => okIds.has(b.beamId));
  if (!s.beams.length) {
    const started = live.filter((c) => c.started).length;
    setStatus(
      !computed.length
        ? L('Записывать нечего: у аппарата нет пучков в сеансе.', 'Nothing to record: the machine has no beams in the session.')
        : !live.length
          ? L('Записывать нечего: у всех пучков снята отметка участия в сеансе.', 'Nothing to record: all beams are excluded from the session.')
        : !started
          ? L('Записывать нечего: введите показания хотя бы одного пучка.', 'Nothing to record: enter the readings of at least one beam.')
          : L('Записывать нечего: у всех пучков с показаниями есть ошибки — они перечислены под каждым пучком.', 'Nothing to record: every beam with readings has errors, listed under each beam.'),
    );
    return;
  }
  const fin = finalizeSession(j, s);
  // проверки дозиметра — по рабочей камере своего пучка, только у записанных пучков
  const works = new Map(computed.filter((c) => okIds.has(c.input.beamId)).map((c) => [c.input.beamId, c.calc]));
  const chk = finalizeChecks(j, fin, draft.checks || [], works);
  if (chk.checks.length) fin.checks = chk.checks;
  else delete fin.checks;
  setJournal(upsertSession(j, fin), 'session');
  draft.id = fin.id;
  draft.dirty = false;
  // записанные проверки считаются дальше по своей форме (как пучки открытого сеанса)
  draft.checks = (draft.checks || []).map((c) => chk.checks.find((x) => x.id === c.id) ?? c);
  saveDraft();
  renderChecks();
  renderResults();
  const skipped = live.filter((c) => c.started && !okIds.has(c.input.beamId)).map((c) => c.calc.beam.name);
  const chkText = chk.checks.length || chk.skipped
    ? L(`; проверок дозиметра: ${chk.checks.length}${chk.skipped ? `, не записаны из-за ошибок: ${chk.skipped}` : ''}`, `; dosimeter checks: ${chk.checks.length}${chk.skipped ? `, not recorded because of errors: ${chk.skipped}` : ''}`)
    : '';
  setStatus(
    L(
      `Сеанс записан в журнал (пучков: ${fin.beams.length})${skipped.length ? `; не записаны из-за ошибок: ${skipped.join(', ')}` : ''}${chkText}. Сохраните журнал в файл — кнопка «Сохранить журнал» ниже.`,
      `The session has been recorded in the journal (${fin.beams.length} beams)${skipped.length ? `; not recorded because of errors: ${skipped.join(', ')}` : ''}${chkText}. Save the journal to the file with the "Save journal" button below.`,
    ),
  );
}

function newSession() {
  const keep = { machineId: draft.machineId, mode: draft.mode, staff: draft.staff, env: { ...draft.env, T: '', P: '', H: '' } };
  draft = { id: '', date: today(), notes: '', beams: {}, checks: [], dirty: false, ...keep };
  saveDraft();
  writeHead();
  renderBeams();
  renderResults();
}

/** Открыть записанный сеанс для просмотра и правки (из «Журнала и трендов»): считается по записанным в нём настройкам. */
export function loadSession(s) {
  draft = {
    id: s.id,
    machineId: s.machineId,
    date: s.date,
    mode: s.mode === 'check' ? 'check' : 'cal',
    staff: s.staff?.length ? s.staff : [''],
    notes: s.notes || '',
    env: { ...draft.env, ...(s.env || {}) },
    beams: Object.fromEntries(
      s.beams.map((b) => {
        const { form, summary, ...input } = b;
        return [b.beamId, { ...input, include: true, ...(form ? { base: recordedBase(form, b.kind) } : {}) }];
      }),
    ),
    // проверки дозиметра — с записанной формой второй камеры
    checks: (s.checks || []).map((c) => ({ ...c, M: [...(c.M || [])], Mopp: [...(c.Mopp || [])], M2: [...(c.M2 || [])] })),
    // камера и электрометр сеанса — которыми мерили (для пересчёта по текущему «Оборудованию»)
    equip: Object.fromEntries([
      ...KIND_ORDER.map((k) => [k, s.beams.find((b) => beamKind(b) === k && b.chamberId)?.chamberId ?? '']),
      ['el', s.beams.find((b) => b.electrometerId)?.electrometerId ?? ''],
    ]),
    dirty: false,
  };
  // протокол — тот, по которому сеанс записан
  const proto = s.protocol === 'tg51' ? 'tg51' : 'trs';
  const switched = proto !== currentProtocol();
  if (switched) applyProtocol(proto);
  saveDraft();
  writeHead();
  renderBeams();
  renderResults();
  setStatus(
    L(
      `Открыт сеанс от ${fmtDate(s.date)}${switched ? `; протокол в шапке переключён на ${proto === 'tg51' ? 'TG-51' : 'TRS-398'} — по нему сеанс записан` : ''}. Изменения попадут в журнал после «Записать сеанс в журнал».`,
      `Session of ${fmtDate(s.date)} opened${switched ? `; the header protocol has been switched to ${proto === 'tg51' ? 'TG-51' : 'TRS-398'}, the one the session was recorded with` : ''}. Changes go to the journal after "Record the session in the journal".`,
    ),
  );
}

/** Убрать у пучка черновика всё, что пришло из записанного сеанса: настройки, камеру и электрометр сеанса. */
function dropRecorded(d) {
  delete d.base;
  delete d.chamberId;
  delete d.electrometerId;
}

/** Считать сеанс по текущему «Оборудованию» вместо записанных в нём настроек. */
/** Проверке дозиметра — то же: вторая камера и электрометр снова из «Оборудования». */
function dropRecordedCheck(c) {
  delete c.form;
  delete c.summary;
}

function useCurrentEquipment() {
  readDraft();
  for (const d of Object.values(draft.beams)) dropRecorded(d);
  for (const c of draft.checks || []) dropRecordedCheck(c);
  draft.dirty = true;
  saveDraft();
  renderBeams();
  renderResults();
  setStatus(L('Сеанс пересчитан по текущему «Оборудованию». В журнал изменения попадут после «Записать сеанс в журнал».', 'The session has been recalculated with the current Equipment. The changes go to the journal after "Record the session in the journal".'));
}

function reportText() {
  const s = compute();
  const j = getJournal();
  const m = machineOf(j, s.machineId);
  const tg = s.protocol === 'tg51';
  const out = [];
  out.push(L('СЕАНС НА ВЕСЬ АППАРАТ', 'WHOLE-MACHINE SESSION'));
  out.push(`${L('Учреждение', 'Institution')}: ${j.institution || '—'}`);
  if (String(j.department || '').trim()) out.push(`${L('Подразделение', 'Department')}: ${j.department}`);
  out.push(`${L('Аппарат', 'Machine')}: ${[m?.name, m?.serial ? `${L('№', 'S/N')} ${m.serial}` : ''].filter(Boolean).join(', ') || '—'}`);
  const coOnly = computed.length > 0 && computed.every((c) => c.kind === 'cobalt');
  out.push(`${L('Дата', 'Date')}: ${fmtDate(s.date)}; ${L('режим', 'mode')}: ${s.mode === 'cal' ? L('калибровка', 'calibration') : coOnly ? L('проверка выхода (k_pol, k_s и τ из последней калибровки)', 'output check (k_pol, k_s and τ from the last calibration)') : L('проверка выхода (k_pol и k_s из последней калибровки)', 'output check (k_pol and k_s from the last calibration)')}; ${L('протокол', 'protocol')}: ${tg ? 'TG-51' : 'TRS-398 Rev.1'}`);
  out.push(`${L('Сотрудники', 'Staff')}: ${s.staff.filter((x) => x.trim()).join(', ') || '—'}`);
  out.push(`${L('Общие условия', 'Common conditions')}: T = ${s.env.T || '—'} °C; P = ${s.env.P || '—'} ${unitLabel(PRESSURE_UNITS[s.env.P_unit] || PRESSURE_UNITS.kPa)}${s.env.H ? `; ${L('влажность', 'humidity')} ${s.env.H} %` : ''}`);
  out.push('');
  for (const { input, calc, started } of computed) {
    if (input.include === false || !calc || !started) continue;
    const sum = calc.summary;
    const cert = certText(calc.chamber);
    out.push(`${calc.beam.name}: ${chamberText(calc.chamber)}${cert ? ` (${cert})` : ''}; ${electrometerText(calc.electrometer)}`);
    if (sum.hasValue) {
      if (!sum.ok) out.push(`  ${L('Есть ошибки: пучок не записан в журнал', 'There are errors: the beam is not recorded in the journal')}`);
      const co = calc.kind === 'cobalt';
      const [vTxt, vUnit] = valueText(sum, calc.kind);
      out.push(`  ${co ? L('Мощность дозы', 'Dose rate') : L('Доза', 'Dose')}: ${vTxt} ${vUnit} ${atText(sum)}${Number.isFinite(sum.deviation) ? `; ${co ? L('от ожидаемой', 'from expected') : L('от номинала', 'from nominal')} ${fmtSigned(sum.deviation, 2)} % (${sum.status === 'out' ? L('вне допуска', 'out of tolerance') : L('в допуске', 'within tolerance')} ±${fmt(sum.tol, sum.tol % 1 ? 1 : 0)} %)` : ''}`);
      const tm = calc.result.timer;
      const tauTxt = co && tm && tm.mode !== 'window' && tm.mode !== 'none' ? `; τ = ${fmt(tm.tau, 4)} ${timeUnit(calc.form)}` : co && tm?.mode === 'window' ? L('; заряд при выдвинутом источнике', '; charge with the source exposed') : '';
      out.push(`  ${tg ? 'P_pol' : 'k_pol'} = ${fmt(sum.kpolRaw, 4)}; ${tg ? 'P_ion' : 'k_s'} = ${fmt(sum.ksRaw, 4)}${sum.ksFixed ? ` (${[L('из калибровки', 'from the calibration'), calc.form[beamKeys(calc.kind).fixedFrom]].filter(Boolean).join(' ')})` : ''}${tauTxt}${co ? '' : `; ${sum.kQName || 'k_Q'} = ${fmt(sum.kQ, 4)}`}${Number.isFinite(sum.quality) ? `; ${qualityText(sum, calc.kind, tg)}` : ''}`);
      if (co && comparisonText(calc)) out.push(`  ${comparisonText(calc).replace(/^./, (x) => x.toUpperCase())}`);
    } else out.push(`  ${L('Нет результата: есть ошибки', 'No result: there are errors')}`);
    for (const msg of calc.result.messages.filter((x) => x.level !== 'info')) out.push(`  - ${msg.text}`);
  }
  out.push(...checkReportLines(j, checkComp, { tg }));
  if (s.notes) out.push('', `${L('Примечания', 'Notes')}: ${s.notes}`);
  out.push('', `${L('Калькулятор референсной дозиметрии', 'Reference dosimetry calculator')}, ${versionText()}`);
  return out.join('\n');
}

export function sessionStatus(text) {
  setStatus(text);
}

export function initSession() {
  setStatus = makeStatus($('#js-status'));
  $('#js_P_unit').innerHTML = Object.entries(PRESSURE_UNITS).map(([k, u]) => `<option value="${k}">${unitLabel(u)}</option>`).join('');
  loadDraft();
  if (!draft.date) draft.date = today();
  writeHead();
  renderBeams();
  renderResults();
  setupFilePanel($('#js-file'), (t) => setStatus(t));
  $$('#js-sheet > section .combo').forEach((c) => makeCombo(c));

  const sheet = $('#js-sheet');
  // аппарат и режим обрабатываются по change (новый сеанс); их input пришёл бы раньше и пометил сеанс изменённым
  sheet.addEventListener('input', (e) => {
    if (e.target.id === 'js_machine' || e.target.name === 'js_mode') return;
    onEdit();
  });
  sheet.addEventListener('change', (e) => {
    // камера или электрометр сеанса: подписи и расчёт всех пучков
    if (e.target.closest('#js-equip')) {
      readDraft();
      draft.dirty = true;
      saveDraft();
      renderBeams();
      renderResults();
      return;
    }
    if (e.target.id === 'js_machine' || e.target.name === 'js_mode') {
      // другой аппарат или режим — это новый сеанс: записанный остаётся в журнале как есть
      const wasRecorded = !!draft.id;
      const clean = wasRecorded && !draft.dirty;
      readDraft();
      // камера и электрометр другого аппарата — по умолчанию для него
      if (e.target.id === 'js_machine') draft.equip = {};
      if (wasRecorded) {
        draft.id = '';
        // показания записанного сеанса не переносятся в новый, иначе его легко записать второй раз
        if (clean) {
          draft.beams = {};
          draft.checks = [];
        } else {
          for (const d of Object.values(draft.beams)) dropRecorded(d);
          for (const c of draft.checks || []) dropRecordedCheck(c);
        }
        setStatus(
          clean
            ? L('Начат новый сеанс: записанный остаётся в журнале без изменений, показания очищены.', 'A new session has been started: the recorded one stays in the journal unchanged; readings cleared.')
            : L('Начат новый сеанс: записанный ранее остаётся в журнале без изменений.', 'A new session has been started: the one recorded earlier stays in the journal unchanged.'),
        );
      }
      saveDraft();
      renderBeams();
      renderResults();
      return;
    }
    // другой пучок, камера или электрометр проверки: записанная форма второй камеры к ней уже не относится, а состав
    // полей карточки (k_vol у БВФ, список камер) мог измениться
    const ck = e.target.closest('.jsc [data-ck]');
    if (ck && resetsRecorded(ck.dataset.ck)) {
      readDraft();
      const c = draft.checks.find((x) => x.id === e.target.closest('.jsc').dataset.check);
      if (c) {
        dropRecordedCheck(c);
        if (ck.dataset.ck === 'beamId') {
          const j = getJournal();
          const b = machineOf(j, draft.machineId)?.beams.find((x) => x.id === c.beamId);
          // вторая камера должна годиться для нового пучка и не быть его рабочей
          const list = b ? secondChambers(j, b, draft.beams[b.id]) : [];
          if (!list.some((x) => x.id === c.chamberId)) c.chamberId = list[0]?.id ?? '';
        }
      }
      draft.dirty = true;
      saveDraft();
      renderChecks();
      renderResults();
      return;
    }
    onEdit();
  });
  sheet.addEventListener('click', (e) => {
    // «раздел N фотонов» в замечаниях пучка: пучок открывается на вкладке дозиметрии сразу на этом разделе
    const sl = e.target.closest('a.sec-link[data-sec-beam]');
    if (sl) {
      e.preventDefault();
      const c = computed.find((x) => x.input.beamId === sl.dataset.secBeam);
      if (c?.calc) bridge.openInTab(c.kind, c.calc.form, `${c.calc.machine.name} — ${c.calc.beam.name}, ${fmtDate(draft.date)}`, sl.dataset.secNo);
      return;
    }
    if (e.target.closest('#js-btn-current')) {
      useCurrentEquipment();
      return;
    }
    const rm = e.target.closest('[data-ck-remove]');
    if (rm) {
      readDraft();
      draft.checks = draft.checks.filter((c) => c.id !== rm.dataset.ckRemove);
      draft.dirty = true;
      saveDraft();
      renderChecks();
      renderResults();
      return;
    }
    const g = e.target.closest('[data-goto-eq]');
    if (g) {
      bridge.openEquipment(g.dataset.gotoEq);
      return;
    }
    const b = e.target.closest('[data-open-tab]');
    if (!b) return;
    const c = computed.find((x) => x.input.beamId === b.dataset.openTab);
    if (c?.calc) bridge.openInTab(c.kind, c.calc.form, `${c.calc.machine.name} — ${c.calc.beam.name}, ${fmtDate(draft.date)}`);
  });
  $('#js-btn-add-staff').addEventListener('click', () => {
    const cur = readStaff($('#js-staff-list'));
    cur.push('');
    renderStaff($('#js-staff-list'), cur, onEdit);
    onEdit();
  });
  $('#js-btn-record').addEventListener('click', record);
  $('#js-btn-add-check').addEventListener('click', () => {
    readDraft();
    const j = getJournal();
    const c = addCheck(j, activeBeams(machineOf(j, draft.machineId)), draft.beams);
    if (!c) return;
    draft.checks = [...(draft.checks || []), c];
    saveDraft();
    renderChecks();
    renderResults();
    document.getElementById(`jsc-${c.id}-chamberId`)?.focus();
  });
  armButton($('#js-btn-new'), () => L('Новый сеанс', 'New session'), () => L('Нажмите ещё раз: показания очистятся', 'Click again: readings will be cleared'), () => {
    newSession();
    setStatus(L('Начат новый сеанс: аппарат, режим и сотрудники сохранены, показания очищены.', 'A new session started: machine, mode and staff kept, readings cleared.'));
  });
  $('#js-btn-copy').addEventListener('click', () => copyText(reportText(), L('Протокол сеанса скопирован.', 'The session report has been copied.'), setStatus));
  $('#js-btn-pdf').addEventListener('click', () => printToPdf([L('Сеанс', 'Session'), machineOf(getJournal(), draft.machineId)?.name, draft.date].filter(Boolean).join('_'), setStatus));
  $('#js-btn-print').addEventListener('click', () => window.print());
  document.addEventListener('change', (e) => {
    // поля качества пучка и подписи поправок зависят от протокола; черновик уже актуален (onEdit)
    if (e.target.name === 'protocol') {
      renderBeams();
      renderResults();
    }
  });
  onJournal(({ source, journal }) => {
    if (source === 'session') return;
    // сеанс, который здесь правят, удалили из журнала: запись станет новым сеансом
    if (draft.id && !journal.sessions.some((x) => x.id === draft.id)) {
      draft.id = '';
      saveDraft();
    }
    // правка «Оборудования» — сразу в карточки пучков (названия, камера, V₁), а не только в расчёт
    writeHead();
    renderBeams();
    renderResults();
  });
  document.addEventListener('langchange', () => {
    readDraft();
    $('#js_P_unit').innerHTML = Object.entries(PRESSURE_UNITS).map(([k, u]) => `<option value="${k}">${unitLabel(u)}</option>`).join('');
    writeHead();
    renderBeams();
    renderResults();
  });
}
