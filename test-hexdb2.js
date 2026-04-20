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

  // Use the adsb getDetails to check a specific flight's full data
  // First get the GeoJSON to find military flights near conflict zones
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{try{const g=await window.api.adsb.getGeoJSON();const near=g.features.filter(f=>f.properties.is_military&&f.properties.aircraft_type);const tankers=near.filter(f=>{const t=(f.properties.aircraft_type||'').toUpperCase();return t.includes('KC-')||t.includes('K135')||t.includes('K46')||t.includes('MRTT')||t.includes('767')||t.includes('TANKER')});return JSON.stringify(tankers.map(f=>({icao24:f.properties.icao24,cs:f.properties.callsign,type:f.properties.aircraft_type,lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0])))}catch(e){return JSON.stringify({error:e.message})}})()",
    awaitPromise: true
  });
  console.log('TANKER-LIKE FLIGHTS:', r1.result?.result?.value);

  c.close();
}
main().catch(console.error);
