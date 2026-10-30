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
    { name: 'Warbird', body: '#6b7d4f', wing: '#56663f', prop: true, len: 4.1, bi: false, mil: true },
    { name: 'Seaplane', body: '#ffffff', wing: '#2f7bd9', prop: true, len: 4.3, bi: false, floats: true },
    // tactical jets: original designs inspired by real aircraft types
    { name: 'Gunship', body: '#7d8a7a', wing: '#68756a', prop: false, len: 4.6, style: 'gunship', mil: true, tip: [0.0, 0.62] },
    { name: 'Twin-Tail Fighter', body: '#8d99ae', wing: '#6c7a92', prop: false, len: 5.0, style: 'fighter', delta: true, mil: true, tip: [-0.26, 0.48] },
    { name: 'Swing-Wing Striker', body: '#a3a99a', wing: '#7f8676', prop: false, len: 5.1, style: 'swing', delta: true, mil: true, tip: [-0.34, 0.5] },
    { name: 'Delta Interceptor', body: '#c9ced6', wing: '#8a93a0', prop: false, len: 5.2, style: 'deltaJet', delta: true, mil: true, tip: [-0.29, 0.45] },
    { name: 'Stealth Fighter', body: '#3a3f4a', wing: '#2c3039', prop: false, len: 5.2, style: 'stealth', delta: true, tip: [-0.32, 0.45] },
    { name: 'Stealth Bomber', body: '#2b2f38', wing: '#23262e', prop: false, len: 5.6, style: 'flyingwing', delta: true, tip: [-0.22, 0.8] },
    { name: 'Hypersonic Spyplane', body: '#17191e', wing: '#1c1f26', prop: false, len: 6.0, style: 'spy', delta: true, tip: [-0.43, 0.4] },
    { name: 'Space Shuttle', body: '#ffffff', wing: '#222', prop: false, len: 6.2, bi: false, delta: true, style: 'shuttle', tip: [-0.29, 0.45] },
    // far-future experimentals
    { name: 'Forward-Swept Raptor', body: '#3d4f6b', wing: '#2a3a52', prop: false, len: 6.3, style: 'fswept', delta: true, tip: [0.12, 0.5] },
    { name: 'Plasma Arrow', body: '#e8ecf4', wing: '#1b2240', prop: false, len: 6.4, style: 'plasma', delta: true, glow: '#38e0ff', tip: [-0.38, 0.42] },
    { name: 'Ring-Wing Skimmer', body: '#f2c230', wing: '#2b2d42', prop: false, len: 6.5, style: 'ringwing', delta: true, glow: '#ffd23a', tip: [-0.3, 0.44] },
    { name: 'Celestial Dragonfly', body: '#7b2cbf', wing: '#c8b6ff', prop: false, len: 6.8, style: 'dragonfly', delta: true, glow: '#c77dff', tip: [0.1, 0.62] },
  ];
  // Slingshot looks evolve every 5 levels.
  const SLING_TIERS = ['Twig Fork', 'Rope Sling', 'Iron Sling', 'Spiked Bastion', 'Steam Catapult', 'Royal Launcher', 'Crystal Sling', 'Arcane Cannon'];
  function slingTier(lvl) { return Math.min(SLING_TIERS.length - 1, Math.floor((lvl - 1) / 5)); }

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

  // ---- Flight physics: a point-mass aircraft with real momentum.
  // The plane has a velocity (speed v, climb angle gam, heading h) and a nose that sits at an
  // angle of attack (a) above the velocity. Lift grows with speed^2 and angle of attack, so a
  // slow plane can't hold itself up: it arcs over, falls with gravity, and its nose follows the
  // fall. Speed comes from thrust and diving; drag and climbing take it away.
  // x = downrange, y = up, z = right. p = nose pitch (for drawing), h = heading.
  // P: { x, y, z, v, gam, a, p, h, fuel, rocket, rocketOn, ground, water, st, rk }
  // u = pitch input, ux = turn input, both -1..1.
  const A0 = 0.05, ATRIM = 0.07, ASTALL = 0.32;
  function liftCoef(a) {
    let cl = (a + A0) / (ATRIM + A0);
    if (a > ASTALL) cl *= Math.max(0.3, 1 - (a - ASTALL) * 4); // stalled wing loses lift
    return cl;
  }
  function stepPlane(P, u, dt, lift, ux) {
    const st = P.st, g = st.g;
    let v = P.v > 0.3 ? P.v : 0.3;
    let gam = P.gam === undefined ? P.p : P.gam;
    const vn = v / st.vbg, vn2 = vn * vn;
    const over = P.y - st.ceil;
    const air = over > 0 ? Math.max(0.15, 1 - over / (40 * st.sig)) : 1; // thin air above the ceiling

    // Angle of attack: with no input the "autopilot" trims for a gentle glide; input adds or removes
    // lift. It eases toward its target so the nose never snaps.
    // lift that would ease the flight path toward a shallow glide (pulls out of dives gently)
    // (when slow it aims a bit steeper so the plane trades height for flying speed, like a real glider)
    const gTarget = -0.07 - 1.3 * Math.max(0, 0.95 - vn);
    const needL = g * Math.cos(gam) + v * 0.9 * (gTarget - gam);
    const need = (needL / (g * Math.max(vn2 * air, 0.04))) * (ATRIM + A0) - A0;
    let aT = Math.min(ASTALL * 0.9, Math.max(-0.12, need)) + u * 0.155; // pitch authority: gentle, full stick is a firm pull
    if (aT > 0.55) aT = 0.55; else if (aT < -0.35) aT = -0.35;
    const a = (P.a || 0) + (aT - (P.a || 0)) * Math.min(1, dt * 2.2); // eased, so pitch changes feel weighty
    P.a = a;

    let L = g * vn2 * liftCoef(a) * air * (P.liftMul || 1); // liftMul < 1 when a wing is missing
    if (L > 5 * g) L = 5 * g; else if (L < -2 * g) L = -2 * g;
    const D = st.drag * v * v + (st.ind / (v * v)) * (L / g) * (L / g);
    let T = 0;
    if (P.fuel > 0) { T += st.thrust * air; P.fuel -= dt; }
    if (P.rocketOn && P.rocket > 0) { T += P.rk.thrust * g * (0.5 + 0.5 * air); P.rocket -= dt; }

    v += (T * Math.cos(a) - D - g * Math.sin(gam)) * dt;
    let dg = (L + T * Math.sin(a) - g * Math.cos(gam)) / v;
    if (over > 0) dg -= Math.min(1.2, over / (30 * st.sig)); // thin air: can't hold altitude up there
    if (dg > 3) dg = 3; else if (dg < -3) dg = -3;
    if (P.ground && dg < 0) dg = 0;
    gam += dg * dt;
    if (gam > 1.5) gam = 1.5; else if (gam < -1.5) gam = -1.5;
    if (v < 0.3) v = 0.3;

    // turning: banked turn rate, weaker when slow
    const ctrl = Math.min(1, vn / 0.6);
    let h = P.h || 0;
    P.hr = (P.hr || 0) + ((ux || 0) * 0.9 * ctrl - (P.hr || 0)) * Math.min(1, dt * 2.6); // banked turns that roll in and out
    if (P.hr > 1e-4 || P.hr < -1e-4) { h += P.hr * dt; if (h > 1.2) h = 1.2; else if (h < -1.2) h = -1.2; P.h = h; }

    const hv = v * Math.cos(gam);
    P.x += hv * Math.cos(h) * dt;
    if (h) P.z = (P.z || 0) + hv * Math.sin(h) * dt;
    P.y += (v * Math.sin(gam) + (lift || 0) * st.sig) * dt;

    // Ground contact. P.gy is how high the plane's centre sits when its lowest part (wheels, belly,
    // wingtip, nose...) touches the ground; the game works it out from the plane's attitude.
    // On first touch we report the impact and let the game decide: landing, scrape, bounce or crash.
    let ev = null;
    const was = P.ground, gy = P.gy || 0;
    P.ground = false;
    if (P.y <= gy) {
      P.y = gy;
      P.ground = true;
      if (gam < 0) {
        if (!was) { P.impactVy = -v * Math.sin(gam); P.impactV = v; P.impactGam = gam; ev = 'touch'; }
        gam = 0;
      }
    }
    if (P.ground && gam <= 0) {
      const mu = P.water ? 1.6 : P.fric === undefined ? 0.45 : P.fric; // rolling on wheels is low, scraping is high
      v -= mu * g * dt + v * (mu < 0.3 ? 0.03 : 0.12) * dt;
      if (v < 0.3) v = 0.3;
    }
    P.v = v; P.gam = gam;
    P.p = gam + (P.ground ? 0 : a); // drawn nose
    return ev;
  }
  // Helpers so game code can nudge the plane without knowing the model.
  function kick(P, dv, dgam, minGam) {
    P.v = Math.max(0.3, P.v + (dv || 0));
    P.gam = (P.gam || 0) + (dgam || 0);
    if (minGam !== undefined && P.gam < minGam) P.gam = minGam;
    if (P.gam > 1.5) P.gam = 1.5; else if (P.gam < -1.5) P.gam = -1.5;
  }

  const api = { G, MODELS, BIOMES, SLING_TIERS, slingTier, biomeIndex, modelIndex, planeStats, planeParts, nextPartName, slingPower, incomeMult, rocketStats, COST, stepPlane, kick };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
