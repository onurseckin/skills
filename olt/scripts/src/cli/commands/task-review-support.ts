import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getHarnessConfig } from "../../core/config/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot } from "../../core/shared/index.ts";
import { workflowPort } from "../../integration/index.ts";
import { resolveReviewProtocolConfig, type ReviewProtocolConfig } from "../../policy/index.ts";
import { MIN_ADVERSARIAL_PROBES } from "../../reporting/doctor/index.ts";
import { ingestScreenshots, ingestVisualReport } from "../../reporting/index.ts";
import { getVisualReport, queryScreenshots } from "../../reporting/index.ts";
import type { ScreenshotRecord } from "../../reporting/index.ts";
import { readAgentMetadata } from "../../runtime/index.ts";
import {
  analyzeDualChannel,
  type CompanionManifestData,
  type DualChannelAuditResult,
} from "../../validation/dual-channel-analyzer/index.ts";
import {
  adaptIngestedVisualReport,
  adaptScreenshotRecords,
} from "../../validation/reporters/index.ts";
import { attachGateResult } from "../../workflow/gates/index.ts";
import { finishTask } from "../../workflow/gates/index.ts";
import { applicableGates, taskHasPassedGate } from "../../workflow/gates/index.ts";
import type { TaskRecord, TransactionPort, WorkflowState } from "../../workflow/index.ts";

export function repoRootOf(runRoot: string): string {
  return findRepoRoot(runRoot);
}

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
    minProbes: config.min_adversarial_probes ?? MIN_ADVERSARIAL_PROBES,
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
  const searchDirs = ["test-results", "screenshots", "playwright-report", "captures"]
    .map((d) => join(repoRoot, d))
    .concat([join(runRoot, "evidence"), join(runRoot, "captures")]);

  ingestScreenshots({ runRoot, taskId, actor: validator, searchDirs });
  ingestVisualReport({ runRoot, taskId, actor: validator, searchDirs });

  const directScreenshots = queryScreenshots(runRoot, { taskId });
  const fromCmd = checkIds.flatMap((cmdId) => queryScreenshots(runRoot, { commandId: cmdId }));
  const checkScreenshots = fromCmd.filter((s) => !directScreenshots.some((d) => d.name === s.name));
  const uniqueMap = new Map<string, ScreenshotRecord>();
  for (const s of [...directScreenshots, ...checkScreenshots]) uniqueMap.set(s.sha256, s);
  return Array.from(uniqueMap.values());
}

export function collectCompanionManifests(
  runRoot: string,
  _taskId?: string,
): CompanionManifestData[] {
  const repoRoot = repoRootOf(runRoot);
  const searchDirs = [join(runRoot, "captures"), join(runRoot, "evidence")].concat(
    ["captures", ".captures", "test-results", "screenshots", "playwright-report"].map((d) =>
      join(repoRoot, d),
    ),
  );
  const manifests: CompanionManifestData[] = [];
  const visitedPaths = new Set<string>();
  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (!ent.isFile() ? true : !ent.name.endsWith(".manifest.json")) continue;
        const fullPath = resolve(join(dir, ent.name));
        if (visitedPaths.has(fullPath)) continue;
        visitedPaths.add(fullPath);
        try {
          const parsed = JSON.parse(readFileSync(fullPath, "utf-8"));
          if (typeof parsed === "object" && parsed !== null)
            manifests.push(parsed as CompanionManifestData);
        } catch {}
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
  const allManifests =
    manifests !== undefined ? manifests : collectCompanionManifests(runRoot, task.id);
  return analyzeDualChannel({
    writeScope: task.write_scope,
    domReport: adaptIngestedVisualReport(getVisualReport(runRoot, task.id)),
    screenshots: adaptScreenshotRecords(screenshots),
    manifests: allManifests,
    runRoot,
    requireSemanticDepth: options?.requireSemanticDepth,
  });
}

export function dualChannelRefusalMessage(taskId: string, audit: DualChannelAuditResult): string {
  const errors = audit.findings.filter((f) => f.severity === "error");
  const detail = errors.map((f) => `${f.id} [${f.category}] ${f.message}`).join("; ");
  const fallbackSummary = detail.length > 0 ? detail : audit.summary;
  return `cannot pass ${taskId}: Dual-Channel Validator Protocol mandate not satisfied (mode ${audit.mode}): ${fallbackSummary}`;
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

interface CommandLike {
  id?: string;
  actor?: string;
  task_id?: string;
  exit_code?: number;
}

export function resolveCheckIds(
  explicitEvidence: string | undefined,
  commands: unknown,
  taskId: string,
  validator: string,
  requireSuccess: boolean,
): string[] {
  if (explicitEvidence) {
    const ids = explicitEvidence
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!commands ? true : typeof commands !== "object") return ids;
    const commandMap = commands as Record<string, CommandLike>;
    if (Object.keys(commandMap).length === 0) return ids;
    for (const id of ids) {
      const cmd = commandMap[id];
      if (!cmd)
        throw new HarnessError("INVALID_STATE", `evidence names no recorded command: ${id}`);
      if (cmd.task_id !== undefined && cmd.task_id !== null && cmd.task_id !== taskId) {
        throw new HarnessError(
          "INVALID_STATE",
          `evidence command ${id} belongs to task ${cmd.task_id}`,
        );
      }
    }
    return ids;
  }
  if (!commands ? true : typeof commands !== "object") return [];
  const cmdList = Object.values(commands as Record<string, CommandLike>).filter(
    (c): c is CommandLike & { id: string } =>
      typeof c === "object" && c !== null && typeof c.id === "string",
  );
  const validatorMatches = cmdList
    .filter(
      (c) =>
        c.task_id === taskId &&
        c.actor === validator &&
        (!requireSuccess ? true : c.exit_code === 0),
    )
    .map((c) => c.id);
  if (validatorMatches.length > 0) return validatorMatches;

  return cmdList
    .filter((c) => c.task_id === taskId && (!requireSuccess ? true : c.exit_code === 0))
    .map((c) => c.id);
}

export function gateProofCommand(
  commands: Readonly<Record<string, { gate_id: string | null; exit_code?: number | null }>>,
  gateId: string,
  checkIds: readonly string[],
): string | undefined {
  const exact = checkIds.find((id) => commands[id]?.gate_id === gateId);
  if (exact !== undefined) return exact;
  const unclaimed = checkIds.filter(
    (id) => commands[id]?.gate_id === null || commands[id]?.gate_id === undefined,
  );
  return unclaimed.find((id) => (commands[id]?.exit_code ?? 0) === 0) ?? unclaimed[0];
}

function rereadTask(port: TransactionPort, taskId: string): [WorkflowState, TaskRecord] {
  const state = port.read();
  const task = state.tasks[taskId];
  if (!task) throw new HarnessError("INVALID_ARGUMENT", `unknown task: ${taskId}`);
  return [state, task];
}

function hasDurablePassedApplicableGate(
  state: WorkflowState,
  task: TaskRecord,
  gateId: string,
): boolean {
  return (
    applicableGates(state, task).some((gate) => gate.id === gateId) &&
    taskHasPassedGate(task, gateId)
  );
}

export function finalizePassingTask(
  run: string,
  taskId: string,
  validator: string,
  checkIds: string[],
  state: WorkflowState,
  port?: TransactionPort,
): WorkflowState {
  const activePort = port !== undefined ? port : workflowPort(run);
  let curState = state;
  const currentTask = curState.tasks[taskId];
  if (!currentTask) throw new HarnessError("INVALID_ARGUMENT", `unknown task: ${taskId}`);

  for (const gate of applicableGates(curState, currentTask)) {
    const matchingCmd = gateProofCommand(curState.commands, gate.id, checkIds);
    if (!matchingCmd || curState.commands[matchingCmd]?.gate_id !== gate.id)
      throw new HarnessError(
        "INVALID_STATE",
        `no matching proof command for mandatory gate ${gate.id}`,
      );
    try {
      curState = attachGateResult(activePort, taskId, gate.id, matchingCmd, validator);
    } catch (error) {
      const [freshState, freshTask] = rereadTask(activePort, taskId);
      if (!hasDurablePassedApplicableGate(freshState, freshTask, gate.id)) throw error;
      curState = freshState;
    }
  }
  try {
    curState = finishTask(activePort, taskId, validator);
  } catch (error) {
    const [freshState, freshTask] = rereadTask(activePort, taskId);
    if (freshTask.status !== "done") throw error;
    curState = freshState;
  }
  return curState;
}
