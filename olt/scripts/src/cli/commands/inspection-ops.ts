import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonObject, JsonValue } from "../../core/contracts/json.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { commandEvidenceView, commandRecordPath } from "../../reporting/command-evidence.ts";
import { queryScreenshots } from "../../reporting/screenshot-store.ts";
import type { ScreenshotRecord } from "../../reporting/screenshot-types.ts";
import { loadRun } from "../../engine/store/index.ts";
import {
  formatEvidenceBrief,
  formatEvidenceListBrief,
  formatFindingBrief,
  formatFindingsListBrief,
  formatReportBrief,
  formatReportsListBrief,
  formatScreenshotsListBrief,
} from "../formatters/index.ts";
import { boolFlag, textFlag, type Flags } from "../options.ts";
import { resolveCapsuleRun } from "./dag-view.ts";

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordedFindings(state: JsonObject): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const tasks = state.tasks;
  if (isObject(tasks)) {
    for (const taskId of Object.keys(tasks).sort()) {
      const task = tasks[taskId];
      if (!isObject(task) || !Array.isArray(task.findings)) continue;
      for (const finding of task.findings) {
        if (isObject(finding)) found.push({ ...finding, task_id: taskId });
      }
    }
  }
  const review = state.completion_review;
  if (isObject(review) && Array.isArray(review.findings)) {
    for (const finding of review.findings) {
      if (isObject(finding)) found.push({ ...finding, source: "completeness-critic" });
    }
  }
  return found;
}

export function findingGetCommand(flags: Flags): Record<string, unknown> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const runFlag = textFlag(flags, "run", false);
  const runIdFlag = textFlag(flags, "run-id", false);
  const run = resolveCapsuleRun(repo, runFlag, runIdFlag);
  const id = textFlag(flags, "id", false) ?? textFlag(flags, "finding", false);

  const loaded = loadRun(run);
  const findings = recordedFindings(loaded.state);
  const home = `${run}/state.json`;

  if (id) {
    const wanted = id.endsWith(".json") ? id.slice(0, -".json".length) : id;
    const finding = findings.find((entry) => entry.id === wanted);
    if (!finding)
      throw new HarnessError("INVALID_ARGUMENT", `finding ${wanted} is not recorded in this run`);
    return {
      markdown: formatFindingBrief({ finding, path: home }),
      run_root: run,
      id: wanted,
      finding,
      path: home,
    };
  }

  return {
    markdown: formatFindingsListBrief({ findings, count: findings.length }),
    run_root: run,
    findings,
    count: findings.length,
    path: home,
  };
}

export function reportGetCommand(flags: Flags): Record<string, unknown> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const runFlag = textFlag(flags, "run", false);
  const runIdFlag = textFlag(flags, "run-id", false);
  const run = resolveCapsuleRun(repo, runFlag, runIdFlag);
  const task = textFlag(flags, "task", false);
  const isCriticFlag = boolFlag(flags, "critic");
  const isSubmissionFlag = boolFlag(flags, "submission");
  const isReviewFlag = boolFlag(flags, "review");
  const showScreenshots = boolFlag(flags, "screenshots");
  const typeFlag = textFlag(flags, "type", false);
  const stageFlag = textFlag(flags, "stage", false);
  const reportName = textFlag(flags, "report", false) ?? textFlag(flags, "id", false);

  const selectedType = (typeFlag ?? stageFlag ?? "").toLowerCase();
  const isSubmission = isSubmissionFlag || selectedType === "submission";
  const isReview = isReviewFlag || selectedType === "review";
  const isCritic = isCriticFlag || selectedType === "critic";

  const loaded = loadRun(run);
  const reportsDir = join(loaded.runRoot, "reports");

  let targetFileName: string | undefined;
  if (task) {
    if (isSubmission) {
      targetFileName = `${task}-submission.json`;
    } else if (isReview) {
      targetFileName = `${task}-review.json`;
    } else {
      targetFileName = `${task}-review.json`;
      if (!existsSync(join(reportsDir, targetFileName))) {
        if (existsSync(join(reportsDir, `${task}-submission.json`))) {
          targetFileName = `${task}-submission.json`;
        }
      }
    }
  } else if (isCritic) {
    targetFileName = "critic-review.json";
  } else if (reportName) {
    targetFileName = reportName.endsWith(".json") ? reportName : `${reportName}.json`;
  }

  if (targetFileName) {
    const filePath = join(reportsDir, targetFileName);
    if (!existsSync(filePath)) {
      throw new HarnessError("INVALID_ARGUMENT", `report not found: ${targetFileName}`);
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    } catch {
      throw new HarnessError("INVALID_ARGUMENT", `invalid json in report file: ${filePath}`);
    }
    const markdown = formatReportBrief({
      report: data,
      path: filePath,
      name: targetFileName,
      showScreenshots,
    });
    return {
      markdown,
      run_root: run,
      report: data,
      path: filePath,
      screenshots: Array.isArray(data.screenshots) ? data.screenshots : [],
      screenshot_records: Array.isArray(data.screenshot_records) ? data.screenshot_records : [],
    };
  }

  const reports: { name: string; path: string; data?: Record<string, unknown> }[] = [];
  if (existsSync(reportsDir)) {
    const files = readdirSync(reportsDir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const p = join(reportsDir, f);
      try {
        const item = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
        reports.push({ name: f, path: p, data: item });
      } catch {
        reports.push({ name: f, path: p });
      }
    }
  }

  const markdown = formatReportsListBrief({ reports, count: reports.length, showScreenshots });
  return {
    markdown,
    run_root: run,
    reports,
    count: reports.length,
  };
}

export function evidenceGetCommand(flags: Flags): Record<string, unknown> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const runFlag = textFlag(flags, "run", false);
  const runIdFlag = textFlag(flags, "run-id", false);
  const run = resolveCapsuleRun(repo, runFlag, runIdFlag);
  const cmdId =
    textFlag(flags, "command", false) ??
    textFlag(flags, "id", false) ??
    textFlag(flags, "cmd", false);
  const taskFilter = textFlag(flags, "task", false);
  const gateFilter = textFlag(flags, "gate", false);
  const actorFilter = textFlag(flags, "actor", false);
  const showScreenshots = boolFlag(flags, "screenshots");

  const loaded = loadRun(run);
  const commands = loaded.state.commands;
  const recorded = isObject(commands) ? commands : {};

  if (cmdId) {
    const wanted = cmdId.endsWith(".json") ? cmdId.slice(0, -".json".length) : cmdId;
    const command = recorded[wanted];
    if (!isObject(command))
      throw new HarnessError("INVALID_ARGUMENT", `command ${wanted} is not recorded in this run`);
    const evidence = commandEvidenceView(loaded.runRoot, command, wanted);
    const path = `${run}/${commandRecordPath(wanted)}`;
    return {
      markdown: formatEvidenceBrief({ evidence, path, showScreenshots }),
      run_root: run,
      command_id: wanted,
      evidence,
      path,
      screenshots: (evidence.screenshot_records as ScreenshotRecord[]).map((record) => record.path),
      screenshot_records: evidence.screenshot_records,
    };
  }

  const evidenceList: Record<string, unknown>[] = [];
  for (const id of Object.keys(recorded).sort()) {
    const command = recorded[id];
    if (!isObject(command)) continue;
    if (taskFilter && command.task_id !== taskFilter) continue;
    if (gateFilter && command.gate_id !== gateFilter) continue;
    if (actorFilter && command.actor !== actorFilter) continue;
    evidenceList.push(commandEvidenceView(loaded.runRoot, command, id));
  }

  const markdown = formatEvidenceListBrief({
    evidence: evidenceList,
    count: evidenceList.length,
    showScreenshots,
  });
  return {
    markdown,
    run_root: run,
    evidence: evidenceList,
    count: evidenceList.length,
  };
}

export function evidenceScreenshotsCommand(flags: Flags): Record<string, unknown> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const runFlag = textFlag(flags, "run", false);
  const runIdFlag = textFlag(flags, "run-id", false);
  const run = resolveCapsuleRun(repo, runFlag, runIdFlag);
  const taskFilter = textFlag(flags, "task", false);
  const cmdFilter =
    textFlag(flags, "command", false) ??
    textFlag(flags, "cmd", false) ??
    textFlag(flags, "id", false);
  const actorFilter = textFlag(flags, "actor", false);

  const loaded = loadRun(run);
  const screenshots = queryScreenshots(loaded.runRoot, {
    taskId: taskFilter,
    commandId: cmdFilter,
    actor: actorFilter,
  });

  const markdown = formatScreenshotsListBrief({
    screenshots,
    count: screenshots.length,
    taskId: taskFilter,
    commandId: cmdFilter,
  });

  return {
    markdown,
    run_root: run,
    screenshots,
    count: screenshots.length,
  };
}
