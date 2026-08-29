import { taskClaimNextActions } from "./task-actions.ts";
import type { NextActionItem } from "./types.ts";

export function queueNextNextActions(run: string, taskId: string): NextActionItem[] {
  return [
    {
      command: `bun harness.ts task:claim --run ${run} --task ${taskId} --agent <AGENT_ID> --role implementer`,
      role: "Implementer",
      description: "Claim and lease this ready task",
    },
    {
      command: `bun harness.ts queue:wave --run ${run}`,
      role: "Coordinator",
      description: "Inspect full parallel wave",
    },
  ];
}

export function queueEmptyNextActions(run: string): NextActionItem[] {
  return [
    {
      command: `bun harness.ts run:status --run ${run}`,
      role: "Orchestrator",
      description: "Inspect active leases and validating lanes",
    },
    {
      command: `bun harness.ts critic:start --run ${run} --critic critic-1`,
      role: "Critic",
      description: "Initialize completeness critic if all tasks satisfied",
    },
  ];
}

export function queueWaveNextActions(run: string, firstTaskId?: string): NextActionItem[] {
  const taskArg = firstTaskId ?? "<TASK_ID>";
  return [
    {
      command: `bun harness.ts task:claim --run ${run} --task ${taskArg} --agent <AGENT_ID> --role implementer`,
      role: "Implementer",
      description: "Claim first task in ready wave",
    },
    {
      command: `bun harness.ts run:status --run ${run}`,
      role: "Orchestrator",
      description: "Monitor active concurrency and lease occupancy",
    },
  ];
}

export function queueListNextActions(run?: string): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  return [
    {
      command: `bun harness.ts queue:wave${runArg}`,
      role: "Coordinator",
      description: "Dispatch ready conflict-free wave",
    },
    {
      command: `bun harness.ts run:status${runArg}`,
      role: "Orchestrator",
      description: "Inspect overall run occupancy and progress",
    },
  ];
}

export function queuePopNextActions(
  run?: string,
  taskId?: string,
  agent?: string,
  token?: string,
): NextActionItem[] {
  return taskClaimNextActions(run, taskId, agent, token);
}

export function criticStartNextActions(
  run?: string,
  critic?: string,
  token?: string,
): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  const cArg = critic ? ` --critic ${critic}` : "";
  const tokArg = token ? ` --token ${token}` : "";
  return [
    {
      command: `bun harness.ts critic:review${runArg}${cArg}${tokArg} --decision approve --summary "<SUMMARY>"`,
      role: "Critic",
      description: "Issue completion sign-off certificate",
    },
    {
      command: `bun harness.ts critic:review${runArg}${cArg}${tokArg} --decision request_changes --findings <FINDINGS_JSON> --summary "<SUMMARY>"`,
      role: "Critic",
      description: "Request remediation changes with structured findings",
    },
  ];
}

export function criticReviewNextActions(
  run: string,
  approved: boolean,
  token?: string,
  findingId?: string,
): NextActionItem[] {
  if (approved) {
    const tokArg = token ? ` --auth-token ${token}` : "";
    return [
      {
        command: `bun harness.ts run:complete --run ${run}${tokArg}`,
        role: "Orchestrator",
        description: "Seal capsule and finalize run",
      },
    ];
  }
  const fArg = findingId ? ` --findings ${findingId}` : "";
  return [
    {
      command: `bun harness.ts plan:replan --run ${run}${fArg}`,
      role: "Coordinator",
      description: "Partition scopes and inject repair tasks",
    },
    {
      command: `bun harness.ts critic:remediate --run ${run} --finding ${findingId ?? "<FINDING_ID>"} --evidence <EVIDENCE>`,
      role: "Repairer",
      description: "Record proof closing out critic finding",
    },
  ];
}

export function criticRejectNextActions(run: string, findingId?: string): NextActionItem[] {
  return [
    {
      command: `bun harness.ts plan:replan --run ${run}${findingId ? ` --findings ${findingId}` : ""}`,
      role: "Coordinator",
      description: "Replan and inject repair tasks",
    },
    {
      command: `bun harness.ts critic:remediate --run ${run} --finding ${findingId ?? "<FINDING_ID>"} --evidence <EVIDENCE>`,
      role: "Repairer",
      description: "Prove remediation once repairs finish",
    },
  ];
}

export function runCompleteNextActions(run: string): NextActionItem[] {
  return [
    {
      command: `bun harness.ts report:unified --run ${run}`,
      role: "Orchestrator",
      description: "View full run audit and evidence report",
    },
    {
      command: `git log -1`,
      role: "Human",
      description: "Review finalized worktree commit",
    },
  ];
}

export function runStatusNextActions(
  run: string,
  phase = "Executing",
  allSatisfied = false,
): NextActionItem[] {
  if (phase === "Completed") {
    return runCompleteNextActions(run);
  }
  if (allSatisfied) {
    return [
      {
        command: `bun harness.ts critic:start --run ${run} --critic critic-1`,
        role: "Critic",
        description: "Initialize completeness critic review session",
      },
      {
        command: `bun harness.ts report:unified --run ${run}`,
        role: "Orchestrator",
        description: "Review run report and evidence tally",
      },
    ];
  }
  return [
    {
      command: `bun harness.ts queue:wave --run ${run}`,
      role: "Coordinator",
      description: "Dispatch next wave of eligible tasks",
    },
    {
      command: `bun harness.ts queue:next --run ${run}`,
      role: "Implementer",
      description: "Claim next ready task in queue",
    },
  ];
}

export function runExecNextActions(run?: string, commandId?: string): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  const evArg = commandId ? ` --command ${commandId}` : "";
  return [
    {
      command: `bun harness.ts evidence:get${runArg}${evArg}`,
      role: "Validator",
      description: "Inspect durable command evidence record",
    },
    {
      command: `bun harness.ts run:status${runArg}`,
      role: "Orchestrator",
      description: "Check execution status and active tasks",
    },
  ];
}

export function agentRegisterNextActions(run: string, agentId: string): NextActionItem[] {
  return [
    {
      command: `bun harness.ts queue:next --run ${run}`,
      role: "Agent",
      description: "Check queue for claimable tasks",
    },
    {
      command: `bun harness.ts agent:release --run ${run} --agent ${agentId} --reason "<WHY>"`,
      role: "Coordinator",
      description: "Release agent grant upon completion",
    },
  ];
}

export function agentListNextActions(run: string): NextActionItem[] {
  return [
    {
      command: `bun harness.ts agent:register --run ${run} --agent <AGENT_ID> --role <ROLE> --host <HOST>`,
      role: "Coordinator",
      description: "Register new agent grant",
    },
    {
      command: `bun harness.ts run:status --run ${run}`,
      role: "Orchestrator",
      description: "Inspect active lanes and lease status",
    },
  ];
}
