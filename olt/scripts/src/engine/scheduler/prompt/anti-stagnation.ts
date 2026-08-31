import type { AntiStagnationTrigger, CognitivePromptOptions } from "./types.ts";

export interface StagnationAssessment {
  readonly isStagnant: boolean;
  readonly severity: "warning" | "critical" | "emergency" | "nominal";
  readonly reasons: readonly string[];
  readonly recommendedAction: string;
}

export function assessStagnationState(options: CognitivePromptOptions = {}): StagnationAssessment {
  const streak = options.zeroValueStreak ?? 0;
  const stagnant = options.stagnant === true;
  const recentErrors = options.recentErrors ?? [];
  const activeTasks = options.activeTasks ?? [];
  const readyTasks = options.readyTasks ?? [];
  const reasons: string[] = [];

  if (stagnant) {
    reasons.push("Explicit stagnant flag asserted by mind auditor or watchdog probe");
  }

  if (streak >= 5) {
    reasons.push(`Zero-value streak reached ${streak} consecutive scheduler pulses`);
  } else if (streak >= 2) {
    reasons.push(`Quiescent pulse streak at ${streak} cycles without state mutation`);
  }

  if (recentErrors.length > 0) {
    reasons.push(`Encountered ${recentErrors.length} recent error signals during pulse loop`);
  }

  if (activeTasks.length === 0 && readyTasks.length === 0) {
    reasons.push("Task queue is empty: no active or ready tasks currently dispatched");
  }

  let severity: "warning" | "critical" | "emergency" | "nominal" = "nominal";
  let recommendedAction = "Proceed with scheduled workflow execution.";

  if (stagnant || streak >= 10 || recentErrors.length >= 3) {
    severity = "emergency";
    recommendedAction =
      "TRIGGER ANTI-STAGNATION EMERGENCY SHOCK: Activate Mode A Creative Product Manager, admit high-leverage backlog candidates, or execute root-cause error remediation.";
  } else if (streak >= 5 || recentErrors.length > 0) {
    severity = "critical";
    recommendedAction =
      "TRIGGER CRITICAL PROBE: Investigate zero-delta loop causes, inspect backlog for unaddressed defects, and enforce concrete progress logging.";
  } else if (streak >= 2 || (activeTasks.length === 0 && readyTasks.length === 0)) {
    severity = "warning";
    recommendedAction =
      "TRIGGER PROACTIVE DISCOVERY: Scan repository for feature opportunities, verify test coverage, and prevent idle stall.";
  }

  return {
    isStagnant: severity !== "nominal",
    severity,
    reasons,
    recommendedAction,
  };
}

export function generateAntiStagnationTriggers(
  options: CognitivePromptOptions = {},
): readonly AntiStagnationTrigger[] {
  const assessment = assessStagnationState(options);
  if (!assessment.isStagnant) {
    return [];
  }

  const triggers: AntiStagnationTrigger[] = [];

  if (assessment.severity === "emergency") {
    triggers.push({
      triggerCondition: "High-Streak Quiescence or Repeated Execution Failures",
      severity: "emergency",
      imperativeAction:
        "Switch immediately to Mode A Autonomous Product Manager innovation. Refuse to terminate or idle. Execute mind:admit with high-value technical capabilities.",
      shockMechanism:
        "Forced creative hypothesis generation, defect ledger reconciliation, and adversarial test harness verification.",
    });
  } else if (assessment.severity === "critical") {
    triggers.push({
      triggerCondition: "Prolonged Zero-Delta Execution Loop",
      severity: "critical",
      imperativeAction:
        "Perform deep state forensics: verify why previous pulses generated 0 delta. Identify blocked gates or missing tasks and resolve them directly.",
      shockMechanism:
        "Socratic root-cause breakdown, task dependency re-evaluation, and file scope verification.",
    });
  } else if (assessment.severity === "warning") {
    triggers.push({
      triggerCondition: "Quiescent Scheduler Interval Detected",
      severity: "warning",
      imperativeAction:
        "Proactively explore unaddressed requirement vectors, verify UI/DX polish, and ensure all unit tests pass with 100% type soundness.",
      shockMechanism: "Autonomous capability scanning and prompt-driven reflexive inquiry.",
    });
  }

  return triggers;
}
