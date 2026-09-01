import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generateGraphDataset } from "../../../../olt/scripts/src/summary/graph/index.ts";
import {
  recordCaptures,
  type CaptureRecord,
} from "../../../../olt/scripts/src/engine/store/capsule/captures.ts";
import { makeState, makeTask } from "../dag/graph-fixtures.ts";

const vfs = new Map<string, Buffer>();
const vdirs = new Set<string>();
const openFds = new Map<number, { path: string; content: Buffer }>();
let nextFd = 100;
let rootCounter = 0;
const spies: Array<{ mockRestore: () => void }> = [];

const origExists = fs.existsSync.bind(fs);
const origRead = fs.readFileSync.bind(fs);
const origWrite = fs.writeFileSync.bind(fs);
const origMkdir = fs.mkdirSync.bind(fs);
const origRm = fs.rmSync.bind(fs);
const origRealpath = fs.realpathSync.bind(fs);
const origLstat = fs.lstatSync.bind(fs);
const origOpen = fs.openSync.bind(fs);
const origReadSync = fs.readSync.bind(fs);
const origClose = fs.closeSync.bind(fs);

beforeEach(() => {
  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike): boolean => {
      const s = resolve(String(p)).replace(/\/+$/, "");
      if (s.startsWith("/virtual/")) {
        if (vfs.has(s) || vdirs.has(s)) return true;
        for (const k of vfs.keys()) {
          if (k.startsWith(`${s}/`)) return true;
        }
        for (const d of vdirs) {
          if (d.startsWith(`${s}/`)) return true;
        }
        return false;
      }
      return origExists(p);
    }),
    spyOn(fs, "readFileSync").mockImplementation(
      (p: fs.PathLike, opt?: unknown): string | Buffer => {
        const s = resolve(String(p)).replace(/\/+$/, "");
        if (s.startsWith("/virtual/")) {
          const content = vfs.get(s);
          if (content === undefined) {
            throw new Error(`ENOENT: no such file or directory, open '${s}'`);
          }
          if (opt === "utf-8" || opt === "utf8" || (typeof opt === "object" && opt !== null)) {
            return content.toString("utf-8");
          }
          return content;
        }
        return origRead(p, opt as Parameters<typeof origRead>[1]) as string | Buffer;
      },
    ),
    spyOn(fs, "writeFileSync").mockImplementation(
      (p: fs.PathLike, data: string | NodeJS.ArrayBufferView): void => {
        const s = resolve(String(p)).replace(/\/+$/, "");
        if (s.startsWith("/virtual/")) {
          const buf = Buffer.isBuffer(data)
            ? data
            : typeof data === "string"
              ? Buffer.from(data, "utf-8")
              : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
          vfs.set(s, buf);
          return;
        }
        origWrite(p, data);
      },
    ),
    spyOn(fs, "mkdirSync").mockImplementation((p: fs.PathLike): string | undefined => {
      const s = resolve(String(p)).replace(/\/+$/, "");
      if (s.startsWith("/virtual/")) {
        vdirs.add(s);
        return undefined;
      }
      return origMkdir(p) as string | undefined;
    }),
    spyOn(fs, "rmSync").mockImplementation((p: fs.PathLike): void => {
      const s = resolve(String(p)).replace(/\/+$/, "");
      if (s.startsWith("/virtual/")) {
        vfs.delete(s);
        vdirs.delete(s);
        for (const k of Array.from(vfs.keys())) {
          if (k.startsWith(`${s}/`)) vfs.delete(k);
        }
        for (const d of Array.from(vdirs)) {
          if (d.startsWith(`${s}/`)) vdirs.delete(d);
        }
        return;
      }
      origRm(p, { recursive: true, force: true });
    }),
    spyOn(fs, "realpathSync").mockImplementation((p: fs.PathLike): string => {
      const s = resolve(String(p)).replace(/\/+$/, "");
      if (s.startsWith("/virtual/")) {
        return s;
      }
      return origRealpath(p);
    }),
    spyOn(fs, "lstatSync").mockImplementation((p: fs.PathLike): fs.Stats => {
      const s = resolve(String(p)).replace(/\/+$/, "");
      if (s.startsWith("/virtual/")) {
        const isFile = vfs.has(s);
        const isDir = vdirs.has(s) || (!isFile && Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`)));
        if (!isFile && !isDir) {
          throw new Error(`ENOENT: no such file or directory, lstat '${s}'`);
        }
        const size = isFile ? vfs.get(s)!.length : 0;
        return {
          isFile: () => isFile,
          isDirectory: () => isDir,
          isSymbolicLink: () => false,
          size,
        } as unknown as fs.Stats;
      }
      return origLstat(p);
    }),
    spyOn(fs, "openSync").mockImplementation((p: fs.PathLike, flags: fs.OpenMode): number => {
      const s = resolve(String(p)).replace(/\/+$/, "");
      if (s.startsWith("/virtual/")) {
        const content = vfs.get(s);
        if (!content) {
          throw new Error(`ENOENT: no such file or directory, open '${s}'`);
        }
        const fd = ++nextFd;
        openFds.set(fd, { path: s, content });
        return fd;
      }
      return origOpen(p, flags);
    }),
    spyOn(fs, "readSync").mockImplementation(
      (
        fd: number,
        buffer: NodeJS.ArrayBufferView,
        offset = 0,
        length = buffer.byteLength,
        position: fs.ReadPosition | null = 0,
      ): number => {
        const openFile = openFds.get(fd);
        if (openFile) {
          const content = openFile.content;
          const pos = typeof position === "number" ? position : 0;
          const slice = content.subarray(pos, pos + length);
          const targetBuf = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
          slice.copy(targetBuf, offset);
          return slice.length;
        }
        return origReadSync(fd, buffer, offset, length, position);
      },
    ),
    spyOn(fs, "closeSync").mockImplementation((fd: number): void => {
      if (openFds.has(fd)) {
        openFds.delete(fd);
        return;
      }
      origClose(fd);
    }),
  );
});

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  vdirs.clear();
  openFds.clear();
});

function runRoot(): string {
  rootCounter += 1;
  const root = `/virtual/graph-asset-completeness-${rootCounter}`;
  vdirs.add(root);
  vdirs.add(join(root, "evidence"));
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
