// 基础工具：向量、插值曲线、噪声、随机数，以及按材质分组的网格构建器 Mesh。
// 这个目录里的代码不依赖 three.js，浏览器与 Node 都能直接运行。

export const PI = Math.PI;
export const TAU = Math.PI * 2;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const smoother = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const gauss = (x, s) => Math.exp(-(x * x) / (s * s));
export const sign = (x) => (x < 0 ? -1 : 1);
// 带符号的幂：保持符号的 |x|^p
export const spow = (x, p) => (x < 0 ? -Math.pow(-x, p) : Math.pow(x, p));

// ---------- 三维向量（普通数组 [x, y, z]） ----------
export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// 绕任意单位轴旋转（罗德里格斯公式）
export const rotAxis = (v, k, ang) => {
  const c = Math.cos(ang), s = Math.sin(ang);
  const kv = cross(k, v), kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
};
// 任取一个与 n 垂直的单位向量
export const perp = (n) => norm(Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0]));

// ---------- 颜色：输入 sRGB 十六进制，存储线性值（three.js 与 glTF 的顶点色都按线性解释） ----------
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const rgb = (hex) => {
  const h = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;
  return [s2l(((h >> 16) & 255) / 255), s2l(((h >> 8) & 255) / 255), s2l((h & 255) / 255)];
};
export const mixc = mix3;
export const scalec = (c, s) => [c[0] * s, c[1] * s, c[2] * s];

// ---------- 随机数与噪声 ----------
export function rng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.normal = () => {
    const u = Math.max(1e-9, f()), v = f();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };
  return f;
}

function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// 三维值噪声，输出约 [-1, 1]
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (i, j, k) => hash3(xi + i, yi + j, zi + k);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;
}
export function fbm3(x, y, z, oct = 3) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x * f + i * 17.3, y * f - i * 9.1, z * f + i * 5.7);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

// ---------- 关键帧曲线：Catmull-Rom 插值，值可以是数或等长数组 ----------
export class Curve {
  constructor(keys) {
    // keys: [[t, v], ...]，按 t 排序（升序/降序书写都可以）
    keys = [...keys].sort((a, b) => a[0] - b[0]);
    this.t = keys.map((k) => k[0]);
    this.v = keys.map((k) => (Array.isArray(k[1]) ? k[1] : [k[1]]));
    this.dim = this.v[0].length;
  }
  at(t, out) {
    const T = this.t, V = this.v, n = T.length, d = this.dim;
    out = out || new Array(d);
    if (t <= T[0]) { for (let k = 0; k < d; k++) out[k] = V[0][k]; return out; }
    if (t >= T[n - 1]) { for (let k = 0; k < d; k++) out[k] = V[n - 1][k]; return out; }
    let i = 0;
    while (i < n - 2 && t > T[i + 1]) i++;
    const t0 = T[i], t1 = T[i + 1];
    const s = (t - t0) / (t1 - t0);
    const s2 = s * s, s3 = s2 * s;
    // 非均匀间距下的有限差分切线
    for (let k = 0; k < d; k++) {
      const p0 = V[i][k], p1 = V[i + 1][k];
      const m0 = i > 0 ? ((p1 - V[i - 1][k]) / (t1 - T[i - 1])) * (t1 - t0) : p1 - p0;
      const m1 = i < n - 2 ? ((V[i + 2][k] - p0) / (T[i + 2] - t0)) * (t1 - t0) : p1 - p0;
      out[k] = (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1;
    }
    return out;
  }
  f(t) {
    return this.at(t)[0];
  }
}

// 三维折线/控制点的 Catmull-Rom 样条（向心参数化），返回 p(t), t∈[0,1]
export function spline3(pts) {
  const n = pts.length;
  const P = (i) => pts[clamp(i, 0, n - 1)];
  // 端点外推，保证首尾切线自然
  const ext0 = madd(pts[0], sub(pts[0], pts[1]), 1);
  const extN = madd(pts[n - 1], sub(pts[n - 1], pts[n - 2]), 1);
  const Q = (i) => (i < 0 ? ext0 : i > n - 1 ? extN : P(i));
  return (t) => {
    const f = clamp(t, 0, 1) * (n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    const s = f - i;
    const p0 = Q(i - 1), p1 = Q(i), p2 = Q(i + 1), p3 = Q(i + 2);
    const s2 = s * s, s3 = s2 * s;
    const out = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      out[k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * s + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * s2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * s3);
    }
    return out;
  };
}

// 把一条曲线按弧长重新采样成 n+1 个点
export function resample(pts, n) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + dist(pts[i], pts[i - 1]));
  const total = L[L.length - 1] || 1;
  const out = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * total;
    while (j < pts.length - 2 && L[j + 1] < s) j++;
    const f = (s - L[j]) / (L[j + 1] - L[j] || 1);
    out.push(mix3(pts[j], pts[j + 1], clamp(f, 0, 1)));
  }
  return { pts: out, length: total };
}

// 沿曲线的平行移动标架；up 作为初始法向参考
export function transportFrames(pts, up) {
  const n = pts.length;
  const T = [], N = [], B = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    T.push(norm(sub(b, a)));
  }
  let n0 = up ? sub(up, mul(T[0], dot(up, T[0]))) : perp(T[0]);
  if (len(n0) < 1e-6) n0 = perp(T[0]);
  N.push(norm(n0));
  for (let i = 1; i < n; i++) {
    const t0 = T[i - 1], t1 = T[i];
    const ax = cross(t0, t1);
    const s = len(ax);
    let nn = N[i - 1];
    if (s > 1e-9) {
      const ang = Math.atan2(s, dot(t0, t1));
      nn = rotAxis(nn, mul(ax, 1 / s), ang);
    }
    nn = norm(sub(nn, mul(t1, dot(nn, t1))));
    N.push(nn);
  }
  // B = N × T：截面点 N cos a + B sin a 随 a 增大时，面法线朝外
  for (let i = 0; i < n; i++) B.push(cross(N[i], T[i]));
  return { T, N, B };
}

// ---------- 可增长的类型化数组 ----------
class FBuf {
  constructor(n = 1 << 15) {
    this.a = new Float32Array(n);
    this.n = 0;
  }
  reserve(k) {
    if (this.n + k > this.a.length) {
      let m = this.a.length * 2;
      while (m < this.n + k) m *= 2;
      const b = new Float32Array(m);
      b.set(this.a.subarray(0, this.n));
      this.a = b;
    }
  }
  view() {
    return this.a.subarray(0, this.n);
  }
}
class UBuf {
  constructor(n = 1 << 15) {
    this.a = new Uint32Array(n);
    this.n = 0;
  }
  reserve(k) {
    if (this.n + k > this.a.length) {
      let m = this.a.length * 2;
      while (m < this.n + k) m *= 2;
      const b = new Uint32Array(m);
      b.set(this.a.subarray(0, this.n));
      this.a = b;
    }
  }
  view() {
    return this.a.subarray(0, this.n);
  }
}

// ---------- 精度档位 ----------
// standard：约 400 万面，浏览器里流畅；ultra：≥ 2000 万面（网格加密 + 每束头发表面铺细发丝）
export const DETAIL = { level: 'standard', res: 1, lockSeg: 0.0055, lockSides: 12, fineSeg: 0.008, strandsPerLock: 0 };
export function setDetail(level) {
  if (level === 'ultra') Object.assign(DETAIL, { level, res: 1.6, lockSeg: 0.0035, lockSides: 16, fineSeg: 0.005, strandsPerLock: 34 });
  else Object.assign(DETAIL, { level: 'standard', res: 1, lockSeg: 0.0055, lockSides: 12, fineSeg: 0.008, strandsPerLock: 0 });
}
// 按档位缩放网格分段数
export const RES = (n) => Math.max(2, Math.round(n * DETAIL.res));

// ---------- 网格构建器 ----------
// 每个 Mesh 对应一种材质；顶点带位置与线性顶点色。法线默认在最后按面积加权统一计算；
// explicitNormals 的网格（细发丝）由调用方逐顶点给出法线（用发量整体的朝向来着色，避免细管子的明暗噪点）。
export class Mesh {
  constructor(name, opts = {}) {
    this.name = name;
    this.P = new FBuf();
    this.C = new FBuf();
    this.I = new UBuf();
    this.Nb = opts.explicitNormals ? new FBuf() : null;
    this.normals = null;
  }
  get vertexCount() {
    return this.P.n / 3;
  }
  get triangleCount() {
    return this.I.n / 3;
  }
  vert(p, c, n) {
    const P = this.P, C = this.C;
    P.reserve(3);
    C.reserve(3);
    const i = P.n / 3;
    P.a[P.n++] = p[0]; P.a[P.n++] = p[1]; P.a[P.n++] = p[2];
    C.a[C.n++] = c[0]; C.a[C.n++] = c[1]; C.a[C.n++] = c[2];
    if (this.Nb) {
      const N = this.Nb;
      N.reserve(3);
      const m = n || [0, 1, 0];
      N.a[N.n++] = m[0]; N.a[N.n++] = m[1]; N.a[N.n++] = m[2];
    }
    return i;
  }
  tri(a, b, c) {
    const I = this.I;
    I.reserve(3);
    I.a[I.n++] = a; I.a[I.n++] = b; I.a[I.n++] = c;
  }
  mark() {
    return { v: this.P.n / 3, i: this.I.n };
  }

  // 参数曲面网格。
  // sample(u, v) 返回 { p:[x,y,z], c:[r,g,b], n? }（或直接返回点，此时用 opts.color）。
  // u ∈ [0,1] 共 nu 段；v 方向 wrap 时共 nv 个点首尾相接，否则 nv 段。
  // pole0/pole1：u=0 / u=1 处收成单个顶点。法线方向为 ∂u × ∂v，必要时 flip。
  grid(nu, nv, sample, opts = {}) {
    const wrap = opts.wrap !== false;
    const cols = wrap ? nv : nv + 1;
    const color = opts.color || [1, 1, 1];
    const rows = [];
    const get = (u, v) => {
      const r = sample(u, v);
      if (Array.isArray(r)) return { p: r, c: color, n: null };
      return { p: r.p, c: r.c || color, n: r.n || null };
    };
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      if ((i === 0 && opts.pole0) || (i === nu && opts.pole1)) {
        // 极点：对一圈取平均，避免采样方向带来的偏差
        let px = 0, py = 0, pz = 0, cr = 0, cg = 0, cb = 0, nx = 0, ny = 0, nz = 0;
        const k = 8;
        for (let j = 0; j < k; j++) {
          const s = get(u, j / k);
          px += s.p[0]; py += s.p[1]; pz += s.p[2];
          cr += s.c[0]; cg += s.c[1]; cb += s.c[2];
          if (s.n) { nx += s.n[0]; ny += s.n[1]; nz += s.n[2]; }
        }
        rows.push(this.vert([px / k, py / k, pz / k], [cr / k, cg / k, cb / k], this.Nb ? norm([nx, ny, nz]) : null));
        continue;
      }
      const start = this.P.n / 3;
      for (let j = 0; j < cols; j++) {
        const s = get(u, j / nv);
        this.vert(s.p, s.c, s.n);
      }
      rows.push(start);
    }
    const flip = !!opts.flip;
    const isPole = (i) => (i === 0 && opts.pole0) || (i === nu && opts.pole1);
    for (let i = 0; i < nu; i++) {
      const p0 = isPole(i), p1 = isPole(i + 1);
      for (let j = 0; j < nv; j++) {
        const j1 = wrap ? (j + 1) % nv : j + 1;
        const a = p0 ? rows[i] : rows[i] + j;
        const d = p0 ? rows[i] : rows[i] + j1;
        const b = p1 ? rows[i + 1] : rows[i + 1] + j;
        const c = p1 ? rows[i + 1] : rows[i + 1] + j1;
        if (!p1) flip ? this.tri(a, c, b) : this.tri(a, b, c);
        if (!p0) flip ? this.tri(a, d, c) : this.tri(a, c, d);
      }
    }
  }

  // 沿曲线扫掠的管状体。pts: 中心线点列；section(t, a, i) 返回截面偏移 [n分量, b分量(, t分量)]
  // 或 { o, c, n }；a ∈ [0, TAU)，i 为中心线点序号。
  tube(pts, nv, section, opts = {}) {
    const n = pts.length - 1;
    const fr = opts.frames || transportFrames(pts, opts.up);
    const { T, N, B } = fr;
    this.grid(
      n,
      nv,
      (u, v) => {
        const i = Math.round(u * n);
        const a = v * TAU;
        const r = section(u, a, i);
        const off = r.o || r;
        const p = pts[i];
        const q = [
          p[0] + N[i][0] * off[0] + B[i][0] * off[1] + T[i][0] * (off[2] || 0),
          p[1] + N[i][1] * off[0] + B[i][1] * off[1] + T[i][1] * (off[2] || 0),
          p[2] + N[i][2] * off[0] + B[i][2] * off[1] + T[i][2] * (off[2] || 0),
        ];
        return { p: q, c: r.c || opts.color, n: r.n };
      },
      { wrap: true, pole0: opts.pole0, pole1: opts.pole1, flip: opts.flip, color: opts.color },
    );
    return fr;
  }

  // 把 [mark, 当前] 区间的几何沿 x=0 镜像复制一份（绕向翻转）
  mirrorFrom(m) {
    const v0 = m.v, v1 = this.P.n / 3, i0 = m.i, i1 = this.I.n;
    const off = v1 - v0;
    for (let v = v0; v < v1; v++) {
      const p = [-this.P.a[v * 3], this.P.a[v * 3 + 1], this.P.a[v * 3 + 2]];
      const c = [this.C.a[v * 3], this.C.a[v * 3 + 1], this.C.a[v * 3 + 2]];
      const n = this.Nb ? [-this.Nb.a[v * 3], this.Nb.a[v * 3 + 1], this.Nb.a[v * 3 + 2]] : null;
      this.vert(p, c, n);
    }
    for (let k = i0; k < i1; k += 3) {
      const a = this.I.a[k] + off, b = this.I.a[k + 1] + off, c = this.I.a[k + 2] + off;
      this.tri(a, c, b);
    }
  }

  // 对区间内顶点施加变换 f(p) -> p
  transformFrom(m, f) {
    const P = this.P.a;
    for (let v = m.v; v < this.P.n / 3; v++) {
      const q = f([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
      P[v * 3] = q[0]; P[v * 3 + 1] = q[1]; P[v * 3 + 2] = q[2];
    }
  }

  computeNormals() {
    if (this.Nb) {
      const Nn = this.Nb.n === this.Nb.a.length ? this.Nb.a : this.Nb.a.slice(0, this.Nb.n);
      for (let k = 0; k < Nn.length; k += 3) {
        const l = Math.hypot(Nn[k], Nn[k + 1], Nn[k + 2]) || 1;
        Nn[k] /= l; Nn[k + 1] /= l; Nn[k + 2] /= l;
      }
      this.Nb = null;
      this.normals = Nn;
      return Nn;
    }
    const P = this.P.view(), I = this.I.view();
    const Nn = new Float32Array(P.length);
    for (let k = 0; k < I.length; k += 3) {
      const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      Nn[a] += nx; Nn[a + 1] += ny; Nn[a + 2] += nz;
      Nn[b] += nx; Nn[b + 1] += ny; Nn[b + 2] += nz;
      Nn[c] += nx; Nn[c + 1] += ny; Nn[c + 2] += nz;
    }
    for (let k = 0; k < Nn.length; k += 3) {
      const l = Math.hypot(Nn[k], Nn[k + 1], Nn[k + 2]) || 1;
      Nn[k] /= l; Nn[k + 1] /= l; Nn[k + 2] /= l;
    }
    this.normals = Nn;
    return Nn;
  }

  // 导出为紧凑的类型化数组。缓冲区只在明显过大时才复制，并立即释放构建用的缓冲，
  // 2000 万面档位下能省下数百 MB 的峰值内存。
  finish() {
    if (!this.normals) this.computeNormals();
    const tight = (b) => (b.a.length <= b.n * 1.15 ? b.a.subarray(0, b.n) : b.a.slice(0, b.n));
    const out = {
      name: this.name,
      positions: tight(this.P),
      normals: this.normals,
      colors: tight(this.C),
      indices: tight(this.I),
    };
    this.P = this.C = this.I = null;
    this.normals = null;
    return out;
  }
}

// 一张参数网格按区域分到不同材质的网格里：sample(u, v) -> { p, c: [每个网格的颜色] }，
// pick(四边形中心点, i, j) -> 网格序号。边界上的顶点在各网格中各存一份。
export function gridSplit(meshes, nu, nv, sample, pick, opts = {}) {
  const wrap = opts.wrap !== false;
  const cols = wrap ? nv : nv + 1;
  const S = new Array((nu + 1) * cols);
  for (let i = 0; i <= nu; i++) for (let j = 0; j < cols; j++) S[i * cols + j] = sample(i / nu, j / nv);
  const maps = meshes.map(() => new Int32Array((nu + 1) * cols).fill(-1));
  const vid = (m, k) => {
    if (maps[m][k] < 0) maps[m][k] = meshes[m].vert(S[k].p, S[k].c[m]);
    return maps[m][k];
  };
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const j1 = wrap ? (j + 1) % nv : j + 1;
      const ka = i * cols + j, kb = (i + 1) * cols + j, kc = (i + 1) * cols + j1, kd = i * cols + j1;
      const pa = S[ka].p, pc = S[kc].p;
      const mid = [(pa[0] + pc[0]) / 2, (pa[1] + pc[1]) / 2, (pa[2] + pc[2]) / 2];
      const m = pick(mid, i, j);
      const M = meshes[m];
      const a = vid(m, ka), b = vid(m, kb), c = vid(m, kc), d = vid(m, kd);
      if (opts.flip) {
        M.tri(a, c, b);
        M.tri(a, d, c);
      } else {
        M.tri(a, b, c);
        M.tri(a, c, d);
      }
    }
  }
}

// 一组按材质分开的网格
export class Model {
  constructor() {
    this.meshes = new Map();
  }
  mesh(name, opts) {
    if (!this.meshes.has(name)) this.meshes.set(name, new Mesh(name, opts));
    return this.meshes.get(name);
  }
}
