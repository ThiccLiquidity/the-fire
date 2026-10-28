/* Omni Cardworks (fun layer): tilt the phone and the drawn holo rolls across the card, on the pack reveal and in the
   full-screen viewer. Android gives device tilt with no question asked; an iPhone needs one "Allow motion" tap, which
   is only ever asked from a tap on our own "Tilt to shine" chip, once, and the answer is remembered. Reduced motion:
   off. One deviceorientation listener, at most one aim per animation frame. */
(() => {
  const { h, mem, reduced } = Fun;
  const KEY = 'omni.gyro'; // 'on' (allowed), 'off' (said no / failed)
  const ios = () => typeof window.DeviceOrientationEvent?.requestPermission === 'function';
  const touch = () => matchMedia('(pointer: coarse)').matches;
  const has = () => 'DeviceOrientationEvent' in window;
  let listening = false, pend = null, raf = 0;

  // which card the tilt drives: the viewer's card, else the card on top of the reveal
  function target() {
    const zv = document.querySelector('dialog.zv[open] .zv-card .cface.live');
    if (zv) return ios() ? zv : null; // Android: the viewer already follows the tilt itself (zoom.js)
    return document.querySelector('#sheet-table[open] .sc.flipped:not([inert]) .cface.live');
  }
  function onTilt(e) {
    if (e.gamma == null || reduced() || !window.Holo?.tiltOf) return;
    const t = Holo.tiltOf(e); if (!t) return; pend = [t.tx, t.ty]; // from how the phone is held, turned with the screen
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; const f = target(); if (f && pend) window.Holo?.aim(f, pend[0], pend[1]); });
  }
  function listen() { if (listening || !has()) return; listening = true; addEventListener('deviceorientation', onTilt); }
  // Android (and anything that needs no permission): on from the start; an iPhone: once allowed
  if (has() && !ios() && touch()) listen();
  if (ios() && mem(KEY) === 'on') listen(); // allowed before: iOS keeps the grant for the site

  /** Ask for motion (iPhone), from a tap. */
  async function ask() {
    try { const r = await DeviceOrientationEvent.requestPermission(); mem(KEY, r === 'granted' ? 'on' : 'off'); if (r === 'granted') { listen(); toast('Tilt your phone'); } }
    catch { mem(KEY, 'off'); }
    document.querySelectorAll('.fun-tilt').forEach((b) => b.remove());
  }
  const wanted = () => ios() && touch() && !mem(KEY) && !reduced();
  const chip = () => h('button', { type: 'button', class: 'fun-tilt', onclick: (e) => { e.stopPropagation(); ask(); } }, 'Tilt to shine');
  // offered on the first holo card of a reveal, and in the viewer
  Fun.on('flip', ({ holo, el }) => {
    if (!holo || !wanted()) return;
    const host = el?.closest('.op')?.querySelector('.stage-ctrls'); if (host && !host.querySelector('.fun-tilt')) host.append(chip());
  });
  new MutationObserver(() => {
    const d = document.querySelector('dialog.zv[open]'); if (!d || !wanted() || d.querySelector('.fun-tilt')) return;
    const b = chip(); b.classList.add('in-zv'); d.append(b);
  }).observe(document.body, { childList: true });
  Fun.gyro = { ask, get on() { return listening; } };
})();
