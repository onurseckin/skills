import { HarnessError } from "../core/errors/index.ts";
import type { CommandSpec } from "./registry/index.ts";

function hasTasks(state: Record<string, unknown>): boolean {
  if (state.tasks !== null && typeof state.tasks === "object") {
    return Object.keys(state.tasks).length > 0;
  }
  return false;
}

function isCriticReviewed(state: Record<string, unknown>): boolean {
  if (state.completion_critic !== null && typeof state.completion_critic === "object") {
    const critic = state.completion_critic as Record<string, unknown>;
    return critic.status === "reviewed";
  }
  return false;
}

export class DeductiveStateMachine {
  constructor(public readonly state: Record<string, unknown>) {}

  public isPhaseVerified(phase: string): boolean {
    switch (phase) {
      case "plan":
        return (
          !!this.state.requirements ||
          !!this.state.plan_compiled ||
          !!this.state.graph ||
          !!this.state.completion_review ||
          hasTasks(this.state)
        );
      case "queue":
      case "task":
        return (
          !!this.state.graph ||
          !!this.state.completion_review ||
          !!this.state.completion_critic ||
          hasTasks(this.state)
        );
      case "critic":
        return (
          !!this.state.critic_verdict ||
          !!this.state.critic_review ||
          !!this.state.completion_review ||
          isCriticReviewed(this.state)
        );
      case "run":
        return !!this.state.completion_result;
      default:
        return true;
    }
  }
}

const PHASE_REMEDIAL_COMMAND: Readonly<Record<string, string>> = {
  plan: "plan:compile",
  queue: "queue:wave",
  task: "queue:wave",
  critic: "critic:start",
};

const READ_ONLY_INSPECTOR_COMMANDS: ReadonlySet<string> = new Set(["run:status"]);

export class CumulativePhaseInvariantEngine {
  public static verify(spec: CommandSpec, state: Record<string, unknown>): void {
    const machine = new DeductiveStateMachine(state);
    const prerequisitePhases = CumulativePhaseInvariantEngine.getPrerequisitePhases(spec);

    for (const prereq of prerequisitePhases) {
      if (!machine.isPhaseVerified(prereq)) {
        throw new HarnessError(
          "INVALID_STATE",
          `Cumulative Phase Invariant Violation: cannot execute command '${spec.name}' because higher prerequisite phase '${prereq}' is unverified.`,
          [],
          3,
          PHASE_REMEDIAL_COMMAND[prereq]
            ? `Run '${PHASE_REMEDIAL_COMMAND[prereq]}' first to verify the '${prereq}' phase, then retry '${spec.name}'.`
            : undefined,
        );
      }
    }
  }

  private static getPrerequisitePhases(spec: CommandSpec): readonly string[] {
    const name = spec.name;
    if (READ_ONLY_INSPECTOR_COMMANDS.has(name)) {
      return [];
    }
    if (name === "run:complete") return ["plan", "queue", "task", "critic"];
    if (
      name === "run:exec" ||
      name === "shell" ||
      spec.domain === "critic" ||
      name.startsWith("critic:")
    ) {
      return ["plan", "queue", "task"];
    }
    if (spec.domain === "task" || name.startsWith("task:")) return ["plan", "queue"];
    if (spec.domain === "queue" || name.startsWith("queue:")) return ["plan"];
    return [];
  }
}
