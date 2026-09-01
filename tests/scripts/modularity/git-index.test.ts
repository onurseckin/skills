import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { readIndexedBlobs, readTreeBlobs } from "../../../scripts/modularity/inventory/index.ts";

function mockSubprocess(stdout: string | Uint8Array, status = 0, stderr = "") {
  const stdoutBytes = typeof stdout === "string" ? new TextEncoder().encode(stdout) : stdout;
  return {
    exited: Promise.resolve(status),
    stdout: new Response(stdoutBytes).body,
    stderr: new Response(stderr).body,
    stdin: { write: () => {}, end: () => {} },
  } as unknown as ReturnType<typeof Bun.spawn>;
}

function indexRecord(mode: string, oid: string, path: string): string {
  return `${mode} ${oid} 0\t${path}\0`;
}

describe("readIndexedBlobs and readTreeBlobs (in-memory virtual)", () => {
  const repoRoot = `${process.cwd()}/.olt/virtual-git-index-repo`;
  const spies: { mockRestore: () => void }[] = [];
  const mockFiles = new Map<string, string>();

  beforeEach(() => {
    mockFiles.clear();
    spies.push(
      spyOn(fsPromises, "readFile").mockImplementation(async (p) => {
        const val = mockFiles.get(String(p));
        if (val !== undefined) return Buffer.from(val) as unknown as Buffer & string;
        throw new Error(`ENOENT: no such file, open '${String(p)}'`);
      }),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  function mockSpawnSteps(lsOut: string, catOut: string) {
    let call = 0;
    spies.push(
      spyOn(Bun, "spawn").mockImplementation(() => {
        call++;
        return call === 1 ? mockSubprocess(lsOut) : mockSubprocess(catOut);
      }),
    );
  }

  test("reads staged bytes instead of a divergent working tree", async () => {
    const oid = "1".repeat(40);
    const content = "a\n".repeat(300);
    mockSpawnSteps(
      indexRecord("100644", oid, "slice/index.ts"),
      `${oid} blob ${Buffer.byteLength(content)}\n${content}\n`,
    );
    const [blob] = await readIndexedBlobs(repoRoot);
    expect(new TextDecoder().decode(blob?.bytes)).toBe(content);
  });

  test("returns index paths in lexical order and preserves NUL-safe names", async () => {
    const [oidA, oidIdx, oidZ] = ["a".repeat(40), "b".repeat(40), "c".repeat(40)];
    const lsOut =
      indexRecord("100644", oidA, "slice/a name.ts") +
      indexRecord("100644", oidIdx, "slice/index.ts") +
      indexRecord("100644", oidZ, "slice/z.ts");
    const catOut = `${oidA} blob 1\na\n${oidIdx} blob 5\nindex\n${oidZ} blob 1\nz\n`;
    mockSpawnSteps(lsOut, catOut);
    const blobs = await readIndexedBlobs(repoRoot);
    expect(blobs.map((b) => b.path)).toEqual(["slice/a name.ts", "slice/index.ts", "slice/z.ts"]);
  });

  test("returns empty array when index has no entries", async () => {
    spies.push(spyOn(Bun, "spawn").mockImplementation(() => mockSubprocess("")));
    expect(await readIndexedBlobs(repoRoot)).toEqual([]);
  });

  test("uses final index paths after staged deletion and rename", async () => {
    const [oidIdx, oidRenamed] = ["1".repeat(40), "2".repeat(40)];
    const lsOut =
      indexRecord("100644", oidIdx, "slice/index.ts") +
      indexRecord("100644", oidRenamed, "slice/renamed.ts");
    mockSpawnSteps(lsOut, `${oidIdx} blob 5\nindex\n${oidRenamed} blob 7\nrenamed\n`);
    const blobs = await readIndexedBlobs(repoRoot);
    expect(blobs.map((b) => b.path)).toEqual(["slice/index.ts", "slice/renamed.ts"]);
  });

  test("fails closed when cat-file returns a malformed missing-object header", async () => {
    const oid = "f".repeat(40);
    mockSpawnSteps(indexRecord("100644", oid, "slice/missing.ts"), `${oid} missing\n`);
    await expect(readIndexedBlobs(repoRoot)).rejects.toThrow("malformed cat-file header");
  });

  test("rejects invalid Git index file modes", async () => {
    spies.push(
      spyOn(Bun, "spawn").mockImplementation(() =>
        mockSubprocess(indexRecord("100600", "a".repeat(40), "fixture.ts")),
      ),
    );
    await expect(readIndexedBlobs(repoRoot)).rejects.toThrow("malformed ls-files record");
  });

  test("rejects valid-looking cat-file headers with the wrong object type", async () => {
    const oid = "b".repeat(40);
    mockSpawnSteps(indexRecord("100644", oid, "fixture.ts"), `${oid} tree 0\n\n`);
    await expect(readIndexedBlobs(repoRoot)).rejects.toThrow("malformed cat-file header");
  });

  test("rejects cat-file bodies shorter than their announced size", async () => {
    const oid = "c".repeat(40);
    mockSpawnSteps(indexRecord("100644", oid, "fixture.ts"), `${oid} blob 2\nx\n`);
    await expect(readIndexedBlobs(repoRoot)).rejects.toThrow("truncated cat-file blob");
  });

  test("rejects duplicate index paths", async () => {
    const lsOut =
      indexRecord("100644", "d".repeat(40), "fixture.ts") +
      indexRecord("100644", "e".repeat(40), "fixture.ts");
    spies.push(spyOn(Bun, "spawn").mockImplementation(() => mockSubprocess(lsOut)));
    await expect(readIndexedBlobs(repoRoot)).rejects.toThrow("duplicate index path");
  });

  test("rejects nonzero ls-files exits", async () => {
    spies.push(
      spyOn(Bun, "spawn").mockImplementation(() =>
        mockSubprocess("failure", 17, "git ls-files failed"),
      ),
    );
    await expect(readIndexedBlobs(repoRoot)).rejects.toThrow("git ls-files failed");
  });

  test("rejects nonzero cat-file exits", async () => {
    let call = 0;
    spies.push(
      spyOn(Bun, "spawn").mockImplementation(() => {
        call++;
        return call === 1
          ? mockSubprocess(indexRecord("100644", "f".repeat(40), "fixture.ts"))
          : mockSubprocess("", 23, "git cat-file failed");
      }),
    );
    await expect(readIndexedBlobs(repoRoot)).rejects.toThrow("git cat-file failed");
  });

  test("orders index paths by code unit", async () => {
    const [upper, lower] = ["1".repeat(40), "2".repeat(40)];
    const lsOut =
      indexRecord("100644", lower, "slice/a.ts") + indexRecord("100644", upper, "slice/Z.ts");
    mockSpawnSteps(lsOut, `${upper} blob 1\nZ\n${lower} blob 1\na\n`);
    const blobs = await readIndexedBlobs(repoRoot);
    expect(blobs.map((blob) => blob.path)).toEqual(["slice/Z.ts", "slice/a.ts"]);
  });

  test("transports a single quote in an indexed path without shell interpolation", async () => {
    const path = "slice/it's-safe.ts";
    const oid = "3".repeat(40);
    mockSpawnSteps(indexRecord("100644", oid, path), `${oid} blob 1\nx\n`);
    const blobs = await readIndexedBlobs(repoRoot);
    expect(blobs.map((blob) => blob.path)).toEqual([path]);
  });

  test("reads working-tree bytes and an untracked in-scope file for tree provenance", async () => {
    mockFiles.set(`${repoRoot}/slice/index.ts`, "b\n".repeat(301));
    mockFiles.set(`${repoRoot}/slice/untracked.ts`, "export const value = 1;");
    spies.push(
      spyOn(Bun, "spawn").mockImplementation(() =>
        mockSubprocess("slice/index.ts\0slice/untracked.ts\0"),
      ),
    );
    const blobs = await readTreeBlobs(repoRoot);
    expect(
      new TextDecoder().decode(blobs.find((blob) => blob.path === "slice/index.ts")?.bytes),
    ).toBe("b\n".repeat(301));
    expect(blobs.map((blob) => blob.path)).toContain("slice/untracked.ts");
  });

  test("rejects readTreeBlobs on invalid directory", async () => {
    spies.push(
      spyOn(Bun, "spawn").mockImplementation(() =>
        mockSubprocess("", 128, "fatal: not a git repository"),
      ),
    );
    await expect(readTreeBlobs("/nonexistent/invalid/directory")).rejects.toThrow(
      "Unable to read Git index",
    );
  });

  test("resolves merge conflict stages by selecting stage 2 (ours)", async () => {
    const [oidAncestor, oidOurs, oidTheirs] = ["1".repeat(40), "2".repeat(40), "3".repeat(40)];
    const lsOut = `100644 ${oidAncestor} 1\tslice/conflict.ts\x00100644 ${oidOurs} 2\tslice/conflict.ts\x00100644 ${oidTheirs} 3\tslice/conflict.ts\x00`;
    mockSpawnSteps(lsOut, `${oidOurs} blob 4\nours\n`);
    const blobs = await readIndexedBlobs(repoRoot);
    expect(blobs.length).toBe(1);
    expect(blobs[0]?.path).toBe("slice/conflict.ts");
    expect(new TextDecoder().decode(blobs[0]?.bytes)).toBe("ours");
  });

  test("skips submodules (mode 160000) without crashing", async () => {
    const [subOid, fileOid] = ["4".repeat(40), "5".repeat(40)];
    mockSpawnSteps(
      `160000 ${subOid} 0\tsubmodule\x00100644 ${fileOid} 0\tslice/file.ts\x00`,
      `${fileOid} blob 4\nfile\n`,
    );
    const blobs = await readIndexedBlobs(repoRoot);
    expect(blobs.map((blob) => blob.path)).toEqual(["slice/file.ts"]);
  });
});
