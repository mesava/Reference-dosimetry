// Вкладка «kV-рентген» (TRS-398 Rev.1, разд. 8 и 9): пустая вкладка без примера, пример (средние энергии, N_D,w,
// k_g по ур. 90 — данные Andreo со ссылкой), низкие энергии с k_g по табл. 28, квадратный тубус, k_g = 1 — пометка
// «не по TRS-398 Rev.1», сохранение и открытие файла со сверкой итога, протокол текстом; по-английски без кириллицы.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startServer, launch, openPage, CYR } from './helpers.js';

let server;
let browser;
before(async () => {
  server = await startServer();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

/** Строки текста модуля с кириллицей (кроме строки состояния и подписей, введённых пользователем). */
const cyrLines = async (page) =>
  (await page.locator('#kv-sheet, #kv-readout').evaluateAll((els) => els.map((e) => e.innerText).join('\n')))
    .split('\n')
    .filter((l) => /[А-Яа-яЁё]/.test(l) && !/Загружен демонстрационный пример/.test(l));

test('kV-рентген: пример, ветки расчёта, пометка «не по Rev.1», файл и протокол; по-английски', async () => {
  const { ctx, page, errors } = await openPage(browser);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const pause = (ms = 400) => page.waitForTimeout(ms);

  // пустая вкладка: пример только по кнопке; переключателя протокола нет (только TRS-398 Rev.1); метки «в разработке» нет
  await page.goto(`${server.url}/index.html#kv`);
  await page.waitForSelector('#kv-messages li');
  assert.equal(await page.inputValue('#kv_kv'), '');
  assert.ok(await page.locator('#kv-demo-flag').isHidden());
  assert.match(await page.locator('#kv-status').innerText(), /Загрузить пример/);
  assert.ok(await page.locator('.protocol-switch').isHidden());
  assert.equal(await page.locator('#module-kv .subtools a[data-module="kv"] .wip-tag').count(), 0);
  assert.equal(await page.locator('.subtools a[data-module="kv"].wip-link').count(), 0);
  assert.match(await page.locator('#kv-mobile-value').innerText(), /Ошибок: \d+/);

  // пример: средние энергии, PTW 30013, N_D,w; k_g по ур. (90) — данные Andreo со ссылкой
  await page.click('#kv-btn-sample');
  await pause();
  const dose = await page.locator('#kv-dose-rows').innerText();
  assert.match(dose, /ур\. \(58\)/);
  assert.match(dose, /1,0012\s*Гр\/мин на 2 г\/см²/);
  assert.match(dose, /\+0,62 %/);
  assert.match(dose, /На поверхности \(через PDD\): 1,1300 Гр\/мин/);
  assert.match(await page.locator('#kv-compliance').innerText(), /отступлений от условий TRS-398 Rev\.1 не найдено/);
  assert.ok(await page.locator('#kv-notrev1-flag').isHidden());
  assert.match(await page.locator('#kv-andreo-cite').innerText(), /Andreo P 2019.*205019/);
  assert.match(await page.locator('#kv-kg-sub').innerText(), /ур\. \(90\)/);
  assert.equal(await page.locator('#module-kv output[data-out="cert.NQ"]').innerText(), '0,045554');
  assert.match(await page.locator('#kv-factors').innerText(), /kg\s+0,9999/);
  assert.match(await page.locator('#module-kv .inline-result').first().innerText(), /итог 1,0012 Гр\/мин на 2 г\/см²/i);
  assert.ok(await page.locator('#kv_qo').isVisible());
  assert.ok(await page.locator('#kv_pdd2').isVisible());
  // справочное сравнение для N_D,w: DIN 6809-4 и SSRMP No 9 без k_g; на итог не влияет
  const pc = await page.locator('#kv-proto-cmp').innerText();
  assert.match(pc, /Справочно · DIN 6809-4 и SSRMP No 9/);
  assert.match(pc, /1,0013\s*Гр\/мин на 2 г\/см²/);
  assert.match(pc, /\+0,01 %/);
  assert.match(await page.locator('#kv-pc-table').innerText(), /Отношение доз DIN \/ SSRMP \/ Rev\.1\s+1,0001/);

  // протокол текстом
  await page.click('#kv-btn-copy-report');
  await pause(300);
  const report = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /ПРОТОКОЛ РЕФЕРЕНСНОЙ ДОЗИМЕТРИИ — kV-РЕНТГЕН/);
  assert.match(report, /TRS-398 Rev\.1, ур\. \(58\) \(разд\. 9, средние энергии\)/);
  assert.match(report, /0,20 мм Cu → 0,987/);
  assert.match(report, /k_g = 0,9999 \(ур\. \(90\)/);
  assert.match(report, /1,0012 Гр\/мин; значение для сравнения 0,9950 Гр\/мин на 2 г\/см², отклонение \+0,62 %/);
  assert.match(report, /Andreo P 2019/);
  assert.match(report, /— Справочно: DIN 6809-4 и SSRMP No 9, k_g = 1 \(на итог не влияет\) —\n1,0013 Гр\/мин на 2 г\/см²; отличие от TRS-398 Rev\.1 \+0,01 %/);

  // сохранить и открыть файл: итог сверяется с сохранённым
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#kv-btn-save')]);
  const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(saved.module, 'kv');
  assert.equal(saved.form.kv_cq_hvl.length, 4);
  assert.ok(Math.abs(saved.result.value - 1.0012) < 1e-4);
  await page.click('#kv-btn-clear');
  await page.click('#kv-btn-clear');
  await pause();
  assert.equal(await page.inputValue('#kv_kv'), '');
  await page.setInputFiles('#kv-file-input', await download.path());
  await pause();
  assert.equal(await page.inputValue('#kv_kv'), '200');
  assert.equal(await page.inputValue('#kv_cq_hvl_3'), '2,00');
  assert.match(await page.locator('#kv-file-note').innerText(), /совпадает с сохранённым итогом/);
  // файл другой вкладки не открывается
  await page.setInputFiles('#kv-file-input', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...saved, module: 'cobalt' })) });
  await pause(200);
  assert.match(await page.locator('#kv-status').innerText(), /файл другого раздела/);

  // низкие энергии, N_D,w: PTW 23342 на ПММА, поверка N_Д × K, лаборатория Ø 3 см / РИП 30 см → k_g по табл. 28
  const cert = async (rows) => {
    while ((await page.locator('#kv-cert-rows .pair-row').count()) > rows.length) await page.click('#kv-cert-remove');
    for (let i = 0; i < rows.length; i++) {
      await page.fill(`#kv_cq_kv_${i}`, rows[i][0]);
      await page.fill(`#kv_cq_hvl_${i}`, rows[i][1]);
      await page.fill(`#kv_cq_val_${i}`, rows[i][2]);
    }
  };
  await page.selectOption('#kv_range', 'low');
  await page.fill('#kv_kv', '50');
  await page.fill('#kv_hvl', '1,0');
  await page.fill('#kv_cone', '5');
  await page.fill('#kv_ssd', '30');
  await page.selectOption('#kv_ch_model', 'PTW23342');
  await page.check('#kv_foil');
  await page.selectOption('#kv_cert_form', 'k');
  await page.fill('#kv_n', '1,250');
  await cert([['30', '0,36', '1,000'], ['50', '1,0', '1,012'], ['70', '2,9', '1,025']]);
  await page.fill('#kv_lab_f', '3');
  await page.fill('#kv_lab_ssd', '30');
  await page.fill('#kv_ref', '');
  await pause();
  assert.ok(await page.locator('#kv_qo').isHidden());
  assert.ok(await page.locator('#kv_pdd2').isHidden());
  assert.equal(await page.locator('#kv-lbl-hvl').innerText(), 'СПО, мм Al');
  assert.match(await page.locator('#kv-dose-rows').innerText(), /ур\. \(52\)[\s\S]*на поверхности/);
  assert.match(await page.locator('#kv-kg-sub').innerText(), /табл\. 28/);
  assert.ok(await page.locator('#kv-kg-bykv').isVisible());
  assert.equal(await page.locator('#module-kv output[data-out="trs.kg.byKv"]').innerText(), '0,9800');
  assert.ok(await page.locator('#kv-andreo-cite').isHidden(), 'табл. 28 — без данных Andreo');
  assert.match(await page.locator('#kv-compliance').innerText(), /не найдено/);

  // квадратный тубус → круг той же площади
  await page.selectOption('#kv_cone_shape', 'square');
  await pause();
  assert.equal(await page.locator('#kv-lbl-cone').innerText(), 'Сторона поля, см');
  assert.equal(await page.locator('#module-kv output[data-out="inputs.fClin"]').innerText(), '5,64');
  assert.match(await page.locator('#kv-messages').innerText(), /заменено кругом равной площади диаметром 5,64 см/);

  // k_g = 1 при другом поле — не по TRS-398 Rev.1: пометка над итогом и нестандартные условия
  await page.selectOption('#kv_kg_src', 'one');
  await pause();
  assert.ok(await page.locator('#kv-notrev1-flag').isVisible());
  assert.match(await page.locator('#kv-notrev1-flag').innerText(), /Расчёт не по TRS-398 Rev\.1: kg = 1/);
  assert.match(await page.locator('#kv-compliance').innerText(), /Нестандартные условия/);

  // воздушный метод, средние энергии: p_ch по табл. 32, [μen/ρ]z=2 по данным Andreo
  await page.selectOption('#kv_kg_src', 'auto');
  await page.selectOption('#kv_cone_shape', 'circle');
  await page.selectOption('#kv_range', 'medium');
  await page.fill('#kv_kv', '200');
  await page.fill('#kv_hvl', '1,0');
  await page.fill('#kv_cone', '10');
  await page.fill('#kv_ssd', '50');
  await page.selectOption('#kv_ch_model', 'PTW30013');
  await page.selectOption('#kv_cal', 'nk');
  await page.selectOption('#kv_cert_form', 'kq');
  await page.fill('#kv_n', '0,045');
  await cert([['150', '0,5', '0,995'], ['200', '1', '1,000'], ['250', '2', '1,010']]);
  await pause();
  assert.match(await page.locator('#kv-dose-rows').innerText(), /ур\. \(57\)/);
  assert.match(await page.locator('#kv-pch-sub').innerText(), /табл\. 32/);
  // табл. 32, PTW 30013: между 0,838 и 1,581 мм Cu по ln(СПО)
  assert.equal(await page.locator('#module-kv output[data-out="trs.phys.pch"]').innerText(), '1,0146');
  assert.ok(await page.locator('#kv-pch-field').isHidden());
  assert.ok(await page.locator('#kv-andreo-cite').isVisible());
  // TG-61, метод в фантоме: PTW 30013 нет в табл. VIII — нужен P_Q,cham из литературы; с ним — отличие от Rev.1
  assert.match(await page.locator('#kv-proto-cmp').innerText(), /TG-61, метод в фантоме на 2 см[\s\S]*не посчитано: камеры PTW 30013 нет в табл\. VIII/);
  assert.ok(await page.locator('#kv_tg61_pq').isVisible());
  await page.fill('#kv_tg61_pq', '1,020');
  await pause();
  assert.match(await page.locator('#kv-proto-cmp').innerText(), /[+−]\d,\d\d %/);
  assert.match(await page.locator('#kv-pc-table').innerText(), /Камера в фантоме[\s\S]*1,0200\s+введён вручную[\s\S]*1,0146/);
  // камера из табл. VIII: поле P_Q,cham не нужно
  await page.selectOption('#kv_ch_model', 'NE2571');
  await pause();
  assert.ok(await page.locator('#kv_tg61_pq').isHidden());
  assert.match(await page.locator('#kv-pc-table').innerText(), /табл\. VIII \(NE2571\)/);

  // по-английски — без кириллицы (пример загружается заново: подписи демо-набора по-английски)
  await page.click('#kv-btn-sample');
  await page.locator('#lang_en').check();
  await pause(600);
  assert.deepEqual(await cyrLines(page), []);
  assert.match(await page.locator('#kv-dose-rows').innerText(), /1\.0012\s*Gy\/min at 2 g\/cm²/);
  assert.match(await page.locator('#kv-s3').innerText(), /Exposure setting and timer error/);
  assert.match(await page.locator('#kv-eq-hint').innerText(), /Eq\. \(58\)/);
  assert.match(await page.locator('#kv-proto-cmp').innerText(), /For reference · DIN 6809-4 and SSRMP No 9/);
  // ветка N_K по-английски: строка TG-61 с причиной и поле P_Q,cham — без кириллицы
  await page.selectOption('#kv_cal', 'nk');
  await pause();
  assert.match(await page.locator('#kv-proto-cmp').innerText(), /not calculated: PTW 30013 is not in TG-61 Table VIII/);
  assert.deepEqual(await cyrLines(page), []);
  await page.selectOption('#kv_cal', 'ndw');
  await page.locator('#lang_ru').check();
  await pause(400);
  assert.match(await page.locator('#kv-dose-rows').innerText(), /1,0012\s*Гр\/мин/);
  assert.deepEqual(errors, []);
});

test('kV-рентген → «Неопределённость»: перенос с вкладки, табл. 33 и 30, k_g = 1 — пометка «не по Rev.1»; по-английски', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 400) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#kv`);
  await page.waitForSelector('#kv-messages li');
  await page.click('#kv-btn-sample');
  await pause();
  // точность в протоколе вкладки отсылает к бюджету на вкладке «Неопределённость»
  assert.match(await page.locator('#kv-sign').textContent(), /бюджет неопределённости составляется на вкладке «Неопределённость»/);

  await page.evaluate(() => (location.hash = '#uncertainty'));
  await page.waitForSelector('#unc-result .dose-big');
  await page.locator('[data-pull="kv"]').click();
  await pause();
  assert.ok(await page.locator('#unc_beam_type_kv').isChecked());
  assert.equal(await page.inputValue('#unc_kv_range'), 'medium');
  assert.equal(await page.inputValue('#unc_kv_cal'), 'ndw');
  assert.equal(await page.inputValue('#unc_kv_qo'), 'kv');
  assert.equal(await page.inputValue('#unc_kv_kg'), 'calc');
  assert.equal(await page.inputValue('#unc_value'), '1,0012');
  assert.equal(await page.inputValue('#unc_unit'), 'Gymin');
  assert.match(await page.inputValue('#unc_beam'), /200 кВ, СПО 1,000 мм Cu/);
  assert.ok(await page.locator('#unc_route').isHidden());
  assert.ok(await page.locator('#unc_value_at').isHidden());
  const res = await page.locator('#unc-result').innerText();
  assert.match(res, /kV-рентген · TRS-398 Rev\.1/);
  assert.match(res, /табл\. 33 — kV-рентген средних энергий, калибровка N_D,w/);
  assert.match(await page.locator('#unc-budget').innerText(), /Поправочный коэффициент на геометрию kg/);
  assert.match(await page.locator('#unc-ki').innerText(), /Для kV-рентгена раскрытия нет/);
  assert.match(await page.locator('#unc-status').innerText(), /Данные взяты с вкладки «kV-рентген»/);
  // свидетельство демонстрационного примера перенос не трогает; без него — типовой бюджет табл. 33
  assert.match(res, /с U из свидетельства/);
  await page.fill('#unc_cert_U', '');
  await pause();
  assert.match(await page.locator('#unc-result').innerText(), /uc = 1,81 %[\s\S]*типовой бюджет|типовой бюджет[\s\S]*uc = 1,81 %/);

  // низкие энергии, k_g = 1 при другом поле — оценка DIN 6809-4, предупреждение «не TRS-398 Rev.1»
  await page.selectOption('#unc_kv_range', 'low');
  await page.selectOption('#unc_kv_kg', 'one');
  await pause();
  assert.ok(await page.locator('#unc_kv_qo').isHidden());
  assert.match(await page.locator('#unc-result').innerText(), /табл\. 30 — kV-рентген низких энергий/);
  assert.match(await page.locator('#unc-messages').innerText(), /kg = 1 при другом поле или РИП — подход DIN 6809-4/);
  assert.match(await page.locator('#unc-budget').innerText(), /Поправочный коэффициент на геометрию kg[\s\S]*?DIN 6809-4:2020, разд\. 6\.3, 6\.4[\s\S]*?2,00/);
  // N_K: строки μen/ρ и B_w вместо k_g, поле k_g скрыто
  await page.selectOption('#unc_kv_cal', 'nk');
  await pause();
  assert.ok(await page.locator('#unc_kv_kg').isHidden());
  assert.match(await page.locator('#unc-budget').innerText(), /Коэффициент обратного рассеяния Bw/);
  assert.match(await page.locator('#unc-result').innerText(), /uc = 1,94 %/);

  // протокол текстом
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#unc-btn-copy-report');
  await pause(300);
  const report = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /— KV-РЕНТГЕН/);
  assert.match(report, /Калибровка камеры: N_K — воздушная керма в свободном воздухе/);
  assert.match(report, /TRS-398 Rev\.1, табл\. 30/);

  // по-английски — без кириллицы в форме и итоге (кроме данных, введённых пользователем)
  await page.locator('#lang_en').check();
  await pause(600);
  const status = (await page.locator('#unc-status').innerText()).trim();
  const cyr = (await page.locator('#unc-sheet, #unc-readout').evaluateAll((els) => els.map((e) => e.innerText).join('\n')))
    .split('\n')
    .filter((l) => CYR.test(l))
    // строка состояния остаётся на языке, на котором её написали
    .filter((l) => l.trim() !== status);
  assert.deepEqual(cyr, []);
  assert.match(await page.locator('#unc-result').innerText(), /kV x-rays · TRS-398 Rev\.1/);
  assert.match(await page.locator('#unc-result').innerText(), /Table 30 — low-energy kV x-rays, N_K calibration/);
  await page.locator('#lang_ru').check();
  await pause(300);
  assert.deepEqual(errors, []);
});

test('kV-рентген: камера только с ⁶⁰Co — k_Q = 1 с пометкой «не по Rev.1 и не по DIN»; перенос в «Неопределённость»', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 400) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#kv`);
  await page.waitForSelector('#kv-messages li');
  await page.click('#kv-btn-sample');
  await pause();
  // вариант доступен только при Qo = ⁶⁰Co
  const coOpt = page.locator('#kv_cert_form option[value="co"]');
  assert.equal(await coOpt.evaluate((o) => o.disabled), true);
  await page.selectOption('#kv_qo', 'co60');
  await pause(200);
  assert.equal(await coOpt.evaluate((o) => o.disabled), false);
  await page.selectOption('#kv_cert_form', 'co');
  await page.fill('#kv_n', '0,05389');
  await pause();
  // таблица качеств, поле и РИП лаборатории не нужны; выбор k_g недоступен
  assert.ok(await page.locator('#kv_cert').isHidden());
  assert.ok(await page.locator('#kv_lab_f').isHidden());
  assert.ok(await page.locator('#kv_n').isVisible());
  assert.match(await page.locator('#kv-n-sub').innerText(), /калибровки в рентгене нет/);
  assert.ok(await page.locator('#kv_kg_src').isDisabled());
  assert.match(await page.locator('#kv-kg-sub').innerText(), /калибровки в рентгене нет/);
  assert.equal(await page.locator('#module-kv output[data-out="cert.value"]').innerText(), '1,0000');
  assert.equal(await page.locator('#module-kv output[data-out="cert.NQ"]').innerText(), '0,053890');
  assert.match(await page.locator('#kv-factors').innerText(), /kQ принят равным 1 \(калибровки в рентгене нет\)\s+1,0000/);
  // пометки: итог, условия, замечания; справочного сравнения с DIN нет
  assert.match(await page.locator('#kv-notrev1-flag').innerText(), /k_Q = 1: камера откалибрована только в ⁶⁰Co|kQ = 1: камера откалибрована только в ⁶⁰Co/);
  assert.match(await page.locator('#kv-compliance').innerText(), /только в ⁶⁰Co, kQ = 1 — ни TRS-398 Rev\.1, ни DIN 6809-4/);
  assert.match(await page.locator('#kv-messages').innerText(), /ни TRS-398 Rev\.1 \(разд\. 9\.2\.1\), ни DIN 6809-4 \(разд\. 6\.4\.2\)/);
  assert.match(await page.locator('#kv-proto-cmp').innerText(), /требует kQ,M из калибровки в рентгене/);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#kv-btn-copy-report');
  await pause(300);
  const report = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /калибровки в рентгене нет, k_Q = 1 \(не по Rev\.1 и DIN 6809-4\)/);
  assert.ok(!/Калибровка в лаборатории:/.test(report));

  // перенос в «Неопределённость»: строка k_Q = 1 без типового значения, предупреждение
  await page.evaluate(() => (location.hash = '#uncertainty'));
  await page.waitForSelector('#unc-result .dose-big');
  await page.locator('[data-pull="kv"]').click();
  await pause();
  assert.equal(await page.inputValue('#unc_kv_qo'), 'co60');
  assert.equal(await page.inputValue('#unc_kv_kq'), 'one');
  assert.equal(await page.inputValue('#unc_kv_kg'), 'one');
  assert.match(await page.locator('#unc-budget').innerText(), /kQ = 1: калибровки камеры в рентгене нет[\s\S]*?не TRS-398 Rev\.1 и не DIN 6809-4\s+как получено\t—\t\t—/);
  assert.match(await page.locator('#unc-messages').innerText(), /не по TRS-398 Rev\.1 и не по DIN 6809-4[\s\S]*uc занижена/);
  await page.selectOption('#unc_kv_qo', 'kv');
  await pause();
  assert.ok(await page.locator('#unc_kv_kq').isHidden());
  assert.ok(!/калибровки камеры в рентгене нет/.test(await page.locator('#unc-budget').innerText()));

  // по-английски — без кириллицы на вкладке kV
  await page.evaluate(() => (location.hash = '#kv'));
  await page.locator('#lang_en').check();
  await pause(600);
  // строка состояния («Протокол скопирован…») остаётся на языке, на котором её написали
  const status = (await page.locator('#kv-status').innerText()).trim();
  assert.deepEqual((await cyrLines(page)).filter((l) => l.trim() !== status), []);
  assert.match(await page.locator('#kv-notrev1-flag').innerText(), /calibrated in ⁶⁰Co only/);
  await page.locator('#lang_ru').check();
  await pause(300);
  assert.deepEqual(errors, []);
});
