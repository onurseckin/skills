import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { doctorCertifyCommand } from "../../../olt/scripts/src/reporting/doctor/certify-command.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { Flags } from "../../../olt/scripts/src/cli/options.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

function initTestCapsule(label: string, runId: string): { repo: string; runRoot: string } {
  const repo = scratchRoot(import.meta.path, label);
  const runRoot = initRun(repo, runId, new TextEncoder().encode("Prompt."), "file", true);
  return { repo, runRoot };
}

describe("doctor:certify command", () => {
  test("rejects a --write-scope path that is not a .test.ts or .spec.ts file, instead of silently skipping it", async () => {
    const { repo, runRoot } = initTestCapsule("reject-non-test", "certify-reject-run");
    const badPath = join(repo, "not-a-test.ts");
    writeFileSync(badPath, "export const x = 1;\n");

    await expect(
      doctorCertifyCommand({ run: runRoot, "write-scope": badPath } as unknown as Flags),
    ).rejects.toThrow(HarnessError);
  });

  test("runs the non-adversarial health diagnostics and certifies a clean, canonically-placed capsule with no --write-scope", async () => {
    const { runRoot } = initTestCapsule("no-write-scope", "certify-baseline-run");

    const report = await doctorCertifyCommand({ run: runRoot } as unknown as Flags);
    expect(report["adversarialChecks"]).toEqual([]);
    const healthChecks = report["healthChecks"] as readonly { status: string }[];
    expect(healthChecks.length).toBeGreaterThan(0);
    expect(healthChecks.every((check) => check.status === "pass")).toBe(true);
    expect(report["certified"]).toBe(true);
  });

  test("--strict throws when the capsule root is not under the canonical location", async () => {
    const repo = scratchRoot(import.meta.path, "strict-throws");
    const badRunRoot = join(repo, "nested", "not-a-capsule-run");

    await expect(
      doctorCertifyCommand({ run: badRunRoot, strict: true } as unknown as Flags),
    ).rejects.toThrow(HarnessError);
  });

  test("without --strict, an uncertified capsule root still returns a report rather than throwing", async () => {
    const repo = scratchRoot(import.meta.path, "non-strict-reports");
    const badRunRoot = join(repo, "nested", "not-a-capsule-run");

    const report = await doctorCertifyCommand({ run: badRunRoot } as unknown as Flags);
    expect(report["certified"]).toBe(false);
    expect(
      (report["criticalIssues"] as string[]).some((issue) => issue.includes("CAPSULE_ROOT")),
    ).toBe(true);
  });

  test("proves a trivially-passing test is falsifiable via a real counterfactual mutation round-trip", async () => {
    const { repo, runRoot } = initTestCapsule("adversarial-real", "certify-adversarial-run");
    const testFile = join(repo, "trivial.test.ts");
    writeFileSync(
      testFile,
      'import { test, expect } from "bun:test";\ntest("trivially true", () => {\n  expect(1 + 1).toBe(2);\n});\n',
    );

    const report = await doctorCertifyCommand({
      run: runRoot,
      "write-scope": testFile,
    } as unknown as Flags);

    const adversarialChecks = report["adversarialChecks"] as readonly {
      passed: boolean;
      falsified: boolean;
    }[];
    expect(adversarialChecks.length).toBe(1);
    expect(adversarialChecks[0]?.falsified).toBe(true);
    expect(adversarialChecks[0]?.passed).toBe(true);
  }, 20000);
});
