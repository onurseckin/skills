import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import {
  captureAssurance,
  isCaptureMode,
  CAPTURE_MODES,
} from "../../../olt/scripts/src/engine/store/integrity/assurance.ts";
import { verifyIntegrity } from "../../../olt/scripts/src/engine/store/integrity/integrity.ts";
import {
  issue,
  throwIntegrity,
} from "../../../olt/scripts/src/engine/store/integrity/issues.ts";
import { verifyCapsuleLayout } from "../../../olt/scripts/src/engine/store/integrity/layout-integrity.ts";
import {
  diffProjection,
  applyProjectionPatch,
} from "../../../olt/scripts/src/engine/store/projections/projection-patch.ts";
import {
  brainstormingProjection,
  materializedProjections,
  materializeProjections,
  materializedProjectionDigests,
} from "../../../olt/scripts/src/engine/store/projections/materialized-projections.ts";
import {
  appendCapsuleDefect,
  loadCapsuleDefects,
  resolveCapsuleDefect,
  compactCapsuleDefects,
} from "../../../olt/scripts/src/engine/store/recovery/defect-store.ts";
import { quarantineAndTruncateTail } from "../../../olt/scripts/src/engine/store/recovery/forensic-tail.ts";
import { recoverProjection } from "../../../olt/scripts/src/engine/store/recovery/recovery.ts";
import {
  writeTrace,
  appendTraceStep,
} from "../../../olt/scripts/src/engine/store/recovery/trace.ts";
import { writeBlob, listBlobs } from "../../../olt/scripts/src/engine/store/layout/blobs.ts";
import { checkManifest } from "../../../olt/scripts/src/engine/store/layout/manifest.ts";
import { text, isRecord } from "../../../olt/scripts/src/engine/store/layout/layout-json.ts";
import { commandLayout } from "../../../olt/scripts/src/engine/store/layout/layout-commands.ts";
import { packetLayout } from "../../../olt/scripts/src/engine/store/layout/layout-packets.ts";
import {
  renderLayoutReadme,
  initialCapsuleDirectories,
} from "../../../olt/scripts/src/engine/store/layout/layout.ts";
import { initialState } from "../../../olt/scripts/src/engine/store/capsule/state.ts";
import { transact } from "../../../olt/scripts/src/engine/store/events/transaction.ts";
import type { HarnessEvent } from "../../../olt/scripts/src/core/contracts/index.ts";

function makeTmpDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

describe("engine/store/integrity", () => {
  it("validates capture assurance and modes", () => {
    expect(isCaptureMode("file")).toBe(true);
    expect(isCaptureMode("invalid")).toBe(false);
    expect(captureAssurance("file", true)).toBe("source-verified");
    expect(captureAssurance("verbatim_context_copy", false)).toBe("recorded-unverified");
    expect(() => captureAssurance("file", false)).toThrow(HarnessError);
    expect(() => captureAssurance("invalid", true)).toThrow(HarnessError);
  });

  it("creates issues and throws on integrity errors", () => {
    const iss = issue("TEST_CODE", "test message", "path/to/file");
    expect(iss.code).toBe("TEST_CODE");
    expect(iss.message).toBe("test message");
    expect(() => throwIntegrity([iss])).toThrow(HarnessError);
  });

  it("verifies capsule layout and overall integrity", () => {
    const tmp = makeTmpDir("integrity-test-");
    try {
      mkdirSync(join(tmp, ".olt"), { recursive: true });
      const runRoot = initRun(
        tmp,
        "test-run-integ",
        new TextEncoder().encode("prompt"),
        "file",
        true,
      );

      const layoutIssues = verifyCapsuleLayout(runRoot);
      expect(layoutIssues.length).toBe(0);

      const integIssues = verifyIntegrity(runRoot);
      expect(integIssues.length).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("engine/store/projections", () => {
  it("diffs and applies projection patches", () => {
    const before = { a: 1, list: [1, 2, 3], nested: { x: "hello" } };
    const after = { a: 2, list: [1, 2, 4], nested: { x: "world", y: "new" } };
    const patch = diffProjection(before, after);
    expect(patch.length).toBeGreaterThan(0);

    const reconstructed = applyProjectionPatch(before, patch);
    expect(reconstructed).toEqual(after);
  });

  it("manages materialized projections and digests", () => {
    const state = initialState("run-1", "cap-1", "prompt");
    expect(materializedProjections(state)).toEqual([]);
    expect(materializedProjectionDigests(state)).toEqual([]);
  });
});

describe("engine/store/recovery", () => {
  it("appends, loads, resolves, and compacts defects", () => {
    const tmp = makeTmpDir("defects-test-");
    try {
      mkdirSync(join(tmp, ".olt"), { recursive: true });
      const runRoot = initRun(
        tmp,
        "test-run-defects",
        new TextEncoder().encode("prompt"),
        "file",
        true,
      );

      const defect = appendCapsuleDefect(runRoot, {
        id: "def-1",
        severity: "high" as const,
        type: "logic_error",
        observation: "Test defect",
        dedup_key: "fp-1",
      });
      expect(defect).toBeDefined();

      const loaded = loadCapsuleDefects(runRoot);
      expect(loaded.length).toBe(1);

      const resolved = resolveCapsuleDefect(runRoot, defect.id, {
        task_id: "task-1",
        test_assertion: "defect_resolved_by_test",
        resolved_at: new Date().toISOString(),
        verified_by: "actor",
      });
      expect(resolved).toBeDefined();
      expect(resolved?.status).toBe("resolved");

      const compacted = compactCapsuleDefects(runRoot);
      expect(compacted.totalBefore).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handles quarantine of torn tail and projection recovery", () => {
    const tmp = makeTmpDir("recovery-test-");
    try {
      mkdirSync(join(tmp, ".olt"), { recursive: true });
      const runRoot = initRun(
        tmp,
        "test-run-recov",
        new TextEncoder().encode("prompt"),
        "file",
        true,
      );

      transact(runRoot, "actor", "setup", { ready: true }, (state) => {
        state.tasks = { "t-1": { id: "t-1", status: "ready", requirement_ids: [] } };
      });

      const state = recoverProjection(runRoot, "actor");
      expect(state.revision).toBeGreaterThanOrEqual(1);
      expect(state.tasks["t-1"]).toBeDefined();

      const eventsPath = join(runRoot, "events.jsonl");
      const quarDir = join(runRoot, "quarantine");
      mkdirSync(quarDir, { recursive: true });
      const frag = quarantineAndTruncateTail(eventsPath, 0, quarDir);
      expect(typeof frag).toBe("string");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes and appends trace records", () => {
    const tmp = makeTmpDir("trace-test-");
    try {
      mkdirSync(join(tmp, ".olt"), { recursive: true });
      const runRoot = initRun(
        tmp,
        "test-run-trace",
        new TextEncoder().encode("prompt"),
        "file",
        true,
      );

      const mockEvent: HarnessEvent = {
        schema: "harness.event",
        version: 1,
        sequence: 1,
        revision: 1,
        timestamp: "2026-08-30T00:00:00Z",
        actor: "coordinator",
        kind: "task_started",
        hash: "sha123",
        previous_hash: null,
        payload: { task_id: "task-1", status: "running" },
      };

      writeTrace(runRoot, [mockEvent]);
      expect(existsSync(join(runRoot, "trace.md"))).toBe(true);

      appendTraceStep(runRoot, mockEvent);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("engine/store/layout", () => {
  it("reads and writes blobs and validates command and packet layouts", () => {
    const tmp = makeTmpDir("layout-test-");
    try {
      mkdirSync(join(tmp, ".olt"), { recursive: true });
      const runRoot = initRun(
        tmp,
        "test-run-layout",
        new TextEncoder().encode("prompt"),
        "file",
        true,
      );

      const blobSource = join(tmp, "source-blob.txt");
      writeFileSync(blobSource, "blob content");
      const blob = writeBlob(runRoot, blobSource);
      expect(blob.sha256).toBeDefined();

      const blobs = listBlobs(runRoot);
      expect(blobs.length).toBe(1);

      expect(text("hello")).toBe("hello");
      expect(text("")).toBeUndefined();
      expect(isRecord({ a: 1 })).toBe(true);
      expect(isRecord("str")).toBe(false);

      const cmdIssues = commandLayout(runRoot, {});
      expect(cmdIssues.length).toBe(0);

      const pktIssues = packetLayout(runRoot, {});
      expect(pktIssues.length).toBe(0);

      const check = checkManifest(runRoot);
      expect(check.issues.length).toBe(0);

      const readme = renderLayoutReadme("test-run-layout");
      expect(readme).toContain("test-run-layout");

      const dirs = initialCapsuleDirectories();
      expect(dirs).toContain("planning");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
