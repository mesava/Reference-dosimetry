// Вкладка «kV-рентген» ↔ «Оборудование» (0.42.0): блок «Журнал отделения» на листе «Аппарат и режимы».
// «Сохранить аппарат в Оборудование» заводит аппарат с режимами, аппликаторами, камерой (с kV-сертификатом) и
// электрометром вкладки. С 0.50.0 постоянное связанных режимов — из «Оборудования»: во вкладке оно закрыто, обратно
// записывается только измеренное (СПО с вопросом о другом значении), правки в «Оборудовании» — «Обновить из
// «Оборудования»»; выбор аппарата и «Подставить отмеченные режимы» заполняют вкладку (поверх показаний — со второго
// нажатия); демонстрационный пример не сохраняется; «вручную» снимает связь; камера только для kV — в «Оборудовании».
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
  assert.match(await status(page), /^Аппарат «Xstrahl 300» сохранён в «Оборудование»: добавлен аппарат «Xstrahl 300»; режимов добавлено: 2; аппликаторов добавлено: 3; камеры добавлены: PTW 30013 № 0000; электрометры добавлены: Электрометр \(демо\); измеренный СПО записан в режимов: 2; набор пластин для СПО сохранён \(6\)\./);
  // вкладка связана с аппаратом: он выбран, режимы — с флажками; СПО — измеренный на листе «СПО и k_Q», с датой
  assert.equal(await jb(page, 'machine').locator('option:checked').innerText(), 'Xstrahl 300');
  assert.equal(await page.locator('#kv-jbind [data-kvj-mode]').count(), 2);
  assert.match(await page.locator('#kv-jbind .kvj-modes').innerText(), /Режим 1 — 200 кВ \/ 10 мА \/ 0,5 мм Cu \+ 1 мм Al: СПО 1,000 мм Cu \(измеренный 15\.09\.2026\); PTW 30013 № 0000; аппликаторов 3, стандартный Ø 10 см, РИП 50 см/);

  // связанная вкладка (с 0.50.0): пучок, камера с kV-сертификатом и аппликаторы — из «Оборудования», здесь закрыты;
  // электрометр и напряжения — на день измерений; новый режим заводится в «Оборудовании»
  const locked = (ids) => page.evaluate((xs) => xs.map((id) => { const e = document.getElementById(id); return e.readOnly || e.disabled; }), ids);
  assert.deepEqual(await locked(['kv_kv', 'kv_ma', 'kv_hvl', 'kv_ch_model', 'kv_ch_serial', 'kv_n', 'kvm0_kv_kv', 'kvm1_ch', 'kv-btn-add-mode', 'kv_el_model', 'kv_V1']), [true, true, true, true, true, true, true, true, true, false, false]);
  assert.equal(await jb(page, 'save').innerText(), 'Сохранить измеренное в «Оборудование» (Xstrahl 300)');
  assert.equal(await page.locator('#kv-mode-chamber').innerText(), 'Режим 1 — PTW 30013 № 0000');
  assert.match(await page.locator('#kv-ch-lock').innerText(), /^Камера и kV-сертификат — из «Оборудования» \(раздел 4, карточка камеры\): здесь они только показываются\./);
  assert.ok(await page.locator('#kv-ch-lock a[data-module="equipment"]').isVisible());
  // «раздел 4» в пояснениях — раздел «Оборудования», а не вкладки
  assert.deepEqual(await page.locator('#kv-ch-lock a.sec-link, #kv-rows-lock a.sec-link, #kv-mode-chamber-sub a.sec-link').evaluateAll((as) => as.map((a) => `${a.dataset.secModule} ${a.dataset.secNo}`)), ['equipment 2', 'equipment 4', 'equipment 2']);
  assert.equal(await page.locator('#kv_hvl').getAttribute('title'), 'Из «Оборудования»: правится там');

  // измеренный СПО режима 1 не в расчёте: значение таблицы режимов в «Оборудование» не возвращается — вопроса нет
  await kvPage(page, 'hvl');
  await page.uncheck('#kv_hl_apply');
  await kvPage(page, 'modes');
  await jb(page, 'save').click();
  await pause();
  assert.equal(await page.locator('#kv-jbind .kvj-ask').count(), 0);
  assert.match(await status(page), /^Аппарат «Xstrahl 300» сохранён в «Оборудование»: у режимов из «Оборудования» \(2\) пучок, камера и аппликаторы не менялись — они правятся в «Оборудовании»\. Сохраните журнал/);

  // в «Оборудовании»: СПО режима 1 — номинальный 1,10; в kV-сертификате камеры — новый N; камеры режимов — в разделе 4
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('.jcard.jkv');
  await page.locator('.jcard.jkv .jkv-mode').first().locator('select[data-bind$="|hvlSource"]').selectOption('nominal');
  await pause();
  await page.locator('.jcard.jkv .jkv-mode').first().locator('input[data-bind$="|hvl"]').fill('1,10');
  await page.locator('[data-card^="chamber:"]').first().locator('input[data-bind$="|kv.kv_n"]').fill('0,04600');
  await pause();
  assert.deepEqual(await page.locator('[data-kv-mch] select[data-bind$="|chamberId"] option:checked').allInnerTexts(), ['PTW 30013 № 0000', 'PTW 30013 № 0000']);
  assert.match(await page.locator('[data-kv-mch] tbody tr').first().innerText(), /Электрометр \(демо\)/);
  // вкладка: «Обновить из «Оборудования»» — СПО и N из журнала, показания остаются
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv-jbind [data-kvj="refresh"]');
  assert.match(await page.locator('#kv-jbind').innerText(), /В «Оборудовании» изменились пучок, камера или kV-сертификат режимов вкладки \(сертификат — действовавший на дату измерения\)\./);
  const reading = await page.inputValue('#kvr0_kv_M1_0');
  assert.notEqual(reading, '');
  await jb(page, 'refresh').click();
  await pause();
  assert.match(await status(page), /^Пучок, камера и kV-сертификат режимов обновлены из «Оборудования»; показания, задания и электрометр остались\./);
  assert.deepEqual([await page.inputValue('#kv_hvl'), await page.inputValue('#kv_n'), await page.inputValue('#kvr0_kv_M1_0')], ['1,10', '0,04600', reading]);
  assert.equal(await jb(page, 'refresh').count(), 0);
  // измеренный снова в расчёте: в «Оборудовании» номинальный — «Заменить номинальный измеренным?»; «Оставить» не меняет СПО
  await kvPage(page, 'hvl');
  await page.check('#kv_hl_apply');
  await kvPage(page, 'modes');
  await jb(page, 'save').click();
  await pause();
  assert.match(await page.locator('#kv-jbind .kvj-ask').innerText(), /СПО в «Оборудовании» другой: режим 1 — 1,10 мм Cu \(номинальный\) → 1,000 мм Cu \(измеренный 15\.09\.2026\)\. Заменить номинальный измеренным\?/);
  assert.ok(await jb(page, 'save').isDisabled());
  await jb(page, 'save-keep').click();
  await pause();
  assert.equal(await page.locator('#kv-jbind .kvj-ask').count(), 0);
  assert.match(await page.locator('#kv-jbind .kvj-modes').innerText(), /СПО 1,10 мм Cu; /);
  await jb(page, 'save').click();
  await pause();
  await jb(page, 'save-hvl').click();
  await pause();
  assert.match(await page.locator('#kv-jbind .kvj-modes').innerText(), /СПО 1,000 мм Cu \(измеренный 15\.09\.2026\)/);
  // после сохранения вкладка — как «Оборудование»: СПО режима — сохранённый измеренный
  assert.equal(await page.inputValue('#kv_hvl'), '1,000');
  assert.equal(await jb(page, 'refresh').count(), 0);

  // «Оборудование»: аппарат с режимами и аппликаторами; у камеры — kV-сертификат
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('.jcard.jkv');
  const card = page.locator('.jcard.jkv');
  // режимы — листы (с 0.52.1): два ярлыка, виден один режим
  assert.equal(await card.locator('[data-eq-tabs^="kvmode."] a').count(), 2);
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
  // камеры — листы (с 0.52.0): открыта карточка новой камеры
  const ch2 = page.locator('[data-card^="chamber:"]');
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
  assert.equal(await page.inputValue('#kv_hvl'), '1,000');
  assert.equal(await page.inputValue('#kv_machine'), 'Xstrahl 300');
  // камера и kV-сертификат — из записи камеры, электрометр — из записи электрометра
  assert.equal(await page.inputValue('#kv_ch_model'), 'PTW30013');
  assert.equal(await page.inputValue('#kv_ch_serial'), '0000');
  assert.equal(await page.inputValue('#kv_n'), '0,04600');
  assert.equal(await page.inputValue('#kv_el_model'), 'Электрометр (демо)');
  // строки — аппликаторы режима без показаний; выбрана строка референсного
  await kvPage(page, 'dose');
  assert.equal(await page.locator('#kv-rows-body tr').count(), 3);
  assert.equal(await page.getAttribute('#kv-rows-body tr.active', 'data-i'), '0');
  // режим из «Оборудования»: тубус и РИП — одним столбцом «Аппликатор» с именем аппликатора (0.59.0)
  assert.deepEqual(await page.locator('#kv-rows-body .kv-app-name').allInnerTexts(), ['Ø 10 см, РИП 50 см', '6 × 8 см, РИП 50 см', 'Ø 15 см, РИП 50 см']);
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
  // без связи поля снова правятся во вкладке
  assert.deepEqual(await locked(['kv_kv', 'kv_hvl', 'kv_ch_model', 'kv_n', 'kvm1_ch', 'kv-btn-add-mode']), [false, false, false, false, false, false]);
  assert.ok(await page.locator('#kv-ch-lock').isHidden());
  assert.equal(await page.locator('#kv_hvl').getAttribute('title'), null);

  // по-английски — подписи блока переведены
  await page.locator('#lang_en').check();
  await pause(600);
  const lines = (await page.locator('#kv-jbind').innerText()).split('\n').filter((l) => CYR.test(l));
  assert.deepEqual(lines, []);
  await page.locator('#lang_ru').check();
  await pause(300);
  assert.deepEqual(errors, []);
});

test('kV-рентген ↔ «Оборудование»: у режима из «Оборудования» пересчёт СПО по DIN 6809-4 записывается в kV-сертификат камеры; по-английски', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv-messages li');
  await page.click('#kv-btn-sample');
  await pause();
  await page.fill('#kv_machine', 'Xstrahl 300');
  await pause();
  // строка 1 сертификата — СПО в мм Al: без пересчёта она в интерполяцию не идёт
  await page.selectOption('#kv_cq_mat_0', 'Al');
  await pause();
  assert.ok(await page.locator('#kv-din-box').isVisible());
  await jb(page, 'save').click();
  await pause();
  assert.match(await status(page), /^Аппарат «Xstrahl 300» сохранён в «Оборудование»/);
  // связанная вкладка: строки сертификата закрыты, выбор пересчёта — нет
  assert.ok(await page.locator('#kv_cq_mat_0').isDisabled());
  assert.ok(await page.locator('#kv-cert-add').isDisabled());
  assert.ok(await page.locator('#kv_cq_din').isEnabled());
  await page.click('#kv-din-open');
  await pause();
  await page.click('#kv-din-apply');
  await pause();
  assert.ok(await page.locator('#kv_cq_din').isChecked());
  assert.equal(await status(page), 'Пересчёт СПО по DIN 6809-4 включён и записан в kV-сертификат камеры в «Оборудовании». Сохраните журнал в файл.');
  // «Оборудование»: в карточке камеры — флажок пересчёта, камера отмечена только для kV, N_D,w в ⁶⁰Co не нужен
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('[data-card^="chamber:"]');
  const ch = page.locator('[data-card^="chamber:"]').first();
  assert.ok(await ch.locator('input[data-bind$="|kv.kv_cq_din"]').isChecked());
  assert.equal(await ch.locator('select[data-bind$="|kv.kv_cq_mat.0"]').inputValue(), 'Al');
  const use = (key) => ch.locator(`input[data-bind$="|use.${key}"]`);
  assert.deepEqual([await use('photon').isChecked(), await use('electron').isChecked(), await use('kv').isChecked(), await use('kv').isDisabled()], [false, false, true, true]);
  assert.equal(await ch.locator('input[data-bind$="|form.ch_ndw"]').count(), 0);
  assert.doesNotMatch(await ch.locator('.jcard-head').innerText(), /не заполнено/);
  // отметить ещё фотоны — появляется N_D,w в ⁶⁰Co и отметка «не заполнено»; снять — снова только kV
  await use('photon').check();
  await pause();
  assert.equal(await ch.locator('input[data-bind$="|form.ch_ndw"]').count(), 1);
  assert.match(await ch.locator('.jcard-head').innerText(), /не заполнено/);
  await ch.locator('input[data-bind$="|use.photon"]').uncheck();
  await pause();
  assert.equal(await ch.locator('input[data-bind$="|form.ch_ndw"]').count(), 0);
  // во вкладке снять пересчёт — снимается и в «Оборудовании»
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv_cq_din');
  await page.uncheck('#kv_cq_din');
  await pause();
  assert.match(await status(page), /^Пересчёт СПО по DIN 6809-4 выключен и записан в kV-сертификат камеры/);
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('[data-card^="chamber:"]');
  assert.equal(await page.locator('[data-card^="chamber:"]').first().locator('input[data-bind$="|kv.kv_cq_din"]').isChecked(), false);

  // по-английски — пояснения связанной вкладки без кириллицы (кроме введённых значений)
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv-ch-lock');
  await page.locator('#lang_en').check();
  await pause(600);
  // (фильтр режима «0,5 мм Cu + 1 мм Al» — введённое значение примера)
  for (const sel of ['#kv-ch-lock', '#kv-rows-lock', '#kv-mode-chamber', '#kv-mode-chamber-sub', '#kv-jbind']) {
    assert.deepEqual((await page.locator(sel).innerText()).replace(/[\d,]+ мм (Cu|Al)/g, '').split('\n').filter((l) => CYR.test(l)), [], sel);
  }
  assert.equal(await page.locator('#kv_hvl').getAttribute('title'), 'From Equipment: edited there');
  assert.equal(await page.locator('#kv-mode-chamber').innerText(), 'Mode 1: PTW 30013 S/N 0000');
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('[data-kv-mch] table');
  // (электрометр «Электрометр (демо)» — введённое значение примера)
  assert.deepEqual((await page.locator('[data-card^="chamber:"]').first().innerText()).split('\n').filter((l) => CYR.test(l) && l !== 'Электрометр (демо)'), []);
  await page.locator('#lang_ru').check();
  await pause(300);
  assert.deepEqual(errors, []);
});
