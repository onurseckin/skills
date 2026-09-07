/**
 * @file conversational-engagement-protocols.test.ts
 * Conversational Engagement Protocols & Active Swarm Audit Integration Test Suite.
 *
 * Validates:
 * 1. Mandatory 3-Round (6-Turn) Socratic Conversational Laddering:
 *    - Round 1 (Turn 1 & 2): Strategic Intent & Horizon Audit.
 *    - Round 2 (Turn 3 & 4): Adversarial Reality & Quality Challenge.
 *    - Round 3 (Turn 5 & 6): Evolutionary Frontier & Concrete Milestone Lock.
 *    - Enforces minimum 6 turns before audit conclusion; rejects canned templates & single-turn notifications.
 * 2. Active Swarm Tailored 1-on-1 Conversational Audits (Skill Auditor):
 *    - Dynamic agent discovery across Orchestrators, Coordinators, Implementers, Validators.
 *    - Four core interrogation inquiries:
 *      1. Atomic task clarity & verification standards.
 *      2. Capability boundaries (Zero supervisor code edits, zero validator test runs).
 *      3. Forward momentum evidence (File-scoped tests, UI layout renders, artifact writes).
 *      4. Self-reflection & blocker disclosure.
 *    - Evaluation: momentum confirmation & invariant re-anchoring.
 * 3. Three-Strike Mechanical Containment & Capability Revocation:
 *    - Strike 1: HALT_AND_DELEGATE (intercepts supervisor attempting direct code edits or tool invocation, issues violation, forces delegation to implementer).
 *    - Strike 2: CAPABILITY_REVOCATION (hard tool stripping of write_to_file, replace_file_content, run_command).
 *    - Strike 3: PERSONA_RESPAWN (terminates rogue agent, sanitizes state, spawns fresh compliant persona).
 *    - Validator Zero Test Execution Invariant: intercepts validator trying to run test runner commands directly.
 * 4. Zero Main Thread Pollution Guarantee for Conversational Audits:
 *    - Mailbox IPC only (.olt/mailboxes/<agentId>).
 *    - Zero console / stdout spam.
 */

import { describe, expect, it } from "bun:test";
import {
  DIALECTICAL_LEVELS,
  HistoricalDebateMemory,
  PARETO_PRIORITY_LEVELS,
  SocraticLadderingEngine,
  type StrategicCommitment,
} from "../../../../olt/scripts/src/mind/auditing/socratic/index.ts";
import {
  DEFAULT_REVOKED_TOOLS,
  MechanicalContainmentEngine,
  type ContainmentResult,
  type SupervisoryViolation,
} from "../../../../olt/scripts/src/mind/containment/index.ts";

describe("Conversational Engagement Protocols - Part 1", () => {
  it("verifies dialectical levels and strategic commitment definitions in memory", () => {
    expect(DIALECTICAL_LEVELS.L1_TRADE_OFF_VERIFICATION).toBe("L1_TRADE_OFF_VERIFICATION");
    expect(DIALECTICAL_LEVELS.L2_SECOND_ORDER_IMPLICATIONS).toBe("L2_SECOND_ORDER_IMPLICATIONS");
    expect(DIALECTICAL_LEVELS.L3_EMERGENT_PARADIGMS).toBe("L3_EMERGENT_PARADIGMS");

    expect(PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_CORRECTNESS).toBe(1);
    expect(PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY).toBe(2);
    expect(PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT).toBe(3);
    expect(PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION).toBe(4);

    expect(DEFAULT_REVOKED_TOOLS).toBeDefined();
    expect(DEFAULT_REVOKED_TOOLS).toContain("write_to_file");
    expect(DEFAULT_REVOKED_TOOLS).toContain("run_command");
  });

  it("enforces immutability and state isolation in SocraticLadderingEngine and HistoricalDebateMemory", () => {
    const memory = new HistoricalDebateMemory();
    const engine = new SocraticLadderingEngine(memory);

    const state = engine.getState();
    expect(state.currentLevel).toBe(DIALECTICAL_LEVELS.L1_TRADE_OFF_VERIFICATION);
    expect(state.consecutiveImpasseCycles).toBe(0);
    expect(Object.isFrozen(state.history)).toBe(true);

    const now = new Date().toISOString();
    const commitment: StrategicCommitment = {
      id: "comm-01",
      topic: "in-memory-audit",
      agreedResolution: "zero disk io",
      targetMilestone: "M1",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    memory.recordCommitment(commitment);
    const active = memory.getActiveCommitments();
    expect(active.length).toBe(1);
    expect(Object.isFrozen(active)).toBe(true);
    const first = active[0];
    expect(first).toBeDefined();
    if (first) {
      expect(first.id).toBe("comm-01");
      expect(first.status).toBe("pending");
    }

    // Verify a fresh memory instance has zero leaked commitments
    const isolatedMemory = new HistoricalDebateMemory();
    expect(isolatedMemory.getActiveCommitments().length).toBe(0);
  });
});
