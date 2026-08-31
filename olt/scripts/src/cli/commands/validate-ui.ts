import { HarnessError } from "../../core/errors/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import {
  evaluateDualUiGates,
  type DualUiAuditResult,
  type UiViewportTier,
} from "../../validation/ui/index.ts";
import { classifiesAsUiTask } from "../../workflow/review/role-evidence.ts";
import type { TaskRecord, WorkflowState } from "../../workflow/types.ts";
import { boolFlag, integerFlag, textFlag, type Flags } from "../options.ts";
import {
  collectCompanionManifests,
  collectTaskScreenshots,
  resolveCheckIds,
} from "./task-review-support.ts";

export function formatValidateUiBrief(result: DualUiAuditResult, taskId: string): string {
  const statusEmoji = result.passed ? "✅" : "❌";
  const lines: string[] = [
    `### ${statusEmoji} Dual UI Validation Report: \`${taskId}\``,
    `- **Status**: ${result.passed ? "PASSED" : "FAILED"} (Mode: \`${result.mode}\`)`,
    `- **UI Scope Detected**: ${result.isUiTask ? "Yes" : "No"}`,
    "",
    `#### 🔧 Gate 1: UI Mechanic Validator`,
    `- **Mechanic Status**: ${result.mechanicReport.passed ? "PASSED" : "FAILED"}`,
    `- **Viewports Covered**: ${result.mechanicReport.viewportsCovered.join(", ") || "none"} (Missing: ${result.mechanicReport.missingViewports.join(", ") || "none"})`,
    `- **Touch Hitboxes (>= 44pt)**: ${result.mechanicReport.touchTargetEvaluations.length} checked, ${result.mechanicReport.touchTargetFailures.length} failed`,
    `- **Horizontal Overflow**: ${result.mechanicReport.overflowEvaluations.length} checked, ${result.mechanicReport.overflowViolations.length} violation(s)`,
    `- **Valid Screenshots (>= 1024B)**: ${result.mechanicReport.validScreenshotsCount}`,
    "",
    `#### 🧠 Gate 2: Cognitive UI Validator`,
    `- **Cognitive Status**: ${result.cognitiveReport.passed ? "PASSED" : "FAILED"}`,
    `- **Shell Privileges**: 0 commands allowed (can_execute_shell: false)`,
    `- **Optical Hierarchy**: ${result.cognitiveReport.opticalHierarchy.passed ? "Passed" : "Failed"} (Score: ${result.cognitiveReport.opticalHierarchy.score}/100)`,
    `- **Descender Integrity**: ${result.cognitiveReport.descenderIntegrity.passed ? "Passed" : "Failed"} (Inspected: ${result.cognitiveReport.descenderIntegrity.elementsInspected})`,
    `- **Aesthetic Harmony**: ${result.cognitiveReport.aestheticHarmony.passed ? "Passed" : "Failed"} (Score: ${result.cognitiveReport.aestheticHarmony.score}/100)`,
    `- **Qualitative Critique**: ${result.cognitiveReport.socraticCritique || "None provided"}`,
  ];

  if (result.defects.length > 0) {
    lines.push("", "#### ⚠️ Defects Detected:");
    for (const defect of result.defects) {
      lines.push(`- **[${defect.pillar.toUpperCase()}]** \`${defect.category}\`: ${defect.message} *(Remediation: ${defect.remediation})*`);
    }
  }

  lines.push("", `**Summary**: ${result.summary}`);
  return lines.join("\n");
}

export async function validateUiCommand(flags: Flags): Promise<Record<string, unknown>> {
  const [run, taskId] = [textFlag(flags, "run")!, textFlag(flags, "task")!];
  const mode = textFlag(flags, "mode", false) ?? "both";
  const touchFloor = integerFlag(flags, "touch-floor", { minimum: 24, maximum: 120 }) ?? 44;
  const critique = textFlag(flags, "critique", false) ?? textFlag(flags, "summary", false);
  const requireScreenshots = boolFlag(flags, "require-screenshots");

  const loaded = loadRun(run);
  const task = ((loaded.state.tasks ?? {}) as Record<string, TaskRecord>)[taskId];
  if (!task) throw new HarnessError("INVALID_ARGUMENT", `unknown task ${taskId}`);

  const isUi = classifiesAsUiTask(loaded.state as unknown as WorkflowState, task, true);
  const checkIds = resolveCheckIds(undefined, loaded.state.commands, taskId, "", false);
  const screenshots = collectTaskScreenshots(loaded.runRoot, taskId, "ui-mechanic-validator", checkIds);
  const manifests = collectCompanionManifests(loaded.runRoot, taskId);

  const screenshotRecords = screenshots.map((s) => ({
    name: s.name,
    path: s.path,
    viewport: (s as unknown as Record<string, unknown>)["viewport"] as string | undefined,
    sizeBytes: s.bytes,
  }));

  const viewportsInput = textFlag(flags, "viewports", false)
    ?.split(",")
    .map((v) => v.trim() as UiViewportTier)
    .filter(Boolean);

  const result = evaluateDualUiGates({
    isUiTask: isUi,
    mechanicInput: {
      taskId,
      writeScope: task.write_scope,
      minTouchDimension: touchFloor,
      ...(viewportsInput !== undefined ? { viewports: viewportsInput } : {}),
      screenshots: screenshotRecords,
    },
    cognitiveInput: {
      taskId,
      critique: critique ?? "Human-grade qualitative design review evaluating visual hierarchy, optical layout rhythm, and descender line-height clearance.",
      screenshotsReviewed: screenshots.map((s) => s.path),
      canExecuteShell: false,
    },
  });

  if (requireScreenshots && result.mechanicReport.validScreenshotsCount === 0) {
    throw new HarnessError(
      "INVALID_STATE",
      `UI validation failed: no valid screenshot artifacts (>= 1024 bytes) recorded for ${taskId}`,
    );
  }

  const markdown = formatValidateUiBrief(result, taskId);

  return {
    run_root: run,
    task_id: taskId,
    mode,
    passed: result.passed,
    is_ui_task: isUi,
    dual_ui_audit: result,
    markdown,
  };
}
