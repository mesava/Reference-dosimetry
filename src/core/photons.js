// Расчёт поглощённой дозы в воде для МВ фотонов по TG-51 (+ аддендум 2014) и TRS-398 Rev.1.
// Принимает значения полей формы (строки и массивы строк, как их ввёл пользователь) и возвращает
// все промежуточные поправки, итоговую дозу, замечания с источниками и флаги для подсветки полей.

import { parseNumber, parseCells, isBlank, pressureToKPa, ndwToGyPerNC, ru } from './units.js';
import { temperaturePressure, polarity } from './common.js';
import * as TG51 from './tg51.js';
import * as TRS from './trs398.js';
import { findChamber, chamberLabel } from './chambers.js';
import { parseProfile, kvolFromProfile } from './profile.js';

export const FORM_DEFAULTS = {
  protocol: 'trs', // 'trs' | 'tg51' | 'both'

  meta_institution: '',
  meta_machine: '',
  meta_beam: '',
  meta_energy: '',
  meta_fff: false,
  meta_date: '',
  meta_staff: [''],
  meta_notes: '',

  setup_geometry: 'SSD', // 'SSD' | 'SAD' | 'manual'
  setup_ssd: '100',
  setup_field: '10',
  setup_depth: '10',

  ch_model: '', // id камеры из базы | 'CUSTOM' | 'MY:…' (сохранённая своя камера)
  ch_serial: '',
  ch_ndw: '',
  ch_ndw_unit: 'Gy/nC',
  ch_T0: '20',
  ch_P0: '101,325',

  // своя камера
  cc_maker: '',
  cc_model: '',
  cc_volume: '',
  cc_length: '',
  cc_radius: '',
  cc_wall: '',
  cc_wall_thickness: '',
  cc_electrode: '',
  cc_waterproof: true,
  cc_analog: '',
  cc_a: '',
  cc_b: '',

  el_model: '',
  el_serial: '',
  el_kelec: '1,000',
  lab_pol_applied: true,
  lab_kpol: '',
  lab_ks_applied: true,
  lab_ks: '',

  env_T: '',
  env_P: '',
  env_P_unit: 'kPa',

  rd_mu: '100',
  rd_polarity: '+',
  rd_V1: '300',
  rd_V2: '100',
  rd_beam: 'pulsed', // 'pulsed' | 'scanned'
  rd_M1: ['', '', ''],
  rd_Mopp: ['', '', ''],
  rd_M2: ['', '', ''],
  rd_kleak: '1,000',

  q51_method: 'open', // 'open' | 'foil50' | 'foil30' | 'interim' | 'manual'
  q51_pdd10: '',
  q51_pdd10pb: '',
  q51_manual: '',

  qtrs_method: 'ratio', // 'ratio' (измерение на 20 и 10 см) | 'pdd2010' (через PDD)
  qtrs_v20: '',
  qtrs_v10: '',
  qtrs_fff_pdd10: '',

  kqtrs_mode: 'formula', // 'formula' | 'table' | 'manual'
  kqtrs_manual: '',
  kq51_manual_on: false,
  kq51_manual: '',

  prof_mode: 'formula22', // 'formula22' | 'table11' | 'manual' | 'profile' (только для БВФ)
  prof_value: '',
  prof_length: '',
  prof_sdd: '',
  prof_text: '',

  dd_on: true,
  dd_zmax: '',
  dd_pdd: '',
  dd_tmr: '',
  dd_nominal: '1,000',
};

const REF = {
  tg51: 'TG-51 (1999)',
  add: 'аддендум TG-51 (2014)',
  r374: 'WGTG51 Report 374',
  trs: 'TRS-398 Rev.1',
};

/** Приводит данные из старых сохранённых файлов к текущей форме. */
export function normalizeForm(input) {
  const f = { ...FORM_DEFAULTS, ...input };
  const cells = (v) => (Array.isArray(v) ? v.map((x) => String(x ?? '')) : String(v ?? '').trim() === '' ? ['', '', ''] : String(v).replace(/,(?=\s)/g, ' ').trim().split(/[\s;]+/));
  f.rd_M1 = cells(f.rd_M1);
  f.rd_Mopp = cells(f.rd_Mopp);
  f.rd_M2 = cells(f.rd_M2);
  if (!Array.isArray(f.meta_staff)) f.meta_staff = [String(f.meta_staff ?? '')];
  if (input && 'meta_physicist' in input && !('meta_staff' in input)) f.meta_staff = [String(input.meta_physicist ?? '')];
  if (f.meta_staff.length === 0) f.meta_staff = [''];
  if (f.ch_model === 'OTHER') f.ch_model = 'CUSTOM';
  if (input && input.qtrs_method === 'direct') {
    f.qtrs_method = 'ratio';
    f.qtrs_v20 = String(input.qtrs_tpr ?? '');
    f.qtrs_v10 = '1';
  } else if (input && input.qtrs_method === 'ratio' && 'qtrs_m20' in input && !('qtrs_v20' in input)) {
    f.qtrs_v20 = input.qtrs_m20;
    f.qtrs_v10 = input.qtrs_m10;
  } else if (input && input.qtrs_method === 'pdd2010' && 'qtrs_pdd20' in input && !('qtrs_v20' in input)) {
    f.qtrs_v20 = input.qtrs_pdd20;
    f.qtrs_v10 = input.qtrs_pdd10;
  }
  if (input && 'kqtrs_manual_on' in input && !('kqtrs_mode' in input)) f.kqtrs_mode = input.kqtrs_manual_on ? 'manual' : 'formula';
  if (f.prof_mode === 'generic') f.prof_mode = 'formula22';
  if (f.prof_mode === 'none') {
    // раньше «не применяется» означало k_vol = 1 — сохраняем это явно
    f.prof_mode = 'manual';
    if (isBlank(f.prof_value)) f.prof_value = '1,000';
  }
  return f;
}

/** Максимальное относительное отклонение отдельного показания от среднего. */
function maxRelDeviation(series) {
  if (!series || series.n < 2 || !series.mean) return 0;
  return Math.max(...series.values.map((v) => Math.abs(v - series.mean) / Math.abs(series.mean)));
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** Камера из базы или своя камера, собранная из полей cc_*. */
export function resolveChamber(f) {
  if (f.ch_model === 'CUSTOM' || String(f.ch_model).startsWith('MY:')) {
    const analog = findChamber(f.cc_analog);
    const a = parseNumber(f.cc_a);
    const b = parseNumber(f.cc_b);
    const hasAB = Number.isFinite(a) && Number.isFinite(b);
    return {
      id: f.ch_model,
      custom: true,
      maker: f.cc_maker || 'Своя камера',
      model: f.cc_model || '',
      rCavMm: parseNumber(f.cc_radius),
      lengthMm: parseNumber(f.cc_length),
      sleeve: !f.cc_waterproof,
      analog,
      hasAB,
      trs: hasAB ? { a, b } : analog?.trs ?? null,
      trsTable: hasAB ? null : analog?.trsTable ?? null,
      tg51: analog?.tg51 ?? null,
      tg51Legacy: analog?.tg51Legacy ?? null,
    };
  }
  return findChamber(f.ch_model);
}

/** Условия измерения дозы по выбранной геометрии. */
function geometry(f) {
  if (f.setup_geometry === 'manual') {
    return {
      kind: 'manual',
      ssd: parseNumber(f.setup_ssd),
      field: parseNumber(f.setup_field),
      depth: parseNumber(f.setup_depth),
    };
  }
  if (f.setup_geometry === 'SAD') return { kind: 'SAD', ssd: 90, field: 10, depth: 10, sad: 100 };
  return { kind: 'SSD', ssd: 100, field: 10, depth: 10 };
}

export function computePhotons(form) {
  const f = normalizeForm(form);
  const messages = [];
  const flags = {};
  const rank = { info: 0, warn: 1, error: 2 };
  const flag = (key, level) => {
    if (!flags[key] || rank[level] > rank[flags[key]]) flags[key] = level;
  };
  const add = (level, scope, text, ref = null, field = null) => {
    messages.push({ level, scope, text, ref });
    if (field) [].concat(field).forEach((k) => flag(k, level));
  };

  const want51 = f.protocol === 'tg51' || f.protocol === 'both';
  const wantTRS = f.protocol === 'trs' || f.protocol === 'both';
  const fff = !!f.meta_fff;
  const energy = parseNumber(f.meta_energy);

  const read = (key, label, scope = 'common') => {
    const v = parseNumber(f[key]);
    if (!Number.isFinite(v)) {
      add('error', scope, isBlank(f[key]) ? `Не заполнено поле «${label}».` : `Не удалось прочитать число в поле «${label}».`, null, key);
    }
    return v;
  };
  const readCells = (key, label) => {
    const s = parseCells(f[key]);
    if (s.error) add('error', 'common', `«${label}»: ${s.error}.`, null, key);
    else if (s.n === 0) add('error', 'common', `Не заполнено поле «${label}».`, null, key);
    else if (s.mean === 0) add('error', 'common', `«${label}»: среднее показание равно нулю.`, null, key);
    return s;
  };

  // ------------------------------------------------------------ геометрия
  const geo = geometry(f);
  if (geo.kind === 'manual') {
    if (!Number.isFinite(geo.ssd)) read('setup_ssd', 'РИП');
    else if (geo.ssd < 50 || geo.ssd > 150) add('error', 'common', 'РИП задаётся в сантиметрах (обычно 100).', null, 'setup_ssd');
    else if (Math.abs(geo.ssd - 100) > 1e-9) {
      add('info', 'common', 'РИП отличается от 100 см: TRS-398 задаёт 100 см (табл. 15), TG-51 допускает обычное клиническое расстояние. Качество пучка в любом случае измеряют при 100 см.', `${REF.trs}, табл. 14–15; ${REF.tg51}, разд. IX.A`, 'setup_ssd');
    }
    if (!Number.isFinite(geo.field)) read('setup_field', 'Размер поля');
    else if (geo.field < 2 || geo.field > 40) add('error', 'common', 'Размер поля задаётся одним числом в сантиметрах, например 10.', null, 'setup_field');
    else if (Math.abs(geo.field - 10) > 1e-9) {
      add('warn', 'common', 'Стандартное поле — 10 × 10 см: при другом размере результат не является референсной дозой по протоколу.', `${REF.trs}, табл. 15; ${REF.tg51}, разд. IX.A`, 'setup_field');
    }
    if (!Number.isFinite(geo.depth)) read('setup_depth', 'Глубина камеры');
    else if (geo.depth < 0.5 || geo.depth > 30) add('error', 'common', 'Глубина камеры задаётся в сантиметрах, например 10.', null, 'setup_depth');
    else if (Math.abs(geo.depth - 10) > 1e-9) {
      add('warn', 'common', 'Опорная глубина для МВ фотонов — 10 г/см²: k_Q в обоих протоколах относится к ней.', `${REF.trs}, табл. 15; ${REF.tg51}, разд. IX.A`, 'setup_depth');
    }
  }
  const zref = geo.depth;

  // ---------------------------------------------------------------- камера
  const chamber = resolveChamber(f);
  if (isBlank(f.ch_model)) add('error', 'common', 'Выберите тип камеры.', null, 'ch_model');
  if (chamber?.custom) {
    if (isBlank(f.cc_model)) add('warn', 'common', 'Укажите модель своей камеры: она попадёт в протокол.', null, 'cc_model');
  }
  if (chamber?.sleeve) {
    add('info', 'common', 'Камера не водонепроницаема: используйте тот же чехол (ПММА ≤ 1 мм), что и при калибровке.', `${REF.tg51}, разд. V.A; ${REF.trs}, разд. 6.2.2`);
  }

  const ndwRaw = read('ch_ndw', 'N_D,w');
  const ndw = Number.isFinite(ndwRaw) ? ndwToGyPerNC(ndwRaw, f.ch_ndw_unit) : NaN;
  if (Number.isFinite(ndw) && (ndw < 1e-3 || ndw > 5)) {
    add('warn', 'common', `N_D,w = ${ndw.toPrecision(4).replace('.', ',')} Гр/нКл выглядит неправдоподобно: проверьте единицы.`, null, 'ch_ndw');
  }
  const T0 = read('ch_T0', 'T₀ из сертификата');
  const P0 = read('ch_P0', 'P₀ из сертификата');
  if (Number.isFinite(T0) && (T0 < 15 || T0 > 25)) add('error', 'common', 'T₀ задаётся в °C (обычно 20 или 22).', null, 'ch_T0');
  if (Number.isFinite(T0) && f.protocol === 'tg51' && Math.abs(T0 - TG51.TG51_T0) > 1e-9) {
    add('info', 'tg51', 'Проверьте стандартные условия в сертификате: у лабораторий ADCL это 22 °C и 101,33 кПа, в формуле P_TP используются значения из сертификата.', `${REF.tg51}, ур. (10)`);
  }
  if (Number.isFinite(P0) && (P0 < 95 || P0 > 105)) add('warn', 'common', 'P₀ задаётся в кПа (обычно 101,325 или 101,33).', null, 'ch_P0');
  const kelec = read('el_kelec', 'k_elec (P_elec)');
  if (Number.isFinite(kelec) && Math.abs(kelec - 1) > 0.02) add('warn', 'common', 'k_elec отличается от 1 больше чем на 2 %: проверьте сертификат электрометра.', null, 'el_kelec');

  // ------------------------------------------------------------ окружающая среда
  const T = read('env_T', 'Температура воды');
  const Pin = read('env_P', 'Давление');
  const P = Number.isFinite(Pin) ? pressureToKPa(Pin, f.env_P_unit) : NaN;
  if (Number.isFinite(P) && (P < 50 || P > 110)) {
    add('error', 'common', `Давление ${ru(P, 2)} кПа вне правдоподобного диапазона: проверьте единицы.`, null, 'env_P');
  }
  if (Number.isFinite(T)) {
    if (T < 5 || T > 40) add('error', 'common', `Температура воды ${T} °C неправдоподобна.`, null, 'env_T');
    else if (T < 15 || T > 25) {
      add('info', 'common', 'Температура воды вне 15–25 °C: тепловое расширение полости может стать заметным.', `${REF.add}, разд. 5.A.5`, 'env_T');
    }
  }

  // ------------------------------------------------------------- показания
  const mu = read('rd_mu', 'Мониторные единицы');
  if (Number.isFinite(mu) && mu <= 0) add('error', 'common', 'Число МЕ должно быть больше нуля.', null, 'rd_mu');
  const V1 = read('rd_V1', 'Рабочее напряжение V₁');
  const V2 = read('rd_V2', 'Пониженное напряжение V₂');
  if (Number.isFinite(V1) && Number.isFinite(V2) && Math.abs(V1) <= Math.abs(V2)) {
    add('error', 'common', 'Рабочее напряжение V₁ должно быть больше пониженного V₂.', null, ['rd_V1', 'rd_V2']);
  }
  if (Number.isFinite(V1) && Math.abs(V1) > 300) {
    add('warn', 'common', 'Аддендум TG-51 рекомендует для цилиндрических камер не более 300 В.', `${REF.add}, разд. 4.E`, 'rd_V1');
  }
  const M1 = readCells('rd_M1', 'M при V₁, обычная полярность');
  const Mopp = readCells('rd_Mopp', 'M при V₁, обратная полярность');
  const M2 = readCells('rd_M2', 'M при V₂');
  for (const [s, label, key] of [[M1, 'при V₁', 'rd_M1'], [Mopp, 'обратной полярности', 'rd_Mopp'], [M2, 'при V₂', 'rd_M2']]) {
    const d = maxRelDeviation(s);
    const pct = ru(d * 100, 2);
    if (d > 0.05) {
      add('error', 'common', `Показания ${label} расходятся на ${pct} % от среднего: вероятно, ошибка ввода.`, null, key);
    } else if (d > 0.005) {
      add('warn', 'common', `Разброс показаний ${label} до ${pct} % от среднего: ускоритель или камера нестабильны; Report 374 советует повторять облучения, пока отклонение не станет меньше ±0,1 % без тренда.`, `${REF.r374}, разд. 4.4.2`, key);
    } else if (d > 0.001) {
      add('info', 'common', `Разброс показаний ${label} до ${pct} % от среднего: Report 374 советует повторять облучения, пока отклонение не станет меньше ±0,1 % без тренда.`, `${REF.r374}, разд. 4.4.2`, key);
    }
  }
  const kleak = read('rd_kleak', 'Поправка на утечку');
  if (Number.isFinite(kleak) && Math.abs(kleak - 1) > 0.001) {
    add('warn', 'common', 'Утечка больше 0,1 % показания: камера не отвечает критерию эталонного класса, причину нужно выяснить.', `${REF.add}, табл. III; ${REF.trs}, табл. 3`, 'rd_kleak');
  }

  const readingsOk = M1.n > 0 && !M1.error && M1.mean !== 0;
  const m1 = readingsOk ? Math.abs(M1.mean) : NaN;

  // полярность
  let kpolRaw = NaN;
  if (readingsOk && Mopp.n > 0 && !Mopp.error) {
    kpolRaw = polarity(M1.mean, Mopp.mean);
    if (Math.abs(kpolRaw - 1) > 0.004) {
      add('warn', 'common', `k_pol = ${ru(kpolRaw, 4)} выходит за пределы 1 ± 0,004: для камеры эталонного класса эффект полярности должен быть меньше 0,4 %. Проверьте камеру, кабель и время стабилизации после смены полярности.`, `${REF.trs}, табл. 3; ${REF.add}, табл. III`, 'kpol');
    }
    if (Math.abs(kpolRaw - 1) > 0.003 && Number.isFinite(energy) && energy <= 6 && f.lab_pol_applied && want51) {
      add('info', 'tg51', 'P_pol отличается от 1 больше чем на 0,3 % при энергии ≤ 6 МВ: TG-51 требует знать P_pol в пучке лаборатории. Если лаборатория не вносила поправку на полярность, снимите отметку в разделе 2 и введите это значение.', `${REF.tg51}, разд. VII.A`, 'kpol');
    }
  }
  let kpolQ0 = 1;
  if (!f.lab_pol_applied) kpolQ0 = read('lab_kpol', 'Поправка на полярность при калибровке');
  const kpol = kpolRaw / kpolQ0;

  // рекомбинация
  const nV = Math.abs(V1) / Math.abs(V2);
  const recOk = readingsOk && M2.n > 0 && !M2.error && M2.mean !== 0 && Number.isFinite(nV) && nV > 1;
  if (readingsOk && M2.n > 0 && Math.sign(M1.mean) !== Math.sign(M2.mean)) {
    add('error', 'common', 'Показания при V₁ и V₂ должны быть сняты при одной и той же (обычной) полярности.', null, 'rd_M2');
  }
  const ratio12 = recOk ? Math.abs(M1.mean) / Math.abs(M2.mean) : NaN;
  if (recOk && ratio12 < 1) {
    add('error', 'common', 'k_s (P_ion) не может быть меньше 1: при пониженном напряжении собирается меньше заряда. Показание при V₂ больше, чем при V₁ — проверьте показания и напряжения.', `${REF.trs}, разд. 4.4.3.4`, ['ks', 'Pion', 'rd_M2']);
  }
  let ksQ0 = 1;
  if (!f.lab_ks_applied) ksQ0 = read('lab_ks', 'Поправка на рекомбинацию при калибровке');

  // ------------------------------------------------------------- TRS-398
  const trs = { enabled: wantTRS };
  if (wantTRS) {
    trs.kTP = temperaturePressure({ T, P, T0, P0, abs0: TRS.TRS_ABS0 });
    trs.kelec = kelec;
    trs.kpol = kpol;
    trs.kpolRaw = kpolRaw;
    trs.kpolQ0 = kpolQ0;
    trs.kleak = kleak;
    if (recOk) {
      const r = TRS.ks({ m1: M1.mean, m2: M2.mean, v1: Math.abs(V1), v2: Math.abs(V2), beam: f.rd_beam });
      trs.ksRaw = r.value;
      trs.ksEquation = r.equation;
      if (r.error) add('error', 'trs', cap(r.error) + '.', `${REF.trs}, табл. 10`, 'ks');
      r.notes.forEach((n) => add('warn', 'trs', cap(n) + '.', `${REF.trs}, разд. 4.4.3.4`, 'ks'));
      if (nV < 3 - 1e-9) add('info', 'trs', 'TRS-398 рекомендует отношение напряжений V₁/V₂ ≥ 3.', `${REF.trs}, разд. 4.4.3.4`);
      trs.ks = r.value / ksQ0;
      trs.ksQ0 = ksQ0;
      if (trs.ks > 1.05) add('error', 'trs', `k_s = ${ru(trs.ks, 4)} > 1,05: метод двух напряжений неприменим, нужна другая камера или другой метод.`, `${REF.trs}, табл. 3`, 'ks');
      if (ratio12 >= 1 && trs.ks < 1) add('error', 'trs', `k_s = ${ru(trs.ks, 4)} < 1: так быть не может, проверьте показания и поправку лаборатории.`, `${REF.trs}, разд. 4.4.3.4`, 'ks');
    } else {
      trs.ks = NaN;
    }

    // качество пучка
    let tpr = NaN;
    const v20 = parseNumber(f.qtrs_v20);
    const v10 = parseNumber(f.qtrs_v10);
    const label20 = f.qtrs_method === 'pdd2010' ? 'PDD(20)' : 'M на 20 см';
    const label10 = f.qtrs_method === 'pdd2010' ? 'PDD(10)' : 'M на 10 см';
    if (!Number.isFinite(v20)) read('qtrs_v20', label20, 'trs');
    if (!Number.isFinite(v10)) read('qtrs_v10', label10, 'trs');
    if (Number.isFinite(v10) && v10 === 0) add('error', 'trs', `${label10} не может быть нулевым.`, null, 'qtrs_v10');
    if (Number.isFinite(v20) && Number.isFinite(v10) && v10 !== 0) {
      const ratio = Math.abs(v20) / Math.abs(v10);
      if (f.qtrs_method === 'pdd2010') {
        tpr = TRS.tprFromPdd2010(ratio);
        trs.tprEquation = 'сноска 36: TPR20,10 = 1,2661·PDD(20)/PDD(10) − 0,0595';
        trs.pdd2010 = ratio;
        if (fff) add('info', 'trs', 'Формула TPR20,10 через PDD20,10 выведена для пучков с выравнивающим фильтром; по TRS-398 её можно с известной долей точности применять и к БВФ.', `${REF.trs}, сноска 36`);
      } else {
        tpr = ratio;
        trs.tprEquation = 'TPR20,10 = M(20 см)/M(10 см) при РИК 100 см, поле 10 × 10 см в плоскости камеры';
      }
    }
    if (Number.isFinite(tpr) && (tpr < 0.5 || tpr > 0.9)) {
      add('error', 'trs', `TPR20,10 = ${ru(tpr, 3)} неправдоподобно: проверьте значения на 20 и 10 см.`, null, ['tpr', 'qtrs_v20', 'qtrs_v10']);
    }
    trs.tpr = tpr;
    if (fff && Number.isFinite(energy) && energy > 10) {
      add('warn', 'trs', 'TRS-398 Rev.1 распространяется на пучки БВФ только до ~10 МВ.', `${REF.trs}, разд. 6.1`);
    }

    // оценка TPR20,10 для БВФ по PDD(10) — только для сравнения
    if (fff) {
      let src = null;
      let pdd10 = parseNumber(f.qtrs_fff_pdd10);
      if (Number.isFinite(pdd10)) src = 'введено';
      else if (f.qtrs_method === 'pdd2010' && Number.isFinite(v10)) {
        pdd10 = v10;
        src = 'PDD(10) из определения TPR20,10';
      } else if (geo.kind === 'SSD' && Number.isFinite(parseNumber(f.dd_pdd))) {
        pdd10 = parseNumber(f.dd_pdd);
        src = 'PDD(10) из раздела 7';
      }
      if (Number.isFinite(pdd10)) {
        if (pdd10 < 50 || pdd10 > 90) {
          add('warn', 'trs', 'PDD(10) для оценки TPR20,10 вне 50–90 %: проверьте ввод.', null, src === 'введено' ? 'qtrs_fff_pdd10' : null);
        }
        const est = TRS.tprEstimateFromPdd10(pdd10);
        trs.fffEstimate = { pdd10, value: est, source: src, diff: Number.isFinite(tpr) ? (tpr / est - 1) * 100 : NaN };
      }
    }

    // k_Q: формула (34), табл. 16, вручную
    const kf = TRS.kQ(chamber, tpr);
    const kt = TRS.kQFromTable(chamber, tpr);
    trs.kQFormula = kf.value;
    trs.kQTable = kt.value;
    if (Number.isFinite(kf.value) && Number.isFinite(kt.value)) trs.kQDiff = (kt.value / kf.value - 1) * 100;
    const mode = f.kqtrs_mode;
    if (mode === 'manual') {
      trs.kQ = read('kqtrs_manual', 'k_Q (TRS-398), измеренный в лаборатории', 'trs');
      trs.kQSource = 'измерен в лаборатории для этой камеры';
      if (Number.isFinite(trs.kQ) && (trs.kQ < 0.9 || trs.kQ > 1.02)) add('warn', 'trs', 'k_Q для МВ фотонов обычно 0,94–1,00: проверьте ввод.', null, 'kqtrs_manual');
    } else {
      const k = mode === 'table' ? kt : kf;
      if (!chamber || isBlank(f.ch_model)) {
        /* ошибка «выберите камеру» уже есть */
      } else if (chamber.custom && !chamber.trs) {
        add('error', 'trs', 'Для своей камеры нет данных TRS-398: выберите аналог из табл. 45, задайте a и b или введите k_Q, измеренный в лаборатории.', `${REF.trs}, разд. 6.5`, ['kQtrs', 'cc_analog']);
      } else if (!chamber.trs) {
        add('error', 'trs', 'Для этой камеры в TRS-398 Rev.1 нет k_Q: введите значение, измеренное в лаборатории.', `${REF.trs}, табл. 45`, 'kQtrs');
      } else if (mode === 'table' && !chamber.trsTable) {
        add('error', 'trs', 'Табличные значения есть только для камер из табл. 16: выберите расчёт по формуле (34).', `${REF.trs}, табл. 16`, 'kQtrs');
      } else if (k.error && Number.isFinite(tpr)) {
        add('error', 'trs', cap(k.error) + '.', `${REF.trs}, табл. 16`, ['kQtrs', 'tpr']);
      }
      trs.kQ = k.value;
      trs.kQSource = k.source;
      if (chamber?.custom && chamber.trs) {
        if (chamber.hasAB) add('info', 'trs', 'k_Q рассчитан по ур. (34) с параметрами a и b, введёнными для своей камеры.', `${REF.trs}, ур. (34)`);
        else add('warn', 'trs', `В TRS-398 Rev.1 нет данных для этой камеры; k_Q взят по камере-аналогу ${chamberLabel(chamber.analog)}. Предпочтительнее k_Q, измеренный в лаборатории.`, `${REF.trs}, разд. 6.5`, 'kQtrs');
      }
    }
    if (!chamber?.custom) (chamber?.notes || []).filter((n) => n.scope === 'trs').forEach((n) => add(n.level, 'trs', n.text));
  }

  // ------------------------------------------------------------- TG-51
  const tg = { enabled: want51 };
  if (want51) {
    tg.PTP = temperaturePressure({ T, P, T0, P0, abs0: TG51.TG51_ABS0 });
    tg.Pelec = kelec;
    tg.Ppol = kpol;
    tg.PpolRaw = kpolRaw;
    tg.PpolQ0 = kpolQ0;
    tg.Pleak = kleak;
    if (recOk) {
      tg.PionRaw = TG51.pIon({ mH: M1.mean, mL: M2.mean, vH: Math.abs(V1), vL: Math.abs(V2), beam: 'pulsed' });
      if (nV < 2 - 1e-9) add('warn', 'tg51', 'TG-51: пониженное напряжение должно быть меньше рабочего как минимум вдвое.', `${REF.tg51}, разд. VII.D.2`, ['rd_V1', 'rd_V2']);
      if (tg.PionRaw > 1.05) add('error', 'tg51', `P_ion = ${ru(tg.PionRaw, 4)} > 1,05: неопределённость поправки недопустима, нужна другая камера.`, `${REF.tg51}, разд. VII.D.1`, 'Pion');
      tg.Pion = tg.PionRaw / ksQ0;
      tg.PionQ0 = ksQ0;
      if (ratio12 >= 1 && tg.Pion < 1) add('error', 'tg51', `P_ion = ${ru(tg.Pion, 4)} < 1: так быть не может, проверьте показания и поправку лаборатории.`, `${REF.tg51}, разд. VII.D`, 'Pion');
      if (!f.lab_ks_applied) {
        add('info', 'tg51', 'TG-51 предполагает, что N_D,w отнесён к полному собиранию заряда. Раз лаборатория не вносила поправку на рекомбинацию, P_ion поделён на её значение при калибровке.', `${REF.tg51}, ур. (7), разд. VII.D.1`);
      }
    } else {
      tg.Pion = NaN;
    }

    const q = TG51.pdd10x({
      method: f.q51_method,
      pdd10: parseNumber(f.q51_pdd10),
      pdd10Pb: parseNumber(f.q51_pdd10pb),
      manual: parseNumber(f.q51_manual),
    });
    if (q.error) add('error', 'tg51', cap(q.error) + '.', `${REF.tg51}, разд. VIII.B`, 'pdd10x');
    tg.pdd10x = q.value;
    tg.pdd10xEquation = q.equation;
    if (fff && f.q51_method === 'interim') {
      add('error', 'tg51', 'Промежуточная формула (15) верна только для пучков с выравнивающим фильтром; для БВФ измерьте %dd(10)Pb со свинцовой фольгой.', `${REF.add}, разд. 4.K(3)`, 'q51_method');
    } else if (fff && f.q51_method === 'open') {
      add('warn', 'tg51', 'Для всех пучков БВФ, в том числе ниже 10 МВ, %dd(10) измеряют со свинцовой фольгой.', `${REF.add}, разд. 4.K(3); ${REF.r374}, разд. 3.3`, 'q51_method');
    } else if (f.q51_method === 'interim' && !q.error) {
      add('info', 'tg51', 'Формула (15) без фольги допустима только для пучков с фильтром и при расстоянии от шторок до поверхности воды не меньше 45 см; в бюджет неопределённости добавляют компонент (ошибка k_Q до ~0,2 %).', `${REF.tg51}, разд. VIII.B; ${REF.add}, разд. 4.H`);
    }
    if ((f.q51_method === 'foil50' || f.q51_method === 'foil30') && !q.error) {
      add('info', 'tg51', 'Уберите свинцовую фольгу перед измерением дозы: забытая фольга даёт ошибку до 5 %.', `${REF.r374}, разд. 3.3`);
    }

    if (f.kq51_manual_on) {
      tg.kQ = read('kq51_manual', 'k_Q (TG-51) вручную', 'tg51');
      tg.kQSource = 'введено вручную';
    } else {
      const k = TG51.kQ(chamber, q.value);
      if (!chamber || isBlank(f.ch_model)) {
        /* ошибка «выберите камеру» уже есть */
      } else if (chamber.custom && !chamber.tg51 && !chamber.tg51Legacy) {
        add('error', 'tg51', 'Для своей камеры выберите аналог с данными TG-51 или введите k_Q вручную.', `${REF.tg51}, разд. XI`, ['kQ51', 'cc_analog']);
      } else if (!chamber.tg51 && !chamber.tg51Legacy) {
        add('error', 'tg51', 'Для этой камеры в TG-51 нет k_Q: введите значение вручную.', `${REF.add}, табл. I`, 'kQ51');
      } else if (k.error && Number.isFinite(q.value)) {
        add('error', 'tg51', cap(k.error) + '.', `${REF.add}, табл. I`, ['kQ51', 'pdd10x']);
      }
      tg.kQ = k.value;
      tg.kQSource = k.source;
      if (chamber?.custom && (chamber.tg51 || chamber.tg51Legacy)) {
        add('info', 'tg51', `k_Q взят по ближайшей камере ${chamberLabel(chamber.analog)}. TG-51: совпадать должны материал стенки, радиус полости, наличие алюминиевого электрода и толщина стенки; тогда точность около 0,5 %.`, `${REF.tg51}, разд. XI`);
      } else if (chamber?.tg51Legacy) {
        add('info', 'tg51', 'Для этой камеры используются данные исходного TG-51 (1999): в аддендуме её нет.', `${REF.add}, разд. 3.E`);
      }
    }
    if (!chamber?.custom) (chamber?.notes || []).filter((n) => n.scope === 'tg51').forEach((n) => add(n.level, 'tg51', n.text));
  }

  // --------------------------------------- поправка на профиль (k_vol / P_rp)
  let lengthMm = parseNumber(f.prof_length);
  if (!Number.isFinite(lengthMm) && Number.isFinite(chamber?.lengthMm)) lengthMm = chamber.lengthMm;
  const sddGeometry = geo.kind === 'SAD' ? 100 : geo.ssd + geo.depth;
  let sddCm = parseNumber(f.prof_sdd);
  if (!Number.isFinite(sddCm)) sddCm = sddGeometry;

  let prof = { value: 1, method: 'не применяется: пучок с выравнивающим фильтром', active: false };
  if (fff) {
    prof = { value: NaN, method: '', active: true };
    const tpr = trs.tpr;
    const needTpr = () => {
      if (!wantTRS) add('error', 'common', 'Для расчёта k_vol по TRS-398 нужен TPR20,10: включите протокол TRS-398 или введите значение вручную.', null, 'prof_mode');
    };
    if (f.prof_mode === 'manual') {
      const v = read('prof_value', 'k_vol / P_rp');
      prof = { value: v, method: 'введено вручную', active: true };
    } else if (f.prof_mode === 'formula22' || f.prof_mode === 'table11') {
      needTpr();
      if (!Number.isFinite(lengthMm)) add('error', 'common', 'Укажите длину полости камеры (мм).', null, 'prof_length');
      else if (lengthMm <= 0) add('error', 'common', 'Длина полости должна быть больше нуля.', null, 'prof_length');
      else if (wantTRS && Number.isFinite(tpr)) {
        if (lengthMm < 1 || lengthMm > 40) add('warn', 'common', `Длина полости ${ru(lengthMm, 1)} мм необычна: проверьте, что она введена в миллиметрах.`, null, 'prof_length');
        if (f.prof_mode === 'formula22' && (sddCm < 80 || sddCm > 150)) add('warn', 'common', `РИД ${ru(sddCm, 0)} см необычно: проверьте, что оно введено в сантиметрах.`, null, 'prof_sdd');
        if (f.prof_mode === 'formula22') {
          const v = TRS.kvolGeneric({ tpr, lengthCm: lengthMm / 10, sddCm });
          prof = { value: v, method: `ур. (22) TRS-398: L = ${ru(lengthMm, 1)} мм, РИД = ${ru(sddCm, 0)} см`, active: true };
        } else {
          const r = TRS.kvolFromTable11({ tpr, lengthCm: lengthMm / 10 });
          if (r.error) add('error', 'common', cap(r.error) + '. Используйте формулу (22) или своё значение.', `${REF.trs}, табл. 11`, ['kvol', 'prof_length']);
          prof = { value: r.value, method: `табл. 11 TRS-398: L = ${ru(lengthMm, 1)} мм, РИД 110 см`, active: true };
          if (r.note) prof.method += `; ${r.note}`;
          if (Math.abs(sddGeometry - TRS.TRS_TABLE11.sddCm) > 0.5) {
            add('warn', 'common', `Табл. 11 рассчитана для РИД = 110 см, а в вашей геометрии РИД = ${ru(sddGeometry, 0)} см: используйте формулу (22).`, `${REF.trs}, табл. 11`, 'kvol');
          }
        }
        if (want51) add('info', 'tg51', 'В TG-51 P_rp определяют по измеренному профилю; здесь использована оценка TRS-398.', `${REF.r374}, ур. (8)`);
      }
    } else if (f.prof_mode === 'profile') {
      const parsed = parseProfile(f.prof_text);
      if (parsed.error) add('error', 'common', `Профиль: ${parsed.error}.`, null, 'prof_text');
      else if (parsed.points.length === 0) add('error', 'common', 'Вставьте измеренный профиль: в каждой строке положение (мм) и значение.', null, 'prof_text');
      else if (!Number.isFinite(lengthMm)) add('error', 'common', 'Укажите длину полости камеры (мм).', null, 'prof_length');
      else {
        const r = kvolFromProfile(parsed.points, lengthMm);
        if (r.error) add('error', 'common', `Профиль: ${r.error}.`, null, 'prof_text');
        prof = { value: r.value, method: `ур. (21) TRS-398 по измеренному профилю (точек: ${parsed.points.length}), L = ${ru(lengthMm, 1)} мм`, active: true };
        if (want51) add('info', 'tg51', 'Для пучков БВФ аддендум TG-51 допускает, что может понадобиться двумерный профиль; здесь используется одномерное усреднение вдоль оси камеры (ур. 20–21 TRS-398).', `${REF.add}, разд. 5.C.7`);
      }
    }
    if (Number.isFinite(prof.value) && (prof.value < 0.99 || prof.value > 1.03)) {
      add('warn', 'common', `k_vol = ${ru(prof.value, 4)} — необычное значение: проверьте длину камеры и способ расчёта.`, null, 'kvol');
    }
  }
  trs.kvol = prof.value;
  tg.Prp = prof.value;

  // ------------------------------------------------------------- доза
  const depth = { on: !!f.dd_on, geometry: geo.kind, zref };
  if (depth.on) {
    // замечания раздела 7 не блокируют дозу на опорной глубине, только пересчёт на d_max
    const readD = (key, label) => {
      const v = parseNumber(f[key]);
      if (!Number.isFinite(v)) add('error', 'depth', isBlank(f[key]) ? `Не заполнено поле «${label}».` : `Не удалось прочитать число в поле «${label}».`, null, key);
      return v;
    };
    depth.zmax = readD('dd_zmax', 'Глубина d_max');
    if (Number.isFinite(depth.zmax) && (depth.zmax <= 0 || depth.zmax >= zref)) {
      add('error', 'depth', `Глубина d_max задаётся в сантиметрах и должна быть меньше глубины измерения (${ru(zref, 1)} см).`, null, 'dd_zmax');
    }
    if (geo.kind === 'SAD') {
      const tmr = readD('dd_tmr', `TMR(${ru(zref, 0)}) для пересчёта на d_max`);
      if (Number.isFinite(tmr) && (tmr <= 0.2 || tmr > 1)) {
        add('error', 'depth', 'TMR вводится как отношение (например, 0,736), а не в процентах.', null, 'dd_tmr');
      }
      depth.factor = tmr;
      depth.label = `TMR(${ru(zref, 0)} см)`;
    } else {
      const pdd = readD('dd_pdd', `PDD(${ru(zref, 0)}) для пересчёта на d_max`);
      if (Number.isFinite(pdd) && (pdd < 20 || pdd > 100)) add('error', 'depth', 'PDD вводится в процентах, от 20 до 100.', null, 'dd_pdd');
      depth.factor = pdd / 100;
      depth.label = `PDD(${ru(zref, 0)} см)/100`;
    }
    depth.nominal = parseNumber(f.dd_nominal);
    if (!isBlank(f.dd_nominal) && !(depth.nominal > 0)) add('warn', 'depth', 'Номинальный выход не распознан: отклонение от номинала не считается.', null, 'dd_nominal');
    depth.ok = !messages.some((m) => m.level === 'error' && m.scope === 'depth');
  }

  const finish = (x, M, kQ) => {
    x.M = M;
    x.D = M * kQ * ndw; // Гр
    x.DperMUGy = x.D / mu; // Гр/МЕ
    x.DperMU = x.DperMUGy * 100; // сГр/МЕ
    if (depth.on && depth.ok && Number.isFinite(depth.factor)) {
      x.Dmax = x.D / depth.factor;
      x.DmaxPerMUGy = x.DperMUGy / depth.factor;
      x.DmaxPerMU = x.DperMU / depth.factor;
      if (Number.isFinite(depth.nominal) && depth.nominal > 0) x.deviation = (x.DmaxPerMU / depth.nominal - 1) * 100;
    }
    x.ok = Number.isFinite(x.D) && x.D > 0;
  };

  if (wantTRS) finish(trs, m1 * trs.kTP * trs.kelec * trs.kpol * trs.ks * trs.kleak * trs.kvol, trs.kQ);
  if (want51) finish(tg, m1 * tg.PTP * tg.Pion * tg.Ppol * tg.Pelec * tg.Pleak * tg.Prp, tg.kQ);

  const devs = [trs.deviation, tg.deviation].filter(Number.isFinite);
  if (devs.some((d) => Math.abs(d) > 2)) {
    add('warn', 'common', 'Отклонение от номинального выхода больше 2 %: перед подстройкой ускорителя перепроверьте ввод и измерения.');
  }

  const hasError = (scope) => messages.some((m) => m.level === 'error' && (m.scope === 'common' || m.scope === scope));
  if (wantTRS && !trs.ok && !hasError('trs')) add('error', 'trs', 'Не удалось вычислить дозу: проверьте качество пучка и k_Q.');
  if (want51 && !tg.ok && !hasError('tg51')) add('error', 'tg51', 'Не удалось вычислить дозу: проверьте качество пучка и k_Q.');

  const order = { error: 0, warn: 1, info: 2 };
  messages.sort((a, b) => order[a.level] - order[b.level]);
  trs.blocked = wantTRS && hasError('trs');
  tg.blocked = want51 && hasError('tg51');

  let comparison = null;
  if (want51 && wantTRS && tg.ok && trs.ok && !tg.blocked && !trs.blocked) comparison = { dRel: (tg.D / trs.D - 1) * 100 };

  return {
    protocol: f.protocol,
    form: f,
    chamber,
    geometry: geo,
    inputs: {
      T, P, T0, P0, mu, V1, V2, nV, ndw, ndwRaw, kelec, kleak, energy, fff,
      M1, Mopp, M2, ratio12, lengthMm, sddCm,
    },
    profile: prof,
    depth,
    trs,
    tg51: tg,
    comparison,
    messages,
    flags,
    hasErrors: messages.some((m) => m.level === 'error'),
  };
}
