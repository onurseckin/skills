import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { mindInitCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/mind-init.ts";
import { checkManifest } from "../../../orchestrating-long-tasks/scripts/src/store/manifest.ts";
import { verifyIntegrity } from "../../../orchestrating-long-tasks/scripts/src/store/integrity.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/load.ts";
import { transact } from "../../../orchestrating-long-tasks/scripts/src/store/transaction.ts";
import { scratchRoot as makeScratchRoot } from "../../support/scratch-root.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

const BACKUP_SH_PATH = resolve(
  import.meta.dir,
  "../../../deploy/backup-capsule.sh",
);

const RESTORE_SH_PATH = resolve(
  import.meta.dir,
  "../../../deploy/restore-capsule.sh",
);

const HARNESS_PATH = resolve(
  import.meta.dir,
  "../../../orchestrating-long-tasks/scripts/harness.ts",
);

interface BackupManifestArtifact {
  readonly path: string;
  readonly sha256: string;
  readonly mode: string;
  readonly size: number;
}

interface BackupManifest {
  readonly schema: string;
  readonly version: number;
  readonly run_id: string;
  readonly created_at: string;
  readonly artifacts: readonly BackupManifestArtifact[];
}

function setupTestMind(repo: string, gen: number = 1): string {
  const charterDir = join(repo, "docs", "mind");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "CHARTER.md");
  const charterContent = [
    "# CHARTER",
    "",
    "## identity",
    "Backup-Restore Test Mind",
    "",
    "## goals",
    "- G1: Test capsule backup and restore",
    "",
    "## non-goals",
    "- Production deployment",
    "",
    "## repo_roots",
    "- `src/`",
    "",
  ].join("\n");
  writeFileSync(charterPath, charterContent, "utf-8");

  const initResult = mindInitCommand({
    repo,
    charter: "docs/mind/CHARTER.md",
    generation: String(gen),
  });

  const runRoot = initResult.run_root as string;

  // Append a sample event through transaction to simulate active capsule lifecycle
  transact(
    runRoot,
    "mind-1",
    "candidate-evaluated",
    {
      candidate_id: "cand-1",
      verdict: "accepted",
      score: 95,
    },
    (working) => {
      const candidates = (working.candidates ?? []) as unknown[];
      candidates.push({
        id: "cand-1",
        verdict: "accepted",
        score: 95,
        at: new Date().toISOString(),
      });
      working.candidates = candidates as unknown as import("../../../orchestrating-long-tasks/scripts/src/contracts/json.ts").JsonArray;
    },
  );

  return runRoot;
}

describe("Capsule Backup and Restore", () => {
  test("backup script exists, is executable, and archives capsule with 0444 mode preservation and manifest generation", async () => {
    expect(existsSync(BACKUP_SH_PATH)).toBe(true);
    const repo = scratchRoot("backup-basic");
    const runRoot = setupTestMind(repo, 1);

    const archivePath = join(repo, "backups", "mind-gen-1.tar.gz");
    const manifestPath = join(repo, "backups", "mind-gen-1.manifest.json");

    const proc = Bun.spawn(["bash", BACKUP_SH_PATH, runRoot, archivePath, manifestPath], {
      cwd: repo,
      env: {
        ...process.env,
        HARNESS_PATH,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    expect(existsSync(archivePath)).toBe(true);
    expect(existsSync(manifestPath)).toBe(true);

    const manifestContent = JSON.parse(readFileSync(manifestPath, "utf-8")) as BackupManifest;
    expect(manifestContent.schema).toBe("capsule.backup.manifest");
    expect(manifestContent.version).toBe(1);
    expect(manifestContent.run_id).toBe("mind-gen-1");
    expect(Array.isArray(manifestContent.artifacts)).toBe(true);
    expect(manifestContent.artifacts.length).toBeGreaterThan(0);

    const promptArtifact = manifestContent.artifacts.find((a) => a.path === "prompt.md");
    expect(promptArtifact).toBeDefined();
    expect(promptArtifact!.mode.endsWith("444") || promptArtifact!.mode.endsWith("0444")).toBe(true);
    expect(promptArtifact!.sha256.length).toBe(64);
  });

  test("restore script restores capsule, preserves 0444 mode bit on prompt.md, and passes doctor check", async () => {
    expect(existsSync(RESTORE_SH_PATH)).toBe(true);
    const sourceRepo = scratchRoot("restore-src");
    const runRoot = setupTestMind(sourceRepo, 1);

    const backupDir = join(sourceRepo, "backups");
    const archivePath = join(backupDir, "mind-gen-1.tar.gz");
    const manifestPath = join(backupDir, "mind-gen-1.manifest.json");

    const backupProc = Bun.spawn(["bash", BACKUP_SH_PATH, runRoot, archivePath, manifestPath], {
      cwd: sourceRepo,
      env: {
        ...process.env,
        HARNESS_PATH,
      },
    });
    expect(await backupProc.exited).toBe(0);

    const targetRepo = scratchRoot("restore-dest");
    const restoredCapsulePath = join(targetRepo, ".capsules", "mind-gen-1");

    const restoreProc = Bun.spawn(
      ["bash", RESTORE_SH_PATH, archivePath, restoredCapsulePath, manifestPath],
      {
        cwd: targetRepo,
        env: {
          ...process.env,
          HARNESS_PATH,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const restoreExit = await restoreProc.exited;
    expect(restoreExit).toBe(0);

    expect(existsSync(restoredCapsulePath)).toBe(true);

    // Verify 0444 mode bit retained on prompt.md (read-only, not writable)
    const promptPath = join(restoredCapsulePath, "prompt.md");
    expect(existsSync(promptPath)).toBe(true);
    const promptStat = statSync(promptPath);
    expect((promptStat.mode & 0o222) === 0).toBe(true);

    // Verify manifest check and integrity on restored capsule
    const manifestCheck = checkManifest(restoredCapsulePath);
    expect(manifestCheck.issues.length).toBe(0);

    const integrityCheck = verifyIntegrity(restoredCapsulePath);
    expect(integrityCheck).toEqual([]);
  });

  test("event sequence head and event log match exactly between source and restored capsule", async () => {
    const sourceRepo = scratchRoot("head-match-src");
    const sourceRun = setupTestMind(sourceRepo, 1);

    // Add multiple events to source capsule
    for (let i = 1; i <= 3; i++) {
      transact(
        sourceRun,
        "mind-1",
        "observation-recorded",
        {
          observation_id: `obs-${i}`,
          summary: `Test observation step ${i}`,
        },
        (working) => {
          const obs = (working.observations ?? []) as unknown[];
          obs.push({ id: `obs-${i}`, summary: `Test observation step ${i}` });
          working.observations = obs as unknown as import("../../../orchestrating-long-tasks/scripts/src/contracts/json.ts").JsonArray;
        },
      );
    }

    const archivePath = join(sourceRepo, "backup.tar.gz");
    const manifestPath = join(sourceRepo, "backup.manifest.json");

    const backupProc = Bun.spawn(["bash", BACKUP_SH_PATH, sourceRun, archivePath, manifestPath], {
      cwd: sourceRepo,
      env: { ...process.env, HARNESS_PATH },
    });
    expect(await backupProc.exited).toBe(0);

    const targetRepo = scratchRoot("head-match-dest");
    const restoredRun = join(targetRepo, ".capsules", "mind-gen-1");

    const restoreProc = Bun.spawn(["bash", RESTORE_SH_PATH, archivePath, restoredRun, manifestPath], {
      cwd: targetRepo,
      env: { ...process.env, HARNESS_PATH },
    });
    expect(await restoreProc.exited).toBe(0);

    // Compare loaded runs
    const sourceLoaded = loadRun(sourceRun);
    const restoredLoaded = loadRun(restoredRun);

    expect(restoredLoaded.state.revision).toBe(sourceLoaded.state.revision);
    expect(restoredLoaded.manifest.prompt_sha256).toBe(sourceLoaded.manifest.prompt_sha256);

    const sourceEvents = readFileSync(join(sourceRun, "events.jsonl"), "utf-8");
    const restoredEvents = readFileSync(join(restoredRun, "events.jsonl"), "utf-8");
    expect(restoredEvents).toBe(sourceEvents);
  });

  test("rejects writable prompt.md (chmod -R u+w scenario)", async () => {
    const sourceRepo = scratchRoot("writable-prompt-src");
    const sourceRun = setupTestMind(sourceRepo, 1);

    const archivePath = join(sourceRepo, "backup.tar.gz");
    const manifestPath = join(sourceRepo, "backup.manifest.json");

    const backupProc = Bun.spawn(["bash", BACKUP_SH_PATH, sourceRun, archivePath, manifestPath], {
      cwd: sourceRepo,
      env: { ...process.env, HARNESS_PATH },
    });
    expect(await backupProc.exited).toBe(0);

    const targetRepo = scratchRoot("writable-prompt-dest");
    const restoredRun = join(targetRepo, ".capsules", "mind-gen-1");

    // Restore first
    const restoreProc = Bun.spawn(["bash", RESTORE_SH_PATH, archivePath, restoredRun, manifestPath], {
      cwd: targetRepo,
      env: { ...process.env, HARNESS_PATH },
    });
    expect(await restoreProc.exited).toBe(0);

    // Simulate chmod -R u+w on the restored capsule
    const promptPath = join(restoredRun, "prompt.md");
    chmodSync(promptPath, 0o644);

    // Check that manifest validation detects writable prompt
    const checkResult = checkManifest(restoredRun);
    const promptModeIssue = checkResult.issues.find((i) => i.code === "PROMPT_MODE");
    expect(promptModeIssue).toBeDefined();
    expect(promptModeIssue?.message).toContain("prompt.md is writable");

    // Check that verifyIntegrity rejects writable prompt
    const integrityResult = verifyIntegrity(restoredRun);
    expect(integrityResult.length).toBeGreaterThan(0);
    expect(integrityResult.some((i) => i.code === "PROMPT_MODE")).toBe(true);

    // Check that restore script with a writable prompt fails integrity check
    // Create an archive containing a writable prompt.md
    const corruptedRepo = scratchRoot("corrupted-archive");
    const corruptedRun = setupTestMind(corruptedRepo, 2);
    chmodSync(join(corruptedRun, "prompt.md"), 0o644);

    const corruptedArchive = join(corruptedRepo, "corrupted.tar.gz");
    // Manually create tar containing the writable prompt
    const tarProc = Bun.spawn(
      ["tar", "-czpf", corruptedArchive, "-C", join(corruptedRepo, ".capsules"), "mind-gen-2"],
      { cwd: corruptedRepo },
    );
    expect(await tarProc.exited).toBe(0);

    const destCorrupted = join(scratchRoot("corrupted-dest"), ".capsules", "mind-gen-2");
    const failingRestoreProc = Bun.spawn(["bash", RESTORE_SH_PATH, corruptedArchive, destCorrupted], {
      cwd: targetRepo,
      env: { ...process.env, HARNESS_PATH },
      stdout: "pipe",
      stderr: "pipe",
    });

    const failingExit = await failingRestoreProc.exited;
    expect(failingExit).not.toBe(0);
    const stderrText = await new Response(failingRestoreProc.stderr).text();
    expect(stderrText).toContain("INTEGRITY: prompt.md is writable");
  });

  test("rejects artifact checksum mismatch during restore verification", async () => {
    const sourceRepo = scratchRoot("tamper-src");
    const sourceRun = setupTestMind(sourceRepo, 1);

    const archivePath = join(sourceRepo, "backup.tar.gz");
    const manifestPath = join(sourceRepo, "backup.manifest.json");

    const backupProc = Bun.spawn(["bash", BACKUP_SH_PATH, sourceRun, archivePath, manifestPath], {
      cwd: sourceRepo,
      env: { ...process.env, HARNESS_PATH },
    });
    expect(await backupProc.exited).toBe(0);

    // Tamper with state.json in the source, create modified archive but keep original manifest
    writeFileSync(join(sourceRun, "state.json"), JSON.stringify({ tampered: true }), "utf-8");
    const tamperedArchive = join(sourceRepo, "tampered.tar.gz");
    const tarProc = Bun.spawn(
      ["tar", "-czpf", tamperedArchive, "-C", join(sourceRepo, ".capsules"), "mind-gen-1"],
      { cwd: sourceRepo },
    );
    expect(await tarProc.exited).toBe(0);

    const targetRepo = scratchRoot("tamper-dest");
    const restoredRun = join(targetRepo, ".capsules", "mind-gen-1");

    const failingRestoreProc = Bun.spawn(
      ["bash", RESTORE_SH_PATH, tamperedArchive, restoredRun, manifestPath],
      {
        cwd: targetRepo,
        env: { ...process.env, HARNESS_PATH },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const failingExit = await failingRestoreProc.exited;
    expect(failingExit).not.toBe(0);
    const stderrText = await new Response(failingRestoreProc.stderr).text();
    expect(stderrText).toContain("INTEGRITY: SHA-256 mismatch");
  });
});
