import { readFileSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { linkBlobIntoView, putBlobFile } from "../store/blobs.ts";
import { refreshIndex } from "../store/capsule-index.ts";
import { readCaptures, recordCaptures, type CaptureRecord } from "../store/captures.ts";
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

/**
 * A file the command did not write while it was running is not that command's output. No upper
 * bound: a process may flush its last file after it exits, and dropping those would lose real
 * evidence to guard against a defect the lower bound already closes.
 *
 * A caller that names no window is claiming no execution at all — a task-level scan of the
 * repository, not a command that ran. It has nothing to have produced the file with, so the scan
 * is not evidence of authorship. That is different from a window the harness recorded but cannot
 * parse, where a command demonstrably ran and only the clock reading is lost.
 */
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

/**
 * Whether this capture may be recorded as the caller's work.
 *
 * Three things are evidence of that, and nothing else is: the caller named the path, the command
 * printed the path itself, or the file was written while the command was running. A stale image
 * sitting at the repository root satisfies none of them, so it is still stored — the bytes are real
 * — but it is recorded unattributed rather than credited to whichever command scanned it first.
 * Crediting it is what put one image on every command in a run.
 *
 * A scan that ran no command satisfies none of them either, so a task-level sweep of the repository
 * records what it finds without claiming it.
 */
function attributable(
  path: string,
  named: ReadonlySet<string>,
  cited: ReadonlySet<string>,
  startedAt: string | null | undefined,
): boolean {
  return named.has(path) || cited.has(path) || writtenDuringRun(path, startedAt);
}

/**
 * A readable name for the blob. Content that already has a name keeps it; a different image landing
 * on a taken name is disambiguated by its own digest rather than by the id of whatever command
 * happened to ingest it — that prefixing is what defeated the old dedupe guard.
 */
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

/**
 * Stores every newly captured image once and gives it a readable name.
 *
 * The dedupe guard is content: bytes already in the ledger are the same capture, so a later sighting
 * of an unchanged file adds no record and no bytes. The returned records are the ones this call
 * newly recorded, which is why a repeated scan returns nothing rather than a second copy.
 */
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

  // The catalogue counts captures but is not chain-bound, so nothing else brings it back into
  // agreement with a ledger that just grew.
  if (recordCaptures(runRoot, ingested)) refreshIndex(runRoot);
  return ingested;
}

/**
 * Stores the visual report exactly as it was written and returns what it says. The bytes on disk are
 * the capture; the parsed shape is a reading of it, and is not written back as a second copy.
 */
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
