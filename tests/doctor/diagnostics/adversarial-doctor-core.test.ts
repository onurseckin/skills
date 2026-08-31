import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  compareSemver,
  mutateWriteScopeForCounterfactual,
  runAdversarialCounterfactualCheck,
} from "../../../olt/scripts/src/reporting/doctor/adversarial-doctor/index.ts";

export const adversarialDoctorCoreSuiteName = "Adversarial Doctor - Counterfactual Mutation & Falsification Engine";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe(adversarialDoctorCoreSuiteName, () => {
  describe("compareSemver", () => {
    test("correctly evaluates version comparisons", () => {
      expect(compareSemver("1.3.14", "1.3.0")).toBe(true);
      expect(compareSemver("1.3.0", "1.3.0")).toBe(true);
      expect(compareSemver("1.2.9", "1.3.0")).toBe(false);
      expect(compareSemver("2.0.0", "1.9.9")).toBe(true);
      expect(compareSemver("1.0.0", "2.0.0")).toBe(false);
    });
  });

  describe("mutateWriteScopeForCounterfactual", () => {
    test("throws INVALID_ARGUMENT on empty or non-existent file path", () => {
      expect(() => mutateWriteScopeForCounterfactual("")).toThrow(HarnessError);
      expect(() => mutateWriteScopeForCounterfactual("/non/existent/path/file.ts")).toThrow(
        HarnessError,
      );
    });

    test("applies syntax_error mutation and reverts cleanly", async () => {
      const dir = await mkdtemp(join(tmpdir(), "adv-mut-syntax-"));
      tempDirs.push(dir);
      const filePath = join(dir, "sample.ts");
      const original = 'export const greeting = "hello";\n';
      await writeFile(filePath, original, "utf-8");

      const { mutation, revert } = mutateWriteScopeForCounterfactual(filePath, {
        kind: "syntax_error",
      });

      expect(mutation.mutationKind).toBe("syntax_error");
      expect(mutation.filePath).toBe(filePath);
      expect(mutation.originalContent).toBe(original);
      expect(mutation.mutatedContent).toContain("INJECTED_ADVERSARIAL_SYNTAX_ERROR");

      const onDisk = await readFile(filePath, "utf-8");
      expect(onDisk).toBe(mutation.mutatedContent);

      revert();
      const revertedOnDisk = await readFile(filePath, "utf-8");
      expect(revertedOnDisk).toBe(original);
    });

    test("applies assertion_flip mutation and reverts cleanly", async () => {
      const dir = await mkdtemp(join(tmpdir(), "adv-mut-flip-"));
      tempDirs.push(dir);
      const filePath = join(dir, "test-sample.ts");
      const original = "expect(result).toBe(true);\nexpect(isValid).toBeTrue();\n";
      await writeFile(filePath, original, "utf-8");

      const { mutation, revert } = mutateWriteScopeForCounterfactual(filePath, {
        kind: "assertion_flip",
      });

      expect(mutation.mutationKind).toBe("assertion_flip");
      expect(mutation.mutatedContent).toContain("toBe(false)");
      expect(mutation.mutatedContent).toContain("toBeFalse()");

      revert();
      expect(await readFile(filePath, "utf-8")).toBe(original);
    });

    test("applies return_override, empty_file, and exception_injection mutations", async () => {
      const dir = await mkdtemp(join(tmpdir(), "adv-mut-types-"));
      tempDirs.push(dir);
      const filePath = join(dir, "target.ts");
      const original = "export function calculate(): number { return 42; }\n";
      await writeFile(filePath, original, "utf-8");

      // return_override
      const res1 = mutateWriteScopeForCounterfactual(filePath, { kind: "return_override" });
      expect(res1.mutation.mutatedContent).toContain("HARNESS_ADVERSARIAL_RETURN_OVERRIDE");
      res1.revert();

      // empty_file
      const res2 = mutateWriteScopeForCounterfactual(filePath, { kind: "empty_file" });
      expect(res2.mutation.mutatedContent).toBe("");
      res2.revert();

      // exception_injection
      const res3 = mutateWriteScopeForCounterfactual(filePath, { kind: "exception_injection" });
      expect(res3.mutation.mutatedContent).toContain("HARNESS_ADVERSARIAL_EXCEPTION");
      res3.revert();

      expect(await readFile(filePath, "utf-8")).toBe(original);
    });

    test("applies custom mutator and rejects custom without function", async () => {
      const dir = await mkdtemp(join(tmpdir(), "adv-mut-custom-"));
      tempDirs.push(dir);
      const filePath = join(dir, "custom.ts");
      const original = "const x = 10;\n";
      await writeFile(filePath, original, "utf-8");

      expect(() => mutateWriteScopeForCounterfactual(filePath, { kind: "custom" })).toThrow(
        HarnessError,
      );

      const res = mutateWriteScopeForCounterfactual(filePath, {
        kind: "custom",
        customMutator: (c) => c.replace("10", "999"),
      });
      expect(res.mutation.mutatedContent).toBe("const x = 999;\n");
      res.revert();
      expect(await readFile(filePath, "utf-8")).toBe(original);
    });
  });

  describe("runAdversarialCounterfactualCheck", () => {
    test("handles non-existent target path gracefully", async () => {
      const result = await runAdversarialCounterfactualCheck("/non/existent/target.ts");
      expect(result.passed).toBe(false);
      expect(result.baselinePassed).toBe(false);
      expect(result.falsified).toBe(false);
      expect(result.message).toContain("Target path does not exist");
    });

    test("passes when baseline succeeds and mutated test fails (falsifiable)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "adv-check-pass-"));
      tempDirs.push(dir);
      const filePath = join(dir, "valid.test.ts");
      const original = "export const ok = true;\n";
      await writeFile(filePath, original, "utf-8");

      const result = await runAdversarialCounterfactualCheck(filePath, {
        mutationKind: "syntax_error",
        testRunner: async (p) => {
          const content = await readFile(p, "utf-8");
          const hasSyntaxError = content.includes("INJECTED_ADVERSARIAL_SYNTAX_ERROR");
          return {
            success: !hasSyntaxError,
            output: hasSyntaxError ? "Syntax error detected" : "All tests passed",
            exitCode: hasSyntaxError ? 1 : 0,
          };
        },
      });

      expect(result.passed).toBe(true);
      expect(result.baselinePassed).toBe(true);
      expect(result.falsified).toBe(true);
      expect(result.mutation?.mutationKind).toBe("syntax_error");
      expect(await readFile(filePath, "utf-8")).toBe(original);
    });

    test("fails when mutated code still passes test runner (lacks falsifiability)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "adv-check-unfalsifiable-"));
      tempDirs.push(dir);
      const filePath = join(dir, "no-op.test.ts");
      const original = "export const val = 1;\n";
      await writeFile(filePath, original, "utf-8");

      const result = await runAdversarialCounterfactualCheck(filePath, {
        mutationKind: "syntax_error",
        testRunner: async () => ({ success: true, output: "Mock passed always", exitCode: 0 }),
      });

      expect(result.passed).toBe(false);
      expect(result.baselinePassed).toBe(true);
      expect(result.falsified).toBe(false);
      expect(result.message).toContain("gate is not falsifiable");
      expect(await readFile(filePath, "utf-8")).toBe(original);
    });

    test("fails when baseline is already failing before mutation", async () => {
      const dir = await mkdtemp(join(tmpdir(), "adv-check-baseline-fail-"));
      tempDirs.push(dir);
      const filePath = join(dir, "broken.test.ts");
      await writeFile(filePath, "broken content", "utf-8");

      const result = await runAdversarialCounterfactualCheck(filePath, {
        testRunner: async () => ({ success: false, output: "Pre-existing failure", exitCode: 1 }),
      });

      expect(result.passed).toBe(false);
      expect(result.baselinePassed).toBe(false);
      expect(result.falsified).toBe(false);
      expect(result.message).toContain("Baseline test failed before adversarial mutation");
    });
  });
});
