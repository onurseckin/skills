import { HarnessError } from "../../../core/errors/index.ts";
import type { MindProposal, ProposalRateLimitCheckResult } from "./types.ts";
import { DEFAULT_PROPOSAL_MIN_INTERVAL_MS, DEFAULT_MAX_OPEN_PROPOSALS } from "./types.ts";
import { getAllProposals, parseNowMs, normalizeText } from "./storage.ts";
export function getOpenProposals(state: Record<string, unknown>): MindProposal[] {
  return getAllProposals(state).filter(
    (p) => p.status === "needs_authority" || p.status === "opened",
  );
}

/**
 * Returns all permanently declined proposals.
 */
export function getDeclinedProposals(state: Record<string, unknown>): MindProposal[] {
  return getAllProposals(state).filter((p) => p.status === "declined");
}

/**
 * Returns all granted proposals awaiting admission.
 */
export function getGrantedProposals(state: Record<string, unknown>): MindProposal[] {
  return getAllProposals(state).filter((p) => p.status === "granted" || p.status === "admitted");
}

/**
 * Computes remaining cooldown in milliseconds for proposal generation.
 */
export function calculateRemainingCooldownMs(
  state: Record<string, unknown>,
  options: {
    readonly now?: number | Date | string | undefined;
    readonly minIntervalMs?: number | undefined;
  } = {},
): number {
  const budget = (state.budget ?? {}) as Record<string, unknown>;
  const minInterval =
    options.minIntervalMs ??
    (typeof budget.proposal_interval_ms === "number"
      ? budget.proposal_interval_ms
      : DEFAULT_PROPOSAL_MIN_INTERVAL_MS);

  if (minInterval <= 0) return 0;

  const nowMs = parseNowMs(options.now);
  const allProposals = getAllProposals(state);
  let minRemaining = 0;

  for (const prop of allProposals) {
    const createdAtMs = Date.parse(prop.created_at);
    if (Number.isFinite(createdAtMs) && nowMs >= createdAtMs && nowMs - createdAtMs < minInterval) {
      const remaining = minInterval - (nowMs - createdAtMs);
      if (remaining > minRemaining) {
        minRemaining = remaining;
      }
    }
  }

  return minRemaining;
}

/**
 * Validates proposal rate limits and ceiling against state and budget.
 */
export function checkProposalRateLimits(
  state: Record<string, unknown>,
  options: {
    readonly now?: number | Date | string | undefined;
    readonly pulseId?: string | number | undefined;
    readonly minIntervalMs?: number | undefined;
    readonly maxOpenProposals?: number | undefined;
  } = {},
): ProposalRateLimitCheckResult {
  const budget = (state.budget ?? {}) as Record<string, unknown>;
  const maxOpen =
    options.maxOpenProposals ??
    (typeof budget.max_open_proposals === "number"
      ? budget.max_open_proposals
      : DEFAULT_MAX_OPEN_PROPOSALS);

  const openProposals = getOpenProposals(state);
  const openCount = openProposals.length;

  if (openCount >= maxOpen) {
    return {
      allowed: false,
      reason: `open proposal ceiling reached (${openCount}/${maxOpen}); cannot open new proposal until pending proposals receive an owner authority decision`,
      openCount,
      maxOpen,
    };
  }

  // 1 proposal per pulse limit
  if (options.pulseId !== undefined) {
    const allProposals = getAllProposals(state);
    const existingInPulse = allProposals.some(
      (p) => String(p.created_pulse) === String(options.pulseId),
    );
    if (existingInPulse) {
      return {
        allowed: false,
        reason: `proposal rate limit exceeded: a proposal has already been recorded in pulse ${options.pulseId} (limit: at most 1 proposal per pulse)`,
        openCount,
        maxOpen,
      };
    }
  }

  // Time-based rate limit / cooldown
  const remainingCooldown = calculateRemainingCooldownMs(state, options);
  if (remainingCooldown > 0) {
    const remainingHours = (remainingCooldown / 3_600_000).toFixed(1);
    return {
      allowed: false,
      reason: `proposal rate limit exceeded: at most 1 proposal per cooldown window (next proposal eligible in ${remainingHours}h)`,
      openCount,
      maxOpen,
      remainingCooldownMs: remainingCooldown,
    };
  }

  return {
    allowed: true,
    openCount,
    maxOpen,
    remainingCooldownMs: 0,
  };
}

/**
 * Checks whether a proposal matches a previously declined proposal (Gate 6 duplicate/declined check).
 */
export function findDeclinedProposalConflict(
  state: Record<string, unknown>,
  statement: string,
): MindProposal | undefined {
  const normTarget = normalizeText(statement);
  const declined = getDeclinedProposals(state);
  return declined.find((p) => normalizeText(p.statement) === normTarget);
}

/**
 * Asserts that the role contract allows authority:decide. Mind agents and subagents are strictly prohibited.
 */
export function assertRoleMayDecideProposal(role: string, actor: string): void {
  if (role === "mind") {
    throw new HarnessError(
      "INVALID_STATE",
      `role mind may not invoke authority:decide: agent ${actor} holds a mind grant and cannot self-approve proposals`,
    );
  }
}

/**
 * Records a novelty proposal in the state draft.
 */
