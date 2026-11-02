// Данные для kV-рентгена: B_w и [μen/ρ]w,air по P. Andreo (2019) и калькулятор этих величин (kvx.js).
// Данные Andreo лежат отдельно, в data/andreo-kv/: на них действуют условия автора (только некоммерческое использование
// и обязательная ссылка на источник, см. data/andreo-kv/README.md), а не лицензия AGPL кода калькулятора.

import ANDREO from '../../data/andreo-kv/andreo_webapp.js';
import NIST from './kv-nist.js';
import { createCalculator } from './kvx.js';

/** Ссылка на источник данных: по условиям автора её приводят везде, где используются величины Andreo. */
export const ANDREO_CITATION = 'Andreo P 2019 Data for the dosimetry of low- and medium-energy kV x rays. Phys. Med. Biol. 64 205019. doi:10.1088/1361-6560/ab421d';

let calc = null;

/**
 * Калькулятор B_w, [μen/ρ]w,air и отношений для k_g (см. kvx.js): { bw, bwCu, muenFIA, muenZ2, kgBw, kgMuenZ2, hvlMax, hvlCheck }.
 * Создаётся при первом обращении: подготовка сеток (обращение матриц сплайнов) нужна только вкладке kV-рентгена.
 */
export function kvCalculator() {
  if (!calc) calc = createCalculator(ANDREO, NIST);
  return calc;
}
