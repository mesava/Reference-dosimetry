// Геометрия калибровки дозы аппарата: задаётся в «Оборудовании» для всех пучков фотонов (электронов), подставляется
// во вкладку при выборе пучка журнала; другая геометрия, сохранённая из вкладки, становится своей у пучка.
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

const CYR = /[А-Яа-яЁё]/;

test('геометрия калибровки аппарата: в пучки «как у аппарата», во вкладку; своя у пучка после сохранения из вкладки', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq_department');
  await page.click('#eq-add-machine');
  await pause();
  const machine = page.locator('[data-card^="machine:"]');
  await machine.locator('input[data-bind$="|name"]').fill('Versa HD');
  // по умолчанию — РИП 100 см, номинал на d_max; аппарат калибруют по РИО на 10 см
  assert.equal(await machine.locator('select[data-bind$="|calGeo.photon.setup_geometry"]').inputValue(), 'SSD');
  await machine.locator('select[data-bind$="|calGeo.photon.setup_geometry"]').selectOption('SAD');
  await pause();
  await page.locator('[data-card^="machine:"] select[data-bind$="|calGeo.photon.dd_nominal_at"]').selectOption('zref');
  await pause();
  for (const name of ['6 МВ', '10 МВ']) {
    await page.locator('[data-add-beam]').click();
    await pause();
    await page.locator('[data-card^="beam:"] input[data-bind$="|name"]').last().fill(name);
  }
  await page.locator('[data-add-ebeam]').click();
  await pause();
  const geo = page.locator('[data-card^="beam:"] select[data-bind$="|geoOwn"]');
  assert.equal(await geo.count(), 3);
  assert.match(await geo.nth(0).locator('option:checked').innerText(), /как у аппарата: РИО 100 см, номинал на z_?ref/);
  assert.match(await geo.nth(2).locator('option:checked').innerText(), /как у аппарата: РИП 100 см, номинал на z_?max/);

  // вкладка «МВ фотоны»: выбор пучка журнала подставляет геометрию аппарата
  await page.goto(`${server.url}/index.html#photons`);
  await page.waitForSelector('#messages li');
  const bind = page.locator('#ph-jbind');
  await bind.locator('[data-jb=machine]').selectOption({ label: 'Versa HD' });
  await pause();
  await bind.locator('[data-jb=beam]').selectOption({ label: '6 МВ' });
  await pause(500);
  assert.equal(await page.inputValue('#setup_geometry'), 'SAD');
  assert.equal(await page.inputValue('#dd_nominal_at'), 'zref');
  assert.match(await bind.innerText(), /Геометрия калибровки — РИО 100 см, номинал на z_?ref \(как у аппарата\)/);
  // выбор в списке остаётся: другая геометрия во вкладке — предупреждение под результатом
  await page.selectOption('#setup_geometry', 'SSD');
  await pause(500);
  assert.match(await page.locator('#ph-jrec').innerText(), /Геометрия во вкладке \(РИП 100 см, номинал на z_?ref\) отличается от геометрии калибровки пучка/);
  // сохранить настройки пучка — у пучка своя геометрия
  await page.locator('#ph-jrec [data-jr=settings]').click();
  await pause(500);
  assert.match(await page.locator('body').innerText(), /у пучка теперь своя геометрия/);

  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq_department');
  await pause();
  assert.equal(await geo.nth(0).inputValue(), 'own');
  assert.match(await geo.nth(0).locator('option:checked').innerText(), /своя: РИП 100 см, номинал на z_?ref/);
  assert.equal(await geo.nth(1).inputValue(), '');
  // смена геометрии аппарата: подсказка о номиналах, пучок со своей геометрией не меняется
  await page.locator('[data-card^="machine:"] select[data-bind$="|calGeo.photon.dd_nominal_at"]').selectOption('dmax');
  await pause();
  assert.match(await page.locator('#eq-status').innerText(), /Подставлена в пучки: 10 МВ\. Номинальный выход зависит от геометрии/);
  assert.match(await geo.nth(1).locator('option:checked').innerText(), /РИО 100 см, номинал на d_?max \(через TMR\)/);
  assert.match(await geo.nth(0).locator('option:checked').innerText(), /своя: РИП 100 см, номинал на z_?ref/);
  // вернуть пучок к «как у аппарата»
  await geo.nth(0).selectOption('');
  await pause();
  assert.match(await geo.nth(0).locator('option:checked').innerText(), /как у аппарата: РИО 100 см, номинал на d_?max/);

  // по-английски — без кириллицы в карточке аппарата (кроме введённых названий)
  await page.locator('#lang_en').check();
  await pause(500);
  const lines = (await page.locator('[data-card^="machine:"]').innerText()).split('\n').filter((l) => CYR.test(l) && !/МВ|МэВ/.test(l));
  assert.deepEqual(lines, []);
  assert.deepEqual(errors, []);
});
