import { describe, expect, it } from "bun:test";
import type {
  AgentGrantRecord,
  AgentToolUse,
  CommandRecord,
  JsonObject,
} from "../../../../olt/scripts/src/core/contracts/index.ts";
import {
  auditImplementerSelfGradingAndTopology,
  auditOrchestratorDirectImplementation,
  auditSubagentPulseTermination,
  formatBehavioralRoleHealthSection,
  summarizeBehavioralHealth,
  type BehavioralFinding,
} from "../../../../olt/scripts/src/reporting/behavioral-auditor/index.ts";
import type { TaskRecord } from "../../../../olt/scripts/src/workflow/index.ts";

describe("Behavioral Health Auditor - Edge Vectors & Role Violations", () => {
  describe("Orchestrator Direct Implementation Invariants", () => {
    it("detects orchestrator using code editing tools and holding task leases", () => {
      const roleMap = new Map<string, string>([["orch-1", "orchestrator"]]);
      const grants: AgentGrantRecord[] = [
        {
          id: "orch-1",
          role: "orchestrator",
          model: "claude-3-5",
          status: "active",
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          tools_used: [{ name: "write_to_file", category: "file-edit" } as AgentToolUse],
        },
      ];
      const tasks: TaskRecord[] = [
        {
          id: "task-orch-1",
          label: "Task 1",
          role: "orchestrator",
          status: "leased",
          lease: {
            agent_id: "orch-1",
            role: "orchestrator",
            issued_at: new Date().toISOString(),
            heartbeat_at: new Date().toISOString(),
          },
        } as TaskRecord,
      ];
      const commands: CommandRecord[] = [
        {
          id: "cmd-orch-1",
          actor: "orch-1",
          task_id: "task-orch-1",
          argv: ["plan:apply"],
          created_at: new Date().toISOString(),
        } as CommandRecord,
      ];
      const findings: BehavioralFinding[] = [];

      auditOrchestratorDirectImplementation(roleMap, grants, commands, tasks, findings);

      expect(findings.length).toBeGreaterThanOrEqual(3);
      expect(findings.some((f) => f.violation_type === "orchestrator_direct_implementation")).toBe(
        true,
      );
    });
  });

  describe("Implementer Self-Grading and Graph Mutation Invariants", () => {
    it("detects implementer validating their own task", () => {
      const roleMap = new Map<string, string>([["impl-1", "implementer"]]);
      const tasks: TaskRecord[] = [
        {
          id: "task-self-grade",
          label: "Task self grade",
          role: "implementer",
          status: "completed",
          original_implementer: "impl-1",
          validations: [
            {
              validator_id: "impl-1",
              verdict: "APPROVED",
              domain: "unit-tests",
            },
          ],
        } as TaskRecord,
      ];
      const commands: CommandRecord[] = [
        {
          id: "cmd-val-1",
          actor: "impl-1",
          argv: ["task:review", "--verdict", "APPROVED"],
          created_at: new Date().toISOString(),
        } as CommandRecord,
      ];
      const events: JsonObject[] = [
        {
          actor: "impl-1",
          kind: "plan-compiled",
          sequence: 1,
        },
      ];
      const findings: BehavioralFinding[] = [];

      auditImplementerSelfGradingAndTopology(roleMap, tasks, commands, events, findings);

      expect(findings.some((f) => f.violation_type === "implementer_self_grading")).toBe(true);
      expect(findings.some((f) => f.violation_type === "implementer_graph_mutation")).toBe(true);
    });
  });

  describe("Subagent Pulse Termination Invariants", () => {
    it("detects subagents terminating pulse loop in state or via CLI", () => {
      const roleMap = new Map<string, string>([["worker-1", "implementer"]]);
      const state: JsonObject = {
        pulse: {
          last: {
            actor: "worker-1",
            outcome: "halted",
            terminal_reason: "user requested halt",
            pulse_id: "pulse-123",
          },
        },
      };
      const commands: CommandRecord[] = [
        {
          id: "cmd-pulse-stop",
          actor: "worker-1",
          argv: ["mind:pulse-close", "--outcome", "halted", "--terminal-reason", "done"],
          created_at: new Date().toISOString(),
        } as CommandRecord,
        {
          id: "cmd-pkill",
          actor: "worker-1",
          argv: ["pkill", "-f", "mind.service"],
          created_at: new Date().toISOString(),
        } as CommandRecord,
      ];
      const findings: BehavioralFinding[] = [];

      auditSubagentPulseTermination(roleMap, state, commands, findings);

      expect(findings.length).toBe(3);
      expect(findings.every((f) => f.violation_type === "subagent_pulse_termination")).toBe(true);
    });
  });

  describe("Summarization & Formatting", () => {
    it("summarizes clean health when no findings are present", () => {
      const summary = summarizeBehavioralHealth([]);
      expect(summary.healthy).toBe(true);
      expect(summary.violation_count).toBe(0);

      const section = formatBehavioralRoleHealthSection([]);
      expect(section).toContain("clean (0 violations)");
    });

    it("formats markdown findings when violations are present", () => {
      const findings: BehavioralFinding[] = [
        {
          agent_id: "coord-bad",
          role: "coordinator",
          violation_type: "coordinator_code_writing",
          severity: "critical",
          observation: "Wrote code directly",
          remediation: "Do not write code",
        },
      ];
      const summary = summarizeBehavioralHealth(findings);
      expect(summary.healthy).toBe(false);
      expect(summary.violation_count).toBe(1);

      const section = formatBehavioralRoleHealthSection(findings);
      expect(section).toContain("violations detected (1)");
      expect(section).toContain("coordinator");
      expect(section).toContain("Wrote code directly");
    });
  });
});
