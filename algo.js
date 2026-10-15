// Archive Table: card matching engine (perceptual hashing). Shared by the page, the worker
// and tools/build-library.mjs.
const CW = 200, CH = 280;
// Card layout regions as fractions of the card: [x0, y0, x1, y1]
const REG = { art: [0.07, 0.13, 0.93, 0.55], tl: [0.02, 0.015, 0.22, 0.115], tr: [0.78, 0.015, 0.98, 0.115], whole: [0.03, 0.03, 0.97, 0.97] };
// Perceptual hashes are taken of a 32x32 grid per region, keeping the 8x8 lowest DCT frequencies
// (63 bits = 2 words). Channels: 0 = brightness, 1 = red-green, 2 = blue-yellow. Colour hashes keep
// art that has the same light/dark layout but different colours apart.
const GRIDN = 32, KEEP = 8, SLOT_BITS = 63;
const SLOTS = [
  { key: 'artY', reg: 'art', ch: 0 }, { key: 'artU', reg: 'art', ch: 1 }, { key: 'artV', reg: 'art', ch: 2 },
  { key: 'tlY', reg: 'tl', ch: 0 },
  { key: 'trY', reg: 'tr', ch: 0 }, { key: 'trU', reg: 'tr', ch: 1 }, { key: 'trV', reg: 'tr', ch: 2 },
  { key: 'wholeY', reg: 'whole', ch: 0 }
];
const SLOT_AT = {}; SLOTS.forEach((s, i) => SLOT_AT[s.key] = i * 2);   // word offset of each slot
const NW = SLOTS.length * 2;                                         // 16 words = 64 bytes per card

// Three grids (brightness, red-green, blue-yellow) of one region.
function cells3(img, rect, dx, dy){
  const W = img.width, H = img.height, d = img.data, gw = GRIDN, gh = GRIDN;
  const x0 = (rect[0] + dx) * W, y0 = (rect[1] + dy) * H, x1 = (rect[2] + dx) * W, y1 = (rect[3] + dy) * H;
  const Y = new Float32Array(gw * gh), U = new Float32Array(gw * gh), V = new Float32Array(gw * gh);
  for(let cy = 0; cy < gh; cy++){
    const ya = Math.max(0, Math.min(H - 1, Math.floor(y0 + (y1 - y0) * cy / gh)));
    const yb = Math.min(H, Math.max(ya + 1, Math.ceil(y0 + (y1 - y0) * (cy + 1) / gh)));
    for(let cx = 0; cx < gw; cx++){
      const xa = Math.max(0, Math.min(W - 1, Math.floor(x0 + (x1 - x0) * cx / gw)));
      const xb = Math.min(W, Math.max(xa + 1, Math.ceil(x0 + (x1 - x0) * (cx + 1) / gw)));
      let r = 0, g = 0, b = 0, n = 0;
      for(let y = ya; y < yb; y++) for(let x = xa; x < xb; x++){ const p = (y * W + x) * 4; r += d[p]; g += d[p + 1]; b += d[p + 2]; n++; }
      n = n || 1; r /= n; g /= n; b /= n;
      const o = cy * gw + cx; Y[o] = 0.299 * r + 0.587 * g + 0.114 * b; U[o] = r - g; V[o] = b - (r + g) / 2;
    }
  }
  return [Y, U, V];
}
let COS = null;
function cosTable(){
  if(COS) return COS; COS = new Float32Array(KEEP * GRIDN);
  for(let u = 0; u < KEEP; u++) for(let x = 0; x < GRIDN; x++) COS[u * GRIDN + x] = Math.cos(Math.PI * (2 * x + 1) * u / (2 * GRIDN));
  return COS;
}
// Perceptual hash of one grid: 2D DCT, keep low frequencies, bit = coefficient above the median.
function hashGrid(g){
  const n = GRIDN, k = KEEP, C = cosTable(), T = new Float32Array(k * n), co = new Float32Array(k * k);
  for(let u = 0; u < k; u++) for(let x = 0; x < n; x++){ let s = 0; for(let y = 0; y < n; y++) s += C[u * n + y] * g[y * n + x]; T[u * n + x] = s; }
  for(let u = 0; u < k; u++) for(let v = 0; v < k; v++){ let s = 0; for(let x = 0; x < n; x++) s += T[u * n + x] * C[v * n + x]; co[u * k + v] = s; }
  const ac = Array.from(co.subarray(1)).sort((a, b) => a - b);
  const med = (ac[(ac.length - 1) >> 1] + ac[ac.length >> 1]) / 2;
  const words = new Uint32Array(2);
  for(let i = 1; i < k * k; i++) if(co[i] > med) words[i >> 5] |= (1 << (i & 31));
  return words;
}
// Hash every slot of a straightened CW x CH card (RGBA {width,height,data}); optional shift in card fractions.
function fingerprint(img, dx, dy, regs){
  dx = dx || 0; dy = dy || 0;
  const out = new Uint32Array(NW), grids = {};
  SLOTS.forEach((s, i) => { if(regs && regs.indexOf(s.reg) < 0) return; const g = grids[s.reg] || (grids[s.reg] = cells3(img, REG[s.reg], dx, dy)); out.set(hashGrid(g[s.ch]), i * 2); });
  return out;
}
function pop(x){ x = x - ((x >>> 1) & 0x55555555); x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return Math.imul((x + (x >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24; }
const hamSlot = (H, base, slot, q, qo) => pop((H[base + slot] ^ q[qo]) >>> 0) + pop((H[base + slot + 1] ^ q[qo + 1]) >>> 0);

function rot180(img){
  const n = img.width * img.height, out = new Uint8ClampedArray(n * 4), d = img.data;
  for(let i = 0; i < n; i++){ const j = n - 1 - i; out[i*4] = d[j*4]; out[i*4+1] = d[j*4+1]; out[i*4+2] = d[j*4+2]; out[i*4+3] = 255; }
  return { width: img.width, height: img.height, data: out };
}

// ---- perspective warp in plain JS (used when OpenCV is not available) ----
function gauss(A, b){
  const n = 8;
  for(let i = 0; i < n; i++){
    let p = i; for(let r = i + 1; r < n; r++) if(Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    const d = A[i][i] || 1e-12;
    for(let r = i + 1; r < n; r++){ const f = A[r][i] / d; for(let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  const x = new Array(n);
  for(let i = n - 1; i >= 0; i--){ let s = b[i]; for(let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / (A[i][i] || 1e-12); }
  return x;
}
function homography(dst, src){
  const A = [], b = [];
  for(let i = 0; i < 4; i++){
    const [x, y] = dst[i], [X, Y] = src[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
  }
  return gauss(A, b);
}
// quad order: TL, TR, BR, BL in src pixel coords. Output is a CW x CH upright card.
function warp(src, quad, ss){
  ss = ss || 2;
  const h = homography([[0, 0], [CW, 0], [CW, CH], [0, CH]], quad);
  const W = src.width, H = src.height, d = src.data, out = new Uint8ClampedArray(CW * CH * 4);
  const sample = (X, Y, acc) => {
    X = Math.max(0, Math.min(W - 1.001, X - 0.5)); Y = Math.max(0, Math.min(H - 1.001, Y - 0.5));
    const x0 = X | 0, y0 = Y | 0, fx = X - x0, fy = Y - y0, p = (y0 * W + x0) * 4, q = p + W * 4;
    for(let c = 0; c < 3; c++) acc[c] += (d[p + c] * (1 - fx) + d[p + 4 + c] * fx) * (1 - fy) + (d[q + c] * (1 - fx) + d[q + 4 + c] * fx) * fy;
  };
  const acc = [0, 0, 0];
  for(let v = 0; v < CH; v++) for(let u = 0; u < CW; u++){
    acc[0] = acc[1] = acc[2] = 0;
    for(let sy = 0; sy < ss; sy++) for(let sx = 0; sx < ss; sx++){
      const x = u + (sx + 0.5) / ss, y = v + (sy + 0.5) / ss, w = h[6] * x + h[7] * y + 1;
      sample((h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w, acc);
    }
    const o = (v * CW + u) * 4, k = ss * ss;
    out[o] = acc[0] / k; out[o + 1] = acc[1] / k; out[o + 2] = acc[2] / k; out[o + 3] = 255;
  }
  return { width: CW, height: CH, data: out };
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function orderQuad(pts){
  const s = pts.map(p => p[0] + p[1]), d = pts.map(p => p[1] - p[0]);
  const idx = a => a.indexOf(Math.min(...a)), idxMax = a => a.indexOf(Math.max(...a));
  return [pts[idx(s)], pts[idx(d)], pts[idxMax(s)], pts[idxMax(d)]]; // TL, TR, BR, BL
}
// Make the quad portrait: if it is wider than tall, rotate corner order by a quarter turn.
function portraitQuad(q){
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  return w > h ? [q[3], q[0], q[1], q[2]] : q;
}

// ---- card finder in plain JS: grayscale -> blur -> threshold / edges -> external contours -> four corners ----
function toGray(img){
  const n = img.width * img.height, g = new Float32Array(n), d = img.data;
  for(let i = 0; i < n; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return g;
}
function blur3(src, w, h){
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for(let y = 0; y < h; y++) for(let x = 0; x < w; x++){
    const o = y * w + x; tmp[o] = (src[o - (x > 0 ? 1 : 0)] + src[o] + src[o + (x < w - 1 ? 1 : 0)]) / 3;
  }
  for(let y = 0; y < h; y++) for(let x = 0; x < w; x++){
    const o = y * w + x; out[o] = (tmp[o - (y > 0 ? w : 0)] + tmp[o] + tmp[o + (y < h - 1 ? w : 0)]) / 3;
  }
  return out;
}
function otsu(g){
  const hist = new Float64Array(256); for(let i = 0; i < g.length; i++) hist[Math.max(0, Math.min(255, g[i] | 0))]++;
  let sum = 0; for(let i = 0; i < 256; i++) sum += i * hist[i];
  let wB = 0, sB = 0, best = 0, thr = 128; const total = g.length;
  for(let i = 0; i < 256; i++){
    wB += hist[i]; if(!wB) continue; const wF = total - wB; if(!wF) break;
    sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if(v > best){ best = v; thr = i; }
  }
  return thr;
}
function dilate3(m, w, h){
  const tmp = new Uint8Array(m.length), out = new Uint8Array(m.length);
  for(let y = 0; y < h; y++){ const r = y * w; for(let x = 0; x < w; x++){ const o = r + x; tmp[o] = m[o] | (x > 0 ? m[o - 1] : 0) | (x < w - 1 ? m[o + 1] : 0); } }
  for(let y = 0; y < h; y++){ const r = y * w; for(let x = 0; x < w; x++){ const o = r + x; out[o] = tmp[o] | (y > 0 ? tmp[o - w] : 0) | (y < h - 1 ? tmp[o + w] : 0); } }
  return out;
}
function erode3(m, w, h){
  const tmp = new Uint8Array(m.length), out = new Uint8Array(m.length);
  for(let y = 0; y < h; y++){ const r = y * w; for(let x = 1; x < w - 1; x++){ const o = r + x; tmp[o] = m[o] & m[o - 1] & m[o + 1]; } }
  for(let y = 1; y < h - 1; y++){ const r = y * w; for(let x = 0; x < w; x++){ const o = r + x; out[o] = tmp[o] & tmp[o - w] & tmp[o + w]; } }
  return out;
}
function hullOf(pts){
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for(const p of pts){ while(lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for(let i = pts.length - 1; i >= 0; i--){ const p = pts[i]; while(up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up);
}
const polyAreaOf = q => { let s = 0; for(let i = 0; i < q.length; i++){ const a = q[i], b = q[(i + 1) % q.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
function lineX(a, b, c, d){   // intersection of line a-b with line c-d
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if(Math.abs(den) < 1e-9) return null;
  const tt = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  return [a[0] + tt * r[0], a[1] + tt * r[1]];
}
// Reduce a convex polygon to 4 corners by repeatedly replacing the shortest side with the
// intersection of its two neighbours (keeps rounded card corners from being cut off).
function reduceTo4(poly){
  let P = poly.slice();
  while(P.length > 4){
    const n = P.length; let bi = -1, bA = Infinity, bp = null;
    for(let i = 0; i < n; i++){
      const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n], d = P[(i + 2) % n], X = lineX(a, b, d, c);
      if(!X) continue;
      if((X[0] - b[0]) * (b[0] - a[0]) + (X[1] - b[1]) * (b[1] - a[1]) <= 0) continue;
      if((X[0] - c[0]) * (c[0] - d[0]) + (X[1] - c[1]) * (c[1] - d[1]) <= 0) continue;
      const area = polyAreaOf([b, X, c]);
      if(area < bA){ bA = area; bi = i; bp = X; }
    }
    if(bi < 0){ // fall back: drop the vertex that changes the shape least
      let bv = 0, bt = Infinity;
      for(let i = 0; i < n; i++){ const t2 = polyAreaOf([P[(i - 1 + n) % n], P[i], P[(i + 1) % n]]); if(t2 < bt){ bt = t2; bv = i; } }
      P.splice(bv, 1); continue;
    }
    const j = (bi + 1) % n, next = [];
    for(let k = 0; k < n; k++){ if(k === bi) next.push(bp); else if(k !== j) next.push(P[k]); }
    P = next;
  }
  return P;
}
// Label connected blobs in a binary mask; keep the ones that are card-shaped.
function blobQuads(mask, w, h, minA, maxA, hollow){
  const out = [], lab = new Uint8Array(w * h), stack = new Int32Array(w * h), lst = new Int32Array(w * h);
  for(let x = 0; x < w; x++){ mask[x] = 0; mask[(h - 1) * w + x] = 0; }
  for(let y = 0; y < h; y++){ mask[y * w] = 0; mask[y * w + w - 1] = 0; }
  const nb = [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];
  for(let s = 0; s < w * h; s++){
    if(!mask[s] || lab[s]) continue;
    let sp = 0, cnt = 0, minx = w, maxx = 0, miny = h, maxy = 0; stack[sp++] = s; lab[s] = 1;
    while(sp){
      const p = stack[--sp]; lst[cnt++] = p;
      const x = p % w, y = (p / w) | 0;
      if(x < minx) minx = x; if(x > maxx) maxx = x; if(y < miny) miny = y; if(y > maxy) maxy = y;
      for(let k = 0; k < 8; k++){ const q = p + nb[k]; if(mask[q] && !lab[q]){ lab[q] = 1; stack[sp++] = q; } }
    }
    const bw = maxx - minx + 1, bh = maxy - miny + 1;
    if(bw * bh < minA || bw * bh > maxA * 1.6 || cnt < 30) continue;
    const bpts = [];
    for(let i = 0; i < cnt; i++){
      const p = lst[i], x = p % w, y = (p / w) | 0;
      if(x <= 1 || y <= 1 || x >= w - 2 || y >= h - 2 || !mask[p - 1] || !mask[p + 1] || !mask[p - w] || !mask[p + w]) bpts.push([x, y]);
    }
    if(bpts.length < 8) continue;
    const hull = hullOf(bpts); if(hull.length < 4) continue;
    const hA = polyAreaOf(hull); if(hA < minA || hA > maxA) continue;
    if(!hollow && cnt / hA < 0.6) continue;               // solid blobs must fill their hull
    const q = orderQuad(reduceTo4(hull)), qA = polyAreaOf(q);
    const qw = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, qh = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
    const ratio = Math.min(qw, qh) / Math.max(qw, qh);   // a card is about 5:7 = 0.71
    if(ratio < 0.55 || ratio > 0.92 || hA / qA < 0.85 || qA > maxA * 1.1) continue;
    out.push({ q, area: qA });
  }
  return out;
}
// Returns card outlines [[TL,TR,BR,BL], ...] in the coordinates of img (largest first).
function findCards(img, maxFrac){
  const w = img.width, h = img.height, minA = 0.008 * w * h, maxA = (maxFrac || 0.5) * w * h;
  const g = blur3(toGray(img), w, h), n = w * h, found = [];
  // (a) thresholds: card brighter than the mat, then darker
  const thr = otsu(g), bright = new Uint8Array(n), dark = new Uint8Array(n);
  for(let i = 0; i < n; i++){ bright[i] = g[i] > thr ? 1 : 0; dark[i] = g[i] <= thr ? 1 : 0; }
  for(const m of [bright, dark]) found.push(...blobQuads(erode3(dilate3(m, w, h), w, h), w, h, minA, maxA, false));
  // (b) strong edges, thickened: the outside of the edge blob is the card outline
  const mag = new Float32Array(n); let sum = 0, sq = 0;
  for(let y = 1; y < h - 1; y++) for(let x = 1; x < w - 1; x++){
    const o = y * w + x;
    const gx = g[o - w + 1] + 2 * g[o + 1] + g[o + w + 1] - g[o - w - 1] - 2 * g[o - 1] - g[o + w - 1];
    const gy = g[o + w - 1] + 2 * g[o + w] + g[o + w + 1] - g[o - w - 1] - 2 * g[o - w] - g[o - w + 1];
    const v = Math.abs(gx) + Math.abs(gy); mag[o] = v; sum += v; sq += v * v;
  }
  const mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean)), et = Math.max(40, mean + 0.8 * sd);
  const edge = new Uint8Array(n); for(let i = 0; i < n; i++) edge[i] = mag[i] > et ? 1 : 0;
  found.push(...blobQuads(dilate3(edge, w, h), w, h, minA, maxA, true));
  return nmsQuads(found);
}
function nmsQuads(found){
  found.sort((a, b) => b.area - a.area);
  const kept = [];
  for(const f of found){
    const cx = f.q.reduce((a, p) => a + p[0], 0) / 4, cy = f.q.reduce((a, p) => a + p[1], 0) / 4;
    if(kept.every(k => Math.hypot(cx - k.cx, cy - k.cy) > 0.25 * Math.sqrt(k.area))) kept.push({ ...f, cx, cy });
    if(kept.length >= 6) break;
  }
  return kept.map(k => k.q);
}

// ---- background model: learn the empty mat once, then only look at what is new ----
function bgNew(){ return { n: 0, w: 0, h: 0, sum: null, mean: null, last: null, T: 30, ready: false }; }
function bgAdd(bg, img){
  if(bg.n === 0){ bg.w = img.width; bg.h = img.height; bg.sum = new Float32Array(img.width * img.height * 3); }
  else if(img.width !== bg.w || img.height !== bg.h) return false;
  const n = img.width * img.height, d = img.data, s = bg.sum;
  for(let i = 0; i < n; i++){ s[i * 3] += d[i * 4]; s[i * 3 + 1] += d[i * 4 + 1]; s[i * 3 + 2] += d[i * 4 + 2]; }
  bg.n++; bg.last = img; return true;
}
// Differences from the learned mat, with the overall brightness shift (auto exposure) removed.
function diffAgainst(img, bg, step){
  const n = img.width * img.height, d = img.data, m = bg.mean, hist = [new Int32Array(511), new Int32Array(511), new Int32Array(511)];
  let cnt = 0;
  for(let i = 0; i < n; i += step){ cnt++; for(let c = 0; c < 3; c++){ const v = Math.max(-255, Math.min(255, Math.round(d[i * 4 + c] - m[i * 3 + c]))); hist[c][v + 255]++; } }
  const off = [0, 0, 0];
  for(let c = 0; c < 3; c++){ let acc = 0; for(let b = 0; b < 511; b++){ acc += hist[c][b]; if(acc >= cnt / 2){ off[c] = b - 255; break; } } }
  return off;
}
function bgDone(bg){
  if(bg.n < 2) return false;
  const n = bg.w * bg.h; bg.mean = new Float32Array(n * 3);
  for(let i = 0; i < n * 3; i++) bg.mean[i] = bg.sum[i] / bg.n;
  // noise level: how far a real frame of the empty mat strays from the average
  const off = diffAgainst(bg.last, bg, 3), s = [], d = bg.last.data;
  for(let i = 0; i < n; i += 3){
    let v = 0; for(let c = 0; c < 3; c++) v = Math.max(v, Math.abs(d[i * 4 + c] - bg.mean[i * 3 + c] - off[c])); s.push(v);
  }
  s.sort((a, b) => a - b); const sigma = s[s.length >> 1] / 0.6745;
  bg.T = Math.min(60, Math.max(24, 5 * sigma)); bg.ready = true; bg.sum = null; bg.last = null; return true;
}
// Card outlines from what differs from the learned mat. Also returns the fraction of the frame that changed.
function findCardsBg(img, bg){
  const w = img.width, h = img.height, n = w * h, d = img.data, m = bg.mean;
  if(!bg.ready || w !== bg.w || h !== bg.h) return { quads: [], frac: 0, mismatch: true };
  const off = diffAgainst(img, bg, 3);
  let mask = new Uint8Array(n), cnt = 0;
  for(let i = 0; i < n; i++){
    const a = Math.abs(d[i * 4] - m[i * 3] - off[0]), b = Math.abs(d[i * 4 + 1] - m[i * 3 + 1] - off[1]), c = Math.abs(d[i * 4 + 2] - m[i * 3 + 2] - off[2]);
    if(a > bg.T || b > bg.T || c > bg.T){ mask[i] = 1; cnt++; }
  }
  const frac = cnt / n;
  if(frac < 0.002) return { quads: [], frac };                        // nothing new on the mat: done, almost free
  mask = dilate3(erode3(mask, w, h), w, h);                           // drop speckle
  mask = erode3(erode3(dilate3(dilate3(mask, w, h), w, h), w, h), w, h); // fill gaps so a card is one blob
  return { quads: nmsQuads(blobQuads(mask, w, h, 0.008 * w * h, 0.5 * w * h, true)), frac };
}
// Average-downscale an RGBA image to the given width.
function downscale(img, W){
  if(img.width <= W) return { img, s: 1 };
  const s = W / img.width, H = Math.max(1, Math.round(img.height * s)), out = new Uint8ClampedArray(W * H * 4), d = img.data;
  for(let y = 0; y < H; y++){
    const ya = Math.floor(y / s), yb = Math.min(img.height, Math.max(ya + 1, Math.floor((y + 1) / s)));
    for(let x = 0; x < W; x++){
      const xa = Math.floor(x / s), xb = Math.min(img.width, Math.max(xa + 1, Math.floor((x + 1) / s)));
      let r = 0, gg = 0, b = 0, c = 0;
      for(let yy = ya; yy < yb; yy++) for(let xx = xa; xx < xb; xx++){ const p = (yy * img.width + xx) * 4; r += d[p]; gg += d[p + 1]; b += d[p + 2]; c++; }
      const o = (y * W + x) * 4; out[o] = r / c; out[o + 1] = gg / c; out[o + 2] = b / c; out[o + 3] = 255;
    }
  }
  return { img: { width: W, height: H, data: out }, s };
}
// Snap a rough quad to the real card edges: along each side, look for the outermost strong edge
// perpendicular to the side, fit a straight line to those points, and intersect neighbouring lines.
// opts.out / opts.inn: how far (as a fraction of the card's short side) to look outside / inside the rough outline.
function refineByEdges(img, q, opts){
  const w = img.width, h = img.height, g = blur3(toGray(img), w, h);
  const at = (x, y) => {
    x = Math.max(0, Math.min(w - 1.001, x)); y = Math.max(0, Math.min(h - 1.001, y));
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, o = y0 * w + x0;
    return (g[o] * (1 - fx) + g[o + 1] * fx) * (1 - fy) + (g[o + w] * (1 - fx) + g[o + w + 1] * fx) * fy;
  };
  const cx = q.reduce((a, p) => a + p[0], 0) / 4, cy = q.reduce((a, p) => a + p[1], 0) / 4;
  const side = Math.min(dist(q[0], q[1]), dist(q[1], q[2]), dist(q[2], q[3]), dist(q[3], q[0]));
  const outW = Math.max(3, (opts && opts.out != null ? opts.out : 0.09) * side), inW = Math.max(4, (opts && opts.inn != null ? opts.inn : 0.09) * side), step = 0.5, lines = [];
  for(let e = 0; e < 4; e++){
    const a = q[e], b = q[(e + 1) % 4], len = dist(a, b); if(len < 10) return null;
    let nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    if(nx * ((a[0] + b[0]) / 2 - cx) + ny * ((a[1] + b[1]) / 2 - cy) < 0){ nx = -nx; ny = -ny; }   // point outward
    let pts = [];
    const ns = Math.round((outW + inW) / step) + 1, prof = new Float32Array(ns);
    for(let i = 0; i < 30; i++){
      const t = 0.12 + 0.76 * i / 29, px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
      for(let k = 0; k < ns; k++){ const s = -inW + k * step; prof[k] = at(px + nx * s, py + ny * s); }
      let mx = 0; const gr = new Float32Array(ns);
      for(let k = 2; k < ns - 2; k++){ gr[k] = Math.abs(prof[k + 2] - prof[k - 2]); if(gr[k] > mx) mx = gr[k]; }
      if(mx < 14) continue;
      const need = Math.max(12, 0.18 * mx);   // black card borders have a weak outer and a strong inner edge
      let pick = -1; for(let k = ns - 3; k >= 2; k--) if(gr[k] >= need){ pick = k; break; }   // outermost clear edge
      if(pick < 0) continue;
      let pk = pick; for(let k = Math.max(2, pick - 4); k < pick; k++) if(gr[k] > gr[pk]) pk = k;   // centre of that edge
      const s = -inW + pk * step; pts.push([px + nx * s, py + ny * s]);
    }
    if(pts.length < 10) return null;
    let line = null;
    for(let pass = 0; pass < 3; pass++){
      const m = [pts.reduce((x, p) => x + p[0], 0) / pts.length, pts.reduce((x, p) => x + p[1], 0) / pts.length];
      let sxx = 0, sxy = 0, syy = 0; for(const p of pts){ const dx = p[0] - m[0], dy = p[1] - m[1]; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), d = [Math.cos(ang), Math.sin(ang)];
      line = { p: m, d };
      const keep = pts.filter(p => Math.abs((p[0] - m[0]) * -d[1] + (p[1] - m[1]) * d[0]) <= 1.6);
      if(keep.length < 8 || keep.length === pts.length) break; pts = keep;
    }
    lines.push(line);
  }
  const X = (l1, l2) => { const den = l1.d[0] * l2.d[1] - l1.d[1] * l2.d[0]; if(Math.abs(den) < 1e-6) return null;
    const tt = ((l2.p[0] - l1.p[0]) * l2.d[1] - (l2.p[1] - l1.p[1]) * l2.d[0]) / den; return [l1.p[0] + tt * l1.d[0], l1.p[1] + tt * l1.d[1]]; };
  const out = [X(lines[3], lines[0]), X(lines[0], lines[1]), X(lines[1], lines[2]), X(lines[2], lines[3])];
  if(out.some((p, i) => !p || dist(p, q[i]) > 0.2 * side)) return null;
  return out;
}
// Re-find the exact card outline inside a rough crop (a drawn box or a tracked card), at higher resolution.
function refineQuad(img, guess){
  const { img: small, s } = downscale(img, 320), ga = polyAreaOf(guess);
  const gc = [guess.reduce((a, p) => a + p[0], 0) / 4, guess.reduce((a, p) => a + p[1], 0) / 4];
  let coarse = null, bd = Infinity;
  for(const q of findCards(small, 0.97)){
    const full = q.map(p => [p[0] / s, p[1] / s]), a = polyAreaOf(full), c = [full.reduce((x, p) => x + p[0], 0) / 4, full.reduce((x, p) => x + p[1], 0) / 4];
    const d = Math.hypot(c[0] - gc[0], c[1] - gc[1]);
    if(a < ga * 0.35 || a > ga * 1.6 || d > 0.3 * Math.sqrt(ga)) continue;
    if(d < bd){ bd = d; coarse = full; }
  }
  const start = coarse || guess;
  return refineByEdges(img, start) || coarse;
}

function topK(arr, k){
  const idx = [];
  for(let i = 0; i < arr.length; i++){
    if(idx.length < k || arr[i] > arr[idx[idx.length - 1]]){
      let j = idx.length; idx.push(i);
      while(j > 0 && arr[idx[j - 1]] < arr[i]){ idx[j] = idx[j - 1]; j--; }
      idx[j] = i;
      if(idx.length > k) idx.pop();
    }
  }
  return idx;
}
function vote(idxs, scores, meta, keyFn){
  const seen = new Set(), m = new Map(); let tot = 0;
  for(const i of idxs){
    const slug = meta[i].slug; if(seen.has(slug)) continue; seen.add(slug);
    if(seen.size > 10) break;
    const w = Math.pow(Math.max(0, scores[i]), 3), k = keyFn(i);
    m.set(k, (m.get(k) || 0) + w); tot += w;
  }
  let best = null; m.forEach((w, k) => { if(!best || w > best.w) best = { k, w }; });
  return best && tot > 0 ? { key: best.k, share: best.w / tot } : null;
}

// Slot weights (sum 1). Art counts most; the corner symbols (cost top-left, element top-right) and the
// whole-card layout make up the rest.
const SLOT_W = { artY: 0.34, artU: 0.12, artV: 0.12, tlY: 0.12, trY: 0.08, trU: 0.06, trV: 0.06, wholeY: 0.10 };
// After the alignment-shift search, unrelated hashes still look about 55% alike, so scores are
// stretched: 0 means "like a random card", 1 means "identical".
const SIM_FLOOR = 0.55;
const stretch = s => Math.max(0, Math.min(1, (s - SIM_FLOOR) / (1 - SIM_FLOOR)));
const SHIFTS5 = [[0, 0], [0.012, 0], [-0.012, 0], [0, 0.012], [0, -0.012]];
const SHIFTS9 = []; for(const dy of [-0.012, 0, 0.012]) for(const dx of [-0.012, 0, 0.012]) SHIFTS9.push([dx, dy]);

// Hash the scan (with small alignment shifts) and compare to every card by Hamming distance.
// lib: { n, H (Uint32Array n*NW), meta[], ek[], ck[] }
function recognize(img0, lib){
  const N = lib.n, H = lib.H; if(!N) return null;
  const imgs = [img0, rot180(img0)];
  let best = null;
  for(let oi = 0; oi < 2; oi++){
    const img = imgs[oi];
    const artH = SHIFTS9.map(([dx, dy]) => fingerprint(img, dx, dy, ['art']));   // art slots read from these
    const cornH = SHIFTS5.map(([dx, dy]) => fingerprint(img, dx, dy, ['tl', 'tr']));  // corner slots read from these
    const mid = fingerprint(img, 0, 0, ['whole']);
    const S = new Float32Array(N), sA = new Float32Array(N), sL = new Float32Array(N), sR = new Float32Array(N);
    const oAY = SLOT_AT.artY, oAU = SLOT_AT.artU, oAV = SLOT_AT.artV, oTL = SLOT_AT.tlY, oRY = SLOT_AT.trY, oRU = SLOT_AT.trU, oRV = SLOT_AT.trV, oW = SLOT_AT.wholeY;
    const wa = SLOT_W.artY + SLOT_W.artU + SLOT_W.artV, wr = SLOT_W.trY + SLOT_W.trU + SLOT_W.trV;
    let top = 0;
    for(let i = 0; i < N; i++){
      const b = i * NW; let a = 1e9, r = 1e9, l = 1e9;
      for(const q of artH){   // best alignment, all three art channels together
        const d = (SLOT_W.artY * hamSlot(H, b, oAY, q, oAY) + SLOT_W.artU * hamSlot(H, b, oAU, q, oAU) + SLOT_W.artV * hamSlot(H, b, oAV, q, oAV)) / wa;
        if(d < a) a = d;
      }
      for(const q of cornH){
        const d = (SLOT_W.trY * hamSlot(H, b, oRY, q, oRY) + SLOT_W.trU * hamSlot(H, b, oRU, q, oRU) + SLOT_W.trV * hamSlot(H, b, oRV, q, oRV)) / wr;
        if(d < r) r = d;
        const e = hamSlot(H, b, oTL, q, oTL); if(e < l) l = e;
      }
      const w = hamSlot(H, b, oW, mid, oW);
      sA[i] = 1 - a / SLOT_BITS; sR[i] = 1 - r / SLOT_BITS; sL[i] = 1 - l / SLOT_BITS;
      S[i] = wa * sA[i] + wr * sR[i] + SLOT_W.tlY * sL[i] + SLOT_W.wholeY * (1 - w / SLOT_BITS);
      if(S[i] > top) top = S[i];
    }
    if(!best || top > best.top) best = { top, S, sA, sL, sR, img, flipped: oi === 1 };
    if(oi === 0 && top > 0.85) break;   // clearly upright, skip the flipped check
  }
  const { S, sA, sL, sR } = best;
  const nl = Float32Array.from(sL, stretch), nr = Float32Array.from(sR, stretch);
  const element = vote(topK(nr, Math.min(30, N)), nr, lib.meta, i => lib.ek[i]);
  const cost = vote(topK(nl, Math.min(30, N)), nl, lib.meta, i => lib.ck[i]);
  const seen = new Set(), list = [];
  for(const i of topK(S, Math.min(N, 40))){
    const slug = lib.meta[i].slug; if(seen.has(slug)) continue; seen.add(slug);
    list.push({ meta: lib.meta[i], score: stretch(S[i]), art: stretch(sA[i]), tl: nl[i], tr: nr[i] });
    if(list.length >= 5) break;
  }
  return { img: best.img, list, element: element && element.share >= 0.5 ? element : null, cost: cost && cost.share >= 0.5 ? cost : null,
    candidates: N, mode: 'perceptual hash', flipped: best.flipped };
}

// ---- compact library file: 14 x uint32 (little endian) per card ----
function packLibrary(entries){
  const bin = new Uint8Array(entries.length * NW * 4), dv = new DataView(bin.buffer);
  entries.forEach((e, i) => { for(let w = 0; w < NW; w++) dv.setUint32((i * NW + w) * 4, e.h[w] >>> 0, true); });
  return { json: { version: 2, words: NW, count: entries.length, built: new Date().toISOString(), meta: entries.map(e => e.meta) }, bin };
}
function unpackLibrary(json, buf){
  if(json.version !== 2) throw new Error('library was built for an older version of the app. Run the Build card library workflow again');
  const n = json.count;
  if(json.words !== NW || buf.byteLength !== n * NW * 4) throw new Error('library files do not match this version of the app');
  const dv = new DataView(buf), H = new Uint32Array(n * NW);
  for(let i = 0; i < n * NW; i++) H[i] = dv.getUint32(i * 4, true);
  return { n, H, meta: json.meta };
}

if(typeof module !== 'undefined') module.exports = { findCards, findCardsBg, bgNew, bgAdd, bgDone, refineQuad, refineByEdges, downscale, polyAreaOf, fingerprint, recognize, warp, orderQuad, portraitQuad, rot180, packLibrary, unpackLibrary, NW, CW, CH, REG };
