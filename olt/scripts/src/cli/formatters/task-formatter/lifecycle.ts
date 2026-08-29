import { enforceLineLimit } from "../index.ts";
import {
  nextActionsBlock,
  taskAssignRepairerNextActions,
  taskClaimNextActions,
  taskHeartbeatNextActions,
  taskSubmitNextActions,
} from "../next-actions/index.ts";
import type {
  TaskAssignRepairerParams,
  TaskClaimParams,
  TaskHeartbeatParams,
  TaskSubmitParams,
} from "./types.ts";

export function formatTaskClaimBrief(params: TaskClaimParams): string {
  const scopeStr = params.writeScope.map((s) => `\`${s}\``).join(", ") || "`none`";
  const md = [
    `### Task Leased: ${params.taskId}`,
    `- **Agent**: \`${params.agent}\``,
    `- **Lease Token**: \`${params.token}\``,
    `- **Duration**: ${params.durationMinutes} minutes`,
    `- **Assigned Write Scope**: ${scopeStr}`,
    ...(params.worktreePath
      ? [
          `- **Isolated Worktree**: \`${params.worktreePath}\` — do all editing there, not in the shared repo checkout.`,
        ]
      : []),
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

export function formatTaskHeartbeatBrief(params: TaskHeartbeatParams): string {
  const md = [
    `### Heartbeat Acknowledged: ${params.taskId}`,
    `- **Agent**: \`${params.agent}\``,
    `- **Lease Extended**: +${params.extendedMinutes} minutes (New Deadline: ${params.newDeadline})`,
    ...nextActionsBlock(taskHeartbeatNextActions(undefined, params.taskId, params.agent)),
  ].join("\n");
  return enforceLineLimit(md, 30);
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
