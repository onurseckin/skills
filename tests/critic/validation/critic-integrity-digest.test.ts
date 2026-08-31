import { describe, expect, it } from "bun:test";
import { criticIntegrityDigest } from "../../../olt/scripts/src/packets/critic-integrity-digest.ts";

describe("Critic Integrity Digest Calculation", () => {
  it("computes deterministic SHA256 digest ignoring event_head field", () => {
    const ev1 = [{ event_head: "001", finding_id: "f-1", score: 100 }];
    const ev2 = [{ event_head: "002", finding_id: "f-1", score: 100 }];
    const digest1 = criticIntegrityDigest(ev1);
    const digest2 = criticIntegrityDigest(ev2);
    expect(digest1).toBe(digest2);
    expect(digest1.length).toBe(64);
  });
});
