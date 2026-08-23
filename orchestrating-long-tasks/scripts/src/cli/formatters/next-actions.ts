export interface NextActionItem {
  readonly command: string;
  readonly role?: string | undefined;
  readonly description?: string | undefined;
}

export function nextActionsBlock(actions: readonly (NextActionItem | string)[]): string[] {
  if (actions.length === 0) return [];
  const lines: string[] = ["", "⚡ Next Actions:"];
  for (const [i, action] of actions.entries()) {
    if (typeof action === "string") {
      lines.push(`${i + 1}. \`${action}\``);
    } else {
      const roleStr = action.role ? ` [${action.role}]` : "";
      const descStr = action.description ? ` — ${action.description}` : "";
      lines.push(`${i + 1}. \`${action.command}\`${roleStr}${descStr}`);
    }
  }
  return lines;
}

export function formatNextActions(actions: readonly (NextActionItem | string)[]): string {
  return nextActionsBlock(actions).join("\n").trim();
}

// ---------------------------------------------------------------------------
// Role-Aware GPS Next Actions Helpers
// ---------------------------------------------------------------------------

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

export function branchOpenNextActions(
  run: string,
  branchId: string,
  firstSubTaskId?: string,
  parentAgent?: string,
): NextActionItem[] {
  const subArg = firstSubTaskId ? ` --sub-task ${firstSubTaskId}` : " --sub-task <SUB_TASK_ID>";
  const pArg = parentAgent ? ` --agent ${parentAgent}` : " --agent <PARENT_AGENT>";
  return [
    {
      command: `bun harness.ts branch:claim --run ${run} --branch ${branchId}${subArg} --agent <SUB_AGENT>`,
      role: "Sub-agent",
      description: "Claim sub-task under isolated scope",
    },
    {
      command: `bun harness.ts branch:collect --run ${run} --branch ${branchId}${pArg} --token <PARENT_TOKEN> --summary "<SUMMARY>"`,
      role: "Parent",
      description: "Collect branch once sub-tasks are submitted",
    },
  ];
}

export function branchClaimNextActions(
  run: string,
  branchId: string,
  subTaskId: string,
  agent: string,
  token: string,
): NextActionItem[] {
  return [
    {
      command: `bun harness.ts branch:submit --run ${run} --branch ${branchId} --sub-task ${subTaskId} --agent ${agent} --token ${token} --summary "<SUMMARY>"`,
      role: "Sub-agent",
      description: "Submit completed sub-task back to parent branch",
    },
  ];
}

export function branchSubmitNextActions(
  run?: string,
  branchId?: string,
  parentAgent?: string,
): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  const bArg = branchId ? ` --branch ${branchId}` : "";
  const pArg = parentAgent ? ` --agent ${parentAgent}` : " --agent <PARENT_AGENT>";
  return [
    {
      command: `bun harness.ts branch:collect${runArg}${bArg}${pArg} --token <PARENT_TOKEN> --summary "<SUMMARY>"`,
      role: "Parent",
      description: "Collect submitted branch work",
    },
  ];
}

export function branchCollectNextActions(
  run?: string,
  parentTaskId?: string,
  parentAgent?: string,
): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  const tArg = parentTaskId ? ` --task ${parentTaskId}` : "";
  const aArg = parentAgent ? ` --agent ${parentAgent}` : " --agent <AGENT>";
  return [
    {
      command: `bun harness.ts task:submit${runArg}${tArg}${aArg} --token <TOKEN> --summary "<SUMMARY>"`,
      role: "Parent",
      description: "Submit parent task with branch modifications integrated",
    },
  ];
}

export function branchStatusNextActions(run: string): NextActionItem[] {
  return [
    {
      command: `bun harness.ts branch:open --run ${run} --parent-task <TASK_ID> --parent-agent <AGENT> --token <TOKEN>`,
      role: "Parent",
      description: "Open branch to subdivide complex task",
    },
    {
      command: `bun harness.ts run:status --run ${run}`,
      role: "Orchestrator",
      description: "Check execution status",
    },
  ];
}

export function whoamiNextActions(runRoot?: string | null, isMainThread = false): NextActionItem[] {
  if (isMainThread) {
    return [
      {
        command: `bun harness.ts orchestrate "<PROMPT>"`,
        role: "Main-Thread",
        description: "Dispatch Tier 1 orchestrator subagent (containment policy)",
      },
      {
        command: `bun harness.ts doctor`,
        role: "Main-Thread",
        description: "Verify local harness environment health",
      },
    ];
  }
  if (runRoot) {
    return [
      {
        command: `bun harness.ts run:status --run ${runRoot}`,
        role: "Orchestrator",
        description: "Inspect execution progress and active leases",
      },
      {
        command: `bun harness.ts queue:next --run ${runRoot}`,
        role: "Implementer",
        description: "Claim next ready task in queue",
      },
    ];
  }
  return [
    {
      command: `bun harness.ts orchestrate "<PROMPT>"`,
      role: "Orchestrator",
      description: "Open new orchestration run",
    },
    {
      command: `bun harness.ts doctor`,
      role: "Operator",
      description: "Verify harness environment health",
    },
  ];
}

export function doctorNextActions(run?: string): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  return [
    {
      command: `bun harness.ts run:status${runArg}`,
      role: "Orchestrator",
      description: "Check run execution status",
    },
    {
      command: `bun harness.ts queue:wave${runArg}`,
      role: "Coordinator",
      description: "Inspect ready task wave",
    },
  ];
}

export function recoverNextActions(run: string): NextActionItem[] {
  return [
    {
      command: `bun harness.ts queue:wave --run ${run}`,
      role: "Coordinator",
      description: "Re-dispatch recovered tasks",
    },
    {
      command: `bun harness.ts run:status --run ${run}`,
      role: "Orchestrator",
      description: "Verify active lease counts",
    },
  ];
}

export function findingGetNextActions(run?: string, findingId?: string): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  const fArg = findingId ? ` --findings ${findingId}` : "";
  return [
    {
      command: `bun harness.ts plan:replan${runArg}${fArg}`,
      role: "Coordinator",
      description: "Replan and inject repair task for finding",
    },
    {
      command: `bun harness.ts critic:remediate${runArg} --finding ${findingId ?? "<FINDING_ID>"} --evidence <EVIDENCE>`,
      role: "Repairer",
      description: "Record remediation evidence",
    },
  ];
}

export function reportGetNextActions(run?: string): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  return [
    {
      command: `bun harness.ts report:get${runArg}`,
      role: "Auditor",
      description: "List all generated reports",
    },
    {
      command: `bun harness.ts run:status${runArg}`,
      role: "Orchestrator",
      description: "Check execution status",
    },
  ];
}

export function evidenceGetNextActions(run?: string): NextActionItem[] {
  const runArg = run ? ` --run ${run}` : "";
  return [
    {
      command: `bun harness.ts evidence:get${runArg}`,
      role: "Validator",
      description: "List recorded command evidence",
    },
    {
      command: `bun harness.ts run:status${runArg}`,
      role: "Orchestrator",
      description: "Check execution progress",
    },
  ];
}

export function mindInitNextActions(run: string): NextActionItem[] {
  return [
    {
      command: `bun harness.ts mind:wake --run ${run}`,
      role: "Mind",
      description: "Wake substrate and begin perpetual generation cadence",
    },
    {
      command: `bun harness.ts mind:observe --run ${run}`,
      role: "Mind",
      description: "Ingest initial telemetry observation",
    },
  ];
}

export function mindWakeNextActions(run: string): NextActionItem[] {
  return [
    {
      command: `bun harness.ts mind:round --run ${run}`,
      role: "Mind",
      description: "Execute autonomic generation round",
    },
    {
      command: `bun harness.ts mind:candidate --run ${run} --action drain`,
      role: "Mind",
      description: "Drain candidate feedback queue into planning buffer",
    },
  ];
}

export function mindObserveNextActions(run: string): NextActionItem[] {
  return [
    {
      command: `bun harness.ts mind:round --run ${run}`,
      role: "Mind",
      description: "Advance perpetual generation cycle",
    },
    {
      command: `bun harness.ts mind:audit --run ${run}`,
      role: "Mind",
      description: "Audit active generation invariants",
    },
  ];
}

export function mindRoundNextActions(run: string): NextActionItem[] {
  return [
    {
      command: `bun harness.ts mind:observe --run ${run}`,
      role: "Mind",
      description: "Record updated generation telemetry",
    },
    {
      command: `bun harness.ts mind:candidate --run ${run} --action drain`,
      role: "Mind",
      description: "Drain pending feedback candidates",
    },
  ];
}

export interface DeterministicActionChainOptions {
  readonly runId?: string | undefined;
  readonly role?: string | undefined;
  readonly context?: string | undefined;
}

export function formatDeterministicActionChaining(
  stage: "agent" | "branch" | "task" | "plan" | "queue" | "critic",
  options: DeterministicActionChainOptions = {},
): string[] {
  const actions: NextActionItem[] = [];
  const run = options.runId ?? "<RUN_ID>";
  if (stage === "agent") {
    actions.push(
      {
        command: `bun harness.ts agent:register --run ${run} --agent <AGENT_ID> --role <ROLE> --host <HOST>`,
        role: "Coordinator",
        description: "Register new agent grant for wave dispatch",
      },
      {
        command: `bun harness.ts queue:next --run ${run}`,
        role: options.role,
        description: "Claim next ready task in active queue",
      },
    );
  } else if (stage === "branch") {
    actions.push(
      {
        command: `bun harness.ts branch:open --run ${run} --parent-task <TASK_ID> --parent-agent <AGENT> --token <TOKEN>`,
        role: "Parent",
        description: "Open branch to subdivide complex task",
      },
      {
        command: `bun harness.ts branch:claim --run ${run} --branch <BRANCH_ID> --sub-task <SUB_TASK_ID> --agent <SUB_AGENT>`,
        role: "Sub-agent",
        description: "Claim sub-task under isolated scope",
      },
    );
  } else if (stage === "task") {
    actions.push(
      {
        command: `bun harness.ts task:heartbeat --task <TASK_ID> --agent <AGENT> --token <TOKEN>`,
        role: "Implementer",
        description: "Extend lease deadline during active implementation",
      },
      {
        command: `bun harness.ts task:submit --task <TASK_ID> --agent <AGENT> --token <TOKEN> --summary "<WHAT_CHANGED>"`,
        role: "Implementer",
        description: "Submit completed task for validation",
      },
    );
  } else if (stage === "plan") {
    actions.push(
      {
        command: `bun harness.ts plan:enhance --run ${run}`,
        role: "Planner",
        description: "Synthesize structured plan from prompt",
      },
      {
        command: `bun harness.ts plan:compile --run ${run}`,
        role: "Planner",
        description: "Compile and seal graph topology",
      },
    );
  } else if (stage === "queue") {
    actions.push(
      {
        command: `bun harness.ts queue:wave --run ${run}`,
        role: "Coordinator",
        description: "Dispatch parallel ready wave",
      },
      {
        command: `bun harness.ts queue:next --run ${run}`,
        role: "Implementer",
        description: "Claim first ready task in queue",
      },
    );
  } else if (stage === "critic") {
    actions.push(
      {
        command: `bun harness.ts critic:start --run ${run} --critic critic-1`,
        role: "Critic",
        description: "Initialize completeness critic review session",
      },
      {
        command: `bun harness.ts run:complete --run ${run} --auth-token <TOKEN>`,
        role: "Orchestrator",
        description: "Seal capsule and finalize run",
      },
    );
  }
  return nextActionsBlock(actions);
}
