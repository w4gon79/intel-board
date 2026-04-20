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

  // Check military vessel source
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const src=m.getSource('vessels-military');if(!src)return 'no source';const d=src._data;if(!d||!d.features)return 'no data';const tfMmsi=['211210280','219000184','219525000','205209000','219262000'];const tf=d.features.filter(f=>tfMmsi.includes(String(f.properties.mmsi)));return JSON.stringify({total:d.features.length,taskForceFound:tf.length,taskForce:tf.map(f=>({name:f.properties.ship_name,lat:f.geometry.coordinates[1].toFixed(2),lon:f.geometry.coordinates[0].toFixed(2),vcat:f.properties.vessel_category,ismil:f.properties.is_military}))})})()",
    awaitPromise: true
  });
  console.log('MILITARY VESSELS:', r1.result?.result?.value);

  // Check military flight source
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const src=m.getSource('adsb-military');if(!src)return 'no source';const d=src._data;if(!d||!d.features)return 'no data';return JSON.stringify({total:d.features.length,samples:d.features.slice(0,8).map(f=>({type:f.properties.aircraft_type,short:f.properties.aircraft_type_short,mcat:f.properties.military_category}))})})()",
    awaitPromise: true
  });
  console.log('MILITARY FLIGHTS:', r2.result?.result?.value);

  // Check formation/task force overlay layers
  const r3 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const srcs=['tactical-formations','tactical-task-forces','task-force-hull'];const results={};for(const id of srcs){const s=m.getSource(id);results[id]=s?{exists:true,features:s._data?.features?.length||0}:{exists:false}}return JSON.stringify(results)})()",
    awaitPromise: true
  });
  console.log('TACTICAL OVERLAY SOURCES:', r3.result?.result?.value);

  c.close();
}
main().catch(console.error);
