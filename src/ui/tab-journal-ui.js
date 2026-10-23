// Пучок журнала на вкладке дозиметрии («⁶⁰Co», «МВ фотоны», «Электроны»): в разделе 1 — выбор аппарата и пучка из
// вкладка «Оборудование» (выбор подставляет настройки пучка, камеру и электрометр), под результатом — «Записать в
// журнал». Измерение идёт во вкладке со всеми поправками; в журнал попадает форма вкладки и итог (core/journal.js:
// recordTabBeam). Пучки одного аппарата за день в одном режиме — одна запись журнала.
import { L } from '../core/i18n.js';
import { beamKind, machineOf, tabBeamPatch, recordTabBeam, tabRecordOf, tabSessionOf, tabWork, calibrationChecks, tabEquipment, lastCalibration, chamberText, electrometerText, chamberOf, electrometerOf, saveBeamSettings, SESSION_DEFAULTS, CAL_GEO_KEYS, calGeoText, sameCalGeo } from '../core/journal.js';
import { newCheck, withTabChecks, CHECK_REF } from '../core/journal-check.js';
import { $, esc, richText, currentProtocol, fmt, fmtSigned } from './common.js';
import { refText } from '../core/i18n.js';
import { secondChambers, checksHtml, setupCheckCells, readChecks, computeChecks, renderCheckResults } from './journal-check-ui.js';
import { getJournal, updateJournal, onJournal } from './journal-store.js';
import { fmtDate, GEO_OWN_TEXT } from './journal-common.js';

const FIXED = { photon: 'rd_fixed', electron: 'e_fixed', cobalt: 'co_fixed' };
const DATE = { photon: 'meta_date', electron: 'e_date', cobalt: 'co_date' };
const TAB = { photon: () => L('«МВ фотоны»', 'MV photons'), electron: () => L('«Электроны»', 'Electrons'), cobalt: () => L('«⁶⁰Co»', '⁶⁰Co') };

/**
 * cfg: { kind, module, bind — селектор блока в разделе 1, rec — селектор блока под результатом, read() — форма вкладки,
 * patch(поля) — подставить поля, status(текст) — строка состояния вкладки, demo() — открыт ли демонстрационный пример,
 * check — селектор раздела «Проверка дозиметра второй камерой» (по желанию; записывается вместе с измерением) }.
 */
function makeTabJournal(cfg) {
  const key = `reference-dosimetry.tabjournal.${cfg.kind}`;
  let bind = { machineId: '', beamId: '' };
  let lastFixed = null;
  let lastBind = '';
  let lastRec = '';
  let note = '';
  // проверки второй камерой пучка журнала: { beamId, list } — черновик, записывается вместе с измерением
  let checks = { beamId: '', list: [] };
  let lastCheck = '';
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    if (v && typeof v === 'object') bind = { machineId: String(v.machineId || ''), beamId: String(v.beamId || '') };
    const c = JSON.parse(localStorage.getItem(`${key}.checks`) || 'null');
    if (c && Array.isArray(c.list)) checks = { beamId: String(c.beamId || ''), list: c.list };
  } catch {
    /* хранилище недоступно */
  }
  const persist = () => {
    try {
      localStorage.setItem(key, JSON.stringify(bind));
      localStorage.setItem(`${key}.checks`, JSON.stringify(checks));
    } catch {
      /* хранилище недоступно */
    }
  };
  /** Проверки текущего пучка (у другого пучка — свой черновик не переносится). */
  const checkList = () => (checks.beamId === bind.beamId ? checks.list : []);

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
    // геометрия калибровки пучка в «Оборудовании»: у аппарата (для всех пучков вида) или своя
    const geo = b && cfg.kind in CAL_GEO_KEYS
      ? L(` Геометрия калибровки — ${calGeoText(cfg.kind, b.form)} (${b.geoOwn ? 'своя у пучка' : 'как у аппарата'}).`, ` Calibration geometry: ${calGeoText(cfg.kind, b.form)} (${b.geoOwn ? 'own for the beam' : 'as the machine'}).`)
      : '';
    const st = b
      ? L(
        `Пучок журнала: ${m.name || '—'} — ${b.name || '—'}${last ? `; последняя калибровка в журнале ${fmtDate(last.date)}` : '; калибровок в журнале ещё нет'}.${geo} Измерение записывается кнопкой «Записать в журнал» под результатом.`,
        `Journal beam: ${m.name || '—'} — ${b.name || '—'}${last ? `; last calibration in the journal ${fmtDate(last.date)}` : '; no calibrations in the journal yet'}.${geo} The measurement is recorded with the "Record to journal" button under the result.`,
      )
      : L(
        'Выберите аппарат и пучок из вкладки «Оборудование»: подставятся настройки пучка, камера и электрометр (которыми мерили этот аппарат последний раз). Показания, условия и дата вкладки не меняются.',
        'Select the machine and beam from the Equipment tab: the beam settings, chamber and electrometer (the ones last used on this machine) are filled in. The tab readings, conditions and date are not changed.',
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
    // согласие с калибровкой камеры журнала: электрометр, напряжение и полярность калибровки
    const t = tabEquipment(j, form, cfg.kind);
    const cal = t.chamber ? calibrationChecks(j, t.chamber.id, t.electrometer?.id || '', form, cfg.kind) : [];
    const warn = !why && dry && !dry.chamberFound
      ? L('Камера вкладки не найдена в журнале (по модели и №): запись будет без привязки к камере журнала, контрольная карта и проверки второй камерой её не свяжут с камерой.', 'The tab chamber was not found in the journal (by model and serial number): the record will not be linked to a journal chamber.')
      : '';
    // геометрия во вкладке другая, чем у пучка в «Оборудовании»: от неё зависят номинал и отсчёт контрольной карты
    const geoWarn = cfg.kind in CAL_GEO_KEYS && !sameCalGeo(cfg.kind, form, b.form)
      ? L(
        `Геометрия во вкладке (${calGeoText(cfg.kind, form)}) отличается от геометрии калибровки пучка в «Оборудовании» (${calGeoText(cfg.kind, b.form)}): проверьте номинальный выход — он зависит от геометрии; в контрольной карте с записи в другой геометрии начинается новый отсчёт.`,
        `The geometry in the tab (${calGeoText(cfg.kind, form)}) differs from the calibration geometry of the beam in Equipment (${calGeoText(cfg.kind, b.form)}): check the nominal output, it depends on the geometry; the control chart starts a new count from a record in another geometry.`,
      )
      : '';
    // калибровка: k_pol и k_s сравниваются с прошлой калибровкой пучка (изменение k_pol больше 0,2 % — выяснить причину)
    const sum = !check && dry && !dry.error ? dry.session.beams.find((x) => x.beamId === b.id)?.summary : null;
    const prev = sum && Number.isFinite(sum.kpolRaw) && Number.isFinite(sum.ksRaw) ? lastCalibration(j, b.id, { before: String(date || ''), exceptId: tabSessionOf(j, { machineId: m.id, form, kind: cfg.kind })?.id || '' }) : null;
    let prevHtml = '';
    if (prev) {
      const tg = form.protocol === 'tg51';
      const kp = tg ? 'P_pol' : 'k_pol';
      const kx = tg ? 'P_ion' : 'k_s';
      const dKpol = (sum.kpolRaw / prev.kpol - 1) * 100;
      prevHtml = `<p class="sub-hint jrec-prev">${richText(L(
        `${kp} = ${fmt(sum.kpolRaw, 4)}, ${kx} = ${fmt(sum.ksRaw, 4)}; прошлая калибровка пучка в журнале (${fmtDate(prev.date)}): ${fmt(prev.kpol, 4)} и ${fmt(prev.ks, 4)}.`,
        `${kp} = ${fmt(sum.kpolRaw, 4)}, ${kx} = ${fmt(sum.ksRaw, 4)}; previous calibration of the beam in the journal (${fmtDate(prev.date)}): ${fmt(prev.kpol, 4)} and ${fmt(prev.ks, 4)}.`,
      ))}</p>${Math.abs(dKpol) > 0.2 ? `<p class="jlink-st warn">${richText(L(`${kp} изменился на ${fmtSigned(dKpol, 2)} % с прошлой калибровки: при изменении больше 0,2 % Report 374 советует выяснить причину (камера, кабель, электрометр).`, `${kp} changed by ${fmtSigned(dKpol, 2)}% since the previous calibration: for a change above 0.2%, Report 374 advises investigating the cause (chamber, cable, electrometer).`))}</p>` : ''}`;
    }
    const html = `<h2>${esc(L('Журнал', 'Journal'))}</h2>
      <p>${richText(`${m.name || '—'} — ${b.name || '—'} · ${check ? L('проверка выхода', 'output check') : L('калибровка', 'calibration')} · ${fmtDate(date)}`)}</p>
      ${old ? `<p class="sub-hint">${esc(L('Этот пучок за эту дату в этом режиме уже есть в журнале: запись будет заменена.', 'This beam for this date and mode is already in the journal: the record will be replaced.'))}</p>` : ''}
      ${why ? `<p class="jlink-st warn">${richText(why)}</p>` : ''}${warn ? `<p class="jlink-st warn">${richText(warn)}</p>` : ''}${geoWarn ? `<p class="jlink-st warn">${richText(geoWarn)}</p>` : ''}
      ${prevHtml}
      ${cal.length ? `<ul class="messages jrec-cal">${cal.map((n) => `<li class="${n.level}"><span>${richText(n.text)}</span></li>`).join('')}</ul>` : ''}
      <div class="actions"><button type="button" class="primary" data-jr="record"${why ? ' disabled' : ''}>${esc(old ? L('Заменить запись в журнале', 'Replace the journal record') : L('Записать в журнал', 'Record to journal'))}</button><button type="button" data-jr="settings" title="${esc(L('Геометрия, напряжения, МЕ, пересчёт на d_max, номинал, способ k_Q и т. п. — значения по умолчанию для этого пучка', 'Geometry, voltages, MU, transfer to d_max, nominal, k_Q method, etc.: the defaults for this beam'))}">${esc(L('Сохранить настройки пучка в журнал', 'Save the beam settings to the journal'))}</button><button type="button" data-jr="unbind">${esc(L('Отвязать пучок', 'Unlink the beam'))}</button></div>`;
    el.hidden = false;
    if (html !== lastRec) {
      lastRec = html;
      el.innerHTML = html;
    }
  }

  // ------------------------------------------------------------ проверка дозиметра второй камерой
  /** Сеанс для расчёта проверок: запись журнала этого дня (если есть) — для сравнения с прежними проверками. */
  function checkSession(j, m, form) {
    const s = tabSessionOf(j, { machineId: m.id, form, kind: cfg.kind });
    const k = DATE[cfg.kind];
    return s ?? { ...SESSION_DEFAULTS, id: '', machineId: m.id, date: form[k] || '9999-12-31', mode: form[FIXED[cfg.kind]] ? 'check' : 'cal', protocol: form.protocol === 'tg51' ? 'tg51' : 'trs' };
  }
  function renderCheck() {
    const box = cfg.check ? $(cfg.check) : null;
    if (!box) return;
    const j = getJournal();
    const { m, b } = current(j);
    if (!b) {
      box.hidden = true;
      box.innerHTML = '';
      lastCheck = '';
      return;
    }
    const form = cfg.read();
    const work = tabWork(j, b.id, form, cfg.kind);
    const d = { [b.id]: { chamberId: work?.chamber?.id || '', electrometerId: work?.electrometer?.id || '' } };
    const list = checkList();
    const html = `<header><h2>${esc(L('Проверка дозиметра второй камерой', 'Dosimeter check with a second chamber'))}</h2>
      <p class="hint">${richText(L(
        `По желанию. Долговременную стабильность дозиметра проверяют контрольным источником или сравнением с другими камерами (${CHECK_REF}). Тем же пучком, в тех же условиях, сразу после основной серии и без подстройки ускорителя снимите показания второй камерой: отношение доз рабочая / вторая сравнивается с прежними проверками этой пары камер. Проверки записываются в журнал вместе с измерением.`,
        `Optional. The long-term stability of the dosimeter is checked with a check source or by comparison with other chambers (${refText(CHECK_REF)}). With the same beam, in the same conditions, right after the main series and without adjusting the linac, take readings with a second chamber: the working / second dose ratio is compared with earlier checks of this chamber pair. The checks are recorded in the journal together with the measurement.`,
      ))}</p></header>
      <div class="jchecks">${checksHtml(j, [b], d, list, { tg: currentProtocol() === 'tg51' })}</div>
      <div class="jcheck-verdicts"></div>
      <div class="row-tools"><button type="button" class="link-btn" data-ck-add${secondChambers(j, b, d[b.id]).length ? '' : ' disabled'}><span aria-hidden="true">+</span> ${esc(L('Добавить проверку второй камерой', 'Add a second-chamber check'))}</button>${secondChambers(j, b, d[b.id]).length ? '' : `<span class="sub-hint">${esc(L('нужна вторая камера в «Оборудовании» → «Камеры»', 'a second chamber is needed in Equipment → Chambers'))}</span>`}</div>`;
    box.hidden = false;
    if (html !== lastCheck) {
      lastCheck = html;
      box.innerHTML = html;
      setupCheckCells(box, list, onCheckEdit);
    }
    computeCheck(j, m, b, form, work);
  }
  function computeCheck(j, m, b, form, work = tabWork(j, b.id, form, cfg.kind)) {
    const box = cfg.check ? $(cfg.check) : null;
    const list = checkList();
    if (!box || !list.length || !work) {
      const v = box?.querySelector('.jcheck-verdicts');
      if (v) v.innerHTML = '';
      return;
    }
    const comp = computeChecks(j, checkSession(j, m, form), list, new Map([[b.id, { input: { include: true }, calc: work }]]));
    renderCheckResults(box, comp.items);
    const v = box.querySelector('.jcheck-verdicts');
    if (v) v.innerHTML = comp.verdicts.length ? `<ul class="messages">${comp.verdicts.map((x) => `<li class="${x.level}"><span>${richText(x.text)}</span></li>`).join('')}</ul>` : '';
  }
  function onCheckEdit() {
    const box = $(cfg.check);
    checks = { beamId: bind.beamId, list: readChecks(box, checkList()) };
    persist();
    const j = getJournal();
    const { m, b } = current(j);
    if (b) computeCheck(j, m, b, cfg.read());
  }

  function render() {
    renderBind();
    renderRec();
    renderCheck();
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

  /** Записать измерение вкладки в журнал; true — записано. */
  function record() {
    const j = getJournal();
    const { m, b } = current(j);
    if (!b) return false;
    let res = null;
    let chk = null;
    const form = cfg.read();
    updateJournal((jj) => {
      res = recordTabBeam(jj, { machineId: m.id, beamId: b.id, form, kind: cfg.kind });
      if (res.error) return jj;
      // проверки второй камерой этого пучка — в ту же запись (заменяют прежние проверки пучка в ней)
      const list = checkList().filter((c) => (c.M || []).some((x) => String(x ?? '').trim()));
      if (!list.length && !(res.session.checks ?? []).some((c) => c.beamId === b.id)) return res.journal;
      chk = withTabChecks(res.journal, res.session, b.id, list, tabWork(res.journal, b.id, form, cfg.kind));
      return chk.journal;
    }, 'tab-journal');
    if (res.error) {
      cfg.status(res.error);
      return false;
    }
    const chkText = chk?.checks.length
      ? L(` Проверок второй камерой: ${chk.checks.length}${chk.skipped ? `, с ошибками не записано: ${chk.skipped}` : ''}.`, ` Second-chamber checks: ${chk.checks.length}${chk.skipped ? `; not recorded because of errors: ${chk.skipped}` : ''}.`)
      : chk?.skipped
        ? L(` Проверки второй камерой с ошибками не записаны (${chk.skipped}).`, ` Second-chamber checks with errors were not recorded (${chk.skipped}).`)
        : '';
    cfg.status(
      L(
        `${res.replaced ? 'Запись заменена' : 'Записано'} в журнал: ${m.name} — ${b.name}, ${fmtDate(res.session.date)}, ${res.session.mode === 'check' ? 'проверка выхода' : 'калибровка'}.${chkText} Записи и тренды — во вкладке «Журнал и тренды»; сохраните журнал в файл, если автосохранение не включено.`,
        `${res.replaced ? 'Record replaced' : 'Recorded'} to the journal: ${m.name} — ${b.name}, ${fmtDate(res.session.date)}, ${res.session.mode === 'check' ? 'output check' : 'calibration'}.${chkText} Records and trends: the Journal and trends tab; save the journal file if autosave is off.`,
      ),
    );
    render();
    return true;
  }

  /** Настройки пучка вкладки (без показаний и условий) — в «Оборудование» как значения по умолчанию для пучка. */
  function saveSettings() {
    const j = getJournal();
    const { m, b } = current(j);
    if (!b) return;
    let geoOwn = false;
    updateJournal((jj) => {
      const res = saveBeamSettings(jj, m.id, b.id, cfg.read(), cfg.kind);
      geoOwn = !!res.geoOwn;
      return res.journal;
    }, 'tab-journal');
    cfg.status(
      L(
        `Настройки пучка «${m.name} — ${b.name}» сохранены в журнал: в следующий раз они подставятся при выборе пучка. Показания, условия, камера и электрометр в настройки пучка не входят: камеру и электрометр журнала меняют в «Оборудовании» или в строке «Журнал отделения» раздела 2.`,
        `The settings of beam "${m.name} — ${b.name}" have been saved to the journal: they will be filled in next time the beam is selected. Readings, conditions, chamber and electrometer are not part of the beam settings: the journal chamber and electrometer are changed in Equipment or in the "Department journal" row of section 2.`,
      ) + (geoOwn ? ` ${GEO_OWN_TEXT()}` : ''),
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
    const cEl = cfg.check ? $(cfg.check) : null;
    if (cEl) {
      // поля проверок — свои, форма вкладки их не читает
      cEl.addEventListener('input', (e) => {
        e.stopPropagation();
        if (e.target.tagName === 'INPUT') onCheckEdit();
      });
      cEl.addEventListener('change', (e) => {
        e.stopPropagation();
        if (e.target.tagName === 'SELECT' && e.target.closest('[data-ck]')) {
          onCheckEdit();
          lastCheck = '';
          renderCheck();
        }
      });
      cEl.addEventListener('click', (e) => {
        const add = e.target.closest('[data-ck-add]');
        const rm = e.target.closest('[data-ck-remove]');
        if (!add && !rm) return;
        e.preventDefault();
        const j = getJournal();
        const { b } = current(j);
        if (!b) return;
        const list = readChecks(cEl, checkList());
        if (add) {
          const work = tabWork(j, b.id, cfg.read(), cfg.kind);
          const second = secondChambers(j, b, { chamberId: work?.chamber?.id || '' })[0];
          list.push(newCheck(b.id, second?.id ?? ''));
        }
        checks = { beamId: bind.beamId, list: rm ? list.filter((c) => c.id !== rm.dataset.ckRemove) : list };
        persist();
        lastCheck = '';
        renderCheck();
      });
    }
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
      renderCheck();
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
  /**
   * Выбрать пучок журнала из сеанса (ui/session-ui.js): сначала дата и режим сеанса («Проверка выхода» — check), затем
   * настройки пучка, камера и электрометр — как при выборе в разделе 1.
   */
  function select(machineId, beamId, { date = '', check = false } = {}) {
    bind = { machineId, beamId };
    persist();
    note = '';
    cfg.patch({ [DATE[cfg.kind]]: date, [FIXED[cfg.kind]]: check });
    lastFixed = check;
    apply();
  }

  return { init, render, select, record, bound: () => ({ ...bind }) };
}

/** Подключить пучок журнала ко вкладкам дозиметрии; возвращает { photon, electron, cobalt } — выбор пучка и запись. */
export function initTabJournal(list) {
  const out = {};
  for (const cfg of list) {
    const t = makeTabJournal(cfg);
    t.init();
    out[cfg.kind] = t;
  }
  return out;
}
