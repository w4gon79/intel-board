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

  // Check conflict zones source
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const src=m.getSource('conflict-zones');if(!src)return 'no conflict-zones source';const d=src._data;return JSON.stringify({count:d?.features?.length,zones:d?.features?.map(f=>f.properties?.name)})})()",
    awaitPromise: true
  });
  console.log('CONFLICT ZONES:', r1.result?.result?.value);

  // Check regionToCoords for baltic
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const src=m.getSource('intel-items');if(!src)return 'no intel source';const d=src._data;return JSON.stringify({count:d?.features?.length,first3:d?.features?.slice(0,3).map(f=>({title:f.properties?.title?.substring(0,40),coords:f.geometry?.coordinates}))})})()",
    awaitPromise: true
  });
  console.log('INTEL SOURCE:', r2.result?.result?.value);

  c.close();
}
main().catch(console.error);
