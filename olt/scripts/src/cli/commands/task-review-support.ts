import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getHarnessConfig } from "../../core/config/harness-config.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { ingestScreenshots, ingestVisualReport } from "../../reporting/screenshot-ingestion.ts";
import { getVisualReport, queryScreenshots } from "../../reporting/screenshot-store.ts";
import type { ScreenshotRecord } from "../../reporting/screenshot-types.ts";
import {
  analyzeDualChannel,
  type CompanionManifestData,
  type DualChannelAuditResult,
} from "../../validation/dual-channel-analyzer.ts";
import {
  adaptIngestedVisualReport,
  adaptScreenshotRecords,
} from "../../validation/report-adapter.ts";
import { attachGateResult } from "../../workflow/gates/attach-result.ts";
import { finishTask } from "../../workflow/gates/finish-task.ts";
import { applicableGates } from "../../workflow/gates/gate-policy.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import type { TaskRecord, TransactionPort, WorkflowState } from "../../workflow/types.ts";

import { findRepoRoot } from "../../core/shared/paths.ts";

export function repoRootOf(runRoot: string): string {
  return findRepoRoot(runRoot);
}

import {
  resolveReviewProtocolConfig,
  type ReviewProtocolConfig,
} from "../../policy/review-protocol.ts";
import { readAgentMetadata } from "../../runtime/agent-metadata.ts";

export interface ReviewPolicy {
  minProbes: number;
  maxRepairRounds: number;
  reviewProtocol: ReviewProtocolConfig;
}

export function reviewPolicyFor(runRoot: string, validatorId?: string): ReviewPolicy {
  const repoRoot = repoRootOf(runRoot);
  const config = getHarnessConfig(repoRoot, runRoot);
  const agentMetadata = validatorId ? readAgentMetadata(validatorId, runRoot) : undefined;
  const reviewProtocol = resolveReviewProtocolConfig(repoRoot, agentMetadata);

  return {
    minProbes: config.min_adversarial_probes ?? 1,
    maxRepairRounds: reviewProtocol.max_adversarial_pushes,
    reviewProtocol,
  };
}

export {
  buildProbeDemand,
  buildReviewFinding,
  failingVerdictInput,
  nextFindingRound,
  parseSeverity,
  resolveFindingRequirement,
} from "./task-finding-input.ts";
export type {
  FailingVerdictInput,
  FindingSeverity,
  ProbeDemandParams,
  ReviewFindingParams,
} from "./task-finding-input.ts";

export function collectTaskScreenshots(
  runRoot: string,
  taskId: string,
  validator: string,
  checkIds: string[],
): ScreenshotRecord[] {
  const repoRoot = repoRootOf(runRoot);

  const searchDirs = [
    join(repoRoot, "test-results"),
    join(repoRoot, "screenshots"),
    join(repoRoot, "playwright-report"),
    join(repoRoot, "captures"),
    join(runRoot, "evidence"),
    join(runRoot, "captures"),
  ];

  ingestScreenshots({
    runRoot,
    taskId,
    actor: validator,
    searchDirs,
  });

  ingestVisualReport({
    runRoot,
    taskId,
    actor: validator,
    searchDirs,
  });

  const directScreenshots = queryScreenshots(runRoot, { taskId });
  const checkScreenshots: ScreenshotRecord[] = [];

  for (const cmdId of checkIds) {
    const fromCmd = queryScreenshots(runRoot, { commandId: cmdId });
    for (const s of fromCmd) {
      if (!directScreenshots.some((d) => d.name === s.name)) {
        checkScreenshots.push(s);
      }
    }
  }

  const combined = [...directScreenshots, ...checkScreenshots];
  const uniqueMap = new Map<string, ScreenshotRecord>();
  for (const s of combined) {
    uniqueMap.set(s.sha256, s);
  }
  return Array.from(uniqueMap.values());
}

export function collectCompanionManifests(
  runRoot: string,
  _taskId?: string,
): CompanionManifestData[] {
  const repoRoot = repoRootOf(runRoot);
  const searchDirs = [
    join(runRoot, "captures"),
    join(runRoot, "evidence"),
    join(repoRoot, "captures"),
    join(repoRoot, ".captures"),
    join(repoRoot, "test-results"),
    join(repoRoot, "screenshots"),
    join(repoRoot, "playwright-report"),
  ];

  const manifests: CompanionManifestData[] = [];
  const visitedPaths = new Set<string>();

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isFile() && ent.name.endsWith(".manifest.json")) {
          const fullPath = resolve(join(dir, ent.name));
          if (visitedPaths.has(fullPath)) continue;
          visitedPaths.add(fullPath);
          try {
            const raw = readFileSync(fullPath, "utf-8");
            const parsed = JSON.parse(raw);
            if (typeof parsed === "object" && parsed !== null) {
              manifests.push(parsed as CompanionManifestData);
            }
          } catch {}
        }
      }
    } catch {}
  }
  return manifests;
}

export function runDualChannelAudit(
  runRoot: string,
  task: TaskRecord,
  screenshots: readonly ScreenshotRecord[],
  manifests?: readonly CompanionManifestData[],
  options?: { readonly requireSemanticDepth?: boolean },
): DualChannelAuditResult {
  const allManifests = manifests ?? collectCompanionManifests(runRoot, task.id);
  return analyzeDualChannel({
    writeScope: task.write_scope,
    domReport: adaptIngestedVisualReport(getVisualReport(runRoot, task.id)),
    screenshots: adaptScreenshotRecords(screenshots),
    manifests: allManifests,
    requireSemanticDepth: options?.requireSemanticDepth,
  });
}

export function dualChannelRefusalMessage(taskId: string, audit: DualChannelAuditResult): string {
  const errors = audit.findings.filter((f) => f.severity === "error");
  const detail = errors.map((f) => `${f.id} [${f.category}] ${f.message}`).join("; ");
  return `cannot pass ${taskId}: Dual-Channel Validator Protocol mandate not satisfied (mode ${audit.mode}): ${detail || audit.summary}`;
}

export function persistProbeReport(
  runRoot: string,
  taskId: string,
  round: number,
  reportData: Record<string, unknown>,
): string {
  const reportsDir = join(runRoot, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, `${taskId}-probe-${String(round).padStart(2, "0")}.json`);
  writeFileSync(reportPath, JSON.stringify(reportData, null, 2), "utf-8");
  return reportPath;
}

export function persistReviewReport(
  runRoot: string,
  taskId: string,
  reportData: Record<string, unknown>,
  isUiTask: boolean = true,
): string {
  const reportsDir = join(runRoot, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, `${taskId}-review.json`);

  const visualReport = isUiTask ? getVisualReport(runRoot) : undefined;
  const finalData = {
    ...reportData,
    ...(visualReport && !reportData.visual_report ? { visual_report: visualReport } : {}),
  };

  writeFileSync(reportPath, JSON.stringify(finalData, null, 2), "utf-8");
  return reportPath;
}

export function resolveCheckIds(
  explicitEvidence: string | undefined,
  commands: unknown,
  taskId: string,
  validator: string,
  requireSuccess: boolean,
): string[] {
  if (explicitEvidence) {
    return explicitEvidence
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!commands || typeof commands !== "object") return [];
  return (
    Object.values(commands) as {
      id: string;
      actor?: string;
      task_id?: string;
      exit_code?: number;
    }[]
  )

    .filter(
      (c) =>
        c.task_id === taskId && c.actor === validator && (!requireSuccess || c.exit_code === 0),
    )
    .map((c) => c.id);
}

export function gateProofCommand(
  commands: Readonly<Record<string, { gate_id: string | null }>>,
  gateId: string,
  checkIds: readonly string[],
): string | undefined {
  return checkIds.find((id) => commands[id]?.gate_id === gateId);
}

function isExpectedConcurrentFinalizeRace(error: unknown): boolean {
  return error instanceof HarnessError && error.code === "INVALID_STATE";
}

export function finalizePassingTask(
  run: string,
  taskId: string,
  validator: string,
  checkIds: string[],
  state: WorkflowState,
  port?: TransactionPort,
): WorkflowState {
  const activePort = port ?? workflowPort(run);
  let curState = state;
  const currentTask = curState.tasks[taskId];
  if (currentTask) {
    for (const gate of applicableGates(curState, currentTask)) {
      const matchingCmd = gateProofCommand(curState.commands, gate.id, checkIds);
      if (matchingCmd) {
        try {
          curState = attachGateResult(activePort, taskId, gate.id, matchingCmd, validator);
        } catch (error) {
          if (!isExpectedConcurrentFinalizeRace(error)) throw error;
        }
      }
    }
    try {
      curState = finishTask(activePort, taskId, validator);
    } catch (error) {
      if (!isExpectedConcurrentFinalizeRace(error)) throw error;
    }
  }
  return curState;
}
