import { basename, dirname } from "node:path";
import {
  AGENT_MODEL_TIERS,
  isAgentModelTier,
  isThinkingLevel,
  THINKING_LEVELS,
  type AgentGrantRecord,
  type AgentModelTier,
  type ThinkingLevel,
} from "../../core/contracts/index.ts";
import { getHarnessConfig } from "../../core/config/index.ts";
import { AGENT_ROLES, isAgentRole, type AgentRole } from "../../core/contracts/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { rollbackStagedSessionGrant, stageSessionGrant } from "../../authority/session-registry.ts";
import { roleToTier } from "../../authority/thread-identifier.ts";
import { writeAgentMetadata } from "../../runtime/index.ts";
import {
  isCommittedWithRecoveryPending,
  loadRun,
  recoverProjection,
  transactionRecoveryStatus,
} from "../../engine/store/index.ts";
import {
  recordAgentReport,
  refreshAgentDerivedTelemetry,
  registerAgentGrant,
  releaseAgentGrant,
  type GrantTelemetryInput,
  type RegistrationAuthority,
} from "../../workflow/agents/grants.ts";
import { readAgentLedger } from "../../workflow/agents/ledger.ts";
import { ancestorChain, taskLineage } from "../../workflow/agents/lineage.ts";
import {
  formatAgentLineageBrief,
  formatAgentListBrief,
  formatAgentRegisterBrief,
  formatAgentReleaseBrief,
  formatAgentReportBrief,
} from "../formatters/agent-formatter.ts";
import { probeAgentTelemetry, withHostTelemetryConflicts } from "../host-telemetry-probe.ts";
import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import { tokenExtraFlags, toolRefFlags } from "../taxonomy-flags.ts";

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

function assertReportTargetPolicy(agent: string, actor: string): void {
  if (actor !== agent) {
    throw new HarnessError(
      "AUTHENTICATION_FAILURE",
      `agent:report target '${agent}' does not match authenticated actor '${actor}'; agents may report only their own grant`,
    );
  }
}

function assertReleaseTargetPolicy(run: string, agent: string, actor: string): void {
  if (actor === agent) return;
  const ledger = readAgentLedger(loadRun(run).state);
  const targetGrant = ledger.find((grant) => grant.id === agent);
  const actorGrant = ledger.find((grant) => grant.id === actor);
  if (
    targetGrant?.parent_agent_id !== actor ||
    actorGrant === undefined ||
    actorGrant.status !== "active"
  ) {
    throw new HarnessError(
      "AUTHENTICATION_FAILURE",
      `agent:release target '${agent}' is not authenticated actor '${actor}' or its active direct child`,
    );
  }
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
  const bindProcessAncestry = explicitPid !== undefined;
  const stagedSession = stageSessionGrant({
    runRoot: run,
    agentId: agent,
    role,
    host,
    pid: explicitPid,
    ppid: explicitPpid,
    bindProcessAncestry,
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
    } catch {
      // The grant failure is primary and must not leak an authority token through cleanup.
    }
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
  } catch {
    // Best-effort runtime metadata persistence
  }

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

export function agentReportCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const agent = textFlag(flags, "agent")!;
  const actor = textFlag(flags, "actor", false) ?? agent;
  assertReportTargetPolicy(agent, actor);
  const tokensIn = integerFlag(flags, "tokens-in", { minimum: 0 });
  const tokensOut = integerFlag(flags, "tokens-out", { minimum: 0 });
  const tokenExtras = tokenExtraFlags(flags);
  const outcome = recordAgentReport({
    runRoot: run,
    agentId: agent,
    actor,
    tools: toolRefFlags(flags) ?? [],
    ...(tokensIn === undefined ? {} : { tokensIn }),
    ...(tokensOut === undefined ? {} : { tokensOut }),
    ...(tokenExtras === undefined ? {} : { tokenExtras }),
    tokensEstimated: boolFlag(flags, "tokens-estimated"),
  });
  return {
    markdown: formatAgentReportBrief(outcome.grant, run),
    run_root: run,
    agent: outcome.grant,
  };
}

export function agentReleaseCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const agent = textFlag(flags, "agent")!;
  const reason = textFlag(flags, "reason")!;
  const actor = textFlag(flags, "actor", false) ?? agent;
  assertReleaseTargetPolicy(run, agent, actor);
  const derivedTelemetry = probeAgentTelemetry(agent);
  const refreshed =
    Object.keys(derivedTelemetry).length === 0
      ? null
      : refreshAgentDerivedTelemetry({
          runRoot: run,
          agentId: agent,
          actor,
          boundary: "agent:release",
          derived: derivedTelemetry,
        });
  const outcome = releaseAgentGrant({
    runRoot: run,
    agentId: agent,
    actor,
    reason,
  });
  return withHostTelemetryConflicts(
    {
      markdown: formatAgentReleaseBrief(outcome.grant, run),
      run_root: run,
      agent: outcome.grant,
      active_grants: outcome.ledger.filter((grant) => grant.status === "active").length,
    },
    refreshed?.conflicts,
  );
}

function withAncestors(
  ledger: readonly AgentGrantRecord[],
): Array<AgentGrantRecord & { ancestors: string[] }> {
  return ledger.map((grant) => ({ ...grant, ancestors: ancestorChain(ledger, grant.id) }));
}

export function agentListCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const task = textFlag(flags, "task", false);
  const includeReleased = boolFlag(flags, "all");
  const ledger = readAgentLedger(loadRun(run).state);
  if (task !== undefined) {
    const lineage = taskLineage(ledger, task);
    return {
      markdown: formatAgentLineageBrief(lineage),
      run_root: run,
      lineage,
    };
  }
  const active = ledger.filter((grant) => grant.status === "active");
  return {
    markdown: formatAgentListBrief(ledger, run, includeReleased),
    run_root: run,
    agents: withAncestors(includeReleased ? ledger : active),
    active_grants: active.length,
    released_grants: ledger.length - active.length,
  };
}
