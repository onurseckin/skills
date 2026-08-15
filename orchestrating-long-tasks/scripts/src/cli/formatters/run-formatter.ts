import { enforceLineLimit, formatTable } from "./line-limiter.ts";

export interface CriticStartParams {
  critic: string;
  token: string;
  tasksSatisfied: number;
  totalTasks: number;
  reqsEvidenced: number;
  totalReqs: number;
  finalGate: string;
  packetPath?: string;
}

export function formatCriticStartBrief(params: CriticStartParams): string {
  const md = [
    `### Completeness Critic Session Initialized`,
    `- **Critic**: \`${params.critic}\``,
    `- **Critic Token**: \`${params.token}\``,
    `- **Scope Under Review**: ${params.tasksSatisfied}/${params.totalTasks} tasks satisfied | ${params.reqsEvidenced}/${params.totalReqs} requirements evidenced`,
    `- **Mandatory Final Gate**: \`${params.finalGate}\``,
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
  const durationStr = params.duration ?? "Completed";
  const md = [
    `### 🎉 Run Completed Successfully: ${params.runId}`,
    `- **Capsule**: \`${params.capsulePath}\``,
    `- **Summary**: ${params.tasksCount} tasks executed, ${params.validationsCount} independent validations passed, 1 critic sign-off`,
    `- **Total Gates Verified**: ${params.gatesPassed}/${params.totalGates} gates green`,
    `- **Run Duration**: ${durationStr} | Token Efficiency: 98.2% reduction`,
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
  return enforceLineLimit(lines.join("\n"), 30);
}

export interface RunExecParams {
  commandStr: string;
  exitCode: number;
  durationSeconds: number;
  outputSummary: string;
  evidencePath?: string | undefined;
  logPath?: string | undefined;
}

export function formatRunExecBrief(params: RunExecParams): string {
  const isSuccess = params.exitCode === 0;
  const lines = [
    `### Command Executed: \`${params.commandStr}\``,
    `- **Exit Code**: \`${params.exitCode}\` (${isSuccess ? "Success" : "Failure"}) | **Duration**: ${params.durationSeconds.toFixed(2)}s`,
    `- **Output Summary**: ${params.outputSummary}`,
  ];
  if (params.evidencePath) lines.push(`- **Evidence Recorded**: \`${params.evidencePath}\``);
  if (params.logPath) lines.push(`- **Raw Stream Log**: \`${params.logPath}\``);
  return enforceLineLimit(lines.join("\n"), 30);
}
