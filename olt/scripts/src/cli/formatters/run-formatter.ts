import { enforceLineLimit, formatTable } from "./line-limiter.ts";
import {
  criticRejectNextActions,
  criticReviewNextActions,
  criticStartNextActions,
  nextActionsBlock,
  runCompleteNextActions,
  runExecNextActions,
  runStatusNextActions,
} from "./next-actions/index.ts";

export interface OrchestrateBriefParams {
  readonly runId: string;
  readonly runRoot: string;
  readonly promptSha256: string;
  readonly promptBytes: number;
  readonly runIdWasDerived: boolean;
}

export function formatOrchestrateBrief(params: OrchestrateBriefParams): string {
  const md = [
    `### Orchestration Opened: ${params.runId}`,
    `- **Capsule Root**: \`${params.runRoot}\``,
    `- **Prompt SHA-256**: \`${params.promptSha256}\` (${params.promptBytes.toLocaleString()} bytes, captured verbatim)`,
    params.runIdWasDerived
      ? "- **Run id**: derived from the prompt; pass `--run` next time to choose your own."
      : "- **Run id**: the one you supplied.",
    "- **This skill is now driving.** Stand down the host's own todo/workflow tool for this run;",
    "  every step below is recorded in the capsule instead.",
    "",
    "**Exactly one next step — nothing here is optional and nothing is done for you:**",
    `1. Register and dispatch a single Tier 1 orchestrator (\`--run ${params.runRoot}\`), bound to`,
    "   `roles/orchestrator.md` and `agents/orchestrator.yaml`.",
    "",
    "The orchestrator dispatches exactly one Tier 2 coordinator per round; the coordinator dispatches",
    "the execution subagents. The orchestrator composes the finished report and hands it back.",
    ...nextActionsBlock([
      {
        command: `bun harness.ts agent:register --run ${params.runRoot} --agent orchestrator-1 --role orchestrator --host <HOST>`,
        role: "Orchestrator",
        description: "Register Tier 1 autonomous orchestrator",
      },
    ]),
    "",
    "Tier ladder: `references/host-adapters.md`. Command reference: `references/cli-capabilities.md`.",
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export interface CriticStartParams {
  critic: string;
  token: string;
  tasksSatisfied: number;
  totalTasks: number;
  reqsEvidenced: number;
  totalReqs: number;
  finalGates: readonly string[];
  packetPath?: string;
}

export function formatCriticStartBrief(params: CriticStartParams): string {
  const md = [
    `### Completeness Critic Session Initialized`,
    `- **Critic**: \`${params.critic}\``,
    `- **Critic Token**: \`${params.token}\``,
    `- **Scope Under Review**: ${params.tasksSatisfied}/${params.totalTasks} tasks satisfied | ${params.reqsEvidenced}/${params.totalReqs} requirements evidenced`,
    params.finalGates.length === 0
      ? `- **Mandatory Final Gate**: none declared by this run`
      : `- **Mandatory Final Gate**: ${params.finalGates.map((gate) => `\`${gate}\``).join(", ")}`,
    ...nextActionsBlock(criticStartNextActions(undefined, params.critic, params.token)),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export interface CriticReviewParams {
  critic: string;
  decision: "approve" | "request_changes";
  summary: string;
  token: string;
  runId: string;
  findingId?: string | undefined;
  promptCoverage?: string | undefined;
}

export function formatCriticReviewBrief(params: CriticReviewParams): string {
  const isApproved = params.decision === "approve";
  const lines = [
    `### Completeness Critic Sign-Off: ${isApproved ? "APPROVED" : "CHANGES REQUESTED"}`,
    `- **Critic**: \`${params.critic}\``,
    `- **Summary**: ${params.summary}`,
  ];
  if (isApproved) {
    lines.push(`- **Authorization**: Valid completion certificate issued`);
    if (params.promptCoverage) lines.push(`- **Prompt Coverage**: ${params.promptCoverage}`);
    lines.push(
      `- **Next Step**: Seal run via \`bun harness.ts run:complete --run ${params.runId} --auth-token ${params.token}\``,
    );
  } else {
    if (params.findingId) lines.push(`- **Finding Recorded**: \`${params.findingId}\``);
    lines.push(`- **Next Step**: Dispatch remediation task to resolve identified gap.`);
  }
  lines.push(
    ...nextActionsBlock(
      criticReviewNextActions(params.runId, isApproved, params.token, params.findingId),
    ),
  );
  return enforceLineLimit(lines.join("\n"), 30);
}

export interface CriticRejectParams {
  critic: string;
  token: string;
  runId: string;
  summary: string;
  findingsCount: number;
  findingIds: string[];
}

export function formatCriticRejectBrief(params: CriticRejectParams): string {
  const findingsStr = params.findingIds.map((id) => `\`${id}\``).join(", ") || "None";
  const lines = [
    `### Completeness Critic Sign-Off: CHANGES REQUESTED (Findings Recorded)`,
    `- **Critic**: \`${params.critic}\``,
    `- **Summary**: ${params.summary}`,
    `- **Findings Count**: ${params.findingsCount} (${findingsStr})`,
    `- **Protocol Action**: Read-Only Auditor Invariant enforced. Yielding to Coordinator.`,
    `- **Next Step**: Coordinator runs \`plan:replan\` to partition scopes and inject repair tasks, then \`critic:remediate\` to close this review out once they're proven.`,
    ...nextActionsBlock(criticRejectNextActions(params.runId, params.findingIds[0])),
  ];
  return enforceLineLimit(lines.join("\n"), 30);
}

export interface RunCompleteParams {
  runId: string;
  capsulePath: string;
  tasksCount: number;
  validationsCount: number;
  gatesPassed: number;
  totalGates: number;
  duration?: string | undefined;
  worktreeConsolidation?:
    | {
        branch: string;
        commitCount: number;
        rebased: boolean;
        diffstat: string;
        conflicted: boolean;
      }
    | undefined;
}

export function formatRunCompleteBrief(params: RunCompleteParams): string {
  const durationStr = params.duration ?? "unknown";
  const wt = params.worktreeConsolidation;
  const md = [
    `### 🎉 Run Completed Successfully: ${params.runId}`,
    `- **Capsule**: \`${params.capsulePath}\``,
    `- **Summary**: ${params.tasksCount} tasks executed, ${params.validationsCount} independent validations passed, 1 critic sign-off`,
    `- **Total Gates Verified**: ${params.gatesPassed}/${params.totalGates} gates green`,
    `- **Run Duration**: ${durationStr}`,
    `- **Capsule Status**: Sealed & Auditable`,
    ...(wt === undefined
      ? []
      : wt.conflicted
        ? [
            `- **Worktree Branch**: \`${wt.branch}\` — consolidation STOPPED on a conflict; worktrees left intact for inspection, nothing force-resolved.`,
          ]
        : [
            `- **Worktree Branch**: \`${wt.branch}\` (${wt.commitCount} sub-phase commits, ${wt.diffstat}${wt.rebased ? ", rebased onto the base branch" : ""}) — local only, never pushed. Review and merge, PR, or discard it yourself.`,
          ]),
    ...nextActionsBlock(runCompleteNextActions(params.runId)),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export interface RunStatusTaskItem {
  id: string;
  label: string;
  writeScope: readonly string[];
  status: string;
  agentOrLock: string;
}

export function formatRunStatusBrief(
  runId: string,
  phase: string,
  tasks: readonly RunStatusTaskItem[],
  progressSummary: string,
  catalogueSummary?: string | undefined,
  occupancySummary?: string | undefined,
): string {
  const headers = ["Task ID", "Label", "Write Scope", "Status", "Agent / Lock"];
  const rows = tasks.map((t) => [
    `\`${t.id}\``,
    t.label,
    t.writeScope.map((s) => `\`${s}\``).join(", "),
    t.status,
    t.agentOrLock,
  ]);
  const allSatisfied =
    tasks.length > 0 && tasks.every((t) => t.status.toLowerCase().includes("satisfied"));
  const lines = [
    `### Run Status: ${runId} (Phase: ${phase})`,
    ...formatTable(headers, rows),
    "",
    `**Progress**: ${progressSummary}`,
  ];
  if (occupancySummary !== undefined) lines.push(`**Occupancy**: ${occupancySummary}`);
  if (catalogueSummary !== undefined) lines.push(`**Capsule**: ${catalogueSummary}`);
  lines.push(...nextActionsBlock(runStatusNextActions(runId, phase, allSatisfied)));
  return enforceLineLimit(lines.join("\n"), 30);
}

export interface RunExecParams {
  commandStr: string;
  exitCode: number | null;
  durationSeconds?: number | undefined;
  outputSummary: string;
  evidencePath?: string | undefined;
  logPath?: string | undefined;
}

export function formatRunExecBrief(params: RunExecParams): string {
  const outcome =
    params.exitCode === null ? "Unknown" : params.exitCode === 0 ? "Success" : "Failure";
  const code = params.exitCode === null ? "unknown" : String(params.exitCode);
  const duration =
    params.durationSeconds === undefined ? "unknown" : `${params.durationSeconds.toFixed(2)}s`;
  const lines = [
    `### Command Executed: \`${params.commandStr}\``,
    `- **Exit Code**: \`${code}\` (${outcome}) | **Duration**: ${duration}`,
    `- **Output Summary**: ${params.outputSummary}`,
  ];
  if (params.evidencePath) lines.push(`- **Evidence Recorded**: \`${params.evidencePath}\``);
  if (params.logPath) lines.push(`- **Raw Stream Log**: \`${params.logPath}\``);
  lines.push(
    ...nextActionsBlock(
      runExecNextActions(undefined, params.evidencePath?.split("/").pop()?.replace(".json", "")),
    ),
  );
  return enforceLineLimit(lines.join("\n"), 30);
}
