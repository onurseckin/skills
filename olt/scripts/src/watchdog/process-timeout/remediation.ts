import type {
  ErrorClassification,
  HierarchicalRole,
  RemediationGuidance,
  SupervisorTier,
} from "./types.ts";

export function buildRemediationGuidance(params: {
  role?: HierarchicalRole | string | undefined;
  supervisorTier?: SupervisorTier | string | undefined;
  errorClassification: ErrorClassification | string;
  defectReference?: "defect-20260822-24" | "defect-20260822-28" | string | undefined;
  taskId?: string | null | undefined;
}): RemediationGuidance {
  const role = typeof params.role === "string" ? params.role : "worker";
  const isCritic = role === "completeness_critic" || role === "critic";
  const isImplementer = role === "task_implementer" || role === "implementer" || role === "worker";
  const isCoordinator = role === "coordinator";
  const isOrchestrator = role === "orchestrator";

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
      fallbackDirective: "Mind initiates autonomous wave replanning and lane repartitioning.",
    };
  }

  return {
    action: "autonomous_repair_routing",
    summary: "Mechanical process timeout watchdog detected execution stall / timeout.",
    prescribedSteps: [
      "Terminate zombie process tree via SIGKILL.",
      "Capture stdout/stderr diagnostics up to moment of termination.",
      "Synthesize structured failure payload with exit status SIGKILL_TIMEOUT.",
      "Notify supervising tier to initiate autonomous recovery.",
    ],
    defectReference:
      typeof params.defectReference === "string" ? params.defectReference : "defect-20260822-28",
    supervisorTarget:
      typeof params.supervisorTier === "string" ? params.supervisorTier : "coordinator",
  };
}
