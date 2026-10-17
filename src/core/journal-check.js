// Проверка дозиметра второй камерой — по желанию, в сеансе журнала.
//
// TRS-398 Rev.1, разд. 4.4.2 (с. 65 рус. изд.): перед измерениями проверяют долговременную стабильность дозиметрической
// системы — контрольным источником или сравнением как минимум с двумя другими системами (три независимые системы не
// «сползут» одинаково). В сеансе тем же пучком, в тех же условиях и без подстройки ускорителя между сериями снимают
// показания второй камерой; каждая камера даёт дозу по своему N_D,w. Отношение r = D(рабочая)/D(вторая) от сеанса
// к сеансу должно быть постоянным: его сдвиг значит, что изменилась одна из двух систем. Если в сеансе две вторые
// камеры и обе показывают сдвиг одного знака — вероятнее, изменилась рабочая; если одна — эта вторая камера.
//
// Отношение сравнивается с прежними проверками той же пары камер в том же пучке (качество пучка и k_Q те же). Новый
// отсчёт — при смене электрометра или N_D,w, k_elec любой из камер: после поверки отношение может сдвинуться законно.
// Разброс отношения — оценка сверху долговременной стабильности рабочего дозиметра: весь разброс отнесён к нему.
import { L, getLang } from './i18n.js';
import { isBlank, parseNumber, ru } from './units.js';
import { beamKeys, beamOf, chamberText, checkBase, computeCheckBeam, dayNumber, mainValue, recordedBase, uid } from './journal.js';
import { controlChart, MIN_POINTS } from './spc.js';

const TRS = 'TRS-398 Rev.1';
export const CHECK_REF = `${TRS}, разд. 4.4.2`;

/** Проверка в сеансе: пучок, вторая камера, электрометр ('' — тот же, что у рабочей камеры), показания, свои k. */
export const CHECK_DEFAULTS = { id: '', beamId: '', chamberId: '', electrometerId: '', M: ['', '', ''], Mopp: ['', '', ''], M2: ['', '', ''], kpol: '', ks: '', kQ: '', kvol: '' };
export const newCheck = (beamId = '', chamberId = '') => ({ ...CHECK_DEFAULTS, id: uid('k'), beamId, chamberId, M: ['', '', ''], Mopp: ['', '', ''], M2: ['', '', ''] });

/** Наименьший σ отношения при сравнении с прежними проверками, %: разрешение электрометра (TRS-398 Rev.1, разд. 4.2.2). */
export const SIGMA_FLOOR = 0.1;
/** Порог «проверьте ввод»: отношение отличается от 1 больше, чем обычно дают калибровки двух камер, %. */
export const SANITY = { photon: 2, electron: 3, cobalt: 2 };
/** Сдвиг отношения от прежних проверок: |z| ≥ WATCH_Z — на границе разброса, ≥ SHIFT_Z — сдвиг. */
export const WATCH_Z = 2;
export const SHIFT_Z = 3;
/** Сравнение с прежними проверками — с этого их числа (σ по меньшему числу ненадёжна). */
export const HISTORY_MIN = 3;

const meanOf = (cells) => {
  const v = (cells || []).map(parseNumber).filter(Number.isFinite);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
};
const hasValues = (cells) => (cells || []).some((v) => !isBlank(v));
/** Можно считать: выбраны пучок и камера, есть показания второй камеры. */
export const checkStarted = (c) => !!c && !isBlank(c.beamId) && !isBlank(c.chamberId) && hasValues(c.M);
const dateText = (iso, en) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  return !m ? String(iso ?? '') : en ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}.${m[2]}.${m[1]}`;
};

/** k_pol и k_s второй камеры, измеренные в последней прежней проверке этой камеры в этом пучке. */
export function lastCheckFactors(j, { beamId, chamberId, before = '9999-12-31', exceptId = '' }) {
  let best = null;
  for (const s of j.sessions) {
    if (s.id === exceptId || !(String(s.date) <= before)) continue;
    for (const c of s.checks ?? []) {
      const sum = c.summary;
      if (c.beamId !== beamId || c.chamberId !== chamberId || !sum?.measured || !Number.isFinite(sum.kpol) || !Number.isFinite(sum.ks)) continue;
      if (!best || String(s.date) >= String(best.date)) best = { date: s.date, sessionId: s.id, kpol: sum.kpol, ks: sum.ks };
    }
  }
  return best;
}

/**
 * Расчёт проверки: work — рабочая камера этого пучка в сеансе (computeSessionBeam). check.form — форма второй камеры
 * из записанного сеанса: камера и электрометр — как при записи, пучок — как у рабочей камеры сейчас.
 * k_pol и k_s второй камеры: измерены (есть показания при обратной полярности и при V₂), введены, из последней
 * проверки этой камеры в этом пучке или приняты равными 1.
 * Возвращает { check, kind, work, second, measured, src: { kpol, ks }, prev, workValue, value, ratio, diff, ok, sig }.
 */
export function computeDosimeterCheck(j, session, check, work, { en = false } = {}) {
  if (!work?.result || !beamOf(j, check.beamId)) return null;
  const kind = work.kind;
  const k = beamKeys(kind);
  const six = (v) => (en ? v.toFixed(6) : v.toFixed(6).replace('.', ','));
  // τ — без округления: она бывает порядка 0,01 мин
  const exact = (v) => {
    const t = v.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
    return en ? t : t.replace('.', ',');
  };
  const measured = Number.isFinite(meanOf(check.Mopp)) && Number.isFinite(meanOf(check.M2));
  const workSum = work.summary;
  const tauUsed = work.result.timer?.tau;
  const base = checkBase(j, work.form, kind, {
    chamberId: check.chamberId,
    electrometerId: check.electrometerId,
    recorded: check.form ? recordedBase(check.form, kind) : null,
    kQ: check.kQ,
    kvol: check.kvol,
    ks10: workSum.ksRaw,
    tau: tauUsed,
    en,
  });
  const electrometerId = check.form ? check.summary?.electrometerId ?? check.electrometerId : check.electrometerId || work.electrometer?.id || '';
  const input = { beamId: check.beamId, chamberId: check.chamberId, electrometerId, base, env_T: work.form[k.T], env_P: work.form[k.P], [k.M1]: check.M };
  const src = { kpol: 'measured', ks: 'measured' };
  let prev = null;
  if (measured) {
    input[k.Mopp] = check.Mopp;
    input[k.M2] = check.M2;
  } else {
    prev = lastCheckFactors(j, { beamId: check.beamId, chamberId: check.chamberId, before: session.date || '9999-12-31', exceptId: session.id });
    const pickK = (own, fromPrev) => (!isBlank(own) ? ['manual', own] : Number.isFinite(fromPrev) ? ['previous', six(fromPrev)] : ['assumed', '1']);
    [src.kpol, input[k.fixedKpol]] = pickK(check.kpol, prev?.kpol);
    [src.ks, input[k.fixedKs]] = pickK(check.ks, prev?.ks);
    input[k.fixedFrom] = src.kpol === 'previous' || src.ks === 'previous' ? L(`проверка дозиметра от ${dateText(prev.date, en)}`, `dosimeter check of ${dateText(prev.date, en)}`) : '';
  }
  if (kind === 'cobalt' && Number.isFinite(tauUsed)) input.co_tau = exact(tauUsed);
  const pseudo = { ...session, mode: measured ? 'cal' : 'check' };
  const second = computeCheckBeam(j, pseudo, input, { en });
  const workValue = workSum.ok ? mainValue(work.result, kind) : NaN;
  const value = second ? mainValue(second.result, kind) : NaN;
  const ratio = workValue / value;
  const errors = second ? second.result.messages.filter((m) => m.level === 'error').length : 1;
  const ok = Number.isFinite(ratio) && ratio > 0 && errors === 0 && workSum.ok;
  const ssum = second?.summary;
  const sig = {
    workChamberId: work.chamber?.id || '',
    workElectrometerId: work.electrometer?.id || '',
    electrometerId,
    workNdw: Number(workSum.ndw),
    workKelec: Number(workSum.kelec),
    ndw: Number(ssum?.ndw),
    kelec: Number(ssum?.kelec),
    // k_pol и k_s второй камеры: 'assumed' — хотя бы один принят равным 1 (отношение смещено на неизвестную величину),
    // 'known' — измерены, введены или взяты из прошлой проверки. Смена основы начинает ряд заново.
    basis: src.kpol === 'assumed' || src.ks === 'assumed' ? 'assumed' : 'known',
  };
  return { check, kind, work, second, measured, src, prev, workValue, value, ratio, diff: ok ? (ratio - 1) * 100 : NaN, ok, errors, sig };
}

/** Проверка для записи в сеанс: показания, свои значения, форма второй камеры и итог. */
export function checkRecord(res) {
  const { check, second, sig } = res;
  const ssum = second?.summary;
  return {
    ...CHECK_DEFAULTS,
    ...Object.fromEntries(Object.entries(check).filter(([key]) => key in CHECK_DEFAULTS)),
    id: check.id || uid('k'),
    form: second?.form,
    summary: {
      ok: res.ok,
      kind: res.kind,
      ratio: res.ratio,
      diff: res.diff,
      value: res.value,
      workValue: res.workValue,
      at: 'zref',
      measured: res.measured,
      kpol: ssum?.kpolRaw,
      ks: ssum?.ksRaw,
      kpolSrc: res.src.kpol,
      ksSrc: res.src.ks,
      ...sig,
    },
  };
}

/**
 * Проверки сеанса для записи: каждая считается по рабочей камере своего пучка в записанном сеансе (works — Map
 * beamId → computeSessionBeam); проверки без результата не записываются. Возвращает { checks, skipped }.
 */
export function finalizeChecks(j, session, checks, works, opts = {}) {
  const out = [];
  let skipped = 0;
  for (const c of checks ?? []) {
    if (!checkStarted(c)) continue;
    const res = computeDosimeterCheck(j, session, c, works.get(c.beamId), opts);
    if (res?.ok) out.push(checkRecord(res));
    else skipped++;
  }
  return { checks: out, skipped };
}

// ---------------------------------------------------------------- ряды по сеансам
/** Пара камер в пучке: ключ ряда. */
export const pairKey = (beamId, workChamberId, chamberId) => `${beamId}|${workChamberId}|${chamberId}`;
const SIG_IDS = ['workChamberId', 'workElectrometerId', 'electrometerId'];
const SIG_NUMS = ['workNdw', 'ndw', 'workKelec', 'kelec'];
/** Основа k_pol и k_s второй камеры у записанной проверки (у проверок 0.17.0 — по источникам коэффициентов). */
const basisOf = (sum) => sum.basis ?? (sum.kpolSrc === 'assumed' || sum.ksSrc === 'assumed' ? 'assumed' : 'known');
/**
 * Почему с этой точки начинается новый отсчёт: 'equipment' — сменились электрометр или калибровочный коэффициент любой
 * из камер (сравниваются известные значения), 'factors' — k_pol и k_s второй камеры перестали быть принятыми равными 1
 * (или наоборот); '' — ряд продолжается.
 */
const sigChange = (a, b) => {
  if (SIG_IDS.some((key) => !isBlank(a[key]) && !isBlank(b[key]) && a[key] !== b[key]) || SIG_NUMS.some((key) => Number.isFinite(a[key]) && Number.isFinite(b[key]) && Math.abs(a[key] / b[key] - 1) > 1e-9)) return 'equipment';
  return basisOf(a) !== basisOf(b) ? 'factors' : '';
};

/**
 * Точки ряда пары камер (value — (r − 1)·100, %) по сеансам журнала в порядке дат; restart — с этой точки начинается
 * новый отсчёт (reason 'equipment'). extra — точка текущего сеанса (ещё не записанного или изменённого): точки этого
 * сеанса из журнала и сеансов позже него не берутся.
 */
export function checkPoints(j, { beamId, workChamberId, chamberId }, extra = null) {
  const pts = [];
  for (const s of j.sessions) {
    if (extra && (s.id === extra.sessionId || String(s.date) > String(extra.date))) continue;
    for (const c of s.checks ?? []) {
      const sum = c.summary;
      if (c.beamId !== beamId || c.chamberId !== chamberId || sum?.workChamberId !== workChamberId || !sum.ok || !Number.isFinite(sum.diff)) continue;
      pts.push({ day: dayNumber(s.date), date: s.date, sessionId: s.id, mode: s.mode, value: sum.diff, ratio: sum.ratio, measured: !!sum.measured, sig: sum, check: c });
    }
  }
  if (extra) pts.push(extra);
  const out = pts.filter((p) => Number.isFinite(p.day)).sort((a, b) => a.day - b.day);
  out.forEach((p, i) => {
    const why = i > 0 ? sigChange(p.sig, out[i - 1].sig) : '';
    p.restart = !!why;
    if (why) p.reason = why;
    p.provisional = basisOf(p.sig) === 'assumed';
  });
  return out;
}

/** Среднее и выборочное СКО. */
function stats(values) {
  const n = values.length;
  const mean = n ? values.reduce((s, x) => s + x, 0) / n : NaN;
  const sd = n > 1 ? Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : NaN;
  return { n, mean, sd };
}

/**
 * Сравнение проверки с прежними проверками той же пары в том же пучке (текущий отсчёт до этого сеанса).
 * Возвращает { n, mean, sd, sigma (не меньше SIGMA_FLOOR), delta, z, restart, from } или null, если проверка без результата.
 */
export function checkHistory(j, session, res) {
  if (!res?.ok) return null;
  const key = { beamId: res.check.beamId, workChamberId: res.sig.workChamberId, chamberId: res.check.chamberId };
  const cur = { day: dayNumber(session.date), date: session.date, sessionId: session.id || '', value: res.diff, sig: res.sig, current: true };
  if (!Number.isFinite(cur.day)) return null;
  const pts = checkPoints(j, key, cur);
  const i = pts.indexOf(cur);
  let from = i;
  while (from > 0 && !pts[from].restart) from--;
  const hist = pts.slice(from, i).filter((p) => !p.current);
  const st = stats(hist.map((p) => p.value));
  const sigma = Number.isFinite(st.sd) ? Math.max(st.sd, SIGMA_FLOOR) : NaN;
  const delta = st.n ? res.diff - st.mean : NaN;
  return { ...st, sigma, delta, z: st.n >= HISTORY_MIN ? delta / sigma : NaN, restart: !!cur.restart, reason: cur.reason || '', from: hist[0]?.date ?? '', last: hist.at(-1)?.date ?? '' };
}

/**
 * Три системы (разд. 4.4.2): в пучке не меньше двух проверок с прежними данными. Сдвиг (|z| ≥ WATCH_Z) у всех и одного
 * знака — вероятнее, изменилась рабочая система; только у одной — эта вторая камера.
 * items — [{ res, hist }]. Возвращает [{ beamId, verdict: 'work' | 'second' | 'none' | 'unclear', shifted: [res] }].
 */
export function checkVerdicts(items) {
  const byBeam = new Map();
  for (const it of items) {
    if (!it.res?.ok || !Number.isFinite(it.hist?.z)) continue;
    const list = byBeam.get(it.res.check.beamId) ?? [];
    list.push(it);
    byBeam.set(it.res.check.beamId, list);
  }
  const out = [];
  for (const [beamId, list] of byBeam) {
    if (list.length < 2) continue;
    const shifted = list.filter((it) => Math.abs(it.hist.z) >= WATCH_Z);
    const signs = new Set(shifted.map((it) => Math.sign(it.hist.z)));
    const verdict = !shifted.length ? 'none' : shifted.length === list.length && signs.size === 1 ? 'work' : shifted.length === 1 ? 'second' : 'unclear';
    out.push({ beamId, verdict, shifted: shifted.map((it) => it.res), n: list.length });
  }
  return out;
}

// ---------------------------------------------------------------- тексты
const pct = (v, d = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${ru(Math.abs(v), d)}`;
const fmtD = (iso) => dateText(iso, getLang() === 'en');

/** Замечания к проверке: [{ level, text, ref? }]. */
export function checkMessages(res, hist) {
  const out = [];
  if (!res) return out;
  const [kp, kx] = res.work.form?.protocol === 'tg51' ? ['P_pol', 'P_ion'] : ['k_pol', 'k_s'];
  if (!res.work.summary.ok) out.push({ level: 'error', text: L('У рабочей камеры этого пучка нет результата без ошибок: проверка не считается.', 'The working chamber of this beam has no error-free result: the check is not calculated.') });
  if (res.second) {
    for (const m of res.second.result.messages.filter((x) => x.level === 'error').slice(0, 4)) out.push({ level: 'error', text: L(`Вторая камера: ${m.text}`, `Second chamber: ${m.text}`), ref: m.ref });
  }
  if (!res.ok) return out;
  if (!res.measured) {
    const prevBoth = res.src.kpol === 'previous' && res.src.ks === 'previous';
    if (res.sig.basis === 'assumed') {
      // в пучке БВФ k_s второй камеры легко достигает 1 % — это уже не мелочь
      const fff = res.kind === 'photon' && !!res.work.form?.meta_fff;
      out.push({
        level: fff ? 'warn' : 'info',
        text: L(
          `Проверка предварительная: ${kp} и ${kx} второй камеры не измерены и прежних проверок с ними нет — недостающие приняты равными 1. Отношение может отличаться на десятые доли процента${fff ? `, а в этом пучке БВФ (большая доза за импульс) ${kx} — и на 1 % и больше` : ''}. Измерьте их (показания при обратной полярности и при V₂) — дальше они возьмутся из этой проверки, а сравнение с прежними начнётся заново: проверки с принятыми 1 с ними не смешиваются.`,
          `Provisional check: ${kp} and ${kx} of the second chamber have not been measured and there are no earlier checks with them; the missing ones are taken as 1. The ratio may be off by a few tenths of a percent${fff ? `, and in this FFF beam (high dose per pulse) ${kx} may be off by 1% or more` : ''}. Measure them (readings at the opposite polarity and at V₂): later checks take them from this one, and the comparison with earlier checks starts anew, so checks with factors taken as 1 are not mixed with them.`,
        ),
      });
    } else if (prevBoth) {
      out.push({ level: 'info', text: L(`${kp} и ${kx} второй камеры — из проверки от ${fmtD(res.prev.date)}.`, `${kp} and ${kx} of the second chamber are from the check of ${fmtD(res.prev.date)}.`) });
    }
  }
  if (res.sig.electrometerId && res.sig.electrometerId === res.sig.workElectrometerId) {
    out.push({ level: 'info', text: L('Обе камеры — с одним электрометром: его изменение в отношении сокращается, проверяются только камеры. Электрометр проверяют отдельно (контрольным источником или вторым электрометром).', 'Both chambers use the same electrometer: its change cancels in the ratio, so only the chambers are checked. Check the electrometer separately (with a check source or a second electrometer).') });
  }
  const lim = SANITY[res.kind] ?? 2;
  if (Math.abs(res.diff) > lim) {
    out.push({
      level: 'warn',
      text: L(
        `Дозы по двум камерам расходятся на ${pct(res.diff)} % — больше, чем обычно дают калибровки двух камер (${ru(lim, 0)} %). Проверьте N_D,w и k_elec обеих камер, модель второй камеры (от неё зависит k_Q), показания и их единицы.`,
        `The doses from the two chambers differ by ${pct(res.diff)}%, more than the calibrations of two chambers usually give (${ru(lim, 0)}%). Check N_D,w and k_elec of both chambers, the model of the second chamber (k_Q depends on it), the readings and their units.`,
      ),
    });
  }
  if (!hist) return out;
  if (hist.restart && !hist.n && hist.reason === 'factors') {
    out.push({ level: 'info', text: L(`${kp} и ${kx} второй камеры теперь известны (в прежних проверках были приняты равными 1): сравнение с прежними проверками начинается заново, с этой.`, `${kp} and ${kx} of the second chamber are now known (they were taken as 1 in earlier checks): the comparison with earlier checks starts anew from this one.`) });
  } else if (hist.restart && !hist.n) {
    out.push({ level: 'info', text: L('Сменился электрометр или калибровочный коэффициент одной из камер: сравнение с прежними проверками начинается заново, с этой.', 'An electrometer or a calibration coefficient of one of the chambers has changed: the comparison with earlier checks starts anew from this one.') });
  } else if (!hist.n) {
    out.push({ level: 'info', text: L('Первая проверка этой пары камер в этом пучке: следующие будут сравниваться с ней.', 'The first check of this pair of chambers in this beam: the following ones will be compared with it.') });
  } else if (hist.n < HISTORY_MIN) {
    out.push({ level: 'info', text: L(`От среднего прежних проверок (${hist.n}): ${pct(hist.delta)} %. Оценка разброса — с ${HISTORY_MIN} прежних проверок.`, `From the mean of earlier checks (${hist.n}): ${pct(hist.delta)}%. The scatter is estimated from ${HISTORY_MIN} earlier checks.`) });
  } else {
    const head = L(
      `От среднего прежних проверок (${hist.n}, с ${fmtD(hist.from)}; σ = ${ru(hist.sigma, 2)} %): ${pct(hist.delta)} % (${pct(hist.z, 1)}σ).`,
      `From the mean of earlier checks (${hist.n}, since ${fmtD(hist.from)}; σ = ${ru(hist.sigma, 2)}%): ${pct(hist.delta)}% (${pct(hist.z, 1)}σ).`,
    );
    if (Math.abs(hist.z) >= SHIFT_Z) {
      out.push({
        level: 'warn',
        text: `${head} ${L(
          'Отношение сместилось: изменилась одна из двух дозиметрических систем. Повторите измерение (установка, тепловое равновесие, предоблучение камер); если сдвиг подтвердился — чтобы понять, какая система изменилась, сравните с третьей камерой или контрольным источником.',
          'The ratio has shifted: one of the two dosimetry systems has changed. Repeat the measurement (setup, thermal equilibrium, pre-irradiation of the chambers); if the shift is confirmed, compare with a third chamber or a check source to find out which system changed.',
        )}`,
        ref: CHECK_REF,
      });
    } else if (Math.abs(hist.z) >= WATCH_Z) {
      out.push({ level: 'info', text: `${head} ${L('На границе обычного разброса: посмотрите следующую проверку.', 'At the edge of the usual scatter: watch the next check.')}` });
    } else {
      out.push({ level: 'info', text: `${head} ${L('В пределах обычного разброса.', 'Within the usual scatter.')}` });
    }
  }
  return out;
}

/** Замечание по трём системам: name(res) — подпись второй камеры. */
export function verdictMessage(v, beamName, name) {
  if (v.verdict === 'work') {
    return {
      level: 'warn',
      text: L(
        `${beamName}: отношение сместилось относительно всех вторых камер (${v.n}) в одну сторону — вероятнее, изменилась рабочая камера или её электрометр.`,
        `${beamName}: the ratio has shifted the same way against all second chambers (${v.n}): most likely the working chamber or its electrometer has changed.`,
      ),
      ref: CHECK_REF,
    };
  }
  if (v.verdict === 'second') {
    return {
      level: 'warn',
      text: L(
        `${beamName}: сдвиг только относительно камеры ${name(v.shifted[0])} — вероятнее, изменилась она, а рабочая в порядке.`,
        `${beamName}: a shift only against the chamber ${name(v.shifted[0])}: most likely it has changed and the working chamber is fine.`,
      ),
      ref: CHECK_REF,
    };
  }
  if (v.verdict === 'unclear') {
    return { level: 'warn', text: L(`${beamName}: сдвиги относительно вторых камер разного знака или не у всех — однозначного вывода нет, повторите измерения.`, `${beamName}: the shifts against the second chambers differ in sign or not all of them shifted; no clear conclusion, repeat the measurements.`), ref: CHECK_REF };
  }
  return { level: 'info', text: L(`${beamName}: отношения ко всем вторым камерам (${v.n}) — в пределах обычного разброса.`, `${beamName}: the ratios to all second chambers (${v.n}) are within their usual scatter.`) };
}

// ---------------------------------------------------------------- «Журнал и тренды»
/** Пары камер с проверками у пучков аппарата: [{ key, beamId, beamName, workChamberId, chamberId, n, lastDate, label }]. */
export function checkPairs(j, machineId) {
  const map = new Map();
  for (const s of j.sessions) {
    if (s.machineId !== machineId) continue;
    for (const c of s.checks ?? []) {
      const sum = c.summary;
      if (!sum?.ok) continue;
      const key = pairKey(c.beamId, sum.workChamberId, c.chamberId);
      const p = map.get(key) ?? { key, beamId: c.beamId, workChamberId: sum.workChamberId, chamberId: c.chamberId, n: 0, lastDate: '', last: c };
      p.n++;
      if (String(s.date) >= p.lastDate) Object.assign(p, { lastDate: String(s.date), last: c, lastSession: s });
      map.set(key, p);
    }
  }
  const textOf = (id) => chamberText(j.chambers.find((x) => x.id === id)) || L('камера удалена из журнала', 'chamber removed from the journal');
  return [...map.values()].map((p) => ({ ...p, beamName: beamOf(j, p.beamId)?.beam.name ?? '—', workText: textOf(p.workChamberId), secondText: textOf(p.chamberId) }));
}

/**
 * Контрольная карта отношения пары и оценка стабильности по текущему отсчёту:
 * { chart, stats: { n, mean, sd, from, to }, u } — u = выборочное СКО отношения (%), если в отсчёте не меньше MIN_POINTS проверок.
 */
export function checkChart(j, pair) {
  const pts = checkPoints(j, pair);
  const chart = controlChart(pts);
  const seg = chart.current;
  const cur = seg ? chart.points.slice(seg.from, seg.to + 1) : [];
  const st = stats(cur.map((p) => p.value));
  return { chart, stats: { ...st, from: cur[0]?.date ?? '', to: cur.at(-1)?.date ?? '' }, u: st.n >= MIN_POINTS && Number.isFinite(st.sd) ? st.sd : NaN };
}

/** Комментарий к своему значению бюджета неопределённости (строка «долговременная стабильность дозиметра»). */
export function stabilityNote(pair, cc) {
  const s = cc.stats;
  return L(
    `Разброс отношения доз ${pair.workText} / ${pair.secondText} в пучке ${pair.beamName}: s = ${ru(cc.u, 2)} % по ${s.n} проверкам с ${fmtD(s.from)} по ${fmtD(s.to)} (журнал, «Контроль дозиметра», ${CHECK_REF}). Весь разброс отнесён к рабочему дозиметру — оценка сверху.`,
    `Scatter of the dose ratio ${pair.workText} / ${pair.secondText} in the ${pair.beamName} beam: s = ${ru(cc.u, 2)}% over ${s.n} checks from ${fmtD(s.from)} to ${fmtD(s.to)} (journal, Dosimeter check, ${CHECK_REF}). The whole scatter is attributed to the working dosimeter: an upper estimate.`,
  );
}
