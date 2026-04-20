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

  // Check if AIS is streaming by waiting 5s and checking count again
  console.log('Waiting 5s for AIS data...');
  await s('Runtime.evaluate', {
    expression: "(async()=>{await new Promise(r=>setTimeout(r,5000));const g=await window.api.ais.getGeoJSON();return JSON.stringify({after5s:g.features.length})})()",
    awaitPromise: true
  }).then(r => console.log('AFTER 5s:', r.result?.result?.value));

  c.close();
}
main().catch(console.error);
