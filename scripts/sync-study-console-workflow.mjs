import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const openclawRoot = path.join(os.homedir(), ".openclaw");

const MANAGED_START = "<!-- BEGIN:study-console-workflow -->";
const MANAGED_END = "<!-- END:study-console-workflow -->";

const agentsBlock = `${MANAGED_START}
## Study Console Workflow

This agent is running inside the Study Console web app.

Human participants, DMs, team channels, files, scheduled messages, and task handoffs are managed by the Study Console application, not by OpenClaw gateway sessions.

When you need to contact a human participant, ask a participant something, report back later, or schedule a message:
- Do not use \`sessions_send\`, OpenClaw gateway delivery, pairing-based sessions, or OpenClaw cron.
- Treat Study Console as the official delivery and scheduling layer.
- Produce the intended message, decision, or next action for the Study Console workflow.
- The app backend will deliver messages, wait for replies, schedule follow-ups, and re-enter the result into your context.

If a participant replies to something you asked on behalf of your owner, use that reply to decide the next action:
- Report back to the owner when the task is complete.
- Ask a follow-up if the answer is insufficient.
- Stay aware of whether you are speaking with your owner or another participant.

Never tell users that Study Console DMs require OpenClaw gateway pairing. Pairing applies to native OpenClaw session tools, not to this app's Study Console workflow.
${MANAGED_END}`;

const toolsBlock = `${MANAGED_START}
### Study Console Outbox

Use this conceptual tool path when a human participant should receive a DM through the Study Console app.

Do not attempt OpenClaw native session delivery. The app backend owns actual message delivery.

### Study Console Task Queue

Use this workflow for multi-step tasks such as:
- asking another participant a question
- waiting for their answer
- reporting the answer back to your owner
- scheduling a later follow-up

The app backend records task state and will reintroduce relevant events into your context.
${MANAGED_END}`;

function replaceManagedBlock(source, block) {
  const pattern = new RegExp(`${MANAGED_START}[\\s\\S]*?${MANAGED_END}`, "m");

  if (pattern.test(source)) {
    return source.replace(pattern, block);
  }

  const trimmed = source.trimEnd();
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

async function readWorkspaceFile(agentId, fileName) {
  try {
    return await fs.readFile(
      path.join(openclawRoot, `workspace-${agentId}`, fileName),
      "utf8",
    );
  } catch {
    return "";
  }
}

async function writeWorkspaceFile(agentId, fileName, content) {
  await fs.writeFile(
    path.join(openclawRoot, `workspace-${agentId}`, fileName),
    content.endsWith("\n") ? content : `${content}\n`,
    "utf8",
  );
}

async function main() {
  const agents = await prisma.agent.findMany({
    orderBy: {
      openclawAgentId: "asc",
    },
    select: {
      openclawAgentId: true,
    },
  });

  for (const agent of agents) {
    const agentId = agent.openclawAgentId;
    const agentsMd = await readWorkspaceFile(agentId, "AGENTS.md");
    const toolsMd = await readWorkspaceFile(agentId, "TOOLS.md");

    await writeWorkspaceFile(agentId, "AGENTS.md", replaceManagedBlock(agentsMd, agentsBlock));
    await writeWorkspaceFile(agentId, "TOOLS.md", replaceManagedBlock(toolsMd, toolsBlock));

    console.log(`synced Study Console workflow -> ${agentId}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
