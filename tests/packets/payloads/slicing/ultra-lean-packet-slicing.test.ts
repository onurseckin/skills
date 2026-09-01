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
import { at, TestPort, workflowState } from "../../../workflow/index.ts";
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

describe("ultra lean packet - slicing & budgeting", () => {
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
});
