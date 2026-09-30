// Демонстрационный набор для пучка электронов. Значения правдоподобны, но вымышлены.
import { E_DEFAULTS } from './electrons.js';

export const SAMPLE_ELECTRONS = {
  ...E_DEFAULTS,
  protocol: 'trs',
  e_institution: 'Пример',
  e_machine: 'Ускоритель (демо)',
  e_beam: '12 МэВ',
  e_energy: '12',
  e_date: '2026-09-15',
  e_staff: [''],
  e_notes: 'Демонстрационные данные, не результаты реальных измерений.',
  e_ssd: '100',
  e_field: '10',

  e_r50_method: 'i50',
  e_i50: '4,80',

  e_ch_model: 'PTW30013',
  e_ch_serial: '0000',
  e_cal_route: 'co60',
  e_ndw: '0,05335',
  e_ndw_unit: 'Gy/nC',
  e_T0: '20',
  e_P0: '101,325',
  e_el_model: 'Электрометр (демо)',
  e_kelec: '1,000',

  e_env_T: '21,4',
  e_env_P: '99,62',
  e_env_P_unit: 'kPa',

  e_mu: '100',
  e_polarity: '+',
  e_V1: '300',
  e_V2: '100',
  e_beam_mode: 'pulsed',
  e_M1: ['19,86', '19,85', '19,87'],
  e_Mopp: ['-19,94', '-19,93', '-19,95'],
  e_M2: ['19,77', '19,76', '19,78'],
  e_M51: ['19,88', '19,87', '19,89'],
  e_Mopp51: ['-19,96', '-19,95', '-19,97'],
  e_M251: ['19,79', '19,78', '19,80'],
  e_kleak: '1,000',

  e_dd_on: true,
  e_zmax: '2,7',
  e_pdd: '99,6',
  e_nominal: '1,000',
};
