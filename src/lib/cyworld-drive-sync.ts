import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function looksLikeDriveActivity(text: string) {
  return /\b(CYWORLD_DRIVE|Drive|files?|folders?|workspace|directory|upload|download|pdf|docx?|txt|csv|xlsx?|sheets?)\b/i.test(
    text,
  ) || /(파일|폴더|공유\s*폴더|워크스페이스|업로드|다운로드|문서)/.test(text);
}

export function shouldTriggerCyWorldDriveSync(...texts: Array<string | null | undefined>) {
  return texts.some((text) => text && looksLikeDriveActivity(text));
}

export async function triggerCyWorldDriveSync(agentId: string) {
  if (agentId !== "hyungjun") {
    return;
  }

  try {
    await execFileAsync("npm", ["run", "sync:cyworld-drive"], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 20_000,
    });
  } catch (error) {
    console.error("[cyworld-drive-sync] immediate sync failed", {
      agentId,
      error,
    });
  }
}
