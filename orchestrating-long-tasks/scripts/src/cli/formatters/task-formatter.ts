import { enforceLineLimit } from "./line-limiter.ts";
import {
  nextActionsBlock,
  taskAssignRepairerNextActions,
  taskClaimNextActions,
  taskHeartbeatNextActions,
  taskProbeNextActions,
  taskRejectNextActions,
  taskReviewPassNextActions,
  taskSubmitNextActions,
  validationStartNextActions,
} from "./next-actions.ts";

export interface TaskBriefParams {
  taskId: string;
  label?: string;
  role?: string;
  agent?: string;
  writeScope: readonly string[];
  worktreePath?: string;
  targetFiles?: readonly string[];
  recommendedCommands?: readonly string[];
  gateCommands?: readonly string[];
  acceptanceCriteria?: readonly string[];
  nextSteps?: readonly string[];
}

export function formatTaskBrief(params: TaskBriefParams): string {
  const scopeStr = params.writeScope.map((s) => `\`${s}\``).join(", ") || "`none`";
  const mdLines: string[] = [
    `### 🌌 Zero-Exploration Briefing: ${params.taskId}`,
  ];
  if (params.label) {
    mdLines.push(`- **Label**: ${params.label}`);
  }
  if (params.role || params.agent) {
    const rolePart = params.role ? `Role: \`${params.role}\`` : "";
    const agentPart = params.agent ? `Agent: \`${params.agent}\`` : "";
    const combined = [rolePart, agentPart].filter(Boolean).join(" · ");
    mdLines.push(`- **Assignment**: ${combined}`);
  }
  mdLines.push(`- **Assigned Write Scope**: ${scopeStr}`);
  if (params.worktreePath) {
    mdLines.push(`- **Isolated Worktree**: \`${params.worktreePath}\``);
  }
  if (params.targetFiles && params.targetFiles.length > 0) {
    const filesStr = params.targetFiles.map((f) => `\`${f}\``).join(", ");
    mdLines.push(`- **Suggested Target Files**: ${filesStr}`);
  }
  if (params.recommendedCommands && params.recommendedCommands.length > 0) {
    mdLines.push(`- **Recommended Commands**:`);
    for (const cmd of params.recommendedCommands) {
      mdLines.push(`  - \`${cmd}\``);
    }
  }
  if (params.gateCommands && params.gateCommands.length > 0) {
    mdLines.push(`- **Gate Commands**:`);
    for (const cmd of params.gateCommands) {
      mdLines.push(`  - \`${cmd}\``);
    }
  }
  if (params.acceptanceCriteria && params.acceptanceCriteria.length > 0) {
    mdLines.push(`- **Acceptance Criteria**:`);
    for (const ac of params.acceptanceCriteria) {
      mdLines.push(`  - ${ac}`);
    }
  }
  if (params.nextSteps && params.nextSteps.length > 0) {
    mdLines.push(...nextActionsBlock(params.nextSteps));
  }
  return enforceLineLimit(mdLines.join("\n"), 30);
}

export interface TaskClaimParams {
  taskId: string;
  agent: string;
  token: string;
  durationMinutes: number;
  writeScope: readonly string[];
  packetPath?: string;
  worktreePath?: string | undefined;
  targetFiles?: readonly string[];
  recommendedCommands?: readonly string[];
}

export function formatTaskClaimBrief(params: TaskClaimParams): string {
  const scopeStr = params.writeScope.map((s) => `\`${s}\``).join(", ") || "`none`";
  const md = [
    `### Task Leased: ${params.taskId}`,
    `- **Agent**: \`${params.agent}\``,
    `- **Lease Token**: \`${params.token}\``,
    `- **Duration**: ${params.durationMinutes} minutes`,
    `- **Assigned Write Scope**: ${scopeStr}`,
    ...(params.worktreePath === undefined
      ? []
      : [
          `- **Isolated Worktree**: \`${params.worktreePath}\` — do all editing there, not in the shared repo checkout.`,
        ]),
    ...(params.targetFiles && params.targetFiles.length > 0
      ? [`- **Suggested Target Files**: ${params.targetFiles.map((f) => `\`${f}\``).join(", ")}`]
      : []),
    ...(params.recommendedCommands && params.recommendedCommands.length > 0
      ? [
          `- **Recommended Commands**:`,
          ...params.recommendedCommands.map((cmd) => `  - \`${cmd}\``),
        ]
      : []),
    `- **Note**: Pass \`--token ${params.token}\` to \`task:submit\`.`,
    ...nextActionsBlock(taskClaimNextActions(undefined, params.taskId, params.agent, params.token)),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export interface TaskHeartbeatParams {
  taskId: string;
  agent: string;
  extendedMinutes: number;
  newDeadline: string;
}

export function formatTaskHeartbeatBrief(params: TaskHeartbeatParams): string {
  const md = [
    `### Heartbeat Acknowledged: ${params.taskId}`,
    `- **Agent**: \`${params.agent}\``,
    `- **Lease Extended**: +${params.extendedMinutes} minutes (New Deadline: ${params.newDeadline})`,
    ...nextActionsBlock(taskHeartbeatNextActions(undefined, params.taskId, params.agent)),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export interface TaskSubmitParams {
  taskId: string;
  agent: string;
  filesTouchedCount: number;
  writeScope: readonly string[];
  linesAdded?: number;
  linesRemoved?: number;
  reportPath: string;
}

export function formatTaskSubmitBrief(params: TaskSubmitParams): string {
  const scopeStr = params.writeScope.map((s) => `\`${s}\``).join(", ") || "`none`";
  const diffStats =
    params.linesAdded !== undefined && params.linesRemoved !== undefined
      ? `+${params.linesAdded} lines, -${params.linesRemoved} lines`
      : `${params.filesTouchedCount} files touched`;
  const md = [
    `### Submission Accepted: ${params.taskId}`,
    `- **Agent**: \`${params.agent}\` | Status: \`submitted\``,
    `- **Write Scope Compliance**: Passed (${params.filesTouchedCount} files touched within ${scopeStr})`,
    `- **Diff Stats**: ${diffStats}`,
    `- **Report**: \`${params.reportPath}\``,
    `- **Next Step**: Dispatch independent validator via \`bun harness.ts task:validate-start --run <RUN_ID> --task ${params.taskId} --validator <VALIDATOR_ID>\``,
    ...nextActionsBlock(taskSubmitNextActions(undefined, params.taskId)),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export interface ValidationStartParams {
  taskId: string;
  validator: string;
  token: string;
  gates: readonly string[];
  packetPath?: string;
  minProbes?: number;
  targetFiles?: readonly string[];
  recommendedCommands?: readonly string[];
  writeScope?: readonly string[];
}

export function formatValidationStartBrief(params: ValidationStartParams): string {
  const gateLines = params.gates.map((g, i) => `  ${i + 1}. \`${g}\``);
  const md = [
    `### Validation Leased: ${params.taskId}`,
    `- **Validator**: \`${params.validator}\``,
    `- **Validation Token**: \`${params.token}\``,
    ...(params.writeScope && params.writeScope.length > 0
      ? [`- **Task Write Scope**: ${params.writeScope.map((s) => `\`${s}\``).join(", ")}`]
      : []),
    ...(params.targetFiles && params.targetFiles.length > 0
      ? [`- **Suggested Target Files**: ${params.targetFiles.map((f) => `\`${f}\``).join(", ")}`]
      : []),
    `- **Mandatory Gates to Run**:${gateLines.length === 0 ? " none recorded for this task" : ""}`,
    ...gateLines,
    ...(params.recommendedCommands && params.recommendedCommands.length > 0
      ? [
          `- **Recommended Commands**:`,
          ...params.recommendedCommands.map((cmd) => `  - \`${cmd}\``),
        ]
      : []),
    ...(params.minProbes === undefined || params.minProbes === 0
      ? []
      : [
          `- **Before Sign-off**: record ${params.minProbes} adversarial probe(s) with \`task:probe\`; a pass is refused without them.`,
        ]),
    ...nextActionsBlock(
      validationStartNextActions(
        undefined,
        params.taskId,
        params.validator,
        params.token,
        params.minProbes,
      ),
    ),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export interface TaskReviewPassParams {
  taskId: string;
  validator: string;
  gateSummary: string;
  unblockedTasks?: readonly string[];
  reportPath: string;
  probeRounds?: number;
  taskStatus: string;
  outstandingDomains?: readonly string[];
}

export function formatTaskReviewPassBrief(params: TaskReviewPassParams): string {
  const unblockedStr =
    params.unblockedTasks && params.unblockedTasks.length > 0
      ? `Unblocked ${params.unblockedTasks.map((t) => `\`${t}\``).join(", ")} in queue`
      : "None";
  const satisfied = params.taskStatus !== "validating";
  const heading = satisfied
    ? `### Task Validated & Satisfied: ${params.taskId}`
    : `### Domain Passed, Task Still ${params.taskStatus}: ${params.taskId}`;
  const md = [
    heading,
    `- **Validator**: \`${params.validator}\` | Verdict: ✅ PASS`,
    ...(!satisfied && params.outstandingDomains && params.outstandingDomains.length > 0
      ? [
          `- **Outstanding Domains**: ${params.outstandingDomains.join(", ")} still need an independent pass before ${params.taskId} is validated`,
        ]
      : []),
    ...(params.probeRounds === undefined
      ? []
      : [`- **Adversarial Probes**: ${params.probeRounds} answered before sign-off`]),
    `- **Gate Results**: ${params.gateSummary}`,
    `- **Downstream Impact**: ${unblockedStr}`,
    `- **Review Report**: \`${params.reportPath}\``,
    ...nextActionsBlock(taskReviewPassNextActions(undefined, params.unblockedTasks?.[0])),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export interface TaskRejectParams {
  taskId: string;
  validator: string;
  findingId: string;
  issue: string;
  status: string;
}

export function formatTaskRejectBrief(params: TaskRejectParams): string {
  const actionStr = `Task recorded as \`${params.status}\`.`;
  const md = [
    `### Task Rejected: ${params.taskId}`,
    `- **Validator**: \`${params.validator}\` | Verdict: ❌ REJECTED`,
    `- **Finding ID**: \`${params.findingId}\``,
    `- **Issue**: \`${params.issue}\``,
    `- **Action**: ${actionStr}`,
    ...nextActionsBlock(taskRejectNextActions(undefined, params.taskId)),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export interface TaskProbeParams {
  taskId: string;
  validator: string;
  round: number;
  demands: readonly { id: string; demand: string }[];
  repairRound: number;
  warning?: string | undefined;
}

export function formatTaskProbeBrief(params: TaskProbeParams): string {
  const demandLines = params.demands.map((d) => `  - \`${d.id}\`: ${d.demand}`);
  const md = [
    `### Adversarial Probe Recorded: ${params.taskId}`,
    `- **Validator**: \`${params.validator}\` | Verdict: 🔎 PROBE (Round ${params.round})`,
    `- **Nature**: Demand for proof, not a defect. Repair round stays ${params.repairRound}.`,
    `- **Demands**:`,
    ...demandLines,
    ...(params.warning ? [`- **Config Warning**: ${params.warning}`] : []),
    `- **Next Step**: Answer every demand with command evidence, then \`task:review --status pass\`, or \`task:reject\` if a demand fails.`,
    ...nextActionsBlock(taskProbeNextActions(undefined, params.taskId, params.validator)),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export interface TaskAssignRepairerParams {
  taskId: string;
  replacementId: string;
  reason: string;
  evidence: string;
}

export function formatTaskAssignRepairerBrief(params: TaskAssignRepairerParams): string {
  const md = [
    `### Repairer Reassigned: ${params.taskId}`,
    `- **Replacement**: \`${params.replacementId}\``,
    `- **Reason**: ${params.reason}`,
    `- **Evidence**: ${params.evidence}`,
    `- **Next Step**: \`${params.replacementId}\` claims with \`task:claim --role repairer\`.`,
    ...nextActionsBlock(
      taskAssignRepairerNextActions(undefined, params.taskId, params.replacementId),
    ),
  ].join("\n");
  return enforceLineLimit(md, 30);
}
