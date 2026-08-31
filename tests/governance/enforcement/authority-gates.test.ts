import { describe, expect, it } from "bun:test";
import { createTier0AgentGrants } from "../../../olt/scripts/src/mind/governance/index.ts";

describe("Governance Authority Gates & Tier 0 Grants", () => {
  it("creates tier 0 agent grants structure", () => {
    const grants = createTier0AgentGrants("agent-1");
    expect(grants).toBeDefined();
  });
});
