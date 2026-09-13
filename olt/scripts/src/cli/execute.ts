import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { JsonObject } from "../core/contracts/index.ts";
import { HarnessError } from "../core/errors/index.ts";
import { parseArguments, suggestCommand } from "./arguments.ts";
import { assertFlags, type CommandContext } from "./options.ts";
import { commandAuthority } from "../packets/index.ts";
const { assertGrantedCommand, explicitActingClaim, requiresActingIdentity } = commandAuthority;
import { commandInvocations, findCommand, flagShapes } from "./registry/index.ts";
import { autoDeriveCallerIdentity } from "../authority/session/index.ts";
import { findRepoRoot } from "../core/index.ts";
import { CumulativePhaseInvariantEngine, DeductiveStateMachine } from "./phase-invariants.ts";
import { isCanonicalRole, type AgentRole } from "../sentinel/index.ts";
import { assertAuthorityBoundTargets } from "./authority-bound.ts";
import { executePostActionHooks, executePreActionHooks } from "./execute-hooks.ts";
import { applyActorNormalization, applyRunInference } from "./inference.ts";

export { DeductiveStateMachine, CumulativePhaseInvariantEngine };

export async function execute(
  argv: readonly string[],
  context: CommandContext = {},
): Promise<JsonObject> {
  let effectiveArgv = [...argv];
  if (
    effectiveArgv.length >= 2 &&
    effectiveArgv[0] &&
    effectiveArgv[1] &&
    !effectiveArgv[0].startsWith("-") &&
    !effectiveArgv[1].startsWith("-") &&
    effectiveArgv[1] !== "--"
  ) {
    const subCandidate = `${effectiveArgv[0]}:${effectiveArgv[1]}`;
    if (findCommand(subCandidate) !== undefined) {
      effectiveArgv = [subCandidate, ...effectiveArgv.slice(2)];
    }
  }

  const cmdName = effectiveArgv[0] ?? "";
  const spec = findCommand(cmdName);
  const parsed = parseArguments(
    effectiveArgv,
    spec === undefined ? undefined : flagShapes(spec.flags),
  );
  if (!spec) {
    const suggestions = commandInvocations();
    const hintCommand = suggestCommand(parsed.command, suggestions);
    const hint = hintCommand !== undefined ? `; did you mean '${hintCommand}'?` : "";
    throw new HarnessError("INVALID_ARGUMENT", `unknown command: ${parsed.command}${hint}`);
  }
  if (parsed.remainder.length && !spec.takesRemainder) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `command ${parsed.command} does not accept -- arguments`,
    );
  }

  applyRunInference(spec, parsed.flags);
  applyActorNormalization(spec, parsed.flags);

  const activeRun =
    typeof parsed.flags["run"] === "string"
      ? parsed.flags["run"]
      : typeof parsed.flags["run-id"] === "string"
        ? parsed.flags["run-id"]
        : typeof parsed.flags["capsule"] === "string"
          ? parsed.flags["capsule"]
          : undefined;

  if (activeRun !== undefined && activeRun.trim() !== "") {
    const hasConstrained = spec.authority?.constrainedPathFlags !== undefined;
    const expectsQueuePath = spec.flags.some((f) => f.name === "queue-path");
    if (hasConstrained || expectsQueuePath) {
      if (expectsQueuePath && parsed.flags["queue-path"] === undefined) {
        let repoRoot: string;
        try {
          repoRoot = resolve(findRepoRoot(activeRun));
        } catch {
          repoRoot = process.cwd();
        }
        const hasQueueFile =
          hasConstrained && spec.authority?.constrainedPathFlags?.includes("queue-file");
        if (hasQueueFile) {
          const qf = parsed.flags["queue-file"];
          parsed.flags["queue-path"] =
            typeof qf === "string" ? qf : join(repoRoot, ".olt", "backlog.jsonl");
        } else {
          const cCapsuleQueue = join(resolve(activeRun), "tasks.jsonl");
          const cDotOltQueue = join(resolve(activeRun), ".olt", "tasks.jsonl");
          parsed.flags["queue-path"] = existsSync(cCapsuleQueue)
            ? cCapsuleQueue
            : existsSync(cDotOltQueue)
              ? cDotOltQueue
              : join(repoRoot, ".olt", "tasks.jsonl");
        }
      }
      if (
        !spec.flags.some((f) => f.name === "run") &&
        !spec.flags.some((f) => f.name === "run-id")
      ) {
        delete parsed.flags["run"];
        delete parsed.flags["run-id"];
      }
    }
  }

  const authorityRun =
    typeof parsed.flags["authority-run"] === "string"
      ? parsed.flags["authority-run"]
      : (parsed.flags["run"] ?? parsed.flags["run-id"]);
  const identity = autoDeriveCallerIdentity({
    runRoot: typeof authorityRun === "string" ? authorityRun : undefined,
    explicitActor: explicitActingClaim(spec, parsed.flags),
  });

  const identityFlags = new Set(["agent", "actor", "validator", "critic", "role"]);
  for (const flag of spec.flags) {
    if (flag.required && !Object.hasOwn(parsed.flags, flag.name) && identityFlags.has(flag.name)) {
      if (!identity.verified) {
        const mechStr = identity.mechanisms.join(", ");
        const mech = mechStr.length > 0 ? mechStr : "none";
        throw new HarnessError(
          "AUTHENTICATION_FAILURE",
          `--${flag.name} is required to run '${spec.name}' but no verified caller identity is available; refusing to auto-fill it from an unauthenticated source (mechanisms: ${mech}).`,
          [],
          3,
          `Pass --${flag.name} explicitly, or run this command from a registered session (see agent:register) so the caller's identity can be verified.`,
        );
      }
      parsed.flags[flag.name] = flag.name === "role" ? identity.role : identity.actor;
    }
  }

  if (
    identity.verified &&
    requiresActingIdentity(spec) &&
    spec.flags.some((f) => f.name === "actor") &&
    parsed.flags["actor"] === undefined
  ) {
    parsed.flags["actor"] = identity.actor;
  }

  assertFlags(
    parsed.flags,
    spec.flags.map((flag) => flag.name),
  );
  const missing = spec.flags.find(
    (flag) => flag.required && !Object.hasOwn(parsed.flags, flag.name),
  );
  if (missing) throw new HarnessError("INVALID_ARGUMENT", `--${missing.name} is required`);

  const runForState = parsed.flags["run"] ?? parsed.flags["run-id"] ?? parsed.flags["capsule"];
  if (typeof runForState === "string" && runForState.trim() !== "") {
    try {
      const { loadRun } = await import("../engine/store/index.ts");
      const runData = loadRun(runForState, false);
      if (runData?.state) {
        CumulativePhaseInvariantEngine.verify(spec, runData.state as Record<string, unknown>);
      }
    } catch (e: unknown) {
      if (e instanceof HarnessError && e.code === "INVALID_STATE") throw e;
    }
  }

  const effectiveRole = (
    spec.name !== "agent:register" &&
    typeof parsed.flags["role"] === "string" &&
    parsed.flags["role"].trim() !== ""
      ? parsed.flags["role"]
      : identity.role
  ) as AgentRole | undefined;

  const effectiveActor =
    (typeof parsed.flags["actor"] === "string" && parsed.flags["actor"].trim() !== ""
      ? parsed.flags["actor"]
      : identity.actor) ?? "unknown";

  const checkRole: AgentRole | undefined =
    effectiveRole && isCanonicalRole(effectiveRole)
      ? effectiveRole
      : identity.role && isCanonicalRole(identity.role)
        ? (identity.role as AgentRole)
        : undefined;

  await executePreActionHooks(spec, parsed.flags, parsed.remainder, checkRole, effectiveActor);

  assertGrantedCommand(spec, parsed.flags, identity);
  assertAuthorityBoundTargets(spec, parsed.flags);

  const result = (await spec.handler(
    parsed.flags,
    { ...context, authenticatedCaller: identity },
    parsed.remainder,
  )) as JsonObject;

  executePostActionHooks(spec, result, checkRole, effectiveActor);

  return result;
}
