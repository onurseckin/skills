import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readCaptures } from "../store/captures.ts";
import { normalizeVisualReport } from "./visual-report.ts";
import type {
  ScreenshotQueryOptions,
  ScreenshotRecord,
  VisualMetricsReport,
} from "./screenshot-types.ts";

/**
 * The most recently captured visual report, read from its one stored copy.
 *
 * The ledger is the only source consulted. Scanning the capsule for a file that looks like a report
 * would resurrect a copy the run never recorded, and there is no honest owner to attach it to.
 *
 * Naming a task narrows the search to reports the ingestion attributed to that task. Ingestion
 * records `task_id` only on a report a command actually produced, so a caller that must not accept
 * another node's evidence - or a stale file nobody's command wrote - passes the task it is judging.
 */
export function getVisualReport(runRoot: string, taskId?: string): VisualMetricsReport | null {
  const reports = readCaptures(runRoot).filter(
    (record) =>
      record.kind === "visual_report" && (taskId === undefined || record.task_id === taskId),
  );
  const latest = reports.at(-1);
  if (latest === undefined) return null;
  try {
    return normalizeVisualReport(
      JSON.parse(readFileSync(join(runRoot, latest.blob_path), "utf-8")),
      latest.timestamp,
    );
  } catch {
    return null;
  }
}

/**
 * Screenshots matching the recorded ids. Ownership comes from the ids the ingestion recorded: a file
 * whose name happens to contain a task or command id is not evidence that the command scoped to that
 * node produced it, and matching on the name is how one node ends up carrying another's evidence.
 */
export function queryScreenshots(
  runRoot: string,
  options: ScreenshotQueryOptions = {},
): ScreenshotRecord[] {
  return readCaptures(runRoot).filter((record) => {
    if (record.kind !== "screenshot") return false;
    if (options.taskId && record.task_id !== options.taskId) return false;
    if (options.commandId && record.command_id !== options.commandId) return false;
    if (options.actor && record.actor !== options.actor) return false;
    return true;
  });
}
