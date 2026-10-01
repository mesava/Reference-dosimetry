// Переключение языка интерфейса.
// Статический текст страницы (index.html) пишется по-русски и переводится по словарю фрагментов
// STATIC_EN: каждый текстовый узел и переводимый атрибут ищется в словаре целиком. Динамический
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

/** Переводит статический текст внутри root на текущий язык (или возвращает русский). */
export function translateStatic(root = document.body) {
  for (const r of recorded) {
    if (r.attr) r.node.setAttribute(r.attr, r.original);
    else r.node.nodeValue = r.original;
  }
  recorded = [];
  if (getLang() !== 'en') return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || p.closest('script, style, textarea, [data-i18n-skip]')) return NodeFilter.FILTER_REJECT;
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
  const en = getLang() === 'en';
  for (const el of root.querySelectorAll('input.num')) {
    const v = el.value;
    if (/^\s*[+\-−]?\d+[.,]\d+\s*$/.test(v)) el.value = en ? v.replace(',', '.') : v.replace('.', ',');
  }
}
