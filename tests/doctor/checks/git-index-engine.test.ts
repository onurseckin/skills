import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkGitIndexIntegrity,
  autoHealGitState,
} from "../../../olt/scripts/src/reporting/doctor/git-index-engine.ts";

export const gitIndexEngineSuiteName = "Wave 1 - Task 1.4: Git Index Integrity Engine";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe(gitIndexEngineSuiteName, () => {
  test("detects and heals dead .git/index.lock", async () => {
    const repo = await mkdtemp(join(tmpdir(), "git-engine-test-"));
    roots.push(repo);
    const gitDir = join(repo, ".git");
    await mkdir(gitDir, { recursive: true });

    // Create a dead index.lock with non-existent process PID
    const indexLockPath = join(gitDir, "index.lock");
    writeFileSync(indexLockPath, "9999999");

    const report = checkGitIndexIntegrity({ repoRoot: repo });
    expect(report.healthy).toBe(false);
    expect(report.staleIndexLockPresent).toBe(true);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings[0]?.code).toBe("GIT_STALE_INDEX_LOCK_DETECTED");

    // Auto heal
    const healResult = autoHealGitState({
      repoRoot: repo,
      cleanIndexLock: true,
      stageModified: false,
    });
    expect(healResult.indexLockCleaned).toBe(true);
    expect(existsSync(indexLockPath)).toBe(false);

    const reportAfter = checkGitIndexIntegrity({ repoRoot: repo });
    expect(reportAfter.healthy).toBe(true);
  });
});
