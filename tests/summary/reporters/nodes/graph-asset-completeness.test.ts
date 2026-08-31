import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateGraphDataset } from "../../../../olt/scripts/src/summary/graph/index.ts";
import {
  recordCaptures,
  type CaptureRecord,
} from "../../../../olt/scripts/src/engine/store/capsule/captures.ts";
import { makeState, makeTask } from "../dag/graph-fixtures.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "graph-asset-completeness-"));
  roots.push(root);
  mkdirSync(join(root, "evidence"), { recursive: true });
  return root;
}

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  header.writeUInt8(0x89, 0);
  header.write("PNG\r\n\n", 1, "latin1");
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "latin1");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, Buffer.alloc(48)]);
}

function writePng(root: string, relativePath: string, width: number, height: number): number {
  const bytes = png(width, height);
  writeFileSync(join(root, relativePath), bytes);
  return bytes.length;
}

function capture(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    kind: "screenshot",
    name: "shot.png",
    sha256: "a".repeat(64),
    bytes: 0,
    blob_path: "evidence/shot.png",
    path: "evidence/shot.png",
    storage: "copy",
    original_path: "evidence/shot.png",
    ...overrides,
  };
}

describe("captured asset dimensions and byte size reach graph.json", () => {
  test("a reported screenshot's byte size and pixel dimensions are measured from the real file on the implementer node", () => {
    const root = runRoot();
    const path = "evidence/impl-shot.png";
    const bytes = writePng(root, path, 1440, 900);

    const task = makeTask("T-1", {
      status: "done",
      report: { summary: "Implemented A", files_changed: ["src/a.ts"], screenshots: [path] },
    });
    const dataset = generateGraphDataset({
      runId: "run-impl-shot",
      state: makeState([task]),
      promptText: "prompt",
      runRoot: root,
    });

    const asset = dataset.nodes
      .find((node) => node.id === "node-task-T-1")
      ?.assets?.find((candidate) => candidate.url === path);
    expect(asset?.sizeBytes).toBe(bytes);
    expect(asset?.dimensions).toEqual({ width: 1440, height: 900 });
  });

  test("a validator's screenshot is measured the same way, on the validator node", () => {
    const root = runRoot();
    const path = "evidence/val-shot.png";
    const bytes = writePng(root, path, 1024, 768);

    const task = makeTask("T-1", {
      status: "changes_requested",
      validations: [
        {
          validator_id: "val-1",
          domain: "code-quality",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-15T19:20:00.000Z",
          deadline_at: "2026-08-15T19:40:00.000Z",
          verdict: "reject",
          screenshots: [path],
        },
      ],
    });
    const dataset = generateGraphDataset({
      runId: "run-val-shot",
      state: makeState([task]),
      promptText: "prompt",
      runRoot: root,
    });

    const asset = dataset.nodes
      .find((node) => node.id === "node-validator-T-1")
      ?.assets?.find((candidate) => candidate.url === path);
    expect(asset?.sizeBytes).toBe(bytes);
    expect(asset?.dimensions).toEqual({ width: 1024, height: 768 });
  });

  test("a finding's screenshot evidence is measured too, and the finding still points at it by id", () => {
    const root = runRoot();
    const path = "evidence/finding-shot.png";
    const bytes = writePng(root, path, 640, 480);

    const task = makeTask("T-1", {
      status: "changes_requested",
      repair_round: 1,
      validations: [
        {
          validator_id: "val-1",
          domain: "code-quality",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-15T19:20:00.000Z",
          deadline_at: "2026-08-15T19:40:00.000Z",
          verdict: "reject",
        },
      ],
      findings: [
        {
          id: "F-1",
          requirement_id: "REQ-T-1",
          severity: "critical",
          observation: "Layout breaks",
          remediation: "Fix the layout",
          revalidation: "Re-run the gate",
          status: "open",
          screenshots: [path],
        },
      ],
    });
    const dataset = generateGraphDataset({
      runId: "run-finding-shot",
      state: makeState([task]),
      promptText: "prompt",
      runRoot: root,
    });

    const validator = dataset.nodes.find((node) => node.id === "node-validator-T-1");
    const asset = validator?.assets?.find((candidate) => candidate.url === path);
    expect(asset?.sizeBytes).toBe(bytes);
    expect(asset?.dimensions).toEqual({ width: 640, height: 480 });

    const finding = validator?.metadata?.findings?.find((entry) => entry.id === "F-1");
    expect(finding?.screenshotAssetIds).toEqual([asset?.id]);
  });

  test("a harness-recorded screenshot capture keeps its recorded byte count and gains real pixel dimensions from the file", () => {
    const root = runRoot();
    const path = "evidence/gate-capture.png";
    writePng(root, path, 1280, 720);
    const recordedBytes = 999999;
    recordCaptures(root, [
      capture({
        name: "gate-capture.png",
        blob_path: path,
        path,
        original_path: path,
        bytes: recordedBytes,
        task_id: "T-1",
        actor: "val-1",
        timestamp: "2026-08-15T19:20:00.000Z",
      }),
    ]);

    const task = makeTask("T-1", {
      status: "changes_requested",
      validations: [
        {
          validator_id: "val-1",
          domain: "code-quality",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-15T19:20:00.000Z",
          deadline_at: "2026-08-15T19:40:00.000Z",
          verdict: "reject",
        },
      ],
    });
    const dataset = generateGraphDataset({
      runId: "run-gate-capture",
      state: makeState([task]),
      promptText: "prompt",
      runRoot: root,
    });

    const asset = dataset.nodes
      .find((node) => node.id === "node-validator-T-1")
      ?.assets?.find((candidate) => candidate.url === path);
    expect(asset?.sizeBytes).toBe(recordedBytes);
    expect(asset?.dimensions).toEqual({ width: 1280, height: 720 });
  });

  test("an unattributed screenshot capture still reaches the terminal node with its measured facts", () => {
    const root = runRoot();
    const path = "evidence/orphan-capture.png";
    const bytes = writePng(root, path, 320, 240);
    recordCaptures(root, [
      capture({
        name: "orphan-capture.png",
        blob_path: path,
        path,
        original_path: path,
        bytes,
      }),
    ]);

    const dataset = generateGraphDataset({
      runId: "run-orphan-capture",
      state: makeState([makeTask("T-1")]),
      promptText: "prompt",
      runRoot: root,
    });

    const terminal = dataset.nodes.find((node) => node.id === "node-terminal-complete");
    const asset = terminal?.assets?.find((candidate) => candidate.url === path);
    expect(asset?.sizeBytes).toBe(bytes);
    expect(asset?.dimensions).toEqual({ width: 320, height: 240 });
  });

  test("a screenshot path that resolves to no real file keeps size and dimensions absent rather than fabricated", () => {
    const root = runRoot();
    const path = "evidence/never-written.png";

    const task = makeTask("T-1", {
      status: "done",
      report: { summary: "Implemented A", files_changed: ["src/a.ts"], screenshots: [path] },
    });
    const dataset = generateGraphDataset({
      runId: "run-missing-shot",
      state: makeState([task]),
      promptText: "prompt",
      runRoot: root,
    });

    const asset = dataset.nodes
      .find((node) => node.id === "node-task-T-1")
      ?.assets?.find((candidate) => candidate.url === path);
    expect(asset).toBeDefined();
    expect(asset?.sizeBytes).toBeUndefined();
    expect(asset?.dimensions).toBeUndefined();
  });
});
