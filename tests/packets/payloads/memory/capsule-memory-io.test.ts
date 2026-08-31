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

describe("Decoupled Capsule Memory - Disk I/O & Blobs", () => {
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
});

