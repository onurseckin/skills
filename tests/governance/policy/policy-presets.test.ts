import { describe, expect, it } from "bun:test";
import {
  getCharterGoal,
  hasCharterGoal,
  CANONICAL_GOVERNANCE_CHARTER_PATH,
  DEFAULT_PROHIBITIONS,
  parseCharter,
} from "../../../olt/scripts/src/mind/governance/index.ts";

const sampleYaml = `identity: mind
repoRoots:
  - "."
goals:
  - id: G-TEST
    statement: Testing goal
    priority: 1
nonGoals:
  - NG1
prohibitions:
  - P1
`;

describe("Governance Policy Presets & Goal Retrieval", () => {
  it("retrieves charter goals by identifier", () => {
    const parsed = parseCharter(sampleYaml);
    expect(hasCharterGoal(parsed, "G-TEST")).toBe(true);
    expect(hasCharterGoal(parsed, "non-existent")).toBe(false);
    expect(getCharterGoal(parsed, "G-TEST")?.statement).toBe("Testing goal");
  });

  it("exports canonical governance paths and prohibitions", () => {
    expect(CANONICAL_GOVERNANCE_CHARTER_PATH).toBeDefined();
    expect(DEFAULT_PROHIBITIONS.length).toBeGreaterThan(0);
  });
});
