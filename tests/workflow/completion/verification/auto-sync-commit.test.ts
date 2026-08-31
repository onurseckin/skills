import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  executeAutoSyncAndCommit,
  type AutoSyncOptions,
  type GitRunner,
  type GitRunnerResult,
  type SyncRunner,
  type SyncRunnerResult,
} from "../../../../olt/scripts/src/workflow/completion/auto-sync-and-commit.ts";

describe("workflow/completion/auto-sync-and-commit", () => {
  const baseOptions: AutoSyncOptions = {
    taskId: "T-1",
    description: "implement feature",
    writeScope: ["src/file.ts"],
    repoRoot: "/test/repo",
  };

  test("full successful flow: stage, commit, push, and skill sync", async () => {
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
