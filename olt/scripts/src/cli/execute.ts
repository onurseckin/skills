import type { JsonObject } from "../core/contracts/json.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import { parseArguments } from "./arguments.ts";
import { assertFlags, type CommandContext } from "./options.ts";
import { assertGrantedCommand } from "../packets/command-authority.ts";
import { findCommand, flagShapes } from "./registry/index.ts";
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
      CumulativePhaseInvariantEngine.verify(spec.domain, runData.state);
    } catch (e: unknown) {
      if (e instanceof HarnessError && e.code === "INVALID_STATE") throw e;
      CumulativePhaseInvariantEngine.verify(spec.domain, {});
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
        return !!this.state.tasks && Object.keys(this.state.tasks as object).length > 0;
      case "task":
        return !!this.state.tasks && Object.keys(this.state.tasks as object).length > 0;
      case "run":
        return !!this.state.completion_result;
      case "critic":
        return !!this.state.critic_verdict;
      default:
        return true;
    }
  }
}

export class CumulativePhaseInvariantEngine {
  public static verify(domain: string, state: Record<string, unknown>): void {
    const PHASE_HIERARCHY = ["plan", "queue", "task", "run", "critic"];
    const machine = new DeductiveStateMachine(state);

    const targetIndex = PHASE_HIERARCHY.indexOf(domain);
    if (targetIndex <= 0) return;

    for (let i = 0; i < targetIndex; i++) {
      const higherPhase = PHASE_HIERARCHY[i] as string;
      if (!machine.isPhaseVerified(higherPhase)) {
        throw new HarnessError(
          "INVALID_STATE",
          `Cumulative Phase Invariant Violation: cannot execute lower-phase command domain '${domain}' because higher prerequisite phase '${higherPhase}' is unverified.`,
        );
      }
    }
  }
}
