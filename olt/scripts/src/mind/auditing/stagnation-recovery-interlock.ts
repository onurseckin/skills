import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolveDefectsPath } from "../../core/shared/paths.ts";

export const MODE_A_AUTONOMIC_DISCOVERY = "MODE_A_AUTONOMIC_DISCOVERY" as const;
export const MODE_B_BACKLOG_REACTIVE = "MODE_B_BACKLOG_REACTIVE" as const;
export const MODE_STANDARD_PREPLAN = "MODE_STANDARD_PREPLAN" as const;
export const MODE_DORMANT = "MODE_DORMANT" as const;
export const CHRONIC_STAGNATION_CYCLE_THRESHOLD = 3;

export type StagnationMode =
  | typeof MODE_A_AUTONOMIC_DISCOVERY
  | typeof MODE_B_BACKLOG_REACTIVE
  | typeof MODE_STANDARD_PREPLAN
  | typeof MODE_DORMANT;

export interface StagnationShockResult {
  readonly recovered: boolean;
  readonly mode: StagnationMode | "NONE";
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

export type StagnationShockOptions = StagnationRecoveryOptions;

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
