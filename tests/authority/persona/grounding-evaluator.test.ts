import { describe, expect, test } from "bun:test";
import {
  buildWatchdogAuditPrompt,
  createWatchdogTickReminder,
  evaluateReflexiveSelfAudit,
  formatReflexiveAuditEvaluation,
  generateWatchdogPersonaGrounding,
  type ReflexiveAuditContext,
} from "../../../olt/scripts/src/authority/persona/index.ts";

describe("Persona Grounding - Reflexive Audit Evaluator & Watchdog", () => {
  test("evaluateReflexiveSelfAudit scores clean audit context as compliant", () => {
    const cleanContext: ReflexiveAuditContext = {
      role: "coordinator",
      agentId: "coordinator_subsystem",
      subordinates: [],
      activeLeases: [],
    };
    const result = evaluateReflexiveSelfAudit(cleanContext);
    expect(result.passed).toBe(true);
    expect(result.driftScore).toBe(0.0);
    expect(result.overallSeverity).toBe("none");
    expect(result.findings.length).toBe(0);
  });

  test("evaluateReflexiveSelfAudit detects drift on lease collision and violations", () => {
    const context: ReflexiveAuditContext = {
      role: "coordinator",
      agentId: "coordinator_subsystem",
      activeLeases: [
        { taskId: "task-1", agentId: "impl-1", writeScope: ["src/app.ts"] },
        { taskId: "task-2", agentId: "impl-2", writeScope: ["src/app.ts"] },
      ],
      recentActions: [{ action: "edit_file", targetFile: "src/app.ts" }],
    };
    const result = evaluateReflexiveSelfAudit(context);
    expect(result.passed).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  test("formatReflexiveAuditEvaluation formats clean markdown evaluation", () => {
    const context: ReflexiveAuditContext = {
      role: "orchestrator",
      agentId: "orch_lead",
    };
    const result = evaluateReflexiveSelfAudit(context);
    const md = formatReflexiveAuditEvaluation(result);
    expect(md).toContain("Supervisory Reflexive Self-Audit Report");
    expect(md).toContain("ORCHESTRATOR");
  });

  test("generateWatchdogPersonaGrounding and watchdog prompts", () => {
    const grounding = generateWatchdogPersonaGrounding({ role: "mind" });
    expect(grounding.formattedMarkdown).toContain("The 7 Cognitive Pillars");

    const prompt = buildWatchdogAuditPrompt("coordinator");
    expect(prompt).toContain("The 7 Cognitive Pillars");

    const reminder = createWatchdogTickReminder("orchestrator", 1);
    expect(reminder).toBeDefined();
    expect(reminder).toContain("ORCHESTRATOR");
  });
});
