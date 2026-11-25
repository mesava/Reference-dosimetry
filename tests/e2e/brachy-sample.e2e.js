// Пример вкладки «Брахитерапия» (0.77.0): загрузка двумя нажатиями, все листы считаются, протокол заполнен.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage } from './helpers.js';

// результат листа и замечания справа (с 0.79.0 замечания — в панели «Замечания»)
const resText = async (page) => `${await page.locator('#br-result').innerText()}\n${await page.locator('#br-messages').innerText()}`;
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

test('брахитерапия: пример заполняет все листы, результаты и протокол', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 250) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#brachy/well`);
  await page.waitForSelector('[data-br="sample"]');
  await page.click('[data-br="sample"]');
  await page.click('[data-br="sample"]');
  await pause();
  assert.match(await page.locator('#brachy-status').innerText(), /Загружен демонстрационный пример/);
  assert.match(await page.locator('#brachy-root .demo-flag').innerText(), /демонстрационный пример/);
  assert.match(await resText(page), /35,3\d* мГр\/ч на 1 м[\s\S]*\+0,3\d* % от сертификата/);
  // три введения (TRS-492, разд. 8.2.2) и согласие с сертификатом при k = 2 (разд. 8.6.2.1)
  assert.match(await resText(page), /3 введения: 71,340*; 71,360*; 71,340*/);
  assert.match(await page.locator('#br-unc-sum').innerText(), /Согласие с сертификатом \(k = 2\)\s+\+0,3\d % \/ ±\d,\d\d %\s*согласуются/);
  const expect = {
    sweet: /Максимум отклика\s+1229,9 мм/,
    phantom: /мГр\/ч на 1 м[\s\S]*от сертификата/,
    cross: /N рабочей камеры\s+5000\d\d Гр·м²·ч⁻¹·А⁻¹[\s\S]*от прежнего/,
    stab: /Отклонение от исходного\s+[−+]0,\d\d %\s*в пределах ±0,5 %/,
    decay: /\d/,
    tg43: /Ḋw,1 = Λ · SK/,
  };
  for (const [sh, re] of Object.entries(expect)) {
    await page.click(`#brachy-root a[data-goto="brachy/${sh}"]`);
    await pause(400);
    const res = await resText(page);
    assert.match(res, re, sh);
    assert.equal(await page.locator('#br-messages li.error').count(), 0, `${sh}: без ошибок`);
    if (await page.locator('.br-prot-det').count()) {
      if (!(await page.locator('.br-prot-det').evaluate((d) => d.open))) await page.click('.br-prot-det > summary');
      await pause();
      assert.match(await page.locator('#br-prot').innerText(), /Заключение[\s\S]*Примечания\s+Демонстрационные данные/, `${sh}: протокол`);
    }
  }
  // подписи внизу листа (0.77.1): протокол фантома — на двух листах, блок подписей опускается к низу второго
  await page.click('#brachy-root a[data-goto="brachy/phantom"]');
  await pause(400);
  // в протоколе фантома — только основной вариант, без столбца «Основной» (0.80.5); на листе — все
  assert.ok((await page.locator('#br-result table.br-variants tbody tr').count()) > 1);
  assert.equal(await page.locator('#br-prot table.br-variants tbody tr').count(), 1);
  assert.doesNotMatch(await page.locator('#br-prot table.br-variants thead').innerText(), /Основной/);
  await page.evaluate(() => { window.print = () => {}; });
  await page.click('[data-br="prot-print"]');
  await pause();
  const pad = await page.locator('#br-prot .prot-end').evaluate((e) => parseFloat(e.style.paddingTop) || 0);
  assert.ok(pad > 300, `отступ над подписями ${pad}`);
  assert.ok(await page.evaluate(() => document.body.classList.contains('print-br-protocol')));
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  assert.equal(await page.locator('#br-prot .prot-end').evaluate((e) => e.style.paddingTop), '');
  // короткий протокол (стабильность) — на одном листе, подписи сразу за текстом
  await page.click('#brachy-root a[data-goto="brachy/stab"]');
  await pause(400);
  await page.click('[data-br="prot-print"]');
  await pause();
  assert.equal(await page.locator('#br-prot .prot-end').evaluate((e) => e.style.paddingTop), '');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  assert.deepEqual(errors, []);
});
