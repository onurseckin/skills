import { afterEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { acquireInstallerLock } from "../../orchestrating-long-tasks/scripts/src/installer/installer-lock.ts";
import { cleanInstallerFixtures, installerFixture } from "../unit/installer/helpers.ts";

const worker = join(import.meta.dir, "..", "unit", "installer", "fixtures", "lock-worker.ts");
afterEach(cleanInstallerFixtures);

describe("kernel installer ownership", () => {
  test("an inode-bound flock excludes a concurrent installer process", async () => {
    const { home } = await installerFixture();
    const parent = join(home, ".agents", "skills");
    await mkdir(parent, { recursive: true });
    const child = Bun.spawn({
      cmd: [process.execPath, worker, parent],
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = child.stdout.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("locked");
    expect(() => acquireInstallerLock(parent)).toThrow(/lock|owned|busy/i);

    child.kill("SIGTERM");
    const exitCode = await child.exited;

    // The worker installs its SIGTERM handler before it announces the lock, so a kill that follows
    // "locked" always reaches the handler: it releases and exits, never dying on the signal itself.
    expect(child.signalCode).toBeNull();
    expect(exitCode).toBe(0);
    // Release really ran if the parent can now take the lock the worker was holding.
    acquireInstallerLock(parent).release();
  });
});
