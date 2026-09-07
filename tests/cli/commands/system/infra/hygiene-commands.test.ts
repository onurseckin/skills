import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import {
  executeHygieneAudit,
  executeHygieneFix,
  hygieneAuditCommand,
  hygieneFixCommand,
} from "../../../../../olt/scripts/src/cli/commands/hygiene-ops.ts";
import * as hygieneModule from "../../../../../olt/scripts/src/health/hygiene/index.ts";
import {
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";

describe("Hygiene CLI Commands & JSON Contract Verification", () => {
  let vfs: ReturnType<typeof getVirtualCliFS>;
  let stdoutSpy: { mockRestore: () => void } | undefined;
  let scanSpy: { mockRestore: () => void } | undefined;
  let dirCounter = 0;

  function makeVirtualDir(name: string): string {
    const dir = `/virtual/cli/hygiene/${name}-${++dirCounter}`;
    vfs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  beforeEach(() => {
    setupVirtualCliFS();
    vfs = getVirtualCliFS();
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy?.mockRestore();
    scanSpy?.mockRestore();
    cleanupVirtualCliFS();
  });

  test("hygiene:audit passes on clean workspace and satisfies JSON contracts", () => {
    const dir = makeVirtualDir("hygiene-clean-contract");
    vfs.mkdirSync(join(dir, "scripts"), { recursive: true });

    const cleanRes = hygieneAuditCommand({ "repo-root": dir });

    expect(cleanRes.passed).toBeTrue();
    expect(typeof cleanRes.repoRoot).toBe("string");
    expect(typeof cleanRes.totalEntriesScanned).toBe("number");
    expect(Array.isArray(cleanRes.violations)).toBeTrue();
    expect((cleanRes.violations as unknown[]).length).toBe(0);
    expect(Array.isArray(cleanRes.quarantinedFiles)).toBeTrue();
    expect(typeof cleanRes.scanDurationMs).toBe("number");
  });

  test("hygiene:audit detects root-level unauthorized artifacts", () => {
    const dir = makeVirtualDir("hygiene-dirty-contract");
    vfs.mkdirSync(join(dir, "scripts"), { recursive: true });
    vfs.writeFileSync(join(dir, "untracked-script.sh"), "#!/bin/sh\necho dirty\n");

    const dirtyRes = hygieneAuditCommand({ "repo-root": dir });

    expect(dirtyRes.passed).toBeFalse();
    expect(Array.isArray(dirtyRes.violations)).toBeTrue();
    expect((dirtyRes.violations as unknown[]).length).toBe(1);
  });

  test("executeHygieneAudit returns 0 on clean or 1 on violations", async () => {
    scanSpy = spyOn(hygieneModule, "scanRootHygiene").mockReturnValue({
      passed: true,
      repoRoot: "/virtual/cli/hygiene/clean",
      totalEntriesScanned: 1,
      violations: [],
      quarantinedFiles: [],
      scanDurationMs: 1,
    });
    const exitCode = await executeHygieneAudit([]);
    expect([0, 1]).toContain(exitCode);
  });

  test("hygiene:fix moves loose artifacts to quarantine and reports totals", () => {
    const dir = makeVirtualDir("hygiene-fix-contract");
    vfs.mkdirSync(join(dir, "scripts"), { recursive: true });
    vfs.writeFileSync(join(dir, "temp-test.py"), "print('to be quarantined')\n");
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
    scanSpy = spyOn(hygieneModule, "scanRootHygiene").mockReturnValue({
      passed: true,
      repoRoot: "/virtual/cli/hygiene/clean",
      totalEntriesScanned: 1,
      violations: [],
      quarantinedFiles: [],
      scanDurationMs: 1,
    });
    const exitCode = await executeHygieneFix([]);
    expect(exitCode).toBe(0);
  });

  test("CLI execute integration dispatches hygiene commands", async () => {
    const dir = makeVirtualDir("hygiene-exec-contract");
    vfs.mkdirSync(join(dir, "scripts"), { recursive: true });

    const auditRes = await execute(["hygiene:audit", "--repo-root", dir]);
    expect(auditRes.passed).toBeTrue();
    expect(Array.isArray(auditRes.violations)).toBeTrue();

    vfs.writeFileSync(join(dir, "untracked-artifact.js"), "console.log('quarantine me');\n");

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
