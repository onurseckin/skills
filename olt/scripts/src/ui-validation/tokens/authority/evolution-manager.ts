import { HarnessError } from "../../../core/errors/index.ts";
import {
  SPACING_TOKENS,
  TYPOGRAPHY_TOKENS,
  COLOR_PALETTES,
  SHADOW_ELEVATIONS,
  BORDER_RADII,
  TRANSITION_TOKENS,
} from "./constants.ts";
import type {
  TokenEvolutionProposal,
  TokenProposalStatus,
  TokenRegistrySnapshot,
} from "./types.ts";
export class TokenEvolutionManager {
  private proposals: Map<string, TokenEvolutionProposal> = new Map();
  private proposalCounter = 0;

  /**
   * Submit a new Token Evolution Proposal (RFC)
   */
  public submitProposal(
    input: Omit<TokenEvolutionProposal, "id" | "status" | "createdAt" | "updatedAt">,
  ): TokenEvolutionProposal {
    if (!input.name || !input.proposedTokenName || input.proposedTokenValue === undefined) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Token Evolution Proposal requires name, proposedTokenName, and proposedTokenValue.",
      );
    }

    this.proposalCounter += 1;
    const id = `RFC-TKN-${String(this.proposalCounter).padStart(4, "0")}`;
    const now = new Date().toISOString();

    const proposal: TokenEvolutionProposal = {
      ...input,
      id,
      status: "PROPOSED",
      createdAt: now,
      updatedAt: now,
    };

    this.proposals.set(id, proposal);
    return proposal;
  }

  /**
   * Governance evaluation by Mind Auditor
   */
  public reviewProposal(
    proposalId: string,
    decision: "APPROVED" | "REJECTED",
    reviewer: string,
    notes: string,
  ): TokenEvolutionProposal {
    const existing = this.proposals.get(proposalId);
    if (!existing) {
      throw new HarnessError("NOT_FOUND", `Token Evolution Proposal '${proposalId}' not found.`);
    }

    if (existing.status === "PROPAGATED") {
      throw new HarnessError(
        "INVALID_STATE",
        `Cannot review proposal '${proposalId}' because it has already been propagated.`,
      );
    }

    const updated: TokenEvolutionProposal = {
      ...existing,
      status: decision,
      reviewedBy: reviewer,
      reviewNotes: notes,
      updatedAt: new Date().toISOString(),
    };

    this.proposals.set(proposalId, updated);
    return updated;
  }

  /**
   * Propagate an approved token into the active registry
   */
  public propagateToken(proposalId: string): TokenEvolutionProposal {
    const existing = this.proposals.get(proposalId);
    if (!existing) {
      throw new HarnessError("NOT_FOUND", `Token Evolution Proposal '${proposalId}' not found.`);
    }

    if (existing.status !== "APPROVED") {
      throw new HarnessError(
        "INVALID_STATE",
        `Cannot propagate proposal '${proposalId}' with status '${existing.status}'. It must be 'APPROVED' by Mind Auditor.`,
      );
    }

    const propagated: TokenEvolutionProposal = {
      ...existing,
      status: "PROPAGATED",
      updatedAt: new Date().toISOString(),
    };

    this.proposals.set(proposalId, propagated);
    return propagated;
  }

  /**
   * List all proposals with optional filter
   */
  public listProposals(filter?: {
    status?: TokenProposalStatus;
    category?: TokenEvolutionProposal["category"];
  }): TokenEvolutionProposal[] {
    const results = Array.from(this.proposals.values());
    return results.filter((p) => {
      if (filter?.status && p.status !== filter.status) return false;
      if (filter?.category && p.category !== filter.category) return false;
      return true;
    });
  }

  /**
   * Get current snapshot of all active propagated tokens
   */
  public getActiveRegistry(): TokenRegistrySnapshot {
    const propagated = this.listProposals({ status: "PROPAGATED" });
    return {
      version: `token-registry-v${propagated.length}.0`,
      customTokens: propagated,
      totalTokensCount:
        Object.keys(SPACING_TOKENS).length +
        Object.keys(TYPOGRAPHY_TOKENS.fontSizes).length +
        Object.keys(SHADOW_ELEVATIONS).length +
        Object.keys(BORDER_RADII).length +
        propagated.length,
    };
  }
}

/**
 * ============================================================================
 * 6. Unified Token Authority Engine & Singletons
 * ============================================================================
 */
