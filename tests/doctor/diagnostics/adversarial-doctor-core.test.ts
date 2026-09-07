import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  compareSemver,
  mutateWriteScopeForCounterfactual,
  runAdversarialCounterfactualCheck,
} from "../../../olt/scripts/src/reporting/doctor/adversarial-doctor/index.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const adversarialDoctorCoreSuiteName =
  "Adversarial Doctor - Counterfactual Mutation & Falsification Engine";

describe(adversarialDoctorCoreSuiteName, () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

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

    test("applies syntax_error mutation and reverts cleanly", () => {
      const filePath = "/virtual/workspace/sample.ts";
      const original = 'export const greeting = "hello";\n';
      vfs.mkdirSync("/virtual/workspace", { recursive: true });
      vfs.writeFileSync(filePath, original);

      const { mutation, revert } = mutateWriteScopeForCounterfactual(filePath, {
        kind: "syntax_error",
        allowedRoots: ["/virtual/workspace"],
      });

      expect(mutation.mutationKind).toBe("syntax_error");
      expect(mutation.filePath).toBe(filePath);
      expect(mutation.originalContent).toBe(original);
      expect(mutation.mutatedContent).toContain("INJECTED_ADVERSARIAL_SYNTAX_ERROR");

      expect(vfs.readFileSync(filePath, "utf-8")).toBe(mutation.mutatedContent);

      revert();
      expect(vfs.readFileSync(filePath, "utf-8")).toBe(original);
    });

    test("applies assertion_flip mutation and reverts cleanly", () => {
      const filePath = "/virtual/workspace/test-sample.ts";
      const original = "expect(result).toBe(true);\nexpect(isValid).toBeTrue();\n";
      vfs.mkdirSync("/virtual/workspace", { recursive: true });
      vfs.writeFileSync(filePath, original);

      const { mutation, revert } = mutateWriteScopeForCounterfactual(filePath, {
        kind: "assertion_flip",
        allowedRoots: ["/virtual/workspace"],
      });

      expect(mutation.mutationKind).toBe("assertion_flip");
      expect(mutation.mutatedContent).toContain("toBe(false)");
      expect(mutation.mutatedContent).toContain("toBeFalse()");

      revert();
      expect(vfs.readFileSync(filePath, "utf-8")).toBe(original);
    });

    test("applies return_override, empty_file, and exception_injection mutations", () => {
      const filePath = "/virtual/workspace/target.ts";
      const original = "export function calculate(): number { return 42; }\n";
      vfs.mkdirSync("/virtual/workspace", { recursive: true });
      vfs.writeFileSync(filePath, original);

      const res1 = mutateWriteScopeForCounterfactual(filePath, {
        kind: "return_override",
        allowedRoots: ["/virtual/workspace"],
      });
      expect(res1.mutation.mutatedContent).toContain("HARNESS_ADVERSARIAL_RETURN_OVERRIDE");
      res1.revert();

      const res2 = mutateWriteScopeForCounterfactual(filePath, {
        kind: "empty_file",
        allowedRoots: ["/virtual/workspace"],
      });
      expect(res2.mutation.mutatedContent).toBe("");
      res2.revert();

      const res3 = mutateWriteScopeForCounterfactual(filePath, {
        kind: "exception_injection",
        allowedRoots: ["/virtual/workspace"],
      });
      expect(res3.mutation.mutatedContent).toContain("HARNESS_ADVERSARIAL_EXCEPTION");
      res3.revert();

      expect(vfs.readFileSync(filePath, "utf-8")).toBe(original);
    });

    test("applies custom mutator and rejects custom without function", () => {
      const filePath = "/virtual/workspace/custom.ts";
      const original = "const x = 10;\n";
      vfs.mkdirSync("/virtual/workspace", { recursive: true });
      vfs.writeFileSync(filePath, original);

      expect(() =>
        mutateWriteScopeForCounterfactual(filePath, {
          kind: "custom",
          allowedRoots: ["/virtual/workspace"],
        }),
      ).toThrow(HarnessError);

      const res = mutateWriteScopeForCounterfactual(filePath, {
        kind: "custom",
        customMutator: (c) => c.replace("10", "999"),
        allowedRoots: ["/virtual/workspace"],
      });
      expect(res.mutation.mutatedContent).toBe("const x = 999;\n");
      res.revert();
      expect(vfs.readFileSync(filePath, "utf-8")).toBe(original);
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
      const filePath = "/virtual/workspace/valid.test.ts";
      const original = "export const ok = true;\n";
      vfs.mkdirSync("/virtual/workspace", { recursive: true });
      vfs.writeFileSync(filePath, original);

      const result = await runAdversarialCounterfactualCheck(filePath, {
        mutationKind: "syntax_error",
        allowedRoots: ["/virtual/workspace"],
        testRunner: async (p) => {
          const content = vfs.existsSync(p) ? vfs.readFileSync(p, "utf-8") : "";
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
      expect(vfs.readFileSync(filePath, "utf-8")).toBe(original);
    });

    test("fails when mutated code still passes test runner (lacks falsifiability)", async () => {
      const filePath = "/virtual/workspace/no-op.test.ts";
      const original = "export const val = 1;\n";
      vfs.mkdirSync("/virtual/workspace", { recursive: true });
      vfs.writeFileSync(filePath, original);

      const result = await runAdversarialCounterfactualCheck(filePath, {
        mutationKind: "syntax_error",
        allowedRoots: ["/virtual/workspace"],
        testRunner: async () => ({ success: true, output: "Mock passed always", exitCode: 0 }),
      });

      expect(result.passed).toBe(false);
      expect(result.baselinePassed).toBe(true);
      expect(result.falsified).toBe(false);
      expect(result.message).toContain("gate is not falsifiable");
      expect(vfs.readFileSync(filePath, "utf-8")).toBe(original);
    });

    test("fails when baseline is already failing before mutation", async () => {
      const filePath = "/virtual/workspace/broken.test.ts";
      vfs.mkdirSync("/virtual/workspace", { recursive: true });
      vfs.writeFileSync(filePath, "broken content");

      const result = await runAdversarialCounterfactualCheck(filePath, {
        allowedRoots: ["/virtual/workspace"],
        testRunner: async () => ({ success: false, output: "Pre-existing failure", exitCode: 1 }),
      });

      expect(result.passed).toBe(false);
      expect(result.baselinePassed).toBe(false);
      expect(result.falsified).toBe(false);
      expect(result.message).toContain("Baseline test failed before adversarial mutation");
    });
  });
});
