// Поправка на усреднение по объёму по измеренному боковому профилю.
// TRS-398 Rev.1, ур. (21): k_vol = L / ∫[−L/2, L/2] OAR(0, y) dy.
// WGTG51 Report 374, ур. (8) (P_rp) — то же выражение для одномерной камеры.

import { parseNumber } from './units.js';

/**
 * Разбор профиля: по строке на точку, «положение (мм)  значение».
 * Разделитель — пробел, табуляция или точка с запятой; десятичная запятая допускается.
 */
export function parseProfile(text) {
  const points = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('#')) continue;
    const parts = line.split(/[\s;\t]+/).filter(Boolean);
    if (parts.length < 2) return { points: [], error: `строка ${i + 1}: нужно два числа` };
    const x = parseNumber(parts[0]);
    const y = parseNumber(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (points.length === 0 && i === 0) continue; // строка заголовка
      return { points: [], error: `строка ${i + 1}: не удалось прочитать числа` };
    }
    points.push({ x, y });
  }
  points.sort((p, q) => p.x - q.x);
  for (let i = 1; i < points.length; i++) {
    if (points[i].x === points[i - 1].x) return { points: [], error: `повторяется положение ${points[i].x} мм` };
  }
  return { points, error: null };
}

function valueAt(points, x) {
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    if (x >= p.x && x <= q.x) return p.y + ((x - p.x) / (q.x - p.x)) * (q.y - p.y);
  }
  return NaN;
}

/**
 * k_vol (P_rp) для одномерной камеры длиной lengthMm, центр в x = 0.
 * Профиль нормируется на значение в x = 0; интеграл — методом трапеций
 * по измеренным точкам с линейной интерполяцией на краях.
 */
export function kvolFromProfile(points, lengthMm) {
  if (!(lengthMm > 0)) return { error: 'не задана длина полости камеры' };
  if (points.length < 3) return { error: 'в профиле меньше трёх точек' };
  const half = lengthMm / 2;
  if (points[0].x > -half || points[points.length - 1].x < half) {
    return { error: `профиль должен покрывать от −${half} до +${half} мм` };
  }
  const center = valueAt(points, 0);
  if (!(center > 0)) return { error: 'значение профиля на оси должно быть положительным' };
  const xs = [-half, ...points.map((p) => p.x).filter((x) => x > -half && x < half), half];
  let integral = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const y1 = valueAt(points, xs[i]) / center;
    const y2 = valueAt(points, xs[i + 1]) / center;
    integral += ((y1 + y2) / 2) * (xs[i + 1] - xs[i]);
  }
  const mean = integral / lengthMm;
  return { value: 1 / mean, mean, pointsUsed: xs.length };
}
