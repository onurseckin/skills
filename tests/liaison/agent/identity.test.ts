import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  ALLOWED_LIAISON_ACTIONS,
  FORBIDDEN_LIAISON_ACTIONS,
  TIER_0_INVARIANTS,
  assertTier0Invariant,
  canPerformAction,
  createLiaisonIdentity,
  formatLiaisonAgentId,
  isLiaisonIdentity,
  isValidSystemName,
  parseLiaisonIdentity,
} from "../../../olt/scripts/src/liaison/agent/index.ts";

describe("Liaison Identity & Tier-0 Invariants", () => {
  test("isValidSystemName validates system identifiers", () => {
    expect(isValidSystemName("claude")).toBe(true);
    expect(isValidSystemName("antigravity")).toBe(true);
    expect(isValidSystemName("system_123")).toBe(true);
    expect(isValidSystemName("sys-alpha")).toBe(true);

    expect(isValidSystemName("")).toBe(false);
    expect(isValidSystemName("   ")).toBe(false);
    expect(isValidSystemName("claude/sub")).toBe(false);
    expect(isValidSystemName("sys\\win")).toBe(false);
    expect(isValidSystemName("../escape")).toBe(false);
    expect(isValidSystemName(123)).toBe(false);
    expect(isValidSystemName(null)).toBe(false);
  });

  test("formatLiaisonAgentId formats canonical identity string", () => {
    expect(formatLiaisonAgentId("Claude")).toBe("liaison_claude");
    expect(formatLiaisonAgentId("ANTIGRAVITY")).toBe("liaison_antigravity");
    expect(formatLiaisonAgentId("system-a")).toBe("liaison_system-a");

    expect(() => formatLiaisonAgentId("")).toThrow(HarnessError);
    expect(() => formatLiaisonAgentId("../bad")).toThrow(HarnessError);
  });

  test("isLiaisonIdentity recognizes valid and invalid identities", () => {
    expect(isLiaisonIdentity("liaison_claude")).toBe(true);
    expect(isLiaisonIdentity("liaison_antigravity")).toBe(true);
    expect(isLiaisonIdentity("liaison_sub-system_1")).toBe(true);

    expect(isLiaisonIdentity("orchestrator_phase-fundamentals")).toBe(false);
    expect(isLiaisonIdentity("implementer_task-1")).toBe(false);
    expect(isLiaisonIdentity("liaison_")).toBe(false);
    expect(isLiaisonIdentity("liaison_../traversal")).toBe(false);
    expect(isLiaisonIdentity(null)).toBe(false);
    expect(isLiaisonIdentity(undefined)).toBe(false);
  });

  test("parseLiaisonIdentity creates fully hydrated Tier-0 LiaisonIdentity", () => {
    const identity = parseLiaisonIdentity("liaison_claude");
    expect(identity.agentId).toBe("liaison_claude");
    expect(identity.system).toBe("claude");
    expect(identity.tier).toBe(0);
    expect(identity.role).toBe("liaison");
    expect(identity.invariants).toEqual(TIER_0_INVARIANTS);

    expect(() => parseLiaisonIdentity("orchestrator_main")).toThrow(HarnessError);
    expect(() => parseLiaisonIdentity("")).toThrow(HarnessError);
  });

  test("createLiaisonIdentity creates identity from system name", () => {
    const identity = createLiaisonIdentity("antigravity");
    expect(identity.agentId).toBe("liaison_antigravity");
    expect(identity.system).toBe("antigravity");
    expect(identity.tier).toBe(0);
  });

  test("canPerformAction distinguishes allowed vs forbidden liaison actions", () => {
    for (const action of ALLOWED_LIAISON_ACTIONS) {
      expect(canPerformAction(action)).toBe(true);
    }

    for (const action of FORBIDDEN_LIAISON_ACTIONS) {
      expect(canPerformAction(action)).toBe(false);
    }
  });

  test("assertTier0Invariant permits transport actions and rejects execution actions", () => {
    const identity = createLiaisonIdentity("claude");

    expect(() => assertTier0Invariant(identity, "DRAIN_MAILBOX")).not.toThrow();
    expect(() => assertTier0Invariant(identity, "EMIT_RECEIPT")).not.toThrow();
    expect(() => assertTier0Invariant(identity, "EMIT_HEARTBEAT")).not.toThrow();
    expect(() => assertTier0Invariant(identity, "ANSWER_QUERY")).not.toThrow();
    expect(() => assertTier0Invariant(identity, "ROUTE_ESCALATION")).not.toThrow();
    expect(() => assertTier0Invariant(identity, "CHECK_OBLIGATION")).not.toThrow();

    expect(() => assertTier0Invariant(identity, "PLAN")).toThrow(HarnessError);
    expect(() => assertTier0Invariant(identity, "CLAIM_TASK")).toThrow(HarnessError);
    expect(() => assertTier0Invariant(identity, "CLAIM_LEASE")).toThrow(HarnessError);
    expect(() => assertTier0Invariant(identity, "IMPLEMENT")).toThrow(HarnessError);
    expect(() => assertTier0Invariant(identity, "EDIT_CODE")).toThrow(HarnessError);
    expect(() => assertTier0Invariant(identity, "RUN_GATE")).toThrow(HarnessError);
    expect(() => assertTier0Invariant(identity, "SEAL_RUN")).toThrow(HarnessError);
  });

  test("assertTier0Invariant throws ROLE_BOUNDARY_DEVIATION error code", () => {
    const identity = createLiaisonIdentity("antigravity");
    try {
      assertTier0Invariant(identity, "PLAN");
      expect(true).toBe(false);
    } catch (err) {
      expect(err instanceof HarnessError).toBe(true);
      if (err instanceof HarnessError) {
        expect(err.code).toBe("ROLE_BOUNDARY_DEVIATION");
        expect(err.message).toContain("liaison_antigravity");
        expect(err.message).toContain("PLAN");
      }
    }
  });
});
