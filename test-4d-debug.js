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

  // Check all properties on military flight features
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const g=await window.api.adsb.getGeoJSON();const mil=g.features.filter(f=>f.properties.is_military);if(!mil.length)return 'no military';return JSON.stringify(mil.slice(0,3).map(f=>({props:Object.keys(f.properties).sort()})))})()",
    awaitPromise: true
  });
  console.log('FLIGHT PROPS:', r1.result?.result?.value);

  // Check all properties on military vessel features
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const g=await window.api.ais.getGeoJSON();const mil=g.features.filter(f=>f.properties.ship_type==='government');if(!mil.length)return 'no gov vessels';return JSON.stringify(mil.slice(0,3).map(f=>({props:Object.keys(f.properties).sort()})))})()",
    awaitPromise: true
  });
  console.log('VESSEL PROPS:', r2.result?.result?.value);

  // Check if getShortType exists
  const r3 = await s('Runtime.evaluate', {
    expression: "(async()=>{try{return typeof getShortType}catch(e){return 'not global'}})()",
    awaitPromise: true
  });
  console.log('getShortType scope:', r3.result?.result?.value);

  // Check if tactical IPC is available
  const r4 = await s('Runtime.evaluate', {
    expression: "(async()=>{try{const r=await window.api.tactical.getActiveEvents();return 'tactical OK: '+r.length+' events'}catch(e){return 'tactical error: '+e.message}})()",
    awaitPromise: true
  });
  console.log('TACTICAL IPC:', r4.result?.result?.value);

  // Check console errors
  const r5 = await s('Runtime.evaluate', {
    expression: "(async()=>{const errors=[];const origErr=console.error;console.error=(...args)=>{errors.push(args.join(' '));origErr.apply(console,args)};await new Promise(r=>setTimeout(r,2000));console.error=origErr;return JSON.stringify(errors.slice(0,10))})()",
    awaitPromise: true
  });
  console.log('CONSOLE ERRORS (2s):', r5.result?.result?.value);

  c.close();
}
main().catch(console.error);
