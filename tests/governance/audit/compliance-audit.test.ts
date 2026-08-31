import { describe, expect, it } from "bun:test";
import { auditGovernanceReadiness } from "../../../olt/scripts/src/mind/governance/index.ts";

describe("Governance Compliance Audit", () => {
  it("audits governance readiness cleanly", () => {
    const readiness = auditGovernanceReadiness(".");
    expect(readiness).toBeDefined();
  });
});
