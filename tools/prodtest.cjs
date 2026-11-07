const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const logs = [];
  page.on('console', (m) => { logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('requestfailed', (r) => logs.push('[reqfail] ' + r.url() + ' ' + (r.failure() && r.failure().errorText)));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  // 模拟发布骨架：把页面片段包进完整文档
  await page.route('**/index.html*', async (route) => {
    const frag = require('fs').readFileSync(process.argv[2] + '/sakuragawa.html', 'utf8');
    await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${frag}</body></html>` });
  });
  await page.goto('http://localhost:5180/index.html?q=low&fresh', { waitUntil: 'load' });
  try { await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 120000, polling: 500 }); } catch (e) { console.log('TIMEOUT'); const lab = await page.evaluate(() => document.querySelector('.ld-label') && document.querySelector('.ld-label').textContent); console.log('label:', lab); console.log(logs.join('\n').slice(0, 3000)); await browser.close(); return; }
  const st = await page.evaluate(() => ({ mode: window.__game.mode, title: document.title, npcs: window.__game.npcs.length, cats: window.__game.cats.length }));
  console.log(JSON.stringify(st));
  console.log(logs.filter((l) => !l.includes('useProgram') && !l.includes('GPU stall')).slice(0, 10).join('\n'));
  await browser.close();
})();
