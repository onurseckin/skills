import { describe, expect, it } from "bun:test";
import {
  FIXTURE_MIND_ROOT,
  FIXTURE_ORCH_ROOT,
  FIXTURE_COORD_ROOT,
} from "./agent-supervisor-chain.ts";

describe("Agent Supervisor Chain Constants & Hierarchy", () => {
  it("exports canonical fixture supervisor identities", () => {
    expect(FIXTURE_MIND_ROOT).toBe("fixture-mind-root");
    expect(FIXTURE_ORCH_ROOT).toBe("fixture-orch-root");
    expect(FIXTURE_COORD_ROOT).toBe("fixture-coord-root");
  });
});
