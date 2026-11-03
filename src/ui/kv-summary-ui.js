// Вкладка «kV-рентген», лист «Сводка и протокол» (с 0.45.0): таблица мощности дозы «аппликатор × режим» (как форма
// «Сводная» учреждения) и протокол измерений (как форма «Протокол измерений»): шапка, проверка радиационного выхода
// с решением о калибровке, итоги листов СПО, ошибки таймера, линейности и воспроизводимости, подписи. Протокол
// печатается отдельно от рабочего листа (body.print-kv-protocol, styles.css). Данные — core/kv-summary.js.
import { L, getLang } from '../core/i18n.js';
import { kvOutputRows, kvDoseMatrix, kvClimate, kvSheetChecks } from '../core/kv-summary.js';
import { hvlDecimals } from '../core/kv-hvl.js';
import { PRESSURE_UNITS, unitLabel } from '../core/units.js';
import { $, esc, fmt, fmtSigned, versionText, dateText, printToPdf } from './common.js';

let api = null;

const str = (v) => (v === undefined || v === null ? '' : String(v)).trim();
const tolText = (x) => fmt(x, Number.isInteger(x) ? 0 : Math.round(x * 10) === x * 10 ? 1 : 2);
/** «21,0–21,8» или «21,0»; NaN — пусто. */
const span = (s, d) => (!Number.isFinite(s.min) ? '' : s.min === s.max ? fmt(s.min, d) : `${fmt(s.min, d)}–${fmt(s.max, d)}`);
const whereText = (w) => (w === 'surface' ? L('поверхность', 'surface') : L('2 г/см²', '2 g/cm²'));
const atText = (b) => (b.range === 'low' ? L('на поверхности', 'at the surface') : b.at === 'zref' ? L('на глубине 2 г/см²', 'at a depth of 2 g/cm²') : L('на поверхности (по PDD(2 см))', 'at the surface (from PDD(2 cm))'));
const rangeText = (r) => (r === 'low' ? L('Низкие энергии', 'Low energies') : L('Средние энергии', 'Medium energies'));
const appText = (a) => `${esc(a.label || '—')}${a.ssd ? `<small>${esc(L(`РИП ${a.ssd} см`, `SSD ${a.ssd} cm`))}</small>` : ''}`;
const VERDICT = () => ({
  ok: L('не требуется', 'not required'),
  over: L('требуется', 'required'),
  nobase: L('нет базового значения', 'no baseline'),
  na: L('сравнить не с чем', 'nothing to compare'),
  error: L('доза не вычислена', 'dose not calculated'),
});

// ------------------------------------------------------------ «Сводная»: мощность дозы по аппликаторам и режимам
function renderMatrix(visit, blocks) {
  const box = $('#kv-svd');
  // без строк с показаниями таблица в печать не идёт
  box.closest('section').classList.toggle('no-print', !blocks.length);
  if (!blocks.length) {
    box.innerHTML = `<p class="sub-hint">${esc(L('Пока нет строк аппликаторов с показаниями (лист «Поглощённая доза»).', 'No applicator rows with readings yet (the Absorbed dose sheet).'))}</p>`;
    return;
  }
  box.innerHTML = blocks
    .map((b) => {
      const unit = b.unit ? `, ${esc(b.unit)}` : '';
      const head = b.modes
        .map((m) => {
          const name = api.modeName(m);
          const u = b.unit ? '' : `<small>${esc(b.units[m])}</small>`;
          return `<th class="v" scope="col"><button type="button" class="kv-svd-mode" data-m="${m}" title="${esc(L('Открыть режим на листе «Поглощённая доза»', 'Open the mode on the Absorbed dose sheet'))}">${m + 1}</button> ${esc(name)}${u}</th>`;
        })
        .join('');
      const body = b.apps
        .map((a) => {
          const tds = b.modes
            .map((m) => {
              const c = b.cells[`${m}|${a.key}`];
              if (!c) return '<td class="v empty">—</td>';
              const cls = c.verdict === 'over' ? ' bad' : c.verdict === 'ok' ? ' good' : '';
              const dev = Number.isFinite(c.dev) ? `<small class="dev${cls}">${fmtSigned(c.dev, 2)} %</small>` : '';
              const v = Number.isFinite(c.D) ? fmt(c.D, 4) : '—';
              return `<td class="v"><button type="button" class="kv-svd-cell" data-m="${m}" data-i="${c.i}" title="${esc(L(`Открыть режим ${m + 1}, строку ${c.i + 1}`, `Open mode ${m + 1}, row ${c.i + 1}`))}">${v}</button>${dev}</td>`;
            })
            .join('');
          return `<tr><th scope="row" class="app">${appText(a)}</th>${tds}</tr>`;
        })
        .join('');
      return `<div class="kv-svd-block">
        <h4 class="series-head">${esc(rangeText(b.range))} — ${esc(atText(b))}${unit}</h4>
        <div class="table-wrap"><table class="factors kv-svd-t">
          <thead><tr><th scope="col">${esc(L('Аппликатор', 'Applicator'))}</th>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table></div>
      </div>`;
    })
    .join('');
}

// ------------------------------------------------------------ протокол измерений
const headRow = (k, v) => (v ? `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>` : '');

function devicesHtml(visit, vr) {
  const used = [...new Set(visit.modes.map((md) => md.chamber))].sort((a, b) => a - b);
  const items = used.map((j) => {
    const ch = visit.chambers[j];
    const modes = visit.modes.map((md, m) => (md.chamber === j ? m + 1 : 0)).filter(Boolean);
    const el = [str(ch?.kv_el_model), str(ch?.kv_el_serial) ? L(`№ ${str(ch.kv_el_serial)}`, `S/N ${str(ch.kv_el_serial)}`) : ''].filter(Boolean).join(' ');
    const who = used.length > 1 || visit.modes.length > 1 ? L(` (режим${modes.length > 1 ? 'ы' : ''} ${modes.join(', ')})`, ` (mode${modes.length > 1 ? 's' : ''} ${modes.join(', ')})`) : '';
    return esc(L(`камера ${api.chamberName(j)}${el ? `, электрометр ${el}` : ''}${who}`, `chamber ${api.chamberName(j)}${el ? `, electrometer ${el}` : ''}${who}`));
  });
  const phantoms = [...new Set(vr.modes.flatMap((mr) => mr.results.map((r) => r.phantom?.clin?.name).filter(Boolean)))];
  if (phantoms.length) items.push(esc(L(`фантом: ${phantoms.join('; ')}`, `phantom: ${phantoms.join('; ')}`)));
  return items.join('<br>');
}

function methodHtml(visit, vr) {
  const ranges = [...new Set(vr.modes.flatMap((mr) => mr.results.map((r) => r.range)))];
  const sec = ranges.map((r) => (r === 'low' ? L('разд. 8 (низкие энергии)', 'Sec. 8 (low energies)') : L('разд. 9 (средние энергии)', 'Sec. 9 (medium energies)'))).join(L(' и ', ' and '));
  const own = str(visit.common.kv_method);
  return esc([L(`TRS-398 Rev.1 (МАГАТЭ, 2024), ${sec}`, `TRS-398 Rev.1 (IAEA, 2024), ${sec}`), own].filter(Boolean).join('; '));
}

/** Таблица проверки выхода: строки по режимам, режим — объединённой ячейкой. */
function outputTable(visit, rows) {
  const V = VERDICT();
  const units = [...new Set(rows.map((r) => r.unit))];
  const u = units.length === 1 ? `, ${esc(units[0])}` : '';
  const byMode = new Map();
  for (const r of rows) byMode.set(r.m, [...(byMode.get(r.m) ?? []), r]);
  const body = [...byMode.entries()]
    .map(([m, rs]) =>
      rs
        .map((r, k) => {
          const cls = r.verdict === 'over' ? ' bad' : r.verdict === 'ok' ? ' good' : '';
          const du = u ? '' : ` <small>${esc(r.unit)}</small>`;
          return `<tr${k === 0 ? ' class="grp"' : ''}>
            ${k === 0 ? `<td class="mode" rowspan="${rs.length}">${m + 1}. ${esc(api.modeName(m))}</td>` : ''}
            <td>${esc(r.label || '—')}${r.std ? ` <span class="kv-std">${L('ст.', 'ref.')}</span>` : ''}</td>
            <td class="v">${esc(r.ssd || '—')}</td>
            <td>${esc(whereText(r.where))}</td>
            <td class="v">${esc(r.baseRaw || '—')}</td>
            <td class="v">${Number.isFinite(r.D) ? fmt(r.D, 4) : '—'}${du}</td>
            <td class="v">±${tolText(r.tol)}</td>
            <td class="v${cls}">${Number.isFinite(r.dev) && r.verdict !== 'error' ? fmtSigned(r.dev, 2) : '—'}</td>
            <td class="verdict${cls}">${esc(V[r.verdict])}</td>
          </tr>`;
        })
        .join(''),
    )
    .join('');
  return `<table class="kv-prot-t kv-prot-out">
    <thead><tr><th>${esc(L('Режим', 'Mode'))}</th><th>${esc(L('Аппликатор', 'Applicator'))}</th><th class="v">${esc(L('РИП, см', 'SSD, cm'))}</th><th>${esc(L('Глубина', 'Depth'))}</th>
      <th class="v">D<sub>${L('баз', 'base')}</sub>${u}</th><th class="v">D<sub>${L('изм', 'meas')}</sub>${u}</th><th class="v">${esc(L('Допуск, %', 'Tolerance, %'))}</th><th class="v">${esc(L('Отклонение, %', 'Deviation, %'))}</th><th>${esc(L('Калибровка', 'Calibration'))}</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

const table = (heads, rows) =>
  `<table class="kv-prot-t"><thead><tr>${heads.map(([h, v]) => `<th${v ? ' class="v"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
const res = (bad, ok, txt) => `<td class="verdict${bad ? ' bad' : ok ? ' good' : ''}">${esc(txt)}</td>`;

function hvlTable(visit, vr, list) {
  const rows = list.map((h) => {
    const r = vr.modes[h.m].results[visit.modes[h.m].active] ?? vr.modes[h.m].results[0];
    const u = h.mat === 'Cu' ? L('мм Cu', 'mm Cu') : L('мм Al', 'mm Al');
    const meas = h.ok ? `${fmt(h.used, hvlDecimals(h.used))} ± ${fmt(h.U, h.U < 0.01 ? 4 : 3)}` : L('не вычислен', 'not calculated');
    const inCalc = Number.isFinite(r.inputs?.hvl) ? `${fmt(r.inputs.hvl, hvlDecimals(r.inputs.hvl))} (${r.inputs.hvlSource === 'measured' ? L('измеренный', 'measured') : L('номинальный', 'nominal')})` : '—';
    const kq = Number.isFinite(r.cert?.value) ? fmt(r.cert.value, r.form?.kv_cert_form === 'n' ? 6 : 4) : '—';
    return `<tr><td>${h.m + 1}. ${esc(api.modeName(h.m))}</td><td class="v">${esc(h.nominal || '—')} ${esc(u)}</td><td class="v">${meas} ${esc(u)}</td><td class="v">${esc(inCalc)}</td><td class="v">${kq}</td></tr>`;
  });
  return table([[esc(L('Режим', 'Mode'))], [esc(L('СПО номинальный', 'Nominal HVL')), 1], [esc(L('СПО измеренный ± U (k = 2)', 'Measured HVL ± U (k = 2)')), 1], [esc(L('СПО в расчёте', 'HVL used')), 1], ['k<sub>Q</sub>', 1]], rows);
}

function timerTable(list) {
  const rows = list.map((t) => {
    const time = t.unit === 'min' || t.unit === 's';
    const v = time ? `${fmtSigned(t.tauS, 2)} ${L('с', 's')}` : fmtSigned(t.tau, 3);
    const tol = Number.isFinite(t.tol) && t.tol ? `${tolText(t.tol)} ${L('с', 's')}` : '—';
    const txt = !t.ok ? L('τ не вычислена', 'τ not calculated') : !t.tol ? L('допуск не задан', 'no tolerance set') : t.inTol ? L('в допуске', 'within tolerance') : L('больше допуска', 'exceeds tolerance');
    return `<tr><td>${t.m + 1}. ${esc(api.modeName(t.m))}</td><td class="v">${t.ok ? v : '—'}</td><td class="v">${tol}</td>${res(t.ok && t.tol && !t.inTol, t.ok && t.tol && t.inTol, txt)}</tr>`;
  });
  return table([[esc(L('Режим', 'Mode'))], ['τ', 1], [esc(L('Допуск |τ|', 'Tolerance |τ|')), 1], [esc(L('Результат', 'Result'))]], rows);
}

function lnTable(list, tol) {
  const rows = list.map((a) => {
    const u = a.unit ? L(a.unit.label, a.unit.labelEn) : '';
    const q = a.q.length ? `${a.q.map((x) => fmt(x, Number.isInteger(x) ? 0 : x * 10 === Math.round(x * 10) ? 1 : 2)).join('; ')} ${esc(u)}` : '—';
    const d = a.ok && a.dMax >= 0 ? `${fmt(a.dMax * 100, 2)} %` : '—';
    const cl = a.ok && a.clMax >= 0 ? fmt(a.clMax, 4) : '—';
    const has = Number.isFinite(tol.d) || Number.isFinite(tol.cl);
    const bad = a.dOver || a.clOver;
    const txt = !a.ok || a.dMax < 0 ? L('не вычислена', 'not calculated') : !has ? L('допуск не задан', 'no tolerance set') : bad ? L('больше допуска', 'exceeds tolerance') : L('в допуске', 'within tolerance');
    return `<tr><td>${a.m + 1}. ${esc(api.modeName(a.m))}</td><td class="v">${q}</td><td class="v">${d}</td><td class="v">${cl}</td>${res(bad, a.ok && a.dMax >= 0 && has && !bad, txt)}</tr>`;
  });
  return table([[esc(L('Режим', 'Mode'))], [esc(L('Задания', 'Settings')), 1], [esc(L('Отклонение от пропорциональности', 'Deviation from proportionality')), 1], [esc(L('CL наибольший', 'Largest CL')), 1], [esc(L('Результат', 'Result'))]], rows);
}

function rpTable(list, tol) {
  const rows = list.map((b) => {
    const has = Number.isFinite(tol);
    const txt = !b.ok ? L('не вычислена', 'not calculated') : !has ? L('допуск не задан', 'no tolerance set') : b.over ? L('больше допуска', 'exceeds tolerance') : L('в допуске', 'within tolerance');
    return `<tr><td>${b.m + 1}. ${esc(api.modeName(b.m))}</td><td class="v">${b.n ?? '—'}</td><td class="v">${b.ok ? `${fmt(b.R * 100, 2)} %` : '—'}</td><td class="v">${b.ok ? `${fmt(b.cv * 100, 2)} %` : '—'}</td>${res(b.over, b.ok && has && !b.over, txt)}</tr>`;
  });
  return table([[esc(L('Режим', 'Mode'))], ['n', 1], ['R = |1 − K<sub>min</sub>/K<sub>max</sub>|', 1], ['s/M̄', 1], [esc(L('Результат', 'Result'))]], rows);
}

/** Заключение: что вне допуска; пусто — проверок нет. */
function conclusion(visit, rows, ch) {
  const out = [];
  const over = rows.filter((r) => r.verdict === 'over');
  if (over.length) {
    const list = over.map((r) => L(`режим ${r.m + 1}, ${r.label || '—'} (${fmtSigned(r.dev, 2)} %)`, `mode ${r.m + 1}, ${r.label || '—'} (${fmtSigned(r.dev, 2)} %)`)).join('; ');
    out.push(L(`Радиационный выход вне допуска — требуется калибровка: ${list}.`, `Radiation output outside tolerance, calibration required: ${list}.`));
  } else if (rows.some((r) => r.verdict === 'ok')) out.push(L('Радиационный выход в допуске у всех аппликаторов с базовым значением: калибровка не требуется.', 'Radiation output within tolerance for all applicators with a baseline: no calibration required.'));
  const nb = rows.filter((r) => r.verdict === 'nobase').length;
  if (nb) out.push(L(`Без базового значения: ${nb} — их мощность дозы может стать базовой.`, `Without a baseline: ${nb}; their dose rates may become the baseline.`));
  const modes = (a) => a.map((x) => x.m + 1).join(', ');
  const tm = ch.timer.filter((t) => t.ok && t.tol && !t.inTol);
  if (tm.length) out.push(L(`Ошибка таймера больше допуска: режим ${modes(tm)}.`, `Timer error exceeds tolerance: mode ${modes(tm)}.`));
  const ln = ch.ln.filter((a) => a.dOver || a.clOver);
  if (ln.length) out.push(L(`Линейность вне допуска: режим ${modes(ln)}.`, `Linearity outside tolerance: mode ${modes(ln)}.`));
  const rp = ch.rp.filter((b) => b.over);
  if (rp.length) out.push(L(`Воспроизводимость вне допуска: режим ${modes(rp)}.`, `Reproducibility outside tolerance: mode ${modes(rp)}.`));
  return out;
}

function signHtml(visit) {
  const staff = (visit.common.kv_staff ?? []).map(str).filter(Boolean);
  const line = (role, name) =>
    `<tr><th scope="row">${esc(role)}</th><td class="sig-name">${esc(name) || '&nbsp;'}</td><td class="sig-gap"></td><td class="sig-line">&nbsp;</td></tr>
    <tr class="sig-cap"><th></th><td>${esc(L('должность, ФИО', 'position, name'))}</td><td class="sig-gap"></td><td>${esc(L('подпись', 'signature'))}</td></tr>`;
  const rows = [
    ...(staff.length ? staff : ['']).map((n, k) => line(k === 0 ? L('Измерения провёл', 'Measured by') : '', n)),
    line(L('Протокол проверил', 'Checked by'), str(visit.common.kv_checker)),
  ];
  return `<table class="kv-prot-sign"><tbody>${rows.join('')}</tbody></table>`;
}

function renderProtocol(visit, vr, rows) {
  const box = $('#kv-prot');
  const c = visit.common;
  const ch = kvSheetChecks(visit, vr, rows);
  const cl = kvClimate(visit);
  const pU = unitLabel(PRESSURE_UNITS[cl.pUnit]);
  const pD = cl.pUnit === 'kPa' ? 2 : 1;
  const climate = [
    span(cl.T, 1) && `T ${span(cl.T, 1)} °C`,
    span(cl.H, 0) && L(`относительная влажность ${span(cl.H, 0)} %`, `relative humidity ${span(cl.H, 0)} %`),
    span(cl.P, pD) && `P ${span(cl.P, pD)} ${pU}`,
  ].filter(Boolean).join('; ');
  const head = `<table class="kv-prot-head"><tbody>
    ${headRow(L('Дата', 'Date'), esc(str(c.kv_date) ? dateText(str(c.kv_date)) : '—'))}
    ${headRow(L('Учреждение', 'Institution'), esc(str(c.kv_institution) || '—'))}
    ${headRow(L('Аппарат', 'Unit'), esc(str(c.kv_machine) || '—'))}
    ${headRow(L('Условия измерений', 'Conditions'), esc(climate || '—'))}
    ${headRow(L('Средства измерений', 'Measuring equipment'), devicesHtml(visit, vr) || '—')}
    ${headRow(L('Методика измерений', 'Method'), methodHtml(visit, vr))}
  </tbody></table>`;
  const parts = [head];
  let n = 0;
  const sec = (title, body, note = '') => {
    n += 1;
    parts.push(`<h4 class="kv-prot-h">${n}. ${title}</h4>${body}${note ? `<p class="kv-prot-note">${note}</p>` : ''}`);
  };
  if (rows.length) {
    sec(
      esc(L('Проверка радиационного выхода (мощность дозы в воде)', 'Radiation output check (dose rate in water)')),
      outputTable(visit, rows),
      L(
        'Отклонение = D<sub>изм</sub>/D<sub>баз</sub> − 1. D<sub>баз</sub> — значение для сравнения строки (при вводе в эксплуатацию или предыдущей калибровке); допуск — по методике учреждения (в TRS-398 Rev.1 его нет). Вне допуска — требуется калибровка.',
        'Deviation = D<sub>meas</sub>/D<sub>base</sub> − 1. D<sub>base</sub> is the comparison value of the row (commissioning or the previous calibration); the tolerance follows the local procedure (TRS-398 Rev.1 has none). Outside tolerance, calibration is required.',
      ),
    );
  }
  if (ch.hvl.length) sec(L('Слой половинного ослабления и k<sub>Q</sub>', 'Half-value layer and k<sub>Q</sub>'), hvlTable(visit, vr, ch.hvl), L('СПО — TRS-398 Rev.1, разд. 8.3.2 и 9.3.2; k<sub>Q</sub> — по сертификату камеры режима.', 'HVL: TRS-398 Rev.1, Sec. 8.3.2 and 9.3.2; k<sub>Q</sub> from the certificate of the mode chamber.'));
  if (ch.timer.length) sec(esc(L('Ошибка таймера', 'Timer error')), timerTable(ch.timer), esc(L('Допуск — по методике учреждения.', 'Tolerance: local procedure.')));
  if (ch.ln.length) {
    const t = [Number.isFinite(ch.lnTol.d) ? L(`отклонение ≤ ${tolText(ch.lnTol.d)} %`, `deviation ≤ ${tolText(ch.lnTol.d)} %`) : '', Number.isFinite(ch.lnTol.cl) ? `CL ≤ ${fmt(ch.lnTol.cl, 4).replace(/0+$/, '').replace(/[,.]$/, '')}` : ''].filter(Boolean).join('; ');
    sec(esc(L('Линейность выхода', 'Output linearity')), lnTable(ch.ln, ch.lnTol), esc(L(`Не TRS-398 Rev.1 — по методике учреждения${t ? `; допуски: ${t}` : ''}.`, `Not TRS-398 Rev.1, local procedure${t ? `; tolerances: ${t}` : ''}.`)));
  }
  if (ch.rp.length) sec(esc(L('Воспроизводимость выхода', 'Output reproducibility')), rpTable(ch.rp, ch.rpTol), esc(L(`Не TRS-398 Rev.1 — по методике учреждения${Number.isFinite(ch.rpTol) ? `; допуск R ≤ ${tolText(ch.rpTol)} %` : ''}.`, `Not TRS-398 Rev.1, local procedure${Number.isFinite(ch.rpTol) ? `; tolerance R ≤ ${tolText(ch.rpTol)} %` : ''}.`)));
  if (n === 0) parts.push(`<p class="sub-hint">${esc(L('Проверок пока нет: протокол заполнится по мере ввода на листах.', 'No checks yet: the protocol fills in as the sheets are filled.'))}</p>`);
  const concl = conclusion(visit, rows, ch);
  if (concl.length) parts.push(`<h4 class="kv-prot-h">${esc(L('Заключение', 'Conclusion'))}</h4><p>${concl.map(esc).join('<br>')}</p>`);
  const notes = str(c.kv_notes);
  if (notes) parts.push(`<h4 class="kv-prot-h">${esc(L('Примечания', 'Notes'))}</h4><p class="kv-prot-notes">${esc(notes)}</p>`);
  parts.push(signHtml(visit));
  parts.push(`<p class="kv-prot-ver">${esc(L(`Расчёт: калькулятор «Клиническая дозиметрия», ${versionText()}, https://mesava.github.io/Reference-dosimetry/`, `Calculation: Clinical Dosimetry calculator, ${versionText()}, https://mesava.github.io/Reference-dosimetry/`))}</p>`);
  box.innerHTML = parts.join('');
  box.lang = getLang();
}

/** Лист «Сводка и протокол»: сводная таблица и протокол измерений. */
export function renderSummarySheets(visit, vr) {
  const rows = kvOutputRows(visit, vr).map((r) => ({ ...r, baseRaw: str(visit.modes[r.m].rows[r.i].kv_ref) }));
  renderMatrix(visit, kvDoseMatrix(visit, vr, rows));
  renderProtocol(visit, vr, rows);
}

/** Строки протокола текстом: проверка радиационного выхода (итог по всем строкам). */
export function outputReportLines(visit, vr) {
  const rows = kvOutputRows(visit, vr);
  if (!rows.length) return [];
  const V = VERDICT();
  const out = [L('Проверка радиационного выхода (D_изм/D_баз − 1; допуск — по методике учреждения):', 'Radiation output check (D_meas/D_base − 1; tolerance: local procedure):')];
  for (const r of rows) {
    const base = str(visit.modes[r.m].rows[r.i].kv_ref);
    const d = Number.isFinite(r.D) ? `${fmt(r.D, 4)} ${r.unit} (${whereText(r.where)})` : '—';
    const dev = Number.isFinite(r.dev) && r.verdict !== 'error' ? `${fmtSigned(r.dev, 2)} %` : '—';
    out.push(L(
      `  Режим ${r.m + 1}, ${r.label || '—'}, РИП ${r.ssd || '—'} см: D_баз ${base || '—'}, D_изм ${d}, отклонение ${dev} (±${tolText(r.tol)} %); калибровка: ${V[r.verdict]}`,
      `  Mode ${r.m + 1}, ${r.label || '—'}, SSD ${r.ssd || '—'} cm: D_base ${base || '—'}, D_meas ${d}, deviation ${dev} (±${tolText(r.tol)} %); calibration: ${V[r.verdict]}`,
    ));
  }
  out.push('');
  return out;
}

/** Печать только протокола измерений (и в PDF — то же окно печати). */
function printProtocol(pdf) {
  document.body.classList.add('print-kv-protocol');
  const off = () => {
    document.body.classList.remove('print-kv-protocol');
    window.removeEventListener('afterprint', off);
  };
  window.addEventListener('afterprint', off);
  const v = api.getVisit();
  if (pdf) printToPdf([L('Протокол', 'Report'), 'kV', str(v.common.kv_machine), str(v.common.kv_date)].filter(Boolean).join('_'), api.status);
  else window.print();
}

/** Подключить лист: a — { getVisit, modeName(m), chamberName(j), openRow(m, i), status(text) }. */
export function setupKvSummary(a) {
  api = a;
  $('#kv-svd').addEventListener('click', (e) => {
    const c = e.target.closest('.kv-svd-cell');
    if (c) return api.openRow(Number(c.dataset.m), Number(c.dataset.i));
    const b = e.target.closest('.kv-svd-mode');
    const m = Number(b?.dataset.m);
    if (b) api.openRow(m, api.getVisit().modes[m]?.active ?? 0);
  });
  $('#kv-btn-prot-print').addEventListener('click', () => printProtocol(false));
  $('#kv-btn-prot-pdf').addEventListener('click', () => printProtocol(true));
}
