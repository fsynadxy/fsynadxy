import * as THREE from 'three';
import { U } from '../render/shaders.js';
import { clamp, smoothstep, lerp } from '../core/math.js';
import { Atmosphere, sampleSky } from '../render/atmosphere.js';

// 昼夜（四月、北纬 35°）
// 白天到日落：天空、阳光、天光、雾色都来自同一个大气散射模型，再加一个有限的「人眼适应」增益，
// 所以晨昏的颜色与明暗是连续变化的；太阳落到地平线下以后，逐渐交给手调的「蓝调时刻」与「月夜」两层。
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

const col = (h) => new THREE.Color(h);
// 蓝调时刻（太阳在地平线下 2°～8°）与月夜（-10° 以下）：sRGB 十六进制，内部为线性
const BLUE = {
  zenith: col('#1d2e66'), horizon: col('#4f5488'), fog: col('#4a4e78'), fogSun: col('#6a5c8a'),
  hemiSky: col('#4a5892'), hemiGround: col('#23263b'), cloudLit: col('#625c8c'), cloudShade: col('#2c3258'),
};
const NIGHT = {
  zenith: col('#070c22'), horizon: col('#18213f'), fog: col('#18203a'), fogSun: col('#1d2544'),
  hemiSky: col('#3a4c86'), hemiGround: col('#181d30'), cloudLit: col('#2f3a60'), cloudShade: col('#141a30'),
  moon: col('#a9b8e8'),
};
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const E_SUN = 20;

export class DayNight {
  constructor({ scene, sky, sun, hemi, startHour = 16.5, renderer }) {
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
    this.cloud = 0.55;
    this.cloudTarget = 0.55;
    this.cloudTimer = 0;
    this.day = 1;
    this.listeners = [];
    this.lastHourInt = Math.floor(startHour);
    this.atmo = renderer ? new Atmosphere(renderer) : null;
    if (this.atmo) sky.uniforms.uSkyLUT.value = this.atmo.texture;
    this.calibrate();
    this._cacheDir = new THREE.Vector3(0, -2, 0);
    this._phys = null;
    this.state = { bloom: 0.3, exposure: 1 };
    this.tmp = { a: new THREE.Color(), b: new THREE.Color() };
  }
  // 以正午为基准标定：正午的天光、雾色、阳光与原来的手调色板一致
  calibrate() {
    const noon = solarDir(12).dir.clone();
    const s = sampleSky(noon);
    this.kSun = 1 / Math.max(...s.T);
    this.kSky = lum([0.485, 0.631, 0.823]) / (lum(s.irr) * E_SUN);
    this.kRad = lum([0.686, 0.783, 0.836]) / (lum(s.away) * E_SUN);
    this.irrNoon = lum(s.irr);
  }
  physAt(sd) {
    if (!this._phys || sd.dot(this._cacheDir) < 0.99999) {
      this._phys = sampleSky(sd);
      this._cacheDir.copy(sd);
    }
    return this._phys;
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
  // 在主渲染之前调用：必要时重算天空查找表
  prepare() {
    if (this.atmo) this.atmo.update(this.sunDir);
  }
  apply() {
    const { dir: sd, elev } = solarDir(this.hours, DEC, this.sunDir);
    const { dir: md } = solarDir(this.hours + 12, -DEC * 0.3, this.moonDir);
    this.elev = elev;
    const P = this.physAt(sd);
    // 人眼适应：按天光（阴影处与天空）的亮度测光，越暗增益越大但有上限，黄昏仍比白天暗
    const G = clamp(Math.pow(this.irrNoon / Math.max(lum(P.irr), 1e-12), 0.7), 1, 14);
    const wN = smoothstep(-7, -14, elev); // 月夜
    const wB = smoothstep(1.5, -3, elev) * (1 - wN); // 蓝调时刻
    const kR = this.kRad * E_SUN * G;
    const v3 = (a, k = 1) => new THREE.Color(a[0] * k, a[1] * k, a[2] * k);
    // 太阳正对方向的眩光在浓霞里极亮，压一压免得雾色发白
    const soft = (c, m = 2.2) => {
      const l = Math.max(c.r, c.g, c.b);
      return l > 0 ? c.multiplyScalar((m * l) / (m + l) / l) : c;
    };
    // 多次散射让远处的霞气偏白：给雾色、地平线色降一部分饱和度
    const desat = (c, k) => {
      const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
      return c.lerp(new THREE.Color(l, l, l), k);
    };
    const mixLayers = (phys, key) => phys.add(BLUE[key].clone().multiplyScalar(wB)).add(NIGHT[key].clone().multiplyScalar(wN));

    // 阳光：透射率 × 部分适应；太阳下沉到地平线以下约 1° 时完全消失（含大气折射）
    const vis = smoothstep(-1.2, 0.8, elev);
    const sunUnit = desat(v3(P.T, this.kSun * G * vis), 0.15);
    // 天光（半球光）：物理辐照度，略降饱和以保持柔和的暗部
    const sky = v3(P.irr, this.kSky * E_SUN * G);
    const sl = sky.r * 0.2126 + sky.g * 0.7152 + sky.b * 0.0722;
    sky.lerp(new THREE.Color(sl, sl, sl), 0.28);
    const hemiSky = mixLayers(sky.clone(), 'hemiSky');
    const albedo = [0.2, 0.21, 0.11];
    const gl = new THREE.Color().copy(sunUnit).multiplyScalar(Math.max(sd.y, 0) * 1.4).add(sky.clone().multiplyScalar(0.45));
    const hemiGround = mixLayers(new THREE.Color(gl.r * albedo[0], gl.g * albedo[1], gl.b * albedo[2]), 'hemiGround');
    const fog = mixLayers(desat(soft(v3(P.away, kR), 1.6), 0.45), 'fog');
    const fogSun = mixLayers(desat(soft(v3(P.toward, kR), 2.4), 0.35), 'fogSun');
    const zenith = mixLayers(v3(P.zen, kR), 'zenith');
    const horizon = mixLayers(desat(soft(v3(P.horizon, kR), 1.8), 0.3), 'horizon');

    U.uSunDir.value.copy(sd);
    U.uSunColor.value.copy(elev > -1.5 ? sunUnit : NIGHT.moon.clone().multiplyScalar(0.25));
    U.uSkyZenith.value.copy(zenith);
    U.uSkyHorizon.value.copy(horizon);
    U.uFogColor.value.copy(fog);
    U.uFogSunColor.value.copy(fogSun);
    // 雾：夜里略浓；日出前后有一层低低的晨雾
    const h = this.hours;
    const mist = smoothstep(4.2, 5.6, h) * (1 - smoothstep(6.3, 8.8, h));
    const dusk = smoothstep(17.6, 18.6, h) * (1 - smoothstep(19.2, 20.5, h));
    U.uFogDensity.value = lerp(0.00119, 0.00152, wN + wB * 0.6) * (1 + 0.85 * mist + 0.15 * dusk);
    U.uNight.value = 1 - smoothstep(-11, 5.5, elev);
    U.uDay.value = smoothstep(-1.5, 1.5, elev);
    U.uHemiSky.value.copy(hemiSky);
    U.uHemiGround.value.copy(hemiGround);

    const su = this.sky.uniforms;
    su.uSkyGain.value = this.atmo ? kR : 0;
    su.uNightZenith.value.copy(BLUE.zenith).multiplyScalar(wB).add(NIGHT.zenith.clone().multiplyScalar(wN));
    su.uNightHorizon.value.copy(BLUE.horizon).multiplyScalar(wB).add(NIGHT.horizon.clone().multiplyScalar(wN));
    if (!this.atmo) {
      // 无查找表时退回到渐变（测试环境）
      su.uNightZenith.value.copy(zenith);
      su.uNightHorizon.value.copy(horizon);
    }
    su.uMoonDir.value.copy(md);
    su.uSunGlow.value.copy(sunUnit).multiplyScalar(0.22);
    su.uCloudLit.value.copy(sunUnit).multiplyScalar(0.95).add(sky.clone().multiplyScalar(0.32));
    mixLayers(su.uCloudLit.value, 'cloudLit');
    su.uCloudShade.value.copy(sky).multiplyScalar(0.62).add(fog.clone().multiplyScalar(0.22 * (1 - wN - wB)));
    mixLayers(su.uCloudShade.value, 'cloudShade');
    su.uCloudCover.value = this.cloud;
    U.uCloudLit.value.copy(su.uCloudLit.value);
    U.uCloudShade.value.copy(su.uCloudShade.value);
    U.uCloudCover.value = this.cloud;
    su.uSunVisible.value = smoothstep(-4, -0.5, elev);
    su.uStarVis.value = smoothstep(-6, -13, elev);
    su.uMoonVisible.value = smoothstep(-1, -8, elev) * smoothstep(-0.05, 0.08, md.y);

    // 平行光：白天随太阳，夜里换成月光（两者在 -1.5° 附近都接近零，切换时不跳变）
    if (elev > -1.5) {
      this.lightDir.copy(sd);
      if (this.lightDir.y < 0.06) {
        this.lightDir.y = 0.06;
        this.lightDir.normalize();
      }
      const m = Math.max(sunUnit.r, sunUnit.g, sunUnit.b, 1e-6);
      this.sun.color.copy(sunUnit).multiplyScalar(1 / m);
      this.sun.intensity = 3.3 * m;
    } else {
      this.lightDir.copy(md);
      if (this.lightDir.y < 0.15) {
        this.lightDir.y = 0.15;
        this.lightDir.normalize();
      }
      this.sun.color.copy(NIGHT.moon);
      this.sun.intensity = 0.75 * smoothstep(-2.5, -9, elev) * smoothstep(-0.05, 0.25, md.y);
    }
    this.hemi.color.copy(hemiSky);
    this.hemi.groundColor.copy(hemiGround);
    this.hemi.intensity = 1.85;
    this.state.bloom = 0.28 + 0.42 * U.uNight.value;
    this.state.exposure = 1.0 + 0.1 * wN;
    this.state.G = G;
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
