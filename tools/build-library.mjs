// Builds library/library.json + library/library.bin from the Grand Archive API.
// Usage:  npm install   then   node tools/build-library.mjs
// Re-running only downloads cards that are not already in the library.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const A = require('../algo.js');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'library');
const API = process.env.GA_API || 'https://api.gatcg.com';
const { default: sharp } = await import('sharp');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, kind){
  for(let i = 0; i < 4; i++){
    try{
      const r = await fetch(url);
      if(!r.ok) throw new Error(`${r.status} ${url}`);
      return kind === 'json' ? await r.json() : Buffer.from(await r.arrayBuffer());
    }catch(e){ if(i === 3) throw e; await sleep(600 * (i + 1)); }
  }
}
function entryMeta(c, ed, i){
  return {
    key: `${c.slug}#${ed.slug || i}`, slug: c.slug, name: c.name,
    types: c.types || [], subtypes: c.subtypes || [], classes: c.classes || [],
    elements: c.elements || (c.element ? [c.element] : []),
    cost: c.cost || null, level: c.level, life: c.life, power: c.power, durability: c.durability,
    effect: c.effect_raw || '', img: ed.image, set: (ed.set && ed.set.prefix) || ''
  };
}
async function describeImage(imgPath){
  const url = /^https?:/.test(imgPath) ? imgPath : API + imgPath;
  const buf = await get(url, 'buf');
  const { data } = await sharp(buf).resize(A.CW, A.CH, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = new Uint8ClampedArray(A.CW * A.CH * 4);
  for(let i = 0; i < A.CW * A.CH; i++){ rgba[i*4] = data[i*3]; rgba[i*4+1] = data[i*3+1]; rgba[i*4+2] = data[i*3+2]; rgba[i*4+3] = 255; }
  return A.fingerprint({ width: A.CW, height: A.CH, data: rgba }, 0, 0);
}

// 1. existing library (so reruns are incremental)
const existing = new Map();
try{
  const json = JSON.parse(await fs.readFile(path.join(outDir, 'library.json'), 'utf8'));
  const bin = await fs.readFile(path.join(outDir, 'library.bin'));
  const u = A.unpackLibrary(json, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  u.meta.forEach((m, i) => existing.set(m.key, { meta: m, v: u.H.slice(i * A.NW, (i + 1) * A.NW) }));
  console.log(`Existing library: ${existing.size} entries`);
}catch(e){ console.log('No usable existing library (' + e.message + '), building from scratch.'); }

// 2. card list
const wanted = []; let page = 1, total = 1;
while(page <= total){
  const j = await get(`${API}/cards/search?page=${page}&page_size=50`, 'json');
  total = j.total_pages || 1;
  for(const c of j.data || []){
    const eds = (c.editions || []).filter(e => e.image); if(!eds.length) continue;
    const picks = [eds[0]]; if(eds.length > 1 && eds[eds.length - 1].image !== eds[0].image) picks.push(eds[eds.length - 1]);
    picks.forEach((ed, i) => wanted.push(entryMeta(c, ed, i)));
  }
  process.stdout.write(`\rCard list: page ${page}/${total}`); page++; await sleep(120);
}
console.log(`\n${wanted.length} card images in the database.`);

// 3. describe new images (8 at a time)
const queue = wanted.filter(m => !existing.has(m.key));
const result = new Map(); let done = 0, failed = 0;
async function worker(){
  while(queue.length){
    const m = queue.shift();
    try{ result.set(m.key, { meta: m, v: await describeImage(m.img) }); }
    catch(e){ failed++; console.warn(`\nSkipped ${m.key}: ${e.message}`); }
    done++; if(done % 25 === 0) process.stdout.write(`\rDescribing new art: ${done}`);
  }
}
const todo = queue.length;
await Promise.all(Array.from({ length: 8 }, worker));
console.log(`\nDescribed ${todo - failed} new cards, ${failed} failed.`);

// 4. write (cards removed from the database are dropped; metadata is refreshed)
const entries = [];
for(const m of wanted){
  const old = existing.get(m.key), neu = result.get(m.key);
  const v = neu ? neu.v : old && old.v; if(!v) continue;
  entries.push({ meta: m, h: v });
}
if(entries.length < 50) throw new Error('Fewer than 50 cards. Refusing to overwrite the library.');
const { json, bin } = A.packLibrary(entries);
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'library.json'), JSON.stringify(json));
await fs.writeFile(path.join(outDir, 'library.bin'), bin);
console.log(`Wrote ${entries.length} cards. library.bin: ${(bin.length / 1e6).toFixed(1)} MB`);
