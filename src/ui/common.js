// Общие вспомогательные функции интерфейса.
import { L, getLang } from '../core/i18n.js';

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

/** Видимость по data-protocol, data-show и data-standalone внутри root. */
export function applyShowRules(root, data, protocol) {
  for (const el of $$('[data-protocol]', root)) el.hidden = !(protocol === 'both' || protocol === el.dataset.protocol);
  for (const el of $$('[data-show]', root)) {
    el.hidden = !el.dataset.show.split(';').every((cond) => {
      const [key, vals] = cond.split(':');
      const v = data[key];
      return vals.split(',').includes(typeof v === 'boolean' ? String(v) : v);
    });
  }
  for (const el of $$('[data-standalone]', root)) el.hidden = framed;
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
/** Пометка к сравнению протоколов: реализация TG-51 приведена для сравнения. */
export const tg51Note = () => L('Реализация TG-51 приведена для сравнения.', 'The TG-51 implementation is provided for comparison.');

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

export function renderSignBlock(el, staff) {
  if (!el) return;
  const note = document.querySelector('.page-foot p')?.textContent?.trim() ?? '';
  const names = Array.isArray(staff) && staff.length ? staff : [''];
  el.innerHTML =
    (note ? `<p class="disclaimer">${esc(note)}</p>` : '') +
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
