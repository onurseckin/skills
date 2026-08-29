import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { loadRun } from "../../engine/store/index.ts";
import {
  buildEscalationDigest,
  formatEscalationDigestMarkdown,
  type EscalationDigestData,
} from "../digest.ts";

export interface ExecuteRepairLaneOptions {
  readonly runRoot: string;
  readonly capsulesDir?: string | undefined;
  readonly now?: Date | string | number | undefined;
  readonly actor?: string | undefined;
  readonly writeReport?: boolean | undefined;
}

export interface RepairLaneResult {
  readonly digest: EscalationDigestData;
  readonly markdown: string;
  readonly reportPath?: string | undefined;
  readonly hasSignals: boolean;
  readonly triageCounts: {
    readonly openFindings: number;
    readonly failingGates: number;
    readonly escalations: number;
    readonly declinedCandidates: number;
    readonly openProposals: number;
    readonly totalSignals: number;
  };
  readonly inspectedRuns: readonly string[];
}

export async function executeRepairLane(
  options: ExecuteRepairLaneOptions,
): Promise<RepairLaneResult> {
  const { runRoot, now, writeReport = true } = options;
  const capsulesDir = options.capsulesDir ?? (existsSync(runRoot) ? dirname(runRoot) : undefined);

  const inspectedRuns: string[] = [];
  const liveRunEntries: {
    readonly runId: string;
    readonly runRoot?: string | undefined;
    readonly state?: Record<string, unknown> | undefined;
  }[] = [];

  let mindState: Record<string, unknown> | undefined = undefined;

  if (existsSync(runRoot)) {
    try {
      const loaded = loadRun(runRoot, false);
      mindState = loaded.state as Record<string, unknown>;
      inspectedRuns.push(basename(runRoot));
    } catch {
      // ignore unreadable mind run root
    }
  }

  if (capsulesDir && existsSync(capsulesDir)) {
    try {
      const currentName = basename(runRoot);
      const entries = readdirSync(capsulesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (entry.name.startsWith(".")) continue;
        if (entry.name === currentName) continue;

        const targetRun = join(capsulesDir, entry.name);
        try {
          const loaded = loadRun(targetRun, false);
          const completion = loaded.state.completion_result as { status?: string } | undefined;
          if (completion?.status === "complete") continue;

          inspectedRuns.push(entry.name);
          liveRunEntries.push({
            runId: entry.name,
            runRoot: targetRun,
            state: loaded.state as Record<string, unknown>,
          });
        } catch {
          // ignore non-capsule or unreadable folders
        }
      }
    } catch {
      // ignore
    }
  }

  const digest = buildEscalationDigest({
    runId: basename(runRoot),
    mindRunRoot: runRoot,
    state: mindState,
    liveRuns: liveRunEntries,
    now,
  });

  const markdown = formatEscalationDigestMarkdown(digest);

  let reportPath: string | undefined = undefined;
  if (writeReport && existsSync(runRoot)) {
    try {
      const reportsDir = join(runRoot, "reports");
      if (!existsSync(reportsDir)) {
        mkdirSync(reportsDir, { recursive: true });
      }
      reportPath = join(reportsDir, "escalation-digest.md");
      writeFileSync(reportPath, markdown, "utf-8");
    } catch {
      // ignore write failure if directory is read-only
    }
  }

  const hasSignals =
    digest.openFindings.length > 0 ||
    digest.failingGates.length > 0 ||
    digest.escalations.length > 0;

  const triageCounts = {
    openFindings: digest.openFindings.length,
    failingGates: digest.failingGates.length,
    escalations: digest.escalations.length,
    declinedCandidates: digest.declinedCandidates.length,
    openProposals: digest.openProposals.length,
    totalSignals: digest.totalSignalsCount,
  };

  return {
    digest,
    markdown,
    reportPath,
    hasSignals,
    triageCounts,
    inspectedRuns,
  };
}
