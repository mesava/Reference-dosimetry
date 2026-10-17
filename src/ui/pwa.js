// Установка как приложение (PWA). Манифест и сервис-воркер (sw.js) есть только у страницы на сервере (GitHub Pages);
// у автономного файла dist/index.html, открытого двойным щелчком, их нет — там и установка не предлагается.
// Браузер (Chrome, Edge) сам решает, можно ли установить страницу, и сообщает об этом событием beforeinstallprompt:
// тогда на «Начале» появляется кнопка «Установить как приложение».
let deferred = null;
const listeners = new Set();

/** Установка доступна: браузер её предложил, а страница ещё не открыта как приложение. */
export const canInstall = () => !!deferred && !standalone();
/** Страница открыта как установленное приложение (своё окно). */
export const standalone = () => (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
/** Подписка на изменение доступности установки. */
export const onInstallChange = (f) => listeners.add(f);
const notify = () => listeners.forEach((f) => f());

/** Показать окно установки браузера. Возвращает 'accepted' | 'dismissed' | 'unavailable'. */
export async function promptInstall() {
  if (!deferred) return 'unavailable';
  const e = deferred;
  deferred = null;
  notify();
  try {
    await e.prompt();
    const choice = await e.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'dismissed';
  }
}

export function initPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
  // сервис-воркер — только у страницы на сервере (http/https) с манифестом
  if (!/^https?:$/.test(location.protocol) || !('serviceWorker' in navigator) || !document.querySelector('link[rel="manifest"]')) return;
  const register = () => navigator.serviceWorker.register('sw.js').catch(() => {});
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
}
