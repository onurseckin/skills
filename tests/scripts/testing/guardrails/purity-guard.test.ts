/**
 * @file purity-guard.test.ts
 * Unit tests for Test Purity Guardrail system.
 * 100% in-memory AST verification without physical disk writes.
 */

import { describe, expect, it } from "bun:test";
import {
  auditSourceCode,
  auditTestPuritySync,
  buildAuditResult,
  describeVacuity,
  formatMarkdownReport,
  formatTerminalReport,
  resolveAuditRequest,
  type PurityViolation,
} from "../../../../scripts/testing/guardrails/index.ts";

describe("Test Purity Guardrail - Clean In-Memory Patterns", () => {
  it("allows clean in-memory tests with VirtualMemoryFS without violations", () => {
    const code = `
      import { describe, expect, it } from "bun:test";
      import { VirtualMemoryFS } from "../../olt/scripts/src/testing/virtual-fs/index.ts";

      describe("pure test", () => {
        it("operates in memory", () => {
          const vfs = new VirtualMemoryFS();
          vfs.writeFileSync("/data.txt", "hello pure test");
          vfs.mkdirSync("/sub", { recursive: true });
          const content = vfs.readFileSync("/data.txt", "utf-8");
          expect(content).toBe("hello pure test");
        });
      });
    `;
    const violations = auditSourceCode(code, "tests/clean-vfs.test.ts");
    expect(violations).toHaveLength(0);
  });

  it("allows type-only imports from node:fs", () => {
    const code = `
      import type { Stats } from "node:fs";
      import { type BufferEncoding } from "fs";
      import { describe, expect, it } from "bun:test";

      it("type-only import", () => {
        const val: number = 42;
        expect(val).toBeGreaterThan(40);
      });
    `;
    const violations = auditSourceCode(code, "tests/clean-types.test.ts");
    expect(violations).toHaveLength(0);
  });

  it("allows synthetic in-memory AST parsing in tests", () => {
    const code = `
      import ts from "typescript";
      import { it, expect } from "bun:test";

      it("synthetic AST parser test", () => {
        const sf = ts.createSourceFile("inline.ts", "const a = 10;", ts.ScriptTarget.Latest, true);
        expect(sf.statements.length).toBeGreaterThan(0);
      });
    `;
    const violations = auditSourceCode(code, "tests/clean-ast.test.ts");
    expect(violations).toHaveLength(0);
  });

  it("allows child_process spy setups with in-memory mocks", () => {
    const code = `
      import { spyOn, it, expect } from "bun:test";
      import * as childProcess from "node:child_process";

      it("mocks spawnSync", () => {
        const spy = spyOn(childProcess, "spawnSync").mockReturnValue({ status: 0 } as never);
        expect(spy).toBeDefined();
      });
    `;
    const violations = auditSourceCode(code, "tests/clean-cp-spy.test.ts");
    expect(violations).toHaveLength(0);
  });
});

describe("Test Purity Guardrail - Filesystem Violations", () => {
  it("flags real filesystem imports and unmocked calls", () => {
    const code = `
      import * as fs from "node:fs";
      import { writeFileSync, mkdirSync, rmSync } from "fs";

      test("real fs test", () => {
        fs.writeFileSync("output.txt", "data");
        writeFileSync("foo.txt", "bar");
        mkdirSync("temp");
        rmSync("temp", { recursive: true });
      });
    `;
    const violations = auditSourceCode(code, "tests/dirty-fs.test.ts");
    expect(violations.length).toBeGreaterThanOrEqual(4);
    expect(violations.some((v) => v.rule === "no-physical-fs-import")).toBe(true);
    expect(violations.some((v) => v.rule === "no-physical-fs-method")).toBe(true);
    expect(violations.some((v) => v.rule === "no-physical-fs-call")).toBe(true);
  });

  it("flags os.tmpdir imports and calls", () => {
    const code = `
      import { tmpdir } from "node:os";
      import os from "os";

      test("tmpdir test", () => {
        const t1 = tmpdir();
        const t2 = os.tmpdir();
      });
    `;
    const violations = auditSourceCode(code, "tests/dirty-tmpdir.test.ts");
    expect(violations.some((v) => v.rule === "no-physical-tmpdir-import")).toBe(true);
    expect(violations.some((v) => v.rule === "no-physical-tmpdir-call")).toBe(true);
  });
});

describe("Test Purity Guardrail - Subprocess Violations", () => {
  it("flags unmocked child_process invocations", () => {
    const code = `
      import { execSync, spawnSync } from "node:child_process";
      import cp from "child_process";

      test("subprocess test", () => {
        execSync("git status");
        cp.spawnSync("echo", ["hello"]);
      });
    `;
    const violations = auditSourceCode(code, "tests/dirty-subprocess.test.ts");
    expect(violations.some((v) => v.rule === "no-unmocked-subprocess-call")).toBe(true);
    expect(violations.some((v) => v.rule === "no-unmocked-child-process")).toBe(true);
  });

  it("flags Bun.spawn and Bun.$ subprocess primitives", () => {
    const code = `
      test("bun primitives", () => {
        Bun.spawn(["git", "diff"]);
        Bun.spawnSync(["ls"]);
        Bun.$\`echo hi\`;
      });
    `;
    const violations = auditSourceCode(code, "tests/dirty-bun.test.ts");
    expect(violations.some((v) => v.rule === "no-unmocked-bun-spawn")).toBe(true);
    expect(violations.some((v) => v.rule === "no-unmocked-bun-shell")).toBe(true);
  });
});

describe("Test Purity Guardrail - Static AST Scan Violations", () => {
  it("flags static AST scans targeting repository source files", () => {
    const code = `
      import ts from "typescript";

      test("repo scan", () => {
        ts.createSourceFile("src/core/builder.ts", "content", ts.ScriptTarget.Latest);
      });
    `;
    const violations = auditSourceCode(code, "tests/dirty-ast.test.ts");
    expect(violations.some((v) => v.rule === "no-repo-ast-scan")).toBe(true);
  });

  it("flags heavyweight AST methods in tests", () => {
    const code = `
      import ts from "typescript";

      test("heavyweight AST", () => {
        ts.createProgram(["src/index.ts"], {});
      });
    `;
    const violations = auditSourceCode(code, "tests/dirty-heavy-ast.test.ts");
    expect(violations.some((v) => v.rule === "no-heavyweight-ast-in-tests")).toBe(true);
  });
});

describe("Test Purity Guardrail - Anti-Pattern Violations", () => {
  it("flags empty test bodies", () => {
    const code = `
      test("empty test body", () => {});
      it("empty it body", async () => {});
    `;
    const violations = auditSourceCode(code, "tests/empty-body.test.ts");
    expect(violations.filter((v) => v.rule === "no-empty-test-body").length).toBe(2);
  });

  it("flags trivial constant assertions", () => {
    const code = `
      test("trivial assertions", () => {
        expect(1).toBe(1);
        expect(true).toBe(true);
        expect("hello").toEqual("hello");
      });
    `;
    const violations = auditSourceCode(code, "tests/trivial-assert.test.ts");
    expect(violations.filter((v) => v.rule === "no-trivial-assertion").length).toBe(3);
  });

  it("flags mock tautology assertions", () => {
    const code = `
      import { mock, test, expect } from "bun:test";

      test("mock tautology", () => {
        const getVal = mock(() => 42);
        expect(getVal()).toBe(42);
      });
    `;
    const violations = auditSourceCode(code, "tests/mock-tautology.test.ts");
    expect(violations.some((v) => v.rule === "no-mock-tautology")).toBe(true);
  });
});

describe("Test Purity Guardrail - Reporting & Results", () => {
  it("builds passing audit result with clean reports", () => {
    const result = buildAuditResult(5, []);
    expect(result.passed).toBe(true);
    expect(result.scannedFiles).toBe(5);
    expect(result.violations).toHaveLength(0);
    expect(result.terminalReport).toContain("✓ All 5 test file(s) passed purity audit");
    expect(result.markdownReport).toContain("- **Status**: PASSED");
  });

  it("builds failing audit result with formatted violations", () => {
    const mockViolations: PurityViolation[] = [
      {
        file: "tests/example.test.ts",
        line: 12,
        column: 5,
        category: "filesystem",
        rule: "no-physical-fs-call",
        message: "Prohibited physical filesystem call writeFileSync().",
        snippet: 'writeFileSync("test.txt", "data")',
      },
    ];
    const result = buildAuditResult(1, mockViolations);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.terminalReport).toContain("❌ Test purity audit FAILED");
    expect(result.terminalReport).toContain("tests/example.test.ts:12:5");
    expect(result.markdownReport).toContain("| `tests/example.test.ts` | 12:5 | `filesystem` |");
  });
});

describe("Test Purity Guardrail - Argument Normalisation", () => {
  it("resolves the bare array and the files option to the same explicit request", () => {
    const paths = ["tests/alpha.test.ts", "tests/beta.test.ts"];
    const fromArray = resolveAuditRequest(paths);
    const fromOptions = resolveAuditRequest({ files: paths });
    expect(fromArray).toEqual(fromOptions);
    expect(fromArray.scope).toBe("explicit");
    expect(fromArray.files).toEqual(paths);
  });

  it("treats an explicitly empty list as an explicit request for nothing in both shapes", () => {
    const fromArray = resolveAuditRequest([]);
    const fromOptions = resolveAuditRequest({ files: [] });
    expect(fromArray).toEqual(fromOptions);
    expect(fromArray.scope).toBe("explicit");
    expect(fromArray.files).toHaveLength(0);
  });

  it("routes an absent argument to the repository scope rather than to an empty scan", () => {
    const request = resolveAuditRequest();
    expect(request.scope).toBe("repository");
    expect(request.files.length).toBeGreaterThan(0);
  });

  it("routes the all option to the repository scope", () => {
    const request = resolveAuditRequest({ all: true });
    expect(request.scope).toBe("repository");
    expect(request.files.length).toBeGreaterThan(0);
  });

  it("routes stagedOnly to the staged scope without falling back to the repository", () => {
    const request = resolveAuditRequest({ stagedOnly: true });
    expect(request.scope).toBe("staged");
  });

  it("does not let an explicit empty list silently borrow the repository scope", () => {
    const explicitEmpty = resolveAuditRequest({ files: [] });
    const repository = resolveAuditRequest();
    expect(explicitEmpty.scope).not.toBe(repository.scope);
    expect(explicitEmpty.files.length).toBeLessThan(repository.files.length);
  });
});

describe("Test Purity Guardrail - Vacuity Detection", () => {
  it("reports an explicitly empty request as vacuous", () => {
    const reason = describeVacuity("explicit", 0, 0);
    expect(reason).toBeDefined();
    expect(reason).toContain("explicitly empty");
  });

  it("reports explicitly requested files that were never read as vacuous", () => {
    const reason = describeVacuity("explicit", 3, 1);
    expect(reason).toBeDefined();
    expect(reason).toContain("2 of 3");
  });

  it("does not call a fully honoured explicit request vacuous", () => {
    expect(describeVacuity("explicit", 4, 4)).toBeUndefined();
  });

  it("never calls a discovery scope vacuous when discovery legitimately finds nothing", () => {
    expect(describeVacuity("staged", 0, 0)).toBeUndefined();
    expect(describeVacuity("repository", 0, 0)).toBeUndefined();
  });

  it("refuses to mark a vacuous explicit audit as passed", () => {
    const result = buildAuditResult(0, [], "explicit", 0);
    expect(result.passed).toBe(false);
    expect(result.vacuous).toBe(true);
    expect(result.terminalReport).toContain("VACUOUS");
    expect(result.markdownReport).toContain("- **Status**: VACUOUS");
  });

  it("still passes a discovery scope that found no files to audit", () => {
    const result = buildAuditResult(0, [], "staged", 0);
    expect(result.passed).toBe(true);
    expect(result.vacuous).toBe(false);
  });

  it("carries the requested and scanned counts so callers can detect an empty audit", () => {
    const result = buildAuditResult(2, [], "explicit", 5);
    expect(result.requestedFiles).toBe(5);
    expect(result.scannedFiles).toBe(2);
    expect(result.passed).toBe(false);
  });
});

describe("Test Purity Guardrail - Empty List Fail-Open Regression", () => {
  it("returns an identical result for an empty array and an empty files option", () => {
    const fromArray = auditTestPuritySync([]);
    const fromOptions = auditTestPuritySync({ files: [] });
    expect(fromArray).toEqual(fromOptions);
  });

  it("never reports a green audit for an empty array argument", () => {
    const result = auditTestPuritySync([]);
    expect(result.passed).toBe(false);
    expect(result.vacuous).toBe(true);
    expect(result.scannedFiles).toBe(0);
    expect(result.requestedFiles).toBe(0);
  });

  it("never reports a green audit for an empty files option", () => {
    const result = auditTestPuritySync({ files: [] });
    expect(result.passed).toBe(false);
    expect(result.vacuous).toBe(true);
    expect(result.scannedFiles).toBe(0);
  });

  it("fails rather than passing when every explicitly requested file is unreadable", () => {
    const result = auditTestPuritySync(["tests/__absent__/never-created.test.ts"]);
    expect(result.passed).toBe(false);
    expect(result.vacuous).toBe(true);
    expect(result.requestedFiles).toBe(1);
    expect(result.scannedFiles).toBe(0);
  });
});
