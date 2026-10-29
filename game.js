// Sky Fling - game loop, world, rendering, UI and save system.
'use strict';
(() => {
  const C = window.Core;
  const { MODELS, BIOMES } = C;

  // ===================================================================== utils
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const $ = (id) => document.getElementById(id);
  const now = () => Date.now();
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const UNITS = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp'];
  function fmt(n) {
    n = Math.floor(n);
    if (n < 10000) return String(n);
    let i = -1;
    while (n >= 1000 && i < UNITS.length - 1) { n /= 1000; i++; }
    const s = n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : String(Math.floor(n));
    return s.replace(/\.0+$|(\.\d*?)0+$/, '$1') + UNITS[i];
  }
  function fmtDist(m) {
    if (m < 1000) return Math.floor(m) + ' m';
    return (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' km';
  }
  function fmtTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? String(h).padStart(2, '0') + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0');
  }
  function dayKey() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

  // ===================================================================== cosmetics
  const PAINTS = [
    { name: 'Factory', cost: 0 },
    { name: 'Fire Red', body: '#e63946', wing: '#ffffff', cost: 5 },
    { name: 'Ocean', body: '#1f78e0', wing: '#ffd23a', cost: 5 },
    { name: 'Lime', body: '#8ee03a', wing: '#1b2240', cost: 8 },
    { name: 'Bubblegum', body: '#ff7ac8', wing: '#ffffff', cost: 8 },
    { name: 'Midnight', body: '#2b2d42', wing: '#ff3864', cost: 12 },
    { name: 'Gold Rush', body: '#ffcf3a', wing: '#b8860b', cost: 20 },
    { name: 'Arctic', body: '#e8f6ff', wing: '#58b8ff', cost: 12 },
  ];
  const TRAILS = [
    { name: 'Smoke', color: 'rgba(255,255,255,0.75)', cost: 0 },
    { name: 'Rainbow', rainbow: true, cost: 10 },
    { name: 'Gold Dust', color: 'rgba(255,210,58,0.9)', cost: 8 },
    { name: 'Neon', color: 'rgba(80,255,220,0.9)', cost: 8 },
    { name: 'Inferno', color: 'rgba(255,110,30,0.9)', cost: 12 },
    { name: 'Royal', color: 'rgba(170,90,255,0.9)', cost: 12 },
  ];

  // ===================================================================== save
  const KEY = 'skyfling.save.v1';
  function defaults() {
    return {
      v: 1, coins: 0, gems: 0,
      lv: { sling: 1, plane: 1, income: 1, rocket: 0 },
      best: 0, total: 0, flights: 0, maxBiome: 0,
      chestAt: 0, free: { day: '', used: 0, next: 0 },
      missions: { day: '', list: [] },
      paints: [0], paint: 0, trails: [0], trail: 0,
      set: { sound: true, haptics: true, control: 'drag', sens: 1, perf: false },
      tut: 0,
      stats: { earned: 0, rings: 0, crashes: 0, playMs: 0 },
    };
  }
  function merge(base, src) {
    if (!src || typeof src !== 'object') return base;
    for (const k in base) {
      if (!(k in src)) continue;
      const b = base[k], s = src[k];
      if (b && typeof b === 'object' && !Array.isArray(b)) base[k] = merge(b, s);
      else if (typeof s === typeof b) base[k] = s;
    }
    return base;
  }
  function load() {
    for (const k of [KEY, KEY + '.bak']) {
      try {
        const raw = localStorage.getItem(k);
        if (raw) return merge(defaults(), JSON.parse(raw));
      } catch (e) { /* try backup */ }
    }
    return defaults();
  }
  let S = load();
  let saveTimer = 0;
  function writeNow() {
    clearTimeout(saveTimer); saveTimer = 0;
    try {
      const str = JSON.stringify(S);
      localStorage.setItem(KEY, str);
      localStorage.setItem(KEY + '.bak', str);
    } catch (e) { /* storage full or blocked */ }
  }
  function save() { if (!saveTimer) saveTimer = setTimeout(writeNow, 300); }
  window.addEventListener('pagehide', writeNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { writeNow(); if (state === 'fly') pause(); } });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ===================================================================== audio
  const Sfx = (() => {
    let ctx = null, master = null, noise = null, engine = null, engGain = null, engFilt = null, rocketSrc = null, rocketGain = null;
    function init() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
        noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ctx = null; }
    }
    const on = () => ctx && S.set.sound;
    function tone(f, dur, type, vol, f2, delay) {
      if (!on()) return;
      const t = ctx.currentTime + (delay || 0);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(vol || 0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
    }
    function burst(dur, freq, vol, q) {
      if (!on()) return;
      const t = ctx.currentTime;
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noise; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur);
    }
    let lastCoin = 0;
    return {
      init,
      coin(combo) {
        if (!on() || ctx.currentTime - lastCoin < 0.03) return;
        lastCoin = ctx.currentTime;
        const f = 900 * Math.pow(2, Math.min(combo, 36) / 24);
        tone(f, 0.09, 'square', 0.06); tone(f * 1.5, 0.12, 'sine', 0.08, 0, 0.04);
      },
      gem() { tone(1200, 0.12, 'sine', 0.15); tone(1800, 0.2, 'sine', 0.12, 0, 0.08); tone(2400, 0.25, 'triangle', 0.08, 0, 0.16); },
      launch() { burst(0.35, 900, 0.5, 0.7); tone(200, 0.3, 'sawtooth', 0.08, 600); },
      stretch(p) { if (on()) tone(180 + p * 380, 0.04, 'triangle', 0.025); },
      ring() { tone(500, 0.25, 'sine', 0.15, 1400); burst(0.25, 2200, 0.15, 2); },
      bounce() { tone(140, 0.18, 'sine', 0.3, 60); burst(0.12, 400, 0.25); },
      balloon() { burst(0.08, 3000, 0.3, 3); tone(600, 0.2, 'sine', 0.15, 1200); },
      hit() { burst(0.15, 1200, 0.3, 1.5); tone(300, 0.15, 'square', 0.06, 120); },
      crash() { burst(0.7, 300, 0.7, 0.5); tone(90, 0.6, 'sawtooth', 0.2, 30); },
      splash() { burst(0.6, 700, 0.5, 0.4); },
      buy() { tone(660, 0.07, 'square', 0.06); tone(990, 0.12, 'square', 0.06, 0, 0.06); },
      deny() { tone(180, 0.15, 'square', 0.06, 120); },
      evolve() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, 0, i * 0.08)); },
      fanfare() { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.22, 'square', 0.05, 0, i * 0.07)); },
      tick() { tone(1400, 0.03, 'square', 0.03); },
      engineStart(isJet) {
        if (!on() || engine) return;
        engine = ctx.createOscillator(); engGain = ctx.createGain(); engFilt = ctx.createBiquadFilter();
        engine.type = isJet ? 'sawtooth' : 'square'; engine.frequency.value = 70;
        engFilt.type = 'lowpass'; engFilt.frequency.value = isJet ? 900 : 500;
        engGain.gain.value = 0;
        engine.connect(engFilt); engFilt.connect(engGain); engGain.connect(master); engine.start();
        rocketSrc = ctx.createBufferSource(); rocketSrc.buffer = noise; rocketSrc.loop = true;
        const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 1400;
        rocketGain = ctx.createGain(); rocketGain.gain.value = 0;
        rocketSrc.connect(rf); rf.connect(rocketGain); rocketGain.connect(master); rocketSrc.start();
      },
      engine(speedN, thrusting, rocket) {
        if (!engine) return;
        const t = ctx.currentTime;
        engine.frequency.setTargetAtTime(55 + speedN * 30, t, 0.1);
        engGain.gain.setTargetAtTime(thrusting ? 0.05 : 0.0, t, 0.15);
        rocketGain.gain.setTargetAtTime(rocket ? 0.22 : 0, t, 0.05);
      },
      engineStop() {
        if (!engine) return;
        try { engine.stop(); rocketSrc.stop(); } catch (e) { /* already stopped */ }
        engine = null; rocketSrc = null;
      },
    };
  })();
  function buzz(ms) { if (S.set.haptics && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) { /* unsupported */ } }

  // ===================================================================== canvas
  const cv = $('cv');
  const ctx = cv.getContext('2d', { alpha: false });
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = S.set.perf ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    skyCache.clear();
    safeTopPx = probe.offsetHeight || 0;
  }
  const skyCache = new Map();
  function skyGrad(bi) {
    let g = skyCache.get(bi);
    if (!g) {
      g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, BIOMES[bi].sky[0]); g.addColorStop(1, BIOMES[bi].sky[1]);
      skyCache.set(bi, g);
    }
    return g;
  }

  // ===================================================================== plane drawing
  const OUT = '#1b1b2a';
  // Draws a plane centred at the origin, nose toward +x, length 1 unit. Caller sets transform.
  function planePath(c, M, body, wing, t, engineOn, rocketOn) {
    c.lineJoin = 'round'; c.lineWidth = 0.028; c.strokeStyle = OUT;
    const jet = !M.prop;
    // far wing (behind fuselage)
    c.fillStyle = wing; c.beginPath();
    if (M.delta) { c.moveTo(0.12, -0.02); c.lineTo(-0.3, -0.02); c.lineTo(-0.36, -0.15); }
    else { c.moveTo(0.12, -0.02); c.lineTo(-0.06, -0.02); c.lineTo(-0.1, -0.13); c.lineTo(0.05, -0.13); }
    c.closePath(); c.fill(); c.stroke();
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fill();
    // tail fin
    c.fillStyle = wing; c.beginPath();
    c.moveTo(-0.26, -0.06); c.lineTo(-0.42, -0.32); c.lineTo(-0.5, -0.32); c.lineTo(-0.49, -0.02); c.closePath(); c.fill(); c.stroke();
    // flames behind the fuselage
    if (rocketOn) {
      const f = 0.35 + Math.sin(t * 50) * 0.06;
      c.fillStyle = '#ffd23a'; c.beginPath(); c.moveTo(-0.46, -0.07); c.lineTo(-0.5 - f, 0); c.lineTo(-0.46, 0.08); c.closePath(); c.fill();
      c.fillStyle = '#ff6a1a'; c.beginPath(); c.moveTo(-0.47, -0.04); c.lineTo(-0.5 - f * 0.6, 0); c.lineTo(-0.47, 0.05); c.closePath(); c.fill();
    } else if (jet && engineOn) {
      const f = 0.14 + Math.sin(t * 60) * 0.03;
      c.fillStyle = '#7fd0ff'; c.beginPath(); c.moveTo(-0.47, -0.04); c.lineTo(-0.5 - f, 0.005); c.lineTo(-0.47, 0.05); c.closePath(); c.fill();
    }
    // fuselage
    c.fillStyle = body; c.beginPath();
    if (jet) {
      c.moveTo(0.52, 0.01); c.quadraticCurveTo(0.38, -0.11, 0.12, -0.1); c.lineTo(-0.48, -0.07); c.lineTo(-0.5, 0.06);
      c.lineTo(0.1, 0.09); c.quadraticCurveTo(0.4, 0.08, 0.52, 0.01);
    } else {
      c.moveTo(0.44, -0.08); c.quadraticCurveTo(0.52, 0, 0.44, 0.08); c.lineTo(-0.1, 0.1); c.lineTo(-0.5, 0.03);
      c.lineTo(-0.5, -0.04); c.lineTo(-0.1, -0.11); c.closePath();
    }
    c.fill(); c.stroke();
    // stripe
    c.fillStyle = wing; c.globalAlpha = 0.85; c.fillRect(-0.42, 0.0, 0.8, 0.035); c.globalAlpha = 1;
    // canopy
    c.fillStyle = '#9fdcff'; c.beginPath();
    if (jet) c.ellipse(0.2, -0.08, 0.13, 0.055, -0.1, Math.PI, 0);
    else c.ellipse(0.1, -0.1, 0.09, 0.06, 0, Math.PI, 0);
    c.closePath(); c.fill(); c.stroke();
    // horizontal stabiliser
    c.fillStyle = wing; c.beginPath();
    c.moveTo(-0.3, 0.03); c.lineTo(-0.48, 0.03); c.lineTo(-0.52, 0.11); c.lineTo(-0.38, 0.11); c.closePath(); c.fill(); c.stroke();
    // near wing(s)
    if (M.bi) {
      c.beginPath(); c.moveTo(-0.02, -0.11); c.lineTo(-0.04, -0.2); c.moveTo(0.12, -0.11); c.lineTo(0.14, -0.2); c.stroke();
      c.fillStyle = wing; c.beginPath(); c.moveTo(0.22, -0.2); c.lineTo(-0.14, -0.2); c.lineTo(-0.14, -0.25); c.lineTo(0.2, -0.25); c.closePath(); c.fill(); c.stroke();
    }
    c.fillStyle = wing; c.beginPath();
    if (M.delta) { c.moveTo(0.2, 0.03); c.lineTo(-0.34, 0.03); c.lineTo(-0.42, 0.24); c.closePath(); }
    else if (M.longWing) { c.moveTo(0.16, 0.03); c.lineTo(-0.08, 0.03); c.lineTo(-0.2, 0.26); c.lineTo(0.06, 0.26); c.closePath(); }
    else { c.moveTo(0.16, 0.03); c.lineTo(-0.08, 0.03); c.lineTo(-0.16, 0.21); c.lineTo(0.08, 0.21); c.closePath(); }
    c.fill(); c.stroke();
    if (M.floats) {
      c.beginPath(); c.moveTo(0.0, 0.1); c.lineTo(0.0, 0.25); c.moveTo(0.2, 0.08); c.lineTo(0.2, 0.25); c.stroke();
      c.fillStyle = '#e8e8e8'; c.beginPath(); c.moveTo(-0.2, 0.25); c.lineTo(0.3, 0.25); c.quadraticCurveTo(0.38, 0.28, 0.3, 0.31); c.lineTo(-0.2, 0.31); c.closePath(); c.fill(); c.stroke();
    }
    // propeller
    if (M.prop) {
      const s = Math.abs(Math.cos(t));
      c.fillStyle = 'rgba(255,255,255,0.22)'; c.beginPath(); c.ellipse(0.5, 0, 0.025, 0.26, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#3a2a1a'; c.beginPath(); c.ellipse(0.5, 0, 0.02, 0.03 + 0.24 * s, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#555'; c.beginPath(); c.arc(0.5, 0, 0.035, 0, Math.PI * 2); c.fill();
    }
  }
  function planeColors(model) {
    const M = MODELS[model], P = PAINTS[S.paint] || PAINTS[0];
    return { M, body: P.body || M.body, wing: P.wing || M.wing };
  }
  function drawPlaneAt(c, sx, sy, lenPx, pitch, model, t, engineOn, rocketOn) {
    const { M, body, wing } = planeColors(model);
    c.save(); c.translate(sx, sy); c.rotate(-pitch); c.scale(lenPx, lenPx);
    planePath(c, M, body, wing, t, engineOn, rocketOn);
    c.restore();
  }

  // ===================================================================== world
  const CH = 100; // chunk length in plane-scale units
  let ents = [];
  let nextChunk = 0, runSeed = 1, sig = 1;
  function makeCoinGroup(r, cx, yb, val, out) {
    const n = 6 + Math.floor(r() * 7), sp = 2.6 * sig, kind = Math.floor(r() * 4), amp = (4 + r() * 6) * sig;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      let y = yb;
      if (kind === 1) y += Math.sin(f * Math.PI) * amp;
      else if (kind === 2) y += (f - 0.5) * amp * 1.5;
      else if (kind === 3) y += Math.sin(f * Math.PI * 2) * amp * 0.5;
      out.push({ k: 'coin', x: cx + i * sp, y: Math.max(1.2 * sig, y), val, dead: false });
    }
  }
  function genChunk(ci) {
    const r = mulberry32(runSeed ^ Math.imul(ci + 7, 2654435761));
    const x0 = ci * CH * sig, x1 = x0 + CH * sig;
    const bi = C.biomeIndex(x0), b = BIOMES[bi];
    const ceil = P.st.ceil / sig;
    const val = Math.max(1, Math.round(4 * sig * b.rate * incomeNow));
    const fresh = [];
    const obst = [];
    if (ci >= 1) {
      const tries = 1 + Math.floor(b.density * 3);
      for (let i = 0; i < tries; i++) {
        if (r() > b.density * 0.55) continue;
        const h = (b.hMin + r() * (b.hMax - b.hMin)) * sig;
        let w = 3, tri = false;
        if (b.obst === 'tree') w = 4.5; else if (b.obst === 'pine') { w = 6; tri = true; } else if (b.obst === 'spire') { w = 9; tri = true; }
        else if (b.obst === 'tower') w = 10 + r() * 8; else if (b.obst === 'pillar') w = 7 + r() * 5; else if (b.obst === 'silo') w = 5;
        else if (b.obst === 'cactus') w = 2.4; else if (b.obst === 'buoy') w = 2.5;
        obst.push({ k: 'obst', t: b.obst, x: x0 + r() * CH * sig, y: 0, w: w * sig, h, tri, seed: r(), dead: false });
      }
    }
    const groups = ci === 0 ? 1 : 1 + (r() < 0.6 ? 1 : 0);
    for (let g = 0; g < groups; g++) {
      const yb = (2.5 + Math.pow(r(), 1.5) * ceil * 0.8) * sig;
      makeCoinGroup(r, x0 + (ci === 0 ? 35 * sig : r() * CH * 0.7 * sig), yb, val, fresh);
    }
    if (r() < 0.38 && ci >= 1) fresh.push({ k: 'ring', x: x0 + r() * CH * sig, y: (8 + r() * ceil * 0.6) * sig, r: 5 * sig, dead: false });
    if (r() < 0.13 && ci >= 1) fresh.push({ k: 'fuel', x: x0 + r() * CH * sig, y: (5 + r() * ceil * 0.5) * sig, dead: false });
    if (r() < 0.16 && ci >= 2) fresh.push({ k: 'balloon', x: x0 + r() * CH * sig, y: (6 + r() * ceil * 0.5) * sig, hue: Math.floor(r() * 6), dead: false });
    if (r() < 0.14 && ci >= 1) fresh.push({ k: 'lift', x: x0 + r() * CH * sig, y: 0, w: 9 * sig, top: ceil * 0.9 * sig, dead: false });
    if (r() < 0.07 && ci >= 2) fresh.push({ k: 'gem', x: x0 + r() * CH * sig, y: (ceil * (0.4 + r() * 0.5)) * sig, dead: false });
    if (ci >= 2 && r() < 0.22 + bi * 0.05) {
      const n = 1 + Math.floor(r() * (2 + bi * 0.3));
      const bx = x0 + r() * CH * sig, by = (8 + r() * ceil * 0.7) * sig;
      for (let i = 0; i < n; i++) fresh.push({ k: 'bird', x: bx + i * 4 * sig, y: by + (r() - 0.5) * 6 * sig, y0: 0, ph: r() * 6, c: b.airC, t: b.air, dead: false });
    }
    // keep pickups out of obstacles
    for (const e of fresh) {
      if (e.k === 'bird') e.y0 = e.y;
      for (const o of obst) if (Math.abs(e.x - o.x) < o.w / 2 + 3 * sig && e.y < o.h + 3 * sig) e.y = o.h + 3 * sig + (e.k === 'ring' ? e.r : 0);
    }
    for (const o of obst) ents.push(o);
    for (const e of fresh) ents.push(e);
  }
  function ensureWorld(aheadX) { while (nextChunk * CH * sig < aheadX) genChunk(nextChunk++); }
  function pruneWorld(behindX) {
    let j = 0;
    for (let i = 0; i < ents.length; i++) { const e = ents[i]; if (!e.dead && e.x + (e.w || 0) > behindX) ents[j++] = e; }
    ents.length = j;
  }

  // ===================================================================== particles & texts (pooled)
  const PMAX = 320;
  const parts = [];
  for (let i = 0; i < PMAX; i++) parts.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, color: '#fff', g: 0, sq: false });
  let pIdx = 0;
  function spawn(x, y, vx, vy, life, size, color, g, sq) {
    if (S.set.perf && (pIdx & 1)) { pIdx++; return; }
    const p = parts[pIdx]; pIdx = (pIdx + 1) % PMAX;
    p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life; p.size = size; p.color = color; p.g = g || 0; p.sq = !!sq;
  }
  function burstAt(x, y, n, speed, life, size, color, g, sq) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.4), size * (0.6 + Math.random() * 0.6), color, g, sq);
    }
  }
  const texts = [];
  for (let i = 0; i < 24; i++) texts.push({ on: false, x: 0, y: 0, s: '', life: 0, max: 1, size: 20, color: '#fff' });
  let tIdx = 0;
  function floatText(sx, sy, s, color, size, life) {
    const t = texts[tIdx]; tIdx = (tIdx + 1) % texts.length;
    t.on = true; t.x = sx; t.y = sy; t.s = s; t.color = color || '#fff'; t.size = size || 20; t.life = t.max = life || 0.9;
  }
  let bannerTxt = '', bannerSub = '', bannerT = 0;
  function banner(a, b) { bannerTxt = a; bannerSub = b || ''; bannerT = 2.6; }

  // ===================================================================== game state
  let state = 'hangar'; // hangar | aim | fly | ending | result | paused
  const P = { x: 0, y: 0, v: 0, p: 0, fuel: 0, rocket: 0, rocketOn: false, ground: false, water: false, st: null, rk: null };
  let incomeNow = 1;
  const cam = { x: 0, y: 0, ppm: 20 };
  let run = null;
  let simAcc = 0, gameT = 0, shake = 0;
  const trail = new Float32Array(64 * 2); let trailN = 0, trailHead = 0, trailTimer = 0;
  let bgScroll = 0, cloudScroll = 0;
  let curBiome = 0, prevBiome = 0, biomeFade = 1;
  const HSTEP = 1 / 120;

  function resetPlane() {
    P.st = C.planeStats(S.lv.plane);
    P.rk = C.rocketStats(Math.max(1, S.lv.rocket));
    sig = P.st.sig;
    P.x = 0.2 * sig; P.y = 4.4 * sig; P.v = 0; P.p = 0.15; P.fuel = P.st.fuel; P.rocket = S.lv.rocket > 0 ? P.rk.time : 0;
    P.rocketOn = false; P.ground = false; P.water = false;
  }

  function startAim() {
    state = 'aim';
    $('hangar').classList.add('hidden');
    resetPlane();
    aim.power = 0; aim.angle = 0.6; aim.active = false;
  }
  function launch() {
    Sfx.init();
    incomeNow = C.incomeMult(S.lv.income);
    runSeed = (Math.random() * 1e9) | 0;
    ents.length = 0; nextChunk = 0;
    const power = aim.power;
    const ap = aimPos();
    P.x = ap.x; P.y = ap.y;
    P.v = P.st.vbg * C.slingPower(S.lv.sling) * power;
    P.p = aim.angle;
    run = {
      dist: 0, coins: 0, distCoins: 0, pickCoins: 0, skimCoins: 0, gems: 0, picks: 0, rings: 0, balloons: 0, birds: 0,
      combo: 0, comboT: 0, maxCombo: 0, skimT: 0, skimShow: 0, maxAlt: 0, t: 0, record: false, end: '', endT: 0,
      bestAtStart: S.best, newBiomes: [], fuelFlash: 0,
    };
    trailN = 0;
    state = 'fly';
    Sfx.launch(); Sfx.engineStart(!MODELS[P.st.model].prop);
    buzz(25);
    shake = 0.4;
    burstAt(P.x, P.y, 14, 8 * sig, 0.6, 0.5 * sig, '#fff', 0);
    if (power > 0.97) floatText(W * 0.5, H * 0.38, 'MAX POWER!', '#ffd23a', 30, 1.1);
    S.tut = Math.max(S.tut, 1);
  }

  // where the plane sits in the slingshot pocket while being pulled back
  function aimPos() {
    const pull = state === 'aim' ? aim.power : 0;
    return { x: -Math.cos(aim.angle) * pull * 2.6 * sig + 0.2 * sig, y: 4.4 * sig - Math.sin(aim.angle) * pull * 2.6 * sig };
  }
  function addCoins(v, kind) {
    run.coins += v;
    if (kind === 'pick') run.pickCoins += v;
  }

  function endFlight(reason) {
    if (state !== 'fly') return;
    state = 'ending';
    run.end = reason; run.endT = 0;
    Sfx.engineStop();
    if (reason === 'crash') {
      Sfx.crash(); buzz([40, 30, 60]); shake = 1;
      burstAt(P.x, P.y, 30, 14 * sig, 1.0, 0.8 * sig, '#ff9a3a', -2 * sig);
      burstAt(P.x, P.y, 20, 8 * sig, 1.4, 1.2 * sig, '#555', -1 * sig);
      S.stats.crashes++;
    }
  }

  function finishRun() {
    const r = run;
    r.landBonus = r.end === 'land' ? Math.round(r.coins * 0.1) : 0;
    r.total = Math.round(r.coins + r.landBonus);
    r.prevBest = S.best;
    if (r.dist > S.best) S.best = r.dist;
    S.total += r.dist; S.flights++;
    S.stats.earned += r.total; S.stats.rings += r.rings;
    // missions
    trackMission('dist', r.dist, true); trackMission('pick', r.picks, true); trackMission('combo', r.maxCombo, true);
    trackMission('rings', r.rings); trackMission('flights', 1); trackMission('skim', r.skimT); trackMission('balloon', r.balloons);
    state = 'result';
    save();
    showResults();
  }

  // ===================================================================== input
  const aim = { active: false, id: -1, sx: 0, sy: 0, power: 0, angle: 0.6, lastTick: 0 };
  const stick = { id: -1, ay: 0, y: 0, ax: 0, on: false };
  let boostId = -1, keyUp = false, keyDown = false, keyBoost = false;
  function boostBtn() { const r = Math.min(46, W * 0.12); return { x: W - r - 22, y: H - r - 40, r }; }
  function pauseBtn() { return { x: W - 34, y: 34 + safeTop(), r: 22 }; }
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  let safeTopPx = 0;
  function safeTop() { return safeTopPx; }
  function inCircle(b, x, y) { const dx = x - b.x, dy = y - b.y; return dx * dx + dy * dy < (b.r + 10) * (b.r + 10); }

  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    Sfx.init();
    const x = e.clientX, y = e.clientY;
    if (state === 'hangar') {
      if (!$('modal').classList.contains('hidden')) return;
      startAim();
    }
    if (state === 'aim') {
      if (aim.active) return;
      aim.active = true; aim.id = e.pointerId; aim.sx = x; aim.sy = y; aim.power = 0;
      return;
    }
    if (state === 'fly') {
      if (inCircle(pauseBtn(), x, y)) { pause(); return; }
      if (S.lv.rocket > 0 && inCircle(boostBtn(), x, y)) { boostId = e.pointerId; return; }
      if (stick.id === -1) { stick.id = e.pointerId; stick.ay = y; stick.y = y; stick.ax = x; stick.on = true; }
    }
  });
  window.addEventListener('pointermove', (e) => {
    const x = e.clientX, y = e.clientY;
    if (state === 'aim' && aim.active && e.pointerId === aim.id) {
      const dx = x - aim.sx, dy = y - aim.sy;
      const maxPull = Math.min(W, H) * 0.42;
      const len = Math.hypot(dx, dy);
      const prev = aim.power;
      aim.power = clamp(len / maxPull, 0, 1);
      if (len > 8) aim.angle = clamp(Math.atan2(dy, -dx), 0.05, 1.3);
      if (Math.floor(aim.power * 10) !== Math.floor(prev * 10)) { Sfx.stretch(aim.power); if (aim.power > 0.97 && prev <= 0.97) buzz(10); }
    }
    if (e.pointerId === stick.id) {
      stick.y = y;
      const maxR = 70 * S.set.sens;
      if (stick.y - stick.ay > maxR) stick.ay = stick.y - maxR;
      if (stick.ay - stick.y > maxR) stick.ay = stick.y + maxR;
    }
  });
  function pointerUp(e) {
    if (state === 'aim' && aim.active && e.pointerId === aim.id) {
      aim.active = false;
      if (aim.power > 0.12) launch();
      else aim.power = 0;
    }
    if (e.pointerId === stick.id) { stick.id = -1; stick.on = false; }
    if (e.pointerId === boostId) boostId = -1;
  }
  window.addEventListener('pointerup', pointerUp);
  window.addEventListener('pointercancel', pointerUp);
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.key;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') keyUp = true;
    if (k === 'ArrowDown' || k === 's' || k === 'S') keyDown = true;
    if (k === ' ' || k === 'Shift') {
      keyBoost = true;
      if (state === 'hangar' && $('modal').classList.contains('hidden')) { startAim(); aim.power = 1; aim.angle = 0.6; }
      else if (state === 'aim') { aim.power = 1; launch(); }
    }
    if (k === 'Escape' || k === 'p') { if (state === 'fly') pause(); }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') keyUp = false;
    if (k === 'ArrowDown' || k === 's' || k === 'S') keyDown = false;
    if (k === ' ' || k === 'Shift') keyBoost = false;
  });
  function controlInput() {
    let u = 0;
    if (S.set.control === 'hold') u = stick.on ? 1 : 0;
    else if (stick.on) {
      const d = (stick.ay - stick.y) / (55 * S.set.sens);
      u = Math.abs(d) < 0.08 ? 0 : clamp(d, -1, 1);
    }
    if (keyUp) u = 1; else if (keyDown) u = -1;
    return u;
  }

  // ===================================================================== update
  function updateFly(dt) {
    const u = controlInput();
    P.rocketOn = (boostId !== -1 || keyBoost) && P.rocket > 0;
    simAcc += dt;
    while (simAcc >= HSTEP && state === 'fly') { simAcc -= HSTEP; physStep(u); }
    run.t += dt;
    if (run.comboT > 0) { run.comboT -= dt; if (run.comboT <= 0) run.combo = 0; }
    Sfx.engine(P.v / P.st.vbg, P.fuel > 0, P.rocketOn);
    // exhaust / smoke
    if (P.fuel > 0 || P.rocketOn) {
      const bx = P.x - Math.cos(P.p) * 1.5 * sig * P.st.scale, by = P.y - Math.sin(P.p) * 1.5 * sig * P.st.scale;
      if (P.rocketOn) spawn(bx, by, -P.v * 0.2 + (Math.random() - 0.5) * 4 * sig, (Math.random() - 0.5) * 4 * sig, 0.45, 0.9 * sig, Math.random() < 0.5 ? '#ffb43a' : '#ff6a1a', 0);
      else if (Math.random() < 0.35) spawn(bx, by, -P.v * 0.1, (Math.random() - 0.3) * sig, 0.6, 0.45 * sig, 'rgba(255,255,255,0.7)', 0.5 * sig);
    }
  }

  function physStep(u) {
    const ox = P.x;
    let lift = 0;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.k === 'lift' && Math.abs(P.x - e.x) < e.w / 2 && P.y < e.top) { lift = 11; break; }
    }
    const bi = C.biomeIndex(P.x), b = BIOMES[bi];
    P.water = !!b.water;
    const wasGround = P.ground;
    const ev = C.stepPlane(P, u, HSTEP, lift);
    if (ev === 'bounce') {
      Sfx.bounce(); buzz(15); shake = Math.max(shake, 0.35);
      if (P.water) { burstAt(P.x, 0, 16, 9 * sig, 0.8, 0.6 * sig, '#bfe6ff', -9 * sig); Sfx.splash(); }
      else burstAt(P.x, 0, 12, 7 * sig, 0.7, 0.6 * sig, b.edge, -6 * sig, true);
      floatText(W * 0.5, H * 0.42, 'BOUNCE!', '#fff', 24, 0.7);
    }
    if (P.ground && !wasGround && ev !== 'bounce' && P.water) Sfx.splash();
    if (P.ground && Math.random() < 0.3) spawn(P.x, 0.2 * sig, -P.v * 0.1, (1 + Math.random() * 2) * sig, 0.6, 0.5 * sig, P.water ? '#dff3ff' : b.edge, -3 * sig, true);
    const dx = P.x - ox;
    run.dist = P.x;
    const dc = dx * b.rate * incomeNow;
    run.distCoins += dc; addCoins(dc, 'dist');
    if (P.y > run.maxAlt) run.maxAlt = P.y;
    // skim bonus
    if (!P.ground && P.y < 3.5 * sig && P.v > P.st.vbg * 0.9) {
      run.skimT += HSTEP;
      const sc = HSTEP * 6 * sig * b.rate * incomeNow;
      run.skimCoins += sc; addCoins(sc, 'skim');
      run.skimShow = 0.3;
      if (Math.random() < 0.25) spawn(P.x - sig, 0.3 * sig, -P.v * 0.3, (2 + Math.random() * 3) * sig, 0.4, 0.4 * sig, '#ffd23a', -4 * sig, true);
    }
    // records & zones
    if (!run.record && run.bestAtStart > 50 && P.x > run.bestAtStart) {
      run.record = true; banner('NEW RECORD!', fmtDist(run.bestAtStart) + ' beaten'); Sfx.fanfare(); buzz(30);
      burstAt(P.x, P.y, 26, 10 * sig, 1.0, 0.5 * sig, '#ffd23a', -4 * sig, true);
    }
    if (bi > S.maxBiome) {
      S.maxBiome = bi;
      const g = 2 + bi;
      run.gems += g; run.newBiomes.push(bi);
      banner('NEW ZONE: ' + b.name.toUpperCase(), '+' + g + ' gems');
      Sfx.fanfare(); buzz(30);
    }
    // collisions
    const pr = 0.8 * sig, cr = 2.6 * sig, cr2 = cr * cr;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.dead) continue;
      const ddx = e.x - P.x;
      if (ddx > 25 * sig) continue;
      if (ddx < -25 * sig) continue;
      switch (e.k) {
        case 'coin': {
          const dy = e.y - P.y;
          if (ddx * ddx + dy * dy < cr2) {
            e.dead = true;
            run.combo++; run.comboT = 1.4; if (run.combo > run.maxCombo) run.maxCombo = run.combo;
            const v = e.val * (1 + Math.min(run.combo, 40) * 0.05);
            run.picks++; addCoins(v, 'pick');
            Sfx.coin(run.combo);
            spawn(e.x, e.y, 0, 3 * sig, 0.35, 0.9 * sig, '#ffe27a', 0);
          }
          break;
        }
        case 'gem': {
          const dy = e.y - P.y;
          if (ddx * ddx + dy * dy < cr2 * 1.4) {
            e.dead = true; run.gems++; Sfx.gem(); buzz(20);
            burstAt(e.x, e.y, 14, 8 * sig, 0.7, 0.5 * sig, '#7fd0ff', 0, true);
            floatText(W * 0.5, H * 0.36, '+1 GEM', '#7fd0ff', 26, 1);
          }
          break;
        }
        case 'fuel': {
          const dy = e.y - P.y;
          if (ddx * ddx + dy * dy < cr2 * 1.3) {
            e.dead = true; P.fuel = Math.max(P.fuel, 0) + 1.5; Sfx.ring(); run.fuelFlash = 0.6;
            burstAt(e.x, e.y, 10, 6 * sig, 0.5, 0.5 * sig, '#ff5050', 0, true);
            floatText(W * 0.5, H * 0.36, '+FUEL', '#ff7070', 24, 0.9);
          }
          break;
        }
        case 'ring': {
          const dy = e.y - P.y;
          if (Math.abs(ddx) < 1.2 * sig && Math.abs(dy) < e.r) {
            e.dead = true; run.rings++;
            P.v += P.st.vbg * 0.55;
            run.combo += 5; run.comboT = 1.6; if (run.combo > run.maxCombo) run.maxCombo = run.combo;
            Sfx.ring(); buzz(15); shake = Math.max(shake, 0.25);
            burstAt(e.x, e.y, 18, 10 * sig, 0.6, 0.45 * sig, '#ffb43a', 0, true);
            floatText(W * 0.5, H * 0.38, 'BOOST!', '#ffb43a', 28, 0.8);
          }
          break;
        }
        case 'balloon': {
          const dy = e.y - P.y;
          if (ddx * ddx + dy * dy < (3 * sig) * (3 * sig)) {
            e.dead = true; run.balloons++;
            P.p = Math.max(P.p, 0.75); P.v += P.st.vbg * 0.3;
            const v = e.y > 0 ? Math.round(BIOMES[bi].rate * 25 * sig * incomeNow) : 0;
            addCoins(v, 'pick');
            Sfx.balloon(); buzz(15);
            burstAt(e.x, e.y, 16, 9 * sig, 0.6, 0.5 * sig, BALLOON_C[e.hue], -5 * sig, true);
            floatText(W * 0.5, H * 0.38, 'POP! +' + fmt(v), '#ffe27a', 26, 0.9);
          }
          break;
        }
        case 'bird': {
          const dy = e.y - P.y;
          if (ddx * ddx + dy * dy < (2 * sig) * (2 * sig)) {
            e.dead = true; run.birds++;
            P.v *= 0.72; P.p -= 0.25;
            Sfx.hit(); buzz(20); shake = Math.max(shake, 0.4);
            burstAt(e.x, e.y, 12, 6 * sig, 0.9, 0.4 * sig, e.c, -3 * sig, true);
            floatText(W * 0.5, H * 0.4, 'OUCH!', '#ff6b6b', 24, 0.7);
            run.combo = 0;
          }
          break;
        }
        case 'obst': {
          if (P.x + pr < e.x - e.w / 2 || P.x - pr > e.x + e.w / 2 || P.y - pr > e.h) break;
          if (e.tri && P.y - pr > e.h * (1 - Math.abs(P.x - e.x) / (e.w / 2))) break;
          endFlight('crash');
          return;
        }
      }
    }
    if (P.ground && P.v < P.st.vbg * 0.15) endFlight('land');
    if (run.t > 600) endFlight('land');
    // trail
    trailTimer += HSTEP;
    if (trailTimer > 0.025) {
      trailTimer = 0;
      trail[trailHead * 2] = P.x - Math.cos(P.p) * 1.3 * sig * P.st.scale; trail[trailHead * 2 + 1] = P.y - Math.sin(P.p) * 1.3 * sig * P.st.scale;
      trailHead = (trailHead + 1) % 64; if (trailN < 64) trailN++;
    }
  }
  const BALLOON_C = ['#ff5a5a', '#ffcf3a', '#5fd35a', '#3f8ff5', '#c56bff', '#ff8ad8'];

  function updateParticles(dt) {
    for (let i = 0; i < PMAX; i++) {
      const p = parts[i];
      if (!p.on) continue;
      p.life -= dt; if (p.life <= 0) { p.on = false; continue; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y < 0) { p.y = 0; p.vy *= -0.3; }
    }
    for (const t of texts) { if (t.on) { t.life -= dt; t.y -= 40 * dt; if (t.life <= 0) t.on = false; } }
    if (bannerT > 0) bannerT -= dt;
  }

  function updateCamera(dt, snap) {
    const st = P.st;
    let viewW, viewH, tx, ty;
    if (state === 'hangar') {
      viewW = 13 * sig; viewH = 16 * sig;
    } else if (state === 'aim') {
      viewW = 22 * sig; viewH = 22 * sig;
    } else {
      const vn = P.v / sig;
      viewW = (22 + vn * 0.5) * sig;
      viewH = Math.max((20 + vn * 0.3) * sig, (P.y + 12 * sig) * 1.35);
    }
    const tppm = Math.min(W / viewW, H / viewH);
    cam.ppm = snap ? tppm : lerp(cam.ppm, tppm, Math.min(1, dt * 2.2));
    const vw = W / cam.ppm, vh = H / cam.ppm;
    if (state === 'hangar') { tx = P.x - vw * 0.5; ty = -vh * 0.42; }
    else if (state === 'aim') { tx = P.x - vw * 0.25; ty = -vh * 0.15; }
    else { tx = P.x - vw * 0.28; ty = Math.max(-vh * 0.12, P.y - vh * 0.55); }
    if (snap) { cam.x = tx; cam.y = ty; }
    else {
      cam.x = state === 'fly' ? tx : lerp(cam.x, tx, Math.min(1, dt * 5));
      cam.y = lerp(cam.y, ty, Math.min(1, dt * 4));
    }
  }

  // ===================================================================== render
  const sxw = (x) => (x - cam.x) * cam.ppm;
  const syw = (y) => H - (y - cam.y) * cam.ppm;

  function drawSky() {
    const bi = C.biomeIndex(cam.x + W / cam.ppm * 0.3);
    if (bi !== curBiome) { prevBiome = curBiome; curBiome = bi; biomeFade = 0; }
    if (biomeFade < 1) {
      ctx.fillStyle = skyGrad(prevBiome); ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = biomeFade;
    }
    ctx.fillStyle = skyGrad(curBiome); ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    // high altitude darkening
    const alt = cam.y / sig;
    if (alt > 30) { ctx.fillStyle = 'rgba(10,20,70,' + Math.min(0.45, (alt - 30) / 300) + ')'; ctx.fillRect(0, 0, W, H); }
    // sun
    ctx.fillStyle = 'rgba(255,250,220,0.85)'; ctx.beginPath(); ctx.arc(W * 0.8, H * 0.16 + cam.y * cam.ppm * 0.02, Math.min(W, H) * 0.06, 0, Math.PI * 2); ctx.fill();
  }
  function hillLayer(base, amp, scroll, color, f1, f2) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, H);
    const step = 28;
    for (let x = 0; x <= W + step; x += step) {
      const wx = x + scroll;
      const h = amp * (0.55 + 0.3 * Math.sin(wx * f1) + 0.15 * Math.sin(wx * f2 + 1.7));
      ctx.lineTo(x, base - h);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  }
  function drawBackground() {
    const gy = syw(0);
    const b = BIOMES[curBiome];
    // clouds
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    const cy0 = gy * 0.35 + H * 0.1;
    for (let i = 0; i < 6; i++) {
      const period = W * 1.6;
      let x = ((i * 0.31 * period - cloudScroll) % period + period) % period - W * 0.3;
      const y = cy0 - (i % 3) * H * 0.12 + cam.y * cam.ppm * 0.15 - H * 0.05;
      if (y < -60 || y > H + 60) continue;
      const s = 18 + (i % 3) * 9;
      ctx.beginPath(); ctx.arc(x, y, s, 0, 6.283); ctx.arc(x + s * 1.1, y - s * 0.4, s * 1.2, 0, 6.283); ctx.arc(x + s * 2.2, y, s * 0.9, 0, 6.283); ctx.fill();
    }
    if (gy < -50) return;
    const hz = Math.min(1, cam.ppm / 8);
    hillLayer(gy + 2, 110 * (0.6 + hz * 0.4), bgScroll * 0.3, b.far, 0.004, 0.011);
    hillLayer(gy + 2, 55 * (0.6 + hz * 0.4), bgScroll, b.near, 0.009, 0.023);
  }
  function drawGround() {
    const gy = syw(0);
    if (gy > H) return;
    const bi = curBiome, b = BIOMES[bi];
    ctx.fillStyle = b.ground; ctx.fillRect(0, gy, W, H - gy);
    ctx.fillStyle = b.edge; ctx.fillRect(0, gy, W, Math.max(4, cam.ppm * 0.6 * sig));
    // distance markers
    const vw = W / cam.ppm;
    const steps = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
    let st = steps[steps.length - 1];
    for (const s of steps) if (vw / s < 5) { st = s; break; }
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
    for (let m = Math.ceil(cam.x / st) * st; m < cam.x + vw; m += st) {
      if (m <= 0) continue;
      const x = sxw(m);
      ctx.fillRect(x - 1.5, gy + 6, 3, 10);
      ctx.fillText(fmtDist(m), x, gy + 30);
    }
    // best flag
    if (S.best > 20) {
      const fx = sxw(S.best);
      if (fx > -40 && fx < W + 40) {
        ctx.fillStyle = '#1b2240'; ctx.fillRect(fx - 2, gy - 70, 4, 70);
        ctx.fillStyle = '#ff3b5c'; ctx.beginPath(); ctx.moveTo(fx + 2, gy - 70); ctx.lineTo(fx + 44, gy - 60); ctx.lineTo(fx + 2, gy - 48); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'left'; ctx.fillText('BEST', fx + 5, gy - 56);
      }
    }
  }
  function drawLaunchSite(t) {
    const s = sig, ppm = cam.ppm;
    const gy = syw(0);
    // hangar building
    const hx = sxw(-22 * s), hw = 16 * s * ppm, hh = 9 * s * ppm;
    if (hx + hw > 0) {
      ctx.fillStyle = '#8b5e3c'; ctx.fillRect(hx, gy - hh, hw, hh);
      ctx.fillStyle = '#6b4428'; ctx.beginPath(); ctx.moveTo(hx - 0.8 * s * ppm, gy - hh); ctx.quadraticCurveTo(hx + hw / 2, gy - hh * 1.6, hx + hw + 0.8 * s * ppm, gy - hh); ctx.fill();
      ctx.fillStyle = '#2a1d14'; ctx.fillRect(hx + hw * 0.18, gy - hh * 0.75, hw * 0.64, hh * 0.75);
      ctx.fillStyle = '#ffcf3a'; ctx.fillRect(hx + hw * 0.18, gy - hh * 0.82, hw * 0.64, hh * 0.05);
    }
    // windsock pole
    const wx = sxw(-4 * s);
    ctx.fillStyle = '#ddd'; ctx.fillRect(wx - 1.5, gy - 6 * s * ppm, 3, 6 * s * ppm);
    ctx.fillStyle = '#ff6a1a';
    ctx.beginPath(); ctx.moveTo(wx, gy - 6 * s * ppm); ctx.lineTo(wx + 2.2 * s * ppm, gy - (5.6 + Math.sin(t * 3) * 0.2) * s * ppm); ctx.lineTo(wx, gy - 5.2 * s * ppm); ctx.fill();
  }
  function slingTips() {
    const s = sig;
    return { bx: -1.2 * s, by: 4.6 * s, fx: 1.0 * s, fy: 4.6 * s };
  }
  function drawSlingBack() {
    const s = sig, ppm = cam.ppm, T = slingTips();
    ctx.strokeStyle = '#5a3a1e'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(4, 0.5 * s * ppm);
    ctx.beginPath(); ctx.moveTo(sxw(0), syw(0)); ctx.lineTo(sxw(0), syw(2.6 * s)); ctx.lineTo(sxw(T.bx), syw(T.by)); ctx.stroke();
  }
  function drawSlingFront(px, py) {
    const s = sig, ppm = cam.ppm, T = slingTips();
    ctx.strokeStyle = '#2b1a0e'; ctx.lineWidth = Math.max(2, 0.18 * s * ppm);
    ctx.beginPath(); ctx.moveTo(sxw(T.bx), syw(T.by)); ctx.lineTo(px, py); ctx.lineTo(sxw(T.fx), syw(T.fy)); ctx.stroke();
    ctx.strokeStyle = '#7a4e28'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(4, 0.5 * s * ppm);
    ctx.beginPath(); ctx.moveTo(sxw(0), syw(2.6 * s)); ctx.lineTo(sxw(T.fx), syw(T.fy)); ctx.stroke();
  }

  function drawObst(e, x, y0) {
    const ppm = cam.ppm, w = e.w * ppm, h = e.h * ppm;
    switch (e.t) {
      case 'tree':
        ctx.fillStyle = '#6b4428'; ctx.fillRect(x - w * 0.12, y0 - h, w * 0.24, h);
        ctx.fillStyle = '#3f8f2f'; ctx.beginPath(); ctx.arc(x, y0 - h * 0.78, w * 0.55, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#58ad3e'; ctx.beginPath(); ctx.arc(x - w * 0.15, y0 - h * 0.86, w * 0.3, 0, 6.283); ctx.fill();
        break;
      case 'silo':
        ctx.fillStyle = '#c0392b'; ctx.fillRect(x - w / 2, y0 - h, w, h);
        ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.arc(x, y0 - h, w / 2, Math.PI, 0); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x - w / 2, y0 - h * 0.7, w, Math.max(2, h * 0.04));
        break;
      case 'cactus':
        ctx.fillStyle = '#3e9b4f'; ctx.fillRect(x - w / 2, y0 - h, w, h);
        ctx.fillRect(x - w * 1.5, y0 - h * 0.65, w, h * 0.3); ctx.fillRect(x - w * 1.5, y0 - h * 0.65, w * 1.2, w * 0.6);
        ctx.fillRect(x + w * 0.5, y0 - h * 0.5, w, h * 0.25);
        break;
      case 'pillar':
        ctx.fillStyle = '#8e4426'; ctx.fillRect(x - w / 2, y0 - h, w, h);
        ctx.fillStyle = '#b8603a'; ctx.fillRect(x - w / 2, y0 - h, w, h * 0.08); ctx.fillRect(x - w / 2, y0 - h * 0.55, w, h * 0.04);
        break;
      case 'pine':
      case 'spire':
        ctx.fillStyle = e.t === 'pine' ? '#2f6b4a' : '#2a1a1a';
        ctx.beginPath(); ctx.moveTo(x - w / 2, y0); ctx.lineTo(x, y0 - h); ctx.lineTo(x + w / 2, y0); ctx.fill();
        ctx.fillStyle = e.t === 'pine' ? '#fff' : '#ff6a2a';
        ctx.beginPath(); ctx.moveTo(x - w * 0.12, y0 - h * 0.76); ctx.lineTo(x, y0 - h); ctx.lineTo(x + w * 0.12, y0 - h * 0.76); ctx.fill();
        break;
      case 'tower': {
        ctx.fillStyle = e.seed < 0.5 ? '#3c4a63' : '#4e5d78'; ctx.fillRect(x - w / 2, y0 - h, w, h);
        if (w > 14) {
          ctx.fillStyle = 'rgba(255,230,140,0.75)';
          const rows = Math.min(10, Math.floor(h / 14)), ww = w * 0.18;
          for (let r = 1; r < rows; r++) { const yy = y0 - h + (r * h) / rows; ctx.fillRect(x - w * 0.3, yy, ww, h / rows * 0.4); ctx.fillRect(x + w * 0.12, yy, ww, h / rows * 0.4); }
        }
        ctx.fillStyle = '#ff3b3b'; ctx.fillRect(x - 2, y0 - h - 6, 4, 6);
        break;
      }
      case 'buoy':
        ctx.fillStyle = '#ff3b3b'; ctx.fillRect(x - w / 2, y0 - h, w, h);
        ctx.fillStyle = '#fff'; ctx.fillRect(x - w / 2, y0 - h * 0.6, w, h * 0.2);
        break;
    }
  }

  function drawEntities(t) {
    const ppm = cam.ppm, s = sig;
    const xmin = cam.x - 12 * s, xmax = cam.x + W / ppm + 12 * s;
    const gy = syw(0);
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.dead || e.x + (e.w || 0) < xmin || e.x - (e.w || 0) > xmax) continue;
      const x = sxw(e.x), y = syw(e.y);
      switch (e.k) {
        case 'obst': drawObst(e, x, gy); break;
        case 'coin': {
          const r = Math.max(3, 1.05 * s * ppm), sw = Math.abs(Math.cos(t * 4 + e.x * 0.3));
          ctx.fillStyle = '#c8860c'; ctx.beginPath(); ctx.ellipse(x, y, r * Math.max(0.2, sw), r, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.ellipse(x, y, r * Math.max(0.12, sw) * 0.75, r * 0.75, 0, 0, 6.283); ctx.fill();
          break;
        }
        case 'gem': {
          const r = Math.max(5, 1.4 * s * ppm), b = Math.sin(t * 3) * r * 0.15;
          ctx.fillStyle = '#3fb2ff'; ctx.strokeStyle = '#0d3f8f'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x, y - r + b); ctx.lineTo(x + r * 0.75, y + b); ctx.lineTo(x, y + r + b); ctx.lineTo(x - r * 0.75, y + b); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.moveTo(x, y - r + b); ctx.lineTo(x + r * 0.3, y + b); ctx.lineTo(x, y + b - r * 0.2); ctx.fill();
          break;
        }
        case 'fuel': {
          const r = Math.max(5, 1.3 * s * ppm);
          ctx.fillStyle = '#e63946'; ctx.fillRect(x - r * 0.7, y - r, r * 1.4, r * 2);
          ctx.fillStyle = '#1b2240'; ctx.fillRect(x - r * 0.25, y - r * 1.3, r * 0.5, r * 0.35);
          ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.round(r * 1.2) + 'px system-ui'; ctx.textAlign = 'center'; ctx.fillText('F', x, y + r * 0.42);
          break;
        }
        case 'ring': {
          const r = e.r * ppm;
          ctx.lineWidth = Math.max(3, 0.6 * s * ppm);
          ctx.strokeStyle = '#ff8c1a'; ctx.beginPath(); ctx.ellipse(x, y, r * 0.32, r, 0, 0, 6.283); ctx.stroke();
          ctx.lineWidth = Math.max(1.5, 0.25 * s * ppm); ctx.strokeStyle = '#ffe27a';
          ctx.beginPath(); ctx.ellipse(x, y, r * 0.32, r, 0, 0, 6.283); ctx.stroke();
          break;
        }
        case 'balloon': {
          const r = Math.max(6, 2.4 * s * ppm), by = y + Math.sin(t * 1.5 + e.x) * r * 0.1;
          ctx.strokeStyle = '#6b4428'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, by + r); ctx.lineTo(x, by + r * 1.7); ctx.stroke();
          ctx.fillStyle = '#8b5e3c'; ctx.fillRect(x - r * 0.25, by + r * 1.6, r * 0.5, r * 0.35);
          ctx.fillStyle = BALLOON_C[e.hue]; ctx.beginPath(); ctx.arc(x, by, r, 0, 6.283); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.arc(x - r * 0.35, by - r * 0.35, r * 0.28, 0, 6.283); ctx.fill();
          break;
        }
        case 'lift': {
          const w = e.w * ppm, top = syw(e.top);
          ctx.fillStyle = 'rgba(255,255,255,0.13)'; ctx.fillRect(x - w / 2, top, w, gy - top);
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
          const sp = Math.max(18, 4 * s * ppm), off = (t * 60) % sp;
          ctx.beginPath();
          for (let yy = gy - off; yy > top; yy -= sp) { ctx.moveTo(x - w * 0.2, yy + w * 0.1); ctx.lineTo(x, yy); ctx.lineTo(x + w * 0.2, yy + w * 0.1); }
          ctx.stroke();
          break;
        }
        case 'bird': {
          const r = Math.max(4, 1.3 * s * ppm), f = Math.sin(t * 12 + e.ph) * r * 0.6;
          ctx.strokeStyle = e.c; ctx.lineWidth = Math.max(2, r * 0.3); ctx.lineCap = 'round';
          if (e.t === 'meteor' || e.t === 'ember') {
            ctx.fillStyle = e.c; ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, 6.283); ctx.fill();
            ctx.fillStyle = 'rgba(255,140,40,0.5)'; ctx.beginPath(); ctx.moveTo(x, y - r * 0.6); ctx.lineTo(x + r * 2.5, y - r); ctx.lineTo(x, y + r * 0.6); ctx.fill();
          } else if (e.t === 'drone') {
            ctx.fillStyle = '#333'; ctx.fillRect(x - r, y - r * 0.2, r * 2, r * 0.4);
            ctx.fillStyle = e.c; ctx.fillRect(x - r * 1.2, y - r * 0.45, r * 0.6, r * 0.12); ctx.fillRect(x + r * 0.6, y - r * 0.45, r * 0.6, r * 0.12);
          } else {
            ctx.beginPath(); ctx.moveTo(x - r, y - f); ctx.quadraticCurveTo(x - r * 0.4, y - r * 0.2, x, y); ctx.quadraticCurveTo(x + r * 0.4, y - r * 0.2, x + r, y - f); ctx.stroke();
          }
          break;
        }
      }
    }
  }
  function drawTrail() {
    if (trailN < 2) return;
    const tr = TRAILS[S.trail] || TRAILS[0];
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const baseW = Math.max(2, 0.45 * sig * cam.ppm * P.st.scale);
    const seg = 8;
    for (let k = 0; k < trailN - 1; k += seg) {
      const a = 1 - k / trailN;
      ctx.globalAlpha = a * 0.9;
      ctx.lineWidth = baseW * (0.3 + 0.7 * a);
      ctx.strokeStyle = tr.rainbow ? 'hsl(' + ((gameT * 200 + k * 9) % 360) + ',95%,60%)' : tr.color;
      ctx.beginPath();
      for (let j = k; j <= Math.min(k + seg, trailN - 1); j++) {
        const idx = ((trailHead - 1 - j) % 64 + 64) % 64;
        const x = sxw(trail[idx * 2]), y = syw(trail[idx * 2 + 1]);
        if (j === k) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function drawParticles() {
    const ppm = cam.ppm;
    for (let i = 0; i < PMAX; i++) {
      const p = parts[i];
      if (!p.on) continue;
      const a = p.life / p.max, x = sxw(p.x), y = syw(p.y), r = Math.max(1.5, p.size * ppm * (0.4 + a * 0.6));
      if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
      ctx.globalAlpha = Math.min(1, a * 1.5);
      ctx.fillStyle = p.color;
      if (p.sq) ctx.fillRect(x - r / 2, y - r / 2, r, r);
      else { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }
  function drawSpeedLines() {
    const sp = P.v / P.st.vbg;
    if (sp < 2.2) return;
    const a = Math.min(0.5, (sp - 2.2) * 0.2);
    ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const y = ((i * 97.13 + gameT * 13) % 1) * H;
      const x = ((W * 1.3 - ((gameT * 2400 + i * 331) % (W * 1.6))) + W * 1.6) % (W * 1.6) - W * 0.3;
      ctx.moveTo(x, y); ctx.lineTo(x + 60 + sp * 15, y);
    }
    ctx.stroke();
  }

  function txt(s, x, y, size, color, align, outline) {
    ctx.font = '900 ' + size + 'px system-ui, -apple-system, sans-serif';
    ctx.textAlign = align || 'center';
    if (outline !== false) { ctx.lineWidth = Math.max(3, size * 0.16); ctx.strokeStyle = '#1b2240'; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
    ctx.fillStyle = color || '#fff'; ctx.fillText(s, x, y);
  }
  function bar(x, y, w, h, f, color, label) {
    ctx.fillStyle = 'rgba(20,28,64,0.6)'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color; ctx.fillRect(x + 2, y + 2, Math.max(0, (w - 4) * clamp(f, 0, 1)), h - 4);
    txt(label, x + w / 2, y + h - 3, 11, '#fff', 'center');
  }
  function drawHUD() {
    const top = 16 + safeTop();
    txt(fmtDist(run.dist), W / 2, top + 36, 38, '#fff');
    txt('BEST ' + fmtDist(Math.max(S.best, run.dist)), W / 2, top + 56, 13, run.record ? '#ffd23a' : '#dfe8ff');
    // next zone bar
    const bi = C.biomeIndex(run.dist);
    if (bi + 1 < BIOMES.length) {
      const a = BIOMES[bi].start, b = BIOMES[bi + 1].start, f = (run.dist - a) / (b - a);
      const bw = Math.min(220, W - 230), bx = W / 2 - bw / 2;
      ctx.fillStyle = 'rgba(20,28,64,0.5)'; ctx.fillRect(bx, top + 64, bw, 8);
      ctx.fillStyle = '#7be276'; ctx.fillRect(bx + 1, top + 65, (bw - 2) * clamp(f, 0, 1), 6);
      txt(BIOMES[bi + 1].name + ' in ' + fmtDist(b - run.dist), W / 2, top + 88, 11, '#fff');
    }
    // coins
    ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(28, top + 12, 11, 0, 6.283); ctx.fill();
    ctx.strokeStyle = '#a8680a'; ctx.lineWidth = 2.5; ctx.stroke();
    txt(fmt(run.coins), 46, top + 19, 20, '#fff', 'left');
    if (run.gems) {
      ctx.fillStyle = '#3fb2ff'; ctx.beginPath(); ctx.moveTo(28, top + 30); ctx.lineTo(37, top + 40); ctx.lineTo(28, top + 50); ctx.lineTo(19, top + 40); ctx.fill();
      txt('' + run.gems, 46, top + 47, 18, '#bfe6ff', 'left');
    }
    // fuel / rocket
    const fx = 16, fy = top + 60;
    bar(fx, fy, 88, 16, P.fuel / P.st.fuel, run.fuelFlash > 0 ? '#ff7070' : '#ffcf3a', P.fuel > 0 ? 'ENGINE' : 'GLIDING');
    if (S.lv.rocket > 0) bar(fx, fy + 22, 88, 16, P.rocket / P.rk.time, '#ff6a1a', 'ROCKET');
    // altitude / speed
    txt('ALT ' + Math.floor(P.y) + ' m', W - 16, top + 70, 12, '#fff', 'right');
    txt('SPD ' + Math.floor(P.v * 3.6) + ' km/h', W - 16, top + 86, 12, '#fff', 'right');
    // combo
    if (run.combo >= 3) {
      const pul = 1 + Math.max(0, run.comboT - 1.1) * 0.6;
      txt('COMBO x' + run.combo, W / 2, H * 0.27, Math.round(24 * pul), run.combo >= 20 ? '#ff7ac8' : '#ffd23a');
      txt('coins +' + Math.round(Math.min(run.combo, 40) * 5) + '%', W / 2, H * 0.27 + 18, 12, '#fff');
    }
    if (run.skimShow > 0) txt('SKIMMING!', W / 2, H * 0.66, 20, '#ffd23a');
    // pause
    const pb = pauseBtn();
    ctx.fillStyle = 'rgba(20,28,64,0.55)'; ctx.beginPath(); ctx.arc(pb.x, pb.y, pb.r, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(pb.x - 7, pb.y - 8, 5, 16); ctx.fillRect(pb.x + 2, pb.y - 8, 5, 16);
    // boost button
    if (S.lv.rocket > 0) {
      const b = boostBtn(), f = P.rocket / P.rk.time;
      ctx.fillStyle = P.rocketOn ? '#ff8c1a' : f > 0 ? 'rgba(255,106,26,0.85)' : 'rgba(80,80,90,0.6)';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.283); ctx.fill();
      ctx.strokeStyle = '#1b2240'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(b.x, b.y, b.r - 6, -Math.PI / 2, -Math.PI / 2 + 6.283 * f); ctx.stroke();
      txt('BOOST', b.x, b.y + 5, 14, '#fff');
      if (S.tut < 3 && f > 0 && P.fuel <= 0 && run.t < 30) txt('HOLD!', b.x, b.y - b.r - 10, 14, '#ffe27a');
    }
    // stick indicator
    if (stick.on && S.set.control === 'drag') {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(stick.ax, stick.ay, 70 * S.set.sens, 0, 6.283); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath(); ctx.arc(stick.ax, clamp(stick.y, stick.ay - 70 * S.set.sens, stick.ay + 70 * S.set.sens), 22, 0, 6.283); ctx.fill();
    }
    // tutorial
    if (S.tut < 2 && run.t > 0.6 && run.t < 7) {
      txt(S.set.control === 'hold' ? 'HOLD to climb, RELEASE to dive' : 'DRAG UP / DOWN to steer', W / 2, H * 0.74, 20, '#fff');
      txt('Grab coins, dodge obstacles, glide far!', W / 2, H * 0.74 + 24, 14, '#fff');
    }
  }
  function drawTexts() {
    for (const t of texts) {
      if (!t.on) continue;
      ctx.globalAlpha = Math.min(1, t.life / t.max * 2);
      const sc = 1 + Math.max(0, (t.life / t.max) - 0.8) * 1.5;
      txt(t.s, t.x, t.y, Math.round(t.size * sc), t.color);
    }
    ctx.globalAlpha = 1;
    if (bannerT > 0) {
      const a = Math.min(1, bannerT * 2, (2.6 - bannerT) * 6);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(20,28,64,0.7)'; ctx.fillRect(0, H * 0.43 - 38, W, 70);
      txt(bannerTxt, W / 2, H * 0.43, Math.min(32, W / 13), '#ffd23a');
      if (bannerSub) txt(bannerSub, W / 2, H * 0.43 + 22, 15, '#fff');
      ctx.globalAlpha = 1;
    }
  }
  function drawAimUI() {
    // trajectory preview with the real physics
    if (aim.power > 0.05) {
      const ap = aimPos();
      const Q = { x: ap.x, y: ap.y, v: P.st.vbg * C.slingPower(S.lv.sling) * aim.power, p: aim.angle, fuel: P.st.fuel, rocket: 0, rocketOn: false, ground: false, water: false, st: P.st, rk: P.rk };
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (let i = 0; i < 26; i++) {
        for (let k = 0; k < 4; k++) C.stepPlane(Q, 0, 1 / 60, 0);
        const r = Math.max(2, 5 - i * 0.12);
        ctx.globalAlpha = 1 - i / 30;
        ctx.beginPath(); ctx.arc(sxw(Q.x), syw(Q.y), r, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
      txt(Math.round(aim.power * 100) + '%', W / 2, H * 0.2, 34, aim.power > 0.97 ? '#ffd23a' : '#fff');
      txt(Math.round(aim.angle * 57.3) + '°', W / 2, H * 0.2 + 26, 16, '#fff');
    } else {
      txt('PULL BACK & RELEASE', W / 2, H * 0.22, Math.min(30, W / 13), '#fff');
      txt('drag anywhere - down & left aims up', W / 2, H * 0.22 + 26, 14, '#fff');
    }
  }

  function render(t) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    let ox = 0, oy = 0;
    if (shake > 0) { ox = (Math.random() - 0.5) * shake * 14; oy = (Math.random() - 0.5) * shake * 14; }
    drawSky();
    ctx.translate(ox, oy);
    drawBackground();
    drawGround();
    const showSite = cam.x < 40 * sig;
    if (showSite) { drawLaunchSite(t); drawSlingBack(); }
    drawEntities(t);
    drawTrail();
    drawParticles();
    // plane
    const len = 3 * sig * P.st.scale * cam.ppm * 1.5; // drawn a bit larger than its hitbox
    let px = P.x, py = P.y;
    if (state === 'aim' || state === 'hangar') {
      const ap = aimPos();
      px = ap.x; py = ap.y + (state === 'hangar' ? Math.sin(t * 2) * 0.08 * sig : 0);
    }
    const sx = sxw(px), sy = syw(py + 0.25 * sig);
    let pitch = state === 'aim' || state === 'hangar' ? (state === 'aim' ? aim.angle * 0.8 : 0.12) : P.p;
    let crashSpin = 0;
    if (state === 'ending' && run.end === 'crash') crashSpin = run.endT * 9;
    const engineOn = state === 'fly' && P.fuel > 0;
    if (!(state === 'ending' && run.end === 'crash' && run.endT > 0.12)) {
      drawPlaneAt(ctx, sx, sy, len, pitch + crashSpin, P.st.model, t * (state === 'hangar' ? 8 : 40), engineOn, state === 'fly' && P.rocketOn);
    }
    if (showSite && (state === 'aim' || state === 'hangar')) drawSlingFront(sxw(px - 1.1 * sig * P.st.scale), syw(py));
    else if (showSite) drawSlingFront(sxw(-0.1 * sig), syw(4.2 * sig));
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (state === 'fly' || state === 'ending' || state === 'paused') { drawSpeedLines(); drawHUD(); }
    if (state === 'aim') drawAimUI();
    drawTexts();
  }

  // ===================================================================== main loop
  let last = performance.now();
  function frame(ts) {
    requestAnimationFrame(frame);
    let dt = (ts - last) / 1000; last = ts;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) return;
    gameT += dt;
    if (state === 'fly') {
      updateFly(dt);
      if (run.fuelFlash > 0) run.fuelFlash -= dt;
      if (run.skimShow > 0) run.skimShow -= dt;
      ensureWorld(P.x + (W / cam.ppm) * 1.5);
      if ((gameT * 60 | 0) % 30 === 0) pruneWorld(cam.x - 30 * sig);
      // birds bob
      for (let i = 0; i < ents.length; i++) { const e = ents[i]; if (e.k === 'bird' && !e.dead) { e.y = e.y0 + Math.sin(gameT * 2 + e.ph) * 2 * sig; e.x -= 3 * sig * dt; } }
    } else if (state === 'ending') {
      run.endT += dt;
      if (run.end === 'land' && P.v > 0.3) { P.v *= 0.9; P.x += P.v * dt; }
      if (run.endT > 1.3) finishRun();
    }
    if (state !== 'paused') {
      updateParticles(dt);
      if (shake > 0) shake = Math.max(0, shake - dt * 2.5);
      biomeFade = Math.min(1, biomeFade + dt * 0.6);
    }
    const oldCamX = cam.x;
    if (state !== 'paused') updateCamera(dt, false);
    const dcx = (cam.x - oldCamX) * cam.ppm;
    bgScroll += dcx * 0.15; cloudScroll += dcx * 0.3 + (state === 'hangar' ? dt * 10 : 0);
    render(gameT);
  }

  // ===================================================================== UI
  const modal = $('modal'), panel = $('panel');
  function openPanel(html, onBind, closable) {
    panel.innerHTML = html;
    modal.classList.remove('hidden');
    modal.onclick = closable === false ? null : (e) => { if (e.target === modal) closePanel(); };
    if (onBind) onBind(panel);
    panel.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closePanel));
  }
  function closePanel() { modal.classList.add('hidden'); panel.innerHTML = ''; refreshUI(); }
  let toastT = 0;
  function toast(s) {
    const el = $('toast'); el.textContent = s; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1600);
  }
  function bumpPill(sel) { const el = document.querySelector(sel); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

  // small icon canvases on cards
  function drawCardIcon(k) {
    const cvs = document.querySelector('.c-' + k + ' canvas');
    const c = cvs.getContext('2d');
    const w = cvs.width, h = cvs.height;
    if (k === 'sling') {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#1d5c3a'); g.addColorStop(1, '#0d2e1d');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#a8703c'; c.lineCap = 'round'; c.lineWidth = 12;
      c.beginPath(); c.moveTo(80, 105); c.lineTo(80, 64); c.lineTo(52, 20); c.moveTo(80, 64); c.lineTo(108, 20); c.stroke();
      const lvl = S.lv.sling, glow = Math.min(1, lvl / 40);
      c.strokeStyle = 'hsl(' + (140 + lvl * 4) + ',90%,' + (50 + glow * 15) + '%)'; c.lineWidth = 4;
      c.beginPath(); c.moveTo(52, 22); c.quadraticCurveTo(80, 60 + glow * 10, 108, 22); c.stroke();
    } else if (k === 'plane') {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#8fd0ff'); g.addColorStop(1, '#d9f0ff');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,255,255,0.9)'; c.beginPath(); c.arc(30, 80, 16, 0, 6.283); c.arc(50, 74, 20, 0, 6.283); c.arc(130, 30, 14, 0, 6.283); c.fill();
      const m = C.modelIndex(S.lv.plane), M = MODELS[m];
      const P0 = PAINTS[S.paint] || PAINTS[0];
      c.save(); c.translate(82, 52); c.rotate(-0.15); c.scale(120, 120); planePath(c, M, P0.body || M.body, P0.wing || M.wing, 0.7, false, false); c.restore();
    } else {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#5a5a62'); g.addColorStop(1, '#2a2a30');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = '#c8860c'; c.beginPath(); c.ellipse(80, 82, 46, 14, 0, 0, 6.283); c.fill();
      c.fillStyle = '#ffd23a'; c.beginPath(); c.ellipse(80, 76, 46, 14, 0, 0, 6.283); c.fill();
      c.font = '900 40px system-ui'; c.textAlign = 'center'; c.lineWidth = 6; c.strokeStyle = '#1b2240';
      const s = 'x' + C.incomeMult(S.lv.income); c.strokeText(s, 80, 50); c.fillStyle = '#ffd23a'; c.fillText(s, 80, 50);
    }
  }
  function cardStat(k) {
    if (k === 'sling') return 'Power ' + C.slingPower(S.lv.sling).toFixed(2);
    if (k === 'plane') {
      const m = C.modelIndex(S.lv.plane);
      if (m >= MODELS.length - 1) return 'Max model';
      const left = 5 - ((S.lv.plane - 1) % 5);
      return left === 1 ? 'EVOLVES NEXT!' : 'Evolve in ' + left;
    }
    return '';
  }
  function refreshUI() {
    $('coins').textContent = fmt(S.coins);
    $('gems').textContent = fmt(S.gems);
    $('plane-name').textContent = MODELS[C.modelIndex(S.lv.plane)].name;
    $('best-txt').textContent = S.best > 0 ? 'Best ' + fmtDist(S.best) + '  ·  ' + BIOMES[S.maxBiome].name : 'Fly as far as you can!';
    for (const k of ['sling', 'plane', 'income']) {
      const el = document.querySelector('.c-' + k);
      const lvl = S.lv[k], cost = C.COST[k](lvl);
      el.querySelector('.lvl').textContent = lvl;
      el.querySelector('.cost').textContent = fmt(cost);
      el.classList.toggle('poor', S.coins < cost);
      const filled = ((lvl - 1) % 5) + 1;
      el.querySelectorAll('.pips i').forEach((p, i) => p.classList.toggle('on', i < filled));
      el.querySelector('.card-stat').textContent = cardStat(k);
      drawCardIcon(k);
    }
    // rocket
    const rb = $('btn-rocket');
    if (S.lv.rocket === 0) { $('rocket-txt').innerHTML = 'UNLOCK <i class="ico-gem"></i>1'; }
    else $('rocket-txt').innerHTML = 'LV' + S.lv.rocket + ' <i class="ico-coin"></i>' + fmt(C.COST.rocket(S.lv.rocket));
    rb.classList.toggle('dim', S.lv.rocket === 0 ? S.gems < 1 : S.coins < C.COST.rocket(S.lv.rocket));
    refreshTimers();
    ensureMissions();
    $('mission-badge').classList.toggle('hidden', !S.missions.list.some((m) => !m.claimed && m.prog >= m.target));
  }
  function refreshTimers() {
    const t = now();
    const cb = $('btn-chest');
    if (t >= S.chestAt) { $('chest-txt').textContent = 'OPEN!'; cb.classList.add('ready'); }
    else { $('chest-txt').textContent = fmtTime(S.chestAt - t); cb.classList.remove('ready'); }
    const day = dayKey();
    if (S.free.day !== day) { S.free.day = day; S.free.used = 0; S.free.next = 0; }
    const fb = $('btn-free');
    if (S.free.used >= 3) { $('free-txt').textContent = 'TOMORROW'; fb.classList.remove('ready'); fb.classList.add('dim'); }
    else if (t < S.free.next) { $('free-txt').textContent = fmtTime(S.free.next - t); fb.classList.remove('ready'); fb.classList.remove('dim'); }
    else { $('free-txt').textContent = 'FREE ' + (3 - S.free.used) + '/3'; fb.classList.add('ready'); fb.classList.remove('dim'); }
  }
  setInterval(() => { if (state === 'hangar') refreshTimers(); }, 1000);

  function buy(k) {
    const cost = C.COST[k](S.lv[k]);
    if (S.coins < cost) { Sfx.deny(); return false; }
    S.coins -= cost;
    const prevModel = C.modelIndex(S.lv.plane);
    S.lv[k]++;
    Sfx.buy(); buzz(8);
    trackMission('upgrade', 1);
    const el = document.querySelector('.c-' + k); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    if (k === 'plane') {
      resetPlane();
      updateCamera(0, true);
      burstAt(0.2 * sig, 4.4 * sig, 16, 6 * sig, 0.6, 0.4 * sig, '#ffd23a', -3 * sig, true);
      if (C.modelIndex(S.lv.plane) !== prevModel) { save(); refreshUI(); showEvolve(prevModel); return false; }
    }
    if (k === 'sling') burstAt(0, 4.6 * sig, 10, 5 * sig, 0.5, 0.35 * sig, '#7be276', -2 * sig, true);
    save(); refreshUI();
    return true;
  }
  // press-and-hold to keep buying
  document.querySelectorAll('.card').forEach((el) => {
    const k = el.dataset.k;
    let tm = 0;
    const stop = () => { clearTimeout(tm); tm = 0; };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); Sfx.init();
      if (!buy(k)) return;
      let delay = 380;
      const rep = () => { if (buy(k)) { delay = Math.max(70, delay * 0.8); tm = setTimeout(rep, delay); } else stop(); };
      tm = setTimeout(rep, delay);
    });
    el.addEventListener('pointerup', stop); el.addEventListener('pointerleave', stop); el.addEventListener('pointercancel', stop);
  });

  $('btn-rocket').addEventListener('click', () => {
    Sfx.init();
    if (S.lv.rocket === 0) {
      if (S.gems < 1) { Sfx.deny(); toast('Need 1 gem - find them in the sky!'); return; }
      S.gems--; S.lv.rocket = 1; Sfx.evolve(); save(); refreshUI();
      openPanel('<h2>ROCKET UNLOCKED!</h2><p class="center">Hold the <b>BOOST</b> button while flying for a burst of rocket power. Upgrade it here for longer, stronger burns.</p><button class="btn" data-close>AWESOME</button>');
      return;
    }
    const cost = C.COST.rocket(S.lv.rocket);
    if (S.coins < cost) { Sfx.deny(); toast('Rocket upgrade: ' + fmt(cost) + ' coins'); return; }
    S.coins -= cost; S.lv.rocket++; Sfx.buy(); trackMission('upgrade', 1); save(); refreshUI();
    const rs = C.rocketStats(S.lv.rocket);
    toast('Rocket LV' + S.lv.rocket + ' - ' + rs.time.toFixed(1) + 's burn');
  });

  $('btn-chest').addEventListener('click', () => {
    Sfx.init();
    if (now() < S.chestAt) { toast('Chest opens in ' + fmtTime(S.chestAt - now())); return; }
    const avg = (C.COST.sling(S.lv.sling) + C.COST.plane(S.lv.plane) + C.COST.income(S.lv.income)) / 3;
    const coins = Math.round(Math.max(150, avg * 1.6));
    const gems = 1 + (Math.random() < 0.35 ? 1 : 0);
    S.coins += coins; S.gems += gems; S.chestAt = now() + 3 * 3600 * 1000;
    Sfx.evolve(); buzz(30); save(); refreshUI(); bumpPill('.pill.coin');
    openPanel('<h2>CHEST OPENED!</h2><div class="big-num"><i class="ico-coin"></i> ' + fmt(coins) + '</div><div class="center" style="margin-top:6px"><span class="tag blue">+' + gems + ' GEM' + (gems > 1 ? 'S' : '') + '</span></div><p class="sub">Next chest in 3 hours</p><button class="btn" data-close>COLLECT</button>');
  });

  $('btn-free').addEventListener('click', () => {
    Sfx.init(); refreshTimers();
    if (S.free.used >= 3) { toast('Come back tomorrow for more!'); return; }
    if (now() < S.free.next) { toast('Next free gem in ' + fmtTime(S.free.next - now())); return; }
    S.free.used++; S.free.next = now() + 20 * 60 * 1000; S.gems++;
    Sfx.gem(); buzz(20); save(); refreshUI(); bumpPill('.pill.gem');
    toast('+1 GEM!');
  });

  // ---------------------------------------------------------------- missions
  const MTYPES = {
    dist: { txt: (n) => 'Fly ' + fmtDist(n) + ' in one flight', max: true },
    pick: { txt: (n) => 'Grab ' + n + ' coins in one flight', max: true },
    combo: { txt: (n) => 'Reach a x' + n + ' coin combo', max: true },
    rings: { txt: (n) => 'Fly through ' + n + ' boost rings' },
    flights: { txt: (n) => 'Complete ' + n + ' flights' },
    skim: { txt: (n) => 'Skim the ground for ' + n + 's total' },
    balloon: { txt: (n) => 'Pop ' + n + ' balloons' },
    upgrade: { txt: (n) => 'Buy ' + n + ' upgrades' },
  };
  function niceNum(n) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, n)))); return Math.ceil(n / (p / 2)) * (p / 2); }
  function ensureMissions() {
    const day = dayKey();
    if (S.missions.day === day && S.missions.list.length) return;
    const r = mulberry32(hashStr(day + ':' + S.flights));
    const keys = Object.keys(MTYPES);
    const pick = [];
    while (pick.length < 3) { const k = keys[Math.floor(r() * keys.length)]; if (!pick.includes(k)) pick.push(k); }
    S.missions.day = day;
    S.missions.list = pick.map((k, i) => {
      let target = 0;
      switch (k) {
        case 'dist': target = niceNum(Math.max(150, S.best * (0.85 + r() * 0.3))); break;
        case 'pick': target = 15 + Math.floor(r() * 4) * 5 + Math.min(40, S.flights); break;
        case 'combo': target = 10 + Math.floor(r() * 4) * 5; break;
        case 'rings': target = 4 + Math.floor(r() * 6); break;
        case 'flights': target = 5 + Math.floor(r() * 6); break;
        case 'skim': target = 5 + Math.floor(r() * 3) * 5; break;
        case 'balloon': target = 2 + Math.floor(r() * 4); break;
        case 'upgrade': target = 5 + Math.floor(r() * 3) * 5; break;
      }
      return { k, target, prog: 0, claimed: false, gems: 1 + (i === 2 ? 1 : 0) };
    });
    save();
  }
  function trackMission(k, v, isMax) {
    ensureMissions();
    for (const m of S.missions.list) {
      if (m.k !== k || m.claimed) continue;
      m.prog = isMax ? Math.max(m.prog, v) : m.prog + v;
    }
  }
  function missionCoins() { return Math.round(Math.max(100, Math.min(C.COST.sling(S.lv.sling), C.COST.plane(S.lv.plane), C.COST.income(S.lv.income)) * 1.5)); }
  function showMissions() {
    ensureMissions();
    const mc = missionCoins();
    let h = '<h2>DAILY MISSIONS</h2>';
    S.missions.list.forEach((m, i) => {
      const done = m.prog >= m.target, f = Math.min(1, m.prog / m.target);
      const progTxt = m.k === 'dist' ? fmtDist(Math.min(m.prog, m.target)) + ' / ' + fmtDist(m.target) : Math.floor(Math.min(m.prog, m.target)) + ' / ' + m.target;
      h += '<div class="mission"><div class="mt">' + MTYPES[m.k].txt(m.target) + '</div><div class="bar"><i style="width:' + (f * 100) + '%"></i></div><div class="mr"><span>' + progTxt + ' &nbsp; <i class="ico-coin"></i>' + fmt(mc) + ' + <i class="ico-gem"></i>' + m.gems + '</span>' +
        (m.claimed ? '<span class="tag">DONE</span>' : done ? '<button class="btn" data-claim="' + i + '">CLAIM</button>' : '') + '</div></div>';
    });
    h += '<p class="sub">New missions every day</p><button class="btn gray" data-close>CLOSE</button>';
    openPanel(h, (p) => {
      p.querySelectorAll('[data-claim]').forEach((b) => b.addEventListener('click', () => {
        const m = S.missions.list[+b.dataset.claim];
        if (m.claimed || m.prog < m.target) return;
        m.claimed = true; S.coins += mc; S.gems += m.gems;
        Sfx.evolve(); buzz(20); save(); refreshUI(); bumpPill('.pill.coin'); showMissions();
      }));
    });
  }
  $('btn-missions').addEventListener('click', () => { Sfx.init(); showMissions(); });

  // ---------------------------------------------------------------- shop / hangar collection
  let shopTab = 'planes';
  function planeThumb(cvs, model, paintIdx, locked) {
    const c = cvs.getContext('2d'), w = cvs.width, h = cvs.height;
    c.fillStyle = locked ? '#cfd3da' : '#bfe6ff'; c.fillRect(0, 0, w, h);
    const M = MODELS[model], Pn = PAINTS[paintIdx] || PAINTS[0];
    c.save(); c.translate(w / 2, h / 2); c.rotate(-0.12); c.scale(w * 0.72, w * 0.72);
    if (locked) planePath(c, M, '#5a5f6b', '#4a4f5b', 0.7, false, false);
    else planePath(c, M, Pn.body || M.body, Pn.wing || M.wing, 0.7, false, false);
    c.restore();
  }
  function showShop() {
    const curM = C.modelIndex(S.lv.plane);
    let h = '<h2>HANGAR</h2><div class="tabs"><button data-tab="planes" class="' + (shopTab === 'planes' ? 'on' : '') + '">PLANES</button><button data-tab="paint" class="' + (shopTab === 'paint' ? 'on' : '') + '">PAINT</button><button data-tab="trails" class="' + (shopTab === 'trails' ? 'on' : '') + '">TRAILS</button></div><div class="grid">';
    if (shopTab === 'planes') {
      MODELS.forEach((M, i) => {
        const locked = i > curM;
        h += '<div class="item ' + (i === curM ? 'sel' : '') + (locked ? ' locked' : '') + '"><canvas width="160" height="110" data-m="' + i + '" data-lock="' + (locked ? 1 : 0) + '"></canvas>' + (locked ? '???' : M.name) + '<small>' + (locked ? 'Plane Lv ' + (i * 5 + 1) : i === curM ? 'FLYING' : 'Mastered') + '</small></div>';
      });
    } else if (shopTab === 'paint') {
      PAINTS.forEach((Pn, i) => {
        const own = S.paints.includes(i);
        const sw = Pn.body ? 'linear-gradient(135deg,' + Pn.body + ' 55%,' + Pn.wing + ' 55%)' : 'linear-gradient(135deg,#c89a63 55%,#a97c4a 55%)';
        h += '<div class="item ' + (S.paint === i ? 'sel' : '') + '" data-paint="' + i + '"><div class="swatch" style="background:' + sw + '"></div>' + Pn.name + '<small>' + (S.paint === i ? 'EQUIPPED' : own ? 'Tap to equip' : '<i class="ico-gem"></i> ' + Pn.cost) + '</small></div>';
      });
    } else {
      TRAILS.forEach((T, i) => {
        const own = S.trails.includes(i);
        const sw = T.rainbow ? 'linear-gradient(90deg,#f33,#fc3,#3f6,#3cf,#a3f)' : 'linear-gradient(90deg,transparent,' + T.color + ')';
        h += '<div class="item ' + (S.trail === i ? 'sel' : '') + '" data-trail="' + i + '"><div class="swatch" style="background:' + sw + ',#5fb4f5"></div>' + T.name + '<small>' + (S.trail === i ? 'EQUIPPED' : own ? 'Tap to equip' : '<i class="ico-gem"></i> ' + T.cost) + '</small></div>';
      });
    }
    h += '</div><button class="btn gray" data-close>CLOSE</button>';
    openPanel(h, (p) => {
      p.querySelectorAll('canvas[data-m]').forEach((c) => planeThumb(c, +c.dataset.m, S.paint, c.dataset.lock === '1'));
      p.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { shopTab = b.dataset.tab; showShop(); }));
      p.querySelectorAll('[data-paint]').forEach((b) => b.addEventListener('click', () => {
        const i = +b.dataset.paint;
        if (!S.paints.includes(i)) {
          if (S.gems < PAINTS[i].cost) { Sfx.deny(); toast('Need ' + PAINTS[i].cost + ' gems'); return; }
          S.gems -= PAINTS[i].cost; S.paints.push(i); Sfx.evolve();
        } else Sfx.buy();
        S.paint = i; save(); refreshUI(); showShop();
      }));
      p.querySelectorAll('[data-trail]').forEach((b) => b.addEventListener('click', () => {
        const i = +b.dataset.trail;
        if (!S.trails.includes(i)) {
          if (S.gems < TRAILS[i].cost) { Sfx.deny(); toast('Need ' + TRAILS[i].cost + ' gems'); return; }
          S.gems -= TRAILS[i].cost; S.trails.push(i); Sfx.evolve();
        } else Sfx.buy();
        S.trail = i; save(); refreshUI(); showShop();
      }));
    });
  }
  $('btn-shop').addEventListener('click', () => { Sfx.init(); showShop(); });

  function showEvolve(prevModel) {
    const m = C.modelIndex(S.lv.plane);
    Sfx.evolve(); buzz([30, 40, 30]);
    openPanel('<h2>EVOLUTION!</h2><div class="row" style="align-items:center"><div class="item" style="flex:1"><canvas width="160" height="110" id="ev-a"></canvas>' + MODELS[prevModel].name + '</div><div style="font-size:28px;font-weight:900">&#10140;</div><div class="item sel" style="flex:1"><canvas width="160" height="110" id="ev-b"></canvas>' + MODELS[m].name + '</div></div><p class="center">Bigger, faster and longer flights. New skies await!</p><button class="btn" data-close>LET\'S FLY!</button>', (p) => {
      planeThumb(p.querySelector('#ev-a'), prevModel, S.paint, false);
      planeThumb(p.querySelector('#ev-b'), m, S.paint, false);
    });
  }

  // ---------------------------------------------------------------- results
  function showResults() {
    const r = run;
    const newBest = r.dist > r.prevBest && r.prevBest > 0;
    const head = r.end === 'crash' ? '<span class="tag red">CRASHED</span>' : r.end === 'quit' ? '<span class="tag blue">ENDED</span>' : '<span class="tag">SMOOTH LANDING</span>';
    let h = '<h2>' + (newBest ? 'NEW RECORD!' : 'FLIGHT COMPLETE') + '</h2><div class="center">' + head + '</div>';
    h += '<div class="big-num">' + fmtDist(r.dist) + '</div><div class="sub">Best ' + fmtDist(S.best) + ' · max alt ' + Math.floor(r.maxAlt) + ' m · combo x' + r.maxCombo + '</div>';
    h += '<div class="lines"><div><span>Distance</span><span><i class="ico-coin"></i> ' + fmt(r.distCoins) + '</span></div>';
    h += '<div><span>Pickups (' + r.picks + ')</span><span><i class="ico-coin"></i> ' + fmt(r.pickCoins) + '</span></div>';
    if (r.skimT >= 0.3) h += '<div><span>Ground skim ' + r.skimT.toFixed(1) + 's</span><span><i class="ico-coin"></i> ' + fmt(r.skimCoins) + '</span></div>';
    if (r.landBonus) h += '<div><span>Landing bonus</span><span><i class="ico-coin"></i> ' + fmt(r.landBonus) + '</span></div>';
    if (r.gems) h += '<div><span>Gems</span><span><i class="ico-gem"></i> ' + r.gems + '</span></div>';
    h += '<div class="total"><span>TOTAL</span><span><i class="ico-coin"></i> <span id="tot">0</span></span></div></div>';
    if (r.newBiomes.length) h += '<p class="center">Discovered: <b>' + r.newBiomes.map((b) => BIOMES[b].name).join(', ') + '</b></p>';
    const dblCost = 3;
    h += '<div class="row"><button class="btn purple" id="dbl" ' + (S.gems + r.gems < dblCost ? 'disabled' : '') + '>x2 <i class="ico-gem"></i>' + dblCost + '</button><button class="btn" id="collect">COLLECT</button></div>';
    openPanel(h, (p) => {
      // count-up animation
      const el = p.querySelector('#tot'); const t0 = performance.now();
      const tick = (ts) => { const f = Math.min(1, (ts - t0) / 700); el.textContent = fmt(r.total * (1 - Math.pow(1 - f, 3))); if (f < 1 && el.isConnected) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      p.querySelector('#collect').addEventListener('click', () => collect(1));
      p.querySelector('#dbl').addEventListener('click', () => collect(2));
    }, false);
    if (newBest) { Sfx.fanfare(); }
  }
  function collect(mult) {
    if (!run || state !== 'result') return;
    const r = run;
    if (mult === 2 && S.gems + r.gems < 3) return;
    S.gems += r.gems - (mult === 2 ? 3 : 0);
    S.coins += r.total * mult;
    Sfx.buy(); buzz(15);
    if (S.tut < 2 && S.flights >= 1) S.tut = 2;
    if (S.tut < 3 && S.lv.rocket > 0) S.tut = 3;
    run = null;
    save();
    toHangar();
    bumpPill('.pill.coin');
  }
  function toHangar() {
    state = 'hangar';
    closePanel();
    ents.length = 0; trailN = 0;
    resetPlane();
    $('hangar').classList.remove('hidden');
    updateCamera(0, true);
    refreshUI();
  }

  // ---------------------------------------------------------------- pause
  function pause() {
    if (state !== 'fly') return;
    state = 'paused';
    Sfx.engine(0, false, false);
    stick.on = false; stick.id = -1; boostId = -1;
    openPanel('<h2>PAUSED</h2><button class="btn" id="resume">RESUME</button><button class="btn red" id="giveup">END FLIGHT</button>', (p) => {
      p.querySelector('#resume').addEventListener('click', () => { modal.classList.add('hidden'); panel.innerHTML = ''; state = 'fly'; last = performance.now(); });
      p.querySelector('#giveup').addEventListener('click', () => { modal.classList.add('hidden'); panel.innerHTML = ''; state = 'fly'; endFlight('quit'); });
    }, false);
  }

  // ---------------------------------------------------------------- settings
  function showSettings() {
    const T = (k) => '<div class="toggle ' + (S.set[k] ? 'on' : '') + '" data-t="' + k + '"></div>';
    let h = '<h2>SETTINGS</h2>';
    h += '<div class="set-row">Sound' + T('sound') + '</div>';
    h += '<div class="set-row">Vibration' + T('haptics') + '</div>';
    h += '<div class="set-row">Controls<div class="seg"><button data-c="drag" class="' + (S.set.control === 'drag' ? 'on' : '') + '">Drag stick</button><button data-c="hold" class="' + (S.set.control === 'hold' ? 'on' : '') + '">Hold to climb</button></div></div>';
    h += '<div class="set-row">Stick size<input type="range" min="0.6" max="1.6" step="0.1" value="' + S.set.sens + '" id="sens"></div>';
    h += '<div class="set-row"><span>Performance mode<br><small style="font-weight:600;opacity:.7">Lower resolution, fewer particles</small></span>' + T('perf') + '</div>';
    h += '<h3>Progress</h3><p>Your progress saves automatically on this device after every flight and purchase. Use a backup code to move it to another device.</p>';
    h += '<div class="row"><button class="btn blue" id="exp">BACKUP CODE</button><button class="btn blue" id="imp">RESTORE</button></div>';
    h += '<div id="bk"></div>';
    h += '<p class="sub" style="margin-top:12px">Flights ' + S.flights + ' · Total ' + fmtDist(S.total) + ' · Earned ' + fmt(S.stats.earned) + '</p>';
    h += '<button class="btn red" id="reset">RESET PROGRESS</button><button class="btn gray" data-close>CLOSE</button>';
    openPanel(h, (p) => {
      p.querySelectorAll('[data-t]').forEach((t) => t.addEventListener('click', () => {
        const k = t.dataset.t; S.set[k] = !S.set[k]; t.classList.toggle('on', S.set[k]); save();
        if (k === 'perf') resize();
        if (k === 'sound' && S.set.sound) { Sfx.init(); Sfx.buy(); }
      }));
      p.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { S.set.control = b.dataset.c; save(); showSettings(); }));
      p.querySelector('#sens').addEventListener('input', (e) => { S.set.sens = +e.target.value; save(); });
      p.querySelector('#exp').addEventListener('click', () => {
        writeNow();
        const code = btoa(unescape(encodeURIComponent(JSON.stringify(S))));
        p.querySelector('#bk').innerHTML = '<p>Copy this code and keep it somewhere safe:</p><textarea readonly>' + code + '</textarea>';
        const ta = p.querySelector('textarea'); ta.focus(); ta.select();
        try { navigator.clipboard.writeText(code).then(() => toast('Copied!')).catch(() => {}); } catch (e) { /* manual copy */ }
      });
      p.querySelector('#imp').addEventListener('click', () => {
        p.querySelector('#bk').innerHTML = '<p>Paste your backup code:</p><textarea id="ta"></textarea><button class="btn" id="doimp">RESTORE PROGRESS</button>';
        p.querySelector('#doimp').addEventListener('click', () => {
          try {
            const data = JSON.parse(decodeURIComponent(escape(atob(p.querySelector('#ta').value.trim()))));
            if (!data || !data.lv) throw new Error('bad');
            S = merge(defaults(), data); writeNow(); resetPlane(); resize(); closePanel(); toast('Progress restored!');
          } catch (e) { toast('That code did not work'); }
        });
      });
      let armed = false;
      p.querySelector('#reset').addEventListener('click', (e) => {
        if (!armed) { armed = true; e.target.textContent = 'TAP AGAIN TO ERASE EVERYTHING'; return; }
        const keepSet = S.set; S = defaults(); S.set = keepSet; writeNow(); resetPlane(); closePanel(); toast('Progress reset');
      });
    });
  }
  $('btn-settings').addEventListener('click', () => { Sfx.init(); showSettings(); });

  // ===================================================================== boot
  window.addEventListener('resize', () => { resize(); if (state === 'hangar') updateCamera(0, true); });
  resize();
  resetPlane();
  updateCamera(0, true);
  refreshUI();
  requestAnimationFrame((ts) => { last = ts; frame(ts); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
