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

  // Check the HexDB data for the DRAGO13 aircraft (icao24: 3b7b82)
  // The tactical engine joins aircraft_registry on icao24 and checks icao_type_code
  // Let's see what the actual icao_type_code is
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{try{const geo=await window.api.adsb.getGeoJSON();const mil=geo.features.filter(f=>f.properties.is_military);const details=mil.map(f=>({icao24:f.properties.icao24,callsign:f.properties.callsign,aircraft_type:f.properties.aircraft_type,icao_type_code:f.properties.icao_type_code||'NOT_IN_GEOJSON',lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0]}));const nearConflict=details.filter(f=>f.lat>30&&f.lat<70&&f.lon>-10&&f.lon<50);return JSON.stringify(nearConflict)}catch(e){return JSON.stringify({error:e.message})}})()",
    awaitPromise: true
  });
  console.log('MILITARY NEAR CONFLICT ZONES:', r1.result?.result?.value);

  c.close();
}
main().catch(console.error);
