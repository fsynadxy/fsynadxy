// 头部：由一摞水平截面（超椭圆）放样而成，再叠加鼻、颊、唇等局部位移。
// 头部局部坐标：原点在头部中心，+y 向上，+z 向前（面部朝向），单位米。
import { Curve, clamp, lerp, smoothstep, gauss, spow, norm, sub, cross, dot, add, mul, PI, TAU } from './core.js';

// 头部在世界中的位置与姿态（轻微歪头，让站姿不那么僵硬）
export const HEAD = {
  center: [0, 1.466, 0.004],
  roll: -0.045, // 绕 z 轴：向角色右肩微倾
  pitch: 0.035, // 绕 x 轴：略微低头
  yaw: 0.02,
  scale: 1.07, // 二次元比例：头稍大
};

// 截面关键帧：u（0=下巴尖，1=头顶）-> [y, 半宽W, 前缘zF, 后缘zB, 前半指数nF, 后半指数nB, 下颌收窄V, 中心比例k]
const KEYS = new Curve([
  [0.0, [-0.1065, 0.0, 0.05, 0.05, 2.2, 2.0, 0.40, 0.5]],
  [0.03, [-0.1035, 0.0145, 0.0545, 0.03, 2.2, 2.0, 0.42, 0.5]],
  [0.08, [-0.0965, 0.0305, 0.0605, 0.0, 2.25, 2.0, 0.46, 0.48]],
  [0.15, [-0.0855, 0.0465, 0.0665, -0.032, 2.3, 2.0, 0.42, 0.46]],
  [0.24, [-0.07, 0.0608, 0.073, -0.058, 2.4, 2.1, 0.30, 0.45]],
  [0.34, [-0.0505, 0.0708, 0.079, -0.077, 2.5, 2.2, 0.17, 0.45]],
  [0.45, [-0.025, 0.0762, 0.083, -0.091, 2.6, 2.2, 0.07, 0.45]],
  [0.56, [0.0045, 0.079, 0.0835, -0.0995, 2.6, 2.3, 0.025, 0.45]],
  [0.67, [0.0365, 0.0798, 0.079, -0.102, 2.4, 2.3, 0.0, 0.46]],
  [0.77, [0.0655, 0.0765, 0.0675, -0.0985, 2.2, 2.2, 0.0, 0.47]],
  [0.86, [0.0895, 0.065, 0.048, -0.0865, 2.1, 2.1, 0.0, 0.48]],
  [0.93, [0.1065, 0.046, 0.0235, -0.0655, 2.0, 2.0, 0.0, 0.49]],
  [0.97, [0.1155, 0.0275, 0.0045, -0.0455, 2.0, 2.0, 0.0, 0.5]],
  [1.0, [0.1195, 0.0, -0.0205, -0.0205, 2.0, 2.0, 0.0, 0.5]],
]);

const _k = new Array(8);
export function slice(u) {
  KEYS.at(u, _k);
  // 下半张脸略收窄（参考图里是更尖的瓜子脸）
  return { y: _k[0], W: Math.max(0, _k[1]) * (1 - 0.045 * smoothstep(0.62, 0.25, u)), zF: _k[2], zB: _k[3], nF: _k[4], nB: _k[5], V: _k[6], k: _k[7] };
}

// 未加位移的基础曲面点
export function basePoint(u, phi, sl) {
  const S = sl || slice(u);
  const c = Math.cos(phi), s = Math.sin(phi);
  const n = lerp(S.nB, S.nF, smoothstep(-0.35, 0.35, s));
  const ex = spow(c, 2 / n), ez = spow(s, 2 / n);
  const z0 = S.zB + (S.zF - S.zB) * S.k;
  const D = s > 0 ? S.zF - z0 : z0 - S.zB;
  const x = S.W * ex * (1 - S.V * Math.pow(Math.max(0, s), 2));
  const z = z0 + D * ez;
  return [x, S.y, z, z0, D];
}

// 面部位移场（局部 x, y 输入，返回沿外法线的位移量，米）
export function faceDisp(x, y, z) {
  if (z < 0.02) return 0;
  const ax = Math.abs(x);
  let d = 0;
  // 鼻梁到鼻尖：小巧而挺，鼻尖在 y≈-0.046
  const tipY = -0.0435;
  const ridge = smoothstep(-0.006, tipY, y) * (y > tipY ? 1 : Math.max(0, 1 - (tipY - y) / 0.0065));
  const sx = lerp(0.0036, 0.0062, smoothstep(-0.01, tipY, y));
  d += 0.0062 * Math.pow(ridge, 1.8) * gauss(x, sx);
  // 鼻翼两侧微微鼓起
  d += 0.0012 * gauss(ax - 0.0068, 0.0032) * gauss(y - (tipY - 0.0015), 0.004);
  // 眼窝：极轻微的凹陷，让眼睛「坐」进脸里
  d -= 0.0016 * gauss(ax - 0.035, 0.016) * gauss(y + 0.021, 0.012);
  // 眉弓
  d += 0.0012 * gauss(ax - 0.034, 0.02) * gauss(y - 0.006, 0.006);
  // 脸颊：少女的饱满
  d += 0.0032 * gauss(ax - 0.042, 0.017) * gauss(y + 0.046, 0.016);
  // 嘴唇：上唇微翘、下唇圆润
  d += 0.0013 * gauss(x, 0.0085) * gauss(y + 0.0645, 0.0026);
  d += 0.0016 * gauss(x, 0.0072) * gauss(y + 0.0712, 0.003);
  d -= 0.0007 * gauss(x, 0.009) * gauss(y + 0.0677, 0.001); // 唇缝
  // 下唇与下巴之间的浅凹，以及下巴的小圆
  d -= 0.001 * gauss(x, 0.01) * gauss(y + 0.0785, 0.0035);
  d += 0.0014 * gauss(x, 0.012) * gauss(y + 0.091, 0.006);
  // 人中
  d -= 0.0004 * gauss(x, 0.0025) * gauss(y + 0.055, 0.005);
  return d * smoothstep(0.02, 0.05, z);
}

// 带位移的头部曲面点（局部坐标）
export function headPoint(u, phi) {
  const b = basePoint(u, phi);
  const [x, y, z, z0, D] = b;
  const d = faceDisp(x, y, z);
  if (d === 0) return [x, y, z];
  const S = slice(u);
  const gx = x / Math.max(1e-4, S.W * S.W), gz = (z - z0) / Math.max(1e-4, D * D);
  const l = Math.hypot(gx, gz) || 1;
  return [x + (gx / l) * d, y, z + (gz / l) * d];
}

// ---------- 反查：由面部正视坐标 (x, y) 求曲面参数 ----------
const ULUT = (() => {
  const n = 2048, ys = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) ys[i] = slice(i / n).y;
  return { n, ys };
})();
export function uFromY(y) {
  const { n, ys } = ULUT;
  if (y <= ys[0]) return 0;
  if (y >= ys[n]) return 1;
  let lo = 0, hi = n;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (ys[m] < y) lo = m; else hi = m;
  }
  const f = (y - ys[lo]) / (ys[hi] - ys[lo] || 1);
  return (lo + f) / n;
}
// 正面半球上，给定 u 与 x 求 φ（x≥0 时 φ∈[0,π/2]，x<0 时 φ∈[π/2,π]）
export function phiFromX(u, x) {
  const S = slice(u);
  const ax = Math.min(Math.abs(x), S.W * 0.999);
  let lo = 0, hi = PI / 2;
  for (let i = 0; i < 26; i++) {
    const m = (lo + hi) / 2;
    if (basePoint(u, m, S)[0] > ax) lo = m; else hi = m;
  }
  const phi = (lo + hi) / 2;
  return x >= 0 ? phi : PI - phi;
}

// 曲面在 (u, φ) 处的外法线（数值求导）
export function headNormal(u, phi) {
  const h = 1e-3;
  const pu0 = headPoint(Math.max(0, u - h), phi), pu1 = headPoint(Math.min(1, u + h), phi);
  const pp0 = headPoint(u, phi - h), pp1 = headPoint(u, phi + h);
  // ∂u × ∂φ 指向外侧（u 向上、φ 从 +x 经正面转向 -x）
  let n = norm(cross(sub(pu1, pu0), sub(pp1, pp0)));
  const p = headPoint(u, phi);
  const S = slice(u);
  const z0 = S.zB + (S.zF - S.zB) * S.k;
  if (dot(n, [p[0], (u - 0.5) * 0.2, p[2] - z0]) < 0) n = mul(n, -1);
  return n;
}

// 把面部「贴花」坐标投影到脸上：返回局部坐标点（沿法线外移 off）
export function faceProject(x, y, off = 0) {
  const u = uFromY(y);
  const phi = phiFromX(u, x);
  const p = headPoint(u, phi);
  if (!off) return p;
  const n = headNormal(u, phi);
  return [p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off];
}

// ---------- 头部 局部 <-> 世界 ----------
function rotMatrix() {
  const { roll, pitch, yaw } = HEAD;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  // R = Ry(yaw) * Rx(pitch) * Rz(roll)
  const Rz = [[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]];
  const Rx = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]];
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const m = (A, B) => A.map((r, i) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  return m(Ry, m(Rx, Rz));
}
const R = rotMatrix();
// 旋转支点：颈部顶端（头部局部坐标），这样歪头时脖子连接处不错位
const PIVOT = [0, -0.085, -0.022];
export function headToWorld(p) {
  const k = HEAD.scale;
  const q = [(p[0] - PIVOT[0]) * k, (p[1] - PIVOT[1]) * k, (p[2] - PIVOT[2]) * k];
  const r = [
    R[0][0] * q[0] + R[0][1] * q[1] + R[0][2] * q[2],
    R[1][0] * q[0] + R[1][1] * q[1] + R[1][2] * q[2],
    R[2][0] * q[0] + R[2][1] * q[1] + R[2][2] * q[2],
  ];
  const c = HEAD.center;
  return [r[0] + PIVOT[0] + c[0], r[1] + PIVOT[1] + c[1], r[2] + PIVOT[2] + c[2]];
}
export function worldToHead(p) {
  const c = HEAD.center;
  const q = [p[0] - c[0] - PIVOT[0], p[1] - c[1] - PIVOT[1], p[2] - c[2] - PIVOT[2]];
  // R 的逆是转置
  const k = 1 / HEAD.scale;
  return [
    (R[0][0] * q[0] + R[1][0] * q[1] + R[2][0] * q[2]) * k + PIVOT[0],
    (R[0][1] * q[0] + R[1][1] * q[1] + R[2][1] * q[2]) * k + PIVOT[1],
    (R[0][2] * q[0] + R[1][2] * q[1] + R[2][2] * q[2]) * k + PIVOT[2],
  ];
}
export function headDirToWorld(d) {
  return [
    R[0][0] * d[0] + R[0][1] * d[1] + R[0][2] * d[2],
    R[1][0] * d[0] + R[1][1] * d[1] + R[1][2] * d[2],
    R[2][0] * d[0] + R[2][1] * d[1] + R[2][2] * d[2],
  ];
}

// ---------- 头部碰撞：从中心出发的径向查找表（供头发生长使用） ----------
// 头部对中心 C 是星形的；表里存每个方向上曲面到 C 的距离。
export const HC = [0, 0.004, -0.008];
const LAT = 96, LON = 192;
let RADIAL = null;
function buildRadial() {
  RADIAL = new Float32Array((LAT + 1) * LON);
  // 先在 (u, φ) 上密集采样曲面，再把每个样本写入其方向对应的格子（取最大值），最后补洞
  const fill = new Uint8Array((LAT + 1) * LON);
  const NU = 360, NP = 720;
  for (let i = 0; i <= NU; i++) {
    const u = i / NU;
    for (let j = 0; j < NP; j++) {
      const phi = (j / NP) * TAU;
      const p = headPoint(u, phi);
      const d = [p[0] - HC[0], p[1] - HC[1], p[2] - HC[2]];
      const r = Math.hypot(d[0], d[1], d[2]);
      const th = Math.acos(clamp(d[1] / r, -1, 1));
      const ph = Math.atan2(d[2], d[0]);
      const a = Math.round((th / PI) * LAT);
      const b = ((Math.round(((ph + PI) / TAU) * LON) % LON) + LON) % LON;
      const k = a * LON + b;
      if (r > RADIAL[k]) RADIAL[k] = r;
      fill[k] = 1;
    }
  }
  // 补洞：用邻格平均
  for (let pass = 0; pass < 6; pass++) {
    for (let a = 0; a <= LAT; a++) {
      for (let b = 0; b < LON; b++) {
        const k = a * LON + b;
        if (fill[k]) continue;
        let s = 0, c = 0;
        for (const [da, db] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const aa = a + da;
          if (aa < 0 || aa > LAT) continue;
          const kk = aa * LON + ((b + db + LON) % LON);
          if (fill[kk]) { s += RADIAL[kk]; c++; }
        }
        if (c) { RADIAL[k] = s / c; fill[k] = 2; }
      }
    }
  }
}
export function headRadius(dir) {
  if (!RADIAL) buildRadial();
  const th = Math.acos(clamp(dir[1], -1, 1));
  const ph = Math.atan2(dir[2], dir[0]);
  const fa = (th / PI) * LAT, fb = ((ph + PI) / TAU) * LON;
  const a0 = Math.min(LAT - 1, Math.floor(fa)), b0 = Math.floor(fb);
  const ta = fa - a0, tb = fb - b0;
  const g = (a, b) => RADIAL[a * LON + (((b % LON) + LON) % LON)];
  return lerp(lerp(g(a0, b0), g(a0, b0 + 1), tb), lerp(g(a0 + 1, b0), g(a0 + 1, b0 + 1), tb), ta);
}
// 把头部局部坐标中的点推出到 (曲面 + off) 之外；返回是否发生了推动
export function pushOutHead(p, off) {
  const d = [p[0] - HC[0], p[1] - HC[1], p[2] - HC[2]];
  const r = Math.hypot(d[0], d[1], d[2]);
  if (r < 1e-6) return false;
  const dir = [d[0] / r, d[1] / r, d[2] / r];
  const R0 = headRadius(dir) + off;
  if (r >= R0) return false;
  p[0] = HC[0] + dir[0] * R0;
  p[1] = HC[1] + dir[1] * R0;
  p[2] = HC[2] + dir[2] * R0;
  return true;
}

// 发际线：返回 0..1，1 表示该处（局部坐标）属于头发覆盖区
export function hairMask(p) {
  const [x, y, z] = p;
  const ax = Math.abs(x);
  // 额头发际线：中间高、两鬓低
  const front = smoothstep(0.0, 0.006, y - (0.056 - 0.42 * ax * ax / 0.08 - 0.25 * Math.max(0, ax - 0.05)));
  // 侧面与后脑：耳前一条竖直边界；耳下只到耳垂高度，后颈处发际线更低
  const sideEdge = smoothstep(0.0, 0.008, 0.03 - z);
  const yMin = lerp(-0.086, -0.04, smoothstep(-0.05, -0.012, z));
  const low = smoothstep(yMin - 0.004, yMin + 0.004, y);
  return clamp(Math.max(front, sideEdge * low), 0, 1) * (z < 0.07 || y > 0.05 ? 1 : 0);
}
