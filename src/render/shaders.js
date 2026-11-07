import * as THREE from 'three';

// 全局共享 uniform：时间、太阳、风、雾、夜晚程度……所有材质引用同一对象，每帧只需更新一次
export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
  uDay: { value: 1 }, // 太阳光强系数 0..1
  uNight: { value: 0 }, // 灯火亮起程度 0..1
  uWind: { value: new THREE.Vector2(0.8, 0.35) },
  uGust: { value: 0 },
  uFogColor: { value: new THREE.Color('#dfe6ea') },
  uFogSunColor: { value: new THREE.Color('#f6d7b8') },
  uFogDensity: { value: 0.0021 },
  uFogBase: { value: 0 },
  uSkyZenith: { value: new THREE.Color('#6fa0dc') },
  uSkyHorizon: { value: new THREE.Color('#dbe8ef') },
  uHemiSky: { value: new THREE.Color('#9fb8d8') },
  uHemiGround: { value: new THREE.Color('#8a8a5a') },
  uLanternColor: { value: new THREE.Color('#ffb36b') },
  uFinale: { value: 0 }, // 集齐御朱印后千年桜点灯
  // 云（由 DayNight 每帧更新，天空与水面倒影共用）
  uCloudLit: { value: new THREE.Color(1, 1, 1) },
  uCloudShade: { value: new THREE.Color(0.7, 0.75, 0.85) },
  uCloudCover: { value: 0.55 },
  // 太阳阴影贴图（第一次渲染后由 Game 填入），供草、花瓣、水面等自写着色器采样
  uShadowMap: { value: null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowOn: { value: 0 },
};
// 雾专用别名（避免与其它补丁里的 uSunDir 重复声明）
U.uFogSun = U.uSunDir;

// ---------- 通用 GLSL ----------
export const GLSL_COMMON = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1.0,0.0)), u.x), mix(hash12(i+vec2(0.0,1.0)), hash12(i+vec2(1.0,1.0)), u.x), u.y);
}
float fbmN(vec2 p){ float s = 0.0, a = 0.5; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
`;
// 手动采样太阳阴影（单点，供顶点着色器或简单片元使用）：1 = 受光，0 = 阴影
export const SHADOW_GLSL = /* glsl */ `
#include <packing>
uniform sampler2D uShadowMap; uniform mat4 uShadowMatrix; uniform float uShadowOn;
float sunShadow(vec3 wp, float bias){
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uShadowMatrix * vec4(wp, 1.0);
  vec3 c = sc.xyz / sc.w;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  float d = unpackRGBAToDepth(texture2D(uShadowMap, c.xy));
  return step(c.z - bias, d);
}
`;
export function shadowUniforms() {
  return { uShadowMap: U.uShadowMap, uShadowMatrix: U.uShadowMatrix, uShadowOn: U.uShadowOn };
}
// fragment-only helpers (derivatives)
export const GLSL_FRAG = /* glsl */ `
// anti-aliased grid line: x in cell units, w = half width in cell units
float gridLine(float x, float w){
  float fw = fwidth(x);
  float d = abs(fract(x + 0.5) - 0.5);
  float l = 1.0 - smoothstep(w - fw, w + fw, d);
  return mix(l, 2.0 * w, smoothstep(0.08, 0.45, fw));
}
`;

// ---------- 自定义大气雾（朝向太阳一侧偏暖、低处更浓） ----------
THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorld;
#endif
`;
THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vec4 fogWP = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    fogWP = batchingMatrix * fogWP;
  #endif
  #ifdef USE_INSTANCING
    fogWP = instanceMatrix * fogWP;
  #endif
  vFogWorld = ( modelMatrix * fogWP ).xyz;
#endif
`;
THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorld;
  uniform vec3 uFogColor;
  uniform vec3 uFogSunColor;
  uniform float uFogDensity;
  uniform float uFogBase;
  uniform vec3 uFogSun;
  vec3 applyFog(vec3 col, vec3 wp){
    vec3 v = wp - cameraPosition;
    float dist = length(v);
    vec3 dir = v / max(dist, 1e-3);
    float hgt = max(wp.y - uFogBase, 0.0);
    float hf = mix(0.45, 1.0, exp(-hgt * 0.018));
    float amt = 1.0 - exp(-pow(dist * uFogDensity, 1.3) * hf);
    float sunAmt = pow(max(dot(dir, uFogSun), 0.0), 5.0);
    return mix(col, mix(uFogColor, uFogSunColor, sunAmt), amt);
  }
#endif
`;
THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = applyFog( gl_FragColor.rgb, vFogWorld );
#endif
`;

const FOG_UNIFORMS = ['uFogColor', 'uFogSunColor', 'uFogDensity', 'uFogBase', 'uFogSun'];

export function addUniforms(shader, names) {
  for (const n of names) shader.uniforms[n] = U[n];
}

let patchCounter = 0;
// 给内置材质打补丁：注入共享 uniform 与自定义代码
// opts: { key, uniforms:[names], vertexHead, vertexBegin(after begin_vertex), vertexEnd(after project_vertex), fragmentHead, fragmentColor(after color_fragment), fragmentEmissive(after emissivemap_fragment), fragmentNormal(replace normal_fragment_begin), fragmentRoughness, fragmentEnd }
export function patchMaterial(mat, opts = {}) {
  const key = opts.key || 'patch' + patchCounter++;
  mat.onBeforeCompile = (shader) => {
    addUniforms(shader, FOG_UNIFORMS);
    if (opts.uniforms) addUniforms(shader, opts.uniforms);
    if (opts.extraUniforms) Object.assign(shader.uniforms, opts.extraUniforms);
    let vs = shader.vertexShader;
    let fs = shader.fragmentShader;
    vs = vs.replace('#include <common>', '#include <common>\n' + GLSL_COMMON + (opts.vertexHead || ''));
    if (opts.vertexBegin) vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + opts.vertexBegin);
    if (opts.vertexNormal) vs = vs.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + opts.vertexNormal);
    if (opts.vertexEnd) vs = vs.replace('#include <project_vertex>', '#include <project_vertex>\n' + opts.vertexEnd);
    fs = fs.replace('#include <common>', '#include <common>\n' + GLSL_COMMON + GLSL_FRAG + (opts.fragmentHead || ''));
    if (opts.fragmentColor) fs = fs.replace('#include <color_fragment>', '#include <color_fragment>\n' + opts.fragmentColor);
    if (opts.fragmentRoughness) fs = fs.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + opts.fragmentRoughness);
    if (opts.fragmentNormal) fs = fs.replace('#include <normal_fragment_begin>', opts.fragmentNormal);
    if (opts.fragmentEmissive) fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + opts.fragmentEmissive);
    if (opts.fragmentEnd) fs = fs.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + opts.fragmentEnd);
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
    if (opts.onShader) opts.onShader(shader);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

// 不翻转背面法线的 normal_fragment_begin（用于树冠卡片：球形法线让树冠像一团柔软的云）
export const NORMAL_NO_FLIP = THREE.ShaderChunk.normal_fragment_begin.replace(
  /#ifdef DOUBLE_SIDED\s*normal \*= faceDirection;\s*#endif/,
  ''
);

// 计算世界坐标（兼容实例化）的顶点片段
export const WORLD_POS_VERTEX = /* glsl */ `
  vec4 wpX = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    wpX = instanceMatrix * wpX;
  #endif
  vWPos = ( modelMatrix * wpX ).xyz;
`;
