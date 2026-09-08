import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  loadPurityBaseline,
  parseBaseline,
  PURITY_BASELINE_SCHEMA,
  serializeBaseline,
} from "../../../../scripts/testing/purity-ratchet/index.ts";

const HEADER = `{"schema":"${PURITY_BASELINE_SCHEMA}"}`;

describe("purity ratchet baseline document parsing", () => {
  test("parses a header followed by per-file per-rule entries", () => {
    const document = parseBaseline(
      [
        HEADER,
        '{"file":"tests/alpha.test.ts","rule":"no-physical-fs-call","count":3}',
        '{"file":"tests/beta.test.ts","rule":"no-unmocked-subprocess-call","count":1}',
        "",
      ].join("\n"),
    );

    expect(document.schema).toBe(PURITY_BASELINE_SCHEMA);
    expect(document.entries).toEqual([
      { file: "tests/alpha.test.ts", rule: "no-physical-fs-call", count: 3 },
      { file: "tests/beta.test.ts", rule: "no-unmocked-subprocess-call", count: 1 },
    ]);
  });

  test("round-trips a serialized baseline back into the same entries", () => {
    const entries = [
      { file: "tests/zeta.test.ts", rule: "no-physical-fs-call", count: 9 },
      { file: "tests/alpha.test.ts", rule: "no-unmocked-bun-spawn", count: 2 },
    ];
    const serialized = serializeBaseline(entries);

    expect(serialized.split("\n")[0]).toBe(HEADER);
    expect(parseBaseline(serialized).entries).toEqual([
      { file: "tests/alpha.test.ts", rule: "no-unmocked-bun-spawn", count: 2 },
      { file: "tests/zeta.test.ts", rule: "no-physical-fs-call", count: 9 },
    ]);
  });

  test("round-trips entries with human reasons preserving them byte-for-byte", () => {
    const reason = "containment auditor: asserts against live fs by design";
    const entries = [
      {
        file: "tests/sandbox.test.ts",
        rule: "no-physical-fs-call",
        count: 34,
        reason,
      },
      { file: "tests/clean.test.ts", rule: "no-physical-fs-import", count: 1 },
    ];
    const serialized = serializeBaseline(entries);
    const parsed = parseBaseline(serialized);

    expect(parsed.entries).toEqual([
      { file: "tests/clean.test.ts", rule: "no-physical-fs-import", count: 1 },
      {
        file: "tests/sandbox.test.ts",
        rule: "no-physical-fs-call",
        count: 34,
        reason,
      },
    ]);
  });

  test("rejects a document with a missing or stale schema header", () => {
    expect(() => parseBaseline("")).toThrow("stale or missing schema");
    expect(() => parseBaseline('{"schema":"olt-purity-baseline/v0"}\n')).toThrow(
      "stale or missing schema",
    );
  });

  test("rejects malformed entries rather than silently dropping them", () => {
    expect(() => parseBaseline(`${HEADER}\nnot-json\n`)).toThrow("not valid JSON");
    expect(() => parseBaseline(`${HEADER}\n{"file":"","rule":"r","count":1}\n`)).toThrow(
      "invalid file",
    );
    expect(() => parseBaseline(`${HEADER}\n{"file":"f","rule":"","count":1}\n`)).toThrow(
      "invalid rule",
    );
    expect(() => parseBaseline(`${HEADER}\n{"file":"f","rule":"r","count":0}\n`)).toThrow(
      "invalid count",
    );
    expect(() => parseBaseline(`${HEADER}\n{"file":"f","rule":"r","count":1,"x":2}\n`)).toThrow(
      "unknown keys",
    );
    expect(() => parseBaseline(`${HEADER}\n[1,2,3]\n`)).toThrow("must be an object");
  });

  test("rejects a duplicate file and rule identity inside one document", () => {
    const text = [
      HEADER,
      '{"file":"tests/a.test.ts","rule":"no-physical-fs-call","count":1}',
      '{"file":"tests/a.test.ts","rule":"no-physical-fs-call","count":2}',
      "",
    ].join("\n");

    expect(() => parseBaseline(text)).toThrow("duplicate identity");
  });
});

describe("purity ratchet baseline loading (in-memory virtual)", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;
  const root = "/virtual/purity-ratchet-baseline";

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
  });

  test("loads a committed baseline document from disk", async () => {
    vfs.writeFileSync(
      join(root, "index.jsonl"),
      serializeBaseline([{ file: "tests/a.test.ts", rule: "no-physical-fs-call", count: 4 }]),
    );

    const document = await loadPurityBaseline(root, "index.jsonl");

    expect(document.entries).toEqual([
      { file: "tests/a.test.ts", rule: "no-physical-fs-call", count: 4 },
    ]);
  });

  test("fails loudly when the baseline file is absent", async () => {
    await expect(loadPurityBaseline(root, "absent.jsonl")).rejects.toThrow("missing baseline file");
  });

  test("refuses a baseline path that escapes the repository", async () => {
    await expect(loadPurityBaseline(root, "../outside.jsonl")).rejects.toThrow(
      "outside the repository",
    );
    await expect(loadPurityBaseline(root, ".")).rejects.toThrow("outside the repository");
  });
});
