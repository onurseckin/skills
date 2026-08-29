import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  hygieneAuditCommand,
  hygieneFixCommand,
} from "../../../olt/scripts/src/cli/commands/hygiene-ops.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Hygiene CLI commands", () => {
  test("hygiene:audit scans repository root and detects violations", () => {
    const dir = scratchRoot(import.meta.path, "hygiene-clean");
    mkdirSync(join(dir, "scripts"), { recursive: true });

    const cleanRes = hygieneAuditCommand({
      "repo-root": dir,
    });
    expect(cleanRes.passed).toBe(true);

    const dirtyDir = scratchRoot(import.meta.path, "hygiene-dirty");
    mkdirSync(join(dirtyDir, "scripts"), { recursive: true });
    writeFileSync(join(dirtyDir, "unapproved-root-script.sh"), "#!/bin/sh\n");

    const dirtyRes = hygieneAuditCommand({
      "repo-root": dirtyDir,
    });
    expect(dirtyRes.passed).toBe(false);
    expect(Array.isArray(dirtyRes.violations)).toBe(true);
    expect((dirtyRes.violations as unknown[]).length).toBe(1);
  });

  test("hygiene:fix quarantines offending loose files", () => {
    const dir = scratchRoot(import.meta.path, "hygiene-fix");
    mkdirSync(join(dir, "scripts"), { recursive: true });
    const targetFile = join(dir, "scratch-test.sh");
    writeFileSync(targetFile, "#!/bin/sh\nexit 0;\n");
    const qDir = join(dir, "quarantine");

    const fixRes = hygieneFixCommand({
      "repo-root": dir,
      "quarantine-dir": qDir,
    });

    expect(Array.isArray(fixRes.quarantinedFiles)).toBe(true);
    expect(fixRes.totalQuarantined as number).toBe(1);
  });

  test("CLI execute dispatches hygiene commands through registry", async () => {
    const dir = scratchRoot(import.meta.path, "hygiene-cli-exec");
    mkdirSync(join(dir, "scripts"), { recursive: true });

    const auditRes = await execute(["hygiene:audit", "--repo-root", dir]);
    expect(auditRes.passed).toBe(true);

    writeFileSync(join(dir, "temp_run.py"), "print('hello')\n");
    const fixRes = await execute([
      "hygiene:fix",
      "--repo-root",
      dir,
      "--quarantine-dir",
      join(dir, "quarantine_box"),
    ]);
    expect(fixRes.totalQuarantined).toBe(1);
  });
});
