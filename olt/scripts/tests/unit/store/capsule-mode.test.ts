import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { readFileSync, rmSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { initRun } from "../../../src/store/capsule";
import { assertMindModeAllowed } from "../../../src/mind/smart-task-manager";
import { resolveCapsulesDir } from "../../../src/shared/paths";

describe("Capsule Mode Partitioning", () => {
  const getTempDir = () => mkdtempSync(join(tmpdir(), "capsule-mode-test-"));

  it("should initialize a feature capsule by default", () => {
    const root = getTempDir();
    const runId = "test-feature";
    const prompt = new Uint8Array();
    const runRoot = initRun(root, runId, prompt, "file", true);

    const manifestPath = join(runRoot, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

    expect(manifest.mode).toBe("feature");

    const statePath = join(runRoot, "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(state.mind).toBeUndefined();

    rmSync(root, { recursive: true, force: true });
  });

  it("should initialize a mind capsule when mode is 'mind'", () => {
    const root = getTempDir();
    const runId = "test-mind";
    const prompt = new Uint8Array();
    const runRoot = initRun(root, runId, prompt, "file", true, { mode: "mind" });

    const manifestPath = join(runRoot, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

    expect(manifest.mode).toBe("mind");

    rmSync(root, { recursive: true, force: true });
  });

  it("should assert mind mode correctly", () => {
    const root = getTempDir();
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

    rmSync(root, { recursive: true, force: true });
  });
});
