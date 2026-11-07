import * as THREE from 'three';

// 大气散射：瑞利（空气分子）+ 米氏（气溶胶，春天的薄霞偏重）+ 臭氧吸收（黄昏后天顶的蓝调）
// 天空亮度在 GPU 上算成一张「天空视图」查找表（太阳每移动约 0.1° 重算一次），
// 太阳光、天光、地平线雾色等少量数值在 CPU 上用同一套公式算，保证天空、雾与地面光照一致。
// 距离单位：千米。

export const ATMO = {
  Re: 6360,
  Ra: 6420,
  camH: 0.05,
  rayleigh: [5.802e-3, 13.558e-3, 33.1e-3],
  HR: 8.0,
  mie: 9.5e-3, // 标准值约 4e-3；花曇り的春霞取得偏重，天空更柔、地平线更白
  mieExt: 1.11,
  HM: 1.25,
  mieG: 0.78,
  ozone: [0.65e-3, 1.881e-3, 0.085e-3],
};

// ---------------- GLSL（查找表） ----------------
const GLSL_ATMO = /* glsl */ `
const float Re = ${ATMO.Re.toFixed(1)};
const float Ra = ${ATMO.Ra.toFixed(1)};
const vec3 bR = vec3(${ATMO.rayleigh.map((v) => v.toExponential(4)).join(', ')});
const float HR = ${ATMO.HR.toFixed(3)};
const float bM = ${ATMO.mie.toExponential(4)};
const float bMe = ${(ATMO.mie * ATMO.mieExt).toExponential(4)};
const float HM = ${ATMO.HM.toFixed(3)};
const vec3 bO = vec3(${ATMO.ozone.map((v) => v.toExponential(4)).join(', ')});
const float gM = ${ATMO.mieG.toFixed(3)};
const float PI = 3.14159265;

vec2 raySphere(vec3 ro, vec3 rd, float r){
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(-1.0);
  float s = sqrt(d);
  return vec2(-b - s, -b + s);
}
vec3 dens(float h){
  return vec3(exp(-h / HR), exp(-h / HM), max(0.0, 1.0 - abs(h - 25.0) / 15.0));
}
vec3 extinction(vec3 d){ return bR * d.x + vec3(bMe * d.y) + bO * d.z; }
vec3 sunTransmittance(vec3 p, vec3 s){
  vec2 g = raySphere(p, s, Re);
  if (g.x > 0.0) return vec3(0.0);
  float t = raySphere(p, s, Ra).y;
  vec3 od = vec3(0.0);
  const int N = 8;
  float dt = t / float(N);
  for (int i = 0; i < N; i++){
    vec3 q = p + s * (float(i) + 0.5) * dt;
    od += extinction(dens(length(q) - Re)) * dt;
  }
  return exp(-od);
}
vec3 skyRadiance(vec3 dir, vec3 sunDir){
  vec3 ro = vec3(0.0, Re + ${ATMO.camH.toFixed(3)}, 0.0);
  float tMax = raySphere(ro, dir, Ra).y;
  vec2 g = raySphere(ro, dir, Re);
  if (g.x > 0.0) tMax = g.x;
  float mu = dot(dir, sunDir);
  float pR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float pM = (1.0 - gM * gM) / (4.0 * PI * pow(1.0 + gM * gM - 2.0 * gM * mu, 1.5));
  vec3 L = vec3(0.0), T = vec3(1.0);
  const int N = 24;
  float tPrev = 0.0;
  for (int i = 0; i < N; i++){
    float f = (float(i) + 1.0) / float(N);
    float t = tMax * f * f;
    float dt = t - tPrev;
    vec3 q = ro + dir * (t - dt * 0.5);
    vec3 d = dens(length(q) - Re);
    vec3 ext = extinction(d);
    vec3 Ts = sunTransmittance(q, sunDir);
    vec3 S = (bR * d.x * pR + vec3(bM * d.y * pM)) * Ts;
    vec3 Tstep = exp(-ext * dt);
    L += T * S * (1.0 - Tstep) / max(ext, vec3(1e-6));
    T *= Tstep;
    tPrev = t;
  }
  return L;
}
// 查找表参数化：u = 方位角，v = 仰角（在地平线附近更密）
vec3 lutDir(vec2 uv){
  float az = (uv.x - 0.5) * 2.0 * PI;
  float v = uv.y * 2.0 - 1.0;
  float el = sign(v) * v * v * 0.5 * PI;
  return vec3(sin(az) * cos(el), sin(el), cos(az) * cos(el));
}
`;

export const GLSL_SKY_LUT_SAMPLE = /* glsl */ `
vec2 skyLutUV(vec3 d){
  float az = atan(d.x, d.z);
  float el = asin(clamp(d.y, -1.0, 1.0));
  float v = sign(el) * sqrt(abs(el) / (0.5 * 3.14159265));
  return vec2(az / (2.0 * 3.14159265) + 0.5, v * 0.5 + 0.5);
}
`;

export class Atmosphere {
  constructor(renderer, w = 192, h = 108) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false });
    this.rt.texture.wrapS = THREE.RepeatWrapping;
    this.rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uSunDir: { value: new THREE.Vector3(0, 1, 0) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `precision highp float;\nuniform vec3 uSunDir; varying vec2 vUv;\n${GLSL_ATMO}\nvoid main(){ gl_FragColor = vec4(skyRadiance(lutDir(vUv), uSunDir), 1.0); }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.lastSun = new THREE.Vector3(0, -2, 0);
    this.dirty = true;
  }
  get texture() {
    return this.rt.texture;
  }
  // 太阳移动足够多时重算查找表（在主渲染之前调用）
  update(sunDir, force = false) {
    if (!force && !this.dirty && sunDir.dot(this.lastSun) > 0.999998) return false;
    this.lastSun.copy(sunDir);
    this.dirty = false;
    this.mat.uniforms.uSunDir.value.copy(sunDir);
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const xr = r.xr.enabled;
    r.xr.enabled = false;
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
    r.xr.enabled = xr;
    return true;
  }
}

// ---------------- CPU（少量方向） ----------------
const A = ATMO;
const bMe = A.mie * A.mieExt;

function raySphere(ox, oy, oz, dx, dy, dz, r) {
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const d = b * b - c;
  if (d < 0) return null;
  const s = Math.sqrt(d);
  return [-b - s, -b + s];
}
function densAt(h, out) {
  out[0] = Math.exp(-h / A.HR);
  out[1] = Math.exp(-h / A.HM);
  out[2] = Math.max(0, 1 - Math.abs(h - 25) / 15);
  return out;
}
const _d = [0, 0, 0];
// 从点 p 沿太阳方向到大气顶的透射率
export function transmittance(px, py, pz, s, out = [0, 0, 0], N = 8) {
  const g = raySphere(px, py, pz, s.x, s.y, s.z, A.Re);
  if (g && g[0] > 0) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  const t = raySphere(px, py, pz, s.x, s.y, s.z, A.Ra)[1];
  const dt = t / N;
  let o0 = 0, o1 = 0, o2 = 0;
  for (let i = 0; i < N; i++) {
    const k = (i + 0.5) * dt;
    const qx = px + s.x * k, qy = py + s.y * k, qz = pz + s.z * k;
    const d = densAt(Math.hypot(qx, qy, qz) - A.Re, _d);
    o0 += (A.rayleigh[0] * d[0] + bMe * d[1] + A.ozone[0] * d[2]) * dt;
    o1 += (A.rayleigh[1] * d[0] + bMe * d[1] + A.ozone[1] * d[2]) * dt;
    o2 += (A.rayleigh[2] * d[0] + bMe * d[1] + A.ozone[2] * d[2]) * dt;
  }
  out[0] = Math.exp(-o0);
  out[1] = Math.exp(-o1);
  out[2] = Math.exp(-o2);
  return out;
}
const _ts = [0, 0, 0];
export function skyRadianceCPU(dir, sun, out = [0, 0, 0], N = 16) {
  const ox = 0, oy = A.Re + A.camH, oz = 0;
  let tMax = raySphere(ox, oy, oz, dir.x, dir.y, dir.z, A.Ra)[1];
  const g = raySphere(ox, oy, oz, dir.x, dir.y, dir.z, A.Re);
  if (g && g[0] > 0) tMax = g[0];
  const mu = dir.x * sun.x + dir.y * sun.y + dir.z * sun.z;
  const pR = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const gg = A.mieG;
  const pM = (1 - gg * gg) / (4 * Math.PI * Math.pow(1 + gg * gg - 2 * gg * mu, 1.5));
  let L0 = 0, L1 = 0, L2 = 0, T0 = 1, T1 = 1, T2 = 1, tPrev = 0;
  for (let i = 0; i < N; i++) {
    const f = (i + 1) / N;
    const t = tMax * f * f;
    const dt = t - tPrev;
    const k = t - dt * 0.5;
    const qx = ox + dir.x * k, qy = oy + dir.y * k, qz = oz + dir.z * k;
    const d = densAt(Math.hypot(qx, qy, qz) - A.Re, [0, 0, 0]);
    const Ts = transmittance(qx, qy, qz, sun, _ts, 6);
    for (let c = 0; c < 3; c++) {
      const ext = A.rayleigh[c] * d[0] + bMe * d[1] + A.ozone[c] * d[2];
      const S = (A.rayleigh[c] * d[0] * pR + A.mie * d[1] * pM) * Ts[c];
      const Tst = Math.exp(-ext * dt);
      const T = c === 0 ? T0 : c === 1 ? T1 : T2;
      const add = (T * S * (1 - Tst)) / Math.max(ext, 1e-6);
      if (c === 0) { L0 += add; T0 *= Tst; } else if (c === 1) { L1 += add; T1 *= Tst; } else { L2 += add; T2 *= Tst; }
    }
    tPrev = t;
  }
  out[0] = L0;
  out[1] = L1;
  out[2] = L2;
  return out;
}

// 由太阳方向估算：地面处的太阳透射率、天空对水平面的辐照度、天顶与地平线（向阳/背阳）的天空亮度
const _v = new THREE.Vector3();
export function sampleSky(sun) {
  const T = transmittance(0, A.Re + A.camH, 0, sun, [0, 0, 0], 12);
  const az0 = Math.atan2(sun.x, sun.z);
  const L = [0, 0, 0];
  const irr = [0, 0, 0];
  let wsum = 0;
  // 余弦加权的天空辐照度：天顶 + 三圈
  const rings = [[90, 1], [55, 6], [25, 8], [6, 10]];
  for (const [elDeg, n] of rings) {
    const el = (elDeg * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const az = az0 + (i / n) * Math.PI * 2 + 0.3;
      _v.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      skyRadianceCPU(_v, sun, L, 12);
      const w = Math.sin(el) * (elDeg === 90 ? 1 : Math.cos(el) * 1.6);
      irr[0] += L[0] * w;
      irr[1] += L[1] * w;
      irr[2] += L[2] * w;
      wsum += w;
    }
  }
  for (let c = 0; c < 3; c++) irr[c] = (irr[c] / wsum) * Math.PI;
  const zen = skyRadianceCPU(_v.set(0, 1, 0), sun, [0, 0, 0], 16);
  const hz = (az, el) => skyRadianceCPU(_v.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)), sun, [0, 0, 0], 16);
  const e = 0.035;
  const toward = hz(az0, e);
  const away = hz(az0 + Math.PI, e);
  const side = hz(az0 + Math.PI / 2, e);
  const horizon = [0, 0, 0];
  for (let c = 0; c < 3; c++) horizon[c] = (toward[c] + away[c] + side[c] * 2) / 4;
  return { T, irr, zen, toward, away, side, horizon };
}
