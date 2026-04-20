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

  // Check flight GeoJSON for category and aircraft_type_short properties
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const g=await window.api.adsb.getGeoJSON();const mil=g.features.filter(f=>f.properties.is_military);return JSON.stringify(mil.slice(0,10).map(f=>({icao24:f.properties.icao24,type:f.properties.aircraft_type,category:f.properties.category,shortType:f.properties.aircraft_type_short})))})()",
    awaitPromise: true
  });
  console.log('FLIGHT CATEGORIES:', r1.result?.result?.value);

  // Check vessel GeoJSON for category properties
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const g=await window.api.ais.getGeoJSON();const mil=g.features.filter(f=>f.properties.is_military||f.properties.ship_type==='government');return JSON.stringify(mil.slice(0,10).map(f=>({name:f.properties.ship_name,type:f.properties.ship_type,category:f.properties.vessel_category||f.properties.category})))})()",
    awaitPromise: true
  });
  console.log('VESSEL CATEGORIES:', r2.result?.result?.value);

  // Check tactical events for formation data
  const r3 = await s('Runtime.evaluate', {
    expression: "(async()=>{const ev=await window.api.tactical.getActiveEvents();return JSON.stringify(ev.map(e=>({type:e.event_type,severity:e.severity,assets:e.assets,desc:e.description.substring(0,60)})))})()",
    awaitPromise: true
  });
  console.log('TACTICAL EVENTS:', r3.result?.result?.value);

  // Check map layers exist
  const r4 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=document.querySelector('.mapboxgl-map');if(!m)return JSON.stringify({error:'no map'});const style=m.__map?.getStyle();if(!style)return JSON.stringify({error:'no style'});const layers=style.layers.map(l=>l.id).filter(id=>id.includes('military')||id.includes('label')||id.includes('formation')||id.includes('task')||id.includes('pulse')||id.includes('hva'));return JSON.stringify(layers)})();",
    awaitPromise: true
  });
  console.log('NEW LAYERS:', r4.result?.result?.value);

  c.close();
}
main().catch(console.error);
