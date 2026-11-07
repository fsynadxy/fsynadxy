// 桜川町总体规划（单位：米；+x 东，+z 南，-z 北）
// 一条桜川自北方群山流下，穿过小镇中心注入东南的镜湖；
// 西北山丘上是桜川神社，东北山腰立着花雲寺五重塔，南侧铁路与车站，西南田野中央是千年垂樱。
import {
  catmullRom, resample, cumulative, pointAt, offsetPolyline, SegmentGrid, clamp, smoothstep, lerp,
} from '../core/math.js';

export const WORLD = {
  half: 2600, // 地形半边长
  inner: 340, // 2 米精度区域半边长
  playRadius: 470,
  lakeLevel: 0.2,
};

// ---------- 河流 ----------
const RIVER_CTRL = [
  [-70, -980], [-55, -700], [-40, -520], [-30, -380], [-38, -262], [-14, -172], [6, -100], [2, -30],
  [-4, 6], [4, 60], [28, 112], [62, 150], [114, 190], [166, 224], [210, 250], [232, 262],
];
export const river = (() => {
  const dense = resample(catmullRom(RIVER_CTRL, 16), 3);
  const acc = cumulative(dense);
  const total = acc[acc.length - 1];
  const grid = new SegmentGrid(24);
  grid.addPolyline(dense, (i) => i, 0);
  // 城中段（石砌河岸）z ∈ [-205, 132]
  let canalStart = 0, canalEnd = 0;
  for (let i = 0; i < dense.length; i++) {
    if (dense[i][1] > -205 && !canalStart) canalStart = acc[i];
    if (dense[i][1] < 132) canalEnd = acc[i];
  }
  // 湖岸弧长
  let lakeS = total;
  for (let i = 0; i < dense.length; i++) {
    const dx = dense[i][0] - 230, dz = dense[i][1] - 265;
    if (Math.hypot(dx, dz) < 72) {
      lakeS = acc[i];
      break;
    }
  }
  return { pts: dense, acc, total, grid, canalStart, canalEnd, lakeS };
})();

// 水位：越往上游越高；城中段平缓
export function riverWaterLevel(s) {
  const base = WORLD.lakeLevel + 0.0024 * Math.max(0, river.lakeS - s);
  const up = Math.max(0, river.canalStart - 40 - s);
  return base + up * 0.014 + Math.pow(Math.max(0, river.canalStart - 300 - s) / 100, 2) * 6;
}
// 河道半宽
export function riverHalfWidth(s) {
  if (s < river.canalStart - 30) return lerp(4.5, 7.5, smoothstep(0, river.canalStart - 30, s));
  if (s <= river.canalEnd + 10) return 7;
  return lerp(7, 9.5, smoothstep(river.canalEnd + 10, river.canalEnd + 120, s));
}
export function isCanal(s) {
  return s >= river.canalStart && s <= river.canalEnd;
}
// 岸顶高度（步道高度）
export function bankLevel(s) {
  const wl = riverWaterLevel(s);
  const k = smoothstep(river.canalStart - 60, river.canalStart, s) * (1 - smoothstep(river.canalEnd, river.canalEnd + 60, s));
  return wl + lerp(1.15, 1.95, k);
}
// 最近河流点：粗到细两级搜索（先在 24 米粗折线上找，再在附近细分段精确求解），任意距离都有结果
const COARSE_STEP = 8;
const coarseIdx = [];
for (let i = 0; i < river.pts.length; i += COARSE_STEP) coarseIdx.push(i);
if (coarseIdx[coarseIdx.length - 1] !== river.pts.length - 1) coarseIdx.push(river.pts.length - 1);
export function riverNearest(x, z) {
  const P = river.pts;
  let bestK = 0, bestD = Infinity;
  for (let k = 0; k < coarseIdx.length - 1; k++) {
    const a = P[coarseIdx[k]], b = P[coarseIdx[k + 1]];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = a[0] + dx * t - x, ez = a[1] + dz * t - z;
    const d2 = ex * ex + ez * ez;
    if (d2 < bestD) {
      bestD = d2;
      bestK = k;
    }
  }
  const i0 = coarseIdx[Math.max(0, bestK - 1)], i1 = coarseIdx[Math.min(coarseIdx.length - 1, bestK + 2)];
  let bi = i0, bt = 0, bd = Infinity, bcx = 0, bcz = 0;
  for (let i = i0; i < i1; i++) {
    const a = P[i], b = P[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz || 1e-9;
    let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = a[0] + dx * t, cz = a[1] + dz * t;
    const d2 = (cx - x) * (cx - x) + (cz - z) * (cz - z);
    if (d2 < bd) {
      bd = d2;
      bi = i;
      bt = t;
      bcx = cx;
      bcz = cz;
    }
  }
  const a = P[bi], b = P[bi + 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
  const sideRaw = (x - bcx) * tz - (z - bcz) * tx;
  return {
    d: Math.sqrt(bd),
    s: river.acc[bi] + bt * (river.acc[bi + 1] - river.acc[bi]),
    cx: bcx, cz: bcz, tx, tz,
    side: sideRaw >= 0 ? 1 : -1, // +1 为水流方向左侧（向南流时即东岸）
  };
}
export function riverQuery(x, z, r = 120) {
  const q = riverNearest(x, z);
  return q.d <= r ? q : null;
}

// ---------- 道路网 ----------
// type: asphalt 柏油 / stone 石板 / gravel 碎石 / dirt 土路 / promenade 河岸步道
export const ROADS = [];
function road(name, pts, width, type, opts = {}) {
  const dense = resample(catmullRom(pts, 8), 2);
  const r = { name, ctrl: pts, pts: dense, acc: cumulative(dense), width, type, ...opts };
  ROADS.push(r);
  return r;
}
// 本通り（东西主街），在中心以石桥跨河，东段为石板商店街
road('本通り', [[-340, 34], [-250, 22], [-150, 13], [-70, 8], [-4, 6], [60, 7], [150, 9], [184, 4], [206, -14], [214, -22]], 7, 'asphalt', { main: true });
road('商店街', [[22, 6.6], [60, 7], [150, 9]], 9.4, 'stone', { overlay: true });
// 车站通り
road('駅前通り', [[70, 7.4], [76, 50], [96, 104], [128, 128], [142, 131]], 6, 'asphalt');
// 西通り：神社参道口 → 道口 → 南方田野
road('西通り', [[-100, -102], [-92, -40], [-82, 8], [-72, 70], [-62, 154], [-74, 230], [-110, 310]], 6, 'asphalt');
// 住宅小巷
road('北小路', [[-160, -42], [-92, -40], [-40, -44], [-16, -46]], 4.2, 'asphalt');
road('寺町小路', [[-150, -76], [-96, -74], [-50, -80], [-16, -84]], 4, 'asphalt');
road('柳小路', [[-160, 52], [-78, 54], [-40, 56], [-14, 57]], 4.2, 'asphalt');
road('田の道', [[-74, 96], [-120, 95], [-160, 94], [-184, 92], [-206, 90]], 3.2, 'dirt');
road('南小路', [[-66, 126], [-20, 124], [12, 121]], 4, 'asphalt');
road('東小路', [[16, 50], [78, 55], [160, 58], [204, 50]], 4.2, 'asphalt');
road('桜小路', [[38, 99], [96, 101], [170, 104], [196, 96]], 4, 'asphalt');
road('寺への道', [[102, 8.5], [104, -56], [100.5, -117]], 4.5, 'stone');
road('朱橋の道', [[18, -102], [56, -112], [98, -118]], 3.5, 'gravel');
road('学校の坂', [[108, -58], [170, -60], [196, -48]], 4.2, 'asphalt');
road('湖畔の道', [[156, 140], [196, 162], [214, 188]], 3.6, 'gravel');
road('竹林の小径', [[-196, -186], [-188, -218], [-160, -246], [-120, -252], [-80, -240], [-56, -222]], 2.6, 'dirt');
road('公園の道', [[30, -28], [58, -40], [86, -30]], 3, 'gravel');

// 河岸步道（城中段两岸）
// 步道离河心的距离：运河段 11 m（紧挨压顶石）；出了运河，随河面变宽逐渐外移，和水之间留一段草坡
export function promenadeOffset(s) {
  if (isCanal(s)) return 11;
  const k = s > river.canalEnd ? smoothstep(river.canalEnd, river.canalEnd + 28, s) : smoothstep(river.canalStart, river.canalStart - 20, s);
  return 11 + (Math.max(0, riverHalfWidth(s) + 4.6 - 11) + 0.8) * k;
}
export const promenades = (() => {
  const i0 = river.acc.findIndex((a) => a >= river.canalStart);
  let i1 = river.acc.findIndex((a) => a >= river.canalEnd + 150);
  if (i1 < 0) i1 = river.pts.length - 1;
  const j0 = Math.max(0, i0 - 6);
  const center = river.pts.slice(j0, i1);
  const offs = center.map((p, i) => promenadeOffset(river.acc[j0 + i]));
  // side：+1 东岸（左法线方向），-1 西岸；delta：在步道中线基础上再往外的距离
  const line = (side, delta = 0) => center.map((p, i) => {
    const a = center[Math.max(0, i - 1)], c = center[Math.min(center.length - 1, i + 1)];
    let tx = c[0] - a[0], tz = c[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const o = side * (offs[i] + delta);
    return [p[0] + tz * o, p[1] - tx * o];
  });
  // 河向南流：左侧（正偏移）为东岸
  const east = line(1).filter((p, i) => i % 2 === 0);
  const west = line(-1).filter((p, i) => i % 2 === 0);
  return { center, west, east, line };
})();
road('西岸步道', promenades.west, 3.4, 'promenade', { promenade: true, raw: true });
road('東岸步道', promenades.east, 3.4, 'promenade', { promenade: true, raw: true });

// raw 道路不做样条平滑（已是稠密点列）
for (const r of ROADS) {
  if (r.raw) {
    r.pts = resample(r.ctrl, 2);
    r.acc = cumulative(r.pts);
  }
}

export const roadGrid = (() => {
  const g = new SegmentGrid(20);
  ROADS.forEach((r, ri) => {
    if (r.overlay) return;
    g.addPolyline(r.pts, (i) => ({ ri, i }), 0);
  });
  return g;
})();

// ---------- 铁路 ----------
const RAIL_CTRL = [[-900, 186], [-520, 168], [-260, 158], [-60, 154], [62, 151], [150, 152], [300, 166], [520, 196], [900, 250]];
export const railway = (() => {
  const pts = resample(catmullRom(RAIL_CTRL, 10), 2);
  const acc = cumulative(pts);
  const grid = new SegmentGrid(24);
  grid.addPolyline(pts, (i) => i, 0);
  return { pts, acc, total: acc[acc.length - 1], grid };
})();
export function railQuery(x, z, r = 40) {
  const q = railway.grid.nearest(x, z, r);
  if (!q) return null;
  const i = q.seg.data;
  const s = railway.acc[i] + q.t * (railway.acc[i + 1] - railway.acc[i]);
  return { d: q.d, s, cx: q.cx, cz: q.cz };
}

// ---------- 地标 ----------
export const SITES = {
  shrine: { x: -178, z: -158, top: 25.5, plateau: 34, outer: 92, name: '桜川神社' },
  temple: { x: 130, z: -188, top: 19, plateau: 30, outer: 78, name: '花雲寺' },
  school: { x: 222, z: -44, top: 7.6, plateau: 48, outer: 86, name: '桜川中学校' },
  ancient: { x: -218, z: 88, top: 10.5, plateau: 14, outer: 62, name: '千年桜' },
  station: { x: 146, z: 140, name: '桜川駅' },
  lake: { x: 232, z: 268, r: 74, name: '鏡湖' },
  park: { x: 58, z: -54, name: '桜ヶ丘公園' },
  bamboo: { x: -150, z: -236, name: '竹林の小径' },
  redBridge: { x: 7, z: -101, name: '朱橋' },
  stoneBridge: { x: -4, z: 6, name: '石橋' },
};

// 神社石阶：山脚 → 平台边缘（笔直的参道，沿途立着鸟居）
export const STAIRS = {
  shrine: { x0: -108, z0: -106, x1: -153, z1: -140, w: 4.2 },
  temple: { x0: 100.4, z0: -119.9, x1: 118.7, z1: -162.4, w: 4 },
};

// 稻田与油菜花田
export const FIELDS = {
  paddies: { x0: -330, x1: -92, z0: 178, z1: 292, cell: [26, 20] },
  nanohana: [
    { x0: -300, x1: -96, z0: 166, z1: 176 },
    { x0: 160, x1: 290, z0: 172, z1: 184 },
    { x0: -160, x1: -110, z0: 104, z1: 140 },
  ],
};

// 不放置程序化房屋的区域
export const EXCLUDE = [
  { type: 'circle', x: SITES.shrine.x, z: SITES.shrine.z, r: SITES.shrine.outer + 4 },
  { type: 'circle', x: SITES.temple.x, z: SITES.temple.z, r: SITES.temple.outer },
  { type: 'circle', x: SITES.school.x, z: SITES.school.z, r: 70 },
  { type: 'circle', x: SITES.ancient.x, z: SITES.ancient.z, r: 66 },
  { type: 'circle', x: SITES.lake.x, z: SITES.lake.z, r: 118 },
  { type: 'rect', x0: 20, x1: 94, z0: -90, z1: -18 }, // 公园
  { type: 'rect', x0: 98, x1: 192, z0: 116, z1: 150 }, // 车站
  { type: 'rect', x0: -340, x1: -86, z0: 158, z1: 300 }, // 田
  { type: 'rect', x0: -230, x1: -60, z0: -300, z1: -180 }, // 竹林
  { type: 'rect', x0: -114, x1: -96, z0: -150, z1: -96 }, // 参道口
];
export function excluded(x, z, margin = 0) {
  for (const e of EXCLUDE) {
    if (e.type === 'circle') {
      if (Math.hypot(x - e.x, z - e.z) < e.r + margin) return true;
    } else if (x > e.x0 - margin && x < e.x1 + margin && z > e.z0 - margin && z < e.z1 + margin) return true;
  }
  return false;
}

// 区域名（进入时显示）
export const REGIONS = [
  { id: 'shrine', name: '桜川神社', sub: '山丘上守望小镇的古老神社', x: -178, z: -158, r: 50 },
  { id: 'temple', name: '花雲寺 · 五重塔', sub: '春霞中的朱色宝塔', x: 128, z: -184, r: 44 },
  { id: 'school', name: '桜川中学校', sub: '入学式的樱花正盛', x: 222, z: -44, r: 52 },
  { id: 'ancient', name: '千年桜', sub: '田野中央的垂枝老樱', x: -218, z: 88, r: 40 },
  { id: 'station', name: '桜川駅', sub: '每隔几分钟，一列小电车慢悠悠驶过', x: 146, z: 140, r: 36 },
  { id: 'lake', name: '鏡湖', sub: '倒映着天空的湖', x: 232, z: 268, r: 98 },
  { id: 'park', name: '桜ヶ丘公園', sub: '赏花的人们铺开了蓝色野餐垫', x: 58, z: -54, r: 36 },
  { id: 'bamboo', name: '竹林の小径', sub: '风吹过时，竹叶沙沙作响', x: -140, z: -236, r: 50 },
  { id: 'shotengai', name: '本通り商店街', sub: '和果子、茶与旧书的香气', x: 88, z: 8, r: 50 },
  { id: 'redbridge', name: '朱橋', sub: '花筏从桥下缓缓流过', x: 7, z: -101, r: 22 },
  { id: 'fields', name: '菜の花畑と田んぼ', sub: '灌满水的稻田像一面面镜子', x: -210, z: 220, r: 100 },
  { id: 'river', name: '桜川の並木道', sub: '两岸樱花连绵，花瓣落满河面', x: 0, z: -40, r: 30 },
];

// 玩家出生点（石桥北侧的西岸步道，面向北方的樱花并木与远山）
// yaw 为角色朝向角（朝向 = (sin yaw, cos yaw)），π 表示面朝北方
export const SPAWN = { x: -12, z: -14, yaw: Math.PI + 0.1 };

export { clamp };
