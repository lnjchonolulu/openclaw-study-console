# CyWorld Participant Onboarding

CyWorld participant onboarding has two layers:

1. **Admin provisioning** creates the study account, personal OpenClaw agent,
   CyWorld database link, General membership, personal Drive folder, shared
   scaffold, workspace security, and Drive mirror.
2. **Owner-agent bootstrap** happens after the participant signs in. The
   participant talks with their agent, and `BOOTSTRAP.md` guides the agent in
   personalizing `USER.md`, `IDENTITY.md`, `SOUL.md`, and `HEARTBEAT.md`.

The admin layer is resumable. Re-running the same command repairs missing
steps without resetting an existing password or overwriting personalized
workspace files.

## Add One Participant

Run this on the CyWorld server from the application directory:

```bash
cd /opt/openclaw-study
read -s CYWORLD_ONBOARD_PASSWORD
export CYWORLD_ONBOARD_PASSWORD
npm run onboard:participant -- \
  --username alex \
  --display-name "Alex" \
  --timezone "Asia/Tokyo"
unset CYWORLD_ONBOARD_PASSWORD
```

Optional arguments:

- `--agent-name "Alex Agent"` changes the initial agent display name.
- `--team "Team 03"` selects a team when more than one team exists.
- `--model "minimax/MiniMax-M2.7"` overrides the model inferred from existing
  CyWorld agents.
- `--skip-gateway-restart` defers the OpenClaw gateway restart. Use this while
  provisioning a batch, then restart the gateway once after the final account.

Usernames are also OpenClaw agent ids and must contain only lowercase letters,
numbers, underscores, or hyphens.

## Verify Or Resume

The command reports each completed phase. If it stops, fix the reported issue
and run the same onboarding command again.

To verify an existing participant without changing anything:

```bash
npm run onboard:participant -- --username alex --verify-only
```

Verification checks:

- Active CyWorld account and database agent link.
- Matching OpenClaw agent and workspace.
- Human and agent membership in General.
- System-managed personal Drive folder.
- Shared Markdown scaffold and CyWorld Drive manifest.

## What Is Preserved

For existing users, onboarding does not:

- Reset the password.
- Replace profile or agent display settings.
- Overwrite `USER.md`, `IDENTITY.md`, `SOUL.md`, `HEARTBEAT.md`, or
  `BOOTSTRAP.md`.

For a brand-new user, the command intentionally replaces OpenClaw's generic
starter Markdown with clean CyWorld templates. The templates contain common
structure but no Hyungjun-specific preferences.

## Participant First Run

After provisioning:

1. Give the participant their study username and password.
2. Have them sign in to CyWorld.
3. Open the DM with their personal agent.
4. Let the agent follow `BOOTSTRAP.md` in a short conversation.
5. Confirm the participant can use DM, Team Chat, Drive, and Calendar.
6. Enable proactiveness only if the participant wants heartbeat behavior.

`BOOTSTRAP.md` is a one-time birth certificate. Shared CyWorld mechanics stay
in managed `AGENTS.md` and `TOOLS.md` blocks; owner-specific preferences belong
in the owner files.
