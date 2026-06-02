# Open Issues

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

## Calendar Event Deletion

Users need a way to delete calendar events from the CyWorld Calendar UI.

Current concern:

- The calendar supports creating and editing events, but not deleting them.
- Deleting an event needs to handle invitations, participant visibility, and any future Google Calendar mirroring behavior consistently.

Likely next step:

- Add a delete action to the event edit dialog.
- Confirm before deletion.
- Cancel or hide related invitations for participants.
- If Google Calendar mirroring is enabled for an event, delete or cancel the mirrored external event as part of the same backend action.
