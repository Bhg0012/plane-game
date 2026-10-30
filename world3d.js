// Sky Fling - 3D renderer (Three.js). Owns the scene, camera and meshes; game.js owns all game state.
// Everything repeated (coins, trees, rings...) is drawn with InstancedMesh so the whole world is ~40 draw calls.
import * as THREE from './vendor/three.module.min.js';

const C = window.Core;
const { MODELS, BIOMES } = C;

let renderer, scene, camera, hemi, sun;
let sky, skyCols, ground, groundTex, shadow, sunDisc, sunGlow;
let ghost = null, shieldMesh = null;
let planeGroup = null, prop = null, jetFlame = null, rocketFlame = null;
let slingDeco, slingAnim = [], slingTierBuilt = -1;
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
const lamBase = lam;
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
    this.mesh.visible = this.n > 0; // empty pools cost no draw call
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colored && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
const pools = {};
let clouds = [], hills = [], decos = [];

// ----------------------------------------------------------------- init
export function init(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.3, 5000);
  scene.fog = new THREE.Fog('#cfeeff', 60, 330);
  hemi = new THREE.HemisphereLight('#ffffff', '#5a6a40', 1.5);
  sun = new THREE.DirectionalLight('#fff6e0', 2.2); sun.position.set(0.75, 0.62, -0.5); // matches the sun disc in the sky
  scene.add(hemi, sun);

  // sky dome (vertex coloured gradient, follows the camera)
  const sg = new THREE.SphereGeometry(1, 20, 12);
  skyCols = new Float32Array(sg.attributes.position.count * 3);
  sg.setAttribute('color', new THREE.BufferAttribute(skyCols, 3));
  sky = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  scene.add(sky);

  // ground: one big plane that follows the camera, its texture scrolls so it looks fixed in the world
  const gc = document.createElement('canvas'); gc.width = gc.height = 256;
  const g2 = gc.getContext('2d');
  g2.fillStyle = '#fff'; g2.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 8; i++) { g2.fillStyle = i % 2 ? '#f1f1f1' : '#e4e4e4'; g2.fillRect(i * 32, 0, 32, 256); } // mowed stripes
  for (let i = 0; i < 26; i++) { // soft patches
    const x = Math.random() * 256, y = Math.random() * 256, r = 10 + Math.random() * 26;
    const gr = g2.createRadialGradient(x, y, 0, x, y, r);
    const d = Math.random() < 0.5; gr.addColorStop(0, d ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g2.fillStyle = gr; g2.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 700; i++) { g2.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.45)'; g2.fillRect(Math.random() * 256, Math.random() * 256, 2, 2 + Math.random() * 3); }
  groundTex = new THREE.CanvasTexture(gc);
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const gg = new THREE.PlaneGeometry(1, 1); gg.rotateX(-Math.PI / 2);
  ground = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ color: '#5fa83a', map: groundTex }));
  scene.add(ground);

  shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.25, depthWrite: false }));
  scene.add(shadow);
  shieldMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: '#38b6ff', transparent: true, opacity: 0.22, depthWrite: false }));
  shieldMesh.visible = false; scene.add(shieldMesh);
  sunDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({ color: '#fff6d0', fog: false, depthWrite: false }));
  sunGlow = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({ color: '#fff2b0', transparent: true, opacity: 0.25, fog: false, depthWrite: false }));
  sunDisc.renderOrder = sunGlow.renderOrder = -0.5;
  scene.add(sunGlow, sunDisc);

  // pools
  const coinG = new THREE.CylinderGeometry(1, 1, 0.24, 16); coinG.rotateZ(Math.PI / 2);
  pools.coin = new Pool(coinG, lam('#ffd23a', { emissive: '#b07a00', flatShading: false }), 500);
  pools.gem = new Pool(new THREE.OctahedronGeometry(1), lam('#3fb2ff', { emissive: '#0b3a80' }), 30);
  pools.rfuel = new Pool(new THREE.CylinderGeometry(0.55, 0.55, 1.7, 12), lam('#a24bff', { emissive: '#4a1080' }), 20);
  pools.rfuelTip = new Pool(new THREE.ConeGeometry(0.55, 0.7, 12), lam('#ffb43a', { emissive: '#7a3a00' }), 20);
  const pRingG = new THREE.TorusGeometry(1, 0.13, 8, 32); pRingG.rotateY(Math.PI / 2);
  pools.pring = new Pool(pRingG, lam('#ffffff', { emissive: '#333333' }), 60, true);
  pools.picon = new Pool(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: '#ffffff' }), 20, true);
  pools.debris = new Pool(new THREE.BoxGeometry(1, 1, 1), lam('#fff'), 40, true);
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
  pools.flower = new Pool(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#333333' }), 260, true);
  const prismG = new THREE.CylinderGeometry(0.5, 0.5, 1, 3); prismG.rotateX(Math.PI / 2); prismG.rotateZ(Math.PI); prismG.translate(0, 0.25, 0);
  prismG.scale(1, 2, 1);
  pools.prism = new Pool(new THREE.BufferGeometry().copy(prismG), lam('#fff'), 60, true);
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
  site.userData.wood = wood;
  slingDeco = new THREE.Group(); site.add(slingDeco);
  const bandMat = new THREE.MeshLambertMaterial({ color: '#2b1a0e' });
  site.userData.band = bandMat;
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

let baseRatio = 1, qualityScale = 1;
export function setQuality(scale) { qualityScale = scale; renderer.setPixelRatio(Math.max(0.6, baseRatio * scale)); renderer.setSize(W, H, false); }
export function resize(w, h, perf) {
  W = w; H = h;
  baseRatio = perf ? 1 : Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(Math.max(0.6, baseRatio * qualityScale));
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

// ----------------------------------------------------------------- plane model (length 1, nose +x)
// trapezoid wing panel: root chord from x0 (leading) to x1 (trailing) at z=0, tip chord tx0..tx1 at z=zt
function trap(x0, x1, tx0, tx1, zt, th, ty) {
  const h = th / 2, t = ty || 0;
  const v = [x0, h, 0, x1, h, 0, tx1, t + h * 0.6, zt, tx0, t + h * 0.6, zt, x0, -h, 0, x1, -h, 0, tx1, t - h * 0.6, zt, tx0, t - h * 0.6, zt];
  const idx = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx);
  const n = g.toNonIndexed(); n.computeVertexNormals(); return n;
}
export function setPlane(model, paint, len, parts, decal) {
  parts = parts || { tail: true, cockpit: true, engine: true };
  if (planeGroup) { scene.remove(planeGroup); planeGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
  const M = MODELS[model], st = M.style || 'classic';
  const matCache = new Map();
  const lam = (c, extra) => {
    const k = c + JSON.stringify(extra || {});
    let m = matCache.get(k);
    if (!m) { m = new THREE.MeshPhongMaterial(Object.assign({ color: c, flatShading: true, shininess: 70, specular: '#4a4a4a' }, extra || {})); matCache.set(k, m); }
    return m;
  };
  const ds = { side: THREE.DoubleSide };
  const mb = lam(paint.body || M.body, ds), mw = lam(paint.wing || M.wing, ds), md = lam('#2a2a2a'), mm = lam('#9aa3ad'), mr = lam('#e63946');
  const mg = lam(M.style === 'stealth' || M.style === 'flyingwing' ? '#d9b25a' : '#9fdcff', { emissive: M.style === 'stealth' || M.style === 'flyingwing' ? '#3a2a00' : '#1a3a55' });
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, rx, ry, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); m.rotation.set(rx || 0, ry || 0, rz || 0); g.add(m); return m; };
  const cyl = (r1, r2, l, seg) => new THREE.CylinderGeometry(r1, r2, l, seg || 14).rotateZ(-Math.PI / 2); // axis along x, r1 at +x
  const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
  const nozzles = [];
  const roundel = (x, y, z) => { // military insignia on the wings
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.006, 16), lam('#f4f1ea'), x, y, z);
    add(new THREE.CylinderGeometry(0.028, 0.028, 0.008, 16), lam(M.style ? '#2a3a6a' : '#c0392b'), x, y + 0.001, z);
  };
  const missile = (z) => {
    add(cyl(0.014, 0.014, 0.26, 8), lam('#eeeeee'), -0.02, -0.055, z);
    add(new THREE.ConeGeometry(0.014, 0.05, 8).rotateZ(-Math.PI / 2), mr, 0.135, -0.055, z);
    add(box(0.05, 0.003, 0.04), lam('#cccccc'), -0.13, -0.055, z);
  };

  if (st === 'classic') {
    const jet = !M.prop;
    add(cyl(jet ? 0.012 : 0.075, 0.1, 0.45, 16), mb, 0.27, 0, 0);
    add(cyl(0.1, 0.035, 0.55, 16), mb, -0.22, 0, 0);
    if (M.prop && parts.engine) {
      add(cyl(0.085, 0.1, 0.1, 16), md, 0.44, 0, 0);
      for (const z of [-0.07, 0.07]) add(cyl(0.012, 0.012, 0.08, 6), md, 0.33, -0.06, z * 1.4);
    }
    if (parts.cockpit) {
      add(new THREE.SphereGeometry(0.07, 12, 8), mg, 0.1, 0.085, 0).scale.set(1.5, 0.8, 0.85);
      add(box(0.006, 0.07, 0.11), md, 0.1, 0.09, 0); // canopy frame
      add(cyl(0.004, 0.004, 0.09, 4), md, -0.1, 0.13, 0, 0, 0, 1.2); // radio mast
    }
    if (parts.stripe) for (const z of [-0.101, 0.101]) add(box(0.7, 0.03, 0.005), mw, 0, 0, z);
    const span = M.longWing ? 1.45 : 1.15;
    if (parts.wheels && !M.floats) {
      for (const z of [-0.14, 0.14]) {
        add(box(0.015, 0.12, 0.015), md, 0.12, -0.12, z);
        add(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 14).rotateX(Math.PI / 2), md, 0.12, -0.18, z);
        add(new THREE.CylinderGeometry(0.02, 0.02, 0.034, 10).rotateX(Math.PI / 2), mm, 0.12, -0.18, z);
      }
      add(new THREE.CylinderGeometry(0.018, 0.018, 0.015, 10).rotateX(Math.PI / 2), md, -0.47, -0.06, 0); // tail wheel
    }
    if (parts.tanks) for (const z of [-0.3, 0.3]) add(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 10).rotateZ(Math.PI / 2), lam('#d0d0d0'), 0.06, -0.08, z);
    if (parts.winglets) for (const z of [-span / 2, span / 2]) add(box(0.16, 0.1, 0.012), mw, 0.04, 0.02, z);
    add(trap(0.17, -0.05, 0.12, -0.02, span / 2, 0.028), mw, 0, -0.03, 0);
    add(trap(0.17, -0.05, 0.12, -0.02, -span / 2, 0.028), mw, 0, -0.03, 0);
    for (const z of [-span / 2, span / 2]) add(box(0.12, 0.03, 0.04), lam(z < 0 ? '#e63946' : '#2fbf4a', { emissive: z < 0 ? '#600' : '#060' }), 0.08, -0.03, z);
    add(cyl(0.004, 0.004, 0.1, 4), mm, 0.22, -0.035, span * 0.4); // pitot tube
    if (M.mil) { roundel(0.05, -0.012, span * 0.33); roundel(0.05, -0.012, -span * 0.33); }
    if (M.bi) {
      add(box(0.22, 0.025, 1.15), mw, 0.08, 0.2, 0);
      for (const z of [-0.4, 0.4]) for (const x of [0.0, 0.14]) add(box(0.015, 0.22, 0.015), md, x, 0.09, z);
      for (const z of [-0.4, 0.4]) add(box(0.003, 0.3, 0.003), md, 0.07, 0.09, z, 0.6, 0, 0); // bracing wires
    }
    if (parts.tail) {
      add(box(0.17, 0.22, 0.02), mw, -0.42, 0.12, 0, 0, 0, 0.35);
      add(box(0.05, 0.12, 0.022), mr, -0.47, 0.16, 0, 0, 0, 0.35); // rudder stripe
      add(trap(-0.38, -0.5, -0.44, -0.51, 0.22, 0.02), mw, 0, 0, 0);
      add(trap(-0.38, -0.5, -0.44, -0.51, -0.22, 0.02), mw, 0, 0, 0);
    }
    if (M.floats) for (const z of [-0.2, 0.2]) {
      add(box(0.5, 0.06, 0.07), lam('#e8e8e8'), 0.03, -0.24, z);
      add(new THREE.ConeGeometry(0.035, 0.1, 8).rotateZ(-Math.PI / 2), lam('#e8e8e8'), 0.33, -0.235, z);
      add(box(0.02, 0.2, 0.02), md, 0.05, -0.13, z); add(box(0.02, 0.2, 0.02), md, -0.12, -0.13, z);
    }
    if (M.prop && !parts.engine) add(new THREE.SphereGeometry(0.075, 10, 8), mb, 0.49, 0, 0);
    else if (M.prop) add(new THREE.ConeGeometry(0.05, 0.09, 12).rotateZ(-Math.PI / 2), M.mil ? lam('#e94b3c') : md, 0.53, 0, 0); // spinner
    if (!M.prop) nozzles.push([-0.5, 0, 0]);
  } else if (st === 'gunship') {
    add(cyl(0.05, 0.09, 0.4), mb, 0.28, 0, 0); add(cyl(0.09, 0.05, 0.6), mb, -0.22, 0, 0);
    add(cyl(0.006, 0.006, 0.14, 6), md, 0.52, -0.03, 0); // nose cannon
    if (parts.cockpit) add(new THREE.SphereGeometry(0.065, 12, 8), mg, 0.25, 0.07, 0).scale.set(1.6, 0.8, 0.9);
    add(trap(0.12, -0.08, 0.07, -0.05, 0.62, 0.035), mw, 0, -0.02, 0); add(trap(0.12, -0.08, 0.07, -0.05, -0.62, 0.035), mw, 0, -0.02, 0);
    for (const z of [-0.13, 0.13]) {
      add(cyl(0.06, 0.055, 0.22), lam('#5d6a5c'), -0.27, 0.1, z); add(cyl(0.045, 0.045, 0.005), md, -0.159, 0.1, z);
      add(box(0.1, 0.05, 0.02), mb, -0.25, 0.05, z); nozzles.push([-0.39, 0.1, z]);
    }
    add(trap(-0.4, -0.52, -0.45, -0.53, 0.22, 0.02), mw, 0, 0.02, 0); add(trap(-0.4, -0.52, -0.45, -0.53, -0.22, 0.02), mw, 0, 0.02, 0);
    for (const z of [-0.22, 0.22]) add(box(0.12, 0.18, 0.02), mw, -0.47, 0.08, z);
    for (const z of [-0.32, -0.42, 0.32, 0.42]) add(box(0.08, 0.04, 0.03), md, 0.02, -0.06, z); // bomb racks
    roundel(0.0, 0.0, 0.45); roundel(0.0, 0.0, -0.45);
    if (parts.wheels) for (const z of [-0.2, 0.2]) add(box(0.08, 0.05, 0.05), md, 0.06, -0.05, z);
  } else if (st === 'fighter' || st === 'swing' || st === 'deltaJet' || st === 'shuttle') {
    const long = st === 'swing' ? 1.1 : 1;
    add(cyl(0.008, 0.075, 0.5 * long), mb, 0.27 * long, 0, 0); add(cyl(0.075, 0.065, 0.55), mb, -0.24, 0, 0);
    if (parts.cockpit) { add(new THREE.SphereGeometry(0.06, 14, 8), mg, 0.24, 0.06, 0).scale.set(2.2, 0.85, 0.9); }
    if (st === 'fighter') {
      for (const z of [-0.09, 0.09]) { add(box(0.22, 0.08, 0.05), mb, 0.04, -0.02, z); add(box(0.005, 0.07, 0.045), md, 0.151, -0.02, z); }
      add(trap(0.12, -0.25, -0.2, -0.32, 0.48, 0.022), mw, 0, -0.02, 0); add(trap(0.12, -0.25, -0.2, -0.32, -0.48, 0.022), mw, 0, -0.02, 0);
      for (const z of [-0.08, 0.08]) add(box(0.16, 0.18, 0.015), mw, -0.4, 0.12, z, z < 0 ? -0.35 : 0.35, 0, 0.45); // canted twin tails
      add(trap(-0.38, -0.5, -0.46, -0.53, 0.22, 0.015), mw, 0, -0.01, 0); add(trap(-0.38, -0.5, -0.46, -0.53, -0.22, 0.015), mw, 0, -0.01, 0);
      missile(0.3); missile(-0.3); missile(0.42); missile(-0.42);
      for (const z of [-0.04, 0.04]) nozzles.push([-0.52, 0, z]);
    } else if (st === 'swing') {
      add(trap(0.1, -0.05, 0.02, -0.08, 0.16, 0.03), mb, 0, 0.01, 0); add(trap(0.1, -0.05, 0.02, -0.08, -0.16, 0.03), mb, 0, 0.01, 0); // wing glove
      add(trap(0.03, -0.12, -0.3, -0.38, 0.5, 0.02), mw, 0, 0.01, 0); add(trap(0.03, -0.12, -0.3, -0.38, -0.5, 0.02), mw, 0, 0.01, 0);
      add(box(0.22, 0.26, 0.018), mw, -0.42, 0.15, 0, 0, 0, 0.5);
      add(trap(-0.38, -0.5, -0.47, -0.53, 0.24, 0.015), mw, 0, 0, 0); add(trap(-0.38, -0.5, -0.47, -0.53, -0.24, 0.015), mw, 0, 0, 0);
      for (const z of [-0.035, 0.035]) nozzles.push([-0.52, 0, z]);
      missile(0.12); missile(-0.12);
    } else { // delta interceptor / shuttle
      add(trap(0.18, -0.45, -0.38, -0.47, 0.45, 0.025), mw, 0, -0.03, 0); add(trap(0.18, -0.45, -0.38, -0.47, -0.45, 0.025), mw, 0, -0.03, 0);
      add(box(0.24, 0.26, 0.018), mw, -0.4, 0.14, 0, 0, 0, 0.6);
      if (st === 'deltaJet') {
        add(trap(0.32, 0.22, 0.26, 0.2, 0.14, 0.012), mw, 0, 0.01, 0); add(trap(0.32, 0.22, 0.26, 0.2, -0.14, 0.012), mw, 0, 0.01, 0); // canards
        add(box(0.24, 0.06, 0.1), md, 0.05, -0.07, 0); missile(0.24); missile(-0.24);
        roundel(-0.2, -0.015, 0.25); roundel(-0.2, -0.015, -0.25);
      } else {
        add(box(0.7, 0.02, 0.16), md, -0.05, -0.075, 0); // heat-shield belly
        for (const z of [-0.05, 0.05]) add(cyl(0.035, 0.045, 0.06), md, -0.52, 0.04, z);
      }
      nozzles.push([-0.52, 0, 0]);
    }
    if (M.mil && st === 'fighter') { roundel(-0.12, -0.007, 0.3); roundel(-0.12, -0.007, -0.3); }
  } else if (st === 'stealth') {
    const body = new THREE.ConeGeometry(0.13, 1.0, 4).rotateY(Math.PI / 4).rotateZ(-Math.PI / 2); body.scale(1, 0.45, 1);
    add(body, mb, 0.02, 0, 0);
    if (parts.cockpit) add(new THREE.OctahedronGeometry(0.07, 0), mg, 0.2, 0.045, 0).scale.set(1.8, 0.5, 0.7);
    add(trap(0.18, -0.36, -0.28, -0.4, 0.45, 0.02), mw, 0, -0.005, 0); add(trap(0.18, -0.36, -0.28, -0.4, -0.45, 0.02), mw, 0, -0.005, 0);
    for (const z of [-0.1, 0.1]) add(box(0.17, 0.16, 0.012), mw, -0.36, 0.08, z, z < 0 ? -0.55 : 0.55, 0, 0.5);
    for (const z of [-0.07, 0.07]) { add(box(0.12, 0.04, 0.05), md, 0.06, 0.03, z); nozzles.push([-0.45, 0.01, z]); }
    add(box(0.3, 0.005, 0.02), lam('#555a66'), -0.1, 0.03, 0); // panel seam
  } else if (st === 'flyingwing') {
    add(new THREE.SphereGeometry(1, 16, 10), mb, 0.05, 0.01, 0).scale.set(0.34, 0.075, 0.2);
    add(trap(0.36, -0.22, -0.13, -0.28, 0.8, 0.045), mw, 0, -0.005, 0); add(trap(0.36, -0.22, -0.13, -0.28, -0.8, 0.045), mw, 0, -0.005, 0);
    for (const z of [0.22, -0.22]) add(trap(-0.12, -0.36, -0.17, -0.3, z * 1.0, 0.03), mw, 0, -0.005, z > 0 ? 0.18 : -0.18); // sawtooth trailing edge
    for (const z of [0.5, -0.5]) add(trap(-0.15, -0.3, -0.17, -0.27, z > 0 ? 0.14 : -0.14, 0.025), mw, 0, -0.005, z);
    if (parts.cockpit) for (const z of [-0.04, 0.04]) add(box(0.06, 0.02, 0.05), mg, 0.24, 0.05, z, 0, 0, -0.35);
    for (const z of [-0.14, 0.14]) { add(box(0.18, 0.035, 0.09), mb, -0.02, 0.05, z); add(box(0.005, 0.02, 0.08), md, 0.071, 0.06, z); nozzles.push([-0.27, 0.03, z]); }
  } else if (st === 'spy') {
    add(cyl(0.005, 0.055, 0.6), mb, 0.2, 0, 0); add(cyl(0.055, 0.04, 0.45), mb, -0.32, 0, 0);
    add(trap(0.48, -0.1, -0.1, -0.15, 0.09, 0.012), mb, 0, 0, 0); add(trap(0.48, -0.1, -0.1, -0.15, -0.09, 0.012), mb, 0, 0, 0); // chines
    if (parts.cockpit) add(new THREE.SphereGeometry(0.04, 12, 8), mg, 0.22, 0.04, 0).scale.set(2.5, 0.8, 0.9);
    add(trap(0.0, -0.45, -0.35, -0.46, 0.4, 0.015), mw, 0, -0.01, 0); add(trap(0.0, -0.45, -0.35, -0.46, -0.4, 0.015), mw, 0, -0.01, 0);
    for (const z of [-0.22, 0.22]) {
      add(cyl(0.05, 0.052, 0.55), mb, -0.15, 0, z);
      add(new THREE.ConeGeometry(0.03, 0.12, 10).rotateZ(-Math.PI / 2), mm, 0.17, 0, z); // inlet spike
      add(box(0.15, 0.13, 0.012), mw, -0.36, 0.08, z, z < 0 ? -0.25 : 0.25, 0, 0.45);
      nozzles.push([-0.43, 0, z]);
    }
    add(box(0.25, 0.004, 0.02), lam('#c0392b'), 0.05, 0.05, 0);
  }

  if (st === 'fswept') {
    add(cyl(0.008, 0.075, 0.5), mb, 0.27, 0, 0); add(cyl(0.075, 0.065, 0.55), mb, -0.24, 0, 0);
    if (parts.cockpit) add(new THREE.SphereGeometry(0.06, 14, 8), mg, 0.24, 0.06, 0).scale.set(2.2, 0.85, 0.9);
    add(trap(-0.05, -0.25, 0.12, 0.0, 0.5, 0.022), mw, 0, -0.02, 0); add(trap(-0.05, -0.25, 0.12, 0.0, -0.5, 0.022), mw, 0, -0.02, 0); // forward sweep
    add(trap(0.34, 0.24, 0.28, 0.22, 0.16, 0.012), mw, 0, 0.01, 0); add(trap(0.34, 0.24, 0.28, 0.22, -0.16, 0.012), mw, 0, 0.01, 0); // canards
    for (const z of [-0.08, 0.08]) add(box(0.16, 0.17, 0.015), mw, -0.42, 0.11, z, z < 0 ? -0.3 : 0.3, 0, 0.45);
    for (const z of [-0.1, 0.1]) add(box(0.2, 0.07, 0.05), md, 0.05, -0.03, z);
    nozzles.push([-0.52, 0, 0]);
  } else if (st === 'plasma') {
    const glow = lam(M.glow, { emissive: M.glow });
    add(cyl(0.004, 0.06, 0.6), mb, 0.22, 0, 0); add(cyl(0.06, 0.05, 0.5), mb, -0.3, 0, 0);
    if (parts.cockpit) add(new THREE.SphereGeometry(0.05, 14, 8), mg, 0.22, 0.045, 0).scale.set(2.6, 0.8, 0.9);
    add(trap(0.12, -0.5, -0.4, -0.52, 0.42, 0.02), mw, 0, -0.02, 0); add(trap(0.12, -0.5, -0.4, -0.52, -0.42, 0.02), mw, 0, -0.02, 0);
    for (const z of [-1, 1]) {
      add(box(0.62, 0.008, 0.012), glow, -0.12, -0.006, z * 0.21, 0, z * 0.68, 0); // glowing leading-edge strips
      add(box(0.5, 0.012, 0.006), glow, 0.05, 0.0, z * 0.061);
      add(box(0.14, 0.16, 0.012), mw, -0.44, 0.09, z * 0.12, z * 0.4, 0, 0.6);
    }
    add(new THREE.TorusGeometry(0.05, 0.012, 6, 16).rotateY(Math.PI / 2), glow, -0.54, 0, 0);
    nozzles.push([-0.55, 0, 0]);
  } else if (st === 'ringwing') {
    const glow = lam(M.glow, { emissive: '#4a3a00' });
    add(cyl(0.01, 0.07, 0.55), mb, 0.24, 0, 0); add(cyl(0.07, 0.05, 0.5), mb, -0.28, 0, 0);
    if (parts.cockpit) add(new THREE.SphereGeometry(0.055, 14, 8), mg, 0.22, 0.05, 0).scale.set(2.2, 0.85, 0.9);
    add(new THREE.TorusGeometry(0.42, 0.028, 8, 36).rotateY(Math.PI / 2), mw, -0.3, 0, 0).scale.set(4, 1, 1); // the ring wing
    add(new THREE.TorusGeometry(0.42, 0.008, 6, 36).rotateY(Math.PI / 2), glow, -0.25, 0, 0);
    for (const a of [0, 1, 2, 3]) { const an = a * Math.PI / 2 + Math.PI / 4; add(box(0.12, 0.38, 0.015), mw, -0.3, Math.sin(an) * 0.21, Math.cos(an) * 0.21, an, 0, 0); } // struts
    add(trap(0.12, -0.04, 0.06, -0.02, 0.18, 0.015), mw, 0, -0.01, 0); add(trap(0.12, -0.04, 0.06, -0.02, -0.18, 0.015), mw, 0, -0.01, 0);
    nozzles.push([-0.53, 0, 0]);
  } else if (st === 'dragonfly') {
    const glow = lam(M.glow, { emissive: M.glow });
    const film = lam(M.wing, { transparent: true, opacity: 0.6, emissive: '#2a1a4a', side: THREE.DoubleSide });
    add(cyl(0.03, 0.055, 0.35), mb, 0.28, 0, 0); add(cyl(0.055, 0.03, 0.3), mb, -0.02, 0, 0);
    for (let i = 0; i < 4; i++) add(new THREE.SphereGeometry(0.035 - i * 0.005, 10, 8), mb, -0.2 - i * 0.075, 0.01, 0); // segmented tail
    for (const z of [-0.035, 0.035]) add(new THREE.SphereGeometry(0.03, 10, 8), glow, 0.44, 0.02, z); // glowing eyes
    for (const [x, sp] of [[0.12, 0.62], [-0.08, 0.56]]) {
      add(trap(x + 0.06, x - 0.06, x + 0.02, x - 0.08, sp, 0.008, 0.03), film, 0, 0.02, 0);
      add(trap(x + 0.06, x - 0.06, x + 0.02, x - 0.08, -sp, 0.008, 0.03), film, 0, 0.02, 0);
      for (const z of [-1, 1]) add(box(0.004, 0.006, sp), glow, x + 0.04, 0.03, z * sp / 2); // glowing wing veins
    }
    nozzles.push([-0.5, 0.01, 0]);
  }

  // ---- decals
  const FR = { classic: 0.1, gunship: 0.09, spy: 0.055, dragonfly: 0.055, stealth: 0.06, flyingwing: 0.12 }[st] || 0.075;
  const DECALS = {
    stripes: () => { add(box(0.85, 0.006, 0.025), lam('#ffffff'), -0.02, FR, 0.018); add(box(0.85, 0.006, 0.025), lam('#e63946'), -0.02, FR, -0.018); },
    shark: () => {
      for (const z of [-1, 1]) {
        add(box(0.12, 0.035, 0.004), lam('#c0392b'), 0.38, -0.025, z * FR * 0.92, 0, z * 0.2, 0);
        for (let i = 0; i < 5; i++) add(new THREE.ConeGeometry(0.007, 0.022, 3), lam('#ffffff'), 0.33 + i * 0.024, -0.012, z * FR * 0.94, Math.PI, 0, 0);
        add(new THREE.SphereGeometry(0.012, 8, 6), lam('#1b1b1b'), 0.4, 0.03, z * FR * 0.85);
      }
    },
    flames: () => {
      for (const z of [-1, 1]) for (let i = 0; i < 3; i++) {
        const c = i === 1 ? '#ffd23a' : '#ff6a1a';
        add(new THREE.ConeGeometry(0.02, 0.22 - i * 0.05, 3).rotateZ(Math.PI / 2), lam(c, { emissive: '#3a1000' }), 0.2 - i * 0.03, -0.03 + i * 0.028, z * FR * 0.97);
      }
    },
    stars: () => {
      for (const z of [-0.3, 0.3]) add(new THREE.OctahedronGeometry(0.045, 0), lam('#ffffff'), 0.03, 0.0, z).scale.set(1, 0.15, 1);
      add(new THREE.OctahedronGeometry(0.035, 0), lam('#ffffff'), -0.3, FR * 0.6, FR * 0.95).scale.set(1, 1, 0.15);
      add(new THREE.OctahedronGeometry(0.035, 0), lam('#ffffff'), -0.3, FR * 0.6, -FR * 0.95).scale.set(1, 1, 0.15);
    },
    bolt: () => {
      for (const z of [-1, 1]) {
        const c = lam('#ffe14d', { emissive: '#4a3a00' });
        add(box(0.16, 0.014, 0.004), c, 0.12, 0.02, z * FR * 0.97, 0, 0, -0.5);
        add(box(0.12, 0.014, 0.004), c, 0.03, 0.0, z * FR * 0.97, 0, 0, 0.5);
        add(box(0.16, 0.014, 0.004), c, -0.06, -0.02, z * FR * 0.97, 0, 0, -0.5);
      }
    },
    checker: () => {
      for (const z of [-1, 1]) for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++)
        add(box(0.035, 0.035, 0.004), lam((i + j) % 2 ? '#ffffff' : '#1b1b1b'), -0.28 - i * 0.035, -0.017 + j * 0.035, z * FR * 0.8);
    },
  };
  if (decal && DECALS[decal]) DECALS[decal]();
  // a snapped-off wing: drop every part that sits outboard on that side
  if (parts.lostWing) {
    const bb = new THREE.Box3(), c = new THREE.Vector3();
    for (const ch of g.children.slice()) {
      if (!ch.isMesh) continue;
      ch.updateMatrix(); ch.geometry.computeBoundingBox();
      bb.copy(ch.geometry.boundingBox).applyMatrix4(ch.matrix); bb.getCenter(c);
      if (c.z * parts.lostWing > 0.18) g.remove(ch);
    }
  }

  // merge all static parts that share a material into one mesh: ~8 draw calls per plane instead of 40+
  const byMat = new Map();
  for (const ch of g.children.slice()) if (ch.isMesh) { ch.updateMatrix(); const l = byMat.get(ch.material) || []; l.push(ch); byMat.set(ch.material, l); }
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const geo = merge(list.map((m) => [m.geometry, m.matrix]));
    for (const m of list) { g.remove(m); m.geometry.dispose(); }
    g.add(new THREE.Mesh(geo, mat));
  }
  prop = null;
  if (M.prop && parts.engine) {
    prop = new THREE.Group(); prop.position.set(0.53, 0, 0);
    const blade = new THREE.Mesh(box(0.015, 0.52, 0.05), md);
    for (const y of [-0.24, 0.24]) { const tip = new THREE.Mesh(box(0.017, 0.04, 0.052), lam('#ffcf3a')); tip.position.set(0, y, 0); blade.add(tip); }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.27, 18).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    prop.add(blade, disc); g.add(prop);
  }
  jetFlame = null; rocketFlame = new THREE.Group(); g.add(rocketFlame);
  if (nozzles.length) {
    jetFlame = new THREE.Group(); g.add(jetFlame);
    const jm = new THREE.MeshBasicMaterial({ color: '#7fd0ff', transparent: true, opacity: 0.85 });
    for (const [x, y, z] of nozzles) {
      add(cyl(0.035, 0.04, 0.04), md, x + 0.01, y, z);
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.2, 8).rotateZ(Math.PI / 2), jm); f.position.set(x - 0.11, y, z); jetFlame.add(f);
    }
  }
  const rm = new THREE.MeshBasicMaterial({ color: '#ffb43a', transparent: true, opacity: 0.9 });
  for (const [x, y, z] of nozzles.length ? nozzles : [[-0.5, 0, 0]]) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.45, 8).rotateZ(Math.PI / 2), rm); f.position.set(x - 0.24, y, z); rocketFlame.add(f); }
  g.scale.setScalar(len);
  planeGroup = g;
  scene.add(g);
  // ghost of your best run: same shape, see-through
  if (ghost) scene.remove(ghost);
  ghost = g.clone();
  const gm = new THREE.MeshBasicMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.35, depthWrite: false });
  ghost.traverse((o) => { if (o.isMesh) o.material = gm; });
  ghost.visible = false;
  scene.add(ghost);
}

// ----------------------------------------------------------------- slingshot looks
// Built in units of the fork height L (forkY 0.62, tips at y 1.18, z +-0.68), scaled each frame.
const SLING_LOOK = [
  { wood: '#7a4e28', band: '#2b1a0e' }, { wood: '#8a5a30', band: '#3a2412' }, { wood: '#6b4428', band: '#1b1b1b' },
  { wood: '#4a3020', band: '#222222' }, { wood: '#8a6a3a', band: '#3a2a1a', metal: true }, { wood: '#d9a92a', band: '#7a1f3a', gold: true },
  { wood: '#2a2f45', band: '#38e0ff', glow: '#38e0ff' }, { wood: '#2a1a3a', band: '#ff4fd8', glow: '#ff4fd8' },
];
export function setSling(tier) {
  if (tier === slingTierBuilt) return;
  slingTierBuilt = tier;
  while (slingDeco.children.length) slingDeco.remove(slingDeco.children[0]);
  slingAnim = [];
  const look = SLING_LOOK[tier];
  site.userData.wood.color.set(look.wood);
  site.userData.wood.emissive.set(look.gold ? '#3a2a00' : '#000000');
  site.userData.band.color.set(look.band);
  site.userData.band.emissive.set(look.glow || '#000000');
  const mats = new Map();
  const mat = (c, e) => { const k = c + JSON.stringify(e || {}); let m = mats.get(k); if (!m) { m = lam(c, e); mats.set(k, m); } return m; };
  const live = (m) => { m.userData.live = true; return m; }; // animated: keep as its own mesh
  const D = (geo, color, x, y, z, rx, ry, rz, extra) => { const m = new THREE.Mesh(geo, mat(color, extra)); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, rz || 0); slingDeco.add(m); return m; };
  const armPt = (f, side) => [0, 0.56 + (1.18 - 0.56) * f, side * 0.68 * f]; // along an arm, f 0..1
  const ring = (r, t, color, x, y, z, rx, extra) => D(new THREE.TorusGeometry(r, t, 6, 16), color, x, y, z, rx || Math.PI / 2, 0, 0, extra);
  // base platform
  if (tier >= 1) for (let i = 0; i < 7; i++) { const a = i / 7 * 6.283; D(new THREE.IcosahedronGeometry(0.09, 0), '#8a8f96', Math.cos(a) * 0.2, 0.04, Math.sin(a) * 0.2, a, a, 0); }
  if (tier >= 2) D(new THREE.CylinderGeometry(0.32, 0.36, 0.08, tier >= 5 ? 16 : 8), tier >= 5 ? '#efe6d8' : tier >= 4 ? '#5a5f66' : '#7a5530', 0, 0.04, 0);
  if (tier >= 5) ring(0.34, 0.015, '#ffcf3a', 0, 0.085, 0, Math.PI / 2, { emissive: '#4a3000' });
  // wraps along the arms and trunk
  if (tier >= 1) {
    const c = tier >= 4 ? (tier >= 5 ? '#ffcf3a' : '#b87333') : tier >= 2 ? '#3a3a3a' : '#d8c08a';
    ring(0.07, 0.022, c, 0, 0.3, 0);
    for (const side of [-1, 1]) for (const f of [0.35, 0.75]) { const [x, y, z] = armPt(f, side); ring(0.06, 0.02, c, x, y, z, Math.PI / 2 - side * 0.84); }
  }
  // tip caps
  for (const side of [-1, 1]) {
    const [x, y, z] = armPt(1, side);
    if (tier >= 3 && tier < 5) D(new THREE.ConeGeometry(0.06, 0.18, 6), tier >= 4 ? '#c0c0c0' : '#9aa0a6', x, y + 0.1, z);
    if (tier === 5) D(new THREE.OctahedronGeometry(0.08, 0), side > 0 ? '#e63946' : '#3f8ff5', x, y + 0.1, z, 0, 0, 0, { emissive: side > 0 ? '#500' : '#012a60' });
    if (tier >= 6) { const cr = live(D(new THREE.OctahedronGeometry(0.09, 0), look.glow, x, y + 0.18, z, 0, 0, 0, { emissive: look.glow })); slingAnim.push((t) => { cr.rotation.y = t * 2; cr.position.y = y + 0.18 + Math.sin(t * 2 + side) * 0.04; }); }
  }
  // spikes around the base and arms
  if (tier >= 3 && tier < 6) for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283 + 0.3; D(new THREE.ConeGeometry(0.03, 0.14, 5), '#c8c8c8', Math.cos(a) * 0.3, 0.12, Math.sin(a) * 0.3, Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5); }
  if (tier === 3 || tier === 5) { // banner flag
    const [x, y, z] = armPt(0.85, -1);
    D(new THREE.CylinderGeometry(0.008, 0.008, 0.4, 5), '#3a2a1a', x, y + 0.25, z);
    const flag = live(D(new THREE.BoxGeometry(0.004, 0.13, 0.2), tier === 5 ? '#7a1f3a' : '#c0392b', x, y + 0.36, z - 0.1));
    slingAnim.push((t) => { flag.rotation.x = Math.sin(t * 3) * 0.15; });
  }
  // steampunk: pistons + spinning gears
  if (tier === 4) {
    for (const side of [-1, 1]) { const [x, y, z] = armPt(0.5, side); D(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), '#9aa3ad', x + 0.06, y, z, side * 0.84, 0, 0); }
    for (const [y, z, r] of [[0.32, 0.1, 0.09], [0.42, -0.12, 0.07]]) {
      const gear = new THREE.Group(); gear.position.set(0.07, y, z);
      gear.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.02, 12).rotateZ(Math.PI / 2), lam('#b87333')));
      for (let i = 0; i < 8; i++) { const tth = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.03), lam('#b87333')); const a = i / 8 * 6.283; tth.position.set(0, Math.cos(a) * r, Math.sin(a) * r); gear.add(tth); }
      slingDeco.add(gear); slingAnim.push((t) => { gear.rotation.x = t * (r > 0.08 ? 1.5 : -2.1); });
    }
  }
  // energy rune ring + floating rings and rocks for the top tiers
  if (tier >= 6) {
    const rune = live(ring(0.42, 0.012, look.glow, 0, 0.02, 0, Math.PI / 2, { emissive: look.glow }));
    slingAnim.push((t) => { rune.rotation.z = t * 0.5; });
  }
  if (tier === 7) {
    for (const [r, sp, tilt] of [[0.55, 1.2, 0.3], [0.7, -0.8, -0.4]]) {
      const rg = live(ring(r, 0.018, look.glow, 0, 0.9, 0, Math.PI / 2 + tilt, { emissive: look.glow }));
      slingAnim.push((t) => { rg.rotation.z = t * sp; });
    }
    for (let i = 0; i < 4; i++) {
      const rock = live(D(new THREE.IcosahedronGeometry(0.06, 0), '#4a3a5a', 0, 0, 0));
      slingAnim.push((t) => { const a = t * 0.8 + i * 1.57; rock.position.set(Math.cos(a) * 0.5, 0.5 + Math.sin(t * 1.3 + i) * 0.1, Math.sin(a) * 0.5); rock.rotation.set(t, t * 1.3, 0); });
    }
  }
  // merge the static decoration by material so a fancy slingshot is still only a few draw calls
  const byMat = new Map();
  for (const ch of slingDeco.children.slice()) if (ch.isMesh && !ch.userData.live) { ch.updateMatrix(); const l = byMat.get(ch.material) || []; l.push(ch); byMat.set(ch.material, l); }
  for (const [m, list] of byMat) {
    if (list.length < 2) continue;
    const geo = merge(list.map((o) => [o.geometry, o.matrix]));
    for (const o of list) { slingDeco.remove(o); o.geometry.dispose(); }
    slingDeco.add(new THREE.Mesh(geo, m));
  }
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
function newCloud(x, z, sig) { const s = rnd(5, 11) * sig; return { x, y: rnd(25, 110) * sig, z: z + rnd(-180, 180) * sig, s, puffs: 3 + (Math.random() * 3 | 0) }; }
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
  shieldMesh.visible = !!v.shield && v.showPlane;
  if (shieldMesh.visible) { shieldMesh.position.set(v.px, v.py, v.pz); shieldMesh.scale.setScalar(L * (0.75 + Math.sin(v.t * 6) * 0.03)); shieldMesh.material.opacity = 0.16 + Math.sin(v.t * 4) * 0.06; }
  if (ghost) {
    ghost.visible = !!v.ghost;
    if (v.ghost) { ghost.position.set(v.ghost.x, v.ghost.y, v.ghost.z); ghost.rotation.set(0, -v.ghost.h, v.ghost.p, 'YZX'); }
  }
  planeGroup.position.set(v.px, v.py, v.pz);
  planeGroup.rotation.set(v.bank, -v.heading, v.pitch, 'YZX');
  if (prop) prop.rotation.x = v.t * (v.mode === 'hangar' ? 6 : 40);
  if (jetFlame) { jetFlame.visible = v.engineOn; const f = 0.8 + Math.sin(v.t * 60) * 0.25; for (const c of jetFlame.children) c.scale.x = f; }
  rocketFlame.visible = v.rocketOn; { const f = 0.9 + Math.sin(v.t * 50) * 0.2; for (const c of rocketFlame.children) c.scale.x = f; }
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
    slingDeco.scale.setScalar(L);
    for (const f of slingAnim) f(v.t);
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
      case 'fuel': { // fuel ring: fly through it, canister spinning inside
        const pul = 1 + Math.sin(t * 4 + e.x) * 0.05;
        pools.pring.add(e.x, e.y, e.z, e.r * pul, e.r * pul, e.r * pul, 0, colorOf('#ff4a4a'), t * 1.5);
        pools.fuel.add(e.x, e.y, e.z, 0.9 * s, 0.9 * s, 0.9 * s, t * 1.5);
        break;
      }
      case 'rfuel': { // rocket-fuel ring
        const pul = 1 + Math.sin(t * 4 + e.x) * 0.05;
        pools.pring.add(e.x, e.y, e.z, e.r * pul, e.r * pul, e.r * pul, 0, colorOf('#a24bff'), -t * 1.5);
        pools.rfuel.add(e.x, e.y - 0.4 * s, e.z, 0.9 * s, 0.9 * s, 0.9 * s, t * 2);
        pools.rfuelTip.add(e.x, e.y + 0.65 * s, e.z, 0.9 * s, 0.9 * s, 0.9 * s, t * 2);
        break;
      }
      case 'ring': pools.ring.add(e.x, e.y, e.z, e.r, e.r, e.r, 0); break;
      case 'pring': {
        const c = colorOf(PW_COL[e.pw]), pul = 1 + Math.sin(t * 5) * 0.06;
        pools.pring.add(e.x, e.y, e.z, e.r * pul, e.r * pul, e.r * pul, 0, c, t * 2);
        pools.pring.add(e.x, e.y, e.z, e.r * 0.8, e.r * 0.8, e.r * 0.8, 0, c, -t * 3);
        pools.picon.add(e.x, e.y, e.z, 1.3 * s, 1.6 * s, 1.3 * s, t * 2.5, c);
        break;
      }
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
    for (let j = 0; j < c.puffs; j++) {
      const mid = 1 - Math.abs(j - (c.puffs - 1) / 2) / c.puffs; // bigger puffs in the middle, flat-ish bottom
      pools.cloud.add(c.x + j * c.s * 0.85, c.y + mid * c.s * 0.35, c.z + ((j * 7) % 3 - 1) * c.s * 0.35, c.s * (0.7 + mid * 0.5), c.s * (0.5 + mid * 0.35), c.s * 0.8, j);
    }
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
    if (h.h > 65 * s && !BIOMES[bi].water) pools.hill.add(h.x, h.h * 0.72, h.z, h.w * 0.28, h.h * 0.28, h.w * 0.28, h.x * 0.01, colorOf(bi === 7 ? '#ff6a2a' : '#f4f8ff'));
  }
  if (v.debris) for (const d of v.debris) pools.debris.add(d.x, d.y, d.z, d.sx, d.sy, d.sz, d.ry, colorOf(d.c), d.rx, d.rz);
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
  const gsize = 1400 * s, tile = 28 * s;
  ground.scale.set(gsize, 1, gsize);
  groundTex.repeat.set(gsize / tile, gsize / tile);
  groundTex.offset.set(camera.position.x / tile + (BIOMES[bi].water ? v.t * 0.03 : 0), -camera.position.z / tile + (BIOMES[bi].water ? Math.sin(v.t * 0.7) * 0.02 : 0));
  sky.position.copy(camera.position); sky.scale.setScalar(camera.far * 0.9);
  const sd = camera.far * 0.8;
  sunDisc.position.set(camera.position.x + sd * 0.75, camera.position.y + sd * 0.42, camera.position.z - sd * 0.5);
  sunDisc.scale.setScalar(sd * 0.035); sunDisc.lookAt(camera.position);
  sunGlow.position.copy(sunDisc.position); sunGlow.scale.setScalar(sd * 0.08); sunGlow.lookAt(camera.position);
  renderer.render(scene, camera);
}
const PW_COL = { shield: '#38b6ff', magnet: '#c56bff', turbo: '#ff4a2a', feather: '#7be276', x2: '#ffd23a' };
const BALLOON_C = ['#ff5a5a', '#ffcf3a', '#5fd35a', '#3f8ff5', '#c56bff', '#ff8ad8'];

function drawObst(e, t) {
  const x = e.x, z = e.z, w = e.w, h = e.h, sd = e.seed, s = w / 4.5;
  switch (e.t) {
    case 'tree': {
      pools.trunk.add(x, 0, z, w * 0.22, h * 0.6, w * 0.22, 0);
      const c1 = col.setHSL(0.27 + sd * 0.06, 0.55, 0.3 + sd * 0.08);
      pools.canopy.add(x, h * 0.62, z, w * 1.15, h * 0.62, w * 1.15, sd * 6, c1);
      pools.canopy.add(x + w * 0.1, h * 0.86, z - w * 0.05, w * 0.75, h * 0.38, w * 0.75, sd * 9, col.setHSL(0.28 + sd * 0.06, 0.55, 0.4 + sd * 0.08));
      pools.canopy.add(x - w * 0.3, h * 0.6, z + w * 0.25, w * 0.6, h * 0.35, w * 0.6, sd * 4, col.setHSL(0.26 + sd * 0.06, 0.5, 0.28 + sd * 0.08));
      if (sd > 0.7) for (let k = 0; k < 3; k++) pools.flower.add(x + Math.cos(k * 2 + sd) * w * 0.45, h * (0.55 + k * 0.1), z + Math.sin(k * 2 + sd) * w * 0.45, w * 0.12, w * 0.12, w * 0.12, 0, colorOf('#e63946')); // apples
      break;
    }
    case 'rock':
      pools.rock.add(x, h * 0.35, z, w, h * 1.1, w * 0.9, sd * 6, colorOf(e.col), sd * 2, sd * 3);
      pools.rock.add(x + w * 0.35, h * 0.15, z + w * 0.25, w * 0.45, h * 0.5, w * 0.45, sd * 9, colorOf(e.col));
      pools.rock.add(x - w * 0.3, h * 0.1, z - w * 0.3, w * 0.3, h * 0.3, w * 0.3, sd * 5, colorOf(e.col));
      if (e.col === '#8a8f96') pools.rock.add(x, h * 0.78, z, w * 0.75, h * 0.25, w * 0.65, sd * 6, colorOf('#5f8f3a')); // moss cap
      if (e.col === '#cfe3f2') pools.rock.add(x, h * 0.8, z, w * 0.7, h * 0.22, w * 0.6, sd * 6, colorOf('#ffffff')); // snow cap
      break;
    case 'iceberg':
      pools.cone.add(x, 0, z, w, h, w * 0.85, sd * 6, colorOf('#e6f6ff'));
      pools.cone.add(x + w * 0.25, 0, z - w * 0.15, w * 0.55, h * 0.7, w * 0.5, sd * 4, colorOf('#bfe3f7'));
      pools.cone.add(x - w * 0.2, 0, z + w * 0.2, w * 0.4, h * 0.45, w * 0.4, sd * 3, colorOf('#9fd0ee'));
      pools.cyl.add(x, 0, z, w * 1.15, h * 0.04, w * 1.15, 0, colorOf('#e8f8ff')); // foam ring
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
      pools.cyl.add(x - L * 0.15, 13.2 * u, z, 2.05 * u, 0.6 * u, 2.05 * u, 0, colorOf('#ff3b3b')); // funnel stripe
      for (const zz of [-1, 1]) pools.box.add(x - L * 0.15, 6.5 * u, z + zz * 3.4 * u, 4 * u, 1.1 * u, 1.2 * u, 0, colorOf('#ff8c1a')); // lifeboats
      pools.box.add(x - L * 0.08, 5.8 * u, z, 10.2 * u, 1 * u, 6.1 * u, 0, colorOf('#2a4a9a')); // bridge windows
      pools.cyl.add(x - L * 0.3, 11.5 * u, z, 0.25 * u, 5 * u, 0.25 * u, 0, colorOf('#cccccc')); // mast
      pools.box.add(x + L * 0.25, 5 * u, z, L * 0.18, 1.5 * u, 6 * u, 0, colorOf('#8a6a3a')); // deck cargo
      break;
    }
    case 'blimp': {
      const y = e.y + Math.sin(t * 0.6 + sd * 6) * 0.15 * e.b;
      pools.ell.add(x, y, z, e.a, e.b, e.b, 0, colorOf(sd < 0.5 ? '#e8e8f0' : '#ffcf3a'));
      pools.box.add(x + e.a * 0.1, y - e.b * 1.3, z, e.a * 0.35, e.b * 0.35, e.b * 0.4, 0, colorOf('#3a3f55'));
      pools.box.add(x - e.a * 0.85, y, z, e.a * 0.25, e.b * 1.2, e.b * 0.1, 0, colorOf('#ff3b5c'));
      pools.box.add(x - e.a * 0.85, y - e.b * 0.05, z, e.a * 0.25, e.b * 0.1, e.b * 1.2, 0, colorOf('#ff3b5c'));
      pools.ell.add(x, y, z, e.a * 0.25, e.b * 1.02, e.b * 1.02, 0, colorOf(sd < 0.5 ? '#3f8ff5' : '#e63946')); // belly band
      pools.box.add(x + e.a * 0.1, y - e.b * 1.18, z, e.a * 0.3, e.b * 0.08, e.b * 0.42, 0, colorOf('#9fdcff')); // gondola windows
      pools.ell.add(x - e.a * 0.97, y, z, e.b * 0.15, e.b * 0.15, e.b * 0.15, t * 6, colorOf('#555555')); // tail prop hub
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
      pools.dome.add(x + 1.8 * u, e.y - 1.2 * u, z, 2.4 * u, 0.8 * u, 2.4 * u, 0, colorOf('#e8e8e8'), 0, -Math.PI / 2); // dish
      for (const zz of [-1, 1]) for (let k = 1; k < 5; k++) pools.box.add(x, e.y - 1.25 * u, z + zz * k * 1.7 * u, 0.22 * u, 2.5 * u, 0.08 * u, 0, colorOf('#9aa3ad')); // panel grid
      break;
    }
    case 'silo':
      pools.cyl.add(x, 0, z, w, h, w, 0, colorOf(sd < 0.5 ? '#c0392b' : '#d8d2c4'));
      pools.dome.add(x, h, z, w, w, w, 0, colorOf('#e6e6e6'));
      for (let f = 0.2; f < 0.95; f += 0.25) pools.cyl.add(x, h * f, z, w * 1.04, h * 0.025, w * 1.04, 0, colorOf('#7a7a7a')); // steel bands
      pools.box.add(x, h * 0.55, z + w * 0.5, w * 0.08, h * 0.9, w * 0.08, 0, colorOf('#5a5a5a')); // ladder
      break;
    case 'cactus': {
      const c = colorOf('#3e9b4f');
      pools.box.add(x, 0, z, w * 0.5, h, w * 0.5, sd, c);
      pools.box.add(x - w * 0.55, h * 0.35, z, w * 0.3, h * 0.35, w * 0.3, 0, c);
      pools.box.add(x - w * 0.4, h * 0.35, z, w * 0.4, w * 0.25, w * 0.3, 0, c);
      pools.box.add(x + w * 0.55, h * 0.45, z, w * 0.3, h * 0.3, w * 0.3, 0, c);
      pools.box.add(x + w * 0.4, h * 0.45, z, w * 0.4, w * 0.25, w * 0.3, 0, c);
      pools.box.add(x, 0, z, w * 0.52, h, w * 0.12, 0, colorOf('#5fbf6a')); // ribs
      pools.flower.add(x, h + w * 0.1, z, w * 0.35, w * 0.25, w * 0.35, 0, colorOf(sd < 0.5 ? '#ff5fa2' : '#ffcf3a')); // flower
      break;
    }
    case 'pillar':
      pools.box.add(x, 0, z, w, h, w * 0.9, sd * 3, col.setHSL(0.04, 0.55, 0.3 + sd * 0.08));
      pools.box.add(x, h * 0.93, z, w * 1.08, h * 0.07, w * 0.98, sd * 3, colorOf('#c96b3f'));
      break;
    case 'pine':
    case 'spire':
      if (e.t === 'pine') { // layered branches + trunk + snow tips
        pools.trunk.add(x, 0, z, w * 0.12, h * 0.25, w * 0.12, 0);
        pools.cone.add(x, h * 0.12, z, w, h * 0.45, w, sd * 6, colorOf('#2f6b4a'));
        pools.cone.add(x, h * 0.38, z, w * 0.75, h * 0.38, w * 0.75, sd * 6 + 0.4, colorOf('#357a52'));
        pools.cone.add(x, h * 0.6, z, w * 0.5, h * 0.4, w * 0.5, sd * 6 + 0.8, colorOf('#3d8a5c'));
        pools.cone.add(x, h * 0.82, z, w * 0.22, h * 0.18, w * 0.22, sd * 6, colorOf('#ffffff'));
      } else { // volcanic spire with glowing cracks
        pools.cone.add(x, 0, z, w, h, w, sd * 6, colorOf('#2a1a1a'));
        pools.cone.add(x, h * 0.72, z, w * 0.3, h * 0.28, w * 0.3, sd * 6, colorOf('#ff6a2a'));
        pools.cone.add(x + w * 0.2, 0, z + w * 0.1, w * 0.45, h * 0.4, w * 0.45, sd * 3, colorOf('#3a2222'));
        pools.flower.add(x, h * 0.35, z + w * 0.3, w * 0.12, h * 0.15, w * 0.12, 0, colorOf('#ff8a2a'));
      }
      break;
    case 'tower': {
      pools.box.add(x, 0, z, w, h, w, 0, colorOf(sd < 0.5 ? '#3c4a63' : '#56657f'));
      const bc = colorOf('#ffe08a');
      const glass = colorOf('#8fb8e0');
      pools.box.add(x, 0, z, w * 1.015, h * 0.98, w * 0.4, 0, glass);
      pools.box.add(x, 0, z, w * 0.4, h * 0.98, w * 1.015, 0, glass);
      for (let f = 0.25; f < 0.95; f += 0.22) pools.box.add(x, h * f, z, w * 1.03, h * 0.03, w * 1.03, 0, bc);
      pools.box.add(x, h, z, w * 0.7, h * 0.03, w * 0.7, 0, colorOf('#2a3346'));
      pools.box.add(x, h, z, w * 0.05, h * 0.1, w * 0.05, 0, colorOf('#ff3b3b'));
      pools.box.add(x + w * 0.2, h * 1.03, z - w * 0.15, w * 0.18, h * 0.03, w * 0.14, 0, colorOf('#9aa3ad')); // rooftop AC units
      pools.box.add(x - w * 0.18, h * 1.03, z + w * 0.12, w * 0.14, h * 0.025, w * 0.18, 0, colorOf('#9aa3ad'));
      pools.box.add(x, 0, z, w * 1.05, h * 0.06, w * 1.05, 0, colorOf('#2a3346')); // lobby
      break;
    }
    case 'barn': {
      const L = e.L, D = e.D, wh = e.wh;
      pools.box.add(x, 0, z, L, wh, D, 0, colorOf('#b8322a'));
      pools.prism.add(x, wh, z, L * 1.04, e.h - wh, D * 1.08, 0, colorOf('#4a3a34'));
      pools.box.add(x + L * 0.5, 0, z, 0.3 * e.sg, wh * 0.7, D * 0.45, 0, colorOf('#f4f1ea'));
      pools.box.add(x + L * 0.51, wh * 0.33, z, 0.3 * e.sg, wh * 0.06, D * 0.45, 0.6, colorOf('#b8322a')); // door X
      pools.box.add(x + L * 0.51, wh * 0.33, z, 0.3 * e.sg, wh * 0.06, D * 0.45, -0.6, colorOf('#b8322a'));
      pools.box.add(x, 0, z, L * 1.01, wh * 0.08, D * 1.01, 0, colorOf('#f4f1ea')); // trim
      break;
    }
    case 'buoy':
      pools.cyl.add(x, 0, z, w, h, w, 0, colorOf('#ff3b3b'));
      pools.cyl.add(x, h * 0.4, z, w * 1.03, h * 0.2, w * 1.03, 0, colorOf('#ffffff'));
      if (Math.sin(t * 4 + sd * 9) > 0) pools.flower.add(x, h + w * 0.15, z, w * 0.3, w * 0.3, w * 0.3, 0, colorOf('#ffe14d')); // blinking light
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
    fov = 62 + Math.min(20, Math.max(0, (vn - 1.2) * 7)) + (v.fovKick || 0);
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
