import { enforceLineLimit } from "../index.ts";
import {
  nextActionsBlock,
  taskProbeNextActions,
  taskRejectNextActions,
  taskReviewPassNextActions,
  validationStartNextActions,
} from "../next-actions/index.ts";
import type {
  TaskProbeParams,
  TaskRejectParams,
  TaskReviewPassParams,
  ValidationStartParams,
} from "./types.ts";

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
    ...(params.minProbes
      ? [
          `- **Before Sign-off**: record ${params.minProbes} adversarial probe(s) with \`task:probe\`; a pass is refused without them.`,
        ]
      : []),
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
    ...(params.probeRounds !== undefined
      ? [`- **Adversarial Probes**: ${params.probeRounds} answered before sign-off`]
      : []),
    `- **Gate Results**: ${params.gateSummary}`,
    `- **Downstream Impact**: ${unblockedStr}`,
    `- **Review Report**: \`${params.reportPath}\``,
    ...nextActionsBlock(taskReviewPassNextActions(undefined, params.unblockedTasks?.[0])),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export function formatTaskRejectBrief(params: TaskRejectParams): string {
  const md = [
    `### Task Rejected: ${params.taskId}`,
    `- **Validator**: \`${params.validator}\` | Verdict: ❌ REJECTED`,
    `- **Finding ID**: \`${params.findingId}\``,
    `- **Issue**: \`${params.issue}\``,
    `- **Action**: Task recorded as \`${params.status}\`.`,
    ...nextActionsBlock(taskRejectNextActions(undefined, params.taskId)),
  ].join("\n");
  return enforceLineLimit(md, 30);
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
