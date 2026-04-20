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

  // Test 1: Map instance accessible?
  const r0 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;if(!m)return JSON.stringify({error:'no map'});return JSON.stringify({zoom:m.getZoom().toFixed(2),center:[m.getCenter().lng.toFixed(2),m.getCenter().lat.toFixed(2)]})})()",
    awaitPromise: true
  });
  console.log('MAP ACCESS:', r0.result?.result?.value);

  // Test 2: Military vessel source feature count and samples
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;if(!m)return 'no map';const milSrc=m.getSource('ais-vessels-military');if(!milSrc)return 'no military source';const d=milSrc._data;if(!d||!d.features)return 'no features';const taskForceMmsi=['211210280','219000184','219525000','205209000','219262000'];const tf=d.features.filter(f=>taskForceMmsi.includes(String(f.properties.mmsi)));return JSON.stringify({total:d.features.length,taskForceInSource:tf.length,taskForceSamples:tf.map(f=>({name:f.properties.ship_name,lat:f.geometry.coordinates[1].toFixed(2),lon:f.geometry.coordinates[0].toFixed(2),vcat:f.properties.vessel_category}))})})()",
    awaitPromise: true
  });
  console.log('MILITARY VESSEL SOURCE:', r1.result?.result?.value);

  // Test 3: Check flight military source for categories
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;if(!m)return 'no map';const fltSrc=m.getSource('adsb-flights-military');if(!fltSrc)return 'no flight military source';const d=fltSrc._data;if(!d||!d.features)return 'no features';return JSON.stringify({total:d.features.length,categories:d.features.slice(0,10).map(f=>({type:f.properties.aircraft_type,short:f.properties.aircraft_type_short,mcat:f.properties.military_category}))})})()",
    awaitPromise: true
  });
  console.log('FLIGHT MILITARY SOURCE:', r2.result?.result?.value);

  c.close();
}
main().catch(console.error);
