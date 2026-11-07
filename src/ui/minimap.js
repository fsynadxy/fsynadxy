// 地图：由世界数据绘制一张带山影的手绘风底图；HUD 小地图随镜头旋转，大地图朝北
import { ROADS, river, riverHalfWidth, railway, SITES, FIELDS, REGIONS } from '../world/layout.js';
import { lakeShoreRadius } from '../world/terrain.js';
import { FONT_SERIF } from '../world/textures.js';

const EXT = 440; // 地图覆盖 [-EXT, EXT]

export class MapArt {
  constructor(world) {
    this.world = world;
    this.size = 1024;
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = this.size;
    this.draw();
  }
  toPx(x, z) {
    return [((x + EXT) / (2 * EXT)) * this.size, ((z + EXT) / (2 * EXT)) * this.size];
  }
  draw() {
    const W = this.world;
    const T = W.terrain;
    const ctx = this.base.getContext('2d');
    const S = this.size;
    const k = S / (2 * EXT);
    // 山影底图
    const R = 384;
    const img = ctx.createImageData(R, R);
    const tex = T.cTex ? T.cTex.image : null;
    const rect = T.texRect;
    for (let j = 0; j < R; j++)
      for (let i = 0; i < R; i++) {
        const x = -EXT + ((i + 0.5) / R) * 2 * EXT, z = -EXT + ((j + 0.5) / R) * 2 * EXT;
        const h = T.heightAt(x, z);
        const hx = T.heightAt(x + 2, z), hz = T.heightAt(x, z + 2);
        const nx = h - hx, nz = h - hz;
        const shade = 0.82 + (nx * 0.6 + nz * 0.9) * 0.18;
        let r, g, b;
        if (tex && Math.abs(x) < 318 && Math.abs(z) < 318) {
          const ti = Math.round((x - rect.x0) / rect.step), tj = Math.round((z - rect.x0) / rect.step);
          const o = (tj * rect.size + ti) * 4;
          r = tex.data[o];
          g = tex.data[o + 1];
          b = tex.data[o + 2];
        } else {
          const t = Math.min(1, Math.max(0, (h - 10) / 160));
          r = 150 - t * 70;
          g = 178 - t * 60;
          b = 110 - t * 30;
        }
        // 纸感：去饱和、提亮
        const l = (r + g + b) / 3;
        r = (r * 0.55 + l * 0.45) * 0.78 + 60;
        g = (g * 0.55 + l * 0.45) * 0.78 + 58;
        b = (b * 0.55 + l * 0.45) * 0.78 + 50;
        const o = (j * R + i) * 4;
        img.data[o] = Math.min(255, r * shade);
        img.data[o + 1] = Math.min(255, g * shade);
        img.data[o + 2] = Math.min(255, b * shade);
        img.data[o + 3] = 255;
      }
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = R;
    tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, 0, 0, S, S);
    // 稻田
    ctx.fillStyle = 'rgba(150, 190, 205, 0.75)';
    const F = FIELDS.paddies;
    const seen = new Set();
    for (let x = F.x0 + 1; x < F.x1; x += F.cell[0])
      for (let z = F.z0 + 1; z < F.z1; z += F.cell[1]) {
        const c = T.paddyCell(x + 2, z + 2);
        if (!c.flooded || seen.has(c.ix + ',' + c.iz)) continue;
        seen.add(c.ix + ',' + c.iz);
        const [a, b2] = this.toPx(c.x0 + 0.6, c.z0 + 0.6), [cc, d] = this.toPx(c.x1 - 0.6, c.z1 - 0.6);
        ctx.fillRect(a, b2, cc - a, d - b2);
      }
    // 油菜花
    ctx.fillStyle = 'rgba(232, 205, 80, 0.55)';
    for (const n of FIELDS.nanohana) {
      const [a, b2] = this.toPx(n.x0, n.z0), [cc, d] = this.toPx(n.x1, n.z1);
      ctx.fillRect(a, b2, cc - a, d - b2);
    }
    // 湖
    ctx.fillStyle = '#9cc4cf';
    ctx.beginPath();
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const L = SITES.lake;
      const rr = lakeShoreRadius(L.x + Math.cos(a) * 50, L.z + Math.sin(a) * 50);
      const [px, pz] = this.toPx(L.x + Math.cos(a) * rr, L.z + Math.sin(a) * rr);
      if (i === 0) ctx.moveTo(px, pz);
      else ctx.lineTo(px, pz);
    }
    ctx.fill();
    // 河
    ctx.strokeStyle = '#9cc4cf';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < river.pts.length; i++) {
      const a = river.pts[i - 1], b2 = river.pts[i];
      ctx.lineWidth = riverHalfWidth(river.acc[i]) * 2 * k;
      ctx.beginPath();
      ctx.moveTo(...this.toPx(a[0], a[1]));
      ctx.lineTo(...this.toPx(b2[0], b2[1]));
      ctx.stroke();
    }
    // 道路
    for (const r of ROADS) {
      if (r.overlay) continue;
      ctx.strokeStyle = r.type === 'asphalt' ? '#f1ece2' : r.type === 'promenade' ? '#efe2e0' : r.type === 'stone' ? '#ebe2d2' : '#e3d6bd';
      ctx.lineWidth = Math.max(1.6, r.width * k);
      ctx.beginPath();
      r.pts.forEach((p, i) => (i ? ctx.lineTo(...this.toPx(p[0], p[1])) : ctx.moveTo(...this.toPx(p[0], p[1]))));
      ctx.stroke();
    }
    // 铁路
    ctx.strokeStyle = '#6b6560';
    ctx.lineWidth = 3;
    ctx.beginPath();
    railway.pts.forEach((p, i) => (i ? ctx.lineTo(...this.toPx(p[0], p[1])) : ctx.moveTo(...this.toPx(p[0], p[1]))));
    ctx.stroke();
    ctx.strokeStyle = '#f4efe6';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    // 建筑
    for (const lot of W.lots) {
      const { x, z, rot } = lot;
      const c = Math.cos(rot), s = Math.sin(rot);
      const hw = lot.W / 2, hd = lot.D / 2;
      ctx.fillStyle = lot.type === 'machiya' ? '#7b6f68' : lot.type === 'farm' ? '#8a7b62' : '#8d8790';
      ctx.beginPath();
      for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
        const [px, pz] = this.toPx(x + lx * c + lz * s, z - lx * s + lz * c);
        ctx.lineTo(px, pz);
      }
      ctx.closePath();
      ctx.fill();
    }
    // 樱花
    ctx.fillStyle = 'rgba(240, 160, 182, 0.85)';
    for (const t of W.forest.sakura) {
      const [px, pz] = this.toPx(t.x, t.z);
      ctx.beginPath();
      ctx.arc(px, pz, 3.2 * t.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    if (W.forest.ancient) {
      const [px, pz] = this.toPx(W.forest.ancient.x, W.forest.ancient.z);
      ctx.fillStyle = 'rgba(236, 140, 166, 0.95)';
      ctx.beginPath();
      ctx.arc(px, pz, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    // 地标小图标
    ctx.fillStyle = '#c8452e';
    for (const site of [SITES.shrine, SITES.temple]) {
      const [px, pz] = this.toPx(site.x, site.z);
      ctx.fillRect(px - 6, pz - 7, 12, 2.4);
      ctx.fillRect(px - 4.5, pz - 7, 2, 12);
      ctx.fillRect(px + 2.5, pz - 7, 2, 12);
    }
  }
  // 玩家箭头 + 视线扇形（小地图与大地图共用，北朝上）
  // heading：角色朝向角（朝向 = (sin, cos)，π 为北）；look：视线方向角（同一约定）
  playerArrow(ctx, x, y, heading, look, k = 1) {
    ctx.save();
    ctx.translate(x, y);
    // 视线扇形
    ctx.save();
    ctx.rotate(-look + Math.PI);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 34 * k);
    g.addColorStop(0, 'rgba(200,69,46,0.32)');
    g.addColorStop(1, 'rgba(200,69,46,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 34 * k, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // 箭头
    ctx.rotate(-heading + Math.PI);
    ctx.fillStyle = '#c8452e';
    ctx.strokeStyle = '#fffaf2';
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.moveTo(0, -9 * k);
    ctx.lineTo(6.5 * k, 7 * k);
    ctx.lineTo(0, 3.5 * k);
    ctx.lineTo(-6.5 * k, 7 * k);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }
  // HUD 小地图：以玩家为中心，北朝上（与大地图一致）
  drawMini(cv, px, pz, heading, look, markers, scale = 2.2) {
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#e6e0d3';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    const [bx, bz] = this.toPx(px, pz);
    ctx.scale(scale, scale);
    ctx.drawImage(this.base, -bx, -bz);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // 标记
    for (const m of markers) {
      let rx = (m.x - px) * (this.size / (2 * EXT)) * scale, rz = (m.z - pz) * (this.size / (2 * EXT)) * scale;
      const r = Math.hypot(rx, rz), lim = W / 2 - 9;
      if (r > lim) {
        rx *= lim / r;
        rz *= lim / r;
      }
      this.marker(ctx, W / 2 + rx, H / 2 + rz, m, r > lim);
    }
    this.playerArrow(ctx, W / 2, H / 2, heading, look, 1);
    ctx.restore();
  }
  marker(ctx, x, y, m, edge) {
    ctx.save();
    ctx.translate(x, y);
    if (m.kind === 'stamp') {
      ctx.globalAlpha = m.done ? 0.45 : edge ? 0.75 : 1;
      ctx.fillStyle = m.done ? '#8a7f76' : '#c8452e';
      ctx.strokeStyle = '#fffaf2';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.rect(-5, -5, 10, 10);
      ctx.fill();
      ctx.stroke();
      if (!m.done) {
        ctx.fillStyle = '#fffaf2';
        ctx.fillRect(-1.5, -2.8, 3, 5.6);
      }
    } else if (m.kind === 'train') {
      ctx.fillStyle = '#e58aa6';
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  // 大地图
  drawFull(cv, player, markers, heading = player.yaw, look = heading) {
    const ctx = cv.getContext('2d');
    const S = (cv.width = cv.height = 1024);
    ctx.drawImage(this.base, 0, 0);
    // 纸边
    ctx.strokeStyle = 'rgba(110,84,64,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, S - 2, S - 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const r of REGIONS) {
      if (r.id === 'river') continue;
      const [x, y] = this.toPx(r.x, r.z);
      ctx.font = `700 22px ${FONT_SERIF}`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(251,248,242,0.9)';
      ctx.strokeText(r.name, x, y - 22);
      ctx.fillStyle = '#2b2622';
      ctx.fillText(r.name, x, y - 22);
    }
    ctx.font = `600 18px ${FONT_SERIF}`;
    ctx.fillStyle = '#4f7f93';
    ctx.save();
    const [rx, ry] = this.toPx(-40, -230);
    ctx.translate(rx, ry);
    ctx.rotate(-1.35);
    ctx.fillText('桜 川', 0, 0);
    ctx.restore();
    for (const m of markers) {
      const [x, y] = this.toPx(m.x, m.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1.6, 1.6);
      this.marker(ctx, 0, 0, m, false);
      ctx.restore();
    }
    // 玩家（与小地图同一个箭头）
    const [px, py] = this.toPx(player.pos.x, player.pos.z);
    this.playerArrow(ctx, px, py, heading, look, 1.7);
    // 方位
    ctx.font = `700 20px ${FONT_SERIF}`;
    ctx.fillStyle = '#c8452e';
    ctx.fillText('北', S - 40, 40);
    ctx.fillRect(S - 41, 54, 2, 26);
  }
}
