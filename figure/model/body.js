// 身体的皮肤部分与鞋袜：脖子、双手、穿黑色裤袜的双腿、乐福鞋。
import {
  rgb, mixc, lerp, clamp, smoothstep, gauss, TAU, PI, add, sub, mul, madd, norm, cross, dot, len,
  spline3, resample, transportFrames, rotAxis, Curve, fbm3,
} from './core.js';
import { NECK } from './torso.js';
import { SKIN } from './face.js';

// ---------- 骨架关键点（左侧 = +x，另一侧镜像） ----------
export const ARM = {
  shoulder: [0.143, 1.268, -0.012],
  upper: [0.161, 1.24, -0.012],
  elbow: [0.206, 1.008, -0.032],
  wrist: [0.229, 0.816, 0.004],
};
export const LEG = {
  hip: [0.08, 0.86, -0.006],
  knee: [0.087, 0.458, 0.012],
  ankle: [0.083, 0.088, -0.022],
  heel: [0.083, 0.0, -0.068],
};

const SKIN_PALM = rgb('#ffdcd0');
const NAIL = rgb('#ffd0cb');
const NAIL_TIP = rgb('#fff0ec');
const KNUCKLE = rgb('#f9cfc3');
const SKIN_SHADOW = rgb('#f3c3b8');

// ---------- 脖子 ----------
export function buildNeck(model) {
  const skin = model.mesh('skin');
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    pts.push([NECK.x, lerp(NECK.y0, NECK.y1, t), lerp(NECK.z0, NECK.z1, t)]);
  }
  skin.tube(
    pts,
    160,
    (t, a) => {
      // 下粗上细，胸锁乳突肌在前侧略微隆起
      const sc = 1 + 0.1 * smoothstep(0.35, 0, t);
      const c = Math.cos(a), s = Math.sin(a);
      const ridge = 0.0025 * gauss(Math.abs(c) - 0.7, 0.25) * (s > 0 ? 1 : 0.3);
      // 标架：N 约为 +x 方向，B = N × T 约为 +z（朝前）
      // 下巴投在脖子上的阴影：二次元里一条干净的弧线
      const y = lerp(NECK.y0, NECK.y1, t);
      const edge = 1.352 + 0.022 * (1 - Math.max(0, s)) + 0.004 * c * c;
      const shade = y > edge || s < -0.2 ? SKIN_SHADOW : SKIN;
      return { o: [(NECK.rx * sc + ridge) * c, (NECK.rz * sc + ridge * 0.5) * s], c: shade };
    },
    { up: [1, 0, 0], pole0: true, pole1: true, color: SKIN },
  );
}

// ---------- 手 ----------
// 在手的局部标架里描述：L 沿手指方向，A 指向拇指一侧，N 指向掌心一侧
function handFrame() {
  const fore = norm(sub(ARM.wrist, ARM.elbow));
  // 手腕放松，手比前臂更竖直一些
  const d = norm(add(mul(fore, 0.55), [0.02, -0.45, 0.02]));
  // 掌心朝向身体并略向后
  let p = norm([-1, 0, -0.22]);
  p = norm(sub(p, mul(d, dot(p, d))));
  let a = cross(p, d);
  if (a[2] < 0) a = mul(a, -1);
  return { o: ARM.wrist, d, a, p };
}
function hp(F, L, A, N) {
  return [
    F.o[0] + F.d[0] * L + F.a[0] * A + F.p[0] * N,
    F.o[1] + F.d[1] * L + F.a[1] * A + F.p[1] * N,
    F.o[2] + F.d[2] * L + F.a[2] * A + F.p[2] * N,
  ];
}

// 一根手指：从根部沿给定方向，按关节弯曲；返回中心线
function fingerPath(F, base, dir0, bendAxis, segs, bends) {
  const pts = [base];
  let dir = dir0, p = base;
  for (let k = 0; k < segs.length; k++) {
    dir = norm(rotAxis(dir, bendAxis, bends[k]));
    p = madd(p, dir, segs[k]);
    pts.push(p);
  }
  return pts;
}

function buildHand(model) {
  const skin = model.mesh('skin');
  const F = handFrame();
  // 手腕到掌根：一段椭圆管，伸进袖口里，末端与手掌截面吻合
  const wristPts = [];
  for (let i = 0; i <= 24; i++) wristPts.push(hp(F, lerp(-0.05, -0.004, i / 24), 0, 0.0));
  skin.tube(
    wristPts,
    72,
    (t, a) => {
      const w = lerp(0.0205, 0.0226, smoothstep(0.4, 1, t)), th = lerp(0.0166, 0.0156, t);
      const n = lerp(2, 3, smoothstep(0.5, 1, t));
      const c = Math.cos(a), s = Math.sin(a);
      return [Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * th, Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * w];
    },
    { up: F.p, pole0: true, pole1: true, color: SKIN },
  );
  // 手掌：从掌根到指根的放样，截面是圆角矩形，掌心微凹，指根处圆润收口
  const palmL0 = -0.014, palmL1 = 0.094;
  skin.grid(
    100,
    120,
    (u, v) => {
      const L = lerp(palmL0, palmL1, u);
      const ang = v * TAU;
      const c = Math.cos(ang), s = Math.sin(ang);
      const cap = Math.sqrt(Math.max(0, 1 - Math.pow(smoothstep(0.78, 1, u), 2)));
      const W = lerp(0.0232, 0.0355, smoothstep(0.08, 0.68, u)) * (0.35 + 0.65 * cap);
      const T = lerp(0.0164, 0.0108, smoothstep(0.05, 0.72, u)) * (0.3 + 0.7 * cap);
      const n = lerp(2.6, 3.0, smoothstep(0, 0.3, u));
      let A = W * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      let N = T * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      // 掌心（N>0 一侧）微凹，拇指根部（A>0、靠近掌根）鼓起
      if (N > 0) N -= 0.0028 * Math.pow(Math.max(0, 1 - Math.abs(A) / W), 2) * Math.sin(PI * u);
      N += 0.0055 * gauss(A - 0.02, 0.011) * gauss(u - 0.22, 0.22) * (N > 0 ? 1 : 0.15);
      // 小鱼际
      N += 0.0018 * gauss(A + 0.023, 0.01) * gauss(u - 0.4, 0.3) * (N > 0 ? 1 : 0);
      // 手背的掌骨起伏与指根关节
      if (N < 0) N -= 0.0007 * Math.cos(A * 260) * smoothstep(0.3, 0.9, u) + 0.0012 * gauss(u - 0.86, 0.05) * Math.pow(Math.cos(A * 175), 2);
      const cc = N > 0 ? mixc(SKIN, SKIN_PALM, 0.6) : SKIN;
      return { p: hp(F, L, A, N), c: cc };
    },
    { pole0: true, pole1: true, flip: true },
  );
  // 四指：食指、中指、无名指、小指（自然放松地微微弯曲）
  const fingers = [
    { A: 0.0235, len: [0.039, 0.023, 0.018], r: 0.0086, bend: [0.32, 0.5, 0.28], spread: 0.05 },
    { A: 0.008, len: [0.043, 0.026, 0.019], r: 0.0089, bend: [0.38, 0.58, 0.3], spread: 0.0 },
    { A: -0.008, len: [0.04, 0.024, 0.018], r: 0.0084, bend: [0.44, 0.62, 0.32], spread: -0.04 },
    { A: -0.0225, len: [0.031, 0.019, 0.016], r: 0.0074, bend: [0.5, 0.66, 0.34], spread: -0.1 },
  ];
  for (const f of fingers) {
    const base = hp(F, palmL1 - 0.016, f.A, -0.001);
    const dir0 = norm(add(F.d, mul(F.a, f.spread)));
    const axis = norm(cross(dir0, F.p));
    const pts = fingerPath(F, base, dir0, axis, [0.006, ...f.len], [0, ...f.bend]);
    fingerTube(skin, F, spline3(pts), f.r, f.len.reduce((a, b) => a + b, 0) + 0.006);
  }
  // 拇指：贴着食指一侧，略朝前、向掌心收
  {
    const base = hp(F, 0.014, 0.017, 0.006);
    const dir0 = norm(add(add(F.d, mul(F.a, 0.42)), mul(F.p, 0.38)));
    const axis = norm(cross(dir0, F.p));
    const pts = fingerPath(F, base, dir0, axis, [0.032, 0.028, 0.023], [0.0, 0.18, 0.22]);
    fingerTube(skin, F, spline3(pts), 0.0102, 0.083, true);
  }
}

function fingerTube(skin, F, path, r0, length, thumb = false) {
  const n = 70;
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(path(i / n));
  const fr = transportFrames(pts, mul(F.p, -1));
  skin.tube(
    pts,
    40,
    (t, a, i) => {
      // 半径：根部粗、指尖收圆；关节处略鼓
      let r = lerp(r0, r0 * 0.78, t);
      const tipT = 1 - t;
      const tip = Math.sqrt(clamp(tipT / 0.12, 0, 1) * (2 - clamp(tipT / 0.12, 0, 1)));
      r *= tip;
      if (thumb) r *= 1 + 0.25 * gauss(t - 0.15, 0.2);
      r *= 1 + 0.05 * gauss(t - 0.45, 0.05) + 0.04 * gauss(t - 0.75, 0.05);
      const c = Math.cos(a), s = Math.sin(a);
      // N 分量（标架 N = 手背方向）略扁
      const o = [c * r * 0.88, s * r];
      // 指甲：手背一侧、靠近指尖
      let col = SKIN;
      const nailZone = smoothstep(0.62, 0.72, t) * smoothstep(0.995, 0.93, t) * smoothstep(0.35, 0.75, c);
      if (nailZone > 0) col = mixc(SKIN, mixc(NAIL, NAIL_TIP, smoothstep(0.86, 0.96, t)), nailZone);
      if (c < -0.3) col = mixc(col, SKIN_PALM, 0.5);
      col = mixc(col, KNUCKLE, 0.35 * gauss(t - 0.45, 0.04) * Math.max(0, c));
      return { o, c: col };
    },
    { frames: fr, pole1: true, pole0: true, color: SKIN },
  );
}

export function buildHands(model) {
  const skin = model.mesh('skin');
  const m = skin.mark();
  buildHand(model);
  skin.mirrorFrom(m);
}

// ---------- 腿（黑色裤袜） ----------
const TIGHTS = rgb('#2c2b36');
const TIGHTS_KNEE = rgb('#4a3d42');

export function buildLegs(model) {
  const mesh = model.mesh('tights');
  const m = mesh.mark();
  const path = spline3([LEG.hip, [0.086, 0.67, -0.0], LEG.knee, [0.086, 0.27, -0.004], LEG.ankle, [0.083, 0.045, -0.03]]);
  const pts = [];
  const n = 260;
  for (let i = 0; i <= n; i++) pts.push(path(i / n));
  // 半径关键帧：y -> [左右半径, 前后半径, 小腿后侧隆起, 膝盖前凸]
  const R = new Curve([
    [0.03, [0.03, 0.05, 0, 0]],
    [0.088, [0.026, 0.029, 0, 0]],
    [0.13, [0.029, 0.031, 0.002, 0]],
    [0.2, [0.036, 0.037, 0.006, 0]],
    [0.3, [0.045, 0.044, 0.011, 0]],
    [0.38, [0.045, 0.045, 0.006, 0]],
    [0.43, [0.044, 0.045, 0.0, 0.003]],
    [0.46, [0.045, 0.046, 0, 0.006]],
    [0.5, [0.048, 0.049, 0, 0.002]],
    [0.6, [0.054, 0.056, 0, 0]],
    [0.72, [0.06, 0.062, 0, 0]],
    [0.88, [0.062, 0.064, 0, 0]],
  ]);
  const fr = transportFrames(pts, [1, 0, 0]);
  mesh.tube(
    pts,
    150,
    (t, a, i) => {
      const y = pts[i][1];
      const [rx, rz, calf, knee] = R.at(y);
      // 标架 N≈+x（外侧），B = N×T ≈ -z（T 朝下），所以 f=-sin(a) 表示「朝前」的程度
      const c = Math.cos(a), f = -Math.sin(a);
      let ox = rx * c, oz = rz * f;
      if (f < 0) oz -= calf * Math.pow(-f, 1.5) * (1 + 0.25 * -c); // 小腿后侧，内侧更饱满
      if (f > 0) oz += knee * Math.pow(f, 4) * gauss(c, 0.5);
      // 踝骨
      const ank = gauss(y - 0.09, 0.012) * 0.0035;
      ox += ank * Math.sign(c) * Math.pow(Math.abs(c), 4);
      // 裤袜颜色：膝盖与小腿正面稍浅（丝袜绷紧处透出肤色）
      const col = mixc(TIGHTS, TIGHTS_KNEE, 0.5 * gauss(y - 0.455, 0.03) * Math.max(0, f) + 0.15 * Math.max(0, f) * smoothstep(0.1, 0.35, y));
      return { o: [ox, -oz], c: col };
    },
    { frames: fr, pole0: true, pole1: true },
  );
  mesh.mirrorFrom(m);
}

// ---------- 乐福鞋 ----------
const LEATHER = rgb('#6b3925');
const LEATHER_HI = rgb('#8a4f33');
const LEATHER_DK = rgb('#3a1f14');
const SOLE = rgb('#2a2222');

export function buildShoes(model) {
  const mesh = model.mesh('leather');
  const m = mesh.mark();
  const toeOut = 0.1; // 脚尖略微外八
  const fwd = [Math.sin(toeOut), 0, Math.cos(toeOut)];
  const side = [Math.cos(toeOut), 0, -Math.sin(toeOut)];
  const heel = [LEG.heel[0] - 0.002, 0, LEG.heel[2] - 0.004];
  const FL = 0.236; // 鞋长
  const P = (a, b, y) => [heel[0] + fwd[0] * a * FL + side[0] * b, y, heel[2] + fwd[2] * a * FL + side[2] * b];
  // 鞋面放样：a 从后跟到鞋尖；截面在 (b, y) 平面
  const W = new Curve([
    [0, [0.022, 0.0]],
    [0.04, [0.031, 0.0]],
    [0.2, [0.033, 0.0]],
    [0.45, [0.038, 0.001]],
    [0.68, [0.0435, 0.003]],
    [0.82, [0.041, 0.004]],
    [0.92, [0.032, 0.004]],
    [0.98, [0.017, 0.003]],
    [1, [0.0, 0.003]],
  ]);
  const H = new Curve([
    [0, [0.058]],
    [0.1, [0.066]],
    [0.3, [0.064]],
    [0.42, [0.066]],
    [0.55, [0.06]],
    [0.7, [0.05]],
    [0.85, [0.043]],
    [0.95, [0.034]],
    [1, [0.025]],
  ]);
  const soleTop = (a) => 0.012 + 0.016 * smoothstep(0.32, 0.26, a) + 0.006 * smoothstep(0.86, 1.0, a);
  mesh.grid(
    170,
    120,
    (u, v) => {
      const a = u;
      const [w, bOff] = W.at(a);
      const h = H.f(a);
      const ang = v * TAU;
      const c = Math.cos(ang), s = Math.sin(ang);
      const yb = soleTop(a);
      // 下半部方、上半部圆
      const n = s < 0 ? 4 : 2.3;
      const bx = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const yy = s < 0 ? yb - 0.002 * Math.pow(-s, 2 / n) : yb + (h - yb) * Math.pow(s, 2 / n);
      // 鞋头顶面略平
      const p = P(a, bx + bOff, yy);
      // 颜色：鞋口（裤袜色的脚背）、鞋面饰带、鞋头 U 形缝线
      let col = LEATHER;
      const top = s > 0.55;
      const opening = top && a > 0.06 && a < 0.47 && Math.abs(c) < 0.62 + 0.25 * smoothstep(0.47, 0.3, a);
      if (opening) col = mixc(TIGHTS, TIGHTS_KNEE, 0.2);
      // 鞋口边缘的皮革包边
      const lip = top && a > 0.04 && a < 0.5 && Math.abs(Math.abs(c) - (0.62 + 0.25 * smoothstep(0.47, 0.3, a))) < 0.06;
      if (lip) col = LEATHER_DK;
      // 饰带（横跨鞋面）及中间的切口
      if (s > 0.2 && a > 0.47 && a < 0.55) {
        col = mixc(LEATHER, LEATHER_HI, 0.5);
        if (a > 0.495 && a < 0.525 && Math.abs(c) < 0.25) col = LEATHER_DK;
      }
      // 鞋头 U 形缝线
      const ux = Math.abs(c), ua = a;
      const seam = Math.abs(Math.hypot((ua - 0.62) / 0.32, ux / 0.62) - 1) < 0.035 && ua > 0.6 && s > 0.3;
      if (seam) col = LEATHER_DK;
      // 侧面高光带（皮革反光）
      col = mixc(col, LEATHER_HI, 0.25 * gauss(s - 0.35, 0.2) * (opening ? 0 : 1));
      return { p, c: col };
    },
    { pole0: true, pole1: true, flip: true },
  );
  // 鞋底：比鞋面略宽的圆角薄板，后跟加厚
  mesh.grid(
    150,
    48,
    (u, v) => {
      const a = lerp(-0.01, 1.005, u);
      const [w0, bOff] = W.at(clamp(a, 0, 1));
      const w = Math.max(0.0, w0 + 0.003 * smoothstep(0, 0.05, a) * smoothstep(1.005, 0.97, a));
      const yt = soleTop(clamp(a, 0, 1)) - 0.0005;
      const yb = 0.006 * smoothstep(0.88, 1.0, a); // 鞋尖微翘
      const ang = v * TAU;
      const c = Math.cos(ang), s = Math.sin(ang);
      const n = 6;
      const bx = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const yy = lerp(yb, yt, 0.5 + 0.5 * Math.sign(s) * Math.pow(Math.abs(s), 2 / n));
      return { p: P(clamp(a, -0.01, 1.005), bx + bOff, yy), c: SOLE };
    },
    { pole0: true, pole1: true, flip: true },
  );
  mesh.mirrorFrom(m);
}
export { TIGHTS };
