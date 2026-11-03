// Вкладка «kV-рентген»: листы как ярлыки в Excel (0.40.0). Разделы разнесены по листам «Аппарат и режимы» (1–2),
// «Ошибка таймера» (3), «Поглощённая доза» (4–8), «Сводка и протокол» (9–10); «СПО и k_Q», «Линейность» и
// «Воспроизводимость» — заготовки. У листа своя ссылка #kv/<лист>, открытый лист запоминается; ссылка «раздел N» на
// раздел другого листа открывает этот лист; список разделов слева — только разделы открытого листа; отметки состояния
// на ярлыках; печать — все разделы; на телефоне ряд ярлыков прокручивается вбок, страница — нет.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage, kvPage } from './helpers.js';

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

const current = (page) => page.getAttribute('#kv-pages a[aria-current]', 'data-kv-go');
const shown = (page) =>
  page.locator('#kv-sheet section.step').evaluateAll((secs) => secs.filter((s) => s.offsetParent !== null).map((s) => s.querySelector('.step-no').textContent.trim()));
const states = (page) => page.locator('#kv-pages a').evaluateAll((as) => Object.fromEntries(as.map((a) => [a.dataset.kvGo, a.dataset.state])));

test('kV-рентген: листы — разделы по листам, адрес листа, переход по ссылке на раздел, состояние, печать', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#kv`);
  await page.waitForSelector('#kv-messages li');
  // первый лист — «Аппарат и режимы»: разделы 1 и 2, адрес #kv/modes
  assert.deepEqual(await page.locator('#kv-pages a').allInnerTexts(), ['Аппарат и режимы', 'СПО и kQ', 'Ошибка таймера', 'Линейность', 'Воспроизводимость', 'Поглощённая доза', 'Сводка и протокол']);
  assert.equal(await current(page), 'modes');
  assert.equal(await page.evaluate(() => location.hash), '#kv/modes');
  assert.deepEqual(await shown(page), ['1', '2']);
  assert.ok(await page.locator('#module-kv .intro').isVisible());
  assert.deepEqual(await page.locator('#module-kv-secnav .secnav-item').evaluateAll((bs) => bs.map((b) => b.querySelector('.n').textContent)), ['1', '2']);
  // пустая вкладка: заготовки — «готовится», сводка без отметки
  const empty = await states(page);
  assert.equal(empty.hvl, 'wip');
  assert.equal(empty.summary, 'none');
  assert.equal(empty.dose, 'empty');
  assert.equal(await page.getAttribute('#kv-pages a[data-kv-go="hvl"]', 'title'), 'СПО и kQ: лист готовится');

  await page.click('#kv-btn-sample');
  await pause();
  assert.deepEqual(await states(page), { modes: 'done', hvl: 'wip', timer: 'done', linearity: 'wip', repro: 'wip', dose: 'done', summary: 'none' });
  // ток трубки не число — предупреждение на листе «Аппарат и режимы»
  await page.fill('#kv_ma', 'десять');
  await pause();
  assert.equal((await states(page)).modes, 'warn');
  await page.fill('#kv_ma', '10');
  await pause();

  // ярлык открывает лист без перезагрузки; строка выбора режима — на листах таймера и дозы
  assert.ok(await page.locator('#kv-modebar').isHidden());
  await kvPage(page, 'timer');
  assert.deepEqual(await shown(page), ['3']);
  assert.equal(await page.evaluate(() => location.hash), '#kv/timer');
  assert.ok(await page.locator('#kv-modebar').isVisible());
  assert.ok(await page.locator('#module-kv .intro').isHidden());
  await kvPage(page, 'dose');
  assert.deepEqual(await shown(page), ['4', '5', '6', '7', '8']);
  assert.deepEqual(await page.locator('#module-kv-secnav .secnav-item').evaluateAll((bs) => bs.map((b) => b.querySelector('.n').textContent)), ['4', '5', '6', '7', '8']);
  // единица задания — под таблицей аппликаторов
  assert.ok(await page.locator('#kv_set_unit').isVisible());
  await kvPage(page, 'summary');
  assert.deepEqual(await shown(page), ['9', '10']);
  assert.ok(await page.locator('#kv-modebar').isHidden());
  // заготовка: текст листа, разделов нет
  await kvPage(page, 'hvl');
  assert.deepEqual(await shown(page), []);
  assert.match(await page.locator('#kv-wip-hvl').locator('xpath=..').innerText(), /Лист готовится\. Здесь будут измерение СПО по режимам/);
  // ссылка «раздел 2» в заготовке открывает лист «Аппарат и режимы»
  await page.locator('.kv-wip[data-kv-page="hvl"] a.sec-link').click();
  await pause(800);
  assert.equal(await current(page), 'modes');
  assert.ok(await page.locator('#kv-s2').isVisible());
  // ссылка «раздел 4» в разделе 1 — лист «Поглощённая доза»
  await page.locator('section[aria-labelledby="kv-s1"] .hint a.sec-link', { hasText: 'раздел 4' }).first().click();
  await pause(800);
  assert.equal(await current(page), 'dose');
  assert.equal(await page.evaluate(() => location.hash), '#kv/dose');

  // адрес листа: открыть сразу, после перезагрузки — тот же лист; другая вкладка и обратно — тоже
  await page.goto(`${server.url}/index.html#kv/timer`);
  await page.waitForSelector('#kv-messages li');
  assert.equal(await current(page), 'timer');
  assert.ok(await page.locator('#kv-s3').isVisible());
  await page.reload();
  await page.waitForSelector('#kv-messages li');
  assert.equal(await current(page), 'timer');
  await page.click('#module-kv .subtools a[data-module="co60"]');
  await pause();
  await page.click('#module-co60 .subtools a[data-module="kv"]');
  await pause();
  assert.equal(await current(page), 'timer');
  assert.equal(await page.evaluate(() => location.hash), '#kv/timer');
  // неизвестный лист в адресе — модуль kV, лист прежний
  await page.evaluate(() => (location.hash = '#kv/nope'));
  await pause();
  assert.ok(await page.locator('#module-kv').isVisible());
  assert.equal(await current(page), 'timer');

  // печать: все разделы рабочего листа, без ярлыков и заготовок
  await page.emulateMedia({ media: 'print' });
  assert.deepEqual(await shown(page), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  assert.ok(await page.locator('#kv-pages').isHidden());
  assert.ok(await page.locator('.kv-wip').first().isHidden());
  await page.emulateMedia({ media: 'screen' });
  assert.deepEqual(await shown(page), ['3']);

  // по-английски — ярлыки и заготовки переведены
  await page.locator('#lang_en').check();
  await pause(600);
  assert.deepEqual(await page.locator('#kv-pages a').allInnerTexts(), ['Machine and modes', 'HVL and kQ', 'Timer error', 'Linearity', 'Reproducibility', 'Absorbed dose', 'Summary and report']);
  assert.equal(await page.getAttribute('#kv-pages a[data-kv-go="linearity"]', 'title'), 'Linearity: sheet in preparation');
  await kvPage(page, 'repro');
  assert.match(await page.locator('.kv-wip[data-kv-page="repro"]').innerText(), /^Reproducibility\n+This sheet is in preparation\./);
  await page.locator('#lang_ru').check();
  await pause(300);
  assert.deepEqual(errors, []);
});

test('kV-рентген: листы на телефоне — ряд ярлыков прокручивается вбок, открытый ярлык виден, страница без прокрутки вбок', async () => {
  const { page, errors } = await openPage(browser, { mobile: true, viewport: { width: 390, height: 844 } });
  await page.goto(`${server.url}/index.html#kv/summary`);
  await page.waitForSelector('#kv-messages li');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  const nav = page.locator('#kv-pages');
  assert.ok(await nav.evaluate((n) => n.scrollWidth > n.clientWidth));
  // открытый ярлык — в видимой части ряда
  const inView = await page.locator('#kv-pages a[aria-current]').evaluate((a) => {
    const n = a.parentElement.getBoundingClientRect();
    const r = a.getBoundingClientRect();
    return r.left >= n.left - 1 && r.right <= n.right + 1;
  });
  assert.ok(inView);
  assert.deepEqual(errors, []);
});
