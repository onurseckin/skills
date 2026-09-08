import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { HarnessError } from "../../../core/errors/index.ts";
import {
  cleanupTrackWorktree,
  destroyOrchestratorWorktree,
  listTrackWorktrees,
  resolveRepo,
  runGit,
  type GitRunner,
  type TrackWorktreeInfo,
} from "../../../workflow/worktree/index.ts";
import { enforceLineLimit } from "../../formatters/index.ts";
import { assertFlags, boolFlag, textFlag, type CommandContext, type Flags } from "../../index.ts";

export interface CompilerHealthCheck {
  readonly healthy: boolean;
  readonly output: string;
}

export type TscRunner = (repoRoot: string) => { success: boolean; output: string };
export type WorktreeCleaner = (repoRoot: string) => { cleaned: string[]; skipped: string[] };

export interface QuarantineOptions {
  readonly reason?: string | undefined;
  readonly defect?: string | undefined;
  readonly failureLogs?: string | undefined;
  readonly dryRun?: boolean | undefined;
  readonly repoRoot?: string | undefined;
  readonly cleanAllWorktrees?: boolean | undefined;
  readonly runner?: GitRunner | undefined;
  readonly tscRunner?: TscRunner | undefined;
  readonly worktreeCleaner?: WorktreeCleaner | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface QuarantineResult {
  readonly success: boolean;
  readonly planSlug: string;
  readonly quarantined: boolean;
  readonly dryRun: boolean;
  readonly timestamp: string;
  readonly quarantineFilePath: string;
  readonly reason: string;
  readonly defectId?: string | undefined;
  readonly defectSha?: string | undefined;
  readonly failureLogs: string;
  readonly worktreesCleaned: readonly string[];
  readonly gitRestored: boolean;
  readonly compilerHealth: CompilerHealthCheck;
  readonly nextState: string;
  readonly markdown: string;
}

let activeTscRunner: TscRunner | undefined;

export function setTscRunnerForTesting(runner?: TscRunner | undefined): () => void {
  const previous = activeTscRunner;
  activeTscRunner = runner;
  return () => {
    activeTscRunner = previous;
  };
}

const SLUG_REGEX = /^[a-zA-Z0-9_-]+$/;

function validatePlanSlug(planSlug: string): void {
  if (!planSlug || !SLUG_REGEX.test(planSlug)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Invalid plan slug: '${planSlug}'. Must be alphanumeric with dashes or underscores.`,
    );
  }
}

function resolveDefectSha(
  repoRoot: string,
  gitRunner: GitRunner,
  explicitDefect?: string | undefined,
): string {
  if (explicitDefect && /^[0-9a-fA-F]{40}$/.test(explicitDefect)) return explicitDefect;
  try {
    const res = gitRunner(repoRoot, ["rev-parse", "HEAD"]);
    if (res.status === 0 && res.stdout.trim()) return res.stdout.trim();
  } catch {}
  return explicitDefect ?? "UNKNOWN_DEFECT_SHA";
}

function checkCompilerHealth(
  repoRoot: string,
  runner?: TscRunner | undefined,
): CompilerHealthCheck {
  const runnerFn = runner ?? activeTscRunner;
  if (runnerFn) {
    try {
      const res = runnerFn(repoRoot);
      return { healthy: res.success, output: res.output };
    } catch (error) {
      return {
        healthy: false,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }
  try {
    const proc = spawnSync("bun", ["x", "tsc", "--noEmit"], {
      cwd: repoRoot,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const stdout = proc.stdout ?? "";
    const stderr = proc.stderr ?? "";
    const output = `${stdout}\n${stderr}`.trim();
    return { healthy: proc.status === 0, output: output || "(clean)" };
  } catch (error) {
    return {
      healthy: false,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

function getTargetWorktrees(
  repoRoot: string,
  planSlug: string,
  cleanAll: boolean,
): readonly TrackWorktreeInfo[] {
  const worktrees = listTrackWorktrees({ repoRoot });
  if (cleanAll) return worktrees;
  return worktrees.filter(
    (wt) =>
      wt.trackId === planSlug ||
      wt.trackId.startsWith(`${planSlug}-`) ||
      wt.trackId === `orch-${planSlug}` ||
      wt.domain === planSlug,
  );
}

function cleanWorktrees(
  repoRoot: string,
  planSlug: string,
  cleanAll: boolean,
  cleaner?: WorktreeCleaner | undefined,
): string[] {
  if (cleaner) return cleaner(repoRoot).cleaned;
  const targets = getTargetWorktrees(repoRoot, planSlug, cleanAll);
  const cleaned: string[] = [];
  for (const wt of targets) {
    try {
      if (wt.tier === "orchestrator" || wt.trackId.startsWith("orch-")) {
        const domain = wt.domain ?? wt.trackId.replace(/^orch-/, "");
        destroyOrchestratorWorktree({ domain, repoRoot, force: true });
      } else {
        cleanupTrackWorktree({ trackId: wt.trackId, repoRoot, force: true });
      }
      cleaned.push(wt.trackId);
    } catch {}
  }
  return cleaned;
}

function restoreGitIndex(repoRoot: string, gitRunner: GitRunner): boolean {
  try {
    const resetRes = gitRunner(repoRoot, ["reset"]);
    const checkoutRes = gitRunner(repoRoot, ["checkout", "main"]);
    return resetRes.status === 0 && checkoutRes.status === 0;
  } catch {
    return false;
  }
}

function generateQuarantineMarkdown(params: {
  planSlug: string;
  timestamp: string;
  reason: string;
  defectId?: string | undefined;
  defectSha: string;
  failureLogs: string;
  worktreesCleaned: readonly string[];
  compilerHealth: CompilerHealthCheck;
  originalPlanContent?: string | undefined;
}): string {
  const lines: string[] = [
    `# Quarantined Plan: ${params.planSlug}`,
    "",
    `- **Status**: QUARANTINED`,
    `- **Timestamp**: ${params.timestamp}`,
    `- **Reason**: ${params.reason}`,
    `- **Defect Identifier**: ${params.defectId ?? "N/A"}`,
    `- **Defect SHA**: ${params.defectSha}`,
    "",
    `## Failure Logs`,
    "```",
    params.failureLogs,
    "```",
    "",
    `## Atomic Quarantine Recovery Actions`,
    `1. Child Worktrees: ${
      params.worktreesCleaned.length > 0
        ? `Cleaned ${params.worktreesCleaned.length} worktree(s): ${params.worktreesCleaned.map((w) => `\`${w}\``).join(", ")}`
        : "None active"
    }`,
    `2. Git Index Restoration: Checked out \`main\` and reset staging.`,
    `3. Compiler Health Verification: ${
      params.compilerHealth.healthy
        ? "PASSED (`tsc --noEmit` clean)"
        : "FAILED (compiler defects present)"
    }`,
    "",
    "### Compiler Output",
    "```",
    params.compilerHealth.output || "(no compiler errors)",
    "```",
  ];

  if (params.originalPlanContent) {
    lines.push("", "## Preserved Original Plan", "", params.originalPlanContent);
  }

  return lines.join("\n") + "\n";
}

function formatQuarantineBrief(result: QuarantineResult): string {
  const badge = result.dryRun
    ? "DRY RUN (Simulated)"
    : result.quarantined
      ? "QUARANTINED"
      : "SKIPPED";
  const lines: string[] = [
    `### Plan Quarantine: \`${result.planSlug}\``,
    `- **Status**: ${badge}`,
    `- **Plan**: \`${result.planSlug}\``,
    `- **Quarantine File**: \`${result.quarantineFilePath}\``,
    `- **Timestamp**: ${result.timestamp}`,
    `- **Reason**: ${result.reason}`,
    `- **Defect ID**: ${result.defectId ?? "N/A"}`,
    `- **Defect SHA**: ${result.defectSha ?? "N/A"}`,
    `- **Worktrees Cleaned**: ${
      result.worktreesCleaned.length > 0
        ? result.worktreesCleaned.map((w) => `\`${w}\``).join(", ")
        : "None"
    }`,
    `- **Git Index Restored**: ${result.gitRestored ? "Yes (`main` clean)" : result.dryRun ? "Simulated" : "No"}`,
    `- **Compiler Health**: ${result.compilerHealth.healthy ? "Clean (`tsc --noEmit` passed)" : "Errors detected"}`,
    `- **Next Transition**: \`${result.nextState}\``,
  ];
  return enforceLineLimit(lines.join("\n"));
}

export function executeQuarantine(
  planSlug: string,
  options?: QuarantineOptions | undefined,
): QuarantineResult {
  validatePlanSlug(planSlug);

  const dryRun = Boolean(options?.dryRun);
  const repoRoot = resolveRepo(options?.repoRoot);
  const gitRunner = options?.runner ?? runGit;
  const now = options?.now ? options.now() : new Date();
  const timestamp = now.toISOString();

  const reason = options?.reason?.trim() || "Unresolvable defect encountered during plan execution";
  const defectId = options?.defect?.trim();
  const defectSha = resolveDefectSha(repoRoot, gitRunner, defectId);
  const failureLogs = options?.failureLogs?.trim() || reason;

  const planDir = join(repoRoot, "docs", "planning", planSlug);
  const planFile = join(planDir, "PLAN.md");
  const quarantineFile = join(planDir, "QUARANTINED.md");

  let originalPlanContent: string | undefined;
  if (existsSync(planFile)) {
    try {
      originalPlanContent = readFileSync(planFile, "utf-8");
    } catch {}
  }

  const worktreesCleaned = dryRun
    ? getTargetWorktrees(repoRoot, planSlug, Boolean(options?.cleanAllWorktrees)).map(
        (w) => w.trackId,
      )
    : cleanWorktrees(
        repoRoot,
        planSlug,
        Boolean(options?.cleanAllWorktrees),
        options?.worktreeCleaner,
      );

  const gitRestored = dryRun ? false : restoreGitIndex(repoRoot, gitRunner);
  const compilerHealth = checkCompilerHealth(repoRoot, options?.tscRunner);

  if (!dryRun) {
    if (!existsSync(planDir)) {
      mkdirSync(planDir, { recursive: true });
    }
    const md = generateQuarantineMarkdown({
      planSlug,
      timestamp,
      reason,
      defectId,
      defectSha,
      failureLogs,
      worktreesCleaned,
      compilerHealth,
      originalPlanContent,
    });
    writeFileSync(quarantineFile, md, "utf-8");
    if (existsSync(planFile)) {
      unlinkSync(planFile);
    }
  }

  const nextState = "TRANSITION_NEXT_PLAN_OR_PHASE_2";
  const result: QuarantineResult = {
    success: true,
    planSlug,
    quarantined: !dryRun,
    dryRun,
    timestamp,
    quarantineFilePath: quarantineFile,
    reason,
    defectId,
    defectSha,
    failureLogs,
    worktreesCleaned,
    gitRestored,
    compilerHealth,
    nextState,
    markdown: "",
  };

  const markdown = formatQuarantineBrief(result);
  return { ...result, markdown };
}

export async function optimizeQuarantineCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  assertFlags(flags, [
    "plan",
    "reason",
    "defect",
    "failure-logs",
    "logs",
    "clean-all",
    "clean-all-worktrees",
    "dry-run",
    "json",
    "repo-root",
    "repo",
    "actor",
    "run",
  ]);

  const planSlug = textFlag(flags, "plan", false);
  if (!planSlug) {
    throw new HarnessError("INVALID_ARGUMENT", "--plan is required");
  }

  const reason = textFlag(flags, "reason", false);
  const defect = textFlag(flags, "defect", false);
  const failureLogs = textFlag(flags, "failure-logs", false) ?? textFlag(flags, "logs", false);
  const cleanAllWorktrees = boolFlag(flags, "clean-all") || boolFlag(flags, "clean-all-worktrees");
  const dryRun = boolFlag(flags, "dry-run");
  const asJson = boolFlag(flags, "json");
  const repoRoot = textFlag(flags, "repo-root", false);

  const result = executeQuarantine(planSlug, {
    reason,
    defect,
    failureLogs,
    cleanAllWorktrees,
    dryRun,
    repoRoot,
  });

  return {
    markdown: result.markdown,
    ok: result.success,
    plan: result.planSlug,
    quarantined: result.quarantined,
    dry_run: result.dryRun,
    timestamp: result.timestamp,
    quarantine_file: result.quarantineFilePath,
    reason: result.reason,
    defect: result.defectId,
    defect_sha: result.defectSha,
    failure_logs: result.failureLogs,
    worktrees_cleaned: result.worktreesCleaned,
    git_restored: result.gitRestored,
    compiler_health: result.compilerHealth,
    next_state: result.nextState,
    ...(asJson ? { json: true } : {}),
  };
}
