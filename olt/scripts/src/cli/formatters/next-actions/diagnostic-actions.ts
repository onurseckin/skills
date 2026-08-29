import { planInitNextActions } from "./plan-actions.ts";
import type { NextActionItem } from "./types.ts";

export interface WhoamiLeaseContext {
  readonly taskId: string;
  readonly role: string;
}

export interface WhoamiValidationContext {
  readonly taskId: string;
}

export interface WhoamiRoleContext {
  readonly role?: string | undefined;
  readonly agentId?: string | null | undefined;
  readonly hasGrant?: boolean | undefined;
  readonly leases?: readonly WhoamiLeaseContext[] | undefined;
  readonly openValidations?: readonly WhoamiValidationContext[] | undefined;
}

export function whoamiNextActions(
  runRoot?: string | null,
  isMainThread = false,
  context: WhoamiRoleContext = {},
): NextActionItem[] {
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
  if (!runRoot) {
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

  const agent = context.agentId ?? "<AGENT_ID>";

  const openValidations = context.openValidations ?? [];
  if (openValidations.length > 0) {
    const validation = openValidations[0]!;
    return [
      {
        command: `bun harness.ts task:probe --run ${runRoot} --task ${validation.taskId} --validator ${agent} --token <TOKEN> --demand "<WHAT_MUST_BE_PROVEN>"`,
        role: "Validator",
        description: "Record the mandatory adversarial probe demand before a verdict",
      },
      {
        command: `bun harness.ts task:review --run ${runRoot} --task ${validation.taskId} --validator ${agent} --token <TOKEN> --status pass --checks <COMMAND_ID> --summary "<SUMMARY>"`,
        role: "Validator",
        description: "Record the validator verdict once every probe is answered",
      },
    ];
  }

  const leases = context.leases ?? [];
  if (leases.length > 0) {
    const lease = leases[0]!;
    const role = lease.role === "repairer" ? "Repairer" : "Implementer";
    return [
      {
        command: `bun harness.ts task:heartbeat --run ${runRoot} --task ${lease.taskId} --agent ${agent} --token <TOKEN>`,
        role,
        description: "Extend the lease deadline during active implementation",
      },
      {
        command: `bun harness.ts task:submit --run ${runRoot} --task ${lease.taskId} --agent ${agent} --token <TOKEN> --summary "<WHAT_CHANGED>"`,
        role,
        description: "Submit completed task for validation",
      },
    ];
  }

  if (context.hasGrant === false) {
    return [
      {
        command: `bun harness.ts agent:register --run ${runRoot} --agent ${agent} --role ${context.role ?? "<ROLE>"} --host <HOST>`,
        role: "Coordinator",
        description: "Register agent grant before claiming or validating work",
      },
    ];
  }

  const role = context.role ?? "";
  if (role === "orchestrator" || role.startsWith("orch")) {
    return [
      {
        command: `bun harness.ts queue:wave --run ${runRoot}`,
        role: "Coordinator",
        description: "Dispatch next wave of eligible tasks",
      },
      {
        command: `bun harness.ts run:status --run ${runRoot}`,
        role: "Orchestrator",
        description: "Inspect execution progress and active leases",
      },
    ];
  }
  if (role === "coordinator" || role.startsWith("coord")) {
    return [
      {
        command: `bun harness.ts queue:wave --run ${runRoot}`,
        role: "Coordinator",
        description: "Dispatch next wave of eligible tasks",
      },
      {
        command: `bun harness.ts queue:next --run ${runRoot}`,
        role: "Coordinator",
        description: "Preview next ready task in queue",
      },
    ];
  }
  if (role.startsWith("critic")) {
    return [
      {
        command: `bun harness.ts critic:start --run ${runRoot} --critic ${agent}`,
        role: "Critic",
        description: "Initialize completeness critic review session",
      },
      {
        command: `bun harness.ts run:status --run ${runRoot}`,
        role: "Orchestrator",
        description: "Check run execution status",
      },
    ];
  }

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

export interface DoctorCriticalFinding {
  readonly role: string;
  readonly agentId: string;
  readonly remediation: string;
  readonly taskId?: string | undefined;
}

export interface DoctorNextActionsOptions {
  readonly healthy?: boolean | undefined;
  readonly planVerified?: boolean | undefined;
  readonly criticalFindings?: readonly DoctorCriticalFinding[] | undefined;
}

export function doctorNextActions(
  run?: string,
  options: DoctorNextActionsOptions = {},
): NextActionItem[] {
  const healthy = options.healthy ?? true;
  const planVerified = options.planVerified ?? true;
  const criticalFindings = options.criticalFindings ?? [];
  const runArg = run ? ` --run ${run}` : "";

  if (run && !planVerified) {
    return planInitNextActions(run);
  }

  const actions: NextActionItem[] = [];
  const leadFinding = criticalFindings.find((finding) => finding.taskId !== undefined);
  if (run && leadFinding) {
    actions.push({
      command: `bun harness.ts task:release --run ${run} --task ${leadFinding.taskId} --agent ${leadFinding.agentId} --token <TOKEN>`,
      role: leadFinding.role,
      description: leadFinding.remediation,
    });
  }

  if (!healthy && actions.length === 0) {
    actions.push({
      command: `bun harness.ts report:unified${runArg}`,
      role: "Auditor",
      description: "Critical issue found with no direct CLI remedy; review full evidence report",
    });
  }

  actions.push(
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
  );
  return actions;
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
