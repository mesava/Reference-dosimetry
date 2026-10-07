// Демонстрационные наборы для перекрёстной калибровки. Значения правдоподобны, но вымышлены.
import { CC_DEFAULTS } from './crosscal.js';

const NOTE_RU = 'Демонстрационные данные, не результаты реальных измерений.';
const NOTE_EN = 'Demo data, not results of real measurements.';

// электроны: Roos по Фармеру в пучке 18 МэВ
export const SAMPLE_CROSSCAL = {
  ...CC_DEFAULTS,
  protocol: 'trs',
  cc_beam_type: 'electrons',
  cc_institution: 'Пример',
  cc_machine: 'Ускоритель (демо)',
  cc_beam: '18 МэВ',
  cc_date: '2026-09-15',
  cc_staff: [''],
  cc_notes: NOTE_RU,

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

// МВ фотоны: Фармер IBA FC65-G по PTW 30013 в пучке 6 МВ, с внешним монитором
export const SAMPLE_CROSSCAL_PHOTONS = {
  ...SAMPLE_CROSSCAL,
  cc_beam_type: 'photons',
  cc_beam: '6 МВ',
  cc_tpr_method: 'tpr',
  cc_tpr: '0,670',
  cc_fff: false,
  cc_method: 'sub',
  cc_monitor: true,
  cc_fld_model: 'FC65G',
  cc_ref_M1: ['12,49', '12,50', '12,49'],
  cc_ref_Mem: ['5,012', '5,015', '5,011'],
  cc_ref_Mopp: ['-12,50', '-12,50', '-12,51'],
  cc_ref_M2: ['12,47', '12,47', '12,46'],
  cc_fld_M1: ['13,85', '13,84', '13,85'],
  cc_fld_Mem: ['5,020', '5,018', '5,021'],
  cc_fld_Mopp: ['-13,86', '-13,86', '-13,85'],
  cc_fld_M2: ['13,82', '13,82', '13,81'],
};

// ⁶⁰Co: Exradin A19 по PTW 30013, z_ref = 5 г/см², облучение 1 мин
export const SAMPLE_CROSSCAL_CO60 = {
  ...SAMPLE_CROSSCAL,
  cc_beam_type: 'co60',
  cc_machine: 'Аппарат ⁶⁰Co (демо)',
  cc_beam: '⁶⁰Co',
  cc_co_zref: '5',
  cc_time: '1',
  cc_rec_co: 'eq13',
  cc_method: 'sub',
  cc_monitor: false,
  cc_fld_model: 'A19',
  cc_ref_M1: ['17,65', '17,66', '17,65'],
  cc_ref_Mopp: ['-17,66', '-17,67', '-17,66'],
  cc_ref_M2: ['17,64', '17,64', '17,63'],
  cc_fld_M1: ['17,72', '17,71', '17,72'],
  cc_fld_Mopp: ['-17,73', '-17,73', '-17,72'],
  cc_fld_M2: ['17,71', '17,70', '17,71'],
};

export const SAMPLES_CROSSCAL = { electrons: SAMPLE_CROSSCAL, photons: SAMPLE_CROSSCAL_PHOTONS, co60: SAMPLE_CROSSCAL_CO60 };

// Текстовые поля демонстрационных наборов по-английски (числа те же).
export const SAMPLE_CROSSCAL_EN = {
  cc_institution: 'Example',
  cc_machine: 'Linac (demo)',
  cc_beam: '18 MeV',
  cc_ref_el_model: 'Electrometer (demo)',
  cc_fld_el_model: 'Electrometer (demo)',
  cc_notes: NOTE_EN,
};
export const SAMPLES_CROSSCAL_EN = {
  electrons: SAMPLE_CROSSCAL_EN,
  photons: { ...SAMPLE_CROSSCAL_EN, cc_beam: '6 MV' },
  co60: { ...SAMPLE_CROSSCAL_EN, cc_machine: '⁶⁰Co unit (demo)', cc_beam: '⁶⁰Co' },
};
