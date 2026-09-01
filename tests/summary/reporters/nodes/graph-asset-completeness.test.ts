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
const openFds = new Map<number, { path: string; content: Buffer }>();
let nextFd = 100,
  rootCounter = 0;
const spies: Array<{ mockRestore: () => void }> = [];
const norm = (p: fs.PathLike) => resolve(String(p)).replace(/\/+$/, "");

beforeEach(() => {
  const oe = fs.existsSync.bind(fs),
    or = fs.readFileSync.bind(fs),
    ow = fs.writeFileSync.bind(fs),
    om = fs.mkdirSync.bind(fs);
  const orm = fs.rmSync.bind(fs),
    orp = fs.realpathSync.bind(fs),
    ol = fs.lstatSync.bind(fs),
    oo = fs.openSync.bind(fs);
  const orsync = fs.readSync.bind(fs),
    oc = fs.closeSync.bind(fs),
    owsync = fs.writeSync.bind(fs),
    ofs = fs.fsyncSync.bind(fs);
  const orn = fs.renameSync.bind(fs),
    och = fs.chmodSync.bind(fs);

  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p) =>
      norm(p).startsWith("/virtual/")
        ? vfs.has(norm(p)) || Array.from(vfs.keys()).some((k) => k.startsWith(`${norm(p)}/`))
        : oe(p),
    ),
    spyOn(fs, "readFileSync").mockImplementation((p, opt) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const c = vfs.get(s);
        if (!c) throw new Error(`ENOENT: ${s}`);
        return opt === "utf-8" || opt === "utf8" || (typeof opt === "object" && opt)
          ? c.toString("utf-8")
          : c;
      }
      return or(p, opt as Parameters<typeof or>[1]);
    }),
    spyOn(fs, "writeFileSync").mockImplementation((p, d) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vfs.set(
          s,
          Buffer.isBuffer(d)
            ? d
            : typeof d === "string"
              ? Buffer.from(d, "utf-8")
              : Buffer.from(d.buffer, d.byteOffset, d.byteLength),
        );
        return;
      }
      ow(p, d);
    }),
    spyOn(fs, "mkdirSync").mockImplementation((p) =>
      norm(p).startsWith("/virtual/") ? undefined : (om(p) as string | undefined),
    ),
    spyOn(fs, "rmSync").mockImplementation((p) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vfs.delete(s);
        for (const k of Array.from(vfs.keys())) if (k.startsWith(`${s}/`)) vfs.delete(k);
        return;
      }
      orm(p, { recursive: true, force: true });
    }),
    spyOn(fs, "realpathSync").mockImplementation((p) =>
      norm(p).startsWith("/virtual/") ? norm(p) : orp(p),
    ),
    spyOn(fs, "lstatSync").mockImplementation((p) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const isF = vfs.has(s),
          isD = !isF && Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`));
        if (!isF && !isD) throw new Error(`ENOENT: ${s}`);
        return {
          isFile: () => isF,
          isDirectory: () => isD,
          isSymbolicLink: () => false,
          size: isF ? vfs.get(s)!.length : 0,
        } as unknown as fs.Stats;
      }
      return ol(p);
    }),
    spyOn(fs, "openSync").mockImplementation((p, f) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        let c = vfs.get(s);
        if (!c) {
          c = Buffer.alloc(0);
          vfs.set(s, c);
        }
        const fd = ++nextFd;
        openFds.set(fd, { path: s, content: c });
        return fd;
      }
      return oo(p, f);
    }),
    spyOn(fs, "readSync").mockImplementation((fd, buf, off = 0, len = buf.byteLength, pos = 0) => {
      const f = openFds.get(fd);
      if (f) {
        const p = typeof pos === "number" ? pos : 0;
        const slice = f.content.subarray(p, p + len);
        slice.copy(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength), off);
        return slice.length;
      }
      return orsync(fd, buf, off, len, pos);
    }),
    spyOn(fs, "writeSync").mockImplementation((fd, buf, off, len, pos) => {
      const f = openFds.get(fd);
      if (f) {
        const b =
          typeof buf === "string"
            ? Buffer.from(buf, "utf-8")
            : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
        const chunk = b.subarray(off ?? 0, (off ?? 0) + (len ?? b.length));
        f.content = Buffer.concat([f.content, chunk]);
        vfs.set(f.path, f.content);
        return chunk.length;
      }
      return owsync(fd, buf as NodeJS.ArrayBufferView, off, len, pos);
    }),
    spyOn(fs, "fsyncSync").mockImplementation((fd) => (openFds.has(fd) ? undefined : ofs(fd))),
    spyOn(fs, "renameSync").mockImplementation((o, np) => {
      const so = norm(o),
        sn = norm(np);
      if (so.startsWith("/virtual/") || sn.startsWith("/virtual/")) {
        const c = vfs.get(so);
        if (c) {
          vfs.delete(so);
          vfs.set(sn, c);
        }
        return;
      }
      orn(o, np);
    }),
    spyOn(fs, "chmodSync").mockImplementation((p, m) =>
      norm(p).startsWith("/virtual/") ? undefined : och(p, m),
    ),
    spyOn(fs, "closeSync").mockImplementation((fd) =>
      openFds.has(fd) ? (openFds.delete(fd), undefined) : oc(fd),
    ),
  );
});

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  openFds.clear();
});

function runRoot(): string {
  rootCounter += 1;
  const root = `/virtual/graph-asset-completeness-${rootCounter}`;
  vfs.set(`${root}/evidence`, Buffer.alloc(0));
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
    const root = runRoot(),
      path = "evidence/impl-shot.png",
      bytes = writePng(root, path, 1440, 900);
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
    const root = runRoot(),
      path = "evidence/orphan-capture.png",
      bytes = writePng(root, path, 320, 240);
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
    const root = runRoot(),
      path = "evidence/never-written.png";
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
