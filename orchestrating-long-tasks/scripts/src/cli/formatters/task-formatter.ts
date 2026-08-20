import { enforceLineLimit } from "./line-limiter.ts";

export interface TaskClaimParams {
  taskId: string;
  agent: string;
  token: string;
  durationMinutes: number;
  writeScope: readonly string[];
  packetPath?: string;
}

export function formatTaskClaimBrief(params: TaskClaimParams): string {
  const scopeStr = params.writeScope.map((s) => `\`${s}\``).join(", ") || "`none`";
  const md = [
    `### Task Leased: ${params.taskId}`,
    `- **Agent**: \`${params.agent}\``,
    `- **Lease Token**: \`${params.token}\``,
    `- **Duration**: ${params.durationMinutes} minutes`,
    `- **Assigned Write Scope**: ${scopeStr}`,
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
}

export function formatTaskReviewPassBrief(params: TaskReviewPassParams): string {
  const unblockedStr =
    params.unblockedTasks && params.unblockedTasks.length > 0
      ? `Unblocked ${params.unblockedTasks.map((t) => `\`${t}\``).join(", ")} in queue`
      : "None";
  const md = [
    `### Task Validated & Satisfied: ${params.taskId}`,
    `- **Validator**: \`${params.validator}\` | Verdict: ✅ PASS`,
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
