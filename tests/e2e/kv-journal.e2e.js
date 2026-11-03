// Вкладка «kV-рентген» ↔ «Оборудование» (0.42.0): блок «Журнал отделения» на листе «Аппарат и режимы».
// «Сохранить аппарат в Оборудование» заводит аппарат с режимами, аппликаторами, камерой (с kV-сертификатом) и
// электрометром вкладки; повторное сохранение обновляет режимы и спрашивает про другой СПО; выбор аппарата и
// «Подставить отмеченные режимы» заполняют вкладку из «Оборудования» (поверх показаний — со второго нажатия);
// демонстрационный пример не сохраняется; «вручную» снимает связь; камера только для kV — в «Оборудовании».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage, kvPage, CYR } from './helpers.js';

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

const jb = (page, k) => page.locator(`#kv-jbind [data-kvj="${k}"]`);
const status = (page) => page.locator('#kv-status').innerText();

test('kV-рентген ↔ «Оборудование»: сохранить аппарат, вопрос о СПО, подставить режимы', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv-messages li');
  // пустой журнал: ручной ввод, сохранение заведёт аппарат
  assert.deepEqual(await jb(page, 'machine').locator('option').allTextContents(), ['вручную — разовая проверка']);
  assert.match(await page.locator('#kv-jbind').innerText(), /рентгенотерапевтических аппаратов нет: вкладка заполняется вручную/);

  // демонстрационный пример в «Оборудование» не сохраняется
  await page.click('#kv-btn-sample');
  await pause();
  await jb(page, 'save').click();
  await pause();
  assert.match(await status(page), /демонстрационный пример: в «Оборудование» он не сохраняется/);

  // свои данные (пример с другим аппаратом): аппарат, 2 режима, 3 аппликатора, камера с kV-сертификатом, электрометр
  await page.fill('#kv_machine', 'Xstrahl 300');
  await page.fill('#kv_institution', 'Клиника');
  await pause();
  await jb(page, 'save').click();
  await pause();
  assert.match(await status(page), /^Аппарат «Xstrahl 300» сохранён в «Оборудование»: добавлен аппарат «Xstrahl 300»; режимов добавлено: 2; аппликаторов добавлено: 3; камеры добавлены: PTW 30013 № 0000; электрометры добавлены: Электрометр \(демо\)\./);
  // вкладка связана с аппаратом: он выбран, режимы — с флажками
  assert.equal(await jb(page, 'machine').locator('option:checked').innerText(), 'Xstrahl 300');
  assert.equal(await page.locator('#kv-jbind [data-kvj-mode]').count(), 2);
  assert.match(await page.locator('#kv-jbind .kvj-modes').innerText(), /Режим 1 — 200 кВ \/ 10 мА \/ 0,5 мм Cu \+ 1 мм Al: СПО 1,00 мм Cu; PTW 30013 № 0000; аппликаторов 3, референсный Ø 10 см, РИП 50 см/);

  // повторное сохранение с другим СПО — вопрос; «Оставить» не меняет СПО, «Заменить» — меняет
  await page.fill('#kv_hvl', '1,10');
  await pause();
  await jb(page, 'save').click();
  await pause();
  assert.match(await page.locator('#kv-jbind .kvj-ask').innerText(), /СПО в «Оборудовании» другой: режим 1 — 1,00 → 1,10 мм Cu \(номинальный\)\. Заменить значениями вкладки\?/);
  assert.ok(await jb(page, 'save').isDisabled());
  await jb(page, 'save-keep').click();
  await pause();
  assert.match(await status(page), /режимов обновлено: 2\. Сохраните журнал/);
  assert.equal(await page.locator('#kv-jbind .kvj-ask').count(), 0);
  assert.match(await page.locator('#kv-jbind .kvj-modes').innerText(), /СПО 1,00 мм Cu/);
  await jb(page, 'save').click();
  await pause();
  await jb(page, 'save-hvl').click();
  await pause();
  assert.match(await page.locator('#kv-jbind .kvj-modes').innerText(), /СПО 1,10 мм Cu/);

  // «Оборудование»: аппарат с режимами и аппликаторами; у камеры — kV-сертификат
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('.jcard.jkv');
  const card = page.locator('.jcard.jkv');
  assert.equal(await card.locator('.jkv-mode').count(), 2);
  assert.equal(await card.locator('table.jkv-apps-t tbody tr').count(), 3);
  assert.equal(await card.locator('.jkv-mode').first().locator('select[data-bind$="|refApplicator"] option:checked').innerText(), 'Ø 10 см, РИП 50 см — по Rev.1');
  const ch = page.locator('[data-card^="chamber:"]');
  assert.match(await ch.innerText(), /kV-сертификат\s+ND,w; NQo и kQ по качествам — 4 точки; СПО 0,20–2,00 мм; поле лаборатории Ø 10 см, РИП 100 см\./);
  // цилиндрическая камера из табл. 32 — и для kV-рентгена (подпись модели и пометка в списке моделей)
  assert.match(await ch.locator('.field', { hasText: 'Модель' }).innerText(), /для фотонов, электронов, ⁶⁰Co и kV-рентгена/);
  assert.match(await ch.locator('select[data-bind$="|form.ch_model"] option:checked').innerText(), /· и для kV-рентгена$/);
  // камера с kV-сертификатом без пучков МВ — N_D,w в ⁶⁰Co не требуется
  assert.doesNotMatch(await ch.locator('.jcard-head').innerText(), /не заполнено/);
  // в списке моделей — камеры только для kV-рентгена
  await page.click('#eq-add-chamber');
  await pause();
  const ch2 = page.locator('[data-card^="chamber:"]').nth(1);
  await ch2.locator('select[data-bind$="|maker"]').selectOption('PTW');
  await pause();
  await ch2.locator('select[data-bind$="|form.ch_model"]').selectOption('PTW23342');
  await pause();
  assert.match(await ch2.innerText(), /для kV-рентгена/);
  assert.match(await ch2.innerText(), /kV-сертификат\s+Пока не введён\./);
  assert.match(await ch2.locator('.jcard-head b').innerText(), /^PTW 23342/);

  // вкладка: аппарат выбран; отметить только режим 1 и подставить поверх показаний — со второго нажатия
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv-jbind [data-kvj-mode]');
  await page.locator('#kv-jbind [data-kvj-mode]').nth(1).uncheck();
  await pause();
  await jb(page, 'fill').click();
  await pause();
  assert.equal(await jb(page, 'fill').innerText(), 'Нажмите ещё раз: показания вкладки заменятся');
  await jb(page, 'fill').click();
  await pause();
  assert.match(await status(page), /^Подставлены режимы аппарата «Xstrahl 300»: 1\./);
  assert.equal(await page.locator('#kv-modes tr').count(), 1);
  assert.equal(await page.inputValue('#kv_kv'), '200');
  assert.equal(await page.inputValue('#kv_hvl'), '1,10');
  assert.equal(await page.inputValue('#kv_machine'), 'Xstrahl 300');
  // камера и kV-сертификат — из записи камеры, электрометр — из записи электрометра
  assert.equal(await page.inputValue('#kv_ch_model'), 'PTW30013');
  assert.equal(await page.inputValue('#kv_ch_serial'), '0000');
  assert.equal(await page.inputValue('#kv_n'), '0,04530');
  assert.equal(await page.inputValue('#kv_el_model'), 'Электрометр (демо)');
  // строки — аппликаторы режима без показаний; выбрана строка референсного
  await kvPage(page, 'dose');
  assert.equal(await page.locator('#kv-rows-body tr').count(), 3);
  assert.equal(await page.getAttribute('#kv-rows-body tr.active', 'data-i'), '0');
  assert.deepEqual(await page.locator('#kv-rows-body input[data-k="kv_cone"]').evaluateAll((xs) => xs.map((x) => x.value)), ['10', '6', '15']);
  assert.deepEqual(await page.locator('#kv-rows-body input[data-k="kv_ssd"]').evaluateAll((xs) => xs.map((x) => x.value)), ['50', '50', '50']);
  assert.equal((await page.locator('#kv-rows-body input[data-k="kv_M1"]').evaluateAll((xs) => xs.map((x) => x.value))).join(''), '');
  // на пустой вкладке (без показаний) подстановка — с первого нажатия
  await kvPage(page, 'modes');
  await page.locator('#kv-jbind [data-kvj-mode]').nth(1).check();
  await pause();
  await jb(page, 'fill').click();
  await pause();
  assert.equal(await page.locator('#kv-modes tr').count(), 2);
  // «вручную» — связь снимается, данные остаются
  await jb(page, 'machine').selectOption('');
  await pause();
  assert.match(await status(page), /Ручной ввод: вкладка больше не связана/);
  assert.equal(await page.inputValue('#kv_jmachine'), '');
  assert.equal(await page.locator('#kv-modes tr').count(), 2);
  assert.equal(await page.locator('#kv-jbind [data-kvj-mode]').count(), 0);

  // по-английски — подписи блока переведены
  await page.locator('#lang_en').check();
  await pause(600);
  const lines = (await page.locator('#kv-jbind').innerText()).split('\n').filter((l) => CYR.test(l));
  assert.deepEqual(lines, []);
  await page.locator('#lang_ru').check();
  await pause(300);
  assert.deepEqual(errors, []);
});
