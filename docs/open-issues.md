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
- The app has DB-level concepts for humans, agents, rooms, messages, tasks,
  files, calendars, email threads, and settings.

What is still fragile:

- Some routing still depends on phrase matching such as "ask/tell/send/contact",
  which can confuse normal conversation with action requests.
- OpenClaw's native worldview is owner/workspace-oriented, while CyWorld's
  worldview is multi-human and multi-agent. Runtime context and markdown files
  can still disagree.
- CyWorld Drive is mirrored into OpenClaw workspace state, but the sync and
  managed instructions are still mostly shaped around Hyungjun's agent.
- Calendar and Gmail are CyWorld backend tools, not OpenClaw-native tools, so
  agents must reliably learn to use the CyWorld route instead of looking for
  unavailable native tools.
- Long-running tasks, replies, follow-ups, and cross-room handoffs are present
  but not yet systematically tested against multiple simultaneous tasks.

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

1. Unify action, task, and receipt handling.

   Every agent-initiated CyWorld action should move through the same lifecycle:
   OpenClaw proposes the action, CyWorld validates permissions and targets,
   CyWorld executes it, CyWorld records a durable receipt, and the receipt is
   reintroduced into later OpenClaw turns. This should cover DM delivery,
   scheduled DM, calendar actions, shared Gmail, external calendar invite
   email, Drive imports/exports, and follow-up reports. Today the building
   blocks exist (`AgentTask`, `AgentTaskEvent`, `EmailThread`, `Message.taskId`,
   and recent receipt injection), but action paths still use them unevenly.

2. Clean up runtime context boundaries.

   Durable identity and operating knowledge should live in the OpenClaw
   workspace files and managed scaffold. Per-turn facts should stay in runtime
   context: current human, room, timezone, active task, current permissions, and
   fresh receipts. Runtime context should not become a hidden second personality
   system that fights OpenClaw's markdown workspace.

3. Stabilize CyWorld resource vocabulary and tool paths.

   Agents should consistently understand CyWorld Drive, CyWorld Calendar,
   shared Gmail, DMs, and Team Chat as CyWorld-provided social/tool layers.
   They should not confuse CyWorld Drive with the OpenClaw workspace root or
   look for unavailable native calendar/session/gateway tools when CyWorld
   provides the app-mediated route.

4. Harden shared Gmail follow-up routing.

   Gmail is a shared resource, but each email thread belongs to a specific
   agent/task/source room. Replies must route back to the correct agent without
   exposing unrelated mailbox content, and the agent should receive enough
   receipt context to decide whether to reply, report to the owner, or report
   to the source room.

5. Improve team-chat observability.

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

- Agent-to-agent autonomous DM is not yet a first-class primitive. Team-chat
  agent chains exist, but DM agent-to-agent work still needs a clear design.
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
