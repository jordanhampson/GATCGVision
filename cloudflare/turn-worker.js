// Cloudflare Worker for Archive Table: hands out short-lived Cloudflare TURN (relay) credentials.
//
// Why a Worker: Cloudflare's relay needs credentials made with a secret key, and the key must never be
// in the web page. This Worker keeps the key, asks Cloudflare for credentials that expire, and gives
// those to the page. Cloudflare's docs: https://developers.cloudflare.com/realtime/turn/generate-credentials/
//
// Settings (Worker > Settings > Variables and Secrets):
//   TURN_KEY_ID          text      the Key ID of your Cloudflare TURN key
//   TURN_KEY_API_TOKEN   secret    the API token of that key
//   ALLOWED_ORIGINS      text      optional, comma separated, e.g. https://yourname.github.io  (default: any site)
//   TTL_SECONDS          text      optional, how long credentials last (default 86400 = 24 hours)

const API = 'https://rtc.live.cloudflare.com/v1/turn/keys';
let cache = null;   // { body, until, key }: credentials are reused for a while instead of asked for on every visit

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

export default {
  async fetch(request, env){
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
    const any = allowed.includes('*'), originOk = any || allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': any ? '*' : (originOk ? origin : allowed[0]),
      'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin', 'Cache-Control': 'no-store'
    };
    if(request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if(request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);
    if(origin && !originOk) return json({ error: 'origin not allowed' }, 403, cors);
    if(!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({ error: 'worker is not configured' }, 500, cors);

    const ttl = Math.max(600, Math.min(7 * 86400, parseInt(env.TTL_SECONDS || '86400', 10) || 86400)), now = Date.now();
    if(cache && cache.key === env.TURN_KEY_ID && cache.until > now) return json(cache.body, 200, cors);

    let r;
    try{
      r = await fetch(`${API}/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl })
      });
    }catch(e){ return json({ error: 'could not reach Cloudflare' }, 502, cors); }
    if(!r.ok) return json({ error: 'Cloudflare refused the request', status: r.status }, 502, cors);
    let data; try{ data = await r.json(); }catch(e){ return json({ error: 'unreadable reply from Cloudflare' }, 502, cors); }
    let ice = data && data.iceServers; if(ice && !Array.isArray(ice)) ice = [ice];     // older replies are a single object
    if(!Array.isArray(ice) || !ice.length) return json({ error: 'unexpected reply from Cloudflare' }, 502, cors);

    const body = { iceServers: ice, ttl };
    cache = { body, key: env.TURN_KEY_ID, until: now + Math.min(ttl * 250, 6 * 3600 * 1000) };   // reuse for a quarter of the lifetime, at most 6 hours
    return json(body, 200, cors);
  }
};
