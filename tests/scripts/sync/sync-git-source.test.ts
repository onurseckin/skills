import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  decideSyncSource,
  firstNonEmpty,
  getDirtyOltPaths,
  materializeOltFromHead,
  parsePorcelainStatus,
  refuseSyncSourceMessage,
  resolveOltSyncSource,
} from "../../../scripts/sync/git-source.ts";

describe("sync-git-source (in-memory virtual)", () => {
  const root = `${process.cwd()}/.olt/virtual-sync-git`;
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];
  let simulatedGitStatusOutput = "";
  let simulatedGitStatusError: string | null = null;
  let simulatedGitArchiveOutput: Uint8Array | null = null;

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockDirs.add(root);
    mockDirs.add(join(root, "olt"));
    mockFiles.set(join(root, "olt", "SKILL.md"), "committed-v1\n");
    simulatedGitStatusOutput = "";
    simulatedGitStatusError = null;
    simulatedGitArchiveOutput = new TextEncoder().encode("tar-archive-bytes");

    spies.push(
      spyOn(fs, "existsSync").mockImplementation(
        (p) => mockFiles.has(String(p)) || mockDirs.has(String(p)),
      ),
      spyOn(fs, "lstatSync").mockImplementation((p) => {
        const s = String(p);
        if (mockDirs.has(s))
          return {
            isSymbolicLink: () => false,
            isDirectory: () => true,
            isFile: () => false,
          } as unknown as fs.Stats;
        if (mockFiles.has(s))
          return {
            isSymbolicLink: () => false,
            isDirectory: () => false,
            isFile: () => true,
          } as unknown as fs.Stats;
        const err = new Error(`ENOENT: no such file, lstat '${s}'`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }),
      spyOn(fs, "readFileSync").mockImplementation((p) => {
        const val = mockFiles.get(String(p));
        if (val !== undefined) return val;
        throw new Error(`ENOENT: no such file, open '${String(p)}'`);
      }),
      spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
        mockFiles.set(
          String(p),
          typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8"),
        );
      }),
      spyOn(fs, "mkdirSync").mockImplementation((p) => {
        mockDirs.add(String(p));
        return undefined as unknown as string;
      }),
      spyOn(fs, "mkdtempSync").mockImplementation((p) => {
        const dir = `${String(p)}virtual-extract-${Math.random().toString(36).slice(2, 7)}`;
        mockDirs.add(dir);
        mockDirs.add(join(dir, "olt"));
        mockFiles.set(join(dir, "olt", "SKILL.md"), "committed-v1\n");
        return dir;
      }),
      spyOn(fs, "rmSync").mockImplementation((p) => {
        const s = String(p);
        mockFiles.delete(s);
        mockDirs.delete(s);
        for (const k of Array.from(mockFiles.keys()))
          if (k === s || k.startsWith(s + "/") || k.startsWith(s)) mockFiles.delete(k);
        for (const k of Array.from(mockDirs))
          if (k === s || k.startsWith(s + "/") || k.startsWith(s)) mockDirs.delete(k);
      }),
      spyOn(fs, "realpathSync").mockImplementation((p) => String(p)),
      spyOn(childProcess, "spawnSync").mockImplementation(
        (cmd: string, args?: readonly string[]) => {
          const cmdArgs = args ?? [];
          if (cmd === "git") {
            if (cmdArgs[0] === "status") {
              if (simulatedGitStatusError) {
                return {
                  status: 1,
                  stderr: simulatedGitStatusError,
                  stdout: "",
                  error: new Error(simulatedGitStatusError),
                } as unknown as childProcess.SpawnSyncReturns<string>;
              }
              const stdout = cmdArgs.includes("olt/")
                ? simulatedGitStatusOutput
                    .split("\n")
                    .filter((l) => l.slice(3).includes("olt/"))
                    .join("\n")
                : simulatedGitStatusOutput;
              return {
                status: 0,
                stdout,
                stderr: "",
              } as unknown as childProcess.SpawnSyncReturns<string>;
            }
            if (cmdArgs[0] === "archive") {
              return {
                status: 0,
                stdout: simulatedGitArchiveOutput ?? new Uint8Array(),
                stderr: "",
              } as unknown as childProcess.SpawnSyncReturns<Buffer>;
            }
          }
          return {
            status: 0,
            stdout: "",
            stderr: "",
          } as unknown as childProcess.SpawnSyncReturns<string>;
        },
      ),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  describe("firstNonEmpty", () => {
    test("returns first non-empty string or fallback", () => {
      expect(firstNonEmpty("", null, "first", "second")).toBe("first");
      expect(firstNonEmpty(undefined, null, "")).toBe("unknown error");
    });
  });

  describe("decideSyncSource", () => {
    test("clean tree without --allow-dirty proceeds from HEAD", () => {
      expect(decideSyncSource([], false)).toEqual({ mode: "head" });
    });
    test("dirty tree without --allow-dirty refuses and carries the dirty paths", () => {
      expect(decideSyncSource(["olt/agents/critic.yaml", "olt/foo.ts"], false)).toEqual({
        mode: "refuse",
        dirtyPaths: ["olt/agents/critic.yaml", "olt/foo.ts"],
      });
    });
    test("dirty tree with --allow-dirty proceeds from the worktree", () => {
      expect(decideSyncSource(["olt/agents/critic.yaml"], true)).toEqual({ mode: "worktree" });
    });
    test("clean tree with --allow-dirty still proceeds from the worktree, not HEAD", () => {
      expect(decideSyncSource([], true)).toEqual({ mode: "worktree" });
    });
  });

  describe("refuseSyncSourceMessage", () => {
    test("names every dirty path, not just a count", () => {
      const message = refuseSyncSourceMessage(["olt/agents/critic.yaml", "olt/foo.ts"]);
      expect(message).toContain("olt/agents/critic.yaml");
      expect(message).toContain("olt/foo.ts");
      expect(message).not.toMatch(/\b2 files?\b/);
    });
  });

  describe("parsePorcelainStatus", () => {
    test("returns nothing for empty output", () => {
      expect(parsePorcelainStatus("")).toEqual([]);
    });
    test("parses an unstaged modification", () => {
      expect(parsePorcelainStatus(" M olt/agents/critic.yaml")).toEqual(["olt/agents/critic.yaml"]);
    });
    test("parses a staged modification", () => {
      expect(parsePorcelainStatus("M  olt/agents/critic.yaml")).toEqual(["olt/agents/critic.yaml"]);
    });
    test("parses an untracked file", () => {
      expect(parsePorcelainStatus("?? olt/scripts/src/new-file.ts")).toEqual([
        "olt/scripts/src/new-file.ts",
      ]);
    });
    test("parses a staged rename to the destination path", () => {
      expect(parsePorcelainStatus("R  olt/old-name.ts -> olt/new-name.ts")).toEqual([
        "olt/new-name.ts",
      ]);
    });
    test("parses multiple lines and ignores blank trailing lines", () => {
      expect(parsePorcelainStatus(" M olt/a.ts\n?? olt/b.ts\nR  olt/c.ts -> olt/d.ts\n")).toEqual([
        "olt/a.ts",
        "olt/b.ts",
        "olt/d.ts",
      ]);
    });
  });

  describe("getDirtyOltPaths", () => {
    test("reports nothing for a clean tree", () => {
      simulatedGitStatusOutput = "";
      expect(getDirtyOltPaths(root)).toEqual([]);
    });
    test("reports modified, untracked, and renamed paths under olt/", () => {
      simulatedGitStatusOutput =
        " M olt/SKILL.md\n?? olt/new-untracked.ts\nR  olt/agents/old.yaml -> olt/agents/renamed.yaml\n";
      expect(getDirtyOltPaths(root).sort()).toEqual(
        ["olt/SKILL.md", "olt/agents/renamed.yaml", "olt/new-untracked.ts"].sort(),
      );
    });
    test("ignores changes outside the olt/ subtree", () => {
      simulatedGitStatusOutput = " M README.md\n?? unrelated-untracked.txt\n";
      expect(getDirtyOltPaths(root)).toEqual([]);
    });
  });

  describe("materializeOltFromHead", () => {
    test("materializes the committed content, not the dirty worktree edit", () => {
      const tmpParent = `${root}/materialize-tmp-parent`;
      mockFiles.set(join(root, "olt", "SKILL.md"), "uncommitted-dirty-edit\n");
      const { sourceOltDir, cleanup } = materializeOltFromHead(root, tmpParent);
      try {
        expect(sourceOltDir).not.toBe(join(root, "olt"));
        expect(fs.readFileSync(join(sourceOltDir, "SKILL.md"), "utf-8")).toBe("committed-v1\n");
        expect(fs.existsSync(join(sourceOltDir, "SKILL.md"))).toBe(true);
      } finally {
        cleanup();
      }
      expect(fs.existsSync(sourceOltDir)).toBe(false);
    });
  });

  describe("resolveOltSyncSource", () => {
    test("clean tree without --allow-dirty materializes an isolated HEAD copy", () => {
      simulatedGitStatusOutput = "";
      const { sourceOltDir, cleanup } = resolveOltSyncSource(root, false);
      try {
        expect(sourceOltDir).not.toBe(join(root, "olt"));
        expect(fs.readFileSync(join(sourceOltDir, "SKILL.md"), "utf-8")).toBe("committed-v1\n");
      } finally {
        cleanup();
      }
    });
    test("dirty tree without --allow-dirty refuses and names the dirty paths in the error", () => {
      simulatedGitStatusOutput = " M olt/SKILL.md\n";
      expect(() => resolveOltSyncSource(root, false)).toThrow(/olt\/SKILL\.md/);
    });
    test("dirty tree with --allow-dirty deploys the live worktree unchanged", () => {
      simulatedGitStatusOutput = " M olt/SKILL.md\n";
      mockFiles.set(join(root, "olt", "SKILL.md"), "dirty-but-allowed\n");
      const { sourceOltDir, cleanup } = resolveOltSyncSource(root, true);
      expect(sourceOltDir).toBe(join(root, "olt"));
      expect(fs.readFileSync(join(sourceOltDir, "SKILL.md"), "utf-8")).toBe("dirty-but-allowed\n");
      cleanup();
      expect(fs.existsSync(join(root, "olt", "SKILL.md"))).toBe(true);
      expect(fs.readFileSync(join(root, "olt", "SKILL.md"), "utf-8")).toBe("dirty-but-allowed\n");
    });
  });
});
