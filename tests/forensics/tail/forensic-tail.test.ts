import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { quarantineAndTruncateTail } from "../../../olt/scripts/src/engine/store/recovery/forensic-tail.ts";
import {
  cleanupVirtualBrowserFS,
  setupVirtualBrowserFS,
  tempDir,
} from "../../reporting/browser/browser-virtual-fs.ts";

function makeSandbox(): string {
  return tempDir("forensic-tail");
}

describe("quarantineAndTruncateTail", () => {
  beforeEach(() => {
    setupVirtualBrowserFS();
  });

  afterEach(() => {
    cleanupVirtualBrowserFS();
  });

  test("moves the torn suffix into a quarantine fragment and truncates the source to the complete prefix", () => {
    const root = makeSandbox();
    const eventsPath = join(root, "events.jsonl");
    fs.writeFileSync(eventsPath, "complete-line\npartial-tail-fragment");
    const quarantine = join(root, "quarantine");
    fs.mkdirSync(quarantine);
    const completeBytes = "complete-line\n".length;
    const destination = quarantineAndTruncateTail(eventsPath, completeBytes, quarantine);
    expect(fs.existsSync(destination)).toBe(true);
    expect(fs.readFileSync(destination, "utf-8")).toBe("partial-tail-fragment");
    expect(fs.readFileSync(eventsPath, "utf-8")).toBe("complete-line\n");
    const fragments = fs.readdirSync(quarantine);
    expect(fragments).toEqual([expect.stringMatching(/^recovery-torn-.*\.fragment$/)]);
  });

  test("quarantines the entire file when completeBytes is zero", () => {
    const root = makeSandbox();
    const eventsPath = join(root, "events.jsonl");
    fs.writeFileSync(eventsPath, "all-of-this-is-torn");
    const quarantine = join(root, "quarantine");
    fs.mkdirSync(quarantine);
    const destination = quarantineAndTruncateTail(eventsPath, 0, quarantine);
    expect(fs.readFileSync(destination, "utf-8")).toBe("all-of-this-is-torn");
    expect(fs.readFileSync(eventsPath, "utf-8")).toBe("");
  });

  test("makes the quarantined fragment read-only", () => {
    const root = makeSandbox();
    const eventsPath = join(root, "events.jsonl");
    fs.writeFileSync(eventsPath, "line\ntorn");
    const quarantine = join(root, "quarantine");
    fs.mkdirSync(quarantine);
    const destination = quarantineAndTruncateTail(eventsPath, "line\n".length, quarantine);
    const mode = fs.statSync(destination).mode;
    expect((mode & 0o222) === 0).toBe(true);
  });

  test("throws and leaves no temporary file behind when the source is not a regular file", () => {
    const root = makeSandbox();
    const eventsPath = join(root, "a-directory");
    fs.mkdirSync(eventsPath);
    const quarantine = join(root, "quarantine");
    fs.mkdirSync(quarantine);
    expect(() => quarantineAndTruncateTail(eventsPath, 0, quarantine)).toThrow(
      /not a regular file/,
    );
    expect(fs.readdirSync(quarantine)).toEqual([]);
  });

  test("throws and cleans up the temporary file when copying fails after it was already created", () => {
    const root = makeSandbox();
    const eventsPath = join(root, "events.jsonl");
    fs.writeFileSync(eventsPath, "content");
    const missingQuarantine = join(root, "does-not-exist");
    expect(() => quarantineAndTruncateTail(eventsPath, 0, missingQuarantine)).toThrow();
  });
});
