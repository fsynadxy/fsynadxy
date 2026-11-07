import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp } from '../core/math.js';
import { settings } from '../core/settings.js';

// 第三人称跟随相机：拖动/指针锁定旋转，滚轮缩放，避开地形与建筑；另有电影镜头与拍照自由飞行
export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = 0;
    this.pitch = 0.32;
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
  }
  snap(target) {
    this.target.copy(target);
    this.smoothTarget.copy(target);
    this.distSmooth = this.distTarget;
  }
  handleLook(input, dt) {
    const sens = 0.0042 * settings.sensitivity;
    if (input.look.x || input.look.y) this.idleTime = 0;
    this.yaw -= input.look.x * sens;
    this.pitch += input.look.y * sens * (settings.invertY ? -1 : 1);
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
    this.mode = 'follow';
    this.cine = null;
  }
  startPhoto() {
    this.mode = 'photo';
    this.free.pos.copy(this.camera.position);
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    this.free.yaw = Math.atan2(-d.x, -d.z);
    this.free.pitch = Math.asin(clamp(d.y, -1, 1));
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
    // 跟随
    this.target.copy(focus);
    this.smoothTarget.x = damp(this.smoothTarget.x, this.target.x, 12, dt);
    this.smoothTarget.z = damp(this.smoothTarget.z, this.target.z, 12, dt);
    this.smoothTarget.y = damp(this.smoothTarget.y, this.target.y, 7, dt);
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
