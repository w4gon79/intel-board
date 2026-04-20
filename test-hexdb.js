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

  // Check what the DRAGO aircraft has in aircraft_registry
  // Look up icao24 3b7b82 and also check all tankers
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{try{const r=await fetch('https://hexdb.io/api/v1/aircraft/3b7b82');const d=await r.json();return JSON.stringify({hex:'3b7b82',hexdb:d})}catch(e){return JSON.stringify({error:e.message})}})()",
    awaitPromise: true
  });
  console.log('DRAGO13 HEXDB:', r1.result?.result?.value);

  // Also check the Italian KC-767A at 41.26, 12.53
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{try{const r=await fetch('https://hexdb.io/api/v1/aircraft/33fe92');const d=await r.json();return JSON.stringify({hex:'33fe92',hexdb:d})}catch(e){return JSON.stringify({error:e.message})}})()",
    awaitPromise: true
  });
  console.log('ITALIAN KC767A HEXDB:', r2.result?.result?.value);

  // Check the French Phenix 243MRTT (A330 MRTT tanker)
  const r3 = await s('Runtime.evaluate', {
    expression: "(async()=>{try{const r=await fetch('https://hexdb.io/api/v1/aircraft/3b7565');const d=await r.json();return JSON.stringify({hex:'3b7565',hexdb:d})}catch(e){return JSON.stringify({error:e.message})}})()",
    awaitPromise: true
  });
  console.log('FRENCH MRTT HEXDB:', r3.result?.result?.value);

  c.close();
}
main().catch(console.error);
