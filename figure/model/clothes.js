// 制服：白色长袖水手服（藏青大翻领、白色饰线、胸当与樱花徽记）、红色领结、藏青百褶裙。
import {
  rgb, mixc, lerp, clamp, smoothstep, gauss, TAU, PI, add, sub, mul, madd, norm, cross, dot, len, dist,
  spline3, resample, transportFrames, Curve, fbm3, noise3, rng, gridSplit,
} from './core.js';
import { SKIN } from './face.js';
import {
  torsoSlice, torsoPoint, torsoNormal, torsoProject, torsoZ, TORSO_Y0, TORSO_Y1, NECK,
} from './torso.js';
import { ARM } from './body.js';

export const WHITE = rgb('#fbfbfd');
const WHITE_SH = rgb('#dfe1ee');
export const NAVY = rgb('#27325a');
const NAVY_HI = rgb('#323f6e');
const LINE = rgb('#ffffff');
const RED = rgb('#e2394b');
const RED_DK = rgb('#b02238');
const RED_HI = rgb('#f2616a');
const NECK_SKIN_C = rgb('#ffe2d6');

// ---------- 衣领与胸当的轮廓（x≥0 一半；y 为世界高度，f 为「前侧程度」） ----------
const V_POINT = [0, 1.13];
const OUTER = [
  [0.0, 1.13, 1],
  [0.044, 1.174, 1],
  [0.088, 1.222, 1],
  [0.118, 1.264, 1],
  [0.134, 1.298, 0.55],
  [0.128, 1.292, 0.0],
  [0.124, 1.245, 0],
  [0.123, 1.104, 0],
];
const OUTER_BACK = [
  [0.123, 1.104, 0],
  [0.0, 1.104, 0],
];
const INNER = [
  [0.0, 1.13, 1],
  [0.02, 1.185, 1],
  [0.036, 1.24, 1],
  [0.044, 1.29, 1],
  [0.045, 1.333, 0.75],
  [0.042, 1.345, 0.35],
  [0.026, 1.3465, 0],
];
const INNER_BACK = [
  [0.026, 1.3465, 0],
  [0.0, 1.347, 0],
];
const toXYZ = ([x, y, f]) => {
  const yy = clamp(y, TORSO_Y0, TORSO_Y1);
  return [x, y, lerp(torsoZ(x, yy, false), torsoZ(x, yy, true), f)];
};
// 胸当区域：衣领内缘 x 随 y 的函数
function innerX(y) {
  for (let i = 0; i < INNER.length - 1; i++) {
    const [x0, y0] = INNER[i], [x1, y1] = INNER[i + 1];
    if (y >= y0 && y <= y1) return lerp(x0, x1, (y - y0) / (y1 - y0));
  }
  return y < INNER[0][1] ? 0 : 0.06;
}

// ---------- 上衣主体 ----------
// 胸当上沿（其上露出锁骨附近的皮肤）
const DICKEY_Y = 1.3;
const DICKEY_TOP = () => DICKEY_Y;
const NECK_SKIN = NECK_SKIN_C;

export function buildBlouse(model) {
  const cloth = model.mesh('cloth');
  const skin = model.mesh('skin');
  const rows = [];
  const HEM = TORSO_Y0;
  for (let k = 0; k <= 4; k++) rows.push({ y: HEM + 0.03 * (1 - k / 4), off: -0.0028 });
  rows.push({ y: HEM - 0.0006, off: -0.0014 });
  rows.push({ y: HEM, off: 0 });
  const NM = 300;
  for (let k = 1; k <= NM; k++) {
    // 肩部截面变化快，让行距在上部更密
    const t = k / NM;
    const tt = 1 - Math.pow(1 - t, 1.35);
    rows.push({ y: lerp(HEM, TORSO_Y1, tt), off: 0 });
  }
  for (let k = 1; k <= 10; k++) rows.push({ lip: k / 10 });
  rows.push({ lip: 1, dy: -0.014 });
  const NU = rows.length - 1;
  // 胸当上沿以上、领口一圈归皮肤网格（分界是一条水平的行，平直无锯齿）；
  // 其中领子遮住的部分用顶点色涂成藏青，颜色边界由插值自然过渡
  const inSkin = (p) => p[1] > DICKEY_Y && Math.abs(p[0]) < 0.1;
  gridSplit(
    [cloth, skin],
    NU,
    640,
    (u, v) => {
      const r = rows[Math.round(u * NU)];
      const phi = v * TAU;
      let p;
      if (r.lip !== undefined) {
        const top = torsoPoint(TORSO_Y1, phi);
        const yN = TORSO_Y1;
        const tn = (yN - NECK.y0) / (NECK.y1 - NECK.y0);
        const nz = lerp(NECK.z0, NECK.z1, tn);
        const dx = top[0], dz = top[2] - nz;
        const ang = Math.atan2(dz / NECK.rz, dx / NECK.rx);
        const ring = [Math.cos(ang) * NECK.rx * 1.04, yN, nz + Math.sin(ang) * NECK.rz * 1.04];
        // 圆滑地拐进脖子：先略抬高再收进去
        const L = r.lip;
        const k = Math.sin((L * PI) / 2);
        p = [lerp(top[0], ring[0], k), yN + 0.007 * Math.sin(L * PI * 0.5) * (1 - L * 0.3) + (r.dy || 0), lerp(top[2], ring[2], k)];
      } else {
        p = torsoPoint(r.y, phi);
        if (r.off) {
          const n = torsoNormal(r.y, phi);
          p = madd(p, n, r.off);
        }
      }
      // 颜色：白色衣身；V 领内是藏青胸当，上沿一道白线
      let c = WHITE;
      const front = Math.sin(phi) > 0;
      if (front && p[1] > V_POINT[1] - 0.004 && Math.abs(p[0]) < innerX(p[1]) + 0.003) {
        c = NAVY;
        const d = DICKEY_TOP(p[0]) - p[1];
        c = mixc(c, LINE, smoothstep(0.0062, 0.0055, d) * smoothstep(0.0024, 0.0031, d));
      }
      if (r.lip !== undefined || (p[1] > 1.27 && Math.abs(p[0]) < 0.105)) {
        if (!(front && Math.abs(p[0]) < innerX(p[1]) + 0.003)) c = NAVY;
      }
      if (r.off < 0) c = WHITE_SH;
      let sc = mixc(NECK_SKIN, SKIN, smoothstep(DICKEY_Y, TORSO_Y1 + 0.004, p[1]));
      // 领口露出皮肤的部分：向两侧在 4mm 内渐变成藏青（被领子盖住），边缘平滑
      const open = !front ? 0 : r.lip !== undefined ? smoothstep(0.15, 0.35, Math.sin(phi)) : smoothstep(innerX(p[1]) + 0.007, innerX(p[1]) + 0.002, Math.abs(p[0]));
      sc = mixc(NAVY, sc, open);
      return { p, c: [c, sc] };
    },
    (mid) => (inSkin(mid) ? 1 : 0),
  );
  buildEmblem(model);
}

// 胸当上的白色樱花徽记
function buildEmblem(model) {
  const cloth = model.mesh('cloth');
  const cx = 0, cy = 1.232;
  const R = 0.0088;
  const petal = (ang) => {
    // 一片花瓣：极坐标下的心形，尖端有缺刻
    cloth.grid(
      24,
      24,
      (s, t) => {
        const a = lerp(-0.62, 0.62, t);
        const notch = 1 - 0.18 * gauss(a, 0.12);
        const r = R * s * notch * Math.pow(Math.cos(a * 0.8), 0.6);
        const x = cx + Math.cos(ang + a) * r * (1 - 0.15 * (1 - s));
        const y = cy + Math.sin(ang + a) * r;
        const z = torsoZ(x, y, true);
        return { p: torsoProject([x, y, z], 0.0009), c: LINE };
      },
      { wrap: false, flip: false },
    );
  };
  for (let k = 0; k < 5; k++) petal(PI / 2 + (k * TAU) / 5);
}

// ---------- 衣领 ----------
function polyline(ctl, n) {
  const pts = ctl.map(toXYZ);
  const f = pts.length > 2 ? spline3(pts) : (t) => [lerp(pts[0][0], pts[1][0], t), lerp(pts[0][1], pts[1][1], t), lerp(pts[0][2], pts[1][2], t)];
  const raw = [];
  for (let i = 0; i <= n * 4; i++) raw.push(f(i / (n * 4)));
  return resample(raw, n).pts;
}

export function buildCollar(model) {
  const cloth = model.mesh('cloth');
  // 左半边：外缘 = 前片+肩+后片侧边（样条） + 后片底边（直线）；内缘同理
  const nA = 340, nB = 120;
  const outerL = [...polyline(OUTER, nA), ...polyline(OUTER_BACK, nB).slice(1)];
  const innerL = [...polyline(INNER, nA), ...polyline(INNER_BACK, nB).slice(1)];
  // 拼成完整一圈：左半（V→后中）+ 右半（后中→V）
  const mirror = (p) => [-p[0], p[1], p[2]];
  const outer = [...outerL, ...outerL.slice(0, -1).reverse().map(mirror)];
  const inner = [...innerL, ...innerL.slice(0, -1).reverse().map(mirror)];
  const N = outer.length - 1;
  const TOP = 0.0052, BOT = 0.0012;
  // 外缘在曲面上的投影，用于计算饰线到边缘的距离
  const edge = outer.map((p) => torsoProject(p, TOP));
  const M = 76;
  const prof = [];
  prof.push({ w: 0, off: BOT });
  for (let k = 0; k <= M; k++) prof.push({ w: k / M, off: TOP });
  prof.push({ w: 1, off: BOT });
  const NV = prof.length - 1;
  cloth.grid(
    N,
    NV,
    (u, v) => {
      const i = Math.round(u * N);
      const pr = prof[Math.round(v * NV)];
      // 后片在背上略微浮起，越往下越离开身体
      const q = mix(inner[i], outer[i], pr.w);
      const lift = 0.004 * smoothstep(1.25, 1.12, q[1]) * (q[2] < 0 ? 1 : 0);
      const p = torsoProject(q, pr.off + lift);
      // 饰线：距外缘 9~12.5mm 与 17~20.5mm 的两条白线
      let c = NAVY;
      let dmin = 1;
      const i0 = Math.max(0, i - 160), i1 = Math.min(N, i + 160);
      for (let k = i0; k <= i1; k++) {
        const e = edge[k];
        const d = (p[0] - e[0]) ** 2 + (p[1] - e[1]) ** 2 + (p[2] - e[2]) ** 2;
        if (d < dmin) dmin = d;
      }
      const d = Math.sqrt(dmin);
      const band = (a, b) => smoothstep(a - 0.0006, a + 0.0002, d) * smoothstep(b + 0.0006, b - 0.0002, d);
      c = mixc(c, LINE, Math.max(band(0.0085, 0.012), band(0.0165, 0.02)));
      if (pr.off < TOP) c = mixc(NAVY, NAVY_HI, 0.3);
      return { p, c };
    },
    { wrap: false, flip: true },
  );
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------- 领结 ----------
export function buildBow(model) {
  const mesh = model.mesh('ribbon');
  const base = torsoProject([0, 1.142, torsoZ(0, 1.142, true)], 0);
  const nrm = torsoNormal(1.142, PI / 2);
  const C = madd(base, nrm, 0.011);
  const right = [1, 0, 0];
  const up = norm(cross(nrm, right)); // 胸前法线 × x = 向上（略后仰）
  const L = (x, y, z) => [C[0] + right[0] * x + up[0] * y + nrm[0] * z, C[1] + right[1] * x + up[1] * y + nrm[1] * z, C[2] + right[2] * x + up[2] * y + nrm[2] * z];
  const shade = (k, a) => mixc(mixc(RED, RED_DK, k), RED_HI, a);

  // 两条飘带：自结下垂，末端剪成燕尾
  for (const side of [1, -1]) {
    const m = mesh.mark();
    const pts = [];
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      const x = 0.004 + 0.022 * t + 0.006 * Math.sin(t * 2.2);
      const y = -0.004 - 0.078 * t;
      let p = L(x, y, -0.004 - 0.003 * t);
      // 贴着胸口外侧，不穿进衣服
      const s = torsoProject(p, 0.0055 + 0.002 * (1 - t));
      if (dot(sub(p, s), nrm) < 0) p = s;
      pts.push(p);
    }
    const fr = transportFrames(pts, right);
    mesh.tube(
      pts,
      48,
      (t, a) => {
        const c = Math.cos(a), s = Math.sin(a);
        const w = lerp(0.0115, 0.0145, t);
        const th = 0.0011 * (1 - smoothstep(0.985, 1, t)) + 0.00005;
        const bx = w * Math.sign(c) * Math.pow(Math.abs(c), 0.25);
        const by = th * Math.sign(s) * Math.pow(Math.abs(s), 0.25);
        // 燕尾：末端中间向上缩
        const notch = -0.012 * (1 - Math.min(1, Math.abs(bx) / w)) * smoothstep(0.82, 1, t);
        // 飘带中线一道浅浅的折痕
        const crease = 0.0012 * gauss(bx / w, 0.25) * Math.sin(PI * t);
        return { o: [bx, by + crease, notch], c: shade(0.15 * Math.abs(bx / w) + 0.1 * t, 0.1 * (1 - Math.abs(bx / w))) };
      },
      { frames: fr },
    );
    if (side < 0) mesh.transformFrom(m, (p) => [2 * C[0] - p[0], p[1], p[2]]);
    if (side < 0) {
      // 镜像后绕向需要翻转
      const I = mesh.I.a;
      for (let k = m.i; k < mesh.I.n; k += 3) {
        const tmp = I[k + 1];
        I[k + 1] = I[k + 2];
        I[k + 2] = tmp;
      }
    }
  }
  // 两个蝴蝶结圈：扁平的中空管，向外逐渐变高
  for (const side of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 90; i++) {
      const t = i / 90;
      pts.push(L(side * (0.003 + 0.05 * t), 0.004 + 0.007 * t - 0.006 * t * t, 0.001 + 0.002 * Math.sin(PI * t)));
    }
    const fr = transportFrames(pts, up);
    mesh.tube(
      pts,
      96,
      (t, a) => {
        const c = Math.cos(a), s = Math.sin(a);
        let h = lerp(0.0085, 0.0165, smoothstep(0, 0.85, t));
        let d = lerp(0.0035, 0.0075, Math.sin(PI * Math.min(1, t * 1.1)));
        // 外端圆滑收口（折回处）
        const e = smoothstep(0.82, 1, t);
        const cap = Math.sqrt(Math.max(0, 1 - e * e));
        d *= 0.35 + 0.65 * cap;
        h *= 0.55 + 0.45 * Math.sqrt(cap);
        // 标架 B = N×T：右圈 B 朝后、左圈 B 朝前，fr 表示「朝外（朝观者）」的程度
        const fr = -side * s;
        // 正面中部一道横向褶
        const dent = 0.0022 * gauss(c, 0.22) * smoothstep(0.1, 0.4, t) * (1 - e) * Math.max(0, fr);
        const hy = h * Math.sign(c) * Math.pow(Math.abs(c), 0.7);
        const dz = d * s - Math.sign(s) * dent;
        const k = 0.25 * smoothstep(0.3, -0.9, fr) + 0.15 * Math.abs(c);
        return { o: [hy, dz], c: shade(k, 0.12 * Math.max(0, fr) * (1 - Math.abs(c))) };
      },
      { frames: fr, pole1: true, pole0: true },
    );
  }
  // 中间的结
  mesh.grid(
    40,
    80,
    (u, v) => {
      const th = u * PI, ph = v * TAU;
      const sx = 0.0072, sy = 0.0098, sz = 0.0062;
      const x = Math.sin(th) * Math.cos(ph), z = Math.sin(th) * Math.sin(ph), y = Math.cos(th);
      const pinch = 1 - 0.12 * gauss(y, 0.3);
      const col = shade(0.25 * (1 - Math.max(0, z)) + 0.2 * Math.abs(y), 0.12 * Math.max(0, z));
      return { p: L(x * sx * pinch, y * sy, 0.0035 + z * sz), c: col };
    },
    { pole0: true, pole1: true, flip: true },
  );
}

// ---------- 袖子 ----------
export function buildSleeves(model) {
  const cloth = model.mesh('cloth');
  const m = cloth.mark();
  const midU = mix(ARM.upper, ARM.elbow, 0.5);
  const midF = mix(ARM.elbow, ARM.wrist, 0.5);
  const cuffEnd = madd(ARM.wrist, norm(sub(ARM.wrist, ARM.elbow)), 0.004);
  const path = spline3([ARM.shoulder, ARM.upper, add(midU, [0.006, 0, 0]), ARM.elbow, add(midF, [0.004, 0, 0.006]), cuffEnd]);
  const n = 240;
  const raw = [];
  for (let i = 0; i <= n * 3; i++) raw.push(path(i / (n * 3)));
  const { pts, length } = resample(raw, n);
  const fr = transportFrames(pts, [0, 0, 1]);
  const R = new Curve([
    [0, [0.038]],
    [0.06, [0.0435]],
    [0.25, [0.0428]],
    [0.5, [0.0395]],
    [0.62, [0.038]],
    [0.85, [0.0355]],
    [0.92, [0.0352]],
    [1, [0.0372]],
  ]);
  const cuffLen = 0.062;
  // 行：主体 0..n，然后袖口内翻（台阶 + 内壁）
  const rows = [];
  for (let i = 0; i <= n; i++) rows.push({ i, dr: 0, back: 0 });
  rows.push({ i: n, dr: -0.0012, back: -0.0005 });
  rows.push({ i: n, dr: -0.0028, back: 0 });
  rows.push({ i: n, dr: -0.003, back: 0.02 });
  const NU = rows.length - 1;
  const elbowT = dist(ARM.shoulder, ARM.elbow) / length;
  cloth.grid(
    NU,
    200,
    (u, v) => {
      const row = rows[Math.round(u * NU)];
      const i = row.i;
      const t = i / n;
      const a = v * TAU;
      const c = Math.cos(a), s = Math.sin(a);
      let r = R.f(t) + row.dr;
      const P = pts[i];
      // 皱褶：肘部内侧的横向褶、上臂的轻微纵向褶、整体噪声
      const fold =
        0.0035 * gauss(t - elbowT, 0.06) * Math.max(0, -s) * Math.sin(t * 160 + c * 2) +
        0.0012 * fbm3(P[0] * 30 + c, P[1] * 30, P[2] * 30 + s, 2) +
        0.0008 * Math.sin(a * 7 + t * 9) * smoothstep(0.1, 0.4, t) * smoothstep(0.9, 0.7, t);
      if (!row.dr) r += fold;
      // 截面略扁（前后方向窄一点）
      const on = r * c, ob = r * s * 0.93;
      const T = fr.T[i];
      const p = [
        P[0] + fr.N[i][0] * on + fr.B[i][0] * ob - T[0] * row.back,
        P[1] + fr.N[i][1] * on + fr.B[i][1] * ob - T[1] * row.back,
        P[2] + fr.N[i][2] * on + fr.B[i][2] * ob - T[2] * row.back,
      ];
      // 袖口：藏青，近上缘两条白线
      const fromEnd = (1 - t) * length + row.back;
      let col = WHITE;
      if (fromEnd < cuffLen) {
        col = NAVY;
        const d = cuffLen - fromEnd;
        const band = (a0, b0) => smoothstep(a0 - 0.0005, a0 + 0.0002, d) * smoothstep(b0 + 0.0005, b0 - 0.0002, d);
        col = mixc(col, LINE, Math.max(band(0.007, 0.0105), band(0.015, 0.0185)));
      }
      if (row.dr) col = mixc(NAVY, rgb('#0e1424'), 0.5);
      return { p, c: col };
    },
    { pole0: true },
  );
  cloth.mirrorFrom(m);
}

// ---------- 百褶裙 ----------
const SKIRT = new Curve([
  [0.995, [0.114, 0.072, -0.064]],
  [0.95, [0.123, 0.075, -0.067]],
  [0.9, [0.135, 0.083, -0.076]],
  [0.85, [0.148, 0.094, -0.087]],
  [0.8, [0.161, 0.11, -0.103]],
  [0.74, [0.172, 0.127, -0.12]],
  [0.66, [0.183, 0.143, -0.137]],
  [0.58, [0.192, 0.156, -0.151]],
  [0.5, [0.199, 0.167, -0.162]],
  [0.43, [0.205, 0.176, -0.172]],
]);
export const SKIRT_TOP = 0.995, SKIRT_HEM = 0.438;

export function buildSkirt(model) {
  const cloth = model.mesh('cloth');
  const PLEATS = 28;
  const COLS = PLEATS * 20;
  const rnd = rng(7);
  const pleatJit = Array.from({ length: PLEATS }, () => rnd() * 2 - 1);
  // 截面半径：超椭圆底形 + 刀褶锯齿
  const point = (y, theta, inset) => {
    const [W, zF, zB] = SKIRT.at(y);
    const z0 = (zF + zB) / 2;
    const c = Math.cos(theta), s = Math.sin(theta);
    const D = s > 0 ? zF - z0 : z0 - zB;
    const n = 2.15;
    let x = W * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    let z = z0 + D * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    // 褶：相位 f∈[0,1)，缓升后在折边处陡降
    const k = (theta / TAU) * PLEATS;
    const idx = Math.floor(k) % PLEATS;
    const f = k - Math.floor(k);
    const open = smoothstep(0.86, 0.7, y);
    const depth = (0.0024 + 0.0132 * open) * (1 + 0.15 * pleatJit[idx]);
    const rise = f < 0.9 ? Math.pow(f / 0.9, 1.15) : 1 - smoother01((f - 0.9) / 0.1);
    let d = depth * (rise - 0.5);
    // 褶面本身微微鼓起
    d += 0.0012 * open * Math.sin(PI * Math.min(1, f / 0.9));
    const gx = x / (W * W), gz = (z - z0) / (D * D);
    const l = Math.hypot(gx, gz) || 1;
    const sw = 0.0025 * fbm3(c * 2, y * 4, s * 2, 2) * open;
    x += (gx / l) * (d + sw - inset);
    z += (gz / l) * (d + sw - inset);
    return [x, y, z, rise];
  };
  const NO = 130;
  const rows = [];
  // 内层（自上而下）→ 裙摆 → 外层（自下而上）
  for (let k = 0; k <= NO; k++) rows.push({ y: lerp(SKIRT_TOP, SKIRT_HEM + 0.002, k / NO), inset: 0.0022 });
  rows.push({ y: SKIRT_HEM, inset: 0.0016, hem: 1 });
  rows.push({ y: SKIRT_HEM - 0.0006, inset: 0.0008, hem: 1 });
  rows.push({ y: SKIRT_HEM, inset: 0.0, hem: 1 });
  for (let k = 1; k <= NO; k++) rows.push({ y: lerp(SKIRT_HEM, SKIRT_TOP, k / NO), inset: 0 });
  const NU = rows.length - 1;
  cloth.grid(
    NU,
    COLS,
    (u, v) => {
      const r = rows[Math.round(u * NU)];
      const theta = v * TAU;
      // 裙摆高度随褶起伏（折边处略低），并有一点不规则
      let y = r.y;
      if (y < SKIRT_HEM + 0.06) {
        const k = (theta / TAU) * PLEATS;
        const f = k - Math.floor(k);
        const w = smoothstep(SKIRT_HEM + 0.06, SKIRT_HEM, y);
        y -= w * (0.004 * Math.pow(f, 2) + 0.003 * noise3(Math.cos(theta) * 3, 0, Math.sin(theta) * 3));
      }
      const [x, yy, z, rise] = point(y, theta, r.inset);
      let c = NAVY;
      // 折边处稍亮（布料被压出的光泽），内层更暗
      c = mixc(c, NAVY_HI, 0.5 * smoothstep(0.75, 0.9, rise));
      if (r.inset > 0.002) c = mixc(NAVY, rgb('#0d1222'), 0.6);
      return { p: [x, yy, z], c };
    },
    {},
  );
}
function smoother01(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}
