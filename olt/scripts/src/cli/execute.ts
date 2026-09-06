import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { JsonObject } from "../core/contracts/index.ts";
import { HarnessError } from "../core/errors/index.ts";
import { parseArguments, suggestCommand } from "./arguments.ts";
import { assertFlags, type CommandContext } from "./options.ts";
import {
  assertGrantedCommand,
  explicitActingClaim,
  requiresActingIdentity,
} from "../packets/command-authority.ts";
import { commandInvocations, findCommand, flagShapes, type CommandSpec } from "./registry/index.ts";
import { autoDeriveCallerIdentity } from "../authority/session/index.ts";
import { findRepoRoot } from "../core/shared/paths.ts";
import { CumulativePhaseInvariantEngine, DeductiveStateMachine } from "./phase-invariants.ts";

export { DeductiveStateMachine, CumulativePhaseInvariantEngine };

const isEnoent = (error: unknown): boolean =>
  error instanceof Error && (error as { code?: string }).code === "ENOENT";

function canonicalizePhysicalPath(path: string, description: string): string {
  let existingPath = resolve(path);
  const missingSuffix: string[] = [];

  while (true) {
    try {
      lstatSync(existingPath);
    } catch (error) {
      if (!isEnoent(error)) {
        throw new HarnessError("PATH_SAFETY", `cannot inspect ${description}: ${existingPath}`);
      }
      const parent = dirname(existingPath);
      if (parent === existingPath) {
        throw new HarnessError("PATH_SAFETY", `cannot resolve ${description}: ${path}`);
      }
      missingSuffix.push(basename(existingPath));
      existingPath = parent;
      continue;
    }

    let canonicalExistingPath: string;
    try {
      canonicalExistingPath = realpathSync(existingPath);
    } catch {
      throw new HarnessError("PATH_SAFETY", `cannot resolve ${description}: ${existingPath}`);
    }
    return missingSuffix.length === 0
      ? canonicalExistingPath
      : join(canonicalExistingPath, ...missingSuffix.reverse());
  }
}

function isOutside(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel === "..") return true;
  if (isAbsolute(rel)) return true;
  return rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}

function assertAuthorityBoundTargets(spec: CommandSpec, flags: Record<string, unknown>): void {
  const authority = spec.authority;
  if (authority?.constrainedPathFlags === undefined) return;
  const authorityRun = flags[authority.authorityRunFlag];
  if (typeof authorityRun !== "string") return;
  if (authorityRun.trim() === "") return;
  const repositoryRoot = resolve(findRepoRoot(authorityRun));
  const physicalRepositoryRoot = canonicalizePhysicalPath(
    repositoryRoot,
    "authority-run repository",
  );
  const constrained = new Set(authority.constrainedPathFlags);
  const qfDefault = join(repositoryRoot, ".olt", "backlog.jsonl");
  if (constrained.has("queue-file") || constrained.has("queue-path")) {
    const chosen =
      (typeof flags["queue-file"] === "string" ? flags["queue-file"] : undefined) ??
      (typeof flags["queue-path"] === "string" ? flags["queue-path"] : undefined) ??
      qfDefault;
    if (constrained.has("queue-file") && typeof flags["queue-file"] !== "string")
      flags["queue-file"] = chosen;
    if (constrained.has("queue-path") && typeof flags["queue-path"] !== "string")
      flags["queue-path"] = chosen;
  }
  if (constrained.has("archive-file") && typeof flags["archive-file"] !== "string") {
    flags["archive-file"] = join(repositoryRoot, ".olt", "completed-tasks.jsonl");
  }
  for (const name of authority.constrainedPathFlags) {
    const target = flags[name];
    if (typeof target !== "string") continue;
    if (target.trim() === "") continue;
    const resolvedTarget = resolve(target);
    if (isOutside(repositoryRoot, resolvedTarget)) {
      throw new HarnessError(
        "PATH_SAFETY",
        `${spec.name} rejects --${name} outside the authority-run repository: ${resolvedTarget}`,
      );
    }
    const physicalTarget = canonicalizePhysicalPath(
      resolvedTarget,
      `${spec.name} --${name} target`,
    );
    if (isOutside(physicalRepositoryRoot, physicalTarget)) {
      throw new HarnessError(
        "PATH_SAFETY",
        `${spec.name} rejects --${name} outside the authority-run repository: ${physicalTarget}`,
      );
    }
  }
}

const RETIRED_COMMANDS: ReadonlyMap<string, string> = new Map([
  [
    "run:status",
    "[RETIRED_COMMAND] 'run:status' has been retired. Use 'bun harness.ts report' or 'bun harness.ts report:dag' instead.",
  ],
  [
    "dag",
    "[RETIRED_COMMAND] 'dag' has been retired. Use 'bun harness.ts report:dag' or 'bun harness.ts dag:check' instead.",
  ],
]);

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
    if (findCommand(subCandidate) !== undefined || RETIRED_COMMANDS.has(subCandidate)) {
      effectiveArgv = [subCandidate, ...effectiveArgv.slice(2)];
    }
  }

  const cmdName = effectiveArgv[0] ?? "";
  const retiredMsg = RETIRED_COMMANDS.get(cmdName);
  if (retiredMsg) throw new HarnessError("INVALID_ARGUMENT", retiredMsg);

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

  const runCandidate = parsed.flags["run"] ?? parsed.flags["run-id"] ?? parsed.flags["capsule"];
  if (runCandidate !== undefined) {
    if (parsed.flags["run"] === undefined) parsed.flags["run"] = runCandidate;
    const acceptsRunId = spec.flags.some((f) => f.name === "run-id");
    const acceptsRun = spec.flags.some((f) => f.name === "run");
    const acceptsCapsule = spec.flags.some((f) => f.name === "capsule");

    if (acceptsRunId || parsed.flags["run-id"] !== undefined)
      parsed.flags["run-id"] = parsed.flags["run"];
    if (acceptsCapsule) parsed.flags["capsule"] = parsed.flags["run"];
    else delete parsed.flags["capsule"];
    if (!acceptsRunId && !acceptsRun) delete parsed.flags["run-id"];
  }

  const actorCandidate = parsed.flags["actor"] ?? parsed.flags["agent"] ?? parsed.flags["agent-id"];
  if (actorCandidate !== undefined) {
    const hasActor = spec.flags.some((f) => f.name === "actor");
    const hasAgent = spec.flags.some((f) => f.name === "agent");
    const hasAgentId = spec.flags.some((f) => f.name === "agent-id");

    if (hasActor || hasAgent || hasAgentId) {
      if (hasActor && parsed.flags["actor"] === undefined) parsed.flags["actor"] = actorCandidate;
      if (hasAgent && parsed.flags["agent"] === undefined) parsed.flags["agent"] = actorCandidate;
      if (hasAgentId && parsed.flags["agent-id"] === undefined)
        parsed.flags["agent-id"] = actorCandidate;
      if (!hasActor) delete parsed.flags["actor"];
      if (!hasAgent) delete parsed.flags["agent"];
      if (!hasAgentId) delete parsed.flags["agent-id"];
    }
  }

  const activeRun = typeof parsed.flags["run"] === "string" ? parsed.flags["run"] : undefined;
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
      : parsed.flags["run"];
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

  if (typeof parsed.flags["run"] === "string" && parsed.flags["run"].trim() !== "") {
    try {
      const { loadRun } = await import("../engine/store/index.ts");
      const runData = loadRun(parsed.flags["run"] as string, false);
      if (runData?.state) {
        CumulativePhaseInvariantEngine.verify(spec, runData.state as Record<string, unknown>);
      }
    } catch (e: unknown) {
      if (e instanceof HarnessError && e.code === "INVALID_STATE") throw e;
    }
  }

  assertGrantedCommand(spec, parsed.flags, identity);
  assertAuthorityBoundTargets(spec, parsed.flags);

  return (await spec.handler(
    parsed.flags,
    { ...context, authenticatedCaller: identity },
    parsed.remainder,
  )) as JsonObject;
}
