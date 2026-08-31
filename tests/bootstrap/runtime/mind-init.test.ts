import { describe, expect, it } from "bun:test";
import {
  MANDATORY_MIND_COMPANION_AUDITORS,
  createMandatoryMindCompanionGrants,
} from "../../../olt/scripts/src/mind/lifecycle/mind-init.ts";

describe("Mind Initialization Lifecycle & Companions", () => {
  it("exports mandatory mind companion auditors", () => {
    expect(MANDATORY_MIND_COMPANION_AUDITORS.length).toBeGreaterThan(0);
    expect(MANDATORY_MIND_COMPANION_AUDITORS).toContain("skill-auditor");
    expect(MANDATORY_MIND_COMPANION_AUDITORS).toContain("mind-auditor");
  });

  it("creates mandatory mind companion grants", () => {
    const grants = createMandatoryMindCompanionGrants("mind-123");
    expect(grants.length).toBe(MANDATORY_MIND_COMPANION_AUDITORS.length);
    expect(grants[0].parent_agent_id).toBe("mind-123");
    expect(grants[0].id).toBe("mind-123-mind-auditor");
  });
});
