import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  loadSparseIndex,
  rebuildSparseIndex,
  updateSparseIndex,
} from "../../../olt/scripts/src/engine/store/hierarchy/sparse-index.ts";
import {
  cleanupVirtualStoreFS,
  getVirtualStoreFS,
  resetVirtualStore,
  scratchRoot,
  setupVirtualStoreFS,
} from "../store-fixture.ts";

setupVirtualStoreFS();

beforeEach(() => {
  resetVirtualStore();
});

afterEach(() => {
  resetVirtualStore();
});

afterAll(() => {
  cleanupVirtualStoreFS();
});

describe("Sparse Index Engine", () => {
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
      const vfs = getVirtualStoreFS();
      const root = scratchRoot(import.meta.path, "neg-load-integrity");
      const p = join(root, "sparse-index.json");

      expect(() => loadSparseIndex("")).toThrow(HarnessError);
      vfs.writeFileSync(p, "{ corrupted json", "utf-8");
      expect(() => loadSparseIndex(p)).toThrow(HarnessError);

      vfs.writeFileSync(p, JSON.stringify([1, 2, 3]), "utf-8");
      expect(() => loadSparseIndex(p)).toThrow(HarnessError);

      vfs.writeFileSync(
        p,
        JSON.stringify({ version: 2, byte_offsets: {}, indexed_at: "2026-08-29T00:00:00Z" }),
        "utf-8",
      );
      expect(() => loadSparseIndex(p)).toThrow(HarnessError);

      vfs.writeFileSync(
        p,
        JSON.stringify({ version: 1, byte_offsets: {}, indexed_at: "" }),
        "utf-8",
      );
      expect(() => loadSparseIndex(p)).toThrow(HarnessError);

      vfs.writeFileSync(
        p,
        JSON.stringify({
          version: 1,
          byte_offsets: { "1": -50 },
          indexed_at: "2026-08-29T00:00:00Z",
        }),
        "utf-8",
      );
      expect(() => loadSparseIndex(p)).toThrow(HarnessError);

      vfs.writeFileSync(
        p,
        JSON.stringify({
          version: 1,
          byte_offsets: { abc: 10 },
          indexed_at: "2026-08-29T00:00:00Z",
        }),
        "utf-8",
      );
      expect(() => loadSparseIndex(p)).toThrow(HarnessError);

      vfs.writeFileSync(
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
      const vfs = getVirtualStoreFS();
      const root = scratchRoot(import.meta.path, "neg-rebuild-corrupt");
      const eventsPath = join(root, "events.jsonl");
      const indexPath = join(root, "index.json");

      vfs.writeFileSync(eventsPath, "INVALID_NOT_JSON\n", "utf-8");
      expect(() => rebuildSparseIndex(eventsPath, indexPath)).toThrow(HarnessError);

      vfs.writeFileSync(eventsPath, JSON.stringify({ not_an_event: true }) + "\n", "utf-8");
      expect(() => rebuildSparseIndex(eventsPath, indexPath)).toThrow(HarnessError);

      vfs.writeFileSync(eventsPath, JSON.stringify({ sequence: -1 }) + "\n", "utf-8");
      expect(() => rebuildSparseIndex(eventsPath, indexPath)).toThrow(HarnessError);
    });
  });
});
