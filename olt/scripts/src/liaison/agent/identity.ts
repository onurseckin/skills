import { HarnessError } from "../../core/errors/index.ts";
import {
  TIER_0_INVARIANTS,
  type AllowedLiaisonAction,
  type ForbiddenLiaisonAction,
  type LiaisonAction,
  type LiaisonAgentId,
  type LiaisonIdentity,
} from "./types.ts";

export const ALLOWED_LIAISON_ACTIONS: readonly AllowedLiaisonAction[] = [
  "DRAIN_MAILBOX",
  "EMIT_RECEIPT",
  "EMIT_HEARTBEAT",
  "ANSWER_QUERY",
  "ROUTE_ESCALATION",
  "CHECK_OBLIGATION",
];

export const FORBIDDEN_LIAISON_ACTIONS: readonly ForbiddenLiaisonAction[] = [
  "PLAN",
  "CLAIM_TASK",
  "CLAIM_LEASE",
  "IMPLEMENT",
  "EDIT_CODE",
  "RUN_GATE",
  "SEAL_RUN",
];

const LIAISON_PREFIX = "liaison_";
const SYSTEM_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/i;

export function isValidSystemName(system: unknown): system is string {
  if (typeof system !== "string") return false;
  const trimmed = system.trim();
  if (!trimmed) return false;
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) return false;
  return SYSTEM_NAME_REGEX.test(trimmed);
}

export function formatLiaisonAgentId(system: string): LiaisonAgentId {
  if (!isValidSystemName(system)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Invalid liaison system name '${system}': must be non-empty alphanumeric with optional hyphens or underscores`,
    );
  }
  return `liaison_${system.toLowerCase().trim()}`;
}

export function isLiaisonIdentity(agentId: unknown): agentId is LiaisonAgentId {
  if (typeof agentId !== "string" || !agentId.startsWith(LIAISON_PREFIX)) {
    return false;
  }
  const systemPart = agentId.slice(LIAISON_PREFIX.length);
  return isValidSystemName(systemPart);
}

export function parseLiaisonIdentity(agentId: string): LiaisonIdentity {
  if (!agentId || typeof agentId !== "string") {
    throw new HarnessError("INVALID_ARGUMENT", "agentId must be a non-empty string");
  }
  if (!isLiaisonIdentity(agentId)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Identity '${agentId}' is not a valid tier-0 liaison identity. Must match pattern 'liaison_<system>'.`,
    );
  }
  const system = agentId.slice(LIAISON_PREFIX.length).toLowerCase().trim();
  return {
    agentId,
    system,
    tier: 0,
    role: "liaison",
    invariants: TIER_0_INVARIANTS,
  };
}

export function createLiaisonIdentity(system: string): LiaisonIdentity {
  const agentId = formatLiaisonAgentId(system);
  return parseLiaisonIdentity(agentId);
}

export function canPerformAction(action: LiaisonAction): action is AllowedLiaisonAction {
  return (ALLOWED_LIAISON_ACTIONS as readonly string[]).includes(action);
}

export function assertTier0Invariant(identity: LiaisonIdentity, action: LiaisonAction): void {
  if (!canPerformAction(action)) {
    throw new HarnessError(
      "ROLE_BOUNDARY_DEVIATION",
      `Tier-0 Liaison identity '${identity.agentId}' is strictly prohibited from action '${action}'. ` +
        "Liaisons are cheap transport endpoints that own cross-system traffic and must never plan, claim work, " +
        "implement, run gates, or seal runs.",
    );
  }
}
