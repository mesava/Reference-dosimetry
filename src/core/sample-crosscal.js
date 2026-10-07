// Демонстрационный набор для перекрёстной калибровки. Значения правдоподобны, но вымышлены.
import { CC_DEFAULTS } from './crosscal.js';

export const SAMPLE_CROSSCAL = {
  ...CC_DEFAULTS,
  protocol: 'trs',
  cc_institution: 'Пример',
  cc_machine: 'Ускоритель (демо)',
  cc_beam: '18 МэВ',
  cc_date: '2026-09-15',
  cc_staff: [''],
  cc_notes: 'Демонстрационные данные, не результаты реальных измерений.',

  cc_r50_method: 'i50',
  cc_i50: '7,40',
  cc_mu: '100',
  cc_beam_mode: 'pulsed',

  cc_ref_model: 'PTW30013',
  cc_ref_serial: '0000',
  cc_ref_ndw: '0,05335',
  cc_ref_ndw_unit: 'Gy/nC',
  cc_T0: '20',
  cc_P0: '101,325',
  cc_ref_el_model: 'Электрометр (демо)',
  cc_ref_kelec: '1,000',

  cc_fld_model: 'ROOS',
  cc_fld_serial: '0001',
  cc_fld_el_model: 'Электрометр (демо)',
  cc_fld_kelec: '1,000',

  cc_T: '21,3',
  cc_P: '100,90',
  cc_P_unit: 'kPa',

  cc_ref_polarity: '+',
  cc_ref_V1: '300',
  cc_ref_V2: '100',
  cc_ref_M1: ['20,52', '20,53', '20,51'],
  cc_ref_Mopp: ['-20,55', '-20,54', '-20,56'],
  cc_ref_M2: ['20,45', '20,46', '20,44'],

  cc_fld_polarity: '+',
  cc_fld_V1: '300',
  cc_fld_V2: '100',
  cc_fld_M1: ['12,79', '12,80', '12,79'],
  cc_fld_Mopp: ['-12,83', '-12,82', '-12,84'],
  cc_fld_M2: ['12,75', '12,76', '12,75'],
};

// Текстовые поля демонстрационного набора по-английски (числа те же).
export const SAMPLE_CROSSCAL_EN = {
  cc_institution: 'Example',
  cc_machine: 'Linac (demo)',
  cc_beam: '18 MeV',
  cc_ref_el_model: 'Electrometer (demo)',
  cc_fld_el_model: 'Electrometer (demo)',
  cc_notes: 'Demo data, not results of real measurements.',
};
