// Вкладка «Оборудование»: учреждение и подразделение, ускорители с пучками фотонов и электронов, аппараты ⁶⁰Co,
// рентгенотерапевтические аппараты (аппликаторы и режимы, с 0.41.0), электрометры, камеры. Всё хранится в журнале. У пучка здесь — только название (и признак БВФ); мерят во вкладке дозиметрии (пучок
// журнала выбирается в её разделе 1, tab-journal-ui.js), настройки пучка редактируются там же и возвращаются в журнал.
import { L } from '../core/i18n.js';
import { CHAMBERS, chamberNote, findChamber, lengthSourceText } from '../core/chambers.js';
import { ELECTROMETERS, OTHER as EL_OTHER, parseElectrometer, electrometerName } from '../core/electrometers.js';
import { NDW_UNITS, unitLabel, isBlank } from '../core/units.js';
import { FORM_DEFAULTS, normalizeForm } from '../core/photons.js';
import { E_DEFAULTS, normalizeElectrons, parseElectronBeam } from '../core/electrons.js';
import { E_CHAMBERS, findEChamber } from '../core/electron-chambers.js';
import { CO_DEFAULTS, normalizeCobalt } from '../core/cobalt.js';
import {
  uid, CHAMBER_DEFAULTS, ELECTROMETER_DEFAULTS, MACHINE_DEFAULTS, BEAM_DEFAULTS, chamberText, electrometerText, saveBeamSettings, equipmentDue, equipmentNoDue,
  chamberMissing, electrometerMissing, chamberUses, photonCapable, electronCapable, electronChamberForm, beamKind, cobaltCapable, cobaltChamberForm, myChambersToJournal, orgText, withChamberLength,
  CAL_GEO_KEYS, machineCalGeo, calGeoKey, calGeoText, syncCalGeo,
} from '../core/journal.js';
import {
  newKvApplicator, newKvMachineMode, normalizeKvMachine, applicatorDiameter, applicatorText, kvMachineModeTitle, hvlUnit, kvRefCandidates, kvMachineChecks,
  KV_ONLY_CHAMBERS, findKvOnlyChamber, kvModelOfJournal,
} from '../core/kv-machine.js';
import { kvCertText } from '../core/kv-journal.js';
import { kvModeUsed, kvAppUsed, kvEquipUsed } from '../core/kv-records.js';
import { getMyChambers } from './store.js';
import { $, esc, fmt, makeStatus, armButton, notifyUpdate, today, richText, currentProtocol, plainSymbols } from './common.js';
import { localizeDecimals } from './i18n.js';
import { getJournal, updateJournal, onJournal } from './journal-store.js';
import { setupFilePanel, dueChip, fmtDate, countWord, GEO_OWN_TEXT } from './journal-common.js';

let setStatus = () => {};
let tabBridge = { edit: () => {} };
/** Связь с вкладками дозиметрии: edit(kind, form, { title, target }) — пучок журнала во вкладке. */
export const setEquipmentBridge = (b) => (tabBridge = { ...tabBridge, ...b });

const ROOT = () => $('#module-equipment');
const val = (v) => esc(v ?? '');
const fieldId = (kind, id, path) => `eq-${kind}-${id}-${path.replace(/\./g, '-')}`;
// id записей приходит из файла журнала: в атрибут — только экранированным (иначе разметка из файла попадёт на страницу)
const bind = (kind, id, path) => `id="${val(fieldId(kind, id, path))}" data-bind="${val(`${kind}|${id}|${path}`)}"`;

/** Поле ввода. */
function input(kind, id, path, value, { num = false, type = 'text', placeholder = '', aria = '' } = {}) {
  return `<input type="${type}" ${bind(kind, id, path)}${num ? ' class="num" inputmode="decimal"' : ''} value="${val(value)}"${placeholder ? ` placeholder="${val(placeholder)}"` : ''}${aria ? ` aria-label="${val(aria)}"` : ''}>`;
}
function select(kind, id, path, value, options, { aria = '' } = {}) {
  return `<select ${bind(kind, id, path)}${aria ? ` aria-label="${val(aria)}"` : ''}>${options.map(([v, t]) => `<option value="${val(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(plainSymbols(t))}</option>`).join('')}</select>`;
}
function check(kind, id, path, value, label) {
  return `<label class="check"><input type="checkbox" ${bind(kind, id, path)}${value ? ' checked' : ''}> <span>${label}</span></label>`;
}
const field = (label, control, { forId = '', sub = '', cls = '', live = '' } = {}) =>
  `<div class="field ${cls}"${live ? ` data-live="${val(live)}"` : ''}><label${forId ? ` for="${val(forId)}"` : ''}>${label}</label>${control}${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;

/** Отметка «не заполнено: …» в заголовке карточки. */
const missChip = (miss) => (miss.length ? `<span class="chip warn">${richText(L(`не заполнено: ${miss.join(', ')}`, `missing: ${miss.join(', ')}`))}</span>` : '');

// ------------------------------------------------------------ камеры
const OTHER_MAKER = 'other';
/** Производители камер: из базы фотонов, плоскопараллельных камер базы электронов и камер только для kV-рентгена. */
const chamberMakers = () => [...new Set([...CHAMBERS.map((c) => c.maker), ...E_CHAMBERS.filter((c) => c.type === 'pp').map((c) => c.maker), ...KV_ONLY_CHAMBERS.map((c) => c.maker)])];
/** Производитель камеры записи: выбранный в карточке или по модели; «Другая», своя — 'other'. */
function chamberMakerOf(c) {
  const m = c.form?.ch_model ?? '';
  if (m === 'OTHER' || m === 'CUSTOM' || String(m).startsWith('MY:')) return OTHER_MAKER;
  return findChamber(m)?.maker ?? findEChamber(m)?.maker ?? findKvOnlyChamber(m)?.maker ?? c.maker ?? '';
}
/** Модели камер производителя: камеры базы фотонов, затем плоскопараллельные (для электронов и ⁶⁰Co). */
function chamberModels(maker) {
  if (maker === OTHER_MAKER) return [];
  // камеры из списка вкладки kV (табл. 32 TRS-398 Rev.1) — с пометкой: их калибруют и в рентгене
  const cyl = CHAMBERS.filter((c) => c.maker === maker).map((c) => [c.id, `${c.model}${c.note ? ` — ${plainSymbols(chamberNote(c))}` : ''}${kvModelOfJournal(c.id) ? L(' · и для kV-рентгена', ' · also for kV x-rays') : ''}`]);
  const pp = E_CHAMBERS.filter((c) => c.type === 'pp' && c.maker === maker).map((c) => [c.id, `${c.model} — ${L('плоскопараллельная, для электронов и ⁶⁰Co', 'plane-parallel, for electrons and ⁶⁰Co')}`]);
  const kv = KV_ONLY_CHAMBERS.filter((c) => c.maker === maker).map((c) => [c.id, `${c.model} — ${L('плоскопараллельная, для kV-рентгена (низкие энергии)', 'plane-parallel, for kV x-rays (low energy)')}`]);
  return [...cyl, ...pp, ...kv];
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
  return (j.sessions || []).some((s) => (s.beams || []).some((b) => b[key] === id) || (s.checks || []).some((c) => c[key] === id || (key === 'chamberId' && c.summary?.workChamberId === id)))
    || (j.plateChecks || []).some((p) => p.binding?.[key] === id)
    || kvEquipUsed(j, key, id);
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
  // камера из списка вкладки kV: плоскопараллельная только для kV или цилиндрическая из табл. 32 (её калибруют и в рентгене)
  const kvCapable = !!kvModelOfJournal(f.ch_model);
  const kvText = kvCertText(c.kv);
  const forWhat = [ph && L('фотонов', 'photons'), el && L('электронов', 'electrons'), (ph || el) && '⁶⁰Co', kvCapable && L('kV-рентгена', 'kV x-rays')].filter(Boolean);
  const forText = forWhat.length ? L(`для ${forWhat.length > 1 ? `${forWhat.slice(0, -1).join(', ')} и ${forWhat.at(-1)}` : forWhat[0]}`, `for ${forWhat.length > 1 ? `${forWhat.slice(0, -1).join(', ')} and ${forWhat.at(-1)}` : forWhat[0]}`) : '';
  // N_D,w в ⁶⁰Co нужен, если хоть для одного вида пучков камера калибруется в ⁶⁰Co, если она выбрана у пучка ⁶⁰Co
  // (или модель ещё не выбрана)
  const needNdw = isBlank(f.ch_model) || (ph && !phCross) || (el && !elCross) || uses.cobalt;
  const units = Object.entries(NDW_UNITS).map(([v, u]) => [v, unitLabel(u)]);
  const maker = chamberMakerOf(c);
  return `<div class="jcard" data-card="chamber:${esc(c.id)}">
    <div class="jcard-head"><b>${esc(chamberText(c) || L('Новая камера', 'New chamber'))}</b><span class="chips">${missChip(chamberMissing(c, uses, 'trs'))}${dueChip(c.dueDate)}</span></div>
    <div class="grid">
      ${field(L('Производитель', 'Manufacturer'), `<select ${bind(k, c.id, 'maker')}>${makerOptions(chamberMakers(), maker, L('Другая или своя камера', 'Other or custom chamber'))}</select>`, { forId: fieldId(k, c.id, 'maker') })}
      ${maker ? field(L('Модель', 'Model'), `<select ${bind(k, c.id, 'form.ch_model')}>${chamberModelOptions(maker, f.ch_model)}</select>`, { forId: fieldId(k, c.id, 'form.ch_model'), sub: [custom ? esc([f.cc_maker, f.cc_model].filter(Boolean).join(' ')) : '', esc(forText), esc(chamberDims(f))].filter(Boolean).join(' · ') }) : ''}
      ${field(L('Заводской №', 'Serial No.'), input(k, c.id, 'form.ch_serial', f.ch_serial), { forId: fieldId(k, c.id, 'form.ch_serial') })}
      ${ph && !custom ? field(L('Длина полости, мм', 'Cavity length, mm'), input(k, c.id, 'length', c.length, { num: true, placeholder: Number.isFinite(findChamber(f.ch_model)?.lengthMm) ? fmt(findChamber(f.ch_model).lengthMm, 1) : '' }), { forId: fieldId(k, c.id, 'length'), sub: Number.isFinite(findChamber(f.ch_model)?.lengthMm) ? L(`для k<sub>vol</sub> в пучках БВФ; пусто — из базы (${lengthSourceText(findChamber(f.ch_model))})`, `for k<sub>vol</sub> in FFF beams; blank: from the database (${lengthSourceText(findChamber(f.ch_model))})`) : L('для k<sub>vol</sub> в пучках БВФ: в базе длины нет — возьмите из паспорта камеры', 'for k<sub>vol</sub> in FFF beams: the database has no length; take it from the chamber datasheet') }) : ''}
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
    ${kvText || kvCapable ? `<h4 class="sub-h">${esc(L('kV-сертификат', 'kV certificate'))}</h4>
    <p class="sub-hint">${kvText ? `${richText(kvText)}. ` : esc(L('Пока не введён. ', 'Not entered yet. '))}${esc(L('Вводится во вкладке «kV-рентген» на листе «Аппарат и режимы» и сохраняется в запись камеры кнопкой «Сохранить аппарат в Оборудование»; при выборе аппарата во вкладке подставляется вместе с камерой.', 'It is entered in the kV x-rays tab on the Machine and modes sheet and saved to the chamber record with “Save the unit to Equipment”; when the unit is selected in the tab it is filled in with the chamber.'))}</p>` : ''}
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

// ------------------------------------------------------------ геометрия калибровки дозы аппарата
// Одна на все пучки фотонов (электронов) аппарата: подставляется в настройки пучков «как у аппарата» (core/journal.js:
// syncCalGeo). У пучка может быть своя — её задают во вкладке дозиметрии, как остальные настройки пучка.
const KIND_PLURAL = { photon: () => L('фотонов', 'photon'), electron: () => L('электронов', 'electron') };
/** Последняя показанная геометрия аппарата (machineId|вид) — чтобы сказать о смене один раз, по «change». */
const geoSeen = new Map();

function calGeoBlock(m, kind) {
  const k = 'machine';
  const g = machineCalGeo(m, kind);
  const p = (key) => `calGeo.${kind}.${key}`;
  const fid = (key) => fieldId(k, m.id, p(key));
  const beams = m.beams.filter((b) => beamKind(b) === kind);
  const own = beams.filter((b) => b.geoOwn).map((b) => b.name || L('без названия', 'unnamed'));
  const whom = !beams.length
    ? L('подставится в новые пучки', 'will be filled into new beams')
    : own.length
      ? L(`для пучков «как у аппарата»; своя у: ${own.join(', ')}`, `for the beams "as the machine"; own geometry: ${own.join(', ')}`)
      : L(`для всех пучков ${KIND_PLURAL[kind]()} аппарата`, `for all ${KIND_PLURAL[kind]()} beams of the machine`);
  let body;
  if (kind === 'photon') {
    const manual = g.setup_geometry === 'manual';
    body = `${field(L('Геометрия измерения дозы', 'Dose measurement geometry'), select(k, m.id, p('setup_geometry'), g.setup_geometry, [['SSD', L('РИП 100 см — поле на поверхности воды', 'SSD 100 cm: field at the water surface')], ['SAD', L('РИО 100 см — поле в плоскости камеры', 'SAD 100 cm: field at the chamber plane')], ['manual', L('Ручной ввод: РИП, поле, глубина', 'Manual: SSD, field, depth')]]), { forId: fid('setup_geometry'), cls: 'span-2', sub: esc(whom) })}
      ${manual ? `${field(L('РИП, см', 'SSD, cm'), input(k, m.id, p('setup_ssd'), g.setup_ssd, { num: true }), { forId: fid('setup_ssd') })}
      ${field(L('Размер поля, см', 'Field size, cm'), input(k, m.id, p('setup_field'), g.setup_field, { num: true }), { forId: fid('setup_field') })}
      ${field(L('Глубина камеры, см', 'Chamber depth, cm'), input(k, m.id, p('setup_depth'), g.setup_depth, { num: true }), { forId: fid('setup_depth') })}` : ''}
      <div class="field span-2">${check(k, m.id, p('dd_on'), g.dd_on, L('Пересчитать дозу на глубину максимума d<sub>max</sub>', 'Transfer the dose to the depth of maximum d<sub>max</sub>'))}</div>
      ${g.dd_on && g.setup_geometry === 'SAD' ? field(L('Пересчёт при установке по РИО', 'Transfer for the SAD set-up'), select(k, m.id, p('dd_sad'), g.dd_sad, [['tmr', L('через TMR — на d_max в изоцентре', 'via TMR: to d_max at the isocentre')], ['pdd', L('через PDD при РИП 90 см', 'via PDD at SSD 90 cm')]]), { forId: fid('dd_sad'), cls: 'span-2' }) : ''}
      ${g.dd_on ? field(L('Номинальный выход задан', 'The nominal output is given'), select(k, m.id, p('dd_nominal_at'), g.dd_nominal_at, [['dmax', L('на d_max (после пересчёта)', 'at d_max (after the transfer)')], ['zref', L('на опорной глубине — аппарат калибруют на 10 см', 'at the reference depth: the linac is calibrated at 10 cm')]]), { forId: fid('dd_nominal_at'), cls: 'span-2' }) : ''}`;
  } else {
    body = `${field(L('РИП, см', 'SSD, cm'), input(k, m.id, p('e_ssd'), g.e_ssd, { num: true }), { forId: fid('e_ssd'), sub: esc(whom) })}
      <div class="field">${check(k, m.id, p('e_dd_on'), g.e_dd_on, L('Пересчитать дозу на глубину максимума z<sub>max</sub>', 'Transfer the dose to the depth of maximum z<sub>max</sub>'))}</div>
      ${g.e_dd_on ? field(L('Номинальный выход задан', 'The nominal output is given'), select(k, m.id, p('e_nominal_at'), g.e_nominal_at, [['zmax', L('на z_max (после пересчёта)', 'at z_max (after the transfer)')], ['zref', L('на опорной глубине z_ref', 'at the reference depth z_ref')]]), { forId: fid('e_nominal_at') }) : ''}`;
  }
  return `<div class="jgeo"><h4 class="sub-h">${esc(L('Геометрия калибровки дозы', 'Dose calibration geometry'))}</h4>
    <div class="grid">${body}</div></div>`;
}

/** Поле пучка «Геометрия калибровки»: как у аппарата или своя (своя задаётся во вкладке дозиметрии). */
function beamGeoField(m, b) {
  const kind = beamKind(b);
  const opts = [
    ['', L(`как у аппарата: ${calGeoText(kind, machineCalGeo(m, kind))}`, `as the machine: ${calGeoText(kind, machineCalGeo(m, kind))}`)],
    ['own', b.geoOwn ? L(`своя: ${calGeoText(kind, b.form)}`, `own: ${calGeoText(kind, b.form)}`) : L('своя — задаётся во вкладке дозиметрии', 'own: set in the dosimetry tab')],
  ];
  return field(L('Геометрия калибровки', 'Calibration geometry'), select('beam', b.id, 'geoOwn', b.geoOwn ? 'own' : '', opts), {
    forId: fieldId('beam', b.id, 'geoOwn'),
    cls: 'span-2',
    sub: b.geoOwn ? L(`своя геометрия меняется кнопкой «Настройки пучка — во вкладке ${TAB_OF[kind]()}»`, `the own geometry is changed with the “Beam settings: in the ${TAB_OF[kind]()} tab” button`) : '',
  });
}

/** Сказать о смене геометрии аппарата: в какие пучки она подставлена и что номинал от неё зависит. */
function geoChanged(m, kind) {
  const key = `${m.id}|${kind}`;
  const now = calGeoKey(kind, machineCalGeo(m, kind));
  const was = geoSeen.get(key);
  geoSeen.set(key, now);
  if (was === undefined || was === now) return;
  const names = m.beams.filter((b) => beamKind(b) === kind && !b.geoOwn).map((b) => b.name || L('без названия', 'unnamed'));
  const text = calGeoText(kind, machineCalGeo(m, kind));
  setStatus(
    names.length
      ? L(
        `Геометрия калибровки ${KIND_PLURAL[kind]()} аппарата «${m.name || '—'}»: ${text}. Подставлена в пучки: ${names.join(', ')}. Номинальный выход зависит от геометрии и точки номинала: проверьте номиналы этих пучков во вкладке ${TAB_OF[kind]()}. В контрольной карте со следующей записи начнётся новый отсчёт.`,
        `${kind === 'photon' ? 'Photon' : 'Electron'} calibration geometry of “${m.name || '—'}”: ${text}. Filled into the beams: ${names.join(', ')}. The nominal output depends on the geometry and the nominal point: check the nominals of these beams in the ${TAB_OF[kind]()} tab. The control chart starts a new count from the next record.`,
      )
      : L(`Геометрия калибровки ${KIND_PLURAL[kind]()} аппарата «${m.name || '—'}»: ${text}.`, `${kind === 'photon' ? 'Photon' : 'Electron'} calibration geometry of “${m.name || '—'}”: ${text}.`),
  );
}

function beamCard(j, m, b) {
  const kind = beamKind(b);
  const k = 'beam';
  const id = b.id;
  const f = b.form || {};
  const used = j.sessions.some((s) => s.beams.some((x) => x.beamId === id)) || (j.plateChecks || []).some((p) => p.beamId === id);
  const sub = {
    photon: L('как в протоколе; «FFF» или «БВФ» в названии ставит отметку сам', 'as in the report; "FFF" in the name sets the checkbox'),
    electron: L('как в протоколе; энергия — по названию', 'as in the report; the energy is taken from the name'),
    cobalt: L('как в протоколе: установка, по которой калибруют аппарат', 'as in the report: the setup used to calibrate the unit'),
  }[kind];
  return `<div class="jbeam jbeam-line${b.active === false ? ' off' : ''}" data-card="beam:${esc(id)}">
    <div class="grid">
      ${field(L('Пучок', 'Beam'), input(k, id, 'name', b.name, { placeholder: BEAM_PLACEHOLDER[kind]() }), { forId: fieldId(k, id, 'name'), sub })}
      <div class="field">${kind === 'photon' ? check(k, id, 'form.meta_fff', f.meta_fff, L('без выравнивающего фильтра (БВФ)', 'flattening-filter-free (FFF)')) : ''}${check(k, id, 'active', b.active !== false, L('используется в измерениях', 'used in measurements'))}</div>
      ${kind in CAL_GEO_KEYS ? beamGeoField(m, b) : ''}
    </div>
    <div class="row-tools">
      <button type="button" class="link-btn" data-edit-tab="${esc(m.id)}:${esc(id)}">${esc(L(`Настройки пучка — во вкладке ${TAB_OF[kind]()}`, `Beam settings: in the ${TAB_OF[kind]()} tab`))}</button>
      <button type="button" class="link-btn danger" data-del="beam:${esc(m.id)}:${esc(id)}"${used ? ` disabled title="${esc(L('Пучок есть в записях журнала: снимите «используется в измерениях», чтобы убрать его из списка пучков вкладок', 'The beam is in journal records: clear "used in measurements" to remove it from the beam list of the tabs'))}"` : ''}>${esc(L('Удалить пучок', 'Delete beam'))}</button>
    </div>
  </div>`;
}

// ------------------------------------------------------------ рентгенотерапевтический аппарат
// Вместо пучков — аппликаторы (список на аппарат) и режимы: диапазон, напряжение, ток, фильтр, СПО (номинальный или
// измеренный), камера и электрометр режима, отмеченные аппликаторы и референсный из них (проверка по TRS-398 Rev.1,
// core/kv-machine.js). Подписи, зависящие от вводимых полей, помечены data-live — их обновляет updateHead без перерисовки.
const KV_SHAPES_TEXT = () => [['circle', L('круг', 'circle')], ['square', L('квадрат', 'square')], ['rect', L('прямоугольник', 'rectangle')]];
const KV_RANGES_TEXT = () => [['low', L('низкие энергии (10–100 кВ), СПО в мм Al', 'low energy (10–100 kV), HVL in mm Al')], ['medium', L('средние энергии (80–300 кВ), СПО в мм Cu', 'medium energy (80–300 kV), HVL in mm Cu')]];
const appName = (a, i) => applicatorText(a) || L(`аппликатор ${i + 1}`, `applicator ${i + 1}`);
/** Замечания по аппарату kV: строки в карточке (без номера режима — он в заголовке режима). */
const kvMsgs = (list, live) => `<ul class="jmsgs" data-live="${val(live)}">${list.map((c) => `<li class="${c.level}">${richText(c.short)}</li>`).join('')}</ul>`;

function kvAppRow(j, m, a, i) {
  const k = 'kvapp';
  const d = applicatorDiameter(a);
  const sizeCap = a.shape === 'circle' ? L('Диаметр, см', 'Diameter, cm') : a.shape === 'square' ? L('Сторона, см', 'Side, cm') : L('Стороны, см', 'Sides, cm');
  const n = L(`аппликатор ${i + 1}`, `applicator ${i + 1}`);
  return `<tr>
    <td class="no">${i + 1}</td>
    <td data-cap="${esc(L('Обозначение', 'Label'))}">${input(k, a.id, 'name', a.name, { placeholder: 'F10', aria: L(`${n}: обозначение`, `${n}: label`) })}</td>
    <td data-cap="${esc(L('Форма', 'Shape'))}">${select(k, a.id, 'shape', a.shape, KV_SHAPES_TEXT(), { aria: L(`${n}: форма`, `${n}: shape`) })}</td>
    <td data-cap="${esc(sizeCap)}"><span class="jkv-size">${input(k, a.id, 'a', a.a, { num: true, aria: `${n}: ${sizeCap}` })}${a.shape === 'rect' ? `<span aria-hidden="true">×</span>${input(k, a.id, 'b', a.b, { num: true, aria: L(`${n}: вторая сторона, см`, `${n}: second side, cm`) })}` : ''}</span></td>
    <td data-cap="${esc(L('РИП, см', 'SSD, cm'))}">${input(k, a.id, 'ssd', a.ssd, { num: true, aria: L(`${n}: РИП, см`, `${n}: SSD, cm`) })}</td>
    <td class="v" data-cap="${esc(L('Ø экв., см', 'Eq. Ø, cm'))}" data-live="kvapp-d-${val(a.id)}">${Number.isFinite(d) ? fmt(d, 1) : '—'}</td>
    <td class="del"><button type="button" class="link-btn danger" data-del="kvapp:${esc(m.id)}:${esc(a.id)}"${kvAppUsed(j, m.id, a.id) ? ` disabled title="${esc(L('Аппликатор есть в записях журнала', 'The applicator is used in journal records'))}"` : ''}>${esc(L('Удалить', 'Delete'))}</button></td>
  </tr>`;
}

/** Подсказка у референсного аппликатора: какой он по TRS-398 Rev.1. */
function kvRefHint(m, x) {
  const c = kvRefCandidates(m, x);
  const byId = new Map(m.applicators.map((a, i) => [a.id, appName(a, i)]));
  const names = c.ids.map((id) => byId.get(id)).join('; ');
  if (c.how === 'low') return L('низкие энергии: референсное поле — как при калибровке камеры (TRS-398 Rev.1, табл. 26 и 27), проверяется во вкладке «kV-рентген»', 'low energy: the reference field is as at the chamber calibration (TRS-398 Rev.1, Tables 26 and 27); checked in the kV x-rays tab');
  if (c.how === 'comparable') return L(`по TRS-398 Rev.1 (табл. 31): ${names} — поле 10 × 10 см, Ø 10 см или сопоставимое`, `by TRS-398 Rev.1 (Table 31): ${names}, a field of 10 × 10 cm, 10 cm in diameter or comparable`);
  if (c.how === 'largest') return L(`по TRS-398 Rev.1 (табл. 31): ${names} — самый большой квадратный или круглый тубус (10 × 10 см нет)`, `by TRS-398 Rev.1 (Table 31): ${names}, the largest square or circular applicator (there is no 10 × 10 cm one)`);
  return L('по TRS-398 Rev.1 (табл. 31): поле 10 × 10 см или Ø 10 см, а если все тубусы меньше — самый большой квадратный или круглый; среди отмеченных такого нет', 'by TRS-398 Rev.1 (Table 31): a field of 10 × 10 cm or 10 cm in diameter, or the largest square or circular applicator if all are smaller; none of the ticked ones is');
}

function kvModeBlock(j, m, x, i, checks) {
  const k = 'kvmode';
  const t = kvMachineModeTitle(x);
  const fid = (path) => fieldId(k, x.id, path);
  const c = kvRefCandidates(m, x);
  const ticked = m.applicators.map((a, n) => [a, n]).filter(([a]) => x.applicators.includes(a.id));
  const refOpts = [['', L('— не выбран —', '— not selected —')], ...ticked.map(([a, n]) => [a.id, `${appName(a, n)}${c.ids.includes(a.id) ? L(' — по Rev.1', ' — by Rev.1') : ''}`])];
  if (x.refApplicator && !x.applicators.includes(x.refApplicator)) {
    const n = m.applicators.findIndex((a) => a.id === x.refApplicator);
    if (n >= 0) refOpts.push([x.refApplicator, L(`${appName(m.applicators[n], n)} — не отмечен у режима`, `${appName(m.applicators[n], n)} — not ticked for the mode`)]);
  }
  const chOpts = [['', L('— не выбрана —', '— not selected —')], ...j.chambers.map((ch) => [ch.id, chamberText(ch) || L('камера без названия', 'unnamed chamber')])];
  if (x.chamberId && !j.chambers.some((ch) => ch.id === x.chamberId)) chOpts.push([x.chamberId, L('— камеры нет в «Оборудовании» —', '— the chamber is not in Equipment —')]);
  const elOpts = [['', L('— не выбран —', '— not selected —')], ...j.electrometers.map((e) => [e.id, electrometerText(e) || L('электрометр без названия', 'unnamed electrometer')])];
  if (x.electrometerId && !j.electrometers.some((e) => e.id === x.electrometerId)) elOpts.push([x.electrometerId, L('— электрометра нет в «Оборудовании» —', '— the electrometer is not in Equipment —')]);
  const apps = m.applicators.length
    ? m.applicators.map((a, n) => check(k, x.id, `app:${a.id}`, x.applicators.includes(a.id), esc(appName(a, n)))).join('')
    : `<span class="sub">${esc(L('у аппарата пока нет аппликаторов — добавьте их в таблицу выше', 'the unit has no applicators yet: add them to the table above'))}</span>`;
  return `<div class="jkv-mode" data-kvmode="${val(x.id)}">
    <h4 class="sub-h" data-live="kvmode-t-${val(x.id)}">${esc(L(`Режим ${i + 1}`, `Mode ${i + 1}`))}${t ? ` — ${esc(t)}` : ''}</h4>
    <div class="grid">
      ${field(L('Напряжение, кВ', 'Voltage, kV'), input(k, x.id, 'kv', x.kv, { num: true }), { forId: fid('kv') })}
      ${field(L('Ток трубки, мА', 'Tube current, mA'), input(k, x.id, 'ma', x.ma, { num: true }), { forId: fid('ma') })}
      ${field(L('Фильтр', 'Filter'), input(k, x.id, 'filter', x.filter, { placeholder: x.range === 'low' ? L('2 мм Al', '2 mm Al') : L('0,5 мм Cu + 1 мм Al', '0.5 mm Cu + 1 mm Al') }), { forId: fid('filter') })}
      ${field(L('Диапазон', 'Range'), select(k, x.id, 'range', x.range, KV_RANGES_TEXT()), { forId: fid('range'), cls: 'span-2' })}
      ${field(L(`СПО, ${hvlUnit(x.range)}`, `HVL, ${hvlUnit(x.range)}`), input(k, x.id, 'hvl', x.hvl, { num: true }), { forId: fid('hvl'), sub: L('по нему считается k<sub>Q</sub>', 'k<sub>Q</sub> is calculated from it') })}
      ${field(L('СПО', 'HVL'), select(k, x.id, 'hvlSource', x.hvlSource, [['nominal', L('номинальный', 'nominal')], ['measured', L('измерен', 'measured')]]), { forId: fid('hvlSource'), sub: x.hvlSource === 'measured' ? '' : L('из паспорта или приёмки', 'from the datasheet or acceptance') })}
      ${x.hvlSource === 'measured' ? field(L('Дата измерения СПО', 'HVL measurement date'), input(k, x.id, 'hvlDate', x.hvlDate, { type: 'date' }), { forId: fid('hvlDate') }) : ''}
      ${field(L('Обозначение режима', 'Mode label'), input(k, x.id, 'label', x.label, { placeholder: t || L('120 кВ / 10 мА / 2 мм Al', '120 kV / 10 mA / 2 mm Al') }), { forId: fid('label'), sub: L('пусто — по напряжению, току и фильтру', 'blank: from the voltage, current and filter') })}
      ${field(L('Камера', 'Chamber'), select(k, x.id, 'chamberId', x.chamberId, chOpts), { forId: fid('chamberId'), cls: 'span-2', sub: L('своя у каждого режима; камеры — в разделе 4', 'each mode has its own; chambers are in section 4') })}
      ${field(L('Электрометр', 'Electrometer'), select(k, x.id, 'electrometerId', x.electrometerId, elOpts), { forId: fid('electrometerId') })}
    </div>
    <div class="field"><span class="label">${esc(L('Аппликаторы режима', 'Applicators of the mode'))}</span><div class="jkv-apps" data-live="kvmode-apps-${val(x.id)}">${apps}</div></div>
    <div class="grid">
      ${field(L('Референсный аппликатор', 'Reference applicator'), select(k, x.id, 'refApplicator', x.refApplicator, refOpts), { forId: fid('refApplicator'), cls: 'span-2', live: `kvmode-ref-${x.id}`, sub: esc(kvRefHint(m, x)) })}
      ${field(L('Примечания', 'Notes'), input(k, x.id, 'notes', x.notes), { forId: fid('notes'), cls: 'span-2' })}
    </div>
    ${kvMsgs(checks.filter((ch) => ch.modeId === x.id), `kvmode-msgs-${x.id}`)}
    <div class="row-tools"><button type="button" class="link-btn danger" data-del="kvmode:${esc(m.id)}:${esc(x.id)}"${kvModeUsed(j, m.id, x.id) ? ` disabled title="${esc(L('Режим есть в записях журнала', 'The mode is used in journal records'))}"` : ''}>${esc(L('Удалить режим', 'Delete mode'))}</button></div>
  </div>`;
}

/** Отметка в заголовке карточки аппарата kV: сколько ошибок или замечаний. */
function kvChip(checks) {
  const err = checks.filter((c) => c.level === 'error').length;
  const warn = checks.filter((c) => c.level === 'warn').length;
  if (err) return `<span class="chip error">${esc(L(`ошибок: ${err}`, `errors: ${err}`))}</span>`;
  if (warn) return `<span class="chip warn">${esc(L(`замечаний: ${warn}`, `warnings: ${warn}`))}</span>`;
  return '';
}

/** Набор пластин для СПО у аппарата: сколько пластин Al и Cu; вводится на листе «СПО и k_Q» вкладки kV. */
function kvPlatesText(m) {
  const n = (mat) => (m.plates ?? []).filter((p) => p.mat === mat).length;
  const al = n('Al');
  const cu = n('Cu');
  if (!al && !cu) return L('Набора пластин для СПО у аппарата нет: его вводят на листе «СПО и k_Q» вкладки «kV-рентген» и сохраняют сюда вместе с аппаратом.', 'The unit has no HVL plate set: it is entered on the “HVL and k_Q” sheet of the kV x-rays tab and saved here together with the unit.');
  const parts = [al ? `Al — ${al}` : '', cu ? `Cu — ${cu}` : ''].filter(Boolean).join(', ');
  return L(`Набор пластин для СПО: ${parts}. Правится на листе «СПО и k_Q» вкладки «kV-рентген» и подставляется туда вместе с режимами.`, `HVL plate set: ${parts}. It is edited on the “HVL and k_Q” sheet of the kV x-rays tab and filled in there together with the modes.`);
}

function kvMachineCard(j, m) {
  const k = 'machine';
  const checks = kvMachineChecks(m, j);
  const hasSessions = j.sessions.some((s) => s.machineId === m.id) || (j.kvRecords ?? []).some((r) => r.machineId === m.id);
  return `<div class="jcard jkv" data-card="machine:${esc(m.id)}">
    <div class="jcard-head"><b>${esc(m.name || L('Новый рентгенотерапевтический аппарат', 'New x-ray therapy unit'))}</b><span class="chips">${kvChip(checks)}<span class="chip none">${esc(L('рентгенотерапевтический аппарат', 'x-ray therapy unit'))}</span></span></div>
    <div class="grid">
      ${field(L('Аппарат', 'Machine'), input(k, m.id, 'name', m.name, { placeholder: 'Xstrahl 300' }), { forId: fieldId(k, m.id, 'name') })}
      ${field(L('Заводской №', 'Serial No.'), input(k, m.id, 'serial', m.serial), { forId: fieldId(k, m.id, 'serial') })}
      ${field(L('№ рентгеновской трубки', 'X-ray tube No.'), input(k, m.id, 'tube', m.tube), { forId: fieldId(k, m.id, 'tube'), sub: L('после замены трубки СПО режимов меряют заново', 'after a tube replacement the HVLs of the modes are measured again') })}
      ${field(L('Примечания', 'Notes'), input(k, m.id, 'notes', m.notes), { forId: fieldId(k, m.id, 'notes') })}
    </div>
    <h3 class="sub-h">${esc(L('Аппликаторы', 'Applicators'))}</h3>
    ${m.applicators.length
      ? `<div class="table-wrap"><table class="factors jf-table jkv-apps-t">
      <thead><tr><th class="no">№</th><th>${esc(L('Обозначение', 'Label'))}</th><th>${esc(L('Форма', 'Shape'))}</th><th>${esc(L('Размер, см', 'Size, cm'))}</th><th>${esc(L('РИП, см', 'SSD, cm'))}</th><th class="v" title="${esc(L('Диаметр круга той же площади: по нему выбирается референсный аппликатор (TRS-398 Rev.1, табл. 31)', 'Diameter of the circle of the same area: used to choose the reference applicator (TRS-398 Rev.1, Table 31)'))}">${esc(L('Ø экв., см', 'Eq. Ø, cm'))}</th><th class="del"><span class="visually-hidden">${esc(L('Удалить', 'Delete'))}</span></th></tr></thead>
      <tbody>${m.applicators.map((a, i) => kvAppRow(j, m, a, i)).join('')}</tbody></table></div>`
      : `<p class="sub-hint">${esc(L('Аппликаторов пока нет: добавьте все тубусы аппарата, а в режимах отметьте, какие с ними используются.', 'No applicators yet: add all applicators of the unit, then tick in each mode which ones are used with it.'))}</p>`}
    ${kvMsgs(checks.filter((c) => c.appId), `kvapps-msgs-${m.id}`)}
    <div class="row-tools"><button type="button" class="link-btn" data-add-kvapp="${esc(m.id)}"><span aria-hidden="true">+</span> ${esc(L('Добавить аппликатор', 'Add an applicator'))}</button></div>
    <h3 class="sub-h">${esc(L('Режимы', 'Modes'))}</h3>
    <div class="jbeams">${m.modes.map((x, i) => kvModeBlock(j, m, x, i, checks)).join('') || `<p class="sub-hint">${esc(L('Режимов пока нет: режим — напряжение, ток, фильтр и СПО со своей камерой и своими аппликаторами.', 'No modes yet: a mode is a voltage, current, filter and HVL with its own chamber and applicators.'))}</p>`}</div>
    <div class="row-tools"><button type="button" class="link-btn" data-add-kvmode="${esc(m.id)}"><span aria-hidden="true">+</span> ${esc(L('Добавить режим', 'Add a mode'))}</button></div>
    <p class="sub-hint jkv-plates">${richText(kvPlatesText(m))}</p>
    <p class="sub-hint">${esc(L('Новый режим копирует диапазон, камеру, электрометр и аппликаторы последнего. Во вкладке «kV-рентген» аппарат выбирается на листе «Аппарат и режимы»: отмеченные режимы подставляются с камерой, её kV-сертификатом, электрометром и аппликаторами, а измеренное возвращается сюда кнопкой «Сохранить аппарат в Оборудование».', 'A new mode copies the range, chamber, electrometer and applicators of the last one. In the kV x-rays tab the unit is selected on the Machine and modes sheet: the ticked modes are filled in with the chamber, its kV certificate, the electrometer and the applicators, and the measured data come back here with “Save the unit to Equipment”.'))}</p>
    <div class="row-tools">
      <button type="button" class="link-btn danger" data-del="machine:${esc(m.id)}"${hasSessions ? ` disabled title="${esc(L('У аппарата есть записи в журнале', 'The machine has records in the journal'))}"` : ''}>${esc(L('Удалить аппарат', 'Delete machine'))}</button>
    </div>
  </div>`;
}

function machineCard(j, m) {
  if (m.kind === 'kv') return kvMachineCard(j, m);
  const k = 'machine';
  const hasSessions = j.sessions.some((s) => s.machineId === m.id) || (j.plateChecks || []).some((p) => p.machineId === m.id);
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
    ${calGeoBlock(m, 'photon')}
    <div class="jbeams">${m.beams.filter((b) => beamKind(b) === 'photon').map((b) => beamCard(j, m, b)).join('') || `<p class="sub-hint">${esc(L('Пучков фотонов пока нет.', 'No photon beams yet.'))}</p>`}</div>
    <div class="row-tools">
      <button type="button" class="link-btn" data-add-beam="${esc(m.id)}"><span aria-hidden="true">+</span> ${esc(L('Добавить пучок фотонов', 'Add a photon beam'))}</button>
    </div>
    <h3 class="sub-h">${esc(L('Пучки электронов', 'Electron beams'))}</h3>
    ${calGeoBlock(m, 'electron')}
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
  for (const m of j.machines) for (const kind of Object.keys(CAL_GEO_KEYS)) geoSeen.set(`${m.id}|${kind}`, calGeoKey(kind, machineCalGeo(m, kind)));
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
  const kvModes = j.machines.reduce((s, m) => s + (m.kind === 'kv' ? m.modes.length : 0), 0);
  const kvText = j.machines.some((m) => m.kind === 'kv') ? L(`; режимов рентгенотерапевтических аппаратов: ${kvModes}`, `; x-ray therapy modes: ${kvModes}`) : '';
  $('#eq-result').innerHTML = `<div class="dose-row"><div class="dose-big">${j.machines.length}<small>${esc(wMachines)} · ${beams} ${esc(wBeams)}</small></div>
    <div class="secondary">${esc(L(`камер: ${j.chambers.length}; электрометров: ${j.electrometers.length}; записей в журнале: ${j.sessions.length + (j.kvRecords?.length ?? 0)}`, `chambers: ${j.chambers.length}; electrometers: ${j.electrometers.length}; records in the journal: ${j.sessions.length + (j.kvRecords?.length ?? 0)}`) + kvText)}</div></div>`;
  const msgs = [];
  for (const d of due) {
    msgs.push(`<li class="${d.status === 'overdue' ? 'warn' : 'info'}"><span class="lvl">${esc(d.status === 'overdue' ? L('Срок калибровки прошёл', 'Calibration overdue') : L('Срок калибровки подходит', 'Calibration due soon'))}</span><span>${esc(`${d.text}: ${d.status === 'overdue' ? L(`до ${fmtDate(d.dueDate)}`, `until ${fmtDate(d.dueDate)}`) : L(`до ${fmtDate(d.dueDate)}, осталось ${d.days} дн.`, `until ${fmtDate(d.dueDate)}, ${d.days} days left`)}`)}</span></li>`);
  }
  const noDue = equipmentNoDue(j);
  if (noDue.length) msgs.push(`<li class="info"><span class="lvl">${esc(L('Срок калибровки не задан', 'No calibration due date'))}</span><span>${esc(L(`${noDue.map((x) => x.text || (x.kind === 'chamber' ? 'камера' : 'электрометр')).join('; ')}: укажите «Действует до» в «Оборудовании», иначе напоминания о сроке калибровки не будет.`, `${noDue.map((x) => x.text || x.kind).join('; ')}: enter "Valid until" in Equipment, otherwise there will be no calibration due reminder.`))}</span></li>`);
  const missItem = (who, miss) => `<li class="info"><span class="lvl">${esc(L('Не заполнено', 'Missing'))}</span><span>${esc(`${who}: `)}${richText(miss.join(', '))}</span></li>`;
  for (const c of j.chambers) {
    // «не заполнено» — по TRS-398 Rev.1 (основной протокол); переключателя протокола в «Оборудовании» нет
    const miss = chamberMissing(c, chamberUses(j, c.id), 'trs');
    if (miss.length) msgs.push(missItem(chamberText(c) || L('камера', 'chamber'), miss));
  }
  for (const e of j.electrometers) {
    const miss = electrometerMissing(e);
    if (miss.length) msgs.push(missItem(electrometerText(e) || L('электрометр', 'electrometer'), miss));
  }
  // рентгенотерапевтические аппараты: ошибки и замечания по аппликаторам и режимам — одной строкой на аппарат
  for (const m of j.machines.filter((x) => x.kind === 'kv')) {
    const list = kvMachineChecks(m, j).filter((c) => c.level !== 'info');
    if (!list.length) continue;
    const err = list.some((c) => c.level === 'error');
    // «режим 1 (…): камера не выбрана, СПО не введён; аппликатор 2: …»
    const groups = new Map();
    for (const c of list) {
      const who = c.text.slice(0, c.text.length - c.short.length - 2);
      groups.set(who, [...(groups.get(who) || []), c.short]);
    }
    const text = [...groups].map(([who, items]) => `${who}: ${items.join(', ')}`).join('; ');
    msgs.push(`<li class="${err ? 'error' : 'warn'}"><span class="lvl">${esc(m.name || L('Рентгенотерапевтический аппарат', 'X-ray therapy unit'))}</span><span>${richText(text)}</span></li>`);
  }
  $('#eq-messages').innerHTML = msgs.join('') || `<li class="info"><span class="lvl">${esc(L('Всё в порядке', 'All clear'))}</span><span>${esc(L('Сроки калибровки заданы и не подходят, у камер и электрометров заполнено всё нужное для расчёта.', 'Calibration due dates are set and not near; chambers and electrometers have what the calculation needs.'))}</span></li>`;
}

// ------------------------------------------------------------ связь с вкладкой «МВ фотоны» и сеансом
/** «Сохранить в журнал» на вкладке: настройки пучка — в журнал (камера и электрометр журнала не меняются). Возвращает текст состояния. */
export function saveBeamFromTab(target, form, title = '') {
  if (!target?.beamId) return '';
  let geoOwn = false;
  updateJournal((j) => {
    const res = saveBeamSettings(j, target.machineId, target.beamId, form, ['electron', 'cobalt'].includes(target.kind) ? target.kind : 'photon');
    geoOwn = !!res.geoOwn;
    return res.journal;
  }, 'equipment');
  return L(`Настройки пучка «${title}» сохранены в журнал (камера и электрометр журнала не менялись). Сохраните журнал в файл.`, `Beam settings "${title}" saved to the journal (the journal chamber and electrometer were not changed). Save the journal to the file.`) + (geoOwn ? ` ${GEO_OWN_TEXT()}` : '');
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
  // подписи, зависящие от вводимых полей (у ⁶⁰Co — с чем сравнивается мощность дозы после замены источника; у аппарата
  // kV — заголовки режимов, списки аппликаторов, референсный аппликатор и замечания)
  for (const live of fresh.querySelectorAll('[data-live]')) {
    const cur = card.querySelector(`[data-live="${CSS.escape(live.dataset.live)}"]`);
    if (cur) cur.innerHTML = live.innerHTML;
  }
}

/** Записать значение поля в журнал. Списки и подписи полей перерисовываются после выбора в списке или флажка. */
function onInput(e) {
  const el = e.target.closest('[data-bind]');
  if (!el) return;
  // «вид|id|путь»: id из файла журнала может содержать «|» — вид до первой черты, путь после последней
  const b = el.dataset.bind;
  const [kind, id, path] = [b.slice(0, b.indexOf('|')), b.slice(b.indexOf('|') + 1, b.lastIndexOf('|')), b.slice(b.lastIndexOf('|') + 1)];
  const value = el.type === 'checkbox' ? el.checked : kind === 'beam' && path === 'geoOwn' ? el.value === 'own' : el.value;
  updateJournal((j) => {
    const list =
      kind === 'chamber' ? j.chambers
        : kind === 'electrometer' ? j.electrometers
          : kind === 'machine' ? j.machines
            : kind === 'kvapp' ? j.machines.flatMap((m) => m.applicators || [])
              : kind === 'kvmode' ? j.machines.flatMap((m) => m.modes || [])
                : j.machines.flatMap((m) => m.beams);
    const obj = list.find((x) => x.id === id);
    if (!obj) return j;
    // флажок аппликатора у режима: «app:<id аппликатора>»; снятый референсный перестаёт быть референсным
    if (kind === 'kvmode' && path.startsWith('app:')) {
      const aid = path.slice(4);
      const m = j.machines.find((x) => (x.modes || []).includes(obj));
      obj.applicators = value ? (m?.applicators || []).map((a) => a.id).filter((x) => x === aid || obj.applicators.includes(x)) : obj.applicators.filter((x) => x !== aid);
      if (!value && obj.refApplicator === aid) obj.refApplicator = '';
      return j;
    }
    const parts = path.split('.');
    let o = obj;
    for (const p of parts.slice(0, -1)) o = o[p] ??= {};
    o[parts.at(-1)] = value;
    // «FFF» / «БВФ» в названии пучка фотонов ставит отметку сам; у пучка электронов по названию — энергия
    if (kind === 'beam' && path === 'name' && beamKind(obj) === 'photon' && /(^|[^\p{L}])(fff|бвф)([^\p{L}]|$)/iu.test(value)) obj.form.meta_fff = true;
    // другой производитель — модель выбирается заново (у «другого» электрометра своё название сохраняется)
    if (kind === 'chamber' && path === 'maker') {
      const cur = obj.form.ch_model ?? '';
      const keep = value === OTHER_MAKER ? cur === 'OTHER' || cur === 'CUSTOM' : findChamber(cur)?.maker === value || findEChamber(cur)?.maker === value || findKvOnlyChamber(cur)?.maker === value;
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
    // геометрия калибровки аппарата — в пучки «как у аппарата»; пучок, вернувшийся к «как у аппарата», получает её же
    if (kind === 'machine' && path.startsWith('calGeo.')) syncCalGeo(obj);
    if (kind === 'beam' && path === 'geoOwn') {
      const m = j.machines.find((x) => x.beams.includes(obj));
      if (m) syncCalGeo(m);
    }
    return j;
  }, 'equipment:input');
  if (kind === 'machine' && path.startsWith('calGeo.') && e.type === 'change') {
    const m = getJournal().machines.find((x) => x.id === id);
    if (m) geoChanged(m, path.split('.')[1]);
  }
  if (kind === 'beam' && path === 'name') {
    const box = document.getElementById(fieldId('beam', id, 'form.meta_fff'));
    if (box && getJournal().machines.flatMap((m) => m.beams).find((x) => x.id === id)?.form.meta_fff) box.checked = true;
  }
  // у геометрии аппарата и после ввода числа: подписи «как у аппарата» в карточках пучков
  if (e.type === 'change' && (el.tagName === 'SELECT' || el.type === 'checkbox' || (kind === 'machine' && path.startsWith('calGeo.')))) {
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
      // у режимов аппаратов kV камера и электрометр снимаются: режим попросит выбрать другие
      for (const m of j.machines) for (const x of m.modes || []) if (x[key] === a) x[key] = '';
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
    } else if (kind === 'kvapp') {
      const m = j.machines.find((x) => x.id === a);
      if (m) {
        m.applicators = m.applicators.filter((x) => x.id !== b);
        for (const x of m.modes) {
          x.applicators = x.applicators.filter((y) => y !== b);
          if (x.refApplicator === b) x.refApplicator = '';
        }
      }
    } else if (kind === 'kvmode') {
      const m = j.machines.find((x) => x.id === a);
      if (m) m.modes = m.modes.filter((x) => x.id !== b);
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
      const m = j.machines.find((x) => x.id === t.dataset.addBeam);
      // геометрия калибровки — аппарата (syncCalGeo)
      m?.beams.push({ ...BEAM_DEFAULTS, id, name: '', chamberId: j.chambers.find((c) => photonCapable(c.form))?.id ?? '', electrometerId: j.electrometers[0]?.id ?? '', form: { rd_V1: FORM_DEFAULTS.rd_V1, rd_V2: FORM_DEFAULTS.rd_V2, rd_polarity: '+', rd_mu: '100', dd_nominal: '1,000', dd_tol: '2', qtrs_method: 'ratio', kqtrs_mode: 'formula' } });
      if (m) syncCalGeo(m);
      return j;
    }, 'equipment');
    document.getElementById(fieldId('beam', id, 'name'))?.focus();
  } else if (t.dataset.addEbeam) {
    const id = uid('b');
    updateJournal((j) => {
      const ch = j.chambers.find((c) => electronCapable(c.form));
      const m = j.machines.find((x) => x.id === t.dataset.addEbeam);
      m?.beams.push({
        ...BEAM_DEFAULTS, id, kind: 'electron', name: '', chamberId: ch?.id ?? '', electrometerId: j.electrometers[0]?.id ?? '',
        form: { e_field: '10', e_r50_method: 'i50', e_mu: '100', e_polarity: '+', e_V1: E_DEFAULTS.e_V1, e_V2: E_DEFAULTS.e_V2, e_beam_mode: 'pulsed', e_nominal: '1,000', e_tol: '2', e_kqtrs_mode: 'table', e_kq51_mode: 'fit' },
      });
      if (m) syncCalGeo(m);
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
  } else if (t.dataset.addKvapp) {
    // новый аппликатор — с формой и РИП последнего; в режимах, где отмечены все аппликаторы, отмечается и он
    const m0 = getJournal().machines.find((x) => x.id === t.dataset.addKvapp);
    const a = newKvApplicator(m0?.applicators.at(-1));
    updateJournal((j) => {
      const m = j.machines.find((x) => x.id === t.dataset.addKvapp);
      if (!m) return j;
      for (const x of m.modes) if (m.applicators.every((y) => x.applicators.includes(y.id))) x.applicators.push(a.id);
      m.applicators.push(a);
      return j;
    }, 'equipment');
    document.getElementById(fieldId('kvapp', a.id, 'name'))?.focus();
  } else if (t.dataset.addKvmode) {
    // новый режим копирует диапазон, камеру, электрометр и аппликаторы последнего; первый — со всеми аппликаторами
    const m0 = getJournal().machines.find((x) => x.id === t.dataset.addKvmode);
    const last = m0?.modes.at(-1) ?? null;
    const x = newKvMachineMode(last, last ? {} : { applicators: (m0?.applicators || []).map((a) => a.id) });
    updateJournal((j) => {
      j.machines.find((y) => y.id === t.dataset.addKvmode)?.modes.push(x);
      return j;
    }, 'equipment');
    document.getElementById(fieldId('kvmode', x.id, 'kv'))?.focus();
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
  } else if (t.id === 'eq-add-kv') {
    const id = uid('m');
    updateJournal((j) => {
      j.machines.push(normalizeKvMachine({ ...MACHINE_DEFAULTS, id, kind: 'kv' }));
      return j;
    }, 'equipment');
    document.getElementById(fieldId('machine', id, 'name'))?.focus();
  } else if (t.id === 'eq-add-machine' || t.id === 'eq-add-cobalt') {
    updateJournal((j) => {
      j.machines.push({ ...MACHINE_DEFAULTS, id: uid('m'), kind: t.id === 'eq-add-cobalt' ? 'cobalt' : 'linac', calGeo: { photon: machineCalGeo(null, 'photon'), electron: machineCalGeo(null, 'electron') }, beams: [] });
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
