// Background reader for Archive Table. Finds the card at a click, straightens it and matches it
// (perceptual hashes) off the main thread so the page and video stay smooth.
// No external downloads: the card finder is plain JavaScript in algo.js.
importScripts('algo.js');

let lib = null, api = '', index = '';
const bgs = new Map();   // tile id -> learned picture of the empty mat (optional helper for busy mats)
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

// Tries each candidate outline (snapped to the real card edges first, then as given) and keeps the best read.
function readBest(img, cands){
  let best = null;
  for(const c of cands){
    const snapped = refineByEdges(img, c.q, c.trusted ? { out: 0.03, inn: 0.09 } : undefined);
    for(const q of snapped ? [snapped, c.q] : [c.q]){
      const r = recognize(warp(img, portraitQuad(q), 2), lib);
      if(r && r.list.length && (!best || r.list[0].score > best.r.list[0].score)) best = { r, q };
      if(best && best.r.list[0].score >= 0.6) return best;
    }
  }
  return best;
}
const pack = best => best && {
  img: { width: best.r.img.width, height: best.r.img.height, data: best.r.img.data }, quad: best.q,
  list: best.r.list, element: best.r.element, cost: best.r.cost, candidates: best.r.candidates, mode: best.r.mode, flipped: best.r.flipped
};

self.onmessage = async ev => {
  const m = ev.data;
  try{
    if(m.type === 'init'){ api = m.api; index = m.index; postMessage({ type: 'cv', ok: true }); await loadLib(); }
    else if(m.type === 'bg-reset'){ bgs.set(m.tile, bgNew()); postMessage({ type: 'result', id: m.id }); }
    else if(m.type === 'bg-add'){
      const bg = bgs.get(m.tile) || bgNew(); bgs.set(m.tile, bg);
      postMessage({ type: 'result', id: m.id, ok: bgAdd(bg, { width: m.w, height: m.h, data: new Uint8ClampedArray(m.buf) }) });
    }else if(m.type === 'bg-done'){
      const bg = bgs.get(m.tile); postMessage({ type: 'result', id: m.id, ok: !!bg && bgDone(bg) });
    }else if(m.type === 'identify'){
      // A click: find the card outline under the point, show the box right away, then work out which card it is.
      if(!lib){ postMessage({ type: 'result', id: m.id, res: null, error: 'no library' }); return; }
      const img = { width: m.w, height: m.h, data: new Uint8ClampedArray(m.buf) }, cands = [], bg = bgs.get(m.tile);
      if(m.small && bg && bg.ready){            // outlines of what is new on the learned mat (robust on busy mats)
        const found = findCardsBg({ width: m.sw, height: m.sh, data: new Uint8ClampedArray(m.small) }, bg);
        const p = [(m.pt[0] + m.ox) * m.ss, (m.pt[1] + m.oy) * m.ss];
        for(const q of found.quads) if(pointInQuad(q, p, 2)) cands.push({ trusted: true, q: q.map(c => [c[0] / m.ss - m.ox, c[1] / m.ss - m.oy]) });
      }
      for(const q of candidatesAt(img, m.pt)){  // outlines found in the picture around the click
        const a = polyAreaOf(q);
        if(cands.every(o => o.q.some((c, k) => dist(c, q[k]) > 0.06 * Math.sqrt(a)))) cands.push({ trusted: false, q });
      }
      if(!cands.length){ postMessage({ type: 'result', id: m.id, res: null, noCard: true }); return; }
      postMessage({ type: 'box', id: m.id, quad: cands[0].q });
      const best = readBest(img, cands);
      // what was tried (shown in the browser console when localStorage archtbl_debug is set)
      const dbg = { bg: !!(bg && bg.ready && m.small), candidates: cands.map(c => ({ trusted: c.trusted, area: Math.round(polyAreaOf(c.q)) })), score: best ? +best.r.list[0].score.toFixed(2) : null, usedArea: best ? Math.round(polyAreaOf(best.q)) : null };
      postMessage({ type: 'result', id: m.id, res: pack(best), dbg });
    }else if(m.type === 'recognize'){
      // A hand-drawn box: find the real outline inside it, then read it.
      if(!lib){ postMessage({ type: 'result', id: m.id, res: null, error: 'no library' }); return; }
      const img = { width: m.w, height: m.h, data: new Uint8ClampedArray(m.buf) }, snapped = refineQuad(img, m.quad);
      let best = null;
      for(const q of snapped ? [snapped, m.quad] : [m.quad]){
        const r = recognize(warp(img, portraitQuad(q), 2), lib);
        if(r && r.list.length && (!best || r.list[0].score > best.r.list[0].score)) best = { r, q };
        if(best && best.r.list[0].score >= 0.6) break;
      }
      postMessage({ type: 'result', id: m.id, res: pack(best) });
    }
  }catch(e){
    postMessage({ type: 'result', id: m.id, res: null, error: e.message || String(e) });
  }
};
