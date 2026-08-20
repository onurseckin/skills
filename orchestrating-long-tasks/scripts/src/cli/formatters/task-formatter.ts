import { enforceLineLimit } from "./line-limiter.ts";

export interface TaskClaimParams {
  taskId: string;
  agent: string;
  token: string;
  durationMinutes: number;
  writeScope: readonly string[];
  packetPath?: string;
  /** B22.2's assignment reaching the claiming agent: absent means worktree isolation is off for
   *  this run, never an unassigned slot under isolation (provisioning covers every task). */
  worktreePath?: string | undefined;
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
    `- **Note**: Pass \`--token ${params.token}\` to \`task:submit\`.`,
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
}

export function formatValidationStartBrief(params: ValidationStartParams): string {
  const gateLines = params.gates.map((g, i) => `  ${i + 1}. \`${g}\``);
  const md = [
    `### Validation Leased: ${params.taskId}`,
    `- **Validator**: \`${params.validator}\``,
    `- **Validation Token**: \`${params.token}\``,
    `- **Mandatory Gates to Run**:${gateLines.length === 0 ? " none recorded for this task" : ""}`,
    ...gateLines,
    ...(params.minProbes === undefined || params.minProbes === 0
      ? []
      : [
          `- **Before Sign-off**: record ${params.minProbes} adversarial probe(s) with \`task:probe\`; a pass is refused without them.`,
        ]),
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
  /**
   * The task's real status after this verdict was recorded. B12.2: `recordReview` only moves a task
   * out of `validating` once every applicable domain has its own pass on record (see
   * `everyApplicableDomainPassed`) — a pass verdict that leaves the task still `validating` means at
   * least one other domain is still open, and the heading must say that rather than the unqualified
   * "Validated & Satisfied" claim, which was true unconditionally back when a task carried at most
   * one validator. Any other status (`validated`, `gating`, `done`) means this verdict was the one
   * that cleared the last open domain.
   */
  taskStatus: string;
  /** Domains still without a recorded pass once this verdict lands. Omitted or empty once
   *  `taskStatus` has moved past `validating`. */
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
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export interface TaskRejectParams {
  taskId: string;
  validator: string;
  findingId: string;
  issue: string;
  /** The status the transaction actually left the task in, e.g. changes_requested or escalated. */
  status: string;
}

export function formatTaskRejectBrief(params: TaskRejectParams): string {
  // The brief quotes the recorded status. "Returned to queue" was a sentence about a state the
  // task may never have reached: an exhausted repair budget escalates instead.
  const actionStr = `Task recorded as \`${params.status}\`.`;
  const md = [
    `### Task Rejected: ${params.taskId}`,
    `- **Validator**: \`${params.validator}\` | Verdict: ❌ REJECTED`,
    `- **Finding ID**: \`${params.findingId}\``,
    `- **Issue**: \`${params.issue}\``,
    `- **Action**: ${actionStr}`,
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
  ].join("\n");
  return enforceLineLimit(md, 30);
}
