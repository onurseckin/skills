import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  exportVisualDag,
  type DagExportFormat,
  type DagExportResult,
} from "../../reporting/dag-exporters/index.ts";
import { generateDagJsonReport, type DagJsonReport } from "../../reporting/graph-json.ts";
import { boolFlag, textFlag, type Flags } from "../options.ts";
import { resolveCapsuleRun } from "./dag-view.ts";

export interface GraphExportCommandResult extends Record<string, unknown> {
  readonly runId: string;
  readonly format: DagExportFormat;
  readonly content?: string | undefined;
  readonly report?: DagJsonReport | undefined;
  readonly exported_to?: string | undefined;
}

export function exportGraphJsonCommand(flags: Flags): GraphExportCommandResult {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const runFlag = textFlag(flags, "run", false);
  const runIdFlag = textFlag(flags, "run-id", false);
  const formatFlag = textFlag(flags, "format", false) as DagExportFormat | undefined;
  const out = textFlag(flags, "out", false);
  const pretty = boolFlag(flags, "pretty");

  const run = resolveCapsuleRun(repo, runFlag, runIdFlag);
  const format: DagExportFormat = formatFlag ?? "json";

  if (format === "json") {
    const report = generateDagJsonReport(run);
    const jsonStr = pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report);
    let exportedTo: string | undefined;
    if (out) {
      exportedTo = resolve(process.cwd(), out);
      writeFileSync(exportedTo, jsonStr, "utf8");
    }
    return {
      runId: report.runId,
      format: "json",
      report,
      exported_to: exportedTo,
    };
  }

  const jsonReport = generateDagJsonReport(run);
  const sugiyamaNodes = jsonReport.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    status: n.status,
    dependencies: jsonReport.edges.filter((e) => e.to === n.id).map((e) => e.from),
    effort: n.effort,
  }));
  const sugiyamaEdges = jsonReport.edges.map((e) => ({
    from: e.from,
    to: e.to,
    type: e.type as "dataflow" | "scope_conflict" | "explicit_justification" | undefined,
    reason: e.reason,
  }));

  const exportResult: DagExportResult = exportVisualDag(sugiyamaNodes, sugiyamaEdges, {
    format,
    title: `Run: ${jsonReport.runId}`,
  });

  let exportedTo: string | undefined;
  if (out) {
    exportedTo = resolve(process.cwd(), out);
    writeFileSync(exportedTo, exportResult.content, "utf8");
  }

  return {
    runId: jsonReport.runId,
    format,
    content: exportResult.content,
    exported_to: exportedTo,
  };
}
