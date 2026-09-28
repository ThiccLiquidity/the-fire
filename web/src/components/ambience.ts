// Forest + campfire soundscape. Recorded loops (web/public/ambience, Pixabay; see CREDITS.md) mixed live to follow
// the scene, with a synthesized stand-in for any layer whose file hasn't loaded (or failed). It follows the scene:
// the fire's crackle grows with its size and dies in the rain; birds sing by day (a chorus at dawn), crickets and
// the odd owl take over at night; wind and the stream run underneath; rain hisses during a storm and the forest
// goes quiet under it. Everything (thunder too) goes through one master gain, so the header toggle mutes it all.

export interface AmbienceInput {
  /** MST hour 0..24 */
  hour: number;
  /** 0..1 fire size as drawn */
  size: number;
  /** 0..1 rain */
  rain: number;
  /** 0..1 cloud cover / storm build-up */
  cover: number;
  /** 0..1 how dead the fire is (ashes) */
  dead: number;
  /** the stream and visitors are drawn */
  stream: boolean;
}

export function createAmbience(ac: AudioContext) {
  const master = ac.createGain();
  master.gain.value = 0;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 3;
  master.connect(comp).connect(ac.destination);

  // ---- noise sources
  function noise(kind: "white" | "pink" | "brown", seconds = 4) {
    const len = Math.floor(ac.sampleRate * seconds), b = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let last = 0, b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === "white") d[i] = w;
        else if (kind === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        else { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      }
    }
    return b;
  }
  const WHITE = noise("white"), PINK = noise("pink", 6), BROWN = noise("brown", 6);
  function loop(buf: AudioBuffer) { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * buf.duration); return s; }
  function bed(buf: AudioBuffer, filters: BiquadFilterNode[], pan = 0) {
    const g = ac.createGain(); g.gain.value = 0;
    let node: AudioNode = loop(buf);
    for (const f of filters) { node.connect(f); node = f; }
    const p = ac.createStereoPanner(); p.pan.value = pan;
    node.connect(g).connect(p).connect(master);
    return g;
  }
  function filt(type: BiquadFilterType, freq: number, q = 0.7) { const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; }

  const fireRoar = bed(BROWN, [filt("lowpass", 420)]);
  const windBand = filt("bandpass", 420, 0.6);
  const wind = bed(PINK, [windBand], -0.2);
  const streamBand = filt("bandpass", 1800, 0.5);
  const stream = bed(PINK, [filt("highpass", 500), streamBand], 0.55);
  const rain = bed(WHITE, [filt("highpass", 900), filt("lowpass", 7500)]);
  const sizzle = bed(WHITE, [filt("bandpass", 5000, 1.2)]);

  const set = (g: GainNode, v: number, tc = 0.4) => g.gain.setTargetAtTime(v, ac.currentTime, tc);

  // ---- one-shot voices
  function crackle(big: boolean) {
    const t = ac.currentTime + Math.random() * 0.02;
    const s = ac.createBufferSource(); s.buffer = WHITE; s.playbackRate.value = 0.8 + Math.random() * 0.6;
    const f = filt("bandpass", big ? 700 + Math.random() * 900 : 1400 + Math.random() * 4200, 1 + Math.random() * 3);
    const g = ac.createGain(); const a = (big ? 0.35 : 0.06 + Math.random() * 0.2);
    const dur = big ? 0.06 + Math.random() * 0.08 : 0.008 + Math.random() * 0.035;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.001); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    const p = ac.createStereoPanner(); p.pan.value = (Math.random() - 0.5) * 0.35;
    s.connect(f).connect(g).connect(p).connect(master); s.start(t, Math.random() * 3, dur + 0.02);
  }
  function tone(t: number, f0: number, f1: number, dur: number, amp: number, pan: number, type: OscillatorType = "sine", lp = 0) {
    const o = ac.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + Math.min(0.02, dur / 4)); g.gain.setTargetAtTime(0, t + dur * 0.7, dur * 0.15);
    const p = ac.createStereoPanner(); p.pan.value = pan;
    let n: AudioNode = o.connect(g);
    if (lp) { const f = filt("lowpass", lp); n = n.connect(f); }
    n.connect(p).connect(master); o.start(t); o.stop(t + dur + 0.2);
  }
  // A few songbird patterns: a warble, a two-note whistle, a trill, a rising "sweet".
  function bird(amp: number) {
    const t = ac.currentTime + 0.05, pan = Math.random() * 1.6 - 0.8, base = 2200 + Math.random() * 2400, kind = Math.floor(Math.random() * 4);
    if (kind === 0) { let tt = t; for (let i = 0, n = 3 + Math.floor(Math.random() * 5); i < n; i++) { const d = 0.06 + Math.random() * 0.09; const a = base * (0.8 + Math.random() * 0.5); tone(tt, a, a * (0.75 + Math.random() * 0.6), d, amp, pan); tt += d + 0.02 + Math.random() * 0.05; } }
    else if (kind === 1) { tone(t, base * 1.25, base * 1.2, 0.28, amp, pan); tone(t + 0.36, base, base * 0.97, 0.32, amp * 0.9, pan); }
    else if (kind === 2) { for (let i = 0; i < 14; i++) tone(t + i * 0.045, base * 1.4, base * 1.1, 0.035, amp * 0.8, pan); }
    else { tone(t, base * 0.8, base * 1.5, 0.18, amp, pan); tone(t + 0.25, base * 1.5, base * 1.3, 0.12, amp * 0.8, pan); }
  }
  function cricket(pitch: number, pan: number, amp: number) {
    const t = ac.currentTime + 0.02;
    for (let i = 0; i < 3 + Math.floor(Math.random() * 2); i++) tone(t + i * 0.042, pitch, pitch * 0.99, 0.022, amp, pan, "sine");
  }
  function owl(amp: number) {
    const t = ac.currentTime + 0.05, pan = Math.random() * 1.4 - 0.7, f = 330 + Math.random() * 60;
    const notes = [[0, 0.32], [0.55, 0.18], [0.8, 0.2], [1.12, 0.6]];
    for (const [at, d] of notes) tone(t + at, f * 1.02, f * 0.94, d, amp, pan, "sine", 900);
  }

  // ---- recorded layers: fetched once sound is first turned on; each fades in over its synth stand-in
  const REC = ["campfire", "forest-day", "forest-dawn", "forest-night", "wind", "stream", "rain"] as const;
  type Rec = (typeof REC)[number];
  const rec: Partial<Record<Rec, GainNode>> = {};
  let owlBuf: AudioBuffer | null = null, loading = false;
  async function loadRecordings() {
    if (loading) return; loading = true;
    // the fire first, then whatever the time of day needs, then the rest
    for (const name of [...REC, "owl"]) {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}ambience/${name}.mp3`); if (!r.ok) continue;
        const buf = await ac.decodeAudioData(await r.arrayBuffer());
        if (name === "owl") { owlBuf = buf; continue; }
        const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
        src.loopStart = 0.03; src.loopEnd = buf.duration - 0.03; // skip the mp3 encoder's padding so the loop is seamless
        const g = ac.createGain(); g.gain.value = 0;
        src.connect(g).connect(master); src.start(0, Math.random() * (buf.duration - 1));
        rec[name as Rec] = g;
      } catch { /* keep the synth stand-in */ }
    }
  }
  function owlRec(amp: number) {
    if (!owlBuf) return false;
    const s = ac.createBufferSource(); s.buffer = owlBuf; s.playbackRate.value = 0.95 + Math.random() * 0.1;
    const g = ac.createGain(); g.gain.value = amp; const p = ac.createStereoPanner(); p.pan.value = Math.random() * 1.4 - 0.7;
    s.connect(g).connect(p).connect(master); s.start(); return true;
  }

  // ---- the mix, stepped once per animation frame
  let on = false, last = ac.currentTime, nextBird = 0, nextOwl = ac.currentTime + 20, windTarget = 420, streamT = 0;
  const crickets = [0, 1, 2].map((i) => ({ pitch: 4200 + i * 350 + Math.random() * 200, period: 0.75 + Math.random() * 0.5, next: 0, pan: -0.6 + i * 0.6 }));

  function update(s: AmbienceInput) {
    const now = ac.currentTime, dt = Math.min(0.25, Math.max(0, now - last)); last = now;
    if (!on || ac.state !== "running") return;
    const h = s.hour;
    const night = h < 5.5 || h > 20 ? 1 : h < 7 ? (7 - h) / 1.5 : h > 18.5 ? (h - 18.5) / 1.5 : 0;
    const dawn = h >= 5 && h < 8.5 ? 1 - Math.abs(h - 6.5) / 2 : 0;
    const hush = Math.max(s.rain, s.cover * 0.6); // the forest quiets as the storm comes in
    const fire = Math.max(0, Math.min(1, s.size)) * (1 - s.dead);

    const day = 1 - night, dawnMix = Math.min(1, dawn * 1.5);
    const fireLevel = s.dead > 0.9 ? 0 : (0.3 + fire * 0.7) * (1 - s.rain * 0.6);
    // Recorded layers (levels are relative: every loop is normalized to the same loudness)
    if (rec.campfire) set(rec.campfire, 0.9 * fireLevel, 0.6);
    if (rec["forest-day"]) set(rec["forest-day"], 0.45 * day * (1 - dawnMix * 0.6) * (1 - hush), 2);
    if (rec["forest-dawn"]) set(rec["forest-dawn"], 0.5 * dawnMix * (1 - hush), 2);
    if (rec["forest-night"]) set(rec["forest-night"], 0.55 * night * (1 - hush * 0.7), 2);
    if (rec.wind) set(rec.wind, 0.22 + s.cover * 0.45 + s.rain * 0.25, 1.5);
    if (rec.stream) set(rec.stream, s.stream ? 0.35 * (1 - s.rain * 0.4) : 0, 1);
    if (rec.rain) set(rec.rain, s.rain * 0.85, 1);

    // Synth stand-ins, only for layers without a recording
    set(fireRoar, rec.campfire ? 0 : (0.05 + fire * 0.16) * (1 - s.rain * 0.5));
    set(sizzle, s.rain * fire * 0.05);
    set(rain, rec.rain ? 0 : s.rain * 0.22, 0.8);
    windTarget += (Math.random() - 0.5) * 40; windTarget = Math.max(250, Math.min(800, windTarget));
    windBand.frequency.setTargetAtTime(windTarget, now, 1.5);
    set(wind, rec.wind ? 0 : 0.03 + night * 0.015 + s.cover * 0.06 + s.rain * 0.05, 1.2);
    streamT += dt; streamBand.frequency.setTargetAtTime(1600 + Math.sin(streamT * 1.7) * 300 + Math.random() * 200, now, 0.08);
    set(stream, s.stream && !rec.stream ? 0.035 * (1 - s.rain * 0.4) : 0, 0.1);

    // crackles: a few a second from a small fire, a busy pop and snap from a big one
    const rate = rec.campfire ? 0 : (0.8 + fire * 9) * (1 - s.rain * 0.7) * (s.dead > 0.9 ? 0 : 1);
    if (Math.random() < rate * dt) crackle(Math.random() < 0.07);

    // birds by day, a chorus at dawn; none at night or in the rain
    if (!rec["forest-day"] && night < 0.6 && now >= nextBird) {
      if (hush < 0.5) bird(0.035 * (1 - night) * (1 - hush));
      const gap = dawn > 0 ? 0.6 + Math.random() * 1.5 : 2.5 + Math.random() * 6;
      nextBird = now + gap * (1 + night * 3);
    }
    // crickets at night, each on its own rhythm
    if (!rec["forest-night"] && night > 0.2 && s.rain < 0.3) for (const c of crickets) if (now >= c.next) { cricket(c.pitch, c.pan, 0.012 * night * (1 - hush)); c.next = now + c.period * (0.9 + Math.random() * 0.2) + (Math.random() < 0.08 ? 3 + Math.random() * 5 : 0); }
    // an owl now and then, deep in the night
    if (night > 0.8 && now >= nextOwl) { if (hush < 0.3 && !owlRec(0.35)) owl(0.05); nextOwl = now + 40 + Math.random() * 60; }
  }

  function setOn(v: boolean) {
    on = v;
    if (v) void loadRecordings();
    master.gain.cancelScheduledValues(ac.currentTime);
    master.gain.setTargetAtTime(v ? 0.9 : 0, ac.currentTime, v ? 1.2 : 0.15);
  }
  return { update, setOn, get on() { return on; }, out: master as AudioNode };
}
