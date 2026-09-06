import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { executePreActionHook, executePostActionHook, executeTurnEndHook } from "./hooks.ts";
import { getProfileForRole } from "./profiles/index.ts";
import { getStrikeRecord, renderMarkdownRemediationBrief } from "./strike-ladder.ts";
import {
  isCanonicalRole,
  type AgentRole,
  type DoctorAgentReport,
  type EvaluationContext,
  type PreActionResult,
  type PostActionResult,
  type SentinelViolation,
  type TurnEndResult,
} from "./types.ts";

export interface DoctorAgentOptions {
  readonly role: AgentRole;
  readonly agentId: string;
  readonly taskId?: string | undefined;
  readonly runRoot?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly format?: ("json" | "markdown") | undefined;
  readonly modifiedFiles?: readonly string[] | undefined;
  readonly executedCommands?: readonly string[] | undefined;
  readonly probeCount?: number | undefined;
  readonly probe_count?: number | undefined;
  readonly action?: string | undefined;
}

export function runDoctorAgent(options: DoctorAgentOptions): DoctorAgentReport {
  const profile = getProfileForRole(options.role);
  const evalContext: EvaluationContext = {
    agent_id: options.agentId,
    role: options.role,
    task_id: options.taskId,
    run_root: options.runRoot,
    repo_root: options.repoRoot,
    modified_files: options.modifiedFiles,
    executed_commands: options.executedCommands,
    probe_count: options.probeCount !== undefined ? options.probeCount : options.probe_count,
    action: options.action,
  };

  const violations = profile.evaluate(evalContext);
  const strike = getStrikeRecord(options.agentId, options.repoRoot);

  return {
    status: violations.length === 0 ? "HEALTHY" : "VIOLATION_DETECTED",
    agent_id: options.agentId,
    role: options.role,
    task_id: options.taskId,
    strike_count: strike?.strike_count ?? (violations.length > 0 ? 1 : 0),
    violations,
  };
}

export function formatDoctorAgentMarkdown(report: DoctorAgentReport): string {
  if (report.status === "HEALTHY") {
    return `### ✅ [DOCTOR:AGENT - HEALTHY]\n\n- **Agent:** \`${report.agent_id}\`\n- **Role:** \`${report.role}\`\n- **Status:** All role invariants satisfied. Zero violations detected.`;
  }

  return renderMarkdownRemediationBrief(
    report.agent_id,
    report.role,
    report.strike_count,
    report.violations,
  );
}

export interface SentinelWatchOptions {
  readonly agentId: string;
  readonly role: AgentRole;
  readonly taskId?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly intervalMs?: number | undefined;
  readonly maxIterations?: number | undefined;
}

export interface SentinelWatchResult {
  readonly completedIterations: number;
  readonly status: "HEALTHY" | "VIOLATION_DETECTED";
  readonly strikeCount: number;
  readonly violations: readonly SentinelViolation[];
}

export async function runSentinelWatch(
  options: SentinelWatchOptions,
): Promise<SentinelWatchResult> {
  const repo = options.repoRoot ? resolve(options.repoRoot) : process.cwd();
  const max = options.maxIterations ?? 1;
  let currentStatus: "HEALTHY" | "VIOLATION_DETECTED" = "HEALTHY";
  let strikeCount = 0;
  let activeViolations: readonly SentinelViolation[] = [];

  for (let i = 0; i < max; i++) {
    const report = runDoctorAgent({
      agentId: options.agentId,
      role: options.role,
      taskId: options.taskId,
      repoRoot: repo,
    });

    currentStatus = report.status;
    strikeCount = report.strike_count;
    activeViolations = report.violations;

    if (report.status === "VIOLATION_DETECTED") {
      executeTurnEndHook({
        agent_id: options.agentId,
        role: options.role,
        task_id: options.taskId,
        repo_root: repo,
      });
      break;
    }

    if (options.intervalMs && options.intervalMs > 0 && i < max - 1) {
      await new Promise((resolveSleep) => setTimeout(resolveSleep, options.intervalMs));
    }
  }

  return {
    completedIterations: max,
    status: currentStatus,
    strikeCount,
    violations: activeViolations,
  };
}
