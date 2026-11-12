// Журнал в общей папке, открытый на двух компьютерах: изменения другого компьютера подгружаются сами (опрос файла и
// возврат на вкладку) и сливаются с изменениями этого браузера по записям; одно и то же поле — выбор версии.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage, fsState } from './helpers.js';

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

/** «Другой компьютер» правит файл: fn(журнал) → журнал; время изменения — позже. */
const otherComputer = (page, name, fn, ahead = 60000) =>
  page.evaluate(([n, src, a]) => {
    const s = window.__fs.load();
    // eslint-disable-next-line no-new-func
    const j = new Function('j', src)(JSON.parse(s.files[n].text));
    s.files[n] = { text: JSON.stringify(j), lastModified: Date.now() + a };
    window.__fs.save(s);
  }, [name, fn, ahead]);
// возврат на вкладку — как переключение на неё с другого окна
const focusBack = (page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

test('журнал в общей папке: подгрузка и слияние изменений другого компьютера', async () => {
  const { page, errors } = await openPage(browser);
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq-file h2');
  const panel = page.locator('#eq-file');
  const line = () => panel.locator('.jfile-line').innerText();
  const fileText = async (name) => JSON.parse((await fsState(page)).files[name].text);
  await page.fill('#eq_institution', 'Тест');
  await page.waitForTimeout(300);
  await panel.locator('[data-jf=saveas]').click();
  await page.waitForTimeout(500);
  const name = 'журнал_Тест.json';
  assert.ok((await fsState(page)).files[name]);
  assert.match(await panel.innerText(), /каждые 15 секунд/);

  // 1. здесь правок нет: другой компьютер добавил электрометр — при возврате на вкладку он здесь
  await otherComputer(page, name, "j.electrometers.push({ id: 'e-other', form: { el_model: 'UNIDOS', el_serial: '111' }, calDate: '', dueDate: '', notes: '' }); return j;");
  await focusBack(page);
  await page.waitForTimeout(600);
  assert.match(await line(), /обновлён из файла \(изменения другого компьютера\)/);
  assert.match(await page.locator('#module-equipment').innerText(), /UNIDOS/);

  // 2. правки с обеих сторон в разных местах: здесь — отделение, там — ещё электрометр; сливаются и записываются
  await otherComputer(page, name, "j.electrometers.push({ id: 'e-other2', form: { el_model: 'Dose 1', el_serial: '222' }, calDate: '', dueDate: '', notes: '' }); return j;", 120000);
  await page.fill('#eq_department', 'Отделение 2');
  await page.waitForTimeout(2500);
  const f = await fileText(name);
  assert.equal(f.department, 'Отделение 2');
  assert.deepEqual(f.electrometers.map((e) => e.id).filter((id) => id.startsWith('e-other')), ['e-other', 'e-other2']);
  assert.match(await line(), /слиты/);
  assert.doesNotMatch(await panel.innerText(), /Взять версию из файла/);

  // 3. одно и то же поле изменено по-разному — выбор версии с подписью, что разошлось
  await otherComputer(page, name, "j.department = 'Чужое отделение'; return j;", 180000);
  await page.fill('#eq_department', 'Моё отделение');
  await page.waitForTimeout(2500);
  assert.equal((await fileText(name)).department, 'Чужое отделение');
  assert.match(await line(), /файл изменён в другом месте/);
  assert.match(await panel.innerText(), /Разошлись: отделение/);
  await panel.locator('[data-jf=take-file]').click();
  await page.waitForTimeout(500);
  assert.equal(await page.inputValue('#eq_department'), 'Чужое отделение');
  assert.deepEqual(errors, []);
});
