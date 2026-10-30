/* Omni Cardworks as an app: the service worker (sw.js: fast opens, works on a weak connection) and "Install app"
   (the Menu). Chrome, Edge and Android offer their own install prompt, kept here until the player asks for it;
   an iPhone has no prompt, so the Menu explains Share -> Add to Home Screen. Already installed: nothing shows. */
(() => {
  let prompt = null;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); prompt = e; });
  addEventListener('appinstalled', () => { prompt = null; window.toast?.('Installed. Omni Cardworks is on your home screen.', 'good'); });
  if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* a bonus, never needed */ }));
  }
  window.App = {
    /** whether the Menu offers "Install app": not installed, and this browser can (its prompt, or an iPhone's Share menu) */
    get canInstall() { return !standalone() && (!!prompt || ios()); },
    get standalone() { return standalone(); },
    async install() {
      if (prompt) { const p = prompt; prompt = null; p.prompt(); await p.userChoice.catch(() => null); return; }
      if (ios()) window.Sheet?.open('install', { title: 'Install the app', body: `<ol class="inst">
        <li>Tap <b>Share</b> <span class="inst-ic" aria-hidden="true">⬆︎</span> at the bottom of Safari.</li>
        <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
        <li>Tap <b>Add</b>. Omni Cardworks opens full screen from your home screen, like an app.</li></ol>
        <p class="muted small">In another browser on iPhone? Open this page in Safari first.</p>` });
    },
  };
})();
