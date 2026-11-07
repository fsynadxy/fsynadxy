// 玩法回归（第一人称）：走路、八个御朱印、七只猫、所有镇民对话、视角切换、对话首句不被跳过
// 用法：先开 vite 开发服务器（5173），再 NODE_PATH=/opt/node-tools/node_modules node tools/functest.cjs
// 每个目标：重新读取位置 → 在附近找一个站得住的位置 → 视线对准 → 检查提示 → 按交互 → 等界面定时器触发后复位
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  page.setDefaultTimeout(900000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}\n${e.stack}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`[console.error] ${m.text()}`); });
  await page.goto('http://localhost:5173/?q=low&fresh&shot&play&t=10.5', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 300000, polling: 500 });
  await page.evaluate(() => {
    window.__noRender = true;
    const g = window.__game;
    if (!g.rig.firstPerson) g.setView('first', false);
    window.__step = (n) => { for (let i = 0; i < n; i++) g.frame(1 / 30); };
    window.__reset = () => {
      g.ui.closePanel(true);
      if (g.ui.dlg) { g.ui.dlg = null; g.ui.el.dialog.classList.add('hidden'); }
      const f = document.getElementById('fortune'); if (f) f.classList.add('hidden');
      g.mode = 'play'; g.player.mode = 'walk'; g.player.seat = null; g.rig.follow();
      window.__step(5);
    };
  });
  const settle = async () => { await page.waitForTimeout(2800); await page.evaluate(() => window.__reset()); };

  // 走路
  const walk = await page.evaluate(() => {
    const g = window.__game; const p0 = g.player.pos.clone();
    g.input.down.add('KeyW'); window.__step(60); g.input.down.delete('KeyW'); window.__step(10);
    return +p0.distanceTo(g.player.pos).toFixed(2);
  });
  console.log('walk distance', walk, walk > 3 ? 'OK' : 'FAIL');

  const tryTarget = (kind, id) => page.evaluate(([kind, id]) => {
    const g = window.__game, THREE = g.camera.position.constructor;
    const find = () => {
      if (kind === 'stamp') return g.interactables().find((q) => q.kind === 'stamp' && q.stamp.id === id);
      if (kind === 'cat') return g.interactables().find((q) => q.kind === 'cat' && q.cat.def.id === id);
      return g.interactables().find((q) => q.kind === 'npc' && q.npc.def.id === id);
    };
    const offs = [];
    for (const r of [1.1, 1.5, 0.7, 1.9]) for (let a = 0; a < 8; a++) offs.push([Math.cos(a * Math.PI / 4) * r, Math.sin(a * Math.PI / 4) * r]);
    for (const [ox, oz] of offs) {
      let it = find();
      g.player.mode = 'walk';
      g.player.spawn(it.x + ox, it.z + oz, 0);
      window.__step(2);
      if (Math.hypot(g.player.pos.x - it.x - ox, g.player.pos.z - it.z - oz) > 0.3) continue; // 站不住
      it = find();
      const P = g.aimPoint(it);
      g.rig.snap(g.focusPoint());
      const d = P.clone().sub(g.rig.eye);
      g.rig.yaw = Math.atan2(-d.x, -d.z);
      g.rig.fpPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      window.__step(2);
      const got = g.findInteract();
      const want = find();
      const same = got && got.kind === want.kind && (got.stamp || got.cat || got.npc) === (want.stamp || want.cat || want.npc);
      if (!same) continue;
      const prompt = document.querySelector('.hud-prompt span').textContent;
      g.input.pressVirtual('interact');
      window.__step(1);
      const typing = g.ui.dlg ? g.ui.dlg.typing : null;
      window.__step(3);
      let ok;
      if (kind === 'stamp') ok = !!g.state.stamps[id];
      else if (kind === 'cat') ok = !!g.state.cats[id];
      else ok = g.mode === 'dialog' && typing === true;
      return { id, ok, prompt, off: [+ox.toFixed(1), +oz.toFixed(1)] };
    }
    return { id, ok: false, reason: 'no spot / not targeted' };
  }, [kind, id]);

  const ids = await page.evaluate(() => ({
    stamps: window.__game.world.ctx.stamps.map((s) => s.id),
    cats: window.__game.cats.map((c) => c.def.id),
    npcs: window.__game.npcs.filter((n) => n.talkable).map((n) => n.def.id),
  }));
  const res = { stamp: [], cat: [], npc: [] };
  for (const id of ids.stamps) { res.stamp.push(await tryTarget('stamp', id)); await settle(); }
  for (const id of ids.cats) { res.cat.push(await tryTarget('cat', id)); await settle(); }
  for (const id of ids.npcs) { res.npc.push(await tryTarget('npc', id)); await settle(); }
  for (const k of ['stamp', 'cat', 'npc']) for (const r of res[k]) console.log(k.padEnd(5), r.ok ? 'OK  ' : 'FAIL', JSON.stringify(r));

  // 视角切换与第三人称交互仍可用
  const view = await page.evaluate(() => {
    const g = window.__game;
    g.setView('third', false); window.__step(5);
    const third = !g.rig.firstPerson && !g.player.ghost;
    g.setView('first', false); window.__step(5);
    return { third, first: g.rig.firstPerson && g.player.ghost };
  });
  console.log('view toggle', JSON.stringify(view));
  const st = await page.evaluate(() => ({ stamps: Object.keys(window.__game.state.stamps).length, cats: Object.keys(window.__game.state.cats).length, kitten: window.__game.kitten.active, finale: window.__game.state.finale }));
  const nOk = (a) => a.filter((r) => r.ok).length + '/' + a.length;
  console.log('SUMMARY stamps', nOk(res.stamp), 'cats', nOk(res.cat), 'npcs', nOk(res.npc), JSON.stringify(st));
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await browser.close();
})();
