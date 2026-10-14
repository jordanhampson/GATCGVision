// Background reader for Archive Table. Runs OpenCV card finding and card matching
// off the main thread so the page and video stay smooth.
importScripts('algo.js');

let lib = null, cvReady = false, cvLoading = false, api = '', index = '';
const elemKey = m => (m.elements || []).slice().sort().join('/') || 'NONE';
const costKey = m => m.cost && m.cost.type && m.cost.type !== 'none' ? `${m.cost.type}:${m.cost.value}` : 'none';

async function loadLib(){
  try{
    const [jr, br] = await Promise.all([fetch('library/library.json'), fetch('library/library.bin')]);
    if(!jr.ok || !br.ok) throw new Error('library files not found');
    const u = unpackLibrary(await jr.json(), await br.arrayBuffer());
    u.meta.forEach(m => { if(m.img && m.img[0] === '/') m.img = api + m.img; m.url = `${index}/card/${m.slug}`; });
    lib = { n: u.n, M: u.M, meta: u.meta, ek: u.meta.map(elemKey), ck: u.meta.map(costKey) };
    postMessage({ type: 'lib', n: u.n, unique: new Set(u.meta.map(m => m.slug)).size });
  }catch(e){
    postMessage({ type: 'lib', error: e.message || String(e) });
  }
}

async function loadCV(){
  if(cvReady || cvLoading) return; cvLoading = true;
  try{
    importScripts('https://docs.opencv.org/4.8.0/opencv.js');
    let c = self.cv;
    if(c && typeof c.then === 'function'){ c = await c; self.cv = c; }
    if(!(c && c.Mat)){
      await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('timed out')), 90000); self.cv.onRuntimeInitialized = () => { clearTimeout(to); res(); }; });
    }
    cvReady = true; postMessage({ type: 'cv', ok: true });
  }catch(e){
    cvLoading = false; postMessage({ type: 'cv', ok: false, error: e.message || String(e) });
  }
}

function detectQuads(buf, w, h){
  const cv = self.cv;
  const src = cv.matFromImageData(new ImageData(new Uint8ClampedArray(buf), w, h));
  const gray = new cv.Mat(), blur = new cv.Mat(), edges = new cv.Mat();
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U), contours = new cv.MatVector(), hier = new cv.Mat();
  const found = [];
  try{
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    cv.Canny(blur, edges, 30, 90);
    cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    cv.findContours(edges, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const minA = 0.008 * w * h, maxA = 0.5 * w * h;
    for(let i = 0; i < contours.size(); i++){
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if(area >= minA && area <= maxA){
        const hull = new cv.Mat(); cv.convexHull(c, hull, false, true);
        const peri = cv.arcLength(hull, true);
        for(const eps of [0.03, 0.05]){
          const ap = new cv.Mat(); cv.approxPolyDP(hull, ap, eps * peri, true);
          if(ap.rows === 4){
            const d = ap.data32S, pts = [[d[0], d[1]], [d[2], d[3]], [d[4], d[5]], [d[6], d[7]]];
            const q = orderQuad(pts), qw = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, qh = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
            const ratio = Math.min(qw, qh) / Math.max(qw, qh);
            if(ratio >= 0.55 && ratio <= 0.9) found.push({ q, area });
            ap.delete(); break;
          }
          ap.delete();
        }
        hull.delete();
      }
      c.delete();
    }
  }finally{
    [src, gray, blur, edges, kernel, contours, hier].forEach(m => m.delete());
  }
  found.sort((a, b) => b.area - a.area);
  const kept = [];
  for(const f of found){
    const cx = f.q.reduce((a, p) => a + p[0], 0) / 4, cy = f.q.reduce((a, p) => a + p[1], 0) / 4;
    if(kept.every(k => Math.hypot(cx - k.cx, cy - k.cy) > 0.25 * Math.sqrt(k.area))) kept.push({ ...f, cx, cy });
    if(kept.length >= 6) break;
  }
  return kept.map(k => k.q);
}

self.onmessage = async ev => {
  const m = ev.data;
  try{
    if(m.type === 'init'){ api = m.api; index = m.index; await loadLib(); if(m.loadCV) loadCV(); }
    else if(m.type === 'loadcv'){ loadCV(); }
    else if(m.type === 'detect'){
      postMessage({ type: 'result', id: m.id, quads: cvReady ? detectQuads(m.buf, m.w, m.h) : [] });
    }else if(m.type === 'recognize'){
      if(!lib){ postMessage({ type: 'result', id: m.id, res: null }); return; }
      const warped = warp({ width: m.w, height: m.h, data: new Uint8ClampedArray(m.buf) }, m.quad, 2);
      const r = recognize(warped, lib);
      postMessage({ type: 'result', id: m.id, res: r && {
        img: { width: r.img.width, height: r.img.height, data: r.img.data },
        list: r.list.map(x => ({ meta: x.meta, score: x.score, art: x.art, tl: x.tl, tr: x.tr })),
        element: r.element, cost: r.cost, candidates: r.candidates, mode: r.mode, flipped: r.flipped
      } });
    }
  }catch(e){
    postMessage({ type: 'result', id: m.id, res: null, quads: [], error: e.message || String(e) });
  }
};
