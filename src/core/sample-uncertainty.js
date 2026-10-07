// Демонстрационный набор для инструмента «Неопределённость» (вымышленные данные): пучок 6 МВ, камера
// откалибрована в ⁶⁰Co, U из свидетельства 1,2 % (k = 2), три показания, итог 1,0045 Гр на 100 МЕ.
export const SAMPLE_UNC = {
  unc_institution: 'Пример',
  unc_machine: 'Линейный ускоритель (демо)',
  unc_beam: '6 МВ',
  unc_date: '2026-10-07',
  unc_staff: [''],
  unc_notes: 'Демонстрационные данные, не результаты реальных измерений.',
  unc_beam_type: 'photons',
  unc_ch_type: 'cyl',
  unc_route: 'lab',
  unc_r50: '',
  unc_sit: 'i',
  unc_cert_U: '1,2',
  unc_cert_k: '2',
  unc_M: ['12,346', '12,348', '12,345'],
  unc_value: '1,0045',
  unc_unit: 'Gy100MU',
  unc_over: '',
};

// Текстовые поля демонстрационного набора по-английски (числа те же).
export const SAMPLE_UNC_EN = {
  unc_institution: 'Example',
  unc_machine: 'Linear accelerator (demo)',
  unc_beam: '6 MV',
  unc_notes: 'Demo data, not results of real measurements.',
};
