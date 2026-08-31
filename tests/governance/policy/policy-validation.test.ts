import { describe, expect, it } from "bun:test";
import {
  validateGovernanceCharter,
  verifyCharterIntegrity,
  formatCharterSummary,
  parseCharter,
} from "../../../olt/scripts/src/mind/governance/index.ts";

const sampleYaml = `identity: mind
repoRoots:
  - "."
goals:
  - id: G1
    statement: Goal 1
    priority: 1
nonGoals:
  - NG1
prohibitions:
  - P1
`;

describe("Governance Policy Validation & Integrity", () => {
  it("validates well-formed charter object", () => {
    const parsed = parseCharter(sampleYaml);
    const valid = validateGovernanceCharter(parsed);
    expect(valid).toBe(true);
  });

  it("verifies charter integrity report", () => {
    const report = verifyCharterIntegrity(".");
    expect(report).toBeDefined();
  });

  it("formats human-readable charter summary", () => {
    const parsed = parseCharter(sampleYaml);
    const summary = formatCharterSummary(parsed);
    expect(summary).toContain("G1");
  });
});
