import type { AgentGrantRecord, AgentToolUse, ThinkingLevel } from "../../contracts/agents.ts";
import type { RunState } from "../../contracts/capsule.ts";
import { evidenced, type Evidenced, type EvidenceClass } from "../../contracts/evidence.ts";
import type { JsonObject, JsonValue } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { loadRun, transact } from "../../store/index.ts";
import { findGrant, readAgentLedger, replaceGrant, requireGrant, writeAgentLedger } from "./ledger.ts";
import type { AgentTranscriptTelemetry, TranscriptToolCall } from "./transcript-telemetry.ts";

/**
 * The host's own on-disk configuration for one agent, read automatically rather than reported by a
 * flag. `capabilities` is an open bag because it names facts about the host itself (nesting depth,
 * concurrency, native primitives) that the grant record has no field for and does not need one for —
 * they are audit context, not part of the agent's contract.
 */
export interface DerivedTelemetryInput {
  /** The host runtime the values below were read off, which need not be the one the dispatcher
   * declared for the agent; recording it keeps a capability from being read as the declared host's. */
  hostTool?: string;
  provider?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  contextWindow?: number;
  capabilities?: JsonObject;
  /** Ground truth read off the host's own transcript of this agent (B34) — distinct from the fields
   * above, which come from a static config file. This is `harness_observed`, not `derived`: it is
   * what the host recorded actually happening, not a setting that merely implies it. */
  transcript?: AgentTranscriptTelemetry;
}

/**
 * Two sources named the same field and disagreed. Both values are kept — the ledger field itself
 * keeps whichever value was explicitly reported, and this record is what proves the other one
 * existed, so nothing is thrown away by picking a side.
 */
export interface TelemetryFieldConflict extends JsonObject {
  field: string;
  recorded_value: JsonValue;
  recorded_evidence_class: EvidenceClass;
  probed_value: JsonValue;
}

export interface TelemetryProbeOutcome {
  grant: AgentGrantRecord;
  ledger: AgentGrantRecord[];
  state: RunState;
  conflicts?: readonly TelemetryFieldConflict[];
}

/**
 * One field, two candidate sources. An explicit report always keeps the ledger's field — that is
 * what the field has always meant, a claim someone stood behind — but a probed value that disagrees
 * is never dropped silently: it goes into `conflicts` instead of overwriting anything. A probed
 * value only ever fills a field that has no explicit report at all, and does so tagged with
 * whichever evidence class its source earns — `derived` for a config file, `harness_observed` for a
 * transcript the host itself wrote.
 */
export function mergeDerivedField<T extends number | string>(
  explicit: Evidenced<T> | undefined,
  probed: T | undefined,
  field: string,
  conflicts: TelemetryFieldConflict[],
  evidenceClass: EvidenceClass = "derived",
): Evidenced<T> | undefined {
  if (probed === undefined) return explicit;
  if (explicit === undefined) return evidenced(probed, evidenceClass);
  if (explicit.value !== probed) {
    conflicts.push({
      field,
      recorded_value: explicit.value,
      recorded_evidence_class: explicit.evidence_class,
      probed_value: probed,
    });
  }
  return explicit;
}

/**
 * A count read off a transcript is a running total, not a one-time report: re-probing the same
 * agent later is expected to see it grow, so a `harness_observed` value is refreshed in place on
 * every read rather than being treated as a fixed fact that a later reading might "conflict" with.
 * An explicit, non-estimated report from the host is the one thing this never overwrites — a
 * disagreement with THAT is recorded, never silently replaced.
 */
export function mergeObservedCount(
  explicit: Evidenced<number> | undefined,
  observed: number | undefined,
  field: string,
  conflicts: TelemetryFieldConflict[],
): Evidenced<number> | undefined {
  if (observed === undefined) return explicit;
  if (explicit === undefined || explicit.is_estimated === true || explicit.evidence_class === "harness_observed") {
    return evidenced(observed, "harness_observed");
  }
  if (explicit.value !== observed) {
    conflicts.push({
      field,
      recorded_value: explicit.value,
      recorded_evidence_class: explicit.evidence_class,
      probed_value: observed,
    });
  }
  return explicit;
}

/**
 * Same refresh-in-place policy as `mergeObservedCount`, per counter. Disagreement on an individual
 * extra is not tracked as a `TelemetryFieldConflict` — a host can report a dozen cache/reasoning
 * counters, and flagging every one that drifts from a transcript reading would bury the conflicts
 * that matter (provider, model, the totals) under noise about counters nothing else consumes.
 */
export function mergeObservedExtras(
  existing: Record<string, Evidenced<number>> | undefined,
  observed: Readonly<Record<string, number>> | undefined,
): Record<string, Evidenced<number>> | undefined {
  if (observed === undefined || Object.keys(observed).length === 0) return existing;
  const merged: Record<string, Evidenced<number>> = { ...existing };
  for (const [name, count] of Object.entries(observed)) {
    const current = merged[name];
    if (current === undefined || current.is_estimated === true || current.evidence_class === "harness_observed") {
      merged[name] = evidenced(count, "harness_observed");
    }
  }
  return merged;
}

/**
 * Tool usage read straight off the transcript, tagged `harness_observed` rather than the
 * `agent_reported` class a CLI `--tool` flag earns — the two evidence classes coexist per tool name
 * because a self-report and a transcript read can both exist for the very same call. Call and
 * failure counts are running totals refreshed on every read, matching `mergeObservedCount` above.
 */
export function mergeObservedTools(
  existing: readonly AgentToolUse[] | undefined,
  observed: readonly TranscriptToolCall[] | undefined,
  at: string,
): AgentToolUse[] | undefined {
  if (observed === undefined || observed.length === 0) {
    return existing === undefined ? undefined : [...existing];
  }
  const merged = existing === undefined ? [] : [...existing];
  for (const tool of observed) {
    const index = merged.findIndex(
      (entry) => entry.name === tool.name && entry.evidence_class === "harness_observed",
    );
    const extras = { calls: tool.calls, failures: tool.failures };
    if (index === -1) {
      merged.push({ name: tool.name, extras, evidence_class: "harness_observed", first_reported_at: at });
      continue;
    }
    const previous = merged[index]!;
    merged[index] = { ...previous, extras: { ...previous.extras, ...extras } };
  }
  return merged;
}

/**
 * Audit context for the event log: what a transcript read found beyond the fields the grant record
 * has room for — lineage the ledger cannot express (spawn depth has no field) and the run this agent
 * was dispatched inside, kept beside the event rather than lost because the schema has no slot.
 */
export interface TranscriptAuditContext extends JsonObject {
  source_path: string;
  agent_type?: string;
  spawn_depth?: number;
  observed_parent_agent_id?: string;
  run_context?: JsonObject;
}

export function transcriptAuditContext(
  transcript: AgentTranscriptTelemetry | undefined,
): TranscriptAuditContext | undefined {
  if (transcript === undefined) return undefined;
  return {
    source_path: transcript.sourcePath,
    ...(transcript.agentType === undefined ? {} : { agent_type: transcript.agentType }),
    ...(transcript.spawnDepth === undefined ? {} : { spawn_depth: transcript.spawnDepth }),
    ...(transcript.parentAgentId === undefined
      ? {}
      : { observed_parent_agent_id: transcript.parentAgentId }),
    ...(transcript.runContext === undefined ? {} : { run_context: transcript.runContext }),
  };
}

/**
 * The grant declares its parent at registration time and the field is a plain string, not an
 * `Evidenced<T>` — there is no slot on the record itself to hold a second, disagreeing value. The
 * transcript's own lineage is still never dropped: a disagreement becomes a `TelemetryFieldConflict`
 * exactly like any other field, even though nothing here overwrites the declared parent.
 */
export function checkParentAgentConflict(
  declaredParentAgentId: string | null,
  transcript: AgentTranscriptTelemetry | undefined,
  conflicts: TelemetryFieldConflict[],
): void {
  if (transcript?.parentAgentId === undefined) return;
  if (transcript.parentAgentId === declaredParentAgentId) return;
  conflicts.push({
    field: "parent_agent_id",
    recorded_value: declaredParentAgentId,
    recorded_evidence_class: "agent_reported",
    probed_value: transcript.parentAgentId,
  });
}

/** The subset of `AgentGrantRecord` that a derived or transcript probe can ever fill or refresh. */
export type MergeableTelemetryFields = Pick<
  AgentGrantRecord,
  | "provider"
  | "model"
  | "thinking_level"
  | "context_window"
  | "tokens_in"
  | "tokens_out"
  | "token_extras"
  | "tools_used"
>;

/**
 * One merge pass shared by `agent:register` and every task-boundary refresh: transcript evidence is
 * folded in first (§`mergeDerivedField`'s doc), config-file evidence second, and only what actually
 * changes appears in the returned object — callers spread the result over their base to update it.
 */
export function applyDerivedTelemetry(
  base: MergeableTelemetryFields,
  derived: DerivedTelemetryInput | undefined,
  conflicts: TelemetryFieldConflict[],
  observedAt: string,
): MergeableTelemetryFields {
  const transcript = derived?.transcript;
  const modelAfterTranscript = mergeDerivedField(
    base.model,
    transcript?.model,
    "model",
    conflicts,
    "harness_observed",
  );
  const thinkingAfterTranscript = mergeDerivedField(
    base.thinking_level,
    transcript?.thinkingLevel,
    "thinking_level",
    conflicts,
    "harness_observed",
  );
  const provider = mergeDerivedField(base.provider, derived?.provider, "provider", conflicts);
  const model = mergeDerivedField(modelAfterTranscript, derived?.model, "model", conflicts);
  const thinkingLevel = mergeDerivedField(
    thinkingAfterTranscript,
    derived?.thinkingLevel,
    "thinking_level",
    conflicts,
  );
  const contextWindow = mergeDerivedField(
    base.context_window,
    derived?.contextWindow,
    "context_window",
    conflicts,
  );
  const tokensIn = mergeObservedCount(base.tokens_in, transcript?.tokensIn, "tokens_in", conflicts);
  const tokensOut = mergeObservedCount(base.tokens_out, transcript?.tokensOut, "tokens_out", conflicts);
  const tokenExtras = mergeObservedExtras(base.token_extras, transcript?.tokenExtras);
  const toolsUsed = mergeObservedTools(base.tools_used, transcript?.tools, observedAt);
  return {
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(thinkingLevel === undefined ? {} : { thinking_level: thinkingLevel }),
    ...(contextWindow === undefined ? {} : { context_window: contextWindow }),
    ...(tokensIn === undefined ? {} : { tokens_in: tokensIn }),
    ...(tokensOut === undefined ? {} : { tokens_out: tokensOut }),
    ...(tokenExtras === undefined ? {} : { token_extras: tokenExtras }),
    ...(toolsUsed === undefined ? {} : { tools_used: toolsUsed }),
  };
}

function transcriptHasObservation(transcript: AgentTranscriptTelemetry | undefined): boolean {
  if (transcript === undefined) return false;
  return (
    transcript.tokensIn !== undefined ||
    transcript.tokensOut !== undefined ||
    transcript.tools.length > 0 ||
    (transcript.tokenExtras !== undefined && Object.keys(transcript.tokenExtras).length > 0)
  );
}

function hasDerivedValue(derived: DerivedTelemetryInput): boolean {
  return (
    derived.provider !== undefined ||
    derived.model !== undefined ||
    derived.thinkingLevel !== undefined ||
    derived.contextWindow !== undefined ||
    (derived.capabilities !== undefined && Object.keys(derived.capabilities).length > 0) ||
    derived.transcript !== undefined
  );
}

export interface RefreshAgentTelemetryInput {
  runRoot: string;
  agentId: string;
  actor: string;
  /** Which CLI boundary triggered this probe, recorded so the audit trail says where it ran. */
  boundary: string;
  derived: DerivedTelemetryInput;
  now?: Date;
}

/**
 * The probe that runs automatically at `task:claim`, `task:submit` and `agent:release` — never a
 * separate command, never a round-trip to the agent. It only ever touches a grant that already
 * exists and is still active: an agent that never registered, or one already released, has nothing
 * on the ledger to attach a probe to, so this returns `null` rather than manufacturing one. A call
 * that finds nothing new and no conflict writes no event at all, so a run that never drifts stays
 * quiet instead of gaining one telemetry event per task boundary.
 */
export function refreshAgentDerivedTelemetry(
  input: RefreshAgentTelemetryInput,
): TelemetryProbeOutcome | null {
  if (!hasDerivedValue(input.derived)) return null;
  const existing = findGrant(readAgentLedger(loadRun(input.runRoot).state), input.agentId);
  if (!existing || existing.status === "released") return null;

  const conflicts: TelemetryFieldConflict[] = [];
  const probedAt = (input.now ?? new Date()).toISOString();
  const merged = applyDerivedTelemetry(existing, input.derived, conflicts, probedAt);
  checkParentAgentConflict(existing.parent_agent_id, input.derived.transcript, conflicts);
  const filledAField =
    merged.provider !== existing.provider ||
    merged.model !== existing.model ||
    merged.thinking_level !== existing.thinking_level ||
    merged.context_window !== existing.context_window;
  if (
    !filledAField &&
    !transcriptHasObservation(input.derived.transcript) &&
    conflicts.length === 0
  ) {
    return null;
  }

  let updated: AgentGrantRecord | undefined;
  let ledgerAfter: AgentGrantRecord[] = [];
  const transcriptContext = transcriptAuditContext(input.derived.transcript);
  const state = transact(
    input.runRoot,
    input.actor,
    "agent-telemetry-probed",
    {
      agent_id: input.agentId,
      boundary: input.boundary,
      probed_at: probedAt,
      ...(input.derived.capabilities === undefined
        ? {}
        : {
            host_capabilities: input.derived.capabilities,
            ...(input.derived.hostTool === undefined
              ? {}
              : { host_capabilities_source: input.derived.hostTool }),
          }),
      ...(transcriptContext === undefined ? {} : { transcript_context: transcriptContext }),
      ...(conflicts.length === 0 ? {} : { telemetry_conflicts: conflicts }),
    },
    (draft) => {
      const ledger = readAgentLedger(draft);
      const grant = requireGrant(ledger, input.agentId);
      if (grant.status === "released") {
        // Released between the read above and this lock; nothing left to attach the probe to.
        updated = grant;
        ledgerAfter = ledger;
        return;
      }
      const next: AgentGrantRecord = { ...grant, ...merged };
      updated = next;
      ledgerAfter = replaceGrant(ledger, next);
      writeAgentLedger(draft, ledgerAfter);
    },
  );
  if (!updated) throw new HarnessError("INVALID_STATE", "agent telemetry probe was not recorded");
  return {
    grant: updated,
    ledger: ledgerAfter,
    state,
    ...(conflicts.length === 0 ? {} : { conflicts }),
  };
}
