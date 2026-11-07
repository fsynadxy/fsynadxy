// 在 Node 里生成人物并导出 GLB：node tools/figure-export.mjs [输出路径]
// 同时打印各部件三角面数，并检查总面数是否达到 200 万。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildFigure, MATERIALS } from '../figure/model/index.js';
import { exportGLB } from '../figure/model/gltf.js';

const out = resolve(process.argv[2] || 'dist-figure/kurokami-schoolgirl.glb');
const t0 = performance.now();
const fig = buildFigure();
const t1 = performance.now();
const fmt = (n) => n.toLocaleString('en-US');

console.log(`生成用时 ${((t1 - t0) / 1000).toFixed(2)} 秒`);
for (const p of [...fig.parts].sort((a, b) => b.indices.length - a.indices.length)) {
  console.log(`  ${p.name.padEnd(9)} ${fmt(p.indices.length / 3).padStart(10)} 三角面  ${fmt(p.positions.length / 3).padStart(10)} 顶点`);
}
console.log(`  ${'合计'.padEnd(8)} ${fmt(fig.triangles).padStart(10)} 三角面  ${fmt(fig.vertices).padStart(10)} 顶点`);

const bytes = exportGLB(fig.parts, MATERIALS);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
console.log(`已写出 ${out}（${(bytes.byteLength / 1048576).toFixed(1)} MB）`);

if (fig.triangles < 2_000_000) {
  console.error(`三角面不足 200 万：${fmt(fig.triangles)}`);
  process.exit(1);
}
