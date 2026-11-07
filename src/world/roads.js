import * as THREE from 'three';
import { ROADS, river, riverHalfWidth, riverWaterLevel, bankLevel, isCanal, FIELDS, roadGrid } from './layout.js';
import { PAT, C, vary, mulColor } from '../render/builder.js';
import { RNG, smoothstep, lerp, clamp } from '../core/math.js';

export const ROAD_STYLE = {
  asphalt: { color: '#62646a', pat: PAT.ASPHALT, lift: 0.05 },
  stone: { color: '#aaa294', pat: PAT.STONE, lift: 0.07 },
  gravel: { color: '#b9ab92', pat: PAT.GRAVEL, lift: 0.05 },
  dirt: { color: '#a48767', pat: PAT.GRAVEL, lift: 0.04 },
  promenade: { color: '#bdb09c', pat: PAT.STONE, lift: 0.06 },
};

// 道路丝带：沿剖面高度铺设，按位置分块
export function buildRoads(chunks, terrain) {
  const rng = new RNG(41);
  const overlay = ROADS.filter((r) => r.overlay);
  for (const r of ROADS) {
    const st = ROAD_STYLE[r.type];
    const P = r.pts, H = r.h;
    const hw = r.width / 2;
    const L = [], R = [], Y = [], skip = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      L.push([P[i][0] + tz * hw, P[i][1] - tx * hw]);
      R.push([P[i][0] - tz * hw, P[i][1] + tx * hw]);
      Y.push(H[i] + st.lift);
      // 被叠加层覆盖的路段跳过
      let sk = false;
      if (!r.overlay)
        for (const o of overlay) {
          for (const q of o.pts) if (Math.abs(q[0] - P[i][0]) + Math.abs(q[1] - P[i][1]) < 1.6) sk = true;
        }
      skip.push(sk);
    }
    let vAcc = 0;
    for (let i = 0; i < P.length - 1; i++) {
      const seg = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
      if (skip[i] && skip[i + 1]) {
        vAcc += seg;
        continue;
      }
      const b = chunks.at(P[i][0], P[i][1]);
      b.pattern(st.pat, 0);
      const col = vary(st.color, rng, 0.04);
      b.quad(
        [L[i][0], Y[i], L[i][1]], [R[i][0], Y[i], R[i][1]], [R[i + 1][0], Y[i + 1], R[i + 1][1]], [L[i + 1][0], Y[i + 1], L[i + 1][1]],
        col,
        [[0, vAcc], [r.width, vAcc], [r.width, vAcc + seg], [0, vAcc + seg]]
      );
      // 路缘（石板/步道两侧的侧面，遮住地形接缝）
      if (r.type === 'stone' || r.type === 'promenade' || r.type === 'asphalt') {
        const curb = mulColor(st.color, 0.8);
        b.quad([L[i + 1][0], Y[i + 1], L[i + 1][1]], [L[i + 1][0], Y[i + 1] - 0.25, L[i + 1][1]], [L[i][0], Y[i] - 0.25, L[i][1]], [L[i][0], Y[i], L[i][1]], curb);
        b.quad([R[i][0], Y[i], R[i][1]], [R[i][0], Y[i] - 0.25, R[i][1]], [R[i + 1][0], Y[i + 1] - 0.25, R[i + 1][1]], [R[i + 1][0], Y[i + 1], R[i + 1][1]], curb);
      }
      // 白色路边线
      if (r.type === 'asphalt' && r.width >= 5.5 && !skip[i]) {
        b.pattern(PAT.NONE, 0);
        const w = 0.13, inset = 0.38;
        for (const side of [1, -1]) {
          const E = side > 0 ? L : R;
          const f = (k, o) => {
            const px = P[k][0] + (E[k][0] - P[k][0]) * ((hw - inset + o) / hw);
            const pz = P[k][1] + (E[k][1] - P[k][1]) * ((hw - inset + o) / hw);
            return [px, Y[k] + 0.012, pz];
          };
          if (side < 0) b.quad(f(i, -w / 2), f(i, w / 2), f(i + 1, w / 2), f(i + 1, -w / 2), '#e9e6dc');
          else b.quad(f(i, w / 2), f(i, -w / 2), f(i + 1, -w / 2), f(i + 1, w / 2), '#e9e6dc');
        }
      }
      vAcc += seg;
    }
  }
}

// 城中河段的石砌护岸、护栏与灯笼串；返回灯笼位置（夜里的光池与点光源）
export function buildRiverbanks(chunks, colliders, terrain, gaps = []) {
  const rng = new RNG(77);
  const lanterns = [];
  const P = river.pts, A = river.acc;
  const stoneCol = '#9e978a';
  const capCol = '#b8b1a3';
  // 护岸端头：一段垂直于河道的石墙把压顶石与迎水面收住，栏杆末端立一根端柱
  const endCap = (c, out) => {
    const cx = (c.face[0] + c.back[0]) / 2 + c.tx * out * 0.2, cz = (c.face[1] + c.back[1]) / 2 + c.tz * out * 0.2;
    const bld = chunks.at(cx, cz);
    bld.place(cx, 0, cz, Math.atan2(-c.nz, c.nx));
    bld.pattern(PAT.STONE, 0);
    bld.box(0, c.bot, 0, 2.8, c.top - c.bot + 0.02, 0.42, stoneCol, { topColor: capCol });
    bld.place(c.rail[0] + c.tx * out * 0.05, 0, c.rail[1] + c.tz * out * 0.05, Math.atan2(-c.nz, c.nx));
    bld.pattern(PAT.PLANK, 0);
    bld.box(0, c.top, 0, 0.17, 1.08, 0.17, '#4e3424');
    bld.box(0, c.top + 1.08, 0, 0.21, 0.05, 0.21, '#3e2a1d');
    bld.identity();
  };
  // 每侧收集护岸点
  for (const side of [1, -1]) {
    let prev = null;
    let postAcc = 0;
    let lanternAcc = 4;
    const lanternPosts = [];
    for (let i = 0; i < P.length; i++) {
      const s = A[i];
      if (!isCanal(s)) {
        if (prev) endCap(prev, 1);
        prev = null;
        continue;
      }
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      const nx = tz * side, nz = -tx * side;
      const hw = riverHalfWidth(s);
      const wl = riverWaterLevel(s), bank = bankLevel(s);
      const cur = {
        face: [P[i][0] + nx * hw, P[i][1] + nz * hw],
        back: [P[i][0] + nx * (hw + 2.4), P[i][1] + nz * (hw + 2.4)],
        rail: [P[i][0] + nx * (hw + 0.35), P[i][1] + nz * (hw + 0.35)],
        lamp: [P[i][0] + nx * 12.9, P[i][1] + nz * 12.9],
        top: bank + 0.14,
        bot: wl - 1.3,
        s,
        tx, tz, nx, nz,
      };
      if (!prev) endCap(cur, -1);
      if (prev) {
        const bld = chunks.at(cur.face[0], cur.face[1]);
        bld.pattern(PAT.STONE, 0);
        const sc = vary(stoneCol, rng, 0.05);
        // 迎水面（朝向河心）
        const f0 = prev.face, f1 = cur.face;
        if (side < 0) bld.quad([f1[0], cur.bot, f1[1]], [f0[0], prev.bot, f0[1]], [f0[0], prev.top, f0[1]], [f1[0], cur.top, f1[1]], sc);
        else bld.quad([f0[0], prev.bot, f0[1]], [f1[0], cur.bot, f1[1]], [f1[0], cur.top, f1[1]], [f0[0], prev.top, f0[1]], sc);
        // 压顶石
        bld.pattern(PAT.STONE, 0);
        const b0 = prev.back, b1 = cur.back;
        if (side < 0) bld.quad([f0[0], prev.top, f0[1]], [b0[0], prev.top, b0[1]], [b1[0], cur.top, b1[1]], [f1[0], cur.top, f1[1]], capCol);
        else bld.quad([f1[0], cur.top, f1[1]], [b1[0], cur.top, b1[1]], [b0[0], prev.top, b0[1]], [f0[0], prev.top, f0[1]], capCol);
        // 护栏（桥处留空）
        const segLen = Math.hypot(f1[0] - f0[0], f1[1] - f0[1]);
        postAcc += segLen;
        const onBridge = (x, z) => {
          const near = roadGrid.nearest(x, z, 6);
          return near && !ROADS[near.seg.data.ri].promenade;
        };
        const inGap = (x, z) => gaps.some((g) => Math.hypot(x - g[0], z - g[1]) < g[2]);
        const br = onBridge(cur.rail[0], cur.rail[1]) || onBridge(prev.rail[0], prev.rail[1]) || inGap(cur.rail[0], cur.rail[1]) || inGap(prev.rail[0], prev.rail[1]);
        if (!br) {
          bld.pattern(PAT.PLANK, 0);
          const wood = '#5a3d2b';
          bld.tube([[prev.rail[0], prev.top + 0.92, prev.rail[1]], [cur.rail[0], cur.top + 0.92, cur.rail[1]]], 0.045, 5, wood);
          bld.tube([[prev.rail[0], prev.top + 0.5, prev.rail[1]], [cur.rail[0], cur.top + 0.5, cur.rail[1]]], 0.03, 4, wood);
          if (postAcc > 2.4) {
            postAcc = 0;
            bld.box(cur.rail[0], cur.top, cur.rail[1], 0.13, 1.0, 0.13, '#4e3424');
          }
          colliders.addWall(prev.rail[0], prev.rail[1], cur.rail[0], cur.rail[1], 0.3, -50, cur.top + 1.0);
        }
        // 灯笼柱
        lanternAcc += segLen;
        if (lanternAcc > 9.5) {
          lanternAcc = 0;
          const nearRoad = roadGrid.nearest(cur.lamp[0], cur.lamp[1], 5);
          const blocked = (nearRoad && !ROADS[nearRoad.seg.data.ri].promenade) || gaps.some((g) => Math.hypot(cur.lamp[0] - g[0], cur.lamp[1] - g[1]) < g[2] + 2);
          if (!blocked) lanternPosts.push({ x: cur.lamp[0], z: cur.lamp[1], y: terrain.heightAt(cur.lamp[0], cur.lamp[1]) });
          else lanternPosts.push(null);
        }
      }
      prev = cur;
    }
    // 柱子之间挂一串提灯
    const posts = lanternPosts;
    for (let k = 0; k < posts.length; k++) {
      const p = posts[k];
      if (!p) continue;
      const bld = chunks.at(p.x, p.z);
      bld.pattern(PAT.PLANK, 0);
      bld.box(p.x, p.y, p.z, 0.14, 3.0, 0.14, '#6b4a33');
      bld.box(p.x, p.y + 2.95, p.z, 0.24, 0.1, 0.24, '#3e2a1d');
      colliders.addCircle(p.x, p.z, 0.16, p.y - 1, p.y + 3);
      const q = posts[k + 1];
      if (!q) continue;
      const dist = Math.hypot(q.x - p.x, q.z - p.z);
      if (dist > 16) continue;
      const pts = [];
      const N = 10;
      for (let j = 0; j <= N; j++) {
        const t = j / N;
        const sag = Math.sin(t * Math.PI) * 0.55;
        pts.push([lerp(p.x, q.x, t), lerp(p.y, q.y, t) + 2.85 - sag, lerp(p.z, q.z, t)]);
      }
      bld.pattern(PAT.NONE, 0);
      bld.tube(pts, 0.012, 3, '#2a2420');
      // 三盏提灯
      for (const t of [0.25, 0.5, 0.75]) {
        const j = t * N;
        const j0 = Math.floor(j);
        const pp = pts[j0];
        const x = pp[0], z = pp[2], y = pp[1] - 0.06;
        const pink = (k + Math.round(t * 4)) % 2 === 0;
        lanterns.push({ x, y: y - 0.32, z, pink });
      }
    }
  }
  return lanterns;
}

// 提灯（夜里自发光的纸灯笼）：rot 让朝向随机
export function lanternGeometry(b, x, y, z, color, scale = 1) {
  b.pattern(PAT.NONE, 0);
  b.cylinder(x, y + 0.02 * scale, z, 0.09 * scale, 0.1 * scale, 0.07 * scale, 8, '#1d1a18');
  b.pattern(PAT.LANTERN, 1);
  const prof = [];
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = (0.1 + 0.15 * Math.sin(t * Math.PI)) * scale;
    prof.push([r, y - 0.5 * scale + t * 0.52 * scale]);
  }
  b.lathe(x, z, prof, 10, color);
  b.pattern(PAT.NONE, 0);
  b.cylinder(x, y - 0.56 * scale, z, 0.1 * scale, 0.09 * scale, 0.07 * scale, 8, '#1d1a18');
}

// 水田田埂
export function buildDikes(chunks, terrain) {
  const F = FIELDS.paddies;
  const seen = new Set();
  for (let x = F.x0 + 1; x < F.x1; x += F.cell[0])
    for (let z = F.z0 + 1; z < F.z1; z += F.cell[1]) {
      const c = terrain.paddyCell(x + 2, z + 2);
      const key = c.ix + ',' + c.iz;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = chunks.at((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2);
      b.pattern(PAT.NONE, 0);
      const col = '#7f9a52';
      const y = c.level - 0.1;
      const w = c.x1 - c.x0, d = c.z1 - c.z0;
      b.box((c.x0 + c.x1) / 2, y, c.z0, w, 0.42, 0.7, col, { topColor: '#8aa65a' });
      b.box(c.x0, y, (c.z0 + c.z1) / 2, 0.7, 0.42, d, col, { topColor: '#8aa65a' });
      if (c.ix === Math.ceil((F.x1 - F.x0) / F.cell[0]) - 1) b.box(c.x1, y, (c.z0 + c.z1) / 2, 0.7, 0.42, d, col);
      if (c.iz === Math.ceil((F.z1 - F.z0) / F.cell[1]) - 1) b.box((c.x0 + c.x1) / 2, y, c.z1, w, 0.42, 0.7, col);
    }
}
