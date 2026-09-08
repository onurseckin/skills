import { describe, expect, it, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  checkTestInvariants,
  optimizeCheckTestsCommand,
} from "../../../../olt/scripts/src/cli/commands/optimize/check-tests.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";

describe("optimize:check-tests gate", () => {
  describe("checkTestInvariants - diff string evaluation", () => {
    it("fails with ASSERTION_DELETION_BREACH when deleting expect(result).toBe(true)", () => {
      const diff =
        "--- a/tests/foo.test.ts\n+++ b/tests/foo.test.ts\n@@ -1,2 +1,1 @@\n-expect(result).toBe(true);";
      expect(() => checkTestInvariants(diff)).toThrow(HarnessError);
      try {
        checkTestInvariants(diff);
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_STATE");
        expect(harnessErr.message).toContain("ASSERTION_DELETION_BREACH");
        expect(harnessErr.message).toContain("deleted assertion");
      }
    });

    it("fails with ASSERTION_DELETION_BREACH when commenting out an expect(...)", () => {
      const diff =
        "--- a/tests/foo.test.ts\n+++ b/tests/foo.test.ts\n@@ -1,2 +1,2 @@\n-expect(result).toBe(true);\n+// expect(result).toBe(true);";
      expect(() => checkTestInvariants(diff)).toThrow(HarnessError);
      try {
        checkTestInvariants(diff);
      } catch (err) {
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_STATE");
        expect(harnessErr.message).toContain("ASSERTION_DELETION_BREACH");
      }
    });

    it("fails with ASSERTION_DELETION_BREACH on block comment and JSDoc commented assertions", () => {
      const blockDiff =
        "--- a/tests/foo.test.ts\n+++ b/tests/foo.test.ts\n@@ -1,1 +1,2 @@\n+/* expect(result).toBe(true); */";
      expect(() => checkTestInvariants(blockDiff)).toThrow(/ASSERTION_DELETION_BREACH/);

      const jsdocDiff =
        "--- a/tests/foo.test.ts\n+++ b/tests/foo.test.ts\n@@ -1,1 +1,2 @@\n+ * expect(result).toBe(true);";
      expect(() => checkTestInvariants(jsdocDiff)).toThrow(/ASSERTION_DELETION_BREACH/);
    });

    it("fails with ASSERTION_DELETION_BREACH when deleting assert or assert.*", () => {
      const assertDiff =
        "--- a/tests/foo.test.ts\n+++ b/tests/foo.test.ts\n@@ -1,2 +1,1 @@\n-assert(condition === true);";
      expect(() => checkTestInvariants(assertDiff)).toThrow(/ASSERTION_DELETION_BREACH/);

      const assertDotDiff =
        "--- a/tests/foo.test.ts\n+++ b/tests/foo.test.ts\n@@ -1,2 +1,1 @@\n-assert.strictEqual(actual, expected);";
      expect(() => checkTestInvariants(assertDotDiff)).toThrow(/ASSERTION_DELETION_BREACH/);

      const assertOkDiff =
        "--- a/tests/foo.test.ts\n+++ b/tests/foo.test.ts\n@@ -1,2 +1,1 @@\n-assert.ok(isValid);";
      expect(() => checkTestInvariants(assertOkDiff)).toThrow(/ASSERTION_DELETION_BREACH/);
    });

    it("passes cleanly with unchanged assertions or additive assertions", () => {
      const diff =
        "--- a/tests/foo.test.ts\n+++ b/tests/foo.test.ts\n@@ -1,2 +1,3 @@\n expect(result).toBe(true);\n+expect(other).toBe(false);";
      const result = checkTestInvariants(diff);
      expect(result.ok).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.markdown).toContain("PASSED");
    });

    it("permits additive tests (*.spec.ts) and new files cleanly", () => {
      const newSpecDiff = `diff --git a/tests/extracted.spec.ts b/tests/extracted.spec.ts\nnew file mode 100644\n--- /dev/null\n+++ b/tests/extracted.spec.ts\n@@ -0,0 +1,5 @@\n+import { expect, test } from "bun:test";\n+test("extracted", () => {\n+  expect(calc()).toBe(42);\n+});`;
      const result = checkTestInvariants(newSpecDiff);
      expect(result.ok).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("does not flag deleting comments or deleting non-assertion code", () => {
      const benignDiff =
        "--- a/tests/foo.test.ts\n+++ b/tests/foo.test.ts\n@@ -1,3 +1,2 @@\n-// expect(result).toBe(true);\n-const unused = 42;\n+const used = 43;";
      const result = checkTestInvariants(benignDiff);
      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("ignores non-test files modified in git diff", () => {
      const srcDiff =
        "diff --git a/src/core/math.ts b/src/core/math.ts\n--- a/src/core/math.ts\n+++ b/src/core/math.ts\n@@ -1,2 +1,1 @@\n-assert(condition);";
      const result = checkTestInvariants(srcDiff);
      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("returns result object without throwing when throwOnBreach is false", () => {
      const diff = "- expect(result).toBe(true);";
      const result = checkTestInvariants({ diff, throwOnBreach: false });
      expect(result.ok).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.markdown).toContain("BREACH");
    });

    it("filters to specified target file", () => {
      const multiDiff =
        "diff --git a/tests/targeted.test.ts b/tests/targeted.test.ts\n--- a/tests/targeted.test.ts\n+++ b/tests/targeted.test.ts\n@@ -1,1 +1,2 @@\n+expect(a).toBe(1);\ndiff --git a/tests/other.test.ts b/tests/other.test.ts\n--- a/tests/other.test.ts\n+++ b/tests/other.test.ts\n@@ -1,2 +1,1 @@\n-expect(b).toBe(2);";
      const result = checkTestInvariants({
        diff: multiDiff,
        target: "tests/targeted.test.ts",
      });
      expect(result.ok).toBe(true);
      expect(result.filesChecked).toBe(1);
    });

    it("handles diff starting directly with +++ and raw non-prefixed diff text", () => {
      const plusOnlyDiff = "+++ b/tests/only-plus.test.ts\n+expect(1).toBe(1);";
      const res1 = checkTestInvariants(plusOnlyDiff);
      expect(res1.ok).toBe(true);

      const rawDiff = checkTestInvariants({
        diff: "plain unparsed line",
        filename: "tests/plain.test.ts",
      });
      expect(rawDiff.ok).toBe(true);
    });
  });

  describe("checkTestInvariants - pre/post and multi-file evaluation", () => {
    it("fails with ASSERTION_DELETION_BREACH when pre has assertion deleted in post", () => {
      const pre = 'test("calc", () => {\n  const result = 42;\n  expect(result).toBe(42);\n});';
      const post = 'test("calc", () => {\n  const result = 42;\n});';
      expect(() => checkTestInvariants({ pre, post, filename: "tests/unit/calc.test.ts" })).toThrow(
        HarnessError,
      );
    });

    it("fails with ASSERTION_DELETION_BREACH when post comments out an assertion", () => {
      const pre = "expect(result).toBe(true);";
      const post = "// expect(result).toBe(true);";
      expect(() => checkTestInvariants({ pre, post, filename: "tests/unit/calc.test.ts" })).toThrow(
        /ASSERTION_DELETION_BREACH/,
      );
    });

    it("passes cleanly when pre and post are identical or additive", () => {
      const pre = "expect(result).toBe(true);";
      const post = "expect(result).toBe(true);\nexpect(other).toBe(false);";
      const result = checkTestInvariants({ pre, post, filename: "tests/unit/calc.test.ts" });
      expect(result.ok).toBe(true);
      expect(result.passed).toBe(true);

      const exact = checkTestInvariants({
        pre: "expect(1).toBe(1);",
        post: "expect(1).toBe(1);",
      });
      expect(exact.ok).toBe(true);
    });

    it("checks multi-file input and catches violations in any file", () => {
      const filesInput = {
        files: [
          { filename: "tests/good.test.ts", pre: "expect(1).toBe(1);", post: "expect(1).toBe(1);" },
          { filename: "tests/bad.test.ts", diff: "- expect(2).toBe(2);" },
        ],
      };
      expect(() => checkTestInvariants(filesInput)).toThrow(/ASSERTION_DELETION_BREACH/);
    });

    it("handles pre/post in files array cleanly when all pass", () => {
      const filesInput = {
        files: [
          { filename: "tests/a.test.ts", pre: "expect(1).toBe(1);", post: "expect(1).toBe(1);" },
          { filename: "tests/b.test.ts", pre: "", post: "expect(2).toBe(2);" },
        ],
      };
      const result = checkTestInvariants(filesInput);
      expect(result.ok).toBe(true);
      expect(result.passed).toBe(true);
    });
  });

  describe("optimizeCheckTestsCommand", () => {
    it("throws HarnessError on unknown flag", async () => {
      await expect(optimizeCheckTestsCommand({ unknown: "flag" })).rejects.toThrow(HarnessError);
    });

    it("evaluates inline diff flag and passes when no assertions deleted", async () => {
      const res = await optimizeCheckTestsCommand({
        diff: "+ expect(result).toBe(true);",
        json: true,
      });
      expect(res.ok).toBe(true);
      expect(res.passed).toBe(true);
      expect(res.command).toBe("optimize:check-tests");
      expect(res.json).toBe(true);
    });

    it("evaluates inline diff flag and throws on deleted assertion", async () => {
      await expect(
        optimizeCheckTestsCommand({ diff: "- expect(result).toBe(true);" }),
      ).rejects.toThrow(HarnessError);
    });

    it("reads diff file from disk when diff flag points to existing file", async () => {
      const vfs = new VirtualMemoryFS();
      const session = createVirtualFSSession(vfs);
      try {
        vfs.mkdirSync("/virtual/path", { recursive: true });
        vfs.writeFileSync("/virtual/path/test.diff", "+ expect(mocked).toBe(1);");
        const res = await optimizeCheckTestsCommand({ diff: "/virtual/path/test.diff" });
        expect(res.ok).toBe(true);
        expect(res.passed).toBe(true);
      } finally {
        session.cleanup();
      }
    });

    it("uses context gitRunner mock when provided", async () => {
      const mockRunner = (args: readonly string[]) => {
        expect(args).toContain("diff");
        expect(args).toContain("HEAD");
        return "+ expect(mockedGit).toBe(true);";
      };

      const res = await optimizeCheckTestsCommand({}, { gitRunner: mockRunner });
      expect(res.ok).toBe(true);
      expect(res.passed).toBe(true);
    });

    it("fails with gitRunner mock when diff has deleted assertions", async () => {
      const mockRunner = () => "- expect(deleted).toBe(true);";
      await expect(optimizeCheckTestsCommand({}, { gitRunner: mockRunner })).rejects.toThrow(
        /ASSERTION_DELETION_BREACH/,
      );
    });

    it("spawns git diff when no diff flag and no context runner provided", async () => {
      const spawnSpy = spyOn(childProcess, "spawnSync").mockReturnValue({
        stdout: "+ expect(gitSpawn).toBe(true);",
        stderr: "",
        status: 0,
        pid: 1234,
        output: [],
        signal: null,
      });

      const res = await optimizeCheckTestsCommand({ base: "main", target: "tests/unit" });
      expect(res.ok).toBe(true);
      expect(res.base).toBe("main");
      expect(res.target).toBe("tests/unit");

      spawnSpy.mockRestore();
    });

    it("throws HarnessError when git process returns non-zero status", async () => {
      const spawnSpy = spyOn(childProcess, "spawnSync").mockReturnValue({
        stdout: "",
        stderr: "fatal: bad revision 'bad-base'",
        status: 128,
        pid: 1234,
        output: [],
        signal: null,
      });

      await expect(optimizeCheckTestsCommand({ base: "bad-base" })).rejects.toThrow(HarnessError);
      spawnSpy.mockRestore();
    });

    it("throws HarnessError when spawnSync encounters error", async () => {
      const spawnSpy = spyOn(childProcess, "spawnSync").mockReturnValue({
        stdout: "",
        stderr: "",
        status: null,
        error: new Error("spawn ENOENT"),
        pid: 1234,
        output: [],
        signal: null,
      });

      await expect(optimizeCheckTestsCommand({})).rejects.toThrow(HarnessError);
      spawnSpy.mockRestore();
    });
  });
});
