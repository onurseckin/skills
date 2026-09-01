import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  compareSemver,
  mutateWriteScopeForCounterfactual,
  runAdversarialCounterfactualCheck,
} from "../../../olt/scripts/src/reporting/doctor/adversarial-doctor/index.ts";

export const adversarialDoctorCoreSuiteName =
  "Adversarial Doctor - Counterfactual Mutation & Falsification Engine";

interface VirtualFile {
  content: string;
  isDir: boolean;
}

const vfs = new Map<string, VirtualFile>();
const spies: Array<{ mockRestore: () => void }> = [];

function setupVirtualFs(): void {
  vfs.clear();
  const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => vfs.has(String(p)));
  const statSpy = spyOn(fs, "statSync").mockImplementation((p) => {
    const file = vfs.get(String(p));
    if (!file) throw new Error(`ENOENT: no such file or directory, stat '${String(p)}'`);
    return {
      isFile: () => !file.isDir,
      isDirectory: () => file.isDir,
      isSymbolicLink: () => false,
      mode: 0o644,
      size: file.content.length,
      mtimeMs: Date.now(),
    } as fs.Stats;
  });
  const lstatSpy = spyOn(fs, "lstatSync").mockImplementation((p) => {
    const file = vfs.get(String(p));
    if (!file) throw new Error(`ENOENT: no such file or directory, lstat '${String(p)}'`);
    return {
      isFile: () => !file.isDir,
      isDirectory: () => file.isDir,
      isSymbolicLink: () => false,
      mode: 0o644,
      size: file.content.length,
      mtimeMs: Date.now(),
    } as fs.Stats;
  });
  const readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
    const file = vfs.get(String(p));
    if (!file) throw new Error(`ENOENT: no such file or directory, open '${String(p)}'`);
    return file.content;
  });
  const writeSpy = spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
    vfs.set(String(p), { content: String(data), isDir: false });
  });
  const realpathSpy = spyOn(fs, "realpathSync").mockImplementation((p) => String(p));

  spies.push(existsSpy, statSpy, lstatSpy, readSpy, writeSpy, realpathSpy);
}

afterEach(() => {
  for (const s of spies.splice(0)) {
    s.mockRestore();
  }
  vfs.clear();
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
      setupVirtualFs();
      expect(() => mutateWriteScopeForCounterfactual("")).toThrow(HarnessError);
      expect(() => mutateWriteScopeForCounterfactual("/non/existent/path/file.ts")).toThrow(
        HarnessError,
      );
    });

    test("applies syntax_error mutation and reverts cleanly", () => {
      setupVirtualFs();
      const filePath = "/virtual/workspace/sample.ts";
      const original = 'export const greeting = "hello";\n';
      vfs.set(filePath, { content: original, isDir: false });

      const { mutation, revert } = mutateWriteScopeForCounterfactual(filePath, {
        kind: "syntax_error",
        allowedRoots: ["/virtual/workspace"],
      });

      expect(mutation.mutationKind).toBe("syntax_error");
      expect(mutation.filePath).toBe(filePath);
      expect(mutation.originalContent).toBe(original);
      expect(mutation.mutatedContent).toContain("INJECTED_ADVERSARIAL_SYNTAX_ERROR");

      expect(vfs.get(filePath)?.content).toBe(mutation.mutatedContent);

      revert();
      expect(vfs.get(filePath)?.content).toBe(original);
    });

    test("applies assertion_flip mutation and reverts cleanly", () => {
      setupVirtualFs();
      const filePath = "/virtual/workspace/test-sample.ts";
      const original = "expect(result).toBe(true);\nexpect(isValid).toBeTrue();\n";
      vfs.set(filePath, { content: original, isDir: false });

      const { mutation, revert } = mutateWriteScopeForCounterfactual(filePath, {
        kind: "assertion_flip",
        allowedRoots: ["/virtual/workspace"],
      });

      expect(mutation.mutationKind).toBe("assertion_flip");
      expect(mutation.mutatedContent).toContain("toBe(false)");
      expect(mutation.mutatedContent).toContain("toBeFalse()");

      revert();
      expect(vfs.get(filePath)?.content).toBe(original);
    });

    test("applies return_override, empty_file, and exception_injection mutations", () => {
      setupVirtualFs();
      const filePath = "/virtual/workspace/target.ts";
      const original = "export function calculate(): number { return 42; }\n";
      vfs.set(filePath, { content: original, isDir: false });

      // return_override
      const res1 = mutateWriteScopeForCounterfactual(filePath, {
        kind: "return_override",
        allowedRoots: ["/virtual/workspace"],
      });
      expect(res1.mutation.mutatedContent).toContain("HARNESS_ADVERSARIAL_RETURN_OVERRIDE");
      res1.revert();

      // empty_file
      const res2 = mutateWriteScopeForCounterfactual(filePath, {
        kind: "empty_file",
        allowedRoots: ["/virtual/workspace"],
      });
      expect(res2.mutation.mutatedContent).toBe("");
      res2.revert();

      // exception_injection
      const res3 = mutateWriteScopeForCounterfactual(filePath, {
        kind: "exception_injection",
        allowedRoots: ["/virtual/workspace"],
      });
      expect(res3.mutation.mutatedContent).toContain("HARNESS_ADVERSARIAL_EXCEPTION");
      res3.revert();

      expect(vfs.get(filePath)?.content).toBe(original);
    });

    test("applies custom mutator and rejects custom without function", () => {
      setupVirtualFs();
      const filePath = "/virtual/workspace/custom.ts";
      const original = "const x = 10;\n";
      vfs.set(filePath, { content: original, isDir: false });

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
      expect(vfs.get(filePath)?.content).toBe(original);
    });
  });

  describe("runAdversarialCounterfactualCheck", () => {
    test("handles non-existent target path gracefully", async () => {
      setupVirtualFs();
      const result = await runAdversarialCounterfactualCheck("/non/existent/target.ts");
      expect(result.passed).toBe(false);
      expect(result.baselinePassed).toBe(false);
      expect(result.falsified).toBe(false);
      expect(result.message).toContain("Target path does not exist");
    });

    test("passes when baseline succeeds and mutated test fails (falsifiable)", async () => {
      setupVirtualFs();
      const filePath = "/virtual/workspace/valid.test.ts";
      const original = "export const ok = true;\n";
      vfs.set(filePath, { content: original, isDir: false });

      const result = await runAdversarialCounterfactualCheck(filePath, {
        mutationKind: "syntax_error",
        allowedRoots: ["/virtual/workspace"],
        testRunner: async (p) => {
          const content = vfs.get(p)?.content ?? "";
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
      expect(vfs.get(filePath)?.content).toBe(original);
    });

    test("fails when mutated code still passes test runner (lacks falsifiability)", async () => {
      setupVirtualFs();
      const filePath = "/virtual/workspace/no-op.test.ts";
      const original = "export const val = 1;\n";
      vfs.set(filePath, { content: original, isDir: false });

      const result = await runAdversarialCounterfactualCheck(filePath, {
        mutationKind: "syntax_error",
        allowedRoots: ["/virtual/workspace"],
        testRunner: async () => ({ success: true, output: "Mock passed always", exitCode: 0 }),
      });

      expect(result.passed).toBe(false);
      expect(result.baselinePassed).toBe(true);
      expect(result.falsified).toBe(false);
      expect(result.message).toContain("gate is not falsifiable");
      expect(vfs.get(filePath)?.content).toBe(original);
    });

    test("fails when baseline is already failing before mutation", async () => {
      setupVirtualFs();
      const filePath = "/virtual/workspace/broken.test.ts";
      vfs.set(filePath, { content: "broken content", isDir: false });

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
