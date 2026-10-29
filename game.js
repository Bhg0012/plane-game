// Sky Fling - game loop, world, HUD, UI and save system. 3D drawing lives in world3d.js.
import * as W3 from './world3d.js';

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
  const VERSION = '1.12';
  const KEY = 'skyfling.save.v1';
  function defaults() {
    return {
      v: 1, coins: 0, gems: 0,
      lv: { sling: 1, plane: 1, income: 1, rocket: 0 },
      best: 0, total: 0, flights: 0, maxBiome: 0,
      chestAt: 0, free: { day: '', used: 0, next: 0 },
      missions: { day: '', list: [] },
      paints: [0], paint: 0, trails: [0], trail: 0,
      set: { sound: true, haptics: true, control: 'drag', sens: 1, perf: false, invert: true, pitch: 1 },
      tut: 0, savedAt: 0, streak: { day: '', n: 0 },
      sync: { code: '', asked: false, last: 0 },
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
  let dirtyCloud = false;
  function writeNow() {
    clearTimeout(saveTimer); saveTimer = 0;
    S.savedAt = Date.now();
    dirtyCloud = true;
    try {
      const str = JSON.stringify(S);
      localStorage.setItem(KEY, str);
      localStorage.setItem(KEY + '.bak', str);
    } catch (e) { /* storage full or blocked */ }
    Cloud.schedule();
  }
  function save() { if (!saveTimer) saveTimer = setTimeout(writeNow, 300); }
  window.addEventListener('pagehide', () => { writeNow(); Cloud.push(true); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { writeNow(); Cloud.push(true); if (state === 'fly') pause(); }
    else Cloud.pull();
  });

  // ---------------------------------------------------------------- cloud sync (Supabase)
  // Each player gets a 6-character sync code. Entering it on another device loads the same save;
  // after that every device pushes changes and pulls the newest save when it opens.
  const Cloud = (() => {
    const cfg = window.SKYFLING_SYNC || {};
    const ok = () => !!(cfg.url && cfg.key);
    const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let timer = 0, busy = false, status = '';
    async function rpc(fn, body, keepalive) {
      const headers = { apikey: cfg.key, 'Content-Type': 'application/json' };
      if (!cfg.key.startsWith('sb_')) headers.Authorization = 'Bearer ' + cfg.key; // legacy anon JWT keys
      const r = await fetch(cfg.url.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, { method: 'POST', headers, body: JSON.stringify(body), keepalive: !!keepalive });
      if (!r.ok) throw new Error('sync ' + r.status);
      const t = await r.text();
      return t && t !== 'null' ? JSON.parse(t) : null;
    }
    const clean = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    function payload() { const d = JSON.parse(JSON.stringify(S)); delete d.set; return d; } // settings stay per-device
    function adopt(data) {
      const keepSet = S.set, keepSync = S.sync;
      S = merge(defaults(), data); S.set = keepSet; S.sync = keepSync;
      try { localStorage.setItem(KEY, JSON.stringify(S)); localStorage.setItem(KEY + '.bak', JSON.stringify(S)); } catch (e) { /* blocked */ }
      if (state === 'hangar') { resetPlane(); rebuildPlane(); refreshUI(); }
    }
    async function push(keepalive) {
      if (!ok() || !S.sync.code || !dirtyCloud || busy) return;
      busy = true;
      try { await rpc('put_save', { p_code: S.sync.code, p_data: payload() }, keepalive); dirtyCloud = false; S.sync.last = Date.now(); status = 'ok'; }
      catch (e) { status = 'offline'; }
      busy = false;
    }
    function schedule() { if (ok() && S.sync.code && !timer) timer = setTimeout(() => { timer = 0; push(); }, 3000); }
    async function pull() {
      if (!ok() || !S.sync.code || state !== 'hangar') return;
      try {
        const data = await rpc('get_save', { p_code: S.sync.code });
        status = 'ok';
        if (data && (data.savedAt || 0) > (S.savedAt || 0) + 1000) { adopt(data); toast('Progress synced from your other device'); }
        else if (!data || (data.savedAt || 0) < (S.savedAt || 0) - 1000) { dirtyCloud = true; push(); }
      } catch (e) { status = 'offline'; }
    }
    async function create() {
      for (let tries = 0; tries < 5; tries++) {
        let c = '';
        for (let i = 0; i < 6; i++) c += ALPHA[Math.floor(Math.random() * ALPHA.length)];
        if (await rpc('get_save', { p_code: c })) continue;
        S.sync.code = c; dirtyCloud = true; writeNow(); await push();
        return c;
      }
      throw new Error('could not create code');
    }
    async function link(code) {
      code = clean(code);
      if (code.length !== 6) throw new Error('Codes are 6 letters/numbers');
      const data = await rpc('get_save', { p_code: code });
      if (!data) throw new Error('No save found for ' + code);
      S.sync.code = code;
      adopt(data);
      S.sync.last = Date.now();
      writeNow();
      return data;
    }
    return { ok, push, pull, schedule, create, link, clean, status: () => status };
  })();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ===================================================================== audio
  // Soft synth: sine/triangle tones with smooth attacks, everything through a warm low-pass and a gentle compressor.
  const Sfx = (() => {
    let ctx = null, master = null, noise = null, engine = null, engGain = null, engFilt = null, rocketSrc = null, rocketGain = null;
    function init() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -24; comp.knee.value = 20; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
        const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 3200; warm.Q.value = 0.5;
        master = ctx.createGain(); master.gain.value = 0.32;
        master.connect(warm); warm.connect(comp); comp.connect(ctx.destination);
        noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noise.getChannelData(0);
        let b = 0;
        for (let i = 0; i < d.length; i++) { b = b * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = b * 6; } // soft brown-ish noise, not hiss
      } catch (e) { ctx = null; }
    }
    const on = () => ctx && S.set.sound;
    // smooth envelope: short fade in, exponential tail - no clicks
    function tone(f, dur, type, vol, f2, delay, atk) {
      if (!on()) return;
      const t = ctx.currentTime + (delay || 0), a = atk || 0.012;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.1, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
    }
    function whoosh(dur, freq, vol, sweepTo) {
      if (!on()) return;
      const t = ctx.currentTime;
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noise; f.type = 'lowpass'; f.frequency.setValueAtTime(freq, t); f.Q.value = 0.7;
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.08, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
    }
    // pentatonic steps so rising combo coins always sound musical
    const PENTA = [0, 2, 4, 7, 9];
    const noteHz = (n) => 523.25 * Math.pow(2, (Math.floor(n / 5) * 12 + PENTA[n % 5]) / 12);
    let lastCoin = 0;
    return {
      init,
      coin(combo) {
        if (!on() || ctx.currentTime - lastCoin < 0.04) return;
        lastCoin = ctx.currentTime;
        const f = noteHz(Math.min(combo, 14));
        tone(f, 0.22, 'sine', 0.07, 0, 0, 0.006); tone(f * 2, 0.12, 'sine', 0.02, 0, 0, 0.006);
      },
      gem() { [0, 2, 4].forEach((n, i) => tone(noteHz(n + 5), 0.35, 'sine', 0.06, 0, i * 0.07)); },
      launch() { whoosh(0.55, 500, 0.25, 2200); tone(180, 0.35, 'triangle', 0.05, 420, 0, 0.03); },
      stretch(p) { if (on()) tone(160 + p * 220, 0.06, 'sine', 0.02, 0, 0, 0.01); },
      ring() { tone(440, 0.4, 'sine', 0.07, 880, 0, 0.02); whoosh(0.35, 800, 0.08, 2400); },
      bounce() { tone(110, 0.25, 'sine', 0.14, 60, 0, 0.008); whoosh(0.18, 400, 0.08); },
      balloon() { tone(700, 0.22, 'sine', 0.07, 1100, 0, 0.005); whoosh(0.1, 1500, 0.06); },
      hit() { tone(220, 0.2, 'triangle', 0.06, 140, 0, 0.008); whoosh(0.15, 700, 0.08); },
      crash() { whoosh(0.9, 900, 0.3, 120); tone(80, 0.7, 'sine', 0.16, 40, 0, 0.01); },
      splash() { whoosh(0.7, 1200, 0.18, 300); },
      boom() { tone(58, 0.9, 'sine', 0.22, 32, 0, 0.004); whoosh(1.1, 2000, 0.22, 160); },
      rush() { [0, 4, 7, 9, 12].forEach((n, i) => tone(noteHz(n + 5), 0.3, 'sine', 0.05, 0, i * 0.05)); },
      buy() { tone(noteHz(4), 0.16, 'sine', 0.06); tone(noteHz(7), 0.22, 'sine', 0.06, 0, 0.06); },
      deny() { tone(196, 0.2, 'triangle', 0.04, 165); },
      evolve() { [0, 2, 4, 5, 7].forEach((n, i) => tone(noteHz(n), 0.45, 'triangle', 0.05, 0, i * 0.09, 0.02)); },
      fanfare() { [5, 7, 9, 10].forEach((n, i) => tone(noteHz(n), 0.4, 'triangle', 0.045, 0, i * 0.08, 0.02)); },
      tick() { tone(1200, 0.04, 'sine', 0.02); },
      engineStart(isJet) {
        if (!on() || engine) return;
        engine = ctx.createOscillator(); engGain = ctx.createGain(); engFilt = ctx.createBiquadFilter();
        engine.type = 'triangle'; engine.frequency.value = 60;
        engFilt.type = 'lowpass'; engFilt.frequency.value = isJet ? 700 : 380;
        engGain.gain.value = 0;
        engine.connect(engFilt); engFilt.connect(engGain); engGain.connect(master); engine.start();
        rocketSrc = ctx.createBufferSource(); rocketSrc.buffer = noise; rocketSrc.loop = true;
        const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 650;
        rocketGain = ctx.createGain(); rocketGain.gain.value = 0;
        rocketSrc.connect(rf); rf.connect(rocketGain); rocketGain.connect(master); rocketSrc.start();
      },
      engine(speedN, thrusting, rocket) {
        if (!engine) return;
        const t = ctx.currentTime;
        engine.frequency.setTargetAtTime(50 + Math.min(speedN, 4) * 18, t, 0.2);
        engGain.gain.setTargetAtTime(thrusting ? 0.045 : 0.0, t, 0.25);
        rocketGain.gain.setTargetAtTime(rocket ? 0.16 : 0, t, 0.08);
      },
      engineStop() {
        if (!engine) return;
        const t = ctx.currentTime, e = engine, r = rocketSrc;
        engGain.gain.setTargetAtTime(0, t, 0.08); rocketGain.gain.setTargetAtTime(0, t, 0.08);
        setTimeout(() => { try { e.stop(); r.stop(); } catch (err) { /* already stopped */ } }, 400);
        engine = null; rocketSrc = null;
      },
    };
  })();
  function buzz(ms) { if (S.set.haptics && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) { /* unsupported */ } }

  // ===================================================================== canvases
  // #gl is the 3D view, #cv is a transparent 2D canvas on top for the HUD and input.
  const cv = $('cv');
  const ctx = cv.getContext('2d');
  W3.init($('gl'));
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = S.set.perf ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    W3.resize(W, H, S.set.perf);
    safeTopPx = probe.offsetHeight || 0;
  }

  // ===================================================================== plane drawing
  const OUT = '#1b1b2a';
  // Draws a plane centred at the origin, nose toward +x, length 1 unit. Caller sets transform.
  function planePath(c, M, body, wing, t, engineOn, rocketOn, parts) {
    parts = parts || { tail: true, cockpit: true, engine: true };
    c.lineJoin = 'round'; c.lineWidth = 0.028; c.strokeStyle = OUT;
    const jet = !M.prop;
    // far wing (behind fuselage)
    c.fillStyle = wing; c.beginPath();
    if (M.delta) { c.moveTo(0.12, -0.02); c.lineTo(-0.3, -0.02); c.lineTo(-0.36, -0.15); }
    else { c.moveTo(0.12, -0.02); c.lineTo(-0.06, -0.02); c.lineTo(-0.1, -0.13); c.lineTo(0.05, -0.13); }
    c.closePath(); c.fill(); c.stroke();
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fill();
    // tail fin
    if (parts.tail) {
      c.fillStyle = wing; c.beginPath();
      c.moveTo(-0.26, -0.06); c.lineTo(-0.42, -0.32); c.lineTo(-0.5, -0.32); c.lineTo(-0.49, -0.02); c.closePath(); c.fill(); c.stroke();
    }
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
    if (parts.cockpit) {
      c.fillStyle = '#9fdcff'; c.beginPath();
      if (jet) c.ellipse(0.2, -0.08, 0.13, 0.055, -0.1, Math.PI, 0);
      else c.ellipse(0.1, -0.1, 0.09, 0.06, 0, Math.PI, 0);
      c.closePath(); c.fill(); c.stroke();
    }
    if (parts.wheels && !M.floats) {
      c.beginPath(); c.moveTo(0.12, 0.08); c.lineTo(0.12, 0.2); c.stroke();
      c.fillStyle = '#2a2a2a'; c.beginPath(); c.arc(0.12, 0.22, 0.045, 0, 6.283); c.fill();
    }
    if (parts.tanks) { c.fillStyle = '#d0d0d0'; c.beginPath(); c.ellipse(0.02, 0.17, 0.14, 0.035, 0, 0, 6.283); c.fill(); c.stroke(); }
    // horizontal stabiliser
    if (parts.tail) {
      c.fillStyle = wing; c.beginPath();
      c.moveTo(-0.3, 0.03); c.lineTo(-0.48, 0.03); c.lineTo(-0.52, 0.11); c.lineTo(-0.38, 0.11); c.closePath(); c.fill(); c.stroke();
    }
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
    if (M.prop && parts.engine) {
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
  // ===================================================================== world
  const CH = 100;
  const SPREAD = 50; // half-width of the populated corridor, in plane-scale units
  let ents = [];
  let nextChunk = 0, runSeed = 1, sig = 1;
  function makeCoinGroup(r, cx, cz, yb, val, out) {
    const n = 6 + Math.floor(r() * 7), sp = 2.8 * sig, kind = Math.floor(r() * 5), amp = (4 + r() * 6) * sig;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      let y = yb, z = cz;
      if (kind === 1) y += Math.sin(f * Math.PI) * amp;
      else if (kind === 2) y += (f - 0.5) * amp * 1.5;
      else if (kind === 3) z += Math.sin(f * Math.PI * 2) * amp * 0.8; // weave left/right
      else if (kind === 4) z += (f - 0.5) * amp * 2; // diagonal across
      out.push({ k: 'coin', x: cx + i * sp, y: Math.max(1.2 * sig, y), z, val, dead: false });
    }
  }
  // Content is spread across a corridor centred on wherever the plane is heading when the chunk is made.
  function genChunk(ci) {
    const r = mulberry32(runSeed ^ Math.imul(ci + 7, 2654435761));
    const x0 = ci * CH * sig;
    const bi = C.biomeIndex(x0), b = BIOMES[bi];
    const ceil = P.st.ceil / sig;
    const zc = P.z + Math.sin(P.h) * Math.max(0, x0 - P.x);
    const zr = () => zc + (r() - 0.5) * 2 * SPREAD * sig;
    const val = Math.max(1, Math.round(4 * sig * b.rate * incomeNow));
    const fresh = [], obst = [];
    if (ci >= 1) {
      const tries = 4 + Math.floor(b.density * 10);
      const list = BIOME_OBST[bi];
      for (let i = 0; i < tries; i++) {
        if (r() > b.density * 0.7) continue;
        const o = makeObst(list[Math.floor(r() * list.length)], x0 + r() * CH * sig, zr(), b, r, ceil);
        obst.push(o);
        if (o.t === 'arch') makeCoinGroup(r, o.x - 12 * sig, o.z, o.h * 0.45, val, fresh); // thread the needle
      }
    }
    const groups = ci === 0 ? 1 : 2 + (r() < 0.5 ? 1 : 0);
    for (let g = 0; g < groups; g++) {
      const yb = (2.5 + Math.pow(r(), 1.5) * ceil * 0.8) * sig;
      if (ci === 0) makeCoinGroup(r, x0 + 35 * sig, 0, 9 * sig, val, fresh);
      else makeCoinGroup(r, x0 + r() * CH * 0.7 * sig, zc + (r() - 0.5) * SPREAD * 1.2 * sig, yb, val, fresh);
    }
    if (ci >= 2 && r() < 0.16) { // ring chain: fly through them all for a big bonus
      const n = 3 + Math.floor(r() * 3), bx = x0 + r() * CH * 0.4 * sig, by = (10 + r() * ceil * 0.5) * sig, bz = zc + (r() - 0.5) * SPREAD * sig;
      const dz = (r() - 0.5) * 6 * sig, dyA = (2 + r() * 4) * sig;
      for (let i = 0; i < n; i++) fresh.push({ k: 'ring', x: bx + i * 16 * sig, y: by + Math.sin(i * 0.9) * dyA, z: bz + i * dz, r: 5 * sig, chain: ci, len: n, dead: false });
    } else if (r() < 0.5 && ci >= 1) fresh.push({ k: 'ring', x: x0 + r() * CH * sig, y: (8 + r() * ceil * 0.6) * sig, z: zc + (r() - 0.5) * SPREAD * sig, r: 5 * sig, dead: false });
    if (r() < 0.16 && ci >= 1) fresh.push({ k: 'fuel', x: x0 + r() * CH * sig, y: (5 + r() * ceil * 0.5) * sig, z: zr(), dead: false });
    if (r() < 0.22 && ci >= 2) fresh.push({ k: 'balloon', x: x0 + r() * CH * sig, y: (6 + r() * ceil * 0.5) * sig, z: zr(), hue: Math.floor(r() * 6), dead: false });
    if (r() < 0.18 && ci >= 1) fresh.push({ k: 'lift', x: x0 + r() * CH * sig, y: 0, z: zr(), w: 10 * sig, top: ceil * 0.9 * sig, dead: false });
    if (r() < 0.09 && ci >= 2) fresh.push({ k: 'gem', x: x0 + r() * CH * sig, y: (ceil * (0.4 + r() * 0.5)) * sig, z: zr(), dead: false });
    if (ci >= 2 && r() < 0.3 + bi * 0.05) {
      const n = 2 + Math.floor(r() * (2 + bi * 0.3));
      const bx = x0 + r() * CH * sig, by = (8 + r() * ceil * 0.7) * sig, bz = zr();
      for (let i = 0; i < n; i++) fresh.push({ k: 'bird', x: bx + i * 4 * sig, y: by + (r() - 0.5) * 6 * sig, z: bz + (r() - 0.5) * 8 * sig, y0: 0, ph: r() * 6, c: b.airC, t: b.air, dead: false });
    }
    // keep pickups out of obstacles
    for (const e of fresh) {
      for (const o of obst) if (hitObst(o, e.x, e.y, e.z, (e.k === 'ring' ? e.r : 0) + 2.5 * sig)) e.y = o.top + 3 * sig + (e.k === 'ring' ? e.r : 0);
      if (e.k === 'bird') e.y0 = e.y;
    }
    for (const o of obst) ents.push(o);
    for (const e of fresh) ents.push(e);
  }
  // Obstacles: each has a list of simple collision shapes, so what you see is what you hit.
  const BIOME_OBST = [
    ['tree', 'tree', 'tree', 'rock'],
    ['silo', 'windmill', 'tree', 'barn', 'tree'],
    ['cactus', 'cactus', 'rock', 'arch'],
    ['pillar', 'pillar', 'arch', 'rock'],
    ['pine', 'pine', 'iceberg', 'rock'],
    ['tower', 'tower', 'tower', 'blimp'],
    ['buoy', 'ship', 'iceberg', 'blimp'],
    ['spire', 'spire', 'rock', 'windmill'],
    ['windmill', 'tower', 'mine', 'mine'],
    ['spire', 'mine', 'blimp', 'mine'],
    ['satellite', 'mine', 'spire', 'satellite'],
  ];
  const ROCK_C = ['#8a8f96', '#9a8f7a', '#c9a46a', '#a4562f', '#cfe3f2', '#7a8496', '#6a7480', '#3a2f2f', '#5a6470', '#4a5470', '#6a6a78'];
  const GIANT = new Set(['tree', 'pine', 'spire', 'pillar', 'tower', 'windmill']);
  function makeObst(t, x, z, b, r, ceil) {
    const s = sig, bi = BIOMES.indexOf(b);
    // ~1 in 4 of the tall kinds is a giant that reaches up into cruising altitude
    const giant = GIANT.has(t) && r() < 0.24, gk = giant ? 1.9 : 1;
    const hB = giant ? (0.45 + r() * 0.45) * ceil * s : (b.hMin + r() * (b.hMax - b.hMin)) * s;
    const e = { k: 'obst', t, x, y: 0, z, w: 4 * s, h: hB, top: hB, seed: r(), cols: [], dead: false, col: '', sg: s };
    const cyl = (r0, y1, y0) => e.cols.push({ c: 'cyl', x, z, r: r0, y0: y0 || 0, y1 });
    const box = (cx, cy, cz, hx, hy, hz) => e.cols.push({ c: 'box', x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy, z0: cz - hz, z1: cz + hz });
    switch (t) {
      case 'tree': e.w = 4.5 * s * gk; cyl(e.w * 0.5, e.h); break;
      case 'rock': e.w = (5 + r() * 6) * s; e.h = e.top = e.w * 0.75; e.col = ROCK_C[bi]; cyl(e.w * 0.42, e.h * 0.9); break;
      case 'silo': e.w = 5 * s; e.top = e.h + e.w / 2; cyl(e.w / 2, e.top); break;
      case 'cactus': e.w = 2.6 * s; cyl(e.w * 0.6, e.h); break;
      case 'pine': e.w = 6 * s * gk; e.cols.push({ c: 'cone', x, z, r: e.w / 2, h: e.h }); break;
      case 'spire': e.w = 9 * s * gk; e.cols.push({ c: 'cone', x, z, r: e.w / 2, h: e.h }); break;
      case 'iceberg': e.w = (14 + r() * 10) * s; e.h = e.top = (8 + r() * 12) * s; e.cols.push({ c: 'cone', x, z, r: e.w / 2, h: e.h }); break;
      case 'pillar': e.w = (7 + r() * 5) * s * gk; box(x, e.h / 2, z, e.w / 2, e.h / 2, e.w * 0.45); break;
      case 'tower': e.w = (10 + r() * 8) * s * (giant ? 1.4 : 1); box(x, e.h / 2, z, e.w / 2, e.h / 2, e.w / 2); break;
      case 'barn': {
        e.L = (12 + r() * 6) * s; e.D = (8 + r() * 3) * s; e.wh = (6 + r() * 2) * s; e.h = e.top = e.wh * 1.6;
        box(x, e.wh / 2, z, e.L / 2, e.wh / 2, e.D / 2);
        box(x, e.wh + (e.h - e.wh) / 3, z, e.L / 2, (e.h - e.wh) / 3, e.D / 4);
        e.w = e.L;
        break;
      }
      case 'buoy': e.w = 2.5 * s; e.h = e.top = (4 + r() * 4) * s; cyl(e.w / 2, e.h); break;
      case 'windmill': {
        e.w = 1.4 * s; e.h = giant ? hB : (22 + r() * 22) * s; e.R = Math.min(e.h * 0.42, 30 * s); e.top = e.h + e.R;
        e.om = (1 + r() * 0.8) * (r() < 0.5 ? -1 : 1); e.ph = r() * 6.28;
        cyl(0.9 * s, e.h);
        e.cols.push({ c: 'blade', x: x + 1.2 * s, y: e.h, z, R: e.R, bw: 1.1 * s, om: e.om, ph: e.ph });
        e.w = 3 * s;
        break;
      }
      case 'arch': {
        e.gap = (16 + r() * 8) * s; e.h = (16 + r() * 14) * s; e.th = 4 * s; e.leg = 5 * s; e.top = e.h + e.th;
        const off = e.gap / 2 + e.leg / 2;
        box(x, e.h / 2, z - off, 3 * s, e.h / 2, e.leg / 2);
        box(x, e.h / 2, z + off, 3 * s, e.h / 2, e.leg / 2);
        box(x, e.h + e.th / 2, z, 3 * s, e.th / 2, off + e.leg / 2);
        e.w = 6 * s; e.col = ROCK_C[bi];
        break;
      }
      case 'ship': {
        e.L = (26 + r() * 10) * s; e.h = 5 * s; e.top = 12 * s;
        box(x, e.h / 2, z, e.L / 2, e.h / 2, 4.5 * s);
        box(x - e.L * 0.15, 8 * s, z, 5 * s, 3.5 * s, 3 * s);
        e.w = e.L;
        break;
      }
      case 'blimp': {
        e.a = (14 + r() * 6) * s; e.b = (5 + r() * 2) * s;
        e.y = Math.min(ceil * 0.75 * s, (22 + r() * 35) * s); e.top = e.y + e.b; e.h = e.top;
        e.cols.push({ c: 'ell', x, y: e.y, z, a: e.a, b: e.b });
        e.w = e.a * 2;
        break;
      }
      case 'mine': {
        e.y = (8 + r() * ceil * 0.65) * s; e.rad = 2.4 * s; e.top = e.y + e.rad; e.h = e.top;
        e.cols.push({ c: 'ell', x, y: e.y, z, a: e.rad * 1.15, b: e.rad * 1.15 });
        e.w = 5 * s;
        break;
      }
      case 'satellite': {
        e.y = (10 + r() * ceil * 0.6) * s; e.top = e.y + 2 * s; e.h = e.top;
        box(x, e.y, z, 1.6 * s, 1.6 * s, 1.6 * s);
        box(x, e.y, z, 0.4 * s, 1.2 * s, 7.5 * s);
        e.w = 4 * s;
        break;
      }
    }
    return e;
  }
  function hitObst(e, x, y, z, pr) {
    const cs = e.cols;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      switch (c.c) {
        case 'cyl': {
          if (y - pr > c.y1 || y + pr < c.y0) break;
          const dx = x - c.x, dz = z - c.z, rr = c.r + pr;
          if (dx * dx + dz * dz < rr * rr) return true;
          break;
        }
        case 'cone': {
          if (y - pr > c.h) break;
          const rr = c.r * Math.max(0, 1 - y / c.h) + pr, dx = x - c.x, dz = z - c.z;
          if (dx * dx + dz * dz < rr * rr) return true;
          break;
        }
        case 'box':
          if (x + pr > c.x0 && x - pr < c.x1 && y + pr > c.y0 && y - pr < c.y1 && z + pr > c.z0 && z - pr < c.z1) return true;
          break;
        case 'ell': {
          const dx = (x - c.x) / (c.a + pr), dy = (y - c.y) / (c.b + pr), dz = (z - c.z) / (c.b + pr);
          if (dx * dx + dy * dy + dz * dz < 1) return true;
          break;
        }
        case 'blade': { // three spinning blades: time it right and you slip between them
          if (Math.abs(x - c.x) > c.bw + pr) break;
          const dy = y - c.y, dz = z - c.z, rr = Math.hypot(dy, dz);
          if (rr > c.R + pr) break;
          if (rr < 1.6 * sig) return true;
          const th = Math.atan2(dz, dy);
          for (let k = 0; k < 3; k++) {
            const d = th - (c.ph + c.om * gameT + k * 2.0944);
            if (Math.cos(d) > 0 && Math.abs(rr * Math.sin(d)) < c.bw + pr) return true;
          }
          break;
        }
      }
    }
    return false;
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
  for (let i = 0; i < PMAX; i++) parts.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, color: '#fff', alpha: 1, g: 0 });
  let pIdx = 0;
  function spawn(x, y, z, vx, vy, vz, life, size, color, g, alpha) {
    if (S.set.perf && (pIdx & 1)) { pIdx++; return; }
    const p = parts[pIdx]; pIdx = (pIdx + 1) % PMAX;
    p.on = true; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.life = life; p.max = life; p.size = size; p.color = color; p.g = g || 0; p.alpha = alpha || 1;
  }
  function burstAt(x, y, z, n, speed, life, size, color, g) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.acos(Math.random() * 2 - 1), sp = speed * (0.3 + Math.random() * 0.7);
      spawn(x, y, z, Math.cos(a) * Math.sin(b) * sp, Math.cos(b) * sp, Math.sin(a) * Math.sin(b) * sp, life * (0.6 + Math.random() * 0.4), size * (0.6 + Math.random() * 0.6), color, g);
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
  const P = { x: 0, y: 0, z: 0, v: 0, p: 0, h: 0, bank: 0, fuel: 0, rocket: 0, rocketOn: false, ground: false, water: false, st: null, rk: null };
  let incomeNow = 1;
  let run = null;
  let simAcc = 0, gameT = 0, shake = 0;
  const trail = new Float32Array(64 * 3); let trailN = 0, trailHead = 0, trailTimer = 0;
  let snapCam = true;
  const prev = { x: 0, y: 0, z: 0, p: 0, h: 0, gam: 0 }; // last physics state, for smooth interpolation between steps
  const planeLen = () => 3 * sig * P.st.scale * 1.3; // drawn a bit larger than the hitbox
  const HSTEP = 1 / 120;

  function resetPlane() {
    P.st = C.planeStats(S.lv.plane);
    P.rk = C.rocketStats(Math.max(1, S.lv.rocket));
    sig = P.st.sig;
    const ap = aimPos();
    P.x = ap.x; P.y = ap.y; P.z = 0; P.v = 0; P.p = 0; P.gam = 0; P.a = 0; P.h = 0; P.bank = 0; P.hr = 0;
    P.fuel = P.st.fuel; P.rocket = S.lv.rocket > 0 ? P.rk.time : 0;
    P.rocketOn = false; P.ground = false; P.water = false;
  }
  let builtPlane = '';
  function rebuildPlane() {
    const key = C.modelIndex(S.lv.plane) + ':' + S.paint + ':' + S.lv.plane;
    if (key === builtPlane) return;
    builtPlane = key;
    W3.setPlane(C.modelIndex(S.lv.plane), PAINTS[S.paint] || PAINTS[0], planeLen(), C.planeParts(S.lv.plane));
  }

  function startAim() {
    state = 'aim';
    $('hangar').classList.add('hidden');
    resetPlane();
    aim.power = 0; aim.yaw = 0; aim.active = false;
  }
  const LAUNCH_PITCH = 0.42;
  function launch() {
    Sfx.init();
    incomeNow = C.incomeMult(S.lv.income);
    runSeed = (Math.random() * 1e9) | 0;
    ents.length = 0; nextChunk = 0;
    const power = aim.power;
    const ap = aimPos();
    P.x = ap.x; P.y = ap.y; P.z = ap.z;
    P.v = P.st.vbg * C.slingPower(S.lv.sling) * power;
    P.p = P.gam = LAUNCH_PITCH; P.a = 0; P.h = aim.yaw; P.bank = 0; P.hr = 0;
    prev.x = P.x; prev.y = P.y; prev.z = P.z; prev.p = P.p; prev.h = P.h; prev.gam = P.gam; simAcc = 0;
    run = {
      dist: 0, coins: 0, distCoins: 0, pickCoins: 0, skimCoins: 0, gems: 0, picks: 0, rings: 0, balloons: 0, birds: 0,
      combo: 0, comboT: 0, maxCombo: 0, nears: 0, swoops: 0, diving: false, diveTop: 0, rush: 0, nextRush: 25, booms: 0, boomArmed: false, chainId: -1, chainN: 0, path: [], pathT: 0, skimT: 0, skimShow: 0, maxAlt: 0, t: 0, record: false, end: '', endT: 0,
      bestAtStart: S.best, newBiomes: [], fuelFlash: 0,
    };
    trailN = 0; fovKick = 0; timeScale = 1; slowHold = 0;
    ghostRun = loadGhost();
    W3.resetScenery(P.x, P.z, sig);
    state = 'fly';
    Sfx.launch(); Sfx.engineStart(!MODELS[P.st.model].prop);
    buzz(25);
    shake = 0.4;
    burstAt(P.x, P.y, P.z, 14, 8 * sig, 0.6, 0.5 * sig, '#ffffff', 0);
    if (power > 0.97) floatText(W * 0.5, H * 0.38, 'MAX POWER!', '#ffd23a', 30, 1.1);
    S.tut = Math.max(S.tut, 1);
  }

  // where the plane sits in the slingshot pocket while being pulled back
  function aimPos() {
    const L = 3 * sig * C.planeStats(S.lv.plane).scale * 1.3;
    const pull = state === 'aim' ? aim.power : 0;
    const back = pull * 0.9 * L;
    return { x: 0.1 * L - Math.cos(aim.yaw) * back, y: 1.12 * L - pull * 0.15 * L, z: -Math.sin(aim.yaw) * back };
  }
  function addCoins(v, kind) {
    run.coins += v;
    if (kind === 'pick') run.pickCoins += v;
  }

  // After a flight ends the plane becomes a loose body: it keeps its momentum, falls,
  // bounces, tumbles and skids to a stop.
  const wreck = { vx: 0, vy: 0, vz: 0, sp: 0, sr: 0, settle: 0 };
  function endFlight(reason, cause) {
    if (state !== 'fly') return;
    state = 'ending';
    run.end = reason; run.endT = 0;
    Sfx.engineStop();
    const g = P.gam || 0, cg = Math.cos(g);
    wreck.vx = P.v * cg * Math.cos(P.h); wreck.vy = P.v * Math.sin(g); wreck.vz = P.v * cg * Math.sin(P.h);
    wreck.sp = 0; wreck.sr = 0; wreck.settle = 0;
    if (reason === 'crash') {
      const vb = P.st.vbg;
      if (cause === 'ground') { wreck.vy = Math.abs(wreck.vy) * 0.3; wreck.vx *= 0.55; wreck.vz *= 0.55; }
      else { wreck.vx *= -0.22; wreck.vz = wreck.vz * 0.3 + (Math.random() - 0.5) * vb * 0.6; wreck.vy = Math.max(wreck.vy, 0) * 0.3 + vb * 0.25; }
      wreck.sp = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 4);
      wreck.sr = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 6);
      Sfx.crash(); buzz([40, 30, 60]); shake = 1;
      burstAt(P.x, P.y, P.z, 26, 12 * sig, 0.8, 0.8 * sig, '#ff9a3a', -2 * sig);
      burstAt(P.x, P.y, P.z, 18, 7 * sig, 1.3, 1.3 * sig, '#666666', 1 * sig);
      burstAt(P.x, P.y, P.z, 14, 10 * sig, 1.2, 0.35 * sig, MODELS[P.st.model].body, -9 * sig);
      S.stats.crashes++;
    }
  }
  function updateWreck(dt) {
    const g = P.st.g, vb = P.st.vbg;
    wreck.vy -= g * dt;
    const air = Math.max(0, 1 - 0.35 * dt);
    wreck.vx *= air; wreck.vz *= air;
    P.x += wreck.vx * dt; P.y += wreck.vy * dt; P.z += wreck.vz * dt;
    P.p += wreck.sp * dt; P.bank += wreck.sr * dt;
    const hs = Math.hypot(wreck.vx, wreck.vz);
    if (P.y <= 0) {
      P.y = 0;
      if (wreck.vy < -0.25 * vb) {
        const hit = -wreck.vy;
        wreck.vy = hit * 0.35; wreck.vx *= 0.72; wreck.vz *= 0.72; wreck.sp *= 0.6; wreck.sr *= 0.6;
        Sfx.bounce(); shake = Math.max(shake, Math.min(0.6, hit / vb * 0.3));
        const b = BIOMES[C.biomeIndex(P.x)];
        burstAt(P.x, 0, P.z, 10, 5 * sig, 0.7, 0.7 * sig, b.water ? '#bfe6ff' : b.edge, -6 * sig);
      } else {
        wreck.vy = 0;
        // ground friction, and the wreck settles flat (right way up or upside down)
        const f = Math.max(0, hs - (BIOMES[C.biomeIndex(P.x)].water ? 1.4 : 0.7) * g * dt);
        if (hs > 0) { wreck.vx *= f / hs; wreck.vz *= f / hs; }
        wreck.sp *= Math.max(0, 1 - 6 * dt); wreck.sr *= Math.max(0, 1 - 6 * dt);
        P.p += (0 - P.p) * Math.min(1, dt * 5);
        const flat = Math.round(P.bank / Math.PI) * Math.PI;
        P.bank += (flat - P.bank) * Math.min(1, dt * 5);
        if (hs > 0.2 * vb && Math.random() < 0.4) spawn(P.x, 0.2 * sig, P.z, -wreck.vx * 0.1, (1 + Math.random() * 2) * sig, 0, 0.6, 0.6 * sig, BIOMES[C.biomeIndex(P.x)].edge, -3 * sig);
      }
    }
    if (run.end === 'crash' && Math.random() < 0.5) spawn(P.x, P.y + 0.3 * sig, P.z, 0, 2 * sig, 0, 1.2, 1.0 * sig, '#555555', 0.5 * sig, 0.6);
    run.dist = Math.max(run.dist, P.x);
    if (P.y === 0 && hs < 0.06 * vb) wreck.settle += dt;
    if (wreck.settle > 0.6 || run.endT > 5) finishRun();
  }

  function finishRun() {
    const r = run;
    r.landBonus = r.end === 'land' ? Math.round(r.coins * 0.1) : 0;
    r.total = Math.round(r.coins + r.landBonus);
    r.prevBest = S.best;
    if (r.dist > S.best) { S.best = r.dist; saveGhost(r.path); }
    S.total += r.dist; S.flights++;
    S.stats.earned += r.total; S.stats.rings += r.rings;
    // missions
    trackMission('dist', r.dist, true); trackMission('pick', r.picks, true); trackMission('combo', r.maxCombo, true);
    trackMission('rings', r.rings); trackMission('flights', 1); trackMission('skim', r.skimT); trackMission('near', r.nears); trackMission('swoop', r.swoops); trackMission('balloon', r.balloons);
    state = 'result';
    save();
    showResults();
  }

  // ===================================================================== input
  const aim = { active: false, id: -1, sx: 0, sy: 0, power: 0, yaw: 0 };
  const stick = { id: -1, ax: 0, ay: 0, x: 0, y: 0, on: false };
  let boostId = -1, keyUp = false, keyDown = false, keyLeft = false, keyRight = false, keyBoost = false;
  // computers with a mouse/trackpad get keyboard hints
  const KEYS = !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
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
      if (stick.id === -1) { stick.id = e.pointerId; stick.ay = y; stick.y = y; stick.ax = x; stick.x = x; stick.on = true; }
    }
  });
  window.addEventListener('pointermove', (e) => {
    const x = e.clientX, y = e.clientY;
    if (state === 'aim' && aim.active && e.pointerId === aim.id) {
      // pull down to stretch the band, left/right to aim the other way (like a real slingshot)
      const dx = x - aim.sx, dy = y - aim.sy;
      const maxPull = Math.min(W, H) * 0.42;
      const prev = aim.power;
      aim.power = clamp(dy / maxPull, 0, 1);
      aim.yaw = clamp(-dx / (W * 0.45), -1, 1) * 0.55;
      if (Math.floor(aim.power * 10) !== Math.floor(prev * 10)) { Sfx.stretch(aim.power); if (aim.power > 0.97 && prev <= 0.97) buzz(10); }
    }
    if (e.pointerId === stick.id) {
      stick.x = x; stick.y = y;
      // floating stick: the anchor follows if you drag past the edge
      const maxR = 70 * S.set.sens, dx = stick.x - stick.ax, dy = stick.y - stick.ay, d = Math.hypot(dx, dy);
      if (d > maxR) { stick.ax = stick.x - dx / d * maxR; stick.ay = stick.y - dy / d * maxR; }
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
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keyLeft = true;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') keyRight = true;
    if (k === ' ' || k === 'Shift') {
      keyBoost = true;
      if (state === 'hangar' && $('modal').classList.contains('hidden')) { startAim(); aim.power = 1; }
      else if (state === 'aim') { aim.power = 1; launch(); }
    }
    if (k === 'Escape' || k === 'p') { if (state === 'fly') pause(); }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') keyUp = false;
    if (k === 'ArrowDown' || k === 's' || k === 'S') keyDown = false;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keyLeft = false;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') keyRight = false;
    if (k === ' ' || k === 'Shift') keyBoost = false;
  });
  const input = { u: 0, ux: 0 };
  const keyAxis = { u: 0, x: 0 };
  function controlInput(dt) {
    let u = 0, ux = 0;
    if (stick.on) {
      const R = 55 * S.set.sens;
      // flight-stick style by default: pull down (toward you) to climb
      const dx = (stick.x - stick.ax) / R, dy = (S.set.invert ? stick.y - stick.ay : stick.ay - stick.y) / R;
      // soft response curve: small moves give fine control, full deflection still turns hard
      const curve = (d, k) => (Math.abs(d) < 0.08 ? 0 : Math.sign(d) * Math.pow(Math.min(1, (Math.abs(d) - 0.08) / 0.92), k));
      ux = curve(dx, 1.6);
      if (S.set.control === 'hold') u = 1;
      else u = curve(dy, 2.1); // extra-soft center for pitch: small moves = tiny corrections
    }
    // keys follow the same "pull down to climb" setting as the stick, and ramp in smoothly
    let ku = keyUp ? 1 : keyDown ? -1 : 0;
    if (S.set.invert) ku = -ku;
    const kx = keyLeft ? -1 : keyRight ? 1 : 0;
    const kr = Math.min(1, (dt || 0) * 5);
    keyAxis.u += (ku - keyAxis.u) * kr; keyAxis.x += (kx - keyAxis.x) * kr;
    if (ku || Math.abs(keyAxis.u) > 0.02) u = keyAxis.u;
    if (kx || Math.abs(keyAxis.x) > 0.02) ux = keyAxis.x;
    input.u = u * S.set.pitch; input.ux = ux;
    return input;
  }

  // ===================================================================== update
  function updateFly(dt) {
    const inp = controlInput(dt);
    P.rocketOn = (boostId !== -1 || keyBoost) && P.rocket > 0;
    simAcc += dt;
    while (simAcc >= HSTEP && state === 'fly') {
      simAcc -= HSTEP;
      prev.x = P.x; prev.y = P.y; prev.z = P.z; prev.p = P.p; prev.h = P.h; prev.gam = P.gam;
      physStep(inp.u, inp.ux);
    }
    P.bank += ((P.hr || 0) * 1.25 - P.bank) * Math.min(1, dt * 3);
    run.t += dt;
    if (run.comboT > 0) { run.comboT -= dt; if (run.comboT <= 0) run.combo = 0; }
    if (run.rush > 0) run.rush -= dt;
    if (P.rocketOn) fovKick = Math.max(fovKick, 7);
    // sonic boom when you break through a speed barrier
    const vn = P.v / P.st.vbg;
    if (vn < 2.3) run.boomArmed = true;
    if (run.boomArmed && vn > 3.1 && run.booms < 3) {
      run.boomArmed = false; run.booms++;
      const v = Math.round(BIOMES[C.biomeIndex(P.x)].rate * 80 * sig * incomeNow);
      addCoins(v, 'pick');
      Sfx.boom(); buzz([30, 20, 40]); shake = Math.max(shake, 0.5); fovKick = 16; slowmo(0.3, 0.3);
      for (let i = 0; i < 40; i++) { const a = i / 40 * 6.283; spawn(P.x, P.y, P.z, P.v * 0.3, Math.cos(a) * 14 * sig, Math.sin(a) * 14 * sig, 0.7, 0.7 * sig, '#ffffff', 0, 0.8); }
      floatText(W * 0.5, H * 0.34, 'SONIC BOOM! +' + fmt(v), '#ffffff', 30, 1.2);
    }
    // record the path for the ghost replay
    run.pathT -= dt;
    if (run.pathT <= 0) { run.pathT += GHOST_DT; run.path.push(P.x, P.y, P.z, P.h); }
    // sparkles rising through updrafts ahead
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.k !== 'lift' || e.x < P.x - 10 * sig || e.x > P.x + 150 * sig || Math.random() > 0.35) continue;
      const a = Math.random() * 6.283, rr = Math.random() * e.w * 0.45;
      spawn(e.x + Math.cos(a) * rr, Math.random() * e.top * 0.6, e.z + Math.sin(a) * rr, 0, (10 + Math.random() * 8) * sig, 0, 1.6, 0.35 * sig, '#ffffff', 0, 0.7);
    }
    Sfx.engine(P.v / P.st.vbg, P.fuel > 0, P.rocketOn);
    // exhaust / smoke
    if (P.fuel > 0 || P.rocketOn) {
      const L = planeLen() * 0.5, cp = Math.cos(P.p);
      const bx = P.x - Math.cos(P.h) * cp * L, by = P.y - Math.sin(P.p) * L, bz = P.z - Math.sin(P.h) * cp * L;
      const r = () => (Math.random() - 0.5) * 4 * sig;
      if (P.rocketOn) spawn(bx, by, bz, P.v * 0.6 * Math.cos(P.h) + r(), r(), P.v * 0.6 * Math.sin(P.h) + r(), 0.3, 0.5 * sig, Math.random() < 0.5 ? '#ffb43a' : '#ff6a1a', 0);
      else if (Math.random() < 0.35) spawn(bx, by, bz, -P.v * 0.1, (Math.random() - 0.3) * sig, 0, 0.6, 0.4 * sig, '#ffffff', 0.5 * sig, 0.6);
    }
  }

  function physStep(u, ux) {
    const ox = P.x;
    let lift = 0;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.k === 'lift' && Math.abs(P.x - e.x) < e.w / 2 && Math.abs(P.z - e.z) < e.w / 2 && P.y < e.top) { lift = 11; break; }
    }
    const bi = C.biomeIndex(P.x), b = BIOMES[bi];
    P.water = !!b.water;
    const wasGround = P.ground;
    const ev = C.stepPlane(P, u, HSTEP, lift, ux);
    if (ev === 'smash') {
      floatText(W * 0.5, H * 0.42, 'NOSE DIVE!', '#ff6b6b', 28, 1);
      endFlight('crash', 'ground');
      return;
    }
    if (ev === 'bounce') {
      Sfx.bounce(); buzz(15); shake = Math.max(shake, 0.35);
      if (P.water) { burstAt(P.x, 0, P.z, 18, 9 * sig, 0.8, 0.7 * sig, '#bfe6ff', -9 * sig); Sfx.splash(); }
      else burstAt(P.x, 0, P.z, 14, 7 * sig, 0.7, 0.7 * sig, b.edge, -6 * sig);
      floatText(W * 0.5, H * 0.42, 'BOUNCE!', '#fff', 24, 0.7);
    }
    if (P.ground && !wasGround && ev !== 'bounce' && P.water) Sfx.splash();
    if (P.ground && Math.random() < 0.3) spawn(P.x, 0.2 * sig, P.z + (Math.random() - 0.5) * sig, -P.v * 0.1, (1 + Math.random() * 2) * sig, (Math.random() - 0.5) * 2 * sig, 0.6, 0.6 * sig, P.water ? '#dff3ff' : b.edge, -3 * sig);
    const dx = P.x - ox;
    run.dist = Math.max(run.dist, P.x);
    if (dx > 0) { const dc = dx * b.rate * incomeNow; run.distCoins += dc; addCoins(dc, 'dist'); }
    if (P.y > run.maxAlt) run.maxAlt = P.y;
    // skim bonus
    if (!P.ground && P.y < 3.5 * sig && P.v > P.st.vbg * 0.9) {
      run.skimT += HSTEP;
      const sc = HSTEP * 6 * sig * b.rate * incomeNow;
      run.skimCoins += sc; addCoins(sc, 'skim');
      run.skimShow = 0.3;
      if (Math.random() < 0.25) spawn(P.x - sig, 0.3 * sig, P.z, -P.v * 0.3, (2 + Math.random() * 3) * sig, (Math.random() - 0.5) * 3 * sig, 0.4, 0.5 * sig, '#ffd23a', -4 * sig);
    }
    // swoop: dive, then level out - the height you traded comes back as a burst of speed
    if (!run.diving && !P.ground && P.gam < -0.3) { run.diving = true; run.diveTop = P.y; }
    else if (run.diving) {
      if (P.ground) run.diving = false;
      else if (P.gam > -0.05) {
        run.diving = false;
        const drop = run.diveTop - P.y;
        if (drop > 10 * sig) {
          const k = Math.min(1, drop / (60 * sig)), low = P.y < 8 * sig;
          C.kick(P, P.st.vbg * (0.18 + 0.4 * k) * (low ? 1.3 : 1));
          const v = Math.round(b.rate * 12 * sig * (1 + 3 * k) * (low ? 2 : 1) * incomeNow);
          addCoins(v, 'pick'); run.swoops++;
          run.combo += 2; run.comboT = 1.6; if (run.combo > run.maxCombo) run.maxCombo = run.combo;
          Sfx.ring(); buzz(12); fovKick = Math.max(fovKick, 6 + 8 * k);
          floatText(W * 0.5, H * 0.34, (low ? 'LOW SWOOP! +' : 'SWOOP! +') + fmt(v), low ? '#ff9a3a' : '#7be276', 26 + Math.round(k * 6), 1);
          checkRush();
        }
      }
    }
    // records & zones
    if (!run.record && run.bestAtStart > 50 && P.x > run.bestAtStart) {
      run.record = true; banner('NEW RECORD!', fmtDist(run.bestAtStart) + ' beaten'); Sfx.fanfare(); buzz(30);
      burstAt(P.x, P.y, P.z, 26, 10 * sig, 1.0, 0.6 * sig, '#ffd23a', -4 * sig);
    }
    if (bi > S.maxBiome) {
      S.maxBiome = bi;
      const g = 2 + bi;
      run.gems += g; run.newBiomes.push(bi);
      banner('NEW ZONE: ' + b.name.toUpperCase(), '+' + g + ' gems');
      Sfx.fanfare(); buzz(30);
    }
    // collisions
    const pr = 0.8 * sig, cr = 2.8 * sig, cr2 = cr * cr;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.dead) continue;
      const ddx = e.x - P.x;
      if (ddx > 30 * sig || ddx < -30 * sig) continue;
      const ddz = e.z - P.z;
      switch (e.k) {
        case 'coin': {
          if (run.rush > 0 && ddx < 14 * sig && ddx > -4 * sig) { // gold rush magnet
            const k = Math.min(1, HSTEP * 7);
            e.x += (P.x - e.x) * k; e.y += (P.y - e.y) * k; e.z += (P.z - e.z) * k;
          }
          const dy = e.y - P.y;
          if (ddx * ddx + dy * dy + ddz * ddz < cr2) {
            e.dead = true;
            run.combo++; run.comboT = 1.4; if (run.combo > run.maxCombo) run.maxCombo = run.combo;
            const v = e.val * (1 + Math.min(run.combo, 40) * 0.05) * (run.rush > 0 ? 2 : 1);
            checkRush();
            run.picks++; addCoins(v, 'pick');
            Sfx.coin(run.combo);
            spawn(e.x, e.y, e.z, 0, 3 * sig, 0, 0.35, 1.2 * sig, '#ffe27a', 0);
          }
          break;
        }
        case 'gem': {
          const dy = e.y - P.y;
          if (ddx * ddx + dy * dy + ddz * ddz < cr2 * 1.5) {
            e.dead = true; run.gems++; Sfx.gem(); buzz(20);
            burstAt(e.x, e.y, e.z, 14, 8 * sig, 0.7, 0.6 * sig, '#7fd0ff', 0);
            floatText(W * 0.5, H * 0.36, '+1 GEM', '#7fd0ff', 26, 1);
          }
          break;
        }
        case 'fuel': {
          const dy = e.y - P.y;
          if (ddx * ddx + dy * dy + ddz * ddz < cr2 * 1.4) {
            e.dead = true; P.fuel = Math.max(P.fuel, 0) + 1.5; Sfx.ring(); run.fuelFlash = 0.6;
            burstAt(e.x, e.y, e.z, 10, 6 * sig, 0.5, 0.6 * sig, '#ff5050', 0);
            floatText(W * 0.5, H * 0.36, '+FUEL', '#ff7070', 24, 0.9);
          }
          break;
        }
        case 'ring': {
          const dy = e.y - P.y;
          if (Math.abs(ddx) < 1.4 * sig && dy * dy + ddz * ddz < e.r * e.r) {
            e.dead = true; run.rings++;
            C.kick(P, P.st.vbg * 0.55);
            run.combo += 5; run.comboT = 1.6; if (run.combo > run.maxCombo) run.maxCombo = run.combo;
            Sfx.ring(); buzz(15); shake = Math.max(shake, 0.25); fovKick = Math.max(fovKick, 6);
            burstAt(e.x, e.y, e.z, 20, 10 * sig, 0.6, 0.55 * sig, '#ffb43a', 0);
            if (e.chain !== undefined) {
              if (run.chainId === e.chain) run.chainN++; else { run.chainId = e.chain; run.chainN = 1; }
              if (run.chainN >= e.len) {
                const v = Math.round(b.rate * 40 * sig * e.len * incomeNow);
                addCoins(v, 'pick'); Sfx.fanfare(); slowmo(0.35, 0.25);
                floatText(W * 0.5, H * 0.36, 'PERFECT CHAIN! +' + fmt(v), '#ffd23a', 30, 1.2);
              } else floatText(W * 0.5, H * 0.38, 'RING ' + run.chainN + ' / ' + e.len, '#ffb43a', 28, 0.8);
            } else floatText(W * 0.5, H * 0.38, 'BOOST!', '#ffb43a', 28, 0.8);
            checkRush();
          }
          break;
        }
        case 'balloon': {
          const dy = e.y - P.y;
          if (ddx * ddx + dy * dy + ddz * ddz < (3.4 * sig) * (3.4 * sig)) {
            e.dead = true; run.balloons++;
            C.kick(P, P.st.vbg * 0.3, 0, 0.6);
            const v = Math.round(BIOMES[bi].rate * 25 * sig * incomeNow);
            addCoins(v, 'pick');
            Sfx.balloon(); buzz(15);
            burstAt(e.x, e.y, e.z, 18, 9 * sig, 0.6, 0.6 * sig, BALLOON_C[e.hue], -5 * sig);
            floatText(W * 0.5, H * 0.38, 'POP! +' + fmt(v), '#ffe27a', 26, 0.9);
          }
          break;
        }
        case 'bird': {
          const dy = e.y - P.y;
          if (ddx * ddx + dy * dy + ddz * ddz < (2.2 * sig) * (2.2 * sig)) {
            e.dead = true; run.birds++;
            P.v *= 0.72; C.kick(P, 0, -0.2);
            Sfx.hit(); buzz(20); shake = Math.max(shake, 0.4);
            burstAt(e.x, e.y, e.z, 12, 6 * sig, 0.9, 0.5 * sig, e.c, -3 * sig);
            floatText(W * 0.5, H * 0.4, 'OUCH!', '#ff6b6b', 24, 0.7);
            run.combo = 0;
          }
          break;
        }
        case 'obst': {
          if (e.t === 'arch' && !e.thr && Math.abs(ddx) < 2 * sig && Math.abs(ddz) < e.gap / 2 && P.y < e.h) {
            e.thr = true; e.nm = true;
            const v = Math.round(b.rate * 60 * sig * incomeNow);
            addCoins(v, 'pick'); run.combo += 5; run.comboT = 1.6; run.nears++;
            Sfx.ring(); buzz(20);
            floatText(W * 0.5, H * 0.34, 'THREADED IT! +' + fmt(v), '#7be276', 28, 1.1);
            slowmo(0.3, 0.3);
          }
          if (P.y - pr - NEAR * sig > e.top) break;
          if (hitObst(e, P.x, P.y, P.z, pr)) { endFlight('crash'); return; }
          if (!e.nm && hitObst(e, P.x, P.y, P.z, pr + NEAR * sig)) {
            e.nm = true; run.nears++;
            const v = Math.round(b.rate * 20 * sig * incomeNow);
            addCoins(v, 'pick'); run.combo += 3; run.comboT = 1.6; if (run.combo > run.maxCombo) run.maxCombo = run.combo;
            Sfx.balloon(); buzz(10);
            floatText(W * 0.5, H * 0.34, 'NEAR MISS! +' + fmt(v), '#7fd0ff', 24, 0.9);
            slowmo(0.4, 0.15);
          }
          break;
        }
      }
    }
    if (P.ground && P.v < P.st.vbg * 0.15) endFlight('land');
    if (run.t > 600) endFlight('land');
    // trail
    trailTimer += HSTEP;
    if (trailTimer > 0.025) {
      trailTimer = 0;
      const L = planeLen() * 0.42, cp = Math.cos(P.p);
      trail[trailHead * 3] = P.x - Math.cos(P.h) * cp * L; trail[trailHead * 3 + 1] = P.y - Math.sin(P.p) * L; trail[trailHead * 3 + 2] = P.z - Math.sin(P.h) * cp * L;
      trailHead = (trailHead + 1) % 64; if (trailN < 64) trailN++;
    }
  }
  const NEAR = 2.4; // how close counts as a near miss, in plane-scale units
  // ---- juice: slow motion, camera punch, gold rush, ghost of the best run
  let timeScale = 1, slowHold = 0, lastSlow = -9, fovKick = 0;
  function slowmo(scale, hold) {
    if (gameT - lastSlow < 1) return;
    lastSlow = gameT; timeScale = Math.min(timeScale, scale); slowHold = Math.max(slowHold, hold);
  }
  function checkRush() {
    if (run.combo < run.nextRush) return;
    run.nextRush = run.combo + 30; run.rush = 6;
    Sfx.rush(); buzz([20, 30, 20]);
    banner('GOLD RUSH!', 'double coins + magnet for 6s');
    burstAt(P.x, P.y, P.z, 30, 10 * sig, 0.8, 0.5 * sig, '#ffd23a', 0);
  }
  const GHOST_KEY = 'skyfling.ghost.v1', GHOST_DT = 0.12;
  let ghostRun = null;
  function loadGhost() { try { const g = JSON.parse(localStorage.getItem(GHOST_KEY) || 'null'); return g && g.p && g.p.length > 8 ? g : null; } catch (e) { return null; } }
  function saveGhost(path) {
    if (!path || path.length < 8) return;
    try { localStorage.setItem(GHOST_KEY, JSON.stringify({ p: path.map((v) => Math.round(v * 10) / 10) })); } catch (e) { /* full */ }
  }
  const ghostPos = { x: 0, y: 0, z: 0, h: 0, p: 0 };
  function ghostAt(t) {
    if (!ghostRun) return null;
    const p = ghostRun.p, n = p.length / 4, f = t / GHOST_DT, i = Math.floor(f);
    if (i >= n - 1) return null;
    const a = f - i, o = i * 4, q = o + 4;
    ghostPos.x = lerp(p[o], p[q], a); ghostPos.y = lerp(p[o + 1], p[q + 1], a); ghostPos.z = lerp(p[o + 2], p[q + 2], a); ghostPos.h = lerp(p[o + 3], p[q + 3], a);
    ghostPos.p = Math.atan2(p[q + 1] - p[o + 1], Math.hypot(p[q] - p[o], p[q + 2] - p[o + 2]) || 1e-6);
    return ghostPos;
  }
  const BALLOON_C = ['#ff5a5a', '#ffcf3a', '#5fd35a', '#3f8ff5', '#c56bff', '#ff8ad8'];

  function updateParticles(dt) {
    for (let i = 0; i < PMAX; i++) {
      const p = parts[i];
      if (!p.on) continue;
      p.life -= dt; if (p.life <= 0) { p.on = false; continue; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0) { p.y = 0; p.vy *= -0.3; }
    }
    for (const t of texts) { if (t.on) { t.life -= dt; t.y -= 40 * dt; if (t.life <= 0) t.on = false; } }
    if (bannerT > 0) bannerT -= dt;
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
    bar(fx, fy, 88, 16, P.st.fuel > 0 ? P.fuel / P.st.fuel : 0, run.fuelFlash > 0 ? '#ff7070' : '#ffcf3a', P.fuel > 0 ? 'ENGINE' : P.st.fuel > 0 ? 'GLIDING' : 'NO ENGINE');
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
    if (run.rush > 0) {
      const bw = Math.min(200, W * 0.5);
      txt('GOLD RUSH', W / 2, H * 0.27 + 44, 18, '#ffd23a');
      ctx.fillStyle = 'rgba(20,28,64,0.6)'; ctx.fillRect(W / 2 - bw / 2, H * 0.27 + 50, bw, 8);
      ctx.fillStyle = '#ffd23a'; ctx.fillRect(W / 2 - bw / 2 + 1, H * 0.27 + 51, (bw - 2) * Math.max(0, run.rush / 6), 6);
    }
    const gp = state === 'fly' ? ghostAt(run.t) : null;
    if (gp) {
      const sp = W3.project(gp.x, gp.y + planeLen() * 0.6, gp.z);
      if (sp.ok && sp.x > 20 && sp.x < W - 20 && sp.y > 130 + safeTop() && sp.y < H - 20) txt('BEST', sp.x, sp.y, 12, '#bfe6ff');
    }
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
      txt('BOOST', b.x, b.y + (KEYS ? 0 : 5), 14, '#fff');
      if (KEYS) txt('SPACE', b.x, b.y + 16, 10, '#ffe27a');
      if (S.tut < 3 && f > 0 && P.fuel <= 0 && run.t < 30) txt(KEYS ? 'HOLD SPACE!' : 'HOLD!', b.x, b.y - b.r - 10, 14, '#ffe27a');
    }
    // stick indicator
    if (stick.on) {
      const R = 70 * S.set.sens;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(stick.ax, stick.ay, R, 0, 6.283); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath(); ctx.arc(stick.x, stick.y, 22, 0, 6.283); ctx.fill();
    }
    // tutorial
    if (S.tut < 2 && run.t > 0.6 && run.t < 7) {
      if (KEYS) {
        txt(S.set.invert ? 'DOWN ARROW to climb, UP to dive' : 'UP ARROW to climb, DOWN to dive', W / 2, H * 0.74, 19, '#fff');
        txt('LEFT / RIGHT to turn  ·  hold SPACE to boost', W / 2, H * 0.74 + 24, 14, '#fff');
      } else {
        txt(S.set.control === 'hold' ? 'HOLD to climb, slide LEFT / RIGHT to turn' : (S.set.invert ? 'PULL DOWN to climb, PUSH UP to dive' : 'DRAG UP to climb, DOWN to dive'), W / 2, H * 0.74, 19, '#fff');
        txt('Slide left / right to bank and turn', W / 2, H * 0.74 + 24, 14, '#fff');
      }
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
    // trajectory preview with the real physics, projected from 3D
    if (aim.power > 0.05) {
      const ap = aimPos();
      const Q = { x: ap.x, y: ap.y, z: ap.z, v: P.st.vbg * C.slingPower(S.lv.sling) * aim.power, p: LAUNCH_PITCH, gam: LAUNCH_PITCH, a: 0, h: aim.yaw, fuel: P.st.fuel, rocket: 0, rocketOn: false, ground: false, water: false, st: P.st, rk: P.rk };
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 30; i++) {
        for (let k = 0; k < 4; k++) C.stepPlane(Q, 0, 1 / 60, 0, 0);
        const sp = W3.project(Q.x, Q.y, Q.z);
        if (!sp.ok) continue;
        ctx.globalAlpha = 1 - i / 34;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, Math.max(2, 6 - i * 0.15), 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
      txt(Math.round(aim.power * 100) + '%', W / 2, H * 0.2, 34, aim.power > 0.97 ? '#ffd23a' : '#fff');
      if (Math.abs(aim.yaw) > 0.03) txt((aim.yaw > 0 ? 'RIGHT ' : 'LEFT ') + Math.round(Math.abs(aim.yaw) * 57.3) + '°', W / 2, H * 0.2 + 26, 16, '#fff');
    } else {
      txt('PULL DOWN & RELEASE', W / 2, H * 0.22, Math.min(30, W / 13), '#fff');
      txt('slide left / right to aim', W / 2, H * 0.22 + 26, 14, '#fff');
    }
  }

  function render(t, dt) {
    let px = P.x, py = P.y, pz = P.z, pitch = P.p, heading = P.h, bank = P.bank;
    if (state === 'fly') {
      const a = simAcc / HSTEP;
      px = lerp(prev.x, P.x, a); py = lerp(prev.y, P.y, a); pz = lerp(prev.z, P.z, a); pitch = lerp(prev.p, P.p, a); heading = lerp(prev.h, P.h, a);
    }
    if (state === 'aim' || state === 'hangar') {
      const ap = aimPos();
      px = ap.x; py = ap.y + (state === 'hangar' ? Math.sin(t * 2) * 0.02 * planeLen() : 0); pz = ap.z;
      pitch = state === 'aim' ? LAUNCH_PITCH * aim.power : 0.05; heading = state === 'aim' ? aim.yaw : 0; bank = 0;
    }
    W3.frame({
      mode: state === 'result' ? 'ending' : state, t, dt, P, sig, len: planeLen(), px, py, pz, pitch, heading, bank,
      engineOn: state === 'fly' && P.fuel > 0, rocketOn: state === 'fly' && P.rocketOn,
      showPlane: true, camPitch: state === 'fly' ? lerp(prev.gam, P.gam, simAcc / HSTEP) : 0,
      ents, parts, trail, trailN, trailHead, trailStyle: trailStyle(), best: S.best, shake,
      aimYaw: state === 'aim' ? aim.yaw : 0, camX: W3.cameraX(), snap: snapCam,
      fovKick, ghost: state === 'fly' && run ? ghostAt(run.t) : null,
    });
    snapCam = false;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (state === 'fly' || state === 'ending' || state === 'paused') { drawSpeedLines(); drawHUD(); }
    if (state === 'aim') drawAimUI();
    drawTexts();
  }
  const TRAIL_STYLE = TRAILS.map((T) => {
    if (T.rainbow) return { rainbow: true, a: 0.9 };
    const m = T.color.match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/);
    return { rgb: '#' + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join(''), a: +m[4] };
  });
  const GOLD_TRAIL = { rgb: '#ffd23a', a: 1 };
  function trailStyle() { return run && run.rush > 0 ? GOLD_TRAIL : TRAIL_STYLE[S.trail] || TRAIL_STYLE[0]; }

  // ===================================================================== main loop
  let last = performance.now();
  function frame(ts) {
    requestAnimationFrame(frame);
    let dt = (ts - last) / 1000; last = ts;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) return;
    gameT += dt;
    let gdt = dt;
    if (state === 'fly') {
      if (slowHold > 0) slowHold -= dt; else timeScale += (1 - timeScale) * Math.min(1, dt * 4);
      gdt = dt * timeScale;
      updateFly(gdt);
      if (run.fuelFlash > 0) run.fuelFlash -= dt;
      if (run.skimShow > 0) run.skimShow -= dt;
      ensureWorld(P.x + 420 * sig);
      if ((gameT * 60 | 0) % 30 === 0) pruneWorld(Math.min(W3.cameraX(), P.x) - 40 * sig);
      // birds bob
      for (let i = 0; i < ents.length; i++) { const e = ents[i]; if (e.k === 'bird' && !e.dead) { e.y = e.y0 + Math.sin(gameT * 2 + e.ph) * 2 * sig; e.x -= 3 * sig * gdt; } }
    } else if (state === 'ending') {
      run.endT += dt;
      updateWreck(dt);
    }
    fovKick = Math.max(0, fovKick - dt * 12);
    if (state !== 'paused') {
      updateParticles(gdt);
      if (shake > 0) shake = Math.max(0, shake - dt * 2.5);
    }
    render(gameT, state === 'paused' ? 0 : gdt);
  }

  // ===================================================================== UI
  const modal = $('modal'), panel = $('panel');
  function openPanel(html, onBind, closable) {
    // split into a fixed header (title + tabs), a scrolling body, and a fixed footer (close button)
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    const head = document.createElement('div'), body = document.createElement('div'), foot = document.createElement('div');
    head.className = 'p-head'; body.className = 'p-body'; foot.className = 'p-foot';
    const kids = Array.from(tmp.children);
    let i = 0;
    while (i < kids.length && (kids[i].tagName === 'H2' || kids[i].classList.contains('tabs')) && i < 2) head.appendChild(kids[i++]);
    let end = kids.length;
    if (end > i && kids[end - 1].matches('.btn[data-close]')) end--;
    for (let j = i; j < end; j++) body.appendChild(kids[j]);
    for (let j = end; j < kids.length; j++) foot.appendChild(kids[j]);
    panel.innerHTML = '';
    panel.append(head, body, foot);
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
      c.save(); c.translate(82, 52); c.rotate(-0.15); c.scale(120, 120); planePath(c, M, P0.body || M.body, P0.wing || M.wing, 0.7, false, false, C.planeParts(S.lv.plane)); c.restore();
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
      if (left === 1) return 'EVOLVES NEXT!';
      const nx = C.nextPartName(S.lv.plane);
      return nx ? '+ ' + nx : 'Evolve in ' + left;
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
    const partName = k === 'plane' ? C.nextPartName(S.lv.plane) : null;
    S.lv[k]++;
    Sfx.buy(); buzz(8);
    trackMission('upgrade', 1);
    const el = document.querySelector('.c-' + k); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    if (k === 'plane') {
      resetPlane(); rebuildPlane();
      burstAt(P.x, P.y, P.z, 18, 6 * sig, 0.6, 0.5 * sig, '#ffd23a', -3 * sig);
      if (C.modelIndex(S.lv.plane) !== prevModel) { save(); refreshUI(); showEvolve(prevModel); return false; }
      if (partName) { toast('NEW PART: ' + partName + (partName === 'Propeller engine' ? ' - you have an engine now!' : '')); Sfx.evolve(); }
    }
    if (k === 'sling') burstAt(0, P.y, 0, 12, 5 * sig, 0.5, 0.45 * sig, '#7be276', -2 * sig);
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
    near: { txt: (n) => 'Get ' + n + ' near misses' },
    swoop: { txt: (n) => 'Pull off ' + n + ' swoops (dive, then level out)' },
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
        case 'near': target = 5 + Math.floor(r() * 4) * 5; break;
        case 'swoop': target = 5 + Math.floor(r() * 3) * 5; break;
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
        S.paint = i; save(); rebuildPlane(); refreshUI(); showShop();
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
    h += '<div class="big-num">' + fmtDist(r.dist) + '</div><div class="sub">Best ' + fmtDist(S.best) + ' · max alt ' + Math.floor(r.maxAlt) + ' m · combo x' + r.maxCombo + (r.nears ? ' · ' + r.nears + ' near misses' : '') + '</div>';
    const nb = C.biomeIndex(S.best) + 1;
    if (nb < BIOMES.length) {
      const f = Math.min(1, S.best / BIOMES[nb].start);
      h += '<p class="center" style="margin:8px 0 2px;font-weight:800">Next zone: ' + BIOMES[nb].name + ' at ' + fmtDist(BIOMES[nb].start) + '</p><div class="bar"><i style="width:' + Math.round(f * 100) + '%"></i></div>';
    }
    const after = S.coins + r.total, cheapest = Math.min(C.COST.sling(S.lv.sling), C.COST.plane(S.lv.plane), C.COST.income(S.lv.income));
    if (after >= cheapest) h += '<div class="center"><span class="tag">UPGRADE READY!</span></div>';
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
  let updateReady = false;
  function toHangar() {
    if (updateReady) { writeNow(); location.reload(); return; }
    state = 'hangar';
    closePanel();
    ents.length = 0; trailN = 0;
    resetPlane(); rebuildPlane();
    $('hangar').classList.remove('hidden');
    snapCam = true;
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
    let h = '<h2>SETTINGS</h2><div class="center" style="margin:-6px 0 8px"><span class="tag blue">VERSION ' + VERSION + '</span></div>';
    h += '<div class="set-row">Sound' + T('sound') + '</div>';
    h += '<div class="set-row">Vibration' + T('haptics') + '</div>';
    h += '<div class="set-row">Controls<div class="seg"><button data-c="drag" class="' + (S.set.control === 'drag' ? 'on' : '') + '">Drag stick</button><button data-c="hold" class="' + (S.set.control === 'hold' ? 'on' : '') + '">Hold to climb</button></div></div>';
    h += '<div class="set-row"><span>Pull down to climb<br><small style="font-weight:600;opacity:.7">Like a real flight stick. Off = push up to climb</small></span>' + T('invert') + '</div>';
    h += '<div class="set-row">Up/down sensitivity<span style="display:flex;align-items:center;gap:6px"><input type="range" min="0.4" max="1.5" step="0.1" value="' + S.set.pitch + '" id="pitchs"><b id="pitchv" style="width:34px">' + S.set.pitch.toFixed(1) + 'x</b></span></div>';
    h += '<div class="set-row">Stick size<input type="range" min="0.6" max="1.6" step="0.1" value="' + S.set.sens + '" id="sens"></div>';
    h += '<div class="set-row"><span>Performance mode<br><small style="font-weight:600;opacity:.7">Lower resolution, fewer particles</small></span>' + T('perf') + '</div>';
    h += '<h3>Cloud save</h3>';
    if (!Cloud.ok()) h += '<p>Cross-device sync isn\'t switched on for this copy of the game yet.</p>';
    else if (S.sync.code) {
      h += '<p>This device is synced. Enter this code on your other devices to play with the same progress:</p><div class="big-num" style="letter-spacing:6px">' + S.sync.code + '</div>';
      h += '<p class="sub">' + (Cloud.status() === 'offline' ? 'Offline - will sync when you\'re back online' : S.sync.last ? 'Last synced ' + new Date(S.sync.last).toLocaleTimeString() : 'Syncing...') + '</p>';
      h += '<button class="btn gray" id="unlink">STOP SYNCING THIS DEVICE</button>';
    } else {
      h += '<p>Get a sync code to play with the same progress on your phone and laptop.</p>';
      h += '<div class="row"><button class="btn" id="mkcode">GET MY CODE</button><button class="btn blue" id="entercode">I HAVE A CODE</button></div>';
    }
    h += '<div id="syncbox"></div>';
    h += '<h3>Progress</h3><p>Your progress also saves on this device after every flight and purchase. A backup code is a manual copy you can keep anywhere.</p>';
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
      p.querySelector('#pitchs').addEventListener('input', (e) => { S.set.pitch = +e.target.value; p.querySelector('#pitchv').textContent = S.set.pitch.toFixed(1) + 'x'; save(); });
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
            S = merge(defaults(), data); writeNow(); resetPlane(); rebuildPlane(); resize(); closePanel(); toast('Progress restored!');
          } catch (e) { toast('That code did not work'); }
        });
      });
      const mk = p.querySelector('#mkcode');
      if (mk) mk.addEventListener('click', async () => {
        mk.disabled = true; mk.textContent = 'CREATING...';
        try { await Cloud.create(); Sfx.evolve(); showSettings(); } catch (e) { mk.disabled = false; mk.textContent = 'GET MY CODE'; toast('Could not reach the cloud - check your connection'); }
      });
      const ec = p.querySelector('#entercode');
      if (ec) ec.addEventListener('click', () => showCodeEntry(() => showSettings()));
      const ul = p.querySelector('#unlink');
      if (ul) ul.addEventListener('click', () => { S.sync.code = ''; writeNow(); showSettings(); });
      let armed = false;
      p.querySelector('#reset').addEventListener('click', (e) => {
        if (!armed) { armed = true; e.target.textContent = 'TAP AGAIN TO ERASE EVERYTHING'; return; }
        const keepSet = S.set; S = defaults(); S.set = keepSet; writeNow(); resetPlane(); rebuildPlane(); closePanel(); toast('Progress reset');
      });
    });
  }
  $('btn-settings').addEventListener('click', () => { Sfx.init(); showSettings(); });

  function showCodeEntry(back) {
    openPanel('<h2>ENTER YOUR CODE</h2><p class="center">Type the 6-character code shown in Settings on your other device.</p>' +
      '<input id="codein" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" style="width:100%;font:900 34px system-ui;text-align:center;letter-spacing:8px;padding:10px;border-radius:12px;border:3px solid #1b2240;text-transform:uppercase;user-select:text;-webkit-user-select:text">' +
      '<p class="sub" id="codeerr"></p><button class="btn" id="codego">LOAD MY PROGRESS</button><button class="btn gray" id="codeback">BACK</button>', (p) => {
      const inp = p.querySelector('#codein'); setTimeout(() => inp.focus(), 50);
      inp.addEventListener('input', () => { inp.value = Cloud.clean(inp.value); });
      p.querySelector('#codeback').addEventListener('click', () => (back ? back() : closePanel()));
      p.querySelector('#codego').addEventListener('click', async (e) => {
        const b = e.target; b.disabled = true; b.textContent = 'LOADING...';
        try {
          await Cloud.link(inp.value);
          Sfx.evolve(); closePanel(); toast('Progress loaded!');
        } catch (err) {
          b.disabled = false; b.textContent = 'LOAD MY PROGRESS';
          p.querySelector('#codeerr').textContent = /^(No save|Codes)/.test(err.message) ? err.message : 'Could not reach the cloud - check your connection';
          Sfx.deny();
        }
      });
    });
  }
  // daily login streak: come back each day for a bigger reward (7-day cycle)
  function maybeStreak() {
    if (!modal.classList.contains('hidden') || state !== 'hangar') return;
    const today = dayKey();
    if (S.streak.day === today) return;
    const y = new Date(Date.now() - 86400000), yKey = y.getFullYear() + '-' + (y.getMonth() + 1) + '-' + y.getDate();
    const n = S.streak.day === yKey ? (S.streak.n % 7) + 1 : 1;
    const base = missionCoins();
    const reward = (d) => ({ coins: Math.round(base * (0.6 + d * 0.4)), gems: d === 7 ? 5 : d === 5 ? 2 : d === 3 ? 1 : 0 });
    let row = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin:10px 0">';
    for (let d = 1; d <= 7; d++) {
      const rw = reward(d), on = d === n, done = d < n;
      row += '<div style="border-radius:10px;padding:6px 2px;text-align:center;font-size:11px;font-weight:900;background:' + (on ? '#ffcf3a' : done ? '#7be276' : '#e1dccf') + ';border:2px solid ' + (on ? '#1b2240' : 'transparent') + '">DAY ' + d + '<div style="font-size:18px;margin:2px 0">' + (rw.gems ? '<i class="ico-gem"></i>' : '<i class="ico-coin"></i>') + '</div>' + (rw.gems ? rw.gems : fmt(rw.coins)) + '</div>';
    }
    row += '</div>';
    const rw = reward(n);
    openPanel('<h2>DAILY BONUS</h2><p class="center">Day ' + n + ' streak! Come back tomorrow for more.</p>' + row +
      '<div class="big-num"><i class="ico-coin"></i> ' + fmt(rw.coins) + (rw.gems ? ' <span style="font-size:30px">+ <i class="ico-gem"></i> ' + rw.gems + '</span>' : '') + '</div>' +
      '<button class="btn" id="claimday">CLAIM</button>', (p) => {
      p.querySelector('#claimday').addEventListener('click', () => {
        S.streak.day = today; S.streak.n = n; S.coins += rw.coins; S.gems += rw.gems;
        Sfx.evolve(); buzz(20); save(); closePanel(); bumpPill('.pill.coin');
      });
    }, false);
  }
  // first launch on a new device: offer to load an existing save
  function maybeWelcome() {
    if (!Cloud.ok() || S.sync.code || S.sync.asked || S.flights > 0) return;
    S.sync.asked = true; save();
    openPanel('<h2>WELCOME, PILOT!</h2><p class="center">Already playing on another device? Enter your sync code to bring your progress here.</p>' +
      '<button class="btn" id="wnew">NEW GAME</button><button class="btn blue" id="whave">I HAVE A CODE</button>', (p) => {
      p.querySelector('#wnew').addEventListener('click', () => { closePanel(); maybeStreak(); });
      p.querySelector('#whave').addEventListener('click', () => showCodeEntry(maybeWelcomeBack));
    });
  }
  function maybeWelcomeBack() { S.sync.asked = false; maybeWelcome(); }

  // ===================================================================== boot
  window.addEventListener('resize', () => { resize(); if (state === 'hangar') snapCam = true; });
  resize();
  resetPlane();
  rebuildPlane();
  W3.resetScenery(0, 0, sig);
  refreshUI();
  maybeWelcome();
  maybeStreak();
  Cloud.pull();
  requestAnimationFrame((ts) => { last = ts; frame(ts); });
  // Updates: check for a new version on open and whenever the game comes back to the foreground;
  // when one takes over, reload straight away if we're sitting in the hangar (otherwise after the flight).
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return; // first install, page is already current
      updateReady = true;
      if (state === 'hangar' && modal.classList.contains('hidden')) { writeNow(); location.reload(); }
    });
  }
})();
