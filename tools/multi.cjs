// 用法: node multi.cjs <query> <prefix> <json-views>
// views: [{name, cam:[x,y,z], look:[x,y,z], t:hour, eval: "js"}]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const q = process.argv[2] || '';
  const prefix = process.argv[3] || 'shots/m';
  const views = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
  const w = parseInt(process.env.W || '960'), h = parseInt(process.env.H || '540');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(900000);
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.goto('http://localhost:5173/' + q + (q.includes('?') ? '&' : '?') + 'shot&freeze', { waitUntil: 'load' });
  try { await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 300000, polling: 500 }); } catch (e) { logs.push('[timeout] not ready'); }
  for (const v of views) {
    const t0 = Date.now();
    try {
      const data = await page.evaluate((v) => {
        const g = window.__game;
        if (v.t !== undefined) { g.daynight.setHours(v.t); g.daynight.apply(); }
        if (v.cam) { g.camera.position.set(...v.cam); g.camera.lookAt(...v.look); }
        if (v.eval) eval(v.eval);
        return window.__renderOnce(v.frames || 1);
      }, v);
      if (v.page) await page.screenshot({ path: `${prefix}-${v.name}.png`, timeout: 600000 });
      else fs.writeFileSync(`${prefix}-${v.name}.png`, Buffer.from(data.split(',')[1], 'base64'));
      console.log(v.name, ((Date.now() - t0) / 1000).toFixed(1) + 's');
    } catch (e) { console.log(v.name, 'ERR', e.message.slice(0, 500)); }
  }
  for (const l of logs) if (!l.includes('useProgram') && !l.includes('[debug]')) console.log(l.slice(0, 1500));
  await browser.close();
})();
