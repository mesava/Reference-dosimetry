// «Журнал» → «Оборудование»: учреждение и подразделение, ускорители с пучками фотонов и электронов, аппараты ⁶⁰Co, электрометры,
// камеры. Всё хранится в журнале. У пучка здесь — только название (и признак БВФ); мерят во вкладке дозиметрии (пучок
// журнала выбирается в её разделе 1, tab-journal-ui.js), настройки пучка редактируются там же и возвращаются в журнал.
import { L } from '../core/i18n.js';
import { CHAMBERS, chamberNote, findChamber } from '../core/chambers.js';
import { ELECTROMETERS, OTHER as EL_OTHER, parseElectrometer, electrometerName } from '../core/electrometers.js';
import { NDW_UNITS, unitLabel, isBlank } from '../core/units.js';
import { FORM_DEFAULTS, normalizeForm } from '../core/photons.js';
import { E_DEFAULTS, normalizeElectrons, parseElectronBeam } from '../core/electrons.js';
import { E_CHAMBERS, findEChamber } from '../core/electron-chambers.js';
import { CO_DEFAULTS, normalizeCobalt } from '../core/cobalt.js';
import {
  uid, CHAMBER_DEFAULTS, ELECTROMETER_DEFAULTS, MACHINE_DEFAULTS, BEAM_DEFAULTS, chamberText, electrometerText, saveBeamSettings, equipmentDue,
  chamberMissing, electrometerMissing, chamberUses, photonCapable, electronCapable, electronChamberForm, beamKind, cobaltCapable, cobaltChamberForm, myChambersToJournal, orgText, withChamberLength,
} from '../core/journal.js';
import { getMyChambers } from './store.js';
import { $, esc, fmt, makeStatus, armButton, notifyUpdate, today, richText, currentProtocol, plainSymbols } from './common.js';
import { localizeDecimals } from './i18n.js';
import { getJournal, updateJournal, onJournal } from './journal-store.js';
import { setupFilePanel, dueChip, fmtDate, countWord } from './journal-common.js';

let setStatus = () => {};
let tabBridge = { edit: () => {} };
/** Связь с вкладками дозиметрии: edit(kind, form, { title, target }) — пучок журнала во вкладке. */
export const setEquipmentBridge = (b) => (tabBridge = { ...tabBridge, ...b });

const ROOT = () => $('#module-equipment');
const val = (v) => esc(v ?? '');
const fieldId = (kind, id, path) => `eq-${kind}-${id}-${path.replace(/\./g, '-')}`;
const bind = (kind, id, path) => `id="${fieldId(kind, id, path)}" data-bind="${kind}|${id}|${path}"`;

/** Поле ввода. */
function input(kind, id, path, value, { num = false, type = 'text', placeholder = '' } = {}) {
  return `<input type="${type}" ${bind(kind, id, path)}${num ? ' class="num" inputmode="decimal"' : ''} value="${val(value)}"${placeholder ? ` placeholder="${val(placeholder)}"` : ''}>`;
}
function select(kind, id, path, value, options) {
  return `<select ${bind(kind, id, path)}>${options.map(([v, t]) => `<option value="${val(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(plainSymbols(t))}</option>`).join('')}</select>`;
}
function check(kind, id, path, value, label) {
  return `<label class="check"><input type="checkbox" ${bind(kind, id, path)}${value ? ' checked' : ''}> <span>${label}</span></label>`;
}
const field = (label, control, { forId = '', sub = '', cls = '' } = {}) =>
  `<div class="field ${cls}"><label${forId ? ` for="${forId}"` : ''}>${label}</label>${control}${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;

/** Отметка «не заполнено: …» в заголовке карточки. */
const missChip = (miss) => (miss.length ? `<span class="chip warn">${richText(L(`не заполнено: ${miss.join(', ')}`, `missing: ${miss.join(', ')}`))}</span>` : '');

// ------------------------------------------------------------ камеры
const OTHER_MAKER = 'other';
/** Производители камер: из базы фотонов и плоскопараллельных камер базы электронов. */
const chamberMakers = () => [...new Set([...CHAMBERS.map((c) => c.maker), ...E_CHAMBERS.filter((c) => c.type === 'pp').map((c) => c.maker)])];
/** Производитель камеры записи: выбранный в карточке или по модели; «Другая», своя — 'other'. */
function chamberMakerOf(c) {
  const m = c.form?.ch_model ?? '';
  if (m === 'OTHER' || m === 'CUSTOM' || String(m).startsWith('MY:')) return OTHER_MAKER;
  return findChamber(m)?.maker ?? findEChamber(m)?.maker ?? c.maker ?? '';
}
/** Модели камер производителя: камеры базы фотонов, затем плоскопараллельные (для электронов и ⁶⁰Co). */
function chamberModels(maker) {
  if (maker === OTHER_MAKER) return [];
  const cyl = CHAMBERS.filter((c) => c.maker === maker).map((c) => [c.id, `${c.model}${c.note ? ` — ${plainSymbols(chamberNote(c))}` : ''}`]);
  const pp = E_CHAMBERS.filter((c) => c.type === 'pp' && c.maker === maker).map((c) => [c.id, `${c.model} — ${L('плоскопараллельная, для электронов и ⁶⁰Co', 'plane-parallel, for electrons and ⁶⁰Co')}`]);
  return [...cyl, ...pp];
}
function makerOptions(makers, cur, otherText) {
  return [`<option value="">${esc(L('— производитель —', '— manufacturer —'))}</option>`, ...makers.map((m) => `<option value="${esc(m)}"${m === cur ? ' selected' : ''}>${esc(m)}</option>`), `<option value="${OTHER_MAKER}"${cur === OTHER_MAKER ? ' selected' : ''}>${esc(otherText)}</option>`].join('');
}
function chamberModelOptions(maker, cur) {
  if (maker === OTHER_MAKER) {
    const opts = [['OTHER', L('Другая камера — для электронов и ⁶⁰Co, k_Q вручную', 'Other chamber: for electrons and ⁶⁰Co, k_Q entered manually')]];
    if (cur === 'CUSTOM') opts.push(['CUSTOM', L('Своя камера (из вкладки «МВ фотоны»)', 'Custom chamber (from the MV photons tab)')]);
    return opts.map(([v, t]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(plainSymbols(t))}</option>`).join('');
  }
  const list = chamberModels(maker);
  const head = list.some(([v]) => v === cur) ? '' : `<option value="" selected>${esc(L('— модель —', '— model —'))}</option>`;
  return head + list.map(([v, t]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`).join('');
}
/** Размеры полости камеры из базы — подпись под моделью. */
function chamberDims(f) {
  const ph = findChamber(f.ch_model);
  const ec = findEChamber(f.ch_model);
  const r = ph?.rCavMm ?? ec?.rCavMm ?? ec?.trsRcylMm;
  const len = ph?.lengthMm;
  const parts = [];
  if (Number.isFinite(r)) parts.push(L(`радиус полости ${fmt(r, 2)} мм`, `cavity radius ${fmt(r, 2)} mm`));
  if (Number.isFinite(len)) parts.push(L(`длина ${fmt(len, 1)} мм`, `length ${fmt(len, 1)} mm`));
  return parts.length ? L(`из базы: ${parts.join(', ')}`, `from the database: ${parts.join(', ')}`) : '';
}

/** Камера или электрометр есть в записях журнала (измерения и проверки второй камерой): такие не удаляются. */
function usedInRecords(j, key, id) {
  return (j.sessions || []).some((s) => (s.beams || []).some((b) => b[key] === id) || (s.checks || []).some((c) => c[key] === id || (key === 'chamberId' && c.summary?.workChamberId === id)));
}
const RECORDS_TITLE = () => L('Есть в записях журнала: записи ссылаются на эту запись оборудования (протокол, карты пар камер)', 'Used in journal records: they refer to this equipment entry (report, chamber pair charts)');

function chamberCard(c, j = getJournal()) {
  const f = c.form || {};
  const k = 'chamber';
  const custom = f.ch_model === 'CUSTOM';
  const other = f.ch_model === 'OTHER';
  const ph = photonCapable(f);
  const el = electronCapable(f);
  const phCross = ph && f.ch_cal_route === 'cross';
  const elCross = el && f.e_cal_route === 'cross';
  const uses = chamberUses(j, c.id);
  // N_D,w в ⁶⁰Co нужен, если хоть для одного вида пучков камера калибруется в ⁶⁰Co, если она выбрана у пучка ⁶⁰Co
  // (или модель ещё не выбрана)
  const needNdw = isBlank(f.ch_model) || (ph && !phCross) || (el && !elCross) || uses.cobalt;
  const units = Object.entries(NDW_UNITS).map(([v, u]) => [v, unitLabel(u)]);
  const maker = chamberMakerOf(c);
  return `<div class="jcard" data-card="chamber:${esc(c.id)}">
    <div class="jcard-head"><b>${esc(chamberText(c) || L('Новая камера', 'New chamber'))}</b><span class="chips">${missChip(chamberMissing(c, uses, currentProtocol()))}${dueChip(c.dueDate)}</span></div>
    <div class="grid">
      ${field(L('Производитель', 'Manufacturer'), `<select ${bind(k, c.id, 'maker')}>${makerOptions(chamberMakers(), maker, L('Другая или своя камера', 'Other or custom chamber'))}</select>`, { forId: fieldId(k, c.id, 'maker') })}
      ${maker ? field(L('Модель', 'Model'), `<select ${bind(k, c.id, 'form.ch_model')}>${chamberModelOptions(maker, f.ch_model)}</select>`, { forId: fieldId(k, c.id, 'form.ch_model'), sub: [custom ? esc([f.cc_maker, f.cc_model].filter(Boolean).join(' ')) : '', ph && el ? esc(L('для фотонов, электронов и ⁶⁰Co', 'for photons, electrons and ⁶⁰Co')) : el ? esc(L('для электронов и ⁶⁰Co', 'for electrons and ⁶⁰Co')) : ph ? esc(L('для фотонов и ⁶⁰Co', 'for photons and ⁶⁰Co')) : '', esc(chamberDims(f))].filter(Boolean).join(' · ') }) : ''}
      ${field(L('Заводской №', 'Serial No.'), input(k, c.id, 'form.ch_serial', f.ch_serial), { forId: fieldId(k, c.id, 'form.ch_serial') })}
      ${ph && !custom ? field(L('Длина полости, мм', 'Cavity length, mm'), input(k, c.id, 'length', c.length, { num: true, placeholder: Number.isFinite(findChamber(f.ch_model)?.lengthMm) ? fmt(findChamber(f.ch_model).lengthMm, 1) : '' }), { forId: fieldId(k, c.id, 'length'), sub: Number.isFinite(findChamber(f.ch_model)?.lengthMm) ? L('для k<sub>vol</sub> в пучках БВФ; пусто — из базы (TRS-398 Rev.1, табл. 4)', 'for k<sub>vol</sub> in FFF beams; blank: from the database (TRS-398 Rev.1, Table 4)') : L('для k<sub>vol</sub> в пучках БВФ: в базе длины нет — возьмите из паспорта камеры', 'for k<sub>vol</sub> in FFF beams: the database has no length; take it from the chamber datasheet') }) : ''}
      ${other
        ? `${field(L('Название', 'Name'), input(k, c.id, 'form.e_other_name', f.e_other_name), { forId: fieldId(k, c.id, 'form.e_other_name') })}
          ${field(L('Тип', 'Type'), select(k, c.id, 'form.e_other_type', f.e_other_type || 'pp', [['pp', L('плоскопараллельная', 'plane-parallel')], ['cyl', L('цилиндрическая', 'cylindrical')]]), { forId: fieldId(k, c.id, 'form.e_other_type') })}
          ${f.e_other_type === 'cyl' ? field(L('Радиус полости, мм', 'Cavity radius, mm'), input(k, c.id, 'form.e_other_r', f.e_other_r, { num: true }), { forId: fieldId(k, c.id, 'form.e_other_r') }) : ''}`
        : ''}
      ${ph ? field(L('Калибровка для фотонов', 'Calibration for photons'), select(k, c.id, 'form.ch_cal_route', f.ch_cal_route || 'co60', [['co60', L('N_D,w в пучке ⁶⁰Co', 'N_D,w in a ⁶⁰Co beam')], ['cross', L('перекрёстная в пучке МВ фотонов (TRS-398)', 'cross-calibration in an MV photon beam (TRS-398)')]]), { forId: fieldId(k, c.id, 'form.ch_cal_route'), cls: el ? '' : 'span-2' }) : ''}
      ${el ? field(L('Калибровка для электронов', 'Calibration for electrons'), select(k, c.id, 'form.e_cal_route', f.e_cal_route || 'co60', [['co60', L('N_D,w в пучке ⁶⁰Co', 'N_D,w in a ⁶⁰Co beam')], ['cross', L('перекрёстная в пучке электронов', 'cross-calibration in an electron beam')]]), { forId: fieldId(k, c.id, 'form.e_cal_route'), cls: ph ? '' : 'span-2' }) : ''}
      ${needNdw
        ? `${field('N<sub>D,w</sub> (⁶⁰Co)', input(k, c.id, 'form.ch_ndw', f.ch_ndw, { num: true }), { forId: fieldId(k, c.id, 'form.ch_ndw') })}
          ${field(L('Единицы', 'Units'), select(k, c.id, 'form.ch_ndw_unit', f.ch_ndw_unit || 'Gy/nC', units), { forId: fieldId(k, c.id, 'form.ch_ndw_unit') })}
          ${field(L('k<sub>лаб</sub>', 'k<sub>lab</sub>'), input(k, c.id, 'form.ch_klab', f.ch_klab ?? '1,000', { num: true }), { forId: fieldId(k, c.id, 'form.ch_klab'), sub: L('поправочный множитель из протокола поверки; обычно 1,000', 'correction multiplier from the calibration certificate; usually 1.000') })}`
        : ''}
      ${phCross
        ? `${field(L('N<sub>D,w,Qcross</sub> — фотоны', 'N<sub>D,w,Qcross</sub>: photons'), input(k, c.id, 'form.ch_cross_ndw', f.ch_cross_ndw, { num: true }), { forId: fieldId(k, c.id, 'form.ch_cross_ndw'), sub: L('TRS-398, ур. 27; из «Камеры и пучка»', 'TRS-398, Eq. 27; from Chamber and beam') })}
          ${field(L('Единицы', 'Units'), select(k, c.id, 'form.ch_cross_ndw_unit', f.ch_cross_ndw_unit || 'Gy/nC', units), { forId: fieldId(k, c.id, 'form.ch_cross_ndw_unit') })}
          ${field(L('TPR<sub>20,10</sub> пучка калибровки', 'TPR<sub>20,10</sub> of the calibration beam'), input(k, c.id, 'form.ch_cross_tpr', f.ch_cross_tpr, { num: true }), { forId: fieldId(k, c.id, 'form.ch_cross_tpr'), sub: L('k<sub>Q,Qcross</sub> = k<sub>Q</sub>/k<sub>Qcross</sub> (ур. 30)', 'k<sub>Q,Qcross</sub> = k<sub>Q</sub>/k<sub>Qcross</sub> (Eq. 30)') })}`
        : ''}
      ${elCross
        ? `${field(L('N<sub>D,w,Qcross</sub> — электроны (TRS-398)', 'N<sub>D,w,Qcross</sub>: electrons (TRS-398)'), input(k, c.id, 'form.e_cross_ndw', f.e_cross_ndw, { num: true }), { forId: fieldId(k, c.id, 'form.e_cross_ndw'), sub: L('ур. 41; из «Камеры и пучка»', 'Eq. 41; from Chamber and beam') })}
          ${field(L('Единицы', 'Units'), select(k, c.id, 'form.e_cross_ndw_unit', f.e_cross_ndw_unit || 'Gy/nC', units), { forId: fieldId(k, c.id, 'form.e_cross_ndw_unit') })}
          ${field(L('R<sub>50</sub> пучка калибровки, г/см²', 'R<sub>50</sub> of the calibration beam, g/cm²'), input(k, c.id, 'form.e_cross_r50', f.e_cross_r50, { num: true }), { forId: fieldId(k, c.id, 'form.e_cross_r50') })}
          ${field(L('(k<sub>Qecal</sub>·N<sub>D,w</sub>)<sub>pp</sub> — электроны (Report 385)', '(k<sub>Qecal</sub>·N<sub>D,w</sub>)<sub>pp</sub>: electrons (Report 385)'), input(k, c.id, 'form.e_cross_kn', f.e_cross_kn, { num: true }), { forId: fieldId(k, c.id, 'form.e_cross_kn'), sub: L('ур. 5; для TG-51', 'Eq. 5; for TG-51') })}
          ${field(L('Единицы', 'Units'), select(k, c.id, 'form.e_cross_kn_unit', f.e_cross_kn_unit || 'Gy/nC', units), { forId: fieldId(k, c.id, 'form.e_cross_kn_unit') })}`
        : ''}
      ${field('T₀, °C', input(k, c.id, 'form.ch_T0', f.ch_T0 ?? '20', { num: true }), { forId: fieldId(k, c.id, 'form.ch_T0') })}
      ${field(L('P₀, кПа', 'P₀, kPa'), input(k, c.id, 'form.ch_P0', f.ch_P0 ?? '101,325', { num: true }), { forId: fieldId(k, c.id, 'form.ch_P0') })}
    </div>
    <h4 class="sub-h">${esc(L('Свидетельство о калибровке', 'Calibration certificate'))}</h4>
    <div class="grid">
      ${field(L('Лаборатория', 'Laboratory'), input(k, c.id, 'calLab', c.calLab, { placeholder: L('ВНИИФТРИ', 'SSDL / PSDL') }), { forId: fieldId(k, c.id, 'calLab') })}
      ${field(L('№ свидетельства', 'Certificate No.'), input(k, c.id, 'calCert', c.calCert), { forId: fieldId(k, c.id, 'calCert') })}
      ${field(L('Дата калибровки', 'Calibration date'), input(k, c.id, 'calDate', c.calDate, { type: 'date' }), { forId: fieldId(k, c.id, 'calDate') })}
      ${field(L('Действует до', 'Valid until'), input(k, c.id, 'dueDate', c.dueDate, { type: 'date' }), { forId: fieldId(k, c.id, 'dueDate'), sub: L('за 30 дней до срока появится напоминание', 'a reminder appears 30 days before') })}
      ${field(L('Электрометр при калибровке', 'Electrometer at calibration'), select(k, c.id, 'calEl', c.calEl, [['', L('— не указан —', '— not given —')], ...j.electrometers.map((e) => [e.id, electrometerText(e) || L('электрометр без названия', 'unnamed electrometer')])]), { forId: fieldId(k, c.id, 'calEl'), cls: 'span-2', sub: L('если камеру калибровали вместе с электрометром: с другим электрометром нужен его k<sub>elec</sub> — блок «Журнал» на вкладке дозиметрии об этом напомнит', 'if the chamber was calibrated together with an electrometer: another electrometer needs its own k<sub>elec</sub>; the Journal block of the dosimetry tab will remind you') })}
      ${field(L('Напряжение при калибровке, В', 'Calibration voltage, V'), input(k, c.id, 'calV', c.calV, { num: true, placeholder: '400' }), { forId: fieldId(k, c.id, 'calV') })}
      ${field(L('Полярность при калибровке', 'Calibration polarity'), select(k, c.id, 'calPol', c.calPol, [['', L('— не указана —', '— not given —')], ['+', L('положительная (+)', 'positive (+)')], ['-', L('отрицательная (−)', 'negative (−)')]]), { forId: fieldId(k, c.id, 'calPol') })}
      ${field(L('Примечания', 'Notes'), input(k, c.id, 'notes', c.notes), { forId: fieldId(k, c.id, 'notes'), cls: 'span-2' })}
    </div>
    <div class="row-tools"><button type="button" class="link-btn danger" data-del="chamber:${esc(c.id)}"${usedInRecords(j, 'chamberId', c.id) ? ` disabled title="${esc(RECORDS_TITLE())}"` : ''}>${esc(L('Удалить камеру', 'Delete chamber'))}</button></div>
  </div>`;
}

/** Производитель электрометра записи: выбранный в карточке или по названию модели. */
function electrometerMakerOf(e) {
  const p = parseElectrometer(e.form?.el_model);
  if (p.maker) return p.maker;
  return e.maker ?? '';
}

function electrometerCard(e) {
  const f = e.form || {};
  const k = 'electrometer';
  const maker = electrometerMakerOf(e);
  const parsed = parseElectrometer(f.el_model);
  return `<div class="jcard" data-card="electrometer:${esc(e.id)}">
    <div class="jcard-head"><b>${esc(electrometerText(e) || L('Новый электрометр', 'New electrometer'))}</b><span class="chips">${missChip(electrometerMissing(e))}${dueChip(e.dueDate)}</span></div>
    <div class="grid">
      ${field(L('Производитель', 'Manufacturer'), `<select ${bind(k, e.id, 'maker')}>${makerOptions(ELECTROMETERS.map((g) => g.maker), maker, L('Другой', 'Other'))}</select>`, { forId: fieldId(k, e.id, 'maker') })}
      ${maker === EL_OTHER
        ? field(L('Модель', 'Model'), input(k, e.id, 'form.el_model', f.el_model, { placeholder: L('производитель и модель', 'manufacturer and model') }), { forId: fieldId(k, e.id, 'form.el_model') })
        : maker
          ? field(L('Модель', 'Model'), select(k, e.id, 'form.el_model', f.el_model, [...(parsed.maker === maker ? [] : [['', L('— модель —', '— model —')]]), ...ELECTROMETERS.find((g) => g.maker === maker).models.map((m) => [electrometerName(maker, m), m])]), { forId: fieldId(k, e.id, 'form.el_model') })
          : ''}
      ${field(L('Заводской №', 'Serial No.'), input(k, e.id, 'form.el_serial', f.el_serial), { forId: fieldId(k, e.id, 'form.el_serial') })}
      ${field('k<sub>elec</sub>', input(k, e.id, 'form.el_kelec', f.el_kelec ?? '1,000', { num: true }), { forId: fieldId(k, e.id, 'form.el_kelec'), sub: L('1,000, если камера калибровалась вместе с электрометром', '1.000 if the chamber was calibrated together with the electrometer') })}
      ${field(L('Дата калибровки', 'Calibration date'), input(k, e.id, 'calDate', e.calDate, { type: 'date' }), { forId: fieldId(k, e.id, 'calDate') })}
      ${field(L('Действует до', 'Valid until'), input(k, e.id, 'dueDate', e.dueDate, { type: 'date' }), { forId: fieldId(k, e.id, 'dueDate') })}
      ${field(L('Примечания', 'Notes'), input(k, e.id, 'notes', e.notes), { forId: fieldId(k, e.id, 'notes') })}
    </div>
    <div class="row-tools"><button type="button" class="link-btn danger" data-del="electrometer:${esc(e.id)}"${usedInRecords(getJournal(), 'electrometerId', e.id) ? ` disabled title="${esc(RECORDS_TITLE())}"` : ''}>${esc(L('Удалить электрометр', 'Delete electrometer'))}</button></div>
  </div>`;
}

// ------------------------------------------------------------ пучки
// В «Оборудовании» у пучка — только то, что он есть на аппарате: название (у фотонов — признак БВФ) и участие в
// измерениях. Камера, электрометр и настройки пучка (геометрия, напряжения, МЕ, номинал, пересчёт на d_max, способ k_Q…)
// — во вкладке дозиметрии, где пучок журнала выбирается в разделе 1.
const TAB_OF = { photon: () => L('«МВ фотоны»', 'MV photons'), electron: () => L('«Электроны»', 'Electrons'), cobalt: () => L('«⁶⁰Co»', '⁶⁰Co') };
const BEAM_PLACEHOLDER = { photon: () => L('6 МВ', '6 MV'), electron: () => L('12 МэВ', '12 MeV'), cobalt: () => L('⁶⁰Co, РИП 80 см', '⁶⁰Co, SSD 80 cm') };

function beamCard(j, m, b) {
  const kind = beamKind(b);
  const k = 'beam';
  const id = b.id;
  const f = b.form || {};
  const used = j.sessions.some((s) => s.beams.some((x) => x.beamId === id));
  const sub = {
    photon: L('как в протоколе; «FFF» или «БВФ» в названии ставит отметку сам', 'as in the report; "FFF" in the name sets the checkbox'),
    electron: L('как в протоколе; энергия — по названию', 'as in the report; the energy is taken from the name'),
    cobalt: L('как в протоколе: установка, по которой калибруют аппарат', 'as in the report: the setup used to calibrate the unit'),
  }[kind];
  return `<div class="jbeam jbeam-line${b.active === false ? ' off' : ''}" data-card="beam:${esc(id)}">
    <div class="grid">
      ${field(L('Пучок', 'Beam'), input(k, id, 'name', b.name, { placeholder: BEAM_PLACEHOLDER[kind]() }), { forId: fieldId(k, id, 'name'), sub })}
      <div class="field">${kind === 'photon' ? check(k, id, 'form.meta_fff', f.meta_fff, L('без выравнивающего фильтра (БВФ)', 'flattening-filter-free (FFF)')) : ''}${check(k, id, 'active', b.active !== false, L('используется в измерениях', 'used in measurements'))}</div>
    </div>
    <div class="row-tools">
      <button type="button" class="link-btn" data-edit-tab="${esc(m.id)}:${esc(id)}">${esc(L(`Настройки пучка — во вкладке ${TAB_OF[kind]()}`, `Beam settings: in the ${TAB_OF[kind]()} tab`))}</button>
      <button type="button" class="link-btn danger" data-del="beam:${esc(m.id)}:${esc(id)}"${used ? ` disabled title="${esc(L('Пучок есть в записях журнала: снимите «используется в измерениях», чтобы убрать его из списка пучков вкладок', 'The beam is in journal records: clear "used in measurements" to remove it from the beam list of the tabs'))}"` : ''}>${esc(L('Удалить пучок', 'Delete beam'))}</button>
    </div>
  </div>`;
}

function machineCard(j, m) {
  const k = 'machine';
  const hasSessions = j.sessions.some((s) => s.machineId === m.id);
  const cobalt = m.kind === 'cobalt';
  const has = (kind) => m.beams.some((b) => beamKind(b) === kind);
  // у ускорителя — пучки фотонов и электронов, у аппарата ⁶⁰Co — пучки ⁶⁰Co (установки); чужие пучки видны, если есть
  const linacPart = !cobalt || has('photon') || has('electron');
  const coPart = cobalt || has('cobalt');
  const coBeams = m.beams.filter((b) => beamKind(b) === 'cobalt');
  const coSection = coPart
    ? `<h3 class="sub-h">${esc(L('Пучки ⁶⁰Co', '⁶⁰Co beams'))}</h3>
    <div class="jbeams">${coBeams.map((b) => beamCard(j, m, b)).join('') || `<p class="sub-hint">${esc(L('Пучков пока нет: обычно один — та установка (РИП или РИК), по которой калибруют аппарат.', 'No beams yet: usually one, the setup (SSD or SCD) used to calibrate the unit.'))}</p>`}</div>
    <div class="row-tools">
      <button type="button" class="link-btn" data-add-cobeam="${esc(m.id)}"><span aria-hidden="true">+</span> ${esc(L('Добавить пучок ⁶⁰Co', 'Add a ⁶⁰Co beam'))}</button>
    </div>`
    : '';
  return `<div class="jcard" data-card="machine:${esc(m.id)}">
    <div class="jcard-head"><b>${esc(m.name || (cobalt ? L('Новый аппарат ⁶⁰Co', 'New ⁶⁰Co unit') : L('Новый ускоритель', 'New linac')))}</b><span class="chip none">${esc(cobalt ? L('аппарат ⁶⁰Co', '⁶⁰Co unit') : L('ускоритель', 'linac'))}</span></div>
    <div class="grid">
      ${field(L('Аппарат', 'Machine'), input(k, m.id, 'name', m.name, { placeholder: cobalt ? L('Тератрон', 'Theratron') : 'Elekta Versa HD' }), { forId: fieldId(k, m.id, 'name') })}
      ${field(L('Тип', 'Type'), select(k, m.id, 'kind', cobalt ? 'cobalt' : 'linac', [['linac', L('ускоритель', 'linac')], ['cobalt', L('аппарат ⁶⁰Co', '⁶⁰Co unit')]]), { forId: fieldId(k, m.id, 'kind') })}
      ${field(L('Заводской №', 'Serial No.'), input(k, m.id, 'serial', m.serial), { forId: fieldId(k, m.id, 'serial') })}
      ${field(L('Примечания', 'Notes'), input(k, m.id, 'notes', m.notes), { forId: fieldId(k, m.id, 'notes') })}
    </div>
    ${cobalt ? coSection : ''}
    ${linacPart ? `<h3 class="sub-h">${esc(L('Пучки фотонов', 'Photon beams'))}</h3>
    <div class="jbeams">${m.beams.filter((b) => beamKind(b) === 'photon').map((b) => beamCard(j, m, b)).join('') || `<p class="sub-hint">${esc(L('Пучков фотонов пока нет.', 'No photon beams yet.'))}</p>`}</div>
    <div class="row-tools">
      <button type="button" class="link-btn" data-add-beam="${esc(m.id)}"><span aria-hidden="true">+</span> ${esc(L('Добавить пучок фотонов', 'Add a photon beam'))}</button>
    </div>
    <h3 class="sub-h">${esc(L('Пучки электронов', 'Electron beams'))}</h3>
    <div class="jbeams">${m.beams.filter((b) => beamKind(b) === 'electron').map((b) => beamCard(j, m, b)).join('') || `<p class="sub-hint">${esc(L('Пучков электронов пока нет.', 'No electron beams yet.'))}</p>`}</div>
    <div class="row-tools">
      <button type="button" class="link-btn" data-add-ebeam="${esc(m.id)}"><span aria-hidden="true">+</span> ${esc(L('Добавить пучок электронов', 'Add an electron beam'))}</button>
    </div>` : ''}
    ${cobalt ? '' : coSection}
    <div class="row-tools">
      <button type="button" class="link-btn danger" data-del="machine:${esc(m.id)}"${hasSessions ? ` disabled title="${esc(L('У аппарата есть записи в журнале', 'The machine has records in the journal'))}"` : ''}>${esc(L('Удалить аппарат', 'Delete machine'))}</button>
    </div>
  </div>`;
}

// ------------------------------------------------------------ «Мои камеры» → журнал
// Свои камеры, сохранённые на вкладках «МВ фотоны» и «⁶⁰Co» («Сохранить в «Мои камеры»»), живут только в этом браузере.
// Кнопка переносит в журнал те, которых там ещё нет (по названию): журнал — файл, его видят все в отделении.
/** Кнопка «Перенести «Мои камеры» в журнал» — только если есть что переносить. */
export function renderMyChambersTool() {
  const box = $('#eq-mine');
  if (!box) return;
  const n = myChambersToJournal(getJournal(), getMyChambers()).added.length;
  box.innerHTML = n
    ? `<button type="button" class="link-btn" id="eq-import-mine">${esc(L(`Перенести «Мои камеры» в журнал (${n})`, `Copy “My chambers” to the journal (${n})`))}</button>`
    : '';
}
function importMine() {
  let added = [];
  updateJournal((j) => {
    const res = myChambersToJournal(j, getMyChambers());
    added = res.added;
    return res.journal;
  }, 'equipment');
  setStatus(
    added.length
      ? L(
          `В журнал перенесены камеры из «Моих камер»: ${added.join(', ')}. Укажите у них номер, калибровочный коэффициент и даты калибровки и сохраните журнал в файл.`,
          `Chambers copied from “My chambers” to the journal: ${added.join(', ')}. Enter their serial numbers, calibration coefficients and calibration dates and save the journal to the file.`,
        )
      : L('Все «Мои камеры» уже есть в журнале.', 'All “My chambers” are already in the journal.'),
  );
}

// ------------------------------------------------------------ отрисовка
function render() {
  const j = getJournal();
  $('#eq_institution').value = j.institution || '';
  $('#eq_department').value = j.department || '';
  $('#eq-chambers').innerHTML = j.chambers.map((c) => chamberCard(c, j)).join('') || `<p class="sub-hint">${esc(L('Камер пока нет.', 'No chambers yet.'))}</p>`;
  $('#eq-electrometers').innerHTML = j.electrometers.map(electrometerCard).join('') || `<p class="sub-hint">${esc(L('Электрометров пока нет.', 'No electrometers yet.'))}</p>`;
  $('#eq-machines').innerHTML = j.machines.map((m) => machineCard(j, m)).join('') || `<p class="sub-hint">${esc(L('Аппаратов пока нет.', 'No machines yet.'))}</p>`;
  for (const btn of ROOT().querySelectorAll('[data-del]')) {
    if (btn.disabled) continue;
    armButton(btn, btn.textContent, () => L('Нажмите ещё раз, чтобы удалить', 'Click again to delete'), () => remove(btn.dataset.del));
  }
  renderMyChambersTool();
  localizeDecimals(ROOT());
  renderReadout();
  notifyUpdate(ROOT());
}

function renderReadout() {
  const j = getJournal();
  const beams = j.machines.reduce((s, m) => s + m.beams.length, 0);
  const due = equipmentDue(j, today());
  const wMachines = countWord(j.machines.length, [L('аппарат', 'machine'), L('аппарата', 'machines'), L('аппаратов', 'machines')], ['machine', 'machines']);
  const wBeams = countWord(beams, [L('пучок', 'beam'), L('пучка', 'beams'), L('пучков', 'beams')], ['beam', 'beams']);
  $('#eq-result').innerHTML = `<div class="dose-row"><div class="dose-big">${j.machines.length}<small>${esc(wMachines)} · ${beams} ${esc(wBeams)}</small></div>
    <div class="secondary">${esc(L(`камер: ${j.chambers.length}; электрометров: ${j.electrometers.length}; записей в журнале: ${j.sessions.length}`, `chambers: ${j.chambers.length}; electrometers: ${j.electrometers.length}; records in the journal: ${j.sessions.length}`))}</div></div>`;
  const msgs = [];
  for (const d of due) {
    msgs.push(`<li class="${d.status === 'overdue' ? 'warn' : 'info'}"><span class="lvl">${esc(d.status === 'overdue' ? L('Срок калибровки прошёл', 'Calibration overdue') : L('Срок калибровки подходит', 'Calibration due soon'))}</span><span>${esc(`${d.text}: ${d.status === 'overdue' ? L(`до ${fmtDate(d.dueDate)}`, `until ${fmtDate(d.dueDate)}`) : L(`до ${fmtDate(d.dueDate)}, осталось ${d.days} дн.`, `until ${fmtDate(d.dueDate)}, ${d.days} days left`)}`)}</span></li>`);
  }
  const missItem = (who, miss) => `<li class="info"><span class="lvl">${esc(L('Не заполнено', 'Missing'))}</span><span>${esc(`${who}: `)}${richText(miss.join(', '))}</span></li>`;
  for (const c of j.chambers) {
    const miss = chamberMissing(c, chamberUses(j, c.id), currentProtocol());
    if (miss.length) msgs.push(missItem(chamberText(c) || L('камера', 'chamber'), miss));
  }
  for (const e of j.electrometers) {
    const miss = electrometerMissing(e);
    if (miss.length) msgs.push(missItem(electrometerText(e) || L('электрометр', 'electrometer'), miss));
  }
  $('#eq-messages').innerHTML = msgs.join('') || `<li class="info"><span class="lvl">${esc(L('Всё в порядке', 'All clear'))}</span><span>${esc(L('Сроки калибровки в порядке, у камер и электрометров заполнено всё нужное для расчёта.', 'Calibration dates are fine; chambers and electrometers have what the calculation needs.'))}</span></li>`;
}

// ------------------------------------------------------------ связь с вкладкой «МВ фотоны» и сеансом
/** «Сохранить в журнал» на вкладке: настройки пучка — в журнал (камера и электрометр журнала не меняются). Возвращает текст состояния. */
export function saveBeamFromTab(target, form, title = '') {
  if (!target?.beamId) return '';
  updateJournal((j) => saveBeamSettings(j, target.machineId, target.beamId, form, ['electron', 'cobalt'].includes(target.kind) ? target.kind : 'photon').journal, 'equipment');
  return L(`Настройки пучка «${title}» сохранены в журнал (камера и электрометр журнала не менялись). Сохраните журнал в файл.`, `Beam settings "${title}" saved to the journal (the journal chamber and electrometer were not changed). Save the journal to the file.`);
}

/** Открыть карточку пучка и прокрутить к ней. */
export function revealBeam(beamId) {
  if (!beamId) return;
  render();
  const card = ROOT().querySelector(`[data-card="beam:${CSS.escape(beamId)}"]`);
  card?.scrollIntoView({ block: 'start' });
}

// ------------------------------------------------------------ правка
/** Заголовок карточки после правки поля (без перерисовки списка — иначе пропадёт фокус). */
function updateHead(el) {
  const card = el.closest('[data-card]');
  if (!card) return;
  const [kind, id] = card.dataset.card.split(':');
  const j = getJournal();
  const tmp = document.createElement('div');
  if (kind === 'chamber') {
    const c = j.chambers.find((x) => x.id === id);
    if (c) tmp.innerHTML = chamberCard(c);
  } else if (kind === 'electrometer') {
    const x = j.electrometers.find((y) => y.id === id);
    if (x) tmp.innerHTML = electrometerCard(x);
  } else if (kind === 'machine') {
    const m = j.machines.find((y) => y.id === id);
    if (m) tmp.innerHTML = machineCard(j, m);
  } else if (kind === 'beam') {
    const m = j.machines.find((y) => y.beams.some((b) => b.id === id));
    const b = m?.beams.find((y) => y.id === id);
    if (b) tmp.innerHTML = beamCard(j, m, b);
  }
  const fresh = tmp.firstElementChild;
  if (!fresh) return;
  // у пучка — вся строка заголовка: название и отметка «не заполнено»
  const sel = `:scope > ${kind === 'beam' ? 'summary' : '.jcard-head'}`;
  const a = card.querySelector(sel);
  const b = fresh.querySelector(sel);
  if (a && b) a.innerHTML = b.innerHTML;
  // подписи, зависящие от вводимых полей (у ⁶⁰Co — с чем сравнивается мощность дозы после замены источника)
  for (const live of fresh.querySelectorAll('[data-live]')) {
    const cur = card.querySelector(`[data-live="${live.dataset.live}"]`);
    if (cur) cur.innerHTML = live.innerHTML;
  }
}

/** Записать значение поля в журнал. Списки и подписи полей перерисовываются после выбора в списке или флажка. */
function onInput(e) {
  const el = e.target.closest('[data-bind]');
  if (!el) return;
  const [kind, id, path] = el.dataset.bind.split('|');
  const value = el.type === 'checkbox' ? el.checked : el.value;
  updateJournal((j) => {
    const list = kind === 'chamber' ? j.chambers : kind === 'electrometer' ? j.electrometers : kind === 'machine' ? j.machines : j.machines.flatMap((m) => m.beams);
    const obj = list.find((x) => x.id === id);
    if (!obj) return j;
    const parts = path.split('.');
    let o = obj;
    for (const p of parts.slice(0, -1)) o = o[p] ??= {};
    o[parts.at(-1)] = value;
    // «FFF» / «БВФ» в названии пучка фотонов ставит отметку сам; у пучка электронов по названию — энергия
    if (kind === 'beam' && path === 'name' && beamKind(obj) === 'photon' && /(^|[^\p{L}])(fff|бвф)([^\p{L}]|$)/iu.test(value)) obj.form.meta_fff = true;
    // другой производитель — модель выбирается заново (у «другого» электрометра своё название сохраняется)
    if (kind === 'chamber' && path === 'maker') {
      const cur = obj.form.ch_model ?? '';
      const keep = value === OTHER_MAKER ? cur === 'OTHER' || cur === 'CUSTOM' : findChamber(cur)?.maker === value || findEChamber(cur)?.maker === value;
      if (!keep) obj.form.ch_model = value === OTHER_MAKER ? 'OTHER' : '';
    }
    if (kind === 'electrometer' && path === 'maker') {
      const p = parseElectrometer(obj.form.el_model);
      if (p.maker !== value) obj.form.el_model = value === EL_OTHER || !value ? (p.maker === EL_OTHER ? obj.form.el_model : '') : electrometerName(value, ELECTROMETERS.find((g) => g.maker === value).models[0]);
    }
    if (kind === 'beam' && path === 'name' && beamKind(obj) === 'electron') {
      const e = parseElectronBeam(value).energy;
      if (Number.isFinite(e)) obj.form.e_energy = String(e).replace('.', ',');
    }
    return j;
  }, 'equipment:input');
  if (kind === 'beam' && path === 'name') {
    const box = document.getElementById(fieldId('beam', id, 'form.meta_fff'));
    if (box && getJournal().machines.flatMap((m) => m.beams).find((x) => x.id === id)?.form.meta_fff) box.checked = true;
  }
  if (e.type === 'change' && (el.tagName === 'SELECT' || el.type === 'checkbox')) {
    render();
    document.getElementById(el.id)?.focus({ preventScroll: true });
    return;
  }
  updateHead(el);
  renderReadout();
}

function remove(what) {
  const [kind, a, b] = what.split(':');
  const j0 = getJournal();
  if (kind === 'chamber' || kind === 'electrometer') {
    const key = kind === 'chamber' ? 'chamberId' : 'electrometerId';
    if (usedInRecords(j0, key, a)) {
      setStatus(L(`Не удалено: ${kind === 'chamber' ? 'камера есть' : 'электрометр есть'} в записях журнала.`, `Not deleted: the ${kind} is used in journal records.`));
      return;
    }
  }
  updateJournal((j) => {
    // прежняя привязка к пучку (журналы до 0.21.0) — только подсказка «чем мерили», при удалении снимается
    if (kind === 'chamber' || kind === 'electrometer') {
      const key = kind === 'chamber' ? 'chamberId' : 'electrometerId';
      for (const m of j.machines) for (const x of m.beams) if (x[key] === a) x[key] = '';
    }
    if (kind === 'chamber') j.chambers = j.chambers.filter((x) => x.id !== a);
    else if (kind === 'electrometer') {
      j.electrometers = j.electrometers.filter((x) => x.id !== a);
      for (const c of j.chambers) if (c.calEl === a) c.calEl = '';
    }
    else if (kind === 'machine') j.machines = j.machines.filter((x) => x.id !== a);
    else if (kind === 'beam') {
      const m = j.machines.find((x) => x.id === a);
      if (m) m.beams = m.beams.filter((x) => x.id !== b);
    }
    return j;
  }, 'equipment');
  setStatus(L('Удалено. Сохраните журнал, чтобы изменение попало в файл.', 'Deleted. Save the journal to write the change to the file.'));
}

/** Фокус на первом поле только что добавленной карточки камеры или электрометра. */
function focusLast(kind) {
  const cards = ROOT().querySelectorAll(`[data-card^="${kind}:"]`);
  cards[cards.length - 1]?.querySelector('select, input')?.focus();
}

function onClick(e) {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.addBeam) {
    const id = uid('b');
    updateJournal((j) => {
      j.machines.find((m) => m.id === t.dataset.addBeam)?.beams.push({ ...BEAM_DEFAULTS, id, name: '', chamberId: j.chambers.find((c) => photonCapable(c.form))?.id ?? '', electrometerId: j.electrometers[0]?.id ?? '', form: { rd_V1: FORM_DEFAULTS.rd_V1, rd_V2: FORM_DEFAULTS.rd_V2, rd_polarity: '+', rd_mu: '100', dd_nominal: '1,000', dd_nominal_at: 'dmax', dd_tol: '2', dd_on: true, qtrs_method: 'ratio', kqtrs_mode: 'formula', setup_geometry: 'SSD' } });
      return j;
    }, 'equipment');
    document.getElementById(fieldId('beam', id, 'name'))?.focus();
  } else if (t.dataset.addEbeam) {
    const id = uid('b');
    updateJournal((j) => {
      const ch = j.chambers.find((c) => electronCapable(c.form));
      j.machines.find((m) => m.id === t.dataset.addEbeam)?.beams.push({
        ...BEAM_DEFAULTS, id, kind: 'electron', name: '', chamberId: ch?.id ?? '', electrometerId: j.electrometers[0]?.id ?? '',
        form: { e_ssd: '100', e_field: '10', e_r50_method: 'i50', e_mu: '100', e_polarity: '+', e_V1: E_DEFAULTS.e_V1, e_V2: E_DEFAULTS.e_V2, e_beam_mode: 'pulsed', e_dd_on: true, e_nominal: '1,000', e_nominal_at: 'zmax', e_tol: '2', e_kqtrs_mode: 'table', e_kq51_mode: 'fit' },
      });
      return j;
    }, 'equipment');
    document.getElementById(fieldId('beam', id, 'name'))?.focus();
  } else if (t.dataset.addCobeam) {
    const id = uid('b');
    updateJournal((j) => {
      const ch = j.chambers.find((c) => cobaltCapable(c.form));
      j.machines.find((m) => m.id === t.dataset.addCobeam)?.beams.push({
        ...BEAM_DEFAULTS, id, kind: 'cobalt', name: '', refSrc: 'last', chamberId: ch?.id ?? '', electrometerId: j.electrometers[0]?.id ?? '',
        form: { co_geometry: 'SSD', co_distance: '80', co_zref: '5', co_V1: CO_DEFAULTS.co_V1, co_V2: CO_DEFAULTS.co_V2, co_polarity: '+', co_time: '1', co_time_unit: 'min', co_timer_mode: 'measured', co_nx_t: '1', co_nx_n: '5', co_kleak: '1,000', co_rec_trs: 'eq13', co_dd_on: true, co_zmax: '0,5', co_dd_sad: 'tmr', co_ref_at: 'zmax', co_tol: '2', co_act_unit: 'Ci' },
      });
      return j;
    }, 'equipment');
    document.getElementById(fieldId('beam', id, 'name'))?.focus();
  } else if (t.dataset.editTab) {
    const [mid, bid] = t.dataset.editTab.split(':');
    const j = getJournal();
    const m = j.machines.find((x) => x.id === mid);
    const b = m?.beams.find((x) => x.id === bid);
    if (!b) return;
    const ch = j.chambers.find((c) => c.id === b.chamberId);
    const el = j.electrometers.find((x) => x.id === b.electrometerId);
    const kind = beamKind(b);
    // протокол — текущий в шапке: открытие пучка не должно переключать его
    const form =
      kind === 'electron'
        ? normalizeElectrons({ ...E_DEFAULTS, ...b.form, ...electronChamberForm(ch?.form || {}), e_el_model: el?.form?.el_model ?? '', e_el_serial: el?.form?.el_serial ?? '', e_kelec: el?.form?.el_kelec ?? '1,000', e_beam: b.name, e_machine: m.name, e_institution: orgText(j), protocol: currentProtocol() })
        : kind === 'cobalt'
          ? normalizeCobalt({ ...CO_DEFAULTS, ...b.form, ...cobaltChamberForm(ch?.form || {}), co_el_model: el?.form?.el_model ?? '', co_el_serial: el?.form?.el_serial ?? '', co_kelec: el?.form?.el_kelec ?? '1,000', co_machine: [m.name, b.name].filter((x) => !isBlank(x)).join(' — '), co_institution: orgText(j), protocol: currentProtocol() })
          : normalizeForm(withChamberLength({ ...FORM_DEFAULTS, ...b.form, ...(ch?.form || {}), ...(el?.form || {}), meta_beam: b.name, meta_machine: m.name, meta_institution: orgText(j), protocol: currentProtocol() }, ch));
    tabBridge.edit(kind, form, { title: `${m.name || ''} — ${b.name || ''}`, target: { machineId: mid, beamId: bid, kind } });
  } else if (t.id === 'eq-add-chamber') {
    updateJournal((j) => {
      j.chambers.push({ ...CHAMBER_DEFAULTS, id: uid('ch'), form: { ch_model: '', ch_serial: '', ch_ndw: '', ch_ndw_unit: 'Gy/nC', ch_klab: '1,000', ch_T0: '20', ch_P0: '101,325' } });
      return j;
    }, 'equipment');
    focusLast('chamber');
  } else if (t.id === 'eq-import-mine') {
    importMine();
  } else if (t.id === 'eq-add-electrometer') {
    const id = uid('el');
    updateJournal((j) => {
      j.electrometers.push({ ...ELECTROMETER_DEFAULTS, id, form: { el_model: '', el_serial: '', el_kelec: '1,000' } });
      return j;
    }, 'equipment');
    focusLast('electrometer');
  } else if (t.id === 'eq-add-machine' || t.id === 'eq-add-cobalt') {
    updateJournal((j) => {
      j.machines.push({ ...MACHINE_DEFAULTS, id: uid('m'), kind: t.id === 'eq-add-cobalt' ? 'cobalt' : 'linac', beams: [] });
      return j;
    }, 'equipment');
  }
}

export function equipmentStatus(text) {
  setStatus(text);
}

export function initEquipment() {
  setStatus = makeStatus($('#eq-status'));
  setupFilePanel($('#eq-file'), (t) => setStatus(t));
  render();
  const sheet = $('#eq-sheet');
  sheet.addEventListener('input', onInput);
  sheet.addEventListener('change', onInput);
  sheet.addEventListener('click', onClick);
  $('#eq_institution').addEventListener('input', (e) => updateJournal((j) => ({ ...j, institution: e.target.value }), 'equipment:input'));
  $('#eq_department').addEventListener('input', (e) => updateJournal((j) => ({ ...j, department: e.target.value }), 'equipment:input'));
  onJournal(({ source }) => {
    if (source === 'equipment:input') return;
    render();
  });
  document.addEventListener('langchange', render);
  // что «не заполнено» у камер и пучков, зависит от протокола
  document.addEventListener('change', (e) => {
    if (e.target.name === 'protocol') render();
  });
}
