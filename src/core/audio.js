// 程序化声音：风、河、鸟鸣（黄莺/麻雀/乌鸦/蛙）、筝与尺八的生成式音乐、脚步与各种音效
// 全部由 Web Audio 实时合成，不依赖任何音频文件
import { settings } from './settings.js';

const YO = [0, 2, 5, 7, 9]; // 阳音阶
const IN = [0, 1, 5, 7, 8]; // 都节音阶（平调子）

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.ksCache = new Map();
    this.musicOn = true;
  }
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.ratio.value = 3;
    this.master.connect(this.comp).connect(ctx.destination);
    this.music = ctx.createGain();
    this.amb = ctx.createGain();
    this.sfx = ctx.createGain();
    this.music.connect(this.master);
    this.amb.connect(this.master);
    this.sfx.connect(this.master);
    // 混响（合成脉冲响应）
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2, 2.4);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.38;
    this.reverb.connect(this.reverbGain).connect(this.master);
    this.white = this.makeNoise('white');
    this.pink = this.makeNoise('pink');
    this.brown = this.makeNoise('brown');
    this.applyVolume();
    this.startAmbience();
    this.ready = true;
    this.nextNote = ctx.currentTime + 1.5;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 200);
  }
  applyVolume() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.volume, t, 0.1);
    this.music.gain.setTargetAtTime(this.musicOn ? settings.music * 0.55 : 0, t, 0.3);
    this.amb.gain.setTargetAtTime(0.9, t, 0.1);
    this.sfx.gain.setTargetAtTime(0.9, t, 0.1);
  }
  makeImpulse(dur, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  makeNoise(kind) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }
  loop(buf, dest) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopStart = Math.random();
    s.connect(dest);
    s.start(0, Math.random() * 2);
    return s;
  }
  // ---------- 环境音 ----------
  startAmbience() {
    const ctx = this.ctx;
    // 风
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.loop(this.pink, this.windFilter);
    this.windFilter.connect(this.windGain).connect(this.amb);
    // 河水
    this.riverGain = ctx.createGain();
    this.riverGain.gain.value = 0;
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 1300;
    const rh = ctx.createBiquadFilter();
    rh.type = 'highpass';
    rh.frequency.value = 220;
    this.loop(this.brown, rf);
    rf.connect(rh).connect(this.riverGain).connect(this.amb);
    // 河水的细碎水声
    const rb = ctx.createBiquadFilter();
    rb.type = 'bandpass';
    rb.frequency.value = 2600;
    rb.Q.value = 1.5;
    this.riverSparkle = ctx.createGain();
    this.riverSparkle.gain.value = 0;
    this.loop(this.white, rb);
    rb.connect(this.riverSparkle).connect(this.amb);
    // 道口铃（按需开启）
    this.crossingOn = false;
    this.crossingNext = 0;
    // 电车轰鸣
    this.trainGain = ctx.createGain();
    this.trainGain.gain.value = 0;
    const tf = ctx.createBiquadFilter();
    tf.type = 'lowpass';
    tf.frequency.value = 380;
    this.loop(this.brown, tf);
    tf.connect(this.trainGain).connect(this.amb);
    this.birdTimer = 2;
    this.lastClack = 0;
  }
  // 每帧：根据环境更新
  update(dt, env) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const wind = 0.04 + env.gust * 0.22 + env.altitude * 0.0015;
    this.windGain.gain.setTargetAtTime(Math.min(0.3, wind), t, 0.4);
    this.windFilter.frequency.setTargetAtTime(380 + env.gust * 700 + Math.sin(t * 0.3) * 120, t, 0.5);
    const rv = Math.max(0, 1 - env.riverDist / 38);
    this.riverGain.gain.setTargetAtTime(rv * rv * 0.32, t, 0.3);
    this.riverSparkle.gain.setTargetAtTime(rv * rv * 0.035, t, 0.3);
    // 电车
    const tv = env.trainDist < 400 ? Math.pow(1 - env.trainDist / 400, 2) : 0;
    this.trainGain.gain.setTargetAtTime(tv * 0.5 * (env.trainSpeed > 0.5 ? 1 : 0.25), t, 0.2);
    if (tv > 0.02 && env.trainSpeed > 1) {
      const interval = 18 / env.trainSpeed;
      if (t - this.lastClack > interval) {
        this.lastClack = t;
        this.clack(tv);
        setTimeout(() => this.clack(tv * 0.9), 120);
      }
    }
    // 道口
    if (env.crossing && env.crossingDist < 160) {
      if (t > this.crossingNext) {
        this.crossingNext = t + 0.62;
        const v = Math.pow(1 - env.crossingDist / 160, 1.5) * 0.35;
        this.ding(760, v, 0.5);
        setTimeout(() => this.ding(640, v * 0.9, 0.5), 310);
      }
    }
    // 鸟
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 4 + Math.random() * 9;
      const h = env.hour;
      if (h > 5 && h < 17.5) {
        const r = Math.random();
        if (r < 0.45) this.uguisu();
        else if (r < 0.85) this.sparrow();
        else this.hibari();
      } else if (h >= 17.5 && h < 19) {
        if (Math.random() < 0.6) this.crow();
      } else if (env.nearPaddy < 160 || Math.random() < 0.3) {
        this.frogs(env.nearPaddy);
        this.birdTimer = 2 + Math.random() * 3;
      }
    }
  }
  // ---------- 合成器件 ----------
  env(g, t, a, peak, d, sustain = 0.0001) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + d);
  }
  pan(v) {
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain();
    if (p.pan) p.pan.value = v;
    return p;
  }
  tone(freq, dur, vol, type = 'sine', dest = this.sfx, at = 0) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    this.env(g, t, 0.005, vol, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return { o, g, t };
  }
  noiseBurst(dur, vol, freq, q = 1, type = 'bandpass', dest = this.sfx, at = 0) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const s = ctx.createBufferSource();
    s.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, 0.003, vol, dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 2);
    s.stop(t + dur + 0.05);
  }
  // 卡普拉斯-斯特朗弦（筝）
  ksBuffer(freq, dur = 3.2, bright = 0.5) {
    const key = freq.toFixed(1) + ':' + bright;
    if (this.ksCache.has(key)) return this.ksCache.get(key);
    const sr = this.ctx.sampleRate;
    const N = Math.round(sr / freq);
    const len = Math.floor(sr * dur);
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const ring = new Float32Array(N);
    let prev = 0;
    for (let i = 0; i < N; i++) {
      const w = Math.random() * 2 - 1;
      prev = prev + bright * (w - prev);
      ring[i] = prev;
    }
    let idx = 0;
    const decay = 0.996 + Math.min(0.0035, 30 / freq / 1000);
    for (let i = 0; i < len; i++) {
      const a = ring[idx], b = ring[(idx + 1) % N];
      const v = 0.5 * (a + b) * decay;
      ring[idx] = v;
      d[i] = a;
      idx = (idx + 1) % N;
    }
    // 起音的拨弦噪声
    for (let i = 0; i < Math.min(len, 300); i++) d[i] += (Math.random() * 2 - 1) * 0.15 * (1 - i / 300);
    this.ksCache.set(key, buf);
    return buf;
  }
  koto(freq, at, vol = 0.22, bend = 0) {
    const ctx = this.ctx;
    const t = Math.max(ctx.currentTime, at);
    const s = ctx.createBufferSource();
    s.buffer = this.ksBuffer(freq, 3.2, 0.55);
    if (bend) {
      s.playbackRate.setValueAtTime(1, t + 0.12);
      s.playbackRate.linearRampToValueAtTime(Math.pow(2, bend / 12), t + 0.32);
    }
    const g = ctx.createGain();
    g.gain.value = vol;
    const p = this.pan((Math.random() - 0.5) * 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    s.connect(lp).connect(g).connect(p);
    p.connect(this.music);
    p.connect(this.reverb);
    s.start(t);
  }
  // 尺八：带气声与颤音的正弦
  shakuhachi(freq, at, dur, vol = 0.07) {
    const ctx = this.ctx;
    const t = Math.max(ctx.currentTime, at);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 0.97, t);
    o.frequency.linearRampToValueAtTime(freq, t + 0.25);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(freq * 0.012, t + dur * 0.7);
    vib.connect(vg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.3);
    g.gain.setValueAtTime(vol, t + dur - 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const breath = ctx.createBufferSource();
    breath.buffer = this.white;
    const bf = ctx.createBiquadFilter();
    bf.type = 'bandpass';
    bf.frequency.value = freq * 2;
    bf.Q.value = 2;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.15);
    bg.gain.exponentialRampToValueAtTime(vol * 0.08, t + 0.6);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    breath.connect(bf).connect(bg);
    o.connect(g);
    const out = ctx.createGain();
    out.gain.value = 1;
    g.connect(out);
    bg.connect(out);
    out.connect(this.music);
    out.connect(this.reverb);
    o.start(t);
    vib.start(t);
    breath.start(t, Math.random());
    o.stop(t + dur + 0.1);
    vib.stop(t + dur + 0.1);
    breath.stop(t + dur + 0.1);
  }
  pad(freqs, at, dur, vol = 0.03) {
    const ctx = this.ctx;
    const t = Math.max(ctx.currentTime, at);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    out.connect(lp);
    lp.connect(this.music);
    lp.connect(this.reverb);
    for (const f of freqs) {
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(out);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
  }
  // ---------- 生成式音乐 ----------
  scheduleMusic() {
    if (!this.ctx || !this.musicOn) return;
    const ctx = this.ctx;
    const ahead = ctx.currentTime + 1.2;
    const hour = this.hour ?? 16;
    const night = hour < 5.5 || hour > 18.6;
    const scale = night || (hour > 16.8 && hour < 18.6) ? IN : YO;
    const base = 293.66; // D4
    const beat = 60 / (night ? 54 : 66);
    while (this.nextNote < ahead) {
      const t = this.nextNote;
      if (!this.phrase || this.phrase.left <= 0) {
        // 新乐句：先留白（間）
        this.phrase = { left: 3 + Math.floor(Math.random() * 5), deg: Math.floor(Math.random() * 5) + 3 };
        this.nextNote += beat * (2 + Math.random() * 4);
        if (Math.random() < 0.35) this.pad([base / 2, (base / 2) * Math.pow(2, 7 / 12)], this.nextNote, beat * 10, night ? 0.02 : 0.026);
        if (Math.random() < (night ? 0.4 : 0.15)) {
          const deg = 5 + Math.floor(Math.random() * 4);
          const f = base * Math.pow(2, (scale[deg % 5] + 12 * Math.floor(deg / 5)) / 12);
          this.shakuhachi(f, this.nextNote + beat, beat * (3 + Math.random() * 2), night ? 0.05 : 0.04);
          this.nextNote += beat * 5;
        }
        continue;
      }
      const p = this.phrase;
      p.deg = Math.max(0, Math.min(11, p.deg + [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)]));
      const semi = scale[p.deg % 5] + 12 * Math.floor(p.deg / 5) - 5;
      const f = base * Math.pow(2, semi / 12);
      const bend = Math.random() < 0.12 ? 1 : 0;
      this.koto(f, t, night ? 0.16 : 0.2, bend);
      // 偶尔的装饰音（流し爪）
      if (Math.random() < 0.12) {
        for (let k = 1; k <= 3; k++) {
          const d2 = Math.max(0, p.deg - k);
          const s2 = scale[d2 % 5] + 12 * Math.floor(d2 / 5) - 5;
          this.koto(base * Math.pow(2, s2 / 12), t + k * 0.07, 0.1);
        }
      }
      p.left--;
      this.nextNote += beat * [1, 1, 0.5, 1.5, 2][Math.floor(Math.random() * 5)];
    }
  }
  // 夕方 5 点的钟声旋律（原创）
  chime() {
    if (!this.ready) return;
    const t = this.ctx.currentTime + 0.3;
    const notes = [0, 2, 4, 7, 4, 2, 0, -3, 0, 2, 4, 2, 0];
    const durs = [1, 1, 1, 2, 1, 1, 2, 2, 1, 1, 2, 1, 3];
    let acc = 0;
    notes.forEach((n, i) => {
      const f = 523.25 * Math.pow(2, n / 12);
      const at = acc * 0.48;
      // 钟琴音色：基频 + 非整数泛音
      for (const [m, v] of [[1, 0.09], [2.76, 0.025], [5.4, 0.012]]) {
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        o.frequency.value = f * m;
        const g = ctx.createGain();
        this.env(g, t + at, 0.01, v, 1.6);
        const p = this.pan(-0.3);
        o.connect(g).connect(p);
        p.connect(this.amb);
        p.connect(this.reverb);
        o.start(t + at);
        o.stop(t + at + 1.8);
      }
      acc += durs[i];
    });
  }
  // ---------- 鸟与蛙 ----------
  uguisu() {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    const p = this.pan((Math.random() - 0.5) * 1.6);
    const g0 = ctx.createGain();
    g0.gain.value = 0.5;
    p.connect(this.amb);
    p.connect(this.reverb);
    g0.connect(p);
    const note = (f0, f1, at, dur, vol) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f0, t + at);
      o.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
      const g = ctx.createGain();
      this.env(g, t + at, 0.03, vol, dur);
      o.connect(g).connect(g0);
      o.start(t + at);
      o.stop(t + at + dur + 0.05);
    };
    // ホー……ホケキョ
    note(1050, 1180, 0, 1.0, 0.12);
    note(1900, 2400, 1.25, 0.12, 0.1);
    note(2300, 1600, 1.42, 0.13, 0.1);
    note(2500, 2900, 1.62, 0.28, 0.11);
  }
  sparrow() {
    const n = 2 + Math.floor(Math.random() * 4);
    const pan = (Math.random() - 0.5) * 1.6;
    for (let i = 0; i < n; i++) {
      const ctx = this.ctx;
      const t = ctx.currentTime + i * (0.12 + Math.random() * 0.1);
      const o = ctx.createOscillator();
      const f = 3800 + Math.random() * 900;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.07);
      const g = ctx.createGain();
      this.env(g, t, 0.005, 0.035, 0.07);
      const p = this.pan(pan);
      o.connect(g).connect(p).connect(this.amb);
      o.start(t);
      o.stop(t + 0.1);
    }
  }
  hibari() {
    const ctx = this.ctx;
    const p = this.pan((Math.random() - 0.5));
    p.connect(this.amb);
    for (let i = 0; i < 14; i++) {
      const t = ctx.currentTime + i * 0.09;
      const o = ctx.createOscillator();
      const f = 3000 + Math.random() * 1800;
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f + (Math.random() - 0.5) * 900, t + 0.06);
      const g = ctx.createGain();
      this.env(g, t, 0.004, 0.018, 0.06);
      o.connect(g).connect(p);
      o.start(t);
      o.stop(t + 0.09);
    }
  }
  crow() {
    const ctx = this.ctx;
    const p = this.pan((Math.random() - 0.5) * 1.4);
    p.connect(this.amb);
    p.connect(this.reverb);
    for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
      const t = ctx.currentTime + i * 0.55;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(520, t);
      o.frequency.linearRampToValueAtTime(430, t + 0.35);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1300;
      f.Q.value = 3;
      const g = ctx.createGain();
      this.env(g, t, 0.03, 0.05, 0.38);
      o.connect(f).connect(g).connect(p);
      o.start(t);
      o.stop(t + 0.45);
    }
  }
  frogs(dist = 100) {
    const ctx = this.ctx;
    const v = 0.05 * Math.max(0.15, 1 - dist / 260);
    const n = 4 + Math.floor(Math.random() * 6);
    const p = this.pan((Math.random() - 0.5) * 1.2);
    p.connect(this.amb);
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + i * (0.16 + Math.random() * 0.05);
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 340 + Math.random() * 60;
      const am = ctx.createOscillator();
      am.frequency.value = 38;
      const ag = ctx.createGain();
      ag.gain.value = 0.5;
      const g = ctx.createGain();
      this.env(g, t, 0.01, v, 0.11);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900;
      o.connect(f).connect(g).connect(p);
      am.connect(ag).connect(g.gain);
      o.start(t);
      am.start(t);
      o.stop(t + 0.14);
      am.stop(t + 0.14);
    }
  }
  // ---------- 音效 ----------
  step(surface, run) {
    if (!this.ready) return;
    const v = run ? 0.09 : 0.06;
    switch (surface) {
      case 'stone': this.noiseBurst(0.05, v * 1.2, 2400, 1.2); this.noiseBurst(0.03, v * 0.6, 900, 2); break;
      case 'wood': this.tone(180 + Math.random() * 30, 0.08, v * 1.3, 'triangle'); this.noiseBurst(0.04, v * 0.5, 1200, 2); break;
      case 'gravel': for (let i = 0; i < 3; i++) this.noiseBurst(0.04, v * 0.7, 3000 + Math.random() * 2000, 2, 'bandpass', this.sfx, i * 0.015); break;
      case 'water': this.noiseBurst(0.18, v * 1.5, 1400, 0.8, 'lowpass'); break;
      case 'asphalt': this.noiseBurst(0.04, v, 1800, 1.4); break;
      case 'sand': case 'dirt': case 'mud': this.noiseBurst(0.07, v * 0.9, 700, 0.8, 'lowpass'); break;
      default: this.noiseBurst(0.07, v * 0.85, 1100, 0.7); break;
    }
  }
  land(k) {
    if (!this.ready) return;
    this.noiseBurst(0.12, 0.1 + k * 0.1, 500, 0.7, 'lowpass');
  }
  ui(kind = 'tap') {
    if (!this.ready) return;
    if (kind === 'tap') this.tone(1320, 0.12, 0.04, 'sine');
    else if (kind === 'open') {
      this.tone(660, 0.18, 0.04, 'sine');
      this.tone(990, 0.22, 0.03, 'sine', this.sfx, 0.07);
    } else if (kind === 'close') this.tone(520, 0.15, 0.035, 'sine');
    else if (kind === 'wood') {
      // 拍子木
      this.tone(1650, 0.06, 0.08, 'triangle');
      this.noiseBurst(0.03, 0.06, 2500, 4);
    }
  }
  stamp() {
    if (!this.ready) return;
    this.noiseBurst(0.08, 0.25, 260, 0.8, 'lowpass');
    this.tone(90, 0.18, 0.2, 'sine');
    setTimeout(() => this.ui('open'), 260);
  }
  suzu() {
    if (!this.ready) return;
    for (let i = 0; i < 9; i++) {
      const at = i * 0.07 + Math.random() * 0.04;
      const f = 2900 + Math.random() * 900;
      for (const [m, v] of [[1, 0.035], [2.3, 0.015], [3.9, 0.008]]) this.tone(f * m, 0.5, v, 'sine', this.sfx, at);
    }
  }
  clap() {
    if (!this.ready) return;
    this.noiseBurst(0.08, 0.3, 1500, 0.9);
  }
  bonsho() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    const base = 82;
    for (const [m, v, d] of [[1, 0.3, 9], [2.04, 0.16, 7], [2.98, 0.08, 5], [4.12, 0.05, 3.5], [5.43, 0.03, 2.5], [0.5, 0.12, 10]]) {
      const o = ctx.createOscillator();
      o.frequency.value = base * m;
      const o2 = ctx.createOscillator();
      o2.frequency.value = base * m * 1.004;
      const g = ctx.createGain();
      this.env(g, t, 0.01, v, d);
      o.connect(g);
      o2.connect(g);
      g.connect(this.sfx);
      g.connect(this.reverb);
      o.start(t);
      o2.start(t);
      o.stop(t + d + 0.2);
      o2.stop(t + d + 0.2);
    }
    this.noiseBurst(0.12, 0.3, 300, 0.7, 'lowpass');
  }
  gachan() {
    if (!this.ready) return;
    this.tone(140, 0.15, 0.2, 'triangle');
    this.noiseBurst(0.18, 0.12, 900, 1.2, 'bandpass', this.sfx, 0.05);
    this.tone(95, 0.2, 0.18, 'sine', this.sfx, 0.18);
  }
  purr(dur = 3) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.brown;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 24;
    const lg = ctx.createGain();
    lg.gain.value = 0.25;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.9, t + 0.4);
    env.gain.setValueAtTime(0.9, t + dur - 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lfo.connect(lg).connect(g.gain);
    s.connect(f).connect(g).connect(env).connect(this.sfx);
    s.start(t);
    lfo.start(t);
    s.stop(t + dur + 0.1);
    lfo.stop(t + dur + 0.1);
  }
  meow() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(520, t);
    o.frequency.linearRampToValueAtTime(820, t + 0.18);
    o.frequency.linearRampToValueAtTime(560, t + 0.5);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.linearRampToValueAtTime(1800, t + 0.2);
    f.frequency.linearRampToValueAtTime(1000, t + 0.5);
    f.Q.value = 4;
    const g = ctx.createGain();
    this.env(g, t, 0.05, 0.08, 0.5);
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.6);
  }
  clack(v) {
    this.noiseBurst(0.05, 0.25 * v, 700, 1.5);
    this.tone(120, 0.08, 0.2 * v, 'triangle');
  }
  ding(f, v, d) {
    const o = this.tone(f, d, v, 'square', this.amb);
    void o;
  }
  horn() {
    if (!this.ready) return;
    for (const f of [440, 554]) this.tone(f, 0.9, 0.05, 'sawtooth', this.amb);
  }
  whoosh(k = 1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.pink;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.7;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1400, t + 1.6);
    f.frequency.exponentialRampToValueAtTime(400, t + 4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * k, t + 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
    s.connect(f).connect(g).connect(this.amb);
    s.start(t);
    s.stop(t + 4.6);
  }
  water() {
    if (!this.ready) return;
    for (let i = 0; i < 6; i++) this.noiseBurst(0.12, 0.05, 1800 + Math.random() * 1500, 3, 'bandpass', this.sfx, i * 0.09);
  }
  page() {
    if (!this.ready) return;
    this.noiseBurst(0.18, 0.06, 3500, 0.6, 'highpass');
  }
  shake() {
    if (!this.ready) return;
    for (let i = 0; i < 8; i++) this.noiseBurst(0.04, 0.08, 2600, 3, 'bandpass', this.sfx, i * 0.06);
  }
}
