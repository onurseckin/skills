import { describe, expect, test } from "bun:test";
import {
  getAllRoleBoundaryProfiles,
  getRoleBoundaryProfile,
  isSupervisoryRole,
  normalizeSupervisoryRole,
} from "../../../olt/scripts/src/authority/persona/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Persona Grounding - Role Boundaries & Subordinates", () => {
  test("isSupervisoryRole accurately validates supervisory roles", () => {
    expect(isSupervisoryRole("mind")).toBe(true);
    expect(isSupervisoryRole("orchestrator")).toBe(true);
    expect(isSupervisoryRole("coordinator")).toBe(true);
    expect(isSupervisoryRole("MIND")).toBe(true);
    expect(isSupervisoryRole("Orchestrator")).toBe(true);
    expect(isSupervisoryRole("COORDINATOR")).toBe(true);

    expect(isSupervisoryRole("implementer")).toBe(false);
    expect(isSupervisoryRole("validator")).toBe(false);
    expect(isSupervisoryRole("repairer")).toBe(false);
    expect(isSupervisoryRole("completeness-critic")).toBe(false);
    expect(isSupervisoryRole("planner")).toBe(false);
    expect(isSupervisoryRole("unknown-role")).toBe(false);
  });

  test("normalizeSupervisoryRole handles string normalization and aliases", () => {
    expect(normalizeSupervisoryRole("mind")).toBe("mind");
    expect(normalizeSupervisoryRole("tier-0")).toBe("mind");
    expect(normalizeSupervisoryRole("orchestrator")).toBe("orchestrator");
    expect(normalizeSupervisoryRole("orch")).toBe("orchestrator");
    expect(normalizeSupervisoryRole("coordinator")).toBe("coordinator");
    expect(normalizeSupervisoryRole("coord")).toBe("coordinator");
    expect(normalizeSupervisoryRole("invalid")).toBeNull();
  });

  test("getRoleBoundaryProfile retrieves exact role profiles", () => {
    const mindProfile = getRoleBoundaryProfile("mind");
    expect(mindProfile).toBeDefined();
    expect(mindProfile.role).toBe("mind");
    expect(mindProfile.tier).toBe(0);
    expect(mindProfile.forbiddenActions.length).toBeGreaterThan(0);
    expect(mindProfile.roleInvariants.length).toBeGreaterThan(0);

    const orchProfile = getRoleBoundaryProfile("orchestrator");
    expect(orchProfile).toBeDefined();
    expect(orchProfile.role).toBe("orchestrator");
    expect(orchProfile.tier).toBe(1);

    const coordProfile = getRoleBoundaryProfile("coordinator");
    expect(coordProfile).toBeDefined();
    expect(coordProfile.role).toBe("coordinator");
    expect(coordProfile.tier).toBe(2);

    expect(() => getRoleBoundaryProfile("unknown-role" as unknown as "mind")).toThrow(HarnessError);
  });

  test("getAllRoleBoundaryProfiles returns mind, orchestrator, and coordinator profiles", () => {
    const profiles = getAllRoleBoundaryProfiles();
    expect(profiles.length).toBe(3);
    const roles = profiles.map((p) => p.role);
    expect(roles).toContain("mind");
    expect(roles).toContain("orchestrator");
    expect(roles).toContain("coordinator");
  });
});
