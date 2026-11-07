import * as THREE from 'three';
import { PAT, C, vary, mulColor } from '../render/builder.js';
import { signQuad } from './textures.js';
import { lanternGeometry } from './roads.js';
import { ROADS, roadGrid, railQuery, riverNearest, riverHalfWidth, excluded } from './layout.js';
import { RNG, pointAt, lerp, clamp } from '../core/math.js';

export const VERMILION = '#c9452e';
export const VERM_DARK = '#7a2a1d';

// 明神鸟居：局部原点为两柱中点地面，横梁沿 x
export function torii(b, s = 1, color = VERMILION, opt = {}) {
  const w = 3.0 * s, h = 3.6 * s, r = 0.17 * s;
  const black = '#26201c';
  b.pattern(PAT.NONE, 0);
  for (const sx of [-1, 1]) {
    b.cylinder((sx * w) / 2, 0, 0, r * 0.9, r, h, 10, color);
    b.cylinder((sx * w) / 2, 0, 0, r * 1.18, r * 1.25, 0.35 * s, 10, black);
  }
  // 贯
  b.box(0, h * 0.72, 0, w + 0.9 * s, 0.2 * s, 0.16 * s, color);
  // 島木 + 笠木（两端上翘）
  b.box(0, h - 0.02 * s, 0, w + 1.2 * s, 0.22 * s, 0.3 * s, color);
  const L = (w + 1.9 * s) / 2;
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8 * 2 - 1;
    pts.push([t * L, h + 0.3 * s + Math.pow(Math.abs(t), 3) * 0.32 * s, 0]);
  }
  b.tube(pts, 0.15 * s, 6, black);
  // 额束
  b.box(0, h * 0.72 + 0.1 * s, 0, 0.18 * s, h * 0.28 - 0.1 * s, 0.14 * s, color);
  if (opt.plaque) opt.plaqueAt = [0, h * 0.86, 0.12 * s];
  return { w, h };
}

// 春日石灯笼
export function stoneLantern(b, s = 1, lit = 0.85) {
  const st = '#a39e94', stD = '#8f897e';
  b.pattern(PAT.STONE, 0);
  b.box(0, 0, 0, 0.75 * s, 0.18 * s, 0.75 * s, stD);
  b.pattern(PAT.NONE, 0);
  b.cylinder(0, 0.18 * s, 0, 0.13 * s, 0.16 * s, 0.85 * s, 8, st);
  b.cylinder(0, 1.03 * s, 0, 0.36 * s, 0.3 * s, 0.14 * s, 6, stD);
  // 火袋（夜里亮）
  b.pattern(PAT.NONE, lit);
  b.box(0, 1.17 * s, 0, 0.36 * s, 0.38 * s, 0.36 * s, '#f6d9a0');
  b.pattern(PAT.NONE, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.17 * s, 1.17 * s, sz * 0.17 * s, 0.06 * s, 0.38 * s, 0.06 * s, st);
  // 笠
  b.cylinder(0, 1.55 * s, 0, 0.12 * s, 0.5 * s, 0.26 * s, 6, st, { bottom: true });
  b.sphere(0, 1.88 * s, 0, 0.1 * s, 6, 4, stD);
  return [0, 1.3 * s, 0];
}

// 狛犬（坐姿，石灰色）：朝 +z
export function komainu(b, s = 1, mouthOpen = true) {
  const st = '#9a958b';
  b.pattern(PAT.STONE, 0);
  b.box(0, 0, 0, 0.9 * s, 0.6 * s, 1.1 * s, '#8a857b');
  b.pattern(PAT.NONE, 0);
  b.sphere(0, 1.0 * s, -0.12 * s, 0.38 * s, 8, 6, st, { sy: 1.15 });
  b.sphere(0, 1.55 * s, 0.12 * s, 0.33 * s, 8, 6, st);
  b.sphere(0, 1.5 * s, 0.38 * s, 0.17 * s, 6, 4, st, { sz: 1.2 });
  b.sphere(0, 1.65 * s, -0.05 * s, 0.36 * s, 8, 5, mulColor(st, 0.9), { sy: 0.9 });
  for (const sx of [-1, 1]) {
    b.box(sx * 0.18 * s, 0.6 * s, 0.25 * s, 0.16 * s, 0.6 * s, 0.18 * s, st);
    b.sphere(sx * 0.14 * s, 1.62 * s, 0.4 * s, 0.05 * s, 4, 3, '#4a4640');
  }
  if (mouthOpen) b.box(0, 1.4 * s, 0.5 * s, 0.16 * s, 0.05 * s, 0.05 * s, '#5d3b33');
  b.sphere(0, 1.0 * s, -0.55 * s, 0.14 * s, 6, 4, st, { sy: 1.6 });
}

// 木长椅：朝 +z（人坐下后面向 +z）
export function bench(b, color = '#7a5a40') {
  b.pattern(PAT.PLANK, 0);
  b.box(0, 0.42, 0, 1.7, 0.07, 0.48, color);
  b.box(0, 0.48, -0.24, 1.7, 0.42, 0.06, color);
  b.pattern(PAT.NONE, 0);
  for (const sx of [-0.72, 0.72]) {
    b.box(sx, 0, 0.12, 0.07, 0.42, 0.07, '#3c3a38');
    b.box(sx, 0, -0.18, 0.07, 0.9, 0.07, '#3c3a38');
  }
}

// 自动售货机：朝 +z
export function vendingMachine(b, color = '#d8dde0') {
  b.pattern(PAT.NONE, 0);
  b.box(0, 0, 0, 1.0, 1.85, 0.75, color);
  b.pattern(PAT.VENDING, 1);
  b.quad([-0.47, 0.05, 0.381], [0.47, 0.05, 0.381], [0.47, 1.8, 0.381], [-0.47, 1.8, 0.381], color, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  b.pattern(PAT.NONE, 0);
  b.box(0, 1.85, 0.05, 1.05, 0.08, 0.85, mulColor(color, 0.8));
}

// 御朱印台：小木架 + 屋顶 + 红色印盒
export function stampStand(b, sb, atlas) {
  const wood = '#6a4a33';
  b.pattern(PAT.PLANK, 0);
  b.box(0, 0, 0, 0.9, 0.95, 0.6, wood);
  b.box(-0.4, 0, -0.25, 0.08, 1.9, 0.08, wood);
  b.box(0.4, 0, -0.25, 0.08, 1.9, 0.08, wood);
  b.pattern(PAT.KAWARA, 0);
  b.quad([-0.65, 1.85, 0.3], [0.65, 1.85, 0.3], [0.65, 2.1, -0.35], [-0.65, 2.1, -0.35], '#3e4350');
  b.quad([0.65, 1.84, 0.3], [-0.65, 1.84, 0.3], [-0.65, 2.09, -0.35], [0.65, 2.09, -0.35], '#4a3a2e');
  b.pattern(PAT.NONE, 0);
  b.box(0, 0.95, 0.05, 0.36, 0.12, 0.26, '#b8322a');
  b.box(0, 1.07, 0.05, 0.14, 0.1, 0.14, '#2a2420');
  const r = atlas.board('スタンプ', { bg: '#efe2c4', fg: '#9b2a22', px: 48, w: 300, h: 72 });
  sb.push();
  sb.translate(0, 1.55, -0.2);
  signQuad(sb, r, 0.78, 0.19, 0xffffff, 0.2, false);
  sb.pop();
}

// 路牌（木桩 + 若干方向板）：items [{text, angle}]
export function signpost(b, sb, atlas, items) {
  b.pattern(PAT.PLANK, 0);
  b.box(0, 0, 0, 0.14, 2.6, 0.14, '#6b4d36');
  items.forEach((it, i) => {
    const r = atlas.arrow(it.text, 1);
    sb.push();
    sb.rotateY(it.angle);
    sb.translate(0.62, 2.25 - i * 0.32, 0);
    signQuad(sb, r, 1.15, 0.25, 0xffffff, 0.1, false);
    sb.translate(0, 0, -0.012);
    sb.rotateY(Math.PI);
    signQuad(sb, atlas.arrow(it.text, -1), 1.15, 0.25, 0xffffff, 0.1, false);
    sb.pop();
  });
}

// 弧形反光镜（橙色杆）
export function curveMirror(b) {
  b.pattern(PAT.NONE, 0);
  b.cylinder(0, 0, 0, 0.05, 0.05, 2.9, 6, '#e0782c');
  b.push();
  b.translate(0, 2.75, 0.12);
  b.rotateX(-0.12);
  b.cylinder(0, 0, 0, 0.38, 0.38, 0.06, 14, '#e0782c', { bottom: true });
  b.pattern(PAT.WINDOW, 0);
  b.pop();
  b.pattern(PAT.NONE, 0);
  b.sphere(0, 2.8, 0.2, 0.33, 12, 6, '#b9c9d6', { sz: 0.25 });
}

// 红色邮筒
export function postbox(b) {
  b.pattern(PAT.NONE, 0);
  b.box(0, 0, 0, 0.32, 0.25, 0.32, '#5a5552');
  b.cylinder(0, 0.25, 0, 0.27, 0.27, 1.05, 12, '#c8352a');
  b.sphere(0, 1.3, 0, 0.27, 12, 4, '#c8352a', { hemi: true, sy: 0.45 });
  b.box(0, 1.0, 0.24, 0.22, 0.05, 0.06, '#2a2420');
}

// 自行车（妈妈车，带车篮）：沿 x
export function bicycle(b, color) {
  b.pattern(PAT.NONE, 0);
  const dark = '#2a2a2a';
  for (const x of [-0.52, 0.52]) {
    b.push();
    b.translate(x, 0.34, 0);
    b.geometry(new THREE.TorusGeometry(0.32, 0.025, 4, 14), dark);
    b.pop();
  }
  b.tube([[-0.52, 0.34, 0], [-0.05, 0.36, 0], [0.32, 0.82, 0], [0.52, 0.34, 0]], 0.025, 4, color);
  b.tube([[-0.05, 0.36, 0], [-0.18, 0.82, 0], [0.32, 0.82, 0]], 0.025, 4, color);
  b.box(-0.2, 0.84, 0, 0.24, 0.06, 0.12, dark);
  b.tube([[0.4, 0.82, 0], [0.42, 1.0, 0], [0.42, 1.02, -0.25], [0.42, 1.02, 0.25]], 0.02, 4, '#9a9a9a');
  b.box(0.62, 0.86, 0, 0.3, 0.2, 0.32, '#c9c9c9');
}

// 电线杆（含横担、绝缘子、可选变压器与路灯）：返回挂线点
export function utilityPole(b, rng, opt = {}) {
  const h = 10;
  b.pattern(PAT.NONE, 0);
  b.cylinder(0, 0, 0, 0.12, 0.17, h, 8, '#b4b0a8');
  // 横担
  const arms = [];
  for (const [y, w] of [[h - 0.45, 1.8], [h - 1.25, 1.5]]) {
    b.box(0, y, 0, w, 0.09, 0.1, '#7a7670');
    for (const x of [-w / 2 + 0.12, 0, w / 2 - 0.12]) {
      b.cylinder(x, y + 0.09, 0, 0.04, 0.05, 0.14, 6, '#e8e4dc');
      arms.push([x, y + 0.2, 0]);
    }
  }
  if (opt.transformer) {
    b.cylinder(0.32, h - 3.4, 0, 0.26, 0.26, 0.9, 10, '#9fa3a6');
    b.cylinder(0.32, h - 2.5, 0, 0.28, 0.28, 0.06, 10, '#7f8386');
  }
  // 低压线
  b.box(0, h - 3.0, 0, 0.9, 0.07, 0.07, '#6d6964');
  arms.push([-0.38, h - 2.85, 0], [0.38, h - 2.85, 0]);
  // 脚钉
  for (let i = 0; i < 9; i++) b.box(i % 2 ? 0.16 : -0.16, 2.0 + i * 0.6, 0, 0.18, 0.03, 0.03, '#6d6964');
  if (opt.lamp) {
    // 路灯伸向道路中央（局部 +x）
    b.tube([[0, h - 4.3, 0], [0.6, h - 4.0, 0], [1.5, h - 4.05, 0]], 0.04, 5, '#8a8782');
    b.pattern(PAT.NONE, 1);
    b.box(1.55, h - 4.18, 0, 0.42, 0.08, 0.18, '#fff4da');
    b.pattern(PAT.NONE, 0);
    b.box(1.55, h - 4.1, 0, 0.5, 0.09, 0.24, '#6f6c68');
  }
  return arms;
}

// 沿道路布置电线杆、路灯与电线；返回路灯位置
export function placeUtilityPoles(ctx) {
  const { chunks, colliders, terrain, rng } = ctx;
  const wires = [];
  const lamps = [];
  for (const r of ROADS) {
    if (r.type !== 'asphalt' || r.width < 4 || r.overlay) continue;
    const P = r.pts, A = r.acc, L = A[A.length - 1];
    let side = rng.sign();
    let prev = null;
    for (let s = rng.float(4, 12); s < L - 2; s += rng.float(27, 34)) {
      const pt = pointAt(P, A, s);
      const nx = pt.tz * side, nz = -pt.tx * side;
      const off = r.width / 2 + 0.55;
      const x = pt.x + nx * off, z = pt.z + nz * off;
      // 避开河道、建筑、桥与地标
      const rq = riverNearest(x, z);
      if (rq.d < riverHalfWidth(rq.s) + 4) {
        prev = null;
        continue;
      }
      if (excluded(x, z, 2) || (railQuery(x, z, 8) && railQuery(x, z, 8).d < 5)) {
        prev = null;
        continue;
      }
      const nr = terrain.nearestRoad(x, z, 6);
      if (nr && nr.road !== r && nr.d < nr.road.width / 2 + 0.3) {
        prev = null;
        continue;
      }
      if (ctx.blocked && ctx.blocked(x, z, 0.5)) {
        prev = null;
        continue;
      }
      const y = terrain.heightAt(x, z) - 0.1;
      // 局部 +x 指向道路中央：横担横跨道路方向，电线沿道路延伸
      const rot = Math.atan2(-pt.tx * side, -pt.tz * side);
      const lamp = rng.chance(0.4);
      const b = chunks.at(x, z);
      b.place(x, y, z, rot);
      const arms = utilityPole(b, rng, { transformer: rng.chance(0.25), lamp });
      colliders.addCircle(x, z, 0.22, y - 1, y + 10);
      const c = Math.cos(rot), sn = Math.sin(rot);
      const nlx = pt.tz, nlz = -pt.tx;
      const world = arms
        .map(([ax, ay, az]) => [x + ax * c + az * sn, y + ay, z - ax * sn + az * c])
        .sort((p, q) => (Math.round(q[1] * 2) - Math.round(p[1] * 2)) * 1000 + ((p[0] - x) * nlx + (p[2] - z) * nlz) - ((q[0] - x) * nlx + (q[2] - z) * nlz));
      if (lamp) {
        lamps.push([x + 1.55 * c, y + 10 - 4.25, z - 1.55 * sn]);
      }
      if (prev) {
        const d = Math.hypot(prev.x - x, prev.z - z);
        if (d < 40) for (let k = 0; k < Math.min(prev.arms.length, world.length); k++) wires.push([prev.arms[k], world[k]]);
      }
      prev = { x, z, arms: world };
      if (rng.chance(0.15)) side = -side;
    }
  }
  return { wires, lamps };
}

// 电线：悬链线，合成一个 LineSegments
export function buildWires(wires, material) {
  const pos = [];
  for (const [a, b] of wires) {
    const N = 8;
    const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const sag = 0.012 * d * d * 0.05 + 0.25;
    let px = a[0], py = a[1], pz = a[2];
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const x = lerp(a[0], b[0], t), z = lerp(a[2], b[2], t);
      const y = lerp(a[1], b[1], t) - Math.sin(t * Math.PI) * sag;
      pos.push(px, py, pz, x, y, z);
      px = x;
      py = y;
      pz = z;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeBoundingSphere();
  const lines = new THREE.LineSegments(g, material);
  lines.name = 'wires';
  return lines;
}

export { lanternGeometry };
