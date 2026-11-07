import * as THREE from 'three';
import { U, GLSL_COMMON } from '../render/shaders.js';
import { RNG } from '../core/math.js';

const FOG_GLSL = /* glsl */ `
uniform vec3 uFogColor; uniform vec3 uFogSunColor; uniform float uFogDensity; uniform vec3 uFogSun;
vec3 applyFog2(vec3 col, vec3 wp){
  vec3 v = wp - cameraPosition; float d = length(v);
  float amt = 1.0 - exp(-pow(d * uFogDensity, 1.3));
  float sa = pow(max(dot(v / max(d, 0.001), uFogSun), 0.0), 5.0);
  return mix(col, mix(uFogColor, uFogSunColor, sa), amt);
}
`;
export { FOG_GLSL };

export function fogUniforms() {
  return {
    uFogColor: U.uFogColor,
    uFogSunColor: U.uFogSunColor,
    uFogDensity: U.uFogDensity,
    uFogSun: U.uSunDir,
  };
}

// 樱花密度图：每棵樱树画一团径向渐变（偏向下风处），用于控制花瓣出现的位置
export function makeDensityTexture(trees, rect = { x0: -512, z0: -512, size: 1024 }, res = 512) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = res;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, res, res);
  ctx.globalCompositeOperation = 'lighter';
  const k = res / rect.size;
  for (const t of trees) {
    const r = (t.r || 13) * k;
    for (const [ox, oz, a] of [[0, 0, 0.5], [4, 2, 0.28]]) {
      const x = (t.x + ox - rect.x0) * k, y = (t.z + oz - rect.z0) * k;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${a * (t.w || 1)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { tex, rect, canvas: cv };
}

function petalShape() {
  // XY 平面，朝 +z；带缺口的花瓣
  const outline = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 底 → 1 顶
    const w = Math.sin(Math.pow(t, 0.8) * Math.PI) * 0.42 + 0.06;
    outline.push([w, t - 0.5]);
  }
  const pts = [];
  for (const p of outline) pts.push([p[0], p[1]]);
  pts.push([0.0, 0.38]); // 缺口
  for (let i = outline.length - 1; i >= 0; i--) pts.push([-outline[i][0], outline[i][1]]);
  const pos = [0, 0, 0];
  for (const [x, y] of pts) pos.push(x, y, x * x * 0.4);
  const idx = [];
  for (let i = 1; i < pts.length; i++) idx.push(0, i, i + 1 > pts.length ? 1 : i + 1);
  return { pos, idx: idx.filter((v) => v <= pts.length) };
}

export class FallingPetals {
  constructor(density, count) {
    const shape = petalShape();
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(shape.pos, 3));
    const idx = [];
    const n = shape.pos.length / 3;
    for (let i = 1; i < n - 1; i++) idx.push(0, i, i + 1);
    g.setIndex(idx);
    const rng = new RNG(11);
    const seed = new Float32Array(count * 4), par = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seed.set([rng.next(), rng.next(), rng.next(), rng.next()], i * 4);
      par.set([rng.next(), rng.next(), rng.next(), rng.next()], i * 4);
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.setAttribute('aParams', new THREE.InstancedBufferAttribute(par, 4));
    g.instanceCount = count;
    this.uniforms = {
      uTime: U.uTime,
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: 64 },
      uTravel: { value: new THREE.Vector2() },
      uBurst: { value: 0 },
      uDensity: { value: density.tex },
      uDRect: { value: new THREE.Vector4(density.rect.x0, density.rect.z0, density.rect.size, 0) },
      uSunDir: U.uSunDir,
      uSunColor: U.uSunColor,
      uHemiSky: U.uHemiSky,
      uDay: U.uDay,
      uNight: U.uNight,
      uLantern: U.uLanternColor,
      ...fogUniforms(),
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed; attribute vec4 aParams;
        uniform float uTime, uBox, uBurst; uniform vec3 uCenter; uniform vec2 uTravel;
        uniform sampler2D uDensity; uniform vec4 uDRect;
        varying vec3 vN; varying vec3 vWorld; varying vec3 vCol;
        mat3 rotAxis(vec3 a, float ang){
          float c = cos(ang), s = sin(ang), t = 1.0 - c;
          return mat3(t*a.x*a.x + c, t*a.x*a.y + s*a.z, t*a.x*a.z - s*a.y,
                      t*a.x*a.y - s*a.z, t*a.y*a.y + c, t*a.y*a.z + s*a.x,
                      t*a.x*a.z + s*a.y, t*a.y*a.z - s*a.x, t*a.z*a.z + c);
        }
        void main(){
          float t = uTime;
          float fall = 0.5 + aParams.x * 0.55;
          float var = 0.7 + aParams.y * 0.6;
          vec3 p = aSeed.xyz * uBox + vec3(uTravel.x * var, -fall * t, uTravel.y * var);
          p.x += sin(t * (0.5 + aParams.z) + aSeed.w * 6.28) * 1.5;
          p.z += cos(t * (0.45 + aParams.w) + aSeed.w * 4.0) * 1.5;
          p.y += sin(t * 1.2 + aSeed.w * 9.0) * 0.4;
          vec3 rel = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
          rel.y = mod(p.y - uCenter.y + uBox * 0.3, uBox * 0.6) - uBox * 0.3;
          vec3 wp = uCenter + rel;
          vec2 duv = (wp.xz - uDRect.xy) / uDRect.z;
          float dens = texture2D(uDensity, duv).r;
          float vis = smoothstep(aParams.x - 0.1, aParams.x + 0.02, dens * 1.25 + uBurst);
          vis *= 1.0 - smoothstep(uBox * 0.34, uBox * 0.5, length(rel.xz));
          vec3 axis = normalize(aParams.yzw - 0.5 + vec3(0.001));
          mat3 R = rotAxis(axis, t * (1.4 + aParams.w * 2.6) + aSeed.w * 10.0);
          // 第一人称下花瓣会贴着眼睛飞过：按真实大小（3.5～6 cm），近处淡出，远处略放大以便看得见
          float camD = length(wp - cameraPosition);
          float size = (0.035 + 0.025 * aParams.z) * vis * mix(1.0, 1.9, smoothstep(3.0, 22.0, camD)) * smoothstep(0.5, 1.2, camD);
          vec3 local = R * (position * size);
          vN = R * vec3(0.0, 0.0, 1.0);
          vec3 world = wp + local;
          vWorld = world;
          vCol = mix(vec3(1.0, 0.72, 0.8), vec3(1.0, 0.92, 0.94), aSeed.w);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir, uSunColor, uHemiSky, uLantern; uniform float uDay, uNight;
        varying vec3 vN; varying vec3 vWorld; varying vec3 vCol;
        ${FOG_GLSL}
        void main(){
          vec3 n = normalize(vN);
          float ndl = abs(dot(n, uSunDir));
          vec3 col = vCol * (uHemiSky * 0.42 + uSunColor * (ndl * 0.55 + 0.22) * uDay);
          col += vCol * uLantern * uNight * 0.22;
          gl_FragColor = vec4(applyFog2(col, vWorld), 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'petals';
  }
  update(dt, camPos, wind, gust) {
    const u = this.uniforms;
    u.uCenter.value.copy(camPos);
    const speed = 1.4 + gust * 7.0;
    u.uTravel.value.x += wind.x * speed * dt;
    u.uTravel.value.y += wind.y * speed * dt;
    u.uBurst.value = Math.max(0, gust - 0.35) * 0.9;
  }
}
