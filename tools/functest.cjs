const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.setDefaultTimeout(900000);
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.goto('http://localhost:5173/?q=low&fresh&shot&play', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 300000, polling: 500 }); await page.evaluate(() => { window.__noRender = true; });
  const step = async (n, before) => page.evaluate(`(() => { { ${before || ''}; } for (let i = 0; i < ${n}; i++) window.__game.frame(1 / 30); const g = window.__game; return { pos: g.player.pos.toArray().map((v) => +v.toFixed(2)), mode: g.mode, pmode: g.player.mode, ui: g.ui.open, stamps: Object.keys(g.state.stamps), cats: Object.keys(g.state.cats), prompt: document.querySelector('.hud-prompt span').textContent, promptOff: document.querySelector('.hud-prompt').classList.contains('off') }; })()`);
  const r = [];
  // 1 walk forward
  r.push(['walk', await step(60, "window.__game.input.down.add('KeyW')")]);
  r.push(['stop', await step(10, "window.__game.input.down.delete('KeyW')")]);
  // 2 teleport to each stamp and interact
  const stamps = await page.evaluate(() => window.__game.world.ctx.interact.filter((i) => i.kind === 'stamp').map((i) => [i.stamp.id, i.x, i.z]));
  for (const [id, x, z] of stamps) {
    const res = await step(2, `const g=window.__game; g.ui.closePanel(true); g.player.spawn((${x}), (${z}), 0); const st=g.world.ctx.stamps.find(s=>s.id==='${id}'); g.player.yaw=Math.atan2(st.x-(${x}), st.z-(${z}));`);
    const res2 = await step(2, "window.__game.input.pressVirtual('interact')");
    r.push(['stamp ' + id, res.prompt, res.promptOff, res2.stamps.length, res2.ui]);
  }
  await step(30, "window.__game.ui.closePanel(true)");
  // 3 cats
  const cats = await page.evaluate(() => window.__game.cats.map((c) => [c.def.id, c.pos.x, c.pos.z]));
  for (const [id, x, z] of cats) {
    const res = await step(2, `const g=window.__game; g.ui.closePanel(true); g.player.mode='walk'; g.player.spawn((${x}) + 1.0, (${z}) + 0.4, 0); g.player.yaw=Math.atan2(-1.0,-0.4);`);
    const res2 = await step(3, "window.__game.input.pressVirtual('interact')");
    r.push(['cat ' + id, res.prompt, res.promptOff, res2.cats.length, res2.pmode]);
    await step(80);
  }
  // 4 NPC talk
  const npcs = await page.evaluate(() => window.__game.npcs.filter((n) => n.talkable).map((n) => [n.def.id, n.pos.x, n.pos.z]));
  for (const [id, x, z] of npcs) {
    const res = await step(2, `const g=window.__game; g.mode='play'; g.ui.el.dialog.classList.add('hidden'); g.player.mode='walk'; g.player.spawn((${x}) + 1.2, (${z}) + 0.6, 0); g.player.yaw=Math.atan2(-1.2,-0.6);`);
    const res2 = await step(3, "window.__game.input.pressVirtual('interact')");
    const txt = await page.evaluate(() => document.querySelector('.dl-name').textContent + ' | ' + document.querySelector('.dl-text').textContent);
    r.push(['npc ' + id, res.prompt, res2.mode, txt.slice(0, 40)]);
    await step(40, "for (let k=0;k<4;k++) window.__game.ui.advanceDialog();");
  }
  const st = await page.evaluate(() => ({ train: window.__game.world.train.state, s: window.__game.world.train.s.toFixed(1), finale: window.__game.state.finale, pending: window.__game.pendingFinale, kitten: window.__game.kitten.active }));
  r.push(['state', JSON.stringify(st)]);
  await page.evaluate(() => { window.__noRender = false; window.__game.frame(1/30); }); await page.screenshot({ path: 'shots/func-end.png', timeout: 600000 });
  for (const x of r) console.log(JSON.stringify(x));
  for (const l of logs) if (!l.includes('useProgram') && !l.includes('[debug]')) console.log(l.slice(0, 1500));
  await browser.close();
})();
