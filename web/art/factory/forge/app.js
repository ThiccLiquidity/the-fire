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
  // ---------- notifications: "your cards are ready", "your grades are in" (this wallet), Series news (everyone who
  // asked). The browser asks permission only from a tap on our own switch. iPhone: only once installed (Apple's rule).
  const KEY = 'omni.push';
  const mem = (v) => { try { if (v === undefined) return localStorage.getItem(KEY); v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { return null; } };
  const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4), raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  const wallet = () => (window.Store?.state?.wallet?.full || '').toLowerCase() || null;
  const api = async (action, body) => {
    const r = await fetch(`/api/push/${action}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Notifications are off right now.');
    return j;
  };
  const push = {
    /** this browser can get notifications (an iPhone only once the app is installed) */
    get supported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && (!ios() || standalone()); },
    get on() { return mem() != null && window.Notification?.permission === 'granted'; },
    async enable() {
      const { key } = await api('key');
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site in your browser settings.');
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }));
      await api('subscribe', { subscription: sub.toJSON(), wallet: wallet() });
      mem(wallet() || '-');
    },
    async disable() {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) { await api('unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
      mem(null);
    },
  };
  // a different wallet connected while notifications are on: they follow it
  const follow = () => { const w = wallet() || '-'; if (push.on && mem() !== w) push.enable().catch(() => {}); };
  addEventListener('load', () => window.Store?.on?.(follow));

  window.App = {
    push,
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
