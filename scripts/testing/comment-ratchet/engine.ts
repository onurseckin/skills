import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { DEFAULT_COMMENT_BASELINE, loadCommentBaseline } from "./baseline.ts";
import { compareCommentBaseline } from "./compare.ts";
import type {
  CommentAuditSnapshot,
  CommentBaselineEntry,
  CommentRatchetOptions,
  CommentRatchetReport,
  FileCommentMetrics,
} from "./contracts.ts";
import { scanFileComments } from "./scanner.ts";

const EXCLUDED_DIRS: ReadonlySet<string> = new Set<string>([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".capsules",
  "coverage",
  "scratch",
]);

function discoverTsFiles(dir: string, root: string, list: string[] = []): readonly string[] {
  if (!existsSync(dir)) return list;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith(".")) {
      continue;
    }
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      discoverTsFiles(fullPath, root, list);
    } else if (
      entry.name.endsWith(".ts") ||
      entry.name.endsWith(".tsx") ||
      entry.name.endsWith(".mts") ||
      entry.name.endsWith(".cts")
    ) {
      list.push(relative(root, fullPath));
    }
  }
  return list;
}

export async function runCommentAudit(
  options: CommentRatchetOptions,
): Promise<CommentAuditSnapshot> {
  if (options.audit !== undefined) {
    return options.audit();
  }

  let filesToScan: readonly string[];
  if (options.targetFiles !== undefined) {
    filesToScan = options.targetFiles;
  } else if (options.fileListLoader !== undefined) {
    filesToScan = await options.fileListLoader();
  } else {
    filesToScan = [...discoverTsFiles(options.repoRoot, options.repoRoot, [])].sort();
  }

  const fileMetrics: FileCommentMetrics[] = [];
  let totalCommentLines = 0;
  let totalComments = 0;

  for (const relPath of filesToScan) {
    const fullPath = join(options.repoRoot, relPath);
    let content: string;
    try {
      if (options.fileLoader !== undefined) {
        content = await options.fileLoader(relPath);
      } else {
        content = await readFile(fullPath, "utf-8");
      }
    } catch {
      continue;
    }

    const metrics = scanFileComments(relPath, content);
    fileMetrics.push(metrics);
    totalCommentLines += metrics.commentLines;
    totalComments += metrics.totalComments;
  }

  return {
    scannedFiles: fileMetrics.length,
    totalCommentLines,
    totalComments,
    files: fileMetrics,
  };
}

export function carryOverReasons(
  current: readonly CommentBaselineEntry[],
  baselineEntries: readonly CommentBaselineEntry[],
): readonly CommentBaselineEntry[] {
  const byFile = new Map<string, CommentBaselineEntry>();
  for (const entry of baselineEntries) {
    byFile.set(entry.file, entry);
  }
  return current.map((entry) => {
    const existing = byFile.get(entry.file);
    if (existing?.reason !== undefined) {
      return { ...entry, reason: existing.reason };
    }
    return entry;
  });
}

export async function checkCommentRatchet(
  options: CommentRatchetOptions,
): Promise<CommentRatchetReport> {
  const snapshot = await runCommentAudit(options);
  const baselinePath =
    options.baselinePath !== undefined ? options.baselinePath : DEFAULT_COMMENT_BASELINE;

  const currentRaw: CommentBaselineEntry[] = snapshot.files
    .filter((f) => f.commentLines > 0)
    .map((f) => ({
      file: f.file,
      count: f.commentLines,
      totalComments: f.totalComments,
    }));

  if (options.mode === "strict") {
    let resolvedCurrent: readonly CommentBaselineEntry[] = currentRaw;
    try {
      const baseline = await loadCommentBaseline(
        options.repoRoot,
        baselinePath,
        options.fileLoader,
      );
      resolvedCurrent = carryOverReasons(currentRaw, baseline.entries);
    } catch {}

    return {
      mode: options.mode,
      scannedFiles: snapshot.scannedFiles,
      totalCommentLines: snapshot.totalCommentLines,
      totalComments: snapshot.totalComments,
      current: resolvedCurrent,
      baselineDelta: {
        added: [],
        worsened: [],
        improved: [],
        unchanged: [],
        resolved: [],
      },
      passed: snapshot.totalCommentLines === 0,
    };
  }

  const baseline = await loadCommentBaseline(options.repoRoot, baselinePath, options.fileLoader);
  const currentWithReasons = carryOverReasons(currentRaw, baseline.entries);
  const comparison = compareCommentBaseline(baseline, currentWithReasons);

  const passed = options.mode === "check" ? true : comparison.passed;

  return {
    mode: options.mode,
    scannedFiles: snapshot.scannedFiles,
    totalCommentLines: snapshot.totalCommentLines,
    totalComments: snapshot.totalComments,
    current: currentWithReasons,
    baselineDelta: comparison.baselineDelta,
    passed,
  };
}
