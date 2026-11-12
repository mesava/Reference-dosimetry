// «Оборудование» → «Учреждение»: сотрудники отделения (с 0.56.0) — список в журнале, подсказки в полях сотрудников
// вкладок дозиметрии (можно ввести и другого); поле «Подразделение» во всю ширину листа.
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

test('сотрудники отделения: заводятся в «Оборудовании», предлагаются во вкладках, другой вводится вручную', async () => {
  const { page, errors } = await openPage(browser);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq-staff-list input');
  const pause = () => page.waitForTimeout(250);

  // подразделение во всю ширину листа
  const wInst = (await page.locator('#eq_institution').boundingBox()).width;
  const wDep = (await page.locator('#eq_department').boundingBox()).width;
  assert.ok(wDep >= wInst && wDep > 500, `подразделение ${wDep} px, учреждение ${wInst} px`);

  await page.locator('#eq_staff_0').fill('Иванов И. И.');
  await page.click('#eq-add-staff');
  await pause();
  await page.locator('#eq_staff_1').fill('Петрова А. С.');
  await page.click('#eq-add-staff');
  await pause();
  await page.locator('#eq_staff_2').fill('Сидоров П. П.');
  await pause();
  assert.equal(await page.locator('#eq-staff-list [data-staff-del]').count(), 3);
  // убрать — кнопкой «−»
  await page.locator('#eq-staff-list [data-staff-del]').nth(2).click();
  await pause();
  assert.deepEqual(await page.locator('#eq-staff-list input').evaluateAll((els) => els.map((x) => x.value)), ['Иванов И. И.', 'Петрова А. С.']);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('reference-dosimetry.journal.v1')).journal.staff.map((x) => x.name));
  assert.deepEqual(saved, ['Иванов И. И.', 'Петрова А. С.']);

  // вкладка «МВ фотоны»: пустое поле сотрудника — при входе список отделения
  for (const [hash, box] of [['photons', '#staff-list'], ['electrons', '#e-staff-list'], ['co60', '#co-staff-list'], ['kv', '#kv-staff-list']]) {
    await page.goto(`${server.url}/index.html#${hash}`);
    const inp = page.locator(`${box} .staff-input`).first();
    await inp.fill('');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await inp.focus();
    const menu = page.locator(`${box} .combo-menu`).first();
    await menu.waitFor({ state: 'visible' });
    const items = await menu.locator('.combo-item.fixed .combo-pick').allInnerTexts();
    assert.deepEqual(items, ['Иванов И. И.', 'Петрова А. С.'], hash);
    assert.equal(await menu.locator('.combo-item.fixed .combo-del').count(), 0, 'сотрудников отделения из списка у поля не удаляют');
    await menu.locator('.combo-item.fixed .combo-pick', { hasText: 'Петрова' }).click();
    assert.equal(await inp.inputValue(), 'Петрова А. С.');
  }
  // другой сотрудник — вручную
  await page.goto(`${server.url}/index.html#photons`);
  await page.click('#btn-add-staff');
  const second = page.locator('#staff-list .staff-input').nth(1);
  await second.fill('Кузнецов К. К.');
  await second.press('Tab');
  assert.equal(await second.inputValue(), 'Кузнецов К. К.');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('reference-dosimetry.journal.v1')).journal.staff.map((x) => x.name)), ['Иванов И. И.', 'Петрова А. С.'], 'журнал не меняется');
  assert.deepEqual(errors, []);
});
