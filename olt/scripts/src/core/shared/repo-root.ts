import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { HarnessError } from "../errors/index.ts";

export const OLT_DIR_NAME = ".olt";
export const CAPSULES_DIR_NAME = "capsules";

export const OLT_FILES = {
  POLICY: "policy.json",
  BACKLOG: "backlog.jsonl",
  COMPLETED_TASKS: "completed-tasks.jsonl",
  DEFECTS: "defects.jsonl",
  COMPLETED_DEFECTS: "completed-defects.jsonl",
  TELEMETRY: "telemetry.jsonl",
  MEMORY: "memory.json",
  WATCHDOGS: "watchdogs.json",
  SKILL_CONFIG: "skill-config.json",
  QUOTA_DAG_SNAPSHOT: "quota-dag-snapshot.json",
} as const;

function unsafe(message: string): never {
  throw new HarnessError("PATH_SAFETY", message);
}

export function isInsideCapsule(targetPath: string): boolean {
  const n = resolve(targetPath).split(sep).join("/");
  return (
    n.includes("/.olt/capsules/") ||
    n.endsWith("/.olt/capsules") ||
    n.includes("/.capsules/") ||
    n.endsWith("/.capsules")
  );
}

export function stripCapsulePath(targetPath: string): string | undefined {
  const norm = resolve(targetPath);
  for (const pat of [`${sep}.olt${sep}capsules`, `${sep}.capsules`]) {
    const idx = norm.indexOf(pat);
    if (idx !== -1) return norm.slice(0, idx) || sep;
  }
  return undefined;
}

export function findRepoRoot(startDir: string = process.cwd()): string {
  const resolvedStart = resolve(startDir);
  const stripped = stripCapsulePath(resolvedStart);
  let current = stripped ?? resolvedStart;

  while (true) {
    const isExcluded =
      current.endsWith("/olt/scripts") ||
      current.endsWith("/olt") ||
      current.endsWith("/.olt") ||
      isInsideCapsule(current);

    if (!isExcluded) {
      const hasOlt = existsSync(join(current, OLT_DIR_NAME));
      const hasGit = existsSync(join(current, ".git"));
      const hasPkg = existsSync(join(current, "package.json"));

      if (hasOlt || hasGit || hasPkg) {
        return current;
      }
    }

    const parent = resolve(current, "..");
    if (parent === current) {
      break;
    }
    current = parent;
  }

  unsafe(
    `findRepoRoot: no repository anchor (.git, .olt, or package.json) found walking up from '${resolvedStart}'; refusing to guess a repo root`,
  );
}
