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

  // Check all APIs exist
  const r1 = await s('Runtime.evaluate', {
    expression: "JSON.stringify({tactical:Object.keys(window.api.tactical),intel:Object.keys(window.api.intel)})"
  });
  console.log('APIs:', r1.result?.result?.value);

  // Check map for any remaining markers in Baltic area
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const src=m.getSource('intel-items');const d=src._data;const baltic=d.features.filter(f=>{const c=f.geometry?.coordinates;return c&&c[0]>10&&c[0]<35&&c[1]>55&&c[1]<65});return JSON.stringify({total:d.features.length,nearBaltic:baltic.length,samples:baltic.slice(0,5).map(f=>({title:f.properties?.title?.substring(0,50),coords:f.geometry?.coordinates}))})})()",
    awaitPromise: true
  });
  console.log('MAP STATUS:', r2.result?.result?.value);

  c.close();
}
main().catch(console.error);
