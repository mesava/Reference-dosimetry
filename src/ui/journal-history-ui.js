// «Журнал» → «Журнал и тренды»: сеансы аппарата, тренд отклонения выхода от номинала по пучкам, k_pol и k_s по
// калибровкам, сроки калибровки камер и электрометров.
import { L } from '../core/i18n.js';
import { trendSeries, machineOf, equipmentDue, dayNumber } from '../core/journal.js';
import { $, esc, fmt, fmtSigned, today, makeStatus, armButton, notifyUpdate, richText } from './common.js';
import { scatterChart, legendSwatch } from './chart.js';
import { getJournal, updateJournal, onJournal } from './journal-store.js';
import { setupFilePanel, machineOptions, fmtDate, countWord } from './journal-common.js';

const ROOT = () => $('#module-history');
let setStatus = () => {};
let machineId = '';
let kindFilter = 'photon'; // какие пучки показывать, если у аппарата есть и фотоны, и электроны
/** Ряды трендов выбранного аппарата и вида пучков; переключатель вида — только если у аппарата есть оба. */
function seriesOf(j) {
  const all = trendSeries(j, machineId);
  const kinds = new Set(all.map((s) => s.kind));
  const both = kinds.has('photon') && kinds.has('electron');
  if (!both) kindFilter = kinds.has('electron') ? 'electron' : 'photon';
  $('#hs-kind-field').hidden = !both;
  const r = document.getElementById(`hs_kind_${kindFilter}`);
  if (r) r.checked = true;
  return all.filter((s) => s.kind === kindFilter);
}
let bridge = { openSession: () => {}, unsaved: () => false };
/** Открыть сеанс в подразделе «Сеанс»; unsaved — есть ли там незаписанные показания. */
export const setHistoryBridge = (b) => (bridge = { ...bridge, ...b });

const dayToIso = (d) => new Date(d * 86400000).toISOString().slice(0, 10);
const monthName = (m) =>
  [L('янв', 'Jan'), L('фев', 'Feb'), L('мар', 'Mar'), L('апр', 'Apr'), L('май', 'May'), L('июн', 'Jun'), L('июл', 'Jul'), L('авг', 'Aug'), L('сен', 'Sep'), L('окт', 'Oct'), L('ноя', 'Nov'), L('дек', 'Dec')][m - 1];
/** Подпись деления оси дат (деления — начала месяцев): «мар 2026» / «Mar 2026». */
const monthLabel = (d) => {
  const iso = dayToIso(d);
  const [y, m, dd] = iso.split('-');
  return dd === '01' ? `${monthName(Number(m))} ${y}` : fmtDate(iso);
};
/** Деления оси дат: начала месяцев (или кварталов, если месяцев много). */
function monthTicks(x0, x1, count) {
  const a = new Date(x0 * 86400000);
  const ticks = [];
  for (let y = a.getUTCFullYear(), m = a.getUTCMonth() + 1; ; m++) {
    if (m > 11) {
      m = 0;
      y++;
    }
    const d = Date.UTC(y, m, 1) / 86400000;
    if (d > x1) break;
    ticks.push(d);
  }
  if (ticks.length <= count) return ticks.length >= 2 ? ticks : [x0, x1].map(Math.round);
  const step = Math.ceil(ticks.length / count);
  return ticks.filter((_, i) => i % step === 0);
}

function renderChart(series) {
  const box = $('#hs-chart');
  const legend = $('#hs-legend');
  const withData = series.filter((s) => s.points.some((p) => Number.isFinite(p.deviation)));
  if (!withData.length) {
    box.innerHTML = `<p class="chart-empty">${esc(L('График появится, когда в журнале будут сеансы этого аппарата с номинальным выходом.', 'The plot appears once the journal has sessions of this machine with a nominal output.'))}</p>`;
    legend.innerHTML = '';
    return;
  }
  const cls = (i) => `t${(i % 8) + 1}`;
  const all = withData.flatMap((s) => s.points.filter((p) => Number.isFinite(p.deviation)));
  const tol = Math.max(...all.map((p) => p.tol).filter(Number.isFinite), 2);
  const days = all.map((p) => p.day);
  const x0 = Math.min(...days);
  const x1 = Math.max(...days);
  const spec = {
    label: L('Отклонение выхода от номинала по датам сеансов', 'Output deviation from nominal by session date'),
    xLabel: L('Дата сеанса', 'Session date'),
    yLabel: L('Отклонение от номинала, %', 'Deviation from nominal, %'),
    fmt,
    xFmt: monthLabel,
    xTicks: monthTicks,
    xInclude: x0 === x1 ? [x0 - 15, x1 + 15] : [],
    yInclude: [-tol, tol],
    aspect: 0.5,
    series: [
      ...withData.map((s, i) => ({ cls: cls(i), line: true, points: s.points.filter((p) => Number.isFinite(p.deviation)).map((p) => ({ x: p.day, y: p.deviation })) })),
      ...withData.map((s, i) => ({
        cls: cls(i),
        shape: 'circle',
        points: s.points.filter((p) => Number.isFinite(p.deviation)).map((p) => ({ x: p.day, y: p.deviation, hollow: p.mode === 'check', title: `${s.beam.name}, ${fmtDate(p.date)}: ${fmtSigned(p.deviation, 2)} % (${p.mode === 'cal' ? L('калибровка', 'calibration') : L('проверка', 'check')})` })),
      })),
    ],
    lines: [
      { cls: 'aux', a: tol, b: 0, x0: x0 - 400, x1: x1 + 400, dashed: true },
      { cls: 'aux', a: -tol, b: 0, x0: x0 - 400, x1: x1 + 400, dashed: true },
    ],
    notes: [{ x: x0, y: tol, text: `+${fmt(tol, tol % 1 ? 1 : 0)} %`, anchor: 'start' }, { x: x0, y: -tol, text: `−${fmt(tol, tol % 1 ? 1 : 0)} %`, anchor: 'start', below: true }],
    crosshair: (x) => {
      // ближайшая дата сеанса и значения всех пучков в этот день
      let best = days[0];
      for (const d of days) if (Math.abs(d - x) < Math.abs(best - x)) best = d;
      const rows = withData
        .map((s, i) => {
          const p = s.points.find((q) => q.day === best && Number.isFinite(q.deviation));
          return p ? { cls: cls(i), y: p.deviation, text: `${s.beam.name}: ${fmtSigned(p.deviation, 2)} %` } : null;
        })
        .filter(Boolean);
      return rows.length ? { x: best, head: fmtDate(dayToIso(best)), rows } : null;
    },
  };
  scatterChart(box, spec);
  legend.innerHTML =
    withData.map((s, i) => `<span class="item">${legendSwatch({ line: true, cls: cls(i) })}<span>${esc(s.beam.name)}</span></span>`).join('') +
    `<span class="item">${legendSwatch({ cls: 't1', hollow: true })}<span>${esc(L('полый значок — проверка выхода', 'hollow marker: output check'))}</span></span>` +
    `<span class="item">${legendSwatch({ line: true, dashed: true, cls: 'aux' })}<span>${esc(L('допуск', 'tolerance'))}</span></span>`;
}

function renderTables(j, series) {
  const sessions = j.sessions.filter((s) => s.machineId === machineId);
  const beams = series.map((s) => s.beam);
  const ids = new Set(beams.map((b) => b.id));
  // в таблицах — сеансы, где есть пучки показанного вида (список сеансов ниже — все)
  const shown = sessions.filter((s) => s.beams.some((b) => ids.has(b.beamId)));
  // таблица значений графика
  const head = `<tr><th>${esc(L('Дата', 'Date'))}</th><th>${esc(L('Режим', 'Mode'))}</th>${beams.map((b) => `<th class="v">${esc(b.name)}</th>`).join('')}</tr>`;
  const cell = (s, b, f) => {
    const x = s.beams.find((y) => y.beamId === b.id)?.summary;
    return x ? f(x) : '—';
  };
  $('#hs-table').innerHTML = shown.length
    ? `<table class="factors"><thead>${head}</thead><tbody>${shown
        .slice()
        .reverse()
        .map((s) => `<tr><td>${esc(fmtDate(s.date))}</td><td>${esc(s.mode === 'cal' ? L('калибровка', 'calibration') : L('проверка', 'check'))}</td>${beams.map((b) => `<td class="v">${cell(s, b, (x) => (x.ok ? `${fmt(x.value, 4)}<br><small class="${x.status === 'out' ? 'st-out' : ''}">${Number.isFinite(x.deviation) ? `${fmtSigned(x.deviation, 2)} %` : ''}</small>` : '—'))}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`
    : `<p class="sub-hint">${esc(L('Сеансов этого аппарата нет.', 'No sessions for this machine.'))}</p>`;
  // k_pol и k_s по калибровкам
  const cals = shown.filter((s) => s.mode === 'cal');
  const kHead = `<tr><th>${esc(L('Калибровка', 'Calibration'))}</th>${beams.map((b) => `<th class="v">${esc(b.name)}</th>`).join('')}</tr>`;
  $('#hs-ktable').innerHTML = cals.length
    ? `<table class="factors"><thead>${kHead}</thead><tbody>${cals
        .slice()
        .reverse()
        .map((s) => `<tr><td>${esc(fmtDate(s.date))}</td>${beams.map((b) => `<td class="v">${cell(s, b, (x) => (Number.isFinite(x.kpolRaw) ? `${fmt(x.kpolRaw, 4)}<br>${fmt(x.ksRaw, 4)}` : '—'))}</td>`).join('')}</tr>`)
        .join('')}</tbody></table><p class="sub-hint">${richText(L('В ячейке: k_pol (сверху) и k_s, измеренные при калибровке. Их изменение от калибровки к калибровке — ранний признак неполадки камеры, кабеля или электрометра.', 'In each cell: k_pol (top) and k_s measured at the calibration. A change between calibrations is an early sign of a problem with the chamber, cable or electrometer.'))}</p>`
    : `<p class="sub-hint">${esc(L('Калибровок этого аппарата в журнале нет.', 'No calibrations of this machine in the journal.'))}</p>`;
  // список сеансов
  $('#hs-sessions').innerHTML = sessions.length
    ? `<ul class="jsessions">${sessions
        .slice()
        .reverse()
        .map((s) => {
          const bs = s.beams.filter((b) => b.summary);
          const m = machineOf(j, machineId);
          const out = bs.filter((b) => b.summary.status === 'out').map((b) => m?.beams.find((x) => x.id === b.beamId)?.name).filter(Boolean);
          return `<li><div><b>${esc(fmtDate(s.date))}</b> · ${esc(s.mode === 'cal' ? L('калибровка', 'calibration') : L('проверка выхода', 'output check'))} · ${esc(L(`пучков: ${bs.length}`, `beams: ${bs.length}`))}${out.length ? ` · <span class="st-out">${esc(L(`вне допуска: ${out.join(', ')}`, `out of tolerance: ${out.join(', ')}`))}</span>` : ''}${s.staff?.some((x) => x.trim()) ? `<br><small>${esc(s.staff.filter((x) => x.trim()).join(', '))}</small>` : ''}</div>
            <div class="row-tools"><button type="button" class="link-btn" data-open="${esc(s.id)}">${esc(L('Открыть', 'Open'))}</button><button type="button" class="link-btn danger" data-del-session="${esc(s.id)}">${esc(L('Удалить', 'Delete'))}</button></div></li>`;
        })
        .join('')}</ul>`
    : `<p class="sub-hint">${esc(L('Сеансов пока нет: проведите сеанс в подразделе «Сеанс» и запишите его в журнал.', 'No sessions yet: run a session in the Session section and record it in the journal.'))}</p>`;
  for (const btn of $('#hs-sessions').querySelectorAll('[data-del-session]')) {
    armButton(btn, btn.textContent, () => L('Удалить сеанс?', 'Delete session?'), () => {
      updateJournal((jj) => ({ ...jj, sessions: jj.sessions.filter((x) => x.id !== btn.dataset.delSession) }), 'history');
      setStatus(L('Сеанс удалён из журнала. Сохраните журнал в файл.', 'The session has been deleted from the journal. Save the journal to the file.'));
    });
  }
}

function renderReadout(j, series) {
  const m = machineOf(j, machineId);
  const sessions = j.sessions.filter((s) => s.machineId === machineId);
  const last = sessions.at(-1);
  const lastCal = sessions.filter((s) => s.mode === 'cal').at(-1);
  const outLast = last ? last.beams.filter((b) => b.summary?.status === 'out').length : 0;
  $('#hs-result').innerHTML = `<div class="dose-row"><div class="proto"><span>${esc(m?.name || '—')}</span>${last ? (outLast ? `<span class="chip warn">${esc(L(`вне допуска: ${outLast}`, `out of tolerance: ${outLast}`))}</span>` : `<span class="chip good">${esc(L('последний сеанс в допуске', 'last session within tolerance'))}</span>`) : ''}</div>
    <div class="dose-big">${sessions.length}<small>${esc(countWord(sessions.length, [L('сеанс', 'session'), L('сеанса', 'sessions'), L('сеансов', 'sessions')], ['session', 'sessions']))}</small></div>
    <div class="secondary">${esc(L(`последний: ${last ? fmtDate(last.date) : '—'}; последняя калибровка: ${lastCal ? fmtDate(lastCal.date) : '—'}`, `last: ${last ? fmtDate(last.date) : '—'}; last calibration: ${lastCal ? fmtDate(lastCal.date) : '—'}`))}</div></div>`;
  const msgs = equipmentDue(j, today()).map((d) => `<li class="${d.status === 'overdue' ? 'warn' : 'info'}"><span class="lvl">${esc(d.status === 'overdue' ? L('Срок калибровки прошёл', 'Calibration overdue') : L('Срок калибровки подходит', 'Calibration due soon'))}</span><span>${esc(`${d.text}: ${fmtDate(d.dueDate)}`)}</span></li>`);
  if (lastCal && dayNumber(today()) - dayNumber(lastCal.date) > 365) msgs.push(`<li class="info"><span class="lvl">${esc(L('Калибровка', 'Calibration'))}</span><span>${esc(L(`Последняя калибровка аппарата — больше года назад (${fmtDate(lastCal.date)}).`, `The machine's last calibration was more than a year ago (${fmtDate(lastCal.date)}).`))}</span></li>`);
  $('#hs-messages').innerHTML = msgs.join('') || `<li class="info"><span class="lvl">${esc(L('Всё в порядке', 'All clear'))}</span><span>${esc(L('Сроки калибровки камер и электрометров в порядке.', 'Chamber and electrometer calibrations are within their dates.'))}</span></li>`;
  $('#hs-mobile-value').textContent = `${m?.name || '—'}: ${sessions.length}`;
}

function render() {
  const j = getJournal();
  if (!machineOf(j, machineId)) machineId = j.machines[0]?.id ?? '';
  $('#hs_machine').innerHTML = machineOptions(j, machineId);
  const series = seriesOf(j);
  renderChart(series);
  renderTables(j, series);
  renderReadout(j, series);
  notifyUpdate(ROOT());
}

export function historyStatus(text) {
  setStatus(text);
}

export function initHistory() {
  setStatus = makeStatus($('#hs-status'));
  setupFilePanel($('#hs-file'), (t) => setStatus(t));
  render();
  $('#hs_machine').addEventListener('change', (e) => {
    machineId = e.target.value;
    render();
  });
  for (const r of document.querySelectorAll('input[name="hs_kind"]')) {
    r.addEventListener('change', () => {
      kindFilter = r.value === 'electron' ? 'electron' : 'photon';
      render();
    });
  }
  $('#hs-sessions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-open]');
    if (!b) return;
    const s = getJournal().sessions.find((x) => x.id === b.dataset.open);
    if (!s) return;
    // в «Сеансе» есть незаписанные показания: открыть другой сеанс — только повторным нажатием
    if (bridge.unsaved?.() && !b.dataset.armed) {
      b.dataset.armed = '1';
      b.classList.add('danger-armed');
      b.textContent = L('В «Сеансе» есть незаписанные показания — нажмите ещё раз', 'The Session tab has unrecorded readings: click again');
      setTimeout(() => {
        if (!b.isConnected || !b.dataset.armed) return;
        delete b.dataset.armed;
        b.classList.remove('danger-armed');
        b.textContent = L('Открыть', 'Open');
      }, 4000);
      return;
    }
    delete b.dataset.armed;
    bridge.openSession(s);
  });
  onJournal(({ source }) => {
    if (source.endsWith(':input') && source !== 'equipment:input') return;
    render();
  });
  document.addEventListener('langchange', render);
  // график перестраивается по ширине
  let w = 0;
  new ResizeObserver(() => {
    const box = $('#hs-chart');
    if (!box || box.clientWidth === w || !box.clientWidth) return;
    w = box.clientWidth;
    renderChart(seriesOf(getJournal()));
  }).observe($('#hs-chart'));
}
