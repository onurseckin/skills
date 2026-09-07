import { describe, expect, it, HarnessError, TokenEvolutionManager } from "../fixtures.ts";

describe("Design System Tokens - Dialectic & Evolution Protocol", () => {
  describe("5. Systemic Token Evolution Protocol", () => {
    it("should manage the full RFC proposal lifecycle from submission to Mind Auditor approval and propagation", () => {
      const evolution = new TokenEvolutionManager();

      const proposal = evolution.submitProposal({
        name: "Cockpit High-Density Micro Spacing",
        category: "spacing",
        proposedTokenName: "cockpit-compact",
        proposedTokenValue: 6,
        targetDomain: "Fleet Telematics",
        justification: "Dense gauge readouts require a 6px intermediate spacing step.",
        author: "Implementer Wave 3",
      });

      expect(proposal.id).toBe("RFC-TKN-0001");
      expect(proposal.status).toBe("PROPOSED");

      const approved = evolution.reviewProposal(
        proposal.id,
        "APPROVED",
        "Mind Auditor",
        "Systemic evaluation confirms 6px spacing is mathematically harmonious for telematics.",
      );
      expect(approved.status).toBe("APPROVED");
      expect(approved.reviewedBy).toBe("Mind Auditor");

      const propagated = evolution.propagateToken(proposal.id);
      expect(propagated.status).toBe("PROPAGATED");

      const registry = evolution.getActiveRegistry();
      expect(registry.customTokens.length).toBe(1);
      expect(registry.customTokens[0]?.proposedTokenName).toBe("cockpit-compact");
    });

    it("should reject invalid proposal submission or invalid state transitions", () => {
      const evolution = new TokenEvolutionManager();

      expect(() => {
        evolution.submitProposal({
          name: "",
          category: "spacing",
          proposedTokenName: "",
          proposedTokenValue: 0,
          targetDomain: "",
          justification: "",
          author: "",
        });
      }).toThrow(HarnessError);

      const proposal = evolution.submitProposal({
        name: "Test",
        category: "spacing",
        proposedTokenName: "test-token",
        proposedTokenValue: 10,
        targetDomain: "General",
        justification: "Testing",
        author: "Tester",
      });

      expect(() => {
        evolution.propagateToken(proposal.id);
      }).toThrow(HarnessError);

      expect(() => {
        evolution.reviewProposal("NON_EXISTENT", "APPROVED", "Auditor", "notes");
      }).toThrow(HarnessError);
    });

    it("should filter proposals by status and category", () => {
      const evolution = new TokenEvolutionManager();

      evolution.submitProposal({
        name: "Proposal 1",
        category: "spacing",
        proposedTokenName: "sp-1",
        proposedTokenValue: 6,
        targetDomain: "Domain 1",
        justification: "Justification 1",
        author: "Author 1",
      });

      const p2 = evolution.submitProposal({
        name: "Proposal 2",
        category: "color",
        proposedTokenName: "col-1",
        proposedTokenValue: "#112233",
        targetDomain: "Domain 2",
        justification: "Justification 2",
        author: "Author 2",
      });

      evolution.reviewProposal(p2.id, "APPROVED", "Auditor", "ok");

      const spacingProposals = evolution.listProposals({ category: "spacing" });
      expect(spacingProposals.length).toBe(1);

      const approvedProposals = evolution.listProposals({ status: "APPROVED" });
      expect(approvedProposals.length).toBe(1);
      expect(approvedProposals[0]?.id).toBe(p2.id);
    });
  });
});
