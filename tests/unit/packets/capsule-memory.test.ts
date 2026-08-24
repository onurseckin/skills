import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CAPSULE_DIRECTORIES,
  CAPSULE_FILES,
  createCapsuleMemoryPointer,
  detectContextBloat,
  formatCapsuleMemoryGuidance,
  getCapsuleCliCommands,
  partitionDecoupledMemory,
  readDecoupledBlob,
  readDecoupledEvents,
  readDecoupledEvidence,
  readDecoupledState,
  resolveCapsuleDirectory,
  resolveCapsuleFile,
  validateRichInstructionPacket,
  verifyCapsuleLayout,
  verifyCapsuleLayoutSync,
  writeDecoupledBlob,
} from "../../../olt/scripts/src/packets/capsule-memory.ts";
import { evidenceSchema } from "../../../olt/scripts/src/packets/evidence-schema.ts";
import { buildPacket } from "../../../olt/scripts/src/packets/render-packet.ts";
import { claimTask } from "../../../olt/scripts/src/workflow/lease/claim.ts";
import { at, TestPort, workflowState } from "../workflow/test-port.ts";
import { inspectionContext } from "./inspection-fixture.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots) {
    await rm(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

const clock = at("2026-08-22T12:00:00.000Z");
const commonBytes = new TextEncoder().encode("Canonical common instructions for tests.\n");
const commonSha256 = createHash("sha256").update(commonBytes).digest("hex");

function baseImplementerState() {
  const port = new TestPort(workflowState());
  const claim = claimTask(port, "T-1", "worker-1", "implementer", { clock });
  return {
    state: claim.state,
    token: claim.token,
  };
}

describe("Decoupled Capsule Memory & Rich Instruction Architecture", () => {
  describe("Capsule Memory Structure & Paths", () => {
    test("exports expected standard directory and file constants", () => {
      expect(CAPSULE_DIRECTORIES).toContain("commands");
      expect(CAPSULE_DIRECTORIES).toContain("evidence");
      expect(CAPSULE_DIRECTORIES).toContain("packets");
      expect(CAPSULE_DIRECTORIES).toContain("planning");
      expect(CAPSULE_DIRECTORIES).toContain("reports");
      expect(CAPSULE_DIRECTORIES).toContain("runtime");
      expect(CAPSULE_DIRECTORIES).toContain("blobs");

      expect(CAPSULE_FILES).toContain("events.jsonl");
      expect(CAPSULE_FILES).toContain("state.json");
      expect(CAPSULE_FILES).toContain("manifest.json");
      expect(CAPSULE_FILES).toContain("trace.md");
      expect(CAPSULE_FILES).toContain("handoff.md");
      expect(CAPSULE_FILES).toContain("captures.json");
      expect(CAPSULE_FILES).toContain("index.json");
      expect(CAPSULE_FILES).toContain("prompt.md");
    });

    test("resolves capsule directory and file paths correctly", () => {
      const root = "/tmp/test-capsule";
      expect(resolveCapsuleDirectory(root, "evidence")).toBe("/tmp/test-capsule/evidence");
      expect(resolveCapsuleFile(root, "events.jsonl")).toBe("/tmp/test-capsule/events.jsonl");
    });

    test("verifies full capsule layout for valid and incomplete directories", async () => {
      const tempRoot = await mkdtemp(join(tmpdir(), "capsule-layout-test-"));
      roots.push(tempRoot);

      // Initially empty -> invalid layout with missing items
      const initialSync = verifyCapsuleLayoutSync(tempRoot);
      expect(initialSync.valid).toBe(false);
      expect(initialSync.missingDirectories.length).toBe(CAPSULE_DIRECTORIES.length);
      expect(initialSync.missingFiles.length).toBe(CAPSULE_FILES.length);

      // Create all required directories and files
      for (const dir of CAPSULE_DIRECTORIES) {
        await mkdir(join(tempRoot, dir), { recursive: true });
      }
      for (const file of CAPSULE_FILES) {
        await writeFile(join(tempRoot, file), file.endsWith(".json") ? "{}" : "# test\n");
      }

      const verifiedAsync = await verifyCapsuleLayout(tempRoot);
      expect(verifiedAsync.valid).toBe(true);
      expect(verifiedAsync.missingDirectories).toEqual([]);
      expect(verifiedAsync.missingFiles).toEqual([]);
      expect(verifiedAsync.directories.every((d) => d.exists)).toBe(true);
      expect(verifiedAsync.files.every((f) => f.exists)).toBe(true);
    });
  });

  describe("Capsule CLI Guidance & Pointers", () => {
    test("generates rich CLI query command definitions", () => {
      const commandsWithTask = getCapsuleCliCommands("run-123", "T-42");
      expect(commandsWithTask.length).toBeGreaterThanOrEqual(8);

      const taskReportCmd = commandsWithTask.find((c) => c.category === "status");
      expect(taskReportCmd?.command).toBe(
        "bun harness.ts report:task --run .capsules/run-123 --task T-42",
      );

      const eventStreamCmd = commandsWithTask.find((c) => c.category === "timeline");
      expect(eventStreamCmd?.command).toBe("bun harness.ts stream:events --run .capsules/run-123");

      const dagCmd = commandsWithTask.find((c) => c.category === "dag");
      expect(dagCmd?.command).toBe("bun harness.ts dag:view --run .capsules/run-123");

      const gateProveCmd = commandsWithTask.find((c) => c.category === "verification");
      expect(gateProveCmd?.command).toBe(
        "bun harness.ts gate:prove --run .capsules/run-123 --task T-42",
      );

      const commandsWithoutTask = getCapsuleCliCommands("run-123", null);
      const generalReportCmd = commandsWithoutTask.find((c) => c.category === "status");
      expect(generalReportCmd?.command).toBe("bun harness.ts report:task --run .capsules/run-123");
    });

    test("formats capsule memory guidance section for packets", () => {
      const pointer = createCapsuleMemoryPointer("run-test-p38", "implementer", "T-1");
      expect(pointer.run_id).toBe("run-test-p38");
      expect(pointer.task_id).toBe("T-1");
      expect(pointer.role).toBe("implementer");

      const guidance = formatCapsuleMemoryGuidance(pointer);
      expect(guidance).toContain("Capsule Memory on disk");
      expect(guidance).toContain(
        "bun harness.ts report:task --run .capsules/run-test-p38 --task T-1",
      );
      expect(guidance).toContain("bun harness.ts stream:events --run .capsules/run-test-p38");
      expect(guidance).toContain("bun harness.ts dag:view --run .capsules/run-test-p38");
      expect(guidance).toContain(
        "bun harness.ts gate:prove --run .capsules/run-test-p38 --task T-1",
      );
      expect(guidance).toContain("bun harness.ts explain <ERROR_CODE>");
      expect(guidance).toContain("bun harness.ts doctor --run .capsules/run-test-p38");
    });
  });

  describe("Decoupled Memory Partitioning & Context Bloat Detection", () => {
    test("partitionDecoupledMemory decouples forbidden reports and heavy metadata", () => {
      const rawContext = {
        ...inspectionContext(),
        mapped_requirements: [{ id: "R-1" }],
        task_contract: { id: "T-1" },
        implementer_report: "I completed the entire task flawlessly without issues",
        confidence: "ultra-high",
        decision_narrative: "Decision to bypass tests",
        raw_errors: ["Error: fail 1", "Error: fail 2"],
        stack_traces: ["at functionA()", "at functionB()"],
      };

      const partition = partitionDecoupledMemory(rawContext, "validator");
      expect(partition.inMemoryContext).toHaveProperty("mapped_requirements");
      expect(partition.inMemoryContext).toHaveProperty("task_contract");
      expect(partition.inMemoryContext).not.toHaveProperty("implementer_report");
      expect(partition.inMemoryContext).not.toHaveProperty("confidence");
      expect(partition.inMemoryContext).not.toHaveProperty("decision_narrative");
      expect(partition.inMemoryContext).not.toHaveProperty("raw_errors");

      expect(partition.decoupledPayload).toHaveProperty("implementer_report");
      expect(partition.decoupledPayload).toHaveProperty("confidence");
      expect(partition.excludedFieldNames).toContain("implementer_report");
      expect(partition.excludedFieldNames).toContain("confidence");
      expect(partition.strippedByteEstimate).toBeGreaterThan(0);
    });

    test("detectContextBloat identifies forbidden keys, long strings, large arrays, and oversized context", () => {
      const cleanContext = {
        mapped_requirements: [{ id: "R-1", title: "Clean Requirement" }],
        task_contract: { id: "T-1", write_scope: ["src/file.ts"] },
      };
      const cleanAudit = detectContextBloat(cleanContext);
      expect(cleanAudit.hasBloat).toBe(false);
      expect(cleanAudit.containsForbiddenKeys).toBe(false);
      expect(cleanAudit.issues).toHaveLength(0);

      const bloatedContext = {
        mapped_requirements: [{ id: "R-1" }],
        implementer_report: "leaked report",
        huge_array: Array.from({ length: 60 }, (_, i) => ({ index: i })),
        giant_string: "x".repeat(9000),
      };
      const bloatedAudit = detectContextBloat(bloatedContext);
      expect(bloatedAudit.hasBloat).toBe(true);
      expect(bloatedAudit.containsForbiddenKeys).toBe(true);
      expect(bloatedAudit.forbiddenKeysFound).toContain("implementer_report");
      expect(bloatedAudit.issues.some((i) => i.reason.includes("Large array"))).toBe(true);
      expect(bloatedAudit.issues.some((i) => i.reason.includes("String value exceeds 8KB"))).toBe(
        true,
      );
    });
  });

  describe("Disk-Backed Decoupled Memory Readers & Writers", () => {
    test("readDecoupledEvents filters events by limit, type, and taskId", async () => {
      const tempRoot = await mkdtemp(join(tmpdir(), "decoupled-events-test-"));
      roots.push(tempRoot);

      const eventRecords = [
        JSON.stringify({ event_id: "e-1", type: "task:claim", data: { task_id: "T-1" } }),
        JSON.stringify({ event_id: "e-2", type: "command:exec", data: { task_id: "T-1" } }),
        JSON.stringify({ event_id: "e-3", type: "task:claim", data: { task_id: "T-2" } }),
        JSON.stringify({ event_id: "e-4", type: "gate:pass", data: { task_id: "T-1" } }),
      ].join("\n");

      await writeFile(join(tempRoot, "events.jsonl"), eventRecords);

      const allEvents = await readDecoupledEvents(tempRoot);
      expect(allEvents).toHaveLength(4);

      const t1Events = await readDecoupledEvents(tempRoot, { taskId: "T-1" });
      expect(t1Events).toHaveLength(3);

      const claimEvents = await readDecoupledEvents(tempRoot, { eventType: "task:claim" });
      expect(claimEvents).toHaveLength(2);

      const limitedEvents = await readDecoupledEvents(tempRoot, { limit: 2 });
      expect(limitedEvents).toHaveLength(2);
      expect(limitedEvents[1]?.event_id).toBe("e-4");
    });

    test("readDecoupledEvidence retrieves binary or text evidence files", async () => {
      const tempRoot = await mkdtemp(join(tmpdir(), "decoupled-evidence-test-"));
      roots.push(tempRoot);

      const evidenceDir = join(tempRoot, "evidence");
      await mkdir(evidenceDir, { recursive: true });

      const evidencePayload = JSON.stringify({ stdout: "All tests passed", exit_code: 0 });
      await writeFile(join(evidenceDir, "cmd-proof-1.json"), evidencePayload);

      const retrieved = await readDecoupledEvidence(tempRoot, "cmd-proof-1");
      expect(retrieved).not.toBeNull();
      expect(JSON.parse(retrieved!.toString("utf-8"))).toEqual({
        stdout: "All tests passed",
        exit_code: 0,
      });

      const missing = await readDecoupledEvidence(tempRoot, "non-existent");
      expect(missing).toBeNull();
    });

    test("readDecoupledState reads parsed workflow state", async () => {
      const tempRoot = await mkdtemp(join(tmpdir(), "decoupled-state-test-"));
      roots.push(tempRoot);

      const mockState = { run_id: "run-state-1", tasks: { "T-1": { status: "completed" } } };
      await writeFile(join(tempRoot, "state.json"), JSON.stringify(mockState));

      const readState = await readDecoupledState(tempRoot);
      expect(readState).toEqual(mockState);

      const nonExistentRoot = join(tempRoot, "missing");
      expect(await readDecoupledState(nonExistentRoot)).toBeNull();
    });

    test("writes and reads decoupled binary blobs by sha256 hash", async () => {
      const tempRoot = await mkdtemp(join(tmpdir(), "decoupled-blobs-test-"));
      roots.push(tempRoot);

      const data = Buffer.from("Large test artifact buffer content for decoupled memory");
      const writeResult = await writeDecoupledBlob(tempRoot, data, "screenshot");

      expect(writeResult.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(writeResult.byteLength).toBe(data.byteLength);

      const readBack = await readDecoupledBlob(tempRoot, writeResult.hash);
      expect(readBack).not.toBeNull();
      expect(readBack!.toString("utf-8")).toBe(
        "Large test artifact buffer content for decoupled memory",
      );

      // Lookup by prefix of hash
      const readByPrefix = await readDecoupledBlob(tempRoot, writeResult.hash.slice(0, 16));
      expect(readByPrefix).not.toBeNull();
      expect(readByPrefix!.toString("utf-8")).toBe(
        "Large test artifact buffer content for decoupled memory",
      );
    });
  });

  describe("Rich Instruction Packet Validation", () => {
    test("validates a properly constructed implementer packet", () => {
      const { state, token } = baseImplementerState();
      const packet = {
        markdown: [
          "# implementer packet",
          "## Identity\nRun: run-rich-test",
          "## Responsibility checklist\n- [ ] 1. Pre-flight verification",
          "## Capsule memory on disk\nbun harness.ts report:task",
          "## Role contract\nrole: implementer",
          "## Task contract\nid: T-1",
          "## Mapped requirements\n- R-1: Requirement",
          "## Allowed scope\nwrite_scope: src/app.ts",
          "## Expected evidence schema\n{}",
          "## Targeted commands\nbun test",
          "## Authoritative context\n{}",
        ].join("\n\n"),
        metadata: {
          schema: "harness.packet",
          version: 1,
          run_id: "run-rich-test",
          graph_revision: 1,
          role: "implementer" as const,
          agent_id: "worker-1",
          task_id: "T-1",
          attempt: 1,
          requirement_ids: ["R-1"],
          excluded_fields: [],
          common_instructions_sha256: commonSha256,
          role_contract_sha256: "0".repeat(64),
          packet_sha256: "0".repeat(64),
        },
      };

      const report = validateRichInstructionPacket(packet, "implementer");
      expect(report.valid).toBe(true);
      expect(report.hasIdentity).toBe(true);
      expect(report.hasResponsibilityChecklist).toBe(true);
      expect(report.hasCapsuleMemoryGuidance).toBe(true);
      expect(report.hasRoleContract).toBe(true);
      expect(report.hasTaskContract).toBe(true);
      expect(report.hasMappedRequirements).toBe(true);
      expect(report.hasAllowedScope).toBe(true);
      expect(report.hasEvidenceSchema).toBe(true);
      expect(report.hasTargetedCommands).toBe(true);
      expect(report.hasAuthoritativeContext).toBe(true);
      expect(report.freeOfBloat).toBe(true);
      expect(report.issues).toEqual([]);
    });

    test("detects missing sections and forbidden leaked text in malformed packets", () => {
      const malformedPacket = {
        markdown:
          "# Raw packet\nSome unformatted text without structure\nI tested everything manually and it is 100% flawless.",
        metadata: {
          schema: "harness.packet",
          version: 1,
          run_id: "run-bad",
          graph_revision: 1,
          role: "implementer" as const,
          agent_id: "bad-agent",
          task_id: "T-1",
          attempt: 1,
          requirement_ids: [],
          excluded_fields: [],
          common_instructions_sha256: "abc",
          role_contract_sha256: "def",
          packet_sha256: "ghi",
        },
      };

      const report = validateRichInstructionPacket(malformedPacket, "implementer");
      expect(report.valid).toBe(false);
      expect(report.hasResponsibilityChecklist).toBe(false);
      expect(report.hasCapsuleMemoryGuidance).toBe(false);
      expect(report.hasRoleContract).toBe(false);
      expect(report.freeOfBloat).toBe(false);
      expect(report.issues.length).toBeGreaterThanOrEqual(4);
    });

    test("detects identity absence and role mismatch in validateRichInstructionPacket", () => {
      const packetNoIdentity = {
        markdown: "Plain text without headers or hashtags\nResponsibility checklist",
        metadata: {
          schema: "harness.packet",
          version: 1,
          run_id: "run-no-id",
          graph_revision: 1,
          role: "validator" as const,
          agent_id: "agent-1",
          task_id: "T-1",
          attempt: 1,
          requirement_ids: [],
          excluded_fields: [],
          common_instructions_sha256: "abc",
          role_contract_sha256: "def",
          packet_sha256: "ghi",
        },
      };

      const report = validateRichInstructionPacket(packetNoIdentity, "implementer");
      expect(report.hasIdentity).toBe(false);
      expect(report.issues.some((i) => i.section === "Identity")).toBe(true);
      expect(report.issues.some((i) => i.section === "Metadata")).toBe(true);
    });
  });

  describe("Additional Edge Cases & Branch Coverage", () => {
    test("detectContextBloat flags size exceeding maxSizeBytes", () => {
      const largeContext = {
        data: "x".repeat(1000),
      };
      const result = detectContextBloat(largeContext, 500);
      expect(result.hasBloat).toBe(true);
      expect(result.issues.some((i) => i.path === "root")).toBe(true);
    });

    test("readDecoupledEvents reads direct task_id on events and handles unparseable state", async () => {
      const tempRoot = await mkdtemp(join(tmpdir(), "decoupled-events-edge-"));
      roots.push(tempRoot);

      const eventsContent = [
        JSON.stringify({ event_id: "E-1", task_id: "T-DIRECT", type: "custom" }),
        "invalid json line",
        JSON.stringify({ event_id: "E-2", data: { task_id: "T-NESTED" }, type: "custom" }),
      ].join("\n");

      await writeFile(join(tempRoot, "events.jsonl"), eventsContent);

      const direct = await readDecoupledEvents(tempRoot, { taskId: "T-DIRECT" });
      expect(direct.length).toBe(1);
      expect(direct[0]!.event_id).toBe("E-1");

      const nested = await readDecoupledEvents(tempRoot, { taskId: "T-NESTED" });
      expect(nested.length).toBe(1);
      expect(nested[0]!.event_id).toBe("E-2");

      // Corrupted state.json returns null
      await writeFile(join(tempRoot, "state.json"), "invalid state json");
      expect(await readDecoupledState(tempRoot)).toBeNull();

      // State.json as a JSON primitive returns null
      await writeFile(join(tempRoot, "state.json"), '"just a string"');
      expect(await readDecoupledState(tempRoot)).toBeNull();
    });

    test("readDecoupledBlob handles prefix match with full hash mismatch", async () => {
      const tempRoot = await mkdtemp(join(tmpdir(), "decoupled-blob-edge-"));
      roots.push(tempRoot);

      const blobsDir = join(tempRoot, "blobs");
      await mkdir(blobsDir, { recursive: true });

      // Create a blob file whose name has a 16-char prefix
      const prefix = "1234567890abcdef";
      const blobFileName = `blob-${prefix}-file.bin`;
      await writeFile(join(blobsDir, blobFileName), "actual content");

      // Request a sha that matches prefix but not content
      const result = await readDecoupledBlob(tempRoot, `${prefix}different-rest-of-hash`);
      expect(result).toBeNull();
    });
  });
});
