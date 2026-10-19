// Страница в браузере: установка как приложение (сервис-воркер, работа без сети, кнопка на «Начале»), автономный файл
// dist/index.html, раздел «Выход вне допуска: проверка и подстройка», источник ручного k_Q, глубина результата в бюджете
// неопределённости, пометка TG-51 как справочного; английский интерфейс этих мест.
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

const FAKE_PROMPT = () => {
  const e = new Event('beforeinstallprompt');
  e.prompt = async () => {
    window.__prompted = true;
  };
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(e);
};

test('установка как приложение: манифест, сервис-воркер, работа без сети, кнопка на «Начале»', async () => {
  const { ctx, page, errors } = await openPage(browser, { fakefs: false });
  await page.goto(`${server.url}/index.html#start`);
  await page.waitForSelector('#start-root .start-card');
  const man = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  assert.equal(man.display, 'standalone');
  for (const icon of man.icons) assert.ok(await page.evaluate(async (src) => (await fetch(src)).ok, icon.src), icon.src);
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 10000 });
  assert.equal(await page.locator('#start-install').count(), 0, 'без предложения браузера кнопки нет');
  await page.evaluate(FAKE_PROMPT);
  await page.waitForSelector('#start-install');
  await page.locator('#start-install').click();
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => window.__prompted));
  assert.match(await page.locator('#start-status').innerText(), /установлен/);
  assert.equal(await page.locator('#start-install').count(), 0);
  // копия страницы — после первого открытия; без сети страница открывается из неё
  await page.reload();
  await page.waitForSelector('#start-root .start-card');
  await page.waitForTimeout(800);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('#start-root .start-card', { timeout: 10000 });
  await ctx.setOffline(false);
  assert.deepEqual(errors, []);
});

test('автономный файл dist/index.html: без манифеста, значок встроен, страница работает', async () => {
  const { page, errors } = await openPage(browser, { fakefs: false });
  await page.goto(`${pathToFileURL(ROOT).href}dist/index.html#start`);
  await page.waitForSelector('#start-root .start-card');
  assert.equal(await page.locator('link[rel="manifest"]').count(), 0);
  assert.ok(await page.evaluate(() => document.querySelector('link[rel=icon]').href.startsWith('data:image/svg+xml')));
  assert.deepEqual(errors, []);
});

test('«Выход вне допуска: проверка и подстройка», источник ручного k_Q; по-английски', async () => {
  const { page, errors } = await openPage(browser);
  await page.goto(`${server.url}/index.html#photons`);
  await page.waitForSelector('#messages li');
  // доза далеко от номинала — появляется раздел 9 с советом сначала проверить измерение
  await page.fill('#dd_nominal', '1,100');
  await page.waitForTimeout(400);
  const sec = page.locator('#recal-section');
  assert.ok(await sec.isVisible());
  assert.match(await sec.locator('h2').innerText(), /Выход вне допуска: проверка и подстройка/);
  assert.match(await page.locator('#recal-hint').innerText(), /Прежде чем подстраивать ускоритель, проверьте само измерение/);
  // ручной k_Q: поле источника и справка без него
  await page.selectOption('#kqtrs_mode', 'manual');
  await page.fill('#kqtrs_manual', '0,9875');
  await page.waitForTimeout(400);
  assert.ok(await page.locator('#kqtrs_src').isVisible());
  assert.match(await page.locator('#messages').innerText(), /Источник введённого вручную kQ не указан/);
  await page.fill('#kqtrs_src', 'Свидетельство (демо)');
  await page.waitForTimeout(400);
  assert.doesNotMatch(await page.locator('#messages').innerText(), /Источник введённого вручную/);
  // по-английски — без кириллицы
  await page.locator('#lang_en').check();
  await page.waitForTimeout(500);
  const en = (await sec.innerText()).split('\n').filter((l) => CYR.test(l));
  assert.deepEqual(en, []);
  assert.match(await sec.locator('h2').innerText(), /Output out of tolerance/);
  assert.match(await page.locator('label[for=kqtrs_src]').innerText(), /Source of k/);
  assert.deepEqual(errors, []);
});

test('бюджет неопределённости: доза на z_ref по умолчанию, на d_max — с u пересчёта или с предупреждением', async () => {
  const { page, errors } = await openPage(browser);
  await page.goto(`${server.url}/index.html#uncertainty`);
  await page.waitForSelector('#unc-result .dose-big');
  assert.equal(await page.inputValue('#unc_value_at'), 'zref');
  assert.ok(!(await page.locator('#unc_transfer_u').isVisible()));
  assert.match(await page.locator('#unc-result').innerText(), /доза на zref/);
  await page.selectOption('#unc_value_at', 'max');
  await page.waitForTimeout(300);
  assert.ok(await page.locator('#unc_transfer_u').isVisible());
  assert.match(await page.locator('#unc-messages').innerText(), /без неопределённости пересчёта/);
  assert.match(await page.locator('#unc-result').innerText(), /неполная/);
  await page.fill('#unc_transfer_u', '0,5');
  await page.waitForTimeout(300);
  assert.doesNotMatch(await page.locator('#unc-messages').innerText(), /без неопределённости пересчёта/);
  assert.match(await page.locator('#unc-result').innerText(), /с пересчётом/);
  // перенос с вкладки дозиметрии ставит опорную глубину
  await page.locator('[data-pull="photons"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.inputValue('#unc_value_at'), 'zref');
  assert.deepEqual(errors, []);
});

test('TG-51 в шапке помечен как справочный; при его выборе видна строка-предупреждение', async () => {
  const { page, errors } = await openPage(browser, { fakefs: false });
  await page.goto(`${server.url}/index.html#photons`);
  await page.waitForSelector('#protocol_tg51');
  assert.equal(await page.locator('#protocol_tg51 + span .ref-tag').innerText(), 'справочно');
  assert.match(await page.locator('#protocol_tg51').locator('..').getAttribute('title'), /TRS-398 Rev\.1/);
  await page.locator('#protocol_trs').check({ force: true });
  assert.ok(await page.locator('#protocol-note').isHidden());
  await page.locator('#protocol_tg51').check({ force: true });
  assert.match(await page.locator('#protocol-note').innerText(), /справочное сравнение/);
  await page.locator('#lang_en').check({ force: true });
  await page.waitForTimeout(200);
  const sw = await page.locator('.protocol-switch').innerText();
  assert.match(sw, /reference comparison/);
  assert.ok(!CYR.test(sw), sw);
  await page.locator('#protocol_trs').check({ force: true });
  assert.ok(await page.locator('#protocol-note').isHidden());
  assert.deepEqual(errors, []);
});
