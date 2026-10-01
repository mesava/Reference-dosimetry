// Язык текстов расчётного ядра и интерфейса: 'ru' (по умолчанию) или 'en'.
// Тексты пишутся парами прямо в месте использования: L('по-русски', 'in English').
// Язык — общее состояние страницы: интерфейс задаёт его через setLang() перед расчётом.

let lang = 'ru';

export function setLang(value) {
  lang = value === 'en' ? 'en' : 'ru';
}

export function getLang() {
  return lang;
}

/** Текст на текущем языке. Если английского варианта нет, остаётся русский. */
export function L(ru, en) {
  return lang === 'en' && en !== undefined && en !== null ? en : ru;
}

// Ссылки на источники («TRS-398 Rev.1, табл. 12; аддендум TG-51 (2014), разд. 5.A.5») по-английски.
const REF_RULES = [
  [/аддендум TG-51/g, 'TG-51 addendum'],
  [/аддендум для фотонов/g, 'photon addendum'],
  [/рабочая запись/g, 'worksheet'],
  [/рабочий лист/g, 'Worksheet'],
  [/разд\./g, 'Sec.'],
  [/табл\./g, 'Table'],
  [/ур\./g, 'Eq.'],
  [/прил\./g, 'App.'],
  [/прим\./g, 'note'],
  [/сноска/g, 'footnote'],
  [/сноски/g, 'footnotes'],
  [/рис\./g, 'Fig.'],
  [/п\. /g, 'item '],
  [/ и /g, ' and '],
];

/** Ссылка на источник на текущем языке. */
export function refText(ref) {
  if (!ref || lang !== 'en') return ref;
  return REF_RULES.reduce((s, [re, to]) => s.replace(re, to), String(ref));
}
