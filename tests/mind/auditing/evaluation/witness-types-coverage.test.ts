import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { join, resolve } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  collectCapsuleSearchRoots,
  resolveWitnessCommand,
} from "../../../../olt/scripts/src/mind/auditing/witness/types.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Witness Types & Capsule Root Discovery Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("collectCapsuleSearchRoots", () => {
    it("handles startPath pointing directly to a capsule run inside .capsules", () => {
      const runPath = resolve("/repo/.capsules/run-1");
      const parentDir = resolve("/repo/.capsules");
      const siblingRun = resolve("/repo/.capsules/run-2");

      vfs.mkdirSync(parentDir, { recursive: true });
      vfs.mkdirSync(runPath, { recursive: true });
      vfs.mkdirSync(siblingRun, { recursive: true });
      vfs.mkdirSync(join(parentDir, ".hidden"), { recursive: true });
      vfs.mkdirSync(join(parentDir, "not-a-run"), { recursive: true });
      vfs.writeFileSync(join(runPath, "state.json"), "{}");
      vfs.writeFileSync(join(siblingRun, "manifest.json"), "{}");

      const roots = collectCapsuleSearchRoots("/repo/.capsules/run-1");
      expect(roots).toContain(runPath);
      expect(roots).toContain(siblingRun);
    });

    it("handles startPath pointing to a repo directory with sub .capsules directory", () => {
      const runDir = resolve("/repo/.capsules/run-alpha");
      vfs.mkdirSync(join(runDir, "commands"), { recursive: true });

      const roots = collectCapsuleSearchRoots("/repo");
      expect(roots).toContain(runDir);
    });

    it("handles startPath directory directly scanning entries when .capsules does not exist", () => {
      const runDir = resolve("/custom/runs/run-beta");
      vfs.mkdirSync(runDir, { recursive: true });
      vfs.writeFileSync(join(runDir, "state.json"), "{}");

      const roots = collectCapsuleSearchRoots("/custom/runs");
      expect(roots).toContain(runDir);
    });

    it("falls back to process.cwd() .capsules and cwd run check when no startPath given", () => {
      const cwd = resolve(process.cwd());
      const defaultCapsules = resolve(cwd, ".capsules");
      const runX = resolve(defaultCapsules, "run-x");

      vfs.mkdirSync(runX, { recursive: true });
      vfs.writeFileSync(join(cwd, "manifest.json"), "{}");
      vfs.writeFileSync(join(runX, "state.json"), "{}");

      const roots = collectCapsuleSearchRoots();
      expect(roots).toContain(cwd);
      expect(roots).toContain(runX);
    });

    it("handles startPath pointing to a regular file and non-directory capsule folders", () => {
      const filePath = resolve("/repo/file.txt");
      const runPath = resolve("/repo/.capsules/run-leaf");
      const parentDir = resolve("/repo/.capsules");

      vfs.mkdirSync(parentDir, { recursive: true });
      vfs.writeFileSync(filePath, "regular file");
      vfs.mkdirSync(runPath, { recursive: true });
      vfs.writeFileSync(join(runPath, "state.json"), "{}");

      const roots1 = collectCapsuleSearchRoots("/repo/file.txt");
      expect(Array.isArray(roots1)).toBe(true);

      const roots2 = collectCapsuleSearchRoots("/repo/.capsules/run-leaf");
      expect(roots2).toContain(runPath);

      const roots3 = collectCapsuleSearchRoots("/non/existent/path");
      expect(Array.isArray(roots3)).toBe(true);
    });

    it("swallows errors in scanCapsulesDir when readdirSync throws", () => {
      vfs.mkdirSync("/protected/dir", { recursive: true });
      const spy = spyOn(vfs, "readdirSync").mockImplementation(() => {
        throw new Error("EACCES permission denied");
      });
      const roots = collectCapsuleSearchRoots("/protected/dir");
      spy.mockRestore();
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

      vfs.mkdirSync(join(root, "commands", "cmd-100"), { recursive: true });
      vfs.writeFileSync(join(root, "state.json"), "{}");
      vfs.writeFileSync(recordPath, JSON.stringify(fakeRecord));

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

      vfs.mkdirSync(join(root, "commands"), { recursive: true });
      vfs.writeFileSync(join(root, "state.json"), "{}");
      vfs.writeFileSync(flatPath, JSON.stringify(fakeRecord));

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

      vfs.mkdirSync(root, { recursive: true });
      vfs.writeFileSync(statePath, JSON.stringify(fakeState));

      const res = resolveWitnessCommand("cmd-300", root);
      expect(res.commandId).toBe("cmd-300");
      expect(res.commandRecord.command_id).toBe("cmd-300");
    });

    it("ignores corrupted json in direct/flat/state records and continues search", () => {
      const root = resolve("/capsule/run-4");
      const statePath = join(root, "state.json");
      const flatPath = join(root, "commands", "cmd-400.json");

      vfs.mkdirSync(join(root, "commands"), { recursive: true });
      vfs.writeFileSync(flatPath, "invalid { json");
      vfs.writeFileSync(statePath, JSON.stringify({ commands: { other: {} } }));

      expect(() => resolveWitnessCommand("cmd-400", root)).toThrow(HarnessError);
    });

    it("throws HarnessError when command is not found in any capsule root", () => {
      expect(() => resolveWitnessCommand("cmd-missing", "/empty")).toThrow(HarnessError);
    });
  });
});
