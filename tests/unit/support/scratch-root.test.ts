/**
 * Proof suite for tests/support/scratch-root.ts — the shared scratch-directory primitive that
 * supersedes the ad-hoc `mkdtempSync(join(tmpdir(), prefix)) + roots[] + afterEach` pattern
 * duplicated across the rest of this suite. See tests/support/README.md for the migration guide.
 *
 * Two cases here (the determinism and crash-recovery proofs) spawn tests/support/fixtures/*.test.ts
 * as real, independent `bun test` child processes rather than calling scratchRoot() in-process,
 * because the property under test — "a fresh process derives the same path, with no random seed
 * carried over" — is only genuinely falsifiable across a real process boundary. Anything simulated
 * in-process would just be asserting on this file's own already-warm module state.
 *
 * Those two cases are also the only place in this file that manages its own root array instead of
 * calling scratchRoot(): the paths they assert on were created by a *different* process's module
 * instance, so this file's own scratchRoot bookkeeping never saw them and can't clean them up.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { scratchRoot } from "../../support/scratch-root.ts";

const FIXTURES_DIR = join(import.meta.dir, "..", "..", "support", "fixtures");

describe("scratchRoot", () => {
  test("creates a fresh, empty, real directory", () => {
    const root = scratchRoot(import.meta.path, "basic");
    expect(existsSync(root)).toBe(true);
    expect(statSync(root).isDirectory()).toBe(true);
    expect(readdirSync(root)).toEqual([]);
  });

  test("repeat calls with the identical label never collide", () => {
    const paths = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      paths.add(scratchRoot(import.meta.path, "repeat"));
    }
    expect(paths.size).toBe(5);
    for (const path of paths) expect(existsSync(path)).toBe(true);
  });

  test("different labels in the same file never collide", () => {
    const a = scratchRoot(import.meta.path, "label-a");
    const b = scratchRoot(import.meta.path, "label-b");
    expect(a).not.toBe(b);
  });

  test("different caller files never collide, even under the identical label", () => {
    // Synthetic caller paths exercise the file-identity derivation directly; they don't need to
    // exist on disk since only the first argument's *text* namespaces the directory name.
    const a = scratchRoot("/repo/tests/unit/alpha.test.ts", "shared-label");
    const b = scratchRoot("/repo/tests/unit/beta.test.ts", "shared-label");
    expect(a).not.toBe(b);
  });

  test("labels with filesystem-hostile characters still produce a usable directory", () => {
    const root = scratchRoot(
      import.meta.path,
      "handles /etc/passwd traversal, 'quotes', an — em dash, and 日本語",
    );
    expect(existsSync(root)).toBe(true);
    expect(statSync(root).isDirectory()).toBe(true);
  });

  // Deliberately two sequential tests sharing module state (valid under this suite's
  // `--no-isolate` unit lane): the first records the path scratchRoot handed back, the second
  // — running only after the first test's afterEach has fired — asserts it's already gone. That
  // is the whole point: nothing in either test body cleans up explicitly.
  let handoff: string | undefined;

  test("(1 of 2) hands back a root and does not clean it up itself", () => {
    handoff = scratchRoot(import.meta.path, "teardown-proof");
    expect(existsSync(handoff)).toBe(true);
  });

  test("(2 of 2) the previous test's root is already gone, with no cleanup code of its own", () => {
    expect(handoff).toBeDefined();
    expect(existsSync(handoff as string)).toBe(false);
  });

  test("never reads process.cwd() or mutates process.env to find its root", () => {
    // A cheap, direct regression guard on the specific isolation-contract clauses this helper
    // exists to satisfy — catches a future edit re-introducing either at the source, not just at
    // today's call sites.
    const source = readFileSync(
      join(import.meta.dir, "..", "..", "support", "scratch-root.ts"),
      "utf-8",
    );
    expect(source).not.toContain("process.cwd(");
    expect(source).not.toContain("process.env");
    expect(source).not.toContain("Math.random(");
    expect(source).not.toContain("Date.now(");
  });
});

describe("scratchRoot across real process boundaries", () => {
  const spawnedRoots: string[] = [];
  afterEach(() => {
    for (const root of spawnedRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  async function runFixture(name: string): Promise<{ stdout: string; exitCode: number }> {
    const child = Bun.spawn(["bun", "test", join(FIXTURES_DIR, name)], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    return { stdout, exitCode };
  }

  function extract(stdout: string, marker: string): string {
    const line = stdout.split("\n").find((entry) => entry.startsWith(marker));
    if (line === undefined) throw new Error(`fixture output missing ${marker}: ${stdout}`);
    return line.slice(marker.length);
  }

  test("two independent processes derive the identical path and each tears down on its own", async () => {
    const first = await runFixture("print-scratch-root.fixture.ts");
    expect(first.exitCode).toBe(0);
    const firstPath = extract(first.stdout, "SCRATCH_ROOT::");
    // The child process's own afterEach already ran before `exited` resolved above.
    expect(existsSync(firstPath)).toBe(false);

    const second = await runFixture("print-scratch-root.fixture.ts");
    expect(second.exitCode).toBe(0);
    const secondPath = extract(second.stdout, "SCRATCH_ROOT::");
    expect(existsSync(secondPath)).toBe(false);

    expect(secondPath).toBe(firstPath);
  }, 15000);

  test("a directory a crashed run left behind is force-cleaned before the next run reuses it", async () => {
    const first = await runFixture("crash-before-cleanup.fixture.ts");
    expect(first.exitCode).toBe(0);
    const firstPath = extract(first.stdout, "SCRATCH_ROOT::");
    spawnedRoots.push(firstPath);
    // process.exit() inside the fixture skipped its afterEach, so the marker it wrote is really
    // still sitting on disk at this deterministic path — the scenario a killed prior run leaves.
    expect(extract(first.stdout, "STALE_MARKER_PRESENT::")).toBe("false");
    expect(existsSync(join(firstPath, "leftover.txt"))).toBe(true);

    const second = await runFixture("crash-before-cleanup.fixture.ts");
    expect(second.exitCode).toBe(0);
    const secondPath = extract(second.stdout, "SCRATCH_ROOT::");
    spawnedRoots.push(secondPath);
    expect(secondPath).toBe(firstPath);
    // Reused the exact same path as a crashed run's leftover, yet reports no stale marker: proof
    // scratchRoot() force-removed it before handing the directory back.
    expect(extract(second.stdout, "STALE_MARKER_PRESENT::")).toBe("false");
  }, 15000);
});
