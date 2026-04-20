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

  // Find all C-17 flights and check their timestamps
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const g=await window.api.adsb.getGeoJSON();const c17=g.features.filter(f=>f.properties.aircraft_type&&f.properties.aircraft_type.includes('C-17'));const now=new Date().toISOString();return JSON.stringify({now,c17:c17.map(f=>({icao24:f.properties.icao24,cs:f.properties.callsign,type:f.properties.aircraft_type,lat:f.geometry.coordinates[1].toFixed(2),lon:f.geometry.coordinates[0].toFixed(2),alt:f.properties.altitude,vel:f.properties.velocity,ts:f.properties.timestamp}))})})()",
    awaitPromise: true
  });
  console.log('C-17 FLIGHTS:', r1.result?.result?.value);

  // Check how many flights have stale timestamps (older than 10 minutes)
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const g=await window.api.adsb.getGeoJSON();const now=new Date();const stale=new Date(now.getTime()-10*60*1000).toISOString();const allStale=g.features.filter(f=>f.properties.timestamp&&f.properties.timestamp<stale);const recent=g.features.filter(f=>f.properties.timestamp&&f.properties.timestamp>=stale);return JSON.stringify({total:g.features.length,recent:recent.length,stale:allStale.length,staleSample:allStale.slice(0,10).map(f=>({icao24:f.properties.icao24,cs:f.properties.callsign,type:f.properties.aircraft_type,ts:f.properties.timestamp}))})})()",
    awaitPromise: true
  });
  console.log('STALE ANALYSIS:', r2.result?.result?.value);

  // Check map military source directly
  const r3 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const src=m.getSource('adsb-military');const d=src._data;const now=new Date();const stale=new Date(now.getTime()-10*60*1000).toISOString();const staleMil=d.features.filter(f=>f.properties.timestamp&&f.properties.timestamp<stale);return JSON.stringify({milTotal:d.features.length,staleMil:staleMil.length,staleSamples:staleMil.slice(0,5).map(f=>({icao24:f.properties.icao24,cs:f.properties.callsign,type:f.properties.aircraft_type,ts:f.properties.timestamp,lat:f.geometry.coordinates[1].toFixed(2),lon:f.geometry.coordinates[0].toFixed(2)}))})})()",
    awaitPromise: true
  });
  console.log('MILITARY SOURCE STALE:', r3.result?.result?.value);

  c.close();
}
main().catch(console.error);
