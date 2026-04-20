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

  // Get all airlift items with their IDs and expiry
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const items=await window.api.intel.getRecent(50);const tf=items.filter(i=>i.title&&i.title.toLowerCase().includes('airlift'));return JSON.stringify(tf.map(i=>({id:i.id,expires:i.expires_at,created:i.created_at})))})()",
    awaitPromise: true
  });
  console.log('AIRLIFT:', r1.result?.result?.value);

  // Delete the one with 24h expiry (expires tomorrow, not in 4h)
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const items=await window.api.intel.getRecent(50);const stale=items.filter(i=>i.title&&i.title.toLowerCase().includes('airlift')&&i.expires_at&&new Date(i.expires_at)>new Date(Date.now()+5*60*60*1000));if(stale.length===0)return 'none stale';const ids=stale.map(i=>i.id);const count=await window.api.intel.deleteByIds(ids);return 'deleted '+count+': '+JSON.stringify(ids)}})()",
    awaitPromise: true
  });
  console.log('CLEANUP:', r2.result?.result?.value);

  c.close();
}
main().catch(console.error);
