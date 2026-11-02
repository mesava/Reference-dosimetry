// Расчёт не зависящих от камеры величин для kV-рентгена по данным P. Andreo
// (Phys. Med. Biol. 64 (2019) 205019) и TRS-398 Rev.1: B_w, [μen/ρ]w,air и их отношения для k_g. Без зависимостей,
// кроме i18n.js; работает в браузере и в Node.js.
//
// Перенесён из репозитория github.com/mesava/kV-x-rays-data (src/kvx.js, лицензия MIT, тот же автор);
// здесь — под AGPL-3.0-or-later, как весь код калькулятора. Изменения при переносе: заголовок, текст исключения через L(),
// комментарий о предупреждениях.
//
// Данные — файлы веб-приложения МАГАТЭ kvx-rays.iaea.org, переданные автором (data/andreo-kv/andreo_webapp.js);
// условия их использования — в data/andreo-kv/README.md.
// Интерполяция та же, что на сайте МАГАТЭ (установлено сверкой: все 117 контрольных точек совпадают до 4-го знака,
// tests/kv-data.test.js):
//   B_w и [μen/ρ]z=2 — квадратичный интерполяционный сплайн по каждой оси (kV, РИП, поле, СПО),
//                      как scipy.interpolate.interp1d(kind="quadratic"), тензорное произведение по 4 осям;
//   [μen/ρ]FIA       — линейная интерполяция ln(μen) по ln(СПО).

import { L } from './i18n.js';

// ---------- квадратичный интерполяционный сплайн (как scipy make_interp_spline, k = 2) ----------

const K = 2;

// Узлы сплайна, как в scipy для k = 2: кратные концы и середины между точками,
// без второй и предпоследней середины (аналог условия not-a-knot).
function quadKnots(xs) {
  const n = xs.length, mid = [];
  for (let i = 1; i < n - 2; i++) mid.push((xs[i] + xs[i + 1]) / 2);
  return [xs[0], xs[0], xs[0], ...mid, xs[n - 1], xs[n - 1], xs[n - 1]];
}

// Значения всех n B-сплайнов степени 2 в точке x (алгоритм Кокса — де Бура).
function basis(t, n, x) {
  let span = K;
  while (span < n - 1 && x >= t[span + 1]) span++;
  const N = [1], left = [0], right = [0];
  for (let j = 1; j <= K; j++) {
    left[j] = x - t[span + 1 - j];
    right[j] = t[span + j] - x;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const tmp = N[r] / (right[r + 1] + left[j - r]);
      N[r] = saved + right[r + 1] * tmp;
      saved = left[j - r] * tmp;
    }
    N[j] = saved;
  }
  const out = new Array(n).fill(0);
  for (let i = 0; i <= K; i++) out[span - K + i] = N[i];
  return out;
}

function invert(A) {
  const n = A.length, M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c || M[r][c] === 0) continue;
      const f = M[r][c];
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row) => row.slice(n));
}

// Ось интерполяции: веса w(x), для которых s(x) = Σ w_i · y_i при любых значениях y в узлах.
export function quadAxis(xs) {
  const n = xs.length;
  if (n < 3) throw new Error(L('для квадратичного сплайна нужно не меньше 3 узлов', 'a quadratic spline needs at least 3 nodes'));
  const t = quadKnots(xs);
  const Ainv = invert(xs.map((x) => basis(t, n, x)));
  return (x) => {
    const b = basis(t, n, x);
    const w = new Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      if (b[j] === 0) continue;
      for (let i = 0; i < n; i++) w[i] += b[j] * Ainv[j][i];
    }
    return w;
  };
}

// Одномерная интерполяция значений ys квадратичным сплайном (для проверок и тестов).
export function quadInterp(xs, ys, x) {
  return quadAxis(xs)(x).reduce((s, w, i) => s + w * ys[i], 0);
}

function loglog(xs, ys, x) {
  // линейная интерполяция в логарифмах обеих осей
  let k = 0;
  while (k < xs.length - 2 && x > xs[k + 1]) k++;
  const lx0 = Math.log(xs[k]), lx1 = Math.log(xs[k + 1]);
  const ly0 = Math.log(ys[k]), ly1 = Math.log(ys[k + 1]);
  return Math.exp(ly0 + (ly1 - ly0) * (Math.log(x) - lx0) / (lx1 - lx0));
}

// ---------- калькулятор ----------

export function createCalculator(data, nist) {
  const round4 = (v) => Math.round(v * 1e4) / 1e4;

  // Подготовка сеток: веса по каждой оси считаются через заранее обращённые матрицы.
  const grids = {};
  for (const key of ["bw_al", "bw_cu", "muen_z2"]) {
    const g = data[key];
    grids[key] = { g, ax: { kv: quadAxis(g.kv), ssd: quadAxis(g.ssd_cm), diam: quadAxis(g.diam_cm), hvl: quadAxis(g.hvl) } };
  }

  // Значение на сетке: values хранятся плоским массивом в порядке [ssd][diam][hvl][kv].
  function grid4(key, kv, hvl, ssd, f) {
    const { g, ax } = grids[key];
    const wk = ax.kv(kv), ws = ax.ssd(ssd), wd = ax.diam(f), wh = ax.hvl(hvl);
    const nk = g.kv.length, nh = g.hvl.length, nd = g.diam_cm.length, V = g.values;
    let sum = 0;
    for (let s = 0; s < ws.length; s++) {
      for (let d = 0; d < nd; d++) {
        const wsd = ws[s] * wd[d];
        if (wsd === 0) continue;
        for (let h = 0; h < nh; h++) {
          const w3 = wsd * wh[h];
          if (w3 === 0) continue;
          const base = ((s * nd + d) * nh + h) * nk;
          let acc = 0;
          for (let k = 0; k < nk; k++) acc += wk[k] * V[base + k];
          sum += w3 * acc;
        }
      }
    }
    return sum;
  }

  function hvlMax(kv, material) {
    const t = nist[material];
    const E = kv / 1000; // МэВ
    const mu = loglog(t.map((r) => r[0]), t.map((r) => r[1]), E) * nist.meta.density_g_cm3[material];
    return (Math.LN2 / mu) * 10; // мм
  }

  // Предупреждения возвращаются как { code, level, params }; текст на нужном языке
  // формирует вызывающий модуль по коду.
  function checks(key, kv, hvl, ssd, f, material) {
    const g = grids[key].g, w = [];
    const kmin = g.kv[0], kmax = g.kv[g.kv.length - 1];
    const hmin = g.hvl[0], hmax = g.hvl[g.hvl.length - 1];
    if (kv < kmin || kv > kmax)
      w.push({ code: "kv_extrap", level: "info", params: { kv, min: kmin, max: kmax } });
    if (hvl < hmin || hvl > hmax)
      w.push({ code: "hvl_extrap", level: "info", params: { hvl, material, min: hmin, max: hmax } });
    if (ssd < g.ssd_cm[0] || ssd > g.ssd_cm[g.ssd_cm.length - 1] || f < g.diam_cm[0] || f > g.diam_cm[g.diam_cm.length - 1])
      w.push({ code: "geom_extrap", level: "warn", params: {} });
    w.push(...hvlCheck(kv, hvl, material));
    return w;
  }

  // Проверка физической реализуемости сочетания kV и СПО
  function hvlCheck(kv, hvl, material) {
    const hm = hvlMax(kv, material);
    return hvl > hm ? [{ code: "hvl_unphysical", level: "error", params: { hvl, kv, material, limit: hm } }] : [];
  }

  function muenFIA(hvl, material = "Al") {
    const t = data.muen_fia[material];
    const value = loglog(t.hvl, t.value, hvl);
    const w = [];
    if (hvl < t.hvl[0] || hvl > t.hvl[t.hvl.length - 1])
      w.push({ code: "hvl_extrap_c1", level: "info", params: { hvl, material, min: t.hvl[0], max: t.hvl[t.hvl.length - 1] } });
    return { value: round4(value), raw: value, warnings: w };
  }

  const make = (key, material) => (kv, hvl, ssd, f) => {
    const v = grid4(key, kv, hvl, ssd, f);
    return { value: round4(v), raw: v, warnings: checks(key, kv, hvl, ssd, f, material) };
  };
  const bw = make("bw_al", "Al");       // B_w, СПО в мм Al
  const bwCu = make("bw_cu", "Cu");     // B_w, СПО в мм Cu
  const muenZ2 = make("muen_z2", "Cu"); // [μen/ρ] на глубине 2 см, СПО в мм Cu

  // Составляющие поправочного коэффициента на геометрию (TRS-398 Rev.1, прил. I, ур. 85 и 90):
  // отношение не зависящей от камеры величины в клинических условиях к величине в опорных.
  const ratio = (fn) => (kv, hvl, ref, clin) => {
    const r = fn(kv, hvl, ref.ssd, ref.f), c = fn(kv, hvl, clin.ssd, clin.f);
    return { ref: r.value, clin: c.value, value: round4(c.raw / r.raw), warnings: dedupe([...r.warnings, ...c.warnings]) };
  };
  function dedupe(ws) {
    const seen = new Set();
    return ws.filter((w) => {
      const key = w.code + JSON.stringify(w.params);
      return seen.has(key) ? false : seen.add(key);
    });
  }

  return { bw, bwCu, muenFIA, muenZ2, kgBw: ratio(bw), kgMuenZ2: ratio(muenZ2), hvlMax, hvlCheck };
}
