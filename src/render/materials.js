import * as THREE from 'three';
import { patchMaterial, WORLD_POS_VERTEX, NORMAL_NO_FLIP } from './shaders.js';

// 图案编号（写入顶点属性 aPat.z），由一个着色器程序化绘制
export const PAT = {
  NONE: 0,
  KAWARA: 1, // 瓦屋顶
  PLANK: 2, // 横向木板
  SHOJI: 3, // 障子（夜里透出暖光）
  KOSHI: 4, // 格子窗（町屋的竖向木格）
  STONE: 5, // 石板路
  BLOCK: 6, // 砖块围墙
  WINDOW: 7, // 玻璃窗（uv 0..1）
  THATCH: 8, // 茅草顶
  ASPHALT: 9,
  GRAVEL: 10,
  BARK: 11, // 樱树皮（横向皮孔）
  BAMBOO: 12,
  PLASTER: 13, // 灰泥墙
  LANTERN: 14, // 纸灯笼
  VENDING: 15, // 自动售货机
  TIN: 17, // 波纹铁皮
};

const PATTERN_GLSL = /* glsl */ `
varying vec4 vPat;
varying vec3 vWPos;
uniform float uNight;
uniform float uTime;
uniform vec3 uLanternColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform float uFinale;

// all colors are linear
vec3 applyPattern(vec3 col, inout float emis, inout vec3 emisCol, inout float rough){
  int id = int(vPat.z + 0.5);
  vec2 uv = vPat.xy;
  if (id == 1) {
    float tx = uv.x / 0.30;
    float ridge = 0.5 + 0.5 * cos(6.2832 * tx);
    ridge = mix(ridge, 0.5, smoothstep(0.15, 0.5, fwidth(tx)));
    float row = gridLine(uv.y / 0.33, 0.07);
    float v = hash12(floor(vec2(tx, uv.y / 0.33)));
    col *= (0.70 + 0.40 * ridge) * (1.0 - 0.30 * row) * (0.93 + 0.14 * v);
    rough = 0.5;
  } else if (id == 2) {
    float py = uv.y / 0.21;
    float l = gridLine(py, 0.05);
    float bv = hash12(vec2(floor(py), floor(uv.x / 2.3 + floor(py) * 0.37)));
    float grain = vnoise(vec2(uv.x * 1.3, py * 7.0));
    col *= (0.84 + 0.2 * bv) * (0.9 + 0.14 * grain) * (1.0 - 0.38 * l);
  } else if (id == 3) {
    float g = max(gridLine(uv.x / 0.30, 0.05), gridLine(uv.y / 0.24, 0.055));
    col = mix(col, vec3(0.09, 0.05, 0.025), g);
    emis *= (1.0 - g * 0.95);
    emisCol = uLanternColor * 1.25;
  } else if (id == 4) {
    float s = gridLine(uv.x / 0.075, 0.27);
    col = mix(col * 0.18, col, s);
    emis *= (1.0 - s);
    emisCol = uLanternColor * 1.4;
  } else if (id == 5) {
    vec2 p = uv / vec2(0.62, 0.42);
    p.x += floor(p.y) * 0.5;
    float h = hash12(floor(p));
    float jn = max(gridLine(p.x, 0.035), gridLine(p.y, 0.05));
    col *= (0.82 + 0.3 * h) * (1.0 - 0.42 * jn) * (0.93 + 0.12 * vnoise(uv * 3.0));
  } else if (id == 6) {
    vec2 p = uv / vec2(0.40, 0.20);
    p.x += floor(p.y) * 0.5;
    float jn = max(gridLine(p.x, 0.025), gridLine(p.y, 0.05));
    col *= (1.0 - 0.28 * jn) * (0.93 + 0.1 * hash12(floor(p))) * (0.9 + 0.12 * vnoise(uv * 1.3));
  } else if (id == 7) {
    vec2 q = uv;
    float fw = 0.07;
    float inside = step(fw, q.x) * step(q.x, 1.0 - fw) * step(fw, q.y) * step(q.y, 1.0 - fw);
    float mull = 1.0 - smoothstep(0.015, 0.03, abs(q.x - 0.5));
    float f = max(1.0 - inside, mull);
    vec3 glass = mix(uSkyHorizon * 0.42, uSkyZenith * 0.5, clamp(q.y * 1.2, 0.0, 1.0)) + vec3(0.012);
    // diagonal glint
    float streak = smoothstep(0.08, 0.0, abs(fract(q.x * 0.7 + q.y * 0.5 + 0.2) - 0.5) - 0.32);
    glass += streak * 0.05 * (1.0 - uNight);
    // curtains
    float cur = step(0.55, hash12(floor(vWPos.xz * 0.37) + floor(vWPos.y * 0.33)));
    vec3 curtain = mix(vec3(0.75, 0.62, 0.45), vec3(0.55, 0.65, 0.6), hash12(floor(vWPos.xz)));
    glass = mix(glass, glass * 0.6 + curtain * 0.18, cur * smoothstep(0.6, 0.62, abs(q.x - 0.5) * 2.0));
    col = mix(glass, col, f);
    emis *= (1.0 - f);
    emisCol = uLanternColor * mix(0.9, 1.3, cur);
    rough = mix(0.15, rough, f);
  } else if (id == 8) {
    float n = vnoise(vec2(uv.x * 20.0, uv.y * 2.2)) * 0.6 + vnoise(vec2(uv.x * 55.0, uv.y * 5.0)) * 0.4;
    col *= 0.7 + 0.55 * n;
  } else if (id == 9) {
    col *= 0.9 + 0.14 * vnoise(uv * 5.0) + 0.05 * vnoise(uv * 31.0);
  } else if (id == 10) {
    col *= 0.84 + 0.26 * vnoise(uv * 3.5) + 0.12 * (vnoise(uv * 23.0) - 0.5);
  } else if (id == 11) {
    float l = gridLine(uv.y / 0.09, 0.14) * step(0.45, vnoise(vec2(uv.x * 4.0, uv.y * 9.0)));
    float n = vnoise(vec2(uv.x * 5.0, uv.y * 1.4));
    col *= (0.82 + 0.3 * n) * (1.0 - 0.3 * l);
  } else if (id == 12) {
    float node = gridLine(uv.y / 0.42, 0.045);
    float band = fract(uv.y / 0.42);
    col *= (0.88 + 0.18 * band) * (1.0 - 0.4 * node);
    rough = 0.55;
  } else if (id == 13) {
    col *= 0.94 + 0.08 * vnoise(uv * 1.6) + 0.04 * vnoise(uv * 8.0);
    col *= mix(0.86, 1.0, smoothstep(0.0, 0.6, uv.y));
  } else if (id == 14) {
    float rib = gridLine(uv.y * 8.0, 0.09);
    col *= 1.0 - 0.28 * rib;
    emisCol = col * 2.4 + vec3(0.2, 0.08, 0.01);
    emis *= 1.0 - 0.55 * rib;
  } else if (id == 15) {
    vec2 q = uv;
    if (q.y > 0.44 && q.y < 0.93 && q.x > 0.08 && q.x < 0.92) {
      vec2 g = vec2((q.x - 0.08) / 0.84 * 6.0, (q.y - 0.44) / 0.49 * 3.0);
      vec2 c = floor(g); vec2 f = fract(g);
      float can = step(0.28, f.x) * step(f.x, 0.72) * step(0.12, f.y) * step(f.y, 0.78);
      vec3 cc = 0.35 + 0.35 * cos(6.2832 * (hash12(c + floor(vWPos.xz)) + vec3(0.0, 0.33, 0.67)));
      col = mix(vec3(0.75, 0.78, 0.8), cc, can);
      emis = 0.25 + 0.75 * uNight;
      emisCol = col * 1.6;
    } else if (q.y > 0.1 && q.y < 0.22 && q.x > 0.25 && q.x < 0.75) {
      col = vec3(0.01);
    } else if (q.y > 0.3 && q.y < 0.38 && q.x > 0.15 && q.x < 0.85) {
      float b = step(0.5, fract(q.x * 10.0));
      col = mix(col, vec3(0.6, 0.05, 0.03), b * 0.8);
    }
  } else if (id == 17) {
    float r = 0.5 + 0.5 * cos(6.2832 * uv.x / 0.08);
    r = mix(r, 0.5, smoothstep(0.1, 0.5, fwidth(uv.x / 0.08)));
    col *= 0.82 + 0.26 * r;
    col = mix(col, vec3(0.28, 0.11, 0.05), smoothstep(0.62, 0.9, vnoise(uv * vec2(0.8, 2.0))) * 0.5);
    rough = 0.6;
  }
  return col;
}
`;

// 树木整体摇摆（树干与树冠共用，保证花簇跟随枝干）
const SWAY_GLSL = /* glsl */ `
uniform float uTime; uniform vec2 uWind; uniform float uGust;
vec2 treeSway(vec3 ip, float h){
  float ph = ip.x * 0.11 + ip.z * 0.07;
  float s = sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.1 + ph * 1.7) * 0.4;
  return uWind * s * (0.006 + uGust * 0.014) * h * h * 0.5;
}
`;

// 主世界材质：合批的顶点色几何体 + 程序化图案 + 夜间自发光
export function createWorldMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0 });
  patchMaterial(mat, {
    key: 'world',
    uniforms: ['uNight', 'uTime', 'uLanternColor', 'uSkyZenith', 'uSkyHorizon', 'uFinale'],
    vertexHead: 'attribute vec4 aPat;\nvarying vec4 vPat;\nvarying vec3 vWPos;\n',
    vertexEnd: 'vPat = aPat;\n' + WORLD_POS_VERTEX,
    fragmentHead: PATTERN_GLSL + '\nfloat gEmis; vec3 gEmisCol; float gRough;\n',
    fragmentColor: /* glsl */ `
      gEmis = vPat.w; gEmisCol = uLanternColor; gRough = roughness;
      diffuseColor.rgb = applyPattern(diffuseColor.rgb, gEmis, gEmisCol, gRough);
      diffuseColor.rgb *= 0.95 + 0.1 * vnoise(vWPos.xz * 2.3 + vWPos.y * 1.7);
    `,
    fragmentRoughness: 'roughnessFactor = gRough;',
    fragmentEmissive: 'totalEmissiveRadiance += gEmisCol * gEmis * (int(vPat.z + 0.5) == 15 ? 1.0 : uNight);',
  });
  return mat;
}

// 带贴图（招牌、暖帘、站名牌）的材质
export function createSignMaterial(map) {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0, vertexColors: true });
  patchMaterial(mat, {
    key: 'sign',
    uniforms: ['uNight', 'uLanternColor'],
    vertexHead: 'attribute float aGlow;\nvarying float vGlow;\n',
    vertexEnd: 'vGlow = aGlow;',
    fragmentHead: 'varying float vGlow;\nuniform float uNight;\nuniform vec3 uLanternColor;\n',
    fragmentEmissive: 'totalEmissiveRadiance += diffuseColor.rgb * vGlow * uNight * 1.2;',
  });
  return mat;
}

// 树干（实例化 + 风摆，越高摆动越大）
export function createTrunkMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  patchMaterial(mat, {
    key: 'trunk',
    uniforms: ['uNight', 'uTime', 'uLanternColor', 'uSkyZenith', 'uSkyHorizon', 'uWind', 'uGust', 'uFinale'],
    vertexHead: 'attribute vec4 aPat;\nvarying vec4 vPat;\nvarying vec3 vWPos;\n' + SWAY_GLSL,
    vertexBegin: /* glsl */ `
      {
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        transformed.xz += treeSway(ip, max(transformed.y - 1.0, 0.0));
      }
    `,
    vertexEnd: 'vPat = aPat;\n' + WORLD_POS_VERTEX,
    fragmentHead: PATTERN_GLSL + '\nfloat gEmis; vec3 gEmisCol; float gRough;\n',
    fragmentColor: /* glsl */ `
      gEmis = 0.0; gEmisCol = uLanternColor; gRough = roughness;
      diffuseColor.rgb = applyPattern(diffuseColor.rgb, gEmis, gEmisCol, gRough);
    `,
  });
  return mat;
}

// 樱花树冠：花簇贴图卡片 + 球形法线 + 逆光透光 + 夜樱上光
export function createBlossomMaterial(map, { alphaToCoverage = true } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.82,
    vertexColors: true,
    alphaToCoverage,
  });
  patchMaterial(mat, {
    key: 'blossom' + (alphaToCoverage ? 'A' : ''),
    uniforms: ['uTime', 'uWind', 'uGust', 'uSunDir', 'uSunColor', 'uDay', 'uNight', 'uLanternColor', 'uFinale', 'uHemiSky'],
    vertexHead: SWAY_GLSL + /* glsl */ `
      attribute float aLit;
      varying float vLit; varying float vLocalY; varying vec3 vWPos2;
    `,
    vertexBegin: /* glsl */ `
      {
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        transformed.xz += treeSway(ip, max(position.y - 1.0, 0.0));
        float ph = ip.x * 0.13 + ip.z * 0.09;
        float w = sin(uTime * 2.4 + ph + position.y * 0.6 + position.x * 0.4) * 0.6 + sin(uTime * 3.7 + ph * 1.7 + position.z * 0.5) * 0.4;
        float amp = (0.03 + uGust * 0.09) * smoothstep(0.5, 6.0, position.y);
        transformed.xz += uWind * w * amp;
        transformed.y += sin(uTime * 3.1 + ph + position.x) * 0.015 * (1.0 + uGust * 2.0);
      }
      vLit = aLit;
      vLocalY = position.y;
    `,
    vertexEnd: /* glsl */ `
      {
        vec4 w2 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          w2 = instanceMatrix * w2;
        #endif
        vWPos2 = (modelMatrix * w2).xyz;
      }
    `,
    fragmentHead: /* glsl */ `
      uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uDay; uniform float uNight; uniform vec3 uLanternColor; uniform float uFinale; uniform vec3 uHemiSky;
      varying float vLit; varying float vLocalY; varying vec3 vWPos2;
    `,
    fragmentColor: /* glsl */ `
      {
        // 贴近镜头的花簇做抖动淡出，避免整屏被一片花挡住
        float dc = length(vWPos2 - cameraPosition);
        float keep = smoothstep(1.0, 2.6, dc);
        if (keep < 0.999 && hash12(floor(gl_FragCoord.xy)) > keep) discard;
      }
      diffuseColor.rgb *= 0.9 + 0.2 * vnoise(vWPos2.xz * 1.7 + vWPos2.y);
    `,
    fragmentNormal: NORMAL_NO_FLIP,
    fragmentEmissive: /* glsl */ `
      {
        vec3 vd = normalize(vWPos2 - cameraPosition);
        float back = pow(clamp(dot(vd, uSunDir), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * uSunColor * back * 0.45 * uDay;
        // 花瓣的柔和透光：阴影面不发灰
        totalEmissiveRadiance += diffuseColor.rgb * (uHemiSky * 0.16 * (1.0 - 0.6 * uNight) + uSunColor * 0.08 * uDay);
        // yozakura: lanterns light the canopy from below
        float up = smoothstep(9.0, 2.0, vLocalY);
        float lit = vLit < 1.5 ? vLit : uFinale * 1.6;
        totalEmissiveRadiance += diffuseColor.rgb * uLanternColor * up * lit * uNight * 0.85;
        totalEmissiveRadiance += diffuseColor.rgb * vec3(0.10, 0.09, 0.14) * uNight * 0.28;
      }
    `,
  });
  return mat;
}

// 远山与常绿树（简单树冠，带轻微风摆）
export function createFoliageMaterial({ sway = 0.04, key = 'foliage', flat = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: flat });
  patchMaterial(mat, {
    key: key + (flat ? 'F' : ''),
    uniforms: ['uTime', 'uWind', 'uGust', 'uNight'],
    vertexHead: 'uniform float uTime; uniform vec2 uWind; uniform float uGust;\n',
    vertexBegin: /* glsl */ `
      {
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        float w = sin(uTime * 1.2 + ip.x * 0.1 + ip.z * 0.07 + position.y * 0.2);
        transformed.xz += uWind * w * ${sway.toFixed(3)} * (1.0 + uGust) * max(position.y - 1.0, 0.0);
      }
    `,
    fragmentHead: 'uniform float uNight;\n',
    fragmentEmissive: 'totalEmissiveRadiance += diffuseColor.rgb * vec3(0.05, 0.05, 0.1) * uNight;',
  });
  return mat;
}

// 发光灯笼（实例化，夜里亮起）
export function createLanternMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  patchMaterial(mat, {
    key: 'lantern',
    uniforms: ['uNight', 'uTime', 'uLanternColor'],
    vertexHead: 'varying vec3 vLP;\n',
    vertexEnd: 'vLP = position;',
    fragmentHead: 'uniform float uNight; uniform float uTime; uniform vec3 uLanternColor; varying vec3 vLP;\n',
    fragmentEmissive: /* glsl */ `
      {
        float rib = gridLine(vLP.y * 9.0, 0.1);
        float flick = 0.92 + 0.08 * sin(uTime * 7.0 + vLP.x * 40.0);
        totalEmissiveRadiance += (diffuseColor.rgb * 2.2 + uLanternColor * 0.6) * (1.0 - 0.5 * rib) * uNight * flick;
        diffuseColor.rgb *= 1.0 - 0.25 * rib;
      }
    `,
  });
  return mat;
}
