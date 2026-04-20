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

  // Capture ALL console output for 5 seconds
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const logs=[];const origLog=console.log;const origErr=console.error;const origWarn=console.warn;console.log=(...a)=>{logs.push(a.join(' ').substring(0,120));origLog(...a)};console.error=(...a)=>{logs.push('ERR:'+a.join(' ').substring(0,120));origErr(...a)};console.warn=(...a)=>{logs.push('WRN:'+a.join(' ').substring(0,120));origWarn(...a)};await new Promise(r=>setTimeout(r,5000));console.log=origLog;console.error=origErr;console.warn=origWarn;return JSON.stringify(logs)})()",
    awaitPromise: true
  });
  console.log('ALL LOGS (5s):', r1.result?.result?.value);

  c.close();
}
main().catch(console.error);
