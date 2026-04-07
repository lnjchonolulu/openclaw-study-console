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

## Next implementation steps

- Add Prisma client and migrations.
- Harden study-only auth and session management.
- Expand the OpenClaw-backed chat route into streaming responses.
- Replace placeholder file UI with real upload/download endpoints.
- Generate `SOUL.md` from structured agent settings saved in Postgres.
