import { lstatSync, realpathSync } from "node:fs";
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

function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error && Object.getOwnPropertyDescriptor(error, "code")?.value === "ENOENT"
  );
}

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
  const relation = relative(root, target);
  return (
    relation === ".." ||
    relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(relation)
  );
}

function assertAuthorityBoundTargets(spec: CommandSpec, flags: Record<string, unknown>): void {
  const authority = spec.authority;
  if (authority?.constrainedPathFlags === undefined) return;
  const authorityRun = flags[authority.authorityRunFlag];
  if (typeof authorityRun !== "string" || authorityRun.trim() === "") return;
  const repositoryRoot = resolve(findRepoRoot(authorityRun));
  const physicalRepositoryRoot = canonicalizePhysicalPath(
    repositoryRoot,
    "authority-run repository",
  );
  const constrained = new Set(authority.constrainedPathFlags);
  if (
    constrained.has("queue-file") &&
    typeof flags["queue-file"] !== "string" &&
    typeof flags["queue-path"] !== "string"
  ) {
    flags["queue-file"] = join(repositoryRoot, ".olt", "backlog.jsonl");
  }
  if (constrained.has("archive-file") && typeof flags["archive-file"] !== "string") {
    flags["archive-file"] = join(repositoryRoot, ".olt", "completed-tasks.jsonl");
  }
  for (const name of authority.constrainedPathFlags) {
    const target = flags[name];
    if (typeof target !== "string" || target.trim() === "") continue;
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

export async function execute(
  argv: readonly string[],
  context: CommandContext = {},
): Promise<JsonObject> {
  let effectiveArgv = [...argv];
  if (
    effectiveArgv.length >= 2 &&
    effectiveArgv[0] !== undefined &&
    effectiveArgv[1] !== undefined &&
    !effectiveArgv[0].startsWith("-") &&
    !effectiveArgv[1].startsWith("-") &&
    effectiveArgv[1] !== "--"
  ) {
    const subCandidate = `${effectiveArgv[0]}:${effectiveArgv[1]}`;
    if (findCommand(subCandidate) !== undefined) {
      effectiveArgv = [subCandidate, ...effectiveArgv.slice(2)];
    }
  }

  const spec = findCommand(effectiveArgv[0] ?? "");
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

  if (parsed.flags["run-id"] !== undefined && parsed.flags["run"] === undefined) {
    parsed.flags["run"] = parsed.flags["run-id"];
  } else if (parsed.flags["run"] !== undefined && parsed.flags["run-id"] === undefined) {
    parsed.flags["run-id"] = parsed.flags["run"];
  }

  const authorityRun =
    typeof parsed.flags["authority-run"] === "string"
      ? parsed.flags["authority-run"]
      : parsed.flags["run"];
  const identity = autoDeriveCallerIdentity({
    runRoot: typeof authorityRun === "string" ? authorityRun : undefined,
    explicitActor: explicitActingClaim(spec, parsed.flags),
  });
  for (const flag of spec.flags) {
    if (
      flag.required &&
      !Object.hasOwn(parsed.flags, flag.name) &&
      (flag.name === "agent" ||
        flag.name === "actor" ||
        flag.name === "validator" ||
        flag.name === "critic" ||
        flag.name === "role")
    ) {
      if (!identity.verified) {
        throw new HarnessError(
          "AUTHENTICATION_FAILURE",
          `--${flag.name} is required to run '${spec.name}' but no verified caller identity is available; refusing to auto-fill it from an unauthenticated source (mechanisms: ${identity.mechanisms.join(", ") || "none"}).`,
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
    spec.flags.some((flag) => flag.name === "actor") &&
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
      const runRoot = parsed.flags["run"] as string;
      const { loadRun } = await import("../engine/store/index.ts");
      const runData = loadRun(runRoot, false);
      if (runData && runData.state) {
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
