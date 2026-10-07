// Небольшой точечный график в SVG (график Яффе и зависимость от дозы за импульс): точки, прямые, вертикальные метки,
// сетка и подписи осей. Размер — по ширине контейнера (текст не масштабируется вместе с картинкой); цвета — классы
// .s1 / .s2 с токенами --series-1 / --series-2 в styles.css. У каждой точки есть всплывающая подсказка (<title>),
// а значения дублируются таблицей рядом с графиком.
import { esc } from './common.js';

/** «Круглые» деления оси: шаг 1, 2, 2,5 или 5 × 10ⁿ. */
export function niceTicks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw * 0.999) ?? 10 * p;
  const out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

/** Число знаков после запятой для подписей делений с шагом step. */
export function tickDigits(ticks) {
  if (ticks.length < 2) return 2;
  const step = Math.abs(ticks[1] - ticks[0]);
  let d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-6) d += 1;
  return Math.min(6, d);
}

/** Текст для SVG: «M_нас» → M с нижним индексом «нас» (индекс — буквы и цифры после «_»). */
const svgText = (s) => esc(s).replace(/_([0-9A-Za-zА-Яа-яЁё]+)/g, '<tspan class="sub" dy="0.3em">$1</tspan><tspan dy="-0.3em">\u200b</tspan>');

const marker = (shape, x, y, r, cls, hollow) => {
  const c = `mk ${cls}${hollow ? ' hollow' : ''}`;
  if (shape === 'square') return `<rect class="${c}" x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${(2 * r).toFixed(1)}" height="${(2 * r).toFixed(1)}" rx="1"/>`;
  return `<circle class="${c}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"/>`;
};

/** Значок для легенды (HTML рядом с графиком). */
export function legendSwatch({ shape = 'circle', cls = 's1', hollow = false, line = false, dashed = false }) {
  const body = line
    ? `<line class="ln ${cls}${dashed ? ' dashed' : ''}" x1="1" y1="7" x2="21" y2="7"/>`
    : marker(shape, 11, 7, 4.5, cls, hollow);
  return `<svg class="chart-swatch" width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">${body}</svg>`;
}

/**
 * @param {HTMLElement} box — контейнер; SVG занимает его ширину
 * @param {object} spec
 * @param {string} spec.label — описание графика для читалок экрана
 * @param {string} spec.xLabel, spec.yLabel — подписи осей (простой текст)
 * @param {(v:number, digits:number)=>string} spec.fmt — число с заданным числом знаков (для подписей делений)
 * @param {number[]} [spec.xInclude], [spec.yInclude] — значения, которые должны попасть в диапазон осей
 * @param {Array} spec.series — [{ cls, shape, points: [{ x, y, hollow, title }] }]
 * @param {Array} [spec.lines] — [{ cls, a, b, x0, x1, dashed }] — прямая y = a + b·x на отрезке [x0, x1]
 * @param {Array} [spec.vlines] — [{ x, label }] — вертикальные метки (рабочее напряжение и т. п.)
 * @param {Array} [spec.notes] — [{ x, y, text, below, anchor }] — подписи у точек в координатах данных
 * @param {number} [spec.aspect], [spec.minHeight], [spec.maxHeight] — высота: доля ширины в заданных пределах, px
 * Подписи осей, меток и заметок могут содержать нижние индексы через «_» (M_нас, k_s).
 */
export function scatterChart(box, spec) {
  if (!box) return;
  const W = Math.max(260, Math.round(box.clientWidth || 640));
  const H = Math.round(Math.min(spec.maxHeight ?? 360, Math.max(spec.minHeight ?? 230, W * (spec.aspect ?? 0.56))));
  // сверху — подпись оси y и, ниже неё, подписи вертикальных меток
  const m = { l: 56, r: 16, t: spec.vlines?.length ? 38 : 28, b: 44 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;

  const xs = [...(spec.xInclude || []), ...spec.series.flatMap((s) => s.points.map((p) => p.x))].filter(Number.isFinite);
  const ys = [...(spec.yInclude || []), ...spec.series.flatMap((s) => s.points.map((p) => p.y))].filter(Number.isFinite);
  if (!xs.length || !ys.length) {
    box.innerHTML = '';
    return;
  }
  let [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  if (x1 === x0) x1 = x0 + 1;
  if (y1 === y0) y1 = y0 + Math.abs(y0 || 1) * 0.01;
  const xpad = (x1 - x0) * 0.04;
  const ypad = (y1 - y0) * 0.08;
  x1 += xpad;
  if (x0 !== 0) x0 -= xpad;
  y0 -= ypad;
  y1 += ypad;
  const xt = niceTicks(x0, x1, Math.max(3, Math.min(7, Math.round(pw / 90))));
  const yt = niceTicks(y0, y1, Math.max(3, Math.min(6, Math.round(ph / 50))));
  const xd = tickDigits(xt);
  const yd = tickDigits(yt);
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * pw;
  const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * ph;
  const inX = (v) => v >= x0 - 1e-12 && v <= x1 + 1e-12;

  const parts = [];
  // сетка и деления
  for (const v of yt) if (v >= y0 && v <= y1) parts.push(`<line class="grid" x1="${m.l}" x2="${m.l + pw}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="tick" x="${m.l - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${esc(spec.fmt(v, yd))}</text>`);
  for (const v of xt) if (inX(v)) parts.push(`<line class="grid" y1="${m.t}" y2="${m.t + ph}" x1="${X(v).toFixed(1)}" x2="${X(v).toFixed(1)}"/><text class="tick" x="${X(v).toFixed(1)}" y="${m.t + ph + 16}" text-anchor="middle">${esc(spec.fmt(v, xd))}</text>`);
  parts.push(`<line class="axis" x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}"/><line class="axis" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ph}"/>`);
  parts.push(`<text class="axis-label" x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle">${svgText(spec.xLabel)}</text>`);
  parts.push(`<text class="axis-label" x="${m.l - 50}" y="13">${svgText(spec.yLabel)}</text>`);

  // вертикальные метки
  for (const v of spec.vlines || []) {
    if (!Number.isFinite(v.x) || !inX(v.x)) continue;
    const x = X(v.x).toFixed(1);
    // подпись у правого или левого края не выходит за рамку графика
    const anchor = X(v.x) > m.l + pw - 44 ? 'end' : X(v.x) < m.l + 44 ? 'start' : 'middle';
    parts.push(`<line class="vmark" x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + ph}"/><text class="vmark-label" x="${x}" y="${m.t - 5}" text-anchor="${anchor}">${svgText(v.label)}</text>`);
  }
  // прямые (обрезаны по области графика)
  parts.push(`<clipPath id="${box.id || 'chart'}-clip"><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/></clipPath>`);
  for (const l of spec.lines || []) {
    if (![l.a, l.b, l.x0, l.x1].every(Number.isFinite)) continue;
    const a = Math.max(x0, l.x0);
    const b = Math.min(x1, l.x1);
    if (!(b > a)) continue;
    parts.push(`<line class="ln ${l.cls}${l.dashed ? ' dashed' : ''}" clip-path="url(#${box.id || 'chart'}-clip)" x1="${X(a).toFixed(1)}" y1="${Y(l.a + l.b * a).toFixed(1)}" x2="${X(b).toFixed(1)}" y2="${Y(l.a + l.b * b).toFixed(1)}"/>`);
  }
  // точки: сначала значок, поверх — невидимая область побольше с подсказкой
  for (const s of spec.series) {
    for (const p of s.points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const x = X(p.x);
      const y = Y(p.y);
      parts.push(`<g class="pt">${marker(s.shape || 'circle', x, y, 4.5, s.cls, p.hollow)}<circle class="hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11"><title>${esc(p.title || '')}</title></circle></g>`);
    }
  }
  for (const n of spec.notes || []) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
    const anchor = n.anchor || 'start';
    const dx = anchor === 'start' ? 6 : 0;
    parts.push(`<text class="note" x="${(X(n.x) + dx).toFixed(1)}" y="${(Y(n.y) + (n.below ? 16 : -8)).toFixed(1)}" text-anchor="${anchor}">${svgText(n.text)}</text>`);
  }
  box.innerHTML = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.label)}">${parts.join('')}</svg>`;
}
