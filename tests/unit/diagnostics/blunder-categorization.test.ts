import { describe, expect, test } from "bun:test";
import {
  categorizeBlunder,
  type BlunderCategory,
  type BlunderEntry,
} from "../../../orchestrating-long-tasks/scripts/src/mind/blunders.ts";

describe("Diagnostics Blunder Categorization Engine", () => {
  describe("Explicit Category Preservation & Aliasing", () => {
    test("preserves valid explicit canonical categories verbatim", () => {
      expect(categorizeBlunder({ category: "boundary_violation" })).toBe("boundary_violation");
      expect(categorizeBlunder({ category: "model_reasoning_error" })).toBe("model_reasoning_error");
      expect(categorizeBlunder({ category: "code_defect" })).toBe("code_defect");
    });

    test("handles case-insensitive canonical categories", () => {
      expect(categorizeBlunder({ category: "BOUNDARY_VIOLATION" })).toBe("boundary_violation");
      expect(categorizeBlunder({ category: "Model_Reasoning_Error" })).toBe("model_reasoning_error");
      expect(categorizeBlunder({ category: "CODE_DEFECT" })).toBe("code_defect");
    });

    test("maps role_confusion alias strictly to boundary_violation", () => {
      expect(categorizeBlunder({ category: "role_confusion" })).toBe("boundary_violation");
      expect(categorizeBlunder({ category: "ROLE_CONFUSION" })).toBe("boundary_violation");
      expect(categorizeBlunder({ type: "role_confusion_detected" })).toBe("boundary_violation");
    });
  });

  describe("Boundary Violation Categorization", () => {
    test("identifies boundary violations from type keywords", () => {
      const boundaryTypes = [
        "main_thread_direct_execution",
        "main_thread_boundary_violation",
        "role_escalation",
        "unauthorized_mutation",
        "restraint_violation",
        "thread_authority_breach",
        "tier_escaped",
        "permission_denied",
        "sandbox_escape",
        "role_amnesia",
        "orch_role_leak",
        "role_leak",
        "identity_and_role_amnesia",
      ];

      for (const type of boundaryTypes) {
        expect(categorizeBlunder({ type })).toBe("boundary_violation");
      }
    });

    test("identifies boundary violations from ID keywords", () => {
      expect(categorizeBlunder({ id: "blunder-20260821-08-orch-role-leak" })).toBe("boundary_violation");
      expect(categorizeBlunder({ id: "blunder-20260821-10-identity-and-role-amnesia" })).toBe("boundary_violation");
      expect(categorizeBlunder({ id: "blunder-main-thread-spillover" })).toBe("boundary_violation");
    });

    test("identifies boundary violations from observation and remediation phrases", () => {
      const phrases = [
        {
          observation: "Execution detected on interactive main conversation thread without subagent boundary delegation.",
          remediation: "Dispatch Tier 2 Background Coordinators or Tier 3 Implementers.",
        },
        {
          observation: "Tier 1 Orchestrator attempted direct file edits and test runs instead of delegating.",
          remediation: "Enforce strict non-implementation boundaries for Orchestrator.",
        },
        {
          observation: "Agents failed to execute whoami to self-identify their execution tier.",
          remediation: "Mandate whoami self-identification on startup for all tiers.",
        },
        {
          observation: "Tier 0 human shell attempted automated unauthorized mutation.",
          remediation: "Enforce thread restraint active.",
        },
        {
          observation: "Subagent escaped assigned write scope boundaries.",
          remediation: "Confine write scope strictly.",
        },
      ];

      for (const phrase of phrases) {
        expect(categorizeBlunder(phrase)).toBe("boundary_violation");
      }
    });
  });

  describe("Model Reasoning Error Categorization", () => {
    test("identifies model reasoning errors from type keywords", () => {
      const reasoningTypes = [
        "reasoning_error",
        "hallucination",
        "hallucination_detected",
        "logic_inconsistency",
        "invalid_assumption",
        "plan_drift",
        "intent_drift",
        "instruction_drift",
        "self_critique_failure",
        "context_loss",
        "wrong_premise",
        "passive_inertia",
        "plan_revision_paralysis",
        "idle_death",
        "self_termination",
      ];

      for (const type of reasoningTypes) {
        expect(categorizeBlunder({ type })).toBe("model_reasoning_error");
      }
    });

    test("identifies model reasoning errors from ID keywords", () => {
      expect(categorizeBlunder({ id: "blunder-20260821-09-mind-plan-revision-paralysis" })).toBe("model_reasoning_error");
      expect(categorizeBlunder({ id: "blunder-hallucination-api-key" })).toBe("model_reasoning_error");
      expect(categorizeBlunder({ id: "blunder-intent-drift-task-3" })).toBe("model_reasoning_error");
      expect(categorizeBlunder({ id: "blunder-idle-death-loop" })).toBe("model_reasoning_error");
    });

    test("identifies model reasoning errors from observation and remediation text", () => {
      const cases = [
        {
          observation: "Tier 0 Mind exhibited passive inertia: failed to trigger plan revision tools when work bottlenecked.",
          remediation: "Mind must actively use plan revision mechanisms rather than passive sleep loops.",
        },
        {
          observation: "Model produced hallucination of non-existent API endpoints.",
          remediation: "Verify schema definitions against source docs.",
        },
        {
          observation: "Model made an incorrect premise regarding state file structure, leading to illogical branch choice.",
          remediation: "Re-read state schema before reasoning.",
        },
        {
          observation: "Agent produced an illogical decision contradicting requirements due to context loss.",
          remediation: "Perform self-audit before emitting final response.",
        },
        {
          observation: "Mind system executed pulse-close and fell into sleep loop, violating perpetual consciousness invariant.",
          remediation: "Ensure non-terminating autonomic loop rollover in recycler.ts.",
        },
      ];

      for (const c of cases) {
        expect(categorizeBlunder(c)).toBe("model_reasoning_error");
      }
    });
  });

  describe("Code Defect Categorization", () => {
    test("defaults all technical and syntax defects to code_defect", () => {
      const codeTypes = [
        "syntax_error",
        "type_error",
        "test_failure",
        "failing_gate",
        "runtime_error",
        "lint_failure",
        "build_failure",
        "null_pointer_exception",
        "unhandled_promise_rejection",
      ];

      for (const type of codeTypes) {
        expect(categorizeBlunder({ type })).toBe("code_defect");
      }
    });

    test("defaults empty or unrecognized records to code_defect", () => {
      expect(categorizeBlunder({})).toBe("code_defect");
      expect(categorizeBlunder({ type: "generic_issue" })).toBe("code_defect");
      expect(categorizeBlunder({ observation: "File not found at /tmp/foo.txt" })).toBe("code_defect");
    });
  });

  describe("Precedence & Disambiguation", () => {
    test("explicit valid category overrides contradictory text", () => {
      const entry = {
        category: "code_defect",
        type: "main_thread_direct_execution",
        observation: "Main thread executed direct write",
      };
      expect(categorizeBlunder(entry)).toBe("code_defect");

      const entry2 = {
        category: "boundary_violation",
        type: "syntax_error",
        observation: "Syntax error on line 42",
      };
      expect(categorizeBlunder(entry2)).toBe("boundary_violation");
    });

    test("boundary violation takes precedence over reasoning error in ambiguous multi-signal blunders", () => {
      const ambiguousEntry = {
        type: "agent_failure",
        observation: "Agent hallucinated permission and attempted main thread direct write without subagent delegation",
        remediation: "Enforce thread restraint and role boundaries",
      };
      expect(categorizeBlunder(ambiguousEntry)).toBe("boundary_violation");
    });
  });
});
