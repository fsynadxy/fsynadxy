// 碰撞世界：圆柱、有向盒（带高度范围）以及可行走表面（桥面、站台、栈桥）
export class Colliders {
  constructor(cell = 8) {
    this.cell = cell;
    this.map = new Map();
    this.items = [];
    this.surfaces = [];
    this.surfMap = new Map();
    this.dynamic = [];
    this._q = [];
    this._stamp = 0;
  }
  _key(ix, iz) {
    return ix * 92821 + iz;
  }
  _insert(map, item, x0, x1, z0, z1) {
    const c = this.cell;
    for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++)
      for (let iz = Math.floor(z0 / c); iz <= Math.floor(z1 / c); iz++) {
        const k = this._key(ix, iz);
        let a = map.get(k);
        if (!a) map.set(k, (a = []));
        a.push(item);
      }
  }
  addBox(x, z, hw, hd, rot = 0, y0 = -1e4, y1 = 1e4, tag = null) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const it = { type: 'box', x, z, hw, hd, rot, c, s, y0, y1, tag, mark: 0 };
    const r = Math.hypot(hw, hd);
    this._insert(this.map, it, x - r, x + r, z - r, z + r);
    this.items.push(it);
    return it;
  }
  addCircle(x, z, r, y0 = -1e4, y1 = 1e4, tag = null) {
    const it = { type: 'circle', x, z, r, y0, y1, tag, mark: 0 };
    this._insert(this.map, it, x - r, x + r, z - r, z + r);
    this.items.push(it);
    return it;
  }
  // 线段墙（栏杆、围墙）
  addWall(ax, az, bx, bz, thick = 0.2, y0 = -1e4, y1 = 1e4, tag = null) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) return null;
    const rot = Math.atan2(-(bz - az), bx - ax);
    return this.addBox((ax + bx) / 2, (az + bz) / 2, len / 2, thick / 2, rot, y0, y1, tag);
  }
  // 可行走表面：heightFn(lx, lz) 返回局部坐标下的高度
  addSurface(x, z, hw, hd, rot, heightFn, tag = null) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const it = { x, z, hw, hd, rot, c, s, heightFn, tag, mark: 0 };
    const r = Math.hypot(hw, hd);
    this._insert(this.surfMap, it, x - r, x + r, z - r, z + r);
    this.surfaces.push(it);
    return it;
  }
  addDynamic(it) {
    this.dynamic.push(it);
    return it;
  }
  removeDynamic(it) {
    const i = this.dynamic.indexOf(it);
    if (i >= 0) this.dynamic.splice(i, 1);
  }
  _gather(map, x, z, r) {
    const out = this._q;
    out.length = 0;
    const stamp = ++this._stamp;
    const c = this.cell;
    for (let ix = Math.floor((x - r) / c); ix <= Math.floor((x + r) / c); ix++)
      for (let iz = Math.floor((z - r) / c); iz <= Math.floor((z + r) / c); iz++) {
        const a = map.get(this._key(ix, iz));
        if (!a) continue;
        for (const it of a) {
          if (it.mark === stamp) continue;
          it.mark = stamp;
          out.push(it);
        }
      }
    return out;
  }
  local(it, x, z) {
    const dx = x - it.x, dz = z - it.z;
    return [dx * it.c - dz * it.s, dx * it.s + dz * it.c];
  }
  // 把半径 r、身高 h、脚底 y 的角色推出障碍；返回是否发生碰撞
  resolve(p, r, h) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      const list = this._gather(this.map, p.x, p.z, r + 1).concat(this.dynamic);
      let moved = false;
      for (const it of list) {
        if (it.disabled) continue;
        if (p.y + h < it.y0 || p.y > it.y1 - 0.35) continue;
        if (it.type === 'circle') {
          const dx = p.x - it.x, dz = p.z - it.z;
          const d = Math.hypot(dx, dz), m = r + it.r;
          if (d < m) {
            const k = d > 1e-5 ? (m - d) / d : 0;
            p.x += d > 1e-5 ? dx * k : m;
            p.z += d > 1e-5 ? dz * k : 0;
            moved = hit = true;
          }
        } else {
          const c = Math.cos(it.rot), s = Math.sin(it.rot);
          const dx = p.x - it.x, dz = p.z - it.z;
          const lx = dx * c - dz * s, lz = dx * s + dz * c;
          const cx = Math.max(-it.hw, Math.min(it.hw, lx)), cz = Math.max(-it.hd, Math.min(it.hd, lz));
          let ex = lx - cx, ez = lz - cz;
          let d = Math.hypot(ex, ez);
          if (d >= r) continue;
          let px, pz;
          if (d > 1e-5) {
            const k = (r - d) / d;
            px = ex * k;
            pz = ez * k;
          } else {
            // 圆心在盒内：沿最浅方向推出
            const ox = it.hw - Math.abs(lx), oz = it.hd - Math.abs(lz);
            if (ox < oz) {
              px = (ox + r) * Math.sign(lx || 1);
              pz = 0;
            } else {
              px = 0;
              pz = (oz + r) * Math.sign(lz || 1);
            }
          }
          // 局部 → 世界
          p.x += px * c + pz * s;
          p.z += -px * s + pz * c;
          moved = hit = true;
        }
      }
      if (!moved) break;
    }
    return hit;
  }
  // 脚下可站立的最高表面（不高于 y + step）
  surfaceAt(x, z, y, step = 0.6) {
    let best = -Infinity, bestTag = null;
    const list = this._gather(this.surfMap, x, z, 0.5);
    for (const it of list) {
      const dx = x - it.x, dz = z - it.z;
      const lx = dx * it.c - dz * it.s, lz = dx * it.s + dz * it.c;
      if (Math.abs(lx) > it.hw || Math.abs(lz) > it.hd) continue;
      const h = it.heightFn(lx, lz);
      if (h <= y + step && h > best) {
        best = h;
        bestTag = it.tag;
      }
    }
    return { h: best, tag: bestTag };
  }
  // 视线/相机遮挡：线段采样
  blocked(x, y, z) {
    const list = this._gather(this.map, x, z, 0.3);
    for (const it of list) {
      if (it.tag === 'low' || y < it.y0 || y > it.y1) continue;
      if (it.type === 'circle') {
        if (Math.hypot(x - it.x, z - it.z) < it.r) return true;
      } else {
        const [lx, lz] = this.local(it, x, z);
        if (Math.abs(lx) < it.hw && Math.abs(lz) < it.hd) return true;
      }
    }
    return false;
  }
}
