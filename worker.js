// Background reader for Archive Table. Finds cards, straightens them and matches them
// (perceptual hashes) off the main thread so the page and video stay smooth.
// No external downloads: the card finder is plain JavaScript in algo.js.
importScripts('algo.js');

let lib = null, api = '', index = '';
const elemKey = m => (m.elements || []).slice().sort().join('/') || 'NONE';
const costKey = m => m.cost && m.cost.type && m.cost.type !== 'none' ? `${m.cost.type}:${m.cost.value}` : 'none';

async function loadLib(){
  try{
    const [jr, br] = await Promise.all([fetch('library/library.json'), fetch('library/library.bin')]);
    if(!jr.ok || !br.ok) throw new Error('library files not found (HTTP ' + jr.status + '/' + br.status + ')');
    const u = unpackLibrary(await jr.json(), await br.arrayBuffer());
    u.meta.forEach(m => { if(m.img && m.img[0] === '/') m.img = api + m.img; m.url = `${index}/card/${m.slug}`; });
    lib = { n: u.n, H: u.H, meta: u.meta, ek: u.meta.map(elemKey), ck: u.meta.map(costKey) };
    postMessage({ type: 'lib', n: u.n, unique: new Set(u.meta.map(m => m.slug)).size });
  }catch(e){
    postMessage({ type: 'lib', error: e.message || String(e) });
  }
}

self.onmessage = async ev => {
  const m = ev.data;
  try{
    if(m.type === 'init'){ api = m.api; index = m.index; postMessage({ type: 'cv', ok: true }); await loadLib(); }
    else if(m.type === 'detect'){
      // quads in the coordinates of the (small) frame that was sent
      postMessage({ type: 'result', id: m.id, quads: findCards({ width: m.w, height: m.h, data: new Uint8ClampedArray(m.buf) }) });
    }else if(m.type === 'recognize'){
      if(!lib){ postMessage({ type: 'result', id: m.id, res: null, error: 'no library' }); return; }
      const img = { width: m.w, height: m.h, data: new Uint8ClampedArray(m.buf) };
      const exact = refineQuad(img, m.quad) || m.quad;                 // snap the rough outline to the real card edges
      const r = recognize(warp(img, portraitQuad(exact), 2), lib);     // straighten, then perceptual-hash match
      postMessage({ type: 'result', id: m.id, res: r && {
        img: { width: r.img.width, height: r.img.height, data: r.img.data }, quad: exact,
        list: r.list, element: r.element, cost: r.cost, candidates: r.candidates, mode: r.mode, flipped: r.flipped
      } });
    }
  }catch(e){
    postMessage({ type: 'result', id: m.id, res: null, quads: [], error: e.message || String(e) });
  }
};
