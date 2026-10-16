// 3D-Sherco: het gedownloade model is de carrosserie, de onderdelen worden hier zelf als strakke 3D-stukken gebouwd
// en op hun echte plek in de moto gezet. Tijdens opwarmen en onderhoud wordt de Sherco doorzichtig en vullen de onderdelen zich.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MODEL_URL = new URL('models/sherco.glb', document.baseURI).href;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---- onderdelen bouwen (wereldcoördinaten: x = lengte, voor = +x, y = hoogte, +z = rechterkant) ----
// pt = vulpositie 0..1 per vertex: waar de warmte begint (0) en eindigt (1)
function prep(geo, ptFn, m) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
  const p = geo.attributes.position, pt = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) pt[i] = Math.min(1, Math.max(0, ptFn(p.getX(i), p.getY(i), p.getZ(i), geo.attributes.uv ? geo.attributes.uv.getX(i) : 0)));
  geo.setAttribute('pt', new THREE.BufferAttribute(pt, 1));
  if (m) geo.applyMatrix4(m);
  return geo;
}
const M = (pos, rot = [0, 0, 0], scl = [1, 1, 1]) => new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), V(...scl));
const merge = (list) => mergeGeometries(list, false);
const rrect = (w, h, r) => {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
};
const slab = (shape, d, bev = 0.004) => { const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: bev > 0, bevelSize: bev, bevelThickness: bev, bevelSegments: 2, curveSegments: 10 }); g.translate(0, 0, -d / 2); return g; };
// buis met variabele straal langs een curve (uitlaat met expansiekamer, slangen)
function varTube(curve, n, rad, rFn) {
  const fr = curve.computeFrenetFrames(n, false), pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, c = curve.getPointAt(t), r = rFn(t), N = fr.normals[i], B = fr.binormals[i];
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
      pos.push(c.x + r * (cs * N.x + sn * B.x), c.y + r * (cs * N.y + sn * B.y), c.z + r * (cs * N.z + sn * B.z)); uv.push(t, j / rad);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < rad; j++) { const a = i * (rad + 1) + j, b = a + rad + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
const capped = (curve, r) => [varTube(curve, 24, 10, () => r)];
function gear(r, teeth, hole) {
  const s = new THREE.Shape();
  for (let i = 0; i <= teeth * 4; i++) { const a = (i / (teeth * 4)) * Math.PI * 2, rr = i % 4 < 2 ? r : r - 0.006; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(rr, 0); }
  const h = new THREE.Path(); h.absarc(0, 0, hole, 0, Math.PI * 2, true); s.holes.push(h); return s;
}
function disc(r, hub) { // golvende Sherco-remschijf met gaatjes
  const s = new THREE.Shape(), N = 160;
  for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI * 2, rr = r * (1 - 0.045 * (0.5 + 0.5 * Math.cos(a * 12))); i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(rr, 0); }
  const h = new THREE.Path(); h.absarc(0, 0, hub, 0, Math.PI * 2, true); s.holes.push(h);
  for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2, rr = r * (i % 2 ? 0.74 : 0.84), p = new THREE.Path(); p.absarc(Math.cos(a) * rr, Math.sin(a) * rr, r * 0.045, 0, Math.PI * 2, true); s.holes.push(p); }
  return s;
}

function buildParts() {
  const P = {};
  // Cilinder: koelribben rond een kern, licht naar voor gekanteld. Warmte stijgt van onder naar boven.
  {
    const tilt = M(V(0.05, 0.235, 0), [0, 0, -0.16]), g = [];
    g.push(prep(new THREE.CylinderGeometry(0.036, 0.04, 0.13, 24).translate(0, 0.065, 0), (x, y) => y / 0.13, tilt));
    for (let i = 0; i < 9; i++) { const y = 0.012 + i * 0.0135, w = i === 8 ? 0.1 : 0.112; g.push(prep(slab(rrect(w, 0.005, 0.002), w * 0.95, 0.001).rotateX(0).translate(0, y, 0), () => y / 0.13, tilt)); }
    g.push(prep(slab(rrect(0.09, 0.022, 0.008), 0.09, 0.003).translate(0, 0.138, 0), () => 1, tilt)); // kop
    P.cyl = { geo: merge(g), color: 0x8a8d93, metal: 0.85, rough: 0.35 };
  }
  // Bougie bovenop de kop: wit porselein, zeskant en zwarte dop
  {
    const t = M(V(0.05, 0.235, 0), [0, 0, -0.16]), g = [];
    g.push(prep(new THREE.CylinderGeometry(0.009, 0.009, 0.008, 6).translate(0, 0.157, 0), () => 0, t));
    g.push(prep(new THREE.CylinderGeometry(0.0055, 0.0065, 0.026, 16).translate(0, 0.174, 0), () => 0.4, t));
    g.push(prep(new THREE.CylinderGeometry(0.011, 0.009, 0.03, 16).translate(0, 0.196, 0), () => 1, t));
    P.plug = { geo: merge(g), color: 0xe8e4dc, metal: 0.1, rough: 0.4 };
  }
  // Motorblok: carter met koppelings- en ontstekingsdeksel. Warmte loopt van de cilinder naar onder.
  {
    const s = new THREE.Shape();
    s.moveTo(-0.13, 0.15); s.quadraticCurveTo(-0.135, 0.105, -0.09, 0.1); s.lineTo(0.05, 0.1); s.quadraticCurveTo(0.1, 0.1, 0.1, 0.15);
    s.lineTo(0.09, 0.225); s.lineTo(-0.02, 0.235); s.quadraticCurveTo(-0.11, 0.235, -0.13, 0.15);
    const g = [prep(slab(s, 0.12, 0.008), (x, y) => (0.24 - y) / 0.14)];
    for (const z of [-1, 1]) {
      g.push(prep(new THREE.CylinderGeometry(0.05, 0.052, 0.018, 32).rotateX(Math.PI / 2), () => 0.5, M(V(0.005, 0.165, z * 0.072))));
      g.push(prep(new THREE.CylinderGeometry(0.02, 0.022, 0.012, 20).rotateX(Math.PI / 2), () => 0.6, M(V(0.005, 0.165, z * 0.084))));
    }
    P.case = { geo: merge(g), color: 0x55585e, metal: 0.8, rough: 0.4 };
  }
  // Radiateurs links en rechts met lamellen, plus slangen naar cilinder en blok. Heet water komt bovenaan binnen.
  {
    const g = [];
    for (const z of [-1, 1]) {
      const m = M(V(0.155, 0.4, z * 0.088), [0, z * 0.18, -0.1]);
      g.push(prep(slab(rrect(0.1, 0.14, 0.01), 0.014, 0.002), (x, y) => (0.07 - y) / 0.14, m));
      for (let i = 0; i < 9; i++) { const y = -0.06 + i * 0.015; g.push(prep(new THREE.BoxGeometry(0.094, 0.003, 0.004).translate(0, y, z * 0.009), () => (0.07 - y) / 0.14, m)); }
    }
    const hose = (pts, a, b) => { const c = new THREE.CatmullRomCurve3(pts); return prep(varTube(c, 30, 8, () => 0.0085), (x, y, z, u) => a + (b - a) * u); };
    g.push(hose([V(0.07, 0.355, 0), V(0.11, 0.43, 0.04), V(0.13, 0.455, 0.08)], 0, 0.1));
    g.push(hose([V(0.13, 0.34, -0.08), V(0.1, 0.25, -0.07), V(0.07, 0.19, -0.072)], 0.9, 1));
    P.rad = { geo: merge(g), color: 0x2b2d31, metal: 0.7, rough: 0.45 };
  }
  // Uitlaat: bocht uit de cilinder, onder het blok door en met een dikke expansiekamer naar rechts-achter
  {
    const c = new THREE.CatmullRomCurve3([V(0.085, 0.27, 0.0), V(0.14, 0.245, 0.015), V(0.155, 0.17, 0.035), V(0.11, 0.105, 0.06), V(0.0, 0.085, 0.075), V(-0.12, 0.11, 0.085), V(-0.2, 0.2, 0.08), V(-0.248, 0.292, 0.068)], false, 'centripetal');
    const r = (t) => 0.013 + 0.03 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.1) / 0.85))), 1.4);
    P.exh = { geo: prep(varTube(c, 120, 20, r), (x, y, z, u) => u), color: 0x3a3c40, metal: 0.9, rough: 0.3 };
  }
  // Demper: koker met eindkap, schuin omhoog onder het zitvlak
  {
    const a = V(-0.245, 0.3, 0.068), b = V(-0.455, 0.378, 0.068), d = b.clone().sub(a), L = d.length();
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()), V(1, 1, 1));
    const g = [prep(new THREE.CylinderGeometry(0.038, 0.034, L, 28, 1), (x, y) => 0.5 - y / L, m),
      prep(new THREE.CylinderGeometry(0.012, 0.03, 0.025, 20).translate(0, L / 2 + 0.012, 0), () => 1, m),
      prep(new THREE.CylinderGeometry(0.009, 0.009, 0.03, 12).translate(0, L / 2 + 0.035, 0), () => 1, m)];
    P.sil = { geo: merge(g), color: 0x1c1d20, metal: 0.6, rough: 0.35 };
  }
  // Ketting + tandwielen links
  {
    const R = V(-0.394, 0.175, -0.075), F = V(-0.082, 0.208, -0.075), rr = 0.052, rf = 0.022, pts = [];
    for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; pts.push([R.x + Math.cos(a) * (rr + 0.005), R.y + Math.sin(a) * (rr + 0.005)], [F.x + Math.cos(a) * (rf + 0.005), F.y + Math.sin(a) * (rf + 0.005)]); }
    pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]); // convexe schil = kettingloop
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], hi = [];
    for (const p of pts) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.slice().reverse()) { while (hi.length > 1 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    const loop = lo.slice(0, -1).concat(hi.slice(0, -1)).map((p) => V(p[0], p[1], R.z));
    const g = [prep(varTube(new THREE.CatmullRomCurve3(loop, true), 260, 6, (t) => 0.0042 + 0.0012 * (Math.sin(t * 900) > 0 ? 1 : 0)), () => 0)];
    g.push(prep(slab(gear(rr, 26, 0.02), 0.004, 0.0008), () => 0, M(R.clone().add(V(0, 0, 0.004)))));
    g.push(prep(slab(gear(rf, 11, 0.007), 0.005, 0.0008), () => 0, M(F.clone().add(V(0, 0, 0.004)))));
    P.chain = { geo: merge(g), color: 0xb08a4a, metal: 0.9, rough: 0.35 };
  }
  // Banden: platte supermoto-profielen rond de velgen
  {
    const t = (c, R, w) => prep(new THREE.TorusGeometry(R, 0.031, 18, 72), () => 0, M(c, [0, 0, 0], [1, 1, w]));
    P.tyres = { geo: merge([t(V(-0.394, 0.175, 0), 0.159, 1.75), t(V(0.356, 0.17, 0), 0.159, 1.5)]), color: 0x1a1a1c, metal: 0.0, rough: 0.85 };
  }
  // Remmen: golvende schijven, remklauwen en de pompjes aan het stuur
  {
    const g = [prep(slab(disc(0.098, 0.035), 0.004, 0.0006), () => 0, M(V(0.356, 0.17, -0.045))),
      prep(slab(disc(0.07, 0.028), 0.004, 0.0006), () => 0, M(V(-0.394, 0.175, 0.052))),
      prep(slab(rrect(0.05, 0.03, 0.008), 0.022, 0.003), () => 0, M(V(0.356 - 0.06, 0.17 + 0.065, -0.045), [0, 0, 0.9])),
      prep(slab(rrect(0.04, 0.026, 0.007), 0.02, 0.003), () => 0, M(V(-0.394 + 0.025, 0.175 - 0.06, 0.052), [0, 0, -0.4]))];
    for (const z of [-1, 1]) g.push(prep(slab(rrect(0.03, 0.022, 0.006), 0.026, 0.003), () => 0, M(V(0.165, 0.652, z * 0.15))));
    P.brakes = { geo: merge(g), color: 0x9aa0a8, metal: 0.95, rough: 0.25 };
  }
  // Luchtfilter: geplooide schuimfilter in de airbox onder het zadel
  {
    const g = new THREE.CylinderGeometry(0.036, 0.04, 0.12, 48, 6, false), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z); if (r > 0.02) { const k = 1 + 0.09 * Math.cos(Math.atan2(z, x) * 16); p.setX(i, x * k); p.setZ(i, z * k); } }
    g.computeVertexNormals();
    P.filter = { geo: merge([prep(g.rotateX(Math.PI / 2), () => 0, M(V(-0.125, 0.4, 0)))]), color: 0xd9732a, metal: 0, rough: 0.95 };
  }
  for (const k in P) { P[k].geo.computeBoundingBox(); const b = P[k].geo.boundingBox; P[k].center = b.getCenter(V()); P[k].size = b.getSize(V()).length(); }
  return P;
}

// Opwarmen: stappen in dezelfde volgorde als WARM_STAGES in de pagina
const WARM = ['cyl', 'case', 'rad', 'exh', 'sil'];
// Onderhoud: welke onderdelen per taak
const MAINT = { ketting: ['chain'], banden: ['tyres'], koeling: ['rad'], remmen: ['brakes'], filter: ['filter'], bougie: ['plug', 'cyl'] };
const MAINT_KEYS = Object.keys(MAINT);

// ---- shaders ----
const NOISE = 'float rxN() { return fract(sin(dot(floor(gl_FragCoord.xy / 3.0), vec2(12.9898, 78.233))) * 43758.5453); }\n';
const shared = { uTime: { value: 0 }, uSolid: { value: 0 } };
function partMat(def) {
  const m = new THREE.MeshStandardMaterial({ color: def.color, metalness: def.metal, roughness: def.rough, transparent: true, side: THREE.DoubleSide });
  m.userData.u = { uF: { value: 0 }, uHot: { value: 0 }, uSel: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, m.userData.u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float pt; varying float vPT;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPT = pt;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uF, uHot, uSel, uTime; varying float vPT;')
      .replace('#include <opaque_fragment>', `
if (uHot > 0.5) {
  float filled = 1.0 - smoothstep(uF - 0.03, uF, vPT);
  float heat = clamp((uF - vPT) * 2.5 + 0.35, 0.0, 1.0);
  float flick = 0.9 + 0.1 * sin(uTime * 9.0 + vPT * 40.0);
  float shade = 0.5 + 0.9 * clamp(dot(outgoingLight, vec3(0.3, 0.55, 0.15)), 0.0, 0.9);
  vec3 hot = mix(vec3(0.42, 0.04, 0.01), vec3(1.0, 0.36, 0.05), heat) * flick * shade;
  float edge = (1.0 - smoothstep(0.0, 0.03, abs(vPT - uF))) * step(0.001, uF) * step(uF, 0.999);
  outgoingLight = mix(outgoingLight, hot, filled * 0.88) + vec3(1.0, 0.55, 0.15) * edge * 0.9;
}
if (uSel > 0.0) {
  float rim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
  float pulse = 0.6 + 0.4 * sin(uTime * 3.5);
  outgoingLight += vec3(1.0, 0.38, 0.1) * (rim * 0.9 + 0.025) * pulse * uSel;
}
#include <opaque_fragment>`);
  };
  return m;
}
// Sherco zelf: vaste versie en doorzichtige versie, met een "materialiseer"-overgang tussen beide
function patchSolid(mat) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSolid;\n' + NOISE)
      .replace('#include <clipping_planes_fragment>', 'if (rxN() >= uSolid) discard;\n#include <clipping_planes_fragment>');
  };
}
const ghostMat = (src) => new THREE.ShaderMaterial({
  uniforms: { ...shared, map: { value: src.map || null }, hasMap: { value: src.map ? 1 : 0 } },
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  vertexShader: `varying vec3 vN; varying vec3 vV; varying vec2 vUv;
void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uSolid; uniform sampler2D map; uniform float hasMap; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
${NOISE}void main() {
  if (rxN() < uSolid) discard;
  float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  vec3 tex = hasMap > 0.5 ? texture2D(map, vUv).rgb : vec3(0.5);
  vec3 c = mix(vec3(0.62, 0.68, 0.80), tex * 1.3 + 0.08, 0.55);
  gl_FragColor = vec4(c, 0.05 + 0.4 * fr);
}`,
});

// ---- model laden (één keer) ----
let modelPromise = null;
function loadModel() {
  if (modelPromise) return modelPromise;
  modelPromise = new Promise((res, rej) => {
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(MODEL_URL, (g) => {
      g.scene.updateMatrixWorld(true);
      const meshes = [];
      g.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
      for (const m of meshes) { const mat = m.material; if (!mat.metalnessMap) { mat.metalness = 0.3; mat.roughness = 0.55; } mat.envMapIntensity = 1.1; }
      res({ meshes, parts: buildParts() });
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
  for (const m of model.meshes) {
    const solid = new THREE.Mesh(m.geometry, m.material.clone()); patchSolid(solid.material);
    const ghost = new THREE.Mesh(m.geometry, ghostMat(m.material)); ghost.renderOrder = 2;
    for (const o of [solid, ghost]) { o.matrixAutoUpdate = false; o.matrix.copy(m.matrixWorld); scene.add(o); }
  }
  // onderdelen: elk met eigen materiaal; zichtbaarheid vloeit zacht in en uit
  const parts = {};
  for (const k in model.parts) {
    const mesh = new THREE.Mesh(model.parts[k].geo, partMat(model.parts[k])); mesh.renderOrder = 1; scene.add(mesh);
    parts[k] = { mesh, u: mesh.material.userData.u, vis: 0, goal: 0 };
  }
  const camera = new THREE.PerspectiveCamera(30, 600 / 340, 0.02, 20);
  const cam = { target: V(-0.03, 0.33, 0), pos: V(1.2, 0.5, 1.5) };
  const goal = { target: cam.target.clone(), pos: cam.pos.clone() };
  let last = performance.now();
  return {
    renderer, el: renderer.domElement, parts, solid: 0,
    aim(target, dist, az, el) {
      goal.target.copy(target);
      goal.pos.set(target.x + dist * Math.sin(az) * Math.cos(el), target.y + dist * Math.sin(el), target.z + dist * Math.cos(az) * Math.cos(el));
    },
    snap() { cam.target.copy(goal.target); cam.pos.copy(goal.pos); for (const k in parts) parts[k].vis = parts[k].goal; },
    render(host) {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) {
        renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      }
      const k = 1 - Math.exp(-dt * 2.6), kv = 1 - Math.exp(-dt * 6);
      cam.target.lerp(goal.target, k); cam.pos.lerp(goal.pos, k);
      camera.position.copy(cam.pos); camera.lookAt(cam.target);
      for (const n in parts) { const p = parts[n]; p.vis += (p.goal - p.vis) * kv; p.mesh.material.opacity = p.vis; p.mesh.visible = p.vis > 0.01; }
      shared.uTime.value = now / 1000; shared.uSolid.value = this.solid;
      renderer.render(scene, camera);
    },
  };
}

const FULL = { target: V(-0.03, 0.31, 0), dist: 2.05 };
const SHOTS = [ // camerahoek per opwarmstap: [azimut, elevatie, afstand]
  [0.45, 0.22, 0.95], [0.8, 0.14, 1.15], [0.45, 0.2, 1.05], [0.85, 0.08, 1.35], [-0.7, 0.2, 1.2],
];
const M_SHOT = { ketting: [-0.75, 0.15, 1.0], banden: [0.55, 0.16, 1.9], koeling: [0.8, 0.15, 1.0], remmen: [-0.55, 0.15, 1.8], filter: [-0.45, 0.35, 0.95], bougie: [0.6, 0.35, 0.8] };
const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
let model = null, warmView = null, maintView = null, maintHost = null, maintRaf = 0, mKey = 'ketting';
function maintCenter(key) { const ps = MAINT[key].map((n) => model.parts[n]); return ps[0].center.clone().lerp(FULL.target, 0.25); }
const api = {
  ready: false,
  // opwarmen: wordt elke frame vanuit de timer opgeroepen
  warm(host, p, outro) {
    if (!model) return false;
    if (!warmView) warmView = makeView(model);
    if (warmView.el.parentNode !== host) { host.appendChild(warmView.el); host.classList.add('has3d'); }
    const N = WARM.length, idx = Math.min(N - 1, Math.floor(p * N)), u = p * N - idx;
    for (const n in warmView.parts) { const wp = warmView.parts[n], i = WARM.indexOf(n); wp.goal = i >= 0 ? 1 - (outro != null ? sm((outro - 0.3) / 0.5) : 0) : 0; wp.u.uHot.value = 1; wp.u.uSel.value = 0;
      wp.u.uF.value = i < 0 ? 0 : outro != null || i < idx ? 1 : i > idx ? 0 : sm((u - 0.15) / 0.85); }
    if (outro != null) {
      warmView.solid = sm((outro - 0.35) / 0.6);
      warmView.aim(FULL.target, FULL.dist, 0.55 + outro * 0.4, 0.14);
    } else {
      warmView.solid = 0;
      const z = model.parts[WARM[idx]], s = SHOTS[idx];
      warmView.aim(z.center, s[2], s[0] + u * 0.25, s[1]);
    }
    warmView.render(host);
    return true;
  },
  warmReset() { if (warmView) { warmView.aim(FULL.target, FULL.dist, 0.55, 0.14); warmView.snap(); } },
  // onderhoud: eigen lus zolang de tab zichtbaar is; wisselen draait de camera vloeiend naar het nieuwe onderdeel
  maint(host, key) {
    if (!model) return false;
    if (!maintView) maintView = makeView(model);
    if (maintView.el.parentNode !== host) { host.appendChild(maintView.el); host.classList.add('has3d'); }
    maintHost = host; mKey = MAINT[key] ? key : 'ketting';
    for (const n in maintView.parts) { const mp = maintView.parts[n]; mp.goal = MAINT[mKey].includes(n) ? 1 : 0; mp.u.uHot.value = 0; mp.u.uSel.value = n === MAINT[mKey][0] ? 1 : 0.35; }
    if (!maintRaf) {
      const s = M_SHOT[mKey]; maintView.aim(maintCenter(mKey), s[2], s[0], s[1]); maintView.snap();
      const t0 = performance.now();
      const loop = () => {
        if (!maintHost || !maintHost.isConnected || !maintHost.offsetParent) { maintRaf = 0; return; }
        const t = (performance.now() - t0) / 1000, s = M_SHOT[mKey];
        maintView.aim(maintCenter(mKey), s[2], s[0] + Math.sin(t * 0.3) * 0.18, s[1]);
        maintView.render(maintHost);
        maintRaf = requestAnimationFrame(loop);
      };
      maintRaf = requestAnimationFrame(loop);
    }
    return true;
  },
};
window.bike3d = api;
loadModel().then((m) => {
  model = m; api.ready = true;
  document.dispatchEvent(new Event('bike3d-ready'));
}).catch((e) => { console.warn('3D-model niet geladen, 2D blijft staan', e); });
