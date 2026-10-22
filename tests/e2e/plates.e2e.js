// «Дозиметрия» → «В пластинах»: привязка пластин к калибровке пучка в воде, проверка выхода, запись в журнал,
// раздел «Проверки в пластинах» во вкладке «Журнал и тренды».
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

// обезличенный журнал: аппарат с пучком фотонов (калибровка в воде записана) и пучком электронов без калибровки
const JOURNAL = {
  app: 'reference-dosimetry',
  module: 'journal',
  version: 1,
  institution: 'Отделение',
  machines: [{ id: 'm1', name: 'Аппарат 1', kind: 'linac', beams: [{ id: 'b1', kind: 'photon', name: '6 МВ' }, { id: 'b2', kind: 'electron', name: '9 МэВ' }] }],
  chambers: [],
  electrometers: [],
  sessions: [{ id: 's1', machineId: 'm1', date: '2026-10-20', mode: 'cal', protocol: 'trs', beams: [{ beamId: 'b1', summary: { ok: true, value: 0.804, deviation: 0.5, tol: 2, status: 'ok', at: 'dmax' } }] }],
};

test('в пластинах: привязка к калибровке в воде, проверка выхода и запись в журнал', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#start`);
  await page.waitForSelector('#start-root .start-card');
  assert.match(await page.locator('#start-root').innerText(), /Сеанс — пучки аппарата[\s\S]*Не референсные условия[\s\S]*В пластинах — проверка выхода/);

  // без журнала — в «Оборудование»
  await page.goto(`${server.url}/index.html#plates`);
  await pause();
  assert.match(await page.locator('#plates-root').innerText(), /нужны аппарат и его пучки в журнале/);
  assert.deepEqual((await page.locator('#module-plates .subtools a').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()), ['⁶⁰Co', 'МВ фотоны', 'Электроны', 'kV-рентген в разработке', 'Брахитерапия в разработке', 'Сеанс', 'В пластинах']);

  await page.evaluate((j) => localStorage.setItem('reference-dosimetry.journal.v1', JSON.stringify({ journal: j })), JOURNAL);
  await page.reload();
  await page.waitForSelector('#plates-root .plates-card');
  const root = page.locator('#plates-root');
  assert.match(await root.innerText(), /Нестандартные условия[\s\S]*не референсная дозиметрия по TRS-398 Rev\.1/);

  // привязка: калибровка 20.10.2026 предложена, плотность и толщина обязательны
  assert.match(await root.locator('#plb_cal').innerText(), /20\.10\.2026 · TRS-398 Rev\.1/);
  await page.fill('#plb_amount', '100');
  await page.fill('#plb_T', '21');
  await page.fill('#plb_P', '101,3');
  for (let i = 0; i < 3; i++) await page.fill(`#plb-M_${i}`, '20,00');
  await root.locator('[data-pl=bind]').click();
  await pause();
  assert.match(await page.locator('#plates-status').innerText(), /измеренную плотность/);
  await page.fill('#plb_rho', '1,045');
  await page.fill('#plb_depth', '5');
  assert.match(await root.locator('#plb-zw').innerText(), /5,23 г\/см²/);
  await root.locator('[data-pl=bind]').click();
  await pause();
  const bound = await root.innerText();
  assert.match(bound, /Калибровка в воде\s+20\.10\.2026 · TRS-398 Rev\.1 · 0,8040 сГр\/МЕ/);
  assert.match(bound, /Белый полистирол/);

  // проверка: выход выше на ≈2,1 % от калибровки — вне допуска ±2 % от номинала
  await page.fill('#plc_date', '2026-10-22');
  await page.fill('#plc_T', '22');
  await page.fill('#plc_P', '100');
  for (let i = 0; i < 3; i++) await page.fill(`#plc-M_${i}`, '20,10');
  await pause();
  const res = await root.locator('#plc-result').innerText();
  assert.match(res, /M\s*pl\s*\/\s*M\s*pl,0\s*=\s*1,0215/);
  assert.match(res, /0,8213 сГр\/МЕ/);
  assert.match(res, /\+2,66 % от номинала/);
  assert.match(res, /вне допуска[\s\S]*проверьте выход в воде/);
  await root.locator('[data-pl=record]').click();
  await pause();
  assert.match(await page.locator('#plates-status').innerText(), /22\.10\.2026 записана в журнал/);
  assert.match(await root.innerText(), /22\.10\.2026\s+1,0215\s+0,8213\s+\+2,66 %/);
  const journal = await page.evaluate(() => JSON.parse(localStorage.getItem('reference-dosimetry.journal.v1')).journal);
  assert.equal(journal.plateChecks.length, 1);
  assert.equal(journal.machines[0].beams[0].plates.calSessionId, 's1');
  // записи в воде не изменились
  assert.equal(journal.sessions.length, 1);

  // пучок электронов без калибровки в воде: привязать нельзя
  await page.selectOption('#pl_beam', 'b2');
  await pause();
  assert.match(await root.innerText(), /нет калибровки в воде в журнале/);

  // «Журнал и тренды»: раздел «Проверки в пластинах»
  await page.goto(`${server.url}/index.html#history`);
  await pause();
  assert.ok(await page.locator('#hs-plates-sec').isVisible());
  assert.match(await page.locator('#hs-plates').innerText(), /22\.10\.2026\s+6 МВ\s+1,0215\s+\+2,66 %/);

  assert.deepEqual(errors, []);
});
