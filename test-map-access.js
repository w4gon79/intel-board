const http = require('http');
const ws = require('ws');
async function main() {
  const pages = await new Promise(r => http.get('http://localhost:9222/json', res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d)));
  }));
  const pg = pages.find(x => x.title === 'Intel Board');
  if (!pg) { console.log('No Intel Board'); return; }
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

  // Try different ways to access the map
  const r0 = await s('Runtime.evaluate', {
    expression: "(async()=>{const el=document.querySelector('.mapboxgl-map');return JSON.stringify({exists:!!el,hasMap:!!el?.__map,classes:el?.className})})()",
    awaitPromise: true
  });
  console.log('MAP ELEMENT:', r0.result?.result?.value);

  // Try getting map via window
  const r0b = await s('Runtime.evaluate', {
    expression: "(async()=>{const maps=window.document.querySelectorAll('.mapboxgl-map');const results=[];maps.forEach(m=>{results.push({cls:m.className,hasMap:!!m.__map,keys:m.__map?Object.keys(m.__map).slice(0,10):[]})});return JSON.stringify(results)})()",
    awaitPromise: true
  });
  console.log('ALL MAP ELEMENTS:', r0b.result?.result?.value);

  // Try mapboxgl.getMapById or similar
  const r0c = await s('Runtime.evaluate', {
    expression: "(async()=>{try{return JSON.stringify({mbgl:typeof mapboxgl,.getMap:typeof mapboxgl?.Map})}catch(e){return JSON.stringify({error:e.message})}})()",
    awaitPromise: true
  });
  console.log('MAPBOXGL:', r0c.result?.result?.value);

  c.close();
}
main().catch(console.error);
