import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  linuxLibcCandidates,
  tryExclusiveFlock,
} from "../../../orchestrating-long-tasks/scripts/src/platform/flock-ffi.ts";
import { withRunLock } from "../../../orchestrating-long-tasks/scripts/src/platform/run-lock.ts";

const lockModule = new URL(
  "../../../orchestrating-long-tasks/scripts/src/platform/run-lock.ts",
  import.meta.url,
).pathname;

function runRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "lock-quality-"));
  const run = join(root, "run");
  mkdirSync(run);
  return run;
}

describe("run-lock quality invariants", () => {
  test("distinguishes invalid flock errors from lock contention", () => {
    expect(() => tryExclusiveFlock(-1)).toThrow(/flock|errno/i);
  });

  test("Linux libc discovery includes loaded, glibc, and musl locations", () => {
    const candidates = linuxLibcCandidates(
      "x64",
      "7f00-7fff r-xp 0 00:00 0 /lib/x86_64-linux-gnu/libc.so.6\n",
    );
    expect(candidates[0]).toBe("/lib/x86_64-linux-gnu/libc.so.6");
    expect(candidates).toContain("libc.so.6");
    expect(candidates.some((path) => path.includes("musl-x86_64"))).toBeTrue();
  });

  test("a waiter rejects pathname replacement instead of mutating the new directory", async () => {
    const run = runRoot();
    const moved = `${run}-moved`;
    let child: ReturnType<typeof Bun.spawn> | undefined;
    expect(() =>
      withRunLock(run, () => {
        const code = `
        import { writeFileSync } from "node:fs";
        import { join } from "node:path";
        import { withRunLock } from ${JSON.stringify(lockModule)};
        try {
          withRunLock(${JSON.stringify(run)}, () => writeFileSync(join(${JSON.stringify(run)}, "wrong"), "x"), { timeoutMs: 2000 });
        } catch (error) {
          if (error && error.code === "PATH_SAFETY") process.exit(24);
          throw error;
        }
      `;
        child = Bun.spawn([process.execPath, "--eval", code], {
          stdout: "pipe",
          stderr: "pipe",
        });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
        renameSync(run, moved);
        mkdirSync(run);
      }),
    ).toThrow(/identity changed/);
    expect(await child!.exited).toBe(24);
    expect(await Bun.file(join(run, "wrong")).exists()).toBeFalse();
  });
});
