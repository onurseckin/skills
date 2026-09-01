import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import {
  type StagnationTelemetry,
  VerbatimRoleInjector,
} from "../../../olt/scripts/src/authority/verbatim-role-injector.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

describe("VerbatimRoleInjector - Prompt Building & Template Injections", () => {
  describe("buildInjectionPrompt", () => {
    it("produces Mode A prompt when role === 'mind' and pendingBacklogCount === 0", () => {
      const telemetry: StagnationTelemetry = {
        agentId: "agent-mind-001",
        conversationId: "conv-12345",
        role: "mind",
        idleDurationSeconds: 150,
        pendingBacklogCount: 0,
        pendingPlanCount: 0,
        unresolvedDefectCount: 2,
        lastActiveTimestamp: "2026-08-24T05:00:00Z",
      };

      const prompt = VerbatimRoleInjector.buildInjectionPrompt(REPO_ROOT, "mind", telemetry);

      expect(prompt).toContain("[LIVE_STAGNATION_WAKEUP_INJECTION]");
      expect(prompt).toContain("CRITICAL SUPERVISORY ALERT: Live Stagnation Detected (>120s Idle)");
      expect(prompt).toContain("Role: mind | Agent: agent-mind-001 | Idle Duration: 150s");
      expect(prompt).toContain("Pending Backlog: 0 | Unresolved Defects: 2");
      expect(prompt).toContain("MODE A: AUTONOMOUS SELF-EVOLUTION MANDATE");
      expect(prompt).toContain("=== VERBATIM ROLE MANIFEST (olt/agents/mind.yaml) ===");
      expect(prompt).toContain("Execute your verbatim role instructions immediately.");
    });

    it("produces Mode B prompt when role === 'mind' and pendingBacklogCount > 0", () => {
      const telemetry: StagnationTelemetry = {
        agentId: "agent-mind-002",
        role: "mind",
        idleDurationSeconds: 180,
        pendingBacklogCount: 4,
        pendingPlanCount: 1,
        unresolvedDefectCount: 0,
      };

      const prompt = VerbatimRoleInjector.buildInjectionPrompt(REPO_ROOT, "mind", telemetry);

      expect(prompt).toContain("[LIVE_STAGNATION_WAKEUP_INJECTION]");
      expect(prompt).toContain("Role: mind | Agent: agent-mind-002 | Idle Duration: 180s");
      expect(prompt).toContain("Pending Backlog: 4 | Unresolved Defects: 0");
      expect(prompt).toContain("MODE B: ACTIVE INTAKE & WORK/SPAN SCALING MANDATE");
      expect(prompt).toContain("=== VERBATIM ROLE MANIFEST (olt/agents/mind.yaml) ===");
    });

    it("produces Mode B prompt for non-mind roles even when pendingBacklogCount === 0", () => {
      const telemetry: StagnationTelemetry = {
        agentId: "agent-orch-001",
        role: "orchestrator",
        idleDurationSeconds: 130,
        pendingBacklogCount: 0,
        pendingPlanCount: 0,
        unresolvedDefectCount: 0,
      };

      const prompt = VerbatimRoleInjector.buildInjectionPrompt(
        REPO_ROOT,
        "orchestrator",
        telemetry,
      );
      expect(prompt).toContain("MODE B: ACTIVE INTAKE & WORK/SPAN SCALING MANDATE");
    });
  });

  describe("mind & subagent initialization prompt templates", () => {
    it("buildMindInitializationPrompt formats verbatim manifest injection", () => {
      const prompt = VerbatimRoleInjector.buildMindInitializationPrompt(REPO_ROOT, {
        mindId: "mind-001",
        generation: 1,
      });

      expect(prompt).toContain("[MIND_INITIALIZATION_VERBATIM_MANIFEST_INJECTION]");
      expect(prompt).toContain("Mind ID: mind-001 | Generation: 1");
      expect(prompt).toContain("=== VERBATIM ROLE MANIFEST (olt/agents/mind.yaml) ===");
    });

    it("buildInitializationPrompt formats non-mind supervisory role prompt", () => {
      const prompt = VerbatimRoleInjector.buildInitializationPrompt(REPO_ROOT, "coordinator", {
        agentId: "coordinator-wave-1",
        taskId: "task-100",
      });

      expect(prompt).toContain("[ROLE_INITIALIZATION_VERBATIM_MANIFEST_INJECTION]");
      expect(prompt).toContain("SUPERVISORY ROLE INITIALIZATION: COORDINATOR");
      expect(prompt).toContain("Agent ID: coordinator-wave-1");
      expect(prompt).toContain("=== VERBATIM ROLE MANIFEST (olt/agents/coordinator.yaml) ===");
    });

    it("buildSubagentSystemPrompt and buildSubagentDispatchPrompt format subagent prompts cleanly", () => {
      const sysPrompt = VerbatimRoleInjector.buildSubagentSystemPrompt(REPO_ROOT, "implementer", {
        customInstructions: "Do not touch unauthorized files.",
      });

      expect(sysPrompt).toContain("[SUBAGENT_VERBATIM_SYSTEM_PROMPT: IMPLEMENTER]");
      expect(sysPrompt).toContain("Do not touch unauthorized files.");

      const dispatchPrompt = VerbatimRoleInjector.buildSubagentDispatchPrompt(
        REPO_ROOT,
        "implementer",
        "Implement auth feature",
        {
          agentId: "implementer-01",
          taskId: "task-101",
          writeScope: ["src/auth.ts"],
        },
      );

      expect(dispatchPrompt).toContain("[SUBAGENT_DISPATCH_MANDATE: IMPLEMENTER]");
      expect(dispatchPrompt).toContain("TASK PROMPT:\nImplement auth feature");
      expect(dispatchPrompt).toContain("src/auth.ts");
    });
  });
});
