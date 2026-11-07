import * as THREE from 'three';
import { U, GLSL_COMMON } from '../render/shaders.js';
import { FOG_GLSL, fogUniforms } from './petals.js';
import { RNG } from '../core/math.js';

// 绕相机平铺的地表层：每个实例在世界中有固定位置（按 tile 取模），相机移动时只在边缘轮换
const HEIGHT_GLSL = /* glsl */ `
uniform sampler2D uHeight; uniform sampler2D uGround; uniform vec4 uHRect; // x0, step, size(texels), 0
float hAt(vec2 xz){
  vec2 g = (xz - uHRect.xx) / uHRect.y;
  vec2 i = floor(g); vec2 f = g - i;
  int s = int(uHRect.z) - 1;
  ivec2 a = clamp(ivec2(i), ivec2(0), ivec2(s));
  ivec2 b = clamp(ivec2(i) + ivec2(1, 0), ivec2(0), ivec2(s));
  ivec2 c = clamp(ivec2(i) + ivec2(0, 1), ivec2(0), ivec2(s));
  ivec2 d = clamp(ivec2(i) + ivec2(1, 1), ivec2(0), ivec2(s));
  float ha = texelFetch(uHeight, a, 0).r, hb = texelFetch(uHeight, b, 0).r;
  float hc = texelFetch(uHeight, c, 0).r, hd = texelFetch(uHeight, d, 0).r;
  // 与地形网格相同的三角剖分
  if (f.x > f.y) return ha + (hb - ha) * f.x + (hd - hb) * f.y;
  return ha + (hc - ha) * f.y + (hd - hc) * f.x;
}
vec4 groundAt(vec2 xz){
  vec2 uv = ((xz - uHRect.xx) / uHRect.y + 0.5) / uHRect.z;
  return texture2D(uGround, uv);
}
`;

function tiledPosition() {
  return /* glsl */ `
    vec2 off = aOff * uTile;
    vec2 wxz = off + uTile * floor((uCam.xz - off) / uTile + 0.5);
    float dist = length(wxz - uCam.xz);
  `;
}

export class GroundCover {
  constructor(terrainTex, densityTex, quality) {
    this.group = new THREE.Group();
    this.group.name = 'groundcover';
    const { hTex, cTex, rect } = terrainTex;
    const base = {
      uTime: U.uTime,
      uCam: { value: new THREE.Vector3() },
      uHeight: { value: hTex },
      uGround: { value: cTex },
      uHRect: { value: new THREE.Vector4(rect.x0, rect.step, rect.size, 0) },
      uWind: U.uWind,
      uGust: U.uGust,
      uSunDir: U.uSunDir,
      uSunColor: U.uSunColor,
      uHemiSky: U.uHemiSky,
      uHemiGround: U.uHemiGround,
      uDay: U.uDay,
      uNight: U.uNight,
      uDensity: { value: densityTex.tex },
      uDRect: { value: new THREE.Vector4(densityTex.rect.x0, densityTex.rect.z0, densityTex.rect.size, 0) },
      ...fogUniforms(),
    };
    this.shared = base;
    this.layers = [];
    this.makeGrass(base, Math.round(26000 * quality.grass));
    this.makeFlowers(base, Math.round(5200 * quality.grass + 1200));
    this.makeGroundPetals(base, Math.round(9000 * quality.petals));
  }
  instanced(geo, count, tile, rng, extra = 4) {
    const g = new THREE.InstancedBufferGeometry();
    for (const k in geo.attributes) g.setAttribute(k, geo.attributes[k]);
    g.setIndex(geo.index);
    const off = new Float32Array(count * 2), rnd = new Float32Array(count * extra);
    for (let i = 0; i < count; i++) {
      off[i * 2] = rng.next();
      off[i * 2 + 1] = rng.next();
      for (let k = 0; k < extra; k++) rnd[i * extra + k] = rng.next();
    }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 2));
    g.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, extra));
    g.instanceCount = count;
    return g;
  }
  makeGrass(base, count) {
    // 一簇三片草叶，每片 2 段
    const pos = [], tip = [], idx = [];
    const rng = new RNG(3);
    for (let b = 0; b < 3; b++) {
      const a = rng.float(0, Math.PI * 2);
      const ox = Math.cos(a) * 0.08, oz = Math.sin(a) * 0.08;
      const dir = rng.float(0, Math.PI * 2);
      const dx = Math.cos(dir), dz = Math.sin(dir);
      const w = 0.05;
      const base0 = pos.length / 3;
      const rows = [[0, w], [0.55, w * 0.7], [1, 0]];
      for (const [t, ww] of rows) {
        const bend = t * t * 0.25;
        pos.push(ox - dz * ww + dx * bend, t, oz + dx * ww + dz * bend);
        tip.push(t);
        if (ww > 0) {
          pos.push(ox + dz * ww + dx * bend, t, oz - dx * ww + dz * bend);
          tip.push(t);
        }
      }
      idx.push(base0, base0 + 1, base0 + 2, base0 + 1, base0 + 3, base0 + 2, base0 + 2, base0 + 3, base0 + 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 1));
    geo.setIndex(idx);
    const tile = 52;
    const g = this.instanced(geo, count, tile, new RNG(21));
    const uniforms = { ...base, uTile: { value: tile } };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        ${GLSL_COMMON}
        ${HEIGHT_GLSL}
        attribute vec2 aOff; attribute vec4 aRnd; attribute float aTip;
        uniform vec3 uCam; uniform float uTile, uTime, uGust; uniform vec2 uWind;
        varying vec3 vCol; varying float vTip; varying vec3 vWorld; varying float vFade;
        void main(){
          ${tiledPosition()}
          vec4 gr = groundAt(wxz);
          float dens = gr.a;
          float fade = 1.0 - smoothstep(uTile * 0.32, uTile * 0.5, dist);
          float h = (0.28 + aRnd.x * 0.42) * smoothstep(aRnd.y * 0.9, aRnd.y * 0.9 + 0.12, dens) * fade;
          float rot = aRnd.z * 6.2832;
          float c = cos(rot), s = sin(rot);
          vec3 p = position;
          p.xz = mat2(c, -s, s, c) * p.xz;
          p.y *= h;
          p.xz *= 0.8 + aRnd.w * 0.6;
          float n = vnoise(wxz * 0.18 + vec2(uTime * 0.6, uTime * 0.25));
          vec2 sway = uWind * (0.15 + n * 0.35 + uGust * 0.5) * aTip * aTip * h;
          p.xz += sway;
          p.y -= length(sway) * 0.3;
          vec3 world = vec3(wxz.x, hAt(wxz) - 0.02, wxz.y) + p;
          vWorld = world;
          vTip = aTip;
          vCol = pow(gr.rgb, vec3(2.2));
          vFade = fade;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir, uSunColor, uHemiSky, uHemiGround; uniform float uDay, uNight;
        varying vec3 vCol; varying float vTip; varying vec3 vWorld; varying float vFade;
        ${FOG_GLSL}
        void main(){
          vec3 base = vCol * mix(0.62, 1.12, vTip) + vec3(0.03, 0.035, 0.0) * vTip;
          float l = max(uSunDir.y, 0.0) * 0.75 + 0.25;
          vec3 col = base * (mix(uHemiGround, uHemiSky, 0.65) * 0.45 + uSunColor * l * 0.62 * uDay);
          col += base * uSunColor * pow(vTip, 2.0) * 0.12 * uDay;
          gl_FragColor = vec4(applyFog2(col, vWorld), 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.name = 'grass';
    this.group.add(mesh);
    this.layers.push(uniforms);
  }
  makeFlowers(base, count) {
    // 十字交叉的两片小方片：片元着色器里画圆形花朵
    const pos = [], uv = [], idx = [];
    for (const r of [0, Math.PI / 2]) {
      const c = Math.cos(r) * 0.07, s = Math.sin(r) * 0.07;
      const b0 = pos.length / 3;
      pos.push(-c, 0, -s, c, 0, s, c, 0.14, s, -c, 0.14, -s);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    }
    // 花头（水平小片）
    const b0 = pos.length / 3;
    pos.push(-0.07, 0.15, -0.07, 0.07, 0.15, -0.07, 0.07, 0.15, 0.07, -0.07, 0.15, 0.07);
    uv.push(2, 0, 3, 0, 3, 1, 2, 1);
    idx.push(b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const tile = 44;
    const g = this.instanced(geo, count, tile, new RNG(77));
    const uniforms = { ...base, uTile: { value: tile } };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        ${GLSL_COMMON}
        ${HEIGHT_GLSL}
        attribute vec2 aOff; attribute vec4 aRnd;
        uniform vec3 uCam; uniform float uTile, uTime; uniform vec2 uWind;
        varying vec2 vUv; varying vec3 vCol; varying vec3 vWorld;
        void main(){
          ${tiledPosition()}
          vec4 gr = groundAt(wxz);
          float fade = 1.0 - smoothstep(uTile * 0.3, uTile * 0.5, dist);
          float vis = step(0.55, gr.a) * step(aRnd.y, 0.85) * fade;
          float sc = (0.8 + aRnd.x * 0.8) * vis;
          vec3 p = position * sc;
          p.xz += uWind * sin(uTime * 2.0 + aRnd.z * 20.0) * 0.02 * position.y * 6.0;
          vec3 world = vec3(wxz.x, hAt(wxz) - 0.01, wxz.y) + p;
          vWorld = world; vUv = uv;
          float k = aRnd.w;
          vCol = k < 0.38 ? vec3(1.0, 0.82, 0.12) : k < 0.7 ? vec3(0.98, 0.98, 0.95) : k < 0.86 ? vec3(0.55, 0.42, 0.85) : vec3(1.0, 0.62, 0.72);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunColor, uHemiSky; uniform float uDay, uNight;
        varying vec2 vUv; varying vec3 vCol; varying vec3 vWorld;
        ${FOG_GLSL}
        void main(){
          vec3 col;
          if (vUv.x < 1.5) {
            // stem
            if (abs(vUv.x - 0.5) > 0.12) discard;
            col = vec3(0.18, 0.35, 0.1);
          } else {
            vec2 q = vec2(vUv.x - 2.5, vUv.y - 0.5) * 2.0;
            float a = atan(q.y, q.x);
            float r = length(q);
            float petals = 0.75 + 0.25 * cos(a * 7.0);
            if (r > petals) discard;
            col = mix(vCol, vec3(1.0, 0.85, 0.3), smoothstep(0.3, 0.0, r) * 0.7);
          }
          col *= uHemiSky * 0.5 + uSunColor * 0.6 * uDay + 0.04;
          gl_FragColor = vec4(applyFog2(col, vWorld), 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.name = 'flowers';
    this.group.add(mesh);
    this.layers.push(uniforms);
  }
  makeGroundPetals(base, count) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 2, 1, 0, 3, 2]);
    const tile = 40;
    const g = this.instanced(geo, count, tile, new RNG(99));
    const uniforms = { ...base, uTile: { value: tile } };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        ${GLSL_COMMON}
        ${HEIGHT_GLSL}
        attribute vec2 aOff; attribute vec4 aRnd;
        uniform vec3 uCam; uniform float uTile;
        uniform sampler2D uDensity; uniform vec4 uDRect;
        varying vec2 vUv; varying vec3 vWorld; varying float vTone;
        void main(){
          ${tiledPosition()}
          vec2 duv = (wxz - uDRect.xy) / uDRect.z;
          float dens = texture2D(uDensity, duv).r;
          vec4 gr = groundAt(wxz);
          float fade = 1.0 - smoothstep(uTile * 0.3, uTile * 0.5, dist);
          float vis = smoothstep(aRnd.y, aRnd.y + 0.1, dens * 1.6) * fade * step(0.05, gr.a + 0.06);
          float rot = aRnd.z * 6.2832;
          float c = cos(rot), s = sin(rot);
          vec3 p = position * vec3(0.09, 1.0, 0.07) * vis * (0.8 + aRnd.x * 0.6);
          p.xz = mat2(c, -s, s, c) * p.xz;
          vec3 world = vec3(wxz.x, hAt(wxz) + 0.03 + aRnd.w * 0.02, wxz.y) + p;
          vWorld = world; vUv = uv; vTone = aRnd.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunColor, uHemiSky; uniform float uDay, uNight;
        varying vec2 vUv; varying vec3 vWorld; varying float vTone;
        ${FOG_GLSL}
        void main(){
          vec2 q = vUv * 2.0 - 1.0;
          float d = length(q * vec2(1.0, 1.0 + q.y * 0.4));
          float notch = step(length(q - vec2(0.0, 0.95)), 0.22);
          if (d > 0.95 || notch > 0.5) discard;
          vec3 base = mix(vec3(1.0, 0.72, 0.8), vec3(1.0, 0.93, 0.95), vTone);
          vec3 col = base * (uHemiSky * 0.45 + uSunColor * 0.62 * uDay + 0.03);
          gl_FragColor = vec4(applyFog2(col, vWorld), 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.name = 'groundPetals';
    this.group.add(mesh);
    this.layers.push(uniforms);
  }
  update(camPos) {
    this.shared.uCam.value.copy(camPos);
  }
}
