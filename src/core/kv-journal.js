// Вкладка «kV-рентген» ↔ рентгенотерапевтический аппарат «Оборудования» (с 0.42.0).
// kvVisitFromMachine — отмеченные режимы аппарата во вкладку: пучок режима (диапазон, кВ, мА, фильтр, СПО), камера режима
// с kV-сертификатом из её записи, электрометр, строки — отмеченные у режима аппликаторы (показания пустые).
// kvMachineFromVisit — обратно, кнопкой «Сохранить аппарат в Оборудование»: режимы, аппликаторы, камеры с kV-сертификатом
// и электрометры вкладки — в журнал. Ничего не удаляет: аппликаторы режима только добавляются, СПО «Оборудования»
// заменяется значением вкладки, только если пользователь согласился. Расчёта здесь нет.
// С 0.43.0: СПО, измеренный на листе «СПО и k_Q» и взятый в расчёт режима, записывается в режим как измеренный (с датой
// измерения) — вместо номинального только с согласия пользователя; набор пластин для СПО хранится с аппаратом.
import { KV_CHAMBER_KEYS, newKvMode, newKvChamber, emptyKvRow, computeKvVisit } from './kv-session.js';
import { normalizeKvMachine, newKvApplicator, newKvMachineMode, kvRefCandidates, journalModelOfKv, kvModelOfJournal } from './kv-machine.js';
import { uid, CHAMBER_DEFAULTS, ELECTROMETER_DEFAULTS, MACHINE_DEFAULTS, orgText, chamberText, electrometerText } from './journal.js';
import { findEChamber } from './electron-chambers.js';
import { parseNumber, isBlank, dec } from './units.js';
import { hvlText } from './kv-hvl.js';
import { L } from './i18n.js';

const str = (v) => (v === undefined || v === null ? '' : String(v));
const copy = (v) => (Array.isArray(v) ? [...v] : v);
const norm = (v) => str(v).trim().toLowerCase().replace(/\s+/g, ' ');
const num = (v) => parseNumber(v);
const sameNum = (a, b) => {
  const x = num(a);
  const y = num(b);
  return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) < 1e-9 : norm(a) === norm(b);
};

/** Поля записи камеры, относящиеся к модели, номеру и электрометру: у записи журнала они свои. */
const CHAMBER_ID_KEYS = ['kv_ch_model', 'kv_cc_maker', 'kv_cc_model', 'kv_cc_type', 'kv_ch_serial', 'kv_el_model', 'kv_el_serial', 'kv_kelec'];
/**
 * kV-сертификат и условия измерения камеры: тип калибровки, таблица качеств, условия лаборатории, T₀, P₀, поправки
 * лаборатории, напряжения и полярность. Хранятся в записи камеры журнала отдельно от её N_D,w в ⁶⁰Co (chamber.kv).
 */
export const KV_CERT_KEYS = KV_CHAMBER_KEYS.filter((k) => !CHAMBER_ID_KEYS.includes(k));

/** Есть ли в kV-сертификате записи камеры калибровочный коэффициент или таблица качеств. */
export const hasKvCert = (kv) => !!kv && (!isBlank(kv.kv_n) || (Array.isArray(kv.kv_cq_val) && kv.kv_cq_val.some((v) => !isBlank(v))));

/** Аппарат текстом для поля «Аппарат» вкладки: «Xstrahl 300, № 123». */
export const kvMachineText = (m) => [str(m?.name).trim(), isBlank(m?.serial) ? '' : `№ ${str(m.serial).trim()}`].filter(Boolean).join(', ');

/** Камера вкладки из записи камеры и электрометра журнала; base — камера вкладки, откуда берутся поля, которых в записи нет. */
export function kvChamberFromRecord(ch, el, base = null) {
  const out = newKvChamber(base);
  if (ch) {
    const f = ch.form || {};
    const kv = ch.kv || {};
    const id = kvModelOfJournal(f.ch_model);
    if (id) out.kv_ch_model = id;
    else if (!isBlank(f.ch_model)) {
      // камеры нет в списке вкладки kV: своя камера с названием записи (свою из вкладки — с её полями)
      out.kv_ch_model = 'CUSTOM';
      const own = !isBlank(kv.kv_cc_model) || !isBlank(kv.kv_cc_maker);
      out.kv_cc_maker = own ? str(kv.kv_cc_maker) : '';
      out.kv_cc_model = own ? str(kv.kv_cc_model) : chamberText({ form: { ...f, ch_serial: '' } });
      out.kv_cc_type = own ? (kv.kv_cc_type === 'cyl' ? 'cyl' : 'pp') : f.ch_model === 'OTHER' ? (f.e_other_type === 'cyl' ? 'cyl' : 'pp') : findEChamber(f.ch_model)?.type === 'pp' ? 'pp' : 'cyl';
    }
    out.kv_ch_serial = str(f.ch_serial);
    for (const k of KV_CERT_KEYS) if (k in kv) out[k] = copy(kv[k]);
  }
  if (el) {
    out.kv_el_model = str(el.form?.el_model);
    out.kv_el_serial = str(el.form?.el_serial);
    out.kv_kelec = isBlank(el.form?.el_kelec) ? '1,000' : str(el.form.el_kelec);
  }
  return out;
}

/**
 * Вкладка с отмеченными режимами аппарата machine журнала j. visit — текущие данные вкладки: из её выбранного режима
 * берутся фантом, единица задания и способ ошибки таймера, из строки — задание, из камеры — поля, которых нет в записи;
 * дата, сотрудники и примечания сохраняются. Режимы с одной камерой и одним электрометром делят камеру вкладки.
 * Строки режима — отмеченные аппликаторы (выбрана строка референсного); у самого большого тубуса (табл. 31, когда
 * 10 × 10 см нет) — отметка «самый большой тубус аппарата». Возвращает { visit, noCert } — noCert: камеры без kV-сертификата.
 */
export function kvVisitFromMachine(j, machine, modeIds, visit) {
  const picked = machine.modes.filter((x) => modeIds.includes(x.id));
  if (!picked.length) return null;
  const tpl = visit.modes[visit.mode] ?? visit.modes[0];
  const tplRow = tpl.rows[tpl.active] ?? tpl.rows[0];
  const base = visit.chambers[tpl.chamber] ?? visit.chambers[0];
  const chambers = [];
  const index = new Map();
  const noCert = [];
  const modes = picked.map((x) => {
    const key = `${x.chamberId}|${x.electrometerId}`;
    if (!index.has(key)) {
      const ch = j.chambers.find((c) => c.id === x.chamberId) ?? null;
      const el = j.electrometers.find((e) => e.id === x.electrometerId) ?? null;
      index.set(key, chambers.length);
      chambers.push(kvChamberFromRecord(ch, el, base));
      if (ch && !hasKvCert(ch.kv)) noCert.push(chamberText(ch));
    }
    const md = newKvMode(tpl);
    Object.assign(md.shared, { kv_jmode: x.id, kv_range: x.range === 'medium' ? 'medium' : 'low', kv_kv: str(x.kv), kv_ma: str(x.ma), kv_filter: str(x.filter), kv_hvl: str(x.hvl) });
    md.chamber = index.get(key);
    const c = kvRefCandidates(machine, x);
    const apps = machine.applicators.filter((a) => x.applicators.includes(a.id));
    md.rows = apps.length
      ? apps.map((a) => ({ ...emptyKvRow(), kv_set: copy(tplRow?.kv_set ?? ''), kv_cone_shape: a.shape, kv_cone: str(a.a), kv_cone_b: a.shape === 'rect' ? str(a.b) : '', kv_ssd: str(a.ssd), kv_cone_largest: c.how === 'largest' && c.ids.includes(a.id) }))
      : [emptyKvRow()];
    md.active = Math.max(0, apps.findIndex((a) => a.id === x.refApplicator));
    return md;
  });
  const common = { ...visit.common, kv_jmachine: machine.id, kv_machine: kvMachineText(machine) };
  if (!isBlank(orgText(j))) common.kv_institution = orgText(j);
  // набор пластин аппарата — на лист «СПО и k_Q» (у аппарата без набора остаётся набор вкладки)
  if (machine.plates?.length) {
    common.kv_pl_name = machine.plates.map((p) => p.name);
    common.kv_pl_mat = machine.plates.map((p) => p.mat);
    common.kv_pl_nom = machine.plates.map((p) => p.nom);
    common.kv_pl_t = machine.plates.map((p) => p.t);
    common.kv_pl_u = machine.plates.map((p) => p.u);
  }
  return { visit: { common, chambers, modes, mode: 0 }, noCert: [...new Set(noCert)] };
}

/** Тот же аппликатор: форма, размер и РИП (числа — по значению). */
const sameApp = (a, r) =>
  a.shape === (r.kv_cone_shape || 'circle') && sameNum(a.a, r.kv_cone) && (a.shape !== 'rect' || sameNum(a.b, r.kv_cone_b)) && (isBlank(a.ssd) && isBlank(r.kv_ssd) ? true : sameNum(a.ssd, r.kv_ssd));
/** Режим «Оборудования», совпадающий с режимом вкладки по диапазону, напряжению, фильтру и току (если он есть у обоих). */
const sameMode = (y, s) =>
  y.range === (s.kv_range === 'medium' ? 'medium' : 'low') && sameNum(y.kv, s.kv_kv) && norm(y.filter) === norm(s.kv_filter) && (isBlank(y.ma) || isBlank(s.kv_ma) || sameNum(y.ma, s.kv_ma));

/** Набор пластин вкладки (непустые строки) в виде пластин аппарата. */
function visitPlates(common) {
  const n = Math.max(0, ...['kv_pl_name', 'kv_pl_mat', 'kv_pl_nom', 'kv_pl_t', 'kv_pl_u'].map((k) => (Array.isArray(common[k]) ? common[k].length : 0)));
  const at = (k, i) => str(Array.isArray(common[k]) ? common[k][i] : '').trim();
  return Array.from({ length: n }, (_, i) => ({ name: at('kv_pl_name', i), mat: at('kv_pl_mat', i) === 'Cu' ? 'Cu' : 'Al', nom: at('kv_pl_nom', i), t: at('kv_pl_t', i), u: at('kv_pl_u', i) }))
    .filter((x) => [x.name, x.nom, x.t, x.u].some((v) => v !== ''));
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, copy(o[k])]));
const sameKv = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Камера вкладки → запись камеры журнала (найти по модели и №, иначе добавить); kV-сертификат — в запись. */
function upsertChamber(j, vc, rep) {
  const id = str(vc.kv_ch_model);
  if (!id) return '';
  const custom = id === 'CUSTOM' || id.startsWith('MY:');
  const model = custom ? 'OTHER' : journalModelOfKv(id);
  const name = custom ? [vc.kv_cc_maker, vc.kv_cc_model].map((s) => str(s).trim()).filter(Boolean).join(' ') : '';
  const kv = pick(vc, KV_CERT_KEYS);
  if (custom) Object.assign(kv, { kv_cc_maker: str(vc.kv_cc_maker), kv_cc_model: str(vc.kv_cc_model), kv_cc_type: vc.kv_cc_type === 'cyl' ? 'cyl' : 'pp' });
  // своя камера вкладки — «другая» камера журнала с тем же названием или камера журнала не из списка вкладки
  // (подставленная своей с названием записи, kvChamberFromRecord): по названию без номера
  const sameCustom = (c) =>
    c.form?.ch_model === 'OTHER' ? norm(c.form?.e_other_name) === norm(name) : !kvModelOfJournal(c.form?.ch_model) && norm(chamberText({ form: { ...c.form, ch_serial: '' } })) === norm(name);
  let ch = j.chambers.find((c) => norm(c.form?.ch_serial) === norm(vc.kv_ch_serial) && (custom ? !isBlank(c.form?.ch_model) && sameCustom(c) : c.form?.ch_model === model));
  if (!ch) {
    ch = {
      ...CHAMBER_DEFAULTS,
      id: uid('ch'),
      form: { ch_model: model, ch_serial: str(vc.kv_ch_serial), ch_ndw: '', ch_ndw_unit: 'Gy/nC', ch_klab: '1,000', ch_T0: '20', ch_P0: '101,325', ...(custom ? { e_other_name: name, e_other_type: vc.kv_cc_type === 'cyl' ? 'cyl' : 'pp' } : {}) },
      kv,
    };
    j.chambers.push(ch);
    rep.chambersAdded.push(chamberText(ch));
  } else if (!sameKv(ch.kv, kv)) {
    ch.kv = kv;
    rep.certSaved.push(chamberText(ch));
  }
  return ch.id;
}

/** Электрометр камеры вкладки → запись журнала (по модели и №, иначе добавить). */
function upsertElectrometer(j, vc, rep) {
  const model = str(vc.kv_el_model).trim();
  if (!model) return '';
  let el = j.electrometers.find((e) => norm(e.form?.el_model) === norm(model) && norm(e.form?.el_serial) === norm(vc.kv_el_serial));
  if (!el) {
    el = { ...ELECTROMETER_DEFAULTS, id: uid('el'), form: { el_model: model, el_serial: str(vc.kv_el_serial), el_kelec: isBlank(vc.kv_kelec) ? '1,000' : str(vc.kv_kelec) } };
    j.electrometers.push(el);
    rep.electrometersAdded.push(electrometerText(el));
  }
  return el.id;
}

/**
 * «Сохранить аппарат в Оборудование»: журнал j0 с аппаратом вкладки (связанным — по kv_jmachine, иначе по названию,
 * иначе новым). Режим вкладки находит свой режим «Оборудования» по kv_jmode или по пучку (иначе добавляется): пучок —
 * из вкладки; СПО — тоже, если в «Оборудовании» его нет или replaceHvl (иначе расхождение — в report.hvl); камера и
 * электрометр — записи журнала (найденные или добавленные, kV-сертификат — в запись камеры); аппликаторы строк
 * добавляются к аппарату и отмечаются у режима; референсный — стандартный тубус вкладки, если он определён.
 * Возвращает { journal, machineId, modeIds (по режимам вкладки), report }.
 */
export function kvMachineFromVisit(j0, visit, { replaceHvl = false } = {}) {
  const j = structuredClone(j0);
  const rep = { machineAdded: false, modesAdded: 0, modesUpdated: 0, appsAdded: 0, chambersAdded: [], certSaved: [], electrometersAdded: [], hvl: [], hvlMeasured: 0, platesSaved: 0 };
  const name = str(visit.common.kv_machine).trim();
  let m = j.machines.find((x) => x.kind === 'kv' && x.id === visit.common.kv_jmachine)
    ?? (name ? j.machines.find((x) => x.kind === 'kv' && (norm(x.name) === norm(name) || norm(kvMachineText(x)) === norm(name))) : null);
  if (!m) {
    m = normalizeKvMachine({ ...MACHINE_DEFAULTS, id: uid('m'), kind: 'kv', name });
    j.machines.push(m);
    rep.machineAdded = true;
  }
  const vr = computeKvVisit(visit);
  const plates = visitPlates(visit.common);
  if (plates.length && JSON.stringify(plates) !== JSON.stringify(m.plates ?? [])) {
    m.plates = plates;
    rep.platesSaved = plates.length;
  }
  const date = str(visit.common.kv_date);
  const used = new Set();
  const modeIds = visit.modes.map((md, i) => {
    const s = md.shared;
    const ids = [];
    for (const r of md.rows) {
      if (isBlank(r.kv_cone)) continue;
      let a = m.applicators.find((x) => sameApp(x, r));
      if (!a) {
        a = { ...newKvApplicator(), shape: ['square', 'rect'].includes(r.kv_cone_shape) ? r.kv_cone_shape : 'circle', a: str(r.kv_cone).trim(), b: r.kv_cone_shape === 'rect' ? str(r.kv_cone_b).trim() : '', ssd: str(r.kv_ssd).trim() };
        m.applicators.push(a);
        rep.appsAdded++;
      }
      if (!ids.includes(a.id)) ids.push(a.id);
    }
    let x = m.modes.find((y) => y.id === s.kv_jmode && !used.has(y.id)) ?? m.modes.find((y) => !used.has(y.id) && sameMode(y, s));
    if (x) rep.modesUpdated++;
    else {
      x = newKvMachineMode();
      m.modes.push(x);
      rep.modesAdded++;
    }
    used.add(x.id);
    Object.assign(x, { range: s.kv_range === 'medium' ? 'medium' : 'low', kv: str(s.kv_kv), ma: str(s.kv_ma), filter: str(s.kv_filter) });
    // СПО режима: измеренный на листе «СПО и k_Q» (если взят в расчёт) или из таблицы режимов
    const h = vr.modes[i]?.hvl;
    const measured = !!h?.apply;
    const now = measured ? dec(hvlText(h.used)) : str(s.kv_hvl);
    const setHvl = () => {
      x.hvl = now;
      if (measured) {
        x.hvlSource = 'measured';
        x.hvlDate = date;
        rep.hvlMeasured++;
      } else {
        x.hvlSource = 'nominal'; // значение таблицы режимов вкладки
        x.hvlDate = '';
      }
    };
    if (isBlank(x.hvl)) {
      if (!isBlank(now)) setHvl();
    } else if (!isBlank(now) && !sameNum(x.hvl, now)) {
      rep.hvl.push({ mode: i, was: x.hvl, now, source: x.hvlSource, sourceDate: x.hvlDate, measured, range: x.range });
      if (replaceHvl) setHvl();
    } else if (measured && (x.hvlSource !== 'measured' || x.hvlDate !== date)) setHvl(); // то же значение — измерен заново
    const vc = visit.chambers[md.chamber] ?? {};
    const chId = upsertChamber(j, vc, rep);
    if (chId) x.chamberId = chId;
    const elId = upsertElectrometer(j, vc, rep);
    if (elId) x.electrometerId = elId;
    // аппликаторы режима: отмеченные раньше остаются, тубусы вкладки добавляются; порядок — как у аппарата
    x.applicators = m.applicators.map((a) => a.id).filter((id) => x.applicators.includes(id) || ids.includes(id));
    const std = vr.modes[i]?.stdRow ?? -1;
    const stdApp = std >= 0 ? m.applicators.find((a) => sameApp(a, md.rows[std])) : null;
    if (stdApp) x.refApplicator = stdApp.id;
    else if (!x.applicators.includes(x.refApplicator)) x.refApplicator = '';
    return x.id;
  });
  return { journal: j, machineId: m.id, modeIds, report: rep };
}

/** Итог сохранения текстом для строки состояния. */
export function kvSaveText(m, rep) {
  const name = m?.name || L('без названия', 'unnamed');
  const parts = [
    rep.machineAdded ? L(`добавлен аппарат «${name}»`, `the unit “${name}” added`) : '',
    rep.modesAdded ? L(`режимов добавлено: ${rep.modesAdded}`, `modes added: ${rep.modesAdded}`) : '',
    rep.modesUpdated ? L(`режимов обновлено: ${rep.modesUpdated}`, `modes updated: ${rep.modesUpdated}`) : '',
    rep.appsAdded ? L(`аппликаторов добавлено: ${rep.appsAdded}`, `applicators added: ${rep.appsAdded}`) : '',
    rep.chambersAdded.length ? L(`камеры добавлены: ${rep.chambersAdded.join(', ')}`, `chambers added: ${rep.chambersAdded.join(', ')}`) : '',
    rep.certSaved.length ? L(`kV-сертификат записан в камеры: ${rep.certSaved.join(', ')}`, `kV certificate saved to the chambers: ${rep.certSaved.join(', ')}`) : '',
    rep.electrometersAdded.length ? L(`электрометры добавлены: ${rep.electrometersAdded.join(', ')}`, `electrometers added: ${rep.electrometersAdded.join(', ')}`) : '',
    rep.hvlMeasured ? L(`измеренный СПО записан в режимов: ${rep.hvlMeasured}`, `measured HVL saved to modes: ${rep.hvlMeasured}`) : '',
    rep.platesSaved ? L(`набор пластин для СПО сохранён (${rep.platesSaved})`, `the HVL plate set saved (${rep.platesSaved})`) : '',
  ].filter(Boolean);
  return L(
    `Аппарат «${name}» сохранён в «Оборудование»${parts.length ? `: ${parts.join('; ')}` : ''}. Сохраните журнал в файл.`,
    `The unit “${name}” saved to Equipment${parts.length ? `: ${parts.join('; ')}` : ''}. Save the journal to the file.`,
  );
}

/** kV-сертификат записи камеры коротко: «N_K, N по качествам — 3 точки, СПО 0,5–2,9; поле Ø 3 см, РИП 30 см». */
export function kvCertText(kv) {
  if (!hasKvCert(kv)) return '';
  const cal = kv.kv_cal === 'nk' ? L('N_K (воздушная керма)', 'N_K (air kerma)') : 'N_D,w';
  const form = { kq: L('N_Qo и k_Q по качествам', 'N_Qo and k_Q by quality'), n: L('N по качествам', 'N by quality'), k: L('N и множитель K по качествам', 'N and factor K by quality'), co: L('только N_D,w в ⁶⁰Co', 'N_D,w in ⁶⁰Co only') }[kv.kv_cert_form] ?? '';
  const hvls = (Array.isArray(kv.kv_cq_hvl) ? kv.kv_cq_hvl : []).filter((h, i) => !isBlank(h) && !isBlank(kv.kv_cq_val?.[i]));
  const nums = hvls.map(num).filter(Number.isFinite);
  const pts = hvls.length ? L(`${hvls.length} ${hvls.length === 1 ? 'точка' : hvls.length < 5 ? 'точки' : 'точек'}`, `${hvls.length} point${hvls.length === 1 ? '' : 's'}`) : '';
  const range = nums.length > 1 ? L(`СПО ${hvls[nums.indexOf(Math.min(...nums))]}–${hvls[nums.indexOf(Math.max(...nums))]} мм`, `HVL ${hvls[nums.indexOf(Math.min(...nums))]}–${hvls[nums.indexOf(Math.max(...nums))]} mm`) : '';
  const lab = !isBlank(kv.kv_lab_f) ? L(`поле лаборатории ${kv.kv_lab_shape === 'square' ? `${kv.kv_lab_f} × ${kv.kv_lab_f} см` : `Ø ${kv.kv_lab_f} см`}${isBlank(kv.kv_lab_ssd) ? '' : `, РИП ${kv.kv_lab_ssd} см`}`, `laboratory field ${kv.kv_lab_shape === 'square' ? `${kv.kv_lab_f} × ${kv.kv_lab_f} cm` : `${kv.kv_lab_f} cm diameter`}${isBlank(kv.kv_lab_ssd) ? '' : `, SSD ${kv.kv_lab_ssd} cm`}`) : '';
  return [cal, [form, pts].filter(Boolean).join(' — '), range, lab].filter(Boolean).join('; ');
}
