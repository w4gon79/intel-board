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

  // Check if there's an intel delete API
  const r1 = await s('Runtime.evaluate', {
    expression: "JSON.stringify(Object.keys(window.api.intel || {}))"
  });
  console.log('INTEL API:', r1.result?.result?.value);

  // Try deleteEvents for all types to see if it cascades
  // First check if deleteEvents also clears intel items
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const count=await window.api.tactical.deleteEvents('task_force');return 'deleted '+count})()",
    awaitPromise: true
  });
  console.log('DELETE TACTICAL:', r2.result?.result?.value);

  // Check if intel items remain
  const r3 = await s('Runtime.evaluate', {
    expression: "(async()=>{const items=await window.api.intel.getRecent(200);const tf=items.filter(i=>i.title&&i.title.toLowerCase().includes('task force'));return JSON.stringify({count:tf.length,ids:tf.map(i=>i.id)})})()",
    awaitPromise: true
  });
  console.log('REMAINING INTEL:', r3.result?.result?.value);

  c.close();
}
main().catch(console.error);
