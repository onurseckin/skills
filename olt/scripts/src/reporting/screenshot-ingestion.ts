import { readFileSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { linkBlobIntoView, putBlobFile } from "../engine/store/index.ts";
import { refreshIndex } from "../engine/store/index.ts";
import { readCaptures, recordCaptures, type CaptureRecord } from "../engine/store/index.ts";
import {
  discoverScreenshotCandidates,
  extractImagesFromText,
  extractVisualReportsFromText,
  findVisualReportCandidates,
} from "./screenshot-scanner.ts";
import { normalizeVisualReport } from "./visual-report.ts";
import type {
  ScreenshotIngestOptions,
  ScreenshotRecord,
  VisualMetricsReport,
  VisualReportIngestOptions,
} from "./screenshot-types.ts";

const SCREENSHOT_VIEW_DIRECTORY = "evidence/screenshots";
const VISUAL_REPORT_VIEW_NAME = "visual-report.json";

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/gu, "_");
}

function mtimeIso(path: string): string | undefined {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return undefined;
  }
}

function writtenDuringRun(path: string, startedAt: string | null | undefined): boolean {
  if (startedAt === undefined || startedAt === null || startedAt.length === 0) return false;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return true;
  try {
    return statSync(path).mtimeMs >= start;
  } catch {
    return false;
  }
}

function attributable(
  path: string,
  named: ReadonlySet<string>,
  cited: ReadonlySet<string>,
  startedAt: string | null | undefined,
): boolean {
  return named.has(path) || cited.has(path) || writtenDuringRun(path, startedAt);
}

function viewName(original: string, sha256: string, takenNames: ReadonlySet<string>): string {
  const base = sanitizeFilename(basename(original));
  if (!takenNames.has(base)) return base;
  const extension = extname(base);
  const stem = extension.length > 0 ? base.slice(0, -extension.length) : base;
  return `${stem}-${sha256.slice(0, 8)}${extension}`;
}

function ownership(options: {
  commandId?: string | undefined;
  taskId?: string | undefined;
  actor?: string | undefined;
}): Pick<CaptureRecord, "command_id" | "task_id" | "actor"> {
  return {
    ...(options.commandId ? { command_id: options.commandId } : {}),
    ...(options.taskId ? { task_id: options.taskId } : {}),
    ...(options.actor ? { actor: options.actor } : {}),
  };
}

export function ingestScreenshots(options: ScreenshotIngestOptions): ScreenshotRecord[] {
  const { runRoot, searchDirs = [], stdout, stderr, explicitPaths, startedAt } = options;

  let candidatePaths: string[] = [];
  try {
    candidatePaths = discoverScreenshotCandidates(searchDirs, stdout, stderr, explicitPaths);
  } catch {
    return [];
  }
  if (candidatePaths.length === 0) return [];

  const named = new Set((explicitPaths ?? []).map((path) => resolve(path)));
  const baseDir = searchDirs[0];
  const cited = new Set(
    [
      ...extractImagesFromText(stdout ?? "", baseDir),
      ...extractImagesFromText(stderr ?? "", baseDir),
    ].map((path) => resolve(path)),
  );
  const existing = readCaptures(runRoot);
  const knownContent = new Set(
    existing.filter((record) => record.kind === "screenshot").map((record) => record.sha256),
  );
  const takenNames = new Set(existing.map((record) => record.name));

  const ingested: ScreenshotRecord[] = [];
  for (const originalPath of candidatePaths) {
    const owned = attributable(originalPath, named, cited, startedAt);
    let blob;
    try {
      blob = putBlobFile(runRoot, originalPath);
    } catch {
      continue;
    }
    if (knownContent.has(blob.sha256)) continue;
    knownContent.add(blob.sha256);
    const name = viewName(originalPath, blob.sha256, takenNames);
    takenNames.add(name);
    let link;
    try {
      link = linkBlobIntoView(runRoot, blob, SCREENSHOT_VIEW_DIRECTORY, name);
    } catch {
      continue;
    }
    const capturedAt = mtimeIso(originalPath);
    ingested.push({
      kind: "screenshot",
      name: link.name,
      sha256: link.sha256,
      bytes: link.bytes,
      blob_path: link.path,
      path: link.view_path,
      storage: link.storage,
      original_path: originalPath,
      ...(owned ? ownership(options) : {}),
      ...(capturedAt === undefined ? {} : { timestamp: capturedAt }),
    });
  }

  if (recordCaptures(runRoot, ingested)) {
    try {
      refreshIndex(runRoot);
    } catch {}
  }
  return ingested;
}

export function ingestVisualReport(options: VisualReportIngestOptions): VisualMetricsReport | null {
  const { runRoot, searchDirs = [], stdout, stderr, explicitPaths, startedAt } = options;

  let candidatePaths: string[] = [];
  try {
    candidatePaths = findVisualReportCandidates(searchDirs, stdout, stderr, explicitPaths);
  } catch {
    return null;
  }
  if (candidatePaths.length === 0) return null;

  const named = new Set((explicitPaths ?? []).map((path) => resolve(path)));
  const baseDir = searchDirs[0];
  const cited = new Set(
    [
      ...extractVisualReportsFromText(stdout ?? "", baseDir),
      ...extractVisualReportsFromText(stderr ?? "", baseDir),
    ].map((path) => resolve(path)),
  );
  const takenNames = new Set(readCaptures(runRoot).map((record) => record.name));
  for (const candidatePath of candidatePaths) {
    const owned = attributable(candidatePath, named, cited, startedAt);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(candidatePath, "utf-8"));
    } catch {
      continue;
    }
    const report = normalizeVisualReport(parsed, mtimeIso(candidatePath));
    if (report === null) continue;
    try {
      const blob = putBlobFile(runRoot, candidatePath);
      const link = linkBlobIntoView(
        runRoot,
        blob,
        "evidence",
        viewName(VISUAL_REPORT_VIEW_NAME, blob.sha256, takenNames),
      );
      const recorded = recordCaptures(runRoot, [
        {
          kind: "visual_report",
          name: link.name,
          sha256: link.sha256,
          bytes: link.bytes,
          blob_path: link.path,
          path: link.view_path,
          storage: link.storage,
          original_path: candidatePath,
          ...(owned ? ownership(options) : {}),
          ...(report.timestamp === undefined ? {} : { timestamp: report.timestamp }),
        },
      ]);
      if (recorded) refreshIndex(runRoot);
    } catch {
      return report;
    }
    return report;
  }

  return null;
}
