import * as THREE from 'three';
import { U, GLSL_COMMON } from '../render/shaders.js';
import { noise2, fbm2, RNG } from '../core/math.js';
import { GLSL_SKY_LUT_SAMPLE } from '../render/atmosphere.js';

// 程序化天空穹顶：大气散射查找表（白天与晨昏）+ 蓝调/夜色层、流云、星空与朦胧的春月（朧月）
export function createSky() {
  const uniforms = {
    uSunDir: U.uSunDir,
    uMoonDir: { value: new THREE.Vector3(0, 0.5, 0.8).normalize() },
    uZenith: U.uSkyZenith,
    uHorizon: U.uSkyHorizon,
    uGround: U.uFogColor,
    uSunColor: U.uSunColor,
    uSunGlow: { value: new THREE.Color('#ffd0a0') },
    uCloudLit: { value: new THREE.Color('#ffffff') },
    uCloudShade: { value: new THREE.Color('#b8c3d6') },
    uCloudCover: { value: 0.55 },
    uTime: U.uTime,
    uNight: U.uNight,
    uSunVisible: { value: 1 },
    uMoonVisible: { value: 0 },
    uSkyLUT: { value: null },
    uSkyGain: { value: 0 },
    uNightZenith: { value: new THREE.Color(0, 0, 0) },
    uNightHorizon: { value: new THREE.Color(0, 0, 0) },
    uStarVis: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      ${GLSL_SKY_LUT_SAMPLE}
      uniform vec3 uSunDir, uMoonDir, uZenith, uHorizon, uGround, uSunColor, uSunGlow, uCloudLit, uCloudShade, uNightZenith, uNightHorizon;
      uniform float uCloudCover, uTime, uNight, uSunVisible, uMoonVisible, uSkyGain, uStarVis;
      uniform sampler2D uSkyLUT;
      varying vec3 vDir;
      float cfbm(vec2 p){ float s = 0.0, a = 0.55; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.07 + vec2(13.1, 7.7); a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        float hz = clamp(y, 0.0, 1.0);
        // 物理天空（查找表）+ 蓝调与夜色
        vec3 col = mix(uNightHorizon, uNightZenith, pow(hz, 0.55));
        col = mix(col, uNightHorizon * 1.04, exp(-hz * 16.0) * 0.5);
        if (uSkyGain > 0.0) col += texture2D(uSkyLUT, skyLutUV(vec3(d.x, max(d.y, 0.0), d.z))).rgb * uSkyGain;
        float sd = dot(d, uSunDir);
        float sdp = max(sd, 0.0);
        col += uSunGlow * (pow(sdp, 8.0) * 0.25 + pow(sdp, 60.0) * 0.6) * uSunVisible * (0.6 + 0.4 * exp(-hz * 5.0));
        // clouds
        float cov = 0.0;
        if (y > -0.05) {
          vec2 uv = d.xz / (y + 0.16);
          uv = uv * 0.85 + vec2(uTime * 0.0035, uTime * 0.0012);
          float n = cfbm(uv * 1.15);
          float n2 = cfbm(uv * 2.9 + 5.0);
          float shape = n * 0.72 + n2 * 0.28;
          cov = smoothstep(uCloudCover, uCloudCover + 0.3, shape);
          float lit = clamp(0.35 + (n2 - 0.4) * 1.4 + pow(sdp, 3.0) * 0.4, 0.0, 1.0);
          vec3 cc = mix(uCloudShade, uCloudLit, lit);
          cc += uSunGlow * pow(sdp, 9.0) * 0.55 * uSunVisible;
          float fade = smoothstep(-0.03, 0.22, y);
          cov *= fade * 0.92;
          col = mix(col, cc, cov);
        }
        // sun disc
        float disc = smoothstep(0.99955, 0.99978, sd);
        col = mix(col, uSunColor * 9.0 + vec3(0.4) * uSunColor.b, disc * uSunVisible * (1.0 - cov * 0.85));
        // stars
        if (uStarVis > 0.01) {
          vec3 sp = d * 260.0;
          vec3 cell = floor(sp);
          float h = hash13(cell);
          float star = step(0.9972, h) * smoothstep(0.42, 0.0, length(fract(sp) - 0.5));
          star *= 0.55 + 0.45 * sin(uTime * (1.5 + h * 3.0) + h * 80.0);
          float milky = smoothstep(0.3, 0.0, abs(dot(d, normalize(vec3(0.3, 0.2, 1.0))))) * cfbm(d.xz * 6.0) * 0.08;
          col += (vec3(star * 1.6) + vec3(0.6, 0.65, 0.9) * milky) * uStarVis * smoothstep(0.0, 0.3, y) * (1.0 - cov);
        }
        // hazy moon
        float md = dot(d, uMoonDir);
        float moon = smoothstep(0.99925, 0.99955, md);
        float mdp = max(md, 0.0);
        vec3 moonCol = vec3(1.0, 0.95, 0.82) * (2.4 - 0.5 * vnoise(d.xy * 900.0));
        col = mix(col, moonCol, moon * uMoonVisible * (1.0 - cov * 0.7));
        col += vec3(0.5, 0.56, 0.78) * (pow(mdp, 24.0) * 0.22 + pow(mdp, 380.0) * 0.45) * uMoonVisible;
        // below horizon
        col = mix(col, uGround, smoothstep(0.0, -0.1, y));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const geo = new THREE.SphereGeometry(7000, 48, 24);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.name = 'sky';
  return { mesh, uniforms };
}

// 远方的雪峰「桜嶺」：独立网格，雾更淡，像一幅挂在天边的画
export function createFarMountain() {
  const geo = new THREE.BufferGeometry();
  const seg = 96, rings = 34;
  const pos = [], col = [], idx = [];
  const H = 1900, R = 4300;
  const rng = new RNG(99);
  const snow = new THREE.Color('#f4f6fb'), rock = new THREE.Color('#7f8fa9'), rockD = new THREE.Color('#5d6b86');
  const c = new THREE.Color();
  for (let j = 0; j <= rings; j++) {
    const t = j / rings; // 0 = summit, 1 = base
    // 凹曲线山形：顶部陡峭、山麓舒展（y = H(1 - r/R)^2.1），山顶微平带火口
    const r0 = 150;
    const rr = r0 + (R - r0) * Math.pow(t, 1.35);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const wob = 1 + 0.04 * noise2(Math.cos(a) * 2.5, Math.sin(a) * 2.5 + t * 3) * t;
      const r = rr * wob;
      let y = H * Math.pow(Math.max(0, 1 - rr / R), 2.1);
      y += 18 * noise2(i * 0.35, j * 0.5) * t;
      if (j === 0) y -= 25; // 火口
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      pos.push(x, y, z);
      // 雪线：沿沟壑向下延伸的锯齿
      const gully = 0.5 + 0.5 * Math.sin(a * 23 + noise2(a * 3, 0.5) * 3);
      const yn = y / H;
      const snowLine = 0.5 - 0.16 * gully - 0.05 * noise2(a * 6, 2.0);
      const k = Math.max(0, Math.min(1, (yn - snowLine) / 0.04));
      c.copy(rockD).lerp(rock, 0.5 + 0.5 * noise2(a * 4, t * 6));
      c.lerp(snow, k);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + seg + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: U.uSunDir,
      uSunColor: U.uSunColor,
      uHorizon: U.uSkyHorizon,
      uFogColor: U.uFogColor,
      uHemiSky: U.uHemiSky,
      uDay: U.uDay,
      uNight: U.uNight,
    },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      varying vec3 vCol; varying vec3 vN; varying float vH;
      void main(){
        vCol = color; vN = normalize(mat3(modelMatrix) * normal); vH = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir, uSunColor, uHorizon, uFogColor, uHemiSky; uniform float uDay, uNight;
      varying vec3 vCol; varying vec3 vN; varying float vH;
      void main(){
        float l = max(dot(normalize(vN), uSunDir), 0.0);
        vec3 c = vCol * (uHemiSky * 0.55 + uSunColor * l * 0.9 * uDay);
        float haze = mix(0.6, 0.34, clamp(vH / 1900.0, 0.0, 1.0));
        c = mix(c, mix(uFogColor, uHorizon, 0.5), haze);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    fog: false,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(-650, -40, -5200);
  mesh.renderOrder = -5;
  mesh.name = 'farMountain';
  return mesh;
}
