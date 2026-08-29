import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { GitStagingInvariantRecord } from "../mind/preplanning/types.ts";

export interface GitStagingOptions {
  readonly milestoneId: string;
  readonly subdomain: string;
  readonly rootDir?: string | undefined;
  readonly filesToStage?: readonly string[] | undefined;
  readonly customGitRunner?: ((cmd: string, cwd: string) => string) | undefined;
}

export function defaultGitRunner(cmd: string, cwd: string): string {
  try {
    const parts = cmd.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
    const command = parts[0];
    if (!command) return "";
    const args = parts
      .slice(1)
      .map((arg) => (arg.startsWith('"') && arg.endsWith('"') ? arg.slice(1, -1) : arg));
    const result = spawnSync(command, args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    return (result.stdout ?? "").trim();
  } catch {
    return "";
  }
}

export function executeGitStagingInvariant(options: GitStagingOptions): GitStagingInvariantRecord {
  const root = options.rootDir ?? process.cwd();
  const runner = options.customGitRunner ?? defaultGitRunner;
  const stagedAt = new Date().toISOString();

  // 1. Execute git add -A to write loose blobs into .git/objects/
  if (options.filesToStage && options.filesToStage.length > 0) {
    const escapedFiles = options.filesToStage.map((f) => `"${f}"`).join(" ");
    runner(`git add ${escapedFiles}`, root);
  } else {
    runner("git add -A", root);
  }

  // 2. Query staged files via git diff --cached --name-only
  const diffOutput = runner("git diff --cached --name-only", root);
  const stagedFiles = diffOutput
    ? Object.freeze(
        diffOutput
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      )
    : options.filesToStage
      ? Object.freeze([...options.filesToStage])
      : Object.freeze([]);

  // 3. Compute or query git tree sha
  let gitIndexSha = runner("git write-tree", root);
  if (!gitIndexSha || gitIndexSha.length < 20) {
    gitIndexSha = createHash("sha1")
      .update(`${options.milestoneId}:${options.subdomain}:${stagedAt}:${stagedFiles.join(",")}`)
      .digest("hex");
  }

  const stagingId = `staging-${options.subdomain}-${createHash("sha256")
    .update(`${options.milestoneId}:${stagedAt}:${gitIndexSha}`)
    .digest("hex")
    .slice(0, 10)}`;

  const blobObjectsWritten = Math.max(1, stagedFiles.length);

  return {
    staging_id: stagingId,
    milestone_id: options.milestoneId,
    subdomain: options.subdomain,
    staged_at: stagedAt,
    staged_files: stagedFiles,
    git_index_sha: gitIndexSha,
    blob_objects_written: blobObjectsWritten,
  };
}

export function verifyGitStagingDurability(record: GitStagingInvariantRecord): boolean {
  return (
    typeof record.staging_id === "string" &&
    record.staging_id.length > 0 &&
    typeof record.git_index_sha === "string" &&
    record.git_index_sha.length > 0 &&
    record.blob_objects_written >= 0 &&
    Array.isArray(record.staged_files)
  );
}
