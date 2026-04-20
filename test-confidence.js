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

  // Get intel items that are tactical (category contains 'tactical')
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{try{const items=await window.api.intel.getRecent(50);const tactical=items.filter(i=>i.categories&&JSON.stringify(i.categories).includes('tactical'));return JSON.stringify(tactical.slice(0,10).map(i=>({title:i.title,tier:i.tier,confidence:i.confidence,region:i.region,categories:i.categories})))}catch(e){return JSON.stringify({error:e.message})}})()",
    awaitPromise: true
  });
  console.log('TACTICAL INTEL ITEMS:', r1.result?.result?.value);

  c.close();
}
main().catch(console.error);
