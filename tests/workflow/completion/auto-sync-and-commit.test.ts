import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  executeAutoSyncAndCommit,
  type AutoSyncOptions,
  type GitRunner,
  type GitRunnerResult,
  type SyncRunner,
  type SyncRunnerResult,
} from "../../../olt/scripts/src/workflow/completion/auto-sync-and-commit.ts";

describe("workflow/completion/auto-sync-and-commit", () => {
  const baseOptions: AutoSyncOptions = {
    taskId: "T-1",
    description: "implement feature",
    writeScope: ["src/file.ts"],
    repoRoot: "/test/repo",
  };

  test("full successful flow: stage, commit, push, and skill sync", async () => {
    const executedGit: string[][] = [];
    let syncScriptCalled: string | undefined;

    const gitRunner: GitRunner = (args) => {
      executedGit.push([...args]);
      if (args[0] === "rev-parse") {
        return { status: 0, stdout: "abcdef123456\n", stderr: "" };
      }
      return { status: 0, stdout: "ok", stderr: "" };
    };

    const syncRunner: SyncRunner = (scriptPath) => {
      syncScriptCalled = scriptPath;
      return { status: 0, stdout: "synced", stderr: "" };
    };

    const result = await executeAutoSyncAndCommit(
      {
        ...baseOptions,
        scope: "core",
        body: "detailed body",
        commitType: "feat",
        remote: "upstream",
        branch: "develop",
        syncScriptPath: "scripts/sync/custom.ts",
      },
      gitRunner,
      syncRunner,
    );

    expect(result.committed).toBe(true);
    expect(result.commitSha).toBe("abcdef123456");
    expect(result.pushed).toBe(true);
    expect(result.synced).toBe(true);
    expect(result.message).toContain("feat(core): implement feature");
    expect(syncScriptCalled).toBe("/test/repo/scripts/sync/custom.ts");
  });

  test("handles commit formatting failure gracefully", async () => {
    const invalidOptions: AutoSyncOptions = {
      ...baseOptions,
      description: "", // Invalid empty description triggers format error
    };

    const result = await executeAutoSyncAndCommit(invalidOptions);
    expect(result.committed).toBe(false);
    expect(result.pushed).toBe(false);
    expect(result.synced).toBe(false);
    expect(result.logs.some((l) => l.includes("[format] Commit format failed"))).toBe(true);
  });

  test("handles empty writeScope by skipping git add", async () => {
    const gitRunner: GitRunner = () => ({ status: 0, stdout: "", stderr: "" });
    const result = await executeAutoSyncAndCommit(
      { ...baseOptions, writeScope: [] },
      gitRunner,
      () => ({ status: 0, stdout: "", stderr: "" }),
    );
    expect(result.logs.some((l) => l.includes("Empty write scope; skipping git add"))).toBe(true);
  });

  test("handles staging error and staging exception", async () => {
    // Staging error with stderr vs stdout fallback
    const failRunner: GitRunner = (args) => {
      if (args[0] === "add") return { status: 1, stdout: "", stderr: "path not found" };
      return { status: 0, stdout: "sha-1", stderr: "" };
    };
    const res1 = await executeAutoSyncAndCommit(baseOptions, failRunner, () => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    expect(res1.logs.some((l) => l.includes("Git stage failed (status 1): path not found"))).toBe(
      true,
    );

    // Staging error with empty stderr (fallback to stdout)
    const failRunnerStdout: GitRunner = (args) => {
      if (args[0] === "add") return { status: 1, stdout: "stage stdout error", stderr: "" };
      return { status: 0, stdout: "sha-1", stderr: "" };
    };
    const resStdout = await executeAutoSyncAndCommit(baseOptions, failRunnerStdout, () => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    expect(
      resStdout.logs.some((l) => l.includes("Git stage failed (status 1): stage stdout error")),
    ).toBe(true);

    // Staging exception
    const throwRunner: GitRunner = (args) => {
      if (args[0] === "add") throw new Error("stage crash");
      return { status: 0, stdout: "sha-1", stderr: "" };
    };
    const res2 = await executeAutoSyncAndCommit(baseOptions, throwRunner, () => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    expect(res2.logs.some((l) => l.includes("Git stage exception: stage crash"))).toBe(true);
  });

  test("handles commit failure, commit rev-parse failure, and commit exception", async () => {
    // Commit failure with stderr
    const commitFailRunner: GitRunner = (args) => {
      if (args[0] === "commit") return { status: 1, stdout: "", stderr: "nothing to commit" };
      return { status: 0, stdout: "", stderr: "" };
    };
    const res1 = await executeAutoSyncAndCommit(baseOptions, commitFailRunner, () => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    expect(res1.committed).toBe(false);
    expect(res1.pushed).toBe(false); // Push skipped when commit fails
    expect(
      res1.logs.some((l) => l.includes("Git commit failed (status 1): nothing to commit")),
    ).toBe(true);
    expect(
      res1.logs.some((l) => l.includes("[push] Push skipped because commit was not successful")),
    ).toBe(true);

    // Commit failure with stdout fallback
    const commitFailStdoutRunner: GitRunner = (args) => {
      if (args[0] === "commit") return { status: 1, stdout: "commit stdout err", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };
    const resStdout = await executeAutoSyncAndCommit(baseOptions, commitFailStdoutRunner, () => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    expect(
      resStdout.logs.some((l) => l.includes("Git commit failed (status 1): commit stdout err")),
    ).toBe(true);

    // Commit succeeds but rev-parse fails
    const revParseFailRunner: GitRunner = (args) => {
      if (args[0] === "rev-parse") return { status: 1, stdout: "", stderr: "rev error" };
      return { status: 0, stdout: "", stderr: "" };
    };
    const res2 = await executeAutoSyncAndCommit(baseOptions, revParseFailRunner, () => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    expect(res2.committed).toBe(true);
    expect(res2.commitSha).toBeUndefined();

    // Commit exception
    const commitThrowRunner: GitRunner = (args) => {
      if (args[0] === "commit") throw new Error("commit crash");
      return { status: 0, stdout: "", stderr: "" };
    };
    const res3 = await executeAutoSyncAndCommit(baseOptions, commitThrowRunner, () => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    expect(res3.committed).toBe(false);
    expect(res3.logs.some((l) => l.includes("Git commit exception: commit crash"))).toBe(true);
  });

  test("handles skipPush, push error, and push exception", async () => {
    // skipPush = true
    const resSkip = await executeAutoSyncAndCommit(
      { ...baseOptions, skipPush: true },
      () => ({ status: 0, stdout: "sha-1", stderr: "" }),
      () => ({ status: 0, stdout: "", stderr: "" }),
    );
    expect(resSkip.pushed).toBe(false);
    expect(resSkip.logs.some((l) => l.includes("[push] Push skipped (skipPush = true)"))).toBe(
      true,
    );

    // Push error with stderr vs stdout
    const pushFailRunner: GitRunner = (args) => {
      if (args[0] === "push") return { status: 1, stdout: "", stderr: "remote rejected" };
      return { status: 0, stdout: "sha-1", stderr: "" };
    };
    const resFail = await executeAutoSyncAndCommit(baseOptions, pushFailRunner, () => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    expect(resFail.pushed).toBe(false);
    expect(
      resFail.logs.some((l) => l.includes("Git push failed (status 1): remote rejected")),
    ).toBe(true);

    const pushFailStdoutRunner: GitRunner = (args) => {
      if (args[0] === "push") return { status: 1, stdout: "push stdout err", stderr: "" };
      return { status: 0, stdout: "sha-1", stderr: "" };
    };
    const resFailStdout = await executeAutoSyncAndCommit(baseOptions, pushFailStdoutRunner, () => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    expect(
      resFailStdout.logs.some((l) => l.includes("Git push failed (status 1): push stdout err")),
    ).toBe(true);

    // Push exception
    const pushThrowRunner: GitRunner = (args) => {
      if (args[0] === "push") throw new Error("network disconnect");
      return { status: 0, stdout: "sha-1", stderr: "" };
    };
    const resThrow = await executeAutoSyncAndCommit(baseOptions, pushThrowRunner, () => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    expect(resThrow.pushed).toBe(false);
    expect(resThrow.logs.some((l) => l.includes("Git push exception: network disconnect"))).toBe(
      true,
    );
  });

  test("handles skipSync, absolute syncScriptPath, sync error, and sync exception", async () => {
    // skipSync = true
    const resSkip = await executeAutoSyncAndCommit(
      { ...baseOptions, skipSync: true },
      () => ({ status: 0, stdout: "sha-1", stderr: "" }),
      () => ({ status: 0, stdout: "", stderr: "" }),
    );
    expect(resSkip.synced).toBe(false);
    expect(
      resSkip.logs.some((l) => l.includes("[sync] Global skill sync skipped (skipSync = true)")),
    ).toBe(true);

    // Absolute syncScriptPath
    let absolutePathReceived = "";
    await executeAutoSyncAndCommit(
      { ...baseOptions, syncScriptPath: "/absolute/path/to/sync.ts" },
      () => ({ status: 0, stdout: "sha-1", stderr: "" }),
      (scriptPath) => {
        absolutePathReceived = scriptPath;
        return { status: 0, stdout: "", stderr: "" };
      },
    );
    expect(absolutePathReceived).toBe("/absolute/path/to/sync.ts");

    // Sync error with stderr vs stdout
    const resFail = await executeAutoSyncAndCommit(
      baseOptions,
      () => ({ status: 0, stdout: "sha-1", stderr: "" }),
      () => ({ status: 1, stdout: "", stderr: "sync failed" }),
    );
    expect(resFail.synced).toBe(false);
    expect(
      resFail.logs.some((l) => l.includes("Global skill sync failed (status 1): sync failed")),
    ).toBe(true);

    const resFailStdout = await executeAutoSyncAndCommit(
      baseOptions,
      () => ({ status: 0, stdout: "sha-1", stderr: "" }),
      () => ({ status: 1, stdout: "sync stdout err", stderr: "" }),
    );
    expect(
      resFailStdout.logs.some((l) =>
        l.includes("Global skill sync failed (status 1): sync stdout err"),
      ),
    ).toBe(true);

    // Sync exception (Error vs non-Error)
    const resThrow = await executeAutoSyncAndCommit(
      baseOptions,
      () => ({ status: 0, stdout: "sha-1", stderr: "" }),
      () => {
        throw new Error("sync crash");
      },
    );
    expect(resThrow.synced).toBe(false);
    expect(resThrow.logs.some((l) => l.includes("Global skill sync exception: sync crash"))).toBe(
      true,
    );

    const resThrowNonError = await executeAutoSyncAndCommit(
      baseOptions,
      () => ({ status: 0, stdout: "sha-1", stderr: "" }),
      () => {
        throw "string exception";
      },
    );
    expect(
      resThrowNonError.logs.some((l) =>
        l.includes("Global skill sync exception: string exception"),
      ),
    ).toBe(true);
  });
});
