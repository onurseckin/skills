import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import {
  executeHygieneAudit,
  executeHygieneFix,
  hygieneAuditCommand,
  hygieneFixCommand,
} from "../../../../../olt/scripts/src/cli/commands/hygiene-ops.ts";
import { scratchRoot } from "../../../../shared/fixtures/scratch-root.ts";

describe("Hygiene CLI Commands & JSON Contract Verification", () => {
  test("hygiene:audit passes on clean workspace and satisfies JSON contracts", () => {
    const dir = scratchRoot(import.meta.path, "hygiene-clean-contract");
    mkdirSync(join(dir, "scripts"), { recursive: true });

    const cleanRes = hygieneAuditCommand({
      "repo-root": dir,
    });

    expect(cleanRes.passed).toBeTrue();
    expect(typeof cleanRes.repoRoot).toBe("string");
    expect(typeof cleanRes.totalEntriesScanned).toBe("number");
    expect(Array.isArray(cleanRes.violations)).toBeTrue();
    expect((cleanRes.violations as unknown[]).length).toBe(0);
    expect(Array.isArray(cleanRes.quarantinedFiles)).toBeTrue();
    expect(typeof cleanRes.scanDurationMs).toBe("number");
  });

  test("hygiene:audit detects root-level unauthorized artifacts", () => {
    const dir = scratchRoot(import.meta.path, "hygiene-dirty-contract");
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "untracked-script.sh"), "#!/bin/sh\necho dirty\n");

    const dirtyRes = hygieneAuditCommand({
      "repo-root": dir,
    });

    expect(dirtyRes.passed).toBeFalse();
    expect(Array.isArray(dirtyRes.violations)).toBeTrue();
    expect((dirtyRes.violations as unknown[]).length).toBe(1);
  });

  test("executeHygieneAudit returns 0 on clean or 1 on violations", async () => {
    const exitCode = await executeHygieneAudit([]);
    expect([0, 1]).toContain(exitCode);
  });

  test("hygiene:fix moves loose artifacts to quarantine and reports totals", () => {
    const dir = scratchRoot(import.meta.path, "hygiene-fix-contract");
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "temp-test.py"), "print('to be quarantined')\n");
    const qDir = join(dir, "quarantine_target");

    const fixRes = hygieneFixCommand({
      "repo-root": dir,
      "quarantine-dir": qDir,
    });

    expect(Array.isArray(fixRes.violations)).toBeTrue();
    expect(Array.isArray(fixRes.quarantinedFiles)).toBeTrue();
    expect(typeof fixRes.totalQuarantined).toBe("number");
    expect(fixRes.totalQuarantined).toBe(1);

    const firstQuarantine = (
      fixRes.quarantinedFiles as Array<{ originalPath: string; quarantinePath: string }>
    )[0];
    expect(firstQuarantine).toBeDefined();
    expect(firstQuarantine?.originalPath).toContain("temp-test.py");
  });

  test("executeHygieneFix returns exit code 0", async () => {
    const exitCode = await executeHygieneFix([]);
    expect(exitCode).toBe(0);
  });

  test("CLI execute integration dispatches hygiene commands", async () => {
    const dir = scratchRoot(import.meta.path, "hygiene-exec-contract");
    mkdirSync(join(dir, "scripts"), { recursive: true });

    const auditRes = await execute(["hygiene:audit", "--repo-root", dir]);
    expect(auditRes.passed).toBeTrue();
    expect(Array.isArray(auditRes.violations)).toBeTrue();

    writeFileSync(join(dir, "untracked-artifact.js"), "console.log('quarantine me');\n");

    const fixRes = await execute([
      "hygiene:fix",
      "--repo-root",
      dir,
      "--quarantine-dir",
      join(dir, "isolated_quarantine"),
    ]);

    expect(fixRes.totalQuarantined).toBe(1);
    expect(Array.isArray(fixRes.quarantinedFiles)).toBeTrue();
  });
});
