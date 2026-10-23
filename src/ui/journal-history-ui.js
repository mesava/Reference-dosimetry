// Вкладка «Журнал и тренды»: записи аппарата, тренд отклонения выхода от номинала по пучкам, контрольная карта
// пучка и общая часть сеансов (journal-spc-ui.js), k_pol и k_s по калибровкам, сроки калибровки, выгрузка в CSV.
import { L } from '../core/i18n.js';
import { trendSeries, machineOf, equipmentDue, equipmentNoDue, dayNumber, beamKind } from '../core/journal.js';
import { $, esc, fmt, fmtSigned, today, makeStatus, armButton, notifyUpdate, richText, downloadText, copyText, printToPdf } from './common.js';
import { sessionReportText } from './journal-report.js';
import { scatterChart, legendSwatch } from './chart.js';
import { getJournal, updateJournal, onJournal } from './journal-store.js';
import { renderSpc, renderCommon, spcMessages, renderChecks, checkSignalMessages } from './journal-spc-ui.js';
import { journalCsv, checksCsv, csvFileName } from '../core/journal-csv.js';
import { setupFilePanel, machineOptions, fmtDate, countWord, dayToIso, monthLabel, monthTicks } from './journal-common.js';

const ROOT = () => $('#module-history');
let setStatus = () => {};
let machineId = '';
let kindFilter = 'photon'; // какие пучки показывать, если у аппарата их несколько видов (фотоны, электроны, ⁶⁰Co)
let kindChosen = false; // вид выбран переключателем (до смены аппарата)
let spcBeamId = ''; // пучок контрольной карты
let commonRes = null; // общая часть записей показанного вида
let checkKey = ''; // пара камер «Контроля дозиметра»
let checkRes = null; // её карта и оценка стабильности
/** Ряды трендов выбранного аппарата и вида пучков; переключатель вида — только если у аппарата их несколько. */
function seriesOf(j) {
  const all = trendSeries(j, machineId);
  const kinds = new Set(all.map((s) => s.kind));
  if (!kindChosen || !kinds.has(kindFilter)) {
    // сначала вид, у которого есть сеансы; у аппарата ⁶⁰Co — пучки ⁶⁰Co
    const order = machineOf(j, machineId)?.kind === 'cobalt' ? ['cobalt', 'photon', 'electron'] : ['photon', 'electron', 'cobalt'];
    const withData = new Set(all.filter((s) => s.points.length).map((s) => s.kind));
    kindFilter = order.find((k) => withData.has(k)) ?? order.find((k) => kinds.has(k)) ?? 'photon';
  }
  $('#hs-kind-field').hidden = kinds.size < 2;
  for (const k of ['photon', 'electron', 'cobalt']) {
    const r = document.getElementById(`hs_kind_${k}`);
    if (!r) continue;
    r.closest('label').hidden = !kinds.has(k);
    r.checked = k === kindFilter;
  }
  return all.filter((s) => s.kind === kindFilter);
}
let bridge = { openInTab: () => {}, toBudget: () => {} };
/** openInTab(kind, form, title) — записанный пучок во вкладке дозиметрии (для просмотра); toBudget(u, text) — в бюджет неопределённости. */
export const setHistoryBridge = (b) => (bridge = { ...bridge, ...b });

function renderChart(series) {
  const box = $('#hs-chart');
  const legend = $('#hs-legend');
  const withData = series.filter((s) => s.points.some((p) => Number.isFinite(p.deviation)));
  if (!withData.length) {
    box.innerHTML = `<p class="chart-empty">${esc(kindFilter === 'cobalt' ? L('График появится, когда в журнале будут записи этого аппарата со значением для сравнения: после первой калибровки или со значением из «Оборудования».', 'The plot appears once the journal has records of this machine with a comparison value: after the first calibration or with the value from Equipment.') : L('График появится, когда в журнале будут записи этого аппарата с номинальным выходом.', 'The plot appears once the journal has records of this machine with a nominal output.'))}</p>`;
    legend.innerHTML = '';
    return;
  }
  const cls = (i) => `t${(i % 8) + 1}`;
  const all = withData.flatMap((s) => s.points.filter((p) => Number.isFinite(p.deviation)));
  const tol = Math.max(...all.map((p) => p.tol).filter(Number.isFinite), 2);
  const days = all.map((p) => p.day);
  const x0 = Math.min(...days);
  const x1 = Math.max(...days);
  const co = kindFilter === 'cobalt';
  const spec = {
    label: co ? L('Отклонение мощности дозы от ожидаемой по датам записей', 'Dose rate deviation from the expected value by record date') : L('Отклонение выхода от номинала по датам записей', 'Output deviation from nominal by record date'),
    xLabel: L('Дата измерения', 'Measurement date'),
    yLabel: co ? L('Отклонение от ожидаемой, %', 'Deviation from expected, %') : L('Отклонение от номинала, %', 'Deviation from nominal, %'),
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
        .map((s) => `<tr><td>${esc(fmtDate(s.date))}</td><td>${esc(s.mode === 'cal' ? L('калибровка', 'calibration') : L('проверка', 'check'))}</td>${beams.map((b) => `<td class="v">${cell(s, b, (x) => (x.ok ? `${fmt(x.value, kindFilter === 'cobalt' ? 2 : 4)}<br><small class="${x.status === 'out' ? 'st-out' : ''}">${Number.isFinite(x.deviation) ? `${fmtSigned(x.deviation, 2)} %` : ''}</small>` : '—'))}</td>`).join('')}</tr>`)
        .join('')}</tbody></table><p class="sub-hint">${esc(kindFilter === 'cobalt' ? L('В ячейке: мощность дозы, сГр/мин (на z_max или z_ref — где задано значение для сравнения), и отклонение от ожидаемой.', 'In each cell: the dose rate, cGy/min (at z_max or z_ref, where the comparison value is given), and the deviation from the expected value.') : L('В ячейке: доза в точке номинала, Гр на 100 МЕ, и отклонение от номинала.', 'In each cell: the dose at the nominal point, Gy per 100 MU, and the deviation from nominal.'))}</p>`
    : `<p class="sub-hint">${esc(L('Записей этого аппарата нет.', 'No records for this machine.'))}</p>`;
  // k_pol и k_s по калибровкам
  const cals = shown.filter((s) => s.mode === 'cal');
  const kHead = `<tr><th>${esc(L('Калибровка', 'Calibration'))}</th>${beams.map((b) => `<th class="v">${esc(b.name)}</th>`).join('')}</tr>`;
  $('#hs-ktable').innerHTML = cals.length
    ? `<table class="factors"><thead>${kHead}</thead><tbody>${cals
        .slice()
        .reverse()
        .map((s) => `<tr><td>${esc(fmtDate(s.date))}</td>${beams.map((b) => `<td class="v">${cell(s, b, (x) => (Number.isFinite(x.kpolRaw) ? `${fmt(x.kpolRaw, 4)}<br>${fmt(x.ksRaw, 4)}${kindFilter === 'cobalt' ? `<br>${Number.isFinite(x.tauMin) ? `${fmtSigned(x.tauMin * 60, 2)} ${esc(L('с', 's'))}` : '—'}` : ''}` : '—'))}</td>`).join('')}</tr>`)
        .join('')}</tbody></table><p class="sub-hint">${richText(kindFilter === 'cobalt'
          ? L('В ячейке: k_pol (сверху), k_s и ошибка таймера τ в секундах, измеренные при калибровке. Их изменение от калибровки к калибровке — ранний признак неполадки камеры, кабеля, электрометра или привода источника.', 'In each cell: k_pol (top), k_s and the timer error τ in seconds, measured at the calibration. A change between calibrations is an early sign of a problem with the chamber, cable, electrometer or source drive.')
          : L('В ячейке: k_pol (сверху) и k_s, измеренные при калибровке. Их изменение от калибровки к калибровке — ранний признак неполадки камеры, кабеля или электрометра.', 'In each cell: k_pol (top) and k_s measured at the calibration. A change between calibrations is an early sign of a problem with the chamber, cable or electrometer.'))}</p>`
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
          const beamLines = bs
            .map((b) => {
              const name = m?.beams.find((x) => x.id === b.beamId)?.name || '—';
              const x = b.summary;
              const co = beamKind(b) === 'cobalt';
              const val = x.ok ? `${fmt(x.value, co ? 2 : 4)}${Number.isFinite(x.deviation) ? ` (${fmtSigned(x.deviation, 2)} %)` : ''}` : '—';
              return `<li class="${x.status === 'out' ? 'st-out' : ''}"><span>${esc(name)}: ${esc(val)}</span>${b.form ? `<button type="button" class="link-btn" data-open-beam="${esc(s.id)}|${esc(b.beamId)}">${esc(L('Открыть во вкладке', 'Open in the tab'))}</button>` : ''}</li>`;
            })
            .join('');
          return `<li><div><b>${esc(fmtDate(s.date))}</b> · ${esc(s.mode === 'cal' ? L('калибровка', 'calibration') : L('проверка выхода', 'output check'))} · ${esc(L(`пучков: ${bs.length}`, `beams: ${bs.length}`))}${(s.checks || []).length ? ` · ${esc(L(`проверок второй камерой: ${s.checks.length}`, `second-chamber checks: ${s.checks.length}`))}` : ''}${out.length ? ` · <span class="st-out">${esc(L(`вне допуска: ${out.join(', ')}`, `out of tolerance: ${out.join(', ')}`))}</span>` : ''}${s.staff?.some((x) => x.trim()) ? `<br><small>${esc(s.staff.filter((x) => x.trim()).join(', '))}</small>` : ''}</div>
            <ul class="jsess-beams">${beamLines}</ul>
            ${s.spcRestart ? `<small class="chip">${esc(L('с этой записи — новый отсчёт контрольной карты', 'a new control-chart count starts here'))}</small>` : ''}
            <div class="row-tools"><button type="button" class="link-btn" data-report="${esc(s.id)}">${esc(L('Протокол', 'Report'))}</button><button type="button" class="link-btn" data-spc-restart="${esc(s.id)}" title="${esc(L('Например, после ремонта или замены узла ускорителя без записанной подстройки: до и после — разные процессы.', 'For example, after a repair or replacement of a linac part without a recorded adjustment: before and after are different processes.'))}">${esc(s.spcRestart ? L('Убрать новый отсчёт карты', 'Remove the new chart count') : L('Новый отсчёт карты', 'New chart count'))}</button><button type="button" class="link-btn danger" data-del-session="${esc(s.id)}">${esc(L('Удалить', 'Delete'))}</button></div></li>`;
        })
        .join('')}</ul>`
    : `<p class="sub-hint">${esc(L('Записей пока нет: выберите пучок журнала во вкладке «⁶⁰Co», «МВ фотоны» или «Электроны» (раздел 1), измерьте и нажмите «Записать в журнал».', 'No records yet: select a journal beam in the ⁶⁰Co, MV photons or Electrons tab (section 1), measure and click "Record to journal".'))}</p>`;
  for (const btn of $('#hs-sessions').querySelectorAll('[data-del-session]')) {
    armButton(btn, btn.textContent, () => L('Удалить запись?', 'Delete the record?'), () => {
      updateJournal((jj) => ({ ...jj, sessions: jj.sessions.filter((x) => x.id !== btn.dataset.delSession) }), 'history');
      setStatus(L('Запись удалена из журнала. Сохраните журнал в файл.', 'The record has been deleted from the journal. Save the journal to the file.'));
    });
  }
}

/** Проверки аппарата в пластинах (не референсные условия): таблица по датам; без проверок — одна строка. */
function renderPlates(j) {
  const m = machineOf(j, machineId);
  const rows = (j.plateChecks || []).filter((x) => x.machineId === machineId).slice().reverse();
  // раздел виден всегда: номера разделов не скачут
  $('#hs-plates-sec').hidden = false;
  if (!rows.length) {
    $('#hs-plates').innerHTML = `<p class="chart-empty">${esc(L('Проверок этого аппарата в пластинах пока нет: «Дозиметрия» → «В пластинах».', 'There are no checks of this machine in plates yet: Dosimetry → In plates.'))}</p>`;
    return;
  }
  const name = (id) => m?.beams.find((b) => b.id === id)?.name || '—';
  const co = (id) => beamKind(m?.beams.find((b) => b.id === id)) === 'cobalt';
  $('#hs-plates').innerHTML = `<table class="factors"><thead><tr><th>${esc(L('Дата', 'Date'))}</th><th>${esc(L('Пучок', 'Beam'))}</th><th class="v">${esc(L('Отношение к привязке', 'Ratio to the binding'))}</th><th class="v">${esc(L('Отклонение', 'Deviation'))}</th><th>${esc(L('Привязка', 'Binding'))}</th></tr></thead><tbody>${rows
    .map((r) => `<tr class="${r.summary?.status === 'out' ? 'st-out' : ''}"><td>${esc(fmtDate(r.date))}</td><td>${esc(name(r.beamId))}</td><td class="v">${esc(fmt(r.summary?.ratio, 4))}</td><td class="v">${esc(fmtSigned(r.summary?.deviation, 2))} %${co(r.beamId) ? ` ${esc(L('от ожидаемой', 'from expected'))}` : ''}</td><td>${esc(L(`к калибровке ${fmtDate(r.binding?.calDate)}`, `to the calibration of ${fmtDate(r.binding?.calDate)}`))}</td></tr>`)
    .join('')}</tbody></table><div class="actions"><a class="link-btn" href="#plates" data-goto="plates">${esc(L('Открыть «В пластинах»', 'Open In plates'))}</a></div>`;
}

// ------------------------------------------------------------ протокол записи
let reportId = '';
function showReport(id) {
  reportId = id;
  renderReport();
  $('#hs-report')?.scrollIntoView({ block: 'start' });
}
function renderReport() {
  const box = $('#hs-report');
  if (!box) return;
  const j = getJournal();
  const s = j.sessions.find((x) => x.id === reportId);
  if (!s) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const m = machineOf(j, s.machineId);
  box.hidden = false;
  box.innerHTML = `<header><h2>${esc(L(`Протокол: ${m?.name || '—'}, ${fmtDate(s.date)}`, `Report: ${m?.name || '—'}, ${fmtDate(s.date)}`))}</h2></header>
    <pre class="jreport">${esc(sessionReportText(j, s))}</pre>
    <div class="actions no-print"><button type="button" data-rep="copy">${esc(L('Копировать протокол', 'Copy the report'))}</button><button type="button" data-rep="pdf">${esc(L('Сохранить в PDF', 'Save as PDF'))}</button><button type="button" data-rep="close">${esc(L('Закрыть', 'Close'))}</button></div>`;
}

function renderReadout(j, series) {
  const m = machineOf(j, machineId);
  const sessions = j.sessions.filter((s) => s.machineId === machineId);
  const last = sessions.at(-1);
  const lastCal = sessions.filter((s) => s.mode === 'cal').at(-1);
  const outLast = last ? last.beams.filter((b) => b.summary?.status === 'out').length : 0;
  $('#hs-result').innerHTML = `<div class="dose-row"><div class="proto"><span>${esc(m?.name || '—')}</span>${last ? (outLast ? `<span class="chip warn">${esc(L(`вне допуска: ${outLast}`, `out of tolerance: ${outLast}`))}</span>` : `<span class="chip good">${esc(L('последняя запись в допуске', 'last record within tolerance'))}</span>`) : ''}</div>
    <div class="dose-big">${sessions.length}<small>${esc(countWord(sessions.length, [L('запись', 'record'), L('записи', 'records'), L('записей', 'records')], ['record', 'records']))}</small></div>
    <div class="secondary">${esc(L(`последний: ${last ? fmtDate(last.date) : '—'}; последняя калибровка: ${lastCal ? fmtDate(lastCal.date) : '—'}`, `last: ${last ? fmtDate(last.date) : '—'}; last calibration: ${lastCal ? fmtDate(lastCal.date) : '—'}`))}</div></div>`;
  const msgs = equipmentDue(j, today()).map((d) => `<li class="${d.status === 'overdue' ? 'warn' : 'info'}"><span class="lvl">${esc(d.status === 'overdue' ? L('Срок калибровки прошёл', 'Calibration overdue') : L('Срок калибровки подходит', 'Calibration due soon'))}</span><span>${esc(`${d.text}: ${fmtDate(d.dueDate)}`)}</span></li>`);
  const noDue = equipmentNoDue(j);
  if (noDue.length) msgs.push(`<li class="info"><span class="lvl">${esc(L('Срок калибровки не задан', 'No calibration due date'))}</span><span>${esc(L(`${noDue.map((x) => x.text || (x.kind === 'chamber' ? 'камера' : 'электрометр')).join('; ')}: укажите «Действует до» в «Оборудовании», иначе напоминания о сроке калибровки не будет.`, `${noDue.map((x) => x.text || x.kind).join('; ')}: enter "Valid until" in Equipment, otherwise there will be no calibration due reminder.`))}</span></li>`);
  for (const x of [...spcMessages(j, machineId, series.map((s) => s.beam), commonRes), ...checkSignalMessages(j, machineId)]) msgs.push(`<li class="${x.level}"><span class="lvl">${esc(x.head)}</span><span>${esc(x.text)}</span></li>`);
  if (lastCal && dayNumber(today()) - dayNumber(lastCal.date) > 365) msgs.push(`<li class="info"><span class="lvl">${esc(L('Калибровка', 'Calibration'))}</span><span>${esc(L(`Последняя калибровка аппарата — больше года назад (${fmtDate(lastCal.date)}).`, `The machine's last calibration was more than a year ago (${fmtDate(lastCal.date)}).`))}</span></li>`);
  $('#hs-messages').innerHTML = msgs.join('') || `<li class="info"><span class="lvl">${esc(L('Всё в порядке', 'All clear'))}</span><span>${esc(L('Сроки калибровки камер и электрометров заданы и не подходят.', 'Chamber and electrometer calibrations are within their dates.'))}</span></li>`;
  $('#hs-mobile-value').textContent = `${m?.name || '—'}: ${sessions.length}`;
}

/** Контрольная карта выбранного пучка и общая часть записей (пучки показанного вида). */
function renderControl(j, series) {
  const beams = series.map((s) => s.beam);
  spcBeamId = renderSpc(j, machineId, beams, spcBeamId, { cobalt: kindFilter === 'cobalt' });
  commonRes = renderCommon(j, machineId, beams);
  checkRes = renderChecks(j, machineId, checkKey);
  if (checkRes) checkKey = checkRes.pair.key;
}

function render() {
  const j = getJournal();
  if (!machineOf(j, machineId)) machineId = j.machines[0]?.id ?? '';
  $('#hs_machine').innerHTML = machineOptions(j, machineId);
  const series = seriesOf(j);
  renderChart(series);
  renderControl(j, series);
  renderTables(j, series);
  renderPlates(j);
  renderReadout(j, series);
  renderReport();
  notifyUpdate(ROOT());
}

export function historyStatus(text) {
  setStatus(text);
}

export function initHistory() {
  setStatus = makeStatus($('#hs-status'));
  setupFilePanel($('#hs-file'), (t) => setStatus(t));
  render();
  $('#hs_beam').addEventListener('change', (e) => {
    spcBeamId = e.target.value;
    renderSpc(getJournal(), machineId, seriesOf(getJournal()).map((s) => s.beam), spcBeamId, { cobalt: kindFilter === 'cobalt' });
  });
  $('#hs_check').addEventListener('change', (e) => {
    checkKey = e.target.value;
    checkRes = renderChecks(getJournal(), machineId, checkKey);
  });
  $('#hs-check-unc').addEventListener('click', () => {
    if (!checkRes || !Number.isFinite(checkRes.cc.u)) return;
    bridge.toBudget(checkRes.cc.u, checkRes.note);
  });
  $('#hs-check-csv').addEventListener('click', () => {
    const j = getJournal();
    downloadText(checksCsv(j), csvFileName(j, new Date(), L('проверки_дозиметра', 'dosimeter_checks')), 'text/csv;charset=utf-8');
    setStatus(L('Проверки дозиметра выгружены в CSV.', 'The dosimeter checks have been exported to CSV.'));
  });
  $('#hs-csv').addEventListener('click', () => {
    const j = getJournal();
    if (!j.sessions.length) {
      setStatus(L('В журнале нет записей — выгружать нечего.', 'The journal has no records: nothing to export.'));
      return;
    }
    downloadText(journalCsv(j), csvFileName(j), 'text/csv;charset=utf-8');
    setStatus(L('Журнал выгружен в CSV: файл открывается в Excel двойным щелчком.', 'The journal has been exported to CSV: the file opens in Excel with a double click.'));
  });
  $('#hs_machine').addEventListener('change', (e) => {
    machineId = e.target.value;
    kindChosen = false;
    render();
  });
  for (const r of document.querySelectorAll('input[name="hs_kind"]')) {
    r.addEventListener('change', () => {
      kindFilter = ['electron', 'cobalt'].includes(r.value) ? r.value : 'photon';
      kindChosen = true;
      render();
    });
  }
  $('#hs-report').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rep]');
    if (!b) return;
    const j = getJournal();
    const s = j.sessions.find((x) => x.id === reportId);
    if (b.dataset.rep === 'close' || !s) {
      reportId = '';
      renderReport();
      return;
    }
    if (b.dataset.rep === 'copy') copyText(sessionReportText(j, s), L('Протокол скопирован.', 'The report has been copied.'), setStatus);
    else {
      // печатается только протокол (styles.css: body.print-hs-report)
      document.body.classList.add('print-hs-report');
      const off = () => {
        document.body.classList.remove('print-hs-report');
        window.removeEventListener('afterprint', off);
      };
      window.addEventListener('afterprint', off);
      printToPdf([L('Протокол', 'Report'), machineOf(j, s.machineId)?.name, s.date].filter(Boolean).join('_'), setStatus);
    }
  });
  $('#hs-sessions').addEventListener('click', (e) => {
    const r = e.target.closest('[data-spc-restart]');
    if (r) {
      const id = r.dataset.spcRestart;
      const on = !getJournal().sessions.find((x) => x.id === id)?.spcRestart;
      updateJournal((jj) => ({ ...jj, sessions: jj.sessions.map((x) => (x.id === id ? { ...x, spcRestart: on } : x)) }), 'history');
      setStatus(on ? L('С этой записи контрольная карта начинает новый отсчёт.', 'The control chart starts a new count from this record.') : L('Отметка нового отсчёта снята.', 'The new count mark has been removed.'));
      return;
    }
    const ob = e.target.closest('[data-open-beam]');
    if (ob) {
      const [sid, bid] = ob.dataset.openBeam.split('|');
      const jj = getJournal();
      const s = jj.sessions.find((x) => x.id === sid);
      const b = s?.beams.find((x) => x.beamId === bid);
      if (!b?.form) return;
      const m = machineOf(jj, s.machineId);
      const name = m?.beams.find((x) => x.id === bid)?.name || '—';
      bridge.openInTab(beamKind(b), b.form, `${m?.name || '—'} — ${name}, ${fmtDate(s.date)}`);
      return;
    }
    const rb = e.target.closest('[data-report]');
    if (rb) showReport(rb.dataset.report);
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
    const series = seriesOf(getJournal());
    renderChart(series);
    renderControl(getJournal(), series);
  }).observe($('#hs-chart'));
}
