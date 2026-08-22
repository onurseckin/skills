import { describe, expect, test } from "bun:test";
import {
  agentIdToRole,
  agentIdToTier,
  identifyExecutionContext,
  parseTierValue,
  roleToTier,
  TIER_NAMES,
  validateTierSpawning,
} from "../../../orchestrating-long-tasks/scripts/src/authority/thread-identifier.ts";

describe("Thread Identifier - 4-Tier Authority & Spawning Rules", () => {
  test("TIER_NAMES explicitly defines all 4 execution tiers", () => {
    expect(TIER_NAMES[0]).toContain("Tier 0: Mind Lead");
    expect(TIER_NAMES[1]).toContain("Tier 1: Orchestrator Lead");
    expect(TIER_NAMES[2]).toContain("Tier 2: Coordinator Lead");
    expect(TIER_NAMES[3]).toContain("Tier 3: Implementer / Validator");
  });

  test("parseTierValue parses strings into correct execution tiers", () => {
    expect(parseTierValue("0")).toBe(0);
    expect(parseTierValue("mind")).toBe(0);
    expect(parseTierValue("1")).toBe(1);
    expect(parseTierValue("orchestrator")).toBe(1);
    expect(parseTierValue("2")).toBe(2);
    expect(parseTierValue("coordinator")).toBe(2);
    expect(parseTierValue("3")).toBe(3);
    expect(parseTierValue("implementer")).toBe(3);
    expect(parseTierValue("validator")).toBe(3);
    expect(parseTierValue("invalid")).toBeNull();
  });

  test("validateTierSpawning validates valid and invalid spawning transitions", () => {
    // Valid 4-tier transitions
    expect(validateTierSpawning(0, 1).allowed).toBe(true);
    expect(validateTierSpawning(1, 2).allowed).toBe(true);
    expect(validateTierSpawning(2, 3).allowed).toBe(true);
    expect(validateTierSpawning(3, 3).allowed).toBe(true);

    // Invalid transitions
    expect(validateTierSpawning(1, 3).allowed).toBe(false); // Orchestrator -> Implementer
    expect(validateTierSpawning(0, 2).allowed).toBe(false); // Mind -> Coordinator
    expect(validateTierSpawning(0, 3).allowed).toBe(false); // Mind -> Implementer
    expect(validateTierSpawning(3, 2).allowed).toBe(false); // Implementer -> Coordinator
    expect(validateTierSpawning(3, 1).allowed).toBe(false); // Implementer -> Orchestrator
    expect(validateTierSpawning(2, 1).allowed).toBe(false); // Coordinator -> Orchestrator
  });

  test("identifyExecutionContext extracts correct tier and role from env and options", () => {
    const context = identifyExecutionContext({
      role: "coordinator",
      agentId: "coord-test",
      env: {
        HARNESS_AGENT_ROLE: "coordinator",
        HARNESS_AGENT_ID: "coord-test",
      },
    });

    expect(context.tier).toBe(2);
    expect(context.role).toBe("coordinator");
    expect(context.agent_id).toBe("coord-test");
    expect(context.compliance_state).toBe("compliant");
  });
});
