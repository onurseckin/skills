import { describe, expect, test } from "bun:test";
import {
  closeSync,
  constants,
  mkdirSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  libraryCandidates,
  linuxLibcCandidates,
  releaseFlock,
  tryExclusiveFlock,
} from "../../../olt/scripts/src/platform/index.ts";
import { withRunLock } from "../../../olt/scripts/src/platform/index.ts";
import { clearObserver, publishObserver } from "../../../olt/scripts/src/platform/index.ts";

const lockModule = new URL("../../../olt/scripts/src/platform/index.ts", import.meta.url).pathname;

function runRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "lock-quality-"));
  const run = join(root, "run");
  mkdirSync(run);
  return run;
}

describe("run-lock quality invariants", () => {
  test("distinguishes invalid flock errors from lock contention", () => {
    expect(() => tryExclusiveFlock(-1)).toThrow(/flock|errno/i);
    expect(() => releaseFlock(-1)).toThrow(/flock release failed with errno/i);
  });

  test("libraryCandidates resolves per-platform: darwin's single dylib, Linux's libc search, others unsupported", () => {
    expect(libraryCandidates("darwin")).toEqual(["/usr/lib/libSystem.B.dylib"]);
    // On a real Linux host /proc/self/maps would list the loaded libc; here it fails to read (this
    // host isn't Linux), exercising the same empty-maps fallback linuxLibcCandidates("") covers
    // directly below, but through the platform dispatch rather than calling it directly.
    expect(libraryCandidates("linux").length).toBeGreaterThan(0);
    expect(() => libraryCandidates("win32")).toThrow(/unsupported on win32/i);
  });

  test("Linux libc discovery includes loaded, glibc, and musl locations", () => {
    const candidates = linuxLibcCandidates(
      "x64",
      "7f00-7fff r-xp 0 00:00 0 /lib/x86_64-linux-gnu/libc.so.6\n",
    );
    expect(candidates[0]).toBe("/lib/x86_64-linux-gnu/libc.so.6");
    expect(candidates).toContain("libc.so.6");
    expect(candidates.some((path) => path.includes("musl-x86_64"))).toBeTrue();

    const armCandidates = linuxLibcCandidates("arm64");
    expect(armCandidates.some((path) => path.includes("aarch64"))).toBeTrue();

    const otherCandidates = linuxLibcCandidates("mips64");
    expect(otherCandidates.some((path) => path.includes("mips64"))).toBeTrue();
  });

  test("withRunLock validates arguments and propagates execution results and errors", () => {
    const run = runRoot();
    expect(withRunLock(run, () => 42)).toBe(42);

    expect(() =>
      withRunLock(run, () => {
        throw new Error("inside lock error");
      }),
    ).toThrow(/inside lock error/);

    expect(() => withRunLock(join(run, "nonexistent"), () => {})).toThrow();

    const filePath = join(run, "file-not-dir");
    writeFileSync(filePath, "data");
    expect(() => withRunLock(filePath, () => {})).toThrow(/real directory/i);

    expect(() => withRunLock(run, () => {}, { timeoutMs: -10 })).toThrow(
      /timeoutMs must be finite and non-negative/i,
    );
    expect(() => withRunLock(run, () => {}, { retryMs: Number.NaN })).toThrow(
      /timeoutMs must be finite and non-negative/i,
    );

    expect(() =>
      withRunLock(run, () => {
        rmSync(run, { recursive: true, force: true });
      }),
    ).toThrow(/run root disappeared while locked/i);
  });

  test("withRunLock times out (and its delay() retry loop runs) when another holder already has the lock", () => {
    const run = runRoot();
    const holderFd = openSync(
      run,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    expect(tryExclusiveFlock(holderFd)).toBeTrue();
    try {
      expect(() => withRunLock(run, () => {}, { timeoutMs: 40, retryMs: 5 })).toThrow(
        /timed out after 40ms waiting for run lock/i,
      );
    } finally {
      releaseFlock(holderFd);
      closeSync(holderFd);
    }
  });

  test("clearObserver is a no-op once the whole observer directory has vanished", () => {
    const run = runRoot();
    const observer = publishObserver(run);
    rmSync(observer.path, { recursive: true, force: true });
    expect(() => clearObserver(observer)).not.toThrow();
  });

  test("clearObserver is a no-op when the directory survives but owner.json itself is gone", () => {
    const run = runRoot();
    const observer = publishObserver(run);
    rmSync(join(observer.path, "owner.json"));
    expect(() => clearObserver(observer)).not.toThrow();
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
