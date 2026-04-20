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

  // Get recent intel items and check for non-Latin characters
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const items=await window.api.intel.getRecent(30);const nonEnglish=items.filter(i=>{const t=(i.title||'');const latin=(t.match(/[a-zA-Z\\s\\d.,!?;:'\"()\\-]/g)||[]).length/t.length;return latin<0.85});return JSON.stringify({total:items.length,nonEnglish:nonEnglish.length,samples:nonEnglish.slice(0,5).map(i=>({title:i.title,tier:i.tier,region:i.region}))})})()",
    awaitPromise: true
  });
  console.log('NON-ENGLISH ITEMS:', r1.result?.result?.value);

  c.close();
}
main().catch(console.error);
