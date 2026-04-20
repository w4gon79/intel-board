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

  // Find intel items with "task force" or "Task Force" in title
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const items=await window.api.intel.getRecent(200);const tf=items.filter(i=>i.title&&i.title.toLowerCase().includes('task force'));return JSON.stringify(tf.map(i=>({id:i.id,title:i.title.substring(0,60),tier:i.tier,lat:i.latitude,lon:i.longitude,region:i.region})))})()",
    awaitPromise: true
  });
  console.log('TASK FORCE INTEL ITEMS:', r1.result?.result?.value);

  // Check map source for task force features
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const src=m.getSource('intel-items');const d=src._data;const tf=d.features.filter(f=>f.properties?.title?.toLowerCase().includes('task force'));return JSON.stringify(tf.map(f=>({title:f.properties?.title?.substring(0,60),coords:f.geometry?.coordinates})))})()",
    awaitPromise: true
  });
  console.log('MAP TASK FORCE FEATURES:', r2.result?.result?.value);

  c.close();
}
main().catch(console.error);
