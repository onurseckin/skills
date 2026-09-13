import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { inferActiveRun } from "../../../olt/scripts/src/cli/inference.ts";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "./fixtures/full-lifecycle-fixture.ts";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Pillar 1: Optional --run and Active Run Inference", () => {
  let vfs: VirtualMemoryFS;
  let testRepoRoot: string;
  let originalOltRun: string | undefined;
  let originalCwd: string;

  beforeEach(() => {
    vfs = setupVirtualCliFS();
    testRepoRoot = "/virtual/test-skills-repo";
    vfs.mkdirSync(join(testRepoRoot, ".olt", "capsules"), { recursive: true });
    vfs.mkdirSync(join(testRepoRoot, ".git"), { recursive: true });
    vfs.writeFileSync(
      join(testRepoRoot, "package.json"),
      JSON.stringify({ name: "test-skills-repo", version: "1.0.0" }),
    );

    originalOltRun = process.env.OLT_RUN;
    delete process.env.OLT_RUN;
    originalCwd = process.cwd();
  });

  afterEach(() => {
    if (originalOltRun !== undefined) {
      process.env.OLT_RUN = originalOltRun;
    } else {
      delete process.env.OLT_RUN;
    }

    try {
      process.chdir(originalCwd);
    } catch {
      // ignore
    }

    cleanupVirtualCliFS();
  });

  describe("inferActiveRun precedence & order", () => {
    it("returns undefined when no env, session, or capsule exists", () => {
      expect(inferActiveRun(testRepoRoot)).toBeUndefined();
    });

    it("prefers process.env.OLT_RUN over .session.json and capsule dirs", () => {
      const capsulesDir = join(testRepoRoot, ".olt", "capsules");
      vfs.mkdirSync(join(capsulesDir, "capsule-from-dir"), { recursive: true });

      vfs.writeFileSync(
        join(testRepoRoot, ".session.json"),
        JSON.stringify({ run_id: "capsule-from-session" }),
      );

      process.env.OLT_RUN = "capsule-from-env";

      const inferred = inferActiveRun(testRepoRoot);
      expect(inferred).toBe("capsule-from-env");
    });

    it("ignores whitespace-only process.env.OLT_RUN and falls back to .session.json", () => {
      process.env.OLT_RUN = "   ";
      vfs.writeFileSync(
        join(testRepoRoot, ".session.json"),
        JSON.stringify({ run_id: "capsule-from-session" }),
      );

      const inferred = inferActiveRun(testRepoRoot);
      expect(inferred).toBe("capsule-from-session");
    });

    it("prefers .session.json over capsule directory scan", () => {
      const capsulesDir = join(testRepoRoot, ".olt", "capsules");
      vfs.mkdirSync(join(capsulesDir, "capsule-dir-1"), { recursive: true });

      vfs.writeFileSync(
        join(testRepoRoot, ".session.json"),
        JSON.stringify({ run_id: "capsule-from-session" }),
      );

      const inferred = inferActiveRun(testRepoRoot);
      expect(inferred).toBe("capsule-from-session");
    });

    it("extracts run identifiers from various session keys in precedence order", () => {
      const sessionPath = join(testRepoRoot, ".session.json");

      // 1. run_id
      vfs.writeFileSync(sessionPath, JSON.stringify({ run_id: "id-1", run: "id-2" }));
      expect(inferActiveRun(testRepoRoot)).toBe("id-1");

      // 2. run
      vfs.writeFileSync(sessionPath, JSON.stringify({ run: "id-2", runId: "id-3" }));
      expect(inferActiveRun(testRepoRoot)).toBe("id-2");

      // 3. runId
      vfs.writeFileSync(sessionPath, JSON.stringify({ runId: "id-3", runRoot: "id-4" }));
      expect(inferActiveRun(testRepoRoot)).toBe("id-3");

      // 4. runRoot
      vfs.writeFileSync(sessionPath, JSON.stringify({ runRoot: "id-4", run_root: "id-5" }));
      expect(inferActiveRun(testRepoRoot)).toBe("id-4");

      // 5. run_root
      vfs.writeFileSync(sessionPath, JSON.stringify({ run_root: "id-5" }));
      expect(inferActiveRun(testRepoRoot)).toBe("id-5");
    });

    it("walks up directory tree from cwd to find .session.json", () => {
      const subDir = join(testRepoRoot, "packages", "core", "deep");
      vfs.mkdirSync(subDir, { recursive: true });

      vfs.writeFileSync(
        join(testRepoRoot, ".session.json"),
        JSON.stringify({ run_id: "root-session-run" }),
      );

      process.chdir(subDir);
      const inferred = inferActiveRun(testRepoRoot);
      expect(inferred).toBe("root-session-run");
    });

    it("uses closest .session.json when nested session exists", () => {
      const subDir = join(testRepoRoot, "subproject");
      vfs.mkdirSync(subDir, { recursive: true });

      vfs.writeFileSync(
        join(testRepoRoot, ".session.json"),
        JSON.stringify({ run_id: "parent-session-run" }),
      );
      vfs.writeFileSync(
        join(subDir, ".session.json"),
        JSON.stringify({ run_id: "nested-session-run" }),
      );

      process.chdir(subDir);
      const inferred = inferActiveRun(testRepoRoot);
      expect(inferred).toBe("nested-session-run");
    });

    it("returns newest unarchived capsule directory by mtimeMs", () => {
      const capsulesDir = join(testRepoRoot, ".olt", "capsules");
      const capOld = join(capsulesDir, "run-old");
      const capMid = join(capsulesDir, "run-mid");
      const capNew = join(capsulesDir, "run-new");

      const origNow = Date.now;
      try {
        Date.now = () => 100_000;
        vfs.mkdirSync(capOld, { recursive: true });
        Date.now = () => 200_000;
        vfs.mkdirSync(capMid, { recursive: true });
        Date.now = () => 300_000;
        vfs.mkdirSync(capNew, { recursive: true });
      } finally {
        Date.now = origNow;
      }

      const inferred = inferActiveRun(testRepoRoot);
      expect(inferred).toBe(capNew);
    });

    it("resolves run name to capsule directory if directory exists", () => {
      const capsulesDir = join(testRepoRoot, ".olt", "capsules");
      const capDir = join(capsulesDir, "active-capsule");
      vfs.mkdirSync(capDir, { recursive: true });

      vfs.writeFileSync(
        join(testRepoRoot, ".session.json"),
        JSON.stringify({ run_id: "active-capsule" }),
      );

      const inferred = inferActiveRun(testRepoRoot);
      expect(inferred).toBe(capDir);
    });
  });

  describe("Edge cases & safety", () => {
    it("ignores hidden directories starting with dot like .locks", () => {
      const capsulesDir = join(testRepoRoot, ".olt", "capsules");
      const origNow = Date.now;
      try {
        Date.now = () => 300_000;
        vfs.mkdirSync(join(capsulesDir, ".locks"), { recursive: true });
        vfs.mkdirSync(join(capsulesDir, ".tmp-capsule"), { recursive: true });

        expect(inferActiveRun(testRepoRoot)).toBeUndefined();

        Date.now = () => 200_000;
        const validCap = join(capsulesDir, "valid-run");
        vfs.mkdirSync(validCap, { recursive: true });

        expect(inferActiveRun(testRepoRoot)).toBe(validCap);
      } finally {
        Date.now = origNow;
      }
    });

    it("ignores archive directory in capsules", () => {
      const capsulesDir = join(testRepoRoot, ".olt", "capsules");
      const origNow = Date.now;
      try {
        Date.now = () => 300_000;
        vfs.mkdirSync(join(capsulesDir, "archive"), { recursive: true });

        expect(inferActiveRun(testRepoRoot)).toBeUndefined();

        Date.now = () => 200_000;
        const validCap = join(capsulesDir, "valid-run-2");
        vfs.mkdirSync(validCap, { recursive: true });

        expect(inferActiveRun(testRepoRoot)).toBe(validCap);
      } finally {
        Date.now = origNow;
      }
    });

    it("ignores non-directory files inside capsules directory", () => {
      const capsulesDir = join(testRepoRoot, ".olt", "capsules");
      vfs.mkdirSync(capsulesDir, { recursive: true });
      vfs.writeFileSync(join(capsulesDir, "notes.txt"), "some notes");
      vfs.writeFileSync(join(capsulesDir, "README.md"), "# Capsules");

      expect(inferActiveRun(testRepoRoot)).toBeUndefined();
    });

    it("handles missing directories and paths gracefully", () => {
      expect(inferActiveRun("/non/existent/path/that/does/not/exist")).toBeUndefined();
    });

    it("handles malformed JSON in .session.json gracefully", () => {
      vfs.writeFileSync(join(testRepoRoot, ".session.json"), "{ invalid json syntax !! ");
      expect(inferActiveRun(testRepoRoot)).toBeUndefined();
    });

    it("handles non-object content in .session.json gracefully", () => {
      vfs.writeFileSync(join(testRepoRoot, ".session.json"), "12345");
      expect(inferActiveRun(testRepoRoot)).toBeUndefined();
    });
  });

  function initTestRun(repo: string, name: string): string {
    const prompt = new TextEncoder().encode("Test prompt");
    return initRun(repo, name, prompt, "file", true);
  }

  describe("execute() Integration with inferred --run", () => {
    it("fails with required-flag error when command requires --run and no active run exists", async () => {
      process.chdir(testRepoRoot);

      await expect(execute(["plan:status"])).rejects.toThrow(HarnessError);
      try {
        await execute(["plan:status"]);
      } catch (error) {
        expect(error).toBeInstanceOf(HarnessError);
        expect((error as HarnessError).message).toContain("--run is required");
      }
    });

    it("executes plan:status without --run when active run is set via process.env.OLT_RUN", async () => {
      process.chdir(testRepoRoot);

      const runRoot = initTestRun(testRepoRoot, "env-inferred-run");
      process.env.OLT_RUN = runRoot;

      const result = await execute(["plan:status"]);
      expect(result).toBeDefined();
      expect(result.run_root).toBe(runRoot);
    });

    it("executes plan:status without --run when active run is set via .session.json", async () => {
      process.chdir(testRepoRoot);

      const runRoot = initTestRun(testRepoRoot, "session-inferred-run");

      vfs.writeFileSync(
        join(testRepoRoot, ".session.json"),
        JSON.stringify({
          agent_id: "test-agent",
          role: "coordinator",
          run_id: "session-inferred-run",
        }),
      );

      const result = await execute(["plan:status"]);
      expect(result).toBeDefined();
      expect(result.run_root).toBe(runRoot);
    });

    it("executes plan:status without --run when active run is inferred from newest capsule directory", async () => {
      process.chdir(testRepoRoot);

      const origNow = Date.now;
      let run1 = "";
      let run2 = "";
      try {
        Date.now = () => 10_000;
        run1 = initTestRun(testRepoRoot, "old-capsule-run");
        Date.now = () => 50_000;
        run2 = initTestRun(testRepoRoot, "new-capsule-run");
      } finally {
        Date.now = origNow;
      }

      const result = await execute(["plan:status"]);
      expect(result).toBeDefined();
      expect(result.run_root).toBe(run2);
    });

    it("commands without --run flag continue to execute normally even when active run exists", async () => {
      process.chdir(testRepoRoot);

      initTestRun(testRepoRoot, "active-capsule-run");

      const result = await execute(["role:list"]);
      expect(result).toBeDefined();
      expect(result.roles).toBeDefined();
    });
  });
});
