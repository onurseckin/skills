import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  discoverScreenshotCandidates,
  findVisualReportCandidates,
} from "./screenshot-scanner.ts";
import type {
  ClippingViolation,
  EvidenceManifestData,
  OverflowViolation,
  ScreenshotIngestOptions,
  ScreenshotRecord,
  StackingViolation,
  ViewportMetrics,
  VisualMetricsReport,
  VisualReportIngestOptions,
} from "./screenshot-types.ts";

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function updateEvidenceManifest(runRoot: string, newRecords: ScreenshotRecord[]): void {
  try {
    const evidenceDir = join(runRoot, "evidence");
    mkdirSync(evidenceDir, { recursive: true });
    const manifestPath = join(evidenceDir, "manifest.json");

    let existing: EvidenceManifestData = { screenshots: [], updated_at: new Date().toISOString() };
    if (existsSync(manifestPath)) {
      try {
        const parsed = JSON.parse(
          readFileSync(manifestPath, "utf-8"),
        ) as Partial<EvidenceManifestData>;
        if (Array.isArray(parsed.screenshots)) {
          existing.screenshots = parsed.screenshots;
        }
      } catch {}
    }

    const existingMap = new Map<string, ScreenshotRecord>();
    for (const s of existing.screenshots) {
      existingMap.set(s.name, s);
    }
    for (const record of newRecords) {
      existingMap.set(record.name, record);
    }

    const updated: EvidenceManifestData = {
      screenshots: Array.from(existingMap.values()),
      updated_at: new Date().toISOString(),
    };

    writeFileSync(manifestPath, JSON.stringify(updated, null, 2), "utf-8");
  } catch {}
}

export function ingestScreenshots(options: ScreenshotIngestOptions): ScreenshotRecord[] {
  const {
    runRoot,
    commandId,
    taskId,
    actor,
    searchDirs = [],
    stdout,
    stderr,
    explicitPaths,
    overwrite = true,
  } = options;

  let candidatePaths: string[] = [];
  try {
    candidatePaths = discoverScreenshotCandidates(searchDirs, stdout, stderr, explicitPaths);
  } catch {
    return [];
  }
  if (candidatePaths.length === 0) return [];

  const evidenceScreenshotsDir = join(runRoot, "evidence", "screenshots");
  const reportScreenshotsDir = join(runRoot, "reports", "screenshots");

  try {
    mkdirSync(evidenceScreenshotsDir, { recursive: true });
    mkdirSync(reportScreenshotsDir, { recursive: true });
  } catch {}

  const ingested: ScreenshotRecord[] = [];
  const processedDestNames = new Set<string>();
  const now = new Date().toISOString();

  for (const originalPath of candidatePaths) {
    const rawBase = basename(originalPath);
    const sanitizedBase = sanitizeFilename(rawBase);

    let destName = sanitizedBase;
    if (commandId && !sanitizedBase.startsWith(`${commandId}-`)) {
      destName = `${commandId}-${sanitizedBase}`;
    } else if (!commandId && taskId && !sanitizedBase.startsWith(`${taskId}-`)) {
      destName = `${taskId}-${sanitizedBase}`;
    }

    if (processedDestNames.has(destName)) {
      continue;
    }
    processedDestNames.add(destName);

    const evidenceDestPath = join(evidenceScreenshotsDir, destName);
    const reportDestPath = join(reportScreenshotsDir, destName);

    // Skip if original path is already the destination file
    if (
      resolve(originalPath) === resolve(evidenceDestPath) ||
      resolve(originalPath) === resolve(reportDestPath)
    ) {
      continue;
    }

    // Skip if file already exists and overwrite is explicitly false
    if (!overwrite && existsSync(evidenceDestPath)) {
      continue;
    }

    try {
      copyFileSync(originalPath, evidenceDestPath);
      copyFileSync(originalPath, reportDestPath);

      let sizeBytes: number | undefined;
      try {
        sizeBytes = statSync(originalPath).size;
      } catch {}

      const record: ScreenshotRecord = {
        name: destName,
        original_path: originalPath,
        evidence_path: evidenceDestPath,
        report_path: reportDestPath,
        ...(commandId ? { command_id: commandId } : {}),
        ...(taskId ? { task_id: taskId } : {}),
        ...(actor ? { actor } : {}),
        ...(sizeBytes !== undefined ? { size_bytes: sizeBytes } : {}),
        timestamp: now,
      };

      ingested.push(record);
    } catch {}
  }

  if (ingested.length > 0) {
    updateEvidenceManifest(runRoot, ingested);
  }

  return ingested;
}

export function ingestVisualReport(options: VisualReportIngestOptions): VisualMetricsReport | null {
  const {
    runRoot,
    searchDirs = [],
    stdout,
    stderr,
    explicitPaths,
  } = options;

  let candidatePaths: string[] = [];
  try {
    candidatePaths = findVisualReportCandidates(searchDirs, stdout, stderr, explicitPaths);
  } catch {
    return null;
  }
  if (candidatePaths.length === 0) return null;

  for (const candidatePath of candidatePaths) {
    try {
      const content = readFileSync(candidatePath, "utf-8");
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;

      const report: VisualMetricsReport = {
        timestamp:
          typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString(),
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

      const evidenceReportsDir = join(runRoot, "reports");
      const evidenceDir = join(runRoot, "evidence");

      try {
        mkdirSync(evidenceReportsDir, { recursive: true });
        mkdirSync(evidenceDir, { recursive: true });

        const formatted = JSON.stringify(report, null, 2);
        writeFileSync(join(evidenceReportsDir, "visual-report.json"), formatted, "utf-8");
        writeFileSync(join(evidenceDir, "visual-report.json"), formatted, "utf-8");
      } catch {}

      return report;
    } catch {}
  }

  return null;
}
