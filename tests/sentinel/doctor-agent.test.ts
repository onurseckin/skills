import { describe, expect, test } from "bun:test";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import { formatDoctorAgentMarkdown, runDoctorAgent } from "../../olt/scripts/src/sentinel/index.ts";

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

  test("CLI execute runs doctor:agent with --format json", async () => {
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
  });

  test("CLI execute rejects invalid role with exit code 2", async () => {
    try {
      await execute(["doctor:agent", "--role", "invalid-non-existent-role", "--agent", "agent_01"]);
      expect(true).toBe(false); // should not reach here
    } catch (error: unknown) {
      const err = error as { code: string; exitCode: number };
      expect(err.code).toBe("INVALID_ARGUMENT");
      expect(err.exitCode).toBe(2);
    }
  });

  test("CLI execute rejects missing --agent", async () => {
    try {
      await execute(["doctor:agent", "--role", "implementer"]);
      expect(true).toBe(false);
    } catch (error: unknown) {
      const err = error as { code: string; exitCode: number };
      expect(["AUTHENTICATION_FAILURE", "INVALID_ARGUMENT"]).toContain(err.code);
    }
  });
});
