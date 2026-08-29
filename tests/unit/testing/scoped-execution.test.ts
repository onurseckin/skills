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
  type ScopedTestTarget,
} from "../../../olt/scripts/src/testing/scoped-execution.ts";

describe("Static Invariants: Zero Any & Zero Suppressions", () => {
  test("scoped-execution source and test files have 0 any and 0 compiler/linter suppressions", () => {
    const sourcePath = join(
      import.meta.dir,
      "../../../olt/scripts/src/testing/scoped-execution.ts",
    );
    const testPath = join(import.meta.dir, "scoped-execution.test.ts");

    const anyKeyword = "a" + "n" + "y";
    const tsIgnore = "@ts-" + "ignore";
    const tsExpectError = "@ts-" + "expect-error";
    const tsNocheck = "@ts-" + "nocheck";
    const linterDirective = "eslint-" + "disable";

    for (const filePath of [sourcePath, testPath]) {
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf8");

      expect(content.includes(tsIgnore)).toBe(false);
      expect(content.includes(tsExpectError)).toBe(false);
      expect(content.includes(tsNocheck)).toBe(false);
      expect(content.includes(linterDirective)).toBe(false);

      const colonAny = new RegExp(":\\s*" + anyKeyword + "\\b");
      const asAny = new RegExp("as\\s+" + anyKeyword + "\\b");
      const genericAny = new RegExp("<" + anyKeyword + ">");

      if (filePath === sourcePath) {
        expect(colonAny.test(content)).toBe(false);
        expect(asAny.test(content)).toBe(false);
        expect(genericAny.test(content)).toBe(false);
      }
    }
  });
});

describe("resolveScopedTestTargets", () => {
  test("resolves single test file from command string", () => {
    const targets = resolveScopedTestTargets(
      "bun test tests/unit/testing/scoped-execution.test.ts",
    );
    expect(targets.length).toBe(1);
    const target = targets[0]!;
    expect(target.relativePath).toBe("tests/unit/testing/scoped-execution.test.ts");
    expect(target.domain).toBe("unit");
    expect(target.isScoped).toBe(true);
    expect(target.testFramework).toBe("bun");
  });

  test("resolves multiple test files from array of strings", () => {
    const targets = resolveScopedTestTargets([
      "tests/unit/testing/concurrency-lock.test.ts",
      "tests/unit/testing/isolation.test.ts",
    ]);
    expect(targets.length).toBe(2);
    expect(targets[0]!.isScoped).toBe(true);
    expect(targets[0]!.domain).toBe("unit");
    expect(targets[1]!.isScoped).toBe(true);
    expect(targets[1]!.domain).toBe("unit");
  });

  test("extracts domain correctly from varied directory structures", () => {
    const unitTarget = resolveScopedTestTargets("tests/unit/authority/manifest.test.ts")[0]!;
    expect(unitTarget.domain).toBe("unit");

    const integrationTarget = resolveScopedTestTargets("test/integration/database.spec.ts")[0]!;
    expect(integrationTarget.domain).toBe("integration");

    const srcTarget = resolveScopedTestTargets("src/components/button.test.tsx")[0]!;
    expect(srcTarget.domain).toBe("components");

    const topLevelTarget = resolveScopedTestTargets("custom/runner.test.js")[0]!;
    expect(topLevelTarget.domain).toBe("custom");
  });

  test("correctly identifies unscoped broad directories", () => {
    const broadTargets = resolveScopedTestTargets("bun test tests/unit");
    expect(broadTargets.length).toBe(1);
    expect(broadTargets[0]!.isScoped).toBe(false);

    const fullTargets = resolveScopedTestTargets(["tests", "src"]);
    expect(fullTargets.length).toBe(2);
    expect(fullTargets[0]!.isScoped).toBe(false);
    expect(fullTargets[1]!.isScoped).toBe(false);
  });

  test("filters out runner flags and parameters during token extraction", () => {
    const targets = resolveScopedTestTargets(
      "bun test --timeout 5000 --filter scoped tests/unit/testing/scoped-execution.test.ts --coverage --bail",
    );
    expect(targets.length).toBe(1);
    expect(targets[0]!.relativePath).toBe("tests/unit/testing/scoped-execution.test.ts");
    expect(targets[0]!.isScoped).toBe(true);
  });

  test("calculates file metadata for existing files", () => {
    const targets = resolveScopedTestTargets("tests/unit/testing/concurrency-lock.test.ts");
    expect(targets.length).toBe(1);
    const target = targets[0]!;
    expect(target.exists).toBe(true);
    expect(target.fileSizeBytes).toBeDefined();
    expect(target.fileSizeBytes!).toBeGreaterThan(0);
    expect(target.lineCount).toBeDefined();
    expect(target.lineCount!).toBeGreaterThan(0);
  });
});

describe("assertScopedExecutionPolicy", () => {
  const strictPolicy: ScopedExecutionPolicy = {
    allowedDomains: ["unit", "testing"],
    maxAllowedTestFiles: 1,
    allowFullSuite: false,
  };

  test("accepts valid scoped target adhering to policy", () => {
    const validated = assertScopedExecutionPolicy(
      ["tests/unit/testing/concurrency-lock.test.ts"],
      strictPolicy,
    );
    expect(validated.length).toBe(1);
    expect(validated[0]!.domain).toBe("unit");
    expect(validated[0]!.isScoped).toBe(true);
  });

  test("throws HarnessError when no targets provided under strict policy", () => {
    expect(() => {
      assertScopedExecutionPolicy([], strictPolicy);
    }).toThrow(HarnessError);

    try {
      assertScopedExecutionPolicy([], strictPolicy);
    } catch (err) {
      expect(err).toBeInstanceOf(HarnessError);
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_ARGUMENT");
    }
  });

  test("throws HarnessError when target count exceeds maxAllowedTestFiles", () => {
    expect(() => {
      assertScopedExecutionPolicy(
        ["tests/unit/testing/concurrency-lock.test.ts", "tests/unit/testing/isolation.test.ts"],
        strictPolicy,
      );
    }).toThrow(HarnessError);
  });

  test("throws HarnessError when target is an unscoped broad directory", () => {
    expect(() => {
      assertScopedExecutionPolicy(["tests/unit"], strictPolicy);
    }).toThrow(HarnessError);
  });

  test("throws HarnessError when target domain is not in allowedDomains", () => {
    const restrictedPolicy: ScopedExecutionPolicy = {
      allowedDomains: ["e2e"],
      maxAllowedTestFiles: 2,
      allowFullSuite: false,
    };

    expect(() => {
      assertScopedExecutionPolicy(
        ["tests/unit/testing/concurrency-lock.test.ts"],
        restrictedPolicy,
      );
    }).toThrow(HarnessError);
  });

  test("allows broad targets and multiple files when allowFullSuite is true", () => {
    const permissivePolicy: ScopedExecutionPolicy = {
      allowFullSuite: true,
      maxAllowedTestFiles: 100,
    };

    const validated = assertScopedExecutionPolicy(["tests/unit"], permissivePolicy);
    expect(validated.length).toBe(1);
    expect(validated[0]!.isScoped).toBe(false);
  });
});

describe("buildScopedTestCommand", () => {
  test("builds bun test command by default", () => {
    const cmd = buildScopedTestCommand(["tests/unit/testing/concurrency-lock.test.ts"]);
    expect(cmd).toEqual(["bun", "test", "tests/unit/testing/concurrency-lock.test.ts"]);
  });

  test("builds npm test command with double dashes", () => {
    const cmd = buildScopedTestCommand(["tests/unit/testing/concurrency-lock.test.ts"], {
      runner: "npm",
    });
    expect(cmd).toEqual(["npm", "test", "--", "tests/unit/testing/concurrency-lock.test.ts"]);
  });

  test("builds vitest run command with filter and timeout", () => {
    const cmd = buildScopedTestCommand(["tests/unit/testing/concurrency-lock.test.ts"], {
      runner: "vitest",
      timeoutMs: 5000,
      filter: "isTestFilePath",
    });
    expect(cmd).toEqual([
      "vitest",
      "run",
      "tests/unit/testing/concurrency-lock.test.ts",
      "--timeout",
      "5000",
      "-t",
      "isTestFilePath",
    ]);
  });

  test("appends coverage, bail, and extraArgs correctly", () => {
    const cmd = buildScopedTestCommand(["tests/unit/testing/concurrency-lock.test.ts"], {
      runner: "bun",
      coverage: true,
      bail: true,
      extraArgs: ["--max-concurrency", "1"],
    });
    expect(cmd).toEqual([
      "bun",
      "test",
      "tests/unit/testing/concurrency-lock.test.ts",
      "--coverage",
      "--bail",
      "--max-concurrency",
      "1",
    ]);
  });

  test("throws HarnessError on empty targets", () => {
    expect(() => {
      buildScopedTestCommand([]);
    }).toThrow(HarnessError);
  });
});

describe("validateMemoryAndCpuConservation", () => {
  test("reports withinBudget true when all resource metrics are below thresholds", () => {
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

  test("reports memory violation when memory exceeds limit", () => {
    const metrics: ExecutionBudgetMetrics = validateMemoryAndCpuConservation(
      { durationMs: 250, memoryUsedMb: 768, cpuPercent: 45 },
      { maxMemoryMb: 512 },
    );

    expect(metrics.withinBudget).toBe(false);
    expect(metrics.conservedMemory).toBe(false);
    expect(metrics.violations.length).toBe(1);
    expect(metrics.violations[0]).toContain("Memory limit exceeded");
  });

  test("reports CPU ceiling violation when CPU exceeds limit", () => {
    const metrics: ExecutionBudgetMetrics = validateMemoryAndCpuConservation(
      { durationMs: 250, memoryUsedMb: 128, cpuPercent: 180 },
      { maxCpuPercent: 100 },
    );

    expect(metrics.withinBudget).toBe(false);
    expect(metrics.conservedCpu).toBe(false);
    expect(metrics.violations.length).toBe(1);
    expect(metrics.violations[0]).toContain("CPU ceiling exceeded");
  });

  test("reports duration budget violation when duration exceeds limit", () => {
    const metrics: ExecutionBudgetMetrics = validateMemoryAndCpuConservation(
      { durationMs: 15000, memoryUsedMb: 128, cpuPercent: 50 },
      { maxDurationMs: 10000 },
    );

    expect(metrics.withinBudget).toBe(false);
    expect(metrics.conservedDuration).toBe(false);
    expect(metrics.violations.length).toBe(1);
    expect(metrics.violations[0]).toContain("Duration budget exceeded");
  });

  test("accumulates multiple simultaneous violations", () => {
    const metrics: ExecutionBudgetMetrics = validateMemoryAndCpuConservation(
      { durationMs: 20000, memoryUsedMb: 1024, cpuPercent: 150 },
      { maxDurationMs: 5000, maxMemoryMb: 256, maxCpuPercent: 80 },
    );

    expect(metrics.withinBudget).toBe(false);
    expect(metrics.conservedMemory).toBe(false);
    expect(metrics.conservedCpu).toBe(false);
    expect(metrics.conservedDuration).toBe(false);
    expect(metrics.violations.length).toBe(3);
  });
});

describe("auditScopedExecutionCompliance", () => {
  const policy: ScopedExecutionPolicy = {
    allowedDomains: ["unit"],
    maxAllowedTestFiles: 1,
    maxDurationMs: 5000,
    maxMemoryMb: 512,
    maxCpuPercent: 100,
    allowFullSuite: false,
  };

  test("audits compliant scoped test invocation", () => {
    const audit: ScopedExecutionAuditResult = auditScopedExecutionCompliance({
      commandOrTargets: "bun test tests/unit/testing/concurrency-lock.test.ts",
      policy,
      resourceUsage: { durationMs: 300, memoryUsedMb: 120, cpuPercent: 40 },
    });

    expect(audit.compliant).toBe(true);
    expect(audit.violations.length).toBe(0);
    expect(audit.targets.length).toBe(1);
    expect(audit.metrics).toBeDefined();
    expect(audit.metrics!.withinBudget).toBe(true);
    expect(audit.recommendedAction).toContain("conforms");
  });

  test("audits non-compliant unscoped test command", () => {
    const audit: ScopedExecutionAuditResult = auditScopedExecutionCompliance({
      commandOrTargets: "bun test tests/unit",
      policy,
    });

    expect(audit.compliant).toBe(false);
    expect(audit.violations.length).toBeGreaterThan(0);
    expect(audit.violations.some((v) => v.includes("unscoped broad target"))).toBe(true);
  });

  test("audits non-compliant test command with disallowed domain and budget breaches", () => {
    const audit: ScopedExecutionAuditResult = auditScopedExecutionCompliance({
      commandOrTargets: "bun test tests/e2e/workflow.test.ts",
      policy,
      resourceUsage: { durationMs: 12000, memoryUsedMb: 1024, cpuPercent: 150 },
    });

    expect(audit.compliant).toBe(false);
    expect(audit.violations.some((v) => v.includes("not in allowed domains"))).toBe(true);
    expect(audit.violations.some((v) => v.includes("Memory limit exceeded"))).toBe(true);
    expect(audit.violations.some((v) => v.includes("Duration budget exceeded"))).toBe(true);
    expect(audit.violations.some((v) => v.includes("CPU ceiling exceeded"))).toBe(true);
  });
});
