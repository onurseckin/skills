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


describe("Decoupled Capsule Memory - Store & Structure", () => {
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
      const verifiedSync = verifyCapsuleLayoutSync(tempRoot);
      expect(verifiedSync.valid).toBe(true);
      expect(verifiedSync.missingDirectories).toEqual([]);
      expect(verifiedSync.missingFiles).toEqual([]);
      expect(verifiedSync.directories.every((d) => d.exists)).toBe(true);
      expect(verifiedSync.files.every((f) => f.exists && f.sizeBytes !== undefined)).toBe(true);

      const verifiedAsync = await verifyCapsuleLayout(tempRoot);
      expect(verifiedAsync.valid).toBe(true);
      expect(verifiedAsync.missingDirectories).toEqual([]);
      expect(verifiedAsync.missingFiles).toEqual([]);
      expect(verifiedAsync.directories.every((d) => d.exists)).toBe(true);
      expect(verifiedAsync.files.every((f) => f.exists)).toBe(true);
    });

    test("verifyCapsuleLayoutSync handles filesystem errors gracefully", async () => {
      const tempRoot = await mkdtemp(join(tmpdir(), "capsule-layout-err-"));
      roots.push(tempRoot);

      for (const dir of CAPSULE_DIRECTORIES) {
        await mkdir(join(tempRoot, dir), { recursive: true });
      }
      for (const file of CAPSULE_FILES) {
        await writeFile(join(tempRoot, file), "{}");
      }

      const fs = await import("node:fs");
      const { spyOn } = await import("bun:test");
      const spy = spyOn(fs, "lstatSync").mockImplementation(() => {
        throw new Error("Filesystem failure");
      });
      try {
        const layout = verifyCapsuleLayoutSync(tempRoot);
        expect(layout.valid).toBe(false);
        expect(layout.missingDirectories.length).toBe(CAPSULE_DIRECTORIES.length);
        expect(layout.missingFiles.length).toBe(CAPSULE_FILES.length);
      } finally {
        spy.mockRestore();
      }
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
});
