// Расчёт поглощённой дозы в воде для МВ фотонов по TG-51 (+ аддендум 2014) и TRS-398 Rev.1.
// Принимает значения полей формы (строки, как их ввёл пользователь) и возвращает
// все промежуточные поправки, итоговую дозу и список замечаний с источниками.

import { parseNumber, parseSeries, isBlank, pressureToKPa, ndwToGyPerNC, ru } from './units.js';
import { temperaturePressure, polarity } from './common.js';
import * as TG51 from './tg51.js';
import * as TRS from './trs398.js';
import { findChamber } from './chambers.js';
import { parseProfile, kvolFromProfile } from './profile.js';

export const FORM_DEFAULTS = {
  protocol: 'trs', // 'trs' | 'tg51' | 'both'

  meta_institution: '',
  meta_machine: '',
  meta_beam: '',
  meta_energy: '',
  meta_fff: false,
  meta_date: '',
  meta_physicist: '',
  meta_notes: '',

  setup_geometry: 'SSD', // 'SSD' | 'SAD'

  ch_model: '',
  ch_serial: '',
  ch_ndw: '',
  ch_ndw_unit: 'Gy/nC',
  ch_T0: '20',
  ch_P0: '101,325',
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
  rd_M1: '',
  rd_Mopp: '',
  rd_M2: '',
  rd_kleak: '1,000',

  q51_method: 'open', // 'open' | 'foil50' | 'foil30' | 'interim' | 'manual'
  q51_pdd10: '',
  q51_pdd10pb: '',
  q51_manual: '',

  qtrs_method: 'direct', // 'direct' | 'ratio' | 'pdd2010'
  qtrs_tpr: '',
  qtrs_m20: '',
  qtrs_m10: '',
  qtrs_pdd20: '',
  qtrs_pdd10: '',

  kq51_manual_on: false,
  kq51_manual: '',
  kqtrs_manual_on: false,
  kqtrs_manual: '',

  prof_mode: 'none', // 'none' | 'manual' | 'profile' | 'generic'
  prof_value: '',
  prof_length: '',
  prof_sdd: '',
  prof_text: '',

  dd_on: true,
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

/** Максимальное относительное отклонение отдельного показания от среднего. */
function maxRelDeviation(series) {
  if (!series || series.n < 2 || !series.mean) return 0;
  return Math.max(...series.values.map((v) => Math.abs(v - series.mean) / Math.abs(series.mean)));
}

export function computePhotons(form) {
  const f = { ...FORM_DEFAULTS, ...form };
  const messages = [];
  const add = (level, scope, text, ref = null) => messages.push({ level, scope, text, ref });

  const want51 = f.protocol === 'tg51' || f.protocol === 'both';
  const wantTRS = f.protocol === 'trs' || f.protocol === 'both';
  const fff = !!f.meta_fff;
  const energy = parseNumber(f.meta_energy);

  const read = (key, label, scope = 'common') => {
    const v = parseNumber(f[key]);
    if (!Number.isFinite(v)) {
      add('error', scope, isBlank(f[key]) ? `Не заполнено поле «${label}».` : `Не удалось прочитать число в поле «${label}».`);
    }
    return v;
  };
  const readSeries = (key, label) => {
    const s = parseSeries(f[key]);
    if (s.error) add('error', 'common', `«${label}»: ${s.error}.`);
    else if (s.n === 0) add('error', 'common', `Не заполнено поле «${label}».`);
    else if (s.mean === 0) add('error', 'common', `«${label}»: среднее показание равно нулю.`);
    return s;
  };

  // ---------------------------------------------------------------- камера
  const chamber = findChamber(f.ch_model);
  if (isBlank(f.ch_model)) add('error', 'common', 'Выберите тип камеры.');
  if (chamber?.sleeve) {
    add('info', 'common', 'Камера не водонепроницаема: используйте тот же чехол (ПММА ≤ 1 мм), что и при калибровке.', `${REF.tg51}, разд. V.A; ${REF.trs}, разд. 6.2.2`);
  }

  const ndwRaw = read('ch_ndw', 'N_D,w');
  const ndw = Number.isFinite(ndwRaw) ? ndwToGyPerNC(ndwRaw, f.ch_ndw_unit) : NaN;
  if (Number.isFinite(ndw) && (ndw < 1e-3 || ndw > 5)) {
    add('warn', 'common', `N_D,w = ${ndw.toPrecision(4).replace(".", ",")} Гр/нКл выглядит неправдоподобно: проверьте единицы.`);
  }
  const T0 = read('ch_T0', 'T₀ из сертификата');
  const P0 = read('ch_P0', 'P₀ из сертификата');
  if (Number.isFinite(T0) && (T0 < 15 || T0 > 25)) add('error', 'common', 'T₀ задаётся в °C (обычно 20 или 22).');
  if (Number.isFinite(T0) && f.protocol === 'tg51' && Math.abs(T0 - TG51.TG51_T0) > 1e-9) {
    add('info', 'tg51', 'Проверьте стандартные условия в сертификате: у лабораторий ADCL это 22 °C и 101,33 кПа, в формуле P_TP используются значения из сертификата.', `${REF.tg51}, ур. (10)`);
  }
  if (Number.isFinite(P0) && (P0 < 95 || P0 > 105)) add('warn', 'common', 'P₀ задаётся в кПа (обычно 101,325 или 101,33).');
  const kelec = read('el_kelec', 'k_elec (P_elec)');
  if (Number.isFinite(kelec) && Math.abs(kelec - 1) > 0.02) add('warn', 'common', 'k_elec отличается от 1 больше чем на 2 %: проверьте сертификат электрометра.');

  // ------------------------------------------------------------ окружающая среда
  const T = read('env_T', 'Температура воды');
  const Pin = read('env_P', 'Давление');
  const P = Number.isFinite(Pin) ? pressureToKPa(Pin, f.env_P_unit) : NaN;
  if (Number.isFinite(P) && (P < 50 || P > 110)) {
    add('error', 'common', `Давление ${ru(P, 2)} кПа вне правдоподобного диапазона: проверьте единицы.`);
  }
  if (Number.isFinite(T)) {
    if (T < 5 || T > 40) add('error', 'common', `Температура воды ${T} °C неправдоподобна.`);
    else if (T < 15 || T > 25) {
      add('info', 'common', 'Температура воды вне 15–25 °C: тепловое расширение полости может стать заметным.', `${REF.add}, разд. 5.A.5`);
    }
  }

  // ------------------------------------------------------------- показания
  const mu = read('rd_mu', 'Мониторные единицы');
  if (Number.isFinite(mu) && mu <= 0) add('error', 'common', 'Число МЕ должно быть больше нуля.');
  const V1 = read('rd_V1', 'Рабочее напряжение V₁');
  const V2 = read('rd_V2', 'Пониженное напряжение V₂');
  if (Number.isFinite(V1) && Number.isFinite(V2) && Math.abs(V1) <= Math.abs(V2)) {
    add('error', 'common', 'Рабочее напряжение V₁ должно быть больше пониженного V₂.');
  }
  if (Number.isFinite(V1) && Math.abs(V1) > 300) {
    add('warn', 'common', 'Аддендум TG-51 рекомендует для цилиндрических камер не более 300 В.', `${REF.add}, разд. 4.E`);
  }
  const M1 = readSeries('rd_M1', 'Показания при V₁, обычная полярность');
  const Mopp = readSeries('rd_Mopp', 'Показания при V₁, обратная полярность');
  const M2 = readSeries('rd_M2', 'Показания при V₂');
  for (const [s, label] of [[M1, 'при V₁'], [Mopp, 'обратной полярности'], [M2, 'при V₂']]) {
    const d = maxRelDeviation(s);
    const pct = ru(d * 100, 2);
    if (d > 0.05) {
      add('error', 'common', `Показания ${label} расходятся на ${pct} % от среднего: вероятно, ошибка ввода (например, пробел внутри числа).`);
    } else if (d > 0.005) {
      add('warn', 'common', `Разброс показаний ${label} до ${pct} % от среднего: ускоритель или камера нестабильны; Report 374 советует повторять облучения, пока отклонение не станет меньше ±0,1 % без тренда.`, `${REF.r374}, разд. 4.4.2`);
    } else if (d > 0.001) {
      add('info', 'common', `Разброс показаний ${label} до ${pct} % от среднего: Report 374 советует повторять облучения, пока отклонение не станет меньше ±0,1 % без тренда.`, `${REF.r374}, разд. 4.4.2`);
    }
  }
  const kleak = read('rd_kleak', 'Поправка на утечку');
  if (Number.isFinite(kleak) && Math.abs(kleak - 1) > 0.001) {
    add('warn', 'common', 'Утечка больше 0,1 % показания: камера не отвечает критерию эталонного класса, причину нужно выяснить.', `${REF.add}, табл. III; ${REF.trs}, табл. 3`);
  }

  const readingsOk = M1.n > 0 && !M1.error && M1.mean !== 0;
  const m1 = readingsOk ? Math.abs(M1.mean) : NaN;

  // полярность
  let kpolRaw = NaN;
  if (readingsOk && Mopp.n > 0 && !Mopp.error) {
    kpolRaw = polarity(M1.mean, Mopp.mean);
    if (Math.abs(kpolRaw - 1) > 0.004) {
      add('warn', 'common', `Поправка на полярность ${ru(kpolRaw, 4)} отличается от 1 больше чем на 0,4 %: для камеры эталонного класса это необычно.`, `${REF.add}, табл. III; ${REF.trs}, табл. 3`);
    }
    if (Math.abs(kpolRaw - 1) > 0.003 && Number.isFinite(energy) && energy <= 6 && f.lab_pol_applied && want51) {
      add('info', 'tg51', 'P_pol отличается от 1 больше чем на 0,3 % при энергии ≤ 6 МВ: TG-51 требует знать P_pol в пучке лаборатории. Если лаборатория не вносила поправку на полярность, снимите отметку в разделе 2 и введите это значение.', `${REF.tg51}, разд. VII.A`);
    }
  }
  let kpolQ0 = 1;
  if (!f.lab_pol_applied) {
    kpolQ0 = read('lab_kpol', 'Поправка на полярность при калибровке');
  }
  const kpol = kpolRaw / kpolQ0;

  // рекомбинация
  const nV = Math.abs(V1) / Math.abs(V2);
  const recOk = readingsOk && M2.n > 0 && !M2.error && M2.mean !== 0 && Number.isFinite(nV) && nV > 1;
  if (readingsOk && M2.n > 0 && Math.sign(M1.mean) !== Math.sign(M2.mean)) {
    add('error', 'common', 'Показания при V₁ и V₂ должны быть сняты при одной и той же (обычной) полярности.');
  }
  const ratio12 = recOk ? Math.abs(M1.mean) / Math.abs(M2.mean) : NaN;
  if (recOk && ratio12 < 1) add('warn', 'common', 'Показание при пониженном напряжении больше, чем при рабочем: проверьте, не перепутаны ли поля.');
  let ksQ0 = 1;
  if (!f.lab_ks_applied) ksQ0 = read('lab_ks', 'Поправка на рекомбинацию при калибровке');

  // ----------------------------------------------- поправка на профиль пучка
  let lengthMm = parseNumber(f.prof_length);
  if (!Number.isFinite(lengthMm) && chamber?.lengthMm) lengthMm = chamber.lengthMm;
  let sddCm = parseNumber(f.prof_sdd);
  if (!Number.isFinite(sddCm)) sddCm = f.setup_geometry === 'SAD' ? 100 : 110;

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
      if (r.error) add('error', 'trs', r.error + '.', `${REF.trs}, табл. 10`);
      r.notes.forEach((n) => add('warn', 'trs', n + '.', `${REF.trs}, разд. 4.4.3.4`));
      if (nV < 3 - 1e-9) add('info', 'trs', 'TRS-398 рекомендует отношение напряжений V₁/V₂ ≥ 3.', `${REF.trs}, разд. 4.4.3.4`);
      trs.ks = r.value / ksQ0;
      trs.ksQ0 = ksQ0;
      if (trs.ks > 1.05) add('error', 'trs', `k_s = ${ru(trs.ks, 4)} > 1,05: метод двух напряжений неприменим, нужна другая камера или другой метод.`, `${REF.trs}, табл. 3`);
    } else {
      trs.ks = NaN;
    }

    // качество пучка
    let tpr = NaN;
    if (f.qtrs_method === 'direct') {
      tpr = read('qtrs_tpr', 'TPR20,10', 'trs');
      trs.tprEquation = 'измерено';
    } else if (f.qtrs_method === 'ratio') {
      const m20 = parseSeries(f.qtrs_m20);
      const m10 = parseSeries(f.qtrs_m10);
      if (m20.n === 0 || m10.n === 0 || m20.error || m10.error) add('error', 'trs', 'Введите показания на глубинах 20 и 10 см.');
      else if (m10.mean === 0) add('error', 'trs', 'Показание на глубине 10 см не может быть нулевым.');
      else {
        tpr = Math.abs(m20.mean) / Math.abs(m10.mean);
        trs.tprEquation = 'M(20 см)/M(10 см) при РИК 100 см';
      }
    } else if (f.qtrs_method === 'pdd2010') {
      const p20 = read('qtrs_pdd20', 'PDD(20)', 'trs');
      const p10 = read('qtrs_pdd10', 'PDD(10)', 'trs');
      if (Number.isFinite(p10) && p10 <= 0) add('error', 'trs', 'PDD(10) должно быть больше нуля.');
      if (Number.isFinite(p20) && Number.isFinite(p10) && p10 > 0) {
        tpr = TRS.tprFromPdd2010(p20 / p10);
        trs.tprEquation = 'сноска 36: 1,2661·PDD20,10 − 0,0595';
        if (fff) add('warn', 'trs', 'Формула TPR20,10 через PDD20,10 выведена для пучков с выравнивающим фильтром; для БВФ её точность подтверждена лишь частично.', `${REF.trs}, сноска 36`);
      }
    }
    if (!Number.isNaN(tpr) && (!Number.isFinite(tpr) || tpr < 0.5 || tpr > 0.9)) {
      add('error', 'trs', `TPR20,10 = ${ru(tpr, 3)} неправдоподобно: это отношение, например 0,668.`);
    }
    trs.tpr = tpr;
    if (fff && Number.isFinite(energy) && energy > 10) {
      add('warn', 'trs', 'TRS-398 Rev.1 распространяется на пучки БВФ только до ~10 МВ.', `${REF.trs}, разд. 6.1`);
    }

    // k_Q
    if (f.kqtrs_manual_on) {
      trs.kQ = read('kqtrs_manual', 'k_Q (TRS-398) вручную', 'trs');
      trs.kQSource = 'введено вручную (измерено в лаборатории)';
    } else {
      const k = TRS.kQ(chamber, tpr);
      if (f.ch_model === 'OTHER') add('error', 'trs', 'Для камеры не из списка введите k_Q вручную (раздел 5).');
      else if (k.error && chamber && !chamber.trs) add('error', 'trs', 'Для этой камеры в TRS-398 Rev.1 нет k_Q: введите значение вручную.', `${REF.trs}, табл. 45`);
      else if (k.error && Number.isFinite(tpr) && chamber) add('error', 'trs', k.error[0].toUpperCase() + k.error.slice(1) + '.', `${REF.trs}, табл. 16`);
      trs.kQ = k.value;
      trs.kQSource = k.source;
    }
    (chamber?.notes || []).filter((n) => n.scope === 'trs').forEach((n) => add(n.level, 'trs', n.text));
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
      if (nV < 2 - 1e-9) add('warn', 'tg51', 'TG-51: пониженное напряжение должно быть меньше рабочего как минимум вдвое.', `${REF.tg51}, разд. VII.D.2`);
      if (tg.PionRaw > 1.05) add('error', 'tg51', `P_ion = ${ru(tg.PionRaw, 4)} > 1,05: неопределённость поправки недопустима, нужна другая камера.`, `${REF.tg51}, разд. VII.D.1`);
      tg.Pion = tg.PionRaw / ksQ0;
      tg.PionQ0 = ksQ0;
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
    if (q.error) add('error', 'tg51', q.error[0].toUpperCase() + q.error.slice(1) + '.', `${REF.tg51}, разд. VIII.B`);
    tg.pdd10x = q.value;
    tg.pdd10xEquation = q.equation;
    if (fff && f.q51_method === 'interim') {
      add('error', 'tg51', 'Промежуточная формула (15) верна только для пучков с выравнивающим фильтром; для БВФ измерьте %dd(10)Pb со свинцовой фольгой.', `${REF.add}, разд. 4.K(3)`);
    } else if (fff && f.q51_method === 'open') {
      add('warn', 'tg51', 'Для всех пучков БВФ, в том числе ниже 10 МВ, %dd(10) измеряют со свинцовой фольгой.', `${REF.add}, разд. 4.K(3); ${REF.r374}, разд. 3.3`);
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
      if (f.ch_model === 'OTHER') add('error', 'tg51', 'Для камеры не из списка введите k_Q вручную (раздел 5).');
      else if (k.error && chamber && !chamber.tg51 && !chamber.tg51Legacy) add('error', 'tg51', 'Для этой камеры в TG-51 нет k_Q: введите значение вручную.', `${REF.add}, табл. I`);
      else if (k.error && chamber && Number.isFinite(q.value)) add('error', 'tg51', k.error[0].toUpperCase() + k.error.slice(1) + '.', `${REF.add}, табл. I`);
      tg.kQ = k.value;
      tg.kQSource = k.source;
      if (chamber?.tg51Legacy) {
        add('info', 'tg51', 'Для этой камеры используются данные исходного TG-51 (1999): в аддендуме её нет.', `${REF.add}, разд. 3.E`);
      }
    }
    (chamber?.notes || []).filter((n) => n.scope === 'tg51').forEach((n) => add(n.level, 'tg51', n.text));
  }

  // --------------------------------------- поправка на профиль (k_vol / P_rp)
  let prof = { value: 1, method: 'не применяется' };
  if (f.prof_mode === 'none') {
    if (fff) {
      add('warn', 'common', 'Пучок БВФ: без поправки на усреднение по объёму (k_vol, P_rp) допустимо обходиться только с короткой камерой. Для Фармера в пучке БВФ ошибка доходит до 0,7 %.', `${REF.trs}, разд. 4.4.3.5; ${REF.add}, разд. 4.K(2); ${REF.r374}, разд. 4.5`);
    }
  } else if (f.prof_mode === 'manual') {
    const v = read('prof_value', 'k_vol / P_rp');
    prof = { value: v, method: 'введено вручную' };
  } else if (f.prof_mode === 'profile') {
    const parsed = parseProfile(f.prof_text);
    if (parsed.error) add('error', 'common', `Профиль: ${parsed.error}.`);
    else if (!Number.isFinite(lengthMm)) add('error', 'common', 'Укажите длину полости камеры (мм) для расчёта по профилю.');
    else {
      const r = kvolFromProfile(parsed.points, lengthMm);
      if (r.error) add('error', 'common', `Профиль: ${r.error}.`);
      prof = { value: r.value, method: `по профилю, L = ${lengthMm} мм`, mean: r.mean, points: parsed.points.length };
      if (fff && want51) {
        add('info', 'tg51', 'Для пучков БВФ аддендум TG-51 допускает, что может понадобиться двумерный профиль; здесь используется одномерное усреднение вдоль оси камеры (как в ур. (21) TRS-398).', `${REF.add}, разд. 5.C.7`);
      }
    }
  } else if (f.prof_mode === 'generic') {
    const tpr = trs.tpr;
    if (!wantTRS) add('error', 'common', 'Общая формула (22) TRS-398 требует TPR20,10: включите протокол TRS-398 или задайте поправку иначе.');
    else if (!Number.isFinite(lengthMm)) add('error', 'common', 'Укажите длину полости камеры (мм) для формулы (22).');
    else if (Number.isFinite(tpr)) {
      const v = TRS.kvolGeneric({ tpr, lengthCm: lengthMm / 10, sddCm });
      prof = { value: v, method: `ур. (22) TRS-398: L = ${lengthMm} мм, РИД = ${sddCm} см` };
      if (!fff) add('warn', 'common', 'Формула (22) предназначена для пучков БВФ.', `${REF.trs}, разд. 4.4.3.5`);
      if (want51) add('info', 'tg51', 'В TG-51 P_rp определяют по измеренному профилю; здесь использована общая оценка по ур. (22) TRS-398.', `${REF.r374}, ур. (8)`);
    }
  }
  if (Number.isFinite(prof.value) && (prof.value < 0.99 || prof.value > 1.03)) {
    add('warn', 'common', `Поправка на профиль ${ru(prof.value, 4)} необычно велика: проверьте профиль и длину камеры.`);
  }
  trs.kvol = prof.value;
  tg.Prp = prof.value;

  // ------------------------------------------------------------- доза
  const depth = { on: !!f.dd_on, geometry: f.setup_geometry };
  if (depth.on) {
    if (f.setup_geometry === 'SAD') {
      const tmr = read('dd_tmr', 'TMR(10) для пересчёта на d_max');
      if (Number.isFinite(tmr) && (tmr <= 0.2 || tmr > 1)) {
        add('error', 'common', 'TMR(10) вводится как отношение (например, 0,736), а не в процентах.');
      }
      depth.factor = tmr;
      depth.label = 'TMR(10, 10×10)';
    } else {
      const pdd = read('dd_pdd', 'PDD(10) для пересчёта на d_max');
      if (Number.isFinite(pdd) && (pdd < 20 || pdd > 100)) add('error', 'common', 'PDD(10) вводится в процентах, от 20 до 100.');
      depth.factor = pdd / 100;
      depth.label = 'PDD(10)/100';
    }
    depth.nominal = read('dd_nominal', 'Номинальный выход на d_max');
  }

  const finish = (x, M, kQ) => {
    x.M = M;
    x.D = M * kQ * ndw; // Гр
    x.DperMU = (x.D * 100) / mu; // сГр/МЕ
    if (depth.on && Number.isFinite(depth.factor)) {
      x.Dmax = x.D / depth.factor;
      x.DmaxPerMU = x.DperMU / depth.factor;
      if (Number.isFinite(depth.nominal) && depth.nominal > 0) x.deviation = (x.DmaxPerMU / depth.nominal - 1) * 100;
    }
    x.ok = Number.isFinite(x.D) && x.D > 0;
  };

  if (wantTRS) {
    const M = m1 * trs.kTP * trs.kelec * trs.kpol * trs.ks * trs.kleak * trs.kvol;
    finish(trs, M, trs.kQ);
  }
  if (want51) {
    const M = m1 * tg.PTP * tg.Pion * tg.Ppol * tg.Pelec * tg.Pleak * tg.Prp;
    finish(tg, M, tg.kQ);
  }

  // ------------------------------------------ контроль согласованности
  const openPdd = want51 && (f.q51_method === 'open' || f.q51_method === 'interim') ? parseNumber(f.q51_pdd10) : NaN;
  const clinicalPdd = depth.on && f.setup_geometry === 'SSD' ? parseNumber(f.dd_pdd) : NaN;
  const pddForCheck = [openPdd, clinicalPdd].find(Number.isFinite);
  let cross = null;
  if (wantTRS && Number.isFinite(trs.tpr) && Number.isFinite(pddForCheck) && pddForCheck > 50 && pddForCheck < 90) {
    const est = TRS.tprEstimateFromPdd10(pddForCheck);
    const diff = (trs.tpr / est - 1) * 100;
    cross = { pdd10: pddForCheck, tprEstimate: est, diff };
    if (Math.abs(diff) > 1.5) {
      add('warn', 'trs', `TPR20,10 = ${ru(trs.tpr, 3)} расходится с оценкой по PDD(10) = ${pddForCheck} % (${ru(est, 3)}) на ${ru(diff, 1)} %: перепроверьте качество пучка.`, `${REF.trs}, сноска 36`);
    }
  }

  const devs = [trs.deviation, tg.deviation].filter(Number.isFinite);
  if (devs.some((d) => Math.abs(d) > 2)) {
    add('warn', 'common', 'Отклонение от номинального выхода больше 2 %: перед подстройкой ускорителя перепроверьте ввод и измерения.');
  }

  let comparison = null;
  if (want51 && wantTRS && tg.ok && trs.ok) {
    comparison = { dRel: (tg.D / trs.D - 1) * 100 };
  }

  const hasError = (scope) => messages.some((m) => m.level === 'error' && (m.scope === 'common' || m.scope === scope));
  if (wantTRS && !trs.ok && !hasError('trs')) add('error', 'trs', 'Не удалось вычислить дозу: проверьте качество пучка и k_Q.');
  if (want51 && !tg.ok && !hasError('tg51')) add('error', 'tg51', 'Не удалось вычислить дозу: проверьте качество пучка и k_Q.');

  const order = { error: 0, warn: 1, info: 2 };
  messages.sort((a, b) => order[a.level] - order[b.level]);
  const blocked = (scope) => messages.some((m) => m.level === 'error' && (m.scope === 'common' || m.scope === scope));
  trs.blocked = wantTRS && blocked('trs');
  tg.blocked = want51 && blocked('tg51');

  return {
    protocol: f.protocol,
    chamber,
    inputs: {
      T, P, T0, P0, mu, V1, V2, nV, ndw, ndwRaw, kelec, kleak, energy, fff,
      M1, Mopp, M2, ratio12, lengthMm, sddCm,
    },
    profile: prof,
    depth,
    trs,
    tg51: tg,
    comparison,
    cross,
    messages,
    hasErrors: messages.some((m) => m.level === 'error'),
  };
}
