import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  StateMachineAuditor,
  type LifecycleFinding,
  type LifecycleAuditSummary,
} from "../../../olt/scripts/src/reporting/doctor/state-machine-auditor.ts";
import { runDoctor } from "../../../olt/scripts/src/reporting/doctor.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

describe("StateMachineAuditor", () => {
  describe("auditLifecycle - PLANNING_BRAINSTORMING_SKIPPED", () => {
    it("returns no findings for completely empty state and empty events", () => {
      const findings = StateMachineAuditor.auditLifecycle({}, []);
      expect(findings).toEqual([]);
    });

    it("flags PLANNING_BRAINSTORMING_SKIPPED when tasks exist in state without plan-brainstormed event", () => {
      const state: Record<string, unknown> = {
        tasks: {
          "task-1": { id: "task-1", status: "proposed" },
        },
      };

      const findings = StateMachineAuditor.auditLifecycle(state, []);
      expect(findings.some((f) => f.code === "PLANNING_BRAINSTORMING_SKIPPED")).toBe(true);
      const finding = findings.find((f) => f.code === "PLANNING_BRAINSTORMING_SKIPPED");
      expect(finding?.severity).toBe("critical");
      expect(finding?.details?.taskCount).toBe(1);
    });

    it("flags PLANNING_BRAINSTORMING_SKIPPED when planning_tasks exist without plan-brainstormed event", () => {
      const state: Record<string, unknown> = {
        planning_tasks: [{ id: "task-p1" }],
      };

      const findings = StateMachineAuditor.auditLifecycle(state, []);
      expect(findings.some((f) => f.code === "PLANNING_BRAINSTORMING_SKIPPED")).toBe(true);
    });

    it("flags PLANNING_BRAINSTORMING_SKIPPED when task events exist in events stream without brainstormed event", () => {
      const state: Record<string, unknown> = {};
      const events: readonly Record<string, unknown>[] = [
        { kind: "plan-applied", sequence: 1 },
        { kind: "task-claimed", sequence: 2 },
      ];

      const findings = StateMachineAuditor.auditLifecycle(state, events);
      expect(findings.some((f) => f.code === "PLANNING_BRAINSTORMING_SKIPPED")).toBe(true);
    });

    it("does not flag PLANNING_BRAINSTORMING_SKIPPED when plan-brainstormed event is present", () => {
      const state: Record<string, unknown> = {
        tasks: {
          "task-1": { id: "task-1", status: "proposed" },
        },
      };
      const events: readonly Record<string, unknown>[] = [
        { kind: "plan-brainstormed", sequence: 1 },
      ];

      const findings = StateMachineAuditor.auditLifecycle(state, events);
      expect(findings.some((f) => f.code === "PLANNING_BRAINSTORMING_SKIPPED")).toBe(false);
    });

    it("recognizes alternative brainstorm event names like plan:brainstorm or brainstormed", () => {
      const state: Record<string, unknown> = {
        tasks: { "task-1": { id: "task-1", status: "proposed" } },
      };

      const findings1 = StateMachineAuditor.auditLifecycle(state, [{ kind: "plan:brainstorm" }]);
      expect(findings1.some((f) => f.code === "PLANNING_BRAINSTORMING_SKIPPED")).toBe(false);

      const findings2 = StateMachineAuditor.auditLifecycle(state, [{ type: "brainstormed" }]);
      expect(findings2.some((f) => f.code === "PLANNING_BRAINSTORMING_SKIPPED")).toBe(false);
    });
  });

  describe("auditLifecycle - PLAN_VALIDATION_SKIPPED", () => {
    it("does not flag PLAN_VALIDATION_SKIPPED if tasks are only proposed/ready and not claimed", () => {
      const state: Record<string, unknown> = {
        tasks: {
          "task-1": { id: "task-1", status: "proposed" },
          "task-2": { id: "task-2", status: "ready" },
        },
      };
      const events: readonly Record<string, unknown>[] = [
        { kind: "plan-brainstormed", sequence: 1 },
      ];

      const findings = StateMachineAuditor.auditLifecycle(state, events);
      expect(findings.some((f) => f.code === "PLAN_VALIDATION_SKIPPED")).toBe(false);
    });

    it("flags PLAN_VALIDATION_SKIPPED when a task is leased/running without plan validation approval", () => {
      const state: Record<string, unknown> = {
        tasks: {
          "task-1": {
            id: "task-1",
            status: "leased",
            lease: { agent_id: "impl-1" },
          },
        },
      };
      const events: readonly Record<string, unknown>[] = [
        { kind: "plan-brainstormed", sequence: 1 },
      ];

      const findings = StateMachineAuditor.auditLifecycle(state, events);
      expect(findings.some((f) => f.code === "PLAN_VALIDATION_SKIPPED")).toBe(true);
      const finding = findings.find((f) => f.code === "PLAN_VALIDATION_SKIPPED");
      expect(finding?.severity).toBe("critical");
      expect(finding?.details?.progressedTaskIds).toContain("task-1");
    });

    it("flags PLAN_VALIDATION_SKIPPED when a task is submitted or done without plan validation approval", () => {
      const state: Record<string, unknown> = {
        tasks: {
          "task-1": { id: "task-1", status: "submitted" },
        },
      };
      const events: readonly Record<string, unknown>[] = [
        { kind: "plan-brainstormed", sequence: 1 },
      ];

      const findings = StateMachineAuditor.auditLifecycle(state, events);
      expect(findings.some((f) => f.code === "PLAN_VALIDATION_SKIPPED")).toBe(true);
    });

    it("flags PLAN_VALIDATION_SKIPPED when task progress events exist in event stream without plan approval", () => {
      const state: Record<string, unknown> = {};
      const events: readonly Record<string, unknown>[] = [
        { kind: "plan-brainstormed", sequence: 1 },
        { kind: "task-claimed", sequence: 2, payload: { task_id: "task-1" } },
      ];

      const findings = StateMachineAuditor.auditLifecycle(state, events);
      expect(findings.some((f) => f.code === "PLAN_VALIDATION_SKIPPED")).toBe(true);
    });

    it("does not flag PLAN_VALIDATION_SKIPPED when plan_review status is approved in state", () => {
      const state: Record<string, unknown> = {
        plan_review: {
          status: "approved",
          validator_id: "plan-validator",
        },
        tasks: {
          "task-1": { id: "task-1", status: "leased" },
        },
      };
      const events: readonly Record<string, unknown>[] = [
        { kind: "plan-brainstormed", sequence: 1 },
      ];

      const findings = StateMachineAuditor.auditLifecycle(state, events);
      expect(findings.some((f) => f.code === "PLAN_VALIDATION_SKIPPED")).toBe(false);
    });

    it("does not flag PLAN_VALIDATION_SKIPPED when plan validation approved event is present", () => {
      const state: Record<string, unknown> = {
        tasks: {
          "task-1": { id: "task-1", status: "running" },
        },
      };
      const events: readonly Record<string, unknown>[] = [
        { kind: "plan-brainstormed", sequence: 1 },
        { kind: "plan-reviewed", payload: { status: "approved" } },
      ];

      const findings = StateMachineAuditor.auditLifecycle(state, events);
      expect(findings.some((f) => f.code === "PLAN_VALIDATION_SKIPPED")).toBe(false);
    });
  });

  describe("auditLifecycle - UNVALIDATED_TASK_COMPLETED", () => {
    it("flags UNVALIDATED_TASK_COMPLETED when task is done with empty validations array", () => {
      const state: Record<string, unknown> = {
        tasks: {
          "task-1": { status: "done", validations: [] },
        },
      };
      const events: readonly Record<string, unknown>[] = [
        { kind: "plan-brainstormed" },
        { kind: "plan-reviewed", payload: { status: "approved" } },
      ];

      const findings = StateMachineAuditor.auditLifecycle(state, events);
      expect(findings.some((f) => f.code === "UNVALIDATED_TASK_COMPLETED")).toBe(true);
      const finding = findings.find((f) => f.code === "UNVALIDATED_TASK_COMPLETED");
      expect(finding?.severity).toBe("critical");
      expect(finding?.details?.taskId).toBe("task-1");
    });

    it("flags UNVALIDATED_TASK_COMPLETED when task is done without validations property", () => {
      const state: Record<string, unknown> = {
        tasks: {
          "task-unval": { id: "task-unval", status: "done" },
        },
      };
      const events: readonly Record<string, unknown>[] = [
        { kind: "plan-brainstormed" },
        { kind: "plan-reviewed", payload: { status: "approved" } },
      ];

      const findings = StateMachineAuditor.auditLifecycle(state, events);
      expect(findings.some((f) => f.code === "UNVALIDATED_TASK_COMPLETED")).toBe(true);
    });

    it("flags UNVALIDATED_TASK_COMPLETED when task is done with failed validation verdict", () => {
      const state: Record<string, unknown> = {
        tasks: {
          "task-failed": {
            status: "done",
            validations: [{ domain: "code-quality", verdict: "fail" }],
          },
        },
      };
      const events: readonly Record<string, unknown>[] = [
        { kind: "plan-brainstormed" },
        { kind: "plan-reviewed", payload: { status: "approved" } },
      ];

      const findings = StateMachineAuditor.auditLifecycle(state, events);
      expect(findings.some((f) => f.code === "UNVALIDATED_TASK_COMPLETED")).toBe(true);
    });

    it("flags UNVALIDATED_TASK_COMPLETED when task is done with open findings", () => {
      const state: Record<string, unknown> = {
        tasks: {
          "task-open-finding": {
            status: "done",
            validations: [{ domain: "code-quality", verdict: "pass" }],
            findings: [{ id: "F-1", status: "open" }],
          },
        },
      };
      const events: readonly Record<string, unknown>[] = [
        { kind: "plan-brainstormed" },
        { kind: "plan-reviewed", payload: { status: "approved" } },
      ];

      const findings = StateMachineAuditor.auditLifecycle(state, events);
      expect(findings.some((f) => f.code === "UNVALIDATED_TASK_COMPLETED")).toBe(true);
    });

    it("does not flag UNVALIDATED_TASK_COMPLETED when task is done with passing validation and resolved findings", () => {
      const state: Record<string, unknown> = {
        tasks: {
          "task-passed": {
            status: "done",
            validations: [
              { domain: "code-quality", verdict: "pass" },
              { domain: "system-design", verdict: "approved" },
            ],
            findings: [{ id: "F-1", status: "resolved" }],
          },
        },
      };
      const events: readonly Record<string, unknown>[] = [
        { kind: "plan-brainstormed" },
        { kind: "plan-reviewed", payload: { status: "approved" } },
      ];

      const findings = StateMachineAuditor.auditLifecycle(state, events);
      expect(findings.some((f) => f.code === "UNVALIDATED_TASK_COMPLETED")).toBe(false);
    });
  });

  describe("Combined lifecycle flow and multiple violations", () => {
    it("reports all 3 violations when full lifecycle was skipped", () => {
      const state: Record<string, unknown> = {
        tasks: {
          "task-wild": { status: "done", validations: [] },
        },
      };
      const events: readonly Record<string, unknown>[] = [];

      const findings = StateMachineAuditor.auditLifecycle(state, events);
      const codes = findings.map((f) => f.code);

      expect(codes).toContain("PLANNING_BRAINSTORMING_SKIPPED");
      expect(codes).toContain("PLAN_VALIDATION_SKIPPED");
      expect(codes).toContain("UNVALIDATED_TASK_COMPLETED");
    });

    it("returns zero findings when complete lifecycle was strictly followed", () => {
      const state: Record<string, unknown> = {
        plan_review: {
          status: "approved",
          validator_id: "validator-1",
        },
        tasks: {
          "task-1": {
            id: "task-1",
            status: "done",
            validations: [{ domain: "code-quality", verdict: "pass" }],
            findings: [],
          },
        },
      };
      const events: readonly Record<string, unknown>[] = [
        { kind: "plan-brainstormed", timestamp: "2026-08-23T00:00:00Z" },
        { kind: "plan-reviewed", payload: { status: "approved" } },
        { kind: "task-claimed", payload: { task_id: "task-1" } },
        { kind: "task-validated", payload: { task_id: "task-1", verdict: "pass" } },
        { kind: "task-done", payload: { task_id: "task-1" } },
      ];

      const findings = StateMachineAuditor.auditLifecycle(state, events);
      expect(findings).toHaveLength(0);

      const summary = StateMachineAuditor.summarizeLifecycle(findings);
      expect(summary.healthy).toBe(true);
      expect(summary.issues).toHaveLength(0);
    });
  });

  describe("StateMachineAuditor helper methods", () => {
    it("isPlanBrainstormed evaluates events correctly", () => {
      expect(StateMachineAuditor.isPlanBrainstormed([])).toBe(false);
      expect(StateMachineAuditor.isPlanBrainstormed([{ kind: "other" }])).toBe(false);
      expect(StateMachineAuditor.isPlanBrainstormed([{ kind: "plan-brainstormed" }])).toBe(true);
    });

    it("isPlanValidationApproved evaluates state and events correctly", () => {
      expect(StateMachineAuditor.isPlanValidationApproved({}, [])).toBe(false);
      expect(
        StateMachineAuditor.isPlanValidationApproved({ plan_review: { verdict: "approved" } }, []),
      ).toBe(true);
      expect(
        StateMachineAuditor.isPlanValidationApproved(
          { plan_validation: { status: "approved" } },
          [],
        ),
      ).toBe(true);
      expect(
        StateMachineAuditor.isPlanValidationApproved(
          { plan_validation: { verdict: "approved" } },
          [],
        ),
      ).toBe(true);
      expect(
        StateMachineAuditor.isPlanValidationApproved({}, [
          { kind: "plan-validated", status: "approved" },
        ]),
      ).toBe(true);
      expect(
        StateMachineAuditor.isPlanValidationApproved({}, [
          { kind: "plan-validated", verdict: "approved" },
        ]),
      ).toBe(true);
      expect(
        StateMachineAuditor.isPlanValidationApproved({}, [
          { kind: "plan-reviewed", payload: { status: "approved" } },
        ]),
      ).toBe(true);
      expect(
        StateMachineAuditor.isPlanValidationApproved({}, [
          { kind: "plan-reviewed", payload: { verdict: "approved" } },
        ]),
      ).toBe(true);
      expect(
        StateMachineAuditor.isPlanValidationApproved({ plan_review: { status: "rejected" } }, []),
      ).toBe(false);
      expect(
        StateMachineAuditor.isPlanValidationApproved(
          { plan_validation: { status: "rejected" } },
          [],
        ),
      ).toBe(false);
      expect(
        StateMachineAuditor.isPlanValidationApproved({}, [
          { kind: "plan-validated", status: "rejected" },
        ]),
      ).toBe(false);
      expect(
        StateMachineAuditor.isPlanValidationApproved({}, [
          { kind: "plan-reviewed", payload: { status: "rejected" } },
        ]),
      ).toBe(false);
    });

    it("isTaskValidationPassed handles various validation attempts correctly", () => {
      expect(StateMachineAuditor.isTaskValidationPassed({})).toBe(false);
      expect(StateMachineAuditor.isTaskValidationPassed({ validations: [] })).toBe(false);
      expect(
        StateMachineAuditor.isTaskValidationPassed({
          validations: [{ verdict: "pass" }],
        }),
      ).toBe(true);
      expect(
        StateMachineAuditor.isTaskValidationPassed({
          validations: [{ verdict: "pass" }, { verdict: "fail" }],
        }),
      ).toBe(false);
      expect(
        StateMachineAuditor.isTaskValidationPassed({
          validations: [{ verdict: "pass" }],
          findings: [{ status: "open" }],
        }),
      ).toBe(false);
    });

    it("summarizeLifecycle produces structured summary and issue strings", () => {
      const findings: readonly LifecycleFinding[] = [
        {
          code: "PLANNING_BRAINSTORMING_SKIPPED",
          severity: "critical",
          description: "Missing brainstorm",
        },
      ];

      const summary: LifecycleAuditSummary = StateMachineAuditor.summarizeLifecycle(findings);
      expect(summary.healthy).toBe(false);
      expect(summary.findings).toEqual(findings);
      expect(summary.issues).toContain(
        "lifecycle: [PLANNING_BRAINSTORMING_SKIPPED] Missing brainstorm",
      );
    });
  });

  describe("Doctor Integration with StateMachineAuditor", () => {
    const tempRoots: string[] = [];

    it("runDoctor includes lifecycle findings and lifecycle issues in report", async () => {
      const repo = await mkdtemp(join(tmpdir(), "harness-doc-lifecycle-"));
      tempRoots.push(repo);

      const runRoot = initRun(
        repo,
        "doc-lifecycle-run",
        new TextEncoder().encode("Lifecycle doctor prompt"),
        "file",
        true,
      );

      // Mutate state to have a done task with no validations and no brainstorm event
      transact(runRoot, "planner", "plan-applied", {}, (state) => {
        state.tasks = {
          "task-1": {
            id: "task-1",
            status: "done",
            requirement_ids: [],
            dependencies: [],
            write_scope: [],
            history: [],
            repair_round: 0,
            validations: [],
          },
        };
      });

      const report = await runDoctor(runRoot);
      expect(report.healthy).toBe(false);
      expect(Array.isArray(report.lifecycle_findings)).toBe(true);
      expect(Array.isArray(report.lifecycle_issues)).toBe(true);

      const findings = report.lifecycle_findings as LifecycleFinding[];
      expect(findings.some((f) => f.code === "PLANNING_BRAINSTORMING_SKIPPED")).toBe(true);
      expect(findings.some((f) => f.code === "PLAN_VALIDATION_SKIPPED")).toBe(true);
      expect(findings.some((f) => f.code === "UNVALIDATED_TASK_COMPLETED")).toBe(true);

      const issues = report.issues as string[];
      expect(issues.some((i) => i.includes("[UNVALIDATED_TASK_COMPLETED]"))).toBe(true);

      await Promise.all(tempRoots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
    });
  });

  describe("Static Invariants: Zero Any & Zero Compiler Suppressions", () => {
    it("state-machine-auditor.ts contains zero any and zero suppressions", () => {
      const srcPath = join(
        process.cwd(),
        "olt/scripts/src/reporting/doctor/state-machine-auditor.ts",
      );
      const srcContent = readFileSync(srcPath, "utf-8");

      const suppressionTokens = [
        "@" + "ts-ignore",
        "@" + "ts-expect-error",
        "@" + "ts-nocheck",
        "eslint" + "-disable",
      ];
      for (const token of suppressionTokens) {
        expect(srcContent.includes(token)).toBe(false);
      }

      const anyRegex = new RegExp(":\\s*" + "any\\b|\\bas\\s+" + "any\\b|<" + "any>", "g");
      expect(anyRegex.test(srcContent)).toBe(false);
    });

    it("state-machine-auditor.test.ts contains zero suppressions and zero untyped any", () => {
      const testPath = join(process.cwd(), "tests/unit/reporting/state-machine-auditor.test.ts");
      const testContent = readFileSync(testPath, "utf-8");

      const lines = testContent
        .split("\n")
        .filter(
          (l) =>
            !l.includes("suppressionTokens") &&
            !l.includes("anyRegex") &&
            !l.includes("Static Invariants"),
        );
      const filtered = lines.join("\n");

      const suppressionTokens = [
        "@" + "ts-ignore",
        "@" + "ts-expect-error",
        "@" + "ts-nocheck",
        "eslint" + "-disable",
      ];
      for (const token of suppressionTokens) {
        expect(filtered.includes(token)).toBe(false);
      }

      const anyRegex = new RegExp(":\\s*" + "any\\b|\\bas\\s+" + "any\\b|<" + "any>", "g");
      expect(anyRegex.test(filtered)).toBe(false);
    });
  });
});
