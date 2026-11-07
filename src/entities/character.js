import * as THREE from 'three';
import { GeoBuilder, PAT, C } from '../render/builder.js';
import { lerp, clamp, damp, smoothstep } from '../core/math.js';

// 程序化角色：用基本体搭成，再绑定到一副骨骼上（一个 SkinnedMesh = 一次绘制）
// 骨骼索引
const B = { root: 0, hips: 1, spine: 2, chest: 3, neck: 4, head: 5, uArmL: 6, fArmL: 7, uArmR: 8, fArmR: 9, thighL: 10, shinL: 11, footL: 12, thighR: 13, shinR: 14, footR: 15 };
const BONES = [
  ['root', -1, [0, 0, 0]],
  ['hips', 0, [0, 0.8, 0]],
  ['spine', 1, [0, 0.12, 0]],
  ['chest', 2, [0, 0.16, 0]],
  ['neck', 3, [0, 0.19, 0]],
  ['head', 4, [0, 0.07, 0]],
  ['uArmL', 3, [0.17, 0.16, 0]],
  ['fArmL', 6, [0, -0.26, 0]],
  ['uArmR', 3, [-0.17, 0.16, 0]],
  ['fArmR', 8, [0, -0.26, 0]],
  ['thighL', 1, [0.085, -0.02, 0]],
  ['shinL', 10, [0, -0.37, 0]],
  ['footL', 11, [0, -0.36, 0]],
  ['thighR', 1, [-0.085, -0.02, 0]],
  ['shinR', 13, [0, -0.37, 0]],
  ['footR', 14, [0, -0.36, 0]],
];

// 骨骼的绑定姿势世界坐标
function bindPositions() {
  const out = [];
  BONES.forEach(([, parent, off], i) => {
    const p = parent < 0 ? [0, 0, 0] : out[parent];
    out[i] = [p[0] + off[0], p[1] + off[1], p[2] + off[2]];
  });
  return out;
}
const BP = bindPositions();

export const LOOKS = {
  traveler: { skin: '#f6dcc8', hair: '#3b2a26', hairStyle: 'bob', top: '#f1e6cf', topAccent: '#e8a1ae', bottom: 'longskirt', bottomColor: '#7d9a8a', shoes: '#6b4a36', hat: 'straw', bag: '#a8794f', scarf: '#d87a8a' },
  miko: { skin: '#f7ddca', hair: '#1f1a1a', hairStyle: 'long', top: '#fbfaf6', topAccent: '#d23a2c', bottom: 'hakama', bottomColor: '#c8322a', shoes: '#f4f1ea', hat: 'none' },
  oldman: { skin: '#e8c7ad', hair: '#d9d6d0', hairStyle: 'bald', top: '#5d6b74', bottom: 'pants', bottomColor: '#4a4a4f', shoes: '#3a3330', hat: 'cap', capColor: '#7a7062', scale: 0.96, hunch: 0.22 },
  okami: { skin: '#f3d7c3', hair: '#2d2321', hairStyle: 'bun', top: '#6a7fa0', topAccent: '#f2efe6', bottom: 'longskirt', bottomColor: '#3f4a5c', shoes: '#4a3b30', apron: '#f4efe4' },
  stationman: { skin: '#efcfb7', hair: '#2a2420', hairStyle: 'short', top: '#2f3d55', bottom: 'pants', bottomColor: '#2a3346', shoes: '#1e1e22', hat: 'cap', capColor: '#2a3550' },
  painter: { skin: '#f0d1bb', hair: '#6b4a36', hairStyle: 'ponytail', top: '#d9c8a5', topAccent: '#8a6f4f', bottom: 'pants', bottomColor: '#5b6b5a', shoes: '#5a4434', hat: 'beret', capColor: '#7a2f36' },
  student: { skin: '#f6dbc6', hair: '#2a201d', hairStyle: 'twintail', top: '#24324f', topAccent: '#f6f4ee', bottom: 'skirt', bottomColor: '#24324f', shoes: '#2b2220', scarf: '#c8323a', scale: 0.94 },
  granny: { skin: '#ecc9b0', hair: '#cfcac4', hairStyle: 'bun', top: '#8a6f8e', bottom: 'longskirt', bottomColor: '#5d5266', shoes: '#4a3b30', scale: 0.9, hunch: 0.28 },
  kid: { skin: '#f7dcc6', hair: '#2a201d', hairStyle: 'short', top: '#f2b64a', bottom: 'shorts', bottomColor: '#3f5f8a', shoes: '#e9e6e0', hat: 'cap', capColor: '#e05a3a', scale: 0.68 },
  monk: { skin: '#e9c9b0', hair: '#e9c9b0', hairStyle: 'bald', top: '#3a3a40', topAccent: '#b58a3c', bottom: 'hakama', bottomColor: '#3a3a40', shoes: '#efe9dc' },
  photographer: { skin: '#f2d4bf', hair: '#4a3328', hairStyle: 'short', top: '#7b8b6a', bottom: 'pants', bottomColor: '#3f3a36', shoes: '#5a4434', hat: 'bucket', capColor: '#c9bfa8', bag: '#3a3a3a' },
  hanamiA: { skin: '#f4d6c2', hair: '#3b2a26', hairStyle: 'bob', top: '#e9a3b6', bottom: 'pants', bottomColor: '#5a6680', shoes: '#f0f0f0' },
  hanamiB: { skin: '#eccab2', hair: '#1f1a1a', hairStyle: 'short', top: '#9fc2d6', bottom: 'pants', bottomColor: '#2f3a4a', shoes: '#3a3330' },
  hanamiC: { skin: '#f6dbc6', hair: '#6b4a36', hairStyle: 'ponytail', top: '#f3e7b0', bottom: 'skirt', bottomColor: '#b67b5a', shoes: '#6b4a36' },
};

function partBuilder() {
  return new GeoBuilder();
}

// 构建角色几何：每个部件指定所属骨骼
function buildBody(look) {
  const parts = []; // [builder, boneIndex]
  const P = (bone) => {
    const b = partBuilder();
    parts.push([b, bone]);
    return b;
  };
  const skin = C(look.skin), hair = C(look.hair), top = C(look.top);
  const accent = look.topAccent ? C(look.topAccent) : top;
  const botC = C(look.bottomColor || '#555');
  const shoe = C(look.shoes || '#333');
  // 头
  {
    const b = P(B.head);
    const hc = [0, BP[B.head][1] + 0.15, 0];
    b.pattern(PAT.NONE, 0);
    b.sphere(hc[0], hc[1], hc[2], 0.155, 16, 12, skin, { sy: 1.04 });
    // 眼睛与腮红
    for (const sx of [-1, 1]) {
      b.sphere(sx * 0.055, hc[1] - 0.005, 0.138, 0.024, 8, 6, '#2b2220', { sy: 1.35, sz: 0.5 });
      b.sphere(sx * 0.05, hc[1] + 0.008, 0.149, 0.007, 4, 3, '#ffffff');
      b.sphere(sx * 0.085, hc[1] - 0.05, 0.125, 0.026, 8, 4, '#f2a2a8', { sz: 0.35, sy: 0.6 });
    }
    b.sphere(0, hc[1] - 0.07, 0.146, 0.012, 6, 4, '#d77c7c', { sy: 0.5, sz: 0.4 });
    // 头发
    if (look.hairStyle !== 'bald') {
      b.sphere(hc[0], hc[1] + 0.02, hc[2] - 0.012, 0.168, 16, 10, hair, { hemi: true, sy: 1.05 });
      // 后脑
      b.sphere(hc[0], hc[1] - 0.02, hc[2] - 0.03, 0.163, 14, 10, hair, { sy: 1.0, sz: 0.95 });
      // 刘海
      b.push();
      b.translate(0, hc[1] + 0.07, 0.11);
      b.rotateX(0.5);
      b.box(0, -0.03, 0, 0.27, 0.07, 0.07, hair);
      b.pop();
      if (look.hairStyle === 'bob' || look.hairStyle === 'long') {
        for (const sx of [-1, 1]) b.box(sx * 0.14, hc[1] - 0.14, -0.02, 0.06, 0.2, 0.22, hair);
        b.box(0, hc[1] - 0.15, -0.1, 0.3, 0.22, 0.1, hair);
      }
      if (look.hairStyle === 'long') b.box(0, hc[1] - 0.42, -0.12, 0.28, 0.42, 0.07, hair);
      if (look.hairStyle === 'ponytail') {
        b.sphere(0, hc[1] + 0.04, -0.17, 0.05, 8, 6, hair);
        b.tube([[0, hc[1] + 0.02, -0.19], [0, hc[1] - 0.12, -0.24], [0, hc[1] - 0.3, -0.2]], [0.05, 0.045, 0.02], 6, hair);
      }
      if (look.hairStyle === 'twintail') {
        for (const sx of [-1, 1]) b.tube([[sx * 0.15, hc[1] + 0.02, -0.06], [sx * 0.2, hc[1] - 0.14, -0.07], [sx * 0.17, hc[1] - 0.3, -0.05]], [0.045, 0.04, 0.015], 6, hair);
      }
      if (look.hairStyle === 'bun') b.sphere(0, hc[1] + 0.13, -0.1, 0.07, 10, 8, hair);
    }
    // 帽子
    if (look.hat === 'straw') {
      b.cylinder(0, hc[1] + 0.07, -0.01, 0.31, 0.31, 0.012, 20, '#e6cf98', { bottom: true });
      b.sphere(0, hc[1] + 0.075, -0.01, 0.165, 14, 6, '#e3c98e', { hemi: true, sy: 0.75 });
      b.cylinder(0, hc[1] + 0.075, -0.01, 0.168, 0.168, 0.035, 16, look.scarf || '#d87a8a', { caps: false });
    } else if (look.hat === 'cap') {
      b.sphere(0, hc[1] + 0.05, -0.01, 0.172, 14, 6, look.capColor || '#3a4a6a', { hemi: true, sy: 0.85 });
      b.box(0, hc[1] + 0.05, 0.17, 0.2, 0.02, 0.12, look.capColor || '#3a4a6a');
    } else if (look.hat === 'beret') {
      b.sphere(0.02, hc[1] + 0.11, -0.02, 0.17, 14, 6, look.capColor, { sy: 0.4 });
    } else if (look.hat === 'bucket') {
      b.cylinder(0, hc[1] + 0.06, -0.01, 0.17, 0.25, 0.08, 16, look.capColor, { bottom: true });
      b.cylinder(0, hc[1] + 0.12, -0.01, 0.16, 0.17, 0.1, 16, look.capColor);
    }
  }
  // 颈
  {
    const b = P(B.neck);
    b.cylinder(0, BP[B.neck][1] - 0.02, 0, 0.045, 0.05, 0.12, 8, skin);
  }
  // 躯干
  {
    const b = P(B.chest);
    const y0 = BP[B.spine][1], y1 = BP[B.neck][1] + 0.02;
    b.lathe(0, 0, [[0.12, y0 - 0.02], [0.14, y0 + 0.08], [0.155, y0 + 0.2], [0.15, y1 - 0.05], [0.07, y1]], 14, top);
    if (look.topAccent) {
      // 前襟/领口装饰
      b.box(0, y0 + 0.05, 0.135, 0.05, y1 - y0 - 0.1, 0.025, accent);
    }
    if (look.scarf && look.hat !== 'straw') b.cylinder(0, y1 - 0.06, 0, 0.09, 0.13, 0.07, 12, look.scarf);
    if (look.scarf && look.hat === 'straw') b.cylinder(0, y1 - 0.06, 0, 0.085, 0.12, 0.06, 12, look.scarf);
    if (look.apron) b.box(0, y0 - 0.05, 0.13, 0.24, 0.28, 0.02, look.apron);
    if (look.bag) {
      b.tube([[0.13, y1 - 0.02, 0.06], [0.02, y0 + 0.1, 0.15], [-0.15, y0 - 0.08, 0.05]], 0.012, 4, '#5a4030');
    }
  }
  {
    const b = P(B.hips);
    const y = BP[B.hips][1];
    b.lathe(0, 0, [[0.115, y - 0.07], [0.13, y + 0.02], [0.125, y + 0.12]], 14, look.bottom === 'pants' || look.bottom === 'shorts' ? botC : top);
    if (look.bag) b.box(-0.17, y - 0.05, 0.03, 0.07, 0.17, 0.2, look.bag);
    if (look.bottom === 'skirt') b.lathe(0, 0, [[0.13, y + 0.06], [0.2, y - 0.12], [0.24, y - 0.3], [0.0, y - 0.3]], 16, botC);
    if (look.bottom === 'longskirt') b.lathe(0, 0, [[0.13, y + 0.06], [0.2, y - 0.2], [0.25, y - 0.62], [0.0, y - 0.62]], 16, botC);
    if (look.bottom === 'hakama') b.lathe(0, 0, [[0.14, y + 0.08], [0.23, y - 0.25], [0.29, y - 0.72], [0.0, y - 0.72]], 16, botC);
  }
  // 手臂
  for (const [u, f, sx] of [[B.uArmL, B.fArmL, 1], [B.uArmR, B.fArmR, -1]]) {
    const pu = BP[u], pf = BP[f];
    const sleeve = look.bottom === 'hakama' && look.top === '#fbfaf6' ? top : top;
    const bu = P(u);
    bu.sphere(pu[0], pu[1] - 0.01, 0, 0.055, 8, 6, top);
    bu.cylinder(pu[0], pf[1], 0, 0.052, 0.045, pu[1] - pf[1], 8, sleeve);
    if (look.hairStyle && (look.bottom === 'hakama')) bu.cylinder(pu[0] + sx * 0.02, pf[1] - 0.1, 0, 0.09, 0.075, 0.3, 10, sleeve);
    const bf = P(f);
    bf.cylinder(pf[0], pf[1] - 0.22, 0, 0.04, 0.042, 0.22, 8, look.long === false ? skin : top);
    bf.cylinder(pf[0], pf[1] - 0.24, 0, 0.034, 0.036, 0.04, 8, skin);
    bf.sphere(pf[0], pf[1] - 0.27, 0.005, 0.042, 8, 6, skin, { sy: 1.15 });
  }
  // 腿
  for (const [t, s, ft] of [[B.thighL, B.shinL, B.footL], [B.thighR, B.shinR, B.footR]]) {
    const pt = BP[t], ps = BP[s], pf = BP[ft];
    const legC = look.bottom === 'pants' ? botC : look.bottom === 'shorts' ? skin : look.bottom === 'hakama' ? botC : C('#e9dccd');
    const bt = P(t);
    bt.cylinder(pt[0], ps[1], 0, 0.065, 0.055, pt[1] - ps[1], 8, look.bottom === 'shorts' ? botC : legC);
    const bs = P(s);
    bs.cylinder(ps[0], pf[1], 0, 0.052, 0.042, ps[1] - pf[1], 8, legC);
    const bf = P(ft);
    bf.sphere(pf[0], pf[1] - 0.03, 0.035, 0.055, 8, 6, shoe, { sz: 1.6, sy: 0.6 });
  }
  // 合并并写入蒙皮属性
  const pos = [], nor = [], col = [], pat = [], idx = [], si = [], sw = [];
  let off = 0;
  for (const [b, bone] of parts) {
    for (let i = 0; i < b.pos.length; i++) pos.push(b.pos[i]);
    for (let i = 0; i < b.nor.length; i++) nor.push(b.nor[i]);
    for (let i = 0; i < b.col.length; i++) col.push(b.col[i]);
    for (let i = 0; i < b.pat.length; i++) pat.push(b.pat[i]);
    for (const k of b.idx) idx.push(k + off);
    const n = b.vcount;
    for (let i = 0; i < n; i++) {
      si.push(bone, 0, 0, 0);
      sw.push(1, 0, 0, 0);
    }
    off += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aPat', new THREE.Float32BufferAttribute(pat, 4));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const geoCache = new Map();

export class Character {
  constructor(lookName, material) {
    const look = typeof lookName === 'string' ? LOOKS[lookName] : lookName;
    this.look = look;
    const key = typeof lookName === 'string' ? lookName : JSON.stringify(lookName);
    let geo = geoCache.get(key);
    if (!geo) {
      geo = buildBody(look);
      geoCache.set(key, geo);
    }
    const bones = BONES.map(([name, parent, off]) => {
      const bn = new THREE.Bone();
      bn.name = name;
      bn.position.set(off[0], off[1], off[2]);
      return bn;
    });
    BONES.forEach(([, parent], i) => {
      if (parent >= 0) bones[parent].add(bones[i]);
    });
    this.bones = bones;
    const mesh = new THREE.SkinnedMesh(geo, material);
    mesh.add(bones[0]);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.mesh = mesh;
    this.root = new THREE.Group();
    this.root.add(mesh);
    const sc = look.scale || 1;
    mesh.scale.setScalar(sc);
    this.scale = sc;
    this.phase = Math.random() * 6;
    this.blink = 0;
    this.state = 'idle';
    this.speed = 0;
    this.t = Math.random() * 10;
    this.lookYaw = 0;
    this.extra = null; // 手持物
    this.anim = { lean: 0, crouch: 0, sit: 0, sitG: 0, armUp: 0, sweep: 0, wave: 0, fish: 0, jump: 0, pet: 0, paint: 0, gaze: 0 };
  }
  attach(obj, bone = 'fArmR') {
    const b = this.bones.find((x) => x.name === bone);
    b.add(obj);
    return obj;
  }
  // 程序化动画
  update(dt, st = {}) {
    const a = this.anim;
    this.t += dt;
    const speed = st.speed ?? 0;
    const target = {
      sit: st.sit ? 1 : 0, sitG: st.sitG ? 1 : 0, crouch: st.crouch ? 1 : 0, sweep: st.sweep ? 1 : 0, wave: st.wave ? 1 : 0,
      fish: st.fish ? 1 : 0, jump: st.air ? 1 : 0, pet: st.pet ? 1 : 0, paint: st.paint ? 1 : 0, gaze: st.gaze ? 1 : 0,
    };
    for (const k in target) a[k] = damp(a[k], target[k], 8, dt);
    const run = clamp((speed - 3.5) / 3, 0, 1);
    const walkAmt = clamp(speed / 1.4, 0, 1) * (1 - a.sit);
    const stride = lerp(1.25, 2.1, run);
    this.phase += (speed / stride) * Math.PI * 2 * dt * (st.air ? 0.3 : 1);
    const ph = this.phase;
    const s = Math.sin(ph), c = Math.cos(ph);
    const bones = this.bones;
    const amp = lerp(0.48, 0.85, run) * walkAmt;
    const hunch = this.look.hunch || 0;
    const breathe = Math.sin(this.t * 1.7) * 0.02;
    // 下肢
    bones[B.thighL].rotation.set(-s * amp - a.sit * 1.5 - a.crouch * 1.2 - a.jump * 0.5 - a.fish * 1.5 - a.sitG * 1.45, 0, a.sitG * 0.12);
    bones[B.thighR].rotation.set(s * amp - a.sit * 1.5 - a.crouch * 1.1 - a.jump * 0.2 - a.fish * 1.5 - a.sitG * 1.4, 0, -a.sitG * 0.12);
    bones[B.shinL].rotation.set(Math.max(0, c) * amp * 1.3 + a.sit * 1.5 + a.crouch * 2.0 + a.jump * 0.9 + a.fish * 1.5 + a.sitG * 0.25, 0, 0);
    bones[B.shinR].rotation.set(Math.max(0, -c) * amp * 1.3 + a.sit * 1.5 + a.crouch * 1.9 + a.jump * 0.4 + a.fish * 1.5 + a.sitG * 0.5, 0, 0);
    bones[B.footL].rotation.set(-a.crouch * 0.8, 0, 0);
    bones[B.footR].rotation.set(-a.crouch * 0.8, 0, 0);
    // 躯干
    const bob = Math.abs(s) * 0.035 * walkAmt * (1 + run);
    bones[B.hips].position.y = BP[B.hips][1] + bob - a.sit * 0.36 - a.crouch * 0.38 - a.fish * 0.36 - a.sitG * 0.7;
    bones[B.hips].rotation.set(0, s * 0.12 * walkAmt, 0);
    bones[B.spine].rotation.set(run * 0.22 + hunch + a.crouch * 0.35 + a.pet * 0.1 + a.sweep * 0.12 + a.fish * 0.15 - a.gaze * 0.15, -s * 0.1 * walkAmt, 0);
    bones[B.chest].rotation.set(breathe + a.lean, 0, 0);
    // 头：可看向目标
    this.lookYaw = damp(this.lookYaw, st.lookYaw || 0, 4, dt);
    bones[B.head].rotation.set(-hunch * 0.6 - a.gaze * 0.7 + Math.sin(this.t * 0.6) * 0.03, this.lookYaw + Math.sin(this.t * 0.37) * 0.08 * (1 - walkAmt), 0);
    // 上肢
    const arm = lerp(0.42, 0.9, run) * walkAmt;
    let lu = s * arm, ru = -s * arm;
    let lf = -0.15 - run * 0.9 * walkAmt, rf = -0.15 - run * 0.9 * walkAmt;
    let lz = 0.06, rz = -0.06;
    // 扫地
    if (a.sweep > 0.01) {
      const sw = Math.sin(this.t * 2.2);
      lu = lerp(lu, -0.7 + sw * 0.25, a.sweep);
      ru = lerp(ru, -0.4 + sw * 0.25, a.sweep);
      lf = lerp(lf, -0.6, a.sweep);
      rf = lerp(rf, -0.5, a.sweep);
      lz = lerp(lz, -0.25, a.sweep);
      rz = lerp(rz, 0.25, a.sweep);
    }
    // 坐（席地）
    if (a.sitG > 0.01) {
      lu = lerp(lu, -0.25, a.sitG);
      ru = lerp(ru, 0.3 + Math.sin(this.t * 0.7) * 0.05, a.sitG);
      lf = lerp(lf, -1.0, a.sitG);
      rf = lerp(rf, -0.2, a.sitG);
      rz = lerp(rz, -0.25, a.sitG);
    }
    // 坐
    if (a.sit > 0.01) {
      lu = lerp(lu, -0.35, a.sit);
      ru = lerp(ru, -0.35, a.sit);
      lf = lerp(lf, -0.9, a.sit);
      rf = lerp(rf, -0.9, a.sit);
      lz = lerp(lz, -0.1, a.sit);
      rz = lerp(rz, 0.1, a.sit);
    }
    // 钓鱼
    if (a.fish > 0.01) {
      ru = lerp(ru, -1.1 + Math.sin(this.t * 0.8) * 0.04, a.fish);
      rf = lerp(rf, -0.4, a.fish);
      lu = lerp(lu, -0.9, a.fish);
      lf = lerp(lf, -0.6, a.fish);
    }
    // 抚摸
    if (a.pet > 0.01) {
      ru = lerp(ru, -1.25, a.pet);
      rf = lerp(rf, -0.25 + Math.sin(this.t * 5) * 0.2, a.pet);
      rz = lerp(rz, 0.15, a.pet);
    }
    // 挥手
    if (a.wave > 0.01) {
      lu = lerp(lu, -2.6, a.wave);
      lz = lerp(lz, 0.3 + Math.sin(this.t * 9) * 0.35, a.wave);
      lf = lerp(lf, -0.3, a.wave);
    }
    // 作画
    if (a.paint > 0.01) {
      ru = lerp(ru, -1.4 + Math.sin(this.t * 1.3) * 0.2, a.paint);
      rf = lerp(rf, -0.5 + Math.sin(this.t * 2.1) * 0.2, a.paint);
      rz = lerp(rz, Math.sin(this.t * 1.7) * 0.2, a.paint);
      lu = lerp(lu, -0.5, a.paint);
      lf = lerp(lf, -1.2, a.paint);
    }
    // 跳跃
    if (a.jump > 0.01) {
      lz = lerp(lz, 0.5, a.jump);
      rz = lerp(rz, -0.5, a.jump);
      lu = lerp(lu, -0.4, a.jump);
      ru = lerp(ru, -0.4, a.jump);
    }
    // 仰望：双手背后
    if (a.gaze > 0.01) {
      lu = lerp(lu, 0.35, a.gaze);
      ru = lerp(ru, 0.35, a.gaze);
      lf = lerp(lf, -0.6, a.gaze);
      rf = lerp(rf, -0.6, a.gaze);
    }
    bones[B.uArmL].rotation.set(lu, 0, lz);
    bones[B.uArmR].rotation.set(ru, 0, rz);
    bones[B.fArmL].rotation.set(lf, 0, 0);
    bones[B.fArmR].rotation.set(rf, 0, 0);
  }
}

export { B as BONE };
