import * as THREE from 'three';
import { PAT } from './materials.js';

// 合批几何体构建器：所有静态物件在 CPU 端拼成少量大网格，顶点色 + 图案属性，一次绘制
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();

const colorCache = new Map();
// 十六进制颜色（sRGB）→ 线性 THREE.Color（缓存）
export function C(hex) {
  if (hex && hex.isColor) return hex;
  let c = colorCache.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    colorCache.set(hex, c);
  }
  return c;
}
// 颜色变化：明度/色相轻微抖动
export function vary(hex, rng, amount = 0.06, hueAmt = 0.01) {
  const c = C(hex).clone();
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(
    (hsl.h + (rng.next() - 0.5) * hueAmt + 1) % 1,
    THREE.MathUtils.clamp(hsl.s * (1 + (rng.next() - 0.5) * amount * 2), 0, 1),
    THREE.MathUtils.clamp(hsl.l * (1 + (rng.next() - 0.5) * amount * 2), 0, 1)
  );
  return c;
}
export function mulColor(hex, k) {
  return C(hex).clone().multiplyScalar(k);
}
export function mixColor(a, b, t) {
  return C(a).clone().lerp(C(b), t);
}

// 统一三角形绕向：ccw=true 时使其在二维坐标中逆时针
function orientTris(tris, poly, ccw) {
  return tris.map((t) => {
    const a = poly[t[0]], b = poly[t[1]], c = poly[t[2]];
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    return (area > 0) === ccw ? t : [t[0], t[2], t[1]];
  });
}

export class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.pat = [];
    this.idx = [];
    this.uvs = null; // 仅招牌网格使用
    this.glow = null;
    this.m = new THREE.Matrix4();
    this.nm = new THREE.Matrix3();
    this.stack = [];
    this.patId = 0;
    this.emis = 0;
  }
  get vcount() {
    return this.pos.length / 3;
  }
  enableUV() {
    this.uvs = [];
    this.glow = [];
    return this;
  }
  // ---------- 变换栈 ----------
  _sync() {
    this.nm.getNormalMatrix(this.m);
    return this;
  }
  push() {
    this.stack.push(this.m.clone());
    return this;
  }
  pop() {
    this.m.copy(this.stack.pop());
    return this._sync();
  }
  identity() {
    this.m.identity();
    return this._sync();
  }
  translate(x, y, z) {
    this.m.multiply(_m.makeTranslation(x, y, z));
    return this._sync();
  }
  rotateY(a) {
    this.m.multiply(_m.makeRotationY(a));
    return this._sync();
  }
  rotateX(a) {
    this.m.multiply(_m.makeRotationX(a));
    return this._sync();
  }
  rotateZ(a) {
    this.m.multiply(_m.makeRotationZ(a));
    return this._sync();
  }
  scale(x, y, z) {
    this.m.multiply(_m.makeScale(x, y, z));
    return this._sync();
  }
  place(x, y, z, rot = 0) {
    return this.identity().translate(x, y, z).rotateY(rot);
  }
  pattern(id, emis = 0) {
    this.patId = id;
    this.emis = emis;
    return this;
  }
  // ---------- 顶点 ----------
  vert(x, y, z, nx, ny, nz, color, u = 0, w = 0) {
    _v.set(x, y, z).applyMatrix4(this.m);
    _n.set(nx, ny, nz).applyMatrix3(this.nm).normalize();
    this.pos.push(_v.x, _v.y, _v.z);
    this.nor.push(_n.x, _n.y, _n.z);
    this.col.push(color.r, color.g, color.b);
    this.pat.push(u, w, this.patId, this.emis);
    if (this.uvs) {
      this.uvs.push(u, w);
      this.glow.push(this.emis);
    }
    return this.vcount - 1;
  }
  tri(i0, i1, i2) {
    this.idx.push(i0, i1, i2);
  }
  // 四边形：a,b,c,d 为局部坐标，正面逆时针；uv 可选 [[u,v]x4]，默认按米制展开
  quad(a, b, c, d, color, uv = null, colors = null) {
    color = C(color);
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    _c.crossVectors(_a, _b);
    if (_c.lengthSq() < 1e-12) _c.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]).cross(_a).negate();
    _c.normalize();
    const nx = _c.x, ny = _c.y, nz = _c.z;
    let uvs = uv;
    if (!uvs) {
      const lu = _a.length(), lv = _b.length();
      uvs = [[0, 0], [lu, 0], [lu, lv], [0, lv]];
    }
    const pts = [a, b, c, d];
    const base = this.vcount;
    for (let i = 0; i < 4; i++) {
      const p = pts[i];
      this.vert(p[0], p[1], p[2], nx, ny, nz, colors ? C(colors[i]) : color, uvs[i][0], uvs[i][1]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }
  triangle(a, b, c, color, uv = null) {
    color = C(color);
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _c.crossVectors(_a, _b).normalize();
    const uvs = uv || [[0, 0], [_a.length(), 0], [0, _b.length()]];
    const base = this.vcount;
    [a, b, c].forEach((p, i) => this.vert(p[0], p[1], p[2], _c.x, _c.y, _c.z, color, uvs[i][0], uvs[i][1]));
    this.idx.push(base, base + 1, base + 2);
    return this;
  }
  // 长方体：底面中心 (cx, y0, cz)，尺寸 w(x) h(y) d(z)
  // opts: { faces: 'all' | 字符串含 px nx py ny pz nz, ao: 底部暗化, topColor, sideColor, uvAbs: 使用局部绝对坐标作为 uv（图案跨块对齐） }
  box(cx, y0, cz, w, h, d, color, opts = {}) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    const col = C(color);
    const top = opts.topColor ? C(opts.topColor) : col;
    const faces = opts.faces || 'pxnxpynypznz';
    const ao = opts.ao || 0;
    const bot = ao ? col.clone().multiplyScalar(1 - ao) : col;
    const abs = opts.uvAbs !== false;
    const side = (a, b, c, d, ua, ub) => {
      const uv = abs ? [[ua, y0], [ub, y0], [ub, y1], [ua, y1]] : null;
      this.quad(a, b, c, d, col, uv, ao ? [bot, bot, col, col] : null);
    };
    if (faces.includes('px')) side([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], -z1, -z0);
    if (faces.includes('nx')) side([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], z0, z1);
    if (faces.includes('pz')) side([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], x0, x1);
    if (faces.includes('nz')) side([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], -x1, -x0);
    if (faces.includes('py')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, abs ? [[x0, z1], [x1, z1], [x1, z0], [x0, z0]] : null);
    if (faces.includes('ny')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], bot);
    return this;
  }
  // 竖直圆柱 / 圆台
  cylinder(cx, y0, cz, rTop, rBot, h, seg, color, opts = {}) {
    const col = C(color);
    const topCol = opts.topColor ? C(opts.topColor) : col;
    const base = this.vcount;
    const slope = (rBot - rTop) / h;
    const a0 = opts.angle0 || 0;
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nl = Math.hypot(1, slope);
      const nx = ca / nl, ny = slope / nl, nz = sa / nl;
      const u = (i / seg) * Math.PI * 2 * Math.max(rTop, rBot);
      const bc = opts.ao ? col.clone().multiplyScalar(1 - opts.ao) : col;
      this.vert(cx + ca * rBot, y0, cz + sa * rBot, nx, ny, nz, bc, u, y0);
      this.vert(cx + ca * rTop, y0 + h, cz + sa * rTop, nx, ny, nz, col, u, y0 + h);
    }
    for (let i = 0; i < seg; i++) {
      const i0 = base + i * 2;
      this.idx.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2);
    }
    if (opts.caps !== false) {
      if (rTop > 0.001) this._disc(cx, y0 + h, cz, rTop, seg, topCol, 1, a0);
      if (opts.bottom && rBot > 0.001) this._disc(cx, y0, cz, rBot, seg, col, -1, a0);
    }
    return this;
  }
  _disc(cx, y, cz, r, seg, col, dir, a0 = 0) {
    const c0 = this.vert(cx, y, cz, 0, dir, 0, col, cx, cz);
    const first = this.vcount;
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * Math.PI * 2;
      this.vert(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, 0, dir, 0, col, cx + Math.cos(a) * r, cz + Math.sin(a) * r);
    }
    for (let i = 0; i < seg; i++) {
      if (dir > 0) this.idx.push(c0, first + i + 1, first + i);
      else this.idx.push(c0, first + i, first + i + 1);
    }
  }
  // 旋转体：profile [[r, y], ...] 自下而上
  lathe(cx, cz, profile, seg, color, opts = {}) {
    const col = C(color);
    const colors = opts.colors; // 每个 profile 点的颜色
    const base = this.vcount;
    const n = profile.length;
    // 每个 profile 点的法线（二维）
    const pn = [];
    for (let j = 0; j < n; j++) {
      const p0 = profile[Math.max(0, j - 1)], p1 = profile[Math.min(n - 1, j + 1)];
      let dr = p1[0] - p0[0], dy = p1[1] - p0[1];
      const l = Math.hypot(dr, dy) || 1;
      pn.push([dy / l, -dr / l]);
    }
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2 + (opts.angle0 || 0);
      const ca = Math.cos(a), sa = Math.sin(a);
      for (let j = 0; j < n; j++) {
        const [r, y] = profile[j];
        const [nr, ny] = pn[j];
        const c = colors ? C(colors[j]) : col;
        this.vert(cx + ca * r, y, cz + sa * r, ca * nr, ny, sa * nr, c, (i / seg) * 6.283 * r, y);
      }
    }
    for (let i = 0; i < seg; i++)
      for (let j = 0; j < n - 1; j++) {
        const a = base + i * n + j, b = base + (i + 1) * n + j;
        this.idx.push(a, a + 1, b + 1, a, b + 1, b);
      }
    return this;
  }
  // 球（可缩放成椭球）
  sphere(cx, cy, cz, r, wSeg, hSeg, color, opts = {}) {
    const col = C(color);
    const sx = opts.sx || 1, sy = opts.sy || 1, sz = opts.sz || 1;
    const base = this.vcount;
    const phiMax = opts.hemi ? Math.PI / 2 : Math.PI;
    for (let j = 0; j <= hSeg; j++) {
      const phi = (j / hSeg) * phiMax;
      for (let i = 0; i <= wSeg; i++) {
        const th = (i / wSeg) * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
        const c = opts.bottomColor ? col.clone().lerp(C(opts.bottomColor), j / hSeg) : col;
        this.vert(cx + nx * r * sx, cy + ny * r * sy, cz + nz * r * sz, nx / sx, ny / sy, nz / sz, c, th * r, phi * r);
      }
    }
    for (let j = 0; j < hSeg; j++)
      for (let i = 0; i < wSeg; i++) {
        const a = base + j * (wSeg + 1) + i, b = a + wSeg + 1;
        this.idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    return this;
  }
  // 在 XY 平面的多边形沿 Z 挤出（z0→z1），用于山墙、拱桥侧板、鸟居笠木
  extrudeXY(poly, z0, z1, color, opts = {}) {
    const col = C(color);
    const capCol = opts.capColor ? C(opts.capColor) : col;
    const n = poly.length;
    const contour = poly.map((p) => new THREE.Vector2(p[0], p[1]));
    const cw = THREE.ShapeUtils.isClockWise(contour);
    if (!opts.noSides) {
      for (let i = 0; i < n; i++) {
        const p = poly[i], q = poly[(i + 1) % n];
        const sc = opts.sideColor ? C(opts.sideColor) : col;
        if (!cw) this.quad([p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1], sc);
        else this.quad([q[0], q[1], z0], [p[0], p[1], z0], [p[0], p[1], z1], [q[0], q[1], z1], sc);
      }
    }
    if (opts.caps !== false) {
      const tris = orientTris(THREE.ShapeUtils.triangulateShape(contour, []), poly, true);
      const b1 = this.vcount;
      for (const p of poly) this.vert(p[0], p[1], z1, 0, 0, 1, capCol, p[0], p[1]);
      const b0 = this.vcount;
      for (const p of poly) this.vert(p[0], p[1], z0, 0, 0, -1, capCol, p[0], p[1]);
      for (const t of tris) {
        this.idx.push(b1 + t[0], b1 + t[1], b1 + t[2]);
        this.idx.push(b0 + t[0], b0 + t[2], b0 + t[1]);
      }
    }
    return this;
  }
  // 水平多边形（XZ）挤出成柱体 y0→y1
  prism(poly, y0, y1, color, opts = {}) {
    const col = C(color);
    const n = poly.length;
    const contour = poly.map((p) => new THREE.Vector2(p[0], p[1]));
    const cw = THREE.ShapeUtils.isClockWise(contour);
    for (let i = 0; i < n; i++) {
      const p = poly[i], q = poly[(i + 1) % n];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (cw) this.quad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]], col, [[0, y0], [len, y0], [len, y1], [0, y1]]);
      else this.quad([q[0], y0, q[1]], [p[0], y0, p[1]], [p[0], y1, p[1]], [q[0], y1, q[1]], col, [[0, y0], [len, y0], [len, y1], [0, y1]]);
    }
    // 顶面朝上：在 (x,z) 坐标中需要顺时针
    const tris = orientTris(THREE.ShapeUtils.triangulateShape(contour, []), poly, false);
    const top = opts.topColor ? C(opts.topColor) : col;
    const b = this.vcount;
    for (const p of poly) this.vert(p[0], y1, p[1], 0, 1, 0, top, p[0], p[1]);
    for (const t of tris) this.idx.push(b + t[0], b + t[1], b + t[2]);
    return this;
  }
  // 参数曲面：fn(u,v) → [x,y,z]，nu×nv 网格；normalSign 控制朝向
  surface(fn, nu, nv, color, opts = {}) {
    const col = C(color);
    const base = this.vcount;
    const P = [];
    for (let j = 0; j <= nv; j++)
      for (let i = 0; i <= nu; i++) P.push(fn(i / nu, j / nv));
    const idx = (i, j) => j * (nu + 1) + i;
    const sign = opts.flip ? -1 : 1;
    for (let j = 0; j <= nv; j++)
      for (let i = 0; i <= nu; i++) {
        const p = P[idx(i, j)];
        const pu = P[idx(Math.min(nu, i + 1), j)], pu0 = P[idx(Math.max(0, i - 1), j)];
        const pv = P[idx(i, Math.min(nv, j + 1))], pv0 = P[idx(i, Math.max(0, j - 1))];
        _a.set(pu[0] - pu0[0], pu[1] - pu0[1], pu[2] - pu0[2]);
        _b.set(pv[0] - pv0[0], pv[1] - pv0[1], pv[2] - pv0[2]);
        _c.crossVectors(_a, _b).normalize().multiplyScalar(sign);
        const c = opts.colorFn ? C(opts.colorFn(i / nu, j / nv)) : col;
        const uv = opts.uvFn ? opts.uvFn(i / nu, j / nv) : [i / nu, j / nv];
        this.vert(p[0], p[1], p[2], _c.x, _c.y, _c.z, c, uv[0], uv[1]);
      }
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const a = base + idx(i, j), b = base + idx(i + 1, j), c = base + idx(i + 1, j + 1), d = base + idx(i, j + 1);
        if (sign > 0) this.idx.push(a, b, c, a, c, d);
        else this.idx.push(a, c, b, a, d, c);
      }
    if (opts.doubleSided) {
      // 背面
      const base2 = this.vcount;
      for (let j = 0; j <= nv; j++)
        for (let i = 0; i <= nu; i++) {
          const k = base + idx(i, j);
          const nx = -this.nor[k * 3], ny = -this.nor[k * 3 + 1], nz = -this.nor[k * 3 + 2];
          this.pos.push(this.pos[k * 3], this.pos[k * 3 + 1], this.pos[k * 3 + 2]);
          this.nor.push(nx, ny, nz);
          const bc = opts.backColor ? C(opts.backColor) : null;
          if (bc) this.col.push(bc.r, bc.g, bc.b);
          else this.col.push(this.col[k * 3], this.col[k * 3 + 1], this.col[k * 3 + 2]);
          this.pat.push(this.pat[k * 4], this.pat[k * 4 + 1], opts.backPat !== undefined ? opts.backPat : this.pat[k * 4 + 2], this.pat[k * 4 + 3]);
          if (this.uvs) {
            this.uvs.push(this.uvs[k * 2], this.uvs[k * 2 + 1]);
            this.glow.push(this.glow[k]);
          }
        }
      for (let j = 0; j < nv; j++)
        for (let i = 0; i < nu; i++) {
          const a = base2 + idx(i, j), b = base2 + idx(i + 1, j), c = base2 + idx(i + 1, j + 1), d = base2 + idx(i, j + 1);
          if (sign > 0) this.idx.push(a, c, b, a, d, c);
          else this.idx.push(a, b, c, a, c, d);
        }
    }
    return this;
  }
  // 管道（树枝、电线杆横担、栏杆等）：points [[x,y,z]]，radius 数字或数组
  tube(points, radius, seg, color, opts = {}) {
    const col = C(color);
    const n = points.length;
    if (n < 2) return this;
    const P = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const T = [];
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
      T.push(new THREE.Vector3().subVectors(b, a).normalize());
    }
    // 平行移动标架
    let N = new THREE.Vector3(0, 1, 0);
    if (Math.abs(T[0].y) > 0.9) N.set(1, 0, 0);
    N = new THREE.Vector3().crossVectors(T[0], N).normalize();
    const frames = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        const axis = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
        const l = axis.length();
        if (l > 1e-6) {
          axis.divideScalar(l);
          const ang = Math.acos(THREE.MathUtils.clamp(T[i - 1].dot(T[i]), -1, 1));
          N.applyAxisAngle(axis, ang);
        }
      }
      const B = new THREE.Vector3().crossVectors(T[i], N).normalize();
      frames.push([N.clone(), B]);
    }
    const base = this.vcount;
    let vAcc = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) vAcc += P[i].distanceTo(P[i - 1]);
      const r = Array.isArray(radius) ? radius[i] : radius;
      const [Ni, Bi] = frames[i];
      const c = opts.colors ? C(opts.colors[i]) : col;
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nx = Ni.x * ca + Bi.x * sa, ny = Ni.y * ca + Bi.y * sa, nz = Ni.z * ca + Bi.z * sa;
        this.vert(P[i].x + nx * r, P[i].y + ny * r, P[i].z + nz * r, nx, ny, nz, c, (k / seg) * 6.283 * r, vAcc);
      }
    }
    for (let i = 0; i < n - 1; i++)
      for (let k = 0; k < seg; k++) {
        const a = base + i * (seg + 1) + k, b = a + seg + 1;
        this.idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    if (opts.capEnd) {
      const r = Array.isArray(radius) ? radius[n - 1] : radius;
      const p = P[n - 1], t = T[n - 1];
      const c0 = this.vert(p.x + t.x * r * 0.5, p.y + t.y * r * 0.5, p.z + t.z * r * 0.5, t.x, t.y, t.z, col, 0, vAcc);
      const ring = base + (n - 1) * (seg + 1);
      for (let k = 0; k < seg; k++) this.idx.push(ring + k, ring + k + 1, c0);
    }
    return this;
  }
  // 合并任意 three.js 几何体（按当前变换）
  geometry(geo, color, opts = {}) {
    const col = C(color);
    const g = geo.index ? geo : geo;
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const base = this.vcount;
    const us = opts.uvScale || [1, 1];
    for (let i = 0; i < pos.count; i++) {
      const c = opts.colorFn ? C(opts.colorFn(pos.getX(i), pos.getY(i), pos.getZ(i))) : col;
      this.vert(
        pos.getX(i), pos.getY(i), pos.getZ(i),
        nor ? nor.getX(i) : 0, nor ? nor.getY(i) : 1, nor ? nor.getZ(i) : 0,
        c,
        uv ? uv.getX(i) * us[0] : pos.getX(i),
        uv ? uv.getY(i) * us[1] : pos.getY(i)
      );
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < pos.count; i++) this.idx.push(base + i);
    return this;
  }
  merge(other) {
    const base = this.vcount;
    this.pos.push(...other.pos);
    this.nor.push(...other.nor);
    this.col.push(...other.col);
    this.pat.push(...other.pat);
    for (const i of other.idx) this.idx.push(base + i);
    return this;
  }
  isEmpty() {
    return this.idx.length === 0;
  }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uvs) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
      g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glow, 1));
    } else g.setAttribute('aPat', new THREE.Float32BufferAttribute(this.pat, 4));
    const IndexArray = this.vcount > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new THREE.BufferAttribute(new IndexArray(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// 空间分块：按物体锚点所在格子归并，便于视锥剔除与阴影裁剪
export class ChunkMap {
  constructor(cell = 80, withUV = false) {
    this.cell = cell;
    this.withUV = withUV;
    this.map = new Map();
  }
  at(x, z) {
    const ix = Math.floor(x / this.cell), iz = Math.floor(z / this.cell);
    const k = ix + ',' + iz;
    let b = this.map.get(k);
    if (!b) {
      b = new GeoBuilder();
      if (this.withUV) b.enableUV();
      this.map.set(k, b);
    }
    b.identity();
    b.patId = 0;
    b.emis = 0;
    return b;
  }
  build(material, { castShadow = true, receiveShadow = true, name = 'chunk' } = {}) {
    const meshes = [];
    for (const [k, b] of this.map) {
      if (b.isEmpty()) continue;
      const mesh = new THREE.Mesh(b.toGeometry(), material);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.name = name + ':' + k;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      meshes.push(mesh);
    }
    return meshes;
  }
  stats() {
    let v = 0, t = 0;
    for (const b of this.map.values()) {
      v += b.vcount;
      t += b.idx.length / 3;
    }
    return { chunks: this.map.size, verts: v, tris: t };
  }
}

export { PAT };
