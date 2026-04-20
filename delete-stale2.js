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

  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{try{const c=await window.api.intel.deleteByIds(['a19b23cc-0b9e-47d0-a43b-e7212494c2c5']);return 'result: '+JSON.stringify(c)}catch(e){return 'error: '+e.message}})()",
    awaitPromise: true
  });
  console.log('DELETE:', r1.result?.result?.value);

  c.close();
}
main().catch(console.error);
