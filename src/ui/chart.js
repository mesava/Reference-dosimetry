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
 * @param {Array} spec.series — [{ cls, shape, points: [{ x, y, hollow, title }] }]; с line: true — ломаная
 *   через точки (в порядке массива) без значков, dashed — пунктиром
 * @param {Array} [spec.lines] — [{ cls, a, b, x0, x1, dashed }] — прямая y = a + b·x на отрезке [x0, x1]
 * @param {Array} [spec.vlines] — [{ x, label, row }] — вертикальные метки (рабочее напряжение и т. п.);
 *   row = 1 — подпись во втором ряду, чтобы близкие метки не наезжали друг на друга
 * @param {Array} [spec.notes] — [{ x, y, text, below, anchor }] — подписи у точек в координатах данных
 * @param {(x0:number, x1:number, count:number)=>number[]} [spec.xTicks] — свои деления оси x
 * @param {(v:number)=>string} [spec.xFmt] — подпись деления оси x (например, дата)
 * @param {number} [spec.aspect], [spec.minHeight], [spec.maxHeight] — высота: доля ширины в заданных пределах, px
 * @param {(x:number)=>({x:number, head:string, rows:Array<{cls:string, y:number, text:string}>})|null} [spec.crosshair]
 *   — для ломаных: вертикальная линия и подсказка у ближайшей точки по x при наведении
 * Подписи осей, меток и заметок могут содержать нижние индексы через «_» (M_нас, k_s).
 */
export function scatterChart(box, spec) {
  if (!box) return;
  const W = Math.max(260, Math.round(box.clientWidth || 640));
  const H = Math.round(Math.min(spec.maxHeight ?? 360, Math.max(spec.minHeight ?? 230, W * (spec.aspect ?? 0.56))));
  // сверху — подпись оси y и, ниже неё, подписи вертикальных меток
  const rows2 = spec.vlines?.some((v) => v.row);
  const m = { l: 56, r: 16, t: spec.vlines?.length ? (rows2 ? 50 : 38) : 28, b: 44 };
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
  // свои деления оси x (например, начала месяцев на оси дат) — xTicks(x0, x1, count)
  const xCount = Math.max(3, Math.min(7, Math.round(pw / 90)));
  const xt = spec.xTicks ? spec.xTicks(x0, x1, xCount) : niceTicks(x0, x1, xCount);
  const yt = niceTicks(y0, y1, Math.max(3, Math.min(6, Math.round(ph / 50))));
  const xd = tickDigits(xt);
  const yd = tickDigits(yt);
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * pw;
  const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * ph;
  const inX = (v) => v >= x0 - 1e-12 && v <= x1 + 1e-12;

  const parts = [];
  // сетка и деления
  for (const v of yt) if (v >= y0 && v <= y1) parts.push(`<line class="grid" x1="${m.l}" x2="${m.l + pw}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="tick" x="${m.l - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${esc(spec.fmt(v, yd))}</text>`);
  for (const v of xt) if (inX(v)) parts.push(`<line class="grid" y1="${m.t}" y2="${m.t + ph}" x1="${X(v).toFixed(1)}" x2="${X(v).toFixed(1)}"/><text class="tick" x="${X(v).toFixed(1)}" y="${m.t + ph + 16}" text-anchor="middle">${esc(spec.xFmt ? spec.xFmt(v) : spec.fmt(v, xd))}</text>`);
  parts.push(`<line class="axis" x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}"/><line class="axis" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ph}"/>`);
  parts.push(`<text class="axis-label" x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle">${svgText(spec.xLabel)}</text>`);
  parts.push(`<text class="axis-label" x="${m.l - 50}" y="13">${svgText(spec.yLabel)}</text>`);

  // вертикальные метки
  for (const v of spec.vlines || []) {
    if (!Number.isFinite(v.x) || !inX(v.x)) continue;
    const x = X(v.x).toFixed(1);
    // подпись у правого или левого края не выходит за рамку графика
    const anchor = X(v.x) > m.l + pw - 44 ? 'end' : X(v.x) < m.l + 44 ? 'start' : 'middle';
    const ly = m.t - 5 - (v.row ? 12 : 0);
    parts.push(`<line class="vmark" x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + ph}"/><text class="vmark-label" x="${x}" y="${ly}" text-anchor="${anchor}">${svgText(v.label)}</text>`);
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
  // ломаные
  for (const s of spec.series) {
    if (!s.line) continue;
    const d = s.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join('');
    if (d) parts.push(`<path class="ln ${s.cls}${s.dashed ? ' dashed' : ''}" clip-path="url(#${box.id || 'chart'}-clip)" d="${d}"/>`);
  }
  // точки: сначала значок, поверх — невидимая область побольше с подсказкой
  for (const s of spec.series) {
    if (s.line) continue;
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
  if (spec.crosshair) parts.push(`<g class="xh" visibility="hidden"><line class="xh-line" y1="${m.t}" y2="${m.t + ph}"/></g>`);
  box.innerHTML = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.label)}">${parts.join('')}</svg>`;
  if (spec.crosshair) attachCrosshair(box, spec.crosshair, { m, pw, ph, W, X, Y, x0, x1 });
}

/** Наведение на график с ломаными: вертикальная линия, точки на кривых и подсказка с их значениями. */
function attachCrosshair(box, fn, g) {
  const svg = box.querySelector('svg');
  const grp = svg.querySelector('.xh');
  const line = grp.querySelector('.xh-line');
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  box.appendChild(tip);
  const hide = () => {
    grp.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  const move = (e) => {
    const rect = svg.getBoundingClientRect();
    const k = g.W / rect.width;
    const px = (e.clientX - rect.left) * k;
    if (px < g.m.l || px > g.m.l + g.pw) return hide();
    const r = fn(g.x0 + ((px - g.m.l) / g.pw) * (g.x1 - g.x0));
    if (!r) return hide();
    const x = g.X(r.x);
    line.setAttribute('x1', x.toFixed(1));
    line.setAttribute('x2', x.toFixed(1));
    for (const c of grp.querySelectorAll('circle')) c.remove();
    for (const row of r.rows) {
      if (!Number.isFinite(row.y)) continue;
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('class', `mk ${row.cls}`);
      c.setAttribute('cx', x.toFixed(1));
      c.setAttribute('cy', g.Y(row.y).toFixed(1));
      c.setAttribute('r', '4.5');
      grp.appendChild(c);
    }
    grp.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b>${esc(r.head)}</b>${r.rows.map((row) => `<span><i class="sw ${row.cls}"></i>${esc(row.text)}</span>`).join('')}`;
    tip.hidden = false;
    // подсказка — справа от линии, у правого края — слева
    const bx = box.getBoundingClientRect();
    const sx = rect.left - bx.left + x / k;
    const left = sx + 12 + tip.offsetWidth > box.clientWidth ? sx - 12 - tip.offsetWidth : sx + 12;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${rect.top - bx.top + g.m.t / k + 4}px`;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', hide);
}
