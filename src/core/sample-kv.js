// Демонстрационный набор для kV-рентгена (средние энергии, N_D,w). Значения правдоподобны, но вымышлены.
import { KV_DEFAULTS } from './kv.js';

export const SAMPLE_KV = {
  ...KV_DEFAULTS,
  protocol: 'trs',
  kv_institution: 'Пример',
  kv_machine: 'Рентгенотерапевтический аппарат (демо)',
  kv_date: '2026-09-15',
  kv_staff: [''],
  kv_notes: 'Демонстрационные данные, не результаты реальных измерений.',

  kv_range: 'medium',
  kv_kv: '200',
  kv_filter: '0,5 мм Cu + 1 мм Al',
  kv_hvl: '1,00',
  kv_cone_shape: 'circle',
  kv_cone: '10',
  kv_ssd: '50',
  kv_phantom: 'water',

  kv_ch_model: 'PTW30013',
  kv_ch_serial: '0000',
  kv_cal: 'ndw',
  kv_qo: 'kv',
  kv_cert_form: 'kq',
  kv_n: '0,04530',
  kv_n_unit: 'Gy/nC',
  kv_cq_kv: ['100', '150', '200', '250'],
  kv_cq_hvl: ['0,20', '0,50', '1,05', '2,00'],
  kv_cq_val: ['0,987', '1,000', '1,006', '1,011'],
  kv_lab_shape: 'circle',
  kv_lab_f: '10',
  kv_lab_ssd: '100',
  kv_T0: '20',
  kv_P0: '101,325',
  kv_el_model: 'Электрометр (демо)',
  kv_kelec: '1,000',

  kv_env_T: '21,0',
  kv_env_H: '45',
  kv_env_P: '100,5',
  kv_env_P_unit: 'kPa',

  kv_set_unit: 'min',
  kv_set: '1,00',
  kv_timer_mode: 'measured',
  kv_tt: ['0,50', '1,00', '2,00'],
  kv_tm: ['11,08', '21,96', '43,68'],

  kv_V1: '400',
  kv_polarity: '+',
  kv_M1: ['21,95', '21,96', '21,95'],
  kv_Mopp: ['-21,93', '-21,94', '-21,93'],
  kv_kleak: '1,000',

  kv_Mc: ['21,96', '21,95', '21,96'],

  kv_pdd2: '88,6',
  kv_pdd_phantom: 'water',
  kv_ref: '0,9950',
  kv_ref_at: 'zref',
  kv_tol: '2',
};

// Текстовые поля демонстрационного набора по-английски (числа те же).
export const SAMPLE_KV_EN = {
  kv_institution: 'Example',
  kv_machine: 'Orthovoltage x-ray unit (demo)',
  kv_filter: '0.5 mm Cu + 1 mm Al',
  kv_el_model: 'Electrometer (demo)',
  kv_notes: 'Demo data, not results of real measurements.',
};

// Ещё два аппликатора того же пучка (строки 2 и 3 таблицы раздела 4): свои РИП, T, P, показания, PDD и значение для
// сравнения; серии при обратной полярности сняты только с первым тубусом — k_pol берётся из строки 1. Значения вымышлены.
export const SAMPLE_KV_ROWS = [
  {
    kv_cone_shape: 'rect',
    kv_cone: '6',
    kv_cone_b: '8',
    kv_ssd: '50',
    kv_set: '1,00',
    kv_env_T: '21,4',
    kv_env_H: '45',
    kv_env_P: '100,5',
    kv_M1: ['20,61', '20,62', '20,61'],
    kv_pdd2: '86,9',
    kv_ref: '0,9370',
  },
  {
    kv_cone_shape: 'circle',
    kv_cone: '15',
    kv_ssd: '50',
    kv_set: '1,00',
    kv_env_T: '21,8',
    kv_env_H: '44',
    kv_env_P: '100,4',
    kv_M1: ['22,93', '22,94', '22,94'],
    kv_pdd2: '90,1',
    kv_ref: '1,0420',
  },
];
