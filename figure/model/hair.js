// 黑长直：发根撒在头皮上，按「重力 + 发流方向 + 碰撞」逐步生长出每一束头发，
// 再把中心线扫掠成扁平、两侧微卷、末端收尖的发束；另有一层细发丝增加质感。
import {
  rgb, mixc, lerp, clamp, smoothstep, gauss, TAU, PI, add, sub, mul, madd, norm, cross, dot, len, dist,
  resample, rng, noise3, rotAxis, DETAIL, RES,
} from './core.js';
import { headPoint, headToWorld, worldToHead, headDirToWorld, pushOutHead, hairMask, slice, HC, headRadius } from './head.js';
import { pushOutTorso, NECK } from './torso.js';
import { ARM } from './body.js';

// 二次元的「黑发」：深蓝灰，而不是纯黑，才看得出层次
const HAIR = rgb('#1d1d24');
const HAIR_B = rgb('#25252e');
const HAIR_TIP = rgb('#2a2629');
const HAIR_SHEEN = rgb('#43434f');
const HAIR_RING = rgb('#9a9aa8'); // 天使环

// ---------- 碰撞 ----------
function pushCapsule(p, a, b, r) {
  const ab = sub(b, a);
  const t = clamp(dot(sub(p, a), ab) / dot(ab, ab), 0, 1);
  const c = madd(a, ab, t);
  const d = sub(p, c);
  const l = len(d);
  if (l >= r || l < 1e-9) return false;
  const q = madd(c, d, r / l);
  p[0] = q[0]; p[1] = q[1]; p[2] = q[2];
  return true;
}
const NECK_A = [0, NECK.y0, NECK.z0], NECK_B = [0, NECK.y1, NECK.z1];
const ARM_L = [ARM.shoulder, ARM.elbow];
const ARM_R = [[-ARM.shoulder[0], ARM.shoulder[1], ARM.shoulder[2]], [-ARM.elbow[0], ARM.elbow[1], ARM.elbow[2]]];

// 耳朵与耳后发量的代理体（头部局部坐标）：让两侧头发从头部最宽处垂下，而不是顺着下颌往里收
const EAR = [
  [[0.066, 0.005, -0.012], [0.062, -0.075, -0.024], 0.021],
  [[-0.066, 0.005, -0.012], [-0.062, -0.075, -0.024], 0.021],
];
function collide(p, off) {
  // 头（在头部局部坐标里做径向推出）
  const q = worldToHead(p);
  let moved = pushOutHead(q, off);
  for (const [a, b, r] of EAR) moved = pushCapsule(q, a, b, r + off) || moved;
  if (moved) {
    const w = headToWorld(q);
    p[0] = w[0]; p[1] = w[1]; p[2] = w[2];
  }
  pushCapsule(p, NECK_A, NECK_B, 0.035 + off);
  pushCapsule(p, ARM_L[0], ARM_L[1], 0.04 + off);
  pushCapsule(p, ARM_R[0], ARM_R[1], 0.04 + off);
  pushOutTorso(p, 0.009 + off);
}

// ---------- 生长 ----------
// opt: root, dir（初始方向）, length, yStop, off（离体表的距离）, stiff, grav, bias(p, i) -> 附加方向
function grow(opt) {
  const ds = 0.0035;
  let p = opt.root.slice();
  let dir = norm(opt.dir);
  collide(p, opt.off0);
  const pts = [p.slice()];
  let L = 0;
  let contact = false;
  const maxL = opt.length;
  for (let i = 0; L < maxL && i < 700; i++) {
    const t = L / maxL;
    const g = opt.grav * smoothstep(0, opt.gravRamp || 0.12, L);
    let want = madd(mul(dir, opt.stiff), [0, -1, 0], g);
    // 离开头皮后，水平分量逐渐衰减：头发从头部最宽处自然垂直落下，而不是顺着下颌往里收
    // 贴着表面时不衰减，否则会卡在肩上滑不下去
    if (opt.hdamp && !contact) {
      const k = opt.hdamp * smoothstep(0.0, 0.05, L);
      want[0] *= 1 - k;
      want[2] *= 1 - k;
    }
    if (opt.bias) want = add(want, opt.bias(p, L, t));
    dir = norm(want);
    const np = madd(p, dir, ds);
    // 碰撞偏移：发根贴头皮，往下逐渐增加到发束层的厚度
    const off = opt.off0 + (opt.off - opt.off0) * smoothstep(0, 0.05, L);
    const before = np.slice();
    collide(np, off);
    const push = sub(np, before);
    const pl = len(push);
    contact = pl > 1e-9;
    if (pl > 1e-9) {
      // 贴着表面滑动：去掉方向里朝向表面内部的分量
      const nrm = mul(push, 1 / pl);
      const dn = dot(dir, nrm);
      if (dn < 0) dir = norm(madd(dir, nrm, -dn));
    }
    const sl = dist(np, p);
    if (sl < 1e-7) break;
    p = np;
    pts.push(p.slice());
    L += sl;
    if (opt.yStop !== undefined && p[1] < opt.yStop) break;
    // 卡在缝隙里打转的发丝：走了很远却没怎么往下，就此收尾
    if (L > 0.12 && opt.root[1] - p[1] < 0.45 * L - 0.03) break;
  }
  return { pts, length: L };
}

// ---------- 发束几何 ----------
// 发束「朝外」方向：头部附近取离头心的方向，躯干附近取离身体竖轴的方向
const HCW = headToWorld(HC);
function outward(p) {
  const wHead = smoothstep(1.3, 1.4, p[1]);
  const dh = norm(sub(p, HCW));
  const db = norm([p[0], 0, p[2] + 0.005]);
  return norm(add(mul(dh, wHead), mul(db, 1 - wHead)));
}

// 发束截面的宽度、厚度与颜色（细发丝要沿用同一套，所以单独成函数）
function lockW(L, t) {
  return L.w0 * (0.55 + 0.45 * smoothstep(0, 0.08, t)) * Math.pow(1 - Math.pow(smoothstep(L.tipStart, 1, t), 1.3), 0.75) + 0.00008;
}
function lockH(L, t) {
  return L.th * (0.6 + 0.4 * smoothstep(0, 0.1, t)) * (1 - 0.7 * smoothstep(0.6, 1, t)) + 0.00005;
}
// c：横向位置（-1..1），s：朝外程度（1 外侧、-1 内侧），ring：该点的天使环强度
function lockColor(L, t, c, s, ring) {
  const k = 0.5 + 0.5 * s;
  let col = mixc(L.color, HAIR_SHEEN, L.sheen * k * (1 - Math.abs(c)) * smoothstep(0.02, 0.2, t) * smoothstep(0.95, 0.5, t));
  col = mixc(col, HAIR_TIP, 0.6 * smoothstep(0.75, 1, t));
  col = mixc(col, HAIR, 0.5 * (1 - k));
  if (ring > 0 && k > 0.45) col = mixc(col, HAIR_RING, ring * smoothstep(0.45, 0.8, k) * (1 - 0.6 * Math.abs(c)));
  return col;
}

// 把一条中心线扫掠成发束，返回发束的描述（中心线、标架、截面参数），供细发丝复用
function lock(mesh, pts, opt) {
  const n = pts.length - 1;
  const T = [], Nn = [], B = [];
  for (let i = 0; i <= n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)];
    T.push(norm(sub(b, a)));
  }
  // out 方向沿发束平滑，避免扭转
  let prevOut = null;
  for (let i = 0; i <= n; i++) {
    let o = outward(pts[i]);
    if (opt.outBias) o = norm(add(o, opt.outBias));
    o = sub(o, mul(T[i], dot(o, T[i])));
    if (len(o) < 1e-5) o = prevOut || [0, 0, 1];
    o = norm(o);
    if (prevOut) o = norm(add(mul(prevOut, 0.75), mul(o, 0.25)));
    o = norm(sub(o, mul(T[i], dot(o, T[i]))));
    prevOut = o;
    B.push(o);
    Nn.push(cross(T[i], o)); // N = T × out，于是 B = N × T = out，面朝外
  }
  const L = {
    pts, T, N: Nn, B,
    w0: opt.width, th: opt.thick, curl: opt.curl ?? 0.28, tipStart: opt.tipStart ?? 0.55,
    color: opt.color, sheen: opt.sheen,
  };
  // 每个中心线点的天使环强度只算一次
  L.rings = pts.map((q) => (opt.ring !== undefined ? ringAt(q, opt.ring) : 0));
  mesh.tube(
    pts,
    opt.sides,
    (t, a, i) => {
      // 宽度：根部略窄，中段饱满，末端收尖；透镜形截面，两侧向内（朝头/身体）卷
      const w = lockW(L, t), h = lockH(L, t);
      const c = Math.cos(a), s = Math.sin(a);
      const x = w * c;
      const y = h * s - L.curl * w * c * c * 0.5;
      return { o: [x, y], c: lockColor(L, t, c, s, L.rings[i]) };
    },
    { frames: { T, N: Nn, B }, pole0: true, pole1: true },
  );
  return L;
}

// 在一束头发的表面铺一根细发丝：沿发束走，横向位置缓慢游移，终点在发梢附近；
// 颜色取发束表面在该处的颜色，法线取发束表面的法线（整体看是一束，近看是一丝一丝的）
function strandOnLock(mesh, L, R) {
  const n = L.pts.length - 1;
  const top = R() < 0.75 ? 1 : -1;
  const c0 = (R() * 2 - 1) * 0.9;
  const tEnd = 0.7 + 0.3 * R();
  const r0 = 0.0004 + 0.0003 * R();
  const lift = 0.0001 + 0.0004 * R();
  const ph = R() * 50;
  const shade = 0.94 + 0.12 * R();
  const iEnd = Math.max(3, Math.round(n * tEnd));
  const pts = [], cols = [], nrm = [];
  for (let i = 0; ; i += 2) {
    const ii = Math.min(i, iEnd);
    const t = ii / n;
    const w = lockW(L, t), h = lockH(L, t);
    const c = clamp(c0 + 0.14 * noise3(t * 5 + ph, ph, 0.5), -0.96, 0.96);
    const sTop = Math.sqrt(1 - c * c);
    const x = w * c;
    const y = top * (h * sTop + r0 + lift) - L.curl * w * c * c * 0.5;
    const P = L.pts[ii], N = L.N[ii], B = L.B[ii];
    pts.push([P[0] + N[0] * x + B[0] * y, P[1] + N[1] * x + B[1] * y, P[2] + N[2] * x + B[2] * y]);
    const col = lockColor(L, t, c, top * sTop, top > 0 ? L.rings[ii] : 0);
    cols.push([col[0] * shade, col[1] * shade, col[2] * shade]);
    nrm.push(norm([B[0] * top + N[0] * c * 0.6, B[1] * top + N[1] * c * 0.6, B[2] * top + N[2] * c * 0.6]));
    if (ii >= iEnd) break;
  }
  if (pts.length < 3) return;
  const m = pts.length - 1;
  mesh.tube(
    pts,
    4,
    (t, a, i) => {
      const r = r0 * (1 - Math.pow(t, 2)) + 0.00003;
      return { o: [Math.cos(a) * r, Math.sin(a) * r], c: cols[Math.min(m, i)], n: nrm[Math.min(m, i)] };
    },
    { pole1: true },
  );
}

// 天使环强度：头部局部坐标里，按「离头心的仰角」取一条窄带
function ringAt(pw, jitter) {
  const q = worldToHead(pw);
  const d = sub(q, HC);
  const r = len(d);
  if (r < 1e-6 || d[2] < -0.02) return 0;
  const el = d[1] / r; // 仰角的正弦
  const c = 0.6 + jitter * 0.06 - 0.06 * Math.abs(d[0] / r);
  const w = 0.045 * (0.6 + 0.4 * Math.max(0, d[2] / r + 0.3));
  return smoothstep(w, w * 0.4, Math.abs(el - c)) * smoothstep(-0.02, 0.03, d[2]);
}

// 独立生长的细发丝：法线取发量整体的朝外方向
function strand(mesh, pts, r0, color) {
  const nrm = pts.map(outward);
  mesh.tube(
    pts,
    4,
    (t, a, i) => {
      const r = r0 * (1 - Math.pow(t, 1.5)) + 0.00004;
      return { o: [Math.cos(a) * r, Math.sin(a) * r], c: color, n: nrm[i] };
    },
    { pole0: false, pole1: true },
  );
}

// 2000 万面档位：在每束头发表面铺细发丝（分批执行，便于显示进度）
export function buildHairStrands(model, part = 0, parts = 1) {
  const per = DETAIL.strandsPerLock;
  const locks = model.hairLocks || [];
  if (!per || !locks.length) return;
  const mesh = model.mesh('hairfine', { explicitNormals: true });
  for (let li = part; li < locks.length; li += parts) {
    const R = rng(7000 + li);
    // 刘海与侧发较短，铺得密一些
    const count = Math.round(per * (locks[li].pts.length < 60 ? 1.3 : 1));
    for (let j = 0; j < count; j++) strandOnLock(mesh, locks[li], R);
  }
}

// ---------- 发根分布 ----------
// 在头皮（头部局部 (u, φ) 参数域）上按面积均匀撒点，只保留发际线以内
function scalpSamples(count, seed, minMask = 0.9) {
  const r = rng(seed);
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 200) {
    // 在球面方向上均匀取样，再映射到 (u, φ)
    const yv = r() * 2 - 1;
    const u = clamp(0.5 + Math.asin(yv) / PI, 0, 1);
    if (u < 0.3) continue;
    const phi = r() * TAU;
    const p = headPoint(u, phi);
    if (hairMask(p) < minMask) continue;
    out.push({ u, phi, p });
  }
  return out;
}

// 局部法线（头部局部坐标）
function localNormal(u, phi) {
  const h = 0.002;
  const a = headPoint(Math.min(1, u + h), phi), b = headPoint(Math.max(0, u - h), phi);
  const c = headPoint(u, phi + h), d = headPoint(u, phi - h);
  let n = norm(cross(sub(a, b), sub(c, d)));
  const p = headPoint(u, phi);
  if (dot(n, sub(p, HC)) < 0) n = mul(n, -1);
  return n;
}

const CROWN = [0.0, 0.098, -0.042]; // 头旋（头部局部）
// 头顶前半：刘海发根所在的区域
const isBangZone = (p) => p[2] > -0.004 && p[1] > 0.04 && Math.abs(p[0]) < 0.066;

// 垂落时的引导：只在肩膀高度附近把后发拨到背后、前发拨到胸前；再往下轻轻贴向身体
function hangBias(q, side, front) {
  // 只在脖子以外（肩上）引导，避免绕着脖子滑到正中
  // 后发在落到肩上之前就开始往后拨，避免在肩头堆成一团
  const band = gauss(q[1] - (front ? 1.3 : 1.35), front ? 0.07 : 0.08) * smoothstep(0.042, 0.062, Math.abs(q[0]));
  const below = smoothstep(1.28, 1.13, q[1]);
  // 肩部：前发朝前、后发朝后，并稍向外让开脖子；再往下只在前后方向上轻轻贴向身体
  const bz = (front ? 0.11 : -0.12) * band + (front ? -0.012 : 0.012) * below;
  const bx = side * (0.012 * band + 0.004 * below * (front ? 1 : 0));
  return [bx, 0, bz];
}
const toW = (p) => headToWorld(p);
const dirW = (d) => norm(headDirToWorld(d));

export function buildHair(model) {
  const mesh = model.mesh('hair');
  // 每束头发的描述留给细发丝步骤使用
  model.hairLocks = [];
  const R = rng(20240417);

  // ---- 0. 头皮：发际线以内的一层哑光薄壳，填住发束之间的缝 ----
  {
    const mesh = model.mesh('lash');
    const NU = RES(220), NP = RES(440);
    const idx = [];
    for (let i = 0; i <= NU; i++) {
      const u = 0.25 + 0.75 * (i / NU);
      const row = [];
      for (let j = 0; j < NP; j++) {
        const phi = (j / NP) * TAU;
        const p = headPoint(u, phi);
        const m = hairMask(p);
        const n = localNormal(u, phi);
        const q = madd(p, n, 0.0016);
        row.push({ v: mesh.vert(toW(q), mixc(HAIR, rgb('#000000'), 0.4)), m });
      }
      idx.push(row);
    }
    for (let i = 0; i < NU; i++) {
      for (let j = 0; j < NP; j++) {
        const j1 = (j + 1) % NP;
        const a = idx[i][j], b = idx[i + 1][j], c = idx[i + 1][j1], d = idx[i][j1];
        if (a.m > 0.3 && b.m > 0.3 && c.m > 0.3) mesh.tri(a.v, b.v, c.v);
        if (a.m > 0.3 && c.m > 0.3 && d.m > 0.3) mesh.tri(a.v, c.v, d.v);
      }
    }
  }

  // ---- 1. 后发与顶发：长直发垂到背中 ----
  const roots = scalpSamples(680, 11, 0.85);
  for (const rt of roots) {
    const { p, u, phi } = rt;
    const [x, y, z] = p;
    const n = localNormal(u, phi);
    // 头顶前半交给刘海
    if (isBangZone(p)) continue;
    // 鬓角（耳前）交给侧发
    if (z > 0.005 && Math.abs(x) > 0.05 && y < 0.07) continue;
    // 发流：离开头旋，沿头皮切向
    let flow = sub(p, CROWN);
    flow = sub(flow, mul(n, dot(flow, n)));
    if (len(flow) < 1e-4) flow = [0, -1, 0];
    flow = norm(add(norm(flow), [0, -0.35, 0]));
    // 高处的发根盖在外层
    const layer = smoothstep(-0.06, 0.11, y) * 0.75 + 0.25 * R();
    const side = Math.sign(x) || 1;
    // 两侧靠前的一部分搭到肩前
    const front = Math.abs(x) > 0.05 && z > -0.012 && R() < 0.3;
    const ax = Math.abs(x);
    // 参考图：后发长及腰下，前发垂到胸前
    const yStop = front
      ? 0.95 + 0.06 * R()
      : 0.81 + 0.09 * Math.pow(Math.min(1, ax / 0.085), 2) + 0.025 * R() - 0.02 * smoothstep(0, -0.08, z);
    const g = grow({
      root: toW(madd(p, n, 0.001)),
      dir: dirW(flow),
      length: 1.2,
      yStop,
      off0: 0.0022,
      off: 0.0035 + 0.011 * layer,
      stiff: 1.0,
      grav: 0.16,
      gravRamp: 0.03,
      hdamp: 0.07,
      bias: (q) => hangBias(q, side, front),
    });
    if (g.pts.length < 6) continue;
    const seg = Math.round(g.length / DETAIL.lockSeg);
    const { pts } = resample(g.pts, Math.max(12, Math.min(Math.round(140 * 0.0055 / DETAIL.lockSeg), seg)));
    model.hairLocks.push(lock(mesh, pts, {
      width: 0.0095 + 0.007 * R(),
      thick: 0.0024 + 0.0012 * R(),
      sides: DETAIL.lockSides,
      color: mixc(HAIR, HAIR_B, R()),
      sheen: 0.55,
      tipStart: 0.72,
      curl: 0.3,
      ring: R() * 2 - 1,
    }));
  }

  // ---- 2. 刘海：从头顶前半梳下，贴着头顶向前、越过额头，末端在眉毛附近 ----
  const NB = 52;
  for (let k = 0; k < NB; k++) {
    const t = (k + 0.5) / NB;
    const xr = lerp(-0.064, 0.064, t) + (R() - 0.5) * 0.003;
    const ax = Math.abs(xr);
    // 发根：头顶前半的一条弧（由头心沿方向找到头皮）
    const zr = 0.004 + 0.012 * R() - 0.35 * xr * xr / 0.064;
    const d0 = norm([xr * 1.25, 0.1, zr]);
    const p = add(HC, mul(d0, headRadius(d0)));
    const n = d0;
    // 方向：沿头皮朝前下方，两侧略向外
    let fwd = [Math.sign(xr) * 0.25 * smoothstep(0.02, 0.06, ax), -0.15, 1];
    fwd = norm(sub(fwd, mul(n, dot(fwd, n))));
    const long = R();
    // 眉上齐刘海：中间几束略长（落在两眼之间），两侧渐短向外撇
    const stopLocal = 0.004 - 0.014 * long * long * smoothstep(0.03, 0.0, ax) + 0.02 * smoothstep(0.04, 0.064, ax) + 0.003 * Math.sin(xr * 420);
    const stopW = toW([xr, stopLocal, 0.08])[1];
    const g = grow({
      root: toW(madd(p, n, 0.001)),
      dir: dirW(fwd),
      length: 0.26,
      yStop: stopW,
      off0: 0.0025,
      off: 0.0042 + 0.0035 * R(),
      stiff: 1.0,
      grav: 0.075,
      gravRamp: 0.04,
      bias: (q) => {
        // 两侧的刘海向外撇开，留出眼睛
        const ql = worldToHead(q);
        const sx = Math.sign(ql[0]) * 0.035 * smoothstep(0.022, 0.05, Math.abs(ql[0])) * smoothstep(0.05, 0.0, ql[1]);
        return headDirToWorld([sx, 0, 0]);
      },
    });
    if (g.pts.length < 6) continue;
    const { pts } = resample(g.pts, Math.max(20, Math.round(g.length / (DETAIL.lockSeg * 0.55))));
    model.hairLocks.push(lock(mesh, pts, {
      width: 0.0105 + 0.0055 * R(),
      thick: 0.0021,
      sides: DETAIL.lockSides + 2,
      color: mixc(HAIR, HAIR_B, R() * 0.6),
      sheen: 0.7,
      tipStart: 0.62,
      curl: 0.4,
      ring: R() * 2 - 1,
    }));
  }

  // ---- 3. 侧发（触角）：耳前垂到胸口 ----
  for (const side of [1, -1]) {
    for (let k = 0; k < 9; k++) {
      const yr = lerp(0.065, 0.02, k / 8) + (R() - 0.5) * 0.008;
      const u = clamp(0.5 + Math.asin(clamp(yr / 0.12, -1, 1)) / PI, 0, 1);
      // 在鬓角处：x 接近头宽，z 略靠前
      const zr = 0.012 + 0.025 * R();
      let best = null, bd = 1;
      for (let j = 0; j < 180; j++) {
        const phi = (side > 0 ? 0 : PI) + (side > 0 ? 1 : -1) * (j / 180) * (PI / 2);
        const q = headPoint(u, phi);
        const d = Math.abs(q[2] - zr);
        if (d < bd) { bd = d; best = phi; }
      }
      const p = headPoint(u, best);
      const n = localNormal(u, best);
      const dir = norm(add(add(mul(n, 0.25), [0, -1, 0]), [0, 0, 0.12]));
      const len0 = 0.24 + 0.08 * R() - 0.06 * (k / 8);
      const g = grow({
        root: toW(madd(p, n, 0.001)),
        dir: dirW(dir),
        length: len0,
        off0: 0.002,
        off: 0.004 + 0.004 * (k / 8) + 0.002 * R(),
        stiff: 1.0,
        grav: 0.14,
        gravRamp: 0.02,
        hdamp: 0.05,
        bias: (q) => [side * 0.008 * gauss(q[1] - 1.32, 0.06), 0, 0.08 * gauss(q[1] - 1.3, 0.06)],
      });
      if (g.pts.length < 6) continue;
      const { pts } = resample(g.pts, Math.max(16, Math.round(g.length / (DETAIL.lockSeg * 0.73))));
      model.hairLocks.push(lock(mesh, pts, {
        width: 0.011 + 0.005 * R(),
        thick: 0.0024,
        sides: DETAIL.lockSides + 2,
        color: mixc(HAIR, HAIR_B, R()),
        sheen: 0.6,
        tipStart: 0.62,
        curl: 0.35,
      }));
    }
  }

  // ---- 4. 细发丝：让发束表面有一丝一丝的质感（单独一个网格，卡通模式下不描边） ----
  const fineMesh = model.mesh('hairfine', { explicitNormals: true });
  const fine = scalpSamples(1100, 99, 0.95);
  for (const rt of fine) {
    const { p, u, phi } = rt;
    const [x, y, z] = p;
    if (isBangZone(p)) continue;
    if (z > 0.005 && Math.abs(x) > 0.05 && y < 0.07) continue;
    const n = localNormal(u, phi);
    let flow = sub(p, CROWN);
    flow = sub(flow, mul(n, dot(flow, n)));
    flow = norm(add(norm(flow), [0, -0.35, 0]));
    const side = Math.sign(x) || 1;
    const front = Math.abs(x) > 0.055 && z > -0.01 && R() < 0.25;
    const ax = Math.abs(x);
    const yStop = front ? 0.96 + 0.05 * R() : 0.82 + 0.09 * Math.pow(Math.min(1, ax / 0.085), 2) + 0.04 * R();
    const g = grow({
      root: toW(madd(p, n, 0.001)),
      dir: dirW(flow),
      length: 1.2,
      yStop,
      off0: 0.003,
      off: 0.0145 + 0.003 * R(),
      stiff: 1.0,
      grav: 0.16,
      gravRamp: 0.03,
      hdamp: 0.07,
      bias: (q) => {
        const b = hangBias(q, side, front);
        b[0] += 0.006 * noise3(q[1] * 20, ax * 50, 0);
        return b;
      },
    });
    if (g.pts.length < 6) continue;
    const { pts } = resample(g.pts, Math.max(10, Math.min(Math.round(110 * 0.008 / DETAIL.fineSeg), Math.round(g.length / DETAIL.fineSeg))));
    strand(fineMesh, pts, 0.0007 + 0.0005 * R(), mixc(HAIR_B, HAIR_SHEEN, 0.3 * R()));
  }
}
