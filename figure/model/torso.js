// 上衣（水手服）躯干的形状函数：由水平截面（前后不对称的超椭圆）放样。
// 头发碰撞、衣领、领结都要贴着它，所以单独成一个模块。
import { Curve, spow, clamp, smoothstep, norm, sub, cross, dot, fbm3 } from './core.js';

// y -> [半宽W, 前缘zF, 后缘zB, 前半指数nF, 后半指数nB]
const KEYS = new Curve([
  [0.835, [0.17, 0.112, -0.103, 2.2, 2.2]],
  [0.86, [0.163, 0.106, -0.097, 2.2, 2.2]],
  [0.9, [0.152, 0.097, -0.088, 2.2, 2.2]],
  [0.95, [0.138, 0.088, -0.079, 2.2, 2.2]],
  [1.0, [0.13, 0.086, -0.075, 2.2, 2.25]],
  [1.06, [0.133, 0.092, -0.075, 2.2, 2.3]],
  [1.12, [0.142, 0.102, -0.077, 2.25, 2.4]],
  [1.17, [0.148, 0.103, -0.08, 2.3, 2.5]],
  [1.22, [0.154, 0.094, -0.082, 2.45, 2.6]],
  [1.26, [0.161, 0.08, -0.081, 2.8, 2.8]],
  [1.285, [0.162, 0.068, -0.075, 3.0, 3.0]],
  [1.305, [0.149, 0.056, -0.066, 2.8, 2.8]],
  [1.322, [0.122, 0.045, -0.059, 2.5, 2.5]],
  [1.336, [0.088, 0.035, -0.055, 2.2, 2.2]],
  [1.348, [0.057, 0.025, -0.06, 2.1, 2.1]],
]);
export const TORSO_Y0 = 0.835;
export const TORSO_Y1 = 1.348;
// 颈部（世界坐标）：中心线略前倾
export const NECK = { x: 0, z0: -0.026, z1: -0.02, rx: 0.0345, rz: 0.0365, y0: 1.29, y1: 1.43 };

const _k = new Array(5);
export function torsoSlice(y) {
  KEYS.at(clamp(y, TORSO_Y0, TORSO_Y1), _k);
  return { W: _k[0], zF: _k[1], zB: _k[2], nF: _k[3], nB: _k[4], z0: (_k[1] + _k[2]) / 2 };
}

// 衣褶：腰部与下摆的竖向褶皱、胸下的横向松弛
function fold(y, phi, x, z) {
  const s = Math.sin(phi);
  let d = 0.0011 * fbm3(x * 26, y * 9, z * 26, 3);
  // 下摆附近的竖褶
  d += 0.0022 * smoothstep(0.98, 0.86, y) * Math.sin(phi * 13 + 1.7 * fbm3(x * 8, y * 3, z * 8, 2)) * (0.6 + 0.4 * s);
  // 胸口下方的软褶（上衣从胸部垂下）
  d += 0.0012 * smoothstep(1.13, 1.06, y) * smoothstep(0.96, 1.04, y) * Math.sin(phi * 9 + y * 40) * Math.max(0, s);
  return d;
}

export function torsoBase(y, phi) {
  const S = torsoSlice(y);
  const c = Math.cos(phi), s = Math.sin(phi);
  const front = s > 0;
  const n = front ? S.nF : S.nB;
  const D = front ? S.zF - S.z0 : S.z0 - S.zB;
  return [S.W * spow(c, 2 / n), y, S.z0 + D * spow(s, 2 / n)];
}

export function torsoPoint(y, phi) {
  const p = torsoBase(y, phi);
  const d = fold(y, phi, p[0], p[2]);
  const S = torsoSlice(y);
  const gx = p[0] / (S.W * S.W), gz = (p[2] - S.z0) / Math.pow(Math.sin(phi) > 0 ? S.zF - S.z0 : S.z0 - S.zB, 2);
  const l = Math.hypot(gx, gz) || 1;
  return [p[0] + (gx / l) * d, y, p[2] + (gz / l) * d];
}

export function torsoNormal(y, phi) {
  const h = 0.002, a = 0.004;
  const p = torsoPoint(y, phi);
  const py = sub(torsoPoint(Math.min(TORSO_Y1, y + h), phi), torsoPoint(Math.max(TORSO_Y0, y - h), phi));
  const pp = sub(torsoPoint(y, phi + a), torsoPoint(y, phi - a));
  let n = norm(cross(py, pp));
  const S = torsoSlice(y);
  if (n[0] * p[0] + n[2] * (p[2] - S.z0) < 0) n = [-n[0], -n[1], -n[2]];
  return n;
}

// 由截面上的方向求 φ：把 (x, z) 沿截面中心径向投影到曲面上
export function torsoPhi(x, y, z) {
  const S = torsoSlice(y);
  const dz = z - S.z0;
  const front = dz > 0;
  const n = front ? S.nF : S.nB;
  const D = front ? S.zF - S.z0 : S.z0 - S.zB;
  const k = Math.pow(Math.pow(Math.abs(x) / S.W, n) + Math.pow(Math.abs(dz) / D, n), 1 / n) || 1;
  const xs = x / k, zs = dz / k;
  const c = spow(xs / S.W, n / 2), s = spow(zs / D, n / 2);
  return Math.atan2(s, c);
}
// 投影到上衣表面并沿法线外移 off
export function torsoProject(p, off = 0) {
  const y = clamp(p[1], TORSO_Y0, TORSO_Y1);
  const phi = torsoPhi(p[0], y, p[2]);
  const q = torsoPoint(y, phi);
  if (!off) return q;
  const n = torsoNormal(y, phi);
  return [q[0] + n[0] * off, q[1] + n[1] * off, q[2] + n[2] * off];
}
// 给定 x、y 与前/后，求表面上的大致 z（用于定义衣领轮廓）
export function torsoZ(x, y, front) {
  const S = torsoSlice(y);
  const n = front ? S.nF : S.nB;
  const D = front ? S.zF - S.z0 : S.z0 - S.zB;
  const t = Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(x) / S.W), n)), 1 / n);
  return S.z0 + (front ? 1 : -1) * D * t;
}
// 点是否在上衣内部（含 margin），用于头发碰撞：返回推出后的点或 null
export function pushOutTorso(p, margin) {
  if (p[1] > TORSO_Y1 + 0.01 || p[1] < TORSO_Y0) return false;
  const y = Math.min(p[1], TORSO_Y1);
  const S = torsoSlice(y);
  const dz = p[2] - S.z0;
  const front = dz > 0;
  const n = front ? S.nF : S.nB;
  const D = (front ? S.zF - S.z0 : S.z0 - S.zB) + margin;
  const W = S.W + margin;
  const k = Math.pow(Math.pow(Math.abs(p[0]) / W, n) + Math.pow(Math.abs(dz) / D, n), 1 / n);
  if (k >= 1) return false;
  if (k < 1e-6) return false;
  // 沿真实曲面法线补足到 margin 的距离（只沿法线移动，保留切向位置；
  // 肩顶处法线朝上，头发会搭在肩上而不是被横向挤开）
  const phi = torsoPhi(p[0], y, p[2]);
  const q = torsoPoint(y, phi);
  const nn = torsoNormal(y, phi);
  const d = (p[0] - q[0]) * nn[0] + (p[1] - q[1]) * nn[1] + (p[2] - q[2]) * nn[2];
  if (d >= margin) return false;
  const m = margin - d;
  p[0] += nn[0] * m;
  p[1] += nn[1] * m;
  p[2] += nn[2] * m;
  return true;
}
