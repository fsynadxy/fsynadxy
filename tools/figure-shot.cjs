// 人物模型截图：node tools/figure-shot.cjs <输出前缀> <视角...>
// 视角可以是 full/face/upper/side/back，或 JSON：{"name":"x","pos":[..],"target":[..]}
// 需要先运行 vite 开发服务器（默认 5173 端口）；环境变量 Q 追加查询串，W/H 指定尺寸。
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const prefix = process.argv[2] || 'shots/fig';
  const views = process.argv.slice(3).length ? process.argv.slice(3) : ['full', 'face'];
  const w = parseInt(process.env.W || '900'), h = parseInt(process.env.H || '1100');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: process.env.DARK ? 'dark' : 'light' });
  page.setDefaultTimeout(900000);
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  const t0 = Date.now();
  await page.goto('http://localhost:5173/figure/?shot' + (process.env.Q ? '&' + process.env.Q : ''), { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => window.__ready, null, { timeout: 600000, polling: 300 });
  } catch (e) {
    logs.push('[timeout] not ready');
  }
  const info = await page.evaluate(() => window.__figure);
  console.log('ready', ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(info));
  for (const v of views) {
    const view = v.startsWith('{') ? JSON.parse(v) : v;
    const name = typeof view === 'string' ? view : view.name;
    const t1 = Date.now();
    try {
      const data = await page.evaluate((view) => window.__shot(view), view);
      // PAGE=1 时连同界面一起截图
      if (process.env.PAGE) await page.screenshot({ path: `${prefix}-${name}.png`, timeout: 600000 });
      else fs.writeFileSync(`${prefix}-${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
      console.log(name, ((Date.now() - t1) / 1000).toFixed(1) + 's');
    } catch (e) {
      console.log(name, 'ERR', e.message.slice(0, 400));
    }
  }
  for (const l of logs) if (!l.includes('[debug]')) console.log(l.slice(0, 1200));
  await browser.close();
})();
