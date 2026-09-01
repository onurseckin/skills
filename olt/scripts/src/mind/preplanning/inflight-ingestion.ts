// @ts-nocheck
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { HarnessError } from "../../core/index.ts";
import { assertZeroDestructiveGit } from "../../engine/index.ts";
import { runGit, type GitRunner } from "../../workflow/index.ts";

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

const DEFAULT_MAX_FILE_SIZE_BYTES = 512 * 1024; // 512 KB per file
const DEFAULT_MAX_TOTAL_UNTRACKED_BYTES = 10 * 1024 * 1024; // 10 MB total untracked

function normalizeRepoRoot(targetPath: string): string {
  return isAbsolute(targetPath) ? resolve(targetPath) : resolve(process.cwd(), targetPath);
}

function computeSha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 4096);
  for (let i = 0; i < checkLength; i++) {
    const byte = buffer[i];
    if (byte === 0) return true; // Null byte indicates binary
  }
  return false;
}

function parsePorcelainStatusCode(code: string): FileChangeStatus {
  switch (code) {
    case "?":
      return "untracked";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "U":
      return "unmerged";
    case "M":
    default:
      return "modified";
  }
}

export function parseGitStatusOutput(
  statusOutput: string,
  repoRoot: string,
  maxFileSize = DEFAULT_MAX_FILE_SIZE_BYTES,
): {
  files: UncommittedFileEntry[];
  untrackedContents: Record<string, string>;
  totalUntrackedBytes: number;
} {
  const files: UncommittedFileEntry[] = [];
  const untrackedContents: Record<string, string> = {};
  let totalUntrackedBytes = 0;

  const lines = statusOutput.split("\n");
  for (const line of lines) {
    if (!line || line.length < 3) continue;

    const indexCode = line.charAt(0);
    const workTreeCode = line.charAt(1);
    const rawPathPart = line.slice(3).trim();

    if (!rawPathPart) continue;

    let path = rawPathPart;
    let oldPath: string | undefined;

    if (rawPathPart.includes(" -> ")) {
      const parts = rawPathPart.split(" -> ");
      oldPath = parts[0]?.replace(/^"|"$/g, "");
      path = parts[1]?.replace(/^"|"$/g, "") ?? rawPathPart;
    } else {
      path = rawPathPart.replace(/^"|"$/g, "");
    }

    const isUntracked = indexCode === "?" && workTreeCode === "?";
    const staged = indexCode !== " " && indexCode !== "?" && indexCode !== "!";
    const unstaged = workTreeCode !== " " && workTreeCode !== "?" && workTreeCode !== "!";

    let primaryStatus: FileChangeStatus;
    if (isUntracked) {
      primaryStatus = "untracked";
    } else if (indexCode === "U" || workTreeCode === "U") {
      primaryStatus = "unmerged";
    } else if (indexCode === "R" || workTreeCode === "R") {
      primaryStatus = "renamed";
    } else if (indexCode === "C" || workTreeCode === "C") {
      primaryStatus = "copied";
    } else if (indexCode === "D" || workTreeCode === "D") {
      primaryStatus = "deleted";
    } else if (indexCode === "A" || workTreeCode === "A") {
      primaryStatus = "added";
    } else {
      primaryStatus = parsePorcelainStatusCode(indexCode !== " " ? indexCode : workTreeCode);
    }

    const fullPath = resolve(repoRoot, path);
    let sizeBytes = 0;
    let fileHash = "";

    if (primaryStatus !== "deleted" && existsSync(fullPath)) {
      try {
        const stats = statSync(fullPath);
        if (stats.isFile()) {
          sizeBytes = stats.size;
          if (sizeBytes <= maxFileSize) {
            const fileBuffer = readFileSync(fullPath);
            fileHash = computeSha256(fileBuffer);

            if (isUntracked && !isBinaryBuffer(fileBuffer)) {
              untrackedContents[path] = fileBuffer.toString("utf-8");
              totalUntrackedBytes += sizeBytes;
            }
          } else {
            fileHash = `[size_exceeded:${sizeBytes}_bytes]`;
          }
        }
      } catch {
        fileHash = "[read_error]";
      }
    }

    files.push({
      path,
      status: primaryStatus,
      staged,
      unstaged,
      sizeBytes,
      fileHash,
      ...(oldPath !== undefined ? { oldPath } : {}),
      indexStatus: indexCode,
      workTreeStatus: workTreeCode,
    });
  }

  return { files, untrackedContents, totalUntrackedBytes };
}

export function parseDiffSummary(diffOutput: string): DiffSummary {
  let insertions = 0;
  let deletions = 0;
  const changedFiles = new Set<string>();

  const lines = diffOutput.split("\n");
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (match && match[2]) {
        changedFiles.add(match[2]);
      }
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      insertions++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
    }
  }

  return {
    insertions,
    deletions,
    filesChanged: changedFiles.size,
  };
}

export function parseGitStashes(stashOutput: string): GitStashEntry[] {
  const entries: GitStashEntry[] = [];
  if (!stashOutput.trim()) return entries;

  const lines = stashOutput.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split("\x1f");
    if (parts.length >= 4) {
      const selector = parts[0] ?? "";
      const hash = parts[1] ?? "";
      const message = parts[2] ?? "";
      const date = parts[3] ?? "";
      const indexMatch = /stash@\{(\d+)\}/.exec(selector);
      const index =
        indexMatch && indexMatch[1] ? Number.parseInt(indexMatch[1], 10) : entries.length;

      entries.push({
        index,
        selector,
        hash,
        message,
        date,
      });
    } else {
      // Fallback standard stash format: stash@{0}: WIP on branch: hash message
      const match = /^stash@\{(\d+)\}: (.*)$/.exec(trimmed);
      if (match && match[1] && match[2]) {
        entries.push({
          index: Number.parseInt(match[1], 10),
          selector: `stash@{${match[1]}}`,
          hash: "",
          message: match[2],
          date: "",
        });
      }
    }
  }

  return entries;
}

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

  public async inspectInFlightWork(repoRoot?: string): Promise<InFlightWorkInspection> {
    const root = repoRoot !== undefined ? normalizeRepoRoot(repoRoot) : this.repoRoot;
    const inspectedAt = new Date().toISOString();

    const branchRes = this.runSafeGit(["symbolic-ref", "--short", "-q", "HEAD"]);
    let branch = branchRes.status === 0 ? branchRes.stdout.trim() : "";
    if (!branch) {
      const fallbackBranch = this.runSafeGit(["rev-parse", "--abbrev-ref", "HEAD"]);
      branch = fallbackBranch.status === 0 ? fallbackBranch.stdout.trim() : "HEAD";
    }

    const headRes = this.runSafeGit(["rev-parse", "HEAD"]);
    const headCommit = headRes.status === 0 ? headRes.stdout.trim() : "0".repeat(40);

    const statusRes = this.runSafeGit(["status", "--porcelain=v1", "-uall"]);
    const statusOutput = statusRes.status === 0 ? statusRes.stdout : "";

    const { files } = parseGitStatusOutput(statusOutput, root, this.maxFileSizeToCaptureBytes);

    const stagedDiffRes = this.runSafeGit(["diff", "--cached"]);
    const stagedDiff = stagedDiffRes.status === 0 ? stagedDiffRes.stdout : "";

    const unstagedDiffRes = this.runSafeGit(["diff"]);
    const unstagedDiff = unstagedDiffRes.status === 0 ? unstagedDiffRes.stdout : "";

    const combinedDiff = `${stagedDiff}\n${unstagedDiff}`.trim();
    const diffSummary = parseDiffSummary(combinedDiff);

    const stashRes = this.runSafeGit(["stash", "list", "--format=%gd%x1f%H%x1f%gs%x1f%cI"]);
    const stashes = stashRes.status === 0 ? parseGitStashes(stashRes.stdout) : [];

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

    const branchRes = this.runSafeGit(["symbolic-ref", "--short", "-q", "HEAD"]);
    let branch = branchRes.status === 0 ? branchRes.stdout.trim() : "";
    if (!branch) {
      const fallbackBranch = this.runSafeGit(["rev-parse", "--abbrev-ref", "HEAD"]);
      branch = fallbackBranch.status === 0 ? fallbackBranch.stdout.trim() : "HEAD";
    }

    const headRes = this.runSafeGit(["rev-parse", "HEAD"]);
    const headCommit = headRes.status === 0 ? headRes.stdout.trim() : "0".repeat(40);

    const statusRes = this.runSafeGit(["status", "--porcelain=v1", "-uall"]);
    const statusOutput = statusRes.status === 0 ? statusRes.stdout : "";

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

    const stagedDiffRes = this.runSafeGit(["diff", "--cached"]);
    const stagedDiff = stagedDiffRes.status === 0 ? stagedDiffRes.stdout : "";

    const unstagedDiffRes = this.runSafeGit(["diff"]);
    const unstagedDiff = unstagedDiffRes.status === 0 ? unstagedDiffRes.stdout : "";

    // Comprehensive diff vs HEAD if possible, fallback to combined
    let rawDiff = "";
    const headDiffRes = this.runSafeGit(["diff", "HEAD"]);
    if (headDiffRes.status === 0 && headDiffRes.stdout.length > 0) {
      rawDiff = headDiffRes.stdout;
    } else {
      rawDiff = [stagedDiff, unstagedDiff].filter((d) => d.trim().length > 0).join("\n");
    }

    const diffSummary = parseDiffSummary(rawDiff);

    let stashes: GitStashEntry[] = [];
    if (options?.includeStashes ?? true) {
      const stashRes = this.runSafeGit(["stash", "list", "--format=%gd%x1f%H%x1f%gs%x1f%cI"]);
      if (stashRes.status === 0) {
        stashes = parseGitStashes(stashRes.stdout);
      }
    }

    const timestampKey = createdAt.replace(/[-:TZ.]/g, "").slice(0, 15);
    const hashInput = `${createdAt}|${this.repoRoot}|${headCommit}|${rawDiff}|${files.length}`;
    const snapshotHash = computeSha256(hashInput).slice(0, 8);
    const snapshotId = `snap_${timestampKey}_${snapshotHash}`;

    const metadata: Record<string, unknown> = {
      ...(options?.metadata ?? {}),
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
    const targetDir =
      options?.snapshotsDir !== undefined ? resolve(options.snapshotsDir) : this.snapshotsDir;

    mkdirSync(targetDir, { recursive: true });

    const filePath = join(targetDir, `${snapshot.snapshotId}.json`);
    if (existsSync(filePath) && !(options?.overwrite ?? false)) {
      throw new HarnessError(
        "INVALID_STATE",
        `InFlight snapshot file already exists at '${filePath}' and overwrite is false`,
      );
    }

    const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    const serialized = JSON.stringify(snapshot, null, 2);

    writeFileSync(tempPath, serialized, "utf-8");
    renameSync(tempPath, filePath);

    return filePath;
  }

  public async loadSnapshot(
    snapshotIdOrPath: string,
    options?: LoadSnapshotOptions,
  ): Promise<InFlightSnapshot> {
    let targetPath = snapshotIdOrPath;
    const targetDir =
      options?.snapshotsDir !== undefined ? resolve(options.snapshotsDir) : this.snapshotsDir;

    if (!existsSync(targetPath)) {
      const candidatePath = join(targetDir, `${snapshotIdOrPath}.json`);
      if (existsSync(candidatePath)) {
        targetPath = candidatePath;
      } else {
        const directCandidate = join(targetDir, snapshotIdOrPath);
        if (existsSync(directCandidate)) {
          targetPath = directCandidate;
        } else {
          throw new HarnessError(
            "NOT_FOUND",
            `InFlight snapshot '${snapshotIdOrPath}' could not be resolved at '${targetPath}' or '${candidatePath}'`,
          );
        }
      }
    }

    const content = readFileSync(targetPath, "utf-8");
    try {
      const parsed = JSON.parse(content) as InFlightSnapshot;
      if (
        !parsed ||
        typeof parsed.snapshotId !== "string" ||
        !Array.isArray(parsed.uncommittedFiles)
      ) {
        throw new HarnessError(
          "INVALID_ARGUMENT",
          `Snapshot at '${targetPath}' does not conform to InFlightSnapshot structure`,
        );
      }
      return parsed;
    } catch (err) {
      if (err instanceof HarnessError) throw err;
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Failed to parse snapshot at '${targetPath}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  public async listSnapshots(snapshotsDir?: string): Promise<InFlightSnapshotSummary[]> {
    const targetDir = snapshotsDir !== undefined ? resolve(snapshotsDir) : this.snapshotsDir;
    if (!existsSync(targetDir)) {
      return [];
    }

    const files = readdirSync(targetDir);
    const summaries: InFlightSnapshotSummary[] = [];

    for (const fileName of files) {
      if (!fileName.endsWith(".json")) continue;
      const fullPath = join(targetDir, fileName);

      try {
        const stats = statSync(fullPath);
        if (!stats.isFile()) continue;

        const content = readFileSync(fullPath, "utf-8");
        const parsed = JSON.parse(content) as InFlightSnapshot;

        if (
          parsed &&
          typeof parsed.snapshotId === "string" &&
          typeof parsed.createdAt === "string"
        ) {
          summaries.push({
            snapshotId: parsed.snapshotId,
            createdAt: parsed.createdAt,
            filePath: fullPath,
            repoRoot: parsed.repoRoot ?? this.repoRoot,
            branch: parsed.branch ?? "",
            headCommit: parsed.headCommit ?? "",
            filesChanged: parsed.diffSummary?.filesChanged ?? parsed.uncommittedFiles?.length ?? 0,
            insertions: parsed.diffSummary?.insertions ?? 0,
            deletions: parsed.diffSummary?.deletions ?? 0,
            untrackedFilesCount:
              parsed.uncommittedFiles?.filter((f) => f.status === "untracked").length ?? 0,
            sizeBytes: stats.size,
          });
        }
      } catch {
        // Skip unreadable or corrupted files in listing
      }
    }

    // Sort descending by createdAt
    summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return summaries;
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
  const engine = new InFlightIngestionEngine(process.cwd(), {
    ...(snapshotsDir !== undefined ? { snapshotsDir } : {}),
  });
  return engine.listSnapshots(snapshotsDir);
}

export async function inspectInFlightWork(repoRoot: string): Promise<InFlightWorkInspection> {
  const engine = new InFlightIngestionEngine(repoRoot);
  return engine.inspectInFlightWork(repoRoot);
}
