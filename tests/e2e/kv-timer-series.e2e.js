// Вкладка «kV-рентген», лист «Ошибка таймера»: серия облучений с разным заданием таблицей, как в рабочей книге отделения
// (0.57.0) — столбец на задание, под ним повторные показания и среднее; Tab ведёт вниз по столбцу; кнопки «± Задание»
// и «± Повтор»; задания в секундах или минутах; на графике только средние; протокол; черновик; по-английски.
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

// условные данные: M = 0,568·(T − 2,38) нКл, повторы +0,004 / −0,004 / 0 — средние точно на прямой, τ = −2,38 с
const SET = [6, 26, 46, 66];
const val = (t, d) => String(Math.round((0.568 * (t - 2.38) + d) * 1e4) / 1e4).replace('.', ',');

test('kV-рентген: серия облучений — таблица по заданиям, средние, τ по средним, график только средних', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#kv/timer`);
  await page.waitForSelector('#kv-messages li');
  await page.click('#kv-btn-sample');
  await pause();
  await page.selectOption('#kv_timer_mode', 'measured');
  await pause();
  // по умолчанию — три задания по три повтора, задания в секундах
  assert.equal(await page.locator('#kv-ts-grid .ts-t').count(), 3);
  assert.equal(await page.locator('#kv-ts-grid .ts-m').count(), 9);
  assert.equal(await page.inputValue('#kv_ts_unit'), 's');
  assert.equal(await page.locator('#kv-lbl-tt').innerText(), 'Задание, с');
  await page.click('#kv-ts-add-col');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'kv_ts_t_3');
  assert.equal(await page.locator('#kv-ts-grid .ts-t').count(), 4);
  // ввод как при измерении: задание и три показания подряд — Tab идёт вниз по столбцу, затем к следующему заданию
  await page.click('#kv_ts_t_0');
  for (const t of SET) {
    await page.keyboard.type(String(t));
    for (const d of [0.004, -0.004, 0]) {
      await page.keyboard.press('Tab');
      await page.keyboard.type(val(t, d));
    }
    await page.keyboard.press('Tab');
  }
  await pause();
  assert.equal(await page.inputValue('#kv_ts_t_3'), '66');
  assert.equal(await page.inputValue('#kv_ts_R_3_2'), val(66, 0));
  // средние под столбцами — 4 значащие цифры
  assert.deepEqual(await page.locator('#kv-ts-grid .ts-mean').allInnerTexts(), ['2,056', '13,42', '24,78', '36,14']);
  // τ = −2,38 с; при задании облучения в минутах — и в минутах
  assert.equal(await page.locator('[data-out="timer.tauS"]').innerText(), '−2,38');
  // график: по точке на задание (средние), плюс точка T = −τ
  assert.ok(await page.locator('#kv-timer-chart-wrap').isVisible());
  assert.equal(await page.locator('#kv-timer-chart svg .pt').count(), SET.length + 1);
  assert.match(await page.locator('#kv-timer-legend').innerText(), /средние показания при каждом задании/);
  assert.match(await page.locator('#kv-timer-eq').innerText(), /τ = −2,38 с/);
  // повтор добавляется во все столбцы; задание без показаний — ошибка этого столбца
  await page.click('#kv-ts-add-row');
  assert.equal(await page.locator('#kv-ts-grid .ts-m').count(), 16);
  await page.click('#kv-ts-add-col');
  await page.fill('#kv_ts_t_4', '86');
  await pause();
  assert.match(await page.locator('#kv-messages').innerText(), /задание 5: нет показаний/);
  assert.match(await page.locator('#kv_ts_t_4').getAttribute('class'), /flag-error/);
  assert.doesNotMatch(await page.locator('#kv_ts_t_3').getAttribute('class'), /flag-error/);
  await page.click('#kv-ts-del-col');
  await page.click('#kv-ts-del-row');
  await pause();
  assert.equal(await page.locator('#kv-ts-grid .ts-m').count(), 12);
  // задания в минутах: та же серия — другая τ (−2,38 мин = −142,8 с)
  await page.selectOption('#kv_ts_unit', 'min');
  await pause();
  assert.equal(await page.locator('#kv-lbl-tt').innerText(), 'Задание, мин');
  assert.equal(await page.locator('[data-out="timer.tauS"]').innerText(), '−142,80');
  await page.selectOption('#kv_ts_unit', 's');
  await pause();
  // черновик: после перезагрузки таблица та же
  await page.reload();
  await page.waitForSelector('#kv-messages li');
  await pause();
  assert.equal(await page.inputValue('#kv_timer_mode'), 'measured');
  assert.equal(await page.inputValue('#kv_ts_R_2_1'), val(46, -0.004));
  assert.equal(await page.locator('[data-out="timer.tauS"]').innerText(), '−2,38');
  // по-английски: подписи таблицы без кириллицы
  await page.locator('#lang_en').check();
  await pause();
  const grid = await page.locator('#kv_timer').innerText();
  assert.doesNotMatch(grid, /[А-Яа-яЁё]/, grid);
  assert.equal(await page.locator('#kv-lbl-tt').innerText(), 'Setting, s');
  assert.deepEqual(errors, []);
});
