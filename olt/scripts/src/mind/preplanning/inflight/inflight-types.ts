import type { GitRunner } from "../../../workflow/index.ts";

export type FileChangeStatus =
  | "modified"
  | "added"
  | "deleted"
  | "untracked"
  | "renamed"
  | "copied"
  | "unmerged";

export interface UncommittedFileEntry {
  readonly path: string;
  readonly status: FileChangeStatus;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly sizeBytes: number;
  readonly fileHash: string;
  readonly oldPath?: string | undefined;
  readonly indexStatus: string;
  readonly workTreeStatus: string;
}

export interface DiffSummary {
  readonly insertions: number;
  readonly deletions: number;
  readonly filesChanged: number;
}

export interface GitStashEntry {
  readonly index: number;
  readonly selector: string;
  readonly hash: string;
  readonly message: string;
  readonly date: string;
}

export interface InFlightSnapshot {
  readonly snapshotId: string;
  readonly createdAt: string;
  readonly repoRoot: string;
  readonly branch: string;
  readonly headCommit: string;
  readonly uncommittedFiles: readonly UncommittedFileEntry[];
  readonly diffSummary: DiffSummary;
  readonly rawDiff: string;
  readonly stagedDiff: string;
  readonly unstagedDiff: string;
  readonly untrackedFileContents: Readonly<Record<string, string>>;
  readonly stashes: readonly GitStashEntry[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface InFlightSnapshotSummary {
  readonly snapshotId: string;
  readonly createdAt: string;
  readonly filePath: string;
  readonly repoRoot: string;
  readonly branch: string;
  readonly headCommit: string;
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly untrackedFilesCount: number;
  readonly sizeBytes: number;
}

export interface InFlightWorkInspection {
  readonly repoRoot: string;
  readonly branch: string;
  readonly headCommit: string;
  readonly hasUncommittedChanges: boolean;
  readonly uncommittedFilesCount: number;
  readonly stagedFilesCount: number;
  readonly unstagedFilesCount: number;
  readonly untrackedFilesCount: number;
  readonly diffSummary: DiffSummary;
  readonly stashCount: number;
  readonly files: readonly UncommittedFileEntry[];
  readonly stashes: readonly GitStashEntry[];
  readonly inspectedAt: string;
}

export interface InFlightSnapshotOptions {
  readonly maxFileSizeToCaptureBytes?: number | undefined;
  readonly maxTotalUntrackedBytes?: number | undefined;
  readonly includeStashes?: boolean | undefined;
  readonly runner?: GitRunner | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly customTimestamp?: string | undefined;
}

export interface SaveSnapshotOptions {
  readonly snapshotsDir?: string | undefined;
  readonly overwrite?: boolean | undefined;
}

export interface LoadSnapshotOptions {
  readonly snapshotsDir?: string | undefined;
  readonly repoRoot?: string | undefined;
}

export interface InFlightEngineOptions extends InFlightSnapshotOptions {
  readonly repoRoot?: string | undefined;
  readonly snapshotsDir?: string | undefined;
}
