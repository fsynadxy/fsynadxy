// UI 用的手绘：御朱印、猫咪小像、地图底图
import { FONT_BRUSH, FONT_SERIF } from '../world/textures.js';
import { RNG } from '../core/math.js';

// 墨迹质感：在路径上做轻微噪点
function inkify(ctx, w, h, seed) {
  const rng = new RNG(seed);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 420; i++) {
    ctx.globalAlpha = rng.float(0.05, 0.35);
    ctx.beginPath();
    ctx.arc(rng.float(0, w), rng.float(0, h), rng.float(0.4, 2.2), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawGoshuin(cv, stamp, info = {}) {
  const W = (cv.width = 300), H = (cv.height = 420);
  const ctx = cv.getContext('2d');
  // 纸
  ctx.fillStyle = '#fdfaf2';
  ctx.fillRect(0, 0, W, H);
  const rng = new RNG(stamp.id.length * 97 + stamp.name.length);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(150,120,90,${rng.float(0.01, 0.05)})`;
    ctx.fillRect(rng.float(0, W), rng.float(0, H), rng.float(0.5, 2.5), rng.float(0.5, 1.5));
  }
  // 红印（中央大印）
  const seal = document.createElement('canvas');
  seal.width = W;
  seal.height = H;
  const s = seal.getContext('2d');
  s.translate(W / 2, H * 0.52);
  s.rotate(rng.float(-0.06, 0.06));
  s.strokeStyle = stamp.color;
  s.fillStyle = stamp.color;
  const round = stamp.id === 'ancient' || stamp.id === 'lake' || stamp.id === 'station';
  if (round) {
    s.lineWidth = 7;
    s.beginPath();
    s.arc(0, 0, 70, 0, Math.PI * 2);
    s.stroke();
    s.lineWidth = 2;
    s.beginPath();
    s.arc(0, 0, 60, 0, Math.PI * 2);
    s.stroke();
  } else {
    s.lineWidth = 7;
    s.strokeRect(-66, -66, 132, 132);
    s.lineWidth = 2;
    s.strokeRect(-56, -56, 112, 112);
  }
  s.textAlign = 'center';
  s.textBaseline = 'middle';
  const chars = [...stamp.seal];
  if (chars.length === 1) {
    s.font = `700 78px ${FONT_SERIF}`;
    s.fillText(chars[0], 0, 4);
  } else {
    s.font = `700 50px ${FONT_SERIF}`;
    chars.forEach((c, i) => s.fillText(c, 0, (i - (chars.length - 1) / 2) * 50 + 3));
  }
  // 小樱花纹
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.translate(W * 0.78, H * 0.16);
  for (let k = 0; k < 5; k++) {
    s.save();
    s.rotate((k / 5) * Math.PI * 2);
    s.beginPath();
    s.ellipse(0, -11, 6.5, 10, 0, 0, Math.PI * 2);
    s.fill();
    s.restore();
  }
  s.globalCompositeOperation = 'destination-out';
  s.beginPath();
  s.arc(0, 0, 4, 0, Math.PI * 2);
  s.fill();
  s.globalCompositeOperation = 'source-over';
  inkify(s, W, H, stamp.id.charCodeAt(0));
  ctx.globalAlpha = 0.88;
  ctx.drawImage(seal, 0, 0);
  ctx.globalAlpha = 1;
  // 墨书
  ctx.fillStyle = '#1d1a18';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `48px ${FONT_BRUSH}`;
  const name = [...stamp.name.replace(/\s.*/, '')];
  const fs = Math.min(52, 300 / name.length);
  ctx.font = `${fs}px ${FONT_BRUSH}`;
  name.forEach((c, i) => ctx.fillText(c, W / 2, 70 + i * fs * 1.02 + (5 - name.length) * fs * 0.3));
  ctx.font = `26px ${FONT_BRUSH}`;
  ['奉', '拝'].forEach((c, i) => ctx.fillText(c, W - 42, 42 + i * 30));
  ctx.font = `17px ${FONT_BRUSH}`;
  const date = info.date || '令和八年卯月';
  [...date].forEach((c, i) => ctx.fillText(c, 34, 150 + i * 20));
  ctx.font = `15px ${FONT_SERIF}`;
  ctx.fillStyle = 'rgba(60,50,45,0.75)';
  [...(stamp.sub || '')].forEach((c, i) => ctx.fillText(c, W - 40, H - 120 + i * 18));
}

export function drawCatIcon(cv, cat, known = true) {
  const W = (cv.width = 128), H = (cv.height = 128);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = known ? '#f6efe6' : '#ece6de';
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, Math.PI * 2);
  ctx.fill();
  if (!known) {
    ctx.fillStyle = 'rgba(110,84,64,0.35)';
    ctx.font = `700 54px ${FONT_SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 64, 68);
    return;
  }
  const [c0, c1, c2] = cat.colors;
  // 身体
  ctx.fillStyle = c0;
  ctx.beginPath();
  ctx.ellipse(64, 92, 34, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  // 头
  ctx.beginPath();
  ctx.ellipse(64, 56, 30, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  // 耳
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(64 + sx * 26, 46);
    ctx.lineTo(64 + sx * 22, 22);
    ctx.lineTo(64 + sx * 8, 34);
    ctx.closePath();
    ctx.fillStyle = cat.pattern === 'tuxedo' ? c1 : c0;
    ctx.fill();
  }
  // 花纹
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(64, 56, 30, 26, 0, 0, Math.PI * 2);
  ctx.ellipse(64, 92, 34, 26, 0, 0, Math.PI * 2);
  ctx.clip();
  if (cat.pattern === 'calico') {
    ctx.fillStyle = c1;
    ctx.beginPath(); ctx.ellipse(48, 46, 16, 12, 0.4, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(86, 96, 18, 12, 0, 0, 7); ctx.fill();
    ctx.fillStyle = c2;
    ctx.beginPath(); ctx.ellipse(82, 44, 12, 10, -0.4, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(46, 100, 12, 9, 0, 0, 7); ctx.fill();
  } else if (cat.pattern === 'tabby') {
    ctx.strokeStyle = c1;
    ctx.lineWidth = 5;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(30, 70 + i * 9);
      ctx.quadraticCurveTo(64, 64 + i * 9, 98, 70 + i * 9);
      ctx.stroke();
    }
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(56 + i * 8, 32);
      ctx.lineTo(56 + i * 8, 44);
      ctx.stroke();
    }
  } else if (cat.pattern === 'tortie') {
    ctx.fillStyle = c1;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.ellipse(30 + ((i * 37) % 70), 36 + ((i * 53) % 80), 9, 6, i, 0, 7);
      ctx.fill();
    }
  } else if (cat.pattern === 'tuxedo') {
    ctx.fillStyle = c1;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = c0;
    ctx.beginPath(); ctx.ellipse(64, 66, 14, 14, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(64, 100, 18, 22, 0, 0, 7); ctx.fill();
  }
  ctx.restore();
  // 脸
  ctx.fillStyle = '#2a2320';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(64 + sx * 11, 56, 3.2, 4.5, 0, 0, 7);
    ctx.fill();
  }
  ctx.fillStyle = '#e58f97';
  ctx.beginPath();
  ctx.moveTo(60, 64); ctx.lineTo(68, 64); ctx.lineTo(64, 68); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,50,45,0.6)';
  ctx.lineWidth = 1.2;
  for (const sx of [-1, 1]) for (const dy of [-2, 2]) {
    ctx.beginPath();
    ctx.moveTo(64 + sx * 12, 67 + dy);
    ctx.lineTo(64 + sx * 30, 64 + dy * 2.2);
    ctx.stroke();
  }
}
