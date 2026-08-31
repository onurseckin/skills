import { HarnessError } from "../core/errors/index.ts";
import { readAgentLedger } from "../workflow/agents/ledger.ts";
import type { Flags } from "../cli/options.ts";
import type { CommandSpec } from "../cli/registry/types.ts";
import { declaresRunIdentityFlag, requiresActingIdentity } from "./grant-bootstrap-allowlist.ts";
import {
  isCognitiveValidatorRole,
  isExecutionToolCategory,
  isMechanicValidatorRole,
  PROHIBITED_COGNITIVE_TOOLS,
} from "./command-authority-predicates.ts";
import { assertSpawnAuthorized, roleToTier } from "./command-authority-hierarchy.ts";
import { assertCoordinatorPreToolGuard } from "../authority/guards/index.ts";
import {
  formatHardlockRemediation,
  formatSupervisionRemediation,
  resolveCurrentHost,
  type DetectedHost,
} from "./command-authority-remediation.ts";
import {
  actsOnOwnGrant,
  capsuleState,
  explicitActingClaim,
  GRANT_REQUIRED_ROLE_CONTRACT_EXEMPT_COMMANDS,
  identity,
  isBootstrapExempt,
  isMissingCapsuleExempt,
  isNoRunBootstrapExempt,
  SELF_SERVICE_SUBJECT_COMMANDS,
  subjectFlag,
} from "./command-authority-state.ts";
import { assertRoleMayInvoke } from "./command-authority-invocation.ts";

export { explicitActingClaim } from "./command-authority-state.ts";
export { assertRoleMayInvoke } from "./command-authority-invocation.ts";

export interface AuthenticatedCaller {
  readonly actor: string;
  readonly role: string;
  readonly verified: boolean;
}

export function assertAgentRegisterHierarchy(
  flags: Flags,
  ledger: ReturnType<typeof readAgentLedger>,
  agentId: string | undefined,
  host?: DetectedHost,
): void {
  const childRole = identity(flags, "role");
  if (childRole === undefined) return;
  const parentAgentId = identity(flags, "parent-agent");
  const childAgentId = identity(flags, "agent");
  const activeHost = host !== undefined ? host : resolveCurrentHost();

  if (parentAgentId !== undefined) {
    const parentGrant = ledger.find((entry) => entry.id === parentAgentId);
    if (!parentGrant) {
      throw new HarnessError(
        "INVALID_STATE",
        `--parent-agent ${parentAgentId} does not resolve to any grant in this run; an unresolvable parent cannot supervise agent:register`,
      );
    }
    if (parentGrant.status !== "active") {
      throw new HarnessError(
        "INVALID_STATE",
        `parent agent ${parentAgentId} holds a ${parentGrant.status} grant, not an active one, and cannot supervise agent:register`,
      );
    }
    if (agentId === undefined || agentId !== parentAgentId) {
      throw new HarnessError(
        "AUTHENTICATION_FAILURE",
        agentId === undefined
          ? `agent:register with --parent-agent '${parentAgentId}' carries no resolvable acting identity (--actor/--agent/--validator/--critic); registering under a named parent means claiming that parent's spawn authority, and an absent identity cannot prove that claim, so it is refused rather than passed`
          : `acting identity '${agentId}' does not match --parent-agent '${parentAgentId}'; agent:register may only be invoked by the parent agent itself, on its own behalf, not by naming an unrelated agent's grant as the parent to borrow its spawn authority`,
      );
    }
    assertSpawnAuthorized(parentGrant.role, childRole, parentAgentId, childAgentId, activeHost);
    return;
  }

  const genesis = ledger.length === 0;
  if (genesis) return;

  const childTier = roleToTier(childRole);
  if (childTier > 1) {
    const remediation = formatSupervisionRemediation(childRole, childTier, activeHost);
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Hierarchical supervision violation: Role '${childRole}' (Tier ${childTier}) cannot be dispatched without a supervising parent agent. Tier 2 Coordinators must be spawned by Tier 1 Orchestrators, and Tier 3 workers must be spawned by Tier 2 Coordinators. ${remediation}`,
    );
  }

  if (agentId === undefined) {
    throw new HarnessError(
      "INVALID_STATE",
      `agent:register carries no resolvable acting identity (--actor/--validator/--critic) and the run's agent ledger already holds an active grant; registering an unparented Tier ${childTier} agent as root is only legitimate on an empty ledger`,
    );
  }
  const actingGrant = ledger.find((entry) => entry.id === agentId && entry.status === "active");
  if (!actingGrant) {
    throw new HarnessError(
      "INVALID_STATE",
      `acting agent ${agentId} holds no active grant in this run, and the agent ledger already holds other active grants; it cannot register an unparented (root) agent`,
    );
  }
  assertSpawnAuthorized(actingGrant.role, childRole, agentId, childAgentId, activeHost);
}

export function assertSubjectTargetPolicy(
  spec: CommandSpec,
  flags: Flags,
  caller: string,
  ledger: ReturnType<typeof readAgentLedger>,
): void {
  if (!SELF_SERVICE_SUBJECT_COMMANDS.has(spec.name)) return;
  const subject = subjectFlag(spec);
  const target = subject === undefined ? undefined : identity(flags, subject);
  if (target === undefined) return;
  if (spec.name === "agent:report" && caller !== target) {
    throw new HarnessError(
      "AUTHENTICATION_FAILURE",
      `agent:report target '${target}' does not match authenticated caller '${caller}'; agents may report only their own grant`,
    );
  }
  if (spec.name === "agent:release" && caller !== target) {
    const targetGrant = ledger.find((grant) => grant.id === target);
    if (targetGrant?.parent_agent_id !== caller) {
      throw new HarnessError(
        "AUTHENTICATION_FAILURE",
        `agent:release target '${target}' is not the authenticated caller '${caller}' or its active direct child`,
      );
    }
  }
}

export function assertGrantedCommand(
  spec: CommandSpec,
  flags: Flags,
  caller?: AuthenticatedCaller,
  host?: DetectedHost,
): void {
  if (!requiresActingIdentity(spec)) return;

  const activeHost = host !== undefined ? host : resolveCurrentHost();
  const authorityRun = identity(flags, "authority-run");
  if (spec.authority !== undefined && authorityRun === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `${spec.name} requires --authority-run; repository-global and cross-run mutations must name the distinct run whose active grant authorizes them`,
    );
  }
  const runRoot = authorityRun ?? identity(flags, "run");
  if (runRoot === undefined) {
    if (!declaresRunIdentityFlag(spec)) return;
    if (isNoRunBootstrapExempt(spec, flags)) return;
    throw new HarnessError(
      "INVALID_STATE",
      `${spec.name} carries no resolvable --run and is not on the grant bootstrap allowlist; a capsule root is required before its grant authority can be checked`,
    );
  }
  const claim = explicitActingClaim(spec, flags);
  if (caller !== undefined && claim !== undefined && claim !== caller.actor) {
    throw new HarnessError(
      "AUTHENTICATION_FAILURE",
      `explicit acting identity '${claim}' does not match authenticated caller '${caller.actor}'`,
    );
  }
  const agentId = caller?.actor;

  if (spec.name === "agent:register") {
    const state = capsuleState(runRoot);
    if (state === undefined) {
      throw new HarnessError(
        "INVALID_STATE",
        `agent:register could not load capsule state at --run ${runRoot}; first-grant genesis requires a readable empty agent ledger, and an unreadable capsule cannot be treated as one`,
      );
    }
    const ledger = readAgentLedger(state);
    const genesis = ledger.length === 0;
    const verifiedCaller = caller?.verified === true && agentId !== undefined;
    const parentAgentId = identity(flags, "parent-agent");

    if (!verifiedCaller && (parentAgentId !== undefined || !genesis)) {
      throw new HarnessError(
        "AUTHENTICATION_FAILURE",
        parentAgentId === undefined
          ? "agent:register requires a verified caller session backed by an active run grant before it may register into a nonempty agent ledger; explicit identity flags cannot establish authority"
          : `agent:register requires a verified caller session backed by an active run grant before it may claim --parent-agent '${parentAgentId}' spawn authority; explicit identity flags cannot establish authority`,
      );
    }

    assertAgentRegisterHierarchy(flags, ledger, verifiedCaller ? agentId : undefined, activeHost);
    if (genesis) return;
  }

  if (agentId === undefined || !caller?.verified) {
    if (isBootstrapExempt(spec)) return;
    throw new HarnessError(
      "AUTHENTICATION_FAILURE",
      spec.authority === undefined
        ? `${spec.name} requires a verified caller session backed by an active run grant; explicit identity flags cannot establish authority`
        : "governed mutation requires a verified caller session backed by an active authority-run grant; explicit identity flags cannot establish authority",
    );
  }
  const state = capsuleState(runRoot);
  if (state === undefined) {
    if (isMissingCapsuleExempt(spec)) return;
    throw new HarnessError(
      "INVALID_STATE",
      `${spec.name} could not load capsule state at --run ${runRoot} and is not on the grant bootstrap allowlist for missing capsules; an unreadable capsule cannot be treated as one with no grants`,
    );
  }
  const ledger = readAgentLedger(state);
  const rawGrant = ledger.find((entry) => entry.id === agentId);
  if (rawGrant && rawGrant.status !== "active") {
    throw new HarnessError(
      "INVALID_STATE",
      `agent ${agentId} holds a ${rawGrant.status} grant, not an active one, and may not invoke ${spec.name}`,
    );
  }
  const grant = rawGrant;
  if (!grant) {
    if (isBootstrapExempt(spec)) return;
    throw new HarnessError(
      "PERMISSION_DENIED",
      `agent ${agentId} holds no grant in the capsule at --run ${runRoot} and ${spec.name} is not on the grant bootstrap allowlist`,
    );
  }

  assertSubjectTargetPolicy(spec, flags, agentId, ledger);

  const toolCat = identity(flags, "tool-category");
  if (toolCat) {
    assertCoordinatorPreToolGuard(grant.role, toolCat, agentId);
  }
  if (
    toolCat &&
    isExecutionToolCategory(toolCat) &&
    isCognitiveValidatorRole(grant.role) &&
    !isMechanicValidatorRole(grant.role)
  ) {
    const remediation = formatHardlockRemediation(activeHost);
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `role ${grant.role} may not invoke execution tool category '${toolCat}': agent ${agentId} is a cognitive validator, and shell/execution tools belong exclusively to mechanic validators. ${remediation}`,
    );
  }

  const toolName = identity(flags, "tool");
  if (toolName) {
    assertCoordinatorPreToolGuard(grant.role, toolName, agentId);
  }
  if (
    toolName &&
    (PROHIBITED_COGNITIVE_TOOLS.has(toolName.toLowerCase().trim()) ||
      isExecutionToolCategory(toolName)) &&
    isCognitiveValidatorRole(grant.role) &&
    !isMechanicValidatorRole(grant.role)
  ) {
    const remediation = formatHardlockRemediation(activeHost);
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `role ${grant.role} may not invoke execution tool '${toolName}': agent ${agentId} is a cognitive validator, and shell/execution tools belong exclusively to mechanic validators. ${remediation}`,
    );
  }

  if (actsOnOwnGrant(spec, flags, agentId)) return;
  if (GRANT_REQUIRED_ROLE_CONTRACT_EXEMPT_COMMANDS.has(spec.name)) return;
  if (spec.authority !== undefined && !spec.authority.allowedRoles.includes(grant.role)) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `role ${grant.role} may not invoke ${spec.name}: agent ${agentId} holds a ${grant.role} grant, but this governed mutation is reserved for ${spec.authority.allowedRoles.join(", ")}`,
    );
  }
  assertRoleMayInvoke(grant.role, spec, agentId, activeHost);
}
