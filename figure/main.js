// 查看器：逐步生成人物网格，用 three.js 渲染。
// 默认「二次元」风格：赛璐璐两阶着色（每种材质有自己的阴影色）、背面外扩描边、平涂的眼睛；
// 也可以切换到「写实」PBR。提供视角切换、线框、自动旋转与 GLB 导出。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Model } from './model/core.js';
import { buildSteps, finishModel, MATERIALS, STEPS, LEVELS } from './model/index.js';
import { exportGLB } from './model/gltf.js';

const params = new URLSearchParams(location.search);
const SHOT = params.has('shot');
const ONLY = params.get('parts') ? params.get('parts').split(',') : null;

const $ = (s) => document.querySelector(s);
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: SHOT });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, SHOT ? 1 : 2));
renderer.shadowMap.enabled = true;
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.42;

const camera = new THREE.PerspectiveCamera(28, 1, 0.02, 60);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.18;
controls.maxDistance = 8;
controls.target.set(0, 0.84, 0);

// ---------- 灯光 ----------
const key = new THREE.DirectionalLight(0xffffff, 2.3);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -0.7, right: 0.7, top: 1.9, bottom: -0.3, near: 0.5, far: 8 });
key.shadow.bias = -0.0002;
key.shadow.normalBias = 0.012;
scene.add(key);
scene.add(key.target);
const rim = new THREE.DirectionalLight(0xdfe6ff, 1.5);
rim.position.set(-1.8, 2.2, -2.4);
scene.add(rim);
const fill = new THREE.HemisphereLight(0xfff6f2, 0xd8c9c4, 0.55);
scene.add(fill);

const groundMat = new THREE.ShadowMaterial({ opacity: 0.22, color: 0x4a3540 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(3, 64), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// 预设视角：要框住的竖直范围 [y0, y1]、需要的宽度、水平方位角与俯视角。
// 实际距离按画布比例与铭牌、操作条占去的空间计算，保证人物落在空出来的区域里。
const VIEWS = {
  full: { y0: -0.02, y1: 1.63, w: 0.72, yaw: 0.29, pitch: 0.07 },
  upper: { y0: 0.98, y1: 1.62, w: 0.5, yaw: 0.3, pitch: 0.05 },
  face: { y0: 1.33, y1: 1.6, w: 0.26, yaw: 0.2, pitch: 0.02 },
  side: { y0: -0.02, y1: 1.63, w: 0.6, yaw: Math.PI / 2 - 0.08, pitch: 0.05 },
  back: { y0: -0.02, y1: 1.63, w: 0.72, yaw: Math.PI + 0.29, pitch: 0.08 },
};
let currentView = 'full';
let userMoved = false;
function setView(name) {
  const v = VIEWS[name] || VIEWS.full;
  currentView = name;
  userMoved = false;
  const h = canvas.clientHeight || 800, w = canvas.clientWidth || 600;
  const dock = document.querySelector('.dock');
  const plate = document.querySelector('.plate');
  // 窄屏时铭牌在人物上方，需要让出来；宽屏时铭牌在左侧，不挡人物
  let top = 16, bottom = 16;
  if (plate && w < 760) top = plate.getBoundingClientRect().bottom + 6;
  if (dock) bottom = h - dock.getBoundingClientRect().top + 8;
  const usable = Math.max(0.3, (h - top - bottom) / h);
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const H = (v.y1 - v.y0) * 1.04;
  const d = Math.max(H / usable / (2 * t), v.w / (2 * t * (w / h)));
  // 让人物中心落在可用区域的中心
  const visH = 2 * d * t;
  const ndc = 1 - (2 * (top + (h - top - bottom) / 2)) / h;
  const cy = (v.y0 + v.y1) / 2 - (ndc * visH) / 2;
  controls.target.set(0, cy, 0);
  camera.position.set(Math.sin(v.yaw) * d * Math.cos(v.pitch), cy + d * Math.sin(v.pitch), Math.cos(v.yaw) * d * Math.cos(v.pitch));
  controls.update();
}
controls.addEventListener('start', () => (userMoved = true));

// ---------- 写实材质 ----------
function pbrMaterial(name) {
  const p = MATERIALS[name] || {};
  const useP = p.sheen || p.clearcoat || p.specularIntensity !== undefined;
  const m = useP ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();
  m.vertexColors = true;
  m.roughness = p.roughness ?? 0.7;
  m.metalness = p.metalness ?? 0;
  if (p.sheen) {
    m.sheen = p.sheen;
    m.sheenColor = new THREE.Color(p.sheenColor);
    m.sheenRoughness = 0.6;
  }
  if (p.specularIntensity !== undefined) m.specularIntensity = p.specularIntensity;
  if (p.clearcoat) {
    m.clearcoat = p.clearcoat;
    m.clearcoatRoughness = 0.25;
  }
  decorate(name, m);
  if (name === 'tights') {
    // 半透明黑丝袜的观感：正对视线处透出一点肤色，掠射角处更黑
    m.customProgramCacheKey = () => 'pbr-tights';
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float ndv = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.33, 0.28), 0.2 * pow(ndv, 2.2));
        }`,
      );
    };
  }
  return m;
}
function decorate(name, m) {
  if (name === 'eye' || name === 'lash') {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -2;
  }
  if (name === 'cloth' || name === 'ribbon') m.side = THREE.DoubleSide;
}

// ---------- 二次元材质 ----------
// shade：阴影色（与顶点色相乘）；rim：轮廓光强度；outline：[描边颜色, 与顶点色的混合比例, 像素宽度]
const TOON = {
  skin: { shade: '#f2b9ad', rim: 0.16, rimColor: '#fff3ec', outline: ['#8a5048', 0.75, 1.5], th: -0.3 },
  cloth: { shade: '#bfc4e6', rim: 0.12, rimColor: '#ffffff', outline: ['#262c4c', 0.55, 1.6] },
  ribbon: { shade: '#c5798f', rim: 0.18, rimColor: '#ffd6dc', outline: ['#5c0f22', 0.6, 1.4] },
  hair: { shade: '#5d5d6c', rim: 0.3, rimColor: '#b9bccb', outline: ['#0b0b10', 0.8, 1.2] },
  hairfine: { shade: '#5d5d6c', rim: 0.28, rimColor: '#b9bccb' },
  tights: { shade: '#8a87a2', rim: 0.35, rimColor: '#9aa2cc', outline: ['#0c0c12', 0.85, 1.4] },
  leather: { shade: '#9c6e6a', rim: 0.25, rimColor: '#ffd8c0', outline: ['#21110b', 0.7, 1.4] },
};
const KEY_TOON = 2.0;

function toonMaterial(name) {
  if (name === 'eye' || name === 'lash') {
    const m = new THREE.MeshBasicMaterial({ vertexColors: true });
    decorate(name, m);
    return m;
  }
  const t = TOON[name] || TOON.cloth;
  const m = new THREE.MeshToonMaterial({ vertexColors: true });
  decorate(name, m);
  const uniforms = {
    uShade: { value: new THREE.Color(t.shade) },
    uRim: { value: t.rim },
    uRimColor: { value: new THREE.Color(t.rimColor) },
    uKeyLevel: { value: KEY_TOON / Math.PI },
    uTh: { value: t.th ?? 0.04 },
  };
  m.customProgramCacheKey = () => 'toon-' + name;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <gradientmap_pars_fragment>',
        `uniform vec3 uShade;
        uniform float uRim;
        uniform vec3 uRimColor;
        uniform float uKeyLevel;
        uniform float uTh;
        // 明暗交界：边缘只有一两个像素的过渡；皮肤的阈值更低，脸上不出现大块阴影
        vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
          float d = dot( normal, lightDirection );
          float fw = max( fwidth( d ), 1e-4 );
          return vec3( smoothstep( uTh - fw, uTh + fw, d ) );
        }`,
      )
      .replace(
        'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
        `// 由主光的漫反射反推「是否受光」（已含投影），再在固有色与阴影色之间二选一
        float lumD = dot( reflectedLight.directDiffuse, vec3( 0.299, 0.587, 0.114 ) );
        float lumB = max( dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ), 1e-4 );
        float lit = clamp( lumD / lumB / uKeyLevel, 0.0, 1.0 );
        vec3 col = diffuseColor.rgb * mix( uShade, vec3( 1.0 ), lit );
        float ndv = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
        float rimF = smoothstep( 0.68, 0.86, 1.0 - ndv ) * uRim;
        col += rimF * uRimColor * ( 0.35 + 0.65 * lit );
        vec3 outgoingLight = col + totalEmissiveRadiance;`,
      );
  };
  return m;
}

// 背面外扩描边：沿法线把背面推出去，宽度按与相机的距离缩放，在屏幕上保持约 N 像素
const outlineMats = [];
function outlineMaterial(color, mixAmt, px) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uWidth: { value: 0.001 }, uColor: { value: new THREE.Color(color) }, uMix: { value: mixAmt } },
    vertexColors: true,
    side: THREE.BackSide,
    vertexShader: `
      #include <common>
      #include <color_pars_vertex>
      uniform float uWidth;
      void main() {
        #include <color_vertex>
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        vec3 n = normalize( normalMatrix * normal );
        mv.xyz += n * uWidth * max( 0.25, -mv.z );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      #include <common>
      #include <color_pars_fragment>
      uniform vec3 uColor;
      uniform float uMix;
      void main() {
        gl_FragColor = vec4( mix( vColor * 0.32, uColor, uMix ), 1.0 );
        #include <colorspace_fragment>
      }`,
  });
  m.userData.px = px;
  outlineMats.push(m);
  return m;
}
function updateOutlineWidth() {
  const h = canvas.clientHeight || 800;
  const perPx = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / h;
  for (const m of outlineMats) m.uniforms.uWidth.value = perPx * m.userData.px;
}

// ---------- 网格 ----------
const group = new THREE.Group();
scene.add(group);
const meshes = [];
const outlines = [];
let stats = null;
let detail = params.get('detail') === 'ultra' ? 'ultra' : 'standard';
let currentOut = null;
let building = false;
let style = params.get('style') === 'pbr' ? 'pbr' : 'toon';
let showOutline = true;
let wire = false;

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  updateOutlineWidth();
  if (!userMoved && stats) setView(currentView);
}
window.addEventListener('resize', resize);

function applyStyle() {
  const toon = style === 'toon';
  document.body.classList.toggle('toon', toon);
  renderer.toneMapping = toon ? THREE.NoToneMapping : THREE.NeutralToneMapping;
  renderer.shadowMap.type = toon ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.shadowMap.needsUpdate = true;
  rim.visible = !toon;
  fill.visible = !toon;
  key.color.set(toon ? 0xffffff : 0xfff1e4);
  key.intensity = toon ? KEY_TOON : 2.3;
  key.position.set(...(toon ? [1.1, 2.7, 3.0] : [1.6, 3.0, 2.4]));
  groundMat.opacity = toon ? 0.16 : 0.22;
  groundMat.color.set(toon ? 0x5a5a8a : 0x4a3540);
  for (const m of meshes) {
    m.material = toon ? m.userData.toon : m.userData.pbr;
    m.material.wireframe = wire;
  }
  for (const o of outlines) o.visible = toon && showOutline && !wire;
  document.querySelectorAll('[data-style]').forEach((b) => b.classList.toggle('on', b.dataset.style === style));
}

// 释放当前模型（切换精度时重建）
function clearModel() {
  for (const m of meshes) {
    m.geometry.dispose();
    m.userData.pbr.dispose();
    m.userData.toon.dispose();
    group.remove(m);
  }
  for (const o of outlines) {
    o.material.dispose();
    group.remove(o);
  }
  meshes.length = 0;
  outlines.length = 0;
  outlineMats.length = 0;
  currentOut = null;
}

async function build() {
  const model = new Model();
  const it = buildSteps(model, { detail });
  const total = STEPS.length - (detail === 'ultra' ? 0 : 4);
  const t0 = performance.now();
  const bar = $('#progress');
  const label = $('#progress-label');
  let i = 0;
  for (;;) {
    const r = it.next();
    if (r.done) break;
    if (label) label.textContent = r.value + '…';
    if (bar) bar.style.width = `${Math.min(96, (++i / total) * 100)}%`;
    await new Promise((res) => setTimeout(res, 0));
  }
  const out = finishModel(model);
  const ms = performance.now() - t0;
  for (const p of out.parts) {
    if (ONLY && !ONLY.includes(p.name)) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(p.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(p.colors, 3));
    g.setIndex(new THREE.BufferAttribute(p.indices, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g);
    mesh.name = p.name;
    mesh.userData.pbr = pbrMaterial(p.name);
    mesh.userData.toon = toonMaterial(p.name);
    // 细发丝数量巨大，不参与投影（对画面几乎没有影响，却能省下一整遍几何）
    mesh.castShadow = p.name !== 'eye' && p.name !== 'lash' && p.name !== 'hairfine';
    // 发丝在脸上的投影在阴影贴图分辨率下会成为脏污的条纹，皮肤不接收阴影
    mesh.receiveShadow = p.name !== 'skin' && p.name !== 'eye' && p.name !== 'lash';
    group.add(mesh);
    meshes.push(mesh);
    const t = TOON[p.name];
    if (t && t.outline) {
      const o = new THREE.Mesh(g, outlineMaterial(...t.outline));
      o.name = p.name + '-outline';
      group.add(o);
      outlines.push(o);
    }
  }
  updateOutlineWidth();
  stats = { triangles: out.triangles, vertices: out.vertices, parts: out.parts.length, ms, detail };
  currentOut = out;
  window.__figure = { stats, parts: out.parts.map((p) => ({ name: p.name, triangles: p.indices.length / 3 })) };
  return out;
}

const fmt = (n) => n.toLocaleString('en-US');

const PART_NAMES = {
  hair: '发束',
  hairfine: '细发丝',
  cloth: '水手服与百褶裙',
  skin: '皮肤（脸、颈、手）',
  leather: '乐福鞋',
  tights: '裤袜',
  lash: '眼线、眉毛、头皮',
  ribbon: '领结',
  eye: '眼睛',
};
const HEAD_HEIGHT = 0.2418; // 下巴到头顶（含头部缩放）

function showStats(out) {
  if (!stats) return;
  const tri = $('#tri');
  if (tri) tri.textContent = fmt(stats.triangles);
  let top = 0;
  for (const p of out.parts) {
    const P = p.positions;
    for (let i = 1; i < P.length; i += 3) if (P[i] > top) top = P[i];
  }
  const meta = $('#meta');
  if (meta) {
    meta.innerHTML = `${LEVELS[stats.detail].label}精度 · ${fmt(stats.vertices)} 顶点 · ${stats.parts} 种材质 · 生成用时 ${(stats.ms / 1000).toFixed(1)} 秒<br>身高 ${(top * 100).toFixed(1)} cm（含发顶） · 约 ${(top / HEAD_HEIGHT).toFixed(1)} 头身`;
  }
  const table = $('#parts-table');
  if (table) {
    const rows = out.parts.map((p) => [p.name, p.indices.length / 3]).sort((a, b) => b[1] - a[1]);
    const max = rows[0][1];
    table.innerHTML = rows
      .map(([n, t]) => `<tr><td>${PART_NAMES[n] || n}</td><td><span class="bar" style="width:${Math.max(2, Math.round((t / max) * 60))}px"></span></td><td>${fmt(t)}</td></tr>`)
      .join('');
  }
}

let autoRotate = false;
// 切换精度：显示加载层，释放旧模型，按新档位重新生成
async function setDetailLevel(next) {
  if (building || next === detail) return;
  building = true;
  detail = next;
  document.querySelectorAll('[data-detail]').forEach((b) => b.classList.toggle('on', b.dataset.detail === detail));
  document.body.classList.remove('ready');
  const label = $('#progress-label');
  const bar = $('#progress');
  if (bar) bar.style.width = '0%';
  if (label) label.textContent = detail === 'ultra' ? '准备生成 2000 万面（需要十几秒，约占 1.5 GB 内存）…' : '准备中…';
  await new Promise((r) => setTimeout(r, 60));
  clearModel();
  try {
    const out = await build();
    applyStyle();
    showStats(out);
  } catch (e) {
    console.error(e);
    if (label) label.textContent = '生成失败：' + (e && e.message ? e.message : e);
    building = false;
    return;
  }
  document.body.classList.add('ready');
  building = false;
}

function bindUI() {
  document.querySelectorAll('[data-detail]').forEach((b) => {
    b.classList.toggle('on', b.dataset.detail === detail);
    b.addEventListener('click', () => setDetailLevel(b.dataset.detail));
  });
  document.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      setView(b.dataset.view);
      document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', x === b));
    }),
  );
  document.querySelectorAll('[data-style]').forEach((b) =>
    b.addEventListener('click', () => {
      style = b.dataset.style;
      applyStyle();
    }),
  );
  const toggle = (el, on) => {
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', String(on));
  };
  const ol = $('#outline');
  ol?.addEventListener('click', () => {
    showOutline = !showOutline;
    toggle(ol, showOutline);
    applyStyle();
  });
  const wb = $('#wire');
  wb?.addEventListener('click', () => {
    wire = !wire;
    toggle(wb, wire);
    applyStyle();
  });
  const rot = $('#rotate');
  rot?.addEventListener('click', () => {
    autoRotate = !autoRotate;
    toggle(rot, autoRotate);
  });
  const exp = $('#export');
  exp?.addEventListener('click', () => {
    exp.disabled = true;
    exp.textContent = '正在打包…';
    setTimeout(() => {
      try {
        const bytes = exportGLB(currentOut.parts, MATERIALS);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'kurokami-schoolgirl.glb';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        exp.textContent = `已导出（${(bytes.byteLength / 1048576).toFixed(0)} MB）`;
      } catch (e) {
        console.error(e);
        exp.textContent = '导出失败';
      }
      setTimeout(() => {
        exp.disabled = false;
        exp.textContent = '导出 GLB';
      }, 3000);
    }, 30);
  });
}

function loop() {
  requestAnimationFrame(loop);
  if (autoRotate) group.rotation.y += 0.004;
  controls.update();
  renderer.render(scene, camera);
}

async function main() {
  resize();
  setView(params.get('view') || 'full');
  applyStyle();
  const out = await build();
  applyStyle();
  showStats(out);
  setView(params.get('view') || 'full');
  document.body.classList.add('ready');
  bindUI();
  if (SHOT) {
    window.__shot = (view, opts = {}) => {
      if (typeof view === 'string') setView(view);
      else if (view) {
        userMoved = true;
        camera.position.set(...view.pos);
        controls.target.set(...view.target);
        controls.update();
      }
      if (opts.style) {
        style = opts.style;
        applyStyle();
      }
      resize();
      renderer.render(scene, camera);
      return canvas.toDataURL('image/png');
    };
    window.__ready = true;
    return;
  }
  loop();
}

main().catch((e) => {
  console.error(e);
  const l = $('#progress-label');
  if (l) l.textContent = '生成失败：' + (e && e.message ? e.message : e);
});
