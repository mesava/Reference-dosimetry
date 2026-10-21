// Правки по первому отзыву коллег (0.26.0): порядок разделов (T и P прямо перед контрольными измерениями), строка итога
// в разделах показаний и контрольных измерений, TPR20,10 «уже известен», геометрия словами, нестандартный k_Q по
// Report 385 для PTW 23343 Markus, подписи камер по табл. 4 TRS-398 Rev.1; английский интерфейс этих мест.
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

const titles = (page, mod) => page.locator(`#module-${mod} .step:not([hidden]) > header h2`).allInnerTexts();
const before2 = (list, a, b) => list.findIndex((t) => t.startsWith(a)) + 1 === list.findIndex((t) => t.startsWith(b));

test('дозиметрия: T и P перед контрольными измерениями, строка итога, TPR известен, Markus по Report 385, подписи камер', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 400) => page.waitForTimeout(ms);

  // МВ фотоны
  await page.goto(`${server.url}/index.html#photons`);
  await page.waitForSelector('#messages li');
  await page.click('#btn-sample');
  await pause();
  const ph = await titles(page, 'photons');
  assert.ok(before2(ph, 'Температура и давление', 'Контрольные измерения'), ph.join(' | '));
  assert.ok(ph.findIndex((t) => t.startsWith('Показания электрометра')) === 2, 'показания — раздел 3');
  const big = await page.locator('#dose-rows .dose-big').first().innerText();
  const value = big.match(/[\d,]+/)[0];
  for (const id of ['s4', 's7c']) {
    const line = await page.locator(`section[aria-labelledby="${id}"] [data-inline-result]`).innerText();
    assert.ok(line.includes(value), `строка итога в ${id}: «${line}» без ${value}`);
    assert.match(line, /по показанию M₁ раздела 3/);
  }
  assert.match(await page.locator('#geom-view').innerText(), /РИП 100 см, поле 10 × 10 см на поверхности воды, камера на глубине 10 см/);
  // TPR20,10 уже известен: поля M на 20 и 10 см скрыты, доза та же
  const tpr = await page.locator('output[data-out="trs.tpr"]').innerText();
  await page.selectOption('#qtrs_method', 'known');
  await page.fill('#qtrs_tpr', tpr);
  await pause();
  assert.ok(await page.locator('#qtrs_v20').isHidden());
  assert.equal((await page.locator('#dose-rows .dose-big').first().innerText()).match(/[\d,]+/)[0], value);
  // подписи камер: FC65-G и FC65-P — по табл. 4 Rev.1
  const opts = await page.locator('#ch_model option').allInnerTexts();
  assert.ok(opts.some((o) => /FC65-G — Фармер 0,65 см³, стенка графит/.test(o)), opts.filter((o) => /FC65/.test(o)).join(' | '));
  assert.ok(opts.some((o) => /FC65-P — Фармер 0,65 см³, стенка POM/.test(o)));
  assert.ok(opts.some((o) => /2571 — .*не водонепроницаема, нужен чехол/.test(o)));

  // Электроны: Markus 23343 при калибровке в ⁶⁰Co — нестандартный k_Q по Report 385
  await page.goto(`${server.url}/index.html#electrons`);
  await pause();
  await page.click('#e-btn-sample');
  await pause();
  const el = await titles(page, 'electrons');
  assert.ok(before2(el, 'Температура и давление', 'Контрольные измерения'), el.join(' | '));
  await page.selectOption('#e_ch_model', 'MARKUS');
  await pause();
  assert.match(await page.locator('#e-dose-rows').innerText(), /Исправьте ошибки/);
  await page.selectOption('#e_kqtrs_mode', 'r385');
  await pause();
  assert.match(await page.locator('section[aria-labelledby="e-s5"] [data-inline-result]').innerText(), /Гр на 100 МЕ/);
  assert.match(await page.locator('#e-compliance').innerText(), /Нестандартные условия[\s\S]*Report 385/);
  assert.match(await page.locator('#e-messages').innerText(), /Нестандартный расчёт/);

  // ⁶⁰Co
  await page.goto(`${server.url}/index.html#co60`);
  await pause();
  await page.click('#co-btn-sample');
  await pause();
  const co = await titles(page, 'co60');
  assert.ok(before2(co, 'Температура и давление', 'Контрольные измерения'), co.join(' | '));
  assert.match(await page.locator('section[aria-labelledby="co-s6c"] [data-inline-result]').innerText(), /сГр\/мин .* от ожидаемой/);

  // по-английски: строки итога и новые подписи без кириллицы
  await page.goto(`${server.url}/index.html#photons`);
  await page.locator('#lang_en').check();
  await pause(600);
  const en = [
    await page.locator('section[aria-labelledby="s7c"] [data-inline-result]').innerText(),
    await page.locator('#geom-view').innerText(),
    await page.locator('#qtrs_method option[value="known"]').innerText(),
    await page.locator('section[aria-labelledby="s7c"] > header .hint').innerText(),
  ];
  assert.deepEqual(en.filter((t) => CYR.test(t)), []);
  assert.deepEqual(errors, []);
});
