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
1. In the lobby open **Connection trouble?** and press **Check my network** on each player's machine. It tests the matchmaking server, the direct route, the router type and any relay, and tells you what to do.
2. Add a relay of your own to `net-config.js` (many providers have a free tier; they give you a username, a password and server addresses). Only one side of a connection needs a relay. A relay that is shared and unmetered, like the one listed there by default, is best effort and may be slow or full.
3. You can also paste relay servers as JSON into the box in **Connection trouble?** to try one on a single machine. **Send everything through the relay** forces the relay path so you can confirm it works.

While playing, a remote player's video shows **Connecting…**, **Connected through a relay**, **Connection interrupted** or **Connection failed**, and failed connections are retried. A connection that never completes gives up after about 20 seconds with a message instead of leaving an empty table.
