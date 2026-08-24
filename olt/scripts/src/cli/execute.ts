import type { JsonObject } from "../core/contracts/json.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import { parseArguments } from "./arguments.ts";
import { assertFlags, type CommandContext } from "./options.ts";
import { assertGrantedCommand } from "../packets/command-authority.ts";
import { findCommand, flagShapes, type CommandSpec } from "./registry/index.ts";
import { autoDeriveCallerIdentity } from "../authority/session-registry.ts";

export async function execute(
  argv: readonly string[],
  context: CommandContext = {},
): Promise<JsonObject> {
  const spec = findCommand(argv[0] ?? "");
  const parsed = parseArguments(argv, spec === undefined ? undefined : flagShapes(spec.flags));
  if (!spec) throw new HarnessError("INVALID_ARGUMENT", `unknown command: ${parsed.command}`);
  if (parsed.remainder.length && !spec.takesRemainder) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `command ${parsed.command} does not accept -- arguments`,
    );
  }

  const identity = autoDeriveCallerIdentity();
  for (const flag of spec.flags) {
    if (flag.required && !Object.hasOwn(parsed.flags, flag.name)) {
      if (
        flag.name === "agent" ||
        flag.name === "actor" ||
        flag.name === "validator" ||
        flag.name === "critic"
      ) {
        parsed.flags[flag.name] = identity.actor;
      } else if (flag.name === "role") {
        parsed.flags[flag.name] = identity.role;
      }
    }
  }

  assertFlags(
    parsed.flags,
    spec.flags.map((flag) => flag.name),
  );
  const missing = spec.flags.find(
    (flag) => flag.required && !Object.hasOwn(parsed.flags, flag.name),
  );
  if (missing) throw new HarnessError("INVALID_ARGUMENT", `--${missing.name} is required`);
  assertGrantedCommand(spec, parsed.flags);

  if (typeof parsed.flags["run"] === "string" && parsed.flags["run"].trim() !== "") {
    try {
      const runRoot = parsed.flags["run"] as string;
      const { loadRun } = await import("../engine/store/load.ts");
      const runData = loadRun(runRoot, false);
      CumulativePhaseInvariantEngine.verify(spec, runData.state as Record<string, unknown>);
    } catch (e: unknown) {
      if (e instanceof HarnessError && e.code === "INVALID_STATE") throw e;
      CumulativePhaseInvariantEngine.verify(spec, {});
    }
  }

  return (await spec.handler(parsed.flags, context, parsed.remainder)) as JsonObject;
}

export class DeductiveStateMachine {
  constructor(public readonly state: Record<string, unknown>) {}

  public isPhaseVerified(phase: string): boolean {
    switch (phase) {
      case "plan":
        return !!this.state.requirements;
      case "queue":
        return (
          !!this.state.tasks &&
          typeof this.state.tasks === "object" &&
          this.state.tasks !== null &&
          Object.keys(this.state.tasks as object).length > 0
        );
      case "task":
        return (
          !!this.state.tasks &&
          typeof this.state.tasks === "object" &&
          this.state.tasks !== null &&
          Object.keys(this.state.tasks as object).length > 0
        );
      case "critic":
        return (
          !!this.state.critic_verdict ||
          !!this.state.critic_review ||
          !!this.state.completion_review ||
          (!!this.state.completion_critic &&
            (this.state.completion_critic as { status?: string }).status === "reviewed")
        );
      case "run":
        return !!this.state.completion_result;
      default:
        return true;
    }
  }
}

export class CumulativePhaseInvariantEngine {
  public static verify(spec: CommandSpec, state: Record<string, unknown>): void {
    const machine = new DeductiveStateMachine(state);
    const prerequisitePhases = CumulativePhaseInvariantEngine.getPrerequisitePhases(spec);

    for (const prereq of prerequisitePhases) {
      if (!machine.isPhaseVerified(prereq)) {
        throw new HarnessError(
          "INVALID_STATE",
          `Cumulative Phase Invariant Violation: cannot execute command '${spec.name}' because higher prerequisite phase '${prereq}' is unverified.`,
        );
      }
    }
  }

  private static getPrerequisitePhases(spec: CommandSpec): readonly string[] {
    const name = spec.name;
    if (name === "run:complete") {
      return ["plan", "queue", "task", "critic"];
    }
    if (
      name === "run:exec" ||
      name === "run:status" ||
      name === "shell" ||
      spec.domain === "critic" ||
      name.startsWith("critic:")
    ) {
      return ["plan", "queue", "task"];
    }
    if (spec.domain === "task" || name.startsWith("task:")) {
      return ["plan", "queue"];
    }
    if (spec.domain === "queue" || name.startsWith("queue:")) {
      return ["plan"];
    }
    if (spec.domain === "plan" || name.startsWith("plan:")) {
      return [];
    }
    return [];
  }
}
