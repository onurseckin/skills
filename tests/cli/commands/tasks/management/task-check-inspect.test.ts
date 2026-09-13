import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  collectSourceFilesRecursively,
  findNearestTsconfig,
  formatTaskCheckMarkdown,
  formatTaskInspectMarkdown,
  isSupportedSourceFile,
  performAstLintCheck,
  performIncrementalTypecheck,
  projectTaskInspection,
  taskCheckCommand,
  taskInspectCommand,
  SUPPORTED_EXTENSIONS,
  type TaskCheckSummary,
} from "../../../../../olt/scripts/src/cli/commands/task-check.ts";
import { type VirtualMemoryFS } from "../../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { initRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
let vfs: VirtualMemoryFS;

function createVirtualDir(prefix: string): string {
  const dir = `/virtual/cli/${prefix}-${Math.random().toString(36).slice(2)}`;
  roots.push(dir);
  vfs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("task:check - File Inspection & AST Linting", () => {
  beforeEach(() => {
    vfs = setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("isSupportedSourceFile identifies valid extensions", () => {
    expect(SUPPORTED_EXTENSIONS.length).toBeGreaterThan(0);
    expect(isSupportedSourceFile("test.ts")).toBe(true);
    expect(isSupportedSourceFile("test.tsx")).toBe(true);
    expect(isSupportedSourceFile("test.mts")).toBe(true);
    expect(isSupportedSourceFile("test.cts")).toBe(true);
    expect(isSupportedSourceFile("test.js")).toBe(true);
    expect(isSupportedSourceFile("test.jsx")).toBe(true);
    expect(isSupportedSourceFile("test.mjs")).toBe(true);
    expect(isSupportedSourceFile("test.cjs")).toBe(true);
    expect(isSupportedSourceFile("test.json")).toBe(false);
    expect(isSupportedSourceFile("test.md")).toBe(false);
    expect(isSupportedSourceFile("test.py")).toBe(false);
  });

  test("collectSourceFilesRecursively collects nested files", () => {
    const root = createVirtualDir("task-check-collect");

    vfs.mkdirSync(join(root, "src", "nested"), { recursive: true });
    vfs.mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    vfs.mkdirSync(join(root, ".git"), { recursive: true });

    vfs.writeFileSync(join(root, "src", "index.ts"), "export const a = 1;");
    vfs.writeFileSync(join(root, "src", "nested", "util.tsx"), "export const b = 2;");
    vfs.writeFileSync(join(root, "src", "readme.md"), "# Readme");
    vfs.writeFileSync(join(root, "node_modules", "pkg", "index.ts"), "export const c = 3;");
    vfs.writeFileSync(join(root, ".git", "head.ts"), "export const d = 4;");

    const files = collectSourceFilesRecursively(root);
    expect(files.length).toBe(2);
    expect(files.some((f) => f.endsWith("index.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("util.tsx"))).toBe(true);
  });

  test("findNearestTsconfig locates tsconfig up directory tree", () => {
    const root = createVirtualDir("task-check-tsconfig");

    const nested = join(root, "a", "b", "c");
    vfs.mkdirSync(nested, { recursive: true });
    const tsconfig = join(root, "tsconfig.json");
    vfs.writeFileSync(tsconfig, "{}");

    expect(findNearestTsconfig(nested)).toBe(tsconfig);
    expect(findNearestTsconfig(join(root, "a"))).toBe(tsconfig);
  });

  test("performAstLintCheck detects forbidden patterns (type any, type suppressions)", () => {
    const root = createVirtualDir("task-check-lint");

    const badFile = join(root, "bad.ts");
    const anyType = "an" + "y";
    vfs.writeFileSync(
      badFile,
      [
        "// @" + "ts-ignore",
        "/* " + "es" + "lint-disable" + " */",
        "// @" + "ts-nocheck",
        "// @" + "ts-expect-error",
        "/* " + "ox" + "lint-disable" + " */",
        `const x: ${anyType} = 1;`,
        `const y = x as ${anyType};`,
      ].join("\n"),
    );

    const cleanFile = join(root, "clean.ts");
    vfs.writeFileSync(cleanFile, `export const good: number = 42;`);

    const result = performAstLintCheck([badFile, cleanFile]);
    expect(result.passed).toBe(false);
    expect(result.totalFiles).toBe(2);
    expect(result.totalViolations).toBeGreaterThan(0);
    expect(result.summaryByRule.any_type).toBeGreaterThan(0);
    expect(result.summaryByRule.compiler_suppression).toBeGreaterThan(0);
  });

  test("performIncrementalTypecheck checks files with ts program", () => {
    const root = createVirtualDir("task-check-typecheck");

    const validTs = join(root, "valid.ts");
    vfs.writeFileSync(validTs, "export const num: number = 10;");

    const result = performIncrementalTypecheck([validTs]);
    expect(result.totalFiles).toBe(1);
    expect(result.passed).toBe(true);
    expect(result.totalErrors).toBe(0);

    const invalidTs = join(root, "invalid.ts");
    vfs.writeFileSync(invalidTs, "export const text: string = 10;");

    const failResult = performIncrementalTypecheck([invalidTs]);
    expect(failResult.passed).toBe(false);
    expect(failResult.totalErrors).toBeGreaterThan(0);
  });

  test("formatTaskCheckMarkdown formats pass and fail summaries", () => {
    const passSummary: TaskCheckSummary = {
      passed: true,
      filesChecked: ["src/a.ts", "src/b.ts"],
      taskId: "task-01",
      durationMs: 120,
      format: "markdown",
      markdown: "",
      typecheck: {
        passed: true,
        totalFiles: 2,
        totalErrors: 0,
        totalWarnings: 0,
        diagnostics: [],
      },
      lint: {
        passed: true,
        totalFiles: 2,
        totalViolations: 0,
        violations: [],
        summaryByRule: {},
      },
    };

    const passMd = formatTaskCheckMarkdown(passSummary);
    expect(passMd).toContain("PASS");
    expect(passMd).toContain("Task `task-01`");
    expect(passMd).toContain("TypeScript Incremental Type Check");

    const failSummary: TaskCheckSummary = {
      passed: false,
      filesChecked: ["src/single.ts"],
      durationMs: 250,
      format: "markdown",
      markdown: "",
      typecheck: {
        passed: false,
        totalFiles: 1,
        totalErrors: 12,
        totalWarnings: 0,
        diagnostics: Array.from({ length: 12 }, (_, i) => ({
          file: "src/single.ts",
          line: i + 1,
          column: 1,
          code: 2322,
          message: `Type error ${i + 1} with | pipe`,
          category: "error" as const,
        })),
      },
      lint: {
        passed: false,
        totalFiles: 1,
        totalViolations: 12,
        violations: Array.from({ length: 12 }, (_, i) => ({
          rule: "any_type" as const,
          file: "src/single.ts",
          line: i + 1,
          column: 5,
          snippet: "let x: " + ("an" + "y") + ";",
          message: `Violation ${i + 1}`,
        })),
        summaryByRule: { any_type: 12 },
      },
    };

    const failMd = formatTaskCheckMarkdown(failSummary);
    expect(failMd).toContain("FAIL");
    expect(failMd).toContain("File `src/single.ts`");
    expect(failMd).toContain("additional type errors");
    expect(failMd).toContain("additional invariant violations");
  });

  function createMockCapsule(prefix: string, stateData: Record<string, unknown>): string {
    const root = createVirtualDir(prefix);
    const runId = typeof stateData.run_id === "string" ? stateData.run_id : "test-run";
    const runDir = initRun(root, runId, new TextEncoder().encode("test prompt"), "file", true);
    if (stateData.tasks && typeof stateData.tasks === "object") {
      transact(
        runDir,
        "tester",
        "task-init",
        { tasks: stateData.tasks as Record<string, unknown> },
        (draft) => {
          (draft as Record<string, unknown>)["tasks"] = stateData.tasks;
        },
      );
    }
    return runDir;
  }

  test("projectTaskInspection and taskInspectCommand project task status, gate info, and review verdicts", async () => {
    const stateData = {
      run_id: "test-inspection-run",
      tasks: {
        "task-alpha": {
          id: "task-alpha",
          label: "Implement Alpha",
          status: "COMPLETED",
          dependencies: [],
          write_scope: ["src/alpha.ts"],
          target_files: ["src/alpha.ts"],
          gate_command: ["bun", "test", "tests/alpha.test.ts"],
          gate_proof_hash: "proof_hash_abc123",
          reviews: [
            {
              validator_id: "val-1",
              domain: "correctness",
              verdict: "APPROVED",
              reviewed_at: "2026-09-13T12:00:00Z",
              summary: "All requirements met",
            },
          ],
          lease: {
            agent_id: "agent-alpha",
            expires_at: "2026-09-13T14:00:00Z",
            lease_token: "tok_secret_lease_123456",
          },
        },
      },
    };

    const runDir = createMockCapsule("inspect-task", stateData);

    const projection = projectTaskInspection(runDir, "task-alpha");
    expect(projection.taskId).toBe("task-alpha");
    expect(projection.label).toBe("Implement Alpha");
    expect(projection.status).toBe("COMPLETED");
    expect(projection.gateCommand).toEqual(["bun", "test", "tests/alpha.test.ts"]);
    expect(projection.gateProofHash).toBe("proof_hash_abc123");
    expect(projection.reviewVerdicts.length).toBe(1);
    expect(projection.reviewVerdicts[0]?.validatorId).toBe("val-1");
    expect(projection.reviewVerdicts[0]?.verdict).toBe("APPROVED");
    expect(projection.lease?.agentId).toBe("agent-alpha");
    expect(projection.lease?.tokenSnippet).toBe("tok_se...3456");

    const markdown = formatTaskInspectMarkdown(projection);
    expect(markdown).toContain("Task Inspection: `task-alpha`");
    expect(markdown).toContain("Implement Alpha");
    expect(markdown).toContain("COMPLETED");
    expect(markdown).toContain("proof_hash_abc123");
    expect(markdown).toContain("APPROVED");
    expect(markdown).toContain("agent-alpha");

    // Command execution in markdown format
    const cmdResult = await taskInspectCommand({
      run: runDir,
      task: "task-alpha",
    });
    expect(cmdResult.format).toBe("markdown");
    expect(cmdResult.task_id).toBe("task-alpha");
    expect(cmdResult.status).toBe("COMPLETED");
    expect(typeof cmdResult.markdown).toBe("string");

    // Command execution in json format
    const jsonResult = await taskInspectCommand({
      run: runDir,
      task: "task-alpha",
      format: "json",
    });
    expect(jsonResult.format).toBe("json");
    expect(jsonResult.task_id).toBe("task-alpha");
    expect(jsonResult.gate_proof_hash).toBe("proof_hash_abc123");
  });

  test("projectTaskInspection throws error for unknown task", () => {
    const runDir = createMockCapsule("inspect-missing", {
      run_id: "missing-task-run",
      tasks: {},
    });

    expect(() => projectTaskInspection(runDir, "unknown-task")).toThrow();
  });

  test("taskCheckCommand supports --inspect flag", async () => {
    const stateData = {
      run_id: "check-inspect-run",
      tasks: {
        "task-check-inspect": {
          id: "task-check-inspect",
          label: "Inspectable Task",
          status: "IN_PROGRESS",
          gate_command: ["bun", "test", "gate.test.ts"],
          gate_proof_hash: "hash_xyz789",
        },
      },
    };

    const runDir = createMockCapsule("check-inspect", stateData);

    // Without explicit files, standalone task inspect projection is returned
    const result = await taskCheckCommand({
      run: runDir,
      task: "task-check-inspect",
      inspect: true,
    });

    expect(result.passed).toBe(true);
    expect(result.inspect).toBeDefined();
    const inspectObj = result.inspect as Record<string, unknown>;
    expect(inspectObj.taskId).toBe("task-check-inspect");
    expect(inspectObj.gateProofHash).toBe("hash_xyz789");
    expect(String(result.markdown)).toContain("Inspectable Task");

    // With explicit clean file, checks file and appends inspection projection
    const cleanFile = join(runDir, "clean.ts");
    vfs.writeFileSync(cleanFile, "export const value: number = 100;");

    const fileResult = await taskCheckCommand({
      run: runDir,
      task: "task-check-inspect",
      file: cleanFile,
      inspect: true,
    });

    expect(fileResult.passed).toBe(true);
    expect(fileResult.inspect).toBeDefined();
    expect(String(fileResult.markdown)).toContain("Inspectable Task");
    expect(String(fileResult.markdown)).toContain("Incremental Verification");
  });
});
