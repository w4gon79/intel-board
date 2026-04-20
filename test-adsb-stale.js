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

  // Check total flights vs military
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const g=await window.api.adsb.getGeoJSON();const mil=g.features.filter(f=>f.properties.is_military);return JSON.stringify({total:g.features.length,military:mil.length,milSamples:mil.slice(0,5).map(f=>({icao24:f.properties.icao24,cs:f.properties.callsign,type:f.properties.aircraft_type,lat:f.geometry.coordinates[1].toFixed(2),lon:f.geometry.coordinates[0].toFixed(2),ts:f.properties.timestamp}))})})()",
    awaitPromise: true
  });
  console.log('ADS-B DATA:', r1.result?.result?.value);

  // Check ADS-B source on map
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const mainSrc=m.getSource('adsb-flights');const milSrc=m.getSource('adsb-military');return JSON.stringify({mainFeatures:mainSrc._data?.features?.length,milFeatures:milSrc._data?.features?.length})})()",
    awaitPromise: true
  });
  console.log('MAP SOURCES:', r2.result?.result?.value);

  // Check timestamps - are they stale?
  const r3 = await s('Runtime.evaluate', {
    expression: "(async()=>{const g=await window.api.adsb.getGeoJSON();const now=new Date().toISOString();const timestamps=g.features.slice(0,10).map(f=>f.properties.timestamp);return JSON.stringify({now,timestamps})})()",
    awaitPromise: true
  });
  console.log('TIMESTAMPS:', r3.result?.result?.value);

  c.close();
}
main().catch(console.error);
