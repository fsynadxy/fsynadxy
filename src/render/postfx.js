import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// 最后一道调色：暗部偏薰衣草、高光偏暖、晕影与细微胶片颗粒；拍照模式的滤镜也在这里
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.022 },
    uSat: { value: 1.04 },
    uContrast: { value: 0.06 },
    uLift: { value: new THREE.Vector3(0.018, 0.012, 0.03) },
    uGain: { value: new THREE.Vector3(1.0, 0.99, 0.97) },
    uFilter: { value: 0 },
    uFade: { value: 0 }, // 黑场淡入淡出
    uFadeColor: { value: new THREE.Vector3(0.98, 0.96, 0.94) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uSat, uContrast, uFilter, uFade;
    uniform vec2 uRes; uniform vec3 uLift, uGain, uFadeColor;
    varying vec2 vUv;
    float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = c * uGain + uLift * (1.0 - c);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, uSat);
      c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
      if (uFilter > 0.5 && uFilter < 1.5) { // film
        c = mix(c, vec3(dot(c, vec3(0.33))), 0.18);
        c = c * vec3(1.05, 0.98, 0.88) + vec3(0.04, 0.03, 0.05);
        c = mix(c, c * c * (3.0 - 2.0 * c), 0.25);
      } else if (uFilter > 1.5 && uFilter < 2.5) { // mono
        float g = dot(c, vec3(0.3, 0.59, 0.11));
        c = vec3(g) * vec3(1.02, 1.0, 0.97);
        c = mix(c, c * c * (3.0 - 2.0 * c), 0.35);
      } else if (uFilter > 2.5 && uFilter < 3.5) { // soft pink
        c = mix(c, vec3(1.0, 0.86, 0.9), 0.12) + 0.03;
      } else if (uFilter > 3.5) { // cool
        c = c * vec3(0.86, 0.96, 1.08) + vec3(0.0, 0.01, 0.03);
      }
      vec2 d = vUv - 0.5;
      d.x *= uRes.x / uRes.y;
      float v = 1.0 - dot(d, d) * uVignette;
      c *= clamp(v, 0.0, 1.0);
      c += (h12(vUv * uRes + fract(uTime * 13.7) * 100.0) - 0.5) * uGrain;
      c = mix(c, uFadeColor, uFade);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.build();
  }
  build() {
    const { renderer, scene, camera, quality } = this;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(Math.floor(size.x * pr), Math.floor(size.y * pr), {
      type: THREE.HalfFloatType,
      samples: quality.msaa,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x, size.y);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = null;
    if (quality.bloom) {
      const scale = quality.bloomScale || 0.5;
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x * scale, size.y * scale), 0.35, 0.55, 0.82);
      this.composer.addPass(this.bloom);
    }
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.grade.uniforms.uRes.value.set(size.x * pr, size.y * pr);
  }
  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.grade.uniforms.uRes.value.set(w * pr, h * pr);
  }
  rebuild(quality) {
    this.dispose();
    this.quality = quality;
    this.build();
  }
  dispose() {
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    if (this.bloom) this.bloom.dispose();
  }
  render(dt, t) {
    this.grade.uniforms.uTime.value = t;
    this.composer.render(dt);
  }
}
