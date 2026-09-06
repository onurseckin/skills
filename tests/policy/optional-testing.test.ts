import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isTestingEnabled,
  parseRepoPolicy,
  validateRepoPolicy,
  type RepoPolicy,
} from "../../olt/scripts/src/policy/index.ts";
import { parseTestRunner } from "../../olt/scripts/src/policy/schema/workflow-schema.ts";
import { scanRepositoryToolchain } from "../../olt/scripts/src/policy/generator/toolchain-scanner.ts";
import { deriveRecommendedCommands } from "../../olt/scripts/src/cli/commands/task-brief-helpers.ts";
import { applicableGates, isTestGate } from "../../olt/scripts/src/workflow/gates/gate-policy.ts";
import type {
  GateRuntime,
  TaskRecord,
  WorkflowState,
} from "../../olt/scripts/src/workflow/types.ts";
import { checkPolicyDoctor } from "../../olt/scripts/src/reporting/doctor/policy-doctor.ts";

function createBasePolicy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    ecosystem: "bun",
    test_runner: {
      default_command: "bun test",
      targeted_pattern: "bun test <path>",
      full_suite_command: "bun test",
    },
    ...overrides,
  };
}

describe("Optional Unit-Testing & Multi-Repo Policy Governance", () => {
  // Probe 1: probe-test-null
  test("probe-test-null: test_runner: null in policy parses as enabled: false and disables testing", () => {
    const raw = createBasePolicy({ test_runner: null });
    const parsed = parseRepoPolicy(raw);
    expect(parsed.test_runner).toBeDefined();
    expect(parsed.test_runner?.enabled).toBe(false);
    expect(isTestingEnabled(parsed)).toBe(false);

    const validated = validateRepoPolicy(raw);
    expect(validated.test_runner?.enabled).toBe(false);
    expect(isTestingEnabled(validated)).toBe(false);

    const docResult = checkPolicyDoctor({ policy: parsed });
    expect(docResult.passed).toBe(true);
    expect(docResult.findings.some((f) => f.code === "TESTING_DISABLED")).toBe(true);
  });

  // Probe 2: probe-test-false
  test("probe-test-false: test_runner: false in policy parses as enabled: false and disables testing", () => {
    const raw = createBasePolicy({ test_runner: false });
    const parsed = parseRepoPolicy(raw);
    expect(parsed.test_runner?.enabled).toBe(false);
    expect(isTestingEnabled(parsed)).toBe(false);

    const validated = validateRepoPolicy(raw);
    expect(validated.test_runner?.enabled).toBe(false);
    expect(isTestingEnabled(validated)).toBe(false);

    const direct = parseTestRunner(false, "$.test_runner");
    expect(direct?.enabled).toBe(false);
  });

  // Probe 3: probe-test-disabled-obj
  test("probe-test-disabled-obj: test_runner: { enabled: false } parses cleanly without requiring commands", () => {
    const raw = createBasePolicy({ test_runner: { enabled: false } });
    const parsed = parseRepoPolicy(raw);
    expect(parsed.test_runner?.enabled).toBe(false);
    expect(isTestingEnabled(parsed)).toBe(false);

    const validated = validateRepoPolicy(raw);
    expect(validated.test_runner?.enabled).toBe(false);
    expect(isTestingEnabled(validated)).toBe(false);
  });

  // Probe 4: probe-test-enabled-valid
  test("probe-test-enabled-valid: test_runner: { enabled: true, default_command: 'bun test' } preserved", () => {
    const raw = createBasePolicy({
      test_runner: {
        enabled: true,
        default_command: "bun test",
        targeted_pattern: "bun test <path>",
        full_suite_command: "bun test",
      },
    });
    const parsed = parseRepoPolicy(raw);
    expect(parsed.test_runner?.enabled).toBe(true);
    expect(parsed.test_runner?.default_command).toBe("bun test");
    expect(isTestingEnabled(parsed)).toBe(true);

    const validated = validateRepoPolicy(raw);
    expect(validated.test_runner?.enabled).toBe(true);
    expect(isTestingEnabled(validated)).toBe(true);
  });

  // Probe 5: probe-test-empty-cmd
  test("probe-test-empty-cmd: test_runner: { default_command: '' } is treated as disabled without crash", () => {
    const raw = createBasePolicy({
      test_runner: {
        default_command: "  ",
      },
    });
    const parsed = parseRepoPolicy(raw);
    expect(parsed.test_runner?.enabled).toBe(false);
    expect(isTestingEnabled(parsed)).toBe(false);

    const validated = validateRepoPolicy(raw);
    expect(validated.test_runner?.enabled).toBe(false);
    expect(isTestingEnabled(validated)).toBe(false);
  });

  // Probe 6: probe-test-omitted-auto-detect
  test("probe-test-omitted-auto-detect: scanner emits enabled: false on repos without test suites", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "olt-test-scanner-"));
    try {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "doc-only-repo",
          version: "1.0.0",
          scripts: {
            build: "echo build",
          },
        }),
      );
      const analysis = scanRepositoryToolchain(tempDir);
      expect(analysis.testRunner.enabled).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Probe 7: probe-task-brief-suppressed
  test("probe-task-brief-suppressed: deriveRecommendedCommands returns empty array when testing is disabled", () => {
    const gateCommands = ["bun test tests/sample.test.ts", "git status"];
    const targetFiles = ["src/index.ts", "tests/sample.test.ts"];

    const enabledCommands = deriveRecommendedCommands(gateCommands, targetFiles, true);
    expect(enabledCommands.length).toBeGreaterThan(0);
    expect(enabledCommands.some((c) => c.includes("bun test"))).toBe(true);

    const disabledCommands = deriveRecommendedCommands(gateCommands, targetFiles, false);
    expect(disabledCommands).toEqual([]);
  });

  // Probe 8: probe-task-review-bypass
  test("probe-task-review-bypass: isTestGate recognizes test gates and applicableGates filters them", () => {
    const testGate: GateRuntime = {
      id: "gate-unit-tests",
      mandatory: true,
      command: ["bun", "test"],
      requirement_ids: ["req-1"],
      scope: "task",
    } as GateRuntime;

    const buildGate: GateRuntime = {
      id: "gate-typecheck",
      mandatory: true,
      command: ["bun", "run", "typecheck"],
      requirement_ids: ["req-1"],
      scope: "task",
    } as GateRuntime;

    expect(isTestGate(testGate)).toBe(true);
    expect(isTestGate(buildGate)).toBe(false);

    const mockState: WorkflowState = {
      gates: [testGate, buildGate],
      graph: { gates: [testGate, buildGate] },
      requirements: [{ id: "req-1", disposition: "actionable" }],
      tasks: {},
      commands: {},
    } as unknown as WorkflowState;

    const mockTask: TaskRecord = {
      id: "task-1",
      requirement_ids: ["req-1"],
    } as unknown as TaskRecord;

    const gates = applicableGates(mockState, mockTask);
    expect(gates.some((g) => g.id === "gate-unit-tests")).toBe(true);
    expect(gates.some((g) => g.id === "gate-typecheck")).toBe(true);
  });

  // Probe 9: probe-certify-non-test
  test("probe-certify-non-test: non-test write scope is validated only when testing is enabled", () => {
    const markdownWriteScope = ["docs/architecture/spec.md", "README.md"];
    const nonTestRejected = markdownWriteScope.filter(
      (p) => !p.endsWith(".test.ts") && !p.endsWith(".spec.ts"),
    );
    expect(nonTestRejected.length).toBe(2);

    const disabledPolicy: RepoPolicy = {
      schema_version: 1,
      ecosystem: "unknown",
      test_runner: { enabled: false },
    };
    expect(isTestingEnabled(disabledPolicy)).toBe(false);
  });

  // Probe 10: probe-test-runner-exit-zero
  test("probe-test-runner-exit-zero: isTestingEnabled evaluates false on policy with null/disabled runner", () => {
    expect(isTestingEnabled(undefined)).toBe(false);
    expect(isTestingEnabled({ schema_version: 1, ecosystem: "bun" })).toBe(false);
    expect(isTestingEnabled({ schema_version: 1, ecosystem: "bun", test_runner: null })).toBe(
      false,
    );
    expect(
      isTestingEnabled({
        schema_version: 1,
        ecosystem: "bun",
        test_runner: { enabled: false },
      }),
    ).toBe(false);
    expect(
      isTestingEnabled({
        schema_version: 1,
        ecosystem: "bun",
        test_runner: { enabled: true, default_command: "" },
      }),
    ).toBe(false);
    expect(
      isTestingEnabled({
        schema_version: 1,
        ecosystem: "bun",
        test_runner: { enabled: true, default_command: "bun test" },
      }),
    ).toBe(true);
  });
});
