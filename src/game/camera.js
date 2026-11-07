import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp } from '../core/math.js';
import { settings } from '../core/settings.js';

// 相机：默认第一人称（眼高、步伐起伏、落地缓冲），可切换第三人称跟随；另有电影镜头与拍照自由飞行
// 约定：yaw 表示「视线反方向」的水平角，视线前方 = (-sin yaw, -cos yaw)，与第三人称相机所在方位一致
export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.view = settings.view === 'third' ? 'third' : 'first';
    this.yaw = 0;
    this.pitch = 0.32; // 第三人称：相机仰角
    this.fpPitch = 0; // 第一人称：视线俯仰（向上为正）
    this.dist = 6.2;
    this.distTarget = 6.2;
    this.distSmooth = 6.2;
    this.target = new THREE.Vector3();
    this.smoothTarget = new THREE.Vector3();
    this.mode = 'follow';
    this.cine = null;
    this.free = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
    this.shake = 0;
    this.fovBase = 55;
    this.idleTime = 0;
    // 第一人称状态
    this.eye = new THREE.Vector3();
    this.bobPhase = 0;
    this.bobAmt = 0;
    this.dip = 0; // 落地下沉
    this.dipV = 0;
    this.roll = 0;
    this.aim = null; // 自动转向的目标点 { pos, t }
  }
  get firstPerson() {
    return this.view === 'first';
  }
  setView(v) {
    this.view = v === 'third' ? 'third' : 'first';
    if (this.view === 'third') {
      // 第三人称相机放在视线后方
      this.pitch = clamp(0.28 - this.fpPitch * 0.5, -0.2, 1.0);
    } else {
      this.fpPitch = clamp(0.1 - this.pitch * 0.4, -0.4, 0.3);
    }
    this.applyLens(true);
  }
  // 视线前方向量（第一人称）
  forward(out = new THREE.Vector3()) {
    const cp = Math.cos(this.fpPitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.fpPitch), -Math.cos(this.yaw) * cp);
  }
  // 让视线在短时间内平滑转向某点（交谈、抚摸猫时）
  aimAt(pos, dur = 0.7) {
    this.aim = { pos: pos.clone(), t: dur };
  }
  // 由玩家朝向（角色约定 (sin, cos)）设置视线
  faceCharYaw(charYaw, pitch = this.fpPitch) {
    this.yaw = charYaw + Math.PI;
    this.fpPitch = pitch;
  }
  // 根据视口比例取一个舒适的视野：横向约 88°，竖屏时不超过 75°
  fpFov() {
    const asp = this.camera.aspect || 1.5;
    const h = (88 * Math.PI) / 180;
    const v = (2 * Math.atan(Math.tan(h / 2) / asp) * 180) / Math.PI;
    return clamp(v, 52, 75);
  }
  applyLens(force = false) {
    const cam = this.camera;
    const near = this.firstPerson && this.mode !== 'photo' ? 0.12 : 0.25;
    if (cam.near !== near || force) {
      cam.near = near;
      cam.updateProjectionMatrix();
    }
  }
  snap(target) {
    this.target.copy(target);
    this.smoothTarget.copy(target);
    this.eye.copy(target);
    this.distSmooth = this.distTarget;
  }
  handleLook(input, dt) {
    const inv = settings.invertY ? -1 : 1;
    if (input.look.x || input.look.y) {
      this.idleTime = 0;
      this.aim = null;
    }
    if (this.firstPerson) {
      const sens = 0.0034 * settings.sensitivity;
      this.yaw -= input.look.x * sens;
      this.fpPitch = clamp(this.fpPitch - input.look.y * sens * inv, -1.35, 1.35);
      return;
    }
    const sens = 0.0042 * settings.sensitivity;
    this.yaw -= input.look.x * sens;
    this.pitch += input.look.y * sens * inv;
    this.pitch = clamp(this.pitch, -0.35, 1.25);
    if (input.wheel) this.distTarget = clamp(this.distTarget + input.wheel * 0.7, 2.4, 16);
    if (input.isDown('zoomIn')) this.distTarget = clamp(this.distTarget - dt * 6, 2.4, 16);
    if (input.isDown('zoomOut')) this.distTarget = clamp(this.distTarget + dt * 6, 2.4, 16);
  }
  // 电影镜头：{ pos, look, dur }，或函数
  cinematic(fn) {
    this.mode = 'cine';
    this.cine = fn;
  }
  follow() {
    if (this.mode === 'cine' && this.firstPerson) {
      // 从电影镜头回到第一人称时，沿用当前的视线方向
      const d = new THREE.Vector3();
      this.camera.getWorldDirection(d);
      this.yaw = Math.atan2(-d.x, -d.z);
      this.fpPitch = clamp(Math.asin(clamp(d.y, -1, 1)), -0.6, 0.6);
    }
    this.mode = 'follow';
    this.cine = null;
    this.applyLens();
  }
  startPhoto() {
    this.mode = 'photo';
    this.free.pos.copy(this.camera.position);
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    this.free.yaw = Math.atan2(-d.x, -d.z);
    this.free.pitch = Math.asin(clamp(d.y, -1, 1));
    this.applyLens();
  }
  // 落地时的轻微下沉
  land(k) {
    this.dipV -= 0.9 * k + 0.25;
  }
  update(dt, input, focus, player) {
    const cam = this.camera;
    if (this.mode === 'photo') {
      const sens = 0.0035 * settings.sensitivity;
      this.free.yaw -= input.look.x * sens;
      this.free.pitch = clamp(this.free.pitch - input.look.y * sens * (settings.invertY ? -1 : 1), -1.4, 1.4);
      const fw = new THREE.Vector3(-Math.sin(this.free.yaw) * Math.cos(this.free.pitch), Math.sin(this.free.pitch), -Math.cos(this.free.yaw) * Math.cos(this.free.pitch));
      const rt = new THREE.Vector3(Math.cos(this.free.yaw), 0, -Math.sin(this.free.yaw));
      const sp = (input.isDown('run') ? 14 : 5) * dt;
      this.free.pos.addScaledVector(fw, input.move.y * sp).addScaledVector(rt, input.move.x * sp);
      if (input.isDown('up') || input.isDown('jump')) this.free.pos.y += sp;
      if (input.isDown('down')) this.free.pos.y -= sp;
      // 限制在角色附近 60 米内
      const off = this.free.pos.clone().sub(focus);
      if (off.length() > 60) this.free.pos.copy(focus).add(off.setLength(60));
      const gy = this.world.terrain.heightAt(this.free.pos.x, this.free.pos.z) + 0.4;
      if (this.free.pos.y < gy) this.free.pos.y = gy;
      cam.position.copy(this.free.pos);
      cam.lookAt(this.free.pos.clone().add(fw));
      if (input.wheel) cam.fov = clamp(cam.fov + input.wheel * 2, 20, 80);
      cam.updateProjectionMatrix();
      return;
    }
    if (this.mode === 'cine' && this.cine) {
      const r = this.cine(dt);
      if (r) {
        cam.position.lerp(r.pos, 1 - Math.exp(-(r.lambda || 2) * dt));
        const look = r.look;
        this._look = this._look || look.clone();
        this._look.lerp(look, 1 - Math.exp(-(r.lambda || 2) * dt));
        cam.lookAt(this._look);
        if (r.fov) {
          cam.fov = damp(cam.fov, r.fov, 2, dt);
          cam.updateProjectionMatrix();
        }
        return;
      }
      this.follow();
    }
    this._look = null;
    if (this.firstPerson) this.updateFirst(dt, focus, player);
    else this.updateThird(dt, focus, player);
  }
  updateFirst(dt, focus, player) {
    const cam = this.camera;
    this.applyLens();
    // 自动转向（交谈、抚摸）
    if (this.aim) {
      this.aim.t -= dt;
      const d = this.aim.pos.clone().sub(this.eye);
      const tYaw = Math.atan2(-d.x, -d.z);
      const tPitch = clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -1.2, 1.0);
      this.yaw = dampAngle(this.yaw, tYaw, 6, dt);
      this.fpPitch = damp(this.fpPitch, tPitch, 6, dt);
      if (this.aim.t <= 0) this.aim = null;
    }
    // 眼睛跟随：水平立即跟上，高度略作平滑（台阶、坐下、蹲下）
    if (this.eye.distanceToSquared(focus) > 25) this.eye.copy(focus);
    this.eye.x = focus.x;
    this.eye.z = focus.z;
    this.eye.y = damp(this.eye.y, focus.y, 16, dt);
    // 步伐起伏
    const sp = player ? player.speed : 0;
    const grounded = player ? player.grounded && player.mode === 'walk' : false;
    const run = clamp((sp - 3.5) / 3, 0, 1);
    const on = settings.headBob !== false;
    this.bobAmt = damp(this.bobAmt, grounded && sp > 0.4 && on ? 1 : 0, 6, dt);
    this.bobPhase += (sp / lerp(1.44, 2.1, run)) * Math.PI * 2 * dt;
    const ay = lerp(0.028, 0.05, run) * this.bobAmt;
    const ax = lerp(0.018, 0.03, run) * this.bobAmt;
    const by = -Math.abs(Math.sin(this.bobPhase)) * ay + ay * 0.5;
    const bx = Math.sin(this.bobPhase) * ax;
    // 落地缓冲（阻尼弹簧）
    this.dipV += (-this.dip * 90 - this.dipV * 14) * dt;
    this.dip += this.dipV * dt;
    if (!on) this.dip = this.dipV = 0;
    const fw = this.forward();
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    cam.position.set(this.eye.x + rx * bx, this.eye.y + by + clamp(this.dip, -0.3, 0.1), this.eye.z + rz * bx);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.04;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.04;
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(cam.position.x + fw.x, cam.position.y + fw.y, cam.position.z + fw.z);
    // 极轻的侧倾：随步伐与转向
    this.roll = damp(this.roll, Math.sin(this.bobPhase) * 0.006 * this.bobAmt, 8, dt);
    if (this.roll) cam.rotateZ(this.roll);
    const fov = this.fpFov() + run * 4 * this.bobAmt;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = damp(cam.fov, fov, 4, dt);
      cam.updateProjectionMatrix();
    }
  }
  updateThird(dt, focus, player) {
    const cam = this.camera;
    this.applyLens();
    this.target.copy(focus);
    this.smoothTarget.x = damp(this.smoothTarget.x, this.target.x, 12, dt);
    this.smoothTarget.z = damp(this.smoothTarget.z, this.target.z, 12, dt);
    this.smoothTarget.y = damp(this.smoothTarget.y, this.target.y, 7, dt);
    this.eye.copy(focus);
    this.idleTime += dt;
    const ct = this.smoothTarget;
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    // 碰撞：沿视线逐步检测
    let d = this.distTarget;
    const T = this.world.terrain, Cl = this.world.colliders;
    const p = new THREE.Vector3();
    for (let s = 0.6; s < this.distTarget; s += 0.35) {
      p.copy(ct).addScaledVector(dir, s);
      if (p.y < T.heightAt(p.x, p.z) + 0.25 || Cl.blocked(p.x, p.y, p.z)) {
        d = Math.max(1.0, s - 0.35);
        break;
      }
    }
    this.distSmooth = d < this.distSmooth ? damp(this.distSmooth, d, 18, dt) : damp(this.distSmooth, d, 3, dt);
    cam.position.copy(ct).addScaledVector(dir, this.distSmooth);
    const gy = T.heightAt(cam.position.x, cam.position.z) + 0.3;
    if (cam.position.y < gy) cam.position.y = gy;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.1;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.1;
    }
    cam.lookAt(ct.x, ct.y + 0.15 * (1 - this.pitch), ct.z);
    // 跑动时略微拉宽视角
    const run = player ? clamp((player.speed - 3.5) / 3, 0, 1) : 0;
    const fov = this.fovBase + run * 5;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = damp(cam.fov, fov, 3, dt);
      cam.updateProjectionMatrix();
    }
  }
}
