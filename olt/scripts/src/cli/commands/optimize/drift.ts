import * as childProcess from "node:child_process";
import { assertFlags, boolFlag, textFlag, type CommandContext, type Flags } from "../../index.ts";
import { HarnessError } from "../../../core/errors/index.ts";

export type DriftStatus = "quiescent_ignored" | "drift_detected";

export interface DriftOptions {
  readonly base?: string | undefined;
  readonly target?: string | undefined;
  readonly paths?: readonly string[] | string[] | undefined;
  readonly strict?: boolean | undefined;
  readonly gitExecutor?:
    | ((args: readonly string[], cwd?: string | undefined) => string)
    | undefined;
}

export interface DriftResult {
  readonly drift: number;
  readonly status: DriftStatus;
  readonly message: string;
  readonly codeRelevantPaths: readonly string[];
  readonly ignoredPaths: readonly string[];
  readonly allPaths: readonly string[];
  readonly hasNewPlan: boolean;
  readonly hasCodeMutation: boolean;
}

export function normalizePath(rawPath: string): string {
  let p = rawPath.trim().replace(/\\/g, "/");
  while (p.startsWith("./")) {
    p = p.slice(2);
  }
  while (p.startsWith("/")) {
    p = p.slice(1);
  }
  return p;
}

export function isArchive(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === "docs/archive" || normalized.startsWith("docs/archive/");
}

export function isGitHygiene(path: string): boolean {
  const normalized = normalizePath(path);
  if (normalized === ".git" || normalized.startsWith(".git/")) return true;
  const baseName = normalized.split("/").pop() ?? normalized;
  return (
    baseName === ".gitignore" ||
    baseName === ".gitattributes" ||
    baseName === ".gitmodules" ||
    baseName === ".gitkeep" ||
    baseName === ".mailmap"
  );
}

export function isExecutablePlan(path: string): boolean {
  const normalized = normalizePath(path);
  if (isArchive(normalized)) return false;
  return /^docs\/planning\/(?:.+\/)?PLAN\.md$/i.test(normalized);
}

export function isSourceCode(path: string): boolean {
  const normalized = normalizePath(path);
  if (isArchive(normalized)) return false;
  if (isGitHygiene(normalized)) return false;

  const baseName = normalized.split("/").pop() ?? normalized;
  const baseLower = baseName.toLowerCase();
  if (baseLower === "readme.md" || baseLower.startsWith("readme.")) return false;
  if (baseLower === "license" || baseLower.startsWith("license.")) return false;

  if (normalized === "src" || normalized.startsWith("src/")) return true;
  if (normalized === "olt" || normalized.startsWith("olt/")) return true;

  if (/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(baseName)) return true;

  if (baseName === "package.json" || baseName === "bunfig.toml" || baseName === "tsconfig.json") {
    return true;
  }

  return false;
}

export function defaultGitExecutor(args: readonly string[], cwd?: string): string {
  const result = childProcess.spawnSync("git", [...args], {
    cwd: cwd ?? process.cwd(),
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    throw new HarnessError(
      "INVALID_STATE",
      `Failed to execute git ${args.join(" ")}: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.trim() : "";
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `git ${args.join(" ")} failed with status ${String(result.status)}: ${stderr}`,
    );
  }
  return result.stdout ?? "";
}

export function getRawPaths(options?: DriftOptions): readonly string[] {
  if (options?.paths !== undefined) {
    return options.paths;
  }
  const gitExec = options?.gitExecutor ?? defaultGitExecutor;
  const base = options?.base ?? "HEAD~1";
  const target = options?.target;

  const diffOutput = gitExec(["diff", "--name-only", base], target);
  let untrackedOutput = "";
  try {
    untrackedOutput = gitExec(["ls-files", "--others", "--exclude-standard"], target);
  } catch {
    untrackedOutput = "";
  }

  return `${diffOutput}\n${untrackedOutput}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function checkCodeRelevantDrift(options?: DriftOptions): DriftResult {
  const rawPaths = getRawPaths(options);
  const uniquePaths = Array.from(
    new Set(rawPaths.map((p) => normalizePath(p)).filter((p) => p.length > 0)),
  ).sort();

  const codeRelevantPaths: string[] = [];
  const ignoredPaths: string[] = [];
  let hasNewPlan = false;
  let hasCodeMutation = false;

  for (const path of uniquePaths) {
    if (isExecutablePlan(path)) {
      codeRelevantPaths.push(path);
      hasNewPlan = true;
    } else if (isSourceCode(path)) {
      codeRelevantPaths.push(path);
      hasCodeMutation = true;
    } else {
      ignoredPaths.push(path);
    }
  }

  const drift = codeRelevantPaths.length;
  const status: DriftStatus = drift === 0 ? "quiescent_ignored" : "drift_detected";

  let detail: string;
  if (drift === 0) {
    detail = "Quiescent Ignored";
  } else if (hasNewPlan && !hasCodeMutation) {
    detail = "New Plan Detected";
  } else {
    detail = "Code Mutated";
  }

  const message = `Drift: ${drift} (${detail})`;

  return {
    drift,
    status,
    message,
    codeRelevantPaths,
    ignoredPaths,
    allPaths: uniquePaths,
    hasNewPlan,
    hasCodeMutation,
  };
}

export function setProcessExitCodeIfHarness(
  drift: number,
  entryScript: string | undefined = Bun.argv[1],
): void {
  if (entryScript !== undefined && entryScript.endsWith("/harness.ts")) {
    process.exitCode = drift > 0 ? 1 : 0;
  }
}

const ALLOWED_DRIFT_FLAGS = ["base", "target", "paths", "json", "strict"] as const;

export async function optimizeCheckDriftCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  assertFlags(flags, ALLOWED_DRIFT_FLAGS);

  const base = textFlag(flags, "base", false) ?? "HEAD~1";
  const target = textFlag(flags, "target", false);
  const strict = boolFlag(flags, "strict");
  const json = boolFlag(flags, "json");

  let paths: string[] | undefined;
  const rawPaths = flags["paths"];
  if (typeof rawPaths === "string") {
    paths = rawPaths
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
  } else if (Array.isArray(rawPaths)) {
    paths = rawPaths.flatMap((p) =>
      typeof p === "string"
        ? p
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    );
  }

  const driftResult = checkCodeRelevantDrift({
    base,
    target,
    paths,
    strict,
  });

  setProcessExitCodeIfHarness(driftResult.drift);

  if (strict && driftResult.drift > 0) {
    throw new HarnessError(
      "INVALID_STATE",
      driftResult.message,
      [...driftResult.codeRelevantPaths],
      1,
      "Resolve code-relevant drift or discard mutations before entering quiescent standby",
    );
  }

  const markdown = [
    driftResult.message,
    "",
    "### Drift Inspection Summary",
    `- **Status**: \`${driftResult.status}\``,
    `- **Drift Count**: \`${driftResult.drift}\``,
    `- **Code-Relevant Drift**: ${
      driftResult.codeRelevantPaths.length > 0
        ? driftResult.codeRelevantPaths.map((p) => `\`${p}\``).join(", ")
        : "None"
    }`,
    `- **Quiescent Ignored**: ${
      driftResult.ignoredPaths.length > 0
        ? driftResult.ignoredPaths.map((p) => `\`${p}\``).join(", ")
        : "None"
    }`,
  ].join("\n");

  return {
    ok: true,
    drift: driftResult.drift,
    status: driftResult.status,
    message: driftResult.message,
    exit_code: driftResult.drift > 0 ? 1 : 0,
    code_relevant_paths: driftResult.codeRelevantPaths,
    codeRelevantPaths: driftResult.codeRelevantPaths,
    ignored_paths: driftResult.ignoredPaths,
    all_paths: driftResult.allPaths,
    has_new_plan: driftResult.hasNewPlan,
    has_code_mutation: driftResult.hasCodeMutation,
    json,
    markdown,
  };
}
