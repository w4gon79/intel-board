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

  // Full layer config
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const l=m.getLayer('vessels-military');return JSON.stringify({id:l.id,type:l.type,source:l.source,filter:l.filter,layout:l.layout,paint:l.paint})})()",
    awaitPromise: true
  });
  console.log('FULL LAYER CONFIG:', r1.result?.result?.value);

  // Also check the source options
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const src=m.getSource('vessels-military');return JSON.stringify({type:src.type,cluster:src.options?.cluster,data:typeof src._data,maxzoom:src.options?.maxzoom})})()",
    awaitPromise: true
  });
  console.log('SOURCE CONFIG:', r2.result?.result?.value);

  // Check: does queryRenderedFeatures find them at the map center?
  const r3 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const center=m.getCenter();const point=m.project(center);const features=m.queryRenderedFeatures(point,{layers:['vessels-military']});return JSON.stringify({centerPoint:[point.x.toFixed(0),point.y.toFixed(0)],featuresAtCenter:features.length})})()",
    awaitPromise: true
  });
  console.log('QUERY AT CENTER:', r3.result?.result?.value);

  // Query at GORCH FOCK location
  const r4 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const gf=m.project({lng:11.557,lat:57.333});const features=m.queryRenderedFeatures([gf.x,gf.y],{layers:['vessels-military','vessels-military-labels']});return JSON.stringify({gfPoint:[gf.x.toFixed(0),gf.y.toFixed(0)],featuresAtGF:features.length,zoom:m.getZoom().toFixed(2)})})()",
    awaitPromise: true
  });
  console.log('QUERY AT GORCH FOCK:', r4.result?.result?.value);

  c.close();
}
main().catch(console.error);
