// English help popups for the quantities: same keys and HTML structure as terms.js.
// If a key is missing, the Russian help text is shown.

export const TERMS_EN = {
  kTP: {
    title: 'k<sub>TP</sub> (P<sub>TP</sub>) — temperature and pressure correction',
    html: `
<p>All recommended chambers are open to the atmosphere, so the mass of air in the cavity depends on temperature and pressure. The calibration coefficient N<sub>D,w</sub> refers to the standard conditions stated in the certificate (T₀, P₀), and the reading is corrected to them:</p>
<p class="formula">k<sub>TP</sub> = (273.15 + T)/(273.15 + T₀) · P₀/P</p>
<ul>
<li><b>T</b> — the temperature of the water near the chamber, not of the room air: because of evaporation, the water in the phantom is usually cooler than the room. Wait for thermal equilibrium before measuring, typically 5–10 minutes.</li>
<li><b>P</b> — the pressure from a calibrated barometer in the room, not corrected to sea level. Data from weather stations and airports are not recommended.</li>
<li>An error of 0.3 °C gives 0.1% in dose; an error of 0.1 kPa also gives 0.1%.</li>
<li>At a relative humidity of 20–80%, no humidity correction is needed.</li>
</ul>
<p class="src">TRS-398 Rev.1, Sec. 4.4.3.1, Eq. (10); TG-51, Sec. VII.C, Eq. (10); TG-51 addendum, Sec. 5.A.5; Report 374, Sec. 4.6.</p>`,
  },

  kelec: {
    title: 'k<sub>elec</sub> (P<sub>elec</sub>) — electrometer calibration coefficient',
    html: `
<p>If the chamber and electrometer were calibrated separately, the laboratory issues an electrometer calibration coefficient that converts its reading into true charge. It is dimensionless and close to 1 if the electrometer reads in units of charge.</p>
<p>If the chamber and electrometer were calibrated together, N<sub>D,w</sub> already applies to the pair, and k<sub>elec</sub> = 1.</p>
<p class="src">TRS-398 Rev.1, Sec. 4.4.3.2; TG-51, Sec. VII.B.</p>`,
  },

  kpol: {
    title: 'k<sub>pol</sub> (P<sub>pol</sub>) — polarity correction',
    html: `
<p>The chamber reading depends slightly on the sign of the voltage on the collecting electrode. The correction converts the reading at the polarity normally used to the mean over both polarities:</p>
<p class="formula">k<sub>pol</sub> = (|M₊| + |M₋|)/(2M)</p>
<p>M is the reading at normal polarity, the same as used for calibration.</p>
<h4>Acceptable values</h4>
<ul>
<li>Reference-class chamber: polarity effect less than 0.4%, i.e. 0.996 &lt; k<sub>pol</sub> &lt; 1.004. The variation with energy from ⁶⁰Co to 10 MV is less than 0.3% (TRS-398), or less than 0.5% over the whole energy range (TG-51 addendum).</li>
<li>In photon beams the effect is usually less than 0.2%.</li>
<li>TG-51: if at energies up to 6 MV P<sub>pol</sub> differs from 1 by more than 0.3%, P<sub>pol</sub> in the laboratory beam must be known.</li>
</ul>
<h4>Why measure it</h4>
<p>It is an independent functionality check that does not depend on the laboratory: a deviation from the value typical for the chamber type, or a change over time, indicates a problem with the chamber, cable, electrometer or procedure. Report 374 advises measuring k<sub>pol</sub> at every calibration and investigating if it has changed by more than 0.2%.</p>
<p>After changing polarity, wait for the readings to stabilize: some chambers need up to several tens of minutes.</p>
<p>If the laboratory did not apply a polarity correction at calibration, k′<sub>pol</sub> = k<sub>pol,Q</sub>/k<sub>pol,Q₀</sub> is used (Eq. 12 of TRS-398).</p>
<p class="src">TRS-398 Rev.1, Sec. 4.4.3.3, Eqs. (11)–(12), Table 3; TG-51, Sec. VII.A, Eq. (9); TG-51 addendum, Table III and Sec. 4.F; Report 374, Sec. 4.4.3.</p>`,
  },

  ks: {
    title: 'k<sub>s</sub> (P<sub>ion</sub>) — ion recombination correction',
    html: `
<p>Some ions recombine before reaching the electrodes, and the chamber collects less charge than was produced. Two types are distinguished:</p>
<ul>
<li><b>initial recombination</b> — ions from the same track; independent of dose rate, usually less than 0.2%;</li>
<li><b>general recombination</b> — ions from different tracks; increases with dose per pulse and can be significant in pulsed accelerator beams. In FFF beams the correction can reach 2%.</li>
</ul>
<h4>Why k<sub>s</sub> cannot be less than 1</h4>
<p>A chamber never collects more charge than was produced, and recombination is stronger at the reduced voltage. Hence M₁ ≥ M₂ and k<sub>s</sub> ≥ 1. A value below 1 indicates an error in the readings or swapped voltages.</p>
<h4>Two-voltage method</h4>
<p>Under identical irradiation, reading M₁ is taken at the operating voltage V₁ and M₂ at the reduced voltage V₂.</p>
<ul>
<li>TRS-398: k<sub>s</sub> = a₀ + a₁·(M₁/M₂) + a₂·(M₁/M₂)², with coefficients from Table 10 for V₁/V₂ = 2…5; ideally V₁/V₂ ≥ 3. For other ratios, Eq. (14), accurate to 0.1% for k<sub>s</sub> &lt; 1.03.</li>
<li>TG-51: P<sub>ion</sub> = (1 − V₁/V₂)/(M₁/M₂ − V₁/V₂); V₂ at least a factor of two lower than V₁.</li>
<li>The correction is measured at every calibration: it depends on the dose per pulse, i.e. on the pulse repetition frequency and the dose rate.</li>
<li>If the correction exceeds 1.05, the method is not applicable and a different chamber is needed. The threshold applies to k<sub>s</sub> measured in your beam; if the laboratory did not apply a recombination correction, the ratio k<sub>s,Q</sub>/k<sub>s,Q₀</sub> (Eq. 18) is used in the calculation, and it may be less than 1.</li>
<li>Polarity. M₁ and M₂ are taken at the normal polarity. TRS-398 (Sec. 4.4.3.4) notes that, strictly speaking, the polarity effect may depend on the voltage, and M₁ and M₂ should each be corrected for it (Eq. 11). The calculator assumes k<sub>pol</sub>(V₂) = k<sub>pol</sub>(V₁), so the correction cancels in the ratio M₁/M₂. As a check, k<sub>s</sub> can be determined separately at each polarity: a noticeable difference indicates a chamber problem.</li>
</ul>
<h4>Jaffé method: checking that the two-voltage method is applicable</h4>
<p>The two-voltage method assumes that in a pulsed beam 1/M depends linearly on 1/V. For some chambers, especially plane-parallel ones, this does not hold over the voltage range used. Therefore, when the dosimetry system is commissioned, a <b>Jaffé plot</b> — 1/M versus 1/V — is obtained:</p>
<ol>
<li>Readings are taken at a series of voltages of the same polarity as the operating voltage. After each voltage change, wait until the readings stabilize. TRS-398: over the whole range up to the maximum recommended by the manufacturer. Report 374: from about 1/3 of the manufacturer-recommended operating voltage up to at least the operating voltage.</li>
<li>Find V<sub>max</sub> — the voltage above which the plot deviates from a straight line (charge multiplication begins). If V<sub>max</sub> is lower than the voltage specified by the manufacturer, operate at V<sub>max</sub>. Both the operating and the reduced voltages must lie in the linear region.</li>
<li>Extrapolating the straight line to 1/V = 0 gives the saturation reading M<sub>0</sub>, and P<sub>ion</sub> = M<sub>0</sub>/M — this is used to verify the result of the two-voltage method.</li>
<li>Report 374: a Jaffé plot is mandatory for at least one modality (photons or electrons), and at commissioning it is also obtained at different values of dose per pulse. Dose per pulse is varied via SSD or depth: changing the dose rate via the pulse repetition frequency does not change it. For a reference-class chamber, P<sub>ion</sub> depends linearly on dose per pulse.</li>
</ol>
<p>In the calculator the Jaffé plot is built under Tools → Jaffé plot, together with the comparison with the two-voltage method, the polarity check and the dose-per-pulse dependence.</p>
<p>Some chambers have V<sub>max</sub> of only about 100 V, whereas the manufacturer specifies 300 V. Adopting the manufacturer's voltage without verification can lead to an error of 0.5% or more. After commissioning, the two-voltage method at each calibration is sufficient.</p>
<h4>Requirements for a reference-class chamber</h4>
<ul>
<li>The correction depends linearly on dose per pulse.</li>
<li>Initial recombination is less than 0.2% at ~300 V.</li>
<li>The difference in initial recombination when the polarity is reversed is less than 0.1%.</li>
</ul>
<h4>Continuous beam (⁶⁰Co)</h4>
<ul>
<li>TRS-398: at dose rates below 2 Gy/min, general recombination can be neglected; initial recombination dominates, and k<sub>s</sub> is determined by the two-voltage method using Eq. (13), as for a pulsed beam. If general recombination is noticeable and 1/M depends linearly on 1/V², Eq. (16) is used: k<sub>s</sub> = (n² − 1)/(n² − M₁/M₂), n = V₁/V₂.</li>
<li>TG-51: P<sub>ion</sub> = (1 − (V₁/V₂)²)/(M₁/M₂ − (V₁/V₂)²), Eq. (11) — an estimate of general recombination, although initial recombination may dominate.</li>
<li>In continuous beams the correction is small and more or less constant.</li>
</ul>
<p>If the laboratory did not apply a recombination correction at calibration, the user's correction is divided by its value at calibration (Eq. 18 of TRS-398). If the calibration was performed in a continuous ⁶⁰Co beam, this value is usually close to unity.</p>
<p class="src">TRS-398 Rev.1, Sec. 4.4.3.4, Eqs. (13)–(18), Tables 3 and 10; TG-51, Sec. VII.D, Eqs. (11)–(12); TG-51 addendum, Table III; Report 374, Secs. 4.4.4, 5 (item 4.d) and Appendix A.5.1.</p>`,
  },

  kleak: {
    title: 'k<sub>leak</sub> (P<sub>leak</sub>) — leakage correction',
    html: `
<p>Leakage is any contribution to the reading that is not due to ionization in the collecting volume of the chamber.</p>
<p>It is measured with the setup fully assembled and the accelerator switched on but with no beam, over a time at least as long as one measurement — before and after the irradiations.</p>
<ul>
<li>Reference-class chamber: leakage less than 0.1% of the reading. In that case the correction can be taken as 1.000.</li>
<li>Report 374: if leakage exceeds 0.1% of the reading, the cause must be identified. TG-51 addendum, citing TRS-398: a value above 0.5% must be investigated.</li>
</ul>
<p class="src">TRS-398 Rev.1, Table 3; TG-51 addendum, Sec. 5.C.4 and Table III; Report 374, Sec. 4.4.1.</p>`,
  },

  kvol: {
    title: 'k<sub>vol</sub> (P<sub>rp</sub>) — volume averaging correction',
    html: `
<p>The chamber reads the mean dose over its sensitive volume, whereas the dose at the reference point is required. In beams without a flattening filter the profile near the axis is distinctly peaked, and a long chamber under-reads.</p>
<p>k<sub>vol</sub> is the ratio of the dose at the reference point to the mean dose over the chamber volume (in the absence of the chamber).</p>
<ul>
<li><b>From the profile</b> (Eq. 21): k<sub>vol</sub> = L / ∫OAR(y)dy over the interval from −L/2 to L/2. The profile is measured with a small-volume detector in steps of about 1 mm.</li>
<li><b>General estimate</b> (Eq. 22): k<sub>vol</sub> = 1 + (0.0062·TPR<sub>20,10</sub> − 0.0036)·L²·(100/SDD)², with L and SDD in centimeters.</li>
<li><b>Table 11</b> — values from the same formula for SDD = 110 cm.</li>
</ul>
<p>The effect is largest for chambers with a long cavity, e.g. Farmer-type chambers (L ≈ 2.5 cm), and in high-energy FFF beams. Short chambers, for which k<sub>vol</sub> is close to 1, are therefore recommended for FFF beams. Report 374: neglecting the correction leads to an error of up to 0.7% for a Farmer chamber in an FFF beam.</p>
<p class="src">TRS-398 Rev.1, Sec. 4.4.3.5, Eqs. (19)–(22), Table 11; TG-51 addendum, Secs. 4.K(2) and 5.C.7; Report 374, Sec. 4.5, Eq. (8).</p>`,
  },

  kQ: {
    title: 'k<sub>Q</sub> — beam quality correction',
    html: `
<p>The calibration coefficient N<sub>D,w</sub> is obtained in a ⁶⁰Co beam. k<sub>Q</sub> converts it to the user's beam quality Q; its value depends on the chamber type.</p>
<ul>
<li><b>Preferably</b> — k<sub>Q</sub> measured for the specific chamber. If it was measured by a primary standards dosimetry laboratory (PSDL), the uncertainty is about 0.3%.</li>
<li><b>Otherwise</b> — calculated values for the chamber type. The uncertainty is about 0.6%; chamber-to-chamber variations within a type are not taken into account.</li>
</ul>
<h4>TRS-398 Rev.1</h4>
<p class="formula">k<sub>Q</sub> = [1 + exp((a − 0.57)/b)] / [1 + exp((a − TPR<sub>20,10</sub>)/b)]</p>
<ul>
<li>The parameters a and b are taken from Table 45; at TPR<sub>20,10</sub> = 0.57 (⁶⁰Co), k<sub>Q</sub> = 1.</li>
<li>Table 16 gives values of the same formula to four digits for interpolation. Calculation from the formula and from the table therefore differ only in the fourth digit.</li>
</ul>
<h4>TG-51</h4>
<p>k<sub>Q</sub> = A + B·10⁻³·%dd(10)<sub>x</sub> + C·10⁻⁵·%dd(10)<sub>x</sub>² from Table I of the 2014 addendum.</p>
<ul>
<li>The formula is valid for 63 &lt; %dd(10)<sub>x</sub> &lt; 86.</li>
<li>Below 63, k<sub>Q</sub> is interpolated to 1.000 at 58.</li>
</ul>
<p class="src">TRS-398 Rev.1, Sec. 6.5, Eq. (34), Tables 16, 17, 45, 46; TG-51 addendum, Sec. 3.D, Table I.</p>`,
  },

  tpr: {
    title: 'TPR<sub>20,10</sub> — beam quality specifier (TRS-398)',
    html: `
<p>The ratio of the absorbed doses at depths of 20 and 10 g/cm² in water. Measurement conditions:</p>
<ul>
<li>the source-to-chamber distance is constant and equal to 100 cm;</li>
<li>a 10 × 10 cm field at the plane of the chamber.</li>
</ul>
<p>The main advantage of TPR<sub>20,10</sub> is its independence of electron contamination of the beam.</p>
<ul>
<li>The ratio of chamber readings can be used: the water/air stopping-power ratio varies slowly beyond the dose maximum.</li>
<li>No correction for the shift of the point of measurement of a cylindrical chamber is needed, and small systematic positioning errors affect both depths equally.</li>
</ul>
<h4>Conversion relations</h4>
<ul>
<li>For beams with a flattening filter: TPR<sub>20,10</sub> = 1.2661·PDD<sub>20,10</sub> − 0.0595. PDD<sub>20,10</sub> is the ratio of the PDDs at 20 and 10 cm at SSD 100 cm, 10 × 10 cm field at the surface.</li>
<li>Estimate from PDD(10): TPR<sub>20,10</sub> = −0.7898 + 0.0329·PDD(10) − 0.000166·PDD(10)². TRS-398 permits it only for estimation, not for beam calibration.</li>
</ul>
<p>For FFF beams, TPR<sub>20,10</sub> is suitable as a beam quality specifier up to ~10 MV.</p>
<p class="src">TRS-398 Rev.1, Sec. 6.3, footnote 36, Table 14.</p>`,
  },

  pdd10x: {
    title: '%dd(10)<sub>x</sub> — beam quality specifier (TG-51)',
    html: `
<p>The photon component of the percentage depth dose at 10 cm depth: 10 × 10 cm field at the water surface, SSD 100 cm.</p>
<p>%dd(10) in an open beam includes the contribution of contaminant electrons; %dd(10)<sub>x</sub> does not. Therefore:</p>
<ul>
<li>below 10 MV (%dd(10) ≤ 75%) — %dd(10)<sub>x</sub> = %dd(10);</li>
<li>from 10 MV — from a measurement with a 1 mm lead foil at 50 or 30 cm from the surface, Eqs. (13)–(14);</li>
<li>for beams with a flattening filter and a jaw-to-water distance of at least 45 cm, the interim formula (15) without the foil is permitted;</li>
<li>for all FFF beams the foil is mandatory.</li>
</ul>
<p>The ionization curve of a cylindrical chamber is shifted toward the surface by 0.6·r<sub>cav</sub>. The foil must be removed after the measurement.</p>
<p class="src">TG-51, Sec. VIII; TG-51 addendum, Secs. 4.H, 4.K; Report 374, Sec. 3.</p>`,
  },

  ndw: {
    title: 'N<sub>D,w</sub> — chamber calibration coefficient',
    html: `
<p>A coefficient in terms of absorbed dose to water, obtained at a calibration laboratory in a ⁶⁰Co beam. It is valid for the standard conditions stated in the certificate: temperature, pressure, voltage and polarity.</p>
<p>If the laboratory did not apply polarity or recombination corrections, this must be stated in the certificate: they are then accounted for separately (section 2 of the form).</p>
<p>If the calibration certificate gives a correction multiplier K next to N<sub>D,w</sub> (as in VNIIFTRI certificates), enter it in the k<sub>lab</sub> field: the calibration coefficient is multiplied by it. TG-51 and TRS-398 have no such quantity; with K = 1.000 it does not affect the result.</p>
<p>TG-51: the chamber is calibrated on purchase, after repair, when checks raise doubts, and at least every two years.</p>
<p class="src">TRS-398 Rev.1, Secs. 3, 4.4.3; TG-51, Sec. V, Eq. (7).</p>`,
  },

  pdd: {
    title: 'Transfer of dose to the depth of maximum dose',
    html: `
<p>The reference dose is determined at the reference depth z<sub>ref</sub>: 10 cm for MV photons; 5 or 10 g/cm² (TRS-398) or 10 cm (TG-51) for ⁶⁰Co. In the clinic, output is usually specified at the depth of maximum dose (d<sub>max</sub>, z<sub>max</sub>).</p>
<ul>
<li><b>SSD:</b> D(d<sub>max</sub>) = D(z<sub>ref</sub>)/(PDD(z<sub>ref</sub>)/100).</li>
<li><b>SAD:</b> D(d<sub>max</sub>) = D(z<sub>ref</sub>)/TMR(z<sub>ref</sub>).</li>
</ul>
<p>Use the clinical PDD (or TMR) — the one entered into the treatment planning system from the commissioning data — for the same distance and a 10 × 10 cm field. For an accelerator, the beam quality must match that measured at calibration.</p>
<p>Omitting this transfer is one of the errors that lead to discrepancies of 8% or more.</p>
<p class="src">TRS-398 Rev.1, Secs. 5.4.3 and 6.4.3; TG-51, Sec. IX.C; Report 374, Sec. 2.4.3.</p>`,
  },

  tmr: {
    title: 'TMR — tissue-maximum ratio',
    html: `
<p>TMR (tissue-maximum ratio) is the ratio of the dose at a point at depth d to the dose at the same point with a water layer of thickness d<sub>max</sub> above it. The source-to-point distance (usually the isocenter) and the field size at the point stay the same; only the water thickness above the point changes.</p>
<p class="formula">TMR(d, A) = D(d, A) / D(d<sub>max</sub>, A)</p>
<p>Unlike PDD, TMR contains no inverse-square factor: it does not depend on SSD and suits the isocentric setup. A is the field at the plane of the point; for calibration it is 10 × 10 cm at the isocenter.</p>
<h4>Why it is needed here</h4>
<p>In an SAD (SCD) setup the chamber is at the isocenter at the reference depth. The dose at d<sub>max</sub> at the isocenter is D(d<sub>max</sub>) = D(z<sub>ref</sub>) / TMR(z<sub>ref</sub>). A PDD measured at SSD 100 cm must not be used here: it refers to a different setup, and the result would be too high (by about 17% for 6 MV).</p>
<h4>Where to get it</h4>
<ul>
<li><b>From the commissioning data</b> — the same data entered into the treatment planning system, for this beam and a 10 × 10 cm field at the isocenter. TMR is not remeasured at every calibration.</li>
<li><b>Measure it.</b> The chamber stays fixed at the isocenter with a 10 × 10 cm field at the isocenter; only the water level above the chamber is changed (by adding or removing water; some water phantoms have a TMR/TPR mode with a reservoir). Readings are taken at the reference depth and at d<sub>max</sub>: TMR(z<sub>ref</sub>) = M(z<sub>ref</sub>) / M(d<sub>max</sub>). It is a ratio of readings of the same chamber, so N<sub>D,w</sub> and k<sub>TP</sub> cancel if the temperature and pressure did not change during the measurement.</li>
<li><b>Calculate it from PDD</b> if no TMR is available: TMR(d, A<sub>d</sub>) = PDD(d, A, f)/100 · ((f + d)/(f + d<sub>max</sub>))² · S<sub>p</sub>(A<sub>dmax</sub>)/S<sub>p</sub>(A<sub>d</sub>), where f is the SSD, A is the field at the surface, A<sub>d</sub> and A<sub>dmax</sub> are the fields at depths d and d<sub>max</sub>, and S<sub>p</sub> is the phantom scatter factor. This is an approximation: the commissioning data are more reliable.</li>
</ul>
<h4>Checks</h4>
<ul>
<li>TMR is entered as a ratio, not as a percentage.</li>
<li>TMR(10) is noticeably larger than PDD(10)/100 at SSD 100 cm: for 6 MV by a factor of about (110/101.5)² ≈ 1.17, slightly less because of the difference in scatter.</li>
<li>Do not confuse TMR(10) with TPR<sub>20,10</sub>: the latter is a beam quality index, the ratio of doses at depths of 20 and 10 cm.</li>
</ul>
<p class="src">TRS-398 Rev.1, Secs. 5.4.3 and 6.4.3; TG-51, Sec. IX.C; Report 374, Sec. 2.4.3; Khan and Gibbons, 2014 (TPR and TMR).</p>`,
  },

  timer: {
    title: 'Timer error of a ⁶⁰Co unit',
    html: `
<p>The ⁶⁰Co source also irradiates while moving to the irradiation position and back, whereas the timer counts only the set time. The actual irradiation therefore differs from the set one by a constant amount τ — the timer error (for shutter-type units, the shutter error). For ⁶⁰Co units it can noticeably affect the reading and must be taken into account.</p>
<p class="formula">M = Ṁ · (t + τ)</p>
<h4>How to determine it</h4>
<ul>
<li>Make several irradiations in the same geometry with different set times, e.g. 0.5, 1 and 2 min, and record the readings.</li>
<li>The calculator fits a straight line M = a·t + b through the points by least squares; τ = b/a. With two irradiations the solution is exact.</li>
<li>Another common method is to compare a single irradiation of time t (reading M₁) with n irradiations of t/n each (total reading Mₙ): τ = t·(Mₙ − M₁)/(n·M₁ − Mₙ).</li>
<li>If the charge is collected by the electrometer over an interval when the source is already in the treatment position, the timer error does not enter the dose rate.</li>
</ul>
<p>τ can be either positive or negative. Dose rate = D per irradiation / (t + τ).</p>
<p class="src">TRS-398 Rev.1, Sec. 5.4.2 and worksheet 5.8; TG-51, Sec. VII ("shutter timing error").</p>`,
  },

  gcm2: {
    title: 'g/cm² — depth in units of mass thickness',
    html: `
<p>In TRS-398, depths and ranges are given in g/cm². This is the mass (water-equivalent) thickness: the geometric thickness in centimeters multiplied by the density of the material in g/cm³.</p>
<p class="formula">d [g/cm²] = d [cm] · ρ [g/cm³]</p>
<p>The density of water is 1 g/cm³, so in a water phantom <b>1 g/cm² = 1 cm of depth</b>, and the numbers are the same: R<sub>50</sub> = 2.40 g/cm² is 2.40 cm, z<sub>ref</sub> = 1.34 g/cm² is 1.34 cm below the water surface. The calculator works for water only, so these values can be entered and read as centimeters.</p>
<h4>Why these units</h4>
<p>Attenuation and scatter of the beam depend on the mass of material in its path, not on the geometric thickness. Mass thickness lets depths be written in the same way for different materials. TG-51 and Report 385 give the same depths in centimeters of water — they are the same numbers.</p>
<h4>When centimeters and g/cm² differ</h4>
<ul>
<li><b>Chamber entrance window and phantom wall</b>: they are accounted for by their water-equivalent thickness. For example, the Roos window is 132 mg/cm², i.e. 1.32 mm of water, although it is 1.13 mm thick geometrically; a PMMA phantom window of thickness t gives t·1.19 g/cm².</li>
<li><b>Plastic phantom</b>: the depth in plastic is converted to the equivalent depth in water with a depth-scaling factor (TRS-398, Sec. 7.8). The calculator does not do this — water phantoms only.</li>
</ul>
<p class="src">TRS-398 Rev.1, Table 1 (note a), Secs. 4.2.5 and 7.8; Report 385, Sec. 3.</p>`,
  },

  r50: {
    title: 'R<sub>50</sub> — electron beam quality specifier',
    html: `
<p>R<sub>50</sub> is the depth in water (g/cm²) at which the absorbed dose falls to 50% of its maximum. It is measured at SSD 100 cm with a field size at the surface of at least 10 × 10 cm.</p>
<h4>Measurement with an ionization chamber</h4>
<ul>
<li>A chamber measures ionization, not dose: R<sub>50,ion</sub> (I<sub>50</sub>), the depth of 50% ionization, is obtained and converted: R<sub>50</sub> = 1.029·R<sub>50,ion</sub> − 0.06 for R<sub>50,ion</sub> ≤ 10 g/cm²; R<sub>50</sub> = 1.059·R<sub>50,ion</sub> − 0.37 for R<sub>50,ion</sub> &gt; 10 g/cm².</li>
<li>TRS-398: the preferred detector is a plane-parallel chamber (the point of measurement is the inner surface of the entrance window, taking its water-equivalent thickness into account). A cylindrical chamber can be used for R<sub>50</sub> &gt; 3 g/cm², with the curve shifted by 0.5·r<sub>cyl</sub>; this factor is approximate.</li>
<li>Report 385 (citing Report 374): for accuracy, chamber-specific shifts are applied (Tables 2 and 3). For a cylindrical chamber, the shift is needed only when measuring the ionization curve, not when positioning the chamber at d<sub>ref</sub>.</li>
<li>With a vertical beam, scan toward the surface. Ideally, recombination and polarity corrections are applied at all depths; a temperature and pressure correction is not needed for short measurements.</li>
<li>A diode or diamond detector can be used instead of a chamber if a comparison with a chamber has confirmed that its response follows the dose.</li>
</ul>
<h4>What follows from it</h4>
<ul>
<li>The reference depth z<sub>ref</sub> = d<sub>ref</sub> = 0.6·R<sub>50</sub> − 0.1 g/cm² — close to the depth of maximum dose or deeper.</li>
<li>The mean energy at the surface is approximately E₀ ≈ 2.33·R<sub>50</sub> MeV; in case of disagreement, R<sub>50</sub> takes precedence.</li>
<li>Report 385, citing TG-142: R<sub>50</sub> must agree with the baseline value within ±1 mm; such a deviation changes k<sub>Q</sub> by no more than 0.15% but shifts the reference depth.</li>
</ul>
<p class="src">TRS-398 Rev.1, Secs. 7.2.1, 7.3, Eqs. (37), (39), Tables 18–19, footnote 39; Report 385, Sec. 4, Eqs. (2)–(3), Tables 2–3, Sec. 8.3.3.</p>`,
  },

  kQe: {
    title: 'k<sub>Q</sub> for electron beams',
    html: `
<h4>TRS-398 Rev.1</h4>
<p class="formula">D<sub>w,Q</sub> = M<sub>Q</sub> · N<sub>D,w,Q₀</sub> · k<sub>Q,Q₀</sub></p>
<ul>
<li><b>Calibration in ⁶⁰Co:</b> k<sub>Q</sub> from Table 20, interpolated in R<sub>50</sub> (or from the fits in Appendix II, Eqs. 98–99, with the parameters of Table 47 used to calculate the table). The table includes only the plane-parallel PTW Roos and IBA NACP-02 (R<sub>50</sub> from 1 g/cm²) and six cylindrical chambers (from 3 g/cm²). For R<sub>50</sub> &lt; 1.4 g/cm², experimentally determined coefficients are recommended.</li>
<li><b>Cross-calibration</b> (Sec. 7.6): in the highest-energy beam, preferably with R<sub>50</sub> &gt; 7 g/cm², the field chamber is compared with the reference chamber at z<sub>ref</sub>: N<sub>D,w,Qcross</sub> = (M<sub>ref</sub>/M<sub>field</sub>)·N<sup>ref</sup><sub>D,w,Q₀</sub>·k<sup>ref</sup><sub>Qcross,Q₀</sub> (Eq. 41). Then, in any beam, k<sub>Q,Qcross</sub> = k<sub>Q,Qint</sub>/k<sub>Qcross,Qint</sub> (Eq. 44) using Table 21, Q<sub>int</sub> = 7.5 g/cm².</li>
<li><b>Laboratory calibration in electron beams:</b> k<sub>Q,Q₀</sub> = N<sub>D,w,Q</sub>/N<sub>D,w,Q₀</sub> (Eq. 40), with interpolation between qualities. Such a value is entered manually.</li>
</ul>
<h4>TG-51 with Report 385</h4>
<p class="formula">D<sub>w</sub> = M · k′<sub>Q</sub> · k<sub>Qecal</sub> · N<sub>D,w</sub><sup>⁶⁰Co</sup></p>
<ul>
<li>k′<sub>Q</sub> is a fit to Monte Carlo calculations: a + b·R<sub>50</sub><sup>−c</sup> for cylindrical chambers (Eq. 7) and a + b·e<sup>−R50/c</sup> for plane-parallel chambers (Eq. 8), 1.70 ≤ R<sub>50</sub> ≤ 8.70 cm. The functional forms are swapped relative to the original TG-51 — this is not a typo.</li>
<li>k<sub>Qecal</sub> is k<sub>Q</sub> at R<sub>50</sub> = 7.5 cm (Tables 4 and 6).</li>
<li>The center of a cylindrical chamber is placed at d<sub>ref</sub> without a shift: the gradient correction is already included in k<sub>Q</sub> = k′<sub>Q</sub>·k<sub>Qecal</sub> (both were calculated for this position), so P<sub>gr</sub> need not be measured. A plane-parallel chamber is positioned with the shift from Table 3.</li>
<li>Cross-calibration of a plane-parallel chamber against a cylindrical chamber in a high-energy beam: (k<sub>Qecal</sub>N<sub>D,w</sub>)<sub>pp</sub> = (M k′<sub>Q</sub> k<sub>Qecal</sub> N<sub>D,w</sub>)<sub>cyl</sub>/(M k′<sub>Q</sub>)<sub>pp</sub> (Eq. 5); then D<sub>w</sub> = (M k′<sub>Q</sub>)<sub>pp</sub>·(k<sub>Qecal</sub>N<sub>D,w</sub>)<sub>pp</sub> (Eq. 6).</li>
<li>Chambers not listed in Tables 4–7 are not recommended. The dose per MU according to Report 385 is up to ~2% higher than according to the original TG-51.</li>
</ul>
<p class="src">TRS-398 Rev.1, Secs. 7.4–7.6, Eqs. (38), (40)–(44), Tables 20–21; Report 385, Secs. 5–6, Eqs. (4)–(8), Tables 4–7.</p>`,
  },

  pddE: {
    title: 'Transfer of electron dose to the depth of maximum dose',
    html: `
<p>The reference dose is determined at z<sub>ref</sub> = 0.6·R<sub>50</sub> − 0.1, whereas clinical normalization is usually done at the depth of maximum dose z<sub>max</sub>. These depths do not always coincide: at high energies z<sub>ref</sub> is deeper.</p>
<p class="formula">D(z<sub>max</sub>) = D(z<sub>ref</sub>) / (PDD(z<sub>ref</sub>)/100)</p>
<ul>
<li>Use the clinical depth-dose curve — the one entered into the treatment planning system.</li>
<li>If the curve was measured with an ionization chamber, ionization is converted to dose by multiplying by the water/air stopping-power ratio s<sub>w,air</sub> for the given depth (TRS-398, Table 22). For reference-class chambers, the variation of the perturbation correction with depth affects R<sub>50</sub> by less than 0.05 g/cm².</li>
<li>Report 385: incorrect transfer of dose from d<sub>ref</sub> to d<sub>max</sub> is one of the most common errors in electron beam calibration.</li>
</ul>
<p class="src">TRS-398 Rev.1, Secs. 7.4.3, 7.7.1, Table 22; Report 385, Sec. 4; TG-51, Sec. X.D.</p>`,
  },

  crosscal: {
    title: 'Cross-calibration of a field chamber',
    html: `
<p>A field chamber is calibrated in the clinic against a reference chamber that has an N<sub>D,w</sub> calibration coefficient in ⁶⁰Co. This keeps the reference chamber, which is regularly sent for calibration, out of routine use while preserving the traceability of the field chamber to the primary standard (TRS-398, Sec. 4.5).</p>
<h4>How to measure</h4>
<ul>
<li><b>Substitution:</b> the chambers are placed in turn at the reference point at z<sub>ref</sub> and irradiated identically (the same MU or time). To account for output drift, the reference chamber is measured before and after the field chamber; in photon beams TRS-398 recommends dividing the readings by those of an external monitor in the phantom at z<sub>ref</sub>, 3–4 cm from the chamber (Sec. 6.6).</li>
<li><b>Side by side</b> (⁶⁰Co and photons, chambers of similar design): the chambers are irradiated simultaneously, then swapped and the measurement repeated, and the mean is taken for each; no monitor is needed if the profile is uniform (footnote 28).</li>
<li>The readings of both chambers are corrected for temperature and pressure, electrometer, polarity and recombination; in an FFF beam also for volume averaging k<sub>vol</sub> (Eq. 22), which differs for chambers of different length.</li>
</ul>
<h4>⁶⁰Co (reference beam quality Q₀)</h4>
<p class="formula">N<sup>field</sup><sub>D,w</sub> = (M<sub>ref</sub>/M<sub>field</sub>) · N<sup>ref</sup><sub>D,w</sub></p>
<p>TRS-398, Eqs. (25), (32), (36). The result is an ordinary N<sub>D,w</sub> in ⁶⁰Co: the field chamber is then used like a laboratory-calibrated one.</p>
<h4>Clinical MV photon beam Q<sub>cross</sub></h4>
<p class="formula">N<sup>field</sup><sub>D,w,Qcross</sub> = (M<sub>ref</sub>/M<sub>field</sub>) · N<sup>ref</sup><sub>D,w,Q₀</sub> · k<sup>ref</sup><sub>Qcross</sub></p>
<p>TRS-398, Sec. 4.5.2, Eqs. (26)–(27); k<sup>ref</sup><sub>Qcross</sub> from the TPR<sub>20,10</sub> of the beam (Table 16 or Eq. 34). Then in any photon beam Q: k<sup>field</sup><sub>Q,Qcross</sub> = k<sup>field</sup><sub>Q</sub>/k<sup>field</sup><sub>Qcross</sub> (Eq. 30), so the TPR<sub>20,10</sub> of the cross-calibration beam must be kept together with the coefficient.</p>
<h4>Electron beam</h4>
<p>Plane-parallel chambers for electrons are better calibrated in an electron beam: the ⁶⁰Co calibration coefficients of some of them are sensitive to small construction details. Use the highest-energy beam: TRS-398 recommends R<sub>50</sub> &gt; 7 g/cm² (E₀ &gt; 16 MeV), TG-51 above 10 MeV.</p>
<p class="formula">N<sub>D,w,Qcross</sub> = (M<sub>ref</sub>/M<sub>field</sub>) · N<sup>ref</sup><sub>D,w,Q₀</sub> · k<sup>ref</sup><sub>Qcross,Q₀</sub></p>
<p>TRS-398, Eq. (41); k<sup>ref</sup><sub>Qcross,Q₀</sub> from Table 20. Then k<sub>Q,Qcross</sub> = k<sub>Q,Qint</sub>/k<sub>Qcross,Qint</sub> from Table 21, so the R<sub>50</sub> of the cross-calibration beam is kept.</p>
<p class="formula">(k<sub>Qecal</sub>N<sub>D,w</sub>)<sub>pp</sub> = (M k′<sub>Q</sub> k<sub>Qecal</sub> N<sub>D,w</sub>)<sub>cyl</sub> / (M k′<sub>Q</sub>)<sub>pp</sub></p>
<p>Report 385, Eq. (5): the reference chamber is cylindrical and the field chamber plane-parallel; then D<sub>w</sub> = (M k′<sub>Q</sub>)<sub>pp</sub>·(k<sub>Qecal</sub>N<sub>D,w</sub>)<sub>pp</sub>. For such a chamber TG-51 takes P<sub>elec</sub> = 1. For ⁶⁰Co and photons, TG-51 and its addenda do not describe cross-calibration.</p>
<h4>After the calculation</h4>
<p>The “Transfer to the … tab” button fills the Chamber and electrometer section of the relevant tab: the chamber, the calibration route, the coefficient, the quality of the cross-calibration beam, T₀, P₀ and the electrometer. The coefficient is valid with the same T₀, P₀ and k<sub>elec</sub>. The dose uncertainty with a cross-calibrated chamber is slightly larger: TRS-398 estimates the addition at about 0.2 % for photons (Sec. 6.8) and treats electrons separately (Sec. 7.10, Eq. 47).</p>
<p class="src">TRS-398 Rev.1, Sec. 4.5, 5.5, 6.6, 6.8, 7.6, 7.10, Eqs. (25)–(30), (32), (36), (41)–(44), (47), Tables 16, 20–21; TG-51, Sec. X.C; Report 385, Sec. 5.3.2, Eqs. (5)–(6).</p>`,
  },
  unc: {
    title: 'Uncertainty of the absorbed dose',
    html: `
<p>Uncertainty is a parameter characterizing the dispersion of the values that could reasonably be attributed to the measurand once all known corrections have been applied. It is usually an estimated standard deviation and has no sign.</p>
<h4>Type A and type B</h4>
<ul>
<li><b>Type A</b> — from the statistics of a series of observations. For the mean of n readings u<sub>A</sub> = s/√n, where s is the standard deviation of a single reading (App. IV, Eqs 106–109). The calculator evaluates it from the entered series of readings (taken from a dosimetry tab, it is the series used for the dose) and compares it with the “reading relative to the monitor” row (TRS-398) or the “linac stability” row (TG-51): the larger value is used.</li>
<li><b>Type B</b> — everything else: laboratory and literature data, corrections, estimates from experience. If only limits ±a are known: for a rectangular distribution u = a/√3, for a triangular one a/√6; if the limits correspond to roughly 95% confidence, u = a/2 (Eqs 110–112).</li>
<li>There is no point in stating type B uncertainties to more than one, at most two, significant digits.</li>
</ul>
<h4>Combination</h4>
<p class="formula">u<sub>c</sub> = √(Σ u<sub>i</sub>²), U = k · u<sub>c</sub>, k = 2</p>
<p>The components are assumed independent and are added in quadrature (Eq. 113). The expanded uncertainty with coverage factor k = 2 corresponds to a confidence level of about 95% (App. IV.5).</p>
<h4>Calibration certificate</h4>
<p>Certificates usually state the expanded uncertainty U (k = 2). For the budget, divide it by k: for example, U = 1.2% at k = 2 gives a standard uncertainty of 0.6%. This value replaces the laboratory part of the example (step 1 of TRS-398 or the N<sub>D,w</sub> row of TG-51).</p>
<h4>Typical totals of the examples (k = 1)</h4>
<ul>
<li>TRS-398: ⁶⁰Co — 0.8% (Table 13); MV photons — 1.0% (Table 17); electrons — 1.1% for a cylindrical and 1.2% for a plane-parallel chamber (Table 24). With a cross-calibrated field instrument, about 0.2% more (Sec. 5.7, 6.8).</li>
<li>TG-51 addendum, Table II: 0.9% in example (i) and 2.1% in example (ii); Report 385: 0.9 and 2.0% (Table 8), 1.1 and 2.5% for a cross-calibrated plane-parallel chamber (Table 9).</li>
</ul>
<p>The budget is the user's responsibility and should be re-evaluated whenever the procedure or equipment changes significantly (TG-51 addendum, Sec. 5).</p>
<p class="src">TRS-398 Rev.1, Sec. 1.4.3, 5.7, 6.8, 7.10, App. IV, Tables 13, 17, 24; TG-51 addendum (2014), Sec. 5, Table II; Report 385, Sec. 8, Tables 8, 9.</p>`,
  },
};
