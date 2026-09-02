import { describe, expect, it, spyOn, afterEach } from "bun:test";
import * as fs from "node:fs";
import { resolve, join } from "node:path";
import {
  collectCapsuleSearchRoots,
  resolveWitnessCommand,
} from "../../../olt/scripts/src/mind/auditing/witness/types.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Mind Witness Types & Capsule Root Discovery Suite", () => {
  const spies: Array<{ mockRestore: () => void }> = [];

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  describe("collectCapsuleSearchRoots", () => {
    it("handles startPath pointing directly to a capsule run inside .capsules", () => {
      const runPath = resolve("/repo/.capsules/run-1");
      const parentDir = resolve("/repo/.capsules");
      const siblingRun = resolve("/repo/.capsules/run-2");

      spies.push(
        spyOn(fs, "existsSync").mockImplementation((p) => {
          const s = String(p);
          return (
            s === runPath ||
            s === parentDir ||
            s === join(runPath, "state.json") ||
            s === join(siblingRun, "manifest.json")
          );
        }),
        spyOn(fs, "lstatSync").mockImplementation(
          (p) =>
            ({
              isDirectory: () => [parentDir, runPath, siblingRun].includes(String(p)),
              isSymbolicLink: () => false,
            }) as unknown as fs.Stats,
        ),
        spyOn(fs, "readdirSync").mockImplementation((p) =>
          String(p) === parentDir
            ? ([
                { name: ".hidden", isDirectory: () => true, isSymbolicLink: () => false },
                { name: "run-2", isDirectory: () => true, isSymbolicLink: () => false },
                { name: "not-a-run", isDirectory: () => true, isSymbolicLink: () => false },
              ] as unknown as fs.Dirent[])
            : ([] as unknown as fs.Dirent[]),
        ),
      );

      const roots = collectCapsuleSearchRoots("/repo/.capsules/run-1");
      expect(roots).toContain(runPath);
      expect(roots).toContain(siblingRun);
    });

    it("handles startPath pointing to a repo directory with sub .capsules directory", () => {
      const repoDir = resolve("/repo");
      const subCapsules = resolve("/repo/.capsules");
      const runDir = resolve("/repo/.capsules/run-alpha");

      spies.push(
        spyOn(fs, "existsSync").mockImplementation((p) => {
          const s = String(p);
          return s === repoDir || s === subCapsules || s === join(runDir, "commands");
        }),
        spyOn(fs, "lstatSync").mockImplementation(
          (p) =>
            ({
              isDirectory: () => [repoDir, subCapsules, runDir].includes(String(p)),
              isSymbolicLink: () => false,
            }) as unknown as fs.Stats,
        ),
        spyOn(fs, "readdirSync").mockImplementation((p) =>
          String(p) === subCapsules
            ? ([
                { name: "run-alpha", isDirectory: () => false, isSymbolicLink: () => true },
              ] as unknown as fs.Dirent[])
            : ([] as unknown as fs.Dirent[]),
        ),
      );

      const roots = collectCapsuleSearchRoots("/repo");
      expect(roots).toContain(runDir);
    });

    it("handles startPath directory directly scanning entries when .capsules does not exist", () => {
      const customDir = resolve("/custom/runs");
      const runDir = resolve("/custom/runs/run-beta");

      spies.push(
        spyOn(fs, "existsSync").mockImplementation((p) => {
          const s = String(p);
          return s === customDir || s === join(runDir, "state.json");
        }),
        spyOn(fs, "lstatSync").mockReturnValue({
          isDirectory: () => true,
          isSymbolicLink: () => false,
        } as unknown as fs.Stats),
        spyOn(fs, "readdirSync").mockImplementation((p) =>
          String(p) === customDir
            ? ([
                { name: "run-beta", isDirectory: () => true, isSymbolicLink: () => false },
              ] as unknown as fs.Dirent[])
            : ([] as unknown as fs.Dirent[]),
        ),
      );

      const roots = collectCapsuleSearchRoots("/custom/runs");
      expect(roots).toContain(runDir);
    });

    it("falls back to process.cwd() .capsules and cwd run check when no startPath given", () => {
      const cwd = resolve(process.cwd());
      const defaultCapsules = resolve(cwd, ".capsules");
      const runX = resolve(defaultCapsules, "run-x");

      spies.push(
        spyOn(fs, "existsSync").mockImplementation((p) => {
          const s = String(p);
          return (
            s === defaultCapsules ||
            s === join(cwd, "manifest.json") ||
            s === join(runX, "state.json")
          );
        }),
        spyOn(fs, "lstatSync").mockImplementation(
          (p) =>
            ({
              isDirectory: () => [defaultCapsules, cwd, runX].includes(String(p)),
              isSymbolicLink: () => false,
            }) as unknown as fs.Stats,
        ),
        spyOn(fs, "readdirSync").mockImplementation((p) =>
          String(p) === defaultCapsules
            ? ([
                { name: "run-x", isDirectory: () => true, isSymbolicLink: () => false },
              ] as unknown as fs.Dirent[])
            : ([] as unknown as fs.Dirent[]),
        ),
      );

      const roots = collectCapsuleSearchRoots();
      expect(roots).toContain(cwd);
      expect(roots).toContain(runX);
    });

    it("handles startPath pointing to a regular file and non-directory capsule folders", () => {
      const filePath = resolve("/repo/file.txt");
      const runPath = resolve("/repo/.capsules/run-leaf");
      const parentDir = resolve("/repo/.capsules");

      spies.push(
        spyOn(fs, "existsSync").mockImplementation((p) => {
          const s = String(p);
          return (
            s === filePath || s === runPath || s === join(runPath, "state.json") || s === parentDir
          );
        }),
        spyOn(fs, "lstatSync").mockImplementation(
          (p) =>
            ({
              isDirectory: () => String(p) === runPath, // parentDir is not a directory
              isSymbolicLink: () => false,
            }) as unknown as fs.Stats,
        ),
      );

      const roots1 = collectCapsuleSearchRoots("/repo/file.txt");
      expect(Array.isArray(roots1)).toBe(true);

      const roots2 = collectCapsuleSearchRoots("/repo/.capsules/run-leaf");
      expect(roots2).toContain(runPath);

      const roots3 = collectCapsuleSearchRoots("/non/existent/path");
      expect(Array.isArray(roots3)).toBe(true);
    });

    it("swallows errors in scanCapsulesDir when readdirSync throws", () => {
      spies.push(
        spyOn(fs, "existsSync").mockReturnValue(true),
        spyOn(fs, "lstatSync").mockReturnValue({
          isDirectory: () => true,
          isSymbolicLink: () => false,
        } as unknown as fs.Stats),
        spyOn(fs, "readdirSync").mockImplementation(() => {
          throw new Error("EACCES permission denied");
        }),
      );

      const roots = collectCapsuleSearchRoots("/protected/dir");
      expect(Array.isArray(roots)).toBe(true);
    });
  });

  describe("resolveWitnessCommand", () => {
    it("validates input commandId argument", () => {
      expect(() => resolveWitnessCommand(null as unknown as string)).toThrow(HarnessError);
      expect(() => resolveWitnessCommand(undefined as unknown as string)).toThrow(HarnessError);
      expect(() => resolveWitnessCommand("")).toThrow(HarnessError);
      expect(() => resolveWitnessCommand("   ")).toThrow(HarnessError);
    });

    it("resolves command via direct record path (commands/<id>/record.json)", () => {
      const root = resolve("/capsule/run-1");
      const recordPath = join(root, "commands", "cmd-100", "record.json");
      const fakeRecord = { command_id: "cmd-100", exit_code: 1, status: "failed" };

      spies.push(
        spyOn(fs, "existsSync").mockImplementation((p) =>
          [root, join(root, "state.json"), recordPath].includes(String(p)),
        ),
        spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(fakeRecord)),
      );

      const res = resolveWitnessCommand("cmd-100", root);
      expect(res.commandId).toBe("cmd-100");
      expect(res.capsuleRoot).toBe(root);
      expect(res.recordPath).toBe(recordPath);
      expect(res.commandRecord.command_id).toBe("cmd-100");
    });

    it("resolves command via flat record path (commands/<id>.json)", () => {
      const root = resolve("/capsule/run-2");
      const flatPath = join(root, "commands", "cmd-200.json");
      const fakeRecord = { command_id: "cmd-200", exit_code: 2, status: "failed" };

      spies.push(
        spyOn(fs, "existsSync").mockImplementation((p) =>
          [root, join(root, "state.json"), flatPath].includes(String(p)),
        ),
        spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(fakeRecord)),
      );

      const res = resolveWitnessCommand("cmd-200", root);
      expect(res.commandId).toBe("cmd-200");
      expect(res.recordPath).toBe(flatPath);
      expect(res.commandRecord.command_id).toBe("cmd-200");
    });

    it("resolves command via state.json commands map", () => {
      const root = resolve("/capsule/run-3");
      const statePath = join(root, "state.json");
      const fakeState = {
        commands: { "cmd-300": { command_id: "cmd-300", exit_code: 1, status: "failed" } },
      };

      spies.push(
        spyOn(fs, "existsSync").mockImplementation((p) => [root, statePath].includes(String(p))),
        spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(fakeState)),
      );

      const res = resolveWitnessCommand("cmd-300", root);
      expect(res.commandId).toBe("cmd-300");
      expect(res.commandRecord.command_id).toBe("cmd-300");
    });

    it("ignores corrupted json in direct/flat/state records and continues search", () => {
      const root = resolve("/capsule/run-4");
      const statePath = join(root, "state.json");
      const flatPath = join(root, "commands", "cmd-400.json");

      spies.push(
        spyOn(fs, "existsSync").mockImplementation((p) =>
          [root, statePath, flatPath].includes(String(p)),
        ),
        spyOn(fs, "readFileSync").mockImplementation((p) => {
          if (String(p) === flatPath) return "invalid { json";
          if (String(p) === statePath) return JSON.stringify({ commands: { other: {} } });
          return "";
        }),
      );

      expect(() => resolveWitnessCommand("cmd-400", root)).toThrow(HarnessError);
    });

    it("throws HarnessError when command is not found in any capsule root", () => {
      spies.push(spyOn(fs, "existsSync").mockReturnValue(false));
      expect(() => resolveWitnessCommand("cmd-missing", "/empty")).toThrow(HarnessError);
    });
  });
});
