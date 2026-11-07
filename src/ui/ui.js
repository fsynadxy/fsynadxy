import { STAMPS, CATS, HAIKU, TIPS } from '../game/content.js';
import { drawGoshuin, drawCatIcon } from './art.js';
import { settings, saveSettings, QUALITY } from '../core/settings.js';

const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

export class UI {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.audio = game.audio;
    this.open = null;
    this.toasts = [];
    this.build();
  }
  build() {
    const r = this.root;
    r.innerHTML = `
      <div id="loading">
        <div class="ld-inner">
          <div class="ld-title">桜川町</div>
          <div class="ld-sub">さくらがわちょう</div>
          <div class="ld-haiku"></div>
          <div class="ld-bar"><i></i></div>
          <div class="ld-label">研墨、备纸</div>
        </div>
      </div>
      <div id="title" class="hidden">
        <div class="tt-vertical"><h1>桜川町</h1><p>花筏の流れる町</p><div class="tt-seal">春</div></div>
        <div class="tt-menu">
          <button data-act="continue" class="hidden">继续旅程<small>つづき</small></button>
          <button data-act="start">开始旅程<small>はじめる</small></button>
          <button data-act="help">操作说明<small>あそびかた</small></button>
          <button data-act="settings">设置<small>せってい</small></button>
        </div>
        <div class="tt-foot">耳机效果更佳 · 所有画面与声音均为实时程序生成</div>
      </div>
      <div id="hud" class="hidden">
        <div class="hud-clock"><span class="ic"></span><b class="time">16:30</b><span class="period">黄昏</span><span class="speed"></span></div>
        <div class="hud-collect"><span>御朱印 <b class="c-stamp">0</b>/8</span><span>猫 <b class="c-cat">0</b>/7</span></div>
        <div class="hud-map" title="地图 (M)"><canvas width="300" height="300"></canvas><span class="n">北</span></div>
        <div class="hud-buttons">
          <button data-act="map">地图 <kbd>M</kbd></button>
          <button data-act="book">御朱印帐 <kbd>B</kbd></button>
          <button data-act="photo">拍照 <kbd>P</kbd></button>
          <button data-act="menu">菜单 <kbd>Esc</kbd></button>
        </div>
        <div class="hud-region"><h2></h2><div class="rule"></div><p></p></div>
        <div class="hud-toasts"></div>
        <div class="hud-prompt off"><kbd>E</kbd><span></span></div>
        <div class="hud-hint"></div>
        <div class="hud-subtitle"></div>
      </div>
      <div id="dialog" class="washi hidden"><div class="dl-name"></div><div class="dl-text"></div><div class="dl-next">▼</div></div>
      <div id="book" class="panel washi hidden">
        <div class="panel-head"><h3>御朱印帳</h3><div class="tabs"><button data-tab="stamps" class="on">御朱印</button><button data-tab="cats">猫</button><button data-tab="notes">记事</button></div><button class="close" aria-label="关闭">×</button></div>
        <div class="panel-body"></div>
        <div class="panel-foot"></div>
      </div>
      <div id="mapPanel" class="panel washi hidden">
        <div class="panel-head"><h3>桜川町 地図</h3><button class="close" aria-label="关闭">×</button></div>
        <div class="panel-body"><canvas width="1024" height="1024"></canvas></div>
        <div class="panel-foot">红色方印：尚未收集的御朱印 · 灰色：已收集 · 红色箭头：你所在的位置</div>
      </div>
      <div id="menu" class="panel washi hidden">
        <div class="panel-head"><h3>しおり</h3><div class="tabs"><button data-tab="settings" class="on">设置</button><button data-tab="keys">操作</button><button data-tab="about">关于</button></div><button class="close" aria-label="关闭">×</button></div>
        <div class="panel-body"></div>
      </div>
      <div id="fortune" class="hidden"></div>
      <div id="photoUI" class="washi hidden">
        <label>时刻 <input type="range" min="0" max="24" step="0.05" class="p-time"><span class="p-tv"></span></label>
        <label>滤镜 <span class="seg p-filter"><button data-f="0" class="on">原色</button><button data-f="1">胶片</button><button data-f="2">黑白</button><button data-f="3">樱色</button><button data-f="4">夜色</button></span></label>
        <span class="grow"></span>
        <button class="btn p-shot">拍下</button>
        <button class="btn ghost p-exit">退出</button>
        <div class="help">WASD 移动 · 拖动鼠标转向 · Q/空格 上升 · Z 下降 · 滚轮调焦距 · H 隐藏面板</div>
      </div>
      <div id="photoFlash"></div>
      <div id="touch" class="hidden">
        <div class="joy"><i></i></div>
        <div class="tbtns">
          <button data-t="run">跑</button><button data-t="jump">跳</button>
          <button data-t="interact" class="act hidden" style="grid-column: span 2; width: 140px; border-radius: 32px;">交互</button>
        </div>
      </div>
      <div id="fade"></div>
    `;
    this.el = {
      loading: $('#loading', r), title: $('#title', r), hud: $('#hud', r), dialog: $('#dialog', r), book: $('#book', r), map: $('#mapPanel', r),
      menu: $('#menu', r), fortune: $('#fortune', r), photo: $('#photoUI', r), flash: $('#photoFlash', r), touch: $('#touch', r), fade: $('#fade', r),
    };
    // 加载页的花瓣
    for (let i = 0; i < 14; i++) {
      const p = h('i', 'ld-petal');
      p.style.left = Math.random() * 110 + 'vw';
      p.style.animationDuration = 7 + Math.random() * 8 + 's';
      p.style.animationDelay = -Math.random() * 10 + 's';
      p.style.transform = `scale(${0.6 + Math.random()})`;
      this.el.loading.appendChild(p);
    }
    const hk = HAIKU[Math.floor(Math.random() * HAIKU.length)];
    $('.ld-haiku', r).innerHTML = `<div class="jp">${hk[0]}</div><div class="cn">${hk[2]}</div><div class="au">—— ${hk[1]}</div>`;
    // 事件
    r.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) {
        this.audio.ui('tap');
        // 交出焦点，避免之后按空格/回车再次触发这个按钮
        if (b.closest('#hud') && b.blur) b.blur();
        this.game.onUIAction(b.dataset.act);
      }
    });
    for (const p of [this.el.book, this.el.map, this.el.menu]) $('.close', p).addEventListener('click', () => this.closePanel());
    $('.tabs', this.el.book).addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) this.renderBook(t.dataset.tab);
    });
    $('.tabs', this.el.menu).addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) this.renderMenu(t.dataset.tab);
    });
    this.el.dialog.addEventListener('click', () => this.advanceDialog());
    $('.hud-prompt', r).addEventListener('click', () => this.game.input.pressVirtual('interact'));
    $('.hud-map', r).addEventListener('click', () => this.game.onUIAction('map'));
    // 拍照面板
    const ph = this.el.photo;
    $('.p-time', ph).addEventListener('input', (e) => this.game.setTime(parseFloat(e.target.value)));
    $('.p-filter', ph).addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      ph.querySelectorAll('.p-filter button').forEach((x) => x.classList.toggle('on', x === b));
      this.game.setFilter(parseInt(b.dataset.f));
    });
    $('.p-shot', ph).addEventListener('click', () => this.game.takePhoto());
    $('.p-exit', ph).addEventListener('click', () => this.game.togglePhoto(false));
    this.setupTouch();
    this.hintStart = performance.now();
  }
  // ---------------------------------------------------------------- 加载与标题
  progress(p, label) {
    $('.ld-bar i', this.root).style.width = Math.round(p * 100) + '%';
    if (label) $('.ld-label', this.root).textContent = label;
  }
  hideLoading() {
    this.el.loading.classList.add('fade');
    setTimeout(() => this.el.loading.classList.add('hidden'), 1300);
  }
  showTitle(hasSave) {
    this.el.title.classList.remove('hidden', 'fade');
    $('[data-act="continue"]', this.el.title).classList.toggle('hidden', !hasSave);
    const first = $(hasSave ? '[data-act="continue"]' : '[data-act="start"]', this.el.title);
    setTimeout(() => first.focus({ preventScroll: true }), 50);
  }
  hideTitle() {
    this.el.title.classList.add('fade');
    setTimeout(() => this.el.title.classList.add('hidden'), 1000);
  }
  showHUD(on = true) {
    this.el.hud.classList.toggle('hidden', !on);
    this.el.touch.classList.toggle('hidden', !(on && this.game.input.isTouch));
  }
  dimHUD(on) {
    this.el.hud.classList.toggle('dim', on);
    this.el.touch.classList.toggle('hidden', on || !this.game.input.isTouch);
  }
  fade(on) {
    this.el.fade.classList.toggle('on', on);
  }
  // ---------------------------------------------------------------- HUD
  updateClock(dn) {
    const r = this.root;
    $('.time', r).textContent = dn.timeString;
    $('.period', r).textContent = dn.period;
    $('.ic', r).classList.toggle('moon', dn.elev < -2);
    $('.speed', r).textContent = dn.boost > 1 ? '»' : '';
  }
  updateCounts(stamps, cats) {
    $('.c-stamp', this.root).textContent = stamps;
    $('.c-cat', this.root).textContent = cats;
  }
  prompt(text, key = 'E') {
    const p = $('.hud-prompt', this.root);
    const tb = $('[data-t="interact"]', this.el.touch);
    if (!text) {
      p.classList.add('off');
      tb.classList.add('hidden');
      return;
    }
    p.classList.remove('off');
    $('span', p).textContent = text;
    $('kbd', p).textContent = this.game.input.lastInput === 'gamepad' ? 'X' : key;
    tb.classList.remove('hidden');
    tb.textContent = text.length > 6 ? text.slice(0, 6) : text;
  }
  toast(html, dur = 3600) {
    const box = $('.hud-toasts', this.root);
    const t = h('div', 'toast', html);
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.classList.add('out'), dur);
    setTimeout(() => t.remove(), dur + 700);
  }
  region(name, sub) {
    const el = $('.hud-region', this.root);
    $('h2', el).textContent = name;
    $('p', el).textContent = sub || '';
    el.classList.add('on');
    clearTimeout(this._regionT);
    this._regionT = setTimeout(() => el.classList.remove('on'), 4200);
  }
  subtitle(text, dur = 4000) {
    const el = $('.hud-subtitle', this.root);
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(this._subT);
    this._subT = setTimeout(() => el.classList.remove('on'), dur);
  }
  updateHints() {
    const el = $('.hud-hint', this.root);
    const t = (performance.now() - this.hintStart) / 1000;
    const show = settings.showHints && t < 75 && !this.game.input.isTouch;
    el.classList.toggle('off', !show);
    if (show && !el.innerHTML) {
      el.innerHTML = `<div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 行走 · <kbd>Shift</kbd> 奔跑 · <kbd>空格</kbd> 跳</div>
        <div>按住鼠标拖动 转动视角 · 滚轮 远近</div>
        <div><kbd>E</kbd> 交互 · <kbd>M</kbd> 地图 · <kbd>B</kbd> 御朱印帐 · <kbd>P</kbd> 拍照 · <kbd>T</kbd> 加速时间</div>`;
    }
  }
  // ---------------------------------------------------------------- 对话
  dialog(name, title, lines, done) {
    this.dlg = { lines: Array.isArray(lines) ? lines : [lines], i: 0, done, typing: false };
    const d = this.el.dialog;
    $('.dl-name', d).innerHTML = name + (title ? `<small>${title}</small>` : '');
    $('.dl-name', d).classList.toggle('hidden', !name);
    d.classList.remove('hidden');
    this.showLine();
  }
  showLine() {
    const d = this.el.dialog;
    const text = this.dlg.lines[this.dlg.i];
    const el = $('.dl-text', d);
    el.textContent = '';
    this.dlg.typing = true;
    let k = 0;
    clearInterval(this._typeT);
    const chars = [...text];
    this._typeT = setInterval(() => {
      k += 1;
      el.textContent = chars.slice(0, k).join('');
      if (k % 3 === 0 && chars[k - 1] && chars[k - 1].trim()) this.audio.ui && this.game.audio.ready && this.game.audio.tone(900 + Math.random() * 200, 0.03, 0.008, 'sine');
      if (k >= chars.length) {
        clearInterval(this._typeT);
        this.dlg.typing = false;
      }
    }, 34);
  }
  get dialogOpen() {
    return !this.el.dialog.classList.contains('hidden');
  }
  advanceDialog() {
    if (!this.dlg) return;
    if (this.dlg.typing) {
      clearInterval(this._typeT);
      $('.dl-text', this.el.dialog).textContent = this.dlg.lines[this.dlg.i];
      this.dlg.typing = false;
      return;
    }
    this.dlg.i++;
    if (this.dlg.i >= this.dlg.lines.length) {
      this.el.dialog.classList.add('hidden');
      const done = this.dlg.done;
      this.dlg = null;
      if (done) done();
      return;
    }
    this.audio.ui('tap');
    this.showLine();
  }
  // ---------------------------------------------------------------- 面板
  openPanel(name, arg) {
    this.closePanel(true);
    this.open = name;
    const el = this.el[name === 'map' ? 'map' : name];
    el.classList.remove('hidden');
    this.audio.ui('open');
    if (name === 'book') this.renderBook(arg || 'stamps');
    if (name === 'map') this.game.drawFullMap($('canvas', this.el.map));
    if (name === 'menu') this.renderMenu(arg || 'settings');
    this.game.onPanel(true);
  }
  closePanel(silent) {
    if (!this.open) return;
    const el = this.el[this.open === 'map' ? 'map' : this.open];
    el.classList.add('hidden');
    this.open = null;
    if (!silent) this.audio.ui('close');
    this.game.onPanel(false);
  }
  renderBook(tab) {
    const b = this.el.book;
    b.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
    const body = $('.panel-body', b);
    const st = this.game.state;
    body.innerHTML = '';
    if (tab === 'stamps') {
      const grid = h('div', 'stamp-grid');
      for (const s of STAMPS) {
        const wrap = h('div');
        const got = st.stamps[s.id];
        if (got) {
          const page = h('div', 'stamp-page' + (this.newStamp === s.id ? ' new' : ''));
          const cv = document.createElement('canvas');
          drawGoshuin(cv, s, { date: got.date });
          page.appendChild(cv);
          wrap.appendChild(page);
        } else {
          wrap.appendChild(h('div', 'stamp-page empty', `<div class="ring">${s.seal}</div><span>未收集</span>`));
        }
        wrap.appendChild(h('div', 'stamp-cap', s.name));
        grid.appendChild(wrap);
      }
      this.newStamp = null;
      body.appendChild(grid);
      const n = Object.keys(st.stamps).length;
      $('.panel-foot', b).textContent = n >= 8 ? '八处都已走过。今夜，千年桜为你点灯。' : `已收集 ${n}/8 · 御朱印台设在小镇各处的名所，旁边立着“スタンプ”的小牌子。`;
    } else if (tab === 'cats') {
      const grid = h('div', 'cat-grid');
      for (const c of CATS) {
        const known = !!st.cats[c.id];
        const card = h('div', 'cat-card' + (known ? '' : ' unknown'));
        const cv = document.createElement('canvas');
        drawCatIcon(cv, c, known);
        card.appendChild(cv);
        card.appendChild(h('div', null, known ? `<h4>${c.name}<small>${c.kana}</small></h4><p>${c.desc}</p>` : `<h4>？？？</h4><p>还没有遇见。</p>`));
        grid.appendChild(card);
      }
      body.appendChild(grid);
      const n = Object.keys(st.cats).length;
      $('.panel-foot', b).textContent = n >= 7 ? '七只猫都成了你的朋友。一只小猫开始跟着你散步了。' : `已遇见 ${n}/7 · 靠近猫咪按 E，轻轻摸摸它。`;
    } else {
      const n = h('div', 'notes');
      const hk = HAIKU.map((x) => `<div class="haiku">${x[0]}</div><div class="muted">${x[2]} —— ${x[1]}</div>`).join('');
      const fortunes = st.fortunes.length ? st.fortunes.map((f) => `<span>${f}</span>`).join(' · ') : '<span class="muted">还没有抽过签。神社的社务所前可以抽。</span>';
      const drinks = st.drinks.length ? st.drinks.join(' · ') : '<span class="muted">镇上有好几台自动售货机。</span>';
      n.innerHTML = `<h4>旅程</h4><div>第 ${this.game.daynight.day} 天 · 走了 ${(st.distance / 1000).toFixed(2)} 公里 · 和 ${Object.keys(st.talked).length} 位镇民说过话</div>
        <h4>抽过的签</h4><div>${fortunes}</div>
        <h4>喝过的饮料</h4><div>${drinks}</div>
        <h4>小贴士</h4><div>${TIPS.map((t) => `<div>· ${t}</div>`).join('')}</div>
        <h4>樱花的诗</h4>${hk}`;
      body.appendChild(n);
      $('.panel-foot', b).textContent = '在千年桜下仰望，或在长椅上坐一坐，都会有别样的风景。';
    }
  }
  renderMenu(tab) {
    const m = this.el.menu;
    m.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
    const body = $('.panel-body', m);
    if (tab === 'settings') {
      body.innerHTML = `<div class="settings">
        <div><h4>画面</h4>
          <div class="row">画质 <span class="seg q">${Object.entries(QUALITY).map(([k, q]) => `<button data-q="${k}" class="${settings.quality === k ? 'on' : ''}">${q.name}</button>`).join('')}</span></div>
          <div class="row">显示操作提示 <input type="checkbox" class="s-hints" ${settings.showHints ? 'checked' : ''}></div>
          <div class="row muted" style="font-size:12px;color:var(--ink-3)">更改画质会重新载入页面（进度已自动保存）。</div>
        </div>
        <div><h4>声音与操作</h4>
          <div class="row">总音量 <input type="range" min="0" max="1" step="0.01" class="s-vol" value="${settings.volume}"></div>
          <div class="row">音乐 <input type="range" min="0" max="1" step="0.01" class="s-music" value="${settings.music}"></div>
          <div class="row">视角灵敏度 <input type="range" min="0.3" max="2.5" step="0.05" class="s-sens" value="${settings.sensitivity}"></div>
          <div class="row">反转纵向视角 <input type="checkbox" class="s-inv" ${settings.invertY ? 'checked' : ''}></div>
          <div class="row">锁定鼠标指针 <input type="checkbox" class="s-lock" ${settings.pointerLock ? 'checked' : ''}></div>
        </div>
      </div>
      <div class="btns"><button class="btn b-resume">回到小镇</button><button class="btn ghost b-title">回到标题</button><button class="btn warn b-reset">清除进度</button></div>`;
      body.querySelector('.q').addEventListener('click', (e) => {
        const b = e.target.closest('[data-q]');
        if (!b || b.dataset.q === settings.quality) return;
        settings.quality = b.dataset.q;
        saveSettings();
        this.game.saveNow();
        location.reload();
      });
      const bind = (cls, key, num = true) => body.querySelector(cls).addEventListener('input', (e) => {
        settings[key] = num ? parseFloat(e.target.value) : e.target.checked;
        saveSettings();
        this.game.audio.applyVolume();
      });
      bind('.s-vol', 'volume');
      bind('.s-music', 'music');
      bind('.s-sens', 'sensitivity');
      bind('.s-inv', 'invertY', false);
      bind('.s-lock', 'pointerLock', false);
      bind('.s-hints', 'showHints', false);
      body.querySelector('.b-resume').addEventListener('click', () => this.closePanel());
      body.querySelector('.b-title').addEventListener('click', () => this.game.toTitle());
      body.querySelector('.b-reset').addEventListener('click', (e) => {
        if (e.target.dataset.confirm) {
          this.game.resetProgress();
        } else {
          e.target.dataset.confirm = '1';
          e.target.textContent = '再按一次确认清除';
        }
      });
    } else if (tab === 'keys') {
      body.innerHTML = `<div class="settings"><div class="keys">
        <h4>键盘与鼠标</h4>
        <div><kbd>W A S D</kbd> 行走（方向键亦可）</div>
        <div><kbd>Shift</kbd> 按住奔跑 · <kbd>C</kbd> 切换常跑</div>
        <div><kbd>空格</kbd> 跳跃</div>
        <div><kbd>E</kbd> 交谈 / 盖章 / 抚摸 / 坐下</div>
        <div>按住鼠标拖动 转动视角 · 滚轮 镜头远近</div>
        <div><kbd>M</kbd> 地图 · <kbd>B</kbd> 御朱印帐 · <kbd>P</kbd> 拍照模式</div>
        <div><kbd>T</kbd> 按住让时间加速 · <kbd>Esc</kbd> 菜单</div>
      </div><div class="keys">
        <h4>触屏与手柄</h4>
        <div>左下摇杆 行走（推到底即奔跑）</div>
        <div>右侧滑动 转动视角 · 双指 缩放</div>
        <div>右下按钮 跳跃 / 交互</div>
        <div>手柄：左摇杆移动 · 右摇杆视角 · A 跳 · X 交互 · Y 御朱印帐 · Back 地图 · RB 拍照</div>
        <h4 style="margin-top:16px">玩法</h4>
        <div>在小镇八处名所收集御朱印，找到七只猫，</div>
        <div>和镇上的人聊聊天，或者只是坐下来看花。</div>
      </div></div>`;
    } else {
      body.innerHTML = `<div class="notes">
        <h4>桜川町 · Sakuragawa</h4>
        <div>一座在春天里的小镇。河水带着花瓣流过石砌的护岸，电车穿过油菜花田，傍晚五点的钟声响起时，灯笼一盏一盏亮起来。</div>
        <div class="muted" style="margin-top:8px">地形、建筑、樱花、人物、天空与音乐，全部由代码在你的浏览器里实时生成；没有使用任何图片或音频素材。引擎：Three.js（WebGL2）。</div>
        <h4>致谢</h4>
        <div class="muted">俳句选自松尾芭蕉、小林一茶、良寛、大島蓼太（均为公有领域作品），中文译文为本作所作。</div>
      </div>`;
    }
  }
  // ---------------------------------------------------------------- 御神签
  fortune(f, done) {
    const el = this.el.fortune;
    el.innerHTML = `<div class="fortune-slip"><div class="head">桜川神社 · 御神籤</div><div class="rank">${f.rank}</div><div class="text">${f.text}</div><ul>${f.lines.map((l) => `<li>${l}</li>`).join('')}</ul><div class="ok"><button class="btn">收下</button></div></div>`;
    el.classList.remove('hidden');
    this.game.onPanel(true);
    this.open = 'fortune';
    const close = () => {
      el.classList.add('hidden');
      this.open = null;
      this.game.onPanel(false);
      if (done) done();
    };
    el.querySelector('.btn').addEventListener('click', close);
    el.addEventListener('click', (e) => {
      if (e.target === el) close();
    }, { once: true });
    this._fortuneClose = close;
  }
  // ---------------------------------------------------------------- 拍照
  photoMode(on, hours) {
    this.el.photo.classList.toggle('hidden', !on);
    this.el.hud.classList.toggle('hidden', on);
    this.el.touch.classList.toggle('hidden', on || !this.game.input.isTouch);
    if (on) {
      $('.p-time', this.el.photo).value = hours;
    }
  }
  photoTime(hours, str) {
    $('.p-tv', this.el.photo).textContent = str;
  }
  togglePhotoPanel() {
    this.el.photo.classList.toggle('hidden');
  }
  flash() {
    const f = this.el.flash;
    f.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
  }
  showPhoto(url) {
    const box = h('div', null);
    box.id = 'photoPreview';
    // 嵌入在框架里时浏览器会拦截下载链接：改为提示长按/右键保存
    let embedded = false;
    try {
      embedded = window.self !== window.top;
    } catch (e) {
      embedded = true;
    }
    box.innerHTML = `<img alt="照片"><div class="btns">${embedded ? '' : '<a class="btn" download="sakuragawa.png">保存照片</a>'}<button class="btn ghost">继续拍</button></div><div class="ph-hint">右键或长按图片即可保存</div>`;
    $('img', box).src = url;
    if (!embedded) $('a', box).href = url;
    $('button', box).addEventListener('click', () => box.remove());
    box.addEventListener('click', (e) => {
      if (e.target === box) box.remove();
    });
    this.root.appendChild(box);
  }
  // ---------------------------------------------------------------- 终章
  finale(lines, done) {
    const box = h('div', null);
    box.id = 'finale';
    box.innerHTML = `<div class="poem">${lines.map((l, i) => `<span style="animation-delay:${i * 1.2}s">${l || '&nbsp;'}</span>`).join('')}</div>`;
    this.root.appendChild(box);
    const close = () => {
      box.remove();
      if (done) done();
    };
    setTimeout(() => box.addEventListener('click', close), 1500);
    setTimeout(close, 1200 * lines.length + 6000);
  }
  // ---------------------------------------------------------------- 触屏
  setupTouch() {
    const joy = $('.joy', this.el.touch);
    const knob = $('i', joy);
    const input = this.game.input;
    let id = null;
    const set = (t) => {
      const r = joy.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const max = r.width / 2;
      const l = Math.hypot(dx, dy);
      if (l > max) {
        dx *= max / l;
        dy *= max / l;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      input.touchMove.x = dx / max;
      input.touchMove.y = -dy / max;
      input.touchMove.active = true;
    };
    joy.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      id = t.identifier;
      set(t);
      input.lastInput = 'touch';
      e.preventDefault();
    }, { passive: false });
    joy.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) if (t.identifier === id) set(t);
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches)
        if (t.identifier === id) {
          id = null;
          knob.style.transform = '';
          input.touchMove.x = input.touchMove.y = 0;
          input.touchMove.active = false;
        }
    };
    joy.addEventListener('touchend', end);
    joy.addEventListener('touchcancel', end);
    this.el.touch.querySelectorAll('[data-t]').forEach((b) => {
      const act = b.dataset.t;
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (act === 'run') {
          this.game.player.walkToggle = !this.game.player.walkToggle;
          b.classList.toggle('on', this.game.player.walkToggle);
        } else input.pressVirtual(act);
      }, { passive: false });
    });
  }
}
