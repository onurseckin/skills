import type { AgentGrantRecord } from "../../core/contracts/index.ts";
import type { JsonObject } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { findGrant, readAgentLedger } from "./ledger.ts";

export type UnattributedReason = "empty-ledger" | "no-such-grant" | "grant-released";

export type UnattributedDetail =
  | { readonly reason: "empty-ledger" }
  | { readonly reason: "no-such-grant" }
  | { readonly reason: "grant-released"; readonly releasedGrant: AgentGrantRecord };

export interface GrantedAttribution {
  readonly kind: "granted";
  readonly actor: string;
  readonly grant: AgentGrantRecord;
}

export type UnattributedAttribution = {
  readonly kind: "unattributed";
  readonly actor: string;
} & UnattributedDetail;

export type AttributionResult = GrantedAttribution | UnattributedAttribution;

const UNATTRIBUTED_MESSAGES: Readonly<Record<UnattributedReason, string>> = {
  "empty-ledger": "this capsule granted no agents at all",
  "no-such-grant": "no grant was ever issued for this id",
  "grant-released": "its grant was released and can no longer attribute new work",
};

export function resolveAttributionInLedger(
  ledger: readonly AgentGrantRecord[],
  actor: string,
): AttributionResult {
  if (ledger.length === 0) return { kind: "unattributed", actor, reason: "empty-ledger" };
  const grant = findGrant(ledger, actor);
  if (grant === undefined) return { kind: "unattributed", actor, reason: "no-such-grant" };
  const inactive = ledger.find((entry) => entry.id === actor && entry.status !== "active");
  if (inactive !== undefined) {
    return { kind: "unattributed", actor, reason: "grant-released", releasedGrant: inactive };
  }
  return { kind: "granted", actor, grant };
}

export function resolveAttribution(state: JsonObject, actor: string): AttributionResult {
  return resolveAttributionInLedger(readAgentLedger(state), actor);
}

export function describeAttribution(result: AttributionResult): string {
  if (result.kind === "granted") {
    return `actor ${result.actor} holds an active ${result.grant.role} grant`;
  }
  const because = UNATTRIBUTED_MESSAGES[result.reason];
  if (result.reason === "grant-released") {
    const releasedAt = result.releasedGrant.released_at;
    const at = releasedAt === undefined ? "an unrecorded time" : releasedAt;
    return `actor ${result.actor} is unattributed: ${because} (released at ${at})`;
  }
  return `actor ${result.actor} is unattributed: ${because}`;
}

export function assertAttribution(state: JsonObject, actor: string): AgentGrantRecord {
  const result = resolveAttribution(state, actor);
  if (result.kind === "granted") return result.grant;
  throw new HarnessError(
    "INVALID_STATE",
    describeAttribution(result),
    [{ actor: result.actor, reason: result.reason }],
    undefined,
    "register the actor with agent:register, or record the write under the agent id that holds the grant",
  );
}
