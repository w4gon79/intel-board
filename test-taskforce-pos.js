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

  // Get tactical events with full details
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const e=await window.api.tactical.getActiveEvents();return JSON.stringify(e)})()",
    awaitPromise: true
  });
  console.log('TACTICAL EVENTS:', r1.result?.result?.value);

  // Get the actual positions of those three vessels
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const g=await window.api.ais.getGeoJSON();const names=['GORCH FOCK','MHV 804 ANDROMEDA','DANISH WARSHIP F360'];const v=g.features.filter(f=>names.includes(f.properties.ship_name));return JSON.stringify(v.map(f=>({name:f.properties.ship_name,mmsi:f.properties.mmsi,lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0],hdg:f.properties.heading})))})()",
    awaitPromise: true
  });
  console.log('VESSEL POSITIONS:', r2.result?.result?.value);

  // Check Baltic Sea zone definition
  const r3 = await s('Runtime.evaluate', {
    expression: "(async()=>{const zones=[{name:'Baltic Sea',lat:58,lon:20,radiusNm:400}];return JSON.stringify(zones)})()",
    awaitPromise: true
  });
  console.log('BALTIC ZONE:', r3.result?.result?.value);

  c.close();
}
main().catch(console.error);
