import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { GEN5_VERIFIED } from "../../../scripts/verify-gen5.ts";
import { GLOBAL_SYNC_GEN5 } from "../../../scripts/sync-global.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

function cloneRepoAtHead(label: string): string {
  const fixture = scratchRoot(import.meta.path, label);
  const clone = spawnSync("git", ["clone", "--local", "--quiet", REPO_ROOT, fixture], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
  if (clone.status !== 0) {
    throw new Error(`fixture clone of ${REPO_ROOT} into ${fixture} failed: ${clone.stderr}`);
  }
  return fixture;
}

describe("sync-global and verify-gen5", () => {
  test("GLOBAL_SYNC_GEN5 is true", () => {
    expect(GLOBAL_SYNC_GEN5).toBe(true);
  });

  test("GEN5_VERIFIED is true", () => {
    expect(GEN5_VERIFIED).toBe(true);
  });

  test("sync-global.ts runs cleanly as a standalone script against a clean HEAD fixture", () => {
    const fixtureRepo = cloneRepoAtHead("sync-global-fixture-repo");
    const fixtureHome = scratchRoot(import.meta.path, "sync-global-fixture-home");
    const scriptPath = join(REPO_ROOT, "scripts/sync-global.ts");

    const result = spawnSync("bun", [scriptPath], {
      encoding: "utf-8",
      cwd: fixtureRepo,
      env: { ...process.env, HOME: fixtureHome },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[sync] Deploying");
    expect(result.stdout).toContain("Global skill sync complete");
  });

  test("verify-gen5.ts runs cleanly as a standalone script", () => {
    const scriptPath = join(REPO_ROOT, "scripts/verify-gen5.ts");
    const result = spawnSync("bun", [scriptPath], {
      encoding: "utf-8",
      cwd: REPO_ROOT,
    });

    expect(result.status).toBe(0);
  });
});
