import { describe, expect, it } from "bun:test";
import { scratchRoot, createSandboxDir } from "./shared-fixture.ts";
import { existsSync } from "node:fs";

describe("Shared Sandbox & Scratch Root Fixture", () => {
  it("creates valid scratch root directories with deterministic tags", () => {
    const root = scratchRoot("test-module", "my-label");
    expect(existsSync(root)).toBe(true);
    expect(root).toContain("test-module");
    expect(root).toContain("my-label");
  });

  it("creates sandbox directory via helper", () => {
    const box = createSandboxDir("box-label");
    expect(existsSync(box)).toBe(true);
  });
});
