import { describe, expect, it } from "bun:test";
import { auditRepoGovernanceCoverage } from "../../../olt/scripts/src/mind/governance/index.ts";

describe("Governance Coverage & Auditor Suite", () => {
  it("audits governance coverage on current repo", () => {
    const report = auditRepoGovernanceCoverage(".");
    expect(report).toBeDefined();
    expect(typeof report.policyPresent).toBe("boolean");
    expect(typeof report.readyForMindAuditor).toBe("boolean");
  });
});
