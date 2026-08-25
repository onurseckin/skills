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

export const GRANT_BOOTSTRAP_ALLOWLIST: ReadonlySet<string> = new Set([
  ...CAPSULE_GENESIS_COMMANDS,
  ...GRANT_GENESIS_COMMANDS,
  ...CONTEXT_FREE_DIAGNOSTIC_COMMANDS,
]);

export function isGrantBootstrapExempt(spec: CommandSpec): boolean {
  return [spec.name, ...spec.aliases].some((invocation) =>
    GRANT_BOOTSTRAP_ALLOWLIST.has(invocation),
  );
}

const RUN_IDENTITY_FLAG_NAMES: ReadonlySet<string> = new Set(["run", "run-id"]);

export function declaresRunIdentityFlag(spec: CommandSpec): boolean {
  return spec.flags.some((flag) => RUN_IDENTITY_FLAG_NAMES.has(flag.name));
}
