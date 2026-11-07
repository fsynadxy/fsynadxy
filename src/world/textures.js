import * as THREE from 'three';
import { RNG } from '../core/math.js';

export const FONT_SERIF = '"Shippori Mincho", "Noto Serif SC", "Noto Serif CJK JP", "Hiragino Mincho ProN", "Yu Mincho", "Songti SC", serif';
export const FONT_BRUSH = '"Yuji Syuku", "Shippori Mincho", "Noto Serif SC", serif';

// 等待网页字体（离线时 2.5 秒后放弃，使用系统字体）
export async function loadFonts() {
  if (!document.fonts || !document.fonts.load) return;
  const tasks = [
    document.fonts.load('700 64px "Shippori Mincho"', '桜川町駅神社花雲寺和菓子茶本湯さくらがわ'),
    document.fonts.load('64px "Yuji Syuku"', '桜川神社五重塔朱橋駅商店街千年桜鏡湖学校奉拝'),
    document.fonts.load('400 32px "Noto Serif SC"', '开始继续设置操作说明'),
  ];
  await Promise.race([Promise.allSettled(tasks), new Promise((r) => setTimeout(r, 2500))]);
}

// 樱花簇贴图：许多五瓣小花（带缺口的花瓣）聚成一团，透明背景
export function makeBlossomTexture(size = 512, seed = 3) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const rng = new RNG(seed);
  const S = size / 256;
  const petal = (len, wid) => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(wid * 0.9, -len * 0.25, wid * 0.85, -len * 0.85, wid * 0.32, -len);
    ctx.lineTo(0, -len * 0.86);
    ctx.lineTo(-wid * 0.32, -len);
    ctx.bezierCurveTo(-wid * 0.85, -len * 0.85, -wid * 0.9, -len * 0.25, 0, 0);
    ctx.closePath();
  };
  const flower = (x, y, r, col, rot) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.rotate((i / 5) * Math.PI * 2);
      petal(r, r * 0.62);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = '#f0a3b6';
    ctx.fill();
    if (r > 5) {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = '#f2cf72';
      ctx.fill();
    }
    ctx.restore();
  };
  const cols = ['#ffffff', '#fff6f8', '#ffeef2', '#fde6ec', '#fbdde5', '#fff2f5'];
  // 中心实心区：树冠内核取样这里，保证不透明且是淡粉色
  ctx.beginPath();
  ctx.arc(128 * S, 128 * S, 26 * S, 0, Math.PI * 2);
  ctx.fillStyle = '#f9e1e8';
  ctx.fill();
  // 小枝
  ctx.strokeStyle = '#6b3b34';
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = rng.float(0, Math.PI * 2);
    ctx.lineWidth = rng.float(0.8, 1.6) * S;
    ctx.beginPath();
    ctx.moveTo(128 * S, 128 * S);
    ctx.quadraticCurveTo((128 + Math.cos(a + 0.4) * 45) * S, (128 + Math.sin(a + 0.4) * 45) * S, (128 + Math.cos(a) * 96) * S, (128 + Math.sin(a) * 96) * S);
    ctx.stroke();
  }
  // 许多小团簇：每团是一簇紧密的小花
  const puffs = [];
  for (let i = 0; i < 26; i++) {
    const a = rng.float(0, Math.PI * 2), d = Math.pow(rng.next(), 0.65) * 92;
    puffs.push([128 + Math.cos(a) * d, 128 + Math.sin(a) * d, rng.float(14, 26)]);
  }
  // 团簇底色（略深，制造体积感）
  for (const [px, py, pr] of puffs) {
    ctx.beginPath();
    ctx.arc(px * S, py * S, pr * 0.62 * S, 0, Math.PI * 2);
    ctx.fillStyle = '#f3cdd7';
    ctx.fill();
  }
  // 嫩叶与花萼
  for (let i = 0; i < 14; i++) {
    const [px, py, pr] = rng.pick(puffs);
    const a = rng.float(0, Math.PI * 2);
    ctx.save();
    ctx.translate((px + Math.cos(a) * pr * 0.8) * S, (py + Math.sin(a) * pr * 0.8) * S);
    ctx.rotate(rng.float(0, Math.PI * 2));
    ctx.beginPath();
    ctx.ellipse(0, 0, 4.5 * S, 2 * S, 0, 0, Math.PI * 2);
    ctx.fillStyle = rng.chance(0.6) ? '#a9bf72' : '#b98a6a';
    ctx.fill();
    ctx.restore();
  }
  // 小花：密集分布在团簇里
  for (let i = 0; i < 420; i++) {
    const [px, py, pr] = rng.pick(puffs);
    const a = rng.float(0, Math.PI * 2), d = Math.sqrt(rng.next()) * pr;
    const r = rng.float(4.2, 7.0);
    flower((px + Math.cos(a) * d) * S, (py + Math.sin(a) * d) * S, r * S, rng.pick(cols), rng.float(0, 6.28));
  }
  // 花蕾
  for (let i = 0; i < 40; i++) {
    const [px, py, pr] = rng.pick(puffs);
    const a = rng.float(0, Math.PI * 2);
    ctx.beginPath();
    ctx.arc((px + Math.cos(a) * pr) * S, (py + Math.sin(a) * pr) * S, rng.float(1.6, 2.6) * S, 0, Math.PI * 2);
    ctx.fillStyle = '#f0a9bb';
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// 竹叶 / 常绿叶簇贴图
export function makeLeafTexture(kind = 'bamboo', size = 256, seed = 5) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const rng = new RNG(seed);
  const S = size / 256;
  const cols = kind === 'bamboo' ? ['#7fa04a', '#93b356', '#6c8f3e', '#a6c26a'] : ['#4f7a3a', '#5f8c43', '#3f6630', '#6d9a4b'];
  for (let i = 0; i < (kind === 'bamboo' ? 70 : 140); i++) {
    const a = rng.float(0, Math.PI * 2), d = Math.pow(rng.next(), 0.7) * 110;
    ctx.save();
    ctx.translate((128 + Math.cos(a) * d) * S, (128 + Math.sin(a) * d) * S);
    ctx.rotate(rng.float(0, Math.PI * 2));
    ctx.beginPath();
    if (kind === 'bamboo') ctx.ellipse(0, 0, rng.float(14, 22) * S, rng.float(2.5, 3.6) * S, 0, 0, Math.PI * 2);
    else ctx.ellipse(0, 0, rng.float(6, 10) * S, rng.float(3, 5) * S, 0, 0, Math.PI * 2);
    ctx.fillStyle = rng.pick(cols);
    ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------- 招牌图集 ----------
export class SignAtlas {
  constructor(size = 2048) {
    this.size = size;
    this.cv = document.createElement('canvas');
    this.cv.width = this.cv.height = size;
    this.ctx = this.cv.getContext('2d');
    this.x = 0;
    this.y = 0;
    this.rowH = 0;
    this.pad = 4;
    this.cache = new Map();
  }
  alloc(w, h) {
    w = Math.ceil(w);
    h = Math.ceil(h);
    if (this.x + w + this.pad > this.size) {
      this.x = 0;
      this.y += this.rowH + this.pad;
      this.rowH = 0;
    }
    if (this.y + h > this.size) {
      // 图集已满：复用左上角（极少发生）
      console.warn('SignAtlas full');
      return { x: 0, y: 0, w, h, uv: [0, 1 - h / this.size, w / this.size, 1] };
    }
    const r = { x: this.x, y: this.y, w, h };
    this.x += w + this.pad;
    this.rowH = Math.max(this.rowH, h);
    // uv：canvas 左上为原点，纹理 flipY 后 v 向上
    r.uv = [r.x / this.size, 1 - (r.y + h) / this.size, (r.x + w) / this.size, 1 - r.y / this.size];
    return r;
  }
  // 通用：绘制函数 (ctx, w, h)
  draw(key, w, h, fn) {
    if (key && this.cache.has(key)) return this.cache.get(key);
    const r = this.alloc(w, h);
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    fn(ctx, w, h);
    ctx.restore();
    if (key) this.cache.set(key, r);
    return r;
  }
  // 木招牌（竖排或横排）
  board(text, { vertical = false, bg = '#3b2a20', fg = '#f3e6c8', border = '#1f1510', font = FONT_SERIF, px = 72, w, h } = {}) {
    px = Math.round(px * 0.72);
    if (w) w = Math.round(w * 0.72);
    if (h) h = Math.round(h * 0.72);
    const n = [...text].length;
    if (!w) w = vertical ? px * 1.5 : px * (n + 1);
    if (!h) h = vertical ? px * (n + 0.9) : px * 1.5;
    return this.draw('board:' + text + bg + fg + vertical + w + h, w, h, (ctx) => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      // 木纹
      ctx.globalAlpha = 0.12;
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle = i % 2 ? '#000' : '#fff';
        const y = (i / 18) * (vertical ? w : h);
        if (vertical) ctx.fillRect(y, 0, 2, h);
        else ctx.fillRect(0, y, w, 2);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = border;
      ctx.lineWidth = px * 0.12;
      ctx.strokeRect(px * 0.06, px * 0.06, w - px * 0.12, h - px * 0.12);
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${px}px ${font}`;
      const chars = [...text];
      if (vertical) chars.forEach((c, i) => ctx.fillText(c, w / 2, px * 0.95 + i * px * 0.98 - (chars.length - 1) * 0 ));
      else ctx.fillText(text, w / 2, h / 2 + px * 0.04);
    });
  }
  // 暖帘：分成三幅，中间一个大字
  noren(text, { bg = '#23395b', fg = '#f4efe6', panels = 3, w = 240, h = 150, font = FONT_SERIF } = {}) {
    return this.draw('noren:' + text + bg + fg + panels, w, h, (ctx) => {
      const pw = w / panels;
      for (let i = 0; i < panels; i++) {
        ctx.fillStyle = bg;
        ctx.fillRect(i * pw + 3, 0, pw - 6, h);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(i * pw + 3, 0, pw - 6, 14);
      }
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const chars = [...text];
      if (chars.length === 1) {
        ctx.font = `700 ${h * 0.55}px ${font}`;
        ctx.fillText(text, w / 2, h * 0.56);
      } else {
        const fs = Math.min(h * 0.5, (w * 0.82) / chars.length);
        ctx.font = `700 ${fs}px ${font}`;
        chars.forEach((c, i) => ctx.fillText(c, (i + 0.5) * (w / chars.length), h * 0.56));
      }
    });
  }
  // 站名牌
  station(name, kana, roman, prev, next) {
    const w = 720, h = 300;
    return this.draw('station:' + name, w, h, (ctx) => {
      ctx.fillStyle = '#fbfaf6';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#2b2b2b';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, w - 6, h - 6);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1d1d1d';
      ctx.font = `700 96px ${FONT_SERIF}`;
      ctx.fillText(kana, w / 2, 90);
      ctx.font = `600 38px ${FONT_SERIF}`;
      ctx.fillText(`${name}   ${roman}`, w / 2, 160);
      ctx.fillStyle = '#e07fa2';
      ctx.fillRect(0, 196, w, 34);
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 26px ${FONT_SERIF}`;
      ctx.textAlign = 'left';
      ctx.fillText('◀ ' + prev, 24, 214);
      ctx.textAlign = 'right';
      ctx.fillText(next + ' ▶', w - 24, 214);
      ctx.fillStyle = '#5a5a5a';
      ctx.textAlign = 'center';
      ctx.font = `500 22px ${FONT_SERIF}`;
      ctx.fillText('さくら線', w / 2, 262);
    });
  }
  // 神社匾额
  plaque(text) {
    const n = [...text].length;
    const w = 110, h = 88 * n + 44;
    return this.draw('plaque:' + text, w, h, (ctx) => {
      ctx.fillStyle = '#20180f';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#b98f3a';
      ctx.lineWidth = 7;
      ctx.strokeRect(6, 6, w - 12, h - 12);
      ctx.fillStyle = '#d9b45a';
      ctx.font = `700 74px ${FONT_BRUSH}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      [...text].forEach((c, i) => ctx.fillText(c, w / 2, 66 + i * 87));
    });
  }
  // 方向指示牌（木桩上的箭头板）
  arrow(text, dir = 1) {
    const w = 420, h = 90;
    return this.draw('arrow:' + text + dir, w, h, (ctx) => {
      ctx.fillStyle = '#efe4cf';
      ctx.beginPath();
      if (dir > 0) {
        ctx.moveTo(0, 0); ctx.lineTo(w - 45, 0); ctx.lineTo(w, h / 2); ctx.lineTo(w - 45, h); ctx.lineTo(0, h);
      } else {
        ctx.moveTo(w, 0); ctx.lineTo(45, 0); ctx.lineTo(0, h / 2); ctx.lineTo(45, h); ctx.lineTo(w, h);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#5b4330';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.fillStyle = '#3a2a1e';
      ctx.font = `700 48px ${FONT_SERIF}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2 + (dir > 0 ? -18 : 18), h / 2 + 3);
    });
  }
  // 纯色块（用于无字的布、坐垫等）
  solid(color) {
    return this.draw('solid:' + color, 8, 8, (ctx, w, h) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
    });
  }
  texture() {
    if (!this._tex) {
      this._tex = new THREE.CanvasTexture(this.cv);
      this._tex.colorSpace = THREE.SRGBColorSpace;
      this._tex.anisotropy = 8;
    }
    this._tex.needsUpdate = true;
    return this._tex;
  }
}

// 在 GeoBuilder（启用 uv）上添加一块贴图四边形：中心 (0,0,0)，宽 w 高 h，朝 +z
export function signQuad(b, r, w, h, color = 0xffffff, glow = 0, double = false) {
  const [u0, v0, u1, v1] = r.uv;
  const prev = b.emis;
  b.emis = glow;
  b.quad([-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0], color, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  if (double) b.quad([w / 2, -h / 2, -0.01], [-w / 2, -h / 2, -0.01], [-w / 2, h / 2, -0.01], [w / 2, h / 2, -0.01], color, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  b.emis = prev;
}
