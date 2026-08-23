import type {
  AgentGrantRecord,
  AgentToolUse,
  TelemetryFieldConflict,
  ThinkingLevel,
} from "../../core/contracts/agents.ts";
import type { RunState } from "../../core/contracts/capsule.ts";
import { evidenced, type Evidenced, type EvidenceClass } from "../../core/contracts/evidence.ts";
import type { JsonObject } from "../../core/contracts/json.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { loadRun, transact } from "../../engine/store/index.ts";
import {
  findGrant,
  readAgentLedger,
  replaceGrant,
  requireGrant,
  writeAgentLedger,
} from "./ledger.ts";
import type { AgentTranscriptTelemetry, TranscriptToolCall } from "./transcript-telemetry.ts";

export interface DerivedTelemetryInput {
  hostTool?: string;
  provider?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  contextWindow?: number;
  capabilities?: JsonObject;
  transcript?: AgentTranscriptTelemetry;
}

export type { TelemetryFieldConflict } from "../../core/contracts/agents.ts";

export interface TelemetryProbeOutcome {
  grant: AgentGrantRecord;
  ledger: AgentGrantRecord[];
  state: RunState;
  conflicts?: readonly TelemetryFieldConflict[];
}

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
      probed_evidence_class: evidenceClass,
    });
  }
  return explicit;
}

export function mergeObservedCount(
  explicit: Evidenced<number> | undefined,
  observed: number | undefined,
  field: string,
  conflicts: TelemetryFieldConflict[],
): Evidenced<number> | undefined {
  if (observed === undefined) return explicit;
  if (
    explicit === undefined ||
    explicit.is_estimated === true ||
    explicit.evidence_class === "harness_observed"
  ) {
    return evidenced(observed, "harness_observed");
  }
  if (explicit.value !== observed) {
    conflicts.push({
      field,
      recorded_value: explicit.value,
      recorded_evidence_class: explicit.evidence_class,
      probed_value: observed,
      probed_evidence_class: "harness_observed",
    });
  }
  return explicit;
}

export function mergeObservedExtras(
  existing: Record<string, Evidenced<number>> | undefined,
  observed: Readonly<Record<string, number>> | undefined,
): Record<string, Evidenced<number>> | undefined {
  if (observed === undefined || Object.keys(observed).length === 0) return existing;
  const merged: Record<string, Evidenced<number>> = { ...existing };
  for (const [name, count] of Object.entries(observed)) {
    const current = merged[name];
    if (
      current === undefined ||
      current.is_estimated === true ||
      current.evidence_class === "harness_observed"
    ) {
      merged[name] = evidenced(count, "harness_observed");
    }
  }
  return merged;
}

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
      merged.push({
        name: tool.name,
        extras,
        evidence_class: "harness_observed",
        first_reported_at: at,
      });
      continue;
    }
    const previous = merged[index]!;
    merged[index] = { ...previous, extras: { ...previous.extras, ...extras } };
  }
  return merged;
}

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
    probed_evidence_class: "harness_observed",
  });
}

export function appendTelemetryConflicts(
  existing: readonly TelemetryFieldConflict[] | undefined,
  incoming: readonly TelemetryFieldConflict[],
): TelemetryFieldConflict[] | undefined {
  if (incoming.length === 0) return existing === undefined ? undefined : [...existing];
  const merged = existing === undefined ? [] : [...existing];
  for (const conflict of incoming) {
    const isDuplicate = merged.some(
      (entry) =>
        entry.field === conflict.field &&
        entry.recorded_value === conflict.recorded_value &&
        entry.recorded_evidence_class === conflict.recorded_evidence_class &&
        entry.probed_value === conflict.probed_value &&
        entry.probed_evidence_class === conflict.probed_evidence_class,
    );
    if (!isDuplicate) merged.push(conflict);
  }
  return merged;
}

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
  const tokensOut = mergeObservedCount(
    base.tokens_out,
    transcript?.tokensOut,
    "tokens_out",
    conflicts,
  );
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
  boundary: string;
  derived: DerivedTelemetryInput;
  now?: Date;
}

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
        updated = grant;
        ledgerAfter = ledger;
        return;
      }
      const telemetryConflicts = appendTelemetryConflicts(grant.telemetry_conflicts, conflicts);
      const next: AgentGrantRecord = {
        ...grant,
        ...merged,
        ...(telemetryConflicts === undefined ? {} : { telemetry_conflicts: telemetryConflicts }),
      };
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
