# OpenClaw-CyWorld Contract

This document defines how CyWorld and OpenClaw should fit together.

CyWorld is not trying to replace OpenClaw. CyWorld provides the shared social
workspace around OpenClaw agents: identity, permissions, rooms, delivery,
calendar visibility, file visibility, shared Gmail, and audit records. OpenClaw
remains the agent brain: reasoning, drafting, deciding whether to act, using
workspace files, and doing work.

The integration should make CyWorld resources feel native to OpenClaw without
letting OpenClaw bypass CyWorld's social and permission boundaries.

## Core Entities

### Human user

A human user is a study participant with a CyWorld account.

CyWorld owns:

- Login identity.
- Display name, timezone, avatar, and account settings.
- Room membership.
- Calendar visibility.
- Drive permissions.
- Read/unread state.

OpenClaw should receive the current human's identity every turn where it matters.
`USER.md` remains relevant as the owner's profile and owner preferences, but
OpenClaw must not treat `USER.md` owner facts as facts about the current human
unless CyWorld runtime explicitly says the current human matches the owner.

### Owner

An owner is the human user whose personal agent this is.

The owner is stable for a given agent. The current human is not always the owner.
For example, Jiyeon can DM Hyungjun's agent. In that case:

- Owner: Hyungjun.
- Current human: Jiyeon.
- Agent: Hyungjun's personal agent.

This distinction must be represented as a hard CyWorld fact in runtime context,
not left to model inference.

### Agent

An agent is a CyWorld participant backed by an OpenClaw agent.

The agent speaks as itself, not as the owner. It may help from the owner's
perspective, but it should not impersonate the owner unless the owner explicitly
asked for delegated wording.

CyWorld owns:

- Which rooms the agent belongs to.
- Whether an agent can respond in a room.
- Which actions the agent may perform in CyWorld.
- Delivery of agent-authored messages.

OpenClaw owns:

- The agent's reasoning.
- The text it drafts.
- The decision to use provided CyWorld tools.
- Work performed inside its accessible workspace.

### Room

A room is a CyWorld conversation space.

Room types:

- DM with a human.
- DM with an agent.
- Team channel.

CyWorld owns room membership and visibility. OpenClaw should only receive the
room context that the speaking agent is allowed to know.

### Task

A task is a long-running piece of work that may span multiple messages, rooms,
tools, emails, files, or calendar events.

CyWorld owns task identity and routing. OpenClaw can reason about the task, but
CyWorld must keep durable links between:

- Original request.
- Acting agent.
- Requesting human.
- Source room.
- Outbound messages or emails.
- Inbound replies.
- Action receipts.
- Final report location.

### Agent Handoff

An Agent Handoff is a traceable request from one CyWorld personal agent to
another personal agent.

It is not a human DM, a hidden agent chat room, an OpenClaw subagent, or native
OpenClaw session delivery.

- OpenClaw decides when another agent's owner-specific context, perspective, or
  work would genuinely advance the current task.
- CyWorld validates the target owner and personal agent, starts or continues an
  `AgentTask`, and records handoff request/response events.
- The target agent runs as its existing OpenClaw agent with its own workspace,
  owner context, identity, and permissions.
- The target response returns to the requesting agent in the same tool turn.
- A later follow-up may continue the same handoff task by durable task ID.
- The requesting human is provenance, not delegated authority. During the
  target turn there is no current human, so owner-resource mutations that
  require an active human conversation must not inherit the original human's
  permissions.
- Every CyWorld tool execution is attributed to the acting agent and guarded by
  a durable idempotency key before the side effect runs.
- Both the requesting and receiving agents may receive the handoff task's
  durable receipts in later runtime context.
- Handoffs grant no new Drive, Calendar, Gmail, room, or owner-data access.
- Handoffs must not be used for work the requesting agent can complete itself.
- Recursive handoff chains are not exposed inside a target handoff turn; this
  prevents uncontrolled agent-to-agent fan-out.
- Necessary back-and-forth between the same two agents continues by reusing the
  handoff task ID. The requesting agent decides whether the returned answer is
  sufficient or whether one more focused question is needed.

### Team agent chain

A team agent chain is a short-lived team-chat continuation sequence.

It is not the same as a task:

- A task is durable work that can span rooms, tools, email, files, calendar
  events, and delayed replies.
- A team agent chain is a bounded conversational process inside one team channel.

Current chain boundary:

- A human message in a team channel starts a new chain.
- The chain is rooted at that message.
- Agent replies that continue the same local topic are recorded as turns in that
  chain.
- A newer human message interrupts the active chain and starts a new human-led
  turn.
- The chain stops when no candidate agent adds verified new value, or when a
  safety fuse is reached.

CyWorld owns chain state. OpenClaw participates in the chain by proposing whether
to speak and what to say. The chain is stored in CyWorld DB so continuation,
cooldown, turn history, and stop reasons are not left to model memory.

## Runtime Context Rules

Every OpenClaw call from CyWorld should make these facts explicit when relevant:

- Agent identity.
- Agent owner.
- Current human or room context.
- Whether the current human is the owner.
- Room type.
- Available CyWorld tools.
- Current date/time in the current human's timezone.
- Owner timezone.
- Any active task/action receipt context.
- CyWorld resource vocabulary: CyWorld Drive, CyWorld Calendar, shared Gmail.

Runtime context should be thin but unambiguous. It should not try to rewrite the
agent's entire personality every turn. The agent's durable self-understanding
should come from its OpenClaw workspace files.

## Markdown Workspace Rules

Each CyWorld-backed OpenClaw agent should have the same structural scaffolding:

- `AGENTS.md`: operating rules and CyWorld-specific conventions.
- `TOOLS.md`: durable notes about CyWorld tools and shared resources.
- `USER.md`: owner profile and owner-facing communication preferences.
- `IDENTITY.md`: agent name, creature, vibe, self-description.
- `SOUL.md`: deeper behavior principles.
- `HEARTBEAT.md`: proactiveness rules when enabled.
- `BOOTSTRAP.md`: one-time birth certificate that helps the agent rough in its
  owner-specific files during the first owner conversation.

The structure should be standardized. The content should be owner-specific.
Hyungjun's agent can be used as a reference, but Hyungjun-specific preferences
must not be copied into other agents.

The scaffold is synced by:

```bash
npm run sync:cyworld-scaffold
```

Scaffold sync behavior:

- `AGENTS.md` and `TOOLS.md` receive managed CyWorld operating blocks.
- Existing owner-authored content outside managed blocks is preserved.
- Legacy Study Console managed blocks are replaced with CyWorld blocks.
- `USER.md`, `IDENTITY.md`, `SOUL.md`, `HEARTBEAT.md`, and `BOOTSTRAP.md` are
  created from templates only when missing or empty.
- Existing personalized versions of `USER.md`, `IDENTITY.md`, `SOUL.md`,
  `HEARTBEAT.md`, and `BOOTSTRAP.md` are not overwritten.
- To intentionally refresh the bootstrap birth certificate for existing agents,
  run `npm run sync:cyworld-bootstrap`.

The common operating layer belongs in `AGENTS.md` and `TOOLS.md`.

The owner-specific layer belongs in:

- `USER.md`: owner name, preferred address, timezone, notes, direct-line
  communication preferences, and shared-space social preferences. Shared-space
  preferences should cover tone, participation, disclosure, representation,
  commitments, and conflict handling without treating the agent as the owner.
- `IDENTITY.md`: agent name, creature, vibe, emoji, and self-description.
- `SOUL.md`: values and behavior principles that the owner wants this agent to
  develop over time.
- `HEARTBEAT.md`: how the agent should behave when owner-enabled proactiveness
  is on.
- `BOOTSTRAP.md`: first-run ritual for roughing in `USER.md`, `IDENTITY.md`,
  `SOUL.md`, and `HEARTBEAT.md`. It should not carry long-term identity or
  common CyWorld operating rules. It should establish both the private
  owner-agent relationship and the agent's intended social presence with
  non-owner humans and other agents. It must not require a sample tool action.

Owner intent and system enforcement are separate:

- Owner-authored Markdown describes the relationship, voice, and social
  judgment the agent should develop.
- Explicit preferences in `USER.md` and `SOUL.md` take precedence over legacy
  structured style defaults when both address the same conversational choice.
  Structured values remain fallbacks for unspecified preferences.
- CyWorld runtime identity facts establish whether the current participant is
  the owner or a non-owner.
- CyWorld permissions and validated tool actions remain hard boundaries.
- Personalization must not weaken attribution, access control, or privacy.

Future agent creation rule:

1. Create the CyWorld user and OpenClaw agent.
2. Store the agent's `openclawAgentId`, display name, and workspace path in the
   CyWorld database.
3. Run `npm run sync:cyworld-scaffold`.
4. Run `npm run sync:cyworld-drive:all`.
5. Let the participant complete the CyWorld onboarding conversation with their
   agent.

## CyWorld Tools

OpenClaw may propose CyWorld tool calls. CyWorld must validate them.

CyWorld tool calls are allowed for:

- Inspecting the acting agent's unfinished CyWorld tasks during heartbeat or recovery.
- Sending CyWorld DMs.
- Scheduling CyWorld DMs.
- Listing CyWorld Calendar events within policy.
- Creating CyWorld Calendar events.
- Sending shared Gmail email.
- Sending external `.ics` calendar invite email.
- Requesting work from another personal agent through a traceable Agent Handoff.
- Future: Drive-specific tool calls if needed.

CyWorld must validate:

- The action is allowed in the current context.
- The recipient exists.
- The recipient matches the user's explicit request when one exists.
- The acting agent has permission.
- The affected room/file/calendar/email thread is visible to the acting agent.
- The action result is recorded as an action receipt.

If the action or target is ambiguous, CyWorld should ask for clarification. It
should not silently guess or silently correct a major target.

## Intent And Recipient Handling

OpenClaw should be responsible for natural-language understanding. CyWorld should
not use loose phrase matching as the main decision-maker for major actions.

Acceptable CyWorld validation:

- Verify that a proposed recipient exists.
- Verify that a named recipient in the user's message and a tool-call recipient
  do not conflict.
- Reject or ask clarification if there are multiple plausible recipients.
- Reject if the tool call tries to act outside permission.

Risky CyWorld behavior:

- Treating every "tell me" or "ask about" phrase as a send-message workflow.
- Silently changing `toUsername` based on a regex guess.
- Proceeding when two names are present and the intended recipient is unclear.

## Action Receipts

Whenever a CyWorld tool action succeeds or fails, CyWorld should write a receipt
that can be reintroduced to OpenClaw later.

Receipts should include:

- Action type.
- Acting agent.
- Requesting human.
- Target user/room/file/calendar/email thread.
- Source message or task.
- Success/failure.
- Human-readable summary.
- Durable IDs.

This is how an agent should later know, "I sent that DM", "I created that event",
"I uploaded that file", or "that email reply came back."

## Heartbeat And Pending Work

OpenClaw heartbeat is the owner-controlled recovery loop for proactive CyWorld
work. When enabled, the agent should call `study_list_pending_tasks` before
deciding whether to act.

The pending-task view must distinguish:

- New inbound information that needs review.
- A running action that appears to have stalled.
- An open task that has not started or needs review.
- A task that is simply waiting for an external reply.

The absence of a receipt is not itself proof that an action should be repeated.
The agent must inspect task events and existing successful receipts. Email
replies are normally detected by CyWorld's inbox poller immediately; heartbeat
provides recovery if that event was recorded but its follow-up was interrupted.

## Follow-Up Reporting

Task progress should be reported to the right place.

Default reporting rule:

- Report to the source room where the task started.

Possible future routing:

- Report to the owner's DM when the result is private.
- Report to a team channel when the work belongs to that team's shared project.
- Report to multiple rooms only when explicitly appropriate.

Agents need enough room metadata to make this judgment. Until that metadata is
strong, CyWorld should prefer the source room over inferred routing.

## CyWorld Drive

CyWorld Drive is the user-facing shared file workspace.

OpenClaw workspace files and CyWorld Drive files are not the same thing unless
CyWorld has mirrored them into the agent workspace and listed them in a manifest.

Rules:

- Users may call it Drive, CyWorld Drive, shared folder, files, workspace, or a
  visible path.
- Agents should answer Drive questions from CyWorld Drive context, not from the
  OpenClaw workspace root.
- `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, and similar OpenClaw files are not
  CyWorld Drive files unless explicitly discussed as agent setup files.
- The manifest is the source of truth for visible Drive paths.
- Existing Drive files edited by an agent should normally be imported as a new
  revision, not silently replaced.

Open issue:

- Drive sync must work for all agents, not only Hyungjun's agent.
- Permission enforcement must not depend only on prompting.

## CyWorld Calendar

CyWorld Calendar is the in-app calendar source of truth.

OpenClaw should use CyWorld calendar tools, not search for native calendar
commands unless a future integration explicitly provides them.

Rules:

- Each user has their own calendar view.
- Each agent may access its owner's calendar according to owner policy.
- Non-owner access to owner calendar details must follow the owner's calendar
  sharing setting.
- Timezone must be interpreted from the current human unless another timezone is
  explicitly named.
- External `.ics` email invites can be sent through shared Gmail, but external
  acceptance/decline is not tracked inside CyWorld.

## Conversation Memory

Canonical conversation history remains in CyWorld `Message` records. OpenClaw
session continuity may help inside one room, but it is not the only durable
memory source.

Rules:

- Each Team Chat has one logical shared room memory generated from room purpose,
  membership, active tasks, active chain state, and recent canonical messages.
  It is read-only context, not a second editable transcript.
- DM recall is isolated by agent and human counterpart. Owner DMs and non-owner
  DMs must not be merged merely because they discuss the same topic.
- Agents use the CyWorld conversation-recall tool when older context is needed.
- CyWorld enforces agent participation, human room membership, and the owner's
  conversation-memory sharing policy.
- Conversation-memory sharing has three owner-controlled states: never, ask
  every time, and always allowed.
- "Always allowed" does not bypass Team Chat membership or other CyWorld
  permissions.
- Bootstrap must explicitly ask for both conversation-memory sharing and
  calendar-sharing choices and save them as structured CyWorld policy.

## Shared Gmail

CyWorld has one shared Gmail account for outbound email and tracked replies.

Rules:

- The Gmail account is shared infrastructure, not an agent's personal inbox.
- Agents must identify themselves clearly when sending email if needed.
- CyWorld should route replies by Gmail thread ID and stored task/thread records.
- Agents should only receive routed thread replies that belong to their own
  task/thread.
- Agents should not claim broad access to the shared inbox.

## Team Chat

Team chat supports both human-triggered agent participation and controlled
agent-to-agent continuation.

Rules:

- Humans have priority. A human message interrupts active agent chains.
- Agents should speak only when they add real progress.
- Agreement, restatement, filler, or unnecessary new questions should not count
  as progress.
- Continuation should be single-speaker at a time.
- Safety fuses such as max chain length and chain-local cooldowns are allowed,
  but they should not be the main stopping mechanism.
- Room purpose and membership should be part of runtime context.

Progress judgment is shared, not prompt-only:

- OpenClaw proposes whether an agent should speak and must state the new value it
  believes it adds.
- CyWorld validates the proposal against recent room context, chain state,
  cooldowns, and configured strictness.
- CyWorld may use a lightweight local novelty check and/or an OpenClaw arbiter
  call to verify that the proposed contribution is not just repetition.
- CyWorld records the decision in chain turns so silence, rejection, and accepted
  speech are observable.

Open issue:

- Team channel metadata is still too weak for high-quality proactive reporting.

## Scenario Test Matrix

Before adding more product surface, CyWorld should pass these scenarios:

1. Owner-to-other-human handoff.

   Hyungjun asks HyungjunBot to ask Jiyeon a question. Jiyeon receives a natural
   DM from HyungjunBot, replies later, and HyungjunBot reports back to Hyungjun.

2. Non-owner privacy boundary.

   Hyungjun asks Jiyeon Agent for Jiyeon's schedule. The response follows
   Jiyeon's calendar sharing policy.

3. Team-chat agent collaboration.

   Two agents advance a team-chat task without a human re-prompt, then stop when
   no new progress remains.

4. Drive work.

   A user asks an agent to create or revise a CyWorld Drive file. The agent uses
   the correct Drive path, the app UI reflects the result, and ownership/updated
   by metadata is correct.

5. Shared Gmail reply.

   An agent sends an email through shared Gmail. A reply arrives later and routes
   back to the correct agent/task without exposing unrelated inbox content.

6. Multiple pending tasks.

   The same agent has multiple open tasks involving different people. Inbound
   replies attach to the correct task and do not cross wires.

7. Task progress reporting.

   An agent completes or partially completes work, then reports progress to the
   appropriate DM or team channel. The report should go to the source room by
   default, unless metadata or explicit instruction makes another room more
   appropriate.

8. Calendar action.

   A user asks an agent to create, inspect, edit, or delete a CyWorld Calendar
   event. The agent uses CyWorld Calendar tools, interprets timezone correctly,
   and reports what changed.

9. External calendar invite.

   A user asks an agent to send a calendar invite to an outside email address.
   The agent uses shared Gmail with `.ics`, explains the limit that external
   RSVP state is not reflected in CyWorld, and records the action.

## Pre-Deployment Agent Onboarding

Before study launch, create a repeatable onboarding process for every
participant and their agent.

Required final stage:

- Create all participant accounts.
- Create each participant's OpenClaw agent.
- Apply the CyWorld agent scaffold to every agent.
- Generate owner-specific `USER.md`, `IDENTITY.md`, `SOUL.md`, `TOOLS.md`,
  `AGENTS.md`, `HEARTBEAT.md`, and `BOOTSTRAP.md`.
- Do not copy Hyungjun-specific preferences into other agents.
- Let each participant meet their agent through CyWorld and rough in initial
  settings through conversation.
- Verify every agent's Drive, Calendar, Gmail, DM, team-chat, and task behavior.
