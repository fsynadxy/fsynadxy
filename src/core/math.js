// 数学与噪声工具：可复现随机数、Simplex 噪声、多段线几何
// 整个世界由固定种子生成，因此每次打开的桜川町都是同一座小镇。

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const smootherstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
export const angleDiff = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
export const dampAngle = (current, target, lambda, dt) => current + angleDiff(current, target) * (1 - Math.exp(-lambda * dt));

export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed = 1) {
    this.next = mulberry32(seed);
  }
  float(a = 0, b = 1) {
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return Math.floor(a + (b - a + 1) * this.next());
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }
  chance(p) {
    return this.next() < p;
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
  gauss() {
    let u = 0;
    for (let i = 0; i < 4; i++) u += this.next();
    return (u - 2) / 0.577;
  }
  weighted(items) {
    // items: [[value, weight], ...]
    let total = 0;
    for (const it of items) total += it[1];
    let r = this.next() * total;
    for (const it of items) {
      r -= it[1];
      if (r <= 0) return it[0];
    }
    return items[items.length - 1][0];
  }
}

export function hash2(x, z) {
  let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((z | 0) + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------- Simplex 2D（Gustavson 算法） ----------
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

export function createNoise2D(seed = 1) {
  const rng = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  return function noise(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = GRAD[perm[ii + perm[jj]] & 7];
      t0 *= t0;
      n0 = t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = GRAD[perm[ii + i1 + perm[jj + j1]] & 7];
      t1 *= t1;
      n1 = t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = GRAD[perm[ii + 1 + perm[jj + 1]] & 7];
      t2 *= t2;
      n2 = t2 * t2 * (g[0] * x2 + g[1] * y2);
    }
    return 70 * (n0 + n1 + n2); // 约 [-1, 1]
  };
}

export const noise2 = createNoise2D(20260407);
const noiseB = createNoise2D(777);

export function fbm2(x, z, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq + i * 17.3, z * freq - i * 9.1);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function ridge2(x, z, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1, prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noiseB(x * freq, z * freq));
    n *= n;
    sum += n * amp * prev;
    prev = n;
    freq *= 2.1;
    amp *= 0.5;
  }
  return sum;
}

// ---------- 多段线 ----------
export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

// 向心 Catmull-Rom 样条，返回稠密点列
export function catmullRom(points, samplesPerSeg = 12) {
  const out = [];
  const n = points.length;
  const get = (i) => points[clamp(i, 0, n - 1)];
  for (let i = 0; i < n - 1; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const tj = (a, b, t) => t + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]) + 1e-6, 0.5);
    const t0 = 0, t1 = tj(p0, p1, t0), t2 = tj(p1, p2, t1), t3 = tj(p2, p3, t2);
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = lerp(t1, t2, s / samplesPerSeg);
      const A1 = mix2(p0, p1, (t1 - t) / (t1 - t0), (t - t0) / (t1 - t0));
      const A2 = mix2(p1, p2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
      const A3 = mix2(p2, p3, (t3 - t) / (t3 - t2), (t - t2) / (t3 - t2));
      const B1 = mix2(A1, A2, (t2 - t) / (t2 - t0), (t - t0) / (t2 - t0));
      const B2 = mix2(A2, A3, (t3 - t) / (t3 - t1), (t - t1) / (t3 - t1));
      out.push(mix2(B1, B2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1)));
    }
  }
  out.push([points[n - 1][0], points[n - 1][1]]);
  return out;
}
function mix2(a, b, wa, wb) {
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb];
}

// 按固定间距重采样
export function resample(pts, spacing) {
  const out = [[pts[0][0], pts[0][1]]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], az = pts[i - 1][1];
    const bx = pts[i][0], bz = pts[i][1];
    const seg = Math.hypot(bx - ax, bz - az);
    let d = spacing - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push([ax + (bx - ax) * t, az + (bz - az) * t]);
      d += spacing;
    }
    carry = seg - (d - spacing);
  }
  const last = pts[pts.length - 1];
  const lo = out[out.length - 1];
  if (Math.hypot(last[0] - lo[0], last[1] - lo[1]) > spacing * 0.3) out.push([last[0], last[1]]);
  else out[out.length - 1] = [last[0], last[1]];
  return out;
}

// 多段线累计弧长
export function cumulative(pts) {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return acc;
}

// 在多段线上按弧长取点与切线
export function pointAt(pts, acc, s) {
  s = clamp(s, 0, acc[acc.length - 1]);
  let lo = 0, hi = acc.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (acc[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = acc[hi] - acc[lo] || 1;
  const t = (s - acc[lo]) / seg;
  const a = pts[lo], b = pts[hi];
  const tx = (b[0] - a[0]) / seg, tz = (b[1] - a[1]) / seg;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx, tz, i: lo };
}

// 偏移多段线（左正右负，基于前进方向 (tx,tz) 的左法线 (tz,-tx)）
export function offsetPolyline(pts, off) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    out.push([pts[i][0] + tz * off, pts[i][1] - tx * off]);
  }
  return out;
}

// 点到线段的最近点
export function closestOnSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t, cz = az + dz * t;
  return { t, cx, cz, d: Math.hypot(px - cx, pz - cz) };
}

// 线段空间索引：加速海量“点到道路/河流最近距离”查询
export class SegmentGrid {
  constructor(cell = 24) {
    this.cell = cell;
    this.map = new Map();
    this.segs = [];
  }
  key(ix, iz) {
    return ix * 73856093 ^ iz * 19349663;
  }
  add(ax, az, bx, bz, data, pad = 0) {
    const seg = { ax, az, bx, bz, data, len: Math.hypot(bx - ax, bz - az) };
    const id = this.segs.length;
    this.segs.push(seg);
    const c = this.cell;
    const x0 = Math.floor((Math.min(ax, bx) - pad) / c), x1 = Math.floor((Math.max(ax, bx) + pad) / c);
    const z0 = Math.floor((Math.min(az, bz) - pad) / c), z1 = Math.floor((Math.max(az, bz) + pad) / c);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let arr = this.map.get(k);
        if (!arr) this.map.set(k, (arr = []));
        arr.push(id);
      }
    return seg;
  }
  addPolyline(pts, dataFn, pad = 0) {
    for (let i = 1; i < pts.length; i++) this.add(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], dataFn(i - 1), pad);
  }
  // 返回半径 r 内最近线段（未命中返回 null）
  nearest(px, pz, r) {
    const c = this.cell;
    const x0 = Math.floor((px - r) / c), x1 = Math.floor((px + r) / c);
    const z0 = Math.floor((pz - r) / c), z1 = Math.floor((pz + r) / c);
    let best = null, bestD = r;
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.map.get(this.key(ix, iz));
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const id = arr[k];
          if (seen.has(id)) continue;
          seen.add(id);
          const s = this.segs[id];
          const q = closestOnSegment(px, pz, s.ax, s.az, s.bx, s.bz);
          if (q.d < bestD) {
            bestD = q.d;
            best = { seg: s, t: q.t, cx: q.cx, cz: q.cz, d: q.d };
          }
        }
      }
    return best;
  }
  // 所有半径内的线段
  within(px, pz, r, out = []) {
    const c = this.cell;
    const x0 = Math.floor((px - r) / c), x1 = Math.floor((px + r) / c);
    const z0 = Math.floor((pz - r) / c), z1 = Math.floor((pz + r) / c);
    const seen = new Set();
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.map.get(this.key(ix, iz));
        if (!arr) continue;
        for (const id of arr) {
          if (seen.has(id)) continue;
          seen.add(id);
          const s = this.segs[id];
          const q = closestOnSegment(px, pz, s.ax, s.az, s.bx, s.bz);
          if (q.d < r) out.push({ seg: s, t: q.t, cx: q.cx, cz: q.cz, d: q.d });
        }
      }
    return out;
  }
}

// 有向包围盒（2D）：{x,z,hw,hd,rot}，rot 与 three.js 的 rotation.y 一致：
// 局部 x 轴 = (cos r, -sin r)，局部 z 轴 = (sin r, cos r)
export function obbAxes(o) {
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  return [[c, -s], [s, c]];
}
export function obbOverlap(a, b, margin = 0) {
  const A = obbAxes(a), B = obbAxes(b);
  const axes = [A[0], A[1], B[0], B[1]];
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [nx, nz] of axes) {
    const ra = Math.abs(a.hw * (A[0][0] * nx + A[0][1] * nz)) + Math.abs(a.hd * (A[1][0] * nx + A[1][1] * nz));
    const rb = Math.abs(b.hw * (B[0][0] * nx + B[0][1] * nz)) + Math.abs(b.hd * (B[1][0] * nx + B[1][1] * nz));
    if (Math.abs(dx * nx + dz * nz) > ra + rb + margin) return false;
  }
  return true;
}

// 世界坐标转 OBB 局部坐标
export function toLocal(o, x, z) {
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  const dx = x - o.x, dz = z - o.z;
  return [dx * c - dz * s, dx * s + dz * c];
}
// OBB 局部坐标转世界坐标
export function toWorld(o, lx, lz) {
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  return [o.x + lx * c + lz * s, o.z - lx * s + lz * c];
}

export function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
