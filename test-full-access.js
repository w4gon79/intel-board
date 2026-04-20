const http = require('http');
const ws = require('ws');
async function main() {
  const pages = await new Promise(r => http.get('http://localhost:9222/json', res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d)));
  }));
  const pg = pages.find(x => x.title === 'Intel Board');
  if (!pg) { console.log('No Intel Board page'); return; }
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

  // 1. Map instance
  const r0 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;if(!m)return JSON.stringify({map:false});return JSON.stringify({map:true,zoom:m.getZoom().toFixed(2),center:[m.getCenter().lng.toFixed(2),m.getCenter().lat.toFixed(2)],projection:m.getProjection()?.name})})()",
    awaitPromise: true
  });
  console.log('MAP:', r0.result?.result?.value);

  // 2. All map sources
  const r1 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const style=m.getStyle();const srcInfo={};for(const[id,src]of Object.entries(style.sources)){if(id==='composite')continue;srcInfo[id]={type:src.type,features:src._data?.features?.length||'N/A'}}return JSON.stringify(srcInfo)})()",
    awaitPromise: true
  });
  console.log('SOURCES:', r1.result?.result?.value);

  // 3. All map layers
  const r2 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const style=m.getStyle();const custom=style.layers.filter(l=>!l.id.startsWith('land')&&!l.id.startsWith('water')&&!l.id.startsWith('road')&&!l.id.startsWith('bridge')&&!l.id.startsWith('tunnel')&&!l.id.startsWith('admin')&&!l.id.startsWith('settlement')&&!l.id.startsWith('natural')&&!l.id.startsWith('poi')&&!l.id.startsWith('aeroway')&&!l.id.startsWith('building')&&!l.id.startsWith('state')&&!l.id.startsWith('country')&&!l.id.startsWith('continent')&&!l.id.startsWith('airport')&&!l.id.startsWith('waterway')&&!l.id.startsWith('road-label')&&!l.id.startsWith('dot'));return JSON.stringify(custom.map(l=>({id:l.id,type:l.type,vis:m.getLayoutProperty(l.id,'visibility')})))})()",
    awaitPromise: true
  });
  console.log('CUSTOM LAYERS:', r2.result?.result?.value);

  // 4. Tactical events
  const r3 = await s('Runtime.evaluate', {
    expression: "(async()=>{try{const e=await window.api.tactical.getActiveEvents();return JSON.stringify({count:e.length,events:e.map(x=>({type:x.event_type,sev:x.severity,desc:x.description.substring(0,60)}))})}catch(e){return JSON.stringify({error:e.message})}})()",
    awaitPromise: true
  });
  console.log('TACTICAL:', r3.result?.result?.value);

  // 5. Military flight source details
  const r4 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const src=m.getSource('adsb-military');if(!src)return 'no source';const d=src._data;return JSON.stringify({count:d?.features?.length,samples:d?.features?.slice(0,5).map(f=>({short:f.properties.aircraft_type_short,mcat:f.properties.military_category}))})})()",
    awaitPromise: true
  });
  console.log('MIL FLIGHTS:', r4.result?.result?.value);

  // 6. Military vessel source details
  const r5 = await s('Runtime.evaluate', {
    expression: "(async()=>{const m=window.__map;const src=m.getSource('vessels-military');if(!src)return 'no source';const d=src._data;return JSON.stringify({count:d?.features?.length,samples:d?.features?.slice(0,5).map(f=>({name:f.properties.ship_name,vcat:f.properties.vessel_category}))})})()",
    awaitPromise: true
  });
  console.log('MIL VESSELS:', r5.result?.result?.value);

  // 7. AI settings
  const r6 = await s('Runtime.evaluate', {
    expression: "(async()=>{const s=await window.api.settings.get();return JSON.stringify(s.ai)})()",
    awaitPromise: true
  });
  console.log('AI CONFIG:', r6.result?.result?.value);

  // 8. Intel feed count
  const r7 = await s('Runtime.evaluate', {
    expression: "(async()=>{try{const items=await window.api.intel.getRecent(100);return JSON.stringify({total:items.length,tactical:items.filter(i=>i.categories&&JSON.stringify(i.categories).includes('tactical')).length})}catch(e){return JSON.stringify({error:e.message})}})()",
    awaitPromise: true
  });
  console.log('INTEL FEED:', r7.result?.result?.value);

  c.close();
}
main().catch(console.error);
