// 入口：按步骤生成整个人物，返回按材质分组的网格数据。
// 浏览器里可以逐步执行（便于显示进度），Node 里可以一次跑完并导出 GLB。
import { Model, setDetail, DETAIL } from './core.js';
import { buildHead } from './face.js';
import { buildNeck, buildHands, buildLegs, buildShoes } from './body.js';
import { buildBlouse, buildCollar, buildBow, buildSleeves, buildSkirt } from './clothes.js';
import { buildHair, buildHairStrands } from './hair.js';

export const STEPS = [
  ['勾勒面庞', (m) => buildHead(m)],
  ['塑造身形', (m) => { buildNeck(m); buildLegs(m); }],
  ['双手', (m) => buildHands(m)],
  ['裁剪水手服', (m) => buildBlouse(m)],
  ['缝上大翻领', (m) => buildCollar(m)],
  ['袖子与袖口', (m) => buildSleeves(m)],
  ['系好领结', (m) => buildBow(m)],
  ['熨烫百褶裙', (m) => buildSkirt(m)],
  ['乐福鞋', (m) => buildShoes(m)],
  ['梳理黑发', (m) => buildHair(m)],
  // 以下四步只在 2000 万面档位里有内容：给每束头发铺细发丝
  ['细发丝 · 一', (m) => buildHairStrands(m, 0, 4)],
  ['细发丝 · 二', (m) => buildHairStrands(m, 1, 4)],
  ['细发丝 · 三', (m) => buildHairStrands(m, 2, 4)],
  ['细发丝 · 四', (m) => buildHairStrands(m, 3, 4)],
];

// 两个精度档位：standard 约 430 万面（浏览器里流畅）；ultra 不少于 2000 万面
export const LEVELS = {
  standard: { label: '标准', minTriangles: 2_000_000 },
  ultra: { label: '2000 万', minTriangles: 20_000_000 },
};

// 材质的 PBR 参数（查看器与 GLB 导出共用）
export const MATERIALS = {
  skin: { roughness: 0.62, metalness: 0, sheen: 0.6, sheenColor: '#ffc4b4' },
  eye: { roughness: 0.12, metalness: 0 },
  lash: { roughness: 0.7, metalness: 0 },
  hair: { roughness: 0.44, metalness: 0, specularIntensity: 0.75, sheen: 0.35, sheenColor: '#6a6f98' },
  hairfine: { roughness: 0.44, metalness: 0, specularIntensity: 0.75, sheen: 0.35, sheenColor: '#6a6f98' },
  cloth: { roughness: 0.82, metalness: 0 },
  ribbon: { roughness: 0.45, metalness: 0, sheen: 0.5, sheenColor: '#ff8a8a' },
  tights: { roughness: 0.7, metalness: 0 },
  leather: { roughness: 0.32, metalness: 0, clearcoat: 0.5 },
};

export function* buildSteps(model = new Model(), { detail = 'standard' } = {}) {
  setDetail(detail);
  for (const [label, fn] of STEPS) {
    if (label.startsWith('细发丝') && !DETAIL.strandsPerLock) continue;
    yield label;
    fn(model);
  }
  return model;
}

export function finishModel(model) {
  const parts = [];
  let tris = 0, verts = 0;
  for (const mesh of model.meshes.values()) {
    if (!mesh.triangleCount) continue;
    const p = mesh.finish();
    parts.push(p);
    tris += p.indices.length / 3;
    verts += p.positions.length / 3;
  }
  return { parts, triangles: tris, vertices: verts };
}

export function buildFigure(opts = {}) {
  const model = new Model();
  const it = buildSteps(model, opts);
  while (!it.next().done);
  return finishModel(model);
}
