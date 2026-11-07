import * as THREE from 'three';
import { GeoBuilder, PAT, C } from '../render/builder.js';
import { CATS } from '../game/content.js';
import { SITES, ROADS } from '../world/layout.js';
import { noise2, damp, dampAngle, clamp, lerp, pointAt } from '../core/math.js';

function catColorFn(cat, ox = 0, oy = 0, oz = 0) {
  const [c0, c1, c2] = cat.colors.map((h) => C(h));
  return (x, y, z) => {
    const X = x + ox, Y = y + oy, Z = z + oz;
    switch (cat.pattern) {
      case 'calico': {
        const n = noise2(X * 7 + Z * 3, Y * 7 - Z * 2);
        return n > 0.32 ? c1 : n < -0.38 ? c2 : c0;
      }
      case 'tabby': {
        if (Y < 0.07 && Z > -0.05) return c2;
        const st = Math.sin(X * 34 + Z * 10 + noise2(Y * 8, Z * 8) * 2.5);
        return st > 0.35 ? c1 : c0;
      }
      case 'tortie':
        return noise2(X * 9 + 1, Y * 9 + Z * 9) > 0 ? c0 : c1;
      case 'tuxedo':
        return Z > 0.06 && Y < 0.24 ? c0 : c1;
      default:
        return c0;
    }
  };
}

function sphereGeo(r, sx = 1, sy = 1, sz = 1, w = 12, h = 9) {
  const g = new THREE.SphereGeometry(r, w, h);
  g.scale(sx, sy, sz);
  return g;
}

// 猫：身体（静态姿势）+ 头 + 尾巴
export function buildCat(cat, material) {
  const group = new THREE.Group();
  const pose = cat.pose;
  const body = new GeoBuilder();
  const cf = (ox, oy, oz) => catColorFn(cat, ox, oy, oz);
  let headPos, tailBase, tailDir;
  if (pose === 'sit') {
    body.push(); body.translate(0, 0.17, -0.02); body.rotateX(-0.35);
    body.geometry(sphereGeo(0.12, 1, 1.45, 1.05), '#fff', { colorFn: cf(0, 0.17, -0.02) });
    body.pop();
    body.push(); body.translate(0, 0.07, -0.08);
    body.geometry(sphereGeo(0.12, 1.15, 0.7, 1.15), '#fff', { colorFn: cf(0, 0.07, -0.08) });
    body.pop();
    for (const sx of [-0.045, 0.045]) {
      body.push(); body.translate(sx, 0.09, 0.07);
      body.geometry(new THREE.CylinderGeometry(0.022, 0.026, 0.18, 6), '#fff', { colorFn: cf(sx, 0.09, 0.07) });
      body.pop();
      body.push(); body.translate(sx, 0.01, 0.085);
      body.geometry(sphereGeo(0.028, 1, 0.6, 1.3, 8, 6), cat.pattern === 'tuxedo' ? cat.colors[0] : '#fff', { colorFn: cat.pattern === 'tuxedo' ? null : cf(sx, 0, 0.09) });
      body.pop();
    }
    headPos = [0, 0.36, 0.06];
    tailBase = [0, 0.04, -0.17];
    tailDir = 'curl';
  } else if (pose === 'loaf') {
    body.push(); body.translate(0, 0.1, 0);
    body.geometry(sphereGeo(0.14, 1.0, 0.75, 1.55), '#fff', { colorFn: cf(0, 0.1, 0) });
    body.pop();
    headPos = [0, 0.2, 0.2];
    tailBase = [0.05, 0.05, -0.2];
    tailDir = 'side';
  } else {
    // sleep：蜷成一团
    body.push(); body.translate(0, 0.08, 0);
    body.geometry(sphereGeo(0.16, 1.25, 0.55, 1.05), '#fff', { colorFn: cf(0, 0.08, 0) });
    body.pop();
    headPos = [0.12, 0.09, 0.09];
    tailBase = [-0.12, 0.05, -0.05];
    tailDir = 'wrap';
  }
  const bodyMesh = new THREE.Mesh(body.toGeometry(), material);
  bodyMesh.castShadow = true;
  group.add(bodyMesh);
  // 头
  const head = new GeoBuilder();
  head.geometry(sphereGeo(0.085, 1.1, 0.95, 1.0), '#fff', { colorFn: catColorFn(cat, headPos[0], headPos[1], headPos[2]) });
  for (const sx of [-1, 1]) {
    head.push(); head.translate(sx * 0.05, 0.07, -0.005); head.rotateZ(-sx * 0.35);
    head.geometry(new THREE.ConeGeometry(0.03, 0.06, 4), cat.colors[cat.pattern === 'tuxedo' ? 1 : 0]);
    head.geometry(new THREE.ConeGeometry(0.018, 0.035, 4).translate(0, -0.006, 0.006), '#e7a6a6');
    head.pop();
  }
  // 口鼻
  head.push(); head.translate(0, -0.025, 0.07);
  head.geometry(sphereGeo(0.035, 1.3, 0.8, 0.8, 8, 6), cat.pattern === 'tuxedo' || cat.pattern === 'calico' || cat.pattern === 'tabby' ? '#f6f1ea' : cat.colors[0]);
  head.pop();
  head.push(); head.translate(0, -0.012, 0.096);
  head.geometry(sphereGeo(0.009, 1.2, 0.8, 0.8, 6, 4), '#e58f97');
  head.pop();
  const eyes = new GeoBuilder();
  for (const sx of [-1, 1]) {
    eyes.push(); eyes.translate(sx * 0.032, 0.012, 0.072);
    eyes.geometry(sphereGeo(0.014, 1, 1.2, 0.5, 8, 6), cat.eyes || '#9cbf4a');
    eyes.geometry(sphereGeo(0.006, 0.7, 1.7, 0.5, 6, 4).translate(0, 0, 0.006), '#141414');
    eyes.pop();
  }
  const headGroup = new THREE.Group();
  headGroup.position.set(...headPos);
  const headMesh = new THREE.Mesh(head.toGeometry(), material);
  headMesh.castShadow = true;
  const eyeMesh = new THREE.Mesh(eyes.toGeometry(), material);
  headGroup.add(headMesh, eyeMesh);
  group.add(headGroup);
  // 尾巴
  const tail = new GeoBuilder();
  let pts;
  if (tailDir === 'curl') pts = [[0, 0, 0], [0.08, 0, -0.04], [0.16, 0.0, 0.04], [0.15, 0.01, 0.14]];
  else if (tailDir === 'side') pts = [[0, 0, 0], [0.1, 0, -0.06], [0.16, 0.01, 0.06], [0.14, 0.01, 0.17]];
  else pts = [[0, 0, 0], [-0.05, 0, 0.12], [0.04, 0.0, 0.2], [0.14, 0.01, 0.18]];
  tail.tube(pts, [0.028, 0.026, 0.022, 0.016], 6, cat.colors[cat.pattern === 'calico' ? 1 : cat.pattern === 'tuxedo' ? 1 : 0], { capEnd: true });
  const tailMesh = new THREE.Mesh(tail.toGeometry(), material);
  tailMesh.position.set(...tailBase);
  tailMesh.castShadow = true;
  group.add(tailMesh);
  group.scale.setScalar(1.35);
  return { group, head: headGroup, eyes: eyeMesh, tail: tailMesh, pose };
}

// 爱心粒子
function heartTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#ff7a9a';
  g.beginPath();
  g.moveTo(32, 54);
  g.bezierCurveTo(4, 34, 8, 8, 32, 20);
  g.bezierCurveTo(56, 8, 60, 34, 32, 54);
  g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Hearts {
  constructor(scene) {
    this.tex = heartTexture();
    this.pool = [];
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, fog: false }));
      s.visible = false;
      s.scale.setScalar(0.25);
      scene.add(s);
      this.pool.push({ s, life: 0, v: new THREE.Vector3() });
    }
  }
  burst(pos, n = 6) {
    let k = 0;
    for (const p of this.pool) {
      if (p.life > 0) continue;
      p.life = 1.6 + Math.random() * 0.6;
      p.s.visible = true;
      p.s.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.2, (Math.random() - 0.5) * 0.4));
      p.v.set((Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.4, (Math.random() - 0.5) * 0.3);
      if (++k >= n) break;
    }
  }
  update(dt) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.s.position.addScaledVector(p.v, dt);
      p.s.material.opacity = clamp(p.life, 0, 1);
      p.s.scale.setScalar(0.18 + (1.6 - p.life) * 0.06);
      if (p.life <= 0) p.s.visible = false;
    }
  }
}

export class Cat {
  constructor(def, world, material, spot) {
    this.def = def;
    this.model = buildCat(def, material);
    this.object = this.model.group;
    this.pos = new THREE.Vector3(spot.x, spot.y, spot.z);
    this.object.position.copy(this.pos);
    this.object.rotation.y = spot.rot || 0;
    this.yaw = spot.rot || 0;
    this.t = Math.random() * 10;
    this.happy = 0;
    this.found = false;
    this.headYaw = 0;
    world.colliders.addCircle(spot.x, spot.z, 0.28, spot.y - 0.5, spot.y + 0.5, 'low');
  }
  pet() {
    this.happy = 5;
  }
  update(dt, player) {
    this.t += dt;
    const m = this.model;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    // 头看向玩家（睡着的猫只在被摸时抬头）
    let target = 0;
    if (d < 6 && (m.pose !== 'sleep' || this.happy > 0)) {
      let rel = Math.atan2(dx, dz) - this.yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      target = clamp(rel, -1.1, 1.1);
    }
    this.headYaw = damp(this.headYaw, target, 4, dt);
    m.head.rotation.y = this.headYaw + Math.sin(this.t * 0.5) * 0.08;
    m.head.rotation.z = this.happy > 0 ? Math.sin(this.t * 2) * 0.15 + 0.15 : 0;
    m.head.rotation.x = m.pose === 'sleep' && this.happy <= 0 ? 0.25 : 0;
    // 眼睛：睡着/开心时眯起
    const shut = m.pose === 'sleep' && this.happy <= 0 ? 0.12 : this.happy > 0 ? 0.25 : 1;
    const blink = Math.sin(this.t * 1.3) > 0.985 ? 0.1 : 1;
    m.eyes.scale.y = damp(m.eyes.scale.y, Math.min(shut, blink), 12, dt);
    m.tail.rotation.y = Math.sin(this.t * (this.happy > 0 ? 3.2 : 1.1)) * (this.happy > 0 ? 0.45 : 0.18);
    if (this.happy > 0) this.happy -= dt;
  }
}

// 集齐七只猫后跟随的小猫
export class Kitten {
  constructor(material, scene) {
    const def = { colors: ['#f3e2d3', '#e8b48a', '#f8f0e8'], pattern: 'calico', pose: 'loaf' };
    this.model = buildCat(def, material);
    this.model.group.scale.setScalar(0.9);
    this.legs = [];
    const legGeo = new THREE.CylinderGeometry(0.02, 0.018, 0.12, 6).translate(0, -0.06, 0);
    const legMat = material;
    for (const [x, z] of [[-0.05, 0.12], [0.05, 0.12], [-0.05, -0.12], [0.05, -0.12]]) {
      const g = new THREE.Mesh(legGeo, legMat);
      g.position.set(x, 0.08, z);
      this.model.group.add(g);
      this.legs.push(g);
    }
    this.model.group.children[0].position.y = 0.06;
    this.object = this.model.group;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.t = 0;
    this.active = false;
    this.object.visible = false;
    scene.add(this.object);
  }
  activate(at) {
    this.active = true;
    this.object.visible = true;
    this.pos.copy(at);
  }
  update(dt, player, terrain) {
    if (!this.active) return;
    this.t += dt;
    const behind = new THREE.Vector3(player.pos.x - Math.sin(player.yaw) * 1.4 + Math.cos(player.yaw) * 0.5, 0, player.pos.z - Math.cos(player.yaw) * 1.4 - Math.sin(player.yaw) * 0.5);
    const dx = behind.x - this.pos.x, dz = behind.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    let sp = 0;
    if (d > 0.4) {
      sp = Math.min(d * 2.2, 7.5);
      this.pos.x += (dx / d) * sp * dt;
      this.pos.z += (dz / d) * sp * dt;
      this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 8, dt);
    } else this.yaw = dampAngle(this.yaw, player.yaw, 2, dt);
    if (d > 25) this.pos.copy(behind);
    this.pos.y = Math.max(terrain.heightAt(this.pos.x, this.pos.z), player.pos.y - 0.3);
    this.object.position.copy(this.pos);
    this.object.position.y += Math.abs(Math.sin(this.t * 12)) * 0.02 * Math.min(sp, 1);
    this.object.rotation.y = this.yaw;
    const k = Math.min(sp / 2, 1);
    this.legs.forEach((l, i) => (l.rotation.x = Math.sin(this.t * 14 + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.6 * k));
    this.model.tail.rotation.y = Math.sin(this.t * 2) * 0.3;
  }
}

export function catSpots(world) {
  const ctx = world.ctx;
  const T = world.terrain;
  const S = ctx.spots;
  const out = {};
  if (S.stationBench) {
    out.mike = { x: S.stationBench[0], z: S.stationBench[1], y: ctx.stationPlatY + 0.49, rot: 0.5 };
  }
  if (S.shrineCat) out.kuro = { x: S.shrineCat[0], z: S.shrineCat[1], y: SITES.shrine.top, rot: S.shrineTop ? S.shrineTop[3] : 0 };
  const fish = (world.shopSpots || []).find((s) => s.shop.id === 'fish') || (world.shopSpots || [])[3];
  if (fish) {
    const x = fish.x + Math.cos(fish.rot) * 1.6, z = fish.z - Math.sin(fish.rot) * 1.6;
    out.chatora = { x, z, y: T.heightAt(x, z), rot: fish.rot };
  }
  {
    const A = SITES.ancient;
    const x = A.x + 4.2, z = A.z + 3.4;
    out.shiro = { x, z, y: T.heightAt(x, z), rot: 2.4 };
  }
  {
    const r = ROADS.find((x) => x.name === '竹林の小径');
    const p = pointAt(r.pts, r.acc, r.acc[r.acc.length - 1] * 0.55);
    const x = p.x + p.tz * 2.4, z = p.z - p.tx * 2.4;
    out.hai = { x, z, y: T.heightAt(x, z), rot: Math.atan2(-p.tz, p.tx) };
  }
  if (S.pierStart) {
    const x = S.pierStart[0] + 1.2, z = S.pierStart[1] + 1.4;
    out.sabi = { x, z, y: Math.max(T.heightAt(x, z), S.pierStart[2] - 0.05), rot: 2.2 };
  }
  if (S.pagoda) {
    const rot = S.templeTop ? S.templeTop[3] : 0;
    // 五重塔石台半宽 4.8 m：猫睡在台面靠外的位置，而不是悬在边缘外
    const x = S.pagoda[0] + Math.sin(rot) * 4.15 + Math.cos(rot) * 2.4, z = S.pagoda[2] + Math.cos(rot) * 4.15 - Math.sin(rot) * 2.4;
    out.hachi = { x, z, y: S.pagoda[1] + 0.7, rot };
  }
  return out;
}

export function createCats(world, material, scene) {
  const spots = catSpots(world);
  const list = [];
  for (const def of CATS) {
    const sp = spots[def.id];
    if (!sp) continue;
    const c = new Cat(def, world, material, sp);
    scene.add(c.object);
    list.push(c);
  }
  return list;
}
