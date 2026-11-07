import * as THREE from 'three';
import {
  WORLD, river, riverNearest, riverWaterLevel, riverHalfWidth, bankLevel, isCanal, ROADS, roadGrid, railway,
  railQuery, SITES, STAIRS, FIELDS,
} from './layout.js';
import { fbm2, ridge2, noise2, smoothstep, smootherstep, clamp, lerp, hash2, closestOnSegment } from '../core/math.js';
import { patchMaterial } from '../render/shaders.js';

// ---------- 扭曲网格：中心 ±320m 为 2m 精度，向外几何级数放大到 2.6km ----------
function buildAxis() {
  const pos = [0];
  for (let x = 2; x <= WORLD.inner; x += 2) pos.push(x);
  let sp = 2, x = WORLD.inner;
  while (x < WORLD.half) {
    sp *= 1.1;
    x += sp;
    pos.push(x);
  }
  const neg = pos.slice(1).map((v) => -v).reverse();
  return Float64Array.from([...neg, ...pos]);
}

const LAKE = SITES.lake;
export function lakeShoreRadius(x, z) {
  const a = Math.atan2(z - LAKE.z, x - LAKE.x);
  return LAKE.r * (1 + 0.1 * Math.sin(3 * a + 1.2) + 0.06 * Math.sin(5 * a + 0.4) + 0.05 * noise2(Math.cos(a) * 1.7, Math.sin(a) * 1.7));
}

function rectDist(x, z, x0, x1, z0, z1) {
  const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
  if (dx === 0 && dz === 0) return -Math.min(x - x0, x1 - x, z - z0, z1 - z);
  return Math.hypot(dx, dz);
}

const HILLS = [SITES.shrine, SITES.temple, SITES.school, SITES.ancient];

export class Terrain {
  constructor() {
    this.xs = buildAxis();
    this.n = this.xs.length;
    this.H = new Float32Array(this.n * this.n);
    this.cls = new Uint8Array(this.n * this.n); // 地面类别
    this.colors = null;
    this.petal = new Float32Array(this.n * this.n);
    this.forestF = new Float32Array(this.n * this.n);
    this.pads = [];
    this.railS = { west: 0, east: railway.total, river: 0, westCorr: 0, eastCorr: railway.total };
    this.portals = [];
  }

  // ---------- 河岸相对的谷底基准 ----------
  baseHeight(x, z, rq) {
    const bank = bankLevel(rq.s);
    const far = Math.max(0, rq.d - 14);
    let h = bank + 0.012 * far + Math.min(far, 260) * 0.004 * fbm2(x * 0.004 + 3, z * 0.004 - 2, 2);
    h += 1.3 * fbm2(x * 0.011, z * 0.011, 3) * smoothstep(14, 70, rq.d);
    return h;
  }
  valleyDist(x, z, rq) {
    const ex = x / 300, ez = (z - 10) / 255;
    let d = (Math.sqrt(ex * ex + ez * ez) - 1) * 255;
    d = Math.min(d, Math.hypot(x - LAKE.x, z - LAKE.z) - 140);
    d = Math.min(d, rectDist(x, z, -350, -60, 145, 312));
    d = Math.min(d, Math.hypot(x + 150, z + 232) - 84);
    if (rq.s < river.canalStart + 10) d = Math.min(d, rq.d - 30);
    const rl = railQuery(x, z, 70);
    if (rl) {
      const close = Math.max(0, this.railS.westCorr - rl.s, rl.s - this.railS.eastCorr) * 0.9;
      d = Math.min(d, rl.d - 24 + close);
    }
    return d;
  }
  mountain(x, z, vd) {
    if (vd <= 0) return 0;
    const m = smoothstep(0, 430, vd);
    // 北方山势放低，让远处的雪峰「桜嶺」从河谷尽头露出来
    const open = 1 - 0.6 * smoothstep(-280, -720, z) * (1 - smoothstep(450, 1100, Math.abs(x + 120)));
    const big = (240 + 180 * fbm2(x * 0.0015 + 3.1, z * 0.0015 - 1.7, 5)) * Math.pow(m, 1.55) * open;
    const ridges = ridge2(x * 0.0032 + 5, z * 0.0032, 4) * 110 * m * open;
    const foothill = (12 + 10 * fbm2(x * 0.012, z * 0.012, 3)) * smoothstep(0, 100, vd);
    return big + ridges + foothill;
  }
  applyHills(h, x, z) {
    for (const s of HILLS) {
      const dx = x - s.x, dz = z - s.z;
      const r = Math.sqrt(dx * dx + dz * dz);
      if (r > s.outer) continue;
      const wob = noise2(x * 0.045, z * 0.045) * 7 * smoothstep(s.plateau, s.outer, r);
      const w = 1 - smootherstep(s.plateau, s.outer, r + wob);
      // 丘顶微微隆起
      const top = s.top + (s === SITES.ancient ? 1.2 * (1 - smoothstep(0, s.plateau + 8, r)) : 0);
      h = lerp(h, Math.max(h, top), w);
    }
    return h;
  }
  applyLake(h, x, z) {
    const dx = x - LAKE.x, dz = z - LAKE.z;
    const r = Math.sqrt(dx * dx + dz * dz);
    if (r > LAKE.r * 1.6) return h;
    const R = lakeShoreRadius(x, z);
    const shore = WORLD.lakeLevel + 0.7;
    // 岸边缓坡与沙滩
    const t = r / R;
    if (t < 1) {
      const depth = 0.35 + 4.2 * smoothstep(1.0, 0.45, t);
      return Math.min(h, WORLD.lakeLevel - depth);
    }
    const w = 1 - smoothstep(1.0, 1.35, t);
    return lerp(h, Math.min(h, shore + (t - 1) * 6), w);
  }
  // 预计算的“道路前”高度（用于道路剖面）
  preRoad(x, z, rq = riverNearest(x, z)) {
    let h = this.baseHeight(x, z, rq);
    h += this.mountain(x, z, this.valleyDist(x, z, rq));
    h = this.applyHills(h, x, z);
    h = this.applyLake(h, x, z);
    h = this.applyRail(h, x, z, rq);
    h = this.applyPaddies(h, x, z);
    return h;
  }
  applyRail(h, x, z, rq) {
    const rl = railQuery(x, z, 14);
    if (!rl || rl.s < this.railS.west || rl.s > this.railS.east) return h;
    const top = this.railHeight(rl.s);
    const nearRiver = smoothstep(18, 30, rq.d);
    const w = (1 - smoothstep(3.0, 11, rl.d)) * nearRiver;
    const bed = top - 0.5;
    return lerp(h, bed - (rl.d > 3 ? (rl.d - 3) * 0.05 : 0), w);
  }
  railHeight(s) {
    if (!this.railProfile) return 3;
    const i = clamp(s / 2, 0, this.railProfile.length - 1);
    const i0 = Math.floor(i), i1 = Math.min(this.railProfile.length - 1, i0 + 1);
    return lerp(this.railProfile[i0], this.railProfile[i1], i - i0);
  }
  applyPaddies(h, x, z) {
    const F = FIELDS.paddies;
    if (x < F.x0 - 4 || x > F.x1 + 4 || z < F.z0 - 4 || z > F.z1 + 4) return h;
    const cell = this.paddyCell(x, z);
    if (!cell) return h;
    const edge = Math.min(x - F.x0, F.x1 - x, z - F.z0, F.z1 - z);
    const w = smoothstep(-4, 2, edge);
    return lerp(h, cell.level, w);
  }
  paddyCell(x, z) {
    const F = FIELDS.paddies;
    const cx = Math.floor((x - F.x0) / F.cell[0]), cz = Math.floor((z - F.z0) / F.cell[1]);
    const nx = Math.ceil((F.x1 - F.x0) / F.cell[0]), nz = Math.ceil((F.z1 - F.z0) / F.cell[1]);
    const ix = clamp(cx, 0, nx - 1), iz = clamp(cz, 0, nz - 1);
    const key = ix + iz * 100;
    if (!this._paddy) this._paddy = new Map();
    let c = this._paddy.get(key);
    if (!c) {
      const mx = F.x0 + (ix + 0.5) * F.cell[0], mz = F.z0 + (iz + 0.5) * F.cell[1];
      const rq = riverNearest(mx, mz);
      const lvl = Math.round((this.baseHeight(mx, mz, rq) - 0.25) / 0.35) * 0.35;
      c = {
        ix, iz, level: lvl,
        x0: F.x0 + ix * F.cell[0], x1: Math.min(F.x1, F.x0 + (ix + 1) * F.cell[0]),
        z0: F.z0 + iz * F.cell[1], z1: Math.min(F.z1, F.z0 + (iz + 1) * F.cell[1]),
        flooded: hash2(ix * 7 + 3, iz * 13 + 1) < 0.72,
      };
      this._paddy.set(key, c);
    }
    return c;
  }

  // ---------- 生成 ----------
  computeProfiles() {
    // 铁路剖面：谷底基准平滑 + 河上抬升成桥
    const RP = railway.pts;
    const raw = new Float32Array(RP.length);
    let sRiver = 0, best = Infinity;
    for (let i = 0; i < RP.length; i++) {
      const [x, z] = RP[i];
      const rq = riverNearest(x, z);
      raw[i] = this.baseHeight(x, z, rq);
      if (rq.d < best) {
        best = rq.d;
        sRiver = railway.acc[i];
      }
    }
    this.railS.river = sRiver;
    const prof = new Float32Array(RP.length);
    const win = 30;
    for (let i = 0; i < RP.length; i++) {
      let s = 0, c = 0;
      for (let k = -win; k <= win; k++) {
        const j = clamp(i + k, 0, RP.length - 1);
        s += raw[j];
        c++;
      }
      const sv = railway.acc[i];
      prof[i] = s / c + 1.05 + 3.1 * Math.exp(-Math.pow((sv - sRiver) / 42, 2));
    }
    this.railProfile = prof;
    // 隧道口：从中心向两侧寻找山体高出轨面 9m 的位置
    this.railS.westCorr = 0;
    this.railS.eastCorr = railway.total;
    let iMid = 0;
    for (let i = 0; i < RP.length; i++) if (Math.abs(RP[i][0]) < Math.abs(RP[iMid][0])) iMid = i;
    // 走廊在 x≈-430 / x≈400 之外逐渐闭合
    for (let i = 0; i < RP.length; i++) {
      if (RP[i][0] < -430) this.railS.westCorr = railway.acc[i];
      if (RP[i][0] > 395 && this.railS.eastCorr === railway.total) this.railS.eastCorr = railway.acc[i];
    }
    this.railS.west = 0;
    this.railS.east = railway.total;
    const findPortal = (dir) => {
      for (let i = iMid; i > 0 && i < RP.length - 1; i += dir) {
        const [x, z] = RP[i];
        const rq = riverNearest(x, z);
        let h = this.baseHeight(x, z, rq) + this.mountain(x, z, this.valleyDist(x, z, rq));
        if (h > prof[i] + 9) return i;
      }
      return dir < 0 ? 1 : RP.length - 2;
    };
    const iw = findPortal(-1), ie = findPortal(1);
    this.railS.west = railway.acc[iw];
    this.railS.east = railway.acc[ie];
    this.portals = [iw, ie].map((i, k) => {
      const a = RP[Math.max(0, i - 1)], b = RP[Math.min(RP.length - 1, i + 1)];
      return { x: RP[i][0], z: RP[i][1], y: prof[i], dir: Math.atan2(b[0] - a[0], b[1] - a[1]), side: k === 0 ? -1 : 1, s: railway.acc[i] };
    });

    // 道路剖面
    for (const r of ROADS) {
      const P = r.pts;
      const raw2 = new Float32Array(P.length);
      for (let i = 0; i < P.length; i++) {
        const [x, z] = P[i];
        const rq = riverNearest(x, z);
        if (r.promenade) raw2[i] = bankLevel(rq.s);
        else raw2[i] = this.preRoad(x, z, rq);
      }
      const h = new Float32Array(P.length);
      const w = r.promenade ? 3 : 6;
      for (let i = 0; i < P.length; i++) {
        let s = 0, c = 0;
        for (let k = -w; k <= w; k++) {
          const j = clamp(i + k, 0, P.length - 1);
          s += raw2[j];
          c++;
        }
        h[i] = s / c;
      }
      // 平交道口：抬到轨面
      for (let i = 0; i < P.length; i++) {
        const rl = railQuery(P[i][0], P[i][1], 12);
        if (rl && rl.s > this.railS.west && rl.s < this.railS.east) {
          const t = 1 - smoothstep(3.2, 10, rl.d);
          h[i] = lerp(h[i], this.railHeight(rl.s) + 0.02, t);
        }
      }
      r.h = h;
    }
  }
  roadHeightAt(r, i, t) {
    return lerp(r.h[i], r.h[Math.min(r.h.length - 1, i + 1)], t);
  }
  // 最近道路（半径内）
  nearestRoad(x, z, rad = 14) {
    const list = roadGrid.within(x, z, rad);
    let best = null, bestScore = Infinity;
    for (const q of list) {
      const r = ROADS[q.seg.data.ri];
      const score = q.d - r.width / 2;
      if (score < bestScore) {
        bestScore = score;
        best = { road: r, i: q.seg.data.i, t: q.t, d: q.d, edge: score, cx: q.cx, cz: q.cz };
      }
    }
    return best;
  }
  // 某点若落在路面（含商店街这类叠加路面）宽度 + margin 内，返回路面剖面高度，否则 null
  roadSurfaceAt(x, z, margin = 0) {
    const nr = this.nearestRoad(x, z, 8);
    if (nr && nr.d < nr.road.width / 2 + margin) return this.roadHeightAt(nr.road, nr.i, nr.t);
    for (const r of ROADS) {
      if (!r.overlay || !r.h) continue;
      const P = r.pts;
      for (let i = 0; i < P.length - 1; i++) {
        const q = closestOnSegment(x, z, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]);
        if (q.d < r.width / 2 + margin) return this.roadHeightAt(r, i, q.t);
      }
    }
    return null;
  }
  heightFull(x, z) {
    const rq = riverNearest(x, z);
    let h = this.preRoad(x, z, rq);
    // 道路压平
    const nr = this.nearestRoad(x, z, 14);
    if (nr) {
      const hw = nr.road.width / 2;
      const w = 1 - smoothstep(hw + 0.4, hw + 6, nr.d);
      if (w > 0) h = lerp(h, this.roadHeightAt(nr.road, nr.i, nr.t) - 0.03, w);
    }
    // 石阶
    for (const k in STAIRS) {
      const st = STAIRS[k];
      const q = closestOnSegment(x, z, st.x0, st.z0, st.x1, st.z1);
      if (q.d > st.w / 2 + 4) continue;
      if (!st.h0) {
        const r0 = riverNearest(st.x0, st.z0);
        st.h0 = this.preRoad(st.x0, st.z0, r0);
        st.h1 = k === 'shrine' ? SITES.shrine.top : SITES.temple.top;
      }
      const raw = closestOnSegmentRaw(x, z, st);
      if (raw < -0.08 || raw > 1.06) continue;
      const hs = lerp(st.h0, st.h1, clamp(raw, 0, 1));
      const w = 1 - smoothstep(st.w / 2 + 0.3, st.w / 2 + 3.5, q.d);
      h = lerp(h, hs, w);
    }
    // 河道
    if (rq.d < 30) {
      const hw = riverHalfWidth(rq.s);
      const wl = riverWaterLevel(rq.s);
      if (isCanal(rq.s)) {
        const bed = wl - 0.95 + 0.12 * noise2(x * 0.3, z * 0.3);
        if (rq.d < hw + 1.2) h = bed;
        else if (rq.d < hw + 2.8) h = lerp(bed, h, smoothstep(hw + 1.2, hw + 2.8, rq.d));
      } else {
        const bed = wl - 0.55 - 0.2 * smoothstep(hw, 0, rq.d) + 0.15 * noise2(x * 0.25, z * 0.25);
        const t = smoothstep(hw * 0.7, hw + 2.2, rq.d);
        const hRoad = h;
        h = lerp(bed, Math.max(h, bed), t);
        // 河岸步道不被冲刷
        if (nr && nr.road.promenade && nr.edge < 0.8) h = Math.max(h, hRoad - 0.04);
      }
    }
    return h;
  }

  generate() {
    this.computeProfiles();
    const { xs, n, H } = this;
    for (let j = 0; j < n; j++) {
      const z = xs[j];
      for (let i = 0; i < n; i++) H[j * n + i] = this.heightFull(xs[i], z);
    }
  }

  // 建筑地基：在足迹范围内压平
  applyPads(pads) {
    const { xs, n, H } = this;
    for (const p of pads) {
      const r = Math.hypot(p.hw, p.hd) + p.blend + 1;
      const i0 = this.indexOf(p.x - r), i1 = this.indexOf(p.x + r) + 1;
      const j0 = this.indexOf(p.z - r), j1 = this.indexOf(p.z + r) + 1;
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      for (let j = Math.max(0, j0); j <= Math.min(n - 1, j1); j++)
        for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i++) {
          const dx = xs[i] - p.x, dz = xs[j] - p.z;
          const lx = dx * c - dz * s, lz = dx * s + dz * c;
          const ex = Math.max(Math.abs(lx) - p.hw, 0), ez = Math.max(Math.abs(lz) - p.hd, 0);
          const d = Math.hypot(ex, ez);
          const w = 1 - smoothstep(0, p.blend, d);
          if (w <= 0) continue;
          const k = j * n + i;
          let hNew = lerp(H[k], p.y, w);
          // 地基不得把路面盖住：路宽范围内的地形不高于路面
          if (hNew > H[k]) {
            const rh = this.roadSurfaceAt(xs[i], xs[j], 0.6);
            if (rh !== null) hNew = Math.min(hNew, Math.max(H[k], rh - 0.03));
          }
          H[k] = hNew;
        }
    }
  }

  indexOf(x) {
    const xs = this.xs;
    let lo = 0, hi = xs.length - 1;
    if (x <= xs[0]) return 0;
    if (x >= xs[hi]) return hi - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (xs[m] <= x) lo = m;
      else hi = m;
    }
    return lo;
  }

  // 与渲染网格一致的三角形插值高度
  heightAt(x, z) {
    const { xs, n, H } = this;
    const i = this.indexOf(x), j = this.indexOf(z);
    const x0 = xs[i], x1 = xs[i + 1], z0 = xs[j], z1 = xs[j + 1];
    const fx = clamp((x - x0) / (x1 - x0), 0, 1), fz = clamp((z - z0) / (z1 - z0), 0, 1);
    const ha = H[j * n + i], hb = H[j * n + i + 1], hc = H[(j + 1) * n + i + 1], hd = H[(j + 1) * n + i];
    if (fx > fz) return ha + (hb - ha) * fx + (hc - hb) * fz;
    return ha + (hd - ha) * fz + (hc - hd) * fx;
  }
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1.0;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }
  classAt(x, z) {
    const i = this.indexOf(x), j = this.indexOf(z);
    const fx = (x - this.xs[i]) / (this.xs[i + 1] - this.xs[i]), fz = (z - this.xs[j]) / (this.xs[j + 1] - this.xs[j]);
    return this.cls[(j + (fz > 0.5 ? 1 : 0)) * this.n + i + (fx > 0.5 ? 1 : 0)];
  }
  // 水面高度（无水返回 -Infinity）
  waterAt(x, z) {
    const rq = riverNearest(x, z);
    if (rq.d < riverHalfWidth(rq.s) + 1.2) return riverWaterLevel(rq.s);
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
    if (dl < lakeShoreRadius(x, z)) return WORLD.lakeLevel;
    const F = FIELDS.paddies;
    if (x > F.x0 && x < F.x1 && z > F.z0 && z < F.z1) {
      const c = this.paddyCell(x, z);
      if (c && c.flooded) return c.level + 0.12;
    }
    return -Infinity;
  }

  // ---------- 着色 ----------
  // sakuraPts: [[x,z,r], ...] 用于在树下铺一层花瓣
  // occluders: [{ x, z, hw, hd, rot }]：建筑与实体，周围的地面略暗（环境光遮蔽）
  computeColors(sakuraPts, occluders = []) {
    const { xs, n, H, cls, petal } = this;
    const col = new Float32Array(n * n * 3);
    const ao = new Float32Array(n * n).fill(1);
    for (const o of occluders) {
      const r = Math.hypot(o.hw, o.hd) + 2.8;
      const i0 = this.indexOf(o.x - r), i1 = this.indexOf(o.x + r) + 1;
      const j0 = this.indexOf(o.z - r), j1 = this.indexOf(o.z + r) + 1;
      const cc = Math.cos(o.rot || 0), ss = Math.sin(o.rot || 0);
      for (let j = Math.max(0, j0); j <= Math.min(n - 1, j1); j++)
        for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i++) {
          const dx = xs[i] - o.x, dz = xs[j] - o.z;
          const lx = dx * cc - dz * ss, lz = dx * ss + dz * cc;
          const d = Math.hypot(Math.max(Math.abs(lx) - o.hw, 0), Math.max(Math.abs(lz) - o.hd, 0));
          const v = 0.66 + 0.34 * smoothstep(0, 2.7, d);
          const k = j * n + i;
          if (v < ao[k]) ao[k] = v;
        }
    }
    const c = new THREE.Color();
    const P = {
      grassA: new THREE.Color('#86a857'), grassB: new THREE.Color('#9bb35e'), grassC: new THREE.Color('#5f8b46'),
      grassDry: new THREE.Color('#ada46c'), dirt: new THREE.Color('#a68a67'), gravel: new THREE.Color('#d6d0c3'),
      sand: new THREE.Color('#d9c9a3'), bed: new THREE.Color('#7f7c6a'), mud: new THREE.Color('#6b5842'),
      rock: new THREE.Color('#8a877b'), forest: new THREE.Color('#4a6438'), forestB: new THREE.Color('#5d7a3f'),
      yard: new THREE.Color('#c4a983'), pink: new THREE.Color('#f2c9d2'), clover: new THREE.Color('#73a556'),
      snow: new THREE.Color('#e8edf2'),
    };
    // 樱花点的网格索引
    const tg = new Map();
    const cell = 16;
    for (const p of sakuraPts) {
      const k = Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell);
      if (!tg.has(k)) tg.set(k, []);
      tg.get(k).push(p);
    }
    const petalAt = (x, z) => {
      let v = 0;
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++) {
          const arr = tg.get(cx + a + ',' + (cz + b));
          if (!arr) continue;
          for (const p of arr) {
            const d = Math.hypot(x - p[0], z - p[1]);
            v = Math.max(v, 1 - smoothstep(p[2] * 0.3, p[2] * 1.15, d));
          }
        }
      return v;
    };
    for (let j = 0; j < n; j++) {
      const z = xs[j];
      for (let i = 0; i < n; i++) {
        const x = xs[i];
        const k = j * n + i;
        const h = H[k];
        // 坡度
        const ii = Math.min(n - 2, Math.max(1, i)), jj = Math.min(n - 2, Math.max(1, j));
        const sx = (H[jj * n + ii + 1] - H[jj * n + ii - 1]) / (xs[ii + 1] - xs[ii - 1]);
        const sz = (H[(jj + 1) * n + ii] - H[(jj - 1) * n + ii]) / (xs[jj + 1] - xs[jj - 1]);
        const slope = Math.hypot(sx, sz);
        const nz1 = fbm2(x * 0.02, z * 0.02, 3), nz2 = noise2(x * 0.11, z * 0.11);
        // 草地
        c.copy(P.grassA).lerp(P.grassB, clamp(0.5 + nz1 * 0.9, 0, 1));
        c.lerp(P.grassC, clamp(0.35 - nz2 * 0.5, 0, 0.6));
        if (nz2 > 0.55) c.lerp(P.clover, 0.4);
        let klass = 0;
        const r0 = Math.hypot(x, z - 10);
        // 山体：森林地表
        if (h > 16 && r0 > 230) {
          const fk = smoothstep(16, 45, h) * smoothstep(230, 300, r0);
          c.lerp(P.forest, fk);
          c.lerp(P.forestB, clamp(nz1, 0, 1) * 0.5 * fk);
          this.forestF[k] = fk;
          if (fk > 0.5) klass = 8;
        }
        if (slope > 0.75) {
          c.lerp(P.rock, smoothstep(0.75, 1.3, slope) * 0.85);
          klass = 7;
        }
        if (h > 420) c.lerp(P.snow, smoothstep(420, 520, h) * 0.6);
        // 河床 / 湖底
        const rq = riverNearest(x, z);
        if (rq.d < 30) {
          const hw = riverHalfWidth(rq.s);
          const wl = riverWaterLevel(rq.s);
          if (h < wl + 0.25) {
            c.copy(P.bed).lerp(P.sand, clamp(0.4 + nz2 * 0.4, 0, 1));
            klass = 6;
          } else if (!isCanal(rq.s) && rq.d < hw + 4) {
            c.lerp(P.sand, 0.55);
            klass = 4;
          }
        }
        const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
        if (dl < LAKE.r * 1.5) {
          const R = lakeShoreRadius(x, z);
          if (dl < R + 6) {
            c.lerp(P.sand, smoothstep(R + 6, R + 1, dl));
            klass = dl < R ? 6 : 4;
            if (dl < R) c.lerp(P.bed, smoothstep(R, R - 12, dl));
          }
        }
        // 地标地面
        const sh = SITES.shrine, tp = SITES.temple, sc = SITES.school;
        if (Math.hypot(x - sh.x, z - sh.z) < sh.plateau - 3 + nz2 * 2) {
          c.copy(P.gravel).multiplyScalar(0.95 + 0.08 * nz2);
          klass = 2;
        }
        if (Math.hypot(x - tp.x, z - tp.z) < tp.plateau - 4 + nz2 * 2) {
          c.copy(P.gravel).lerp(P.dirt, 0.25);
          klass = 2;
        }
        // 校园操场
        {
          const lx = x - (sc.x + 4), lz = z - (sc.z + 12);
          if (Math.abs(lx) < 30 && Math.abs(lz) < 16) {
            c.copy(P.yard).multiplyScalar(0.94 + 0.1 * nz2);
            klass = 1;
          }
        }
        // 稻田泥土
        const F = FIELDS.paddies;
        if (x > F.x0 && x < F.x1 && z > F.z0 && z < F.z1) {
          c.copy(P.mud).lerp(P.dirt, clamp(0.3 + nz2 * 0.3, 0, 1));
          klass = 5;
        }
        // 道路两侧的土
        const nr = this.nearestRoad(x, z, 10);
        if (nr) {
          const e = nr.d - nr.road.width / 2;
          if (e < 1.6) {
            c.lerp(P.dirt, (1 - smoothstep(0.2, 1.6, e)) * 0.75);
            klass = e < 0.3 ? 3 : 1;
          }
        }
        // 樱花下的花瓣
        const pv = petalAt(x, z) * (klass === 0 || klass === 1 ? 1 : klass === 2 ? 0.8 : 0.3);
        petal[k] = pv;
        if (pv > 0) c.lerp(P.pink, pv * 0.32);
        if (h < 30 && slope < 0.5 && klass === 0) c.lerp(P.grassDry, clamp(-nz1 - 0.35, 0, 0.4));
        // 环境光遮蔽：建筑四周与樱树冠下
        c.multiplyScalar(ao[k] * (1 - 0.13 * smoothstep(0.35, 1.0, pv)));
        col[k * 3] = c.r;
        col[k * 3 + 1] = c.g;
        col[k * 3 + 2] = c.b;
        cls[k] = klass;
      }
    }
    this.colors = col;
  }

  // ---------- 网格 ----------
  buildMeshes(material) {
    const { xs, n, H, colors, petal } = this;
    const CH = 48;
    const meshes = [];
    for (let cj = 0; cj < n - 1; cj += CH) {
      for (let ci = 0; ci < n - 1; ci += CH) {
        const ni = Math.min(CH, n - 1 - ci), nj = Math.min(CH, n - 1 - cj);
        const vc = (ni + 1) * (nj + 1);
        const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), col = new Float32Array(vc * 3), pet = new Float32Array(vc * 2);
        let v = 0;
        for (let j = cj; j <= cj + nj; j++)
          for (let i = ci; i <= ci + ni; i++) {
            const k = j * n + i;
            pos[v * 3] = xs[i];
            pos[v * 3 + 1] = H[k];
            pos[v * 3 + 2] = xs[j];
            const il = Math.max(0, i - 1), ir = Math.min(n - 1, i + 1), jl = Math.max(0, j - 1), jr = Math.min(n - 1, j + 1);
            const dx = (H[j * n + ir] - H[j * n + il]) / (xs[ir] - xs[il]);
            const dz = (H[jr * n + i] - H[jl * n + i]) / (xs[jr] - xs[jl]);
            const l = Math.hypot(dx, 1, dz);
            nor[v * 3] = -dx / l;
            nor[v * 3 + 1] = 1 / l;
            nor[v * 3 + 2] = -dz / l;
            col[v * 3] = colors[k * 3];
            col[v * 3 + 1] = colors[k * 3 + 1];
            col[v * 3 + 2] = colors[k * 3 + 2];
            pet[v * 2] = petal[k];
            pet[v * 2 + 1] = this.forestF[k];
            v++;
          }
        const idx = [];
        const W = ni + 1;
        for (let j = 0; j < nj; j++)
          for (let i = 0; i < ni; i++) {
            const a = j * W + i, b = a + 1, c = a + W + 1, d = a + W;
            idx.push(a, c, b, a, d, c);
          }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setAttribute('aPetal', new THREE.BufferAttribute(pet, 2));
        g.setIndex(idx);
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, material);
        mesh.receiveShadow = true;
        mesh.castShadow = Math.abs(xs[ci]) < 700 && Math.abs(xs[cj]) < 700;
        mesh.matrixAutoUpdate = false;
        mesh.name = 'terrain';
        meshes.push(mesh);
      }
    }
    return meshes;
  }

  // GPU 草地用：高度纹理与地表色/草密度纹理（覆盖 ±320m，与网格顶点一一对应）
  buildTextures() {
    const { xs, n, H, colors, cls, petal } = this;
    const i0 = this.indexOf(-WORLD.inner), i1 = this.indexOf(WORLD.inner);
    const size = i1 - i0 + 1;
    const hData = new Float32Array(size * size);
    const cData = new Uint8Array(size * size * 4);
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++) {
        const k = (j + i0) * n + (i + i0);
        hData[j * size + i] = H[k];
        const kl = cls[k];
        let dens = kl === 0 ? 1 : kl === 8 ? 0.8 : kl === 1 ? 0.12 : kl === 4 ? 0.1 : 0;
        // sRGB 编码存储，便于 8 位精度
        const r = Math.pow(colors[k * 3], 1 / 2.2), g = Math.pow(colors[k * 3 + 1], 1 / 2.2), b = Math.pow(colors[k * 3 + 2], 1 / 2.2);
        cData[(j * size + i) * 4] = clamp(r * 255, 0, 255);
        cData[(j * size + i) * 4 + 1] = clamp(g * 255, 0, 255);
        cData[(j * size + i) * 4 + 2] = clamp(b * 255, 0, 255);
        cData[(j * size + i) * 4 + 3] = clamp(dens * 255 * (1 - petal[k] * 0.3), 0, 255);
      }
    const hTex = new THREE.DataTexture(hData, size, size, THREE.RedFormat, THREE.FloatType);
    hTex.minFilter = hTex.magFilter = THREE.NearestFilter;
    hTex.needsUpdate = true;
    const cTex = new THREE.DataTexture(cData, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    cTex.minFilter = THREE.LinearFilter;
    cTex.magFilter = THREE.LinearFilter;
    cTex.needsUpdate = true;
    this.hTex = hTex;
    this.cTex = cTex;
    // 映射：世界 x → 纹理坐标
    this.texRect = { x0: xs[i0], size: size, step: 2 };
    return { hTex, cTex, rect: this.texRect };
  }

  // ---------- 禁草遮罩：0.5 m 精度，台阶、站台、铺地、野餐垫、建筑占地等处不长草 ----------
  initGrassMask() {
    const res = 0.5, x0 = -WORLD.inner, size = Math.round((WORLD.inner * 2) / res);
    this.gmask = { data: new Uint8Array(size * size).fill(255), size, res, x0 };
  }
  // o: { x, z, hw, hd, rot }（rot 与 rotation.y 同约定）
  maskRect(o, margin = 0.2) {
    const M = this.gmask;
    if (!M) return;
    const { data, size, res, x0 } = M;
    const hw = o.hw + margin, hd = o.hd + margin;
    const r = Math.hypot(hw, hd);
    const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0);
    const ia = Math.max(0, Math.floor((o.x - r - x0) / res)), ib = Math.min(size - 1, Math.ceil((o.x + r - x0) / res));
    const ja = Math.max(0, Math.floor((o.z - r - x0) / res)), jb = Math.min(size - 1, Math.ceil((o.z + r - x0) / res));
    for (let j = ja; j <= jb; j++)
      for (let i = ia; i <= ib; i++) {
        const dx = x0 + (i + 0.5) * res - o.x, dz = x0 + (j + 0.5) * res - o.z;
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        if (Math.abs(lx) < hw && Math.abs(lz) < hd) data[j * size + i] = 0;
      }
  }
  maskTexture() {
    const M = this.gmask;
    const tex = new THREE.DataTexture(M.data, M.size, M.size, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return { tex, rect: { x0: M.x0, size: M.size * M.res } };
  }

  // 抹掉建筑占地内的草（在建筑放置后调用）
  clearGrassRect(o, margin = 0.5) {
    if (!this.cTex) return;
    const { x0, size, step } = this.texRect;
    const data = this.cTex.image.data;
    const r = Math.hypot(o.hw, o.hd) + margin + 2;
    const ia = Math.floor((o.x - r - x0) / step), ib = Math.ceil((o.x + r - x0) / step);
    const ja = Math.floor((o.z - r - x0) / step), jb = Math.ceil((o.z + r - x0) / step);
    const c = Math.cos(o.rot), s = Math.sin(o.rot);
    for (let j = Math.max(0, ja); j <= Math.min(size - 1, jb); j++)
      for (let i = Math.max(0, ia); i <= Math.min(size - 1, ib); i++) {
        const dx = x0 + i * step - o.x, dz = x0 + j * step - o.z;
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        if (Math.abs(lx) < o.hw + margin && Math.abs(lz) < o.hd + margin) data[(j * size + i) * 4 + 3] = 0;
      }
    this.cTex.needsUpdate = true;
  }
}

function closestOnSegmentRaw(x, z, st) {
  const dx = st.x1 - st.x0, dz = st.z1 - st.z0;
  return ((x - st.x0) * dx + (z - st.z0) * dz) / (dx * dx + dz * dz);
}

export function createTerrainMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
  patchMaterial(mat, {
    key: 'terrain',
    uniforms: ['uNight', 'uTime', 'uSunDir'],
    vertexHead: 'attribute vec2 aPetal;\nvarying float vPetal;\nvarying float vForest;\nvarying vec3 vWPos;\n',
    vertexEnd: 'vPetal = aPetal.x;\nvForest = aPetal.y;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    fragmentHead: 'varying float vPetal;\nvarying float vForest;\nvarying vec3 vWPos;\nuniform vec3 uSunDir;\n',
    fragmentColor: /* glsl */ `
      {
        vec2 p = vWPos.xz;
        float n1 = vnoise(p * 0.35);
        float n2 = vnoise(p * 1.9 + 7.0);
        float n3 = vnoise(p * 7.0 + 3.0);
        diffuseColor.rgb *= 0.9 + 0.12 * n1 + 0.08 * n2 + 0.05 * (n3 - 0.5);
        // 近处的细碎纹理：草地上的明暗斑点与零星露土
        float camD = length(vWPos - cameraPosition);
        float near = 1.0 - smoothstep(6.0, 45.0, camD);
        float green = diffuseColor.g / max(diffuseColor.r * 0.8 + diffuseColor.b * 0.6, 1e-3);
        // 中远景：大尺度的深浅与冷暖起伏，草坡不再是一整片均匀的绿
        float m1 = vnoise(p * 0.045 + 31.0), m2 = vnoise(p * 0.013 - 7.0);
        vec3 macro = mix(vec3(0.86, 0.92, 0.84), vec3(1.07, 1.03, 0.9), m1);
        macro *= mix(0.9, 1.06, m2);
        diffuseColor.rgb *= mix(vec3(1.0), macro, step(1.05, green));
        // 草丛底下：叶片遮挡的阴影（与草地的覆盖范围衔接）
        float under = (1.0 - smoothstep(14.0, 30.0, camD)) * step(1.15, green) * (1.0 - vPetal * 0.5);
        diffuseColor.rgb *= mix(1.0, 0.74, under);
        float speck = vnoise(p * 23.0) * 0.6 + vnoise(p * vec2(61.0, 47.0)) * 0.4;
        diffuseColor.rgb *= mix(1.0, 0.8 + 0.32 * speck, near);
        float soil = smoothstep(0.66, 0.82, vnoise(p * 2.7 + 17.0) * 0.7 + vnoise(p * 11.0) * 0.3) * step(1.1, green);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 0.96, 0.78), soil * 0.35);
        // scattered petals
        float pet = smoothstep(0.62, 0.8, vnoise(p * 4.3 + 11.0)) * vPetal + smoothstep(0.7, 0.85, vnoise(p * 9.0 - 4.0)) * vPetal * 0.7;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.66, 0.72), clamp(pet, 0.0, 0.85));
        // 远山森林：树冠的团块感（深浅绿 + 零星山樱）
        if (vForest > 0.01) {
          vec2 q = p * 0.22;
          vec2 cell = floor(q); vec2 f = fract(q) - 0.5;
          float h = hash12(cell);
          vec2 o = vec2(hash12(cell + 1.7), hash12(cell + 4.1)) - 0.5;
          vec2 rel = f - o * 0.4;
          float rr = length(rel);
          float crown = smoothstep(0.55, 0.1, rr);
          vec3 tone = h < 0.55 ? vec3(0.07, 0.13, 0.065) : h < 0.93 ? vec3(0.15, 0.25, 0.1) : vec3(0.5, 0.4, 0.42);
          // 树冠是一团团的半球：朝阳一侧亮、背阳一侧暗；远处降低对比，避免闪烁成拼布
          vec3 cn = normalize(vec3(rel.x * 2.4, sqrt(max(0.0, 0.32 - rr * rr)) + 0.2, rel.y * 2.4));
          float lit = clamp(dot(cn, uSunDir) * 0.55 + 0.6, 0.3, 1.25);
          float farK = smoothstep(110.0, 800.0, camD);
          crown = mix(crown, 0.6, farK * 0.7);
          lit = mix(lit, 0.85, farK * 0.6);
          vec3 forestCol = mix(tone * 0.42, tone * lit, crown) * (0.82 + 0.34 * vnoise(p * 0.05));
          diffuseColor.rgb = mix(diffuseColor.rgb, forestCol, vForest * 0.85);
        }
      }
    `,
  });
  return mat;
}
