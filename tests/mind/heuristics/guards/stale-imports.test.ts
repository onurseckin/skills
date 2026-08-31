import { describe, expect, it } from "bun:test";
import { formatProposalBrief } from "../../../../olt/scripts/src/mind/proposals/index.ts";

describe("Mind Heuristics Stale Imports Suite", () => {
  it("resolves all canonical imports cleanly", () => {
    expect(formatProposalBrief).toBeDefined();
  });
});
