// «Начало»: с чего начать — пять сценариев работы и куда в каждом идти. Страница строится целиком из этого модуля
// (тексты парами L(…)), поэтому при смене языка просто перерисовывается.
import { L } from '../core/i18n.js';
import { equipmentDue } from '../core/journal.js';
import { $, esc, today, versionText } from './common.js';
import { getJournal, journalFile } from './journal-store.js';
import { fmtDate, countWord } from './journal-common.js';
import { canInstall, onInstallChange, promptInstall } from './pwa.js';
import { BEAM_LOOK } from './look.js';
import { mountSphere } from './sphere.js';

/** Кнопка-ссылка на подраздел: обрабатывается общим переходом (app.js) по data-goto. */
const go = (module, text, { primary = false, sub = '' } = {}) => {
  // кнопки вкладок пучков — в цвете пучка, с пиктограммой (styles.css, data-beam)
  const head = module.split('/')[0];
  const beam = BEAM_LOOK.includes(head) ? ` data-beam="${head}"` : '';
  return `<a class="start-go${primary ? ' primary' : ''}" href="#${module}" data-goto="${module}"${beam}><span>${text}</span>${sub ? `<small>${sub}</small>` : ''}</a>`;
};

/** Строка о состоянии журнала: открыт ли, что в нём, сроки калибровки. */
function journalLine() {
  const j = getJournal();
  const f = journalFile();
  const empty = !j.machines.length && !j.chambers.length && !j.electrometers.length;
  if (empty) {
    return L(
      'Журнал пока пуст: начните с «Оборудования» или откройте файл журнала отделения (кнопка «Открыть журнал» в любом подразделе журнала).',
      'The journal is empty: start with Equipment or open the department journal file (the Open journal button in any journal section).',
    );
  }
  const beams = j.machines.reduce((n, m) => n + m.beams.length, 0);
  const last = j.sessions.at(-1);
  const due = equipmentDue(j, today());
  const overdue = due.filter((d) => d.status === 'overdue').length;
  const parts = [
    f.name ? L(`Журнал «${f.name}»`, `Journal “${f.name}”`) : L('Журнал (ещё не сохранён в файл)', 'Journal (not yet saved to a file)'),
    `${j.machines.length} ${countWord(j.machines.length, [L('аппарат', 'machine'), L('аппарата', 'machines'), L('аппаратов', 'machines')], ['machine', 'machines'])}, ${beams} ${countWord(beams, [L('пучок', 'beam'), L('пучка', 'beams'), L('пучков', 'beams')], ['beam', 'beams'])}`,
    last ? L(`последняя запись ${fmtDate(last.date)}`, `last record ${fmtDate(last.date)}`) : L('записей пока нет', 'no records yet'),
  ];
  let text = `${parts.join('; ')}.`;
  if (f.conflict) text += L(' Файл журнала изменили в другом месте — выберите версию в панели «Файл журнала».', ' The journal file was changed elsewhere: choose a version in the Journal file panel.');
  else if (f.pending) text += L(` Чтобы изменения снова сохранялись в файл, нажмите «Продолжить с файлом «${f.pending}»» в панели «Файл журнала».`, ` To have changes saved to the file again, click “Continue with “${f.pending}”” in the Journal file panel.`);
  else if (f.dirty) text += L(' Есть изменения, не сохранённые в файл.', ' There are changes not saved to the file.');
  if (overdue) text += L(` Срок калибровки прошёл: ${overdue}.`, ` Calibration overdue: ${overdue}.`);
  else if (due.length) text += L(` Срок калибровки подходит: ${due.length}.`, ` Calibration due soon: ${due.length}.`);
  return text;
}

export function renderStart() {
  const root = $('#start-root');
  if (!root) return;
  root.innerHTML = `
    <section class="hero">
      <div class="hero-text">
        <p class="hero-eyebrow">${esc(L('Референсная дозиметрия · расчёт в браузере · работает без интернета', 'Reference dosimetry · runs in the browser · works offline'))}</p>
        <h2 class="hero-title">${esc(L('Клиническая дозиметрия', 'Clinical dosimetry'))}</h2>
        <p class="hero-lead">${L(
          'Поглощённая доза в воде для пучков <b class="bt" data-beam="co60">⁶⁰Co</b>, <b class="bt" data-beam="photons">МВ фотонов</b>, <b class="bt" data-beam="electrons">электронов</b> и <b class="bt" data-beam="kv">kV-рентгена</b> по TRS-398 Rev.1 и сила источников <b class="bt" data-beam="brachy">брахитерапии</b> по TRS-492 — с протоколом, журналом отделения и трендами.',
          'Absorbed dose to water for <b class="bt" data-beam="co60">⁶⁰Co</b>, <b class="bt" data-beam="photons">MV photon</b>, <b class="bt" data-beam="electrons">electron</b> and <b class="bt" data-beam="kv">kV x-ray</b> beams according to TRS-398 Rev.1 and <b class="bt" data-beam="brachy">brachytherapy</b> source strength according to TRS-492, with a report, the department journal and trends.',
        )}</p>
        <p class="intro hero-sub">${esc(L(
          'Ещё — проверки рентгенотерапевтического аппарата и «Инструменты»: график Яффе, перекрёстная калибровка, кривая дозы электронов, бюджет неопределённости. TG-51 — справочное сравнение: его можно выбрать в шапке на страницах, где он меняет расчёт (⁶⁰Co, МВ фотоны, электроны, «Инструменты»).',
          'Also: x-ray unit checks and Tools: the Jaffé plot, cross-calibration, electron depth dose and the uncertainty budget. TG-51 is a reference comparison: it can be selected in the header on the pages where it changes the calculation (⁶⁰Co, MV photons, electrons, Tools).',
        ))}</p>
        <a class="hero-refs" href="#refs" data-goto="refs">${esc(L('Литература и проверка на независимых данных', 'References and validation on independent data'))} <span aria-hidden="true">→</span></a>
      </div>
      <div class="hero-sphere" id="start-sphere"></div>
    </section>
    <h2 class="start-subhead">${esc(L('С чего начать', 'Where to start'))}</h2>
    <div class="start-cards">
      <section class="start-card" data-card="journal">
        <h3>${esc(L('Работа отделения — журнал', 'Department routine: the journal'))}</h3>
        <p class="start-when">${L(
          '<b>Когда:</b> журнал отделения: аппараты и пучки, афтерлоадеры и их источники, камеры и электрометры, тренды калибровок и проверок выхода, контрольные карты, сроки поверки. Измерения записываются в журнал из «Дозиметрии».',
          '<b>When:</b> the department journal: machines and beams, afterloaders and their sources, chambers and electrometers, trends of calibrations and output checks, control charts, calibration due dates. Measurements are recorded to the journal from Dosimetry.',
        )}</p>
        <ol class="start-steps">
          <li>${go('equipment', esc(L('Оборудование', 'Equipment')), { sub: esc(L('камеры, электрометры, аппараты и пучки — один раз', 'chambers, electrometers, machines and beams, once')) })}</li>
          <li>${go('history', esc(L('Журнал и тренды', 'Journal and trends')), { sub: esc(L('отклонение по датам, k_pol и k_s по калибровкам', 'deviation by date, k_pol and k_s by calibration')).replace(/k_(pol|s)/g, 'k<sub>$1</sub>') })}</li>
        </ol>
        <p class="start-state" role="status">${esc(journalLine())}</p>
      </section>
      <section class="start-card" data-card="dosimetry">
        <h3>${esc(L('Дозиметрия', 'Dosimetry'))}</h3>
        <p class="start-when">${L(
          '<b>Когда:</b> калибровка в воде в референсных условиях TRS-398 Rev.1 — одной энергии или всех энергий аппарата подряд, с подробным протоколом: все поправки со ссылками на протокол, PDF со строками для подписей, файл с данными.',
          '<b>When:</b> calibration in water under TRS-398 Rev.1 reference conditions, of a single energy or of all energies of a machine in a row, with a detailed report: all corrections with protocol references, a PDF with signature lines, a data file.',
        )}</p>
        <p class="start-note">${esc(L('Один пучок:', 'A single beam:'))}</p>
        <div class="start-row">
          ${go('co60', '⁶⁰Co')}
          ${go('photons', esc(L('МВ фотоны', 'MV photons')))}
          ${go('electrons', esc(L('Электроны', 'Electrons')))}
          ${go('kv', esc(L('kV-рентген', 'kV x-rays')))}
        </div>
        <p class="start-note">${esc(L('Все энергии аппарата подряд, каждая записывается в журнал (лист «Сеанс» вкладки):', 'All energies of a machine in a row, each recorded to the journal (the Session sheet of the tab):'))}</p>
        <div class="start-row">
          ${go('photons/session', esc(L('МВ фотоны: сеанс', 'MV photons: session')))}
          ${go('electrons/session', esc(L('Электроны: сеанс', 'Electrons: session')))}
        </div>
        <p class="start-note">${esc(L('Пучок журнала выбирается в разделе 1 вкладки; записанный пучок открывается из журнала кнопкой «Открыть во вкладке».', 'A journal beam is selected in section 1 of the tab; a recorded beam opens from the journal with the Open in the tab button.'))}</p>
        <p class="start-note">${esc(L('Не референсные условия: ежедневная проверка выхода в пластинах относительно калибровки пучка в воде (лист «В пластинах» вкладки):', 'Not reference conditions: a routine output check in plates against the calibration of the beam in water (the In plates sheet of the tab):'))}</p>
        <div class="start-row">
          ${go('co60/plates', esc(L('⁶⁰Co: в пластинах', '⁶⁰Co: in plates')))}
          ${go('photons/plates', esc(L('МВ фотоны: в пластинах', 'MV photons: in plates')))}
          ${go('electrons/plates', esc(L('Электроны: в пластинах', 'Electrons: in plates')))}
        </div>
      </section>
      <section class="start-card" data-card="brachy">
        <h3>${esc(L('Брахитерапия', 'Brachytherapy'))}</h3>
        <p class="start-when">${L(
          '<b>Когда:</b> новый источник HDR/PDR ¹⁹²Ir или ⁶⁰Co и периодическая проверка его силы: колодезной камерой по IAEA TRS-492 или в фантоме PTW 9193 (DGMP-Bericht 13), сравнение с сертификатом, протокол и запись в журнал отделения.',
          '<b>When:</b> a new HDR/PDR ¹⁹²Ir or ⁶⁰Co source and periodic checks of its strength: with a well-type chamber per IAEA TRS-492 or in the PTW 9193 phantom (DGMP-Bericht 13), comparison with the certificate, a report and a record in the department journal.',
        )}</p>
        <ul class="start-steps plain">
          <li>${go('brachy/decay', esc(L('Распад', 'Decay')), { sub: esc(L('ожидаемая сила источника на дату по сертификату', 'expected source strength on a date from the certificate')) })}</li>
          <li>${go('brachy/well', esc(L('Колодезная камера', 'Well-type chamber')), { sub: esc(L('сила источника и отклонение от сертификата', 'source strength and deviation from the certificate')) })}</li>
          <li>${go('brachy/phantom', esc(L('Фантом PTW 9193', 'PTW 9193 phantom')), { sub: esc(L('сила источника и доза в воде по фантому', 'source strength and dose to water in the phantom')) })}</li>
        </ul>
        <p class="start-note">${esc(L('Там же: стабильность и сличение камер, максимум отклика, справочная доза по TG-43. Афтерлоадер и колодезная камера заводятся в «Оборудовании».', 'Also there: stability and chamber intercomparison, the sweet spot, reference TG-43 dose. The afterloader and the well-type chamber are added in Equipment.'))}</p>
      </section>
      <section class="start-card" data-card="prep">
        <h3>${esc(L('Инструменты — до измерений', 'Tools: before measurements'))}</h3>
        <p class="start-when">${L(
          '<b>Когда:</b> новая камера или электрометр, камера без своего свидетельства о калибровке, качество пучка электронов по кривой ионизации.',
          '<b>When:</b> a new chamber or electrometer, a chamber without its own calibration certificate, the electron beam quality from an ionization curve.',
        )}</p>
        <ul class="start-steps plain">
          <li>${go('jaffe', esc(L('График Яффе', 'Jaffé plot')), { sub: esc(L('система камера — кабель — электрометр, рекомбинация', 'chamber, cable and electrometer system; recombination')) })}</li>
          <li>${go('tools', esc(L('Перекрёстная калибровка', 'Cross-calibration')), { sub: esc(L('коэффициент рабочей камеры по опорной', 'the working chamber coefficient against a reference chamber')) })}</li>
          <li>${go('edepth', esc(L('Кривая дозы электронов', 'Electron depth dose')), { sub: esc(L('R₅₀ и PDD(z_ref) по кривой ионизации', 'R₅₀ and PDD(z_ref) from an ionization curve')).replace('z_ref', 'z<sub>ref</sub>') })}</li>
        </ul>
        <p class="start-note">${esc(L('Результат переносится кнопкой во вкладку «Дозиметрия».', 'The result is transferred to the Dosimetry tab with a button.'))}</p>
      </section>
      <section class="start-card" data-card="unc">
        <h3>${esc(L('Инструменты — неопределённость', 'Tools: uncertainty'))}</h3>
        <p class="start-when">${L(
          '<b>Когда:</b> после результата — для отчёта или протокола: типовой бюджет из протокола, своё значение вместо типового, U (k = 2) в процентах и в единицах дозы.',
          '<b>When:</b> after the result, for a report: the typical budget from the protocol, your own values instead of typical ones, U (k = 2) in percent and in dose units.',
        )}</p>
        <div class="start-row">${go('uncertainty', esc(L('Бюджет неопределённости', 'Uncertainty budget')))}</div>
        <p class="start-note">${esc(L('Данные дозиметрии берутся кнопкой «Взять данные с вкладки».', 'Dosimetry data are taken with the Take data from the tab button.'))}</p>
      </section>
    </div>
    ${canInstall()
      ? `<div class="start-install"><button type="button" class="primary" id="start-install">${esc(L('Установить как приложение', 'Install as an app'))}</button><p>${esc(L(
          'Калькулятор откроется в своём окне, как обычная программа, со значком на рабочем столе, и будет работать без интернета. Данные, черновики и связь с файлом журнала — те же, что здесь, в браузере.',
          'The calculator will open in its own window like a regular program, with a desktop icon, and will work offline. Data, drafts and the link to the journal file are the same as here in the browser.',
        ))}</p></div>`
      : ''}
    <p class="start-foot">${esc(L(
      'Все расчёты — в браузере, данные никуда не отправляются. Измерения сохраняются в файлы JSON, журнал отделения — тоже файл: его удобно держать на общем диске.',
      'All calculations run in the browser; no data are sent anywhere. Measurements are saved to JSON files; the department journal is a file too, best kept on a shared drive.',
    ))} <span class="start-ver">${esc(L('Калькулятор', 'Calculator'))}, ${esc(versionText())} · <a href="#refs" data-goto="refs">${esc(L('литература и проверка на независимых данных', 'references and validation on independent data'))}</a></span></p>`;
  mountSphere($('#start-sphere'));
}

export function initStart() {
  renderStart();
  document.addEventListener('langchange', renderStart);
  onInstallChange(renderStart);
  $('#start-root').addEventListener('click', async (e) => {
    if (!e.target.closest('#start-install')) return;
    const outcome = await promptInstall();
    $('#start-status').textContent =
      outcome === 'accepted'
        ? L('Калькулятор установлен: он открывается в своём окне со значка на рабочем столе или из списка программ.', 'The calculator has been installed: it opens in its own window from the desktop icon or the list of programs.')
        : outcome === 'dismissed'
          ? L('Установка отменена. Кнопка снова появится, когда браузер опять её предложит (обычно после перезагрузки страницы).', 'Installation cancelled. The button reappears when the browser offers it again (usually after reloading the page).')
          : '';
  });
}
