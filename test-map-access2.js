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

  // Expose map to window for CDP debugging
  const r0 = await s('Runtime.evaluate', {
    expression: "(async()=>{const el=document.querySelector('.mapboxgl-map');if(!el)return 'no element';const canvases=el.querySelectorAll('canvas');let map=null;for(const cv of canvases){map=cv.__map;break}if(!map){const fb=el.querySelector('.mapboxgl-canvas-container');if(fb)map=fb.__map}if(!map){return JSON.stringify({error:'map not on canvas or container',canvasCount:canvases.length})}window.__map=map;return JSON.stringify({zoom:map.getZoom().toFixed(2),center:[map.getCenter().lng.toFixed(2),map.getCenter().lat.toFixed(2)],bounds:map.getBounds()})})()",
    awaitPromise: true
  });
  console.log('MAP ACCESS:', r0.result?.result?.value);

  // If that worked, query sources
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{if(!window.__map)return 'no map exposed';const m=window.__map;const milSrc=m.getSource('ais-vessels-military');if(!milSrc)return 'no military source';const d=milSrc._data;if(!d||!d.features)return JSON.stringify({error:'no features in source'});return JSON.stringify({count:d.features.length,samples:d.features.slice(0,5).map(f=>({name:f.properties.ship_name,lat:f.geometry.coordinates[1].toFixed(2),lon:f.geometry.coordinates[0].toFixed(2),vcat:f.properties.vessel_category,ismil:f.properties.is_military}))})})()",
    awaitPromise: true
  });
  console.log('MILITARY VESSEL SOURCE:', r1.result?.result?.value);

  c.close();
}
main().catch(console.error);
