import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import {
  clearManifestCache,
  findSkillRoot,
  listAvailableManifests,
  listAvailableRoles,
  loadAgentManifest,
  loadRoleContract,
  loadUnifiedAgentModel,
} from "../../../olt/scripts/src/authority/manifest/index.ts";
import {
  cleanupVirtualAuthorityFS,
  getVirtualAuthorityFS,
  setupVirtualAuthorityFS,
} from "../fixture.ts";

describe("Authority Manifest Parser - Discovery & Caching", () => {
  let cwdSpy: Mock<() => string> | undefined;

  beforeAll(() => {
    try {
      findSkillRoot();
      listAvailableRoles();
      listAvailableManifests();
    } catch {}
  });

  beforeEach(() => {
    setupVirtualAuthorityFS();
    clearManifestCache();
    cwdSpy = spyOn(process, "cwd").mockReturnValue("/virtual/skills");
  });

  afterEach(() => {
    cwdSpy?.mockRestore();
    clearManifestCache();
    cleanupVirtualAuthorityFS();
  });
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

  test("filters out non-manifest artifacts and subdirectories during discovery", () => {
    const vfs = getVirtualAuthorityFS();
    const agentsDir = "/virtual/skills/agents";
    vfs.writeFileSync(`${agentsDir}/readme.txt`, "Documentation");
    vfs.writeFileSync(`${agentsDir}/schema.json`, "{}");
    vfs.writeFileSync(`${agentsDir}/.DS_Store`, "binary");
    vfs.mkdirSync(`${agentsDir}/nested-dir`, { recursive: true });

    const roles = listAvailableRoles();
    expect(roles).not.toContain("readme");
    expect(roles).not.toContain("schema");
    expect(roles).not.toContain(".DS_Store");
    expect(roles).not.toContain("nested-dir");
    expect(roles).toContain("mind");

    const manifests = listAvailableManifests();
    expect(manifests).not.toContain("readme");
    expect(manifests).not.toContain("schema");
    expect(manifests).not.toContain(".DS_Store");
    expect(manifests).not.toContain("nested-dir");
    expect(manifests).toContain("mind");
  });
});
