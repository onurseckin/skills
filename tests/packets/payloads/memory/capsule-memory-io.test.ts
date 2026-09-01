import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  readDecoupledBlob,
  readDecoupledEvents,
  readDecoupledEvidence,
  readDecoupledState,
  writeDecoupledBlob,
} from "../../../../olt/scripts/src/packets/capsule-memory.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

const vfs = new VirtualMemoryFS();
const session = createVirtualFSSession(vfs);

afterAll(() => {
  session.cleanup();
  vfs.reset();
});

function createTempRoot(prefix: string): string {
  const root = `/virtual/${prefix}${Math.random().toString(36).slice(2)}`;
  vfs.mkdirSync(root, { recursive: true });
  return root;
}

describe("Decoupled Capsule Memory - Disk I/O & Blobs", () => {
  describe("Disk-Backed Decoupled Memory Readers & Writers", () => {
    test("readDecoupledEvents filters events by limit, type, and taskId", async () => {
      const tempRoot = createTempRoot("decoupled-events-test-");

      const eventRecords = [
        JSON.stringify({ event_id: "e-1", type: "task:claim", data: { task_id: "T-1" } }),
        JSON.stringify({ event_id: "e-2", type: "command:exec", data: { task_id: "T-1" } }),
        JSON.stringify({ event_id: "e-3", type: "task:claim", data: { task_id: "T-2" } }),
        JSON.stringify({ event_id: "e-4", type: "gate:pass", data: { task_id: "T-1" } }),
      ].join("\n");

      vfs.writeFileSync(join(tempRoot, "events.jsonl"), eventRecords);

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
      const tempRoot = createTempRoot("decoupled-evidence-test-");

      const evidenceDir = join(tempRoot, "evidence");
      vfs.mkdirSync(evidenceDir, { recursive: true });

      const evidencePayload = JSON.stringify({ stdout: "All tests passed", exit_code: 0 });
      vfs.writeFileSync(join(evidenceDir, "cmd-proof-1.json"), evidencePayload);

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
      const tempRoot = createTempRoot("decoupled-state-test-");

      const mockState = { run_id: "run-state-1", tasks: { "T-1": { status: "completed" } } };
      vfs.writeFileSync(join(tempRoot, "state.json"), JSON.stringify(mockState));

      const readState = await readDecoupledState(tempRoot);
      expect(readState).toEqual(mockState);

      const nonExistentRoot = join(tempRoot, "missing");
      expect(await readDecoupledState(nonExistentRoot)).toBeNull();
    });

    test("writes and reads decoupled binary blobs by sha256 hash", async () => {
      const tempRoot = createTempRoot("decoupled-blobs-test-");

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
