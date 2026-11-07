const { chromium } = require('playwright');
(async () => {
  const q = process.argv[2] || 'medium';
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.setDefaultTimeout(900000);
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.goto(`http://localhost:5173/?q=${q}&fresh&shot&play&timing`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 300000, polling: 500 });
  const res = await page.evaluate(() => {
    const g = window.__game;
    const out = {};
    const measure = (label) => {
      g.renderer.info.autoReset = false;
      g.renderer.info.reset();
      const t0 = performance.now();
      g.frame(1 / 30);
      const t1 = performance.now();
      const i = g.renderer.info;
      out[label] = { calls: i.render.calls, tris: i.render.triangles, ms: Math.round(t1 - t0), progs: i.programs.length, geos: i.memory.geometries, tex: i.memory.textures };
    };
    measure('spawn');
    g.player.spawn(80, 8, Math.PI / 2);
    g.frame(1 / 30);
    measure('street');
    g.player.spawn(-150, -140, 2.2);
    g.frame(1 / 30);
    measure('shrine');
    // JS-only timing (no render)
    window.__noRender = true;
    const t0 = performance.now();
    for (let k = 0; k < 60; k++) g.frame(1 / 60);
    out.jsFrameMs = ((performance.now() - t0) / 60).toFixed(2);
    window.__noRender = false;
    out.heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) + 'MB' : null;
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  for (const l of logs) if (!l.includes('useProgram') && !l.includes('[debug]')) console.log(l.slice(0, 600));
  await browser.close();
})();
