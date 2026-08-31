import { describe, expect, test } from "bun:test";
import {
  clearManifestCache,
  findSkillRoot,
  listAvailableManifests,
  listAvailableRoles,
  loadAgentManifest,
  loadRoleContract,
  loadUnifiedAgentModel,
} from "../../../olt/scripts/src/authority/manifest/index.ts";

describe("Authority Manifest Parser - Discovery & Caching", () => {
  test("findSkillRoot resolves skill repository root", () => {
    const root = findSkillRoot();
    expect(typeof root).toBe("string");
    expect(root.length).toBeGreaterThan(0);
  });

  test("loads standard system agent manifests", () => {
    const mindManifest = loadAgentManifest("mind");
    expect(mindManifest.name).toBe("mind");
    expect(mindManifest.tier).toBe(0);

    const orchManifest = loadAgentManifest("orchestrator");
    expect(orchManifest.name).toBe("orchestrator");
    expect(orchManifest.tier).toBe(1);

    const coordManifest = loadAgentManifest("coordinator");
    expect(coordManifest.name).toBe("coordinator");
    expect(coordManifest.tier).toBe(2);

    const implManifest = loadAgentManifest("implementer");
    expect(implManifest.name).toBe("implementer");
    expect(implManifest.tier).toBe(3);
  });

  test("loads standard system role contracts", () => {
    const mindContract = loadRoleContract("mind");
    expect(mindContract.role).toBe("mind");
    expect(mindContract.tier).toBe(0);

    const coordContract = loadRoleContract("coordinator");
    expect(coordContract.role).toBe("coordinator");
    expect(coordContract.tier).toBe(2);
  });

  test("lists available roles and manifests cleanly", () => {
    const roles = listAvailableRoles();
    expect(roles).toContain("mind");
    expect(roles).toContain("orchestrator");
    expect(roles).toContain("coordinator");
    expect(roles).toContain("implementer");
    expect(roles).toContain("validator");

    const manifests = listAvailableManifests();
    expect(manifests).toContain("mind");
    expect(manifests).toContain("orchestrator");
    expect(manifests).toContain("coordinator");
    expect(manifests).toContain("implementer");
    expect(manifests).toContain("validator");
  });

  test("clearManifestCache and bypassCache options function correctly", () => {
    clearManifestCache();
    const model1 = loadUnifiedAgentModel("coordinator");
    const model2 = loadUnifiedAgentModel("coordinator", { bypassCache: true });
    expect(model1.role).toBe(model2.role);
  });
});
