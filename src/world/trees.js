import * as THREE from 'three';
import { GeoBuilder, PAT, C } from '../render/builder.js';
import { createTrunkMaterial, createBlossomMaterial, createFoliageMaterial } from '../render/materials.js';
import { RNG, lerp, clamp, smoothstep, noise2 } from '../core/math.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// ---------- 樱树骨架（染井吉野：伞状、向四周舒展） ----------
function sakuraSkeleton(rng, weeping = false) {
  const branches = [];
  const clusters = [];
  const trunkH = weeping ? 3.4 : rng.float(2.0, 2.7);
  const lean = [rng.float(-0.35, 0.35), rng.float(-0.35, 0.35)];
  const trunk = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    trunk.push([lean[0] * t * t + rng.float(-0.04, 0.04), t * trunkH, lean[1] * t * t + rng.float(-0.04, 0.04)]);
  }
  const r0 = weeping ? 1.05 : 0.27;
  branches.push({ pts: trunk, radii: trunk.map((_, i) => r0 * (1 - (i / 5) * 0.32)), seg: weeping ? 14 : 7 });
  const nMain = weeping ? 6 : rng.int(3, 5);
  const az0 = rng.float(0, Math.PI * 2);
  for (let k = 0; k < nMain; k++) {
    const az = az0 + (k / nMain) * Math.PI * 2 + rng.float(-0.35, 0.35);
    const elev = weeping ? rng.float(0.7, 1.05) : rng.float(0.42, 0.85);
    const len = weeping ? rng.float(5.0, 7.0) : rng.float(3.0, 4.6);
    const ts = rng.float(0.7, 1.0);
    const si = Math.min(4, Math.floor(ts * 5));
    const start = trunk[si + 1] ? trunk[si + 1] : trunk[5];
    const pts = [start.slice()];
    const N = 6;
    let p = start.slice();
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const e = elev * (1 - 0.75 * t) + (weeping ? -0.1 * t : 0);
      const a = az + Math.sin(t * 3 + k) * 0.15;
      const step = len / N;
      p = [p[0] + Math.cos(a) * Math.cos(e) * step, p[1] + Math.sin(e) * step, p[2] + Math.sin(a) * Math.cos(e) * step];
      pts.push(p.slice());
    }
    const rs = (weeping ? 0.55 : 0.16);
    branches.push({ pts, radii: pts.map((_, i) => rs * (1 - (i / N) * 0.82) + 0.025), seg: weeping ? 9 : 5, main: true });
    // 二级枝
    for (const tt of [0.45, 0.7, 1.0]) {
      const bi = Math.round(tt * N);
      const bp = pts[bi];
      const nSub = rng.int(2, 3);
      for (let j = 0; j < nSub; j++) {
        const a2 = az + rng.float(-0.9, 0.9);
        const e2 = weeping ? rng.float(0.1, 0.6) : rng.float(0.05, 0.6);
        const l2 = (weeping ? rng.float(2.0, 3.2) : rng.float(1.3, 2.4)) * (tt === 1 ? 1 : 0.85);
        const q = [bp[0] + Math.cos(a2) * Math.cos(e2) * l2, bp[1] + Math.sin(e2) * l2, bp[2] + Math.sin(a2) * Math.cos(e2) * l2];
        const mid = [(bp[0] + q[0]) / 2, (bp[1] + q[1]) / 2 + 0.15, (bp[2] + q[2]) / 2];
        branches.push({ pts: [bp, mid, q], radii: [rs * 0.45, rs * 0.25, 0.025], seg: weeping ? 5 : 3 });
        clusters.push({ x: q[0], y: q[1] + 0.2, z: q[2], r: weeping ? rng.float(1.2, 1.7) : rng.float(1.25, 1.9) });
        if (rng.chance(0.6)) clusters.push({ x: mid[0], y: mid[1] + 0.35, z: mid[2], r: rng.float(1.0, 1.4) });
      }
    }
    clusters.push({ x: p[0], y: p[1] + 0.3, z: p[2], r: rng.float(1.5, 2.1) });
  }
  // 顶部填充
  const cy = trunkH + (weeping ? 4 : 2.2);
  if (!weeping) for (let k = 0; k < 3; k++) clusters.push({ x: rng.float(-1.2, 1.2), y: cy + rng.float(0, 1.2), z: rng.float(-1.2, 1.2), r: rng.float(1.5, 2.0) });
  return { branches, clusters, trunkH };
}

function addTrunk(b, skel, color) {
  b.pattern(PAT.BARK, 0);
  for (const br of skel.branches) b.tube(br.pts, br.radii, br.seg || 6, color, { capEnd: br.seg > 4 });
  // 根部隆起
  const r0 = skel.branches[0].radii[0];
  b.lathe(0, 0, [[r0 * 1.7, -0.2], [r0 * 1.35, 0.15], [r0 * 1.05, 0.5], [r0 * 0.98, 0.8]], 9, color);
}
function buildTrunkGeometry(skel, color) {
  const b = new GeoBuilder();
  addTrunk(b, skel, color);
  return b.toGeometry();
}

// 树冠卡片：随机朝向的花簇贴片 + 每簇一个内核球；法线指向树冠外侧
function buildCanopyGeometry(skel, rng, opt = {}) {
  const pos = [], nor = [], uv = [], col = [], lit = [];
  const center = new THREE.Vector3();
  for (const c of skel.clusters) center.add(new THREE.Vector3(c.x, c.y, c.z));
  center.divideScalar(skel.clusters.length);
  center.y -= 0.8;
  const tint = new THREE.Color();
  const v = new THREE.Vector3(), n = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
  const pink = new THREE.Color(opt.pink || '#ffd9e3'), white = new THREE.Color('#fff6f8');
  const cards = opt.cards || 8;
  const ext = new THREE.Vector3();
  for (const c of skel.clusters) {
    const cc = new THREE.Vector3(c.x, c.y, c.z);
    const out = cc.clone().sub(center).normalize();
    // 贴片
    for (let k = 0; k < cards; k++) {
      // 在簇内随机，偏向外侧和上方
      const rr = c.r * (k < 3 ? rng.float(0.05, 0.35) : Math.pow(rng.next(), 0.6) * 0.85);
      v.set(rng.float(-1, 1), rng.float(-0.6, 1), rng.float(-1, 1)).normalize().lerp(out, 0.35).normalize();
      const p = cc.clone().addScaledVector(v, rr);
      // 贴片朝向：随机方向
      n.set(rng.float(-1, 1), rng.float(-0.4, 1), rng.float(-1, 1)).normalize();
      t1.crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : _up).normalize();
      t2.crossVectors(n, t1).normalize();
      const ang = rng.float(0, Math.PI * 2);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const a1 = t1.clone().multiplyScalar(ca).addScaledVector(t2, sa);
      const a2 = t1.clone().multiplyScalar(-sa).addScaledVector(t2, ca);
      const s = c.r * rng.float(0.95, 1.35);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
      const h = clamp((p.y - center.y + 3) / 7, 0, 1);
      const outward = clamp(p.clone().sub(center).length() / 5, 0, 1);
      const ao = 0.7 + 0.2 * h + 0.15 * outward;
      tint.copy(pink).lerp(white, rng.float(0, 0.7)).multiplyScalar(ao);
      const base = pos.length / 3;
      for (let q = 0; q < 4; q++) {
        ext.copy(p).addScaledVector(a1, corners[q][0] * s * 0.5).addScaledVector(a2, corners[q][1] * s * 0.5);
        pos.push(ext.x, ext.y, ext.z);
        v.copy(ext).sub(center).normalize();
        nor.push(v.x, v.y, v.z);
        uv.push(uvs[q][0], uvs[q][1]);
        col.push(tint.r, tint.g, tint.b);
      }
    }
  }
  // 索引：先是所有内核球，再是卡片——按顺序重建
  const idx = [];
  let off = 0;
  for (const c of skel.clusters) {
    for (let k = 0; k < cards; k++) {
      idx.push(off, off + 1, off + 2, off, off + 2, off + 3);
      off += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---------- 千年垂樱：巨大树干 + 垂枝花帘 ----------
function buildWeepingTree(rng) {
  const skel = sakuraSkeleton(rng, true);
  // 加粗主干的扭曲感
  // 支撑木
  const b = new GeoBuilder();
  addTrunk(b, skel, '#4f3e38');
  b.pattern(PAT.PLANK, 0);
  for (const br of skel.branches.filter((x) => x.main).slice(0, 4)) {
    const p = br.pts[3];
    b.tube([[p[0] * 1.15, -0.2, p[2] * 1.15], [p[0], p[1] - 0.15, p[2]]], 0.11, 5, '#8a7356');
    b.tube([[p[0] * 0.9 - 0.3, p[1] - 0.2, p[2] * 0.9], [p[0] * 1.1 + 0.3, p[1] - 0.2, p[2] * 1.1]], 0.07, 4, '#8a7356');
  }
  const trunk = b.toGeometry();
  // 树冠：主簇 + 下垂花帘
  const canopy = buildCanopyGeometry(skel, rng, { pink: '#f6b3c6', cards: 12 });
  // 花帘
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const strands = 230;
  const tint = new THREE.Color();
  const v = new THREE.Vector3();
  for (let s = 0; s < strands; s++) {
    const c = skel.clusters[rng.int(0, skel.clusters.length - 1)];
    const ax = c.x + rng.float(-c.r, c.r), az = c.z + rng.float(-c.r, c.r), ay = c.y + rng.float(-0.3, 0.6);
    const dirx = ax, dirz = az;
    const dl = Math.hypot(dirx, dirz) || 1;
    const hang = rng.float(ay - 1.6, ay - 0.3);
    const drop = Math.max(2.5, ay - rng.float(0.6, 2.4));
    const N = 9;
    for (let k = 0; k < N; k++) {
      const t = k / (N - 1);
      // 先向外拱出再下垂
      const out = Math.sin(Math.min(1, t * 2.2) * Math.PI * 0.5) * 1.2;
      const x = ax + (dirx / dl) * out, z = az + (dirz / dl) * out;
      const y = ay + 0.4 * Math.sin(Math.min(t * 3, 1) * Math.PI) - drop * Math.pow(t, 1.4);
      const sz = lerp(0.9, 0.55, t);
      const ang = rng.float(0, Math.PI * 2);
      const base = pos.length / 3;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      tint.set('#f7b8c9').lerp(new THREE.Color('#fff0f4'), rng.float(0, 0.5)).multiplyScalar(lerp(1.0, 0.8, t));
      for (let q = 0; q < 4; q++) {
        const lx = quad[q][0] * sz * 0.5, ly = quad[q][1] * sz * 0.5;
        pos.push(x + lx * ca, y + ly, z + lx * sa);
        v.set(x, y - 2, z).normalize();
        nor.push(v.x * 0.6, 0.55, v.z * 0.6);
        uv.push(quad[q][0] * 0.5 + 0.5, quad[q][1] * 0.5 + 0.5);
        col.push(tint.r, tint.g, tint.b);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const strandsGeo = new THREE.BufferGeometry();
  strandsGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  strandsGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  strandsGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  strandsGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  strandsGeo.setIndex(idx);
  // 合并树冠与花帘
  const merged = mergeSimple([canopy, strandsGeo]);
  const n = merged.attributes.position.count;
  merged.setAttribute('aLit', new THREE.Float32BufferAttribute(new Float32Array(n).fill(2), 1));
  return { trunk, canopy: merged, skel };
}

function mergeSimple(geos) {
  const attrs = ['position', 'normal', 'uv', 'color'];
  const out = new THREE.BufferGeometry();
  const data = {};
  for (const a of attrs) data[a] = [];
  const idx = [];
  let off = 0;
  for (const g of geos) {
    for (const a of attrs) {
      const arr = g.attributes[a].array;
      for (let i = 0; i < arr.length; i++) data[a].push(arr[i]);
    }
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off);
    off += g.attributes.position.count;
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(data.color, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

// ---------- 其它树种 ----------
function cedarGeometry(rng) {
  const b = new GeoBuilder();
  b.pattern(PAT.BARK, 0);
  b.cylinder(0, -0.5, 0, 0.18, 0.32, 5.5, 6, '#6b4a3a');
  b.pattern(PAT.NONE, 0);
  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const y = 3.2 + i * 2.6;
    const r = 2.6 * (1 - t * 0.72);
    b.cylinder(0, y, 0, 0.05, r, 4.2 - t * 1.4, 7, i % 2 ? '#3d5a34' : '#46653a', { bottom: true, ao: 0.35 });
  }
  return b.toGeometry();
}
function broadleafGeometry(rng, flat = 1) {
  const b = new GeoBuilder();
  b.pattern(PAT.BARK, 0);
  b.cylinder(0, -0.4, 0, 0.16, 0.26, 3.6, 6, '#5d4a3c');
  b.pattern(PAT.NONE, 0);
  const g = new THREE.IcosahedronGeometry(3.0, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.18 * noise2(x * 0.7 + 3, z * 0.7 + y * 0.5);
    p.setXYZ(i, x * k * 1.1, y * k * 0.78 * flat, z * k * 1.1);
  }
  g.computeVertexNormals();
  b.push();
  b.translate(0, 5.0, 0);
  b.geometry(g, '#ffffff', { colorFn: (x, y, z) => new THREE.Color().setScalar(0.72 + 0.28 * clamp((y + 2.5) / 5, 0, 1)) });
  b.pop();
  return b.toGeometry();
}
function pineGeometry(rng) {
  const b = new GeoBuilder();
  b.pattern(PAT.BARK, 0);
  const pts = [[0, -0.3, 0], [0.3, 1.2, 0.1], [-0.2, 2.6, 0.2], [0.5, 3.8, -0.1], [0.2, 4.8, 0]];
  b.tube(pts, [0.3, 0.24, 0.2, 0.15, 0.1], 7, '#5a4436');
  b.pattern(PAT.NONE, 0);
  const pads = [[0.9, 2.2, 0.4, 1.5], [-1.0, 3.0, -0.3, 1.3], [0.7, 3.9, -0.8, 1.2], [0.2, 4.9, 0.1, 1.1], [-0.6, 4.2, 0.9, 0.9]];
  for (const [x, y, z, r] of pads) {
    b.tube([[pts[2][0], y - 0.3, pts[2][2]], [x, y, z]], 0.07, 4, '#5a4436');
    b.sphere(x, y + 0.15, z, r, 9, 5, '#365a35', { sy: 0.42, bottomColor: '#24402a' });
  }
  return b.toGeometry();
}
function bushGeometry(rng) {
  const b = new GeoBuilder();
  b.pattern(PAT.NONE, 0);
  for (let k = 0; k < 3; k++) {
    const g = new THREE.IcosahedronGeometry(0.7 + k * 0.1, 1);
    b.push();
    b.translate((k - 1) * 0.55, 0.45, (k % 2) * 0.3);
    b.scale(1, 0.75, 1);
    b.geometry(g, '#ffffff', { colorFn: (x, y, z) => (noise2(x * 5 + k, z * 5 + y * 3) > 0.25 ? new THREE.Color('#d9478a') : new THREE.Color().setScalar(0.65 + 0.3 * (y + 0.7))) });
    b.pop();
  }
  return b.toGeometry();
}
function bambooStalkGeometry() {
  const b = new GeoBuilder();
  b.pattern(PAT.BAMBOO, 0);
  b.cylinder(0, -0.3, 0, 0.055, 0.075, 13, 6, '#8fae5a');
  return b.toGeometry();
}
function bambooLeafGeometry(rng) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  for (let k = 0; k < 16; k++) {
    const y = rng.float(7, 13.2);
    const a = rng.float(0, Math.PI * 2), r = rng.float(0.4, 1.8);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const s = rng.float(1.4, 2.2);
    const ang = rng.float(0, Math.PI * 2);
    const tilt = rng.float(-0.6, 0.6);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const base = pos.length / 3;
    const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let q = 0; q < 4; q++) {
      const lx = quad[q][0] * s * 0.5, ly = quad[q][1] * s * 0.5;
      pos.push(x + lx * ca, y + ly * Math.cos(tilt), z + lx * sa + ly * Math.sin(tilt));
      const nx = x, nz = z, nl = Math.hypot(nx, 0.5, nz);
      nor.push(nx / nl, 0.5 / nl, nz / nl);
      uv.push(quad[q][0] * 0.5 + 0.5, quad[q][1] * 0.5 + 0.5);
      const c = 0.75 + 0.25 * ((y - 7) / 6);
      col.push(c, c, c);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---------- 森林管理：把所有树实例化 ----------
export class Forest {
  constructor(blossomTex, leafTex, quality) {
    this.group = new THREE.Group();
    this.group.name = 'trees';
    this.blossomTex = blossomTex;
    this.leafTex = leafTex;
    this.quality = quality;
    this.trunkMat = createTrunkMaterial();
    this.blossomMat = createBlossomMaterial(blossomTex, { alphaToCoverage: quality.msaa > 0 });
    this.leafMat = createBlossomMaterial(leafTex, { alphaToCoverage: quality.msaa > 0 });
    this.foliageMat = createFoliageMaterial({ sway: 0.02, key: 'trees' });
    this.sakura = []; // {x,y,z,rot,scale,lit}
    this.other = { cedar: [], broad: [], yama: [], pine: [], bush: [], maple: [], bamboo: [] };
    this.ancient = null;
  }
  addSakura(x, y, z, scale = 1, lit = 0, rng) {
    this.sakura.push({ x, y, z, rot: rng.float(0, Math.PI * 2), scale, lit });
  }
  add(kind, x, y, z, scale = 1, rng, rot) {
    this.other[kind].push({ x, y, z, rot: rot ?? rng.float(0, Math.PI * 2), scale });
  }
  build(rng) {
    const VARIANTS = 3;
    const cards = Math.round(11 * this.quality.cards);
    // 樱花
    const variants = [];
    for (let v = 0; v < VARIANTS; v++) {
      const r = new RNG(900 + v * 17);
      const skel = sakuraSkeleton(r);
      variants.push({
        trunk: buildTrunkGeometry(skel, '#55423c'),
        canopy: buildCanopyGeometry(skel, r, { cards, pink: v % 2 ? '#ffd3de' : '#ffe1e8' }),
        list: [],
      });
    }
    this.sakura.forEach((t, i) => variants[i % VARIANTS].list.push(t));
    const tint = new THREE.Color();
    // 按 120 米网格拆分实例，便于视锥剔除（阴影相机也只画附近的几组）
    const split = (list, cell) => {
      const m = new Map();
      for (const t of list) {
        const k = Math.floor(t.x / cell) + ',' + Math.floor(t.z / cell);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(t);
      }
      return [...m.values()];
    };
    const groups = [];
    for (const v of variants) for (const list of split(v.list, 150)) groups.push({ trunk: v.trunk, canopy: v.canopy, list });
    for (const v of groups) {
      if (!v.list.length) continue;
      const n = v.list.length;
      const tm = new THREE.InstancedMesh(v.trunk, this.trunkMat, n);
      const cm = new THREE.InstancedMesh(v.canopy, this.blossomMat, n);
      const lit = new Float32Array(n);
      v.list.forEach((t, i) => {
        _q.setFromAxisAngle(_up, t.rot);
        _s.setScalar(t.scale);
        _p.set(t.x, t.y - 0.1, t.z);
        _m.compose(_p, _q, _s);
        tm.setMatrixAt(i, _m);
        cm.setMatrixAt(i, _m);
        tint.setRGB(1, 0.97 + rng.float(-0.04, 0.03), 0.98 + rng.float(-0.04, 0.02));
        cm.setColorAt(i, tint);
        lit[i] = t.lit;
      });
      // 每组需要独立的几何体实例属性：克隆一份共享顶点数据的几何体
      const cg = v.canopy.clone();
      cg.setAttribute('aLit', new THREE.InstancedBufferAttribute(lit, 1));
      cm.geometry = cg;
      for (const m of [tm, cm]) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.computeBoundingSphere();
        m.name = 'sakura';
        this.group.add(m);
      }
    }
    // 千年桜
    if (this.ancient) {
      const w = buildWeepingTree(new RNG(1000));
      const a = this.ancient;
      const tm = new THREE.Mesh(w.trunk, this.trunkMat);
      const ancientMat = createBlossomMaterial(this.blossomTex, { alphaToCoverage: this.quality.msaa > 0 });
      // 垂枝：越低摆动越大
      const prev = ancientMat.onBeforeCompile;
      ancientMat.onBeforeCompile = (shader) => {
        prev(shader);
        shader.vertexShader = shader.vertexShader.replace(
          'float amp = (0.03 + uGust * 0.09) * smoothstep(0.5, 6.0, position.y);',
          'float amp = (0.05 + uGust * 0.2) * (0.3 + smoothstep(10.0, 2.0, position.y) * 1.4);'
        );
      };
      ancientMat.customProgramCacheKey = () => 'ancientBlossom';
      const cm = new THREE.Mesh(w.canopy, ancientMat);
      for (const m of [tm, cm]) {
        m.position.set(a.x, a.y - 0.2, a.z);
        m.rotation.y = 0.6;
        m.scale.setScalar(1.18);
        m.castShadow = true;
        m.receiveShadow = true;
        m.name = 'ancient';
        this.group.add(m);
      }
    }
    // 其它树种
    const mk = (geo, all, mat, colorFn, shadow = true) => {
      if (!all.length) return null;
      // 近处（城镇范围）分小组并投射阴影；远山大组、不投影
      const near = all.filter((t) => Math.hypot(t.x - 10, t.z) < 340);
      const far = all.filter((t) => Math.hypot(t.x - 10, t.z) >= 340);
      const parts = [...split(near, 170).map((l) => [l, shadow]), ...split(far, 650).map((l) => [l, false])];
      for (const [list, sh] of parts) {
        const m = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((t, i) => {
          _q.setFromAxisAngle(_up, t.rot);
          _s.setScalar(t.scale);
          _p.set(t.x, t.y - 0.15, t.z);
          _m.compose(_p, _q, _s);
          m.setMatrixAt(i, _m);
          if (colorFn) m.setColorAt(i, colorFn(t, i));
        });
        m.castShadow = sh;
        m.receiveShadow = true;
        m.computeBoundingSphere();
        this.group.add(m);
      }
      return true;
    };
    const cr = new RNG(77);
    mk(cedarGeometry(cr), this.other.cedar, this.foliageMat, (t) => tint.setRGB(0.85 + cr.float(0, 0.2), 0.9 + cr.float(0, 0.15), 0.85 + cr.float(0, 0.15)).clone(), true);
    const spring = ['#a9c46a', '#8fb35a', '#b8c978', '#7fa452', '#c4cf86'];
    mk(broadleafGeometry(cr), this.other.broad, this.foliageMat, () => new THREE.Color(cr.pick(spring)), true);
    mk(broadleafGeometry(cr, 0.9), this.other.yama, this.foliageMat, () => new THREE.Color(cr.pick(['#f2d7dc', '#ead0c8', '#f6e4e6', '#e7c2c6'])), true);
    mk(broadleafGeometry(cr, 0.8), this.other.maple, this.foliageMat, () => new THREE.Color(cr.pick(['#a8463c', '#b8574a', '#9b3b38'])), true);
    mk(pineGeometry(cr), this.other.pine, this.foliageMat, null, true);
    mk(bushGeometry(cr), this.other.bush, this.foliageMat, () => new THREE.Color(cr.pick(['#6f9a52', '#5e8a48', '#7aa65a'])), false);
    if (this.other.bamboo.length) {
      mk(bambooStalkGeometry(), this.other.bamboo, this.trunkMat, null, true);
      mk(bambooLeafGeometry(new RNG(5)), this.other.bamboo, this.leafMat, () => new THREE.Color().setScalar(0.85 + cr.float(0, 0.2)), true);
    }
    return this.group;
  }
}
