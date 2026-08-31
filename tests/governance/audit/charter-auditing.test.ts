import { describe, expect, it } from "bun:test";
import { auditCharterGoals } from "../../../olt/scripts/src/mind/auditing/charter-auditing.ts";
import { parseCharter } from "../../../olt/scripts/src/mind/governance/index.ts";

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

describe("Charter Auditing Engine", () => {
  it("audits charter goals against referenced and required goals", () => {
    const charter = parseCharter(sampleYaml);
    const result = auditCharterGoals(charter, ["G1"], ["G1"]);
    expect(result.valid).toBe(true);
    expect(result.findings.length).toBe(0);
  });

  it("flags missing or unmapped goals", () => {
    const charter = parseCharter(sampleYaml);
    const result = auditCharterGoals(charter, ["UNMAPPED"], ["MISSING_REQ"]);
    expect(result.valid).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
