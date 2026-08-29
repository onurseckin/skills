import { nextActionsBlock } from "./block.ts";
import type { NextActionItem } from "./types.ts";

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
