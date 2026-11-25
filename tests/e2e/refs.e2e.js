// «Литература» (с 0.64.0): страница на всю ширину, у каждого источника — миниатюра обложки или первой страницы
// (img/refs/*.webp) или карточка-заглушка; на телефоне — без прокрутки вбок; по-английски — без кириллицы;
// в автономном файле dist/index.html миниатюры встроены (data:), без запросов к папке img/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { startServer, launch, openPage, ROOT, CYR } from './helpers.js';

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

/** Все миниатюры страницы загружены (у заглушек картинки нет). */
async function coversLoaded(page) {
  const items = page.locator('#module-refs .ref-item');
  // loading="lazy": на телефоне список длинный — прокручиваем к каждой миниатюре, чтобы браузер её загрузил
  for (const img of await page.locator('#module-refs img.ref-cover').all()) await img.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('#module-refs img.ref-cover')].every((i) => i.complete && i.naturalWidth > 0));
  return {
    items: await items.count(),
    imgs: await page.locator('#module-refs img.ref-cover').count(),
    stubs: await page.locator('#module-refs .ref-stub').count(),
    srcs: await page.locator('#module-refs img.ref-cover').evaluateAll((l) => l.map((i) => i.getAttribute('src'))),
  };
}

test('«Литература»: на всю ширину, у каждого источника миниатюра; два столбца на ПК, один на телефоне; по-английски', async () => {
  const { page, errors } = await openPage(browser, { viewport: { width: 1744, height: 1000 } });
  await page.goto(`${server.url}/index.html#refs`);
  await page.waitForSelector('#module-refs:not([hidden])');
  const c = await coversLoaded(page);
  assert.equal(c.items, 22); // 21 источник + «Как цитировать»
  assert.equal(c.imgs + c.stubs, c.items);
  assert.equal(c.stubs, 5);
  // ширина — как у шапки (не узкая колонка): страница и подвал шире 1500 px
  const w = await page.locator('main.refs-page').evaluate((e) => e.getBoundingClientRect().width);
  assert.ok(w > 1500, `ширина страницы ${w}`);
  const footP = await page.locator('footer.page-foot p').first().evaluate((e) => e.getBoundingClientRect().width);
  assert.ok(footP > 1500, `ширина подвала ${footP}`);
  // две карточки в ряд
  const tops = await page.locator('#module-refs .refs-group').first().locator('.ref-item').evaluateAll((l) => l.map((e) => Math.round(e.getBoundingClientRect().top)));
  assert.equal(tops[0], tops[1]);
  // группы и подписи по-английски
  await page.locator('#lang_en').check({ force: true });
  await page.waitForTimeout(300);
  const text = await page.locator('#module-refs').innerText();
  assert.deepEqual(text.split('\n').filter((l) => CYR.test(l)), []);
  assert.match(text, /IAEA TRS-398, THE PRIMARY STANDARD/i);
  assert.match(text, /TG-51 photon addendum · 2014/);
  assert.deepEqual(errors, []);
});

test('«Литература» на телефоне: карточки в один столбец, без прокрутки вбок', async () => {
  const { page, errors } = await openPage(browser, { viewport: { width: 390, height: 844 }, mobile: true });
  await page.goto(`${server.url}/index.html#refs`);
  await page.waitForSelector('#module-refs:not([hidden])');
  await coversLoaded(page);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const lefts = await page.locator('#module-refs .refs-group').first().locator('.ref-item').evaluateAll((l) => l.map((e) => Math.round(e.getBoundingClientRect().left)));
  assert.equal(lefts[0], lefts[1]);
  assert.deepEqual(errors, []);
});

test('«Литература» в автономном файле: миниатюры встроены (data:)', async () => {
  const { page, errors } = await openPage(browser, { fakefs: false });
  await page.goto(`${pathToFileURL(ROOT).href}dist/index.html#refs`);
  await page.waitForSelector('#module-refs:not([hidden])');
  const c = await coversLoaded(page);
  assert.equal(c.imgs, 17);
  assert.ok(c.srcs.every((s) => s.startsWith('data:image/')), c.srcs.find((s) => !s.startsWith('data:')));
  assert.deepEqual(errors, []);
});
