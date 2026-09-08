import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  optimizeScanCommand,
  scanCodebase,
  type ScanResult,
} from "../../../../olt/scripts/src/cli/commands/optimize/scan.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";

describe("optimize:scan Engine Suite", () => {
  // Counterfactual Falsifiability 1: Modularity (399 lines -> Clean; 401 lines -> Actionable)
  test("modularity: 399 lines file is Clean; 401 lines file is Actionable", () => {
    const file399 = Array.from({ length: 399 }, (_, i) => `const val${i} = ${i};`).join("\n");
    const cleanResult = scanCodebase({ files: { "src/clean-module.ts": file399 } });
    expect(cleanResult.passed).toBe(true);
    expect(cleanResult.violationsCount).toBe(0);

    const file401 = Array.from({ length: 401 }, (_, i) => `const val${i} = ${i};`).join("\n");
    const actionableResult = scanCodebase({ files: { "src/over-module.ts": file401 } });
    expect(actionableResult.passed).toBe(false);
    expect(actionableResult.violationsCount).toBe(1);
    expect(actionableResult.violations[0]?.pillar).toBe("Modularity");
    expect(actionableResult.violations[0]?.file).toBe("src/over-module.ts");
    expect(actionableResult.violations[0]?.line).toBe(401);
    expect(actionableResult.violations[0]?.severity).toBe("error");
    expect(actionableResult.violations[0]?.message).toContain("400 SLOC");
  });

  test("modularity: test files, node_modules, and .olt are excluded from 400 SLOC limit", () => {
    const longContent = Array.from({ length: 450 }, (_, i) => `const item${i} = ${i};`).join("\n");
    const result = scanCodebase({
      files: {
        "tests/unit/long.test.ts": longContent,
        "node_modules/lib/index.ts": longContent,
        ".olt/capsules/run.ts": longContent,
        "dist/bundle.js": longContent,
      },
    });
    expect(result.passed).toBe(true);
    expect(result.violationsCount).toBe(0);
  });

  // Counterfactual Falsifiability 2: Test Impurity
  test("purity: test containing setTimeout(fn, 100) flags Test Impurity with line reference", () => {
    const testCode = [
      "import { test, expect } from 'bun:test';",
      "test('impure timer', () => {",
      "  setTimeout(() => {}, 100);",
      "  expect(1).toBe(1);",
      "});",
    ].join("\n");

    const result = scanCodebase({ files: { "tests/timer.test.ts": testCode } });
    expect(result.passed).toBe(false);
    expect(result.violationsCount).toBe(1);
    const v = result.violations[0];
    expect(v?.pillar).toBe("Purity");
    expect(v?.file).toBe("tests/timer.test.ts");
    expect(v?.line).toBe(3);
    expect(v?.message).toContain("wall-clock timer 'setTimeout'");
    expect(v?.severity).toBe("error");
  });

  test("purity: flags wall-clock timers and network calls in test files", () => {
    const testCode = [
      "// Clean comment",
      "setInterval(() => {}, 50);",
      "sleep(100);",
      "fetch('https://api.example.com');",
      "http.get('http://local');",
      "https.request('https://local');",
      "net.connect(8080);",
    ].join("\n");

    const result = scanCodebase({ files: { "tests/mixed.spec.ts": testCode } });
    expect(result.passed).toBe(false);
    expect(result.violationsCount).toBe(6);
    const messages = result.violations.map((v) => v.message);
    expect(messages.some((m) => m.includes("setInterval"))).toBe(true);
    expect(messages.some((m) => m.includes("sleep"))).toBe(true);
    expect(messages.some((m) => m.includes("fetch"))).toBe(true);
    expect(messages.some((m) => m.includes("http."))).toBe(true);
    expect(messages.some((m) => m.includes("https."))).toBe(true);
    expect(messages.some((m) => m.includes("net.connect"))).toBe(true);
  });

  test("purity: pure in-memory test mocks produce 0 violations", () => {
    const pureTest = [
      "import { test, expect } from 'bun:test';",
      "test('pure mock', () => {",
      "  const data = { ok: true };",
      "  expect(data.ok).toBe(true);",
      "});",
    ].join("\n");

    const result = scanCodebase({ files: { "tests/pure.test.ts": pureTest } });
    expect(result.passed).toBe(true);
    expect(result.violationsCount).toBe(0);
  });

  // Counterfactual Falsifiability 3: Type Safety
  test("type safety: code containing : any flags Type Safety violation", () => {
    const src = [
      "export function parse(input: any): string {",
      "  return String(input);",
      "}",
    ].join("\n");

    const result = scanCodebase({ files: { "src/unsafe.ts": src } });
    expect(result.passed).toBe(false);
    expect(result.violationsCount).toBe(1);
    const v = result.violations[0];
    expect(v?.pillar).toBe("Type Safety");
    expect(v?.file).toBe("src/unsafe.ts");
    expect(v?.line).toBe(1);
    expect(v?.message).toContain("': any'");
  });

  test("type safety: flags as any, <any>, double casts, and compiler suppressions", () => {
    const src = [
      "// @ts-ignore",
      "// @ts-expect-error",
      "// @ts-nocheck",
      "const a = x as any;",
      "const b = <any>y;",
      "const c = z as unknown as string;",
    ].join("\n");

    const result = scanCodebase({ files: { "src/escapes.ts": src } });
    expect(result.passed).toBe(false);
    expect(result.violationsCount).toBe(6);
    const msgs = result.violations.map((v) => v.message);
    expect(msgs.some((m) => m.includes("@ts-ignore"))).toBe(true);
    expect(msgs.some((m) => m.includes("@ts-expect-error"))).toBe(true);
    expect(msgs.some((m) => m.includes("@ts-nocheck"))).toBe(true);
    expect(msgs.some((m) => m.includes("'as any'"))).toBe(true);
    expect(msgs.some((m) => m.includes("'<any>'"))).toBe(true);
    expect(msgs.some((m) => m.includes("'as unknown as'"))).toBe(true);
  });

  // Counterfactual Falsifiability 4: Strict Mode Throws vs Non-Strict Mode
  test("strict mode throws HarnessError('INVALID_STATE') on violations; non-strict returns result", async () => {
    const badFiles = { "src/bad.ts": "const x: any = 1;" };

    // Non-strict via scanCodebase
    const nonStrictRes = scanCodebase({ files: badFiles, strict: false });
    expect(nonStrictRes.passed).toBe(false);
    expect(nonStrictRes.violationsCount).toBe(1);

    // Strict via scanCodebase throws
    expect(() => {
      scanCodebase({ files: badFiles, strict: true });
    }).toThrow();

    try {
      scanCodebase({ files: badFiles, strict: true });
      expect(true).toBe(false);
    } catch (err) {
      expect(err instanceof HarnessError).toBe(true);
      if (err instanceof HarnessError) {
        expect(err.code).toBe("INVALID_STATE");
        expect(err.issues.length).toBe(1);
      }
    }

    // Strict via optimizeScanCommand CLI handler throws
    expect(async () => {
      await optimizeScanCommand({ strict: true }, { files: badFiles });
    }).toThrow();

    // Strict with 0 violations passes cleanly without throwing
    const cleanFiles = { "src/good.ts": "export const a = 1;" };
    const cleanCmdRes = await optimizeScanCommand({ strict: true }, { files: cleanFiles });
    expect(cleanCmdRes.passed).toBe(true);
    expect(cleanCmdRes.violationsCount).toBe(0);
  });

  // Hot-Path Latency Pillar
  test("hot-path latency: flags sequential sync I/O in loops and redundant allocations", () => {
    const src = [
      "export function processBatch(items: string[]): void {",
      "  for (const item of items) {",
      "    const data = readFileSync(item);",
      "  }",
      "  const cloned = JSON.parse(JSON.stringify(items));",
      "}",
    ].join("\n");

    const result = scanCodebase({ files: { "src/batch.ts": src } });
    expect(result.passed).toBe(false);
    expect(result.violationsCount).toBe(2);
    const syncV = result.violations.find((v) => v.message.includes("readFileSync"));
    expect(syncV?.pillar).toBe("Hot-Path Latency");
    expect(syncV?.line).toBe(3);
    const allocV = result.violations.find((v) => v.message.includes("JSON.parse"));
    expect(allocV?.pillar).toBe("Hot-Path Latency");
    expect(allocV?.line).toBe(5);
  });

  // Ergonomics Pillar
  test("ergonomics: flags dead unexported utilities and duplicate helpers", () => {
    const src = [
      "function unreferencedPrivate() { return 1; }",
      "function duplicateFn() { return 2; }",
      "function duplicateFn() { return 3; }",
      "export function activeEntry() { return duplicateFn(); }",
    ].join("\n");

    const result = scanCodebase({ files: { "src/helpers.ts": src } });
    expect(result.passed).toBe(false);
    const deadV = result.violations.find((v) => v.message.includes("unreferencedPrivate"));
    expect(deadV?.pillar).toBe("Ergonomics");
    expect(deadV?.line).toBe(1);
    const dupV = result.violations.find((v) => v.message.includes("Duplicate helper"));
    expect(dupV?.pillar).toBe("Ergonomics");
    expect(dupV?.line).toBe(3);
  });

  // Filtering by Pillar and Limit
  test("pillar and limit filtering work as expected", () => {
    const files = {
      "src/heavy.ts": Array.from({ length: 405 }, (_, i) => `const z${i} = ${i};`).join("\n"),
      "tests/timer.test.ts": "setTimeout(() => {}, 100);",
      "src/unsafe.ts": "const x: any = 1;",
    };

    // Filter by single pillar
    const purityOnly = scanCodebase({ files, pillar: "Purity" });
    expect(purityOnly.violations.length).toBe(1);
    expect(purityOnly.violations[0]?.pillar).toBe("Purity");

    // Case-insensitive / slug tolerant pillar filter
    const typeSafetyOnly = scanCodebase({ files, pillar: "type-safety" });
    expect(typeSafetyOnly.violations.length).toBe(1);
    expect(typeSafetyOnly.violations[0]?.pillar).toBe("Type Safety");

    // Limit violations
    const limited = scanCodebase({ files, limit: 2 });
    expect(limited.violations.length).toBe(2);
    expect(limited.violationsCount).toBe(2);
  });

  // Markdown Report Invariants
  test("markdown report table adheres to <= 30 lines invariant", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 50; i++) {
      files[`src/file${i}.ts`] = `const escape${i}: any = ${i};`;
    }
    const result: ScanResult = scanCodebase({ files });
    expect(result.violationsCount).toBe(50);
    const lines = result.markdown.split("\n");
    expect(lines.length).toBeLessThanOrEqual(30);
    expect(result.markdown).toContain("### Codebase Optimization Scan Report");
    expect(result.markdown).toContain("| Pillar | Status | Violations |");
    expect(result.markdown).toContain("Modularity");
    expect(result.markdown).toContain("Type Safety");
  });

  // Full CLI Command Execution
  test("optimizeScanCommand runs with flags and json output", async () => {
    const files = {
      "src/data.ts": "export const data = 42;",
    };

    const cmdRes = await optimizeScanCommand({ json: true, dir: "." }, { files });
    expect(cmdRes.passed).toBe(true);
    expect(cmdRes.totalFilesScanned).toBe(1);
    expect(cmdRes.violationsCount).toBe(0);
    expect(cmdRes.json).toBe(true);
    expect(typeof cmdRes.markdown).toBe("string");
  });

  // Filesystem Walk and Root Directory Scanning
  test("disk scanning: walks directory, ignores hidden/ignored dirs, and handles non-existent roots", () => {
    const vfs = new VirtualMemoryFS();
    const session = createVirtualFSSession(vfs);
    const tempDir = "/virtual/optimize-scan-test";
    try {
      vfs.mkdirSync(join(tempDir, "src"), { recursive: true });
      vfs.mkdirSync(join(tempDir, "node_modules"), { recursive: true });
      vfs.mkdirSync(join(tempDir, ".git"), { recursive: true });

      vfs.writeFileSync(join(tempDir, "src", "index.ts"), "export const hello = 'world';", "utf8");
      vfs.writeFileSync(join(tempDir, "src", "bad.ts"), "export const val: any = 123;", "utf8");
      vfs.writeFileSync(
        join(tempDir, "node_modules", "ignored.ts"),
        "export const bad: any = 1;",
        "utf8",
      );
      vfs.writeFileSync(join(tempDir, ".git", "ignored.ts"), "export const bad: any = 1;", "utf8");

      const diskRes = scanCodebase({ rootDir: tempDir });
      expect(diskRes.passed).toBe(false);
      expect(diskRes.totalFilesScanned).toBe(2); // Only src/index.ts and src/bad.ts
      expect(diskRes.violationsCount).toBe(1);
      expect(diskRes.violations[0]?.file).toContain("bad.ts");

      // Non-existent directory returns cleanly with 0 scanned files
      const emptyRes = scanCodebase({ rootDir: join(tempDir, "does-not-exist") });
      expect(emptyRes.passed).toBe(true);
      expect(emptyRes.totalFilesScanned).toBe(0);
    } finally {
      session.cleanup();
    }
  });
});
