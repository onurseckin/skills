import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertScopedExecutionPolicy,
  auditScopedExecutionCompliance,
  buildScopedTestCommand,
  resolveScopedTestTargets,
  validateMemoryAndCpuConservation,
  type ExecutionBudgetMetrics,
  type ScopedExecutionAuditResult,
  type ScopedExecutionPolicy,
} from "../../../olt/scripts/src/testing/scoped-execution.ts";
import { createSampleScopedPolicy, RUNNER_SUITES } from "./index.ts";

describe("scoped-execution static invariants", () => {
  test("scoped-execution source and test files have 0 any and 0 compiler/linter suppressions", () => {
    const srcPath = join(process.cwd(), "olt/scripts/src/testing/scoped-execution.ts");
    const tstPath = join(import.meta.dir, "scoped-execution.test.ts");
    const anyKw = "a" + "n" + "y";
    const tsIgnore = "@ts-" + "ignore",
      tsExpectError = "@ts-" + "expect-error",
      tsNocheck = "@ts-" + "nocheck",
      linter = "eslint-" + "disable";

    for (const filePath of [srcPath, tstPath]) {
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf8");
      expect(content.includes(tsIgnore)).toBe(false);
      expect(content.includes(tsExpectError)).toBe(false);
      expect(content.includes(tsNocheck)).toBe(false);
      expect(content.includes(linter)).toBe(false);
      if (filePath === srcPath) {
        expect(new RegExp(":\\s*" + anyKw + "\\b").test(content)).toBe(false);
        expect(new RegExp("as\\s+" + anyKw + "\\b").test(content)).toBe(false);
        expect(new RegExp("<" + anyKw + ">").test(content)).toBe(false);
      }
    }
  });
});

describe("resolveScopedTestTargets", () => {
  test("resolves single and multiple test files from command string and array", () => {
    const targets = resolveScopedTestTargets(
      "bun test tests/testing/runner/scoped-execution.test.ts",
    );
    expect(targets.length).toBe(1);
    expect(targets[0]!.relativePath).toBe("tests/testing/runner/scoped-execution.test.ts");
    expect(targets[0]!.domain).toBe("testing");
    expect(targets[0]!.isScoped).toBe(true);
    expect(targets[0]!.testFramework).toBe("bun");

    const multi = resolveScopedTestTargets([
      "tests/testing/locks/concurrency-lock-core.test.ts",
      "tests/testing/isolation/isolation.test.ts",
    ]);
    expect(multi.length).toBe(2);
    expect(multi[0]!.isScoped).toBe(true);
    expect(multi[1]!.isScoped).toBe(true);
  });

  test("extracts domain correctly from varied directory structures", () => {
    expect(resolveScopedTestTargets("tests/orchestrator/agents/grants.test.ts")[0]!.domain).toBe(
      "orchestrator",
    );
    expect(resolveScopedTestTargets("tests/engine/store/store.test.ts")[0]!.domain).toBe("engine");
    expect(resolveScopedTestTargets("src/components/button.test.tsx")[0]!.domain).toBe(
      "components",
    );
    expect(resolveScopedTestTargets("custom/runner.test.js")[0]!.domain).toBe("custom");
  });

  test("correctly identifies unscoped broad directories", () => {
    const broad = resolveScopedTestTargets("bun test tests/testing");
    expect(broad.length).toBe(1);
    expect(broad[0]!.isScoped).toBe(false);

    const full = resolveScopedTestTargets(["tests", "src"]);
    expect(full.length).toBe(2);
    expect(full[0]!.isScoped).toBe(false);
    expect(full[1]!.isScoped).toBe(false);
  });

  test("filters runner flags and computes existing file metadata", () => {
    const targets = resolveScopedTestTargets(
      "bun test --timeout 5000 --filter scoped tests/testing/runner/scoped-execution.test.ts --coverage --bail",
    );
    expect(targets.length).toBe(1);
    expect(targets[0]!.relativePath).toBe("tests/testing/runner/scoped-execution.test.ts");
    expect(targets[0]!.isScoped).toBe(true);

    const meta = resolveScopedTestTargets("tests/testing/runner/test-runner.test.ts")[0]!;
    expect(meta.exists).toBe(true);
    expect(meta.fileSizeBytes).toBeDefined();
    expect(meta.fileSizeBytes!).toBeGreaterThan(0);
    expect(meta.lineCount).toBeDefined();
    expect(meta.lineCount!).toBeGreaterThan(0);
  });
});

describe("assertScopedExecutionPolicy", () => {
  const strictPolicy: ScopedExecutionPolicy = {
    allowedDomains: ["testing", "orchestrator"],
    maxAllowedTestFiles: 1,
    allowFullSuite: false,
  };

  test("accepts valid scoped target adhering to policy", () => {
    const validated = assertScopedExecutionPolicy(
      ["tests/testing/locks/concurrency-lock-core.test.ts"],
      strictPolicy,
    );
    expect(validated.length).toBe(1);
    expect(validated[0]!.domain).toBe("testing");
    expect(validated[0]!.isScoped).toBe(true);
  });

  test("throws HarnessError on empty targets, count breach, broad dir, or disallowed domain", () => {
    expect(() => assertScopedExecutionPolicy([], strictPolicy)).toThrow(HarnessError);
    expect(() =>
      assertScopedExecutionPolicy(
        [
          "tests/testing/locks/concurrency-lock-core.test.ts",
          "tests/testing/isolation/isolation.test.ts",
        ],
        strictPolicy,
      ),
    ).toThrow(HarnessError);
    expect(() => assertScopedExecutionPolicy(["tests/testing"], strictPolicy)).toThrow(
      HarnessError,
    );
    expect(() =>
      assertScopedExecutionPolicy(["tests/testing/locks/concurrency-lock-core.test.ts"], {
        allowedDomains: ["cli"],
        allowFullSuite: false,
      }),
    ).toThrow(HarnessError);
  });

  test("allows broad targets and multiple files when allowFullSuite is true", () => {
    const validated = assertScopedExecutionPolicy(["tests/testing"], {
      allowFullSuite: true,
      maxAllowedTestFiles: 100,
    });
    expect(validated.length).toBe(1);
    expect(validated[0]!.isScoped).toBe(false);
  });
});

describe("buildScopedTestCommand", () => {
  test("builds bun, npm, and vitest scoped commands correctly", () => {
    const bunCmd = buildScopedTestCommand(["tests/testing/locks/concurrency-lock-core.test.ts"]);
    expect(bunCmd).toEqual(["bun", "test", "tests/testing/locks/concurrency-lock-core.test.ts"]);

    const npmCmd = buildScopedTestCommand(["tests/testing/locks/concurrency-lock-core.test.ts"], {
      runner: "npm",
    });
    expect(npmCmd).toEqual([
      "npm",
      "test",
      "--",
      "tests/testing/locks/concurrency-lock-core.test.ts",
    ]);

    const vitestCmd = buildScopedTestCommand(
      ["tests/testing/locks/concurrency-lock-core.test.ts"],
      {
        runner: "vitest",
        timeoutMs: 5000,
        filter: "isTestFilePath",
      },
    );
    expect(vitestCmd).toEqual([
      "vitest",
      "run",
      "tests/testing/locks/concurrency-lock-core.test.ts",
      "--timeout",
      "5000",
      "-t",
      "isTestFilePath",
    ]);
  });

  test("appends coverage, bail, and extraArgs, and throws on empty targets", () => {
    const cmd = buildScopedTestCommand(["tests/testing/locks/concurrency-lock-core.test.ts"], {
      runner: "bun",
      coverage: true,
      bail: true,
      extraArgs: ["--max-concurrency", "1"],
    });
    expect(cmd).toEqual([
      "bun",
      "test",
      "tests/testing/locks/concurrency-lock-core.test.ts",
      "--coverage",
      "--bail",
      "--max-concurrency",
      "1",
    ]);
    expect(() => buildScopedTestCommand([])).toThrow(HarnessError);
  });
});

describe("validateMemoryAndCpuConservation", () => {
  test("reports withinBudget true when usage is within limits", () => {
    const metrics: ExecutionBudgetMetrics = validateMemoryAndCpuConservation(
      { durationMs: 250, memoryUsedMb: 128, cpuPercent: 45 },
      { maxDurationMs: 5000, maxMemoryMb: 512, maxCpuPercent: 100 },
    );
    expect(metrics.withinBudget).toBe(true);
    expect(metrics.conservedMemory).toBe(true);
    expect(metrics.conservedCpu).toBe(true);
    expect(metrics.conservedDuration).toBe(true);
    expect(metrics.violations.length).toBe(0);
  });

  test("reports violations when limits are exceeded", () => {
    const memViol = validateMemoryAndCpuConservation(
      { durationMs: 250, memoryUsedMb: 768, cpuPercent: 45 },
      { maxMemoryMb: 512 },
    );
    expect(memViol.withinBudget).toBe(false);
    expect(memViol.violations[0]).toContain("Memory limit exceeded");

    const cpuViol = validateMemoryAndCpuConservation(
      { durationMs: 250, memoryUsedMb: 128, cpuPercent: 180 },
      { maxCpuPercent: 100 },
    );
    expect(cpuViol.withinBudget).toBe(false);
    expect(cpuViol.violations[0]).toContain("CPU ceiling exceeded");

    const durViol = validateMemoryAndCpuConservation(
      { durationMs: 15000, memoryUsedMb: 128, cpuPercent: 50 },
      { maxDurationMs: 10000 },
    );
    expect(durViol.withinBudget).toBe(false);
    expect(durViol.violations[0]).toContain("Duration budget exceeded");

    const multiViol = validateMemoryAndCpuConservation(
      { durationMs: 20000, memoryUsedMb: 1024, cpuPercent: 150 },
      { maxDurationMs: 5000, maxMemoryMb: 256, maxCpuPercent: 80 },
    );
    expect(multiViol.withinBudget).toBe(false);
    expect(multiViol.violations.length).toBe(3);
  });
});

describe("auditScopedExecutionCompliance", () => {
  const policy: ScopedExecutionPolicy = {
    allowedDomains: ["testing"],
    maxAllowedTestFiles: 1,
    maxDurationMs: 5000,
    maxMemoryMb: 512,
    maxCpuPercent: 100,
    allowFullSuite: false,
  };

  test("audits compliant scoped test invocation", () => {
    const audit: ScopedExecutionAuditResult = auditScopedExecutionCompliance({
      commandOrTargets: "bun test tests/testing/locks/concurrency-lock-core.test.ts",
      policy,
      resourceUsage: { durationMs: 300, memoryUsedMb: 120, cpuPercent: 40 },
    });
    expect(audit.compliant).toBe(true);
    expect(audit.violations.length).toBe(0);
    expect(audit.targets.length).toBe(1);
    expect(audit.metrics!.withinBudget).toBe(true);
    expect(audit.recommendedAction).toContain("conforms");
  });

  test("audits non-compliant unscoped command and disallowed domain with budget breaches", () => {
    const unscoped = auditScopedExecutionCompliance({
      commandOrTargets: "bun test tests/testing",
      policy,
    });
    expect(unscoped.compliant).toBe(false);
    expect(unscoped.violations.some((v) => v.includes("unscoped broad target"))).toBe(true);

    const breaches = auditScopedExecutionCompliance({
      commandOrTargets: "bun test tests/cli/workflow.test.ts",
      policy,
      resourceUsage: { durationMs: 12000, memoryUsedMb: 1024, cpuPercent: 150 },
    });
    expect(breaches.compliant).toBe(false);
    expect(breaches.violations.some((v) => v.includes("not in allowed domains"))).toBe(true);
    expect(breaches.violations.some((v) => v.includes("Memory limit exceeded"))).toBe(true);
    expect(breaches.violations.some((v) => v.includes("Duration budget exceeded"))).toBe(true);
    expect(breaches.violations.some((v) => v.includes("CPU ceiling exceeded"))).toBe(true);

    const sample = createSampleScopedPolicy({ maxDurationMs: 1234 });
    expect(sample.maxDurationMs).toBe(1234);
    expect(RUNNER_SUITES.length).toBe(2);
  });
});
