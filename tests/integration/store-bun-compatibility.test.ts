import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../orchestrating-long-tasks/scripts/src/core/json.ts";
import { initRun } from "../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { checkManifest } from "../../orchestrating-long-tasks/scripts/src/store/manifest.ts";
import { verifyIntegrity } from "../../orchestrating-long-tasks/scripts/src/store/integrity.ts";
import { BUN_COMPATIBILITY } from "../../orchestrating-long-tasks/scripts/src/store/bun-compatibility.ts";

// The pure-function cases for compatibleBunVersion live in
// tests/unit/store/bun-compatibility.test.ts; this file exercises the real capsule/manifest
// enforcement path, which requires a real initRun() capsule on disk.

function run(): string {
  const root = mkdtempSync(join(tmpdir(), "bun-compat-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  return initRun(repo, "run", new TextEncoder().encode("prompt"), "file", true);
}

/** Rewrites manifest.json in place; the harness never mutates it after `plan:init`, so a test that
 * wants an incompatible manifest has to hand-edit one, exactly as a hand-edited manifest would look. */
function rewriteManifest(runRoot: string, patch: Record<string, unknown>): void {
  const path = join(runRoot, "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const next = { ...manifest, ...patch };
  for (const [key, value] of Object.entries(next)) if (value === undefined) delete next[key];
  writeFileSync(path, canonicalJsonBytes(next));
}

describe("manifest bun-compatibility enforcement", () => {
  test("plan:init records the running bun version under the harness's policy", () => {
    const root = run();
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as {
      bun_version: string;
      bun_compatibility: string;
    };
    expect(manifest.bun_version).toBe(Bun.version);
    expect(manifest.bun_compatibility).toBe(BUN_COMPATIBILITY);
    expect(checkManifest(root).issues).toEqual([]);
    expect(verifyIntegrity(root)).toEqual([]);
  });

  test("a capsule with no recorded policy is not held to one", () => {
    const root = run();
    rewriteManifest(root, { bun_compatibility: undefined, bun_version: "0.0.1" });
    expect(checkManifest(root).issues).toEqual([]);
  });

  test("flags a capsule created by an incompatible bun version", () => {
    const root = run();
    const [major] = Bun.version.split(".");
    rewriteManifest(root, { bun_version: `${Number(major) + 1}.0.0` });
    const { issues } = checkManifest(root);
    expect(issues.some((issue) => issue.code === "BUN_COMPATIBILITY")).toBe(true);
    expect(verifyIntegrity(root).some((issue) => issue.code === "BUN_COMPATIBILITY")).toBe(true);
  });

  test("flags a blank recorded bun version under a declared policy", () => {
    const root = run();
    rewriteManifest(root, { bun_version: "" });
    const { issues } = checkManifest(root);
    expect(issues.some((issue) => issue.code === "BUN_COMPATIBILITY")).toBe(true);
  });
});
