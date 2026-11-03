// Вкладка «kV-рентген»: ошибка таймера по двум заданиям T₁ и T₂ (раздел 3) и таблица «Ошибка таймера по режимам» (0.38.0).
// Пример: режим 1 — своя τ (6 и 60 с), режим 2 — без показаний, τ из режима 1. Ввод показаний режима 2 прямо в таблице
// (режим не переключается, фокус остаётся), то же — в полях раздела 3 после перехода; допуск на |τ|; другой способ в
// таблице — строкой-пояснением; протокол; черновик; по-английски без кириллицы; на телефоне — без прокрутки страницы.
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

test('kV-рентген: ошибка таймера по режимам — ввод в таблице, допуск, протокол, черновик; по-английски', async () => {
  const { ctx, page, errors } = await openPage(browser);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  const text = (sel) => page.locator(sel).innerText();
  const row = (m) => page.locator(`#kv-timer-body tr[data-m="${m}"]`);
  const tau = async (m) => (await row(m).locator('[data-o="tau"]').innerText()).replace(/\s+/g, ' ').trim();
  const dot = (m) => row(m).locator('.st');

  await page.goto(`${server.url}/index.html#kv`);
  await page.waitForSelector('#kv-messages li');
  // один режим — таблицы по режимам нет
  assert.ok(await page.locator('#kv-timer-block').isHidden());
  assert.equal(await page.inputValue('#kv_timer_mode'), 'twopoint');

  await page.click('#kv-btn-sample');
  await pause();
  assert.ok(await page.locator('#kv-timer-block').isVisible());
  assert.equal(await page.locator('#kv-timer-body tr').count(), 2);
  // режим 1: свои 6 и 60 с, τ = +0,61 с (= 0,0101 мин), в допуске 3 с; режим 2 — τ из режима 1
  assert.equal(await page.inputValue('#kv_tp_t1'), '6');
  assert.equal(await page.inputValue('#kvt0_kv_tp_R2_2'), '21,96');
  assert.equal(await tau(0), '+0,61 с');
  assert.match(await dot(0).getAttribute('class'), /\bok\b/);
  assert.equal(await dot(0).getAttribute('title'), 'В допуске 3 с');
  assert.equal(await tau(1), '+0,61 с из режима 1');
  assert.match(await dot(1).getAttribute('class'), /\bempty\b/);
  assert.equal(await text('#kv-timer-note'), 'Допуск |τ| ≤ 3 с (по методике учреждения): у всех режимов со своей τ — в допуске.');
  assert.equal(await page.locator('#kv-out-tau-s, [data-out="timer.tauS"]').first().innerText(), '+0,61');

  // показания режима 2 — прямо в таблице: режим не меняется, фокус остаётся, τ режима 2 своя
  await page.fill('#kvt1_kv_tp_R1_0', '2,10');
  await page.fill('#kvt1_kv_tp_R2_0', '20,10');
  await pause();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'kvt1_kv_tp_R2_0');
  assert.equal(await page.locator('#kv-modes [data-m="0"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await tau(1), '+0,30 с');
  assert.match(await dot(1).getAttribute('class'), /\bok\b/);
  // номер режима открывает его: поля раздела 3 — те же показания, τ уже не из режима 1
  await row(1).locator('.kv-tm-pick').click();
  await pause();
  assert.equal(await page.locator('#kv-modes [data-m="1"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('tr')?.dataset.m), '1');
  assert.equal(await page.inputValue('#kv_kv'), '150');
  assert.deepEqual(await page.locator('.cells[data-series="kv_tp_R1"] input').evaluateAll((els) => els.map((e) => e.value)), ['2,10', '', '']);
  assert.ok(await page.locator('#kv-timer-from').isHidden());
  // ввод в разделе 3 — в таблице тоже
  await page.locator('.cells[data-series="kv_tp_R2"] input').nth(1).fill('20,12');
  await pause();
  assert.equal(await page.inputValue('#kvt1_kv_tp_R2_1'), '20,12');

  // допуск 0,5 с: оба режима больше допуска — предупреждение в замечаниях и под таблицей
  await page.fill('#kv_tau_tol', '0,5');
  await pause();
  assert.match(await dot(0).getAttribute('class'), /\bwarn\b/);
  assert.equal(await dot(0).getAttribute('title'), '|τ| больше допуска 0,5 с');
  assert.match(await dot(1).getAttribute('class'), /\bok\b/);
  assert.equal(await text('#kv-timer-note'), 'Допуск |τ| ≤ 0,5 с (по методике учреждения): больше допуска — режим 1.');
  await page.fill('#kv_tau_tol', '0,25');
  await pause();
  assert.equal(await text('#kv-timer-note'), 'Допуск |τ| ≤ 0,25 с (по методике учреждения): больше допуска — режимы 1, 2.');
  assert.match(await text('#kv-messages'), /\|τ\| = 0,30 с больше допуска 0,25 с \(раздел 3\)/);
  assert.match(await page.locator('#kv_tau_tol').getAttribute('class'), /flag-warn/);

  // протокол: таблица таймера по режимам с допуском
  await page.click('#kv-btn-copy-report');
  await pause();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /\nОшибка таймера по режимам \(допуск \|τ\| ≤ 0,25 с — по методике учреждения\):\n {2}Режим 1 \(200 кВ, СПО 1,00 мм Cu\): T₁ = 6 с: 2,393; 2,394; 2,393 нКл; T₂ = 60 с: 21,95; 21,95; 21,96 нКл; τ = \+0,61 с \(больше допуска 0,25 с\)\n {2}Режим 2 \(150 кВ, СПО 0,50 мм Cu\): T₁ = 6 с: 2,10 нКл; T₂ = 60 с: 20,10; 20,12 нКл; τ = \+0,30 с \(больше допуска 0,25 с\)\n/);
  assert.match(report, /Задание облучения: X = 1,00 мин; τ = 0,0049 мин \(по двум заданиям: T₁ = 6 с \(2,10 нКл\), T₂ = 60 с \(20,10; 20,12 нКл\), τ = \+0,30 с, больше допуска 0,25 с\)/);

  // другой способ в режиме 2 — в таблице строкой-пояснением; известное τ проверяется по допуску
  await page.selectOption('#kv_timer_mode', 'manual');
  await page.fill('#kv_tau', '0,002');
  await pause();
  assert.equal(await row(1).locator('td.other').innerText(), 'известное значение — выше, в разделе 3 этого режима');
  assert.equal(await tau(1), '+0,12 с');
  assert.match(await dot(1).getAttribute('class'), /\bok\b/);
  await page.selectOption('#kv_timer_mode', 'twopoint');
  await pause();

  // черновик: после перезагрузки те же показания режима 2 и допуск
  await page.reload();
  await page.waitForSelector('#kv-messages li');
  assert.equal(await page.inputValue('#kvt1_kv_tp_R2_1'), '20,12');
  assert.equal(await page.inputValue('#kv_tau_tol'), '0,25');

  // по-английски — без кириллицы в разделе 3
  await page.locator('#lang_en').check();
  await pause(600);
  const s3 = await page.locator('section[aria-labelledby="kv-s3"]').innerText();
  assert.deepEqual(s3.split('\n').filter((l) => /[А-Яа-яЁё]/.test(l)), []);
  assert.equal(await tau(0), '+0.61 s');
  assert.equal(await text('#kv-timer-note'), 'Tolerance |τ| ≤ 0.25 s (local procedure): exceeded in modes 1, 2.');
  assert.equal(await page.inputValue('#kvt0_kv_tp_R1_0'), '2.393');
  await page.locator('#lang_ru').check();
  await pause(300);
  assert.deepEqual(errors, []);
});

test('kV-рентген: ошибка таймера по режимам на телефоне — карточки без горизонтальной прокрутки страницы', async () => {
  const { page, errors } = await openPage(browser, { mobile: true, viewport: { width: 390, height: 844 } });
  await page.goto(`${server.url}/index.html#kv`);
  await page.waitForSelector('#kv-messages li');
  await page.click('#kv-btn-sample');
  await page.waitForTimeout(300);
  await page.locator('#kv-timer-block').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  assert.equal(await page.locator('#kv-timer-table thead').isVisible(), false);
  const cap = await page.locator('#kv-timer-body tr[data-m="0"] td.r1').evaluate((e) => getComputedStyle(e, '::before').content);
  assert.equal(cap, '"Показания при T₁, нКл"');
  // поле показания не уже 40 px
  const w = await page.locator('#kvt0_kv_tp_R1_0').evaluate((e) => e.getBoundingClientRect().width);
  assert.ok(w >= 40, String(w));
  assert.deepEqual(errors, []);
});
