import * as THREE from 'three';
import { PAT, C, vary, mulColor } from '../render/builder.js';
import { gableRoof, hipRoof, irimoyaRoof, leanTo } from './roofs.js';
import { signQuad } from './textures.js';
import { lanternGeometry } from './roads.js';
import { torii, stoneLantern, komainu, bench, vendingMachine, stampStand, signpost, postbox, bicycle, VERMILION, VERM_DARK } from './props.js';
import {
  SITES, STAIRS, river, riverNearest, riverHalfWidth, riverWaterLevel, bankLevel, railway, ROADS, WORLD,
} from './layout.js';
import { lakeShoreRadius } from './terrain.js';
import { RNG, lerp, clamp, pointAt, smoothstep } from '../core/math.js';

// 在 (x,z) 以 rot 朝向放置：返回局部→世界坐标函数
function frame(x, z, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
}

// 建一张长椅并登记（坐下互动）
function addBench(ctx, x, y, z, rot) {
  const b = ctx.chunks.at(x, z);
  b.place(x, y, z, rot);
  bench(b);
  ctx.benches.push({ x, z, y, rot });
  ctx.colliders.addBox(x, z, 0.9, 0.3, rot, y - 1, y + 0.9, 'low');
}

// 局部坐标的盒碰撞体
function boxCol(ctx, f, rot, lx, lz, hw, hd, y0, y1, tag) {
  const [x, z] = f(lx, lz);
  return ctx.colliders.addBox(x, z, hw, hd, rot, y0, y1, tag);
}

// ---------------------------------------------------------------- 神社
export function buildShrine(ctx) {
  const { chunks, signs, atlas, colliders, terrain } = ctx;
  const S = SITES.shrine;
  const st = STAIRS.shrine;
  const dx = st.x1 - st.x0, dz = st.z1 - st.z0;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len; // 上山方向
  const rot = Math.atan2(-ux, -uz); // 建筑正面朝向山下（参道来向）
  const top = S.top;
  const f = frame(S.x, S.z, rot);
  const b = chunks.at(S.x, S.z);

  // 石阶：踏步 + 两侧石墙
  {
    const bs = chunks.at((st.x0 + st.x1) / 2, (st.z0 + st.z1) / 2);
    const steps = Math.round((st.h1 - st.h0) / 0.2);
    const srot = Math.atan2(ux, uz);
    // 石阶与两侧石墙下不长草
    ctx.noGrass.push({ x: (st.x0 + st.x1) / 2, z: (st.z0 + st.z1) / 2, hw: st.w / 2 + 0.55, hd: len / 2 + 0.5, rot: srot, margin: 0.1 });
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps;
      const x = lerp(st.x0, st.x1, (t0 + t1) / 2), z = lerp(st.z0, st.z1, (t0 + t1) / 2);
      const y0 = lerp(st.h0, st.h1, t0) - 0.25, y1 = lerp(st.h0, st.h1, t1);
      bs.place(x, 0, z, srot);
      bs.pattern(PAT.STONE, 0);
      bs.box(0, y0, 0, st.w, y1 - y0 + 0.02, (len / steps) * 1.02, i % 2 ? '#a39b8d' : '#9c9486');
    }
    // 两侧低矮石墙（阶梯状）
    for (const side of [-1, 1]) {
      const nx = uz * side, nz = -ux * side;
      const off = st.w / 2 + 0.25;
      const N = 14;
      for (let i = 0; i < N; i++) {
        const t0 = i / N, t1 = (i + 1) / N;
        const xm = lerp(st.x0, st.x1, (t0 + t1) / 2) + nx * off, zm = lerp(st.z0, st.z1, (t0 + t1) / 2) + nz * off;
        const ya = lerp(st.h0, st.h1, t0), yb = lerp(st.h0, st.h1, t1);
        bs.place(xm, 0, zm, srot);
        bs.pattern(PAT.STONE, 0);
        bs.box(0, ya - 0.8, 0, 0.45, yb - ya + 1.35, len / N + 0.02, '#958e81', { topColor: '#a8a194' });
        colliders.addBox(xm, zm, 0.25, len / N / 2, srot, ya - 1, yb + 0.6, 'low');
      }
    }
    // 千本鸟居
    const nT = 15;
    for (let i = 0; i < nT; i++) {
      const t = 0.04 + (i / (nT - 1)) * 0.86;
      const x = lerp(st.x0, st.x1, t), z = lerp(st.z0, st.z1, t);
      const y = lerp(st.h0, st.h1, t);
      const bt = chunks.at(x, z);
      bt.place(x, y, z, srot);
      torii(bt, 1.12, VERMILION);
      for (const sx of [-1, 1]) {
        const px = x + uz * sx * 1.68, pz = z - ux * sx * 1.68;
        colliders.addCircle(px, pz, 0.24, y - 1, y + 4);
      }
    }
  }

  // 大鸟居（平台边缘）
  {
    const [x, z] = f(0, 30);
    const bt = chunks.at(x, z);
    bt.place(x, top, z, rot);
    torii(bt, 1.75, VERMILION);
    const r = atlas.plaque('桜川神社');
    const sb = signs.at(x, z);
    sb.place(x, top + 1.75 * 3.6 * 0.86, z, rot);
    sb.translate(0, 0, 0.17);
    signQuad(sb, r, 0.55, 1.62, 0xffffff, 0.3, false);
    for (const sx of [-1, 1]) {
      const [px, pz] = f(sx * 2.62, 30);
      colliders.addCircle(px, pz, 0.32, top - 1, top + 6);
    }
  }
  // 参道石板
  b.place(S.x, top, S.z, rot);
  b.pattern(PAT.STONE, 0);
  b.box(0, -0.2, 9, 3.2, 0.26, 40, '#b3ab9c');
  // 石灯笼（两列）
  for (const lz of [22, 14, 6]) {
    for (const sx of [-1, 1]) {
      const [x, z] = f(sx * 3.4, lz);
      const bl = chunks.at(x, z);
      bl.place(x, top, z, rot);
      const lp = stoneLantern(bl, 1.05);
      ctx.lights.push([x, top + 1.3, z, 0.6]);
      colliders.addCircle(x, z, 0.42, top - 1, top + 2);
    }
  }
  // 狛犬
  for (const sx of [-1, 1]) {
    const [x, z] = f(sx * 2.6, -1.5);
    const bk = chunks.at(x, z);
    bk.place(x, top, z, rot - sx * 0.35);
    komainu(bk, 1.0, sx > 0);
    colliders.addCircle(x, z, 0.65, top - 1, top + 2);
  }
  ctx.spots.shrineCat = f(-4.2, -0.5);

  // 拜殿
  {
    b.place(S.x, top, S.z, rot);
    b.push();
    b.translate(0, 0, -9);
    const W = 11, D = 8;
    b.pattern(PAT.STONE, 0);
    b.box(0, -0.2, 0, W + 1.4, 0.75, D + 1.2, '#958e81');
    // 木地板/回廊
    b.pattern(PAT.PLANK, 0);
    b.box(0, 0.55, 0, W + 0.8, 0.18, D + 0.6, '#7a5a40');
    // 柱
    b.pattern(PAT.NONE, 0);
    for (let i = 0; i <= 4; i++)
      for (const zz of [-D / 2, D / 2]) b.cylinder(-W / 2 + (i / 4) * W, 0.7, zz, 0.17, 0.19, 3.6, 10, VERMILION);
    for (const xx of [-W / 2, W / 2]) b.cylinder(xx, 0.7, 0, 0.17, 0.19, 3.6, 10, VERMILION);
    // 墙（白壁 + 正面格子门）
    b.pattern(PAT.PLASTER, 0);
    b.box(0, 0.7, -0.4, W - 0.6, 3.5, D - 1.6, '#f2ede2', { faces: 'pxnxnz' });
    b.pattern(PAT.KOSHI, 0.6);
    b.quad([-W / 2 + 0.4, 0.75, D / 2 - 1.18], [W / 2 - 0.4, 0.75, D / 2 - 1.18], [W / 2 - 0.4, 3.6, D / 2 - 1.18], [-W / 2 + 0.4, 3.6, D / 2 - 1.18], '#5a2a1d', [[-W / 2, 0.75], [W / 2, 0.75], [W / 2, 3.6], [-W / 2, 3.6]]);
    b.pattern(PAT.NONE, 0);
    // 楣与斗拱
    b.box(0, 3.95, 0, W + 0.5, 0.36, D + 0.5, VERM_DARK);
    b.box(0, 4.31, 0, W + 0.9, 0.22, D + 0.9, '#efe8da');
    // 铜绿屋顶
    irimoyaRoof(b, W + 0.6, D + 0.6, 4.5, 4.5 + 4.6, 1.6, '#5f8f80', { pat: PAT.KAWARA, under: '#7a3a2a', ridge: '#4a6e62', gableColor: '#efe8da', gablePat: PAT.SHOJI });
    // 向拝（正面延伸的檐）
    leanTo(b, 5.2, D / 2 + 0.2, D / 2 + 3.2, 5.0, 4.0, '#5f8f80', { under: '#7a3a2a' });
    for (const sx of [-1, 1]) b.cylinder(sx * 2.3, 0.7, D / 2 + 2.9, 0.15, 0.17, 3.4, 10, VERMILION);
    // 注连绳与纸垂
    b.tube([[-2.6, 3.85, D / 2 + 3.0], [-1.2, 3.55, D / 2 + 3.05], [0, 3.45, D / 2 + 3.05], [1.2, 3.55, D / 2 + 3.05], [2.6, 3.85, D / 2 + 3.0]], 0.16, 8, '#d9c79a');
    for (const sx of [-1.2, 0, 1.2]) {
      b.pattern(PAT.NONE, 0);
      b.quad([sx - 0.08, 2.9, D / 2 + 3.12], [sx + 0.08, 2.9, D / 2 + 3.12], [sx + 0.08, 3.4, D / 2 + 3.12], [sx - 0.08, 3.4, D / 2 + 3.12], '#f7f5ee');
    }
    // 铃与铃绳
    b.sphere(0, 3.15, D / 2 + 2.6, 0.24, 10, 8, '#c9a54a');
    b.tube([[0, 3.0, D / 2 + 2.6], [0.05, 2.0, D / 2 + 2.65], [0, 1.0, D / 2 + 2.6]], 0.06, 6, '#c8452e');
    // 赛钱箱
    b.pattern(PAT.PLANK, 0);
    b.box(0, 0.7, D / 2 + 1.7, 1.6, 0.8, 0.8, '#6b4a33');
    b.pattern(PAT.NONE, 0);
    b.box(0, 1.5, D / 2 + 1.7, 1.7, 0.06, 0.9, '#3a2a20');
    // 台阶
    b.pattern(PAT.STONE, 0);
    for (let i = 0; i < 3; i++) b.box(0, 0.55 - i * 0.2, D / 2 + 0.55 + i * 0.35, 4.2, 0.2, 0.4, '#a79f91');
    b.pop();
    const [hx, hz] = f(0, -9);
    colliders.addBox(hx, hz, (W + 1.4) / 2, (D + 1.2) / 2, rot, top - 1, top + 9);
    const [ox, oz] = f(0, -9 + D / 2 + 1.7);
    colliders.addBox(ox, oz, 0.85, 0.45, rot, top - 1, top + 1.6);
    const [px, pz] = f(0, -9 + D / 2 + 3.2);
    ctx.interact.push({ id: 'pray', kind: 'pray', x: px, y: top, z: pz, r: 2.6, label: '参拜' });
    for (const sx of [-1, 1]) {
      const [cx, cz] = f(sx * 2.3, -9 + D / 2 + 2.9);
      colliders.addCircle(cx, cz, 0.25, top - 1, top + 4);
    }
  }
  // 本殿（拜殿后方，较小）
  {
    b.place(S.x, top, S.z, rot);
    b.push();
    b.translate(0, 0, -19);
    b.pattern(PAT.STONE, 0);
    b.box(0, -0.2, 0, 6.4, 1.2, 6.4, '#958e81');
    b.pattern(PAT.PLASTER, 0);
    b.box(0, 1.0, 0, 4.6, 2.8, 4.6, '#f2ede2');
    b.pattern(PAT.NONE, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cylinder(sx * 2.3, 1.0, sz * 2.3, 0.14, 0.15, 2.8, 8, VERMILION);
    gableRoof(b, 4.8, 4.8, 3.8, 6.4, 0.9, 1.0, '#5f8f80', { under: '#7a3a2a', ridge: '#4a6e62', gableColor: '#efe8da' });
    // 千木与鲣木
    for (const sx of [-1, 1]) {
      b.pattern(PAT.NONE, 0);
      b.push();
      b.translate(sx * 3.15, 6.3, 0);
      b.rotateZ(sx * 0.5);
      b.box(0, 0, 0, 0.12, 1.4, 0.12, '#c9a54a');
      b.pop();
    }
    for (const lx of [-1.2, 0, 1.2]) b.cylinder(lx, 6.35, 0, 0.13, 0.13, 0.16, 8, '#c9a54a');
    b.pop();
    const [x, z] = f(0, -19);
    colliders.addBox(x, z, 3.4, 3.4, rot, top - 1, top + 7);
  }
  // 手水舍
  {
    const [x, z] = f(6.5, 12);
    const bc = chunks.at(x, z);
    bc.place(x, top, z, rot - Math.PI / 2);
    bc.pattern(PAT.STONE, 0);
    bc.box(0, 0, 0, 2.2, 0.8, 1.1, '#8e887d');
    bc.pattern(PAT.NONE, 0);
    bc.box(0, 0.8, 0, 2.0, 0.03, 0.9, '#5c8a96');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bc.box(sx * 1.25, 0, sz * 0.75, 0.16, 2.7, 0.16, VERMILION);
    gableRoof(bc, 2.8, 2.0, 2.7, 3.6, 0.35, 0.45, '#4d5560', { gable: false, under: '#7a3a2a' });
    bc.pattern(PAT.NONE, 0);
    for (let i = 0; i < 4; i++) bc.tube([[-0.6 + i * 0.4, 0.86, 0.2], [-0.6 + i * 0.4, 0.86, -0.25]], 0.02, 4, '#c9b48a');
    colliders.addBox(x, z, 1.2, 0.7, rot - Math.PI / 2, top - 1, top + 3);
    const [ix, iz] = f(4.9, 12);
    ctx.interact.push({ id: 'chozu', kind: 'chozu', x: ix, y: top, z: iz, r: 2.2, label: '净手' });
  }
  // 绘马架 + 御神签架 + 社务所
  {
    const [x, z] = f(-6.5, 4);
    const be = chunks.at(x, z);
    be.place(x, top, z, rot + Math.PI / 2);
    be.pattern(PAT.PLANK, 0);
    be.box(-1.4, 0, 0, 0.12, 1.9, 0.12, '#5a3d2b');
    be.box(1.4, 0, 0, 0.12, 1.9, 0.12, '#5a3d2b');
    be.box(0, 1.5, 0, 3.0, 0.08, 0.1, '#5a3d2b');
    be.box(0, 1.05, 0, 3.0, 0.08, 0.1, '#5a3d2b');
    const rng = new RNG(5);
    for (let row = 0; row < 2; row++)
      for (let i = 0; i < 9; i++) {
        const ex = -1.25 + i * 0.31 + rng.float(-0.04, 0.04), ey = (row ? 0.78 : 1.23);
        be.pattern(PAT.PLANK, 0);
        be.quad([ex - 0.13, ey, 0.07], [ex + 0.13, ey, 0.07], [ex + 0.13, ey + 0.2, 0.07], [ex, ey + 0.27, 0.07], '#d8b98a');
        be.quad([ex + 0.13, ey, 0.05], [ex - 0.13, ey, 0.05], [ex, ey + 0.27, 0.05], [ex + 0.13, ey + 0.2, 0.05], '#d8b98a');
      }
    gableRoof(be, 3.2, 0.6, 1.95, 2.25, 0.15, 0.25, '#3e4350', { gable: false });
    colliders.addBox(x, z, 0.4, 1.6, rot, top - 1, top + 2.3);
    const [ix, iz] = f(-5.2, 4);
    ctx.interact.push({ id: 'ema', kind: 'ema', x: ix, y: top, z: iz, r: 2.0, label: '看绘马' });
  }
  {
    // 社务所（小建筑）+ 御神签
    const [x, z] = f(-8.5, -6);
    const bo = chunks.at(x, z);
    bo.place(x, top, z, rot + Math.PI / 2);
    bo.pattern(PAT.STONE, 0);
    bo.box(0, -0.2, 0, 6.2, 0.5, 4.2, '#958e81');
    bo.pattern(PAT.PLASTER, 0);
    bo.box(0, 0.3, 0, 6, 2.8, 4, '#f2ede2', { faces: 'pxnxnz' });
    bo.pattern(PAT.SHOJI, 0.8);
    bo.quad([-2.9, 0.3, 2.0], [2.9, 0.3, 2.0], [2.9, 3.1, 2.0], [-2.9, 3.1, 2.0], '#f3ead6', [[-2.9, 0.3], [2.9, 0.3], [2.9, 3.1], [-2.9, 3.1]]);
    bo.pattern(PAT.PLANK, 0);
    bo.box(0, 1.0, 2.35, 4.5, 0.08, 0.7, '#7a5a40');
    bo.pattern(PAT.NONE, 0);
    bo.box(-1.2, 1.08, 2.35, 0.3, 0.42, 0.3, '#b8322a');
    bo.box(0.4, 1.08, 2.4, 1.4, 0.06, 0.4, '#e9dfc6');
    hipRoof(bo, 6.2, 4.2, 3.1, 4.6, 0.7, '#3e4350');
    colliders.addBox(x, z, 2.2, 3.2, rot, top - 1, top + 4.6);
    const [ix, iz] = f(-5.6, -6);
    ctx.interact.push({ id: 'omikuji', kind: 'omikuji', x: ix, y: top, z: iz, r: 2.3, label: '抽御神签' });
    const [sx, sz] = f(-5.6, -2.2);
    ctx.stamps.push({ id: 'shrine', name: '桜川神社', x: sx, z: sz, y: top, rot: rot + Math.PI / 2 });
  }
  // 神木（巨杉，绕注连绳）
  {
    const [x, z] = f(8, -14);
    ctx.treeSpots.push({ x, z, kind: 'cedar', scale: 1.9, y: top });
    const bs = chunks.at(x, z);
    bs.place(x, top, z, 0);
    bs.pattern(PAT.NONE, 0);
    bs.lathe(0, 0, [[1.02, 2.0], [1.08, 2.15], [1.02, 2.3]], 16, '#d9c79a');
    ctx.noTree.push([x, z, 5]);
  }
  for (const [lx, lz] of [[6, 26], [-6, 26], [9, 6], [-10, 14], [10, -4], [-11, -16], [12, -22], [0, -27], [-14, 6], [14, 16]]) {
    const [x, z] = f(lx, lz);
    ctx.treeSpots.push({ x, z, kind: 'sakura', scale: 0.85 + Math.abs(lx % 3) * 0.08, y: top, lit: true });
  }
  ctx.noTree.push([S.x, S.z, 12]);
  addBench(ctx, f(7.5, 20)[0], top, f(7.5, 20)[1], rot - Math.PI / 2);
  ctx.spots.miko = f(-2, 8);
  ctx.spots.shrineTop = [S.x, top, S.z, rot];
}

// ---------------------------------------------------------------- 花雲寺与五重塔
function pagodaRoof(b, half, y0, y1, over, color, under, topH = half - 0.4) {
  const e = half + over;
  const sag = 0.35;
  const lift = 0.55;
  for (let k = 0; k < 4; k++) {
    b.push();
    b.rotateY((k * Math.PI) / 2);
    b.pattern(PAT.KAWARA, 0);
    b.surface(
      (u, v) => {
        const ext = lerp(topH, e, v);
        const x = lerp(-ext, ext, u);
        const y = lerp(y1, y0, v) - sag * Math.sin(v * Math.PI) + lift * Math.pow(Math.abs(2 * u - 1), 3) * v * v;
        return [x, y, ext];
      },
      8, 5, color,
      { flip: true, uvFn: (u, v) => [lerp(-e, e, u), v * (e - topH) * 1.2], doubleSided: true, backColor: under, backPat: PAT.PLANK }
    );
    b.pop();
  }
}

export function buildTemple(ctx) {
  const { chunks, signs, atlas, colliders } = ctx;
  const S = SITES.temple;
  const st = STAIRS.temple;
  const top = S.top;
  const dx = st.x1 - st.x0, dz = st.z1 - st.z0;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  const rot = Math.atan2(-ux, -uz);
  const f = frame(S.x, S.z, rot);
  // 石阶
  {
    const bs = chunks.at((st.x0 + st.x1) / 2, (st.z0 + st.z1) / 2);
    const steps = Math.round((st.h1 - st.h0) / 0.2);
    const srot = Math.atan2(ux, uz);
    // 石阶与两侧石墙下不长草
    ctx.noGrass.push({ x: (st.x0 + st.x1) / 2, z: (st.z0 + st.z1) / 2, hw: st.w / 2 + 0.55, hd: len / 2 + 0.5, rot: srot, margin: 0.1 });
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps;
      const x = lerp(st.x0, st.x1, (t0 + t1) / 2), z = lerp(st.z0, st.z1, (t0 + t1) / 2);
      const y0 = lerp(st.h0, st.h1, t0) - 0.25, y1 = lerp(st.h0, st.h1, t1);
      bs.place(x, 0, z, srot);
      bs.pattern(PAT.STONE, 0);
      bs.box(0, y0, 0, st.w, y1 - y0 + 0.02, (len / steps) * 1.02, i % 2 ? '#a39b8d' : '#9c9486');
    }
    for (const side of [-1, 1]) {
      const nx = uz * side, nz = -ux * side, off = st.w / 2 + 0.2;
      colliders.addWall(st.x0 + nx * off, st.z0 + nz * off, st.x1 + nx * off, st.z1 + nz * off, 0.3, st.h0 - 1, st.h1 + 0.8, 'low');
      // 石阶两侧石灯笼
      for (const t of [0.0, 0.5]) {
        const x = lerp(st.x0, st.x1, t) + nx * (off + 0.7), z = lerp(st.z0, st.z1, t) + nz * (off + 0.7);
        const y = lerp(st.h0, st.h1, t);
        const bl = chunks.at(x, z);
        bl.place(x, y, z, srot);
        stoneLantern(bl, 0.95);
        ctx.lights.push([x, y + 1.3, z, 0.6]);
        colliders.addCircle(x, z, 0.4, y - 1, y + 2);
      }
    }
  }
  // 山门
  {
    const [x, z] = f(0, 26);
    const bg = chunks.at(x, z);
    bg.place(x, top, z, rot);
    bg.pattern(PAT.NONE, 0);
    for (const sx of [-1.6, 1.6]) for (const sz of [-0.8, 0.8]) bg.cylinder(sx, 0, sz, 0.17, 0.19, 3.4, 8, '#5a3d2b');
    bg.box(0, 3.25, 0, 4.0, 0.3, 2.0, '#4a3326');
    gableRoof(bg, 4.2, 2.0, 3.5, 4.8, 0.6, 0.7, '#3d4350', { gable: false });
    for (const sx of [-1.6, 1.6]) {
      const [cx, cz] = f(sx, 26);
      colliders.addCircle(cx, cz, 0.6, top - 1, top + 5);
    }
  }
  // 五重塔
  {
    const [x, z] = f(-2, -2);
    const bp = chunks.at(x, z);
    bp.place(x, top, z, rot);
    bp.pattern(PAT.STONE, 0);
    bp.box(0, -0.3, 0, 9.6, 1.0, 9.6, '#9a9385');
    for (let i = 0; i < 3; i++) bp.box(0, -0.3 + i * 0.22, 5.1 + i * 0.32, 2.6, 0.24, 0.4, '#a39b8d');
    let y = 0.7;
    const tiers = 5;
    for (let t = 0; t < tiers; t++) {
      const half = 3.25 - t * 0.27;
      const h = t === 0 ? 3.1 : 2.25;
      // 墙身：白壁 + 朱柱
      bp.pattern(PAT.PLASTER, 0);
      bp.box(0, y, 0, half * 2 - 0.5, h, half * 2 - 0.5, '#efe9dc');
      bp.pattern(PAT.KOSHI, 0.45);
      for (let k = 0; k < 4; k++) {
        bp.push();
        bp.rotateY((k * Math.PI) / 2);
        const zf = half - 0.25 + 0.02;
        bp.quad([-0.75, y + 0.15, zf], [0.75, y + 0.15, zf], [0.75, y + h - 0.45, zf], [-0.75, y + h - 0.45, zf], VERM_DARK, [[-0.75, y], [0.75, y], [0.75, y + h], [-0.75, y + h]]);
        bp.pop();
      }
      bp.pattern(PAT.NONE, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) bp.box(sx * (half - 0.3), y, sz * (half - 0.3), 0.26, h, 0.26, VERMILION);
      for (const sx of [-1, 1]) {
        bp.box(sx * 0.85, y, half - 0.26, 0.2, h, 0.2, VERMILION);
        bp.box(sx * 0.85, y, -half + 0.26, 0.2, h, 0.2, VERMILION);
        bp.box(half - 0.26, y, sx * 0.85, 0.2, h, 0.2, VERMILION);
        bp.box(-half + 0.26, y, sx * 0.85, 0.2, h, 0.2, VERMILION);
      }
      // 斗拱层（朱红 + 白）
      bp.box(0, y + h, 0, half * 2 + 0.2, 0.28, half * 2 + 0.2, VERMILION);
      bp.box(0, y + h + 0.28, 0, half * 2 + 0.7, 0.22, half * 2 + 0.7, '#efe9dc');
      bp.box(0, y + h + 0.5, 0, half * 2 + 1.2, 0.22, half * 2 + 1.2, VERM_DARK);
      const ry0 = y + h + 0.55, ry1 = ry0 + 1.25;
      pagodaRoof(bp, half, ry0, ry1, 2.0 - t * 0.12, '#3b4049', '#7a3324');
      // 一层回廊（缘）
      if (t === 0) {
        bp.pattern(PAT.PLANK, 0);
        bp.box(0, y - 0.05, 0, half * 2 + 1.3, 0.15, half * 2 + 1.3, '#6b4a33');
      } else {
        bp.pattern(PAT.NONE, 0);
        for (let k = 0; k < 4; k++) {
          bp.push();
          bp.rotateY((k * Math.PI) / 2);
          bp.box(0, y + 0.45, half + 0.25, half * 2 + 0.5, 0.06, 0.06, VERMILION);
          bp.pop();
        }
      }
      y = ry1 - 0.12;
      if (t === tiers - 1) {
        const topH = half - 0.4;
        bp.pattern(PAT.KAWARA, 0);
        bp.box(0, y - 0.05, 0, topH * 2 + 0.1, 0.4, topH * 2 + 0.1, '#3b4049');
        bp.pattern(PAT.NONE, 0);
        bp.cylinder(0, y + 0.35, 0, 0.2, topH * 0.9, 0.55, 4, '#3b4049', { angle0: Math.PI / 4 });
        y += 0.6;
      }
    }
    // 相轮
    bp.pattern(PAT.NONE, 0);
    bp.box(0, y, 0, 1.0, 0.5, 1.0, '#3b4049');
    bp.cylinder(0, y + 0.4, 0, 0.12, 0.14, 7.5, 8, '#6c7a5a');
    for (let i = 0; i < 9; i++) bp.cylinder(0, y + 1.6 + i * 0.5, 0, 0.42 - i * 0.015, 0.42 - i * 0.015, 0.09, 10, '#6c7a5a', { bottom: true });
    bp.cylinder(0, y + 6.2, 0, 0.5, 0.2, 0.25, 10, '#6c7a5a', { bottom: true });
    bp.sphere(0, y + 7.0, 0, 0.3, 8, 6, '#c9a54a');
    bp.sphere(0, y + 7.45, 0, 0.18, 8, 6, '#c9a54a', { sy: 1.4 });
    colliders.addBox(x, z, 4.4, 4.4, rot, top - 1, top + 40);
    ctx.landmarkHeights.pagoda = top + y + 7.6;
    ctx.spots.pagoda = [x, top, z];
    ctx.lights.push([x, top + 1.5, z + 0, 0.0]);
  }
  // 钟楼
  {
    const [x, z] = f(11, 6);
    const bb = chunks.at(x, z);
    bb.place(x, top, z, rot + 0.3);
    bb.pattern(PAT.STONE, 0);
    bb.box(0, -0.2, 0, 5.6, 0.9, 5.6, '#958e81');
    bb.pattern(PAT.NONE, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb.cylinder(sx * 1.9, 0.7, sz * 1.9, 0.16, 0.2, 3.9, 8, '#5a3d2b');
    bb.box(0, 4.4, 0, 4.4, 0.3, 4.4, '#4a3326');
    irimoyaRoof(bb, 4.8, 4.8, 4.7, 7.0, 1.0, '#3d4350', {});
    // 梵钟
    bb.lathe(0, 0, [[0.0, 2.0], [0.72, 2.02], [0.78, 2.2], [0.7, 3.2], [0.6, 3.75], [0.35, 3.95], [0.1, 4.0], [0.0, 4.05]], 18, '#4f6152');
    bb.cylinder(0, 4.0, 0, 0.08, 0.08, 0.45, 6, '#3e4a40');
    // 撞木
    bb.tube([[-2.4, 3.0, 0], [-0.85, 3.0, 0]], 0.13, 8, '#a58a66');
    bb.tube([[-1.9, 3.0, 0], [-1.9, 4.4, 0]], 0.012, 3, '#d9c79a');
    bb.tube([[-1.2, 3.0, 0], [-1.2, 4.4, 0]], 0.012, 3, '#d9c79a');
    colliders.addBox(x, z, 2.8, 2.8, rot + 0.3, top - 1, top + 0.7, 'low');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const c = Math.cos(rot + 0.3), s = Math.sin(rot + 0.3);
      colliders.addCircle(x + sx * 1.9 * c + sz * 1.9 * s, z - sx * 1.9 * s + sz * 1.9 * c, 0.25, top - 1, top + 5);
    }
    ctx.interact.push({ id: 'bell', kind: 'bell', x, y: top + 0.7, z, r: 3.4, label: '撞钟' });
    ctx.spots.bell = [x, top, z];
  }
  // 本堂
  {
    const [x, z] = f(-4, -18);
    const bh = chunks.at(x, z);
    bh.place(x, top, z, rot);
    const W = 13, D = 9;
    bh.pattern(PAT.STONE, 0);
    bh.box(0, -0.2, 0, W + 1.2, 0.8, D + 1.2, '#958e81');
    bh.pattern(PAT.PLANK, 0);
    bh.box(0, 0.6, 0, W + 0.8, 0.16, D + 0.8, '#6b4a33');
    bh.pattern(PAT.PLASTER, 0);
    bh.box(0, 0.75, 0, W, 3.4, D, '#f0ebe0', { faces: 'pxnxnz' });
    bh.pattern(PAT.SHOJI, 0.85);
    bh.quad([-W / 2, 0.75, D / 2], [W / 2, 0.75, D / 2], [W / 2, 4.15, D / 2], [-W / 2, 4.15, D / 2], '#f3ead6', [[-W / 2, 0.75], [W / 2, 0.75], [W / 2, 4.15], [-W / 2, 4.15]]);
    bh.pattern(PAT.NONE, 0);
    for (let i = 0; i <= 5; i++) bh.box(-W / 2 + (i / 5) * W, 0.75, D / 2 + 0.06, 0.24, 3.4, 0.2, '#4a3326');
    bh.box(0, 4.1, 0, W + 0.4, 0.3, D + 0.4, '#4a3326');
    irimoyaRoof(bh, W + 0.6, D + 0.6, 4.4, 4.4 + 4.6, 1.8, '#3b4049', {});
    colliders.addBox(x, z, (W + 1.2) / 2, (D + 1.2) / 2, rot, top - 1, top + 9);
    ctx.lights.push([x, top + 2, z + 4, 0.5]);
  }
  const [sx, sz] = f(5.5, 12);
  ctx.stamps.push({ id: 'temple', name: '花雲寺 五重塔', x: sx, z: sz, y: top, rot: rot });
  for (const [lx, lz] of [[-12, 14], [12, 18], [-14, -4], [15, -10], [-10, 24], [8, 26], [-16, -16], [16, -20], [2, -28]]) {
    const [x, z] = f(lx, lz);
    ctx.treeSpots.push({ x, z, kind: 'sakura', scale: 0.9 + (Math.abs(lx) % 4) * 0.05, y: top, lit: true });
  }
  ctx.noTree.push([S.x, S.z, 14]);
  const [bx, bz] = f(-9, 9);
  addBench(ctx, bx, top, bz, rot - 0.6);
  ctx.spots.templeTop = [S.x, top, S.z, rot];
  ctx.spots.monk = f(9, 9);
}

// ---------------------------------------------------------------- 桥
function riverAt(x, z) {
  const q = riverNearest(x, z);
  return q;
}

// 朱色太鼓桥：轴线垂直于河道
export function buildRedBridge(ctx) {
  const { chunks, colliders } = ctx;
  const q = riverAt(SITES.redBridge.x, SITES.redBridge.z);
  const cx = q.cx, cz = q.cz;
  const nx = q.tz, nz = -q.tx; // 河的法线（东岸方向）
  const rot = Math.atan2(-nz, nx); // 局部 +x 沿桥轴指向东岸
  const bank = bankLevel(q.s);
  const L = 26, W = 3.2, arch = 1.7;
  const yAt = (lx) => bank + 0.08 + arch * (1 - Math.pow(lx / (L / 2), 2));
  const b = chunks.at(cx, cz);
  b.place(cx, 0, cz, rot);
  // 桥面
  b.pattern(PAT.PLANK, 0);
  const N = 16;
  for (let i = 0; i < N; i++) {
    const x0 = -L / 2 + (i / N) * L, x1 = -L / 2 + ((i + 1) / N) * L;
    const y0 = yAt(x0), y1 = yAt(x1);
    b.quad([x0, y0, W / 2], [x1, y1, W / 2], [x1, y1, -W / 2], [x0, y0, -W / 2], '#8a6648', [[x0, -W / 2], [x1, -W / 2], [x1, W / 2], [x0, W / 2]]);
    b.quad([x0, y0 - 0.35, -W / 2], [x1, y1 - 0.35, -W / 2], [x1, y1 - 0.35, W / 2], [x0, y0 - 0.35, W / 2], '#5a2a1d');
    for (const sz of [-1, 1]) {
      const z = (sz * W) / 2;
      if (sz > 0) b.quad([x0, y0 - 0.35, z], [x1, y1 - 0.35, z], [x1, y1, z], [x0, y0, z], VERMILION);
      else b.quad([x1, y1 - 0.35, z], [x0, y0 - 0.35, z], [x0, y0, z], [x1, y1, z], VERMILION);
    }
  }
  // 拱形桥梁与桥墩
  b.pattern(PAT.NONE, 0);
  for (const sz of [-1.2, 1.2]) {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const x = -L / 2 + 1 + (i / 12) * (L - 2);
      pts.push([x, yAt(x) - 0.45 - 0.9 * (1 - Math.pow(x / (L / 2), 2)) * 0.5, sz]);
    }
    b.tube(pts, 0.18, 6, VERM_DARK);
  }
  for (const px of [-4.5, 4.5]) {
    const wl = riverWaterLevel(q.s);
    b.cylinder(px, wl - 1.2, -1.2, 0.2, 0.22, yAt(px) - wl + 0.8, 8, VERM_DARK);
    b.cylinder(px, wl - 1.2, 1.2, 0.2, 0.22, yAt(px) - wl + 0.8, 8, VERM_DARK);
  }
  // 栏杆 + 拟宝珠
  for (const sz of [-1, 1]) {
    const z = sz * (W / 2 - 0.08);
    const top = [], mid = [];
    for (let i = 0; i <= 12; i++) {
      const x = -L / 2 + (i / 12) * L;
      top.push([x, yAt(x) + 0.95, z]);
      mid.push([x, yAt(x) + 0.5, z]);
    }
    b.tube(top, 0.06, 6, VERMILION);
    b.tube(mid, 0.04, 5, VERMILION);
    for (let i = 0; i <= 6; i++) {
      const x = -L / 2 + (i / 6) * L;
      const y = yAt(x);
      b.cylinder(x, y, z, 0.09, 0.09, 1.05, 8, VERMILION);
      if (i === 0 || i === 6 || i === 3) {
        b.cylinder(x, y + 1.05, z, 0.1, 0.1, 0.08, 8, '#c9a54a');
        b.lathe(x, z, [[0.1, y + 1.13], [0.14, y + 1.22], [0.1, y + 1.33], [0.03, y + 1.42], [0, y + 1.47]], 8, '#b89a4a');
      }
    }
  }
  // 可行走表面与栏杆碰撞
  colliders.addSurface(cx, cz, L / 2, W / 2, rot, (lx) => yAt(lx), 'wood');
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const sz of [-1, 1]) {
    const z = sz * (W / 2 + 0.05);
    const ax = cx + (-L / 2) * c + z * s, az = cz - (-L / 2) * s + z * c;
    const bx2 = cx + (L / 2) * c + z * s, bz2 = cz - (L / 2) * s + z * c;
    colliders.addWall(ax, az, bx2, bz2, 0.25, bank - 2, bank + 4);
  }
  const ex = cx + (L / 2 + 1.5) * c, ez = cz - (L / 2 + 1.5) * s;
  ctx.stamps.push({ id: 'redbridge', name: '朱橋', x: ex + nz * 2.6 * 0 + s * 2.6, z: ez + c * 2.6, y: bank, rot: rot + Math.PI / 2 });
  ctx.spots.redBridge = [cx, yAt(0), cz, rot];
  ctx.noTree.push([cx, cz, 6], [cx + (L / 2) * c, cz - (L / 2) * s, 4], [cx - (L / 2) * c, cz + (L / 2) * s, 4]);
  return { cx, cz, rot, L };
}

// 石桥：本通り跨河处，加护栏、拱面与桥面碰撞
export function buildStoneBridge(ctx, roadName = '本通り') {
  const { chunks, colliders } = ctx;
  const road = ROADS.find((r) => r.name === roadName);
  let best = null;
  road.pts.forEach((p, i) => {
    const q = riverNearest(p[0], p[1]);
    if (!best || q.d < best.d) best = { d: q.d, i, q };
  });
  const i = best.i;
  const p = road.pts[i];
  const a = road.pts[Math.max(0, i - 1)], c2 = road.pts[Math.min(road.pts.length - 1, i + 1)];
  const tx = c2[0] - a[0], tz = c2[1] - a[1];
  const rot = Math.atan2(-tz, tx); // 局部 x 沿道路
  const y = road.h[i] + 0.05;
  const L = 24, W = road.width + 1.6;
  const b = chunks.at(p[0], p[1]);
  b.place(p[0], 0, p[1], rot);
  const wl = riverWaterLevel(best.q.s);
  // 桥身两侧（带拱洞轮廓）
  b.pattern(PAT.STONE, 0);
  for (const sz of [-1, 1]) {
    const z = (sz * W) / 2;
    const poly = [];
    poly.push([-L / 2, y - 0.6]);
    const N = 14;
    for (let k = 0; k <= N; k++) {
      const x = -8 + (k / N) * 16;
      poly.push([x, wl + 0.2 + 1.35 * Math.sqrt(Math.max(0, 1 - Math.pow(x / 8, 2)))]);
    }
    poly.push([L / 2, y - 0.6]);
    poly.push([L / 2, y + 0.01]);
    poly.push([-L / 2, y + 0.01]);
    b.push();
    b.translate(0, 0, z);
    b.extrudeXY(poly.map((pp) => [pp[0], Math.min(pp[1], y)]), -0.4, 0.4, '#a29a8c');
    b.pop();
    // 栏杆
    b.box(0, y, z, L, 0.75, 0.32, '#b0a898');
    for (let k = 0; k <= 6; k++) b.box(-L / 2 + (k / 6) * L, y, z, 0.42, 0.95, 0.42, '#a39b8d');
    const c = Math.cos(rot), s = Math.sin(rot);
    colliders.addWall(p[0] + (-L / 2) * c + z * s, p[1] - (-L / 2) * s + z * c, p[0] + (L / 2) * c + z * s, p[1] - (L / 2) * s + z * c, 0.45, y - 3, y + 1);
  }
  ctx.colliders.addSurface(p[0], p[1], L / 2, W / 2, rot, () => y - 0.02, 'stone');
  ctx.spots.stoneBridge = [p[0], y, p[1], rot];
  ctx.noTree.push([p[0], p[1], 8]);
}

// 南边的木桥
export function buildFootBridge(ctx, nearX, nearZ) {
  const { chunks, colliders } = ctx;
  const q = riverNearest(nearX, nearZ);
  const nx = q.tz, nz = -q.tx;
  const rot = Math.atan2(-nz, nx);
  const bank = bankLevel(q.s);
  const L = 25, W = 2.4;
  const yAt = (lx) => bank + 0.1 + 0.7 * (1 - Math.pow(lx / (L / 2), 2));
  const b = chunks.at(q.cx, q.cz);
  b.place(q.cx, 0, q.cz, rot);
  b.pattern(PAT.PLANK, 0);
  const N = 12;
  for (let i = 0; i < N; i++) {
    const x0 = -L / 2 + (i / N) * L, x1 = -L / 2 + ((i + 1) / N) * L;
    b.quad([x0, yAt(x0), W / 2], [x1, yAt(x1), W / 2], [x1, yAt(x1), -W / 2], [x0, yAt(x0), -W / 2], '#9a7b5a', [[x0, -1], [x1, -1], [x1, 1], [x0, 1]]);
    b.quad([x0, yAt(x0) - 0.25, -W / 2], [x1, yAt(x1) - 0.25, -W / 2], [x1, yAt(x1) - 0.25, W / 2], [x0, yAt(x0) - 0.25, W / 2], '#5d4532');
  }
  for (const sz of [-1, 1]) {
    const z = sz * (W / 2 - 0.05);
    const top = [];
    for (let i = 0; i <= 10; i++) {
      const x = -L / 2 + (i / 10) * L;
      top.push([x, yAt(x) + 0.9, z]);
      b.box(x, yAt(x) - 0.1, z, 0.1, 1.0, 0.1, '#5d4532');
    }
    b.tube(top, 0.05, 5, '#6b4f39');
  }
  const wl = riverWaterLevel(q.s);
  for (const px of [-4, 4]) for (const sz of [-1, 1]) b.cylinder(px, wl - 1, sz * 0.9, 0.12, 0.14, yAt(px) - wl + 0.8, 6, '#4f3b2b');
  colliders.addSurface(q.cx, q.cz, L / 2, W / 2, rot, (lx) => yAt(lx), 'wood');
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const sz of [-1, 1]) {
    const z = sz * (W / 2 + 0.05);
    colliders.addWall(q.cx + (-L / 2) * c + z * s, q.cz - (-L / 2) * s + z * c, q.cx + (L / 2) * c + z * s, q.cz - (L / 2) * s + z * c, 0.2, bank - 2, bank + 3);
  }
  ctx.noTree.push([q.cx, q.cz, 5]);
  ctx.spots.footBridge = [q.cx, yAt(0), q.cz, rot];
}

// ---------------------------------------------------------------- 车站
export function buildStation(ctx, terrain) {
  const { chunks, signs, atlas, colliders } = ctx;
  const S = SITES.station;
  // 找到车站附近的轨道点
  let best = null;
  railway.pts.forEach((p, i) => {
    const d = Math.hypot(p[0] - S.x, p[1] - S.z - 10);
    if (!best || d < best.d) best = { d, i };
  });
  const i = best.i;
  const p = railway.pts[i];
  const a = railway.pts[i - 2], c2 = railway.pts[i + 2];
  const tx = (c2[0] - a[0]), tz = (c2[1] - a[1]);
  const tl = Math.hypot(tx, tz);
  const ux = tx / tl, uz = tz / tl;
  const rot = Math.atan2(-uz, ux); // 局部 x 沿轨道
  const railTop = terrain.railHeight(railway.acc[i]);
  // 站台在轨道北侧（-z 方向一侧）
  const nxn = uz, nzn = -ux; // 左法线
  const side = nzn < 0 ? 1 : -1;
  const pnx = nxn * side, pnz = nzn * side; // 指向站台的法线
  const platW = 4.2, platL = 64, platY = railTop + 0.85;
  const pcx = p[0] + pnx * (1.7 + platW / 2), pcz = p[1] + pnz * (1.7 + platW / 2);
  const prot = rot;
  const f = frame(pcx, pcz, prot);
  // 局部 z 正方向：从轨道指向站台外侧？计算局部 +z 的世界方向
  const zSign = (Math.sin(prot) * pnx + Math.cos(prot) * pnz) > 0 ? 1 : -1;
  const b = chunks.at(pcx, pcz);
  b.place(pcx, 0, pcz, prot);
  b.pattern(PAT.NONE, 0);
  b.box(0, platY - 2.5, 0, platL, 2.5, platW, '#a8a49c', { topColor: '#b9b4aa' });
  b.pattern(PAT.STONE, 0);
  b.box(0, platY - 0.02, -zSign * (platW / 2 - 0.35), platL, 0.04, 0.3, '#e8d44a');
  // 站台雨棚
  const roofL = 26;
  b.pattern(PAT.NONE, 0);
  for (let k = 0; k <= 4; k++) b.box(-roofL / 2 + (k / 4) * roofL, platY, zSign * 0.6, 0.18, 3.0, 0.18, '#5f6a73');
  b.box(0, platY + 3.0, zSign * 0.3, roofL + 1, 0.12, 3.2, '#d9d6cf');
  b.pattern(PAT.TIN, 0);
  b.quad([-roofL / 2 - 0.5, platY + 3.12, zSign * 1.9], [roofL / 2 + 0.5, platY + 3.12, zSign * 1.9], [roofL / 2 + 0.5, platY + 3.32, -zSign * 1.3], [-roofL / 2 - 0.5, platY + 3.32, -zSign * 1.3], '#5d7884');
  b.quad([roofL / 2 + 0.5, platY + 3.12, zSign * 1.9], [-roofL / 2 - 0.5, platY + 3.12, zSign * 1.9], [-roofL / 2 - 0.5, platY + 3.32, -zSign * 1.3], [roofL / 2 + 0.5, platY + 3.32, -zSign * 1.3], '#5d7884');
  // 长椅、站名牌、售货机
  for (const lx of [-6, 4]) {
    b.push();
    b.translate(lx, platY, zSign * 1.0);
    b.rotateY(zSign > 0 ? Math.PI : 0);
    bench(b, '#3f6b8a');
    b.pop();
    const [bx, bz] = f(lx, zSign * 1.0);
    ctx.benches.push({ x: bx, z: bz, y: platY, rot: prot + (zSign > 0 ? Math.PI : 0) });
    colliders.addBox(bx, bz, 0.9, 0.35, prot, platY - 0.5, platY + 0.9, 'low');
  }
  ctx.spots.stationBench = f(-6, zSign * 1.0);
  {
    const r = atlas.station('桜川', 'さくらがわ', 'Sakuragawa', 'にしやま', 'ひがしの');
    const lx = 14;
    b.pattern(PAT.NONE, 0);
    b.box(lx - 1.1, platY, zSign * 0.4, 0.1, 2.4, 0.1, '#4c5a63');
    b.box(lx + 1.1, platY, zSign * 0.4, 0.1, 2.4, 0.1, '#4c5a63');
    const sb = signs.at(pcx, pcz);
    sb.place(pcx, 0, pcz, prot);
    sb.translate(lx, platY + 1.75, zSign * 0.4 - 0.04);
    sb.rotateY(Math.PI);
    signQuad(sb, r, 2.2, 0.92, 0xffffff, 0.45, false);
    sb.rotateY(Math.PI);
    sb.translate(0, 0, 0.08);
    signQuad(sb, r, 2.2, 0.92, 0xffffff, 0.45, false);
  }
  {
    b.push();
    b.translate(-12, platY, zSign * 1.55);
    b.rotateY(zSign > 0 ? Math.PI : 0);
    vendingMachine(b, '#e9ecee');
    b.pop();
    const [vx, vz] = f(-12, zSign * 1.55);
    colliders.addBox(vx, vz, 0.55, 0.42, prot, platY - 0.5, platY + 2);
    ctx.interact.push({ id: 'vend-station', kind: 'vending', x: vx - zSign * Math.sin(prot) * 0.0, y: platY, z: vz, r: 1.8, label: '买饮料' });
  }
  colliders.addSurface(pcx, pcz, platL / 2, platW / 2, prot, () => platY, 'stone');
  // 站台边缘（防止掉下轨道的低栏：仅远端）
  {
    const [ex1, ez1] = f(-platL / 2, -zSign * (platW / 2 + 0.05));
    const [ex2, ez2] = f(platL / 2, -zSign * (platW / 2 + 0.05));
    colliders.addWall(ex1, ez1, ex2, ez2, 0.2, platY - 0.2, platY + 0.6, 'low');
    for (const sx of [-1, 1]) {
      const [cx1, cz1] = f(sx * platL / 2, -zSign * platW / 2);
      const [cx2, cz2] = f(sx * platL / 2, zSign * platW / 2);
      colliders.addWall(cx1, cz1, cx2, cz2, 0.2, platY - 0.2, platY + 1.2, 'low');
    }
  }
  // 站房（在站台外侧，地面高度 → 站台高度坡道）
  const outZ = zSign * (platW / 2 + 4.0);
  const [hx, hz] = f(2, outZ);
  const ground = terrain.heightAt(hx, hz);
  {
    const W = 11, D = 7;
    b.push();
    b.translate(2, 0, outZ);
    b.rotateY(zSign > 0 ? 0 : Math.PI);
    // 地面到站台的地坪
    b.pattern(PAT.STONE, 0);
    b.box(0, ground - 0.5, 0, W + 0.6, platY - ground + 0.48, D + 0.6, '#a59f93');
    b.pattern(PAT.PLANK, 0);
    b.box(0, platY, 0, W, 3.0, D, '#efe6d2', { faces: 'pxnx', ao: 0.05 });
    b.box(0, platY, 0, W, 1.0, D + 0.02, '#6b4a33', { faces: 'pxnx' });
    // 前后墙留出门洞
    for (const sz of [-1, 1]) {
      for (const sx of [-1, 1]) b.box(sx * (W / 4 + 0.9), platY, (sz * D) / 2, W / 2 - 1.8, 3.0, 0.16, '#efe6d2');
      b.box(0, platY + 2.4, (sz * D) / 2, 3.6, 0.6, 0.16, '#efe6d2');
    }
    b.pattern(PAT.WINDOW, 0.9);
    for (const sx of [-1, 1]) {
      b.quad([sx * 3.6 - 0.7, platY + 1.1, D / 2 + 0.1], [sx * 3.6 + 0.7, platY + 1.1, D / 2 + 0.1], [sx * 3.6 + 0.7, platY + 2.2, D / 2 + 0.1], [sx * 3.6 - 0.7, platY + 2.2, D / 2 + 0.1], '#e9e6df', [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    hipRoof(b, W + 0.4, D + 0.4, platY + 3.0, platY + 5.2, 0.8, '#41566a');
    b.pop();
    // 站名招牌
    const sb = signs.at(hx, hz);
    sb.place(hx, 0, hz, prot + (zSign > 0 ? 0 : Math.PI));
    sb.translate(0, platY + 3.25, D / 2 + 0.95);
    signQuad(sb, atlas.board('桜川駅', { bg: '#2b2620', fg: '#f6e8c8', px: 80 }), 2.6, 0.62, 0xffffff, 0.7, false);
    // 坡道：从地面到站台（穿过站房）
    const rampLen = D + 7;
    colliders.addSurface(hx, hz, W / 2 - 0.4, D / 2 + 0.9, prot, () => platY, 'wood');
    const [rx, rz] = f(2, outZ + zSign * (D / 2 + 3.2));
    colliders.addSurface(rx, rz, 1.8, 3.0, prot, (lx, lz) => lerp(platY, ground + 0.02, clamp((lz * zSign + 3.0) / 6.0, 0, 1)), 'stone');
    b.push();
    b.translate(2, 0, outZ + zSign * (D / 2 + 3.2));
    b.pattern(PAT.STONE, 0);
    const N = 8;
    for (let k = 0; k < N; k++) {
      const t0 = k / N, t1 = (k + 1) / N;
      const z0 = (-3 + t0 * 6) * zSign, z1 = (-3 + t1 * 6) * zSign;
      const y0 = lerp(platY, ground + 0.02, t0), y1 = lerp(platY, ground + 0.02, t1);
      b.box(0, Math.min(y0, y1) - 0.4, (z0 + z1) / 2, 3.6, Math.abs(y1 - y0) + 0.42, Math.abs(z1 - z0) + 0.02, '#a8a092');
    }
    b.pop();
    // 站房墙体碰撞（左右两侧墙 + 前后墙两段）
    const c = Math.cos(prot), s = Math.sin(prot);
    const loc = (lx, lz) => [hx + lx * c + lz * s, hz - lx * s + lz * c];
    for (const sx of [-1, 1]) {
      const [wx, wz] = loc(sx * W / 2, 0);
      colliders.addBox(wx, wz, 0.15, D / 2, prot, platY - 0.5, platY + 3);
      for (const sz of [-1, 1]) {
        const [qx, qz] = loc(sx * (W / 4 + 0.9), (sz * D) / 2);
        colliders.addBox(qx, qz, W / 4 - 0.9, 0.12, prot, platY - 0.5, platY + 3);
      }
    }
    const [stx, stz] = loc(-3.6, 0);
    ctx.stamps.push({ id: 'station', name: '桜川駅', x: stx, z: stz, y: platY, rot: prot + Math.PI / 2 });
    ctx.lights.push([hx, platY + 2.6, hz, 0.8]);
    ctx.spots.stationAttendant = loc(2.5, 0);
    ctx.stationPlatY = platY;
  }
  // 站前广场（石板铺装）
  {
    const [qx, qz] = f(-4, outZ + zSign * 7.5);
    const bq = chunks.at(qx, qz);
    const gy = terrain.heightAt(qx, qz);
    bq.place(qx, gy, qz, prot);
    bq.pattern(PAT.STONE, 0);
    bq.box(0, -0.4, 0, 34, 0.47, 10, '#b5ad9f', { topColor: '#bdb5a7' });
    ctx.colliders.addSurface(qx, qz, 17, 5, prot, () => gy + 0.07, 'stone');
  }
  // 自行车停车场
  {
    const rng = new RNG(31);
    const cols = ['#d8d4cc', '#7a9ab8', '#c94f4f', '#e3c46a', '#5f8f6a', '#2f3135', '#e7a3b4'];
    for (let k = 0; k < 12; k++) {
      const [x, z] = f(-18 + k * 0.75, outZ + zSign * 3.5);
      const bb = chunks.at(x, z);
      bb.place(x, terrain.heightAt(x, z), z, prot + Math.PI / 2 + rng.float(-0.06, 0.06));
      bicycle(bb, rng.pick(cols));
    }
    const [x0, z0] = f(-14, outZ + zSign * 3.5);
    colliders.addBox(x0, z0, 4.6, 0.7, prot, -10, 30);
  }
  // 邮筒
  {
    const [x, z] = f(-6, outZ + zSign * 4.5);
    const bp = chunks.at(x, z);
    bp.place(x, terrain.heightAt(x, z), z, prot);
    postbox(bp);
    colliders.addCircle(x, z, 0.3, -10, 30);
  }
  ctx.noTree.push([pcx, pcz, 34]);
  ctx.station = { pcx, pcz, prot, platY, railTop, s: railway.acc[i], zSign, platL };
  return ctx.station;
}

// ---------------------------------------------------------------- 学校
export function buildSchool(ctx) {
  const { chunks, signs, atlas, colliders } = ctx;
  const S = SITES.school;
  const top = S.top;
  const rot = 0; // 正面朝南（+z）
  const b = chunks.at(S.x, S.z - 24);
  const bx = S.x, bz = S.z - 26;
  b.place(bx, top, bz, rot);
  const W = 58, D = 11, floors = 3, fh = 3.4;
  b.pattern(PAT.NONE, 0);
  b.box(0, -0.4, 0, W + 0.4, 0.6, D + 0.4, '#b4b0a8');
  b.pattern(PAT.PLASTER, 0);
  b.box(0, 0.2, 0, W, floors * fh + 0.6, D, '#efece4', { ao: 0.06 });
  // 楼层腰线
  b.pattern(PAT.NONE, 0);
  for (let fl = 1; fl <= floors; fl++) b.box(0, 0.2 + fl * fh - 0.1, D / 2 + 0.05, W + 0.1, 0.18, 0.4, '#d9d5cc');
  // 窗户（正面成排）
  for (let fl = 0; fl < floors; fl++)
    for (let k = 0; k < 18; k++) {
      const x = -W / 2 + 2.2 + k * ((W - 4.4) / 17);
      if (Math.abs(x) < 3.5) continue;
      b.pattern(PAT.WINDOW, (k + fl) % 3 === 0 ? 0.7 : 0);
      const y = 0.2 + fl * fh + 0.95;
      b.quad([x - 1.25, y, D / 2 + 0.03], [x + 1.25, y, D / 2 + 0.03], [x + 1.25, y + 1.75, D / 2 + 0.03], [x - 1.25, y + 1.75, D / 2 + 0.03], '#9fa8ad', [[0, 0], [1, 0], [1, 1], [0, 1]]);
      b.pattern(PAT.WINDOW, 0);
      b.quad([x + 1.25, y, -D / 2 - 0.03], [x - 1.25, y, -D / 2 - 0.03], [x - 1.25, y + 1.75, -D / 2 - 0.03], [x + 1.25, y + 1.75, -D / 2 - 0.03], '#9fa8ad', [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  // 中央钟楼
  b.pattern(PAT.PLASTER, 0);
  b.box(0, 0.2, 0.4, 6.4, floors * fh + 3.2, D + 0.8, '#f3f1ea');
  b.pattern(PAT.NONE, 0);
  b.cylinder(0, floors * fh + 1.2, D / 2 + 0.82, 1.15, 1.15, 0.12, 20, '#2f3a44', { angle0: 0 });
  b.push();
  b.translate(0, floors * fh + 1.85, D / 2 + 0.85);
  b.rotateX(Math.PI / 2);
  b.cylinder(0, 0, 0, 1.0, 1.0, 0.06, 24, '#f7f5ee');
  b.box(0, 0.06, 0.25, 0.08, 0.04, 0.6, '#222');
  b.box(0.2, 0.06, 0, 0.45, 0.04, 0.07, '#222');
  b.pop();
  // 门廊与入口
  b.box(0, 0.2, D / 2 + 1.6, 6.4, 0.25, 3.2, '#cfcac0');
  b.box(0, 3.0, D / 2 + 1.6, 6.8, 0.3, 3.4, '#e4e0d8');
  for (const sx of [-1, 1]) b.box(sx * 3.0, 0.2, D / 2 + 3.0, 0.3, 2.8, 0.3, '#d9d5cc');
  b.pattern(PAT.WINDOW, 0.6);
  b.quad([-2.2, 0.45, D / 2 + 0.04], [2.2, 0.45, D / 2 + 0.04], [2.2, 2.9, D / 2 + 0.04], [-2.2, 2.9, D / 2 + 0.04], '#8f9aa0', [[0, 0], [1, 0], [1, 1], [0, 1]]);
  // 屋顶护栏
  b.pattern(PAT.NONE, 0);
  const ry = 0.2 + floors * fh + 0.6;
  for (const [x, z, w, d] of [[0, D / 2 - 0.1, W, 0.08], [0, -D / 2 + 0.1, W, 0.08], [W / 2 - 0.1, 0, 0.08, D], [-W / 2 + 0.1, 0, 0.08, D]]) b.box(x, ry, z, w, 1.1, d, '#7f8a8f', { faces: 'pxnxpznzpy' });
  colliders.addBox(bx, bz + 0.5, W / 2 + 0.2, D / 2 + 1.0, 0, top - 1, top + 16);
  colliders.addBox(bx, bz + D / 2 + 3.0, 3.2, 0.3, 0, top - 1, top + 3.2, 'low');
  // 体育馆
  {
    const gx = S.x + 34, gz = S.z + 2;
    const bg = chunks.at(gx, gz);
    bg.place(gx, top, gz, Math.PI / 2);
    const GW = 30, GD = 20, GH = 7;
    bg.pattern(PAT.PLASTER, 0);
    bg.box(0, -0.2, 0, GW, GH, GD, '#e6e2d9', { ao: 0.06 });
    for (let k = 0; k < 6; k++) {
      bg.pattern(PAT.WINDOW, 0);
      const x = -GW / 2 + 3 + k * 4.8;
      bg.quad([x - 1.4, 4.2, GD / 2 + 0.03], [x + 1.4, 4.2, GD / 2 + 0.03], [x + 1.4, 6.0, GD / 2 + 0.03], [x - 1.4, 6.0, GD / 2 + 0.03], '#9fa8ad', [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    bg.pattern(PAT.TIN, 0);
    bg.surface((u, v) => {
      const a = lerp(-1.05, 1.05, v);
      return [lerp(-GW / 2 - 0.4, GW / 2 + 0.4, u), GH - 0.2 + Math.cos(a) * 3.2 - Math.cos(1.05) * 3.2, Math.sin(a) * (GD / 2 + 0.5) / Math.sin(1.05)];
    }, 6, 10, '#5a7f8c', { uvFn: (u, v) => [lerp(-GW / 2, GW / 2, u), v * 12], flip: true, doubleSided: true, backColor: '#8a8f92' });
    colliders.addBox(gx, gz, GD / 2 + 0.3, GW / 2 + 0.3, 0, top - 1, top + 11);
  }
  // 操场：白线、足球门、旗杆、单杠
  {
    const yx = S.x + 4, yz = S.z + 12;
    const by = chunks.at(yx, yz);
    by.place(yx, top + 0.03, yz, 0);
    by.pattern(PAT.NONE, 0);
    const N = 40;
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
      const r1 = 22, r2 = 10, w = 0.12;
      const P = (a, r) => [Math.cos(a) * r, 0.02, Math.sin(a) * r * (r2 / r1)];
      const o0 = P(a0, r1 + w), o1 = P(a1, r1 + w), i0 = P(a0, r1 - w), i1 = P(a1, r1 - w);
      by.quad(i0, o0, o1, i1, '#f2efe6');
    }
    for (const sx of [-1, 1]) {
      by.push();
      by.translate(sx * 17, 0, 0);
      for (const sz of [-1.8, 1.8]) by.cylinder(0, 0, sz, 0.05, 0.05, 2.1, 6, '#f0f0f0');
      by.tube([[0, 2.1, -1.8], [0, 2.1, 1.8]], 0.05, 5, '#f0f0f0');
      by.pop();
    }
    by.cylinder(-26, 0, -12, 0.06, 0.08, 9, 6, '#d9d9d9');
    by.box(-25.4, 7.6, -12, 1.2, 0.8, 0.03, '#f4f4f4');
    by.sphere(-25.4, 8.0, -11.98, 0.22, 10, 6, '#d23a2c', { sz: 0.1 });
    colliders.addCircle(yx - 26, yz - 12, 0.15, -10, 40);
  }
  // 校门 + 门牌
  {
    const gx = S.x - 38, gz = S.z - 4;
    const bg = chunks.at(gx, gz);
    bg.place(gx, top, gz, Math.PI / 2);
    bg.pattern(PAT.NONE, 0);
    for (const sx of [-1, 1]) bg.box(sx * 3.4, -0.2, 0, 0.8, 2.2, 0.8, '#bdb8ae');
    const sb = signs.at(gx, gz);
    sb.place(gx, top, gz, Math.PI / 2);
    sb.translate(3.4, 1.2, 0.41);
    signQuad(sb, atlas.board('桜川町立桜川中学校', { vertical: true, bg: '#e9e4d8', fg: '#2a2622', px: 56, border: '#9b958a' }), 0.42, 1.7, 0xffffff, 0.1, false);
    for (const sx of [-1, 1]) {
      const c = Math.cos(Math.PI / 2), s = Math.sin(Math.PI / 2);
      colliders.addCircle(gx + sx * 3.4 * c, gz - sx * 3.4 * s, 0.55, -10, 40);
    }
    ctx.stamps.push({ id: 'school', name: '桜川中学校', x: gx + 1.5, z: gz + 5.2, y: top, rot: Math.PI });
  }
  // 校园樱花
  const rng = new RNG(808);
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * Math.PI * 2 + rng.float(-0.06, 0.06);
    const x = S.x + Math.cos(a) * 44, z = S.z + Math.sin(a) * 38;
    if (Math.abs(x - (S.x - 38)) < 6 && Math.abs(z - (S.z - 4)) < 8) continue;
    ctx.treeSpots.push({ x, z, kind: 'sakura', scale: rng.float(0.85, 1.05), y: null, lit: false });
  }
  ctx.noTree.push([S.x, S.z - 20, 34], [S.x + 4, S.z + 12, 26], [S.x + 34, S.z + 2, 20]);
  ctx.spots.school = [S.x, top, S.z];
  addBench(ctx, S.x - 22, top, S.z + 26, Math.PI);
}

// ---------------------------------------------------------------- 公园
export function buildPark(ctx, terrain) {
  const { chunks, colliders } = ctx;
  const P = SITES.park;
  const rng = new RNG(1234);
  // 游乐设施：秋千、滑梯、沙坑
  const px = P.x + 18, pz = P.z + 12;
  const y = terrain.heightAt(px, pz);
  const b = chunks.at(px, pz);
  b.place(px, y, pz, 0.3);
  b.pattern(PAT.NONE, 0);
  // 秋千
  for (const sx of [-1.6, 1.6]) {
    b.tube([[sx, 0, -1.2], [sx, 2.5, 0], [sx, 0, 1.2]], 0.06, 5, '#d24b3a');
  }
  b.tube([[-1.7, 2.5, 0], [1.7, 2.5, 0]], 0.07, 6, '#d24b3a');
  for (const sx of [-0.7, 0.7]) {
    b.tube([[sx - 0.2, 2.45, 0], [sx - 0.2, 0.55, 0]], 0.01, 3, '#777');
    b.tube([[sx + 0.2, 2.45, 0], [sx + 0.2, 0.55, 0]], 0.01, 3, '#777');
    b.box(sx, 0.5, 0, 0.5, 0.05, 0.22, '#e9b33f');
  }
  colliders.addBox(px, pz, 1.8, 1.3, 0.3, y - 1, y + 2.6);
  // 滑梯
  b.push();
  b.translate(6, 0, 1);
  b.box(0, 0, 0, 1.2, 2.0, 1.2, '#4b8ac2', { faces: 'pxnxpznzpy' });
  b.surface((u, v) => [lerp(-0.45, 0.45, u), 2.0 - v * 1.95, 0.6 + v * 3.4], 2, 6, '#e8c84a', { flip: false, doubleSided: true });
  b.pop();
  const c = Math.cos(0.3), s = Math.sin(0.3);
  colliders.addBox(px + 6 * c + 1 * s, pz - 6 * s + 1 * c, 0.7, 0.7, 0.3, y - 1, y + 2.2);
  // 沙坑
  b.box(-5, -0.05, 2, 4, 0.18, 3, '#cdb48a', { topColor: '#e3cfa4' });
  {
    const c0 = Math.cos(0.3), s0 = Math.sin(0.3);
    ctx.noGrass.push({ x: px - 5 * c0 + 2 * s0, z: pz + 5 * s0 + 2 * c0, hw: 2, hd: 1.5, rot: 0.3 });
  }
  // 东屋（凉亭）
  const gx = P.x - 16, gz = P.z - 10;
  const gy = terrain.heightAt(gx, gz);
  const bg = chunks.at(gx, gz);
  bg.place(gx, gy, gz, 0.6);
  bg.pattern(PAT.NONE, 0);
  bg.box(0, -0.2, 0, 4.6, 0.35, 4.6, '#b6ae9f');
  ctx.noGrass.push({ x: gx, z: gz, hw: 2.3, hd: 2.3, rot: 0.6 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bg.box(sx * 1.9, 0, sz * 1.9, 0.18, 2.6, 0.18, '#6b4a33');
  hipRoof(bg, 4.4, 4.4, 2.6, 3.9, 0.5, '#5b4a3e', {});
  bg.push();
  bg.translate(0, 0, -1.4);
  bench(bg, '#7a5a40');
  bg.pop();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cc = Math.cos(0.6), ss = Math.sin(0.6);
    colliders.addCircle(gx + sx * 1.9 * cc + sz * 1.9 * ss, gz - sx * 1.9 * ss + sz * 1.9 * cc, 0.2, gy - 1, gy + 3);
  }
  const bc = Math.cos(0.6), bs = Math.sin(0.6);
  ctx.benches.push({ x: gx + (-1.4) * bs, z: gz + (-1.4) * bc, y: gy, rot: 0.6 });
  // 赏花野餐垫（蓝色）
  ctx.hanami = [];
  for (const [hx, hz, r] of [[P.x - 4, P.z + 8, 0.2], [P.x + 8, P.z - 12, -0.5], [P.x - 20, P.z + 14, 1.0]]) {
    const hy = terrain.heightAt(hx, hz) + 0.03;
    const bh = chunks.at(hx, hz);
    bh.place(hx, hy, hz, r);
    bh.pattern(PAT.NONE, 0);
    bh.box(0, 0, 0, 3.2, 0.02, 2.6, '#3f7fc4');
    bh.box(0.2, 0.02, 0.1, 0.5, 0.12, 0.35, '#c8352a');
    bh.box(0.2, 0.14, 0.1, 0.48, 0.03, 0.33, '#2a2a2a');
    bh.box(-0.6, 0.02, -0.3, 0.32, 0.1, 0.32, '#e8d8b8');
    bh.cylinder(0.9, 0.02, -0.5, 0.06, 0.06, 0.25, 6, '#5c8a3a');
    bh.cylinder(1.05, 0.02, -0.45, 0.04, 0.05, 0.12, 6, '#f2f2f2');
    ctx.hanami.push({ x: hx, z: hz, y: hy, rot: r });
    ctx.noGrass.push({ x: hx, z: hz, hw: 1.6, hd: 1.3, rot: r, margin: 0.12 });
  }
  // 公园樱花
  for (let k = 0; k < 16; k++) {
    const x = rng.float(26, 90), z = rng.float(-84, -24);
    if (Math.hypot(x - px, z - pz) < 9 || Math.hypot(x - gx, z - gz) < 6) continue;
    ctx.treeSpots.push({ x, z, kind: 'sakura', scale: rng.float(0.9, 1.15), y: null, lit: rng.chance(0.3) });
  }
  ctx.noTree.push([px, pz, 8], [gx, gz, 5]);
  for (const h of ctx.hanami) ctx.noTree.push([h.x, h.z, 2.2]);
  // 售货机
  const vx = P.x + 30, vz = P.z + 30;
  const vy = terrain.heightAt(vx, vz);
  const bv = chunks.at(vx, vz);
  bv.place(vx, vy, vz, Math.PI);
  vendingMachine(bv, '#c94f43');
  colliders.addBox(vx, vz, 0.55, 0.42, Math.PI, vy - 1, vy + 2);
  ctx.interact.push({ id: 'vend-park', kind: 'vending', x: vx, y: vy, z: vz - 0.9, r: 1.8, label: '买饮料' });
  ctx.spots.park = [P.x, terrain.heightAt(P.x, P.z), P.z];
}

// ---------------------------------------------------------------- 湖畔栈桥
export function buildLakePier(ctx, terrain) {
  const { chunks, colliders } = ctx;
  const L = SITES.lake;
  // 从湖心指向西北的方向
  const ang = Math.atan2(-58, -32);
  const ex = Math.cos(ang), ez = Math.sin(ang);
  const R = lakeShoreRadius(L.x + ex * 60, L.z + ez * 60);
  const sx = L.x + ex * (R + 5), sz = L.z + ez * (R + 5);
  const rot = Math.atan2(-ex, -ez); // 局部 +z 指向湖心
  const y = WORLD.lakeLevel + 1.05;
  const len = 30;
  const f = frame(sx, sz, rot);
  const b = chunks.at(sx, sz);
  b.place(sx, 0, sz, rot);
  b.pattern(PAT.PLANK, 0);
  b.box(0, y - 0.2, len / 2, 2.8, 0.2, len, '#8f7356', { topColor: '#9d8061' });
  b.box(0, y - 0.2, len + 3, 7, 0.2, 6, '#8f7356', { topColor: '#9d8061' });
  b.pattern(PAT.NONE, 0);
  for (let k = 0; k <= 10; k++) {
    const z = (k / 10) * len;
    for (const sx2 of [-1.3, 1.3]) b.cylinder(sx2, WORLD.lakeLevel - 2, z, 0.1, 0.12, y - WORLD.lakeLevel + 1.0, 6, '#5d4532');
  }
  for (const [px, pz] of [[-3.3, len], [3.3, len], [-3.3, len + 6], [3.3, len + 6]]) b.cylinder(px, WORLD.lakeLevel - 2, pz, 0.12, 0.14, y - WORLD.lakeLevel + 1.0, 6, '#5d4532');
  // 栏杆
  const rail = (pts) => b.tube(pts.map(([a, c2]) => [a, y + 0.9, c2]), 0.04, 4, '#6b4f39');
  rail([[-1.3, 2], [-1.3, len]]);
  rail([[1.3, 2], [1.3, len]]);
  rail([[-1.3, len], [-3.4, len], [-3.4, len + 6], [3.4, len + 6], [3.4, len], [1.3, len]]);
  colliders.addSurface(...f(0, len / 2), 1.4, len / 2, rot, () => y, 'wood');
  colliders.addSurface(...f(0, len + 3), 3.5, 3, rot, () => y, 'wood');
  for (const [a, c2, d, e] of [[-1.4, 2, -1.4, len], [1.4, 2, 1.4, len], [-1.4, len, -3.5, len], [1.4, len, 3.5, len], [-3.5, len, -3.5, len + 6.1], [3.5, len, 3.5, len + 6.1], [-3.5, len + 6.1, 3.5, len + 6.1]]) {
    const [x1, z1] = f(a, c2), [x2, z2] = f(d, e);
    colliders.addWall(x1, z1, x2, z2, 0.2, y - 3, y + 1.1);
  }
  // 长椅
  {
    const [bx, bz] = f(0, len + 4.6);
    b.push();
    b.translate(0, y, len + 4.6);
    b.rotateY(Math.PI);
    bench(b, '#6b4f39');
    b.pop();
    ctx.benches.push({ x: bx, z: bz, y, rot: rot + Math.PI });
  }
  const [stx, stz] = f(2.4, -1.5);
  ctx.stamps.push({ id: 'lake', name: '鏡湖', x: stx, z: stz, y: terrain.heightAt(stx, stz), rot: rot });
  ctx.spots.pierEnd = [...f(0, len + 2), y];
  ctx.spots.pierStart = [...f(0, 1), y];
  ctx.noTree.push([sx, sz, 5]);
  // 小船
  ctx.boats = [];
  for (const [lx, lz, r] of [[6, 10, 0.4], [7.5, 13, 0.2]]) {
    const [x, z] = f(lx, lz);
    ctx.boats.push({ x, z, rot: rot + r });
  }
}

// ---------------------------------------------------------------- 千年桜
export function buildAncientSite(ctx, terrain) {
  const { chunks, signs, atlas, colliders } = ctx;
  const A = SITES.ancient;
  const y = terrain.heightAt(A.x, A.z);
  const b = chunks.at(A.x, A.z);
  b.place(A.x, 0, A.z, 0);
  // 竹篱笆围栏（八角形）
  b.pattern(PAT.BAMBOO, 0);
  const R = 6.2, N = 10;
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
    if (k === 7) continue; // 留一个开口
    const x0 = A.x + Math.cos(a0) * R, z0 = A.z + Math.sin(a0) * R;
    const x1 = A.x + Math.cos(a1) * R, z1 = A.z + Math.sin(a1) * R;
    const y0 = terrain.heightAt(x0, z0), y1 = terrain.heightAt(x1, z1);
    b.tube([[x0 - A.x, y0 + 0.7, z0 - A.z], [x1 - A.x, y1 + 0.7, z1 - A.z]], 0.035, 5, '#b49a62');
    b.tube([[x0 - A.x, y0 + 0.35, z0 - A.z], [x1 - A.x, y1 + 0.35, z1 - A.z]], 0.03, 5, '#b49a62');
    b.cylinder(x0 - A.x, y0 - 0.1, z0 - A.z, 0.05, 0.05, 0.95, 6, '#9c8352');
    colliders.addWall(x0, z0, x1, z1, 0.25, y0 - 2, y0 + 0.9, 'low');
  }
  // 石碑
  const mx = A.x + 3, mz = A.z + 8.5;
  const my = terrain.heightAt(mx, mz);
  b.pattern(PAT.STONE, 0);
  b.box(mx - A.x, my - 0.2, mz - A.z, 1.4, 0.4, 0.9, '#8f897e');
  b.pattern(PAT.NONE, 0);
  b.box(mx - A.x, my + 0.2, mz - A.z, 0.8, 1.7, 0.32, '#77736b');
  const sb = signs.at(mx, mz);
  sb.place(mx, my + 1.1, mz + 0.17, 0);
  signQuad(sb, atlas.board('千年桜', { vertical: true, bg: '#6d6962', fg: '#efe9dc', px: 72, border: '#5d5a54' }), 0.5, 1.25, 0xffffff, 0, false);
  colliders.addBox(mx, mz, 0.7, 0.45, 0, my - 1, my + 2);
  // 小祠
  const hx = A.x - 7.5, hz = A.z + 3;
  const hy = terrain.heightAt(hx, hz);
  b.pattern(PAT.STONE, 0);
  b.box(hx - A.x, hy - 0.2, hz - A.z, 1.4, 0.8, 1.4, '#8f897e');
  b.pattern(PAT.PLANK, 0);
  b.push();
  b.translate(hx - A.x, hy + 0.6, hz - A.z);
  b.rotateY(0.9);
  b.box(0, 0, 0, 0.9, 0.9, 0.8, '#7a5a40');
  gableRoof(b, 0.9, 0.8, 0.9, 1.3, 0.2, 0.25, '#3e4350', { gableColor: '#7a5a40' });
  b.pattern(PAT.NONE, 0);
  b.box(0, 0.25, 0.41, 0.5, 0.5, 0.02, '#c9b07a');
  b.pop();
  colliders.addCircle(hx, hz, 0.9, hy - 1, hy + 2);
  ctx.treeSpots.push({ x: A.x, z: A.z, kind: 'ancient', scale: 1, y });
  ctx.noTree.push([A.x, A.z, 18]);
  ctx.stamps.push({ id: 'ancient', name: '千年桜', x: A.x - 2.5, z: A.z + 9.5, y: terrain.heightAt(A.x - 2.5, A.z + 9.5), rot: 0.2 });
  addBench(ctx, A.x + 7.5, terrain.heightAt(A.x + 7.5, A.z + 6.5), A.z + 6.5, -2.3);
  ctx.interact.push({ id: 'gaze', kind: 'gaze', x: A.x + 1.5, y, z: A.z + 7.0, r: 3.2, label: '仰望千年桜' });
  colliders.addCircle(A.x, A.z, 1.6, y - 1, y + 6);
  ctx.spots.ancient = [A.x, y, A.z];
}

// ---------------------------------------------------------------- 商店街御朱印台
export function buildShotengaiStamp(ctx, terrain) {
  const x = 86, z = 12.2;
  ctx.stamps.push({ id: 'shotengai', name: '本通り商店街', x, z, y: terrain.heightAt(x, z), rot: Math.PI });
}
