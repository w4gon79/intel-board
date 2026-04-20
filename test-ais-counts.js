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

  // Check vessel GeoJSON from main process
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const g=await window.api.ais.getGeoJSON();return JSON.stringify({total:g.features.length})})()",
    awaitPromise: true
  });
  console.log('AIS GeoJSON:', r1.result?.result?.value);

  // Check vessel counts by category
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const c=await window.api.ais.getCountsByCategory();return JSON.stringify(c)})()",
    awaitPromise: true
  });
  console.log('AIS COUNTS:', r2.result?.result?.value);

  // Check vessel count IPC directly
  const r3 = await s('Runtime.evaluate', {
    expression: "(async()=>{const c=await window.api.ais.getVesselCount();return JSON.stringify({count:c})})()",
    awaitPromise: true
  });
  console.log('AIS TOTAL COUNT:', r3.result?.result?.value);

  // Check vessels-geojson source data
  const r4 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const src=m.getSource('vessels-geojson');return JSON.stringify({dataLen:src._data?.features?.length})})()",
    awaitPromise: true
  });
  console.log('VESSELS-GeoJSON SOURCE:', r4.result?.result?.value);

  c.close();
}
main().catch(console.error);
