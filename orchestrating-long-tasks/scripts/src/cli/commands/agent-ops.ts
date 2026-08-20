import { dirname } from "node:path";
import {
  AGENT_MODEL_TIERS,
  isAgentModelTier,
  isThinkingLevel,
  THINKING_LEVELS,
  type AgentGrantRecord,
  type AgentModelTier,
  type ThinkingLevel,
} from "../../contracts/agents.ts";
import { getHarnessConfig } from "../../config/harness-config.ts";
import { AGENT_ROLES, isAgentRole, type AgentRole } from "../../contracts/packets.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { loadRun } from "../../store/index.ts";
import {
  recordAgentReport,
  refreshAgentDerivedTelemetry,
  registerAgentGrant,
  releaseAgentGrant,
  type GrantTelemetryInput,
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
import { boolFlag, integerFlag, textFlag, type Flags } from "../options.ts";
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

// Telemetry the host did not supply stays out of the record entirely; there is no default provider,
// model, tier, thinking level, context window or toolset to fall back on.
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

export function agentRegisterCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const agent = textFlag(flags, "agent")!;
  const parentAgent = textFlag(flags, "parent-agent", false) ?? null;
  const parentTask = textFlag(flags, "parent-task", false) ?? null;
  const actor = textFlag(flags, "actor", false) ?? parentAgent ?? agent;
  const derivedTelemetry = probeAgentTelemetry(agent);
  const outcome = registerAgentGrant({
    runRoot: run,
    agentId: agent,
    role: roleFlag(flags),
    parentAgentId: parentAgent,
    parentTaskId: parentTask,
    host: textFlag(flags, "host")!,
    actor,
    // The capsule lives at <repo>/.capsules/<run-id>, so the budget is read from the repo the run
    // belongs to rather than whatever directory the dispatcher happened to be standing in.
    maxAgents: getHarnessConfig(dirname(dirname(run)), run).max_agents,
    telemetry: telemetryFlags(flags),
    ...(Object.keys(derivedTelemetry).length === 0 ? {} : { derivedTelemetry }),
  });
  return withHostTelemetryConflicts(
    {
      markdown: formatAgentRegisterBrief(outcome.grant, run),
      run_root: run,
      agent: outcome.grant,
      active_grants: outcome.ledger.filter((grant) => grant.status === "active").length,
    },
    outcome.conflicts,
  );
}

export function agentReportCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const agent = textFlag(flags, "agent")!;
  const tokensIn = integerFlag(flags, "tokens-in", { minimum: 0 });
  const tokensOut = integerFlag(flags, "tokens-out", { minimum: 0 });
  const tokenExtras = tokenExtraFlags(flags);
  const outcome = recordAgentReport({
    runRoot: run,
    agentId: agent,
    actor: textFlag(flags, "actor", false) ?? agent,
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
  const reason = textFlag(flags, "reason", false);
  const actor = textFlag(flags, "actor", false) ?? agent;
  // Probed and folded in before release, while the grant is still active: a released grant refuses
  // any further telemetry, the same rule `agent:report` already enforces.
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
    ...(reason === undefined ? {} : { reason }),
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
