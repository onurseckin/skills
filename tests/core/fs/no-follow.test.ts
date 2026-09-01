import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { readRegularFileNoFollow } from "../../../olt/scripts/src/core/no-follow.ts";

describe("core/no-follow.ts", () => {
  const mockFiles = new Map<string, Buffer>();
  const mockDirs = new Set<string>();
  const fdMap = new Map<number, string>();
  const spies: { mockRestore: () => void }[] = [];
  let fdCounter = 300;

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    fdMap.clear();

    spies.push(
      spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike) => {
        const s = String(p);
        if (!mockFiles.has(s) && !mockDirs.has(s)) {
          const err = new Error(`ENOENT: no such file or directory, open '${s}'`) as Error & {
            code: string;
          };
          err.code = "ENOENT";
          throw err;
        }
        const fd = ++fdCounter;
        fdMap.set(fd, s);
        return fd;
      }) as unknown as typeof fs.openSync),
      spyOn(fs, "fstatSync").mockImplementation(((fd: number) => {
        const s = fdMap.get(fd) ?? "";
        const isF = mockFiles.has(s);
        const isD = mockDirs.has(s);
        return {
          isFile: () => isF,
          isDirectory: () => isD,
          isSymbolicLink: () => false,
          size: isF ? mockFiles.get(s)!.length : 0,
        } as unknown as fs.Stats;
      }) as unknown as typeof fs.fstatSync),
      spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor) => {
        const s = typeof p === "number" ? (fdMap.get(p) ?? "") : String(p);
        const data = mockFiles.get(s);
        if (data !== undefined) return data;
        throw new Error(`ENOENT: no such file, open '${s}'`);
      }) as unknown as typeof fs.readFileSync),
      spyOn(fs, "closeSync").mockImplementation(((fd: number) => {
        fdMap.delete(fd);
      }) as unknown as typeof fs.closeSync),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  it("reads regular file contents safely", () => {
    const vRoot = "/virtual-nofollow-test";
    const file = join(vRoot, "regular.txt");
    mockFiles.set(file, Buffer.from("hello nofollow", "utf8"));

    const bytes = readRegularFileNoFollow(file);
    expect(new TextDecoder().decode(bytes)).toBe("hello nofollow");

    const dir = join(vRoot, "directory");
    mockDirs.add(dir);
    expect(() => readRegularFileNoFollow(dir)).toThrow("not a regular file");
  });
});
