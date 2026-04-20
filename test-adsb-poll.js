const http = require('http');
const ws = require('ws');
async function main() {
  const pages = await new Promise(r => http.get('http://localhost:9222/json', res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d)));
  }));
  const pg = pages.find(x => x.title === 'Intel Board');
  const c = new ws(pg.webSocketDebuggerUrl);
  let i = 1;
  const s = (m, p) => new Promise(r => {
    const id = i++;
    c.send(JSON.stringify({ id, method: m, params: p }));
    c.on('message', function h(d) {
      const msg = JSON.parse(d);
      if (msg.id === id) { c.removeListener('message', h); r(msg); }
    });
  });
  await new Promise(r => c.on('open', r));

  // Check flight timestamps - are they updating?
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const g=await window.api.adsb.getGeoJSON();const now=new Date().toISOString();const ts=g.features.slice(0,3).map(f=>f.properties.timestamp);return JSON.stringify({now,oldestTs:ts})})()",
    awaitPromise: true
  });
  console.log('CURRENT STATE:', r1.result?.result?.value);

  // Wait 35 seconds and check again (ADS-B polls every 30s)
  console.log('Waiting 35s for next poll cycle...');
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{await new Promise(r=>setTimeout(r,35000));const g=await window.api.adsb.getGeoJSON();const now=new Date().toISOString();const ts=g.features.slice(0,3).map(f=>f.properties.timestamp);return JSON.stringify({now,afterWait:ts,total:g.features.length})})()",
    awaitPromise: true
  });
  console.log('AFTER 35s:', r2.result?.result?.value);

  c.close();
}
main().catch(console.error);
