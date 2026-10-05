// Переключение языка интерфейса.
// Статический текст страницы (index.html) пишется по-русски и переводится по словарю STATIC_EN:
// абзацы, подписи и пункты списков — целиком вместе с вложенной разметкой, остальное — по текстовым
// узлам и значениям атрибутов. Динамический
// текст модули выводят сами на текущем языке через L() из core/i18n.js.

import { setLang, getLang } from '../core/i18n.js';
import { STATIC_EN } from './i18n-static-en.js';

const LANG_KEY = 'reference-dosimetry.lang';
const ATTRS = ['placeholder', 'aria-label', 'title', 'data-tip', 'data-label', 'data-label-a', 'data-label-b'];
const CYR = /[А-Яа-яЁё]/;
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

let recorded = []; // { node, attr?, original } — что заменено, чтобы вернуть русский текст

/** Язык при открытии: сохранённый выбор, иначе язык браузера (русский — для ru*, иначе английский). */
export function initialLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    /* хранилище недоступно */
  }
  const nav = String((navigator.languages && navigator.languages[0]) || navigator.language || 'ru').toLowerCase();
  return nav.startsWith('ru') ? 'ru' : 'en';
}

export function saveLang(lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* хранилище недоступно */
  }
}

/** Перевод одной строки статического словаря (для текста, который модули берут из разметки). */
export function tStatic(text) {
  if (getLang() !== 'en') return text;
  const en = STATIC_EN[norm(text)];
  return en === undefined ? text : en;
}

/**
 * Блок для перевода целиком: элемент с русским текстом прямо внутри, у которого внутри нет полей ввода,
 * элементов с id и выводов расчёта (их пересоздание сломало бы ссылки модулей). Ключ — его innerHTML
 * с пробелами, сжатыми до одного; перевод сохраняет вложенную разметку (<sub>, кнопки справок).
 */
const UNSAFE = 'input, select, textarea, output, [id], [data-out], [data-out-text], .cells, .combo';
const hasDirectCyr = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && CYR.test(n.nodeValue));
export const blockKey = (el) => norm(el.innerHTML);
export const isBlock = (el) => hasDirectCyr(el) && !el.querySelector(UNSAFE);

/** Переводит статический текст внутри root на текущий язык (или возвращает русский). */
export function translateStatic(root = document.body) {
  for (const r of recorded.reverse()) {
    if (r.attr) r.node.setAttribute(r.attr, r.original);
    else if (r.html) r.node.innerHTML = r.original;
    else r.node.nodeValue = r.original;
  }
  recorded = [];
  if (getLang() !== 'en') return;

  const skip = (el) => !el || el.closest('script, style, textarea, [data-i18n-skip]');
  const done = new Set();
  // 1) блоки целиком
  for (const el of root.querySelectorAll('*')) {
    if (skip(el) || !hasDirectCyr(el)) continue;
    if ([...done].some((d) => d.contains(el))) continue;
    if (!isBlock(el)) continue;
    const en = STATIC_EN[blockKey(el)];
    if (en === undefined) continue;
    recorded.push({ node: el, html: true, original: el.innerHTML });
    el.innerHTML = en;
    done.add(el);
  }
  // 2) отдельные текстовые узлы там, где блок целиком перевести нельзя
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (skip(p)) return NodeFilter.FILTER_REJECT;
      return CYR.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const v = node.nodeValue;
    const en = STATIC_EN[norm(v)];
    if (en === undefined) continue;
    recorded.push({ node, original: v });
    node.nodeValue = v.match(/^\s*/)[0] + en + v.match(/\s*$/)[0];
  }
  // числовые подсказки в полях («0,05335», «1,5») — с десятичной точкой
  for (const el of root.querySelectorAll('input[placeholder]')) {
    const v = el.getAttribute('placeholder');
    if (!/^\s*[+\-−]?\d+,\d+\s*$/.test(v)) continue;
    recorded.push({ node: el, attr: 'placeholder', original: v });
    el.setAttribute('placeholder', v.replace(',', '.'));
  }
  const sel = ATTRS.map((a) => `[${a}]`).join(',');
  for (const el of root.querySelectorAll(sel)) {
    if (el.closest('[data-i18n-skip]')) continue;
    for (const attr of ATTRS) {
      const v = el.getAttribute(attr);
      if (!v || !CYR.test(v)) continue;
      const en = STATIC_EN[norm(v)];
      if (en === undefined) continue;
      recorded.push({ node: el, attr, original: v });
      el.setAttribute(attr, en);
    }
  }
}

/** Задаёт язык: ядро, атрибут lang, статический текст; модули обновляются по событию langchange. */
export function applyLang(lang) {
  setLang(lang);
  document.documentElement.lang = getLang();
  translateStatic(document.body);
  const r = document.getElementById(`lang_${getLang()}`);
  if (r) r.checked = true;
  document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: getLang() } }));
}

/** Десятичный разделитель в числовых полях: запятая по-русски, точка по-английски. */
export function localizeDecimals(root) {
  if (!root) return;
  for (const el of root.querySelectorAll('input.num')) localizeDecimal(el);
}

/** Одно число в поле — с десятичным разделителем языка интерфейса (12.76 → 12,76 по-русски). Возвращает true, если значение изменилось. */
export function localizeDecimal(el) {
  const v = el.value;
  if (!/^\s*[+\-−]?\d+[.,]\d+\s*$/.test(v)) return false;
  const next = getLang() === 'en' ? v.replace(',', '.') : v.replace('.', ',');
  if (next === v) return false;
  el.value = next;
  return true;
}
