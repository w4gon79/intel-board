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

  // Check task force vessel MMSIs
  const mmsiList = ['211210280','219000184','219525000','205209000','219262000'];
  
  const r1 = await s('Runtime.evaluate', {
    expression: `(async()=>{const g=await window.api.ais.getGeoJSON();const targets=g.features.filter(f=>${JSON.stringify(mmsiList)}.includes(String(f.properties.mmsi)));return JSON.stringify(targets.map(f=>({name:f.properties.ship_name,mmsi:f.properties.mmsi,type:f.properties.ship_type,lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0],is_mil:f.properties.is_military})))})()`,
    awaitPromise: true
  });
  console.log('TASK FORCE VESSELS IN GEOJSON:', r1.result?.result?.value);

  // Also check total military vessels visible
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const g=await window.api.ais.getGeoJSON();const mil=g.features.filter(f=>f.properties.ship_type==='government'||f.properties.is_military);return JSON.stringify({total:g.features.length,military:mil.length,nearBaltic:mil.filter(f=>f.geometry.coordinates[1]>50&&f.geometry.coordinates[1]<65&&f.geometry.coordinates[0]>5&&f.geometry.coordinates[0]<30).map(f=>({name:f.properties.ship_name,lat:f.geometry.coordinates[1].toFixed(2),lon:f.geometry.coordinates[0].toFixed(2)}))})})()",
    awaitPromise: true
  });
  console.log('BALTIC MILITARY VESSELS:', r2.result?.result?.value);

  c.close();
}
main().catch(console.error);
