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

  // Check AE4EBB and AE2678 on the map
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const src=m.getSource('adsb-military');const d=src._data;const targets=d.features.filter(f=>['ae4ebb','ae2678'].includes(f.properties.icao24));return JSON.stringify(targets.map(f=>({icao24:f.properties.icao24,type:f.properties.aircraft_type,short:f.properties.aircraft_type_short,mcat:f.properties.military_category})))})()",
    awaitPromise: true
  });
  console.log('MAP CATEGORIES:', r1.result?.result?.value);

  c.close();
}
main().catch(console.error);
