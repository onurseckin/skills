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


describe("Ultra-Lean Packet - Evidence & Integration", () => {
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
      expect(ultraLean.markdown).toContain("Actionable Task Checklist");

      const budgetCheck = enforcePacketBudget(ultraLean, DEFAULT_PACKET_BYTE_BUDGET);
      expect(budgetCheck.compliant).toBe(true);
    });
  });

  describe("Additional Edge Cases & Branch Coverage", () => {
    test("sliceMarkdownSections truncates non-code blocks and handles total budget limit", () => {
      const nonCodeMd = "## Narrative\n\n" + "Very long explanatory text line.\n".repeat(50);
      const sliced = sliceMarkdownSections(nonCodeMd, {
        maxSectionBytes: 100,
        maxTotalBytes: 200,
      });
      expect(sliced).toContain("[... Section truncated to budget");
    });

    test("sliceMarkdownSections handles extreme total budget limit smaller than notice", () => {
      const md = "## Narrative\n\nSome text";
      const sliced = sliceMarkdownSections(md, {
        maxTotalBytes: 10,
      });
      expect(Buffer.from(sliced, "utf-8").byteLength).toBeLessThanOrEqual(10);
    });

    test("sliceEventStream filters by actor and since date", () => {
      const events: JsonObject[] = [
        {
          event_id: "evt-1",
          actor: "worker-1",
          type: "task:leased",
          timestamp: "2026-08-13T12:00:00Z",
        },
        {
          event_id: "evt-2",
          agent_id: "worker-2",
          type: "task:leased",
          timestamp: "2026-08-13T13:00:00Z",
        },
        {
          event_id: "evt-3",
          actor: "worker-1",
          type: "task:submitted",
          timestamp: "invalid-date",
        },
      ];

      const byActor = sliceEventStream(events, { actor: "worker-1" });
      expect(byActor.total).toBe(2);

      const bySince = sliceEventStream(events, { since: "2026-08-13T12:30:00Z" });
      expect(bySince.total).toBe(1);
    });

    test("sliceRepositoryDiff handles empty scope and large diff truncation", () => {
      expect(sliceRepositoryDiff("diff --git a/a.ts b/a.ts", [])).toBe(
        "[Scope Empty: No diff displayed]",
      );

      const largeDiff = "diff --git a/a.ts b/a.ts\n" + "+line\n".repeat(1000);
      const truncated = sliceRepositoryDiff(largeDiff, ["a.ts"], 200);
      expect(truncated).toContain("[... Diff truncated to budget");
    });

    test("createMetadataSlice handles all targets and fallback branches", () => {
      const state: JsonObject = {
        tasks: {
          "T-1": { id: "T-1", status: "ready", write_scope: ["a.ts"], requirement_ids: ["R-1"] },
        },
        graph: {
          nodes: [{ id: "T-1" }],
          edges: [],
        },
        events: [
          { event_id: "E-1", task_id: "T-1", type: "event" },
          { event_id: "E-2", task_id: "T-2", type: "event" },
        ],
        requirements: [
          { id: "R-1", description: "Requirement 1" },
          { id: "R-2", description: "Requirement 2" },
        ],
        commands: {
          "C-1": { command_id: "C-1", task_id: "T-1", argv: ["bun", "test"] },
          "C-2": { command_id: "C-2", task_id: "T-2", argv: ["bun", "lint"] },
        },
        custom_field: "custom_value",
      };

      // task not found
      expect(() =>
        createMetadataSlice(state, { runId: "r1", target: "task", taskId: "T-MISSING" }),
      ).toThrow("not found in state");

      // task list
      const taskList = createMetadataSlice(state, { runId: "r1", target: "task" });
      expect(taskList.totalCount).toBe(1);

      // full graph
      const graphList = createMetadataSlice(state, { runId: "r1", target: "graph" });
      expect(graphList.totalCount).toBe(1);

      // events
      const eventsSlice = createMetadataSlice(state, {
        runId: "r1",
        target: "events",
        taskId: "T-1",
      });
      expect(eventsSlice.totalCount).toBe(1);

      // requirements with and without task
      const reqTask = createMetadataSlice(state, {
        runId: "r1",
        target: "requirements",
        taskId: "T-1",
      });
      expect(reqTask.totalCount).toBe(2);
      expect(reqTask.returnedCount).toBe(1);

      const reqAll = createMetadataSlice(state, { runId: "r1", target: "requirements" });
      expect(reqAll.totalCount).toBe(2);
      expect(reqAll.returnedCount).toBe(2);

      // commands / evidence with and without task
      const cmdTask = createMetadataSlice(state, {
        runId: "r1",
        target: "commands",
        taskId: "T-1",
      });
      expect(cmdTask.returnedCount).toBe(1);

      const cmdAll = createMetadataSlice(state, { runId: "r1", target: "evidence" });
      expect(cmdAll.totalCount).toBe(2);

      // custom with fields
      const customSlice = createMetadataSlice(state, {
        runId: "r1",
        target: "custom",
        fields: ["custom_field"],
      });
      expect((customSlice.data as JsonObject).custom_field).toBe("custom_value");

      // custom without fields
      const customAll = createMetadataSlice(state, { runId: "r1", target: "custom" });
      expect(customAll.totalCount).toBe(1);
    });

    test("exercises sliceMarkdownSections without header and budget stepping back", () => {
      const md =
        "Headerless content here at the start.\n\n## Section 2\nSome more content that extends the byte size significantly.";
      const res = sliceMarkdownSections(md, { maxTotalBytes: 70 });
      expect(res).toContain("Headerless content");
      expect(res).toContain("[... Packet truncated to maximum total budget ...]");

      // Multi-byte emoji to trigger the while loop stepping back
      const emojiMd = "🚀".repeat(50);
      const emojiRes = sliceMarkdownSections(emojiMd, { maxTotalBytes: 55 });
      expect(emojiRes).toContain("[... Packet truncated to maximum total budget ...]");
    });

    test("sliceTaskContract handles validator and sub-validator roles", () => {
      const task: TaskRecord = {
        id: "T-1",
        label: "Task 1",
        write_scope: ["src/a.ts"],
        resource_scope: ["res/1.json"],
        requirement_ids: ["req-1"],
        dependencies: [],
        gate: "bun test",
        repair_round: 1,
        attempts: [{ attempt: 1, status: "failed" }] as unknown as TaskRecord["attempts"],
        status: "ready",
      } as unknown as TaskRecord;

      const valContract = sliceTaskContract(task, { role: "validator" });
      expect((valContract as JsonObject).repair_round).toBe(1);
      expect((valContract as JsonObject).attempt_count).toBe(1);

      const subValContract = sliceTaskContract(task, { role: "sub-validator" });
      expect((subValContract as JsonObject).id).toBe("T-1");
    });

    test("sliceEventStream and formatLeanMarkdownBrief handle timeline without timestamp and custom guidance", () => {
      const events = [
        { id: "e1", event: "created" }, // no timestamp
        { id: "e2", event: "updated", timestamp: "invalid-date" },
        { id: "e3", event: "done", timestamp: "2026-08-15T12:00:00.000Z" },
      ];

      const sliced = sliceEventStream(events as unknown as Parameters<typeof sliceEventStream>[0], {
        since: "2026-08-14T00:00:00.000Z",
      });
      expect(sliced.events.length).toBeGreaterThanOrEqual(1);

      const brief = formatLeanMarkdownBrief({
        runId: "run-1",
        customGuidance: ["Check custom rule A", "Check custom rule B"],
      });
      expect(brief).toContain("- Check custom rule A");
      expect(brief).toContain("- Check custom rule B");
    });
  });
});

