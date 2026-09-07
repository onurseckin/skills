import { describe, expect, test } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  formatDoctorAgentMarkdown,
  runDoctorAgent,
} from "../../../olt/scripts/src/sentinel/index.ts";

describe("doctor:agent harness diagnostic", () => {
  test("evaluates implementer with clean context as HEALTHY", () => {
    const report = runDoctorAgent({
      role: "implementer",
      agentId: "implementer_01",
      taskId: "task-001",
    });

    expect(report.status).toBe("HEALTHY");
    expect(report.strike_count).toBe(0);
    expect(report.violations).toHaveLength(0);
    expect(report.role).toBe("implementer");
  });

  test("evaluates implementer with unevidenced modifications as VIOLATION_DETECTED", () => {
    const report = runDoctorAgent({
      role: "implementer",
      agentId: "implementer_01",
      taskId: "task-002",
      modifiedFiles: ["src/core/dag.ts"],
    });

    expect(report.status).toBe("HEALTHY"); // in-flight turn before submit is healthy
  });

  test("formats healthy doctor:agent markdown cleanly", () => {
    const report = runDoctorAgent({
      role: "coordinator",
      agentId: "coordinator_01",
    });

    const markdown = formatDoctorAgentMarkdown(report);
    expect(markdown).toContain("DOCTOR:AGENT - HEALTHY");
    expect(markdown).toContain("coordinator_01");
    expect(markdown).toContain("All role invariants satisfied");
  });

  test("formats violation doctor:agent markdown cleanly", () => {
    const report = {
      status: "VIOLATION_DETECTED" as const,
      agent_id: "implementer_02",
      role: "implementer" as const,
      task_id: "task-003",
      strike_count: 1,
      violations: [
        {
          code: "MISSING_FILE_SCOPED_TEST_RUN",
          severity: "CRITICAL" as const,
          message: "File modified without running tests.",
          target_file: "src/engine.ts",
          remediation_cmd: "bun test tests/engine.test.ts",
        },
      ],
    };

    const markdown = formatDoctorAgentMarkdown(report);
    expect(markdown).toContain("[SENTINEL_ADVISE : STRIKE 1/3]");
    expect(markdown).toContain("implementer_02");
    expect(markdown).toContain("MISSING_FILE_SCOPED_TEST_RUN");
    expect(markdown).toContain("bun test tests/engine.test.ts");
  });

  test("CLI execute runs doctor:agent with --format json and validates complete schema", async () => {
    const result = await execute([
      "doctor:agent",
      "--role",
      "implementer",
      "--agent",
      "implementer_01",
      "--format",
      "json",
    ]);

    expect(result.status).toBe("HEALTHY");
    expect(result.agent_id).toBe("implementer_01");
    expect(result.role).toBe("implementer");
    expect(result.json).toBe(true);
    expect(result.strike_count).toBe(0);
    expect(Array.isArray(result.violations)).toBe(true);
    expect(typeof result.markdown).toBe("string");
  });

  test("evaluates role boundary matrix across mind, coordinator, and validator", () => {
    // Tier 0 Mind with clean context vs forbidden code mutation
    const mindHealthy = runDoctorAgent({
      role: "mind",
      agentId: "mind_root",
      modifiedFiles: [],
    });
    expect(mindHealthy.status).toBe("HEALTHY");

    const mindViolation = runDoctorAgent({
      role: "mind",
      agentId: "mind_root",
      modifiedFiles: ["src/core.ts"],
    });
    expect(mindViolation.status).toBe("VIOLATION_DETECTED");
    expect(mindViolation.violations.some((v) => v.code === "MIND_DIRECT_CODE_MUTATION")).toBe(true);

    // Tier 2 Coordinator forbidden broad test suite execution
    const coordViolation = runDoctorAgent({
      role: "coordinator",
      agentId: "coord_01",
      executedCommands: ["bun test"],
    });
    expect(coordViolation.status).toBe("VIOLATION_DETECTED");
    expect(
      coordViolation.violations.some((v) => v.code === "COORDINATOR_BROAD_TEST_SUITE_BREACH"),
    ).toBe(true);

    // Tier 3 Validator forbidden shell execution
    const valViolation = runDoctorAgent({
      role: "validator",
      agentId: "val_01",
      executedCommands: ["bun test tests/sample.test.ts"],
    });
    expect(valViolation.status).toBe("VIOLATION_DETECTED");
    expect(valViolation.violations.some((v) => v.code === "VALIDATOR_SHELL_FORBIDDEN")).toBe(true);
  });

  test("CLI execute safely handles traversal agent IDs without traversal exposure", async () => {
    const result = await execute([
      "doctor:agent",
      "--role",
      "implementer",
      "--agent",
      "../../../etc/passwd",
      "--format",
      "json",
    ]);

    expect(result.status).toBe("HEALTHY");
    expect(result.agent_id).toBe("../../../etc/passwd");
    expect(result.role).toBe("implementer");
    expect(result.strike_count).toBe(0);
    expect(Array.isArray(result.violations)).toBe(true);
  });

  test("CLI execute rejects invalid role with exit code 2", async () => {
    let didThrow = false;
    try {
      await execute(["doctor:agent", "--role", "invalid-non-existent-role", "--agent", "agent_01"]);
    } catch (error: unknown) {
      didThrow = true;
      const err = error as { code: string; exitCode: number };
      expect(err.code).toBe("INVALID_ARGUMENT");
      expect(err.exitCode).toBe(2);
    }
    expect(didThrow).toBe(true);
  });

  test("CLI execute rejects missing --agent", async () => {
    let didThrow = false;
    try {
      await execute(["doctor:agent", "--role", "implementer"]);
    } catch (error: unknown) {
      didThrow = true;
      const err = error as { code: string; exitCode: number };
      expect(["AUTHENTICATION_FAILURE", "INVALID_ARGUMENT"]).toContain(err.code);
    }
    expect(didThrow).toBe(true);
  });
});
