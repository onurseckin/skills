import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURES_DIR = join(import.meta.dir, "fixtures");

const spawnedRoots: string[] = [];
afterEach(() => {
  for (const root of spawnedRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function extract(stdout: string, marker: string): string {
  const line = stdout.split("\n").find((entry) => entry.startsWith(marker));
  if (line === undefined) throw new Error(`fixture output missing ${marker}: ${stdout}`);
  return line.slice(marker.length);
}

async function runFixture(name: string): Promise<{ exitCode: number; stdout: string }> {
  const child = Bun.spawn(["bun", "test", join(FIXTURES_DIR, name)], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  return { exitCode, stdout };
}

describe("scratchRoot across real concurrent same-key claims", () => {
  test("a still-running holder's directory survives intact when a second independent process claims the same deterministic key", async () => {
    const holder = Bun.spawn(["bun", "test", join(FIXTURES_DIR, "collision-holder.fixture.ts")], {
      stdout: "pipe",
      stderr: "pipe",
    });

    await Bun.sleep(400);

    const latecomer = await runFixture("collision-latecomer.fixture.ts");
    expect(latecomer.exitCode).toBe(0);
    const latecomerRoot = extract(latecomer.stdout, "SCRATCH_ROOT::");
    spawnedRoots.push(latecomerRoot);

    const [holderExitCode, holderStdout] = await Promise.all([
      holder.exited,
      new Response(holder.stdout).text(),
    ]);
    expect(holderExitCode).toBe(0);
    const holderRoot = extract(holderStdout, "SCRATCH_ROOT::");
    spawnedRoots.push(holderRoot);

    expect(extract(holderStdout, "HOLDER_MARKER_SURVIVED::")).toBe("true");
    expect(latecomerRoot).not.toBe(holderRoot);
  }, 15000);
});
