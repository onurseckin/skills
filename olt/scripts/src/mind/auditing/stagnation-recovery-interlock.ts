import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDefectsPath } from "../../core/shared/paths.ts";

export interface StagnationShockResult {
  readonly recovered: boolean;
  readonly mode: "MODE_A_AUTONOMIC_DISCOVERY" | "MODE_B_BACKLOG_REACTIVE" | "NONE";
  readonly resolvedIncidents: number;
  readonly timestamp: string;
}

export interface StagnationRecoveryOptions {
  readonly idleDurationSeconds?: number | undefined;
  readonly stagnationThresholdSeconds?: number | undefined;
  readonly consecutiveCycles?: number | undefined;
  readonly pendingBacklogCount?: number | undefined;
  readonly now?: string | undefined;
}

export function resolveStagnationIncidents(repoRoot: string): { resolvedCount: number } {
  const defectsPath = resolveDefectsPath(repoRoot);
  if (!existsSync(defectsPath)) return { resolvedCount: 0 };
  let resolvedCount = 0;
  try {
    const lines = readFileSync(defectsPath, "utf-8").split("\n");
    const updated: string[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line) as Record<string, unknown>;
        if (item["error_code"] === "LIVE_STAGNATION_DETECTED" && item["status"] !== "RESOLVED") {
          item["status"] = "RESOLVED";
          item["resolved_at"] = new Date().toISOString();
          item["resolution_note"] = "Automated active stagnation shock recovery interlock executed";
          resolvedCount++;
        }
        updated.push(JSON.stringify(item));
      } catch {
        updated.push(line);
      }
    }
    writeFileSync(defectsPath, updated.join("\n") + "\n", "utf-8");
  } catch {
    return { resolvedCount: 0 };
  }
  return { resolvedCount };
}

export function executeStagnationShockRecovery(
  repoRoot: string,
  options?: StagnationRecoveryOptions,
): StagnationShockResult {
  const now = options?.now ?? new Date().toISOString();
  const idle = options?.idleDurationSeconds ?? 0;
  const threshold = options?.stagnationThresholdSeconds ?? 120;
  const consecutive = options?.consecutiveCycles ?? 1;
  const pendingBacklog = options?.pendingBacklogCount ?? 0;

  if (idle < threshold) {
    return {
      recovered: false,
      mode: "NONE",
      resolvedIncidents: 0,
      timestamp: now,
    };
  }

  const mode =
    consecutive >= 3 || pendingBacklog === 0
      ? "MODE_A_AUTONOMIC_DISCOVERY"
      : "MODE_B_BACKLOG_REACTIVE";

  const { resolvedCount } = resolveStagnationIncidents(repoRoot);

  return {
    recovered: true,
    mode,
    resolvedIncidents: resolvedCount,
    timestamp: now,
  };
}
