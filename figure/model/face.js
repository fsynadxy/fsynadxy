// 头部网格与五官：眼睛（巩膜、虹膜、瞳孔、高光都在一张高密度网格的顶点色里）、
// 眼线与睫毛、双眼皮褶、眉毛、嘴、腮红。五官都以「贴花」方式投影到脸部曲面上。
import { rgb, mixc, lerp, clamp, smoothstep, gauss, TAU, PI, noise3, RES } from './core.js';
import { headPoint, faceProject, headToWorld, hairMask, HEAD } from './head.js';

export const SKIN = rgb('#fdece5');
const SKIN_SHADE = rgb('#f6c9bd');
const BLUSH = rgb('#ff9e9e');
const LIP = rgb('#f29a95');
export const HAIR_DARK = rgb('#1c1c22');

// 眼睛轮廓（局部坐标，+x 一侧；另一侧取镜像）
const EYE = {
  I: [0.0152, -0.0266], // 内眼角
  O: [0.0536, -0.0198], // 外眼角
  up: 0.0184,
  low: 0.0089,
  iris: [0.0357, -0.0192, 0.0113, 0.0146], // 中心 x, y, 半径 rx, ry
};
const ex = (s) => lerp(EYE.I[0], EYE.O[0], s);
const chord = (s) => lerp(EYE.I[1], EYE.O[1], s);
const yUp = (s) => chord(s) + EYE.up * Math.pow(Math.sin(PI * Math.pow(clamp(s, 0, 1), 0.88)), 0.72);
const yLow = (s) => chord(s) - EYE.low * Math.pow(Math.sin(PI * Math.pow(clamp(s, 0, 1), 1.12)), 1.05);

// 皮肤顶点色
function skinColor(p) {
  const [x, y, z] = p;
  const ax = Math.abs(x);
  let c = SKIN;
  if (z > 0.02) {
    // 腮红
    const b = gauss(ax - 0.041, 0.0145) * gauss(y + 0.0405, 0.0075);
    c = mixc(c, BLUSH, 0.45 * b);
    // 唇色
    c = mixc(c, LIP, 0.5 * gauss(x, 0.0062) * gauss(y + 0.0708, 0.0022));
    c = mixc(c, LIP, 0.25 * gauss(x, 0.007) * gauss(y + 0.0652, 0.0014));
    // 鼻尖一点点红
    c = mixc(c, BLUSH, 0.14 * gauss(x, 0.004) * gauss(y + 0.0425, 0.0035));
    // 眼尾淡淡的眼影
    c = mixc(c, rgb('#e9b2a6'), 0.35 * gauss(ax - 0.044, 0.01) * gauss(y + 0.0065 - 0.06 * (ax - 0.044), 0.0035));
  }
  // 下颌下方与耳后稍暗，增加体积感
  c = mixc(c, SKIN_SHADE, 0.35 * smoothstep(-0.07, -0.105, y) * smoothstep(0.03, -0.02, z));
  const h = hairMask(p);
  if (h > 0) c = mixc(c, HAIR_DARK, h);
  return c;
}

export function buildHead(model) {
  const skin = model.mesh('skin');
  // 头部主体：u 自下巴尖到头顶，φ 一周
  skin.grid(
    RES(300),
    RES(640),
    (u, v) => {
      const p = headPoint(u, v * TAU);
      return { p: headToWorld(p), c: skinColor(p) };
    },
    { pole0: true, pole1: true },
  );
  buildEyes(model);
  buildBrowsAndMouth(model);
}

// 面部贴花网格：map(s, t) -> {x, y, off, c}，s、t ∈ [0,1]
function decal(mesh, ns, nt, map, flip) {
  mesh.grid(
    RES(ns),
    RES(nt),
    (s, t) => {
      const d = map(s, t);
      return { p: headToWorld(faceProject(d.x, d.y, d.off)), c: d.c };
    },
    { wrap: false, flip },
  );
}

// 一条沿中心线的带子贴花（眼线、眉毛、嘴）。side=-1 时横向取镜像，保证 t 的含义左右一致
function strip(mesh, ns, nt, center, width, off, color, side = 1) {
  decal(
    mesh,
    ns,
    nt,
    (s, t) => {
      const [x, y] = center(s);
      const w = width(s);
      // 法向：中心线的数值切线旋转 90°
      const [x1, y1] = center(Math.min(1, s + 0.002)), [x0, y0] = center(Math.max(0, s - 0.002));
      let tx = x1 - x0, ty = y1 - y0;
      const l = Math.hypot(tx, ty) || 1;
      tx /= l; ty /= l;
      const nx = -ty * side, ny = tx * side;
      const k = (t - 0.5) * w;
      return { x: x + nx * k, y: y + ny * k, off: off(s, t), c: typeof color === 'function' ? color(s, t) : color };
    },
    side < 0,
  );
}

// ---------- 眼睛 ----------
const SCLERA = rgb('#fbf8f5');
const SCLERA_SH = rgb('#c4c3d4');
const IRIS = {
  rim: rgb('#140e0e'),
  top: rgb('#1d1515'),
  mid: rgb('#3a2b28'),
  low: rgb('#6e5a52'),
  glow: rgb('#a8928a'),
  pupil: rgb('#0c0808'),
};
const WHITE = rgb('#ffffff');

function eyeColor(x, y, s, t, side) {
  const [cx, cy, rx, ry] = EYE.iris;
  const ax = x * side;
  const dx = (ax - cx) / rx, dy = (y - cy) / ry;
  const d = Math.hypot(dx, dy);
  // 巩膜：上眼睑投下的阴影 + 眼角微暗
  let c = mixc(SCLERA, SCLERA_SH, 0.55 * smoothstep(0.62, 1.0, t) + 0.25 * (smoothstep(0.2, 0, s) + smoothstep(0.85, 1, s)));
  if (d < 1.06) {
    // 虹膜：上暗下亮的竖向渐变，外圈加深，放射状纹理
    const v = clamp(0.5 - dy * 0.5, 0, 1); // 0=上 1=下
    let ic = v < 0.45 ? mixc(IRIS.top, IRIS.mid, v / 0.45) : mixc(IRIS.mid, IRIS.low, (v - 0.45) / 0.55);
    ic = mixc(ic, IRIS.glow, 0.55 * smoothstep(0.55, 0.95, v) * smoothstep(0.92, 0.55, d));
    const ang = Math.atan2(dy, dx);
    const fib = noise3(Math.cos(ang) * 6, Math.sin(ang) * 6, d * 3) * 0.5 + 0.5;
    ic = mixc(ic, IRIS.top, 0.25 * fib * smoothstep(0.35, 0.8, d));
    ic = mixc(ic, IRIS.rim, smoothstep(0.78, 0.98, d));
    // 瞳孔（竖椭圆）
    const pd = Math.hypot(dx / 0.44, dy / 0.52);
    ic = mixc(ic, IRIS.pupil, smoothstep(1.0, 0.82, pd));
    // 上眼睑在虹膜上的阴影
    ic = mixc(ic, IRIS.rim, 0.55 * smoothstep(0.62, 0.98, t));
    c = mixc(c, ic, smoothstep(1.06, 0.98, d));
  }
  // 高光：左上一个大的、右下一个小的（两只眼睛同一侧，光源一致）
  const h1 = Math.hypot((x - side * cx + 0.0039) / 0.0031, (y - cy - 0.0052) / 0.0036);
  const h2 = Math.hypot((x - side * cx - 0.0042) / 0.0015, (y - cy + 0.0064) / 0.0013);
  c = mixc(c, WHITE, smoothstep(1.0, 0.75, h1) * smoothstep(0.98, 0.8, t));
  c = mixc(c, WHITE, 0.9 * smoothstep(1.0, 0.7, h2));
  // 虹膜下缘一弯反光
  const arc = Math.abs(Math.hypot(dx / 0.82, (dy + 0.1) / 0.82) - 1);
  c = mixc(c, IRIS.glow, 0.35 * smoothstep(0.08, 0.0, arc) * smoothstep(0.1, -0.5, dy) * (d < 1 ? 1 : 0));
  return c;
}

const LINER = rgb('#1d1311');
const LINER_IN = rgb('#4a2622');
const LASH_LOW = rgb('#6d463b');
const CREASE = rgb('#d39a8a');

function buildEyes(model) {
  const eye = model.mesh('eye');
  const lash = model.mesh('lash');
  const skin = model.mesh('skin');
  for (const side of [1, -1]) {
    const flip = side < 0;
    // 眼球表面（巩膜 + 虹膜 + 瞳孔 + 高光）
    decal(
      eye,
      120,
      84,
      (s, t) => {
        const x = side * ex(s);
        const y = lerp(yLow(s), yUp(s), t);
        // 眼睛中部稍稍凹进去一点，边缘贴着皮肤
        return { x, y, off: 0.0002, c: eyeColor(x, y, s, t, side) };
      },
      flip,
    );
    // 上眼线：内细外粗，眼尾微微上挑
    const linerC = (s) => {
      if (s <= 1) return [side * ex(s), yUp(s) - 0.00035];
      const k = s - 1;
      const dx = ex(1) - ex(0.97), dy = yUp(1) - yUp(0.97);
      const l = Math.hypot(dx, dy);
      return [side * (ex(1) + (dx / l) * k * 0.05), yUp(1) - 0.00035 + (dy / l) * k * 0.05 + k * k * 0.25];
    };
    const S0 = -0.03, S1 = 1.11;
    const linerW = (s) => {
      const a = smoothstep(S0, 0.35, s), b = 1 - smoothstep(1.0, S1, s);
      return (0.0009 + 0.0029 * a) * Math.pow(b, 0.6) + 0.00005;
    };
    strip(
      lash,
      150,
      8,
      (q) => {
        const s = lerp(S0, S1, q);
        const [x, y] = linerC(s);
        return [x, y + linerW(s) * 0.4];
      },
      (q) => linerW(lerp(S0, S1, q)),
      (q, t) => 0.0005 + 0.0011 * t,
      (q) => mixc(LINER_IN, LINER, smoothstep(0, 0.3, q)),
      side,
    );
    // 眼尾几根睫毛
    const spikes = [[0.8, 0.9, 0.0042], [0.9, 0.55, 0.0052], [1.0, 0.25, 0.0048], [1.06, 0.0, 0.0036]];
    for (const [s0, ang, L] of spikes) {
      const [bx, by] = linerC(s0);
      const dirx = Math.cos(ang) * side, diry = Math.sin(ang);
      strip(
        lash,
        12,
        4,
        (q) => [bx + dirx * L * q, by + linerW(s0) * 0.5 + diry * L * q + 0.0015 * q * q],
        (q) => 0.0011 * (1 - q) + 0.00005,
        (q) => 0.0012 + 0.0016 * q,
        LINER,
        side,
      );
    }
    // 下睫毛线（外侧 2/3）
    strip(
      lash,
      90,
      4,
      (q) => {
        const s = lerp(0.32, 1.0, q);
        return [side * ex(s), yLow(s) - 0.00035];
      },
      (q) => 0.00025 + 0.0005 * smoothstep(0, 0.7, q) * (1 - smoothstep(0.85, 1, q)),
      () => 0.0004,
      LASH_LOW,
      side,
    );
    // 双眼皮褶
    strip(
      skin,
      80,
      3,
      (q) => {
        const s = lerp(0.22, 1.02, q);
        return [side * ex(s), yUp(Math.min(1, s)) + 0.0043 + 0.0012 * q];
      },
      (q) => 0.00045 * Math.sin(PI * q),
      () => 0.00015,
      CREASE,
      side,
    );
  }
}

const BROW = rgb('#2d1f1b');
const BLUSH_LINE = rgb('#ef8a8c');
const MOUTH = rgb('#7d3431');
const MOUTH_IN = rgb('#c46a62');

function buildBrowsAndMouth(model) {
  const lash = model.mesh('lash');
  const skin = model.mesh('skin');
  for (const side of [1, -1]) {
    strip(
      lash,
      80,
      5,
      (q) => [side * lerp(0.0175, 0.0555, q), lerp(0.0138, 0.0078, q) + 0.0032 * Math.sin(PI * Math.pow(q, 0.8))],
      (q) => 0.0017 * (1 - 0.45 * q) * (1 - smoothstep(0.8, 1, q)) + 0.0002,
      () => 0.0003,
      BROW,
      side,
    );
  }
  // 二次元式腮红斜线：每侧三道
  for (const side of [1, -1]) {
    for (let k = 0; k < 3; k++) {
      const cx = side * (0.0335 + k * 0.0052), cy = -0.0402 + 0.0006 * k;
      strip(
        skin,
        14,
        3,
        (q) => [cx + side * lerp(-0.0018, 0.0018, q), cy + lerp(-0.0032, 0.0032, q)],
        (q) => 0.0007 * Math.sin(PI * q) + 0.00005,
        () => 0.00018,
        BLUSH_LINE,
        side,
      );
    }
  }
  // 嘴：小小的微笑弧线，中间略深
  strip(
    skin,
    70,
    5,
    (q) => {
      const x = lerp(-0.0082, 0.0082, q);
      const k = x / 0.0082;
      return [x, -0.0678 + 0.0017 * k * k * k * k - 0.00025 * (1 - k * k)];
    },
    (q) => 0.0003 + 0.0009 * Math.pow(Math.sin(PI * q), 0.7),
    () => 0.00022,
    (q, t) => mixc(MOUTH, MOUTH_IN, 0.4 * smoothstep(0.5, 0, t)),
    1,
  );
}

export { EYE };
