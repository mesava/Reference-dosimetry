// Пучок журнала на вкладке дозиметрии («⁶⁰Co», «МВ фотоны», «Электроны»): в разделе 1 — выбор аппарата и пучка из
// «Журнал» → «Оборудование» (выбор подставляет настройки пучка, камеру и электрометр), под результатом — «Записать в
// журнал». Измерение идёт во вкладке со всеми поправками; в журнал попадает форма вкладки и итог (core/journal.js:
// recordTabBeam). Пучки одного аппарата за день в одном режиме — одна запись журнала.
import { L } from '../core/i18n.js';
import { beamKind, machineOf, tabBeamPatch, recordTabBeam, tabRecordOf, lastCalibration, chamberText, electrometerText, chamberOf, electrometerOf, applyTabFormToBeam } from '../core/journal.js';
import { $, esc, richText } from './common.js';
import { getJournal, updateJournal, onJournal } from './journal-store.js';
import { fmtDate } from './journal-common.js';

const FIXED = { photon: 'rd_fixed', electron: 'e_fixed', cobalt: 'co_fixed' };
const DATE = { photon: 'meta_date', electron: 'e_date', cobalt: 'co_date' };
const TAB = { photon: () => L('«МВ фотоны»', 'MV photons'), electron: () => L('«Электроны»', 'Electrons'), cobalt: () => L('«⁶⁰Co»', '⁶⁰Co') };

/**
 * cfg: { kind, module, bind — селектор блока в разделе 1, rec — селектор блока под результатом, read() — форма вкладки,
 * patch(поля) — подставить поля, status(текст) — строка состояния вкладки, demo() — открыт ли демонстрационный пример }.
 */
function makeTabJournal(cfg) {
  const key = `reference-dosimetry.tabjournal.${cfg.kind}`;
  let bind = { machineId: '', beamId: '' };
  let lastFixed = null;
  let lastBind = '';
  let lastRec = '';
  let note = '';
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    if (v && typeof v === 'object') bind = { machineId: String(v.machineId || ''), beamId: String(v.beamId || '') };
  } catch {
    /* хранилище недоступно */
  }
  const persist = () => {
    try {
      localStorage.setItem(key, JSON.stringify(bind));
    } catch {
      /* хранилище недоступно */
    }
  };

  const ofKind = (m) => (m?.beams || []).filter((b) => b.active !== false && beamKind(b) === cfg.kind);
  const machines = (j) => j.machines.filter((m) => ofKind(m).length);
  /** Привязка к пучку, который есть в журнале (иначе — пустая). */
  function current(j) {
    const m = machineOf(j, bind.machineId);
    const b = ofKind(m).find((x) => x.id === bind.beamId);
    return { m, b };
  }

  function renderBind() {
    const el = $(cfg.bind);
    if (!el) return;
    const j = getJournal();
    const ms = machines(j);
    if (!ms.length) {
      el.hidden = true;
      el.innerHTML = '';
      lastBind = '';
      return;
    }
    const { m, b } = current(j);
    const mSel = m && ms.includes(m) ? m.id : '';
    const opt = (v, t, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`;
    const last = b ? lastCalibration(j, b.id) : null;
    const st = b
      ? L(
        `Пучок журнала: ${m.name || '—'} — ${b.name || '—'}${last ? `; последняя калибровка в журнале ${fmtDate(last.date)}` : '; калибровок в журнале ещё нет'}. Измерение записывается кнопкой «Записать в журнал» под результатом.`,
        `Journal beam: ${m.name || '—'} — ${b.name || '—'}${last ? `; last calibration in the journal ${fmtDate(last.date)}` : '; no calibrations in the journal yet'}. The measurement is recorded with the "Record to journal" button under the result.`,
      )
      : L(
        'Выберите аппарат и пучок из «Журнал» → «Оборудование»: подставятся настройки пучка, камера и электрометр (которыми мерили этот аппарат последний раз). Показания, условия и дата вкладки не меняются.',
        'Select the machine and beam from Journal → Equipment: the beam settings, chamber and electrometer (the ones last used on this machine) are filled in. The tab readings, conditions and date are not changed.',
      );
    const html = `<div class="jbind-row"><span class="jlink-h">${esc(L('Журнал отделения', 'Department journal'))}</span>
      <select data-jb="machine" aria-label="${esc(L('Аппарат журнала', 'Journal machine'))}">${opt('', L('аппарат…', 'machine…'), mSel)}${ms.map((x) => opt(x.id, [x.name || L('аппарат без названия', 'unnamed machine'), x.serial ? `№ ${x.serial}` : ''].filter(Boolean).join(', '), mSel)).join('')}</select>
      <select data-jb="beam" aria-label="${esc(L('Пучок журнала', 'Journal beam'))}"${mSel ? '' : ' disabled'}>${opt('', L('пучок…', 'beam…'), b ? b.id : '')}${ofKind(machineOf(j, mSel)).map((x) => opt(x.id, x.name || L('пучок без названия', 'unnamed beam'), b ? b.id : '')).join('')}</select></div>
      <p class="jlink-st ${b ? 'ok' : 'none'}">${richText(st)}</p>${note ? `<p class="jlink-st warn">${richText(note)}</p>` : ''}`;
    el.hidden = false;
    if (html !== lastBind) {
      lastBind = html;
      el.innerHTML = html;
    }
  }

  function renderRec() {
    const el = $(cfg.rec);
    if (!el) return;
    const j = getJournal();
    const { m, b } = current(j);
    if (!b) {
      el.hidden = true;
      el.innerHTML = '';
      lastRec = '';
      return;
    }
    const form = cfg.read();
    const check = !!form[FIXED[cfg.kind]];
    const date = form[DATE[cfg.kind]];
    const demo = cfg.demo?.();
    const dry = demo ? null : recordTabBeam(j, { machineId: m.id, beamId: b.id, form, kind: cfg.kind });
    const old = tabRecordOf(j, { machineId: m.id, beamId: b.id, form, kind: cfg.kind });
    const why = demo ? L('Открыт демонстрационный пример: в журнал он не записывается.', 'A demonstration example is open: it is not recorded to the journal.') : dry?.error ?? '';
    const warn = !why && dry && !dry.chamberFound
      ? L('Камера вкладки не найдена в журнале (по модели и №): запись будет без привязки к камере журнала, контрольная карта и проверки второй камерой её не свяжут с камерой.', 'The tab chamber was not found in the journal (by model and serial number): the record will not be linked to a journal chamber.')
      : '';
    const html = `<h2>${esc(L('Журнал', 'Journal'))}</h2>
      <p>${richText(`${m.name || '—'} — ${b.name || '—'} · ${check ? L('проверка выхода', 'output check') : L('калибровка', 'calibration')} · ${fmtDate(date)}`)}</p>
      ${old ? `<p class="sub-hint">${esc(L('Этот пучок за эту дату в этом режиме уже есть в журнале: запись будет заменена.', 'This beam for this date and mode is already in the journal: the record will be replaced.'))}</p>` : ''}
      ${why ? `<p class="jlink-st warn">${richText(why)}</p>` : ''}${warn ? `<p class="jlink-st warn">${richText(warn)}</p>` : ''}
      <div class="actions"><button type="button" class="primary" data-jr="record"${why ? ' disabled' : ''}>${esc(old ? L('Заменить запись в журнале', 'Replace the journal record') : L('Записать в журнал', 'Record to journal'))}</button><button type="button" data-jr="settings" title="${esc(L('Геометрия, напряжения, МЕ, пересчёт на d_max, номинал, способ k_Q и т. п. — значения по умолчанию для этого пучка', 'Geometry, voltages, MU, transfer to d_max, nominal, k_Q method, etc.: the defaults for this beam'))}">${esc(L('Сохранить настройки пучка в журнал', 'Save the beam settings to the journal'))}</button><button type="button" data-jr="unbind">${esc(L('Отвязать пучок', 'Unlink the beam'))}</button></div>`;
    el.hidden = false;
    if (html !== lastRec) {
      lastRec = html;
      el.innerHTML = html;
    }
  }

  function render() {
    renderBind();
    renderRec();
  }

  /** Подставить пучок журнала во вкладку. only — только эти поля (например, при включении «Проверки выхода»). */
  function apply(only = null) {
    const j = getJournal();
    const { m, b } = current(j);
    if (!b) return;
    const r = tabBeamPatch(j, m.id, b.id, cfg.read());
    if (!r) return;
    const patch = only ? Object.fromEntries(Object.entries(r.patch).filter(([k]) => only.includes(k))) : r.patch;
    cfg.patch(patch);
    const ch = chamberOf(j, r.chamberId);
    const el = electrometerOf(j, r.electrometerId);
    note = ch ? '' : L('В журнале нет камеры, годной для этих пучков: камера вкладки не изменена — добавьте камеру в «Оборудовании».', 'The journal has no chamber suitable for these beams: the tab chamber was not changed; add a chamber in Equipment.');
    cfg.status(
      only
        ? L(`Подставлены k_pol и k_s (и качество пучка) из последней калибровки «${b.name}» в журнале${r.last ? ` (${fmtDate(r.last.date)})` : ': калибровок нет, введите их'}.`, `k_pol and k_s (and the beam quality) taken from the last calibration of "${b.name}" in the journal${r.last ? ` (${fmtDate(r.last.date)})` : ': there are none, enter them'}.`)
        : L(
          `Подставлен пучок журнала «${m.name} — ${b.name}»: настройки пучка${ch ? `, камера ${chamberText(ch)}` : ''}${el ? `, электрометр ${electrometerText(el)}` : ''}. Подсвечены изменённые поля; показания и условия не тронуты.`,
          `Journal beam "${m.name} — ${b.name}" filled in: the beam settings${ch ? `, chamber ${chamberText(ch)}` : ''}${el ? `, electrometer ${electrometerText(el)}` : ''}. The changed fields are highlighted; readings and conditions are untouched.`,
        ),
    );
    render();
  }

  function record() {
    const j = getJournal();
    const { m, b } = current(j);
    if (!b) return;
    let res = null;
    updateJournal((jj) => {
      res = recordTabBeam(jj, { machineId: m.id, beamId: b.id, form: cfg.read(), kind: cfg.kind });
      return res.error ? jj : res.journal;
    }, 'tab-journal');
    if (res.error) {
      cfg.status(res.error);
      return;
    }
    cfg.status(
      L(
        `${res.replaced ? 'Запись заменена' : 'Записано'} в журнал: ${m.name} — ${b.name}, ${fmtDate(res.session.date)}, ${res.session.mode === 'check' ? 'проверка выхода' : 'калибровка'}. Записи и тренды — в «Журнал» → «Журнал и тренды»; сохраните журнал в файл, если автосохранение не включено.`,
        `${res.replaced ? 'Record replaced' : 'Recorded'} to the journal: ${m.name} — ${b.name}, ${fmtDate(res.session.date)}, ${res.session.mode === 'check' ? 'output check' : 'calibration'}. Records and trends: Journal → Journal and trends; save the journal file if autosave is off.`,
      ),
    );
    render();
  }

  /** Настройки пучка вкладки (без показаний и условий) — в «Оборудование» как значения по умолчанию для пучка. */
  function saveSettings() {
    const j = getJournal();
    const { m, b } = current(j);
    if (!b) return;
    updateJournal((jj) => applyTabFormToBeam(jj, m.id, b.id, cfg.read(), cfg.kind).journal, 'tab-journal');
    cfg.status(
      L(
        `Настройки пучка «${m.name} — ${b.name}» сохранены в журнал: в следующий раз они подставятся при выборе пучка. Показания и условия в настройки не входят.`,
        `The settings of beam "${m.name} — ${b.name}" have been saved to the journal: they will be filled in next time the beam is selected. Readings and conditions are not part of the settings.`,
      ),
    );
  }

  function init() {
    const bEl = $(cfg.bind);
    const rEl = $(cfg.rec);
    if (!bEl || !rEl) return;
    // списки — свои, форма вкладки их не читает
    bEl.addEventListener('input', (e) => e.stopPropagation());
    bEl.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-jb]');
      if (!sel) return;
      e.stopPropagation();
      note = '';
      if (sel.dataset.jb === 'machine') {
        bind = { machineId: sel.value, beamId: '' };
        persist();
        render();
      } else {
        bind = { ...bind, beamId: sel.value };
        persist();
        if (sel.value) apply();
        else render();
      }
    });
    rEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-jr]');
      if (!btn) return;
      if (btn.dataset.jr === 'record') record();
      else if (btn.dataset.jr === 'settings') saveSettings();
      else {
        bind = { machineId: bind.machineId, beamId: '' };
        persist();
        cfg.status(L('Пучок журнала отвязан: вкладка считает как обычно, в журнал не записывает.', 'The journal beam has been unlinked: the tab calculates as usual and does not record to the journal.'));
        render();
      }
    });
    document.addEventListener('moduleupdate', (e) => {
      const root = e.detail?.root;
      if (!root || root.id !== `module-${cfg.module}`) return;
      // включили «Проверку выхода» у пучка журнала — k_pol, k_s и качество из последней калибровки
      const fixed = !!cfg.read()[FIXED[cfg.kind]];
      if (lastFixed === false && fixed) {
        const j = getJournal();
        const { m, b } = current(j);
        const r = b ? tabBeamPatch(j, m.id, b.id, cfg.read()) : null;
        if (r) {
          const only = Object.keys(r.patch).filter((k) => /_fixed_(kpol|ks|from)$/.test(k) || k === 'co_tau' || k === 'co_timer_mode' || /^(qtrs_v|q51_|e_i50|e_r50|e_pdd)/.test(k));
          lastFixed = fixed;
          apply(only);
          return;
        }
      }
      lastFixed = fixed;
      renderRec();
    });
    onJournal(() => {
      lastBind = lastRec = '';
      render();
    });
    document.addEventListener('langchange', () => {
      lastBind = lastRec = '';
      render();
    });
    lastFixed = !!cfg.read()[FIXED[cfg.kind]];
    render();
  }
  return { init, render };
}

/** Подключить пучок журнала ко вкладкам дозиметрии. */
export function initTabJournal(list) {
  for (const cfg of list) makeTabJournal(cfg).init();
}
