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

  // Check what's available on window.api.tactical
  const r1 = await s('Runtime.evaluate', {
    expression: "JSON.stringify(Object.keys(window.api.tactical || {}))"
  });
  console.log('TACTICAL API:', r1.result?.result?.value);

  // Check window.api.intel
  const r2 = await s('Runtime.evaluate', {
    expression: "JSON.stringify(Object.keys(window.api.intel || {}))"
  });
  console.log('INTEL API:', r2.result?.result?.value);

  c.close();
}
main().catch(console.error);
