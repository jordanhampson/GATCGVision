// Network settings for Archive Table. Edit this file in your repo, then reload the page.
//
// Players connect browser to browser. Most home networks allow that with a STUN server, but strict
// routers (symmetric NAT), mobile data, and work or school networks only work through a relay (TURN)
// server. For a pair of players, a working relay on EITHER side is enough, so a relay set here covers
// everyone who opens your site. Players can also add their own in the lobby ("Connection trouble?").
// Running your own servers (no public ones at all)? See selfhost/README-selfhost.md. The page then ignores
// this file's servers automatically when it is served by selfhost/server.js.
window.ARCHIVE_NET = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ],

  // Your relay. Free accounts exist (for example Metered's Open Relay, which advertises 20 GB/month free):
  // create one, copy the server address, username and password it gives you, and fill them in here.
  // The usual ports (80 and 443, over UDP and TCP, plus TLS on 443) are added for you.
  relay: null
  // relay: { host: 'global.relay.metered.ca', username: 'YOUR_USERNAME', credential: 'YOUR_PASSWORD' }
  // For a relay on another port use host: 'relay.example.com:3478'. For anything else, add a full entry to
  // iceServers above, e.g. { urls: ['turn:relay.example.com:3478?transport=tcp'], username: '...', credential: '...' }
  ,
  // Cloudflare relay (recommended if you have a Cloudflare account): the address of the small Worker in the
  // cloudflare/ folder, which hands out short-lived relay credentials. Cloudflare's relay includes 1,000 GB a
  // month free, then $0.05/GB. See the README. null = not used.
  turnCredentials: null,   // e.g. 'https://archive-table-turn.YOURNAME.workers.dev'

  // Matchmaking through a free Firebase Realtime Database instead of the public PeerJS server (whose free
  // public server can be flaky). Create a database in the Firebase console (free Spark plan), paste the rules
  // from firebase/database.rules.json, and put its address here. See the README. null = use PeerJS.
  signaling: null,   // e.g. { type: 'firebase', url: 'https://YOUR-PROJECT-default-rtdb.firebaseio.com' }

  // Matchmaking server that lets players find each other by table code. null = the free public PeerJS cloud.
  // To run your own: peerServer: { host: 'peer.example.com', port: 443, path: '/', secure: true }
  peerServer: null
};
