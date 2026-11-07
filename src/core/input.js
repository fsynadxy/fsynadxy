// 统一输入：键盘、鼠标（拖动或指针锁定）、触屏（虚拟摇杆 + 拖动视角）、手柄
import { settings } from './settings.js';

const ACTIONS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  interact: ['KeyE', 'Enter'],
  map: ['KeyM'],
  book: ['KeyB', 'Tab'],
  photo: ['KeyP'],
  time: ['KeyT'],
  pause: ['Escape'],
  walkToggle: ['KeyC'],
  hide: ['KeyH'],
  view: ['KeyV'],
  lantern: ['KeyF'],
  zoomIn: ['Equal', 'NumpadAdd'],
  zoomOut: ['Minus', 'NumpadSubtract'],
  up: ['KeyQ'],
  down: ['KeyZ'],
};

export class Input {
  constructor(el) {
    this.el = el;
    this.down = new Set();
    this.pressed = new Set();
    this.look = { x: 0, y: 0 };
    this.wheel = 0;
    this.move = { x: 0, y: 0 };
    this.touchMove = { x: 0, y: 0, active: false };
    this.virtual = new Set(); // 触屏按钮按住
    this.virtualPressed = new Set();
    this.dragging = false;
    this.pointerLocked = false;
    this.enabled = true;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.lastInput = 'keyboard';
    this.gamepadIndex = null;
    this.gpPrev = {};
    this.bind();
  }
  bind() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      this.lastInput = 'keyboard';
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    const el = this.el;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('mousedown', (e) => {
      if (settings.pointerLock && !this.pointerLocked && this.enabled) {
        try {
          const p = el.requestPointerLock && el.requestPointerLock();
          if (p && p.catch) p.catch(() => {});
        } catch (err) {
          /* iframe 中可能不允许 */
        }
      }
      this.dragging = true;
      this.lastInput = 'mouse';
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked || this.dragging) {
        this.look.x += e.movementX;
        this.look.y += e.movementY;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === el;
    });
    el.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    // 触屏：右侧拖动转视角；左侧摇杆由 UI 层提供
    this.touches = new Map();
    el.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) this.touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      this.lastInput = 'touch';
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchmove', (e) => {
      // 只看落在画面上的手指：按住摇杆或按钮的那根手指不算（否则边走边转会被当成双指缩放）
      const pts = [...e.targetTouches];
      if (pts.length === 2) {
        const [a, b] = pts;
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (this.pinch) this.wheel += (this.pinch - d) * 0.02;
        this.pinch = d;
      } else this.pinch = null;
      for (const t of e.changedTouches) {
        const p = this.touches.get(t.identifier);
        if (!p) continue;
        if (pts.length < 2) {
          this.look.x += (t.clientX - p.x) * 1.4;
          this.look.y += (t.clientY - p.y) * 1.4;
        }
        p.x = t.clientX;
        p.y = t.clientY;
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) this.touches.delete(t.identifier);
      if (e.targetTouches.length < 2) this.pinch = null;
    };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
    });
  }
  // 触屏按钮
  pressVirtual(action) {
    this.virtualPressed.add(action);
  }
  holdVirtual(action, on) {
    if (on) this.virtual.add(action);
    else this.virtual.delete(action);
  }
  isDown(action) {
    if (this.virtual.has(action)) return true;
    const codes = ACTIONS[action];
    return codes ? codes.some((c) => this.down.has(c)) : false;
  }
  wasPressed(action) {
    if (this.virtualPressed.has(action)) return true;
    const codes = ACTIONS[action];
    return codes ? codes.some((c) => this.pressed.has(c)) : false;
  }
  pollGamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    let gp = this.gamepadIndex != null ? pads[this.gamepadIndex] : null;
    if (!gp) for (const p of pads) if (p) gp = p;
    if (!gp) return null;
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    const btn = (i) => gp.buttons[i] && gp.buttons[i].pressed;
    const res = {
      lx: dz(gp.axes[0] || 0), ly: dz(gp.axes[1] || 0), rx: dz(gp.axes[2] || 0), ry: dz(gp.axes[3] || 0),
      a: btn(0), b: btn(1), x: btn(2), y: btn(3), lb: btn(4), rb: btn(5), lt: btn(6), rt: btn(7), back: btn(8), start: btn(9), ls: btn(10), rs: btn(11),
    };
    const map = { a: 'jump', x: 'interact', y: 'book', back: 'map', start: 'pause', rb: 'photo', rs: 'view' };
    for (const k in map) {
      if (res[k] && !this.gpPrev[k]) this.virtualPressed.add(map[k]);
      this.gpPrev[k] = res[k];
    }
    if (res.ls || res.lt) this.virtual.add('run');
    else if (this.lastInput === 'gamepad') this.virtual.delete('run');
    if (res.lx || res.ly || res.rx || res.ry || res.a || res.x) this.lastInput = 'gamepad';
    return res;
  }
  // 每帧开头：汇总移动向量
  update() {
    const gp = this.pollGamepad();
    let x = 0, y = 0;
    if (this.enabled) {
      if (this.isDown('forward')) y += 1;
      if (this.isDown('back')) y -= 1;
      if (this.isDown('right')) x += 1;
      if (this.isDown('left')) x -= 1;
      if (this.touchMove.active) {
        x += this.touchMove.x;
        y += this.touchMove.y;
      }
      if (gp) {
        x += gp.lx;
        y -= gp.ly;
        this.look.x += gp.rx * 14;
        this.look.y += gp.ry * 10;
      }
    }
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    this.move.x = x;
    this.move.y = y;
    this.moveMag = Math.min(1, l);
  }
  // 每帧末尾：清空一次性输入
  endFrame() {
    this.pressed.clear();
    this.virtualPressed.clear();
    this.look.x = 0;
    this.look.y = 0;
    this.wheel = 0;
  }
  exitPointerLock() {
    if (this.pointerLocked && document.exitPointerLock) document.exitPointerLock();
  }
}
