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

  // Look up icao24 7020ab in the flights data
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const g=await window.api.adsb.getGeoJSON();const f=g.features.find(x=>x.properties.icao24==='7020ab');return f?JSON.stringify({icao24:f.properties.icao24,callsign:f.properties.callsign,type:f.properties.aircraft_type,is_mil:f.properties.is_military,lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0],country:f.properties.origin_country}):'NOT FOUND'})()",
    awaitPromise: true
  });
  console.log('FLIGHT DATA:', r1.result?.result?.value);

  c.close();
}
main().catch(console.error);
