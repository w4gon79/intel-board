const http = require('http');
const ws = require('ws');
async function main() {
  const pages = await new Promise(r => http.get('http://localhost:9222/json', res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d)));
  }));
  // Use main process page
  const pg = pages[0];
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

  // Try to find available IPC methods
  const r1 = await s('Runtime.evaluate', {
    expression: "JSON.stringify(Object.keys(globalThis).filter(k=>k.toLowerCase().includes('db')||k.toLowerCase().includes('tactical')))"
  });
  console.log('GLOBALS:', r1.result?.result?.value);

  c.close();
}
main().catch(console.error);
