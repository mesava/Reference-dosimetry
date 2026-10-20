// «Журнал и тренды»: контрольная карта пучка и общая часть сеансов (расчёт — core/spc.js, core/journal-spc.js).
import { L, refText } from '../core/i18n.js';
import { beamChart, sessionCommon, BEAM_Z } from '../core/journal-spc.js';
import { checkPairs, checkChart, stabilityNote, CHECK_REF } from '../core/journal-check.js';
import { BASELINE_POINTS, PROVISIONAL_BELOW, MIN_POINTS } from '../core/spc.js';
import { signalText } from '../core/spc-text.js';

export { signalText };
import { $, esc, fmt, fmtSigned } from './common.js';
import { scatterChart, legendSwatch } from './chart.js';
import { fmtDate, monthLabel, monthTicks, monthYear } from './journal-common.js';

const reasonText = (r) =>
  ({
    start: L('с первой записи', 'from the first record'),
    adjust: L('после подстройки ускорителя', 'after the linac adjustment'),
    equipment: L('после смены камеры, электрометра или их калибровочных коэффициентов', 'after a change of the chamber, electrometer or their calibration coefficients'),
    manual: L('по отметке «новый отсчёт»', 'by the “new count” mark'),
    factors: L('после того как k_pol и k_s второй камеры стали известны', 'after k_pol and k_s of the second chamber became known'),
  })[r] ?? '';

const stageText = (p) => (p.stage === 'found' ? L(' (до подстройки)', ' (before adjustment)') : p.stage === 'left' ? L(' (после подстройки)', ' (after adjustment)') : '');

/** Линии отсчётов: центральная, ±2σ, ±3σ — на интервале дат каждого отсчёта. */
function segmentLines(chart, xMax) {
  const lines = [];
  chart.segments.forEach((seg, k) => {
    if (!seg.limits) return;
    const a = chart.points[seg.from].day;
    const next = chart.segments[k + 1];
    const b = next ? chart.points[next.from].day : xMax;
    const x0 = a;
    const x1 = b > a ? b : a + 1;
    lines.push({ cls: 'cl', a: seg.cl, b: 0, x0, x1 });
    for (const m of [-2, 2]) lines.push({ cls: 'lim2', a: seg.cl + m * seg.sigma, b: 0, x0, x1 });
    for (const m of [-3, 3]) lines.push({ cls: 'lim3', a: seg.cl + m * seg.sigma, b: 0, x0, x1, dashed: true });
  });
  return lines;
}

/** Метки начала отсчётов (кроме первого). */
const segmentMarks = (chart) =>
  chart.segments.slice(1).map((seg, i) => ({
    x: chart.points[seg.from].day,
    label: seg.reason === 'adjust' ? L('подстройка', 'adjustment') : seg.reason === 'equipment' ? L('оборудование', 'equipment') : seg.reason === 'factors' ? 'k_pol, k_s' : L('новый отсчёт', 'new count'),
    row: i % 2,
  }));

function drawChart(box, chart, { tol, label, yLabel, pointTitle, check }) {
  const pts = chart.points;
  const days = pts.map((p) => p.day);
  const x0 = Math.min(...days);
  const x1 = Math.max(...days);
  const lim = chart.segments.filter((s) => s.limits).flatMap((s) => [s.cl - 3 * s.sigma, s.cl + 3 * s.sigma]);
  const yInc = [...lim, ...(Number.isFinite(tol) ? [-tol, tol] : [])];
  const regular = pts.filter((p) => !p.signals.length);
  const sig = pts.filter((p) => p.signals.length);
  const point = (p) => ({ x: p.day, y: p.value, hollow: check(p), title: pointTitle(p) });
  scatterChart(box, {
    label,
    xLabel: L('Дата измерения', 'Measurement date'),
    yLabel,
    fmt,
    xFmt: monthLabel,
    xTicks: monthTicks,
    xInclude: x0 === x1 ? [x0 - 15, x1 + 15] : [],
    yInclude: yInc,
    aspect: 0.45,
    vlines: segmentMarks(chart),
    series: [
      // ломаная — внутри отсчёта; между отсчётами не соединяется
      ...chart.segments.map((seg) => ({ cls: 't1', line: true, points: pts.slice(seg.from, seg.to + 1).map((p) => ({ x: p.day, y: p.value })) })),
      { cls: 't1', shape: 'circle', points: regular.filter((p) => p.stage !== 'found').map(point) },
      { cls: 't1', shape: 'diamond', points: regular.filter((p) => p.stage === 'found').map(point) },
      { cls: 'sig', shape: 'square', points: sig.map(point) },
    ],
    lines: [
      ...segmentLines(chart, x1),
      ...(Number.isFinite(tol) ? [tol, -tol].map((a) => ({ cls: 'aux', a, b: 0, x0: x0 - 400, x1: x1 + 400, dashed: true })) : []),
    ],
    notes: Number.isFinite(tol) ? [{ x: x0, y: tol, text: `+${fmt(tol, tol % 1 ? 1 : 0)} %`, anchor: 'start' }, { x: x0, y: -tol, text: `−${fmt(tol, tol % 1 ? 1 : 0)} %`, anchor: 'start', below: true }] : [],
  });
}

const legendHtml = (items) => items.map(([sw, text]) => `<span class="item">${legendSwatch(sw)}<span>${esc(text)}</span></span>`).join('');

/** Строка об отсчёте: с какого сеанса, сколько точек, CL, σ, границы. */
function segmentLine(chart, unit = '%') {
  const seg = chart.current;
  const from = fmtDate(chart.points[seg.from].date);
  const head = L(`Текущий отсчёт — с ${from} (${reasonText(seg.reason)}), записей: ${seg.n}.`, `Current count: from ${from} (${reasonText(seg.reason)}), records: ${seg.n}.`);
  if (!seg.limits) {
    return `${esc(head)} ${esc(L(`Границы появятся с ${MIN_POINTS}-й записи отсчёта.`, `The limits appear from the ${MIN_POINTS}th record of the count.`))}`;
  }
  const lo = seg.cl - 3 * seg.sigma;
  const hi = seg.cl + 3 * seg.sigma;
  const prov = seg.provisional
    ? ` ${L(`Границы предварительные: меньше ${PROVISIONAL_BELOW} записей.`, `The limits are provisional: fewer than ${PROVISIONAL_BELOW} records.`)}`
    : seg.baselineN >= BASELINE_POINTS
      ? ` ${L(`Границы — по первым ${BASELINE_POINTS} записям отсчёта.`, `The limits are based on the first ${BASELINE_POINTS} records of the count.`)}`
      : '';
  const exc = seg.excluded ? ` ${L(`Точек за 3σ, не вошедших в расчёт границ: ${seg.excluded}.`, `Points beyond 3σ left out of the limits: ${seg.excluded}.`)}` : '';
  return esc(
    `${head} ${L(
      `Центральная линия ${fmtSigned(seg.cl, 2)} ${unit}, σ = ${fmt(seg.sigma, 2)} ${unit}, границы ±3σ: ${fmtSigned(lo, 2)} … ${fmtSigned(hi, 2)} ${unit}.`,
      `Centre line ${fmtSigned(seg.cl, 2)} ${unit}, σ = ${fmt(seg.sigma, 2)} ${unit}, ±3σ limits: ${fmtSigned(lo, 2)} … ${fmtSigned(hi, 2)} ${unit}.`,
    )}${prov}${exc}`,
  );
}

function trendLine(chart, tol) {
  const t = chart.trend;
  if (!t) return '';
  const head = L(`Тренд текущего отсчёта: ${fmtSigned(t.perMonth, 3)} ± ${fmt(t.sePerMonth, 3)} %/мес`, `Trend of the current count: ${fmtSigned(t.perMonth, 3)} ± ${fmt(t.sePerMonth, 3)} %/month`);
  if (!t.significant) return esc(`${head} — ${L('незначим (в пределах разброса).', 'not significant (within the scatter).')}`);
  const f = chart.forecast;
  const sideTxt = (s) => (s > 0 ? `+${fmt(tol, tol % 1 ? 1 : 0)} %` : `−${fmt(tol, tol % 1 ? 1 : 0)} %`);
  let tail = '';
  if (f?.already) tail = L(` Линия тренда уже за допуском ${sideTxt(f.side)}.`, ` The trend line is already beyond the ${sideTxt(f.side)} tolerance.`);
  else if (f?.beyond) tail = L(` Если дрейф сохранится, до допуска ${sideTxt(f.side)} — больше трёх лет.`, ` If the drift continues, the ${sideTxt(f.side)} tolerance is more than three years away.`);
  else if (f) {
    const when = monthYear(Math.round(f.day));
    tail = L(` Если дрейф сохранится, выход за ${sideTxt(f.side)} — ориентировочно ${when}.`, ` If the drift continues, it will exceed ${sideTxt(f.side)} around ${when}.`);
  }
  return `<span class="spc-warn">${esc(`${head} — ${L('значим.', 'significant.')}`)}</span>${esc(tail)}`;
}

/** Сигналы (3σ, CUSUM) и, отдельно, наблюдения (2 из 3, 8 подряд, 6 подряд) — последние сверху. */
function signalsHtml(chart, name = () => '', none = '') {
  const item = (p, keys) => `<li><b>${esc(fmtDate(p.date))}</b>${esc(stageText(p))}${name(p) ? `, ${esc(name(p))}` : ''}: ${esc(fmtSigned(p.value, 2))} % — ${esc(keys.map(signalText).join('; '))}</li>`;
  const list = chart.points.filter((p) => p.signals.length).slice(-8).reverse();
  // наблюдения — только в текущем отсчёте и без точек, где уже есть сигнал
  const cur = chart.current;
  const watch = (cur ? chart.points.slice(cur.from, cur.to + 1) : []).filter((p) => p.watch?.length && !p.signals.length).slice(-5).reverse();
  const head = list.length
    ? `<p>${esc(L('Сигналы (последние сверху):', 'Signals (latest first):'))}</p><ul class="spc-signals">${list.map((p) => item(p, p.signals)).join('')}</ul>`
    : `<p>${esc(none || L('Сигналов нет: выход меняется в пределах обычного разброса.', 'No signals: the output varies within its usual scatter.'))}</p>`;
  const obs = watch.length
    ? `<p class="sub-hint">${esc(L('Наблюдения в текущем отсчёте — не сигнал, а повод посмотреть следующие записи (такие узоры часто бывают и у стабильного процесса):', 'Observations in the current count: not a signal but a reason to watch the next records (such patterns also occur in a stable process):'))}</p><ul class="spc-signals spc-watch">${watch.map((p) => item(p, p.watch)).join('')}</ul>`
    : '';
  return head + obs;
}
/** Сигналы и наблюдения точки для подсказки. */
const pointRules = (p) => `${p.signals.length ? ` — ${p.signals.map(signalText).join('; ')}` : ''}${p.watch?.length ? ` (${L('наблюдение', 'observation')}: ${p.watch.map(signalText).join('; ')})` : ''}`;

const helpHtml = () => `<details class="jsb-more"><summary>${esc(L('Как читать карту', 'How to read the chart'))}</summary><p class="sub-hint">${esc(
  L(
    `Сигнал — ещё не выход за допуск, а повод разобраться: выход, вероятно, изменился не случайно. Сначала проверьте само измерение (установку, термометр и барометр, тепловое равновесие, камеру и электрометр) и повторите его; если сигнал подтвердился — ищите причину в ускорителе. Карта сама по себе не основание подстраивать ускоритель. Сигналы: точка за 3σ — резкий скачок; накопленная сумма (CUSUM, k = 0,5σ, h = 5σ) — небольшой устойчивый сдвиг около 1σ. Наблюдения (справка): 2 из 3 точек за 2σ по одну сторону и 8 точек подряд по одну сторону — возможный сдвиг уровня; 6 точек подряд растут или убывают — возможный дрейф. Наблюдения часто появляются и у стабильного пучка, поэтому сигналом не считаются: по моделированию с границами по 20 записям ложный сигнал хотя бы одного правила за год ежемесячных измерений был бы у каждого четвёртого стабильного пучка, только 3σ и CUSUM — примерно у каждого шестого. σ = MR̄/1,128, где MR̄ — средний размах соседних записей. Границы считаются по первым ${BASELINE_POINTS} записям отсчёта и дальше не меняются; точки за 3σ в их расчёт не входят, чтобы один выброс не расширял границы; пока записей меньше ${PROVISIONAL_BELOW}, границы предварительные. Тренд — наклон прямой по записям текущего отсчёта; прогноз показывается, только если наклон значим (критерий Стьюдента, 95 %). Ромб — значение до подстройки ускорителя, квадрат — точка с сигналом, полый значок — проверка выхода. Источники: Western Electric Statistical Quality Control Handbook (1956); Montgomery D C, Introduction to Statistical Quality Control; Pawlicki T и др., Med Phys 32 (2005) 2777.`,
    `A signal is not yet an out-of-tolerance result but a reason to investigate: the output has probably changed not by chance. First check the measurement itself (setup, thermometer and barometer, thermal equilibrium, chamber and electrometer) and repeat it; if the signal is confirmed, look for the cause in the linac. The chart alone is not a reason to adjust the linac. Signals: a point beyond 3σ is a sudden jump; the cumulative sum (CUSUM, k = 0.5σ, h = 5σ) catches a small sustained shift of about 1σ. Observations (for information): 2 of 3 points beyond 2σ on one side and 8 points in a row on one side suggest a level shift; 6 points in a row increasing or decreasing suggest a drift. Observations often appear in a stable beam too, so they are not counted as signals: by simulation with limits from 20 records, a false signal of at least one rule within a year of monthly measurements would occur in one stable beam in four with all rules, and in about one in six with 3σ and CUSUM only. σ = MR̄/1.128, where MR̄ is the mean range of adjacent records. The limits are based on the first ${BASELINE_POINTS} records of the count and do not change afterwards; points beyond 3σ are left out of them so that a single outlier does not widen the limits; while there are fewer than ${PROVISIONAL_BELOW} records, the limits are provisional. The trend is the slope of a line through the records of the current count; a forecast is shown only if the slope is significant (Student's test, 95%). Diamond: the value before the linac adjustment; square: a point with a signal; hollow marker: an output check. Sources: Western Electric Statistical Quality Control Handbook (1956); Montgomery D C, Introduction to Statistical Quality Control; Pawlicki T et al., Med Phys 32 (2005) 2777.`,
  ),
)}</p></details>`;

/** Контрольная карта выбранного пучка. beams — пучки показанного вида; возвращает id выбранного пучка. */
export function renderSpc(j, machineId, beams, beamId, { cobalt = false } = {}) {
  const sel = $('#hs_beam');
  const box = $('#hs-spc-chart');
  const legend = $('#hs-spc-legend');
  const summary = $('#hs-spc-summary');
  const charts = beams.map((b) => ({ beam: b, chart: beamChart(j, machineId, b.id) }));
  const withData = charts.filter((c) => c.chart.points.length);
  const chosen = withData.find((c) => c.beam.id === beamId) ?? withData[0] ?? charts.find((c) => c.beam.id === beamId) ?? charts[0];
  sel.innerHTML = beams.length
    ? beams.map((b) => `<option value="${esc(b.id)}"${b.id === chosen?.beam.id ? ' selected' : ''}>${esc(b.name || L('пучок', 'beam'))}</option>`).join('')
    : `<option value="">—</option>`;
  sel.disabled = beams.length < 2;
  if (!chosen || !chosen.chart.points.length) {
    box.innerHTML = `<p class="chart-empty">${esc(L('Карта появится, когда у пучка будут записи со значением для сравнения.', 'The chart appears once the beam has records with a comparison value.'))}</p>`;
    legend.innerHTML = '';
    summary.innerHTML = '';
    return chosen?.beam.id ?? '';
  }
  const { chart } = chosen;
  const tol = chosen.chart.tol;
  drawChart(box, chart, {
    tol,
    label: L(`Контрольная карта: ${chosen.beam.name}`, `Control chart: ${chosen.beam.name}`),
    yLabel: cobalt ? L('Отклонение от ожидаемой, %', 'Deviation from expected, %') : L('Отклонение от номинала, %', 'Deviation from nominal, %'),
    check: (p) => p.mode === 'check',
    pointTitle: (p) => `${fmtDate(p.date)}${stageText(p)}: ${fmtSigned(p.value, 2)} %${Number.isFinite(p.z) ? ` (${fmtSigned(p.z, 1)}σ)` : ''}${pointRules(p)}`,
  });
  legend.innerHTML = legendHtml([
    [{ cls: 't1' }, L('отклонение (полый — проверка выхода)', 'deviation (hollow: output check)')],
    [{ cls: 't1', shape: 'diamond' }, L('до подстройки', 'before adjustment')],
    [{ cls: 'sig', shape: 'square' }, L('сигнал карты', 'chart signal')],
    [{ line: true, cls: 'cl' }, L('центральная линия', 'centre line')],
    [{ line: true, cls: 'lim2' }, '±2σ'],
    [{ line: true, cls: 'lim3', dashed: true }, '±3σ'],
    [{ line: true, cls: 'aux', dashed: true }, L('допуск', 'tolerance')],
  ]);
  summary.innerHTML = `<p>${segmentLine(chart)}</p>${chart.trend ? `<p>${trendLine(chart, tol)}</p>` : ''}${signalsHtml(chart)}${helpHtml()}`;
  return chosen.beam.id;
}

/** Общая часть сеансов по пучкам показанного вида. */
export function renderCommon(j, machineId, beams) {
  const box = $('#hs-common-chart');
  const legend = $('#hs-common-legend');
  const summary = $('#hs-common-summary');
  const res = sessionCommon(
    j,
    machineId,
    beams.map((b) => b.id),
  );
  const name = (id) => beams.find((b) => b.id === id)?.name || '—';
  if (beams.length < 2 || !res.rows.length) {
    box.innerHTML = `<p class="chart-empty">${esc(
      beams.length < 2
        ? L('Общую часть можно выделить, когда у аппарата хотя бы два пучка одного вида.', 'The common part can be found once the machine has at least two beams of one kind.')
        : L(`График появится, когда хотя бы у двух пучков будет не меньше ${MIN_POINTS} записей отсчёта.`, `The plot appears once at least two beams have ${MIN_POINTS} or more records in their count.`),
    )}</p>`;
    legend.innerHTML = '';
    summary.innerHTML = '';
    return res;
  }
  const chart = res.chart;
  drawChart(box, chart, {
    tol: NaN,
    label: L('Общая часть отклонений пучков по записям', 'Common part of the beam deviations by record'),
    yLabel: L('Общая часть, %', 'Common part, %'),
    check: () => false,
    pointTitle: (p) => `${fmtDate(p.date)}: ${fmtSigned(p.value, 2)} % (${L('пучков', 'beams')}: ${p.n})${pointRules(p)}`,
  });
  legend.innerHTML = legendHtml([
    [{ cls: 't1' }, L('общая часть записи', 'common part of the record')],
    [{ cls: 'sig', shape: 'square' }, L('сигнал', 'signal')],
    [{ line: true, cls: 'cl' }, L('центральная линия', 'centre line')],
    [{ line: true, cls: 'lim2' }, '±2σ'],
    [{ line: true, cls: 'lim3', dashed: true }, '±3σ'],
  ]);
  const last = res.rows.at(-1);
  const own = last.beams.map((b) => `${name(b.beamId)} ${fmtSigned(b.e, 2)} %`).join(', ');
  const lines = [
    esc(L(`Последняя запись (${fmtDate(last.date)}): общая часть ${fmtSigned(last.value, 2)} % по ${last.n} пучкам; собственные части: ${own}.`, `Last record (${fmtDate(last.date)}): common part ${fmtSigned(last.value, 2)}% over ${last.n} beams; own parts: ${own}.`)),
  ];
  const lone = last.beams.filter((b) => Math.abs(b.z) > BEAM_Z);
  if (last.signals.length) {
    lines.push(
      `<span class="spc-warn">${esc(L(
        `Сдвинулись все пучки вместе (${last.signals.map(signalText).join('; ')}). Прежде чем подстраивать ускоритель, проверьте дозиметрию: термометр и барометр и их поверку, тепловое равновесие воды и камеры, камеру, кабель и электрометр, N_D,w и k_elec после поверки. Если дозиметрия в порядке — общая для пучков часть ускорителя, прежде всего мониторная камера.`,
        `All beams shifted together (${last.signals.map(signalText).join('; ')}). Before adjusting the linac, check the dosimetry: the thermometer and barometer and their calibration, thermal equilibrium of water and chamber, the chamber, cable and electrometer, N_D,w and k_elec after calibration. If the dosimetry is fine, look at the part of the linac common to the beams, first of all the monitor chamber.`,
      ))}</span>`,
    );
  }
  if (lone.length) {
    lines.push(
      `<span class="spc-warn">${esc(L(
        `Отдельно от других ушёл ${lone.map((b) => `${name(b.beamId)} (${fmtSigned(b.e, 2)} %, ${fmtSigned(b.z, 1)}σ)`).join(', ')}: причина скорее в самом пучке.`,
        `Apart from the others, ${lone.map((b) => `${name(b.beamId)} (${fmtSigned(b.e, 2)}%, ${fmtSigned(b.z, 1)}σ)`).join(', ')} moved: the cause is more likely in the beam itself.`,
      ))}</span>`,
    );
  }
  if (!last.signals.length && !lone.length) lines.push(esc(L('Общая часть и собственные части пучков — в пределах обычного разброса.', 'The common part and the beams’ own parts are within their usual scatter.')));
  summary.innerHTML = `${lines.map((x) => `<p>${x}</p>`).join('')}${chart.current?.limits ? `<p>${segmentLine(chart)}</p>` : ''}${signalsHtml(chart)}`;
  return res;
}

/** Замечания для панели справа: сигналы последних сеансов. */
export function spcMessages(j, machineId, beams, common) {
  const out = [];
  for (const b of beams) {
    const ch = beamChart(j, machineId, b.id);
    const p = ch.points.at(-1);
    if (p?.signals.length) {
      out.push({
        level: 'warn',
        head: L('Контрольная карта', 'Control chart'),
        text: L(`${b.name}, ${fmtDate(p.date)}: ${p.signals.map(signalText).join('; ')}.`, `${b.name}, ${fmtDate(p.date)}: ${p.signals.map(signalText).join('; ')}.`),
      });
    }
  }
  const last = common?.rows.at(-1);
  if (last?.signals.length) {
    out.push({
      level: 'warn',
      head: L('Общая часть записи', 'Common part of the record'),
      text: L(`${fmtDate(last.date)}: ${fmtSigned(last.value, 2)} % — сдвинулись все пучки вместе; сначала проверьте дозиметрию.`, `${fmtDate(last.date)}: ${fmtSigned(last.value, 2)}% — all beams shifted together; check the dosimetry first.`),
    });
  }
  return out;
}

// ---------------------------------------------------------------- контроль дозиметра (проверки второй камерой)
const checkHelpHtml = () => `<details class="jsb-more"><summary>${esc(L('Как читать карту', 'How to read the chart'))}</summary><p class="sub-hint">${esc(
  L(
    `Точка — проверка в записи журнала: (r − 1) в процентах, r — отношение дозы по рабочей камере к дозе по второй, обе на z_ref по основной серии. Само значение r зависит от калибровок и k_Q двух камер; следят за его постоянством. Сигнал карты — отношение изменилось не случайно: изменилась одна из двух систем (камера, кабель, электрометр) или само измерение (установка, тепловое равновесие, предоблучение). Какая система изменилась, покажет сравнение с третьей камерой или контрольным источником: в TRS-398 Rev.1 (разд. 4.4.2) дозиметр сравнивают как минимум с двумя другими системами. Правила сигналов и границы — как у контрольной карты выхода. Полый значок — k_pol и k_s второй камеры не измерялись в этой проверке.`,
    `A point is a check in a journal record: (r − 1) in percent, where r is the dose from the working chamber divided by the dose from the second chamber, both at z_ref from the main series. The value of r itself depends on the calibrations and k_Q of the two chambers; what is watched is its constancy. A chart signal means the ratio changed not by chance: one of the two systems (chamber, cable, electrometer) or the measurement itself (setup, thermal equilibrium, pre-irradiation) has changed. Which system changed is shown by a comparison with a third chamber or a check source: TRS-398 Rev.1 (Sec. 4.4.2) compares the dosimeter with at least two other systems. The signal rules and limits are those of the output control chart. Hollow marker: k_pol and k_s of the second chamber were not measured in this check.`,
  ),
)}</p></details>`;

/**
 * «Контроль дозиметра»: пары камер аппарата, карта выбранной пары, оценка стабильности. Возвращает
 * { pairs, pair, cc } (cc — checkChart выбранной пары) или null, если проверок нет.
 */
export function renderChecks(j, machineId, key) {
  const pairs = checkPairs(j, machineId);
  const sec = $('#hs-check-sec');
  sec.hidden = !pairs.length;
  if (!pairs.length) return null;
  const pair = pairs.find((p) => p.key === key) ?? pairs[0];
  const sel = $('#hs_check');
  sel.innerHTML = pairs.map((p) => `<option value="${esc(p.key)}"${p.key === pair.key ? ' selected' : ''}>${esc(`${p.beamName}: ${p.workText} / ${p.secondText}`)}</option>`).join('');
  sel.disabled = pairs.length < 2;
  const cc = checkChart(j, pair);
  const { chart } = cc;
  drawChart($('#hs-check-chart'), chart, {
    tol: NaN,
    label: L(`Отношение доз ${pair.workText} / ${pair.secondText}, ${pair.beamName}`, `Dose ratio ${pair.workText} / ${pair.secondText}, ${pair.beamName}`),
    yLabel: L('Отношение доз − 1, %', 'Dose ratio − 1, %'),
    check: (p) => !p.measured,
    pointTitle: (p) => `${fmtDate(p.date)}: r = ${fmt(p.ratio, 4)} (${fmtSigned(p.value, 2)} %)${Number.isFinite(p.z) ? `, ${fmtSigned(p.z, 1)}σ` : ''}${p.provisional ? L(', предварительная: k_pol и k_s приняты равными 1', ', provisional: k_pol and k_s taken as 1') : ''}${pointRules(p)}`,
  });
  $('#hs-check-legend').innerHTML = legendHtml([
    [{ cls: 't1' }, L('проверка (полый — k_pol и k_s не измерялись)', 'check (hollow: k_pol and k_s not measured)')],
    [{ cls: 'sig', shape: 'square' }, L('сигнал карты', 'chart signal')],
    [{ line: true, cls: 'cl' }, L('центральная линия', 'centre line')],
    [{ line: true, cls: 'lim2' }, '±2σ'],
    [{ line: true, cls: 'lim3', dashed: true }, '±3σ'],
  ]);
  const last = chart.points.at(-1);
  const st = cc.stats;
  const lines = [
    esc(L(`Проверок пары: ${pair.n}; последняя — ${fmtDate(last.date)}: r = ${fmt(last.ratio, 4)} (${fmtSigned(last.value, 2)} %).`, `Checks of the pair: ${pair.n}; last: ${fmtDate(last.date)}, r = ${fmt(last.ratio, 4)} (${fmtSigned(last.value, 2)}%).`)),
    segmentLine(chart),
  ];
  const curPts = chart.current ? chart.points.slice(chart.current.from, chart.current.to + 1) : [];
  if (curPts.length && curPts.every((p) => p.provisional)) {
    lines.push(esc(L('Проверки текущего отсчёта — предварительные: k_pol и k_s второй камеры приняты равными 1. Разброс по ним показателен, но уровень отношения смещён; после измерения k_pol и k_s отсчёт начнётся заново.', 'The checks of the current count are provisional: k_pol and k_s of the second chamber are taken as 1. Their scatter is meaningful, but the level of the ratio is biased; once k_pol and k_s are measured, the count starts anew.')));
  }
  if (chart.trend) {
    const t = chart.trend;
    const head = L(`Тренд отношения в текущем отсчёте: ${fmtSigned(t.perMonth * 12, 2)} ± ${fmt(t.sePerMonth * 12, 2)} % в год`, `Trend of the ratio in the current count: ${fmtSigned(t.perMonth * 12, 2)} ± ${fmt(t.sePerMonth * 12, 2)}% per year`);
    lines.push(t.significant ? `<span class="spc-warn">${esc(`${head} — ${L('значим: одна из систем дрейфует.', 'significant: one of the systems is drifting.')}`)}</span>` : esc(`${head} — ${L('незначим.', 'not significant.')}`));
  }
  lines.push(
    Number.isFinite(cc.u)
      ? esc(L(
          `Разброс отношения в текущем отсчёте: s = ${fmt(cc.u, 2)} % по ${st.n} проверкам (с ${fmtDate(st.from)} по ${fmtDate(st.to)}). Это оценка сверху долговременной стабильности рабочего дозиметра — весь разброс отнесён к нему; её можно перенести в бюджет неопределённости.`,
          `Scatter of the ratio in the current count: s = ${fmt(cc.u, 2)}% over ${st.n} checks (from ${fmtDate(st.from)} to ${fmtDate(st.to)}). This is an upper estimate of the long-term stability of the working dosimeter (the whole scatter is attributed to it); it can be transferred to the uncertainty budget.`,
        ))
      : esc(L(`Разброс отношения оценивается с ${MIN_POINTS} проверок текущего отсчёта (сейчас ${st.n}).`, `The scatter of the ratio is estimated from ${MIN_POINTS} checks of the current count (now ${st.n}).`)),
  );
  $('#hs-check-summary').innerHTML = `${lines.map((x) => `<p>${x}</p>`).join('')}${signalsHtml(chart, () => '', L('Сигналов нет: отношение меняется в пределах обычного разброса.', 'No signals: the ratio varies within its usual scatter.'))}${checkHelpHtml()}<p class="sub-hint">${esc(refText(CHECK_REF))}</p>`;
  const btn = $('#hs-check-unc');
  btn.disabled = !Number.isFinite(cc.u);
  btn.title = Number.isFinite(cc.u) ? '' : L(`Нужно не меньше ${MIN_POINTS} проверок в текущем отсчёте.`, `At least ${MIN_POINTS} checks in the current count are needed.`);
  return { pairs, pair, cc, note: Number.isFinite(cc.u) ? stabilityNote(pair, cc) : '' };
}

/** Сигнал последней проверки каждой пары — для замечаний справа. */
export function checkSignalMessages(j, machineId) {
  const out = [];
  for (const pair of checkPairs(j, machineId)) {
    const p = checkChart(j, pair).chart.points.at(-1);
    if (p?.signals.length) {
      out.push({
        level: 'warn',
        head: L('Контроль дозиметра', 'Dosimeter check'),
        text: L(`${pair.beamName}, ${pair.workText} / ${pair.secondText}, ${fmtDate(p.date)}: ${p.signals.map(signalText).join('; ')}.`, `${pair.beamName}, ${pair.workText} / ${pair.secondText}, ${fmtDate(p.date)}: ${p.signals.map(signalText).join('; ')}.`),
      });
    }
  }
  return out;
}
