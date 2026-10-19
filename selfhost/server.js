// Archive Table self-hosting server. No dependencies: Node.js only.
//   - serves the app (index.html, algo.js, worker.js, mesh.js, net-config.js, library/, and the PeerJS client)
//   - /turn         short-lived credentials for YOUR coturn relay (HMAC "TURN REST" scheme, no database)
//   - /config.json  tells the page to use your own matchmaking server and relay instead of public ones
// Settings come from environment variables (see .env.example and README-selfhost.md).
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const env = process.env;
const PORT = parseInt(env.PORT || '3000', 10);
const SITE_DIR = path.resolve(env.SITE_DIR || path.join(__dirname, '..'));
const TURN_SECRET = env.TURN_SECRET || '';
const TURN_PORT = parseInt(env.TURN_PORT || '3478', 10);
const TTL = Math.max(600, Math.min(7 * 86400, parseInt(env.TTL_SECONDS || '86400', 10) || 86400));
const PEER_PORT = parseInt(env.PEER_PORT || '9443', 10);
const ACCESS_TOKEN = env.ACCESS_TOKEN || '';          // optional: only people with ?t=TOKEN may get relay credentials
const PEERJS_CLIENT = env.PEERJS_CLIENT_PATH || path.join(__dirname, 'node_modules', 'peerjs', 'dist', 'peerjs.min.js');
if(!TURN_SECRET){ console.error('TURN_SECRET is not set. Set it to the same value coturn uses.'); process.exit(1); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.bin': 'application/octet-stream' };
// Only these files are ever served: nothing else in the folder (including this server and your secrets) is reachable.
const FILES = new Set(['index.html', 'algo.js', 'worker.js', 'net-config.js', 'mesh.js']);

const hits = new Map();   // per-address request counts for /turn (one minute windows)
function limited(ip){
  const now = Date.now(), h = hits.get(ip);
  if(!h || now - h.at > 60000){ hits.set(ip, { at: now, n: 1 }); return false; }
  if(++h.n > 60) return true;
  return false;
}
setInterval(() => { const now = Date.now(); hits.forEach((v, k) => { if(now - v.at > 120000) hits.delete(k); }); }, 60000).unref();

const hostOf = req => String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim().replace(/:\d+$/, '');
const secure = req => env.PUBLIC_HTTPS ? env.PUBLIC_HTTPS !== '0' : String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const sha = x => crypto.createHash('sha256').update(String(x)).digest();
const tokenOk = u => !ACCESS_TOKEN || crypto.timingSafeEqual(sha(u.searchParams.get('t') || ''), sha(ACCESS_TOKEN));

function send(res, status, body, type, extra){
  res.writeHead(status, Object.assign({ 'Content-Type': type || 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }, extra || {}));
  res.end(body);
}
const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json', { 'Cache-Control': 'no-store' });

// coturn "use-auth-secret": username = expiry timestamp + a label, credential = base64(HMAC-SHA1(secret, username)).
function turnCredentials(host){
  const username = (Math.floor(Date.now() / 1000) + TTL) + ':archive-table';
  const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
  const h = env.TURN_HOST || host;
  return { iceServers: [
    { urls: [`stun:${h}:${TURN_PORT}`] },
    { urls: [`turn:${h}:${TURN_PORT}?transport=udp`, `turn:${h}:${TURN_PORT}?transport=tcp`], username, credential }
  ], ttl: TTL };
}

function serveFile(res, file, type, cache){
  fs.readFile(file, (err, data) => {
    if(err) return send(res, 404, 'Not found');
    send(res, 200, data, type, { 'Cache-Control': cache });
  });
}

const server = http.createServer((req, res) => {
  let u; try{ u = new URL(req.url, 'http://x'); }catch(e){ return send(res, 400, 'Bad request'); }
  if(req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  let p; try{ p = decodeURIComponent(u.pathname); }catch(e){ return send(res, 400, 'Bad request'); }

  if(p === '/healthz') return send(res, 200, 'ok');
  if(p === '/turn'){
    if(!tokenOk(u)) return sendJson(res, 403, { error: 'access token missing or wrong' });
    if(limited(clientIp(req))) return sendJson(res, 429, { error: 'too many requests' });
    return sendJson(res, 200, turnCredentials(hostOf(req)));
  }
  if(p === '/config.json'){
    return sendJson(res, 200, { selfHosted: true, needsToken: !!ACCESS_TOKEN && !tokenOk(u),
      peerServer: { host: env.PEER_HOST || hostOf(req), port: PEER_PORT, path: '/', secure: secure(req), key: 'peerjs' } });
  }
  if(p === '/vendor/peerjs.min.js') return serveFile(res, PEERJS_CLIENT, TYPES['.js'], 'public, max-age=86400');
  if(p === '/' || p === '/index.html') return serveFile(res, path.join(SITE_DIR, 'index.html'), TYPES['.html'], 'no-cache');
  const name = p.replace(/^\//, '');
  if(FILES.has(name)) return serveFile(res, path.join(SITE_DIR, name), TYPES[path.extname(name)], 'no-cache');
  if(/^library\/(library\.json|library\.bin)$/.test(name)) return serveFile(res, path.join(SITE_DIR, name), TYPES[path.extname(name)], 'public, max-age=3600');
  return send(res, 404, 'Not found');
});
server.listen(PORT, () => console.log(`Archive Table server on port ${PORT}, serving ${SITE_DIR}`));
