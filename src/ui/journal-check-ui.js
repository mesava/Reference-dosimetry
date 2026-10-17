// «Сеанс» → «Проверка дозиметра второй камерой» (по желанию): карточки проверок, их результат, строки для итога сеанса,
// замечаний и протокола. Расчёт — core/journal-check.js; черновик и порядок обновления — journal-session-ui.js.
import { L, refText } from '../core/i18n.js';
import { isBlank, parseNumber } from '../core/units.js';
import { beamKind, beamKeys, chamberText, electrometerText, photonCapable, electronCapable, cobaltCapable, chamberFormFromElectrons, chamberFormFromCobalt } from '../core/journal.js';
import { computeDosimeterCheck, checkHistory, checkMessages, checkVerdicts, verdictMessage, checkStarted, newCheck, SHIFT_Z, WATCH_Z, HISTORY_MIN, CHECK_REF } from '../core/journal-check.js';
import { esc, fmt, fmtSigned, richText } from './common.js';
import { renderCells, readCells, setupCells } from './widgets.js';
import { cellsHtml, fmtDate } from './journal-common.js';

const SERIES = ['M', 'Mopp', 'M2'];
const blank3 = () => ['', '', ''];
const hasValues = (cells) => (cells || []).some((v) => !isBlank(v));
const capable = (kind) => ({ electron: electronCapable, cobalt: cobaltCapable })[kind] ?? photonCapable;
const lvlName = () => ({ error: L('Ошибка', 'Error'), warn: L('Внимание', 'Warning'), info: L('Справка', 'Note') });

/** Рабочая камера пучка в сеансе: записанная в открытом сеансе или из «Оборудования». */
const workChamberId = (b, d) => (d?.base ? d.chamberId || '' : b.chamberId || '');
/** Камеры журнала, которые годятся второй камерой для пучка: того же вида и не рабочая. */
export const secondChambers = (j, b, d) => j.chambers.filter((c) => c.id !== workChamberId(b, d) && capable(beamKind(b))(c.form));

/** Новая проверка: первый пучок с рабочей камерой и первая подходящая вторая камера. */
export function addCheck(j, beams, draftBeams) {
  const b = beams.find((x) => draftBeams[x.id]?.include !== false && workChamberId(x, draftBeams[x.id]) && secondChambers(j, x, draftBeams[x.id]).length) ?? beams[0];
  if (!b) return null;
  return newCheck(b.id, secondChambers(j, b, draftBeams[b.id])[0]?.id ?? '');
}

/** Разметка проверок (карточки); beams — пучки сеанса. */
export function checksHtml(j, beams, draftBeams, checks, { tg }) {
  if (!checks.length) return '';
  return checks
    .map((c, i) => {
      const b = beams.find((x) => x.id === c.beamId) ?? null;
      const kind = b ? beamKind(b) : 'photon';
      const d = b ? draftBeams[b.id] : null;
      const id = c.id;
      const recorded = !!c.form;
      const f = d?.base || b?.form || {};
      const k = beamKeys(kind);
      const opts = (list, value, extra = '') => `${extra}${list.map((x) => `<option value="${esc(x.id)}"${x.id === value ? ' selected' : ''}>${esc(x.text)}</option>`).join('')}`;
      const beamOpts = opts(beams.map((x) => ({ id: x.id, text: x.name || '—' })), c.beamId);
      const chamberList = b ? secondChambers(j, b, d) : [];
      // записанная камера могла быть удалена из журнала: показать её по записанной форме
      const recordedText = recorded && !chamberList.some((x) => x.id === c.chamberId) ? recordedChamberText(c, kind) : '';
      const chOpts = chamberList.length || recordedText
        ? opts(chamberList.map((x) => ({ id: x.id, text: chamberText(x) })), c.chamberId, recordedText ? `<option value="${esc(c.chamberId)}" selected>${esc(recordedText)}</option>` : '')
        : `<option value="">${esc(L('— нет другой камеры —', '— no other chamber —'))}</option>`;
      const workEl = d?.base ? null : j.electrometers.find((e) => e.id === b?.electrometerId);
      const sameText = L(`как у рабочей${workEl ? `: ${electrometerText(workEl)}` : ''}`, `as the working one${workEl ? `: ${electrometerText(workEl)}` : ''}`);
      const elOpts = opts(j.electrometers.map((e) => ({ id: e.id, text: electrometerText(e) })), c.electrometerId, `<option value=""${c.electrometerId ? '' : ' selected'}>${esc(sameText)}</option>`);
      const [kp, kx] = tg ? ['P<sub>pol</sub>', 'P<sub>ion</sub>'] : ['k<sub>pol</sub>', 'k<sub>s</sub>'];
      const inp = (key, label, sub = '') =>
        `<div class="field"><label for="jsc-${id}-${key}">${label}</label><input type="text" id="jsc-${id}-${key}" data-ck="${key}" class="num" inputmode="decimal" value="${esc(c[key] ?? '')}">${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
      const fff = kind === 'photon' && !!f.meta_fff;
      const more = hasValues(c.Mopp) || hasValues(c.M2) || ['kpol', 'ks', 'kQ', 'kvol'].some((x) => !isBlank(c[x]));
      const v2 = f[{ electron: 'e_V2', cobalt: 'co_V2' }[kind] ?? 'rd_V2'];
      const volts = [!isBlank(f[k.V1]) ? `V₁ ${f[k.V1]} ${L('В', 'V')}` : '', !isBlank(v2) ? `V₂ ${v2} ${L('В', 'V')}` : ''].filter(Boolean).join(', ');
      return `<div class="jcard jsb jsc" data-check="${esc(id)}" data-kind="${kind}">
        <div class="jcard-head"><b>${esc(L(`Проверка ${i + 1}`, `Check ${i + 1}`))}</b><span class="chip jsb-chip" data-chip></span></div>
        ${recorded ? `<p class="sub-hint">${esc(L('Вторая камера и электрометр — как записано в сеансе.', 'The second chamber and electrometer are as recorded in the session.'))}</p>` : ''}
        <div class="grid three">
          <div class="field"><label for="jsc-${id}-beamId">${esc(L('Пучок', 'Beam'))}</label><select id="jsc-${id}-beamId" data-ck="beamId">${beamOpts}</select></div>
          <div class="field"><label for="jsc-${id}-chamberId">${esc(L('Вторая камера', 'Second chamber'))}</label><select id="jsc-${id}-chamberId" data-ck="chamberId"${chamberList.length || recordedText ? '' : ' disabled'}>${chOpts}</select>${chamberList.length || recordedText ? '' : `<span class="sub">${esc(L('добавьте её в «Оборудовании» → «Камеры»', 'add it in Equipment → Chambers'))}</span>`}</div>
          <div class="field"><label for="jsc-${id}-electrometerId">${esc(L('Электрометр', 'Electrometer'))}</label><select id="jsc-${id}-electrometerId" data-ck="electrometerId">${elOpts}</select></div>
        </div>
        <div class="series">${cellsHtml(`jsc-${id}-M`, L('Вторая камера: M при V₁, обычная полярность', 'Second chamber: M at V₁, normal polarity'), c.M)}</div>
        <details class="jsb-more"${more ? ' open' : ''}>
          <summary>${L(`${kp} и ${kx} второй камеры, свой k<sub>Q</sub>`, `${kp} and ${kx} of the second chamber, own k<sub>Q</sub>`)}</summary>
          <p class="sub-hint">${richText(L(
            `Измерьте их хотя бы в первой проверке — дальше они берутся из неё. Напряжения — как у рабочей камеры${volts ? ` (${volts})` : ''}. Пустые поля: из показаний ниже, иначе из прошлой проверки этой камеры в этом пучке, иначе 1.`,
            `Measure them at least in the first check; later checks take them from it. The voltages are those of the working chamber${volts ? ` (${volts})` : ''}. Blank fields: from the readings below, otherwise from the previous check of this chamber in this beam, otherwise 1.`,
          ))}</p>
          <div class="series">
            ${cellsHtml(`jsc-${id}-Mopp`, L('M при V₁, обратная полярность', 'M at V₁, opposite polarity'), c.Mopp)}
            ${cellsHtml(`jsc-${id}-M2`, L('M при V₂', 'M at V₂'), c.M2)}
          </div>
          <div class="grid three">
            ${inp('kpol', kp)}
            ${inp('ks', kx)}
            ${kind === 'cobalt' ? '' : inp('kQ', L('k<sub>Q</sub> второй камеры', 'k<sub>Q</sub> of the second chamber'), L('пусто — по её модели', 'blank: from its model'))}
            ${fff ? inp('kvol', L('k<sub>vol</sub> второй камеры', 'k<sub>vol</sub> of the second chamber'), L('пусто — по длине её полости', 'blank: from its cavity length')) : ''}
          </div>
        </details>
        <div class="jsb-result" data-check-result></div>
        <div class="row-tools"><button type="button" class="link-btn" data-ck-remove="${esc(id)}">${esc(L('Убрать проверку', 'Remove the check'))}</button></div>
      </div>`;
    })
    .join('');
}

/** Подпись второй камеры по записанной форме (камеру удалили из журнала). */
function recordedChamberText(c, kind) {
  const f = c.form || {};
  const form = kind === 'electron' ? chamberFormFromElectrons(f) : kind === 'cobalt' ? chamberFormFromCobalt(f) : f;
  return chamberText({ form }) || L('камера из записанного сеанса', 'chamber from the recorded session');
}

/** Ячейки показаний карточек: заполнить и подключить. */
export function setupCheckCells(box, checks, onEdit) {
  for (const c of checks) {
    for (const key of SERIES) {
      const el = box.querySelector(`.cells[data-series="jsc-${c.id}-${key}"]`);
      if (!el) continue;
      renderCells(el, c[key]?.length ? c[key] : blank3());
      setupCells(el, onEdit);
    }
  }
}

/** Прочитать проверки из карточек (записанная форма и итог сохраняются). */
export function readChecks(box, checks) {
  return checks.map((c) => {
    const card = box.querySelector(`.jsc[data-check="${CSS.escape(c.id)}"]`);
    if (!card) return c;
    const out = { ...c };
    for (const el of card.querySelectorAll('[data-ck]')) out[el.dataset.ck] = el.value;
    for (const key of SERIES) {
      const el = card.querySelector(`.cells[data-series="jsc-${c.id}-${key}"]`);
      if (el) out[key] = readCells(el);
    }
    return out;
  });
}

/** Поле карточки, после изменения которого записанная форма второй камеры к проверке уже не относится. */
export const resetsRecorded = (key) => ['beamId', 'chamberId', 'electrometerId'].includes(key);

/**
 * Расчёт проверок черновика: works — Map beamId → { input, calc } рабочих камер. Возвращает
 * [{ check, res, hist, msgs, started }] и замечания по трём системам.
 */
export function computeChecks(j, session, checks, works) {
  const items = checks.map((check) => {
    const started = checkStarted(check);
    const w = works.get(check.beamId);
    const res = started && w?.calc && w.input.include !== false ? computeDosimeterCheck(j, session, check, w.calc) : null;
    const hist = res?.ok ? checkHistory(j, session, res) : null;
    const msgs = res ? checkMessages(res, hist) : [];
    if (started && w && w.input.include === false) msgs.push({ level: 'warn', text: L('Пучок исключён из сеанса: проверка не считается.', 'The beam is excluded from the session: the check is not calculated.') });
    return { check, res, hist, msgs, started };
  });
  const verdicts = checkVerdicts(items).map((v) => verdictMessage(v, works.get(v.beamId)?.calc?.beam.name ?? '—', (r) => chamberText(j.chambers.find((x) => x.id === r.check.chamberId)) || '—'));
  return { items, verdicts };
}

const chipOf = (it) => {
  if (!it.started) return ['empty', L('нет показаний', 'no readings')];
  if (!it.res?.ok) return ['error', L('есть ошибки', 'has errors')];
  const z = it.hist?.z;
  if (Number.isFinite(z) && Math.abs(z) >= SHIFT_Z) return ['out', L(`сдвиг ${fmtSigned(z, 1)}σ`, `shift ${fmtSigned(z, 1)}σ`)];
  if (Number.isFinite(z) && Math.abs(z) >= WATCH_Z) return ['out', L(`на границе: ${fmtSigned(z, 1)}σ`, `at the edge: ${fmtSigned(z, 1)}σ`)];
  if (Number.isFinite(z)) return ['ok', L('в пределах разброса', 'within the scatter')];
  return ['ok', it.hist && !it.hist.n ? L('первая в отсчёте', 'first in the count') : L('посчитано', 'calculated')];
};

const srcText = (code, prev) =>
  ({
    measured: L('измерен', 'measured'),
    manual: L('введён', 'entered'),
    previous: L(`из проверки от ${fmtDate(prev?.date)}`, `from the check of ${fmtDate(prev?.date)}`),
    assumed: L('принят 1', 'taken as 1'),
  })[code] ?? '';

/** Итог в карточках. */
export function renderCheckResults(box, items) {
  for (const it of items) {
    const card = box.querySelector(`.jsc[data-check="${CSS.escape(it.check.id)}"]`);
    if (!card) continue;
    const [cls, text] = chipOf(it);
    const chip = card.querySelector('[data-chip]');
    chip.className = `chip jsb-chip ${cls}`;
    chip.textContent = text;
    for (const out of card.querySelectorAll('output[data-mean]')) {
      const c = card.querySelector(`.cells[data-series="${CSS.escape(out.dataset.mean)}"]`);
      const v = readCells(c).map(parseNumber).filter(Number.isFinite);
      out.textContent = v.length ? fmt(Math.abs(v.reduce((a, x) => a + x, 0) / v.length), 4) : '';
    }
    const res = it.res;
    // в пустых полях — значения, которые взяты
    if (res?.second) {
      const k = beamKeys(res.kind);
      const ph = { kpol: res.measured ? '' : res.second.form[k.fixedKpol], ks: res.measured ? '' : res.second.form[k.fixedKs], kQ: res.kind === 'cobalt' ? '' : res.second.summary.kQ, kvol: res.second.result.profile?.active ? res.second.result.profile.value : '' };
      for (const [key, v] of Object.entries(ph)) {
        const el = card.querySelector(`[data-ck="${key}"]`);
        if (!el) continue;
        const x = typeof v === 'number' ? v : parseNumber(v);
        el.placeholder = isBlank(it.check[key]) && Number.isFinite(x) ? fmt(x, 4) : '';
      }
    }
    const el = card.querySelector('[data-check-result]');
    const lines = [];
    if (res?.ok) {
      const co = res.kind === 'cobalt';
      const [kp, kx] = res.work.form.protocol === 'tg51' ? ['P_pol', 'P_ion'] : ['k_pol', 'k_s'];
      const ssum = res.second.summary;
      const unit = co ? L('сГр/мин', 'cGy/min') : L('Гр на 100 МЕ', 'Gy per 100 MU');
      const v = (x) => (co ? fmt(x, 2) : fmt(x, 4));
      lines.push(`<p class="jsb-dose">${esc(L('Отношение доз рабочая / вторая', 'Dose ratio working / second'))}: <b>${fmt(res.ratio, 4)}</b> (${fmtSigned(res.diff, 2)} %)${Number.isFinite(it.hist?.delta) ? ` · ${esc(L('от прежних', 'from earlier'))} <b>${fmtSigned(it.hist.delta, 2)} %</b>${Number.isFinite(it.hist.z) ? ` (${fmtSigned(it.hist.z, 1)}σ)` : ''}` : ''}</p>`);
      lines.push(`<p class="jsb-k">${richText(`${L('На z_ref', 'At z_ref')}: ${L('рабочая', 'working')} ${v(res.workValue)}, ${L('вторая', 'second')} ${v(res.value)} ${unit}; ${kp} = ${fmt(ssum.kpolRaw, 4)} (${srcText(res.src.kpol, res.prev)}), ${kx} = ${fmt(ssum.ksRaw, 4)} (${srcText(res.src.ks, res.prev)})${co ? '' : `; k_Q = ${fmt(ssum.kQ, 4)}`}`)}</p>`);
    }
    const msgs = it.msgs;
    if (msgs.length) {
      const errs = msgs.filter((m) => m.level === 'error').length;
      const warns = msgs.filter((m) => m.level === 'warn').length;
      lines.push(`<details class="jsb-msgs"${errs || warns ? ' open' : ''}><summary>${esc(L(`Замечания: ${msgs.length}`, `Messages: ${msgs.length}`))}</summary><ul class="messages">${msgs.map((m) => `<li class="${m.level}"><span class="lvl">${esc(lvlName()[m.level])}</span><span>${richText(m.text)}</span>${m.ref ? `<span class="ref">${esc(refText(m.ref))}</span>` : ''}</li>`).join('')}</ul></details>`);
    }
    const html = lines.join('');
    if (el._html !== html) {
      el._html = html;
      el.innerHTML = html;
    }
  }
}

/** Таблица проверок для итога сеанса (справа). */
export function checksReadoutHtml(j, items) {
  const rows = items.filter((it) => it.started);
  if (!rows.length) return '';
  return `<table class="factors jsum jsum-check"><thead><tr><th>${esc(L('Проверка дозиметра', 'Dosimeter check'))}</th><th class="v">${esc(L('Отношение', 'Ratio'))}</th><th class="v">${esc(L('от прежних, %', 'from earlier, %'))}</th></tr></thead><tbody>${rows
    .map((it) => {
      const [cls] = chipOf(it);
      const name = `${it.res?.work.beam.name ?? '—'} · ${chamberText(j.chambers.find((x) => x.id === it.check.chamberId)) || '—'}`;
      return `<tr class="st-${cls}"><td>${esc(name)}</td><td class="v">${it.res?.ok ? fmt(it.res.ratio, 4) : '—'}</td><td class="v">${Number.isFinite(it.hist?.delta) ? fmtSigned(it.hist.delta, 2) : '—'}</td></tr>`;
    })
    .join('')}</tbody></table>`;
}

/** Замечания для панели справа: ошибки и сдвиги проверок, вывод по трём системам. */
export function checkPanelMessages(j, comp) {
  const out = [];
  for (const it of comp.items) {
    if (!it.started) continue;
    const name = `${it.res?.work.beam.name ?? L('пучок', 'beam')}, ${chamberText(j.chambers.find((x) => x.id === it.check.chamberId)) || L('вторая камера', 'second chamber')}`;
    if (!it.res?.ok) out.push(['warn', L(`Проверка дозиметра (${name}): есть ошибки — она не будет записана.`, `Dosimeter check (${name}): there are errors; it will not be recorded.`)]);
    else if (Number.isFinite(it.hist?.z) && Math.abs(it.hist.z) >= SHIFT_Z) out.push(['warn', L(`Проверка дозиметра (${name}): отношение сместилось на ${fmtSigned(it.hist.delta, 2)} % (${fmtSigned(it.hist.z, 1)}σ).`, `Dosimeter check (${name}): the ratio has shifted by ${fmtSigned(it.hist.delta, 2)}% (${fmtSigned(it.hist.z, 1)}σ).`)]);
  }
  for (const v of comp.verdicts) out.push([v.level, v.text]);
  return out;
}

/** Строки протокола сеанса. */
export function checkReportLines(j, comp, { tg }) {
  const rows = comp.items.filter((it) => it.started);
  if (!rows.length) return [];
  const [kp, kx] = tg ? ['P_pol', 'P_ion'] : ['k_pol', 'k_s'];
  const out = ['', L(`ПРОВЕРКА ДОЗИМЕТРА ВТОРОЙ КАМЕРОЙ (${CHECK_REF})`, `DOSIMETER CHECK WITH A SECOND CHAMBER (${refText(CHECK_REF)})`)];
  for (const it of rows) {
    const r = it.res;
    const ch = chamberText(j.chambers.find((x) => x.id === it.check.chamberId)) || '—';
    if (!r?.ok) {
      out.push(`${r?.work.beam.name ?? '—'}: ${ch} — ${L('нет результата: есть ошибки', 'no result: there are errors')}`);
      continue;
    }
    const el = j.electrometers.find((e) => e.id === r.sig.electrometerId);
    out.push(`${r.work.beam.name}: ${L('рабочая', 'working')} ${chamberText(r.work.chamber)}; ${L('вторая', 'second')} ${ch}${el ? `, ${electrometerText(el)}` : ''}`);
    const co = r.kind === 'cobalt';
    const v = (x) => (co ? `${fmt(x, 2)} ${L('сГр/мин', 'cGy/min')}` : `${fmt(x, 4)} ${L('Гр на 100 МЕ', 'Gy per 100 MU')}`);
    out.push(`  ${L('На z_ref', 'At z_ref')}: ${L('рабочая', 'working')} ${v(r.workValue)}, ${L('вторая', 'second')} ${v(r.value)}; ${L('отношение', 'ratio')} ${fmt(r.ratio, 4)} (${fmtSigned(r.diff, 2)} %)`);
    out.push(`  ${kp} = ${fmt(r.second.summary.kpolRaw, 4)} (${srcText(r.src.kpol, r.prev)}); ${kx} = ${fmt(r.second.summary.ksRaw, 4)} (${srcText(r.src.ks, r.prev)})${co ? '' : `; k_Q = ${fmt(r.second.summary.kQ, 4)}`}`);
    const h = it.hist;
    if (h?.n) out.push(`  ${L(`От среднего прежних проверок (${h.n})`, `From the mean of earlier checks (${h.n})`)}: ${fmtSigned(h.delta, 2)} %${Number.isFinite(h.z) ? ` (${fmtSigned(h.z, 1)}σ, σ = ${fmt(h.sigma, 2)} %)` : h.n < HISTORY_MIN ? L(`; разброс — с ${HISTORY_MIN} прежних проверок`, `; scatter from ${HISTORY_MIN} earlier checks`) : ''}`);
    for (const m of it.msgs.filter((x) => x.level !== 'info')) out.push(`  - ${m.text}`);
  }
  for (const v of comp.verdicts) out.push(`- ${v.text}`);
  return out;
}
