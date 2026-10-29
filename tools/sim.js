// Balance simulation: a simple autopilot flies, then buys the cheapest upgrade repeatedly.
const C = require('../core.js');
function fly(lv) {
  const st = C.planeStats(lv.plane), rk = C.rocketStats(lv.rocket);
  const P = { x: 0, y: 3, v: C.slingPower(lv.sling) * st.vbg, p: 0.6, gam: 0.45, a: 0, fuel: st.fuel, rocket: lv.rocket ? rk.time : 0, rocketOn: false, st, rk };
  let t = 0, coins = 0, maxY = 0;
  const dt = 1 / 120;
  while (t < 600) {
    let target = P.fuel > 0 ? 0.3 : -0.1 + Math.max(-0.3, Math.min(0.2, (P.v - st.vbg) / st.vbg * 0.3));
    
    P.rocketOn = P.fuel <= 0 && P.rocket > 0;
    const u = Math.max(-1, Math.min(1, (target - P.gam) * 2));
    const ox = P.x;
    if (C.stepPlane(P, u, dt, 0) === 'smash') break;
    coins += (P.x - ox) * C.BIOMES[C.biomeIndex(P.x)].rate;
    maxY = Math.max(maxY, P.y);
    t += dt;
    if (P.ground && P.v < 0.15 * st.vbg) break;
  }
  return { d: P.x, t, maxY, coins: coins * 1.3 * C.incomeMult(lv.income) };
}
const lv = { sling: 1, plane: 1, income: 1, rocket: 0 };
let coins = 0, totalT = 0;
for (let f = 1; f <= 400; f++) {
  const r = fly(lv); coins += r.coins; totalT += r.t + 12;
  if (f <= 10 || f % 20 === 0) console.log(`#${f} t=${(totalT/60).toFixed(0)}min S${lv.sling} P${lv.plane}(${C.MODELS[C.modelIndex(lv.plane)].name}) I${lv.income} R${lv.rocket} d=${r.d.toFixed(0)} alt=${r.maxY.toFixed(0)} flight=${r.t.toFixed(1)}s vbg=${C.planeStats(lv.plane).vbg.toFixed(0)} T=${C.planeStats(lv.plane).thrust.toFixed(1)}  +${r.coins.toFixed(0)}`);
  for (;;) {
    const opts = ['sling', 'plane', 'income'].map(k => [k, C.COST[k](lv[k])]);
    if (lv.plane >= 10) opts.push(['rocket', C.COST.rocket(lv.rocket + 1)]);
    opts.sort((a, b) => a[1] - b[1]);
    if (coins < opts[0][1]) break;
    coins -= opts[0][1]; lv[opts[0][0]]++;
  }
}
