import * as THREE from 'three';
import { GeoBuilder, PAT, C } from '../render/builder.js';
import { railway, railQuery, ROADS, riverNearest } from './layout.js';
import { signQuad } from './textures.js';
import { clamp, lerp, pointAt, smoothstep } from '../core/math.js';

const GAUGE = 1.067;

// 轨道、道砟、枕木、接触网、铁桥、隧道口
export function buildTrack(ctx, terrain) {
  const { chunks, colliders } = ctx;
  const P = railway.pts, A = railway.acc;
  const s0 = terrain.railS.west - 40, s1 = terrain.railS.east + 40;
  const wires = [];
  let sleeperAcc = 0, poleAcc = 20;
  let prevPole = null;
  for (let i = 1; i < P.length; i++) {
    const s = A[i];
    if (s < s0 || A[i - 1] > s1) continue;
    const a = P[i - 1], b = P[i];
    const ha = terrain.railHeight(A[i - 1]), hb = terrain.railHeight(s);
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const len = Math.hypot(tx, tz);
    tx /= len;
    tz /= len;
    const nx = tz, nz = -tx;
    const bl = chunks.at(b[0], b[1]);
    bl.identity();
    // 道砟（梯形）
    const top = 1.55, bot = 2.4;
    const q = (p, o, h) => [p[0] + nx * o, h, p[1] + nz * o];
    bl.pattern(PAT.GRAVEL, 0);
    const gc = '#9b958a';
    bl.quad(q(a, top, ha - 0.22), q(a, -top, ha - 0.22), q(b, -top, hb - 0.22), q(b, top, hb - 0.22), gc, [[0, A[i - 1]], [3, A[i - 1]], [3, s], [0, s]]);
    bl.quad(q(a, bot, ha - 0.75), q(a, top, ha - 0.22), q(b, top, hb - 0.22), q(b, bot, hb - 0.75), '#8e887d');
    bl.quad(q(a, -top, ha - 0.22), q(a, -bot, ha - 0.75), q(b, -bot, hb - 0.75), q(b, -top, hb - 0.22), '#8e887d');
    // 钢轨
    bl.pattern(PAT.NONE, 0);
    for (const o of [GAUGE / 2, -GAUGE / 2]) {
      const w = 0.035;
      bl.quad(q(a, o + w, ha), q(a, o - w, ha), q(b, o - w, hb), q(b, o + w, hb), '#9a9a9a');
      bl.quad(q(a, o + w, ha - 0.14), q(a, o + w, ha), q(b, o + w, hb), q(b, o + w, hb - 0.14), '#5c4a40');
      bl.quad(q(a, o - w, ha), q(a, o - w, ha - 0.14), q(b, o - w, hb - 0.14), q(b, o - w, hb), '#5c4a40');
    }
    // 枕木
    sleeperAcc += len;
    while (sleeperAcc > 0.62) {
      sleeperAcc -= 0.62;
      const t = 1 - sleeperAcc / len;
      const x = lerp(a[0], b[0], t), z = lerp(a[1], b[1], t), h = lerp(ha, hb, t);
      bl.place(x, h - 0.24, z, Math.atan2(tx, tz));
      bl.box(0, 0, 0, 2.0, 0.12, 0.2, '#a19d95');
      bl.identity();
    }
    // 接触网支柱
    poleAcc += len;
    if (poleAcc > 44) {
      poleAcc = 0;
      const side = -1;
      const px = b[0] + nx * 2.6 * side, pz = b[1] + nz * 2.6 * side;
      const ground = terrain.heightAt(px, pz);
      const onBridge = ground < hb - 1.5;
      const baseY = onBridge ? hb - 0.6 : Math.min(ground, hb - 0.5);
      const rot = Math.atan2(tx, tz);
      bl.place(px, baseY, pz, rot);
      bl.pattern(PAT.NONE, 0);
      bl.box(0, 0, 0, 0.26, hb - baseY + 6.0, 0.26, '#7d8790');
      bl.box(-1.4 * side, hb - baseY + 5.6, 0, 3.2, 0.14, 0.14, '#7d8790');
      bl.identity();
      if (!onBridge) colliders.addCircle(px, pz, 0.25, baseY - 1, hb + 6);
      const wx = b[0], wz = b[1];
      const cur = [[wx, hb + 5.1, wz], [wx, hb + 5.6, wz]];
      if (prevPole) for (let k = 0; k < 2; k++) wires.push([prevPole[k], cur[k]]);
      prevPole = cur;
    }
  }
  // 铁桥：地形低于轨面处
  for (let i = 1; i < P.length; i++) {
    const s = A[i];
    if (s < s0 || s > s1) continue;
    const a = P[i - 1], b = P[i];
    const ha = terrain.railHeight(A[i - 1]), hb = terrain.railHeight(s);
    const ga = terrain.heightAt(a[0], a[1]), gb = terrain.heightAt(b[0], b[1]);
    if (Math.min(ga, gb) > Math.min(ha, hb) - 1.4) continue;
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const len = Math.hypot(tx, tz);
    tx /= len;
    tz /= len;
    const nx = tz, nz = -tx;
    const bl = chunks.at(b[0], b[1]);
    bl.identity();
    bl.pattern(PAT.NONE, 0);
    const q = (p, o, h) => [p[0] + nx * o, h, p[1] + nz * o];
    for (const o of [1.25, -1.25]) {
      const c = '#4f6577';
      const yt = -0.3, yb = -1.5;
      bl.quad(q(a, o + 0.2, ha + yb), q(a, o + 0.2, ha + yt), q(b, o + 0.2, hb + yt), q(b, o + 0.2, hb + yb), c);
      bl.quad(q(a, o - 0.2, ha + yt), q(a, o - 0.2, ha + yb), q(b, o - 0.2, hb + yb), q(b, o - 0.2, hb + yt), c);
      bl.quad(q(a, o - 0.2, ha + yb), q(a, o + 0.2, ha + yb), q(b, o + 0.2, hb + yb), q(b, o - 0.2, hb + yb), '#3c4e5c');
    }
    // 桥面下表面
    bl.quad(q(a, -1.6, ha - 0.75), q(a, 1.6, ha - 0.75), q(b, 1.6, hb - 0.75), q(b, -1.6, hb - 0.75), '#6d6a64');
    // 桥墩
    if (i % 7 === 0) {
      const g = Math.min(ga, gb);
      bl.box(b[0], g - 2, b[1], 2.2, hb - 1.5 - g + 2, 2.2, '#a7a39a');
    }
  }
  // 隧道口
  for (const p of terrain.portals) {
    const b = chunks.at(p.x, p.z);
    // 洞口立面朝向山谷
    b.place(p.x, p.y - 1, p.z, p.dir + (p.side > 0 ? Math.PI : 0));
    b.pattern(PAT.BLOCK, 0);
    const poly = [[-9, 0], [9, 0], [9, 10.5], [-9, 10.5], [-9, 0]];
    // 拱门：面板 + 拱洞（黑）
    b.box(0, -1, 0, 18, 12, 1.4, '#a9a59b');
    b.pattern(PAT.NONE, 0);
    const arch = [];
    for (let k = 0; k <= 12; k++) {
      const a = Math.PI * (k / 12);
      arch.push([Math.cos(a) * 2.6, 3.2 + Math.sin(a) * 2.6]);
    }
    arch.push([-2.6, 0], [2.6, 0]);
    b.push();
    b.translate(0, 0, 0.72);
    b.extrudeXY(arch.map(([x, y]) => [x, y]).reverse(), 0, 0.02, '#0c0b0a', { noSides: true });
    b.pop();
    b.box(0, 11, 0.2, 18.4, 0.5, 1.8, '#9b978d');
  }
  return wires;
}

// ---------- 平交道口 ----------
export class Crossing {
  constructor(ctx, terrain, scene) {
    const road = ROADS.find((r) => r.name === '西通り');
    let best = null;
    road.pts.forEach((p, i) => {
      const q = railQuery(p[0], p[1], 20);
      if (q && (!best || q.d < best.d)) best = { d: q.d, i, s: q.s, x: q.cx, z: q.cz };
    });
    this.s = best.s;
    this.x = best.x;
    this.z = best.z;
    const pt = pointAt(railway.pts, railway.acc, best.s);
    this.tx = pt.tx;
    this.tz = pt.tz;
    const y = terrain.railHeight(best.s);
    this.y = y;
    const rot = Math.atan2(pt.tx, pt.tz);
    const b = ctx.chunks.at(this.x, this.z);
    // 道口铺板
    b.place(this.x, y, this.z, rot);
    b.pattern(PAT.NONE, 0);
    b.box(0, -0.12, 0, road.width + 1, 0.11, 2.6, '#55575c');
    // 两侧装置
    this.arms = [];
    this.lamps = [];
    const lampMat = new THREE.MeshBasicMaterial({ color: 0x3a0a08 });
    this.lampMat = lampMat;
    const lampOn = new THREE.MeshBasicMaterial({ color: 0xff3a22 });
    this.lampOn = lampOn;
    const armGeo = (() => {
      const g = new GeoBuilder();
      g.pattern(PAT.NONE, 0);
      for (let k = 0; k < 8; k++) g.box(0.25 + k * 0.6, -0.06, 0, 0.6, 0.12, 0.1, k % 2 ? '#1d1d1d' : '#f2d23a');
      return g.toGeometry();
    })();
    const armMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    this.group = new THREE.Group();
    for (const side of [1, -1]) {
      // 位于道路边缘、轨道两侧的对角
      const along = side * 3.4; // 沿轨道方向偏移（道路宽度方向）
      const across = side * 3.0; // 垂直轨道方向
      const lx = this.x + pt.tx * along + pt.tz * across;
      const lz = this.z + pt.tz * along - pt.tx * across;
      const ly = terrain.heightAt(lx, lz);
      const pb = ctx.chunks.at(lx, lz);
      // 标志与警灯朝向驶来的车辆（垂直于轨道）
      const prot = side > 0 ? Math.atan2(pt.tz, -pt.tx) : Math.atan2(-pt.tz, pt.tx);
      pb.place(lx, ly, lz, prot);
      pb.pattern(PAT.NONE, 0);
      for (let k = 0; k < 6; k++) pb.box(0, k * 0.5, 0, 0.14, 0.5, 0.14, k % 2 ? '#1d1d1d' : '#f2d23a');
      pb.box(0, 3.0, 0, 0.12, 1.2, 0.12, '#2b2b2b');
      // ×标志
      pb.push();
      pb.translate(0, 3.55, 0.12);
      for (const r of [0.75, -0.75]) {
        pb.push();
        pb.rotateZ(r);
        pb.box(0, -0.55, 0, 0.18, 1.1, 0.04, '#f2d23a');
        pb.pop();
      }
      pb.pop();
      pb.box(0, 2.55, 0.05, 0.9, 0.3, 0.1, '#1d1d1d');
      ctx.colliders.addCircle(lx, lz, 0.25, ly - 1, ly + 4);
      // 红灯（动态）
      for (const lxo of [-0.32, 0.32]) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), lampMat);
        const c = Math.cos(prot), s = Math.sin(prot);
        m.position.set(lx + lxo * c + 0.12 * s, ly + 2.55, lz - lxo * s + 0.12 * c);
        this.group.add(m);
        this.lamps.push(m);
        const back = m.clone();
        back.position.set(lx + lxo * c - 0.12 * s, ly + 2.55, lz - lxo * s - 0.12 * c);
        this.group.add(back);
        this.lamps.push(back);
      }
      // 栏杆臂：从立柱伸向道路中央
      const arm = new THREE.Mesh(armGeo, armMat);
      arm.position.set(lx, ly + 1.05, lz);
      // 局部 +x 指向道路中心（沿轨道方向的反方向）
      const dirx = -pt.tx * side, dirz = -pt.tz * side;
      arm.rotation.order = 'YZX';
      arm.rotation.y = Math.atan2(-dirz, dirx);
      arm.userData.base = arm.rotation.y;
      arm.castShadow = true;
      this.group.add(arm);
      this.arms.push(arm);
      // 放下时阻挡的碰撞体
      const ax = lx + dirx * 2.6, az = lz + dirz * 2.6;
      const col = ctx.colliders.addBox(ax, az, 2.6, 0.12, Math.atan2(-dirz, dirx), ly - 1, ly + 1.4);
      col.disabled = true;
      arm.userData.col = col;
    }
    scene.add(this.group);
    this.down = 0;
    this.active = false;
    this.blink = 0;
  }
  update(dt, active) {
    this.active = active;
    const target = active ? 1 : 0;
    this.down = clamp(this.down + (target > this.down ? dt / 3.5 : -dt / 2.5), 0, 1);
    const ang = (1 - smoothstep(0, 1, this.down)) * 1.45;
    for (const a of this.arms) {
      a.rotation.z = ang;
      a.userData.col.disabled = this.down < 0.6;
    }
    this.blink += dt;
    const phase = Math.floor(this.blink / 0.45) % 2;
    this.lamps.forEach((m, i) => {
      const on = active && (Math.floor(i / 2) % 2 === phase);
      m.material = on ? this.lampOn : this.lampMat;
    });
  }
}

// ---------- 电车 ----------
function buildCarGeometry(atlas, front, back) {
  const b = new GeoBuilder();
  const L = 19.5, W = 2.85, H = 3.55, y0 = 1.05;
  const ivory = '#f1ece0', pink = '#e58aa6', green = '#3f6b5c', dark = '#2a2c30';
  // 车体
  b.pattern(PAT.NONE, 0);
  b.box(0, y0, 0, L, H - 0.35, W, ivory, { faces: 'pznzpy' });
  // 车头/车尾
  const ends = [];
  if (front) ends.push(1);
  if (back) ends.push(-1);
  for (const e of [1, -1]) {
    const x = (e * L) / 2;
    b.push();
    b.translate(x, 0, 0);
    b.rotateY(e > 0 ? Math.PI / 2 : -Math.PI / 2);
    b.quad([-W / 2, y0, 0], [W / 2, y0, 0], [W / 2, y0 + H - 0.35, 0], [-W / 2, y0 + H - 0.35, 0], ivory);
    if (ends.includes(e)) {
      b.pattern(PAT.WINDOW, 0.6);
      b.quad([-1.2, y0 + 1.55, 0.03], [1.2, y0 + 1.55, 0.03], [1.2, y0 + 2.75, 0.03], [-1.2, y0 + 2.75, 0.03], dark, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      b.pattern(PAT.NONE, 1);
      for (const sx of [-1.05, 1.05]) b.box(sx, y0 + 0.75, 0.02, 0.32, 0.18, 0.06, '#fff6da');
      b.pattern(PAT.NONE, 0);
      b.box(0, y0 + 0.2, 0.05, W, 0.42, 0.12, pink);
    }
    b.pop();
  }
  // 腰带色
  b.box(0, y0 + 0.85, 0, L + 0.02, 0.32, W + 0.02, pink, { faces: 'pznz' });
  b.box(0, y0 + 0.62, 0, L + 0.02, 0.1, W + 0.02, green, { faces: 'pznz' });
  // 车窗与车门
  for (const sz of [1, -1]) {
    const z = (sz * W) / 2 + sz * 0.02;
    for (let k = 0; k < 7; k++) {
      const x = -L / 2 + 1.6 + k * 2.65;
      const isDoor = k === 1 || k === 5;
      b.pattern(PAT.WINDOW, 0.85);
      const w = isDoor ? 1.3 : 1.9, y = isDoor ? y0 + 0.1 : y0 + 1.25, h = isDoor ? 2.85 : 1.1;
      if (sz > 0) b.quad([x - w / 2, y, z], [x + w / 2, y, z], [x + w / 2, y + h, z], [x - w / 2, y + h, z], isDoor ? '#c9c4b8' : '#e9e6df', [[0, 0], [1, 0], [1, 1], [0, 1]]);
      else b.quad([x + w / 2, y, z], [x - w / 2, y, z], [x - w / 2, y + h, z], [x + w / 2, y + h, z], isDoor ? '#c9c4b8' : '#e9e6df', [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  }
  // 车顶（圆弧）
  b.pattern(PAT.NONE, 0);
  b.surface((u, v) => {
    const a = lerp(-1.25, 1.25, v);
    return [lerp(-L / 2, L / 2, u), y0 + H - 0.35 + Math.cos(a) * 0.45 - Math.cos(1.25) * 0.45, (Math.sin(a) * W) / 2 / Math.sin(1.25)];
  }, 4, 6, '#9aa1a6', { flip: false });
  // 受电弓
  if (front) {
    b.box(L / 2 - 4, y0 + H + 0.05, 0, 1.2, 0.18, 1.2, '#4a4d52');
    b.tube([[L / 2 - 4.5, y0 + H + 0.2, 0], [L / 2 - 3.6, y0 + H + 1.0, 0], [L / 2 - 4.2, y0 + H + 1.55, 0]], 0.04, 4, '#2d2f33');
    b.box(L / 2 - 4.2, y0 + H + 1.55, 0, 0.12, 0.06, 1.4, '#2d2f33');
  }
  // 车底与转向架
  b.box(0, 0.55, 0, L - 2, 0.5, W - 0.5, '#33363a');
  for (const sx of [-1, 1]) {
    b.box(sx * (L / 2 - 3.2), 0.25, 0, 2.6, 0.55, W - 0.7, '#25272a');
    for (const wx of [-0.9, 0.9]) for (const sz of [-1, 1]) b.cylinder(sx * (L / 2 - 3.2) + wx, 0.45, (sz * GAUGE) / 2, 0.43, 0.43, 0.1, 10, '#1d1e20');
  }
  return b.toGeometry();
}

export class Train {
  constructor(ctx, terrain, scene, material, atlas) {
    this.terrain = terrain;
    this.cars = [];
    this.carLen = 20;
    const geoA = buildCarGeometry(atlas, true, false);
    const geoB = buildCarGeometry(atlas, false, true);
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(k === 0 ? geoA : geoB, material);
      m.castShadow = true;
      m.receiveShadow = true;
      m.matrixAutoUpdate = true;
      m.name = 'trainCar';
      scene.add(m);
      const col = ctx.colliders.addDynamic({ type: 'box', x: 0, z: 0, hw: 10, hd: 1.55, rot: 0, y0: -100, y1: 100 });
      this.cars.push({ mesh: m, col });
    }
    this.stationS = ctx.station ? ctx.station.s : railway.total / 2;
    this.sMin = terrain.railS.west - 70;
    this.sMax = terrain.railS.east + 70;
    this.dir = 1;
    this.s = this.sMin;
    this.v = 0;
    this.state = 'wait';
    this.timer = 6;
    this.cruise = 13;
    this.acc = 0.9;
    this.listeners = [];
    this.visible = false;
    this.setVisible(false);
  }
  setVisible(v) {
    this.visible = v;
    for (const c of this.cars) {
      c.mesh.visible = v;
      c.col.disabled = !v;
    }
  }
  on(fn) {
    this.listeners.push(fn);
  }
  emit(ev) {
    for (const f of this.listeners) f(ev, this);
  }
  // 车头所在弧长
  get head() {
    return this.s;
  }
  update(dt) {
    switch (this.state) {
      case 'wait':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = 'run1';
          this.s = this.dir > 0 ? this.sMin : this.sMax;
          this.v = this.cruise;
          this.setVisible(true);
          this.emit('depart-tunnel');
        }
        break;
      case 'run1': {
        // 驶向车站，按需减速停靠
        const stopAt = this.stationS + this.dir * (this.carLen - 1);
        const dist = (stopAt - this.s) * this.dir;
        const brake = (this.v * this.v) / (2 * this.acc);
        if (dist <= brake + 0.5) this.v = Math.max(0.6, Math.sqrt(Math.max(0, 2 * this.acc * Math.max(dist, 0))));
        else this.v = Math.min(this.cruise, this.v + this.acc * dt);
        this.s += this.dir * this.v * dt;
        if (dist <= 0.3) {
          this.state = 'dwell';
          this.timer = 16;
          this.v = 0;
          this.emit('arrive');
        }
        break;
      }
      case 'dwell':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = 'run2';
          this.emit('depart');
        }
        break;
      case 'run2':
        this.v = Math.min(this.cruise, this.v + this.acc * dt);
        this.s += this.dir * this.v * dt;
        if ((this.dir > 0 && this.s > this.sMax) || (this.dir < 0 && this.s < this.sMin)) {
          this.state = 'wait';
          this.timer = 45 + Math.random() * 40;
          this.dir = -this.dir;
          this.setVisible(false);
          this.emit('gone');
        }
        break;
    }
    if (this.visible) this.place();
  }
  place() {
    for (let k = 0; k < this.cars.length; k++) {
      const c = this.cars[k];
      const sc = this.s - this.dir * (k * (this.carLen + 0.6) + this.carLen / 2);
      const sf = sc + this.dir * 7, sb = sc - this.dir * 7;
      const pf = pointAt(railway.pts, railway.acc, sf), pb = pointAt(railway.pts, railway.acc, sb);
      const yf = this.terrain.railHeight(sf), yb = this.terrain.railHeight(sb);
      const x = (pf.x + pb.x) / 2, z = (pf.z + pb.z) / 2, y = (yf + yb) / 2;
      const dx = pf.x - pb.x, dz = pf.z - pb.z;
      const yaw = Math.atan2(-dz, dx);
      c.mesh.position.set(x, y, z);
      c.mesh.rotation.set(0, yaw, Math.atan2(yf - yb, 14));
      c.col.x = x;
      c.col.z = z;
      c.col.rot = yaw;
      c.col.y0 = y - 1;
      c.col.y1 = y + 4.5;
    }
  }
  // 车体在弧长区间 [a, b] 内？
  occupies(s, margin) {
    const tail = this.s - this.dir * (2 * this.carLen + 0.6);
    const lo = Math.min(this.s, tail) - margin, hi = Math.max(this.s, tail) + margin;
    return this.visible && s > lo && s < hi;
  }
  approaching(s, dist) {
    if (!this.visible || this.state === 'dwell') return this.visible && this.occupies(s, 6);
    const d = (s - this.s) * this.dir;
    return (d > -2 * this.carLen - 8 && d < dist);
  }
}
