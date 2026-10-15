// Ссылки на разделы рабочего листа: «раздел 7», «в разделе 9», «разделы 5 и 7», «section 4» в тексте страницы
// становятся ссылками, которые прокручивают к разделу и подсвечивают его.
// Куда ведёт ссылка: в тот же модуль; если у текста есть предок с data-sec-target — в указанный модуль; в журнале
// (карточка пучка .jsb) — на вкладку дозиметрии этого пучка, и к ссылке добавляется подпись модальности: «раздел 7
// фотонов», «section 7 (electrons)» (тексты с data-sec-target сами называют вкладку — подпись не нужна).
// Ссылки только оборачивают уже написанный текст, поэтому ключ перевода статического блока (i18n.js, blockKey)
// снимает их и подпись .sec-suf.
import { L } from '../core/i18n.js';

// номера разделов протоколов пишутся «разд. 4.4.3» / «Sec. 4.4.3» и сюда не попадают; «4.4» после слова отсекается
const RE = /(?<![\p{L}\d])([Рр]аздел(?:ы|а|е|у|ом|ах|ам|ов)?|[Ss]ections?)(\s+)(\d+)(?!\d)(?![.,]\d)((?:\s*(?:,|и|или|and|or|\(или|\(or)\s+\d+(?!\d)(?![.,]\d)\)?)*)/gu;
const SKIP = 'a, button, input, select, textarea, option, script, style, .secnav, .term, [contenteditable], .no-sec-links';
/** Вид пучка журнала → модуль вкладки дозиметрии. */
const KIND_MODULE = { photon: 'photons', electron: 'electrons', cobalt: 'co60' };
/** Подпись модальности после номера раздела другой вкладки. */
const suffix = (module) =>
  ({
    photons: L(' фотонов', ' (MV photons)'),
    electrons: L(' электронов', ' (electrons)'),
    co60: L(' ⁶⁰Co', ' (⁶⁰Co)'),
    jaffe: L(' графика Яффе', ' (Jaffé plot)'),
    tools: L(' перекрёстной калибровки', ' (cross-calibration)'),
    edepth: L(' кривой дозы электронов', ' (electron depth dose)'),
    uncertainty: L(' неопределённости', ' (uncertainty)'),
  })[module] ?? '';

const moduleOf = (el) => el?.closest('.module')?.id?.replace(/^module-/, '') ?? '';

/** Разделы модуля по номеру: { '1': section, … }. */
function sectionMap(module) {
  const root = document.getElementById(`module-${module}`);
  const map = {};
  if (!root) return map;
  for (const n of root.querySelectorAll('.sheet section.step > header > .step-no')) {
    const no = n.textContent.trim();
    if (!(no in map)) map[no] = n.closest('section');
  }
  return map;
}
/** Раздел с номером no в модуле (элемент section.step). */
export const findSection = (module, no) => sectionMap(module)[String(no)] ?? null;
// карта разделов на время одного прохода разметки (чтобы не искать разделы заново для каждого числа)
let passMaps = null;
const sectionsOf = (module) => {
  if (!passMaps) return sectionMap(module);
  if (!passMaps.has(module)) passMaps.set(module, sectionMap(module));
  return passMaps.get(module);
};

/** Куда ведут ссылки в тексте внутри el: { module, beam }. */
function targetOf(el) {
  const t = el.closest('[data-sec-target]');
  if (t) return { module: t.dataset.secTarget, beam: '', named: true };
  const card = el.closest('.jsb[data-beam]');
  if (card) return { module: KIND_MODULE[card.dataset.kind] ?? 'photons', beam: card.dataset.beam, named: false };
  return { module: moduleOf(el), beam: '', named: true };
}

function link(text, target, no, suf) {
  const a = document.createElement('a');
  a.className = 'sec-link';
  a.href = `#${target.module}`;
  a.dataset.secModule = target.module;
  a.dataset.secNo = no;
  if (target.beam) a.dataset.secBeam = target.beam;
  a.textContent = text;
  if (suf) {
    const s = document.createElement('span');
    s.className = 'sec-suf';
    s.textContent = suf;
    a.append(s);
  }
  return a;
}

/** Заменить упоминания разделов в текстовом узле ссылками. */
function linkNode(node) {
  const text = node.nodeValue;
  RE.lastIndex = 0;
  if (!RE.test(text)) return;
  const parent = node.parentElement;
  const target = targetOf(parent);
  if (!target.module) return;
  const suf = !target.named && target.module !== moduleOf(parent) ? suffix(target.module) : '';
  const frag = document.createDocumentFragment();
  let last = 0;
  RE.lastIndex = 0;
  for (const m of text.matchAll(RE)) {
    const [whole, word, space, first, rest] = m;
    const nums = [first, ...[...rest.matchAll(/\d+/g)].map((x) => x[0])];
    // ссылка, только если такие разделы есть и сейчас видны (скрытый раздел появится — текст разметится при пересчёте)
    const secs = sectionsOf(target.module);
    if (!nums.every((n) => secs[n] && !secs[n].hidden)) continue;
    frag.append(text.slice(last, m.index));
    const lastNo = nums.length - 1;
    frag.append(link(`${word}${space}${first}`, target, first, lastNo === 0 ? suf : ''));
    let i = 0;
    for (const piece of rest.split(/(\d+)/)) {
      if (/^\d+$/.test(piece)) {
        i += 1;
        frag.append(link(piece, target, piece, i === lastNo ? suf : ''));
      } else if (piece) frag.append(piece);
    }
    last = m.index + whole.length;
  }
  if (!last) return;
  frag.append(text.slice(last));
  node.replaceWith(frag);
}

/** Ссылки на разделы во всём тексте root (повторный вызов ничего не дублирует). */
export function linkSections(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
      return /\d/.test(n.nodeValue) && /[Рр]аздел|[Ss]ection/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  passMaps = new Map();
  try {
    nodes.forEach(linkNode);
  } finally {
    passMaps = null;
  }
}

/** Прокрутить к разделу и коротко подсветить его. */
export function revealSection(module, no) {
  const sec = findSection(module, no);
  if (!sec || sec.hidden) return false;
  const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  sec.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  sec.classList.remove('sec-flash');
  void sec.offsetWidth;
  sec.classList.add('sec-flash');
  setTimeout(() => sec.classList.remove('sec-flash'), 1800);
  return true;
}

/**
 * Подключить ссылки: после каждого пересчёта модуля и смены языка. go(module) — открыть модуль (app.js).
 * Ссылки журнала (data-sec-beam) открывает сам «Сеанс» (пучок нужно загрузить во вкладку) и помечает событие обработанным.
 */
export function initSecLinks({ go }) {
  document.addEventListener('moduleupdate', (e) => linkSections(e.detail?.root?.closest?.('.module') ?? e.detail?.root));
  document.addEventListener('langchange', () => requestAnimationFrame(() => document.querySelectorAll('.module').forEach(linkSections)));
  document.querySelectorAll('.module').forEach(linkSections);
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a.sec-link');
    if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    const { secModule, secNo } = a.dataset;
    if (moduleOf(a) !== secModule) go(secModule);
    requestAnimationFrame(() => revealSection(secModule, secNo));
  });
}
