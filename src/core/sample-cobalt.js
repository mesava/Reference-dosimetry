// Демонстрационный набор для ⁶⁰Co. Значения правдоподобны, но вымышлены.
import { CO_DEFAULTS } from './cobalt.js';

export const SAMPLE_COBALT = {
  ...CO_DEFAULTS,
  protocol: 'trs',
  co_institution: 'Пример',
  co_machine: 'Аппарат ⁶⁰Co (демо)',
  co_staff: [''],
  co_notes: 'Демонстрационные данные, не результаты реальных измерений.',

  co_geometry: 'SSD',
  co_distance: '80',
  co_zref: '5',

  co_ch_model: 'NE2571',
  co_ch_serial: '0000',
  co_ndw: '0,04523',
  co_ndw_unit: 'Gy/nC',
  co_T0: '20',
  co_P0: '101,325',
  co_el_model: 'Электрометр (демо)',
  co_kelec: '1,000',

  co_env_T: '21,0',
  co_env_P: '100,5',
  co_env_P_unit: 'kPa',

  co_time: '1,00',
  co_time_unit: 'min',
  co_timer_mode: 'measured',
  co_tt: ['0,50', '1,00', '2,00'],
  co_tm: ['12,93', '25,60', '50,95'],

  co_V1: '300',
  co_V2: '100',
  co_polarity: '+',
  co_M1: ['25,60', '25,61', '25,59'],
  co_Mopp: ['-25,58', '-25,59', '-25,58'],
  co_M2: ['25,58', '25,59', '25,58'],
  co_kleak: '1,000',
  co_Mc: ['25,61', '25,60', '25,61'],
  co_rec_trs: 'eq13',

  co_dd_on: true,
  co_zmax: '0,5',
  co_pdd: '78,8',
  co_date: '2026-09-15',
  co_act0: '10500',
  co_act_unit: 'Ci',
  co_act_date: '2024-02-12',
  co_ref_rate: '148,6',
  co_ref_date: '2026-08-15',
};

// Текстовые поля демонстрационного набора по-английски (числа те же).
export const SAMPLE_COBALT_EN = {
  co_institution: 'Example',
  co_machine: '⁶⁰Co unit (demo)',
  co_el_model: 'Electrometer (demo)',
  co_notes: 'Demo data, not results of real measurements.',
};
