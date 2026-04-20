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

  // Delete ALL tactical events (cascade should clean intel items too)
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const count=await window.api.tactical.deleteEvents();return 'deleted '+count})()",
    awaitPromise: true
  });
  console.log('DELETE ALL:', r1.result?.result?.value);

  // Also nuke any remaining tactical intel items by source
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const count=await window.api.intel.deleteByTitle('RC-135%');return 'rc135: '+count})()",
    awaitPromise: true
  });
  console.log('DELETE RC135:', r2.result?.result?.value);

  const r3 = await s('Runtime.evaluate', {
    expression: "(async()=>{const count=await window.api.intel.deleteByTitle('A400M%');return 'a400m: '+count})()",
    awaitPromise: true
  });
  console.log('DELETE A400M:', r3.result?.result?.value);

  const r4 = await s('Runtime.evaluate', {
    expression: "(async()=>{const count=await window.api.intel.deleteByTitle('Airlift%');return 'airlift: '+count})()",
    awaitPromise: true
  });
  console.log('DELETE AIRLIFT:', r4.result?.result?.value);

  // Wait for detection cycle
  console.log('Waiting 60s for new detection cycle...');
  await new Promise(r => setTimeout(r, 60000));

  // Check new events
  const r5 = await s('Runtime.evaluate', {
    expression: "(async()=>{const e=await window.api.tactical.getActiveEvents();return JSON.stringify({count:e.length,events:e.slice(0,5).map(x=>({type:x.event_type,lat:x.latitude,lon:x.longitude,desc:x.description.substring(0,50)}))})})()",
    awaitPromise: true
  });
  console.log('NEW EVENTS:', r5.result?.result?.value);

  c.close();
}
main().catch(console.error);
