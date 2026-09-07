import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { readRegularFileNoFollow } from "../../../olt/scripts/src/core/no-follow.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("core/no-follow.ts", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  it("reads regular file contents safely", () => {
    const vRoot = "/virtual-nofollow-test";
    vfs.mkdirSync(vRoot, { recursive: true });
    const file = join(vRoot, "regular.txt");
    vfs.writeFileSync(file, Buffer.from("hello nofollow", "utf8"));

    const bytes = readRegularFileNoFollow(file);
    expect(new TextDecoder().decode(bytes)).toBe("hello nofollow");

    const dir = join(vRoot, "directory");
    vfs.mkdirSync(dir, { recursive: true });
    expect(() => readRegularFileNoFollow(dir)).toThrow("not a regular file");
  });
});
