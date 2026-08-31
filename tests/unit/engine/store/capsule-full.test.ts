import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { initRun } from "../../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import {
  buildIndex,
  writeIndex,
  loadIndex,
} from "../../../../olt/scripts/src/engine/store/capsule/capsule-index.ts";
import {
  indexTasks,
  indexCommands,
  indexPackets,
  indexReports,
  captureLedgerDigest,
  optional,
  text,
  integer,
  stringList,
} from "../../../../olt/scripts/src/engine/store/capsule/capsule-index-types.ts";
import {
  readCaptures,
  recordCaptures,
  type CaptureRecord,
} from "../../../../olt/scripts/src/engine/store/capsule/captures.ts";
import { runFilePath } from "../../../../olt/scripts/src/engine/store/capsule/paths.ts";
import { normalizeRunId } from "../../../../olt/scripts/src/engine/store/capsule/run-id.ts";
import {
  loadRun,
  loadRunProjection,
} from "../../../../olt/scripts/src/engine/store/capsule/load.ts";
import { initialState } from "../../../../olt/scripts/src/engine/store/capsule/state.ts";

function makeTmpDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

describe("engine/store/capsule/run-id.ts", () => {
  it("normalizes prefixes and rejects invalid run IDs", () => {
    expect(normalizeRunId("run-123")).toBe("run-123");
    expect(normalizeRunId(".olt/capsules/run-abc")).toBe("run-abc");
    expect(normalizeRunId(".capsules/run-def")).toBe("run-def");
    expect(normalizeRunId("capsules/run-ghi")).toBe("run-ghi");
    expect(() => normalizeRunId("")).toThrow(HarnessError);
    expect(() => normalizeRunId("  ")).toThrow(HarnessError);
    expect(() => normalizeRunId(".olt/capsules/nested/run-1")).toThrow(HarnessError);
  });
});

describe("engine/store/capsule/paths.ts", () => {
  it("resolves safe file paths and throws on traversal attempts", () => {
    const tmp = makeTmpDir("capsule-paths-");
    try {
      const p = runFilePath(tmp, "manifest.json");
      expect(p).toBe(join(tmp, "manifest.json"));
      expect(() => runFilePath(tmp, "../outside.json")).toThrow(HarnessError);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("engine/store/capsule/captures.ts", () => {
  it("records and reads captures correctly", () => {
    const tmp = makeTmpDir("capsule-captures-");
    try {
      mkdirSync(join(tmp, "blobs"), { recursive: true });
      const record: CaptureRecord = {
        kind: "screenshot",
        name: "screen.png",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        bytes: 100,
        blob_path: "blobs/sha",
        path: "evidence/screen.png",
        storage: "blob",
        original_path: "/tmp/screen.png",
      };
      const recorded = recordCaptures(tmp, [record]);
      expect(recorded).toBe(true);

      const list = readCaptures(tmp);
      expect(list.length).toBe(1);
      expect(list[0].sha256).toBe(record.sha256);

      const digest = captureLedgerDigest(tmp);
      expect(typeof digest).toBe("string");

      // Duplicates return false
      expect(recordCaptures(tmp, [record])).toBe(false);
      expect(recordCaptures(tmp, [])).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("engine/store/capsule/capsule-index.ts & types", () => {
  it("utility helpers handle edge types", () => {
    expect(text("hello")).toBe("hello");
    expect(text("")).toBeUndefined();
    expect(text(123)).toBeUndefined();

    expect(integer(42)).toBe(42);
    expect(integer(42.5)).toBeUndefined();
    expect(integer("42")).toBeUndefined();

    expect(stringList(["a", "", 123, "b"])).toEqual(["a", "b"]);
    expect(stringList("not-an-array")).toEqual([]);

    expect(optional("k", "v")).toEqual({ k: "v" });
    expect(optional("k", undefined)).toEqual({});
  });

  it("builds, writes, and loads capsule index", () => {
    const tmp = makeTmpDir("capsule-index-test-");
    try {
      mkdirSync(join(tmp, ".olt"), { recursive: true });
      const runRoot = initRun(
        tmp,
        "test-run-index",
        new TextEncoder().encode("prompt test"),
        "file",
        true,
      );

      const state = initialState("test-run-index", "cap-123", "prompt test");
      state.tasks = {
        "task-1": {
          id: "task-1",
          status: "ready",
          requirement_ids: ["req-1"],
          findings: [
            { id: "f-1", requirement_id: "req-1", severity: "critical", status: "open" },
            { id: "f-2", requirement_id: "req-1", severity: "minor", status: "resolved" },
          ],
          validations: [{ checks: [{ command_id: "cmd-1" }] }],
        },
      };
      state.commands = {
        "cmd-1": {
          id: "cmd-1",
          status: "succeeded",
          exit_code: 0,
          task_id: "task-1",
          gate_id: "gate-1",
          actor: "worker",
          started_at: "2026-08-30T00:00:00Z",
          finished_at: "2026-08-30T00:01:00Z",
        },
      };

      const index = buildIndex(runRoot, state, "test-run-index");
      expect(index.tasks.length).toBe(1);
      expect(index.findings.length).toBe(2);
      expect(index.commands.length).toBe(1);

      writeIndex(runRoot, state, "test-run-index");
      const loaded = loadIndex(runRoot);
      expect(loaded.index.run_id).toBe("test-run-index");
      expect(loaded.index.tasks.length).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("engine/store/capsule/capsule.ts & load.ts", () => {
  it("initRun rejects invalid arguments and initializes run directory", () => {
    const tmp = makeTmpDir("capsule-init-test-");
    try {
      mkdirSync(join(tmp, ".olt"), { recursive: true });
      expect(() =>
        initRun(tmp, "invalid run id with spaces!", new Uint8Array(), "file", true),
      ).toThrow(HarnessError);
      expect(() => initRun(tmp, "run-1", new Uint8Array(), "invalid_capture_mode", true)).toThrow(
        HarnessError,
      );
      expect(() => initRun(tmp, "run-1", "not-bytes" as any, "file", true)).toThrow(HarnessError);
      expect(() => initRun(tmp, "run-1", new Uint8Array(), "file", "not-bool" as any)).toThrow(
        HarnessError,
      );
      expect(() =>
        initRun(join(tmp, "nonexistent"), "run-1", new Uint8Array(), "file", true),
      ).toThrow(HarnessError);

      const runRoot = initRun(
        tmp,
        "valid-run-1",
        new TextEncoder().encode("Hello prompt"),
        "file",
        true,
      );
      expect(existsSync(runRoot)).toBe(true);

      const loaded = loadRun(runRoot, false);
      expect(loaded.manifest.run_id).toBe("valid-run-1");
      expect(new TextDecoder().decode(loaded.prompt)).toBe("Hello prompt");

      const projection = loadRunProjection(runRoot);
      expect(projection.manifest.run_id).toBe("valid-run-1");
      expect(projection.events.length).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
