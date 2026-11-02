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

  // по-английски — без кириллицы (пример загружается заново: подписи демо-набора по-английски)
  await page.click('#kv-btn-sample');
  await page.locator('#lang_en').check();
  await pause(600);
  assert.deepEqual(await cyrLines(page), []);
  assert.match(await page.locator('#kv-dose-rows').innerText(), /1\.0012\s*Gy\/min at 2 g\/cm²/);
  assert.match(await page.locator('#kv-s3').innerText(), /Exposure setting and timer error/);
  assert.match(await page.locator('#kv-eq-hint').innerText(), /Eq\. \(58\)/);
  await page.locator('#lang_ru').check();
  await pause(400);
  assert.match(await page.locator('#kv-dose-rows').innerText(), /1,0012\s*Гр\/мин/);
  assert.deepEqual(errors, []);
});
