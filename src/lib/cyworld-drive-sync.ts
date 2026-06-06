import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DRIVE_SYNC_TIMEOUT_MS = 180_000;

type DriveSyncState = {
  promise: Promise<void> | null;
  rerunRequested: boolean;
};

const globalForDriveSync = globalThis as typeof globalThis & {
  cyworldDriveSyncState?: DriveSyncState;
};

const driveSyncState =
  globalForDriveSync.cyworldDriveSyncState ??
  ({
    promise: null,
    rerunRequested: false,
  } satisfies DriveSyncState);

globalForDriveSync.cyworldDriveSyncState = driveSyncState;

function looksLikeDriveActivity(text: string) {
  return /\b(CYWORLD_DRIVE|Drive|files?|folders?|workspace|directory|upload|download|pdf|docx?|txt|csv|xlsx?|sheets?)\b/i.test(
    text,
  ) || /(파일|폴더|공유\s*폴더|워크스페이스|업로드|다운로드|문서)/.test(text);
}

export function shouldTriggerCyWorldDriveSync(...texts: Array<string | null | undefined>) {
  return texts.some((text) => text && looksLikeDriveActivity(text));
}

async function runCyWorldDriveSyncAll() {
  try {
    await execFileAsync("npm", ["run", "sync:cyworld-drive:all"], {
      cwd: process.cwd(),
      env: process.env,
      timeout: DRIVE_SYNC_TIMEOUT_MS,
    });
  } catch (error) {
    console.error("[cyworld-drive-sync] all-agent sync failed", { error });
  }
}

async function drainCyWorldDriveSyncQueue() {
  do {
    driveSyncState.rerunRequested = false;
    await runCyWorldDriveSyncAll();
  } while (driveSyncState.rerunRequested);
}

export function triggerCyWorldDriveSyncAll() {
  if (driveSyncState.promise) {
    driveSyncState.rerunRequested = true;
    return driveSyncState.promise;
  }

  driveSyncState.promise = drainCyWorldDriveSyncQueue().finally(() => {
    driveSyncState.promise = null;
  });

  return driveSyncState.promise;
}
