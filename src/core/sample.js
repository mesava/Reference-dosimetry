// Демонстрационный набор данных. Значения правдоподобны, но вымышлены:
// это не измерения конкретного аппарата и не данные из протоколов.
import { FORM_DEFAULTS } from './photons.js';

export const SAMPLE_FORM = {
  ...FORM_DEFAULTS,
  protocol: 'both',
  meta_institution: 'Пример',
  meta_machine: 'Линейный ускоритель (демо)',
  meta_beam: '6 МВ',
  meta_energy: '6',
  meta_fff: false,
  meta_physicist: '',
  meta_notes: 'Демонстрационные данные, не результаты реальных измерений.',

  setup_geometry: 'SSD',

  ch_model: 'PTW30013',
  ch_serial: '000000',
  ch_ndw: '0,05335',
  ch_ndw_unit: 'Gy/nC',
  ch_T0: '20',
  ch_P0: '101,325',
  el_model: 'Электрометр (демо)',
  el_kelec: '1,000',

  env_T: '21,4',
  env_P: '99,62',
  env_P_unit: 'kPa',

  rd_mu: '100',
  rd_polarity: '+',
  rd_V1: '300',
  rd_V2: '100',
  rd_beam: 'pulsed',
  rd_M1: '12,346 12,348 12,345',
  rd_Mopp: '-12,339 -12,341',
  rd_M2: '12,302 12,304',
  rd_kleak: '1,000',

  q51_method: 'open',
  q51_pdd10: '66,4',

  qtrs_method: 'direct',
  qtrs_tpr: '0,668',

  prof_mode: 'none',

  dd_on: true,
  dd_pdd: '66,4',
  dd_nominal: '1,000',
};
