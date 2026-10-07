// Общие вспомогательные функции интерфейса.
import { L, getLang } from '../core/i18n.js';
import { APP_VERSION, APP_DATE } from '../core/version.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Страница открыта внутри рамки (например, в просмотрщике артефактов): печать и скачивание там не работают. */
export const framed = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const numberFormats = new Map();
/** Число с заданным числом знаков: десятичная запятая по-русски, точка по-английски. */
export function fmt(value, digits = 4) {
  if (!Number.isFinite(value)) return '—';
  const key = `${getLang()}:${digits}`;
  if (!numberFormats.has(key)) {
    numberFormats.set(key, new Intl.NumberFormat(getLang() === 'en' ? 'en-US' : 'ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }));
  }
  return numberFormats.get(key).format(value).replace('-', '−');
}

export function fmtSigned(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return (value > 0 ? '+' : value < 0 ? '−' : '±') + fmt(Math.abs(value), digits);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Строка состояния, которая сама очищается через несколько секунд. */
export function makeStatus(el) {
  let t = 0;
  return (text) => {
    el.textContent = text;
    clearTimeout(t);
    t = setTimeout(() => (el.textContent = ''), 6000);
  };
}

export async function copyText(text, okMsg, setStatus) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(okMsg);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    setStatus(ok ? okMsg : L('Браузер не дал скопировать: выделите текст вручную.', 'The browser blocked copying: select the text manually.'));
  }
}

/** Скачивание файла (работает на обычной странице, не внутри рамки). */
export function downloadText(text, filename, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}

/** Ненадолго подсвечивает поля, заполненные из другой вкладки (видимые). */
export function flashFields(ids) {
  for (const k of ids) {
    const el = document.getElementById(k);
    if (!el || el.closest('[hidden]')) continue;
    el.classList.remove('just-filled');
    void el.offsetWidth;
    el.classList.add('just-filled');
    setTimeout(() => el.classList.remove('just-filled'), 2600);
  }
}

/** Модуль пересчитан: список разделов слева обновляет состояние пунктов. */
export const notifyUpdate = (root) => document.dispatchEvent(new CustomEvent('moduleupdate', { detail: { root } }));

// ------------------------------------------------------------ состояние приложения
let activeModule = 'photons';
export const getActiveModule = () => activeModule;
export const setActiveModule = (m) => {
  activeModule = m;
};

export const PROTOCOL_KEY = 'reference-dosimetry.protocol';

/** Текущий протокол из общего переключателя в шапке. */
export const currentProtocol = () => $('input[name="protocol"]:checked')?.value ?? 'trs';

/** Устанавливает протокол в шапке и оповещает все модули. */
export function applyProtocol(value) {
  const r = document.getElementById(`protocol_${value}`);
  if (!r || r.checked) return;
  r.checked = true;
  r.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Выводит значения в элементы с data-out / data-out-text внутри root. */
export function renderOutputs(root, ctx) {
  for (const el of $$('[data-out]', root)) {
    let v = get(ctx, el.dataset.out);
    if (el.dataset.abs && Number.isFinite(v)) v = Math.abs(v);
    const d = Number(el.dataset.digits ?? 4);
    el.textContent = Number.isFinite(v) ? (el.dataset.signed ? fmtSigned(v, d) : fmt(v, d)) + (el.dataset.suffix || '') : '—';
  }
  for (const el of $$('[data-out-text]', root)) {
    const v = get(ctx, el.dataset.outText);
    el.textContent = v ? String(v) : '';
  }
}

/** Подсветка полей по флагам расчёта внутри root. */
export function renderFlags(root, flags, seriesBox) {
  for (const el of $$('.flag-error, .flag-warn', root)) el.classList.remove('flag-error', 'flag-warn');
  for (const [key, level] of Object.entries(flags)) {
    if (level === 'info') continue;
    const cls = level === 'error' ? 'flag-error' : 'flag-warn';
    $$(`[data-flag="${key}"]`, root).forEach((el) => el.classList.add(cls));
    const input = root.querySelector(`#${CSS.escape(key)}`);
    if (input) input.classList.add(cls);
    const box = seriesBox?.(key);
    if (box) box.classList.add(cls);
  }
}

/**
 * Видимость по data-protocol, data-show и data-standalone внутри root.
 * Если у элемента несколько условий, он виден, только когда выполнены все.
 */
export function applyShowRules(root, data, protocol) {
  const showOk = (el) =>
    el.dataset.show.split(';').every((cond) => {
      const [key, vals] = cond.split(':');
      const v = data[key];
      return vals.split(',').includes(typeof v === 'boolean' ? String(v) : v);
    });
  for (const el of $$('[data-protocol], [data-show], [data-standalone]', root)) {
    let visible = true;
    if (el.dataset.protocol) visible = visible && protocol === el.dataset.protocol;
    if (el.dataset.show) visible = visible && showOk(el);
    if (el.hasAttribute('data-standalone')) visible = visible && !framed;
    el.hidden = !visible;
  }
}

/**
 * Двухшаговая кнопка подтверждения (вместо confirm()). Подписи — строки или функции,
 * возвращающие строку на текущем языке.
 */
export function armButton(btn, idleText, armedText, action) {
  const text = (t) => (typeof t === 'function' ? t() : t);
  // меняем тот же текстовый узел, чтобы перевод статического текста (translateStatic) его не терял
  const setText = (t) => {
    const node = btn.firstChild;
    if (node && node.nodeType === Node.TEXT_NODE && btn.childNodes.length === 1) node.nodeValue = text(t);
    else btn.textContent = text(t);
  };
  btn.addEventListener('click', () => {
    if (btn.dataset.armed) {
      delete btn.dataset.armed;
      btn.classList.remove('danger-armed');
      setText(idleText);
      action();
      return;
    }
    btn.dataset.armed = '1';
    btn.classList.add('danger-armed');
    setText(armedText);
    setTimeout(() => {
      if (btn.dataset.armed) {
        delete btn.dataset.armed;
        btn.classList.remove('danger-armed');
        setText(idleText);
      }
    }, 4000);
  });
  // после смены языка подпись должна соответствовать текущему состоянию кнопки
  document.addEventListener('langchange', () => setText(btn.dataset.armed ? armedText : idleText));
}

/**
 * Блок для печати и PDF после таблицы поправок: оговорка об ответственности и строки
 * «ФИО — подпись» по числу сотрудников, выполнявших измерения (пустая строка — для подписи от руки).
 */
/**
 * Заголовок группы таблицы с поглощённой дозой. Показания основного раздела (4 у фотонов, 5 у ⁶⁰Co и
 * электронов) служат для расчёта поправок; доза считается по заряду контрольных измерений, а если их
 * нет или в них ошибки — по показанию M₁ основного раздела.
 */
export function doseGroupTitle({ ctrlOn, ctrlFinal, mainSec, ctrlSec, mainAmount, ctrlAmount }) {
  if (ctrlFinal) return L(`Поглощённая доза — по контрольным измерениям (раздел ${ctrlSec}), ${ctrlAmount}`, `Absorbed dose — from check measurements (section ${ctrlSec}), ${ctrlAmount}`);
  return ctrlOn
    ? L(`Поглощённая доза — по контрольным измерениям (раздел ${ctrlSec}): не вычислена, в контрольных измерениях ошибки`, `Absorbed dose — from check measurements (section ${ctrlSec}): not calculated, the check measurements contain errors`)
    : L(`Поглощённая доза — по показанию M₁ раздела ${mainSec}, ${mainAmount} (контрольные измерения не введены)`, `Absorbed dose — from reading M₁ of section ${mainSec}, ${mainAmount} (no check measurements entered)`);
}

/** Текст под итогом, когда контрольные измерения введены с ошибками: итог не показывается. */
export const ctrlErrorText = (ctrlSec, mainSec) =>
  L(
    `В контрольных измерениях (раздел ${ctrlSec}) ошибки — итог не показан, пока их не исправить. Поправки по разделу ${mainSec} посчитаны.`,
    `The check measurements (section ${ctrlSec}) contain errors — the result is not shown until they are corrected. The corrections from section ${mainSec} have been calculated.`,
  );

/**
 * Блок «соответствие протоколу» под итоговой дозой: нет отступлений / нестандартные условия со списком причин.
 * Если итога нет (ошибки), блок скрыт.
 */
export function renderCompliance(el, compliance, protoName) {
  if (!el) return;
  const c = compliance || { status: 'invalid', reasons: [] };
  el.hidden = c.status === 'invalid';
  if (el.hidden) return;
  if (c.status === 'standard') {
    el.className = 'compliance ok';
    el.innerHTML = `<b>${L('Референсные условия', 'Reference conditions')}</b>: ${esc(L(`отступлений от условий ${protoName} не найдено.`, `no deviations from the ${protoName} conditions were found.`))}`;
  } else {
    el.className = 'compliance nonstd';
    el.innerHTML =
      `<b>${L('Нестандартные условия', 'Non-standard conditions')}</b>: ${esc(L(`результат нельзя считать референсной дозиметрией по ${protoName}.`, `the result cannot be regarded as reference dosimetry per ${protoName}.`))}` +
      `<ul>${c.reasons.map((r) => `<li>${esc(r.text)}</li>`).join('')}</ul>`;
  }
}

/** Строка протокола (текст и PDF) о соответствии референсным условиям. */
export function complianceLine(compliance, protoName) {
  const c = compliance || { status: 'invalid', reasons: [] };
  if (c.status === 'invalid') return null;
  if (c.status === 'standard') return L(`Референсные условия: отступлений от условий ${protoName} не найдено`, `Reference conditions: no deviations from the ${protoName} conditions were found`);
  return L(
    `НЕСТАНДАРТНЫЕ УСЛОВИЯ — результат нельзя считать референсной дозиметрией по ${protoName}: ${c.reasons.map((r) => r.text).join('; ')}`,
    `NON-STANDARD CONDITIONS — the result cannot be regarded as reference dosimetry per ${protoName}: ${c.reasons.map((r) => r.text).join('; ')}`,
  );
}

/** Подписи строк с показаниями в таблице. */
export const rawReadingLabel = () => L('Среднее показание M₁ (без поправок), нКл', 'Mean reading M₁ (uncorrected), nC');
export const correctedReadingLabel = (withVol = false) =>
  withVol
    ? L('Исправленное показание: M₁ с поправками на T и P, электрометр, полярность, рекомбинацию, утечку и объём, нКл', 'Corrected reading: M₁ corrected for T and P, electrometer, polarity, recombination, leakage and volume averaging, nC')
    : L('Исправленное показание: M₁ с поправками на T и P, электрометр, полярность, рекомбинацию и утечку, нКл', 'Corrected reading: M₁ corrected for T and P, electrometer, polarity, recombination and leakage, nC');

/**
 * Демонстрационные подписи (учреждение, аппарат, пучок, примечания) — на языке интерфейса:
 * если поле содержит демо-значение другого языка, оно заменяется; свои значения не трогаются.
 */
export function localizeDemo(ruSample, enOverlay) {
  const en = getLang() === 'en';
  for (const [key, enValue] of Object.entries(enOverlay)) {
    const el = document.getElementById(key);
    const ruValue = ruSample[key];
    if (!el || typeof ruValue !== 'string') continue;
    if (el.value === (en ? ruValue : enValue)) el.value = en ? enValue : ruValue;
  }
}

/**
 * Оговорка о числе знаков: точность вычислений, а не измерения. На вкладках дозиметрии — где оценить
 * неопределённость (инструмент «Неопределённость»); в перекрёстной калибровке — что она не оценивается.
 */
export const precisionNote = (withBudget = true) =>
  withBudget
    ? L(
        'Значения приводятся с четырьмя знаками после запятой, чтобы не накапливать ошибки округления: это точность вычислений, а не измерения. Неопределённость результата здесь не оценивается: бюджет неопределённости составляется во вкладке «Инструменты» → «Неопределённость».',
        'Values are given with four decimals to avoid round-off errors: this is computational precision, not measurement accuracy. The uncertainty of the result is not evaluated here: the uncertainty budget is set up under Tools → Uncertainty.',
      )
    : L(
        'Значения приводятся с четырьмя знаками после запятой, чтобы не накапливать ошибки округления: это точность вычислений, а не измерения. Неопределённость результата здесь не оценивается.',
        'Values are given with four decimals to avoid round-off errors: this is computational precision, not measurement accuracy. The uncertainty of the result is not evaluated here.',
      );

/** Версия калькулятора с датой выпуска — для протокола и сохранённых файлов. */
export const versionText = () => L(`версия ${APP_VERSION} от ${dateText(APP_DATE)}`, `version ${APP_VERSION} of ${dateText(APP_DATE)}`);
const dateText = (iso) => {
  const [y, m, d] = String(iso).split('-');
  return getLang() === 'en' ? `${y}-${m}-${d}` : `${d}.${m}.${y}`;
};

/** extra: true/false — оговорка о точности для вкладок дозиметрии / перекрёстной калибровки, строка — свой текст. */
export function renderSignBlock(el, staff, extra = true) {
  if (!el) return;
  const note = document.querySelector('.page-foot p')?.textContent?.trim() ?? '';
  const names = Array.isArray(staff) && staff.length ? staff : [''];
  const ver = L(`Расчёт: калькулятор «Референсная дозиметрия», ${versionText()}, https://mesava.github.io/Reference-dosimetry/`, `Calculation: Reference Dosimetry calculator, ${versionText()}, https://mesava.github.io/Reference-dosimetry/`);
  el.innerHTML =
    (note ? `<p class="disclaimer">${esc(note)}</p>` : '') +
    `<p class="disclaimer">${esc(typeof extra === 'string' ? extra : precisionNote(extra))} ${esc(ver)}</p>` +
    '<table><tbody>' +
    names
      .map(
        (n) => `<tr><td class="sig-name"><span>${esc(String(n ?? '').trim()) || '&nbsp;'}</span></td><td class="sig-line"><span>&nbsp;</span></td></tr>
        <tr class="sig-cap"><td>${L('ФИО', 'Name')}</td><td><span>${L('подпись', 'signature')}</span></td></tr>`,
      )
      .join('') +
    '</tbody></table>';
}

/**
 * Сохранение в PDF через окно печати браузера. Имя документа на время печати становится
 * именем файла по умолчанию.
 */
export function printToPdf(fileTitle, setStatus) {
  const old = document.title;
  document.title = String(fileTitle || old).replace(/[\\/:*?"<>|]+/g, '-');
  setStatus?.(L('В окне печати выберите «Сохранить как PDF» (в поле «Принтер» или «Назначение»).', 'In the print dialog choose “Save as PDF” as the printer or destination.'));
  const restore = () => {
    document.title = old;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}

// ------------------------------------------------------------ сохранённые файлы: версия и итог
/** Поля, которые добавляются в сохраняемый файл: версия калькулятора и итоговый результат на момент сохранения. */
export const fileStamp = (snapshot) => ({ appVersion: APP_VERSION, appDate: APP_DATE, result: snapshot });

/** Файл сохранён более новым форматом, чем понимает эта версия: открывать нельзя, чтобы не истолковать данные неверно. */
export function checkFileFormat(obj, tag) {
  const v = Number(obj.version);
  if (Number.isFinite(v) && v > tag.version) {
    throw new Error(
      L(
        `Файл сохранён более новой версией калькулятора (формат файла ${v}, эта страница понимает до ${tag.version}): обновите страницу (Ctrl+F5) и откройте файл снова.`,
        `The file was saved by a newer version of the calculator (file format ${v}; this page supports up to ${tag.version}): reload the page (Ctrl+F5) and open the file again.`,
      ),
    );
  }
}

/**
 * Сравнение итога из файла с пересчётом текущей версией.
 * keys — величины для сравнения; main — главная из них (для текста); unit — подпись единиц.
 * Возвращает { kind: 'same' | 'diff' | 'none', text }.
 */
export function compareWithFile(obj, now, { keys, main, unit, digits = 4 }) {
  const ver = obj.appVersion ? L(`версией ${obj.appVersion}${obj.appDate ? ` от ${dateText(obj.appDate)}` : ''}`, `by version ${obj.appVersion}${obj.appDate ? ` of ${dateText(obj.appDate)}` : ''}`) : L('ранней версией калькулятора', 'by an early version of the calculator');
  const saved = obj.result;
  if (!saved || typeof saved !== 'object') {
    return { kind: 'none', text: L(`Файл сохранён ${ver} без итогового результата: показан пересчёт текущей версией (${APP_VERSION}), сравнить его с сохранённым нельзя.`, `The file was saved ${ver} without the final result: the recalculation by the current version (${APP_VERSION}) is shown and cannot be compared with a saved value.`) };
  }
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!fin(saved[main]) || !fin(now?.[main])) {
    if (!fin(saved[main]) && !fin(now?.[main])) return { kind: 'same', text: L(`Файл сохранён ${ver}. Итог не вычислен ни при сохранении, ни сейчас.`, `The file was saved ${ver}. The result was not calculated either when saved or now.`) };
    return {
      kind: 'diff',
      text: fin(saved[main])
        ? L(`Файл сохранён ${ver} с итогом ${fmt(saved[main], digits)} ${unit}; текущая версия (${APP_VERSION}) итог не вычислила — см. замечания.`, `The file was saved ${ver} with the result ${fmt(saved[main], digits)} ${unit}; the current version (${APP_VERSION}) did not calculate a result — see Messages.`)
        : L(`Файл сохранён ${ver} без итога (были ошибки); текущая версия (${APP_VERSION}) итог вычислила.`, `The file was saved ${ver} without a result (there were errors); the current version (${APP_VERSION}) calculated a result.`),
    };
  }
  const changed = keys.filter((k) => fin(saved[k]) !== fin(now[k]) || (fin(saved[k]) && Math.abs(now[k] / saved[k] - 1) > 1e-9));
  if (!changed.length) return { kind: 'same', text: L(`Файл сохранён ${ver}. Пересчёт текущей версией (${APP_VERSION}) совпадает с сохранённым итогом.`, `The file was saved ${ver}. The recalculation by the current version (${APP_VERSION}) matches the saved result.`) };
  const a = saved[main];
  const b = now[main];
  const d = (b / a - 1) * 100;
  return {
    kind: 'diff',
    text:
      Math.abs(b / a - 1) > 1e-9
        ? L(`Файл сохранён ${ver}. Пересчёт текущей версией (${APP_VERSION}) отличается: было ${fmt(a, digits)}, стало ${fmt(b, digits)} ${unit} (${fmtSigned(d, 3)} %). Расчёт в новой версии изменился — проверьте замечания и при необходимости историю изменений.`, `The file was saved ${ver}. The recalculation by the current version (${APP_VERSION}) differs: it was ${fmt(a, digits)}, now ${fmt(b, digits)} ${unit} (${fmtSigned(d, 3)} %). The calculation has changed in the new version — check the messages and, if needed, the change history.`)
        : L(`Файл сохранён ${ver}. Итог совпадает, но изменились промежуточные величины (${changed.join(', ')}).`, `The file was saved ${ver}. The result matches, but intermediate quantities changed (${changed.join(', ')}).`),
  };
}

/**
 * В «Примечаниях» остался текст демонстрационного примера, хотя данные уже свои: напоминание над результатом
 * (иначе фраза «демонстрационные данные» попадёт в настоящий протокол).
 */
export function renderNotesFlag(el, notes, demoNotes, isDemo) {
  if (!el) return;
  const left = !isDemo && demoNotes.includes(String(notes ?? '').trim());
  el.hidden = !left;
  if (left) el.textContent = L('В «Примечаниях» остался текст демонстрационного примера — удалите или замените его перед печатью протокола.', 'The Notes still contain the demo text — delete or replace it before printing the report.');
}

/** Заметка о сверке открытого файла: показывается, пока форму не меняли. */
export function renderFileNote(el, note) {
  if (!el) return;
  el.hidden = !note;
  if (!note) return;
  el.className = `file-note ${note.kind}`;
  el.textContent = note.text;
}
