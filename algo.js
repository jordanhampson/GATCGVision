// Archive Table: card matching engine. Shared by the page and tools/build-library.mjs.

const CW = 200, CH = 280, DIM = 1680;
// Card layout regions as fractions of the card: [x0, y0, x1, y1]
const REG = { art: [0.07, 0.13, 0.93, 0.55], tl: [0.02, 0.015, 0.22, 0.115], tr: [0.78, 0.015, 0.98, 0.115] };
const GRID = { art: [20, 14], cor: [14, 10] };
// Vector layout: artG 280 | artC 560 | tlG 140 | tlC 280 | trG 140 | trC 280
const OFF = { artG: 0, artC: 280, tlG: 840, tlC: 980, trG: 1260, trC: 1400 };
const LEN = { artG: 280, artC: 560, tlG: 140, tlC: 280, trG: 140, trC: 280 };

function cells(img, rect, gw, gh, dx, dy){
  const W = img.width, H = img.height, d = img.data;
  const x0 = (rect[0] + dx) * W, y0 = (rect[1] + dy) * H, x1 = (rect[2] + dx) * W, y1 = (rect[3] + dy) * H;
  const out = new Float32Array(gw * gh * 3);
  for(let cy = 0; cy < gh; cy++){
    const ya = Math.max(0, Math.min(H - 1, Math.floor(y0 + (y1 - y0) * cy / gh)));
    const yb = Math.min(H, Math.max(ya + 1, Math.ceil(y0 + (y1 - y0) * (cy + 1) / gh)));
    for(let cx = 0; cx < gw; cx++){
      const xa = Math.max(0, Math.min(W - 1, Math.floor(x0 + (x1 - x0) * cx / gw)));
      const xb = Math.min(W, Math.max(xa + 1, Math.ceil(x0 + (x1 - x0) * (cx + 1) / gw)));
      let r = 0, g = 0, b = 0, n = 0;
      for(let y = ya; y < yb; y++) for(let x = xa; x < xb; x++){ const p = (y * W + x) * 4; r += d[p]; g += d[p + 1]; b += d[p + 2]; n++; }
      if(!n) n = 1;
      const o = (cy * gw + cx) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return out;
}
function unit(v){
  let m = 0; for(let i = 0; i < v.length; i++) m += v[i]; m /= v.length;
  let n = 0; for(let i = 0; i < v.length; i++){ v[i] -= m; n += v[i] * v[i]; }
  n = Math.sqrt(n);
  if(n < 1e-6) v.fill(0); else for(let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}
function vecs(c, gw, gh){
  const n = gw * gh, G = new Float32Array(n), C1 = new Float32Array(n), C2 = new Float32Array(n);
  for(let i = 0; i < n; i++){
    const r = c[i * 3], g = c[i * 3 + 1], b = c[i * 3 + 2];
    G[i] = 0.299 * r + 0.587 * g + 0.114 * b; C1[i] = r - g; C2[i] = b - (r + g) / 2;
  }
  unit(G); unit(C1); unit(C2);
  const C = new Float32Array(n * 2), k = Math.SQRT1_2;
  for(let i = 0; i < n; i++){ C[i] = C1[i] * k; C[n + i] = C2[i] * k; }
  return [G, C];
}
function describe(img, dx, dy){
  const out = new Float32Array(DIM); let o = 0;
  for(const [rect, grid] of [[REG.art, GRID.art], [REG.tl, GRID.cor], [REG.tr, GRID.cor]]){
    const [g, c] = vecs(cells(img, rect, grid[0], grid[1], dx, dy), grid[0], grid[1]);
    out.set(g, o); o += g.length; out.set(c, o); o += c.length;
  }
  return out;
}
function rot180(img){
  const n = img.width * img.height, out = new Uint8ClampedArray(n * 4), d = img.data;
  for(let i = 0; i < n; i++){ const j = n - 1 - i; out[i*4] = d[j*4]; out[i*4+1] = d[j*4+1]; out[i*4+2] = d[j*4+2]; out[i*4+3] = 255; }
  return { width: img.width, height: img.height, data: out };
}
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
    for(let c = 0; c < 3; c++){
      acc[c] += (d[p + c] * (1 - fx) + d[p + 4 + c] * fx) * (1 - fy) + (d[q + c] * (1 - fx) + d[q + 4 + c] * fx) * fy;
    }
  };
  const acc = [0, 0, 0];
  for(let v = 0; v < CH; v++) for(let u = 0; u < CW; u++){
    acc[0] = acc[1] = acc[2] = 0;
    for(let sy = 0; sy < ss; sy++) for(let sx = 0; sx < ss; sx++){
      const x = u + (sx + 0.5) / ss, y = v + (sy + 0.5) / ss;
      const w = h[6] * x + h[7] * y + 1;
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
  const tl = pts[idx(s)], br = pts[idxMax(s)], tr = pts[idx(d)], bl = pts[idxMax(d)];
  return [tl, tr, br, bl];
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
function dotSlice(M, base, q, off, len){ let s = 0; for(let k = 0; k < len; k++) s += M[base + off + k] * q[off + k]; return s; }
const cornerScore = (M, base, q, side) => side === 'tl'
  ? 0.55 * dotSlice(M, base, q, OFF.tlG, LEN.tlG) + 0.45 * dotSlice(M, base, q, OFF.tlC, LEN.tlC)
  : 0.55 * dotSlice(M, base, q, OFF.trG, LEN.trG) + 0.45 * dotSlice(M, base, q, OFF.trC, LEN.trC);
const artScore = (M, base, q) => 0.65 * dotSlice(M, base, q, OFF.artG, LEN.artG) + 0.35 * dotSlice(M, base, q, OFF.artC, LEN.artC);

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
// lib: { n, M (Float32Array n*DIM), meta[], ek[], ck[] }
function recognize(img0, lib){
  const N = lib.n, M = lib.M; if(!N) return null;
  const shifts5 = [[0, 0], [0.012, 0], [-0.012, 0], [0, 0.012], [0, -0.012]];
  let pick = null;
  for(const img of [img0, rot180(img0)]){
    const vs = shifts5.map(([dx, dy]) => describe(img, dx, dy));
    const tl = new Float32Array(N), tr = new Float32Array(N);
    for(let i = 0; i < N; i++){
      const base = i * DIM; let a = -2, b = -2;
      for(const q of vs){ const s1 = cornerScore(M, base, q, 'tl'), s2 = cornerScore(M, base, q, 'tr'); if(s1 > a) a = s1; if(s2 > b) b = s2; }
      tl[i] = a; tr[i] = b;
    }
    const avg = arr => { const t = topK(arr, 5); return t.reduce((s, i) => s + arr[i], 0) / t.length; };
    const quality = avg(tl) + avg(tr);
    if(!pick || quality > pick.quality) pick = { img, quality, tl, tr };
  }
  const { tl, tr, img } = pick;
  const element = vote(topK(tr, 30), tr, lib.meta, i => lib.ek[i]);
  const cost = vote(topK(tl, 30), tl, lib.meta, i => lib.ck[i]);
  const filt = (useEl, useCo) => { const out = []; for(let i = 0; i < N; i++){
    if(useEl && lib.ek[i] !== element.key) continue; if(useCo && lib.ck[i] !== cost.key) continue; out.push(i); } return out; };
  const elOk = element && element.share >= 0.5, coOk = cost && cost.share >= 0.5;
  let cand = filt(elOk, coOk), mode = 'element + cost';
  if(cand.length < 3){ cand = filt(elOk, false); mode = 'element'; }
  if(cand.length < 3){ cand = filt(false, coOk); mode = 'cost'; }
  if(cand.length < 3){ cand = filt(false, false); mode = 'all cards'; }
  if(mode === 'element + cost' && !elOk) mode = 'cost'; // (defensive labels)
  // Symbols can be misread, so also keep the cards whose corners look most alike.
  const comb = new Float32Array(N); for(let i = 0; i < N; i++) comb[i] = tl[i] + tr[i];
  const keep = new Set(cand); for(const i of topK(comb, Math.min(N, 80))) keep.add(i);
  cand = [...keep];
  const shifts9 = []; for(const dy of [-0.012, 0, 0.012]) for(const dx of [-0.012, 0, 0.012]) shifts9.push(describe(img, dx, dy));
  const scored = [];
  for(const i of cand){
    const base = i * DIM; let a = -2;
    for(const q of shifts9){ const s = artScore(M, base, q); if(s > a) a = s; }
    scored.push({ i, art: a, tl: tl[i], tr: tr[i], score: 0.6 * a + 0.2 * tl[i] + 0.2 * tr[i] });
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set(), list = [];
  for(const s of scored){ const slug = lib.meta[s.i].slug; if(seen.has(slug)) continue; seen.add(slug); list.push({ meta: lib.meta[s.i], ...s }); if(list.length >= 5) break; }
  return { img, list, element: elOk ? element : null, cost: coOk ? cost : null, candidates: cand.length, mode, flipped: img !== img0 };
}

// ---- compact library file format: per card 6 float32 scales + 1680 int8 values ----
const SEG = ['artG', 'artC', 'tlG', 'tlC', 'trG', 'trC'];
const REC = 24 + DIM;
function packLibrary(entries){
  const bin = new Uint8Array(entries.length * REC), dv = new DataView(bin.buffer);
  entries.forEach((e, i) => {
    const base = i * REC;
    SEG.forEach((s, j) => {
      const off = OFF[s], len = LEN[s]; let m = 0;
      for(let k = 0; k < len; k++) m = Math.max(m, Math.abs(e.v[off + k]));
      const sc = m / 127 || 1e-9; dv.setFloat32(base + j * 4, sc, true);
      for(let k = 0; k < len; k++) bin[base + 24 + off + k] = Math.round(e.v[off + k] / sc) & 0xff;
    });
  });
  const json = { version: 1, dim: DIM, count: entries.length, built: new Date().toISOString(), meta: entries.map(e => e.meta) };
  return { json, bin };
}
function unpackLibrary(json, buf){
  const n = json.count;
  if(json.dim !== DIM || buf.byteLength !== n * REC) throw new Error('library files do not match this version of the app');
  const dv = new DataView(buf), M = new Float32Array(n * DIM);
  for(let i = 0; i < n; i++){
    const base = i * REC, q = new Int8Array(buf, base + 24, DIM);
    SEG.forEach((s, j) => {
      const sc = dv.getFloat32(base + j * 4, true), off = OFF[s], len = LEN[s], o = i * DIM + off;
      for(let k = 0; k < len; k++) M[o + k] = q[off + k] * sc;
    });
  }
  return { n, M, meta: json.meta };
}

if(typeof module !== 'undefined') module.exports = { describe, warp, recognize, orderQuad, portraitQuad, rot180, packLibrary, unpackLibrary, DIM, CW, CH, REG, OFF, LEN };
