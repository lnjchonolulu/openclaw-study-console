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
7. `sudo cp deploy/cyworld-task-reviews.service deploy/cyworld-task-reviews.timer /etc/systemd/system/`
8. `sudo systemctl daemon-reload`
9. `sudo systemctl enable --now openclaw-study cyworld-task-reviews.timer`

The service runs `next start` on port `3000`. For quick staging, you can open:

- `http://SERVER_IP:3000/login`

Later, put Nginx or Caddy in front for HTTPS and a cleaner URL.

## OpenClaw HTTP API

The app should talk to OpenClaw through the Gateway HTTP responses endpoint instead of
spawning CLI commands for every turn.

Enable the endpoint in your Gateway config and expose:

```env
APP_BASE_URL="http://SERVER_IP:3000"
OPENCLAW_RESPONSES_URL="http://127.0.0.1:18789/v1/responses"
OPENCLAW_GATEWAY_TOKEN="..."
INTERNAL_AGENT_ACTION_TOKEN="..."

# Optional wakeup/tool tuning
CYWORLD_TASK_REVIEW_LEASE_MINUTES="15"
CYWORLD_OPENCLAW_TOOL_ROUND_CHECKPOINT="10"
CYWORLD_OPENCLAW_EMERGENCY_TOOL_ROUND_LIMIT="100"
# Optional diagnostic mode. Use "none" to omit CyWorld runtime instructions
# while keeping direct CyWorld tools available.
CYWORLD_AGENT_RUNTIME_MODE="full"
# Optional diagnostic flags for runtime full. Defaults are "1". Disable one at
# a time when isolating whether conversation flow, selected notes, or Drive
# context is competing with durable OpenClaw workspace files.
CYWORLD_AGENT_INCLUDE_RECENT_CONTEXT="1"
CYWORLD_AGENT_INCLUDE_SELECTIVE_NOTES="1"
CYWORLD_AGENT_INCLUDE_FILES_CONTEXT="1"
# Conversation sessions automatically include a short hash of USER.md,
# IDENTITY.md, SOUL.md, and HEARTBEAT.md so preference/identity edits start a
# fresh OpenClaw response session. The app sends OpenClaw a sanitized
# cyworld-... key rather than a room:... key to avoid reserved session prefixes.
# Set this to "1" to include AGENTS.md too.
CYWORLD_AGENT_SESSION_INCLUDE_AGENTS_MD="0"
# Optional debug logging for the sanitized OpenClaw request user key.
CYWORLD_OPENCLAW_SESSION_DEBUG="0"
```

This keeps local web development fast while still using the real Hetzner-hosted agent state.
Agent-scheduled wakeups are delivered by `cyworld-task-reviews.timer`; ordinary waiting
tasks are not automatically reconsidered. Ten tool rounds are a durable checkpoint, not a
normal stopping point; the emergency limit is only a final runaway-process fuse.

## Shared Google integration

CyWorld connects one shared Google account in the app backend for outbound email and
Google Workspace actions. Agents should use CyWorld tools for these actions; they should
not treat the Google account as their own personal account. CyWorld Calendar remains the
source of truth inside the app and is not mirrored to Google Calendar.

Google Slides, Docs, and Sheets editing use their native Google Workspace APIs directly.
The file owner must share the file with the connected Google account and grant Editor
access. The agent inspects the file first, proposes native API `batchUpdate` requests, and
CyWorld validates, executes, and records the result.

Create a Google OAuth client and add these environment variables:

```env
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
GOOGLE_REDIRECT_URI="http://SERVER_IP:3000/api/integrations/google/callback"
```

The OAuth client needs these scopes:

- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/presentations`
- `https://www.googleapis.com/auth/documents`
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/userinfo.email`

Enable the Google Slides API, Google Docs API, and Google Sheets API in the same Google
Cloud project. Existing installations must reconnect Google once after adding these scopes.

## Next implementation steps

- Add Prisma client and migrations.
- Harden study-only auth and session management.
- Expand the OpenClaw-backed chat route into streaming responses.
- Add room membership and room agent management routes.
- Replace placeholder file UI with real upload/download endpoints.
- Generate `SOUL.md` from structured agent settings saved in Postgres.
