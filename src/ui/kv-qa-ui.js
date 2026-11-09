// Вкладка «kV-рентген», листы «Линейность» и «Воспроизводимость» (с 0.44.0): ввод выбранного режима (поля формы —
// ключи KV_DEFAULTS, их читает kv-ui.js), выводы, таблицы по всем режимам и строки протокола. Расчёт — core/kv-qa.js
// (computeKvVisit кладёт его в режим: ln, rp). Данные вкладки (visit) живут в kv-ui.js: сюда приходят функции доступа.
import { L } from '../core/i18n.js';
import { KV_LN_N, KV_LN_Q, KV_LN_SERIES } from '../core/kv-qa.js';
import { KV_SET_UNITS } from '../core/kv.js';
import { parseCells } from '../core/units.js';
import { linearFit } from '../core/jaffe.js';
import { $, $$, esc, fmt, fmtSigned, richText } from './common.js';
import { scatterChart, legendSwatch } from './chart.js';

let api = null;

const str = (v) => (v === undefined || v === null ? '' : String(v));
const SUB = '₀₁₂₃₄₅₆₇₈₉';
/** Число с n значащими цифрами (показания бывают в нКл, пА, Гр). */
const sig = (v, n = 5) => {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const d = a > 0 ? Math.max(0, Math.min(8, n - 1 - Math.floor(Math.log10(a)))) : 0;
  return fmt(v, d);
};
const pct = (x, d = 2) => (Number.isFinite(x) ? `${fmt(x * 100, d)} %` : '—');
const pctSigned = (x, d = 2) => (Number.isFinite(x) ? `${fmtSigned(x * 100, d)} %` : '—');
const unitOf = (f) => {
  const U = KV_SET_UNITS[f?.kv_set_unit] ?? KV_SET_UNITS.min;
  return L(U.label, U.labelEn);
};
const setOut = (sel, htmlText) => {
  const el = $(sel);
  if (el && el.innerHTML !== htmlText) el.innerHTML = htmlText;
};
const lvlOf = (x) => (x.state === 'empty' ? 'empty' : x.messages.some((m) => m.level === 'error') ? 'error' : x.messages.some((m) => m.level === 'warn') ? 'warn' : x.ok ? 'ok' : 'empty');
const STATE_TIP = () => ({
  error: L('Есть ошибки: см. замечания режима', 'There are errors: see the messages of the mode'),
  warn: L('Есть предупреждения', 'There are warnings'),
  ok: L('Замечаний нет', 'No issues'),
  empty: L('Не измерялась', 'Not measured'),
});
const pick = (m, on) =>
  `<td class="no"><button type="button" class="kv-qa-pick" aria-pressed="${on}" aria-label="${esc(L(`Режим ${m + 1}: открыть`, `Mode ${m + 1}: open`))}" title="${esc(L('Открыть режим', 'Open the mode'))}">${m + 1}</button></td>`;
const stateCell = (lvl) => {
  const tip = STATE_TIP()[lvl];
  return `<td class="act"><span class="st ${lvl === 'empty' ? '' : lvl}" role="img" title="${esc(tip)}" aria-label="${esc(tip)}"></span></td>`;
};

// ------------------------------------------------------------ линейность
/** Строки заданий: первые две всегда, следующая — когда заполнена предыдущая (или она сама). */
function renderLnRows(f, ln) {
  const u = unitOf(f);
  const filled = (i) => str(f[KV_LN_Q[i]]).trim() !== '' || parseCells(f[KV_LN_SERIES[i]]).n > 0;
  const pts = new Map(ln.points.map((p) => [p.i, p]));
  for (let i = 0; i < KV_LN_N; i++) {
    const row = $(`#kv-sheet [data-ln-row="${i}"]`);
    row.hidden = i >= 2 && !filled(i) && !filled(i - 1);
    // удалить можно задание, в котором что-то введено
    row.querySelector('.kv-ln-del').hidden = !filled(i);
    const lbl = $(`#kv-ln-q${i + 1}-lbl`);
    const t = L(`Задание Q${SUB[i + 1]}, ${u}`, `Setting Q${SUB[i + 1]}, ${u}`);
    if (lbl.textContent !== t) lbl.textContent = t;
    const p = pts.get(i);
    setOut(`#kv-sheet output[data-ln="M${i}"]`, p ? `${sig(p.s.mean)}${Number.isFinite(p.urel) ? ` <span class="ua">u<sub>A</sub> ${fmt(p.urel * 100, 2)} %</span>` : ''}` : '—');
    setOut(`#kv-sheet output[data-ln="X${i}"]`, p && Number.isFinite(p.X) ? sig(p.X) : '—');
    const d = !p || !Number.isFinite(p.d) ? '—' : p.i === ln.ref ? esc(L('опорное', 'reference')) : `${pctSigned(p.d)}${Number.isFinite(p.ud) && p.ud > 0 ? ` <span class="ua">u ${fmt(p.ud * 100, 2)} %</span>` : ''}`;
    setOut(`#kv-sheet output[data-ln="d${i}"]`, d);
  }
  setOut('#kv-sheet output[data-ln="dmax"]', ln.ok ? pct(ln.dMax) : '—');
  setOut('#kv-sheet [data-ln="dmax-at"]', ln.ok ? esc(L(`задание ${ln.dMaxAt + 1} к заданию ${ln.ref + 1}`, `setting ${ln.dMaxAt + 1} vs setting ${ln.ref + 1}`)) : '');
  setOut('#kv-sheet output[data-ln="clmax"]', ln.ok ? fmt(ln.clMax, 4) : '—');
  setOut('#kv-sheet [data-ln="clmax-at"]', ln.ok ? esc(L(`задания ${ln.clAt[0] + 1} и ${ln.clAt[1] + 1}`, `settings ${ln.clAt[0] + 1} and ${ln.clAt[1] + 1}`)) : '');
  const box = $('#kv-ln-cl-box');
  box.hidden = !ln.ok || ln.cl.length < 2;
  if (!box.hidden) setOut('#kv-ln-cl', ln.cl.map((c) => `<tr${c.value === ln.clMax ? ' class="sum"' : ''}><td>${c.i + 1} – ${c.j + 1}</td><td class="v">${fmt(c.value, 4)}</td></tr>`).join(''));
}

/** График линейности: средние показания от задания, прямая по методу наименьших квадратов и пропорциональность по первому заданию. */
function renderLnChart(f, ln) {
  const wrap = $('#kv-ln-chart-wrap');
  const P = ln.ok ? ln.points : [];
  wrap.hidden = P.length < 2;
  if (wrap.hidden) return;
  const u = unitOf(f);
  const fit = linearFit(P.map((p) => p.q), P.map((p) => p.abs));
  const r0 = P[0];
  const qMax = Math.max(...P.map((p) => p.q));
  const pts = P.map((p) => ({ x: p.q, y: p.abs, title: L(`Задание ${p.i + 1}: Q = ${sig(p.q)} ${u}, M̄ = ${sig(p.abs)}`, `Setting ${p.i + 1}: Q = ${sig(p.q)} ${u}, M̄ = ${sig(p.abs)}`) }));
  const lines = [{ cls: 's2', a: 0, b: r0.X, x0: 0, x1: qMax * 1.05, dashed: true }];
  if (fit) lines.push({ cls: 's1', a: fit.a, b: fit.b, x0: 0, x1: qMax * 1.05 });
  scatterChart($('#kv-ln-chart'), {
    label: L('Линейность: среднее показание от задания облучения', 'Linearity: mean reading versus exposure setting'),
    xLabel: L(`Задание Q, ${u}`, `Setting Q, ${u}`),
    yLabel: L('Среднее показание M̄', 'Mean reading M̄'),
    fmt,
    xInclude: [0],
    yInclude: [0],
    aspect: 0.5,
    series: [{ cls: 's1', points: pts }],
    lines,
  });
  const items = [
    [legendSwatch({ cls: 's1' }), L('M̄ при задании', 'M̄ at the setting')],
    [legendSwatch({ line: true, cls: 's1' }), L('прямая по точкам', 'fitted line')],
    [legendSwatch({ line: true, dashed: true, cls: 's2' }), L(`пропорциональность по заданию ${r0.i + 1}: M̄ = X₁·Q`, `proportionality to setting ${r0.i + 1}: M̄ = X₁·Q`)],
  ];
  setOut('#kv-ln-legend', items.map(([sw, t]) => `<span class="item">${sw}<span>${esc(t)}</span></span>`).join(''));
  const eq = fit
    ? L(
        `Прямая по точкам: M̄ = ${sig(fit.b)}·Q ${fit.a < 0 ? '−' : '+'} ${sig(Math.abs(fit.a))}${P.length > 2 ? `, R² = ${fmt(fit.r2, 5)}` : ' (через две точки)'}. При пропорциональном выходе точки лежат на прямой через начало координат; отрезок на оси показаний — вклад, не зависящий от задания (например, ошибка таймера).`,
        `Fitted line: M̄ = ${sig(fit.b)}·Q ${fit.a < 0 ? '−' : '+'} ${sig(Math.abs(fit.a))}${P.length > 2 ? `, R² = ${fmt(fit.r2, 5)}` : ' (through two points)'}. With a proportional output the points lie on a line through the origin; the intercept on the reading axis is a contribution independent of the setting (for example, the timer error).`,
      )
    : '';
  setOut('#kv-ln-eq', richText(eq));
}

/** Удалить задание i линейности: следующие задания сдвигаются вверх, последнее становится пустым. */
function deleteLnRow(i) {
  const q = KV_LN_Q.map((k) => $(`#${k}`).value);
  const m = KV_LN_SERIES.map((k) => api.readSeries(k));
  q.splice(i, 1);
  m.splice(i, 1);
  q.push('');
  m.push(['', '', '']);
  KV_LN_Q.forEach((k, j) => {
    $(`#${k}`).value = q[j];
  });
  KV_LN_SERIES.forEach((k, j) => api.writeSeries(k, m[j]));
  api.changed();
  // фокус — на задание, вставшее на место удалённого (или на первое)
  $(`#${KV_LN_Q[Math.min(i, KV_LN_N - 1)]}`)?.focus();
}

function settingsText(f) {
  const qs = KV_LN_Q.map((k) => str(f[k]).trim()).filter(Boolean);
  return qs.length ? `${qs.join('; ')} ${unitOf(f)}` : '—';
}

function renderLnTable(vr) {
  const v = api.getVisit();
  const cap = (t) => ` data-cap="${esc(t)}"`;
  const rows = v.modes.map((md, m) => {
    const ln = vr.modes[m].ln;
    const on = m === v.mode;
    return `<tr data-m="${m}"${on ? ' class="active"' : ''}>
      ${pick(m, on)}
      <td class="mode"${cap(L('Режим', 'Mode'))}>${esc(api.modeName(m))}</td>
      <td class="q"${cap(L('Задания', 'Settings'))}>${esc(ln.state === 'empty' ? '—' : settingsText(md.shared))}</td>
      <td class="v c-d"${cap(L('Отклонение', 'Deviation'))}>${ln.ok ? pct(ln.dMax) : ln.state === 'empty' ? '—' : `<small>${esc(L('не вычислено', 'not calculated'))}</small>`}</td>
      <td class="v c-cl"${cap('CL')}>${ln.ok ? fmt(ln.clMax, 4) : '—'}</td>
      ${stateCell(lvlOf(ln))}
    </tr>`;
  });
  setOut('#kv-lnq-body', rows.join(''));
}

// ------------------------------------------------------------ воспроизводимость
function renderRp(rp) {
  const s = rp.s;
  setOut('#kv-sheet output[data-rp="mean"]', s && s.n > 0 && !s.error ? `${sig(s.mean)} <span class="ua">n = ${s.n}</span>` : '—');
  setOut('#kv-sheet output[data-rp="min"]', rp.ok ? sig(rp.min) : '—');
  setOut('#kv-sheet output[data-rp="max"]', rp.ok ? sig(rp.max) : '—');
  setOut('#kv-sheet output[data-rp="R"]', rp.ok ? pct(rp.R) : '—');
  setOut('#kv-sheet output[data-rp="cv"]', rp.ok ? pct(rp.cv) : '—');
}

function renderRpTable(vr) {
  const v = api.getVisit();
  const cap = (t) => ` data-cap="${esc(t)}"`;
  const rows = v.modes.map((md, m) => {
    const rp = vr.modes[m].rp;
    const on = m === v.mode;
    return `<tr data-m="${m}"${on ? ' class="active"' : ''}>
      ${pick(m, on)}
      <td class="mode"${cap(L('Режим', 'Mode'))}>${esc(api.modeName(m))}</td>
      <td class="v c-n"${cap('n')}>${rp.state === 'empty' ? '—' : rp.n}</td>
      <td class="v c-mean"${cap('M̄')}>${rp.ok ? sig(rp.abs) : '—'}</td>
      <td class="v c-range"${cap('Kmin – Kmax')}>${rp.ok ? `${sig(rp.min)} – ${sig(rp.max)}` : '—'}</td>
      <td class="v c-r"${cap('R')}>${rp.ok ? pct(rp.R) : rp.state === 'empty' ? '—' : `<small>${esc(L('не вычислено', 'not calculated'))}</small>`}</td>
      <td class="v c-cv"${cap('s/M̄')}>${rp.ok ? pct(rp.cv) : '—'}</td>
      ${stateCell(lvlOf(rp))}
    </tr>`;
  });
  setOut('#kv-rpq-body', rows.join(''));
}

/** Листы «Линейность» и «Воспроизводимость»: f — форма выбранного режима, vr — computeKvVisit. */
export function renderQaSheets(f, vr) {
  if (!api) return;
  const v = api.getVisit();
  const mr = vr.modes[v.mode];
  renderLnRows(f, mr.ln);
  renderLnChart(f, mr.ln);
  renderLnTable(vr);
  renderRp(mr.rp);
  renderRpTable(vr);
  // в печать лист идёт, только если его проверку где-то проводили
  const lnUsed = vr.modes.some((x) => x.ln.state !== 'empty');
  const rpUsed = vr.modes.some((x) => x.rp.state !== 'empty');
  for (const sec of $$('#kv-sheet section.step[data-kv-page="linearity"]')) sec.classList.toggle('no-print', !lnUsed);
  for (const sec of $$('#kv-sheet section.step[data-kv-page="repro"]')) sec.classList.toggle('no-print', !rpUsed);
}

/** Состояние листа по всем режимам: 'empty' | 'done' | 'warn' | 'error'. */
export function qaPageState(vr, key) {
  const rank = { empty: 0, ok: 1, warn: 2, error: 3 };
  let st = 'empty';
  for (const mr of vr.modes) {
    const l = lvlOf(key === 'linearity' ? mr.ln : mr.rp);
    if (rank[l] > rank[st]) st = l;
  }
  return st === 'ok' ? 'done' : st;
}

/** Строки протокола: линейность и воспроизводимость по режимам (только если их проводили). */
export function qaReportLines(visit, vr) {
  const out = [];
  const cells = (a) => (Array.isArray(a) ? a.filter((s) => str(s).trim() !== '').join('; ') : '');
  const tolLine = (pairs, head) => {
    const t = pairs.filter(([x]) => str(x).trim()).map(([x, s]) => s.replace('X', str(x).trim()));
    if (t.length) out.push(`  ${head}: ${t.join('; ')}.`);
  };
  if (visit.modes.some((_, m) => vr.modes[m].ln.state !== 'empty')) {
    out.push(L('Линейность по режимам (не TRS-398 Rev.1 — по методике учреждения):', 'Linearity by mode (not TRS-398 Rev.1, local procedure):'));
    visit.modes.forEach((md, m) => {
      const ln = vr.modes[m].ln;
      const f = md.shared;
      if (ln.state === 'empty') return;
      const u = unitOf(f);
      const sets = [];
      for (let i = 0; i < KV_LN_N; i++) {
        if (!str(f[KV_LN_Q[i]]).trim() && !cells(f[KV_LN_SERIES[i]])) continue;
        sets.push(`Q${SUB[i + 1]} = ${str(f[KV_LN_Q[i]]).trim() || '—'} ${u}: ${cells(f[KV_LN_SERIES[i]]) || '—'}`);
      }
      const app = str(f.kv_ln_app).trim() ? L(` (аппликатор ${f.kv_ln_app})`, ` (applicator ${f.kv_ln_app})`) : '';
      const res = ln.ok
        ? L(`отклонение от пропорциональности до ${pct(ln.dMax)} (задание ${ln.dMaxAt + 1} к заданию ${ln.ref + 1}), CL до ${fmt(ln.clMax, 4)} (задания ${ln.clAt[0] + 1} и ${ln.clAt[1] + 1})`, `deviation from proportionality up to ${pct(ln.dMax)} (setting ${ln.dMaxAt + 1} vs setting ${ln.ref + 1}), CL up to ${fmt(ln.clMax, 4)} (settings ${ln.clAt[0] + 1} and ${ln.clAt[1] + 1})`)
        : L('не вычислена (см. замечания)', 'not calculated (see the messages)');
      out.push(`  ${L(`Режим ${m + 1}`, `Mode ${m + 1}`)} (${api.modeName(m)})${app}: ${sets.join('; ')}; ${res}`);
    });
    tolLine([[visit.common.kv_ln_tol, L('отклонение ≤ X %', 'deviation ≤ X %')], [visit.common.kv_ln_cl_tol, 'CL ≤ X']], L('Допуски (по методике учреждения)', 'Tolerances (local procedure)'));
    out.push('');
  }
  if (visit.modes.some((_, m) => vr.modes[m].rp.state !== 'empty')) {
    out.push(L('Воспроизводимость по режимам (не TRS-398 Rev.1 — по методике учреждения):', 'Reproducibility by mode (not TRS-398 Rev.1, local procedure):'));
    visit.modes.forEach((md, m) => {
      const rp = vr.modes[m].rp;
      const f = md.shared;
      if (rp.state === 'empty') return;
      const geo = [str(f.kv_rp_app).trim() ? L(`аппликатор ${f.kv_rp_app}`, `applicator ${f.kv_rp_app}`) : '', str(f.kv_rp_dist).trim() ? L(`${f.kv_rp_dist} см от аппликатора`, `${f.kv_rp_dist} cm from the applicator`) : ''].filter(Boolean).join(', ');
      const res = rp.ok ? `R = |1 − K_min/K_max| = ${pct(rp.R)}, s/M̄ = ${pct(rp.cv)}` : L('не вычислена (см. замечания)', 'not calculated (see the messages)');
      out.push(`  ${L(`Режим ${m + 1}`, `Mode ${m + 1}`)} (${api.modeName(m)})${geo ? ` (${geo})` : ''}: ${cells(f.kv_rp_M) || '—'}; ${res}`);
    });
    tolLine([[visit.common.kv_rp_tol, 'R ≤ X %']], L('Допуск (по методике учреждения)', 'Tolerance (local procedure)'));
    out.push('');
  }
  return out;
}

/**
 * Подключить листы: a — { getVisit, modeName(m), selectMode(m), readSeries(key), writeSeries(key, cells), changed() }.
 */
export function setupKvQa(a) {
  api = a;
  $('#kv-sheet').addEventListener('click', (e) => {
    const b = e.target.closest('.kv-ln-del');
    if (b) deleteLnRow(Number(b.dataset.lnDel));
  });
  for (const id of ['#kv-lnq-body', '#kv-rpq-body']) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('.kv-qa-pick');
      if (b) api.selectMode(Number(b.closest('tr[data-m]').dataset.m));
    });
  }
}
