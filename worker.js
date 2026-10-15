// Background reader for Archive Table. Runs card isolation (OpenCV) and perceptual-hash matching
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
    lib = { n: u.n, H: u.H, meta: u.meta, ek: u.meta.map(elemKey), ck: u.meta.map(costKey) };
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

/* ---- 1. isolate the card from the background ---- */
const polyArea = q => { let s = 0; for(let i = 0; i < 4; i++){ const a = q[i], b = q[(i + 1) % 4]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };

// Contour -> four ordered corners, or null if it does not look like a card.
function cardQuad(cv, c, w, h){
  const area = cv.contourArea(c);
  if(area < 0.008 * w * h || area > 0.5 * w * h) return null;
  const hull = new cv.Mat(); cv.convexHull(c, hull, false, true);
  const peri = cv.arcLength(hull, true); let out = null;
  for(const eps of [0.02, 0.03, 0.05]){
    const ap = new cv.Mat(); cv.approxPolyDP(hull, ap, eps * peri, true);
    if(ap.rows === 4){
      const d = ap.data32S, q = orderQuad([[d[0], d[1]], [d[2], d[3]], [d[4], d[5]], [d[6], d[7]]]);
      ap.delete();
      const qw = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, qh = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
      const ratio = Math.min(qw, qh) / Math.max(qw, qh);          // a card is about 5:7 = 0.71
      if(ratio >= 0.55 && ratio <= 0.9 && area / polyArea(q) >= 0.8) out = { q, area };
      break;
    }
    ap.delete();
  }
  hull.delete();
  return out;
}

// Grayscale -> Gaussian blur -> threshold -> external contours -> 4-corner filter by area and aspect ratio.
function detectQuads(buf, w, h){
  const cv = self.cv, mats = [], mk = () => { const m = new cv.Mat(); mats.push(m); return m; };
  const src = cv.matFromImageData(new ImageData(new Uint8ClampedArray(buf), w, h)); mats.push(src);
  const found = [];
  try{
    const gray = mk(), blur = mk();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    const kernel = cv.Mat.ones(5, 5, cv.CV_8U); mats.push(kernel);
    const collect = bin => {
      const closed = mk();   // close small gaps so the card becomes one solid shape
      cv.morphologyEx(bin, closed, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
      const contours = new cv.MatVector(), hier = mk();
      cv.findContours(closed, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for(let i = 0; i < contours.size(); i++){ const c = contours.get(i); const r = cardQuad(cv, c, w, h); c.delete(); if(r) found.push(r); }
      contours.delete();
    };
    const th = mk(); cv.threshold(blur, th, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU); collect(th);   // card brighter than mat
    const inv = mk(); cv.bitwise_not(th, inv); collect(inv);                                           // card darker than mat
    const ad = mk(); cv.adaptiveThreshold(blur, ad, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 41, 6); collect(ad); // uneven light
    if(!found.length){                                                                                 // last resort: edges
      const ed = mk(); cv.Canny(blur, ed, 30, 90);
      cv.dilate(ed, ed, kernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue()); collect(ed);
    }
  }finally{
    mats.forEach(m => { try{ m.delete(); }catch(e){} });
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

/* ---- 2. correct the perspective: card corners -> upright CW x CH rectangle ---- */
function warpCard(buf, w, h, quad){
  if(!cvReady) return warp({ width: w, height: h, data: new Uint8ClampedArray(buf) }, quad, 2);   // plain-JS fallback
  const cv = self.cv, mats = [];
  try{
    const src = cv.matFromImageData(new ImageData(new Uint8ClampedArray(buf), w, h)); mats.push(src);
    const from = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flat()); mats.push(from);
    const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 2 * CW, 0, 2 * CW, 2 * CH, 0, 2 * CH]); mats.push(to);
    const M = cv.getPerspectiveTransform(from, to); mats.push(M);
    const big = new cv.Mat(), small = new cv.Mat(); mats.push(big, small);
    cv.warpPerspective(src, big, M, new cv.Size(2 * CW, 2 * CH), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
    cv.resize(big, small, new cv.Size(CW, CH), 0, 0, cv.INTER_AREA);   // average down: cleaner than sampling at 1x
    return { width: CW, height: CH, data: new Uint8ClampedArray(small.data) };
  }finally{
    mats.forEach(m => { try{ m.delete(); }catch(e){} });
  }
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
      const r = recognize(warpCard(m.buf, m.w, m.h, m.quad), lib);   // 3. perceptual-hash match
      postMessage({ type: 'result', id: m.id, res: r && {
        img: { width: r.img.width, height: r.img.height, data: r.img.data },
        list: r.list, element: r.element, cost: r.cost, candidates: r.candidates, mode: r.mode, flipped: r.flipped
      } });
    }
  }catch(e){
    postMessage({ type: 'result', id: m.id, res: null, quads: [], error: e.message || String(e) });
  }
};
