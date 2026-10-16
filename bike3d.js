// 3D-Sherco: laadt het model en tekent het in de opwarm-cutscene en de onderhoud-tab.
// Onderdelen zitten niet apart in het model, dus elk vertex krijgt hier een zone op basis van zijn positie.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MODEL_URL = new URL('models/sherco.glb', document.baseURI).href;

// ---- zones (wereldcoördinaten van het model: x = lengte, voor = +x, y = hoogte) ----
const box = (x0, x1, y0, y1) => ({ type: 'box', x0, x1, y0, y1 });
const tube = (pts, r, zmin = 0) => ({ type: 'tube', pts, r, zmin });
const ring = (cx, cy, r0, r1) => ({ type: 'ring', cx, cy, r0, r1 });

// Opwarmen: index = stap in de cutscene (zelfde volgorde als WARM_STAGES in de pagina)
const WARM = [
  { key: 'cyl', shape: box(-0.01, 0.105, 0.22, 0.37), dir: 'up' },
  { key: 'case', shape: box(-0.15, 0.09, 0.15, 0.29), dir: 'up' },
  { key: 'rad', shape: box(0.10, 0.21, 0.32, 0.48), dir: 'up' },
  { key: 'exh', shape: tube([[0.085, 0.335], [0.135, 0.275], [0.14, 0.19], [0.095, 0.145], [-0.05, 0.135]], 0.036) },
  { key: 'sil', shape: tube([[-0.245, 0.30], [-0.455, 0.378]], 0.058, 0.03) },
];
const WARM_PRIORITY = [4, 3, 2, 0, 1]; // demper en uitlaat winnen van het blok waar ze overlappen

// Onderhoud: bit per taak
const MAINT = {
  ketting: [tube([[-0.40, 0.175], [-0.075, 0.228]], 0.048)],
  banden: [ring(-0.394, 0.175, 0.128, 0.19), ring(0.356, 0.17, 0.128, 0.19)],
  koeling: [box(0.10, 0.21, 0.32, 0.48)],
  remmen: [ring(-0.394, 0.175, 0.0, 0.072), ring(0.356, 0.17, 0.0, 0.098), box(0.11, 0.21, 0.64, 0.73)],
  filter: [box(-0.20, -0.05, 0.36, 0.47)],
  bougie: [box(0.02, 0.10, 0.33, 0.40)],
};
const MAINT_KEYS = Object.keys(MAINT);

function segInfo(pts) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return L;
}
// geeft -1 als het punt buiten de vorm ligt, anders de vulpositie 0..1
function inShape(s, x, y, z) {
  if (s.type === 'box') {
    if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) return -1;
    return (y - s.y0) / (s.y1 - s.y0);
  }
  if (s.type === 'ring') {
    const d = Math.hypot(x - s.cx, y - s.cy);
    return d >= s.r0 && d <= s.r1 ? (d - s.r0) / (s.r1 - s.r0) : -1;
  }
  if (Math.abs(z) < s.zmin) return -1;
  const P = s.pts, L = s._L || (s._L = segInfo(P));
  let best = 1e9, bt = 0;
  for (let i = 1; i < P.length; i++) {
    const ax = P[i - 1][0], ay = P[i - 1][1], bx = P[i][0], by = P[i][1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    const d = Math.hypot(x - (ax + k * dx), y - (ay + k * dy));
    if (d < best) { best = d; bt = (L[i - 1] + k * Math.sqrt(l2)) / L[L.length - 1]; }
  }
  return best <= s.r ? bt : -1;
}

// ---- shaders ----
const HEAD = `
uniform float uMode;      // 0 = alles normaal, 1 = opwarmen, 2 = onderhoud
uniform float uActive;    // actieve opwarmstap
uniform float uFill[5];
uniform float uSelBit;
uniform float uTime;
flat varying float vWZ;
varying float vWT;
flat varying float vMZ;
bool inSel() {
  if (uMode < 0.5) return true;
  if (uMode < 1.5) return vWZ > -0.5 && vWZ < uActive + 0.5;
  return mod(floor(vMZ / uSelBit), 2.0) > 0.5;
}
`;
function patchSolid(mat) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float wz; attribute float wt; attribute float mz;
flat varying float vWZ; varying float vWT; flat varying float vMZ;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vWZ = wz; vWT = wt; vMZ = mz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + HEAD)
      .replace('#include <clipping_planes_fragment>', `if (!inSel()) discard;
#include <clipping_planes_fragment>`)
      .replace('#include <opaque_fragment>', `
if (vWZ > -0.5 && uMode < 1.5) {
  float f = uFill[int(vWZ + 0.5)];
  float filled = 1.0 - smoothstep(f - 0.035, f, vWT);
  float heat = clamp((f - vWT) * 2.5 + 0.35, 0.0, 1.0);
  float flick = 0.9 + 0.1 * sin(uTime * 9.0 + vWT * 40.0);
  float shade = 0.45 + 1.1 * clamp(dot(outgoingLight, vec3(0.3, 0.55, 0.15)), 0.0, 0.8);
  vec3 hot = mix(vec3(0.42, 0.04, 0.01), vec3(1.0, 0.36, 0.05), heat) * 0.95 * flick * shade;
  float edge = (1.0 - smoothstep(0.0, 0.025, abs(vWT - f))) * step(0.001, f) * step(f, 0.999);
  outgoingLight = mix(outgoingLight, hot, filled * 0.85) + vec3(1.0, 0.55, 0.15) * edge * 0.8;
}
if (uMode > 1.5) {
  float pulse = 0.55 + 0.45 * sin(uTime * 4.0);
  outgoingLight = mix(outgoingLight, vec3(1.0, 0.35, 0.12), 0.35 * pulse) + vec3(0.25, 0.08, 0.02) * pulse;
}
#include <opaque_fragment>`);
  };
}
const ghostMat = () => new THREE.ShaderMaterial({
  uniforms: shared,
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  vertexShader: `
attribute float wz; attribute float wt; attribute float mz;
flat varying float vWZ; varying float vWT; flat varying float vMZ;
varying vec3 vN; varying vec3 vV;
void main() {
  vWZ = wz; vWT = wt; vMZ = mz;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`,
  fragmentShader: HEAD + `
varying vec3 vN; varying vec3 vV;
void main() {
  if (uMode < 0.5 || inSel()) discard;
  float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  gl_FragColor = vec4(vec3(0.62, 0.68, 0.80), 0.035 + 0.38 * fr);
}`,
});
const shared = {
  uMode: { value: 0 }, uActive: { value: 0 }, uFill: { value: [0, 0, 0, 0, 0] }, uSelBit: { value: 1 }, uTime: { value: 0 },
};

// ---- model laden en zones berekenen (één keer) ----
let modelPromise = null;
function loadModel() {
  if (modelPromise) return modelPromise;
  modelPromise = new Promise((res, rej) => {
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(MODEL_URL, (g) => {
      g.scene.updateMatrixWorld(true);
      const meshes = [];
      g.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
      for (const m of meshes) {
        const geo = m.geometry, pos = geo.attributes.position, n = pos.count, v = new THREE.Vector3();
        const wz = new Float32Array(n), wt = new Float32Array(n), mz = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          wz[i] = -1;
          for (const k of WARM_PRIORITY) { const t = inShape(WARM[k].shape, v.x, v.y, v.z); if (t >= 0) { wz[i] = k; wt[i] = t; break; } }
          let bits = 0;
          MAINT_KEYS.forEach((key, b) => { if (MAINT[key].some((s) => inShape(s, v.x, v.y, v.z) >= 0)) bits += 2 ** b; });
          mz[i] = bits;
        }
        geo.setAttribute('wz', new THREE.BufferAttribute(wz, 1));
        geo.setAttribute('wt', new THREE.BufferAttribute(wt, 1));
        geo.setAttribute('mz', new THREE.BufferAttribute(mz, 1));
        const mat = m.material;
        if (!mat.metalnessMap) { mat.metalness = 0.3; mat.roughness = 0.55; }
        mat.envMapIntensity = 1.1;
      }
      // middelpunt en grootte per zone voor de camera
      const centers = WARM.map(() => ({ min: new THREE.Vector3(1e9, 1e9, 1e9), max: new THREE.Vector3(-1e9, -1e9, -1e9), c: 0 }));
      for (const m of meshes) {
        const pos = m.geometry.attributes.position, wz = m.geometry.attributes.wz.array, v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) if (wz[i] >= 0) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); const z = centers[wz[i]]; z.min.min(v); z.max.max(v); z.c++; }
      }
      res({ scene: g.scene, meshes, zones: centers.map((z) => ({ center: z.min.clone().add(z.max).multiplyScalar(0.5), size: z.max.clone().sub(z.min).length() })) });
    }, undefined, rej);
  });
  return modelPromise;
}

// ---- één view = renderer + scène + camera in een container ----
function shadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
function makeView(model) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x1a1410, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(1.5, 2.5, 2); scene.add(key);
  const rim = new THREE.DirectionalLight(0xff9a5a, 1.2); rim.position.set(-2, 1, -1.5); scene.add(rim);
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.7), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.set(-0.03, 0.001, 0); scene.add(sh);
  // per view een kopie die de geometrie deelt: één vaste pass en één doorzichtige pass
  for (const m of model.meshes) {
    const solid = new THREE.Mesh(m.geometry, m.material.clone()); patchSolid(solid.material);
    const ghost = new THREE.Mesh(m.geometry, ghostMat()); ghost.renderOrder = 2;
    for (const o of [solid, ghost]) { o.matrixAutoUpdate = false; o.matrix.copy(m.matrixWorld); scene.add(o); }
  }
  const camera = new THREE.PerspectiveCamera(30, 600 / 340, 0.02, 20);
  const cam = { target: new THREE.Vector3(-0.03, 0.33, 0), pos: new THREE.Vector3(1.2, 0.5, 1.5) };
  const goal = { target: cam.target.clone(), pos: cam.pos.clone() };
  let last = performance.now();
  return {
    renderer, el: renderer.domElement,
    aim(target, dist, az, el) {
      goal.target.copy(target);
      goal.pos.set(target.x + dist * Math.sin(az) * Math.cos(el), target.y + dist * Math.sin(el), target.z + dist * Math.cos(az) * Math.cos(el));
    },
    snap() { cam.target.copy(goal.target); cam.pos.copy(goal.pos); },
    render(host) {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) {
        renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      }
      const k = 1 - Math.exp(-dt * 2.6);
      cam.target.lerp(goal.target, k); cam.pos.lerp(goal.pos, k);
      camera.position.copy(cam.pos); camera.lookAt(cam.target);
      shared.uTime.value = now / 1000;
      renderer.render(scene, camera);
    },
  };
}

const FULL = { target: new THREE.Vector3(-0.03, 0.31, 0), dist: 2.05 };
const SHOTS = [ // camerahoek per opwarmstap: [azimut, elevatie, afstandsfactor]
  [0.35, 0.22, 3.2], [0.75, 0.12, 2.6], [0.15, 0.25, 3.0], [0.6, 0.1, 3.4], [-0.7, 0.2, 3.6],
];
let model = null, warmView = null, maintView = null, maintHost = null, maintRaf = 0;
const api = {
  ready: false,
  // opwarmen: wordt elke frame vanuit de timer opgeroepen
  warm(host, p, outro) {
    if (!model) return false;
    if (!warmView) warmView = makeView(model);
    if (warmView.el.parentNode !== host) { host.appendChild(warmView.el); host.classList.add('has3d'); }
    const N = WARM.length, idx = Math.min(N - 1, Math.floor(p * N)), u = p * N - idx;
    const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    shared.uFill.value = WARM.map((_, i) => (outro != null || i < idx ? 1 : i > idx ? 0 : sm((u - 0.15) / 0.85)));
    if (outro != null) {
      shared.uMode.value = 0;
      warmView.aim(FULL.target, FULL.dist, 0.55 + outro * 0.4, 0.14);
    } else {
      shared.uMode.value = 1; shared.uActive.value = idx;
      const z = model.zones[idx], s = SHOTS[idx];
      warmView.aim(z.center, Math.max(0.75, z.size * s[2]), s[0] + u * 0.25, s[1]);
    }
    warmView.render(host);
    return true;
  },
  warmReset() { if (warmView) { warmView.aim(FULL.target, FULL.dist, 0.55, 0.14); warmView.snap(); } },
  // onderhoud: eigen lus zolang de tab zichtbaar is
  maint(host, key) {
    if (!model) return false;
    if (!maintView) maintView = makeView(model);
    maintHost = host; host.appendChild(maintView.el); host.classList.add('has3d');
    const bit = 2 ** Math.max(0, MAINT_KEYS.indexOf(key));
    cancelAnimationFrame(maintRaf);
    const t0 = performance.now();
    const loop = () => {
      if (!maintHost || !maintHost.isConnected || !maintHost.offsetParent) { maintRaf = 0; return; }
      const t = (performance.now() - t0) / 1000;
      shared.uMode.value = 2; shared.uSelBit.value = bit;
      maintView.aim(FULL.target, FULL.dist * 0.95, 0.5 + Math.sin(t * 0.35) * 0.55, 0.16);
      maintView.render(maintHost);
      maintRaf = requestAnimationFrame(loop);
    };
    maintView.aim(FULL.target, FULL.dist * 0.95, 0.5, 0.16); maintView.snap();
    loop();
    return true;
  },
};
window.bike3d = api;
loadModel().then((m) => {
  model = m; api.ready = true;
  document.dispatchEvent(new Event('bike3d-ready'));
}).catch((e) => { console.warn('3D-model niet geladen, 2D blijft staan', e); });
