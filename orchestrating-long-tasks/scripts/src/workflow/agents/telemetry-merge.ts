import type { AgentGrantRecord, ThinkingLevel } from "../../contracts/agents.ts";
import type { RunState } from "../../contracts/capsule.ts";
import { evidenced, type Evidenced, type EvidenceClass } from "../../contracts/evidence.ts";
import type { JsonObject, JsonValue } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { loadRun, transact } from "../../store/index.ts";
import { findGrant, readAgentLedger, replaceGrant, requireGrant, writeAgentLedger } from "./ledger.ts";

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
 * value only ever fills a field that has no explicit report at all, and does so as `derived`.
 */
export function mergeDerivedField<T extends number | string>(
  explicit: Evidenced<T> | undefined,
  probed: T | undefined,
  field: string,
  conflicts: TelemetryFieldConflict[],
): Evidenced<T> | undefined {
  if (probed === undefined) return explicit;
  if (explicit === undefined) return evidenced(probed, "derived");
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

function hasDerivedValue(derived: DerivedTelemetryInput): boolean {
  return (
    derived.provider !== undefined ||
    derived.model !== undefined ||
    derived.thinkingLevel !== undefined ||
    derived.contextWindow !== undefined ||
    (derived.capabilities !== undefined && Object.keys(derived.capabilities).length > 0)
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
  const provider = mergeDerivedField(existing.provider, input.derived.provider, "provider", conflicts);
  const model = mergeDerivedField(existing.model, input.derived.model, "model", conflicts);
  const thinkingLevel = mergeDerivedField(
    existing.thinking_level,
    input.derived.thinkingLevel,
    "thinking_level",
    conflicts,
  );
  const contextWindow = mergeDerivedField(
    existing.context_window,
    input.derived.contextWindow,
    "context_window",
    conflicts,
  );
  const filledAField =
    provider !== existing.provider ||
    model !== existing.model ||
    thinkingLevel !== existing.thinking_level ||
    contextWindow !== existing.context_window;
  if (!filledAField && conflicts.length === 0) return null;

  const probedAt = (input.now ?? new Date()).toISOString();
  let updated: AgentGrantRecord | undefined;
  let ledgerAfter: AgentGrantRecord[] = [];
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
      const next: AgentGrantRecord = {
        ...grant,
        ...(provider === undefined ? {} : { provider }),
        ...(model === undefined ? {} : { model }),
        ...(thinkingLevel === undefined ? {} : { thinking_level: thinkingLevel }),
        ...(contextWindow === undefined ? {} : { context_window: contextWindow }),
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
