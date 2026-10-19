# Self-hosting Archive Table: no public servers, no data cap

This runs everything on a machine you control:

| Piece | What it does | Replaces |
|---|---|---|
| **coturn** | the relay (STUN + TURN) that carries video for players who cannot connect directly | Cloudflare, Metered, Google STUN |
| **peer server** | matchmaking: lets players find each other by table code (carries no video) | the public PeerJS cloud |
| **web server** (`server.js`) | serves the app, hands out relay credentials, tells the page to use your servers | GitHub Pages, jsDelivr, Google Fonts |
| **Caddy** | HTTPS with automatic certificates (cameras only work on https pages) | |

Players' video still goes browser to browser whenever their networks allow it. Your machine only carries video for the players who need the relay.

**One outside service remains: card art.** Card pictures and the card list come from `api.gatcg.com`, the Grand Archive database behind index.gatcg.com. You asked for that database, and the app has no other source of card art. It is contacted by each player's browser to show card pictures, and once by whoever builds the card library.

## What "no data cap" means

Nothing in this setup meters or limits data. The limits are your machine's upload speed and your internet or hosting plan. Over a relay the app sends about 0.45 Mbps per direction per player pair. A table where every pair needed the relay (the worst case, four players) would move about 5 Mbps in and 5 Mbps out through your machine. Most tables need the relay for only one or two players.

## Oracle Cloud's free tier as the machine

A common free choice. What I found, from secondary sources (check Oracle's current terms before relying on it):

- The Always Free tier includes Ampere ARM virtual machines and is reported to include about 10 TB a month of outbound data. One guide also lists a 10 Mbps bandwidth figure for these machines. That is a speed limit rather than a data cap, and it would cap how many players one relay can serve at the same time (about 0.9 Mbps in and out per relayed pair).
- Signing up asks for a payment card for verification, and you choose a home region that cannot be changed later. Free machines are sometimes unavailable in a region ("out of capacity"); trying again later usually works.
- Oracle's Ubuntu images block most ports in the machine's own firewall (iptables) in addition to the cloud network's security list. You need to open the ports from this guide in **both**.
- The images used here (Node, coturn, Caddy) should have ARM builds; if `docker compose up` complains about the architecture, tell me which image.

## What you need

- A machine that is on while you play: a small cloud server (pick a plan with generous or unmetered transfer) or a computer at home.
- A domain name pointing at it. Free dynamic-DNS names work.
- These ports reachable from the internet: **80/tcp, 443/tcp, 9443/tcp, 3478/udp and tcp, 49160-49200/udp**.
- Hosting at home needs port forwarding on your router, and **does not work if your internet provider uses carrier-grade NAT** (your router's internet address starts with 100.64 to 100.127, or differs from what a site like ifconfig.me shows). Use a cloud server in that case.

## Quick start with Docker

1. Install Docker and Docker Compose on the machine.
2. Point your domain's A record at the machine's public IP address.
3. Open the ports above in the machine's firewall (and forward them on your router at home).
4. In this folder: `cp .env.example .env`, then edit `.env`: `DOMAIN`, `PUBLIC_IP`, and a long random `TURN_SECRET` (`openssl rand -hex 24`). Optionally set `ACCESS_TOKEN` so only people with your link can use the relay.
5. Put the card library in the project's `library/` folder (one-time, on any computer with internet access: `npm install`, then `node tools/build-library.mjs` in the project folder; copy `library/` to the machine if you built it elsewhere).
6. `docker compose up -d`
7. Open `https://YOUR-DOMAIN/` (with `?t=YOUR_TOKEN` if you set one). Share that full link with your players.

## Check that it works

In the lobby open **Connection trouble?** and press **Check my network**. You want:

```
OK   Matchmaking server reachable.
OK   Relay credentials received.
OK   Direct route (STUN): your public address was found.
OK   Relay (TURN): reachable, credentials accepted.
```

| If you see | Check |
|---|---|
| Matchmaking server not reachable | port 9443/tcp open; `docker compose logs caddy peer`; the domain resolves to this machine |
| Relay credentials: HTTP 403 | the page was opened without `?t=...`, or the token differs from `.env` |
| Relay credentials failed (other) | `docker compose logs web`; is the web container running? |
| Direct route (STUN): no answer | 3478/udp open and forwarded; `PUBLIC_IP` correct |
| Relay (TURN) did not answer | 3478/udp **and** 49160-49200/udp open; `TURN_SECRET` identical for `web` and `coturn` (both read it from `.env`); `docker compose logs coturn` |
| Camera is blocked | the page must be opened over `https://`, not `http://` and not by IP address |

## Without Docker

- **Relay:** install `coturn` and run it with the flags in `docker-compose.yml` (the `coturn` service's `command` list).
- **Matchmaking:** `npx peer --port 9000 --proxied true`.
- **Web server:** in this folder run `npm install`, then `TURN_SECRET=... TURN_HOST=your-domain PEER_HOST=your-domain PEER_PORT=9443 PUBLIC_HTTPS=1 node server.js`.
- **HTTPS:** run Caddy (or any proxy that handles WebSockets) with the `Caddyfile`, replacing `web:3000` and `peer:9000` with `localhost:3000` and `localhost:9000`.

## Security notes

- Anyone who can reach `https://YOUR-DOMAIN/turn` can use your relay, which costs you bandwidth. Set `ACCESS_TOKEN` and share only the full link. `/turn` also refuses more than 60 requests a minute from one address.
- The relay refuses to forward traffic to private network ranges, so it cannot be used to reach other machines on your network. If everyone, including the server, is on one home network and you are testing, direct connections work without the relay.
- Keep `.env` private. Changing `TURN_SECRET` invalidates all credentials already issued.
- The server only ever serves `index.html`, `algo.js`, `worker.js`, `net-config.js`, the two library files and the PeerJS browser file.

## Status

The web server and the page were tested together in a browser: credentials checked against an independent calculation, only the intended files served, and every network request from the page went to your own server. The coturn, peer-server and Caddy parts use standard images and options, but were not run together where this was written, so the check above is how you confirm your setup.
