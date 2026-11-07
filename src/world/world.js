import * as THREE from 'three';
import { Terrain, createTerrainMaterial } from './terrain.js';
import { createSky, createFarMountain } from './sky.js';
import { createWater, createPaddyWater } from './water.js';
import { buildRoads, buildRiverbanks, buildDikes, lanternGeometry } from './roads.js';
import { Town, buildMachiya, buildHouse, buildFarmhouse, buildKura } from './buildings.js';
import {
  buildShrine, buildTemple, buildRedBridge, buildStoneBridge, buildFootBridge, buildStation, buildSchool,
  buildPark, buildLakePier, buildAncientSite, buildShotengaiStamp,
} from './landmarks.js';
import { placeUtilityPoles, buildWires, bench, vendingMachine, stampStand, signpost, curveMirror, bicycle } from './props.js';
import { Forest } from './trees.js';
import { FallingPetals, makeDensityTexture } from './petals.js';
import { GroundCover } from './vegetation.js';
import { buildTrack, Crossing, Train } from './railway.js';
import { Colliders } from './colliders.js';
import { SignAtlas, makeBlossomTexture, makeLeafTexture, loadFonts, signQuad } from './textures.js';
import { ChunkMap, PAT, GeoBuilder } from '../render/builder.js';
import { createWorldMaterial, createSignMaterial } from '../render/materials.js';
import { U, patchMaterial } from '../render/shaders.js';
import {
  SITES, ROADS, river, riverNearest, riverHalfWidth, isCanal, promenades, railway, railQuery, FIELDS, excluded,
  roadGrid, WORLD,
} from './layout.js';
import { RNG, nextFrame, pointAt, offsetPolyline, resample, lerp, smoothstep, clamp } from '../core/math.js';

export class World {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'world';
    scene.add(this.group);
    this.updatables = [];
    this.colliders = new Colliders(8);
    this.rng = new RNG(20260407);
    this.ctx = {
      colliders: this.colliders,
      rng: this.rng,
      lights: [],
      benches: [],
      stamps: [],
      interact: [],
      spots: {},
      treeSpots: [],
      noTree: [],
      noGrass: [], // { x, z, hw, hd, rot, margin }：不长草的区域
      landmarkHeights: {},
    };
  }
  async generate(progress = () => {}) {
    const steps = this.steps();
    for (let i = 0; i < steps.length; i++) {
      const [label, fn] = steps[i];
      progress(i / steps.length, label);
      await nextFrame();
      const t0 = performance.now();
      await fn();
      if (typeof window !== 'undefined' && window.__DEV_TIMING) console.log(`[gen] ${label}: ${(performance.now() - t0).toFixed(0)}ms`);
    }
    progress(1, '完成');
    if (typeof window !== 'undefined' && window.__DEV_TIMING) {
      const f = this.forest;
      console.log('[gen] lots', this.lots.length, 'types', JSON.stringify(this.lots.reduce((a, l) => ((a[l.type] = (a[l.type] || 0) + 1), a), {})),
        'sakura', f.sakura.length, 'other', JSON.stringify(Object.fromEntries(Object.entries(f.other).map(([k, v]) => [k, v.length]))),
        'atlasY', this.atlas.y, 'static', JSON.stringify(this.staticStats), 'lights', this.ctx.lights.length);
    }
  }
  steps() {
    const ctx = this.ctx;
    return [
      ['研墨、备纸', async () => {
        await loadFonts();
        this.atlas = new SignAtlas(2048);
        ctx.atlas = this.atlas;
        this.worldMat = createWorldMaterial();
        ctx.chunks = new ChunkMap(72);
        ctx.signs = new ChunkMap(96, true);
      }],
      ['测量山川', () => {
        this.terrain = new Terrain();
        this.terrain.generate();
        ctx.terrain = this.terrain;
      }],
      ['规划街道', () => {
        this.town = new Town(this.terrain, new RNG(3141));
        this.lots = this.town.placeAll();
        this.terrain.applyPads(this.town.pads());
        ctx.blocked = (x, z, r) => this.town.overlaps({ x, z, hw: r, hd: r, rot: 0 });
      }],
      ['建造神社与寺院', () => {
        buildShrine(ctx);
        buildTemple(ctx);
        this.redBridge = buildRedBridge(ctx);
        buildStoneBridge(ctx);
        // 南边的木桥
        const fb = riverNearest(20, 92);
        buildFootBridge(ctx, fb.cx, fb.cz);
        this.station = buildStation(ctx, this.terrain);
        buildSchool(ctx);
        buildPark(ctx, this.terrain);
        buildLakePier(ctx, this.terrain);
        buildAncientSite(ctx, this.terrain);
        buildShotengaiStamp(ctx, this.terrain);
      }],
      ['种下樱花', () => this.plantTrees()],
      ['铺设大地', () => {
        const sak = this.forest.sakura.map((t) => ({ x: t.x, z: t.z, r: 9 * t.scale }));
        if (this.forest.ancient) sak.push({ x: this.forest.ancient.x, z: this.forest.ancient.z, r: 17 });
        const occ = this.lots.map((l) => l.fp);
        for (const it of this.colliders.items) if (it.type === 'box' && it.tag !== 'low' && it.hw * it.hd > 1.5 && it.hw * it.hd < 1200) occ.push(it);
        this.terrain.computeColors(sak.map((t) => [t.x, t.z, t.r]), occ);
        this.terrainMat = createTerrainMaterial();
        for (const m of this.terrain.buildMeshes(this.terrainMat)) this.group.add(m);
        this.terrainTex = this.terrain.buildTextures();
        for (const l of this.lots) this.terrain.clearGrassRect(l.fp, 0.6);
        this.terrain.initGrassMask();
        this.density = makeDensityTexture(sak.map((t) => ({ x: t.x, z: t.z, r: t.r * 1.5 })));
      }],
      ['盖起町屋', () => this.buildTown()],
      ['挂上灯笼', () => this.buildProps()],
      ['铺设铁路', () => {
        const wires = buildTrack(ctx, this.terrain);
        this.trackWires = wires;
      }],
      ['合成几何', () => this.finalizeStatic()],
      ['引来河水', () => {
        this.water = createWater();
        this.group.add(this.water);
        this.paddies = createPaddyWater(this.terrain);
        this.group.add(this.paddies);
      }],
      ['花开满枝', () => {
        this.group.add(this.forest.build(this.rng));
        this.petals = new FallingPetals(this.density, Math.round(3600 * this.quality.petals));
        this.scene.add(this.petals.mesh);
        this.ground = new GroundCover(this.terrainTex, this.density, this.quality, this.buildGrassMask());
        this.scene.add(this.ground.group);
      }],
      ['悬起天空', () => {
        this.sky = createSky();
        this.scene.add(this.sky.mesh);
        this.farMountain = createFarMountain();
        this.scene.add(this.farMountain);
      }],
      ['放飞鲤鱼旗', () => this.buildKoinobori()],
      ['电车进站', () => {
        this.crossing = new Crossing(ctx, this.terrain, this.scene);
        const trainMat = createWorldMaterial();
        this.train = new Train(ctx, this.terrain, this.scene, trainMat, this.atlas);
        this.buildLightPools();
      }],
    ];
  }

  // 禁草遮罩：建筑占地、可行走表面（桥、站台、栈桥、坡道）、实体碰撞盒，以及各处登记的铺地
  buildGrassMask() {
    const T = this.terrain, ctx = this.ctx;
    for (const l of this.lots) T.maskRect(l.fp, 0.45);
    for (const o of ctx.noGrass) T.maskRect(o, o.margin ?? 0.25);
    for (const s of this.colliders.surfaces) T.maskRect(s, 0.3);
    for (const it of this.colliders.items) if (it.type === 'box' && it.tag !== 'low' && it.hw * it.hd < 1200) T.maskRect(it, 0.15);
    const sc = SITES.school;
    T.maskRect({ x: sc.x + 4, z: sc.z + 12, hw: 30, hd: 16, rot: 0 }, 0);
    return T.maskTexture();
  }

  // ---------------------------------------------------------------- 树木
  plantTrees() {
    const ctx = this.ctx;
    const T = this.terrain;
    const rng = new RNG(555);
    const forest = (this.forest = new Forest(makeBlossomTexture(512), makeLeafTexture('bamboo'), this.quality));
    const placed = [];
    const grid = new Map();
    const key = (x, z) => Math.floor(x / 6) + ',' + Math.floor(z / 6);
    const nearTree = (x, z, r) => {
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++) {
          const arr = grid.get(Math.floor(x / 6) + a + ',' + (Math.floor(z / 6) + b));
          if (!arr) continue;
          for (const p of arr) if (Math.hypot(p[0] - x, p[1] - z) < r) return true;
        }
      return false;
    };
    const mark = (x, z) => {
      const k = key(x, z);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push([x, z]);
    };
    const free = (x, z, roadClear = 1.6, spacing = 3.2) => {
      if (ctx.noTree.some(([nx, nz, r]) => Math.hypot(x - nx, z - nz) < r)) return false;
      const nr = T.nearestRoad(x, z, 8);
      if (nr && nr.d < nr.road.width / 2 + roadClear) return false;
      const rq = riverNearest(x, z);
      if (rq.d < riverHalfWidth(rq.s) + 1.5) return false;
      const rl = railQuery(x, z, 8);
      if (rl && rl.d < 4.5) return false;
      if (this.town.overlaps({ x, z, hw: 1.2, hd: 1.2, rot: 0 })) return false;
      if (T.waterAt(x, z) > T.heightAt(x, z) - 0.3) return false;
      if (nearTree(x, z, spacing)) return false;
      return true;
    };
    const plantSakura = (x, z, scale, lit, y = null) => {
      const h = y ?? T.heightAt(x, z);
      forest.addSakura(x, h, z, scale, lit, rng);
      mark(x, z);
      placed.push([x, z]);
    };
    // 1. 地标指定的树
    for (const t of ctx.treeSpots) {
      if (t.kind === 'ancient') {
        forest.ancient = { x: t.x, z: t.z, y: t.y };
        mark(t.x, t.z);
        continue;
      }
      const y = t.y ?? T.heightAt(t.x, t.z);
      if (t.kind === 'cedar') {
        forest.add('cedar', t.x, y, t.z, t.scale, rng);
        mark(t.x, t.z);
      } else if (free(t.x, t.z, 1.0, 3)) plantSakura(t.x, t.z, t.scale, t.lit ? 1 : 0, t.y ?? null);
    }
    // 2. 桜川两岸的樱花并木（城中段 + 下游）
    for (const side of [1, -1]) {
      const pts = promenades.line(side, 2.9);
      const dense = resample(pts, 1);
      let acc = 3;
      for (let i = 0; i < dense.length; i++) {
        acc += 1;
        if (acc < 8.2) continue;
        const [x, z] = dense[i];
        if (free(x, z, 0.9, 5.5)) {
          plantSakura(x, z, rng.float(0.95, 1.18), 1);
          acc = rng.float(-0.8, 0.8);
        }
      }
    }
    // 上游自然河段：稀疏的樱与杂木
    for (let i = 0; i < river.pts.length; i += 3) {
      const s = river.acc[i];
      if (s > river.canalStart - 5 || s < river.canalStart - 360) continue;
      const p = river.pts[i];
      for (const side of [1, -1]) {
        if (!rng.chance(0.35)) continue;
        const a = river.pts[Math.min(river.pts.length - 1, i + 1)];
        let tx = a[0] - p[0], tz = a[1] - p[1];
        const l = Math.hypot(tx, tz) || 1;
        const off = riverHalfWidth(s) + rng.float(4, 9);
        const x = p[0] + (tz / l) * off * side, z = p[1] - (tx / l) * off * side;
        if (free(x, z, 1, 4.5)) {
          if (rng.chance(0.6)) plantSakura(x, z, rng.float(0.85, 1.1), 0);
          else forest.add(rng.chance(0.5) ? 'broad' : 'maple', x, T.heightAt(x, z), z, rng.float(0.7, 1.0), rng);
          mark(x, z);
        }
      }
    }
    // 3. 桜小路的行道樱
    for (const name of ['桜小路', '寺への道', '湖畔の道', '学校の坂']) {
      const r = ROADS.find((rr) => rr.name === name);
      if (!r) continue;
      const L = r.acc[r.acc.length - 1];
      for (let s = 4; s < L; s += 11) {
        const pt = pointAt(r.pts, r.acc, s);
        for (const side of [1, -1]) {
          const off = r.width / 2 + 2.0;
          const x = pt.x + pt.tz * off * side, z = pt.z - pt.tx * off * side;
          if (free(x, z, 1.2, 6)) plantSakura(x, z, rng.float(0.85, 1.05), name === '寺への道' ? 1 : 0);
        }
      }
    }
    // 4. 铁路沿线（油菜花田旁）
    for (let s = 0; s < railway.total; s += 13) {
      const p = pointAt(railway.pts, railway.acc, s);
      if (Math.abs(p.x) > 340) continue;
      if (p.x > -90 && p.x < 190) continue;
      const side = p.x < 0 ? -1 : -1;
      const off = 9.5;
      const x = p.x + p.tz * off * side, z = p.z - p.tx * off * side;
      if (free(x, z, 1, 7)) plantSakura(x, z, rng.float(0.95, 1.15), 0);
    }
    // 5. 湖岸一圈
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      const L = SITES.lake;
      const r = L.r * 1.18 + rng.float(2, 10);
      const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r;
      if (free(x, z, 1, 6) && T.heightAt(x, z) < 12) plantSakura(x, z, rng.float(0.9, 1.15), 0);
    }
    // 6. 庭院树：民居旁的樱/松/枫
    for (const lot of this.lots) {
      if (lot.type === 'machiya' && lot.shop) continue;
      if (!rng.chance(lot.type === 'farm' ? 0.9 : 0.45)) continue;
      const c = Math.cos(lot.rot), s = Math.sin(lot.rot);
      const side = rng.sign();
      const lx = side * (lot.W / 2 + rng.float(1.6, 2.6)), lz = rng.float(-lot.D / 2, lot.D / 2);
      const x = lot.x + lx * c + lz * s, z = lot.z - lx * s + lz * c;
      if (!free(x, z, 1.2, 4)) continue;
      const k = rng.next();
      const y = T.heightAt(x, z);
      if (k < 0.45) plantSakura(x, z, rng.float(0.7, 0.9), 0);
      else if (k < 0.75) {
        forest.add('pine', x, y, z, rng.float(0.8, 1.1), rng);
        mark(x, z);
      } else if (k < 0.88) {
        forest.add('maple', x, y, z, rng.float(0.45, 0.6), rng);
        mark(x, z);
      } else {
        forest.add('broad', x, y, z, rng.float(0.45, 0.6), rng);
        mark(x, z);
      }
    }
    // 7. 山谷边缘与山坡：杂木林、山樱、杉林
    let tries = 0;
    let count = 0;
    const target = Math.round(4200 * (0.6 + 0.4 * this.quality.cards));
    while (count < target && tries < target * 6) {
      tries++;
      const r = Math.sqrt(rng.next()) * 1150;
      const a = rng.float(0, Math.PI * 2);
      const x = Math.cos(a) * r + 20, z = Math.sin(a) * r * 0.95 + 20;
      const h = T.heightAt(x, z);
      if (h < 10) continue;
      const nrm = T.normalAt(x, z);
      if (nrm.y < 0.55) continue;
      if (excluded(x, z, 4) && h < 40) continue;
      if (ctx.noTree.some(([nx, nz, rr]) => Math.hypot(x - nx, z - nz) < rr)) continue;
      const nr = T.nearestRoad(x, z, 6);
      if (nr && nr.d < nr.road.width / 2 + 2) continue;
      if (Math.hypot(x, z) < 260 && this.town.overlaps({ x, z, hw: 2, hd: 2, rot: 0 })) continue;
      const k = rng.next();
      const far = Math.hypot(x, z) > 600;
      const sc = rng.float(0.8, 1.3) * (far ? 1.4 : 1);
      if (k < 0.5) forest.add('cedar', x, h, z, sc, rng);
      else if (k < 0.8) forest.add('broad', x, h, z, sc, rng);
      else forest.add('yama', x, h, z, sc * 0.95, rng);
      count++;
    }
    // 8. 竹林：沿小径两侧
    const bamboo = ROADS.find((r) => r.name === '竹林の小径');
    for (let k = 0; k < 900; k++) {
      const s = rng.float(0, bamboo.acc[bamboo.acc.length - 1]);
      const pt = pointAt(bamboo.pts, bamboo.acc, s);
      const off = rng.float(2.0, 26) * rng.sign();
      const x = pt.x + pt.tz * off + rng.float(-1, 1), z = pt.z - pt.tx * off + rng.float(-1, 1);
      const nr = T.nearestRoad(x, z, 4);
      if (nr && nr.d < nr.road.width / 2 + 0.8) continue;
      if (ctx.noTree.some(([nx, nz, rr]) => Math.hypot(x - nx, z - nz) < rr)) continue;
      const h = T.heightAt(x, z);
      forest.add('bamboo', x, h, z, rng.float(0.75, 1.1), rng);
      this.colliders.addCircle(x, z, 0.12, h - 1, h + 12);
    }
    // 9. 灌木（杜鹃）沿道路与庭院
    for (const r of ROADS) {
      if (r.type === 'dirt' || r.promenade) continue;
      const L = r.acc[r.acc.length - 1];
      for (let s = rng.float(2, 10); s < L; s += rng.float(9, 22)) {
        const pt = pointAt(r.pts, r.acc, s);
        const side = rng.sign();
        const off = r.width / 2 + 1.0;
        const x = pt.x + pt.tz * off * side, z = pt.z - pt.tx * off * side;
        if (!free(x, z, 0.6, 2)) continue;
        forest.add('bush', x, T.heightAt(x, z), z, rng.float(0.7, 1.2), rng);
      }
    }
    // 树干碰撞
    for (const t of forest.sakura) this.colliders.addCircle(t.x, t.z, 0.35 * t.scale, t.y - 1, t.y + 3);
    for (const k of ['cedar', 'broad', 'yama', 'maple', 'pine'])
      for (const t of forest.other[k]) if (Math.hypot(t.x, t.z) < 520) this.colliders.addCircle(t.x, t.z, 0.35 * t.scale, t.y - 1, t.y + 3);
    if (forest.ancient) this.colliders.addCircle(forest.ancient.x, forest.ancient.z, 1.6, forest.ancient.y - 1, forest.ancient.y + 5);
    this.sakuraCount = forest.sakura.length;
  }

  // ---------------------------------------------------------------- 町屋与民居
  buildApron(b, lot, W) {
    const road = ROADS.find((r) => r.name === lot.road);
    const T = this.terrain;
    const hw = lot.W / 2 + 0.04, z0 = lot.D / 2 - 0.05, z1 = lot.D / 2 + (lot.setback || 1.2) + 0.12;
    // 商店街这类叠加的石板路覆盖到门前时，也铺石板
    const [ax, az] = W(0, lot.D / 2 + (lot.setback || 1.2) * 0.5);
    const onOverlay = ROADS.some((r) => r.overlay && r.type === 'stone' && r.pts.some((p) => Math.hypot(p[0] - ax, p[1] - az) < r.width / 2 + 3));
    const stone = !road || road.type === 'stone' || road.type === 'promenade' || onOverlay;
    b.place(lot.x, lot.y, lot.z, lot.rot);
    b.pattern(stone ? PAT.STONE : PAT.GRAVEL, 0);
    const nu = Math.max(2, Math.ceil(lot.W / 1.2)), nv = 3;
    b.surface((u, v) => {
      const lx = lerp(-hw, hw, u), lz = lerp(z0, z1, v);
      const [x, z] = W(lx, lz);
      return [lx, T.heightAt(x, z) - lot.y + 0.03, lz];
    }, nu, nv, stone ? '#a39c8f' : '#a9a59b', { flip: true, uvFn: (u, v) => [lerp(-hw, hw, u) + lot.x * 0.37, lerp(z0, z1, v)] });
    const [cx, cz] = W(0, (z0 + z1) / 2);
    this.ctx.noGrass.push({ x: cx, z: cz, hw, hd: (z1 - z0) / 2, rot: lot.rot, margin: 0.15 });
  }
  buildTown() {
    const ctx = this.ctx;
    const rng = new RNG(2718);
    this.shopSpots = [];
    this.houseDoors = [];
    for (const lot of this.lots) {
      const b = ctx.chunks.at(lot.x, lot.z);
      const sb = ctx.signs.at(lot.x, lot.z);
      b.place(lot.x, lot.y, lot.z, lot.rot);
      sb.place(lot.x, lot.y, lot.z, lot.rot);
      let out;
      const o = { W: lot.W, D: lot.D, shop: lot.shopInfo, setback: lot.setback || 2 };
      if (lot.type === 'machiya') out = buildMachiya(b, sb, this.atlas, rng, o);
      else if (lot.type === 'house') out = buildHouse(b, sb, this.atlas, rng, o);
      else if (lot.type === 'farm') out = buildFarmhouse(b, sb, this.atlas, rng, o);
      else out = buildKura(b, sb, this.atlas, rng, o);
      lot.out = out;
      const c = Math.cos(lot.rot), s = Math.sin(lot.rot);
      const W = (lx, lz) => [lot.x + lx * c + lz * s, lot.z - lx * s + lz * c];
      // 町屋门前到路边铺一条石板（犬走り），不再露出一条窄草带
      if (lot.type === 'machiya' && lot.road) this.buildApron(b, lot, W);
      this.colliders.addBox(lot.x, lot.z, lot.W / 2 + 0.05, lot.D / 2 + 0.05, lot.rot, lot.y - 2, lot.y + (out.height || 8));
      for (const L of out.lights || []) {
        const [x, z] = W(L[0], L[2]);
        ctx.lights.push([x, lot.y + L[1], z, 0.8]);
      }
      if (out.walls)
        for (const [x0, z0, x1, z1] of out.walls) {
          const a = W(x0, z0), bb = W(x1, z1);
          this.colliders.addWall(a[0], a[1], bb[0], bb[1], 0.3, lot.y - 2, lot.y + 1.4);
        }
      if (out.bench) {
        const [x, z] = W(out.bench.x, out.bench.z);
        ctx.benches.push({ x, z, y: lot.y + out.bench.y - 0.42, rot: lot.rot, seatY: lot.y + out.bench.y });
        this.colliders.addBox(x, z, 0.9, 0.35, lot.rot, lot.y - 1, lot.y + 0.5, 'low');
      }
      if (out.shopSpot && lot.shopInfo) {
        const [x, z] = W(out.shopSpot.x, out.shopSpot.z);
        this.shopSpots.push({ x, z, y: lot.y, rot: lot.rot, shop: lot.shopInfo });
        ctx.interact.push({ id: 'shop-' + lot.shopInfo.id + '-' + this.shopSpots.length, kind: 'shop', shop: lot.shopInfo, x, y: lot.y, z, r: 2.0, label: '看看「' + lot.shopInfo.name + '」' });
      }
      if (out.bike) {
        const [x, z] = W(out.bike.x, out.bike.z);
        const bb = ctx.chunks.at(x, z);
        bb.place(x, this.terrain.heightAt(x, z), z, lot.rot + Math.PI / 2 + rng.float(-0.2, 0.2));
        bicycle(bb, rng.pick(['#d8d4cc', '#7a9ab8', '#c94f4f', '#e3c46a', '#5f8f6a']));
        this.colliders.addCircle(x, z, 0.5, lot.y - 1, lot.y + 1.2);
      }
      if (out.door) this.houseDoors.push(W(out.door.x, out.door.z));
    }
  }

  // ---------------------------------------------------------------- 道具
  buildProps() {
    const ctx = this.ctx;
    const T = this.terrain;
    const rng = new RNG(99);
    // 道路
    buildRoads(ctx.chunks, T);
    // 护岸与灯笼串
    const rb = this.redBridge;
    const gaps = [];
    if (rb) for (const e of [-1, 1]) gaps.push([rb.cx + Math.cos(rb.rot) * e * (rb.L / 2 - 1), rb.cz - Math.sin(rb.rot) * e * (rb.L / 2 - 1), 3.2]);
    if (ctx.spots.footBridge) {
      const [x, , z, r] = ctx.spots.footBridge;
      // 沿整座桥的轴线留出栏杆缺口（河宽各处不同，只在两端留缺口会让栏杆横在桥面上）
      for (let t = -12; t <= 12; t += 1.5) gaps.push([x + Math.cos(r) * t, z - Math.sin(r) * t, 1.9]);
    }
    const lanterns = buildRiverbanks(ctx.chunks, this.colliders, T, gaps);
    for (const l of lanterns) {
      const b = ctx.chunks.at(l.x, l.z);
      b.identity();
      lanternGeometry(b, l.x, l.y + 0.32, l.z, l.pink ? '#f3b9c8' : '#f6efe2', 1.0);
      ctx.lights.push([l.x, l.y, l.z, 1]);
    }
    this.lanterns = lanterns;
    buildDikes(ctx.chunks, T, this.colliders);
    // 电线杆
    const { wires, lamps } = placeUtilityPoles(ctx);
    this.poleWires = wires;
    for (const l of lamps) ctx.lights.push([l[0], l[1], l[2], 1.2]);
    // 河岸长椅（面向河）
    for (const side of [1, -1]) {
      const pts = promenades.line(side, 1.9);
      for (let i = 10; i < pts.length - 4; i += 22) {
        const [x, z] = pts[i];
        if (ctx.noTree.some(([nx, nz, r]) => Math.hypot(x - nx, z - nz) < r)) continue;
        const nr = T.nearestRoad(x, z, 5);
        if (nr && !nr.road.promenade) continue;
        // 面向河：局部 +z 指向河心
        const rq = riverNearest(x, z);
        const fx = rq.cx - x, fz = rq.cz - z;
        const rot = Math.atan2(fx, fz);
        const y = T.heightAt(x, z) + 0.05;
        const b = ctx.chunks.at(x, z);
        b.place(x, y, z, rot);
        bench(b);
        ctx.benches.push({ x, z, y, rot });
        this.colliders.addBox(x, z, 0.9, 0.3, rot, y - 1, y + 0.9, 'low');
      }
    }
    // 御朱印台
    for (const st of ctx.stamps) {
      const b = ctx.chunks.at(st.x, st.z);
      const sb = ctx.signs.at(st.x, st.z);
      b.place(st.x, st.y, st.z, st.rot);
      sb.place(st.x, st.y, st.z, st.rot);
      stampStand(b, sb, this.atlas);
      this.colliders.addBox(st.x, st.z, 0.5, 0.35, st.rot, st.y - 1, st.y + 2);
      const c = Math.cos(st.rot), s = Math.sin(st.rot);
      ctx.interact.push({ id: 'stamp-' + st.id, kind: 'stamp', stamp: st, x: st.x + s * 0.9, y: st.y, z: st.z + c * 0.9, r: 1.9, label: '盖御朱印' });
    }
    // 售货机
    const vend = [[64, 14.5, Math.PI], [118, 1.2, 0], [-60, 15, Math.PI], [-88, 60, Math.PI / 2], [150, 64, Math.PI], [-30, -38, 0], [180, -52, 0]];
    for (const [x0, z0, r0] of vend) {
      // 找到附近不冲突的位置
      let ok = null;
      for (let k = 0; k < 12 && !ok; k++) {
        const x = x0 + rng.float(-4, 4) * (k > 0), z = z0 + rng.float(-4, 4) * (k > 0);
        if (this.town.overlaps({ x, z, hw: 0.7, hd: 0.6, rot: r0 })) continue;
        const nr = T.nearestRoad(x, z, 6);
        if (nr && nr.d < nr.road.width / 2 + 0.6) continue;
        ok = [x, z];
      }
      if (!ok) continue;
      const [x, z] = ok;
      const nr = T.nearestRoad(x, z, 12);
      const rot = nr ? Math.atan2(nr.cx - x, nr.cz - z) : r0;
      const y = T.heightAt(x, z);
      const b = ctx.chunks.at(x, z);
      b.place(x, y, z, rot);
      vendingMachine(b, rng.pick(['#d8dde0', '#c94f43', '#3f6b8a', '#e6e2d4']));
      this.colliders.addBox(x, z, 0.55, 0.42, rot, y - 1, y + 2);
      ctx.interact.push({ id: 'vend-' + x.toFixed(0), kind: 'vending', x: x + Math.sin(rot) * 0.95, y, z: z + Math.cos(rot) * 0.95, r: 1.6, label: '买饮料' });
      ctx.lights.push([x + Math.sin(rot) * 0.6, y + 1.2, z + Math.cos(rot) * 0.6, 0.5]);
    }
    // 弯道镜
    for (const [x, z] of [[-90, -36], [-82, 12], [-74, 58], [80, 51], [98, 98], [104, -58]]) {
      if (this.town.overlaps({ x, z, hw: 0.4, hd: 0.4, rot: 0 })) continue;
      const nr = T.nearestRoad(x, z, 10);
      if (!nr) continue;
      const dx = x - nr.cx, dz = z - nr.cz, dl = Math.hypot(dx, dz) || 1;
      const px = nr.cx + (dx / dl) * (nr.road.width / 2 + 0.5), pz = nr.cz + (dz / dl) * (nr.road.width / 2 + 0.5);
      const b = ctx.chunks.at(px, pz);
      b.place(px, T.heightAt(px, pz), pz, Math.atan2(-dx, -dz) + 0.6);
      curveMirror(b);
      this.colliders.addCircle(px, pz, 0.12, -50, 100);
    }
    // 路牌
    const signs = [
      [-6, -26, [{ text: '朱橋 ↑', angle: Math.PI / 2 }, { text: '石橋 ↓', angle: -Math.PI / 2 }]],
      [-90, -100, [{ text: '桜川神社', angle: Math.PI * 0.8 }, { text: '竹林の小径', angle: Math.PI * 0.55 }]],
      [100, -110, [{ text: '花雲寺', angle: Math.PI * 0.62 }]],
      [70, 16, [{ text: '桜川駅', angle: -Math.PI / 2 + 0.1 }, { text: '商店街', angle: 0 }]],
      [-70, 92, [{ text: '千年桜', angle: Math.PI }]],
      [172, 166, [{ text: '鏡湖', angle: -Math.PI * 0.3 }]],
      [110, -64, [{ text: '中学校', angle: 0 }]],
    ];
    for (const [x0, z0, items] of signs) {
      let x = x0, z = z0;
      const nr = T.nearestRoad(x, z, 12);
      if (nr && nr.d < nr.road.width / 2 + 0.8) {
        const dx = x - nr.cx, dz = z - nr.cz, dl = Math.hypot(dx, dz) || 1;
        x = nr.cx + (dx / dl) * (nr.road.width / 2 + 1.0);
        z = nr.cz + (dz / dl) * (nr.road.width / 2 + 1.0);
      }
      if (this.town.overlaps({ x, z, hw: 0.3, hd: 0.3, rot: 0 })) continue;
      const b = ctx.chunks.at(x, z);
      const sb = ctx.signs.at(x, z);
      const y = T.heightAt(x, z);
      b.place(x, y, z, 0);
      sb.place(x, y, z, 0);
      signpost(b, sb, this.atlas, items.map((it) => ({ text: it.text.replace(/ [↑↓]/, ''), angle: it.angle })));
      this.colliders.addCircle(x, z, 0.15, y - 1, y + 3);
    }
    // 河上的鲤鱼旗（朱桥附近，跨河拉一条绳）
    {
      const q = riverNearest(SITES.redBridge.x - 4, SITES.redBridge.z - 34);
      const nx = q.tz, nz = -q.tx;
      const ax = q.cx + nx * 14, az = q.cz + nz * 14, bx = q.cx - nx * 14, bz = q.cz - nz * 14;
      const ya = T.heightAt(ax, az), yb = T.heightAt(bx, bz);
      this.koinobori = { ax, az, ay: ya + 7.5, bx, bz, by: yb + 7.5 };
      for (const [x, z, y] of [[ax, az, ya], [bx, bz, yb]]) {
        const b = ctx.chunks.at(x, z);
        b.place(x, y, z, 0);
        b.pattern(PAT.BAMBOO, 0);
        b.cylinder(0, 0, 0, 0.11, 0.14, 8.6, 8, '#9cb26a');
        b.pattern(PAT.NONE, 0);
        b.sphere(0, 8.75, 0, 0.17, 10, 8, '#d6ad48');
        this.colliders.addCircle(x, z, 0.2, y - 1, y + 8);
      }
    }
    // 光池位置
    this.lightList = ctx.lights;
  }

  // ---------------------------------------------------------------- 合成
  finalizeStatic() {
    const ctx = this.ctx;
    const stats = ctx.chunks.stats();
    this.staticMeshes = ctx.chunks.build(this.worldMat, { name: 'static' });
    for (const m of this.staticMeshes) this.group.add(m);
    this.signMat = createSignMaterial(this.atlas.texture());
    this.signMeshes = ctx.signs.build(this.signMat, { castShadow: false, name: 'signs' });
    for (const m of this.signMeshes) this.group.add(m);
    // 电线
    const wireMat = new THREE.LineBasicMaterial({ color: 0x2b2a2a, transparent: true, opacity: 0.85 });
    patchMaterial(wireMat, { key: 'wire' });
    const all = [...(this.poleWires || []), ...(this.trackWires || [])];
    if (all.length) {
      this.wires = buildWires(all, wireMat);
      this.group.add(this.wires);
    }
    this.staticStats = stats;
  }

  // 鲤鱼旗：跨河的绳上挂一串，随风摆动；湖上的小船随波起伏
  buildKoinobori() {
    const k = this.koinobori;
    if (k) {
      const pos = [], col = [], nor = [], idx = [], along = [], koi = [];
      const colors = ['#2a2a30', '#c83a32', '#3d6fb0', '#3f8a58', '#e48aa6', '#e8a23a', '#7b4aa0'];
      const N = 9;
      const NR = 24;
      const ropePts = [];
      for (let i = 0; i <= NR; i++) {
        const t = i / NR;
        ropePts.push([lerp(k.ax, k.bx, t), lerp(k.ay, k.by, t) - Math.sin(t * Math.PI) * 1.4, lerp(k.az, k.bz, t)]);
      }
      // 绳：深色、够粗，远处也看得见
      const rb = this.ctx.chunks.at(k.ax, k.az);
      rb.identity();
      rb.pattern(PAT.NONE, 0);
      rb.tube(ropePts, 0.032, 4, '#4f4436');
      const dirx = k.bx - k.ax, dirz = k.bz - k.az;
      const L = Math.hypot(dirx, dirz);
      const px = -dirz / L, pz = dirx / L; // 垂直于绳（沿河方向）
      for (let c = 0; c < N; c++) {
        const t = (c + 1) / (N + 1);
        const ri = t * NR;
        const a = ropePts[Math.floor(ri)], b = ropePts[Math.min(NR, Math.floor(ri) + 1)];
        const f = ri - Math.floor(ri);
        const rx = lerp(a[0], b[0], f), ry = lerp(a[1], b[1], f), rz = lerp(a[2], b[2], f);
        const hx = rx, hy = ry - 0.42, hz = rz;
        // 吊绳
        rb.tube([[rx, ry, rz], [hx, hy + 0.3, hz]], 0.012, 3, '#4f4436');
        const len = 2.4 + (c % 3) * 0.4;
        const R0 = 0.34 * (len / 2.6);
        const base = new THREE.Color(colors[c % colors.length]);
        const belly = base.clone().lerp(new THREE.Color('#ffffff'), 0.55);
        const seg = 18, ring = 12;
        const start = pos.length / 3;
        for (let i = 0; i <= seg; i++) {
          const u = i / seg;
          // 口圈略收、身体渐细，尾部压扁成鳍
          const r = R0 * (u < 0.05 ? 0.9 + u * 2 : 1 - Math.pow(u, 1.5) * 0.5);
          const flat = 1 - smoothstep(0.76, 1.0, u) * 0.82;
          const wide = 1 + smoothstep(0.76, 1.0, u) * 0.25;
          for (let j = 0; j <= ring; j++) {
            const th = (j / ring) * Math.PI * 2;
            const cx = hx + px * u * len, cz = hz + pz * u * len;
            const y = hy + Math.sin(th) * r * flat;
            const side = Math.cos(th) * r * wide;
            pos.push(cx + (dirx / L) * side, y, cz + (dirz / L) * side);
            nor.push((dirx / L) * Math.cos(th), Math.sin(th), (dirz / L) * Math.cos(th));
            const cc = Math.sin(th) < -0.25 ? belly : base;
            col.push(cc.r, cc.g, cc.b);
            along.push(u, c * 1.7);
            koi.push(u, th, len, R0);
          }
        }
        for (let i = 0; i < seg; i++)
          for (let j = 0; j < ring; j++) {
            const a0 = start + i * (ring + 1) + j, b0 = a0 + ring + 1;
            idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
          }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 2));
      g.setAttribute('aKoi', new THREE.Float32BufferAttribute(koi, 4));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, side: THREE.DoubleSide });
      patchMaterial(mat, {
        key: 'koinobori',
        uniforms: ['uTime', 'uWind', 'uGust'],
        vertexHead: 'attribute vec2 aAlong; attribute vec4 aKoi; varying vec4 vKoi; uniform float uTime; uniform vec2 uWind; uniform float uGust;\n',
        vertexBegin: /* glsl */ `
          {
            vKoi = aKoi;
            float u = aAlong.x;
            float w = sin(uTime * 3.2 - u * 7.0 + aAlong.y) * 0.32 * u;
            transformed.y += w + (1.0 - (0.4 + uGust * 0.6)) * u * u * -1.1;
            transformed.xz += uWind * sin(uTime * 2.1 + aAlong.y + u * 3.0) * 0.25 * u;
          }
        `,
        fragmentHead: 'varying vec4 vKoi;\n',
        fragmentColor: /* glsl */ `
          {
            float u = vKoi.x, th = vKoi.y, len = vKoi.z, r0 = vKoi.w;
            // 鳞：错位排列的弧线
            vec2 sc = vec2(u * len * 3.4, th / 6.2832 * 11.0);
            sc.y += mod(floor(sc.x), 2.0) * 0.5;
            vec2 sf = fract(sc) - vec2(0.0, 0.5);
            float arc = smoothstep(0.09, 0.0, abs(length(sf) - 0.55)) * step(0.14, u) * step(u, 0.78);
            diffuseColor.rgb *= 1.0 - 0.3 * arc;
            // 尾鳍条纹
            diffuseColor.rgb *= 1.0 - 0.2 * step(0.78, u) * (0.5 + 0.5 * sin(th * 9.0 + u * 34.0));
            // 两侧的眼睛（白眼圈 + 黑瞳）
            float dth = min(min(abs(th), abs(th - 3.14159)), abs(th - 6.28318));
            float er = length(vec2((u - 0.085) * len, dth * r0));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.94, 0.9), smoothstep(0.082, 0.07, er));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03), smoothstep(0.045, 0.035, er));
            // 口圈
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.87, 0.72), step(u, 0.028));
          }
        `,
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = true;
      mesh.name = 'koinobori';
      this.group.add(mesh);
    }
    // 小船
    const boats = this.ctx.boats || [];
    if (boats.length) {
      const B = new GeoBuilder();
      B.pattern(PAT.PLANK, 0);
      B.surface((u, v) => {
        const x = (u - 0.5) * 3.4;
        const w = 0.75 * Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.5) * 2, 4)));
        const a = (v - 0.5) * Math.PI;
        return [x, -Math.cos(a) * 0.38 + Math.pow(Math.abs(u - 0.5) * 2, 3) * 0.25, Math.sin(a) * w];
      }, 10, 6, '#8a6a4c', { doubleSided: true, backColor: '#a58363', uvFn: (u, v) => [u * 3.4, v * 1.6] });
      B.box(0, -0.12, 0, 0.3, 0.06, 1.3, '#6b4f39');
      const geo = B.toGeometry();
      this.boats = boats.map((bt, i) => {
        const m = new THREE.Mesh(geo, this.worldMat);
        m.position.set(bt.x, WORLD.lakeLevel + 0.18, bt.z);
        m.rotation.y = bt.rot;
        m.castShadow = true;
        m.userData.phase = i * 1.9;
        this.group.add(m);
        return m;
      });
    }
  }

  // 夜里地面上的暖色光池
  buildLightPools() {
    const lights = this.ctx.lights.filter((l) => l[3] > 0);
    const T = this.terrain;
    const n = lights.length;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    const data = new Float32Array(n * 4);
    lights.forEach((l, i) => {
      const gy = T.heightAt(l[0], l[2]);
      data.set([l[0], Math.min(gy, l[1]) + 0.08, l[2], (l[3] || 1) * clamp((l[1] - gy) * 2.0 + 2.8, 3.2, 8.0)], i * 4);
    });
    g.setAttribute('aLight', new THREE.InstancedBufferAttribute(data, 4));
    g.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uNight: U.uNight, uColor: U.uLanternColor },
      vertexShader: /* glsl */ `
        attribute vec4 aLight; varying vec2 vP;
        void main(){ vP = position.xz; vec3 w = vec3(aLight.x, aLight.y, aLight.z) + position * vec3(aLight.w, 1.0, aLight.w); gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uNight; uniform vec3 uColor; varying vec2 vP;
        // 灯下的光池：高斯衰减（边缘平滑地归零）+ 轻微抖动，避免一圈圈的色带
        float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        void main(){
          float d2 = dot(vP, vP);
          float a = max((exp(-d2 * 3.2) - 0.0408) / 0.9592, 0.0);
          a *= uNight * 0.3;
          a += (h12(gl_FragCoord.xy) - 0.5) * (1.5 / 255.0) * step(0.001, a);
          gl_FragColor = vec4(uColor * vec3(1.0, 0.93, 0.85) * max(a, 0.0), 1.0);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.name = 'lightPools';
    this.scene.add(mesh);
    this.lightPools = mesh;
  }

  update(dt, game) {
    const cam = game.camera.position;
    if (this.petals) this.petals.update(dt, cam, U.uWind.value, U.uGust.value);
    if (this.ground) this.ground.update(cam);
    if (this.train) {
      this.train.update(dt);
      const active = this.train.approaching(this.crossing.s, 260);
      this.crossing.update(dt, active);
    }
    if (this.boats) {
      const t = game.time;
      for (const b of this.boats) {
        b.position.y = WORLD.lakeLevel + 0.16 + Math.sin(t * 1.3 + b.userData.phase) * 0.05;
        b.rotation.z = Math.sin(t * 1.1 + b.userData.phase) * 0.04;
        b.rotation.x = Math.sin(t * 0.9 + b.userData.phase * 2) * 0.03;
      }
    }
    for (const u of this.updatables) u.update(dt, game);
  }
}
