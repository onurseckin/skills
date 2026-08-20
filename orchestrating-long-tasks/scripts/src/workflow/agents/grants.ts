import type {
  AgentGrantRecord,
  AgentModelTier,
  AgentToolRef,
  AgentToolUse,
  ThinkingLevel,
} from "../../contracts/agents.ts";
import type { RunState } from "../../contracts/capsule.ts";
import { estimated, evidenced, type Evidenced } from "../../contracts/evidence.ts";
import type { JsonObject } from "../../contracts/json.ts";
import type { AgentRole } from "../../contracts/packets.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { transact } from "../../store/index.ts";
import { requireText } from "../task-state.ts";
import {
  assertAgentBudget,
  findGrant,
  knownTaskIds,
  readAgentLedger,
  replaceGrant,
  requireGrant,
  writeAgentLedger,
} from "./ledger.ts";
import {
  applyDerivedTelemetry,
  checkParentAgentConflict,
  transcriptAuditContext,
  type DerivedTelemetryInput,
  type TelemetryFieldConflict,
} from "./telemetry-merge.ts";

export type { DerivedTelemetryInput, TelemetryFieldConflict } from "./telemetry-merge.ts";
export { refreshAgentDerivedTelemetry } from "./telemetry-merge.ts";

export interface GrantTelemetryInput {
  provider?: string;
  model?: string;
  modelTier?: AgentModelTier;
  thinkingLevel?: ThinkingLevel;
  contextWindow?: number;
  toolsGranted?: readonly AgentToolRef[];
}

export interface RegisterAgentInput {
  runRoot: string;
  agentId: string;
  role: AgentRole;
  parentAgentId: null | string;
  parentTaskId: null | string;
  host: string;
  actor: string;
  maxAgents: number;
  telemetry: GrantTelemetryInput;
  /** The host's own config, probed automatically at the CLI boundary rather than asked of the agent. */
  derivedTelemetry?: DerivedTelemetryInput;
  now?: Date;
}

export interface AgentReportInput {
  runRoot: string;
  agentId: string;
  actor: string;
  tools: readonly AgentToolRef[];
  tokensIn?: number;
  tokensOut?: number;
  /** Provider-specific counters keyed by the name the caller reported them under. */
  tokenExtras?: Readonly<Record<string, number>>;
  tokensEstimated: boolean;
  now?: Date;
}

export interface ReleaseAgentInput {
  runRoot: string;
  agentId: string;
  actor: string;
  reason: string;
  now?: Date;
}

export interface AgentGrantOutcome {
  grant: AgentGrantRecord;
  ledger: AgentGrantRecord[];
  state: RunState;
  /** Present only where a derived probe ran alongside an explicit report and the two disagreed. */
  conflicts?: readonly TelemetryFieldConflict[];
}

/**
 * A tier or thinking level typed on the CLI is whatever the calling process (usually the
 * coordinator relaying what it was told) claims — nothing here confirms it came from the host
 * itself, so it earns the same `agent_reported` class as `--tool` rather than `host_reported`
 * (B39 finding 1). An explicit "unknown" is the one exception: that is a claim of not knowing,
 * not an unverified claim of fact, so it keeps the `unknown` class instead.
 */
function explicitLevel<T extends string>(value: T): Evidenced<T> {
  return evidenced(value, value === "unknown" ? "unknown" : "agent_reported");
}

type GrantTelemetryFields = Pick<
  AgentGrantRecord,
  | "provider"
  | "model"
  | "model_tier"
  | "thinking_level"
  | "context_window"
  | "tools_granted"
  | "tokens_in"
  | "tokens_out"
  | "token_extras"
  | "tools_used"
>;

/**
 * Every one of these arrives as free-text CLI input from whichever process called the harness —
 * indistinguishable, mechanically, from `--tool` below, which has always correctly carried
 * `agent_reported`. Nothing here confirms the value actually came from the host; that confirmation
 * is what `probeAgentTelemetry`'s two real sources — `detectHostTelemetry` reading the host's own
 * config, `readAgentTranscriptTelemetry` reading its own transcript (B34) — separately earn,
 * merged in afterward by `mergeTelemetry` below. Stamping these `host_reported` unconditionally
 * was B39 finding 1: a caller could type a nonexistent model id and have it recorded as though the
 * host had attested to it.
 */
function telemetryFields(telemetry: GrantTelemetryInput): GrantTelemetryFields {
  return {
    ...(telemetry.provider === undefined
      ? {}
      : { provider: evidenced(telemetry.provider, "agent_reported") }),
    ...(telemetry.model === undefined
      ? {}
      : { model: evidenced(telemetry.model, "agent_reported") }),
    ...(telemetry.modelTier === undefined ? {} : { model_tier: explicitLevel(telemetry.modelTier) }),
    ...(telemetry.thinkingLevel === undefined
      ? {}
      : { thinking_level: explicitLevel(telemetry.thinkingLevel) }),
    ...(telemetry.contextWindow === undefined
      ? {}
      : { context_window: evidenced(telemetry.contextWindow, "agent_reported") }),
    ...(telemetry.toolsGranted === undefined
      ? {}
      : { tools_granted: evidenced([...telemetry.toolsGranted], "agent_reported") }),
  };
}

/**
 * Folds a derived host-config probe and a transcript read into the explicitly reported telemetry.
 * Model tier is deliberately untouched: nothing legitimately infers a tier from a model string, so
 * neither probe ever carries one and there is no field here to merge it into.
 */
function mergeTelemetry(
  telemetry: GrantTelemetryInput,
  derived: DerivedTelemetryInput | undefined,
  conflicts: TelemetryFieldConflict[],
  observedAt: string,
): GrantTelemetryFields {
  const explicit = telemetryFields(telemetry);
  const merged = applyDerivedTelemetry(explicit, derived, conflicts, observedAt);
  return {
    ...(explicit.model_tier === undefined ? {} : { model_tier: explicit.model_tier }),
    ...(explicit.tools_granted === undefined ? {} : { tools_granted: explicit.tools_granted }),
    ...merged,
  };
}

function requireKnownTask(state: JsonObject, taskId: null | string): void {
  if (taskId === null) return;
  if (!knownTaskIds(state).has(taskId)) {
    throw new HarnessError(
      "INVALID_STATE",
      `parent task ${taskId} does not exist in this run; a grant cannot bind to an unknown task`,
    );
  }
}

export function registerAgentGrant(input: RegisterAgentInput): AgentGrantOutcome {
  if (input.parentAgentId === input.agentId) {
    throw new HarnessError("INVALID_ARGUMENT", "an agent cannot be its own parent");
  }
  const grantedAt = (input.now ?? new Date()).toISOString();
  const conflicts: TelemetryFieldConflict[] = [];
  const fields = mergeTelemetry(input.telemetry, input.derivedTelemetry, conflicts, grantedAt);
  checkParentAgentConflict(input.parentAgentId, input.derivedTelemetry?.transcript, conflicts);
  const transcriptContext = transcriptAuditContext(input.derivedTelemetry?.transcript);
  let minted: AgentGrantRecord | undefined;
  let ledgerAfter: AgentGrantRecord[] = [];
  const state = transact(
    input.runRoot,
    input.actor,
    "agent-registered",
    {
      agent_id: input.agentId,
      role: input.role,
      parent_agent_id: input.parentAgentId,
      parent_task_id: input.parentTaskId,
      host: input.host,
      granted_at: grantedAt,
      telemetry_recorded: Object.keys(fields),
      ...(input.derivedTelemetry?.capabilities === undefined
        ? {}
        : {
            host_capabilities: input.derivedTelemetry.capabilities,
            ...(input.derivedTelemetry.hostTool === undefined
              ? {}
              : { host_capabilities_source: input.derivedTelemetry.hostTool }),
          }),
      ...(transcriptContext === undefined ? {} : { transcript_context: transcriptContext }),
      ...(conflicts.length === 0 ? {} : { telemetry_conflicts: conflicts }),
    },
    (draft) => {
      const ledger = readAgentLedger(draft);
      if (findGrant(ledger, input.agentId)) {
        throw new HarnessError(
          "INVALID_STATE",
          `agent ${input.agentId} already holds a grant in this run`,
        );
      }
      // Lineage only closes if the parent is already on the ledger, so an unregistered parent is
      // refused rather than recorded as a dangling reference.
      if (input.parentAgentId !== null) requireGrant(ledger, input.parentAgentId);
      requireKnownTask(draft, input.parentTaskId);
      // Last, so a duplicate id or a dangling parent is still named for what it is when the run is
      // sitting on the budget line.
      assertAgentBudget(ledger, 1, input.maxAgents);
      const grant: AgentGrantRecord = {
        id: input.agentId,
        role: input.role,
        parent_agent_id: input.parentAgentId,
        parent_task_id: input.parentTaskId,
        host: input.host,
        granted_at: grantedAt,
        status: "active",
        ...fields,
      };
      minted = grant;
      ledgerAfter = [...ledger, grant];
      writeAgentLedger(draft, ledgerAfter);
    },
  );
  if (!minted) throw new HarnessError("INVALID_STATE", "agent grant was not minted");
  return {
    grant: minted,
    ledger: ledgerAfter,
    state,
    ...(conflicts.length === 0 ? {} : { conflicts }),
  };
}

/**
 * Tools arrive over the CLI from the agent, not from the host runtime, so they carry the
 * `agent_reported` class — the same class every other explicitly-reported field above now carries,
 * since none of them are facts the host itself handed over either (B39 finding 1). Only a value
 * `probeAgentTelemetry` actually reads off the host's own config or transcript earns `derived` or
 * `harness_observed`.
 *
 * A tool already on the ledger keeps the moment it was first seen; a later report may still attach
 * the category and extras it did not carry the first time, because that is new information rather
 * than a correction.
 */
function mergeTools(
  existing: readonly AgentToolUse[],
  reported: readonly AgentToolRef[],
  at: string,
): AgentToolUse[] {
  const merged = [...existing];
  for (const tool of reported) {
    const index = merged.findIndex((entry) => entry.name === tool.name);
    if (index === -1) {
      merged.push({
        ...tool,
        evidence_class: "agent_reported",
        first_reported_at: at,
      });
      continue;
    }
    const previous = merged[index]!;
    merged[index] = {
      ...previous,
      ...(tool.category === undefined ? {} : { category: tool.category }),
      ...(tool.extras === undefined ? {} : { extras: { ...previous.extras, ...tool.extras } }),
    };
  }
  return merged;
}

/**
 * The counters a host keeps beyond input and output, each labelled the same way the totals are —
 * `agent_reported` for a plain `--token-extra` typed on the CLI (B39 finding 1: nothing here
 * verifies the caller relayed it honestly), `derived` and flagged `is_estimated` only when
 * `--tokens-estimated` says so outright. A later report replaces a counter it names and leaves
 * every other one standing.
 */
function mergeTokenExtras(
  existing: Record<string, Evidenced<number>> | undefined,
  reported: Readonly<Record<string, number>> | undefined,
  isEstimate: boolean,
): Record<string, Evidenced<number>> | undefined {
  if (reported === undefined || Object.keys(reported).length === 0) return existing;
  const merged: Record<string, Evidenced<number>> = { ...existing };
  for (const [name, count] of Object.entries(reported)) {
    merged[name] = isEstimate ? estimated(count) : evidenced(count, "agent_reported");
  }
  return merged;
}

/** Same rule as `mergeTokenExtras` above: a plain `--tokens-in`/`--tokens-out` count is unverified
 * CLI input, not a host attestation, unless a transcript probe later corroborates it. */
function tokenCount(value: number | undefined, isEstimate: boolean): Evidenced<number> | undefined {
  if (value === undefined) return undefined;
  return isEstimate ? estimated(value) : evidenced(value, "agent_reported");
}

export function recordAgentReport(input: AgentReportInput): AgentGrantOutcome {
  const reportedExtras = Object.keys(input.tokenExtras ?? {}).length;
  if (
    input.tools.length === 0 &&
    input.tokensIn === undefined &&
    input.tokensOut === undefined &&
    reportedExtras === 0
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "agent:report needs at least one of --tool, --tokens-in, --tokens-out or --token-extra",
    );
  }
  const reportedAt = (input.now ?? new Date()).toISOString();
  const tokensIn = tokenCount(input.tokensIn, input.tokensEstimated);
  const tokensOut = tokenCount(input.tokensOut, input.tokensEstimated);
  let updated: AgentGrantRecord | undefined;
  let ledgerAfter: AgentGrantRecord[] = [];
  const state = transact(
    input.runRoot,
    input.actor,
    "agent-reported",
    {
      agent_id: input.agentId,
      tools: input.tools.map((tool) => tool.name),
      reported_at: reportedAt,
      ...(tokensIn === undefined ? {} : { tokens_in: tokensIn.value }),
      ...(tokensOut === undefined ? {} : { tokens_out: tokensOut.value }),
      is_estimated: input.tokensEstimated,
    },
    (draft) => {
      const ledger = readAgentLedger(draft);
      const grant = requireGrant(ledger, input.agentId);
      if (grant.status === "released") {
        throw new HarnessError(
          "INVALID_STATE",
          `agent ${input.agentId} released its grant and can no longer report`,
        );
      }
      const tools = mergeTools(grant.tools_used ?? [], input.tools, reportedAt);
      const tokenExtras = mergeTokenExtras(
        grant.token_extras,
        input.tokenExtras,
        input.tokensEstimated,
      );
      const next: AgentGrantRecord = {
        ...grant,
        ...(tools.length === 0 ? {} : { tools_used: tools }),
        ...(tokensIn === undefined ? {} : { tokens_in: tokensIn }),
        ...(tokensOut === undefined ? {} : { tokens_out: tokensOut }),
        ...(tokenExtras === undefined ? {} : { token_extras: tokenExtras }),
        last_reported_at: reportedAt,
        report_count: (grant.report_count ?? 0) + 1,
      };
      updated = next;
      ledgerAfter = replaceGrant(ledger, next);
      writeAgentLedger(draft, ledgerAfter);
    },
  );
  if (!updated) throw new HarnessError("INVALID_STATE", "agent report was not recorded");
  return { grant: updated, ledger: ledgerAfter, state };
}

export function releaseAgentGrant(input: ReleaseAgentInput): AgentGrantOutcome {
  // B21: releasing a grant terminates or closes out an agent's participation in the run, one of
  // the transitions B21.1 names outright — refused here, at the transition itself, rather than
  // trusting the CLI flag parser a future caller of this function could bypass.
  requireText(input.reason, "reason");
  const releasedAt = (input.now ?? new Date()).toISOString();
  let updated: AgentGrantRecord | undefined;
  let ledgerAfter: AgentGrantRecord[] = [];
  const state = transact(
    input.runRoot,
    input.actor,
    "agent-released",
    {
      agent_id: input.agentId,
      released_at: releasedAt,
      reason: input.reason,
    },
    (draft) => {
      const ledger = readAgentLedger(draft);
      const grant = requireGrant(ledger, input.agentId);
      if (grant.status === "released") {
        throw new HarnessError(
          "INVALID_STATE",
          `agent ${input.agentId} already released its grant at ${grant.released_at ?? "an unrecorded time"}`,
        );
      }
      const next: AgentGrantRecord = {
        ...grant,
        status: "released",
        released_at: releasedAt,
        release_reason: input.reason,
      };
      updated = next;
      ledgerAfter = replaceGrant(ledger, next);
      writeAgentLedger(draft, ledgerAfter);
    },
  );
  if (!updated) throw new HarnessError("INVALID_STATE", "agent release was not recorded");
  return { grant: updated, ledger: ledgerAfter, state };
}
