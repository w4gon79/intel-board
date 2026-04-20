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

  // Check the MILITARY source specifically - what features does it have?
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=document.querySelector('.mapboxgl-map');if(!m||!m.__map)return 'no map';const src=m.__map.getSource('ais-vessels-military');if(!src)return 'no military source';const data=src._data;if(!data||!data.features)return 'no data';return JSON.stringify({count:data.features.length,samples:data.features.slice(0,5).map(f=>({name:f.properties.ship_name,mmsi:f.properties.mmsi,lat:f.geometry.coordinates[1].toFixed(2),lon:f.geometry.coordinates[0].toFixed(2),is_mil:f.properties.is_military,vessel_category:f.properties.vessel_category}))})})()",
    awaitPromise: true
  });
  console.log('MILITARY VESSEL SOURCE:', r1.result?.result?.value);

  c.close();
}
main().catch(console.error);
