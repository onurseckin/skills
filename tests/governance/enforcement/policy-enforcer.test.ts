import { describe, expect, it } from "bun:test";
import {
  assertGovernanceCharter,
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

describe("Governance Enforcement & Assertions", () => {
  it("assertGovernanceCharter passes for valid charter", () => {
    const parsed = parseCharter(sampleYaml);
    expect(() => assertGovernanceCharter(parsed)).not.toThrow();
  });

  it("assertGovernanceCharter throws for invalid charter", () => {
    const invalid = { goals: [] } as never;
    expect(() => assertGovernanceCharter(invalid)).toThrow();
  });
});
