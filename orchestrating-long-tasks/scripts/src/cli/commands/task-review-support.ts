import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ingestScreenshots, ingestVisualReport } from "../../reporting/screenshot-ingestion.ts";
import { getVisualReport, queryScreenshots } from "../../reporting/screenshot-store.ts";
import type { ScreenshotRecord } from "../../reporting/screenshot-types.ts";
import { attachGateResult } from "../../workflow/gates/attach-result.ts";
import { finishTask } from "../../workflow/gates/finish-task.ts";
import { applicableGates } from "../../workflow/gates/gate-policy.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import type { WorkflowState } from "../../workflow/types.ts";

export interface ReviewFindingParams {
  taskId: string;
  findingId?: string | undefined;
  round: number;
  requirementId: string;
  severity: "critical" | "important" | "minor";
  checkIds: string[];
  summary: string;
  remediation: string;
}

export function buildReviewFinding(params: ReviewFindingParams): Record<string, unknown> {
  const findingId =
    params.findingId ??
    (params.round > 1
      ? `finding-${params.taskId}-${String(params.round).padStart(2, "0")}`
      : `finding-${params.taskId}-01`);

  return {
    id: findingId,
    requirement_id: params.requirementId,
    severity: params.severity,
    evidence:
      params.checkIds.length > 0
        ? params.checkIds.map((id) => ({ kind: "command", reference: id }))
        : [{ kind: "failure", detail: params.summary }],
    observation: params.summary,
    remediation: params.remediation,
    revalidation: `Run gate tests for ${params.taskId}`,
  };
}

export function persistFindingFile(runRoot: string, finding: Record<string, unknown>): string {
  const findingsDir = join(runRoot, "findings");
  mkdirSync(findingsDir, { recursive: true });
  const findingId = String(finding.id ?? "finding");
  const findingPath = join(findingsDir, `${findingId}.json`);
  writeFileSync(findingPath, JSON.stringify(finding, null, 2), "utf-8");
  return findingPath;
}

export function collectTaskScreenshots(
  runRoot: string,
  taskId: string,
  validator: string,
  checkIds: string[],
): ScreenshotRecord[] {
  const repoRoot = dirname(dirname(runRoot));

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
    overwrite: true,
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
    overwrite: true,
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
    uniqueMap.set(s.evidence_path, s);
  }
  return Array.from(uniqueMap.values());
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
      const matchingCmd = checkIds.find((id) => {
        const cmd = curState.commands[id];
        return cmd && (cmd.gate_id === gate.id || !cmd.gate_id);
      });
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
