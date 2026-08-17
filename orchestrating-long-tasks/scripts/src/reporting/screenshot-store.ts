import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  ClippingViolation,
  EvidenceManifestData,
  OverflowViolation,
  ScreenshotQueryOptions,
  ScreenshotRecord,
  StackingViolation,
  ViewportMetrics,
  VisualMetricsReport,
} from "./screenshot-types.ts";

export function getVisualReport(runRoot: string): VisualMetricsReport | null {
  const reportPath = join(runRoot, "reports", "visual-report.json");
  const evidencePath = join(runRoot, "evidence", "visual-report.json");

  const targetPath = existsSync(reportPath)
    ? reportPath
    : existsSync(evidencePath)
      ? evidencePath
      : undefined;
  if (!targetPath) return null;

  try {
    const content = readFileSync(targetPath, "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    return {
      timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString(),
      viewports:
        parsed.viewports && typeof parsed.viewports === "object" && !Array.isArray(parsed.viewports)
          ? (parsed.viewports as Record<string, ViewportMetrics>)
          : {},
      layoutOverflows: Array.isArray(parsed.layoutOverflows)
        ? (parsed.layoutOverflows as OverflowViolation[])
        : [],
      textClippings: Array.isArray(parsed.textClippings)
        ? (parsed.textClippings as ClippingViolation[])
        : [],
      collisions: Array.isArray(parsed.collisions)
        ? (parsed.collisions as StackingViolation[])
        : [],
      ...(parsed.metadata && typeof parsed.metadata === "object" && !Array.isArray(parsed.metadata)
        ? { metadata: parsed.metadata as Record<string, unknown> }
        : {}),
    };
  } catch {
    return null;
  }
}

export function queryScreenshots(
  runRoot: string,
  options: ScreenshotQueryOptions = {},
): ScreenshotRecord[] {
  const recordsMap = new Map<string, ScreenshotRecord>();

  const evidenceDir = join(runRoot, "evidence");
  const manifestPath = join(evidenceDir, "manifest.json");

  // 1. Read from evidence/manifest.json if available
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(
        readFileSync(manifestPath, "utf-8"),
      ) as Partial<EvidenceManifestData>;
      if (Array.isArray(manifest.screenshots)) {
        for (const s of manifest.screenshots) {
          recordsMap.set(s.name, s);
        }
      }
    } catch {}
  }

  // 2. Read from evidence/*.json files for any screenshot references & metadata
  if (existsSync(evidenceDir)) {
    try {
      const files = readdirSync(evidenceDir).filter(
        (f) => f.endsWith(".json") && f !== "manifest.json",
      );
      for (const f of files) {
        try {
          const evidenceJson = JSON.parse(readFileSync(join(evidenceDir, f), "utf-8")) as Record<
            string,
            unknown
          >;
          const cmdId =
            typeof evidenceJson.command_id === "string"
              ? evidenceJson.command_id
              : typeof evidenceJson.id === "string"
                ? evidenceJson.id
                : undefined;
          const taskId =
            typeof evidenceJson.task_id === "string" ? evidenceJson.task_id : undefined;
          const actor = typeof evidenceJson.actor === "string" ? evidenceJson.actor : undefined;

          if (Array.isArray(evidenceJson.screenshot_records)) {
            for (const r of evidenceJson.screenshot_records as ScreenshotRecord[]) {
              if (r && typeof r === "object" && r.name) {
                const existing = recordsMap.get(r.name);
                recordsMap.set(r.name, {
                  ...existing,
                  ...r,
                  ...(taskId ? { task_id: taskId } : {}),
                  ...(cmdId ? { command_id: cmdId } : {}),
                  ...(actor ? { actor } : {}),
                });
              }
            }
          } else if (Array.isArray(evidenceJson.screenshots)) {
            for (const sPath of evidenceJson.screenshots) {
              if (typeof sPath === "string") {
                const name = basename(sPath);
                const existing = recordsMap.get(name);
                if (existing) {
                  if (taskId && !existing.task_id) existing.task_id = taskId;
                  if (cmdId && !existing.command_id) existing.command_id = cmdId;
                  if (actor && !existing.actor) existing.actor = actor;
                } else {
                  recordsMap.set(name, {
                    name,
                    original_path: sPath,
                    evidence_path: sPath,
                    report_path: join(runRoot, "reports", "screenshots", name),
                    timestamp: new Date().toISOString(),
                    ...(taskId ? { task_id: taskId } : {}),
                    ...(cmdId ? { command_id: cmdId } : {}),
                    ...(actor ? { actor } : {}),
                  });
                }
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  // 3. Scan evidence/screenshots directory directly for any unrecorded files
  const evidenceScreenshotsDir = join(evidenceDir, "screenshots");
  if (existsSync(evidenceScreenshotsDir)) {
    try {
      const files = readdirSync(evidenceScreenshotsDir);
      for (const file of files) {
        if (file.startsWith(".")) continue;
        const filePath = join(evidenceScreenshotsDir, file);
        if (!statSync(filePath).isFile()) continue;

        if (!recordsMap.has(file)) {
          let sizeBytes: number | undefined;
          try {
            sizeBytes = statSync(filePath).size;
          } catch {}

          recordsMap.set(file, {
            name: file,
            original_path: filePath,
            evidence_path: filePath,
            report_path: join(runRoot, "reports", "screenshots", file),
            timestamp: new Date().toISOString(),
            ...(sizeBytes !== undefined ? { size_bytes: sizeBytes } : {}),
          });
        }
      }
    } catch {}
  }

  const allRecords = Array.from(recordsMap.values());

  // Apply filters
  return allRecords.filter((record) => {
    if (options.taskId) {
      const matchesTask =
        record.task_id === options.taskId ||
        record.name.includes(options.taskId) ||
        (record.command_id !== undefined && record.command_id.includes(options.taskId));
      if (!matchesTask) return false;
    }
    if (options.commandId) {
      const matchesCmd =
        record.command_id === options.commandId ||
        record.name.startsWith(`${options.commandId}-`) ||
        record.name.includes(options.commandId);
      if (!matchesCmd) return false;
    }
    if (options.actor) {
      if (record.actor !== options.actor) return false;
    }
    return true;
  });
}
