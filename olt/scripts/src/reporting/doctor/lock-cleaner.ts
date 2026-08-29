import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { recoverStale } from "../../workflow/lease/recover-stale.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { systemClock } from "../../workflow/types.ts";
import { loadRun } from "../../engine/store/index.ts";

export interface LockCleanerOptions {
  readonly repoRoot?: string | undefined;
  readonly lockDirs?: readonly string[] | undefined;
  readonly staleSeconds?: number | undefined;
}

export interface StaleLeaseOptions {
  readonly actor?: string | undefined;
  readonly graceSeconds?: number | undefined;
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const err = error as { code?: string };
    return err?.code === "EPERM";
  }
}

export function cleanseDanglingLocks(options: LockCleanerOptions = {}): string[] {
  const repoRoot = options.repoRoot ?? process.cwd();
  const staleSeconds = options.staleSeconds ?? 300;
  const now = Date.now();
  const defaultDirs = [
    join(repoRoot, ".locks"),
    join(repoRoot, ".olt", "locks"),
    join(repoRoot, ".olt"),
  ];
  const targetDirs = options.lockDirs
    ? options.lockDirs.map((dir) => resolve(repoRoot, dir))
    : defaultDirs;

  const cleared: string[] = [];

  for (const dir of targetDirs) {
    if (!existsSync(dir)) continue;

    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const file of entries) {
      if (!file.endsWith(".lock") && file !== "lock") continue;
      const fullPath = join(dir, file);

      try {
        const stats = statSync(fullPath);
        if (!stats.isFile()) continue;

        let shouldClean = false;
        let reason = "";

        const ageSeconds = (now - stats.mtimeMs) / 1000;
        if (ageSeconds > staleSeconds) {
          shouldClean = true;
          reason = `stale lock age (${Math.round(ageSeconds)}s > ${staleSeconds}s)`;
        } else {

          try {
            const content = readFileSync(fullPath, "utf-8").trim();
            if (content.startsWith("{") && content.endsWith("}")) {
              const parsed = JSON.parse(content) as Record<string, unknown>;
              if (typeof parsed["pid"] === "number") {
                const pid = parsed["pid"];
                if (!isProcessAlive(pid)) {
                  shouldClean = true;
                  reason = `dead owning PID ${pid}`;
                }
              }
            } else {
              const numPid = Number.parseInt(content, 10);
              if (Number.isInteger(numPid) && numPid > 0 && !isProcessAlive(numPid)) {
                shouldClean = true;
                reason = `dead owning PID ${numPid}`;
              }
            }
          } catch {

            if (ageSeconds > 60) {
              shouldClean = true;
              reason = `unparseable lock file with age ${Math.round(ageSeconds)}s`;
            }
          }
        }

        if (shouldClean) {
          try {
            unlinkSync(fullPath);
            cleared.push(`${fullPath} (${reason})`);
          } catch {

          }
        }
      } catch {

      }
    }
  }

  return cleared;
}

export function recoverStaleLeases(runRoot: string, options: StaleLeaseOptions = {}): string[] {
  const actor = options.actor ?? "doctor-auto-heal";
  const recovered: string[] = [];

  try {
    const loaded = loadRun(runRoot);
    const tasks = (loaded.state?.tasks ?? {}) as Record<string, Record<string, unknown>>;
    const now = systemClock.now().getTime();

    const hasStaleTasks = Object.values(tasks).some((task) => {
      const lease = task["lease"] as Record<string, unknown> | undefined;
      if (lease && typeof lease["expires_at"] === "string") {
        const expires = Date.parse(lease["expires_at"]);
        return !Number.isNaN(expires) && expires < now;
      }
      return false;
    });

    if (hasStaleTasks) {
      const port = workflowPort(runRoot);
      const beforeState = port.read();
      const leasedBefore = Object.values(beforeState.tasks)
        .filter((t) => t.lease !== undefined)
        .map((t) => t.id);

      const afterState = recoverStale(port, actor, systemClock, {
        graceSeconds: options.graceSeconds ?? 0,
      });

      const reclaimed = leasedBefore.filter((id) => afterState.tasks[id]?.lease === undefined);
      if (reclaimed.length > 0) {
        recovered.push(...reclaimed);
      }
    }
  } catch {

  }

  return recovered;
}
