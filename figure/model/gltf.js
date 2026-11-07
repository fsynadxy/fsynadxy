// 极简 glTF 2.0 二进制（GLB）写出器：每个材质一个网格图元，带位置、法线、顶点色与 32 位索引。
// 不依赖任何库，浏览器与 Node 通用。

function hexToLinear(hex) {
  const h = parseInt(hex.replace('#', ''), 16);
  const f = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [f((h >> 16) & 255), f((h >> 8) & 255), f(h & 255)];
}

export function exportGLB(parts, materials = {}) {
  const views = [];
  const accessors = [];
  const meshes = [];
  const nodes = [];
  const mats = [];
  const chunks = [];
  let offset = 0;

  const addView = (arr, target) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      offset += pad;
    }
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    chunks.push(bytes);
    offset += bytes.byteLength;
    return views.length - 1;
  };

  for (const p of parts) {
    const n = p.positions.length / 3;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const v = p.positions[i * 3 + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
    const pos = accessors.push({ bufferView: addView(p.positions, 34962), componentType: 5126, count: n, type: 'VEC3', min, max }) - 1;
    const nor = accessors.push({ bufferView: addView(p.normals, 34962), componentType: 5126, count: n, type: 'VEC3' }) - 1;
    const col = accessors.push({ bufferView: addView(p.colors, 34962), componentType: 5126, count: n, type: 'VEC3' }) - 1;
    const idx = accessors.push({ bufferView: addView(p.indices, 34963), componentType: 5125, count: p.indices.length, type: 'SCALAR' }) - 1;
    const m = materials[p.name] || {};
    const mat = {
      name: p.name,
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: m.metalness ?? 0, roughnessFactor: m.roughness ?? 0.7 },
    };
    const ext = {};
    if (m.sheen) {
      ext.KHR_materials_sheen = { sheenColorFactor: hexToLinear(m.sheenColor || '#ffffff').map((c) => c * m.sheen), sheenRoughnessFactor: 0.6 };
    }
    if (m.clearcoat) ext.KHR_materials_clearcoat = { clearcoatFactor: m.clearcoat, clearcoatRoughnessFactor: 0.25 };
    if (Object.keys(ext).length) mat.extensions = ext;
    if (p.name === 'cloth' || p.name === 'ribbon') mat.doubleSided = true;
    mats.push(mat);
    meshes.push({ name: p.name, primitives: [{ attributes: { POSITION: pos, NORMAL: nor, COLOR_0: col }, indices: idx, material: mats.length - 1 }] });
    nodes.push({ name: p.name, mesh: meshes.length - 1 });
  }

  const used = new Set();
  for (const m of mats) for (const k of Object.keys(m.extensions || {})) used.add(k);
  const json = {
    asset: { version: '2.0', generator: 'kurokami-figure (procedural)' },
    scene: 0,
    scenes: [{ name: 'figure', nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials: mats,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };
  if (used.size) json.extensionsUsed = [...used];

  const enc = new TextEncoder();
  let jsonBytes = enc.encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4;
  if (jpad) {
    const b = new Uint8Array(jsonBytes.length + jpad);
    b.set(jsonBytes);
    b.fill(0x20, jsonBytes.length);
    jsonBytes = b;
  }
  const binPad = (4 - (offset % 4)) % 4;
  const binLen = offset + binPad;
  const total = 12 + 8 + jsonBytes.length + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonBytes, 20);
  let o = 20 + jsonBytes.length;
  dv.setUint32(o, binLen, true);
  dv.setUint32(o + 4, 0x004e4942, true); // 'BIN\0'
  o += 8;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}
