import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../errors/harness-error.ts";
import { loadRun } from "../../store/index.ts";
import {
  formatEvidenceBrief,
  formatEvidenceListBrief,
  formatFindingBrief,
  formatFindingsListBrief,
  formatReportBrief,
  formatReportsListBrief,
} from "../formatters/index.ts";
import { assertFlags, boolFlag, textFlag, type Flags } from "../options.ts";

export function findingGetCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "id", "finding"]);
  const run = textFlag(flags, "run")!;
  const id = textFlag(flags, "id", false) ?? textFlag(flags, "finding", false);

  const loaded = loadRun(run);
  const findingsDir = join(loaded.runRoot, "findings");

  if (id) {
    const fileName = id.endsWith(".json") ? id : `${id}.json`;
    const filePath = join(findingsDir, fileName);
    if (!existsSync(filePath)) {
      throw new HarnessError("INVALID_ARGUMENT", `finding ${id} not found at ${filePath}`);
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    } catch {
      throw new HarnessError("INVALID_ARGUMENT", `invalid json in finding file: ${filePath}`);
    }
    const markdown = formatFindingBrief({ finding: data, path: filePath });
    return {
      markdown,
      run_root: run,
      id: (data.id as string | undefined) ?? id,
      finding: data,
      path: filePath,
    };
  }

  const findings: Record<string, unknown>[] = [];
  if (existsSync(findingsDir)) {
    const files = readdirSync(findingsDir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      try {
        const item = JSON.parse(readFileSync(join(findingsDir, f), "utf-8")) as Record<
          string,
          unknown
        >;
        findings.push(item);
      } catch {}
    }
  }

  const markdown = formatFindingsListBrief({ findings, count: findings.length });
  return {
    markdown,
    run_root: run,
    findings,
    count: findings.length,
  };
}

export function reportGetCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, [
    "run",
    "task",
    "critic",
    "report",
    "id",
    "type",
    "stage",
    "submission",
    "review",
  ]);
  const run = textFlag(flags, "run")!;
  const task = textFlag(flags, "task", false);
  const isCriticFlag = boolFlag(flags, "critic");
  const isSubmissionFlag = boolFlag(flags, "submission");
  const isReviewFlag = boolFlag(flags, "review");
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
    const markdown = formatReportBrief({ report: data, path: filePath, name: targetFileName });
    return {
      markdown,
      run_root: run,
      report: data,
      path: filePath,
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

  const markdown = formatReportsListBrief({ reports, count: reports.length });
  return {
    markdown,
    run_root: run,
    reports,
    count: reports.length,
  };
}

export function evidenceGetCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "command", "id", "cmd", "task", "gate", "actor"]);
  const run = textFlag(flags, "run")!;
  const cmdId =
    textFlag(flags, "command", false) ??
    textFlag(flags, "id", false) ??
    textFlag(flags, "cmd", false);
  const taskFilter = textFlag(flags, "task", false);
  const gateFilter = textFlag(flags, "gate", false);
  const actorFilter = textFlag(flags, "actor", false);

  const loaded = loadRun(run);
  const evidenceDir = join(loaded.runRoot, "evidence");

  if (cmdId) {
    const fileName = cmdId.endsWith(".json") ? cmdId : `${cmdId}.json`;
    const filePath = join(evidenceDir, fileName);
    if (!existsSync(filePath)) {
      throw new HarnessError("INVALID_ARGUMENT", `evidence ${cmdId} not found at ${filePath}`);
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    } catch {
      throw new HarnessError("INVALID_ARGUMENT", `invalid json in evidence file: ${filePath}`);
    }
    const markdown = formatEvidenceBrief({ evidence: data, path: filePath });
    return {
      markdown,
      run_root: run,
      command_id:
        (data.command_id as string | undefined) ?? (data.id as string | undefined) ?? cmdId,
      evidence: data,
      path: filePath,
    };
  }

  const evidenceList: Record<string, unknown>[] = [];
  if (existsSync(evidenceDir)) {
    const files = readdirSync(evidenceDir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      try {
        const item = JSON.parse(readFileSync(join(evidenceDir, f), "utf-8")) as Record<
          string,
          unknown
        >;
        if (taskFilter && item.task_id !== taskFilter) continue;
        if (gateFilter && item.gate_id !== gateFilter) continue;
        if (actorFilter && item.actor !== actorFilter) continue;
        evidenceList.push(item);
      } catch {}
    }
  }

  const markdown = formatEvidenceListBrief({ evidence: evidenceList, count: evidenceList.length });
  return {
    markdown,
    run_root: run,
    evidence: evidenceList,
    count: evidenceList.length,
  };
}
