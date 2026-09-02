import { describe, expect, it } from "bun:test";
import type { AgentRole } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  ROLE_TIER_MAP,
  ALLOWED_TIER_SPAWNS,
  ABSTRACT_PROFILES,
  PROHIBITED_MODEL_PATTERNS,
  PROHIBITED_TELEMETRY_KEYS,
  validateTierSpawn,
  assertTierSpawn,
  validateAbstractProfile,
  assertAbstractProfile,
  enforceIsolatedTaskDispatch,
  atomicAdmissionToDispatch,
} from "../../../../olt/scripts/src/mind/lifecycle/deploy/types.ts";

describe("Mind Deploy Types & Tier Hierarchy Suite", () => {
  describe("Role Tiers & Spawn Rules Constants", () => {
    it("defines tiers 0 to 3 for all canonical agent roles", () => {
      expect(ROLE_TIER_MAP.mind).toBe(0);
      expect(ROLE_TIER_MAP["skill-auditor"]).toBe(0);
      expect(ROLE_TIER_MAP["policy-discovery"]).toBe(0);
      expect(ROLE_TIER_MAP.orchestrator).toBe(1);
      expect(ROLE_TIER_MAP["mind-auditor"]).toBe(1);
      expect(ROLE_TIER_MAP.coordinator).toBe(2);
      expect(ROLE_TIER_MAP.planner).toBe(2);
      expect(ROLE_TIER_MAP.repairer).toBe(2);
      expect(ROLE_TIER_MAP.implementer).toBe(3);
      expect(ROLE_TIER_MAP.validator).toBe(3);
      expect(ROLE_TIER_MAP["sub-implementer"]).toBe(3);
    });

    it("exports abstract profiles and prohibited telemetry keys", () => {
      expect(ABSTRACT_PROFILES).toEqual(["deliberate", "default", "adversarial", "cheap_bulk"]);
      expect(PROHIBITED_TELEMETRY_KEYS.has("model")).toBe(true);
      expect(PROHIBITED_TELEMETRY_KEYS.has("provider")).toBe(true);
      expect(PROHIBITED_TELEMETRY_KEYS.has("thinking_level")).toBe(true);
      expect(PROHIBITED_MODEL_PATTERNS.length).toBeGreaterThan(10);
    });
  });

  describe("validateTierSpawn & assertTierSpawn", () => {
    it("validates authorized parent-child transitions across all valid tiers", () => {
      const validSpawns: Array<[AgentRole, AgentRole]> = [
        ["mind", "orchestrator"],
        ["orchestrator", "coordinator"],
        ["coordinator", "implementer"],
        ["coordinator", "validator"],
        ["coordinator", "planner"],
        ["coordinator", "plan-validator"],
        ["coordinator", "repairer"],
        ["coordinator", "completeness-critic"],
        ["coordinator", "mechanic-validator"],
        ["coordinator", "ui-headless-validator"],
        ["coordinator", "ui-mechanic-validator"],
        ["coordinator", "ui-optical-validator"],
        ["coordinator", "ui-validator"],
        ["implementer", "sub-implementer"],
        ["implementer", "sub-investigator"],
        ["validator", "sub-validator"],
        ["mechanic-validator", "sub-validator"],
        ["ui-validator", "sub-validator"],
      ];

      for (const [parent, child] of validSpawns) {
        const res = validateTierSpawn(parent, child);
        expect(res.ok).toBe(true);
        expect(res.parentRole).toBe(parent);
        expect(res.childRole).toBe(child);
        expect(() => assertTierSpawn(parent, child)).not.toThrow();
      }
    });

    it("rejects unrecognized agent roles", () => {
      const invalidParent = validateTierSpawn("invalid-role" as AgentRole, "orchestrator");
      expect(invalidParent.ok).toBe(false);
      expect(invalidParent.reason).toContain("unrecognized agent role(s)");
      expect(invalidParent.parentTier).toBe(-1);

      const invalidChild = validateTierSpawn("mind", "invalid-role" as AgentRole);
      expect(invalidChild.ok).toBe(false);
      expect(invalidChild.childTier).toBe(-1);

      expect(() => assertTierSpawn("invalid-role" as AgentRole, "orchestrator")).toThrow(
        HarnessError,
      );
    });

    it("rejects self-deployment", () => {
      const selfMind = validateTierSpawn("mind", "mind");
      expect(selfMind.ok).toBe(false);
      expect(selfMind.reason).toBe("a role cannot deploy itself: mind");

      const selfCoord = validateTierSpawn("coordinator", "coordinator");
      expect(selfCoord.ok).toBe(false);
      expect(selfCoord.reason).toBe("a role cannot deploy itself: coordinator");
    });

    it("rejects invalid tier jumps with specialized reasons", () => {
      // Mind spawning non-orchestrator
      const mindToCoord = validateTierSpawn("mind", "coordinator");
      expect(mindToCoord.ok).toBe(false);
      expect(mindToCoord.reason).toContain("tier 0 mind may only deploy tier 1 orchestrator");

      // Orchestrator spawning non-coordinator
      const orchToImpl = validateTierSpawn("orchestrator", "implementer");
      expect(orchToImpl.ok).toBe(false);
      expect(orchToImpl.reason).toContain("tier 1 orchestrator may only deploy tier 2 coordinator");

      // Coordinator spawning higher tier
      const coordToMind = validateTierSpawn("coordinator", "mind");
      expect(coordToMind.ok).toBe(false);
      expect(coordToMind.reason).toContain(
        "tier 2 coordinator cannot deploy higher-tier role mind",
      );

      const coordToOrch = validateTierSpawn("coordinator", "orchestrator");
      expect(coordToOrch.ok).toBe(false);
      expect(coordToOrch.reason).toContain(
        "tier 2 coordinator cannot deploy higher-tier role orchestrator",
      );

      // Generic violation
      const implToCoord = validateTierSpawn("implementer", "coordinator");
      expect(implToCoord.ok).toBe(false);
      expect(implToCoord.reason).toContain("violates strict tier hierarchy");

      const leafSpawn = validateTierSpawn("sub-implementer", "validator");
      expect(leafSpawn.ok).toBe(false);
      expect(leafSpawn.reason).toContain("violates strict tier hierarchy");
    });
  });

  describe("validateAbstractProfile & assertAbstractProfile", () => {
    it("accepts valid abstract profile names", () => {
      for (const profile of ABSTRACT_PROFILES) {
        const res = validateAbstractProfile(profile);
        expect(res.ok).toBe(true);
        expect(() => assertAbstractProfile(profile)).not.toThrow();
      }
      expect(validateAbstractProfile("custom-abstract-heuristic").ok).toBe(true);
    });

    it("rejects empty or whitespace profile strings", () => {
      expect(validateAbstractProfile("").ok).toBe(false);
      expect(validateAbstractProfile("   ").ok).toBe(false);
      expect(validateAbstractProfile(null as unknown as string).ok).toBe(false);
      expect(() => assertAbstractProfile("")).toThrow(HarnessError);
    });

    it("rejects concrete model identifiers matching PROHIBITED_MODEL_PATTERNS", () => {
      const concreteModels = [
        "claude-3-opus",
        "claude-3-5-sonnet-20241022",
        "claude-3-haiku",
        "gpt-4o",
        "gemini-1.5-pro",
        "llama-3.1-70b",
        "deepseek-coder",
        "qwen-2.5-coder",
        "mistral-large",
        "o1-preview",
        "o3-mini",
        "flash_lite",
        "pro",
        "inherit",
      ];

      for (const model of concreteModels) {
        const res = validateAbstractProfile(model);
        expect(res.ok).toBe(false);
        expect(res.reason).toContain("contains concrete model identifier");
        expect(() => assertAbstractProfile(model)).toThrow(HarnessError);
      }
    });
  });

  describe("enforceIsolatedTaskDispatch & atomicAdmissionToDispatch", () => {
    it("generates deterministic implementer, validator, and write scope tasks", () => {
      const dispatch = enforceIsolatedTaskDispatch("cand-auth-fix");
      expect(dispatch).toEqual({
        implementerTaskId: "cand-auth-fix-impl",
        validatorTaskId: "cand-auth-fix-val",
        writeScope: ["src/cand-auth-fix"],
      });
    });

    it("evaluates atomic admission to dispatch requirements", () => {
      expect(atomicAdmissionToDispatch("cand-123")).toBe(true);
      expect(atomicAdmissionToDispatch("")).toBe(false);
      expect(atomicAdmissionToDispatch("   ")).toBe(false);
    });
  });
});
