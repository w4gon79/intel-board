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

  // Check map zoom and center
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{try{const m=document.querySelector('.mapboxgl-map').__map;return JSON.stringify({zoom:m.getZoom().toFixed(2),center:m.getCenter(),bounds:m.getBounds()})}catch(e){return JSON.stringify({error:e.message})}})()",
    awaitPromise: true
  });
  console.log('MAP STATE:', r1.result?.result?.value);

  // Check how many features are in the map sources
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{try{const m=document.querySelector('.mapboxgl-map').__map;const flightMain=m.getSource('adsb-flights');const flightMil=m.getSource('adsb-flights-military');const shipMain=m.getSource('ais-vessels');const shipMil=m.getSource('ais-vessels-military');return JSON.stringify({flights_main:flightMain?._data?.features?.length||0,flights_mil:flightMil?._data?.features?.length||0,ships_main:shipMain?._data?.features?.length||0,ships_mil:shipMil?._data?.features?.length||0})}catch(e){return JSON.stringify({error:e.message})}})()",
    awaitPromise: true
  });
  console.log('RENDERED FEATURES:', r2.result?.result?.value);

  c.close();
}
main().catch(console.error);
