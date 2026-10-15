// «Журнал» → «Оборудование»: учреждение, камеры, электрометры, ускорители с пучками фотонов и электронов, аппараты ⁶⁰Co. Всё хранится
// в журнале. Поля пучка здесь — основные; остальные настройки (k_vol, поправки по глубине и т. п.) редактируются на
// вкладке дозиметрии кнопкой «Все настройки» и возвращаются в журнал кнопкой «Сохранить в журнал».
import { L, getLang } from '../core/i18n.js';
import { CHAMBERS, chamberLabel, chamberNote } from '../core/chambers.js';
import { NDW_UNITS, unitLabel, parseNumber, isBlank } from '../core/units.js';
import { FORM_DEFAULTS, normalizeForm } from '../core/photons.js';
import { E_DEFAULTS, normalizeElectrons, parseElectronBeam } from '../core/electrons.js';
import { E_CHAMBERS, eChamberLabel } from '../core/electron-chambers.js';
import { CO_DEFAULTS, normalizeCobalt, ACTIVITY_UNITS } from '../core/cobalt.js';
import * as TRS from '../core/trs398.js';
import {
  uid, CHAMBER_DEFAULTS, ELECTROMETER_DEFAULTS, MACHINE_DEFAULTS, BEAM_DEFAULTS, chamberText, electrometerText, beamFromTabForm, applyTabFormToBeam, equipmentDue,
  chamberMissing, electrometerMissing, chamberUses, photonCapable, electronCapable, electronChamberForm, beamKind, lastCalibration,
  cobaltCapable, cobaltChamberForm, myChambersToJournal,
} from '../core/journal.js';
import { getMyChambers } from './store.js';
import { $, esc, fmt, makeStatus, armButton, notifyUpdate, today, richText, currentProtocol, plainSymbols } from './common.js';
import { localizeDecimals } from './i18n.js';
import { getJournal, updateJournal, onJournal } from './journal-store.js';
import { setupFilePanel, dueChip, fmtDate, countWord } from './journal-common.js';

let setStatus = () => {};
let tabBridge = { current: () => null, edit: () => {} };
/** Связь с вкладками дозиметрии: current(kind) — форма вкладки, edit(kind, form, { title, target }) — пучок во вкладке. */
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
function chamberModelOptions(cur) {
  const groups = new Map();
  for (const c of CHAMBERS) {
    if (!groups.has(c.maker)) groups.set(c.maker, []);
    groups.get(c.maker).push(c);
  }
  const parts = [`<option value="">${esc(L('— выберите камеру —', '— select a chamber —'))}</option>`];
  for (const [maker, list] of groups) parts.push(`<optgroup label="${esc(maker)}">${list.map((c) => `<option value="${esc(c.id)}"${c.id === cur ? ' selected' : ''}>${esc(c.model)}${c.note ? ` — ${esc(plainSymbols(chamberNote(c)))}` : ''}</option>`).join('')}</optgroup>`);
  // плоскопараллельные — только для электронов (цилиндрические из базы электронов есть и в списках выше)
  const pp = E_CHAMBERS.filter((c) => c.type === 'pp');
  parts.push(`<optgroup label="${esc(L('Плоскопараллельные — для электронов и ⁶⁰Co', 'Plane-parallel: for electrons and ⁶⁰Co'))}">${pp.map((c) => `<option value="${esc(c.id)}"${c.id === cur ? ' selected' : ''}>${esc(eChamberLabel(c))}</option>`).join('')}</optgroup>`);
  parts.push(`<option value="OTHER"${cur === 'OTHER' ? ' selected' : ''}>${esc(plainSymbols(L('Другая камера — для электронов, k_Q вручную…', 'Other chamber: for electrons, k_Q entered manually…')))}</option>`);
  if (cur === 'CUSTOM') parts.push(`<option value="CUSTOM" selected>${esc(L('Своя камера (из вкладки «МВ фотоны»)', 'Custom chamber (from the MV photons tab)'))}</option>`);
  return parts.join('');
}

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
  return `<div class="jcard" data-card="chamber:${esc(c.id)}">
    <div class="jcard-head"><b>${esc(chamberText(c) || L('Новая камера', 'New chamber'))}</b><span class="chips">${missChip(chamberMissing(c, uses, currentProtocol()))}${dueChip(c.dueDate)}</span></div>
    <div class="grid">
      ${field(L('Камера', 'Chamber'), `<select ${bind(k, c.id, 'form.ch_model')}>${chamberModelOptions(f.ch_model)}</select>`, { forId: fieldId(k, c.id, 'form.ch_model'), cls: 'span-2', sub: [custom ? esc([f.cc_maker, f.cc_model].filter(Boolean).join(' ')) : '', ph && el ? esc(L('для фотонов, электронов и ⁶⁰Co', 'for photons, electrons and ⁶⁰Co')) : el ? esc(L('для электронов и ⁶⁰Co', 'for electrons and ⁶⁰Co')) : ph ? esc(L('для фотонов и ⁶⁰Co', 'for photons and ⁶⁰Co')) : ''].filter(Boolean).join(' · ') })}
      ${field(L('Заводской №', 'Serial No.'), input(k, c.id, 'form.ch_serial', f.ch_serial), { forId: fieldId(k, c.id, 'form.ch_serial') })}
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
      ${field(L('Дата калибровки', 'Calibration date'), input(k, c.id, 'calDate', c.calDate, { type: 'date' }), { forId: fieldId(k, c.id, 'calDate') })}
      ${field(L('Действует до', 'Valid until'), input(k, c.id, 'dueDate', c.dueDate, { type: 'date' }), { forId: fieldId(k, c.id, 'dueDate'), sub: L('за 30 дней до срока появится напоминание', 'a reminder appears 30 days before') })}
      ${field(L('Примечания', 'Notes'), input(k, c.id, 'notes', c.notes), { forId: fieldId(k, c.id, 'notes'), cls: 'span-2' })}
    </div>
    <div class="row-tools"><button type="button" class="link-btn danger" data-del="chamber:${esc(c.id)}">${esc(L('Удалить камеру', 'Delete chamber'))}</button></div>
  </div>`;
}

function electrometerCard(e) {
  const f = e.form || {};
  const k = 'electrometer';
  return `<div class="jcard" data-card="electrometer:${esc(e.id)}">
    <div class="jcard-head"><b>${esc(electrometerText(e) || L('Новый электрометр', 'New electrometer'))}</b><span class="chips">${missChip(electrometerMissing(e))}${dueChip(e.dueDate)}</span></div>
    <div class="grid">
      ${field(L('Модель', 'Model'), input(k, e.id, 'form.el_model', f.el_model, { placeholder: 'PTW UNIDOS webline' }), { forId: fieldId(k, e.id, 'form.el_model') })}
      ${field(L('Заводской №', 'Serial No.'), input(k, e.id, 'form.el_serial', f.el_serial), { forId: fieldId(k, e.id, 'form.el_serial') })}
      ${field('k<sub>elec</sub>', input(k, e.id, 'form.el_kelec', f.el_kelec ?? '1,000', { num: true }), { forId: fieldId(k, e.id, 'form.el_kelec'), sub: L('1,000, если камера калибровалась вместе с электрометром', '1.000 if the chamber was calibrated together with the electrometer') })}
      ${field(L('Дата калибровки', 'Calibration date'), input(k, e.id, 'calDate', e.calDate, { type: 'date' }), { forId: fieldId(k, e.id, 'calDate') })}
      ${field(L('Действует до', 'Valid until'), input(k, e.id, 'dueDate', e.dueDate, { type: 'date' }), { forId: fieldId(k, e.id, 'dueDate') })}
      ${field(L('Примечания', 'Notes'), input(k, e.id, 'notes', e.notes), { forId: fieldId(k, e.id, 'notes') })}
    </div>
    <div class="row-tools"><button type="button" class="link-btn danger" data-del="electrometer:${esc(e.id)}">${esc(L('Удалить электрометр', 'Delete electrometer'))}</button></div>
  </div>`;
}

// ------------------------------------------------------------ пучки
/** TPR₂₀,₁₀ по сохранённым значениям профиля (для подписи). */
function tprOf(form) {
  const v20 = parseNumber(form.qtrs_v20);
  const v10 = parseNumber(form.qtrs_v10);
  if (!Number.isFinite(v20) || !Number.isFinite(v10) || v10 === 0) return NaN;
  const r = Math.abs(v20 / v10);
  return form.qtrs_method === 'pdd2010' ? TRS.tprFromPdd2010(r) : r;
}

/** Краткое описание остальных настроек пучка — того, что редактируется на вкладке. */
function beamExtras(f) {
  const bits = [];
  bits.push({ formula: L('k_Q по ур. 34', 'k_Q by Eq. 34'), table: L('k_Q по табл. 16', 'k_Q by Table 16'), manual: L(`k_Q = ${f.kqtrs_manual || '—'} (лаборатория)`, `k_Q = ${f.kqtrs_manual || '—'} (laboratory)`) }[f.kqtrs_mode] ?? '');
  if (f.meta_fff) bits.push(L(`k_vol: ${{ formula22: 'ур. 22', table11: 'табл. 11', manual: f.prof_value || 'вручную', profile: 'по профилю' }[f.prof_mode] ?? '—'}`, `k_vol: ${{ formula22: 'Eq. 22', table11: 'Table 11', manual: f.prof_value || 'manual', profile: 'from profile' }[f.prof_mode] ?? '—'}`));
  if (f.q_rec_on) bits.push(L('поправка на рекомбинацию по глубине', 'recombination correction with depth'));
  return bits.filter(Boolean).join(' · ');
}

/** Чего не хватает пучку для расчёта в сеансе (без показаний). */
export function beamMissing(j, b) {
  const f = { ...FORM_DEFAULTS, ...b.form };
  const blank = (k) => isBlank(f[k]);
  const sad = f.setup_geometry === 'SAD';
  const ch = j.chambers.find((c) => c.id === b.chamberId);
  const el = j.electrometers.find((e) => e.id === b.electrometerId);
  const chMiss = ch ? chamberMissing(ch, { photon: true }, currentProtocol()) : [];
  const elMiss = el ? electrometerMissing(el) : [];
  if (beamKind(b) === 'electron') return ebeamMissing(j, b, ch, chMiss, el, elMiss);
  if (beamKind(b) === 'cobalt') return cobeamMissing(j, b, ch, el, elMiss);
  return [
    !ch && L('камера', 'chamber'),
    ch && !isBlank(ch.form?.ch_model) && !photonCapable(ch.form) && L('камера не для фотонов', 'chamber not for photons'),
    chMiss.length && L(`у камеры ${chMiss.join(', ')}`, `chamber ${chMiss.join(', ')}`),
    !el && L('электрометр', 'electrometer'),
    elMiss.length && L(`у электрометра ${elMiss.join(', ')}`, `electrometer ${elMiss.join(', ')}`),
    blank('rd_V1') && 'V₁',
    blank('rd_V2') && 'V₂',
    blank('rd_mu') && L('МЕ', 'MU'),
    f.dd_on && blank('dd_zmax') && 'd_max',
    f.dd_on && (sad && f.dd_sad === 'tmr' ? blank('dd_tmr') && 'TMR(10)' : blank('dd_pdd') && 'PDD(10)'),
    // качество пучка нужно проверке выхода, пока в журнале нет калибровки пучка (потом оно берётся из калибровки)
    !lastCalibration(j, b.id) && (currentProtocol() === 'tg51' ? blank(f.q51_method === 'foil50' || f.q51_method === 'foil30' ? 'q51_pdd10pb' : f.q51_method === 'manual' ? 'q51_manual' : 'q51_pdd10') && L('%dd(10) (до первой калибровки)', '%dd(10) (before the first calibration)') : (blank('qtrs_v20') || blank('qtrs_v10')) && L('TPR_20,10 (до первой калибровки)', 'TPR_20,10 (before the first calibration)')),
  ].filter(Boolean);
}

/** Что не заполнено у пучка электронов. */
function ebeamMissing(j, b, ch, _chMiss, el, elMiss) {
  const f = { ...E_DEFAULTS, ...b.form };
  const blank = (k) => isBlank(f[k]);
  const chMiss = ch ? chamberMissing(ch, { electron: true }, currentProtocol()) : [];
  const other = ch?.form?.ch_model === 'OTHER' || (ch && electronChamberForm(ch.form).e_ch_model === 'OTHER');
  return [
    !ch && L('камера', 'chamber'),
    ch && !isBlank(ch.form?.ch_model) && !electronCapable(ch.form) && L('камера не для электронов', 'chamber not for electrons'),
    chMiss.length && L(`у камеры ${chMiss.join(', ')}`, `chamber ${chMiss.join(', ')}`),
    !el && L('электрометр', 'electrometer'),
    elMiss.length && L(`у электрометра ${elMiss.join(', ')}`, `electrometer ${elMiss.join(', ')}`),
    blank('e_V1') && 'V₁',
    blank('e_V2') && 'V₂',
    blank('e_mu') && L('МЕ', 'MU'),
    // камера не из таблиц протоколов: k_Q только вручную
    (f.e_kqtrs_mode === 'manual' ? blank('e_kqtrs_manual') : other) && 'k_Q (TRS-398)',
    (f.e_kq51_mode === 'manual' ? blank('e_kq51_manual') : other) && 'k_Q (TG-51)',
    // R50 и PDD(z_ref) нужны проверке выхода, пока в журнале нет калибровки пучка
    !lastCalibration(j, b.id) && blank(f.e_r50_method === 'r50' ? 'e_r50' : 'e_i50') && L(`${f.e_r50_method === 'r50' ? 'R_50' : 'I_50'} (до первой калибровки)`, `${f.e_r50_method === 'r50' ? 'R_50' : 'I_50'} (before the first calibration)`),
    f.e_dd_on && !lastCalibration(j, b.id) && blank('e_pdd') && L('PDD(z_ref) (до первой калибровки)', 'PDD(z_ref) (before the first calibration)'),
  ].filter(Boolean);
}

/** Что не заполнено у пучка ⁶⁰Co. */
function cobeamMissing(j, b, ch, el, elMiss) {
  const f = { ...CO_DEFAULTS, ...b.form };
  const blank = (k) => isBlank(f[k]);
  const chMiss = ch ? chamberMissing(ch, { cobalt: true }, currentProtocol()) : [];
  const sad = f.co_geometry === 'SAD';
  return [
    !ch && L('камера', 'chamber'),
    chMiss.length && L(`у камеры ${chMiss.join(', ')}`, `chamber ${chMiss.join(', ')}`),
    !el && L('электрометр', 'electrometer'),
    elMiss.length && L(`у электрометра ${elMiss.join(', ')}`, `electrometer ${elMiss.join(', ')}`),
    blank('co_distance') && (sad ? L('РИК', 'SCD') : L('РИП', 'SSD')),
    blank('co_V1') && 'V₁',
    blank('co_V2') && 'V₂',
    blank('co_time') && L('время облучения', 'irradiation time'),
    // известное τ нужно и калибровке; при проверке выхода τ берётся из калибровки, а без неё — отсюда
    f.co_timer_mode === 'manual' && blank('co_tau') && 'τ',
    f.co_timer_mode === 'nexp' && (blank('co_nx_t') || blank('co_nx_n')) && L('t и n для ошибки таймера', 't and n for the timer error'),
    f.co_dd_on && blank('co_zmax') && 'z_max',
    f.co_dd_on && (sad && f.co_dd_sad !== 'pdd' ? blank('co_tmr') && `TMR(${f.co_zref || 5})` : blank('co_pdd') && `PDD(${f.co_zref || 5})`),
  ].filter(Boolean);
}

/** Варианты камер для пучка: годные для этого вида пучков (и выбранная сейчас, даже если не годится). */
function chamberOptions(j, b, kind) {
  const can = { electron: electronCapable, cobalt: cobaltCapable }[kind] ?? photonCapable;
  const ok = (c) => can(c.form) || c.id === b.chamberId;
  return [['', L('— камера —', '— chamber —')], ...j.chambers.filter(ok).map((c) => [c.id, chamberText(c)])];
}

/** Карточка пучка электронов. */
function ebeamCard(j, m, b) {
  const f = { ...E_DEFAULTS, ...b.form };
  const k = 'beam';
  const id = b.id;
  const elOpts = [['', L('— электрометр —', '— electrometer —')], ...j.electrometers.map((e) => [e.id, electrometerText(e)])];
  const used = j.sessions.some((s) => s.beams.some((x) => x.beamId === id));
  const nom = parseNumber(f.e_nominal);
  const tolN = parseNumber(f.e_tol);
  const tolT = Number.isFinite(tolN) && tolN > 0 ? fmt(tolN, 3).replace(/[.,]?0+$/, '') : '2';
  const at = f.e_dd_on && f.e_nominal_at !== 'zref' ? 'z_max' : 'z_ref';
  const r50 = f.e_r50_method === 'r50' ? parseNumber(f.e_r50) : NaN;
  const i50 = f.e_r50_method !== 'r50' ? parseNumber(f.e_i50) : NaN;
  const miss = b.active === false ? [] : beamMissing(j, b);
  const head = [b.name || L('Новый пучок электронов', 'New electron beam'), chamberText(j.chambers.find((c) => c.id === b.chamberId)), Number.isFinite(r50) ? `R₅₀ ${fmt(r50, 2)}` : Number.isFinite(i50) ? `I₅₀ ${fmt(i50, 2)}` : '', Number.isFinite(nom) ? L(`номинал ${fmt(nom, 3)} сГр/МЕ на ${at} ±${tolT} %`, `nominal ${fmt(nom, 3)} cGy/MU at ${at} ±${tolT}%`) : '']
    .filter(Boolean)
    .join(' · ');
  const trsMode = [['table', L('табл. 20 / 21', 'Table 20 / 21')], ['formula', L('аппроксимация прил. II', 'App. II fit')], ['manual', L('вручную', 'manual')]];
  const tgMode = [['fit', L('Report 385', 'Report 385')], ['manual', L('вручную', 'manual')]];
  return `<details class="jbeam" data-card="beam:${esc(id)}"${b._open ? ' open' : ''}>
    <summary><span class="jbeam-name">${richText(head)}</span>${b.active === false ? `<span class="chip none">${esc(L('не в сеансах', 'not in sessions'))}</span>` : missChip(miss)}</summary>
    <div class="grid">
      ${field(L('Пучок', 'Beam'), input(k, id, 'name', b.name, { placeholder: L('12 МэВ', '12 MeV') }), { forId: fieldId(k, id, 'name'), sub: L('как в протоколе; энергия — по названию', 'as in the report; the energy comes from the name') })}
      <div class="field">${check(k, id, 'active', b.active !== false, L('используется в сеансах', 'used in sessions'))}</div>
      ${field(L('Камера', 'Chamber'), select(k, id, 'chamberId', b.chamberId, chamberOptions(j, b, 'electron')), { forId: fieldId(k, id, 'chamberId') })}
      ${field(L('Электрометр', 'Electrometer'), select(k, id, 'electrometerId', b.electrometerId, elOpts), { forId: fieldId(k, id, 'electrometerId') })}
      ${field(L('V₁ рабочее, В', 'V₁ operating, V'), input(k, id, 'form.e_V1', f.e_V1, { num: true }), { forId: fieldId(k, id, 'form.e_V1') })}
      ${field(L('V₂ пониженное, В', 'V₂ reduced, V'), input(k, id, 'form.e_V2', f.e_V2, { num: true }), { forId: fieldId(k, id, 'form.e_V2') })}
      ${field(L('Полярность', 'Polarity'), select(k, id, 'form.e_polarity', f.e_polarity, [['+', L('положительная (+)', 'positive (+)')], ['-', L('отрицательная (−)', 'negative (−)')]]), { forId: fieldId(k, id, 'form.e_polarity') })}
      ${field(L('МЕ за облучение', 'MU per irradiation'), input(k, id, 'form.e_mu', f.e_mu, { num: true }), { forId: fieldId(k, id, 'form.e_mu') })}
      ${field(L('Режим пучка', 'Beam mode'), select(k, id, 'form.e_beam_mode', f.e_beam_mode, [['pulsed', L('импульсный', 'pulsed')], ['scanned', L('импульсно-сканирующий', 'pulsed-scanned')]]), { forId: fieldId(k, id, 'form.e_beam_mode') })}
      ${field(L('РИП, см', 'SSD, cm'), input(k, id, 'form.e_ssd', f.e_ssd, { num: true }), { forId: fieldId(k, id, 'form.e_ssd') })}
      ${field(L('Поле (аппликатор), см', 'Field (applicator), cm'), input(k, id, 'form.e_field', f.e_field, { num: true }), { forId: fieldId(k, id, 'form.e_field') })}
    </div>
    <h4 class="sub-h">${L('Пересчёт на z<sub>max</sub> и номинальный выход', 'Transfer to z<sub>max</sub> and nominal output')}</h4>
    <div class="grid">
      <div class="field">${check(k, id, 'form.e_dd_on', f.e_dd_on, L('пересчитывать дозу на z<sub>max</sub>', 'transfer the dose to z<sub>max</sub>'))}</div>
      ${field(L('Номинальный выход, сГр/МЕ', 'Nominal output, cGy/MU'), input(k, id, 'form.e_nominal', f.e_nominal, { num: true }), { forId: fieldId(k, id, 'form.e_nominal'), sub: L('= Гр на 100 МЕ; пусто — без сравнения', '= Gy per 100 MU; blank: no comparison') })}
      ${f.e_dd_on ? field(L('Номинал задан', 'Nominal given'), select(k, id, 'form.e_nominal_at', f.e_nominal_at, [['zmax', L('на z_max', 'at z_max')], ['zref', L('на опорной глубине', 'at the reference depth')]]), { forId: fieldId(k, id, 'form.e_nominal_at') }) : field(L('Номинал задан', 'Nominal given'), `<input type="text" value="${esc(L('на опорной глубине', 'at the reference depth'))}" disabled>`, { sub: L('без пересчёта на z<sub>max</sub>', 'no transfer to z<sub>max</sub>') })}
      ${field(L('Допуск, ±%', 'Tolerance, ±%'), input(k, id, 'form.e_tol', f.e_tol, { num: true, placeholder: '2' }), { forId: fieldId(k, id, 'form.e_tol') })}
    </div>
    <h4 class="sub-h">${esc(L('Качество пучка — последнее измеренное', 'Beam quality: the last measured'))}</h4>
    <p class="sub-hint">${esc(L('Нужно для проверки выхода, пока в журнале нет калибровки пучка; при калибровке R50 и PDD(z_ref) вводятся в сеансе.', 'Needed for output checks until the journal has a calibration of the beam; at a calibration R50 and PDD(z_ref) are entered in the session.')).replace('z_ref', 'z<sub>ref</sub>')}</p>
    <div class="grid">
      ${field(L('Как получен R<sub>50</sub>', 'How R<sub>50</sub> is obtained'), select(k, id, 'form.e_r50_method', f.e_r50_method, [['i50', L('по I_50 (ионизация)', 'from I_50 (ionization)')], ['r50', L('R_50 известен', 'R_50 known')]]), { forId: fieldId(k, id, 'form.e_r50_method') })}
      ${f.e_r50_method === 'r50'
        ? field(L('R<sub>50</sub>, г/см²', 'R<sub>50</sub>, g/cm²'), input(k, id, 'form.e_r50', f.e_r50, { num: true }), { forId: fieldId(k, id, 'form.e_r50') })
        : field(L('R<sub>50,ion</sub> (I<sub>50</sub>), г/см²', 'R<sub>50,ion</sub> (I<sub>50</sub>), g/cm²'), input(k, id, 'form.e_i50', f.e_i50, { num: true }), { forId: fieldId(k, id, 'form.e_i50') })}
      ${field('PDD(z<sub>ref</sub>), %', input(k, id, 'form.e_pdd', f.e_pdd, { num: true }), { forId: fieldId(k, id, 'form.e_pdd'), sub: L('для пересчёта на z<sub>max</sub>', 'for the transfer to z<sub>max</sub>') })}
    </div>
    <h4 class="sub-h">k<sub>Q</sub></h4>
    <div class="grid">
      ${field('TRS-398', select(k, id, 'form.e_kqtrs_mode', f.e_kqtrs_mode, trsMode), { forId: fieldId(k, id, 'form.e_kqtrs_mode') })}
      ${f.e_kqtrs_mode === 'manual' ? field(L('k<sub>Q</sub> (TRS-398) вручную', 'k<sub>Q</sub> (TRS-398) manual'), input(k, id, 'form.e_kqtrs_manual', f.e_kqtrs_manual, { num: true }), { forId: fieldId(k, id, 'form.e_kqtrs_manual') }) : ''}
      ${field('TG-51', select(k, id, 'form.e_kq51_mode', f.e_kq51_mode, tgMode), { forId: fieldId(k, id, 'form.e_kq51_mode') })}
      ${f.e_kq51_mode === 'manual' ? field(L('k<sub>Q</sub> (TG-51) вручную', 'k<sub>Q</sub> (TG-51) manual'), input(k, id, 'form.e_kq51_manual', f.e_kq51_manual, { num: true }), { forId: fieldId(k, id, 'form.e_kq51_manual') }) : ''}
    </div>
    <div class="row-tools">
      <button type="button" class="link-btn" data-edit-tab="${esc(m.id)}:${esc(id)}">${esc(L('Все настройки — во вкладке «Электроны»', 'All settings: in the Electrons tab'))}</button>
      <button type="button" class="link-btn danger" data-del="beam:${esc(m.id)}:${esc(id)}"${used ? ` disabled title="${esc(L('Пучок есть в сеансах журнала: снимите «используется в сеансах», чтобы убрать его из новых сеансов', 'The beam is in journal sessions: clear "used in sessions" to exclude it from new sessions'))}"` : ''}>${esc(L('Удалить пучок', 'Delete beam'))}</button>
    </div>
  </details>`;
}

/** Карточка пучка ⁶⁰Co. */
function cobeamCard(j, m, b) {
  const f = { ...CO_DEFAULTS, ...b.form };
  const k = 'beam';
  const id = b.id;
  const elOpts = [['', L('— электрометр —', '— electrometer —')], ...j.electrometers.map((e) => [e.id, electrometerText(e)])];
  const used = j.sessions.some((s) => s.beams.some((x) => x.beamId === id));
  const sad = f.co_geometry === 'SAD';
  const unit = f.co_time_unit === 's' ? L('с', 's') : L('мин', 'min');
  const tolN = parseNumber(f.co_tol);
  const tolT = Number.isFinite(tolN) && tolN > 0 ? fmt(tolN, 3).replace(/[.,]?0+$/, '') : '2';
  const refSrc = b.refSrc === 'profile' ? 'profile' : 'last';
  // число из поля — с десятичным разделителем текущего языка
  const loc = (v) => (getLang() === 'en' ? String(v ?? '').replace(/(\d),(\d)/g, '$1.$2') : String(v ?? '').replace(/(\d)\.(\d)/g, '$1,$2'));
  const last = lastCalibration(j, id);
  const miss = b.active === false ? [] : beamMissing(j, b);
  const timerName = { measured: L('τ по облучениям с разным временем', 'τ from exposures of different duration'), nexp: L('τ: t против n·t/n', 'τ: t vs n·t/n'), window: L('заряд при выдвинутом источнике', 'charge with the source exposed'), manual: L('τ известна', 'known τ'), none: L('τ не учитывается', 'τ not accounted for') }[f.co_timer_mode] ?? '';
  const head = [
    b.name || L('Новый пучок ⁶⁰Co', 'New ⁶⁰Co beam'),
    chamberText(j.chambers.find((c) => c.id === b.chamberId)),
    `t = ${loc(f.co_time) || '—'} ${unit}`,
    timerName,
    refSrc === 'last' ? L(`сравнение с калибровкой ±${tolT} %`, `compared with the calibration ±${tolT}%`) : !isBlank(f.co_ref_rate) ? L(`сравнение с ${loc(f.co_ref_rate)} сГр/мин ±${tolT} %`, `compared with ${loc(f.co_ref_rate)} cGy/min ±${tolT}%`) : '',
  ].filter(Boolean).join(' · ');
  const zOpts = [['5', L('5 г/см² (TRS-398)', '5 g/cm² (TRS-398)')], ['10', L('10 г/см² (TRS-398, TG-51)', '10 g/cm² (TRS-398, TG-51)')]];
  const timerOpts = [['measured', L('по облучениям с разным временем', 'from exposures of different duration')], ['nexp', L('одно облучение t против n облучений по t/n', 'one exposure t vs n exposures of t/n')], ['window', L('заряд накоплен при выдвинутом источнике', 'charge collected with the source exposed')], ['manual', L('известное значение', 'known value')], ['none', L('не учитывать', 'do not account for')]];
  const act = String(f.co_act_date ?? '').trim();
  const oldSource = !!last && !isBlank(act) && (String(last.date) < act || (!isBlank(last.actDate) && last.actDate !== act));
  const refNote = refSrc === 'last'
    ? oldSource
      ? L(`Последняя калибровка (от ${fmtDate(last.date)}) сделана с прежним источником: до калибровки нового источника используется значение ниже, если оно задано на дату не раньше установки.`, `The last calibration (of ${fmtDate(last.date)}) was made with the previous source: until the new source is calibrated, the value below is used if it is dated no earlier than the installation.`)
      : last && Number.isFinite(last.rate)
      ? L(`Сейчас: калибровка от ${fmtDate(last.date)} — ${fmt(f.co_dd_on && f.co_ref_at !== 'zref' && Number.isFinite(last.rateMax) ? last.rateMax : last.rate, 2)} сГр/мин, приводится к дате сеанса по распаду. До первой калибровки в журнале и после замены источника (другая дата установки) — значение ниже.`, `Now: the calibration of ${fmtDate(last.date)}: ${fmt(f.co_dd_on && f.co_ref_at !== 'zref' && Number.isFinite(last.rateMax) ? last.rateMax : last.rate, 2)} cGy/min, decay-corrected to the session date. Before the first calibration in the journal and after a source replacement (another installation date), the value below is used.`)
      : L('В журнале ещё нет калибровки этого пучка: пока используется значение ниже (если задано).', 'The journal has no calibration of this beam yet: the value below is used for now (if given).')
    : L('Значение ниже приводится к дате сеанса по распаду ⁶⁰Co.', 'The value below is decay-corrected to the session date.');
  return `<details class="jbeam" data-card="beam:${esc(id)}"${b._open ? ' open' : ''}>
    <summary><span class="jbeam-name">${richText(head)}</span>${b.active === false ? `<span class="chip none">${esc(L('не в сеансах', 'not in sessions'))}</span>` : missChip(miss)}</summary>
    <div class="grid">
      ${field(L('Пучок', 'Beam'), input(k, id, 'name', b.name, { placeholder: L('⁶⁰Co, РИП 80 см', '⁶⁰Co, SSD 80 cm') }), { forId: fieldId(k, id, 'name'), sub: L('как в протоколе', 'as in the report') })}
      <div class="field">${check(k, id, 'active', b.active !== false, L('используется в сеансах', 'used in sessions'))}</div>
      ${field(L('Камера', 'Chamber'), select(k, id, 'chamberId', b.chamberId, chamberOptions(j, b, 'cobalt')), { forId: fieldId(k, id, 'chamberId') })}
      ${field(L('Электрометр', 'Electrometer'), select(k, id, 'electrometerId', b.electrometerId, elOpts), { forId: fieldId(k, id, 'electrometerId') })}
      ${field(L('Установка', 'Setup'), select(k, id, 'form.co_geometry', f.co_geometry, [['SSD', L('РИП: поле 10 × 10 см на поверхности воды', 'SSD: 10 × 10 cm field at the water surface')], ['SAD', L('РИК (РИО): поле 10 × 10 см в плоскости камеры', 'SCD (SAD): 10 × 10 cm field in the chamber plane')]]), { forId: fieldId(k, id, 'form.co_geometry'), cls: 'span-2' })}
      ${field(sad ? L('РИК, см', 'SCD, cm') : L('РИП, см', 'SSD, cm'), input(k, id, 'form.co_distance', f.co_distance, { num: true, placeholder: '80' }), { forId: fieldId(k, id, 'form.co_distance') })}
      ${field(L('Опорная глубина z<sub>ref</sub>', 'Reference depth z<sub>ref</sub>'), select(k, id, 'form.co_zref', f.co_zref, zOpts), { forId: fieldId(k, id, 'form.co_zref') })}
      ${field(L('V₁ рабочее, В', 'V₁ operating, V'), input(k, id, 'form.co_V1', f.co_V1, { num: true }), { forId: fieldId(k, id, 'form.co_V1') })}
      ${field(L('V₂ пониженное, В', 'V₂ reduced, V'), input(k, id, 'form.co_V2', f.co_V2, { num: true }), { forId: fieldId(k, id, 'form.co_V2') })}
      ${field(L('Полярность', 'Polarity'), select(k, id, 'form.co_polarity', f.co_polarity, [['+', L('положительная (+)', 'positive (+)')], ['-', L('отрицательная (−)', 'negative (−)')]]), { forId: fieldId(k, id, 'form.co_polarity') })}
    </div>
    <h4 class="sub-h">${esc(L('Время облучения и ошибка таймера', 'Irradiation time and timer error'))}</h4>
    <div class="grid">
      ${field(f.co_timer_mode === 'window' ? L('Время накопления заряда', 'Charge collection time') : L('Заданное время облучения', 'Set irradiation time'), input(k, id, 'form.co_time', f.co_time, { num: true }), { forId: fieldId(k, id, 'form.co_time') })}
      ${field(L('Единица времени', 'Time unit'), select(k, id, 'form.co_time_unit', f.co_time_unit, [['min', L('мин', 'min')], ['s', L('с', 's')]]), { forId: fieldId(k, id, 'form.co_time_unit') })}
      ${field(L('Ошибка таймера τ при калибровке', 'Timer error τ at calibration'), select(k, id, 'form.co_timer_mode', f.co_timer_mode, timerOpts), { forId: fieldId(k, id, 'form.co_timer_mode'), cls: 'span-2', sub: f.co_timer_mode === 'window' || f.co_timer_mode === 'none' ? '' : L('при проверке выхода τ берётся из последней калибровки', 'at an output check τ comes from the last calibration') })}
      ${f.co_timer_mode === 'manual' ? field(`τ, ${unit}`, input(k, id, 'form.co_tau', f.co_tau, { num: true, placeholder: '0,010' }), { forId: fieldId(k, id, 'form.co_tau'), sub: L('может быть и отрицательной', 'may also be negative') }) : ''}
      ${f.co_timer_mode === 'nexp' ? `${field(L(`Время одиночного облучения t, ${unit}`, `Single exposure time t, ${unit}`), input(k, id, 'form.co_nx_t', f.co_nx_t, { num: true }), { forId: fieldId(k, id, 'form.co_nx_t') })}${field(L('Число облучений n', 'Number of exposures n'), input(k, id, 'form.co_nx_n', f.co_nx_n, { num: true }), { forId: fieldId(k, id, 'form.co_nx_n') })}` : ''}
    </div>
    <h4 class="sub-h">${L('Пересчёт на z<sub>max</sub> и сравнение', 'Transfer to z<sub>max</sub> and comparison')}</h4>
    <div class="grid">
      <div class="field">${check(k, id, 'form.co_dd_on', f.co_dd_on, L('пересчитывать мощность дозы на z<sub>max</sub>', 'transfer the dose rate to z<sub>max</sub>'))}</div>
      ${f.co_dd_on ? field(L('Глубина z<sub>max</sub>, см', 'Depth z<sub>max</sub>, cm'), input(k, id, 'form.co_zmax', f.co_zmax, { num: true, placeholder: '0,5' }), { forId: fieldId(k, id, 'form.co_zmax') }) : ''}
      ${f.co_dd_on && sad ? field(L('Пересчёт при РИК', 'Transfer for SCD'), select(k, id, 'form.co_dd_sad', f.co_dd_sad, [['tmr', L('через TMR — на z_max в изоцентре', 'via TMR: to z_max at the isocenter')], ['pdd', L('через PDD при РИП = РИК − z_ref', 'via PDD at SSD = SCD − z_ref')]]), { forId: fieldId(k, id, 'form.co_dd_sad') }) : ''}
      ${f.co_dd_on && sad && f.co_dd_sad !== 'pdd' ? field(`TMR(${f.co_zref})`, input(k, id, 'form.co_tmr', f.co_tmr, { num: true, placeholder: '0,904' }), { forId: fieldId(k, id, 'form.co_tmr'), sub: L('отношение, не проценты', 'a ratio, not a percentage') }) : ''}
      ${f.co_dd_on && !(sad && f.co_dd_sad !== 'pdd') ? field(`PDD(${f.co_zref}), %`, input(k, id, 'form.co_pdd', f.co_pdd, { num: true }), { forId: fieldId(k, id, 'form.co_pdd') }) : ''}
    </div>
    <div class="grid">
      ${field(L('Сравнивать мощность дозы с', 'Compare the dose rate with'), select(k, id, 'refSrc', refSrc, [['last', L('последней калибровкой в журнале', 'the last calibration in the journal')], ['profile', L('значением из настроек пучка', 'the value from the beam settings')]]), { forId: fieldId(k, id, 'refSrc'), cls: 'span-2', sub: `<span data-live="refnote">${esc(refNote)}</span>` })}
      ${field(L('Мощность дозы для сравнения, сГр/мин', 'Comparison dose rate, cGy/min'), input(k, id, 'form.co_ref_rate', f.co_ref_rate, { num: true }), { forId: fieldId(k, id, 'form.co_ref_rate'), sub: L('при вводе в эксплуатацию или в системе планирования; можно не заполнять', 'at commissioning or in the planning system; may be left blank') })}
      ${f.co_dd_on ? field(L('Значение задано', 'Value given'), select(k, id, 'form.co_ref_at', f.co_ref_at, [['zmax', L('на z_max', 'at z_max')], ['zref', L('на z_ref', 'at z_ref')]]), { forId: fieldId(k, id, 'form.co_ref_at') }) : ''}
      ${field(L('на дату', 'as of'), input(k, id, 'form.co_ref_date', f.co_ref_date, { type: 'date' }), { forId: fieldId(k, id, 'form.co_ref_date'), sub: L('пусто — дата установки источника', 'blank: the source installation date') })}
      ${field(L('Допуск, ±%', 'Tolerance, ±%'), input(k, id, 'form.co_tol', f.co_tol, { num: true, placeholder: '2' }), { forId: fieldId(k, id, 'form.co_tol') })}
    </div>
    <h4 class="sub-h">${esc(L('Источник', 'Source'))}</h4>
    <div class="grid">
      ${field(L('Активность при установке', 'Activity at installation'), input(k, id, 'form.co_act0', f.co_act0, { num: true }), { forId: fieldId(k, id, 'form.co_act0') })}
      ${field(L('Единица', 'Unit'), select(k, id, 'form.co_act_unit', f.co_act_unit, Object.entries(ACTIVITY_UNITS).map(([v, u]) => [v, L(u.label, u.labelEn)])), { forId: fieldId(k, id, 'form.co_act_unit') })}
      ${field(L('Дата установки (паспортной активности)', 'Installation date (certified activity)'), input(k, id, 'form.co_act_date', f.co_act_date, { type: 'date' }), { forId: fieldId(k, id, 'form.co_act_date'), sub: L('после замены источника измените её: прежние калибровки не будут ожидаемым значением', 'change it after a source replacement: earlier calibrations will no longer be the expected value') })}
    </div>
    <div class="row-tools">
      <button type="button" class="link-btn" data-edit-tab="${esc(m.id)}:${esc(id)}">${esc(L('Все настройки — во вкладке «⁶⁰Co»', 'All settings: in the ⁶⁰Co tab'))}</button>
      <button type="button" class="link-btn danger" data-del="beam:${esc(m.id)}:${esc(id)}"${used ? ` disabled title="${esc(L('Пучок есть в сеансах журнала: снимите «используется в сеансах», чтобы убрать его из новых сеансов', 'The beam is in journal sessions: clear "used in sessions" to exclude it from new sessions'))}"` : ''}>${esc(L('Удалить пучок', 'Delete beam'))}</button>
    </div>
  </details>`;
}

function beamCard(j, m, b) {
  if (beamKind(b) === 'electron') return ebeamCard(j, m, b);
  if (beamKind(b) === 'cobalt') return cobeamCard(j, m, b);
  const f = { ...FORM_DEFAULTS, ...b.form };
  const k = 'beam';
  const id = b.id;
  const chOpts = chamberOptions(j, b, 'photon');
  const elOpts = [['', L('— электрометр —', '— electrometer —')], ...j.electrometers.map((e) => [e.id, electrometerText(e)])];
  const tpr = tprOf(f);
  const used = j.sessions.some((s) => s.beams.some((x) => x.beamId === id));
  const nom = parseNumber(f.dd_nominal);
  const tolN = parseNumber(f.dd_tol);
  const tolT = Number.isFinite(tolN) && tolN > 0 ? fmt(tolN, 3).replace(/[.,]?0+$/, '') : '2';
  const at = f.dd_on && f.dd_nominal_at !== 'zref' ? 'd_max' : 'z_ref';
  const sad = f.setup_geometry === 'SAD';
  const miss = b.active === false ? [] : beamMissing(j, b);
  const head = [b.name || L('Новый пучок', 'New beam'), chamberText(j.chambers.find((c) => c.id === b.chamberId)), Number.isFinite(tpr) ? `TPR₂₀,₁₀ ${fmt(tpr, 4)}` : '', Number.isFinite(nom) ? L(`номинал ${fmt(nom, 3)} сГр/МЕ на ${at} ±${tolT} %`, `nominal ${fmt(nom, 3)} cGy/MU at ${at} ±${tolT}%`) : '']
    .filter(Boolean)
    .join(' · ');
  const geomOpts = [['SSD', L('РИП 100 см, камера на 10 см', 'SSD 100 cm, chamber at 10 cm')], ['SAD', L('РИО 100 см, камера на 10 см', 'SAD 100 cm, chamber at 10 cm')]];
  if (f.setup_geometry === 'manual') geomOpts.push(['manual', L('своя (задана во вкладке «МВ фотоны»)', 'custom (set in the MV photons tab)')]);
  const q51 = f.q51_method;
  const q51Key = q51 === 'foil50' || q51 === 'foil30' ? 'q51_pdd10pb' : q51 === 'manual' ? 'q51_manual' : 'q51_pdd10';
  const q51Label = q51Key === 'q51_pdd10pb' ? L('Последнее: %dd(10)<sub>Pb</sub>, %', 'Last: %dd(10)<sub>Pb</sub>, %') : q51Key === 'q51_manual' ? L('Последнее: %dd(10)<sub>x</sub>, %', 'Last: %dd(10)<sub>x</sub>, %') : L('Последнее: %dd(10), %', 'Last: %dd(10), %');
  return `<details class="jbeam" data-card="beam:${esc(id)}"${b._open ? ' open' : ''}>
    <summary><span class="jbeam-name">${richText(head)}</span>${b.active === false ? `<span class="chip none">${esc(L('не в сеансах', 'not in sessions'))}</span>` : missChip(miss)}</summary>
    <div class="grid">
      ${field(L('Пучок', 'Beam'), input(k, id, 'name', b.name, { placeholder: L('6 МВ', '6 MV') }), { forId: fieldId(k, id, 'name'), sub: L('как в протоколе; «FFF» или «БВФ» в названии ставит отметку сам', 'as in the report; "FFF" in the name sets the checkbox') })}
      <div class="field">${check(k, id, 'form.meta_fff', f.meta_fff, L('без выравнивающего фильтра (БВФ)', 'flattening-filter-free (FFF)'))}${check(k, id, 'active', b.active !== false, L('используется в сеансах', 'used in sessions'))}</div>
      ${field(L('Камера', 'Chamber'), select(k, id, 'chamberId', b.chamberId, chOpts), { forId: fieldId(k, id, 'chamberId') })}
      ${field(L('Электрометр', 'Electrometer'), select(k, id, 'electrometerId', b.electrometerId, elOpts), { forId: fieldId(k, id, 'electrometerId') })}
      ${field(L('V₁ рабочее, В', 'V₁ operating, V'), input(k, id, 'form.rd_V1', f.rd_V1, { num: true }), { forId: fieldId(k, id, 'form.rd_V1') })}
      ${field(L('V₂ пониженное, В', 'V₂ reduced, V'), input(k, id, 'form.rd_V2', f.rd_V2, { num: true }), { forId: fieldId(k, id, 'form.rd_V2') })}
      ${field(L('Полярность', 'Polarity'), select(k, id, 'form.rd_polarity', f.rd_polarity, [['+', L('положительная (+)', 'positive (+)')], ['-', L('отрицательная (−)', 'negative (−)')]]), { forId: fieldId(k, id, 'form.rd_polarity') })}
      ${field(L('МЕ за облучение', 'MU per irradiation'), input(k, id, 'form.rd_mu', f.rd_mu, { num: true }), { forId: fieldId(k, id, 'form.rd_mu') })}
    </div>
    <h4 class="sub-h">${L('Геометрия и пересчёт на d<sub>max</sub>', 'Geometry and transfer to d<sub>max</sub>')}</h4>
    <div class="grid">
      ${field(L('Установка', 'Setup'), select(k, id, 'form.setup_geometry', f.setup_geometry, geomOpts), { forId: fieldId(k, id, 'form.setup_geometry'), cls: 'span-2' })}
      <div class="field">${check(k, id, 'form.dd_on', f.dd_on, L('пересчитывать дозу на d<sub>max</sub>', 'transfer the dose to d<sub>max</sub>'))}</div>
      ${f.dd_on ? field(L('Глубина d<sub>max</sub>, см', 'Depth d<sub>max</sub>, cm'), input(k, id, 'form.dd_zmax', f.dd_zmax, { num: true, placeholder: '1,5' }), { forId: fieldId(k, id, 'form.dd_zmax') }) : ''}
      ${f.dd_on && sad ? field(L('Пересчёт при РИО', 'Transfer for SAD'), select(k, id, 'form.dd_sad', f.dd_sad, [['tmr', L('через TMR', 'via TMR')], ['pdd', L('через PDD при РИП 90 см', 'via PDD at SSD 90 cm')]]), { forId: fieldId(k, id, 'form.dd_sad') }) : ''}
      ${f.dd_on && sad && f.dd_sad === 'tmr' ? field('TMR(10)', input(k, id, 'form.dd_tmr', f.dd_tmr, { num: true, placeholder: '0,736' }), { forId: fieldId(k, id, 'form.dd_tmr'), sub: L('отношение, не проценты', 'a ratio, not a percentage') }) : ''}
      ${f.dd_on && !(sad && f.dd_sad === 'tmr') ? field(sad ? L('PDD(10) при РИП 90 см, %', 'PDD(10) at SSD 90 cm, %') : 'PDD(10), %', input(k, id, 'form.dd_pdd', f.dd_pdd, { num: true }), { forId: fieldId(k, id, 'form.dd_pdd') }) : ''}
    </div>
    <h4 class="sub-h">${esc(L('Номинальный выход', 'Nominal output'))}</h4>
    <div class="grid">
      ${field(L('Номинальный выход, сГр/МЕ', 'Nominal output, cGy/MU'), input(k, id, 'form.dd_nominal', f.dd_nominal, { num: true }), { forId: fieldId(k, id, 'form.dd_nominal'), sub: L('= Гр на 100 МЕ; пусто — без сравнения', '= Gy per 100 MU; blank: no comparison') })}
      ${f.dd_on ? field(L('Номинал задан', 'Nominal given'), select(k, id, 'form.dd_nominal_at', f.dd_nominal_at, [['dmax', L('на d_max (после пересчёта)', 'at d_max (after transfer)')], ['zref', L('на опорной глубине', 'at the reference depth')]]), { forId: fieldId(k, id, 'form.dd_nominal_at') }) : field(L('Номинал задан', 'Nominal given'), `<input type="text" value="${esc(L('на опорной глубине', 'at the reference depth'))}" disabled>`, { sub: L('без пересчёта на d<sub>max</sub>', 'no transfer to d<sub>max</sub>') })}
      ${field(L('Допуск, ±%', 'Tolerance, ±%'), input(k, id, 'form.dd_tol', f.dd_tol, { num: true, placeholder: '2' }), { forId: fieldId(k, id, 'form.dd_tol') })}
    </div>
    <h4 class="sub-h">${esc(L('Качество пучка — последнее измеренное', 'Beam quality: the last measured'))}</h4>
    <p class="sub-hint">${esc(L('Нужно для проверки выхода, пока в журнале нет калибровки пучка; при калибровке качество вводится в сеансе.', 'Needed for output checks until the journal has a calibration of the beam; at a calibration the quality is entered in the session.'))}</p>
    <div class="grid">
      ${field(L('TRS-398: как получен TPR<sub>20,10</sub>', 'TRS-398: how TPR<sub>20,10</sub> is obtained'), select(k, id, 'form.qtrs_method', f.qtrs_method, [['ratio', L('M(20)/M(10), РИК 100 см', 'M(20)/M(10), SCD 100 cm')], ['pdd2010', L('через PDD(20)/PDD(10)', 'via PDD(20)/PDD(10)')]]), { forId: fieldId(k, id, 'form.qtrs_method') })}
      ${field(f.qtrs_method === 'pdd2010' ? 'PDD(20)' : L('M на 20 см', 'M at 20 cm'), input(k, id, 'form.qtrs_v20', f.qtrs_v20, { num: true }), { forId: fieldId(k, id, 'form.qtrs_v20') })}
      ${field(f.qtrs_method === 'pdd2010' ? 'PDD(10)' : L('M на 10 см', 'M at 10 cm'), input(k, id, 'form.qtrs_v10', f.qtrs_v10, { num: true }), { forId: fieldId(k, id, 'form.qtrs_v10'), sub: Number.isFinite(tpr) ? `TPR₂₀,₁₀ = ${fmt(tpr, 4)}` : '' })}
      ${field(L('TG-51: как получен %dd(10)<sub>x</sub>', 'TG-51: how %dd(10)<sub>x</sub> is obtained'), select(k, id, 'form.q51_method', q51, [['open', L('открытый пучок (ниже 10 МВ)', 'open beam (below 10 MV)')], ['foil50', L('фольга 1 мм в 50 см', '1 mm foil at 50 cm')], ['foil30', L('фольга 1 мм в 30 см', '1 mm foil at 30 cm')], ['interim', L('без фольги, формула (15)', 'no foil, Eq. (15)')], ['manual', L('%dd(10)x известен', '%dd(10)x known')]]), { forId: fieldId(k, id, 'form.q51_method') })}
      ${field(q51Label, input(k, id, `form.${q51Key}`, f[q51Key], { num: true }), { forId: fieldId(k, id, `form.${q51Key}`) })}
    </div>
    <p class="sub-hint">${esc(L('Остальное', 'Other settings'))}: ${richText(beamExtras(f))}</p>
    <div class="row-tools">
      <button type="button" class="link-btn" data-edit-tab="${esc(m.id)}:${esc(id)}">${esc(L('Все настройки — во вкладке «МВ фотоны»', 'All settings: in the MV photons tab'))}</button>
      <button type="button" class="link-btn danger" data-del="beam:${esc(m.id)}:${esc(id)}"${used ? ` disabled title="${esc(L('Пучок есть в сеансах журнала: снимите «используется в сеансах», чтобы убрать его из новых сеансов', 'The beam is in journal sessions: clear "used in sessions" to exclude it from new sessions'))}"` : ''}>${esc(L('Удалить пучок', 'Delete beam'))}</button>
    </div>
  </details>`;
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
      <button type="button" class="link-btn" data-import-cobeam="${esc(m.id)}"><span aria-hidden="true">+</span> ${esc(L('Пучок из вкладки «⁶⁰Co»', 'Beam from the ⁶⁰Co tab'))}</button>
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
      <button type="button" class="link-btn" data-import-beam="${esc(m.id)}"><span aria-hidden="true">+</span> ${esc(L('Пучок из вкладки «МВ фотоны»', 'Beam from the MV photons tab'))}</button>
    </div>
    <h3 class="sub-h">${esc(L('Пучки электронов', 'Electron beams'))}</h3>
    <div class="jbeams">${m.beams.filter((b) => beamKind(b) === 'electron').map((b) => beamCard(j, m, b)).join('') || `<p class="sub-hint">${esc(L('Пучков электронов пока нет.', 'No electron beams yet.'))}</p>`}</div>
    <div class="row-tools">
      <button type="button" class="link-btn" data-add-ebeam="${esc(m.id)}"><span aria-hidden="true">+</span> ${esc(L('Добавить пучок электронов', 'Add an electron beam'))}</button>
      <button type="button" class="link-btn" data-import-ebeam="${esc(m.id)}"><span aria-hidden="true">+</span> ${esc(L('Пучок из вкладки «Электроны»', 'Beam from the Electrons tab'))}</button>
    </div>` : ''}
    ${cobalt ? '' : coSection}
    <div class="row-tools">
      <button type="button" class="link-btn danger" data-del="machine:${esc(m.id)}"${hasSessions ? ` disabled title="${esc(L('У аппарата есть сеансы в журнале', 'The machine has sessions in the journal'))}"` : ''}>${esc(L('Удалить аппарат', 'Delete machine'))}</button>
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
const openBeams = new Set();
function render() {
  const j = getJournal();
  $('#eq_institution').value = j.institution || '';
  $('#eq-chambers').innerHTML = j.chambers.map((c) => chamberCard(c, j)).join('') || `<p class="sub-hint">${esc(L('Камер пока нет.', 'No chambers yet.'))}</p>`;
  $('#eq-electrometers').innerHTML = j.electrometers.map(electrometerCard).join('') || `<p class="sub-hint">${esc(L('Электрометров пока нет.', 'No electrometers yet.'))}</p>`;
  $('#eq-machines').innerHTML = j.machines.map((m) => machineCard(j, { ...m, beams: m.beams.map((b) => ({ ...b, _open: openBeams.has(b.id) })) })).join('') || `<p class="sub-hint">${esc(L('Аппаратов пока нет.', 'No machines yet.'))}</p>`;
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
    <div class="secondary">${esc(L(`камер: ${j.chambers.length}; электрометров: ${j.electrometers.length}; сеансов в журнале: ${j.sessions.length}`, `chambers: ${j.chambers.length}; electrometers: ${j.electrometers.length}; sessions in the journal: ${j.sessions.length}`))}</div></div>`;
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
  for (const m of j.machines) {
    for (const b of m.beams) {
      if (b.active === false) continue;
      const miss = beamMissing(j, b);
      if (miss.length) msgs.push(`<li class="info"><span class="lvl">${esc(L('Не заполнено', 'Missing'))}</span><span>${esc(`${m.name || '—'}, ${b.name || '—'}: `)}${richText(miss.join(', '))}</span></li>`);
    }
  }
  $('#eq-messages').innerHTML = msgs.join('') || `<li class="info"><span class="lvl">${esc(L('Всё в порядке', 'All clear'))}</span><span>${esc(L('Сроки калибровки в порядке, у камер, электрометров и пучков заполнено всё нужное для расчёта.', 'Calibration dates are fine; chambers, electrometers and beams have what the calculation needs.'))}</span></li>`;
}

// ------------------------------------------------------------ связь с вкладкой «МВ фотоны» и сеансом
/** «Сохранить в журнал» на вкладке: настройки пучка, камеры и электрометра — в журнал. Возвращает текст состояния. */
export function saveBeamFromTab(target, form, title = '') {
  if (!target?.beamId) return '';
  let info = null;
  updateJournal((j) => {
    info = applyTabFormToBeam(j, target.machineId, target.beamId, form, ['electron', 'cobalt'].includes(target.kind) ? target.kind : 'photon');
    return info.journal;
  }, 'equipment');
  openBeams.add(target.beamId);
  const ch = {
    same: info.sharedChamber.length ? L(` Камера обновлена — она же выбрана у пучков: ${info.sharedChamber.join('; ')}.`, ` The chamber has been updated; it is also used by: ${info.sharedChamber.join('; ')}.`) : '',
    found: L(' У пучка теперь другая камера — она уже была в журнале; прежняя запись камеры не изменена.', ' The beam now uses another chamber that was already in the journal; the previous chamber record is unchanged.'),
    added: L(' На вкладке выбрана другая камера: она добавлена в список камер (проверьте даты её калибровки), прежняя запись камеры не изменена.', ' A different chamber was selected in the tab: it has been added to the chamber list (check its calibration dates); the previous chamber record is unchanged.'),
    none: '',
  }[info.chamber];
  const el = {
    same: info.sharedElectrometer.length ? L(` Электрометр обновлён — он же выбран у пучков: ${info.sharedElectrometer.join('; ')}.`, ` The electrometer has been updated; it is also used by: ${info.sharedElectrometer.join('; ')}.`) : '',
    found: L(' У пучка теперь другой электрометр из журнала.', ' The beam now uses another electrometer from the journal.'),
    added: L(' На вкладке указан другой электрометр: он добавлен в список электрометров.', ' A different electrometer was given in the tab: it has been added to the electrometer list.'),
    none: '',
  }[info.electrometer];
  return L(`Настройки пучка «${title}» сохранены в журнал.${ch}${el} Сохраните журнал в файл.`, `Beam settings "${title}" saved to the journal.${ch}${el} Save the journal to the file.`);
}

/** Открыть карточку пучка и прокрутить к ней (из сеанса). */
export function revealBeam(beamId) {
  if (!beamId) return;
  openBeams.add(beamId);
  render();
  const card = ROOT().querySelector(`[data-card="beam:${CSS.escape(beamId)}"]`);
  if (card) {
    card.open = true;
    card.scrollIntoView({ block: 'start' });
  }
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
    const card = el.closest('details[data-card]');
    if (card?.open) openBeams.add(card.dataset.card.split(':')[1]);
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
    const users = j0.machines.flatMap((m) => m.beams.filter((x) => x[key] === a).map((x) => `${m.name} — ${x.name}`));
    if (users.length) {
      setStatus(L(`Не удалено: ${kind === 'chamber' ? 'камера' : 'электрометр'} выбран у пучков: ${users.join('; ')}. Сначала выберите там другой.`, `Not deleted: the ${kind} is assigned to beams: ${users.join('; ')}. Choose another one there first.`));
      return;
    }
  }
  updateJournal((j) => {
    if (kind === 'chamber') j.chambers = j.chambers.filter((x) => x.id !== a);
    else if (kind === 'electrometer') j.electrometers = j.electrometers.filter((x) => x.id !== a);
    else if (kind === 'machine') j.machines = j.machines.filter((x) => x.id !== a);
    else if (kind === 'beam') {
      const m = j.machines.find((x) => x.id === a);
      if (m) m.beams = m.beams.filter((x) => x.id !== b);
    }
    return j;
  }, 'equipment');
  setStatus(L('Удалено. Сохраните журнал, чтобы изменение попало в файл.', 'Deleted. Save the journal to write the change to the file.'));
}

function onClick(e) {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.addBeam) {
    const id = uid('b');
    openBeams.add(id);
    updateJournal((j) => {
      j.machines.find((m) => m.id === t.dataset.addBeam)?.beams.push({ ...BEAM_DEFAULTS, id, name: '', chamberId: j.chambers.find((c) => photonCapable(c.form))?.id ?? '', electrometerId: j.electrometers[0]?.id ?? '', form: { rd_V1: FORM_DEFAULTS.rd_V1, rd_V2: FORM_DEFAULTS.rd_V2, rd_polarity: '+', rd_mu: '100', dd_nominal: '1,000', dd_nominal_at: 'dmax', dd_tol: '2', dd_on: true, qtrs_method: 'ratio', kqtrs_mode: 'formula', setup_geometry: 'SSD' } });
      return j;
    }, 'equipment');
    document.getElementById(fieldId('beam', id, 'name'))?.focus();
  } else if (t.dataset.addEbeam) {
    const id = uid('b');
    openBeams.add(id);
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
    openBeams.add(id);
    updateJournal((j) => {
      const ch = j.chambers.find((c) => cobaltCapable(c.form));
      j.machines.find((m) => m.id === t.dataset.addCobeam)?.beams.push({
        ...BEAM_DEFAULTS, id, kind: 'cobalt', name: '', refSrc: 'last', chamberId: ch?.id ?? '', electrometerId: j.electrometers[0]?.id ?? '',
        form: { co_geometry: 'SSD', co_distance: '80', co_zref: '5', co_V1: CO_DEFAULTS.co_V1, co_V2: CO_DEFAULTS.co_V2, co_polarity: '+', co_time: '1', co_time_unit: 'min', co_timer_mode: 'measured', co_nx_t: '1', co_nx_n: '5', co_kleak: '1,000', co_rec_trs: 'eq13', co_dd_on: true, co_zmax: '0,5', co_dd_sad: 'tmr', co_ref_at: 'zmax', co_tol: '2', co_act_unit: 'Ci' },
      });
      return j;
    }, 'equipment');
    document.getElementById(fieldId('beam', id, 'name'))?.focus();
  } else if (t.dataset.importBeam || t.dataset.importEbeam || t.dataset.importCobeam) {
    const kind = t.dataset.importEbeam ? 'electron' : t.dataset.importCobeam ? 'cobalt' : 'photon';
    const form = tabBridge.current(kind);
    if (!form) return;
    let info;
    updateJournal((j) => {
      info = beamFromTabForm(j, t.dataset.importBeam || t.dataset.importEbeam || t.dataset.importCobeam, form, kind);
      return info.journal;
    }, 'equipment');
    openBeams.add(info.beam.id);
    render();
    const tab = { electron: L('«Электроны»', 'Electrons'), cobalt: L('«⁶⁰Co»', '⁶⁰Co') }[kind] ?? L('«МВ фотоны»', 'MV photons');
    setStatus(
      L(
        `Добавлен пучок «${info.beam.name}» с настройками вкладки ${tab}.${info.addedChamber ? ' Камера добавлена в список камер — проверьте даты её калибровки.' : ' Камера найдена в журнале.'}${info.addedElectrometer ? ' Электрометр добавлен.' : ''}`,
        `Beam "${info.beam.name}" added with the ${tab} tab settings.${info.addedChamber ? ' The chamber has been added to the chamber list: check its calibration dates.' : ' The chamber was found in the journal.'}${info.addedElectrometer ? ' The electrometer has been added.' : ''}`,
      ),
    );
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
        ? normalizeElectrons({ ...E_DEFAULTS, ...b.form, ...electronChamberForm(ch?.form || {}), e_el_model: el?.form?.el_model ?? '', e_el_serial: el?.form?.el_serial ?? '', e_kelec: el?.form?.el_kelec ?? '1,000', e_beam: b.name, e_machine: m.name, e_institution: j.institution, protocol: currentProtocol() })
        : kind === 'cobalt'
          ? normalizeCobalt({ ...CO_DEFAULTS, ...b.form, ...cobaltChamberForm(ch?.form || {}), co_el_model: el?.form?.el_model ?? '', co_el_serial: el?.form?.el_serial ?? '', co_kelec: el?.form?.el_kelec ?? '1,000', co_machine: [m.name, b.name].filter((x) => !isBlank(x)).join(' — '), co_institution: j.institution, protocol: currentProtocol() })
          : normalizeForm({ ...FORM_DEFAULTS, ...b.form, ...(ch?.form || {}), ...(el?.form || {}), meta_beam: b.name, meta_machine: m.name, meta_institution: j.institution, protocol: currentProtocol() });
    tabBridge.edit(kind, form, { title: `${m.name || ''} — ${b.name || ''}`, target: { machineId: mid, beamId: bid, kind } });
  } else if (t.id === 'eq-add-chamber') {
    updateJournal((j) => {
      j.chambers.push({ ...CHAMBER_DEFAULTS, id: uid('ch'), form: { ch_model: '', ch_serial: '', ch_ndw: '', ch_ndw_unit: 'Gy/nC', ch_klab: '1,000', ch_T0: '20', ch_P0: '101,325' } });
      return j;
    }, 'equipment');
  } else if (t.id === 'eq-import-mine') {
    importMine();
  } else if (t.id === 'eq-add-electrometer') {
    updateJournal((j) => {
      j.electrometers.push({ ...ELECTROMETER_DEFAULTS, id: uid('el'), form: { el_model: '', el_serial: '', el_kelec: '1,000' } });
      return j;
    }, 'equipment');
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
  sheet.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.tagName !== 'DETAILS' || !d.dataset.card) return;
    const id = d.dataset.card.split(':')[1];
    if (d.open) openBeams.add(id);
    else openBeams.delete(id);
  }, true);
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
