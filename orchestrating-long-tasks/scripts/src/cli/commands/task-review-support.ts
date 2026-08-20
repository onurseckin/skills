import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getHarnessConfig } from "../../config/harness-config.ts";
import { ingestScreenshots, ingestVisualReport } from "../../reporting/screenshot-ingestion.ts";
import { getVisualReport, queryScreenshots } from "../../reporting/screenshot-store.ts";
import type { ScreenshotRecord } from "../../reporting/screenshot-types.ts";
import { analyzeDualChannel, type DualChannelAuditResult } from "../../validation/dual-channel-analyzer.ts";
import {
  adaptIngestedVisualReport,
  adaptScreenshotRecords,
} from "../../validation/report-adapter.ts";
import { attachGateResult } from "../../workflow/gates/attach-result.ts";
import { finishTask } from "../../workflow/gates/finish-task.ts";
import { applicableGates } from "../../workflow/gates/gate-policy.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import type { TaskRecord, WorkflowState } from "../../workflow/types.ts";

/** The run root is `<repo>/.capsules/<run-id>`; both layers of config are keyed off that pair. */
export function repoRootOf(runRoot: string): string {
  return dirname(dirname(runRoot));
}

export interface ReviewPolicy {
  minProbes: number;
  maxRepairRounds: number;
}

export function reviewPolicyFor(runRoot: string): ReviewPolicy {
  const config = getHarnessConfig(repoRootOf(runRoot), runRoot);
  return {
    minProbes: config.min_adversarial_probes,
    maxRepairRounds: config.max_repair_rounds,
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

  ingestScreenshots({
    runRoot,
    taskId,
    actor: validator,
    searchDirs: [
      repoRoot,
      join(repoRoot, "test-results"),
      join(repoRoot, "screenshots"),
      join(repoRoot, "playwright-report"),
    ],
  });

  ingestVisualReport({
    runRoot,
    taskId,
    actor: validator,
    searchDirs: [
      repoRoot,
      join(repoRoot, "test-results"),
      join(repoRoot, "screenshots"),
      join(repoRoot, "playwright-report"),
    ],
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

/**
 * Runs the Dual-Channel Validator Protocol the skill mandates for UI tasks against evidence the run
 * actually recorded: the ingested `visual-report.json` (DOM channel) and the screenshots collected
 * for this task (visual channel). Reads `task.write_scope`, the lease the run itself granted, rather
 * than a file list a caller could shape to dodge the mandate.
 *
 * Both channels are read scoped to this task. The run-wide latest report would let a UI task clear
 * the mandate on a sibling task's capture, which is the misattribution the capture ledger records
 * ownership to prevent.
 */
export function runDualChannelAudit(
  runRoot: string,
  task: TaskRecord,
  screenshots: readonly ScreenshotRecord[],
): DualChannelAuditResult {
  return analyzeDualChannel({
    writeScope: task.write_scope,
    domReport: adaptIngestedVisualReport(getVisualReport(runRoot, task.id)),
    screenshots: adaptScreenshotRecords(screenshots),
  });
}

/**
 * The sentence a refused pass carries: which findings the mandate turned up, not just that it did.
 * `task:review` reads this to refuse a UI pass that lacks corroborated dual-channel evidence.
 */
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
  // Probe rounds are numbered so a later round never overwrites the demand history of an earlier one.
  const reportPath = join(reportsDir, `${taskId}-probe-${String(round).padStart(2, "0")}.json`);
  writeFileSync(reportPath, JSON.stringify(reportData, null, 2), "utf-8");
  return reportPath;
}

export function persistReviewReport(
  runRoot: string,
  taskId: string,
  reportData: Record<string, unknown>,
): string {
  const reportsDir = join(runRoot, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, `${taskId}-review.json`);

  const visualReport = getVisualReport(runRoot);
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

/**
 * Only a command the runner bound to this gate proves it. An unbound run proves whatever it ran,
 * which is not the same thing as the gate the plan made mandatory, however alike the two look.
 */
export function gateProofCommand(
  commands: Readonly<Record<string, { gate_id: string | null }>>,
  gateId: string,
  checkIds: readonly string[],
): string | undefined {
  return checkIds.find((id) => commands[id]?.gate_id === gateId);
}

export function finalizePassingTask(
  run: string,
  taskId: string,
  validator: string,
  checkIds: string[],
  state: WorkflowState,
): WorkflowState {
  let curState = state;
  const currentTask = curState.tasks[taskId];
  if (currentTask) {
    for (const gate of applicableGates(curState, currentTask)) {
      const matchingCmd = gateProofCommand(curState.commands, gate.id, checkIds);
      if (matchingCmd) {
        try {
          curState = attachGateResult(workflowPort(run), taskId, gate.id, matchingCmd, validator);
        } catch {}
      }
    }
    try {
      curState = finishTask(workflowPort(run), taskId, validator);
    } catch {}
  }
  return curState;
}
