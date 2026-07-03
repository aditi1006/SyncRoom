# Development guide

## Prerequisites

- Node.js ≥ 20, npm ≥ 10.

## Setup

```bash
npm install    # one install for all three workspaces
npm run dev    # server :3001 (tsx watch) + client :5173 (Vite HMR)
```

The Vite dev server proxies `/socket.io` to `:3001`, so the app is same-origin in development — open <http://localhost:5173>.

To exercise multi-party behavior locally, open a second incognito window (separate `sessionStorage` → separate participant identity).

## Repo layout

```
shared/src/
  types.ts       # domain types (Participant, RoomSnapshot, SyncState, ChatMessage…)
  protocol.ts    # typed Socket.IO event maps — the single protocol source of truth
  roomCode.ts    # code/name validation + generation
  mediaUrl.ts    # URL → {kind, providerId} classification (YouTube/Drive/HLS/DASH/file)
  sync.ts        # expectedTime, drift correction policy, ClockSync
  limits.ts      # shared operational caps

server/src/
  index.ts       # http + express static + Socket.IO bootstrap
  room.ts        # Room aggregate: members, host powers, chat, queue, sync mutations
  roomManager.ts # registry + empty-room reaping
  handlers.ts    # every socket event: validate → rate-limit → mutate → broadcast
  rateLimiter.ts # token buckets

client/src/
  components/    # presentational primitives (Button, Modal, Select, Toasts…)
  features/
    home/        # landing page
    lobby/       # pre-join preview
    room/        # RoomPage orchestrator, VideoGrid/Tile, ControlBar, TopBar, panels
    call/        # useLocalMedia, usePeerConnections (WebRTC mesh), useCallStats, devices
    chat/        # ChatPanel, MessageBubble
    sync/        # useSyncEngine, PlayerStage, SyncPanel, adapters/ (youtube, html5)
    settings/    # SettingsModal
  hooks/         # useTheme, useFullscreen, useKeyboardShortcuts
  lib/           # socket singleton + clock sync, session identity, wireSocket, utils
  store/         # zustand: room (ephemeral), settings (persisted)
```

## Conventions

- **Strict TypeScript everywhere**; `npm run typecheck` must pass. The socket protocol is typed via shared event maps — change `protocol.ts` first, then both sides.
- ESLint flat config + Prettier at the root: `npm run lint`, `npm run format`.
- Feature-based folders; UI primitives stay dumb, feature logic lives in hooks.
- Server never trusts the client: validate every payload in `handlers.ts` and enforce permissions on the `Room` aggregate.

## Testing

| Layer                                                                                                                                        | Where                                | Run                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| Unit (validation, sync math, URL parsing)                                                                                                    | `shared/test`                        | `npm test -w shared`                                                           |
| Unit (room aggregate, rate limiter)                                                                                                          | `server/test/room.test.ts`           | `npm test -w server`                                                           |
| Integration (real sockets end-to-end: join/lock/kick/chat/sync/signal relay)                                                                 | `server/test/integration.test.ts`    | `npm test -w server`                                                           |
| Unit (SyncController invariants: diff-apply, echo consumption, seq gate, seek debounce, drift bands, capability degradation, autoplay stall) | `client/test/syncController.test.ts` | `npm test -w client`                                                           |
| E2E (Chromium + Firefox + Edge, fake media devices, two-party room + chat + media validation)                                                | `e2e/`                               | `npm run build && npx playwright install chromium firefox && npm run test:e2e` |

## Common tasks

**Add a socket event** — add it to `ClientToServerEvents`/`ServerToClientEvents` in `shared/src/protocol.ts`; implement in `server/src/handlers.ts` (guard → validate → mutate → broadcast); consume via `socket.emit`/`wireSocket.ts`.

**Add a media source** — extend `parseMediaUrl` in shared (+ tests); if the HTML5 element can play it, you're done; otherwise implement a `PlayerAdapter` and register it in `useSyncEngine`.

**Change quality presets** — `client/src/store/settings.ts` (`QUALITY_CONSTRAINTS`, `QUALITY_MAX_BITRATE`).

## Sync debug mode

Append `?debug` to the room URL (or set `localStorage['syncroom:debug'] = '1'` for a persistent opt-in) to render a diagnostics HUD over the player: current provider, controller phase, playback state, position, live drift vs. authority, last sync event, socket RTT, and sent/received/dropped message counters. The overlay is off by default and adds no cost when disabled. The counters live in `client/src/features/sync/debug.ts`; the state machine itself is `client/src/features/sync/SyncController.ts` — read its class comment for the four invariants that keep sync loop-free.
