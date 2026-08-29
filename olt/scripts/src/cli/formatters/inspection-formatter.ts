import type { ScreenshotRecord } from "../../reporting/index.ts";
import { enforceLineLimit } from "./line-limiter.ts";
import {
  evidenceGetNextActions,
  findingGetNextActions,
  nextActionsBlock,
  reportGetNextActions,
} from "./next-actions/index.ts";

function screenshotRecordPath(record: unknown): string {
  if (typeof record === "object" && record !== null && "path" in record) {
    const path = (record as { path: unknown }).path;
    if (typeof path === "string") return path;
  }
  return String(record);
}

export interface FindingBriefParams {
  finding: Record<string, unknown>;
  path: string;
}

export function formatFindingBrief(params: FindingBriefParams): string {
  const f = params.finding;
  const id = String(f.id ?? "unknown");
  const req = String(f.requirement_id ?? "none");
  const sev = String(f.severity ?? "unknown");
  const obs = String(f.observation ?? f.message ?? "No observation");
  const rem = String(f.remediation ?? "None");
  const lines = [
    `### Finding Detail: \`${id}\``,
    `- **Severity**: \`${sev}\``,
    `- **Requirement ID**: \`${req}\``,
    `- **Observation**: ${obs}`,
    `- **Remediation**: ${rem}`,
    `- **File Path**: \`${params.path}\``,
    ...nextActionsBlock(findingGetNextActions(undefined, id)),
  ];
  return enforceLineLimit(lines.join("\n"), 30);
}

export interface FindingsListParams {
  findings: Record<string, unknown>[];
  count: number;
}

export function formatFindingsListBrief(params: FindingsListParams): string {
  const lines = [`### Run Findings: ${params.count} total`];
  if (params.findings.length === 0) {
    lines.push("- No findings recorded for this run.");
  } else {
    for (const f of params.findings.slice(0, 10)) {
      const id = String(f.id ?? "unknown");
      const sev = String(f.severity ?? "unknown");
      const obs = String(f.observation ?? f.message ?? "").slice(0, 60);
      lines.push(`- **\`${id}\`** [\`${sev}\`]: ${obs}`);
    }
    if (params.findings.length > 10) {
      lines.push(`- ... and ${params.findings.length - 10} more findings.`);
    }
  }
  lines.push(...nextActionsBlock(findingGetNextActions(undefined)));
  return enforceLineLimit(lines.join("\n"), 30);
}

export interface ReportBriefParams {
  report: Record<string, unknown>;
  path: string;
  name?: string;
  showScreenshots?: boolean;
}

export function formatReportBrief(params: ReportBriefParams): string {
  const r = params.report;
  const name = params.name ?? "unknown";
  const rawStatus = r.status ?? r.verdict ?? r.decision;
  const statusLine =
    rawStatus === undefined
      ? "- **Status / Verdict**: not recorded"
      : `- **Status / Verdict**: \`${String(rawStatus)}\``;
  const summary = String(r.summary ?? "No summary provided");
  const screenshots = Array.isArray(r.screenshots) ? r.screenshots : [];
  const lines = [
    `### Report: \`${name}\``,
    statusLine,
    `- **Summary**: ${summary}`,
    `- **Path**: \`${params.path}\``,
  ];
  if (screenshots.length > 0 || params.showScreenshots) {
    lines.push(`- **Screenshots**: ${screenshots.length} captured`);
    for (const s of screenshots.slice(0, 5)) {
      lines.push(`  - \`${String(s)}\``);
    }
  }
  lines.push(...nextActionsBlock(reportGetNextActions()));
  return enforceLineLimit(lines.join("\n"), 30);
}

export interface ReportsListParams {
  reports: { name: string; path: string; data?: Record<string, unknown> }[];
  count: number;
  showScreenshots?: boolean;
}

export function formatReportsListBrief(params: ReportsListParams): string {
  const lines = [`### Run Reports: ${params.count} total`];
  if (params.reports.length === 0) {
    lines.push("- No reports recorded for this run.");
  } else {
    for (const r of params.reports.slice(0, 10)) {
      const screenshots = r.data?.screenshots;
      const sCount = Array.isArray(screenshots) ? screenshots.length : 0;
      const sSuffix = params.showScreenshots || sCount > 0 ? ` (${sCount} screenshots)` : "";
      lines.push(`- **\`${r.name}\`**${sSuffix}: \`${r.path}\``);
    }
    if (params.reports.length > 10) {
      lines.push(`- ... and ${params.reports.length - 10} more reports.`);
    }
  }
  lines.push(...nextActionsBlock(reportGetNextActions()));
  return enforceLineLimit(lines.join("\n"), 30);
}

export interface EvidenceBriefParams {
  evidence: Record<string, unknown>;
  path: string;
  showScreenshots?: boolean;
}

export function formatEvidenceBrief(params: EvidenceBriefParams): string {
  const e = params.evidence;
  const cmdId = String(e.command_id ?? e.id ?? "unknown");
  const code = String(e.exit_code ?? "unknown");
  const dur = typeof e.duration_ms === "number" ? `${e.duration_ms}ms` : "N/A";
  const actor = String(e.actor ?? "unknown");
  const argv = Array.isArray(e.argv) ? e.argv.map(String).join(" ") : "";
  const screenshots = Array.isArray(e.screenshot_records) ? e.screenshot_records : [];
  const lines = [
    `### Evidence: \`${cmdId}\``,
    `- **Command**: \`${argv}\``,
    `- **Actor**: \`${actor}\` | **Exit Code**: \`${code}\` | **Duration**: \`${dur}\``,
    `- **Path**: \`${params.path}\``,
  ];
  if (screenshots.length > 0 || params.showScreenshots) {
    lines.push(`- **Screenshots**: ${screenshots.length} captured`);
    for (const s of screenshots.slice(0, 5)) {
      lines.push(`  - \`${screenshotRecordPath(s)}\``);
    }
  }
  lines.push(...nextActionsBlock(evidenceGetNextActions()));
  return enforceLineLimit(lines.join("\n"), 30);
}

export interface EvidenceListParams {
  evidence: Record<string, unknown>[];
  count: number;
  showScreenshots?: boolean;
}

export function formatEvidenceListBrief(params: EvidenceListParams): string {
  const lines = [`### Run Evidence: ${params.count} commands recorded`];
  if (params.evidence.length === 0) {
    lines.push("- No evidence recorded for this run.");
  } else {
    for (const e of params.evidence.slice(0, 10)) {
      const id = String(e.command_id ?? e.id ?? "unknown");
      const code = String(e.exit_code ?? "unknown");
      const argv = Array.isArray(e.argv) ? e.argv.map(String).join(" ").slice(0, 50) : "";
      const sCount = Array.isArray(e.screenshot_records) ? e.screenshot_records.length : 0;
      const sSuffix = params.showScreenshots || sCount > 0 ? ` (${sCount} screenshots)` : "";
      lines.push(`- **\`${id}\`** (exit: \`${code}\`${sSuffix}): \`${argv}\``);
    }
    if (params.evidence.length > 10) {
      lines.push(`- ... and ${params.evidence.length - 10} more evidence records.`);
    }
  }
  lines.push(...nextActionsBlock(evidenceGetNextActions()));
  return enforceLineLimit(lines.join("\n"), 30);
}

export interface ScreenshotsListParams {
  screenshots: ScreenshotRecord[];
  count: number;
  taskId?: string | undefined;
  commandId?: string | undefined;
}

export function formatScreenshotsListBrief(params: ScreenshotsListParams): string {
  const scopeSuffix = params.taskId
    ? ` (Task: \`${params.taskId}\`)`
    : params.commandId
      ? ` (Command: \`${params.commandId}\`)`
      : "";

  const lines = [`### Run Screenshots: ${params.count} total${scopeSuffix}`];

  if (params.screenshots.length === 0) {
    lines.push("- No screenshots recorded for this run.");
  } else {
    for (const s of params.screenshots.slice(0, 15)) {
      const details: string[] = [];
      if (s.command_id) details.push(`Command: \`${s.command_id}\``);
      if (s.task_id) details.push(`Task: \`${s.task_id}\``);
      if (s.actor) details.push(`Actor: \`${s.actor}\``);
      const detailStr = details.length > 0 ? ` (${details.join(" | ")})` : "";
      lines.push(`- **\`${s.name}\`**${detailStr}: \`${s.path}\``);
    }
    if (params.screenshots.length > 15) {
      lines.push(`- ... and ${params.screenshots.length - 15} more screenshots.`);
    }
  }

  lines.push(
    ...nextActionsBlock([
      {
        command: `bun harness.ts evidence:screenshots`,
        role: "Validator",
        description: "List all visual screenshot evidence",
      },
    ]),
  );

  return enforceLineLimit(lines.join("\n"), 30);
}
