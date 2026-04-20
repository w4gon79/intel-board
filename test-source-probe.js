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

  // Probe each source to find how data is stored
  const srcIds = ['vessels-geojson','vessels-military','adsb-flights','adsb-military','intel-items'];
  for (const id of srcIds) {
    const r = await s('Runtime.evaluate', {
      expression: `(async()=>{const m=window.__map;const src=m.getSource('${id}');if(!src)return 'not found';const keys=Object.getOwnPropertyNames(src).filter(k=>!k.startsWith('_')&&typeof src[k]!=='function');const protoKeys=Object.getOwnPropertyNames(Object.getPrototypeOf(src)).filter(k=>!k.startsWith('_')&&typeof src[k]!=='function');const hasData=!!src._data;const dataLen=src._data?.features?.length;const opts=JSON.stringify(src.options||src.settings||{}).substring(0,100);return JSON.stringify({hasData,dataLen,opts,keys:keys.slice(0,10),protoKeys})})()`,
      awaitPromise: true
    });
    console.log(`${id}:`, r.result?.result?.value);
  }

  c.close();
}
main().catch(console.error);
