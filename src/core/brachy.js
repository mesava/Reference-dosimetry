// Брахитерапия: сила источника (ОМВК K̇_δ,R и сила воздушной кермы S_K) по колодезной камере (IAEA TRS-492, гл. 7–8)
// и по методу цилиндрического фантома PTW 9193 (DIN 6809-2, DGMP-Bericht 13, руководство PTW 9193).
// Единицы: S_K — U = мкГр·м²·ч⁻¹ = сГр·см²·ч⁻¹; численно S_K (U) = ОМВК (мкГр/ч на 1 м). Время — мс UTC.
// Этап 1: только расчёт, без интерфейса; разбор полей формы появится вместе с листами раздела.

import { L } from './i18n.js';
import { ru } from './units.js';
import { temperaturePressure, polarity } from './common.js';
import {
  HALF_LIVES,
  KSM_SOURCES,
  KSM_TABLE,
  KSM_TABLE_U,
  KSM_NO_DATA_U,
  KSM_NO_DATA_U_HDR_PDR,
  CERT_TOLERANCE,
  LEAKAGE_IGNORE,
  STABILITY_TOL,
  PHANTOM_KR,
  PHANTOM_KZP_IR,
  PHANTOM_KZP_REF_CHAMBER,
  DGMP_CHAMBERS,
  PTW_TO_DGMP,
  APPROX_TO_DGMP,
  PHANTOM_IR,
  PHANTOM_CO60,
  PHANTOM_DOSE_RATE_FACTOR,
  APPLICATOR_KA_STEEL,
} from './brachy-data.js';

const REF = {
  trs492: 'IAEA TRS-492 (2023)',
  trs398: 'TRS-398 Rev.1',
  dgmp13: 'DGMP-Bericht 13 (1999, испр. изд. 2006)',
  ptw9193: 'руководство PTW 9193 (D402.131.00/05, 2017)',
  azhari: 'Azhari et al. 2012, J. Med. Phys. 37 183–92',
};

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

// ——— Распад ———

/**
 * Период полураспада, сутки: из TRS-492, табл. 3, или свой (например, из сертификата камеры: PTW — 73,83 и 1925,3 сут).
 * @returns {{ days:number, own:boolean, error?:string }}
 */
export function halfLifeDays(nuclide, own) {
  if (Number.isFinite(own)) {
    if (own > 0) return { days: own, own: true };
    return { days: NaN, own: true, error: L('период полураспада должен быть больше нуля', 'the half-life must be greater than zero') };
  }
  const h = Object.hasOwn(HALF_LIVES, nuclide) ? HALF_LIVES[nuclide] : null;
  if (!h) return { days: NaN, own: false, error: L(`нет периода полураспада для «${nuclide}»`, `no half-life for "${nuclide}"`) };
  return { days: h.days, own: false };
}

/**
 * Поправка на распад источника: TRS-492, ур. (8): k_dec = exp(ln2·(t_meas − t_ref)/t½) = 2^((t_meas − t_ref)/t½);
 * ур. (9): K̇(t_ref) = K̇(t_meas)·k_dec. Время — мс (UTC), t½ — сутки.
 */
export function kDec(tMeas, tRef, halfDays) {
  return 2 ** ((tMeas - tRef) / DAY_MS / halfDays);
}

/**
 * Наибольшая относительная ошибка распада (доля), если известна только дата без времени: принимается 00:00 (так считает
 * таблица распада сертификата BEBIG; так же — в рабочей таблице отделения), истинное время позже не больше чем на сутки,
 * ошибка ≈ ln2·1 сут/t½ (¹⁹²Ir — около 0,94 %, ⁶⁰Co — 0,04 %).
 */
export function dateOnlyDecayError(halfDays) {
  return Math.LN2 / halfDays;
}

// ——— Дата и время ———

const ZONE_RE = /^(?:(Z|UTC|GMT)|(?:UTC|GMT)?\s*([+\-−])\s*(\d{1,2})(?::?(\d{2}))?|(МСК|MSK))$/i;

function parseZone(s) {
  const z = s.trim();
  if (z === '') return { given: false, offsetMin: NaN };
  const m = z.match(ZONE_RE);
  if (!m) return { error: true };
  if (m[1]) return { given: true, offsetMin: 0 };
  if (m[5]) return { given: true, offsetMin: 180 };
  const sign = m[2] === '+' ? 1 : -1;
  const h = Number(m[3]);
  const mm = m[4] ? Number(m[4]) : 0;
  if (h > 14 || mm > 59) return { error: true };
  return { given: true, offsetMin: sign * (h * 60 + mm) };
}

/**
 * Дата и время сертификата или измерения → мс UTC (TRS-492, разд. 3.2 и табл. 4: время сводить к UTC).
 * Принимает «2026-10-20 08:00», «2026-10-20T08:00:00+03:00», «20.10.26 8:00 GMT+3», «20.10.2026 08:00 МСК»,
 * «2021-10-27» (только дата). Без часового пояса берётся defaultOffsetMin (смещение от UTC в минутах, например
 * 180 для Москвы); если и он не задан — UTC. Без времени принимается 00:00 и выставляется dateOnly.
 * @returns {{ ms:number, dateOnly:boolean, zoneGiven:boolean, offsetMin:number, error?:string }}
 */
export function parseDateTime(raw, { defaultOffsetMin } = {}) {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  const bad = (error) => ({ ms: NaN, dateOnly: false, zoneGiven: false, offsetMin: NaN, error });
  if (s === '') return bad(L('дата не указана', 'the date is not given'));
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?(.*)$/);
  let y, mo, d;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?:,? (\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?(.*)$/);
    if (!m) return bad(L(`не удалось прочитать дату «${s}»`, `could not read the date "${s}"`));
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[3].length === 2) y += 2000;
  }
  const dateOnly = m[4] === undefined;
  const hh = dateOnly ? 0 : Number(m[4]);
  const mi = dateOnly ? 0 : Number(m[5]);
  const ss = m[6] ? Number(m[6]) : 0;
  const zone = parseZone(m[7] ?? '');
  if (zone.error) return bad(L(`не удалось прочитать часовой пояс «${m[7].trim()}»`, `could not read the time zone "${m[7].trim()}"`));
  const local = Date.UTC(y, mo - 1, d, hh, mi, 0) + ss * 1000;
  const check = new Date(local);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || hh > 23 || mi > 59 || ss >= 60) {
    return bad(L(`такой даты или времени нет: «${s}»`, `no such date or time: "${s}"`));
  }
  const offsetMin = zone.given ? zone.offsetMin : Number.isFinite(defaultOffsetMin) ? defaultOffsetMin : 0;
  return { ms: local - offsetMin * 60000, dateOnly, zoneGiven: zone.given, offsetMin };
}

// ——— Сертификат источника ———

/** Единицы ОМВК / силы воздушной кермы → U (мкГр·м²·ч⁻¹). Значения мощности кермы — на расстоянии 1 м. */
export const STRENGTH_UNITS = {
  U: { label: 'U (мкГр·м²·ч⁻¹ = сГр·см²·ч⁻¹)', labelEn: 'U (µGy·m²·h⁻¹ = cGy·cm²·h⁻¹)', toU: 1 },
  'mGy/h': { label: 'мГр/ч на 1 м', labelEn: 'mGy/h at 1 m', toU: 1e3 },
  'uGy/h': { label: 'мкГр/ч на 1 м', labelEn: 'µGy/h at 1 m', toU: 1 },
  'Gy/h': { label: 'Гр/ч на 1 м', labelEn: 'Gy/h at 1 m', toU: 1e6 },
  'Gy/s': { label: 'Гр/с на 1 м', labelEn: 'Gy/s at 1 m', toU: 3.6e9 },
  'uGy/s': { label: 'мкГр/с на 1 м', labelEn: 'µGy/s at 1 m', toU: 3600 },
};

/** Единицы активности → ГБк. */
export const ACTIVITY_UNITS = {
  GBq: { label: 'ГБк', labelEn: 'GBq', toGBq: 1 },
  TBq: { label: 'ТБк', labelEn: 'TBq', toGBq: 1e3 },
  MBq: { label: 'МБк', labelEn: 'MBq', toGBq: 1e-3 },
  Ci: { label: 'Ки', labelEn: 'Ci', toGBq: 37 },
  mCi: { label: 'мКи', labelEn: 'mCi', toGBq: 0.037 },
};

/**
 * Единицы керма-постоянной Γ_δ → мкГр·м²·ч⁻¹·ГБк⁻¹. 1 аГр·м²·с⁻¹·Бк⁻¹ = 10⁻¹⁸·3600·10⁹·10⁶ = 3,6 мкГр·м²·ч⁻¹·ГБк⁻¹.
 */
export const GAMMA_UNITS = {
  'uGy·m2/(h·GBq)': { label: 'мкГр·м²·ч⁻¹·ГБк⁻¹', labelEn: 'µGy·m²·h⁻¹·GBq⁻¹', toUperGBq: 1 },
  'aGy·m2/(s·Bq)': { label: 'аГр·м²·с⁻¹·Бк⁻¹', labelEn: 'aGy·m²·s⁻¹·Bq⁻¹', toUperGBq: 3.6 },
  'mGy·m2/(h·Ci)': { label: 'мГр·м²·ч⁻¹·Ки⁻¹', labelEn: 'mGy·m²·h⁻¹·Ci⁻¹', toUperGBq: 1e3 / 37 },
};

/**
 * Сила источника из сертификата → U. Если в сертификате только активность, нужна Γ_δ из того же сертификата:
 * S_K = A_app·Γ_δ (TRS-492, прил. I: кажущаяся активность — производная величина, только для справки).
 * @param {{ value:number, unit:string, gamma?:number, gammaUnit?:string }} p
 * @returns {{ U:number, fromActivity:boolean, error?:string }}
 */
export function certificateToU({ value, unit, gamma, gammaUnit }) {
  if (!(value > 0)) return { U: NaN, fromActivity: false, error: L('сила источника должна быть больше нуля', 'the source strength must be greater than zero') };
  if (Object.hasOwn(STRENGTH_UNITS, unit)) return { U: value * STRENGTH_UNITS[unit].toU, fromActivity: false };
  if (!Object.hasOwn(ACTIVITY_UNITS, unit)) return { U: NaN, fromActivity: false, error: L(`неизвестная единица: ${unit}`, `unknown unit: ${unit}`) };
  if (!Object.hasOwn(GAMMA_UNITS, gammaUnit ?? '')) return { U: NaN, fromActivity: true, error: L(`неизвестная единица Γ_δ: ${gammaUnit}`, `unknown Γ_δ unit: ${gammaUnit}`) };
  if (!(gamma > 0)) return { U: NaN, fromActivity: true, error: L('для пересчёта активности нужна керма-постоянная Γ_δ из сертификата', 'the air-kerma rate constant Γ_δ from the certificate is needed to convert the activity') };
  return { U: value * ACTIVITY_UNITS[unit].toGBq * gamma * GAMMA_UNITS[gammaUnit].toUperGBq, fromActivity: true };
}

/** Кажущаяся активность, ГБк, по силе источника (U) и Γ_δ (мкГр·м²·ч⁻¹·ГБк⁻¹): TRS-492, прил. I — только для справки. */
export function apparentActivityGBq(U, gammaUperGBq) {
  return U / gammaUperGBq;
}

/**
 * Сравнение измеренной силы источника с сертификатом производителя: TRS-492, разд. 8.6.2.
 * Оба значения — на одно и то же время. type: 'hdr' (HDR/PDR) или 'ldr' (среднее по зёрнам, seeds — их число).
 * @returns {{ dev:number, level:'ok'|'warn'|'error', text:string, ref:string }}
 */
export function compareCertificate({ measured, certificate, type = 'hdr', seeds }) {
  const dev = ((measured - certificate) / certificate) * 100;
  const a = Math.abs(dev);
  const d = `${dev >= 0 ? '+' : '−'}${ru(a, 1)} %`;
  const de = `${dev >= 0 ? '+' : '−'}${a.toFixed(1)}%`;
  const ref = `${REF.trs492}, разд. ${type === 'ldr' ? '8.6.2.2' : '8.6.2.1'}`;
  const t = CERT_TOLERANCE;
  if (type === 'ldr') {
    const few = Number.isFinite(seeds) && seeds < t.ldrMinSeeds;
    const fewText = few
      ? L(` Измерено ${seeds} зёрен — нужно не меньше ${t.ldrMinSeeds}.`, ` ${seeds} seeds were measured; at least ${t.ldrMinSeeds} are needed.`)
      : '';
    if (a <= t.ldr) {
      return { dev, level: few ? 'warn' : 'ok', text: L(`Отклонение среднего от сертификата ${d}: в пределах ${t.ldr} %.`, `The mean deviates from the certificate by ${de}: within ${t.ldr}%.`) + fewText, ref };
    }
    return {
      dev,
      level: 'warn',
      text:
        L(
          `Отклонение среднего от сертификата ${d}: больше ${t.ldr} %. Измерьте ещё ${t.ldrMinSeeds} зёрен той же партии и повторите сравнение; если отклонение подтвердится — обсудите с производителем.`,
          `The mean deviates from the certificate by ${de}: more than ${t.ldr}%. Measure another ${t.ldrMinSeeds} seeds of the same batch and repeat the comparison; if the deviation is confirmed, discuss it with the manufacturer.`,
        ) + fewText,
      ref,
    };
  }
  if (a <= t.hdrInvestigate) {
    return { dev, level: 'ok', text: L(`Отклонение от сертификата ${d}: в пределах ${t.hdrInvestigate} %.`, `Deviation from the certificate ${de}: within ${t.hdrInvestigate}%.`), ref };
  }
  if (a <= t.hdrStop) {
    return {
      dev,
      level: 'warn',
      text: L(
        `Отклонение от сертификата ${d}: больше ${t.hdrInvestigate} % — выясните причину (ввод, единицы, время, k_sm, сертификаты).`,
        `Deviation from the certificate ${de}: more than ${t.hdrInvestigate}%; find the cause (input, units, time, k_sm, certificates).`,
      ),
      ref,
    };
  }
  return {
    dev,
    level: 'error',
    text: L(
      `Отклонение от сертификата ${d}: больше ${t.hdrStop} % — источник клинически не использовать, пока расхождение не выяснено.`,
      `Deviation from the certificate ${de}: more than ${t.hdrStop}%; do not use the source clinically until the discrepancy is resolved.`,
    ),
    ref,
  };
}

// ——— Колодезная камера ———

/** Единицы калибровочного коэффициента колодезной камеры → Гр·м²·ч⁻¹·А⁻¹ (так в сертификате PTW). */
export const WELL_N_UNITS = {
  'Gy·m2/(h·A)': { label: 'Гр·м²·ч⁻¹·А⁻¹', labelEn: 'Gy·m²·h⁻¹·A⁻¹', toSI: 1 },
  'U/A': { label: 'U/А (сГр·см²·ч⁻¹·А⁻¹)', labelEn: 'U/A (cGy·cm²·h⁻¹·A⁻¹)', toSI: 1e-6 },
  'U/nA': { label: 'U/нА', labelEn: 'U/nA', toSI: 1e-6 / 1e-9 },
  'U/pA': { label: 'U/пА', labelEn: 'U/pA', toSI: 1e-6 / 1e-12 },
};

/** Ток электрометра → А; заряд → Кл (тогда нужно время накопления). */
export const CURRENT_UNITS = {
  pA: { label: 'пА', labelEn: 'pA', toA: 1e-12 },
  nA: { label: 'нА', labelEn: 'nA', toA: 1e-9 },
  A: { label: 'А', labelEn: 'A', toA: 1 },
};
export const CHARGE_UNITS = {
  pC: { label: 'пКл', labelEn: 'pC', toC: 1e-12 },
  nC: { label: 'нКл', labelEn: 'nC', toC: 1e-9 },
  C: { label: 'Кл', labelEn: 'C', toC: 1 },
};
export const TIME_UNITS = {
  s: { label: 'с', labelEn: 's', toS: 1 },
  min: { label: 'мин', labelEn: 'min', toS: 60 },
};

/**
 * Показание → ток, А. Ток вводится сразу (pA, nA, A) или как заряд за время накопления (TRS-492, разд. 8.2.2:
 * не меньше 60 с).
 * @returns {{ amps:number, error?:string }}
 */
export function readingToAmps({ value, unit, time, timeUnit = 's' }) {
  if (Object.hasOwn(CURRENT_UNITS, unit)) return { amps: value * CURRENT_UNITS[unit].toA };
  if (!Object.hasOwn(CHARGE_UNITS, unit)) return { amps: NaN, error: L(`неизвестная единица показания: ${unit}`, `unknown reading unit: ${unit}`) };
  const s = time * (Object.hasOwn(TIME_UNITS, timeUnit) ? TIME_UNITS[timeUnit].toS : NaN);
  if (!(s > 0)) return { amps: NaN, error: L('для заряда нужно время накопления больше нуля', 'a collection time greater than zero is needed for a charge reading') };
  return { amps: (value * CHARGE_UNITS[unit].toC) / s };
}

/** Модель TW33004 или TN33004 (не TM): по Schüller et al. 2015 у неё 1/I линейно зависит от 1/V (TRS-492, разд. 8.2.3.7). */
export const isTwTn33004 = (model) => /\bT[WN]\s*-?\s*33004/i.test(String(model ?? ''));

/**
 * Поправка на рекомбинацию методом двух напряжений.
 * TRS-492, ур. (33) при V2 = V1/2: k_s = 3/(4 − M1/M2) (общая рекомбинация, 1/M ∝ 1/V²); для другого отношения
 * n = V1/V2 — та же зависимость в общем виде, TRS-398 Rev.1, ур. (16): k_s = (n² − 1)/(n² − M1/M2).
 * Справочно — линейный вариант (1/M ∝ 1/V), который Schüller et al. 2015 нашли у PTW TW/TN33004 (TRS-492, разд. 8.2.3.7):
 * k_s = (n − 1)/(n − M1/M2).
 * @returns {{ value:number, linear:number, equation:string, preferLinear:boolean, error?:string }}
 */
export function ksWell({ m1, m2, v1, v2, model }) {
  const n = Number.isFinite(v1) && Number.isFinite(v2) ? Math.abs(v1) / Math.abs(v2) : 2;
  const r = Math.abs(m1) / Math.abs(m2);
  const preferLinear = isTwTn33004(model);
  if (!(n > 1) || !(r > 0) || !(r < n)) {
    return { value: NaN, linear: NaN, equation: '', preferLinear, error: L('нужно |V1| > |V2| и M1/M2 меньше V1/V2', '|V1| > |V2| and M1/M2 below V1/V2 are required') };
  }
  const value = (n * n - 1) / (n * n - r);
  const linear = (n - 1) / (n - r);
  const equation = Math.abs(n - 2) < 1e-9
    ? L(`${REF.trs492}, ур. (33): k_s = 3/(4 − M1/M2)`, `${REF.trs492}, Eq. (33): k_s = 3/(4 − M1/M2)`)
    : L(`${REF.trs398}, ур. (16): k_s = (n² − 1)/(n² − M1/M2), n = ${ru(n, 2)}`, `${REF.trs398}, Eq. (16): k_s = (n² − 1)/(n² − M1/M2), n = ${n.toFixed(2)}`);
  return { value, linear, equation, preferLinear };
}

/**
 * Поправка на утечку: k_leak = 1 − I_утечки/I. В лечебном учреждении утечку меньше 0,1 % показания можно не учитывать
 * (TRS-492, разд. 8.2.3.4) — тогда k_leak = 1 и ignored = true.
 */
export function kLeak(amps, leakAmps) {
  if (!Number.isFinite(leakAmps) || leakAmps === 0) return { value: 1, ratio: 0, ignored: true };
  const ratio = leakAmps / amps;
  if (Math.abs(ratio) < LEAKAGE_IGNORE) return { value: 1, ratio, ignored: true };
  return { value: 1 - ratio, ratio, ignored: false };
}

/**
 * Неопределённость k_sm = 1 при отсутствии данных, %: 5 — если один источник HDR, а другой PDR, иначе 2
 * (TRS-492, разд. 8.3).
 */
export function ksmNoDataU({ smPdr, sm0Pdr } = {}) {
  return Boolean(smPdr) !== Boolean(sm0Pdr) ? KSM_NO_DATA_U_HDR_PDR : KSM_NO_DATA_U;
}

/**
 * k_sm,sm0 по TRS-492, табл. 8 (только SI HDR 1000 Plus с держателем 70010). sm — источник пользователя, sm0 — источник
 * калибровки (id из KSM_SOURCES). Для камеры не из таблицы (withTable = false) или модели не из таблицы — 1
 * с дополнительной стандартной неопределённостью по ksmNoDataU; smPdr, sm0Pdr — признак PDR для таких моделей.
 * @returns {{ value:number, u:number, inTable:boolean }}
 */
export function ksmLookup(sm, sm0, { withTable = true, smPdr, sm0Pdr } = {}) {
  if (sm && sm === sm0) return { value: 1, u: 0, inTable: true };
  const i = KSM_SOURCES.findIndex((s) => s.id === sm);
  const j = KSM_SOURCES.findIndex((s) => s.id === sm0);
  if (withTable && i >= 0 && j >= 0) return { value: KSM_TABLE[i][j], u: KSM_TABLE_U, inTable: true };
  const pdr = (k, own) => (k >= 0 ? Boolean(KSM_SOURCES[k].pdr) : Boolean(own));
  return { value: 1, u: ksmNoDataU({ smPdr: pdr(i, smPdr), sm0Pdr: pdr(j, sm0Pdr) }), inTable: false };
}

/**
 * Сила источника по колодезной камере: TRS-492, ур. (21)–(22) и (27):
 * K̇(t_ref) = N·M·k_sm,sm0·k_dec, M = M_raw·k_TP·k_leak·k_elec·k_pol·k_s (k_alti — только для низкоэнергетических зёрен,
 * для PTW 33004 данных нет, разд. 8.2.3.2).
 * @param {object} p
 * @param {number} p.N        калибровочный коэффициент в единицах nUnit
 * @param {string} p.nUnit    ключ WELL_N_UNITS
 * @param {number} p.amps     ток, А (без поправок)
 * @returns {{ U:number, mGyh:number, M:number, factors:object }} U — S_K на t_ref; mGyh — ОМВК, мГр/ч на 1 м
 */
export function wellStrength({ N, nUnit = 'Gy·m2/(h·A)', amps, kTP = 1, kLeak: kl = 1, kElec = 1, kPol = 1, kS = 1, kSm = 1, kDec: kd = 1 }) {
  const nSI = N * (Object.hasOwn(WELL_N_UNITS, nUnit) ? WELL_N_UNITS[nUnit].toSI : NaN);
  const M = amps * kTP * kl * kElec * kPol * kS;
  const K = nSI * M * kSm * kd; // Гр·м²·ч⁻¹
  return { U: K * 1e6, mGyh: K * 1e3, M, factors: { kTP, kLeak: kl, kElec, kPol, kS, kSm, kDec: kd } };
}

/**
 * Калибровочный коэффициент колодезной камеры по источнику известной силы: TRS-492, ур. (23)–(24):
 * N = K̇(t_ref)/(M(t_meas)·k_dec). U — сила на t_ref, amps — исправленный ток, А. Результат — Гр·м²·ч⁻¹·А⁻¹.
 */
export function wellCalibration({ U, amps, kDec: kd = 1 }) {
  return (U * 1e-6) / (amps * kd);
}

/**
 * Перекрёстная калибровка рабочей камеры по эталонной на том же нуклиде и в том же держателе: TRS-492, ур. (18)–(19):
 * N_field = M_ref/M_field · N_ref · k_sm,sm0. Показания — исправленные и приведённые к одному времени.
 * Перекрёстная калибровка между разными нуклидами (¹⁹²Ir ↔ ⁶⁰Co) не допускается (разд. 7.7).
 */
export function crossCalibrate({ mRef, mField, nRef, kSm = 1 }) {
  return (mRef / mField) * nRef * kSm;
}

/** Долговременная стабильность: отклонение от исходного значения, %, и ok при |Δ| ≤ 0,5 % (TRS-492, разд. 8.5). */
export function stabilityCheck(value, baseline) {
  const dev = ((value - baseline) / baseline) * 100;
  return { dev, ok: Math.abs(dev) <= STABILITY_TOL };
}

/**
 * Полный расчёт по колодезной камере на числах (поля формы разбирает интерфейс).
 * readings — серия показаний (одна единица), leak — ток утечки в тех же единицах (необязательно); T, P (кПа), T0, P0;
 * pol: { mNormal, mOpposite } и ks: { m1, m2, v1, v2 } — необязательно; kSm — число или { sm, sm0 };
 * tMeas, tRef — мс UTC; halfDays — t½, сут; cert — { U, type, seeds } на t_ref (необязательно).
 * @returns {{ U:number, mGyh:number, Umeas:number, factors:object, compare?:object, messages:Array }}
 */
export function computeWell(p) {
  const messages = [];
  const add = (level, text, ref = null) => messages.push({ level, scope: 'brachy', text, ref });
  const xs = (p.readings ?? []).filter(Number.isFinite);
  if (!xs.length) {
    add('error', L('Нет показаний электрометра.', 'No electrometer readings.'));
    return { U: NaN, mGyh: NaN, Umeas: NaN, factors: {}, messages };
  }
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const rd = readingToAmps({ value: mean, unit: p.unit, time: p.time, timeUnit: p.timeUnit });
  if (rd.error) {
    add('error', rd.error);
    return { U: NaN, mGyh: NaN, Umeas: NaN, factors: {}, messages };
  }
  const leakA = Number.isFinite(p.leak) ? readingToAmps({ value: p.leak, unit: p.unit, time: p.time, timeUnit: p.timeUnit }).amps : NaN;
  const kl = kLeak(rd.amps, leakA);
  if (Number.isFinite(leakA) && leakA !== 0) {
    if (kl.ignored) add('info', L(`Утечка ${ru(kl.ratio * 100, 2)} % показания — меньше 0,1 %, не учитывается.`, `Leakage is ${(kl.ratio * 100).toFixed(2)}% of the reading, below 0.1%; it is ignored.`), `${REF.trs492}, разд. 8.2.3.4`);
    else add('warn', L(`Утечка ${ru(kl.ratio * 100, 2)} % показания — учтена поправкой k_leak = ${ru(kl.value, 4)}.`, `Leakage is ${(kl.ratio * 100).toFixed(2)}% of the reading; corrected with k_leak = ${kl.value.toFixed(4)}.`), `${REF.trs492}, разд. 8.2.3.4`);
  }
  const kTP = Number.isFinite(p.T) && Number.isFinite(p.P)
    ? temperaturePressure({ T: p.T, P: p.P, T0: p.T0 ?? 20, P0: p.P0 ?? 101.325, abs0: 273.15 })
    : 1;
  const kPol = p.pol && Number.isFinite(p.pol.mNormal) && Number.isFinite(p.pol.mOpposite) ? polarity(p.pol.mNormal, p.pol.mOpposite) : 1;
  let kS = 1;
  if (p.ks && Number.isFinite(p.ks.m1) && Number.isFinite(p.ks.m2)) {
    const r = ksWell({ ...p.ks, model: p.model });
    if (r.error) add('error', L(`k_s: ${r.error}.`, `k_s: ${r.error}.`), `${REF.trs492}, ур. (33)`);
    else {
      kS = r.preferLinear ? r.linear : r.value;
      if (r.preferLinear) {
        add('info', L(`Для PTW TW/TN33004 зависимость 1/I от 1/V линейная (Schüller et al. 2015): k_s = ${ru(r.linear, 4)} по линейному варианту; по ур. (33) было бы ${ru(r.value, 4)}.`, `For the PTW TW/TN33004, 1/I is linear in 1/V (Schüller et al. 2015): k_s = ${r.linear.toFixed(4)} from the linear form; Eq. (33) would give ${r.value.toFixed(4)}.`), `${REF.trs492}, разд. 8.2.3.7`);
      }
    }
  }
  const kElec = Number.isFinite(p.kElec) ? p.kElec : 1;
  let kSm = 1;
  if (Number.isFinite(p.kSm)) kSm = p.kSm;
  else if (p.kSm && typeof p.kSm === 'object') {
    const k = ksmLookup(p.kSm.sm, p.kSm.sm0, p.kSm);
    kSm = k.value;
    if (!k.inTable) {
      add('info', L(`Для этой камеры или моделей источников нет данных в табл. 8: k_sm,sm0 = 1, к неопределённости добавляется ${ru(k.u, 0)} %.`, `Table 8 has no data for this chamber or source models: k_sm,sm0 = 1, ${k.u}% is added to the uncertainty.`), `${REF.trs492}, разд. 8.3`);
    }
  }
  let kd = 1;
  if (Number.isFinite(p.tMeas) && Number.isFinite(p.tRef)) {
    if (!(p.halfDays > 0)) add('error', L('Не задан период полураспада.', 'The half-life is not set.'));
    else kd = kDec(p.tMeas, p.tRef, p.halfDays);
  }
  const at = wellStrength({ N: p.N, nUnit: p.nUnit, amps: rd.amps, kTP, kLeak: kl.value, kElec, kPol, kS, kSm, kDec: kd });
  const out = { U: at.U, mGyh: at.mGyh, Umeas: at.U / kd, factors: at.factors, messages };
  if (p.cert && p.cert.U > 0 && Number.isFinite(at.U)) {
    out.compare = compareCertificate({ measured: at.U, certificate: p.cert.U, type: p.cert.type, seeds: p.cert.seeds });
    add(out.compare.level === 'ok' ? 'info' : out.compare.level, out.compare.text, out.compare.ref);
  }
  return out;
}

// ——— Метод цилиндрического фантома PTW 9193 ———

/**
 * Геометрический фактор фантома для камеры: k_zp,i = 1,187 · k_V,i/k_V,M23332 (DGMP 13, ур. (13), сноска 4, табл. 2.1,
 * r = 8 см). chamber — модель PTW (например, «30013», «TM30013», «M23332») или камера из APPROX_TO_DGMP (approx = true:
 * k_V взят у камеры DGMP с близкой полостью).
 * @returns {{ kzp:number, kV:number, dgmp:string, approx:boolean, error?:string }}
 */
export function phantomKzp(chamber) {
  const s = String(chamber ?? '').toUpperCase().replace(/\s+/g, '');
  let dgmp = Object.hasOwn(DGMP_CHAMBERS, s) ? s : null;
  const near = APPROX_TO_DGMP.find((x) => x.re.test(s));
  if (!dgmp && near) dgmp = near.dgmp;
  if (!dgmp) {
    const num = s.match(/(\d{4,6})/)?.[1];
    if (num && Object.hasOwn(PTW_TO_DGMP, num)) dgmp = PTW_TO_DGMP[num];
  }
  if (!dgmp) {
    return {
      kzp: NaN,
      kV: NaN,
      dgmp: '',
      approx: false,
      error: L(
        `для камеры «${chamber}» нет k_V в DGMP 13, табл. 2.1 — введите k_zp вручную или определите свой коэффициент сличением с колодезной камерой`,
        `DGMP 13, Table 2.1 has no k_V for the chamber "${chamber}"; enter k_zp manually or determine your own factor by comparison with the well-type chamber`,
      ),
    };
  }
  const kV = DGMP_CHAMBERS[dgmp].kV8;
  return { kzp: (PHANTOM_KZP_IR * kV) / DGMP_CHAMBERS[PHANTOM_KZP_REF_CHAMBER].kV8, kV, dgmp, approx: Boolean(near) && !Object.hasOwn(DGMP_CHAMBERS, s) };
}

/**
 * Постоянные нуклида для фантома: ¹⁹²Ir — DGMP 13 / руководство PTW (табл. 1); ⁶⁰Co — Azhari 2012, табл. 2
 * (g_w, g_a, t_w,a; k_zp в DGMP 13 для ⁶⁰Co нет).
 */
function phantomConstants(nuclide) {
  if (nuclide === 'Co-60') return { ...PHANTOM_IR, gW: PHANTOM_CO60.gW, gA: PHANTOM_CO60.gA, tWA: PHANTOM_CO60.tWA };
  return PHANTOM_IR;
}

/**
 * Множитель c в K̇ (Гр/ч на 1 м) = c · N · Ṁ, где Ṁ — исправленное показание, нКл/ч, N — Гр/нКл (N_w, N_a) или Р/нКл (N_s):
 * DGMP 13, ур. (14)–(16); руководство PTW 9193, ур. (8), (10), (12).
 * N_w: (1 − g_w)⁻¹ · t_w,a⁻¹ · k_wp · k_zp · k_r · k_Q;
 * N_a (N_K): k_ap · k_zp · k_r · k_Q;
 * N_s (N_X): (1 − g_a)⁻¹ · W/e · k_RC · k_ap · k_zp · k_r · k_Q.
 */
export function phantomFactor({ calib = 'Nw', kzp, kQ = 1, nuclide = 'Ir-192' }) {
  const c = phantomConstants(nuclide);
  const common = kzp * PHANTOM_KR * kQ;
  if (calib === 'Nw') return (common * c.kwp) / (1 - c.gW) / c.tWA;
  if (calib === 'Na') return common * c.kap;
  if (calib === 'Ns') return (common * c.kap * c.We * c.kRC) / (1 - c.gA);
  return NaN;
}

/** Единицы калибровочного коэффициента камеры в фантоме: N_w, N_a → Гр/нКл; N_s → Р/нКл. */
export const PHANTOM_N_UNITS = {
  'Gy/nC': { label: 'Гр/нКл', labelEn: 'Gy/nC', toBase: 1 },
  'cGy/nC': { label: 'сГр/нКл', labelEn: 'cGy/nC', toBase: 1e-2 },
  'mGy/nC': { label: 'мГр/нКл', labelEn: 'mGy/nC', toBase: 1e-3 },
  'Gy/C': { label: 'Гр/Кл', labelEn: 'Gy/C', toBase: 1e-9 },
  'R/nC': { label: 'Р/нКл', labelEn: 'R/nC', toBase: 1 },
  'R/C': { label: 'Р/Кл', labelEn: 'R/C', toBase: 1e-9 },
};

/**
 * Исправленное показание в фантоме, нКл/ч: среднее по четырём положениям камеры (руководство PTW 9193), за вычетом
 * заряда на перемещение источника m_a, умноженное на k_ρ·k_pol·k_s·k_elec и k_τ = 60/τ (τ — время облучения, мин).
 */
export function phantomReading({ readings, tauMin, transit = 0, kRho = 1, kPol = 1, kS = 1, kElec = 1 }) {
  const xs = (readings ?? []).filter(Number.isFinite);
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const M = mean - (Number.isFinite(transit) ? transit : 0);
  return { mean, M, n: xs.length, rate: M * kRho * kPol * kS * kElec * (60 / tauMin) };
}

/**
 * Сила источника по фантому: K̇ (мГр/ч на 1 м) = c · N · Ṁ · k_A. k_A — поправка на аппликатор (DGMP 13 определяет
 * K̇ с клиническим аппликатором; для сравнения с сертификатом источника нужна k_A, например сталь — Azhari 2012, табл. 2).
 * kTot (необязательно) — свой или справочный общий множитель вместо c (тогда N и Ṁ в тех же единицах).
 * @returns {{ mGyh:number, U:number, factor:number }}
 */
export function phantomStrength({ N, nUnit = 'Gy/nC', rate, calib = 'Nw', kzp, kQ = 1, nuclide = 'Ir-192', kA = 1, kTot }) {
  const factor = Number.isFinite(kTot) ? kTot : phantomFactor({ calib, kzp, kQ, nuclide });
  const n = N * (Object.hasOwn(PHANTOM_N_UNITS, nUnit) ? PHANTOM_N_UNITS[nUnit].toBase : NaN);
  const K = factor * n * rate * kA; // Гр/ч на 1 м (для N_s множитель W/e·k_RC переводит Р в Гр)
  return { mGyh: K * 1e3, U: K * 1e6, factor };
}

/**
 * Свой общий множитель фантома по сличению с колодезной камерой на том же источнике (основной путь для ⁶⁰Co, где в
 * DGMP 13 данных нет): k_tot = K̇_колодезная / (N · Ṁ), обе силы — на одно время. Возвращает и эквивалентный k_zp
 * при постоянных нуклида (для сравнения с литературой). Аппликатор, если он был при измерении в фантоме, входит в k_tot.
 */
export function phantomOwnFactor({ wellMGyh, N, nUnit = 'Gy/nC', rate, calib = 'Nw', kQ = 1, nuclide = 'Ir-192' }) {
  const n = N * (Object.hasOwn(PHANTOM_N_UNITS, nUnit) ? PHANTOM_N_UNITS[nUnit].toBase : NaN);
  const kTot = wellMGyh / 1e3 / (n * rate);
  const unitKzp = phantomFactor({ calib, kzp: 1, kQ, nuclide });
  return { kTot, kzp: kTot / unitKzp };
}

/**
 * Мощность поглощённой дозы в воде в точке измерения фантома: Ḋ_w,zp (сГр/мин; 8 см) = 0,2435 · K̇ (мГр/ч; 1 м),
 * руководство PTW 9193, ур. (15). Только для ¹⁹²Ir.
 */
export function phantomDoseRate(mGyh, nuclide = 'Ir-192') {
  return nuclide === 'Ir-192' ? PHANTOM_DOSE_RATE_FACTOR * mGyh : NaN;
}

/** Справочная k_A для стального аппликатора (Azhari 2012, табл. 2): ¹⁹²Ir 1,0165, ⁶⁰Co 1,0267. */
export function applicatorKaSteel(nuclide) {
  return Object.hasOwn(APPLICATOR_KA_STEEL, nuclide) ? APPLICATOR_KA_STEEL[nuclide] : NaN;
}

/**
 * Геометрический фактор линейного источника на поперечной оси (θ = 90°): G_L(r) = β/(L·r), β = 2·arctg(L/(2r)),
 * TG-43U1, ур. (4); при L = 0 — точечный источник, 1/r². r и L — в см, результат — см⁻².
 */
export function geometryLine(r, L) {
  if (!(r > 0) || !(L >= 0)) return NaN;
  return L === 0 ? 1 / (r * r) : (2 * Math.atan(L / (2 * r))) / (L * r);
}

/**
 * Мощность поглощённой дозы в воде на поперечной оси по TG-43 (F(r, 90°) = 1): Ḋ(r) = Ḋ_w,1 · G_L(r)/G_L(1) · g_L(r),
 * TG-43U1, ур. (1). Ḋ_w,1 = Λ · S_K (ур. 1 при r = 1 см): Λ — сГр·ч⁻¹·Ед⁻¹, S_K — Ед → сГр/ч.
 */
export function tg43Transverse({ dw1, r, L, gL }) {
  const g = geometryLine(r, L) / geometryLine(1, L);
  return { value: dw1 * g * gL, gRatio: g };
}

export { REF as BRACHY_CORE_REF };
