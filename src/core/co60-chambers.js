// Камеры для раздела ⁶⁰Co.
// TRS-398 Rev.1, разд. 5.2.1: в пучке ⁶⁰Co допускаются цилиндрические и плоскопараллельные камеры
// (плоскопараллельные — если откалиброваны в пучке того же качества, сноска 29). k_Q = 1, поэтому
// из базы нужны только сведения о камере: тип, размеры полости, водонепроницаемость, окно.
// Цилиндрические камеры берутся из базы МВ фотонов (chambers.js: Report 374, табл. 1; TRS-398, табл. 4),
// плоскопараллельные — из базы электронов (electron-chambers.js: TRS-398, табл. 5).

import { CHAMBERS, chamberLabel, chamberNote } from './chambers.js';
import { E_CHAMBERS, eChamberLabel } from './electron-chambers.js';

export const PP_PREFIX = 'PP:';

/** Группы для списка выбора: [{ label, items: [{ id, label }] }]. */
export function coChamberGroups() {
  const groups = new Map();
  for (const c of CHAMBERS) {
    const g = `${c.maker} — цилиндрические`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ id: c.id, label: `${chamberLabel(c)}${c.note ? ' — ' + chamberNote(c) : ''}` });
  }
  const pp = E_CHAMBERS.filter((c) => c.type === 'pp').map((c) => ({ id: PP_PREFIX + c.id, label: eChamberLabel(c) }));
  return [...[...groups].map(([label, items]) => ({ label, items })), { label: 'Плоскопараллельные', items: pp }];
}

/**
 * Камера по полям формы. Своя камера ('CUSTOM' или сохранённая 'MY:…') описывается полями co_cc_*.
 * @returns {null | {id, custom, type, label, rCavMm, lengthMm, sleeve, windowMgCm2, windowMm, notReferenceClass}}
 */
export function resolveCoChamber(f) {
  const id = String(f.co_ch_model ?? '');
  if (!id) return null;
  if (id === 'CUSTOM' || id.startsWith('MY:')) {
    const label = [f.co_cc_maker, f.co_cc_model].map((s) => String(s ?? '').trim()).filter(Boolean).join(' ');
    return { id, custom: true, type: f.co_cc_type === 'pp' ? 'pp' : 'cyl', label: label || 'своя камера' };
  }
  if (id.startsWith(PP_PREFIX)) {
    const c = E_CHAMBERS.find((x) => x.id === id.slice(PP_PREFIX.length));
    if (!c) return null;
    return { id, custom: false, type: 'pp', label: eChamberLabel(c), windowMgCm2: c.windowMgCm2, windowMm: c.windowMm };
  }
  const c = CHAMBERS.find((x) => x.id === id);
  if (!c) return null;
  return {
    id, custom: false, type: 'cyl', label: chamberLabel(c), note: chamberNote(c), rCavMm: c.rCavMm, lengthMm: c.lengthMm, sleeve: !!c.sleeve,
    notReferenceClass: (c.notes || []).some((n) => /не отвечает спецификации эталонного класса/.test(n.text)),
  };
}

/** Подбор записи базы по старому текстовому названию модели (черновики до появления списка). */
export function matchCoChamberByName(name) {
  const q = String(name ?? '').toLowerCase().replace(/[\s,.-]+/g, '');
  if (!q) return null;
  for (const c of CHAMBERS) {
    const variants = [chamberLabel(c), `${c.maker}${c.model}`, c.model].map((s) => s.toLowerCase().replace(/[\s,.-]+/g, ''));
    if (variants.includes(q)) return c.id;
  }
  for (const c of E_CHAMBERS.filter((x) => x.type === 'pp')) {
    const variants = [eChamberLabel(c), c.model].map((s) => s.toLowerCase().replace(/[\s,.-]+/g, ''));
    if (variants.includes(q)) return PP_PREFIX + c.id;
  }
  return null;
}
