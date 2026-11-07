import * as THREE from 'three';
import { U, GLSL_COMMON, SHADOW_GLSL, shadowUniforms } from '../render/shaders.js';
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
uniform sampler2D uMask; uniform vec4 uMRect; // x0, 0, size(m), 0
float maskAt(vec2 xz){ return texture2D(uMask, (xz - uMRect.xx) / uMRect.z).r; }
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
  constructor(terrainTex, densityTex, quality, mask) {
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
      uMask: { value: mask.tex },
      uMRect: { value: new THREE.Vector4(mask.rect.x0, 0, mask.rect.size, 0) },
      ...fogUniforms(),
    };
    this.shared = base;
    this.layers = [];
    this.makeGrass(base, Math.round(30000 * quality.grass));
    this.makeFlowers(base, Math.round(5200 * quality.grass + 1200));
    this.makeGroundPetals(base, Math.round(13000 * quality.petals));
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
    // 一簇四片细长的草叶，每片三段、略带弯曲；aNrm 为叶面法线（局部），用于受光与逆光透光
    const pos = [], tip = [], nrm = [], idx = [];
    const rng = new RNG(3);
    for (let b = 0; b < 4; b++) {
      const a = rng.float(0, Math.PI * 2);
      const r0 = rng.float(0.03, 0.13);
      const ox = Math.cos(a) * r0, oz = Math.sin(a) * r0;
      const dir = rng.float(0, Math.PI * 2);
      const dx = Math.cos(dir), dz = Math.sin(dir);
      const w = rng.float(0.014, 0.021);
      const lean = rng.float(0.12, 0.34);
      const hs = rng.float(0.75, 1.0);
      const base0 = pos.length / 3;
      const rows = [[0, w], [0.38, w * 0.85], [0.72, w * 0.55], [1, 0]];
      for (const [t, ww] of rows) {
        const bend = t * t * lean;
        const cx = ox + dx * bend, cz = oz + dz * bend, cy = t * hs;
        pos.push(cx - dz * ww, cy, cz + dx * ww);
        tip.push(t);
        nrm.push(dx, 0.35 + t * 0.4, dz);
        if (ww > 0) {
          pos.push(cx + dz * ww, cy, cz - dx * ww);
          tip.push(t);
          nrm.push(dx, 0.35 + t * 0.4, dz);
        }
      }
      // 行：0-1, 2-3, 4-5, 6(尖)
      idx.push(base0, base0 + 1, base0 + 2, base0 + 1, base0 + 3, base0 + 2);
      idx.push(base0 + 2, base0 + 3, base0 + 4, base0 + 3, base0 + 5, base0 + 4);
      idx.push(base0 + 4, base0 + 5, base0 + 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 1));
    geo.setAttribute('aNrm', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setIndex(idx);
    const tile = 46;
    const g = this.instanced(geo, count, tile, new RNG(21));
    const uniforms = { ...base, ...shadowUniforms(), uTile: { value: tile } };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        ${GLSL_COMMON}
        ${HEIGHT_GLSL}
        ${SHADOW_GLSL}
        attribute vec2 aOff; attribute vec4 aRnd; attribute float aTip; attribute vec3 aNrm;
        uniform vec3 uCam; uniform float uTile, uTime, uGust; uniform vec2 uWind;
        varying vec3 vCol; varying float vTip; varying vec3 vWorld; varying vec3 vNrm; varying float vShadow;
        void main(){
          ${tiledPosition()}
          vec4 gr = groundAt(wxz);
          float dens = gr.a * maskAt(wxz);
          float fade = 1.0 - smoothstep(uTile * 0.3, uTile * 0.5, dist);
          // 草高：大片区域有修剪过的矮草与自然生长的高草
          float patchH = vnoise(wxz * 0.07 + 13.0);
          float h = (0.16 + aRnd.x * 0.3 + patchH * 0.22) * smoothstep(aRnd.y * 0.9, aRnd.y * 0.9 + 0.12, dens) * fade;
          float rot = aRnd.z * 6.2832;
          float c = cos(rot), s = sin(rot);
          mat2 R = mat2(c, -s, s, c);
          vec3 p = position;
          p.xz = R * p.xz;
          p.y *= h;
          p.xz *= (0.8 + aRnd.w * 0.5) * (0.6 + h * 0.9);
          float n = vnoise(wxz * 0.18 + vec2(uTime * 0.6, uTime * 0.25));
          vec2 sway = uWind * (0.12 + n * 0.3 + uGust * 0.45) * aTip * aTip * h;
          p.xz += sway;
          p.y -= length(sway) * 0.3;
          vec3 world = vec3(wxz.x, hAt(wxz) - 0.02, wxz.y) + p;
          vWorld = world;
          vTip = aTip;
          vec3 nn = aNrm; nn.xz = R * nn.xz;
          vNrm = nn;
          // 颜色：取地面色，再按位置混入深绿、黄绿与少量枯黄
          vec3 g0 = pow(gr.rgb, vec3(2.2));
          float v1 = vnoise(wxz * 0.31 + 4.0), v2 = aRnd.w;
          vec3 deep = g0 * vec3(0.72, 0.86, 0.78);
          vec3 fresh = g0 * vec3(1.08, 1.1, 0.82);
          vec3 dry = mix(g0, vec3(0.42, 0.36, 0.17), 0.55);
          vec3 cc = mix(deep, fresh, smoothstep(0.25, 0.75, v1 * 0.7 + v2 * 0.5));
          cc = mix(cc, dry, smoothstep(0.82, 0.98, v2) * 0.8 + smoothstep(0.7, 0.9, patchH) * 0.25);
          vCol = cc;
          // 阴影：在叶片中部取样一次
          vShadow = sunShadow(vec3(world.x, world.y + 0.12, world.z), 0.0007);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir, uSunColor, uHemiSky, uHemiGround; uniform float uDay, uNight;
        varying vec3 vCol; varying float vTip; varying vec3 vWorld; varying vec3 vNrm; varying float vShadow;
        ${FOG_GLSL}
        void main(){
          vec3 n = normalize(vNrm);
          if (!gl_FrontFacing) n.xz = -n.xz;
          vec3 V = normalize(cameraPosition - vWorld);
          float ndl = max(dot(n, uSunDir), 0.0);
          float wrap = clamp(dot(n, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
          // 逆光时叶片透出黄绿的光
          float trans = pow(max(dot(-V, uSunDir), 0.0), 4.0) * smoothstep(0.1, 0.8, vTip);
          float ao = mix(0.32, 1.0, smoothstep(0.0, 0.85, vTip));
          vec3 base = vCol * mix(0.7, 1.08, vTip);
          vec3 amb = mix(uHemiGround, uHemiSky, 0.45 + 0.4 * vTip) * 0.6 * ao;
          vec3 sun = uSunColor * uDay * vShadow * (ndl * 0.4 + wrap * 0.45 + 0.12) * ao;
          vec3 col = base * (amb + sun) + base * vec3(1.05, 1.15, 0.6) * uSunColor * uDay * vShadow * trans * 0.55;
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
    const uniforms = { ...base, ...shadowUniforms(), uTile: { value: tile } };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        ${GLSL_COMMON}
        ${HEIGHT_GLSL}
        ${SHADOW_GLSL}
        attribute vec2 aOff; attribute vec4 aRnd;
        uniform vec3 uCam; uniform float uTile, uTime; uniform vec2 uWind;
        varying vec2 vUv; varying vec3 vCol; varying vec3 vWorld; varying float vShadow;
        void main(){
          ${tiledPosition()}
          vec4 gr = groundAt(wxz);
          float fade = 1.0 - smoothstep(uTile * 0.3, uTile * 0.5, dist);
          float vis = step(0.55, gr.a * maskAt(wxz)) * step(aRnd.y, 0.85) * fade;
          float sc = (0.6 + aRnd.x * 0.55) * vis;
          vec3 p = position * sc;
          p.xz += uWind * sin(uTime * 2.0 + aRnd.z * 20.0) * 0.02 * position.y * 6.0;
          vec3 world = vec3(wxz.x, hAt(wxz) - 0.01, wxz.y) + p;
          vWorld = world; vUv = uv;
          float k = aRnd.w;
          vCol = k < 0.38 ? vec3(0.92, 0.74, 0.16) : k < 0.7 ? vec3(0.9, 0.9, 0.86) : k < 0.86 ? vec3(0.5, 0.42, 0.72) : vec3(0.92, 0.62, 0.7);
          vShadow = sunShadow(world + vec3(0.0, 0.1, 0.0), 0.0007);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunColor, uHemiSky; uniform float uDay, uNight;
        varying vec2 vUv; varying vec3 vCol; varying vec3 vWorld; varying float vShadow;
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
          col *= uHemiSky * 0.45 + uSunColor * 0.6 * uDay * vShadow + 0.02;
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
    const tile = 30;
    const g = this.instanced(geo, count, tile, new RNG(99));
    const uniforms = { ...base, ...shadowUniforms(), uTile: { value: tile } };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        ${GLSL_COMMON}
        ${HEIGHT_GLSL}
        ${SHADOW_GLSL}
        attribute vec2 aOff; attribute vec4 aRnd;
        uniform vec3 uCam; uniform float uTile;
        uniform sampler2D uDensity; uniform vec4 uDRect;
        varying vec2 vUv; varying vec3 vWorld; varying float vTone; varying float vShadow;
        void main(){
          ${tiledPosition()}
          vec2 duv = (wxz - uDRect.xy) / uDRect.z;
          float dens = texture2D(uDensity, duv).r;
          vec4 gr = groundAt(wxz);
          float fade = 1.0 - smoothstep(uTile * 0.3, uTile * 0.5, dist);
          float vis = smoothstep(aRnd.y, aRnd.y + 0.1, dens * 1.6) * fade * step(0.5, maskAt(wxz));
          float rot = aRnd.z * 6.2832;
          float c = cos(rot), s = sin(rot);
          vec3 p = position * vec3(0.042, 1.0, 0.034) * vis * (0.8 + aRnd.x * 0.5);
          p.xz = mat2(c, -s, s, c) * p.xz;
          vec3 world = vec3(wxz.x, hAt(wxz) + 0.03 + aRnd.w * 0.02, wxz.y) + p;
          vWorld = world; vUv = uv; vTone = aRnd.w;
          vShadow = sunShadow(world + vec3(0.0, 0.1, 0.0), 0.0007);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunColor, uHemiSky; uniform float uDay, uNight;
        varying vec2 vUv; varying vec3 vWorld; varying float vTone; varying float vShadow;
        ${FOG_GLSL}
        void main(){
          vec2 q = vUv * 2.0 - 1.0;
          float d = length(q * vec2(1.0, 1.0 + q.y * 0.4));
          float notch = step(length(q - vec2(0.0, 0.95)), 0.22);
          if (d > 0.95 || notch > 0.5) discard;
          vec3 base = mix(vec3(0.95, 0.68, 0.74), vec3(0.98, 0.9, 0.9), vTone);
          float al = dot(uHemiSky, vec3(0.2126, 0.7152, 0.0722));
          vec3 amb = mix(uHemiSky, vec3(al), 0.6);
          vec3 col = base * (amb * 0.42 + uSunColor * 0.62 * uDay * vShadow + 0.02);
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
