// Network settings for Archive Table. Edit this file in your repo, then reload the page.
//
// Players connect browser to browser. Most home networks allow that with a STUN server, but some
// (strict routers, mobile data, work and school networks) only work through a relay (TURN) server.
// Only one side of a connection needs a relay, so putting one here covers everybody who uses your site.
window.ARCHIVE_NET = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },

    // Shared public relay run by the PeerJS project. Best effort only: it is shared, unmetered and can be
    // slow or full. Replace it with your own relay for anything you rely on.
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' }

    // Your own relay (recommended). Many providers have free tiers; they give you values like these:
    // , { urls: ['turn:relay.example.com:3478?transport=udp',
    //            'turn:relay.example.com:3478?transport=tcp',
    //            'turns:relay.example.com:443?transport=tcp'],   // the :443 one gets through strict firewalls
    //     username: 'YOUR_USERNAME', credential: 'YOUR_PASSWORD' }
  ],

  // Matchmaking server that lets players find each other by table code. null = the free public PeerJS cloud.
  // To run your own: peerServer: { host: 'peer.example.com', port: 443, path: '/', secure: true }
  peerServer: null
};
