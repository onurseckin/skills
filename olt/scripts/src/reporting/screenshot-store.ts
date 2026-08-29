import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readCaptures } from "../engine/store/index.ts";
import { normalizeVisualReport } from "./visual-report.ts";
import type {
  ScreenshotQueryOptions,
  ScreenshotRecord,
  VisualMetricsReport,
} from "./screenshot-types.ts";

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
