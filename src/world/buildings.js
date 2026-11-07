import { PAT, C, vary, mulColor, mixColor } from '../render/builder.js';
import { gableRoof, hipRoof, irimoyaRoof, leanTo } from './roofs.js';
import { signQuad } from './textures.js';
import { lanternGeometry } from './roads.js';
import {
  ROADS, riverNearest, riverHalfWidth, railQuery, excluded, SITES,
} from './layout.js';
import { RNG, pointAt, obbOverlap, clamp, lerp } from '../core/math.js';

// ---------- 小部件 ----------
// 墙面上的窗：face ∈ pz nz px nx；(a, y) 为窗中心在墙面上的横向坐标与底边高度
function windowOn(b, face, wallPos, a, y, w, h, lit, frame = '#e9e6df') {
  const o = 0.03;
  b.pattern(PAT.WINDOW, lit);
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  let p;
  if (face === 'pz') p = [[a - w / 2, y, wallPos + o], [a + w / 2, y, wallPos + o], [a + w / 2, y + h, wallPos + o], [a - w / 2, y + h, wallPos + o]];
  else if (face === 'nz') p = [[a + w / 2, y, wallPos - o], [a - w / 2, y, wallPos - o], [a - w / 2, y + h, wallPos - o], [a + w / 2, y + h, wallPos - o]];
  else if (face === 'px') p = [[wallPos + o, y, a + w / 2], [wallPos + o, y, a - w / 2], [wallPos + o, y + h, a - w / 2], [wallPos + o, y + h, a + w / 2]];
  else p = [[wallPos - o, y, a - w / 2], [wallPos - o, y, a + w / 2], [wallPos - o, y + h, a + w / 2], [wallPos - o, y + h, a - w / 2]];
  b.quad(p[0], p[1], p[2], p[3], frame, uv);
  // 窗台
  b.pattern(PAT.NONE, 0);
  const sd = 0.12;
  if (face === 'pz') b.box(a, y - 0.06, wallPos + sd / 2, w + 0.12, 0.06, sd, frame);
  else if (face === 'nz') b.box(a, y - 0.06, wallPos - sd / 2, w + 0.12, 0.06, sd, frame);
  else if (face === 'px') b.box(wallPos + sd / 2, y - 0.06, a, sd, 0.06, w + 0.12, frame);
  else b.box(wallPos - sd / 2, y - 0.06, a, sd, 0.06, w + 0.12, frame);
}

// 墙面上的贴面矩形（门、格子窗、障子）
function panelOn(b, face, wallPos, a, y, w, h, color, pat = PAT.NONE, emis = 0, metric = true) {
  const o = 0.025;
  b.pattern(pat, emis);
  let p;
  if (face === 'pz') p = [[a - w / 2, y, wallPos + o], [a + w / 2, y, wallPos + o], [a + w / 2, y + h, wallPos + o], [a - w / 2, y + h, wallPos + o]];
  else if (face === 'nz') p = [[a + w / 2, y, wallPos - o], [a - w / 2, y, wallPos - o], [a - w / 2, y + h, wallPos - o], [a + w / 2, y + h, wallPos - o]];
  else if (face === 'px') p = [[wallPos + o, y, a + w / 2], [wallPos + o, y, a - w / 2], [wallPos + o, y + h, a - w / 2], [wallPos + o, y + h, a + w / 2]];
  else p = [[wallPos - o, y, a - w / 2], [wallPos - o, y, a + w / 2], [wallPos - o, y + h, a + w / 2], [wallPos - o, y + h, a - w / 2]];
  const uv = metric ? [[a - w / 2, y], [a + w / 2, y], [a + w / 2, y + h], [a - w / 2, y + h]] : [[0, 0], [1, 0], [1, 1], [0, 1]];
  b.quad(p[0], p[1], p[2], p[3], color, uv);
  b.pattern(PAT.NONE, 0);
}

// ---------- 商店目录 ----------
export const SHOPS = [
  { id: 'wagashi', name: '和菓子 桜屋', noren: '菓', bg: '#7b2d3b', board: '桜餅', bench: true, owner: 'okami' },
  { id: 'tea', name: '茶舗 緑風', noren: '茶', bg: '#2f4f3a', board: '宇治茶' },
  { id: 'books', name: '古書 月見堂', noren: '本', bg: '#2a3550', board: '古本' },
  { id: 'flower', name: '花屋', noren: '花', bg: '#c45a7a', board: '生花' },
  { id: 'ramen', name: 'らーめん', noren: 'ら', bg: '#a8352a', board: 'らーめん', red: true },
  { id: 'soba', name: '手打蕎麦', noren: 'そば', bg: '#1f2e44', board: '蕎麦' },
  { id: 'tofu', name: '豆腐店', noren: '豆', bg: '#ece5d4', fg: '#2a3550', board: 'とうふ' },
  { id: 'sake', name: '酒屋', noren: '酒', bg: '#3a2a20', board: '地酒', sugi: true },
  { id: 'amami', name: '甘味処', noren: '甘', bg: '#c9553d', board: 'あんみつ', bench: true, umbrella: true },
  { id: 'dango', name: '団子屋', noren: '団子', bg: '#d98aa1', board: '花見団子', bench: true, umbrella: true },
  { id: 'photo', name: '写真館', board: '写真館', hboard: true },
  { id: 'clock', name: '時計店', board: '時計', hboard: true },
  { id: 'stationery', name: '文具店', board: '文具', hboard: true },
  { id: 'kissa', name: '喫茶さくら', board: '喫茶', hboard: true, red: true },
  { id: 'yaoya', name: '八百屋', noren: '八百', bg: '#4d6b2f', board: '八百屋', produce: true },
  { id: 'fish', name: '魚屋', noren: '魚', bg: '#20476b', board: '鮮魚', produce: true },
  { id: 'kimono', name: '呉服', noren: '呉服', bg: '#5b3a6e', board: '呉服' },
  { id: 'pottery', name: '陶器', noren: '器', bg: '#6a5642', board: '陶器' },
  { id: 'pharmacy', name: '薬局', board: '薬', hboard: true },
  { id: 'rice', name: '米屋', noren: '米', bg: '#e9e2cf', fg: '#5b2b23', board: '米' },
  { id: 'tobacco', name: 'たばこ', board: 'たばこ', hboard: true, red: true },
  { id: 'pickles', name: '漬物', noren: '漬', bg: '#6b4a2b', board: '漬物' },
  { id: 'toys', name: 'おもちゃ', board: '玩具', hboard: true },
  { id: 'senbei', name: '煎餅', noren: '煎', bg: '#8c5a2a', board: '手焼煎餅' },
];

const WOOD = ['#4b3427', '#553b2b', '#43302a', '#5e4330'];
const PLASTER = ['#efe7d6', '#e9dfcc', '#f2ece0', '#e4dac6', '#ece3d3'];
const KAWARA = ['#3d4350', '#454b55', '#3a3f48', '#41454e'];
const HOUSE_WALL = ['#efe7d8', '#e9e2d3', '#f3efe6', '#d9d4c8', '#e6d8c3', '#cfd6d4', '#e8d6cf', '#dfe3d9', '#d6cbb8', '#f1e3d0', '#e3e6ea', '#efe0cf'];
const HOUSE_ROOF = ['#3f4652', '#4a4f58', '#5b4a3e', '#3c5266', '#3d5f5f', '#6a4636', '#2f3542', '#55575e'];
const LAUNDRY = ['#f2f2f2', '#9cc3e6', '#f5c6d0', '#f7e2a3', '#b9d7a8', '#ffffff', '#c9b6e4', '#e6a68f'];

// ---------- 町屋 ----------
export function buildMachiya(b, sb, atlas, rng, o) {
  const { W, D, shop } = o;
  const hw = W / 2, hd = D / 2;
  const wood = vary(rng.pick(WOOD), rng, 0.06);
  const woodD = mulColor(wood, 0.72);
  const plaster = vary(rng.pick(PLASTER), rng, 0.03);
  const roofC = vary(rng.pick(KAWARA), rng, 0.04);
  const base = 0.3, f1 = 3.0, f2 = 2.5;
  const out = { lights: [], height: base + f1 + f2 + 1.8, shopSpot: null };
  b.pattern(PAT.STONE, 0);
  b.box(0, -0.35, 0, W + 0.02, 0.65, D, '#8e877b');
  // 一层：侧墙与后墙
  b.pattern(PAT.PLASTER, 0);
  b.box(0, base, -0.15, W - 0.08, f1, D - 0.5, plaster, { faces: 'pxnxnz', ao: 0.06 });
  b.pattern(PAT.PLANK, 0);
  b.box(0, base, -0.15, W - 0.04, 0.95, D - 0.46, wood, { faces: 'pxnxnz' });
  const zf = hd - 0.4;
  // 正面柱与楣
  b.box(-hw + 0.11, base, zf, 0.22, f1, 0.24, woodD);
  b.box(hw - 0.11, base, zf, 0.22, f1, 0.24, woodD);
  b.box(0, base + f1 - 0.36, zf, W, 0.36, 0.26, woodD);
  b.box(0, base - 0.02, zf, W, 0.14, 0.3, woodD);
  const inner = W - 0.44;
  if (shop) {
    const ew = Math.min(2.4, W * 0.46);
    const sideW = (inner - ew) / 2;
    const ex = (sideW / 2 + ew / 2);
    // 两侧格子
    panelOn(b, 'pz', zf, -ex, base + 0.1, sideW, f1 - 0.46, wood, PAT.KOSHI, 0.8);
    panelOn(b, 'pz', zf, ex, base + 0.1, sideW, f1 - 0.46, wood, PAT.KOSHI, 0.8);
    // 入口凹进的店内（夜里透出暖光）
    b.pattern(PAT.NONE, 0.55);
    b.quad([-ew / 2, base, zf - 0.9], [ew / 2, base, zf - 0.9], [ew / 2, base + f1 - 0.36, zf - 0.9], [-ew / 2, base + f1 - 0.36, zf - 0.9], '#3a2c22');
    b.pattern(PAT.PLANK, 0.25);
    b.quad([-ew / 2, base + 0.01, zf - 0.9], [-ew / 2, base + 0.01, zf], [ew / 2, base + 0.01, zf], [ew / 2, base + 0.01, zf - 0.9], '#6d5848');
    b.pattern(PAT.PLASTER, 0.3);
    b.quad([-ew / 2, base, zf], [-ew / 2, base, zf - 0.9], [-ew / 2, base + f1 - 0.36, zf - 0.9], [-ew / 2, base + f1 - 0.36, zf], '#5b4a3c');
    b.quad([ew / 2, base, zf - 0.9], [ew / 2, base, zf], [ew / 2, base + f1 - 0.36, zf], [ew / 2, base + f1 - 0.36, zf - 0.9], '#5b4a3c');
    b.pattern(PAT.NONE, 0);
    // 暖帘
    if (shop.noren) {
      const r = atlas.noren(shop.noren, { bg: shop.bg, fg: shop.fg || '#f4efe6' });
      sb.push();
      sb.translate(0, base + f1 - 0.36 - 0.42, zf + 0.16);
      signQuad(sb, r, ew - 0.1, 0.84, 0xffffff, 0.15, true);
      sb.pop();
      b.tube([[-ew / 2 - 0.1, base + f1 - 0.36, zf + 0.15], [ew / 2 + 0.1, base + f1 - 0.36, zf + 0.15]], 0.025, 5, '#2a2018');
    }
    // 立式招牌
    if (shop.board) {
      const vertical = !shop.hboard;
      if (vertical) {
        const r = atlas.board(shop.board, { vertical: true, bg: shop.red ? '#7a1f1a' : '#3b2a20', fg: '#f3e6c8', px: 64 });
        const n = [...shop.board].length;
        const h = Math.min(1.9, 0.38 * n + 0.3);
        const sx = rng.chance(0.5) ? -hw + 0.55 : hw - 0.55;
        b.pattern(PAT.PLANK, 0);
        b.box(sx, base, hd + 0.35, 0.5, 0.12, 0.3, woodD);
        b.box(sx, base, hd + 0.35, 0.06, h + 0.25, 0.06, woodD);
        sb.push();
        sb.translate(sx, base + 0.2 + h / 2 + 0.1, hd + 0.35);
        signQuad(sb, r, 0.46, h, 0xffffff, 0.35, true);
        sb.pop();
        out.board = { x: sx, z: hd + 0.35 };
      } else {
        // 二层正面的横招牌
        const r = atlas.board(shop.board, { vertical: false, bg: shop.red ? '#8a2a22' : '#2e2620', fg: '#f6ead0', px: 72 });
        const n = [...shop.board].length;
        const w = Math.min(W * 0.75, 0.62 * (n + 1));
        sb.push();
        sb.translate(0, base + f1 + 0.95, hd - 0.68);
        signQuad(sb, r, w, 0.62, 0xffffff, 0.6, false);
        sb.pop();
      }
    }
    // 提灯
    if (shop.red || rng.chance(0.45)) {
      const lx = rng.chance(0.5) ? -ew / 2 - 0.35 : ew / 2 + 0.35;
      lanternGeometry(b, lx, base + f1 - 0.45, zf + 0.35, shop.red ? '#c8372d' : '#f3ead8', 0.95);
      out.lights.push([lx, base + f1 - 0.75, zf + 0.35]);
    }
    // 杉玉
    if (shop.sugi) {
      b.pattern(PAT.THATCH, 0);
      b.sphere(hw - 0.9, base + f1 + 0.05, hd + 0.3, 0.42, 10, 8, '#6f7a42');
    }
    // 茶屋长凳与野点伞
    if (shop.bench) {
      const bx = rng.chance(0.5) ? -hw + 1.3 : hw - 1.3;
      b.pattern(PAT.PLANK, 0);
      b.box(bx, base + 0.05, hd + 1.0, 1.7, 0.42, 0.62, '#5d4330');
      b.pattern(PAT.NONE, 0);
      b.box(bx, base + 0.47, hd + 1.0, 1.75, 0.04, 0.66, '#c2362c');
      out.bench = { x: bx, z: hd + 1.0, y: base + 0.51 };
      if (shop.umbrella) {
        b.cylinder(bx + 0.7, base, hd + 1.35, 0.03, 0.03, 2.3, 5, '#6d5038');
        b.cylinder(bx + 0.7, base + 2.0, hd + 1.35, 0.04, 1.35, 0.5, 14, '#c5382e', { bottom: true });
      }
    }
    // 八百屋/鱼屋 的货台
    if (shop.produce) {
      b.pattern(PAT.PLANK, 0);
      b.box(0, base, hd + 0.4, ew + 0.6, 0.75, 0.8, '#7b5a3e');
      const cols = shop.id === 'fish' ? ['#9fb4c4', '#c9d6de', '#d98d7a'] : ['#d84b3a', '#f2a03d', '#7fae4a', '#e7d24a', '#a8456a'];
      b.pattern(PAT.NONE, 0);
      for (let i = 0; i < 9; i++) b.sphere(-ew / 2 + 0.1 + (i / 8) * ew, base + 0.83, hd + 0.4 + (i % 2 ? 0.15 : -0.15), 0.13, 6, 4, rng.pick(cols));
    }
    out.shopSpot = { x: 0, z: hd + 1.1 };
  } else {
    // 住家：满墙格子 + 拉门
    panelOn(b, 'pz', zf, -0.55, base + 0.1, inner - 1.3, f1 - 0.46, wood, PAT.KOSHI, 0.7);
    panelOn(b, 'pz', zf, inner / 2 - 0.55, base + 0.1, 1.05, 2.1, mulColor(wood, 0.9), PAT.KOSHI, 0.5);
    b.box(inner / 2 - 0.55, base + 2.2, zf + 0.02, 1.15, 0.1, 0.12, woodD);
    if (rng.chance(0.5)) {
      // 盆栽
      b.pattern(PAT.NONE, 0);
      b.cylinder(-hw + 0.6, base, hd + 0.2, 0.22, 0.17, 0.32, 8, '#8a5a3c');
      b.sphere(-hw + 0.6, base + 0.55, hd + 0.2, 0.32, 8, 6, '#5d8a45');
    }
  }
  // 庇
  leanTo(b, W + 0.04, hd - 0.92, hd + 0.62, base + f1 + 0.48, base + f1 - 0.08, roofC);
  // 二层
  const z2 = -0.35, d2 = D - 1.1;
  b.pattern(PAT.PLASTER, 0);
  b.box(0, base + f1, z2, W - 0.08, f2, d2, plaster, { ao: 0.04 });
  const zf2 = z2 + d2 / 2;
  // 二层正面：虫笼窗或木格窗
  if (rng.chance(0.5)) {
    panelOn(b, 'pz', zf2, 0, base + f1 + 0.75, Math.min(W * 0.62, 3.6), 0.85, plaster, PAT.KOSHI, 0.6);
  } else {
    panelOn(b, 'pz', zf2, 0, base + f1 + 0.6, Math.min(W * 0.7, 4.0), 1.15, '#f3ead6', PAT.SHOJI, 0.85);
    b.box(0, base + f1 + 0.55, zf2 + 0.06, Math.min(W * 0.7, 4.0) + 0.1, 0.08, 0.14, woodD);
  }
  // 侧面小窗
  if (rng.chance(0.6)) {
    const right = rng.chance(0.5);
    windowOn(b, right ? 'px' : 'nx', right ? W / 2 - 0.04 : -W / 2 + 0.04, z2, base + f1 + 0.9, 0.9, 0.8, rng.chance(0.5) ? 0.8 : 0);
  }
  // 主屋顶
  b.push();
  b.translate(0, 0, z2);
  const rise = (d2 / 2) * 0.42;
  gableRoof(b, W - 0.08, d2, base + f1 + f2, base + f1 + f2 + rise, 0.32, 0.55, roofC, { gableColor: plaster });
  b.pop();
  return out;
}

// ---------- 现代民居 ----------
export function buildHouse(b, sb, atlas, rng, o) {
  const { W, D } = o;
  const hw = W / 2, hd = D / 2;
  const wallC = vary(rng.pick(HOUSE_WALL), rng, 0.03);
  const roofC = vary(rng.pick(HOUSE_ROOF), rng, 0.04);
  const siding = rng.chance(0.6);
  const base = 0.42, fh = 2.75;
  const out = { lights: [], height: base + fh * 2 + 2.6 };
  b.pattern(PAT.NONE, 0);
  b.box(0, -0.4, 0, W + 0.12, 0.82, D + 0.12, '#a9a59c');
  b.pattern(siding ? PAT.PLANK : PAT.PLASTER, 0);
  b.box(0, base, 0, W, fh * 2, D, wallC, { ao: 0.08, faces: 'pxnxpznz' });
  b.pattern(PAT.NONE, 0);
  b.box(0, base + fh - 0.06, 0, W + 0.08, 0.14, D + 0.08, mulColor(wallC, 0.86));
  const frame = rng.chance(0.5) ? '#e9e6df' : '#6b6a68';
  // 窗户
  const faces = [
    ['pz', hd, W], ['nz', -hd, W], ['px', hw, D], ['nx', -hw, D],
  ];
  const doorX = rng.chance(0.5) ? hw - 1.3 : -hw + 1.3;
  for (const [face, pos, len] of faces) {
    for (let fl = 0; fl < 2; fl++) {
      const n = Math.max(1, Math.floor(len / 2.7));
      for (let i = 0; i < n; i++) {
        const a = -len / 2 + ((i + 0.5) / n) * len;
        if (face === 'pz' && fl === 0 && Math.abs(a - doorX) < 1.3) continue;
        if (rng.chance(0.18)) continue;
        const big = face === 'pz' && fl === 0;
        const w = big ? 1.7 : rng.float(1.1, 1.6), h = big ? 1.8 : 1.1;
        const y = base + fl * fh + (big ? 0.2 : 0.9);
        windowOn(b, face, pos, a, y, w, h, rng.chance(0.55) ? rng.float(0.6, 1.0) : 0, frame);
      }
    }
  }
  // 门
  panelOn(b, 'pz', hd, doorX, base, 0.95, 2.05, rng.pick(['#5b4636', '#3f3b38', '#7a6450', '#6e5a48']), PAT.PLANK, 0, true);
  b.pattern(PAT.NONE, 0);
  b.box(doorX, base + 2.3, hd + 0.4, 1.6, 0.1, 0.8, mulColor(wallC, 0.8));
  b.pattern(PAT.NONE, 0.9);
  b.box(doorX + 0.75, base + 1.8, hd + 0.06, 0.14, 0.2, 0.1, '#fff2d0');
  b.pattern(PAT.NONE, 0);
  b.box(doorX, -0.1, hd + 0.5, 1.4, 0.48, 1.0, '#b9b4aa');
  out.lights.push([doorX + 0.75, base + 1.8, hd + 0.3]);
  // 阳台与晾衣
  if (rng.chance(0.6)) {
    const bw = Math.min(W - 1.2, rng.float(3, 4.6));
    const bx = rng.float(-hw + bw / 2 + 0.3, hw - bw / 2 - 0.3);
    const y = base + fh;
    b.box(bx, y - 0.12, hd + 0.5, bw, 0.14, 1.0, mulColor(wallC, 0.9));
    const rail = '#d9d6cf';
    b.box(bx, y + 0.02, hd + 0.98, bw, 0.9, 0.05, rail, { faces: 'pznzpy' });
    b.box(bx - bw / 2 + 0.02, y + 0.02, hd + 0.5, 0.05, 0.9, 1.0, rail, { faces: 'pxnxpy' });
    b.box(bx + bw / 2 - 0.02, y + 0.02, hd + 0.5, 0.05, 0.9, 1.0, rail, { faces: 'pxnxpy' });
    windowOn(b, 'pz', hd, bx, y + 0.05, Math.min(bw - 0.6, 1.8), 1.9, rng.chance(0.5) ? 0.9 : 0, frame);
    // 晾衣竿
    b.tube([[bx - bw / 2 + 0.2, y + 1.65, hd + 0.75], [bx + bw / 2 - 0.2, y + 1.65, hd + 0.75]], 0.02, 4, '#b7b7b7');
    const n = rng.int(2, 6);
    for (let i = 0; i < n; i++) {
      const x = bx - bw / 2 + 0.4 + (i / Math.max(1, n - 1)) * (bw - 0.8);
      const lw = rng.float(0.35, 0.6), lh = rng.float(0.45, 0.8);
      const col = rng.pick(LAUNDRY);
      b.quad([x - lw / 2, y + 1.62 - lh, hd + 0.76], [x + lw / 2, y + 1.62 - lh, hd + 0.76], [x + lw / 2, y + 1.62, hd + 0.76], [x - lw / 2, y + 1.62, hd + 0.76], col);
      b.quad([x + lw / 2, y + 1.62 - lh, hd + 0.74], [x - lw / 2, y + 1.62 - lh, hd + 0.74], [x - lw / 2, y + 1.62, hd + 0.74], [x + lw / 2, y + 1.62, hd + 0.74], col);
    }
    if (rng.chance(0.3)) {
      // 晒被子
      b.box(bx + 0.3, y + 0.62, hd + 1.02, Math.min(bw - 0.8, 1.6), 0.55, 0.06, rng.pick(['#f1d4dc', '#d6e6f2', '#f6ecd2']));
    }
  }
  // 空调外机
  b.pattern(PAT.NONE, 0);
  const acSide = rng.chance(0.5) ? 1 : -1;
  b.box(acSide * (hw + 0.2), base, rng.float(-hd + 1, hd - 1), 0.36, 0.58, 0.8, '#e8e7e2');
  // 屋顶
  const rise = (Math.min(W, D) / 2) * rng.float(0.42, 0.58);
  const yw = base + fh * 2;
  const tin = rng.chance(0.14);
  if (W >= D && rng.chance(0.55)) hipRoof(b, W, D, yw, yw + rise, 0.55, roofC, { pat: tin ? PAT.TIN : PAT.KAWARA });
  else if (W >= D) gableRoof(b, W, D, yw, yw + rise, 0.45, 0.55, roofC, { pat: tin ? PAT.TIN : PAT.KAWARA, gableColor: wallC, gablePat: siding ? PAT.PLANK : PAT.PLASTER, sori: tin ? 0 : 0.05 });
  else {
    b.push();
    b.rotateY(Math.PI / 2);
    hipRoof(b, D, W, yw, yw + rise, 0.55, roofC, { pat: tin ? PAT.TIN : PAT.KAWARA });
    b.pop();
  }
  // 前院：砖墙或绿篱
  const yard = o.setback - 0.6;
  if (yard > 1.2) {
    const zw = hd + yard;
    const gate = doorX;
    if (rng.chance(0.55)) {
      b.pattern(PAT.BLOCK, 0);
      const wc = vary('#c9c3b6', rng, 0.04);
      const segs = [[-hw - 0.4, gate - 0.8], [gate + 0.8, hw + 0.4]];
      for (const [x0, x1] of segs) if (x1 - x0 > 0.3) b.box((x0 + x1) / 2, -0.05, zw, x1 - x0, 1.25, 0.15, wc);
      b.pattern(PAT.NONE, 0);
      b.box(gate - 0.85, -0.05, zw, 0.32, 1.45, 0.32, mulColor(wc, 0.95));
      b.box(gate + 0.85, -0.05, zw, 0.32, 1.45, 0.32, mulColor(wc, 0.95));
      // 信箱
      b.box(gate + 0.85, 1.05, zw + 0.2, 0.28, 0.3, 0.12, rng.pick(['#c33a2d', '#3b5e7a', '#d8cfbf']));
      out.walls = segs.map(([x0, x1]) => [x0, zw, x1, zw]);
    } else {
      b.pattern(PAT.NONE, 0);
      const hc = vary('#4f7a3c', rng, 0.08);
      for (const [x0, x1] of [[-hw - 0.3, gate - 0.8], [gate + 0.8, hw + 0.3]]) if (x1 - x0 > 0.3) b.box((x0 + x1) / 2, -0.05, zw, x1 - x0, 1.05, 0.6, hc, { topColor: mulColor(hc, 1.15) });
      out.walls = [[-hw - 0.3, zw, gate - 0.8, zw], [gate + 0.8, zw, hw + 0.3, zw]];
    }
    // 自行车
    if (rng.chance(0.35)) out.bike = { x: gate + (doorX > 0 ? -1.4 : 1.4), z: hd + yard * 0.5 };
  }
  out.door = { x: doorX, z: hd + 0.6 };
  return out;
}

// ---------- 古民家 ----------
export function buildFarmhouse(b, sb, atlas, rng, o) {
  const { W, D } = o;
  const hw = W / 2, hd = D / 2;
  const thatch = rng.chance(0.55);
  const wood = vary('#4a3528', rng, 0.06);
  const plaster = vary('#e8dfcc', rng, 0.03);
  const base = 0.55, wallH = 2.9;
  const out = { lights: [], height: base + wallH + 4.5 };
  b.pattern(PAT.STONE, 0);
  b.box(0, -0.4, 0, W + 0.1, 0.95, D + 0.1, '#857e72');
  b.pattern(PAT.PLASTER, 0);
  b.box(0, base, 0, W, wallH, D, plaster, { faces: 'pxnxnz', ao: 0.05 });
  b.pattern(PAT.PLANK, 0);
  b.box(0, base, 0, W + 0.04, 1.1, D + 0.04, wood, { faces: 'pxnxnz' });
  // 正面：障子与缘侧
  const zf = hd;
  panelOn(b, 'pz', zf - 0.02, 0, base, W - 0.2, wallH, '#f1e8d4', PAT.SHOJI, 0.9);
  b.pattern(PAT.PLANK, 0);
  b.box(0, base + wallH - 0.25, zf, W + 0.1, 0.3, 0.2, wood);
  b.box(0, base - 0.05, zf + 0.6, W + 0.4, 0.12, 1.2, '#7a5c43', { topColor: '#8b6a4c' });
  for (let i = 0; i <= 4; i++) b.box(-hw + (i / 4) * W, base, zf + 1.1, 0.16, wallH, 0.16, wood);
  b.box(0, base + wallH - 0.2, zf + 1.1, W + 0.2, 0.2, 0.18, wood);
  // 屋顶
  const yw = base + wallH;
  if (thatch) {
    const tc = vary('#8b7a5c', rng, 0.05);
    irimoyaRoof(b, W + 1.0, D + 1.4, yw, yw + D * 0.62, 1.1, tc, { pat: PAT.THATCH, under: '#5b4a38', ridge: '#3a3328', gableColor: '#4c3a2c' });
  } else {
    irimoyaRoof(b, W + 1.0, D + 1.4, yw, yw + D * 0.42, 0.9, vary(rng.pick(KAWARA), rng, 0.04), { gableColor: '#5a4232' });
  }
  out.engawa = { x: 0, z: zf + 0.6, y: base + 0.07, w: W };
  out.lights.push([0, base + 1.5, zf + 0.3]);
  return out;
}

// ---------- 土蔵 ----------
export function buildKura(b, sb, atlas, rng, o) {
  const { W, D } = o;
  const hd = D / 2;
  const base = 0.4, h = 4.6;
  b.pattern(PAT.STONE, 0);
  b.box(0, -0.4, 0, W + 0.1, 0.8, D + 0.1, '#857e72');
  b.pattern(PAT.PLASTER, 0);
  b.box(0, base, 0, W, h, D, '#f3f0e9', { ao: 0.04 });
  b.pattern(PAT.BLOCK, 0);
  b.box(0, base, 0, W + 0.06, 1.3, D + 0.06, '#4a4d52', { faces: 'pxnxpznz' });
  panelOn(b, 'pz', hd + 0.03, 0, base, 1.2, 2.0, '#2f2b28', PAT.PLANK);
  panelOn(b, 'pz', hd + 0.03, 0, base + 3.2, 0.7, 0.6, '#2f2b28', PAT.NONE);
  gableRoof(b, W, D, base + h, base + h + D * 0.28, 0.35, 0.45, '#3a3f48', { gableColor: '#f3f0e9' });
  return { lights: [], height: base + h + 2 };
}

// ---------- 布置 ----------
function zoneAt(road, x, z) {
  switch (road.name) {
    case '本通り':
      if (x > 18 && x < 156) return 'shop';
      if (x > -178 && x < -14) return 'old';
      if (x <= -178) return 'rural';
      return 'res';
    case '駅前通り':
      return z < 100 ? 'mixed' : null;
    case '西通り':
      return z > 165 ? 'rural' : z < -60 ? null : 'res';
    case '北小路': case '寺町小路': case '柳小路': case '南小路': case '東小路': case '桜小路': case '学校の坂':
      return 'res';
    case '寺への道':
      return z > -40 ? 'old' : null;
    case '田の道':
      return x > -150 ? 'rural' : null;
    default:
      return null;
  }
}

export class Town {
  constructor(terrain, rng) {
    this.terrain = terrain;
    this.rng = rng;
    this.lots = [];
    this.grid = new Map();
    this.shopIndex = 0;
  }
  _gkey(ix, iz) {
    return ix * 7919 + iz;
  }
  overlaps(fp) {
    const c = 24;
    const r = Math.hypot(fp.hw, fp.hd);
    for (let ix = Math.floor((fp.x - r) / c); ix <= Math.floor((fp.x + r) / c); ix++)
      for (let iz = Math.floor((fp.z - r) / c); iz <= Math.floor((fp.z + r) / c); iz++) {
        const a = this.grid.get(this._gkey(ix, iz));
        if (!a) continue;
        for (const o of a) if (obbOverlap(fp, o, 0.05)) return true;
      }
    return false;
  }
  reserve(fp) {
    const c = 24;
    const r = Math.hypot(fp.hw, fp.hd);
    for (let ix = Math.floor((fp.x - r) / c); ix <= Math.floor((fp.x + r) / c); ix++)
      for (let iz = Math.floor((fp.z - r) / c); iz <= Math.floor((fp.z + r) / c); iz++) {
        const k = this._gkey(ix, iz);
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(fp);
      }
  }
  // 占地检查
  valid(fp, ownRoad) {
    const T = this.terrain;
    if (Math.hypot(fp.x, fp.z) > 420) return false;
    if (excluded(fp.x, fp.z, Math.min(fp.hw, fp.hd))) return false;
    const c = Math.cos(fp.rot), s = Math.sin(fp.rot);
    const pts = [[0, 0]];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) pts.push([sx * fp.hw, sz * fp.hd]);
    for (const sx of [-1, 1]) pts.push([sx * fp.hw, 0], [0, sx * fp.hd]);
    let hmin = Infinity, hmax = -Infinity;
    for (const [lx, lz] of pts) {
      const x = fp.x + lx * c + lz * s, z = fp.z - lx * s + lz * c;
      if (excluded(x, z)) return false;
      const rq = riverNearest(x, z);
      if (rq.d < riverHalfWidth(rq.s) + 14.5) return false;
      const nr = T.nearestRoad(x, z, 10);
      if (nr && nr.d < nr.road.width / 2 + 0.6) return false;
      const rl = railQuery(x, z, 12);
      if (rl && rl.d < 9) return false;
      const h = T.heightAt(x, z);
      hmin = Math.min(hmin, h);
      hmax = Math.max(hmax, h);
      if (T.waterAt(x, z) > h - 0.2) return false;
    }
    if (hmax - hmin > 2.4) return false;
    return !this.overlaps(fp);
  }
  pickSpec(zone) {
    const rng = this.rng;
    switch (zone) {
      case 'shop':
        return { type: 'machiya', W: rng.float(5.4, 7.6), D: rng.float(9.5, 11.5), setback: 1.3, gap: 0.08, shop: true };
      case 'old':
        if (rng.chance(0.6)) return { type: 'machiya', W: rng.float(5.6, 7.8), D: rng.float(9, 11), setback: rng.float(0.9, 1.6), gap: rng.float(0.1, 2.5), shop: rng.chance(0.18) };
        return { type: 'house', W: rng.float(7.2, 9.5), D: rng.float(6.5, 8.5), setback: rng.float(2.4, 3.6), gap: rng.float(2.5, 6) };
      case 'mixed':
        if (rng.chance(0.4)) return { type: 'machiya', W: rng.float(5.6, 7.4), D: rng.float(9, 11), setback: 1.2, gap: rng.float(0.1, 3), shop: rng.chance(0.5) };
        return { type: 'house', W: rng.float(7.2, 9.5), D: rng.float(6.5, 8.5), setback: rng.float(2.4, 3.4), gap: rng.float(3, 6) };
      case 'rural':
        return { type: 'farm', W: rng.float(11, 14), D: rng.float(8, 9.6), setback: rng.float(5, 9), gap: rng.float(14, 28) };
      default:
        if (rng.chance(0.12)) return { type: 'machiya', W: rng.float(5.6, 7.4), D: rng.float(9, 10.5), setback: rng.float(1, 1.6), gap: rng.float(1, 4), shop: false };
        return { type: 'house', W: rng.float(7.2, 10), D: rng.float(6.6, 8.8), setback: rng.float(2.6, 4.2), gap: rng.float(3, 7.5) };
    }
  }
  placeAll() {
    const rng = this.rng;
    for (const road of ROADS) {
      if (road.promenade || road.overlay) continue;
      for (const side of [1, -1]) {
        const P = road.pts, A = road.acc, L = A[A.length - 1];
        let s = rng.float(1.5, 5);
        let spec = null;
        while (s < L - 3) {
          const pt0 = pointAt(P, A, s);
          const zone = zoneAt(road, pt0.x, pt0.z);
          if (!zone) {
            s += 4;
            spec = null;
            continue;
          }
          if (!spec || spec.zone !== zone) {
            spec = this.pickSpec(zone);
            spec.zone = zone;
          }
          const sMid = s + spec.W / 2;
          if (sMid > L - 1.5) break;
          const pt = pointAt(P, A, sMid);
          const nx = pt.tz * side, nz = -pt.tx * side;
          const dist = road.width / 2 + spec.setback + spec.D / 2;
          const cx = pt.x + nx * dist, cz = pt.z + nz * dist;
          const rot = Math.atan2(-nx, -nz);
          const fp = { x: cx, z: cz, hw: spec.W / 2 + 0.15, hd: spec.D / 2 + 0.15 + (spec.type === 'house' ? spec.setback * 0.5 - 0.45 : 0), rot };
          // 前院也计入占地（向道路方向延伸）
          if (spec.type === 'house') {
            const ext = spec.setback * 0.5 - 0.45;
            fp.x += -nx * ext;
            fp.z += -nz * ext;
          }
          if (this.valid(fp, road)) {
            const lot = { ...spec, x: cx, z: cz, rot, fp, road: road.name, side };
            if (lot.shop) {
              lot.shopInfo = zone === 'shop' ? SHOPS[this.shopIndex++ % SHOPS.length] : SHOPS[rng.int(0, SHOPS.length - 1)];
            }
            this.lots.push(lot);
            this.reserve(fp);
            s += spec.W + spec.gap;
            spec = null;
          } else {
            s += spec.zone === 'shop' ? 1.0 : 2.2;
          }
        }
      }
    }
    // 古民家旁边的土蔵
    for (const lot of this.lots.filter((l) => l.type === 'farm')) {
      if (!rng.chance(0.7)) continue;
      const side = rng.sign();
      const c = Math.cos(lot.rot), s = Math.sin(lot.rot);
      const lx = side * (lot.W / 2 + 4.5), lz = -lot.D / 2 + 1;
      const x = lot.x + lx * c + lz * s, z = lot.z - lx * s + lz * c;
      const fp = { x, z, hw: 2.6, hd: 3.2, rot: lot.rot };
      if (this.valid(fp, null)) {
        this.lots.push({ type: 'kura', W: 4.6, D: 5.8, x, z, rot: lot.rot, fp });
        this.reserve(fp);
      }
    }
    // 地基高度
    for (const lot of this.lots) {
      const c = Math.sin(lot.rot), d = Math.cos(lot.rot);
      const fx = lot.x + c * lot.D * 0.5, fz = lot.z + d * lot.D * 0.5;
      const hF = this.terrain.heightAt(fx, fz), hC = this.terrain.heightAt(lot.x, lot.z);
      lot.y = Math.max(hF, hC * 0.6 + hF * 0.4) + 0.06;
    }
    return this.lots;
  }
  pads() {
    return this.lots.map((l) => ({ x: l.fp.x, z: l.fp.z, hw: l.fp.hw + 0.5, hd: l.fp.hd + 0.5, rot: l.rot, y: l.y - 0.05, blend: 3.2 }));
  }
}
