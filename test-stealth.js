const { chromium } = require('playwright');

(async () => {
  // Use system Chrome instead of Playwright's Chromium
  const browser = await chromium.launch({ 
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newPage();
  
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  
  const response = await page.goto('https://news.usni.org/2026/04/20/usni-news-fleet-and-marine-tracker-april-20-2026', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  
  console.log('Status:', response?.status());
  
  // Wait for Cloudflare challenge to resolve
  await page.waitForTimeout(8000);
  console.log('Title:', await page.title());
  console.log('URL:', page.url());
  
  const bodyText = await page.textContent('body');
  const csgMatches = bodyText?.match(/Carrier Strike Group \d+/gi);
  console.log('CSG mentions:', csgMatches);
  console.log('Content length:', bodyText?.length);
  
  await browser.close();
})();
