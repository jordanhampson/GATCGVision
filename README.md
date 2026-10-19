# Archive Table

Webcam table for Grand Archive with automatic card recognition.

How a card is identified: nothing is scanned by itself. Click a card in any video (yours or another player's) and the app finds the card outline under the click (grayscale, blur, threshold, external contours, four corners, filtered by area and aspect ratio), draws a box around it, snaps the box to the real card edges, corrects the perspective to an upright card, and matches perceptual hashes (DCT pHash) of the art, the cost corner and the element corner against the library by Hamming distance. If no outline is found, drag a box around the card instead.

On a busy or bright playmat the app also uses a picture of the empty mat, learned for about a second when the table opens (keep cards off the mat then), to tell a card from the mat's pattern. It is only a helper: clicks also work without it. Press **Relearn mat** after moving the camera or changing the lighting.

If nothing is identified, look at the chip in the top-left of your video and the **Card library** box on the right. They say whether the card library loaded.

## Put it on GitHub Pages
1. Create a repository and upload everything in this folder, including `index.html`, `algo.js`, `worker.js`, the `tools` folder and the hidden `.github` folder (if the web uploader skips it, create `.github/workflows/library.yml` with Add file > Create new file).
2. Settings > Pages > Deploy from branch > `main`, folder `/ (root)`.
3. Actions > **Build card library** > Run workflow. It downloads the card art once, writes `library/library.json` and `library/library.bin` into the repo, and re-runs weekly to pick up new cards.
4. Open the Pages URL. The page loads the finished library in a second or two. Nothing is built in the browser.

If you are upgrading from an earlier version, run **Build card library** again: the library format changed (now about 64 bytes per card) and old files are rejected.

## Or build the library on your own computer
```
npm install
node tools/build-library.mjs
python3 -m http.server 8000
```
Then open http://localhost:8000. Commit the `library/` folder if you want to host it.

If the build reports image errors for every card, the image server is refusing your network. Tell the developer.

## How tables work, and when players cannot connect

Starting a table registers a five-character code with a free matchmaking server (the public PeerJS cloud). Joining with that code asks the server to introduce the two browsers. After that, video, audio, life of the table (names) and shared cards go straight between the browsers. Nothing but the introductions passes through the matchmaking server. With three or four players everyone connects to everyone.

Two browsers on one machine or one home network connect easily. Across the internet each side first asks a STUN server what its public address looks like, and the two then try to reach each other directly. That fails when a router is strict (symmetric NAT), on many mobile and work or school networks, or when UDP is blocked. The fix is a relay (TURN) server, which carries the video when a direct route is impossible.

What to do:
1. In the lobby open **Connection trouble?** and press **Check my network** on each player's machine. It tests the matchmaking server, the direct route, the router type and any relay, and tells you what to do. If a join fails, this check runs by itself and the lobby shows the result.
2. Get a relay. Free accounts exist; for example Metered's Open Relay advertises 20 GB a month free. Create one and copy the server address, username and password. Then either enter them in the **Relay server** boxes in the lobby (saved on that device only), or put them in `net-config.js` so everyone who opens your site gets them. For two players a working relay on **either** side is enough, so if the host has one, players on strict networks can usually join them.
3. **Send everything through the relay** (under Advanced) forces the relay path so you can confirm it works.

Relays carry the video, so they use data. Through a relay the app sends less (about 450 kbps per player pair instead of up to 1.2 Mbps), which is roughly 0.2 GB per hour for each direction of each pair.

## The free stack, and where each piece lives

This is how the usual "free WebRTC on GitHub Pages" recipe maps onto the app:

| Piece | Free option | In this app |
|---|---|---|
| Hosting | GitHub Pages | works as is |
| Matchmaking (signalling) | public PeerJS server | the default, no setup |
| | free Firebase Realtime Database | built in: set `signaling` in `net-config.js` (below) |
| | Supabase | not built (see the note below) |
| STUN | Google and Cloudflare STUN | in `net-config.js` by default |
| Relay (TURN), for strict routers | Metered Open Relay (free account) | the **Relay server** boxes in the lobby, or `relay` in `net-config.js` |
| | Cloudflare's relay | the Worker in `cloudflare/` (below) |
| | your own coturn, for example on Oracle's free tier | the `selfhost/` kit |

Supabase offers the same kind of channel as Firebase, but its connection protocol is more involved and I could not check it against a real project, so I built the one I could test thoroughly.

## Matchmaking with a free Firebase database (instead of the public PeerJS server)

Players find each other through a Firebase Realtime Database: each player listens to their own inbox, offers and answers are dropped there, and as soon as the video connects the database is no longer used. Messages are deleted as they are read, and a table leaves nothing behind when everyone has left.

1. In the Firebase console create a project, then **Build > Realtime Database > Create database**. Pick the region closest to your players (it affects how quickly players connect). Start in locked mode.
2. Open the database's **Rules** tab, paste in the contents of `firebase/database.rules.json`, and publish.
3. Copy the database address shown at the top of the Data tab (it looks like `https://NAME-default-rtdb.REGION.firebasedatabase.app`).
4. In `net-config.js` set `signaling: { type: 'firebase', url: 'THAT ADDRESS' }`, commit, and reload the page.
5. In the lobby **Check my network** should now say "Signalling database reachable".

Limits on the free plan (check Firebase's current pricing page): about 100 simultaneous connections (each open page uses one, so roughly 100 players at once), 1 GB stored and 10 GB downloaded a month. On the free plan Firebase switches the database off when a limit is passed, until the next reset. A game uses a few kilobytes per connection, so the limits are very unlikely to matter for a group of friends.

The rules only allow the paths and message shapes the app uses, but a database that anyone can write to cannot stop a determined abuser from filling its quota. If that happens, create a new database and change the address. Self-hosted mode (`selfhost/`) ignores this setting: it never uses a public database.

## Free relay with your Cloudflare account (recommended)

Cloudflare runs a managed relay (TURN). Its free allowance is 1,000 GB a month of relayed data, then $0.05 per GB, counted on data sent from Cloudflare to a player. Its STUN is free and unlimited. A relay carries the video only for players whose network cannot connect directly, and the app lowers the video rate on relayed connections, so the allowance goes a long way. It is not literally unlimited, so set a billing notification in your Cloudflare account if you want a safety net.

Cloudflare relay credentials must be made with a secret key, so the key lives in a small Worker (free plan: 100,000 requests a day, far more than needed) and the page asks the Worker for short-lived credentials.

1. In the Cloudflare dashboard open **Realtime**, then **TURN**, and create a TURN key. Copy the **Key ID** and the **API token** (the token is shown once).
2. Open **Workers & Pages**, create a Worker named `archive-table-turn`, deploy it, then edit its code and paste in the contents of `cloudflare/turn-worker.js`. Deploy again.
3. In the Worker's **Settings > Variables and Secrets** add `TURN_KEY_ID` (text), `TURN_KEY_API_TOKEN` (secret) and `ALLOWED_ORIGINS` (text: the address of your site without a path, for example `https://yourname.github.io`).
4. Copy the Worker's address (it ends in `.workers.dev`) and put it in `net-config.js` as `turnCredentials`. Commit.
5. In the lobby open **Connection trouble?** and press **Check my network**. You want "Cloudflare relay credentials received" and "Relay (TURN): reachable".

`ALLOWED_ORIGINS` stops other websites from using your Worker in a browser. It cannot stop someone who calls the Worker directly, so treat the Worker address as semi-private, and delete or replace the TURN key in the dashboard if you ever need to cut access off. Cloudflare may rename dashboard menus; the steps are in its docs under Realtime, TURN, "Generate credentials". The same steps with the command line are in `cloudflare/wrangler.toml`.

For a relay that is truly unmetered you would run your own (for example coturn) on a server with a generous or unmetered transfer plan. Cloudflare's free plan cannot host one, because TURN needs UDP.

While playing, a remote player's video shows **Connecting…**, **Connected through a relay**, **Connection interrupted** or **Connection failed**, and failed connections are retried. A connection that never completes gives up after about 20 seconds with a message instead of leaving an empty table.

## Self-hosted, with no public servers and no data cap

The `selfhost/` folder runs your own relay (coturn), matchmaking server and web server on a machine you control, so nothing but the card art comes from outside. It also removes GitHub Pages, the CDN and web fonts. See `selfhost/README-selfhost.md`.

## Troubleshooting a misread click

If a click boxes the wrong shape or says "Not sure", click again, or drag a box around the card. To see what the app tried, run `localStorage.setItem('archtbl_debug','1')` in the browser console and reload: each click then logs the outlines it found and the score of the best one.
