import type { AgentGrantRecord } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import {
  recordAgentReport,
  refreshAgentDerivedTelemetry,
  releaseAgentGrant,
} from "../../workflow/agents/grants.ts";
import { readAgentLedger } from "../../workflow/agents/ledger.ts";
import { ancestorChain, taskLineage } from "../../workflow/agents/lineage.ts";
import {
  formatAgentLineageBrief,
  formatAgentListBrief,
  formatAgentReleaseBrief,
  formatAgentReportBrief,
} from "../formatters/agent-formatter.ts";
import { probeAgentTelemetry, withHostTelemetryConflicts } from "../host-telemetry-probe.ts";
import { boolFlag, integerFlag, textFlag, type Flags } from "../options.ts";
import { tokenExtraFlags, toolRefFlags } from "../taxonomy-flags.ts";

export { agentRegisterCommand } from "./agent-registration.ts";

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
