# POLO CHAMPIONS

Playable browser polo with a Three.js/Rapier field, a canonical 12-rider roster, authoritative Node.js WebSocket multiplayer, private room codes, chat, scoring, match clock, reconnects, and rematches.

## Local Development

```bash
npm install
npm run dev
```

The Vite client runs on `http://127.0.0.1:4173` during Playwright and the realtime server listens on `ws://localhost:8080` by default.

## Realtime Server

```bash
npm run server:realtime
```

Health checks:

- `GET /api/health` confirms the process and match engine are alive.
- `GET /api/ready` reports uptime, active lobbies, active matches, clients, origin policy, and whether the test protocol is enabled.

Useful environment variables:

- `PORT`: realtime server port. Defaults to `8080`.
- `WS_ALLOWED_ORIGINS` or `ALLOWED_ORIGINS`: comma-separated browser origins allowed to open WebSocket connections. When omitted, the server only allows no-origin clients and local development origins.
- `POLO_TEST_PROTOCOL=1`: enables deterministic Playwright-only test controls. It is ignored when `NODE_ENV=production`.

## Production Hosting

The browser client and the persistent WebSocket process can be hosted separately. Static-only hosts such as Vercel frontend deployments should point the client at a separate long-running realtime service.

Client configuration:

```bash
VITE_WEBSOCKET_URL=wss://your-realtime-service.example.com
```

If `VITE_WEBSOCKET_URL` is not set, non-local pages try a same-origin WebSocket URL. HTTPS pages require `wss://`; insecure `ws://` endpoints are rejected before the lobby claims a connection.

Server configuration example:

```bash
PORT=8080
NODE_ENV=production
WS_ALLOWED_ORIGINS=https://your-frontend.example.com
```

## Controls

- WASD: ride and steer
- Shift: gallop
- X: brake
- Space: hold/release forehand strike
- Q: hold/release backhand strike
- Mouse or right stick: aim
- R: reset ball in local mode
- Esc: pause
- Touch: on-screen joystick, gallop, and swing controls

## Verification

```bash
npm run build
npm test
npx playwright test tests/network.spec.ts
```

Gate-specific browser verification should use two independent Chromium contexts connected to the actual Node.js realtime server.
