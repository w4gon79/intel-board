const http = require('http');
const ws = require('ws');
async function main() {
  const pages = await new Promise(r => http.get('http://localhost:9222/json', res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d)));
  }));
  const pg = pages.find(x => x.title === 'Intel Board');
  if (!pg) { console.log('No Intel Board page'); return; }
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
    expression: "(async()=>{try{const e=await window.api.tactical.getEvents();return JSON.stringify({count:e.length,events:e})}catch(e){return JSON.stringify({error:e.message})}})()",
    awaitPromise: true
  });
  console.log('ALL TACTICAL EVENTS:', r1.result?.result?.value);

  // Also check DRAGO13 specifically - is it in the aircraft_registry with a tanker type code?
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{try{const geo=await window.api.adsb.getGeoJSON();const dragos=geo.features.filter(f=>(f.properties.callsign||'').startsWith('DRAG'));return JSON.stringify(dragos.map(f=>({icao24:f.properties.icao24,cs:f.properties.callsign,type:f.properties.aircraft_type,lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0],hdg:f.properties.heading})))}catch(e){return JSON.stringify({error:e.message})}})()",
    awaitPromise: true
  });
  console.log('DRAGO FLIGHTS:', r2.result?.result?.value);

  c.close();
}
main().catch(console.error);
