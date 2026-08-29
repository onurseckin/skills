import { HarnessError } from "../../../core/errors/index.ts";

export const LIFECYCLE_PHASES: readonly string[] = [
  "plan:init",
  "plan:enhance",
  "plan:add",
  "plan:compile",
  "run:start",
  "task:claim",
  "task:review",
  "run:submit",
  "quiesce",
];

const PHASE_ORDER_MAP: Readonly<Record<string, number>> = {
  "plan:init": 0,
  "plan:enhance": 1,
  "plan:add": 2,
  "plan:compile": 3,
  "run:start": 4,
  "task:claim": 5,
  "task:review": 6,
  "run:submit": 7,
  "quiesce": 8,
};

export function validatePhaseTransition(currentPhase: string, nextPhase: string): boolean {
  const currentIndex = PHASE_ORDER_MAP[currentPhase];
  const nextIndex = PHASE_ORDER_MAP[nextPhase];
  if (currentIndex === undefined || nextIndex === undefined) return true;
  return nextIndex >= currentIndex;
}

export function enforceSequentialLifecycleOrdering(sequence: readonly string[]): {
  readonly valid: boolean;
  readonly highestPhaseReached: string;
  readonly violations: readonly string[];
} {
  const violations: string[] = [];
  let highestIndex = -1;
  let highestPhase = "none";

  for (let i = 0; i < sequence.length; i += 1) {
    const cmd = sequence[i];
    if (!cmd) continue;
    const phaseIndex = PHASE_ORDER_MAP[cmd];
    if (phaseIndex !== undefined) {
      if (phaseIndex < highestIndex) {
        violations.push(
          `Command '${cmd}' (phase index ${phaseIndex}) executed out of order after '${highestPhase}' (phase index ${highestIndex})`,
        );
      } else {
        highestIndex = phaseIndex;
        highestPhase = cmd;
      }
    }
  }

  if (violations.length > 0) {
    throw new HarnessError(
      "LIFECYCLE_ORDERING_VIOLATION",
      `Sequential lifecycle command ordering breached:\n${violations.join("\n")}`,
    );
  }

  return {
    valid: true,
    highestPhaseReached: highestPhase,
    violations: [],
  };
}
