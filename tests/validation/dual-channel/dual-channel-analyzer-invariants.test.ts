import { describe, expect, it } from "bun:test";

describe("Ultra-Lean Packet Invariants & Fake Completion Purging Verification", () => {
  it("verifies sanitizeLeanContext purges fake completion assumptions and heavy metadata blobs", async () => {
    const { sanitizeLeanContext } =
      await import("../../../olt/scripts/src/packets/validator-context.ts");
    expect(typeof sanitizeLeanContext).toBe("function");

    const payload = {
      clean_field: "valid_value",
      assumed_complete: true,
      assumed_completion: "fake_success",
      fake_completion: "done_without_proof",
      historical_completion: "past_success",
      prior_completion_claim: "i_already_finished",
      stale_pass: true,
      unverified_success: "unverified",
      raw_events: [{ event: "big" }],
      raw_metadata: { heavy: true },
      giant_logs: "100MB_log_data",
      dependency_graph_dump: { nodes: [1, 2, 3] },
      nested: {
        safe: "ok",
        fake_completion: "nested_leak",
        stale_evidence: "old",
      },
    };

    const sanitized = sanitizeLeanContext(payload) as Record<string, unknown>;
    expect(sanitized["clean_field"]).toBe("valid_value");
    expect("assumed_complete" in sanitized).toBe(false);
    expect("assumed_completion" in sanitized).toBe(false);
    expect("fake_completion" in sanitized).toBe(false);
    expect("historical_completion" in sanitized).toBe(false);
    expect("prior_completion_claim" in sanitized).toBe(false);
    expect("stale_pass" in sanitized).toBe(false);
    expect("unverified_success" in sanitized).toBe(false);
    expect("raw_events" in sanitized).toBe(false);
    expect("raw_metadata" in sanitized).toBe(false);
    expect("giant_logs" in sanitized).toBe(false);
    expect("dependency_graph_dump" in sanitized).toBe(false);
    const nested = sanitized["nested"] as Record<string, unknown>;
    expect(nested["safe"]).toBe("ok");
    expect("fake_completion" in nested).toBe(false);
    expect("stale_evidence" in nested).toBe(false);
  });
});
