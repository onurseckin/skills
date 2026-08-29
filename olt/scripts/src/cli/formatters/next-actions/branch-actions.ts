import type { NextActionItem } from "./types.ts";

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
