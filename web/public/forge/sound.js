/* Omni Forge: sound. Recorded sounds (ui/sfx, credits in ui/sfx/credits.json) played through one shared Web Audio context.
   On by default, but browsers only allow audio after a gesture: the first tap, click or key anywhere starts it, and only
   then are the files fetched and decoded (nothing loads with the page). The speaker button turns it all off (remembered
   per visitor). Ambience: the forge fire always; the press and the conveyor only while a Series is on sale, fading in
   and out. Loops are AudioBufferSourceNodes with loop on (an <audio loop> leaves a gap at the MP3's padding). */
(() => {
  const DIR = 'ui/sfx/';
  // gain per sound (the files are already loudness-matched: one-shots around -16 to -23 LUFS, loops quieter)
  const FILES = {
    'forge-fire-loop': 1, 'press-loop': 0.8, 'conveyor-loop': 0.8, 'pen-scratch-loop': 0.7,
    'pack-rip': 0.85, 'card-slide': 0.6, 'card-flip': 0.7, 'rare-a': 1, 'epic-a': 1, 'legendary-a': 1,
    'pack-drop': 0.9, 'fire-flare': 0.8, 'case-snap': 0.9, 'grade-stamp': 0.9, 'paper-fold': 0.7, 'suggestion-drop': 0.75, 'ui-click': 0.35,
  };
  const AMB = 0.32; // the ambience bus: quiet, under everything
  const KEY = 'forge.sound';
  let enabled = true;
  try { enabled = localStorage.getItem(KEY) !== '0'; } catch { /* no storage: on */ }

  let ctx = null, master = null, sfx = null, amb = null, unlocked = false, loading = null;
  const bufs = {}, last = {};
  const loops = {}; // name -> { src, g }
  let sale = false;

  const session = (type) => { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch { /* not supported */ } };

  function make() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    session('playback'); // iPhone: play through the silent switch (Safari 17+)
    try { ctx = new AC(); } catch { return null; }
    master = ctx.createGain(); master.connect(ctx.destination);
    sfx = ctx.createGain(); sfx.connect(master);
    amb = ctx.createGain(); amb.gain.value = AMB; amb.connect(master);
    return ctx;
  }
  async function fetchOne(name) {
    if (bufs[name]) return bufs[name];
    const r = await fetch(DIR + name + '.mp3'); if (!r.ok) throw new Error(name);
    const data = await r.arrayBuffer();
    bufs[name] = await new Promise((ok, no) => { const p = ctx.decodeAudioData(data, ok, no); if (p?.catch) p.catch(no); });
    return bufs[name];
  }
  function load() { // the fire first, so the room comes alive fast; then the rest, a few at a time
    if (loading) return loading;
    const names = Object.keys(FILES), first = ['forge-fire-loop', 'ui-click', 'pack-rip', 'card-flip', 'card-slide'];
    const rest = names.filter((n) => !first.includes(n));
    const run = async (list) => { for (const n of list) { try { await fetchOne(n); } catch { /* skip a missing file */ } if (n.endsWith('-loop')) ambience(); } };
    loading = Promise.all([run(first), run(rest.slice(0, 6)), run(rest.slice(6))]);
    return loading;
  }

  function unlock(e) {
    if (!enabled) return;
    if (e?.target?.closest?.('#soundBtn') && !unlocked) return; // the speaker button itself: let its toggle decide
    if (!make()) return;
    if (ctx.state !== 'running' && !document.hidden) { session('playback'); ctx.resume().catch(() => {}); }
    if (!unlocked) { unlocked = true; load(); }
    ambience();
  }
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach((t) => addEventListener(t, unlock, { capture: true, passive: true }));

  // ---------- playing
  // play(name, { gain, offset, duration, rate, gap, loop, bus }): returns a handle { src, g, stop(fade) } or null.
  // gap: ignore a repeat of the same sound within that many ms.
  function play(name, o = {}) {
    if (!enabled || !ctx || ctx.state === 'closed') return null;
    const b = bufs[name]; if (!b) return null;
    const now = performance.now();
    if (o.gap && now - (last[name] || -1e9) < o.gap) return null;
    last[name] = now;
    const src = ctx.createBufferSource(), g = ctx.createGain(), t = ctx.currentTime;
    src.buffer = b; src.loop = !!o.loop; if (o.rate) src.playbackRate.value = o.rate;
    const vol = (o.gain ?? 1) * (FILES[name] ?? 1);
    if (o.fadeIn) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + o.fadeIn); } else g.gain.value = vol;
    src.connect(g).connect(o.bus || sfx);
    const off = Math.max(0, Math.min(b.duration - 0.01, o.offset || 0));
    if (o.duration) { // a slice: short fades so it doesn't click
      const d = o.duration; g.gain.setValueAtTime(vol, t + Math.max(0.005, d - 0.04)); g.gain.linearRampToValueAtTime(0.0001, t + d);
      src.start(t, off, d + 0.02);
    } else src.start(t, off);
    const h = { src, g, stop(fade = 0.08) {
      if (h.done) return; h.done = true; const t2 = ctx.currentTime;
      try { g.gain.cancelScheduledValues(t2); g.gain.setValueAtTime(g.gain.value, t2); g.gain.linearRampToValueAtTime(0.0001, t2 + fade); src.stop(t2 + fade + 0.02); } catch { /* already stopped */ }
    } };
    src.onended = () => { h.done = true; };
    return h;
  }

  // ---------- ambience
  function startLoop(name, fade) {
    if (loops[name] || !bufs[name]) return;
    const b = bufs[name], h = play(name, { loop: true, bus: amb, offset: Math.random() * b.duration, fadeIn: fade });
    if (h) loops[name] = h;
  }
  function stopLoop(name, fade) { loops[name]?.stop(fade); delete loops[name]; }
  function ambience() {
    if (!enabled || !unlocked || !ctx) return;
    startLoop('forge-fire-loop', 1.2);
    for (const n of ['press-loop', 'conveyor-loop']) sale ? startLoop(n, 1.6) : stopLoop(n, 1.6);
  }
  function setSale(v) { v = !!v; if (v === sale) return; sale = v; ambience(); }
  const syncSale = () => setSale(window.Store && Store.state.series.phase < 4);
  if (window.Store) { syncSale(); Store.on(syncSale); }
  // big moments: the room dips under them, then comes back
  function duck(sec = 2, to = 0.35) {
    if (!ctx || !amb) return; const t = ctx.currentTime, g = amb.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(AMB * to, t + 0.08);
    g.setValueAtTime(AMB * to, t + sec); g.linearRampToValueAtTime(AMB, t + sec + 1.2);
  }

  // ---------- the pen, while someone is typing: starts on input, stops 400 ms after the last key
  let pen = null, penT = 0;
  function typing() {
    if (!enabled || !ctx || !bufs['pen-scratch-loop']) return;
    if (!pen || pen.done) pen = play('pen-scratch-loop', { loop: true, fadeIn: 0.05, offset: Math.random() * bufs['pen-scratch-loop'].duration });
    clearTimeout(penT); penT = setTimeout(() => { pen?.stop(0.12); pen = null; }, 400);
  }

  // ---------- on / off
  function set(on) {
    enabled = !!on;
    try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch { /* not remembered */ }
    if (!enabled) {
      Object.keys(loops).forEach((n) => stopLoop(n, 0.05)); pen?.stop(0.05); pen = null;
      if (ctx && ctx.state === 'running') setTimeout(() => !enabled && ctx.state === 'running' && ctx.suspend().catch(() => {}), 120);
      session('auto');
    } else unlock(); // a click turned it on: that click is the gesture
    return enabled;
  }
  // a hidden tab goes quiet
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) { if (ctx.state === 'running') ctx.suspend().catch(() => {}); }
    else if (enabled && unlocked) ctx.resume().catch(() => {});
  });

  // a quiet click on button taps (not on cards or packs, which make their own sounds)
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('button, [role="button"], .btn, .pill, a.inf-link');
    if (!b || b.disabled || b.closest('.pk2, .sc, .stk')) return;
    play('ui-click', { gap: 40 });
  });

  window.Sound = {
    get on() { return enabled; }, set, play, typing, duck,
    get ctx() { return enabled && ctx && ctx.state !== 'closed' ? ctx : null; }, get out() { return sfx; },
    get loaded() { return Object.keys(bufs); }, get loops() { return Object.keys(loops); },
  };
})();
