// Sky Fling - 3D renderer (Three.js). Owns the scene, camera and meshes; game.js owns all game state.
// Everything repeated (coins, trees, rings...) is drawn with InstancedMesh so the whole world is ~40 draw calls.
import * as THREE from './vendor/three.module.min.js';

const C = window.Core;
const { MODELS, BIOMES } = C;

let renderer, scene, camera, hemi, sun;
let sky, skyCols, ground, groundTex, shadow, sunDisc, sunGlow;
let planeGroup = null, prop = null, jetFlame = null, rocketFlame = null;
let site, bandA, bandB, bestStripe, bestPole, bestFlag;
let particles, pPos, pCol, pSize, pUniforms;
let trailMesh, trailPos, trailCol;
let W = 1, H = 1;

const mtx = new THREE.Matrix4(), quat = new THREE.Quaternion(), eul = new THREE.Euler(), vec = new THREE.Vector3(), scl = new THREE.Vector3(), col = new THREE.Color();
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), lookTmp = new THREE.Vector3();
let camHeading = 0, camReady = false, curFov = 62;
const colorCache = new Map();
function colorOf(s) { let c = colorCache.get(s); if (!c) { c = new THREE.Color(s); colorCache.set(s, c); } return c; }

const lam = (c, extra) => new THREE.MeshLambertMaterial(Object.assign({ color: c, flatShading: true }, extra || {}));
function M4(x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
}
// merge simple geometries (position + normal only) so a multi-part shape is still one instanced draw
function merge(parts) {
  const list = parts.map(([g, m]) => { const n = g.index ? g.toNonIndexed() : g.clone(); n.applyMatrix4(m); return n; });
  const total = list.reduce((a, n) => a + n.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  let o = 0;
  for (const n of list) { pos.set(n.attributes.position.array, o * 3); nor.set(n.attributes.normal.array, o * 3); o += n.attributes.position.count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
const base0 = (g) => { g.translate(0, 0.5, 0); return g; }; // unit shapes standing on y = 0

// ----------------------------------------------------------------- instanced pools
class Pool {
  constructor(geo, mat, cap, colored) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.cap = cap; this.n = 0; this.colored = colored;
    if (colored) this.mesh.setColorAt(0, col.set('#fff'));
    scene.add(this.mesh);
  }
  begin() { this.n = 0; }
  add(x, y, z, sx, sy, sz, ry, color, rx, rz) {
    if (this.n >= this.cap) return;
    eul.set(rx || 0, ry || 0, rz || 0); quat.setFromEuler(eul);
    vec.set(x, y, z); scl.set(sx, sy, sz);
    mtx.compose(vec, quat, scl);
    this.mesh.setMatrixAt(this.n, mtx);
    if (this.colored) this.mesh.setColorAt(this.n, color || col.set('#fff'));
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colored && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
const pools = {};
let clouds = [], hills = [], decos = [];

// ----------------------------------------------------------------- init
export function init(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.3, 5000);
  scene.fog = new THREE.Fog('#cfeeff', 60, 330);
  hemi = new THREE.HemisphereLight('#ffffff', '#5a6a40', 1.5);
  sun = new THREE.DirectionalLight('#fff6e0', 2.2); sun.position.set(0.4, 1, 0.5);
  scene.add(hemi, sun);

  // sky dome (vertex coloured gradient, follows the camera)
  const sg = new THREE.SphereGeometry(1, 20, 12);
  skyCols = new Float32Array(sg.attributes.position.count * 3);
  sg.setAttribute('color', new THREE.BufferAttribute(skyCols, 3));
  sky = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  scene.add(sky);

  // ground: one big plane that follows the camera, its texture scrolls so it looks fixed in the world
  const gc = document.createElement('canvas'); gc.width = gc.height = 128;
  const g2 = gc.getContext('2d');
  g2.fillStyle = '#fff'; g2.fillRect(0, 0, 128, 128);
  g2.fillStyle = '#ececec'; g2.fillRect(0, 0, 64, 64); g2.fillRect(64, 64, 64, 64);
  for (let i = 0; i < 160; i++) { g2.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.5)'; g2.fillRect(Math.random() * 128, Math.random() * 128, 3, 3); }
  groundTex = new THREE.CanvasTexture(gc);
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const gg = new THREE.PlaneGeometry(1, 1); gg.rotateX(-Math.PI / 2);
  ground = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ color: '#5fa83a', map: groundTex }));
  scene.add(ground);

  shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.25, depthWrite: false }));
  scene.add(shadow);
  sunDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({ color: '#fff6d0', fog: false, depthWrite: false }));
  sunGlow = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({ color: '#fff2b0', transparent: true, opacity: 0.25, fog: false, depthWrite: false }));
  sunDisc.renderOrder = sunGlow.renderOrder = -0.5;
  scene.add(sunGlow, sunDisc);

  // pools
  const coinG = new THREE.CylinderGeometry(1, 1, 0.24, 16); coinG.rotateZ(Math.PI / 2);
  pools.coin = new Pool(coinG, lam('#ffd23a', { emissive: '#b07a00', flatShading: false }), 500);
  pools.gem = new Pool(new THREE.OctahedronGeometry(1), lam('#3fb2ff', { emissive: '#0b3a80' }), 30);
  pools.fuel = new Pool(new THREE.BoxGeometry(1.2, 1.6, 0.8), lam('#e63946', { emissive: '#400' }), 30);
  const ringG = new THREE.TorusGeometry(1, 0.1, 8, 28); ringG.rotateY(Math.PI / 2);
  pools.ring = new Pool(ringG, lam('#ff9a1a', { emissive: '#7a3a00' }), 40);
  pools.balloon = new Pool(new THREE.SphereGeometry(1, 12, 9), lam('#fff'), 40, true);
  pools.basket = new Pool(base0(new THREE.BoxGeometry(1, 1, 1)), lam('#8b5e3c'), 40);
  const liftM = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
  pools.lift = new Pool(base0(new THREE.CylinderGeometry(0.5, 0.5, 1, 18, 1, true)), liftM, 30);
  const wing = new THREE.BoxGeometry(0.4, 0.06, 1);
  pools.bird = new Pool(merge([[wing, M4(0, 0, 0.45, 1, 1, 1, 0.45, 0, 0)], [wing, M4(0, 0, -0.45, 1, 1, 1, -0.45, 0, 0)], [new THREE.BoxGeometry(0.7, 0.18, 0.18), M4(0, 0, 0)]]), lam('#fff'), 120, true);
  pools.trunk = new Pool(base0(new THREE.CylinderGeometry(0.5, 0.5, 1, 6)), lam('#6b4428'), 220);
  pools.canopy = new Pool(new THREE.IcosahedronGeometry(0.5, 0), lam('#fff'), 220, true);
  pools.cone = new Pool(base0(new THREE.ConeGeometry(0.5, 1, 7)), lam('#fff'), 440, true);
  pools.box = new Pool(base0(new THREE.BoxGeometry(1, 1, 1)), lam('#fff'), 900, true);
  pools.cyl = new Pool(base0(new THREE.CylinderGeometry(0.5, 0.5, 1, 12)), lam('#fff'), 300, true);
  pools.dome = new Pool(new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), lam('#fff'), 120, true);
  pools.rock = new Pool(new THREE.IcosahedronGeometry(0.5, 0), lam('#fff'), 160, true);
  pools.ell = new Pool(new THREE.SphereGeometry(1, 16, 10), lam('#fff'), 60, true);
  pools.blade = new Pool(new THREE.BoxGeometry(0.12, 1, 0.5).translate(0, 0.5, 0), lam('#f2f2f2'), 120, true);
  pools.spike = new Pool(new THREE.OctahedronGeometry(1, 0), lam('#2a2a2a'), 60);
  pools.grass = new Pool(base0(new THREE.ConeGeometry(0.5, 1, 4)), lam('#fff'), 260, true);
  pools.flower = new Pool(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#333333' }), 120, true);
  pools.cloud = new Pool(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#8a96a8' }), 90);
  pools.hill = new Pool(base0(new THREE.ConeGeometry(0.5, 1, 6)), lam('#fff'), 40, true);

  // launch site: slingshot, hangar, windsock
  site = new THREE.Group();
  const wood = lam('#7a4e28');
  const mk = (geo, mat) => { const m = new THREE.Mesh(geo, mat); site.add(m); return m; };
  site.userData.trunk = mk(base0(new THREE.CylinderGeometry(0.5, 0.6, 1, 8)), wood);
  site.userData.armL = mk(new THREE.BoxGeometry(1, 1, 1), wood);
  site.userData.armR = mk(new THREE.BoxGeometry(1, 1, 1), wood);
  const hangar = new THREE.Group();
  const hb = new THREE.Mesh(base0(new THREE.BoxGeometry(1, 1, 1)), lam('#9a6b45')); hb.scale.set(14, 7, 12); hangar.add(hb);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, false, 0, Math.PI), lam('#6b4428'));
  roof.rotation.set(Math.PI / 2, 0, Math.PI / 2); roof.scale.set(6.4, 14.4, 3.4); roof.position.set(0, 7, 0); hangar.add(roof);
  const door = new THREE.Mesh(base0(new THREE.BoxGeometry(1, 1, 1)), new THREE.MeshBasicMaterial({ color: '#2a1d14' })); door.scale.set(0.2, 5.2, 9); door.position.set(7, 0, 0); hangar.add(door);
  hangar.position.set(-16, 0, -14); hangar.rotation.y = 0.5;
  site.add(hangar); site.userData.hangar = hangar;
  const pole = new THREE.Mesh(base0(new THREE.CylinderGeometry(0.08, 0.08, 1, 6)), lam('#dddddd')); pole.scale.set(1, 6, 1); pole.position.set(-4, 0, 6); site.add(pole);
  const sock = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.2, 8).rotateZ(Math.PI / 2), lam('#ff6a1a')); sock.position.set(-2.9, 5.6, 6); site.add(sock);
  site.userData.scaled = [hangar, pole, sock];
  scene.add(site);
  const bandMat = new THREE.MeshLambertMaterial({ color: '#2b1a0e' });
  bandA = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), bandMat); bandB = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), bandMat);
  scene.add(bandA, bandB);

  bestStripe = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ff3b5c', transparent: true, opacity: 0.8 }));
  bestPole = new THREE.Mesh(base0(new THREE.CylinderGeometry(0.5, 0.5, 1, 6)), lam('#1b2240'));
  bestFlag = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.05), lam('#ff3b5c', { emissive: '#400' }));
  scene.add(bestStripe, bestPole, bestFlag);

  // particles: one Points draw with per-point size and rgba
  const PM = 320;
  pPos = new Float32Array(PM * 3); pCol = new Float32Array(PM * 4); pSize = new Float32Array(PM);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pg.setAttribute('pcol', new THREE.BufferAttribute(pCol, 4).setUsage(THREE.DynamicDrawUsage));
  pg.setAttribute('psize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
  pUniforms = { uScale: { value: 400 } };
  particles = new THREE.Points(pg, new THREE.ShaderMaterial({
    uniforms: pUniforms, transparent: true, depthWrite: false,
    vertexShader: 'attribute float psize; attribute vec4 pcol; varying vec4 vC; uniform float uScale;' +
      'void main(){ vC = pcol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(psize * uScale / -mv.z, 48.0); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.25) discard; gl_FragColor = vC; }',
  }));
  particles.frustumCulled = false;
  scene.add(particles);

  // trail ribbon
  const TN = 64;
  trailPos = new Float32Array(TN * 2 * 3); trailCol = new Float32Array(TN * 2 * 4);
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(trailPos, 3).setUsage(THREE.DynamicDrawUsage));
  tg.setAttribute('color', new THREE.BufferAttribute(trailCol, 4).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let i = 0; i < TN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  tg.setIndex(idx);
  trailMesh = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  trailMesh.frustumCulled = false;
  scene.add(trailMesh);
}

export function resize(w, h, perf) {
  W = w; H = h;
  renderer.setPixelRatio(perf ? 1 : Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

// ----------------------------------------------------------------- plane model (length 1, nose +x)
export function setPlane(model, paint, len, parts) {
  parts = parts || { tail: true, cockpit: true, engine: true };
  if (planeGroup) { scene.remove(planeGroup); planeGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
  const M = MODELS[model];
  const mb = lam(paint.body || M.body), mw = lam(paint.wing || M.wing), md = lam('#2a2a2a'), mg = lam('#9fdcff', { emissive: '#1a3a55' });
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, rx, ry, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, rz || 0); g.add(m); return m; };
  const jet = !M.prop;
  const cyl = (r1, r2, l, seg) => new THREE.CylinderGeometry(r1, r2, l, seg || 10).rotateZ(-Math.PI / 2); // axis along x, r1 at +x
  add(cyl(jet ? 0.012 : 0.075, 0.1, 0.45), mb, 0.27, 0, 0);
  add(cyl(0.1, 0.035, 0.55), mb, -0.22, 0, 0);
  if (parts.cockpit) add(new THREE.SphereGeometry(0.07, 10, 8), mg, jet ? 0.22 : 0.1, 0.085, 0).scale.set(jet ? 2 : 1.5, 0.8, 0.85);
  if (parts.stripe) for (const z of [-0.101, 0.101]) add(new THREE.BoxGeometry(0.7, 0.03, 0.005), mw, 0.0, 0.0, z);
  const span = M.longWing ? 1.45 : 1.15;
  if (parts.wheels && !M.floats) {
    for (const z of [-0.14, 0.14]) {
      add(new THREE.BoxGeometry(0.015, 0.12, 0.015), md, 0.12, -0.12, z);
      add(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 12).rotateX(Math.PI / 2), md, 0.12, -0.18, z);
    }
  }
  if (parts.tanks) for (const z of [-0.3, 0.3]) add(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 10).rotateZ(Math.PI / 2), lam('#d0d0d0'), 0.06, -0.08, z);
  if (parts.winglets && !M.delta && !jet) for (const z of [-span / 2, span / 2]) add(new THREE.BoxGeometry(0.16, 0.1, 0.012), mw, 0.04, 0.02, z);
  if (M.delta) {
    add(new THREE.BoxGeometry(0.42, 0.025, 0.5), mw, -0.12, -0.03, 0.27, 0, 0.75, 0);
    add(new THREE.BoxGeometry(0.42, 0.025, 0.5), mw, -0.12, -0.03, -0.27, 0, -0.75, 0);
  } else if (jet) {
    add(new THREE.BoxGeometry(0.2, 0.025, 0.55), mw, -0.02, -0.03, 0.3, 0, 0.45, 0);
    add(new THREE.BoxGeometry(0.2, 0.025, 0.55), mw, -0.02, -0.03, -0.3, 0, -0.45, 0);
  } else {
    add(new THREE.BoxGeometry(0.22, 0.025, span), mw, 0.06, -0.03, 0);
  }
  if (M.bi) {
    add(new THREE.BoxGeometry(0.22, 0.025, 1.15), mw, 0.08, 0.2, 0);
    for (const z of [-0.4, 0.4]) for (const x of [0.0, 0.14]) add(new THREE.BoxGeometry(0.015, 0.22, 0.015), md, x, 0.09, z);
  }
  if (parts.tail) {
    add(new THREE.BoxGeometry(0.17, 0.22, 0.02), mw, -0.42, 0.12, 0, 0, 0, 0.35);
    add(new THREE.BoxGeometry(0.14, 0.02, jet ? 0.34 : 0.42), mw, -0.44, 0.0, 0);
  }
  if (M.floats) {
    for (const z of [-0.2, 0.2]) { add(new THREE.BoxGeometry(0.55, 0.06, 0.07), lam('#e8e8e8'), 0.03, -0.24, z); add(new THREE.BoxGeometry(0.02, 0.2, 0.02), md, 0.05, -0.13, z); }
  }
  prop = null; jetFlame = null;
  if (M.prop && !parts.engine) {
    add(new THREE.SphereGeometry(0.075, 8, 6), mb, 0.49, 0, 0); // plain cardboard nose
  } else if (M.prop) {
    add(new THREE.SphereGeometry(0.05, 8, 6), md, 0.5, 0, 0);
    prop = new THREE.Group(); prop.position.set(0.53, 0, 0);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.52, 0.05), md);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.27, 18).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    prop.add(blade, disc); g.add(prop);
  } else {
    add(cyl(0.045, 0.05, 0.05), md, -0.5, 0, 0);
    jetFlame = add(new THREE.ConeGeometry(0.04, 0.22, 8).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#7fd0ff', transparent: true, opacity: 0.85 }), -0.62, 0, 0);
  }
  rocketFlame = add(new THREE.ConeGeometry(0.07, 0.5, 8).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffb43a', transparent: true, opacity: 0.9 }), -0.75, 0, 0);
  g.scale.setScalar(len);
  planeGroup = g;
  scene.add(g);
}

// ----------------------------------------------------------------- scenery recycling
function rnd(a, b) { return a + Math.random() * (b - a); }
export function resetScenery(x, z, sig) {
  clouds = []; hills = [];
  for (let i = 0; i < 18; i++) clouds.push(newCloud(x + rnd(-40, 380) * sig, z, sig));
  for (let i = 0; i < 22; i++) hills.push(newHill(x + rnd(-60, 380) * sig, z, sig));
  decos = [];
  for (let i = 0; i < 120; i++) decos.push(newDeco(x + rnd(-30, 260) * sig, z, sig));
}
function newDeco(x, z, sig) { return { x, z: z + rnd(-70, 70) * sig, s: rnd(0.6, 1.4) * sig, f: Math.random() < 0.3, hue: Math.random() }; }
function newCloud(x, z, sig) { const s = rnd(5, 11) * sig; return { x, y: rnd(25, 110) * sig, z: z + rnd(-180, 180) * sig, s, puffs: 2 + (Math.random() * 3 | 0) }; }
function newHill(x, z, sig) { const side = Math.random() < 0.5 ? -1 : 1; return { x, z: z + side * rnd(140, 300) * sig, w: rnd(60, 140) * sig, h: rnd(30, 90) * sig }; }

// ----------------------------------------------------------------- per-frame
const skyTop = new THREE.Color(), skyBot = new THREE.Color(), tmpA = new THREE.Color(), tmpB = new THREE.Color(), night = new THREE.Color('#0a1446');
let curBiome = 0, prevBiome = 0, fade = 1;

function updateSky(bi, dt, altF) {
  if (bi !== curBiome) { prevBiome = curBiome; curBiome = bi; fade = 0; }
  fade = Math.min(1, fade + dt * 0.6);
  const A = BIOMES[prevBiome], B = BIOMES[curBiome];
  skyTop.copy(colorOf(A.sky[0])).lerp(colorOf(B.sky[0]), fade).lerp(night, altF);
  skyBot.copy(colorOf(A.sky[1])).lerp(colorOf(B.sky[1]), fade).lerp(night, altF * 0.6);
  const p = sky.geometry.attributes.position.array;
  for (let i = 0, n = p.length / 3; i < n; i++) {
    const t = Math.min(1, Math.max(0, p[i * 3 + 1] * 1.6 + 0.1));
    tmpA.copy(skyBot).lerp(skyTop, t);
    skyCols[i * 3] = tmpA.r; skyCols[i * 3 + 1] = tmpA.g; skyCols[i * 3 + 2] = tmpA.b;
  }
  sky.geometry.attributes.color.needsUpdate = true;
  scene.fog.color.copy(skyBot);
  ground.material.color.copy(colorOf(A.ground)).lerp(colorOf(B.ground), fade);
  hemi.color.copy(skyTop).lerp(tmpB.set('#ffffff'), 0.6);
  hemi.groundColor.copy(ground.material.color);
}

function seg(mesh, ax, ay, az, bx, by, bz, th) {
  vec.set(bx - ax, by - ay, bz - az);
  const l = vec.length();
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  mesh.scale.set(th, th, l);
  mesh.lookAt(bx, by, bz);
}

// v: { mode, t, dt, P, sig, len, px, py, pz, pitch, heading, bank, engineOn, rocketOn, showPlane, ents, parts, trail, trailN, trailHead, trailStyle, best, shake, aimYaw }
export function frame(v) {
  const s = v.sig, L = v.len, dt = v.dt;
  const bi = C.biomeIndex(Math.max(0, v.px));
  const ceil = v.P.st.ceil;
  updateSky(bi, dt, Math.min(0.55, Math.max(0, (v.py - ceil * 0.8) / (ceil * 3))));

  // ---- plane
  planeGroup.visible = v.showPlane;
  planeGroup.position.set(v.px, v.py, v.pz);
  planeGroup.rotation.set(v.bank, -v.heading, v.pitch, 'YZX');
  if (prop) prop.rotation.x = v.t * (v.mode === 'hangar' ? 6 : 40);
  if (jetFlame) { jetFlame.visible = v.engineOn; jetFlame.scale.x = 0.8 + Math.sin(v.t * 60) * 0.25; }
  rocketFlame.visible = v.rocketOn; rocketFlame.scale.set(0.9 + Math.sin(v.t * 50) * 0.2, 1, 1);
  shadow.visible = v.showPlane;
  const shAlt = Math.max(0, v.py) / L;
  shadow.position.set(v.px, 0.03 * s, v.pz);
  shadow.scale.setScalar(L * (1.1 + shAlt * 0.05));
  shadow.material.opacity = Math.max(0, 0.32 - shAlt * 0.012);

  // ---- launch site (scales with the plane)
  const showSite = v.px < 120 * s || v.mode !== 'fly';
  site.visible = showSite; bandA.visible = bandB.visible = showSite;
  if (showSite) {
    const ud = site.userData;
    const forkY = 0.62 * L, tipY = 1.18 * L, tipZ = 0.68 * L, th = 0.09 * L;
    ud.trunk.scale.set(th * 1.4, forkY, th * 1.4);
    seg(ud.armL, 0, forkY - th, 0, 0, tipY, -tipZ, th);
    seg(ud.armR, 0, forkY - th, 0, 0, tipY, tipZ, th);
    const hs = s * (L / (4 * s));
    for (const o of ud.scaled) o.scale.multiplyScalar(1); // keep authoring scale
    ud.hangar.position.set(-16 * hs, 0, -14 * hs); ud.hangar.scale.setScalar(hs);
    const tailX = v.mode === 'fly' || v.mode === 'ending' || v.mode === 'result' || v.mode === 'paused' ? 0 : v.px - Math.cos(v.heading) * 0.45 * L;
    const tailY = v.mode === 'fly' || v.mode === 'ending' || v.mode === 'result' || v.mode === 'paused' ? tipY - 0.05 * L : v.py;
    const tailZ = v.mode === 'fly' || v.mode === 'ending' || v.mode === 'result' || v.mode === 'paused' ? 0 : v.pz - Math.sin(v.heading) * 0.45 * L;
    seg(bandA, 0, tipY, -tipZ, tailX, tailY, tailZ, 0.035 * L);
    seg(bandB, 0, tipY, tipZ, tailX, tailY, tailZ, 0.035 * L);
  }

  // ---- best distance marker
  const showBest = v.best > 20;
  bestStripe.visible = bestPole.visible = bestFlag.visible = showBest;
  if (showBest) {
    bestStripe.position.set(v.best, 0.05 * s, v.pz); bestStripe.scale.set(1.2 * s, 0.1 * s, 300 * s);
    bestPole.position.set(v.best, 0, v.pz + 14 * s); bestPole.scale.set(0.5 * s, 14 * s, 0.5 * s);
    bestFlag.position.set(v.best + 2.2 * s, 12.5 * s, v.pz + 14 * s); bestFlag.scale.set(4.4 * s, 2.6 * s, 1);
  }

  // ---- entities
  for (const k in pools) pools[k].begin();
  const xmin = v.camX - 40 * s, xmax = v.px + 420 * s;
  const ents = v.ents, t = v.t;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e.dead || e.x < xmin || e.x > xmax) continue;
    switch (e.k) {
      case 'coin': pools.coin.add(e.x, e.y, e.z, s, s, s, t * 3 + e.x * 0.05); break;
      case 'gem': pools.gem.add(e.x, e.y + Math.sin(t * 3) * 0.3 * s, e.z, 1.1 * s, 1.6 * s, 1.1 * s, t * 2); break;
      case 'fuel': pools.fuel.add(e.x, e.y, e.z, s, s, s, t * 1.5); break;
      case 'ring': pools.ring.add(e.x, e.y, e.z, e.r, e.r, e.r, 0); break;
      case 'balloon': {
        const by = e.y + Math.sin(t * 1.5 + e.x) * 0.3 * s;
        pools.balloon.add(e.x, by, e.z, 2.4 * s, 2.8 * s, 2.4 * s, 0, colorOf(BALLOON_C[e.hue]));
        pools.basket.add(e.x, by - 4 * s, e.z, 1 * s, 0.8 * s, 1 * s, 0);
        break;
      }
      case 'lift': pools.lift.add(e.x, 0, e.z, e.w, e.top, e.w, t * 0.5); break;
      case 'bird': pools.bird.add(e.x, e.y, e.z, 1.6 * s, 1.6 * s, (1.4 + Math.sin(t * 12 + e.ph) * 0.3) * s, 0, colorOf(e.c)); break;
      case 'obst': drawObst(e, t); break;
    }
  }
  // clouds & hills drift past and recycle ahead of the plane
  for (const c of clouds) {
    if (c.x < v.camX - 60 * s) Object.assign(c, newCloud(v.px + rnd(300, 420) * s, v.pz, s));
    for (let j = 0; j < c.puffs; j++) pools.cloud.add(c.x + j * c.s * 0.9, c.y + (j % 2) * c.s * 0.25, c.z + (j % 3) * c.s * 0.3, c.s * (1 - j * 0.12), c.s * 0.7, c.s * 0.8, j);
  }
  // ground detail: grass tufts and flowers (or ice/rubble/foam depending on the zone)
  const B = BIOMES[bi];
  const tuftC = colorOf(B.near), edgeC = colorOf(B.edge);
  if (!B.water && bi < 9) {
    for (const d of decos) {
      if (d.x < v.camX - 20 * s) Object.assign(d, newDeco(v.px + rnd(200, 280) * s, v.pz, s));
      if (d.f) pools.flower.add(d.x, d.s * 0.4, d.z, d.s * 0.7, d.s * 0.7, d.s * 0.7, 0, col.setHSL(d.hue, 0.8, 0.65));
      else {
        pools.grass.add(d.x, 0, d.z, d.s * 0.6, d.s * 1.4, d.s * 0.6, d.hue * 6, d.hue < 0.5 ? tuftC : edgeC);
        pools.grass.add(d.x + d.s * 0.5, 0, d.z + d.s * 0.3, d.s * 0.5, d.s * 1.0, d.s * 0.5, d.hue * 3, tuftC);
      }
    }
  }
  const hillC = colorOf(BIOMES[bi].far);
  for (const h of hills) {
    if (h.x < v.camX - 150 * s) Object.assign(h, newHill(v.px + rnd(330, 450) * s, v.pz, s));
    pools.hill.add(h.x, 0, h.z, h.w, h.h, h.w, h.x * 0.01, hillC);
  }
  for (const k in pools) pools[k].end();

  // ---- particles
  const parts = v.parts;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.on) { pSize[i] = 0; continue; }
    const a = p.life / p.max;
    pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z;
    const c = colorOf(p.color);
    pCol[i * 4] = c.r; pCol[i * 4 + 1] = c.g; pCol[i * 4 + 2] = c.b; pCol[i * 4 + 3] = Math.min(1, a * 1.5) * p.alpha;
    pSize[i] = p.size * 2 * (0.4 + a * 0.6);
  }
  const pa = particles.geometry.attributes;
  pa.position.needsUpdate = pa.pcol.needsUpdate = pa.psize.needsUpdate = true;

  // ---- trail ribbon (width across the direction of travel)
  const tr = v.trail, n = v.trailN, TN = 64;
  trailMesh.visible = n > 2;
  if (n > 2) {
    const style = v.trailStyle, w0 = 0.06 * L;
    for (let j = 0; j < TN; j++) {
      const jj = Math.min(j, n - 1);
      const idx = ((v.trailHead - 1 - jj) % TN + TN) % TN, nx = ((v.trailHead - 2 - jj) % TN + TN) % TN;
      const x = tr[idx * 3], y = tr[idx * 3 + 1], z = tr[idx * 3 + 2];
      let dx = x - tr[nx * 3], dz = z - tr[nx * 3 + 2];
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const f = 1 - jj / n, w = w0 * (0.25 + 0.75 * f);
      trailPos[j * 6] = x - dz * w; trailPos[j * 6 + 1] = y; trailPos[j * 6 + 2] = z + dx * w;
      trailPos[j * 6 + 3] = x + dz * w; trailPos[j * 6 + 4] = y; trailPos[j * 6 + 5] = z - dx * w;
      if (style.rainbow) col.setHSL(((t * 0.6 + j * 0.025) % 1), 0.95, 0.6); else col.copy(colorOf(style.rgb));
      const a = j < n ? f * style.a : 0;
      for (let q = 0; q < 2; q++) { const o = (j * 2 + q) * 4; trailCol[o] = col.r; trailCol[o + 1] = col.g; trailCol[o + 2] = col.b; trailCol[o + 3] = a; }
    }
    trailMesh.geometry.attributes.position.needsUpdate = true;
    trailMesh.geometry.attributes.color.needsUpdate = true;
  }

  // ---- camera
  updateCamera(v);
  ground.position.set(camera.position.x, 0, camera.position.z);
  const gsize = 1400 * s, tile = 14 * s;
  ground.scale.set(gsize, 1, gsize);
  groundTex.repeat.set(gsize / tile, gsize / tile);
  groundTex.offset.set(camera.position.x / tile, -camera.position.z / tile);
  sky.position.copy(camera.position); sky.scale.setScalar(camera.far * 0.9);
  const sd = camera.far * 0.8;
  sunDisc.position.set(camera.position.x + sd * 0.75, camera.position.y + sd * 0.42, camera.position.z - sd * 0.5);
  sunDisc.scale.setScalar(sd * 0.035); sunDisc.lookAt(camera.position);
  sunGlow.position.copy(sunDisc.position); sunGlow.scale.setScalar(sd * 0.08); sunGlow.lookAt(camera.position);
  renderer.render(scene, camera);
}
const BALLOON_C = ['#ff5a5a', '#ffcf3a', '#5fd35a', '#3f8ff5', '#c56bff', '#ff8ad8'];

function drawObst(e, t) {
  const x = e.x, z = e.z, w = e.w, h = e.h, sd = e.seed, s = w / 4.5;
  switch (e.t) {
    case 'tree': {
      pools.trunk.add(x, 0, z, w * 0.22, h * 0.6, w * 0.22, 0);
      const c1 = col.setHSL(0.27 + sd * 0.06, 0.55, 0.3 + sd * 0.08);
      pools.canopy.add(x, h * 0.62, z, w * 1.15, h * 0.62, w * 1.15, sd * 6, c1);
      pools.canopy.add(x + w * 0.1, h * 0.86, z - w * 0.05, w * 0.75, h * 0.38, w * 0.75, sd * 9, col.setHSL(0.28 + sd * 0.06, 0.55, 0.4 + sd * 0.08));
      break;
    }
    case 'rock':
      pools.rock.add(x, h * 0.35, z, w, h * 1.1, w * 0.9, sd * 6, colorOf(e.col), sd * 2, sd * 3);
      pools.rock.add(x + w * 0.35, h * 0.15, z + w * 0.25, w * 0.45, h * 0.5, w * 0.45, sd * 9, colorOf(e.col));
      break;
    case 'iceberg':
      pools.cone.add(x, 0, z, w, h, w * 0.85, sd * 6, colorOf('#e6f6ff'));
      pools.cone.add(x + w * 0.25, 0, z - w * 0.15, w * 0.55, h * 0.7, w * 0.5, sd * 4, colorOf('#bfe3f7'));
      break;
    case 'windmill': {
      const g = e.sg;
      pools.cyl.add(x, 0, z, 1.8 * g, h, 1.8 * g, 0, colorOf('#f4f4f4'));
      pools.box.add(x, h - 1 * g, z, 3 * g, 2 * g, 2 * g, 0, colorOf('#e0e0e0'));
      pools.ell.add(x + 1.4 * g, h, z, 0.9 * g, 0.9 * g, 0.9 * g, 0, colorOf('#dddddd'));
      for (let k = 0; k < 3; k++) pools.blade.add(x + 1.2 * g, h, z, 2 * g, e.R, 4.4 * g, 0, colorOf(k === 0 ? '#ff5a5a' : '#f7f7f7'), e.ph + e.om * t + k * 2.0944);
      break;
    }
    case 'arch': {
      const off = e.gap / 2 + e.leg / 2, c = colorOf(e.col), c2 = colorOf('#c96b3f');
      pools.box.add(x, 0, z - off, 6 * (e.leg / 5), e.h, e.leg, sd, c);
      pools.box.add(x, 0, z + off, 6 * (e.leg / 5), e.h, e.leg, -sd, c);
      pools.box.add(x, e.h, z, 6 * (e.leg / 5), e.th, off * 2 + e.leg, 0, c2);
      break;
    }
    case 'ship': {
      const L = e.L, u = L / 30;
      pools.box.add(x, 0, z, L, 5 * u, 9 * u, 0, colorOf('#c0392b'));
      pools.box.add(x, 4.2 * u, z, L * 1.01, 1 * u, 9.1 * u, 0, colorOf('#f4f4f4'));
      pools.box.add(x - L * 0.15, 5 * u, z, 10 * u, 6.5 * u, 6 * u, 0, colorOf('#ffffff'));
      pools.cyl.add(x - L * 0.15, 11 * u, z, 2 * u, 3 * u, 2 * u, 0, colorOf('#1b2240'));
      break;
    }
    case 'blimp': {
      const y = e.y + Math.sin(t * 0.6 + sd * 6) * 0.15 * e.b;
      pools.ell.add(x, y, z, e.a, e.b, e.b, 0, colorOf(sd < 0.5 ? '#e8e8f0' : '#ffcf3a'));
      pools.box.add(x + e.a * 0.1, y - e.b * 1.3, z, e.a * 0.35, e.b * 0.35, e.b * 0.4, 0, colorOf('#3a3f55'));
      pools.box.add(x - e.a * 0.85, y, z, e.a * 0.25, e.b * 1.2, e.b * 0.1, 0, colorOf('#ff3b5c'));
      pools.box.add(x - e.a * 0.85, y - e.b * 0.05, z, e.a * 0.25, e.b * 0.1, e.b * 1.2, 0, colorOf('#ff3b5c'));
      break;
    }
    case 'mine': {
      pools.ell.add(x, e.y, z, e.rad, e.rad, e.rad, t * 0.5, colorOf('#8a1f1f'));
      pools.spike.add(x, e.y, z, e.rad * 1.5, e.rad * 1.5, e.rad * 1.5, t * 0.5);
      break;
    }
    case 'satellite': {
      const u = e.sg;
      pools.box.add(x, e.y - 1.6 * u, z, 3.2 * u, 3.2 * u, 3.2 * u, 0, colorOf('#d8b04a'));
      pools.box.add(x, e.y - 1.2 * u, z, 0.2 * u, 2.4 * u, 15 * u, 0, colorOf('#2a4a9a'));
      pools.cyl.add(x, e.y + 1.6 * u, z, 0.3 * u, 2 * u, 0.3 * u, 0, colorOf('#cccccc'));
      break;
    }
    case 'silo':
      pools.cyl.add(x, 0, z, w, h, w, 0, colorOf(sd < 0.5 ? '#c0392b' : '#d8d2c4'));
      pools.dome.add(x, h, z, w, w, w, 0, colorOf('#e6e6e6'));
      break;
    case 'cactus': {
      const c = colorOf('#3e9b4f');
      pools.box.add(x, 0, z, w * 0.5, h, w * 0.5, sd, c);
      pools.box.add(x - w * 0.55, h * 0.35, z, w * 0.3, h * 0.35, w * 0.3, 0, c);
      pools.box.add(x - w * 0.4, h * 0.35, z, w * 0.4, w * 0.25, w * 0.3, 0, c);
      pools.box.add(x + w * 0.55, h * 0.45, z, w * 0.3, h * 0.3, w * 0.3, 0, c);
      pools.box.add(x + w * 0.4, h * 0.45, z, w * 0.4, w * 0.25, w * 0.3, 0, c);
      break;
    }
    case 'pillar':
      pools.box.add(x, 0, z, w, h, w * 0.9, sd * 3, col.setHSL(0.04, 0.55, 0.3 + sd * 0.08));
      pools.box.add(x, h * 0.93, z, w * 1.08, h * 0.07, w * 0.98, sd * 3, colorOf('#c96b3f'));
      break;
    case 'pine':
    case 'spire':
      pools.cone.add(x, 0, z, w, h, w, sd * 6, colorOf(e.t === 'pine' ? '#2f6b4a' : '#2a1a1a'));
      pools.cone.add(x, h * 0.72, z, w * 0.3, h * 0.28, w * 0.3, sd * 6, colorOf(e.t === 'pine' ? '#ffffff' : '#ff6a2a'));
      break;
    case 'tower': {
      pools.box.add(x, 0, z, w, h, w, 0, colorOf(sd < 0.5 ? '#3c4a63' : '#56657f'));
      const bc = colorOf('#ffe08a');
      for (let f = 0.25; f < 0.95; f += 0.22) pools.box.add(x, h * f, z, w * 1.02, h * 0.035, w * 1.02, 0, bc);
      pools.box.add(x, h, z, w * 0.06, h * 0.08, w * 0.06, 0, colorOf('#ff3b3b'));
      break;
    }
    case 'buoy':
      pools.cyl.add(x, 0, z, w, h, w, 0, colorOf('#ff3b3b'));
      pools.cyl.add(x, h * 0.4, z, w * 1.03, h * 0.2, w * 1.03, 0, colorOf('#ffffff'));
      break;
  }
}

function updateCamera(v) {
  const s = v.sig, L = v.len, dt = Math.min(0.05, v.dt);
  const tx = v.px, ty = v.py, tz = v.pz;
  let px, py, pz, lx, ly, lz, fov = 62, k;
  if (v.mode === 'hangar') {
    px = tx + 2.0 * L; py = ty + 0.45 * L; pz = tz + 3.3 * L;
    lx = tx - 0.15 * L; ly = ty - 0.35 * L; lz = tz;
    fov = 55; k = 6;
  } else if (v.mode === 'aim') {
    const hh = v.aimYaw;
    px = tx - Math.cos(hh) * 3.4 * L; py = ty + 1.5 * L; pz = tz - Math.sin(hh) * 3.4 * L;
    lx = tx + Math.cos(hh) * 8 * L; ly = ty + 0.6 * L; lz = tz + Math.sin(hh) * 8 * L;
    fov = 60; k = 5;
  } else {
    const P = v.P, vn = P.v / P.st.vbg;
    camHeading += (v.heading - camHeading) * Math.min(1, dt * 3.5);
    const cp = (v.camPitch === undefined ? v.pitch : v.camPitch) * 0.6; // follow the flight path, not the nose
    const dist = L * (3.0 + Math.min(1.6, vn * 0.25)), up = L * 0.85;
    const ch = Math.cos(camHeading), sh = Math.sin(camHeading), cc = Math.cos(cp);
    px = tx - ch * cc * dist; py = ty - Math.sin(cp) * dist + up; pz = tz - sh * cc * dist;
    lx = tx + ch * L * 3; ly = ty + Math.sin(cp) * L * 3 + 0.25 * L; lz = tz + sh * L * 3;
    fov = 62 + Math.min(20, Math.max(0, (vn - 1.2) * 7));
    k = v.mode === 'fly' ? 10 : 2.5;
  }
  if (!camReady || v.snap) { camPos.set(px, py, pz); camLook.set(lx, ly, lz); camReady = true; camHeading = v.heading; }
  else {
    const f = 1 - Math.exp(-dt * k);
    camPos.x += (px - camPos.x) * f; camPos.y += (py - camPos.y) * f; camPos.z += (pz - camPos.z) * f;
    const g = 1 - Math.exp(-dt * k * 1.5);
    camLook.x += (lx - camLook.x) * g; camLook.y += (ly - camLook.y) * g; camLook.z += (lz - camLook.z) * g;
    if (v.mode === 'fly') { camPos.x = px - (px - camPos.x) * 0.2; camLook.x = lx; } // stay locked downrange at speed
  }
  if (camPos.y < 0.6 * s) camPos.y = 0.6 * s;
  curFov += (fov - curFov) * Math.min(1, dt * 3);
  camera.fov = curFov;
  camera.near = 0.25 * s; camera.far = 900 * s;
  scene.fog.near = 90 * s; scene.fog.far = 400 * s;
  camera.updateProjectionMatrix();
  camera.position.copy(camPos);
  if (v.shake > 0) camera.position.add(lookTmp.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(v.shake * 0.12 * L));
  camera.lookAt(camLook);
  pUniforms.uScale.value = (H * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
}

const projV = new THREE.Vector3();
export function project(x, y, z) {
  projV.set(x, y, z).project(camera);
  return { x: (projV.x * 0.5 + 0.5) * W, y: (-projV.y * 0.5 + 0.5) * H, ok: projV.z < 1 };
}
export function cameraX() { return camera.position.x; }
export function info() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; }
