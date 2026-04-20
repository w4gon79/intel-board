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
    expression: '(async()=>{try{const e=await window.api.tactical.getActiveEvents();return JSON.stringify({count:e.length,e:e.slice(0,5)})}catch(e){return JSON.stringify({error:e.message})}})()',
    awaitPromise: true
  });
  console.log('TACTICAL:', r1.result?.result?.value);

  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const g=await window.api.adsb.getGeoJSON();const m=g.features.filter(f=>f.properties.is_military);return JSON.stringify({total:g.features.length,mil:m.length,s:m.slice(0,15).map(f=>({i:f.properties.icao24,cs:f.properties.callsign,t:f.properties.aircraft_type,la:f.geometry.coordinates[1],lo:f.geometry.coordinates[0],h:f.properties.heading}))})})()",
    awaitPromise: true
  });
  console.log('MIL FLIGHTS:', r2.result?.result?.value);

  const r3 = await s('Runtime.evaluate', {
    expression: "(async()=>{const g=await window.api.ais.getGeoJSON();const m=g.features.filter(f=>f.properties.ship_type==='government');return JSON.stringify({total:g.features.length,mil:m.length,s:m.slice(0,15).map(f=>({n:f.properties.ship_name,m:f.properties.mmsi,t:f.properties.ship_type,la:f.geometry.coordinates[1],lo:f.geometry.coordinates[0],h:f.properties.heading}))})})()",
    awaitPromise: true
  });
  console.log('MIL VESSELS:', r3.result?.result?.value);
  c.close();
}
main().catch(console.error);
