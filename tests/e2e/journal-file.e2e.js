// Файл журнала в браузере: «Сохранить как…», автосохранение, папка копий, правка файла в другом месте (конфликт и выбор
// версии), «Продолжить с файлом» после перезагрузки, отключённое автосохранение, «Новый журнал», сбой записи и повтор.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage, fsState, changeElsewhere } from './helpers.js';

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

test('файл журнала: сохранение, автосохранение, копии, конфликт, восстановление связи, сбой записи', async () => {
  const { page, errors } = await openPage(browser);
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq-file h2');
  const panel = page.locator('#eq-file');
  const line = () => panel.locator('.jfile-line').innerText();
  const fileText = async (name) => JSON.parse((await fsState(page)).files[name].text);
  assert.match(await panel.innerText(), /Откройте или сохраните его один раз/);

  // 1. правка и «Сохранить как…»
  await page.fill('#eq_institution', 'Тест');
  await page.waitForTimeout(300);
  assert.match(await line(), /несохранённые изменения/);
  await panel.locator('[data-jf=saveas]').click();
  await page.waitForTimeout(500);
  const name = Object.keys((await fsState(page)).files).find((k) => !k.startsWith('backups/'));
  assert.equal(name, 'журнал_Тест.json');
  assert.equal((await fileText(name)).institution, 'Тест');
  assert.match(await line(), /сохранён/);

  // 2. папка копий: копия сразу
  await panel.locator('[data-jf=backup-dir]').click();
  await page.waitForTimeout(500);
  let backups = Object.keys((await fsState(page)).files).filter((k) => k.startsWith('backups/'));
  assert.equal(backups.length, 1);
  assert.ok(backups[0].startsWith('backups/журнал_Тест_'));

  // 3. автосохранение — без новой копии (копии не чаще раза в час)
  await page.fill('#eq_institution', 'Тест 2');
  await page.waitForTimeout(2500);
  assert.equal((await fileText(name)).institution, 'Тест 2');
  backups = Object.keys((await fsState(page)).files).filter((k) => k.startsWith('backups/'));
  assert.equal(backups.length, 1);

  // 4. файл изменили в другом месте, а здесь правка: чужая версия не перезаписывается, предлагается выбор
  await changeElsewhere(page, name, { institution: 'Чужое' });
  await page.fill('#eq_institution', 'Моё');
  await page.waitForTimeout(2500);
  assert.equal((await fileText(name)).institution, 'Чужое');
  assert.match(await line(), /файл изменён в другом месте/);
  await panel.locator('[data-jf=take-file]').click();
  await page.waitForTimeout(500);
  assert.equal(await page.inputValue('#eq_institution'), 'Чужое');

  // 5. «Записать мою поверх» — только вторым нажатием
  await changeElsewhere(page, name, { institution: 'Чужое 2' }, 120000);
  await page.fill('#eq_institution', 'Моё 2');
  await page.waitForTimeout(2500);
  await panel.locator('[data-jf=keep-mine]').click();
  await page.waitForTimeout(200);
  assert.equal((await fileText(name)).institution, 'Чужое 2', 'после первого нажатия не записано');
  await panel.locator('[data-jf=keep-mine]').click();
  await page.waitForTimeout(600);
  assert.equal((await fileText(name)).institution, 'Моё 2');

  // 6. перезагрузка: «Продолжить с файлом», папка копий снова доступна, автосохранение работает
  await page.reload();
  await page.waitForSelector('#eq-file h2');
  await page.waitForTimeout(500);
  assert.match(await panel.locator('[data-jf=reconnect]').innerText(), /журнал_Тест\.json/);
  await panel.locator('[data-jf=reconnect]').click();
  await page.waitForTimeout(500);
  assert.match(await panel.innerText(), /Копии: папка «backups»/);
  await page.fill('#eq_institution', 'После перезагрузки');
  await page.waitForTimeout(2500);
  assert.equal((await fileText(name)).institution, 'После перезагрузки');

  // 7. перезагрузка; файл изменили в другом месте, здесь правок нет — берётся версия из файла
  await changeElsewhere(page, name, { institution: 'С другого компьютера' }, 300000);
  await page.reload();
  await page.waitForSelector('#eq-file h2');
  await page.waitForTimeout(500);
  await panel.locator('[data-jf=reconnect]').click();
  await page.waitForTimeout(600);
  assert.equal(await page.inputValue('#eq_institution'), 'С другого компьютера');

  // 8. автосохранение выключено — пишет только кнопка
  await panel.locator('[data-jf=autosave]').uncheck();
  await page.fill('#eq_institution', 'Без автосохранения');
  await page.waitForTimeout(2500);
  assert.notEqual((await fileText(name)).institution, 'Без автосохранения');
  await panel.locator('[data-jf=save]').click();
  await page.waitForTimeout(600);
  assert.equal((await fileText(name)).institution, 'Без автосохранения');
  await panel.locator('[data-jf=autosave]').check();

  // 9. сбой записи (доступ к файлу потерян): связь не забывается, «Продолжить с файлом» пробует снова
  await page.evaluate(() => {
    const s = window.__fs.load();
    s.granted = {};
    window.__fs.save(s);
  });
  await page.fill('#eq_institution', 'Сбой');
  await page.waitForTimeout(2500);
  assert.equal(await panel.locator('.jf-error').count(), 1, 'сообщение о сбое записи');
  assert.equal(await panel.locator('[data-jf=reconnect]').count(), 1);
  await panel.locator('[data-jf=reconnect]').click();
  await page.waitForTimeout(2500);
  assert.equal((await fileText(name)).institution, 'Сбой', 'после повтора записано');
  assert.equal(await panel.locator('.jf-error').count(), 0);

  // 10. «Новый журнал» разрывает связь с файлом
  await panel.locator('[data-jf=new]').click();
  await page.waitForTimeout(100);
  await panel.locator('[data-jf=new]').click();
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForSelector('#eq-file h2');
  await page.waitForTimeout(500);
  assert.equal(await panel.locator('[data-jf=reconnect]').count(), 0);
  assert.deepEqual(errors, []);
});
