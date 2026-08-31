import { describe, expect, it } from "bun:test";
import { closeSync, existsSync, openSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  loadSparseIndex,
  rebuildSparseIndex,
  seekEventByteOffset,
  updateSparseIndex,
  type EventSparseIndex,
} from "../../olt/scripts/src/engine/store/hierarchy/sparse-index.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

function createEventLine(seq: number): string {
  const obj = {
    schema: "harness.event",
    version: 1,
    run_id: "run-test",
    capsule_id: "0123456789abcdef0123456789abcdef",
    sequence: seq,
    revision: seq,
    timestamp: "2026-08-29T00:00:00.000Z",
    actor: "system",
    kind: "step",
    payload: { seq, note: `payload for step ${seq}` },
    previous_hash: null,
    hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  };
  return JSON.stringify(obj) + "\n";
}

describe("Sparse Index Engine", () => {
  describe("loadSparseIndex & updateSparseIndex", () => {
    it("returns null when index file does not exist", () => {
      const root = scratchRoot(import.meta.path, "load-missing");
      expect(loadSparseIndex(join(root, "missing.json"))).toBeNull();
    });

    it("creates, updates, and persists sparse index at interval checkpoints", () => {
      const root = scratchRoot(import.meta.path, "update-lifecycle");
      const indexPath = join(root, "sparse-index.json");

      const res1 = updateSparseIndex(indexPath, 1, 0, 100);
      expect(res1).not.toBeNull();
      expect(res1?.byte_offsets).toEqual({ "1": 0 });
      expect(res1?.version).toBe(1);

      const res2 = updateSparseIndex(indexPath, 2, 120, 100);
      expect(res2).toBeNull();

      const res100 = updateSparseIndex(indexPath, 100, 12500, 100);
      expect(res100?.byte_offsets).toEqual({ "1": 0, "100": 12500 });

      const res200 = updateSparseIndex(indexPath, 200, 25800, 100);
      expect(res200?.byte_offsets).toEqual({ "1": 0, "100": 12500, "200": 25800 });

      const loaded = loadSparseIndex(indexPath);
      expect(loaded).toEqual(res200);
    });

    it("supports custom intervals during update", () => {
      const root = scratchRoot(import.meta.path, "custom-interval");
      const indexPath = join(root, "sparse-index.json");

      expect(updateSparseIndex(indexPath, 25, 500, 50)).toBeNull();
      const res50 = updateSparseIndex(indexPath, 50, 1000, 50);
      expect(res50?.byte_offsets).toEqual({ "50": 1000 });
      const res100 = updateSparseIndex(indexPath, 100, 2000, 50);
      expect(res100?.byte_offsets).toEqual({ "50": 1000, "100": 2000 });
    });
  });

  describe("seekEventByteOffset (Fast O(1) in-memory lookup)", () => {
    const sampleIndex: EventSparseIndex = {
      version: 1,
      indexed_at: "2026-08-29T00:00:00.000Z",
      byte_offsets: {
        "1": 0,
        "100": 12000,
        "200": 24500,
        "300": 37200,
      },
    };

    it("finds greatest indexed sequence S <= targetSequence", () => {
      expect(seekEventByteOffset(sampleIndex, 350, 100)).toBe(37200);
      expect(seekEventByteOffset(sampleIndex, 300, 100)).toBe(37200);
      expect(seekEventByteOffset(sampleIndex, 299, 100)).toBe(24500);
      expect(seekEventByteOffset(sampleIndex, 200, 100)).toBe(24500);
      expect(seekEventByteOffset(sampleIndex, 150, 100)).toBe(12000);
      expect(seekEventByteOffset(sampleIndex, 100, 100)).toBe(12000);
      expect(seekEventByteOffset(sampleIndex, 99, 100)).toBe(0);
      expect(seekEventByteOffset(sampleIndex, 1, 100)).toBe(0);
    });

    it("falls back to lower checkpoints when intermediate checkpoint is missing", () => {
      const gapIndex: EventSparseIndex = {
        version: 1,
        indexed_at: "2026-08-29T00:00:00.000Z",
        byte_offsets: { "1": 0, "100": 1000, "300": 3000 },
      };
      expect(seekEventByteOffset(gapIndex, 250, 100)).toBe(1000);
      expect(seekEventByteOffset(gapIndex, 50, 100)).toBe(0);
    });

    it("returns 0 for non-positive or invalid targetSequence and null index", () => {
      expect(seekEventByteOffset(null, 100)).toBe(0);
      expect(seekEventByteOffset(sampleIndex, 0)).toBe(0);
      expect(seekEventByteOffset(sampleIndex, -10)).toBe(0);
      expect(seekEventByteOffset(sampleIndex, Number.NaN)).toBe(0);
    });

    it("executes in < 1ms for O(1) in-memory lookups", () => {
      const start = performance.now();
      const iterations = 5000;
      for (let i = 1; i <= iterations; i++) {
        seekEventByteOffset(sampleIndex, (i % 350) + 1, 100);
      }
      const durationMs = performance.now() - start;
      const perLookupMs = durationMs / iterations;
      expect(perLookupMs).toBeLessThan(0.05); // far below 1ms
    });
  });

  describe("rebuildSparseIndex & Exact Byte Offset Alignment", () => {
    it("reconstructs exact byte offsets aligned with event line boundaries and matches incremental update", () => {
      const root = scratchRoot(import.meta.path, "rebuild-alignment");
      const eventsPath = join(root, "events.jsonl");
      const rebuildPath = join(root, "sparse-index.json");
      const incrementalPath = join(root, "incremental-index.json");

      const expectedOffsets: Record<string, number> = {};
      let totalBytes = 0;
      let fileContent = "";

      for (let seq = 1; seq <= 350; seq++) {
        const line = createEventLine(seq);
        const lineBytes = Buffer.byteLength(line, "utf-8");
        updateSparseIndex(incrementalPath, seq, totalBytes, 100);
        if (seq === 1 || seq % 100 === 0) {
          expectedOffsets[String(seq)] = totalBytes;
        }
        totalBytes += lineBytes;
        fileContent += line;
      }
      writeFileSync(eventsPath, fileContent, "utf-8");

      const rebuilt = rebuildSparseIndex(eventsPath, rebuildPath, 100);
      expect(rebuilt.version).toBe(1);
      expect(rebuilt.byte_offsets).toEqual(expectedOffsets);

      const incremental = loadSparseIndex(incrementalPath);
      expect(rebuilt.byte_offsets).toEqual(incremental?.byte_offsets ?? {});

      // Verify exact physical byte alignment by reading slices directly from disk:
      const fd = openSync(eventsPath, "r");
      try {
        for (const seq of [1, 100, 200, 300]) {
          const offset = seekEventByteOffset(rebuilt, seq, 100);
          expect(offset).toBe(expectedOffsets[String(seq)]);

          const buf = Buffer.alloc(1024);
          const bytesRead = readSync(fd, buf, 0, 1024, offset);
          expect(bytesRead).toBeGreaterThan(0);
          const firstLine = buf.subarray(0, bytesRead).toString("utf-8").split("\n")[0]!;
          const parsed = JSON.parse(firstLine) as { sequence: number };
          expect(parsed.sequence).toBe(seq);
        }
      } finally {
        closeSync(fd);
      }
    });

    it("rebuilds an empty index for a 0-byte events file", () => {
      const root = scratchRoot(import.meta.path, "rebuild-empty");
      const eventsPath = join(root, "events.jsonl");
      const indexPath = join(root, "sparse-index.json");
      writeFileSync(eventsPath, "", "utf-8");

      const rebuilt = rebuildSparseIndex(eventsPath, indexPath, 100);
      expect(rebuilt.version).toBe(1);
      expect(rebuilt.byte_offsets).toEqual({});
      expect(existsSync(indexPath)).toBe(true);
    });
  });

  describe("Negative Gates & Integrity Invariants", () => {
    it("rejects invalid arguments for updateSparseIndex", () => {
      const root = scratchRoot(import.meta.path, "neg-update-args");
      const p = join(root, "sparse-index.json");

      expect(() => updateSparseIndex("", 1, 0)).toThrow(HarnessError);
      expect(() => updateSparseIndex("   ", 1, 0)).toThrow(HarnessError);
      expect(() => updateSparseIndex(p, 0, 0)).toThrow(HarnessError);
      expect(() => updateSparseIndex(p, -5, 0)).toThrow(HarnessError);
      expect(() => updateSparseIndex(p, 1.5, 0)).toThrow(HarnessError);
      expect(() => updateSparseIndex(p, 1, -1)).toThrow(HarnessError);
      expect(() => updateSparseIndex(p, 1, 1.2)).toThrow(HarnessError);
      expect(() => updateSparseIndex(p, 1, 0, 0)).toThrow(HarnessError);
      expect(() => updateSparseIndex(p, 1, 0, -10)).toThrow(HarnessError);
    });

    it("throws INTEGRITY error on corrupted JSON or invalid schema in loadSparseIndex", () => {
      const root = scratchRoot(import.meta.path, "neg-load-integrity");
      const p = join(root, "sparse-index.json");

      expect(() => loadSparseIndex("")).toThrow(HarnessError);
      writeFileSync(p, "{ corrupted json", "utf-8");
      expect(() => loadSparseIndex(p)).toThrow(HarnessError);

      writeFileSync(p, JSON.stringify([1, 2, 3]), "utf-8");
      expect(() => loadSparseIndex(p)).toThrow(HarnessError);

      writeFileSync(
        p,
        JSON.stringify({ version: 2, byte_offsets: {}, indexed_at: "2026-08-29T00:00:00Z" }),
        "utf-8",
      );
      expect(() => loadSparseIndex(p)).toThrow(HarnessError);

      writeFileSync(p, JSON.stringify({ version: 1, byte_offsets: {}, indexed_at: "" }), "utf-8");
      expect(() => loadSparseIndex(p)).toThrow(HarnessError);

      writeFileSync(
        p,
        JSON.stringify({
          version: 1,
          byte_offsets: { "1": -50 },
          indexed_at: "2026-08-29T00:00:00Z",
        }),
        "utf-8",
      );
      expect(() => loadSparseIndex(p)).toThrow(HarnessError);

      writeFileSync(
        p,
        JSON.stringify({
          version: 1,
          byte_offsets: { abc: 10 },
          indexed_at: "2026-08-29T00:00:00Z",
        }),
        "utf-8",
      );
      expect(() => loadSparseIndex(p)).toThrow(HarnessError);

      writeFileSync(
        p,
        JSON.stringify({ version: 1, byte_offsets: null, indexed_at: "2026-08-29T00:00:00Z" }),
        "utf-8",
      );
      expect(() => loadSparseIndex(p)).toThrow(HarnessError);
    });

    it("throws NOT_FOUND or INVALID_ARGUMENT when rebuilding with bad arguments", () => {
      const root = scratchRoot(import.meta.path, "neg-rebuild-notfound");
      expect(() => rebuildSparseIndex("", join(root, "index.json"))).toThrow(HarnessError);
      expect(() => rebuildSparseIndex(join(root, "events.jsonl"), "")).toThrow(HarnessError);
      expect(() =>
        rebuildSparseIndex(join(root, "events.jsonl"), join(root, "index.json"), 0),
      ).toThrow(HarnessError);

      expect(() =>
        rebuildSparseIndex(join(root, "nonexistent.jsonl"), join(root, "index.json")),
      ).toThrow(HarnessError);
      try {
        rebuildSparseIndex(join(root, "nonexistent.jsonl"), join(root, "index.json"));
      } catch (err) {
        expect((err as HarnessError).code).toBe("NOT_FOUND");
      }
    });

    it("throws INTEGRITY error when rebuilding from corrupted events", () => {
      const root = scratchRoot(import.meta.path, "neg-rebuild-corrupt");
      const eventsPath = join(root, "events.jsonl");
      const indexPath = join(root, "index.json");

      writeFileSync(eventsPath, "INVALID_NOT_JSON\n", "utf-8");
      expect(() => rebuildSparseIndex(eventsPath, indexPath)).toThrow(HarnessError);

      writeFileSync(eventsPath, JSON.stringify({ not_an_event: true }) + "\n", "utf-8");
      expect(() => rebuildSparseIndex(eventsPath, indexPath)).toThrow(HarnessError);

      writeFileSync(eventsPath, JSON.stringify({ sequence: -1 }) + "\n", "utf-8");
      expect(() => rebuildSparseIndex(eventsPath, indexPath)).toThrow(HarnessError);
    });
  });
});
