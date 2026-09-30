// Общие вспомогательные функции интерфейса.

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
export function fmt(value, digits = 4) {
  if (!Number.isFinite(value)) return '—';
  if (!numberFormats.has(digits)) {
    numberFormats.set(digits, new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }));
  }
  return numberFormats.get(digits).format(value).replace('-', '−');
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
    setStatus(ok ? okMsg : 'Браузер не дал скопировать: выделите текст вручную.');
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

/** Двухшаговая кнопка подтверждения (вместо confirm()). */
export function armButton(btn, idleText, armedText, action) {
  btn.addEventListener('click', () => {
    if (btn.dataset.armed) {
      delete btn.dataset.armed;
      btn.classList.remove('danger-armed');
      btn.textContent = idleText;
      action();
      return;
    }
    btn.dataset.armed = '1';
    btn.classList.add('danger-armed');
    btn.textContent = armedText;
    setTimeout(() => {
      if (btn.dataset.armed) {
        delete btn.dataset.armed;
        btn.classList.remove('danger-armed');
        btn.textContent = idleText;
      }
    }, 4000);
  });
}
