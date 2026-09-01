import { describe, expect, it } from "bun:test";
import { scratchRoot, createSandboxDir, sharedVirtualFs } from "./shared-fixture.ts";
import {
  scratchRoot as scratchRootRegistry,
  isScratchRootActive,
  releaseScratchRoot,
  getActiveScratchClaims,
  resetScratchRegistry,
  scratchVirtualFs,
} from "./scratch-root.ts";

describe("Shared Sandbox & Scratch Root Fixture", () => {
  it("creates valid scratch root directories with deterministic tags in sharedVirtualFs", () => {
    const root = scratchRoot("test-module", "my-label");
    expect(sharedVirtualFs.existsSync(root)).toBe(true);
    expect(root).toContain("test-module");
    expect(root).toContain("my-label");
  });

  it("creates sandbox directory via helper", () => {
    const box = createSandboxDir("box-label");
    expect(sharedVirtualFs.existsSync(box)).toBe(true);
  });

  it("creates and manages active claims in scratchRoot registry", () => {
    resetScratchRegistry();
    const root = scratchRootRegistry("registry-module", "claim-test");
    expect(scratchVirtualFs.existsSync(root)).toBe(true);
    expect(isScratchRootActive(root)).toBe(true);

    const claims = getActiveScratchClaims();
    expect(claims.length).toBeGreaterThanOrEqual(1);
    expect(claims.some((c) => c.root === root)).toBe(true);

    const released = releaseScratchRoot(root);
    expect(released).toBe(true);
    expect(isScratchRootActive(root)).toBe(false);

    resetScratchRegistry();
    expect(getActiveScratchClaims()).toHaveLength(0);
  });
});
