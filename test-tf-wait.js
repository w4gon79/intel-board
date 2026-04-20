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

  // Wait 30s for detection cycle
  console.log('Waiting 30s for detection cycle...');
  await new Promise(r => setTimeout(r, 30000));

  // Check for new task force events
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const e=await window.api.tactical.getActiveEvents();const tf=e.filter(x=>x.event_type==='task_force');return JSON.stringify({count:tf.length,events:tf.map(x=>({lat:x.latitude,lon:x.longitude,desc:x.description.substring(0,80)}))})})()",
    awaitPromise: true
  });
  console.log('TASK FORCE EVENTS:', r1.result?.result?.value);

  c.close();
}
main().catch(console.error);
