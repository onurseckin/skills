import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { streamEventLines } from "../../../orchestrating-long-tasks/scripts/src/store/event-lines.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "store-event-lines-"));
  roots.push(root);
  return root;
}

function collect(path: string, maximum: number, maximumTotal: number) {
  return [...streamEventLines(path, maximum, maximumTotal)];
}

describe("streamEventLines", () => {
  test("yields nothing for an empty file", () => {
    const root = scratchRoot();
    const path = join(root, "events.jsonl");
    writeFileSync(path, "");
    expect(collect(path, 1024, 1024)).toEqual([]);
  });

  test("yields one terminated line per newline-delimited record", () => {
    const root = scratchRoot();
    const path = join(root, "events.jsonl");
    writeFileSync(path, "line-one\nline-two\n");
    const lines = collect(path, 1024, 1024);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ index: 1, terminated: true, oversized: false });
    expect(Buffer.from(lines[0]!.content).toString()).toBe("line-one");
    expect(lines[1]).toMatchObject({ index: 2, terminated: true, oversized: false });
    expect(Buffer.from(lines[1]!.content).toString()).toBe("line-two");
    expect(lines[1]!.endOffset).toBe("line-one\nline-two\n".length);
  });

  test("yields a final unterminated line when the file has no trailing newline", () => {
    const root = scratchRoot();
    const path = join(root, "events.jsonl");
    writeFileSync(path, "complete\npartial-tail");
    const lines = collect(path, 1024, 1024);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ index: 2, terminated: false, oversized: false });
    expect(Buffer.from(lines[1]!.content).toString()).toBe("partial-tail");
  });

  test("marks a line oversized and truncates its stored content once it exceeds the per-line maximum", () => {
    const root = scratchRoot();
    const path = join(root, "events.jsonl");
    writeFileSync(path, `${"x".repeat(20)}\nnext\n`);
    const lines = collect(path, 5, 1024);
    expect(lines[0]).toMatchObject({ index: 1, terminated: true, oversized: true });
    expect(lines[0]!.content.byteLength).toBe(5);
    expect(lines[1]).toMatchObject({ index: 2, oversized: false });
  });

  test("marks an oversized line even when the available budget is already exhausted at zero", () => {
    const root = scratchRoot();
    const path = join(root, "events.jsonl");
    writeFileSync(path, `${"x".repeat(70_000)}\n`);
    const lines = collect(path, 5, 1024 * 1024);
    expect(lines[0]).toMatchObject({ oversized: true });
    expect(lines[0]!.content.byteLength).toBe(5);
  });

  test("throws when the file's total size exceeds the maximumTotal budget", () => {
    const root = scratchRoot();
    const path = join(root, "events.jsonl");
    writeFileSync(path, "x".repeat(100));
    expect(() => collect(path, 1024, 10)).toThrow(/event log size exceeds limit/);
  });

  test("throws when the path is not a regular file", () => {
    const root = scratchRoot();
    expect(() => collect(root, 1024, 1024)).toThrow(/not a regular file/);
  });

  test("handles a line that spans more than one internal read buffer", () => {
    const root = scratchRoot();
    const path = join(root, "events.jsonl");
    const long = "y".repeat(64 * 1024 + 200);
    writeFileSync(path, `${long}\nshort\n`);
    const lines = collect(path, long.length + 10, 1024 * 1024);
    expect(Buffer.from(lines[0]!.content).toString()).toBe(long);
    expect(Buffer.from(lines[1]!.content).toString()).toBe("short");
  });
});
