// «Как получено» своё значение бюджета неопределённости: источник, документ, способ расчёта u, статус и комментарий.
// Расчёт — core/unc-est.js; данные — в скрытом поле unc_row_notes (JSON { ключ: оценка }), ключи — строки бюджета
// (t17.st_read …), поправки раскрытия k_i (ki.kelec …) и составляющие установки (setup.depth …).
import { L } from '../core/i18n.js';
import { EST_SOURCES, EST_METHODS, EST_DIST, EST_UNITS, unitText, estimateU } from '../core/unc-est.js';
import { parseOverrides } from '../core/uncertainty.js';
import { esc, fmt } from './common.js';

const STATUS = () => ({ fact: L('фактические данные', 'actual data'), temp: L('временно', 'provisional'), cons: L('консервативно', 'conservative'), acc: L('принято', 'adopted') });
const opts = (map, empty) => (empty ? `<option value="">${esc(empty)}</option>` : '') + Object.entries(map).map(([k, t]) => `<option value="${esc(k)}">${esc(t)}</option>`).join('');

/** Раскрытые вручную блоки «как получено» (по ключу) — переживают перерисовку таблиц. */
const open = new Set();

/** Кнопка «как получено» у строки. */
export const estToggleHtml = (key) => `<button type="button" class="link-btn est-toggle no-print" data-est-toggle="${esc(key)}" aria-expanded="false">${esc(L('как получено', 'how obtained'))}</button>`;

/** Блок «как получено». sensHint — чувствительность по умолчанию для подсказки (%/ед.). */
export function estHtml(key, label, { sensHint = NaN } = {}) {
  const id = (f) => `unc_est_${key.replace(/[^\w]/g, '_')}_${f}`;
  const a = (f, what) => `id="${id(f)}" data-est="${f}" data-est-key="${esc(key)}" aria-label="${esc(`${what}: ${label}`)}"`;
  return `<div class="unc-est" data-est-box="${esc(key)}"${Number.isFinite(sensHint) ? ` data-sens-hint="${sensHint}"` : ''} hidden>
    <div class="est-row">
      <select ${a('src', L('Источник', 'Source'))}>${opts(EST_SOURCES(), L('источник…', 'source…'))}</select>
      <input type="text" ${a('doc', L('Документ', 'Document'))} placeholder="${esc(L('№ документа, дата', 'document No., date'))}">
    </div>
    <div class="est-row">
      <select ${a('m', L('Способ', 'Method'))}>${opts(EST_METHODS())}</select>
      <span class="est-f" data-for="Uk rect tri"><span class="est-l" data-v-label></span><input type="text" class="num" inputmode="decimal" ${a('v', L('Значение', 'Value'))} placeholder=" "></span>
      <span class="est-f" data-for="Uk"><span class="est-l">k</span><input type="text" class="num" inputmode="decimal" ${a('k', 'k')} placeholder="2"></span>
      <span class="est-f" data-for="sens"><span class="est-l">d</span><input type="text" class="num" inputmode="decimal" ${a('d', L('Погрешность', 'Error'))} placeholder=" "><select ${a('unit', L('Единица', 'Unit'))}>${opts(EST_UNITS())}</select><select ${a('dist', L('Вид погрешности', 'Kind of error'))}>${opts(EST_DIST())}</select></span>
      <span class="est-f" data-for="sens"><span class="est-l">×</span><input type="text" class="num" inputmode="decimal" ${a('s', L('Чувствительность', 'Sensitivity'))} placeholder=" "><span class="est-l" data-s-unit></span></span>
      <output class="est-out" data-est-out></output>
    </div>
    <div class="est-row">
      <select ${a('st', L('Статус', 'Status'))}>${opts(STATUS(), L('статус…', 'status…'))}</select>
      <input type="text" ${a('text', L('Комментарий', 'Comment'))} placeholder="${esc(L('комментарий', 'comment'))}">
    </div>
  </div>`;
}

/** Подключить: ввод в блоках обновляет JSON до того, как событие дойдёт до формы; кнопки раскрывают блоки. */
export function setupEst(root, hidden) {
  const onEdit = (e) => {
    const el = e.target.closest?.('[data-est]');
    if (!el) return;
    const key = el.dataset.estKey;
    // блок, в котором вводят, остаётся открытым, даже если поля опустели
    open.add(key);
    const map = parseOverrides(hidden.value);
    const est = { ...(map[key] || {}) };
    const v = el.value.trim();
    if (v) est[el.dataset.est] = v;
    else delete est[el.dataset.est];
    if (est.m === 'u') delete est.m;
    // «погрешность × чувствительность»: чувствительность по подсказке строки подставляется сразу (её видно и можно
    // изменить); при смене единицы подсказка в мм к ней не относится — поле очищается
    const box = el.closest('[data-est-box]');
    const hint = parseFloat(box?.dataset.sensHint);
    if (el.dataset.est === 'm' && v === 'sens' && !est.s && Number.isFinite(hint)) {
      est.s = fmt(hint, 2);
      est.unit = 'mm';
    }

    if (Object.keys(est).length) map[key] = est;
    else delete map[key];
    hidden.value = Object.keys(map).length ? JSON.stringify(map) : '';
  };
  root.addEventListener('input', onEdit);
  root.addEventListener('change', onEdit);
  root.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-est-toggle]');
    if (!b) return;
    e.preventDefault();
    const key = b.dataset.estToggle;
    if (open.has(key)) open.delete(key);
    else open.add(key);
    const box = root.querySelector(`[data-est-box="${CSS.escape(key)}"]`);
    if (box) box.hidden = !open.has(key) && !box.dataset.keep;
    b.setAttribute('aria-expanded', String(!!box && !box.hidden));
  });
}

/**
 * Обновить блок оценки: значения полей (кроме того, в котором вводят), видимость полей способа, результат.
 * keep — показывать блок без нажатия (есть своё значение или уже заполнена оценка).
 */
export function updateEst(root, key, est, { keep = false } = {}) {
  const box = root.querySelector(`[data-est-box="${CSS.escape(key)}"]`);
  if (!box) return;
  const e = est && typeof est === 'object' ? est : {};
  const filled = Object.keys(e).length > 0;
  box.dataset.keep = keep || filled ? '1' : '';
  // не закрывать блок, в котором сейчас вводят
  box.hidden = !(keep || filled || open.has(key) || box.contains(document.activeElement));
  const tg = root.querySelector(`[data-est-toggle="${CSS.escape(key)}"]`);
  if (tg) {
    tg.setAttribute('aria-expanded', String(!box.hidden));
    tg.hidden = keep || filled;
  }
  for (const el of box.querySelectorAll('[data-est]')) {
    if (document.activeElement === el) continue;
    const f = el.dataset.est;
    el.value = e[f] ?? (f === 'm' ? 'u' : f === 'unit' ? 'mm' : f === 'dist' ? 'rect' : '');
  }
  const m = e.m || 'u';
  for (const s of box.querySelectorAll('.est-f')) s.hidden = !s.dataset.for.split(' ').includes(m);
  box.querySelector('[data-v-label]').textContent = { Uk: 'U, %', rect: 'a, %', tri: 'a, %' }[m] ?? '';
  box.querySelector('[data-s-unit]').textContent = `%/${unitText(e.unit || 'mm')}`;
  const r = estimateU(e);
  const out = box.querySelector('[data-est-out]');
  out.textContent = r ? (r.error ? r.error : `u = ${r.formula}`) : L('u — число в поле «Своё»', 'u is the number in the “Yours” field');
  out.classList.toggle('err', !!r?.error);
}
