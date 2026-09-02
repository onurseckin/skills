import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestPushbacks } from "../../../olt/scripts/src/mind/feedback/pushbacks/ingest.ts";
import type { FeedbackItem } from "../../../olt/scripts/src/mind/feedback/queue/types.ts";

describe("Pushbacks Ingest Coverage Suite", () => {
  let tempDir: string;
  let markdownPath: string;
  let queuePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pushbacks-ingest-test-"));
    markdownPath = join(tempDir, "pushbacks.md");
    queuePath = join(tempDir, "feedback-queue.jsonl");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("handles missing markdown and empty feedback queue cleanly", () => {
    const report = ingestPushbacks(markdownPath, queuePath);
    expect(report.total_pushbacks).toBe(0);
    expect(report.total_feedback_items).toBe(0);
    expect(report.candidate_proposals).toEqual([]);
    expect(report.by_category.code_defect).toBe(0);
    expect(report.generated_at).toBeDefined();

    // Also verify when called without parameters
    const defaultReport = ingestPushbacks(
      join(tempDir, "non-existent.md"),
      join(tempDir, "non-existent-queue.jsonl"),
    );
    expect(defaultReport.records).toEqual([]);
  });

  it("processes parsed pushback records across defect categories and goal assignments", () => {
    const mdContent = `
# Pushback 1: Test Pushback Section
- **Pushback Item 1**: Buffer overflow in worker parser
  - Issue: Memory leak during parse
  - Resolution: Clean up buffers after execution
- **Pushback Item 2**: Architecture boundary crossed
  - Issue: Direct coupling between mind and driver
  - Resolution: Use contract facade
- **Pushback Item 3**: Logic reasoning error in planner
  - Issue: Incorrect plan dependency graph
  - Resolution: Recompute topological order
- **4**: Documentation typo in setup guide
  - Issue: Missing flag description in docs
  - Resolution: Update README.md
`;
    writeFileSync(markdownPath, mdContent);

    const report = ingestPushbacks(markdownPath, queuePath);
    expect(report.total_pushbacks).toBe(1);
    expect(report.candidate_proposals.length).toBeGreaterThan(0);

    const proposals = report.candidate_proposals;
    const boundaryProp = proposals.find((p) => p.rationale.includes("Direct coupling"));
    if (boundaryProp) {
      expect(boundaryProp.charter_goal_ids).toEqual(["G2"]);
      expect(boundaryProp.status).toBe("needs_authority");
      expect(boundaryProp.evidence_class).toBe("user_pushback");
    }

    const reasoningProp = proposals.find((p) => p.rationale.includes("dependency graph"));
    if (reasoningProp) {
      expect(reasoningProp.charter_goal_ids).toEqual(["G1"]);
    }

    const defectProp = proposals.find((p) => p.kind === "defect");
    if (defectProp) {
      expect(defectProp.charter_goal_ids).toEqual(["G1", "G2"]);
    }
  });

  it("ingests feedback queue items with PENDING, ADMITTED, and COMPLETED statuses", () => {
    const itemPending: FeedbackItem = {
      id: "fb-p1",
      title: "Pending Contract Violation",
      content: "Contract breached by agent",
      priority: "CRITICAL_USER_FEEDBACK",
      category: "AGENT_CONTRACTS",
      status: "PENDING",
      timestamp: "2026-09-01T10:00:00.000Z",
    };
    const itemAdmitted: FeedbackItem = {
      id: "fb-a1",
      candidate_id: "cand-admitted-custom",
      title: "Admitted Bug Fix",
      content: "Engine crash fix required",
      priority: "HIGH_ARCHITECTURAL_FEATURE",
      category: "CORE_ENGINE",
      status: "ADMITTED",
      timestamp: "2026-09-01T11:00:00.000Z",
    };
    const itemCompleted: FeedbackItem = {
      id: "fb-c1",
      title: "Resolved Doc Item",
      content: "Docs updated already",
      priority: "LOW",
      category: "DOCUMENTATION",
      status: "COMPLETED",
      timestamp: "2026-09-01T12:00:00.000Z",
    };

    writeFileSync(
      queuePath,
      `${JSON.stringify(itemPending)}\n${JSON.stringify(itemAdmitted)}\n${JSON.stringify(itemCompleted)}\n`,
    );

    const report = ingestPushbacks(markdownPath, queuePath);
    expect(report.total_feedback_items).toBe(3);
    // Only PENDING and ADMITTED items produce candidate proposals (2 proposals)
    expect(report.candidate_proposals.length).toBe(2);

    const pendingProp = report.candidate_proposals.find((p) => p.id === "cand-feedback-fb-p1");
    expect(pendingProp).toBeDefined();
    expect(pendingProp?.status).toBe("needs_authority");
    expect(pendingProp?.charter_goal_ids).toEqual(["G2"]); // AGENT_CONTRACTS maps to boundary_violation -> G2

    const admittedProp = report.candidate_proposals.find((p) => p.id === "cand-admitted-custom");
    expect(admittedProp).toBeDefined();
    expect(admittedProp?.status).toBe("admitted");
    expect(admittedProp?.kind).toBe("defect"); // CORE_ENGINE maps to code_defect -> defect
    expect(admittedProp?.charter_goal_ids).toEqual(["G1"]);

    expect(report.by_category.boundary_violation).toBe(1);
    expect(report.by_category.code_defect).toBe(1);
    expect(report.by_category.model_reasoning_error).toBe(1);
    expect(report.by_category.documentation).toBe(0);
  });
});
