import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { GEN5_VERIFIED } from "../../../scripts/verify-gen5.ts";
import { GLOBAL_SYNC_GEN5 } from "../../../scripts/sync-global.ts";

describe("sync-global and verify-gen5", () => {
  test("GLOBAL_SYNC_GEN5 is true", () => {
    expect(GLOBAL_SYNC_GEN5).toBe(true);
  });

  test("GEN5_VERIFIED is true", () => {
    expect(GEN5_VERIFIED).toBe(true);
  });

  test("sync-global.ts runs cleanly as a standalone script", () => {
    const scriptPath = join(process.cwd(), "scripts/sync-global.ts");
    const result = spawnSync("bun", [scriptPath], {
      encoding: "utf-8",
      cwd: process.cwd(),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[sync] Deploying");
    expect(result.stdout).toContain("Global skill sync complete");
  });

  test("verify-gen5.ts runs cleanly as a standalone script", () => {
    const scriptPath = join(process.cwd(), "scripts/verify-gen5.ts");
    const result = spawnSync("bun", [scriptPath], {
      encoding: "utf-8",
      cwd: process.cwd(),
    });

    expect(result.status).toBe(0);
  });
});
