import type {
  AgentGrantRecord,
  AgentModelTier,
  AgentToolRef,
  AgentToolUse,
  ThinkingLevel,
} from "../../core/contracts/index.ts";
import type { RunState } from "../../core/contracts/index.ts";
import { estimated, evidenced, type Evidenced } from "../../core/contracts/index.ts";
import type { JsonObject } from "../../core/contracts/index.ts";
import type { AgentRole } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { transact } from "../../engine/store/index.ts";
import { assertSpawnAuthorized, roleToTier } from "../../packets/command-authority.ts";
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

interface RegisterAgentBase {
  runRoot: string;
  agentId: string;
  role: AgentRole;
  parentTaskId: null | string;
  host: string;
  hostAddress?: string;
  maxAgents: number;
  telemetry: GrantTelemetryInput;
  derivedTelemetry?: DerivedTelemetryInput;
  now?: Date;
}

export type RegistrationAuthority =
  | { readonly kind: "conditional_genesis" }
  | { readonly kind: "verified_parent"; readonly actorId: string };

export type RegisterAgentInput =
  | (RegisterAgentBase & {
      readonly parentAgentId: null;
      readonly authority: Extract<RegistrationAuthority, { readonly kind: "conditional_genesis" }>;
    })
  | (RegisterAgentBase & {
      readonly parentAgentId: string;
      readonly authority: Extract<RegistrationAuthority, { readonly kind: "verified_parent" }>;
    });

export interface AgentReportInput {
  runRoot: string;
  agentId: string;
  actor: string;
  tools: readonly AgentToolRef[];
  tokensIn?: number;
  tokensOut?: number;
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
  conflicts?: readonly TelemetryFieldConflict[];
}

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

function telemetryFields(telemetry: GrantTelemetryInput): GrantTelemetryFields {
  return {
    ...(telemetry.provider === undefined
      ? {}
      : { provider: evidenced(telemetry.provider, "agent_reported") }),
    ...(telemetry.model === undefined
      ? {}
      : { model: evidenced(telemetry.model, "agent_reported") }),
    ...(telemetry.modelTier === undefined
      ? {}
      : { model_tier: explicitLevel(telemetry.modelTier) }),
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
  const authority: RegistrationAuthority | undefined = input.authority;
  if (authority === undefined || typeof authority !== "object" || authority === null) {
    throw new HarnessError("AUTHENTICATION_FAILURE", "registration authority is required");
  }
  const eventActor = (() => {
    switch (authority.kind) {
      case "conditional_genesis":
        return input.agentId;
      case "verified_parent":
        return authority.actorId;
      default:
        throw new HarnessError("AUTHENTICATION_FAILURE", "registration authority is invalid");
    }
  })();
  let minted: AgentGrantRecord | undefined;
  let ledgerAfter: AgentGrantRecord[] = [];
  const state = transact(
    input.runRoot,
    eventActor,
    "agent-registered",
    {
      agent_id: input.agentId,
      role: input.role,
      parent_agent_id: input.parentAgentId,
      parent_task_id: input.parentTaskId,
      host: input.host,
      ...(input.hostAddress === undefined ? {} : { host_address: input.hostAddress }),
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
      switch (authority.kind) {
        case "conditional_genesis":
          if (ledger.length !== 0 || input.parentAgentId !== null) {
            throw new HarnessError(
              "AUTHENTICATION_FAILURE",
              "conditional agent genesis is valid only for the first grant in an empty ledger without --parent-agent",
            );
          }
          break;
        case "verified_parent":
          if (ledger.length === 0 || input.parentAgentId === null) {
            throw new HarnessError(
              "AUTHENTICATION_FAILURE",
              "verified parent registration requires a nonempty ledger and a named parent agent",
            );
          }
          if (authority.actorId !== input.parentAgentId) {
            throw new HarnessError(
              "AUTHENTICATION_FAILURE",
              `actor '${authority.actorId}' does not match parent agent '${input.parentAgentId}'; registering a grant under a named parent requires acting as that parent, not borrowing its spawn authority from an unrelated caller`,
            );
          }
          break;
        default:
          throw new HarnessError("AUTHENTICATION_FAILURE", "registration authority is invalid");
      }
      if (input.parentAgentId !== null) {
        const parentGrant = requireGrant(ledger, input.parentAgentId);
        if (parentGrant.status !== "active") {
          throw new HarnessError(
            "INVALID_STATE",
            `parent agent ${input.parentAgentId} holds a ${parentGrant.status} grant, not an active one, and cannot supervise a new spawn`,
          );
        }
        assertSpawnAuthorized(parentGrant.role, input.role, input.parentAgentId, input.agentId);
      } else if (roleToTier(input.role) > 1 && ledger.length > 0) {
        throw new HarnessError(
          "ROLE_CONFINEMENT_VIOLATION",
          `Role '${input.role}' (Tier ${roleToTier(input.role)}) cannot be registered without a supervising parent agent (--parent-agent). Tier 2 Coordinators must be spawned by Tier 1 Orchestrators, and Tier 3 workers must be spawned by Tier 2 Coordinators.`,
        );
      }
      requireKnownTask(draft, input.parentTaskId);
      assertAgentBudget(ledger, 1, input.maxAgents);
      const grant: AgentGrantRecord = {
        id: input.agentId,
        role: input.role,
        parent_agent_id: input.parentAgentId,
        parent_task_id: input.parentTaskId,
        host: input.host,
        ...(input.hostAddress === undefined ? {} : { host_address: input.hostAddress }),
        granted_at: grantedAt,
        status: "active",
        ...fields,
        ...(conflicts.length === 0 ? {} : { telemetry_conflicts: conflicts }),
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

function tokenCount(value: number | undefined, isEstimate: boolean): Evidenced<number> | undefined {
  if (value === undefined) return undefined;
  return isEstimate ? estimated(value) : evidenced(value, "agent_reported");
}

export function recordAgentReport(input: AgentReportInput): AgentGrantOutcome {
  if (input.actor !== input.agentId) {
    throw new HarnessError(
      "AUTHENTICATION_FAILURE",
      `agent:report target '${input.agentId}' does not match authenticated actor '${input.actor}'; agents may report only their own grant`,
    );
  }
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
      if (input.actor !== input.agentId) {
        const actorGrant = requireGrant(ledger, input.actor);
        if (actorGrant.status !== "active" || grant.parent_agent_id !== input.actor) {
          throw new HarnessError(
            "AUTHENTICATION_FAILURE",
            `agent:release target '${input.agentId}' is not authenticated actor '${input.actor}' or its active direct child`,
          );
        }
      }
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
