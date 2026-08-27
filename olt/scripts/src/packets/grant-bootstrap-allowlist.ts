import type { CommandSpec } from "../cli/registry/types.ts";

export const CAPSULE_GENESIS_COMMANDS: ReadonlySet<string> = new Set([
  "plan:init",
  "orchestrate",
  "mind:init",
]);

export const GRANT_GENESIS_COMMANDS: ReadonlySet<string> = new Set(["agent:register"]);

export const CONTEXT_FREE_DIAGNOSTIC_COMMANDS: ReadonlySet<string> = new Set([
  "doctor",
  "health",
  "whoami",
  "explain",
  "role:cheat-sheet",
  "agent:brief",
  "task:check",
]);

export const PRE_COMPILE_PLAN_CONSTRUCTION_COMMANDS: ReadonlySet<string> = new Set([
  "plan:enhance",
  "plan:add",
  "plan:brainstorm",
  "plan:compile",
]);

export const GRANT_BOOTSTRAP_ALLOWLIST: ReadonlySet<string> = new Set([
  ...CAPSULE_GENESIS_COMMANDS,
  ...GRANT_GENESIS_COMMANDS,
  ...CONTEXT_FREE_DIAGNOSTIC_COMMANDS,
  ...PRE_COMPILE_PLAN_CONSTRUCTION_COMMANDS,
]);

export function isGrantBootstrapExempt(spec: CommandSpec): boolean {
  return [spec.name, ...spec.aliases].some((invocation) =>
    GRANT_BOOTSTRAP_ALLOWLIST.has(invocation),
  );
}

/**
 * Creating a capsule or its first grant is the only reason a command may
 * proceed without readable capsule state. Plan construction is grant-free,
 * not capsule-free: it must still operate on an existing verified capsule.
 */
export function isMissingCapsuleBootstrapExempt(spec: CommandSpec): boolean {
  return [spec.name, ...spec.aliases].some(
    (invocation) =>
      CAPSULE_GENESIS_COMMANDS.has(invocation) || GRANT_GENESIS_COMMANDS.has(invocation),
  );
}

const RUN_IDENTITY_FLAG_NAMES: ReadonlySet<string> = new Set(["run", "run-id"]);

export function declaresRunIdentityFlag(spec: CommandSpec): boolean {
  return spec.flags.some((flag) => RUN_IDENTITY_FLAG_NAMES.has(flag.name));
}

const ACTING_IDENTITY_FLAG_NAMES: ReadonlySet<string> = new Set([
  "agent",
  "validator",
  "critic",
  "actor",
]);

export function declaresActingIdentityFlag(spec: CommandSpec): boolean {
  return spec.flags.some((flag) => ACTING_IDENTITY_FLAG_NAMES.has(flag.name));
}

const COMMANDS_WHOSE_ACTING_FLAG_NAME_IS_A_DISPLAY_FILTER_NOT_AN_IDENTITY: ReadonlySet<string> =
  new Set([
    "dag:trace",
    "report:get",
    "evidence:get",
    "evidence:screenshots",
    "test:summary",
    "task:brief",
  ]);

export function requiresActingIdentity(spec: CommandSpec): boolean {
  if (
    [spec.name, ...spec.aliases].some((invocation) =>
      COMMANDS_WHOSE_ACTING_FLAG_NAME_IS_A_DISPLAY_FILTER_NOT_AN_IDENTITY.has(invocation),
    )
  ) {
    return false;
  }
  return declaresActingIdentityFlag(spec);
}
