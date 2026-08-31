import { describe, expect, it } from "bun:test";
import {
  deriveCounterfactualRequirement,
  normalizeCriticFinding,
} from "../../../olt/scripts/src/engine/scheduler/diagnostics/critic/critic-normalization.ts";

describe("Critic Finding Normalization & Counterfactuals", () => {
  it("derives counterfactual requirement from observation and remediation", () => {
    const req = deriveCounterfactualRequirement("Null pointer in parser", "Added null check");
    expect(req).toContain("Null pointer in parser");
    expect(req).toContain("Added null check");
  });

  it("normalizes well-formed raw finding", () => {
    const raw = {
      id: "find-1",
      requirement_id: "req-1",
      observation: "Bug observed",
      remediation: "Fix applied",
      severity: "critical",
    };
    const norm = normalizeCriticFinding(raw);
    expect(norm).not.toBeNull();
    expect(norm?.severity).toBe("critical");
    expect(norm?.id).toBe("find-1");
  });

  it("returns null for malformed raw findings", () => {
    expect(normalizeCriticFinding(null)).toBeNull();
    expect(normalizeCriticFinding({})).toBeNull();
    expect(normalizeCriticFinding({ id: "1" })).toBeNull();
  });
});
