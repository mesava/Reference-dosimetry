// Вкладка «kV-рентген», лист «СПО и k_Q» (с 0.43.0): измерение СПО выбранного режима (поля формы — ключи KV_DEFAULTS,
// их читает kv-ui.js), таблица СПО и k_Q по всем режимам, набор пластин (общий для режимов). Расчёт — core/kv-hvl.js и
// computeKvVisit (измеренный СПО идёт в расчёт режима). Данные вкладки (visit) живут в kv-ui.js: сюда приходят
// функции доступа к ним.
import { L } from '../core/i18n.js';
import { kvPlateSet, parseThickness, hvlDecimals, KV_PLATE_KEYS } from '../core/kv-hvl.js';
import { $, $$, esc, fmt, fmtSigned, richText } from './common.js';
import { localizeDecimals } from './i18n.js';

let api = null;

const str = (v) => (v === undefined || v === null ? '' : String(v));
/** Число с n значащими цифрами (показания бывают и в нКл, и в пА). */
const sig = (v, n = 5) => {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const d = a > 0 ? Math.max(0, Math.min(8, n - 1 - Math.floor(Math.log10(a)))) : 0;
  return fmt(v, d);
};
const hvlFmt = (v) => fmt(v, hvlDecimals(v));
/** U, мм: две значащие цифры, не меньше трёх знаков после запятой. */
const uFmt = (v) => (Number.isFinite(v) && v > 0 ? fmt(v, Math.max(3, Math.min(6, 1 - Math.floor(Math.log10(v))))) : fmt(v, 3));
const pctSigned = (r) => (Number.isFinite(r) ? `${fmtSigned((r - 1) * 100, 1)} %` : '—');
const unitText = (mat) => L(`мм ${mat}`, `mm ${mat}`);

// ------------------------------------------------------------ набор пластин
const platesBody = () => $('#kv-plates-body');

/** Набор пластин — в таблицу (из полей формы kv_pl_*). */
export function renderPlates(f) {
  const n = Math.max(0, ...KV_PLATE_KEYS.map((k) => (Array.isArray(f?.[k]) ? f[k].length : 0)));
  const at = (k, i) => str(Array.isArray(f?.[k]) ? f[k][i] : '');
  const cap = (t) => ` data-cap="${esc(t)}"`;
  const inp = (i, k, label, num = true) =>
    `<input type="text"${num ? ' class="num" inputmode="decimal"' : ''} data-pk="${k}" aria-label="${esc(L(`${label}, пластина ${i + 1}`, `${label}, plate ${i + 1}`))}" value="${esc(at(k, i))}">`;
  platesBody().innerHTML = Array.from({ length: n }, (_, i) => {
    const mat = at('kv_pl_mat', i) === 'Cu' ? 'Cu' : 'Al';
    return `<tr data-pl="${i}">
      <td class="no">${i + 1}</td>
      <td class="name"${cap(L('Обозначение', 'Label'))}>${inp(i, 'kv_pl_name', L('Обозначение', 'Label'), false)}</td>
      <td class="mat"${cap(L('Материал', 'Material'))}><select data-pk="kv_pl_mat" aria-label="${esc(L(`Материал, пластина ${i + 1}`, `Material, plate ${i + 1}`))}"><option value="Al"${mat === 'Al' ? ' selected' : ''}>Al</option><option value="Cu"${mat === 'Cu' ? ' selected' : ''}>Cu</option></select></td>
      <td class="v"${cap(L('Номинал, мм', 'Nominal, mm'))}>${inp(i, 'kv_pl_nom', L('Номинальная толщина, мм', 'Nominal thickness, mm'))}</td>
      <td class="v"${cap(L('Измерено, мм', 'Measured, mm'))}>${inp(i, 'kv_pl_t', L('Измеренная толщина, мм', 'Measured thickness, mm'))}</td>
      <td class="v"${cap(L('u(t), мм', 'u(t), mm'))}>${inp(i, 'kv_pl_u', L('u(t), мм', 'u(t), mm'))}</td>
      <td class="del"><button type="button" class="icon-btn" data-pl-del="${i}" aria-label="${esc(L(`Удалить пластину ${i + 1}`, `Delete plate ${i + 1}`))}" title="${esc(L('Удалить пластину', 'Delete the plate'))}">×</button></td>
    </tr>`;
  }).join('');
  localizeDecimals(platesBody());
}

/** Набор пластин из таблицы — поля формы kv_pl_*. */
export function readPlates() {
  const out = Object.fromEntries(KV_PLATE_KEYS.map((k) => [k, []]));
  for (const tr of $$('tr[data-pl]', platesBody())) for (const k of KV_PLATE_KEYS) out[k].push(tr.querySelector(`[data-pk="${k}"]`)?.value ?? '');
  return out;
}

/** Следующее обозначение пластины материала mat: «Al13» после Al1…Al12. */
function nextName(names, mat) {
  const re = new RegExp(`^${mat}(\\d+)$`, 'i');
  const max = names.reduce((a, n) => Math.max(a, Number(re.exec(n.trim())?.[1] ?? 0)), 0);
  return `${mat}${max + 1}`;
}

function addPlate() {
  const p = readPlates();
  const n = p.kv_pl_name.length;
  const mat = n ? (p.kv_pl_mat[n - 1] === 'Cu' ? 'Cu' : 'Al') : api.material();
  p.kv_pl_name.push(nextName(p.kv_pl_name, mat));
  p.kv_pl_mat.push(mat);
  p.kv_pl_nom.push('');
  p.kv_pl_t.push('');
  p.kv_pl_u.push(n ? p.kv_pl_u[n - 1] : '');
  renderPlates(p);
  api.changed();
  platesBody().querySelector(`tr[data-pl="${n}"] [data-pk="kv_pl_nom"]`)?.focus();
}

function deletePlate(i) {
  const p = readPlates();
  const name = p.kv_pl_name[i];
  for (const k of KV_PLATE_KEYS) p[k].splice(i, 1);
  renderPlates(p);
  api.changed();
  api.status(L(`Пластина ${i + 1}${name ? ` (${name})` : ''} удалена.`, `Plate ${i + 1}${name ? ` (${name})` : ''} deleted.`));
}

// ------------------------------------------------------------ измерение СПО выбранного режима
/** Толщина под полем x: что из неё получилось. */
function thicknessSub(x, mat) {
  if (!x || x.blank) return L('число в мм или пластины набора через «+»', 'a number in mm or plates of the set joined by “+”');
  if (x.error) return x.error;
  const v = `${sig(x.value, 4)} ${unitText(mat)}`;
  if (x.from === 'number') return L(`${v}, введено числом: u(x) — в поле ниже`, `${v}, entered as a number: u(x) in the field below`);
  const u = Number.isFinite(x.u) ? `; u = ${uFmt(x.u)} ${L('мм', 'mm')}` : '';
  return `${v} = ${x.names.join(' + ')}${u}`;
}

const BUDGET_NAMES = () => ({ D0: 'D̄₀', D1: 'D̄₁', D2: 'D̄₂', x1: L('x₁, мм', 'x₁, mm'), x2: L('x₂, мм', 'x₂, mm'), cov: L('cov(x₁, x₂), мм²', 'cov(x₁, x₂), mm²') });

/** Поля и выводы измерения СПО выбранного режима; f — его форма, h — computeKvHvl. */
function renderMeasurement(f, h) {
  const mat = h.mat;
  for (const id of ['#kv-hl-unit', '#kv-hl-unit2']) $(id).textContent = unitText(mat);
  const set = kvPlateSet(f);
  const x1 = parseThickness(f.kv_hl_x1, set, mat);
  const x2 = parseThickness(f.kv_hl_x2, set, mat);
  $('#kv-hl-x1-sub').textContent = thicknessSub(h.x1 ?? x1, mat);
  $('#kv-hl-x2-sub').textContent = thicknessSub(h.x2 ?? x2, mat);
  $('#kv-hl-ux1-f').hidden = x1.from !== 'number';
  $('#kv-hl-ux2-f').hidden = x2.from !== 'number';
  $('#kv-hl-cov-f').hidden = !(x1.from === 'number' || x2.from === 'number');
  const s = h.series ?? {};
  const out = (k, t) => {
    const el = $(`#kv-sheet output[data-hl="${k}"]`);
    if (el && el.textContent !== t) el.textContent = t;
  };
  for (const k of ['D0', 'D1', 'D2', 'Dc']) {
    const x = s[k];
    const el = $(`#kv-sheet output[data-hl="${k}"]`);
    const t = x && x.n > 0 && !x.error ? `${sig(x.mean)}${Number.isFinite(x.urel) ? ` <span class="ua">u<sub>A</sub> ${fmt(x.urel * 100, 2)} %</span>` : ''}` : '—';
    if (el && el.innerHTML !== t) el.innerHTML = t;
  }
  out('half', sig(h.half));
  out('r1', pctSigned(h.r1));
  out('r2', pctSigned(h.r2));
  out('ctrl', Number.isFinite(h.ctrlPct) ? `${fmtSigned(h.ctrlPct, 2)} %` : '—');
  out('hvl', h.ok ? hvlFmt(h.used) : '—');
  out('U', h.ok ? uFmt(h.U) : '—');
  out('diff', h.ok && Number.isFinite(h.diffPct) ? `${fmtSigned(h.diffPct, 1)} %` : '—');
  // бюджет
  const box = $('#kv-hl-budget-box');
  box.hidden = !h.ok;
  if (h.ok) {
    const names = BUDGET_NAMES();
    const rows = h.budget.map((r) => `<tr><td>${esc(names[r.key])}</td><td class="v">${r.key === 'cov' ? sig(r.value, 3) : r.key.startsWith('x') ? sig(r.value, 4) : sig(r.value)}</td><td class="v">${r.key === 'cov' ? '' : sig(r.u, 3)}</td><td class="v">${sig(r.c, 4)}</td><td class="v">${sig(r.contrib, 3)}</td></tr>`);
    rows.push(`<tr class="sum"><td>u<sub>c</sub>, ${esc(L('мм', 'mm'))}</td><td></td><td></td><td></td><td class="v">${uFmt(h.uc)}</td></tr>`);
    rows.push(`<tr class="sum"><td>U (k = ${h.k}), ${esc(L('мм', 'mm'))}</td><td></td><td></td><td></td><td class="v">${uFmt(h.U)}</td></tr>`);
    const body = $('#kv-hl-budget');
    const html = rows.join('');
    if (body.innerHTML !== html) body.innerHTML = html;
  }
}

// ------------------------------------------------------------ СПО и k_Q по режимам
const hvlqBody = () => $('#kv-hvlq-body');

/** Соседние качества сертификата для СПО режима: «0,50–1,05 мм Cu (150–200 кВ)» или «вне 0,20–2,00». */
function qualityText(r) {
  const rows = r.cert?.rows ?? [];
  const it = r.cert?.interp;
  if (r.cert?.kq1) return L('калибровки в рентгене нет', 'no x-ray calibration');
  if (!rows.length) return '—';
  const q = (x) => `${fmt(x.hvl, hvlDecimals(x.hvl))}${Number.isFinite(x.kv) ? L(` (${x.kv} кВ)`, ` (${x.kv} kV)`) : ''}`;
  if (rows.length === 1) return q(rows[0]);
  if (it?.extrapolated) return L(`вне ${fmt(rows[0].hvl, hvlDecimals(rows[0].hvl))}–${fmt(rows[rows.length - 1].hvl, hvlDecimals(rows[rows.length - 1].hvl))}: экстраполяция`, `outside ${fmt(rows[0].hvl, hvlDecimals(rows[0].hvl))}–${fmt(rows[rows.length - 1].hvl, hvlDecimals(rows[rows.length - 1].hvl))}: extrapolated`);
  if (!Number.isInteger(it?.i)) return '—';
  return `${q(rows[it.i])} – ${q(rows[it.i + 1])}`;
}

/** Значение сертификата для пучка: k_Q, N или K — по форме сертификата камеры. */
function certCell(r) {
  const form = r.form?.kv_cert_form;
  const v = r.cert?.value;
  if (!Number.isFinite(v)) return '—';
  if (form === 'n') return `${fmt(v, 6)}<small>N</small>`;
  if (form === 'k') return `${fmt(v, 4)}<small>K</small>`;
  return fmt(v, 4);
}

/** Состояние строки режима: худшее из измерения СПО и сертификата для СПО пучка. */
function hvlqState(mr, r) {
  const h = mr.hvl;
  const lv = (k) => r.flags[k];
  const hErr = h.messages.some((m) => m.level === 'error');
  const hWarn = h.messages.some((m) => m.level === 'warn');
  const cErr = ['kv_cert', 'kv_hvl', 'kv_kv'].some((k) => lv(k) === 'error');
  const cWarn = ['kv_cert', 'kv_hvl'].some((k) => lv(k) === 'warn');
  if (hErr) return { lvl: 'error', tip: L('Ошибка в измерении СПО: см. замечания режима', 'Error in the HVL measurement: see the messages of the mode') };
  if (cErr) return { lvl: 'error', tip: L('Ошибка в пучке или сертификате камеры: см. замечания режима', 'Error in the beam or the chamber certificate: see the messages of the mode') };
  if (hWarn) return { lvl: 'warn', tip: L('Есть предупреждения к измерению СПО', 'The HVL measurement has warnings') };
  if (cWarn) return { lvl: 'warn', tip: L('Есть предупреждения к сертификату для СПО пучка', 'The certificate at the beam HVL has warnings') };
  if (h.state === 'empty') return { lvl: Number.isFinite(r.cert?.value) ? 'ok' : 'empty', tip: L('СПО не измерялся: в расчёте — СПО из таблицы режимов', 'HVL not measured: the HVL from the modes table is used') };
  return { lvl: 'ok', tip: L('Замечаний нет', 'No issues') };
}

function renderHvlTable(vr) {
  const v = api.getVisit();
  const cap = (t) => ` data-cap="${esc(t)}"`;
  const rows = v.modes.map((md, m) => {
    const mr = vr.modes[m];
    const r = mr.results[md.active] ?? mr.results[0];
    const h = mr.hvl;
    const mat = h.mat;
    const on = m === v.mode;
    const meas = h.ok ? `${hvlFmt(h.used)} ± ${uFmt(h.U)}<small>${esc(unitText(mat))}, k = 2</small>` : h.state === 'empty' ? '—' : `<small>${esc(L('не вычислен', 'not calculated'))}</small>`;
    const used = Number.isFinite(r.inputs.hvl) ? `${hvlFmt(r.inputs.hvl)}<small>${esc(r.inputs.hvlSource === 'measured' ? L('измеренный', 'measured') : L('из таблицы режимов', 'from the modes table'))}</small>` : '—';
    const { lvl, tip } = hvlqState(mr, r);
    const ns = r.cal === 'nk' ? 'N<sub>K,Q</sub>' : 'N<sub>D,w,Q</sub>';
    return `<tr data-m="${m}"${on ? ' class="active"' : ''}>
      <td class="no"><button type="button" class="kv-hq-pick" aria-pressed="${on}" aria-label="${esc(L(`Режим ${m + 1}: открыть`, `Mode ${m + 1}: open`))}" title="${esc(L('Открыть режим', 'Open the mode'))}">${m + 1}</button></td>
      <td class="mode"${cap(L('Режим', 'Mode'))}>${esc(api.modeName(m))}</td>
      <td class="ch"${cap(L('Камера', 'Chamber'))}>${esc(api.chamberName(md.chamber))}</td>
      <td class="v meas"${cap(L('СПО измерен.', 'HVL measured'))}>${meas}</td>
      <td class="v used"${cap(L('СПО в расчёте', 'HVL used'))}>${used}</td>
      <td class="q"${cap(L('Качества сертификата', 'Certificate qualities'))}>${esc(qualityText(r))}</td>
      <td class="v kq"${cap('kQ')}>${certCell(r)}</td>
      <td class="v nq"${cap(L('NQ, Гр/нКл', 'NQ, Gy/nC'))}>${Number.isFinite(r.cert?.NQ) ? `${fmt(r.cert.NQ, 6)}<small>${ns}</small>` : '—'}</td>
      <td class="act"><span class="st ${lvl}" role="img" title="${esc(tip)}" aria-label="${esc(tip)}"></span></td>
    </tr>`;
  });
  const html = rows.join('');
  if (hvlqBody().innerHTML !== html) hvlqBody().innerHTML = html;
  const n = v.modes.filter((_, m) => vr.modes[m].hvl.apply).length;
  const note = $('#kv-hvlq-note');
  const txt = n ? L(`Измеренный СПО идёт в расчёт ${n === v.modes.length ? 'всех режимов' : `режимов: ${n} из ${v.modes.length}`}. В «Оборудование» он записывается кнопкой «Сохранить аппарат в Оборудование» (лист «Аппарат и режимы») — с вопросом, если там другой СПО.`, `The measured HVL is used in ${n === v.modes.length ? 'all modes' : `${n} of ${v.modes.length} modes`}. It is saved to Equipment with “Save the unit to Equipment” (the Machine and modes sheet), with a question if the HVL there differs.`) : '';
  note.hidden = !txt;
  note.textContent = txt;
}

/** Замечания к набору пластин (ошибки строк, толщина — номинальная). */
function renderPlatesNote(f) {
  const set = kvPlateSet(f);
  const parts = [
    set.errors.length ? L(`Ошибки: ${set.errors.map((e) => e.text).join('; ')}.`, `Errors: ${set.errors.map((e) => e.text).join('; ')}.`) : '',
    set.notes.length ? L(`Без измеренной толщины (берётся номинальная): ${set.notes.join(', ')}.`, `No measured thickness (the nominal one is used): ${set.notes.join(', ')}.`) : '',
  ].filter(Boolean);
  const note = $('#kv-plates-note');
  note.hidden = !parts.length;
  note.textContent = parts.join(' ');
  note.classList.toggle('warn', set.errors.length > 0);
  // подсветка строк с ошибками
  const bad = new Set(set.errors.map((e) => e.row - 1));
  for (const tr of $$('tr[data-pl]', platesBody())) {
    for (const el of tr.querySelectorAll('[data-pk]')) el.classList.toggle('flag-error', bad.has(Number(tr.dataset.pl)) && el.dataset.pk !== 'kv_pl_mat');
  }
}

/** Лист «СПО и k_Q» после пересчёта: f — форма выбранного режима, vr — computeKvVisit. */
export function renderHvlSheet(f, vr) {
  if (!api) return;
  const v = api.getVisit();
  const h = vr.modes[v.mode].hvl;
  renderMeasurement(f, h);
  renderHvlTable(vr);
  renderPlatesNote(f);
  // в печать лист идёт, только если СПО где-то измеряли или есть набор пластин
  const used = vr.modes.some((mr) => mr.hvl.state !== 'empty') || (f.kv_pl_name ?? []).some((n) => str(n).trim() !== '');
  for (const sec of document.querySelectorAll('#kv-sheet section.step[data-kv-page="hvl"]')) sec.classList.toggle('no-print', !used);
}

/** Подпись поля «СПО» на листе «Аппарат и режимы»: в расчёте — измеренный. */
export function hvlFieldSub(h, r) {
  if (h?.apply && r?.inputs?.hvlSource === 'measured') return L(`в расчёте — измеренный на листе «СПО и k_Q»: ${hvlFmt(h.used)} ± ${uFmt(h.U)} мм (k = 2)`, `the calculation uses the one measured on the “HVL and k_Q” sheet: ${hvlFmt(h.used)} ± ${uFmt(h.U)} mm (k = 2)`);
  if (h?.ok) return L(`первый слой половинного ослабления; измеренный (${hvlFmt(h.used)} мм) в расчёт не взят`, `first half-value layer; the measured one (${hvlFmt(h.used)} mm) is not used`);
  return L('первый слой половинного ослабления', 'first half-value layer');
}

/** Строки протокола: измерение СПО и значение сертификата по режимам. */
export function hvlReportLines(visit, vr) {
  const out = [];
  const cells = (a) => (Array.isArray(a) ? a.filter((s) => str(s).trim() !== '').join('; ') : '');
  const any = vr.modes.some((mr) => mr.hvl.state !== 'empty');
  const multi = visit.modes.length > 1;
  if (!any && !multi) return out;
  out.push(L('СПО и k_Q по режимам:', 'HVL and k_Q by mode:'));
  visit.modes.forEach((md, m) => {
    const mr = vr.modes[m];
    const r = mr.results[md.active] ?? mr.results[0];
    const h = mr.hvl;
    const f = md.shared;
    const u = unitText(h.mat);
    const parts = [];
    if (h.state !== 'empty') {
      const geo = [str(f.kv_hl_dist).trim() ? L(`источник — камера ${f.kv_hl_dist} см`, `source to chamber ${f.kv_hl_dist} cm`) : '', str(f.kv_hl_app).trim() ? L(`поле ${f.kv_hl_app}`, `field ${f.kv_hl_app}`) : ''].filter(Boolean).join(', ');
      const xt = (x, raw) => (x && Number.isFinite(x.value) ? `${sig(x.value, 4)} ${L('мм', 'mm')}${x.from === 'plates' ? ` (${x.names.join('+')})` : ''}` : str(raw) || '—');
      parts.push(
        L(
          `D₀: ${cells(f.kv_hl_D0) || '—'}; x₁ = ${xt(h.x1, f.kv_hl_x1)}: ${cells(f.kv_hl_D1) || '—'}; x₂ = ${xt(h.x2, f.kv_hl_x2)}: ${cells(f.kv_hl_D2) || '—'}${cells(f.kv_hl_Dc) ? `; контрольный D₀: ${cells(f.kv_hl_Dc)}` : ''}${geo ? ` (${geo})` : ''}`,
          `D₀: ${cells(f.kv_hl_D0) || '—'}; x₁ = ${xt(h.x1, f.kv_hl_x1)}: ${cells(f.kv_hl_D1) || '—'}; x₂ = ${xt(h.x2, f.kv_hl_x2)}: ${cells(f.kv_hl_D2) || '—'}${cells(f.kv_hl_Dc) ? `; control D₀: ${cells(f.kv_hl_Dc)}` : ''}${geo ? ` (${geo})` : ''}`,
        ),
      );
      parts.push(h.ok ? L(`СПО = ${hvlFmt(h.used)} ± ${uFmt(h.U)} ${u} (k = 2)${h.apply ? '' : ', в расчёт не взят'}`, `HVL = ${hvlFmt(h.used)} ± ${uFmt(h.U)} ${u} (k = 2)${h.apply ? '' : ', not used'}`) : L('СПО не вычислен (см. замечания)', 'HVL not calculated (see the messages)'));
    }
    const valName = r.form?.kv_cert_form === 'k' ? 'K' : r.form?.kv_cert_form === 'n' ? (r.cal === 'nk' ? 'N_K' : 'N_D,w') : 'k_Q';
    const ns = r.cal === 'nk' ? 'N_K,Q' : 'N_D,w,Q';
    if (Number.isFinite(r.inputs.hvl)) {
      const src = r.inputs.hvlSource === 'measured' ? L('измеренный', 'measured') : L('из таблицы режимов', 'from the modes table');
      parts.push(`${L('в расчёте', 'used')} ${hvlFmt(r.inputs.hvl)} ${u} (${src}): ${valName} = ${Number.isFinite(r.cert?.value) ? fmt(r.cert.value, valName === 'k_Q' || valName === 'K' ? 4 : 6) : '—'}, ${ns} = ${Number.isFinite(r.cert?.NQ) ? fmt(r.cert.NQ, 6) : '—'} ${L('Гр/нКл', 'Gy/nC')}${r.cert?.interp?.extrapolated ? L(' (экстраполяция)', ' (extrapolated)') : ''}`);
    }
    out.push(`  ${L(`Режим ${m + 1}`, `Mode ${m + 1}`)} (${api.modeName(m)}): ${parts.join('; ') || '—'}`);
  });
  const tols = [
    [visit.common.kv_hl_ua_tol, L('u_A среднего ≤ X %', 'u_A of the mean ≤ X %')],
    [visit.common.kv_hl_band_tol, L('D̄₁ и D̄₂ от D̄₀/2 ≤ X %', 'D̄₁ and D̄₂ from D̄₀/2 ≤ X %')],
    [visit.common.kv_hl_ctrl_tol, L('контрольный D₀ от начального ≤ X %', 'control D₀ from the initial one ≤ X %')],
  ].filter(([t]) => str(t).trim()).map(([t, s]) => s.replace('X', str(t).trim()));
  if (any && tols.length) out.push(L(`  Допуски измерения СПО (по методике учреждения): ${tols.join('; ')}.`, `  HVL measurement tolerances (local procedure): ${tols.join('; ')}.`));
  return out;
}

/** Подключить лист: a — { getVisit, changed(), status(text), material(), modeName(m), chamberName(j), selectMode(m) }. */
export function setupKvHvl(a) {
  api = a;
  $('#kv-btn-add-plate').addEventListener('click', addPlate);
  platesBody().addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pl-del]');
    if (b) deletePlate(Number(b.dataset.plDel));
  });
  hvlqBody().addEventListener('click', (e) => {
    const b = e.target.closest('.kv-hq-pick');
    if (b) api.selectMode(Number(b.closest('tr[data-m]').dataset.m));
  });
}

