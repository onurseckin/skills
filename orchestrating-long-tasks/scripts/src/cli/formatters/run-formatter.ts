import { enforceLineLimit, formatTable } from "./line-limiter.ts";

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
    // An empty list is stated as such: the run declares no mandatory run gate, which is a fact
    // the critic needs, not a gate command to be guessed at.
    params.finalGates.length === 0
      ? `- **Mandatory Final Gate**: none declared by this run`
      : `- **Mandatory Final Gate**: ${params.finalGates.map((gate) => `\`${gate}\``).join(", ")}`,
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
}

export function formatRunCompleteBrief(params: RunCompleteParams): string {
  // No duration is recorded unless the caller measured one; the brief says so rather than
  // printing a number nothing observed.
  const durationStr = params.duration ?? "unknown";
  const md = [
    `### 🎉 Run Completed Successfully: ${params.runId}`,
    `- **Capsule**: \`${params.capsulePath}\``,
    `- **Summary**: ${params.tasksCount} tasks executed, ${params.validationsCount} independent validations passed, 1 critic sign-off`,
    `- **Total Gates Verified**: ${params.gatesPassed}/${params.totalGates} gates green`,
    `- **Run Duration**: ${durationStr}`,
    `- **Capsule Status**: Sealed & Auditable`,
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
  /** Live lanes in use against the occupancy ceiling (B24.4) — absent only for an older caller. */
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
  const lines = [
    `### Run Status: ${runId} (Phase: ${phase})`,
    ...formatTable(headers, rows),
    "",
    `**Progress**: ${progressSummary}`,
  ];
  if (occupancySummary !== undefined) lines.push(`**Occupancy**: ${occupancySummary}`);
  if (catalogueSummary !== undefined) lines.push(`**Capsule**: ${catalogueSummary}`);
  return enforceLineLimit(lines.join("\n"), 30);
}

export interface RunExecParams {
  commandStr: string;
  /** null when the runner never collected one; an uncollected code is not a success. */
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
  return enforceLineLimit(lines.join("\n"), 30);
}
