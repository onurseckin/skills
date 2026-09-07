import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { HarnessError } from "../../../core/index.ts";
import type {
  InFlightSnapshot,
  InFlightSnapshotSummary,
  LoadSnapshotOptions,
  SaveSnapshotOptions,
} from "./inflight-types.ts";

export async function saveSnapshotFile(
  defaultSnapshotsDir: string,
  snapshot: InFlightSnapshot,
  options?: SaveSnapshotOptions,
): Promise<string> {
  const targetDir =
    options?.snapshotsDir !== undefined ? resolve(options.snapshotsDir) : defaultSnapshotsDir;

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

export async function loadSnapshotFile(
  defaultSnapshotsDir: string,
  snapshotIdOrPath: string,
  options?: LoadSnapshotOptions,
): Promise<InFlightSnapshot> {
  let targetPath = snapshotIdOrPath;
  const targetDir =
    options?.snapshotsDir !== undefined ? resolve(options.snapshotsDir) : defaultSnapshotsDir;

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

export async function listSnapshotFiles(
  defaultSnapshotsDir: string,
  fallbackRepoRoot: string,
  snapshotsDir?: string,
): Promise<InFlightSnapshotSummary[]> {
  const targetDir = snapshotsDir !== undefined ? resolve(snapshotsDir) : defaultSnapshotsDir;
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

      if (parsed && typeof parsed.snapshotId === "string" && typeof parsed.createdAt === "string") {
        summaries.push({
          snapshotId: parsed.snapshotId,
          createdAt: parsed.createdAt,
          filePath: fullPath,
          repoRoot: parsed.repoRoot ?? fallbackRepoRoot,
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
    } catch {}
  }

  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return summaries;
}
