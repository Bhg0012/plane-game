// Sky Fling - core data, progression math and flight physics.
// Shared by the browser game and the node balance simulation (sim.js).
'use strict';
(function (root) {
  const G = 9.8;
  
  // ---- Plane evolutions: every 5 plane levels the plane evolves into the next model.
  const MODELS = [
    { name: 'Cardboard Plane', body: '#c89a63', wing: '#a97c4a', prop: true, len: 3.0, bi: false },
    { name: 'Balsa Glider', body: '#e8d2a6', wing: '#cdb07a', prop: true, len: 3.2, bi: false, longWing: true },
    { name: 'Tin Flyer', body: '#b8c2cc', wing: '#8f9aa6', prop: true, len: 3.3, bi: false },
    { name: 'Wooden Biplane', body: '#b5653a', wing: '#e3b04b', prop: true, len: 3.5, bi: true },
    { name: 'Crop Duster', body: '#f2c230', wing: '#d99a1e', prop: true, len: 3.7, bi: true },
    { name: 'Stunt Racer', body: '#e94b3c', wing: '#ffffff', prop: true, len: 3.8, bi: false },
    { name: 'Warbird', body: '#6b7d4f', wing: '#56663f', prop: true, len: 4.1, bi: false },
    { name: 'Seaplane', body: '#ffffff', wing: '#2f7bd9', prop: true, len: 4.3, bi: false, floats: true },
    { name: 'Turboprop', body: '#f4f4f4', wing: '#c33', prop: true, len: 4.6, bi: false },
    { name: 'Business Jet', body: '#fafafa', wing: '#1d3557', prop: false, len: 5.0, bi: false },
    { name: 'Fighter Jet', body: '#8d99ae', wing: '#5c677d', prop: false, len: 5.2, bi: false, delta: true },
    { name: 'Stealth Wing', body: '#2b2d42', wing: '#1a1b29', prop: false, len: 5.2, bi: false, delta: true },
    { name: 'Rocket Plane', body: '#ff7b00', wing: '#2b2d42', prop: false, len: 5.6, bi: false, delta: true },
    { name: 'Space Shuttle', body: '#ffffff', wing: '#222', prop: false, len: 6.2, bi: false, delta: true },
  ];

  // ---- Biomes by distance. Ground is flat (y = 0); obstacles give height.
  const BIOMES = [
    { name: 'Meadow', start: 0, sky: ['#5fb4f5', '#cfeeff'], ground: '#5fa83a', edge: '#7cc94f', far: '#9cc6a5', near: '#6fae5a', obst: 'tree', density: 0.5, hMin: 5, hMax: 11, air: 'bird', airC: '#333', rate: 0.5 },
    { name: 'Farmland', start: 300, sky: ['#58aef0', '#e6f4d8'], ground: '#9b7a3e', edge: '#c9a54f', far: '#b3c48a', near: '#8fae4f', obst: 'silo', density: 0.6, hMin: 7, hMax: 16, air: 'bird', airC: '#222', rate: 0.7 },
    { name: 'Desert', start: 800, sky: ['#f5a65b', '#ffe8b3'], ground: '#e2b56b', edge: '#f2cf8a', far: '#e9b27a', near: '#d89a55', obst: 'cactus', density: 0.7, hMin: 6, hMax: 14, air: 'vulture', airC: '#4a2f1d', rate: 1.0 },
    { name: 'Canyon', start: 1600, sky: ['#e8734a', '#ffc58f'], ground: '#a4502e', edge: '#c96b3f', far: '#c97b55', near: '#9e4f30', obst: 'pillar', density: 0.8, hMin: 18, hMax: 45, air: 'vulture', airC: '#3a1f12', rate: 1.4 },
    { name: 'Snow Peaks', start: 3000, sky: ['#7fb6e6', '#f2f8ff'], ground: '#eef4fb', edge: '#ffffff', far: '#c8d8ea', near: '#a9c0d8', obst: 'pine', density: 0.9, hMin: 10, hMax: 28, air: 'bird', airC: '#334', rate: 1.9 },
    { name: 'Metro City', start: 5000, sky: ['#6a8fc7', '#d7e3f5'], ground: '#5d6470', edge: '#7c8492', far: '#8b97ad', near: '#6c7a92', obst: 'tower', density: 1.0, hMin: 25, hMax: 80, air: 'drone', airC: '#d33', rate: 2.6 },
    { name: 'Ocean', start: 8000, sky: ['#3f8fd8', '#bfe6ff'], ground: '#1f74c4', edge: '#5fb3f0', far: '#4b8fc9', near: '#2a6fb0', obst: 'buoy', density: 0.35, hMin: 4, hMax: 8, air: 'gull', airC: '#eee', rate: 3.4, water: true },
    { name: 'Volcano Isle', start: 12000, sky: ['#5a2a3a', '#f0805a'], ground: '#3b2a2a', edge: '#ff6a2a', far: '#6b3a3a', near: '#4a2626', obst: 'spire', density: 1.0, hMin: 20, hMax: 70, air: 'ember', airC: '#ff9a3a', rate: 4.5 },
    { name: 'Stormfront', start: 18000, sky: ['#3d4a5c', '#9aa8b8'], ground: '#3e4e3a', edge: '#5a6e52', far: '#5a6676', near: '#46525f', obst: 'tower', density: 0.9, hMin: 30, hMax: 100, air: 'drone', airC: '#ffe14d', rate: 6.0 },
    { name: 'Stratosphere', start: 26000, sky: ['#0b1236', '#3a5fa8'], ground: '#2a3550', edge: '#6b86c9', far: '#26315a', near: '#1c2546', obst: 'spire', density: 0.7, hMin: 30, hMax: 120, air: 'meteor', airC: '#b0a090', rate: 8.0 },
    { name: 'Orbit', start: 38000, sky: ['#000008', '#0d1640'], ground: '#4a4a55', edge: '#8a8a99', far: '#1a1a2a', near: '#2a2a3a', obst: 'spire', density: 0.6, hMin: 40, hMax: 140, air: 'meteor', airC: '#c8b8a8', rate: 11.0 },
  ];

  function biomeIndex(x) {
    let i = 0;
    while (i + 1 < BIOMES.length && x >= BIOMES[i + 1].start) i++;
    return i;
  }

  // ---- Progression
  function modelIndex(planeLvl) { return Math.min(Math.floor((planeLvl - 1) / 5), MODELS.length - 1); }

  // Everything is expressed relative to the plane's "scale" (its best-glide speed), and
  // gravity scales with it too. A bigger plane is the same snappy flight, just bigger and
  // faster, so flights stay 15-60s long at every stage instead of dragging on.
  function planeStats(planeLvl) {
    const L = planeLvl - 1;
    const m = modelIndex(planeLvl);
    const vbg = 11 * Math.pow(1.035, L) * Math.pow(1.05, m);
    const sig = vbg / 11;
    const g = G * sig;
    const glide = 4.5 + 0.02 * L + 0.12 * m;
    const ratio = 2.2 + 0.1 * m + 0.01 * L;
    const drag = g / (2 * glide * vbg * vbg);
    return {
      sig, g, vbg, glide, drag,
      ind: drag * vbg * vbg * vbg * vbg,
      thrust: drag * vbg * vbg * ratio * ratio,
      fuel: planeParts(planeLvl).engine ? 2.5 + 0.06 * L + 0.25 * m + (planeParts(planeLvl).tanks ? 0.6 : 0) : 0,
      ceil: sig * (50 + 0.3 * L),
      scale: 1 + m * 0.08,
      model: m,
    };
  }

  // Parts bolted onto the plane as it levels. The Cardboard Plane starts as a bare
  // body + wings and only gets its propeller (engine and fuel) at level 4.
  const PART_NAMES = { tail: 'Tail fin', cockpit: 'Cockpit & wheels', prop: 'Propeller engine', tanks: 'Fuel tanks', stripe: 'Racing stripe', winglets: 'Winglets', wheels: 'Landing gear' };
  function planeParts(planeLvl) {
    const m = modelIndex(planeLvl), sub = Math.min(4, planeLvl - 1 - m * 5);
    if (m === 0) return { tail: sub >= 1, cockpit: sub >= 2, wheels: sub >= 2, engine: sub >= 3, tanks: sub >= 4, stripe: false, winglets: false };
    return { tail: true, cockpit: true, engine: true, wheels: sub >= 1, stripe: sub >= 2, tanks: sub >= 3, winglets: sub >= 4 };
  }
  function nextPartName(planeLvl) {
    if (modelIndex(planeLvl + 1) !== modelIndex(planeLvl)) return null;
    const a = planeParts(planeLvl), b = planeParts(planeLvl + 1);
    if (b.engine && !a.engine) return PART_NAMES.prop;
    if (b.cockpit && !a.cockpit) return PART_NAMES.cockpit;
    for (const k of ['tail', 'wheels', 'stripe', 'tanks', 'winglets']) if (b[k] && !a[k]) return PART_NAMES[k];
    return null;
  }

  // Launch speed in multiples of the plane's glide speed.
  function slingPower(slingLvl) { return 1.7 + 0.075 * (slingLvl - 1); }
  function incomeMult(lvl) { return Math.round((1 + 0.2 * (lvl - 1)) * 10) / 10; }
  function rocketStats(lvl) { return { thrust: 2.2 + 0.12 * lvl, time: 1.2 + 0.3 * lvl }; } // thrust in g

  const COST = {
    sling: (l) => Math.round(30 * Math.pow(1.2, l - 1) + 12 * (l - 1)),
    plane: (l) => Math.round(45 * Math.pow(1.22, l - 1) + 15 * (l - 1)),
    income: (l) => Math.round(60 * Math.pow(1.24, l - 1) + 20 * (l - 1)),
    rocket: (l) => Math.round(500 * Math.pow(1.35, l - 1)),
  };

  // ---- Flight physics. Energy-style arcade model: the plane flies where it points,
  // gravity trades speed for height, drag bleeds speed, thrust adds it.
  // x = downrange, y = up, z = right. p = pitch, h = heading (0 = straight downrange).
  // P: { x, y, z, v, p, h, fuel, rocket, rocketOn, ground, water, st, rk }
  // u = pitch input, ux = turn input, both -1..1.
  function stepPlane(P, u, dt, lift, ux) {
    const st = P.st;
    const stall = st.vbg * 0.6;
    const ctrl = Math.min(1, P.v / stall);
    // control inputs drive pitch/turn *rates* that ease in and out, so the plane never snaps
    const k = Math.min(1, dt * 7);
    const pTarget = u !== 0 ? u * 2.0 * ctrl : (-0.07 - P.p) * 0.6;
    P.pr = (P.pr || 0) + (pTarget - (P.pr || 0)) * k;
    P.p += P.pr * dt;
    if (P.v < stall) P.p -= (1 - P.v / stall) * (1 - P.v / stall) * 3 * dt; // stall: nose drops, gently at first
    const over = P.y - st.ceil;
    if (over > 0) P.p -= Math.min(1.5, over / (25 * st.sig)) * dt; // thin air above the ceiling
    if (P.p > 1.35) P.p = 1.35; else if (P.p < -1.35) P.p = -1.35;
    let h = P.h || 0;
    P.hr = (P.hr || 0) + ((ux || 0) * 1.2 * ctrl - (P.hr || 0)) * Math.min(1, dt * 4);
    if (P.hr > 1e-4 || P.hr < -1e-4) { h += P.hr * dt; if (h > 1.2) h = 1.2; else if (h < -1.2) h = -1.2; P.h = h; }

    const v2 = Math.max(P.v * P.v, 1);
    let a = -st.g * Math.sin(P.p) - st.drag * v2 - (P.ground ? 0 : st.ind / v2);
    const air = over > 0 ? Math.max(0, 1 - over / (40 * st.sig)) : 1;
    if (P.fuel > 0) { a += st.thrust * air; P.fuel -= dt; }
    if (P.rocketOn && P.rocket > 0) { a += P.rk.thrust * st.g * (0.5 + 0.5 * air); P.rocket -= dt; }
    P.v += a * dt;
    if (P.v < 0.3) P.v = 0.3;

    const hv = P.v * Math.cos(P.p);
    P.x += hv * Math.cos(h) * dt;
    if (h) P.z = (P.z || 0) + hv * Math.sin(h) * dt;
    P.y += (P.v * Math.sin(P.p) + (lift || 0) * st.sig) * dt;
    if (P.v < stall && !P.ground) P.y -= (stall - P.v) * 0.6 * dt;

    P.ground = false;
    if (P.y <= 0) {
      P.y = 0;
      P.ground = true;
      if (P.p < 0) {
        const imp = -P.p;
        if (imp > 0.3 && P.v > st.vbg) { // bounce
          P.p = imp * 0.55;
          P.v *= 0.78 - imp * 0.12;
          return 'bounce';
        }
        P.p = 0;
      }
    }
    if (P.ground) P.v -= (P.water ? 1.6 : 0.4) * st.g * dt + P.v * 0.15 * dt;
    return null;
  }

  const api = { G, MODELS, BIOMES, biomeIndex, modelIndex, planeStats, planeParts, nextPartName, slingPower, incomeMult, rocketStats, COST, stepPlane };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
