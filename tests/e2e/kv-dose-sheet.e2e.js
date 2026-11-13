// Лист «Поглощённая доза» kV (0.59.0): раздел 5 «k_pol и k_s» — серии режима; тонкооконная камера до 100 кВ — k_pol =
// k_s = 1 без серий (флажок «Всё же измерить»); разделов «Температура и давление» и «Контрольные измерения» нет;
// раздел 6 «Подробно по строке и справочно» свёрнут; при связи с аппаратом из «Оборудования» — столбец «Аппликатор»
// с именем аппликатора и столбец k_Q; число ячеек показаний — у всех строк сразу; по-английски.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage, kvPage, CYR } from './helpers.js';

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

test('kV-рентген: лист «Поглощённая доза» — k_pol и k_s сериями режима, тонкое окно, свёрнутый раздел 6, столбцы «Аппликатор» и k_Q', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv-messages li');
  await page.click('#kv-btn-sample');
  await pause();
  await kvPage(page, 'dose');
  const sheet = await page.locator('#kv-sheet section[data-kv-page="dose"]:visible h2').allInnerTexts();
  assert.deepEqual(sheet.map((t) => t.replace(/\s+/g, ' ').trim()), ['Аппликаторы', 'kpol и ks', 'Подробно по строке и справочно']);

  // раздел 5: серии режима (пример: +V₁ и −V₁ с Ø 10 см), k_pol для всех строк
  assert.ok(await page.locator('#kv-pk-body').isVisible());
  assert.ok(await page.locator('#kv-pk-thin').isHidden());
  assert.ok(await page.locator('#kv-pk-measure-box').isHidden());
  assert.equal(await page.inputValue('#kv_pk_app'), 'Ø 10 см, РИП 50 см');
  assert.equal(await page.inputValue('#kv_pk_Mopp_0'), '-21,93');
  assert.equal(await page.locator('#module-kv output[data-out="trs.kpol"]').first().innerText(), '0,9995');
  // раздел 6 свёрнут; итог — по показаниям строки таблицы
  assert.equal(await page.locator('#kv-detail-box').evaluate((d) => d.open), false);
  assert.match(await page.locator('#kv-detail-sum').innerText(), /Расчёт строки 1 \(Ø 10 см/);
  assert.match(await page.locator('#kv-dose-rows').innerText(), /1,0010\s*Гр\/мин[\s\S]*По показаниям строки таблицы \(раздел 4\)/);

  // число ячеек показаний — у всех строк
  const cells = () => page.locator('#kv-rows tbody tr:first-child [data-k="kv_M1"]').count();
  assert.equal(await cells(), 3);
  await page.click('#kv-mcells-add');
  await pause();
  assert.equal(await cells(), 4);
  assert.equal(await page.locator('#kv-rows tbody tr:nth-child(2) [data-k="kv_M1"]').count(), 4);
  await page.click('#kv-mcells-remove');
  await pause();
  assert.equal(await cells(), 3);

  // тонкооконная камера до 100 кВ: k_pol = k_s = 1, серий нет
  await kvPage(page, 'modes');
  await page.selectOption('#kv_range', 'low');
  await page.fill('#kv_kv', '50');
  await page.fill('#kv_hvl', '1,0');
  await page.selectOption('#kv_ch_model', 'PTW23342');
  await pause();
  await kvPage(page, 'dose');
  assert.ok(await page.locator('#kv-pk-thin').isVisible());
  assert.match(await page.locator('#kv-pk-thin').innerText(), /тонкооконная плоскопараллельная камера, режим до 100 кВ: kpol = 1 и ks = 1, серии не снимают[\s\S]*4\.4\.3\.3 а\)/);
  assert.ok(await page.locator('#kv-pk-body').isHidden());
  assert.ok(await page.locator('#kv-pk-measure-box').isVisible());
  assert.match(await page.locator('#kv-messages').innerText(), /k_?pol = 1 и k_?s = 1 не измеряются/);
  // «Всё же измерить» — серии снова видны и считаются
  await page.check('#kv_pk_measure');
  await pause();
  assert.ok(await page.locator('#kv-pk-body').isVisible());
  assert.ok(await page.locator('#kv-pk-thin').isHidden());
  await page.uncheck('#kv_pk_measure');
  await pause();

  // по-английски — без кириллицы
  await page.locator('#lang_en').check();
  await pause(500);
  const cyr = await page.evaluate((re) => {
    const rx = new RegExp(re);
    const out = [];
    for (const sec of document.querySelectorAll('#kv-sheet section[data-kv-page="dose"]')) {
      if (sec.offsetParent === null) continue;
      sec.querySelectorAll('details').forEach((d) => (d.open = true));
      for (const l of sec.innerText.split('\n')) if (rx.test(l)) out.push(l);
    }
    return out;
  }, CYR.source);
  assert.deepEqual(cyr, []);
  assert.match(await page.locator('#kv-pk-thin').innerText(), /thin-window plane-parallel chamber/);
  await page.locator('#lang_ru').check();
  assert.deepEqual(errors, []);
});

test('kV-рентген: режим из «Оборудования» — один столбец «Аппликатор» с именем и столбец k_Q', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv-messages li');
  await page.click('#kv-btn-sample');
  await pause();
  await page.fill('#kv_machine', 'Xstrahl 300');
  await pause();
  await page.locator('#kv-jbind [data-kvj="save"]').click();
  await pause();
  await kvPage(page, 'dose');
  assert.ok(await page.locator('#kv-rows').evaluate((t) => t.classList.contains('linked')));
  assert.equal(await page.locator('#kv-rows-h-app').innerText(), 'Аппликатор');
  assert.ok(await page.locator('#kv-rows th.ssd').isHidden());
  const names = await page.locator('#kv-rows .kv-app-name').allInnerTexts();
  assert.equal(names.length, 3);
  assert.ok(names.every((n) => n.trim().length > 0), names.join(' | '));
  assert.equal(await page.locator('#kvr0_kv_cone').count(), 0);
  const kq = await page.locator('#kv-rows tbody tr:first-child [data-o="kq"]').innerText();
  assert.match(kq, /^\d,\d{4,6}$/);
  assert.match(await page.locator('#kv-rows-h-kq').innerText(), /k\s*Q|N\s*D,w,Q/);
  assert.deepEqual(errors, []);
});
