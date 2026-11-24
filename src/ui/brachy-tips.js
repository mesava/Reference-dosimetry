// Брахитерапия: всплывающие подсказки к величинам и коэффициентам — что обозначает, как получается и откуда берётся
// (setupHoverPop: HTML в data-pop). Ссылки — те же источники, что в core/brachy-data.js.
import { L } from '../core/i18n.js';
import { esc } from './common.js';

const T492 = 'IAEA TRS-492 (2023)';
const dgmp = () => L('DGMP-Bericht 13 (1999, испр. изд. 2006)', 'DGMP Report 13 (1999, corr. 2006)');
const ptw = () => L('руководство PTW 9193 (D402.131.00/05, 2017)', 'PTW 9193 manual (D402.131.00/05, 2017)');
const UBR = 'Ubrich et al. 2014, Z. Med. Phys. 24 138–52';
const AZH = 'Azhari et al. 2012, J. Med. Phys. 37 183–92';
const HEBD = 'Perez-Calatayud et al. 2012, AAPM Report 229 (HEBD)';
const TG43 = 'Rivard et al. 2004, Med. Phys. 31 633–74 (TG-43U1)';

const pop = (title, body, src) => `<h4>${title}</h4>${body.map((p) => `<p>${p}</p>`).join('')}<p class="src">${src}</p>`;

/** Подсказки по ключу: поле формы (как data-f) или величина результата. */
const TIPS = {
  half: () => L(
    pop('Период полураспада T<sub>½</sub>', ['Нужен для поправки на распад от даты сертификата до измерения: k<sub>dec</sub> = 2<sup>Δt/T½</sup>.', 'Пусто — рекомендованное значение TRS-492, табл. 3: ¹⁹²Ir — 73,827 сут, ⁶⁰Co — 1925,21 сут (годы переводятся по 365,2422 сут). Своё значение — например, чтобы сверить с таблицей распада из сертификата.'], `${T492}, разд. 3.4, 7.3, ур. (8)–(9), табл. 3.`),
    pop('Half-life T<sub>½</sub>', ['Used for the decay correction from the certificate date to the measurement: k<sub>dec</sub> = 2<sup>Δt/T½</sup>.', 'Blank: the recommended value of TRS-492, Table 3: ¹⁹²Ir 73.827 d, ⁶⁰Co 1925.21 d (years converted with 365.2422 d). Your own value, e.g. to check against the decay table of the certificate.'], 'IAEA TRS-492 (2023), Sec. 3.4, 7.3, Eq. (8)–(9), Table 3.'),
  ),
  cert_value: () => L(
    pop('Сила источника в сертификате', ['ОМВК K̇<sub>δ,R</sub> — опорная мощность воздушной кермы: мощность воздушной кермы в воздухе на опорном расстоянии 1 м с поправкой на ослабление и рассеяние в воздухе. S<sub>K</sub> — сила воздушной кермы; 1 U = 1 мкГр·м²·ч⁻¹, численно S<sub>K</sub> в U = ОМВК в мкГр/ч на 1 м.', 'Если в сертификате только активность, нужна Γ<sub>δ</sub>; такое сравнение менее надёжно.'], `${T492}, разд. 3.1; дополнение I.`),
    pop('Source strength in the certificate', ['RAKR K̇<sub>δ,R</sub>, the reference air kerma rate: the air kerma rate in air at the reference distance of 1 m, corrected for air attenuation and scatter. S<sub>K</sub> is the air kerma strength; 1 U = 1 µGy·m²·h⁻¹, so S<sub>K</sub> in U numerically equals the RAKR in µGy/h at 1 m.', 'If the certificate gives only the activity, Γ<sub>δ</sub> is needed and the comparison is less reliable.'], 'IAEA TRS-492 (2023), Sec. 3.1; Annex I.'),
  ),
  cert_gamma: () => L(
    pop('Постоянная мощности воздушной кермы Γ<sub>δ</sub>', ['Мощность воздушной кермы на 1 м от источника активностью 1 ГБк, мкГр·м²·ч⁻¹·ГБк⁻¹; δ — нижний порог энергии фотонов. Зависит от модели источника (нуклид, конструкция, капсула) — берётся из сертификата производителя.', 'Связь с кажущейся активностью: A<sub>app</sub> = K̇<sub>R</sub>·d<sub>R</sub>²/Γ<sub>δ</sub>. Активность — производная величина: разные Γ дают расхождение до 10 %, поэтому сравнивать лучше ОМВК.'], `${T492}, дополнение I, ур. (36).`),
    pop('Air kerma rate constant Γ<sub>δ</sub>', ['The air kerma rate at 1 m from a 1 GBq source, µGy·m²·h⁻¹·GBq⁻¹; δ is the photon energy cut-off. It depends on the source model (nuclide, design, capsule) and is taken from the manufacturer certificate.', 'Apparent activity: A<sub>app</sub> = K̇<sub>R</sub>·d<sub>R</sub>²/Γ<sub>δ</sub>. The activity is a derived quantity: different Γ values differ by up to 10%, so compare the RAKR instead.'], 'IAEA TRS-492 (2023), Annex I, Eq. (36).'),
  ),
  cert_U: () => L(
    pop('Неопределённость сертификата', ['Расширенная неопределённость силы источника из сертификата производителя (обычно k = 2 или P = 95 %). Входит в оценку расхождения с измерением.'], `${T492}, разд. 8.6.2.`),
    pop('Certificate uncertainty', ['The expanded uncertainty of the source strength in the manufacturer certificate (usually k = 2 or P = 95%). It enters the assessment of the difference from the measurement.'], 'IAEA TRS-492 (2023), Sec. 8.6.2.'),
  ),
  w_N: () => L(
    pop('Калибровочный коэффициент колодезной камеры N', ['Переводит ток камеры в ОМВК: K̇ = N · I · Π k<sub>i</sub>. Берётся из сертификата камеры — из строки для своего аппарата, адаптера (держателя) и нуклида, при опорных T<sub>0</sub>, P<sub>0</sub> и напряжении сертификата. Коэффициент ¹⁹²Ir нельзя применять к ⁶⁰Co и наоборот.'], `${T492}, разд. 7.1, ур. (21), (27).`),
    pop('Well-type chamber calibration coefficient N', ['Converts the chamber current into the RAKR: K̇ = N · I · Π k<sub>i</sub>. From the chamber certificate, the row for your afterloader, adapter (holder) and nuclide, at the certificate reference T<sub>0</sub>, P<sub>0</sub> and voltage. A ¹⁹²Ir coefficient must not be used for ⁶⁰Co and vice versa.'], 'IAEA TRS-492 (2023), Sec. 7.1, Eq. (21), (27).'),
  ),
  w_NAA: () => L(
    pop('N<sub>AA</sub> — коэффициент для кажущейся активности', ['Некоторые сертификаты дают и коэффициент для кажущейся активности (Бк/А). Результат по нему — только справочно: активность — устаревшая производная величина.'], `${T492}, дополнение I.`),
    pop('N<sub>AA</sub>: coefficient for apparent activity', ['Some certificates also give a coefficient for apparent activity (Bq/A). The result is for reference only: activity is an outdated derived quantity.'], 'IAEA TRS-492 (2023), Annex I.'),
  ),
  kTP: () => L(
    pop('Поправка на плотность воздуха k<sub>TP</sub>', ['k<sub>TP</sub> = (273,15 + T)/(273,15 + T<sub>0</sub>) · P<sub>0</sub>/P. T и P — в момент измерения (камера открытая), T<sub>0</sub> и P<sub>0</sub> — опорные условия из сертификата камеры (обычно 20 °C и 101,325 кПа; в Северной Америке 22 °C).'], `${T492}, разд. 8.2.3.1, ур. (28).`),
    pop('Air density correction k<sub>TP</sub>', ['k<sub>TP</sub> = (273.15 + T)/(273.15 + T<sub>0</sub>) · P<sub>0</sub>/P. T and P at the measurement (vented chamber), T<sub>0</sub> and P<sub>0</sub> are the reference conditions from the chamber certificate (usually 20 °C and 101.325 kPa; 22 °C in North America).'], 'IAEA TRS-492 (2023), Sec. 8.2.3.1, Eq. (28).'),
  ),
  kLeak: () => L(
    pop('Поправка на утечку k<sub>leak</sub>', ['Ток утечки измеряют без источника. Если он меньше 0,1 % показания — не учитывается; больше — вычитается из показания (k<sub>leak</sub> = 1 − I<sub>утечки</sub>/I).'], `${T492}, разд. 8.2.3.4.`),
    pop('Leakage correction k<sub>leak</sub>', ['The leakage current is measured without the source. Below 0.1% of the reading it is ignored; above, it is subtracted (k<sub>leak</sub> = 1 − I<sub>leak</sub>/I).'], 'IAEA TRS-492 (2023), Sec. 8.2.3.4.'),
  ),
  kElec: () => L(
    pop('Калибровочный коэффициент электрометра k<sub>elec</sub>', ['Если электрометр калибровали отдельно от камеры — из его свидетельства, для используемого диапазона. Если камеру и электрометр калибровали вместе — 1: электрометр уже учтён в коэффициенте системы.'], `${T492}, разд. 8.2.3.5.`),
    pop('Electrometer calibration coefficient k<sub>elec</sub>', ['If the electrometer was calibrated separately from the chamber: from its certificate, for the range used. If the chamber and electrometer were calibrated together: 1, the electrometer is already in the system coefficient.'], 'IAEA TRS-492 (2023), Sec. 8.2.3.5.'),
  ),
  kPol: () => L(
    pop('Поправка на полярность k<sub>pol</sub>', ['k<sub>pol</sub> = (|M<sub>+</sub>| + |M<sub>−</sub>|)/(2|M|): показания при обеих полярностях напряжения, M — при рабочей. Нужна, если камеру калибровали при другой полярности или эффект заметен; обычно калибруют при одной полярности, и k<sub>pol</sub> = 1.'], `${T492}, разд. 8.2.3.6, ур. (32).`),
    pop('Polarity correction k<sub>pol</sub>', ['k<sub>pol</sub> = (|M<sub>+</sub>| + |M<sub>−</sub>|)/(2|M|): readings at both polarities, M at the routine one. Needed if the chamber was calibrated at another polarity or the effect is noticeable; usually k<sub>pol</sub> = 1.'], 'IAEA TRS-492 (2023), Sec. 8.2.3.6, Eq. (32).'),
  ),
  kS: () => L(
    pop('Поправка на рекомбинацию ионов k<sub>s</sub>', ['Метод двух напряжений: при V<sub>2</sub> = V<sub>1</sub>/2 k<sub>s</sub> = 3/(4 − M<sub>1</sub>/M<sub>2</sub>); в общем случае (n² − 1)/(n² − M<sub>1</sub>/M<sub>2</sub>), n = V<sub>1</sub>/V<sub>2</sub>. Для PTW TW/TN33004 1/I линейно зависит от 1/V (Schüller et al. 2015) — берётся линейный вариант (n − 1)/(n − M<sub>1</sub>/M<sub>2</sub>). Для HDR рекомбинация обычно меньше 0,1 %.'], `${T492}, разд. 8.2.3.7, ур. (33).`),
    pop('Ion recombination correction k<sub>s</sub>', ['Two-voltage method: for V<sub>2</sub> = V<sub>1</sub>/2, k<sub>s</sub> = 3/(4 − M<sub>1</sub>/M<sub>2</sub>); in general (n² − 1)/(n² − M<sub>1</sub>/M<sub>2</sub>), n = V<sub>1</sub>/V<sub>2</sub>. For the PTW TW/TN33004, 1/I is linear in 1/V (Schüller et al. 2015), so the linear form (n − 1)/(n − M<sub>1</sub>/M<sub>2</sub>) is used. For HDR recombination is usually below 0.1%.'], 'IAEA TRS-492 (2023), Sec. 8.2.3.7, Eq. (33).'),
  ),
  kSm: () => L(
    pop('Поправка на модель источника k<sub>sm,sm0</sub>', ['Отклик колодезной камеры зависит от конструкции источника. Если вы меряете источник другой модели (sm), чем тот, на котором калибровали камеру (sm0), нужна поправка. Табл. 8 TRS-492 — только для камеры Standard Imaging HDR 1000 Plus с держателем 70010 (Монте-Карло NPL, 0,4 % при k = 2). Нет данных — k<sub>sm,sm0</sub> = 1, к неопределённости добавляется 2 % (5 % между HDR и PDR).'], `${T492}, разд. 7.2, 8.3, табл. 8.`),
    pop('Source model correction k<sub>sm,sm0</sub>', ['The well-type chamber response depends on the source design. If you measure a different model (sm) from the calibration source (sm0), a correction is needed. TRS-492 Table 8 applies only to the Standard Imaging HDR 1000 Plus with holder 70010 (NPL Monte Carlo, 0.4% at k = 2). No data: k<sub>sm,sm0</sub> = 1 and 2% is added to the uncertainty (5% between HDR and PDR).'], 'IAEA TRS-492 (2023), Sec. 7.2, 8.3, Table 8.'),
  ),
  p_calib: () => L(
    pop('Тип калибровки камеры в фантоме', ['Свидетельство камеры в пучке ⁶⁰Co: N<sub>w</sub> — в поглощённой дозе в воде (N<sub>D,w</sub>), N<sub>a</sub> — в воздушной керме, N<sub>s</sub> — в экспозиционной дозе. От типа зависит набор множителей: для N<sub>w</sub> — (1 − g<sub>w</sub>)⁻¹ · t<sub>w,a</sub>⁻¹ · k<sub>zp</sub> · k<sub>r</sub> · k<sub>Q</sub>, для N<sub>a</sub> — k<sub>zp</sub> · k<sub>r</sub> · k<sub>Q</sub>, для N<sub>s</sub> — ещё (1 − g<sub>a</sub>)⁻¹ · W/e · k<sub>RC</sub>. Поглощённая доза в воде считается только при N<sub>w</sub>.'], `${dgmp()}, ур. (14)–(16); ${ptw()}.`),
    pop('Chamber calibration type in the phantom', ['Chamber certificate in a ⁶⁰Co beam: N<sub>w</sub> in absorbed dose to water (N<sub>D,w</sub>), N<sub>a</sub> in air kerma, N<sub>s</sub> in exposure. The factor set depends on it: N<sub>w</sub> — (1 − g<sub>w</sub>)⁻¹ · t<sub>w,a</sub>⁻¹ · k<sub>zp</sub> · k<sub>r</sub> · k<sub>Q</sub>; N<sub>a</sub> — k<sub>zp</sub> · k<sub>r</sub> · k<sub>Q</sub>; N<sub>s</sub> — also (1 − g<sub>a</sub>)⁻¹ · W/e · k<sub>RC</sub>. The absorbed dose to water is calculated for N<sub>w</sub> only.'], `DGMP Report 13 (1999, corr. 2006), Eq. (14)–(16); ${ptw()}.`),
  ),
  p_N: () => L(
    pop('Калибровочный коэффициент камеры в фантоме', ['Из свидетельства камеры о калибровке в пучке ⁶⁰Co (обычно N<sub>D,w</sub>, мГр/нКл) при опорных T<sub>0</sub>, P<sub>0</sub> свидетельства. Камера — любая цилиндрическая; для камер не из DGMP 13 нужен свой k<sub>zp</sub> или свой k<sub>tot</sub>.'], `${dgmp()}; ${ptw()}.`),
    pop('Calibration coefficient of the phantom chamber', ['From the chamber certificate for a ⁶⁰Co beam (usually N<sub>D,w</sub>, mGy/nC) at the certificate T<sub>0</sub>, P<sub>0</sub>. Any thimble chamber; chambers not in DGMP 13 need your own k<sub>zp</sub> or your own k<sub>tot</sub>.'], `DGMP Report 13; ${ptw()}.`),
  ),
  p_kQ: () => L(
    pop('Поправка на качество излучения k<sub>Q</sub>', ['Переход от калибровочного пучка ⁶⁰Co к спектру источника в фантоме. Для современных компактных камер в ¹⁹²Ir принимают 1 (руководство PTW, табл. 1); для ⁶⁰Co источник и калибровочный пучок одного нуклида — 1.'], `${ptw()}, табл. 1; ${UBR}.`),
    pop('Beam quality correction k<sub>Q</sub>', ['From the ⁶⁰Co calibration beam to the source spectrum in the phantom. For modern compact chambers in ¹⁹²Ir it is taken as 1 (PTW manual, Table 1); for ⁶⁰Co the source and the calibration beam are the same nuclide: 1.'], `${ptw()}, Table 1; ${UBR}.`),
  ),
  p_kzp: () => L(
    pop('Поправка k<sub>zp</sub> — фантом и точка измерения', ['Учитывает замену воды ПММА фантома, ослабление и рассеяние в нём и размер камеры на 8 см от источника. По DGMP 13: k<sub>zp</sub> = 1,187 ± 0,012 для камеры M23332, для другой камеры i — × k<sub>V,i</sub>/1,0037 (k<sub>V</sub> из табл. 2.1). Камеры PTW: 30013, 30010 → M30001 (k<sub>V</sub> 1,0072), 30015 → M23331, 30016 → M23332, 31010 → M233642; IBA FC65-G — приближённо как M30001. Только для ¹⁹²Ir. Для ⁶⁰Co — 1,276 по Azhari 2012. Своё значение — если известно для вашей камеры.'], `${dgmp()}, ур. (13), сноска 4, табл. 2.1; ${AZH}, табл. 2.`),
    pop('Correction k<sub>zp</sub>: phantom and measurement point', ['Accounts for PMMA in place of water, attenuation and scatter in the phantom and the chamber size at 8 cm from the source. Per DGMP 13: k<sub>zp</sub> = 1.187 ± 0.012 for the M23332 chamber; for another chamber i, × k<sub>V,i</sub>/1.0037 (k<sub>V</sub> from Table 2.1). PTW chambers: 30013, 30010 → M30001 (k<sub>V</sub> 1.0072), 30015 → M23331, 30016 → M23332, 31010 → M233642; IBA FC65-G approximately as M30001. ¹⁹²Ir only. For ⁶⁰Co, 1.276 per Azhari 2012. Your own value if known for your chamber.'], `DGMP Report 13, Eq. (13), footnote 4, Table 2.1; ${AZH}, Table 2.`),
  ),
  kr: () => L(
    pop('Поправка на расстояние k<sub>r</sub>', ['Пересчёт с расстояния измерения 8 см на опорное 1 м по закону обратных квадратов: k<sub>r</sub> = (8 см / 100 см)² = 0,0064.'], `${dgmp()}, ур. (12); ${ptw()}.`),
    pop('Distance correction k<sub>r</sub>', ['From the measurement distance of 8 cm to the reference 1 m by the inverse square law: k<sub>r</sub> = (8 cm / 100 cm)² = 0.0064.'], `DGMP Report 13, Eq. (12); ${ptw()}.`),
  ),
  p_ka: () => L(
    pop('Поправка на аппликатор k<sub>A</sub>', ['DGMP 13 определяет силу источника вместе с клиническим аппликатором, в котором он стоит в фантоме. Сертификат источника — без аппликатора: при сравнении с ним показание в стальном аппликаторе умножают на k<sub>A</sub> — ¹⁹²Ir 1,0165, ⁶⁰Co 1,0267 (1/0,984 и 1/0,974). Пластиковый аппликатор — k<sub>A</sub> ≈ 1.'], `${AZH}, табл. 2.`),
    pop('Applicator correction k<sub>A</sub>', ['DGMP 13 defines the source strength with the clinical applicator used in the phantom. The source certificate is without an applicator: for comparison with it, a reading in a steel applicator is multiplied by k<sub>A</sub>: ¹⁹²Ir 1.0165, ⁶⁰Co 1.0267 (1/0.984 and 1/0.974). Plastic applicator: k<sub>A</sub> ≈ 1.'], `${AZH}, Table 2.`),
  ),
  p_tau: () => L(
    pop('Время облучения в положении τ', ['Заряд за τ минут переводится в мощность: Ṁ = M · 60/τ (нКл/ч). В фантоме PTW 9193 обычно 1 мин в каждом из четырёх положений через 90°.'], `${ptw()}.`),
    pop('Irradiation time per position τ', ['The charge over τ minutes becomes a rate: Ṁ = M · 60/τ (nC/h). In the PTW 9193 phantom usually 1 min at each of the four positions 90° apart.'], ptw()),
  ),
  p_transit: () => L(
    pop('Заряд за перемещение источника', ['Заряд, набранный, пока источник едет в позицию и обратно (транзит). Измеряют отдельно (например, при очень коротком времени стояния) и вычитают из среднего в каждом положении.'], `${ptw()}.`),
    pop('Transit charge', ['The charge collected while the source travels to the position and back. Measured separately (e.g. with a very short dwell time) and subtracted from the mean at each position.'], ptw()),
  ),
  Mdot: () => L(
    pop('Ṁ — мощность показания', ['Среднее по положениям камеры, каждое — с k<sub>TP</sub> своего положения и без транзита, умноженное на k<sub>pol</sub>, k<sub>s</sub>, k<sub>elec</sub> и 60/τ. Четыре положения через 90° усредняют неточность установки аппликатора в центре фантома.'], `${ptw()}; ${dgmp()}.`),
    pop('Ṁ: reading rate', ['The mean over the chamber positions, each with its own k<sub>TP</sub> and with the transit removed, times k<sub>pol</sub>, k<sub>s</sub>, k<sub>elec</sub> and 60/τ. Four positions 90° apart average out the applicator not being exactly centred.'], `${ptw()}; DGMP Report 13.`),
  ),
  spread: () => L(
    pop('Разброс положений', ['(макс − мин)/среднее по четырём положениям. Больше 3 % — проверьте, что аппликатор стоит в центре фантома и камера вставлена до упора.'], `${ptw()}.`),
    pop('Spread of positions', ['(max − min)/mean over the four positions. Above 3%, check that the applicator is in the centre of the phantom and the chamber is fully inserted.'], ptw()),
  ),
  factor: () => L(
    pop('Множитель (k<sub>tot</sub>)', ['K̇ (мГр/ч на 1 м) = множитель · N · Ṁ · k<sub>A</sub>. Для DGMP 13 — произведение (1 − g<sub>w</sub>)⁻¹ · t<sub>w,a</sub>⁻¹ · k<sub>zp</sub> · k<sub>r</sub> · k<sub>Q</sub> (для N<sub>w</sub>); для Ubrich 2014 — общий множитель (k<sub>tot</sub>)K̇<sub>a,100</sub> = K̇/(M · N<sub>D,w</sub>) из табл. 5 (Монте-Карло или калибровка PTB) — посчитан для камер PTW 30015, 30016, 31010, для другой камеры приближённо; свой k<sub>tot</sub> — по сличению с колодезной камерой.'], `${dgmp()}, ур. (12)–(16); ${UBR}, ур. (5), табл. 5; ${AZH}, табл. 2.`),
    pop('Factor (k<sub>tot</sub>)', ['K̇ (mGy/h at 1 m) = factor · N · Ṁ · k<sub>A</sub>. For DGMP 13, the product (1 − g<sub>w</sub>)⁻¹ · t<sub>w,a</sub>⁻¹ · k<sub>zp</sub> · k<sub>r</sub> · k<sub>Q</sub> (for N<sub>w</sub>); for Ubrich 2014 the global factor (k<sub>tot</sub>)K̇<sub>a,100</sub> = K̇/(M · N<sub>D,w</sub>) from Table 5 (Monte Carlo or PTB calibration), computed for PTW 30015, 30016, 31010 and approximate for another chamber; own k<sub>tot</sub> from comparison with the well-type chamber.'], `DGMP Report 13, Eq. (12)–(16); ${UBR}, Eq. (5), Table 5; ${AZH}, Table 2.`),
  ),
  p_ktot: () => L(
    pop('Свой общий множитель k<sub>tot</sub>', ['k<sub>tot</sub> = K̇<sub>колодезная</sub>/(N · Ṁ): тот же источник измерен колодезной камерой (ОМВК пересчитана на время измерения в фантоме по распаду) и в фантоме. В k<sub>tot</sub> входят все поправки фантома, камеры и аппликатора. Это основной путь для ⁶⁰Co, где в DGMP 13 данных нет, и для камер, которых нет в DGMP 13.'], `${UBR}, ур. (5); ${T492}, разд. 7.7.`),
    pop('Own global factor k<sub>tot</sub>', ['k<sub>tot</sub> = K̇<sub>well</sub>/(N · Ṁ): the same source measured with the well-type chamber (RAKR decay-corrected to the phantom measurement time) and in the phantom. k<sub>tot</sub> includes all phantom, chamber and applicator corrections. The main route for ⁶⁰Co, where DGMP 13 has no data, and for chambers not in DGMP 13.'], `${UBR}, Eq. (5); IAEA TRS-492 (2023), Sec. 7.7.`),
  ),
  RAKR: () => L(
    pop('ОМВК, мГр/ч на 1 м', ['Опорная мощность воздушной кермы источника на время измерения по этому варианту (с k<sub>A</sub>). Численно мГр/ч на 1 м × 1000 = S<sub>K</sub> в U.'], `${T492}, разд. 3.1.`),
    pop('RAKR, mGy/h at 1 m', ['The reference air kerma rate at the measurement time by this variant (with k<sub>A</sub>). mGy/h at 1 m × 1000 = S<sub>K</sub> in U.'], 'IAEA TRS-492 (2023), Sec. 3.1.'),
  ),
  dev: () => L(
    pop('Отклонение от сертификата', ['(измерено − сертификат)/сертификат; сертификат пересчитан на время измерения по распаду. HDR/PDR: до 3 % — норма, 3–5 % — выяснить причину, больше 5 % — источник не применять до выяснения.'], `${T492}, разд. 8.6.2.`),
    pop('Deviation from the certificate', ['(measured − certificate)/certificate; the certificate value is decay-corrected to the measurement time. HDR/PDR: up to 3% is fine, 3–5% investigate, above 5% do not use the source until resolved.'], 'IAEA TRS-492 (2023), Sec. 8.6.2.'),
  ),
  Dw: () => L(
    pop('Ḋ<sub>w</sub> в точке измерения', ['Ḋ<sub>w</sub> = N<sub>D,w</sub> · Ṁ — мощность поглощённой дозы в воде, которую показывает камера в точке измерения на 8 см от источника, в ПММА фантома (для ¹⁹²Ir руководство PTW даёт то же как 0,2435 · K̇). Это не доза на 8 см в воде: фантом рассеивает иначе.'], `${ptw()}, ур. (15).`),
    pop('Ḋ<sub>w</sub> at the measurement point', ['Ḋ<sub>w</sub> = N<sub>D,w</sub> · Ṁ: the absorbed dose rate to water indicated by the chamber at the measurement point 8 cm from the source, in the PMMA phantom (for ¹⁹²Ir the PTW manual gives the same as 0.2435 · K̇). It is not the dose at 8 cm in water: the phantom scatters differently.'], `${ptw()}, Eq. (15).`),
  ),
  Dw1: () => L(
    pop('Ḋ<sub>w,1</sub> — референсная мощность дозы в воде на 1 см', ['Мощность поглощённой дозы в воде на 1 см от источника на поперечной оси. Через фантом: Ḋ<sub>w,1</sub> = (k<sub>tot</sub>)Ḋ<sub>w,1</sub> · N<sub>D,w</sub> · Ṁ, множитель — Монте-Карло Ubrich 2014, табл. 7 (зависит от модели источника; камеры PTW 30015, 30016, 31010). Через силу источника: Ḋ<sub>w,1</sub> = Λ · S<sub>K</sub>, Λ — постоянная мощности дозы модели источника (консенсус HEBD).'], `${UBR}, ур. (6), табл. 7; ${T492}, разд. 3.2; ${TG43}, ур. (1).`),
    pop('Ḋ<sub>w,1</sub>: reference dose rate to water at 1 cm', ['The absorbed dose rate to water at 1 cm from the source on the transverse axis. Via the phantom: Ḋ<sub>w,1</sub> = (k<sub>tot</sub>)Ḋ<sub>w,1</sub> · N<sub>D,w</sub> · Ṁ, the factor from the Ubrich 2014 Monte Carlo, Table 7 (depends on the source model; PTW 30015, 30016, 31010 chambers). Via the source strength: Ḋ<sub>w,1</sub> = Λ · S<sub>K</sub>, Λ being the dose rate constant of the source model (HEBD consensus).'], `${UBR}, Eq. (6), Table 7; IAEA TRS-492 (2023), Sec. 3.2; ${TG43}, Eq. (1).`),
  ),
  Dw8: () => L(
    pop('Ḋ<sub>w</sub> на 8 см в воде', ['По формализму TG-43 на поперечной оси (F = 1): Ḋ(8) = Ḋ<sub>w,1</sub> · G<sub>L</sub>(8)/G<sub>L</sub>(1) · g<sub>L</sub>(8). G<sub>L</sub>(r) = β/(L · r), β = 2 · arctg(L/2r) — геометрия линейного источника с активной длиной L; g<sub>L</sub>(8) — радиальная функция дозы (рассеяние и ослабление в воде). L и g<sub>L</sub> — консенсусные данные HEBD для модели источника.'], `${TG43}, ур. (1), (4); ${HEBD}.`),
    pop('Ḋ<sub>w</sub> at 8 cm in water', ['By the TG-43 formalism on the transverse axis (F = 1): Ḋ(8) = Ḋ<sub>w,1</sub> · G<sub>L</sub>(8)/G<sub>L</sub>(1) · g<sub>L</sub>(8). G<sub>L</sub>(r) = β/(L · r), β = 2 · arctan(L/2r): the line source geometry with active length L; g<sub>L</sub>(8) is the radial dose function (scatter and attenuation in water). L and g<sub>L</sub> are the HEBD consensus data for the source model.'], `${TG43}, Eq. (1), (4); ${HEBD}.`),
  ),
  p_src: () => L(
    pop('Модель источника для дозы в воде', ['Нужна для Ḋ<sub>w,1</sub> и Ḋ<sub>w</sub> на 8 см: Λ, активная длина L и g<sub>L</sub>(8 см) — консенсусные данные HEBD (AAPM/ESTRO) для 10 моделей ¹⁹²Ir HDR и двух ⁶⁰Co; (k<sub>tot</sub>)Ḋ<sub>w,1</sub> Ubrich — для части из них. Модели нет в списке (например, отечественный источник) — «другая», и Λ, L, g<sub>L</sub>(8) вводятся из паспорта или публикации.'], `${HEBD}, табл. IV, V, LII, LIII; ${UBR}, табл. 7.`),
    pop('Source model for the dose to water', ['Needed for Ḋ<sub>w,1</sub> and Ḋ<sub>w</sub> at 8 cm: Λ, active length L and g<sub>L</sub>(8 cm) are the HEBD (AAPM/ESTRO) consensus data for 10 ¹⁹²Ir HDR models and two ⁶⁰Co; the Ubrich (k<sub>tot</sub>)Ḋ<sub>w,1</sub> exists for some of them. A model not in the list: choose “other” and enter Λ, L, g<sub>L</sub>(8) from the source documentation or a publication.'], `${HEBD}, Tables IV, V, LII, LIII; ${UBR}, Table 7.`),
  ),
  p_lambda: () => L(
    pop('Постоянная мощности дозы Λ', ['Λ = Ḋ<sub>w,1</sub>/S<sub>K</sub>, сГр·ч⁻¹·U⁻¹ — мощность дозы в воде на 1 см на единицу силы источника. Зависит от модели источника; для ¹⁹²Ir HDR около 1,10–1,12, для ⁶⁰Co около 1,09.'], `${T492}, разд. 3.2; ${TG43}; ${HEBD}.`),
    pop('Dose rate constant Λ', ['Λ = Ḋ<sub>w,1</sub>/S<sub>K</sub>, cGy·h⁻¹·U⁻¹: the dose rate to water at 1 cm per unit source strength. Depends on the source model; about 1.10–1.12 for ¹⁹²Ir HDR, about 1.09 for ⁶⁰Co.'], `IAEA TRS-492 (2023), Sec. 3.2; ${TG43}; ${HEBD}.`),
  ),
  p_L: () => L(
    pop('Активная длина L', ['Длина активной части источника для геометрического фактора линейного источника G<sub>L</sub>. Пусто или 0 — точечный источник (1/r²); при L = 3,5 мм это меняет Ḋ<sub>w</sub> на 8 см примерно на 1 %.'], `${TG43}, ур. (4).`),
    pop('Active length L', ['The length of the active part of the source for the line source geometry factor G<sub>L</sub>. Blank or 0: point source (1/r²); for L = 3.5 mm this changes Ḋ<sub>w</sub> at 8 cm by about 1%.'], `${TG43}, Eq. (4).`),
  ),
  p_gL8: () => L(
    pop('Радиальная функция дозы g<sub>L</sub>(8 см)', ['Учитывает ослабление и рассеяние в воде на 8 см относительно 1 см (g<sub>L</sub>(1) = 1). Для ¹⁹²Ir HDR около 0,97, для ⁶⁰Co — 0,884.'], `${TG43}, ур. (1); ${HEBD}.`),
    pop('Radial dose function g<sub>L</sub>(8 cm)', ['Accounts for attenuation and scatter in water at 8 cm relative to 1 cm (g<sub>L</sub>(1) = 1). About 0.97 for ¹⁹²Ir HDR, 0.884 for ⁶⁰Co.'], `${TG43}, Eq. (1); ${HEBD}.`),
  ),
  s_x: () => L(
    pop('Положение источника', ['Положение, на которое аппарат выводит источник в колодец камеры, в мм — по той же системе отсчёта, что на пульте (длина ампулопровода, глубина катетера). Шаг — не больше 2,5 мм, диапазон — не меньше 10 мм в обе стороны от ожидаемого максимума.'], `${T492}, разд. 8.2.1.`),
    pop('Source position', ['The position the afterloader drives the source to in the chamber well, in mm, in the same reference system as on the console (transfer tube length, catheter depth). Step at most 2.5 mm, range at least 10 mm on both sides of the expected maximum.'], 'IAEA TRS-492 (2023), Sec. 8.2.1.'),
  ),
  xPeak: () => L(
    pop('Максимум отклика (опорная точка)', ['Положение источника с наибольшим откликом камеры. Ищется как вершина параболы, проведённой МНК через точки с откликом не ниже 99 % от наибольшего (при плоской вершине — по более широкому участку, до 90 %); если выпуклая парабола не получилась — наибольшее показание. В этом положении измеряют силу источника: отклик там меньше всего зависит от неточности положения.'], `${T492}, разд. 8.2.1, рис. 6.`),
    pop('Response maximum (reference point)', ['The source position with the largest chamber response. Found as the vertex of a least-squares parabola through the points with a response of at least 99% of the largest (for a flat top, over a wider range, down to 90%); if no convex parabola fits, the largest reading. The source strength is measured there: the response is least sensitive to position errors.'], 'IAEA TRS-492 (2023), Sec. 8.2.1, Fig. 6.'),
  ),
  plateau: () => L(
    pop('Плато', ['Отрезок положений, где отклик не ниже 99,5 % (или 99 %) от максимума — по линейной интерполяции между измеренными точками. Чем шире плато, тем меньше показание зависит от смещения источника.'], `${T492}, разд. 8.2.1.`),
    pop('Plateau', ['The range of positions where the response is at least 99.5% (or 99%) of the maximum, by linear interpolation between the measured points. The wider the plateau, the less the reading depends on a source shift.'], 'IAEA TRS-492 (2023), Sec. 8.2.1.'),
  ),
  s_step: () => L(
    pop('Шаг положений', ['Расстояние между соседними положениями источника. TRS-492: не больше 2,5 мм, чтобы кривая достаточно точно описывала вершину. Кнопка «+» добавляет строку с положением «последнее + шаг».'], `${T492}, разд. 8.2.1.`),
    pop('Position step', ['The distance between neighbouring source positions. TRS-492: at most 2.5 mm, so that the curve describes the top well enough. The “+” button adds a row with the position “last + step”.'], 'IAEA TRS-492 (2023), Sec. 8.2.1.'),
  ),
  s_cert_pos: () => L(
    pop('Опорная точка по сертификату камеры', ['Положение источника, в котором камеру калибровали (точка калибровки), — из сертификата. Сдвиг измеренного максимума больше 1 мм обычно значит, что система отсчёта другая: другой ампулопровод, глубина катетера или подстройка привода источника.'], `${T492}, разд. 8.2.1.`),
    pop('Reference point in the chamber certificate', ['The source position at which the chamber was calibrated (calibration point), from the certificate. A shift of the measured maximum above 1 mm usually means a different reference: another transfer tube, catheter depth or a source drive adjustment.'], 'IAEA TRS-492 (2023), Sec. 8.2.1.'),
  ),
  w_pos: () => L(
    pop('Положение источника при измерении', ['Положение, в котором мерили силу источника. Лист «Максимум отклика» показывает отклик в нём: если он меньше 99,9 % от максимума, показание занижено на эту разницу.'], `${T492}, разд. 8.2.1.`),
    pop('Source position at the measurement', ['The position where the source strength was measured. The Sweet spot sheet shows the response there: if it is below 99.9% of the maximum, the reading is low by the difference.'], 'IAEA TRS-492 (2023), Sec. 8.2.1.'),
  ),
  frac: () => L(
    pop('Доля от отсчёта', ['K̇(t)/K̇(t<sub>0</sub>) = 2<sup>−Δt/T½</sup> = 1/k<sub>dec</sub>. Время облучения для той же дозы растёт обратно этой доле.'], `${T492}, ур. (8)–(9).`),
    pop('Fraction of the base', ['K̇(t)/K̇(t<sub>0</sub>) = 2<sup>−Δt/T½</sup> = 1/k<sub>dec</sub>. The irradiation time for the same dose grows inversely to this fraction.'], 'IAEA TRS-492 (2023), Eq. (8)–(9).'),
  ),
  d_target: () => L(
    pop('Порог замены источника', ['Сила источника (или активность), при которой источник меняют. Дата: t = t<sub>0</sub> + T<sub>½</sub> · log₂(K̇<sub>0</sub>/K̇<sub>порог</sub>).'], `${T492}, ур. (8).`),
    pop('Source replacement threshold', ['The source strength (or activity) at which the source is replaced. Date: t = t<sub>0</sub> + T<sub>½</sub> · log₂(K̇<sub>0</sub>/K̇<sub>threshold</sub>).'], 'IAEA TRS-492 (2023), Eq. (8).'),
  ),
  d_basis: () => L(
    pop('Отсчёт таблицы распада', ['От сертификата — сила источника по сертификату на его дату. От измерения — результат листа «Колодезная камера» или «Фантом PTW 9193» на время измерения: так получают значения для системы планирования по своему измерению.'], `${T492}, разд. 7.3, 8.6.`),
    pop('Decay table base', ['From the certificate: the certificate source strength at its date. From a measurement: the result of the Well-type chamber or PTW 9193 phantom sheet at the measurement time; this gives values for the treatment planning system from your own measurement.'], 'IAEA TRS-492 (2023), Sec. 7.3, 8.6.'),
  ),
  // сличение камер
  x_ref_N: () => L(
    pop('Калибровочный коэффициент эталонной камеры N<sub>ref</sub>', ['Из сертификата лаборатории (прослеживаемость к национальному эталону) — для того же нуклида и того же держателя источника, с которыми проводится сличение. Эталонная камера при сличении стоит в держателе, в котором её калибровали.'], `${T492}, разд. 7.7, ур. (18)–(20).`),
    pop('Reference chamber calibration coefficient N<sub>ref</sub>', ['From the laboratory certificate (traceable to a national standard), for the same nuclide and source holder used in the cross-calibration. The reference chamber is used in the holder it was calibrated with.'], 'IAEA TRS-492 (2023), Sec. 7.7, Eq. (18)–(20).'),
  ),
  x_ksm: () => L(
    pop('Поправка на модель источника k<sub>sm,sm0</sub> при сличении', ['Если эталонную камеру калибровали с моделью источника sm0, а сличают с другой моделью sm того же нуклида, N<sub>ref</sub> умножают на k<sub>sm,sm0</sub>. Тот же источник, что при калибровке, — 1 (пустое поле). Данные — TRS-492, табл. 8 (лист «Колодезная камера»).'], `${T492}, разд. 7.7, ур. (18)–(20); разд. 8.3, табл. 8.`),
    pop('Source model correction k<sub>sm,sm0</sub> in a cross-calibration', ['If the reference chamber was calibrated with source model sm0 and the cross-calibration uses another model sm of the same nuclide, N<sub>ref</sub> is multiplied by k<sub>sm,sm0</sub>. The same model as in the calibration: 1 (blank). Data: TRS-492, Table 8 (Well-type chamber sheet).'], 'IAEA TRS-492 (2023), Sec. 7.7, Eq. (18)–(20); Sec. 8.3, Table 8.'),
  ),
  x_T0: () => L(
    pop('Условия приведения T<sub>0</sub>, P<sub>0</sub>', ['Показания обеих камер приводятся к одним T<sub>0</sub>, P<sub>0</sub> (k<sub>TP</sub>, ур. 28) — к условиям сертификата эталонной камеры. Новый коэффициент рабочей камеры относится к этим же условиям: их переносят в её сертификат вместе с N.'], `${T492}, разд. 7.7, 8.2.3.1, ур. (28).`),
    pop('Reference conditions T<sub>0</sub>, P<sub>0</sub>', ['Both chamber readings are corrected to the same T<sub>0</sub>, P<sub>0</sub> (k<sub>TP</sub>, Eq. 28), those of the reference chamber certificate. The new field chamber coefficient refers to the same conditions; they go with N into its record.'], 'IAEA TRS-492 (2023), Sec. 7.7, 8.2.3.1, Eq. (28).'),
  ),
  x_N: () => L(
    pop('Калибровочный коэффициент рабочей камеры N<sub>field</sub>', ['N<sub>field</sub> = M<sub>ref</sub>(t<sub>ref</sub>)/M<sub>field</sub>(t<sub>ref</sub>) · N<sub>ref</sub> · k<sub>sm,sm0</sub>. Показания — средние, с поправками на утечку и k<sub>TP</sub>; эталонная — с k<sub>elec</sub>; рабочая — пересчитанная по распаду на время измерения эталонной (k<sub>dec</sub>). Коэффициент годен только для этого нуклида и держателя; пересчёт ¹⁹²Ir ↔ ⁶⁰Co не допускается.'], `${T492}, разд. 7.7, ур. (18)–(20).`),
    pop('Field chamber calibration coefficient N<sub>field</sub>', ['N<sub>field</sub> = M<sub>ref</sub>(t<sub>ref</sub>)/M<sub>field</sub>(t<sub>ref</sub>) · N<sub>ref</sub> · k<sub>sm,sm0</sub>. Readings are means corrected for leakage and k<sub>TP</sub>; the reference one with k<sub>elec</sub>; the field one decay-corrected to the reference measurement time (k<sub>dec</sub>). Valid only for this nuclide and holder; ¹⁹²Ir ↔ ⁶⁰Co conversion is not permitted.'], 'IAEA TRS-492 (2023), Sec. 7.7, Eq. (18)–(20).'),
  ),
  x_kdec: () => L(
    pop('Распад между измерениями k<sub>dec</sub>', ['Если рабочую камеру мерили позже эталонной, её показание пересчитывается на время измерения эталонной: k<sub>dec</sub> = 2<sup>Δt/T½</sup>. Для ¹⁹²Ir час — около 0,04 %.'], `${T492}, разд. 7.7; ур. (8)–(9).`),
    pop('Decay between the measurements k<sub>dec</sub>', ['If the field chamber was measured after the reference one, its reading is decay-corrected to the reference measurement time: k<sub>dec</sub> = 2<sup>Δt/T½</sup>. For ¹⁹²Ir one hour is about 0.04%.'], 'IAEA TRS-492 (2023), Sec. 7.7; Eq. (8)–(9).'),
  ),
  x_fld_prev: () => L(
    pop('Прежний коэффициент рабочей камеры', ['Для сравнения: новый N<sub>field</sub> против прежнего. Изменение больше 0,5 % — повод проверить условия сличения и стабильность рабочей камеры. Единица — как у эталонной камеры.'], `${T492}, разд. 7.7, 8.5.`),
    pop('Previous field chamber coefficient', ['For comparison: the new N<sub>field</sub> against the previous one. A change above 0.5% calls for checking the cross-calibration conditions and the field chamber stability. Unit as for the reference chamber.'], 'IAEA TRS-492 (2023), Sec. 7.7, 8.5.'),
  ),
  // стабильность
  st_method: () => L(
    pop('Метод проверки стабильности', ['Не реже четырёх раз в год, до и после каждой замены источника. <b>Контрольный источник</b> (рекомендуется; ¹³⁷Cs для ¹⁹²Ir и ⁶⁰Co) — показание с поправками на T, P и распад контрольного источника против исходного, ±0,5 %. <b>Внешний пучок</b> (ускоритель 6 МВ или ⁶⁰Co, камера на полу при большом РИП) — без распада, ±0,5 %. <b>Источник HDR</b> — только если нет второй камеры и контрольного источника: тот же источник до его замены, с распадом; ¹⁹²Ir — несколько месяцев, ⁶⁰Co — несколько лет. <b>Вторая камера</b> — отношение показаний двух независимых систем с одним источником, ±0,1 % от текущего среднего.'], `${T492}, разд. 8.5, 8.5.1–8.5.4.`),
    pop('Stability check method', ['At least four times a year and before and after each source exchange. <b>Check source</b> (recommended; ¹³⁷Cs for ¹⁹²Ir and ⁶⁰Co): reading corrected for T, P and the check source decay against the baseline, ±0.5%. <b>External beam</b> (6 MV linac or ⁶⁰Co unit, chamber on the floor at an extended SSD): no decay, ±0.5%. <b>HDR source</b>: only without a redundant chamber and check source; the same source until its exchange, decay-corrected; ¹⁹²Ir for a few months, ⁶⁰Co for a few years. <b>Redundant chamber</b>: ratio of two independent systems with one source, ±0.1% of the running mean.'], 'IAEA TRS-492 (2023), Sec. 8.5, 8.5.1–8.5.4.'),
  ),
  st_base: () => L(
    pop('Исходное значение', ['Показание, приведённое к T<sub>0</sub>, P<sub>0</sub>, при вводе камеры в работу и после каждой калибровки; с ним сравнивают проверки. Для второй камеры — текущее среднее отношения показаний. Можно записать текущую проверку как исходное кнопкой под результатом.'], `${T492}, разд. 8.5.`),
    pop('Baseline', ['The reading corrected to T<sub>0</sub>, P<sub>0</sub> at the chamber commissioning and after each recalibration; checks are compared with it. For a redundant chamber: the running mean of the reading ratio. The current check can be recorded as the baseline with the button below the result.'], 'IAEA TRS-492 (2023), Sec. 8.5.'),
  ),
  st_check_nuclide: () => L(
    pop('Нуклид контрольного источника', ['Для поправки на распад контрольного источника от даты исходного значения. Для ¹⁹²Ir, ¹³⁷Cs и ⁶⁰Co оптимален ¹³⁷Cs (T<sub>½</sub> 30,05 года — за год около 2,3 %); для низкоэнергетических источников — ²⁴¹Am (его T<sub>½</sub> в табл. 3 нет — введите свой). T<sub>½</sub> — по TRS-492, табл. 3.'], `${T492}, разд. 8.5.2, табл. 3.`),
    pop('Check source nuclide', ['For the decay correction of the check source from the baseline date. For ¹⁹²Ir, ¹³⁷Cs and ⁶⁰Co, ¹³⁷Cs is optimal (T<sub>½</sub> 30.05 y, about 2.3% per year); for low-energy sources ²⁴¹Am (not in Table 3: enter its T<sub>½</sub>). T<sub>½</sub> per TRS-492, Table 3.'], 'IAEA TRS-492 (2023), Sec. 8.5.2, Table 3.'),
  ),
  st_dev: () => L(
    pop('Отклонение от исходного', ['(M − M<sub>исх</sub>)/M<sub>исх</sub>, где M — среднее показание с k<sub>TP</sub> и поправкой на распад к дате исходного значения. Допуск ±0,5 %; для второй камеры — ±0,1 % от текущего среднего отношения. Больше — выяснить причину, возможно, повторно калибровать камеру.'], `${T492}, разд. 8.5, 8.5.1.`),
    pop('Deviation from the baseline', ['(M − M<sub>base</sub>)/M<sub>base</sub>, where M is the mean reading with k<sub>TP</sub> and the decay correction to the baseline date. Tolerance ±0.5%; for a redundant chamber ±0.1% of the running mean ratio. Beyond that, investigate; recalibration is an option.'], 'IAEA TRS-492 (2023), Sec. 8.5, 8.5.1.'),
  ),
  u_scen: () => L(
    pop('Типовые значения бюджета', ['Примеры TRS-492, табл. 10 (HDR ¹⁹²Ir): <b>сценарий 1</b> — эталонный дозиметр, условия контролируются (положение источника, плотность воздуха), та же модель источника, что при калибровке, — U ≈ 1,7 %; <b>сценарий 2</b> — условия не контролируются, часть поправок не вводится, модели источника нет в табл. 8 (+2 %) — U ≈ 5,7 %. TRS-492: оценку надо делать по своей процедуре и оборудованию — свои значения вводятся в «Своё».'], `${T492}, разд. 9, табл. 10.`),
    pop('Example budget values', ['Examples of TRS-492 Table 10 (HDR ¹⁹²Ir): <b>scenario 1</b>, a reference-class dosimeter, controlled conditions (source position, air density), the same source model as at calibration: U ≈ 1.7%; <b>scenario 2</b>, uncontrolled conditions, some corrections not applied, the source model not in Table 8 (+2%): U ≈ 5.7%. TRS-492: the estimate must follow your own procedure and equipment; enter your values under “Own”.'], 'IAEA TRS-492 (2023), Sec. 9, Table 10.'),
  ),
  u_c: () => L(
    pop('Неопределённость ОМВК', ['u<sub>c</sub> — суммарная стандартная неопределённость: корень из суммы квадратов строк бюджета (составляющие считаются некоррелированными). U = k · u<sub>c</sub> при k = 2 (около 95 %). Для поглощённой дозы в воде по TG-43 добавляется неопределённость Λ: по TRS-492 при u(Λ) = 0,5 % и сценарии 1 U ≈ 1,9 %.'], `${T492}, разд. 9, табл. 10; прил. VI.`),
    pop('RAKR uncertainty', ['u<sub>c</sub> is the combined standard uncertainty: root sum of squares of the budget rows (components assumed uncorrelated). U = k · u<sub>c</sub> with k = 2 (about 95%). For the absorbed dose to water per TG-43, the Λ uncertainty is added: per TRS-492, with u(Λ) = 0.5% and scenario 1, U ≈ 1.9%.'], 'IAEA TRS-492 (2023), Sec. 9, Table 10; App. VI.'),
  ),
  repeat: () => L(
    pop('Повторяемость', ['Относительное стандартное отклонение показаний серии от их среднего. Исходные данные повторяемости набирают большим числом измерений при вводе в работу; отклонение за установленные пределы — исследовать. Здесь предупреждение — при разбросе больше 0,5 %.'], `${T492}, разд. 8.4.`),
    pop('Repeatability', ['Relative standard deviation of the series readings from their mean. Baseline repeatability data are collected with many measurements at commissioning; a value outside the set limits is investigated. Here a warning appears for a spread above 0.5%.'], 'IAEA TRS-492 (2023), Sec. 8.4.'),
  ),
};
// одинаковые величины под разными ключами полей
Object.assign(TIPS, {
  w_T0: TIPS.kTP, p_T0: TIPS.kTP, w_kelec: TIPS.kElec, p_kelec: TIPS.kElec, w_leak: TIPS.kLeak,
  w_pol_plus: TIPS.kPol, w_ks_m1: TIPS.kS, w_ksm_mode: TIPS.kSm, w_ksm: TIPS.kSm, p_ka_value: TIPS.p_ka, kA: TIPS.p_ka,
  kzp: TIPS.p_kzp, p_wellK: TIPS.p_ktot, w_P0: TIPS.kTP, p_P0: TIPS.kTP,
  x_P0: TIPS.x_T0, x_ref_kelec: TIPS.kElec, x_ref_leak: TIPS.kLeak, x_fld_leak: TIPS.kLeak, st_half: TIPS.st_check_nuclide, p_NU: TIPS.u_c, w_NU: TIPS.u_c, st_T0: TIPS.kTP, st_P0: TIPS.kTP,
});

/** Атрибуты подсказки для элемента (пусто, если подсказки нет); focus — сделать элемент фокусируемым с клавиатуры. */
export function tipAttr(key, { focus = false } = {}) {
  const f = TIPS[key];
  return f ? ` data-pop="${esc(f())}"${focus ? ' tabindex="0"' : ''}` : '';
}

export const hasTip = (key) => Object.hasOwn(TIPS, key);
