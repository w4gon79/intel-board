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

  // Check intel items with lat/lon
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const items=await window.api.intel.getRecent(50);const tactical=items.filter(i=>i.categories&&JSON.stringify(i.categories).includes('tactical'));return JSON.stringify(tactical.map(i=>({title:i.title.substring(0,60),tier:i.tier,lat:i.latitude,lon:i.longitude,region:i.region})))})()",
    awaitPromise: true
  });
  console.log('INTEL ITEMS:', r1.result?.result?.value);

  // Check tactical events with lat/lon
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const e=await window.api.tactical.getActiveEvents();return JSON.stringify(e.map(x=>({type:x.event_type,sev:x.severity,lat:x.latitude,lon:x.longitude,desc:x.description.substring(0,50)})))})()",
    awaitPromise: true
  });
  console.log('TACTICAL EVENTS:', r2.result?.result?.value);

  // Check intel-items source on map
  const r3 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const src=m.getSource('intel-items');if(!src)return 'no source';const d=src._data;return JSON.stringify({count:d?.features?.length,samples:d?.features?.slice(0,5).map(f=>({title:f.properties?.title?.substring(0,40),lat:f.geometry?.coordinates?.[1]?.toFixed(2),lon:f.geometry?.coordinates?.[0]?.toFixed(2)}))})})()",
    awaitPromise: true
  });
  console.log('INTEL MAP SOURCE:', r3.result?.result?.value);

  c.close();
}
main().catch(console.error);
