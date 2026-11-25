// Демонстрационный набор вкладки «Брахитерапия» (с 0.77.0): источник ¹⁹²Ir HDR, колодезная камера, фантом PTW 9193,
// максимум отклика, сличение, стабильность, распад и доза TG-43 — все листы заполнены одним днём измерений.
// Значения правдоподобны, но вымышлены; результаты сходятся с сертификатом в пределах допусков TRS-492.
import { BRACHY_DEFAULTS } from './brachy-sheets.js';
import { L } from './i18n.js';

/** Название источника примера: по нему вкладка узнаёт, что загружен пример. */
export const SAMPLE_BRACHY_SOURCE = { ru: 'Пример: ¹⁹²Ir HDR (демо), № 00000', en: 'Example: ¹⁹²Ir HDR (demo), No. 00000' };

/** Пример (текстовые поля — на языке страницы). */
export function sampleBrachy() {
  const hole = (T, P, M) => ({ T, P, M });
  return {
    ...structuredClone(BRACHY_DEFAULTS),
    nuclide: 'Ir-192',
    src_name: L(SAMPLE_BRACHY_SOURCE.ru, SAMPLE_BRACHY_SOURCE.en),
    cert_value: '40,10',
    cert_unit: 'mGy/h',
    cert_date: '2026-09-01',
    cert_time: '12:00',
    cert_U: '5',
    // колодезная камера
    w_model: 'PTW TW33004 SourceCheck 4π',
    w_serial: '000000',
    w_N: '4,850e5',
    w_N_unit: 'Gy·m2/(h·A)',
    w_NU: '1,4',
    w_ksm_mode: 'same',
    w_date: '2026-09-15',
    w_time: '10:00',
    w_T: '21,5',
    w_P: '998',
    w_P_unit: 'hPa',
    w_unit: 'nA',
    w_I: ['71,3', '71,4', '71,3', '71,4', '71,3'],
    w_I2: ['71,4', '71,3', '71,4', '71,3', '71,4'],
    w_I3: ['71,3', '71,4', '71,3', '71,3', '71,4'],
    w_pos: '1230',
    // фантом PTW 9193
    p_model: 'PTW 30013',
    p_serial: '000000',
    p_calib: 'Nw',
    p_N: '53,40',
    p_N_unit: 'mGy/nC',
    p_NU: '1,5',
    p_date: '2026-09-15',
    p_time: '11:00',
    p_tau: '1',
    p_P_unit: 'kPa',
    p_transit: '0,02',
    p_holes: [
      hole('21,5', '99,8', ['1,602', '1,603', '1,601']),
      hole('', '', ['1,596', '1,597', '1,595']),
      hole('', '', ['1,600', '1,599', '1,600']),
      hole('', '', ['1,598', '1,597', '1,599']),
    ],
    p_src: 'mhdr-v2',
    // максимум отклика
    s_x: ['1222,5', '1225', '1227,5', '1230', '1232,5', '1235', '1237,5'],
    s_M: ['70,90', '71,20', '71,40', '71,50', '71,45', '71,20', '70,85'],
    s_step: '2,5',
    s_unit: 'nA',
    s_ref: L('по пульту аппарата, от конца канала', 'by the console, from the channel end'),
    s_date: '2026-09-15',
    s_cert_pos: '1230',
    // распад
    d_basis: 'cert',
    d_at_date: '2026-09-15',
    d_at_time: '10:00',
    d_from: '2026-09-01',
    d_to: '2026-12-01',
    d_unit: 'w',
    // сличение: рабочая камера по эталонной (той же, что на листе «Колодезная камера»)
    x_ref_model: 'PTW TW33004 SourceCheck 4π',
    x_ref_serial: '000000',
    x_ref_N: '4,850e5',
    x_ref_I: ['71,0', '71,1', '71,0', '', ''],
    x_ref_T: '21,5',
    x_ref_P: '998',
    x_ref_date: '2026-09-15',
    x_ref_time: '12:00',
    x_fld_model: 'SI HDR 1000 Plus',
    x_fld_serial: 'A00000',
    x_fld_I: ['68,9', '68,8', '68,9', '', ''],
    x_fld_T: '21,6',
    x_fld_P: '998',
    x_fld_date: '2026-09-15',
    x_fld_time: '12:10',
    x_fld_prev: '4,990e5',
    // стабильность: контрольный источник ¹³⁷Cs
    st_method: 'check',
    st_check_nuclide: 'Cs-137',
    st_unit: 'pA',
    st_base: '25,40',
    st_base_date: '2026-01-15',
    st_base_time: '10:00',
    st_I: ['24,47', '24,48', '24,46', '24,49', '24,47'],
    st_T: '21,5',
    st_P: '998',
    st_P_unit: 'hPa',
    st_date: '2026-09-15',
    st_time: '09:30',
    // доза TG-43
    t_src: 'mhdr-v2',
    t_basis: 'well',
    t_date: '2026-09-15',
    t_time: '10:00',
    rec_notes: L('Демонстрационные данные, не результаты реальных измерений.', 'Demo data, not results of real measurements.'),
  };
}

/** Загружен ли пример (по названию источника). */
export const isBrachySample = (f) => Object.values(SAMPLE_BRACHY_SOURCE).includes(String(f?.src_name ?? ''));
