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

  // Check layer visibility and paint properties
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const layerIds=['vessels-military','vessels-military-labels'];const results={};for(const id of layerIds){const l=m.getLayer(id);if(!l){results[id]='NOT FOUND';continue}const vis=m.getLayoutProperty(id,'visibility');const paint=l.paint||{};const layout=l.layout||{};results[id]={visibility:vis,type:l.type,paintKeys:Object.keys(paint),layoutKeys:Object.keys(layout),filter:l.filter}}return JSON.stringify(results)})()",
    awaitPromise: true
  });
  console.log('VESSEL MILITARY LAYERS:', r1.result?.result?.value);

  // Check if the task force vessel features have the right geometry
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const src=m.getSource('vessels-military');const d=src._data;const tf=d.features.filter(f=>f.properties.ship_name==='GORCH FOCK');if(!tf.length)return 'GORCH FOCK not found';const f=tf[0];return JSON.stringify({type:f.type,geometry:f.geometry,properties:Object.keys(f.properties),is_military:f.properties.is_military,ship_type:f.properties.ship_type})})()",
    awaitPromise: true
  });
  console.log('GORCH FOCK FEATURE:', r2.result?.result?.value);

  // Check clustering - are these being clustered away?
  const r3 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const src=m.getSource('vessels-military');return JSON.stringify({cluster:src?.options?.cluster,clusterMaxZoom:src?.options?.clusterMaxZoom,clusterRadius:src?.options?.clusterRadius})})()",
    awaitPromise: true
  });
  console.log('CLUSTERING CONFIG:', r3.result?.result?.value);

  c.close();
}
main().catch(console.error);
