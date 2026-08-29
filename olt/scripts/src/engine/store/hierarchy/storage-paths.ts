import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import { findRepoRoot } from "../../../core/shared/paths.ts";
import { RUN_ID_PATTERN } from "../layout/constants.ts";
import { normalizeRunId } from "../capsule/run-id.ts";

export interface StoragePaths {
  readonly repoRoot: string;
  readonly oltDir: string;
  readonly capsulesDir: string;
  readonly globalBacklogPath: string;
  readonly globalDefectsPath: string;
  readonly globalPolicyPath: string;
  readonly globalTelemetryPath: string;
  readonly globalMailboxesDir: string;
  readonly scratchDir: string;
}

export interface CapsulePaths {
  readonly runRoot: string;
  readonly manifestPath: string;
  readonly eventsPath: string;
  readonly statePath: string;
  readonly sparseIndexPath: string;
  readonly snapshotsDir: string;
  readonly blobsDir: string;
  readonly tracePath: string;
}

/**
 * Resolves sovereign repository-level storage paths under `.olt/`.
 */
export function resolveStoragePaths(repoRoot?: string): StoragePaths {
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  const oltDir = join(root, ".olt");
  return {
    repoRoot: root,
    oltDir,
    capsulesDir: join(oltDir, "capsules"),
    globalBacklogPath: join(oltDir, "backlog.jsonl"),
    globalDefectsPath: join(oltDir, "defects.jsonl"),
    globalPolicyPath: join(oltDir, "policy.json"),
    globalTelemetryPath: join(oltDir, "telemetry.jsonl"),
    globalMailboxesDir: join(oltDir, "mailboxes"),
    scratchDir: join(oltDir, "scratch"),
  };
}

/**
 * Asserts that a storage path candidate is safe and strictly adheres to `.olt/` isolation.
 *
 * Rejection criteria:
 * - Reject any candidatePath resolving runtime ledgers into `olt/` instead of `.olt/` (throws HarnessError with code PATH_SAFETY).
 * - Reject directory traversal `..` escaping repo root.
 * - Reject invalid runId structures (empty, slashes, invalid path segments).
 */
export function assertSafeStoragePath(candidatePath: string, repoRoot?: string): void {
  if (typeof candidatePath !== "string" || !candidatePath.trim()) {
    throw new HarnessError("PATH_SAFETY", "Storage path candidate must not be empty or blank");
  }

  if (candidatePath.includes("\0")) {
    throw new HarnessError("PATH_SAFETY", "Storage path candidate must not contain null bytes");
  }

  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  const resolved = isAbsolute(candidatePath)
    ? resolve(candidatePath)
    : resolve(root, candidatePath);
  const relFromRoot = relative(root, resolved);

  // Escaping root via traversal:
  if (
    relFromRoot === ".." ||
    relFromRoot.startsWith(`..${sep}`) ||
    relFromRoot.startsWith("../") ||
    isAbsolute(relFromRoot)
  ) {
    throw new HarnessError(
      "PATH_SAFETY",
      `Storage path escapes repository root: "${candidatePath}"`,
    );
  }

  // Reject candidate paths inside static package root "olt/" instead of sovereign ".olt/":
  const normalizedRel = relFromRoot.split(sep).join("/");
  if (normalizedRel === "olt" || normalizedRel.startsWith("olt/")) {
    throw new HarnessError(
      "PATH_SAFETY",
      `Storage path resolves into static package root "olt/" instead of sovereign ".olt/": "${candidatePath}"`,
    );
  }

  // Validate runId structure if candidate references capsules:
  if (normalizedRel.includes("capsules/")) {
    const parts = normalizedRel.split("/");
    const capIdx = parts.indexOf("capsules");
    if (capIdx !== -1 && capIdx + 1 < parts.length) {
      const runSegment = parts[capIdx + 1];
      if (runSegment && runSegment !== "" && !RUN_ID_PATTERN.test(runSegment)) {
        throw new HarnessError(
          "PATH_SAFETY",
          `Storage path contains invalid capsule run_id segment: "${runSegment}"`,
        );
      }
    }
  }
}

/**
 * Resolves all paths for a run capsule inside `<repoRoot>/.olt/capsules/<run_id>/`.
 */
export function resolveCapsulePaths(runId: string, repoRoot?: string): CapsulePaths {
  if (typeof runId !== "string" || !runId.trim()) {
    throw new HarnessError("PATH_SAFETY", "run_id must not be empty or blank");
  }

  const normalized = normalizeRunId(runId);
  if (!RUN_ID_PATTERN.test(normalized)) {
    throw new HarnessError("PATH_SAFETY", `Invalid run_id structure: "${runId}"`);
  }

  const storage = resolveStoragePaths(repoRoot);
  const runRoot = join(storage.capsulesDir, normalized);
  assertSafeStoragePath(runRoot, storage.repoRoot);

  return {
    runRoot,
    manifestPath: join(runRoot, "manifest.json"),
    eventsPath: join(runRoot, "events.jsonl"),
    statePath: join(runRoot, "state.json"),
    sparseIndexPath: join(runRoot, "sparse-index.json"),
    snapshotsDir: join(runRoot, "snapshots"),
    blobsDir: join(runRoot, "blobs"),
    tracePath: join(runRoot, "trace.md"),
  };
}
