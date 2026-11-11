// «Оборудование»: рентгенотерапевтический аппарат (0.41.0) — аппликаторы (форма, размер, РИП, Ø экв.), режимы (диапазон,
// напряжение, ток, фильтр, СПО), отмеченные аппликаторы и референсный с проверкой по TRS-398 Rev.1 (табл. 31); камера
// режима — в разделе 4, «Камеры режимов», kV-сертификат и «Применение» — в карточке камеры (0.50.0); подписи
// обновляются при вводе без потери фокуса; удаление аппликатора, режима и камеры; английский; телефон.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
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

/** Карточка аппарата kV, его аппликаторы и режимы. */
const kvCard = (page) => page.locator('.jcard.jkv');
const appRow = (page, i) => kvCard(page).locator('table.jkv-apps-t tbody tr').nth(i);
const modeBox = (page, i) => kvCard(page).locator('.jkv-mode').nth(i);
/** Камера режима i в таблице «Камеры режимов» (раздел 4). */
const modeChamber = (page, i) => page.locator('#eq-kv-modes tbody tr').nth(i).locator('select[data-bind$="|chamberId"]');

async function addApplicators(page, list) {
  for (const [name, a, ssd] of list) {
    await kvCard(page).locator('[data-add-kvapp]').click();
    await page.waitForTimeout(100);
    const row = kvCard(page).locator('table.jkv-apps-t tbody tr').last();
    await row.locator('input[data-bind$="|name"]').fill(name);
    await row.locator('input[data-bind$="|a"]').fill(a);
    await row.locator('input[data-bind$="|ssd"]').fill(ssd);
  }
}

test('оборудование: рентгенотерапевтический аппарат — аппликаторы, режимы, референсный по Rev.1', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 250) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq_department');
  // камера и электрометр отделения
  await page.click('#eq-add-chamber');
  await pause();
  const ch = page.locator('[data-card^="chamber:"]');
  await ch.locator('select[data-bind$="|maker"]').selectOption('PTW');
  await pause();
  await ch.locator('select[data-bind$="|form.ch_model"]').selectOption('PTW30013');
  await pause();
  await ch.locator('input[data-bind$="|form.ch_serial"]').fill('1001');
  await page.click('#eq-add-electrometer');
  await pause();
  // «Применение»: фотонная камера без пучков — МВ и электроны; полей kV-сертификата нет; таблицы «Камеры режимов» — тоже
  const use = (key) => ch.locator(`input[data-bind$="|use.${key}"]`);
  assert.deepEqual([await use('photon').isChecked(), await use('electron').isChecked(), await use('kv').isChecked()], [true, true, false]);
  assert.equal(await ch.locator('input[data-bind$="|kv.kv_n"]').count(), 0);
  assert.equal(await page.locator('#eq-kv-modes').innerText(), '');

  // аппарат
  await page.click('#eq-add-kv');
  await pause();
  assert.equal(await kvCard(page).count(), 1);
  assert.match(await kvCard(page).locator('.jcard-head').innerText(), /Новый рентгенотерапевтический аппарат/);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.bind?.endsWith('|name')), true, 'фокус — на названии аппарата');
  await kvCard(page).locator('input[data-bind^="machine|"][data-bind$="|name"]').fill('Xstrahl 300');
  await kvCard(page).locator('input[data-bind$="|tube"]').fill('T-1');
  await pause();
  assert.match(await kvCard(page).locator('.jcard-head').innerText(), /^Xstrahl 300/);
  assert.match(await kvCard(page).innerText(), /Аппликаторов пока нет/);

  // аппликаторы: круги и квадрат; Ø экв. — диаметр круга той же площади
  await addApplicators(page, [['F3', '3', '30'], ['F5', '5', '30'], ['F10', '10', '50']]);
  await kvCard(page).locator('[data-add-kvapp]').click();
  await pause();
  const q = appRow(page, 3);
  assert.equal(await q.locator('input[data-bind$="|ssd"]').inputValue(), '50', 'новый аппликатор — с РИП прежнего');
  await q.locator('select[data-bind$="|shape"]').selectOption('square');
  await pause();
  await appRow(page, 3).locator('input[data-bind$="|name"]').fill('Q10');
  await appRow(page, 3).locator('input[data-bind$="|a"]').fill('10');
  await pause();
  assert.equal((await appRow(page, 3).locator('td.v').innerText()).trim(), '11,3');
  // прямоугольник — вторая сторона
  await appRow(page, 3).locator('select[data-bind$="|shape"]').selectOption('rect');
  await pause();
  await appRow(page, 3).locator('input[data-bind$="|b"]').fill('12');
  await pause();
  assert.equal((await appRow(page, 3).locator('td.v').innerText()).trim(), '12,4');
  // размер не число — ошибка под таблицей
  await appRow(page, 3).locator('input[data-bind$="|b"]').fill('много');
  await pause();
  assert.match(await kvCard(page).locator('[data-live^="kvapps-msgs-"]').innerText(), /размер — число сантиметров больше нуля/);
  await appRow(page, 3).locator('input[data-bind$="|b"]').fill('12');
  await pause();

  // режим: первый — со всеми аппликаторами, стандартный не выбран (он необязателен: замечания нет)
  await kvCard(page).locator('[data-add-kvmode]').click();
  await pause();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.bind?.endsWith('|kv')), true, 'фокус — на напряжении');
  const m1 = modeBox(page, 0);
  assert.equal(await m1.locator('.jkv-apps input:checked').count(), 4);
  await m1.locator('input[data-bind$="|kv"]').fill('200');
  await m1.locator('input[data-bind$="|ma"]').fill('15');
  await m1.locator('input[data-bind$="|filter"]').fill('0.5 mm Cu');
  await m1.locator('input[data-bind$="|hvl"]').fill('1,0');
  await pause();
  assert.equal((await m1.locator('h4').innerText()).trim(), 'Режим 1 — 200 кВ / 15 мА / 0.5 mm Cu');
  let msgs = await m1.locator('.jmsgs').innerText();
  assert.match(msgs, /камера не выбрана/);
  assert.doesNotMatch(msgs, /аппликатор не выбран/);
  // кандидат по Rev.1 — Ø 10 см (сопоставим с 10 × 10 см), с наибольшим РИП
  const ref = m1.locator('select[data-bind$="|refApplicator"]');
  assert.deepEqual(await ref.locator('option').allTextContents(), ['— не выбран —', 'F3, Ø 3 см, РИП 30 см', 'F5, Ø 5 см, РИП 30 см', 'F10, Ø 10 см, РИП 50 см — по Rev.1', 'Q10, 10 × 12 см, РИП 50 см']);
  assert.match(await m1.locator('[data-live^="kvmode-ref-"] .sub').innerText(), /по TRS-398 Rev\.1 \(табл\. 31\): F10, Ø 10 см, РИП 50 см/);
  await ref.selectOption({ index: 1 });
  await pause();
  assert.match(await modeBox(page, 0).locator('.jmsgs').innerText(), /стандартный — F10, Ø 10 см, РИП 50 см, а выбран F3, Ø 3 см, РИП 30 см/);
  await modeBox(page, 0).locator('select[data-bind$="|refApplicator"]').selectOption({ index: 3 });
  await pause();
  // камера режима — в таблице «Камеры режимов»: камеры, не отмеченные для kV, — отдельной группой
  assert.equal(await modeBox(page, 0).locator('.jkv-ch').innerText(), 'не выбрана');
  assert.equal(await modeBox(page, 0).locator('select[data-bind$="|chamberId"]').count(), 0, 'в карточке режима камеру не выбрать');
  assert.match(await page.locator('#eq-kv-modes tbody tr').nth(0).innerText(), /Xstrahl 300\s+1 — 200 кВ \/ 15 мА \/ 0\.5 mm Cu/);
  assert.equal(await modeChamber(page, 0).locator('optgroup').getAttribute('label'), 'другие камеры — будут отмечены для kV-рентгена');
  await modeChamber(page, 0).selectOption({ index: 1 });
  await pause();
  assert.equal(await modeBox(page, 0).locator('.jkv-ch').innerText(), 'PTW 30013 № 1001');
  // камера в режиме kV и без N_D,w — отмечена для kV (флажок не снять, пока она выбрана), появились поля kV-сертификата
  assert.deepEqual([await use('photon').isChecked(), await use('kv').isChecked(), await use('kv').isDisabled()], [false, true, true]);
  assert.equal(await ch.locator('input[data-bind$="|kv.kv_n"]').count(), 1);
  // у камеры нет kV-сертификата — только справка; в таблице — «нет»
  assert.deepEqual(await modeBox(page, 0).locator('.jmsgs li').evaluateAll((li) => li.map((x) => x.className)), ['info']);
  assert.match(await modeBox(page, 0).locator('.jmsgs').innerText(), /у камеры нет kV-сертификата: введите его в карточке камеры/);
  assert.match(await page.locator('#eq-kv-modes tbody tr').nth(0).innerText(), /нет — введите в карточке камеры/);
  assert.equal(await kvCard(page).locator('.jcard-head .chip.warn, .jcard-head .chip.error').count(), 0);
  // электрометр режима — «Электрометр при калибровке» камеры
  assert.match(await page.locator('#eq-kv-modes tbody tr').nth(0).innerText(), /укажите «Электрометр при калибровке» у камеры/);
  await ch.locator('select[data-bind$="|calEl"]').selectOption({ index: 1 });
  await pause();
  assert.match(await page.locator('#eq-kv-modes tbody tr').nth(0).innerText(), /при калибровке камеры/);
  // kV-сертификат в карточке камеры: N_K, таблица качеств
  await ch.locator('select[data-bind$="|kv.kv_cal"]').selectOption('nk');
  await pause();
  await ch.locator('select[data-bind$="|kv.kv_cert_form"]').selectOption('n');
  await pause();
  await ch.locator('input[data-bind$="|kv.kv_cq_kv.0"]').fill('200');
  await ch.locator('input[data-bind$="|kv.kv_cq_hvl.0"]').fill('1,0');
  await ch.locator('input[data-bind$="|kv.kv_cq_val.0"]').fill('0,0452');
  await pause();
  // строки таблицы качеств: четыре, как во вкладке; добавить и убрать последнюю
  assert.equal(await ch.locator('table.jkv-cert-t tbody tr').count(), 4);
  await ch.locator('[data-kvcert-add]').click();
  await pause();
  assert.equal(await ch.locator('table.jkv-cert-t tbody tr').count(), 5);
  await ch.locator('[data-kvcert-del]').click();
  await pause();
  assert.equal(await ch.locator('table.jkv-cert-t tbody tr').count(), 4);
  await ch.locator('input[data-bind$="|kv.kv_cq_kv.1"]').fill('250');
  await ch.locator('input[data-bind$="|kv.kv_cq_hvl.1"]').fill('2,0');
  await ch.locator('input[data-bind$="|kv.kv_cq_val.1"]').fill('0,0455');
  await pause();
  assert.match(await page.locator('#eq-kv-modes tbody tr').nth(0).innerText(), /есть/);
  assert.doesNotMatch(await modeBox(page, 0).locator('.jmsgs').innerText(), /нет kV-сертификата/);
  assert.match(await ch.locator('h4 + .sub-hint').first().innerText(), /^NK \(воздушная керма\); N по качествам — 2 точки; СПО 1,0–2,0 мм/);

  // ввод названия аппликатора обновляет флажки и список референсного без потери фокуса
  const nameF10 = appRow(page, 2).locator('input[data-bind$="|name"]');
  await nameF10.click();
  await nameF10.press('End');
  await nameF10.type('-50');
  await pause();
  assert.equal(await page.evaluate(() => document.activeElement?.value), 'F10-50');
  assert.match(await modeBox(page, 0).locator('.jkv-apps').innerText(), /F10-50, Ø 10 см, РИП 50 см/);
  assert.match(await modeBox(page, 0).locator('select[data-bind$="|refApplicator"] option:checked').innerText(), /^F10-50, Ø 10 см, РИП 50 см — по Rev\.1$/);

  // измеренный СПО — поле даты; низкие энергии — мм Al и подсказка про калибровку камеры
  await modeBox(page, 0).locator('select[data-bind$="|hvlSource"]').selectOption('measured');
  await pause();
  assert.match(await modeBox(page, 0).locator('.jmsgs').innerText(), /СПО измерен: укажите дату измерения/);
  await modeBox(page, 0).locator('input[data-bind$="|hvlDate"]').fill('2026-10-01');
  await pause();
  assert.doesNotMatch(await modeBox(page, 0).locator('.jmsgs').innerText(), /укажите дату/);

  // второй режим копирует камеру и аппликаторы; низкие энергии
  await kvCard(page).locator('[data-add-kvmode]').click();
  await pause();
  const m2 = modeBox(page, 1);
  assert.equal(await modeChamber(page, 1).inputValue(), await modeChamber(page, 0).inputValue());
  assert.equal(await m2.locator('.jkv-apps input:checked').count(), 4);
  await m2.locator('select[data-bind$="|range"]').selectOption('low');
  await pause();
  assert.match(await modeBox(page, 1).locator('label[for$="-hvl"]').innerText(), /СПО, мм Al/);
  assert.match(await modeBox(page, 1).locator('[data-live^="kvmode-ref-"] .sub').innerText(), /низкие энергии: референсное поле — как при калибровке камеры/);
  await modeBox(page, 1).locator('input[data-bind$="|kv"]').fill('50');
  await modeBox(page, 1).locator('input[data-bind$="|hvl"]').fill('1,0');
  await pause();
  // снять флажок стандартного — стандартный не выбран
  await modeBox(page, 1).locator('.jkv-apps input').nth(2).uncheck();
  await pause();
  assert.equal(await modeBox(page, 1).locator('select[data-bind$="|refApplicator"]').inputValue(), '');
  assert.equal(await modeBox(page, 1).locator('.jkv-apps input:checked').count(), 3);
  // сводка справа: аппарат и его замечания
  // стандартный не выбран — не замечание: аппарат в сводке замечаний не появляется
  msgs = await page.locator('#eq-messages').innerText();
  assert.doesNotMatch(msgs, /аппликатор не выбран/);
  assert.match(await page.locator('#eq-result').innerText(), /режимов рентгенотерапевтических аппаратов: 2/);

  // новый аппликатор отмечается в режимах, где отмечены все (режим 1), но не в режиме 2
  await addApplicators(page, [['F15', '15', '50']]);
  await pause();
  assert.equal(await modeBox(page, 0).locator('.jkv-apps input:checked').count(), 5);
  assert.equal(await modeBox(page, 1).locator('.jkv-apps input:checked').count(), 3);
  // удалить аппликатор (двумя нажатиями) — он уходит и из режимов, референсный режима 1 снимается
  const del = appRow(page, 2).locator('[data-del^="kvapp:"]');
  await del.click();
  await del.click();
  await pause();
  assert.equal(await kvCard(page).locator('table.jkv-apps-t tbody tr').count(), 4);
  assert.equal(await modeBox(page, 0).locator('.jkv-apps input').count(), 4);
  assert.equal(await modeBox(page, 0).locator('select[data-bind$="|refApplicator"]').inputValue(), '');
  // удалить камеру — у режимов камера снимается
  const delCh = page.locator('[data-del^="chamber:"]');
  await delCh.click();
  await delCh.click();
  await pause();
  assert.equal(await modeChamber(page, 0).inputValue(), '');
  assert.match(await modeBox(page, 0).locator('.jmsgs').innerText(), /камера не выбрана: её выбирают в разделе 4, «Камеры режимов»/);
  // удалить режим
  const delMode = modeBox(page, 1).locator('[data-del^="kvmode:"]');
  await delMode.click();
  await delMode.click();
  await pause();
  assert.equal(await kvCard(page).locator('.jkv-mode').count(), 1);

  // «Журнал и тренды» (с 0.46.0): аппарат kV — в списке отдельной группой, после ускорителей; записей у него пока нет
  await page.click('#eq-add-machine');
  await pause();
  await page.locator('[data-card^="machine:"]:not(.jkv) input[data-bind$="|name"]').fill('Versa HD');
  await pause();
  await page.goto(`${server.url}/index.html#history`);
  await page.waitForSelector('#hs_machine option', { state: 'attached' });
  assert.deepEqual(await page.locator('#hs_machine option').allTextContents(), ['Versa HD', 'Xstrahl 300']);
  assert.equal(await page.locator('#hs_machine optgroup').getAttribute('label'), 'Рентгенотерапевтические аппараты');
  await page.selectOption('#hs_machine', { label: 'Xstrahl 300' });
  await pause();
  assert.match(await page.locator('#hs-kv-records').innerText(), /^Записей пока нет: во вкладке «kV-рентген» выберите этот аппарат/);

  // по-английски — без кириллицы в карточке (кроме введённых значений)
  await page.goto(`${server.url}/index.html#equipment`);
  // аппараты — листы (с 0.52.0): открыт последний выбранный (Versa HD), Xstrahl 300 — своим ярлыком
  await page.locator('#eq-mtabs a', { hasText: 'Xstrahl 300' }).click();
  await page.waitForSelector('.jcard.jkv');
  await page.locator('#lang_en').check();
  await pause(600);
  const lines = (await kvCard(page).innerText()).split('\n').filter((l) => CYR.test(l));
  assert.deepEqual(lines, []);
  assert.deepEqual((await page.locator('#eq-kv-modes').innerText()).split('\n').filter((l) => CYR.test(l)), []);
  assert.match(await modeBox(page, 0).locator('h4').innerText(), /^Mode 1 — 200 kV \/ 15 mA \/ 0\.5 mm Cu$/);
  await page.locator('#lang_ru').check();
  await pause(300);
  assert.deepEqual(errors, []);
});

test('оборудование: аппарат kV на телефоне — страница без прокрутки вбок', async () => {
  const { page, errors } = await openPage(browser, { mobile: true, viewport: { width: 390, height: 844 } });
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq_department');
  await page.click('#eq-add-kv');
  await page.waitForTimeout(200);
  await addApplicators(page, [['F3', '3', '30'], ['F10', '10', '50']]);
  await kvCard(page).locator('[data-add-kvmode]').click();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  // в строке аппликатора на телефоне — подписи полей
  const caps = await appRow(page, 0).locator('td[data-cap]').evaluateAll((tds) => tds.map((td) => getComputedStyle(td, '::before').content));
  assert.deepEqual(caps, ['"Обозначение"', '"Форма"', '"Диаметр, см"', '"РИП, см"', '"Ø экв., см"']);
  assert.ok(await kvCard(page).locator('table.jkv-apps-t thead').isHidden());
  assert.deepEqual(errors, []);
});
