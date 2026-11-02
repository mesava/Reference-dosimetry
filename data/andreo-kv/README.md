# Данные P. Andreo для kV-рентгена / Andreo data for kV x rays

| Файл | Содержание | Источник |
|---|---|---|
| `andreo_webapp.js` | B<sub>w</sub>(kV, РИП, поле, СПО) для СПО в мм Al и в мм Cu; [μ<sub>en</sub>/ρ]<sup>z=2</sup><sub>w,air</sub>(kV, РИП, поле, СПО в мм Cu) — по 16 × 5 × 8 × 32 узлов; [μ<sub>en</sub>/ρ]<sup>FIA</sup><sub>w,air</sub>(СПО) для мм Al и мм Cu | Файлы данных веб-приложения МАГАТЭ kvx-rays.iaea.org, переданы автором P. Andreo 1 октября 2026 г. |

`andreo_webapp.js` — это файл `data/andreo_webapp.json` репозитория [mesava/kV-x-rays-data](https://github.com/mesava/kV-x-rays-data) без изменений, обёрнутый в модуль JavaScript (`export default <JSON>;`), чтобы страница на сервере могла загрузить его как обычный модуль. JSON получен из исходных файлов `Bw_HVL-AL_.dat`, `Bw_HVL-CU_.dat`, `muen2_HVL-CU_.dat`, `muenFIA_HVL-AL_.dat`, `muenFIA_HVL-CU_.dat` (значения округлены до 9 знаков после запятой); сами исходные файлы в репозиторий не входят.

SHA-256 исходного JSON (текст между `export default ` и завершающим `;`): `bb205edb33b158f929a7759e0fdfeea93ad3bd3e08843f12f0325a47d0a9ee03`. Тест `tests/kv-data.test.js` проверяет, что файл не изменился, и что калькулятор (`src/core/kvx.js`) на этих данных повторяет веб-приложение МАГАТЭ во всех 117 контрольных точках до 4-го знака.

## Условия использования

Лицензия AGPL калькулятора на эти данные **не распространяется**. Данные используются в калькуляторе с разрешения их автора, P. Andreo, на двух условиях:

1. **Только некоммерческое использование** — ни напрямую, ни через передачу файлов кому-либо для коммерческих целей.
2. **Обязательная ссылка на источник:**
   P Andreo (2019) Data for the dosimetry of low- and medium-energy kV x rays. Phys. Med. Biol., 64:205019. doi:[10.1088/1361-6560/ab421d](https://doi.org/10.1088/1361-6560/ab421d)

Эти условия действуют для любого, кто использует калькулятор, файлы из этой папки или собранный файл `dist/index.html`, в который они встроены.

## Terms of use

The AGPL license of the calculator does **not** apply to these data. They are the data files of the IAEA web app kvx-rays.iaea.org, provided by their author, P. Andreo, on 1 October 2026, and are used in this calculator with his permission on two conditions:

1. **Non-commercial use only**, neither directly nor by transferring the files to anyone for commercial purposes.
2. **The source must be cited:**
   P Andreo (2019) Data for the dosimetry of low- and medium-energy kV x rays. Phys. Med. Biol., 64:205019. doi:[10.1088/1361-6560/ab421d](https://doi.org/10.1088/1361-6560/ab421d)

These conditions apply to anyone who uses the calculator, the files in this folder, or the built file `dist/index.html` that embeds them.
