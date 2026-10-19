// Archive Table: WebRTC connections that find each other through a free Firebase Realtime Database
// instead of the public PeerJS server. Exposes window.ArchivePeer, which offers the small part of the
// PeerJS interface the app uses (connect, call, answer, events), so the rest of the app is unchanged.
//
// How it works: every player listens to their own "inbox" in the database (server-sent events). To start a
// connection, a player drops the WebRTC offer in the other player's inbox; the answer and the network
// candidates come back the same way. Once connected, video and data go directly between the browsers and
// the database is no longer involved. Messages are deleted as soon as they are read.
(function(){
'use strict';

const rid = () => Math.random().toString(36).slice(2, 10);
class Em {
  constructor(){ this._h = {}; }
  on(e, f){ (this._h[e] = this._h[e] || []).push(f); return this; }
  emit(e, ...a){ (this._h[e] || []).slice().forEach(f => { try{ f(...a); }catch(err){ console.error(err); } }); }
}
// "archtbl-AB12C" (host) and "archtbl-AB12C-x7k2q" (guests) share the room "AB12C".
const roomOf = id => { const m = /^archtbl-([A-Za-z0-9]+)/.exec(id); return m ? m[1] : '_check'; };

/* ---------- one WebRTC connection ---------- */
class Base extends Em {
  constructor(peer, remote, cid, kind){
    super();
    this.peerObj = peer; this.peer = remote; this.cid = cid; this.kind = kind;
    this.pending = []; this.haveRemote = false; this.outC = []; this.closed = false;
    const pc = this.peerConnection = new RTCPeerConnection(peer.cfg);
    pc.onicecandidate = e => {
      if(e.candidate){ this.outC.push(e.candidate.toJSON()); clearTimeout(this.ft); this.ft = setTimeout(() => this._flush(), 120); }
      else this._flush();
    };
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if(s === 'failed'){ this.emit('error', new Error('Negotiation of connection to ' + remote + ' failed.')); this.close(true); }
      else if(s === 'closed') this.close(true);
    };
  }
  // Network candidates are sent in small batches: every message costs a database round trip.
  _flush(){ clearTimeout(this.ft); if(this.outC.length) this.peerObj._sig(this.peer, this.cid, this.kind, 'cands', this.outC.splice(0)); }
  async _remote(d){
    await this.peerConnection.setRemoteDescription(d); this.haveRemote = true;
    for(const c of this.pending) try{ await this.peerConnection.addIceCandidate(c); }catch(e){}
    this.pending = [];
  }
  async _addCands(list){
    for(const c of list){
      if(this.haveRemote){ try{ await this.peerConnection.addIceCandidate(c); }catch(e){} } else this.pending.push(c);
    }
  }
  async _sig(type, payload){
    const pc = this.peerConnection;
    if(type === 'offer' && this.kind === 'data'){
      await this._remote(payload); const a = await pc.createAnswer(); await pc.setLocalDescription(a);
      this.peerObj._sig(this.peer, this.cid, 'data', 'answer', pc.localDescription.toJSON());
    }
    else if(type === 'offer'){ this._offer = payload; }
    else if(type === 'answer') await this._remote(payload);
    else if(type === 'cands') await this._addCands(payload);
    else if(type === 'bye') this.close(true);
  }
  async _offerOut(gate){
    const pc = this.peerConnection; await pc.setLocalDescription(await pc.createOffer());
    if(gate && !(await gate)) return;               // nobody is there: send nothing (it would sit in the database forever)
    this.peerObj._sig(this.peer, this.cid, this.kind, 'offer', pc.localDescription.toJSON());
  }
}
class DataConn extends Base {
  constructor(peer, remote, cid, init, gate){
    super(peer, remote, cid, 'data'); this.open = false;
    const wire = dc => {
      this.dc = dc;
      dc.onopen = () => { this.open = true; this.emit('open'); };
      dc.onmessage = e => { try{ this.emit('data', JSON.parse(e.data)); }catch(err){} };
      dc.onclose = () => { this.open = false; this.close(true); };
    };
    if(init){ wire(this.peerConnection.createDataChannel('d')); this._offerOut(gate); }
    else this.peerConnection.ondatachannel = e => wire(e.channel);
  }
  send(d){ if(this.dc && this.dc.readyState === 'open') this.dc.send(JSON.stringify(d)); }
  close(remote){
    if(this.closed) return; this.closed = true; this.open = false;
    if(!remote) this.peerObj._bye(this.peer, this.cid, 'data');
    try{ this.peerConnection.close(); }catch(e){}
    this.emit('close');
  }
}
class MediaConn extends Base {
  constructor(peer, remote, cid, stream, gate){
    super(peer, remote, cid, 'media');
    this.peerConnection.ontrack = e => { if(!this._streamed){ this._streamed = true; this.emit('stream', e.streams[0]); } };
    if(stream){ stream.getTracks().forEach(t => this.peerConnection.addTrack(t, stream)); this._offerOut(gate); }
  }
  async answer(stream){
    const pc = this.peerConnection; stream.getTracks().forEach(t => pc.addTrack(t, stream));
    await this._remote(this._offer); const a = await pc.createAnswer(); await pc.setLocalDescription(a);
    this.peerObj._sig(this.peer, this.cid, 'media', 'answer', pc.localDescription.toJSON());
  }
  close(remote){
    if(this.closed) return; this.closed = true;
    if(!remote) this.peerObj._bye(this.peer, this.cid, 'media');
    try{ this.peerConnection.close(); }catch(e){}
    this.emit('close');
  }
}

/* ---------- a player, signalling through Firebase Realtime Database ---------- */
class ArchivePeer extends Em {
  constructor(id, opts){
    super();
    if(id && typeof id === 'object'){ opts = id; id = undefined; }
    this.opts = opts || {};
    this.base = String((this.opts.signaling || {}).url || '').replace(/\/+$/, '');
    this.cfg = this.opts.config || {};
    this.id = id || 'anon-' + rid(); this.room = roomOf(this.id);
    this.conns = new Map(); this.seen = new Set(); this.queue = Promise.resolve(); this.aliveCache = new Map(); this.skew = null;
    this.destroyed = false; this.opened = false;
    this._boot();
  }
  _u(p){ return `${this.base}/rooms/${this.room}/${p}.json`; }
  async _fb(method, url, body){
    const r = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    if(!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
    return r.json();
  }
  _fail(type, message){ if(!this.destroyed) this.emit('error', Object.assign(new Error(message || type), { type })); }
  _beat(){ return this._fb('PUT', this._u('peers/' + this.id), { '.sv': 'timestamp' }); }

  async _boot(){
    if(!this.base){ return this._fail('server-error', 'no signalling database address configured'); }
    try{
      const cur = await this._fb('GET', this._u('peers/' + this.id));
      if(cur !== null && await this._fresh(cur)) return this._fail('unavailable-id');
      await this._beat();
      const mine = await this._fb('GET', this._u('peers/' + this.id));          // our own stamp = the database's clock right now
      if(typeof mine === 'number') this.skew = mine - Date.now();
      await this._listen();
      this.hb = setInterval(() => this._beat().catch(() => {}), 15000);
      this.opened = true; if(!this.destroyed) this.emit('open', this.id);
    }catch(e){ this._fail(e.status === 401 || e.status === 403 ? 'server-error' : 'network', e.message); }
  }
  // Is a presence stamp recent? Judged against the database's own clock, so differences between players'
  // clocks do not matter. Before our own stamp exists (the id-taken check) the clock is read from a scratch stamp.
  async _fresh(stamp){
    let now;
    if(this.skew !== null) now = Date.now() + this.skew;
    else{
      const k = 'peers/_t' + rid();
      await this._fb('PUT', this._u(k), { '.sv': 'timestamp' }); now = await this._fb('GET', this._u(k));
      this._fb('DELETE', this._u(k)).catch(() => {});
    }
    return typeof now === 'number' && now - stamp < 60000;
  }
  async _isAlive(id){
    const v = await this._fb('GET', this._u('peers/' + id));
    return v !== null && await this._fresh(v);
  }
  // Same question, remembered for a few seconds (a connection asks twice: data channel and video). If the check
  // itself fails we assume the player is there.
  _alive(id){
    const c = this.aliveCache.get(id), now = Date.now();
    if(c && now - c.t < 5000) return c.p;
    const p = this._isAlive(id).catch(() => true); this.aliveCache.set(id, { t: now, p }); return p;
  }
  // No goodbye messages: the other side notices the connection ending by itself, and a goodbye sent just as someone
  // leaves would sit in the database with nobody to read it.
  _bye(){}
  _listen(){
    return new Promise((resolve, reject) => {
      let first = true;
      const es = this.es = new EventSource(this._u('sig/' + this.id));
      const timer = setTimeout(() => { if(first){ first = false; try{ es.close(); }catch(e){} reject(new Error('no answer from the signalling database')); } }, 9000);
      const onData = ev => {
        let m; try{ m = JSON.parse(ev.data); }catch(e){ return; }
        this._onPut(m);
        if(first){ first = false; clearTimeout(timer); resolve(); }
      };
      es.addEventListener('put', onData); es.addEventListener('patch', onData);
      es.addEventListener('cancel', () => { if(first){ first = false; clearTimeout(timer); reject(Object.assign(new Error('denied'), { status: 403 })); } else this._fail('server-error', 'the database refused the stream'); });
      es.onerror = () => {
        if(es.readyState === 2){                              // closed for good (the browser retries by itself otherwise)
          if(first){ first = false; clearTimeout(timer); reject(new Error('stream closed')); }
          else if(!this.destroyed) this.emit('disconnected', this.id);
        }
      };
    });
  }
  _onPut(m){
    if(!m || m.data === null || m.data === undefined) return;
    if(m.path === '/'){ if(typeof m.data === 'object') Object.entries(m.data).forEach(([k, v]) => this._msg(k, v)); }
    else { const parts = String(m.path).split('/').filter(Boolean); if(parts.length === 1) this._msg(parts[0], m.data); }
  }
  _msg(key, m){
    if(this.seen.has(key) || !m || typeof m !== 'object') return;
    this.seen.add(key); if(this.seen.size > 500) this.seen.delete(this.seen.values().next().value);
    this._fb('DELETE', this._u(`sig/${this.id}/${key}`)).catch(() => {});      // read once, then remove
    let payload; try{ payload = JSON.parse(m.d); }catch(e){ return; }
    this._dispatch(m.from, m.cid, m.kind, m.type, payload);
  }
  _dispatch(from, cid, kind, type, payload){
    let c = this.conns.get(cid);
    if(!c && type === 'offer'){
      if(kind === 'data'){ c = new DataConn(this, from, cid, false); this.conns.set(cid, c); this.emit('connection', c); }
      else { c = new MediaConn(this, from, cid, null); this.conns.set(cid, c); c._sig('offer', payload); this.emit('call', c); return; }
    }
    if(c) c._sig(type, payload);
  }
  // Messages to other players are sent one at a time, in order.
  _sig(to, cid, kind, type, payload){
    this.queue = this.queue.then(() => this._fb('POST', this._u('sig/' + to), { from: this.id, cid, kind, type, d: JSON.stringify(payload), ts: { '.sv': 'timestamp' } })).catch(() => {});
  }

  connect(id){
    const gate = this._alive(id), c = new DataConn(this, id, rid(), true, gate); this.conns.set(c.cid, c);
    gate.then(ok => { if(!ok && !this.destroyed){ this._fail('peer-unavailable'); c.close(true); } });
    return c;
  }
  call(id, stream){ const c = new MediaConn(this, id, rid(), stream, this._alive(id)); this.conns.set(c.cid, c); return c; }
  reconnect(){
    if(this.destroyed) return;
    if(this.es) try{ this.es.close(); }catch(e){}
    this._listen().then(() => { this.opened = true; this.emit('open', this.id); }).catch(() => this._fail('network'));
  }
  destroy(){
    if(this.destroyed) return; this.destroyed = true; clearInterval(this.hb);
    this.conns.forEach(c => { try{ c.close(true); }catch(e){} });
    if(this.es) try{ this.es.close(); }catch(e){}
    if(this.opened || this.hb){
      const gone = u => { try{ fetch(u, { method: 'DELETE', keepalive: true }).catch(() => {}); }catch(e){} };
      gone(this._u('peers/' + this.id)); gone(this._u('sig/' + this.id));
    }
  }
}
window.ArchivePeer = ArchivePeer;
})();
