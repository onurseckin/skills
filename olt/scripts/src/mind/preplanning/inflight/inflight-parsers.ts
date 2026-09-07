import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type {
  DiffSummary,
  FileChangeStatus,
  GitStashEntry,
  UncommittedFileEntry,
} from "./inflight-types.ts";

export const DEFAULT_MAX_FILE_SIZE_BYTES = 512 * 1024;
export const DEFAULT_MAX_TOTAL_UNTRACKED_BYTES = 10 * 1024 * 1024;

export function normalizeRepoRoot(targetPath: string): string {
  return isAbsolute(targetPath) ? resolve(targetPath) : resolve(process.cwd(), targetPath);
}

export function computeSha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function isBinaryBuffer(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 4096);
  for (let i = 0; i < checkLength; i++) {
    const byte = buffer[i];
    if (byte === 0) return true;
  }
  return false;
}

export function parsePorcelainStatusCode(code: string): FileChangeStatus {
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
