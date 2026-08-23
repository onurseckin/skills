import { describe, expect, test } from "bun:test";
import {
  assertRoleArtifactPresent,
  classifiesAsUiTask,
  gateReviewPayload,
  taskClassificationTexts,
} from "../../../../olt/scripts/src/workflow/review/role-evidence.ts";
import type { TaskRecord, WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    status: "validating",
    requirement_ids: [],
    write_scope: ["src/types/dsa.ts"],
    dependencies: [],
    attempts: [],
    history: [],
    repair_round: 0,
    ...overrides,
  };
}

function stateWithBareArrayRequirements(requirements: Record<string, unknown>[]): WorkflowState {
  return {
    tasks: {},
    requirements: requirements as unknown as WorkflowState["requirements"],
    gates: [],
    commands: {},
    orphan_evidence: [],
  } as unknown as WorkflowState;
}

/**
 * `graph/project-plan.ts` assigns the WHOLE compiled requirements document to `state.requirements`
 * — `{schema, version, requirements: [...]}` — not the bare array the field's own declared type
 * (`RequirementRuntime[]`) implies. A real `plan:compile` run persists exactly this shape; a hand-
 * built test fixture typically does not. Both must classify correctly.
 */
function stateWithDocumentRequirements(requirements: Record<string, unknown>[]): WorkflowState {
  return {
    tasks: {},
    requirements: {
      schema: "harness.requirements",
      version: 1,
      requirements,
    } as unknown as WorkflowState["requirements"],
    gates: [],
    commands: {},
    orphan_evidence: [],
  } as unknown as WorkflowState;
}

describe("taskClassificationTexts", () => {
  test("pulls the task's own label", () => {
    const t = task({ label: "Button responsive polish" } as Partial<TaskRecord>);
    const texts = taskClassificationTexts(stateWithBareArrayRequirements([]), t);
    expect(texts).toContain("Button responsive polish");
  });

  test("pulls instruction, implementation, source_excerpt and acceptance criteria off requirements the task cites", () => {
    const t = task({ requirement_ids: ["req-ui"] });
    const requirements = [
      {
        id: "req-ui",
        instruction: "Dual-channel UI validation",
        implementation: "Implement requirements for dsa types within scope src/types/dsa.ts",
        source_excerpt: "Capture a screenshot proving the layout is responsive",
        acceptance: [{ id: "crit-1", criterion: "Verify WCAG contrast on the button" }],
      },
    ];
    const texts = taskClassificationTexts(stateWithBareArrayRequirements(requirements), t);
    expect(texts).toContain("Dual-channel UI validation");
    expect(texts).toContain("Capture a screenshot proving the layout is responsive");
    expect(texts).toContain("Verify WCAG contrast on the button");
  });

  test("reads the same fields when state.requirements is the whole compiled document, not a bare array", () => {
    const t = task({ requirement_ids: ["req-ui"] });
    const requirements = [{ id: "req-ui", instruction: "Ship the dual-channel screenshot proof" }];
    const texts = taskClassificationTexts(stateWithDocumentRequirements(requirements), t);
    expect(texts).toContain("Ship the dual-channel screenshot proof");
  });

  test("ignores requirements the task does not cite, and tolerates a missing label or requirements list", () => {
    const t = task({ requirement_ids: ["req-other"] });
    const requirements = [{ id: "req-ui", instruction: "screenshot this UI" }];
    expect(taskClassificationTexts(stateWithBareArrayRequirements(requirements), t)).toEqual([]);
    expect(taskClassificationTexts(stateWithBareArrayRequirements([]), task())).toEqual([]);
  });
});

describe("classifiesAsUiTask", () => {
  test("trusts the analyzer's own signal when it says yes, even with no matching requirement text", () => {
    const t = task({ write_scope: ["src/backend/queue.ts"] });
    expect(classifiesAsUiTask(stateWithBareArrayRequirements([]), t, true)).toBe(true);
  });

  // QUEUE-5's own worked example: task-dual-channel-ui-validation declared write_scope
  // ["src/types/dsa.ts"] — no UI extension, no UI directory marker — so the analyzer's own
  // write_scope/taskFiles classifier said "not UI" and its dual-channel mandate never fired. The
  // task's own requirement text says otherwise, and this is the signal that must catch it.
  test("classifies as UI from requirement text alone when the analyzer's write_scope signal misses it", () => {
    const t = task({ write_scope: ["src/types/dsa.ts"], requirement_ids: ["req-dsa"] });
    const requirements = [
      { id: "req-dsa", instruction: "task-dual-channel-ui-validation: verify the UI screenshot" },
    ];
    expect(classifiesAsUiTask(stateWithBareArrayRequirements(requirements), t, false)).toBe(true);
  });

  test("is false when neither signal fires", () => {
    const t = task({ write_scope: ["src/backend/queue.ts"], requirement_ids: ["req-be"] });
    const requirements = [{ id: "req-be", instruction: "Fix the retry backoff" }];
    expect(classifiesAsUiTask(stateWithBareArrayRequirements(requirements), t, false)).toBe(false);
  });
});

describe("assertRoleArtifactPresent", () => {
  test("does nothing when the domain does not apply, artifact or not", () => {
    expect(() => assertRoleArtifactPresent("task-1", false, { hasArtifact: false })).not.toThrow();
  });

  test("does nothing when the domain applies and an artifact is on record", () => {
    expect(() => assertRoleArtifactPresent("task-1", true, { hasArtifact: true })).not.toThrow();
  });

  // The widening QUEUE-5 asked for: this refusal does not take a verdict parameter at all, so a
  // caller cannot satisfy it only on the pass path — it is the same assertion regardless of
  // whether the caller is about to record a pass or a reject.
  test("refuses when the domain applies and no artifact is on record", () => {
    expect(() => assertRoleArtifactPresent("task-1", true, { hasArtifact: false })).toThrow(
      /captured artifact evidence/,
    );
  });

  test("the refusal names a concrete next command in its fix field", () => {
    try {
      assertRoleArtifactPresent("task-1", true, { hasArtifact: false });
      throw new Error("expected assertRoleArtifactPresent to throw");
    } catch (error) {
      expect(String((error as { fix?: string }).fix)).toContain("task:review");
    }
  });
});

describe("gateReviewPayload & review payload gating", () => {
  const mock4TierManifest = {
    schema: "companion.manifest.v1",
    screenId: "dashboard",
    viewport: "desktop",
    criteria: Array.from({ length: 40 }, (_, i) => ({
      id: `CRIT-${i}`,
      pillar:
        i % 4 === 0 ? "mechanical" : i % 4 === 1 ? "cognitive" : i % 4 === 2 ? "product" : "ux",
      passed: true,
      details: "Detailed diagnostic measurement and evaluation of component behavior",
      evidence: "Quantitative measurements: 120ms transitions, 25 inspected nodes, 0 layout shifts",
    })),
    cognitiveAnalysis: {
      questions: Array.from({ length: 20 }, (_, i) => ({
        id: `Q-${i}`,
        question: `Cognitive question ${i} regarding Norman recovery and Fitts law`,
        passed: true,
        observation: "User ergonomics and mental models validated with clear error recovery paths",
        evidence: "120ms animated transitions, 48px touch targets, 0 orphan elements",
      })),
    },
    domPhysics: {
      gravity: 9.8,
      nodes: Array.from({ length: 50 }, (_, i) => ({ id: `node-${i}`, mass: 1, velocity: [0, 0] })),
    },
    layoutShifts: Array.from({ length: 30 }, (_, i) => ({
      timestamp: i * 100,
      cls: 0.001,
      elements: [`#elem-${i}`],
    })),
  };

  const mockVisualReport = {
    schema: "visual.metrics.v1",
    viewports: [
      {
        viewport: "desktop",
        width: 1280,
        height: 800,
        domNodes: Array.from({ length: 100 }, (_, i) => ({
          id: `el-${i}`,
          bounds: [0, 0, 100, 100],
        })),
      },
    ],
  };

  test("preserves 4-tier companion manifests and visual artifacts when isUiTask is true", () => {
    const rawReport = {
      task_id: "task-ui-01",
      validator: "val-1",
      token_digest: "digest-123",
      status: "pass",
      verdict: "pass",
      summary: "Verified UI card component across viewports",
      checks: ["C-1", "C-2"],
      findings: [],
      companion_manifests: [mock4TierManifest],
      visual_report: mockVisualReport,
      screenshot_records: [{ name: "card.png", bytes: 2048, path: "/capsules/card.png" }],
      screenshots: ["/capsules/card.png"],
      dual_channel_audit: { isUiTask: true, passed: true, mode: "screenshot_gap_filled" },
    };

    const gated = gateReviewPayload("task-ui-01", true, rawReport);
    expect(gated.companion_manifests).toBeDefined();
    expect((gated.companion_manifests as unknown[]).length).toBe(1);
    expect(gated.visual_report).toBeDefined();
    expect(gated.screenshot_records).toBeDefined();
    expect(gated.screenshots).toBeDefined();
  });

  test("prunes companion manifests, visual reports, and cognitive payload trees when isUiTask is false", () => {
    const rawHeavyReport = {
      task_id: "task-backend-01",
      validator: "val-1",
      token_digest: "digest-123",
      status: "pass",
      verdict: "pass",
      summary: "Implemented user authentication and token verification logic",
      created_at: "2026-08-22T09:00:00.000Z",
      checks: ["C-1", "C-2"],
      findings: [],
      task_scope_findings: [],
      checklist_coverage: { applicable: false, reason: "No standing checklist applies" },
      resolved_findings: [],
      unblocked: ["task-backend-02"],
      task: { id: "task-backend-01", status: "validated", write_scope: ["src/auth.ts"] },
      companion_manifests: [mock4TierManifest, mock4TierManifest],
      visual_report: mockVisualReport,
      screenshot_records: [],
      screenshots: [],
      dual_channel_audit: {
        isUiTask: false,
        passed: true,
        mode: "non_ui_skipped",
        proofs: [],
        findings: [],
      },
    };

    // Serialized raw heavy report size is ~82+ KB
    const heavyJson = JSON.stringify(rawHeavyReport, null, 2);
    const heavyBytes = Buffer.byteLength(heavyJson, "utf-8");
    expect(heavyBytes).toBeGreaterThan(20000); // 20+ KB

    const gated = gateReviewPayload("task-backend-01", false, rawHeavyReport);

    // Pruned fields
    expect(gated.companion_manifests).toBeUndefined();
    expect(gated.visual_report).toBeUndefined();
    expect(gated.screenshot_records).toBeUndefined();
    expect(gated.screenshots).toBeUndefined();

    // Serialized gated review packet is strictly under 2 KB (2048 bytes)
    const gatedJson = JSON.stringify(gated, null, 2);
    const gatedBytes = Buffer.byteLength(gatedJson, "utf-8");
    expect(gatedBytes).toBeLessThan(2048);
  });
});
