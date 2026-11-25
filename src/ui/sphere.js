// «Начало»: вращающаяся сфера из названий документов (с 0.65.0). Без библиотек: метки — обычные ссылки,
// положение задаётся CSS-трансформацией. Метки лежат на сфере по спирали Фибоначчи; сферу можно повернуть
// мышью или пальцем. При prefers-reduced-motion сфера стоит и поворачивается только рукой; вне экрана
// (вкладка скрыта, страница прокручена) анимация не идёт. Сфера декоративная (aria-hidden): для клавиатуры
// и чтения с экрана рядом есть обычная ссылка на «Литературу».

/** Документы (названия — как на странице «Литература», без перевода) и обозначения величин. */
const DOCS = ['TG-51', 'TG-51 Addendum', 'Report 374', 'Report 385', 'TRS-398 (2000)', 'TG-61', 'DIN 6809-4', 'SSRMP № 9', 'Andreo 2019', 'Lloyd 2018', 'BIPM-5', 'TG-142', 'TRS-492', 'TG-43U1', 'DGMP 13', 'HEBD'];
const MAIN = 'TRS-398 Rev.1';
const SYMS = ['k<sub>Q</sub>', 'N<sub>D,w</sub>', 'k<sub>TP</sub>', 'k<sub>pol</sub>', 'k<sub>s</sub>', 'D<sub>w</sub>', 'R<sub>50</sub>', 'TPR<sub>20,10</sub>', 'HVL', 'z<sub>ref</sub>', 'k<sub>elec</sub>', 'P<sub>ion</sub>', 'S<sub>K</sub>', 'Λ', 'g<sub>L</sub>(r)', 'k<sub>sm</sub>'];

/** Поворот сохраняется между перерисовками «Начала» (смена языка, журнала). */
const turn = { ay: null, ax: -0.32 };

/** Метки вперемешку (документ, обозначение, …), главный документ — на экваторе. */
function labels() {
  const docs = DOCS.map((t) => ({ html: t, k: 'doc' }));
  const syms = SYMS.map((s) => ({ html: s, k: 'sym' }));
  const items = [];
  while (docs.length || syms.length) {
    if (docs.length) items.push(docs.shift());
    if (syms.length) items.push(syms.shift());
  }
  const mid = Math.floor(items.length / 2);
  items.splice(mid, 0, { html: MAIN, k: 'main' });
  return { items, mid };
}

/** Сфера в элементе host; останавливается сама, когда host убран со страницы. */
export function mountSphere(host) {
  const { items, mid } = labels();
  const n = items.length;
  const wrap = document.createElement('div');
  wrap.className = 'sphere';
  wrap.setAttribute('aria-hidden', 'true');
  const els = items.map((it, i) => {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    const a = document.createElement('a');
    a.href = '#refs';
    a.tabIndex = -1;
    a.className = `sphere-tag ${it.k}`;
    a.innerHTML = it.html;
    wrap.append(a);
    return { a, x: Math.cos(phi) * r, y, z: Math.sin(phi) * r, phi };
  });
  host.append(wrap);
  // впервые — главный документ чуть левее середины, дальше он выходит вперёд
  if (turn.ay === null) turn.ay = els[mid].phi - Math.PI / 2 - 0.45;

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const still = () => Boolean(reduce?.matches);
  const BASE = 0.0035;
  let vy = still() ? 0 : BASE;
  let vx = 0;
  let base = BASE;
  let drag = null;
  let raf = 0;
  let visible = true;
  let R = 140;
  const size = () => {
    R = (wrap.clientWidth / 2) * 0.86;
  };
  size();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(size) : null;
  ro?.observe(wrap);
  const io =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(([en]) => {
          visible = en.isIntersecting;
          kick();
        })
      : null;
  io?.observe(wrap);

  function frame() {
    const cy = Math.cos(turn.ay);
    const sy = Math.sin(turn.ay);
    const cx = Math.cos(turn.ax);
    const sx = Math.sin(turn.ax);
    for (const e of els) {
      const x1 = e.x * cy + e.z * sy;
      const z1 = -e.x * sy + e.z * cy;
      const y2 = e.y * cx - z1 * sx;
      const z2 = e.y * sx + z1 * cx;
      const depth = (z2 + 1) / 2;
      const s = 0.55 + 0.45 * depth;
      e.a.style.transform = `translate(-50%, -50%) translate(${(x1 * R).toFixed(1)}px, ${(y2 * R).toFixed(1)}px) scale(${s.toFixed(3)})`;
      e.a.style.opacity = (0.12 + 0.88 * depth ** 1.4).toFixed(3);
      e.a.style.zIndex = String(Math.round(depth * 100));
    }
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    ro?.disconnect();
    io?.disconnect();
    reduce?.removeEventListener?.('change', onReduce);
  }
  function onReduce() {
    kick();
  }
  function tick() {
    raf = 0;
    if (!wrap.isConnected) return stop();
    if (!drag) {
      if (still()) vy *= 0.92;
      else vy += (base - vy) * 0.02;
      vx *= 0.94;
      turn.ay += vy;
      turn.ax = Math.max(-1.1, Math.min(1.1, turn.ax + vx));
    }
    frame();
    const moving = !still() || Math.abs(vy) > 0.0002 || Math.abs(vx) > 0.0002 || drag;
    if (visible && moving) raf = requestAnimationFrame(tick);
  }
  function kick() {
    if (!raf && visible && wrap.isConnected) raf = requestAnimationFrame(tick);
  }

  wrap.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
    wrap.setPointerCapture?.(e.pointerId);
    wrap.classList.add('grab');
    kick();
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    vy = dx * 0.006;
    vx = -dy * 0.006;
    turn.ay += vy;
    turn.ax = Math.max(-1.1, Math.min(1.1, turn.ax + vx));
  });
  const end = () => {
    wrap.classList.remove('grab');
    // щелчок после перетаскивания — не переход по ссылке
    setTimeout(() => {
      drag = null;
      kick();
    });
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  wrap.addEventListener('click', (e) => {
    if (drag && drag.moved > 6) e.preventDefault();
  });
  wrap.addEventListener('pointerenter', () => {
    base = BASE / 3;
  });
  wrap.addEventListener('pointerleave', () => {
    base = BASE;
  });
  reduce?.addEventListener?.('change', onReduce);
  frame();
  kick();
}
