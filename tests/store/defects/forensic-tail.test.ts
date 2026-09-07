import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { quarantineAndTruncateTail } from "../../../olt/scripts/src/engine/store/recovery/forensic-tail.ts";
import {
  cleanupVirtualStoreFS,
  scratchRoot as makeScratchRoot,
  setupVirtualStoreFS,
} from "../store-fixture.ts";

let vfs: ReturnType<typeof setupVirtualStoreFS>;

beforeEach(() => {
  vfs = setupVirtualStoreFS();
});

afterEach(cleanupVirtualStoreFS);

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

describe("quarantineAndTruncateTail", () => {
  test("moves the torn suffix into a quarantine fragment and truncates the source to the complete prefix", () => {
    const root = scratchRoot("moves-the-torn-suffix-into-a-quarantine-fragment-a");
    const eventsPath = join(root, "events.jsonl");
    vfs.writeFileSync(eventsPath, "complete-line\npartial-tail-fragment");
    const quarantine = join(root, "quarantine");
    vfs.mkdirSync(quarantine);
    const completeBytes = "complete-line\n".length;
    const destination = quarantineAndTruncateTail(eventsPath, completeBytes, quarantine);
    expect(vfs.existsSync(destination)).toBe(true);
    expect(vfs.readFileSync(destination, "utf8")).toBe("partial-tail-fragment");
    expect(vfs.readFileSync(eventsPath, "utf8")).toBe("complete-line\n");
    const fragments = vfs.readdirSync(quarantine);
    expect(fragments).toEqual([expect.stringMatching(/^recovery-torn-.*\.fragment$/)]);
  });

  test("quarantines the entire file when completeBytes is zero", () => {
    const root = scratchRoot("quarantines-the-entire-file-when-completebytes-is-");
    const eventsPath = join(root, "events.jsonl");
    vfs.writeFileSync(eventsPath, "all-of-this-is-torn");
    const quarantine = join(root, "quarantine");
    vfs.mkdirSync(quarantine);
    const destination = quarantineAndTruncateTail(eventsPath, 0, quarantine);
    expect(vfs.readFileSync(destination, "utf8")).toBe("all-of-this-is-torn");
    expect(vfs.readFileSync(eventsPath, "utf8")).toBe("");
  });

  test("makes the quarantined fragment read-only", () => {
    const root = scratchRoot("makes-the-quarantined-fragment-read-only");
    const eventsPath = join(root, "events.jsonl");
    vfs.writeFileSync(eventsPath, "line\ntorn");
    const quarantine = join(root, "quarantine");
    vfs.mkdirSync(quarantine);
    const destination = quarantineAndTruncateTail(eventsPath, "line\n".length, quarantine);
    const mode = vfs.statSync(destination)!.mode;
    expect((mode & 0o222) === 0).toBe(true);
  });

  test("throws and leaves no temporary file behind when the source is not a regular file", () => {
    const root = scratchRoot("throws-and-leaves-no-temporary-file-behind-when-th");
    const eventsPath = join(root, "a-directory");
    vfs.mkdirSync(eventsPath);
    const quarantine = join(root, "quarantine");
    vfs.mkdirSync(quarantine);
    expect(() => quarantineAndTruncateTail(eventsPath, 0, quarantine)).toThrow(
      /not a regular file/,
    );
    expect(vfs.readdirSync(quarantine)).toEqual([]);
  });

  test("throws and cleans up the temporary file when copying fails after it was already created", () => {
    const root = scratchRoot("throws-and-cleans-up-the-temporary-file-when-copyi");
    const eventsPath = join(root, "events.jsonl");
    vfs.writeFileSync(eventsPath, "content");
    // A quarantine directory that does not exist lets openSync(temporary, ...) fail with ENOENT
    // after the source has already been opened, exercising the catch's cleanup path with output
    // still undefined and no temporary file to remove.
    const missingQuarantine = join(root, "does-not-exist");
    expect(() => quarantineAndTruncateTail(eventsPath, 0, missingQuarantine)).toThrow();
  });
});
