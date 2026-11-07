import * as THREE from 'three';
import { Character } from './character.js';
import { NPCS } from '../game/content.js';
import { GeoBuilder, PAT } from '../render/builder.js';
import { SITES, ROADS, riverNearest, riverHalfWidth, bankLevel } from '../world/layout.js';
import { pointAt, dampAngle, damp, clamp, lerp, RNG } from '../core/math.js';

// 计算 NPC 站位
function resolveSpots(world) {
  const ctx = world.ctx;
  const T = world.terrain;
  const S = { ...ctx.spots };
  const at = (x, z, rot = 0, y) => ({ x, z, y: y ?? T.heightAt(x, z), rot });
  const out = {};
  // 巫女
  if (S.miko) out.miko = at(S.miko[0], S.miko[1], S.shrineTop ? S.shrineTop[3] : 0, S.shrineTop ? S.shrineTop[1] : undefined);
  // 钓鱼老人：朱桥上游西岸压顶石上，面向河
  {
    const q0 = riverNearest(SITES.redBridge.x, SITES.redBridge.z);
    const q = riverNearest(q0.cx - q0.tx * 16, q0.cz - q0.tz * 16);
    const side = -1;
    const off = riverHalfWidth(q.s) + 1.1;
    const x = q.cx + q.tz * off * side, z = q.cz - q.tx * off * side;
    const rot = Math.atan2(q.cx - x, q.cz - z);
    out.gen = { x, z, y: bankLevel(q.s) + 0.14, rot };
  }
  const wag = (world.shopSpots || []).find((s) => s.shop.id === 'wagashi') || (world.shopSpots || [])[0];
  if (wag) out.okami = { x: wag.x - Math.cos(wag.rot) * 1.4, z: wag.z + Math.sin(wag.rot) * 1.4, y: wag.y, rot: wag.rot + Math.PI };
  if (S.stationAttendant) out.stationAttendant = at(S.stationAttendant[0], S.stationAttendant[1], 0, world.ctx.stationPlatY);
  // 画家：木桥附近西岸步道，面向河
  if (S.footBridge) {
    const q = riverNearest(S.footBridge[0], S.footBridge[2]);
    const q2 = riverNearest(q.cx - q.tx * 18, q.cz - q.tz * 18);
    const off = 12.2;
    const x = q2.cx - q2.tz * off, z = q2.cz + q2.tx * off;
    out.painter = { x, z, y: T.heightAt(x, z), rot: Math.atan2(q2.cx - x, q2.cz - z) };
  }
  // 公园长椅
  const park = SITES.park;
  let best = null;
  for (const b of ctx.benches) {
    const d = Math.hypot(b.x - park.x, b.z - park.z);
    if (d < 40 && (!best || d < best.d)) best = { ...b, d };
  }
  if (best) out.haru = { x: best.x, z: best.z, y: best.y, rot: best.rot, bench: best };
  if (ctx.hanami && ctx.hanami[0]) {
    const h = ctx.hanami[0];
    const c = Math.cos(h.rot), s = Math.sin(h.rot);
    const place = (lx, lz, r) => ({ x: h.x + lx * c + lz * s, z: h.z - lx * s + lz * c, y: h.y, rot: h.rot + r, sheet: true });
    out.hanami1 = place(-0.8, 0.6, Math.PI * 0.85);
    out.hanami2 = place(0.9, 0.5, -Math.PI * 0.8);
    out.hanami3 = place(0.1, -0.8, 0.1);
  }
  if (S.monk) out.monk = at(S.monk[0], S.monk[1], 0, S.templeTop ? S.templeTop[1] : undefined);
  if (S.pierEnd) out.photog = { x: S.pierEnd[0], z: S.pierEnd[1], y: S.pierEnd[2], rot: 0 };
  out.farmer = at(-98, 208, -Math.PI / 2);
  return out;
}

function routes(world) {
  const r = {};
  const road = (name) => ROADS.find((x) => x.name === name);
  const sample = (rd, a, b, n) => {
    const pts = [];
    const L = rd.acc[rd.acc.length - 1];
    for (let i = 0; i <= n; i++) {
      const s = lerp(a * L, b * L, i / n);
      const p = pointAt(rd.pts, rd.acc, s);
      pts.push([p.x + p.tz * 1.6, p.z - p.tx * 1.6]);
    }
    return pts;
  };
  const slope = road('学校の坂'), temple = road('寺への道');
  const a = sample(slope, 1, 0, 10);
  const b = sample(temple, 0.35, 0.02, 10).reverse();
  r.yui = [...a, ...b.reverse(), ...b, ...a.slice().reverse()];
  const P = SITES.park;
  r.takeru = [];
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    r.takeru.push([P.x + Math.cos(t) * 11 + 4, P.z + Math.sin(t) * 7 - 2]);
  }
  return r;
}

function propRod() {
  const b = new GeoBuilder();
  b.pattern(PAT.BAMBOO, 0);
  b.push();
  b.rotateX(-1.1);
  b.cylinder(0, -0.1, 0, 0.012, 0.02, 3.2, 5, '#b49a62');
  b.pop();
  return b.toGeometry();
}
function propBroom() {
  const b = new GeoBuilder();
  b.cylinder(0, -0.6, 0, 0.016, 0.016, 1.4, 5, '#a58a5a');
  b.cylinder(0, -0.95, 0, 0.12, 0.03, 0.4, 8, '#c9b07a', { bottom: true });
  return b.toGeometry();
}
function propEasel() {
  const b = new GeoBuilder();
  b.pattern(PAT.PLANK, 0);
  b.tube([[-0.35, 0, -0.1], [0, 1.7, 0]], 0.02, 4, '#7a5a40');
  b.tube([[0.35, 0, -0.1], [0, 1.7, 0]], 0.02, 4, '#7a5a40');
  b.tube([[0, 0, 0.45], [0, 1.6, 0.02]], 0.02, 4, '#7a5a40');
  b.pattern(PAT.NONE, 0);
  b.box(0, 0.75, -0.02, 0.7, 0.55, 0.03, '#f4efe4');
  // 画布上的小风景
  b.quad([-0.32, 0.8, -0.04], [0.32, 0.8, -0.04], [0.32, 1.27, -0.04], [-0.32, 1.27, -0.04], '#bcd4e6');
  b.quad([-0.32, 0.8, -0.045], [0.32, 0.8, -0.045], [0.32, 0.98, -0.045], [-0.32, 0.98, -0.045], '#9ec08a');
  b.sphere(-0.1, 1.05, -0.05, 0.12, 8, 6, '#f2b8c8', { sz: 0.1 });
  b.sphere(0.12, 1.0, -0.05, 0.09, 8, 6, '#f6c9d4', { sz: 0.1 });
  b.box(0, 0.48, 0, 0.75, 0.04, 0.12, '#7a5a40');
  return b.toGeometry();
}
function propStool() {
  const b = new GeoBuilder();
  b.cylinder(0, 0, 0, 0.18, 0.2, 0.38, 8, '#6d5038');
  return b.toGeometry();
}

export class NPC {
  constructor(def, world, material, spot, route) {
    this.def = def;
    this.world = world;
    this.char = new Character(def.look, material);
    this.object = this.char.root;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.baseYaw = 0;
    this.route = route;
    this.ri = 0;
    this.pause = 0;
    this.talkIndex = 0;
    this.lookYaw = 0;
    this.speedNow = 0;
    this.spot = spot;
    if (spot) {
      this.pos.set(spot.x, spot.y, spot.z);
      this.yaw = this.baseYaw = spot.rot;
    } else if (route) {
      const p = route[0];
      this.pos.set(p[0], world.terrain.heightAt(p[0], p[1]), p[1]);
    }
    this.seatY = null;
    if (def.behavior === 'sit' || def.behavior === 'fish') {
      this.seatY = spot && spot.sheet ? spot.y + 0.02 : spot && spot.bench ? spot.y + 0.03 : spot ? spot.y - 0.02 : 0;
      this.ground = !!(spot && spot.sheet);
      if (spot && spot.bench) {
        this.pos.x += Math.sin(spot.rot) * 0.08;
        this.pos.z += Math.cos(spot.rot) * 0.08;
      }
    }
    // 道具
    if (def.behavior === 'fish') {
      const rod = new THREE.Mesh(propRod(), material);
      rod.position.set(0, -0.24, 0.02);
      this.char.attach(rod, 'fArmR');
      const stool = new THREE.Mesh(propStool(), material);
      stool.position.set(0, 0, -0.1);
      this.object.add(stool);
    }
    if (def.behavior === 'sweep') {
      const br = new THREE.Mesh(propBroom(), material);
      br.position.set(0, -0.25, 0.05);
      br.rotation.x = 0.3;
      this.char.attach(br, 'fArmR');
    }
    if (def.behavior === 'paint') {
      const ea = new THREE.Mesh(propEasel(), material);
      ea.position.set(0.15, 0, 1.0);
      ea.rotation.y = Math.PI;
      this.object.add(ea);
      ea.castShadow = true;
    }
    this.col = world.colliders.addDynamic({ type: 'circle', x: this.pos.x, z: this.pos.z, r: 0.38, y0: this.pos.y - 1, y1: this.pos.y + 2 });
    this.sync();
  }
  get talkable() {
    return !this.def.mute;
  }
  nextLine(isNight) {
    const lines = isNight && this.def.night ? [...this.def.night, ...this.def.lines] : this.def.lines;
    const l = lines[this.talkIndex % lines.length];
    this.talkIndex++;
    return l;
  }
  update(dt, player) {
    const d = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    const near = d < 4.2;
    const toPlayer = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    let speed = 0;
    if (this.def.behavior === 'walk' && this.route) {
      if (near && d < 2.6) this.pause = Math.max(this.pause, 1.5);
      if (this.pause > 0) {
        this.pause -= dt;
        if (near) this.yaw = dampAngle(this.yaw, toPlayer, 5, dt);
      } else {
        const tgt = this.route[this.ri];
        const dx = tgt[0] - this.pos.x, dz = tgt[1] - this.pos.z;
        const l = Math.hypot(dx, dz);
        const v = this.def.fast ? 2.6 : 1.15;
        if (l < 0.5) {
          this.ri = (this.ri + 1) % this.route.length;
          if (Math.random() < 0.08) this.pause = 2 + Math.random() * 3;
        } else {
          this.pos.x += (dx / l) * v * dt;
          this.pos.z += (dz / l) * v * dt;
          this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 6, dt);
          speed = v;
        }
        this.pos.y = this.world.terrain.heightAt(this.pos.x, this.pos.z);
        const s = this.world.colliders.surfaceAt(this.pos.x, this.pos.z, this.pos.y + 0.5);
        if (s.h > this.pos.y) this.pos.y = s.h;
      }
    } else if (near && this.def.behavior !== 'fish' && this.def.behavior !== 'sit') {
      this.yaw = dampAngle(this.yaw, toPlayer, 3, dt);
    } else if (!near) {
      this.yaw = dampAngle(this.yaw, this.baseYaw, 1.5, dt);
    }
    // 坐着/钓鱼的人转头看玩家
    let ly = 0;
    if (near) {
      let rel = toPlayer - this.yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      ly = clamp(rel, -1.0, 1.0);
    }
    this.speedNow = damp(this.speedNow, speed, 6, dt);
    const b = this.def.behavior;
    this.char.update(dt, {
      speed: this.speedNow,
      sit: b === 'sit' && !this.ground,
      sitG: b === 'sit' && this.ground,
      fish: b === 'fish',
      sweep: b === 'sweep' && !near,
      paint: b === 'paint' && !near,
      wave: near && d < 3.2 && (b === 'idle' || b === 'walk') && this.waveTimer > 0,
      lookYaw: b === 'walk' && speed > 0.2 ? 0 : ly,
    });
    // 挥手：首次靠近时
    if (near && !this.greeted) {
      this.greeted = true;
      this.waveTimer = 1.6;
    }
    if (!near && d > 12) this.greeted = false;
    if (this.waveTimer > 0) this.waveTimer -= dt;
    this.col.x = this.pos.x;
    this.col.z = this.pos.z;
    this.col.y0 = this.pos.y - 1;
    this.col.y1 = this.pos.y + 1.8;
    this.sync();
  }
  sync() {
    this.object.position.set(this.pos.x, this.seatY ?? this.pos.y, this.pos.z);
    this.object.rotation.y = this.yaw;
  }
}

export function createNPCs(world, material, scene) {
  const spots = resolveSpots(world);
  const rts = routes(world);
  const list = [];
  for (const def of NPCS) {
    const spot = def.spot ? spots[def.spot] : null;
    const route = def.route ? rts[def.route] : null;
    if (def.spot && !spot) continue;
    const npc = new NPC(def, world, material, spot, route);
    scene.add(npc.object);
    list.push(npc);
  }
  return list;
}
