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

  // Check icon-image value and if the image exists
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const iconImage=m.getLayoutProperty('vessels-military','icon-image');const hasImage=m.hasImage?.('vessel-military')||m.hasImage?.(iconImage);const style=m.getStyle();const sprite=style.sprite;return JSON.stringify({iconImage,hasImage,sprite})})()",
    awaitPromise: true
  });
  console.log('ICON CHECK:', r1.result?.result?.value);

  // Check if the original civilian vessel layers use the same icon approach
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const cargoIcon=m.getLayoutProperty('vessels-cargo','icon-image');const cargoType=m.getLayer('vessels-cargo')?.type;return JSON.stringify({cargoIcon,cargoType})})()",
    awaitPromise: true
  });
  console.log('CARGO VESSEL LAYER:', r2.result?.result?.value);

  // Check what images are loaded
  const r3 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const images=m.listImages?m.listImages():'no listImages';return JSON.stringify(images?.slice?.(0,20)||images)})()",
    awaitPromise: true
  });
  console.log('MAP IMAGES:', r3.result?.result?.value);

  c.close();
}
main().catch(console.error);
