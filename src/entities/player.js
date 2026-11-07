import * as THREE from 'three';
import { Character } from './character.js';
import { clamp, damp, dampAngle, lerp } from '../core/math.js';
import { WORLD, riverNearest, riverHalfWidth, isCanal } from '../world/layout.js';

// 角色控制：加速度移动、碰撞、地面/桥面、浅水、陡坡与地图边界
// 第一人称时身体朝向视线，模型换成「只投影子」的隐形材质（低头能看见自己的影子）
export class Player {
  constructor(world, material) {
    this.world = world;
    this.char = new Character('traveler', material);
    this.bodyMat = material;
    this.ghostMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.ghost = false;
    this.object = this.char.root;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.radius = 0.33;
    this.height = 1.6;
    this.grounded = true;
    this.mode = 'walk'; // walk | sit | pet | gaze | locked
    this.walkToggle = false;
    this.speed = 0;
    this.stepAcc = 0;
    this.surface = 'grass';
    this.inWater = 0;
    this.listeners = {};
    this.airTime = 0;
    this.lastSafe = new THREE.Vector3();
    this.boundaryHit = 0;
  }
  setGhost(on) {
    if (on === this.ghost) return;
    this.ghost = on;
    this.char.mesh.material = on ? this.ghostMat : this.bodyMat;
  }
  on(ev, fn) {
    (this.listeners[ev] = this.listeners[ev] || []).push(fn);
  }
  emit(ev, data) {
    for (const f of this.listeners[ev] || []) f(data);
  }
  spawn(x, z, yaw) {
    const y = this.groundAt(x, z, 999);
    this.pos.set(x, y.h, z);
    this.lastSafe.copy(this.pos);
    this.yaw = yaw;
    this.vel.set(0, 0, 0);
    this.sync();
  }
  groundAt(x, z, fromY) {
    const T = this.world.terrain;
    let h = T.heightAt(x, z);
    let tag = null;
    const s = this.world.colliders.surfaceAt(x, z, fromY, 0.65);
    if (s.h > h) {
      h = s.h;
      tag = s.tag;
    }
    return { h, tag };
  }
  surfaceType(x, z, tag) {
    if (tag) return tag;
    if (this.inWater > 0.05) return 'water';
    const nr = this.world.terrain.nearestRoad(x, z, 6);
    if (nr && nr.d < nr.road.width / 2 + 0.2) {
      const t = nr.road.type;
      return t === 'stone' || t === 'promenade' ? 'stone' : t === 'asphalt' ? 'asphalt' : 'gravel';
    }
    const k = this.world.terrain.classAt(x, z);
    return ['grass', 'dirt', 'gravel', 'stone', 'sand', 'mud', 'water', 'stone', 'grass'][k] || 'grass';
  }
  update(dt, input, camYaw, opts = {}) {
    const locked = this.mode !== 'walk' || opts.locked;
    // 移动输入（相对相机）
    let mx = 0, mz = 0;
    if (!locked) {
      const f = [-Math.sin(camYaw), -Math.cos(camYaw)], r = [Math.cos(camYaw), -Math.sin(camYaw)];
      mx = f[0] * input.move.y + r[0] * input.move.x;
      mz = f[1] * input.move.y + r[1] * input.move.x;
    }
    const mag = Math.min(1, Math.hypot(mx, mz));
    let running = input.isDown('run') !== this.walkToggle;
    if (input.lastInput === 'touch' || input.lastInput === 'gamepad') running = running || input.moveMag > 0.92;
    const maxSpeed = (running ? 6.6 : 3.0) * (this.inWater > 0.25 ? 0.55 : 1);
    const want = new THREE.Vector2(mx, mz).multiplyScalar(maxSpeed * (mag > 0 ? 1 : 0) * Math.max(mag, 0.35));
    const accel = this.grounded ? (mag > 0 ? 12 : 14) : 3;
    const hv = new THREE.Vector2(this.vel.x, this.vel.z);
    hv.x = damp(hv.x, want.x, accel * 0.6, dt);
    hv.y = damp(hv.y, want.y, accel * 0.6, dt);
    this.vel.x = hv.x;
    this.vel.z = hv.y;
    // 跳
    if (!locked && this.grounded && input.wasPressed('jump')) {
      this.vel.y = 5.4;
      this.grounded = false;
      this.emit('jump');
    }
    this.vel.y -= 18 * dt;
    // 水平移动 + 碰撞
    const prev = this.pos.clone();
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.world.colliders.resolve(this.pos, this.radius, this.height);
    // 陡坡与深水阻挡
    let g = this.groundAt(this.pos.x, this.pos.z, this.pos.y);
    const rise = g.h - prev.y;
    const horiz = Math.hypot(this.pos.x - prev.x, this.pos.z - prev.z) + 1e-5;
    if (this.grounded && rise > 0.12 && rise / horiz > 1.25) {
      this.pos.x = prev.x;
      this.pos.z = prev.z;
      this.vel.x *= 0.2;
      this.vel.z *= 0.2;
      g = this.groundAt(this.pos.x, this.pos.z, this.pos.y);
    }
    // 运河压顶石与护岸斜面不可站立（桥面除外）
    if (!g.tag) {
      const rq = riverNearest(this.pos.x, this.pos.z);
      if (isCanal(rq.s) && rq.d < riverHalfWidth(rq.s) + 2.35) {
        this.pos.x = prev.x;
        this.pos.z = prev.z;
        this.vel.x *= 0.2;
        this.vel.z *= 0.2;
        g = this.groundAt(this.pos.x, this.pos.z, this.pos.y);
      }
    }
    const water = this.world.terrain.waterAt(this.pos.x, this.pos.z);
    const depth = water - g.h;
    if (!g.tag && depth > 0.75) {
      this.pos.x = prev.x;
      this.pos.z = prev.z;
      this.vel.x *= -0.1;
      this.vel.z *= -0.1;
      g = this.groundAt(this.pos.x, this.pos.z, this.pos.y);
      this.emit('blocked', 'water');
    }
    this.inWater = !g.tag && water > g.h ? clamp(water - g.h, 0, 1) : 0;
    // 地图边界
    const r = Math.hypot(this.pos.x - 10, this.pos.z - 20);
    if (r > WORLD.playRadius) {
      const k = WORLD.playRadius / r;
      this.pos.x = 10 + (this.pos.x - 10) * k;
      this.pos.z = 20 + (this.pos.z - 20) * k;
      this.boundaryHit += dt;
      if (this.boundaryHit > 0.4) {
        this.emit('boundary');
        this.boundaryHit = -6;
      }
    }
    // 垂直
    this.pos.y += this.vel.y * dt;
    g = this.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.05);
    const wasGrounded = this.grounded;
    if (this.pos.y <= g.h + 0.02) {
      if (!wasGrounded && this.airTime > 0.25) this.emit('land', Math.min(1, -this.vel.y / 9));
      this.pos.y = g.h;
      this.vel.y = 0;
      this.grounded = true;
      this.airTime = 0;
    } else if (wasGrounded && this.vel.y <= 0 && this.pos.y - g.h < 0.55) {
      // 下坡吸附
      this.pos.y = g.h;
      this.vel.y = 0;
    } else {
      this.grounded = false;
      this.airTime += dt;
    }
    if (this.pos.y < -20) this.pos.copy(this.lastSafe);
    if (this.grounded && this.inWater < 0.2) this.lastSafe.copy(this.pos);
    // 朝向
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.speed = sp;
    if (opts.faceYaw !== undefined && this.mode === 'walk') this.yaw = dampAngle(this.yaw, opts.faceYaw, 14, dt);
    else if (sp > 0.3 && !locked) this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 10, dt);
    // 脚步
    if (this.grounded && sp > 0.6) {
      this.stepAcc += sp * dt;
      const stride = sp > 4 ? 1.05 : 0.72;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        this.surface = this.surfaceType(this.pos.x, this.pos.z, g.tag);
        this.emit('step', { surface: this.surface, run: sp > 4, x: this.pos.x, z: this.pos.z });
      }
    }
    this.char.update(dt, {
      speed: this.grounded ? sp : 0,
      air: !this.grounded,
      sit: this.mode === 'sit',
      pet: this.mode === 'pet',
      crouch: this.mode === 'pet',
      gaze: this.mode === 'gaze',
      lookYaw: opts.lookYaw || 0,
    });
    this.sync();
  }
  sync() {
    const o = this.object;
    o.position.copy(this.pos);
    if (this.mode === 'sit' && this.seat) o.position.y = this.seat.y;
    o.position.y -= this.inWater * 0.35;
    o.rotation.y = this.yaw;
  }
  // 坐到长椅上
  sitOn(bench) {
    this.mode = 'sit';
    this.seat = { y: (bench.seatY ?? bench.y + 0.45) - 0.44 };
    this.pos.set(bench.x + Math.sin(bench.rot) * 0.08, bench.y, bench.z + Math.cos(bench.rot) * 0.08);
    this.yaw = bench.rot;
    this.vel.set(0, 0, 0);
  }
  standUp() {
    if (this.mode === 'sit' && this.seat) {
      this.pos.x += Math.sin(this.yaw) * 0.7;
      this.pos.z += Math.cos(this.yaw) * 0.7;
      this.pos.y = this.groundAt(this.pos.x, this.pos.z, this.pos.y + 1).h;
    }
    this.mode = 'walk';
    this.seat = null;
  }
}
