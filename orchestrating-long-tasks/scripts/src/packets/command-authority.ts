import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RunState } from "../contracts/capsule.ts";
import type { AgentRole } from "../contracts/packets.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { loadRun } from "../store/index.ts";
import { readAgentLedger } from "../workflow/agents/ledger.ts";
import type { Flags } from "../cli/options.ts";
import type { CommandSpec } from "../cli/registry/types.ts";
import { loadRoleContract, resolveRoleContractPath } from "./role-contract.ts";

/** The flag naming the agent whose contract governs an invocation, in priority order. */
const ACTING_FLAGS: readonly string[] = ["agent", "validator", "critic", "actor"];

/**
 * Commands whose identity flag names the agent being HANDED authority rather than the one calling:
 * `agent:*` names the subagent being registered, reported on or released, `queue:pop` the agent the
 * lease goes to, and `critic:start` the critic being authorised. Every one of these is dispatched
 * by a coordinator, whose contract is the only one that grants them. Charging the subject's
 * contract for a call it did not make would both refuse the coordinator's own documented dispatch
 * and attribute the invocation to the wrong agent, so the subject flag is skipped here; where the
 * command has no `--actor` the run holds no record of who called and no contract is resolved.
 */
const SUBJECT_FLAGS: ReadonlyMap<string, string> = new Map([
  ["agent:register", "agent"],
  ["agent:report", "agent"],
  ["agent:release", "agent"],
  ["queue:pop", "agent"],
  ["critic:start", "critic"],
]);

/**
 * A blank, repeated or malformed identity flag is the handler's error to report, in its own words.
 * Resolving which contract governs the call must not pre-empt that with a different message for the
 * same mistake, so anything but a single non-blank value reads as "no identity given here".
 */
function identity(flags: Flags, name: string): string | undefined {
  const value = Object.hasOwn(flags, name) ? flags[name] : undefined;
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function subjectFlag(spec: CommandSpec): string | undefined {
  for (const invocation of [spec.name, ...spec.aliases]) {
    const subject = SUBJECT_FLAGS.get(invocation);
    if (subject !== undefined) return subject;
  }
  return undefined;
}

function actingAgent(spec: CommandSpec, flags: Flags): string | undefined {
  const subject = subjectFlag(spec);
  const candidates =
    subject === undefined ? ACTING_FLAGS : ACTING_FLAGS.filter((name) => name !== subject);
  for (const name of candidates) {
    const value = identity(flags, name);
    if (value !== undefined) return value;
  }
  return undefined;
}

function capsuleState(runRoot: string): RunState | undefined {
  // Before plan:init has run, `--run` names a run id rather than a capsule root. There is no ledger
  // to read then, and therefore no recorded role whose contract could govern the call.
  if (!existsSync(join(runRoot, "state.json"))) return undefined;
  try {
    return loadRun(runRoot).state;
  } catch {
    // A capsule an integrity check refuses to load carries no readable ledger either, so there is
    // still no grant to enforce against. Throwing here would also make `doctor:repair` unrunnable
    // on the exact capsule it exists to fix - the command's own INTEGRITY error is the real signal.
    return undefined;
  }
}

/**
 * Refuses an invocation the role's capability document does not list. The message names the role,
 * the command and the document, so the refusal can be checked against the contract on disk rather
 * than taken on trust.
 */
export function assertRoleMayInvoke(role: AgentRole, spec: CommandSpec, agentId: string): void {
  const contract = loadRoleContract(role);
  const invocations = [spec.name, ...spec.aliases];
  if (invocations.some((invocation) => contract.commands.includes(invocation))) return;
  throw new HarnessError(
    "INVALID_STATE",
    `role ${role} may not invoke ${spec.name}: agent ${agentId} holds a ${role} grant, and the contract at ${resolveRoleContractPath(role)} grants only ${contract.commands.join(", ")}`,
  );
}

/**
 * The dispatch-time half of the role contracts. The acting agent's role comes from the grant ledger
 * — a record the coordinator wrote through `agent:register` — and never from the shape of an agent
 * id. An identity with no grant has no recorded role at all, so there is no contract to enforce and
 * nothing here invents one; what refuses an unregistered agent is the published-packet requirement
 * on the actions that carry authority, submit and review.
 */
export function assertGrantedCommand(spec: CommandSpec, flags: Flags): void {
  const runRoot = identity(flags, "run");
  if (runRoot === undefined) return;
  const agentId = actingAgent(spec, flags);
  if (agentId === undefined) return;
  const state = capsuleState(runRoot);
  if (state === undefined) return;
  const grant = readAgentLedger(state).find((entry) => entry.id === agentId);
  if (!grant) return;
  assertRoleMayInvoke(grant.role, spec, agentId);
}
