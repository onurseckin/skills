import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";

export const OLT_DIR_NAME = ".olt";
export const LEGACY_OLT_DIR_NAME = "olt";
export const CAPSULES_DIR_NAME = "capsules";
export const LEGACY_CAPSULES_DIR_NAME = ".capsules";

export const OLT_FILES = {
  POLICY: "policy.json",
  BACKLOG: "backlog.jsonl",
  COMPLETED_TASKS: "completed-tasks.jsonl",
  DEFECTS: "defects.jsonl",
  COMPLETED_DEFECTS: "completed-defects.jsonl",
  TELEMETRY: "telemetry.jsonl",
} as const;

export const LEGACY_MIND_QUEUE_FILES = {
  POLICY: ".capsules/repo-policy.json",
  BACKLOG: ".capsules/mind/queue/feedback-queue.jsonl",
  COMPLETED_TASKS: ".capsules/mind/queue/completed-tasks.jsonl",
  DEFECTS: ".capsules/mind/queue/blunders.jsonl",
  COMPLETED_DEFECTS: ".capsules/mind/queue/completed-blunders.jsonl",
  TELEMETRY: ".capsules/mind/queue/observations.jsonl",
} as const;

function unsafe(message: string): never {
  throw new HarnessError("PATH_SAFETY", message);
}

export function findRepoRoot(startDir: string = process.cwd()): string {
  let current = resolve(startDir);
  while (true) {
    if (
      existsSync(join(current, OLT_DIR_NAME)) ||
      existsSync(join(current, ".git")) ||
      existsSync(join(current, LEGACY_CAPSULES_DIR_NAME)) ||
      existsSync(join(current, "package.json"))
    ) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return resolve(startDir);
}

export function resolveOltDir(repoRoot?: string): string {
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  const modern = join(root, OLT_DIR_NAME);
  if (existsSync(modern)) return modern;
  const legacy = join(root, LEGACY_OLT_DIR_NAME);
  if (existsSync(legacy)) return legacy;
  return modern;
}

export function resolveCapsulesDir(repoRoot?: string): string {
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  const modern = join(root, CAPSULES_DIR_NAME);
  const legacy = join(root, LEGACY_CAPSULES_DIR_NAME);
  if (existsSync(modern)) return modern;
  if (existsSync(legacy)) return legacy;
  return modern;
}

export function resolvePolicyPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  const canonical = join(root, OLT_DIR_NAME, OLT_FILES.POLICY);
  if (existsSync(canonical)) return canonical;
  const legacy = join(root, LEGACY_MIND_QUEUE_FILES.POLICY);
  if (existsSync(legacy)) return legacy;
  return canonical;
}

export function resolveBacklogPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  const canonical = join(root, OLT_DIR_NAME, OLT_FILES.BACKLOG);
  if (existsSync(canonical)) return canonical;
  const legacy = join(root, LEGACY_MIND_QUEUE_FILES.BACKLOG);
  if (existsSync(legacy)) return legacy;
  const legacyCapsule = join(root, ".capsules/FEEDBACK_QUEUE.jsonl");
  if (existsSync(legacyCapsule)) return legacyCapsule;
  return canonical;
}

export function resolveCompletedTasksPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  const canonical = join(root, OLT_DIR_NAME, OLT_FILES.COMPLETED_TASKS);
  if (existsSync(canonical)) return canonical;
  const legacy = join(root, LEGACY_MIND_QUEUE_FILES.COMPLETED_TASKS);
  if (existsSync(legacy)) return legacy;
  return canonical;
}

export function resolveDefectsPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  const canonical = join(root, OLT_DIR_NAME, OLT_FILES.DEFECTS);
  if (existsSync(canonical)) return canonical;
  const legacy = join(root, LEGACY_MIND_QUEUE_FILES.DEFECTS);
  if (existsSync(legacy)) return legacy;
  const legacyCapsule = join(root, ".capsules/blunders.jsonl");
  if (existsSync(legacyCapsule)) return legacyCapsule;
  return canonical;
}

export function resolveCompletedDefectsPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  const canonical = join(root, OLT_DIR_NAME, OLT_FILES.COMPLETED_DEFECTS);
  if (existsSync(canonical)) return canonical;
  const legacy = join(root, LEGACY_MIND_QUEUE_FILES.COMPLETED_DEFECTS);
  if (existsSync(legacy)) return legacy;
  const legacyCapsule = join(root, ".capsules/COMPLETED_BLUNDERS.jsonl");
  if (existsSync(legacyCapsule)) return legacyCapsule;
  return canonical;
}

export function resolveTelemetryPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  const canonical = join(root, OLT_DIR_NAME, OLT_FILES.TELEMETRY);
  if (existsSync(canonical)) return canonical;
  const legacy = join(root, LEGACY_MIND_QUEUE_FILES.TELEMETRY);
  if (existsSync(legacy)) return legacy;
  const legacyCapsule = join(root, ".capsules/observations.jsonl");
  if (existsSync(legacyCapsule)) return legacyCapsule;
  return canonical;
}
