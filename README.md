# OpenClaw Study Console

This repository is the MVP web app that sits in front of an OpenClaw gateway running on the
same Hetzner VPS.

## Architecture

- `OpenClaw Gateway`: already running on the Hetzner host
- `Next.js app`: participant-facing interface
- `PostgreSQL`: study accounts, teams, messages, file metadata
- `Local file storage`: participant uploads and generated artifacts on the VPS

## Product shape

- Study-only username/password accounts
- One personal OpenClaw agent per participant
- Team collaboration without a dedicated team agent
- Tabs for `Chat`, `Files`, `Agent`, and `Team`

## Collaboration model

- `Room` is the primary collaboration object.
- A room can be `PERSONAL`, `TEAM`, or `GROUP`.
- Humans join through `RoomMember`.
- Agents join through `RoomAgent`.
- Files can stay private, be shared to a room, or be shared to a whole team.
- Personal agent control stays with the owner even if the agent is allowed to participate in a shared room.

## Local development

1. Install dependencies:

```bash
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env
```

3. Start PostgreSQL:

```bash
docker compose up -d
```

4. Push the Prisma schema and generate the client:

```bash
npm run db:generate
npm run db:push
```

5. Seed the two demo study accounts wired to your OpenClaw agents:

```bash
npm run db:seed-demo
```

This creates:

- `jiyeon / study-jiyeon`
- `hyungjun / study-hyungjun`

6. Start the app:

```bash
npm run dev
```

## Hetzner deployment direction

1. Keep the OpenClaw gateway on the VPS.
2. Run this Next.js app on the same host.
3. Run PostgreSQL with Docker Compose on the same host.
4. Point the app backend at the local OpenClaw gateway URL and token.
5. Add Nginx or Caddy later to expose the web app over HTTPS.

## Staging deployment on Hetzner

Use the Hetzner host as a persistent staging environment:

1. `git pull`
2. `npm install`
3. `npx prisma generate`
4. `npx prisma db push`
5. `npm run build`
6. `sudo cp deploy/openclaw-study.service /etc/systemd/system/openclaw-study.service`
7. `sudo systemctl daemon-reload`
8. `sudo systemctl enable --now openclaw-study`

The service runs `next start` on port `3000`. For quick staging, you can open:

- `http://SERVER_IP:3000/login`

Later, put Nginx or Caddy in front for HTTPS and a cleaner URL.

## OpenClaw HTTP API

The app should talk to OpenClaw through the Gateway HTTP responses endpoint instead of
spawning CLI commands for every turn.

Enable the endpoint in your Gateway config and expose:

```env
OPENCLAW_RESPONSES_URL="http://127.0.0.1:18789/v1/responses"
OPENCLAW_GATEWAY_TOKEN="..."
```

This keeps local web development fast while still using the real Hetzner-hosted agent state.

## Next implementation steps

- Add Prisma client and migrations.
- Harden study-only auth and session management.
- Expand the OpenClaw-backed chat route into streaming responses.
- Add room membership and room agent management routes.
- Replace placeholder file UI with real upload/download endpoints.
- Generate `SOUL.md` from structured agent settings saved in Postgres.
