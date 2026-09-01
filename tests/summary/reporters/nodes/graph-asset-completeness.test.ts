import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateGraphDataset } from "../../../../olt/scripts/src/summary/graph/index.ts";
import { recordCaptures } from "../../../../olt/scripts/src/engine/store/capsule/captures.ts";
import { makeState, makeTask } from "../dag/graph-fixtures.ts";
import {
  capture,
  cleanupAssetVirtualFS,
  runRoot,
  setupAssetVirtualFS,
  writePng,
} from "./graph-asset-fixtures.ts";

beforeEach(() => {
  setupAssetVirtualFS();
});

afterEach(() => {
  cleanupAssetVirtualFS();
});

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
      .find((n) => n.id === "node-task-T-1")
      ?.assets?.find((c) => c.url === path);
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
      .find((n) => n.id === "node-validator-T-1")
      ?.assets?.find((c) => c.url === path);
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
    const validator = dataset.nodes.find((n) => n.id === "node-validator-T-1");
    const asset = validator?.assets?.find((c) => c.url === path);
    expect(asset?.sizeBytes).toBe(bytes);
    expect(asset?.dimensions).toEqual({ width: 640, height: 480 });
    const finding = validator?.metadata?.findings?.find((e) => e.id === "F-1");
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
      .find((n) => n.id === "node-validator-T-1")
      ?.assets?.find((c) => c.url === path);
    expect(asset?.sizeBytes).toBe(recordedBytes);
    expect(asset?.dimensions).toEqual({ width: 1280, height: 720 });
  });

  test("an unattributed screenshot capture still reaches the terminal node with its measured facts", () => {
    const root = runRoot();
    const path = "evidence/orphan-capture.png";
    const bytes = writePng(root, path, 320, 240);
    recordCaptures(root, [
      capture({ name: "orphan-capture.png", blob_path: path, path, original_path: path, bytes }),
    ]);
    const dataset = generateGraphDataset({
      runId: "run-orphan-capture",
      state: makeState([makeTask("T-1")]),
      promptText: "prompt",
      runRoot: root,
    });
    const terminal = dataset.nodes.find((n) => n.id === "node-terminal-complete");
    const asset = terminal?.assets?.find((c) => c.url === path);
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
      .find((n) => n.id === "node-task-T-1")
      ?.assets?.find((c) => c.url === path);
    expect(asset).toBeDefined();
    expect(asset?.sizeBytes).toBeUndefined();
    expect(asset?.dimensions).toBeUndefined();
  });
});
