import { PAT, C } from '../render/builder.js';
import { lerp } from '../core/math.js';

// 所有屋顶都在局部坐标中构建：正面朝 +z，屋脊沿 x 轴

// 切妻（双坡）屋顶，带轻微的“反り”（凹曲线）。yw = 墙顶高度，yr = 屋脊高度
export function gableRoof(b, W, D, yw, yr, ox, oz, color, opt = {}) {
  const sori = opt.sori ?? 0.09;
  const pat = opt.pat ?? PAT.KAWARA;
  const under = opt.under || '#4a3a2e';
  const hd = D / 2;
  const zE = hd + oz;
  const vw = hd / zE;
  const k = (yr - yw + 0.03) / (vw + sori * Math.sin(Math.PI * vw));
  const y0 = yr - k;
  const yAt = (v) => yr - k * v - sori * k * Math.sin(Math.PI * v);
  const xL = -W / 2 - ox, xR = W / 2 + ox;
  const slopeLen = Math.hypot(zE, k);
  b.pattern(pat, 0);
  for (const side of [1, -1]) {
    b.surface(
      (u, v) => [lerp(xL, xR, u), yAt(v), side * zE * v],
      Math.max(2, Math.round((xR - xL) / 3)),
      5,
      color,
      { flip: side > 0, uvFn: (u, v) => [lerp(xL, xR, u), v * slopeLen], doubleSided: true, backColor: under, backPat: PAT.PLANK }
    );
    // 鼻隠し（檐口封板）
    b.pattern(PAT.PLANK, 0);
    const zf = side * zE;
    if (side > 0) b.quad([xL, y0 - 0.16, zf], [xR, y0 - 0.16, zf], [xR, y0, zf], [xL, y0, zf], under);
    else b.quad([xR, y0 - 0.16, zf], [xL, y0 - 0.16, zf], [xL, y0, zf], [xR, y0, zf], under);
    b.pattern(pat, 0);
  }
  // 山墙三角
  if (opt.gable !== false) {
    const gc = opt.gableColor || '#efe8da';
    const N = 6;
    const poly = [[-hd, yw - 0.06], [hd, yw - 0.06]];
    for (let i = 0; i <= N; i++) {
      const z = hd - (i / N) * 2 * hd;
      poly.push([z, yAt(Math.abs(z) / zE) - 0.04]);
    }
    poly.splice(2, 1); // 去掉与端点几乎重合的曲线首尾点
    poly.pop();
    b.pattern(opt.gablePat ?? PAT.PLASTER, 0);
    for (const sx of [-1, 1]) {
      b.push();
      b.translate((sx * W) / 2, 0, 0);
      b.rotateY(Math.PI / 2);
      b.extrudeXY(poly.map((p) => [-p[0], p[1]]), -0.06, 0.06, gc);
      b.pop();
    }
  }
  // 破風板（山墙边沿）
  b.pattern(PAT.PLANK, 0);
  const barge = opt.barge || '#3a2c22';
  for (const x of [xL - 0.02, xR + 0.02]) {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const v = Math.abs(i / 4 - 1);
      const z = (i / 8) * 2 * zE - zE;
      pts.push([x, yAt(v) - 0.04, z]);
    }
    b.tube(pts, 0.07, 4, barge);
  }
  // 屋脊
  b.pattern(PAT.NONE, 0);
  const rc = opt.ridge || '#2e323a';
  b.box(0, yr - 0.06, 0, xR - xL + 0.12, 0.3, 0.34, rc);
  // 鬼瓦
  for (const x of [xL - 0.05, xR + 0.05]) b.box(x, yr - 0.1, 0, 0.16, 0.48, 0.42, rc);
  return { y0, yAt, zE };
}

// 寄棟（四坡）屋顶，屋脊沿 x（要求 W >= D）
export function hipRoof(b, W, D, yw, yr, o, color, opt = {}) {
  const pat = opt.pat ?? PAT.KAWARA;
  const under = opt.under || '#4a3a2e';
  const hd = D / 2, hw = W / 2;
  const rise = yr - yw;
  const slope = rise / hd;
  const y0 = yw - slope * o;
  const xE = hw + o, zE = hd + o;
  const xr = Math.max(0, hw - hd);
  const sl = Math.hypot(zE, yr - y0);
  b.pattern(pat, 0);
  const uvT = (L) => [[0, sl], [L, sl], [L * 0.5 + xr, 0], [L * 0.5 - xr, 0]];
  // 前后坡
  b.quad([-xE, y0, zE], [xE, y0, zE], [xr, yr, 0], [-xr, yr, 0], color, [[-xE, sl], [xE, sl], [xr, 0], [-xr, 0]]);
  b.quad([xE, y0, -zE], [-xE, y0, -zE], [-xr, yr, 0], [xr, yr, 0], color, [[-xE, sl], [xE, sl], [xr, 0], [-xr, 0]]);
  // 两侧斜脊
  b.triangle([xE, y0, zE], [xE, y0, -zE], [xr, yr, 0], color, [[-zE, sl], [zE, sl], [0, 0]]);
  b.triangle([-xE, y0, -zE], [-xE, y0, zE], [-xr, yr, 0], color, [[-zE, sl], [zE, sl], [0, 0]]);
  // 檐下
  b.pattern(PAT.PLANK, 0);
  b.quad([xE, y0, zE], [-xE, y0, zE], [-xr, yr - 0.02, 0], [xr, yr - 0.02, 0], under);
  b.quad([-xE, y0, -zE], [xE, y0, -zE], [xr, yr - 0.02, 0], [-xr, yr - 0.02, 0], under);
  b.triangle([xE, y0, -zE], [xE, y0, zE], [xr, yr - 0.02, 0], under);
  b.triangle([-xE, y0, zE], [-xE, y0, -zE], [-xr, yr - 0.02, 0], under);
  // 檐口封板
  const f = 0.15;
  b.quad([-xE, y0 - f, zE], [xE, y0 - f, zE], [xE, y0, zE], [-xE, y0, zE], under);
  b.quad([xE, y0 - f, -zE], [-xE, y0 - f, -zE], [-xE, y0, -zE], [xE, y0, -zE], under);
  b.quad([xE, y0 - f, zE], [xE, y0 - f, -zE], [xE, y0, -zE], [xE, y0, zE], under);
  b.quad([-xE, y0 - f, -zE], [-xE, y0 - f, zE], [-xE, y0, zE], [-xE, y0, -zE], under);
  // 屋脊与斜脊
  b.pattern(PAT.NONE, 0);
  const rc = opt.ridge || '#2e323a';
  if (xr > 0.05) b.box(0, yr - 0.05, 0, 2 * xr + 0.1, 0.22, 0.26, rc);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.tube([[sx * xE, y0 + 0.04, sz * zE], [sx * xr, yr + 0.04, 0]], 0.08, 4, rc);
  return { y0 };
}

// 入母屋（歇山顶）：下部四坡、上部山墙
export function irimoyaRoof(b, W, D, yw, yr, o, color, opt = {}) {
  const pat = opt.pat ?? PAT.KAWARA;
  const under = opt.under || '#4a3a2e';
  const hd = D / 2, hw = W / 2;
  const rise = yr - yw;
  const slope = rise / hd;
  const y0 = yw - slope * o;
  const xE = hw + o, zE = hd + o;
  const xg = Math.max(hw - hd * 0.62, hw * 0.35);
  const zk = Math.max(0.4, zE - (xE - xg));
  const yk = yr - (yr - y0) * (zk / zE);
  const sl = Math.hypot(zE, yr - y0);
  const vk = sl * (1 - zk / zE);
  b.pattern(pat, 0);
  for (const s of [1, -1]) {
    // 前（s=1）/ 后坡：下段梯形 + 上段矩形
    if (s > 0) {
      b.quad([-xE, y0, zE], [xE, y0, zE], [xg, yk, zk], [-xg, yk, zk], color, [[-xE, sl], [xE, sl], [xg, vk], [-xg, vk]]);
      b.quad([-xg, yk, zk], [xg, yk, zk], [xg, yr, 0], [-xg, yr, 0], color, [[-xg, vk], [xg, vk], [xg, 0], [-xg, 0]]);
    } else {
      b.quad([xE, y0, -zE], [-xE, y0, -zE], [-xg, yk, -zk], [xg, yk, -zk], color, [[-xE, sl], [xE, sl], [xg, vk], [-xg, vk]]);
      b.quad([xg, yk, -zk], [-xg, yk, -zk], [-xg, yr, 0], [xg, yr, 0], color, [[-xg, vk], [xg, vk], [xg, 0], [-xg, 0]]);
    }
    // 侧坡
    const sx = s;
    if (sx > 0) b.quad([xE, y0, zE], [xE, y0, -zE], [xg, yk, -zk], [xg, yk, zk], color, [[-zE, sl], [zE, sl], [zk, vk], [-zk, vk]]);
    else b.quad([-xE, y0, -zE], [-xE, y0, zE], [-xg, yk, zk], [-xg, yk, -zk], color, [[-zE, sl], [zE, sl], [zk, vk], [-zk, vk]]);
  }
  // 山墙（妻）面：木格或灰泥
  b.pattern(opt.gablePat ?? PAT.PLANK, 0);
  const gc = opt.gableColor || '#5a4232';
  b.triangle([xg, yk, zk], [xg, yk, -zk], [xg, yr, 0], gc);
  b.triangle([-xg, yk, -zk], [-xg, yk, zk], [-xg, yr, 0], gc);
  // 檐下
  b.pattern(PAT.PLANK, 0);
  b.quad([xE, y0, zE], [-xE, y0, zE], [-xg, yk - 0.03, zk], [xg, yk - 0.03, zk], under);
  b.quad([-xE, y0, -zE], [xE, y0, -zE], [xg, yk - 0.03, -zk], [-xg, yk - 0.03, -zk], under);
  b.quad([xE, y0, -zE], [xE, y0, zE], [xg, yk - 0.03, zk], [xg, yk - 0.03, -zk], under);
  b.quad([-xE, y0, zE], [-xE, y0, -zE], [-xg, yk - 0.03, -zk], [-xg, yk - 0.03, zk], under);
  const f = 0.16;
  b.quad([-xE, y0 - f, zE], [xE, y0 - f, zE], [xE, y0, zE], [-xE, y0, zE], under);
  b.quad([xE, y0 - f, -zE], [-xE, y0 - f, -zE], [-xE, y0, -zE], [xE, y0, -zE], under);
  b.quad([xE, y0 - f, zE], [xE, y0 - f, -zE], [xE, y0, -zE], [xE, y0, zE], under);
  b.quad([-xE, y0 - f, -zE], [-xE, y0 - f, zE], [-xE, y0, zE], [-xE, y0, -zE], under);
  // 屋脊、破风、降り棟
  b.pattern(PAT.NONE, 0);
  const rc = opt.ridge || '#2e323a';
  b.box(0, yr - 0.06, 0, 2 * xg + 0.5, 0.34, 0.36, rc);
  for (const sx of [-1, 1]) {
    b.box(sx * (xg + 0.25), yr - 0.12, 0, 0.18, 0.56, 0.46, rc);
    for (const sz of [-1, 1]) {
      b.tube([[sx * xg, yr, 0], [sx * xg, yk + 0.05, sz * zk]], 0.07, 4, '#3a2c22');
      b.tube([[sx * xE, y0 + 0.05, sz * zE], [sx * xg, yk + 0.08, sz * zk]], 0.09, 4, rc);
    }
  }
  return { y0 };
}

// 单坡（庇）：从墙面 z0 处 y1 下降到 z1 处 y2，宽 W
export function leanTo(b, W, z0, z1, y1, y2, color, opt = {}) {
  const under = opt.under || '#4a3a2e';
  const hw = W / 2 + (opt.ox ?? 0.1);
  const sl = Math.hypot(z1 - z0, y1 - y2);
  b.pattern(opt.pat ?? PAT.KAWARA, 0);
  b.quad([-hw, y2, z1], [hw, y2, z1], [hw, y1, z0], [-hw, y1, z0], color, [[-hw, sl], [hw, sl], [hw, 0], [-hw, 0]]);
  b.pattern(PAT.PLANK, 0);
  b.quad([hw, y2 - 0.02, z1], [-hw, y2 - 0.02, z1], [-hw, y1 - 0.02, z0], [hw, y1 - 0.02, z0], under);
  b.quad([-hw, y2 - 0.13, z1], [hw, y2 - 0.13, z1], [hw, y2, z1], [-hw, y2, z1], under);
  // 两端封板
  b.triangle([hw, y2 - 0.13, z1], [hw, y1, z0], [hw, y2, z1], under);
  b.triangle([-hw, y1, z0], [-hw, y2 - 0.13, z1], [-hw, y2, z1], under);
}

export { C };
