// Оформление (с 0.65.0): цвет вида пучка и меню разделов на узком экране.
// Цвет задаёт атрибут data-beam у <html> (ставит app.js по открытой вкладке); цвета (токены --c-*) и пиктограммы
// пучков (маски SVG) — в styles.css.

/** Вкладки «Дозиметрии», у которых есть свой цвет и пиктограмма. */
export const BEAM_LOOK = ['co60', 'photons', 'electrons', 'kv', 'brachy'];

/** Цвет открытой вкладки: owner — вкладка пучков или пусто. */
export function setBeamLook(owner) {
  const root = document.documentElement;
  if (BEAM_LOOK.includes(owner)) root.dataset.beam = owner;
  else delete root.dataset.beam;
}

/** Ярлыки вкладок «Дозиметрии» — цветные, с пиктограммой (рисует CSS по data-module; текст ярлыков не трогается,
 *  чтобы не мешать переводу статического текста). */
function markBeamTabs() {
  for (const nav of document.querySelectorAll('nav.subtools')) {
    if (nav.querySelector(BEAM_LOOK.map((m) => `a[data-module="${m}"]`).join(','))) nav.classList.add('beam-tabs');
  }
}

/** Меню разделов на узком экране: кнопка открывает список вкладок, язык и тему. */
function initMenu() {
  const bar = document.querySelector('.topbar');
  const btn = document.getElementById('menu-toggle');
  const menu = document.getElementById('topbar-menu');
  if (!bar || !btn || !menu) return;
  const set = (open, focusBtn = false) => {
    bar.dataset.menu = open ? 'open' : '';
    btn.setAttribute('aria-expanded', String(open));
    if (!open && focusBtn) btn.focus();
  };
  btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
  // переход по вкладке закрывает меню; язык и тема — нет (их меняют, глядя на результат)
  menu.addEventListener('click', (e) => {
    if (e.target.closest('.modules a')) set(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') set(false, true);
  });
  document.addEventListener('click', (e) => {
    if (btn.getAttribute('aria-expanded') === 'true' && !bar.contains(e.target)) set(false);
  });
  // экран стал широким — меню не нужно
  window.matchMedia?.('(min-width: 760px)').addEventListener?.('change', (q) => {
    if (q.matches) set(false);
  });
}

export function initLook() {
  markBeamTabs();
  initMenu();
}
