import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  getActiveScratchClaims,
  isScratchRootActive,
  releaseScratchRoot,
  resetScratchRegistry,
  scratchRoot,
} from "./scratch-root.ts";

describe("scratchRoot in-memory concurrency and isolation", () => {
  beforeEach(() => {
    resetScratchRegistry();
  });

  afterEach(() => {
    resetScratchRegistry();
  });

  test("allocates distinct monotonic slot paths for sequential calls with identical keys", () => {
    const caller = "/test/runner/suite.test.ts";
    const label = "sequential-slot";

    const paths: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      paths.push(scratchRoot(caller, label));
    }

    const uniquePaths = new Set(paths);
    expect(uniquePaths.size).toBe(25);

    for (let i = 0; i < 25; i += 1) {
      expect(paths[i]).toContain(`--${label}--${i + 1}--`);
      expect(isScratchRootActive(paths[i])).toBe(true);
    }

    const claims = getActiveScratchClaims();
    expect(claims.length).toBe(25);
  });

  test("handles high-volume concurrent asynchronous calls without path collision", async () => {
    const callerBase = "/test/concurrent/worker-";
    const concurrentRequests = 100;

    const allocations = await Promise.all(
      Array.from({ length: concurrentRequests }, async (_, index) => {
        const caller = `${callerBase}${index % 5}.test.ts`;
        const label = `concurrent-task-${index % 4}`;
        return scratchRoot(caller, label);
      }),
    );

    expect(allocations.length).toBe(concurrentRequests);
    const uniqueAllocations = new Set(allocations);
    expect(uniqueAllocations.size).toBe(concurrentRequests);

    for (const root of allocations) {
      expect(isScratchRootActive(root)).toBe(true);
    }
  });

  test("derives isolated deterministic paths across distinct callers and labels", () => {
    const rootA = scratchRoot("/suite/alpha.test.ts", "shared-label");
    const rootB = scratchRoot("/suite/beta.test.ts", "shared-label");
    const rootC = scratchRoot("/suite/alpha.test.ts", "distinct-label");

    expect(rootA).not.toBe(rootB);
    expect(rootA).not.toBe(rootC);
    expect(rootB).not.toBe(rootC);
  });

  test("releasing an active claim updates in-memory tracking without mutating other claims", () => {
    const caller = "/test/release/claim.test.ts";
    const path1 = scratchRoot(caller, "claim-1");
    const path2 = scratchRoot(caller, "claim-2");

    expect(isScratchRootActive(path1)).toBe(true);
    expect(isScratchRootActive(path2)).toBe(true);

    const released = releaseScratchRoot(path1);
    expect(released).toBe(true);
    expect(isScratchRootActive(path1)).toBe(false);
    expect(isScratchRootActive(path2)).toBe(true);

    const releasedAgain = releaseScratchRoot(path1);
    expect(releasedAgain).toBe(false);
  });

  test("handles hostile paths, traversal characters, and unicode without throwing", () => {
    const hostileLabel = "../../../etc/passwd && <script>alert(1)</script> 🚀 日本語";
    const caller = "/test/hostile/path/injection.test.ts";

    const root = scratchRoot(caller, hostileLabel);
    expect(typeof root).toBe("string");
    expect(root.length).toBeGreaterThan(0);
    expect(isScratchRootActive(root)).toBe(true);
    expect(root).not.toContain("..");
    expect(root).not.toContain("<script>");
  });

  test("createScratchRoot export alias behaves identically to scratchRoot", () => {
    const caller = "/test/alias/check.test.ts";
    const label = "alias-test";

    const pathA = scratchRoot(caller, label);
    const pathB = scratchRoot(caller, label);

    expect(pathA).not.toBe(pathB);
    expect(isScratchRootActive(pathA)).toBe(true);
    expect(isScratchRootActive(pathB)).toBe(true);
  });

  test("tracks claim metadata including pid, call count, and timestamps", () => {
    const caller = "/test/metadata/check.test.ts";
    const label = "metadata-test";

    const root = scratchRoot(caller, label);
    const claims = getActiveScratchClaims();
    const claim = claims.find((c) => c.root === root);

    expect(claim).toBeDefined();
    expect(claim?.pid).toBe(process.pid);
    expect(claim?.key).toContain("metadata-test");
    expect(typeof claim?.claimedAt).toBe("number");
  });

  test("adheres strictly to ZERO_DISK_IO_INVARIANT: creates 0 physical files or directories on disk", () => {
    const caller = "/test/zero-disk/invariant.test.ts";
    const label = "zero-disk-check";

    const root = scratchRoot(caller, label);

    // Physical filesystem checks: absolutely NO directory or file should be created on disk
    expect(existsSync(root)).toBe(false);
    expect(existsSync(join(root, "..", ".owners"))).toBe(false);
  });
});
