import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  buildUltraLeanPacket,
  calculatePacketSize,
  createMetadataSlice,
  DEFAULT_BRIEF_MAX_LINES,
  DEFAULT_PACKET_BYTE_BUDGET,
  enforcePacketBudget,
  formatLeanMarkdownBrief,
  parseMarkdownSections,
  sliceAuthoritativeContext,
  sliceEventStream,
  sliceEvidenceLog,
  sliceGraphNeighborhood,
  sliceMarkdownSections,
  sliceRepositoryDiff,
  sliceTaskContract,
} from "../../../../olt/scripts/src/packets/packet-slicing.ts";
import { buildPacket } from "../../../../olt/scripts/src/packets/render-packet.ts";
import { evidenceSchema } from "../../../../olt/scripts/src/packets/evidence-schema.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { at, TestPort, workflowState } from "../../../workflow/test-port.ts";
import { inspectionContext } from "./inspection-fixture.ts";
import type { TaskRecord, WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";
import type { JsonObject } from "../../../../olt/scripts/src/core/contracts/index.ts";

const clock = at("2026-08-13T12:00:00.000Z");
const commonBytes = new TextEncoder().encode("Canonical common instructions.\n");
const commonSha256 = createHash("sha256").update(commonBytes).digest("hex");

function createFixtureState() {
  const port = new TestPort(workflowState());
  const claim = claimTask(port, "T-1", "worker-1", "implementer", { clock });
  return {
    state: claim.state,
    token: claim.token,
  };
}


describe("Ultra-Lean Packet - Rendering & Formats", () => {
  describe("Evidence Log Slicing", () => {
    test("returns compact excerpt with head and tail for long logs and preserves digest", () => {
      const lines = Array.from(
        { length: 100 },
        (_, i) => `Output line ${i}: test step execution log`,
      );
      const fullLog = lines.join("\n");

      const excerpt = sliceEvidenceLog(fullLog, {
        maxLines: 10,
        commandId: "C-CMD-101",
        logPath: "commands/C-CMD-101/stdout.log",
      });

      expect(excerpt.commandId).toBe("C-CMD-101");
      expect(excerpt.isTruncated).toBe(true);
      expect(excerpt.originalLineCount).toBe(100);
      expect(excerpt.truncatedLinesCount).toBe(90);
      expect(excerpt.headLines.length).toBe(5);
      expect(excerpt.tailLines.length).toBe(5);
      expect(excerpt.formattedExcerpt).toContain("Output line 0");
      expect(excerpt.formattedExcerpt).toContain("Output line 99");
      expect(excerpt.formattedExcerpt).toContain("omitted 90 lines");
      expect(excerpt.formattedExcerpt).toContain("commands/C-CMD-101/stdout.log");
      expect(excerpt.fullLogSha256).toMatch(/^[0-9a-f]{64}$/);
    });

    test("leaves small logs untruncated", () => {
      const shortLog = "Line 1: pass\nLine 2: done";
      const excerpt = sliceEvidenceLog(shortLog, { maxLines: 10 });
      expect(excerpt.isTruncated).toBe(false);
      expect(excerpt.formattedExcerpt).toBe(shortLog);
    });
  });

  describe("Event Stream Slicing", () => {
    test("filters events by task ID, type, and pagination", () => {
      const events: JsonObject[] = [
        {
          event_id: "evt-1",
          task_id: "T-1",
          type: "task:leased",
          timestamp: "2026-08-13T12:00:00Z",
        },
        {
          event_id: "evt-2",
          task_id: "T-2",
          type: "task:leased",
          timestamp: "2026-08-13T12:01:00Z",
        },
        {
          event_id: "evt-3",
          task_id: "T-1",
          type: "task:submitted",
          timestamp: "2026-08-13T12:05:00Z",
        },
        {
          event_id: "evt-4",
          task_id: "T-1",
          type: "task:validated",
          timestamp: "2026-08-13T12:10:00Z",
        },
      ];

      const forTask1 = sliceEventStream(events, { taskId: "T-1", limit: 2 });
      expect(forTask1.total).toBe(3);
      expect(forTask1.events.length).toBe(2);
      expect(forTask1.hasMore).toBe(true);
      expect(forTask1.events[0]!.event_id).toBe("evt-1");
      expect(forTask1.events[1]!.event_id).toBe("evt-3");

      const typeFilter = sliceEventStream(events, { types: ["task:leased"] });
      expect(typeFilter.total).toBe(2);
      expect(typeFilter.events.map((e) => e.event_id)).toEqual(["evt-1", "evt-2"]);
    });
  });

  describe("Repository Diff Slicing", () => {
    test("filters diff blocks by write scope", () => {
      const multiFileDiff = [
        "diff --git a/src/feature.ts b/src/feature.ts",
        "--- a/src/feature.ts",
        "+++ b/src/feature.ts",
        "@@ -1,3 +1,4 @@",
        "+export const feature = true;",
        "diff --git a/src/unrelated.ts b/src/unrelated.ts",
        "--- a/src/unrelated.ts",
        "+++ b/src/unrelated.ts",
        "@@ -1,3 +1,4 @@",
        "+export const noise = true;",
      ].join("\n");

      const sliced = sliceRepositoryDiff(multiFileDiff, ["src/feature.ts"]);
      expect(sliced).toContain("src/feature.ts");
      expect(sliced).not.toContain("src/unrelated.ts");
    });
  });

  describe("On-Demand CLI Metadata Slicing Handler", () => {
    test("creates structured metadata slice with cryptographic digest for tasks", () => {
      const state: JsonObject = {
        tasks: {
          "T-1": {
            id: "T-1",
            status: "ready",
            write_scope: ["src/a.ts"],
            requirement_ids: ["R-1"],
            dependencies: [],
            repair_round: 0,
          },
          "T-2": {
            id: "T-2",
            status: "ready",
            write_scope: ["src/b.ts"],
            requirement_ids: ["R-2"],
            dependencies: ["T-1"],
            repair_round: 0,
          },
        },
      };

      const result = createMetadataSlice(state, {
        runId: "run-slice-1",
        target: "task",
        taskId: "T-1",
      });

      expect(result.schema).toBe("harness.metadata-slice.v1");
      expect(result.runId).toBe("run-slice-1");
      expect(result.target).toBe("task");
      expect(result.totalCount).toBe(1);
      expect(result.returnedCount).toBe(1);
      expect(result.sliceHash).toMatch(/^[0-9a-f]{64}$/);
      expect((result.data as JsonObject).id).toBe("T-1");
    });

    test("creates graph metadata slice with neighborhood", () => {
      const state: JsonObject = {
        graph: {
          nodes: [{ id: "T-1" }, { id: "T-2" }],
          edges: [{ from: "T-1", to: "T-2" }],
        },
      };

      const result = createMetadataSlice(state, {
        runId: "run-slice-2",
        target: "graph",
        taskId: "T-1",
      });

      expect(result.target).toBe("graph");
      expect(result.sliceHash).toMatch(/^[0-9a-f]{64}$/);
      const graphData = result.data as JsonObject;
      expect(graphData.focalTaskId).toBe("T-1");
    });
  });

  describe("Lean Markdown Brief Formatter", () => {
    test("formats compact brief <= 30 lines with task details, lease token, and CLI queries", () => {
      const brief = formatLeanMarkdownBrief({
        runId: "run-lean-1",
        agentId: "implementer_task-p37",
        role: "implementer",
        token: "TEST_LEASE_TOKEN_123",
        leaseDurationMinutes: 20,
        task: {
          id: "task-p37-packet-slicing",
          status: "leased",
          write_scope: [
            "src/packets/packet-slicing.ts",
            "tests/packets/payloads/slicing/ultra-lean-packet-slicing.test.ts",
          ],
          requirement_ids: ["R-SLICE-1"],
          dependencies: [],
          gate: "bun test tests/packets/payloads/slicing/ultra-lean-packet-slicing.test.ts",
          repair_round: 0,
          attempt_count: 0,
        },
      });

      const lines = brief.split("\n");
      expect(lines.length).toBeLessThanOrEqual(DEFAULT_BRIEF_MAX_LINES);
      expect(brief).toContain("### Task Leased: task-p37-packet-slicing");
      expect(brief).toContain("- **Agent**: `implementer_task-p37`");
      expect(brief).toContain("- **Role**: `implementer`");
      expect(brief).toContain("- **Lease Token**: `TEST_LEASE_TOKEN_123`");
      expect(brief).toContain(
        "- **Assigned Write Scope**: `src/packets/packet-slicing.ts`, `tests/packets/payloads/slicing/ultra-lean-packet-slicing.test.ts`",
      );
      expect(brief).toContain("- **Gate**: `bun test tests/packets/payloads/slicing/ultra-lean-packet-slicing.test.ts`");
      expect(brief).toContain("⚡ On-Demand Capsule Memory Queries:");
      expect(brief).toContain(
        "bun harness.ts report:task --run .capsules/run-lean-1 --task task-p37-packet-slicing",
      );
    });
  });

});
