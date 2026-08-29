import type { NextActionItem } from "./types.ts";

export function planInitNextActions(run: string): NextActionItem[] {
  return [
    {
      command: `bun harness.ts plan:enhance --run ${run}`,
      role: "Planner",
      description: "Review prompt and build structured enhanced plan",
    },
    {
      command: `bun harness.ts plan:add --run ${run} --id <TASK_ID> --scope <SCOPE> --gate "<GATE>"`,
      role: "Planner",
      description: "Declare decomposed task obligations",
    },
  ];
}

export function orchestrateNextActions(run: string): NextActionItem[] {
  return [
    {
      command: `bun harness.ts agent:register --run ${run} --agent orchestrator-1 --role orchestrator --host <HOST>`,
      role: "Orchestrator",
      description: "Register Tier 1 autonomous orchestrator",
    },
    {
      command: `bun harness.ts plan:enhance --run ${run}`,
      role: "Planner",
      description: "Synthesize structured plan from prompt",
    },
    {
      command: `bun harness.ts queue:wave --run ${run}`,
      role: "Coordinator",
      description: "Inspect and dispatch claimable wave",
    },
  ];
}

export function taskRegisteredNextActions(run?: string): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  return [
    {
      command: `bun harness.ts plan:add${runArg} --id <NEXT_ID> --scope <SCOPE> --gate "<GATE>"`,
      role: "Planner",
      description: "Register additional task in planning buffer",
    },
    {
      command: `bun harness.ts plan:compile${runArg}`,
      role: "Planner",
      description: "Compile and seal graph topology once all tasks added",
    },
  ];
}

export function planEnhanceNextActions(run: string): NextActionItem[] {
  return [
    {
      command: `bun harness.ts plan:add --run ${run} --id task-1 --scope <PATH> --gate "<GATE>" --requirement-lines 1,2`,
      role: "Planner",
      description: "Declare mapped tasks bound to prompt lines",
    },
    {
      command: `bun harness.ts plan:compile --run ${run}`,
      role: "Planner",
      description: "Compile and seal DAG topology",
    },
  ];
}

export function planCompileNextActions(run: string, hasWaves = true): NextActionItem[] {
  if (!hasWaves) {
    return [
      {
        command: `bun harness.ts plan:add --run ${run} --id <TASK_ID> --scope <SCOPE> --gate "<GATE>"`,
        role: "Planner",
        description: "Add tasks to unblock scheduler topology",
      },
      {
        command: `bun harness.ts plan:compile --run ${run}`,
        role: "Planner",
        description: "Recompile plan DAG",
      },
    ];
  }
  return [
    {
      command: `bun harness.ts plan:validate-start --run ${run} --validator val-1`,
      role: "Plan-Validator",
      description: "Open independent plan review session",
    },
    {
      command: `bun harness.ts queue:wave --run ${run}`,
      role: "Coordinator",
      description: "Inspect and dispatch ready wave to implementers",
    },
  ];
}

export function planStatusNextActions(run: string, isCompiled: boolean): NextActionItem[] {
  if (isCompiled) {
    return [
      {
        command: `bun harness.ts queue:next --run ${run}`,
        role: "Implementer",
        description: "Claim next available task in queue",
      },
      {
        command: `bun harness.ts run:status --run ${run}`,
        role: "Orchestrator",
        description: "Monitor active execution lanes",
      },
    ];
  }
  return [
    {
      command: `bun harness.ts plan:compile --run ${run}`,
      role: "Planner",
      description: "Compile and seal planning buffer into DAG",
    },
    {
      command: `bun harness.ts plan:add --run ${run} --id <ID> --scope <SCOPE> --gate "<GATE>"`,
      role: "Planner",
      description: "Add more tasks to buffer",
    },
  ];
}

export function planReplanNextActions(run: string, repairTaskId?: string): NextActionItem[] {
  const taskArg = repairTaskId ?? "<TASK_ID>";
  return [
    {
      command: `bun harness.ts queue:wave --run ${run}`,
      role: "Coordinator",
      description: "Dispatch parallel batch repair wave",
    },
    {
      command: `bun harness.ts task:claim --run ${run} --task ${taskArg} --agent <REPAIRER> --role repairer`,
      role: "Repairer",
      description: "Claim repair task under isolated scope",
    },
  ];
}

export function planClaimNextActions(run: string, expectedRevision?: number): NextActionItem[] {
  const revArg = expectedRevision !== undefined ? ` --expected-revision ${expectedRevision}` : "";
  return [
    {
      command: `bun harness.ts plan:apply --run ${run}${revArg}`,
      role: "Planner",
      description: "Apply written requirements and graph to capsule",
    },
  ];
}

export function planApplyNextActions(run: string): NextActionItem[] {
  return [
    {
      command: `bun harness.ts plan:validate-start --run ${run} --validator val-1`,
      role: "Plan-Validator",
      description: "Open independent plan review",
    },
    {
      command: `bun harness.ts queue:wave --run ${run}`,
      role: "Coordinator",
      description: "Inspect and dispatch claimable tasks",
    },
  ];
}

export function planAuditNextActions(
  run: string,
  hasBlockingFindings: boolean,
  blockingInvariant?: string,
): NextActionItem[] {
  if (hasBlockingFindings) {
    const inv = blockingInvariant ?? "<INVARIANT>";
    return [
      {
        command: `bun harness.ts plan:compile --run ${run} --accept-audit ${inv}:"<REASON>"`,
        role: "Planner",
        description: "Seal plan by accepting audit invariant override",
      },
      {
        command: `bun harness.ts plan:add --run ${run} --id <ID> --scope <SCOPE> --gate "<GATE>"`,
        role: "Planner",
        description: "Modify task declarations to satisfy audit rules",
      },
    ];
  }
  return [
    {
      command: `bun harness.ts plan:compile --run ${run}`,
      role: "Planner",
      description: "Seal planning buffer into DAG (no blocking invariants outstanding)",
    },
  ];
}

export function planValidateStartNextActions(
  run: string,
  validator: string,
  token: string,
): NextActionItem[] {
  return [
    {
      command: `bun harness.ts plan:review --run ${run} --validator ${validator} --token ${token} --status approved --summary "<SUMMARY>"`,
      role: "Plan-Validator",
      description: "Approve plan DAG to unlock implementer claims",
    },
    {
      command: `bun harness.ts plan:review --run ${run} --validator ${validator} --token ${token} --status changes_requested --summary "<SUMMARY>" --finding "<FINDING>"`,
      role: "Plan-Validator",
      description: "Request plan changes with structural findings",
    },
  ];
}

export function planReviewNextActions(run: string, approved: boolean): NextActionItem[] {
  if (approved) {
    return [
      {
        command: `bun harness.ts queue:wave --run ${run}`,
        role: "Coordinator",
        description: "Dispatch Wave 1 tasks to implementers",
      },
      {
        command: `bun harness.ts queue:next --run ${run}`,
        role: "Implementer",
        description: "Claim first ready task in queue",
      },
    ];
  }
  return [
    {
      command: `bun harness.ts plan:replan --run ${run} --findings <FINDINGS_JSON>`,
      role: "Coordinator",
      description: "Replan and inject repair tasks",
    },
    {
      command: `bun harness.ts plan:compile --run ${run}`,
      role: "Planner",
      description: "Recompile graph revision",
    },
  ];
}

export function autoPartitionNextActions(run?: string): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  return [
    {
      command: `bun harness.ts plan:compile${runArg}`,
      role: "Planner",
      description: "Compile auto-partitioned tasks into DAG",
    },
    {
      command: `bun harness.ts plan:status${runArg}`,
      role: "Planner",
      description: "Review generated tasks in planning buffer",
    },
  ];
}
