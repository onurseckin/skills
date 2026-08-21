import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { quarantineAndTruncateTail } from "../../../orchestrating-long-tasks/scripts/src/store/forensic-tail.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "store-forensic-tail-"));
  roots.push(root);
  return root;
}

describe("quarantineAndTruncateTail", () => {
  test("moves the torn suffix into a quarantine fragment and truncates the source to the complete prefix", () => {
    const root = scratchRoot();
    const eventsPath = join(root, "events.jsonl");
    writeFileSync(eventsPath, "complete-line\npartial-tail-fragment");
    const quarantine = join(root, "quarantine");
    mkdirSync(quarantine);
    const completeBytes = "complete-line\n".length;
    const destination = quarantineAndTruncateTail(eventsPath, completeBytes, quarantine);
    expect(existsSync(destination)).toBe(true);
    expect(readFileSync(destination, "utf-8")).toBe("partial-tail-fragment");
    expect(readFileSync(eventsPath, "utf-8")).toBe("complete-line\n");
    const fragments = readdirSync(quarantine);
    expect(fragments).toEqual([expect.stringMatching(/^recovery-torn-.*\.fragment$/)]);
  });

  test("quarantines the entire file when completeBytes is zero", () => {
    const root = scratchRoot();
    const eventsPath = join(root, "events.jsonl");
    writeFileSync(eventsPath, "all-of-this-is-torn");
    const quarantine = join(root, "quarantine");
    mkdirSync(quarantine);
    const destination = quarantineAndTruncateTail(eventsPath, 0, quarantine);
    expect(readFileSync(destination, "utf-8")).toBe("all-of-this-is-torn");
    expect(readFileSync(eventsPath, "utf-8")).toBe("");
  });

  test("makes the quarantined fragment read-only", () => {
    const root = scratchRoot();
    const eventsPath = join(root, "events.jsonl");
    writeFileSync(eventsPath, "line\ntorn");
    const quarantine = join(root, "quarantine");
    mkdirSync(quarantine);
    const destination = quarantineAndTruncateTail(eventsPath, "line\n".length, quarantine);
    const mode = statSync(destination).mode;
    expect((mode & 0o222) === 0).toBe(true);
  });

  test("throws and leaves no temporary file behind when the source is not a regular file", () => {
    const root = scratchRoot();
    const eventsPath = join(root, "a-directory");
    mkdirSync(eventsPath);
    const quarantine = join(root, "quarantine");
    mkdirSync(quarantine);
    expect(() => quarantineAndTruncateTail(eventsPath, 0, quarantine)).toThrow(
      /not a regular file/,
    );
    expect(readdirSync(quarantine)).toEqual([]);
  });

  test("throws and cleans up the temporary file when copying fails after it was already created", () => {
    const root = scratchRoot();
    const eventsPath = join(root, "events.jsonl");
    writeFileSync(eventsPath, "content");
    // A quarantine directory that does not exist lets openSync(temporary, ...) fail with ENOENT
    // after the source has already been opened, exercising the catch's cleanup path with output
    // still undefined and no temporary file to remove.
    const missingQuarantine = join(root, "does-not-exist");
    expect(() => quarantineAndTruncateTail(eventsPath, 0, missingQuarantine)).toThrow();
  });
});
