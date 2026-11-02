// Бюджет неопределённости поглощённой дозы в воде на опорной глубине.
//
// Образцы — примеры бюджетов из самих протоколов:
//   TRS-398 Rev.1: табл. 13 (⁶⁰Co), табл. 17 (МВ фотоны), табл. 24 (электроны, камера откалибрована в ⁶⁰Co),
//   табл. 30 и 33 (kV-рентген низких и средних энергий, калибровка N_D,w или N_K);
//   аддендум TG-51 (2014): табл. II (МВ фотоны), примеры (i) и (ii);
//   WGTG51 Report 385 (2024): табл. 8 (электроны, камера откалибрована в ⁶⁰Co) и табл. 9 (плоскопараллельная
//   камера после перекрёстной калибровки), примеры (i) и (ii).
// Все значения — относительные стандартные неопределённости в процентах (k = 1). Составляющие считаются
// некоррелированными и складываются в квадратуре (TRS-398, прил. IV, ур. 113); расширенная неопределённость
// U = k·u_c с коэффициентом охвата k = 2 (прил. IV.5).
//
// Пользователь может:
//   - ввести расширенную неопределённость N_D,w из свидетельства о калибровке — она заменяет лабораторную часть
//     (этап 1 TRS-398 или строку «N_D,w в ⁶⁰Co» TG-51);
//   - заменить значение любой строки своим (поле «Своё»); пустое поле — значение образца;
//   - повторяемость его серии показаний (тип А, стандартное отклонение среднего) сравнивается со строкой
//     «показания относительно монитора» (TRS-398) / «стабильность ускорителя» (TG-51): в расчёт идёт большее.

import { parseNumber, isBlank, ru } from './units.js';
import { L } from './i18n.js';
import { estimateU, hasMethod, hasSource } from './unc-est.js';

export const COVERAGE_K = 2;

const REF = {
  trs: 'TRS-398 Rev.1',
  add: 'аддендум TG-51 (2014)',
  r385: 'Report 385',
  din: 'DIN 6809-4:2020',
};
const T = REF;

/** Сумма в квадратуре, % (составляющие без значения пропускаются). */
export const quad = (values) => Math.sqrt(values.filter(Number.isFinite).reduce((s, v) => s + v * v, 0));

/** Повторяемость серии показаний (тип А): стандартное отклонение среднего относительно среднего, %. */
export function typeAOf(series) {
  if (!series || series.error || !(series.n >= 2) || !Number.isFinite(series.relSd)) return null;
  return { n: series.n, pct: (series.relSd / Math.sqrt(series.n)) * 100 };
}

/** Свои значения строк: строка JSON (из скрытого поля формы) или объект. */
export function parseOverrides(v) {
  if (v && typeof v === 'object') return { ...v };
  if (isBlank(v)) return {};
  try {
    const o = JSON.parse(String(v));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

const pct = (v, d = 2) => ru(v, d);

// ------------------------------------------------------------------ строки TRS-398
// Одинаковые строки табл. 13, 17 и 24; значения по пучкам и типам камер — в шаблонах ниже.

function trsRows(ctx) {
  const { beam } = ctx;
  const setupHow = {
    photons: L(
      'Оценка по чувствительности показаний: РИП ±0,5 мм — около 0,1 %; глубина ±0,5 мм — около 0,25 % (градиент дозы 3–5 %/см); поле — около 1 % на 1 см стороны (аддендум TG-51, разд. 5.A.1–5.A.3).',
      'Estimate from the sensitivity of the reading: SSD ±0.5 mm — about 0.1%; depth ±0.5 mm — about 0.25% (dose gradient 3–5%/cm); field size — about 1% per 1 cm of the side (TG-51 addendum, Sec. 5.A.1–5.A.3).',
    ),
    electrons: L(
      'РИП ±0,5 мм — около 0,1 %; глубина 0,15 мм — 0,04 %, 1 мм — 0,3 % (в пучках низкой энергии градиент круче); поле задают тубус и вкладыш (Report 385, разд. 8.2).',
      'SSD ±0.5 mm — about 0.1%; depth 0.15 mm — 0.04%, 1 mm — 0.3% (the gradient is steeper in low-energy beams); the field is defined by the applicator and insert (Report 385, Sec. 8.2).',
    ),
    co60: L(
      'Расстояние, глубина и поле. Ошибка расстояния 1 мм на 80 см меняет дозу примерно на 0,25 % (закон обратных квадратов); влияние глубины — по градиенту вашей PDD на z_ref.',
      'Distance, depth and field. A 1 mm distance error at 80 cm changes the dose by about 0.25% (inverse square law); the effect of depth follows the gradient of your PDD at z_ref.',
    ),
  }[beam];
  const kiHow = L(
    `k_TP (поверенные термометр 0,1 °C и барометр 0,1 кПа, вода и камера в тепловом равновесии), k_pol, k_s, k_elec (по TRS-398, разд. 4.4.3.2, калибровка электрометра входит сюда), k_leak${beam === 'photons' ? '; в пучке БВФ — и k_vol' : ''}. При тщательной процедуре каждая — 0,05–0,1 % (аддендум TG-51, разд. 5.A.5, 5.C). Строку можно раскрыть по поправкам ниже, в «Раскрытии k_i».`,
    `k_TP (calibrated thermometer 0.1 °C and barometer 0.1 kPa, water and chamber in thermal equilibrium), k_pol, k_s, k_elec (per TRS-398, Sec. 4.4.3.2, the electrometer calibration belongs here), k_leak${beam === 'photons' ? '; in an FFF beam also k_vol' : ''}. With a careful procedure each is 0.05–0.1% (TG-51 addendum, Sec. 5.A.5, 5.C). The row can be broken down by correction below, in the k_i breakdown.`,
  );
  return {
    lab_psdl: {
      label: L('Калибровка вторичного эталона в дозиметрической лаборатории первичного эталона, ДЛПЭ (N_D,w)', 'Calibration of the secondary standard at the PSDL (N_D,w)'),
      how: L(
        'Три строки этапа 1 — то, что входит в неопределённость N_D,w из свидетельства о калибровке (поверке) вашей камеры. Введите её выше — она заменит эти строки.',
        'The three rows of step 1 make up the N_D,w uncertainty stated in the calibration certificate of your chamber. Enter it above and it will replace these rows.',
      ),
      lab: true,
    },
    lab_stab: { label: L('Долговременная стабильность вторичного эталона', 'Long-term stability of the secondary standard'), lab: true },
    lab_user: { label: L('Калибровка дозиметра пользователя в поверочной лаборатории (N_D,w)', "Calibration of the user's dosimeter at the standards laboratory (N_D,w)"), lab: true },
    st_stab: {
      label: L('Долговременная стабильность дозиметра пользователя', "Long-term stability of the user's dosimeter"),
      how: L(
        'Изменение отклика камеры с электрометром между калибровками: по контрольному источнику или сравнению с другими камерами (Report 374). Без таких проверок — 0,3–0,5 % (аддендум TG-51, разд. 5.B.4).',
        'Change in the response of the chamber and electrometer between calibrations: from a check source or a comparison with other chambers (Report 374). Without such checks, 0.3–0.5% (TG-51 addendum, Sec. 5.B.4).',
      ),
    },
    st_setup: { label: L('Установка стандартных условий (расстояние, глубина, поле)', 'Establishment of reference conditions (distance, depth, field)'), how: setupHow },
    st_read: {
      label: beam === 'co60' ? L('Показания дозиметра M_Q относительно таймера или монитора пучка', 'Dosimeter reading M_Q relative to the timer or beam monitor') : L('Показания дозиметра M_Q относительно монитора пучка', 'Dosimeter reading M_Q relative to the beam monitor'),
      how: L(
        'Воспроизводимость показаний относительно монитора пучка: повторяемость серии (тип А), стабильность монитора и его зависимость от мощности дозы, разрешение и линейность электрометра в рабочем диапазоне. Калибровку электрометра (k_elec) сюда не включайте: по TRS-398 она входит в поправки k_i (разд. 4.4.3.2).',
        'Reproducibility of the readings relative to the beam monitor: repeatability of the series (type A), stability of the monitor and its dose-rate dependence, resolution and linearity of the electrometer in the range used. Do not include the electrometer calibration (k_elec) here: TRS-398 counts it among the k_i corrections (Sec. 4.4.3.2).',
      ),
      typeA: true,
    },
    st_ki: { label: L('Поправки на влияющие величины k_i', 'Correction for influence quantities k_i'), how: kiHow },
    st_kq: beam === 'electrons'
      ? {
          label: L('Поправка на качество пучка k_Q (прил. II)', 'Beam quality correction factor k_Q (App. II)'),
          how: ctx.crossE
            ? L(
                'Для плоскопараллельной камеры, откалиброванной по цилиндрической в пучке электронов высокой энергии, неопределённость близка к цилиндрической камере (разд. 7.10); k_Q,Qcross — по табл. 21.',
                'For a plane-parallel chamber cross-calibrated against a cylindrical chamber in a high-energy electron beam, the uncertainty approaches that of the cylindrical chamber (Sec. 7.10); k_Q,Qcross from Table 21.',
              )
            : L(
                'Расчётные k_Q (табл. 20). Если k_Q плоскопараллельной камеры измерен с неопределённостью около 0,5 %, суммарная неопределённость снижается примерно с 1,2 до 0,7 % (разд. 7.10). Для R50 < 2 г/см² — 0,8 % (прим. c к табл. 24).',
                'Calculated k_Q (Table 20). If k_Q of a plane-parallel chamber is measured with an uncertainty of about 0.5%, the combined uncertainty drops from about 1.2 to 0.7% (Sec. 7.10). For R50 < 2 g/cm², 0.8% (Table 24, note c).',
              ),
        }
      : {
          label: L('Коэффициент качества пучка k_Q', 'Beam quality correction factor k_Q'),
          how: ctx.crossQ
            ? L(
                'Расчётные k_Q (табл. 16, ур. 34). При перекрёстной калибровке в пучке Q_cross сюда входит k_Qcross опорной камеры (ур. 26–27).',
                'Calculated k_Q (Table 16, Eq. 34). For a cross-calibration in a beam Q_cross this includes k_Qcross of the reference chamber (Eqs 26–27).',
              )
            : L('Расчётные k_Q (табл. 16, ур. 34). Если k_Q вашей камеры измерен в ДЛПЭ — около 0,3 % (прим. d к табл. 17).', 'Calculated k_Q (Table 16, Eq. 34). If k_Q of your chamber was measured at a PSDL, about 0.3% (Table 17, note d).'),
        },
    st_kqapp: {
      label: L('Применимость k_Q к сочетанию пучок — камера', 'Applicability of k_Q to the beam–chamber combination'),
      how: L('Отличие вашего пучка и экземпляра камеры от тех, для которых рассчитаны k_Q (прим. d к табл. 24).', 'Difference between your beam and chamber and those for which k_Q was calculated (Table 24, note d).'),
    },
  };
}

// ------------------------------------------------------------------ строки TG-51 (аддендум, Report 385)
function tg51Rows(ctx) {
  const e = ctx.beam === 'electrons';
  return {
    ssd: {
      label: L('Установка РИП', 'SSD setting'),
      how: L('(i) механический указатель: 0,5 мм — 0,1 % на РИП 100 см; (ii) 2 мм. Световой дальномер не рекомендуется: ошибка 1,5–3 мм.', '(i) mechanical front pointer: 0.5 mm gives 0.1% at SSD 100 cm; (ii) 2 mm. The optical distance indicator is not recommended: error 1.5–3 mm.'),
      ref: `${T.add}, разд. 5.A.1`,
    },
    depth: e
      ? { label: L('Установка камеры на опорную глубину', 'Depth setting'), how: L('(i) 0,15 мм, (ii) 1 мм; в пучках низкой энергии градиент круче.', '(i) 0.15 mm, (ii) 1 mm; the gradient is steeper in low-energy beams.'), ref: `${T.r385}, разд. 8.2.1` }
      : { label: L('Установка камеры на опорную глубину', 'Depth setting'), how: L('(i) 0,33 мм, (ii) 1 мм; при градиенте 3–5 %/см 0,5 мм дают 0,25 %.', '(i) 0.33 mm, (ii) 1 mm; with a 3–5%/cm gradient, 0.5 mm gives 0.25%.'), ref: `${T.add}, разд. 5.A.2` },
    field: e
      ? { label: L('Размер поля', 'Field-size setting'), how: L('Поле задают тубус и вкладыш; оценка — как для фотонов.', 'The field is defined by the applicator and insert; estimate as for photons.'), ref: `${T.r385}, разд. 8.2.2` }
      : { label: L('Размер поля', 'Field-size setting'), how: L('Около 1 % на 1 см стороны поля: (i) поле проверено до 1 мм, (ii) до 5 мм.', 'About 1% per 1 cm of the field side: (i) field verified to 1 mm, (ii) to 5 mm.'), ref: `${T.add}, разд. 5.A.3` },
    charge: {
      label: L('Измерение заряда (камера, кабель, электрометр)', 'Charge measurement (chamber, cable, electrometer)'),
      how: L('(i) электрометр эталонного класса по спецификации IPEM (Morgan et al.); (ii) соответствует МЭК 60731, но характеристики не проверялись.', '(i) reference-class electrometer per the IPEM specification (Morgan et al.); (ii) meets IEC 60731 but its performance has not been evaluated.'),
      ref: `${T.add}, разд. 5.A.4`,
    },
    ptp: {
      label: L('Поправка на температуру и давление P_TP', 'Temperature–pressure correction P_TP'),
      how: L('(i) поверенные термометр (0,1 °C) и барометр (0,1 кПа), вода и камера в тепловом равновесии; (ii) без поверки и равновесия. Давление метеостанции не использовать.', '(i) calibrated thermometer (0.1 °C) and barometer (0.1 kPa), water and chamber in thermal equilibrium; (ii) uncalibrated, no equilibrium. Do not use weather-station pressure.'),
      ref: `${T.add}, разд. 5.A.5`,
    },
    hum: { label: L('Влажность', 'Humidity'), how: L('Относительная влажность 40–60 % — 0,05 %; 20–80 % — 0,15 %.', 'Relative humidity 40–60% — 0.05%; 20–80% — 0.15%.'), ref: `${T.add}, разд. 5.A.6` },
    ndw: {
      label: L('N_D,w в ⁶⁰Co из свидетельства', '⁶⁰Co N_D,w from the certificate'),
      how: L('0,75 % — значение лабораторий AAPM (ADCL); у вашей лаборатории может быть другим: введите U из свидетельства выше.', '0.75% is the value of the AAPM ADCLs; your laboratory may differ: enter U from the certificate above.'),
      ref: e ? `${T.r385}, разд. 8.3.1` : `${T.add}, разд. 5.B.1`,
      lab: true,
    },
    kq: e
      ? { label: L('Коэффициент k_Q (расчётные данные)', 'k_Q factor (calculated data)'), how: L('Систематическая неопределённость расчёта k_Q методом Монте-Карло, 0,3–0,6 %; типично 0,4 %.', 'Systematic uncertainty of Monte Carlo k_Q calculations, 0.3–0.6%; typically 0.4%.'), ref: `${T.r385}, разд. 8.3.2` }
      : { label: L('Коэффициент k_Q (расчётные данные)', 'k_Q factor (calculated data)'), how: L('(i) k_Q аддендума (Монте-Карло) — 0,4 %; (ii) k_Q TG-51 1999 года — 0,5 %.', '(i) addendum k_Q (Monte Carlo) — 0.4%; (ii) 1999 TG-51 k_Q — 0.5%.'), ref: `${T.add}, разд. 5.B.2` },
    kqassign: e
      ? {
          label: L('Выбор k_Q для вашего пучка', 'Assignment of k_Q factor'),
          how: L('R50 в пределах ±1 мм от базового — до 0,15 % в k_Q; выбор по R50: 0,08 % для цилиндрической и 0,12 % для плоскопараллельной камеры; (ii) — 2 мм и нетиповой пучок.', 'R50 within ±1 mm of baseline gives up to 0.15% in k_Q; selection from R50: 0.08% for a cylindrical and 0.12% for a plane-parallel chamber; (ii) 2 mm and a non-clinical beam.'),
          ref: `${T.r385}, разд. 8.3.3`,
        }
      : {
          label: L('Выбор k_Q для вашего пучка', 'Assignment of k_Q factor'),
          how: L('Измерение %dd(10)x (1 % даёт около 0,15 % в k_Q), выбор и интерполяция: для камер из табл. I — около 0,1 %; для камер, которых нет в таблице, — до 0,5 %.', 'Measurement of %dd(10)x (1% gives about 0.15% in k_Q), selection and interpolation: about 0.1% for chambers in Table I; up to 0.5% for chambers not listed.'),
          ref: `${T.add}, разд. 5.B.3`,
        },
    refstab: {
      label: L('Стабильность опорной камеры', 'Stability of reference chamber'),
      how: L('(i) камеру регулярно проверяют (в ⁶⁰Co, сравнением не меньше чем с тремя камерами, контрольным источником); (ii) без проверок между калибровками — 0,3–0,5 % и больше.', '(i) the chamber is monitored regularly (in ⁶⁰Co, by comparison with at least three chambers, with a check source); (ii) no checks between calibrations — 0.3–0.5% or more.'),
      ref: e ? `${T.r385}, разд. 8.3.4` : `${T.add}, разд. 5.B.4`,
    },
    ppol: e
      ? { label: L('Полярность P_pol', 'Polarity P_pol'), how: L('В электронах P_pol достигает 2 %: его обязательно измеряют; (ii) — по данным Williams и Agarwal.', 'In electron beams P_pol reaches 2%: it must be measured; (ii) from Williams and Agarwal.'), ref: `${T.r385}, разд. 8.4.1` }
      : { label: L('Полярность P_pol', 'Polarity P_pol'), how: L('Измеренная поправка с выдержкой после смены полярности и повтором первой полярности — 0,05 %.', 'A measured correction, with time allowed after the polarity change and the first polarity repeated — 0.05%.'), ref: `${T.add}, разд. 5.C.1` },
    pion: {
      label: L('Рекомбинация P_ion', 'Ion recombination P_ion'),
      how: L('Метод двух напряжений верен для камеры, которая ведёт себя по теории: (i) поведение проверено при нескольких напряжениях; (ii) плохая процедура или камера с неидеальным поведением.', 'The two-voltage technique holds for a chamber that behaves as theory predicts: (i) behaviour characterized at several voltages; (ii) poor procedure or a chamber with non-ideal behaviour.'),
      ref: `${T.add}, разд. 5.C.2`,
    },
    preirr: {
      label: L('Предварительное облучение', 'Pre-irradiation history'),
      how: L('(i) перед измерениями камера облучена дозой больше 10 Гр, стабильность показаний контролируется; (ii) без предоблучения и выдержки после смены напряжения — до 1 %.', '(i) chamber irradiated to more than 10 Gy before the measurements, stability monitored; (ii) no pre-irradiation and no waiting after a voltage change — up to 1%.'),
      ref: `${T.add}, разд. 5.C.3`,
    },
    leak: {
      label: L('Ток утечки', 'Leakage current'),
      how: L('Утечка не больше 0,1 % показания — P_leak = 1 с неопределённостью 0,1 %; больше 0,5 % — нужно искать причину.', 'Leakage at or below 0.1% of the reading — P_leak = 1 with a 0.1% uncertainty; above 0.5% it must be investigated.'),
      ref: `${T.add}, разд. 5.C.4`,
    },
    linac: {
      label: L('Стабильность ускорителя', 'Linac stability'),
      how: L('Кратковременная повторяемость серии облучений с одним числом МЕ; у современных ускорителей меньше 0,05 %.', 'Short-term repeatability of a series of fixed-MU irradiations; below 0.05% for modern linacs.'),
      ref: `${T.add}, разд. 5.C.5`,
      typeA: true,
    },
    pelec: {
      label: L('Калибровка электрометра P_elec', 'Electrometer calibration P_elec'),
      how: L('Из свидетельства о калибровке электрометра. Если камеру калибровали вместе с электрометром, отдельной составляющей нет — введите 0.', 'From the electrometer calibration certificate. If the chamber was calibrated together with the electrometer, there is no separate component: enter 0.'),
      ref: `${T.add}, разд. 5.C.6`,
    },
    prp: e
      ? { label: L('Профиль пучка P_rp', 'Radial beam profile P_rp'), how: L('Как в фотонах; при перекрёстной калибровке — для каждой камеры отдельно.', 'As for photons; for a cross-calibration, separately for each chamber.'), ref: `${T.r385}, разд. 8.4.2` }
      : { label: L('Профиль пучка P_rp', 'Radial beam profile P_rp'), how: L('(i) P_rp по подробному двумерному профилю; (ii) профиль принят однородным. Больше для БВФ и длинных камер.', '(i) P_rp from a detailed 2D profile; (ii) the profile assumed uniform. Larger for FFF beams and long chambers.'), ref: `${T.add}, разд. 5.C.7` },
  };
}

/** Строка перекрёстной калибровки рабочей камеры: оценка калькулятора по TRS-398, разд. 5.7 и 6.8. */
const crossRow = () => ({
  label: L('Перекрёстная калибровка рабочей камеры по опорной', 'Cross-calibration of the field chamber against the reference chamber'),
  how: L(
    'По TRS-398 с рабочим дозиметром неопределённость дозы возрастает примерно на 0,2 % (разд. 5.7, 6.8). 0,6 % в квадратуре дают такой прирост: √(1,04² + 0,6²) ≈ 1,2 % для табл. 17 и √(0,81² + 0,6²) ≈ 1,0 % для табл. 13. Это оценка калькулятора — замените своей, если оценивали перекрёстную калибровку сами.',
    'Per TRS-398, a field instrument increases the dose uncertainty by about 0.2% (Sec. 5.7, 6.8). 0.6% in quadrature gives that increase: √(1.04² + 0.6²) ≈ 1.2% for Table 17 and √(0.81² + 0.6²) ≈ 1.0% for Table 13. This is the calculator’s estimate: replace it with your own if you evaluated the cross-calibration yourself.',
  ),
  ref: `${T.trs}, разд. 5.7, 6.8`,
  cross: true,
});

// ------------------------------------------------------------------ строки kV-рентгена (TRS-398 Rev.1, табл. 30 и 33)
// Типовые значения — по столбцам «На основе N_D,w» и «На основе N_K»: [N_D,w, N_K]; null — строки в этом столбце нет.
const KV_T30 = {
  lab_psdl: [1.4, 0.5], lab_stab: [0.1, 0.1], lab_user: [0.5, 0.5],
  st_interp: [0.5, 0.5], st_muen: [null, 0.5], st_bw: [null, 1.0], st_kg: [1.0, null],
  st_stab: [0.3, 0.3], st_read: [0.1, 0.1], st_setup: [1.0, 1.0], st_ki: [0.8, 0.8],
};
const KV_T33 = {
  lab_psdl: [1.0, 0.5], lab_stab: [0.1, 0.1], lab_user: [0.5, 0.5],
  st_interp: [0.5, 0.5], st_pch: [null, 1.0], st_pchfs: [null, 0.5], st_muen: [null, 0.5], st_kg: [0.2, null],
  st_stab: [0.3, 0.3], st_read: [0.1, 0.1], st_setup: [1.0, 1.0], st_ki: [0.8, 0.8],
};
/** u_c при калибровке дозиметра пользователя прямо в ДЛПЭ (прим. c к табл. 30 и 33), %. */
const KV_DIRECT = { t30ndw: 2.2, t30nk: 1.9, t33ndw: 1.7, t33nk: 1.9 };
/** k_g = 1 при другом поле или РИП: оценка DIN 6809-4 и SSRMP No 9 (разд. 6.3, 6.4), % — низкие и средние энергии. */
const KV_KG_ONE = { low: 2.0, medium: 1.3 };
/** u_c по DIN 6809-4, табл. 7: средние энергии, камера откалибрована в ⁶⁰Co, %. */
const DIN_T7_UC = 1.8;
/** k_z = 1 — пересчёт с глубины калибровки 5 см на 2 см (DIN 6809-4), %. */
const DIN_KZ = 0.5;

function kvRows(ctx) {
  const low = ctx.kvRange !== 'medium';
  const nk = ctx.kvCal === 'nk';
  const n = nk ? 'N_K' : 'N_D,w';
  const sec = low ? 'разд. 8.6' : 'разд. 9.6';
  const secEn = low ? 'Sec. 8.6' : 'Sec. 9.6';
  return {
    lab_psdl: {
      label: L(`Калибровка вторичного эталона в ДЛПЭ (${n})`, `Calibration of the secondary standard at the PSDL (${n})`),
      how: L(
        `Три строки этапа 1 — то, что входит в неопределённость ${n} из свидетельства о калибровке камеры. Введите её выше — она заменит эти строки.`,
        `The three rows of step 1 make up the ${n} uncertainty stated in the chamber calibration certificate. Enter it above and it will replace these rows.`,
      ),
      lab: true,
    },
    lab_stab: { label: L('Долговременная стабильность вторичного эталона', 'Long-term stability of the secondary standard'), lab: true },
    lab_user: { label: L(`Калибровка дозиметра пользователя в поверочной лаборатории (${n})`, `Calibration of the user's dosimeter at the standards laboratory (${n})`), lab: true },
    st_interp: low
      ? {
          label: L('Интерполяция калибровочного коэффициента на пучок пользователя', "Interpolation of the calibration coefficient to the user's beam"),
          how: L('Значение сертификата для СПО вашего пучка — интерполяция между качествами лаборатории по ln(СПО).', "The certificate value for the HVL of your beam: interpolation between the laboratory qualities in ln(HVL)."),
        }
      : {
          label: L('Процедура получения калибровочного коэффициента в пучке пользователя', "Procedure for obtaining the calibration coefficient in the user's beam"),
          how: L('Интерполяция значения сертификата на СПО вашего пучка по ln(СПО).', "Interpolation of the certificate value to the HVL of your beam in ln(HVL)."),
        },
    st_muen: {
      label: L('Отношение средних массовых коэффициентов поглощения энергии вода/воздух', 'Ratio of mean mass energy-absorption coefficients, water/air'),
      how: low
        ? L('[μen/ρ]w,air в свободном воздухе (данные Andreo).', '[μen/ρ]w,air free in air (Andreo data).')
        : L('[μen/ρ]w,air на глубине 2 см (данные Andreo).', '[μen/ρ]w,air at a depth of 2 cm (Andreo data).'),
    },
    st_bw: { label: L('Коэффициент обратного рассеяния B_w', 'Backscatter factor B_w'), how: L('B_w для СПО, поля и РИП пучка (данные Andreo).', 'B_w for the HVL, field and SSD of the beam (Andreo data).') },
    st_pch: { label: L('Поправка на возмущение камеры p_ch', 'Chamber perturbation correction p_ch'), how: L('Среднее по измерениям и расчётам (табл. 32).', 'Mean of measured and calculated values (Table 32).') },
    st_pchfs: {
      label: L('Зависимость p_ch от размера поля', 'Field-size dependence of p_ch'),
      how: L('Добавляется, если зависимостью p_ch от поля пренебрегают (разд. 9.6).', 'Added when the field-size dependence of p_ch is neglected (Sec. 9.6).'),
    },
    st_kg: { label: L('Поправочный коэффициент на геометрию k_g', 'Geometry correction factor k_g'), how: '' },
    st_kz: {
      label: L('Пересчёт с глубины 5 см на 2 см, k_z = 1 (Qo = ⁶⁰Co)', 'Transfer from 5 cm to 2 cm depth, k_z = 1 (Qo = ⁶⁰Co)'),
      how: L(
        'N_D,w и k_Q,M получены на 5 см, доза определяется на 2 см; DIN 6809-4 принимает k_z = 1 с неопределённостью 0,5 %. В табл. 33 Rev.1 этой строки нет.',
        'N_D,w and k_Q,M are obtained at 5 cm, while the dose is determined at 2 cm; DIN 6809-4 takes k_z = 1 with an uncertainty of 0.5%. Rev.1 Table 33 has no such row.',
      ),
    },
    st_kq1: {
      label: L('k_Q = 1: калибровки камеры в рентгене нет', 'k_Q = 1: no x-ray calibration of the chamber'),
      how: L(
        'Камера откалибрована только в ⁶⁰Co, k_Q,M рентгеновских качеств приняты равными 1. Типового значения нет: насколько k_Q,M отличается от 1, без калибровки в рентгене не узнать. Пока здесь нет своей оценки с источником, u_c её не включает и занижена.',
        'The chamber is calibrated in ⁶⁰Co only; the k_Q,M of the x-ray qualities are taken as 1. There is no typical value: how far k_Q,M is from 1 cannot be known without an x-ray calibration. Until your own estimate with its source is entered here, u_c does not include it and is underestimated.',
      ),
    },
    st_stab: {
      label: L('Долговременная стабильность дозиметра пользователя', "Long-term stability of the user's dosimeter"),
      how: L('Изменение отклика камеры с электрометром между калибровками: по контрольному источнику или сравнению с другими камерами.', 'Change in the response of the chamber and electrometer between calibrations: from a check source or a comparison with other chambers.'),
    },
    st_read: {
      label: L('Показания дозиметра M_Q относительно таймера или монитора пучка', 'Dosimeter reading M_Q relative to the timer or beam monitor'),
      how: L(
        `Колебания выхода аппарата в типовое значение не входят: у аппаратов без камеры-монитора в серии одинаковых облучений они достигают 5 %. Оцените их по стандартному отклонению не меньше пяти облучений типичной длительности (${sec}) и введите своё значение.`,
        `Variations of the machine output are not included in the typical value: without a monitor chamber they reach 5% within a series of identical exposures. Estimate them from the standard deviation of at least five exposures of typical duration (${secEn}) and enter your own value.`,
      ),
      typeA: true,
    },
    st_setup: {
      label: L('Установление стандартных условий', 'Establishment of reference conditions'),
      how: low
        ? L('Воспроизводимость установки при коротком РИП и разница между опорной точкой и эффективной точкой измерения камеры (прим. b к табл. 30).', 'Reproducibility of positioning at a short SSD and the difference between the reference point and the effective point of measurement of the chamber (Table 30, note b).')
        : L('Градиент дозы в нижней части диапазона — до 1 %/мм: воспроизводимость установки глубины лучше 1 % обеспечить трудно (разд. 9.6).', 'The dose gradient at the lower end of the range reaches 1%/mm, so a depth reproducibility better than 1% is hard to achieve (Sec. 9.6).'),
    },
    st_ki: {
      label: L('Поправка на влияющие величины k_i', 'Correction for influence quantities k_i'),
      how: L(
        `k_TP, k_pol, k_s, k_elec, k_leak. Температура камеры может отличаться от измеренной не меньше чем на ±1 °C из-за нагрева от трубки (${sec}).`,
        `k_TP, k_pol, k_s, k_elec, k_leak. The chamber temperature may differ from the measured one by at least ±1 °C because of heating by the tube (${secEn}).`,
      ),
    },
  };
}

/** Строка k_g по тому, как он получен на вкладке: рассчитан, не нужен (геометрия как в лаборатории) или принят равным 1. */
function kvKgRow(R, ctx, def) {
  const low = ctx.kvRange !== 'medium';
  if (ctx.kvKg === 'same') {
    return { ...R.st_kg, def: 0, how: L('Поле и РИП — как в лаборатории: k_g = 1 без поправки, неопределённости от неё нет.', 'Field and SSD as at the laboratory: k_g = 1 with no correction, so it adds no uncertainty.') };
  }
  if (ctx.kvKg === 'one') {
    return {
      ...R.st_kg,
      def: KV_KG_ONE[low ? 'low' : 'medium'],
      ref: `${T.din}, разд. 6.3, 6.4`,
      how: L(
        `k_g принят равным 1, хотя поле или РИП отличаются от лабораторных (DIN 6809-4, SSRMP No 9; не TRS-398 Rev.1): их оценка неопределённости — ${pct(KV_KG_ONE.low, 1)} % для низких и ${pct(KV_KG_ONE.medium, 1)} % для средних энергий.`,
        `k_g is taken as 1 although the field or SSD differ from the laboratory (DIN 6809-4, SSRMP No 9; not TRS-398 Rev.1): their uncertainty estimate is ${pct(KV_KG_ONE.low, 1)}% for low and ${pct(KV_KG_ONE.medium, 1)}% for medium energies.`,
      ),
    };
  }
  return {
    ...R.st_kg,
    def,
    how: low
      ? L('k_g по табл. 28–29, ур. (85) или от лаборатории. При k_g по табл. 28–29 в эту строку входит и расхождение значений по кВ и по СПО, показанное на вкладке «kV-рентген».', 'k_g from Tables 28–29, Eq. (85) or the laboratory. With k_g from Tables 28–29 this row also covers the difference between the values by kV and by HVL shown on the kV x-rays tab.')
      : L('k_g по ур. (90) (данные Andreo) или от лаборатории.', 'k_g from Eq. (90) (Andreo data) or from the laboratory.'),
  };
}

// ------------------------------------------------------------------ шаблоны
// Значения строк: число (одинаково в обоих примерах TG-51) или [пример (i), пример (ii)].

const TRS_STAGE1 = { lab_psdl: 0.5, lab_stab: 0.1, lab_user: 0.4 };
const TG_II = { ssd: [0.1, 0.4], depth: [0.17, 0.5], field: [0.1, 0.5], charge: [0.23, 0.5], ptp: [0.1, 0.4], hum: [0.05, 0.15], ndw: 0.75, kq: [0.4, 0.5], kqassign: [0.1, 0.6], refstab: [0.05, 0.5], ppol: [0.05, 0.5], pion: [0.1, 0.5], preirr: [0.1, 1.0], leak: [0.05, 0.3], linac: [0.05, 0.2], pelec: [0.07, 0.25], prp: [0.05, 0.4] };
const TG_385_MEAS = { ssd: [0.1, 0.4], depth: [0.04, 0.3], field: [0.1, 0.5], charge: [0.23, 0.5], ptp: [0.1, 0.4], hum: [0.05, 0.15] };
const TG_385_INFL = { ppol: [0.05, 0.5], pion: [0.1, 0.5], preirr: [0.1, 1.0], leak: [0.05, 0.3], linac: [0.05, 0.2], pelec: [0.07, 0.25], prp: [0.05, 0.4] };

/** Выбор образца по пучку, протоколу и способу калибровки камеры. */
export function pickTemplate({ beam, protocol, chamberType, crossE, kvRange, kvCal }) {
  const tg = protocol === 'tg51';
  // kV-рентген: TG-51 его не охватывает — всегда TRS-398 Rev.1, табл. 30 (низкие) или 33 (средние энергии)
  if (beam === 'kv') return `${kvRange === 'medium' ? 't33' : 't30'}${kvCal === 'nk' ? 'nk' : 'ndw'}`;
  if (beam === 'co60') return 't13';
  if (beam === 'photons') return tg ? 'add2' : 't17';
  if (crossE) return tg ? 'r385t9' : 't24x';
  return tg ? 'r385t8' : chamberType === 'pp' ? 't24pp' : 't24cyl';
}

function buildTemplate(id, ctx) {
  const sit = ctx.situation === 'ii' ? 1 : 0;
  const v = (x) => (Array.isArray(x) ? x[sit] : x);
  const groups = [];
  const g = (title, rows, subtotal = false) => groups.push({ title, rows, subtotal });
  const stage1 = L('Этап 1. Поверочная лаборатория', 'Step 1. Standards laboratory');
  if (/^t3[03]/.test(id)) {
    const R = kvRows(ctx);
    const tbl = id.startsWith('t30') ? KV_T30 : KV_T33;
    const col = id.endsWith('nk') ? 1 : 0;
    const ref = `${T.trs}, табл. ${id.slice(1, 3)}`;
    const rows = Object.entries(tbl)
      .filter(([, d]) => d[col] !== null)
      .map(([key, d]) => ({ key, ...(key === 'st_kg' ? kvKgRow(R, ctx, d[col]) : { ...R[key], def: d[col] }), ...(key === 'st_kg' && ctx.kvKg === 'one' ? {} : { ref }) }));
    const st2 = rows.filter((r) => !r.lab);
    // Qo = ⁶⁰Co (DIN 6809-4): к табл. 33 добавляется k_z = 1 — пересчёт с 5 см на 2 см
    if (id === 't33ndw' && ctx.kvQo === 'co60') {
      const at = st2.findIndex((r) => r.key === 'st_kg') + 1;
      st2.splice(at, 0, { key: 'st_kz', ...R.st_kz, def: DIN_KZ, ref: `${T.din}, разд. 6.4` });
      // калибровки в рентгене нет: строка k_Q = 1 без типового значения — оценку вводит пользователь
      if (ctx.kvKq === 'one') st2.splice(at + 1, 0, { key: 'st_kq1', ...R.st_kq1, def: NaN, ref: L('не TRS-398 Rev.1 и не DIN 6809-4', 'neither TRS-398 Rev.1 nor DIN 6809-4') });
    }
    g(stage1, rows.filter((r) => r.lab), true);
    g(L('Этап 2. Пучок рентгеновского излучения пользователя', "Step 2. User's x-ray beam"), st2, true);
    return { family: id, groups, stages: true };
  }
  if (['t13','t17', 't24cyl', 't24pp', 't24x'].includes(id)) {
    const R = trsRows(ctx);
    const table = { t13: 'табл. 13', t17: 'табл. 17', t24cyl: 'табл. 24', t24pp: 'табл. 24', t24x: 'табл. 24' }[id];
    const ref = `${T.trs}, ${table}`;
    const mk = (key, def) => ({ key, ...R[key], def, ref: R[key].ref || ref });
    g(stage1, Object.entries(TRS_STAGE1).map(([k, d]) => mk(k, d)), true);
    let st2;
    if (id === 't13') {
      st2 = [mk('st_stab', 0.2), mk('st_setup', 0.3), mk('st_read', 0.1), mk('st_ki', 0.3)];
    } else if (id === 't17') {
      st2 = [mk('st_stab', 0.2), mk('st_setup', 0.3), mk('st_read', 0.3), mk('st_ki', 0.3), mk('st_kq', 0.6)];
    } else {
      const pp = id === 't24pp';
      const lowR50 = pp && Number.isFinite(ctx.r50) && ctx.r50 < 2;
      st2 = [mk('st_stab', pp ? 0.4 : 0.2), mk('st_setup', 0.3), mk('st_read', 0.3), mk('st_ki', 0.3), mk('st_kq', lowR50 ? 0.8 : 0.7), mk('st_kqapp', 0.2)];
    }
    // в электронах после перекрёстной калибровки её учитывает сам образец (разд. 7.10)
    if ((ctx.crossCo || ctx.crossQ) && !ctx.crossE) st2.push({ key: 'st_cross', ...crossRow(), def: 0.6 });
    const where = { t13: L('пучок ⁶⁰Co', '⁶⁰Co beam'), t17: L('пучок фотонов высокой энергии', 'high-energy photon beam') }[id] ?? L('пучок электронов', 'electron beam');
    g(L(`Этап 2. ${where[0].toUpperCase()}${where.slice(1)} пользователя`, `Step 2. User ${where}`), st2, true);
    return { family: id.startsWith('t24') ? 't24' : id, groups, stages: true };
  }
  const R = tg51Rows(ctx);
  const mk = (key, def, extra = {}) => ({ key, ...R[key], def: v(def), ...extra });
  if (id === 'add2') {
    g(L('Измерение', 'Measurement'), ['ssd', 'depth', 'field', 'charge', 'ptp', 'hum'].map((k) => mk(k, TG_II[k])));
    const cal = ['ndw', 'kq', 'kqassign', 'refstab'].map((k) => mk(k, TG_II[k]));
    if (ctx.crossCo || ctx.crossQ) cal.push({ key: 'st_cross', ...crossRow(), def: 0.6 });
    g(L('Калибровочные данные', 'Calibration data'), cal);
    g(L('Влияющие величины', 'Influence quantities'), ['ppol', 'pion', 'preirr', 'leak', 'linac', 'pelec', 'prp'].map((k) => mk(k, TG_II[k])));
    return { family: 'add2', groups };
  }
  // Report 385: составляющие, общие с фотонами, — со ссылкой на разд. 8.1 и аддендум
  const ref = (k) => (R[k].ref.startsWith(T.add) ? { ref: `${T.r385}, разд. 8.1; ${R[k].ref}` } : {});
  if (id === 'r385t8') {
    const pp = ctx.chamberType === 'pp';
    g(L('Измерение', 'Measurement'), Object.keys(TG_385_MEAS).map((k) => mk(k, TG_385_MEAS[k], ref(k))));
    const cal = [mk('ndw', 0.75), mk('kq', 0.4), mk('kqassign', [pp ? 0.12 : 0.08, 0.36]), mk('refstab', [0.05, 0.5])];
    if (ctx.crossCo) cal.push({ key: 'st_cross', ...crossRow(), def: 0.6 });
    g(L('Калибровочные данные', 'Calibration data'), cal);
    g(L('Влияющие величины', 'Influence quantities'), Object.keys(TG_385_INFL).map((k) => mk(k, TG_385_INFL[k], ref(k))));
    return { family: 'r385t8', groups };
  }
  // r385t9: плоскопараллельная камера после перекрестной калибровки по цилиндрической
  const sub = (prefix, k, def) => ({ ...mk(k, def, ref(k)), key: `${prefix}.${k}` });
  g(L('Опорная камера (цилиндрическая)', 'Reference chamber (cylindrical)'), [
    sub('ref', 'depth', [0.04, 0.3]), sub('ref', 'charge', [0.23, 0.5]), sub('ref', 'ndw', 0.75), sub('ref', 'kq', 0.4), sub('ref', 'kqassign', [0.08, 0.36]), sub('ref', 'refstab', [0.05, 0.5]),
    sub('ref', 'ppol', [0.05, 0.5]), sub('ref', 'pion', [0.1, 0.5]), sub('ref', 'preirr', [0.1, 1.0]), sub('ref', 'leak', [0.05, 0.3]), sub('ref', 'pelec', [0.07, 0.25]), sub('ref', 'prp', [0.05, 0.4]),
  ]);
  g(L('Откалиброванная (рабочая) камера', 'Calibrated (field) chamber'), [
    sub('fld', 'depth', [0.04, 0.3]), sub('fld', 'charge', [0.23, 0.5]), sub('fld', 'kq', 0.4), sub('fld', 'kqassign', [0.12, 0.36]),
    sub('fld', 'ppol', [0.05, 0.5]), sub('fld', 'pion', [0.1, 0.5]), sub('fld', 'preirr', [0.1, 1.0]), sub('fld', 'leak', [0.05, 0.3]), sub('fld', 'pelec', [0.07, 0.25]), sub('fld', 'prp', [0.05, 0.4]),
  ]);
  g(L('Общие составляющие', 'Common components'), [sub('com', 'ssd', [0.1, 0.4]), sub('com', 'field', [0.1, 0.5]), sub('com', 'ptp', [0.1, 0.4]), sub('com', 'hum', [0.05, 0.15]), sub('com', 'linac', [0.05, 0.2])]);
  return { family: 'r385t9', groups };
}

function templateInfo(id, ctx) {
  const sitTxt = ctx.situation === 'ii' ? L('пример (ii): типичные допущения', 'example (ii): “typical” assumptions') : L('пример (i): всё оценено, оборудование эталонного класса', 'example (i): all components evaluated, reference-class equipment');
  if (/^t3[03]/.test(id)) {
    const low = id.startsWith('t30');
    const nk = id.endsWith('nk');
    const n = nk ? 'N_K' : 'N_D,w';
    const tbl = low ? '30' : '33';
    const co60 = !low && !nk && ctx.kvQo === 'co60';
    const notes = [
      L(
        `Если дозиметр откалиброван прямо в ДЛПЭ, по табл. ${tbl} u_c = ${pct(KV_DIRECT[id], 1)} %: введите U из свидетельства — она заменит этап 1.`,
        `If the dosimeter was calibrated directly at a PSDL, Table ${tbl} gives u_c = ${pct(KV_DIRECT[id], 1)}%: enter U from the certificate and it will replace step 1.`,
      ),
      L(
        'Колебания выхода аппарата в таблицу не входят: оцените их сами (строка «Показания дозиметра…»).',
        'Variations of the machine output are not included in the table: estimate them yourself (the “Dosimeter reading…” row).',
      ),
    ];
    if (co60) {
      notes.push(L(
        `Qo = ⁶⁰Co (DIN 6809-4, не TRS-398 Rev.1): для этого случая в Rev.1 бюджета нет, показана табл. 33 (N_D,w) со строкой k_z = 1 (DIN, ${pct(DIN_KZ, 1)} %). По DIN 6809-4, табл. 7, при калибровке в ⁶⁰Co u_c = ${pct(DIN_T7_UC, 2)} %.`,
        `Qo = ⁶⁰Co (DIN 6809-4, not TRS-398 Rev.1): Rev.1 gives no budget for this case, so Table 33 (N_D,w) is shown with a k_z = 1 row (DIN, ${pct(DIN_KZ, 1)}%). DIN 6809-4, Table 7, gives u_c = ${pct(DIN_T7_UC, 2)}% for a calibration in ⁶⁰Co.`,
      ));
      if (ctx.kvKq === 'one') {
        notes.push(L(
          'Камера откалибрована только в ⁶⁰Co, k_Q = 1: так не допускают ни Rev.1, ни DIN 6809-4, и типовой оценки для этого нет. Строка «k_Q = 1…» пуста, пока вы не введёте свою оценку с источником; до этого u_c её не включает.',
          'The chamber is calibrated in ⁶⁰Co only, k_Q = 1: neither Rev.1 nor DIN 6809-4 allows this, and there is no typical estimate for it. The “k_Q = 1…” row stays empty until you enter your own estimate with its source; until then u_c does not include it.',
        ));
      }
    }
    if (ctx.protocol === 'tg51') notes.push(L('TG-51 не охватывает kV-рентген: показан бюджет TRS-398 Rev.1.', 'TG-51 does not cover kV x-rays: the TRS-398 Rev.1 budget is shown.'));
    return {
      ref: `${T.trs}, табл. ${tbl}`,
      title: low
        ? L(`TRS-398 Rev.1, табл. 30 — kV-рентген низких энергий, калибровка ${n}`, `TRS-398 Rev.1, Table 30 — low-energy kV x-rays, ${n} calibration`)
        : L(`TRS-398 Rev.1, табл. 33 — kV-рентген средних энергий, калибровка ${n}${co60 ? ' (Qo = ⁶⁰Co)' : ''}`, `TRS-398 Rev.1, Table 33 — medium-energy kV x-rays, ${n} calibration${co60 ? ' (Qo = ⁶⁰Co)' : ''}`),
      note: notes.join(' '),
    };
  }
  switch (id) {
    case 't13':
      return {
        ref: `${T.trs}, табл. 13`,
        title: L('TRS-398 Rev.1, табл. 13 — пучок ⁶⁰Co', 'TRS-398 Rev.1, Table 13 — ⁶⁰Co beam'),
        note: ctx.protocol === 'tg51' ? L('TG-51 и его аддендумы не приводят бюджета неопределённости для ⁶⁰Co — показан пример TRS-398.', 'TG-51 and its addenda give no uncertainty budget for ⁶⁰Co; the TRS-398 example is shown.') : '',
      };
    case 't17':
      return { ref: `${T.trs}, табл. 17`, title: L('TRS-398 Rev.1, табл. 17 — МВ фотоны, камера откалибрована в ⁶⁰Co', 'TRS-398 Rev.1, Table 17 — MV photons, chamber calibrated in ⁶⁰Co'), note: '' };
    case 't24cyl':
    case 't24pp':
      return {
        ref: `${T.trs}, табл. 24`,
        title: id === 't24pp'
          ? L('TRS-398 Rev.1, табл. 24 — электроны, плоскопараллельная камера, откалиброванная в ⁶⁰Co', 'TRS-398 Rev.1, Table 24 — electrons, plane-parallel chamber calibrated in ⁶⁰Co')
          : L('TRS-398 Rev.1, табл. 24 — электроны, цилиндрическая камера, откалиброванная в ⁶⁰Co', 'TRS-398 Rev.1, Table 24 — electrons, cylindrical chamber calibrated in ⁶⁰Co'),
        note: '',
      };
    case 't24x':
      return {
        ref: `${T.trs}, табл. 24; разд. 7.10`,
        title: L('TRS-398 Rev.1, табл. 24 (столбец цилиндрической камеры) — камера после перекрёстной калибровки в пучке электронов', 'TRS-398 Rev.1, Table 24 (cylindrical chamber column) — chamber cross-calibrated in an electron beam'),
        note: L(
          'Отдельной таблицы для перекрёстно откалиброванной камеры TRS-398 не даёт: по разд. 7.10 её неопределённость близка к цилиндрической камере табл. 24.',
          'TRS-398 gives no separate table for a cross-calibrated chamber: per Sec. 7.10 its uncertainty approaches that of the cylindrical chamber in Table 24.',
        ),
      };
    case 'add2':
      return { ref: `${T.add}, табл. II`, title: L(`Аддендум TG-51 (2014), табл. II — ${sitTxt}`, `TG-51 addendum (2014), Table II — ${sitTxt}`), note: '', situations: true };
    case 'r385t8':
      return { ref: `${T.r385}, табл. 8`, title: L(`Report 385, табл. 8 — камера откалибрована в ⁶⁰Co; ${sitTxt}`, `Report 385, Table 8 — chamber calibrated in ⁶⁰Co; ${sitTxt}`), note: '', situations: true };
    default:
      return { ref: `${T.r385}, табл. 9`, title: L(`Report 385, табл. 9 — плоскопараллельная камера после перекрёстной калибровки; ${sitTxt}`, `Report 385, Table 9 — plane-parallel chamber after cross-calibration; ${sitTxt}`), note: '', situations: true };
  }
}

/**
 * Бюджет неопределённости.
 * @param {object} o
 * @param {'photons'|'electrons'|'co60'|'kv'} o.beam
 * @param {'low'|'medium'} [o.kvRange]  kV-рентген: низкие (табл. 30) или средние (табл. 33) энергии
 * @param {'ndw'|'nk'} [o.kvCal]        kV-рентген: калибровка N_D,w или N_K
 * @param {'kv'|'co60'} [o.kvQo]        kV-рентген, средние энергии, N_D,w: опорное качество (⁶⁰Co — DIN 6809-4)
 * @param {'calc'|'same'|'one'} [o.kvKg] kV-рентген, N_D,w: k_g рассчитан; не нужен (геометрия как в лаборатории); принят 1
 * @param {'cert'|'one'} [o.kvKq]   kV-рентген, Qo = ⁶⁰Co: k_Q,M из калибровки в рентгене или k_Q = 1 без неё
 * @param {'trs'|'tg51'} o.protocol
 * @param {'cyl'|'pp'} [o.chamberType]   тип камеры (электроны)
 * @param {boolean} [o.crossQ]   фотоны: рабочая камера откалибрована в клиническом пучке Q_cross (TRS-398, разд. 4.5.2)
 * @param {boolean} [o.crossE]   электроны: камера откалибрована перекрёстно в пучке электронов
 * @param {boolean} [o.crossCo]  N_D,w рабочей камеры получен перекрёстной калибровкой в ⁶⁰Co
 * @param {number} [o.r50]       R50, г/см² (электроны)
 * @param {'i'|'ii'} [o.situation] пример TG-51
 * @param {string} [o.certU]     расширенная неопределённость N_D,w из свидетельства, %
 * @param {string} [o.certK]     коэффициент охвата в свидетельстве (пусто — 2)
 * @param {string|object} [o.over] свои значения строк { ключ: строка }
 * @param {{n:number,pct:number}|null} [o.typeA] повторяемость серии показаний
 * @param {string} [o.prefix]    префикс полей формы вкладки ('', 'e_', 'co_')
 */
export function uncertaintyBudget(o) {
  const ctx = { ...o, situation: o.situation === 'ii' ? 'ii' : 'i' };
  const prefix = o.prefix ?? '';
  const id = pickTemplate(ctx);
  const info = templateInfo(id, ctx);
  const tpl = buildTemplate(id, ctx);
  const messages = [];
  const add = (level, text, field = null, ref = null) => messages.push({ level, scope: 'unc', text, ref, field });
  // калибровочный коэффициент, неопределённость которого даёт свидетельство
  const nName = o.beam === 'kv' && o.kvCal === 'nk' ? 'N_K' : 'N_D,w';
  // kV-рентген: расчёт не по TRS-398 Rev.1 помечается всегда
  if (o.beam === 'kv' && id === 't33ndw' && o.kvQo === 'co60') {
    add('warn', L('Qo = ⁶⁰Co — расчёт по DIN 6809-4, не по TRS-398 Rev.1: типовой бюджет — табл. 33 Rev.1 (N_D,w) по аналогии, со строкой k_z = 1 по DIN.', 'Qo = ⁶⁰Co: the calculation follows DIN 6809-4, not TRS-398 Rev.1; the typical budget is Rev.1 Table 33 (N_D,w) by analogy, with a k_z = 1 row per DIN.'), `${prefix}unc_kv_qo`, `${T.din}, табл. 7`);
  }
  if (o.beam === 'kv' && id === 't33ndw' && o.kvQo === 'co60' && o.kvKq === 'one') {
    const own = !isBlank(parseOverrides(o.over)[`${id}.st_kq1`]);
    add('warn', own
      ? L('k_Q = 1 без калибровки камеры в рентгене — не по TRS-398 Rev.1 и не по DIN 6809-4: u_c включает вашу оценку в строке «k_Q = 1…».', 'k_Q = 1 without an x-ray calibration of the chamber is neither TRS-398 Rev.1 nor DIN 6809-4: u_c includes your estimate in the “k_Q = 1…” row.')
      : L('k_Q = 1 без калибровки камеры в рентгене — не по TRS-398 Rev.1 и не по DIN 6809-4. Типового значения для этого нет, и u_c его не включает: введите свою оценку с источником в строке «k_Q = 1…», иначе u_c занижена.', 'k_Q = 1 without an x-ray calibration of the chamber is neither TRS-398 Rev.1 nor DIN 6809-4. There is no typical value for it and u_c does not include it: enter your own estimate with its source in the “k_Q = 1…” row, otherwise u_c is underestimated.'),
    `${prefix}unc_kv_kq`, `${T.trs}, разд. 9.2.1; ${T.din}, разд. 6.4.2`);
  }
  if (o.beam === 'kv' && o.kvCal !== 'nk' && o.kvKg === 'one') {
    add('warn', L('k_g = 1 при другом поле или РИП — подход DIN 6809-4 и SSRMP No 9, не TRS-398 Rev.1: строка k_g — их оценка неопределённости.', 'k_g = 1 with a different field or SSD is the DIN 6809-4 and SSRMP No 9 approach, not TRS-398 Rev.1: the k_g row is their uncertainty estimate.'), `${prefix}unc_kv_kg`, `${T.din}, разд. 6.3, 6.4`);
  }

  // свидетельство о калибровке
  let cert = null;
  if (!isBlank(o.certU)) {
    const U = parseNumber(o.certU);
    let k = isBlank(o.certK) ? COVERAGE_K : parseNumber(o.certK);
    if (!Number.isFinite(k) || k <= 0) {
      add('warn', L('Не удалось прочитать коэффициент охвата из свидетельства: принят k = 2.', 'Could not read the coverage factor from the certificate: k = 2 is assumed.'), `${prefix}unc_cert_k`);
      k = COVERAGE_K;
    } else if (k < 1 || k > 3) {
      add('warn', L(`Коэффициент охвата k = ${ru(k, 2)} необычен: в свидетельствах обычно k = 2.`, `Coverage factor k = ${ru(k, 2)} is unusual: certificates usually state k = 2.`), `${prefix}unc_cert_k`);
    }
    if (!Number.isFinite(U)) {
      add('warn', L('Не удалось прочитать U из свидетельства: лабораторная часть бюджета взята из типового.', 'Could not read U from the certificate: the laboratory part of the budget is taken from the typical budget.'), `${prefix}unc_cert_U`);
    } else if (U <= 0 || U > 10) {
      add('warn', L(`U = ${ru(U, 2)} % из свидетельства неправдоподобно: введите расширенную неопределённость ${nName} в процентах. Лабораторная часть бюджета взята из типового.`, `U = ${ru(U, 2)}% from the certificate is implausible: enter the expanded uncertainty of ${nName} in percent. The laboratory part of the budget is taken from the example.`), `${prefix}unc_cert_U`);
    } else {
      cert = { U, k, u: U / k };
    }
  }

  const over = parseOverrides(o.over);
  const notes = parseOverrides(o.rowNotes);
  const noSource = [];
  if (o.ki && tpl.stages) {
    for (const m of o.ki.messages) add(m.level, m.text, m.field ?? null);
    noSource.push(...o.ki.noSource);
  }
  if (o.setup && tpl.stages) {
    for (const m of o.setup.messages) add(m.level, m.text, m.field ?? null);
    noSource.push(...o.setup.noSource);
  }
  const typeA = o.typeA && Number.isFinite(o.typeA.pct) ? o.typeA : null;
  const rows = [];
  const groups = [];
  for (const gr of tpl.groups) {
    const out = [];
    for (const spec of gr.rows) {
      const key = `${tpl.family}.${spec.key}`;
      const row = { key, id: `${prefix}unc_ov_${key}`, label: spec.label, how: spec.how || '', ref: spec.ref, def: spec.def, type: 'B', cross: !!spec.cross };
      // лабораторная часть: TRS-398 — три строки этапа 1 заменяются одной строкой из свидетельства;
      // TG-51 — значение строки N_D,w
      if (cert && spec.lab && tpl.stages) {
        // не учитывается: вместо трёх строк этапа 1 — одна строка «N_D,w из свидетельства» (U/k)
        row.replaced = true;
        row.value = NaN;
        row.how = spec.key === 'lab_psdl'
          ? L(
              `Три строки этапа 1 — то, что входит в неопределённость ${nName} из свидетельства. Вы ввели U из свидетельства (раздел 2), поэтому вместо них в расчёт идёт строка «${nName} из свидетельства о калибровке (U/k)» ниже. Типовые значения оставлены для сравнения; чтобы вернуть их в расчёт, очистите поле «U из свидетельства».`,
              `The three rows of step 1 make up the ${nName} uncertainty stated in the certificate. You entered U from the certificate (section 2), so the “${nName} from the calibration certificate (U/k)” row below is used instead. The typical values are kept for comparison; to use them again, clear the “U from the certificate” field.`,
            )
          : '';
      } else {
        row.value = spec.def;
        if (cert && spec.lab) {
          row.value = cert.u;
          row.fromCert = true;
          row.how = L(
            `Из свидетельства: U = ${pct(cert.U)} % при k = ${ru(cert.k, cert.k % 1 ? 2 : 0)}, приведённая к k = 1. В типовом бюджете — ${pct(spec.def)} % (лаборатории AAPM).`,
            `From the certificate: U = ${pct(cert.U)}% at k = ${ru(cert.k, cert.k % 1 ? 2 : 0)}, converted to k = 1. The example uses ${pct(spec.def)}% (AAPM laboratories).`,
          );
        }
        if (spec.key === 'st_setup' && o.setup && tpl.stages) {
          row.value = o.setup.pct;
          row.fromSetup = true;
          row.how = L(
            `Раскрыта по составляющим ниже («Раскрытие установки стандартных условий»): ${o.setup.factors.map((x) => `${x.label} ${pct(x.value)}`).join('; ')}.`,
            `Broken down by component below (breakdown of the reference conditions): ${o.setup.factors.map((x) => `${x.label} ${pct(x.value)}`).join('; ')}.`,
          );
        }
        if (spec.key === 'st_ki' && o.ki && tpl.stages) {
          row.value = o.ki.pct;
          row.fromKi = true;
          row.how = L(
            `Раскрыта по поправкам ниже («Раскрытие k_i»): ${o.ki.factors.map((x) => `${x.label} ${pct(x.value)}`).join('; ')}.`,
            `Broken down by correction below (k_i breakdown): ${o.ki.factors.map((x) => `${x.label} ${pct(x.value)}`).join('; ')}.`,
          );
        }
        if (spec.typeA) {
          row.typeA = typeA;
          if (typeA && typeA.pct > row.value) {
            row.value = typeA.pct;
            row.type = 'A';
            row.fromTypeA = true;
          }
          row.how = [row.how, typeAText(typeA, spec.def)].filter(Boolean).join(' ');
        }
        // своё значение: способом из «как получено» (U/k, предел/√3 и т. п.) или числом в поле «Своё»
        const est = notes[key];
        const byMethod = !row.fromKi && !row.fromSetup && hasMethod(est) ? estimateU(est) : null;
        if (byMethod?.error) add('warn', L(`«${row.label}», как получено: ${byMethod.error} — взято число из поля «Своё» или типовое значение.`, `"${row.label}", how obtained: ${byMethod.error}; the number in the “Yours” field or the typical value is used.`), row.id);
        const raw = row.fromKi || row.fromSetup ? '' : byMethod && !byMethod.error ? String(byMethod.u) : over[key];
        if (byMethod && !byMethod.error) row.byMethod = byMethod;
        if (!isBlank(raw)) {
          const x = parseNumber(raw);
          row.raw = String(raw);
          if (!Number.isFinite(x) || x < 0) {
            row.invalid = true;
            add('warn', L(`«${row.label}»: своё значение «${raw}» не прочитано — взято типовое значение.`, `"${row.label}": your value "${raw}" could not be read; the typical value is used.`), row.id);
          } else {
            if (x > 10) add('warn', L(`«${row.label}»: ${ru(x, 2)} % — очень большая стандартная неопределённость. Значения вводятся в процентах (k = 1).`, `"${row.label}": ${ru(x, 2)}% is a very large standard uncertainty. Values are entered in percent (k = 1).`), row.id);
            row.value = x;
            row.over = true;
            row.type = 'B';
            row.fromTypeA = false;
            if (spec.typeA && typeA) {
              row.how = [spec.how || '', L(`Своё значение заменяет и типовое, и повторяемость серии (тип А ${pct(typeA.pct, 3)} %).`, `Your value replaces both the typical value and the repeatability of the series (type A ${pct(typeA.pct, 3)}%).`)].filter(Boolean).join(' ');
              if (x < typeA.pct) add('warn', L(`«${row.label}»: своё значение ${pct(x)} % меньше повторяемости ваших показаний (${pct(typeA.pct, 3)} %) — оно должно её включать.`, `"${row.label}": your value ${pct(x)}% is smaller than the repeatability of your readings (${pct(typeA.pct, 3)}%); it should include it.`), row.id);
            }
          }
        }
      }
      const note = notes[key];
      if (row.over && note && typeof note === 'object') row.note = { ...note, st: String(note.st ?? ''), text: String(note.text ?? '') };
      if (row.over && !hasSource(note)) noSource.push(row.label);
      out.push(row);
      rows.push(row);
    }
    if (cert && tpl.stages && gr === tpl.groups[0]) {
      const row = {
        key: `${tpl.family}.lab_cert`,
        id: null,
        label: L(`${nName} из свидетельства о калибровке (U/k)`, `${nName} from the calibration certificate (U/k)`),
        how: L(`U = ${pct(cert.U)} % при k = ${ru(cert.k, cert.k % 1 ? 2 : 0)}, приведённая к k = 1.`, `U = ${pct(cert.U)}% at k = ${ru(cert.k, cert.k % 1 ? 2 : 0)}, converted to k = 1.`),
        ref: L('свидетельство о калибровке', 'calibration certificate'),
        def: NaN,
        value: cert.u,
        type: 'B',
        fromCert: true,
        certRow: true,
      };
      out.push(row);
      rows.push(row);
    }
    const sub = { title: gr.title, rows: out };
    if (gr.subtotal) {
      sub.subtotal = { def: quad(out.filter((r) => !r.certRow).map((r) => r.def)), value: quad(out.map((r) => r.value)) };
    }
    groups.push(sub);
  }

  // «обязательно помечать, откуда что берётся»: у каждого своего значения должен быть указан источник
  if (noSource.length) {
    add('warn', L(
      `Не указан источник своих значений: ${noSource.join('; ')}. Укажите в «как получено» у строки документ (свидетельство камеры, электрометра, термометра, протокол QA, измерения…) и способ расчёта.`,
      `No source given for your values: ${noSource.join('; ')}. In “how obtained” on the row, give the document (chamber, electrometer or thermometer certificate, QA record, measurements…) and how the value was calculated.`,
    ));
  }
  const ucPct = quad(rows.map((r) => r.value));
  const ucDefPct = quad(rows.filter((r) => !r.certRow).map((r) => r.def));
  const custom = !!cert || rows.some((r) => r.over);
  return {
    template: { id, family: tpl.family, situation: ctx.situation, stages: !!tpl.stages, ...info },
    groups,
    rows,
    cert,
    typeA,
    ucPct,
    ucDefPct,
    k: COVERAGE_K,
    UPct: COVERAGE_K * ucPct,
    custom,
    ki: o.ki && tpl.stages ? o.ki : null,
    setup: o.setup && tpl.stages ? o.setup : null,
    messages,
  };
}

function typeAText(typeA, def) {
  if (!typeA) return L('Повторяемость ваших показаний (тип А) появится, когда введено не меньше двух значений.', 'The repeatability of your readings (type A) appears once at least two values are entered.');
  const v = pct(typeA.pct, 3);
  const how = [
    typeA.m && typeA.m !== typeA.n ? L(`s по ${typeA.n} показаниям, результат — среднее ${typeA.m}`, `s from ${typeA.n} readings, the result is the mean of ${typeA.m}`) : '',
    typeA.fromRes ? L('ограничена разрешением прибора δ/√12', 'limited by the instrument resolution δ/√12') : '',
  ].filter(Boolean).join('; ');
  if (how) {
    return typeA.pct > def
      ? L(`Повторяемость ваших показаний (тип А): ${v} % (${how}) — больше типового значения, в расчёт идёт она.`, `Repeatability of your readings (type A): ${v}% (${how}) — larger than the typical value, so it is used.`)
      : L(`Повторяемость ваших показаний (тип А): ${v} % (${how}) — не больше типового значения, в расчёт идёт оно.`, `Repeatability of your readings (type A): ${v}% (${how}) — not larger than the typical value, so the latter is used.`);
  }
  return typeA.pct > def
    ? L(`Повторяемость ваших показаний (тип А): ${v} % по ${typeA.n} значениям — больше типового значения, в расчёт идёт она.`, `Repeatability of your readings (type A): ${v}% from ${typeA.n} values — larger than the typical value, so it is used.`)
    : L(`Повторяемость ваших показаний (тип А): ${v} % по ${typeA.n} значениям — не больше типового значения, в расчёт идёт оно.`, `Repeatability of your readings (type A): ${v}% from ${typeA.n} values — not larger than the typical value, so the latter is used.`);
}

/** Добавляет замечания бюджета к замечаниям расчёта (область 'unc', на итог дозы не влияют). */
export function mergeBudgetMessages(budget, add) {
  for (const m of budget.messages) add(m.level, m.scope, m.text, m.ref, m.field);
}
