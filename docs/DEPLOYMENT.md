# Deployment guide

## TL;DR — single server (recommended)

One Node process serves the SPA **and** Socket.IO. No database, no object storage, no queues.

```bash
npm ci
npm run build
PORT=3001 node server/dist/index.js
```

Put any TLS-terminating proxy in front (Caddy, nginx, or the platform's edge). **HTTPS is required in production** — browsers only expose camera/microphone on secure origins.

### Environment variables

| Variable                                      | Where        | Default                 | Purpose                                         |
| --------------------------------------------- | ------------ | ----------------------- | ----------------------------------------------- |
| `PORT`                                        | server       | `3001`                  | Listen port                                     |
| `CLIENT_ORIGIN`                               | server       | `http://localhost:5173` | CORS allow-origin for split deployments         |
| `VITE_SERVER_URL`                             | client build | _(same origin)_         | Socket server URL when hosted separately        |
| `VITE_TURN_URL`                               | client build | —                       | TURN server (e.g. `turn:turn.example.com:3478`) |
| `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` | client build | —                       | TURN credentials                                |

### Example: Caddy on a $5 VPS

```
meet.example.com {
    reverse_proxy localhost:3001
}
```

Caddy handles TLS + WebSocket upgrade automatically. A 1 vCPU / 512 MB box handles hundreds of concurrent rooms — media is peer-to-peer and never touches the server.

### Platforms

- **Fly.io / Railway / Render** — deploy as a plain Node app: build command `npm ci && npm run build`, start command `node server/dist/index.js`. All three pass WebSockets through. Render's free tier sleeps (cold starts); rooms are in-memory, so a sleep wipes them — acceptable for hobby use, use a paid always-on instance otherwise.
- **Not suitable:** Vercel/Netlify functions for the server (no long-lived WebSockets). You _can_ host the static client there (split deploy below).

## Split deployment (static CDN + tiny socket server)

1. Deploy the server anywhere Node runs; set `CLIENT_ORIGIN=https://app.example.com`.
2. Build the client with `VITE_SERVER_URL=https://ws.example.com` and host `client/dist` on any static host/CDN.

## TURN (recommended for production)

STUN alone fails for ~10–15% of peer pairs (symmetric NATs, strict firewalls). Options:

- **coturn** (self-hosted, open source): one small VM, `turnserver` with long-term credentials; TURN traffic only flows for the peers that need relay.
- Managed: Cloudflare Calls TURN, Twilio NTS, Metered.ca.

Set the three `VITE_TURN_*` variables at client build time.

## Scaling notes

| Concern                                       | Answer                                                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| More rooms                                    | Vertical first — signaling is trivial JSON; a single instance goes very far.                                                                         |
| Multiple instances                            | Add sticky sessions + the socket.io Redis adapter, or shard rooms by code prefix at the proxy. Rooms are self-contained, so sharding is clean.       |
| >4–5 people per room, recording, mobile-heavy | Move media to an SFU (LiveKit self-hosted). See `docs/ROADMAP.md` — the room/chat/sync layers are transport-agnostic and survive the swap unchanged. |
| Server restart                                | Clients auto-rejoin with their stable identity; rooms re-form. In-flight chat history is lost (by design — nothing persists).                        |

## Operational checklist

- [ ] HTTPS on (WebRTC requirement)
- [ ] TURN configured (`VITE_TURN_*`)
- [ ] `CLIENT_ORIGIN` set if split-deployed
- [ ] `/healthz` wired to your uptime monitor
- [ ] Reverse proxy timeout ≥ 120 s for WebSocket idle
