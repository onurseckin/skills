import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  autoHealCapsule,
  quarantineTornTail,
} from "../../../olt/scripts/src/reporting/doctor/auto-heal.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { transact } from "../../../olt/scripts/src/engine/store/events/transaction.ts";

export const autoHealQuarantineSuiteName = "Wave 1 - Task 1.1: Capsule Auto-Healer & Quarantine Pipeline";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe(autoHealQuarantineSuiteName, () => {
  test("quarantineTornTail writes torn bytes to quarantine directory with timestamp and hash", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "quarantine-test-"));
    roots.push(tempDir);

    const tornContent = Buffer.from('{"incomplete": "json', "utf-8");
    const fileName = quarantineTornTail(tempDir, tornContent);

    expect(fileName).toMatch(/^\d+-torn-tail-[a-f0-9]{12}\.json$/u);
    expect(existsSync(join(tempDir, "quarantine", fileName))).toBe(true);
  });

  test("autoHealCapsule recovers torn state projection and populates full DoctorAutoHealResult", async () => {
    const repo = await mkdtemp(join(tmpdir(), "autoheal-repo-"));
    roots.push(repo);
    await mkdir(join(repo, ".git"));

    const runRoot = initRun(
      repo,
      "autoheal-run-1",
      new TextEncoder().encode("Prompt"),
      "file",
      true,
    );

    transact(runRoot, "coord-1", "plan-brainstormed", { plan_id: "p1" }, (state) => {
      state.tasks = { t1: { id: "t1", status: "open" } };
    });

    // Simulate corrupted state.json
    writeFileSync(
      join(runRoot, "state.json"),
      JSON.stringify({ schema: "harness.state", event_sequence: 9999, corrupted: true }),
    );

    const result = autoHealCapsule(runRoot, { repoRoot: repo });
    expect(result.projectionRecovered).toBe(true);
    expect(result.autoHealed.length).toBeGreaterThan(0);
    expect(Array.isArray(result.recoveredLeases)).toBe(true);
    expect(Array.isArray(result.quarantinedFragments)).toBe(true);
    expect(Array.isArray(result.danglingLocksCleared)).toBe(true);
    expect(Array.isArray(result.migratedLedgers)).toBe(true);
    expect(typeof result.gitIndexHealed).toBe("boolean");
    expect(Array.isArray(result.gitArtifactsStaged)).toBe(true);
  });
});
