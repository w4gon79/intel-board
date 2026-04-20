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

  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const e=await window.api.tactical.getActiveEvents();return JSON.stringify({count:e.length,sample:e.slice(0,3).map(x=>({type:x.event_type,lat:x.latitude,lon:x.longitude,desc:x.description.substring(0,60)}))})})()",
    awaitPromise: true
  });
  console.log('ACTIVE EVENTS:', r1.result?.result?.value);

  // Check map intel source
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const src=m.getSource('intel-items');const d=src._data;return JSON.stringify({count:d.features.length,first3:d.features.slice(0,3).map(f=>({title:f.properties?.title?.substring(0,40),coords:f.geometry?.coordinates}))})})()",
    awaitPromise: true
  });
  console.log('MAP:', r2.result?.result?.value);

  c.close();
}
main().catch(console.error);
