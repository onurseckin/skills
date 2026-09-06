import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentGrantRecord } from "../../core/contracts/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { readAgentLedger } from "./ledger.ts";

export type ReconciliationStatus = "synced" | "drift_detected" | "integrity_error";

export interface GhostAgent {
  readonly agentId: string;
  readonly role: string;
  readonly grantStatus: string;
  readonly reason: string;
}

export interface UntrackedAgent {
  readonly agentId: string;
  readonly source: "transcript" | "process" | "subagent";
  readonly details?: string | undefined;
}

export interface IntegrityViolation {
  readonly code: string;
  readonly message: string;
  readonly agentId?: string | undefined;
}

export interface DualChannelReconciliationResult {
  readonly status: ReconciliationStatus;
  readonly channel1Count: number;
  readonly channel2Count: number;
  readonly ghostAgents: readonly GhostAgent[];
  readonly untrackedAgents: readonly UntrackedAgent[];
  readonly integrityViolations: readonly IntegrityViolation[];
  readonly syncedAgentIds: readonly string[];
}

export interface ProcessEntry {
  readonly pid?: number | undefined;
  readonly agentId: string;
  readonly command?: string | undefined;
}

export interface TelemetryReconcilerOptions {
  readonly hostProcesses?: readonly ProcessEntry[] | undefined;
  readonly checkProcessTable?: boolean | undefined;
  readonly transcriptsDir?: string | undefined;
  readonly subagentsDir?: string | undefined;
}

function extractAgentIdFromFilename(filename: string): string {
  return basename(filename).replace(/\.(json|jsonl|log|md|txt)$/, "");
}

function scanChannel2Agents(
  runRoot: string,
  options?: TelemetryReconcilerOptions,
): {
  readonly channel2AgentIds: Set<string>;
  readonly transcriptAgents: Set<string>;
  readonly subagentDirs: Set<string>;
  readonly processAgents: Set<string>;
} {
  const channel2AgentIds = new Set<string>();
  const transcriptAgents = new Set<string>();
  const subagentDirs = new Set<string>();
  const processAgents = new Set<string>();

  const scanDir = (dir: string, set: Set<string>): void => {
    if (!existsSync(dir)) return;
    try {
      for (const f of readdirSync(dir)) {
        if (!f.startsWith(".")) {
          const id = extractAgentIdFromFilename(f);
          if (id.length > 0) {
            set.add(id);
            channel2AgentIds.add(id);
          }
        }
      }
    } catch {
      // Ignore read errors gracefully
    }
  };

  scanDir(options?.transcriptsDir ?? join(runRoot, "transcripts"), transcriptAgents);
  scanDir(options?.subagentsDir ?? join(runRoot, "subagents"), subagentDirs);

  if (options?.hostProcesses) {
    for (const proc of options.hostProcesses) {
      if (proc.agentId && proc.agentId.trim().length > 0) {
        processAgents.add(proc.agentId);
        channel2AgentIds.add(proc.agentId);
      }
    }
  }

  return { channel2AgentIds, transcriptAgents, subagentDirs, processAgents };
}

function checkLineageIntegrity(
  grants: readonly AgentGrantRecord[],
  violations: IntegrityViolation[],
): void {
  const byId = new Map(grants.map((g) => [g.id, g]));

  for (const grant of grants) {
    if (grant.parent_agent_id === grant.id) {
      violations.push({
        code: "LINEAGE_CYCLE_DETECTED",
        agentId: grant.id,
        message: `Agent '${grant.id}' declares itself as its own parent.`,
      });
      continue;
    }

    const seen = new Set<string>([grant.id]);
    let curr = grant.parent_agent_id;
    while (curr !== null && curr !== undefined) {
      if (seen.has(curr)) {
        violations.push({
          code: "LINEAGE_CYCLE_DETECTED",
          agentId: grant.id,
          message: `Lineage cycle detected for agent '${grant.id}' involving parent '${curr}'.`,
        });
        break;
      }
      seen.add(curr);
      const parentGrant = byId.get(curr);
      curr = parentGrant ? parentGrant.parent_agent_id : null;
    }
  }
}

function extractTokenCount(val: unknown): number | undefined {
  if (typeof val === "number") return val;
  if (typeof val === "object" && val !== null && "value" in val) {
    const inner = (val as Record<string, unknown>).value;
    if (typeof inner === "number") return inner;
  }
  return undefined;
}

function checkTokenMetricsIntegrity(
  grants: readonly AgentGrantRecord[],
  violations: IntegrityViolation[],
): void {
  for (const grant of grants) {
    const raw = grant as unknown as Record<string, unknown>;
    const tokensIn = extractTokenCount(raw["tokens_in"] ?? raw["tokensIn"]);
    const tokensOut = extractTokenCount(raw["tokens_out"] ?? raw["tokensOut"]);

    if (tokensIn !== undefined && (tokensIn < 0 || Number.isNaN(tokensIn))) {
      violations.push({
        code: "TOKEN_STATE_CORRUPT",
        agentId: grant.id,
        message: `Agent '${grant.id}' has invalid negative or NaN tokens_in: ${String(tokensIn)}.`,
      });
    }

    if (tokensOut !== undefined && (tokensOut < 0 || Number.isNaN(tokensOut))) {
      violations.push({
        code: "TOKEN_STATE_CORRUPT",
        agentId: grant.id,
        message: `Agent '${grant.id}' has invalid negative or NaN tokens_out: ${String(tokensOut)}.`,
      });
    }
  }
}

export async function reconcileDualChannelTelemetry(
  runRoot: string,
  _repoRoot?: string,
  options?: TelemetryReconcilerOptions,
): Promise<DualChannelReconciliationResult> {
  const violations: IntegrityViolation[] = [];
  let grants: AgentGrantRecord[] = [];

  try {
    const capsuleRun = loadRun(runRoot, false);
    const rawAgents = (capsuleRun.state as Record<string, unknown>)["agents"];
    if (rawAgents !== undefined && !Array.isArray(rawAgents)) {
      violations.push({
        code: "LEDGER_INTEGRITY_ERROR",
        message: "state.agents must be an array of agent grant records",
      });
    } else {
      try {
        grants = readAgentLedger(capsuleRun.state);
      } catch (ledgerErr) {
        if (Array.isArray(rawAgents)) {
          for (const item of rawAgents) {
            if (
              typeof item === "object" &&
              item !== null &&
              typeof (item as Record<string, unknown>).id === "string"
            ) {
              grants.push(item as unknown as AgentGrantRecord);
            }
          }
        }
        if (grants.length === 0) {
          violations.push({
            code: "LEDGER_INTEGRITY_ERROR",
            message: ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr),
          });
        }
      }
    }
  } catch (err) {
    violations.push({
      code: "LEDGER_INTEGRITY_ERROR",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  checkLineageIntegrity(grants, violations);
  checkTokenMetricsIntegrity(grants, violations);

  const { channel2AgentIds, transcriptAgents, subagentDirs, processAgents } = scanChannel2Agents(
    runRoot,
    options,
  );

  const grantMap = new Map(grants.map((g) => [g.id, g]));
  const ghostAgents: GhostAgent[] = [];
  const syncedAgentIds: string[] = [];

  for (const grant of grants) {
    const hasTranscript = transcriptAgents.has(grant.id);
    const hasSubagentDir = subagentDirs.has(grant.id);
    const hasProcess = processAgents.has(grant.id);
    const hasChannel2 = hasTranscript || hasSubagentDir || hasProcess;

    if (grant.status === "active" && !hasChannel2) {
      ghostAgents.push({
        agentId: grant.id,
        role: grant.role,
        grantStatus: grant.status,
        reason:
          "Active grant in Channel 1 has no corresponding host process or transcript in Channel 2",
      });
    } else if (hasChannel2) {
      syncedAgentIds.push(grant.id);
    }
  }

  const untrackedAgents: UntrackedAgent[] = [];
  for (const id of channel2AgentIds) {
    if (!grantMap.has(id)) {
      let source: "transcript" | "process" | "subagent" = "transcript";
      if (processAgents.has(id)) {
        source = "process";
      } else if (subagentDirs.has(id)) {
        source = "subagent";
      }
      untrackedAgents.push({
        agentId: id,
        source,
        details: `Discovered in Channel 2 via ${source} without corresponding grant in Channel 1`,
      });
    }
  }

  let status: ReconciliationStatus = "synced";
  if (violations.length > 0) {
    status = "integrity_error";
  } else if (ghostAgents.length > 0 || untrackedAgents.length > 0) {
    status = "drift_detected";
  }

  return {
    status,
    channel1Count: grants.length,
    channel2Count: channel2AgentIds.size,
    ghostAgents,
    untrackedAgents,
    integrityViolations: violations,
    syncedAgentIds,
  };
}
