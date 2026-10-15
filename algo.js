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

if(typeof module !== 'undefined') module.exports = { fingerprint, recognize, warp, orderQuad, portraitQuad, rot180, packLibrary, unpackLibrary, NW, CW, CH, REG };
