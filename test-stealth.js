const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newPage();
  
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });
  
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  
  console.log('Navigating...');
  const response = await page.goto('https://news.usni.org/2026/04/20/usni-news-fleet-and-marine-tracker-april-20-2026', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  
  console.log('Status:', response?.status());
  console.log('URL:', page.url());
  
  // Wait a bit for any JS challenge
  await page.waitForTimeout(5000);
  console.log('After wait - URL:', page.url());
  console.log('After wait - Title:', await page.title());
  
  // Check if we got Cloudflare challenge page
  const bodyText = await page.textContent('body');
  if (bodyText?.includes('Checking your browser') || bodyText?.includes('cf-browser')) {
    console.log('CLOUDFLARE CHALLENGE DETECTED');
    // Wait longer for challenge to complete
    await page.waitForTimeout(10000);
    console.log('After challenge wait - URL:', page.url());
    console.log('After challenge wait - Title:', await page.title());
  }
  
  const csgMatches = bodyText?.match(/Carrier Strike Group \d+/gi);
  console.log('CSG mentions:', csgMatches);
  console.log('Content length:', bodyText?.length);
  
  await browser.close();
})();
