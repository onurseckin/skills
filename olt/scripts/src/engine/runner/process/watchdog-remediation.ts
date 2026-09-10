import type {
  HierarchicalRole,
  SupervisorTier,
  ErrorClassification,
  RemediationGuidance,
} from "./watchdog-types.ts";

export const CLOSING_FORBIDDEN_FOR_MIND = "CLOSING_FORBIDDEN_FOR_MIND" as const;

export function buildRemediationGuidance(params: {
  childRole?: HierarchicalRole | string | undefined;
  role?: HierarchicalRole | string | undefined;
  supervisorTier?: SupervisorTier | string | undefined;
  errorClassification: ErrorClassification | string;
  defectReference?: "defect-20260822-24" | "defect-20260822-28" | string | undefined;
  taskId?: string | null | undefined;
  gateId?: string | null | undefined;
}): RemediationGuidance {
  const role =
    typeof params.childRole === "string"
      ? params.childRole
      : typeof params.role === "string"
        ? params.role
        : "worker";

  const isCritic = ["completeness_critic", "critic"].includes(role);
  const isImplementer = ["task_implementer", "implementer", "worker"].includes(role);
  const isCoordinator = role === "coordinator";
  const isOrchestrator = role === "orchestrator";
  const isMind = ["mind", "tier0", "tier0_mind", "mind_product_manager"].includes(role);

  if (isCritic) {
    return {
      action: "autonomous_repair_routing",
      summary:
        "Stalled completeness critic / test gate execution detected. SIGKILL enforced on zombie process tree; route failure payload to supervising Coordinator for scoped remediation.",
      prescribedSteps: [
        "Enforce SIGKILL on stalled test runner / critic subprocess tree immediately.",
        "Synthesize structured execution failure payload with exit status SIGKILL_TIMEOUT and error classification STALL_TIMEOUT.",
        "Capture pre-termination stdout/stderr diagnostics to isolate the hanging test or infinite loop.",
        "Notify supervising Coordinator with structured failure payload to trigger autonomous repair loop.",
        "Enforce strict scoped single-file test re-execution (bun test tests/unit/<path>.test.ts) without full test suite runs.",
      ],
      defectReference:
        typeof params.defectReference === "string" ? params.defectReference : "defect-20260822-24",
      supervisorTarget: "coordinator",
      fallbackDirective: "Re-run only single-file scoped unit test; ban full test suite execution.",
    };
  }

  if (isImplementer) {
    return {
      action: "autonomous_repair_routing",
      summary:
        "Stalled task implementer execution detected. Terminate hung process tree via SIGKILL and route diagnostic payload to Coordinator for autonomous repair dispatch.",
      prescribedSteps: [
        "Terminate hung subagent subprocess tree via SIGKILL.",
        "Synthesize execution failure payload with exit status SIGKILL_TIMEOUT and error classification STALL_TIMEOUT.",
        "Extract pre-termination stdout/stderr diagnostic tail leading up to hang.",
        "Route structured diagnostic payload to supervising Coordinator to trigger autonomous repair/retry loop.",
        "Re-dispatch implementer with bounded timeout limits and verified leased file scopes.",
      ],
      defectReference:
        typeof params.defectReference === "string" ? params.defectReference : "defect-20260822-28",
      supervisorTarget: "coordinator",
      fallbackDirective: "Reassign task with tightened scope or fresh subagent worker.",
    };
  }

  if (isCoordinator) {
    return {
      action: "escalate_to_supervisor",
      summary: "Stalled coordinator execution detected by Orchestrator supervisory health probe.",
      prescribedSteps: [
        "Terminate stalled coordinator execution context.",
        "Synthesize execution failure payload with classification STALL_TIMEOUT.",
        "Orchestrator evaluates active wave lane state and rebalances pending task assignments.",
        "Re-dispatch coordinator with refreshed domain context packet.",
      ],
      defectReference:
        typeof params.defectReference === "string" ? params.defectReference : "defect-20260822-24",
      supervisorTarget: "orchestrator",
      fallbackDirective: "Orchestrator assumes direct lane coordination or splits domain tasks.",
    };
  }

  if (isOrchestrator) {
    return {
      action: "escalate_to_supervisor",
      summary: "Stalled orchestrator execution detected by Mind supervisory health probe.",
      prescribedSteps: [
        "Terminate stalled orchestrator execution context.",
        "Synthesize execution failure payload with classification STALL_TIMEOUT.",
        "Mind re-plans domain wave partitioning and dispatches fresh orchestrator track.",
      ],
      defectReference:
        typeof params.defectReference === "string" ? params.defectReference : "defect-20260822-24",
      supervisorTarget: "mind",
      fallbackDirective:
        "Mind initiates autonomous wave replanning and lane repartitioning under CLOSING_FORBIDDEN_FOR_MIND rather than shutdown.",
    };
  }

  if (isMind) {
    return {
      action: "autonomous_repair_routing",
      summary:
        "Stalled Mind supervisory execution detected. Enforcing CLOSING_FORBIDDEN_FOR_MIND: shutdown is strictly prohibited; commanding autonomous wave replanning and lane repartitioning.",
      prescribedSteps: [
        "Enforce CLOSING_FORBIDDEN_FOR_MIND invariant: absolute ban on shutdown, unhandled idle, or process termination.",
        "Preserve cognitive memory and self-evolution state across pulse cadence.",
        "Command autonomous wave replanning and dynamic lane repartitioning across active and pending domains rather than shutdown.",
        "Re-ignite perpetual pulse driver with Mode A creative self-evolution flow.",
      ],
      defectReference:
        typeof params.defectReference === "string" ? params.defectReference : "defect-20260822-24",
      supervisorTarget: "mind",
      fallbackDirective:
        "Preserve CLOSING_FORBIDDEN_FOR_MIND: Mind commands autonomous wave replanning and lane repartitioning rather than shutdown.",
    };
  }

  const supervisor =
    typeof params.supervisorTier === "string" ? params.supervisorTier : "coordinator";
  const isSupervisorMind = supervisor === "mind";

  return {
    action: "autonomous_repair_routing",
    summary: isSupervisorMind
      ? "Process timeout watchdog detected stall under Mind supervisor. Enforcing CLOSING_FORBIDDEN_FOR_MIND: commanding autonomous wave replanning and lane repartitioning rather than shutdown."
      : "Mechanical process timeout watchdog detected execution stall / timeout.",
    prescribedSteps: isSupervisorMind
      ? [
          "Terminate zombie process tree via SIGKILL.",
          "Preserve CLOSING_FORBIDDEN_FOR_MIND invariant: ban shutdown or unhandled idle.",
          "Synthesize structured failure payload with exit status SIGKILL_TIMEOUT.",
          "Command Mind autonomous wave replanning and lane repartitioning rather than shutdown.",
        ]
      : [
          "Terminate zombie process tree via SIGKILL.",
          "Capture stdout/stderr diagnostics up to moment of termination.",
          "Synthesize structured failure payload with exit status SIGKILL_TIMEOUT.",
          "Notify supervising tier to initiate autonomous recovery.",
        ],
    defectReference:
      typeof params.defectReference === "string" ? params.defectReference : "defect-20260822-28",
    supervisorTarget: supervisor,
    ...(isSupervisorMind
      ? {
          fallbackDirective:
            "Preserve CLOSING_FORBIDDEN_FOR_MIND: command autonomous wave replanning and lane repartitioning rather than shutdown.",
        }
      : {}),
  };
}
