const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(900000);
  const logs = [];
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto('http://localhost:5173/?q=low&fresh&shot', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 300000, polling: 500 });
  await page.evaluate(() => window.__renderOnce(2));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shots/phone-title.png', timeout: 600000 });
  await page.evaluate(() => { window.__game.startPlay(false, true); window.__game.ui.toast('<span class="mark">猫</span> 遇见了「三毛」（1/7）'); window.__renderOnce(3); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'shots/phone-hud.png', timeout: 600000 });
  console.log(logs.join('\n'));
  await browser.close();
})();
