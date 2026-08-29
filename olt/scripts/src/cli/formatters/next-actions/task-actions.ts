import type { NextActionItem } from "./types.ts";

export function taskClaimNextActions(
  run?: string,
  taskId?: string,
  agent?: string,
  token?: string,
): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  const tArg = taskId ? ` --task ${taskId}` : "";
  const aArg = agent ? ` --agent ${agent}` : "";
  const tokArg = token ? ` --token ${token}` : "";
  return [
    {
      command: `bun harness.ts task:heartbeat${runArg}${tArg}${aArg}${tokArg}`,
      role: "Implementer",
      description: "Extend lease deadline during active implementation",
    },
    {
      command: `bun harness.ts task:submit${runArg}${tArg}${aArg}${tokArg} --summary "<WHAT_CHANGED>"`,
      role: "Implementer",
      description: "Submit completed task for independent validation",
    },
  ];
}

export function taskHeartbeatNextActions(
  run?: string,
  taskId?: string,
  agent?: string,
  token?: string,
): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  const tArg = taskId ? ` --task ${taskId}` : "";
  const aArg = agent ? ` --agent ${agent}` : "";
  const tokArg = token ? ` --token ${token}` : " --token <TOKEN>";
  return [
    {
      command: `bun harness.ts task:submit${runArg}${tArg}${aArg}${tokArg} --summary "<WHAT_CHANGED>"`,
      role: "Implementer",
      description: "Submit completed task when changes pass mandatory gates",
    },
  ];
}

export function taskSubmitNextActions(run?: string, taskId?: string): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  const tArg = taskId ? ` --task ${taskId}` : "";
  return [
    {
      command: `bun harness.ts task:validate-start${runArg}${tArg} --validator <VALIDATOR>`,
      role: "Validator",
      description: "Open independent validation session",
    },
    {
      command: `bun harness.ts queue:next${runArg}`,
      role: "Implementer",
      description: "Claim next available task in queue",
    },
  ];
}

export function validationStartNextActions(
  run?: string,
  taskId?: string,
  validator?: string,
  token?: string,
  minProbes?: number,
): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  const tArg = taskId ? ` --task ${taskId}` : "";
  const vArg = validator ? ` --validator ${validator}` : "";
  const tokArg = token ? ` --token ${token}` : "";
  const actions: NextActionItem[] = [];
  if (minProbes !== undefined && minProbes > 0) {
    actions.push({
      command: `bun harness.ts task:probe${runArg}${tArg}${vArg}${tokArg} --demand "<WHAT_TO_PROVE>"`,
      role: "Validator",
      description: "Issue probe demand before sign-off",
    });
  }
  actions.push(
    {
      command: `bun harness.ts task:review${runArg}${tArg}${vArg}${tokArg} --status pass`,
      role: "Validator",
      description: "Sign off and satisfy task once gates pass",
    },
    {
      command: `bun harness.ts task:reject${runArg}${tArg}${vArg}${tokArg} --remediation "<DEFECT_DETAILS>"`,
      role: "Validator",
      description: "Reject task and route for repair on failure",
    },
  );
  return actions;
}

export function taskReviewPassNextActions(
  run?: string,
  unblockedTaskId?: string,
): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  const nextCmd = unblockedTaskId
    ? `bun harness.ts task:claim${runArg} --task ${unblockedTaskId} --agent <AGENT> --role implementer`
    : `bun harness.ts queue:next${runArg}`;
  return [
    {
      command: nextCmd,
      role: "Implementer",
      description: "Claim newly unblocked downstream task",
    },
    {
      command: `bun harness.ts run:status${runArg}`,
      role: "Orchestrator",
      description: "Inspect overall run progress",
    },
  ];
}

export function taskRejectNextActions(run?: string, taskId?: string): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  const tArg = taskId ? ` --task ${taskId}` : "";
  return [
    {
      command: `bun harness.ts task:claim${runArg}${tArg} --agent <REPAIRER> --role repairer`,
      role: "Repairer",
      description: "Claim task in repair mode",
    },
    {
      command: `bun harness.ts task:assign-repairer${runArg}${tArg} --replacement <AGENT> --reason repeated_failure`,
      role: "Coordinator",
      description: "Reassign stuck task to alternate repairer if needed",
    },
  ];
}

export function taskProbeNextActions(
  run?: string,
  taskId?: string,
  validator?: string,
  token?: string,
): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  const tArg = taskId ? ` --task ${taskId}` : "";
  const vArg = validator ? ` --validator ${validator}` : "";
  const tokArg = token ? ` --token ${token}` : " --token <TOKEN>";
  return [
    {
      command: `bun harness.ts run:exec${runArg}${tArg} --actor <ACTOR> -- <COMMAND>`,
      role: "Implementer",
      description: "Execute gate/probe command to generate verifiable evidence",
    },
    {
      command: `bun harness.ts task:review${runArg}${tArg}${vArg}${tokArg} --status pass`,
      role: "Validator",
      description: "Sign off once all probe demands are answered",
    },
  ];
}

export function taskAssignRepairerNextActions(
  run?: string,
  taskId?: string,
  replacementId?: string,
): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  const tArg = taskId ? ` --task ${taskId}` : "";
  const rArg = replacementId ? ` --agent ${replacementId}` : " --agent <REPAIRER>";
  return [
    {
      command: `bun harness.ts task:claim${runArg}${tArg}${rArg} --role repairer`,
      role: "Repairer",
      description: "Claim task under assigned repair lease",
    },
  ];
}
