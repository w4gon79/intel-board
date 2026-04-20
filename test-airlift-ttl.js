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

  // Check airlift intel item details
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const items=await window.api.intel.getRecent(50);const tf=items.filter(i=>i.title&&i.title.toLowerCase().includes('airlift'));return JSON.stringify(tf.map(i=>({title:i.title.substring(0,60),expires:i.expires_at,created:i.created_at,lat:i.latitude,lon:i.longitude})))})()",
    awaitPromise: true
  });
  console.log('AIRLIFT ITEMS:', r1.result?.result?.value);

  c.close();
}
main().catch(console.error);
