import { existsSync, lstatSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { loadRun } from "../../../engine/store/index.ts";

export function parseNowMs(nowInput?: number | Date | string): number {
  if (typeof nowInput === "number") return nowInput;
  if (nowInput instanceof Date) return nowInput.getTime();
  if (typeof nowInput === "string") {
    const parsed = Date.parse(nowInput);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

export function findLiveRunRoots(capsulesDir: string, mindRunRoot: string): string[] {
  const currentBasename = basename(mindRunRoot);
  if (!existsSync(capsulesDir) || !lstatSync(capsulesDir).isDirectory()) {
    return [];
  }
  const entries = readdirSync(capsulesDir, { withFileTypes: true });
  const liveRoots: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (
      entry.name === currentBasename ||
      entry.name.startsWith("mind-") ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const runPath = join(capsulesDir, entry.name);
    try {
      const loaded = loadRun(runPath, false);
      const completion = loaded.state.completion_result as { status?: string } | undefined;
      if (completion?.status === "complete") continue;
      liveRoots.push(runPath);
    } catch {
      // ignore unreadable run
    }
  }

  return liveRoots;
}
