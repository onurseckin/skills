import { Buffer } from "node:buffer";
import { resolve } from "node:path";
import { assertZeroDestructiveGit } from "../../../engine/index.ts";
import { runGit, type GitRunner } from "../../../workflow/index.ts";
import {
  computeSha256,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  DEFAULT_MAX_TOTAL_UNTRACKED_BYTES,
  normalizeRepoRoot,
  parseDiffSummary,
  parseGitStashes,
  parseGitStatusOutput,
  parsePorcelainStatusCode,
  isBinaryBuffer,
} from "./inflight-parsers.ts";
import { listSnapshotFiles, loadSnapshotFile, saveSnapshotFile } from "./inflight-storage.ts";
export type {
  DiffSummary,
  FileChangeStatus,
  GitStashEntry,
  InFlightEngineOptions,
  InFlightSnapshot,
  InFlightSnapshotOptions,
  InFlightSnapshotSummary,
  InFlightWorkInspection,
  LoadSnapshotOptions,
  SaveSnapshotOptions,
  UncommittedFileEntry,
} from "./inflight-types.ts";

import type {
  GitStashEntry,
  InFlightEngineOptions,
  InFlightSnapshot,
  InFlightSnapshotOptions,
  InFlightSnapshotSummary,
  InFlightWorkInspection,
  LoadSnapshotOptions,
  SaveSnapshotOptions,
} from "./inflight-types.ts";

export {
  computeSha256,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  DEFAULT_MAX_TOTAL_UNTRACKED_BYTES,
  isBinaryBuffer,
  normalizeRepoRoot,
  parseDiffSummary,
  parseGitStashes,
  parseGitStatusOutput,
  parsePorcelainStatusCode,
} from "./inflight-parsers.ts";

export { listSnapshotFiles, loadSnapshotFile, saveSnapshotFile } from "./inflight-storage.ts";

export class InFlightIngestionEngine {
  private readonly repoRoot: string;
  private readonly snapshotsDir: string;
  private readonly runner: GitRunner;
  private readonly maxFileSizeToCaptureBytes: number;
  private readonly maxTotalUntrackedBytes: number;

  public constructor(repoRoot?: string, options?: InFlightEngineOptions) {
    this.repoRoot = normalizeRepoRoot(repoRoot ?? options?.repoRoot ?? process.cwd());
    this.snapshotsDir =
      options?.snapshotsDir !== undefined
        ? resolve(options.snapshotsDir)
        : resolve(this.repoRoot, ".olt", "snapshots");
    this.runner = options?.runner ?? runGit;
    this.maxFileSizeToCaptureBytes =
      options?.maxFileSizeToCaptureBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
    this.maxTotalUntrackedBytes =
      options?.maxTotalUntrackedBytes ?? DEFAULT_MAX_TOTAL_UNTRACKED_BYTES;
  }

  public getRepoRoot(): string {
    return this.repoRoot;
  }

  public getSnapshotsDir(): string {
    return this.snapshotsDir;
  }

  private runSafeGit(argv: readonly string[]): { status: number; stdout: string; stderr: string } {
    assertZeroDestructiveGit(argv);
    return this.runner(this.repoRoot, argv);
  }

  private getGitOutput(argv: readonly string[]): string {
    const res = this.runSafeGit(argv);
    return res.status === 0 ? res.stdout : "";
  }

  public async inspectInFlightWork(repoRoot?: string): Promise<InFlightWorkInspection> {
    const root = repoRoot !== undefined ? normalizeRepoRoot(repoRoot) : this.repoRoot;
    const inspectedAt = new Date().toISOString();

    let branch = this.getGitOutput(["symbolic-ref", "--short", "-q", "HEAD"]).trim();
    if (!branch) {
      branch = this.getGitOutput(["rev-parse", "--abbrev-ref", "HEAD"]).trim() || "HEAD";
    }

    const headCommit = this.getGitOutput(["rev-parse", "HEAD"]).trim() || "0".repeat(40);
    const statusOutput = this.getGitOutput(["status", "--porcelain=v1", "-uall"]);
    const { files } = parseGitStatusOutput(statusOutput, root, this.maxFileSizeToCaptureBytes);

    const stagedDiff = this.getGitOutput(["diff", "--cached"]);
    const unstagedDiff = this.getGitOutput(["diff"]);
    const combinedDiff = `${stagedDiff}\n${unstagedDiff}`.trim();
    const diffSummary = parseDiffSummary(combinedDiff);

    const stashOutput = this.getGitOutput(["stash", "list", "--format=%gd%x1f%H%x1f%gs%x1f%cI"]);
    const stashes = parseGitStashes(stashOutput);

    const stagedFilesCount = files.filter((f) => f.staged).length;
    const unstagedFilesCount = files.filter((f) => f.unstaged).length;
    const untrackedFilesCount = files.filter((f) => f.status === "untracked").length;
    const hasUncommittedChanges = files.length > 0 || combinedDiff.length > 0;

    return {
      repoRoot: root,
      branch,
      headCommit,
      hasUncommittedChanges,
      uncommittedFilesCount: files.length,
      stagedFilesCount,
      unstagedFilesCount,
      untrackedFilesCount,
      diffSummary,
      stashCount: stashes.length,
      files,
      stashes,
      inspectedAt,
    };
  }

  public async createSnapshot(options?: InFlightSnapshotOptions): Promise<InFlightSnapshot> {
    const createdAt =
      options?.customTimestamp !== undefined ? options.customTimestamp : new Date().toISOString();

    let branch = this.getGitOutput(["symbolic-ref", "--short", "-q", "HEAD"]).trim();
    if (!branch) {
      branch = this.getGitOutput(["rev-parse", "--abbrev-ref", "HEAD"]).trim() || "HEAD";
    }

    const headCommit = this.getGitOutput(["rev-parse", "HEAD"]).trim() || "0".repeat(40);
    const statusOutput = this.getGitOutput(["status", "--porcelain=v1", "-uall"]);

    const maxFileSize = options?.maxFileSizeToCaptureBytes ?? this.maxFileSizeToCaptureBytes;
    const maxTotalUntracked = options?.maxTotalUntrackedBytes ?? this.maxTotalUntrackedBytes;

    const { files, untrackedContents, totalUntrackedBytes } = parseGitStatusOutput(
      statusOutput,
      this.repoRoot,
      maxFileSize,
    );

    const filteredUntrackedContents: Record<string, string> = {};
    if (totalUntrackedBytes <= maxTotalUntracked) {
      Object.assign(filteredUntrackedContents, untrackedContents);
    } else {
      let currentBytes = 0;
      for (const [key, val] of Object.entries(untrackedContents)) {
        const valLen = Buffer.byteLength(val, "utf-8");
        if (currentBytes + valLen <= maxTotalUntracked) {
          filteredUntrackedContents[key] = val;
          currentBytes += valLen;
        } else {
          filteredUntrackedContents[key] = `[untracked_content_truncated_exceeded_total_budget]`;
        }
      }
    }

    const stagedDiff = this.getGitOutput(["diff", "--cached"]);
    const unstagedDiff = this.getGitOutput(["diff"]);
    const headDiff = this.getGitOutput(["diff", "HEAD"]);
    const rawDiff =
      headDiff.length > 0
        ? headDiff
        : [stagedDiff, unstagedDiff].filter((d) => d.trim().length > 0).join("\n");

    const diffSummary = parseDiffSummary(rawDiff);

    let stashes: GitStashEntry[] = [];
    if (options?.includeStashes ?? true) {
      stashes = parseGitStashes(
        this.getGitOutput(["stash", "list", "--format=%gd%x1f%H%x1f%gs%x1f%cI"]),
      );
    }

    const timestampKey = createdAt.replace(/[-:TZ.]/g, "").slice(0, 15);
    const hashInput = `${createdAt}|${this.repoRoot}|${headCommit}|${rawDiff}|${files.length}`;
    const snapshotHash = computeSha256(hashInput).slice(0, 8);
    const snapshotId = `snap_${timestampKey}_${snapshotHash}`;

    const metadata: Record<string, unknown> = {
      ...options?.metadata,
      version: "1.0.0",
      nodeVersion: process.version,
      platform: process.platform,
    };

    return {
      snapshotId,
      createdAt,
      repoRoot: this.repoRoot,
      branch,
      headCommit,
      uncommittedFiles: files,
      diffSummary,
      rawDiff,
      stagedDiff,
      unstagedDiff,
      untrackedFileContents: filteredUntrackedContents,
      stashes,
      metadata,
    };
  }

  public async saveSnapshot(
    snapshot: InFlightSnapshot,
    options?: SaveSnapshotOptions,
  ): Promise<string> {
    return saveSnapshotFile(this.snapshotsDir, snapshot, options);
  }

  public async loadSnapshot(
    snapshotIdOrPath: string,
    options?: LoadSnapshotOptions,
  ): Promise<InFlightSnapshot> {
    return loadSnapshotFile(this.snapshotsDir, snapshotIdOrPath, options);
  }

  public async listSnapshots(snapshotsDir?: string): Promise<InFlightSnapshotSummary[]> {
    return listSnapshotFiles(this.snapshotsDir, this.repoRoot, snapshotsDir);
  }
}

export async function createInFlightSnapshot(
  repoRoot: string,
  options?: InFlightSnapshotOptions,
): Promise<InFlightSnapshot> {
  const engine = new InFlightIngestionEngine(repoRoot, options);
  return engine.createSnapshot(options);
}

export async function saveInFlightSnapshot(
  snapshot: InFlightSnapshot,
  options?: SaveSnapshotOptions,
): Promise<string> {
  const engine = new InFlightIngestionEngine(snapshot.repoRoot);
  return engine.saveSnapshot(snapshot, options);
}

export async function loadInFlightSnapshot(
  snapshotIdOrPath: string,
  options?: LoadSnapshotOptions,
): Promise<InFlightSnapshot> {
  const root = options?.repoRoot ?? process.cwd();
  const engine = new InFlightIngestionEngine(root, options);
  return engine.loadSnapshot(snapshotIdOrPath, options);
}

export async function listInFlightSnapshots(
  snapshotsDir?: string,
): Promise<InFlightSnapshotSummary[]> {
  const engine = new InFlightIngestionEngine(
    process.cwd(),
    snapshotsDir !== undefined ? { snapshotsDir } : {},
  );
  return engine.listSnapshots(snapshotsDir);
}

export async function inspectInFlightWork(repoRoot: string): Promise<InFlightWorkInspection> {
  const engine = new InFlightIngestionEngine(repoRoot);
  return engine.inspectInFlightWork(repoRoot);
}
