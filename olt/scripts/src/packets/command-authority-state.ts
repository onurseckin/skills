import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RunState } from "../core/contracts/index.ts";
import { loadRun } from "../engine/store/index.ts";
import type { Flags } from "../cli/options.ts";
import type { CommandSpec } from "../cli/registry/types.ts";
import {
  isGrantBootstrapExempt,
  isMissingCapsuleBootstrapExempt,
  requiresActingIdentity,
} from "./grant-bootstrap-allowlist.ts";

export const ACTING_FLAGS: readonly string[] = ["actor", "validator", "critic", "agent"];

export const SUBJECT_FLAGS: ReadonlyMap<string, string> = new Map([
  ["agent:register", "agent"],
  ["agent:report", "agent"],
  ["agent:release", "agent"],
  ["meta-audit", "agent"],
  ["skill:audit:live", "agent"],
  ["skill:audit", "agent"],
  ["mind:audit:live", "agent"],
  ["mind:audit", "agent"],
]);

export function identity(flags: Flags, name: string): string | undefined {
  const value = Object.hasOwn(flags, name) ? flags[name] : undefined;
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function subjectFlag(spec: CommandSpec): string | undefined {
  for (const invocation of [spec.name, ...spec.aliases]) {
    const subject = SUBJECT_FLAGS.get(invocation);
    if (subject !== undefined) return subject;
  }
  return undefined;
}

export function explicitActingClaim(spec: CommandSpec, flags: Flags): string | undefined {
  if (!requiresActingIdentity(spec)) return undefined;
  const subject = subjectFlag(spec);
  const candidates =
    subject === undefined ? ACTING_FLAGS : ACTING_FLAGS.filter((name) => name !== subject);
  for (const name of candidates) {
    const value = identity(flags, name);
    if (value !== undefined) return value;
  }
  return undefined;
}

export const SELF_SERVICE_SUBJECT_COMMANDS: ReadonlySet<string> = new Set([
  "agent:report",
  "agent:release",
]);

export const GRANT_REQUIRED_ROLE_CONTRACT_EXEMPT_COMMANDS: ReadonlySet<string> = new Set([
  "recover",
  "doctor:repair",
  "worktree:reclaim",
  "orphan:dispose",
  "authority:decide",
  "run:complete",
  "gate:prove",
]);

export function actsOnOwnGrant(spec: CommandSpec, flags: Flags, caller: string): boolean {
  if (!SELF_SERVICE_SUBJECT_COMMANDS.has(spec.name)) return false;
  const subject = subjectFlag(spec);
  return subject !== undefined && identity(flags, subject) === caller;
}

export const RUN_SCOPED_GRANT_BOOTSTRAP_EXEMPT_COMMANDS: ReadonlySet<string> = new Set([
  "orchestrator:run",
]);

export function isBootstrapExempt(spec: CommandSpec): boolean {
  return isGrantBootstrapExempt(spec) || RUN_SCOPED_GRANT_BOOTSTRAP_EXEMPT_COMMANDS.has(spec.name);
}

export function isMissingCapsuleExempt(spec: CommandSpec): boolean {
  return (
    isMissingCapsuleBootstrapExempt(spec) ||
    RUN_SCOPED_GRANT_BOOTSTRAP_EXEMPT_COMMANDS.has(spec.name)
  );
}

export function isNoRunBootstrapExempt(spec: CommandSpec, flags: Flags): boolean {
  if (spec.name === "plan:brainstorm") return identity(flags, "prompt") !== undefined;
  return isBootstrapExempt(spec);
}

export function capsuleState(runRoot: string): RunState | undefined {
  if (!existsSync(join(runRoot, "state.json"))) return undefined;
  try {
    return loadRun(runRoot).state;
  } catch {
    return undefined;
  }
}

export function normalizeRoleForContract(role: string): string {
  const norm = role.toLowerCase().trim();
  if (norm === "meta-auditor" || norm === "meta_auditor") return "skill-auditor";
  if (norm === "critic") return "completeness-critic";
  if (norm === "worker") return "implementer";
  if (norm === "orch") return "orchestrator";
  if (norm === "coord") return "coordinator";
  return norm;
}
