// «Журнал» → «Оборудование»: учреждение, камеры, электрометры, аппараты с пучками фотонов. Всё хранится в журнале.
// Поля пучка здесь — основные; остальные настройки (k_vol, поправки по глубине, TG-51 и т. п.) редактируются на
// вкладке «МВ фотоны» кнопкой «Все настройки» и возвращаются в журнал кнопкой «Сохранить в журнал».
import { L } from '../core/i18n.js';
import { CHAMBERS, chamberLabel, chamberNote } from '../core/chambers.js';
import { NDW_UNITS, unitLabel, parseNumber, isBlank } from '../core/units.js';
import { FORM_DEFAULTS, normalizeForm } from '../core/photons.js';
import * as TRS from '../core/trs398.js';
import {
  uid, CHAMBER_DEFAULTS, ELECTROMETER_DEFAULTS, MACHINE_DEFAULTS, BEAM_DEFAULTS, chamberText, electrometerText, beamFromPhotonsForm, applyPhotonsFormToBeam, equipmentDue,
  chamberMissing, electrometerMissing,
} from '../core/journal.js';
import { $, esc, fmt, makeStatus, armButton, notifyUpdate, today, richText, currentProtocol } from './common.js';
import { localizeDecimals } from './i18n.js';
import { getJournal, updateJournal, onJournal } from './journal-store.js';
import { setupFilePanel, dueChip, fmtDate, countWord } from './journal-common.js';

let setStatus = () => {};
let tabBridge = { current: () => null, edit: () => {} };
/** Связь с вкладкой «МВ фотоны»: текущая форма вкладки и редактирование пучка в ней. */
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
  return `<select ${bind(kind, id, path)}>${options.map(([v, t]) => `<option value="${val(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
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
  for (const [maker, list] of groups) parts.push(`<optgroup label="${esc(maker)}">${list.map((c) => `<option value="${esc(c.id)}"${c.id === cur ? ' selected' : ''}>${esc(c.model)}${c.note ? ` — ${esc(chamberNote(c))}` : ''}</option>`).join('')}</optgroup>`);
  if (cur === 'CUSTOM') parts.push(`<option value="CUSTOM" selected>${esc(L('Своя камера (из вкладки «МВ фотоны»)', 'Custom chamber (from the MV photons tab)'))}</option>`);
  return parts.join('');
}

function chamberCard(c) {
  const f = c.form || {};
  const k = 'chamber';
  const custom = f.ch_model === 'CUSTOM';
  const cross = f.ch_cal_route === 'cross';
  const units = Object.entries(NDW_UNITS).map(([v, u]) => [v, unitLabel(u)]);
  return `<div class="jcard" data-card="chamber:${esc(c.id)}">
    <div class="jcard-head"><b>${esc(chamberText(c) || L('Новая камера', 'New chamber'))}</b><span class="chips">${missChip(chamberMissing(c))}${dueChip(c.dueDate)}</span></div>
    <div class="grid">
      ${field(L('Камера', 'Chamber'), `<select ${bind(k, c.id, 'form.ch_model')}>${chamberModelOptions(f.ch_model)}</select>`, { forId: fieldId(k, c.id, 'form.ch_model'), cls: 'span-2', sub: custom ? esc([f.cc_maker, f.cc_model].filter(Boolean).join(' ')) : '' })}
      ${field(L('Заводской №', 'Serial No.'), input(k, c.id, 'form.ch_serial', f.ch_serial), { forId: fieldId(k, c.id, 'form.ch_serial') })}
      ${field(L('Калибровка камеры', 'Chamber calibration'), select(k, c.id, 'form.ch_cal_route', f.ch_cal_route || 'co60', [['co60', L('N_D,w в пучке ⁶⁰Co', 'N_D,w in a ⁶⁰Co beam')], ['cross', L('перекрёстная в пучке МВ фотонов (TRS-398)', 'cross-calibration in an MV photon beam (TRS-398)')]]), { forId: fieldId(k, c.id, 'form.ch_cal_route'), cls: 'span-2' })}
      ${cross
        ? `${field('N<sub>D,w,Qcross</sub>', input(k, c.id, 'form.ch_cross_ndw', f.ch_cross_ndw, { num: true }), { forId: fieldId(k, c.id, 'form.ch_cross_ndw'), sub: L('TRS-398, ур. 27; из «Инструментов»', 'TRS-398, Eq. 27; from Tools') })}
          ${field(L('Единицы', 'Units'), select(k, c.id, 'form.ch_cross_ndw_unit', f.ch_cross_ndw_unit || 'Gy/nC', units), { forId: fieldId(k, c.id, 'form.ch_cross_ndw_unit') })}
          ${field(L('TPR<sub>20,10</sub> пучка калибровки', 'TPR<sub>20,10</sub> of the calibration beam'), input(k, c.id, 'form.ch_cross_tpr', f.ch_cross_tpr, { num: true }), { forId: fieldId(k, c.id, 'form.ch_cross_tpr'), sub: L('k<sub>Q,Qcross</sub> = k<sub>Q</sub>/k<sub>Qcross</sub> (ур. 30)', 'k<sub>Q,Qcross</sub> = k<sub>Q</sub>/k<sub>Qcross</sub> (Eq. 30)') })}`
        : `${field('N<sub>D,w</sub> (⁶⁰Co)', input(k, c.id, 'form.ch_ndw', f.ch_ndw, { num: true }), { forId: fieldId(k, c.id, 'form.ch_ndw') })}
          ${field(L('Единицы', 'Units'), select(k, c.id, 'form.ch_ndw_unit', f.ch_ndw_unit || 'Gy/nC', units), { forId: fieldId(k, c.id, 'form.ch_ndw_unit') })}`}
      ${field(L('k<sub>лаб</sub>', 'k<sub>lab</sub>'), input(k, c.id, 'form.ch_klab', f.ch_klab ?? '1,000', { num: true }), { forId: fieldId(k, c.id, 'form.ch_klab'), sub: L('поправочный множитель из протокола поверки; обычно 1,000', 'correction multiplier from the calibration certificate; usually 1.000') })}
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
  const chMiss = ch ? chamberMissing(ch) : [];
  const elMiss = el ? electrometerMissing(el) : [];
  return [
    !ch && L('камера', 'chamber'),
    chMiss.length && L(`у камеры ${chMiss.join(', ')}`, `chamber ${chMiss.join(', ')}`),
    !el && L('электрометр', 'electrometer'),
    elMiss.length && L(`у электрометра ${elMiss.join(', ')}`, `electrometer ${elMiss.join(', ')}`),
    blank('rd_V1') && 'V₁',
    blank('rd_V2') && 'V₂',
    blank('rd_mu') && L('МЕ', 'MU'),
    f.dd_on && blank('dd_zmax') && 'd_max',
    f.dd_on && (sad && f.dd_sad === 'tmr' ? blank('dd_tmr') && 'TMR(10)' : blank('dd_pdd') && 'PDD(10)'),
  ].filter(Boolean);
}

function beamCard(j, m, b) {
  const f = { ...FORM_DEFAULTS, ...b.form };
  const k = 'beam';
  const id = b.id;
  const chOpts = [['', L('— камера —', '— chamber —')], ...j.chambers.map((c) => [c.id, chamberText(c)])];
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
  return `<div class="jcard" data-card="machine:${esc(m.id)}">
    <div class="jcard-head"><b>${esc(m.name || L('Новый аппарат', 'New machine'))}</b><span class="chip none">${esc(L('ускоритель', 'linac'))}</span></div>
    <div class="grid">
      ${field(L('Аппарат', 'Machine'), input(k, m.id, 'name', m.name, { placeholder: 'Elekta Versa HD' }), { forId: fieldId(k, m.id, 'name') })}
      ${field(L('Заводской №', 'Serial No.'), input(k, m.id, 'serial', m.serial), { forId: fieldId(k, m.id, 'serial') })}
      ${field(L('Примечания', 'Notes'), input(k, m.id, 'notes', m.notes), { forId: fieldId(k, m.id, 'notes') })}
    </div>
    <h3 class="sub-h">${esc(L('Пучки фотонов', 'Photon beams'))}</h3>
    <div class="jbeams">${m.beams.filter((b) => b.kind === 'photon').map((b) => beamCard(j, m, b)).join('') || `<p class="sub-hint">${esc(L('Пучков пока нет.', 'No beams yet.'))}</p>`}</div>
    <div class="row-tools">
      <button type="button" class="link-btn" data-add-beam="${esc(m.id)}"><span aria-hidden="true">+</span> ${esc(L('Добавить пучок фотонов', 'Add a photon beam'))}</button>
      <button type="button" class="link-btn" data-import-beam="${esc(m.id)}"><span aria-hidden="true">+</span> ${esc(L('Пучок из вкладки «МВ фотоны»', 'Beam from the MV photons tab'))}</button>
      <button type="button" class="link-btn danger" data-del="machine:${esc(m.id)}"${hasSessions ? ` disabled title="${esc(L('У аппарата есть сеансы в журнале', 'The machine has sessions in the journal'))}"` : ''}>${esc(L('Удалить аппарат', 'Delete machine'))}</button>
    </div>
  </div>`;
}

// ------------------------------------------------------------ отрисовка
const openBeams = new Set();
function render() {
  const j = getJournal();
  $('#eq_institution').value = j.institution || '';
  $('#eq-chambers').innerHTML = j.chambers.map(chamberCard).join('') || `<p class="sub-hint">${esc(L('Камер пока нет.', 'No chambers yet.'))}</p>`;
  $('#eq-electrometers').innerHTML = j.electrometers.map(electrometerCard).join('') || `<p class="sub-hint">${esc(L('Электрометров пока нет.', 'No electrometers yet.'))}</p>`;
  $('#eq-machines').innerHTML = j.machines.map((m) => machineCard(j, { ...m, beams: m.beams.map((b) => ({ ...b, _open: openBeams.has(b.id) })) })).join('') || `<p class="sub-hint">${esc(L('Аппаратов пока нет.', 'No machines yet.'))}</p>`;
  for (const btn of ROOT().querySelectorAll('[data-del]')) {
    if (btn.disabled) continue;
    armButton(btn, btn.textContent, () => L('Нажмите ещё раз, чтобы удалить', 'Click again to delete'), () => remove(btn.dataset.del));
  }
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
    const miss = chamberMissing(c);
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
    info = applyPhotonsFormToBeam(j, target.machineId, target.beamId, form);
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
    // «FFF» / «БВФ» в названии пучка ставит отметку сам
    if (kind === 'beam' && path === 'name' && /(^|[^\p{L}])(fff|бвф)([^\p{L}]|$)/iu.test(value)) obj.form.meta_fff = true;
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
      j.machines.find((m) => m.id === t.dataset.addBeam)?.beams.push({ ...BEAM_DEFAULTS, id, name: '', chamberId: j.chambers[0]?.id ?? '', electrometerId: j.electrometers[0]?.id ?? '', form: { rd_V1: FORM_DEFAULTS.rd_V1, rd_V2: FORM_DEFAULTS.rd_V2, rd_polarity: '+', rd_mu: '100', dd_nominal: '1,000', dd_nominal_at: 'dmax', dd_tol: '2', dd_on: true, qtrs_method: 'ratio', kqtrs_mode: 'formula', setup_geometry: 'SSD' } });
      return j;
    }, 'equipment');
    document.getElementById(fieldId('beam', id, 'name'))?.focus();
  } else if (t.dataset.importBeam) {
    const form = tabBridge.current();
    if (!form) return;
    let info;
    updateJournal((j) => {
      info = beamFromPhotonsForm(j, t.dataset.importBeam, form);
      return info.journal;
    }, 'equipment');
    openBeams.add(info.beam.id);
    render();
    setStatus(
      L(
        `Добавлен пучок «${info.beam.name}» с настройками вкладки «МВ фотоны».${info.addedChamber ? ' Камера добавлена в список камер — проверьте даты её калибровки.' : ' Камера найдена в журнале.'}${info.addedElectrometer ? ' Электрометр добавлен.' : ''}`,
        `Beam "${info.beam.name}" added with the MV photons tab settings.${info.addedChamber ? ' The chamber has been added to the chamber list: check its calibration dates.' : ' The chamber was found in the journal.'}${info.addedElectrometer ? ' The electrometer has been added.' : ''}`,
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
    // протокол — текущий в шапке: открытие пучка не должно переключать его
    const form = normalizeForm({ ...FORM_DEFAULTS, ...b.form, ...(ch?.form || {}), ...(el?.form || {}), meta_beam: b.name, meta_machine: m.name, meta_institution: j.institution, protocol: currentProtocol() });
    tabBridge.edit(form, { title: `${m.name || ''} — ${b.name || ''}`, target: { machineId: mid, beamId: bid } });
  } else if (t.id === 'eq-add-chamber') {
    updateJournal((j) => {
      j.chambers.push({ ...CHAMBER_DEFAULTS, id: uid('ch'), form: { ch_model: '', ch_serial: '', ch_ndw: '', ch_ndw_unit: 'Gy/nC', ch_klab: '1,000', ch_T0: '20', ch_P0: '101,325' } });
      return j;
    }, 'equipment');
  } else if (t.id === 'eq-add-electrometer') {
    updateJournal((j) => {
      j.electrometers.push({ ...ELECTROMETER_DEFAULTS, id: uid('el'), form: { el_model: '', el_serial: '', el_kelec: '1,000' } });
      return j;
    }, 'equipment');
  } else if (t.id === 'eq-add-machine') {
    updateJournal((j) => {
      j.machines.push({ ...MACHINE_DEFAULTS, id: uid('m'), beams: [] });
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
}
