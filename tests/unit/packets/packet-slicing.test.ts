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
} from "../../../orchestrating-long-tasks/scripts/src/packets/packet-slicing.ts";
import { buildPacket } from "../../../orchestrating-long-tasks/scripts/src/packets/render-packet.ts";
import { evidenceSchema } from "../../../orchestrating-long-tasks/scripts/src/packets/evidence-schema.ts";
import { claimTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import { at, TestPort, workflowState } from "../workflow/test-port.ts";
import { inspectionContext } from "./inspection-fixture.ts";
import type {
  TaskRecord,
  WorkflowState,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import type { JsonObject } from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";

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

describe("Ultra-Lean Packet Architecture & Metadata Slicing", () => {
  describe("Packet Size Metrics & Budget Enforcement", () => {
    test("calculates byte size, line count, section count, and token estimates", () => {
      const sampleMarkdown = [
        "# Implementer packet",
        "",
        "## Identity",
        "Run: run-1",
        "Task: T-1",
        "",
        "## Task contract",
        "```json",
        JSON.stringify({ id: "T-1", write_scope: ["src/app.ts"] }, null, 2),
        "```",
      ].join("\n");

      const metrics = calculatePacketSize(sampleMarkdown);
      expect(metrics.byteSize).toBe(Buffer.from(sampleMarkdown, "utf-8").byteLength);
      expect(metrics.lineCount).toBe(sampleMarkdown.split("\n").length);
      expect(metrics.sectionCount).toBeGreaterThanOrEqual(2);
      expect(metrics.estimatedTokens).toBe(Math.ceil(metrics.byteSize / 4));
      expect(metrics.isLean).toBe(true);
      expect(metrics.sectionBreakdown).toHaveProperty("Identity");
      expect(metrics.sectionBreakdown).toHaveProperty("Task contract");
    });

    test("enforcePacketBudget validates compliance against strict budget", () => {
      const smallPacket = {
        markdown: "# Small Lean Packet\n## Summary\nEverything fits easily.",
        metadata: { schema: "harness.packet", version: 1 },
      };

      const passResult = enforcePacketBudget(smallPacket, 5000);
      expect(passResult.compliant).toBe(true);
      expect(passResult.violationReason).toBeUndefined();

      const largePacket = {
        markdown: `# Large Packet\n## Huge Section\n${"x".repeat(10000)}`,
        metadata: { schema: "harness.packet", version: 1 },
      };

      const failResult = enforcePacketBudget(largePacket, 5000);
      expect(failResult.compliant).toBe(false);
      expect(failResult.violationReason).toContain("exceeds maximum budget of 5000 bytes");
    });
  });

  describe("Markdown Parsing & Section Slicing", () => {
    test("parseMarkdownSections decomposes markdown into structural headings and contents", () => {
      const md = [
        "# Main Title",
        "Preamble text",
        "## Section A",
        "Body A line 1",
        "Body A line 2",
        "### Subsection A.1",
        "Sub body",
        "## Section B",
        "Body B",
      ].join("\n");

      const sections = parseMarkdownSections(md);
      expect(sections.length).toBe(4);
      expect(sections[0]!.title).toBe("Main Title");
      expect(sections[0]!.content).toBe("Preamble text");
      expect(sections[1]!.title).toBe("Section A");
      expect(sections[2]!.title).toBe("Subsection A.1");
      expect(sections[3]!.title).toBe("Section B");
    });

    test("sliceMarkdownSections filters included and excluded sections", () => {
      const md = [
        "# Root",
        "## Included Section",
        "Important details",
        "## Excluded Section",
        "Bloated noise",
        "## Common instructions",
        "Invariant rules",
      ].join("\n");

      const filtered = sliceMarkdownSections(md, {
        excludeSections: ["Excluded Section"],
      });
      expect(filtered).toContain("Included Section");
      expect(filtered).toContain("Common instructions");
      expect(filtered).not.toContain("Excluded Section");
      expect(filtered).not.toContain("Bloated noise");

      const onlyIncluded = sliceMarkdownSections(md, {
        includeSections: ["Included Section"],
      });
      expect(onlyIncluded).toContain("Included Section");
      expect(onlyIncluded).not.toContain("Common instructions");
    });

    test("sliceMarkdownSections truncates large code payloads and caps total bytes", () => {
      const giantJson = JSON.stringify(
        Array.from({ length: 100 }, (_, i) => ({ item: i })),
        null,
        2,
      );
      const md = ["# Header", "## Massive JSON Section", "```json", giantJson, "```"].join("\n");

      const sliced = sliceMarkdownSections(md, {
        maxSectionBytes: 500,
        maxTotalBytes: 2000,
      });

      expect(sliced).toContain("// ... Payload sliced");
      expect(sliced).toContain("Query full data on demand via Harness CLI");
    });
  });

  describe("Authoritative Context Slicing", () => {
    test("sliceAuthoritativeContext applies field mask and truncates oversized arrays", () => {
      const fullContext: JsonObject = {
        task_contract: { id: "T-1" },
        mapped_requirements: [{ id: "R-1" }],
        large_collection: Array.from({ length: 50 }, (_, i) => ({ id: `elem-${i}` })),
        unmasked_field: "should be omitted if mask specified",
      };

      const sliced = sliceAuthoritativeContext(fullContext, {
        fieldMask: ["task_contract", "mapped_requirements", "large_collection"],
        maxArrayItems: 5,
      });

      expect(sliced).toHaveProperty("task_contract");
      expect(sliced).toHaveProperty("mapped_requirements");
      expect(sliced).not.toHaveProperty("unmasked_field");

      const collection = sliced.large_collection as JsonObject[];
      expect(collection.length).toBe(6); // 5 retained + 1 truncation metadata notice
      const truncationNotice = collection[5]!;
      expect(truncationNotice._truncated).toBe(true);
      expect(truncationNotice._totalCount).toBe(50);
      expect(truncationNotice._retainedCount).toBe(5);
    });

    test("sliceAuthoritativeContext enforces validator isolation when role is validator", () => {
      const context: JsonObject = {
        baseline_repository_state: { sha256: "abc" },
        current_repository_state: { sha256: "def" },
        mapped_requirements: [{ id: "R-1" }],
        implementer_report: "should be stripped",
        confidence: "very high",
        decision_narrative: "we skipped tests",
      };

      const isolated = sliceAuthoritativeContext(context, { role: "validator" });
      expect(isolated).toHaveProperty("baseline_repository_state");
      expect(isolated).toHaveProperty("current_repository_state");
      expect(isolated).toHaveProperty("mapped_requirements");
      expect(isolated).not.toHaveProperty("implementer_report");
      expect(isolated).not.toHaveProperty("confidence");
      expect(isolated).not.toHaveProperty("decision_narrative");
    });
  });

  describe("Task Contract Slicing", () => {
    test("extracts ultra-lean task coordinates stripping bulky histories", () => {
      const bulkyTask: JsonObject = {
        id: "T-100",
        status: "leased",
        label: "Database Migration Engine",
        write_scope: ["src/db/migrate.ts"],
        resource_scope: ["schemas/v1.sql"],
        requirement_ids: ["R-DB-1", "R-DB-2"],
        dependencies: ["T-99"],
        gate: "bun test db",
        repair_round: 1,
        attempts: [
          { attempt: 1, logs: "huge logs" },
          { attempt: 2, logs: "more logs" },
        ],
        history: ["event 1", "event 2", "event 3"],
        findings: [{ id: "F-1", note: "prior finding" }],
      };

      const sliced = sliceTaskContract(bulkyTask);
      expect(sliced.id).toBe("T-100");
      expect(sliced.status).toBe("leased");
      expect(sliced.label).toBe("Database Migration Engine");
      expect(sliced.write_scope).toEqual(["src/db/migrate.ts"]);
      expect(sliced.resource_scope).toEqual(["schemas/v1.sql"]);
      expect(sliced.requirement_ids).toEqual(["R-DB-1", "R-DB-2"]);
      expect(sliced.dependencies).toEqual(["T-99"]);
      expect(sliced.gate).toBe("bun test db");
      expect(sliced.repair_round).toBe(1);
      expect(sliced.attempt_count).toBe(2);
      expect(sliced).not.toHaveProperty("history");
      expect(sliced).not.toHaveProperty("attempts");
    });
  });

  describe("Neighborhood DAG Slicing", () => {
    test("extracts subgraph around focal task bounded by depth", () => {
      const fullGraph = {
        nodes: [
          { id: "T-1", label: "Root Schema" },
          { id: "T-2", label: "Core API" },
          { id: "T-3", label: "Focal UI Task" },
          { id: "T-4", label: "UI Subcomponent" },
          { id: "T-5", label: "E2E Test Gate" },
          { id: "T-99", label: "Unrelated Task" },
        ],
        edges: [
          { from: "T-1", to: "T-2" },
          { from: "T-2", to: "T-3" },
          { from: "T-3", to: "T-4" },
          { from: "T-4", to: "T-5" },
        ],
      };

      // Depth 1 from T-3 should find T-2 (parent) and T-4 (child)
      const sliceDepth1 = sliceGraphNeighborhood(fullGraph, "T-3", 1);
      expect(sliceDepth1.focalTaskId).toBe("T-3");
      expect(sliceDepth1.depth).toBe(1);
      expect(sliceDepth1.upstreamIds).toEqual(["T-2"]);
      expect(sliceDepth1.downstreamIds).toEqual(["T-4"]);
      expect(sliceDepth1.nodes.map((n) => n.id).sort()).toEqual(["T-2", "T-3", "T-4"].sort());
      expect(sliceDepth1.nodes.map((n) => n.id)).not.toContain("T-1");
      expect(sliceDepth1.nodes.map((n) => n.id)).not.toContain("T-5");
      expect(sliceDepth1.nodes.map((n) => n.id)).not.toContain("T-99");
      expect(sliceDepth1.totalOriginalNodes).toBe(6);

      // Depth 2 from T-3 should include T-1, T-2, T-3, T-4, T-5
      const sliceDepth2 = sliceGraphNeighborhood(fullGraph, "T-3", 2);
      expect(sliceDepth2.nodes.map((n) => n.id).sort()).toEqual(
        ["T-1", "T-2", "T-3", "T-4", "T-5"].sort(),
      );
      expect(sliceDepth2.nodes.map((n) => n.id)).not.toContain("T-99");
    });
  });

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
            "tests/unit/packets/packet-slicing.test.ts",
          ],
          requirement_ids: ["R-SLICE-1"],
          dependencies: [],
          gate: "bun test tests/unit/packets/packet-slicing.test.ts",
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
        "- **Assigned Write Scope**: `src/packets/packet-slicing.ts`, `tests/unit/packets/packet-slicing.test.ts`",
      );
      expect(brief).toContain("- **Gate**: `bun test tests/unit/packets/packet-slicing.test.ts`");
      expect(brief).toContain("⚡ On-Demand Capsule Memory Queries:");
      expect(brief).toContain(
        "bun harness.ts report:task --run .capsules/run-lean-1 --task task-p37-packet-slicing",
      );
    });
  });

  describe("buildUltraLeanPacket Integration", () => {
    test("builds ultra-lean packet satisfying strict byte budget and sets metadata", () => {
      const { state, token } = createFixtureState();

      const ultraLean = buildUltraLeanPacket(
        {
          runId: "run-ultra-1",
          graphRevision: 1,
          role: "implementer",
          agentId: "worker-1",
          attempt: 1,
          state,
          task: state.tasks["T-1"],
          commonInstructions: { bytes: commonBytes, sha256: commonSha256 },
          evidenceSchema: evidenceSchema("implementer"),
          targetedCommands: [["bun", "test"]],
          leaseToken: token,
          clock,
          authoritativeContext: {
            ...inspectionContext(),
            task_contract: { id: "T-1", write_scope: ["src/slice.ts"] },
            mapped_requirements: [{ id: "R-1", text: "Slice Req" }],
          },
        },
        {
          maxBytes: DEFAULT_PACKET_BYTE_BUDGET,
        },
      );

      expect(ultraLean.metadata.is_ultra_lean).toBe(true);
      expect(ultraLean.metadata.packet_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(ultraLean.markdown).toContain("# implementer packet");
      expect(ultraLean.markdown).toContain("Responsibility checklist");

      const budgetCheck = enforcePacketBudget(ultraLean, DEFAULT_PACKET_BYTE_BUDGET);
      expect(budgetCheck.compliant).toBe(true);
    });
  });
});
