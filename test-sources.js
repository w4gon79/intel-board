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

  // List all sources and layers
  const r0 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;if(!m)return 'no map';const style=m.getStyle();return JSON.stringify({sources:Object.keys(style.sources),layers:style.layers.map(l=>l.id)})})()",
    awaitPromise: true
  });
  console.log('ALL SOURCES & LAYERS:', r0.result?.result?.value);

  c.close();
}
main().catch(console.error);
