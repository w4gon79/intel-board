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

  // Check: do government vessels have is_military=true?
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const g=await window.api.ais.getGeoJSON();const gov=g.features.filter(f=>f.properties.ship_type==='government');const mil=g.features.filter(f=>f.properties.is_military===true);const govButNotMil=gov.filter(f=>!f.properties.is_military);return JSON.stringify({total:g.features.length,government:gov.length,military:mil.length,govNotMil:govButNotMil.length,samples:govButNotMil.slice(0,5).map(f=>({name:f.properties.ship_name,ismil:f.properties.is_military,ship_type:f.properties.ship_type}))})})()",
    awaitPromise: true
  });
  console.log('GOV vs MILITARY:', r1.result?.result?.value);

  c.close();
}
main().catch(console.error);
