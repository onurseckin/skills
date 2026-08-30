import { basename } from "node:path";
import {
  AGENT_MODEL_TIERS,
  AGENT_ROLES,
  isAgentModelTier,
  isAgentRole,
  isThinkingLevel,
  THINKING_LEVELS,
  type AgentModelTier,
  type AgentRole,
  type ThinkingLevel,
} from "../../core/contracts/index.ts";
import { getHarnessConfig } from "../../core/config/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { rollbackStagedSessionGrant, stageSessionGrant } from "../../authority/session/index.ts";
import { roleToTier } from "../../authority/thread/index.ts";
import { writeAgentMetadata } from "../../runtime/index.ts";
import {
  isCommittedWithRecoveryPending,
  recoverProjection,
  transactionRecoveryStatus,
} from "../../engine/store/index.ts";
import {
  registerAgentGrant,
  type GrantTelemetryInput,
  type RegistrationAuthority,
} from "../../workflow/agents/grants.ts";
import { readAgentLedger } from "../../workflow/agents/ledger.ts";
import { formatAgentRegisterBrief } from "../formatters/agent-formatter.ts";
import { probeAgentTelemetry, withHostTelemetryConflicts } from "../host-telemetry-probe.ts";
import { integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import { toolRefFlags } from "../taxonomy-flags.ts";

function roleFlag(flags: Flags): AgentRole {
  const role = textFlag(flags, "role")!;
  if (!isAgentRole(role)) {
    throw new HarnessError("INVALID_ARGUMENT", `--role must be one of ${AGENT_ROLES.join(", ")}`);
  }
  return role;
}

function tierFlag(flags: Flags): AgentModelTier | undefined {
  const tier = textFlag(flags, "model-tier", false);
  if (tier === undefined) return undefined;
  if (!isAgentModelTier(tier)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `--model-tier must be one of ${AGENT_MODEL_TIERS.join(", ")}`,
    );
  }
  return tier;
}

function thinkingFlag(flags: Flags): ThinkingLevel | undefined {
  const level = textFlag(flags, "thinking-level", false);
  if (level === undefined) return undefined;
  if (!isThinkingLevel(level)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `--thinking-level must be one of ${THINKING_LEVELS.join(", ")}`,
    );
  }
  return level;
}

function telemetryFlags(flags: Flags): GrantTelemetryInput {
  const provider = textFlag(flags, "provider", false);
  const model = textFlag(flags, "model", false);
  const tier = tierFlag(flags);
  const thinking = thinkingFlag(flags);
  const contextWindow = integerFlag(flags, "context-window", { minimum: 1 });
  const tools = toolRefFlags(flags);
  return {
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(tier === undefined ? {} : { modelTier: tier }),
    ...(thinking === undefined ? {} : { thinkingLevel: thinking }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(tools === undefined ? {} : { toolsGranted: tools }),
  };
}

export function agentRegisterCommand(
  flags: Flags,
  context: CommandContext = {},
): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const agent = textFlag(flags, "agent")!;
  const parentAgent = textFlag(flags, "parent-agent", false) ?? null;
  const parentTask = textFlag(flags, "parent-task", false) ?? null;
  const caller = context.authenticatedCaller;
  const authority: RegistrationAuthority =
    caller?.verified === true
      ? { kind: "verified_parent", actorId: caller.actor }
      : { kind: "conditional_genesis" };
  const eventActor = authority.kind === "verified_parent" ? authority.actorId : agent;
  const derivedTelemetry = probeAgentTelemetry(agent);
  const role = roleFlag(flags);
  const host = textFlag(flags, "host")!;
  const hostAddress = textFlag(flags, "host-address", false);
  const pendingPhase = transactionRecoveryStatus(run);
  if (pendingPhase !== undefined) {
    const recovered = recoverProjection(run, eventActor);
    const existing = readAgentLedger(recovered).find(
      (grant) => grant.id === agent && grant.status === "active",
    );
    if (existing !== undefined) {
      return {
        markdown: formatAgentRegisterBrief(existing, run),
        run_root: run,
        agent: existing,
        active_grants: readAgentLedger(recovered).filter((grant) => grant.status === "active")
          .length,
        transaction_status: "committed_recovered",
        recovered_phase: pendingPhase,
      };
    }
  }
  const explicitPid = integerFlag(flags, "pid", { minimum: 1 });
  const explicitPpid = integerFlag(flags, "ppid", { minimum: 1 });
  const bindProcessAncestry = explicitPid !== undefined || explicitPpid !== undefined;
  const stagedSession = stageSessionGrant({
    runRoot: run,
    agentId: agent,
    role,
    host,
    bindProcessAncestry,
    ...(explicitPid === undefined ? {} : { pid: explicitPid }),
    ...(explicitPpid === undefined ? {} : { ppid: explicitPpid }),
  });
  const session = stagedSession.session;
  let outcome;
  try {
    const registration = {
      runRoot: run,
      agentId: agent,
      role,
      parentTaskId: parentTask,
      host,
      ...(hostAddress === undefined ? {} : { hostAddress }),
      maxAgents: getHarnessConfig(findRepoRoot(run), run).max_agents,
      telemetry: telemetryFlags(flags),
      ...(Object.keys(derivedTelemetry).length === 0 ? {} : { derivedTelemetry }),
    };
    if (authority.kind === "conditional_genesis") {
      outcome = registerAgentGrant({
        ...registration,
        parentAgentId: null,
        authority,
      });
    } else {
      if (parentAgent === null) {
        throw new HarnessError(
          "AUTHENTICATION_FAILURE",
          "verified parent registration requires a named parent agent",
        );
      }
      outcome = registerAgentGrant({
        ...registration,
        parentAgentId: parentAgent,
        authority,
      });
    }
  } catch (error) {
    if (isCommittedWithRecoveryPending(error)) {
      const grant = readAgentLedger(error.state).find(
        (entry) => entry.id === agent && entry.status === "active",
      );
      if (grant === undefined)
        throw new HarnessError(
          "INTEGRITY",
          `committed agent registration for ${agent} has no active grant in its event projection`,
        );
      return withHostTelemetryConflicts(
        {
          markdown: formatAgentRegisterBrief(grant, run),
          run_root: run,
          agent: grant,
          session_token: session.token,
          active_grants: readAgentLedger(error.state).filter((entry) => entry.status === "active")
            .length,
          transaction_status: "committed_with_recovery_pending",
          recovery_phase: error.marker.phase,
        },
        undefined,
      );
    }
    try {
      rollbackStagedSessionGrant(stagedSession);
    } catch {}
    throw error;
  }

  try {
    writeAgentMetadata(
      {
        agent_id: outcome.grant.id,
        role: outcome.grant.role,
        tier: roleToTier(outcome.grant.role) ?? 3,
        write_scope: [],
        allowed_read_scope: ["*"],
        can_execute_shell: true,
        spawned_at: outcome.grant.granted_at,
        run_id: basename(run),
        task_id: outcome.grant.parent_task_id ?? undefined,
      },
      run,
    );
  } catch {}

  return withHostTelemetryConflicts(
    {
      markdown: formatAgentRegisterBrief(outcome.grant, run),
      run_root: run,
      agent: outcome.grant,
      session_token: session.token,
      active_grants: outcome.ledger.filter((grant) => grant.status === "active").length,
    },
    outcome.conflicts,
  );
}
