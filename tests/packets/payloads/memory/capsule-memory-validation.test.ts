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
} from "../../../../olt/scripts/src/packets/capsule-memory.ts";
import { evidenceSchema } from "../../../../olt/scripts/src/packets/evidence-schema.ts";
import { buildPacket } from "../../../../olt/scripts/src/packets/render-packet.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { at, TestPort, workflowState } from "../../../workflow/test-port.ts";
import { inspectionContext } from "../slicing/inspection-fixture.ts";

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

describe("Decoupled Capsule Memory - Validation & Edge Cases", () => {
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
      await writeFile(join(tempRoot, "state.json"), JSON.stringify("just a string"));
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

