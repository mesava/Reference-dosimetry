// Вкладка «kV-рентген»: таблица режимов в разделе 1 (0.39.0). Диапазон, напряжение, ток, фильтр и СПО любого режима
// вводятся прямо в таблице (режим не переключается, фокус остаётся); у выбранного режима значение попадает и в поля
// раздела 1. Камера выбирается в строке режима: «+ новая камера…» открывает режим и его новую камеру в разделе 2,
// выбор камеры одного режима не меняет другие. Ток трубки — в протоколе. На телефоне — карточки без прокрутки страницы.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage } from './helpers.js';

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

test('kV-рентген: таблица режимов — ввод в строке любого режима, ток трубки, камера режима, диапазон', async () => {
  const { ctx, page, errors } = await openPage(browser);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  const text = (sel) => page.locator(sel).innerText();
  const chamberOf = (m) => page.locator(`#kvm${m}_ch`).evaluate((e) => e.selectedOptions[0].textContent);
  const pressed = (m) => page.locator(`#kv-modes [data-m="${m}"]`).getAttribute('aria-pressed');

  await page.goto(`${server.url}/index.html#kv`);
  await page.waitForSelector('#kv-messages li');
  // пустая вкладка: одна строка режима, камера 1
  assert.equal(await page.locator('#kv-modes tr').count(), 1);
  assert.equal(await chamberOf(0), '1 — камера не выбрана');

  await page.click('#kv-btn-sample');
  await pause();
  assert.equal(await page.locator('#kv-modes tr').count(), 2);
  assert.equal(await page.inputValue('#kv_ma'), '10');
  assert.equal(await page.inputValue('#kvm1_kv_ma'), '12');

  // ток режима 2 — в таблице: режим 1 остаётся выбранным, фокус — в поле таблицы
  await page.fill('#kvm1_kv_ma', '15');
  await pause();
  assert.equal(await pressed(0), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'kvm1_kv_ma');
  assert.equal(await page.inputValue('#kv_ma'), '10');
  // напряжение выбранного режима в таблице — и в поле раздела 1
  await page.fill('#kvm0_kv_kv', '210');
  await pause();
  assert.equal(await page.inputValue('#kv_kv'), '210');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'kvm0_kv_kv');
  // и обратно: поле раздела 1 — в таблицу
  await page.fill('#kv_kv', '200');
  await pause();
  assert.equal(await page.inputValue('#kvm0_kv_kv'), '200');
  // переход из поля раздела 1 в таблицу: фокус остаётся в таблице (уход из поля её не перестраивает)
  await page.click('#kvm1_kv_kv');
  await pause();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'kvm1_kv_kv');
  // ток не число — предупреждение и подсветка в обоих местах
  await page.fill('#kv_ma', 'десять');
  await pause();
  assert.match(await text('#kv-messages'), /Ток трубки — число миллиампер больше нуля\. В расчёт он не входит\./);
  assert.match(await page.locator('#kvm0_kv_ma').getAttribute('class'), /flag-warn/);
  await page.fill('#kv_ma', '10');
  await pause();
  assert.doesNotMatch(await page.locator('#kvm0_kv_ma').getAttribute('class'), /flag-warn/);

  // протокол: ток трубки в строках режимов и пучка
  await page.click('#kv-modes [data-m="1"]');
  await pause();
  assert.equal(await page.inputValue('#kv_ma'), '15');
  await page.click('#kv-btn-copy-report');
  await pause();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /Пучок \(режим 2\): 150 кВ, 15 мА, СПО 0,500 мм Cu \(измеренный\), фильтр 0,25 мм Cu \+ 1 мм Al\n/);
  assert.match(report, /\nРежим 1: 200 кВ, 10 мА, СПО 1,00 мм Cu, фильтр 0,5 мм Cu \+ 1 мм Al; камера 1/);

  // новая камера в строке режима 1: режим 1 открывается, его камера 2 — в разделе 2; режим 2 — с камерой 1
  await page.selectOption('#kvm0_ch', 'new');
  await pause();
  assert.equal(await pressed(0), 'true');
  assert.equal(await page.inputValue('#kv-mode-chamber'), '1');
  assert.equal(await page.inputValue('#kv_ch_model'), '');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'kv_ch_model');
  assert.match(await text('#kv-status'), /^Режим 1: добавлена камера 2\. Выберите модель и введите сертификат в разделе 2\./);
  assert.equal(await chamberOf(0), '2 — камера не выбрана');
  assert.equal(await chamberOf(1), '1 — PTW 30013 № 0000');
  // режим 2 переходит на камеру 2 из таблицы, не переключая режим
  await page.selectOption('#kvm1_ch', '1');
  await pause();
  assert.equal(await pressed(0), 'true');
  assert.equal(await chamberOf(1), '2 — камера не выбрана');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'kvm1_ch');
  assert.match(await text('#kv-mode-chamber-sub'), /^Камера 2 выбрана в режимах 1, 2/);
  // камеру, выбранную в нескольких режимах, тоже можно удалить: её режимы переходят на оставшуюся
  assert.ok(await page.locator('#kv-btn-del-ch').isVisible());
  await page.click('#kv-btn-del-ch');
  await pause(100);
  assert.equal(await text('#kv-btn-del-ch'), 'Точно удалить камеру 2? Режимы 1, 2 перейдут на камеру 1.');
  await page.click('#kv-btn-del-ch');
  await pause();
  assert.match(await text('#kv-status'), /^Камера 2 удалена; режимы 1, 2 — с камерой 1 \(PTW 30013 № 0000\)\./);
  assert.ok(await page.locator('#kv-btn-del-ch').isHidden());
  assert.equal(await chamberOf(0), '1 — PTW 30013 № 0000');
  assert.equal(await page.inputValue('#kv_ch_model'), 'PTW30013');

  // диапазон режима 2 в таблице: единица СПО в строке меняется, фокус остаётся в списке
  assert.equal(await page.locator('#kv-modes tr[data-mr="1"] .u').innerText(), 'Cu');
  await page.selectOption('#kvm1_kv_range', 'low');
  await pause();
  assert.equal(await page.locator('#kv-modes tr[data-mr="1"] .u').innerText(), 'Al');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'kvm1_kv_range');
  assert.equal(await pressed(0), 'true');
  await page.click('#kv-modes [data-m="1"]');
  await pause();
  assert.equal(await page.inputValue('#kv_range'), 'low');
  assert.match(await page.locator('#kvm1_kv_kv').getAttribute('class'), /flag-warn/);
  assert.deepEqual(errors, []);
});

test('kV-рентген: таблица режимов на телефоне — карточки без горизонтальной прокрутки страницы', async () => {
  const { page, errors } = await openPage(browser, { mobile: true, viewport: { width: 390, height: 844 } });
  await page.goto(`${server.url}/index.html#kv`);
  await page.waitForSelector('#kv-messages li');
  await page.click('#kv-btn-sample');
  await page.waitForTimeout(300);
  await page.locator('#kv-modes-table').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  assert.equal(await page.locator('#kv-modes-table thead').isVisible(), false);
  const cap = await page.locator('#kv-modes tr[data-mr="0"] td.ma').evaluate((e) => getComputedStyle(e, '::before').content);
  assert.equal(cap, '"Ток, мА"');
  // поле тока не уже 40 px, список камер — во всю ширину карточки
  const w = await page.locator('#kvm0_kv_ma').evaluate((e) => e.getBoundingClientRect().width);
  assert.ok(w >= 40, String(w));
  const ch = await page.locator('#kvm0_ch').evaluate((e) => e.getBoundingClientRect().width);
  assert.ok(ch >= 250, String(ch));
  assert.deepEqual(errors, []);
});
