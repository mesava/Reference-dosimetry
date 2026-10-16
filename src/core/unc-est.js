// «Как получено» своё значение бюджета неопределённости: источник (документ) и способ, которым из него получена
// относительная стандартная неопределённость u (%, k = 1) — TRS-398 Rev.1, прил. IV, ур. 110–112.
//
// Данные одной оценки (строки JSON в скрытом поле формы): { src, doc, m, v, k, d, dist, s, unit, st, text }
//   src  — источник: свидетельство камеры, электрометра, термометра, барометра, протокол QA, измерения, литература, оценка;
//   doc  — № документа или ссылка;
//   m    — способ: 'u' — u напрямую; 'Uk' — U/k из свидетельства; 'rect' — предел ±a, равномерное: a/√3;
//          'tri' — предел ±a, треугольное: a/√6; 'sens' — погрешность × чувствительность: u(x)·|∂D/∂x|;
//   v    — значение (u, U или a, %); k — коэффициент охвата для 'Uk';
//   d, dist, s, unit — для 'sens': погрешность d (в unit), её вид ('rect' — предел ±d, u = d/√3; 'u' — стандартная;
//          'U2' — расширенная при k = 2, u = d/2), чувствительность s (% на unit);
//   st, text — статус (fact | temp | cons | acc) и комментарий.

import { parseNumber, isBlank, ru } from './units.js';
import { L } from './i18n.js';

/** Источники значения. */
export const EST_SOURCES = () => ({
  certCh: L('свидетельство камеры', 'chamber certificate'),
  certEl: L('свидетельство электрометра', 'electrometer certificate'),
  certT: L('свидетельство термометра', 'thermometer certificate'),
  certP: L('свидетельство барометра', 'barometer certificate'),
  qa: L('протокол контроля качества аппарата', 'machine QA record'),
  meas: L('собственные измерения', 'own measurements'),
  lit: L('протокол или литература', 'protocol or literature'),
  expert: L('экспертная оценка', 'expert judgement'),
});

/** Способы получить u. */
export const EST_METHODS = () => ({
  u: L('u напрямую', 'u directly'),
  Uk: L('U и k из свидетельства: u = U/k', 'U and k from a certificate: u = U/k'),
  rect: L('предел ±a, равномерное: u = a/√3', 'limit ±a, rectangular: u = a/√3'),
  tri: L('предел ±a, треугольное: u = a/√6', 'limit ±a, triangular: u = a/√6'),
  sens: L('погрешность × чувствительность', 'error × sensitivity'),
});

/** Вид погрешности для способа «погрешность × чувствительность». */
export const EST_DIST = () => ({
  rect: L('предел ±d (u = d/√3)', 'limit ±d (u = d/√3)'),
  U2: L('расширенная, k = 2 (u = d/2)', 'expanded, k = 2 (u = d/2)'),
  u: L('стандартная (u = d)', 'standard (u = d)'),
});

/** Единицы погрешности: код → подпись. */
export const EST_UNITS = () => ({ mm: L('мм', 'mm'), cm: L('см', 'cm'), C: '°C', kPa: L('кПа', 'kPa'), pct: '%' });
export const unitText = (u) => EST_UNITS()[u] ?? String(u ?? '');

/** Оценка задана способом (не просто числом в поле «Своё»). */
export const hasMethod = (e) => !!e && typeof e === 'object' && !isBlank(e.m) && e.m !== 'u';
/** У оценки указан источник. */
export const hasSource = (e) => !!e && typeof e === 'object' && (!isBlank(e.src) || !isBlank(e.doc));

/**
 * u по способу. Возвращает { u, formula } или { error } (не хватает данных или неверное значение), или null, если
 * способ не задан.
 */
export function estimateU(e) {
  const r = estimateRaw(e);
  if (r && !r.error && !Number.isFinite(r.u)) return { error: L('значение слишком велико', 'the value is too large') };
  return r;
}
function estimateRaw(e) {
  if (!hasMethod(e)) return null;
  const n = (x) => (isBlank(x) ? NaN : parseNumber(x));
  const bad = (what) => ({ error: L(`не прочитано: ${what}`, `could not read: ${what}`) });
  const f = (x, d = 3) => ru(x, d);
  switch (e.m) {
    case 'Uk': {
      const U = n(e.v);
      const k = isBlank(e.k) ? 2 : n(e.k);
      if (!(U >= 0)) return bad('U');
      if (!(k > 0)) return bad('k');
      const u = U / k;
      return { u, formula: `${f(U, 3)}/${f(k, 2)} = ${f(u, 3)} %` };
    }
    case 'rect':
    case 'tri': {
      const a = n(e.v);
      if (!(a >= 0)) return bad('a');
      const div = e.m === 'rect' ? 3 : 6;
      const u = a / Math.sqrt(div);
      return { u, formula: `${f(a, 3)}/√${div} = ${f(u, 3)} %` };
    }
    case 'sens': {
      const d = n(e.d);
      const s = n(e.s);
      if (!(d >= 0)) return bad(L('погрешность', 'error'));
      if (!Number.isFinite(s)) return bad(L('чувствительность', 'sensitivity'));
      const dist = e.dist === 'u' || e.dist === 'U2' ? e.dist : 'rect';
      const ux = dist === 'rect' ? d / Math.sqrt(3) : dist === 'U2' ? d / 2 : d;
      const u = ux * Math.abs(s);
      const unit = unitText(e.unit || 'mm');
      const ud = dist === 'rect' ? `${f(d, 3)}/√3` : dist === 'U2' ? `${f(d, 3)}/2` : f(d, 3);
      return { u, formula: `${ud} ${unit} × ${f(Math.abs(s), 3)} %/${unit} = ${f(u, 3)} %` };
    }
    default:
      return { error: L('неизвестный способ', 'unknown method') };
  }
}

/** Строка для протокола: «u = 0,5/√3 = 0,289 % — свидетельство электрометра № 123; консервативно: комментарий». */
export function estimateText(e, u) {
  if (!e || typeof e !== 'object') return '';
  const r = estimateU(e);
  const st = { fact: L('фактические данные', 'actual data'), temp: L('временно', 'provisional'), cons: L('консервативно', 'conservative'), acc: L('принято', 'adopted') }[e.st];
  const src = EST_SOURCES()[e.src];
  const parts = [];
  if (r && !r.error) parts.push(`u = ${r.formula}`);
  else if (Number.isFinite(u)) parts.push(`u = ${ru(u, 3)} %`);
  const srcText = [src, isBlank(e.doc) ? '' : String(e.doc).trim()].filter(Boolean).join(': ');
  if (srcText) parts.push(srcText);
  const tail = [st, isBlank(e.text) ? '' : String(e.text).trim()].filter(Boolean).join(': ');
  if (tail) parts.push(tail);
  return parts.join(' — ');
}
