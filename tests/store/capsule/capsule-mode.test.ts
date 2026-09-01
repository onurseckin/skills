import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { assertMindModeAllowed } from "../../../olt/scripts/src/mind/tasks/smart/index.ts";
import { scratchRoot as makeScratchRoot } from "../store-fixture.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

describe("Capsule Mode Partitioning", () => {
  it("should initialize a feature capsule by default", () => {
    const root = scratchRoot("feature-default");
    const runId = "test-feature";
    const prompt = new Uint8Array();
    const runRoot = initRun(root, runId, prompt, "file", true);

    const manifestPath = join(runRoot, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

    expect(manifest.mode).toBe("feature");

    const statePath = join(runRoot, "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(state.mind).toBeUndefined();
  });

  it("should initialize a mind capsule when mode is 'mind'", () => {
    const root = scratchRoot("mind-mode");
    const runId = "test-mind";
    const prompt = new Uint8Array();
    const runRoot = initRun(root, runId, prompt, "file", true, { mode: "mind" });

    const manifestPath = join(runRoot, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

    expect(manifest.mode).toBe("mind");
  });

  it("should assert mind mode correctly", () => {
    const root = scratchRoot("assert-mind");
    const runIdFeature = "test-feature";
    const prompt = new Uint8Array();
    const runRootFeature = initRun(root, runIdFeature, prompt, "file", true);

    expect(() => assertMindModeAllowed(runRootFeature, "mind:init")).toThrowError(
      /exclusive to Tier 0 Mind capsules/,
    );

    const runIdMind = "test-mind";
    const runRootMind = initRun(root, runIdMind, prompt, "file", true, { mode: "mind" });

    // Should not throw
    assertMindModeAllowed(runRootMind, "mind:init");
  });
});
