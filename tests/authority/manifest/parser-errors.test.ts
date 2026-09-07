import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import {
  clearManifestCache,
  loadAgentManifest,
  loadRoleContract,
} from "../../../olt/scripts/src/authority/manifest/index.ts";
import { parseUnifiedAgentManifest } from "../../../olt/scripts/src/authority/manifest-schema.ts";
import {
  cleanupVirtualAuthorityFS,
  setupVirtualAuthorityFS,
} from "../fixture.ts";

describe("Authority Manifest Parser - Error Handling & Fallbacks", () => {
  let cwdSpy: Mock<() => string> | undefined;

  beforeAll(() => {
    try {
      parseUnifiedAgentManifest("name: warmup\nrole: warmup\ntier: 3\n");
      loadRoleContract("warmup");
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
  test("throws on invalid YAML or non-object documents", () => {
    expect(() => parseUnifiedAgentManifest("just a plain string")).toThrow(
      "YAML document must be an object",
    );
    expect(() => parseUnifiedAgentManifest("- item1\n- item2")).toThrow(
      "YAML document must be an object",
    );
  });

  test("generates synthetic fallback contract for missing roles", () => {
    const synthetic = loadRoleContract("custom-mock-role");
    expect(synthetic.role).toBe("custom-mock-role");
    expect(synthetic.tier).toBe(3);
    expect(synthetic.may.length).toBeGreaterThan(0);
    expect(synthetic.mustNot.length).toBeGreaterThan(0);
  });

  test("normalizes role names with whitespace and varying casing to matching manifests", () => {
    const mindManifest = loadAgentManifest("  MIND  ");
    expect(mindManifest.name).toBe("mind");
    expect(mindManifest.tier).toBe(0);

    const coordContract = loadRoleContract("\tCOORDINATOR\n");
    expect(coordContract.role).toBe("coordinator");
    expect(coordContract.tier).toBe(2);
  });

  test("creates well-formed fallback AgentManifest for unregistered roles", () => {
    const fallback = loadAgentManifest("nonexistent-worker");
    expect(fallback.name).toBe("nonexistent-worker");
    expect(fallback.role).toBe("nonexistent-worker");
    expect(fallback.tier).toBe(3);
    expect(fallback.provider).toEqual(["generic"]);
    expect(fallback.tools?.enable_subagent_tools).toBe(true);
    expect(fallback.tools?.enable_write_tools).toBe(true);
  });
});
