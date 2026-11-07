import * as THREE from 'three';
import { U } from '../render/shaders.js';
import { clamp, smoothstep, lerp } from '../core/math.js';

// 昼夜：按太阳高度角在一组手调色板之间插值（四月、北纬 35°）
const LAT = (35 * Math.PI) / 180;
const DEC = (10 * Math.PI) / 180;

function solarDir(hours, dec = DEC, out = new THREE.Vector3()) {
  const H = ((hours - 12) / 24) * Math.PI * 2;
  const sinE = Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(H);
  const e = Math.asin(clamp(sinE, -1, 1));
  let cosA = (Math.sin(dec) - Math.sin(e) * Math.sin(LAT)) / (Math.cos(e) * Math.cos(LAT) + 1e-9);
  cosA = clamp(cosA, -1, 1);
  let A = Math.acos(cosA); // 自北顺时针
  if (Math.sin(H) > 0) A = Math.PI * 2 - A;
  const ce = Math.cos(e);
  out.set(ce * Math.sin(A), Math.sin(e), -ce * Math.cos(A));
  return { dir: out, elev: (e * 180) / Math.PI };
}

// 关键帧（sRGB 十六进制，内部转线性）
const RAW_KEYS = [
  { e: -20, zenith: '#070c22', horizon: '#18213f', fog: '#18203a', fogSun: '#1d2544', light: '#a9b8e8', lightI: 0.6, hemiSky: '#3a4c86', hemiGround: '#151a2c', hemiI: 1.25, cloudLit: '#2f3a60', cloudShade: '#141a30', glow: '#000000', night: 1.0, fogD: 0.00152, bloom: 0.95, exposure: 1.05 },
  { e: -8, zenith: '#18265a', horizon: '#565890', fog: '#4f527f', fogSun: '#6e6190', light: '#8c9ad0', lightI: 0.32, hemiSky: '#4d5c98', hemiGround: '#22243a', hemiI: 1.35, cloudLit: '#6c6596', cloudShade: '#2f355c', glow: '#a8607e', night: 0.92, fogD: 0.00152, bloom: 0.85, exposure: 1.05 },
  { e: -3, zenith: '#2c3d78', horizon: '#c9796e', fog: '#a77a86', fogSun: '#e48c74', light: '#ff8b55', lightI: 0.08, hemiSky: '#6c76ad', hemiGround: '#3f3236', hemiI: 1.45, cloudLit: '#e8927c', cloudShade: '#5a5180', glow: '#ff8a62', night: 0.7, fogD: 0.00145, bloom: 0.7, exposure: 1.02 },
  { e: 0.5, zenith: '#3c5292', horizon: '#f59a72', fog: '#b897a0', fogSun: '#ffb084', light: '#ff9a5c', lightI: 1.2, hemiSky: '#7f8abd', hemiGround: '#5a4438', hemiI: 1.5, cloudLit: '#ffb48e', cloudShade: '#6d5f86', glow: '#ff9a62', night: 0.38, fogD: 0.00139, bloom: 0.6, exposure: 1.0 },
  { e: 5, zenith: '#5874b4', horizon: '#ffc095', fog: '#d9c6c4', fogSun: '#ffcf9c', light: '#ffb878', lightI: 2.3, hemiSky: '#98a7d2', hemiGround: '#7c6649', hemiI: 1.6, cloudLit: '#ffe0c2', cloudShade: '#988aa8', glow: '#ffb47a', night: 0.08, fogD: 0.00132, bloom: 0.48, exposure: 1.0 },
  { e: 12, zenith: '#6a8fce', horizon: '#f6dac0', fog: '#dcdde0', fogSun: '#f8dcbc', light: '#ffd4a4', lightI: 2.8, hemiSky: '#a9bde2', hemiGround: '#8a7d58', hemiI: 1.7, cloudLit: '#fff4e8', cloudShade: '#aeacc4', glow: '#ffd2a4', night: 0, fogD: 0.00125, bloom: 0.36, exposure: 1.0 },
  { e: 28, zenith: '#6aa0dd', horizon: '#d8e7ef', fog: '#dce7ec', fogSun: '#f3ece0', light: '#fff2de', lightI: 3.1, hemiSky: '#b5cce9', hemiGround: '#8f8e63', hemiI: 1.8, cloudLit: '#ffffff', cloudShade: '#b9c4d8', glow: '#fff0da', night: 0, fogD: 0.00119, bloom: 0.3, exposure: 1.0 },
  { e: 65, zenith: '#5e97dc', horizon: '#d2e4ef', fog: '#d8e5ec', fogSun: '#eef1ea', light: '#fffaf0', lightI: 3.3, hemiSky: '#b9d0ea', hemiGround: '#8e9165', hemiI: 1.85, cloudLit: '#ffffff', cloudShade: '#bcc8db', glow: '#fff4e6', night: 0, fogD: 0.00119, bloom: 0.28, exposure: 1.0 },
];
const COLOR_KEYS = ['zenith', 'horizon', 'fog', 'fogSun', 'light', 'hemiSky', 'hemiGround', 'cloudLit', 'cloudShade', 'glow'];
const KEYS = RAW_KEYS.map((k) => {
  const o = { ...k };
  for (const c of COLOR_KEYS) o[c] = new THREE.Color(k[c]);
  return o;
});

function sample(e) {
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = smoothstep(a.e, b.e, e);
  const out = {};
  for (const c of COLOR_KEYS) out[c] = a[c].clone().lerp(b[c], t);
  for (const k of ['lightI', 'hemiI', 'night', 'fogD', 'bloom', 'exposure']) out[k] = lerp(a[k], b[k], t);
  return out;
}

export class DayNight {
  constructor({ scene, sky, sun, hemi, startHour = 16.5 }) {
    this.scene = scene;
    this.sky = sky;
    this.sun = sun;
    this.hemi = hemi;
    this.hours = startHour;
    this.speed = 1 / 60; // 每真实秒推进的游戏小时（1 分钟 = 1 小时）
    this.boost = 1;
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.elev = 0;
    this.state = sample(20);
    this.cloud = 0.55;
    this.cloudTarget = 0.55;
    this.cloudTimer = 0;
    this.day = 1;
    this.listeners = [];
    this.lastHourInt = Math.floor(startHour);
  }
  onHour(fn) {
    this.listeners.push(fn);
  }
  setHours(h) {
    this.hours = ((h % 24) + 24) % 24;
    this.lastHourInt = Math.floor(this.hours);
  }
  update(dt) {
    const prev = this.hours;
    this.hours += dt * this.speed * this.boost;
    if (this.hours >= 24) {
      this.hours -= 24;
      this.day++;
    }
    const hi = Math.floor(this.hours);
    if (hi !== this.lastHourInt) {
      this.lastHourInt = hi;
      for (const f of this.listeners) f(hi, prev);
    }
    // 云量缓慢变化
    this.cloudTimer -= dt;
    if (this.cloudTimer <= 0) {
      this.cloudTimer = 40 + Math.random() * 80;
      this.cloudTarget = 0.46 + Math.random() * 0.2;
    }
    this.cloud = lerp(this.cloud, this.cloudTarget, 1 - Math.exp(-dt * 0.05));
    this.apply();
  }
  apply() {
    const { dir: sd, elev } = solarDir(this.hours, DEC, this.sunDir);
    const { dir: md } = solarDir(this.hours + 12, -DEC * 0.3, this.moonDir);
    this.elev = elev;
    const s = sample(elev);
    this.state = s;

    U.uSunDir.value.copy(sd);
    U.uSunColor.value.copy(s.light);
    U.uSkyZenith.value.copy(s.zenith);
    U.uSkyHorizon.value.copy(s.horizon);
    U.uFogColor.value.copy(s.fog);
    U.uFogSunColor.value.copy(s.fogSun);
    U.uFogDensity.value = s.fogD;
    U.uNight.value = s.night;
    U.uDay.value = smoothstep(-3, 6, elev);
    U.uHemiSky.value.copy(s.hemiSky);
    U.uHemiGround.value.copy(s.hemiGround);

    const su = this.sky.uniforms;
    su.uMoonDir.value.copy(md);
    su.uSunGlow.value.copy(s.glow);
    su.uCloudLit.value.copy(s.cloudLit);
    su.uCloudShade.value.copy(s.cloudShade);
    su.uCloudCover.value = this.cloud;
    su.uSunVisible.value = smoothstep(-4, -0.5, elev);
    su.uMoonVisible.value = smoothstep(-1, -8, elev) * smoothstep(-0.05, 0.08, md.y);

    // 平行光：白天随太阳，夜里换成月光
    if (elev > -2.5) {
      this.lightDir.copy(sd);
      if (this.lightDir.y < 0.06) {
        this.lightDir.y = 0.06;
        this.lightDir.normalize();
      }
      this.sun.color.copy(s.light);
      this.sun.intensity = s.lightI * smoothstep(-2.5, 0.0, elev) + (elev < 0 ? 0 : 0);
    } else {
      this.lightDir.copy(md);
      if (this.lightDir.y < 0.15) {
        this.lightDir.y = 0.15;
        this.lightDir.normalize();
      }
      this.sun.color.copy(s.light);
      this.sun.intensity = s.lightI * smoothstep(-2.5, -6, elev) * smoothstep(-0.05, 0.25, md.y);
    }
    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGround);
    this.hemi.intensity = s.hemiI;
  }
  get timeString() {
    const h = Math.floor(this.hours);
    const m = Math.floor((this.hours - h) * 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  get period() {
    const h = this.hours;
    if (h < 4.5) return '深夜';
    if (h < 6) return '黎明';
    if (h < 9) return '早晨';
    if (h < 11) return '上午';
    if (h < 13) return '正午';
    if (h < 16) return '午后';
    if (h < 18.6) return '黄昏';
    if (h < 20) return '薄暮';
    if (h < 23) return '夜晚';
    return '深夜';
  }
  isNight() {
    return this.elev < -4;
  }
}

export { solarDir };
