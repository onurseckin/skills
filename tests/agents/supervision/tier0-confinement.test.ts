import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertAdoptionConfinement,
  assertNoSupervisoryAdoptionOfTier0,
  assertNoSupervisoryRegistrationOfTier0,
  assertRegistrationConfinement,
  assertStrictNullParent,
  assertSubordinateMustBeParented,
  assertTier0CannotParentSubordinates,
  isSubordinateRole,
  isSupervisoryTierRole,
  isTier0Auditor,
  isTier0AuditorAgentId,
  isTier0AuditorRole,
  resolveAgentTier,
  validateAdoptionConfinement,
  validateRegistrationConfinement,
  verifySupervisoryRoleBoundary,
} from "../../../olt/scripts/src/agents/supervision/index.ts";

describe("Tier 0 Auditor Confinement Engine", () => {
  describe("Role & Identifier Classification", () => {
    it("correctly identifies Tier 0 auditor roles and variants", () => {
      expect(isTier0AuditorRole("skill-auditor")).toBe(true);
      expect(isTier0AuditorRole("skill_auditor")).toBe(true);
      expect(isTier0AuditorRole("mind-auditor")).toBe(true);
      expect(isTier0AuditorRole("mind_auditor")).toBe(true);
      expect(isTier0AuditorRole("orchestrator")).toBe(false);
      expect(isTier0AuditorRole("coordinator")).toBe(false);
      expect(isTier0AuditorRole("implementer")).toBe(false);
    });

    it("correctly identifies Tier 0 auditor agent IDs", () => {
      expect(isTier0AuditorAgentId("skill-auditor-1")).toBe(true);
      expect(isTier0AuditorAgentId("mind-auditor-alpha")).toBe(true);
      expect(isTier0AuditorAgentId("worker-skill-auditor")).toBe(true);
      expect(isTier0AuditorAgentId("orchestrator-1")).toBe(false);
      expect(isTier0AuditorAgentId("coordinator-main")).toBe(false);
    });

    it("isTier0Auditor recognizes both role and agentId combinations", () => {
      expect(isTier0Auditor("skill-auditor")).toBe(true);
      expect(isTier0Auditor("mind-auditor-123")).toBe(true);
      expect(isTier0Auditor("implementer-1")).toBe(false);
    });

    it("correctly distinguishes subordinate vs root roles", () => {
      expect(isSubordinateRole("orchestrator")).toBe(false);
      expect(isSubordinateRole("optimizer-orchestrator")).toBe(false);
      expect(isSubordinateRole("domain-orchestrator")).toBe(false);
      expect(isSubordinateRole("mind")).toBe(false);
      expect(isSubordinateRole("skill-auditor")).toBe(false);
      expect(isSubordinateRole("coordinator")).toBe(true);
      expect(isSubordinateRole("implementer")).toBe(true);
      expect(isSubordinateRole("validator")).toBe(true);
    });

    it("resolves execution tiers accurately", () => {
      expect(resolveAgentTier("skill-auditor")).toBe(0);
      expect(resolveAgentTier("orchestrator")).toBe(1);
      expect(resolveAgentTier("coordinator")).toBe(2);
      expect(resolveAgentTier("implementer")).toBe(3);
      expect(isSupervisoryTierRole("orchestrator")).toBe(true);
      expect(isSupervisoryTierRole("coordinator")).toBe(true);
      expect(isSupervisoryTierRole("implementer")).toBe(false);
    });
  });

  describe("Fail-Closed Strict Null Enforcement (assertStrictNullParent)", () => {
    it("allows strict null parent_agent_id for Tier 0 auditors", () => {
      expect(() => {
        assertStrictNullParent("skill-auditor-1", "skill-auditor", null);
      }).not.toThrow();
      expect(() => {
        assertStrictNullParent("mind-auditor-1", "mind-auditor", null);
      }).not.toThrow();
    });

    it("rejects undefined parent_agent_id with ROLE_CONFINEMENT_VIOLATION", () => {
      try {
        assertStrictNullParent("skill-auditor-1", "skill-auditor", undefined);
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(harnessErr.message).toContain("cannot have an undefined parent_agent_id");
      }
    });

    it("rejects empty string and whitespace parent_agent_id", () => {
      for (const empty of ["", "   "]) {
        try {
          assertStrictNullParent("skill-auditor-1", "skill-auditor", empty);
        } catch (err) {
          expect(err).toBeInstanceOf(HarnessError);
          expect((err as HarnessError).code).toBe("ROLE_CONFINEMENT_VIOLATION");
        }
      }
    });

    it("rejects string literal 'null' and supervisory strings", () => {
      for (const val of ["null", "orchestrator-1"]) {
        try {
          assertStrictNullParent("mind-auditor-1", "mind-auditor", val);
        } catch (err) {
          expect(err).toBeInstanceOf(HarnessError);
          expect((err as HarnessError).code).toBe("ROLE_CONFINEMENT_VIOLATION");
        }
      }
    });

    it("rejects non-null primitives (0, false, object)", () => {
      for (const primitive of [0, false, {}]) {
        expect(() => {
          assertStrictNullParent("skill-auditor-1", "skill-auditor", primitive);
        }).toThrow(HarnessError);
      }
    });
  });

  describe("Registration Confinement & Caller Authority", () => {
    it("validates successful Tier 0 registration when parent_agent_id is null and no supervisor caller", () => {
      const res = validateRegistrationConfinement({
        agentId: "skill-auditor-1",
        role: "skill-auditor",
        parentAgentId: null,
      });
      expect(res.valid).toBe(true);
      if (res.valid) expect(res.parentAgentId).toBeNull();
    });

    it("fails registration when Tier 0 auditor has non-null parent", () => {
      const res = validateRegistrationConfinement({
        agentId: "mind-auditor-1",
        role: "mind-auditor",
        parentAgentId: "coordinator-1",
      });
      expect(res.valid).toBe(false);
      if (!res.valid) expect(res.code).toBe("ROLE_CONFINEMENT_VIOLATION");
    });

    it("blocks supervisor caller from registering Tier 0 auditor even with null parent", () => {
      const res = validateRegistrationConfinement({
        agentId: "skill-auditor-1",
        role: "skill-auditor",
        parentAgentId: null,
        callerAgentId: "orchestrator-1",
        callerRole: "orchestrator",
      });
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(res.reason).toContain("prohibited from performing 'register'");
      }
    });

    it("rejects subordinate agent attempting unparented registration", () => {
      const res = validateRegistrationConfinement({
        agentId: "worker-1",
        role: "implementer",
        parentAgentId: null,
      });
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(res.reason).toContain("cannot be unparented");
      }
    });

    it("allows root genesis unparented registration when flag is set", () => {
      const res = validateRegistrationConfinement({
        agentId: "optimizer-orchestrator-1",
        role: "optimizer-orchestrator",
        parentAgentId: null,
        isRootGenesis: true,
      });
      expect(res.valid).toBe(true);
    });

    it("rejects attempt to use Tier 0 auditor as parent for subordinate agent", () => {
      const res = validateRegistrationConfinement({
        agentId: "worker-1",
        role: "implementer",
        parentAgentId: "skill-auditor-1",
      });
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(res.reason).toContain("cannot serve as parent");
      }
    });

    it("blocks Tier 1 direct-supervision shortcut (Tier 1 registering Tier 3 directly)", () => {
      const res = validateRegistrationConfinement({
        agentId: "worker-1",
        role: "implementer",
        parentAgentId: "orchestrator-1",
      });
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(res.reason).toContain("Direct-supervision shortcut breach");
      }
    });

    it("allows Tier 1 registering Tier 2 coordinator", () => {
      const res = validateRegistrationConfinement({
        agentId: "coordinator-1",
        role: "coordinator",
        parentAgentId: "orchestrator-1",
      });
      expect(res.valid).toBe(true);
    });

    it("allows Tier 2 coordinator registering Tier 3 implementer", () => {
      const res = validateRegistrationConfinement({
        agentId: "worker-1",
        role: "implementer",
        parentAgentId: "coordinator-1",
      });
      expect(res.valid).toBe(true);
    });
  });

  describe("Adoption Confinement & Boundary Vectors", () => {
    it("mechanically blocks adoption of any Tier 0 auditor", () => {
      const res = validateAdoptionConfinement({
        targetAgentId: "skill-auditor-1",
        targetRole: "skill-auditor",
        newParentAgentId: "coordinator-1",
      });
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(res.reason).toContain("cannot be adopted or reparented");
      }
    });

    it("blocks supervisor caller from adopting Tier 0 auditor", () => {
      const res = validateAdoptionConfinement({
        targetAgentId: "mind-auditor-1",
        targetRole: "mind-auditor",
        callerAgentId: "coordinator-1",
        callerRole: "coordinator",
      });
      expect(res.valid).toBe(false);
      if (!res.valid) expect(res.code).toBe("ROLE_CONFINEMENT_VIOLATION");
    });

    it("blocks Tier 1 direct-supervision shortcut in adoption", () => {
      const res = validateAdoptionConfinement({
        targetAgentId: "worker-1",
        targetRole: "implementer",
        newParentAgentId: "orchestrator-1",
      });
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(res.reason).toContain("Direct-supervision shortcut breach");
      }
    });

    it("blocks hierarchy inversion (Tier 2 adopting Tier 1 Orchestrator)", () => {
      const res = validateAdoptionConfinement({
        targetAgentId: "orchestrator-1",
        targetRole: "orchestrator",
        newParentAgentId: "coordinator-1",
      });
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(res.reason).toContain("Hierarchy inversion breach");
      }
    });

    it("blocks horizontal cross-lane coordinator adoption (Tier 2 adopting Tier 2)", () => {
      const res = validateAdoptionConfinement({
        targetAgentId: "coordinator-beta",
        targetRole: "coordinator",
        newParentAgentId: "coordinator-alpha",
      });
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(res.reason).toContain("Horizontal cross-lane breach");
      }
    });

    it("allows valid subordinate adoption under Tier 2 coordinator", () => {
      const res = validateAdoptionConfinement({
        targetAgentId: "worker-1",
        targetRole: "implementer",
        newParentAgentId: "coordinator-2",
      });
      expect(res.valid).toBe(true);
      if (res.valid) expect(res.parentAgentId).toBe("coordinator-2");
    });
  });

  describe("Role Boundary Verifier Engine", () => {
    it("blocks supervisory registration and adoption of Tier 0", () => {
      try {
        assertNoSupervisoryRegistrationOfTier0(
          "orchestrator-1",
          "orchestrator",
          "skill-auditor-1",
          "skill-auditor",
        );
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).code).toBe("ROLE_CONFINEMENT_VIOLATION");
      }

      try {
        assertNoSupervisoryAdoptionOfTier0(
          "coordinator-1",
          "coordinator",
          "mind-auditor-1",
          "mind-auditor",
        );
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).code).toBe("ROLE_CONFINEMENT_VIOLATION");
      }
    });
  });

  describe("Cognitive Security & Stringification Safety", () => {
    it("safely handles Symbol and adversarial non-primitive values without crash", () => {
      const sym = Symbol("adversarial_parent");
      try {
        assertStrictNullParent("skill-auditor-1", "skill-auditor", sym);
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(harnessErr.message).toContain("Symbol(adversarial_parent)");
      }

      const throwingObj = {
        toString() {
          throw new Error("malicious toString");
        },
      };
      try {
        assertStrictNullParent("skill-auditor-1", "skill-auditor", throwingObj);
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      }
    });
  });
});
