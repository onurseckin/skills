import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { withRunLock } from "../../../orchestrating-long-tasks/scripts/src/platform/run-lock.ts";

const lockModule = new URL(
  "../../../orchestrating-long-tasks/scripts/src/platform/run-lock.ts",
  import.meta.url,
).pathname;

function runRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "harness-lock-"));
  const run = join(root, "run");
  mkdirSync(run);
  return run;
}

function subprocessAttempt(run: string, timeoutMs: number): ReturnType<typeof spawnSync> {
  const code = `
    import { withRunLock } from ${JSON.stringify(lockModule)};
    try { withRunLock(${JSON.stringify(run)}, () => undefined, { timeoutMs: ${timeoutMs} }); }
    catch (error) { if (error && error.code === "LOCK_TIMEOUT") process.exit(23); throw error; }
  `;
  return spawnSync(process.execPath, ["--eval", code], { encoding: "utf8", timeout: 5_000 });
}

describe("inode-bound POSIX run lock", () => {
  test("test_nested_lock_times_out_without_removing_owner_lock", () => {
    const run = runRoot();
    withRunLock(run, () => {
      const before = readFileSync(join(run, ".lock/owner.json"));
      expect(() => withRunLock(run, () => undefined, { timeoutMs: 10 })).toThrow(/timed out/i);
      expect(readFileSync(join(run, ".lock/owner.json"))).toEqual(before);
    });
    expect(existsSync(join(run, ".lock"))).toBeTrue();
    expect(existsSync(join(run, ".lock/owner.json"))).toBeFalse();
  });

  test("test_kernel_lock_blocks_an_independent_process_until_release", () => {
    const run = runRoot();
    withRunLock(run, () => expect(subprocessAttempt(run, 50).status).toBe(23));
    const acquired = subprocessAttempt(run, 200);
    expect(acquired.stderr).toBe("");
    expect(acquired.status).toBe(0);
  });

  test("test_replaced_lock_and_renamed_owned_lock_are_retained", () => {
    const run = runRoot();
    const original = join(run, ".lock");
    const renamed = join(run, ".lock-renamed");
    withRunLock(run, () => {
      const owner = readFileSync(join(original, "owner.json"));
      renameSync(original, renamed);
      mkdirSync(original);
      writeFileSync(join(original, "owner.json"), owner);
      expect(subprocessAttempt(run, 50).status).toBe(23);
    });
    expect(existsSync(join(original, "owner.json"))).toBeTrue();
    expect(existsSync(join(renamed, "owner.json"))).toBeTrue();
  });

  test("test_lock_with_missing_owner_is_retained_fail_closed", () => {
    const run = runRoot();
    withRunLock(run, () => rmSync(join(run, ".lock/owner.json")));
    expect(existsSync(join(run, ".lock"))).toBeTrue();
  });
});
