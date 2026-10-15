// Background reader for Archive Table. Finds cards, straightens them and matches them
// (perceptual hashes) off the main thread so the page and video stay smooth.
// No external downloads: the card finder is plain JavaScript in algo.js.
importScripts('algo.js');

let lib = null, api = '', index = '';
const bgs = new Map();   // tile id -> learned picture of the empty mat
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
    else if(m.type === 'bg-reset'){ bgs.set(m.tile, bgNew()); postMessage({ type: 'result', id: m.id }); }
    else if(m.type === 'bg-add'){
      const bg = bgs.get(m.tile) || bgNew(); bgs.set(m.tile, bg);
      const ok = bgAdd(bg, { width: m.w, height: m.h, data: new Uint8ClampedArray(m.buf) });
      postMessage({ type: 'result', id: m.id, ok });
    }else if(m.type === 'bg-done'){
      const bg = bgs.get(m.tile), ok = !!bg && bgDone(bg);
      let cards = [];
      if(ok){   // cards that were already lying on the mat are part of the learned picture: find them so they can be read too
        const rgba = new Uint8ClampedArray(bg.w * bg.h * 4);
        for(let i = 0; i < bg.w * bg.h; i++){ rgba[i * 4] = bg.mean[i * 3]; rgba[i * 4 + 1] = bg.mean[i * 3 + 1]; rgba[i * 4 + 2] = bg.mean[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
        cards = findCards({ width: bg.w, height: bg.h, data: rgba });
      }
      postMessage({ type: 'result', id: m.id, ok, cards });
    }else if(m.type === 'detect'){
      // With a learned mat only what is new on it is examined; otherwise the whole frame is searched.
      const img = { width: m.w, height: m.h, data: new Uint8ClampedArray(m.buf) }, bg = bgs.get(m.tile);
      if(bg && bg.ready){
        const r = findCardsBg(img, bg);
        postMessage({ type: 'result', id: m.id, quads: r.quads, frac: r.frac, mismatch: !!r.mismatch });
      }else postMessage({ type: 'result', id: m.id, quads: findCards(img), frac: 0 });
    }else if(m.type === 'recognize'){
      if(!lib){ postMessage({ type: 'result', id: m.id, res: null, error: 'no library' }); return; }
      const img = { width: m.w, height: m.h, data: new Uint8ClampedArray(m.buf) };
      // A quad that came from the learned mat is already close to the card: snap it to the real edges,
      // looking only a little outside it (so patterns on the mat are ignored). Otherwise re-find the card in the crop.
      const snapped = m.trusted ? refineByEdges(img, m.quad, { out: 0.03, inn: 0.09 }) : refineQuad(img, m.quad);
      // Try the snapped outline first, then the original one if that is not a confident match; keep the better read.
      let best = null;
      for(const q of snapped ? [snapped, m.quad] : [m.quad]){
        const r = recognize(warp(img, portraitQuad(q), 2), lib);
        if(r && r.list.length && (!best || r.list[0].score > best.r.list[0].score)) best = { r, q };
        if(best && best.r.list[0].score >= 0.6) break;
      }
      const r = best && best.r, exact = best ? best.q : m.quad;
      postMessage({ type: 'result', id: m.id, res: r && {
        img: { width: r.img.width, height: r.img.height, data: r.img.data }, quad: exact,
        list: r.list, element: r.element, cost: r.cost, candidates: r.candidates, mode: r.mode, flipped: r.flipped
      } });
    }
  }catch(e){
    postMessage({ type: 'result', id: m.id, res: null, quads: [], error: e.message || String(e) });
  }
};
