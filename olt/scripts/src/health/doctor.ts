import { execSync } from "child_process";
import { enforceLineLimit } from "../cli/formatters/line-limiter.ts";

export interface DagBadge {
  id: string;
  asciiArt: string;
  waveNeighborhood: string;
  isActive: boolean;
}

export function pruneAsciiDagBadges(badges: DagBadge[], activeWave: string): DagBadge[] {
  // Prune ASCII DAG badges to active wave neighborhoods to conserve LLM context tokens and enforce <= 30 lines
  return badges
    .filter((badge) => badge.waveNeighborhood === activeWave || badge.isActive)
    .map((badge) => ({
      ...badge,
      asciiArt: enforceLineLimit(badge.asciiArt, 30),
    }));
}

export function killDanglingBrowserProcesses(): number {
  let killedCount = 0;
  try {
    const output = execSync("pgrep -i 'chrome|chromium|playwright'", { encoding: "utf8" });
    const pids = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => parseInt(line, 10))
      .filter((pid) => !isNaN(pid));

    for (const pid of pids) {
      try {
        if (pid > 1 && pid !== process.pid) {
          process.kill(pid, "SIGTERM");
          killedCount++;
        }
      } catch (e: unknown) {
        // Ignore kill errors
      }
    }
  } catch (e: unknown) {
    // pgrep fails if no processes match
  }
  return killedCount;
}
