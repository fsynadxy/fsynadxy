import * as THREE from 'three';
import { U, GLSL_COMMON, SHADOW_GLSL, shadowUniforms } from '../render/shaders.js';
import { river, riverWaterLevel, riverHalfWidth, isCanal, WORLD, FIELDS, SITES } from './layout.js';
import { lakeShoreRadius } from './terrain.js';

// 水面着色：天空反射 + 菲涅尔 + 太阳高光；河面上漂着成团的花瓣（花筏）
function waterMaterial(mode) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.uTime,
      uSunDir: U.uSunDir,
      uSunColor: U.uSunColor,
      uZenith: U.uSkyZenith,
      uHorizon: U.uSkyHorizon,
      uDay: U.uDay,
      uNight: U.uNight,
      uLantern: U.uLanternColor,
      uFogColor: U.uFogColor,
      uFogSunColor: U.uFogSunColor,
      uFogDensity: U.uFogDensity,
      uFogBase: U.uFogBase,
      uFogSun: U.uSunDir,
      uMode: { value: mode },
      uCloudLit: U.uCloudLit,
      uCloudShade: U.uCloudShade,
      uCloudCover: U.uCloudCover,
      uDeep: { value: new THREE.Color(mode === 2 ? '#262b22' : '#28504d') },
      uShallow: { value: new THREE.Color(mode === 2 ? '#3d3c2c' : '#587a6c') },
      ...shadowUniforms(),
    },
    vertexShader: /* glsl */ `
      attribute vec2 aFlow; // x: across 0..1, y: along (m)
      attribute float aDepth;
      varying vec2 vFlow; varying vec3 vWorld; varying float vDepth;
      uniform float uTime;
      void main(){
        vFlow = aFlow; vDepth = aDepth;
        vec3 p = position;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      ${SHADOW_GLSL}
      uniform float uTime, uDay, uNight, uMode, uFogDensity, uFogBase;
      uniform vec3 uSunDir, uSunColor, uZenith, uHorizon, uLantern, uDeep, uShallow, uFogColor, uFogSunColor, uFogSun, uCloudLit, uCloudShade;
      uniform float uCloudCover;
      varying vec2 vFlow; varying vec3 vWorld; varying float vDepth;
      // petal: one per cell, notched teardrop
      float petalCell(vec2 p, float dens){
        vec2 c = floor(p); vec2 f = fract(p) - 0.5;
        float h = hash12(c);
        if (h > dens) return 0.0;
        float a = h * 40.0;
        mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
        vec2 q = R * (f + (vec2(hash12(c + 3.1), hash12(c + 7.7)) - 0.5) * 0.4);
        q *= vec2(1.0, 0.75);
        float d = length(q * vec2(1.0, 1.0 + q.y * 1.2)) - 0.17;
        float notch = smoothstep(0.03, 0.0, length(q - vec2(0.0, 0.2)) - 0.03);
        return smoothstep(0.02, -0.02, d) * (1.0 - notch);
      }
      void main(){
        vec3 V = normalize(cameraPosition - vWorld);
        float dist = length(cameraPosition - vWorld);
        vec2 p, flowUV;
        float flow = 0.0;
        if (uMode < 0.5) { // river
          flow = 0.55;
          flowUV = vec2(vFlow.x * 14.0, vFlow.y - uTime * flow);
          p = flowUV;
        } else {
          p = vWorld.xz;
          flowUV = p;
        }
        // ripples normal
        float calm = uMode > 1.5 ? 0.25 : 1.0;
        vec2 q1 = p * vec2(0.9, 0.55) + vec2(0.0, uTime * (uMode < 0.5 ? 0.0 : 0.05));
        vec2 q2 = p * vec2(2.3, 1.7) + vec2(uTime * 0.08, -uTime * 0.11);
        float e = 0.08;
        float h0 = vnoise(q1) * 0.6 + vnoise(q2) * 0.4;
        float hx = vnoise(q1 + vec2(e, 0.0)) * 0.6 + vnoise(q2 + vec2(e, 0.0)) * 0.4;
        float hz = vnoise(q1 + vec2(0.0, e)) * 0.6 + vnoise(q2 + vec2(0.0, e)) * 0.4;
        vec3 N = normalize(vec3((h0 - hx) * 1.6 * calm, 1.0, (h0 - hz) * 1.6 * calm));
        N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(60.0, 260.0, dist)));
        vec3 R = reflect(-V, N);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.6));
        // 贴近护岸处，倒影里是墙与树，而不是天空
        if (uMode < 0.5) {
          float edge = min(vFlow.x, 1.0 - vFlow.x);
          sky *= mix(0.42, 1.0, smoothstep(0.02, 0.32, edge) * 0.7 + smoothstep(0.0, 0.5, R.y) * 0.3);
        }
        // 湖与水田像镜子：倒影里有流云（与天空同一套噪声）和四周的群山
        if (uMode > 0.5) {
          vec2 cuv = R.xz / (max(R.y, 0.0) + 0.16);
          cuv = cuv * 0.85 + vec2(uTime * 0.0035, uTime * 0.0012);
          float cn = fbmN(cuv * 1.15) * 0.72 + fbmN(cuv * 2.9 + 5.0) * 0.28;
          float cov = smoothstep(uCloudCover, uCloudCover + 0.3, cn * 1.1) * smoothstep(0.0, 0.2, R.y) * 0.85;
          sky = mix(sky, mix(uCloudShade, uCloudLit, 0.55), cov);
          float az = atan(R.x, R.z);
          float ridge = 0.05 + 0.07 * vnoise(vec2(az * 2.3, 1.3)) + 0.035 * vnoise(vec2(az * 7.0, 4.1));
          vec3 mtn = mix(vec3(0.045, 0.07, 0.045) * (uSunColor * uDay * 0.9 + uZenith * 1.2 + 0.03), uHorizon, 0.38);
          sky = mix(mtn, sky, smoothstep(ridge - 0.012, ridge + 0.012, R.y));
        }
        float shade = sunShadow(vWorld + vec3(0.0, 0.05, 0.0), 0.0006);
        float sunSpec = (pow(max(dot(R, uSunDir), 0.0), 220.0) * 5.0 + pow(max(dot(R, uSunDir), 0.0), 18.0) * 0.25) * shade;
        vec3 body = mix(uShallow, uDeep, smoothstep(0.1, 2.5, vDepth));
        body *= (0.35 + 0.65 * uDay) * vec3(1.0) + uNight * vec3(0.02, 0.03, 0.06);
        vec3 col = mix(body, sky, fres * (uMode > 1.5 ? 0.95 : 0.8));
        col += uSunColor * sunSpec * uDay;
        // night: lantern shimmer（只在城中的河上；水田和湖边没有灯笼）
        if (uMode < 0.5) col += uLantern * uNight * 0.18 * smoothstep(0.55, 0.95, vnoise(p * 1.7 + uTime * 0.3));
        // edge foam / shore
        if (uMode < 0.5) {
          float edge = min(vFlow.x, 1.0 - vFlow.x);
          col = mix(col, col * 1.15 + 0.03, smoothstep(0.08, 0.0, edge) * 0.5);
        }
        float alpha = uMode > 1.5 ? mix(0.9, 0.99, fres) : mix(0.72, 0.97, fres) * smoothstep(0.0, 0.25, vDepth + 0.05);
        // hanaikada: drifting rafts of petals
        float petals = 0.0;
        if (uMode < 1.5) {
          vec2 rp = uMode < 0.5 ? vec2(vFlow.x * 3.2, flowUV.y * 0.11) : vWorld.xz * 0.06 + uTime * 0.004;
          float raft = smoothstep(0.52, 0.78, fbmN(rp + 3.0));
          float bankBias = uMode < 0.5 ? (0.55 + 0.45 * smoothstep(0.35, 0.05, min(vFlow.x, 1.0 - vFlow.x))) : 0.6;
          float dens = raft * bankBias;
          vec2 pp = uMode < 0.5 ? vec2(vFlow.x * 14.0, flowUV.y) * 2.4 : vWorld.xz * 2.4;
          float scatter = 0.05 + dens * 0.85;
          petals = petalCell(pp, scatter) + petalCell(pp * 1.37 + 5.3, scatter * 0.9) + petalCell(pp * 0.73 - 2.1, dens * 0.8);
          petals = clamp(petals, 0.0, 1.0) * smoothstep(80.0, 20.0, dist);
          float far = dens * smoothstep(15.0, 90.0, dist) * 0.55;
          vec3 pc = mix(vec3(1.0, 0.82, 0.86), vec3(1.0, 0.92, 0.94), hash12(floor(pp)));
          pc *= (0.55 + 0.45 * uDay) + uNight * uLantern * 0.25;
          col = mix(col, pc, max(petals, far));
          alpha = max(alpha, max(petals, far));
        }
        // fog
        vec3 fv = vWorld - cameraPosition;
        float fd = length(fv);
        float amt = 1.0 - exp(-pow(fd * uFogDensity, 1.3));
        float sa = pow(max(dot(fv / max(fd, 0.001), uFogSun), 0.0), 5.0);
        col = mix(col, mix(uFogColor, uFogSunColor, sa), amt);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

export function createWater() {
  const group = new THREE.Group();
  group.name = 'water';
  // ---------- 河 ----------
  {
    const P = river.pts, A = river.acc;
    const pos = [], flow = [], depth = [], idx = [];
    let n = 0;
    for (let i = 0; i < P.length; i++) {
      const s = A[i];
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      const hw = riverHalfWidth(s) + (isCanal(s) ? 1.1 : 2.6);
      const wl = riverWaterLevel(s);
      const steps = 6;
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const off = (u - 0.5) * 2 * hw;
        pos.push(P[i][0] + tz * off, wl, P[i][1] - tx * off);
        flow.push(u, s);
        depth.push((isCanal(s) ? 0.9 : 0.6) * (1 - Math.pow(Math.abs(u - 0.5) * 2, 3)) + 0.05);
      }
      if (i > 0) {
        const b0 = (i - 1) * (steps + 1), b1 = i * (steps + 1);
        for (let k = 0; k < steps; k++) idx.push(b0 + k, b1 + k, b0 + k + 1, b0 + k + 1, b1 + k, b1 + k + 1);
      }
      n++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, waterMaterial(0));
    m.renderOrder = 2;
    m.name = 'river';
    group.add(m);
  }
  // ---------- 湖 ----------
  {
    const L = SITES.lake;
    const seg = 96, rings = 10;
    const pos = [], flow = [], depth = [], idx = [];
    pos.push(L.x, WORLD.lakeLevel, L.z);
    flow.push(0.5, 0);
    depth.push(4);
    for (let j = 1; j <= rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const ex = Math.cos(a), ez = Math.sin(a);
        const R = lakeShoreRadius(L.x + ex * 50, L.z + ez * 50) + 4;
        const r = (j / rings) * R;
        pos.push(L.x + ex * r, WORLD.lakeLevel, L.z + ez * r);
        flow.push(0.5, 0);
        depth.push(4.2 * (1 - Math.pow(j / rings, 2)) + 0.05);
      }
    }
    for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
    for (let j = 1; j < rings; j++)
      for (let i = 0; i < seg; i++) {
        const a = 1 + (j - 1) * seg + i, b = 1 + (j - 1) * seg + ((i + 1) % seg);
        const c = a + seg, d = b + seg;
        idx.push(a, b, c, b, d, c);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, waterMaterial(1));
    m.renderOrder = 2;
    m.name = 'lake';
    group.add(m);
  }
  return group;
}

// 水田的镜面水
export function createPaddyWater(terrain) {
  const F = FIELDS.paddies;
  const pos = [], flow = [], depth = [], idx = [];
  const seen = new Set();
  for (let x = F.x0 + 1; x < F.x1; x += F.cell[0])
    for (let z = F.z0 + 1; z < F.z1; z += F.cell[1]) {
      const c = terrain.paddyCell(x + 2, z + 2);
      const key = c.ix + ',' + c.iz;
      if (seen.has(key) || !c.flooded) continue;
      seen.add(key);
      const y = c.level + 0.12;
      const m = 0.5;
      const b = pos.length / 3;
      pos.push(c.x0 + m, y, c.z0 + m, c.x1 - m, y, c.z0 + m, c.x1 - m, y, c.z1 - m, c.x0 + m, y, c.z1 - m);
      for (let k = 0; k < 4; k++) {
        flow.push(0.5, 0);
        depth.push(0.6);
      }
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, waterMaterial(2));
  m.renderOrder = 2;
  m.name = 'paddies';
  return m;
}
