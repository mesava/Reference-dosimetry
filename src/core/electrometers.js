// Электрометры для выбора в «Журнал» → «Оборудование»: производитель → модель; «Другой» — своё название.
// Модель записывается в журнал одной строкой «производитель модель» (поле el_model), как и раньше при ручном вводе:
// старые журналы читаются без изменений, а строка, не найденная в списке, показывается как «другой» электрометр.
// Список — только для удобства ввода: на расчёт модель не влияет (k_elec — из свидетельства).

export const ELECTROMETERS = [
  { maker: 'PTW', models: ['UNIDOS webline', 'UNIDOS Tango', 'UNIDOS Romeo', 'UNIDOS E', 'UNIDOS', 'MULTIDOS'] },
  { maker: 'IBA', models: ['Dose 1', 'Dose 2', 'MagicMaX'] },
  { maker: 'Standard Imaging', models: ['SuperMAX', 'MAX 4000 Plus', 'MAX 4000'] },
  { maker: 'Sun Nuclear', models: ['PC Electrometer'] },
  { maker: 'Keithley', models: ['6517B', '35617EBS'] },
  { maker: 'NE', models: ['2670', '2570'] },
];

export const OTHER = 'other';

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Полное название «производитель модель». */
export const electrometerName = (maker, model) => [maker, model].filter(Boolean).join(' ');

/** Производитель и модель по строке el_model; не из списка — { maker: 'other', model: '' }. */
export function parseElectrometer(name) {
  const n = norm(name);
  if (!n) return { maker: '', model: '' };
  for (const g of ELECTROMETERS) {
    for (const m of g.models) if (norm(electrometerName(g.maker, m)) === n) return { maker: g.maker, model: m };
  }
  return { maker: OTHER, model: '' };
}
