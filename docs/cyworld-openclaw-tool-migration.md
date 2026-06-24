# CyWorld Tool Migration Audit

This note tracks the work needed to restore OpenClaw's native workspace/file
tools while keeping CyWorld social and app tools available.

## Problem

CyWorld currently calls OpenClaw `/v1/responses` with an explicit
`tools: CYWORLD_AGENT_TOOLS` list for real agent turns. That makes the CyWorld
tools visible, but it likely replaces the normal OpenClaw tool surface for that
turn. The observed failure is that agents can use CyWorld DM/Calendar/Drive
tools, but no longer reliably update `USER.md`, `SOUL.md`, `WORKLOG.md`, or
`context/*` with native OpenClaw workspace tools.

The target behavior is:

- OpenClaw native workspace tools remain available for agent-owned memory,
  planning, and file edits.
- CyWorld tools remain available for CyWorld side effects and permissioned app
  data.
- CyWorld does not create duplicate markdown-memory tools just to compensate for
  hidden native tools.

## Current Coverage

`src/lib/cyworld-agent-tools.ts` defines 33 app-side tools.

`openclaw-plugins/study-console/index.js` now exposes 7 plugin tools:

- `study_send_dm`
- `study_schedule_dm`
- `study_list_pending_tasks`
- `study_recall_conversation`
- `study_update_owner_sharing_policies`
- `study_set_relationship_guidance`
- `study_schedule_wakeup`

The original plugin tools call these internal endpoints:

- `/api/internal/agent-actions/send-dm`
- `/api/internal/agent-actions/schedule-dm`
- `/api/internal/agent-actions/pending-tasks`

Those three were probably added because they were the smallest tools needed to
make agents aware that CyWorld participant messaging and action-log inspection
exist. They need relatively little current-turn context compared with tools that
depend on the current room, current human, attachment, calendar viewer, or
request provenance.

The four newer plugin tools call the generic context-aware endpoint:

- `/api/internal/agent-actions/tool-call`

## Classification Rule

Keep a function as a CyWorld tool when it needs CyWorld-only state, permission
enforcement, routing, app-side side effects, external shared accounts, or durable
action receipts.

Do not create CyWorld tools for work that belongs to the agent's private
OpenClaw workspace:

- editing `USER.md`, `SOUL.md`, `IDENTITY.md`, `HEARTBEAT.md`, `WORKLOG.md`
- editing `context/people/*.md` and `context/team-rooms/*.md`
- ordinary local note taking, planning, or private workspace file management

Those should be handled by OpenClaw native workspace tools once explicit
CyWorld tool injection no longer hides them.

## Tool Audit

| Tool | Plugin now | Native OpenClaw substitute? | CyWorld context/permission needed | Migration priority |
| --- | --- | --- | --- | --- |
| `study_send_dm` | Yes | No | recipient validation, DM routing, receipts | Keep, already migrated |
| `study_schedule_dm` | Yes | No | scheduled delivery, recipient validation, receipts | Keep, already migrated |
| `study_list_pending_tasks` | Yes | No | CyWorld action log/task receipts | Keep, already migrated |
| `study_recall_conversation` | Yes | No | current room/DM/team context and memory-sharing policy | P1 migrated |
| `study_update_owner_sharing_policies` | Yes | No | owner-only permission and DB behavior config | P1 migrated |
| `study_set_relationship_guidance` | Yes | No | owner-only permission and relationship-guidance DB rows | P1 migrated |
| `study_schedule_wakeup` | Yes | No | agent task/wakeup records and source-room provenance | P1 migrated |
| `study_request_agent_action` | No | No | Agent Handoff routing, task provenance, target-agent permissions | P2 |
| `study_list_calendar` | No | No | current human/owner sharing policy/calendar DB | P2 |
| `study_create_calendar_event` | No | No | current-human calendar mutation and invite permissions | P2 |
| `study_update_calendar_event` | No | No | current-human calendar mutation and event IDs | P2 |
| `study_delete_calendar_event` | No | No | current-human calendar visibility/RSVP semantics | P2 |
| `study_update_calendar_rsvp` | No | No | current-human invitation identity | P2 |
| `study_schedule_video_call` | No | No | current-human organizer, invited humans, Calendar integration | P2 |
| `study_create_drive_folder` | No | No | CyWorld Drive ACLs and file records | P2 |
| `study_create_google_workspace_file` | No | No | shared Google account plus CyWorld Drive registration | P2 |
| `study_inspect_google_docs` | No | Not safely | shared Google account and CyWorld access authorization | P2 |
| `study_update_google_docs` | No | Not safely | shared Google account, authorization, receipts | P2 |
| `study_write_google_docs_text` | No | Not safely | shared Google account, authorization, receipts | P2 |
| `study_inspect_google_sheets` | No | Not safely | shared Google account and CyWorld access authorization | P2 |
| `study_update_google_sheets` | No | Not safely | shared Google account, authorization, receipts | P2 |
| `study_inspect_google_slides` | No | Not safely | shared Google account and CyWorld access authorization | P2 |
| `study_update_google_slides` | No | Not safely | shared Google account, authorization, receipts | P2 |
| `study_inspect_google_file_review` | No | Not safely | shared Google account, Drive comments authorization | P2 |
| `study_update_google_file_review` | No | Not safely | shared Google account, Drive comments authorization | P2 |
| `study_request_google_file_review` | No | Not safely | shared Google account, Drive comments authorization | P2 |
| `study_list_email_threads` | No | No | tracked CyWorld Shared Gmail threads for this agent | P2 |
| `study_send_email` | No | No | shared Gmail account, attachment permission, receipts | P2 |
| `study_reply_email_thread` | No | No | tracked thread ownership and Gmail threading headers | P2 |
| `study_send_calendar_invite_email` | No | No | shared Gmail plus optional CyWorld Calendar event | P2 |
| `study_generate_image` | No | Partial | result must be posted as CyWorld chat attachment | P3 |
| `study_edit_image` | No | Partial | current-room image attachment lookup and posting | P3 |
| `study_save_chat_attachment_to_drive` | No | No | current-room attachment lookup and CyWorld Drive ACLs | P3 |

## Context Bridge Requirement

Most missing plugin tools cannot be safely migrated by copying their schemas into
the plugin. The app-side direct-injection path currently calls
`handleCyWorldAgentToolCall` with closure context:

- `senderAgentOpenclawId`
- `currentHumanUserId`
- `requesterUserId`
- `sourceRoomId`
- `taskId`
- `triggerType`
- `objective`

Plugin tools do not automatically know those facts. They can usually derive the
agent id, but not the current CyWorld room, current human, attachment context,
requester, or task provenance.

Before migrating context-sensitive tools, add a small context bridge:

1. When CyWorld starts an agent-facing turn, create a short-lived turn context
   record containing the fields above.
2. Include the turn context id in runtime instructions or plugin-accessible
   configuration for that turn.
3. Plugin tools send `agentOpenclawId` and `turnContextId` to a new internal
   tool-call endpoint.
4. The internal endpoint validates the token, loads the turn context, checks
   that it belongs to the acting agent and is not expired, then delegates to
   the existing `handleCyWorldAgentToolCall`.

This preserves CyWorld permissions and action receipts while letting OpenClaw
assemble native workspace tools and CyWorld plugin tools together.

Recommended storage: add a small dedicated model rather than reusing
`AgentToolExecution`.

`AgentToolExecution` is already an execution receipt for a concrete tool call,
with idempotency and final result fields. A turn context is different: it is
short-lived provenance for a whole OpenClaw turn, and several plugin tool calls
may reference it. Mixing the two would make the receipt table double as ambient
runtime state.

Minimal model shape:

```prisma
model AgentTurnContext {
  id                 String   @id @default(cuid())
  agentId            String
  currentHumanUserId String?
  requesterUserId    String?
  sourceRoomId       String?
  taskId             String?
  triggerType        String?
  objective          String?
  expiresAt          DateTime
  createdAt          DateTime @default(now())
  agent              Agent    @relation(fields: [agentId], references: [openclawAgentId], onDelete: Cascade)

  @@index([agentId, expiresAt])
  @@index([sourceRoomId, createdAt])
}
```

The context should be created only for agent-facing CyWorld turns where plugin
tools may need current room/current human provenance. Pure classifier and
arbiter calls do not need it.

## First Migration Slice

Do not remove explicit `tools: CYWORLD_AGENT_TOOLS` from real agent turns yet.

The context bridge has been implemented for a small set of memory/social tools:

- `study_recall_conversation`
- `study_update_owner_sharing_policies`
- `study_set_relationship_guidance`
- `study_schedule_wakeup`

These are the smallest useful first tools because they support the preference and
relationship-memory problem without requiring the full Google/Drive/Calendar
surface.

After those are plugin-backed, test in a live agent workspace:

1. Owner says: "Do not use bold markdown in replies."
2. Agent should update its own markdown through native OpenClaw workspace tools.
3. Next reply should follow the preference.
4. Agent should still be able to send a CyWorld DM through the plugin.

Only after plugin-backed CyWorld tools and native workspace tools both work in
the same agent-facing turn should direct tool injection be reduced or disabled.

## Verification Before Reducing Direct Tool Injection

Do not change app calls to omit `tools: CYWORLD_AGENT_TOOLS` until these checks
pass on the live server:

1. Apply the Prisma schema change to the live database.
2. Install or reload the updated `study_console` plugin.
3. Confirm the plugin exposes these seven tools:
   - `study_send_dm`
   - `study_schedule_dm`
   - `study_list_pending_tasks`
   - `study_recall_conversation`
   - `study_update_owner_sharing_policies`
   - `study_set_relationship_guidance`
   - `study_schedule_wakeup`
4. In an owner DM, run a plugin-backed preference flow:
   - owner says not to use bold markdown
   - agent updates its own markdown with native OpenClaw workspace tools
   - next reply follows that preference
5. In the same mode, confirm a plugin-backed CyWorld action still works:
   - ask the agent to send a DM to another participant
   - verify a CyWorld DM receipt/message is created
6. Confirm context-sensitive plugin tools work:
   - `study_recall_conversation` can recall the current DM without explicitly
     naming the room
   - `study_set_relationship_guidance` succeeds only when the current human is
     the owner
   - `study_schedule_wakeup` creates an `explicit_wakeup` task with the correct
     source room/requester provenance

Only after those pass should a feature flag be introduced for agent-facing turns
to omit explicit tools and let OpenClaw assemble native tools plus plugin tools.
Classifier and arbiter calls can remain explicit or tool-free because they are
not expected to edit workspace memory.

## Plugin Experiment Status

The narrow owner-DM plugin experiment was retired. Current OpenClaw inspection
suggests `/v1/responses` still uses the native runner and merges native tools
with client function tools, so the immediate issue is prompt pressure and
scaffold/runtime size rather than a direct tool-surface replacement.

The current migration step is to keep direct CyWorld tool injection, reduce
AGENTS.md / TOOLS.md / runtime pressure, and preserve detailed CyWorld behavior
in tool descriptions, visible resource context, and compact workspace files.
