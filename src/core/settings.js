// 设置与存档（localStorage 可能不可用：私密窗口、被禁用的站点数据等，一律容错）
const SETTINGS_KEY = 'sakuragawa.settings.v1';
const SAVE_KEY = 'sakuragawa.save.v1';

export const QUALITY = {
  low: { name: '流畅', pixelRatio: 0.9, msaa: 0, shadow: 1024, softShadow: false, bloom: false, grass: 0.28, petals: 0.45, cards: 0.55, drawFar: 0.8 },
  medium: { name: '均衡', pixelRatio: 1.25, msaa: 4, shadow: 2048, softShadow: true, bloom: true, bloomScale: 0.4, grass: 0.62, petals: 0.75, cards: 0.85, drawFar: 1 },
  high: { name: '精致', pixelRatio: 1.75, msaa: 4, shadow: 3072, softShadow: true, bloom: true, bloomScale: 0.5, grass: 1, petals: 1, cards: 1, drawFar: 1 },
};

export function detectQuality() {
  const ua = navigator.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const cores = navigator.hardwareConcurrency || 4;
  if (mobile) return cores >= 8 ? 'medium' : 'low';
  return cores >= 6 ? 'high' : 'medium';
}

function read(key) {
  try {
    const s = window.localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}
function write(key, v) {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
    return true;
  } catch (e) {
    return false;
  }
}

export const settings = Object.assign(
  {
    quality: null,
    volume: 0.8,
    music: 0.7,
    sensitivity: 1,
    invertY: false,
    pointerLock: false,
    showHints: true,
    view: 'first', // first | third
    headBob: true,
  },
  read(SETTINGS_KEY) || {}
);
if (!settings.quality || !QUALITY[settings.quality]) settings.quality = detectQuality();

export function saveSettings() {
  write(SETTINGS_KEY, settings);
}

export function loadGame() {
  return read(SAVE_KEY);
}
export function saveGame(data) {
  return write(SAVE_KEY, data);
}
export function clearGame() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch (e) {
    /* 忽略 */
  }
}
