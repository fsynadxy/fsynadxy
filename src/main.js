import './ui/style.css';
import { Game } from './game/game.js';

function fail(err) {
  console.error(err);
  const label = document.querySelector('.ld-label');
  const msg = !window.WebGL2RenderingContext
    ? '你的浏览器不支持 WebGL2，无法显示桜川町。请换用最新版的 Chrome、Edge、Firefox 或 Safari。'
    : '加载时出了点问题：' + (err && err.message ? err.message : String(err));
  if (label) {
    label.textContent = msg;
    label.style.color = '#a83a28';
    label.style.letterSpacing = '0.05em';
  } else {
    document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;left:16px;bottom:16px;color:#a83a28">${msg}</p>`);
  }
}

window.addEventListener('error', (e) => {
  if (!window.__game || !window.__game.ready) fail(e.error || e.message);
});

const game = new Game(document.getElementById('app'));
game.boot().catch(fail);
