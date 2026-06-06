# Open Issues

## CyWorld Final Integration Roadmap

CyWorld's core goal is to become a collaborative space where humans bring their
own OpenClaw agents into shared work. The product should support the social and
work dynamics that follow from that premise: private owner-agent work, DM
handoffs, team-chat participation, shared files, calendars, email, and agent
follow-ups.

The main architecture principle:

- OpenClaw should remain the agent brain: reasoning, drafting, deciding whether
  to act, using files, and performing work inside its workspace.
- CyWorld should remain the social and permission layer: identity, room
  membership, visibility, delivery, file/calendar/email permissions, audit
  records, and user-facing UI.
- The integration layer must translate between those two worlds without making
  brittle hidden assumptions.

### Current System Read

What is working:

- CyWorld calls OpenClaw through `openclaw:{agentId}`, so each personal agent can
  be addressed independently.
- CyWorld provides app-level tools for DM, scheduled DM, CyWorld Calendar, shared
  Gmail, and external calendar invite email.
- Team chat can now let agents respond to other agents in controlled chains.
- CyWorld records many app-mediated actions as durable receipts and reintroduces
  recent receipts into later OpenClaw turns.
- Runtime context now explicitly distinguishes the stable owner from the current
  human, including whether the current human is the owner.
- The app has DB-level concepts for humans, agents, rooms, messages, tasks,
  files, calendars, email threads, and settings.

What is still fragile:

- Some routing and validation logic still has legacy phrase-matching remnants.
  This is reduced, but it should be audited so CyWorld does not silently convert
  ordinary conversation into an action request.
- OpenClaw's native worldview is owner/workspace-oriented, while CyWorld's
  worldview is multi-human and multi-agent. Owner/current-human facts are now
  injected, but every OpenClaw entrypoint still needs a boundary audit.
- CyWorld Drive is mirrored into OpenClaw workspace state, but the sync and
  managed instructions still need production verification across all agents.
- Calendar and Gmail are CyWorld backend tools, not OpenClaw-native tools, so
  agents must reliably learn to use the CyWorld route instead of looking for
  unavailable native tools.
- Long-running tasks, replies, follow-ups, and cross-room handoffs are present
  but not yet systematically tested against multiple simultaneous tasks.

### Recent Work Classification

The recent large integration pass touched several roadmap items:

- **Item 1, action/task/receipt handling:** substantially advanced. App-mediated
  actions now have a more consistent receipt path, and recent receipts can be
  reintroduced into OpenClaw turns.
- **Item 2, runtime context boundaries:** substantially advanced. OpenClaw calls
  now distinguish stable owner facts from current-human facts, which directly
  targets owner confusion in non-owner DMs and shared spaces.
- **Item 3, CyWorld resource vocabulary/tool paths:** partially advanced through
  CyWorld scaffold, Drive, Calendar, Gmail, and tool wording, but this remains
  the next major area needing practical scenario hardening.
- **Item 5, team-chat observability:** partially advanced. Team-agent chains now
  exist with controlled continuation, but the reasons for speak/silence/reject
  still need better inspection.

So the latest large work should be read mostly as **Item 1 + Item 2**, with
partial progress on **Item 3** and **Item 5**. Item 2 is not "finished" until the
finishing audit below confirms every OpenClaw entrypoint follows the same
runtime boundary.

### Development Direction

1. Define the OpenClaw-CyWorld contract.

   Document and enforce the exact meaning of owner, current human, non-owner
   human, personal agent, other agent, DM, team channel, CyWorld Drive, CyWorld
   Calendar, shared Gmail, task, action receipt, and permission boundary.

2. Reduce brittle intent routing.

   CyWorld should not silently infer major actions from loose wording. OpenClaw
   may propose tool calls, but CyWorld must validate recipients, permissions,
   room context, and action scope. If the target or intent is ambiguous, the
   system should ask a clarification instead of guessing.

3. Make CyWorld resources first-class to agents.

   Agents need stable, repeated language and workspace context for CyWorld
   Drive, CyWorld Calendar, shared Gmail, and team channels. The goal is not to
   bypass OpenClaw, but to make these resources feel like legitimate tools and
   workspace areas inside OpenClaw's normal operating model.

4. Standardize action receipts and task continuity.

   When an agent sends a DM, schedules a message, creates an event, sends email,
   uploads a file, or receives a reply, that outcome should be written back into
   the conversation/task context so the agent can later know what it did.

5. Build scenario tests before adding more product surface.

   The system should be tested with realistic workflows, not only UI clicks:

   - Owner asks their agent to ask another human a question.
   - A non-owner asks someone else's agent for calendar information.
   - Two agents advance a team-chat topic without a human re-prompt.
   - An agent creates or edits a CyWorld Drive file and the UI reflects it.
   - A shared Gmail reply routes back to the correct agent/task.
   - After completing or partially completing a task, an agent reports progress
     to the appropriate DM or team channel.
   - Multiple pending tasks exist at once and replies do not cross wires.

   The detailed contract and scenario matrix live in
   `docs/openclaw-cyworld-contract.md`.

### Code-First Improvement Priorities

This priority list is based on the current implementation, not only on the
product idea. The recurring risk is that CyWorld has many partially working
integration paths, but they do not all follow the same action lifecycle.

1. Unify action, task, and receipt handling. **Status: mostly implemented,
   needs coverage audit.**

   Every agent-initiated CyWorld action should move through the same lifecycle:
   OpenClaw proposes the action, CyWorld validates permissions and targets,
   CyWorld executes it, CyWorld records a durable receipt, and the receipt is
   reintroduced into later OpenClaw turns. This should cover DM delivery,
   scheduled DM, calendar actions, shared Gmail, external calendar invite
   email, Drive imports/exports, and follow-up reports. The core building
   blocks exist (`AgentTask`, `AgentTaskEvent`, `EmailThread`, `Message.taskId`,
   receipt records, and recent receipt injection). The remaining work is to
   verify that no action path bypasses the lifecycle, especially Drive sync,
   follow-up reports, failed tool calls, and externally triggered email replies.

2. Clean up runtime context boundaries. **Status: mostly implemented, needs a
   finishing audit.**

   Durable identity and operating knowledge should live in the OpenClaw
   workspace files and managed scaffold. Per-turn facts should stay in runtime
   context: current human, room, timezone, active task, current permissions, and
   fresh receipts. Runtime context should not become a hidden second personality
   system that fights OpenClaw's markdown workspace.

   Finishing this item means:

   - Inventory every CyWorld-to-OpenClaw call site.
   - Confirm each call passes the same hard facts where relevant: agent, owner,
     current human, owner match, room type, timezone, active task, recent
     receipts, and visible CyWorld resources.
   - Remove or mark any runtime instruction that duplicates durable identity,
     personality, or owner preferences better kept in markdown.
   - Confirm `USER.md` is treated as the owner profile, not as the current
     human profile unless owner match is explicitly true.
   - Confirm task/email/team/DM/calendar/Drive entrypoints all follow the same
     boundary rule.

   This is not a new product feature. It is the pass that prevents OpenClaw's
   native workspace model and CyWorld's multi-user social model from fighting
   each other.

   Latest audit note:

   - Checked all current `runAgentTurn` call sites: direct agent DM, task reply
     matching, outbound task composition, inbound task next-action decisions,
     shared Gmail reply follow-up, team-chat candidate proposal, and team-chat
     arbiter validation.
   - Direct DM, outbound task composition, inbound task next-action decisions,
     shared Gmail follow-up, and team-chat candidate proposal use the shared
     runtime boundary builder.
   - Fixed task reply matching so it receives the replying human timezone and
     owner timezone instead of falling back to null timezone context.
   - Fixed shared Gmail reply follow-up so recent action receipts are included
     in the OpenClaw turn.
   - Fixed team-chat arbiter validation so the arbiter call explicitly says it
     has no single current human and must not treat the arbiter agent's owner as
     the current human.
   - Remaining follow-up: keep future OpenClaw entrypoints on this checklist;
     new calls should either use the shared runtime builder or explicitly state
     why they are non-conversational utility calls.

3. Stabilize CyWorld resource vocabulary and tool paths. **Status: substantially
   implemented, needs scenario verification and future-entrypoint discipline.**

   Agents should consistently understand CyWorld Drive, CyWorld Calendar,
   shared Gmail, DMs, and Team Chat as CyWorld-provided social/tool layers.
   They should not confuse CyWorld Drive with the OpenClaw workspace root or
   look for unavailable native calendar/session/gateway tools when CyWorld
   provides the app-mediated route.

   Latest integration pass:

   - Canonical internal names are now CyWorld Drive, CyWorld Calendar, CyWorld
     DM, CyWorld Team Chat, and Shared Gmail.
   - The canonical vocabulary is for code, tools, scaffold, and explanations;
     it is explicitly not a vocabulary requirement for users.
   - Shared runtime instructions tell OpenClaw to resolve shorthand,
     misspellings, pronouns, and indirect references from conversation history,
     room context, permissions, and visible resources.
   - Direct agent DM turns now always receive a bounded CyWorld Drive context.
     Drive awareness no longer depends on a keyword regex firing.
   - Tool descriptions now describe semantic intent such as asking, telling,
     contacting, checking availability, or emailing, rather than relying only
     on exact product terms.
   - Remaining verification should cover vague references across several
     simultaneously visible files, ambiguous human recipients, calendar versus
     scheduled-message requests, and team-room references.

4. Harden shared Gmail follow-up routing. **Status: implemented at the routing
   layer, needs realistic thread testing.**

   Gmail is a shared resource, but each email thread belongs to a specific
   agent/task/source room. Replies must route back to the correct agent without
   exposing unrelated mailbox content, and the agent should receive enough
   receipt context to decide whether to reply, report to the owner, or report
   to the source room.

5. Improve team-chat observability. **Status: chain mechanics implemented,
   inspection still weak.**

   Team-chat agent chains now exist, but the research/product value depends on
   knowing why an agent spoke, stayed silent, was rejected by the arbiter, or
   stopped a chain. These decisions should be easy to inspect later.

6. Verify Drive sync as production behavior.

   All-agent Drive sync and manifests exist, but the production expectation is
   near-immediate visibility after users or agents change files. Sync timing,
   permission pruning, and agent-created revisions need end-to-end verification.

7. Finalize participant onboarding and scaffold rollout.

   Before deployment, every participant needs a CyWorld account, one OpenClaw
   agent, the shared CyWorld scaffold, a clean owner-specific bootstrap, and
   verified Drive/Calendar/Gmail/Team Chat behavior. Hyungjun-specific content
   must not become the default template for future agents.

### Known Missing Or Incomplete Capabilities

- Agent Handoff is now the first-class primitive for agent-to-agent work outside
  team-chat chains. It uses the target agent's real OpenClaw runtime and durable
  task events without exposing a hidden agent DM UI. Production scenario
  validation is still needed for multi-agent delegation, continuation, privacy,
  and failure recovery.
- CyWorld Drive sync is callable per OpenClaw agent id and has an all-agent
  runner for every active CyWorld user with an OpenClaw agent. It still needs
  production rollout verification so every study agent workspace has the same
  Drive scaffold, manifest, and near-immediate sync behavior.
- File permission enforcement for agents needs a hard contract. App APIs enforce
  DB visibility, but mirrored workspace files also need reliable pruning and
  manifest discipline.
- Team channels need richer metadata so agents can understand room purpose,
  project scope, expected audience, and where follow-ups belong.
- Calendar tool behavior needs more end-to-end testing for timezone, invite,
  RSVP, privacy policy, deletion, and external email invite cases.
- Shared Gmail needs stronger thread/task routing and privacy expectations, since
  all agents use the same mailbox.
- Observability is incomplete. The system should log why agents spoke, stayed
  silent, used a tool, had a tool call rejected, or asked for clarification.

### Code To Revisit Carefully

- `src/lib/cyworld-agent-tools.ts`: recipient validation, tool-call handling,
  calendar/email action behavior.
- `src/lib/agent-routing.ts`: runtime identity, owner/current-human distinction,
  CyWorld tool/resource instructions.
- `src/lib/team-agent-dispatcher.ts`: team-chat agent chain selection,
  continuation, arbiter strictness, and silence decisions.
- `src/lib/cyworld-drive-sync.ts` and `scripts/sync-hyungjun-study-files.mjs`:
  Drive mirror scope, all-agent workspace rollout, and manifest generation.
- `src/lib/email-tracking.ts`: shared Gmail reply routing and follow-up context.

### Pre-Deployment Finalization

Before the actual study deployment, CyWorld needs a dedicated participant and
agent onboarding pass. This is not optional polish; it is required for the study
to work as a multi-agent system rather than a Hyungjun-specific prototype.

Required finalization work:

- Create all study participant accounts.
- Create and register one OpenClaw personal agent for each participant.
- Ensure every participant's agent has the same CyWorld-compatible structural
  setup as Hyungjun's agent, without copying Hyungjun-specific personal content.
- Run the all-agent Drive sync after adding participant agents so their
  workspaces receive `CYWORLD_DRIVE`, `MANIFEST.md`, and the managed Drive
  guidance in `AGENTS.md`/`TOOLS.md`.
- Separate reusable CyWorld agent scaffolding from individual personalization.
- Standardize baseline `AGENTS.md`, `TOOLS.md`, `USER.md`, `IDENTITY.md`,
  `SOUL.md`, and `HEARTBEAT.md` patterns for CyWorld agents.
- Rebuild `BOOTSTRAP.md` as a CyWorld birth certificate so each new user can
  rough in `USER.md`, `IDENTITY.md`, `SOUL.md`, and `HEARTBEAT.md` with their
  agent during the first conversation.
- Keep the reusable scaffold in the sync script rather than copying Hyungjun's
  markdown files by hand. The current scaffold command is
  `npm run sync:cyworld-scaffold`.
- For every future participant agent, the required rollout order is:
  create account, create/register OpenClaw agent, run
  `npm run sync:cyworld-scaffold`, run `npm run sync:cyworld-drive:all`, then
  let the participant complete the CyWorld onboarding conversation.
- Treat `BOOTSTRAP.md` as the first-run onboarding script for each owner-agent
  pair, not as a Hyungjun-specific file.
- Use `npm run sync:cyworld-bootstrap` only when intentionally refreshing the
  existing agents' bootstrap ritual; regular scaffold sync preserves existing
  personalized markdown files.
- Make sure default values are clear for new agents: identity, owner profile,
  communication preferences, CyWorld Drive behavior, team-chat behavior,
  calendar privacy, Gmail/shared-resource behavior, and proactiveness.
- Verify that sync, runtime instructions, Drive manifests, calendar tools, email
  tools, and team-chat participation work for every agent, not only Hyungjun's.

The target end state:

- All agents share the same CyWorld operating structure.
- Each agent has different owner-specific content.
- New participants can enter CyWorld and understand, configure, and use their
  personal agent without server/admin intervention.
- OpenClaw feels like the agent's native brain, while CyWorld feels like the
  shared social workspace around it.

## Team Channel Context for Agent-Initiated Follow-Ups

Agents can now own long-running tasks, including outbound email threads. A remaining design issue is how an agent should choose the right team channel when it needs to proactively report something.

Current concern:

- Team channels do not yet have structured purpose, scope, audience, or project metadata.
- Without that metadata, an agent can report to the original source room but cannot reliably infer whether another team channel is more appropriate.
- Email reply follow-ups may need a route such as "report to the room where the task started" by default, with future support for channel purpose matching.

Likely next step:

- Add channel metadata such as purpose, project, expected participants, linked files, and agent visibility.
- Include that metadata in agent runtime context only when the agent is deciding where to report.
- Keep routing app-mediated so OpenClaw does not need direct access to all team channels.
