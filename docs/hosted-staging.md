# Polo Champions Hosted Staging Runbook

Gate 6 prepares a hosted staging split: Vercel serves the Vite frontend and Render runs one persistent Node.js WebSocket service. Do not point production players at staging until the post-deployment verification checklist passes.

## Architecture

- Frontend: Vercel static Vite build from `npm run build`, output directory `dist`.
- Realtime: Render Web Service using the repository `Dockerfile`, command `node server/realtime-server.mjs`.
- Browser WebSocket URL: supplied at Vercel build time through `VITE_WEBSOCKET_URL`.
- Rooms, matches, reconnect slots, score, chat, and leaderboard are in memory on the Render instance.
- Render restarts, deploys, free-tier spin-down, or maintenance clear all active rooms and matches.

## Render Staging Settings

Create a new Render Web Service only after approval.

- Name: `polo-champions-realtime-staging`
- Runtime: Docker
- Dockerfile path: `./Dockerfile`
- Docker context: `.`
- Region: Oregon, unless a closer region is explicitly selected
- Instance count: 1
- Health check path: `/api/health`
- Plan: Free for smoke staging, Starter or higher for always-on testing
- Auto-deploy: disabled until staging is verified, then optional

Environment variables:

- `NODE_ENV=production`
- `PORT=8080`
- `WS_ALLOWED_ORIGINS=https://<vercel-staging-domain>`
- `MAX_CONNECTIONS=200`
- `MAX_ACTIVE_ROOMS=100`
- `MAX_PENDING_LOBBIES=100`
- `MAX_WS_MESSAGE_BYTES=8192`

Do not set `POLO_TEST_PROTOCOL` in Render.

## Vercel Staging Settings

Create or use a non-production Vercel project/environment only after approval.

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Install command: default `npm install` or `npm ci` if lockfile policy requires it
- Environment variable: `VITE_WEBSOCKET_URL=wss://<render-service>.onrender.com`

Keep the existing live production Vercel project unchanged until staging is verified.

## Production-Mode Local Smoke

Use this shape for local production checks:

```bash
NODE_ENV=production \
WS_ALLOWED_ORIGINS=http://127.0.0.1:4173 \
PORT=8080 \
node server/realtime-server.mjs
```

Expected checks:

- `GET /api/health` returns `200` and `{ "status": "ok" }`.
- `GET /api/ready` returns `200` with `testProtocol:false` when `WS_ALLOWED_ORIGINS` is set.
- `GET /api/ready` returns `503` with `originPolicy:"required-missing"` when `NODE_ENV=production` and the allowlist is missing.
- WebSocket connections from disallowed origins are rejected.
- Allowed origins can create/join a room and start a match.
- Oversized messages close with code `1009`.
- `TEST_CONTROL` messages are ignored in production.

## Rollback

- Vercel: promote the previous deployment or remove the staging environment variable from the staging project.
- Render: roll back to the previous deploy, or suspend/delete only the staging service.
- If a bad Vercel staging build points at production, unset `VITE_WEBSOCKET_URL` or restore the prior staging deployment.

## Approval Gate

Before creating resources, changing cloud settings, adding billing, or pushing commits, request explicit approval with:

- Render service name and plan
- Vercel project/environment name
- Allowed frontend origin
- Expected monthly cost
- Rollback owner
