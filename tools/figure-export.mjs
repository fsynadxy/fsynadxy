// 在 Node 里生成人物并导出 GLB：
//   node tools/figure-export.mjs [输出路径] [--detail ultra|standard]
// 默认导出 2000 万面档位（ultra）；同时打印各部件三角面数，并检查是否达到该档位的面数下限。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildFigure, MATERIALS, LEVELS } from '../figure/model/index.js';
import { exportGLB } from '../figure/model/gltf.js';

const args = process.argv.slice(2);
const di = args.indexOf('--detail');
const detail = di >= 0 ? args[di + 1] : 'ultra';
if (!LEVELS[detail]) {
  console.error(`未知精度：${detail}（可选 ${Object.keys(LEVELS).join(' / ')}）`);
  process.exit(2);
}
const rest = args.filter((a, i) => i !== di && i !== di + 1);
const out = resolve(rest[0] || `dist-figure/kurokami-schoolgirl-${detail}.glb`);
const fmt = (n) => n.toLocaleString('en-US');

const t0 = performance.now();
const fig = buildFigure({ detail });
const t1 = performance.now();
console.log(`精度 ${LEVELS[detail].label}，生成用时 ${((t1 - t0) / 1000).toFixed(2)} 秒`);
for (const p of [...fig.parts].sort((a, b) => b.indices.length - a.indices.length)) {
  console.log(`  ${p.name.padEnd(9)} ${fmt(p.indices.length / 3).padStart(11)} 三角面  ${fmt(p.positions.length / 3).padStart(11)} 顶点`);
}
console.log(`  ${'合计'.padEnd(8)} ${fmt(fig.triangles).padStart(11)} 三角面  ${fmt(fig.vertices).padStart(11)} 顶点`);

const min = LEVELS[detail].minTriangles;
if (fig.triangles < min) {
  console.error(`三角面不足 ${fmt(min)}：${fmt(fig.triangles)}`);
  process.exit(1);
}
const bytes = exportGLB(fig.parts, MATERIALS);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
console.log(`已写出 ${out}（${(bytes.byteLength / 1048576).toFixed(1)} MB）`);
