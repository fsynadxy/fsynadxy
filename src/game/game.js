import * as THREE from 'three';
import { U } from '../render/shaders.js';
import { PostFX } from '../render/postfx.js';
import { createWorldMaterial } from '../render/materials.js';
import { World } from '../world/world.js';
import { DayNight } from './daynight.js';
import { CameraRig } from './camera.js';
import { Input } from '../core/input.js';
import { AudioEngine } from '../core/audio.js';
import { settings, QUALITY, loadGame, saveGame, clearGame } from '../core/settings.js';
import { SPAWN, REGIONS, SITES, riverNearest, FIELDS } from '../world/layout.js';
import { Player } from '../entities/player.js';
import { createNPCs } from '../entities/npcs.js';
import { createCats, Hearts, Kitten } from '../entities/cats.js';
import { UI } from '../ui/ui.js';
import { MapArt } from '../ui/minimap.js';
import { STAMPS, CATS, FORTUNES, EMA, DRINKS, SHOP_TALK, HAIKU, FINALE_POEM } from './content.js';
import { smoothstep } from '../core/math.js';

const DAY_NAMES = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export class Game {
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector('#view');
    this.params = new URLSearchParams(location.search);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.mode = 'loading';
    this.audio = new AudioEngine();
    this.state = this.freshState();
  }
  freshState() {
    return { stamps: {}, cats: {}, talked: {}, fortunes: [], drinks: [], distance: 0, hours: 16.4, day: 1, pos: null, yaw: SPAWN.yaw, finale: false, kitten: false, visited: {} };
  }
  async boot() {
    if (this.params.has('timing')) window.__DEV_TIMING = true;
    const qName = this.params.get('q') || settings.quality;
    const q = QUALITY[qName] || QUALITY.medium;
    this.quality = q;
    this.input = new Input(this.canvas);
    this.ui = new UI(this.root.querySelector('#ui'), this);
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: this.params.has('shot') });
    this.dpr = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    renderer.setPixelRatio(this.dpr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = q.softShadow ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer = renderer;
    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.Fog(0xffffff, 1, 1000);
    const camera = (this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.25, 9000));
    const sun = (this.sun = new THREE.DirectionalLight(0xffffff, 3));
    sun.castShadow = true;
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    const sc = sun.shadow.camera;
    sc.left = -72; sc.right = 72; sc.top = 72; sc.bottom = -72; sc.near = 1; sc.far = 700;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.05;
    scene.add(sun, sun.target);
    const hemi = (this.hemi = new THREE.HemisphereLight(0xb5cce9, 0x8f8e63, 1.8));
    scene.add(hemi);
    // 夜间点光源池（数量固定，避免着色器重编译）
    this.pointLights = [];
    const nPL = q === QUALITY.low ? 0 : q === QUALITY.medium ? 4 : 6;
    for (let i = 0; i < nPL; i++) {
      const l = new THREE.PointLight(0xffb36b, 0, 13, 1.6);
      l.userData.k = 0;
      scene.add(l);
      this.pointLights.push(l);
    }
    // 世界
    this.world = new World(scene, q);
    await this.world.generate((p, label) => this.ui.progress(p * 0.92, label));
    this.ui.progress(0.95, '请镇上的人们出门');
    await new Promise((r) => requestAnimationFrame(r));
    const charMat = createWorldMaterial();
    this.player = new Player(this.world, charMat);
    scene.add(this.player.object);
    this.npcs = createNPCs(this.world, charMat, scene);
    this.cats = createCats(this.world, charMat, scene);
    this.kitten = new Kitten(charMat, scene);
    this.hearts = new Hearts(scene);
    this.mapArt = new MapArt(this.world);
    this.miniCanvas = this.root.querySelector('.hud-map canvas');
    this.rig = new CameraRig(camera, this.world);
    // 存档
    const save = this.params.has('fresh') ? null : loadGame();
    this.hasSave = !!(save && save.pos);
    if (save) Object.assign(this.state, this.freshState(), save);
    const startHour = this.params.has('t') ? parseFloat(this.params.get('t')) : this.hasSave ? this.state.hours : 16.6;
    this.daynight = new DayNight({ scene, sky: this.world.sky, sun, hemi, startHour });
    this.daynight.day = this.state.day || 1;
    this.daynight.onHour((h) => this.onHour(h));
    this.daynight.apply();
    this.post = new PostFX(renderer, scene, camera, q);
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.saveNow();
    });
    window.addEventListener('pagehide', () => this.saveNow());
    this.wind = { dir: 0.4, gust: 0, gustT: 70 + Math.random() * 90, gustPhase: 0, gustPeak: 1 };
    this.player.spawn(SPAWN.x, SPAWN.z, SPAWN.yaw);
    if (this.hasSave && this.state.pos) this.player.spawn(this.state.pos[0], this.state.pos[2], this.state.yaw || 0);
    this.applyProgressVisuals();
    this.ui.updateCounts(Object.keys(this.state.stamps).length, Object.keys(this.state.cats).length);
    this.rig.yaw = this.player.yaw + Math.PI;
    this.bindEvents();
    // 调试相机
    this.debugCam = this.params.has('cam');
    if (this.debugCam) {
      const c = this.params.get('cam').split(',').map(Number);
      const l = (this.params.get('look') || '0,0,0').split(',').map(Number);
      camera.position.set(...c);
      camera.lookAt(...l);
    } else {
      this.titleCamera(10);
    }
    this.ui.progress(1, '完成');
    this.ready = true;
    window.__game = this;
    this.ui.hideLoading();
    if (this.params.has('play')) this.startPlay(false, true);
    else {
      this.mode = 'title';
      this.ui.showTitle(this.hasSave);
    }
    if (this.params.has('shot')) {
      window.__renderOnce = (n = 1, dt = 1 / 30) => {
        for (let i = 0; i < n; i++) this.frame(dt);
        return this.canvas.toDataURL('image/png');
      };
    } else renderer.setAnimationLoop(() => this.frame());
  }
  bindEvents() {
    const A = this.audio;
    this.player.on('step', (e) => A.step(e.surface, e.run));
    this.player.on('land', (k) => A.land(k));
    this.player.on('boundary', () => this.ui.subtitle('再往前就是深山了。回小镇去吧。', 3200));
    this.player.on('blocked', () => {
      if (this.time - (this._blockT ?? -10) > 6) {
        this._blockT = this.time;
        this.ui.subtitle('水太深了，过不去。', 2200);
      }
    });
    this.world.train.on((ev) => {
      if (ev === 'depart') A.horn();
    });
  }
  // ---------------------------------------------------------------- 状态切换
  onUIAction(act) {
    switch (act) {
      case 'start':
        if (this.hasSave) {
          this.state = this.freshState();
          clearGame();
          this.player.spawn(SPAWN.x, SPAWN.z, SPAWN.yaw);
          this.applyProgressVisuals();
          this.daynight.setHours(16.6);
          this.ui.updateCounts(0, 0);
        }
        this.startPlay(true);
        break;
      case 'continue':
        this.startPlay(false);
        break;
      case 'help':
        this.audio.init();
        this.ui.openPanel('menu', 'keys');
        break;
      case 'settings':
        this.audio.init();
        this.ui.openPanel('menu', 'settings');
        break;
      case 'map':
        if (this.mode === 'play') this.ui.open === 'map' ? this.ui.closePanel() : this.ui.openPanel('map');
        break;
      case 'book':
        if (this.mode === 'play') this.ui.open === 'book' ? this.ui.closePanel() : this.ui.openPanel('book');
        break;
      case 'photo':
        if (this.mode === 'play' || this.mode === 'photo') this.togglePhoto(this.mode !== 'photo');
        break;
      case 'menu':
        this.ui.open === 'menu' ? this.ui.closePanel() : this.ui.openPanel('menu');
        break;
    }
  }
  startPlay(intro, instant = false) {
    this.audio.init();
    this.audio.hour = this.daynight.hours;
    this.ui.closePanel(true);
    const go = () => {
      this.ui.hideTitle();
      this.mode = 'play';
      this.rig.follow();
      this.rig.yaw = this.player.yaw + Math.PI;
      this.rig.pitch = 0.28;
      this.rig.snap(this.focusPoint());
      this.ui.showHUD(true);
      this.ui.hintStart = performance.now();
      setTimeout(() => this.ui.fade(false), 120);
      if (intro) {
        setTimeout(() => this.ui.subtitle('四月。桜川町的樱花开了。', 4200), 1500);
        setTimeout(() => this.ui.subtitle('小镇八处名所备有御朱印台——沿着河，慢慢走走看吧。', 5200), 6200);
      } else if (!instant) {
        setTimeout(() => this.ui.subtitle(`第 ${this.daynight.day} 天 · ${this.daynight.period}。欢迎回来。`, 3600), 1200);
      }
      this.lastRegion = null;
    };
    if (instant) go();
    else {
      this.ui.fade(true);
      setTimeout(go, 1100);
    }
  }
  toTitle() {
    this.saveNow();
    this.ui.closePanel(true);
    this.togglePhoto(false);
    this.ui.showHUD(false);
    this.mode = 'title';
    this.hasSave = true;
    this.ui.showTitle(true);
  }
  resetProgress() {
    clearGame();
    location.href = location.pathname + (this.params.get('q') ? '?q=' + this.params.get('q') : '');
  }
  onPanel(open) {
    if (open) this.input.exitPointerLock();
  }
  togglePhoto(on) {
    if (on && this.mode === 'play') {
      this.mode = 'photo';
      this.rig.startPhoto();
      this.ui.photoMode(true, this.daynight.hours);
      this.ui.prompt(null);
      this.ui.subtitle('拍照模式 · 时间已暂停', 2200);
    } else if (!on && this.mode === 'photo') {
      this.mode = 'play';
      this.rig.follow();
      this.camera.fov = 55;
      this.camera.updateProjectionMatrix();
      this.ui.photoMode(false);
      this.setFilter(0);
    }
  }
  setTime(h) {
    this.daynight.setHours(h);
    this.daynight.apply();
    this.ui.photoTime(h, this.daynight.timeString);
  }
  setFilter(f) {
    this.post.grade.uniforms.uFilter.value = f;
  }
  takePhoto() {
    const panel = this.ui.el.photo;
    const was = panel.classList.contains('hidden');
    panel.classList.add('hidden');
    this.post.render(0, this.time);
    let url = null;
    try {
      url = this.canvas.toDataURL('image/png');
    } catch (e) {
      url = null;
    }
    if (!was) panel.classList.remove('hidden');
    this.ui.flash();
    this.audio.ui('wood');
    if (url) setTimeout(() => this.ui.showPhoto(url), 400);
  }
  drawFullMap(cv) {
    this.mapArt.drawFull(cv, this.player, this.markers());
  }
  markers() {
    return this.world.ctx.stamps.map((s) => ({ kind: 'stamp', x: s.x, z: s.z, done: !!this.state.stamps[s.id] }));
  }
  focusPoint() {
    const p = this.player.pos;
    const y = this.player.mode === 'sit' && this.player.seat ? this.player.seat.y + 1.25 : p.y + 1.45;
    return new THREE.Vector3(p.x, y, p.z);
  }
  applyProgressVisuals() {
    U.uFinale.value = this.state.finale ? 1 : 0;
    for (const c of this.cats || []) c.found = !!this.state.cats[c.def.id];
    if (this.state.kitten && this.kitten && !this.kitten.active) this.kitten.activate(this.player.pos.clone());
    if (!this.state.kitten && this.kitten && this.kitten.active) {
      this.kitten.active = false;
      this.kitten.object.visible = false;
    }
  }
  saveNow() {
    if (!this.player || this.mode === 'loading' || !this.ready) return;
    const s = this.state;
    s.hours = this.daynight.hours;
    s.day = this.daynight.day;
    s.pos = [this.player.pos.x, this.player.pos.y, this.player.pos.z];
    s.yaw = this.player.yaw;
    saveGame(s);
  }
  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
  }
  // ---------------------------------------------------------------- 事件
  onHour(h) {
    if (this.mode !== 'play' && this.mode !== 'photo' && this.mode !== 'dialog') return;
    if (h === 17) {
      this.audio.chime();
      this.ui.toast('<span class="mark">♪</span> 傍晚五点 · 远处响起了晚霞的钟声');
    }
    if (h === 18) {
      setTimeout(() => this.audio.bonsho(), 300);
      this.ui.toast('<span class="mark">鐘</span> 花雲寺传来了暮钟');
    }
    if (h === 19) this.ui.toast('<span class="mark">灯</span> 河边的灯笼亮起来了');
    if (h === 6) this.ui.toast('<span class="mark">朝</span> 天亮了');
    if (h === 0) this.ui.toast(`<span class="mark">夜</span> 第 ${this.daynight.day} 天`);
    this.saveNow();
  }
  gust(strength = 1) {
    this.wind.gustPhase = 0.0001;
    this.wind.gustPeak = strength;
    this.audio.whoosh(strength);
    if (this.mode === 'play') this.ui.toast('<span class="mark">花吹雪</span> 一阵风吹过，花瓣像雪一样飞舞', 4200);
  }
  updateWind(dt) {
    const w = this.wind;
    w.dir += (Math.sin(this.time * 0.013) * 0.02 + Math.sin(this.time * 0.031) * 0.01) * dt * 10;
    const base = 0.75 + 0.25 * Math.sin(this.time * 0.07);
    w.gustT -= dt;
    if (w.gustT <= 0 && this.mode === 'play') {
      w.gustT = 150 + Math.random() * 180;
      this.gust(0.8 + Math.random() * 0.4);
    }
    let g = 0;
    if (w.gustPhase > 0) {
      w.gustPhase += dt;
      const t = w.gustPhase;
      g = (t < 2 ? smoothstep(0, 2, t) : t < 7 ? 1 : 1 - smoothstep(7, 12, t)) * w.gustPeak;
      if (t > 12) w.gustPhase = 0;
    }
    g += 0.12 * Math.max(0, Math.sin(this.time * 0.5) * Math.sin(this.time * 0.23));
    w.gust = g;
    U.uGust.value = g;
    U.uWind.value.set(Math.cos(w.dir), Math.sin(w.dir)).multiplyScalar(base);
  }
  // ---------------------------------------------------------------- 交互
  interactables() {
    const list = [];
    const ctx = this.world.ctx;
    for (const it of ctx.interact) list.push(it);
    for (const b of ctx.benches) {
      if (b.occupied === undefined) b.occupied = this.npcs.some((n) => (n.def.behavior === 'sit') && Math.hypot(n.pos.x - b.x, n.pos.z - b.z) < 1.0);
      if (b.occupied) continue;
      list.push({ kind: 'bench', bench: b, x: b.x + Math.sin(b.rot) * 0.55, y: b.y, z: b.z + Math.cos(b.rot) * 0.55, r: 1.5, label: '坐一会儿' });
    }
    for (const n of this.npcs) if (n.talkable) list.push({ kind: 'npc', npc: n, x: n.pos.x, y: n.pos.y, z: n.pos.z, r: n.def.behavior === 'sit' ? 3.2 : 2.6, label: '交谈 · ' + n.def.name });
    for (const c of this.cats) list.push({ kind: 'cat', cat: c, x: c.pos.x, y: c.pos.y, z: c.pos.z, r: 1.8, label: c.found ? '摸摸' + c.def.name : '摸摸这只猫' });
    return list;
  }
  findInteract() {
    const p = this.player;
    let best = null, bestScore = Infinity;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    for (const it of this.interactables()) {
      const dx = it.x - p.pos.x, dz = it.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > it.r || Math.abs(it.y - p.pos.y) > 2.2) continue;
      const facing = d > 0.3 ? (dx * fx + dz * fz) / d : 1;
      if (facing < -0.35) continue;
      const score = d - facing * 0.6;
      if (score < bestScore) {
        bestScore = score;
        best = it;
      }
    }
    return best;
  }
  doInteract(it) {
    const A = this.audio;
    const S = this.state;
    const p = this.player;
    const face = () => {
      p.yaw = Math.atan2(it.x - p.pos.x, it.z - p.pos.z);
    };
    switch (it.kind) {
      case 'stamp': {
        face();
        const st = STAMPS.find((s) => s.id === it.stamp.id);
        if (S.stamps[st.id]) {
          this.ui.subtitle(`「${st.name}」的御朱印已经收在帐里了。`, 2600);
          A.ui('tap');
          return;
        }
        const d = this.daynight.day;
        S.stamps[st.id] = { date: `令和八年卯月${DAY_NAMES[Math.min(9, d - 1)]}日` };
        A.stamp();
        const n = Object.keys(S.stamps).length;
        this.ui.updateCounts(n, Object.keys(S.cats).length);
        this.ui.toast(`<span class="mark">御朱印</span> ${st.name}（${n}/8）`);
        this.ui.newStamp = st.id;
        setTimeout(() => this.ui.openPanel('book', 'stamps'), 500);
        this.saveNow();
        if (n === STAMPS.length && !S.finale) this.pendingFinale = true;
        return;
      }
      case 'cat': {
        face();
        const c = it.cat;
        p.mode = 'pet';
        this.petTimer = 2.4;
        c.pet();
        A.purr(3.2);
        setTimeout(() => A.meow(), 400);
        this.hearts.burst(new THREE.Vector3(c.pos.x, c.pos.y + 0.55, c.pos.z), 5);
        if (!S.cats[c.def.id]) {
          S.cats[c.def.id] = true;
          c.found = true;
          const n = Object.keys(S.cats).length;
          this.ui.updateCounts(Object.keys(S.stamps).length, n);
          this.ui.toast(`<span class="mark">猫</span> 遇见了「${c.def.name}」（${n}/7）`);
          setTimeout(() => this.ui.subtitle(c.def.desc, 5200), 1200);
          if (n === CATS.length && !S.kitten) {
            S.kitten = true;
            setTimeout(() => {
              this.kitten.activate(new THREE.Vector3(c.pos.x, c.pos.y, c.pos.z));
              this.ui.toast('<span class="mark">猫</span> 七只猫都成了朋友。一只小猫开始跟着你散步了。', 5200);
            }, 2600);
          }
          this.saveNow();
        } else this.ui.subtitle(`${c.def.name}眯起了眼睛，发出呼噜呼噜的声音。`, 2600);
        return;
      }
      case 'npc': {
        const n = it.npc;
        face();
        const lead = n.def.group ? this.npcs.find((x) => x.def.group === n.def.group && !x.def.mute) || n : n;
        S.talked[lead.def.id] = (S.talked[lead.def.id] || 0) + 1;
        const line = lead.nextLine(this.daynight.isNight());
        this.mode = 'dialog';
        this.ui.dialog(lead.def.name, lead.def.title, [line], () => (this.mode = 'play'));
        A.ui('tap');
        return;
      }
      case 'bench': {
        p.sitOn(it.bench);
        this.ui.subtitle('坐下来看看花吧。按住 T 让时光流逝，移动即可起身。', 4200);
        A.ui('wood');
        return;
      }
      case 'vending': {
        face();
        const [name, text] = DRINKS[Math.floor(Math.random() * DRINKS.length)];
        A.gachan();
        if (!S.drinks.includes(name)) S.drinks.push(name);
        this.ui.toast(`<span class="mark">ガコン</span> 买到了「${name}」`);
        setTimeout(() => this.ui.subtitle(text, 4200), 700);
        return;
      }
      case 'pray': {
        face();
        A.suzu();
        setTimeout(() => A.clap(), 1300);
        setTimeout(() => A.clap(), 1700);
        const msgs = ['二礼、二拍手、一礼。风停了一瞬，又轻轻吹起来。', '你在心里许了一个愿。铃声在山间回响了很久。', '神明大概听见了。树梢上的花，落了一片在你肩上。'];
        setTimeout(() => this.ui.subtitle(msgs[Math.floor(Math.random() * msgs.length)], 4600), 2200);
        return;
      }
      case 'omikuji': {
        face();
        A.shake();
        const f = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
        S.fortunes.push(f.rank);
        if (S.fortunes.length > 12) S.fortunes.shift();
        setTimeout(() => this.ui.fortune(f, () => {
          if (f.rank === '凶' || f.rank === '末吉') this.ui.subtitle('你把签细细折好，系在了架子上。', 3600);
        }), 600);
        return;
      }
      case 'ema': {
        face();
        const pick = [...EMA].sort(() => Math.random() - 0.5).slice(0, 3);
        this.mode = 'dialog';
        this.ui.dialog('绘马', '许愿的木牌', pick.map((x) => '「' + x + '」'), () => (this.mode = 'play'));
        return;
      }
      case 'chozu': {
        face();
        A.water();
        this.ui.subtitle('用长柄勺舀起清水，先洗左手，再洗右手。水很凉，心也静了下来。', 4600);
        return;
      }
      case 'bell': {
        face();
        A.bonsho();
        this.rig.shake = 0.6;
        this.ui.subtitle('“咚——”钟声慢慢荡开，越过河面，传到很远的地方。', 5200);
        return;
      }
      case 'gaze': {
        p.mode = 'gaze';
        const A2 = SITES.ancient;
        const h = HAIKU[Math.floor(Math.random() * HAIKU.length)];
        let t = 0;
        const base = this.world.forest.ancient;
        this.rig.cinematic((dt) => {
          t += dt;
          if (t > 9.5 || (t > 1.5 && this.input.moveMag > 0.2)) {
            p.mode = 'walk';
            return null;
          }
          const a = 2.6 + t * 0.05;
          return {
            pos: new THREE.Vector3(A2.x + Math.cos(a) * 4.4, base.y + 1.3, A2.z + Math.sin(a) * 4.4),
            look: new THREE.Vector3(A2.x, base.y + 8.5 + t * 0.15, A2.z),
            lambda: 1.2,
          };
        });
        setTimeout(() => this.ui.subtitle(`${h[0]}　—— ${h[1]}`, 4200), 1200);
        setTimeout(() => this.ui.subtitle(h[2], 3800), 5600);
        return;
      }
      case 'shop': {
        face();
        const lines = SHOP_TALK[it.shop.id] || ['店里很安静。'];
        this.mode = 'dialog';
        this.ui.dialog(it.shop.name, '', lines, () => (this.mode = 'play'));
        return;
      }
    }
  }
  // ---------------------------------------------------------------- 主循环
  updateShadowCamera() {
    const sun = this.sun;
    const target = this.mode === 'play' || this.mode === 'dialog' ? this.player.pos : this.camera.position;
    const d = this.daynight.lightDir;
    const size = 144 / this.quality.shadow;
    const fx = Math.round(target.x / size) * size, fz = Math.round(target.z / size) * size;
    sun.target.position.set(fx, target.y, fz);
    sun.position.set(fx + d.x * 300, target.y + d.y * 300, fz + d.z * 300);
    sun.target.updateMatrixWorld();
  }
  updatePointLights() {
    if (!this.pointLights.length) return;
    const night = U.uNight.value;
    this._plT = (this._plT || 0) - 1;
    if (this._plT <= 0 && night > 0.02) {
      this._plT = 20;
      const c = this.camera.position;
      const sorted = this.world.ctx.lights
        .map((l) => [l, (l[0] - c.x) ** 2 + (l[2] - c.z) ** 2])
        .sort((a, b) => a[1] - b[1])
        .slice(0, this.pointLights.length);
      this.pointLights.forEach((pl, i) => {
        const s = sorted[i];
        if (s && s[1] < 60 * 60) {
          pl.position.set(s[0][0], s[0][1] - 0.2, s[0][2]);
          pl.userData.k = s[0][3] || 1;
        } else pl.userData.k = 0;
      });
    }
    for (const pl of this.pointLights) pl.intensity = night * 4.2 * pl.userData.k;
  }
  // 自适应分辨率：持续掉帧时降低像素比，余量充足时慢慢恢复
  adaptResolution(rawDt) {
    const p = (this.perf = this.perf || { acc: 0, n: 0, scale: 1, cool: 4 });
    p.acc += rawDt;
    p.n++;
    if (p.acc < 2.5) return;
    const avg = p.acc / p.n;
    p.acc = 0;
    p.n = 0;
    if (p.cool > 0) {
      p.cool--;
      return;
    }
    let next = p.scale;
    if (avg > 1 / 26 && p.scale > 0.55) next = Math.max(0.55, p.scale - 0.12);
    else if (avg < 1 / 55 && p.scale < 1) next = Math.min(1, p.scale + 0.06);
    if (next !== p.scale) {
      p.scale = next;
      p.cool = 1;
      this.renderer.setPixelRatio(this.dpr * next);
      this.post.setSize(window.innerWidth, window.innerHeight);
    }
  }
  frame(fixedDt) {
    const rawDt = this.clock.getDelta();
    const dt = fixedDt ?? Math.min(rawDt, 0.1);
    if (fixedDt === undefined && this.mode !== 'loading' && !document.hidden) this.adaptResolution(Math.min(rawDt, 0.25));
    this.time += dt;
    U.uTime.value = this.time;
    const input = this.input;
    input.update();
    if (this.mode === 'play' || this.mode === 'photo' || this.mode === 'dialog') this.handleKeys();
    const playing = this.mode === 'play' && !this.ui.open;
    // 时间
    const tHeld = input.isDown('time') && this.mode === 'play' && !this.ui.open;
    this.daynight.boost = tHeld ? (this.player.mode === 'sit' ? 40 : 24) : 1;
    if (!this.params.has('freeze') && this.mode !== 'photo' && !this.ui.open) this.daynight.update(dt);
    else this.daynight.apply();
    this.updateWind(dt);
    // 玩家
    if (this.mode === 'play' || this.mode === 'dialog') {
      if (playing) this.rig.handleLook(input, dt);
      if (this.player.mode === 'sit' && playing && (input.moveMag > 0.3 || input.wasPressed('jump'))) this.player.standUp();
      if (this.player.mode === 'pet') {
        this.petTimer -= dt;
        if (this.petTimer <= 0) this.player.mode = 'walk';
      }
      const bx = this.player.pos.x, bz = this.player.pos.z;
      this.player.update(dt, input, this.rig.yaw, { locked: !playing });
      this.state.distance += Math.hypot(this.player.pos.x - bx, this.player.pos.z - bz);
      if (playing && this.player.mode === 'walk') {
        const it = this.findInteract();
        this.ui.prompt(it ? it.label : null);
        if (it && input.wasPressed('interact')) this.doInteract(it);
      } else if (this.player.mode === 'sit') this.ui.prompt('起身', 'W');
      else this.ui.prompt(null);
      if (this.mode === 'dialog' && (input.wasPressed('interact') || input.wasPressed('jump'))) this.ui.advanceDialog();
      if (this.pendingFinale && !this.ui.open && this.mode === 'play') {
        this.pendingFinale = false;
        this.state.finale = true;
        U.uFinale.value = 1;
        this.saveNow();
        setTimeout(() => {
          this.gust(1.3);
          this.ui.finale(FINALE_POEM);
        }, 600);
      }
    }
    // 镜头
    if (this.mode === 'title') this.titleCamera(dt);
    else if (this.mode === 'photo') {
      if (input.wasPressed('hide')) this.ui.togglePhotoPanel();
      this.rig.update(dt, input, this.player.pos, this.player);
      this.ui.photoTime(this.daynight.hours, this.daynight.timeString);
    } else if (!this.debugCam) {
      if (this.player.mode === 'sit' && this.rig.mode === 'follow') this.rig.distTarget = Math.max(this.rig.distTarget, 7.5);
      this.rig.update(dt, input, this.focusPoint(), this.player);
    }
    // 实体
    for (const n of this.npcs) n.update(dt, this.player);
    for (const c of this.cats) c.update(dt, this.player);
    this.kitten.update(dt, this.player, this.world.terrain);
    this.hearts.update(dt);
    this.world.update(dt, this);
    this.world.sky.mesh.position.copy(this.camera.position);
    this.updateShadowCamera();
    this.updatePointLights();
    const st = this.daynight.state;
    if (this.post.bloom) this.post.bloom.strength = st.bloom;
    this.renderer.toneMappingExposure = st.exposure;
    if (this.mode === 'play' || this.mode === 'dialog') this.updateHUD(dt);
    this.updateAudio(dt);
    if (!window.__noRender) this.post.render(dt, this.time);
    input.endFrame();
  }
  handleKeys() {
    const input = this.input;
    if (this.mode === 'dialog') return;
    if (input.wasPressed('pause')) {
      if (this.ui.open === 'fortune') this.ui._fortuneClose && this.ui._fortuneClose();
      else if (this.ui.open) this.ui.closePanel();
      else if (this.mode === 'photo') this.togglePhoto(false);
      else this.ui.openPanel('menu');
      return;
    }
    if (this.ui.open === 'fortune') {
      if (input.wasPressed('interact')) this.ui._fortuneClose && this.ui._fortuneClose();
      return;
    }
    if (input.wasPressed('map')) this.onUIAction('map');
    if (input.wasPressed('book')) this.onUIAction('book');
    if (input.wasPressed('photo')) this.onUIAction('photo');
    if (input.wasPressed('walkToggle') && this.mode === 'play') {
      this.player.walkToggle = !this.player.walkToggle;
      this.ui.subtitle(this.player.walkToggle ? '常跑：开' : '常跑：关', 1400);
    }
  }
  // 标题画面：沿河道上空缓缓向北滑行，远处是五重塔与雪山
  titleCamera(dt) {
    const t = this.time;
    const z = 70 - ((t * 1.6) % 150);
    const rq = riverNearest(0, z);
    const sway = Math.sin(t * 0.05) * 3;
    const pos = new THREE.Vector3(rq.cx + sway, 17 + Math.sin(t * 0.07) * 1.5, z);
    if (this.camera.position.distanceTo(pos) > 30) this.camera.position.copy(pos);
    this.camera.position.lerp(pos, 1 - Math.exp(-dt * 1.5));
    const ahead = riverNearest(0, z - 60);
    this.camera.lookAt(ahead.cx + 18, 9, z - 90);
  }
  updateHUD(dt) {
    this._hudT = (this._hudT || 0) - dt;
    if (this._hudT > 0) return;
    this._hudT = 0.1;
    this.ui.updateClock(this.daynight);
    this.ui.updateHints();
    const p = this.player.pos;
    this.mapArt.drawMini(this.miniCanvas, p.x, p.z, this.rig.yaw, this.player.yaw, this.markers());
    // 北方标记随地图旋转
    if (!this.northEl) this.northEl = this.root.querySelector('.hud-map .n');
    const R = this.miniCanvas.clientWidth / 2 - 10;
    this.northEl.style.transform = `translate(${Math.sin(this.rig.yaw) * R}px, ${-Math.cos(this.rig.yaw) * R}px)`;
    let reg = null, best = Infinity;
    for (const r of REGIONS) {
      const d = Math.hypot(p.x - r.x, p.z - r.z);
      if (d < r.r && d < best) {
        best = d;
        reg = r;
      }
    }
    if (reg && reg !== this.lastRegion) {
      this.regionCool = this.regionCool || {};
      if (this.time - (this.regionCool[reg.id] ?? -999) > 90) {
        this.ui.region(reg.name, reg.sub);
        this.regionCool[reg.id] = this.time;
        this.state.visited[reg.id] = true;
      }
    }
    this.lastRegion = reg;
    this._saveT = (this._saveT || 0) + 0.1;
    if (this._saveT > 20) {
      this._saveT = 0;
      this.saveNow();
    }
  }
  updateAudio(dt) {
    const A = this.audio;
    if (!A.ready) return;
    A.hour = this.daynight.hours;
    const p = this.mode === 'title' ? this.camera.position : this.player.pos;
    const rq = riverNearest(p.x, p.z);
    const tr = this.world.train;
    let trainDist = 9999;
    if (tr.visible) for (const c of tr.cars) trainDist = Math.min(trainDist, Math.hypot(c.mesh.position.x - p.x, c.mesh.position.z - p.z));
    const cr = this.world.crossing;
    const F = FIELDS.paddies;
    const nearPaddy = Math.hypot(Math.max(F.x0 - p.x, 0, p.x - F.x1), Math.max(F.z0 - p.z, 0, p.z - F.z1));
    A.update(dt, {
      gust: this.wind.gust,
      altitude: Math.max(0, p.y - 5),
      riverDist: Math.max(0, rq.d - 6),
      trainDist,
      trainSpeed: tr.v,
      crossing: cr.active,
      crossingDist: Math.hypot(cr.x - p.x, cr.z - p.z),
      hour: this.daynight.hours,
      nearPaddy,
    });
  }
}
