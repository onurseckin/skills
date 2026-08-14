import { afterEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { acquireInstallerLock } from "../../src/installer/installer-lock.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

const worker = join(import.meta.dir, "fixtures", "lock-worker.ts");
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
    expect(await child.exited).toBe(0);
  });
});
